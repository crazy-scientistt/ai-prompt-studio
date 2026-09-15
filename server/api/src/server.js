// ─────────────────────────────────────────────────────────────────────────────
// AI Prompt Studio — accounts, plans and payments backend.
//
// Zero dependencies (node:http + node:crypto + fetch), so it deploys as a plain
// Node service with nothing to install and nothing to keep patched.
//
//   POST /api/auth/register          create an account (free credits included)
//   POST /api/auth/login             → Bearer session token
//   GET  /api/me                     current user, plan, credits
//   GET  /api/plans                  pricing catalog (monthly + yearly)
//   POST /api/billing/checkout       { planId, cycle } → Safepay checkout URL
//   GET/POST /api/billing/return     Safepay success redirect → verify + grant
//   POST /api/webhooks/safepay       gateway webhook → verify + grant
//   POST /api/billing/consume        { kind } → opens an analysis session
//   GET  /api/site-model             this plan's generation model
//   /v1/*                            AI calls, credit- and plan-enforced
//
// Credits move only after a signature we verify ourselves or a webhook signed
// with the gateway's secret — never on a client's word.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { checkPassword, hashPassword, passwordProblem, signSession, tokenHash, validEmail, verifySession } from './auth.js'
import { PLANS, catalog, priceFor } from './plans.js'
import { handleV1, isAdmin, openSession, recompilesLeft, recordUsage, siteModelFor, upstreamKeyConfigured, upstreamUrl } from './proxy.js'
import { checkoutUrl, configured, createTracker, environment, readEvent, verifySuccessSignature, verifyWebhookSignature } from './safepay.js'
import {
  activatePlan,
  addSession,
  dropSession,
  findByEmail,
  findById,
  findOrder,
  findOrderByTracker,
  firstEvent,
  grantCredits,
  makeOrder,
  makeUser,
  read,
  reconcile,
  transact,
  transactMaybe,
} from './store.js'

const PORT = Number(process.env.PORT || 8080)
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'

// ── Helpers ─────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Analysis-Id, X-Admin-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...extra })
  res.end(JSON.stringify(body))
}

const ok = (res, body = {}, status = 200) => send(res, status, { ok: true, ...body })
const fail = (res, status, error, code) => send(res, status, { ok: false, error, code })

async function readRaw(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error('body too large')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJson(req) {
  const raw = await readRaw(req, 2 * 1024 * 1024)
  if (!raw) return {}
  const type = req.headers['content-type'] || ''
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw))
  try {
    return JSON.parse(raw)
  } catch {
    // Safepay's success redirect can arrive form-encoded even without the header.
    return Object.fromEntries(new URLSearchParams(raw))
  }
}

function userView(user) {
  const plan = PLANS[user.plan] || PLANS.free
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    planName: plan.name,
    cycle: user.cycle,
    credits: user.credits,
    planExpiresAt: user.planExpiresAt,
    nextCreditsAt: user.nextCreditsAt,
    modelSelection: !!plan.selectable,
    tiers: plan.tiers,
    monthlyCredits: plan.credits,
    recompilesLeft: recompilesLeft(user),
    spentTotal: user.spentTotal || 0,
    createdAt: user.createdAt,
  }
}

/** Resolve the caller from Bearer token, reconciling their cycle if needed. */
async function authenticate(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const claims = verifySession(token)
  if (!claims) return null
  const hash = tokenHash(token)
  const result = await transactMaybe(async (db) => {
    const session = db.sessions.find((s) => s.tokenHash === hash)
    if (!session) return null
    const user = findById(db, session.userId)
    if (!user) return null
    const before = `${user.plan}|${user.credits}|${user.nextCreditsAt}|${user.planExpiresAt}`
    reconcile(user)
    const after = `${user.plan}|${user.credits}|${user.nextCreditsAt}|${user.planExpiresAt}`
    return { user, dirty: before !== after }
  })
  return result?.user || null
}

/** Persist mutations a handler made to a user object it received. */
const commit = () => transactMaybe(async () => ({ dirty: true }))

// ── Auth ────────────────────────────────────────────────────────────────────

