// lib/analytics/metrics.ts — the arithmetic behind every analytics figure.
//
// Pure functions over plain rows. The server modules fetch; these compute; the
// tests in __tests__ pin the definitions, because an HR metric that quietly
// changes its denominator is worse than no metric at all.
//
// DEFINITIONS (stated once, used everywhere)
//
//   Headcount on day d   joined on/before d AND not exited by d (LWD > d).
//                        "Exited by d" is strict so a month's bridge balances:
//                        opening + joiners − exits = closing, to the person.
//   Attrition (period)   exits ÷ average headcount, where the average is the
//                        mean of each month's (opening + closing) ÷ 2 (SHRM).
//   Annualised           period rate ÷ the fraction of a year the period spans.
//   Early attrition      of a joining cohort old enough to have reached N days,
//                        the share who left within N days.
//   On-time rate         punched-in days with no late minutes ÷ punched-in days.
//   Bradford factor      S² × D over 52 weeks, S = unplanned spells, D = days.
//                        A pattern indicator only — never a disciplinary score.

import { addDays, daysBetween, monthEnd, monthStart, addMonths, weekday } from './period.ts'

// ── Shared shapes ──────────────────────────────────────────────────────────

export interface EmpLite {
  id: string
  code: string | null
  name: string
  company_id: string | null
  department_id: string | null
  location_id: string | null
  designation: string | null
  grade: string | null
  type: string | null
  gender: string | null
  dob: string | null
  /** company_doj (falls back to group_doj). */
  doj: string | null
  /** LWD: date_of_leaving, else last_working_date, else relieving_date. */
  exit: string | null
  status: string | null
  l1: string | null
  confirmation: string | null
  probation_months: number | null
  confirmation_date: string | null
}

export interface Bucket { key: string; label: string; value: number }

// ── Small helpers ──────────────────────────────────────────────────────────

export const round = (n: number, dp = 1): number => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** a ÷ b as a percentage, or null when there is nothing to divide by. */
export function pct(a: number, b: number, dp = 1): number | null {
  if (!b) return null
  return round((a / b) * 100, dp)
}

export function median(xs: number[]): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export function mean(xs: number[]): number | null {
  const v = xs.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Relative change, as a percentage. Null when the base is zero or missing. */
export function change(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null
  return round(((now - before) / Math.abs(before)) * 100, 1)
}

export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r) || '—'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

/** A count map as buckets, largest first, with the tail beyond `keep` folded into "Other". */
export function toBuckets(m: Map<string, number>, labelOf: (k: string) => string = k => k, keep = 8): Bucket[] {
  const all = [...m.entries()].map(([key, value]) => ({ key, label: labelOf(key), value })).sort((a, b) => b.value - a.value)
  if (all.length <= keep) return all
  const head = all.slice(0, keep - 1)
  const rest = all.slice(keep - 1).reduce((a, b) => a + b.value, 0)
  return [...head, { key: '__other', label: 'Other', value: rest }]
}

// ── Workforce ──────────────────────────────────────────────────────────────

/** Someone whose status says they left but who has no LWD on record cannot be placed
 *  on a timeline. They are left out of history rather than guessed at. */
export const unplaceable = (e: EmpLite): boolean =>
  !e.doj || (!e.exit && !!e.status && e.status.toLowerCase() !== 'active' && e.status.toLowerCase() !== 'sabbatical')

/** On the books at the end of `day`. */
export function onBooks(e: EmpLite, day: string): boolean {
  if (unplaceable(e)) return false
  return (e.doj as string) <= day && (!e.exit || e.exit > day)
}

export function headcountOn(emps: EmpLite[], day: string): number {
  let n = 0
  for (const e of emps) if (onBooks(e, day)) n++
  return n
}

export function joinedIn(emps: EmpLite[], from: string, to: string): EmpLite[] {
  return emps.filter(e => !unplaceable(e) && (e.doj as string) >= from && (e.doj as string) <= to)
}

