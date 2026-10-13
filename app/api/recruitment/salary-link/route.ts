// app/api/recruitment/salary-link/route.ts
//
//   POST { candidate_id, email?, cc? }  -> emails the candidate their salary
//                                          break-up link; returns { ok, link, emailed }
//
// The recruiter's half of the salary negotiation. The candidate half is the
// public /salary-view/[token] page + /api/salary-view/*.
//
// Mirrors app/api/recruitment/doc-collection/route.ts deliberately: same guard,
// same service client, same best-effort Gmail send, same { emailed, emailSkipped }
// contract — these are the two candidate-facing mails in the same flow and they
// should fail, and be diagnosed, identically.
//
// TWO THINGS THIS DOES NOT DO, ON PURPOSE
//
// 1. It does not write link_sent_at. That column starts the candidate's response
//    clock (app/salary-view/[token]/client.tsx, api/salary-view/_shared.ts,
//    api/salary-view/respond). It is stamped when the negotiation is SAVED, so a
//    revised offer restarts the window; stamping it again on every re-send would
//    quietly extend the deadline each time a recruiter resent the same offer.
//
// 2. It does not accept a token from the caller. It looks up the candidate's
//    latest negotiation server-side, so the link that goes out is always the one
//    belonging to the candidate id the caller was authorised for — a token in
//    the request body would let any authenticated user mail any link.

import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { breakupEmail } from '@/lib/recruitment/salary-link'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const candidateId = String(body.candidate_id || '').trim()
  if (!candidateId) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })

  // The candidate record is the source of truth for the address; the client may
  // override it (a personal address given during the call, say) but must send a
  // real one either way.
  const { data: cand } = await sb.from('candidates')
    .select('full_name, email, designation, mrf_id, company_id')
    .eq('id', candidateId).maybeSingle()
  if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

  const to = String(body.email || cand.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return NextResponse.json({ error: 'This candidate has no valid email address on record. Add one before sending.' }, { status: 400 })
  }
  const ccList: string[] = Array.isArray(body.cc) ? body.cc.map((x: string) => String(x).trim()).filter(Boolean) : []

  // The link the negotiation screen already minted. No negotiation saved yet
  // means there is nothing to show the candidate.
  const { data: neg } = await sb.from('ctc_negotiations')
    .select('link_token, candidate_response')
    .eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!neg?.link_token) {
    return NextResponse.json({ error: 'Save the negotiation first — there is no salary link to send yet.' }, { status: 400 })
  }

  // Job title and company for the message body.
  const [{ data: mrf }, { data: comp }] = await Promise.all([
    cand.mrf_id ? sb.from('manpower_requisitions').select('designation, position').eq('id', cand.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
    cand.company_id ? sb.from('companies').select('company_name').eq('id', cand.company_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const jobTitle = (mrf as any)?.designation || (mrf as any)?.position || cand.designation || 'the role'
  const companyName = (comp as any)?.company_name || ''

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
  const link = `${baseUrl}/salary-view/${neg.link_token}`
  const { subject, body: mailBody } = breakupEmail({
    candidateName: cand.full_name || 'Candidate', jobTitle, companyName, link,
    senderName: typeof body.created_by === 'string' ? body.created_by : undefined,
  })

  // Email — best effort (Gmail SMTP), exactly as doc-collection does. A missing
  // credential is reported, never swallowed: the caller shows the reason rather
  // than claiming a send that did not happen.
  let emailed = false, emailSkipped: string | null = null
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) {
    try {
      const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
      await t.sendMail({
        from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
        to, cc: ccList.length ? ccList.join(',') : undefined, subject,
        text: mailBody, html: mailBody.replace(/\n/g, '<br>'),
      })
      emailed = true
    } catch (e: any) { emailSkipped = e?.message || 'email failed' }
  } else {
    emailSkipped = 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD).'
  }

  return NextResponse.json({
    ok: true, link, to, cc: ccList, emailed, emailSkipped,
    already_responded: neg.candidate_response || null,
  })
}
