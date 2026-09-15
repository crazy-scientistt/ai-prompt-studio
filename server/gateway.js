// ─────────────────────────────────────────────────────────────────────────────
// AI Prompt Studio — Isolated Antigravity Gateway
//
// A fully self-contained OpenAI-compatible gateway in front of Google
// Antigravity (Code Assist / cloud-code upstream). This server has NO
// connection to any other proxy (opencodex or otherwise): separate process,
// separate Docker project, separate network, separate volume. All state
// (OAuth tokens, admin settings) lives in its own volume at /data.
//
// Endpoints:
//   GET  /health                → liveness + upstream config summary
//   GET  /v1/models             → model list from /data/models.json
//   POST /v1/chat/completions   → OpenAI-compatible chat (stream + non-stream)
//   GET  /setup/start           → step 1: device-code style OAuth URL to open
//   POST /setup/token           → step 2: exchange authorization code → tokens
//   GET  /admin/settings        → current default model + config
//   POST /admin/settings        → change default model / thinking level
//   POST /admin/test            → ping test against the upstream
//
// Env:
//   PORT                     (default 8791)
//   GATEWAY_API_KEY          (shared secret; default "ashzo-local-key")
//   DATA_DIR                 (default /data)
//   AG OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / OAUTH_SCOPES
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = parseInt(process.env.PORT || '8791', 10)
const API_KEY = process.env.GATEWAY_API_KEY || 'ashzo-local-key'
const DATA_DIR = process.env.DATA_DIR || '/data'

// Antigravity / Code Assist upstream (standard google auth endpoints).
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'daily-cloudcode-pa.sandbox.googleapis.com'
const UPSTREAM_PATH = process.env.UPSTREAM_PATH || '/v1internal:generateContent'
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || ''
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || ''
const SCOPES = process.env.OAUTH_SCOPES || 'https://www.googleapis.com/auth/cloud-platform'

// ── Persistence (own volume, never shared) ───────────────────────────────────
const files = {
  tokens: path.join(DATA_DIR, 'tokens.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  models: path.join(DATA_DIR, 'models.json'),
}

const DEFAULT_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Antigravity)',
    upstream: 'gemini-3.8-flash',
    family: 'gemini',
    default: true,
    maxChars: 2600,
    notes: 'Fast draft-to-compile model. Default for prompt generation.',
  },
  {
    id: 'gemini-3.8-pro',
    name: 'Gemini 3.8 Pro (Antigravity)',
    upstream: 'gemini-3.8-pro',
    family: 'gemini',
    default: false,
    maxChars: 2600,
    notes: 'Heavier reasoning for dense temporal reconstruction.',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash (Antigravity)',
    upstream: 'gemini-3-flash',
    family: 'gemini',
    default: false,
    maxChars: 2600,
    notes: 'Previous-gen flash. Good availability.',
  },
  {
    id: 'gemini-3-pro-high',
    name: 'Gemini 3 Pro High (Antigravity)',
    upstream: 'gemini-3-pro-high',
    family: 'gemini',
    default: false,
    maxChars: 2600,
    notes: 'High thinking budget.',
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6 (Antigravity)',
    upstream: 'claude-sonnet-4-6',
    family: 'claude',
    default: false,
    maxChars: 2000,
    notes: 'Strong prose compilers.',
  },
  {
    id: 'claude-opus-4.6-thinking',
    name: 'Claude Opus 4.6 Thinking (Antigravity)',
    upstream: 'claude-opus-4-6-thinking',
    family: 'claude',
    default: false,
    maxChars: 2000,
    notes: 'Highest-effort compiler for benchmark tests.',
  },
]

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(files.tokens)) fs.writeFileSync(files.tokens, JSON.stringify({ accounts: [] }, null, 2))
  if (!fs.existsSync(files.settings))
    fs.writeFileSync(files.settings, JSON.stringify({ defaultModel: 'gemini-3.8-flash', thinkingLevel: 'low', compilerPreset: 'ai-prompt-studio-v1' }, null, 2))
  if (!fs.existsSync(files.models)) fs.writeFileSync(files.models, JSON.stringify(DEFAULT_MODELS, null, 2))
}
ensureData()

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2))
const getTokens = () => readJson(files.tokens, { accounts: [] })
const getSettings = () => readJson(files.settings, { defaultModel: 'gemini-3.8-flash' })
const getModels = () => readJson(files.models, DEFAULT_MODELS)

