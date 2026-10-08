// app/api/recruitment/send-offer-email/route.ts
// Sends the offer-letter email to the candidate via Gmail (SMTP + App Password), with the
// generated offer letter PDF (POST { to, cc, subject, body, request_id }).
//
// Required env vars (set in .env.local locally and in Vercel for production):
//   GMAIL_USER          - the sending Gmail address, e.g. hr@yourco.com / you@gmail.com
//   GMAIL_APP_PASSWORD  - a 16-char Google "App Password" (NOT the account password).
//                         Create at: Google Account -> Security -> 2-Step Verification -> App passwords
//   GMAIL_FROM_NAME     - (optional) display name on the From header, e.g. "EZER HR Team"
import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import nodemailer from 'nodemailer'
import { loadDossier } from '@/lib/recruitment/offer-dossier'
import { offerLetterPdf } from '@/lib/recruitment/offer-letter-pdf'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime, not Edge

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  try {
    const { to, cc, subject, body, request_id } = await req.json()

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Missing recipient, subject, or body' }, { status: 400 })
    }

    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) {
      return NextResponse.json(
        { error: 'Email is not configured on the server. Set GMAIL_USER and GMAIL_APP_PASSWORD.' },
        { status: 502 },
      )
    }

    const ccList = (cc || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean)

    // The letter is the generated multi-page PDF on the company letterhead, and it can only go
    // once the HR Head has approved, the HR Manager has verified the file and the letter has been generated
    // from that verified file (lib/recruitment/offer-dossier.ts). Checked here, not just in the
    // browser — and there is no other way to send an offer through this route.
    if (!request_id) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
    const d = await loadDossier(String(request_id))
    if (!d) return NextResponse.json({ error: 'Offer request not found' }, { status: 404 })
    if (d.request.status !== 'HR_HEAD_APPROVED') return NextResponse.json({ error: 'The HR Head has not approved this offer.' }, { status: 409 })
    if (!d.complete) return NextResponse.json({ error: 'The offer file has not been verified.' }, { status: 409 })
    if (!d.verification.letter) return NextResponse.json({ error: 'Generate the offer letter before sending it.' }, { status: 409 })
    const pdf = await offerLetterPdf(d)
    const attachments = [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }]

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })

    const info = await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
      to,
      cc: ccList.length ? ccList : undefined,
      subject,
      text: body,
      // Simple HTML version so line breaks render nicely (offer letter goes as the PDF attachment).
      html: String(body).replace(/\n/g, '<br>'),
      attachments,
    })

    return NextResponse.json({ ok: true, messageId: info.messageId })
  } catch (err: any) {
    console.error('send-offer-email failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send email' }, { status: 502 })
  }
}
