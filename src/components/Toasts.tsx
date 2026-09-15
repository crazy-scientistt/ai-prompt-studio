import React from 'react'
import { useStore } from '../store'
import { IconCheck } from './Icons'

export default function Toasts() {
  const { toasts } = useStore()
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] w-max max-w-[calc(100vw-32px)] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass-pop rounded-xl px-4 py-2 min-h-[40px] max-w-full flex items-center gap-3 animate-pop"
        >
          {t.icon ? <span className="text-[14px] shrink-0">{t.icon}</span> : <IconCheck className="w-4 h-4 text-emerald-400 shrink-0" />}
          <span className="text-[13px] font-semibold text-ink min-w-0 break-words">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
