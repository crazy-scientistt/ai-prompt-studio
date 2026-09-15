import { test, expect } from '@playwright/test'

/* UI regression suite for AI Prompt Studio.
   Run: npx playwright test tests/ui.spec.mjs
   The app must be running on http://localhost:5174 */

const BASE = 'http://localhost:5174'

// UI checks use the existing local compiler in isolated browser contexts.
// Do not send generation requests to a connected account during regression QA.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/models', route => route.fulfill({ json: { data: [] } }))
})

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
]

async function assertNoOverflow(page) {
  const over = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(over.doc, `document horizontal overflow by ${over.doc}px`).toBeLessThanOrEqual(0)
  expect(over.body, `body horizontal overflow by ${over.body}px`).toBeLessThanOrEqual(0)
}

function assertNoConsoleErrors(page, skipVite = true) {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return () => {
    const real = errors.filter((e) => !skipVite || !/vite|hmr|websocket/i.test(e))
    expect(real, `console errors: ${real.join(' | ')}`).toEqual([])
  }
}
const trackErrors = assertNoConsoleErrors

/** Fresh contexts always see onboarding — dismiss it, then load the demo video. */
async function gotoWorkspace(page) {
  await page.goto(BASE)
  await page.waitForTimeout(300)
  const start = page.locator('button', { hasText: /Start creating/i })
  if (await start.count()) await start.click()
  await page.waitForTimeout(150)
  await page.locator('button', { hasText: /demo reference/i }).click()
  await expect(page.getByText('REFERENCE', { exact: true })).toBeVisible()
}

/** Navigate to a tab; on mobile the nav lives inside the drawer. */
async function goTab(page, label) {
  if (page.viewportSize().width < 1024) {
    await page.locator('button[aria-label="Open menu"]').click()
    await page.waitForTimeout(280)
  }
  await page.locator('nav[aria-label="Primary"] button:visible', { hasText: label }).first().click()
  await page.waitForTimeout(250)
}

