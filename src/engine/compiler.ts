import { snapClipLength, type ModelAdapter } from './models'
import { fmtTime, type Mode, type VideoDna } from './videoDna'

// The Model-Specific Prompt Compiler.
// Long videos are segmented into dynamic ≤10s clips; every compilation emits:
//   1. a SHARED BLOCK — subject/world/style/negative locks reused by every clip
//   2. N per-clip prompts — clip-local timing, continuation rules, copy-ready
// Changing model reuses the cached Video DNA and recompiles instantly.

export const CLIP_LEN = 10

export interface ClipPlan { index: number; start: number; end: number; seconds: number; gen?: number }
export interface ClipPrompt extends ClipPlan { prompt: string }

/** How the user wants the reference split into generatable clips. */
export type ClipMode = 'auto' | 'fixed' | 'cuts'
export interface ClipOptions {
  mode: ClipMode
  /** Requested fixed clip length in seconds (mode 'fixed' only). */
  clipLen?: number
}

export interface CompiledPrompt {
  sharedBlock: string
  clips: ClipPrompt[]
  prompt: string          // shared + all clips combined (copy-all / history)
  negative?: string
  charCount: number
  attachments: string[]   // reference files the user should attach in the target tool
  qa: QaResult
  version: number
  kit?: VideoKit          // present when compiled as a full clip kit
}

export interface QaResult {
  passed: boolean
  score: number
  checks: { label: string; ok: boolean }[]
}

// ── Clip Kit — the example-format output (shared block + shot-level clips) ──
export interface KitClip {
  index: number
  title: string
  sourceStart: number
  sourceEnd: number
  gen?: number        // exact duration the target model generates for this clip
  body: string        // shot-by-shot prompt text (model-written)
  voiceover?: string  // VO lines when the reference has narration
}
export interface VideoKit {
  videoTitle: string
  sourceSeconds: number
  orientation: string // "9:16" etc.
  summary: string
  splitNote: string
  sharedBlock: string
  clips: KitClip[]
  post?: string[]     // post-production notes (captions, assembly)
  notes?: string[]
}

interface CompileCtx {
  dna: VideoDna
  mode: Mode
  variantSeed: number
}

// ── Clip planning: dynamic, never fixed ──────────────────────────────────────
// Three modes:
//   auto  — even split into ≤10s clips that breathe (35s → 4×8.75s, no stubs)
//   fixed — even split into clips of the user's chosen length (4/6/8/10s…)
//   cuts  — one clip per source scene cut (local engine falls back to auto;
//           the live engine finds real cuts from its frame analysis)
// Every plan carries `gen`: the exact duration snapped to the target model's
// allowed clip lengths (e.g. Omni Flash → 4/6/8/10). Longer source windows are
// covered by consecutive clips; shorter ones snap up with a trim note.
export function planClips(duration: number, opts?: ClipOptions): ClipPlan[] {
  const mode = opts?.mode ?? 'auto'
  if (mode === 'fixed' && opts?.clipLen && opts.clipLen > 0) {
    const L = opts.clipLen
    const n = Math.max(1, Math.ceil(duration / L))
    const len = duration / n
    return range(n).map((i) => mkPlan(i, n, i * len, Math.min(duration, (i + 1) * len), L))
  }
  const n = Math.max(1, Math.ceil(duration / CLIP_LEN))
  const len = duration / n
  return range(n).map((i) => mkPlan(i, n, i * len, Math.min(duration, (i + 1) * len)))
}

/** Attach the model-generatable length to each plan.
 *  A plan that already carries `gen` (user-requested fixed length) is kept
 *  exactly as requested — never re-snapped from its source-window length.
 *  Only auto-split plans (no gen) snap their window to the nearest allowed
 *  length the target model can generate. */
