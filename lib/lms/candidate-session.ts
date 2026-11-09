// lib/lms/candidate-session.ts — the pre-joining learner's session. Server only.
//
// A candidate is not an employee, and this token must never pass for an ESS one. verifyEssToken
// accepts anything signed with the ESS secret and reads `sub` as an employee id, and
// requireDashboardUser only rejects an account it finds, so a candidate token signed the same
// way would walk into every ESS route as a nobody. Hence a key DERIVED for this purpose alone
// and a distinct prefix: the ESS verifier splits on one dot, and fails on both counts.
import crypto from 'crypto'

const PREFIX = 'lmsc'
const TTL_HOURS = 8

function key(): string | null {
  const s = process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  return s ? crypto.createHmac('sha256', s).update('ezer-learn:candidate-session:v1').digest('base64url') : null
}

const mac = (body: string, k: string) => crypto.createHmac('sha256', k).update(body).digest('base64url')

export const isCandidateToken = (t: string | null | undefined) => String(t || '').startsWith(`${PREFIX}.`)

export function issueCandidateToken(learnerId: string, sessionVersion: number, now = Date.now()): string | null {
  const k = key()
  if (!k) return null
  const body = Buffer.from(JSON.stringify({ sub: learnerId, ver: sessionVersion, exp: now + TTL_HOURS * 3_600_000 })).toString('base64url')
  return `${PREFIX}.${body}.${mac(body, k)}`
}

export interface CandidateSession { learnerId: string; version: number }

/** Null for anything but a valid, unexpired candidate token. Never throws. */
export function verifyCandidateToken(token: string | null | undefined, now = Date.now()): CandidateSession | null {
  const k = key()
  if (!k || !token) return null
  const [prefix, body, sig] = String(token).split('.')
  if (prefix !== PREFIX || !body || !sig) return null
  const expected = Buffer.from(mac(body, k))
  const got = Buffer.from(sig)
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null
  try {
    const { sub, ver, exp } = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!sub || typeof ver !== 'number' || typeof exp !== 'number' || now > exp) return null
    return { learnerId: String(sub), version: ver }
  } catch { return null }
}

const otpKey = () => crypto.createHmac('sha256', process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').update('ezer-learn:candidate-otp:v1').digest()

/** Bound to the learner, so a stored value cannot be replayed against another row. */
export const otpHmac = (learnerId: string, otp: string) =>
  crypto.createHmac('sha256', otpKey()).update(`${learnerId}:${otp}`).digest('hex')

export function newOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function newLinkToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashLinkToken(token) }
}
export const hashLinkToken = (t: string) => crypto.createHash('sha256').update(String(t || '')).digest('hex')