test.describe('viewport integrity', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: no horizontal overflow, page loads clean`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const checkErrors = trackErrors(page)
      await page.goto(BASE)
      await page.waitForTimeout(400)
      await assertNoOverflow(page)
      // dismiss onboarding if present, then navigate all tabs and re-check each
      const start = page.locator('button', { hasText: /Start creating/i })
      if (await start.count()) await start.click()
      await page.waitForTimeout(150)
      for (const label of ['History', 'Settings', 'My Assets', 'Video to Prompt']) {
        await goTab(page, label)
        await assertNoOverflow(page)
      }
      checkErrors()
    })
  }
})

test.describe('primary flows (desktop)', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('upload demo → workspace shows both columns', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(page.locator('text=What do you want?')).toBeVisible()
    await assertNoOverflow(page)
  })

  test('split modes + fixed lengths + model select', async ({ page }) => {
    await gotoWorkspace(page)
    await page.waitForTimeout(200)

    await page.locator('button', { hasText: 'Fixed length' }).click()
    await expect(page.locator('[role="radiogroup"][aria-label="Clip length"]')).toBeVisible()
    // Veo lengths
    await expect(page.locator('[role="radio"]', { hasText: '4s' })).toBeVisible()
    // switch model to Omni Flash → 4/6/8/10 chips
    await page.locator('button', { hasText: /Creating for|Veo 3\.1/ }).first().click()
    await page.locator('[role="menuitem"]', { hasText: 'Omni Flash' }).click()
    await expect(page.getByRole('radio', { name: '10s', exact: true })).toBeVisible()
    // cuts mode
    await page.locator('button', { hasText: 'At every cut' }).click()
    await expect(page.locator('text=one clip per detected scene cut')).toBeVisible()
  })

  test('generate → kit ready → analysis accordion → copy', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoWorkspace(page)
    await page.locator('button', { hasText: /Generate Prompt/i }).click()

    // analyzing state renders (no layout collapse)
    await expect(page.locator('text=/Analyzing|watching|Compiling|auditing|Extracting/').first()).toBeVisible({ timeout: 10_000 })

    // kit ready (live engine can take ~60s; local fallback faster)
    await expect(page.locator('text=/Your Prompt Kit is Ready/')).toBeVisible({ timeout: 90_000 })

    // analysis accordion — collapsed by default, expands into contained area
    const analysis = page.locator('button', { hasText: 'Detailed Analysis' })
    await analysis.click()
    await expect(page.locator('text=Negative watchlist').first()).toBeVisible()
    const box = await page.locator('text=Negative watchlist').first().boundingBox()
    expect(box).not.toBeNull()
    await analysis.click() // collapses again
    await expect(page.locator('text=Negative watchlist').first()).toHaveCount(0)

    // copy-all button exists and doesn't shift layout on hover
    const copyAll = page.locator('button', { hasText: 'Copy All' })
    const before = await copyAll.boundingBox()
    await copyAll.hover()
    await page.waitForTimeout(200)
    const after = await copyAll.boundingBox()
    expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1)
  })

  test('session survives tab switches: video + kit persist, history records the selected model', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoWorkspace(page)

    // Switch away and back BEFORE generating — upload must survive.
    await goTab(page, 'My Assets')
    await goTab(page, 'Video to Prompt')
    await expect(page.getByText('REFERENCE', { exact: true })).toBeVisible()

    await page.locator('button', { hasText: /Generate Prompt/i }).click()
    await expect(page.locator('text=/Your Prompt Kit is Ready/')).toBeVisible({ timeout: 90_000 })

    // Switch tabs MID-RESULT and come back — everything must still be here.
    await goTab(page, 'History')
    await goTab(page, 'Video to Prompt')
    await expect(page.locator('text=/Your Prompt Kit is Ready/')).toBeVisible()
    await expect(page.getByText('REFERENCE', { exact: true })).toBeVisible()

    // History must record the TARGET model the user selected (Veo), not the
    // engine model that wrote the kit. The card badge shows the model name.
    // (Scope to visible elements — the hidden Studio column also contains a
    // model-name span while it stays mounted.)
    await goTab(page, 'History')
    await expect(
      page.locator('span', { hasText: /^(Veo 3\.1|Flow · Omni Flash 1\.1|Kling 2\.5|Runway Gen-4\.5|Sora 2|MiniMax H3 \(Hailuo\)|Seedance 2\.5|Seedance 2\.0|Wan 3\.0|Wan 2\.5|Other \/ Auto)$/ }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('history + settings render empty/populated states', async ({ page }) => {
    await page.goto(BASE)
    const start = page.locator('button', { hasText: /Start creating/i })
    if (await start.count()) await start.click()
    await page.waitForTimeout(150)
    await goTab(page, 'History')
    await expect(page.locator('text=/My Prompts|No prompts yet/').first()).toBeVisible()

    // If a saved prompt exists, Open must launch the full-text viewer modal
    const openBtn = page.locator('button', { hasText: 'Open' }).first()
    if (await openBtn.count()) {
      await openBtn.click()
      await expect(page.locator('[role="dialog"]')).toBeVisible()
      await expect(page.locator('[role="dialog"] button', { hasText: 'Copy full prompt' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    }

    await goTab(page, 'Settings')
    await expect(page.locator('text=Deep reasoning QA').first()).toBeVisible()
    // The admin console link must never be shown to customers (only when the
    // build sets VITE_ADMIN_PIN, which the test build does not).
    await expect(page.locator('a[href="#/admin"]')).toHaveCount(0)
    await goTab(page, 'My Assets')
    await expect(page.locator('text=/Your library is empty|Upload Asset/').first()).toBeVisible()
  })

  test('the proxy-set site model drives the app model (skips when no proxy)', async ({ page }) => {
    // Requires a running proxy on localhost:3000 with a site model set; skipped
    // elsewhere so the suite stays green without one.
    let proxyUp = false
    try {
      const r = await fetch('http://localhost:3000/api/site-model')
      proxyUp = r.ok
    } catch { proxyUp = false }
    test.skip(!proxyUp, 'no local proxy on :3000')

    // The shared beforeEach stub makes /v1/models look empty (connected=false),
    // which short-circuits the site-model adoption. This test needs the real
    // proxy, so drop the stub for it.
    await page.unroute('**/v1/models')

    const chosen = 'gemini-3.6-flash-high'
    await fetch('http://localhost:3000/api/site-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: chosen }),
    })
    const readStored = () =>
      page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('ai-prompt-studio-v1') || '{}').defaultProxyModel } catch { return null }
      })
    try {
      await page.goto(BASE)
      // Cold dev-server transforms can take a while — poll instead of a fixed sleep.
      await expect.poll(readStored, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(chosen)
    } finally {
      // Leave the proxy as we found it.
      await fetch('http://localhost:3000/api/site-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '' }),
      })
    }
  })

  test('runtime /api/config supplies the proxy URL; ?proxy= still wins', async ({ page }) => {
    const cfgUrl = 'https://cfg.example.invalid'
    await page.route('**/api/config', (route) =>
      route.fulfill({ json: { ok: true, proxyUrl: cfgUrl } }))
    const stored = () =>
      page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('ai-prompt-studio-v1') || '{}').gateway?.url } catch { return null }
      })

    await page.goto(BASE)
    await expect.poll(stored, { timeout: 15_000 }).toBe(cfgUrl)

    // An explicit ?proxy= link is a deliberate per-browser override — it wins
    // over the hosted config.
    const over = 'https://manual.example.invalid'
    await page.goto(`${BASE}/?proxy=${encodeURIComponent(over)}`)
    await expect.poll(stored, { timeout: 15_000 }).toBe(over)
  })

  test('no /api/config (local dev) leaves the baked proxy default untouched', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForTimeout(1200)
    const url = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('ai-prompt-studio-v1') || '{}').gateway?.url } catch { return null }
    })
    expect(url).toBe('http://localhost:3000')
  })
})
