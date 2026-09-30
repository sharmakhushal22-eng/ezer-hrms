// app/api/recruitment/offer-approval/documents/route.ts
//
//   GET ?request_id=<id>              -> { docs: [{ key, name, note?, url? }] }  what the HR Head can download
//   GET ?request_id=<id>&doc=<key>    -> the PDF itself (mrf | interview | ctc), as an attachment
//
// The approval pack (MRF, interview summary, CTC break-up acknowledgement) is built when the
// recruiter submits and goes out by mail only — nothing is stored. The review screen rebuilds the
// same PDFs here, from the same builders, so the HR Head can download them without the mail.
// MRF supporting documents (org chart, budget approval…) are real files in storage: those come back
// as short-lived signed URLs.
//
// Confidential (previous CTC, salary break-up), so the caller must hold Recruitment access.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { mrfPdf, interviewSummaryPdf, ctcAcknowledgementPdf } from '@/lib/recruitment/approval-pack'

export const runtime = 'nodejs'

const KIND_LABEL: Record<string, string> = { ORG_CHART: 'Org chart', BUDGET_DOC: 'Budget approval', OTHER: 'MRF document' }

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const requestId = req.nextUrl.searchParams.get('request_id') || ''
  const doc = req.nextUrl.searchParams.get('doc') || ''
  if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })

  const { data: r } = await sb.from('offer_approval_requests').select('id, mrf_id, candidate_id, ctc_negotiation_id').eq('id', requestId).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Offer approval request not found' }, { status: 404 })

  // ── one PDF ──
  if (doc) {
    let built: { name: string; content: Buffer } | null = null
    try {
      if (doc === 'mrf' && r.mrf_id) built = await mrfPdf(sb as any, r.mrf_id)
      else if (doc === 'interview' && r.mrf_id) built = await interviewSummaryPdf(sb as any, r.mrf_id, r.candidate_id)
      else if (doc === 'ctc') {
        // Same password as the mail: the candidate's registered mobile number.
        const { data: c } = await sb.from('candidates').select('mobile, phone').eq('id', r.candidate_id).maybeSingle()
        const pw = String(c?.mobile || c?.phone || '').replace(/\D/g, '') || 'ezerhr'
        built = await ctcAcknowledgementPdf(sb as any, r.ctc_negotiation_id || null, r.candidate_id, pw)
      }
    } catch (e: any) {
      return NextResponse.json({ error: `Could not build the document: ${e?.message || 'failed'}` }, { status: 500 })
    }
    if (!built) return NextResponse.json({ error: 'This document is not available for this offer.' }, { status: 404 })
    return new NextResponse(new Uint8Array(built.content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${built.name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── the list ──
  const docs: { key: string; name: string; note?: string; url?: string }[] = []
  let attachments: any[] = []
  if (r.mrf_id) {
    const { data: m } = await sb.from('manpower_requisitions').select('mrf_number, attachments').eq('id', r.mrf_id).maybeSingle()
    const no = m?.mrf_number ? ` ${m.mrf_number}` : ''
    docs.push({ key: 'mrf', name: `MRF${no}`, note: 'Manpower requisition as raised' })
    docs.push({ key: 'interview', name: 'Interview summary', note: `Every candidate interviewed on this MRF` })
    attachments = Array.isArray(m?.attachments) ? m!.attachments : (typeof m?.attachments === 'string' ? JSON.parse(m!.attachments) : [])
  }
  docs.push({ key: 'ctc', name: 'CTC break-up acknowledgement', note: "Password: the candidate's registered mobile number" })
  for (const a of attachments) {
    if (!a?.path) continue
    const { data: signed } = await sb.storage.from('onboarding-docs').createSignedUrl(a.path, 60 * 10, { download: a.name || true })
    if (signed?.signedUrl) docs.push({ key: `file:${a.path}`, name: a.name || 'Document', note: KIND_LABEL[a.kind] || 'MRF document', url: signed.signedUrl })
  }
  return NextResponse.json({ docs })
}
