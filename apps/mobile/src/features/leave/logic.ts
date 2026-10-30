// src/features/leave/logic.ts — the pure pieces of the website's Leave tab.
//
// Copied from components/ess/LeaveSection.tsx (a client component that imports
// lib/ess/api → browser storage, so it cannot be shared through @web/…). Every
// function keeps the website's arithmetic and wording exactly; the server
// (app/api/ess/leave/route.ts) re-checks everything on submit.

// ── Contract — the GET /api/ess/leave payload ────────────────────────────────
export interface LeaveType {
  id: string; short_name: string; name: string
  application_mode?: 'EMPLOYEE' | 'EARN_AVAIL'
  allow_half_day: boolean; allow_without_balance: boolean
  approval_by?: string
  available: number | null; eligible: boolean; reason: string | null
  /** available minus what is already pending — what a new request may use. */
  bookable?: number | null; pending?: number
  policy?: 'UNLIMITED' | 'EARNED' | 'PER_OCCURRENCE' | 'ACCRUAL' | null
}
/** Who a request is waiting on, as the server names them. */
export interface Waiting { id: string; name: string; role: string }
export interface Balance {
  leave_type_id: string; id?: string; year: string
  opening: number | null; accrued: number | null; used: number | null; encashed: number | null; pending: number | null
  available?: number | null; bookable?: number | null
  leave_types?: { short_name: string; name: string } | null
}
export interface Application {
  id: string; leave_type_id: string; from_date: string; to_date: string | null
  days: number | string; half_day: boolean | null; half_session: string | null
  reason: string | null; status: string; approver: string | null; remark: string | null
  applied_at: string | null; resolved_at: string | null; approval_stage: string | null
  cancel_status: 'REQUESTED' | 'APPROVED' | 'DECLINED' | null
  cancel_decided_by: string | null; cancel_remark: string | null
  leave_types?: { short_name: string; name: string } | null
  waiting_on: Waiting | null; cancel_waiting_on: Waiting | null
}
export interface Holiday { holiday_date: string; description: string; holiday_type: string | null; is_optional: boolean | null }
export interface Payload {
  year: string; fyLabel: string
  balances: Balance[]; types: LeaveType[]; applications: Application[]; holidays: Holiday[]
  /** Sum of the headline balances (EL, CL, SL …), as Home and Today show it. */
  balance_total?: number
  lwp_type?: { id: string; name: string; short_name: string } | null
  /** Exact weekly-off dates for a rolling year from today … */
  weekly_offs: string[]
  /** … and the weekday fallback beyond it (0 = Sunday). */
  weekly_off_weekdays: number[]
  /** Days back the employee may apply; 0 = no backdating. Missing → 0. */
  backdate_days?: number
  diagnostics: { noBalances: boolean; noHolidays: boolean; noApprover: boolean; noWeeklyOffs: boolean }
}

/** The over-balance offer from a 409: file the extra days as LWP. */
export interface SplitOffer { message: string; paid_days: number; lwp_days: number; lwp_type: string; key: string }

export interface LeaveForm {
  leave_type_id: string; from_date: string; to_date: string
  half_day: boolean; half_session: '' | '1st' | '2nd'; reason: string
}
export const BLANK: LeaveForm = { leave_type_id: '', from_date: '', to_date: '', half_day: false, half_session: '', reason: '' }

/** How many requests / holidays the side lists show before "Show all". */
export const PEEK = 3

// ── Arithmetic (unchanged from the website) ──────────────────────────────────
export const avail = (b: Balance) =>
  (Number(b.opening || 0) + Number(b.accrued || 0)) - Number(b.used || 0) - Number(b.encashed || 0)
export type Bar = 'ok' | 'warn' | 'bad'
export const barClass = (pct: number): Bar => pct > 60 ? 'ok' : pct > 30 ? 'warn' : 'bad'
export const plural = (n: number) => (n === 1 ? '' : 's')

