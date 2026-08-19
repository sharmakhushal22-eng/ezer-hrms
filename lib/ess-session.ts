// lib/ess-session.ts — a session token an ESS employee cannot forge.
//
// ESS employees are not Supabase auth users, so there is no auth.uid() to check and
// RLS cannot identify them. Until now the "session" was { employee_id } sitting in
// localStorage in plain text, and every ESS API route simply believed the employee_id
// it was handed. Anyone could put somebody else's id in the body and act as them —
// file their travel logs, read their claims.
//
// This signs the id with a server-only secret. The client still holds the token, but
// it cannot mint one, and the server never trusts an id that did not come out of a
// verified token.
//
// Stateless on purpose: a session table would need a migration, and this needs to work
// before the next one runs.
import crypto from 'crypto'

const TTL_HOURS = 12

/** Server-only. Never NEXT_PUBLIC_* — a public secret signs nothing.
 *  Falls back to the service-role key, which is already set in the deployment. */
function secret(): string | null {
  return process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

const b64 = (s: string | Buffer) =>
  Buffer.from(s).toString('base64url')

function sign(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url')
}

/** Issued at login. Carries the employee id and an expiry, and nothing worth hiding. */
export function issueEssToken(employeeId: string): string | null {
  const key = secret()
  if (!key) return null
  const body = b64(JSON.stringify({ sub: employeeId, exp: Date.now() + TTL_HOURS * 3600_000 }))
  return `${body}.${sign(body, key)}`
}

export interface EssSession { employeeId: string }

/** Returns the employee this token belongs to, or null. Never throws — a bad token
 *  and a missing token are the same answer to the caller. */
export function verifyEssToken(token: string | null | undefined): EssSession | null {
  const key = secret()
  if (!key || !token) return null
  const [body, mac] = String(token).split('.')
  if (!body || !mac) return null

  // Constant-time compare: a fast reject on the first wrong byte leaks the signature
  // one byte at a time.
  const expected = sign(body, key)
  const a = Buffer.from(mac), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const { sub, exp } = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!sub || typeof exp !== 'number' || Date.now() > exp) return null
    return { employeeId: String(sub) }
  } catch { return null }
}

/** The employee making this request, from the Authorization header.
 *  An `employee_id` in the body or query string is NOT accepted — that was the hole. */
export function essEmployeeFromRequest(req: { headers: { get(n: string): string | null } }): string | null {
  const h = req.headers.get('authorization') || ''
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
  return verifyEssToken(token)?.employeeId ?? null
}

/** True when no secret is configured — the caller should refuse rather than wave
 *  everyone through, which is what an unconfigured gate would otherwise do. */
export function essSessionUnavailable(): boolean {
  return !secret()
}
