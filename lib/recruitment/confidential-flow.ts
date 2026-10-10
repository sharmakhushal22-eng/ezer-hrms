// lib/recruitment/confidential-flow.ts — SERVER ONLY.
//
// The server half of confidential hiring (see lib/recruitment/confidential.ts for the rules):
//   - who is told: the HR Head and HR Manager(s) of the company, nobody else
//   - the acceptance step: when the candidate accepts on the salary link, the offer request is
//     created ALREADY APPROVED, so Send Offers can go ahead without an Offer Approval round
//     (the HR Head raised the search, picked the candidate and set the salary — there is
//     nobody left to approve it but themselves)

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/ess/session'
import { roleHolders, lakh, type Person } from './offer-approval-notify'
import { CONFIDENTIAL_VIEWER_CODES } from './confidential'

/** Everyone who may know about a confidential search in this company. */
export async function confidentialAudience(sb: SupabaseClient, companyId: string | null): Promise<Person[]> {
  return roleHolders(sb, companyId, CONFIDENTIAL_VIEWER_CODES)
}

/** The MRF of a candidate, with its confidential flag (null when there is none). */
export async function mrfOfCandidate(sb: SupabaseClient, candidateId: string): Promise<any | null> {
  const { data: cand } = await sb.from('candidates').select('mrf_id').eq('id', candidateId).maybeSingle()
  if (!cand?.mrf_id) return null
  const { data: mrf } = await sb.from('manpower_requisitions').select('*').eq('id', cand.mrf_id).maybeSingle()
  return mrf || null
}

const daysUntil = (d?: string | null) => d ? Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)) : null

/**
 * Candidate accepted on the salary link, and the search is confidential: create the offer
 * request as HR_HEAD_APPROVED and tell the HR Head + HR Manager(s) it is ready to send.
 * Returns null when the search is not confidential, or a request already stands.
 */
export async function autoApproveConfidentialOffer(sb: SupabaseClient, neg: any): Promise<{ requestId: string; notified: number } | null> {
  if (!neg?.candidate_id) return null
  const { data: cand } = await sb.from('candidates').select('id, full_name, designation, company_id, mrf_id, stage').eq('id', neg.candidate_id).maybeSingle()
  if (!cand?.mrf_id) return null
  const { data: mrf } = await sb.from('manpower_requisitions').select('*').eq('id', cand.mrf_id).maybeSingle()
  if (!mrf?.is_confidential) return null
  if (['Offer Sent', 'Joined', 'Rejected'].includes(String(cand.stage))) return null

  // One live request per candidate — a rejected one may be replaced, anything else stands.
  const { data: existing } = await sb.from('offer_approval_requests').select('id, status').eq('candidate_id', cand.id).neq('status', 'HR_HEAD_REJECTED').limit(1)
  if (existing?.length) return null

  const companyId = cand.company_id || mrf.company_id || neg.company_id || null
  const hrHead = mrf.confidential_by ? await sb.from('employees').select('id, full_name, emp_code').eq('id', mrf.confidential_by).maybeSingle().then(r => r.data) : null
  const role = cand.designation || mrf.designation || mrf.position || ''
  const pkg = neg.is_stipend ? `${lakh(Number(neg.stipend_monthly || 0) * 12)} a year (${Math.round(Number(neg.stipend_monthly || 0)).toLocaleString('en-IN')} a month)` : `${lakh(neg.offered_ctc)} a year`
  const now = new Date().toISOString()
  const row: any = {
    candidate_id: cand.id, mrf_id: mrf.id, company_id: companyId, ctc_negotiation_id: neg.id,
    prev_company_name: neg.prev_company_name || null, prev_company_address: neg.prev_company_address || null,
    prev_total_ctc: neg.prev_total_ctc || null, prev_fixed_ctc: neg.prev_fixed_ctc || null, prev_variable: neg.prev_variable || null,
    prev_ta_da: neg.prev_ta_da || null, prev_additional: neg.prev_additional || null,
    offered_ctc: neg.offered_ctc || null, offered_variable_pct: neg.is_stipend ? null : (neg.variable_pct || null),
    monthly_inhand: neg.net_monthly || null,
    joining_bonus: neg.joining_bonus || null, joining_bonus_freq: neg.joining_bonus_freq || null,
    retention_bonus: neg.retention_bonus || null, esop_value: neg.esop_value || null, esop_vesting: neg.esop_remark || null,
    hike_pct: neg.is_stipend ? null : (neg.hike_pct ?? null),
    proposed_doj: neg.proposed_doj || null, days_to_join: daysUntil(neg.proposed_doj), notice_period_days: neg.notice_period_days || null,
    notice_buyout: false,
    template_content: `CONFIDENTIAL HIRING — offer self-approved by the HR Head\n\nCandidate: ${cand.full_name}${role ? ` — ${role}` : ''}\nMRF: ${mrf.mrf_number || '—'}\nOffered: ${pkg}${neg.proposed_doj ? `\nProposed joining: ${new Date(neg.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}\n\nThe candidate accepted the salary break-up on the link on ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}. No separate approval step: the search is confidential and was raised, run and priced by the HR Head.`,
    status: 'HR_HEAD_APPROVED', submitted_at: now, submitted_by: hrHead?.id || mrf.confidential_by || null,
    hr_head_action: 'APPROVED', hr_head_comments: 'Confidential hiring — self-approved by the HR Head', hr_head_actioned_at: now,
    recruiter_comments: 'Created automatically on the candidate\'s acceptance (confidential hiring).',
    cc_employee_ids: [],
  }
  let ins = await sb.from('offer_approval_requests').insert(row).select('id').single()
  if (ins.error && (ins.error.code === 'PGRST204' || /notice_buyout_amount|cc_employee_ids|submitted_by/.test(ins.error.message))) {
    const { cc_employee_ids: _c, submitted_by: _s, ...rest } = row
    ins = await sb.from('offer_approval_requests').insert(rest).select('id').single()
  }
  if (ins.error || !ins.data?.id) throw new Error(ins.error?.message || 'Could not create the offer request')
  const requestId = ins.data.id as string

  await sb.from('recruitment_audit_logs').insert({
    candidate_id: cand.id, company_id: companyId, action_type: 'CONFIDENTIAL_OFFER_AUTO_APPROVED',
    details: { request_id: requestId, candidate_name: cand.full_name, mrf_number: mrf.mrf_number, by: hrHead?.full_name || null },
    created_at: now,
  }).then(() => null, () => null)

  // Only the HR Head and HR Manager(s) of the company hear about it.
  const audience = await confidentialAudience(sb, companyId)
  await Promise.all(audience.map(p => notify(
    p.id,
    `Confidential offer ready to send — ${cand.full_name}`,
    `${cand.full_name}${role ? ` (${role})` : ''}${mrf.mrf_number ? ` · ${mrf.mrf_number}` : ''} accepted the salary break-up of ${pkg}. The offer is self-approved (confidential hiring) and is on Send Offers — verify the offer file, generate the letter and send it.`,
    '/ess-portal?module=recruitment&tab=sendoffer',
    'APPROVAL',
  ).catch(() => null)))
  return { requestId, notified: audience.length }
}
