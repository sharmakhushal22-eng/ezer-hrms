// lib/esign/signer.ts — the signer side of a link: who the token belongs to, whether they
// may act now, and the short session they get after proving their e-mail. Server only.
import type { NextRequest } from 'next/server'
import { sb } from './server'
import { tokenHash, sha256Hex, newToken, SESSION_TTL_MIN } from './core'

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
