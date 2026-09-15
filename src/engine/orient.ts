// Aspect-ratio / orientation detection for uploaded reference videos.
export type OrientKind = 'landscape' | 'portrait' | 'square'

export interface OrientMeta {
  w: number
  h: number
  ratio: string      // "9:16", "16:9", "1:1", "2.35:1"…
  kind: OrientKind
  label: string      // "Reels / TikTok · Vertical", "Cinematic · Horizontal", …
  icon: 'land' | 'port' | 'sq'
}

const STANDARDS: { r: number; label: string }[] = [
  { r: 16 / 9, label: '16:9' },
  { r: 9 / 16, label: '9:16' },
  { r: 1, label: '1:1' },
  { r: 4 / 3, label: '4:3' },
  { r: 3 / 4, label: '3:4' },
  { r: 3 / 2, label: '3:2' },
  { r: 2 / 3, label: '2:3' },
  { r: 21 / 9, label: '21:9' },
  { r: 2.39, label: '2.39:1' },
  { r: 2.35, label: '2.35:1' },
  { r: 2, label: '2:1' },
  { r: 5 / 3, label: '5:3' },
  { r: 5 / 4, label: '5:4' },
  { r: 4 / 5, label: '4:5' },
]

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function orientMeta(w: number, h: number): OrientMeta {
  const ratio = h > 0 ? w / h : 1
  const kind: OrientKind = ratio > 1.05 ? 'landscape' : ratio < 0.95 ? 'portrait' : 'square'

  // Match the closest known standard (within 6% tolerance), else compute exact.
  let best = STANDARDS[0]
  let bestDiff = Math.abs(Math.log(ratio / best.r))
  for (const s of STANDARDS) {
    const d = Math.abs(Math.log(ratio / s.r))
    if (d < bestDiff) { bestDiff = d; best = s }
  }
  const ratioLabel = bestDiff < 0.06 ? best.label : (() => {
    const g = gcd(Math.round(w), Math.round(h)) || 1
    const a = Math.round(w / g), b = Math.round(h / g)
    return (a <= 32 && b <= 32) ? `${a}:${b}` : ratio.toFixed(2) + ':1'
  })()

  let label: string
  if (kind === 'portrait') {
    label = ratioLabel === '9:16' ? 'Reels · TikTok · Shorts' : ratioLabel === '4:5' ? 'Feed Portrait' : 'Vertical'
  } else if (kind === 'square') {
    label = 'Square · Feed'
  } else {
    label = ratioLabel === '2.39:1' || ratioLabel === '2.35:1' ? 'Cinemascope' : ratioLabel === '21:9' ? 'Ultrawide' : 'Landscape · Cinematic'
  }

  return { w, h, ratio: ratioLabel, kind, label, icon: kind === 'landscape' ? 'land' : kind === 'portrait' ? 'port' : 'sq' }
}
