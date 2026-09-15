import React, { useCallback, useEffect, useState } from 'react'
import { gwChat, gwModels, gwPing, gwStatus, DEFAULT_PROXY_MODEL, prettyModelName, type GatewayModel, type GatewayStatus } from '../engine/gateway'
import { useStore } from '../store'
import { IconBolt, IconCheck, IconRefresh, IconShield, IconSpark } from './Icons'

type Ping = { ok: boolean; ms?: number; reply?: string; error?: string } | null

export default function Admin() {
  const store = useStore()
  const toast = store.toast
  const gateway = store.gateway ?? { url: 'http://localhost:8791' }
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [models, setModels] = useState<GatewayModel[]>([])
  const [url, setUrl] = useState(gateway.url)
  const [busy, setBusy] = useState('')
  const [ping, setPing] = useState<Ping>(null)
  const [sample, setSample] = useState('')
  const [error, setError] = useState('')

  const defaultModel = store.defaultProxyModel || DEFAULT_PROXY_MODEL

  const refresh = useCallback(async () => {
    setBusy('refresh')
    const st = await gwStatus(gateway)
    setStatus(st)
    setModels(await gwModels(gateway))
    setBusy('')
  }, [gateway])

  useEffect(() => { refresh() }, [refresh])

  const saveConn = async () => {
    store.setGateway({ url: url.trim().replace(/\/+$/, '') })
    toast('Proxy connection saved', '🔌')
    setTimeout(refresh, 50)
  }

  const useModel = (id: string) => {
    store.setDefaultProxyModel(id)
    toast(`Generation model → ${prettyModelName(id)}`, '⭐')
  }

  const doPing = async (model?: string) => {
    setBusy(model ? `ping:${model}` : 'ping')
    if (!model) { setPing(null); setError('') }
    const r = await gwPing(gateway, model || defaultModel)
    setBusy('')
    if (model) {
      r.ok ? toast(`${model}: ${r.ms}ms`, '🏓') : toast(r.error?.slice(0, 80) || 'ping failed', '⚠️')
      return
    }
    setPing(r)
    if (r.ok) toast(`Pong in ${r.ms}ms`, '🏓')
  }

  const genSample = async () => {
    setBusy('sample'); setSample(''); setError('')
    try {
      const out = await gwChat(
        gateway,
        [
          { role: 'system', content: 'You are the Prompt Compiler inside AI Prompt Studio. Output ONLY the final production-ready video-generation prompt paragraph. No preamble, no markdown.' },
          { role: 'user', content: 'Compile a Veo prompt for: 12-second continuous shot, man in black suit walking toward camera down a warm luxurious hotel corridor, camera tracking backward at eye level, warm golden practicals on marble, symmetrical composition, subject grows from 18% to 46% frame height, preserve identity/wardrobe/architecture, avoid foot sliding and identity drift.' },
        ],
        defaultModel,
        2048,
      )
      setSample(out.trim())
      toast('Sample prompt generated ✓', '✨')
    } catch (e) { setError(String((e as Error).message || e).slice(0, 300)) }
    setBusy('')
  }

  const connected = !!status?.connected
  const stateChip = !status?.reachable
    ? { cls: 'text-red-300', dot: 'bg-red-400', label: 'Container down' }
    : connected
      ? { cls: 'text-emerald-300', dot: 'bg-emerald-400 animate-bar-pulse', label: `Online · ${status.modelIds.length} models` }
      : { cls: 'text-amber-300', dot: 'bg-amber-400 animate-bar-pulse', label: 'Running · no account yet' }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-5 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-violet-glow/12 border border-violet-glow/25 grid place-items-center"><IconShield className="w-5 h-5 text-lilac" /></span>
            Admin · Engine Console
          </h1>
          <p className="page-description">Isolated Antigravity proxy · <span className="font-mono text-[12px]">{gateway.url}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`glass rounded-xl px-4 py-2 text-[12px] font-bold flex items-center gap-2 ${stateChip.cls}`}>
            <span className={`w-2 h-2 rounded-full ${stateChip.dot}`} /> {stateChip.label}
          </span>
          <button onClick={refresh} className="glass rounded-xl p-3 hover:border-white/20 transition-colors" title="Refresh">
            <IconRefresh className={`w-4 h-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="glass rounded-xl px-4 py-3 text-[13px] text-red-200 border-red-400/30">{error}</div>}

      {/* Connection + account */}
      <section className="glass-panel page-section">
        <h2 className="section-title flex items-center gap-2"><IconBolt className="w-[18px] h-[18px] text-lilac" /> Connect your Antigravity account</h2>
        {connected ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="glass rounded-xl px-4 py-3 text-[13px] flex items-center gap-2">
              <IconCheck className="w-4 h-4 text-emerald-400" /> Account connected · {status?.modelIds.length} models available
            </span>
              <a href={`${gateway.url.replace(/\/+$/, '')}`} target="_blank" rel="noreferrer" className="glass rounded-xl px-4 py-3 text-[13px] font-semibold text-lilac hover:border-white/20 transition-colors">
              Manage accounts ↗
            </a>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <a href={`${gateway.url.replace(/\/+$/, '')}`} target="_blank" rel="noreferrer" className="rounded-xl px-4 py-3 text-[13px] font-bold btn-primary hover:brightness-110 transition">
                1 · Open proxy dashboard ↗
              </a>
              <span className="text-[12px] text-muted">→ click <b>Add Account</b> → sign in with Google → done. Models appear here automatically.</span>
            </div>
            <button onClick={refresh} className="self-start glass rounded-xl px-4 py-3 text-[13px] font-semibold hover:border-white/20 transition-colors">
              2 · I've connected — recheck
            </button>
            <p className="text-[11px] text-muted">Tokens live only inside the proxy container (<span className="font-mono">antigravity-accounts.json</span>). This is a standalone Docker project — no connection to any other proxy.</p>
          </div>
        )}
        <div className="mt-4 grid sm:grid-cols-[1fr_auto] gap-3">
          <input aria-label="Gateway URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-proxy.up.railway.app" className="glass rounded-xl px-4 py-3 text-[13px] outline-none focus:border-white/20" />
          <button onClick={saveConn} className="rounded-xl px-4 py-3 text-[13px] font-bold bg-white/8 border border-white/10 hover:bg-white/14 transition">Save URL</button>
        </div>
        {typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\/(?!localhost|127\.0\.0\.1)/.test(gateway.url) && (
          <p className="mt-2 text-[12px] text-amber-300">⚠ This site is HTTPS but the proxy URL is HTTP — the browser will block it. Deploy the proxy with HTTPS (Railway gives you https://… automatically) and save that URL.</p>
        )}
      </section>

      {/* Model switcher */}
      <section className="glass-panel page-section">
        <h2 className="section-title flex items-center gap-2"><IconSpark className="w-[18px] h-[18px] text-lilac" /> Generation model</h2>
        <p className="text-[12px] text-muted mt-1">Used website-wide for every generation. Factory default: <span className="font-mono">{DEFAULT_PROXY_MODEL}</span>.</p>
        <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {models.map((m) => {
            const active = defaultModel === m.id
            return (
              <div key={m.id} className={`rounded-xl px-4 py-4 border transition-all ${active ? 'bg-violet-glow/12 border-violet-glow/40 shadow-glow-sm' : 'glass hover:border-white/20'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-violet-glow' : 'bg-white/20'}`} />
                  <span className="text-[13px] font-bold truncate" title={m.id}>{m.name}</span>
                  {m.id === DEFAULT_PROXY_MODEL && <span className="ml-auto text-[11px] font-bold tracking-wide text-emerald-300/90 bg-emerald-400/10 border border-emerald-400/25 rounded-full px-2 py-1 shrink-0">FACTORY DEFAULT</span>}
                </div>
                <div className="text-[11px] text-muted mt-1 leading-snug line-clamp-2 min-h-[26px]">{m.notes}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => useModel(m.id)} disabled={active}
                    className={`flex-1 rounded-lg py-2 text-[11px] font-bold transition ${active ? 'bg-violet-glow/20 text-ink cursor-default' : 'bg-white/8 hover:bg-white/14 border border-white/10'}`}>
                    {active ? '✓ Active default' : 'Set as default'}
                  </button>
                  <button onClick={() => doPing(m.id)} disabled={!connected || busy === `ping:${m.id}`}
                    className="glass rounded-lg px-3 py-2 text-[11px] font-semibold hover:border-white/20 transition-colors disabled:opacity-40" title="Ping this model">
                    {busy === `ping:${m.id}` ? '…' : 'Ping'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Test bench */}
      <section className="glass-panel page-section">
        <h2 className="section-title flex items-center gap-2">🧪 Test bench</h2>
        <p className="text-[12px] text-muted mt-1">Runs against <span className="font-mono">{prettyModelName(defaultModel)}</span> through the isolated proxy.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => doPing()} disabled={!connected || busy === 'ping'} className="glass rounded-xl px-4 py-3 text-[13px] font-bold hover:border-white/20 transition-colors disabled:opacity-40">
            {busy === 'ping' ? 'Pinging…' : 'Ping test'}
          </button>
          <button onClick={genSample} disabled={!connected || busy === 'sample'} className="rounded-xl px-4 py-3 text-[13px] font-bold btn-primary hover:brightness-110 transition disabled:opacity-40">
            {busy === 'sample' ? 'Compiling…' : 'Generate sample prompt'}
          </button>
        </div>
        {ping && (
          <div className={`mt-3 rounded-xl px-4 py-3 text-[13px] ${ping.ok ? 'bg-emerald-400/10 border border-emerald-400/25 text-emerald-100' : 'bg-red-400/10 border border-red-400/25 text-red-100'}`}>
            {ping.ok ? <>✓ Pong from <b>{prettyModelName(defaultModel)}</b> in <b>{ping.ms}ms</b> — “{ping.reply}”</> : <>✗ Ping failed: {ping.error}</>}
          </div>
        )}
        {sample && (
            <div className="mt-3 glass rounded-xl p-4">
            <div className="text-[11px] font-bold tracking-wide text-lilac mb-2">SAMPLE OUTPUT · {prettyModelName(defaultModel)}</div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink/90">{sample}</p>
          </div>
        )}
      </section>

      <div className="text-[11px] text-muted/70 flex items-center gap-2 pb-2">
        🛰️ aps-gateway · isolated deployment · open-source antigravity-proxy · admin console v1.1
      </div>
    </div>
  )
}
