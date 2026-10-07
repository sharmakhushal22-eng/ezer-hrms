// app/api/recruitment/offer-file/route.ts — the HR Manager's offer file on Send Offers.
//
//   GET  ?request_id=…                      -> the file: every detail, document, interview, the salary
//                                              break-up, and which of them have been verified
//   GET  ?request_id=…&letter=1[&mark=1]    -> the offer letter PDF (only once EVERYTHING is verified);
//                                              mark=1 records that the letter was generated
//   POST { action:'verify', request_id, key, checked }  -> tick / untick one item
//   POST { action:'edit',   request_id, key, value }    -> change one editable detail (clears its tick
//                                                          and the generated-letter mark)
//
// See lib/recruitment/offer-dossier.ts for what is in the file and where edits are written, and
// lib/recruitment/offer-letter-pdf.ts for the letter.

import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { loadDossier, setVerified, applyEdit, markLetterGenerated, type Dossier } from '@/lib/recruitment/offer-dossier'
import { offerLetterPdf } from '@/lib/recruitment/offer-letter-pdf'

export const runtime = 'nodejs' // pdfkit + pdf-lib

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
// Only while the offer is with the HR Head or approved — never once it has gone out.
const OPEN = ['SUBMITTED', 'HR_HEAD_APPROVED']

async function actorName(user: { employeeId: string | null; email: string | null }) {
  if (user.employeeId) {
    const { data } = await sb.from('employees').select('full_name, emp_code').eq('id', user.employeeId).maybeSingle()
    if (data?.full_name) return `${data.full_name}${data.emp_code ? ` (${data.emp_code})` : ''}`
  }
  return user.email || 'HR'
}

function view(d: Dossier) {
  return {
    request: { id: d.request.id, status: d.request.status, company_id: d.request.company_id, hr_head_actioned_at: d.request.hr_head_actioned_at },
    candidate: { id: d.candidate.id, full_name: d.candidate.full_name, email: d.candidate.email },
    company: d.company ? { id: d.company.id, company_name: d.company.company_name, company_code: d.company.company_code } : null,
    rows: d.rows, documents: d.documents, interviews: d.interviews, salary: d.salary,
    verification: d.verification, required: d.required, verifiedCount: d.verifiedCount, complete: d.complete,
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const wantsLetter = sp.get('letter') === '1', mark = sp.get('mark') === '1'
  const gate = await requireModule(req, 'Recruitment', mark ? 'EDIT' : 'VIEW')
  if (gate.error) return gate.error
  const requestId = sp.get('request_id') || ''
  if (!requestId) return bad('request_id is required')
  const d = await loadDossier(requestId)
  if (!d) return bad('Offer request not found', 404)
  if (!wantsLetter) return NextResponse.json(view(d))

  if (!d.complete) return bad(`Verify every detail first — ${d.verifiedCount} of ${d.required.length} done.`, 409)
  if (mark && !OPEN.includes(d.request.status)) return bad('This offer has already gone out — the letter cannot be regenerated.', 409)
  let pdf
  try { pdf = await offerLetterPdf(d) } catch (e: any) { return bad(`Could not build the offer letter: ${e?.message || 'failed'}`, 500) }
  if (mark) {
    // Building takes a moment; only record it if the file is exactly what the PDF was built from.
    const now = await loadDossier(requestId)
    if (!now?.complete || now.fileHash !== d.fileHash) return bad('Something in the offer file changed while the letter was being generated — generate it again.', 409)
    const by = await actorName(gate.user)
    await markLetterGenerated(now, by)
    await sb.from('recruitment_audit_logs').insert({ candidate_id: d.candidate.id, company_id: d.request.company_id || null, action_type: 'OFFER_LETTER_GENERATED', details: { request_id: d.request.id, by }, created_at: new Date().toISOString() })
  }
  return new NextResponse(new Uint8Array(pdf.content), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${sp.get('download') === '1' ? 'attachment' : 'inline'}; filename="${pdf.name}"`, 'Cache-Control': 'no-store' },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error
  const body = await req.json().catch(() => null) as any
  if (!body?.request_id || !body?.key) return bad('request_id and key are required')
  const d = await loadDossier(String(body.request_id))
  if (!d) return bad('Offer request not found', 404)
  if (!OPEN.includes(d.request.status)) return bad('This offer has already gone out — its file can no longer be changed.', 409)
  const by = await actorName(gate.user)

  try {
    if (body.action === 'verify') {
      await setVerified(d, String(body.key), !!body.checked, by)
    } else if (body.action === 'edit') {
      const { from, to } = await applyEdit(d, String(body.key), body.value)
      await sb.from('recruitment_audit_logs').insert({ candidate_id: d.candidate.id, company_id: d.request.company_id || null, action_type: 'OFFER_FILE_EDITED', details: { request_id: d.request.id, field: body.key, from: from ?? null, to: to ?? null, by }, created_at: new Date().toISOString() })
    } else return bad('Unknown action')
  } catch (e: any) {
    return bad(e?.message || 'Failed')
  }
  const fresh = await loadDossier(d.request.id)
  return NextResponse.json(view(fresh!))
}
