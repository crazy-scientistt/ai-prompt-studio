// ─────────────────────────────────────────────────────────────────────────────
// Safepay client (cards + JazzCash + EasyPaisa in one checkout).
//
// Flow, per Safepay's own SDK:
//   1. POST {api}/order/v1/init  { environment, amount, currency, client } → { data: { token } }
//      (that token is the "tracker")
//   2. Send the browser to  {checkout}/checkout/pay?beacon=<tracker>&env=…&order_id=…&redirect_url=…
//   3. Safepay POSTs { tracker, sig } to redirect_url on success. Verify with
//      HMAC-SHA256(tracker, v1Secret) — never trust the redirect alone.
//   4. Safepay also POSTs webhooks signed with X-SFPY-SIGNATURE =
//      HMAC-SHA512(JSON.stringify(body.data), webhookSecret). That second path
//      matters for wallet payments, which can settle after the redirect.
//
// Amounts are sent as plain PKR rupees (Safepay's `floatval(amount)`).
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto'

const ENV = (process.env.SAFEPAY_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox'
const API_KEY = process.env.SAFEPAY_API_KEY || ''
const V1_SECRET = process.env.SAFEPAY_V1_SECRET || ''
const WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET || ''

const SANDBOX_API = 'https://sandbox.api.getsafepay.com'
const PRODUCTION_API = 'https://api.getsafepay.com'
// Checkout is hosted on the merchant site in production, on the api host in sandbox.
const SANDBOX_CHECKOUT = 'https://sandbox.api.getsafepay.com'
const PRODUCTION_CHECKOUT = 'https://getsafepay.com'

export const configured = () => !!(API_KEY && V1_SECRET)
export const webhooksConfigured = () => !!WEBHOOK_SECRET
export const environment = () => ENV
const apiBase = () => (ENV === 'sandbox' ? SANDBOX_API : PRODUCTION_API)
const checkoutBase = () => (ENV === 'sandbox' ? SANDBOX_CHECKOUT : PRODUCTION_CHECKOUT)

// Allow a local mock during development/tests so the whole flow can be
// exercised without live credentials.
const MOCK = process.env.SAFEPAY_MOCK === '1'

/**
 * Create a tracker and return its token.
 * @returns {Promise<{ ok: boolean, token?: string, error?: string }>}
 */
export async function createTracker({ amount, currency }) {
  if (MOCK) return { ok: true, token: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` }
  if (!API_KEY) return { ok: false, error: 'SAFEPAY_API_KEY is not configured' }
  try {
    const r = await fetch(`${apiBase()}/order/v1/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: ENV, amount: Number(amount), currency, client: API_KEY }),
    })
    const j = await r.json().catch(() => null)
    const message = j?.status?.message
    const token = j?.data?.token || j?.data?.tracker || j?.data?.beacon
    if (!token) return { ok: false, error: message || `Safepay rejected the request (HTTP ${r.status})`, raw: j }
    return { ok: true, token, raw: j }
  } catch (e) {
    return { ok: false, error: `Could not reach Safepay: ${e?.message || e}` }
  }
}

/** Hosted checkout URL the browser is redirected to. */
export function checkoutUrl({ tracker, orderId, successUrl, cancelUrl }) {
  const params = new URLSearchParams({
    env: ENV,
    beacon: tracker,
    source: 'custom',
    order_id: String(orderId),
    redirect_url: successUrl,
    cancel_url: cancelUrl,
    webhooks: 'true',
  })
  return `${checkoutBase()}/checkout/pay?${params.toString()}`
}

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8')
  const y = Buffer.from(String(b || ''), 'utf8')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/** Success-page signature: HMAC-SHA256(tracker, v1Secret). */
export function verifySuccessSignature(tracker, signature) {
  if (MOCK) return !!tracker && !!signature
  if (!tracker || !signature || !V1_SECRET) return false
  const expected = createHmac('sha256', V1_SECRET).update(String(tracker)).digest('hex')
  return safeEqualHex(expected, signature)
}

/**
 * Webhook signature: HMAC-SHA512 over the re-serialised `data` sub-object.
 * We also accept SHA-256 over the raw body, because Safepay has shipped both
 * shapes across product lines and a rejected-but-genuine webhook is worse than
 * accepting either — the amount is re-checked against the order afterwards.
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (MOCK) return true
  if (!WEBHOOK_SECRET || !signature) return false
  const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8')
  const candidates = []
  try {
    const parsed = JSON.parse(body)
    if (parsed?.data) {
      candidates.push(createHmac('sha512', WEBHOOK_SECRET).update(JSON.stringify(parsed.data)).digest('hex'))
      candidates.push(createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(parsed.data)).digest('hex'))
    }
  } catch {
    /* fall through to the raw-body variants */
  }
  candidates.push(createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex'))
  candidates.push(createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'))
  return candidates.some((c) => safeEqualHex(c, signature))
}

/**
 * Pull the fields we care about out of whatever shape the gateway sent.
 * Field names differ between Safepay products, so every lookup is defensive —
 * the authoritative check is the amount against our own pending order.
 */
export function readEvent(payload) {
  const d = payload?.data || payload || {}
  const tracker = d.tracker || d.beacon || d.tracker_token || null
  const orderId = d.order_id || d.orderId || d.merchant_order_id || null
  const amount = Number(d.amount ?? d.paid_amount ?? NaN)
  const currency = d.currency || d.currency_code || null
  const state = String(d.state || d.status || d.payment_state || payload?.type || '').toUpperCase()
  const failed = /FAIL|CANCEL|DECLINE|EXPIRED|VOID/.test(state)
  return { tracker, orderId, amount, currency, state, failed, raw: payload }
}
