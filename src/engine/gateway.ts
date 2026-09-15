import type { VideoKit } from './compiler'
import type { Mode, VideoDna } from './videoDna'

// Client for the ISOLATED antigravity-proxy container (http://localhost:8791).
// This talks only to our own container — never to any third-party/global proxy.
// Open http://localhost:8791 → "Add Account" → sign in with Google → models
// appear automatically in /v1/models. That endpoint doubles as the health check.

export interface GatewayConfig { url: string; key?: string }

// Proxy base URL. Override at build time for hosted deploys (e.g. Railway):
//   VITE_PROXY_URL=https://my-proxy.up.railway.app npm run build
// The proxy MUST sit behind this exact host:port — its OAuth redirect_uri is
// derived from where it runs, so the dashboard URL and this URL always match.
export const DEFAULT_GATEWAY: GatewayConfig = {
  url: ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PROXY_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
}

// Factory default generation model — verified available on the proxy
// (auto-corrects to the newest flash in the live catalog if absent).
export const DEFAULT_PROXY_MODEL = 'gemini-3.8-flash-high'

export function isModelAvailable(modelIds: string[], wanted: string): boolean {
  return modelIds.includes(wanted)
}

export function bestDefaultModel(modelIds: string[]): string {
  if (modelIds.length === 0) return DEFAULT_PROXY_MODEL
  if (modelIds.includes(DEFAULT_PROXY_MODEL)) return DEFAULT_PROXY_MODEL
  const newestFlash = modelIds
    .filter((m) => /^gemini-3(\.\d+)?-flash(-[a-z]+)?$/.test(m))
    .sort((a, b) => b.localeCompare(a))[0]
  return newestFlash ?? modelIds[0]
}

export interface GatewayStatus {
  reachable: boolean
  connected: boolean // true once ≥1 Google account is enrolled in the proxy
  modelIds: string[]
  error?: string
}

export interface GatewayModel { id: string; name: string; notes?: string }

const clean = (u: string) => u.replace(/\/+$/, '')
const headers = (cfg: GatewayConfig): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.key) h.Authorization = `Bearer ${cfg.key}`
  return h
}

export async function gwStatus(cfg: GatewayConfig): Promise<GatewayStatus> {
  try {
    const r = await fetch(`${clean(cfg.url)}/v1/models`, { headers: headers(cfg) })
    if (!r.ok) return { reachable: true, connected: false, modelIds: [], error: `HTTP ${r.status}` }
    const j = await r.json()
    const ids: string[] = (j.data || []).map((m: { id: string }) => m.id)
    return { reachable: true, connected: ids.length > 0, modelIds: ids }
  } catch (e) {
    return { reachable: false, connected: false, modelIds: [], error: String((e as Error).message || e) }
  }
}

// The proxy reports models only after an account is connected. Until then we
// show the known catalog so /admin is still fully browsable.
export const KNOWN_MODELS: GatewayModel[] = [
  { id: 'antigravity-gemini-3-flash', name: 'Gemini 3 Flash (Antigravity)', notes: 'Fast compiler — factory default for prompt generation.' },
  { id: 'antigravity-gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low (Antigravity)', notes: 'Pro reasoning, low thinking budget.' },
  { id: 'antigravity-gemini-3.1-pro-high', name: 'Gemini 3.1 Pro High (Antigravity)', notes: 'Pro reasoning, high thinking budget.' },
  { id: 'antigravity-gemini-3-pro-low', name: 'Gemini 3 Pro Low (Antigravity)', notes: 'Gemini 3 Pro, low thinking.' },
  { id: 'antigravity-gemini-3-pro-high', name: 'Gemini 3 Pro High (Antigravity)', notes: 'Gemini 3 Pro, high thinking.' },
  { id: 'antigravity-claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Antigravity)', notes: 'Strong prose compilers.' },
  { id: 'antigravity-claude-sonnet-4-6-thinking-high', name: 'Claude Sonnet 4.6 Think High (Antigravity)', notes: 'Sonnet with extended thinking.' },
  { id: 'antigravity-claude-opus-4-6-thinking-high', name: 'Claude Opus 4.6 Think High (Antigravity)', notes: 'Highest-effort compiler for benchmarks.' },
]

