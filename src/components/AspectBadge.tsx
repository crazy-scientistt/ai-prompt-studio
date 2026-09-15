import React from 'react'
import type { OrientMeta } from '../engine/orient'
import { IconLand, IconPort, IconSquare } from './Icons'

export function OrientIcon({ meta, className = 'w-4 h-4' }: { meta: OrientMeta; className?: string }) {
  if (meta.icon === 'port') return <IconPort className={className} />
  if (meta.icon === 'sq') return <IconSquare className={className} />
  return <IconLand className={className} />
}

export default function AspectBadge({ meta, compact = false }: { meta: OrientMeta; compact?: boolean }) {
  const tone =
    meta.kind === 'portrait'
      ? 'text-pink-200 bg-pink-400/10 border-pink-400/30'
      : meta.kind === 'square'
        ? 'text-amber-200 bg-amber-400/10 border-amber-400/30'
        : 'text-sky-200 bg-sky-400/10 border-sky-400/30'

  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border font-semibold ${tone} ${compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-[12px]'}`} title={`${meta.w}×${meta.h} · ${meta.label}`}>
      <OrientIcon meta={meta} className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      <span className="tabular-nums shrink-0">{meta.ratio}</span>
      {!compact && <span className="min-w-0 whitespace-normal break-words opacity-75 hidden md:inline">· {meta.label}</span>}
    </span>
  )
}
