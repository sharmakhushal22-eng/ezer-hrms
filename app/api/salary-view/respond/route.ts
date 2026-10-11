// app/api/salary-view/respond/route.ts — Accept / Decline the offer (needs the OTP access token).
//   POST { token, response:'ACCEPTED'|'REJECTED', note? }  (header x-salary-access)
//
// On ACCEPTED, the hiring manager(s) and the candidate are mailed the salary break-up PDF —
// see lib/recruitment/offer-accepted-mail.ts. Email is best-effort: the response is recorded
// whatever happens to the mail.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { mailAcceptance } from '@/lib/recruitment/offer-accepted-mail'
import { autoApproveConfidentialOffer } from '@/lib/recruitment/confidential-flow'
import { negotiationByToken, verifiedCaller, accessExpiryMs, OFFER_VALID_DAYS } from '../_shared'

export const runtime = 'nodejs' // nodemailer + pdfkit need Node

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const token = String(body?.token || '')
  const response = body?.response
  if (response !== 'ACCEPTED' && response !== 'REJECTED') return NextResponse.json({ error: 'response must be ACCEPTED or REJECTED' }, { status: 400 })
  const neg = await negotiationByToken(token)
  if (!neg) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (!(await verifiedCaller(req, token, neg))) return NextResponse.json({ error: 'Please verify your email first.' }, { status: 401 })
  if (neg.candidate_response) return NextResponse.json({ error: 'Your response is already recorded.' }, { status: 409 })
  // Acceptance window: 7 days from when the link was sent.
  const sent = new Date(neg.link_sent_at || neg.created_at).getTime()
  if (response === 'ACCEPTED' && Date.now() > sent + OFFER_VALID_DAYS * 86400_000) return NextResponse.json({ error: 'The acceptance window for this offer has closed.' }, { status: 410 })
  void accessExpiryMs
  const { error } = await sb.from('ctc_negotiations')
    .update({ candidate_response: response, response_at: new Date().toISOString(), response_note: String(body?.note || '').trim() || null })
    .eq('id', neg.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let emailed = 0, autoApproved: { requestId: string; notified: number } | null = null
  if (response === 'ACCEPTED') {
    emailed = await mailAcceptance(neg).catch(() => 0)
    // Confidential hiring: the offer request is created already approved, so Send Offers can
    // go ahead; the HR Head and HR Manager(s) are told. Nothing to do for a normal search.
    autoApproved = await autoApproveConfidentialOffer(sb as any, neg).catch(() => null)
  }
  return NextResponse.json({ ok: true, response, emailed, ...(autoApproved ? { confidential: true, request_id: autoApproved.requestId } : {}) })
}