export function prettyModelName(id: string): string {
  const known = KNOWN_MODELS.find((m) => m.id === id)
  if (known) return known.name
  return id
    .replace(/^antigravity-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()) + ' (Antigravity)'
}

// Tiered IDs verified live against the current client identity (2.12.x).
// The proxy's /v1/models is built from Google's quota cache, which can lag
// behind what actually generates — so these are always offered too.
const VERIFIED_MODELS: GatewayModel[] = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High (Antigravity)', notes: 'Newest flash, high thinking budget — recommended default.' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash Medium (Antigravity)', notes: 'Newest flash, medium thinking budget.' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash Low (Antigravity)', notes: 'Newest flash, fastest.' },
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High (Antigravity)', notes: 'Previous flash generation, high thinking.' },
]

export async function gwModels(cfg: GatewayConfig): Promise<GatewayModel[]> {
  const st = await gwStatus(cfg)
  if (st.modelIds.length === 0) return KNOWN_MODELS
  const reported = st.modelIds.map((id) => {
    const known = [...KNOWN_MODELS, ...VERIFIED_MODELS].find((m) => m.id === id)
    return known ?? { id, name: prettyModelName(id), notes: 'Reported by the proxy for your account.' }
  })
  // Ensure the verified tiered IDs are always present in the picker, even when
  // the proxy's quota-derived cache has not surfaced them yet.
  for (const vm of VERIFIED_MODELS) {
    if (!st.modelIds.includes(vm.id)) reported.push(vm)
  }
  return reported
}

export async function gwPing(cfg: GatewayConfig, model?: string): Promise<{ ok: boolean; ms?: number; reply?: string; error?: string }> {
  const started = Date.now()
  try {
    const r = await fetch(`${clean(cfg.url)}/v1/chat/completions`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ model: model || DEFAULT_PROXY_MODEL, messages: [{ role: 'user', content: 'Reply with exactly: PONG' }], max_tokens: 20 }),
    })
    const ms = Date.now() - started
    const j = await r.json()
    if (!r.ok) return { ok: false, ms, error: j?.error?.message || `HTTP ${r.status}` }
    const reply = j.choices?.[0]?.message?.content ?? ''
    return { ok: !!reply, ms, reply: reply.trim().slice(0, 120) }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: String((e as Error).message || e) }
  }
}

// True SSE streaming from the proxy — used for the live analysis panel.
// onChunk receives ('content' | 'reasoning') pieces; only content is returned.
export async function gwChatStream(
  cfg: GatewayConfig,
  messages: { role: string; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }[],
  model: string | undefined,
  onChunk: (text: string, kind: 'content' | 'reasoning') => void,
  maxTokens = 6000,
): Promise<string> {
  const r = await fetch(`${clean(cfg.url)}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ model: model || DEFAULT_PROXY_MODEL, messages, max_tokens: maxTokens, stream: true, temperature: 0.6 }),
  })
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '')
    throw new Error(`Stream ${r.status}: ${t.slice(0, 200)}`)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let full = ''
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const data = s.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const delta = j.choices?.[0]?.delta ?? {}
        if (delta.reasoning_content) onChunk(delta.reasoning_content, 'reasoning')
        if (delta.content) { full += delta.content; onChunk(delta.content, 'content') }
      } catch { /* partial line */ }
    }
  }
  return full
}

export async function gwChat(
  cfg: GatewayConfig,
  messages: { role: string; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }[],
  model?: string,
  maxTokens = 4096,
): Promise<string> {
  const r = await fetch(`${clean(cfg.url)}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ model: model || DEFAULT_PROXY_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
  })
  if (!r.ok) {
    const t = await r.text()
    let msg = t
    try { msg = JSON.parse(t)?.error?.message || t } catch { /* raw */ }
    throw new Error(String(msg).slice(0, 300))
  }
  const j = await r.json()
  return j.choices?.[0]?.message?.content ?? ''
}

// ── Live engine: the Antigravity model writes the full clip kit itself ──

