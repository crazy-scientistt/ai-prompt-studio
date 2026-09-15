import React, { useEffect, useMemo, useRef, useState } from 'react'
import { compilePrompt, kitToText, planClips, withGenLengths, type ClipMode, type ClipOptions, type CompiledPrompt, type VideoKit } from '../engine/compiler'
import { criticReviewKit, extractFrames, gwChat, gwSiteModel, gwStatus, DEFAULT_GATEWAY, DEFAULT_PROXY_MODEL, liveDnaFromStoryboard, liveKit, liveStoryboard, mergeDna } from '../engine/gateway'
import { getModel, MODEL_ADAPTERS, snapClipLength, type ModelAdapter } from '../engine/models'
import { orientMeta, type OrientMeta } from '../engine/orient'
import AspectBadge, { OrientIcon } from './AspectBadge'
import { analyzeVideo, fmtTime, type Mode, type VideoDna } from '../engine/videoDna'
import { useStore, type Asset, type HistoryItem } from '../store'
import { Btn, Dropdown, MenuItem } from './ui'
import Analysis from './Analysis'
import ModelSelect from './ModelSelect'
import VideoPlayer from './VideoPlayer'
import { IconCamera, IconCheck, IconChevron, IconCopy, IconImage, IconPlus, IconRefresh, IconSpark, IconSwap, IconTrash, IconUpload, IconVideo } from './Icons'

type Phase = 'empty' | 'ready' | 'analyzing' | 'done'
type Engine = 'gateway' | 'local'

const DEMO_VIDEOS = [
  { name: 'blue 4.mp4', url: '/test-videos/blue4.mp4', duration: 17.9, sizeMB: 35.6, orient: orientMeta(1080, 1920) },
]

interface Ref { name: string; url?: string; duration: number; sizeMB: number; orient: OrientMeta }

// Human-readable SPLIT PLAN for the live engine — how to cut the reference
// into clips the chosen model can actually generate (per-model lengths).
function buildSplitPlan(duration: number, adapter: ModelAdapter, opts: ClipOptions): string {
  const plans = withGenLengths(planClips(duration, opts), adapter)
  const lines = plans.map((p) => `- CLIP ${p.index}: source ${p.start.toFixed(1)}s–${p.end.toFixed(1)}s (${p.seconds.toFixed(1)}s window) → gen ${p.gen}s`)
  const head = opts.mode === 'fixed'
    ? `SPLIT PLAN: user requested fixed ${opts.clipLen}s clips (snapped to ${adapter.name}'s allowed lengths: ${adapter.clipLengths.join('/')}s)`
    : opts.mode === 'cuts'
      ? `SPLIT PLAN: one clip per real scene cut in the reference. The windows below are an even fallback — move boundaries to actual cuts if needed, keep the clip count and gen lengths`
      : `SPLIT PLAN: even dynamic split, each ≤10s, snapped to ${adapter.name}'s allowed lengths (${adapter.clipLengths.join('/')}s)`
  return `${head}\n${lines.join('\n')}`
}

function clipPreviewText(duration: number, adapter: ModelAdapter, opts: ClipOptions): string {
  if (opts.mode === 'cuts') {
    const n = Math.max(1, Math.ceil(duration / 10))
    return `${duration.toFixed(1)}s reference → one clip per detected scene cut (≈${n}+ clips) — the engine places boundaries at real cuts`
  }
  const plans = withGenLengths(planClips(duration, opts), adapter)
  const gens = [...new Set(plans.map((p) => p.gen))]
  return `${duration.toFixed(1)}s reference → ${plans.length} clip${plans.length === 1 ? '' : 's'} · generate ${gens.join('s + ')}s with ${adapter.name}`
}

const STAGES: { label: string; sub: string }[] = [
  { label: 'Studying camera movement…', sub: 'Estimating move, height, speed and lens character' },
  { label: 'Mapping actions and timing…', sub: 'Reconstructing what happens at every moment' },
  { label: 'Locking continuity rules…', sub: 'Face, wardrobe, environment and light behavior' },
  { label: 'Optimizing for {MODEL}…', sub: 'Compiling to the exact way this model reads prompts' },
  { label: 'Finalizing your prompt…', sub: 'Quality check against {MODEL} best practices' },
]

