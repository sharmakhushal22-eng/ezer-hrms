// app/api/salary-view/respond/route.ts — Accept / Decline the offer (needs the OTP access token).
//   POST { token, response:'ACCEPTED'|'REJECTED', note? }  (header x-salary-access)

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { negotiationByToken, verifiedCaller, accessExpiryMs, OFFER_VALID_DAYS } from '../_shared'

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
  return NextResponse.json({ ok: true, response })
}
