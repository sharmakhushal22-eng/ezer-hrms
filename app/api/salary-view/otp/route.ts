// app/api/salary-view/otp/route.ts — email-OTP login for the candidate salary link.
//   POST { token, action:'request' }        -> email a 6-digit OTP to the candidate's registered email
//   POST { token, action:'verify', otp }    -> on success return an access token for /api/salary-view/*
//
// The candidate never types an email: the OTP always goes to the address on the
// candidate record, which the page shows masked.

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { genOtp, hashOtp, signAccess, OTP_TTL_MIN, OTP_MAX_ATTEMPTS } from '@/lib/recruitment/collect-auth'
import { negotiationByToken, registeredEmail, accessExpiryMs, maskEmail } from '../_shared'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const token = String(body?.token || '')
  const action = body?.action

  const neg = await negotiationByToken(token)
  if (!neg) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  const email = await registeredEmail(neg)
  if (!email) return NextResponse.json({ error: 'No email is registered for this offer. Please contact your recruiter.' }, { status: 400 })

  if (action === 'request') {
    const otp = genOtp()
    const expires = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString()
    const { error } = await sb.from('ctc_negotiations')
      .update({ otp_hash: hashOtp(token, otp), otp_expires_at: expires, otp_attempts: 0 }).eq('id', neg.id)
    if (error) return NextResponse.json({ error: /otp_hash|otp_expires_at|otp_attempts/.test(error.message) ? 'OTP login is not set up yet (migration 132). Please contact HR.' : error.message }, { status: 500 })

    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
    let sent = false, debugOtp: string | undefined
    if (user && pass) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
        const company = neg.company_name || process.env.GMAIL_FROM_NAME || 'HR Team'
        await t.sendMail({
          from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
          to: email,
          subject: `Your salary offer verification code: ${otp}`,
          text: `Dear ${neg.candidate_name || 'Candidate'},\n\nYour one-time code to open your salary offer from ${company} is ${otp}. It is valid for ${OTP_TTL_MIN} minutes.\n\nIf you did not request this, please ignore this email.`,
          html: `<p>Dear ${neg.candidate_name || 'Candidate'},</p><p>Your one-time code to open your salary offer from <b>${company}</b> is:</p><p style="font-size:26px;font-weight:800;letter-spacing:4px;color:#7C3AED">${otp}</p><p>Valid for ${OTP_TTL_MIN} minutes. If you did not request this, please ignore this email.</p>`,
        })
        sent = true
      } catch { /* fall through */ }
    }
    if (!sent && process.env.NODE_ENV !== 'production') debugOtp = otp   // local/dev only: makes the flow testable without SMTP
    return NextResponse.json({ ok: true, sent, sentTo: maskEmail(email), ttlMin: OTP_TTL_MIN, ...(debugOtp ? { debugOtp } : {}) })
  }

  if (action === 'verify') {
    const otp = String(body?.otp || '').trim()
    if (!/^\d{6}$/.test(otp)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
    if (!neg.otp_hash || !neg.otp_expires_at || new Date(neg.otp_expires_at).getTime() < Date.now())
      return NextResponse.json({ error: 'Your code has expired. Please request a new one.' }, { status: 400 })
    if ((neg.otp_attempts || 0) >= OTP_MAX_ATTEMPTS)
      return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 })
    if (hashOtp(token, otp) !== neg.otp_hash) {
      await sb.from('ctc_negotiations').update({ otp_attempts: (neg.otp_attempts || 0) + 1 }).eq('id', neg.id)
      return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })
    }
    await sb.from('ctc_negotiations').update({ otp_hash: null, otp_expires_at: null, otp_attempts: 0, otp_verified_at: new Date().toISOString() }).eq('id', neg.id)
    const expMs = accessExpiryMs(neg)
    return NextResponse.json({ ok: true, access: signAccess(token, email, expMs), expiresAt: new Date(expMs).toISOString() })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
