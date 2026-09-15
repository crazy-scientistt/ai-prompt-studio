import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { CompiledPrompt } from './engine/compiler'
import type { ModelAdapter } from './engine/models'
import { getModel } from './engine/models'
import { DEFAULT_GATEWAY, DEFAULT_PROXY_MODEL, setAnalysisId, setGatewayAuth, type GatewayConfig } from './engine/gateway'
import * as billing from './engine/billing'
import type { BillingMeta, BillingUser, PlanOffer } from './engine/billing'
import { resolveRuntimeConfig } from './engine/runtime'
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
  /** Signed-in account (billing mode only). */
  authToken: string | null
  user: BillingUser | null
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
  // ── Billing (accounts + plans) ───────────────────────────────────────────
  /** True when the deployment has an accounts/payments backend configured. */
  billingMode: boolean
  /** False until the boot config/session check has finished (avoids a flash). */
  billingReady: boolean
  billingMeta: BillingMeta | null
  plans: PlanOffer[]
  signUp: (email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => void
  refreshUser: () => Promise<void>
  loadPlans: () => Promise<void>
  /**
   * Claim the right to run a model: spends a credit (or opens a free recompile)
   * and arms the analysis id every call in this run must carry. In legacy mode
   * there is nothing to ask, so it just debits the local counter.
   */
  beginAnalysis: (kind?: 'analysis' | 'recompile') => Promise<{ ok: true } | { ok: false; error: string; upgrade?: boolean }>
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
  authToken: null,
  user: null,
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
  const [billingMeta, setBillingMeta] = useState<BillingMeta | null>(null)
  const [plans, setPlans] = useState<PlanOffer[]>([])
  const [billingMode, setBillingMode] = useState(false)
  const [billingReady, setBillingReady] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* quota */ }
  }, [state])

  // ── Boot: resolve where the backend lives, restore the session ────────────
  // Hosted builds get their addresses from /api/config (nothing shipped in the
  // bundle); local dev falls through to the defaults. A `?proxy=` link is a
  // deliberate per-browser override and wins outright.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const token = state.authToken
      const override = proxyOverride()
      const cfg = override ? null : await resolveRuntimeConfig()
      if (!alive) return

      if (cfg?.billingUrl) {
        billing.setBillingUrl(cfg.billingUrl)
        setBillingMode(true)
        // In billing mode the AI endpoints live on the backend, which holds the
        // proxy key — so the browser never sees it.
        setState((s) => (s.gateway.url === cfg.billingUrl ? s : { ...s, gateway: { url: cfg.billingUrl } }))
        if (token) {
          billing.setBillingToken(token)
          setGatewayAuth(token)
        }
        const catalog = await billing.planCatalog()
        if (alive && catalog.ok && catalog.data) setPlans(catalog.data.plans)
        if (token) {
          const res = await billing.me()
          if (!alive) return
          if (res.ok && res.data) {
            setState((s) => ({ ...s, user: res.data!.user }))
            setBillingMeta(res.data.billing)
          } else if (res.status === 401) {
            // Stale token — drop it rather than looping on 401s.
            billing.setBillingToken(null)
            setGatewayAuth(null)
            setState((s) => ({ ...s, authToken: null, user: null }))
          }
        }
        if (alive) setBillingReady(true)
        return
      }

      if (cfg && cfg.proxyUrl) {
        const url = cfg.proxyUrl
        setState((s) => (s.gateway.url === url ? s : { ...s, gateway: { url } }))
      }
      if (alive) setBillingReady(true)
    })()
    return () => { alive = false }
    // Boot only: the resolved config is intentionally read once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toast = useCallback((text: string, icon?: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, icon }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const adopt = (next: { token: string; user: BillingUser } | null) => {
    billing.setBillingToken(next?.token ?? null)
    setGatewayAuth(next?.token ?? null)
    setState((s) => ({ ...s, authToken: next?.token ?? null, user: next?.user ?? null }))
  }

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await billing.auth.login(email, password)
    if (!res.ok || !res.data) return res.error || 'Could not sign in.'
    adopt(res.data)
    return null
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const res = await billing.auth.register(email, password)
    if (!res.ok || !res.data) return res.error || 'Could not create your account.'
    adopt(res.data)
    return null
  }, [])

  const signOut = useCallback(() => {
    void billing.auth.logout()
    adopt(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const res = await billing.me()
    if (res.ok && res.data) {
      setState((s) => ({ ...s, user: res.data!.user }))
      setBillingMeta(res.data.billing)
    }
  }, [])

  const loadPlans = useCallback(async () => {
    const res = await billing.planCatalog()
    if (res.ok && res.data) setPlans(res.data.plans)
  }, [])

  const api = useMemo<StoreApi>(() => ({
    ...state,
    toasts,
    toast,
    adapter: getModel(state.defaultModelId),
    billingMode,
    billingReady,
    billingMeta,
    plans,
    signUp,
    signIn,
    signOut,
    refreshUser,
    loadPlans,
    beginAnalysis: async (kind = 'analysis') => {
      if (billingMode) {
        const res = await billing.consumeCredit(kind)
        if (!res.ok || !res.data) {
          return { ok: false as const, error: res.error || 'Could not start the analysis.', upgrade: kind === 'analysis' }
        }
        setAnalysisId(res.data.analysisId)
        setState((s) => ({ ...s, user: res.data!.user }))
        return { ok: true as const }
      }
      // Legacy (no backend): the local counter is the ledger.
      if (kind === 'analysis') setState((s) => ({ ...s, credits: { ...s.credits, used: Math.min(s.credits.total, s.credits.used + 1) } }))
      return { ok: true as const }
    },
    setOnboarded: (v) => setState((s) => ({ ...s, onboarded: v })),
    setDefaultModel: (id) => setState((s) => ({ ...s, defaultModelId: id })),
    setDefaultProxyModel: (id) => setState((s) => ({ ...s, defaultProxyModel: id })),
    setDeepReasoning: (v) => setState((s) => ({ ...s, deepReasoning: v })),
    setGateway: (g) => setState((s) => ({ ...s, gateway: g })),
    // In billing mode the server owns the ledger, so this must not double-count.
    spendCredit: () => setState((s) => (billingMode ? s : { ...s, credits: { ...s.credits, used: Math.min(s.credits.total, s.credits.used + 1) } })),
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
  }), [state, toasts, toast, billingMode, billingReady, billingMeta, plans, signIn, signUp, signOut, refreshUser, loadPlans])

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