export default function Studio() {
  const store = useStore()
  const [phase, setPhase] = useState<Phase>('empty')
  const [ref, setRef] = useState<Ref | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | undefined>()
  const [mode, setMode] = useState<Mode>('recreate')
  const [clipMode, setClipMode] = useState<ClipMode>('auto')
  const [clipLen, setClipLen] = useState(10)
  const [modelId, setModelId] = useState(store.defaultModelId)
  const [dna, setDna] = useState<VideoDna | null>(null)
  const [result, setResult] = useState<CompiledPrompt | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const copyTimer = useRef<number>()
  const [stage, setStage] = useState(0)
  const [regenOpen, setRegenOpen] = useState(false)
  const [modelMenu, setModelMenu] = useState(false)
  const [replaceFor, setReplaceFor] = useState<string | null>(null)
  const [engine, setEngine] = useState<Engine>('local')
  const [engineNote, setEngineNote] = useState<string>('')
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [streamText, setStreamText] = useState('')
  const [streamOpen, setStreamOpen] = useState(true)
  const [kit, setKit] = useState<VideoKit | null>(null)
  // User reference attachments: saved assets or fresh uploads, with optional intent.
  interface RefAttachment { name: string; kind: string; dataUrl: string; intent: string; desc?: string; fromAsset?: boolean }
  const [refAttaches, setRefAttaches] = useState<RefAttachment[]>([])
  const [refIntentFor, setRefIntentFor] = useState<string | null>(null)
  const [refMenuOpen, setRefMenuOpen] = useState(false)
  const timers = useRef<number[]>([])
  const dnaRef = useRef<VideoDna | null>(null)
  // The history entry for the current session — kept in sync when the user
  // changes the target model, so History always reflects what's on screen.
  const historyIdRef = useRef<string | null>(null)
  const applyDna = (d: VideoDna | null) => { dnaRef.current = d; setDna(d) }
  const clipOpts: ClipOptions = { mode: clipMode, clipLen }

  // Detect the isolated Antigravity proxy; fall back to the local engine silently.
  const gatewayCfg = store.gateway ?? DEFAULT_GATEWAY
  useEffect(() => {
    let alive = true
    gwStatus(gatewayCfg).then((st) => {
      if (!alive) return
      if (st.reachable && st.connected) {
        setEngine('gateway')
        setLiveModels(st.modelIds)
        // Owner-chosen model (set on the proxy) wins for everyone.
        gwSiteModel(gatewayCfg).then((siteModel) => {
          if (!alive) return
          if (siteModel) {
            if (siteModel !== store.defaultProxyModel) store.setDefaultProxyModel(siteModel)
            return
          }
          // Otherwise auto-sync the default generation model to the live catalog.
          if (!st.modelIds.includes(store.defaultProxyModel)) {
            const best = st.modelIds.includes(DEFAULT_PROXY_MODEL) ? DEFAULT_PROXY_MODEL : st.modelIds.find((m) => m.startsWith('gemini-3')) ?? st.modelIds[0]
            store.setDefaultProxyModel(best)
          }
        })
      }
    })
    return () => { alive = false }
  }, [gatewayCfg])

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)) }, [])
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  useEffect(() => { setModelId(store.defaultModelId) }, [store.defaultModelId])

  const adapter = getModel(modelId)

  // ── Upload ────────────────────────────────────────────────────────────────
  const onFile = (f: File | null) => {
    if (!f) return
    if (!/^(video\/)/.test(f.type) && !/\.(mp4|mov|webm|avi|mkv)$/i.test(f.name)) {
      store.toast('Please choose an MP4, MOV or WebM video', '⚠️')
      return
    }
    if (f.size > 220 * 1024 * 1024) {
      store.toast('That file is too large — keep it under ~3 minutes', '⚠️')
      return
    }
    const url = URL.createObjectURL(f)
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 15
      const orient = orientMeta(probe.videoWidth || 1080, probe.videoHeight || 1920)
      setRef({ name: f.name, duration, sizeMB: f.size / (1024 * 1024), orient })
      setVideoUrl(url)
      setPhase('ready')
      setResult(null)
      applyDna(null)
      store.toast(`Detected ${orient.ratio} · ${orient.label}`, '📐')
    }
    probe.onerror = () => {
      const orient = orientMeta(1080, 1920)
      setRef({ name: f.name, duration: 15, sizeMB: f.size / (1024 * 1024), orient })
      setVideoUrl(url)
      setPhase('ready')
    }
    probe.src = url
  }

  const loadDemo = async () => {
    const d = DEMO_VIDEOS[0]
    // The demo clip ships only on dev machines (36MB, gitignored). On hosted
    // builds it's absent — say so instead of silently failing to play.
    try {
      const head = await fetch(d.url, { method: 'HEAD' })
      if (!head.ok) throw new Error(String(head.status))
    } catch {
      store.toast('Demo clip not available on this deployment — upload your own video', '📼')
      return
    }
    setRef({ name: d.name, duration: d.duration, sizeMB: d.sizeMB, orient: d.orient })
    setVideoUrl(d.url)
    setResult(null)
    applyDna(null)
    setPhase('ready')
    store.toast('Demo reference loaded — 9:16 vertical · 17.9s', '📐')
  }

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setRef(null); setVideoUrl(undefined); applyDna(null); setResult(null)
    setPhase('empty'); setMode('recreate'); setStage(0)
    historyIdRef.current = null
    setRefAttaches([]); setRefIntentFor(null); setRefMenuOpen(false)
  }

  // ── Generate: the invisible pipeline ──────────────────────────────────────
  const generate = async () => {
    if (!ref) return
    const seeded = analyzeVideo(ref.name, ref.duration, { ratio: ref.orient.ratio, kind: ref.orient.kind })
    applyDna(seeded)
    setResult(null)
    setKit(null)
    setStreamText('')
    setPhase('analyzing')
    setStage(0)
    setStreamOpen(true)

    const genModel = store.defaultProxyModel

    // Local engine: staged simulation, then compile.
    if (engine !== 'gateway' || !videoUrl) {
      const stepMs = 1150
      STAGES.forEach((_, i) => {
        timers.current.push(window.setTimeout(() => setStage(i), i * stepMs))
      })
      const total = STAGES.length * stepMs + 300
      timers.current.push(
        window.setTimeout(() => {
          const finalDna = dnaRef.current ?? seeded
          const compiled = compilePrompt(adapter, finalDna, mode, 0, clipOpts)
          setResult(compiled)
          setKit(compiled.kit ?? null)
          setPhase('done')
          store.spendCredit()
          const hid = `p-${Date.now()}`
          historyIdRef.current = hid
          store.addHistory({
            id: hid,
            title: finalDna.title,
            createdAt: Date.now(),
            modelId: adapter.id,
            mode,
            prompt: compiled.prompt,
            negative: compiled.negative,
            charCount: compiled.charCount,
            thumbnailSeed: ref.name + durationLabel(ref.duration),
            dna: finalDna,
            dnaVersion: 'dna-1.4',
            compilerVersion: adapter.compilerVersion,
          })
          store.toast(`Ready — optimized for ${adapter.name}`, '✨')
        }, total),
      )
      return
    }

    // Live engine: frames → streamed storyboard → streamed kit compile.
    try {
      setEngineNote('Extracting reference frames…')
      const frames = await extractFrames(videoUrl, 10).catch(() => [])
      setStage(1)
      const refsForEngine = refAttaches.length
        ? refAttaches.map((r) => ({ name: r.name, kind: r.kind, dataUrl: r.dataUrl, intent: r.intent.trim() || undefined, desc: r.desc?.trim() || undefined }))
        : undefined
      setEngineNote(`Antigravity · ${genModel} is watching the reference${refsForEngine ? ` + ${refsForEngine.length} attachment${refsForEngine.length === 1 ? '' : 's'}` : ''}…`)
      const storyboard = await liveStoryboard(gatewayCfg, { fileName: ref.name, duration: ref.duration, orientation: ref.orient.ratio, frames, refs: refsForEngine }, genModel, (chunk) => {
        setStreamText((s) => (s + chunk).slice(-4000))
      })
      setStage(2)
      setStreamText('')
      setEngineNote('Distilling the Video DNA…')
      try {
        const dnaPatch = await liveDnaFromStoryboard(gatewayCfg, { fileName: ref.name, duration: ref.duration, storyboard }, genModel)
        applyDna(mergeDna(seeded, dnaPatch))
      } catch (err) { console.warn('[dna] live DNA skipped:', err) /* keep seeded DNA */ }

      setEngineNote(`Compiling the clip kit with ${genModel}…`)
      const splitPlan = buildSplitPlan(ref.duration, adapter, clipOpts)
      let liveKitResult = await liveKit(
        gatewayCfg,
        { fileName: ref.name, duration: ref.duration, orientation: ref.orient.ratio, storyboard, mode, splitPlan, refs: refsForEngine },
        genModel,
        (chunk) => setStreamText((s) => (s + chunk).slice(-6000)),
      )
      setStage(4)

      // Deep reasoning: the critic audits the kit against the frames, repairs issues.
      if (store.deepReasoning) {
        setEngineNote(`${genModel} is auditing its own kit (deep reasoning)…`)
        setStreamText((s) => `${s}\n\n── PROMPT CRITIC · auditing against the frames ──\n`)
        try {
          const review = await criticReviewKit(gatewayCfg, {
            storyboard,
            splitPlan,
            kit: liveKitResult,
            model: genModel,
            refs: refsForEngine,
            onChunk: (t) => setStreamText((s) => (s + t).slice(-6000)),
          })
          if (review.verdict === 'repair' && review.kit) {
            liveKitResult = review.kit
            store.spendCredit() // repair pass costs a credit
            store.toast(`QA repaired ${review.issues.length} issue${review.issues.length === 1 ? '' : 's'} before you saw it`, '🛡️')
          }
        } catch (err) { console.warn('[critic] skipped:', err) }
      }

      setKit(liveKitResult)

      const compiled = compilePrompt(adapter, seeded, mode, 0)
      const fullText = kitToText(liveKitResult)
      const finalResult: CompiledPrompt = {
        ...compiled,
        sharedBlock: liveKitResult.sharedBlock,
        prompt: fullText,
        charCount: fullText.length,
        kit: liveKitResult,
        attachments: refAttaches.map((r) => r.name),
      }
      setResult(finalResult)
      setPhase('done')
      store.spendCredit()
      const hid = `p-${Date.now()}`
      historyIdRef.current = hid
      store.addHistory({
        id: hid,
        title: liveKitResult.videoTitle || seeded.title,
        createdAt: Date.now(),
        // The TARGET model the kit was compiled for — not the engine model
        // that wrote it. History must reflect what the user selected.
        modelId: adapter.id,
        mode,
        prompt: fullText,
        charCount: fullText.length,
        thumbnailSeed: ref.name + durationLabel(ref.duration),
        // The LIVE video DNA derived from the real frames, not the seeded guess.
        dna: dnaRef.current ?? seeded,
        dnaVersion: 'dna-2.1-livekit',
        compilerVersion: `antigravity/${genModel} → ${adapter.compilerVersion}`,
        attachments: refAttaches.map((r) => r.name),
      })
      store.toast(`Kit ready — ${liveKitResult.clips.length} clips · ${genModel}`, '✨')
      setEngineNote('')
      setStreamOpen(false)
    } catch (e) {
      // Fall back to the local engine — the beginner never sees a dead end.
      store.toast(`Live engine unavailable (${String((e as Error).message || e).slice(0, 60)}) — used local`, '⚠️')
      const finalDna = dnaRef.current ?? seeded
      const compiled = compilePrompt(adapter, finalDna, mode, 0, clipOpts)
      setResult(compiled)
      setKit(compiled.kit ?? null)
      setPhase('done')
      setEngineNote('')
    }
  }

  // Switch mode: reuse DNA, recompile, and keep the saved entry in sync.
  const switchMode = (m: Mode) => {
    setMode(m)
    if (dna && result) {
      const compiled = compilePrompt(adapter, dna, m, 0, clipOpts)
      setResult(compiled)
      const hid = historyIdRef.current
      if (hid) {
        store.updateHistory(hid, {
          mode: m,
          prompt: compiled.prompt,
          charCount: compiled.charCount,
          negative: compiled.negative,
        })
      }
    }
  }

  // Change model: reuse DNA, recompile only. Costs no analysis credit.
  const changeModel = (id: string) => {
    if (!dna) return
    setModelId(id)
    const next = getModel(id)
    const nextLen = next.clipLengths.includes(clipLen) ? clipLen : next.defaultClipLength
    if (nextLen !== clipLen) setClipLen(nextLen)
    const compiled = compilePrompt(next, dna, mode, 0, { mode: clipMode, clipLen: nextLen })
    setResult(compiled)
    setRegenOpen(false)
    // Keep the saved history entry in sync with what's now on screen.
    const hid = historyIdRef.current
    if (hid && result) {
      store.updateHistory(hid, {
        modelId: next.id,
        prompt: compiled.prompt,
        charCount: compiled.charCount,
        negative: compiled.negative,
        compilerVersion: next.compilerVersion,
      })
    }
    store.toast(`Recompiled for ${next.name} in seconds — no re-analysis`, '⚡')
  }

  const regenerate = (seed: number) => {
    if (!dna) return
    const compiled = compilePrompt(adapter, dna, mode, seed, clipOpts)
    setResult(compiled)
    setRegenOpen(false)
    store.toast('New variation ready — same DNA, fresh angle', '🔄')
  }

  const setReplacement = (subjectIdx: number, asset: Asset | null) => {
    if (!dna) return
    const subjects = dna.subjects.map((s, i) =>
      i === subjectIdx
        ? asset
          ? { ...s, replaces: true, replacementName: asset.name + (asset.dataUrl ? '' : '.png'), replacementDesc: assetDesc(asset) }
          : { ...s, replaces: false, replacementName: undefined, replacementDesc: undefined }
        : s,
    )
    setDna({ ...dna, subjects })
    dnaRef.current = { ...dna, subjects }
    if (result) setResult(compilePrompt(adapter, { ...dna, subjects }, mode, 0, clipOpts))
  }

  const copy = async () => {
    if (!result) return
    await copyText(result.prompt, `All ${result.clips.length} clip${result.clips.length === 1 ? '' : 's'} + shared block copied`)
  }

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopiedText(null), 1800)
      store.toast(msg, '📋')
    } catch { store.toast('Copy was unavailable. Select the prompt text to copy it.', '⚠️') }
  }

  const copyNegative = async () => {
    if (!result?.negative) return
    try { await navigator.clipboard.writeText(result.negative) } catch { /* clipboard unavailable */ }
    store.toast('Negative prompt copied', '📋')
  }

  const progressPct = phase === 'analyzing' ? ((stage + 1) / STAGES.length) * 100 : phase === 'done' ? 100 : 0

  return (
    <div className="page-content min-w-0 flex flex-col gap-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            Turn Any Video Into a <span className="text-ink/70">Ready-to-Use Prompt</span>
          </h1>
          <p className="page-description">Upload a reference video. We'll analyze it and generate a high-quality prompt for your AI video tool.</p>
        </div>
      </div>

      {/* ── Empty state ── */}
      {phase === 'empty' && (
        <UploadZone onFile={onFile} onDemo={loadDemo} />
      )}

      {/* ── Workspace ── */}
      {phase !== 'empty' && ref && (
        <div className="workspace">
          {/* LEFT — reference */}
          <div className="workspace-controls">
            <section className="control-section glass-panel" aria-label="Reference video">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-[.18em] text-muted">REFERENCE</span>
              <span className="h-px flex-1 bg-white/8" />
              <button onClick={reset} className="text-[12px] text-muted hover:text-ink transition-colors">Clear</button>
            </div>

            <VideoPlayer src={videoUrl} dna={dna ?? analyzeMeta(ref)} orient={ref.orient} />

            <div className="reference-file glass rounded-xl px-4 py-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
              <span className="w-9 h-9 rounded-lg bg-violet-glow/15 border border-violet-glow/25 grid place-items-center shrink-0">
                <IconVideo className="w-[18px] h-[18px] text-lilac" />
              </span>
              <div className="min-w-0 text-[13px] font-semibold truncate" title={ref.name}>{ref.name}</div>
              <label className="relative shrink-0 cursor-pointer rounded-lg h-[32px] px-3 inline-flex items-center gap-2 bg-white/[0.07] border border-white/[0.12] text-[12px] font-semibold hover:bg-white/[0.11] transition-colors duration-150">
                <IconRefresh className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Replace Video</span>
                <input type="file" aria-label="Replace video" accept="video/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              </label>
              <div className="col-span-3 flex flex-wrap items-center gap-2 min-w-0">
                <AspectBadge meta={ref.orient} />
                <span className="text-[11px] text-muted">{Math.round(ref.duration)}s · {ref.orient.w}×{ref.orient.h} · {ref.sizeMB.toFixed(1)} MB</span>
              </div>
            </div>

            </section>
            <section className="control-section glass-panel" aria-label="Generation controls">
            {/* Mode */}
            <div>
              <div className="text-[13px] font-semibold text-ink/90 mb-2">What do you want?</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <ModeCard
                  active={mode === 'recreate'}
                  onClick={() => switchMode('recreate')}
                  title="Recreate This Video"
                  desc="Get a ready-to-use prompt for this exact video."
                />
                <ModeCard
                  active={mode === 'style'}
                  onClick={() => switchMode('style')}
                  title="Reuse Style & Motion"
                  desc="Keep its camera, movement and style, but change the content."
                />
              </div>
            </div>

            {/* Style mode: replacement picker */}
            {mode === 'style' && dna && (
              <div className="glass rounded-xl p-4 animate-fade-up">
                <div className="text-[13px] font-bold">We found replaceable things</div>
                <div className="text-[11px] text-muted mt-1">Everything stays original unless you replace it.</div>
                <div className="mt-3 flex flex-col gap-2">
                  {dna.subjects.map((s, i) => (
                    <div key={i} className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold">{s.name}</span>
                        <span className={`ml-auto text-[11px] font-bold px-2 py-1 rounded-full ${s.replaces ? 'bg-violet-glow/20 text-lilac' : 'bg-white/6 text-muted'}`}>
                          {s.replaces ? `→ ${s.replacementName}` : 'Keep original'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => setReplacement(i, null)}
                          className={`text-[11px] font-semibold rounded-lg px-3 py-2 border transition-colors ${!s.replaces ? 'bg-violet-glow/20 border-violet-glow/40 text-ink' : 'bg-white/4 border-white/10 text-muted hover:text-ink'}`}
                        >
                          Keep original
                        </button>
                        <button
                          onClick={() => setReplaceFor(replaceFor === `${i}` ? null : `${i}`)}
                          className={`text-[11px] font-semibold rounded-lg px-3 py-2 border transition-colors ${s.replaces ? 'bg-violet-glow/20 border-violet-glow/40 text-ink' : 'bg-white/4 border-white/10 text-muted hover:text-ink'}`}
                        >
                          Replace →
                        </button>
                        {replaceFor === `${i}` && (
                          <span className="flex flex-wrap gap-2">
                            {store.assets.length === 0 && (
                              <span className="text-[11px] text-muted self-center">No assets yet — add one in My Assets.</span>
                            )}
                            {store.assets.slice(0, 4).map((a) => (
                              <button
                                key={a.id}
                                onClick={() => { setReplacement(i, a); setReplaceFor(null) }}
                                className="flex items-center gap-2 text-[11px] font-semibold rounded-lg pl-1 pr-3 py-1 glass hover:border-violet-glow/40"
                              >
                                <AssetThumb asset={a} />
                                {a.name}
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clip length — per-model splitting question */}
            <div>
              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                <span className="text-[13px] font-semibold text-ink/90">How should we split it into clips?</span>
                <span className="text-[11px] text-muted">{adapter.name} generates {adapter.clipLengths.join(' / ')}s clips</span>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <ModeCard active={clipMode === 'auto'} onClick={() => setClipMode('auto')} title="Auto split" desc="Even clips up to 10s — best for continuous action." />
                <ModeCard active={clipMode === 'fixed'} onClick={() => setClipMode('fixed')} title="Fixed length" desc="Every clip the exact same duration." />
                <ModeCard active={clipMode === 'cuts'} onClick={() => setClipMode('cuts')} title="At every cut" desc="One clip per scene cut in the reference." />
              </div>
              {clipMode === 'fixed' && (
                <div className="mt-3 flex flex-wrap items-center gap-2 animate-fade-up">
                  <span className="text-[11px] text-muted mr-1">Clip length:</span>
                  <div className="inline-flex rounded-lg border border-white/[0.1] bg-white/[0.04] p-1" role="radiogroup" aria-label="Clip length">
                    {adapter.clipLengths.map((l) => (
                      <button
                        key={l}
                        onClick={() => setClipLen(l)}
                        role="radio"
                        aria-checked={clipLen === l}
                        className={`h-[26px] min-w-[40px] rounded-md text-[12px] font-bold transition-[background-color,color,box-shadow] duration-150
                          ${clipLen === l ? 'bg-violet-glow text-white shadow-glow-sm' : 'text-muted hover:text-ink'}`}
                      >
                        {l}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {ref && (
                <div className="mt-2 text-[11px] text-muted">{clipPreviewText(ref.duration, adapter, clipOpts)}</div>
              )}
            </div>

            {/* Reference attachments — assets or uploads the model must use.
                Intent is optional: given, it's law; absent, the engine reasons
                the best use from the attachment and the video itself. */}
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2">
                <IconImage className="w-4 h-4 text-lilac" />
                <span className="text-[13px] font-semibold text-ink/90">Reference attachments</span>
                <span className="text-[11px] text-muted">optional</span>
                <button
                  onClick={() => setRefMenuOpen((o) => !o)}
                  aria-expanded={refMenuOpen}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-violet-glow/15 border border-violet-glow/30 px-3 py-2 text-[11px] font-bold text-ink hover:bg-violet-glow/25 transition-colors"
                >
                  <IconPlus className="w-3.5 h-3.5" /> Attach
                </button>
              </div>
              <div className="text-[11px] text-muted mt-1 leading-relaxed">
                Attach a character, product, outfit or style. Add an intent to tell the engine what to do with it — or leave it blank and it reasons the best use from the video itself.
              </div>

              {refMenuOpen && (
                <div className="mt-3 flex flex-col gap-2 animate-fade-up">
                  {store.assets.length === 0 && (
                    <div className="text-[11px] text-muted">No saved assets yet — upload an image below, or save one in My Assets for reuse.</div>
                  )}
                  {store.assets.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {store.assets.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            if (!a.dataUrl) { store.toast(`${a.name} has no image — re-add it in My Assets`, '⚠️'); return }
                            setRefAttaches((rs) => rs.some((r) => r.name === a.name) ? rs : [...rs, { name: a.name, kind: a.type, dataUrl: a.dataUrl as string, intent: '', desc: a.desc, fromAsset: true }])
                            setRefMenuOpen(false)
                            store.toast(`${a.name} attached${a.desc ? ' · your description included' : ''}`, '📎')
                          }}
                          className="flex items-center gap-2 text-[11px] font-semibold rounded-lg pl-1 pr-3 py-1 glass hover:border-violet-glow/40 transition-colors"
                        >
                          <AssetThumb asset={a} />
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="relative flex items-center justify-center gap-2 h-[34px] rounded-lg border border-dashed border-white/15 text-[12px] font-semibold text-muted hover:text-ink hover:border-white/30 transition-colors cursor-pointer">
                    <IconUpload className="w-3.5 h-3.5" /> Upload image (PNG / JPG)
                    <input
                      type="file"
                      accept="image/*"
                      aria-label="Upload reference image"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        const rd = new FileReader()
                        rd.onload = () => {
                          setRefAttaches((rs) => rs.some((r) => r.name === f.name) ? rs : [...rs, { name: f.name, kind: 'Reference', dataUrl: String(rd.result), intent: '' }])
                          setRefMenuOpen(false)
                          store.toast(`${f.name} attached`, '📎')
                        }
                        rd.readAsDataURL(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              )}

              {refAttaches.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {refAttaches.map((r) => (
                    <div key={r.name} className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={r.dataUrl} alt={r.name} className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold truncate" title={r.name}>{r.name}</div>
                          <div className="text-[11px] text-muted">{r.kind}{r.intent.trim() ? ' · intent set' : ' · engine will decide'}</div>
                        </div>
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setRefIntentFor(refIntentFor === r.name ? null : r.name)}
                            className={`text-[11px] font-semibold rounded-lg px-3 py-2 border transition-colors ${r.intent.trim() ? 'bg-violet-glow/20 border-violet-glow/40 text-ink' : 'bg-white/4 border-white/10 text-muted hover:text-ink'}`}
                          >
                            {r.intent.trim() ? 'Intent ✓' : '+ Intent'}
                          </button>
                          <button
                            onClick={() => setRefAttaches((rs) => rs.filter((x) => x.name !== r.name))}
                            aria-label={`Remove ${r.name}`}
                            className="grid place-items-center w-7 h-7 rounded-lg text-muted hover:text-red-300 hover:bg-white/[0.06] transition-colors"
                          >
                            <IconTrash className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {refIntentFor === r.name && (
                        <input
                          autoFocus
                          value={r.intent}
                          onChange={(e) => setRefAttaches((rs) => rs.map((x) => x.name === r.name ? { ...x, intent: e.target.value } : x))}
                          onKeyDown={(e) => { if (e.key === 'Enter') setRefIntentFor(null) }}
                          placeholder="e.g. Replace the main character with her — keep all her actions"
                          className="mt-2 w-full h-[32px] rounded-lg bg-white/[0.05] border border-white/10 px-3 text-[12px] text-ink placeholder:text-muted/70 outline-none focus:border-violet-glow/50 transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Model + generate */}
            <ModelSelect value={modelId} onChange={(id) => { setModelId(id); if (result) changeModel(id) }} />
            <button
              onClick={() => { void generate() }}
              disabled={phase === 'analyzing'}
              className="btn btn-primary btn-lg w-full"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {phase === 'analyzing'
                  ? <span className="w-4 h-4 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                  : <IconSpark className="w-4.5 h-4.5 w-[18px] h-[18px]" />}
                {phase === 'analyzing' ? 'Analyzing…' : 'Generate Prompt'}
              </span>
            </button>
            <div className="text-center text-[11px] text-muted">
              {engineNote || (engine === 'gateway' ? 'This will use 1 credit from your plan.' : 'This will use 1 credit · local engine (gateway offline)')}
            </div>
            </section>
          </div>

          {/* RIGHT — result */}
          <div className="workspace-results">
            {phase === 'analyzing' && (
              <>
                <PipelineOverlay stage={stage} modelName={engine === 'gateway' ? store.defaultProxyModel : adapter.name} pct={progressPct} />
              </>
            )}

            {/* LIVE ANALYSIS STREAM — visible during analysis, inspectable after */}
            {(phase === 'analyzing' || streamText) && (
              <div className="glass rounded-xl overflow-hidden">
                <button onClick={() => setStreamOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors">
                  <span className={`w-2 h-2 rounded-full ${phase === 'analyzing' ? 'bg-emerald-400 animate-bar-pulse' : 'bg-lilac/60'}`} />
                  <span className="text-[12px] font-bold">{phase === 'analyzing' ? 'Live model stream' : 'Model stream'}</span>
                  <span className="text-[11px] text-muted">{engine === 'gateway' ? `${store.defaultProxyModel} · reasoning in real time` : 'local engine'}</span>
                  <IconChevron className={`w-4 h-4 ml-auto text-muted transition-transform ${streamOpen ? 'rotate-180' : ''}`} />
                </button>
                {streamOpen && (
                  <div className="px-4 pb-3 min-w-0">
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-lilac/90 font-mono bg-black/30 rounded-xl p-3 border border-violet-glow/15">
                      {streamText || '▌ waiting for first tokens…'}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {phase === 'done' && result && dna && (
              <>
                {/* One shared result reveal, using centralized motion tokens. */}
                <div className="kit-liquid result-stack">
                  <div className="result-heading flex items-center gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-widest text-muted mb-2">Generated Prompt</div>
                    <div className="flex items-center gap-2">
                      <h2 className="section-title">Your Prompt Kit is Ready</h2>
                      <span className="w-5.5 h-5.5 w-[22px] h-[22px] rounded-full bg-emerald-400/20 border border-emerald-400/40 grid place-items-center animate-check-pop">
                        <IconCheck className="w-3.5 h-3.5 text-emerald-300" />
                      </span>
                    </div>
                    <div className="text-[12px] text-muted">
                      {kit
                        ? <>{kit.clips.length} clip{kit.clips.length === 1 ? '' : 's'} · {kit.orientation} · compiled by <span className="text-ink font-semibold">{engine === 'gateway' ? store.defaultProxyModel : 'local engine'}</span></>
                        : <>Optimized for <span className="text-ink font-semibold">{adapter.name}</span> · {result.clips.length} clip{result.clips.length === 1 ? '' : 's'} · QA {result.qa.score}%</>}
                    </div>
                  </div>
                  <div className="ml-auto text-[11px] font-semibold text-muted glass rounded-lg px-3 py-2">v{result.version}</div>
                </div>

                {/* SHARED BLOCK — reuse for every clip */}
                <div className="result-card">
                  <div className="result-card-header">
                    <span className="text-[11px] font-bold tracking-[.14em] text-lilac">SHARED BLOCK</span>
                    <span className="text-[11px] text-muted">· paste on top of every clip</span>
                    <button
                      onClick={() => copyText(result.sharedBlock, 'Shared block copied — reuse it for every clip')}
                      className="ml-auto flex items-center gap-2 rounded-lg bg-violet-glow/20 border border-violet-glow/40 px-3 py-2 text-[11px] font-bold text-ink hover:bg-violet-glow/30 transition-colors"
                      title="Copy the shared block"
                    >
                      {copiedText === result.sharedBlock ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />} <span className="min-w-[76px]">{copiedText === result.sharedBlock ? 'Copied' : 'Reuse & Copy'}</span>
                    </button>
                  </div>
                  <div className="p-4">
                    <p className="result-copy">{result.sharedBlock}</p>
                  </div>
                </div>

                {/* CLIPS — dynamic count, one copy button each */}
                <div className="kit-liquid-inner flex flex-col gap-4">
                  {(kit?.clips ?? result.clips.map((c) => ({ index: c.index, title: `Clip ${c.index}`, sourceStart: c.start, sourceEnd: c.end, body: c.prompt }))).map((c) => (
                    <div key={c.index} className="result-card">
                      <div className="result-card-header">
                        <span className="w-6 h-6 rounded-lg bg-violet-glow/20 border border-violet-glow/35 grid place-items-center text-[11px] font-extrabold text-lilac shrink-0">{c.index}</span>
                        <span className="text-[13px] font-bold truncate">{c.title}</span>
                        {typeof (c as { gen?: number }).gen === 'number' && (c as { gen?: number }).gen ? (
                          <span className="text-[11px] font-bold text-lilac bg-violet-glow/15 border border-violet-glow/30 rounded-full px-2 py-1 shrink-0">gen {(c as { gen?: number }).gen}s</span>
                        ) : null}
                        <span className="text-[11px] text-muted tabular-nums shrink-0">{(c.sourceEnd - c.sourceStart).toFixed(1)}s · {fmtTime(c.sourceStart)}–{fmtTime(c.sourceEnd)}</span>
                        <button
                          onClick={() => copyText(`${result.sharedBlock}\n\n${c.body}`, `Clip ${c.index} + shared block copied`)}
                          className="ml-auto flex items-center gap-2 rounded-lg bg-white/8 border border-white/12 px-3 py-2 text-[11px] font-bold hover:bg-white/14 hover:border-white/20 transition-colors shrink-0"
                          title={`Copy clip ${c.index} with the shared block`}
                        >
                          {copiedText === `${result.sharedBlock}\n\n${c.body}` ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />} <span className="min-w-[56px]">{copiedText === `${result.sharedBlock}\n\n${c.body}` ? 'Copied' : 'Copy clip'}</span>
                        </button>
                      </div>
                      <div className="p-4">
                        <p className="result-copy">{c.body}</p>
                        {kit && typeof (c as { voiceover?: string }).voiceover === 'string' && (c as { voiceover?: string }).voiceover && (
                          <div className="mt-2 pt-2 border-t border-white/8">
                            <div className="text-[11px] font-bold tracking-wide text-lilac/80 mb-1">VOICEOVER</div>
                            <p className="text-[12px] italic text-muted">“{(c as { voiceover?: string }).voiceover as string}”</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {kit && (
                  <button
                    onClick={() => copyText(kitToText(kit), 'Full kit copied — shared block + all clips')}
                    className="self-start text-[11px] font-semibold text-muted hover:text-ink underline underline-offset-4 decoration-white/20 transition-colors"
                  >
                    Copy as markdown (kit file)
                  </button>
                )}

                {result.negative && (
                  <div className="glass rounded-xl px-4 py-3">
                    <div className="text-[11px] font-bold tracking-wide text-muted mb-1">NEGATIVE PROMPT — {adapter.name} supports this</div>
                    <p className="text-[12px] leading-relaxed text-muted">{result.negative}</p>
                  </div>
                )}

                {result.attachments.length > 0 && (
                  <div className="glass rounded-xl px-4 py-3 flex items-center gap-2 text-[12px] text-muted">
                    <IconImage className="w-4 h-4 text-lilac" />
                    Also attach: {result.attachments.join(', ')} — text alone can't carry pixels across tools.
                  </div>
                )}

                <div className="result-actions">
                  <Btn variant="primary" size="lg" onClick={copy} className="w-full">
                    {copiedText === result.prompt ? <IconCheck className="w-[18px] h-[18px]" /> : <IconCopy className="w-[18px] h-[18px]" />} <span aria-live="polite" className="min-w-[56px]">{copiedText === result.prompt ? 'Copied' : 'Copy All'}</span>
                  </Btn>
                  <Dropdown
                    side="top"
                    align="start"
                    width={260}
                    trigger={({ open, toggle }) => (
                      <Btn variant="secondary" className="w-full" aria-expanded={open} onClick={toggle}>
                        <IconRefresh className="w-4 h-4" /> Regenerate <IconChevron className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                      </Btn>
                    )}
                  >
                    {(close) => (
                      <>
                        {[
                          { label: 'More accurate to reference', seed: 1 },
                          { label: 'Stronger camera instructions', seed: 2 },
                          { label: 'Stronger motion', seed: 3 },
                          { label: 'More concise', seed: 4 },
                          { label: 'Generate again', seed: 5 },
                        ].map((o) => (
                          <MenuItem key={o.seed} onClick={() => { regenerate(o.seed); close() }}>
                            <IconSpark className="w-3.5 h-3.5 text-lilac shrink-0" /> {o.label}
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </Dropdown>
                  <Dropdown
                    side="top"
                    align="end"
                    width={260}
                    trigger={({ open, toggle }) => (
                      <Btn variant="secondary" className="w-full" aria-expanded={open} onClick={toggle}>
                        <IconSwap className="w-4 h-4" /> Change Model <IconChevron className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                      </Btn>
                    )}
                  >
                    {(close) => (
                      <>
                        {MODEL_ADAPTERS.filter((m) => m.active && m.id !== adapter.id).map((m) => (
                          <MenuItem key={m.id} onClick={() => { changeModel(m.id); close() }}>
                            <span className="w-[18px] h-[18px] rounded-full grid place-items-center shrink-0" style={{ background: `conic-gradient(from 20deg, ${m.accent}, #ffffff55, ${m.accent})` }}>
                              <span className="w-2 h-2 rounded-full bg-white/90" />
                            </span>
                            <span className="truncate">{m.name}</span>
                            <span className="ml-auto text-[11px] text-muted shrink-0">instant</span>
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </Dropdown>
                </div>

                <Analysis dna={dna} />
                </div>
              </>
            )}

            {phase === 'ready' && (
              <EmptyResult mode={mode} modelName={adapter.name} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function UploadZone({ onFile, onDemo }: { onFile: (f: File | null) => void; onDemo: () => void }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0] ?? null) }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click() } }}
      role="button"
      tabIndex={0}
      aria-label="Upload a reference video"
      className={`relative rounded-xl border border-dashed cursor-pointer flex flex-col items-center justify-center gap-4 py-14 sm:py-20 px-6 text-center
        backdrop-blur-md bg-white/[0.03]
        transition-[border-color,background-color,box-shadow] duration-200 ease-out
        ${drag ? 'border-violet-glow/70 bg-violet-glow/[0.07] shadow-glow-sm' : 'border-white/[0.16] hover:border-violet-glow/45 hover:bg-white/[0.05]'}`}
    >
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br from-violet-glow/30 to-violet-deep/20 border border-violet-glow/30 grid place-items-center transition-transform duration-200 ${drag ? 'scale-105' : ''}`}>
        <IconUpload className="w-6 h-6 text-lilac" />
      </div>
      <div>
        <div className="text-[17px] font-extrabold tracking-tight">Upload Video</div>
        <div className="text-[12px] text-muted mt-1">MP4, MOV, WebM · up to 3 minutes · or drag & drop</div>
      </div>
      <span className="rounded-xl h-[40px] px-4 inline-flex items-center text-[13px] font-semibold text-lilac bg-violet-glow/15 border border-violet-glow/30">Choose a file</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDemo() }}
        className="text-[12px] text-muted hover:text-ink underline underline-offset-4 decoration-white/20 transition-colors"
      >
        No video handy? Try a 15-second demo reference
      </button>
      <div className="text-center text-[11px] text-muted mt-4 max-w-lg">
        Your video stays on your device in this demo build — analysis never leaves the browser.
      </div>
    </div>
  )
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`flex flex-col items-start text-left rounded-xl px-3 py-3 border transition-[border-color,background-color,box-shadow] duration-150 ease-out
        active:scale-[0.99]
        ${active ? 'bg-violet-glow/[0.14] border-violet-glow/50 shadow-glow-sm' : 'bg-white/[0.04] border-white/[0.1] hover:border-white/[0.22] hover:bg-white/[0.06]'}`}
    >
      <div className="text-[13px] font-bold">{title}</div>
      <div className="text-[12px] text-muted mt-1 leading-relaxed">{desc}</div>
    </button>
  )
}

function PipelineOverlay({ stage, modelName, pct }: { stage: number; modelName: string; pct: number }) {
  return (
    <div className="result-placeholder w-full flex flex-col gap-5 animate-fade-up">
      <div className="relative w-8 h-8 self-center">
        <div className="absolute inset-0 rounded-full border-[1.5px] border-white/8" />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-violet-glow border-r-lilac animate-spin" style={{ animationDuration: '1.6s' }} />
        <div className="absolute inset-1.5 rounded-full bg-violet-glow/10" />
        <div className="absolute inset-0 grid place-items-center"><IconSpark className="w-3.5 h-3.5 text-lilac" /></div>
      </div>
      <div className="text-center">
        <div className="text-[15px] font-bold">{STAGES[Math.min(stage, STAGES.length - 1)].label.replace('{MODEL}', modelName)}</div>
        <div className="text-[12px] text-muted mt-1">{STAGES[Math.min(stage, STAGES.length - 1)].sub.replace('{MODEL}', modelName)}</div>
      </div>
      <div className="w-full max-w-sm self-center h-1 rounded-full bg-white/8 overflow-hidden" role="progressbar" aria-label="Prompt generation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-gradient-to-r from-lilac to-violet-glow transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-col gap-2 w-full max-w-sm self-center">
        {STAGES.map((s, i) => (
          <div key={i} className={`flex items-center gap-2 text-[12px] transition-colors ${i < stage ? 'text-emerald-300/80' : i === stage ? 'text-ink font-semibold' : 'text-muted/60'}`}>
            <span className={`w-4 h-4 rounded-full grid place-items-center border ${i < stage ? 'border-emerald-400/50 bg-emerald-400/15' : i === stage ? 'border-violet-glow/60 bg-violet-glow/15' : 'border-white/10'}`}>
              {i < stage ? <IconCheck className="w-2.5 h-2.5" /> : i === stage ? <span className="w-1.5 h-1.5 rounded-full bg-violet-glow animate-pulse" /> : null}
            </span>
            {s.label.replace('{MODEL}', modelName)}
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyResult({ mode, modelName }: { mode: Mode; modelName: string }) {
  return (
    <div className="result-placeholder flex flex-col items-center justify-center gap-3 text-center py-10">
      <div className="w-14 h-14 rounded-xl glass grid place-items-center"><IconSpark className="w-6 h-6 text-lilac" /></div>
      <div className="text-[15px] font-bold">Your prompt will appear here</div>
      <p className="text-[13px] text-muted max-w-xs leading-relaxed">
        {mode === 'recreate'
          ? `Hit Generate and we'll reconstruct this exact video — camera, timing, lighting, physics — as a ready-to-paste ${modelName} prompt.`
          : `Hit Generate and we'll extract this video's camera, movement and style so you can swap in your own character, product or world.`}
      </p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted/80">
        <IconChevron className="w-3.5 h-3.5" /> analysis → Video DNA → {modelName} compiler → QA
      </div>
    </div>
  )
}

function AssetThumb({ asset }: { asset: Asset }) {
  return asset.dataUrl
    ? <img src={asset.dataUrl} alt={asset.name} className="w-5 h-5 rounded-md object-cover border border-white/15" />
    : <span className="w-5 h-5 rounded-md grid place-items-center text-[9px] font-bold text-white" style={{ background: seedColor(asset.seed) }}>{asset.name.slice(0, 1).toUpperCase()}</span>
}

// deterministic pastel from string — shared by thumbnails
export function seedColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 300
  return `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 300} 70% 45%))`
}

function assetDesc(a: Asset): string {
  // The user's own description is ground truth — given to the model verbatim.
  if (a.desc && a.desc.trim()) return a.desc.trim()
  const map: Record<string, string> = {
    Character: 'a character matching the attached reference image',
    Product: 'a product matching the attached reference image, with exact shape, logo placement and color preserved',
    Vehicle: 'a vehicle matching the attached reference image, exact body design and color preserved',
    Location: 'an environment matching the attached reference image',
    Outfit: 'an outfit matching the attached reference image, identical fit and color',
    Prop: 'a prop matching the attached reference image',
    Style: 'the attached visual style reference, matched in grade, grain and contrast',
    Logo: 'the attached logo reproduced exactly, undistorted',
  }
  return map[a.type] ?? 'the attached reference image reproduced faithfully'
}

function analyzeMeta(ref: Ref): VideoDna {
  return analyzeVideo(ref.name, ref.duration)
}

function durationLabel(d: number) {
  return `-${Math.round(d)}s`
}