async function register(req, res) {
  const { email, password } = await readJson(req)
  if (!validEmail(email)) return fail(res, 400, 'Enter a valid email address.', 'email')
  const pwProblem = passwordProblem(password)
  if (pwProblem) return fail(res, 400, pwProblem, 'password')

  const { hash, salt } = hashPassword(password)
  const created = await transact(async (db) => {
    if (findByEmail(db, email)) return { exists: true }
    const user = makeUser({ email, passwordHash: hash, salt })
    db.users.push(user)
    return { user }
  })
  if (created.exists) return fail(res, 409, 'That email already has an account — sign in instead.', 'exists')

  const token = signSession(created.user.id)
  await transact(async (db) =>
    addSession(db, { id: randomUUID(), userId: created.user.id, tokenHash: tokenHash(token), createdAt: Date.now() }),
  )
  return ok(res, { token, user: userView(created.user) })
}

async function login(req, res) {
  const { email, password } = await readJson(req)
  const found = await read((db) => findByEmail(db, email))
  // Identical message either way: don't leak which emails exist.
  const bad = () => fail(res, 401, 'Email or password is incorrect.', 'credentials')
  if (!found) return bad()
  if (!checkPassword(password, found.salt, found.passwordHash)) return bad()

  const token = signSession(found.id)
  await transact(async (db) => {
    addSession(db, { id: randomUUID(), userId: found.id, tokenHash: tokenHash(token), createdAt: Date.now() })
    reconcile(found)
  })
  return ok(res, { token, user: userView(found) })
}

async function logout(req, res, user, token) {
  if (!user) return ok(res)
  await transact(async (db) => dropSession(db, tokenHash(token)))
  return ok(res)
}

const billingStatus = () => ({
  gateway: 'safepay',
  environment: environment(),
  configured: configured(),
  upstream: { configured: upstreamKeyConfigured(), url: upstreamUrl() },
})

async function me(req, res, user) {
  return ok(res, { user: userView(user), billing: billingStatus() })
}

// ── Payments ────────────────────────────────────────────────────────────────

async function checkout(req, res, user) {
  const { planId, cycle = 'monthly' } = await readJson(req)
  const plan = PLANS[planId]
  if (!plan || !plan.monthly) return fail(res, 400, 'Choose Plus or Pro to continue.', 'plan')
  if (cycle !== 'monthly' && cycle !== 'yearly') return fail(res, 400, 'Unknown billing cycle.', 'cycle')
  if (!configured()) return fail(res, 503, 'Payments are not configured on the server yet (SAFEPAY_API_KEY / SAFEPAY_V1_SECRET).', 'unconfigured')

  const amount = priceFor(planId, cycle)
  const order = makeOrder({ userId: user.id, planId, cycle, amount, currency: 'PKR' })
  const tracker = await createTracker({ amount, currency: 'PKR' })
  if (!tracker.ok) return fail(res, 502, tracker.error || 'Could not start the payment.', 'gateway')

  order.tracker = tracker.token
  await transact(async (db) => {
    db.orders.push(order)
    return order
  })

  return ok(res, {
    orderId: order.id,
    amount,
    currency: 'PKR',
    checkoutUrl: checkoutUrl({
      tracker: tracker.token,
      orderId: order.id,
      successUrl: `${PUBLIC_URL}/api/billing/return`,
      cancelUrl: `${APP_URL}/#/plans?canceled=1`,
    }),
  })
}

/**
 * The one place credits ever increase. Idempotent: the order is read and flipped
 * inside a single locked transaction, so the browser redirect and the webhook
 * arriving together cannot double-grant.
 */
async function grantOrder({ orderId, tracker, evidence }) {
  return transact(async (db) => {
    const order = (orderId && findOrder(db, orderId)) || (tracker && findOrderByTracker(db, tracker))
    if (!order) return { ok: false, reason: 'unknown_order' }
    if (order.status === 'paid') return { ok: true, already: true, order }
    const user = findById(db, order.userId)
    if (!user) return { ok: false, reason: 'unknown_user' }
    order.status = 'paid'
    order.paidAt = Date.now()
    order.tracker = order.tracker || tracker || null
    order.evidence = evidence || null
    activatePlan(user, order.planId, order.cycle)
    return { ok: true, order, user }
  })
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, ...cors })
  res.end()
}