// ── Dates — local, not UTC ───────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromIso = (s: string) => new Date(s + 'T00:00:00')
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export const dayMon = (s: string) =>
  fromIso(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const dayMonYear = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
export const rangeLabel = (f: string, t: string) => {
  if (!f) return ''
  if (!t || t === f) return dayMonYear(fromIso(f))
  const a = fromIso(f), b = fromIso(t)
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  return same ? `${a.getDate()} – ${dayMonYear(b)}` : `${dayMon(f)} – ${dayMonYear(b)}`
}
/** "19 October" — the note shown when a non-working day is tapped. */
export const dayLong = (key: string) => fromIso(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
/** The calendar cell's accessibility label prefix: "Monday 19 October". */
export const cellLabel = (key: string) => fromIso(key).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
export const resolvedOn = (ts: string) => new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
/** What the website's <input type="date"> shows in an en-IN browser: dd/mm/yyyy. */
export const fmtSlot = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
export const shortMonth =(d: Date) => d.toLocaleDateString('en-IN', { month: 'short' })

/**
 * The earliest date anyone may apply for. Counted back from today INCLUSIVE —
 * a window of 30 means today and the previous 29 days; 0 or 1 → today.
 */
export const earliestApplyDate = (backdateDays?: number) => {
  const d = new Date()
  const n = Math.max(0, Math.floor(Number(backdateDays) || 0))
  if (n > 1) d.setDate(d.getDate() - (n - 1))
  return iso(d)
}

/** The six-week (or fewer) grid of a month, Sunday first, as rows of weeks. */
export function monthWeeks(cursor: Date): (string | null)[][] {
  const y = cursor.getFullYear(), m = cursor.getMonth()
  const lead = new Date(y, m, 1).getDay()
  const len = new Date(y, m + 1, 0).getDate()
  const flat: (string | null)[] = []
  for (let i = 0; i < lead; i++) flat.push(null)
  for (let d = 1; d <= len; d++) flat.push(iso(new Date(y, m, d)))
  while (flat.length % 7 !== 0) flat.push(null)
  const out: (string | null)[][] = []
  for (let i = 0; i < flat.length; i += 7) out.push(flat.slice(i, i + 7))
  return out
}

// ── The calendar the client knows about ──────────────────────────────────────
export interface DayRules {
  holByDate: Map<string, Holiday>
  isWeeklyOff: (key: string) => boolean
  isNonWorking: (key: string) => boolean
}
export function dayRules(data: Payload | null | undefined, today: string): DayRules {
  const holByDate = new Map<string, Holiday>()
  for (const h of data?.holidays || []) if (!holByDate.has(h.holiday_date)) holByDate.set(h.holiday_date, h)
  const offSet = new Set<string>(data?.weekly_offs || [])
  const offDows = data?.weekly_off_weekdays || []
  const offWindowEnd = iso(addDays(new Date(), 366))
  // Inside the resolver's one-year window the dates are exact (an NTH rule);
  // beyond it the weekday is the best answer — the server decides on submit.
  const isWeeklyOff = (key: string) =>
    (key >= today && key <= offWindowEnd) ? offSet.has(key) : offDows.includes(fromIso(key).getDay())
  // Optional holidays are included — see the note in route.ts.
  const isNonWorking = (key: string) => isWeeklyOff(key) || holByDate.has(key)
  return { holByDate, isWeeklyOff, isNonWorking }
}

// ── Range estimate — display only ────────────────────────────────────────────
export interface Estimate { span: number; offs: number; hols: Holiday[]; working: number }
export function estimateOf(form: LeaveForm, rules: DayRules): Estimate | null {
  if (!form.from_date || !form.to_date) return null
  const a = fromIso(form.from_date), b = fromIso(form.to_date)
  if (b < a) return null
  let span = 0, offs = 0
  const hols: Holiday[] = []
  for (let d = a; d <= b; d = addDays(d, 1)) {
    span++
    const key = iso(d)
    const h = rules.holByDate.get(key)
    if (rules.isWeeklyOff(key)) offs++
    else if (h) { offs++; hols.push(h) }   // optional holidays count too
  }
  const working = form.half_day ? 0.5 : Math.max(0, span - offs)
  return { span, offs, hols, working }
}

/** Against what can be BOOKED — pending requests already hold their days. */
export function balanceAfterOf(sel: LeaveType | null, est: Estimate | null): number | null {
  const base = sel?.bookable ?? sel?.available
  if (!sel || base == null || !est) return null
  return Math.round((base - est.working) * 10) / 10
}

// ── Form transitions (pickDay / setStart / setEnd) ───────────────────────────
/** Tap rule: the one chosen day → clear; nothing chosen or earlier → that day; else extend. */
export function pickInto(f: LeaveForm, key: string): LeaveForm {
  if (f.from_date === key && f.to_date === key) return { ...f, from_date: '', to_date: '' }
  if (!f.from_date || key < f.from_date) return { ...f, from_date: key, to_date: key }
  return { ...f, to_date: key }
}
export function startInto(f: LeaveForm, v: string, floor: string): LeaveForm {
  if (!v) return { ...f, from_date: '', to_date: '' }
  const d = v < floor ? floor : v
  return { ...f, from_date: d, to_date: (!f.to_date || f.to_date < d) ? d : f.to_date }
}
export function endInto(f: LeaveForm, v: string, floor: string): LeaveForm {
  if (!v) return { ...f, to_date: f.from_date }
  const d = v < floor ? floor : v
  return { ...f, from_date: f.from_date || d, to_date: (f.from_date && d < f.from_date) ? f.from_date : d }
}

// ── Request statuses ─────────────────────────────────────────────────────────
export type StatusKey = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'OTHER'
export const statusKey = (s: string): StatusKey => {
  const u = String(s || '').toUpperCase()
  return u === 'PENDING' || u === 'APPROVED' || u === 'REJECTED' || u === 'CANCELLED' ? u : 'OTHER'
}
