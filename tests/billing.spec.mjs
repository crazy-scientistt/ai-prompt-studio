import { test, expect } from '@playwright/test'

/* Billing-mode UI tests.
   The app only enters billing mode when /api/config names a billing backend, so
   every test here stubs that config (and the backend itself) — the same way a
   hosted deployment behaves. Run: npx playwright test tests/billing.spec.mjs
   The app must be running on http://localhost:5174 */

const BASE = 'http://localhost:5174'

// Mirrors server/api/src/plans.js — costs and credits must agree with the server.
const CATALOG = {
  currency: 'PKR',
  yearlyDiscount: 0.2,
  freeCredits: 5,
  plans: [
    { id: 'free', name: 'Free', tagline: 'Try the studio', credits: 5, tiers: ['flash'], selectable: false, highlights: ['Full video analysis'], monthly: 0, yearly: 0, perMonthIfYearly: 0 },
    { id: 'plus', name: 'Plus', tagline: 'For regular creators', credits: 300, tiers: ['flash'], selectable: false, highlights: ['300 credits every month', 'Gemini Flash models'], monthly: 2000, yearly: 19200, perMonthIfYearly: 1600 },
    { id: 'pro', name: 'Pro', tagline: 'For serious production', credits: 700, tiers: ['flash', 'premium'], selectable: true, highlights: ['700 credits every month', 'Claude Opus 4.6 thinking available'], monthly: 4000, yearly: 38400, perMonthIfYearly: 3200 },
  ],
}

const user = (over = {}) => ({
  id: 'u1',
  email: 'buyer@example.com',
  plan: 'plus',
  planName: 'Plus',
  cycle: 'monthly',
  credits: 300,
  planExpiresAt: Date.now() + 86400_000 * 25,
  nextCreditsAt: Date.now() + 86400_000 * 25,
  modelSelection: false,
  tiers: ['flash'],
  monthlyCredits: 300,
  recompilesLeft: 12,
  spentTotal: 4,
  createdAt: Date.now(),
  ...over,
})

const MODELS = {
  data: [
    { id: 'gemini-3.8-flash-high' },
    { id: 'gemini-3.6-flash-medium' },
    { id: 'claude-opus-4-6-thinking' },
  ],
}

/**
 * Stub a billing deployment.
 * `account` is who /api/me reports; `signedIn` seeds the stored session token,
 * which is what a returning visitor actually has — without it the app has no
 * way to know who is calling and correctly shows the sign-in gate.
 */
async function bootBilling(page, { account = user(), signedIn = !!account, consume, models = MODELS } = {}) {
  const seeded = signedIn ? { onboarded: true, authToken: 'tok_test' } : { onboarded: true }
  await page.addInitScript((state) => {
    localStorage.setItem('ai-prompt-studio-v1', JSON.stringify(state))
  }, seeded)
  await page.route('**/api/config', (r) => r.fulfill({ json: { ok: true, proxyUrl: 'http://localhost:3000', billingUrl: BASE } }))
  await page.route('**/api/plans', (r) => r.fulfill({ json: CATALOG }))
  await page.route('**/api/me', (r) =>
    account
      ? r.fulfill({ json: { ok: true, user: account, billing: { gateway: 'safepay', environment: 'sandbox', configured: true, upstream: { configured: true, url: 'http://x' } } } })
      : r.fulfill({ status: 401, json: { ok: false, error: 'Sign in to continue.', code: 'auth' } }),
  )
  await page.route('**/api/auth/login', (r) => r.fulfill({ json: { ok: true, token: 'tok_test', user: account ?? user() } }))
  await page.route('**/api/auth/register', (r) => r.fulfill({ json: { ok: true, token: 'tok_test', user: account ?? user() } }))
  await page.route('**/api/auth/logout', (r) => r.fulfill({ json: { ok: true } }))
  // The backend filters models by plan; Playwright returns exactly what the plan allows.
  await page.route('**/v1/models', (r) => r.fulfill({ json: models }))
  await page.route('**/api/site-model', (r) => r.fulfill({ json: { ok: true, model: 'gemini-3.8-flash-high', source: 'site' } }))
  await page.route('**/api/billing/consume', (r) =>
    consume === 'no-credits'
      ? r.fulfill({ status: 402, json: { ok: false, code: 'no_credits', error: 'You are out of credits. Upgrade your plan to keep generating.', upgrade: true } })
      : r.fulfill({ json: { ok: true, analysisId: 'a1', kind: 'analysis', callsRemaining: 80, recompilesLeft: 12, user: user({ credits: 299 }) } }),
  )
  await page.route('**/api/billing/checkout', (r) =>
    r.fulfill({ json: { ok: true, orderId: 'o1', amount: 2000, currency: 'PKR', checkoutUrl: `${BASE}/checkout-stub` } }),
  )
}

