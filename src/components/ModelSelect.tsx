import React from 'react'
import { MODEL_ADAPTERS, getModel } from '../engine/models'
import { IconChevron } from './Icons'
import { Dropdown, MenuItem, SectionLabel } from './ui'

export default function ModelSelect({ value, onChange, label = 'Creating for' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const active = getModel(value)

  return (
    <div>
      <div className="text-[13px] font-semibold text-ink/90 mb-2">{label}</div>
      <Dropdown
        matchTrigger
        trigger={({ open, toggle }) => (
          <button
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="menu"
            className="glass w-full h-[40px] rounded-xl hover:border-violet-glow/45 transition-colors duration-150 flex items-center gap-3 px-3"
          >
            <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: `conic-gradient(from 20deg, ${active.accent}, #ffffff55, ${active.accent})` }}>
              <span className="w-2.5 h-2.5 rounded-full bg-white/90" />
            </span>
            <span className="text-[13px] font-semibold truncate">{active.name}</span>
            <span className="ml-auto flex items-center gap-2 text-[11px] text-muted shrink-0">
              <span className="hidden sm:inline">{active.clipLengths.join('/')}s</span>
              <IconChevron className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </span>
          </button>
        )}
      >
        {(close) => (
          <>
            {MODEL_ADAPTERS.filter((m) => m.active).map((m) => (
              <MenuItem
                key={m.id}
                onClick={() => { onChange(m.id); close() }}
                className={m.id === value ? 'bg-violet-glow/15' : ''}
              >
                <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: `conic-gradient(from 20deg, ${m.accent}, #ffffff55, ${m.accent})` }}>
                  <span className="w-2.5 h-2.5 rounded-full bg-white/90" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold truncate">{m.name}</span>
                    <span className="shrink-0 text-[11px] font-bold text-muted bg-white/[0.06] border border-white/[0.1] rounded-full px-2 py-px">{m.clipLengths.join('/')}s</span>
                  </span>
                  <span className="block text-[11px] text-muted truncate">{m.notes}</span>
                </span>
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>
    </div>
  )
}
