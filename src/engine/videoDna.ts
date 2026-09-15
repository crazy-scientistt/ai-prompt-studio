// ── Video DNA ────────────────────────────────────────────────────────────────
// The internal representation every prompt is compiled FROM. Raw video never
// feeds the compiler directly: VIDEO → ANALYSIS → VIDEO DNA → COMPILER → QA →
// FINAL PROMPT. In this build the analyzer is deterministic + seeded so the
// whole product flow is real end-to-end; swapping in a multimodal provider only
// replaces `analyzeVideo`'s body (see src/engine/aiProvider.ts).

export type Mode = 'recreate' | 'style'

export interface TemporalEvent {
  start: number
  end: number
  subject: string
  camera: string
  note?: string
}

export interface ContinuityItem { label: string; rule: string }

export interface SubjectDna {
  name: string
  description: string
  wardrobe: string
  replaces: boolean
  replacementName?: string
  replacementDesc?: string
}

export interface VideoDna {
  title: string
  fileName: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  hasAudio: boolean
  aspect: { ratio: string; kind: 'landscape' | 'portrait' | 'square' }
  scene: string
  sceneDetail: string
  environment: string
  subjects: SubjectDna[]
  heroObject?: { name: string; role: string; interactions: string[] }
  timeline: TemporalEvent[]
  camera: {
    move: string
    confidence: number
    height: string
    lensCharacter: string
    exactFocal: string
    speed: string
  }
  subjectCamera: string
  lighting: {
    sources: string
    quality: string
    temperature: string
    shadows: string
    highlights: string
    direction: string
  }
  composition: {
    symmetry: string
    vanishingPoint: string
    occupancy: string
    headroom: string
    depthLayers: string[]
  }
  motion: { subject: string; camera: string; relative: string }
  physics: string[]
  style: string[]
  grade: string
  continuity: ContinuityItem[]
  negativeWatch: string[]
  singleShot: boolean
  shotCount: number
}