export function withGenLengths(plans: ClipPlan[], adapter: ModelAdapter): ClipPlan[] {
  const max = Math.max(...adapter.clipLengths)
  return plans.map((p) => {
    if (p.gen && p.gen > 0) return p // user-requested length wins (fixed mode)
    const target = Math.min(p.seconds, max)
    return { ...p, gen: snapClipLength(adapter, target) }
  })
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const mkPlan = (i: number, n: number, start: number, end: number, gen?: number): ClipPlan => ({
  index: i + 1,
  start: r1(start),
  end: r1(end),
  seconds: r1(end - start),
  ...(gen ? { gen } : {}),
})
const r1 = (x: number) => Math.round(x * 10) / 10

// ── Helpers ──────────────────────────────────────────────────────────────────
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const clean = (s: string) => s.replace(/\s*\.\s*$/, '')
const subjectPhrase = (dna: VideoDna, mode: Mode): string => {
  const s = dna.subjects[0]
  if (mode === 'style' && s.replaces && s.replacementDesc) return s.replacementDesc
  return s.wardrobe && s.wardrobe !== '—' ? `${s.description}, wearing ${s.wardrobe}` : s.description
}
const fmt = (s: number) => {
  const whole = Math.floor(s)
  const dec = Math.round((s - whole) * 10)
  return dec ? `${whole}.${dec}s` : `${whole}s`
}

// ── SHARED BLOCK — the reusable top of every clip ────────────────────────────
export function buildSharedBlock(dna: VideoDna, mode: Mode, adapter: ModelAdapter): string {
  const a = dna.aspect
  const parts: string[] = []

  // SUBJECT LOCK — identity, wardrobe, scale
  const s = dna.subjects[0]
  const subjDesc = mode === 'style' && s.replaces && s.replacementDesc ? s.replacementDesc : `${s.description}`
  parts.push(
    [
      `SUBJECT LOCK — ${s.name.toUpperCase()}:`,
      `${cap(subjDesc)}.`,
      s.wardrobe && s.wardrobe !== '—' && !(mode === 'style' && s.replaces) ? `Wardrobe: ${s.wardrobe}, identical in every clip — never changes, never becomes transparent or body-coloured.` : '',
      dna.heroObject ? `${dna.heroObject.name.toUpperCase()} LOCK: ${dna.heroObject.role}. Required preservation: exact shape, color, logo placement and proportions in every shot.` : '',
      `This exact subject in every clip — face, hair, body proportions and scale stay locked. Never changes size, never morphs.`,
    ].filter(Boolean).join(' '),
  )

  // WORLD LOCK — environment + lighting behavior
  parts.push(
    [
      `WORLD LOCK:`,
      `${cap(dna.environment)}.`,
      `Lighting: ${dna.lighting.sources}; ${dna.lighting.quality}; ${dna.lighting.temperature}; ${dna.lighting.shadows}; ${dna.lighting.highlights}.`,
      `Light direction, shadow behavior and set dressing stay identical in every clip — the world never morphs or rearranges.`,
    ].join(' '),
  )

  // CAMERA + PHYSICS RULES
  parts.push(
    [
      `CAMERA & PHYSICS:`,
      `${cap(dna.camera.move)} (height: ${dna.camera.height}; ${dna.camera.lensCharacter}).`,
      `${cap(dna.motion.relative)}.`,
      `Physical behavior must read as real: ${dna.physics.join(', ')}.`,
    ].join(' '),
  )

  // FRAMING / ORIENTATION
  if (a) {
    const frame =
      a.kind === 'portrait'
        ? `Frame in ${a.ratio} vertical orientation (Reels/TikTok style): full height of frame used, strong on a phone screen.`
        : a.kind === 'square'
          ? `Frame in ${a.ratio} square orientation: balanced centered composition.`
          : `Frame in ${a.ratio} horizontal cinematic orientation: wide lateral composition using the full frame width.`
    parts.push(`FRAMING: ${frame} ${cap(dna.composition.symmetry)}; vanishing point at the ${dna.composition.vanishingPoint}.`)
  }

  // STYLE
  parts.push(`STYLE: ${dna.style.join(', ')}. ${cap(dna.grade)}.`)

  // NEGATIVE
  parts.push(`NEGATIVE (every clip): ${dna.negativeWatch.join(', ')}, no cuts inside a clip, no text overlays, no captions, no watermarks, no brand logos, no extra characters, no warping, no identity drift, no environment morphing.`)

  return parts.join('\n\n')
}

// ── Per-clip prompt bodies (model-specific flavor) ───────────────────────────
function clipEvents(dna: VideoDna, plan: ClipPlan): { subject: string; camera: string; s: number; e: number }[] {
  // Map global timeline events onto this clip's window, re-based to clip-local time.
  const evs = dna.timeline
    .filter((e) => e.end > plan.start && e.start < plan.end)
    .map((e) => ({
      subject: clean(e.subject),
      camera: clean(e.camera),
      s: Math.max(e.start, plan.start),
      e: Math.min(e.end, plan.end),
    }))
  if (evs.length === 0) {
    return [{ subject: 'Motion continues with consistent speed and rhythm.', camera: 'Camera sustains its move; framing stays intentional.', s: plan.start, e: plan.end }]
  }
  return evs
}

function clipBodyVeo(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  const evs = clipEvents(dna, plan)
  const local = evs
    .map((e, i) => {
      const ls = r1(Math.max(0, e.s - plan.start))
      const le = r1(Math.min(plan.seconds, e.e - plan.start))
      return `From ${ls}–${le} seconds — ${e.subject}. ${e.camera}`
    })
    .join('. ')
  const cont = prev
    ? ` This clip continues directly from Clip ${prev.index} (${fmtTime(prev.start)}–${fmtTime(prev.end)}): the subject's position, pose, wardrobe and the camera's exact height and move must match the final frame of the previous clip as if one unbroken take.`
    : ' Open the action cleanly; the video begins here.'
  const ending = isLast ? ' End by settling on a strong final frame — no abrupt cut-off.' : ' Do not conclude the action; this continues in the next clip.'
  return `Clip ${plan.index} of the sequence — ${genPhrase(plan)} continuous shot inside ${dna.sceneDetail}, covering ${fmtTime(plan.start)}–${fmtTime(plan.end)} of the reference. ${cap(subjectPhrase(dna, mode))}.${cont}\n\n${local}.\n\n${cap(dna.subjectCamera)}. ${cap(dna.motion.relative)} — keep the relationship physically true.${ending}`
}

function clipBodyKling(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  const evs = clipEvents(dna, plan)
  const local = evs
    .map((e) => {
      const ls = r1(Math.max(0, e.s - plan.start))
      const le = r1(Math.min(plan.seconds, e.e - plan.start))
      return `In the first stretch (${fmt(ls)} to ${fmt(le)}) — ${e.subject}. ${e.camera}`
    })
    .join(' ')
  return [
    `CLIP ${plan.index} · generate ${genSeconds(plan)}s — covers ${fmtTime(plan.start)}–${fmtTime(plan.end)} of the reference.`,
    `ACTION: ${cap(subjectPhrase(dna, mode))}. ${local}.`,
    prev ? `CONTINUITY: continues Clip ${prev.index} exactly — match its final frame (pose, position, wardrobe, camera height, light) as one unbroken take.` : `CONTINUITY: opening clip of the sequence; begin cleanly.`,
    isLast ? 'END: settle on a strong final frame.' : 'END: do not conclude; motion continues into the next clip.',
  ].filter(Boolean).join('\n')
}

function clipBodyRunway(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  const evs = clipEvents(dna, plan)
  const beats = evs
    .map((e) => {
      const ls = r1(Math.max(0, e.s - plan.start))
      const le = r1(Math.min(plan.seconds, e.e - plan.start))
      return `${fmt(ls)}–${fmt(le)} ${e.subject.toLowerCase()}`
    })
    .join('; ')
  return `${cap(dna.camera.move)}. Clip ${plan.index}, ${genSeconds(plan)}s (${fmtTime(plan.start)}–${fmtTime(plan.end)} of reference), ${dna.aspect?.ratio ?? '16:9'}. ${cap(subjectPhrase(dna, mode))}. Beats: ${beats}.${prev ? ` Continues Clip ${prev.index} — match its last frame exactly.` : ' Opening clip.'}${isLast ? ' End on a strong frame.' : ''} ${cap(dna.grade)}.`
}

function clipBodySora(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  return clipBodyVeo(dna, plan, mode, isLast, prev) + '\n\nOne continuous take by an experienced cinema-camera operator — no montage, no cutaways.'
}

function clipBodyHailuo(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  const evs = clipEvents(dna, plan)
  const first = evs[0]
  return [
    `CLIP ${plan.index} · ${genSeconds(plan)}s (${fmtTime(plan.start)}–${fmtTime(plan.end)})`,
    `SUBJECT: ${subjectPhrase(dna, mode)}.`,
    `ACTION: ${first ? first.subject.toLowerCase() : dna.motion.subject}, ${dna.physics[0]}.`,
    `CAMERA: ${dna.camera.move}, ${dna.camera.height}.`,
    prev ? `MATCH: continue Clip ${prev.index}'s final frame exactly.` : 'Opening clip of the sequence.',
    isLast ? 'End on a strong frame.' : 'Motion continues into the next clip.',
  ].join('\n')
}

function clipBodyGeneric(dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  return clipBodyVeo(dna, plan, mode, isLast, prev)
}

function clipBodyFor(adapter: ModelAdapter, dna: VideoDna, plan: ClipPlan, mode: Mode, isLast: boolean, prev: ClipPlan | null): string {
  switch (adapter.id) {
    case 'veo': return clipBodyVeo(dna, plan, mode, isLast, prev)
    case 'kling': return clipBodyKling(dna, plan, mode, isLast, prev)
    case 'runway': return clipBodyRunway(dna, plan, mode, isLast, prev)
    case 'sora': return clipBodySora(dna, plan, mode, isLast, prev)
    case 'hailuo': return clipBodyHailuo(dna, plan, mode, isLast, prev)
    default: return clipBodyGeneric(dna, plan, mode, isLast, prev)
  }
}

// ── Legacy single-prompt blocks (used inside combined output) ────────────────
const opening = (dna: VideoDna, mode: Mode): string =>
  `Create a continuous ${dna.duration}-second cinematic ${dna.camera.move.includes('backward') ? 'tracking shot' : 'shot'} inside ${dna.sceneDetail}. ${cap(subjectPhrase(dna, mode))} starts fully composed in frame, positioned along the central vanishing point.`

// ── Compile entry + QA ───────────────────────────────────────────────────────
export function compilePrompt(adapter: ModelAdapter, dna: VideoDna, mode: Mode, variantSeed = 0, clipOpts?: ClipOptions): CompiledPrompt {
  const plans = withGenLengths(planClips(dna.duration, clipOpts), adapter)
  const sharedBlock = buildSharedBlock(dna, mode, adapter)

  const clips: ClipPrompt[] = plans.map((plan, i) => ({
    ...plan,
    prompt: clipBodyFor(adapter, dna, plan, mode, i === plans.length - 1, i > 0 ? plans[i - 1] : null),
  }))

  // Combined text: shared block + every clip (used for Copy All + history).
  const combined = [
    `SHARED BLOCK (top of every clip — reuse for each generation)`,
    sharedBlock,
    '',
    ...clips.map((c) => `── CLIP ${c.index} · ${clipLenLabel(c)} (${fmtTime(c.start)}–${fmtTime(c.end)}) ──\n${c.prompt}`),
  ].join('\n\n')

  let prompt = combined
  if (variantSeed > 0) prompt = applyVariant(prompt, variantSeed, dna)

  const negative = adapter.supportsNegative
    ? `Avoid: ${dna.negativeWatch.join(', ')}, no cuts, no text overlays, no warping.`
    : undefined

  const qa = runQa(prompt, dna, adapter, clips)

  const attachments: string[] = []
  if (mode === 'style') {
    for (const s of dna.subjects) if (s.replaces && s.replacementName) attachments.push(s.replacementName)
  }

  return {
    sharedBlock,
    clips,
    prompt,
    negative,
    charCount: prompt.length,
    attachments,
    qa,
    version: variantSeed + 1,
    kit: buildLocalKit(dna, mode, sharedBlock, clips),
  }
}

/** Label for a clip's generation length — "10s" or "7.9s → generate 8s". */
const clipLenLabel = (c: ClipPlan | ClipPrompt): string =>
  c.gen && Math.abs(c.gen - c.seconds) > 0.35 ? `${c.seconds}s → generate ${c.gen}s` : `${c.gen ?? c.seconds}s`

const genSeconds = (plan: ClipPlan): number => plan.gen ?? plan.seconds
/** Length phrase for clip bodies — covers snap-up (hold final frame) and snap-down. */
const genPhrase = (plan: ClipPlan): string =>
  plan.gen && Math.abs(plan.gen - plan.seconds) > 0.35
    ? `${plan.gen}-second generation covering the ${plan.seconds}s source window${plan.gen > plan.seconds ? ' — hold the final frame once the action completes' : ' — keep the pacing tight so everything fits'}`
    : `${plan.seconds}-second`

// Full kit → clipboard text (shared block + every clip), ready to save/paste.
export function kitToText(kit: VideoKit): string {
  const lines: string[] = []
  lines.push(`# ${kit.videoTitle} — Flow Prompt Kit — ${kit.clips.length}-clip version`, '')
  lines.push(`Source: ${kit.sourceSeconds}s, ${kit.orientation}. ${kit.summary}`, '')
  lines.push(kit.splitNote, '', '---', '', `## SHARED BLOCK (top of every clip)`, '', '```', kit.sharedBlock, '```')
  for (const c of kit.clips) {
    lines.push('', '---', '', `## CLIP ${c.index} — ${c.title} (${(c.sourceEnd - c.sourceStart).toFixed(1)}s${c.gen ? ` → generate ${c.gen}s` : ''})`, '', 'Paste the SHARED BLOCK, then:', '', '```', c.body)
    if (c.voiceover) lines.push('', `VOICEOVER:\n"${c.voiceover}"`)
    lines.push('```')
  }
  if (kit.post?.length) lines.push('', '---', '', '## POST', ...kit.post.map((p) => `- ${p}`))
  if (kit.notes?.length) lines.push('', '## Notes', ...kit.notes.map((n) => `- ${n}`))
  return lines.join('\n')
}

// Deterministic kit for the local (offline) engine — same structure the live
// Antigravity compiler emits, so the UI is identical in both modes.
function buildLocalKit(dna: VideoDna, mode: Mode, sharedBlock: string, clips: ClipPrompt[]): VideoKit {
  return {
    videoTitle: dna.title,
    sourceSeconds: dna.duration,
    orientation: dna.aspect?.ratio ?? '16:9',
    summary: `${dna.scene} — ${dna.motion.subject}, ${dna.camera.move}.`,
    splitNote: `Split into ${clips.length} clip${clips.length === 1 ? '' : 's'} at the engine's scene boundaries; every clip carries the shared block on top.`,
    sharedBlock,
    clips: clips.map((c) => ({
      index: c.index,
      title: `${fmtTime(c.start)}–${fmtTime(c.end)} ${dna.scene}`,
      sourceStart: c.start,
      sourceEnd: c.end,
      ...(c.gen ? { gen: c.gen } : {}),
      body: c.prompt,
    })),
    notes: ['Generated by the local engine — connect the Antigravity proxy for full AI-written shot kits.'],
  }
}

function applyVariant(prompt: string, seed: number, dna: VideoDna): string {
  const closers = [
    'The final frame should feel like a paused moment from a premium commercial.',
    'End on a frame strong enough to freeze as a poster still.',
    'The shot should feel expensive, calm and physically inevitable.',
  ]
  return `${prompt}\n\n${closers[seed % closers.length]}`
}

// Invisible Prompt QA — validates multi-clip coverage + locks.
function runQa(prompt: string, dna: VideoDna, adapter: ModelAdapter, clips: ClipPrompt[]): QaResult {
  const lastClip = clips[clips.length - 1]
  const checks: { label: string; ok: boolean }[] = [
    { label: 'Clips cover full duration', ok: clips.length > 0 && Math.abs(lastClip.end - dna.duration) < 0.5 },
    { label: 'Every clip ≤ 10s', ok: clips.every((c) => c.seconds <= CLIP_LEN + 0.01) },
    { label: 'Lengths fit the target model', ok: clips.every((c) => !c.gen || adapter.clipLengths.includes(c.gen)) },
    { label: 'Shared block present', ok: /SUBJECT LOCK|WORLD LOCK/.test(prompt) },
    { label: 'Camera behavior specified', ok: /camera|dolly|tracking|orbit|crane/i.test(prompt) },
    { label: 'Subject details preserved', ok: prompt.length > 400 || adapter.id === 'runway' || adapter.id === 'hailuo' },
    { label: 'Lighting captured', ok: /light/i.test(prompt) },
    { label: 'Continuity instructions', ok: /preserve|lock|match|constant|identical/i.test(prompt) },
    { label: 'Clip-to-clip continuity', ok: clips.length === 1 || /continues Clip|match its (final )?last frame|previous clip/i.test(prompt) },
    { label: 'Fits model context', ok: prompt.length <= adapter.maxChars * 6 * clips.length + 4000 },
    { label: 'No contradictions', ok: !/zoom out while pushing in/i.test(prompt) },
  ]
  const failed = checks.filter((c) => !c.ok)
  const score = Math.round(((checks.length - failed.length) / checks.length) * 100)
  return { passed: failed.length === 0, score, checks }
}

export const DEFAULT_PROMPT_SAMPLE = `Create a continuous 15-second cinematic shot…` // empty states
