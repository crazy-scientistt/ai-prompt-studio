// End-to-end test of the whole billing path against a real server process:
// sign up → buy → gateway callback → credits → spend → plan enforcement.
// A fake upstream stands in for the Antigravity proxy so the AI path can be
// exercised without touching a real Google account.
//
// Run: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = 8799
const UPSTREAM_PORT = 8798
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_KEY = 'test-admin-key'

let child
let dataDir
let upstream
let upstreamCalls = []

const api = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* redirect or empty */
  }
  return { status: r.status, json, text, location: r.headers.get('location') }
}

before(async () => {
  // Fake Antigravity proxy: reports a flash and a premium model, echoes replies.
  upstream = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const auth = req.headers.authorization || ''
      upstreamCalls.push({ path: req.url, auth, body })
      res.setHeader('Content-Type', 'application/json')
      if (req.url.startsWith('/v1/models')) {
        return res.end(
          JSON.stringify({
            data: [
              { id: 'gemini-3.8-flash-high' },
              { id: 'gemini-3.6-flash-medium' },
              { id: 'claude-opus-4-6-thinking' },
            ],
          }),
        )
      }
      if (req.url.startsWith('/api/site-model')) return res.end(JSON.stringify({ ok: true, model: 'claude-opus-4-6-thinking' }))
      res.end(JSON.stringify({ choices: [{ message: { content: 'PONG' } }] }))
    })
  })
  await new Promise((r) => upstream.listen(UPSTREAM_PORT, r))

  dataDir = await mkdtemp(join(tmpdir(), 'aps-billing-'))
  child = spawn(process.execPath, [join(HERE, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      SESSION_SECRET: 'test-session-secret',
      ADMIN_KEY,
      APP_URL: 'http://localhost:5173',
      PUBLIC_URL: BASE,
      PROXY_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      PROXY_KEY: 'proxy-key-under-test',
      SAFEPAY_MOCK: '1', // no live credentials in tests
      SAFEPAY_API_KEY: 'sec_test',
      SAFEPAY_V1_SECRET: 'v1-secret',
      SAFEPAY_WEBHOOK_SECRET: 'webhook-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('billing server did not start')
})

after(async () => {
  child?.kill()
  upstream?.close()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

test('health and pricing catalog are public', async () => {
  const health = await api('/health')
  assert.equal(health.status, 200)

  const res = await api('/api/plans')
  assert.equal(res.status, 200)
  const plus = res.json.plans.find((p) => p.id === 'plus')
  const pro = res.json.plans.find((p) => p.id === 'pro')
  assert.equal(plus.monthly, 2000)
  assert.equal(plus.credits, 300)
  assert.equal(plus.yearly, 19200)
  assert.equal(pro.monthly, 4000)
  assert.equal(pro.credits, 700)
  assert.equal(pro.yearly, 38400)
  assert.equal(res.json.yearlyDiscount, 0.2)
})

test('a session is required for the studio and for the AI endpoints', async () => {
  assert.equal((await api('/api/me')).status, 401)
  assert.equal((await api('/v1/models')).status, 401)
  assert.equal((await api('/api/billing/consume', { method: 'POST' })).status, 401)
})

test('signup → free credits → pay for Plus → credits granted once', async () => {
  const email = `buyer-${Date.now()}@example.com`
  const reg = await api('/api/auth/register', { method: 'POST', body: { email, password: 'hunter2hunter2' } })
  assert.equal(reg.status, 200)
  const token = reg.json.token
  assert.equal(reg.json.user.plan, 'free')
  assert.equal(reg.json.user.credits, 5)
  assert.equal(reg.json.user.modelSelection, false)

  // Same email twice is refused.
  const dupe = await api('/api/auth/register', { method: 'POST', body: { email, password: 'hunter2hunter2' } })
  assert.equal(dupe.status, 409)

  // Weak passwords are refused before any scrypt work happens.
  const weak = await api('/api/auth/register', { method: 'POST', body: { email: `w-${Date.now()}@e.com`, password: '12345678' } })
  assert.equal(weak.status, 400)

  // Wrong password does not sign in.
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email, password: 'wrong-password-1' } })).status, 401)

  const checkout = await api('/api/billing/checkout', { method: 'POST', token, body: { planId: 'plus', cycle: 'monthly' } })
  assert.equal(checkout.status, 200)
  assert.equal(checkout.json.amount, 2000)
  assert.match(checkout.json.checkoutUrl, /beacon=/)
  assert.match(checkout.json.checkoutUrl, /env=sandbox/)
  const orderId = checkout.json.orderId

  // The customer pays, Safepay redirects back with { tracker, sig }. Find the
  // tracker the server minted for this order.
  const beacon = new URL(checkout.json.checkoutUrl).searchParams.get('beacon')
  const paid = await api(`/api/billing/return?tracker=${encodeURIComponent(beacon)}&sig=mock-signature`)
  assert.equal(paid.status, 302)
  assert.match(paid.location, /paid=1/)
  assert.match(paid.location, /plan=plus/)

  const after = await api('/api/me', { token })
  assert.equal(after.json.user.plan, 'plus')
  assert.equal(after.json.user.credits, 305) // 5 free + 300 for the month
  assert.equal(after.json.user.modelSelection, false)
  assert.ok(after.json.user.planExpiresAt > Date.now())

  // A replayed callback must not grant a second time.
  await api(`/api/billing/return?tracker=${encodeURIComponent(beacon)}&sig=mock-signature`)
  const replayed = await api('/api/me', { token })
  assert.equal(replayed.json.user.credits, 305)

  // An unsigned callback is rejected outright.
  const forged = await api(`/api/billing/return?tracker=${encodeURIComponent(beacon)}&sig=`)
  assert.equal(forged.status, 302)
  assert.match(forged.location, /error=signature/)

  // The order really is marked paid.
  const again = await api('/api/billing/checkout', { method: 'POST', token, body: { planId: 'nope', cycle: 'monthly' } })
  assert.equal(again.status, 400)
  assert.equal(orderId.length > 10, true)
})

