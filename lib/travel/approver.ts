// lib/travel/approver.ts — who may act on a travel claim or trip, decided on the server.
//
// The approval routes used to take `actioned_by` from the body and ask only "is this a
// dashboard session?" — which every ESS employee has. So an employee could approve, pay or
// close their own claim by naming their manager in the body. Money moved on a claim.
//
// Now the caller is identified from the token and must be one of:
//   · the stage's approver for THIS employee — their L1 manager (RM stage), their HR head or
//     HR manager (HR stage), as the employee record says, not as the body says
//   · staff holding Travel Claims EDIT (or Finance EDIT for the Finance stage) in the
//     employee's company — HR and Finance acting from the dashboard
//   · the legacy shared login, which is a group super admin while it still exists
//
// The returned `actor` is what gets written to approved_by / actioned_by. For the legacy
// login (no employee row) it is null, and the route may fall back to the id it was sent,
// because a super admin naming an approver is a different thing from an employee naming one.
import type { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireGrant, holds, inCompany, refuse } from '@/lib/rms/authz'
import type { Grant } from '@/lib/rms/resolve'

export type TravelStage = 'RM' | 'HR' | 'FINANCE'

export type TravelActor =
  | { ok: true; actor: string | null; grant: Grant; staff: boolean }
  | { ok: false; response: NextResponse }

interface Subject { employee_id: string; company_id: string | null }

/** Staff for travel money: Travel Claims EDIT, or Finance EDIT when the stage is Finance. */
export function travelStaff(g: Grant, companyId: string | null, stage: TravelStage | null): boolean {
  if (!inCompany(g, companyId, 'Travel Claims')) return false
  if (holds(g, 'Travel Claims', 'EDIT')) return true
  return (stage === 'FINANCE' || stage === null) && holds(g, 'Finance', 'EDIT')
}

/** The caller, if they may act at `stage` on `subject`'s records. `stage` null means
 *  "any travel staff" — closing a period, say — with no per-employee approver path. */
export async function travelApprover(
  req: NextRequest,
  sb: SupabaseClient,
  subject: Subject,
  stage: TravelStage | null,
): Promise<TravelActor> {
  const gate = await requireGrant(req)
  if (gate.error) return { ok: false, response: gate.error }
  const g = gate.grant
  const actor = g.employeeId

  if (travelStaff(g, subject.company_id, stage)) return { ok: true, actor, grant: g, staff: true }

  if (actor && stage) {
    const { data: emp } = await sb
      .from('employees')
      .select('l1_manager_id, hr_head_id, hr_manager_id')
      .eq('id', subject.employee_id)
      .maybeSingle()
    const approvers =
      stage === 'RM' ? [emp?.l1_manager_id]
      : stage === 'HR' ? [emp?.hr_head_id, emp?.hr_manager_id]
      : []
    if (approvers.includes(actor)) return { ok: true, actor, grant: g, staff: false }
  }

  return { ok: false, response: refuse(403, 'You are not an approver for this record.') }
}

/** The employee themself, or travel staff of their company — for submit / cancel paths. */
export async function travelOwnerOrStaff(req: NextRequest, subject: Subject): Promise<TravelActor> {
  const gate = await requireGrant(req)
  if (gate.error) return { ok: false, response: gate.error }
  const g = gate.grant
  if (g.employeeId && g.employeeId === subject.employee_id) return { ok: true, actor: g.employeeId, grant: g, staff: false }
  if (travelStaff(g, subject.company_id, null)) return { ok: true, actor: g.employeeId, grant: g, staff: true }
  return { ok: false, response: refuse(403, 'You can only act on your own travel records.') }
}

/** The stage a claim is waiting at, from its status. */
export function stageOfStatus(status: string | null | undefined): TravelStage {
  if (status === 'PENDING_RM') return 'RM'
  if (status === 'PENDING_HR') return 'HR'
  return 'FINANCE'
}
