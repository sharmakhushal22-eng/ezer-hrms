// lib/esign/signer.ts — the signer side of a link: who the token belongs to, whether they
// may act now, and the short session they get after proving their e-mail. Server only.
import type { NextRequest } from 'next/server'
import { sb, logEvent, mailOtp } from './server'
import { tokenHash, sha256Hex, newToken, newOtp, sealOtp, otpMatches, maskEmail, SESSION_TTL_MIN, OTP_TTL_MIN, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS } from './core'
import { mailConfigured } from '@/lib/mail/send'

export interface LinkState {
  env: any; signer: any; signers: any[]
  /** null when the signer may act now; otherwise the reason they cannot. */
  blocked: null | { code: 'SIGNED' | 'DECLINED' | 'VOIDED' | 'EXPIRED' | 'COMPLETED' | 'NOT_YOUR_TURN'; message: string }
}

export async function loadLink(token: string): Promise<LinkState | null> {
  if (!token || token.length < 30) return null
  const { data: signer, error } = await sb.from('esign_signers').select('*').eq('token_hash', tokenHash(token)).maybeSingle()
  if (error) throw error
  if (!signer) return null
  const [{ data: env }, { data: signers }] = await Promise.all([
    sb.from('esign_envelopes').select('*').eq('id', signer.envelope_id).single(),
    sb.from('esign_signers').select('id, order_no, name, email, status, role_label, signed_at').eq('envelope_id', signer.envelope_id).order('order_no'),
  ])
  if (!env) return null
  let blocked: LinkState['blocked'] = null
  const expired = env.expires_at && new Date(env.expires_at).getTime() < Date.now()
  if (signer.status === 'SIGNED') blocked = { code: 'SIGNED', message: 'You have already signed this document.' }
  else if (signer.status === 'DECLINED') blocked = { code: 'DECLINED', message: 'You declined to sign this document.' }
  else if (env.status === 'VOIDED') blocked = { code: 'VOIDED', message: `The sender cancelled this document${env.void_reason ? `: ${env.void_reason}` : '.'}` }
  else if (env.status === 'DECLINED') blocked = { code: 'DECLINED', message: 'Another signer declined, so this document is closed.' }
  else if (env.status === 'COMPLETED') blocked = { code: 'COMPLETED', message: 'This document is already complete.' }
  else if (env.status === 'EXPIRED' || expired) {
    if (expired && env.status !== 'EXPIRED') await sb.from('esign_envelopes').update({ status: 'EXPIRED' }).eq('id', env.id)
    blocked = { code: 'EXPIRED', message: 'This signing link has expired. Ask the sender to send it again.' }
  } else if (env.signing_order === 'SEQUENTIAL') {
    const open = (signers || []).filter(s => s.status !== 'SIGNED')
    const turn = open.length ? Math.min(...open.map(s => s.order_no)) : null
    if (turn !== null && signer.order_no !== turn) blocked = { code: 'NOT_YOUR_TURN', message: 'Someone before you still has to sign. You will get an e-mail when it is your turn.' }
  }
  return { env, signer, signers: signers || [], blocked }
}

export async function openSession(signerId: string): Promise<string> {
  const { token, hash } = newToken()
  await sb.from('esign_signers').update({ session_hash: hash, session_expires_at: new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString() }).eq('id', signerId)
  return token
}

/** Has this request proved the e-mail OTP for this signer (and Aadhaar, when required)? */
export function sessionOk(req: NextRequest, signer: any, needAadhaar = true): boolean {
  const s = req.headers.get('x-esign-session') || ''
  if (!s || !signer.session_hash || sha256Hex(s) !== signer.session_hash) return false
  if (!signer.session_expires_at || new Date(signer.session_expires_at).getTime() < Date.now()) return false
  if (needAadhaar && signer.auth_method === 'EMAIL_AADHAAR_OTP' && !signer.aadhaar_verified_at) return false
  return true
}

// Local development has no mail transport (GMAIL_* blank): the code is shown on screen there,
// never in production.
export const devEcho = () => process.env.NODE_ENV !== 'production' && !mailConfigured()

type OtpResult = { ok: true; to?: string; dev_otp?: string } | { ok: false; error: string; status: number }

/** E-mail a 6-digit code to the signer (10 min, 6 sends per signer, 30 s apart). Shared by the
 *  public signing link and the signing step embedded in the onboarding portal. */
export async function sendEmailOtp(env: any, signer: any, req: NextRequest): Promise<OtpResult> {
  if (signer.otp_sent_count >= OTP_MAX_SENDS) return { ok: false, status: 429, error: 'Too many codes requested. Ask HR to resend the document.' }
  const issued = signer.otp_expires_at ? new Date(signer.otp_expires_at).getTime() - OTP_TTL_MIN * 60_000 : 0
  if (Date.now() - issued < 30_000) return { ok: false, status: 429, error: 'A code was just sent. Wait 30 seconds before asking for another.' }
  const otp = newOtp()
  await sb.from('esign_signers').update({ otp_hmac: sealOtp(signer.id, 'email', otp), otp_expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(), otp_attempts: 0, otp_sent_count: signer.otp_sent_count + 1 }).eq('id', signer.id)
  const r = await mailOtp({ to: signer.email, name: signer.name, otp, title: env.title })
  await logEvent(env.id, 'OTP_SENT', { signerId: signer.id, actor: `${signer.name} <${signer.email}>`, req, details: { to: maskEmail(signer.email), mail: r.sent ? 'sent' : (r.skipped || r.error) } })
  if (!r.sent && !devEcho()) return { ok: false, status: 502, error: `The code could not be e-mailed (${r.error || r.skipped}). Try again in a minute.` }
  return { ok: true, to: maskEmail(signer.email), ...(devEcho() ? { dev_otp: otp } : {}) }
}

/** Check the e-mailed code; on success the signer's e-mail is marked verified. */
export async function verifyEmailOtp(env: any, signer: any, otp: string, req: NextRequest): Promise<OtpResult> {
  if (!signer.otp_hmac || !signer.otp_expires_at || new Date(signer.otp_expires_at).getTime() < Date.now()) return { ok: false, status: 400, error: 'That code has expired. Request a new one.' }
  if (signer.otp_attempts >= OTP_MAX_ATTEMPTS) return { ok: false, status: 429, error: 'Too many wrong attempts. Request a new code.' }
  const actor = `${signer.name} <${signer.email}>`
  if (!otpMatches(signer.otp_hmac, signer.id, 'email', String(otp || '').trim())) {
    await sb.from('esign_signers').update({ otp_attempts: signer.otp_attempts + 1 }).eq('id', signer.id)
    await logEvent(env.id, 'OTP_FAILED', { signerId: signer.id, actor, req })
    const left = OTP_MAX_ATTEMPTS - signer.otp_attempts - 1
    return { ok: false, status: 400, error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Request a new code.' }
  }
  const at = new Date().toISOString()
  await sb.from('esign_signers').update({ otp_hmac: null, email_verified_at: at }).eq('id', signer.id)
  signer.email_verified_at = at
  await logEvent(env.id, 'OTP_VERIFIED', { signerId: signer.id, actor, req })
  return { ok: true }
}
