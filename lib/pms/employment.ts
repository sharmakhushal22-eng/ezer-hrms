// lib/pms/employment.ts — the four employment flags. Spec §8.
//
// These decide row colour, queue priority and whether a record is writable.
// vw_pms_employment_flag computes them in the database; this mirrors it so a
// screen can sort and highlight without a round trip, and so the rules are
// testable without one.
//
// THE READ-ONLY LOCK IS NOT A UI CONCERN. trg_pms_readonly enforces it at
// database level. What this file decides is what to SHOW — an exited person's
// row must look different before somebody wastes time typing into it.

export type Flag = 'EXITED' | 'NOTICE_PERIOD' | 'NEW_JOINER' | 'ACTIVE'

export interface Employment {
  dateOfLeaving?: string | null
  resignationDate?: string | null
  dateOfJoining?: string | null
}

export interface FlagRules {
  /** Somebody who joined within this many days of the period end is NR. */
  newJoinerCutoffDays: number
}

export const DEFAULT_FLAG_RULES: FlagRules = { newJoinerCutoffDays: 30 }

function days(a: string, b: string): number {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z')
  return Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.round((x - y) / 86400000)
}

/**
 * Order matters and is not alphabetical.
 *
 * EXITED is checked first: somebody who has already left is not "on notice",
 * even though their resignation date is also set. Reversing these two would
 * leave a departed employee sitting in the active queue with a countdown to
 * a date that has passed.
 */
export function flagFor(
  e: Employment, today: string, rules: FlagRules = DEFAULT_FLAG_RULES,
): Flag {
  if (e.dateOfLeaving && e.dateOfLeaving <= today) return 'EXITED'
  if ((e.dateOfLeaving && e.dateOfLeaving > today) || e.resignationDate) return 'NOTICE_PERIOD'
  if (e.dateOfJoining) {
    const d = days(today, e.dateOfJoining)
    if (!Number.isNaN(d) && d >= 0 && d < rules.newJoinerCutoffDays) return 'NEW_JOINER'
  }
  return 'ACTIVE'
}

/** Days until the last working day, for the countdown on a notice row. */
export function daysToLwd(e: Employment, today: string): number | null {
  if (!e.dateOfLeaving) return null
  const d = days(e.dateOfLeaving, today)
  return Number.isNaN(d) ? null : d
}

export const FLAG_LABEL: Record<Flag, string> = {
  EXITED: 'Left the company',
  NOTICE_PERIOD: 'On notice',
  NEW_JOINER: 'New joiner',
  ACTIVE: 'Active',
}

/** Said in words, because colour alone is not a signal. */
export const FLAG_MEANING: Record<Flag, string> = {
  EXITED: 'Their record is read-only once finalised. Rate them before their last day.',
  NOTICE_PERIOD: 'Leaving soon. Their appraisal has to be finished before the last working day.',
  NEW_JOINER: 'Joined too recently to be rated fairly this period — marked NR.',
  ACTIVE: 'Nothing unusual.',
}

/**
 * Queue order for an RM or HOD. Spec §4.1 and §5.1: exit and notice rows are
 * pinned to the top, because those are the ones with a deadline that does not
 * move. Everything else sorts after them.
 */
export function queuePriority(f: Flag): number {
  switch (f) {
    case 'NOTICE_PERIOD': return 0   // hardest deadline: they leave on a date
    case 'EXITED':        return 1   // already gone, but may still need finalising
    case 'ACTIVE':        return 2
    case 'NEW_JOINER':    return 3   // nothing to rate yet
  }
}

/** Does this row need somebody to act before a fixed date? Drives
 *  vw_pms_exit_priority.action_required. */
export function actionRequired(f: Flag, finalised: boolean): boolean {
  if (finalised) return false
  return f === 'NOTICE_PERIOD' || f === 'EXITED'
}
