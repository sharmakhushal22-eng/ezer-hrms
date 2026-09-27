// app/api/collect-docs/route.ts — public, token-gated + email-OTP.
//   GET  ?token=…            -> link state; documents only once the caller holds a
//                               valid access token (x-collect-access header)
//   POST { token, action:'submit'|'remove' } -> require the access token
//
// The token identifies the link; the access token (issued by /api/collect-docs/otp
// after email-OTP verification) proves the caller owns the registered email.

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { COLLECT_DOCS, submittedEmail } from '@/lib/recruitment/collect-docs'
import { verifyAccess } from '@/lib/recruitment/collect-auth'

// Best-effort internal email (Gmail SMTP). Never blocks the candidate's flow.
async function mail(to: string[], cc: string[], subject: string, body: string) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  const toList = Array.from(new Set(to.filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))))
  const ccList = Array.from(new Set(cc.filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !toList.includes(e))))
  if (!user || !pass || !toList.length) return
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    await t.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || 'EZER HRMS'}" <${user}>`,
      to: toList.join(','), cc: ccList.length ? ccList.join(',') : undefined,
      subject, text: body, html: body.replace(/\n/g, '<br>'),
    })
  } catch { /* best effort */ }
}

async function linkFor(token: string) {
  const { data } = await sb.from('document_collection_links').select('*').eq('link_token', token).maybeSingle()
  return data
}
const isExpired = (l: any) => l.status === 'EXPIRED' || (l.expires_at && new Date(l.expires_at).getTime() < Date.now())
const accessOf = (req: NextRequest, bodyAccess?: string) => req.headers.get('x-collect-access') || bodyAccess || ''

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  const link = await linkFor(token)
  if (!link) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  const expired = isExpired(link)
  const submitted = link.status === 'SUBMITTED'
  const authed = !!verifyAccess(accessOf(req), token)

  const [{ data: cand }, { data: mrf }, { data: comp }] = await Promise.all([
    sb.from('candidates').select('full_name, designation').eq('id', link.candidate_id).maybeSingle(),
    link.mrf_id ? sb.from('manpower_requisitions').select('designation, position').eq('id', link.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
    link.company_id ? sb.from('companies').select('company_name').eq('id', link.company_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])

  // Not yet verified: return only enough to render the OTP login screen — no docs,
  // no candidate name (identity is confirmed only after OTP).
  if (!authed) {
    return NextResponse.json({
      gate: 'otp', authed: false,
      valid: !expired && !submitted, expired, submitted,
      expires_at: link.expires_at,
      company_name: (comp as any)?.company_name || '',
      has_email: !!link.candidate_email,
    })
  }

  const { data: docs } = await sb.from('candidate_documents_uploaded')
    .select('id, doc_type, doc_label, file_name, file_size, uploaded_at').eq('link_id', link.id).order('uploaded_at', { ascending: true })
  if (!link.opened_at && !expired) await sb.from('document_collection_links').update({ opened_at: new Date().toISOString() }).eq('id', link.id)

  return NextResponse.json({
    gate: 'ok', authed: true,
    valid: !expired && !submitted,
    expired, submitted,
    expires_at: link.expires_at,
    candidate_name: cand?.full_name || 'Candidate',
    job_title: (mrf as any)?.designation || (mrf as any)?.position || cand?.designation || '',
    company_name: (comp as any)?.company_name || '',
    uploaded: (docs || []).map((d: any) => d.doc_type),
    docs: docs || [],
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const token = body?.token || ''
  const link = await linkFor(token)
  if (!link) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (isExpired(link)) return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
  if (!verifyAccess(accessOf(req, body?.access), token))
    return NextResponse.json({ error: 'Please verify your email to continue.' }, { status: 401 })

  if (body?.action === 'remove') {
    if (link.status === 'SUBMITTED') return NextResponse.json({ error: 'This submission is already complete.' }, { status: 409 })
    const docId = body?.doc_id
    if (!docId) return NextResponse.json({ error: 'doc_id is required' }, { status: 400 })
    const { data: doc } = await sb.from('candidate_documents_uploaded').select('id, file_url').eq('id', docId).eq('link_id', link.id).maybeSingle()
    if (!doc) return NextResponse.json({ error: 'File not found.' }, { status: 404 })
    if (doc.file_url) await sb.storage.from('onboarding-docs').remove([doc.file_url])
    await sb.from('candidate_documents_uploaded').delete().eq('id', doc.id)
    return NextResponse.json({ ok: true, removed: doc.id })
  }

  if (body?.action === 'submit') {
    // every mandatory document must be present
    const { data: docs } = await sb.from('candidate_documents_uploaded').select('doc_type').eq('link_id', link.id)
    const have = new Set((docs || []).map((d: any) => d.doc_type))
    const missing = COLLECT_DOCS.filter(d => d.mandatory && !have.has(d.type)).map(d => d.label)
    if (missing.length) return NextResponse.json({ error: `Please upload: ${missing.join(', ')}` }, { status: 400 })

    const resubmission = !!link.submitted_at
    await sb.from('document_collection_links').update({ status: 'SUBMITTED', submitted_at: new Date().toISOString() }).eq('id', link.id)
    // clearing pre-negotiation checks moves the candidate on to CTC Negotiation
    await sb.from('candidates').update({ pre_negotiation_done: true }).eq('id', link.candidate_id)

    // Heads-up to the recruiter who sent the link + everyone CC'd on it — also fires on a
    // re-submission after a resend, since submit runs the same path each time.
    const [{ data: cand }, { data: mrf }, { data: comp }] = await Promise.all([
      sb.from('candidates').select('full_name').eq('id', link.candidate_id).maybeSingle(),
      link.mrf_id ? sb.from('manpower_requisitions').select('designation, position').eq('id', link.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
      link.company_id ? sb.from('companies').select('company_name').eq('id', link.company_id).maybeSingle() : Promise.resolve({ data: null } as any),
    ])
    const { subject, body: mailBody } = submittedEmail({
      candidateName: cand?.full_name || 'Candidate',
      jobTitle: (mrf as any)?.designation || (mrf as any)?.position || '',
      companyName: (comp as any)?.company_name || '',
      uploaded: (docs || []).length, resubmission,
    })
    await mail([link.created_by].filter(Boolean) as string[], Array.isArray(link.cc_emails) ? link.cc_emails : [], subject, mailBody)

    return NextResponse.json({ ok: true, submitted: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
