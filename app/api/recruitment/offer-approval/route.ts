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
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify } from '@/lib/ess/session'
import { mrfPdf, interviewSummaryPdf, ctcAcknowledgementPdf } from '@/lib/recruitment/approval-pack'

export const runtime = 'nodejs'

type Person = { id: string; name: string; code: string | null; role: string; email: string | null }

/** Active holders of the given ESS roles inside one company. */
async function roleHolders(companyId: string | null, roleCodes: string[]): Promise<Person[]> {
  if (!companyId) return []
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', roleCodes)
  const roleIds = (roles || []).map((r: any) => r.id)
  if (!roleIds.length) return []
  const codeOf: Record<string, string> = {}
  ;(roles || []).forEach((r: any) => { codeOf[r.id] = r.role_code })
  const { data: urs } = await sb.from('ess_user_roles')
    .select('role_id, ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id, office_email, personal_email))')
    .in('role_id', roleIds).eq('is_active', true)
  const seen = new Set<string>(); const out: Person[] = []
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (e && e.company_id === companyId && !seen.has(e.id)) { seen.add(e.id); out.push({ id: e.id, name: e.full_name, code: e.emp_code, role: codeOf[u.role_id], email: e.office_email || e.personal_email || null }) }
  }
  return out
}

const lakh = (n: any) => `₹${(Number(n || 0) / 100000).toFixed(2)}L`
const inr = (n: any) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`

/**
 * The HR Head's approval mail. Only lines that HAVE a value are written — a blank buyout,
 * hike or remark simply does not appear.
 */
function approvalMail(r: any, who: string, role: string, mrfNo: string | null, raisedBy: string | null, appUrl: string, attachments: string[] = []) {
  const ctc = Number(r.offered_ctc || 0)
  const varPct = Number(r.offered_variable_pct || 0)
  const varAmt = ctc > 0 && varPct > 0 ? Math.round(ctc * varPct / 100) : 0
  const lines: string[] = []
  const add = (label: string, value: any) => { const v = value == null ? '' : String(value).trim(); if (v) lines.push(`${label.padEnd(22)} ${v}`) }
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
  const subject = `Offer approval required — ${who}${role ? ` (${role})` : ''}${ctc > 0 ? ` · ${lakh(ctc)}` : ''}`
  const attachNote = attachments.length
    ? `\n\nAttached: ${attachments.join('; ')}.\nThe CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.`
    : ''
  const text = `Dear HR Head,\n\nAn offer is waiting for your review and approval.\n\n${lines.join('\n')}${attachNote}\n\nReview and approve: ${appUrl}/ess-portal?module=recruitment&tab=hrhead\n\n— EZER HRMS`
  const html = `<p>Dear HR Head,</p><p>An offer is waiting for your review and approval.</p><table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px">${lines.map(l => { const i = l.indexOf('  '); const k = l.slice(0, i).trim(); const v = l.slice(i).trim(); return `<tr><td style="padding:4px 14px 4px 0;color:#6B7280">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>` }).join('')}</table>${attachments.length ? `<p style="font-size:12px;color:#374151"><b>Attached:</b> ${attachments.join('; ')}.<br/>The CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.</p>` : ''}<p><a href="${appUrl}/ess-portal?module=recruitment&tab=hrhead" style="display:inline-block;padding:9px 16px;border-radius:7px;background:#2563EB;color:#fff;text-decoration:none;font-weight:600">Review &amp; approve</a></p><p style="color:#6B7280;font-size:12px">— EZER HRMS</p>`
  return { subject, text, html }
}

// GET ?company_ids=a,b  -> { heads: { [company_id]: [{ id, name, code }] } }  (who approves, per company)
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const heads: Record<string, { id: string; name: string; code: string | null }[]> = {}
  await Promise.all(ids.map(async id => { heads[id] = (await roleHolders(id, ['HR_HEAD'])).map(({ id, name, code }) => ({ id, name, code })) }))
  return NextResponse.json({ heads })
}

