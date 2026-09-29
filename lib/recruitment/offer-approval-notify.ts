// lib/recruitment/offer-approval-notify.ts — SERVER ONLY.
//
// Shared by the recruiter route (/api/recruitment/offer-approval) and the HR Head's ESS
// route (/api/ess/offer-approvals): who holds a role in a company, and the notifications
// that follow an HR Head decision (recruiters on the MRF, HR managers on approval, the
// MRF raiser on rejection).

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/ess/session'

export type Person = { id: string; name: string; code: string | null; role: string; email: string | null }

/** Active holders of the given ESS roles inside one company. */
export async function roleHolders(sb: SupabaseClient, companyId: string | null, roleCodes: string[]): Promise<Person[]> {
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

export const lakh = (n: any) => `₹${(Number(n || 0) / 100000).toFixed(2)}L`

/** After the HR Head decides: tell the recruiter(s) on the MRF, HR managers (approval) and the raiser (rejection). */
export async function notifyDecided(sb: SupabaseClient, requestId: string): Promise<{ notified: number; outcome: 'APPROVED' | 'REJECTED' } | { error: string; status: number }> {
  const { data: r } = await sb.from('offer_approval_requests').select('*').eq('id', requestId).maybeSingle()
  if (!r) return { error: 'Offer approval request not found', status: 404 }
  const approved = r.status === 'HR_HEAD_APPROVED' || r.hr_head_action === 'APPROVED'
  const rejected = r.status === 'HR_HEAD_REJECTED' || r.hr_head_action === 'REJECTED'
  if (!approved && !rejected) return { error: 'This request has not been decided yet', status: 409 }
  const [{ data: cand }, { data: mrf }] = await Promise.all([
    sb.from('candidates').select('full_name, designation, company_id').eq('id', r.candidate_id).maybeSingle(),
    r.mrf_id ? sb.from('manpower_requisitions').select('mrf_number, designation, position, assigned_recruiter_ids, requested_by, company_id').eq('id', r.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const companyId = r.company_id || cand?.company_id || (mrf as any)?.company_id || null
  const who = cand?.full_name || 'a candidate'
  const role = (mrf as any)?.designation || (mrf as any)?.position || cand?.designation || ''
  const ref = (mrf as any)?.mrf_number ? ` · ${(mrf as any).mrf_number}` : ''
  const recruiterIds: string[] = Array.isArray((mrf as any)?.assigned_recruiter_ids) ? (mrf as any).assigned_recruiter_ids : []
  const managers = approved ? await roleHolders(sb, companyId, ['HR_MANAGER']) : []
  const targets = new Set<string>([...recruiterIds, ...managers.map(m => m.id)])
  if ((mrf as any)?.requested_by && !approved) targets.add((mrf as any).requested_by)
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
  return { notified: targets.size, outcome: approved ? 'APPROVED' : 'REJECTED' }
}
