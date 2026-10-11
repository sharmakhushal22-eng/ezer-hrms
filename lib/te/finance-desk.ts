// lib/te/finance-desk.ts — which action applies to what, on the Finance desks.
//
// Finance screens are lists of money in states, and nearly every bug in one is
// offering the wrong button: a refund on an advance that was never paid, a
// lock on a month that still has claims moving through it. The states come
// from the server; what lives here is which actions belong to each, and what
// each one will do — said in the words the screen shows, so the person
// clicking knows before they click.
//
// None of this grants permission. The server refuses independently; this only
// avoids offering what is going to be refused.

/** What an advance is doing. te_advances.status. */
export type AdvanceStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'PART_SETTLED' | 'SETTLED' | 'RECOVERY_DUE' | 'REJECTED' | 'CANCELLED' | string

export type AdvanceAction = 'pay' | 'reject' | 'refund' | 'payroll' | 'carry'

export interface ActionOffer<A extends string> {
  action: A
  label: string
  /** What it does, in a sentence. Shown next to the button. */
  effect: string
  /** true when it cannot be undone and should confirm first. */
  grave?: boolean
  /** true when the action needs an amount typed. */
  amount?: boolean
  /** true when the action needs a reference typed. */
  reference?: boolean
}

const ADVANCE: Record<AdvanceAction, Omit<ActionOffer<AdvanceAction>, 'action'>> = {
  pay: { label: 'Pay it', effect: 'Releases the money to the employee and starts the clock on settling it.', amount: true, reference: true },
  reject: { label: 'Refuse', effect: 'The employee does not get the advance. Their trip is unaffected.', grave: true },
  refund: { label: 'Record a refund', effect: 'The employee has paid some or all of it back.', amount: true, reference: true },
  payroll: { label: 'Recover from payroll', effect: 'What is still outstanding is handed to payroll to deduct.', grave: true },
  carry: { label: 'Carry to another trip', effect: 'Moves the outstanding balance onto the employee’s next trip instead of recovering it.' },
}

/**
 * The actions that make sense for an advance in this state.
 *
 * The shape of it: money that has not gone out can be paid or refused; money
 * that HAS gone out can only come back, by refund, by payroll, or by being
 * carried. Nothing can be done to one that is finished.
 */
export function advanceActions(status: AdvanceStatus, outstanding: number): ActionOffer<AdvanceAction>[] {
  const offer = (a: AdvanceAction): ActionOffer<AdvanceAction> => ({ action: a, ...ADVANCE[a] })
  if (status === 'REQUESTED' || status === 'APPROVED') return [offer('pay'), offer('reject')]
  if (status === 'PAID' || status === 'PART_SETTLED' || status === 'RECOVERY_DUE') {
    // Nothing is owed any more, so there is nothing to recover — even though
    // the row has not been closed off yet.
    return outstanding > 0 ? [offer('refund'), offer('payroll'), offer('carry')] : []
  }
  return []
}

/** A month of claims. te_periods.status. */
export type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED' | string

export type PeriodAction = 'close' | 'reopen' | 'roll' | 'lock'

const PERIOD: Record<PeriodAction, Omit<ActionOffer<PeriodAction>, 'action'>> = {
  close: { label: 'Close the month', effect: 'No new claim can be dated into it. Claims already in it carry on.' },
  reopen: { label: 'Reopen', effect: 'Claims can be dated into it again.' },
  roll: { label: 'Roll the stragglers forward', effect: 'Moves claims that are still moving into the next month, so this one can be locked.' },
  // The one genuinely irreversible act on these screens.
  lock: { label: 'Lock', effect: 'Nothing in this month can change again, by anybody. This cannot be undone.', grave: true },
}

/**
 * What can be done to a month.
 *
 * A locked month offers nothing: that is the point of locking it. A closed one
 * can be reopened or locked, and the stragglers rolled — the server refuses a
 * lock while claims are still moving (screen b4), which is what rolling is
 * for.
 */
export function periodActions(status: PeriodStatus): ActionOffer<PeriodAction>[] {
  const offer = (a: PeriodAction): ActionOffer<PeriodAction> => ({ action: a, ...PERIOD[a] })
  if (status === 'OPEN') return [offer('close')]
  if (status === 'CLOSED') return [offer('reopen'), offer('roll'), offer('lock')]
  return []
}

/** Which period actions must say why. Reopening a closed month and locking one
 *  both leave a mark somebody will later ask about. */
export function periodNeedsReason(action: PeriodAction): boolean {
  return action === 'reopen' || action === 'lock'
}

/** Where a payout goes. */
export const PAYOUT_ROUTES: { route: 'PAYROLL' | 'OFF_CYCLE'; label: string; effect: string }[] = [
  { route: 'PAYROLL', label: 'With payroll', effect: 'Paid with the next salary run. No bank file is needed.' },
  { route: 'OFF_CYCLE', label: 'Bank transfer now', effect: 'A bank file is generated for upload. It carries full account numbers.' },
]

/** What a batch in this state allows. */
export function batchActions(status: string): { file: boolean; paid: boolean; cancel: boolean } {
  return {
    // A file can be regenerated until the money has gone.
    file: status === 'DRAFT' || status === 'FILE_GENERATED',
    paid: status === 'DRAFT' || status === 'FILE_GENERATED',
    cancel: status === 'DRAFT' || status === 'FILE_GENERATED',
  }
}

/** A claim can only be in one batch, so anything already batched is not
 *  payable again. The list the server returns is already filtered; this is the
 *  guard for a stale page. */
export function payableTotal<T extends { net_amount: number }>(rows: T[], chosen: Set<string>, idOf: (r: T) => string): number {
  return Math.round(rows.filter(r => chosen.has(idOf(r))).reduce((a, r) => a + (r.net_amount || 0), 0) * 100) / 100
}
