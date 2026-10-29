// lib/pms/oneToOne.ts — the discussion log, and the two gates it controls.
// Spec §3.3, and rules 5 and 8 of §11.
//
// THE POINT OF THIS FILE
//
// A one-to-one is the only part of the PMS that cannot be faked by filling a
// form: it requires two people to say the conversation happened. So the spec
// hangs two irreversible steps off it —
//
//   KRA_SETTING  acknowledged by both  →  weightage may lock
//   FINAL_REVIEW acknowledged by both  →  the result may publish
//
// ONE ACKNOWLEDGEMENT IS NOT ENOUGH, and that is the whole design. A manager
// ticking a box on their own is a manager asserting a conversation happened.
// Requiring the employee's tick too is what makes the record worth anything
// later — in an appraisal dispute, or a PIP that ends in separation.
//
// Both gates are enforced in the database as well (pms_lock_kras and
// pms_finalise). This module exists so a screen can explain the block BEFORE
// somebody hits it, not to be the enforcement.

export const DISCUSSION_TYPES = [
  'KRA_SETTING', 'MID_PERIOD', 'FINAL_REVIEW', 'ADHOC',
] as const
export type DiscussionType = typeof DISCUSSION_TYPES[number]

export const TYPE_LABEL: Record<DiscussionType, string> = {
  KRA_SETTING: 'KRA setting', MID_PERIOD: 'Mid-period check-in',
  FINAL_REVIEW: 'Final review', ADHOC: 'Ad hoc',
}

export const TYPE_PURPOSE: Record<DiscussionType, string> = {
  KRA_SETTING:  'Settles the KRAs and their weightages. Until both sides acknowledge this, the weightage cannot be locked.',
  MID_PERIOD:   'A course correction while there is still time to act on it. Optional unless the policy says otherwise.',
  FINAL_REVIEW: 'The conversation about the rating, held before it is published. The result cannot be published without it.',
  ADHOC:        'Anything else worth having on record.',
}

// ── the log, recorded by a tick rather than a form ───────────────────────

/**
 * WHO IS CONFIRMING, at which point in the cycle.
 *
 * Requested: the log should be automatic — a mandatory checkbox at every
 * stage saying the one-to-one happened, which records the log when it is
 * ticked, rather than a separate form somebody has to remember to fill in.
 *
 * THAT IS A CHANGE OF MECHANISM, NOT OF RULE. Both gates still need two
 * acknowledgements: the employee's tick when they submit, the manager's tick
 * when they act. What goes away is the form standing between the intent and
 * the record — which is why FINAL_REVIEW rows existed for only 7 of 395
 * enrolments, and why a HOD could be blocked by a gate only the employee
 * could open.
 *
 * It does NOT replace the detailed log. The duration, the discussion points
 * and the agreed weightage changes are still worth capturing when there is
 * something to say — Point 3 of the brief asked for exactly that — so the
 * tick writes a record with a stated default and the form can still enrich
 * it. A tick is the floor, not the ceiling.
 */
export const CONFIRM_STAGES = ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD'] as const
export type ConfirmStage = typeof CONFIRM_STAGES[number]

export interface AutoLog {
  discussion_type: DiscussionType
  /** pms_one_to_one.manager_role, which NOTHING has ever written: every row
   *  in the database says RM_L1 because that is the column default, including
   *  FINAL_REVIEW rows a HOD logged. A log that cannot say which stage it
   *  belongs to is most of the way to not being a log. */
  manager_role: 'RM_L1' | 'RM_L2' | 'HOD'
  /** discussion_points is NOT NULL, so a tick has to supply something. It
   *  says what was confirmed and by whom, and reads as a record rather than
   *  as filler, because somebody will read it in a dispute. */
  discussion_points: string
  /** Which side's acknowledgement this tick represents. */
  side: 'employee' | 'manager'
}

