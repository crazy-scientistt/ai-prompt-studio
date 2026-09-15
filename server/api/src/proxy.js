// ─────────────────────────────────────────────────────────────────────────────
// Enforcement layer between the app and the Antigravity proxy.
//
// The app never talks to the proxy directly any more: it talks to us, and we
// hold the proxy key. That is what gives the paywall teeth — a customer cannot
// skip the credits by calling the model endpoint themselves, because they would
// need the key, and the key only exists in this process.
//
// Per request:
//   · a valid session is required (except the admin key path)
//   · the requested model must be allowed by the caller's plan
//   · paid model work must sit inside an active "analysis session", which is
//     exactly what a credit buys (or a free recompile allowance)
// ─────────────────────────────────────────────────────────────────────────────

import { modelAllowed, tierOf } from './plans.js'

const PROXY_URL = (process.env.PROXY_URL || 'http://localhost:3000').replace(/\/+$/, '')
const PROXY_KEY = process.env.PROXY_KEY || ''
const ADMIN_KEY = process.env.ADMIN_KEY || ''

// One credit = one full analysis. A real analysis makes many model calls
// (storyboard, frames, kit, critic, repair), so a credit buys a budget of calls
// inside a time window rather than a single HTTP request.
const ANALYSIS_CALL_BUDGET = Number(process.env.ANALYSIS_CALL_BUDGET || 80)
const ANALYSIS_TTL_MIN = Number(process.env.ANALYSIS_TTL_MIN || 45)
const RECOMPILE_CALL_BUDGET = Number(process.env.RECOMPILE_CALL_BUDGET || 24)
const RECOMPILE_DAILY_CAP = Number(process.env.RECOMPILE_DAILY_CAP || 12)

export const upstreamKeyConfigured = () => !!PROXY_KEY
export const upstreamUrl = () => PROXY_URL

/** Owner bypass: the admin console can ping models without spending credits. */
export const isAdmin = (req) => !!ADMIN_KEY && req.headers['x-admin-key'] === ADMIN_KEY

// ── Analysis sessions ───────────────────────────────────────────────────────

/** Prune finished sessions so the user record stays small. */
export function pruneSessions(user, now = Date.now()) {
  for (const [id, s] of Object.entries(user.analysisSessions || {})) {
    if ((s.expiresAt || 0) <= now || s.callsRemaining <= 0) delete user.analysisSessions[id]
  }
  return user.analysisSessions || {}
}

export function openSession(user, { id, kind, credits }) {
  user.analysisSessions = pruneSessions(user)
  const budget = kind === 'recompile' ? RECOMPILE_CALL_BUDGET : ANALYSIS_CALL_BUDGET
  user.analysisSessions[id] = {
    id,
    kind,
    createdAt: Date.now(),
    expiresAt: Date.now() + ANALYSIS_TTL_MIN * 60_000,
    callsRemaining: budget,
    budget,
    credits: credits || 0,
  }
  return user.analysisSessions[id]
}

/** Free-recompile allowance, counted per rolling day. */
export function recompilesLeft(user, now = Date.now()) {
  const dayAgo = now - 86_400_000
  const used = (user.usage || []).filter((u) => u.kind === 'recompile' && u.at > dayAgo).length
  return Math.max(0, RECOMPILE_DAILY_CAP - used)
}

export function recordUsage(user, entry) {
  user.usage = [...(user.usage || []), entry].slice(-200)
}

// ── Request handling ────────────────────────────────────────────────────────

/**
 * Decide whether a model call may proceed, consuming one call from the session.
 * @returns {{ ok: true } | { ok: false, status: number, code: string, message: string }}
 */
export function authorizeCall({ user, model, analysisId, admin }) {
  if (admin) return { ok: true }
  const allowed = modelAllowed(user.plan, model)
  if (!allowed) {
    const tier = tierOf(model)
    return {
      ok: false,
      status: 403,
      code: 'plan_model',
      message:
        tier === 'premium'
          ? `The ${model} model is part of the Pro plan. Upgrade to use frontier reasoning models.`
          : `The ${model} model is not available on your plan.`,
    }
  }
  const sessions = pruneSessions(user)
  const session = analysisId ? sessions[analysisId] : null
  if (!session) {
    return {
      ok: false,
      status: 402,
      code: 'analysis_required',
      message: 'No active analysis. Start an analysis (or recompile) before generating prompts.',
    }
  }
  if (session.callsRemaining <= 0) {
    delete sessions[analysisId]
    return { ok: false, status: 402, code: 'analysis_exhausted', message: 'This analysis used its full model budget. Start a new analysis.' }
  }
  session.callsRemaining -= 1
  session.lastCallAt = Date.now()
  return { ok: true, session }
}

