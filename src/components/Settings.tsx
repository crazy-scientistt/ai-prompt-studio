import React, { useState } from 'react'
import { MODEL_ADAPTERS } from '../engine/models'
import { useStore } from '../store'
import { IconGear, IconShield, IconSpark } from './Icons'
import { Toggle } from './ui'

export default function Settings() {
  const { defaultModelId, setDefaultModel, credits, toast, history, assets, deepReasoning, setDeepReasoning } = useStore()
  const [clearArmed, setClearArmed] = useState(false)

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-description">The studio remembers your preferences so you rarely need to touch anything.</p>
      </div>

      <section className="glass-panel page-section">
        <h2 className="flex items-center gap-2 section-title"><IconSpark className="w-[18px] h-[18px] text-lilac" /> Your default video AI</h2>
        <p className="text-[12px] text-muted mt-1">Pre-selected everywhere. Most people set this once and never think about it again.</p>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          {MODEL_ADAPTERS.filter((m) => m.active).map((m) => (
            <button
              key={m.id}
              onClick={() => { setDefaultModel(m.id); toast(`${m.name} is now your default`, '⭐') }}
             className={`rounded-xl px-4 py-4 border text-left transition-all ${defaultModelId === m.id ? 'bg-violet-glow/12 border-violet-glow/40 shadow-glow-sm' : 'glass hover:border-white/20'}`}
            > 
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: `conic-gradient(from 20deg, ${m.accent}, #ffffff55, ${m.accent})` }}>
                  <span className="w-2.5 h-2.5 rounded-full bg-white/90" />
                </span>
                <span className="text-[13px] font-bold">{m.name}</span>
              </div>
              <div className="text-[11px] text-muted mt-2 leading-snug">{m.notes}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="glass-panel page-section">
        <h2 className="flex items-center gap-2 section-title"><IconShield className="w-[18px] h-[18px] text-lilac" /> Deep reasoning QA</h2>
        <p className="text-[12px] text-muted mt-1">After compiling, a second model pass audits the kit against the frame evidence — invented details, timing gaps, broken continuity — and repairs issues before you ever see the prompt. Strongly recommended.</p>
        <div className="mt-3 flex items-center gap-3">
          <Toggle checked={deepReasoning} onChange={(v) => { setDeepReasoning(v); toast(v ? 'Deep reasoning QA on' : 'Deep reasoning QA off', v ? '🛡️' : '⚪') }} label="Deep reasoning QA" />
          <span className="text-[13px] font-semibold">{deepReasoning ? 'On — every kit gets audited & repaired' : 'Off — faster, single-pass generation'}</span>
        </div>
        <div className="mt-2 text-[11px] text-muted">A repair pass costs 1 extra credit only when it actually fixes something.</div>
      </section>

      <section className="glass-panel page-section">
        <h2 className="flex items-center gap-2 section-title"><IconGear className="w-[18px] h-[18px] text-lilac" /> Plan & usage</h2>
        <div className="mt-3 grid sm:grid-cols-3 gap-3">
          <Stat label="Plan" value="Pro" sub="3,000 credits / month" />
          <Stat label="Credits used" value={`${credits.used}`} sub={`${credits.total - credits.used} remaining`} />
          <Stat label="Analyses run" value={`${credits.used}`} sub="1 credit = 1 full analysis" />
        </div>
        <div className="mt-3 text-[11px] text-muted">Recompiling an existing analysis for another model (Veo → Kling) costs <span className="text-ink font-semibold">0 credits</span> — the expensive part is the video analysis, not the compilation.</div>
      </section>

      <section className="glass-panel page-section">
        <h2 className="flex items-center gap-2 section-title"><IconShield className="w-[18px] h-[18px] text-lilac" /> Privacy</h2>
        <p className="text-[12px] text-muted mt-1">This build runs fully in your browser. {history.length} project{history.length === 1 ? '' : 's'} and {assets.length} asset{assets.length === 1 ? '' : 's'} are stored locally and never uploaded.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!clearArmed ? (
            <button onClick={() => setClearArmed(true)} className="glass rounded-xl px-4 py-3 text-[13px] font-semibold text-red-200 hover:border-red-400/40 transition-colors">
              Delete all local data
            </button>
          ) : (
            <>
              <button
                onClick={() => { localStorage.removeItem('ai-prompt-studio-v1'); location.reload() }}
                className="rounded-xl px-4 py-3 text-[13px] font-bold bg-red-500/80 hover:bg-red-500 transition-colors text-white"
              >
                Yes, delete everything
              </button>
              <button onClick={() => setClearArmed(false)} className="glass rounded-xl px-4 py-3 text-[13px] font-semibold">Cancel</button>
            </>
          )}
        </div>
      </section>

      <section className="glass-panel page-section">
        <h2 className="section-title">Engine</h2>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <Stat label="Analysis version" value="Video DNA 1.4" sub="temporal · camera · continuity" />
          <Stat label="Compilers" value={`${MODEL_ADAPTERS.length} active`} sub="model-specific prompt compilers" />
        </div>
        <a href="#/admin" className="mt-4 inline-flex items-center gap-2 glass rounded-xl px-4 py-3 text-[13px] font-semibold text-lilac hover:border-white/20 transition-colors">
          🛡️ Open Admin Engine Console →
        </a>
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass rounded-xl px-4 py-4">
      <div className="text-[11px] font-bold tracking-wide text-muted uppercase">{label}</div>
      <div className="text-[17px] font-extrabold mt-1">{value}</div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  )
}