/**
 * The log a tick records at each stage.
 *
 * KRA_SETTING is shared between the employee and RM L1 on purpose: it is ONE
 * conversation with two acknowledgements, and that is what pms_lock_kras
 * checks. The employee's tick creates the row, the manager's tick completes
 * it — a second row would leave both halves unacknowledged and the weightage
 * unlockable.
 *
 * RM L2 gets ADHOC, which is the only remaining type that fits: the schema
 * allows KRA_SETTING, MID_PERIOD, FINAL_REVIEW and ADHOC, and an L2's review
 * conversation is none of the first three. MID_PERIOD would be a lie about
 * when it happened.
 */
export function autoLogFor(stage: ConfirmStage): AutoLog {
  switch (stage) {
    case 'EMPLOYEE':
      return { discussion_type: 'KRA_SETTING', manager_role: 'RM_L1',
               side: 'employee',
               discussion_points: 'Employee confirmed the KRA-setting '
                 + 'one-to-one with their reporting manager on submitting '
                 + 'their KRAs and self rating.' }
    case 'RM_L1':
      return { discussion_type: 'KRA_SETTING', manager_role: 'RM_L1',
               side: 'manager',
               discussion_points: 'Reporting manager confirmed the '
                 + 'KRA-setting one-to-one on approving the KRAs.' }
    case 'RM_L2':
      return { discussion_type: 'ADHOC', manager_role: 'RM_L2',
               side: 'manager',
               discussion_points: 'RM L2 confirmed a one-to-one with the '
                 + 'employee about these KRAs on reviewing them.' }
    case 'HOD':
      return { discussion_type: 'FINAL_REVIEW', manager_role: 'HOD',
               side: 'manager',
               discussion_points: 'HOD confirmed the final review one-to-one '
                 + 'with the employee before settling the rating.' }
  }
}

/**
 * The words beside the checkbox.
 *
 * First person, and naming the other party, because a tick that says
 * "one-to-one done" is a box somebody clears without reading. These are what
 * the person is asserting, and the assertion is the record.
 */
export const CONFIRM_LABEL: Record<ConfirmStage, string> = {
  EMPLOYEE: 'I have discussed these KRAs and weightages with my reporting manager.',
  RM_L1:    'I have held the KRA-setting one-to-one with this employee.',
  RM_L2:    'I have discussed these KRAs with this employee.',
  HOD:      'I have held the final review one-to-one with this employee.',
}

/**
 * The same assertion, short enough for a table cell.
 *
 * CONFIRM_LABEL is a full sentence because it is what the person is
 * asserting, and that belongs on a form where there is room for it. Dropped
 * into the action column of a ten-column queue it forced the table wider than
 * its container and the whole thing scrolled sideways — so the queue gets
 * three words and carries the full sentence as its title.
 *
 * The record is unaffected either way: what lands in discussion_points is
 * autoLogFor's text, not the label.
 */
export const CONFIRM_SHORT: Record<ConfirmStage, string> = {
  EMPLOYEE: 'One-to-one held',
  RM_L1:    'One-to-one held',
  RM_L2:    'Discussed with them',
  HOD:      'Final review held',
}

/** Why it cannot be skipped, for the line under the checkbox. */
export const CONFIRM_WHY: Record<ConfirmStage, string> = {
  EMPLOYEE: 'Your weightages cannot be locked until both of you confirm it, and nothing can be rated until they are locked.',
  RM_L1:    'This is what locks the weightages. Until it is ticked the KRAs stay editable and no rating means anything.',
  RM_L2:    'Recorded against your name on the appraisal.',
  HOD:      'The rating cannot be settled without it, and the result cannot be published until the employee confirms it too.',
}

export const MODES = ['IN_PERSON', 'VIDEO', 'PHONE'] as const
export type Mode = typeof MODES[number]
export const MODE_LABEL: Record<Mode, string> = {
  IN_PERSON: 'In person', VIDEO: 'Video call', PHONE: 'Phone',
}