const forwardHeaders = () => {
  const h = { 'Content-Type': 'application/json' }
  if (PROXY_KEY) h.Authorization = `Bearer ${PROXY_KEY}`
  return h
}

// The owner's admin key may use /v1/* without credits or a session; treat it as
// the most permissive plan so nothing is filtered away from their own testing.
const ADMIN_VIEW = { plan: 'pro', analysisSessions: {}, usage: [] }

async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('Request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Strip the fields the model list is filtered on, keeping everything else. */
async function listModels(user) {
  const r = await fetch(`${PROXY_URL}/v1/models`, { headers: forwardHeaders() })
  const j = await r.json().catch(() => ({ data: [] }))
  const data = (j.data || []).filter((m) => modelAllowed(user.plan, m.id))
  return { ...j, data }
}

/**
 * GET/POST passthrough under /v1/*.
 * @returns {Promise<boolean>} true when the request was handled here
 */
export async function handleV1({ req, res, path, search, user, admin }) {
  if (!path.startsWith('/v1/')) return false
  const viewer = user || ADMIN_VIEW

  if (path === '/v1/models' && req.method === 'GET') {
    const body = await listModels(viewer)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return true
  }

  const raw = await readBody(req)
  let parsed = null
  if (raw.length) {
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      parsed = null
    }
  }

  if (parsed && typeof parsed.model === 'string') {
    const verdict = authorizeCall({ user, model: parsed.model, analysisId: req.headers['x-analysis-id'], admin })
    if (!verdict.ok) {
      res.writeHead(verdict.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: verdict.message, code: verdict.code, type: 'billing_error' } }))
      return true
    }
    if (verdict.session) recordUsage(user, { at: Date.now(), kind: verdict.session.kind, model: parsed.model, analysisId: verdict.session.id })
  }

  const upstream = await fetch(`${PROXY_URL}${path}${search || ''}`, {
    method: req.method,
    headers: { ...forwardHeaders(), Accept: req.headers.accept || '*/*' },
    body: raw.length && req.method !== 'GET' && req.method !== 'HEAD' ? raw : undefined,
  })

  const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' }
  if (upstream.headers.get('cache-control')) headers['Cache-Control'] = upstream.headers.get('cache-control')
  res.writeHead(upstream.status, headers)
  if (!upstream.body) {
    res.end()
    return true
  }
  // Stream straight through so live analysis keeps rendering token by token.
  for await (const chunk of upstream.body) {
    if (!res.write(chunk)) await new Promise((r) => res.once('drain', r))
  }
  res.end()
  return true
}

/**
 * The owner's site-wide model lives on the proxy dashboard; return the model the
 * caller may actually use, so a Plus customer never receives a Pro-only model.
 */
export async function siteModelFor(user) {
  let chosen = ''
  try {
    const headers = forwardHeaders()
    const r = await fetch(`${PROXY_URL}/api/site-model`, { headers })
    if (r.ok) {
      const j = await r.json().catch(() => null)
      if (typeof j?.model === 'string') chosen = j.model
    }
    // Prefer the model announced by /v1/models, which the proxy keeps current.
    const models = await listModels(user)
    const ids = (models.data || []).map((m) => m.id)
    if (chosen && modelAllowed(user.plan, chosen)) return { model: chosen, source: 'site' }
    const fallback =
      ids.find((id) => /^gemini-3\.8-flash-high$/.test(id)) ||
      ids.filter((id) => /^gemini-3(\.\d+)?-flash(-[a-z]+)?$/.test(id)).sort().reverse()[0] ||
      ids[0] ||
      ''
    return { model: fallback, source: chosen ? 'plan_fallback' : 'auto', requested: chosen }
  } catch (e) {
    return { model: '', source: 'error', error: String(e?.message || e) }
  }
}
