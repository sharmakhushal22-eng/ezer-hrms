// lib/pms/pip.ts — the PIP state machine. Spec §7.
//
// THE RULE THAT DEFINES THIS FLOW: an RM cannot start a PIP. They raise a
// request; the HR Manager initiates it.
//
// The reason is legal, not procedural. A PIP is the documentation trail. If a
// separation ever happens on performance grounds, this is the record that
// answers a claim under the Industrial Disputes Act — documented targets,
// documented reviews, documented employee acknowledgement, all three. HR
// gatekeeping is what keeps that trail consistent enough to rely on.
//
// So `canTransition` refuses an RM-initiated PIP at the model level, not just
// by hiding a button.

export type PipStatus =
  | 'PENDING_HR'     // RM raised it, waiting on HR
  | 'SENT_BACK'      // HR returned it to the RM
  | 'REJECTED'       // HR declined it
  | 'INITIATED'      // HR started it; employee not yet acknowledged
  | 'ACKNOWLEDGED'   // employee has seen and accepted it
  | 'IN_REVIEW'      // periodic reviews under way
  | 'CLOSED'

export type PipOutcome = 'IMPROVED' | 'EXTENDED' | 'SEPARATION_REVIEW'

export type Actor = 'RM' | 'HR' | 'EMPLOYEE'

export interface Pip {
  status: PipStatus
  outcome?: PipOutcome | null
  employeeAck?: boolean
  areas?: { retained?: boolean }[]
  reviewsDone?: number
}

interface Rule { from: PipStatus[]; by: Actor[]; needs?: (p: Pip) => string | null }

/** Every legal move. Anything not listed here cannot happen. */
export const TRANSITIONS: Record<string, Rule> = {
  raise:       { from: [], by: ['RM'] },                       // creates it
  send_back:   { from: ['PENDING_HR'], by: ['HR'] },
  reject:      { from: ['PENDING_HR'], by: ['HR'] },
  resubmit:    { from: ['SENT_BACK'], by: ['RM'] },
  initiate:    { from: ['PENDING_HR'], by: ['HR'],
                 needs: p => (p.areas ?? []).some(a => a.retained !== false)
                   ? null : 'Every improvement area has been dropped. There is nothing to work on.' },
  acknowledge: { from: ['INITIATED'], by: ['EMPLOYEE'] },
  review:      { from: ['ACKNOWLEDGED', 'IN_REVIEW'], by: ['RM', 'HR'],
                 needs: p => p.employeeAck
                   ? null : 'The employee has not acknowledged this PIP yet.' },
  close:       { from: ['IN_REVIEW'], by: ['HR'],
                 needs: p => (p.reviewsDone ?? 0) > 0
                   ? null : 'Close it only after at least one review is on record.' },
}

export type Action = keyof typeof TRANSITIONS

export interface Verdict { allowed: boolean; reason?: string }

export function canTransition(p: Pip, action: Action, by: Actor): Verdict {
  const rule = TRANSITIONS[action]
  if (!rule) return { allowed: false, reason: 'That is not something this flow does.' }

  if (!rule.by.includes(by)) {
    // The message names WHO can, because "not permitted" leaves somebody
    // guessing whether to ask HR or their manager.
    if (action === 'initiate' && by === 'RM') {
      return { allowed: false,
        reason: 'A manager can raise a PIP request but cannot start one. HR initiates it, '
              + 'so the documentation stays consistent enough to rely on later.' }
    }
    return { allowed: false, reason: `Only ${rule.by.join(' or ')} can do that.` }
  }

  if (rule.from.length && !rule.from.includes(p.status)) {
    return { allowed: false, reason: `Not possible while this PIP is ${STATUS_LABEL[p.status]}.` }
  }
  const blocked = rule.needs?.(p)
  if (blocked) return { allowed: false, reason: blocked }
  return { allowed: true }
}

/** Where the action lands it. */
export function nextStatus(action: Action, p: Pip): PipStatus {
  switch (action) {
    case 'raise':       return 'PENDING_HR'
    case 'resubmit':    return 'PENDING_HR'
    case 'send_back':   return 'SENT_BACK'
    case 'reject':      return 'REJECTED'
    case 'initiate':    return 'INITIATED'
    case 'acknowledge': return 'ACKNOWLEDGED'
    case 'review':      return 'IN_REVIEW'
    case 'close':       return 'CLOSED'
    default:            return p.status
  }
}

export const STATUS_LABEL: Record<PipStatus, string> = {
  PENDING_HR: 'waiting with HR',
  SENT_BACK: 'sent back to the manager',
  REJECTED: 'declined',
  INITIATED: 'started, waiting on the employee',
  ACKNOWLEDGED: 'acknowledged',
  IN_REVIEW: 'under review',
  CLOSED: 'closed',
}