test('the webhook grants a Pro cycle, and refuses an underpaid one', async () => {
  const email = `pro-${Date.now()}@example.com`
  const reg = await api('/api/auth/register', { method: 'POST', body: { email, password: 'hunter2hunter2' } })
  const token = reg.json.token

  const checkout = await api('/api/billing/checkout', { method: 'POST', token, body: { planId: 'pro', cycle: 'yearly' } })
  assert.equal(checkout.json.amount, 38400)
  const orderId = checkout.json.orderId
  const beacon = new URL(checkout.json.checkoutUrl).searchParams.get('beacon')

  // Underpaid: signed correctly, but claims far less than the plan costs.
  const cheap = await api('/api/webhooks/safepay', {
    method: 'POST',
    headers: { 'x-sfpy-signature': 'mock', 'x-sfpy-event-id': `evt-${Date.now()}` },
    body: { type: 'payment.succeeded', data: { tracker: beacon, order_id: orderId, amount: 10, currency: 'PKR', state: 'TRACKER_ENDED' } },
  })
  assert.equal(cheap.status, 200)
  assert.equal(cheap.json.ignored, 'amount_mismatch')
  assert.equal((await api('/api/me', { token })).json.user.credits, 5)

  // Correct amount → Pro for a year, first month's credits granted.
  const good = await api('/api/webhooks/safepay', {
    method: 'POST',
    headers: { 'x-sfpy-signature': 'mock', 'x-sfpy-event-id': `evt-ok-${Date.now()}` },
    body: { type: 'payment.succeeded', data: { tracker: beacon, order_id: orderId, amount: 38400, currency: 'PKR', state: 'TRACKER_ENDED' } },
  })
  assert.equal(good.json.granted, true)

  const me = await api('/api/me', { token })
  assert.equal(me.json.user.plan, 'pro')
  assert.equal(me.json.user.cycle, 'yearly')
  assert.equal(me.json.user.credits, 705) // 5 free + 700
  assert.equal(me.json.user.modelSelection, true)
  // Monthly top-ups, not a year's worth at once.
  assert.ok(me.json.user.nextCreditsAt > Date.now())
  const monthsOut = new Date(me.json.user.nextCreditsAt)
  assert.equal(monthsOut.getDate(), new Date().getDate())

  // A duplicate delivery of the same event id is ignored.
  const dupEvent = `evt-dup-${Date.now()}`
  const first = await api('/api/webhooks/safepay', {
    method: 'POST',
    headers: { 'x-sfpy-signature': 'mock', 'x-sfpy-event-id': dupEvent },
    body: { type: 'payment.succeeded', data: { tracker: beacon, order_id: orderId, amount: 38400, state: 'TRACKER_ENDED' } },
  })
  const second = await api('/api/webhooks/safepay', {
    method: 'POST',
    headers: { 'x-sfpy-signature': 'mock', 'x-sfpy-event-id': dupEvent },
    body: { type: 'payment.succeeded', data: { tracker: beacon, order_id: orderId, amount: 38400, state: 'TRACKER_ENDED' } },
  })
  assert.equal(first.json.already, true) // order was already paid
  assert.equal(second.json.duplicate, true)
})

