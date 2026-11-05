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
  'EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'SITE_HR', 'REGIONAL_HEAD', 'HR', 'DONE',
] as const
export type Stage = typeof STAGES[number]

export const STAGE_LABEL: Record<Stage, string> = {
  EMPLOYEE: 'With the employee',
  RM_L1:    'With RM L1',
  RM_L2:    'With RM L2',
  HOD:      'With the HOD',
  SITE_HR:  'With the site HR',
  REGIONAL_HEAD: 'With the regional head',
  HR:       'With HR to publish',
  DONE:     'Published',
}

/**
 * The same stages named in two or three characters, for drawing the chain
 * itself rather than describing where something sits.
 *
 * STAGE_LABEL is a sentence — "With RM L1" — which is right in a status cell
 * and wrong repeated five times across a track, where the words "With" and
 * "the" are four fifths of the pixels and none of the information.
 */
export const STAGE_SHORT: Record<Stage, string> = {
  EMPLOYEE: 'Employee',
  RM_L1:    'RM L1',
  RM_L2:    'RM L2',
  HOD:      'HOD',
  SITE_HR:  'Site HR',
  REGIONAL_HEAD: 'Regional',
  HR:       'HR',
  DONE:     'Done',
}

/**
 * The rungs an appraisal passes through for one chain, in order, HR last.
 *
 * The employee is not a rung: they are where it starts and where a first
 * rejection sends it, not somebody who approves their own appraisal.
 */
/**
 * The rungs an appraisal travels, in order.
 *
 * TAKES A CUSTOM CHAIN AS WELL AS A PRESET (218). An administrator can now
 * compose any order from the relationships on the employee record, so this
 * accepts the composed list directly — every caller downstream already
 * works on whatever array this returns, which is why the custom chain is a
 * change here and almost nowhere else.
 *
 * HR IS APPENDED, NOT ASSUMED. A composed chain that already names HR must
 * not get it twice: the duplicate would park an appraisal on a rung it had
 * just left. A chain that omits it still gets it, because somebody has to
 * publish and no administrator should be able to compose a chain whose
 * results can never come out.
 */
export function rungs(chain: Chain | readonly Stage[] | null | undefined): Stage[] {
  const steps: Stage[] = Array.isArray(chain)
    ? (chain as Stage[]).filter(r => r !== 'EMPLOYEE')
    : (CHAIN_STEPS[(chain as Chain) ?? 'SELF_RM1_RM2_HOD'] ?? CHAIN_STEPS.SELF_RM1_RM2_HOD)
        .filter(r => r !== 'EMPLOYEE') as Stage[]
  // Deduplicated in order: a composed chain is somebody's typing, and the
  // same person twice in a row is a loop rather than two approvals.
  const seen = new Set<Stage>()
  const out = steps.filter(r => !seen.has(r) && seen.add(r) !== undefined && r !== 'DONE')
  return out.includes('HR') ? out : [...out, 'HR']
}

/** Where a fresh submission lands. */
export function firstRung(chain: Chain | readonly Stage[]): Stage {
  return rungs(chain)[0]
}

/**
 * WHETHER A RUNG IS ACTUALLY OCCUPIED for one employee.
 *
 * THE POLICY'S CHAIN AND THE FROZEN SNAPSHOT DISAGREE BY DESIGN, and this is
 * the function that reconciles them. pms_resolve_chain (067) drops RM L2 when
 * it resolves to the same person as RM L1 — "Same person at L1 and L2: drop
 * L2, keep them as L1 reviewer" — so a collapsed reporting line has a policy
 * chain of SELF_RM1_RM2_HOD and a snapshot with rm_l2_id NULL.
 *
 * 190 of the 395 enrolments in the database are in that state. Walking the
 * policy's rungs without asking who fills them would say an RM L1's approval
 * passes the set to RM L2 — for 48% of the company, a rung with nobody on it.
 *
 * HR is always held: it is a role, not a person named in the snapshot.
 */
export function heldBy(m: {
  rmL1Id?: string | null; rmL2Id?: string | null; hodId?: string | null
  /** 218. site_hr_id is set for 397 of 401 employees; regional_head_id for
   *  none of them, which is why a chain naming it steps straight over. */
  siteHrId?: string | null; regionalHeadId?: string | null
}): (s: Stage) => boolean {
  return s => s === 'HR' ? true
            : s === 'RM_L1' ? !!m.rmL1Id
            : s === 'RM_L2' ? !!m.rmL2Id
            : s === 'HOD' ? !!m.hodId
            : s === 'SITE_HR' ? !!m.siteHrId
            : s === 'REGIONAL_HEAD' ? !!m.regionalHeadId
            : false
}

/** Every rung counts as filled. The honest default when holders are unknown,
 *  and what a screen showing a policy rather than a person wants. */
const ALL_HELD = () => true

/**
 * The rung after this one, or null at the end of the chain.
 *
 * SKIPS RUNGS NOBODY OCCUPIES when given `held`, matching 197's forward walk.
 * Without that, a collapsed line's RM L1 would be told their approval passes
 * the set up when it actually finalises it — the button would say the wrong
 * thing and withhold the rating field the database then demands.
 *
 * A stage not in this chain returns null rather than guessing. That happens
 * for real: a policy switched from Self→RM1→RM2→HOD to Self→RM1 leaves
 * in-flight appraisals parked on RM_L2, a rung the chain no longer has.
 * Guessing "the next one along" would hand it to a HOD nobody appointed.
 */
export function nextRung(
  chain: Chain | readonly Stage[], stage: Stage, held: (s: Stage) => boolean = ALL_HELD,
): Stage | null {
  const r = rungs(chain)
  const i = r.indexOf(stage)
  if (i < 0) return null
  for (let j = i + 1; j < r.length; j++) if (held(r[j])) return r[j]
  return null
}

/**
 * Where a rejection sends it: back to the nearest rung somebody occupies, and
 * to the employee when none remains below.
 *
 * Set-level, not per-KRA. The brief says the KRAs go back to the preceding
 * person — the set — and a half-approved set could sit with a weightage total
 * that is no longer 100, which the lock exists to prevent.
 *
 * Skipping empty rungs matters more here than going forward: a rejection that
 * strands the appraisal on nobody is worse than no rejection, because the
 * employee is left waiting on a correction that can never be made.
 */
export function prevRung(
  chain: Chain | readonly Stage[], stage: Stage, held: (s: Stage) => boolean = ALL_HELD,
): Stage | null {
  const r = rungs(chain)
  const i = r.indexOf(stage)
  if (i < 0) return null
  for (let j = i - 1; j >= 0; j--) if (held(r[j])) return r[j]
  return 'EMPLOYEE'
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
export function approvalFinalises(
  chain: Chain, stage: Stage, held: (s: Stage) => boolean = ALL_HELD,
): boolean {
  return nextRung(chain, stage, held) === 'HR'
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
export function rejectDestination(
  chain: Chain, stage: Stage, held: (s: Stage) => boolean = ALL_HELD,
): string {
  const back = prevRung(chain, stage, held)
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
  // NARROWER THAN Stage, because this can only ever return a rung a PERSON
  // occupies. HR is a role with nobody named in the snapshot and DONE is not a
  // rung at all, so widening the return type to Stage made every caller handle
  // two cases that cannot happen — and one of them (the one-to-one recorder,
  // which takes a ConfirmStage) could not accept the value at all.
): 'RM_L1' | 'RM_L2' | 'HOD' | null {
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
