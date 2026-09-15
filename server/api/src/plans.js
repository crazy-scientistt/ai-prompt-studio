// ─────────────────────────────────────────────────────────────────────────────
// Plan catalog — the single source of truth for pricing, credits and which
// models each tier may use. Change prices/credits here and nothing else needs
// to move: the pricing page, the checkout amount and the enforcement all read
// from this file.
//
// Prices are in PKR. Yearly = 12 months with YEARLY_DISCOUNT taken off the total.
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY = 'PKR'
export const YEARLY_DISCOUNT = 0.2

// Credits new accounts get before paying, so a visitor can actually try the
// product (1 credit = 1 full video analysis; recompiling for another model is
// free). Set to 0 to make the app paid-only from the first click.
export const FREE_CREDITS = 5

// Model tiers. A plan lists the tiers it may use; every model id is resolved to
// a tier by pattern, so new Gemini releases land in Plus automatically and new
// Claude/GPT releases require Pro.
//   flash   — the Gemini flash family (cheap, fast)
//   premium — Claude / GPT-OSS (expensive reasoning models)
export const TIERS = {
  flash: (id) => /^gemini-/.test(id),
  premium: (id) => /^(claude|gpt-oss)/.test(id),
}

export function tierOf(modelId) {
  if (typeof modelId !== 'string' || !modelId) return null
  for (const [tier, test] of Object.entries(TIERS)) if (test(modelId)) return tier
  return null
}

export function modelAllowed(planId, modelId) {
  const plan = PLANS[planId]
  if (!plan) return false
  const tier = tierOf(modelId)
  // Unknown families are not silently allowed — new upstream models must be
  // classified above, which keeps a surprise model out of the cheap tier.
  return !!tier && plan.tiers.includes(tier)
}

/** One cycle's price in PKR. */
export function priceFor(planId, cycle) {
  const plan = PLANS[planId]
  if (!plan || !plan.monthly) return 0
  return cycle === 'yearly'
    ? Math.round(plan.monthly * 12 * (1 - YEARLY_DISCOUNT))
    : plan.monthly
}

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Try the studio',
    monthly: 0,
    credits: FREE_CREDITS,
    tiers: ['flash'],
    selectable: false,
    highlights: ['Full video analysis', 'Flash models only', 'Recompile for other models is free'],
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    tagline: 'For regular creators',
    monthly: 2000,
    credits: 300,
    tiers: ['flash'],
    selectable: false,
    highlights: ['300 credits every month', 'Gemini Flash models', 'Recompile for any model, free', 'Full analysis + camera, motion, lighting breakdown'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For serious production',
    monthly: 4000,
    credits: 700,
    tiers: ['flash', 'premium'],
    selectable: true,
    highlights: ['700 credits every month', 'Everything in Plus', 'Claude Opus 4.6 thinking available', 'Frontier reasoning for the hardest shots'],
  },
}

export const PAID_PLANS = ['plus', 'pro']

/** Catalog as the pricing page needs it (prices pre-computed per cycle). */
export function catalog() {
  return {
    currency: CURRENCY,
    yearlyDiscount: YEARLY_DISCOUNT,
    freeCredits: FREE_CREDITS,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      credits: p.credits,
      tiers: p.tiers,
      selectable: p.selectable,
      highlights: p.highlights,
      monthly: p.monthly ? priceFor(p.id, 'monthly') : 0,
      yearly: p.monthly ? priceFor(p.id, 'yearly') : 0,
      perMonthIfYearly: p.monthly ? Math.round(priceFor(p.id, 'yearly') / 12) : 0,
    })),
  }
}