export async function POST(req: NextRequest) {
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
  const ref = (mrf as any)?.mrf_number ? ` · ${(mrf as any).mrf_number}` : ''

  // ── Recruiter → HR Head: "review and approve" ──
  if (body.action === 'submitted') {
    const heads = await roleHolders(companyId, ['HR_HEAD'])
    if (!heads.length) return NextResponse.json({ ok: true, notified: 0, warning: 'No HR Head is set for this company — nobody was notified.' })
    await Promise.all(heads.map(h => notify(
      h.id,
      `Offer approval — ${who}${role ? ` (${role})` : ''}`,
      `An offer of ${lakh(r.offered_ctc)} for ${who}${role ? `, ${role}` : ''}${ref} is waiting for your review and approval${r.proposed_doj ? ` (proposed DOJ ${new Date(r.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Open Recruitment → HR Head to approve or reject.`,
      '/ess-portal?module=recruitment&tab=hrhead',
      'APPROVAL',
    ).catch(() => null)))

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
    const mail = approvalMail(r, who, role, (mrf as any)?.mrf_number || null, (mrf as any)?.raised_by_name || null, appUrl, attachNames)
    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
    if (user && pass && to.length) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
        await t.sendMail({ from: `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`, to: to.join(','), cc: cc.length ? cc.join(',') : undefined, subject: mail.subject, text: mail.text, html: mail.html, attachments: built })
        emailed = to.length + cc.length
      } catch (e: any) { emailSkipped = e?.message || 'email failed' }
    } else if (!to.length) emailSkipped = 'HR Head has no email on record'
    else emailSkipped = emailSkipped || 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)'
    return NextResponse.json({ ok: true, notified: heads.length, to: heads.map(h => `${h.name} (${h.code})`), cc: (ccEmps || []).map((e: any) => `${e.full_name} (${e.emp_code})`), emailed, emailSkipped,
      attachments: built.map(x => ({ name: x.filename, bytes: x.content.length })),
      ...(process.env.NODE_ENV !== 'production' ? { preview: mail.text, debugAttachments: built.map(x => ({ name: x.filename, base64: x.content.toString('base64') })) } : {}) })
  }

  // ── HR Head → recruiter(s) + HR managers: the decision ──
  if (body.action === 'decided') {
    const approved = r.status === 'HR_HEAD_APPROVED' || r.hr_head_action === 'APPROVED'
    const rejected = r.status === 'HR_HEAD_REJECTED' || r.hr_head_action === 'REJECTED'
    if (!approved && !rejected) return NextResponse.json({ error: 'This request has not been decided yet' }, { status: 409 })
    const recruiterIds: string[] = Array.isArray((mrf as any)?.assigned_recruiter_ids) ? (mrf as any).assigned_recruiter_ids : []
    const managers = approved ? await roleHolders(companyId, ['HR_MANAGER']) : []
    const targets = new Set<string>([...recruiterIds, ...managers.map(m => m.id)])
    if ((mrf as any)?.requested_by && !approved) targets.add((mrf as any).requested_by)   // the raiser hears about a rejection too
    const note = r.hr_head_comments ? ` Comment: “${r.hr_head_comments}”` : ''
    await Promise.all([...targets].map(id => notify(
      id,
      approved ? `Offer approved — ${who}${role ? ` (${role})` : ''}` : `Offer rejected — ${who}${role ? ` (${role})` : ''}`,
      approved
        ? `The HR Head approved the ${lakh(r.offered_ctc)} offer for ${who}${ref}.${note} Send the offer letter from Recruitment → Send Offers.`
        : `The HR Head rejected the ${lakh(r.offered_ctc)} offer for ${who}${ref}.${note} Revise the negotiation and raise a fresh approval request.`,
      approved ? '/ess-portal?module=recruitment&tab=sendoffer' : '/ess-portal?module=recruitment&tab=offerapproval',
      'APPROVAL',
    ).catch(() => null)))
    return NextResponse.json({ ok: true, notified: targets.size, outcome: approved ? 'APPROVED' : 'REJECTED' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
