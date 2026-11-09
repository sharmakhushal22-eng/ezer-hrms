// app/api/esign/sign/[token]/route.ts — the public signing link. No login: the token in
// the URL plus a one-time password to the signer's own e-mail is the authentication.
//
// GET                                          what the page needs to render (no document yet)
// POST { action: 'send_otp' }                  e-mail a 6-digit code (10 min, 6 sends max)
// POST { action: 'verify_otp', otp }           → { session } sent back as x-esign-session
// POST { action: 'aadhaar_send', aadhaar }     DEMO: validates the number, issues a code
// POST { action: 'aadhaar_verify', otp }
// POST { action: 'submit', signature, kind, consent }   stamps the PDF
// POST { action: 'decline', reason }
import { NextRequest, NextResponse } from 'next/server'
import { sb, logEvent, mailDeclined, appBase, migrationHint } from '@/lib/esign/server'
import { loadLink, openSession, sessionOk, sendEmailOtp, verifyEmailOtp } from '@/lib/esign/signer'
import { applySignature } from '@/lib/esign/flow'
import { newOtp, sealOtp, otpMatches, isValidAadhaar, maskEmail, OTP_TTL_MIN, OTP_MAX_ATTEMPTS, AADHAAR_DEMO } from '@/lib/esign/core'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ token: string }> }
const bad = (error: string, status = 400, extra: object = {}) => NextResponse.json({ error, ...extra }, { status })

