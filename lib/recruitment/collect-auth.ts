// lib/recruitment/collect-auth.ts — SERVER ONLY. OTP + access-token helpers for the
// candidate document-collection link. Never import this from a client component.
import crypto from 'crypto'

const secret = () => process.env.COLLECT_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-collect-secret'
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const norm = (e: string) => (e || '').trim().toLowerCase()

export const OTP_TTL_MIN = 10
export const OTP_MAX_ATTEMPTS = 5
export const emailsMatch = (a: string, b: string) => !!a && !!b && norm(a) === norm(b)

export const genOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
export const hashOtp = (token: string, otp: string) =>
  crypto.createHash('sha256').update(`${token}:${String(otp).trim()}`).digest('hex')

/** A short-lived bearer the client sends back after verifying its OTP. */
export function signAccess(token: string, email: string, expMs: number): string {
  const payload = b64url(Buffer.from(JSON.stringify({ t: token, e: norm(email), x: expMs })))
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest())
  return `${payload}.${sig}`
}

/** Returns the verified email if the access token is valid for this link, else null. */
export function verifyAccess(access: string | null | undefined, token: string): string | null {
  if (!access || !access.includes('.')) return null
  const [payload, sig] = access.split('.')
  if (!payload || !sig) return null
  const good = b64url(crypto.createHmac('sha256', secret()).update(payload).digest())
  const a = Buffer.from(sig), b = Buffer.from(good)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (p.t !== token || typeof p.x !== 'number' || Date.now() > p.x) return null
    return String(p.e)
  } catch { return null }
}