// Full clip-kit compiler prompt — mirrors the user's example output format.
const KIT_SYSTEM = `You are the Prompt Compiler inside AI Prompt Studio, a tool that turns reference videos into ready-to-use AI video-generation prompt kits.
You receive a frame-by-frame description of ONE reference video (duration, orientation, and what happens at each moment), plus a SPLIT PLAN telling you exactly how to cut it into clips.
Produce a complete CLIP KIT so the user can recreate the video in their chosen AI video generator.

Return ONLY minified JSON matching this TypeScript type (no markdown, no commentary):
{"videoTitle":string,"sourceSeconds":number,"orientation":string,"summary":string,"splitNote":string,"sharedBlock":string,"clips":[{"index":number,"title":string,"sourceStart":number,"sourceEnd":number,"gen":number,"body":string,"voiceover":string}],"post":string[],"notes":string[]}

How to build it:
- sharedBlock: the reusable block pasted on top of EVERY clip. Write real, video-specific content with labeled sections like SUBJECT LOCK (identity + wardrobe with strict preservation rules), CLOTHING if the subject wears clothes (fabric behavior, coverage, never transparent), PERSONALITY if the subject performs to camera, SCALE (real-world size vs props), WORLD/SETTING, STYLE (render style + orientation), AUDIO (voiceover/music instructions) and NEGATIVE (concrete failure modes only). Be concrete and cinematic, referencing what is actually in the video.
- clips: follow the SPLIT PLAN exactly — it defines how many clips and each clip's sourceStart/sourceEnd window and the gen length (the exact second-duration the target generator produces for that clip; a generation may be slightly longer or shorter than the source window it covers). body = shot-by-shot prompt text for that clip written for the GEN length: one paragraph per shot with [start-end s] timestamps re-based to clip-local time (0 = clip start), camera framing, subject action, environment, lighting. If the gen length is longer than the source window, extend the final action gracefully and hold the last frame; if shorter, tighten the pacing. If the reference has narration, include the spoken words under VOICEOVER: with sync notes; if it has no narration, omit voiceover and AUDIO from the shared block.
- clips chain continuity when the action continues across a boundary; hard cuts between different locations get no chaining. Note the cutting style in splitNote.
- post: captions/assembly/trim notes (mention any clip whose gen length differs from its source window). notes: deviations or warnings (max 3).
- Duration claim in each clip body must match its gen length.
Never invent details that contradict the frame description.`

// Frame-watcher storyboard — the visual evidence the compiler writes the kit from.
const STORY_SYSTEM = `You are a precise visual analyst. You receive a storyboard of frames captured at known timestamps from one video. Describe EXACTLY what happens between frames so a prompt writer can reconstruct it: subject appearance (identity, wardrobe with fabric details, colors, body/scale), each visible action with timing, camera behavior (move, height, framing, cuts if any), environment/setting changes, lighting, on-screen text, and whether the subject speaks (lip movement) or narrates. Use the frame timestamps. Output plain concise numbered observations, one per scene change or major action. No markdown headers.

REFERENCE IMAGES: the request may also attach the user's own reference images (characters, products, props, outfits, styles), each labeled and optionally with a USER INTENT. For each one: (1) identify what it shows, (2) reason about how it relates to the video's content — does it match something already in the video (a subject, an object, the style)?, (3) state exactly how it should be used. If a USER INTENT is given, that intent is law — restate it precisely. If NO intent is given, choose the most sensible use yourself from what you see: replace the matching subject with it, have the subject wear/carry it, place it into the scene, or apply it as the visual style. End your analysis with a line 'REF PLAN:' followed by one line per attachment: name → how it will be used.`

