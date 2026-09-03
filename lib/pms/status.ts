// lib/pms/status.ts — the exact status vocabularies the schema allows.
//
// EVERY ONE OF THESE WAS GUESSED WRONG FIRST TIME.
//
// Writing this screen against remembered names produced `.eq('status',
// 'ACTIVE')` on pms_periods, which has no ACTIVE — the filter matched zero
// rows and would have gone on matching zero rows forever, showing an empty
// cycle that looked like "no period configured" rather than a bug. Same for
// SUBMITTED and APPROVED on goals, neither of which exists.
//
// A wrong status string is invisible: PostgREST returns success and no rows.
// So the names live here as constants, and a test asserts they are exactly
// the values migration 066's CHECK constraints permit — which is a thing a
// machine can verify and a person cannot.

export const PERIOD_STATUS = {
  SCHEDULED: 'SCHEDULED', KRA_SETTING: 'KRA_SETTING', IN_PROGRESS: 'IN_PROGRESS',
  SELF_RATING: 'SELF_RATING', RM_REVIEW: 'RM_REVIEW', FINALISATION: 'FINALISATION',
  PUBLISHED: 'PUBLISHED', CLOSED: 'CLOSED',
} as const

/** A period that is running — anything past scheduling and before the door
 *  shuts. "Active" is a concept in the UI, not a value in the column. */
export const PERIOD_OPEN = [
  PERIOD_STATUS.KRA_SETTING, PERIOD_STATUS.IN_PROGRESS, PERIOD_STATUS.SELF_RATING,
  PERIOD_STATUS.RM_REVIEW, PERIOD_STATUS.FINALISATION, PERIOD_STATUS.PUBLISHED,
] as string[]

export const GOAL_STATUS = {
  DRAFT: 'DRAFT', PENDING_ONE_TO_ONE: 'PENDING_ONE_TO_ONE',
  PENDING_RM_APPROVAL: 'PENDING_RM_APPROVAL', LOCKED: 'LOCKED',
  SENT_BACK: 'SENT_BACK', TERMINATED: 'TERMINATED',
} as const

/** Left the employee's hands. SENT_BACK counts: it was submitted once and
 *  bounced, so the cycle has moved past "never written". */
export const GOAL_SENT = [
  GOAL_STATUS.PENDING_ONE_TO_ONE, GOAL_STATUS.PENDING_RM_APPROVAL,
  GOAL_STATUS.LOCKED, GOAL_STATUS.SENT_BACK,
] as string[]

/** Waiting on a manager to approve. */
export const GOAL_AWAITING_RM = [GOAL_STATUS.PENDING_RM_APPROVAL] as string[]

export const WORKFLOW = {
  NOT_STARTED: 'NOT_STARTED', KRA_DRAFT: 'KRA_DRAFT', KRA_LOCKED: 'KRA_LOCKED',
  SELF_DRAFT: 'SELF_DRAFT', SELF_SUBMITTED: 'SELF_SUBMITTED',
  RM_L1_DONE: 'RM_L1_DONE', RM_L2_DONE: 'RM_L2_DONE',
  FINALISED: 'FINALISED', PUBLISHED: 'PUBLISHED', ACKNOWLEDGED: 'ACKNOWLEDGED',
} as const

/** The workflow column is an ordered ladder, so "have we reached X" is a
 *  position comparison rather than a set membership test. */
export const WORKFLOW_ORDER: string[] = [
  WORKFLOW.NOT_STARTED, WORKFLOW.KRA_DRAFT, WORKFLOW.KRA_LOCKED, WORKFLOW.SELF_DRAFT,
  WORKFLOW.SELF_SUBMITTED, WORKFLOW.RM_L1_DONE, WORKFLOW.RM_L2_DONE,
  WORKFLOW.FINALISED, WORKFLOW.PUBLISHED, WORKFLOW.ACKNOWLEDGED,
]

/** Has the workflow reached `mark`? Unknown values sort to the bottom, so an
 *  unrecognised status never reads as further along than it is. */
export function reached(status: string | null | undefined, mark: string): boolean {
  const i = WORKFLOW_ORDER.indexOf(status ?? '')
  const j = WORKFLOW_ORDER.indexOf(mark)
  return i >= 0 && j >= 0 && i >= j
}
