// app/api/recruitment/send-offer-email/route.ts
// Sends the offer-letter email to the candidate via Gmail (SMTP + App Password).
//
// Required env vars (set in .env.local locally and in Vercel for production):
//   GMAIL_USER          - the sending Gmail address, e.g. hr@yourco.com / you@gmail.com
//   GMAIL_APP_PASSWORD  - a 16-char Google "App Password" (NOT the account password).
//                         Create at: Google Account -> Security -> 2-Step Verification -> App passwords
//   GMAIL_FROM_NAME     - (optional) display name on the From header, e.g. "EZER HR Team"
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { renderOfferLetterPng, pngToPdf } from '@/lib/offer-letter-image'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime, not Edge

export async function POST(req: NextRequest) {
  try {
    const { to, cc, subject, body, offer } = await req.json()

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

    // Render the professional offer-letter image and attach it (inline + downloadable).
    // If anything goes wrong, we still send the text email rather than fail the whole send.
    // Attach the offer letter as a PDF only (no inline/PNG attachment).
    const attachments: any[] = []
    if (offer) {
      try {
        const png = await renderOfferLetterPng({ ...offer, from_name: process.env.GMAIL_FROM_NAME })
        const pdf = await pngToPdf(png)
        attachments.push({ filename: 'Offer_Letter.pdf', content: pdf, contentType: 'application/pdf' })
      } catch (e) {
        console.error('offer letter PDF build failed — sending without attachment:', e)
      }
    }

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
