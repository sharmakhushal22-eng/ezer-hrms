// lib/te/period.ts — which expense month a claim will land in.
//
// WHY THIS EXISTS. The claim review screen tells a person what they are about
// to do, and one of the things it tells them is which month the claim goes
// into. That matters: the month decides which payroll run reimburses them and
// which month Finance closes it in. The screen used to show
//
//     snap.periods.filter(p => p.status === 'OPEN').map(p => p.label)[0]
//
// which is "whichever open month happens to be first in the list". With Jun,
// Jul, Aug, Oct and Nov all open, a trip taken on 17 October was shown as
// "Jun 2026". The claim was then filed into October correctly, because the
// database picks the month properly at submit — so the number was never wrong,
// only the promise made to the employee beforehand.
//
// MIRRORS te_period_for AND IS NOT THE AUTHORITY. The database decides, in
// te_period_for (migration 145), and te_claim_submit calls it with
// `coalesce(trip.end_date, max(expense_date))`. This file reproduces that rule
// so the review screen can say the same thing a moment earlier. The same
// arrangement as commuteChain and buildLegs: the engine decides, the screen
// previews. periodFor's tests pin it to the SQL ordering, so if one moves the
// other fails.
//
// THE RULE, in te_period_for's own order:
//   1. the OPEN month that the date falls in                     — not late
//   2. otherwise, of the OPEN months: the current month first,
//      then the earliest month after the expense's month,
//      then the earliest of what is left                         — late
//   3. no OPEN month at all: the database refuses the submit, and this returns
//      null so the screen says nothing rather than inventing a month
import type { TePeriod } from './types.ts'

/** 'YYYY-MM-DD' or 'YYYY-MM' to 'YYYY-MM'. '' for anything unparseable, which
 *  callers treat as "no opinion" rather than as a month. */
export function monthOf(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(date || '')
  return m ? `${m[1]}-${m[2]}` : ''
}

/**
 * The date te_claim_submit will pick the month from: a trip's end date, or
 * failing that the latest expense date on the claim.
 *
 * `coalesce(t.end_date, v_last)` — the trip's end date wins even when a bill is
 * dated after it, because the trip is the thing being closed.
 */
export function claimDateOf(tripEnd: string | null | undefined, expenseDates: readonly string[]): string {
  if (tripEnd) return tripEnd
  const real = expenseDates.filter(d => monthOf(d))
  if (!real.length) return ''
  return real.reduce((a, b) => (a > b ? a : b))
}

export interface PeriodChoice {
  /** The period as the snapshot carries it. */
  period: TePeriod
  /** True when the claim could not go into its own month — the thing worth
   *  saying out loud, because it is how a September bill ends up in November. */
  isLate: boolean
}

/**
 * Which open month a claim dated `date` goes into, or null when none is open.
 *
 * `today` is the company's own today (te_today), not the browser's: a company
 * can be mid-way through closing a month, and the browser's clock has no say
 * in which month that is.
 */
export function periodFor(periods: readonly TePeriod[], date: string, today: string): PeriodChoice | null {
  const open = periods.filter(p => p.status === 'OPEN')
  if (!open.length) return null

  const want = monthOf(date)
  // 1. The month the date falls in, if it is open. The ordinary case.
  const own = want ? open.find(p => monthOf(p.m) === want) : undefined
  if (own) return { period: own, isLate: false }

  // 2. te_period_for's fallback, clause for clause:
  //      order by (period_month = this month) desc,
  //               (period_month > the expense month) desc,
  //               period_month
  const now = monthOf(today)
  const rank = (p: TePeriod) => {
    const m = monthOf(p.m)
    return [m && m === now ? 0 : 1, want && m > want ? 0 : 1, m]
  }
  const sorted = [...open].sort((a, b) => {
    const x = rank(a), y = rank(b)
    return (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)
      || String(x[2]).localeCompare(String(y[2]))
  })
  return { period: sorted[0], isLate: true }
}
