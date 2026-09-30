// app/api/ess/offer-approvals/route.ts
//
//   GET                                                -> { isHrHead, isHrManager, pending, recent, awaiting, ready }
//     HR Head    : pending (SUBMITTED, to decide) + recent decisions
//     HR Manager : awaiting (SUBMITTED — "yet to be approved", read-only) + ready (HR_HEAD_APPROVED, send from Recruitment)
//   POST { action:'approve'|'reject', request_id, comment } -> the HR Head's decision, from ESS
//
// The HR Head's offer-approval tasks for ESS → Tasks & Approvals. Listing AND deciding
// happen here, so the HR Head never has to leave HRIS; the Recruitment → HR Head tab does
// the same writes. A rejection needs a reason. Deciding notifies the recruiter(s), the
// HR managers (approval) and the MRF raiser (rejection).

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { notifyDecided } from '@/lib/recruitment/offer-approval-notify'

const SEL = 'id, status, company_id, mrf_id, candidate_id, offered_ctc, offered_variable_pct, monthly_inhand, joining_bonus, joining_bonus_freq, retention_bonus, esop_value, esop_vesting, hike_pct, proposed_doj, days_to_join, notice_period_days, notice_buyout, notice_buyout_amount, prev_company_name, prev_company_address, prev_total_ctc, prev_fixed_ctc, prev_variable, prev_ta_da, prev_additional, hiring_manager_remark, recruiter_comments, template_content, submitted_at, hr_head_actioned_at, hr_head_comments, candidates:candidate_id(full_name, designation, current_company, experience_years, email, mobile), manpower_requisitions:mrf_id(mrf_number, designation, position, raised_by_name, assigned_recruiter)'

const shape = (x: any) => ({
  id: x.id, status: x.status, company_id: x.company_id,
  offered_ctc: x.offered_ctc, variable_pct: x.offered_variable_pct, monthly_inhand: x.monthly_inhand,
  joining_bonus: x.joining_bonus, joining_bonus_freq: x.joining_bonus_freq, retention_bonus: x.retention_bonus, esop_value: x.esop_value, esop_vesting: x.esop_vesting,
  hike_pct: x.hike_pct, proposed_doj: x.proposed_doj, days_to_join: x.days_to_join, notice_period_days: x.notice_period_days, notice_buyout: x.notice_buyout, notice_buyout_amount: x.notice_buyout_amount ?? null,
  prev_company_name: x.prev_company_name, prev_company_address: x.prev_company_address, prev_total_ctc: x.prev_total_ctc, prev_fixed_ctc: x.prev_fixed_ctc, prev_variable: x.prev_variable, prev_ta_da: x.prev_ta_da, prev_additional: x.prev_additional,
  hiring_manager_remark: x.hiring_manager_remark, recruiter_comments: x.recruiter_comments, template_content: x.template_content,
  submitted_at: x.submitted_at, actioned_at: x.hr_head_actioned_at, comment: x.hr_head_comments,
  candidate: x.candidates?.full_name || 'Candidate', designation: x.candidates?.designation || x.manpower_requisitions?.designation || x.manpower_requisitions?.position || '',
  current_company: x.candidates?.current_company || null, experience_years: x.candidates?.experience_years ?? null,
  mrf_number: x.manpower_requisitions?.mrf_number || null, raised_by: x.manpower_requisitions?.raised_by_name || null, recruiter: x.manpower_requisitions?.assigned_recruiter || null,
})

