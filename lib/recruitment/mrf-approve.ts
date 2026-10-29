// lib/recruitment/mrf-approve.ts — SERVER ONLY. The approval write for an MRF, shared by the
// ESS approve action (/api/ess/mrf) and the dashboard screens (/api/recruitment/mrf-decision).
// Every path that approves goes through here, so the hand-off rule (lib/recruitment/mrf-handoff.ts)
// is enforced in one place, before anything is written.

import type { SupabaseClient } from '@supabase/supabase-js'
import { mrfScope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { isHandOff, pendingStep, strays, NEED_ASSIGNEE, BAD_ASSIGNEE } from './mrf-handoff'

export type Brief = { id: string; name: string; code: string }

// The people an approved MRF may be handed to — only Hiring Managers / Recruiters (the role
// that actually runs the hiring) of the given company, never the broader HR team.
const HR_ROLE_CODES = ['RECRUITER']
export async function hrTeamFor(sb: SupabaseClient, companyId: string | null): Promise<(Brief & { role: string })[]> {
  if (!companyId) return []
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', HR_ROLE_CODES)
  const roleIds = (roles || []).map((r: any) => r.id)
  if (!roleIds.length) return []
  const roleByCode: Record<string, string> = {}
  ;(roles || []).forEach((r: any) => { roleByCode[r.id] = r.role_code })
  const { data: urs } = await sb.from('ess_user_roles')
    .select('role_id, ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id))')
    .in('role_id', roleIds).eq('is_active', true)
  const seen = new Set<string>(); const out: (Brief & { role: string })[] = []
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (e && e.company_id === companyId && !seen.has(e.id)) {
      seen.add(e.id); out.push({ id: e.id, name: e.full_name, code: e.emp_code, role: roleByCode[u.role_id] })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ApproveInput {
  id: string
  actor: { id: string | null; name: string | null; code: string | null }
  note?: string | null
  assignIds: string[]
  /** 'step': approve the PENDING step and hand on (ESS). 'final': one decision opens the MRF,
   *  remaining steps stamped by the same approver (the dashboard screens). */
  mode: 'step' | 'final'
  /** ESS: only the PENDING step's approver may act (super admins excepted). */
  mustBeApprover?: boolean
}
export type ApproveResult = { ok: true; status: string; handedOff: boolean } | { ok: false; status: number; error: string }

export async function approveMrf(sb: SupabaseClient, inp: ApproveInput): Promise<ApproveResult> {
  const { data: mrf } = await sb.from('manpower_requisitions')
    .select('id, status, company_id, approval_chain, designation, position, mrf_number').eq('id', inp.id).maybeSingle()
  if (!mrf) return { ok: false, status: 404, error: 'MRF not found' }
  if (!['SUBMITTED', 'PENDING', 'PENDING_APPROVAL', 'ON_HOLD'].includes(String(mrf.status))) return { ok: false, status: 409, error: 'This MRF is not awaiting approval.' }
  const chain = Array.isArray(mrf.approval_chain) ? mrf.approval_chain.map((s: any) => ({ ...s })) : []
  const cur = pendingStep(chain)
  if (inp.mode === 'step' && !cur) return { ok: false, status: 400, error: 'This MRF is not awaiting approval.' }
  if (inp.mustBeApprover && cur && cur.approver_id !== inp.actor.id) return { ok: false, status: 403, error: 'This MRF is not waiting on you.' }

  // The rule — checked before anything is written, so a refusal leaves the chain untouched.
  const handOff = inp.mode === 'final' || isHandOff(chain)
  if (handOff && !inp.assignIds.length) return { ok: false, status: 400, error: NEED_ASSIGNEE }
  let briefs: Brief[] = []
  if (inp.assignIds.length) {
    const team = await hrTeamFor(sb, mrf.company_id)
    if (strays(inp.assignIds, team.map(t => t.id)).length) return { ok: false, status: 400, error: BAD_ASSIGNEE }
    briefs = inp.assignIds.map(id => team.find(t => t.id === id)!).filter(Boolean)
  }

  const now = new Date().toISOString()
  const note = inp.note?.trim() || null
  const patch: any = {}
  if (inp.mode === 'step') {
    cur!.status = 'APPROVED'; cur!.acted_at = now; cur!.comment = note
    // A super admin deciding someone else's step: the step keeps its named approver and
    // records who actually acted (the tracker shows it), rather than passing as theirs.
    if (inp.actor.id && cur!.approver_id !== inp.actor.id) {
      cur!.acted_by_id = inp.actor.id
      cur!.acted_by_name = inp.actor.name ? `${inp.actor.name}${inp.actor.code ? ` (${inp.actor.code})` : ''}` : 'Super admin'
    }
    const next = chain.find((s: any) => s.status === 'WAITING')
    if (next && !handOff) next.status = 'PENDING'
  } else {
    for (const s of chain) if (s.status !== 'APPROVED') Object.assign(s, { status: 'APPROVED', acted_at: now, comment: note, actor: inp.actor.name || s.actor || null, acted_by: inp.actor.id })
  }
  patch.approval_chain = chain
  if (handOff) {
    Object.assign(patch, {
      status: 'APPROVED', approved_at: now, remarks: note,
      assigned_recruiter_ids: briefs.map(b => b.id),
      assigned_recruiter: briefs.map(b => `${b.name} (${b.code})`).join(', ') || null,
    })
  }
  const { error } = await sb.from('manpower_requisitions').update(patch).eq('id', inp.id)
  if (error) return { ok: false, status: 500, error: error.message }

  await sb.from('recruitment_audit_logs').insert({
    mrf_id: inp.id, company_id: mrf.company_id || null, created_at: now,
    action_type: handOff ? 'MRF_APPROVED' : 'MRF_STEP_APPROVED',
    details: { position: mrf.designation || mrf.position, by: inp.actor.name, by_code: inp.actor.code, step: cur?.role || 'single', assigned: briefs.map(b => `${b.name} (${b.code})`), note },
  }).then(() => null, () => null)

  // Tell each assigned hiring manager they've been given this requisition to run — they
  // acknowledge it in Tasks & Approvals and pick up the MRF in Recruitment.
  if (handOff && briefs.length) {
    const label = `${mrf.designation || mrf.position || 'a role'}${mrf.mrf_number ? ` (${mrf.mrf_number})` : ''}`
    const scope = await mrfScope(inp.id)
    await Promise.all(briefs.map(b => notifyFromTemplate(b.id, 'notify.mrf.assigned', { mrf_label: label }, { scope, link: '/ess?tab=approvals', category: 'MRF' }).catch(() => null)))
  }
  return { ok: true, status: handOff ? 'APPROVED' : 'SUBMITTED', handedOff: handOff }
}
