// ─────────────────────────────────────────────────────────────────────────────
// Accounts: password hashing and session tokens.
//
// Passwords: scrypt with a per-user random salt (node:crypto, no dependencies).
// Sessions: compact signed tokens — base64url(payload) + '.' + HMAC-SHA256 —
// stored hashed in the ledger so a leaked database file cannot be replayed as
// a login. Send them as `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret'
if (SESSION_SECRET === 'dev-only-insecure-secret') {
  console.warn('[auth] SESSION_SECRET is unset — using an insecure development secret. Set it in production.')
}
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex')
  return { hash, salt }
}

export function checkPassword(password, salt, expected) {
  try {
    const { hash } = hashPassword(password, salt)
    const a = Buffer.from(hash, 'hex')
    const b = Buffer.from(String(expected), 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const b64 = (buf) => Buffer.from(buf).toString('base64url')

export function signSession(userId, now = Date.now()) {
  const payload = b64(JSON.stringify({ uid: userId, iat: now, exp: now + SESSION_DAYS * 86400_000 }))
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Returns the decoded payload, or null when the token is invalid/expired. */
export function verifySession(token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!claims?.uid || !claims?.exp || claims.exp <= now) return null
    return claims
  } catch {
    return null
  }
}

/** We store only a hash of the token, so a leaked file can't be replayed. */
export const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const validEmail = (email) => EMAIL_RE.test(String(email || '').trim())

/** Cheap gate before the (deliberately slow) scrypt work. */
export function passwordProblem(password) {
  const p = String(password || '')
  if (p.length < 8) return 'Password must be at least 8 characters.'
  if (/^\d+$/.test(p)) return 'Password cannot be only numbers.'
  return null
}
