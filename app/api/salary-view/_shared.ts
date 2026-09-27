// app/api/salary-view/_shared.ts — helpers shared by the salary-link routes (server only).
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { verifyAccess } from '@/lib/recruitment/collect-auth'

export const OFFER_VALID_DAYS = 7
export const ACCESS_HEADER = 'x-salary-access'

export async function negotiationByToken(token: string) {
  if (!token) return null
  const { data } = await sb.from('ctc_negotiations').select('*').eq('link_token', token).maybeSingle()
  return data
}

/** The candidate's registered email — the only address the OTP goes to. */
export async function registeredEmail(neg: any): Promise<string | null> {
  if (!neg?.candidate_id) return null
  const { data } = await sb.from('candidates').select('email').eq('id', neg.candidate_id).maybeSingle()
  const e = (data?.email || '').trim()
  return e || null
}

/** Access tokens live as long as the offer link (7 days from send), min 24h. */
export function accessExpiryMs(neg: any): number {
  const sent = new Date(neg?.link_sent_at || neg?.created_at || Date.now()).getTime()
  return Math.max(sent + OFFER_VALID_DAYS * 86400_000, Date.now() + 24 * 3600_000)
}

export function maskEmail(e: string) {
  const [u, d] = e.split('@')
  if (!d) return e
  const head = u.length <= 2 ? u[0] : u.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(2, u.length - 2))}@${d}`
}

/** Verified email for this request, or null when the access header is missing / bad. */
export async function verifiedCaller(req: Request, token: string, neg: any): Promise<string | null> {
  const email = verifyAccess(req.headers.get(ACCESS_HEADER), token)
  if (!email) return null
  const reg = await registeredEmail(neg)
  return reg && reg.toLowerCase() === email.toLowerCase() ? reg : null
}
