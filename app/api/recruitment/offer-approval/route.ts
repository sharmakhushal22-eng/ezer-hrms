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
// Guarded: both verbs answered to anyone until now. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify } from '@/lib/ess/session'
import { mrfPdf, interviewSummaryPdf, ctcAcknowledgementPdf } from '@/lib/recruitment/approval-pack'

export const runtime = 'nodejs'

import { roleHolders as roleHoldersFor, notifyDecided, lakh } from '@/lib/recruitment/offer-approval-notify'
const roleHolders = (companyId: string | null, roleCodes: string[]) => roleHoldersFor(sb as any, companyId, roleCodes)
const inr = (n: any) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`

/**
 * The HR Head's approval mail. Only lines that HAVE a value are written — a blank buyout,
 * hike or remark simply does not appear.
 */
function approvalMail(r: any, who: string, role: string, mrfNo: string | null, raisedBy: string | null, appUrl: string, attachments: string[] = [], audience: 'head' | 'manager' = 'head', headNames: string[] = []) {
  const reviewUrl = audience === 'head' ? `${appUrl}/offer-approve/${r.id}` : `${appUrl}/ess-portal?module=recruitment&tab=sendoffer`
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
  const tail = `${who}${role ? ` (${role})` : ''}${ctc > 0 ? ` · ${lakh(ctc)}` : ''}`
  const subject = audience === 'head' ? `Offer approval required — ${tail}` : `Offer awaiting HR Head approval — ${tail}`
  const attachNote = attachments.length
    ? `\n\nAttached: ${attachments.join('; ')}.\nThe CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.`
    : ''
  // The HR Manager gets the same facts and attachments, but a different ask: nothing to decide,
  // the offer letter simply cannot go out until the HR Head has approved.
  const dear = audience === 'head' ? 'Dear HR Head,' : 'Dear HR Manager,'
  const intro = audience === 'head'
    ? 'An offer is waiting for your review and approval.'
    : `This candidate's offer has been submitted to the HR Head${headNames.length ? ` (${headNames.join(', ')})` : ''} and is yet to be approved. It already appears under Recruitment → Send Offers; the Send Offer button unlocks the moment the HR Head approves it.`
  const cta = audience === 'head' ? 'Review and approve' : 'Open Send Offers'
  const text = `${dear}\n\n${intro}\n\n${lines.join('\n')}${attachNote}\n\n${cta}: ${reviewUrl}\n\n— EZER HRMS`
  const html = `<p>${dear}</p><p>${intro}</p><table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px">${lines.map(l => { const i = l.indexOf('  '); const k = l.slice(0, i).trim(); const v = l.slice(i).trim(); return `<tr><td style="padding:4px 14px 4px 0;color:#6B7280">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>` }).join('')}</table>${attachments.length ? `<p style="font-size:12px;color:#374151"><b>Attached:</b> ${attachments.join('; ')}.<br/>The CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.</p>` : ''}<p><a href="${reviewUrl}" style="display:inline-block;padding:9px 16px;border-radius:7px;background:#2563EB;color:#fff;text-decoration:none;font-weight:600">${audience === 'head' ? 'Review &amp; approve' : 'Open Send Offers'}</a></p><p style="color:#6B7280;font-size:12px">— EZER HRMS</p>`
  return { subject, text, html }
}

