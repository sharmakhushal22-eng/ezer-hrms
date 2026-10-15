// app/api/recruitment/offer-approval/route.ts
//
//   POST { action:'submitted', request_id }  -> tell the company's HR Head(s) an offer is waiting
//                                                for review (ESS notification + bell, deep link to
//                                                the HR Head tab).
//   POST { action:'decided',   request_id }  -> after the HR Head approves / rejects, tell the
//                                                recruiter(s) on the MRF and the HR managers who
//                                                send the offer.
//
// The offer-approval writes themselves stay in the dashboard (browser-side); this route only
// routes the notifications, which need the service role and the ESS role tables.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { mrfPdf, interviewSummaryPdf, ctcAcknowledgementPdf } from '@/lib/recruitment/approval-pack'
import { renderEmail, mrfScope, type Scope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

import { roleHolders as roleHoldersFor, notifyDecided, lakh } from '@/lib/recruitment/offer-approval-notify'
const roleHolders = (companyId: string | null, roleCodes: string[]) => roleHoldersFor(sb as any, companyId, roleCodes)
const inr = (n: any) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`

/**
 * The HR Head's approval mail (or the HR Manager's heads-up). Only lines that HAVE a value
 * are written — a blank buyout, hike or remark simply does not appear. The words come from
 * Configuration → Recruitment → "Offer approval request — HR Head" / "Offer awaiting HR Head —
 * HR Manager"; the facts table ({{details}}) is drawn here.
 */
async function approvalMail(r: any, who: string, role: string, mrfNo: string | null, raisedBy: string | null, appUrl: string, attachments: string[] = [], audience: 'head' | 'manager' = 'head', headNames: string[] = [], scope: Scope = {}) {
  const reviewUrl = audience === 'head' ? `${appUrl}/offer-approve/${r.id}` : `${appUrl}/ess-portal?module=recruitment&tab=sendoffer`
  const ctc = Number(r.offered_ctc || 0)
  const varPct = Number(r.offered_variable_pct || 0)
  const varAmt = ctc > 0 && varPct > 0 ? Math.round(ctc * varPct / 100) : 0
  const lines: [string, string][] = []
  const add = (label: string, value: any) => { const v = value == null ? '' : String(value).trim(); if (v) lines.push([label, v]) }
  add('Candidate', `${who}${role ? ` — ${role}` : ''}`)
  add('MRF', mrfNo)
  add('Raised by', raisedBy)
  add('Previous company', r.prev_company_name)
  if (Number(r.prev_total_ctc) > 0) add('Previous CTC', `${inr(r.prev_total_ctc)} per annum`)
  if (ctc > 0) add('Offered CTC', `${inr(ctc)} per annum`)
  if (varAmt > 0) add('Variable', `${inr(varAmt)} per annum (${varPct}% of CTC)`)
  if (Number(r.monthly_inhand) > 0) add('Monthly in-hand (est.)', inr(r.monthly_inhand))
  if (Number(r.joining_bonus) > 0) add('Joining bonus', `${inr(r.joining_bonus)}${r.joining_bonus_freq ? ` (${r.joining_bonus_freq})` : ''}`)
  if (Number(r.retention_bonus) > 0) add('Retention bonus', inr(r.retention_bonus))
  if (Number(r.esop_value) > 0) add('ESOP', `${inr(r.esop_value)}${r.esop_vesting ? ` (${r.esop_vesting})` : ''}`)
  if (r.notice_buyout && Number(r.notice_buyout_amount) > 0) add('Notice buyout', inr(r.notice_buyout_amount))
  else if (r.notice_buyout) add('Notice buyout', 'Yes')
  if (r.hike_pct != null && r.hike_pct !== '' && isFinite(Number(r.hike_pct))) add('Hike', `${Number(r.hike_pct).toFixed(1)}% over previous CTC`)
  if (r.proposed_doj) add('Proposed DOJ', new Date(r.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))
  if (Number(r.notice_period_days) > 0) add('Notice period', `${r.notice_period_days} days`)
  add('Hiring manager remark', r.hiring_manager_remark)
  add('Recruiter comments', r.recruiter_comments)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const details = {
    text: lines.map(([k, v]) => `${k.padEnd(22)} ${v}`).join('\n'),
    html: `<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px">${lines.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B7280">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`,
  }
  return renderEmail(audience === 'head' ? 'offer.approval.head' : 'offer.approval.manager', scope, {
    candidate_name: who, role, ctc_lakh: ctc > 0 ? lakh(ctc) : '',
    attachments: attachments.join('; '), review_url: reviewUrl, head_names: headNames.join(', '),
  }, { details })
}

// GET ?company_ids=a,b  -> { heads: { [company_id]: [{ id, name, code }] } }  (who approves, per company)
export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const ids = (req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const heads: Record<string, { id: string; name: string; code: string | null }[]> = {}
  await Promise.all(ids.map(async id => { heads[id] = (await roleHolders(id, ['HR_HEAD'])).map(({ id, name, code }) => ({ id, name, code })) }))
  return NextResponse.json({ heads })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const body = await req.json().catch(() => null) as any
  const requestId = String(body?.request_id || '')
  if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })

  const { data: r } = await sb.from('offer_approval_requests').select('*').eq('id', requestId).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Offer approval request not found' }, { status: 404 })

  const [{ data: cand }, { data: mrf }] = await Promise.all([
    sb.from('candidates').select('full_name, designation, company_id, mrf_id').eq('id', r.candidate_id).maybeSingle(),
    r.mrf_id ? sb.from('manpower_requisitions').select('mrf_number, designation, position, assigned_recruiter_ids, requested_by, company_id').eq('id', r.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const companyId = r.company_id || cand?.company_id || (mrf as any)?.company_id || null
  const who = cand?.full_name || 'a candidate'
  const role = (mrf as any)?.designation || (mrf as any)?.position || cand?.designation || ''

  // ── Recruiter → HR Head: "review and approve" ──
  if (body.action === 'submitted') {
    const heads = await roleHolders(companyId, ['HR_HEAD'])
    if (!heads.length) return NextResponse.json({ ok: true, notified: 0, warning: 'No HR Head is set for this company — nobody was notified.' })
    // The HR Manager(s) of the company are told at the same time: the candidate's card is already
    // on their Send Offers screen, with the Send Offer button locked until the HR Head approves.
    const managers = (await roleHolders(companyId, ['HR_MANAGER'])).filter(m => !heads.some(h => h.id === m.id))
    const headNames = heads.map(h => h.name).filter(Boolean)
    // In-app words: Configuration → Recruitment → Notifications ("Offer yet to be approved —
    // HR Manager", "Offer approval — HR Head"), for the offer's company / branch.
    const scope = await mrfScope(r.mrf_id, companyId)
    const nVars = {
      candidate_name: who, role, ctc_lakh: lakh(r.offered_ctc), mrf_number: (mrf as any)?.mrf_number || '',
      head_names: headNames.join(', '),
      proposed_doj: r.proposed_doj ? new Date(r.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    }
    await Promise.all(managers.map(m => notifyFromTemplate(m.id, 'notify.offer.awaiting_head', nVars, { scope, link: '/ess/recruitment/sendoffer' })))
    await Promise.all(heads.map(h => notifyFromTemplate(h.id, 'notify.offer.approval_head', nVars, { scope, link: `/offer-approve/${r.id}` })))

    // Email — to the HR Head(s), CC the employees picked on the form. Body carries only the
    // lines with a value; attached: the MRF, the interview summary for it, and the CTC break-up
    // acknowledgement (password-protected with the candidate's registered mobile number).
    let emailed = 0, emailSkipped: string | null = null
    const ccIds: string[] = Array.isArray(r.cc_employee_ids) ? r.cc_employee_ids : []
    const { data: ccEmps } = ccIds.length ? await sb.from('employees').select('id, full_name, emp_code, office_email, personal_email').in('id', ccIds) : { data: [] as any[] }
    const cc = (ccEmps || []).map((e: any) => e.office_email || e.personal_email).filter(Boolean) as string[]
    const to = heads.map(h => h.email).filter(Boolean) as string[]
    const { data: candFull } = await sb.from('candidates').select('mobile, phone').eq('id', r.candidate_id).maybeSingle()
    const pdfPassword = String(candFull?.mobile || candFull?.phone || '').replace(/\D/g, '') || 'ezerhr'
    const built: { filename: string; content: Buffer; contentType: string }[] = []
    const attachNames: string[] = []
    try {
      const [a, b, c] = await Promise.all([
        r.mrf_id ? mrfPdf(sb as any, r.mrf_id) : Promise.resolve(null),
        r.mrf_id ? interviewSummaryPdf(sb as any, r.mrf_id, r.candidate_id) : Promise.resolve(null),
        ctcAcknowledgementPdf(sb as any, r.ctc_negotiation_id || null, r.candidate_id, pdfPassword),
      ])
      if (a) { built.push({ filename: a.name, content: a.content, contentType: 'application/pdf' }); attachNames.push(`MRF ${(mrf as any)?.mrf_number || ''}`.trim()) }
      if (b) { built.push({ filename: b.name, content: b.content, contentType: 'application/pdf' }); attachNames.push(`interview summary (${b.interviewed} of ${b.candidates} candidate(s) interviewed)`) }
      if (c) { built.push({ filename: c.name, content: c.content, contentType: 'application/pdf' }); attachNames.push(`CTC break-up acknowledgement${c.accepted ? ' (accepted by the candidate)' : ''}`) }
    } catch (e: any) { emailSkipped = `attachments: ${e?.message || 'failed'}` }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'https://app.ezerhrms.com'
    const mrfNo = (mrf as any)?.mrf_number || null, raisedBy = (mrf as any)?.raised_by_name || null
    const mail = await approvalMail(r, who, role, mrfNo, raisedBy, appUrl, attachNames, 'head', [], scope)
    const m2 = managers.length ? await approvalMail(r, who, role, mrfNo, raisedBy, appUrl, attachNames, 'manager', headNames, scope) : null
    if (to.length) {
      const sent = await sendMail({ to, cc, subject: mail.subject, text: mail.text, html: mail.html, attachments: built, fromName: 'EZER HR Team' })
      if (sent.sent) {
        emailed = to.length + cc.length
        const mgrTo = managers.map(m => m.email).filter(Boolean) as string[]
        if (mgrTo.length && m2) {
          const s2 = await sendMail({ to: mgrTo, subject: m2.subject, text: m2.text, html: m2.html, attachments: built, fromName: 'EZER HR Team' })
          if (s2.sent) emailed += mgrTo.length
          else emailSkipped = s2.error || s2.skipped || 'email failed'
        }
      } else emailSkipped = sent.skipped ? (emailSkipped || 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)') : (sent.error || 'email failed')
    } else emailSkipped = 'HR Head has no email on record'
    return NextResponse.json({ ok: true, notified: heads.length + managers.length, to: heads.map(h => `${h.name} (${h.code})`), managers: managers.map(m => `${m.name} (${m.code})`), cc: (ccEmps || []).map((e: any) => `${e.full_name} (${e.emp_code})`), emailed, emailSkipped,
      attachments: built.map(x => ({ name: x.filename, bytes: x.content.length })),
      template: mail.template,
      ...(process.env.NODE_ENV !== 'production' ? { preview: mail.text, managerPreview: m2 ? m2.text : null, debugAttachments: built.map(x => ({ name: x.filename, base64: x.content.toString('base64') })) } : {}) })
  }

  // ── HR Head → recruiter(s) + HR managers: the decision (shared with the ESS route) ──
  if (body.action === 'decided') {
    const n = await notifyDecided(sb as any, requestId)
    if ('error' in n) return NextResponse.json({ error: n.error }, { status: n.status })
    return NextResponse.json({ ok: true, ...n })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
