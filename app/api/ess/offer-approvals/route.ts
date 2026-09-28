// app/api/ess/offer-approvals/route.ts
//
//   GET  -> { isHrHead, pending: [...], recent: [...] }
//
// The HR Head's offer-approval tasks for ESS → Tasks & Approvals: every offer request
// SUBMITTED in the caller's company, plus the ones they decided in the last 30 days.
// Reviewing and approving happens on Recruitment → HR Head (deep-linked from the task);
// this route only lists.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const roles = (ctx.menu.roles || []).map((x: string) => String(x).toUpperCase())
  const isHrHead = roles.includes('HR_HEAD') || ctx.grant.isSuperAdmin
  if (!isHrHead || !ctx.companyId) return NextResponse.json({ isHrHead: false, pending: [], recent: [] })

  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const sel = 'id, status, offered_ctc, offered_variable_pct, proposed_doj, hike_pct, submitted_at, hr_head_actioned_at, hr_head_comments, recruiter_comments, candidates:candidate_id(full_name, designation, current_company), manpower_requisitions:mrf_id(mrf_number, designation, position, raised_by_name)'
  const [{ data: pending }, { data: recent }] = await Promise.all([
    sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).eq('status', 'SUBMITTED').order('submitted_at', { ascending: true }),
    sb.from('offer_approval_requests').select(sel).eq('company_id', ctx.companyId).in('status', ['HR_HEAD_APPROVED', 'HR_HEAD_REJECTED', 'OFFER_SENT']).gte('hr_head_actioned_at', since).order('hr_head_actioned_at', { ascending: false }).limit(10),
  ])
  const shape = (x: any) => ({
    id: x.id, status: x.status, offered_ctc: x.offered_ctc, variable_pct: x.offered_variable_pct, proposed_doj: x.proposed_doj, hike_pct: x.hike_pct,
    submitted_at: x.submitted_at, actioned_at: x.hr_head_actioned_at, comment: x.hr_head_comments, recruiter_comments: x.recruiter_comments,
    candidate: x.candidates?.full_name || 'Candidate', designation: x.candidates?.designation || x.manpower_requisitions?.designation || x.manpower_requisitions?.position || '',
    current_company: x.candidates?.current_company || null, mrf_number: x.manpower_requisitions?.mrf_number || null, raised_by: x.manpower_requisitions?.raised_by_name || null,
  })
  return NextResponse.json({ isHrHead: true, pending: (pending || []).map(shape), recent: (recent || []).map(shape) })
}