// GET ?company_ids=a,b
//   -> { heads:    { [company_id]: [{ id, name, code }] } }  who approves, per company
//      { managers: { [company_id]: [{ id, name, code }] } }  who may be given the offer to issue
//
// `managers` feeds the HR Head's picker: approving an offer names the HR Manager
// who will generate and send the letter, the same way approving an MRF names the
// hiring manager who will run it. Same roleHolders() the decision mail already
// uses for HR_MANAGER below, so the people offered here and the people notified
// there can never drift apart.
export async function GET(req: NextRequest) {
  // Guarded: this enumerates named employees (HR Heads and HR Managers) for any
  // company id in the query string. It answered to anyone until now — the
  // sibling /documents route next door has always required a session, so this
  // was the outlier rather than a deliberate exception. See
  // docs/security/open-endpoints.md.
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const ids = (req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const heads: Record<string, { id: string; name: string; code: string | null }[]> = {}
  const managers: Record<string, { id: string; name: string; code: string | null }[]> = {}
  await Promise.all(ids.map(async id => {
    const [h, m] = await Promise.all([roleHolders(id, ['HR_HEAD']), roleHolders(id, ['HR_MANAGER'])])
    heads[id] = h.map(({ id, name, code }) => ({ id, name, code }))
    managers[id] = m.map(({ id, name, code }) => ({ id, name, code }))
  }))
  return NextResponse.json({ heads, managers })
}

export async function POST(req: NextRequest) {
  // Guarded: this reads a whole offer_approval_requests row from a
  // client-supplied request_id and sends the approval / decision mail off it.
  // EDIT rather than VIEW — it causes mail to real people, even though the row
  // itself is written by the caller's own Supabase session.
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
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
  const ref = (mrf as any)?.mrf_number ? ` · ${(mrf as any).mrf_number}` : ''

  // ── Recruiter → HR Head: "review and approve" ──
  if (body.action === 'submitted') {
    const heads = await roleHolders(companyId, ['HR_HEAD'])
    if (!heads.length) return NextResponse.json({ ok: true, notified: 0, warning: 'No HR Head is set for this company — nobody was notified.' })
    // The HR Manager(s) of the company are told at the same time: the candidate's card is already
    // on their Send Offers screen, with the Send Offer button locked until the HR Head approves.
    const managers = (await roleHolders(companyId, ['HR_MANAGER'])).filter(m => !heads.some(h => h.id === m.id))
    const headNames = heads.map(h => h.name).filter(Boolean)
    await Promise.all(managers.map(m => notify(
      m.id,
      `Offer yet to be approved — ${who}${role ? ` (${role})` : ''}`,
      `${who}'s offer of ${lakh(r.offered_ctc)}${ref} has been submitted to the HR Head${headNames.length ? ` (${headNames.join(', ')})` : ''} and is yet to be approved. The candidate is on your Send Offers screen; the Send Offer button unlocks once the HR Head approves.`,
      '/ess-portal?module=recruitment&tab=sendoffer',
      'APPROVAL',
    ).catch(() => null)))
    await Promise.all(heads.map(h => notify(
      h.id,
      `Offer approval — ${who}${role ? ` (${role})` : ''}`,
      `An offer of ${lakh(r.offered_ctc)} for ${who}${role ? `, ${role}` : ''}${ref} is waiting for your review and approval${r.proposed_doj ? ` (proposed DOJ ${new Date(r.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Open it from Tasks & Approvals to review and approve.`,
      `/offer-approve/${r.id}`,
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
        const mgrTo = managers.map(m => m.email).filter(Boolean) as string[]
        if (mgrTo.length) {
          const m2 = approvalMail(r, who, role, (mrf as any)?.mrf_number || null, (mrf as any)?.raised_by_name || null, appUrl, attachNames, 'manager', headNames)
          await t.sendMail({ from: `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`, to: mgrTo.join(','), subject: m2.subject, text: m2.text, html: m2.html, attachments: built })
          emailed += mgrTo.length
        }
      } catch (e: any) { emailSkipped = e?.message || 'email failed' }
    } else if (!to.length) emailSkipped = 'HR Head has no email on record'
    else emailSkipped = emailSkipped || 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)'
    return NextResponse.json({ ok: true, notified: heads.length + managers.length, to: heads.map(h => `${h.name} (${h.code})`), managers: managers.map(m => `${m.name} (${m.code})`), cc: (ccEmps || []).map((e: any) => `${e.full_name} (${e.emp_code})`), emailed, emailSkipped,
      attachments: built.map(x => ({ name: x.filename, bytes: x.content.length })),
      ...(process.env.NODE_ENV !== 'production' ? { preview: mail.text, managerPreview: managers.length ? approvalMail(r, who, role, (mrf as any)?.mrf_number || null, null, appUrl, attachNames, 'manager', headNames).text : null, debugAttachments: built.map(x => ({ name: x.filename, base64: x.content.toString('base64') })) } : {}) })
  }

  // ── HR Head → recruiter(s) + HR managers: the decision (shared with the ESS route) ──
  if (body.action === 'decided') {
    const n = await notifyDecided(sb as any, requestId)
    if ('error' in n) return NextResponse.json({ error: n.error }, { status: n.status })
    return NextResponse.json({ ok: true, ...n })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