// ── OAuth helpers ────────────────────────────────────────────────────────────
function oauthUrl(state) {
  const u = new URL(OAUTH_AUTH_URL)
  u.searchParams.set('client_id', CLIENT_ID)
  u.searchParams.set('redirect_uri', 'https://codeassist.google.com/authcode')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPES)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('state', state)
  return u.toString()
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: 'https://codeassist.google.com/authcode',
    grant_type: 'authorization_code',
  })
  const r = await fetch(OAUTH_TOKEN_URL, { method: 'POST', body })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error_description || j.error || 'token exchange failed')
  return j // { access_token, refresh_token, expires_in, ... }
}

async function refreshToken(account) {
  const body = new URLSearchParams({
    refresh_token: account.refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
  })
  const r = await fetch(OAUTH_TOKEN_URL, { method: 'POST', body })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error_description || j.error || 'refresh failed')
  account.accessToken = j.access_token
  account.expiresAt = Date.now() + (j.expires_in || 3600) * 1000
  const t = getTokens()
  writeJson(files.tokens, t)
  return account
}

async function getAccessToken() {
  const t = getTokens()
  if (!t.accounts.length) throw new Error('NO_ACCOUNT: no Antigravity account enrolled yet — open /setup/start')
  const acct = t.accounts[0]
  if (!acct.accessToken || Date.now() > (acct.expiresAt || 0) - 60_000) await refreshToken(acct)
  return acct.accessToken
}

// ── OpenAI ↔ Antigravity translation ─────────────────────────────────────────
function pickModel(requested) {
  const models = getModels()
  const wanted = requested || getSettings().defaultModel
  return models.find((m) => m.id === wanted || m.upstream === wanted) || models.find((m) => m.id === getSettings().defaultModel) || models[0]
}

function toUpstreamPayload(openaiBody, modelEntry) {
  const contents = (openaiBody.messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : m.role === 'system' ? 'system' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join('\n') }],
  }))
  const payload = {
    model: modelEntry.upstream,
    contents,
    generationConfig: { temperature: openaiBody.temperature ?? 0.7, maxOutputTokens: openaiBody.max_tokens || 4096 },
  }
  const sys = (openaiBody.messages || []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
  if (sys) payload.systemInstruction = { parts: [{ text: sys }] }
  if (getSettings().thinkingLevel && getSettings().thinkingLevel !== 'none') {
    payload.generationConfig.thinkingConfig = { thinkingLevel: getSettings().thinkingLevel }
  }
  // Code Assist wrapping
  return {
    model: modelEntry.upstream,
    project: getTokens().accounts[0]?.projectId || 'rising-fact-p41fc',
    request: payload,
  }
}

function extractText(upstreamJson) {
  try {
    const cands = upstreamJson?.response?.candidates || upstreamJson?.candidates || []
    let text = ''
    for (const c of cands) for (const p of c?.content?.parts || []) if (p.text) text += p.text
    return text
  } catch {
    return ''
  }
}

