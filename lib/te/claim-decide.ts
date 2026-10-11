// lib/te/claim-decide.ts — an approver's decision on a claim, line by line.
//
// This is the one screen in the module that CHANGES WHAT SOMEBODY IS PAID.
// An approver can pass a claim as it stands, cut a line to a smaller amount,
// refuse a line outright, or hand the whole thing back for the employee to
// fix. Each of those has a different consequence for the person who spent the
// money, so each is spelled out here and tested, rather than being implied by
// which button happens to be enabled.
//
// WHAT THIS FILE DOES NOT DO: decide whether a claim is acceptable. The flags,
// the risk band, the eligible amounts and the refusals all come from the
// server. What lives here is the shape of a decision and whether it is
// complete enough to send — a cut with no reason, or a send-back with nothing
// said, is not a decision, it is a mystery arriving in somebody's inbox.
import type { DecideInput, Uuid } from './types.ts'

export type DecideAction = 'approve' | 'verify' | 'hold' | 'sendback' | 'reject'

/**
 * Which verbs belong at this stage.
 *
 * A manager and Finance are asking different questions of the same claim —
 * should this have happened, versus is what is claimed for it right — so they
 * are offered different answers. "Hold" exists only for Finance: it parks a
 * claim for an audit without handing it back to the employee, which a manager
 * has no use for.
 */
export function actionsForStage(stage: 'manager' | 'finance' | null): { action: DecideAction; label: string }[] {
  if (stage === 'finance') {
    return [
      { action: 'verify', label: 'Verify' },
      { action: 'hold', label: 'Hold' },
      { action: 'sendback', label: 'Send back' },
      { action: 'reject', label: 'Reject' },
    ]
  }
  return [
    { action: 'approve', label: 'Approve' },
    { action: 'sendback', label: 'Send back' },
    { action: 'reject', label: 'Reject' },
  ]
}

/** The verbs that pass a claim onward rather than stopping or returning it. */
const PASSES = new Set<DecideAction>(['approve', 'verify'])

/** What an approver has done to one line. */
export interface LineDecision {
  /** Pay less than was claimed. Undefined means pay it as it stands. */
  amount?: number
  /** Refuse it: 'final' cannot be claimed again, 'refile' can. */
  reject?: 'final' | 'refile'
  reason?: string
}

export interface DecisionDraft {
  comment: string
  /** line id → what was done to it. Lines not in here are passed as claimed. */
  lines: Record<Uuid, LineDecision>
  /** Lines the employee is asked to correct, on a send-back. */
  fix: Uuid[]
}

export const emptyDecision = (): DecisionDraft => ({ comment: '', lines: {}, fix: [] })

/** Has anything actually been done to this line? */
export function isTouched(d: LineDecision | undefined): boolean {
  return !!d && (d.amount !== undefined || !!d.reject)
}

/**
 * What the claim comes to once the approver's changes are applied.
 *
 * A rejected line is worth nothing. A cut line is worth what the approver
 * said. Everything else is worth what the server found eligible — NOT what
 * was claimed, because the policy limits have already been applied and the
 * approver is deciding on top of that.
 */
export function decidedTotal(
  lines: { id: Uuid; eligible: number }[],
  decisions: Record<Uuid, LineDecision>,
): { total: number; cut: number; rejected: number } {
  let total = 0
  let cut = 0
  let rejected = 0
  for (const line of lines) {
    const d = decisions[line.id]
    if (d?.reject) { rejected += line.eligible; continue }
    if (d?.amount !== undefined) {
      const amount = Math.max(0, d.amount)
      total += amount
      cut += Math.max(0, line.eligible - amount)
      continue
    }
    total += line.eligible
  }
  return { total: round(total), cut: round(cut), rejected: round(rejected) }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Why this decision cannot be sent yet, in the words the approver sees.
 * '' means it can.
 *
 * Every rule here exists because of what the employee receives. A claim cut
 * without a reason, or returned with no comment, tells them a number changed
 * and nothing about why — and they have to guess what to do next.
 */
export function whyNotReady(
  action: DecideAction,
  draft: DecisionDraft,
  lines: { id: Uuid; eligible: number }[],
): string {
  const touched = Object.entries(draft.lines).filter(([, d]) => isTouched(d))

  // Screen 95: a send-back with nothing said is the commonest way to waste
  // somebody's afternoon.
  if (action === 'sendback' && !draft.comment.trim()) {
    return 'Say what needs fixing. The employee sees this and nothing else.'
  }
  if (action === 'reject' && !draft.comment.trim()) {
    return 'A rejected claim needs a reason.'
  }
  // A claim parked for an audit with no note is a claim nobody can pick up
  // later and understand.
  if (action === 'hold' && !draft.comment.trim()) {
    return 'Say why it is on hold, so whoever picks it up knows.'
  }

  for (const [id, d] of touched) {
    const line = lines.find(l => l.id === id)
    if (!d.reason?.trim()) {
      return d.reject ? 'Say why the line is refused.' : 'Say why the amount was changed.'
    }
    if (d.amount !== undefined) {
      if (!Number.isFinite(d.amount) || d.amount < 0) return 'An approved amount cannot be negative.'
      // Approving MORE than the policy allows is not an approver's gift to
      // give; the limit was applied before they saw it.
      if (line && d.amount > line.eligible) return `A line cannot be approved above its eligible amount of ${line.eligible}.`
    }
  }

  // A send-back that marks no line and changes nothing is just a comment; the
  // employee has nothing to act on.
  if (action === 'sendback' && !draft.fix.length && !touched.length) {
    return 'Mark at least one line to fix, so the employee knows where to look.'
  }
  return ''
}

/** The decision, in the shape the API takes. Untouched lines are left out
 *  entirely rather than sent as no-ops. */
export function toDecideInput(action: DecideAction, draft: DecisionDraft): DecideInput {
  const decisions: NonNullable<DecideInput['decisions']> = {}
  for (const [id, d] of Object.entries(draft.lines)) {
    if (!isTouched(d)) continue
    decisions[id] = {
      ...(d.amount !== undefined ? { amount: d.amount } : {}),
      ...(d.reject ? { reject: d.reject } : {}),
      ...(d.reason?.trim() ? { reason: d.reason.trim() } : {}),
    }
  }
  return {
    ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
    ...(Object.keys(decisions).length ? { decisions } : {}),
    ...(action === 'sendback' && draft.fix.length ? { fix: draft.fix } : {}),
  }
}

/** A one-line summary of what the approver is about to do, shown on the button
 *  area so the consequence is visible before the click, not after. */
export function describe(action: DecideAction, draft: DecisionDraft, lines: { id: Uuid; eligible: number }[]): string {
  const { total, cut, rejected } = decidedTotal(lines, draft.lines)
  if (action === 'reject') return 'The whole claim is refused. Nothing is paid.'
  if (action === 'hold') return 'Parked for an audit. The employee is not asked for anything yet.'
  if (action === 'sendback') {
    const marked = draft.fix.length
    return marked
      ? `Goes back to the employee with ${marked} line${marked === 1 ? '' : 's'} to fix.`
      : 'Goes back to the employee.'
  }
  if (!cut && !rejected) return PASSES.has(action) ? 'Passes as it stands.' : 'Passes as it stands.'
  const bits: string[] = []
  if (cut) bits.push(`${cut} cut`)
  if (rejected) bits.push(`${rejected} refused`)
  return `${action === 'verify' ? 'Verifies' : 'Approves'} ${total}, with ${bits.join(' and ')}.`
}
