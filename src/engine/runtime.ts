// ─────────────────────────────────────────────────────────────────────────────
// Runtime deployment config.
//
// A Vite build bakes VITE_* values into the public bundle, so a hosted deploy
// reads its addresses from the server instead (api/config.js on Vercel):
//
//   PROXY_URL   → the Antigravity proxy (legacy / no-accounts mode)
//   BILLING_URL → the accounts + payments backend (plans, credits, AI calls)
//
// When BILLING_URL is present the app runs in "billing mode": sign-in required,
// credits owned by the server, plan-gated models, and the AI calls go through
// the backend (which holds the proxy key) rather than straight to the proxy.
// Locally neither is set, so the app keeps working with no backend at all.
// ─────────────────────────────────────────────────────────────────────────────

const env = (k: string): string => {
  const e = (import.meta as unknown as { env?: Record<string, string> }).env
  return (e?.[k] ?? '').trim()
}

const clean = (u: string) => u.replace(/\/+$/, '')

export interface RuntimeConfig {
  proxyUrl: string
  billingUrl: string
  /** Where the values came from — surfaced in Settings for debugging. */
  source: 'runtime' | 'env' | 'default'
}

const FALLBACK: RuntimeConfig = {
  proxyUrl: clean(env('VITE_PROXY_URL') || 'http://localhost:3000'),
  billingUrl: clean(env('VITE_BILLING_URL')),
  source: env('VITE_PROXY_URL') || env('VITE_BILLING_URL') ? 'env' : 'default',
}

let cached: RuntimeConfig | null = null

/**
 * Resolve once per page load. A plain dev server answers unknown paths with
 * index.html, so a non-JSON response means "no runtime config here" and the
 * env/default values stand.
 */
export async function resolveRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached
  try {
    const r = await fetch('/api/config', { headers: { Accept: 'application/json' } })
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const j = await r.json().catch(() => null)
      const proxyUrl = clean(String(j?.proxyUrl || ''))
      const billingUrl = clean(String(j?.billingUrl || ''))
      if (proxyUrl || billingUrl) {
        cached = {
          proxyUrl: proxyUrl || FALLBACK.proxyUrl,
          billingUrl: billingUrl || FALLBACK.billingUrl,
          source: 'runtime',
        }
        return cached
      }
    }
  } catch {
    /* offline or no such route — use the fallback */
  }
  cached = FALLBACK
  return cached
}

/** Only for tests/dev: forget the resolved config. */
export const _resetRuntimeConfig = () => {
  cached = null
}
