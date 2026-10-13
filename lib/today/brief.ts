// lib/today/brief.ts — the sentences the hero's one-line brief is built from.
//
// Pure, so the wording is unit-tested rather than eyeballed. The brief is the
// one place on the Home screen that speaks in prose, and prose can be wrong in
// ways a number cannot: "and -13.5 days of leave in the bank" is a grammatical
// sentence stating something impossible.

/**
 * The leave half of the brief.
 *
 * WHY A NEGATIVE TOTAL IS POSSIBLE. ess_today computes the balance as
 *     sum(accrued - used)
 * over EVERY leave type (migration 111). Leave Without Pay accrues nothing, so
 * a person who has taken 16 days of it contributes -16 to that sum and the
 * "balance" goes negative — this employee shows -13.5 against +2.5 of real
 * accrued leave. That total is wrong at source and fixing it belongs in the
 * leave figures, not here.
 *
 * What belongs here is not repeating it as a fact. A negative balance says
 * nothing a one-line greeting can explain, so the clause is dropped and the
 * Leave tab is left to show the detail. Saying nothing is the honest option;
 * saying "-13.5 days in the bank" is not.
 */
export function leaveClause(total: number | null | undefined): string | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null
  if (total < 0) return null
  if (total === 0) return 'no leave left in the bank'
  // 12.5 reads better than 12.50, and 12 better than 12.0.
  const n = Number.isInteger(total) ? String(total) : String(Math.round(total * 10) / 10)
  return `${n} ${total === 1 ? 'day' : 'days'} of leave in the bank`
}

/**
 * The team half.
 *
 * "0 of your team are in office today" is correct and reads like a form. When
 * nobody is in, say so in words; when somebody is, the count is what matters.
 */
export function teamClause(inOffice: number, total: number): string | null {
  if (!Number.isFinite(inOffice) || !Number.isFinite(total) || total <= 0) return null
  if (inOffice <= 0) return 'Nobody from your team is in today.'
  if (inOffice === total) return total === 1 ? 'Your one teammate is in today.' : 'All of your team are in today.'
  return `${inOffice} of your team ${inOffice === 1 ? 'is' : 'are'} in office today.`
}

/** The pending half: what is waiting on you. */
export function pendingClause(pending: number): string {
  if (pending <= 0) return 'Nothing is waiting on you'
  return `You have ${pending} ${pending === 1 ? 'thing' : 'things'} waiting on you`
}
