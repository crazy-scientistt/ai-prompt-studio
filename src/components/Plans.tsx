import React, { useEffect, useState } from 'react'
import { cycleLabel, fmtPkr, startCheckout } from '../engine/billing'
import { useStore } from '../store'
import { Btn, Chip, Panel, SectionLabel } from './ui'
import { IconCheck, IconCrown, IconSpark } from './Icons'

/* Plans & billing.

   Prices, credits and the monthly/yearly maths all come from the backend
   catalog, so changing them happens in one file on the server rather than here.
   Checkout hands the browser to Safepay; the plan only activates once Safepay's
   signed callback reaches the backend, never on the way back alone. */

function ReturnBanner() {
  const { refreshUser } = useStore()
  const [state, setState] = useState<{ kind: 'paid' | 'canceled' | 'error'; detail?: string } | null>(null)

  useEffect(() => {
    const query = window.location.hash.split('?')[1] || ''
    const q = new URLSearchParams(query)
    if (q.get('paid')) {
      setState({ kind: 'paid', detail: q.get('plan') || undefined })
      void refreshUser()
      // Clean the query out of the URL so a refresh can't re-trigger the banner.
      window.history.replaceState(null, '', `${window.location.pathname}#/plans`)
    } else if (q.get('canceled')) {
      setState({ kind: 'canceled' })
      window.history.replaceState(null, '', `${window.location.pathname}#/plans`)
    } else if (q.get('error')) {
      setState({ kind: 'error', detail: q.get('error') || undefined })
      window.history.replaceState(null, '', `${window.location.pathname}#/plans`)
    }
  }, [refreshUser])

  if (!state) return null
  const tone = state.kind === 'paid' ? 'ok' : state.kind === 'canceled' ? 'warn' : 'bad'
  const text =
    state.kind === 'paid'
      ? `Payment received — your ${state.detail ? state.detail[0].toUpperCase() + state.detail.slice(1) : ''} plan is active. Credits are already in your account.`
      : state.kind === 'canceled'
        ? 'Checkout canceled — nothing was charged.'
        : `We could not confirm that payment (${state.detail || 'unknown'}). Nothing was charged again — if money left your account, contact support with your order id.`
  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 text-[12.5px] ${
        tone === 'ok'
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
          : tone === 'warn'
            ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
            : 'border-red-400/30 bg-red-400/10 text-red-100'
      }`}
    >
      {text}
    </div>
  )
}

export default function Plans() {
  const store = useStore()
  const { plans, user, toast, billingMode, billingReady } = store
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (billingMode) void store.loadPlans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingMode])

  const buy = async (planId: string) => {
    setBusy(planId)
    try {
      const res = await startCheckout(planId, cycle)
      if (!res.ok || !res.data) {
        toast(res.error || 'Could not start the checkout', '⚠️')
        return
      }
      // Off to Safepay — card, JazzCash or EasyPaisa on their page.
      window.location.href = res.data.checkoutUrl
    } finally {
      setBusy('')
    }
  }

  const current = user?.plan ?? 'free'
  const renews = user?.planExpiresAt ? new Date(user.planExpiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return (
    <div className="page-content flex flex-col gap-[var(--space-5)]">
      <header className="result-heading">
        <h1 className="page-title">Plans &amp; billing</h1>
        <p className="page-description">
          One credit runs one full video analysis — frames, storyboard, clip kit, camera/motion/lighting breakdown and the QA repair pass.
          Recompiling a finished analysis for a different model is always free.
        </p>
      </header>

      <ReturnBanner />

      {!billingMode && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-[12.5px] text-amber-100">
          This build has no billing backend configured, so plans are not being charged. Set <code>BILLING_URL</code> on the host to turn on
          accounts and payments.
        </div>
      )}

      {user && (
        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <IconCrown className="w-4 h-4 text-amber-300" />
                <span className="text-[13.5px] font-bold">{user.planName} plan</span>
                {user.cycle && <Chip tone="neutral">{cycleLabel(user.cycle)}</Chip>}
              </div>
              <div className="mt-1 text-[12px] text-muted">
                {user.plan === 'free'
                  ? `${user.credits} free credits left`
                  : `${user.credits} credits · ${renews ? `renews ${renews}` : 'active'} · ${user.recompilesLeft} free recompiles today`}
              </div>
            </div>
            <div className="text-[11.5px] text-muted text-right">
              <div>{user.email}</div>
              <div>{user.spentTotal} analyses run</div>
            </div>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SectionLabel rule={false}>Choose a cycle</SectionLabel>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Billing cycle">
          {(['monthly', 'yearly'] as const).map((c) => (
            <Btn
              key={c}
              type="button"
              variant={cycle === c ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly · save 20%'}
            </Btn>
          ))}
        </div>
      </div>

      <div className="grid gap-[var(--space-4)] md:grid-cols-2 items-start">
        {(plans.length ? plans.filter((p) => p.monthly > 0) : []).map((plan) => {
          const active = current === plan.id
          const price = cycle === 'monthly' ? plan.monthly : plan.yearly
          const isPro = plan.id === 'pro'
          return (
            <Panel key={plan.id} className={`p-5 flex flex-col gap-4 ${isPro ? 'border-white/[0.14]' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {isPro ? <IconSpark className="w-4 h-4 text-lilac" /> : <IconCheck className="w-4 h-4 text-muted" />}
                    <span className="text-[15px] font-bold">{plan.name}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{plan.tagline}</div>
                </div>
                {active && <Chip tone="success">Current</Chip>}
              </div>

              <div>
                <div className="flex items-end gap-2">
                  <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums">{fmtPkr(price)}</span>
                  <span className="text-[12px] text-muted pb-0.5">/{cycle === 'monthly' ? 'month' : 'year'}</span>
                </div>
                {cycle === 'yearly' && (
                  <div className="mt-1 text-[11.5px] text-muted">
                    ≈ {fmtPkr(plan.perMonthIfYearly)}/month · saves {fmtPkr(plan.monthly * 12 - plan.yearly)}
                  </div>
                )}
                <div className="mt-2 text-[12px] text-ink/90">
                  <strong className="font-semibold">{plan.credits} credits</strong> every month
                </div>
              </div>

              <ul className="flex flex-col gap-1.5 text-[12.5px] text-ink/85">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <IconCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-300/80" />
                    <span className="min-w-0">{h}</span>
                  </li>
                ))}
              </ul>

              <Btn
                variant={isPro ? 'primary' : 'secondary'}
                size="lg"
                className="w-full mt-auto"
                loading={busy === plan.id}
                disabled={!billingMode || !billingReady || active}
                onClick={() => void buy(plan.id)}
              >
                {active ? 'Your current plan' : `Upgrade to ${plan.name}`}
              </Btn>
            </Panel>
          )
        })}
        {plans.length === 0 && billingMode && (
          <Panel className="p-5 text-[12.5px] text-muted">Loading plans…</Panel>
        )}
      </div>

      <Panel className="p-5">
        <SectionLabel>How credits work</SectionLabel>
        <ul className="mt-3 grid gap-2 text-[12.5px] text-ink/85 md:grid-cols-2">
          <li>1 credit = 1 complete analysis of one reference video (any length).</li>
          <li>Recompiling a finished analysis for another target model costs 0 credits.</li>
          <li>Credits are added at the start of each month of your plan; unused credits stay usable.</li>
          <li>Pro accounts choose their own engine model (including Claude Opus thinking); Plus uses the Gemini Flash family.</li>
        </ul>
        <p className="mt-3 text-[11.5px] text-muted">
          Payments are processed by Safepay — cards, JazzCash and EasyPaisa. Renewals are manual: you will never be charged without
          starting a payment yourself.
        </p>
      </Panel>
    </div>
  )
}