export function exitedIn(emps: EmpLite[], from: string, to: string): EmpLite[] {
  return emps.filter(e => !unplaceable(e) && !!e.exit && e.exit >= from && e.exit <= to)
}

export interface MonthFlow {
  month: string
  opening: number
  joiners: number
  exits: number
  closing: number
  /** exits ÷ ((opening + closing) ÷ 2), percent. */
  attrition: number | null
}

export function monthlyFlow(emps: EmpLite[], months: string[], today: string): MonthFlow[] {
  return months.map(m => {
    const start = monthStart(m)
    const end = monthEnd(m) < today ? monthEnd(m) : today
    const opening = headcountOn(emps, addDays(start, -1))
    const joiners = joinedIn(emps, start, end).length
    const exits = exitedIn(emps, start, end).length
    const closing = headcountOn(emps, end)
    const avg = (opening + closing) / 2
    return { month: m, opening, joiners, exits, closing, attrition: avg ? round((exits / avg) * 100, 2) : null }
  })
}

/** Exits over the period ÷ the mean monthly average headcount, as a percentage. */
export function periodAttrition(flows: MonthFlow[]): { exits: number; avgHeadcount: number; rate: number | null } {
  const exits = flows.reduce((a, f) => a + f.exits, 0)
  const avgs = flows.map(f => (f.opening + f.closing) / 2)
  const avgHeadcount = mean(avgs) ?? 0
  return { exits, avgHeadcount: round(avgHeadcount, 1), rate: avgHeadcount ? round((exits / avgHeadcount) * 100, 2) : null }
}

export function annualise(rate: number | null, yearFraction: number): number | null {
  if (rate == null || !yearFraction) return null
  return round(rate / yearFraction, 1)
}

export function tenureYears(doj: string, asOf: string): number {
  return Math.max(0, daysBetween(doj, asOf) / 365.25)
}

export const TENURE_BANDS: { key: string; label: string; maxYears: number }[] = [
  { key: 't0', label: 'Under 6 months', maxYears: 0.5 },
  { key: 't1', label: '6–12 months', maxYears: 1 },
  { key: 't2', label: '1–2 years', maxYears: 2 },
  { key: 't3', label: '2–5 years', maxYears: 5 },
  { key: 't4', label: '5–10 years', maxYears: 10 },
  { key: 't5', label: '10+ years', maxYears: Infinity },
]

export function tenureBand(years: number): string {
  return (TENURE_BANDS.find(b => years < b.maxYears) || TENURE_BANDS[TENURE_BANDS.length - 1]).key
}

export const AGE_BANDS: { key: string; label: string; maxYears: number }[] = [
  { key: 'a0', label: 'Under 25', maxYears: 25 },
  { key: 'a1', label: '25–34', maxYears: 35 },
  { key: 'a2', label: '35–44', maxYears: 45 },
  { key: 'a3', label: '45–54', maxYears: 55 },
  { key: 'a4', label: '55+', maxYears: Infinity },
]

export function ageBand(dob: string, asOf: string): string | null {
  const yrs = daysBetween(dob, asOf) / 365.25
  if (!(yrs > 14 && yrs < 90)) return null      // a placeholder DOB is not an age
  return (AGE_BANDS.find(b => yrs < b.maxYears) || AGE_BANDS[AGE_BANDS.length - 1]).key
}

/** Everyone whose tenure lets us judge: of those who joined in [from, to] (all old enough
 *  to have reached `days`), how many left within `days` of joining. */
export function earlyAttrition(emps: EmpLite[], days: number, today: string, lookbackDays = 365): { cohort: number; left: number; rate: number | null } {
  const to = addDays(today, -days)
  const from = addDays(to, -lookbackDays)
  const cohort = emps.filter(e => !unplaceable(e) && (e.doj as string) >= from && (e.doj as string) <= to)
  const left = cohort.filter(e => !!e.exit && daysBetween(e.doj as string, e.exit) < days)
  return { cohort: cohort.length, left: left.length, rate: pct(left.length, cohort.length) }
}

