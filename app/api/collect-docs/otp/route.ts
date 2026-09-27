// app/api/collect-docs/otp/route.ts — email-OTP gate for the public upload link.
//   POST { token, action:'request', email }        -> email a 6-digit OTP to the registered address
//   POST { token, action:'verify',  email, otp }    -> on success return an access token
//
// The candidate must own the exact email the recruiter sent the link to.

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { genOtp, hashOtp, signAccess, emailsMatch, OTP_TTL_MIN, OTP_MAX_ATTEMPTS } from '@/lib/recruitment/collect-auth'

export const runtime = 'nodejs'

const linkFor = async (token: string) =>
  (await sb.from('document_collection_links').select('*').eq('link_token', token).maybeSingle()).data
const isExpired = (l: any) => l.status === 'EXPIRED' || (l.expires_at && new Date(l.expires_at).getTime() < Date.now())

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const token = String(body?.token || '')
  const action = body?.action
  const email = String(body?.email || '').trim()

  const link = await linkFor(token)
  if (!link) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (isExpired(link)) return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
  if (link.status === 'SUBMITTED') return NextResponse.json({ error: 'This submission is already complete.' }, { status: 409 })
  if (!link.candidate_email) return NextResponse.json({ error: 'No email is on record for this link. Please contact your recruiter.' }, { status: 400 })
  if (!emailsMatch(email, link.candidate_email))
    return NextResponse.json({ error: 'This email is not registered for this document link.' }, { status: 403 })

  // ── request an OTP ──
  if (action === 'request') {
    const otp = genOtp()
    const expires = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString()
    const { error } = await sb.from('document_collection_links')
      .update({ otp_hash: hashOtp(token, otp), otp_expires_at: expires, otp_attempts: 0 }).eq('id', link.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
    let sent = false, debugOtp: string | undefined
    if (user && pass) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
        await t.sendMail({
          from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
          to: link.candidate_email,
          subject: `Your document upload verification code: ${otp}`,
          text: `Your one-time verification code is ${otp}. It is valid for ${OTP_TTL_MIN} minutes.\n\nIf you did not request this, please ignore this email.`,
          html: `<p>Your one-time verification code is:</p><p style="font-size:26px;font-weight:800;letter-spacing:4px;color:#7C3AED">${otp}</p><p>Valid for ${OTP_TTL_MIN} minutes. If you did not request this, please ignore this email.</p>`,
        })
        sent = true
      } catch { /* fall through */ }
    }
    // If email isn't configured (local/dev), return the code so the flow is testable.
    if (!sent && process.env.NODE_ENV !== 'production') debugOtp = otp
    return NextResponse.json({ ok: true, sent, sentTo: maskEmail(link.candidate_email), ...(debugOtp ? { debugOtp } : {}) })
  }

  // ── verify an OTP ──
  if (action === 'verify') {
    const otp = String(body?.otp || '').trim()
    if (!link.otp_hash || !link.otp_expires_at || new Date(link.otp_expires_at).getTime() < Date.now())
      return NextResponse.json({ error: 'Your code has expired. Please request a new one.' }, { status: 400 })
    if ((link.otp_attempts || 0) >= OTP_MAX_ATTEMPTS)
      return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 })
    if (hashOtp(token, otp) !== link.otp_hash) {
      await sb.from('document_collection_links').update({ otp_attempts: (link.otp_attempts || 0) + 1 }).eq('id', link.id)
      return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })
    }
    // one-time: clear the OTP, issue an access token valid until the link expires
    await sb.from('document_collection_links').update({ otp_hash: null, otp_expires_at: null, otp_attempts: 0 }).eq('id', link.id)
    const expMs = link.expires_at ? new Date(link.expires_at).getTime() : Date.now() + 24 * 3600_000
    return NextResponse.json({ ok: true, access: signAccess(token, link.candidate_email, expMs) })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

function maskEmail(e: string) {
  const [u, d] = e.split('@')
  if (!d) return e
  const head = u.length <= 2 ? u[0] : u.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(2, u.length - 2))}@${d}`
}
