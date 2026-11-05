// lib/flexi/window.ts — the flexi claim window: the 1st to the 20th of every month, on its own.
//
// Nobody opens or closes it. Every month, bills can be submitted from the 1st to the 20th
// (IST, inclusive); from the 21st to the month's end the uploader stays on the employee's
// screen but locked, and it opens again on the 1st. Inside those days a bill is refused only
// when the employee has nothing left on that component.
//
// flexi_windows still holds one row per company per month, because a claim records the month
// it was filed in (flexi_claims.window_id) and HR's approvals and the reimbursement sync read
// that. The row is made the first time it is needed and always spans the 1st–20th.
//
// Pure, no imports: the server helper (window-server.ts), the ESS screen and the tests share it.

const IST_MS = 5.5 * 3600_000
export const OPEN_DAY = 1
export const CLOSE_DAY = 20

const istParts = (now: Date) => {
  const ist = new Date(now.getTime() + IST_MS)
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() }
}

/** The month (in IST) a claim filed at `now` belongs to, as a flexi_windows row. */
export function claimWindowFor(now: Date) {
  const { year, month } = istParts(now)
  const fyStart = month >= 4 ? year : year - 1
  return {
    year, month,
    fy: `${fyStart}-${String(fyStart + 1).slice(-2)}`,
    open_day: OPEN_DAY,
    close_day: CLOSE_DAY,
    // 00:00 IST on the 1st to 23:59:59 IST on the 20th, stored in UTC.
    opens_at: new Date(Date.UTC(year, month - 1, OPEN_DAY) - IST_MS).toISOString(),
    closes_at: new Date(Date.UTC(year, month - 1, CLOSE_DAY, 23, 59, 59) - IST_MS).toISOString(),
    status: 'OPEN' as const,
  }
}

/** Whether bills can be submitted at `now`: the 1st to the 20th of the month, IST. */
export function windowOpenAt(now: Date): boolean {
  const { day } = istParts(now)
  return day >= OPEN_DAY && day <= CLOSE_DAY
}

/** The days left in this month's window (counting today), or 0 once it has closed. */
export function windowDaysLeft(now: Date): number {
  const { day } = istParts(now)
  return windowOpenAt(now) ? CLOSE_DAY - day + 1 : 0
}

/** When the window next opens: the 1st of next month (IST), as YYYY-MM-DD. */
export function nextOpening(now: Date): string {
  const { year, month } = istParts(now)
  const y = month === 12 ? year + 1 : year, m = month === 12 ? 1 : month + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/** This month's closing day (IST), as YYYY-MM-DD. */
export function closingDay(now: Date): string {
  const { year, month } = istParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${CLOSE_DAY}`
}
