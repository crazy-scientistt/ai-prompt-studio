import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus } from './ui'
import { MODEL_ADAPTERS } from '../engine/models'
import { useStore } from '../store'
import { IconLogo } from './Icons'

export default function Onboarding() {
  const { setOnboarded, setDefaultModel } = useStore()
  const [picked, setPicked] = useState('veo')
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogFocus(true, panelRef)

  const go = () => {
    setDefaultModel(picked)
    setOnboarded(true)
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-night/80 p-4" role="dialog" aria-modal="true" aria-label="Welcome">
      <div ref={panelRef} tabIndex={-1} className="glass-pop rounded-xl p-6 max-w-lg w-full max-h-[calc(100dvh-32px)] overflow-y-auto animate-pop text-center">
        <div className="flex justify-center"><IconLogo className="w-11 h-11" /></div>
        <h1 className="mt-4 text-[21px] font-extrabold tracking-tight">Welcome to AI Prompt Studio</h1>
        <p className="text-muted text-[13px] mt-2">You bring the video. We figure out how to prompt it.</p>

        <div className="mt-6 text-left">
          <div className="text-[13px] font-bold mb-3">Which AI video tool do you normally use?</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MODEL_ADAPTERS.filter((m) => m.active).map((m) => (
              <button
                key={m.id}
                onClick={() => setPicked(m.id)}
                aria-pressed={picked === m.id}
                className={`rounded-xl px-3 py-3 border text-left transition-[border-color,background-color,box-shadow] duration-150 ease-out active:scale-[0.99]
                  ${picked === m.id ? 'bg-violet-glow/[0.14] border-violet-glow/50 shadow-glow-sm' : 'bg-white/[0.04] border-white/[0.1] hover:border-white/[0.22]'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-[20px] h-[20px] rounded-full grid place-items-center shrink-0" style={{ background: `conic-gradient(from 20deg, ${m.accent}, #ffffff55, ${m.accent})` }}>
                    <span className="w-2 h-2 rounded-full bg-white/90" />
                  </span>
                  <span className="text-[12px] font-bold truncate">{m.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={go}
          className="mt-6 w-full h-[44px] rounded-xl font-bold text-[14px] text-white btn-primary shadow-glow-sm hover:brightness-110 hover:shadow-glow active:scale-[0.98] transition-[filter,box-shadow,transform] duration-150"
        >
          Start creating — it's this simple
        </button>
        <div className="mt-3 text-[11px] text-muted">Upload a video you want to recreate. That's the whole tutorial.</div>
      </div>
    </div>, document.body
  )
}
