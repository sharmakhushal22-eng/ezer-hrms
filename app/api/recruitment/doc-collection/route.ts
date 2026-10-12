// app/api/recruitment/doc-collection/route.ts
//
//   GET  ?candidate_id=…          -> { link, docs }  (status for the recruiter)
//   POST { action:'send', … }     -> create or refresh a 24h link, email it (candidate + CC)
//
// The recruiter's half of the CTC-negotiation document collection. The candidate
// half is the public /collect-docs/[token] page + /api/collect-docs/*.

import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { LINK_TTL_HOURS, COLLECT_DOCS } from '@/lib/recruitment/collect-docs'
import { renderEmail } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const candidateId = req.nextUrl.searchParams.get('candidate_id')
  if (!candidateId) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })
  const { data: link } = await sb.from('document_collection_links')
    .select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  let docs: any[] = []
  if (link) {
    const { data } = await sb.from('candidate_documents_uploaded').select('*').eq('link_id', link.id).order('uploaded_at', { ascending: true })
    docs = data || []
  }
  return NextResponse.json({ link: link || null, docs })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // Reject one uploaded document: remove it, and reopen the link (fresh 24h) so the
  // candidate re-uploads ONLY that document. HR then resends the link.
  if (body.action === 'reject') {
    const docId = body.doc_id
    if (!docId) return NextResponse.json({ error: 'doc_id is required' }, { status: 400 })
    const { data: doc } = await sb.from('candidate_documents_uploaded').select('id, link_id, candidate_id, file_url, doc_type, doc_label').eq('id', docId).maybeSingle()
    if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    if (doc.file_url) await sb.storage.from('onboarding-docs').remove([doc.file_url])
    await sb.from('candidate_documents_uploaded').delete().eq('id', doc.id)
    // reopen the link for a fresh re-upload of just this doc
    const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3600_000).toISOString()
    await sb.from('document_collection_links').update({ status: 'ACTIVE', expires_at: expiresAt, submitted_at: null }).eq('id', doc.link_id)
    await sb.from('candidates').update({ pre_negotiation_done: false }).eq('id', doc.candidate_id)
    return NextResponse.json({ ok: true, rejected: doc.id, doc_label: doc.doc_label || doc.doc_type })
  }

  if (body.action !== 'send') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const { candidate_id, mrf_id, company_id, email, cc, created_by } = body
  if (!candidate_id) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })
  const to = String(email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return NextResponse.json({ error: 'A valid candidate email is required' }, { status: 400 })
  const ccList: string[] = Array.isArray(cc) ? cc.map((x: string) => String(x).trim()).filter(Boolean) : []

  // candidate + job + company for the email
  const [{ data: cand }, { data: mrf }, { data: comp }] = await Promise.all([
    sb.from('candidates').select('full_name, designation').eq('id', candidate_id).maybeSingle(),
    mrf_id ? sb.from('manpower_requisitions').select('designation, position, company_id').eq('id', mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
    company_id ? sb.from('companies').select('company_name').eq('id', company_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const jobTitle = (mrf as any)?.designation || (mrf as any)?.position || cand?.designation || 'the role'
  const companyName = (comp as any)?.company_name || 'our company'

  const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3600_000).toISOString()

  // Reuse the candidate's existing link row (keeps status/token stable); else create one.
  const { data: existing } = await sb.from('document_collection_links')
    .select('id, link_token').eq('candidate_id', candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle()

  let token = existing?.link_token as string | undefined
  if (existing) {
    const { error } = await sb.from('document_collection_links').update({
      mrf_id: mrf_id || null, company_id: company_id || null, candidate_email: to, cc_emails: ccList,
      status: 'ACTIVE', expires_at: expiresAt, sent_at: new Date().toISOString(), created_by: created_by || null,
    }).eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { data: created, error } = await sb.from('document_collection_links').insert({
      candidate_id, mrf_id: mrf_id || null, company_id: company_id || null, candidate_email: to, cc_emails: ccList,
      status: 'ACTIVE', expires_at: expiresAt, created_by: created_by || null,
    }).select('link_token').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    token = created.link_token
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
  const link = `${baseUrl}/collect-docs/${token}`

  // If some documents are already uploaded on this link (i.e. HR rejected one and is
  // resending), send the re-upload template listing ONLY what is still missing.
  // The words come from Configuration (Document collection — invite / re-upload request)
  // for this company.
  const linkId = existing?.id
  const { data: haveDocs } = linkId
    ? await sb.from('candidate_documents_uploaded').select('doc_type').eq('link_id', linkId)
    : { data: [] as any[] }
  const uploadedCount = (haveDocs || []).length
  const haveSet = new Set((haveDocs || []).map((d: any) => d.doc_type))
  const missingMandatory = COLLECT_DOCS.filter(d => d.mandatory && !haveSet.has(d.type)).map(d => d.label)
  const reupload = uploadedCount > 0 && missingMandatory.length > 0
  const mail = await renderEmail(reupload ? 'doc_collection.reupload' : 'doc_collection.invite', company_id || (mrf as any)?.company_id || null, {
    candidate_name: cand?.full_name || 'Candidate',
    job_title: jobTitle,
    company_name: companyName,
    upload_link: link,
    link_validity_hours: String(LINK_TTL_HOURS),
    sender_name: created_by || 'The Hiring Team',
    missing_documents: missingMandatory.map(m => `• ${m}`).join('\n'),
  })

  // Email — best effort (Gmail SMTP).
  let emailed = false, emailSkipped: string | null = null
  const sent = await sendMail({ to, cc: ccList, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'HR Team' })
  if (sent.sent) emailed = true
  else emailSkipped = sent.skipped || sent.error || 'email failed'

  return NextResponse.json({ ok: true, token, link, expires_at: expiresAt, emailed, emailSkipped, cc: ccList })
}
