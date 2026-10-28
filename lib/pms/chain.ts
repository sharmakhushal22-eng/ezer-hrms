// lib/pms/chain.ts — where an appraisal sits in the approval chain, and which
// way it moves when somebody approves or rejects.
//
// NOT FROM THE SPEC. EZER_PMS_Module_Spec_v2 describes the chain as a forward
// march: §1 Stage 5 has RM L1 "transition directly to RM L2", and the only
// backward motion anywhere in the document is the KRA send-back at Stage 3.
// Rejection by any rung, returning the set to the PRECEDING rung, was asked
// for directly. Migration 197's header records the same divergence on the SQL
// side; this comment exists so nobody goes looking for §-numbers that aren't
// there.
//
// WHY THIS IS NOT JUST `CHAIN_STEPS`
//
// CHAIN_STEPS already lists the people in a chain, but it stops at the HOD,
// because it answers "who rates this employee". The stage machine needs one
// more rung: HR, who publishes and rates nobody. Deriving the stages FROM
// CHAIN_STEPS rather than restating them keeps one list of raters in the
// codebase — add a rung there and it appears here, with HR still last.
//
// ENGINE COMPUTES, SQL DECIDES
//
// Every function here is a prediction about what the database will do, used to
// decide which buttons to show and what to call them. The actual refusals live
// in pms_chain_approve and pms_chain_reject, which re-check identity against
// the frozen chain and cannot be talked out of it by a client. A disagreement
// between this file and 197 is a bug in this file; chain-sql-agrees.test.ts
// reads the migration and fails if the two lists diverge.

import { CHAIN_STEPS, type Chain, type Role } from './hierarchy.ts'

/**
 * Whose move it is. NULL in the database — `null` here — means not submitted,
 * which is deliberately distinct from 'EMPLOYEE': "never started" and "sent
 * back to the employee after a rejection" look identical on a queue otherwise,
 * and only one of them is somebody's fault.
 */
export const STAGES = [
  'EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR', 'DONE',
] as const
export type Stage = typeof STAGES[number]

export const STAGE_LABEL: Record<Stage, string> = {
  EMPLOYEE: 'With the employee',
  RM_L1:    'With RM L1',
  RM_L2:    'With RM L2',
  HOD:      'With the HOD',
  HR:       'With HR to publish',
  DONE:     'Published',
}

/**
 * The rungs an appraisal passes through for one chain, in order, HR last.
 *
 * The employee is not a rung: they are where it starts and where a first
 * rejection sends it, not somebody who approves their own appraisal.
 */
export function rungs(chain: Chain): Stage[] {
  const raters = CHAIN_STEPS[chain].filter(r => r !== 'EMPLOYEE') as Stage[]
  return [...raters, 'HR']
}

/** Where a fresh submission lands. */
export function firstRung(chain: Chain): Stage {
  return rungs(chain)[0]
}

/**
 * The rung after this one, or null at the end of the chain.
 *
 * A stage not in this chain returns null rather than guessing. That happens
 * for real: a policy switched from Self→RM1→RM2→HOD to Self→RM1 leaves
 * in-flight appraisals parked on RM_L2, a rung the chain no longer has.
 * Guessing "the next one along" would hand it to a HOD nobody appointed.
 */
export function nextRung(chain: Chain, stage: Stage): Stage | null {
  const r = rungs(chain)
  const i = r.indexOf(stage)
  if (i < 0) return null
  return r[i + 1] ?? null
}

/**
 * Where a rejection sends it: one rung back, and back to the employee from
 * the first rung.
 *
 * Set-level, not per-KRA. The brief says the KRAs go back to the preceding
 * person — the set — and a half-approved set could sit with a weightage total
 * that is no longer 100, which the lock exists to prevent.
 */
export function prevRung(chain: Chain, stage: Stage): Stage | null {
  const r = rungs(chain)
  const i = r.indexOf(stage)
  if (i < 0) return null
  if (i === 0) return 'EMPLOYEE'
  return r[i - 1]
}

/**
 * Whether this actor is the one holding the appraisal right now.
 *
 * Identity is checked in SQL against the frozen chain; this only compares the
 * role, so it is enough to decide whether to render an Approve button and not
 * enough to let anyone through. See the header.
 */
export function isActorsTurn(stage: Stage | null, role: Role): boolean {
  if (stage === null || stage === 'DONE') return false
  if (stage === 'HR') return role === 'HR_MGR' || role === 'HR_HEAD' || role === 'ADMIN'
  return stage === (role as string)
}

/**
 * Whether approving here finalises the rating, as opposed to passing it on.
 *
 * The last REVIEWER finalises — everything after them is publication, and a
 * result cannot be published before it exists. This is what makes the
 * Approve button read "Approve & finalise" and ask for a rating.
 */
export function approvalFinalises(chain: Chain, stage: Stage): boolean {
  return nextRung(chain, stage) === 'HR'
}

/** Whether this rung may reject at all. HR publishes; it does not judge. */
export function mayReject(stage: Stage | null): boolean {
  return stage !== null && stage !== 'EMPLOYEE' && stage !== 'HR' && stage !== 'DONE'
}

/**
 * The shortest sentence that says what a rejection will do, for the dialog.
 * Naming the destination matters: "this goes back to RM L1" and "this goes
 * back to the employee" are different decisions and the rejecter should see
 * which one they are making before they type the remark.
 */
export function rejectDestination(chain: Chain, stage: Stage): string {
  const back = prevRung(chain, stage)
  if (back === null) return 'nowhere — this stage is not part of the chain'
  return back === 'EMPLOYEE' ? 'back to the employee' : `back to ${back.replace('_', ' ')}`
}

/**
 * Which rung a viewer holds FOR ONE EMPLOYEE, from that employee's frozen
 * chain.
 *
 * PER EMPLOYEE, NOT PER VIEWER, and that is not a refinement — it is the only
 * correct reading. One manager is RM L1 to their own reportees and HOD to a
 * whole department at the same time; in a small company the chain collapses
 * further and one person holds every rung. A single "my rung" computed once
 * would be wrong for part of the queue in both directions: hiding approvals
 * genuinely waiting on them, and offering approvals that are not theirs.
 *
 * The order matters where one person holds two rungs. L1 first, matching
 * pms_resolve_chain (067), which refuses to store the same person at L1 and
 * L2 — "Same person at L1 and L2: drop L2, keep them as L1 reviewer" — so a
 * manager who is both is recorded as L1 alone. An appraisal parked at RM_L2
 * for somebody who is also the L1 would otherwise be unreachable.
 *
 * Shaped to read off whatever carries the frozen ids, so a queue row and a
 * raw pms_overall_rating row can both be asked.
 */
export function rungFor(
  m: { rmL1Id?: string | null; rmL2Id?: string | null; hodId?: string | null },
  viewerId: string,
): Stage | null {
  if (!viewerId) return null
  if (m.rmL1Id && m.rmL1Id === viewerId) return 'RM_L1'
  if (m.rmL2Id && m.rmL2Id === viewerId) return 'RM_L2'
  if (m.hodId && m.hodId === viewerId) return 'HOD'
  return null
}

/** 197 refuses a remark under this length. Mirrored so the form can too. */
export const MIN_REMARK = 10

export function remarkOk(remark: string | null | undefined): boolean {
  return !!remark && remark.trim().length >= MIN_REMARK
}
