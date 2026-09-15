import React, { useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconChevron, IconClock, IconCrown, IconGear, IconImage, IconLogo, IconVideo, IconChevronR } from './Icons'
import { useStore } from '../store'
import { Btn, Tooltip, useDialogFocus } from './ui'

export type Tab = 'studio' | 'assets' | 'history' | 'settings'

const NAV: { id: Tab; label: string; icon: (p: { className?: string }) => React.JSX.Element }[] = [
  { id: 'studio', label: 'Video to Prompt', icon: IconVideo },
  { id: 'assets', label: 'My Assets', icon: IconImage },
  { id: 'history', label: 'History', icon: IconClock },
  { id: 'settings', label: 'Settings', icon: IconGear },
]

interface DesktopProps {
  tab: Tab
  onTab: (t: Tab) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

interface MobileProps {
  tab: Tab
  onTab: (t: Tab) => void
  mobileOpen: boolean
  onMobileClose: () => void
}

function NavList({ tab, onTab, onNavigate }: { tab: Tab; onTab: (t: Tab) => void; onNavigate?: () => void }) {
  return (
    <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
      {NAV.map((n) => {
        const active = tab === n.id
        const Icon = n.icon
        return (
          <button
            key={n.id}
            onClick={() => { onTab(n.id); onNavigate?.() }}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-xl h-[40px] px-4 text-[13px] font-semibold
              transition-[background-color,color] duration-150 ease-out
              ${active
                ? 'sidebar-nav-active'
                : 'text-muted hover:text-ink hover:bg-white/[0.05]'}`}
          >
            <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-white' : 'text-muted group-hover:text-lilac'}`} />
            <span className="truncate">{n.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function PlanCard() {
  const { credits, toast } = useStore()
  const remaining = credits.total - credits.used
  const pct = Math.min(100, (credits.used / credits.total) * 100)
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <IconCrown className="w-4 h-4 text-amber-300" /> Pro Plan
      </div>
      <div className="mt-2 text-[11px] text-muted tabular-nums">{remaining.toLocaleString()} / {credits.total.toLocaleString()} credits</div>
      <div className="mt-2 h-1 rounded-full bg-white/[0.08] overflow-hidden">
        <div className="h-full rounded-full bg-amber-200/60 transition-[width] duration-500" style={{ width: `${100 - pct}%` }} />
      </div>
      <Btn
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        onClick={() => toast('You’re on Pro — 3,000 credits included ✓', '👑')}
      >
        Upgrade Plan
      </Btn>
    </div>
  )
}

function UserChip() {
  const { toast } = useStore()
  return (
    <button
      className="mt-3 flex items-center gap-3 px-1 py-1 w-full rounded-lg hover:bg-white/[0.04] transition-colors duration-150"
      onClick={() => toast('Account · demo mode', '👤')}
    >
      <span className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-lilac to-violet-glow grid place-items-center text-[12px] font-bold text-white">A</span>
      <span className="text-[12px] font-semibold text-ink/90 truncate">Abdulrehman</span>
      <IconChevron className="w-3.5 h-3.5 text-muted ml-auto shrink-0 group-hover:text-ink" />
    </button>
  )
}

/* ── Desktop sidebar — one persistent element whose width animates ───────────
   Collapse/expand morphs a single <aside> between 252px ↔ 68px while the
   expanded panel and the icon rail cross-fade inside it. Both layers stay
   mounted (visibility handles a11y/focus), so the motion is a real CSS
   transition — no DOM teardown, no jump. ──────────────────────────────────── */
export function SidebarDesktop({ tab, onTab, collapsed, onToggleCollapse }: DesktopProps) {
  return (
    <aside
      aria-label="Sidebar"
      className={`glass-chrome relative h-full rounded-xl overflow-hidden transition-[width] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${collapsed ? 'sidebar-rail' : 'sidebar-wide'}`}
    >
      {/* expanded panel — fixed width so text never reflows mid-animation */}
      <div
        aria-hidden={collapsed}
        className={`absolute inset-y-0 left-0 sidebar-wide p-4 flex flex-col
          transition-[opacity,transform,visibility] duration-[200ms] ease-out
          ${collapsed ? 'opacity-0 -translate-x-2 invisible pointer-events-none' : 'opacity-100 translate-x-0 visible'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <IconLogo className="w-8 h-8 shrink-0" />
            <div className="min-w-0">
              <div className="text-[14px] font-bold tracking-tight truncate">AI Prompt Studio</div>
              <div className="text-[11px] text-muted leading-tight">Turn any video into a<br />ready-to-use prompt</div>
            </div>
          </div>
          <button
            onClick={onToggleCollapse}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            className="shrink-0 mt-1 rounded-lg p-2 text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
          >
            <IconChevronR className="w-3.5 h-3.5" />
          </button>
        </div>

        <NavList tab={tab} onTab={onTab} />

        <div className="mt-auto pt-4">
          <PlanCard />
          <UserChip />
        </div>
      </div>

      {/* icon rail — fades in as the panel collapses */}
      <div
        aria-hidden={!collapsed}
        className={`absolute inset-y-0 left-0 sidebar-rail py-4 flex flex-col items-center
          transition-[opacity,transform,visibility] duration-[200ms] ease-out
          ${collapsed ? 'opacity-100 translate-x-0 visible' : 'opacity-0 translate-x-2 invisible pointer-events-none'}`}
      >
        <button onClick={onToggleCollapse} title="Show sidebar" className="text-muted hover:text-ink transition-colors" aria-label="Show sidebar">
          <IconLogo className="w-7 h-7" />
        </button>
        <div className="mt-2 flex flex-col gap-2">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = tab === n.id
            return (
              <Tooltip key={n.id} label={n.label}><button
                onClick={() => onTab(n.id)}
                title={n.label}
                aria-label={n.label}
                aria-current={active ? 'page' : undefined}
                className={`grid place-items-center w-9 h-9 rounded-xl transition-colors duration-150 ${active ? 'bg-violet-glow/25 text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.06]'}`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button></Tooltip>
            )
          })}
        </div>
        <button
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="mt-auto grid place-items-center w-9 h-9 rounded-xl text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
        >
          <IconChevron className="w-4 h-4 rotate-90" />
        </button>
      </div>
    </aside>
  )
}

/* ── Mobile drawer ─────────────────────────────────────────────────────────── */
export function SidebarMobile({ tab, onTab, mobileOpen, onMobileClose }: MobileProps) {
  const panelRef = useRef<HTMLElement>(null)
  useDialogFocus(mobileOpen, panelRef, onMobileClose)
  return createPortal(
    <div className={`lg:hidden fixed inset-0 z-[80] ${mobileOpen ? 'visible' : 'invisible pointer-events-none'}`} aria-hidden={!mobileOpen} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Navigation">
      <div
        onClick={onMobileClose}
        className={`absolute inset-0 bg-night/70 transition-opacity duration-200 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
      />
      <aside
        ref={panelRef} tabIndex={-1}
        className={`absolute left-0 top-0 bottom-0 w-[272px] bg-panel border-r border-white/[0.12] p-4 flex flex-col
          transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconLogo className="w-8 h-8" />
            <div className="text-[14px] font-bold tracking-tight">AI Prompt Studio</div>
          </div>
          <button onClick={onMobileClose} className="rounded-lg p-2 text-muted hover:text-ink hover:bg-white/[0.06] transition-colors" title="Close" aria-label="Close menu">
            <IconChevronR className="w-4 h-4 rotate-180" />
          </button>
        </div>
        <NavList tab={tab} onTab={onTab} onNavigate={onMobileClose} />
        <div className="mt-auto pt-4">
          <PlanCard />
          <UserChip />
        </div>
      </aside>
    </div>, document.body
  )
}

/* default export kept for compatibility with existing imports */
export default function Sidebar(props: DesktopProps & Partial<MobileProps>) {
  return <SidebarDesktop tab={props.tab} onTab={props.onTab} collapsed={props.collapsed} onToggleCollapse={props.onToggleCollapse} />
}
