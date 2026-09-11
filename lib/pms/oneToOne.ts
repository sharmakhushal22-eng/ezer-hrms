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

export const MODES = ['IN_PERSON', 'VIDEO', 'PHONE'] as const
export type Mode = typeof MODES[number]
export const MODE_LABEL: Record<Mode, string> = {
  IN_PERSON: 'In person', VIDEO: 'Video call', PHONE: 'Phone',
}

export interface Log {
  discussion_type: DiscussionType
  discussion_date?: string | null
  mode?: Mode | null
  discussion_points?: string | null
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
