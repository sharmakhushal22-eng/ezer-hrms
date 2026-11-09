// lib/lms/sso.ts — the one-minute hand-off from EZER HRMS to EZER Learn. Server only.
//
// Learning lives on its own domain (lib/lms/site.ts), and a session cannot cross domains: both
// the ESS token and the Supabase session sit in localStorage, which belongs to one origin. So
// HRMS asks for a hand-off code for whoever is signed in, sends the browser to the LMS with the
// code in the address fragment, and the LMS trades it for a session of its own. Nobody types a
// password twice.
//
// The code says who, and nothing else. It lives for a minute, travels in the fragment (never sent
// to a server, never in a Referer or an access log) and is redeemed by POST. Same discipline as
// candidate-session.ts: a key DERIVED for this purpose and a distinct prefix, so a hand-off code
// can never pass for an ESS token or the other way round.
import crypto from 'crypto'

const PREFIX = 'lmsh'
export const HANDOFF_TTL_MS = 60_000

function key(): string | null {
  const s = process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  return s ? crypto.createHmac('sha256', s).update('ezer-learn:hrms-handoff:v1').digest('base64url') : null
}

const mac = (body: string, k: string) => crypto.createHmac('sha256', k).update(body).digest('base64url')

/** An employee signed into ESS, or a legacy dashboard (Supabase) login. */
export type Handoff =
  | { kind: 'ess'; employeeId: string }
  | { kind: 'legacy'; userId: string; email: string }

export function issueHandoff(who: Handoff, now = Date.now()): string | null {
  const k = key()
  if (!k) return null
  const claims = who.kind === 'ess'
    ? { k: 'ess', e: who.employeeId }
    : { k: 'legacy', u: who.userId, m: who.email }
  const body = Buffer.from(JSON.stringify({ ...claims, n: crypto.randomBytes(9).toString('base64url'), exp: now + HANDOFF_TTL_MS })).toString('base64url')
  return `${PREFIX}.${body}.${mac(body, k)}`
}

/** Null for anything but a valid, unexpired hand-off code. Never throws. */
export function verifyHandoff(code: string | null | undefined, now = Date.now()): Handoff | null {
  const k = key()
  if (!k || !code) return null
  const [prefix, body, sig] = String(code).split('.')
  if (prefix !== PREFIX || !body || !sig) return null
  const expected = Buffer.from(mac(body, k))
  const got = Buffer.from(sig)
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (typeof c?.exp !== 'number' || now > c.exp) return null
    if (c.k === 'ess' && typeof c.e === 'string' && c.e) return { kind: 'ess', employeeId: c.e }
    if (c.k === 'legacy' && typeof c.u === 'string' && c.u && typeof c.m === 'string' && c.m) return { kind: 'legacy', userId: c.u, email: c.m }
    return null
  } catch { return null }
}
