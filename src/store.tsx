import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { CompiledPrompt } from './engine/compiler'
import type { ModelAdapter } from './engine/models'
import { getModel } from './engine/models'
import { DEFAULT_GATEWAY, DEFAULT_PROXY_MODEL, type GatewayConfig } from './engine/gateway'
import type { Mode, VideoDna } from './engine/videoDna'

export interface HistoryItem {
  id: string
  title: string
  createdAt: number
  modelId: string
  mode: Mode
  prompt: string
  negative?: string
  charCount: number
  thumbnailSeed: string
  dna: VideoDna
  dnaVersion: string
  compilerVersion: string
  /** Reference image files the user should attach alongside the prompt. */
  attachments?: string[]
}

export interface Asset {
  id: string
  name: string
  type: string
  subtype: string
  dataUrl?: string
  seed: string
  createdAt: number
  /** The user's own description — given to the model verbatim as ground truth. */
  desc?: string
}

export interface Toast { id: number; text: string; icon?: string }

interface StoreState {
  onboarded: boolean
  defaultModelId: string
  defaultProxyModel: string
  deepReasoning: boolean
  credits: { used: number; total: number }
  history: HistoryItem[]
  assets: Asset[]
  gateway: GatewayConfig
}

interface StoreApi extends StoreState {
  setOnboarded: (v: boolean) => void
  setDefaultModel: (id: string) => void
  setDefaultProxyModel: (id: string) => void
  setDeepReasoning: (v: boolean) => void
  setGateway: (g: GatewayConfig) => void
  spendCredit: () => void
  addHistory: (h: HistoryItem) => void
  updateHistory: (id: string, patch: Partial<HistoryItem>) => void
  removeHistory: (id: string) => void
  addAsset: (a: Asset) => void
  updateAsset: (id: string, patch: Partial<Asset>) => void
  removeAsset: (id: string) => void
  toasts: Toast[]
  toast: (text: string, icon?: string) => void
  adapter: ModelAdapter
}

const KEY = 'ai-prompt-studio-v1'

const initial: StoreState = {
  onboarded: false,
  defaultModelId: 'veo',
  defaultProxyModel: DEFAULT_PROXY_MODEL,
  deepReasoning: true,
  credits: { used: 0, total: 3000 },
  history: [],
  assets: [],
  gateway: DEFAULT_GATEWAY,
}

// Hosted-deploy bootstrap: `?proxy=<url>` overrides the stored proxy URL without
// a rebuild — so one Vercel build works with any Railway proxy. E.g.
//   https://app.vercel.app/?proxy=https://my-proxy.up.railway.app
// The value is persisted, so plain visits afterwards keep using it.
function proxyOverride(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('proxy')
    return q ? q.trim().replace(/\/+$/, '') || null : null
  } catch { return null }
}

function load(): StoreState {
  try {
    const raw = localStorage.getItem(KEY)
    let s: StoreState = initial
    if (raw) {
      s = { ...initial, ...JSON.parse(raw) } as StoreState
      // Migration: proxy moved to its OAuth-correct port (localhost:3000).
      if (s.gateway?.url === 'http://localhost:8791') s.gateway = { ...s.gateway, url: DEFAULT_GATEWAY.url }
      if (!s.gateway?.url) s.gateway = DEFAULT_GATEWAY
    }
    const over = proxyOverride()
    if (over) s.gateway = { ...s.gateway, url: over }
    return s
  } catch {
    return initial
  }
}

const StoreCtx = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>(load)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* quota */ }
  }, [state])

  const toast = useCallback((text: string, icon?: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, icon }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const api = useMemo<StoreApi>(() => ({
    ...state,
    toasts,
    toast,
    adapter: getModel(state.defaultModelId),
    setOnboarded: (v) => setState((s) => ({ ...s, onboarded: v })),
    setDefaultModel: (id) => setState((s) => ({ ...s, defaultModelId: id })),
    setDefaultProxyModel: (id) => setState((s) => ({ ...s, defaultProxyModel: id })),
    setDeepReasoning: (v) => setState((s) => ({ ...s, deepReasoning: v })),
    setGateway: (g) => setState((s) => ({ ...s, gateway: g })),
    spendCredit: () => setState((s) => ({ ...s, credits: { ...s.credits, used: Math.min(s.credits.total, s.credits.used + 1) } })),
    addHistory: (h) => setState((s) => ({ ...s, history: [h, ...s.history].slice(0, 60) })),
    updateHistory: (id, patch) => setState((s) => ({
      ...s,
      history: s.history.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
    removeHistory: (id) => setState((s) => ({ ...s, history: s.history.filter((x) => x.id !== id) })),
    addAsset: (a) => setState((s) => ({ ...s, assets: [a, ...s.assets].slice(0, 40) })),
    updateAsset: (id, patch) => setState((s) => ({
      ...s,
      assets: s.assets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
    removeAsset: (id) => setState((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== id) })),
  }), [state, toasts, toast])

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}

export const relDate = (ts: number): string => {
  const d = new Date(ts)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const yest = new Date(today.getTime() - 86400000)
  if (isToday) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export type { CompiledPrompt }
