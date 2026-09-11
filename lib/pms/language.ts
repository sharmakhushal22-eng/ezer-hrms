// lib/pms/language.ts — say it the way a person would say it.
//
// The module generates period names like "Q3 2026-27". That is a code, not a
// name: it asks the reader to know that the financial year starts in April,
// that Q3 is therefore October to December, and that "2026-27" is one year
// written as two. Most people cannot decode it, and the ones who can still
// have to stop and do it.
//
// Everything here converts the stored value into the sentence somebody would
// actually speak. The stored code is never thrown away — it is kept as a
// quiet secondary label, because HR teams do use it and reports are filed
// under it. It just stops being the primary thing on the screen.

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL'

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** yyyy-mm-dd -> [year, monthIndex, day]. Null for anything unparseable, so a
 *  bad date degrades to the stored code rather than printing "NaN". */
function parts(iso: string | null | undefined): [number, number, number] | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const mo = Number(m[2]) - 1
  if (mo < 0 || mo > 11) return null
  return [Number(m[1]), mo, Number(m[3])]
}

/**
 * How often this happens, said plainly.
 * "Every three months" beats "QUARTERLY" for the same reason "Q3" fails:
 * one is a category, the other is a fact about the reader's calendar.
 */
export function frequencyPhrase(f: Frequency | string | null | undefined): string {
  switch (f) {
    case 'MONTHLY':     return 'Every month'
    case 'QUARTERLY':   return 'Every three months'
    case 'HALF_YEARLY': return 'Twice a year'
    case 'ANNUAL':      return 'Once a year'
    default:            return 'Review cycle'
  }
}

/** The noun for one instalment of it: "this quarter", "this month". */
export function periodNoun(f: Frequency | string | null | undefined): string {
  switch (f) {
    case 'MONTHLY':     return 'month'
    case 'QUARTERLY':   return 'quarter'
    case 'HALF_YEARLY': return 'half-year'
    case 'ANNUAL':      return 'year'
    default:            return 'period'
  }
}

/**
 * The headline label: the months this period covers, in words.
 *
 *   Oct–Dec 2026            -> "October to December 2026"
 *   Jan–Mar 2027            -> "January to March 2027"
 *   Dec 2026 – Feb 2027     -> "December 2026 to February 2027"
 *   a single month          -> "November 2026"
 *
 * The year is printed once when both ends share it, twice when they do not —
 * which is the only time a reader needs telling that the period crosses a
 * new year, and exactly when the financial-year code is most confusing.
 */
export function periodSpan(startISO?: string | null, endISO?: string | null): string {
  const a = parts(startISO), b = parts(endISO)
  if (!a) return ''
  if (!b) return `${MONTHS[a[1]]} ${a[0]}`
  if (a[0] === b[0] && a[1] === b[1]) return `${MONTHS[a[1]]} ${a[0]}`
  if (a[0] === b[0]) return `${MONTHS[a[1]]} to ${MONTHS[b[1]]} ${a[0]}`
  return `${MONTHS[a[1]]} ${a[0]} to ${MONTHS[b[1]]} ${b[0]}`
}

/** The same thing with room to spare: "Oct – Dec 2026". */
export function periodSpanShort(startISO?: string | null, endISO?: string | null): string {
  const a = parts(startISO), b = parts(endISO)
  if (!a) return ''
  if (!b) return `${SHORT[a[1]]} ${a[0]}`
  if (a[0] === b[0] && a[1] === b[1]) return `${SHORT[a[1]]} ${a[0]}`
  if (a[0] === b[0]) return `${SHORT[a[1]]} – ${SHORT[b[1]]} ${a[0]}`
  return `${SHORT[a[1]]} ${a[0]} – ${SHORT[b[1]]} ${b[0]}`
}

/**
 * Where this period sits relative to today, in the words people use.
 * "This quarter" tells somebody more than any label containing a Q, and it
 * is the first thing they want to know.
 */
export function whenPhrase(
  startISO: string | null | undefined, endISO: string | null | undefined,
  today: string, f?: Frequency | string | null,
): string {
  const noun = periodNoun(f)
  if (!startISO || !endISO) return ''
  if (today >= startISO && today <= endISO) return `This ${noun}`
  if (today < startISO) return `Next ${noun}`
  return `Last ${noun}`
}

/**
 * "3rd of 4 this year" — position without arithmetic.
 * Ordinals are spelled out rather than left as "3/4", which reads as a score.
 */
export function positionPhrase(no?: number | null, outOf?: number | null): string {
  if (!no || !outOf || no < 1 || outOf < 1) return ''
  const s = ['th','st','nd','rd'][(no % 100 > 10 && no % 100 < 14) ? 0 : Math.min(no % 10, 4) % 4] || 'th'
  return `${no}${s} of ${outOf} this year`
}

export interface PeriodNaming {
  /** What the screen leads with. */
  title: string
  /** The one-line orientation under it. */
  sub: string
  /** The stored code, kept for HR and for reports. Small and quiet. */
  code: string
}

/**
 * The whole naming decision in one place, so no screen has to make it twice
 * and none of them can drift into printing "Q3" as a heading again.
 */
export function nameThePeriod(p: {
  periodName?: string | null
  periodCode?: string | null
  financialYear?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  periodNo?: number | null
  totalPeriods?: number | null
  frequency?: Frequency | string | null
}, today: string): PeriodNaming {
  const span = periodSpan(p.periodStart, p.periodEnd)
  const when = whenPhrase(p.periodStart, p.periodEnd, today, p.frequency)
  const pos = positionPhrase(p.periodNo, p.totalPeriods)

  // Dates are the truth. Only when they are missing does the stored code get
  // to be the title, and then it is the best we have rather than a choice.
  const title = span || p.periodName || p.periodCode || 'Review period'
  const sub = [when, frequencyPhrase(p.frequency).toLowerCase(), pos]
    .filter(Boolean).join(' · ')

  const code = [p.periodCode, p.financialYear].filter(Boolean).join(' · ')
  return { title, sub, code }
}