export async function liveStoryboard(
  cfg: GatewayConfig,
  args: { fileName: string; duration: number; orientation: string; frames: { t: number; dataUrl: string }[]; refs?: { name: string; kind: string; dataUrl: string; intent?: string; desc?: string }[] },
  model?: string,
  onChunk?: (text: string) => void,
): Promise<string> {
  // Multimodal request: the model SEES each extracted frame (Antigravity
  // accepts OpenAI-style image_url parts with data URLs — verified live).
  const frameLines = args.frames.length
    ? args.frames.map((f, i) => `Frame ${i + 1} = t=${f.t.toFixed(1)}s (image ${i + 1} attached)`).join('\n')
    : `No frames extractable — duration ${args.duration.toFixed(1)}s. Infer from context.`
  const refNote = args.refs?.length
    ? `\nREFERENCE IMAGES: ${args.refs.length} user attachment(s) follow the video frames — analyze each per your instructions${args.refs.some((r) => r.intent) ? ' (USER INTENT given for at least one — follow it exactly)' : ' (no intents given — decide the best use yourself)'}${args.refs.some((r) => r.desc) ? '. USER DESCRIPTIONS are attached for some references — treat those words as ground truth about the reference.' : ''}`
    : ''
  const textPart = `FILE: ${args.fileName}\nDURATION: ${args.duration.toFixed(1)}s\nORIENTATION: ${args.orientation}\nFRAME MAP:\n${frameLines}${refNote}\n\nDescribe what happens across the video, frame by frame. For frame 1, describe the subject's complete appearance in detail (identity, skin, hair, face, wardrobe with fabric/coverage details, colors, scale) — this becomes the locked character description.${args.refs?.length ? ' Then analyze each REFERENCE IMAGE and end with the REF PLAN.' : ''}`

  const parts: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = [
    { type: 'text', text: textPart },
    ...args.frames.map((f) => ({ type: 'image_url' as const, image_url: { url: f.dataUrl } })),
    ...(args.refs ?? []).flatMap((r) => [
      { type: 'text' as const, text: `REFERENCE IMAGE "${r.name}" (kind: ${r.kind})${r.desc ? `\nUSER DESCRIPTION (ground truth — the user wrote this about the reference): ${r.desc}` : ''}${r.intent ? `\nUSER INTENT (law): ${r.intent}` : '\nNo intent given: decide the best use from what you see and the user description.'}` },
      { type: 'image_url' as const, image_url: { url: r.dataUrl } },
    ]),
  ]

  if (onChunk) {
    return gwChatStream(cfg, [{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: parts }], model, (piece) => onChunk(piece), 4000)
  }
  return gwChat(cfg, [{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: parts }], model, 4000)
}

export async function liveKit(
  cfg: GatewayConfig,
  args: { fileName: string; duration: number; orientation: string; storyboard: string; mode: Mode; replaceNotes?: string; splitPlan?: string; refs?: { name: string; kind: string; intent?: string; desc?: string }[] },
  model?: string,
  onChunk?: (text: string) => void,
): Promise<VideoKit> {
  const refSection = args.refs?.length
    ? `\nREFERENCE ATTACHMENTS (the user will attach these image files alongside the prompt in the target tool — treat them as hard visual locks):
${args.refs.map((r, i) => `- ATTACHMENT ${i + 1} "${r.name}" (kind: ${r.kind})${r.desc ? `\n  USER DESCRIPTION (ground truth — reproduce the subject EXACTLY as these words say, they override what you think you see): ${r.desc}` : ''}${r.intent ? `\n  USER INTENT (law, restate it in the kit): ${r.intent}` : '\n  No intent given: use the REF PLAN from the frame analysis (the analyst decided the best use)'}`).join('\n')}
For every attachment: identify it in the kit (add an 'ATTACHMENTS' section in the sharedBlock listing each file name and its locked role), describe it only from what the reference shows (never contradict it), lock identity/appearance so every clip keeps it identical, and write clip bodies so the subject/scene uses it per the intent or REF PLAN. If an attachment should replace the video's original subject, write the replacement as the identity (do not describe the original).`
    : ''
  const user = [
    `FILE: ${args.fileName}`,
    `DURATION: ${args.duration.toFixed(1)}s`,
    `ORIENTATION: ${args.orientation}`,
    `MODE: ${args.mode === 'recreate' ? 'RECREATE THIS VIDEO — the kit recreates the reference exactly' : 'REUSE STYLE & MOTION — keep camera/style/world, swap in the user\'s replacement subjects as described'}`,
    args.replaceNotes ? `REPLACEMENTS: ${args.replaceNotes}` : '',
    args.splitPlan ?? 'SPLIT PLAN: split at the video\'s own scene cuts (or evenly if one continuous take), each clip ≤10s, gen = round(clamp(clip seconds, 4, 10)).',
    `FRAME ANALYSIS:\n${args.storyboard}`,
    ...(refSection ? [refSection] : []),
    'Return the clip kit JSON now.',
  ].filter(Boolean).join('\n')
  const text = onChunk
    ? await gwChatStream(cfg, [{ role: 'system', content: KIT_SYSTEM }, { role: 'user', content: user }], model, (piece) => onChunk(piece), 12000)
    : await gwChat(cfg, [{ role: 'system', content: KIT_SYSTEM }, { role: 'user', content: user }], model, 12000)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Compiler returned no JSON')
  const kit = JSON.parse(m[0]) as VideoKit
  if (!kit.clips?.length) throw new Error('Compiler returned no clips')
  return kit
}

