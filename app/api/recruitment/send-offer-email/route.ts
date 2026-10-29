// app/api/recruitment/send-offer-email/route.ts
// Sends the offer-letter email to the candidate via Gmail (SMTP + App Password), with the
// generated offer letter PDF (POST { to, cc, subject, body, request_id }).
//
//   GET ?request_id=…  -> { kind, subject, body, template }  the offer email TEMPLATE for this
//                         offer's engagement (Employment / Internship / NATS / NAPS / Contract /
//                         Consultant), resolved from Configuration for the offer's branch →
//                         company → Global. The Send Offers screen fills it in the browser
//                         (lib/config/offer-mail.ts) so it can refresh on every offer-file edit.
//
// Mail goes through lib/mail/send.ts (GMAIL_USER, GMAIL_APP_PASSWORD, optional
// GMAIL_FROM_NAME — set in .env.local locally and in Vercel for production).
import { NextRequest, NextResponse } from 'next/server'
import { positionMessage } from '@/lib/recruitment/position-required'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import { positionOf, loadDossier } from '@/lib/recruitment/offer-dossier'
import { offerLetterPdf } from '@/lib/recruitment/offer-letter-pdf'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { resolveTemplate, isUuid } from '@/lib/config/store'
import { offerKindOf, OFFER_EMAIL_KEY } from '@/lib/config/offer-mail'
import { stripMarkup, toEmailHtml } from '@/lib/config/render'
import { sendMail, mailConfigured } from '@/lib/mail/send'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime, not Edge

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const id = req.nextUrl.searchParams.get('request_id')
  if (!isUuid(id)) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
  const { data: r, error } = await sb.from('offer_approval_requests')
    .select('company_id, candidates(application_details), manpower_requisitions(employment_type, location_id)')
    .eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!r) return NextResponse.json({ error: 'Offer request not found' }, { status: 404 })
  const row = r as any
  const kind = offerKindOf(row)
  const t = await resolveTemplate(OFFER_EMAIL_KEY[kind], { companyId: row.company_id, locationId: row.manpower_requisitions?.location_id })
  return NextResponse.json({ kind, subject: t!.subject, body: t!.body, template: { key: t!.key, source: t!.source, version: t!.version } })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  try {
    const { to, cc, subject, body, request_id } = await req.json()

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Missing recipient, subject, or body' }, { status: 400 })
    }

    if (!mailConfigured()) {
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
    const pos = positionOf(d.rows)
    const posMsg = positionMessage(pos, 'in the offer letter. Fill them in the offer file before sending')
    if (posMsg) return NextResponse.json({ error: posMsg }, { status: 409 })
    const pdf = await offerLetterPdf(d)
    const attachments = [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }]

    const sent = await sendMail({
      to, cc: ccList, subject,
      text: stripMarkup(String(body)),
      // HTML part: escaped, line breaks kept (the offer letter goes as the PDF attachment).
      html: toEmailHtml(String(body)),
      attachments, fromName: 'HR Team',
    })
    if (!sent.sent) return NextResponse.json({ error: sent.error || sent.skipped || 'Failed to send email' }, { status: 502 })

    return NextResponse.json({ ok: true, messageId: sent.messageId, position: pos })
  } catch (err: any) {
    console.error('send-offer-email failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send email' }, { status: 502 })
  }
}