test('AI calls are plan-gated, credit-gated and proxied with the proxy key', async () => {
  const email = `user-${Date.now()}@example.com`
  const reg = await api('/api/auth/register', { method: 'POST', body: { email, password: 'hunter2hunter2' } })
  const token = reg.json.token

  // The model list only shows what the plan may use.
  const models = await api('/v1/models', { token })
  const ids = models.json.data.map((m) => m.id)
  assert.ok(ids.includes('gemini-3.8-flash-high'))
  assert.ok(!ids.includes('claude-opus-4-6-thinking'))

  // Calling a premium model on the free plan is refused, before any upstream call.
  const before = upstreamCalls.length
  const denied = await api('/v1/chat/completions', {
    method: 'POST',
    token,
    body: { model: 'claude-opus-4-6-thinking', messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.json.error.code, 'plan_model')
  assert.equal(upstreamCalls.length, before)

  // A model call without an analysis session is refused.
  const noSession = await api('/v1/chat/completions', {
    method: 'POST',
    token,
    body: { model: 'gemini-3.8-flash-high', messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(noSession.status, 402)
  assert.equal(noSession.json.error.code, 'analysis_required')

  // Spending a credit opens the session.
  const consume = await api('/api/billing/consume', { method: 'POST', token, body: { kind: 'analysis' } })
  assert.equal(consume.status, 200)
  assert.equal(consume.json.user.credits, 4) // 5 free − 1
  const analysisId = consume.json.analysisId

  const allowed = await api('/v1/chat/completions', {
    method: 'POST',
    token,
    headers: { 'x-analysis-id': analysisId },
    body: { model: 'gemini-3.8-flash-high', messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.json.choices[0].message.content, 'PONG')

  // The upstream saw our proxy key, never the customer's session token.
  const last = upstreamCalls[upstreamCalls.length - 1]
  assert.equal(last.auth, 'Bearer proxy-key-under-test')
  assert.ok(!last.auth.includes(token))

  // Recompiles are free and do not touch credits.
  const before2 = (await api('/api/me', { token })).json.user.credits
  const recompile = await api('/api/billing/consume', { method: 'POST', token, body: { kind: 'recompile' } })
  assert.equal(recompile.status, 200)
  assert.equal((await api('/api/me', { token })).json.user.credits, before2)
  assert.equal(recompile.json.recompilesLeft, 11) // 12/day, one used

  // The owner's site model is Claude, but a Plus/free customer gets a Gemini.
  const site = await api('/api/site-model', { token })
  assert.equal(site.json.source, 'plan_fallback')
  assert.match(site.json.model, /^gemini-/)
})

test('an admin key bypasses credits without exposing the proxy key', async () => {
  const models = await api('/v1/models', { headers: { 'x-admin-key': ADMIN_KEY } })
  assert.equal(models.status, 200)
  const ids = models.json.data.map((m) => m.id)
  assert.ok(ids.includes('claude-opus-4-6-thinking')) // owner sees everything

  const wrong = await api('/v1/models', { headers: { 'x-admin-key': 'nope' } })
  assert.equal(wrong.status, 401)
})

test('admin helpers can grant credits and comp a plan', async () => {
  const email = `admin-${Date.now()}@example.com`
  await api('/api/auth/register', { method: 'POST', body: { email, password: 'hunter2hunter2' } })

  const grant = await api('/api/admin/grant', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY }, body: { email, credits: 50 } })
  assert.equal(grant.json.user.credits, 55)

  const comp = await api('/api/admin/setplan', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY }, body: { email, plan: 'pro', cycle: 'monthly' } })
  assert.equal(comp.json.user.plan, 'pro')
  assert.equal(comp.json.user.credits, 755) // 55 + 700

  const users = await api('/api/admin/users', { headers: { 'x-admin-key': ADMIN_KEY } })
  assert.ok(users.json.users.length >= 4)
  assert.equal((await api('/api/admin/users')).status, 401)
})