/** One agreed weightage change, as pms_one_to_one.weightage_changes stores
 *  them. The column has carried this exact shape since 066 and nothing has
 *  ever written it — the one-to-one is where weightages are settled, so the
 *  record of what moved belongs on the log of that conversation, not inferred
 *  afterwards from the goals table. */
export interface WeightageChange {
  seq_no: number
  old_wt: number
  new_wt: number
  reason?: string | null
}

export interface Log {
  /**
   * The row's own id. Already selected by every caller and simply never
   * carried on the type, which meant a screen could display a discussion but
   * not act on a specific one — so an acknowledgement had to be addressed by
   * (employee, period, type) and would hit every row of that type at once.
   */
  id?: string
  discussion_type: DiscussionType
  discussion_date?: string | null
  mode?: Mode | null
  /** Minutes. pms_one_to_one.duration_minutes, unused until now. A
   *  "discussion" of four minutes and one of ninety are different events, and
   *  the column exists so the difference is on the record. */
  duration_minutes?: number | null
  discussion_points?: string | null
  weightage_changes?: WeightageChange[] | null
  employee_ack?: boolean | null
  manager_ack?: boolean | null
}

export type AckState = 'both' | 'employee_only' | 'manager_only' | 'neither'

export function ackState(l: Log): AckState {
  const e = !!l.employee_ack, m = !!l.manager_ack
  return e && m ? 'both' : e ? 'employee_only' : m ? 'manager_only' : 'neither'
}

/** Who still has to acknowledge, phrased for whoever is looking at the row. */
export function waitingOn(l: Log): string | null {
  switch (ackState(l)) {
    case 'both':          return null
    case 'employee_only': return 'Waiting on the manager to acknowledge'
    case 'manager_only':  return 'Waiting on the employee to acknowledge'
    case 'neither':       return 'Neither side has acknowledged this yet'
  }
}

export interface Gate {
  open: boolean
  /** Why it is shut, in words the person in front of it can act on. */
  because: string
}

function gateOn(logs: Log[], type: DiscussionType, whatItUnblocks: string): Gate {
  const of = logs.filter(l => l.discussion_type === type)
  if (of.length === 0) {
    return { open: false, because:
      `No ${TYPE_LABEL[type].toLowerCase()} discussion has been logged. ${whatItUnblocks}` }
  }
  const done = of.find(l => ackState(l) === 'both')
  if (done) return { open: true, because: '' }
  // There is a log, but it is not acknowledged by both — say which side.
  const nearest = of[of.length - 1]
  return { open: false, because:
    `${waitingOn(nearest)}. ${whatItUnblocks}` }
}

/**
 * RULE 5 — weightage locks only after the KRA-setting one-to-one is
 * acknowledged by both sides.
 */
export function canLockWeightage(logs: Log[]): Gate {
  return gateOn(logs, 'KRA_SETTING',
    'Weightages stay editable until it is, because locking them is what makes them the thing the rating is measured against.')
}

/**
 * RULE 8 — the result publishes only after the final-review one-to-one is
 * acknowledged by both sides.
 */
export function canPublishResult(logs: Log[]): Gate {
  return gateOn(logs, 'FINAL_REVIEW',
    'A rating that reaches somebody before the conversation does is how an appraisal turns into a grievance.')
}

/** The rows §3.3's table shows: every logged discussion, plus a placeholder
 *  for a mandatory type that has not happened, so its absence is visible
 *  rather than merely not-listed. */
export function logRows(logs: Log[]): (Log & { placeholder?: boolean })[] {
  const rows: (Log & { placeholder?: boolean })[] = [...logs].sort(
    (a, b) => (a.discussion_date ?? '').localeCompare(b.discussion_date ?? ''))
  for (const t of ['KRA_SETTING', 'FINAL_REVIEW'] as DiscussionType[]) {
    if (!logs.some(l => l.discussion_type === t)) {
      rows.push({ discussion_type: t, placeholder: true })
    }
  }
  return rows
}