export interface SpanStats {
  managers: number
  avgSpan: number | null
  medianSpan: number | null
  /** Managers with one or two reports — usually a layer worth questioning. */
  narrow: number
  /** Managers with more than twelve direct reports. */
  wide: number
  distribution: Bucket[]
}

export function spanOfControl(active: EmpLite[]): SpanStats {
  const ids = new Set(active.map(e => e.id))
  const reports = new Map<string, number>()
  for (const e of active) if (e.l1 && ids.has(e.l1) && e.l1 !== e.id) reports.set(e.l1, (reports.get(e.l1) || 0) + 1)
  const spans = [...reports.values()]
  const band = (n: number) => (n <= 2 ? '1–2' : n <= 5 ? '3–5' : n <= 8 ? '6–8' : n <= 12 ? '9–12' : '13+')
  const order = ['1–2', '3–5', '6–8', '9–12', '13+']
  const m = countBy(spans, band)
  return {
    managers: spans.length,
    avgSpan: spans.length ? round(mean(spans) as number, 1) : null,
    medianSpan: median(spans),
    narrow: spans.filter(n => n <= 2).length,
    wide: spans.filter(n => n > 12).length,
    distribution: order.map(k => ({ key: k, label: `${k} reports`, value: m.get(k) || 0 })),
  }
}

/** Probation that has run past its end without a confirmation. */
export function probationOverdue(e: EmpLite, today: string): boolean {
  if (!e.doj || (e.confirmation || '').toLowerCase() !== 'probation') return false
  if (e.exit && e.exit <= today) return false
  const months = e.probation_months ?? 6
  const due = monthsAfter(e.doj, months)
  return due < today
}

export function probationDue(e: EmpLite, today: string, withinDays: number): boolean {
  if (!e.doj || (e.confirmation || '').toLowerCase() !== 'probation') return false
  if (e.exit && e.exit <= today) return false
  const due = monthsAfter(e.doj, e.probation_months ?? 6)
  return due >= today && due <= addDays(today, withinDays)
}

function monthsAfter(day: string, n: number): string {
  const ym = addMonths(day.slice(0, 7), n)
  const d = Number(day.slice(8, 10))
  const last = Number(monthEnd(ym).slice(8, 10))
  return `${ym}-${String(Math.min(d, last)).padStart(2, '0')}`
}

// ── Attendance ─────────────────────────────────────────────────────────────

export interface AttRec {
  employee_id: string
  attendance_date: string
  work_in: string | null
  work_out: string | null
  total_minutes: number | null
  late_minutes: number | null
  overtime_minutes: number | null
  status: string | null
}

