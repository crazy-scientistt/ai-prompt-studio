import React, { useRef, useState } from 'react'
import { useStore, type Asset } from '../store'
import { IconImage, IconPlus, IconTrash, IconUpload } from './Icons'
import { seedColor } from './Studio'
import { Btn, Modal } from './ui'

/* The user is the librarian: they choose the type and write the description.
   Nothing is auto-assigned — the description is given to the model verbatim. */
const TYPES = ['All', 'Character', 'Product', 'Vehicle', 'Location', 'Outfit', 'Prop', 'Style', 'Logo']
const PICK_TYPES = TYPES.filter((t) => t !== 'All')

const TYPE_HINTS: Record<string, string> = {
  Character: 'A person, creature or persona that can replace or appear in the video',
  Product: 'A physical product to showcase or place into scenes',
  Vehicle: 'A car, bike, ship — anything that drives or flies',
  Location: 'An environment or backdrop for the scene',
  Outfit: 'Clothing the subject should wear',
  Prop: 'An object the subject holds or interacts with',
  Style: 'A look/grade reference — colors, grain, mood',
  Logo: 'A brand mark to reproduce exactly',
}

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

/* ── The details dialog shown for every upload ─────────────────────────────── */
function AssetDetailsDialog({
  pending, onClose, onSave,
}: {
  pending: { name: string; dataUrl: string }[]
  onClose: () => void
  onSave: (items: { name: string; dataUrl: string; type: string; subtype: string; desc: string }[]) => void
}) {
  const [rows, setRows] = useState(
    pending.map((p) => ({ ...p, type: 'Character', subtype: 'Custom', desc: '' })),
  )
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const save = () => {
    onSave(rows.map((r) => ({
      ...r,
      subtype: PICK_TYPES.includes(r.type) ? 'Custom' : 'Custom',
      desc: r.desc.trim(),
    })))
  }

  return (
    <Modal open onClose={onClose} title="Describe your asset" subtitle="The studio uses your words — nothing is guessed from the filename." width={640}>
      <div className="flex flex-col gap-4">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-3">
              <img src={r.dataUrl} alt={r.name} className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0" />
              <div className="min-w-0 flex-1">
                <label className="text-[11px] font-bold tracking-wide text-muted uppercase">Name</label>
                <input
                  aria-label="Asset name"
                  value={r.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                  className="mt-1 w-full h-[32px] rounded-lg bg-white/[0.05] border border-white/10 px-3 text-[13px] font-semibold text-ink outline-none focus:border-white/20 transition-colors"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-bold tracking-wide text-muted uppercase">What is it?</label>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Asset type">
                {PICK_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={r.type === t}
                    onClick={() => set(i, { type: t })}
                    className={`h-[28px] rounded-lg px-3 text-[12px] font-bold border transition-colors ${
                      r.type === t ? 'bg-violet-glow/20 border-violet-glow/50 text-ink' : 'bg-white/[0.03] border-white/10 text-muted hover:text-ink'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-muted mt-2">{TYPE_HINTS[r.type]}</div>
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-bold tracking-wide text-muted uppercase">
                Description <span className="text-lilac normal-case font-semibold">· the model reads this</span>
              </label>
              <textarea
                aria-label="Asset description"
                value={r.desc}
                onChange={(e) => set(i, { desc: e.target.value })}
                rows={3}
                placeholder="e.g. Young woman, early 20s, glossy translucent sapphire-blue skin with a faintly glowing skeleton inside, bald head, thin blue glasses, athletic build, always barefoot."
                className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-3 text-[12px] leading-relaxed text-ink placeholder:text-muted/60 outline-none focus:border-white/20 transition-colors resize-none"
              />
              <div className="text-[11px] text-muted mt-1">
                What the model must keep identical everywhere. Write it like you'd describe it to a friend.
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" className="ml-auto" onClick={save}>
          <IconPlus className="w-4 h-4" /> Save {rows.length > 1 ? `${rows.length} assets` : 'asset'}
        </Btn>
      </div>
    </Modal>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────────── */
export default function Assets() {
  const { assets, addAsset, updateAsset, removeAsset, toast } = useStore()
  const [filter, setFilter] = useState('All')
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; dataUrl: string }[]>([])
  const [editing, setEditing] = useState<Asset | null>(null)

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) { toast('Please choose image files', '⚠️'); return }
    const read = await Promise.all(imgs.map(async (f) => ({ name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24), dataUrl: await readFile(f) })))
    setPending(read)
  }

  const savePending = (items: { name: string; dataUrl: string; type: string; subtype: string; desc: string }[]) => {
    items.forEach((it) => {
      addAsset({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: it.name || 'Untitled asset',
        type: it.type,
        subtype: 'Custom',
        dataUrl: it.dataUrl,
        seed: it.name,
        createdAt: Date.now(),
        desc: it.desc,
      })
    })
    setPending([])
    toast(`Asset${items.length > 1 ? 's' : ''} saved to your library`, '✅')
  }

  const addDemo = () => {
    const asset: Asset = {
      id: `a-${Date.now()}`,
      name: 'Lamborghini',
      type: 'Vehicle',
      subtype: 'Custom',
      seed: 'lamborghini-demo',
      createdAt: Date.now(),
      desc: 'Matte black Lamborghini Aventador, sharp angular body lines, yellow accent stripe along the rocker panels, scissor doors, low stance.',
    }
    addAsset(asset)
    toast('Demo asset added — upload your own images anytime', '🚗')
  }

  const shown = assets.filter((a) => filter === 'All' || a.type === filter)

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-5 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">My Assets</h1>
          <p className="page-description">Characters, products, vehicles, locations — you name them, you describe them. Your words go straight to the model.</p>
        </div>
        <label className="relative cursor-pointer rounded-xl px-5 py-3 font-bold text-[13px] text-white btn-primary hover:brightness-110 transition flex items-center gap-2">
          <IconUpload className="w-4 h-4" /> Upload Asset
          <input ref={fileRef} type="file" aria-label="Upload asset" accept="image/*" multiple className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold border transition-colors ${filter === t ? 'bg-violet-glow/20 border-violet-glow/50 text-ink' : 'glass text-muted hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files) }}
        className="flex-1"
      >
        {shown.length === 0 ? (
          <div className="glass rounded-xl flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
            <div className="w-14 h-14 rounded-xl glass grid place-items-center"><IconImage className="w-6 h-6 text-lilac" /></div>
            <div className="text-[15px] font-bold">{assets.length === 0 ? 'Your library is empty' : `No ${filter} assets yet`}</div>
            <p className="text-[13px] text-muted max-w-sm">Upload an image, choose what it is, and describe it in your own words — the engine keeps exactly that consistent.</p>
            <div className="flex gap-2 mt-1">
              <button onClick={addDemo} className="glass rounded-xl px-4 py-3 text-[13px] font-semibold hover:border-white/20 transition-colors">Add demo asset</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            {shown.map((a) => (
              <div key={a.id} className="glass rounded-xl p-3 flex flex-col gap-3 group hover:border-white/20 hover:shadow-glow-sm transition-[border-color,box-shadow] duration-200">
                <div className="relative rounded-xl overflow-hidden aspect-square bg-white/[0.03]">
                  {a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-4xl" style={{ background: seedColor(a.seed) }}>
                      <span className="drop-shadow-lg">{a.type === 'Vehicle' ? '🏎️' : a.type === 'Character' ? '🧑‍🎤' : '📦'}</span>
                    </div>
                  )}
                  <button
                    onClick={() => { removeAsset(a.id); toast(`"${a.name}" removed`, '🗑️') }}
                    className="absolute top-2 right-2 glass rounded-lg p-2 text-muted hover:text-red-300 transition-colors"
                    title={`Delete ${a.name}`}
                    aria-label={`Delete ${a.name}`}
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="px-1 pb-1">
                  <div className="text-[13px] font-bold truncate">{a.name}</div>
                  <div className="text-[11px] text-muted">{a.type}{a.desc ? ' · described' : ' · no description'}</div>
                  <button
                    onClick={() => setEditing(a)}
                    className="mt-2 text-[11px] font-semibold text-lilac hover:text-ink transition-colors"
                  >
                    {a.desc ? 'Edit details' : 'Add details'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload flow: user picks type + writes the description */}
      {pending.length > 0 && (
        <AssetDetailsDialog pending={pending} onClose={() => setPending([])} onSave={savePending} />
      )}

      {/* Edit an existing asset's type/description */}
      {editing && (
        <AssetEditDialog asset={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

/* ── Edit dialog reuses the same field layout for one existing asset ───────── */
function AssetEditDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { updateAsset, toast } = useStore()
  const [type, setType] = useState(asset.type)
  const [name, setName] = useState(asset.name)
  const [desc, setDesc] = useState(asset.desc ?? '')

  return (
    <Modal open onClose={onClose} title={`Edit ${asset.name}`} subtitle="Your description is what the model receives." width={560}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-[11px] font-bold tracking-wide text-muted uppercase">Name</label>
          <input
            aria-label="Asset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full h-[36px] rounded-lg bg-white/[0.05] border border-white/10 px-3 text-[13px] font-semibold text-ink outline-none focus:border-white/20 transition-colors"
          />
        </div>
        <div>
          <label className="text-[11px] font-bold tracking-wide text-muted uppercase">What is it?</label>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Asset type">
            {PICK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={`h-[28px] rounded-lg px-3 text-[12px] font-bold border transition-colors ${
                  type === t ? 'bg-violet-glow/20 border-violet-glow/50 text-ink' : 'bg-white/[0.03] border-white/10 text-muted hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-bold tracking-wide text-muted uppercase">
            Description <span className="text-lilac normal-case font-semibold">· the model reads this</span>
          </label>
          <textarea
            aria-label="Asset description"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={4}
            placeholder="Describe what must stay identical everywhere this asset is used…"
            className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-3 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 outline-none focus:border-white/20 transition-colors resize-none"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn
          variant="primary"
          className="ml-auto"
          onClick={() => {
            updateAsset(asset.id, { name: name.trim() || asset.name, type, desc: desc.trim() })
            toast('Asset updated', '✅')
            onClose()
          }}
        >
          Save changes
        </Btn>
      </div>
    </Modal>
  )
}
