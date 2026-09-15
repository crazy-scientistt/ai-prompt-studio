// ─────────────────────────────────────────────────────────────────────────────
// Ledger store — accounts, sessions, orders and credits.
//
// Persistence is one JSON document written atomically (temp file + rename)
// behind an in-process mutex. That is genuinely enough for a launch-scale paid
// app running as a single container, needs zero dependencies, and sits happily
// on a Railway volume. When you outgrow one instance, swap read()/write() for
// Postgres — every caller already treats this module as the only writer.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PLANS, FREE_CREDITS } from './plans.js'

const DB_PATH = join(process.env.DATA_DIR || './data', 'billing.json')

const EMPTY = { users: [], sessions: [], orders: [], events: [] }

let cache = null
let queue = Promise.resolve()

/** Run `fn` with exclusive access to the database (serialised writes). */
function withLock(fn) {
  const run = queue.then(fn, fn)
  // Keep the chain alive even when a caller throws.
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function load() {
  if (cache) return cache
  try {
    const raw = await readFile(DB_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    cache = { ...EMPTY, ...parsed }
  } catch {
    cache = structuredClone(EMPTY)
  }
  return cache
}

async function persist(db) {
  await mkdir(dirname(DB_PATH), { recursive: true })
  const tmp = `${DB_PATH}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(db, null, 2))
  await rename(tmp, DB_PATH)
}

/** Read the database, mutate it, persist — all under the lock. */
export function transact(fn) {
  return withLock(async () => {
    const db = await load()
    const result = await fn(db)
    await persist(db)
    return result
  })
}

/**
 * Like transact(), but only writes the file when the callback says something
 * actually changed — so a plain authenticated request costs no disk I/O.
 * The callback must return `{ dirty: boolean }` to write.
 */
export function transactMaybe(fn) {
  return withLock(async () => {
    const db = await load()
    const result = await fn(db)
    if (result && result.dirty) await persist(db)
    return result
  })
}

export function read(fn) {
  return withLock(async () => fn(await load()))
}

const norm = (email) => String(email || '').trim().toLowerCase()

// ── Accounts ────────────────────────────────────────────────────────────────

export function makeUser({ email, passwordHash, salt }) {
  const now = Date.now()
  return {
    id: randomUUID(),
    email: norm(email),
    passwordHash,
    salt,
    createdAt: now,
    // plan
    plan: 'free',
    cycle: null,
    planStartedAt: null,
    planExpiresAt: null,
    // credits
    credits: FREE_CREDITS,
    creditsGrantedAt: now,
    nextCreditsAt: null, // set once a paid cycle is active
    // anti-abuse
    analysisSessions: {},
    usage: [],
    spentTotal: 0,
  }
}

export const findByEmail = (db, email) => db.users.find((u) => u.email === norm(email))
export const findById = (db, id) => db.users.find((u) => u.id === id)

// ── Sessions ────────────────────────────────────────────────────────────────

export function addSession(db, session) {
  db.sessions.push(session)
  // keep the file from growing forever
  if (db.sessions.length > 5000) db.sessions = db.sessions.slice(-2000)
  return session
}

export function dropSession(db, tokenHash) {
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash)
}

export function dropUserSessions(db, userId) {
  db.sessions = db.sessions.filter((s) => s.userId !== userId)
}

// ── Credits ─────────────────────────────────────────────────────────────────

export function grantCredits(db, user, credits) {
  user.credits += credits
  user.creditsGrantedAt = Date.now()
  return user.credits
}

/**
 * Bring a user's subscription up to date: expire finished plans and top up the
 * monthly credit allowance. Safe to call on every request (cheap) and from the
 * background tick — it is idempotent for a given clock time.
 */
export function reconcile(user, now = Date.now()) {
  const plan = PLANS[user.plan] || PLANS.free
  // Expired paid cycle → back to free (credits already granted stay usable).
  if (user.plan !== 'free' && user.planExpiresAt && user.planExpiresAt <= now) {
    user.plan = 'free'
    user.cycle = null
    user.planStartedAt = null
    user.planExpiresAt = null
    user.nextCreditsAt = null
    user.changed = true
  }
  // Monthly allowance top-up for the active cycle.
  if (user.plan !== 'free' && user.nextCreditsAt && user.nextCreditsAt <= now) {
    let due = 0
    let cursor = user.nextCreditsAt
    // Catch up on any missed months (e.g. the service was asleep).
    while (cursor <= now && due < 24) {
      due += plan.credits
      cursor = addMonths(cursor, 1)
    }
    user.credits += due
    user.creditsGrantedAt = now
    user.nextCreditsAt = cursor
    user.changed = true
    return { granted: due, nextAt: cursor }
  }
  return { granted: 0 }
}

// Calendar-month arithmetic (matching "1 month plan"), clamped so 31 Jan + 1
// month is 28/29 Feb rather than rolling into March.
export function addMonths(ms, months) {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d.getTime()
}

export const cycleEnd = (from, cycle) => (cycle === 'yearly' ? addMonths(from, 12) : addMonths(from, 1))

/** Activate a paid cycle and hand over the first month's credits. */
export function activatePlan(user, planId, cycle, now = Date.now()) {
  const plan = PLANS[planId]
  if (!plan || !plan.monthly) throw new Error(`unknown plan: ${planId}`)
  user.plan = plan.id
  user.cycle = cycle
  user.planStartedAt = now
  user.planExpiresAt = cycleEnd(now, cycle)
  // Credits are granted monthly for both cycles — a yearly payment grants month
  // one immediately and the remaining months top up as they come due, so a
  // burst of abuse can never spend a whole year's allowance at once.
  user.credits += plan.credits
  user.creditsGrantedAt = now
  user.nextCreditsAt = addMonths(now, 1)
  return user
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function makeOrder({ userId, planId, cycle, amount, currency }) {
  return {
    id: randomUUID(),
    userId,
    planId,
    cycle,
    amount,
    currency,
    status: 'pending',
    createdAt: Date.now(),
    paidAt: null,
    tracker: null,
    evidence: null,
    raw: null,
  }
}

export const findOrder = (db, id) => db.orders.find((o) => o.id === id)
export const findOrderByTracker = (db, tracker) => db.orders.find((o) => o.tracker && o.tracker === tracker)

// ── Idempotency ─────────────────────────────────────────────────────────────

/** True the first time an event id is seen. Webhooks are at-least-once. */
export function firstEvent(db, id) {
  if (!id) return true
  if (db.events.includes(id)) return false
  db.events.push(id)
  if (db.events.length > 10000) db.events = db.events.slice(-5000)
  return true
}

export const _dbPath = DB_PATH