export async function GET(req: NextRequest, { params }: Ctx) {
  const { token } = await params
  try {
    const st = await loadLink(token)
    if (!st) return bad('This signing link is not valid. It may have been replaced by a newer one — use the latest e-mail.', 404)
    const { env, signer, signers, blocked } = st
    if (!signer.viewed_at && !blocked) {
      await sb.from('esign_signers').update({ viewed_at: new Date().toISOString(), status: signer.status === 'PENDING' || signer.status === 'WAITING' ? 'VIEWED' : signer.status }).eq('id', signer.id)
      await logEvent(env.id, 'OPENED', { signerId: signer.id, actor: `${signer.name} <${signer.email}>`, req })
    }
    const { data: fields } = await sb.from('esign_fields').select('id, page, x, y, w, h, kind, signer_id').eq('envelope_id', env.id)
    const company = env.company_id ? (await sb.from('companies').select('company_name').eq('id', env.company_id).maybeSingle()).data : null
    return NextResponse.json({
      envelope: { envelope_no: env.envelope_no, title: env.title, message: env.message, category: env.category, page_count: env.page_count, sender: env.created_by_name, sender_email: env.created_by_email, company: company?.company_name || null, expires_at: env.expires_at, signing_order: env.signing_order, status: env.status },
      signer: { name: signer.name, email_masked: maskEmail(signer.email), role_label: signer.role_label, auth_method: signer.auth_method, email_verified: !!signer.email_verified_at, aadhaar_verified: !!signer.aadhaar_verified_at, aadhaar_last4: signer.aadhaar_last4, status: signer.status, signed_at: signer.signed_at },
      signers: signers.map(s => ({ order_no: s.order_no, name: s.name, role_label: s.role_label, status: s.status, signed_at: s.signed_at, you: s.id === signer.id })),
      fields: (fields || []).filter(f => f.signer_id === signer.id).map(({ signer_id, ...f }) => { void signer_id; return { ...f, x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) } }),
      others: (fields || []).filter(f => f.signer_id !== signer.id).map(f => ({ page: f.page, x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) })),
      blocked, aadhaar_demo: AADHAAR_DEMO,
    })
  } catch (e: any) { return bad(migrationHint(e) || e?.message || String(e), 500) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params
  let st: Awaited<ReturnType<typeof loadLink>>
  try { st = await loadLink(token) } catch (e: any) { return bad(migrationHint(e) || e?.message || String(e), 500) }
  if (!st) return bad('This signing link is not valid.', 404)
  const { env, signer, blocked } = st
  const body = await req.json().catch(() => ({}))
  const actor = `${signer.name} <${signer.email}>`
  if (blocked) return bad(blocked.message, 409, { blocked })

  switch (body.action) {
    case 'send_otp': {
      const r = await sendEmailOtp(env, signer, req)
      if (!r.ok) return bad(r.error, r.status)
      return NextResponse.json(r)
    }
    case 'verify_otp': {
      const r = await verifyEmailOtp(env, signer, body.otp, req)
      if (!r.ok) return bad(r.error, r.status)
      const session = await openSession(signer.id)
      return NextResponse.json({ ok: true, session, need_aadhaar: signer.auth_method === 'EMAIL_AADHAAR_OTP' && !signer.aadhaar_verified_at })
    }
    case 'aadhaar_send': {
      if (!sessionOk(req, signer, false)) return bad('Verify your e-mail first.', 401)
      const num = String(body.aadhaar || '').replace(/\s+/g, '')
      if (!isValidAadhaar(num)) return bad('That is not a valid Aadhaar number. Check the 12 digits.')
      const otp = newOtp()
      await sb.from('esign_signers').update({ aadhaar_last4: num.slice(-4), aadhaar_otp_hmac: sealOtp(signer.id, 'aadhaar', otp), aadhaar_otp_expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(), otp_attempts: 0 }).eq('id', signer.id)
      await logEvent(env.id, 'AADHAAR_OTP_SENT', { signerId: signer.id, actor, req, details: { last4: num.slice(-4), mode: AADHAAR_DEMO ? 'DEMO' : 'LIVE' } })
      // DEMO: no UIDAI/ESP call is made. The code is returned so the flow can be exercised;
      // a licensed eSign provider replaces this branch (it sends the OTP to the Aadhaar-linked mobile).
      return NextResponse.json({ ok: true, demo: AADHAAR_DEMO, ...(AADHAAR_DEMO ? { demo_otp: otp } : {}) })
    }
    case 'aadhaar_verify': {
      if (!sessionOk(req, signer, false)) return bad('Verify your e-mail first.', 401)
      if (!signer.aadhaar_otp_hmac || new Date(signer.aadhaar_otp_expires_at).getTime() < Date.now()) return bad('That code has expired. Request a new one.')
      if (signer.otp_attempts >= OTP_MAX_ATTEMPTS) return bad('Too many wrong attempts. Request a new code.', 429)
      if (!otpMatches(signer.aadhaar_otp_hmac, signer.id, 'aadhaar', String(body.otp || '').trim())) {
        await sb.from('esign_signers').update({ otp_attempts: signer.otp_attempts + 1 }).eq('id', signer.id)
        return bad('That code is not right.')
      }
      await sb.from('esign_signers').update({ aadhaar_otp_hmac: null, aadhaar_verified_at: new Date().toISOString(), aadhaar_mode: AADHAAR_DEMO ? 'DEMO' : 'LIVE' }).eq('id', signer.id)
      await logEvent(env.id, 'AADHAAR_VERIFIED', { signerId: signer.id, actor, req, details: { last4: signer.aadhaar_last4, mode: AADHAAR_DEMO ? 'DEMO' : 'LIVE' } })
      return NextResponse.json({ ok: true })
    }
    case 'submit': {
      if (!sessionOk(req, signer)) return bad('Your verification has expired. Verify again to sign.', 401)
      if (body.consent !== true) return bad('Please confirm you agree to sign electronically.')
      const kind = ['DRAWN', 'TYPED', 'UPLOADED'].includes(body.kind) ? body.kind : 'DRAWN'
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ''))
      if (!m) return bad('Add your signature first.')
      const png = Buffer.from(m[1], 'base64')
      if (png.length < 200 || png.length > 1_500_000 || png.readUInt32BE(0) !== 0x89504e47) return bad('That signature image could not be read. Draw or upload it again.')
      const mi = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.initials || ''))
      const ini = mi ? Buffer.from(mi[1], 'base64') : null
      if (ini && (ini.length > 1_000_000 || ini.readUInt32BE(0) !== 0x89504e47)) return bad('Those initials could not be read. Add them again.')
      try {
        const r = await applySignature(env.id, signer, new Uint8Array(png), kind, req, appBase(req), ini ? new Uint8Array(ini) : null)
        return NextResponse.json({ ok: true, completed: r.completed })
      } catch (e: any) { return bad(migrationHint(e) || e?.message || String(e), 500) }
    }
    case 'decline': {
      if (!sessionOk(req, signer, false)) return bad('Verify your e-mail first, so we know the decline is really yours.', 401)
      const reason = String(body.reason || '').trim()
      if (reason.length < 3) return bad('Tell the sender why, in a few words.')
      const now = new Date().toISOString()
      await sb.from('esign_signers').update({ status: 'DECLINED', declined_at: now, decline_reason: reason, session_hash: null }).eq('id', signer.id)
      await sb.from('esign_envelopes').update({ status: 'DECLINED', updated_at: now }).eq('id', env.id)
      await logEvent(env.id, 'DECLINED', { signerId: signer.id, actor, req, details: { reason } })
      if (env.created_by_email) await mailDeclined({ to: env.created_by_email, title: env.title, who: signer.name, reason, envelopeNo: env.envelope_no })
      return NextResponse.json({ ok: true })
    }
  }
  return bad('Unknown action')
}