// ── Deep reasoning pass: PROMPT CRITIC + AUTO REPAIR ─────────────────────────
// The user's #1 quality requirement: without reasoning the prompts are bad.
// After the kit compiles, a second model pass audits it against the frame
// evidence and the split plan, returning either a repaired kit or nothing.
const CRITIC_SYSTEM = `You are the Prompt QA Critic inside AI Prompt Studio. You receive: (1) the FRAME ANALYSIS of a reference video, (2) the SPLIT PLAN that was requested, and (3) the compiled CLIP KIT JSON. Audit the kit ruthlessly and output ONLY minified JSON:
{"verdict":"pass"|"repair","issues":string[],"kit":{...}}
Check every item:
- Does each clip body describe what the frames ACTUALLY show at that timestamp (subject, wardrobe, props, actions)? Flag and fix any invented or contradicting detail.
- Does each clip's gen duration match the split plan (within rounding)? Do sourceStart/sourceEnd windows tile the full video with no gaps or overlaps?
- Is local timing inside each body re-based to the clip (0 = clip start) and consistent with its gen length?
- Does the sharedBlock lock everything that must stay identical (identity, wardrobe fabrics/colors, scale, world, lighting, style, orientation)? Is the NEGATIVE list concrete?
- Continuity chaining present where clips continue an action; absent across real hard cuts?
- Any model-unsupported claim (exact focal length fabrications, impossible physics) or leaked template text ([PLACEHOLDERS], "CLIP X of N" in shared block)?
- If REFERENCE ATTACHMENTS exist: is each identified and locked in the sharedBlock's ATTACHMENTS section, used per its USER INTENT (or the REF PLAN when no intent), and kept identical across all clips without contradicting the reference?
If verdict is "repair", return the FULL corrected kit JSON in "kit" (same schema). If everything is genuinely correct, verdict "pass" with empty issues and omit "kit". Never invent new content — repair only from the frame analysis.`

export async function criticReviewKit(
  cfg: GatewayConfig,
  args: { storyboard: string; splitPlan: string; kit: VideoKit; model?: string; onChunk?: (t: string) => void; refs?: { name: string; kind: string; intent?: string; desc?: string }[] },
): Promise<{ verdict: 'pass' | 'repair'; issues: string[]; kit?: VideoKit }> {
  const refSection = args.refs?.length
    ? `\nREFERENCE ATTACHMENTS:\n${args.refs.map((r, i) => `- ATTACHMENT ${i + 1} "${r.name}" (kind: ${r.kind})${r.desc ? ` — USER DESCRIPTION (ground truth): ${r.desc}` : ''}${r.intent ? ` — USER INTENT: ${r.intent}` : ''}`).join('\n')}`
    : ''
  const user = [
    `SPLIT PLAN:\n${args.splitPlan}`,
    `FRAME ANALYSIS:\n${args.storyboard}`,
    ...(refSection ? [refSection] : []),
    `COMPILED KIT:\n${JSON.stringify(args.kit)}`,
    'Audit it now.',
  ].join('\n\n')
  const text = await gwChat(
    cfg,
    [{ role: 'system', content: CRITIC_SYSTEM }, { role: 'user', content: user }],
    args.model,
    12000,
  )
  if (args.onChunk) args.onChunk(text)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Critic returned no JSON')
  const out = JSON.parse(m[0]) as { verdict?: string; issues?: unknown; kit?: VideoKit }
  const issues = Array.isArray(out.issues) ? out.issues.map(String).slice(0, 6) : []
  if (out.verdict === 'repair' && out.kit?.clips?.length) return { verdict: 'repair', issues, kit: out.kit }
  return { verdict: 'pass', issues }
}