// ── Deterministic seeded RNG ─────────────────────────────────────────────────
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCENES = [
  {
    scene: 'Hotel corridor walk-in',
    sceneDetail: 'a long luxurious hotel corridor with warm practicals',
    environment: 'Elegant high-end hotel hallway, polished black-and-white marble floor, fluted dark wood wall panels, brass wall sconces, coffered ceiling, deep perspective corridor',
    subjects: [{ name: 'Lead character', description: 'confident well-groomed man, short dark hair, composed expression', wardrobe: 'a tailored all-black suit over a black crew-neck, leather dress shoes' }],
    camera: { move: 'smooth stabilized backward dolly, retreating ahead of the subject', confidence: 0.96, height: 'approx. eye level (~1.6 m)', lensCharacter: 'moderately wide cinematic perspective with gentle perspective compression', speed: 'matching the subject’s walking pace' },
    subjectCamera: 'subject walks directly toward the lens along the central vanishing point while the camera retreats',
    lighting: { sources: 'warm golden practicals: ceiling downlights, brass sconces, lamp pools', quality: 'soft with controlled specular hits', temperature: 'warm amber against deep neutral shadows', shadows: 'deep rich blacks in the panel recesses', highlights: 'warm specular streaks and long reflections on the marble' },
    grade: 'warm cinematic commercial grade, lifted amber mids, rich blacks',
    physics: ['natural walking gait with consistent stride length', 'subtle jacket and fabric sway from body movement', 'floor reflections respond continuously to subject and camera position'],
    style: ['premium cinematic commercial aesthetic', 'photorealistic', 'shallow but believable depth of field'],
    negativeWatch: ['foot sliding / moonwalking', 'identity drift', 'corridor geometry morphing', 'reflection stutter', 'extra people entering frame'],
  },
  {
    scene: 'Automotive night drive',
    sceneDetail: 'rain-slick downtown streets at night under neon signage',
    environment: 'Rain-slick downtown street at night, neon signage, glass towers, wet asphalt mirroring every light source',
    subjects: [{ name: 'Hero vehicle', description: 'low wide sports car in deep metallic paint, clean reflections', wardrobe: '—' }],
    camera: { move: 'low tracking move alongside the vehicle, easing into a slow push-in', confidence: 0.9, height: 'low, roughly wheel-arch height', lensCharacter: 'wide anamorphic character with horizontal flare bias', speed: 'even tracking speed with a gentle ease-out' },
    subjectCamera: 'vehicle holds lane position while the camera tracks parallel, then closes distance',
    lighting: { sources: 'neon signage, street lamps, vehicle headlights', quality: 'hard neon hits over soft ambient fill', temperature: 'mixed magenta-cyan contrast', shadows: 'wet black asphalt pooling shadow', highlights: 'elongated neon streaks reflected across bodywork' },
    grade: 'neo-noir grade, crushed shadows, saturated practicals',
    physics: ['tires grip realistically through surface water', 'suspension settles subtly over road texture', 'reflections slide along the body panels as lights pass'],
    style: ['cinematic automotive commercial', 'photorealistic', 'anamorphic night look'],
    negativeWatch: ['wheel spin mismatch', 'body panel warping', 'license plate flicker', 'background stutter', 'headlight popping'],
  },
  {
    scene: 'Product hero spin',
    sceneDetail: 'a seamless studio set built around a single hero product',
    environment: 'Seamless studio cyclorama in deep charcoal, single giant soft source, subtle floor contact shadow, floating dust motes',
    subjects: [{ name: 'Hero product', description: 'precision-machined product with premium materials and crisp branding', wardrobe: '—' }],
    heroObject: { name: 'Hero product', role: 'sole subject on set', interactions: ['rotates slowly on its axis', 'catches a moving highlight as it turns'] },
    camera: { move: 'slow orbital arc around the product with a gentle push-in', confidence: 0.93, height: 'product-centered, slightly above mid-height', lensCharacter: 'neutral-to-short-telephoto look with clean falloff', speed: 'very slow, continuous, no ramping' },
    subjectCamera: 'product rotates while the camera orbits in the opposite direction, multiplying perceived rotation',
    lighting: { sources: 'one large overhead softbox, rim strip light behind, subtle bounce card', quality: 'soft wrap with one crisp specular edge', temperature: 'neutral daylight balance', shadows: 'one controlled contact shadow only', highlights: 'single travelling highlight revealing the silhouette' },
    grade: 'clean commercial grade, neutral whites, true blacks',
    physics: ['rotation at constant angular speed', 'contact shadow stays locked to the base', 'dust motes drift with parallax'],
    style: ['high-end product commercial', 'photorealistic', 'ultra-clean studio look'],
    negativeWatch: ['logo warping', 'geometry stretching', 'shadow detaching', 'background banding', 'speed ramping'],
  },
  {
    scene: 'Coastal cliff panorama',
    sceneDetail: 'a vast coastal cliff landscape at golden hour',
    environment: 'High coastal cliff at golden hour, layered sea haze, wind-brushed grass, sun low over the horizon',
    subjects: [{ name: 'Figure at the edge', description: 'lone figure seen mostly from behind, hair moving in the wind', wardrobe: 'a long flowing coat in a warm earth tone' }],
    camera: { move: 'slow rising crane move, drifting forward past the shoulder', confidence: 0.88, height: 'starts at chest height, rises above head level', lensCharacter: 'wide cinematic vista perspective', speed: 'slow continuous rise and drift' },
    subjectCamera: 'camera approaches from behind the figure and rises to reveal the horizon beyond',
    lighting: { sources: 'low golden sun, open sky fill', quality: 'warm wrap with atmospheric diffusion', temperature: 'golden against cool blue haze', shadows: 'long soft shadows across the grass', highlights: 'sun flare kissing the lens edge' },
    grade: 'golden-hour filmic grade, soft highlight roll-off',
    physics: ['hair and coat respond continuously to wind', 'haze layers parallax as the camera rises', 'grass ripples in gusts'],
    style: ['cinematic travel film', 'photorealistic', 'natural film-like contrast'],
    negativeWatch: ['horizon bending', 'wind stuttering', 'figure popping', 'sun flare flicker', 'layered haze banding'],
  },
]

// Scene-aware temporal goals — the "when" differs between a walk, a drive, a spin and a vista.
const GOALS: Record<string, { temporal: string; verb: string; close: string }> = {
  'Hotel corridor walk-in': { temporal: 'controlled natural walking pace', verb: 'begins walking directly toward camera', close: 'naturally tightens the perceived distance without an obvious zoom or change in camera height' },
  'Automotive night drive': { temporal: 'smooth linear acceleration', verb: 'accelerates smoothly forward', close: 'eases into a stop while the camera settles alongside the rear haunch' },
  'Product hero spin': { temporal: 'constant slow rotation', verb: 'begins rotating slowly on its pedestal', close: 'completes the rotation and settles with the logo facing camera' },
  'Coastal cliff panorama': { temporal: 'stillness against building wind', verb: 'stands grounded as the wind builds', close: 'holds still while the camera rises to reveal the full horizon' },
}

