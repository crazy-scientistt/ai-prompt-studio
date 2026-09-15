import React, { useId, useState } from 'react'
import type { VideoDna } from '../engine/videoDna'
import { IconCamera, IconChart, IconChevron, IconCube, IconLayers, IconShield, IconSun } from './Icons'
import { Chip, Disclosure } from './ui'
import { fmtTime } from '../engine/videoDna'

/* ── AI Analysis — progressive disclosure ────────────────────────────────────
   Collapsed by default: one row in the results column.
   Expanded: per-section accordions (Camera / Motion / … each foldable),
   inside a contained scroll area so it can never produce a 5000px wall. */

function Accordion({
  icon, title, defaultOpen = false, children,
}: { icon: React.ReactNode; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-center gap-2 px-3 h-9 hover:bg-white/[0.04] transition-colors duration-150"
      >
        <span className="text-lilac [&>svg]:w-[15px] [&>svg]:h-[15px]">{icon}</span>
        <span className="text-[13px] font-semibold text-ink/90">{title}</span>
        <IconChevron className={`w-3.5 h-3.5 ml-auto text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <Disclosure open={open} id={id}><div className="px-3 pb-3">{children}</div></Disclosure>
    </div>
  )
}

function Row({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <dl className="analysis-row">
      <dt>{k}</dt>
      <dd className={dim ? 'italic' : ''}>{v}</dd>
    </dl>
  )
}

export default function Analysis({ dna }: { dna: VideoDna }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div className="result-card">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-center gap-3 px-4 h-11 hover:bg-white/[0.04] transition-colors duration-150"
      >
        <IconChart className="w-[17px] h-[17px] text-lilac" />
        <span className="section-title shrink-0">Detailed Analysis</span>
        <span className="text-[11px] text-muted hidden sm:inline truncate">video dna · {dna.scene.toLowerCase()}</span>
        <IconChevron className={`w-4 h-4 ml-auto text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <Disclosure open={open} id={id}>
        <div className="px-4 pb-4">
          <div className="analysis-grid">
            <Accordion icon={<IconCamera />} title="Camera" defaultOpen>
              <Row k="Movement" v={dna.camera.move} />
              <Row k="Confidence" v={`${(dna.camera.confidence * 100).toFixed(0)}%`} />
              <Row k="Height" v={dna.camera.height} />
              <Row k="Lens character" v={dna.camera.lensCharacter} />
              <Row k="Exact focal length" v="Uncertain — not fabricated" dim />
            </Accordion>
            <Accordion icon={<IconChart />} title="Motion" defaultOpen>
              <Row k="Subject" v={dna.motion.subject} />
              <Row k="Camera" v={dna.motion.camera} />
              <Row k="Relative" v={dna.motion.relative} />
            </Accordion>
            <Accordion icon={<IconSun />} title="Lighting">
              <Row k="Sources" v={dna.lighting.sources} />
              <Row k="Quality" v={dna.lighting.quality} />
              <Row k="Temperature" v={dna.lighting.temperature} />
              <Row k="Shadows" v={dna.lighting.shadows} />
            </Accordion>
            <Accordion icon={<IconLayers />} title="Composition">
              <Row k="Symmetry" v={dna.composition.symmetry} />
              <Row k="Vanishing point" v={dna.composition.vanishingPoint} />
              <Row k="Subject occupancy" v={dna.composition.occupancy} />
              <Row k="Headroom" v={dna.composition.headroom} />
            </Accordion>
            <Accordion icon={<IconChart />} title="Timing">
              <div className="flex flex-col gap-2">
                {dna.timeline.map((ev, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.04] px-3 py-2">
                    <div className="text-[11px] font-bold text-lilac tabular-nums">{fmtTime(ev.start)} → {fmtTime(ev.end)}</div>
                    <div className="text-[12px] text-ink/85 leading-relaxed">{ev.subject}</div>
                    <div className="text-[11px] text-muted leading-relaxed">{ev.camera}</div>
                  </div>
                ))}
              </div>
            </Accordion>
            <Accordion icon={<IconCube />} title="Subjects & Environment">
              {dna.subjects.map((s, i) => (
                <Row key={i} k={s.name} v={`${s.description}; ${s.wardrobe}`} />
              ))}
              <Row k="Environment" v={dna.environment} />
              <Row k="Visual style" v={dna.style.join(', ')} />
              <Row k="Grade" v={dna.grade} />
            </Accordion>
            <Accordion icon={<IconShield />} title="Continuity locks">
              {dna.continuity.map((c, i) => <Row key={i} k={c.label} v={c.rule} />)}
            </Accordion>
            <Accordion icon={<IconShield />} title="Negative watchlist">
              <div className="flex flex-wrap gap-2">
                {dna.negativeWatch.map((n) => (
                  <Chip key={n} tone="neutral">{n}</Chip>
                ))}
              </div>
              <Row k="Shots" v={dna.singleShot ? '1 continuous take (no cuts detected)' : `${dna.shotCount} shots detected`} />
            </Accordion>
          </div>
          <div className="mt-3 text-[11px] text-muted leading-relaxed">
            Pipeline: media preprocess → shot segmentation → temporal events → subject tracking → camera/motion → lighting/composition → continuity → <span className="text-lilac font-semibold">Video DNA</span> → model compiler → prompt QA.
          </div>
        </div>
      </Disclosure>
    </div>
  )
}
