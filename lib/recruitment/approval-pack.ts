// lib/recruitment/approval-pack.ts — SERVER ONLY.
//
// The three PDFs attached to the HR Head's offer-approval mail:
//   1. the MRF (requisition) the offer is against
//   2. the interview summary for that MRF — how many candidates were interviewed,
//      every round with its decision and score, and where each candidate stands
//   3. the CTC break-up acknowledgement — the salary statement the candidate accepted on
//      the salary link, PASSWORD-PROTECTED (the candidate's registered mobile number)
//
// Built with pdfkit (Helvetica; "Rs." instead of the rupee glyph, which the core fonts lack).

import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { linkStatementRows } from './ctc-statement'

const money = (n: any) => `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const when = (v: any) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const s = (v: any) => (v == null || v === '') ? '—' : String(v)

type Doc = PDFKit.PDFDocument

function render(build: (d: Doc) => void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margin: 48, pdfVersion: '1.7', ...opts })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    build(d)
    d.end()
  })
}

// ── small layout helpers ──
function title(d: Doc, t: string, sub?: string) {
  d.font('Helvetica-Bold').fontSize(17).fillColor('#1E1B4B').text(t)
  if (sub) d.font('Helvetica').fontSize(10).fillColor('#6B7280').text(sub)
  d.moveDown(0.6)
  d.moveTo(d.x, d.y).lineTo(d.page.width - d.page.margins.right, d.y).strokeColor('#D1D5DB').lineWidth(1).stroke()
  d.moveDown(0.6)
}
function section(d: Doc, t: string) {
  d.moveDown(0.4); d.font('Helvetica-Bold').fontSize(11).fillColor('#2563EB').text(t.toUpperCase(), { characterSpacing: 0.5 }); d.moveDown(0.25); d.fillColor('#111827')
}
function kv(d: Doc, rows: [string, any][]) {
  const x0 = d.x, labelW = 170
  for (const [k, v] of rows) {
    const val = s(v); if (val === '—') continue
    const y = d.y
    d.font('Helvetica').fontSize(10).fillColor('#6B7280').text(k, x0, y, { width: labelW })
    d.font('Helvetica').fontSize(10).fillColor('#111827').text(val, x0 + labelW, y, { width: d.page.width - d.page.margins.right - x0 - labelW })
    d.moveDown(0.15)
  }
  d.x = x0
}
function table(d: Doc, head: string[], rows: string[][], widths: number[], opts: { rightFrom?: number; bold?: (i: number) => boolean } = {}) {
  const x0 = d.x, rightFrom = opts.rightFrom ?? 99
  const line = (cells: string[], bold: boolean, bg?: string) => {
    if (d.y > d.page.height - d.page.margins.bottom - 40) d.addPage()
    const y = d.y, h = 18
    if (bg) d.rect(x0, y - 3, widths.reduce((a, b) => a + b, 0), h).fill(bg)
    let x = x0
    cells.forEach((c, i) => {
      d.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#111827')
        .text(c, x + 4, y, { width: widths[i] - 8, align: i >= rightFrom ? 'right' : 'left', lineBreak: false })
      x += widths[i]
    })
    d.y = y + h; d.x = x0
  }
  line(head, true, '#EEF2FF')
  rows.forEach((r, i) => line(r, !!opts.bold?.(i)))
  d.moveDown(0.5)
}

// ── 1. the MRF ──
export async function mrfPdf(sb: SupabaseClient, mrfId: string): Promise<{ name: string; content: Buffer } | null> {
  const { data: m } = await sb.from('manpower_requisitions')
    .select('*, departments:department_id(dept_name), companies:company_id(company_name), locations:location_id(location_name)').eq('id', mrfId).maybeSingle()
  if (!m) return null
  const chain = Array.isArray(m.approval_chain) ? m.approval_chain : []
  const budget = (m.budget_min || m.budget_max) ? `${m.budget_min ? money(m.budget_min) : '—'} to ${m.budget_max ? money(m.budget_max) : '—'}${m.pay_period === 'MONTHLY' ? ' per month' : ' per annum'}` : null
  const content = await render(d => {
    title(d, `Manpower Requisition ${s(m.mrf_number)}`, `${s(m.designation || m.position)} · ${s((m as any).companies?.company_name)} · Status ${s(m.status)}`)
    section(d, 'Position')
    kv(d, [['Designation', m.designation || m.position], ['Job title', m.job_title], ['Job code', m.job_code], ['Department', (m as any).departments?.dept_name], ['Location / branch', (m as any).locations?.location_name],
      ['Openings', m.no_of_openings || m.openings], ['Employment type', m.employment_type], ['Work mode', m.work_mode], ['Grade', m.grade], ['MRF type', m.mrf_type], ['Hiring type', m.hiring_type], ['Urgency', m.urgency], ['Reason', m.reason_for_hire || m.reason]])
    section(d, 'Budget & compensation')
    kv(d, [['Budget range', budget], ['Worker category', m.wage_category], ['Compensation type', m.compensation_type], ['Cost centre', m.cost_center], ['Budgeted', m.is_budgeted == null ? null : (m.is_budgeted ? 'Yes' : 'No')]])
    section(d, 'Requirements')
    kv(d, [['Experience', (m.experience_min || m.experience_max) ? `${s(m.experience_min)} to ${s(m.experience_max)} years` : m.experience_required], ['Education', m.education_min || m.education_required], ['Skills required', m.skills_required], ['Good to have', m.good_to_have_skills], ['Target joining', day(m.target_joining_date)], ['Valid till', day(m.validity_date)]])
    if (m.business_justification) { section(d, 'Business justification'); d.font('Helvetica').fontSize(10).fillColor('#111827').text(String(m.business_justification)) }
    if (m.job_description) { section(d, 'Job description'); d.font('Helvetica').fontSize(10).fillColor('#111827').text(String(m.job_description)) }
    section(d, 'Raised & approved by')
    kv(d, [['Raised by', `${s(m.raised_by_name)}${m.raised_by_role ? ` (${m.raised_by_role})` : ''}`], ['Raised on', day(m.created_at)], ['Assigned recruiter', m.assigned_recruiter]])
    if (chain.length) table(d, ['Step', 'Role', 'Approver', 'Status', 'On'], chain.map((c: any, i: number) => [String(c.order || i + 1), s(c.role), `${s(c.approver_name)}${c.approver_code ? ` (${c.approver_code})` : ''}`, s(c.status), when(c.acted_at)]), [40, 80, 190, 80, 120])
    d.moveDown(1); d.font('Helvetica').fontSize(8.5).fillColor('#9CA3AF').text(`Generated by EZER HRMS on ${when(new Date().toISOString())}`)
  })
  return { name: `${s(m.mrf_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, content }
}