async function callerIsHrHead(ctx: any): Promise<boolean> {
  const roles = (ctx.menu.roles || []).map((x: string) => String(x).toUpperCase())
  return roles.includes('HR_HEAD') || !!ctx.grant.isSuperAdmin
}
function callerIsHrManager(ctx: any): boolean {
  return (ctx.menu.roles || []).map((x: string) => String(x).toUpperCase()).includes('HR_MANAGER')
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const isHrHead = await callerIsHrHead(ctx)
  const isHrManager = callerIsHrManager(ctx)
  const empty = { isHrHead: false, isHrManager, pending: [], recent: [], awaiting: [], ready: [] }
  if (!ctx.companyId) return NextResponse.json(empty)

  // The HR Manager has nothing to decide, but sees what is queued: offers submitted to the HR Head
  // ("yet to be approved" — the Send Offer button is locked) and approved ones ready to send.
  if (!isHrHead) {
    if (!isHrManager) return NextResponse.json(empty)
    const fetchMgr = async (sel: string) => Promise.all([
      sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).eq('status', 'SUBMITTED').order('submitted_at', { ascending: true }),
      sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).eq('status', 'HR_HEAD_APPROVED').order('hr_head_actioned_at', { ascending: false }).limit(20),
    ]) as Promise<[{ data: any[] | null; error: any }, { data: any[] | null; error: any }]>
    let [a, b] = await fetchMgr(SEL)
    if (a.error && /notice_buyout_amount/.test(a.error.message)) [a, b] = await fetchMgr(SEL.replace(', notice_buyout_amount', ''))
    return NextResponse.json({ ...empty, awaiting: (a.data || []).map(shape), ready: (b.data || []).map(shape) })
  }

  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const fetchBoth = async (sel: string) => Promise.all([
    sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).eq('status', 'SUBMITTED').order('submitted_at', { ascending: true }),
    sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).in('status', ['HR_HEAD_APPROVED', 'HR_HEAD_REJECTED', 'OFFER_SENT']).gte('hr_head_actioned_at', since).order('hr_head_actioned_at', { ascending: false }).limit(10),
  ]) as Promise<[{ data: any[] | null; error: any }, { data: any[] | null; error: any }]>
  let [p, q] = await fetchBoth(SEL)
  if (p.error && /notice_buyout_amount/.test(p.error.message)) [p, q] = await fetchBoth(SEL.replace(', notice_buyout_amount', ''))   // migration 133 not applied yet
  return NextResponse.json({ isHrHead: true, isHrManager, pending: (p.data || []).map(shape), recent: (q.data || []).map(shape), awaiting: [], ready: [] })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const body = await req.json().catch(() => null) as any
  const action = body?.action, requestId = String(body?.request_id || ''), comment = String(body?.comment || '').trim()
  if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  if (action === 'reject' && !comment) return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 })
  if (!(await callerIsHrHead(ctx))) return NextResponse.json({ error: 'Only the HR Head can decide offer approvals' }, { status: 403 })

  const { data: reqRow } = await sb.from('offer_approval_requests').select('id, status, company_id, candidate_id, candidates:candidate_id(full_name)').eq('id', requestId).maybeSingle()
  if (!reqRow) return NextResponse.json({ error: 'Offer approval request not found' }, { status: 404 })
  if (!ctx.grant.isSuperAdmin && reqRow.company_id !== ctx.companyId) return NextResponse.json({ error: 'This offer belongs to another company' }, { status: 403 })
  if (reqRow.status !== 'SUBMITTED') return NextResponse.json({ error: `This request is already ${reqRow.status.replace(/_/g, ' ').toLowerCase()}` }, { status: 409 })

  // Same writes as Recruitment → HR Head (HRHeadApprovalDashboard.processApproval).
  const headAction = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const { error } = await sb.from('offer_approval_requests').update({
    status: action === 'approve' ? 'HR_HEAD_APPROVED' : 'HR_HEAD_REJECTED',
    hr_head_action: headAction, hr_head_comments: comment || null, hr_head_actioned_at: new Date().toISOString(),
  }).eq('id', requestId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('recruitment_audit_logs').insert({
    candidate_id: reqRow.candidate_id, company_id: reqRow.company_id, action_type: `HR_HEAD_${headAction}`,
    details: { candidate_name: (reqRow as any).candidates?.full_name, comment, via: 'ESS Tasks & Approvals', by: ctx.caller.employeeId },
    created_at: new Date().toISOString(),
  }).then(() => null, () => null)
  const n = await notifyDecided(sb as any, requestId)
  return NextResponse.json({ ok: true, status: headAction, notified: 'notified' in n ? n.notified : 0 })
}
