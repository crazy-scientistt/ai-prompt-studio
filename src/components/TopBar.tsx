import React from 'react'
import { useStore } from '../store'
import { IconBell, IconSearch } from './Icons'

export default function TopBar({ onMenu }: { onMenu?: () => void }) {
  const { toast } = useStore()

  return (
    <div className="flex items-center gap-3 h-[44px] shrink-0 relative z-30">
      {/* mobile menu button */}
      <button
        onClick={onMenu}
        className="lg:hidden glass grid place-items-center w-[40px] h-[40px] rounded-xl text-ink/85 hover:border-white/[0.22] transition-colors duration-150"
        title="Menu"
        aria-label="Open menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[18px] h-[18px]"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>

      <div className="glass flex-1 min-w-0 max-w-md h-[40px] rounded-xl hover:border-white/[0.2] transition-colors duration-150 flex items-center gap-3 px-4">
        <IconSearch className="w-4 h-4 text-muted shrink-0" />
        <input
          className="bg-transparent outline-none text-[13px] placeholder:text-muted/80 min-w-0 flex-1 text-ink"
          placeholder="Turn imagination into visual power..."
          aria-label="Search"
          onKeyDown={(e) => { if (e.key === 'Enter') toast('Search is coming soon', '🔍') }}
        />
      </div>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        <button
          className="glass relative grid place-items-center w-[40px] h-[40px] rounded-xl hover:border-white/[0.22] transition-colors duration-150"
          onClick={() => toast('You’re all caught up', '🔔')}
          aria-label="Notifications"
        >
          <IconBell className="w-[18px] h-[18px] text-ink/85" />
          <span className="absolute top-2 right-2.5 w-1.5 h-1.5 rounded-full bg-lilac" />
        </button>

        <button
          className="w-[40px] h-[40px] rounded-full bg-gradient-to-br from-lilac to-violet-glow grid place-items-center text-[13px] font-bold text-white shadow-glow-sm shrink-0 ring-1 ring-white/25"
          onClick={() => toast('Account · demo mode', '👤')}
          aria-label="Account"
        >
          A
        </button>
      </div>
    </div>
  )
}