export function analyzeVideo(
  fileName: string,
  durationSec: number,
  aspect?: { ratio: string; kind: 'landscape' | 'portrait' | 'square' },
): VideoDna {
  const rnd = mulberry32(hashString(fileName + '|' + Math.round(durationSec)))
  // Demo/benchmark files can pin a scene via filename (e.g. "hotel-corridor...").
  const pinned = /hotel|corridor/i.test(fileName) ? 0 : undefined
  const pick = SCENES[pinned ?? Math.floor(rnd() * SCENES.length)]
  const goal = GOALS[pick.scene]

  const duration = Math.max(4, Math.min(120, Math.round(durationSec) || 15))
  const singleShot = duration <= 16 || rnd() > 0.72

  // Temporal reconstruction — the "when", not just the "what".
  const beats = 5
  const cut = duration / beats
  const e = (i: number) => Math.round(cut * i * 10) / 10
  const timeline: TemporalEvent[] = [
    { start: e(0), end: e(1), subject: 'Stationary. Composed, ready to move.', camera: 'Frame settles; motion begins almost imperceptibly.', note: 'establish: full scene context reads immediately' },
    { start: e(1), end: e(2), subject: `Primary motion begins: ${goal.verb.replace('begins ', '')}.`, camera: 'Camera commits to its move and matches pacing.', note: 'the move and the action must start together' },
    { start: e(2), end: e(3), subject: 'Motion continues with consistent speed and rhythm.', camera: 'Camera sustains its move; relative distance begins to change.', note: 'gradual scale shift, never a jump' },
    { start: e(3), end: e(4), subject: 'Secondary details activate (fabric, reflections, background life).', camera: 'Micro-corrections keep framing intentional.', note: 'background stays alive but subordinate' },
    { start: e(4), end: duration, subject: 'Action resolves into a confident final pose.', camera: `${goal.close}.`, note: 'ending is held, never cut short' },
  ]

  const w = 3840
  const h = 2160
  const fps = [24, 25, 30][Math.floor(rnd() * 3)]

  return {
    title: prettyTitle(fileName),
    fileName,
    duration,
    width: w,
    height: h,
    fps,
    codec: 'H.264 / MP4',
    hasAudio: rnd() > 0.35,
    aspect: aspect ?? { ratio: '16:9', kind: 'landscape' },
    scene: pick.scene,
    sceneDetail: pick.sceneDetail,
    environment: pick.environment,
    subjects: pick.subjects.map((s) => ({ ...s, replaces: false })),
    heroObject: 'heroObject' in pick ? pick.heroObject : undefined,
    timeline,
    camera: { exactFocal: 'Uncertain — not confidently inferable', ...pick.camera },
    subjectCamera: pick.subjectCamera,
    lighting: { direction: 'motivated by the visible practicals in frame', ...pick.lighting },
    composition: {
      symmetry: 'near-perfect symmetrical composition along the central axis',
      vanishingPoint: 'center of frame',
      occupancy: `18% → 46% of frame height across the shot`,
      headroom: 'consistent, never clipped',
      depthLayers: ['clean foreground edge', 'subject plane in sharp focus', 'environment falling off into soft bokeh'],
    },
    motion: {
      subject: 'steady, purposeful, constant-rate movement',
      camera: pick.camera.move,
      relative: pick.scene === 'Hotel corridor walk-in'
        ? 'camera retreats slightly slower than the subject advances, so the subject gradually grows in frame'
        : 'camera and subject move in harmony so relative scale shifts gradually and deliberately',
    },
    physics: pick.physics,
    style: pick.style,
    grade: pick.grade,
    continuity: [
      { label: 'Facial identity', rule: 'facial identity, hair and body proportions stay locked for the entire shot' },
      { label: 'Wardrobe', rule: 'wardrobe, colors and fit remain identical throughout' },
      { label: 'Environment', rule: 'architecture, layout and set dressing never morph or rearrange' },
      { label: 'Light direction', rule: 'light direction and shadow behavior stay consistent' },
      { label: 'Camera axis', rule: 'camera axis and height never drift or jump' },
    ],
    negativeWatch: pick.negativeWatch,
    singleShot,
    shotCount: singleShot ? 1 : 3 + Math.floor(rnd() * 3),
  }
}

function prettyTitle(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  if (!base) return 'Untitled reference'
  const t = base.replace(/\b\w/g, (c) => c.toUpperCase())
  return t.length > 28 ? t.slice(0, 28) + '…' : t
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
