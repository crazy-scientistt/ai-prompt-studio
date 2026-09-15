import React, { useEffect, useRef, useState } from 'react'
import type { OrientMeta } from '../engine/orient'
import type { VideoDna } from '../engine/videoDna'
import { fmtTime } from '../engine/videoDna'
import { IconExpand, IconMute, IconPause, IconPlay, IconVolume } from './Icons'

export default function VideoPlayer({ src, dna, orient }: { src?: string; dna: VideoDna; orient?: OrientMeta }) {
  const fit = orient && orient.kind !== 'landscape' ? 'object-contain' : 'object-cover'
  const vref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(dna.duration)
  const [muted, setMuted] = useState(true)

  useEffect(() => { setT(0); setPlaying(false) }, [src])

  const toggle = () => {
    const v = vref.current
    if (!v) { setPlaying((p) => { if (!p) window.setTimeout(() => setPlaying(false), 2500); return !p }); return }
    if (v.paused) { v.play(); setPlaying(true) } else { v.pause(); setPlaying(false) }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    if (vref.current) vref.current.currentTime = p * (vref.current.duration || dur)
    setT(p * dur)
  }

  const p = dur ? (t / dur) * 100 : 0

  return (
    <div className="reference-player relative rounded-xl overflow-hidden bg-black/60 border border-white/10 group">
      {src ? (
        <video
          ref={vref}
          src={src}
          className={`w-full aspect-video ${fit} bg-black/30`}
          muted={muted}
          loop
          playsInline
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || dna.duration)}
          onClick={toggle}
        />
      ) : (
        <div className="relative w-full aspect-video cinematic-poster" onClick={toggle}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-16 h-16 rounded-full glass grid place-items-center transition-transform ${playing ? 'scale-110 shadow-glow' : ''}`}>
              {playing ? <IconPause className="w-6 h-6 text-white" /> : <IconPlay className="w-6 h-6 text-white translate-x-0.5" />}
            </div>
          </div>
          {playing && (
            <div className="absolute inset-x-0 bottom-16 flex items-end justify-center gap-1 opacity-80">
              {[10, 18, 12, 22, 14, 8].map((h, i) => (
                <span key={i} className="w-1 rounded-full bg-lilac animate-bar-pulse" style={{ height: h + 6, animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* badge */}
      <div className="absolute top-3 left-3 glass rounded-lg px-3 py-2 flex items-center gap-2 text-[12px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-white/60" /> Reference Video
      </div>
      <button aria-label="Expand video" title="Expand video" className="absolute top-3 right-3 glass rounded-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconExpand className="w-4 h-4" />
      </button>

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent">
        <div className="h-1.5 rounded-full bg-white/15 cursor-pointer relative" onClick={seek}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-lilac to-violet-glow" style={{ width: `${p}%` }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow" style={{ left: `calc(${p}% - 6px)` }} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-white/90">
          <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid place-items-center w-7 h-7 rounded-lg hover:bg-white/15 transition-colors duration-150">{playing ? <IconPause /> : <IconPlay />}</button>
          <span className="text-[12px] font-medium tabular-nums">{fmtTime(t)} / {fmtTime(dur)}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} className="grid place-items-center w-7 h-7 rounded-lg hover:bg-white/15 transition-colors duration-150">
              {muted ? <IconMute className="w-[18px] h-[18px]" /> : <IconVolume className="w-[18px] h-[18px]" />}
            </button>
            <span className="grid place-items-center w-7 h-7"><IconExpand className="w-4 h-4 opacity-70" /></span>
          </div>
        </div>
      </div>
    </div>
  )
}