// Live Video DNA — turns the visual storyboard into real analysis fields so
// the "View AI Analysis" panel reflects the actual uploaded video, not a seed.
const DNA_SYSTEM = `You are a video forensics engine. From the storyboard of one reference video, output ONLY a compact JSON object (no markdown, no commentary) with these keys:
{"title":"3-6 word scene title","scene":"2-4 word scene category","sceneDetail":"one sentence","environment":"one sentence","subjects":[{"name":"...","description":"full visual identity: form, material/skin, face, hair, colors","wardrobe":"detailed clothing with fabric, coverage, colors","replaces":false}],"timeline":[{"start":0,"end":5,"subject":"what the subject does","camera":"what the camera does"}],"camera":{"move":"...","height":"...","lensCharacter":"...","speed":"..."},"motion":{"subject":"...","camera":"...","relative":"..."},"lighting":{"sources":"...","quality":"...","temperature":"...","shadows":"..."},"composition":{"symmetry":"...","occupancy":"...","headroom":"..."},"style":["3-6 style tags"],"grade":"...","continuity":[{"label":"...","rule":"..."}],"negativeWatch":["5-8 risks"],"singleShot":true,"shotCount":1}
Timeline events MUST cover the full duration with realistic second values. confidence is 0-1; set "confidence" inside camera. Keep every string under 240 chars.`

export async function liveDnaFromStoryboard(
  cfg: GatewayConfig,
  args: { fileName: string; duration: number; storyboard: string },
  model?: string,
): Promise<Partial<VideoDna>> {
  const user = `FILE: ${args.fileName}\nDURATION: ${args.duration.toFixed(1)}s\n\nSTORYBOARD:\n${args.storyboard}\n\nOutput the JSON object now.`
  const text = await gwChat(cfg, [{ role: 'system', content: DNA_SYSTEM }, { role: 'user', content: user }], model, 8000)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('No DNA JSON')
  const raw = JSON.parse(m[0]) as Record<string, unknown>
  const patch: Partial<VideoDna> = {}
  if (typeof raw.title === 'string' && raw.title) patch.title = raw.title
  if (typeof raw.scene === 'string' && raw.scene) patch.scene = raw.scene
  if (typeof raw.sceneDetail === 'string' && raw.sceneDetail) patch.sceneDetail = raw.sceneDetail
  if (typeof raw.environment === 'string' && raw.environment) patch.environment = raw.environment
  if (Array.isArray(raw.subjects) && raw.subjects.length) {
    patch.subjects = (raw.subjects as Record<string, unknown>[]).slice(0, 4).map((s) => ({
      name: String(s.name ?? 'Subject'),
      description: String(s.description ?? ''),
      wardrobe: String(s.wardrobe ?? ''),
      replaces: false,
    }))
  }
  if (Array.isArray(raw.timeline) && raw.timeline.length) {
    patch.timeline = (raw.timeline as Record<string, unknown>[]).slice(0, 12).map((e) => ({
      start: Number(e.start) || 0,
      end: Number(e.end) || 0,
      subject: String(e.subject ?? ''),
      camera: String(e.camera ?? ''),
    }))
  }
  if (raw.camera && typeof raw.camera === 'object') {
    const c = raw.camera as Record<string, unknown>
    patch.camera = {
      move: String(c.move ?? 'Static'),
      confidence: typeof c.confidence === 'number' ? c.confidence : 0.85,
      height: String(c.height ?? 'Eye level'),
      lensCharacter: String(c.lensCharacter ?? 'Natural perspective'),
      exactFocal: 'Uncertain — not fabricated',
      speed: String(c.speed ?? 'Natural'),
    }
  }
  if (raw.motion && typeof raw.motion === 'object') {
    const mv = raw.motion as Record<string, unknown>
    patch.motion = { subject: String(mv.subject ?? ''), camera: String(mv.camera ?? ''), relative: String(mv.relative ?? '') }
  }
  if (raw.lighting && typeof raw.lighting === 'object') {
    const l = raw.lighting as Record<string, unknown>
    patch.lighting = {
      sources: String(l.sources ?? ''), quality: String(l.quality ?? ''), temperature: String(l.temperature ?? ''),
      shadows: String(l.shadows ?? ''), highlights: String(l.highlights ?? 'Natural'), direction: String(l.direction ?? 'Ambient'),
    }
  }
  if (raw.composition && typeof raw.composition === 'object') {
    const c = raw.composition as Record<string, unknown>
    patch.composition = {
      symmetry: String(c.symmetry ?? ''), vanishingPoint: String(c.vanishingPoint ?? 'Center'), occupancy: String(c.occupancy ?? ''),
      headroom: String(c.headroom ?? ''), depthLayers: ['Foreground', 'Midground', 'Background'],
    }
  }
  if (Array.isArray(raw.style) && raw.style.length) patch.style = (raw.style as unknown[]).map(String).slice(0, 8)
  if (typeof raw.grade === 'string' && raw.grade) patch.grade = raw.grade
  if (Array.isArray(raw.continuity) && raw.continuity.length) {
    patch.continuity = (raw.continuity as Record<string, unknown>[]).slice(0, 8).map((c) => ({ label: String(c.label ?? ''), rule: String(c.rule ?? '') }))
  }
  if (Array.isArray(raw.negativeWatch) && raw.negativeWatch.length) patch.negativeWatch = (raw.negativeWatch as unknown[]).map(String).slice(0, 10)
  if (typeof raw.singleShot === 'boolean') { patch.singleShot = raw.singleShot; patch.shotCount = raw.singleShot ? 1 : Math.max(2, Number(raw.shotCount) || 2) }
  return patch
}