/**
 * ONE PIP, AS THE DATABASE HOLDS IT.
 *
 * The shape pms_pip actually has — 055. Snake-cased because this is what
 * PostgREST returns, and translating at the edge is what lets the engine
 * above stay about the lifecycle rather than about column names.
 */
export interface PipRowDb {
  id?: string
  employee_id?: string
  requested_by?: string | null
  requested_by_role?: string | null
  requested_at?: string | null
  trigger_rating?: number | string | null
  request_reason?: string | null
  proposed_start?: string | null
  proposed_end?: string | null
  hr_status?: string | null
  status?: string | null
  employee_ack?: boolean | null
  final_outcome?: string | null
  /** Counted from pms_pip_reviews, which this row does not carry itself. */
  reviewsDone?: number
  areas?: { retained?: boolean }[]
}

/**
 * THE DATABASE KEEPS THREE FLAGS; THE LIFECYCLE HAS ONE STATE.
 *
 * pms_pip records hr_status, status and employee_ack separately, and no one
 * of them is the lifecycle: a row can read hr_status = 'INITIATED' and
 * status = 'ACTIVE' while the employee has not acknowledged it, which the
 * engine calls INITIATED, not ACKNOWLEDGED. So the state is DERIVED, in one
 * place, and every screen asks this rather than each inventing its own
 * reading of the three columns.
 *
 * ORDER IS THE WHOLE FUNCTION. Finished beats everything — a closed PIP is
 * closed whatever employee_ack says — then HR's verdict, then the
 * employee's, then the review trail. Reading them in any other order makes
 * a settled PIP look live, which is the mistake that matters: it would put
 * somebody back in an "active PIPs" count months after it ended.
 */
export function pipFromRow(r: PipRowDb): Pip {
  const hr = (r.hr_status ?? 'PENDING_HR').toUpperCase()
  const st = (r.status ?? 'REQUESTED').toUpperCase()
  const outcome = (r.final_outcome ?? null) as PipOutcome | 'PENDING' | null
  const reviewsDone = r.reviewsDone ?? 0
  const areas = r.areas ?? []
  const base = {
    outcome: outcome && outcome !== 'PENDING' ? outcome : null,
    employeeAck: r.employee_ack === true,
    reviewsDone, areas,
  }

  // FINISHED FIRST.
  //
  // CANCELLED is folded into CLOSED deliberately. PipStatus has no cancelled
  // state, and the two honest options were to add one or to pick the
  // nearest. It is read as CLOSED because the only thing a wrong answer here
  // can do is show a withdrawn PIP as live — and a cancelled PIP is over, so
  // "closed" is wrong only about why, while "active" would be wrong about
  // whether. If cancelled ever needs its own handling, it needs its own
  // status, not a looser reading of this one.
  if (st === 'CLOSED' || st === 'CANCELLED') return { ...base, status: 'CLOSED' }

  // HR'S VERDICT. Both of these end or pause the request regardless of
  // anything else on the row.
  if (hr === 'REJECTED') return { ...base, status: 'REJECTED' }
  if (hr === 'SENT_BACK') return { ...base, status: 'SENT_BACK' }
  if (hr !== 'INITIATED') return { ...base, status: 'PENDING_HR' }

  // HR has started it. Now the employee, then the reviews.
  if (!base.employeeAck) return { ...base, status: 'INITIATED' }
  if (st === 'UNDER_REVIEW' || reviewsDone > 0) return { ...base, status: 'IN_REVIEW' }
  return { ...base, status: 'ACKNOWLEDGED' }
}

/** What each side should do next. An inbox row is useless without it. */
export function whatNext(p: Pip): { who: Actor | null; what: string } {
  switch (p.status) {
    case 'PENDING_HR':   return { who: 'HR', what: 'Review the request, then initiate, send it back or decline it.' }
    case 'SENT_BACK':    return { who: 'RM', what: 'Adjust what HR flagged and send it again.' }
    case 'INITIATED':    return { who: 'EMPLOYEE', what: 'Read the plan and acknowledge it.' }
    case 'ACKNOWLEDGED': return { who: 'RM', what: 'Start the periodic reviews.' }
    case 'IN_REVIEW':    return { who: 'RM', what: 'Record the next review, or ask HR to close it.' }
    case 'REJECTED':     return { who: null, what: 'Declined. Nothing further happens on this one.' }
    // "Closed." on its own is a dead end. Say what it means for the record,
    // because this row stays in the register and somebody will read it later.
    case 'CLOSED':       return { who: null,
      what: 'Closed. The outcome and the full review trail stay on record.' }
  }
}
