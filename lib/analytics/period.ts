// lib/analytics/period.ts — the calendar every analytics figure is measured on.
//
// Pure: no database, no React. Dates are ISO strings ('YYYY-MM-DD') and months
// are 'YYYY-MM' throughout, because that is what the tables hold and string
// comparison of ISO dates is both correct and fast. Nothing here touches the
// local time zone except istToday(), which pins "today" to India.
//
// India's financial year runs April → March, so "FY to date" and "Last FY" are
// April-anchored, the way every HR and finance team in the country reads them.

export type PeriodKey = 'this_month' | 'last_month' | 'last_3' | 'last_6' | 'last_12' | 'fytd' | 'last_fy'

export interface Period {
  key: PeriodKey
  label: string
  /** First day, inclusive. */
  from: string
  /** Last day, inclusive. Never later than today. */
  to: string
  /** Every month the period touches, oldest first. */
  months: string[]
}

export const PERIOD_KEYS: PeriodKey[] = ['this_month', 'last_month', 'last_3', 'last_6', 'last_12', 'fytd', 'last_fy']

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3: 'Last 3 months',
  last_6: 'Last 6 months',
  last_12: 'Last 12 months',
  fytd: 'FY to date',
  last_fy: 'Last FY',
}

export const isPeriodKey = (s: unknown): s is PeriodKey => typeof s === 'string' && (PERIOD_KEYS as string[]).includes(s)

const DAY = 86_400_000

/** Today's date in India (attendance_date and every DOJ are IST calendar days). */
export function istToday(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10)
}

export const monthOf = (day: string): string => day.slice(0, 7)

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export const monthStart = (ym: string): string => `${ym}-01`

export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = []
  for (let m = fromYm; m <= toYm; m = addMonths(m, 1)) out.push(m)
  return out
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(from + 'T00:00:00Z'), end = Date.parse(to + 'T00:00:00Z'); t <= end; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** 0 = Sunday … 6 = Saturday, for an ISO day. */
export const weekday = (day: string): number => new Date(day + 'T00:00:00Z').getUTCDay()

/** The April of the financial year a day falls in: 2026-11-12 → 2026, 2027-02-01 → 2026. */
export function fyStartYear(day: string): number {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7))
  return m >= 4 ? y : y - 1
}

/** '2026-27' for any day in Apr 2026 … Mar 2027. */
export function fyLabel(day: string): string {
  const y = fyStartYear(day)
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** payroll_runs keeps (fy '2026-27', month 1 = April). Back to a calendar month. */
export function fiscalToMonth(fy: string, fiscalMonth: number): string | null {
  const y = Number(String(fy).slice(0, 4))
  if (!Number.isFinite(y) || !(fiscalMonth >= 1 && fiscalMonth <= 12)) return null
  return addMonths(`${y}-04`, fiscalMonth - 1)
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Nov 26' — short enough for an axis, unambiguous across a year boundary. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** 'November 2026'. */
export function monthLabelLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
}

const min = (a: string, b: string) => (a < b ? a : b)

export function resolvePeriod(key: PeriodKey, today: string): Period {
  const thisMonth = monthOf(today)
  let fromYm: string, toYm: string
  switch (key) {
    case 'this_month': fromYm = toYm = thisMonth; break
    case 'last_month': fromYm = toYm = addMonths(thisMonth, -1); break
    case 'last_3': fromYm = addMonths(thisMonth, -2); toYm = thisMonth; break
    case 'last_6': fromYm = addMonths(thisMonth, -5); toYm = thisMonth; break
    case 'last_12': fromYm = addMonths(thisMonth, -11); toYm = thisMonth; break
    case 'fytd': fromYm = `${fyStartYear(today)}-04`; toYm = thisMonth; break
    case 'last_fy': {
      const y = fyStartYear(today) - 1
      fromYm = `${y}-04`; toYm = `${y + 1}-03`; break
    }
  }
  return {
    key, label: PERIOD_LABEL[key],
    from: monthStart(fromYm), to: min(monthEnd(toYm), today),
    months: monthsBetween(fromYm, toYm),
  }
}

/** The same number of months immediately before — what a delta is measured against. */
export function previousPeriod(p: Period): Period {
  const n = p.months.length
  const fromYm = addMonths(p.months[0], -n), toYm = addMonths(p.months[0], -1)
  // A partial current month compares with the same number of days in the month before,
  // so "this month so far" is not set against a whole month and read as a collapse.
  const partial = p.to < monthEnd(p.months[n - 1])
  let to = monthEnd(toYm)
  if (partial) {
    const elapsed = daysBetween(monthStart(p.months[n - 1]), p.to)
    const cand = addDays(monthStart(toYm), elapsed)
    to = min(cand, monthEnd(toYm))
  }
  return { key: p.key, label: `Previous ${n === 1 ? 'month' : `${n} months`}`, from: monthStart(fromYm), to, months: monthsBetween(fromYm, toYm) }
}

/** The fraction of a year a period spans, for annualising a rate. */
export function yearFraction(p: Pick<Period, 'from' | 'to'>): number {
  return Math.max(1, daysBetween(p.from, p.to) + 1) / 365.25
}
