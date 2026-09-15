import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevron } from './Icons'

/* ── Design-system primitives ────────────────────────────────────────────────
   One place for buttons, cards, chips, toggles, dropdowns, field styles.
   Everything: focus-visible ring, disabled, pressed, hover states, motion tokens.
   Heights come from --control-h tokens so all controls align.
   ──────────────────────────────────────────────────────────────────────────── */

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type BtnSize = 'sm' | 'md' | 'lg'

/** Keeps closing surfaces mounted just long enough for their exit motion. */
export function usePresence(open: boolean) {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) { setPresent(true); return }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-section')) || 260
    const timer = window.setTimeout(() => setPresent(false), reduced ? 0 : duration)
    return () => window.clearTimeout(timer)
  }, [open])
  return open || present
}

export function Disclosure({ open, children, id }: { open: boolean; children: React.ReactNode; id?: string }) {
  const present = usePresence(open)
  const [expanded, setExpanded] = useState(open)
  useEffect(() => {
    if (!open) { setExpanded(false); return }
    const frame = requestAnimationFrame(() => setExpanded(true))
    return () => cancelAnimationFrame(frame)
  }, [open])
  return <div ref={el => { if (el) el.inert = !open }} id={id} className="disclosure" data-open={expanded} aria-hidden={!open}>
    <div className="disclosure-inner">{present && children}</div>
  </div>
}

/** Delayed, portaled help for existing icon controls. */
export function Tooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const id = useId()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number>()
  const hide = () => { window.clearTimeout(timer.current); setRect(null) }
  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setRect(ref.current?.getBoundingClientRect() ?? null), 400) }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <span ref={ref} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onPointerDown={hide}>
    {React.cloneElement(children, { title: undefined, 'aria-describedby': rect ? id : undefined })}
    {rect && createPortal(<span role="tooltip" id={id} className="tooltip glass-pop" style={{left: Math.min(Math.max(12,rect.left),window.innerWidth - 220), top: rect.bottom + 8 < window.innerHeight - 48 ? rect.bottom + 8 : rect.top - 40}}>{label}</span>,document.body)}
  </span>
}

export function useDialogFocus(open: boolean, ref: React.RefObject<HTMLElement>, onClose?: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || !ref.current) return
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current
    // All dialogs are portaled; isolate the application behind them.
    const app = document.getElementById('root')
    const wasInert = app?.inert ?? false
    if (app) app.inert = true
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]')].filter(e => e.getClientRects().length && !e.closest('[aria-hidden="true"]'))
    const frame = requestAnimationFrame(() => (focusable()[0] ?? panel).focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeRef.current) { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const items = focusable(), first = items[0], last = items[items.length - 1]
      if (!first) { e.preventDefault(); panel.focus(); return }
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey); if (app) app.inert = wasInert; if (previous?.isConnected) previous.focus({preventScroll:true}) }
  }, [open, ref])
}

