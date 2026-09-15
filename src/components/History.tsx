import React, { useMemo, useState } from 'react'
import { getModel } from '../engine/models'
import { fmtTime } from '../engine/videoDna'
import { relDate, useStore, type HistoryItem } from '../store'
import { Btn, Chip, Modal } from './ui'
import { IconClock, IconCopy, IconExpand, IconSearch, IconTrash, IconVideo } from './Icons'
import { seedColor } from './Studio'

/* Renders a saved kit text (markdown-ish) readably: headings, rules, clip bodies.
   Each section gets its own copy affordance so users can grab just one clip. */
function KitText({ text, onSection }: { text: string; onSection: (body: string, label: string) => void }) {
  const blocks = text.split(/^##\s+/m).filter(Boolean)
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) => {
        const [head, ...rest] = b.split('\n')
        const isHeaded = blocks.length > 1 && /^CLIP|^POST|^Notes|^SHARED/i.test(head)
        const body = (isHeaded ? rest.join('\n') : b).trim()
        const label = (isHeaded ? head.replace(/#+\s*/, '') : 'Intro').slice(0, 60)
        return (
          <div key={i}>
            {isHeaded && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-bold tracking-wide text-lilac truncate">{label}</span>
                <button
                  onClick={() => onSection(body, label)}
                  title={`Copy ${label.split('—')[0].trim()}`}
                  aria-label={`Copy ${label}`}
                  className="ml-auto shrink-0 grid place-items-center w-7 h-7 rounded-lg text-muted hover:text-ink hover:bg-white/[0.07] transition-colors duration-150"
                >
                  <IconCopy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <pre className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-sans text-[13px] leading-relaxed text-ink/90 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">{isHeaded ? body : body.replace(/^#+\s*/, '')}</pre>
          </div>
        )
      })}
    </div>
  )
}

export default function History({ onOpen }: { onOpen: () => void }) {
  const { history, removeHistory, toast } = useStore()
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<HistoryItem | null>(null)

  const list = useMemo(
    () => history.filter((h) => h.title.toLowerCase().includes(q.toLowerCase()) || getModel(h.modelId).name.toLowerCase().includes(q.toLowerCase())),
    [history, q],
  )

  const copy = async (h: HistoryItem) => {
    try { await navigator.clipboard.writeText(h.prompt) } catch { /* clipboard unavailable */ }
    toast(`"${h.title}" prompt copied — ${getModel(h.modelId).name} version`, '📋')
  }

  const copySection = async (body: string, label: string) => {
    try { await navigator.clipboard.writeText(body) } catch { /* clipboard unavailable */ }
    const short = label.split('—')[0].trim()
    toast(`${short} copied`, '📋')
  }

  const open = (h: HistoryItem) => {
    setViewing(h)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-5 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">My Prompts</h1>
          <p className="page-description">Every generation is saved with its Video DNA — open, read, copy or recompile for any model instantly.</p>
        </div>
        <div className="glass rounded-xl h-[40px] flex items-center gap-3 px-4 w-full sm:w-64 focus-within:border-white/20 transition-colors">
          <IconSearch className="w-4 h-4 text-muted shrink-0" />
          <input aria-label="Search prompts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts…" className="bg-transparent outline-none text-[13px] min-w-0 flex-1 placeholder:text-muted" />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="glass rounded-xl flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
          <div className="w-14 h-14 rounded-xl glass grid place-items-center"><IconClock className="w-6 h-6 text-lilac" /></div>
          <div className="text-[15px] font-bold">No prompts yet</div>
          <p className="text-[13px] text-muted max-w-sm">Generate your first prompt from a reference video and it will live here — searchable, re-openable, forever yours.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((h) => {
            const m = getModel(h.modelId)
            return (
              <div key={h.id} className="glass rounded-xl p-4 flex flex-col gap-3 group hover:border-white/20 hover:shadow-glow-sm transition-[border-color,box-shadow] duration-200">
                <button onClick={() => open(h)} className="relative rounded-xl overflow-hidden h-36 cinematic-poster text-left" title="Open prompt kit">
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/[0.1] grid place-items-center opacity-80 group-hover:scale-105 transition-transform duration-150">
                      <IconExpand className="w-4 h-4 text-ink/90" />
                    </span>
                  </div>
                  <span className="absolute top-2.5 left-2.5 rounded-lg bg-black/40 border border-white/[0.12] px-2 py-1 text-[11px] font-bold" style={{ color: m.accent }}>{m.name}</span>
                  <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-black/40 border border-white/[0.12] px-2 py-1 text-[11px] font-semibold tabular-nums">{fmtTime(h.dna.duration)}</span>
                </button>
                <div className="min-w-0">
                  <div className="text-[14px] font-bold truncate" title={h.title}>{h.title}</div>
                  <div className="text-[11px] text-muted mt-1">{relDate(h.createdAt)} · {h.mode === 'recreate' ? 'Recreate' : 'Style & Motion'} · {h.charCount.toLocaleString()} chars</div>
                </div>
                <p className="text-[12px] text-muted leading-relaxed line-clamp-3">{h.prompt.slice(0, 160)}…</p>
                <div className="mt-auto flex items-center gap-2">
                  <Btn variant="primary" className="flex-1" onClick={() => open(h)}>
                    <IconExpand className="w-3.5 h-3.5" /> Open
                  </Btn>
                  <Btn variant="secondary" size="md" className="px-3" onClick={() => copy(h)} title="Copy the full prompt">
                    <IconCopy className="w-4 h-4" />
                  </Btn>
                  <Btn variant="ghost" size="md" className="px-3 hover:!text-red-300" onClick={() => { removeHistory(h.id); toast('Project deleted — video, DNA and artifacts removed', '🗑️') }} title="Delete project">
                    <IconTrash className="w-4 h-4" />
                  </Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Prompt viewer */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.title ?? ''}
        subtitle={viewing ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span style={{ color: getModel(viewing.modelId).accent }} className="font-semibold">{getModel(viewing.modelId).name}</span>
            <span>· {relDate(viewing.createdAt)} · {viewing.mode === 'recreate' ? 'Recreate' : 'Style & Motion'} · {viewing.charCount.toLocaleString()} chars</span>
          </span>
        ) : null}
        width={760}
        footer={
          viewing && (
            <div className="flex flex-wrap items-center gap-3">
              <Btn variant="primary" onClick={() => copy(viewing)}>
                <IconCopy className="w-4 h-4" /> Copy full prompt
              </Btn>
              {viewing.attachments?.length ? (
                <span className="text-[11px] text-lilac/90 font-semibold truncate">📎 Attach: {viewing.attachments.join(', ')}</span>
              ) : null}
              <span className="text-[11px] text-muted ml-auto">Paste straight into {getModel(viewing.modelId).name}</span>
            </div>
          )
        }
      >
        {viewing && <KitText text={viewing.prompt} onSection={(body, label) => { void copySection(body, label) }} />}
      </Modal>
    </div>
  )
}