/** Minutes after midnight in India for a timestamp. */
export function istMinutes(ts: string): number {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return NaN
  const d = new Date(t + 5.5 * 3600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

export function clock(mins: number | null): string | null {
  if (mins == null || !Number.isFinite(mins)) return null
  const h = Math.floor(mins / 60), m = Math.round(mins % 60)
  const hh = ((h + 11) % 12) + 1
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export interface AttSummary {
  tracked: number
  days: number
  punchedIn: number
  late: number
  onTimeRate: number | null
  lateRate: number | null
  missPunch: number
  missPunchRate: number | null
  halfDays: number
  avgHours: number | null
  medianIn: number | null
  overtimeHours: number
}

/** Over attendance rows. A day still open today is not a miss-punch yet. */
export function summariseAttendance(recs: AttRec[], today: string): AttSummary {
  const tracked = new Set<string>()
  let punchedIn = 0, late = 0, miss = 0, half = 0, ot = 0
  const hours: number[] = [], ins: number[] = []
  for (const r of recs) {
    tracked.add(r.employee_id)
    const hasIn = !!r.work_in, hasOut = !!r.work_out
    if (hasIn) {
      punchedIn++
      if (Number(r.late_minutes || 0) > 0) late++
      const m = istMinutes(r.work_in as string)
      if (Number.isFinite(m)) ins.push(m)
    }
    if (hasIn !== hasOut && r.attendance_date < today) miss++
    if (String(r.status || '').toUpperCase() === 'HALF_DAY') half++
    if (hasIn && hasOut && Number(r.total_minutes) > 0) hours.push(Number(r.total_minutes) / 60)
    ot += Number(r.overtime_minutes || 0)
  }
  return {
    tracked: tracked.size,
    days: recs.length,
    punchedIn,
    late,
    onTimeRate: pct(punchedIn - late, punchedIn),
    lateRate: pct(late, punchedIn),
    missPunch: miss,
    missPunchRate: pct(miss, recs.length),
    halfDays: half,
    avgHours: hours.length ? round(mean(hours) as number, 1) : null,
    medianIn: median(ins),
    overtimeHours: round(ot / 60, 1),
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const weekdayName = (w: number): string => WEEKDAYS[w] ?? ''

/** Late-mark rate by weekday (Mon–Sat; Sunday only if anyone punched). */
export function lateByWeekday(recs: AttRec[]): { key: string; label: string; days: number; late: number; rate: number | null }[] {
  const d = new Array(7).fill(0), l = new Array(7).fill(0)
  for (const r of recs) {
    if (!r.work_in) continue
    const w = weekday(r.attendance_date)
    d[w]++
    if (Number(r.late_minutes || 0) > 0) l[w]++
  }
  const order = [1, 2, 3, 4, 5, 6, 0].filter(w => w !== 0 || d[0] > 0)
  return order.map(w => ({ key: String(w), label: WEEKDAYS[w], days: d[w], late: l[w], rate: pct(l[w], d[w]) }))
}

// ── Leave ──────────────────────────────────────────────────────────────────

export interface LeaveApp {
  employee_id: string
  type: string        // short_name, e.g. 'SL'
  from_date: string
  to_date: string
  days: number
  half_day: boolean
  status: string
  applied_at: string | null
  resolved_at: string | null
}

/** Leave that is usually taken at short notice. Annual / privilege leave, maternity,
 *  sabbatical and the like are planned by nature. */
export const UNPLANNED_TYPES = new Set(['SL', 'CL', 'LWP', 'AB'])

/** A spell is unplanned when it is a sick/casual-type leave, or was applied for on or
 *  after its first day. */
export function isUnplanned(a: LeaveApp): boolean {
  if (UNPLANNED_TYPES.has(a.type.toUpperCase())) return true
  return !!a.applied_at && a.applied_at.slice(0, 10) >= a.from_date
}

/** The share of a leave's days that fall inside [from, to], pro rata by calendar days. */
export function daysWithin(a: LeaveApp, from: string, to: string): number {
  const s = a.from_date > from ? a.from_date : from
  const e = a.to_date < to ? a.to_date : to
  if (s > e) return 0
  const span = daysBetween(a.from_date, a.to_date) + 1
  const overlap = daysBetween(s, e) + 1
  const days = Number(a.days) || (a.half_day ? 0.5 : span)
  return round((days * overlap) / span, 2)
}

/** Short spells (≤ 2 days) that touch a Monday or a Friday — the long-weekend pattern. */
export function bridgeShare(apps: LeaveApp[]): { spells: number; bridging: number; share: number | null } {
  const short = apps.filter(a => (Number(a.days) || 1) <= 2)
  const bridging = short.filter(a => weekday(a.from_date) === 1 || weekday(a.to_date) === 5 || weekday(a.from_date) === 5 || weekday(a.to_date) === 1)
  return { spells: short.length, bridging: bridging.length, share: pct(bridging.length, short.length) }
}

export function bradford(apps: LeaveApp[]): { spells: number; days: number; score: number } {
  const un = apps.filter(isUnplanned)
  const spells = un.length
  const days = round(un.reduce((s, a) => s + (Number(a.days) || 0), 0), 1)
  return { spells, days, score: Math.round(spells * spells * days) }
}

// ── Performance ────────────────────────────────────────────────────────────

/** Rating codes top to bottom, and their 1–5 value. */
export const RATING_ORDER = ['O', 'EE', 'ME', 'NI', 'U'] as const
export const RATING_VALUE: Record<string, number> = { O: 5, EE: 4, ME: 3, NI: 2, U: 1 }
export const RATING_LABEL: Record<string, string> = {
  O: 'Outstanding', EE: 'Exceeds', ME: 'Meets', NI: 'Needs improvement', U: 'Unsatisfactory',
}
/** A common calibration guideline, shown as a reference line — never enforced. */
export const REFERENCE_CURVE: Record<string, number> = { O: 10, EE: 20, ME: 40, NI: 20, U: 10 }

/** Workflow statuses grouped into the five stages a person reads. */
export function pmsStage(status: string | null | undefined): 'not_started' | 'goals' | 'self' | 'manager' | 'final' | 'published' {
  const s = String(status || '').toUpperCase()
  if (s === 'PUBLISHED' || s === 'ACKNOWLEDGED') return 'published'
  if (s === 'FINALISED') return 'final'
  if (s === 'RM_L1_DONE' || s === 'RM_L2_DONE') return 'manager'
  if (s === 'SELF_DRAFT' || s === 'SELF_SUBMITTED') return 'self'
  if (s === 'KRA_DRAFT' || s === 'KRA_LOCKED') return 'goals'
  return 'not_started'
}

export const PMS_STAGES: { key: ReturnType<typeof pmsStage>; label: string }[] = [
  { key: 'not_started', label: 'Not started' },
  { key: 'goals', label: 'Goals set' },
  { key: 'self', label: 'Self review' },
  { key: 'manager', label: 'Manager review' },
  { key: 'final', label: 'Finalised' },
  { key: 'published', label: 'Published' },
]

export function ratingDistribution(codes: (string | null | undefined)[]): { key: string; label: string; value: number; share: number | null; reference: number }[] {
  const valid = codes.map(c => String(c || '').toUpperCase()).filter(c => c in RATING_VALUE)
  const n = valid.length
  return RATING_ORDER.map(k => {
    const v = valid.filter(c => c === k).length
    return { key: k, label: RATING_LABEL[k], value: v, share: pct(v, n), reference: REFERENCE_CURVE[k] }
  })
}

// ── Recruitment ────────────────────────────────────────────────────────────

/** Candidate stages in pipeline order. A candidate counts at every stage up to the one
 *  they reached, so the funnel only narrows. Hold sits with Interviewing; Rejected is
 *  counted at Applied only (the table does not keep the stage they fell out at). */
export const FUNNEL: { key: string; label: string; stages: string[] }[] = [
  { key: 'applied', label: 'Applied', stages: ['Applied'] },
  { key: 'screened', label: 'Screened', stages: ['AI Screened', 'Telephonic'] },
  { key: 'interview', label: 'Interviewing', stages: ['L1', 'L2', 'Optional Round', 'Hold'] },
  { key: 'shortlisted', label: 'Shortlisted', stages: ['Shortlisted'] },
  { key: 'offer', label: 'Offer sent', stages: ['Offer Sent'] },
  { key: 'joined', label: 'Joined', stages: ['Joined'] },
]

export function funnelCounts(stages: (string | null | undefined)[]): { key: string; label: string; value: number; conversion: number | null }[] {
  const idx = (s: string | null | undefined): number => {
    const v = String(s || '').trim().toLowerCase()
    return FUNNEL.findIndex(f => f.stages.some(x => x.toLowerCase() === v))
  }
  const reached = new Array(FUNNEL.length).fill(0)
  for (const s of stages) {
    const i = idx(s)
    const top = i < 0 ? 0 : i                 // Rejected / unknown → counted at Applied
    for (let k = 0; k <= top; k++) reached[k]++
  }
  return FUNNEL.map((f, i) => ({ key: f.key, label: f.label, value: reached[i], conversion: i === 0 ? null : pct(reached[i], reached[i - 1]) }))
}
