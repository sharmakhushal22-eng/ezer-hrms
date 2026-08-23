// lib/payroll-unlock.ts — a second lock on the payroll module.
//
// Signing in gets you into the dashboard. It should not, by itself, get you into
// payroll: that one screen carries 398 people's salaries, and a session left open on an
// unattended laptop is the ordinary way that leaks. So payroll asks again.
//
// The unlock is a short-lived HMAC token, minted only after the password is checked
// against the account that is already signed in. It is deliberately a DIFFERENT shape
// from the ESS session token — the payload carries a purpose — so an ESS token can never
// be replayed as an unlock, and an unlock can never be used as a session.
import crypto from 'crypto'

/** Thirty minutes. Long enough to run a payroll cycle without re-typing, short enough
 *  that a walked-away-from screen closes itself. */
const TTL_MINUTES = 30

const PURPOSE = 'payroll-unlock'

function secret(): string | null {
  return process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

function sign(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url')
}

/** Minted only by the unlock route, only after a password check. `subject` is the
 *  employee id, or the Supabase user id for the legacy dashboard login. */
export function issueUnlockToken(subject: string): { token: string; expiresAt: number } | null {
  const key = secret()
  if (!key) return null
  const expiresAt = Date.now() + TTL_MINUTES * 60_000
  const body = b64(JSON.stringify({ sub: subject, exp: expiresAt, pur: PURPOSE }))
  return { token: `${body}.${sign(body, key)}`, expiresAt }
}

/** The subject this unlock belongs to, or null. Never throws — a forged token, an
 *  expired one and a missing one are the same answer to the caller. */
export function verifyUnlockToken(token: string | null | undefined): { subject: string } | null {
  const key = secret()
  if (!key || !token) return null
  const [body, mac] = String(token).split('.')
  if (!body || !mac) return null

  // Constant-time compare: rejecting on the first wrong byte leaks the signature one
  // byte at a time.
  const expected = sign(body, key)
  const a = Buffer.from(mac), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const { sub, exp, pur } = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (pur !== PURPOSE) return null           // an ESS session token is not an unlock
    if (!sub || typeof exp !== 'number' || Date.now() > exp) return null
    return { subject: String(sub) }
  } catch { return null }
}

export const UNLOCK_TTL_MINUTES = TTL_MINUTES
export const UNLOCK_STORAGE_KEY = 'ezer_payroll_unlock'
