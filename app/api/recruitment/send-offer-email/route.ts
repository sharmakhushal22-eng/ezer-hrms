// app/api/recruitment/send-offer-email/route.ts
// Sends the offer-letter email to the candidate via Gmail (SMTP + App Password).
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
import { createClient } from '@supabase/supabase-js'
import { renderOfferLetterPng, pngToPdf } from '@/lib/offer-letter-image'
// Prints the configured template onto the company's uploaded letterhead PDF.
// Falls back to renderOfferLetterPng above when nothing is configured yet.
import { buildOfferLetterPdf, OfferTemplateTokenError } from '@/lib/recruitment/offer-letter-pdf'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime, not Edge

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  try {
    const { to, cc, subject, body, offer, offer_request_id } = await req.json()

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

    // ── The attachment ────────────────────────────────────────────────────
    // Preferred: the admin-configured template printed onto the company's own
    // uploaded letterhead PDF (Admin Setup › Offer Letter). Fallback: the drawn
    // letter this route has always produced, used when no template or no
    // letterhead has been configured yet.
    //
    // A template with an unfillable {{token}} is NOT a fallback case — it stops
    // the send with a 400, because the alternative is emailing a candidate a
    // letter with "{{offer_ctc_annual}}" printed on it. Nothing is marked sent
    // on a non-2xx, so the HR Manager can fix the template and retry.
    const attachments: any[] = []
    let letterheadUsed: string | null = null

    if (offer_request_id) {
      try {
        const supa = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
        )
        const built = await buildOfferLetterPdf(supa, offer_request_id)
        if (built) {
          attachments.push({ filename: 'Offer_Letter.pdf', content: built.pdf, contentType: 'application/pdf' })
          letterheadUsed = built.letterheadFile
        }
      } catch (e) {
        if (e instanceof OfferTemplateTokenError) {
          return NextResponse.json({ error: e.message, unknown_tokens: e.tokens }, { status: 400 })
        }
        // Any other failure (storage hiccup, malformed stationery) falls through
        // to the drawn letter rather than blocking an approved offer.
        console.error('letterhead merge failed — falling back to the drawn letter:', e)
      }
    }

    if (!attachments.length && offer) {
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

    return NextResponse.json({ ok: true, messageId: info.messageId, letterhead: letterheadUsed })
  } catch (err: any) {
    console.error('send-offer-email failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send email' }, { status: 502 })
  }
}