async function callUpstream(payload) {
  const token = await getAccessToken()
  const r = await fetch(`https://${UPSTREAM_HOST}${UPSTREAM_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep raw */ }
  return { ok: r.ok, status: r.status, json, raw: text }
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────
function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  })
  res.end(body)
}

function sseChunks(res, modelId, text) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const pieces = text.match(/[\s\S]{1,120}/g) || []
  let i = 0
  const timer = setInterval(() => {
    if (i < pieces.length) {
      const chunk = { id: 'chatcmpl-' + crypto.randomBytes(6).toString('hex'), object: 'chat.completion.chunk', model: modelId, choices: [{ index: 0, delta: { content: pieces[i] }, finish_reason: null }] }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      i++
    } else {
      res.write('data: [DONE]\n\n')
      clearInterval(timer)
      res.end()
    }
  }, 15)
}

function authOk(req) {
  const h = req.headers['authorization'] || ''
  const key = req.headers['x-api-key'] || ''
  return h === `Bearer ${API_KEY}` || key === API_KEY
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    })
    return res.end()
  }

  try {
    // Public: health + setup pages (no key needed to view status)
    if (p === '/health' && req.method === 'GET') {
      const t = getTokens()
      const s = getSettings()
      return send(res, 200, {
        ok: true,
        service: 'ai-prompt-studio-antigravity-gateway',
        isolated: true,
        upstream: UPSTREAM_HOST,
        accounts: t.accounts.map((a) => ({ email: a.email, projectId: a.projectId, enrolled: true })),
        defaultModel: s.defaultModel,
        thinkingLevel: s.thinkingLevel || 'low',
        models: getModels().length,
        time: new Date().toISOString(),
      })
    }

    if (p === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      const s = getSettings()
      const t = getTokens()
      const enrolled = t.accounts.length > 0
      return res.end(`<!doctype html><html><head><title>Antigravity Gateway</title>
<style>body{background:#03040D;color:#E7E9FF;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#0A0C22;border:1px solid rgba(255,255,255,.09);border-radius:24px;padding:36px;max-width:640px}
h1{margin:0 0 6px;font-size:22px}code{background:rgba(255,255,255,.07);padding:2px 7px;border-radius:6px;font-size:13px}
a{color:#A79BFF}.tag{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700}
.ok{background:rgba(52,211,153,.15);color:#34D399}.warn{background:rgba(251,191,36,.15);color:#FBBF24}</style></head>
<body><div class="card">
<h1>🛰️ AI Prompt Studio — Antigravity Gateway</h1>
<p style="color:#8B90B5;margin-top:0">Fully isolated instance · ${UPSTREAM_HOST}</p>
<p>Status: <span class="tag ${enrolled ? 'ok' : 'warn'}">${enrolled ? 'Account enrolled' : 'No account yet'}</span></p>
<p>Default model: <code>${s.defaultModel}</code> · thinking: <code>${s.thinkingLevel || 'low'}</code></p>
${enrolled ? '' : `<p><b>Step 1:</b> open <a href="/setup/start">/setup/start</a> → sign in with your Google account → paste the auth code back in the app or at <code>POST /setup/token</code>.</p>`}
<p><b>API base:</b> <code>http://localhost:${PORT}/v1</code> · <b>key:</b> <code>GATEWAY_API_KEY</code> env value</p>
<p style="color:#8B90B5;font-size:12px">This gateway is a separate Docker project with its own network and volume. It has no connection to any other proxy.</p>
</div></body></html>`)
    }

    if (p === '/setup/start' && req.method === 'GET') {
      if (!CLIENT_ID) return send(res, 503, { error: 'OAUTH_CLIENT_ID missing. Set OAUTH_CLIENT_ID (+ OAUTH_CLIENT_SECRET) in docker-compose.yml to enroll your account.' })
      const state = crypto.randomBytes(8).toString('hex')
      return send(res, 200, {
        step: 1,
        message: 'Open authorizeUrl, sign in with your Antigravity Google account, copy the code from the redirect page (it may show as "code=..." even on an error page), then POST it to /setup/token.',
        authorizeUrl: oauthUrl(state),
        state,
        next: `curl -X POST http://localhost:${PORT}/setup/token -H 'Content-Type: application/json' -d '{"code":"PASTE_CODE_HERE"}'`,
      })
    }

    if (p === '/setup/manual' && req.method === 'POST') {
      // Direct enrollment: paste a refresh token (e.g. from a local Antigravity
      // install or your own OAuth client). No OAuth dance needed.
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body.refreshToken) return send(res, 400, { error: 'Missing refreshToken' })
      const t = getTokens()
      const account = {
        email: body.email || 'antigravity-account',
        accessToken: body.accessToken || '',
        refreshToken: body.refreshToken,
        expiresAt: 0,
        projectId: body.projectId || 'rising-fact-p41fc',
        enrolledAt: new Date().toISOString(),
      }
      t.accounts = [account, ...t.accounts.filter((a) => a.email !== account.email)]
      writeJson(files.tokens, t)
      return send(res, 200, { ok: true, message: 'Account enrolled via refresh token. Gateway refreshes access tokens automatically.', email: account.email, projectId: account.projectId })
    }

    if (p === '/setup/token' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body.code) return send(res, 400, { error: 'Missing code' })
      const tok = await exchangeCode(body.code)
      const t = getTokens()
      const account = {
        email: body.email || 'google-account',
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
        projectId: body.projectId || 'rising-fact-p41fc',
        enrolledAt: new Date().toISOString(),
      }
      t.accounts = [account, ...t.accounts.filter((a) => a.email !== account.email)]
      writeJson(files.tokens, t)
      return send(res, 200, { ok: true, message: 'Account enrolled. The gateway will refresh tokens automatically.', email: account.email, projectId: account.projectId })
    }

    // Everything below requires the shared key
    if (!authOk(req)) return send(res, 401, { error: 'Unauthorized — send Authorization: Bearer <GATEWAY_API_KEY>' })

    if (p === '/v1/models' && req.method === 'GET') {
      const s = getSettings()
      return send(res, 200, {
        object: 'list',
        data: getModels().map((m) => ({ id: m.id, object: 'model', owned_by: 'antigravity-isolated', name: m.name, notes: m.notes, default: m.id === s.defaultModel })),
      })
    }

    if (p === '/v1/chat/completions' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const modelEntry = pickModel(body.model)
      const payload = toUpstreamPayload(body, modelEntry)
      const upstream = await callUpstream(payload)
      if (!upstream.ok) {
        return send(res, upstream.status === 429 ? 429 : 502, {
          error: { message: `Upstream ${upstream.status}: ${(upstream.json?.error?.message || upstream.raw || '').slice(0, 500)}`, type: 'upstream_error', status: upstream.status },
        })
      }
      const text = extractText(upstream.json)
      if (!text) return send(res, 502, { error: { message: 'Empty response from upstream', raw: (upstream.raw || '').slice(0, 500) } })
      if (body.stream) return sseChunks(res, modelEntry.id, text)
      return send(res, 200, {
        id: 'chatcmpl-' + crypto.randomBytes(8).toString('hex'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelEntry.id,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    }

    if (p === '/admin/settings') {
      if (req.method === 'GET') return send(res, 200, { settings: getSettings(), models: getModels(), accounts: getTokens().accounts.map((a) => ({ email: a.email, projectId: a.projectId })) })
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const s = getSettings()
        if (body.defaultModel) {
          const m = getModels().find((x) => x.id === body.defaultModel || x.upstream === body.defaultModel)
          if (!m) return send(res, 400, { error: `Unknown model ${body.defaultModel}` })
          s.defaultModel = m.id
        }
        if (body.thinkingLevel) s.thinkingLevel = body.thinkingLevel
        if (body.compilerPreset) s.compilerPreset = body.compilerPreset
        writeJson(files.settings, s)
        return send(res, 200, { ok: true, settings: s })
      }
    }

    if (p === '/admin/test' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const started = Date.now()
      try {
        const modelEntry = pickModel(body.model)
        const payload = toUpstreamPayload({ messages: [{ role: 'user', content: body.prompt || 'Reply with exactly: PONG' }] }, modelEntry)
        const upstream = await callUpstream(payload)
        const ms = Date.now() - started
        if (!upstream.ok) return send(res, 502, { ok: false, model: modelEntry.id, status: upstream.status, ms, error: (upstream.json?.error?.message || upstream.raw || '').slice(0, 400) })
        return send(res, 200, { ok: true, model: modelEntry.id, ms, reply: extractText(upstream.json).slice(0, 300) })
      } catch (e) {
        return send(res, 500, { ok: false, ms: Date.now() - started, error: String(e.message || e) })
      }
    }

    send(res, 404, { error: `No route ${req.method} ${p}` })
  } catch (e) {
    send(res, 500, { error: String(e.message || e) })
  }
})

server.listen(PORT, () => {
  console.log(`[gateway] isolated Antigravity gateway on :${PORT} → ${UPSTREAM_HOST}${UPSTREAM_PATH}`)
  console.log(`[gateway] data dir: ${DATA_DIR} (own volume — not shared with anything)`)
  console.log(`[gateway] default model: ${getSettings().defaultModel} · accounts enrolled: ${getTokens().accounts.length}`)
})
