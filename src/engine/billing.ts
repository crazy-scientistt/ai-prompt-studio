// ─────────────────────────────────────────────────────────────────────────────
// Client for the accounts + payments backend (server/api).
//
// Only used when a backend URL is configured (see engine/runtime.ts). In the
// legacy direct-proxy mode nothing here is called and the app behaves as before.
// ─────────────────────────────────────────────────────────────────────────────

let baseUrl = ''
let token: string | null = null

export function setBillingUrl(url: string) {
  baseUrl = (url || '').replace(/\/+$/, '')
}

export function billingUrl() {
  return baseUrl
}

export function setBillingToken(value: string | null) {
  token = value
}

export function billingToken() {
  return token
}

export interface BillingUser {
  id: string
  email: string
  plan: 'free' | 'plus' | 'pro'
  planName: string
  cycle: 'monthly' | 'yearly' | null
  credits: number
  planExpiresAt: number | null
  nextCreditsAt: number | null
  /** True only for plans allowed to pick the model themselves (Pro). */
  modelSelection: boolean
  tiers: string[]
  monthlyCredits: number
  recompilesLeft: number
  spentTotal: number
  createdAt: number
}

export interface PlanOffer {
  id: string
  name: string
  tagline: string
  credits: number
  tiers: string[]
  selectable: boolean
  highlights: string[]
  monthly: number
  yearly: number
  perMonthIfYearly: number
}

export interface PlanCatalog {
  currency: string
  yearlyDiscount: number
  freeCredits: number
  plans: PlanOffer[]
}

export interface BillingMeta {
  gateway: string
  environment: string
  configured: boolean
  upstream: { configured: boolean; url: string }
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
  code?: string
}

async function call<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  if (!baseUrl) return { ok: false, status: 0, error: 'No billing backend is configured.' }
  try {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    let json: Record<string, unknown> | null = null
    try {
      json = JSON.parse(text)
    } catch {
      /* non-JSON error page */
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: (json?.error as string) || `Request failed (${r.status})`,
        code: (json?.code as string) || undefined,
      }
    }
    return { ok: true, status: r.status, data: (json ?? {}) as T }
  } catch (e) {
    return { ok: false, status: 0, error: `Can't reach the server: ${(e as Error).message}` }
  }
}

export const auth = {
  register: (email: string, password: string) =>
    call<{ token: string; user: BillingUser }>('/api/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) =>
    call<{ token: string; user: BillingUser }>('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => call('/api/auth/logout', { method: 'POST' }),
}

export const me = () => call<{ user: BillingUser; billing: BillingMeta }>('/api/me')

export const planCatalog = () => call<PlanCatalog>('/api/plans')

export const startCheckout = (planId: string, cycle: 'monthly' | 'yearly') =>
  call<{ orderId: string; amount: number; currency: string; checkoutUrl: string }>('/api/billing/checkout', {
    method: 'POST',
    body: { planId, cycle },
  })

/**
 * Spend a credit (or open a free recompile) — the server returns the analysis id
 * every model call in this run must carry.
 */
export const consumeCredit = (kind: 'analysis' | 'recompile') =>
  call<{ analysisId: string; kind: string; callsRemaining: number; recompilesLeft: number; user: BillingUser }>(
    '/api/billing/consume',
    { method: 'POST', body: { kind } },
  )

export const siteModel = () => call<{ model: string; source: string; requested?: string }>('/api/site-model')

export const fmtPkr = (amount: number) => `Rs ${amount.toLocaleString('en-PK')}`

export const cycleLabel = (cycle: 'monthly' | 'yearly' | null) =>
  cycle === 'yearly' ? 'Yearly' : cycle === 'monthly' ? 'Monthly' : '—'
