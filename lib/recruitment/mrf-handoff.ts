// lib/recruitment/mrf-handoff.ts — pure. When approving an MRF opens it for hiring, the
// approval IS the hand-off: somebody (a RECRUITER of the MRF's company) must be named to
// run it, or the requisition reaches nobody's queue.
//
// The hand-off is the LAST step, not just the step called HR_HEAD: when the HR Head is also
// the raiser's own manager the chain is a single RM2 step, and an MRF with no chain at all is
// opened by one decision. Both used to approve with nobody assigned.

export interface ChainStep { role?: string; status?: string; approver_id?: string | null; [k: string]: any }

/** The step this approval acts on (the PENDING one), if any. */
export function pendingStep(chain: ChainStep[] | null | undefined): ChainStep | undefined {
  return (Array.isArray(chain) ? chain : []).find(s => s.status === 'PENDING')
}

/** Does approving now open the requisition (so an assignee is required)? */
export function isHandOff(chain: ChainStep[] | null | undefined): boolean {
  const steps = Array.isArray(chain) ? chain : []
  const cur = pendingStep(steps)
  if (!cur || cur.role === 'HR_HEAD') return true
  return !steps.some(s => s.status === 'WAITING')
}

/** Ids posted as assignees, cleaned: strings, de-duplicated, at most 20. */
export function cleanIds(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.map(x => String(x ?? '').trim()).filter(Boolean))].slice(0, 20) : []
}

/** The assignees not in the allowed list (empty = all fine). */
export function strays(ids: string[], allowed: Iterable<string>): string[] {
  const ok = new Set(allowed)
  return ids.filter(x => !ok.has(x))
}

export const NEED_ASSIGNEE = 'Assign at least one hiring manager: approving opens the requisition, and it must be handed to someone to run.'
export const BAD_ASSIGNEE = 'Only hiring managers / recruiters of this requisition\'s company can be assigned to it.'