/** Safepay posts { tracker, sig } here after a successful payment. */
async function billingReturn(req, res, url) {
  const body = await readJson(req).catch(() => ({}))
  const tracker = body.tracker || url.searchParams.get('tracker')
  const sig = body.sig || body.signature || url.searchParams.get('sig')

  if (!tracker) return redirect(res, `${APP_URL}/#/plans?error=missing_tracker`)
  if (!verifySuccessSignature(tracker, sig)) {
    console.warn('[billing] rejected return with a bad signature', { tracker })
    return redirect(res, `${APP_URL}/#/plans?error=signature`)
  }
  const order = await read((db) => findOrderByTracker(db, tracker))
  if (!order) return redirect(res, `${APP_URL}/#/plans?error=unknown_order`)

  const result = await grantOrder({ orderId: order.id, tracker, evidence: 'return' })
  if (!result.ok) return redirect(res, `${APP_URL}/#/plans?error=${result.reason}`)
  return redirect(res, `${APP_URL}/#/plans?paid=1&plan=${order.planId}&order=${order.id}`)
}

/** Gateway webhook — at-least-once delivery, so every event is idempotent. */
async function webhook(req, res) {
  const raw = await readRaw(req, 4 * 1024 * 1024)
  const signature = req.headers['x-sfpy-signature'] || req.headers['x-safepay-signature']
  if (!verifyWebhookSignature(raw, signature)) {
    console.warn('[billing] webhook rejected: bad signature')
    return fail(res, 401, 'Invalid signature', 'signature')
  }

  let payload
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    return fail(res, 400, 'Malformed payload', 'payload')
  }

  const eventId = req.headers['x-sfpy-event-id'] || payload?.event?.id || payload?.id
  const duplicate = await transact(async (db) => !firstEvent(db, eventId))
  if (duplicate) return ok(res, { duplicate: true })

  const event = readEvent(payload)

  if (event.failed) {
    const marked = await transact(async (db) => {
      const o = (event.orderId && findOrder(db, event.orderId)) || (event.tracker && findOrderByTracker(db, event.tracker))
      if (!o || o.status === 'paid') return null
      o.status = 'failed'
      o.raw = payload
      return o
    })
    console.log('[billing] payment failed', { tracker: event.tracker, state: event.state })
    return ok(res, { failed: true, order: marked?.id || null })
  }

  // The amount is checked against our own order: a signed event claiming less
  // than the plan costs grants nothing.
  const precheck = await transact(async (db) => {
    const order = (event.orderId && findOrder(db, event.orderId)) || (event.tracker && findOrderByTracker(db, event.tracker))
    if (!order) return { ok: false, reason: 'unknown_order' }
    if (Number.isFinite(event.amount) && event.amount + 0.01 < order.amount) return { ok: false, reason: 'amount_mismatch' }
    order.raw = payload
    return { ok: true, order }
  })
  if (!precheck.ok) {
    console.warn('[billing] webhook ignored', precheck.reason, { tracker: event.tracker, amount: event.amount })
    return ok(res, { ignored: precheck.reason })
  }

  const result = await grantOrder({ orderId: precheck.order.id, tracker: event.tracker, evidence: 'webhook' })
  console.log('[billing] webhook granted', { order: precheck.order.id, plan: precheck.order.planId, already: !!result.already })
  return ok(res, { granted: true, already: !!result.already })
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** Open an analysis session — this is where a credit is actually spent. */
async function consume(req, res, user) {
  const body = await readJson(req).catch(() => ({}))
  const kind = body.kind === 'recompile' ? 'recompile' : 'analysis'
  const isRecompile = kind === 'recompile'

  if (isRecompile && recompilesLeft(user) <= 0) return fail(res, 429, 'Free recompiles for today are used up.', 'recompile_limit')

  const id = randomUUID()
  const result = await transact(async (db) => {
    const fresh = findById(db, user.id)
    if (!fresh) return { error: 'unknown_user' }
    reconcile(fresh)
    if (!isRecompile && fresh.credits <= 0) return { error: 'no_credits' }
    if (!isRecompile) {
      fresh.credits -= 1
      fresh.spentTotal = (fresh.spentTotal || 0) + 1
    }
    recordUsage(fresh, { at: Date.now(), kind, sessionId: id })
    const session = openSession(fresh, { id, kind, credits: isRecompile ? 0 : 1 })
    return { session, view: userView(fresh) }
  })

  if (result.error === 'no_credits') {
    return send(res, 402, { ok: false, code: 'no_credits', error: 'You are out of credits. Upgrade your plan to keep generating.', upgrade: true })
  }
  if (result.error) return fail(res, 404, 'Account not found.', 'user')

  return ok(res, {
    analysisId: result.session.id,
    kind: result.session.kind,
    expiresAt: result.session.expiresAt,
    callsRemaining: result.session.callsRemaining,
    recompilesLeft: result.view.recompilesLeft,
    user: result.view,
  })
}