test.describe('billing mode', () => {
  test('signed-out visitors get the account gate, not the studio', async ({ page }) => {
    await bootBilling(page, { account: null })
    await page.goto(BASE)

    await expect(page.getByText('AI Prompt Studio').first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    // The workspace must not be reachable without a session.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  })

  test('signing in reveals the workspace with the account plan and credits', async ({ page }) => {
    await bootBilling(page, { account: user(), signedIn: false })
    await page.goto(BASE)

    await page.getByPlaceholder('you@example.com').fill('buyer@example.com')
    await page.getByPlaceholder('••••••••').fill('hunter2hunter2')
    await page.getByRole('tab', { name: 'Sign in' }).click()
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    // The plan card renders in the desktop sidebar and the mobile drawer both.
    await expect(page.getByText('Plus plan').first()).toBeVisible()
    await expect(page.getByText(/300 credits left/).first()).toBeVisible()
  })

  test('the pricing page shows both plans, the yearly discount and checkout', async ({ page }) => {
    await bootBilling(page, {})
    await page.goto(BASE)

    await page.getByRole('button', { name: /Upgrade Plan/i }).click()
    await expect(page.getByRole('heading', { name: /Plans & billing/ })).toBeVisible()

    // Monthly prices from the catalog.
    await expect(page.getByText('Rs 2,000')).toBeVisible()
    await expect(page.getByText('Rs 4,000')).toBeVisible()

    // Yearly = 12 months minus 20%, and the equivalent monthly price is shown.
    await page.getByRole('button', { name: /Yearly/ }).click()
    await expect(page.getByText('Rs 19,200')).toBeVisible()
    await expect(page.getByText('Rs 38,400')).toBeVisible()
    await expect(page.getByText(/Rs 1,600\/month/)).toBeVisible()
    await expect(page.getByText(/Rs 3,200\/month/)).toBeVisible()

    // The current plan cannot be bought again.
    await expect(page.getByRole('button', { name: 'Your current plan' })).toBeVisible()

    // Upgrading hands the browser to the gateway checkout.
    await page.getByRole('button', { name: /Upgrade to Pro/ }).click()
    await expect(page).toHaveURL(/checkout-stub/)
  })

  test('only Pro accounts can choose the reasoning engine', async ({ page }) => {
    await bootBilling(page, { account: user({ plan: 'plus', planName: 'Plus', modelSelection: false }), signedIn: true })
    await page.goto(BASE)
    await page.getByRole('button', { name: /demo reference/i }).click()
    await expect(page.getByText('REFERENCE', { exact: true })).toBeVisible()
    await expect(page.getByText('Reasoning engine')).toHaveCount(0)

    // Same workspace for a Pro account: the picker appears, with the premium
    // model the server allows that plan to use.
    await page.unroute('**/api/me')
    await page.route('**/api/me', (r) =>
      r.fulfill({
        json: {
          ok: true,
          user: user({ plan: 'pro', planName: 'Pro', credits: 700, modelSelection: true, tiers: ['flash', 'premium'], monthlyCredits: 700 }),
          billing: { gateway: 'safepay', environment: 'sandbox', configured: true, upstream: { configured: true, url: 'http://x' } },
        },
      }),
    )
    await page.reload()
    await page.getByRole('button', { name: /demo reference/i }).click()
    await expect(page.getByText('Reasoning engine')).toBeVisible()
    await expect(page.getByText('claude-opus-4-6-thinking')).toBeVisible()
  })

  test('a spent account is sent to the plans page instead of a dead end', async ({ page }) => {
    await bootBilling(page, { account: user({ credits: 0 }), consume: 'no-credits' })
    await page.goto(BASE)
    await page.getByRole('button', { name: /demo reference/i }).click()
    await expect(page.getByText('REFERENCE', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Generate Prompt/i }).click()
    // Refused, and pointed at the upgrade page with the server's explanation.
    await expect(page.getByRole('heading', { name: /Plans & billing/ })).toBeVisible()
    await expect(page.getByText('Out of credits — choose a plan to keep generating')).toBeVisible()
  })

  test('no horizontal overflow on the gate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await bootBilling(page, { account: null, signedIn: false })
    await page.goto(BASE)
    await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible()
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
  })

  test('no horizontal overflow on the pricing page at any width', async ({ page }) => {
    await bootBilling(page, { signedIn: true })
    await page.goto(BASE)
    await page.getByRole('button', { name: /Upgrade Plan/i }).click()
    await expect(page.getByRole('heading', { name: /Plans & billing/ })).toBeVisible()
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    }
  })
})