// ── 2. interview summary for the MRF ──
export async function interviewSummaryPdf(sb: SupabaseClient, mrfId: string, highlightCandidateId?: string | null): Promise<{ name: string; content: Buffer; interviewed: number; candidates: number } | null> {
  const [{ data: m }, { data: cands }, { data: invites }] = await Promise.all([
    sb.from('manpower_requisitions').select('mrf_number, designation, position').eq('id', mrfId).maybeSingle(),
    sb.from('candidates').select('id, full_name, stage, current_company, expected_ctc, created_at').eq('mrf_id', mrfId).order('created_at'),
    sb.from('interview_invites').select('candidate_id, round, interviewer_name, role, status, decision, feedback, submitted_at, scheduled_at, created_at').eq('mrf_id', mrfId).order('created_at'),
  ])
  if (!m) return null
  const byCand = new Map<string, any[]>()
  for (const i of invites || []) (byCand.get(i.candidate_id) || byCand.set(i.candidate_id, []).get(i.candidate_id))!.push(i)
  const list = cands || []
  const interviewed = list.filter(c => (byCand.get(c.id) || []).some(i => i.status === 'submitted')).length
  const stageCount: Record<string, number> = {}
  for (const c of list) stageCount[c.stage] = (stageCount[c.stage] || 0) + 1
  const content = await render(d => {
    title(d, `Interview summary — ${s(m.mrf_number)}`, `${s(m.designation || m.position)} · ${list.length} candidate(s) on this requisition · ${interviewed} interviewed`)
    section(d, 'Pipeline')
    table(d, ['Stage', 'Candidates'], Object.entries(stageCount).map(([k, v]) => [k, String(v)]), [300, 100], { rightFrom: 1 })
    section(d, 'Candidates & rounds')
    for (const c of list) {
      const rows = (byCand.get(c.id) || []).filter(i => (i.role || 'MAIN') === 'MAIN')
      const isOffer = c.id === highlightCandidateId
      if (d.y > d.page.height - 160) d.addPage()
      d.font('Helvetica-Bold').fontSize(11).fillColor(isOffer ? '#2563EB' : '#111827').text(`${c.full_name}${isOffer ? '   (this offer)' : ''}`)
      d.font('Helvetica').fontSize(9.5).fillColor('#6B7280').text(`${s(c.current_company)} · expected ${c.expected_ctc ? money(c.expected_ctc) : '—'} · stage ${s(c.stage)} · ${rows.length} round(s)`)
      d.moveDown(0.2)
      if (rows.length) table(d, ['Round', 'Main interviewer', 'Result', 'Score', 'Decision', 'On'], rows.map(i => [s(i.round), s(i.interviewer_name), i.status === 'submitted' ? 'Feedback in' : i.status === 'acknowledged' ? 'Acknowledged' : 'Invited', i.feedback?.total != null ? `${i.feedback.total}/80 (${s(i.feedback.band)})` : '—', s(i.decision || i.feedback?.decision), day(i.submitted_at || i.scheduled_at)]), [80, 120, 75, 95, 70, 70])
      else { d.font('Helvetica').fontSize(9.5).fillColor('#9CA3AF').text('No interview rounds recorded.'); d.moveDown(0.5) }
    }
    d.moveDown(1); d.font('Helvetica').fontSize(8.5).fillColor('#9CA3AF').text(`Generated by EZER HRMS on ${when(new Date().toISOString())}`)
  })
  return { name: `Interview-summary-${s(m.mrf_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, content, interviewed, candidates: list.length }
}

// ── 3. CTC break-up acknowledgement (password-protected) ──
export async function ctcAcknowledgementPdf(sb: SupabaseClient, negotiationId: string | null, candidateId: string, password: string): Promise<{ name: string; content: Buffer; accepted: boolean } | null> {
  const q = negotiationId
    ? sb.from('ctc_negotiations').select('*').eq('id', negotiationId).maybeSingle()
    : sb.from('ctc_negotiations').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const [{ data: n }, { data: c }] = await Promise.all([q, sb.from('candidates').select('full_name, designation, email, mobile, phone, company_id').eq('id', candidateId).maybeSingle()])
  if (!n) return null
  // Negotiations rarely carry the company name — resolve it from the company row.
  const companyId = n.company_id || c?.company_id
  const { data: co } = companyId ? await sb.from('companies').select('company_name').eq('id', companyId).maybeSingle() : { data: null as any }
  if (!n.company_name && co?.company_name) n.company_name = co.company_name
  const calc = n.calculation_data || {}
  const link = linkStatementRows(calc, n.offered_ctc)
  const accepted = n.candidate_response === 'ACCEPTED'
  const content = await render(d => {
    title(d, `CTC break-up acknowledgement — ${s(c?.full_name || n.candidate_name)}`, `${s(n.position_title || c?.designation)} · ${s(n.company_name)} · Offer of ${money(n.offered_ctc)} per annum`)
    section(d, 'Acknowledgement')
    kv(d, [['Candidate', c?.full_name || n.candidate_name], ['Registered email', c?.email], ['Registered mobile', c?.mobile || c?.phone],
      ['Salary link sent', when(n.link_sent_at)], ['Link opened (after email OTP)', when(n.link_viewed_at)],
      ['Candidate response', accepted ? 'ACCEPTED' : n.candidate_response === 'REJECTED' ? 'DECLINED' : 'No response yet'], ['Responded on', when(n.response_at)], ['Candidate note', n.response_note]])
    d.moveDown(0.3)
    d.font('Helvetica').fontSize(9.5).fillColor(accepted ? '#059669' : '#B45309')
      .text(accepted ? `The candidate verified their registered email with a one-time code and accepted this break-up on ${when(n.response_at)}.` : 'The candidate has not accepted this break-up yet.')
    if (link) {
      section(d, 'Salary break-up (as shown on the salary link)')
      const rows = link.rows.filter(r => r.kind !== 'note')
      table(d, ['Component', 'Basis', 'Monthly', 'Annual'],
        rows.map(r => r.kind === 'head' ? [r.label, '', '', ''] : [r.label, s(r.basis).replace(/₹/g, 'Rs. '), r.monthly != null ? money(r.monthly) : '', r.annual != null ? money(r.annual) : '']),
        [170, 175, 75, 80], { rightFrom: 2, bold: i => ['sum', 'total', 'net', 'head'].includes(rows[i].kind) })
    } else if (n.is_stipend) {
      section(d, 'Stipend / fees')
      kv(d, [['Monthly', money(n.stipend_monthly)], ['TDS', n.tds_applicable ? `${s(n.tds_pct)}%` : 'Not applicable'], ['Net monthly', money(n.net_monthly)], ['Annual', money(Number(n.stipend_monthly || 0) * 12)]])
    }
    const extras: [string, any][] = []
    if (Number(n.joining_bonus) > 0) extras.push(['Joining bonus', `${money(n.joining_bonus)}${n.joining_bonus_freq ? ` (${n.joining_bonus_freq})` : ''}`])
    if (Number(n.retention_bonus) > 0) extras.push(['Retention bonus', `${money(n.retention_bonus)}${n.retention_bonus_freq ? ` (${n.retention_bonus_freq})` : ''}`])
    if (Number(n.esop_value) > 0) extras.push(['ESOP', `${money(n.esop_value)}${n.esop_remark ? ` (${n.esop_remark})` : ''}`])
    for (const a of Array.isArray(calc.additional_items) ? calc.additional_items : []) if (Number(a.amount) > 0) extras.push([`Additional (${s(a.freq)})`, `${money(a.amount)}${a.remark ? ` — ${a.remark}` : ''}`])
    if (extras.length) { section(d, 'One-time payments & extras'); kv(d, extras) }
    if (calc.terms_conditions) { section(d, 'Terms & conditions'); d.font('Helvetica').fontSize(9.5).fillColor('#111827').text(String(calc.terms_conditions)) }
    d.moveDown(1); d.font('Helvetica').fontSize(8.5).fillColor('#9CA3AF').text(`Confidential. Password-protected with the candidate's registered mobile number. Generated by EZER HRMS on ${when(new Date().toISOString())}.`)
  }, { userPassword: password, ownerPassword: `${password}-ezer-hr`, permissions: { printing: 'highResolution', copying: false, modifying: false } })
  return { name: `CTC-acknowledgement-${s(c?.full_name || n.candidate_name).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, content, accepted }
}