export function mergeDna(base: VideoDna, patch: Partial<VideoDna>): VideoDna {
  return {
    ...base,
    ...('scene' in patch && patch.scene ? { scene: patch.scene } : {}),
    ...('sceneDetail' in patch && patch.sceneDetail ? { sceneDetail: patch.sceneDetail } : {}),
    ...('environment' in patch && patch.environment ? { environment: patch.environment } : {}),
    subjects: patch.subjects?.length ? patch.subjects.map((s) => ({ ...s, replaces: false })) : base.subjects,
    timeline: patch.timeline?.length ? patch.timeline : base.timeline,
    camera: patch.camera ? { ...base.camera, ...patch.camera } : base.camera,
    subjectCamera: patch.subjectCamera || base.subjectCamera,
    motion: patch.motion ? { ...base.motion, ...patch.motion } : base.motion,
    lighting: patch.lighting ? { ...base.lighting, ...patch.lighting } : base.lighting,
    composition: patch.composition ? { ...base.composition, ...patch.composition } : base.composition,
    physics: patch.physics?.length ? patch.physics : base.physics,
    style: patch.style?.length ? patch.style : base.style,
    grade: patch.grade || base.grade,
    continuity: patch.continuity?.length ? patch.continuity : base.continuity,
    negativeWatch: patch.negativeWatch?.length ? patch.negativeWatch : base.negativeWatch,
    singleShot: patch.singleShot ?? base.singleShot,
    shotCount: patch.shotCount ?? (patch.singleShot === undefined ? base.shotCount : patch.singleShot ? 1 : Math.max(2, base.shotCount)),
    ...(patch.title ? { title: patch.title } : {}),
  }
}

// Frame extraction in the browser — no ffmpeg needed.
export async function extractFrames(video: HTMLVideoElement | string, count = 8, timeoutMs = 15000): Promise<{ t: number; dataUrl: string }[]> {
  const src = typeof video === 'string' ? video : video.src
  if (!src) return []
  const v = document.createElement('video')
  v.src = src
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'

  await new Promise<void>((res, rej) => {
    const to = setTimeout(() => rej(new Error('Video metadata timeout')), timeoutMs)
    v.onloadedmetadata = () => { clearTimeout(to); res() }
    v.onerror = () => { clearTimeout(to); rej(new Error('Video load failed')) }
  })

  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 15
  const out: { t: number; dataUrl: string }[] = []
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = Math.round((512 * (v.videoHeight || 288)) / (v.videoWidth || 512))
  const ctx = canvas.getContext('2d')

  for (let i = 0; i < count; i++) {
    const t = (dur * (i + 0.5)) / count
    await new Promise<void>((res) => {
      const to = setTimeout(res, 1200)
      v.onseeked = () => { clearTimeout(to); res() }
      v.currentTime = Math.min(t, dur - 0.05)
    })
    try { ctx?.drawImage(v, 0, 0, canvas.width, canvas.height) } catch { /* tainted frame */ }
    out.push({ t, dataUrl: canvas.toDataURL('image/jpeg', 0.62) })
  }
  return out
}

export type { Mode }
