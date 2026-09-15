// Unit tests for the parts that must be exactly right: the two Safepay
// signature schemes and the plan gating/pricing math. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

process.env.SAFEPAY_API_KEY = 'sec_test_key'
process.env.SAFEPAY_V1_SECRET = 'v1-secret-value'
process.env.SAFEPAY_WEBHOOK_SECRET = 'webhook-secret-value'
process.env.SAFEPAY_ENV = 'sandbox'
delete process.env.SAFEPAY_MOCK

const sp = await import('./safepay.js')
const plans = await import('./plans.js')

test('success-page signature is HMAC-SHA256(tracker, v1Secret)', () => {
  const tracker = 'track_abc123'
  const good = createHmac('sha256', 'v1-secret-value').update(tracker).digest('hex')
  assert.equal(sp.verifySuccessSignature(tracker, good), true)
  assert.equal(sp.verifySuccessSignature(tracker, 'deadbeef'), false)
  assert.equal(sp.verifySuccessSignature(tracker, ''), false)
  assert.equal(sp.verifySuccessSignature('', good), false)
  // A signature minted for a different tracker must not pass.
  const other = createHmac('sha256', 'v1-secret-value').update('track_other').digest('hex')
  assert.equal(sp.verifySuccessSignature(tracker, other), false)
})

test('webhook signature is HMAC-SHA512 over the re-serialised data object', () => {
  const payload = { type: 'payment.succeeded', data: { tracker: 't1', order_id: 'o1', amount: 2000, currency: 'PKR', state: 'TRACKER_ENDED' } }
  const body = JSON.stringify(payload)
  const good = createHmac('sha512', 'webhook-secret-value').update(JSON.stringify(payload.data)).digest('hex')
  assert.equal(sp.verifyWebhookSignature(body, good), true)
  // Wrong secret, wrong body, and no signature all fail.
  const wrongSecret = createHmac('sha512', 'nope').update(JSON.stringify(payload.data)).digest('hex')
  assert.equal(sp.verifyWebhookSignature(body, wrongSecret), false)
  assert.equal(sp.verifyWebhookSignature(body, undefined), false)
  const tampered = JSON.stringify({ ...payload, data: { ...payload.data, amount: 1 } })
  assert.equal(sp.verifyWebhookSignature(tampered, good), false)
})

test('an unsigned or empty secret configuration verifies nothing', async () => {
  const saved = process.env.SAFEPAY_WEBHOOK_SECRET
  delete process.env.SAFEPAY_WEBHOOK_SECRET
  const fresh = await import(`./safepay.js?nocache=${Date.now()}`)
  assert.equal(fresh.verifyWebhookSignature('{}', 'anything'), false)
  process.env.SAFEPAY_WEBHOOK_SECRET = saved
})

test('readEvent tolerates the different payload shapes Safepay ships', () => {
  const a = sp.readEvent({ data: { tracker: 'tk', order_id: 'od', amount: '2000', currency: 'PKR', state: 'TRACKER_ENDED' } })
  assert.deepEqual([a.tracker, a.orderId, a.amount, a.currency, a.failed], ['tk', 'od', 2000, 'PKR', false])

  const b = sp.readEvent({ data: { beacon: 'tk2', merchant_order_id: 'od2', paid_amount: 4000, payment_state: 'FAILED' } })
  assert.deepEqual([b.tracker, b.orderId, b.amount], ['tk2', 'od2', 4000])
  assert.equal(b.failed, true)

  const c = sp.readEvent({ type: 'payment.canceled', data: { tracker: 't3' } })
  assert.equal(c.failed, true)
})

test('pricing: Pro 4000, Plus 2000, yearly is 20% off the total', () => {
  assert.equal(plans.priceFor('plus', 'monthly'), 2000)
  assert.equal(plans.priceFor('pro', 'monthly'), 4000)
  assert.equal(plans.priceFor('plus', 'yearly'), 19200) // 2000*12*0.8
  assert.equal(plans.priceFor('pro', 'yearly'), 38400) // 4000*12*0.8
  assert.equal(plans.priceFor('free', 'monthly'), 0)

  const cat = plans.catalog()
  const plus = cat.plans.find((p) => p.id === 'plus')
  assert.equal(plus.credits, 300)
  assert.equal(plus.perMonthIfYearly, 1600)
  const pro = cat.plans.find((p) => p.id === 'pro')
  assert.equal(pro.credits, 700)
  assert.equal(pro.perMonthIfYearly, 3200)
})

test('model gating: Plus gets Gemini only, Pro also gets Claude', () => {
  assert.equal(plans.modelAllowed('plus', 'gemini-3.8-flash-high'), true)
  assert.equal(plans.modelAllowed('plus', 'gemini-3.7-flash-high'), true)
  assert.equal(plans.modelAllowed('plus', 'claude-opus-4-6-thinking'), false)
  assert.equal(plans.modelAllowed('plus', 'gpt-oss-120b-medium'), false)

  assert.equal(plans.modelAllowed('pro', 'gemini-3.8-flash-high'), true)
  assert.equal(plans.modelAllowed('pro', 'claude-opus-4-6-thinking'), true)

  // Unknown families are denied rather than silently allowed onto a cheap plan.
  assert.equal(plans.modelAllowed('pro', 'some-future-model'), false)
  assert.equal(plans.modelAllowed('free', 'claude-opus-4-6-thinking'), false)
})

test('subscription months are calendar months, clamped at month end', async () => {
  const store = await import('./store.js')
  // 31 Jan + 1 month is 28 Feb, not 3 March.
  const feb = new Date(store.addMonths(new Date(2026, 0, 31).getTime(), 1))
  assert.equal(feb.getMonth(), 1)
  assert.equal(feb.getDate(), 28)
  // A yearly cycle lands a year later on the same day.
  const year = new Date(store.addMonths(new Date(2026, 0, 15).getTime(), 12))
  assert.equal(year.getFullYear(), 2027)
  assert.equal(year.getMonth(), 0)
  assert.equal(year.getDate(), 15)
})