export function Btn({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: BtnSize
  loading?: boolean
}) {
  return (
    <button
      className={`btn btn-${size} btn-${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent opacity-80 animate-spin shrink-0" />
      ) : null}
      {children}
    </button>
  )
}

/* ── Cards ─────────────────────────────────────────────────────────────────── */
export function Card({
  className = '',
  children,
  as: As = 'div',
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { as?: React.ElementType }) {
  return (
    <As className={`glass rounded-xl ${className}`} {...rest}>
      {children}
    </As>
  )
}

export function Panel({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass-panel rounded-xl ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** Small uppercase section label used across the app */
export function SectionLabel({ children, rule = true }: { children: React.ReactNode; rule?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-bold tracking-[.14em] text-muted uppercase">{children}</span>
      {rule && <span className="h-px flex-1 bg-white/[0.07]" />}
    </div>
  )
}

/* ── Chips / badges ────────────────────────────────────────────────────────── */
export function Chip({
  tone = 'neutral',
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warn' }) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/[0.06] border-white/[0.1] text-muted',
    accent: 'bg-violet-glow/15 border-violet-glow/30 text-lilac',
    success: 'bg-emerald-400/10 border-emerald-400/25 text-emerald-200',
    danger: 'bg-red-400/10 border-red-400/25 text-red-200',
    warn: 'bg-amber-400/10 border-amber-400/25 text-amber-200',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold leading-4 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}

/* ── Toggle switch ─────────────────────────────────────────────────────────── */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
        checked ? 'bg-violet-glow' : 'bg-white/10 border border-white/15'
      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-lilac`}
    >
      <span
        className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/* ── Dropdown (aligns to trigger, closes on outside/Escape, keyboard nav) ─── */
export function Dropdown({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width = 240,
  matchTrigger = false,
  className = '',
}: {
  trigger: (o: { open: boolean; toggle: () => void }) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  width?: number
  matchTrigger?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const present = usePresence(open)
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' })
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback((restore = true) => {
    setOpen(false)
    if (restore) wrapRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    if (!open || !present) return
    const update = () => {
      const anchor = wrapRef.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!anchor || !menu) return
      const pad = 12, gap = 8
      const menuWidth = Math.min(matchTrigger ? anchor.width : width, window.innerWidth - pad * 2)
      const below = window.innerHeight - anchor.bottom - gap - pad
      const above = anchor.top - gap - pad
      const preferTop = side === 'top' ? above >= Math.min(200, below) : below < 200 && above > below
      const available = Math.max(64, preferTop ? above : below)
      const maxHeight = Math.min(384, available)
      const height = Math.min(menu.scrollHeight, maxHeight)
      const left = Math.max(pad, Math.min(align === 'end' ? anchor.right - menuWidth : anchor.left, window.innerWidth - menuWidth - pad))
      setPosition({ width: menuWidth, maxHeight, left, top: preferTop ? Math.max(pad, anchor.top - gap - height) : anchor.bottom + gap, '--menu-origin': preferTop ? 'bottom left' : 'top left' } as React.CSSProperties)
    }
    update()
    window.addEventListener('resize', update)
    // Focus can scroll the trigger into view just as the menu opens. Follow
    // that movement instead of treating this legitimate scroll as dismissal.
    let frame = 0
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', onScroll, true) }
  }, [open, present, align, side, width, matchTrigger, close])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
      if (e.key === 'Tab') { close(false); return }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)')
        if (!items?.length) return
        const active = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
        const dir = e.key === 'ArrowDown' ? 1 : -1
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : active < 0 ? (dir === 1 ? 0 : items.length - 1) : (active + dir + items.length) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {present && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={position}
          data-closing={!open}
          aria-hidden={!open}
          className="dropdown-menu glass-pop"
        >
          {children(() => close())}
        </div>
      , document.body)}
    </div>
  )
}

export function MenuItem({
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      role="menuitem"
      data-menu-item
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-ink/90 hover:bg-white/[0.07] transition-colors duration-150 focus-visible:bg-white/[0.07] focus-visible:outline-none ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ── Text input ────────────────────────────────────────────────────────────── */
export function TextInput({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`glass h-[40px] rounded-xl px-3 text-[13px] text-ink placeholder:text-muted/80 outline-none transition-colors duration-150 focus:border-violet-glow/50 ${className}`}
      {...rest}
    />
  )
}

/** Aspect-ratio-safe skeleton block that reserves layout space while loading */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-xl bg-white/[0.05] relative overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent bg-[length:400px_100%] animate-shimmer" />
    </div>
  )
}

/* ── Modal — one shared dialog system ────────────────────────────────────────
   Overlay + centered panel, Escape to close, outside click, body scroll lock,
   enter animation, correct z-index. Content region scrolls independently. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  width = 720,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  width?: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-night/75" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className="glass-pop relative min-w-0 w-full max-h-[86vh] flex flex-col rounded-xl animate-pop outline-none"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-bold tracking-tight [overflow-wrap:anywhere]">{title}</h2>
            {subtitle && <div className="text-[12px] text-muted mt-1">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors duration-150"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-white/[0.07] px-5 py-4">{footer}</div>}
      </div>
    </div>, document.body
  )
}