async function siteModel(req, res, user) {
  return ok(res, await siteModelFor(user))
}

// ── Admin (owner only) ──────────────────────────────────────────────────────

async function adminRoutes(req, res, path) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return fail(res, 401, 'Admin key required.', 'admin')
  if (path === '/api/admin/users') {
    return ok(res, { users: await read((db) => db.users.map(userView)) })
  }
  const body = await readJson(req).catch(() => ({}))
  if (path === '/api/admin/grant') {
    const target = await transact(async (db) => {
      const u = findByEmail(db, body.email)
      if (!u) return null
      grantCredits(db, u, Number(body.credits || 0))
      return userView(u)
    })
    if (!target) return fail(res, 404, 'No such user.', 'user')
    return ok(res, { user: target })
  }
  if (path === '/api/admin/setplan') {
    const target = await transact(async (db) => {
      const u = findByEmail(db, body.email)
      if (!u) return null
      if (body.plan === 'free') {
        u.plan = 'free'
        u.cycle = null
        u.planExpiresAt = null
        u.nextCreditsAt = null
      } else {
        activatePlan(u, body.plan, body.cycle === 'yearly' ? 'yearly' : 'monthly')
      }
      return userView(u)
    })
    if (!target) return fail(res, 404, 'No such user.', 'user')
    return ok(res, { user: target })
  }
  return fail(res, 404, 'Unknown admin route.', 'route')
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  if (path === '/health') return ok(res, { ok: true, service: 'billing-api' })

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()

    // The gateway's own callbacks carry no session — they prove themselves with
    // a signature instead. Everything else needs a session.
    if (path === '/api/webhooks/safepay' && req.method === 'POST') return await webhook(req, res)
    if (path === '/api/billing/return') return await billingReturn(req, res, url)
    if (path === '/api/plans' && req.method === 'GET') return ok(res, catalog())
    if (path === '/api/auth/register' && req.method === 'POST') return await register(req, res)
    if (path === '/api/auth/login' && req.method === 'POST') return await login(req, res)
    if (path.startsWith('/api/admin/')) return await adminRoutes(req, res, path)

    const admin = isAdmin(req)
    const user = await authenticate(req)
    if (!user && !admin) return fail(res, 401, 'Sign in to continue.', 'auth')

    if (path.startsWith('/v1/')) {
      const handled = await handleV1({ req, res, path, search: url.search, user, admin })
      if (handled) {
        if (user) await commit()
        return undefined
      }
      return fail(res, 404, 'Unknown endpoint.', 'route')
    }

    if (path === '/api/me' && req.method === 'GET') return await me(req, res, user)
    if (path === '/api/auth/logout' && req.method === 'POST') return await logout(req, res, user, token)
    if (path === '/api/billing/checkout' && req.method === 'POST') return await checkout(req, res, user)
    if (path === '/api/billing/consume' && req.method === 'POST') return await consume(req, res, user)
    if (path === '/api/site-model' && req.method === 'GET') return await siteModel(req, res, user)

    return fail(res, 404, 'Not found.', 'route')
  } catch (e) {
    console.error('[billing] unhandled error', e)
    if (!res.headersSent) return fail(res, 500, 'Something went wrong on our side.', 'server')
    res.end()
    return undefined
  }
})

// Top up monthly allowances even when nobody is making requests — a yearly
// subscription keeps paying out month by month.
setInterval(() => {
  transact(async (db) => {
    for (const u of db.users) reconcile(u)
  }).catch((e) => console.warn('[billing] reconcile tick failed', e?.message))
}, 5 * 60_000).unref?.()

server.listen(PORT, () => {
  console.log(`[billing] listening on :${PORT}`)
  console.log(
    `[billing] gateway=safepay/${environment()} configured=${configured()} proxy=${upstreamUrl()} key=${upstreamKeyConfigured() ? 'set' : 'MISSING'}`,
  )
})

export { server, userView }
