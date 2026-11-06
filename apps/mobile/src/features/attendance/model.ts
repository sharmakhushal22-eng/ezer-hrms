// src/features/attendance/model.ts — the Attendance screen's data shapes and pure rules.
//
// Everything here is copied from the website, not re-derived, so a day reads
// the same on both products:
//   · types, resolveDay, CORRECTABLE      ← lib/supabase-attendance.ts
//   · loadMonthlyAttendance (shaping)     ← lib/supabase-attendance.ts
//   · monthStats, STATUS_STYLE/BAR/FULL/LABEL, fmtT, fmt, fmtDT
//                                         ← components/ess/EmployeePortal.tsx (ATTENDANCE B3)
//   · KIND_META, selectable, proposed, NEEDS_ATTENTION, istClock, hours, dayLabel
//                                         ← components/ess/attendance/AttendanceLog.tsx
// lib/supabase-attendance.ts imports Supabase and the browser api helper, so it
// cannot be imported here (see spec §11); the pieces are copied instead.
import type { Palette } from '@/ui/theme'

// ── Types (lib/supabase-attendance.ts) ──────────────────────────────────────
export type DayKind =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'MISS_IN' | 'MISS_OUT' | 'IN_PROGRESS' | 'ABSENT'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING'

export interface Approver { id: string; name: string; role: string }
export interface DayCorrection {
  id: string; group: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  requested_in: string | null; requested_out: string | null
  waiting_on: Approver | null
  decided_by: string | null; review_remark: string | null
}
export interface LeaveDay { short_name: string; name: string; half_day: boolean; half_session?: string | null }
export interface AttendanceDay {
  date: string
  kind: DayKind
  work_in: string | null
  work_out: string | null
  total_minutes: number | null
  late_minutes: number
  overtime_minutes: number
  punch_count: number
  status: string | null
  lop: boolean
  regularised: boolean
  note: string | null
  leave: LeaveDay | null
  shift_code: string | null
  expected_in: string | null
  expected_out: string | null
  correction: DayCorrection | null
}
export interface HolidayInfo { holiday_date: string; description: string; holiday_type: string; is_optional: boolean }
export interface DayPunch { punch_time: string; punch_type: 'IN' | 'OUT'; source: string | null; geofence_status: string | null }
export interface RegularisationRequest {
  id: string; attendance_date: string; recorded_in: string | null; recorded_out: string | null
  requested_in: string; requested_out: string; reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reviewed_by: string | null; reviewed_at: string | null; review_remark: string | null; created_at: string
  request_group?: string | null
  waiting_on?: Approver | null
  decided_by?: string | null
}
/** GET /api/ess/attendance (spec §4.1) — the parts the screen reads. */
export interface AttendanceRange {
  month: string
  from: string; to: string; today: string
  days: AttendanceDay[]
  day_punches?: DayPunch[]
  holidays: HolidayInfo[]
  weekly_offs: string[]
  regularisations: RegularisationRequest[]
}
export interface AttendanceRecord {
  attendance_date: string
  work_in: string | null
  work_out: string | null
  total_minutes: number | null
  late_minutes: number
  overtime_minutes: number
  status: string
  lop_applicable: boolean
  punch_count: number
  regularized_at?: string | null
}
export interface MonthlyData {
  records: AttendanceRecord[]
  recMap: Map<string, AttendanceRecord>
  holidayMap: Map<string, HolidayInfo>
  weekoffSet: Set<string>
  leaveMap: Map<string, LeaveDay>
  dayMap: Map<string, AttendanceDay>
  regularisations: RegularisationRequest[]
}
/** POST /api/ess/attendance 200 (spec §4.2). */
export interface FileResult {
  ok: true; filed: number; dates: string[]; skipped: { date: string; why: string }[]
  status: 'PENDING'; group: string; waiting_on: Approver | null; unrouted: boolean
}

/** loadMonthlyAttendance's shaping of the month payload (lib/supabase-attendance.ts). */
export function toMonthly(r: AttendanceRange): MonthlyData {
  const dayMap = new Map<string, AttendanceDay>(r.days.map(d => [d.date, d]))
  const records: AttendanceRecord[] = r.days
    .filter(d => d.work_in || d.work_out)
    .map(d => ({
      attendance_date: d.date, work_in: d.work_in, work_out: d.work_out,
      total_minutes: d.total_minutes, late_minutes: d.late_minutes, overtime_minutes: d.overtime_minutes,
      status: d.status || 'PRESENT', lop_applicable: d.lop, punch_count: d.punch_count,
      regularized_at: d.regularised ? 'yes' : null,
    }))
  const leaveMap = new Map<string, LeaveDay>()
  for (const d of r.days) if (d.leave) leaveMap.set(d.date, d.leave)
  return {
    records,
    recMap: new Map(records.map(x => [x.attendance_date, x])),
    holidayMap: new Map<string, HolidayInfo>((r.holidays || []).map(h => [h.holiday_date, h])),
    weekoffSet: new Set<string>(r.weekly_offs || []),
    leaveMap,
    dayMap,
    regularisations: r.regularisations || [],
  }
}

// ── Day status (lib/supabase-attendance.ts resolveDay) ──────────────────────
export interface DayInfo { status: string; rec: AttendanceRecord | null; holiday: HolidayInfo | null; leave: LeaveDay | null; day: AttendanceDay | null }
export function resolveDay(dateStr: string, m: MonthlyData, todayStr: string): DayInfo {
  const rec = m.recMap.get(dateStr) || null
  const holiday = m.holidayMap.get(dateStr) || null
  const leave = m.leaveMap.get(dateStr) || null
  const day = m.dayMap.get(dateStr) || null
  const k = day?.kind ?? (dateStr > todayStr ? 'UPCOMING' : 'ABSENT')
  const status = k === 'UPCOMING' ? (dateStr === todayStr ? 'TODAY' : 'FUTURE') : k === 'LEAVE' ? 'ON_LEAVE' : k
  return { status, rec, holiday: k === 'HOLIDAY' ? holiday : null, leave: k === 'LEAVE' || k === 'HALF_LEAVE' ? leave : null, day }
}
/** Statuses the day panel offers "Raise regularisation" for (EmployeePortal.tsx DayDetailPanel). */
export const CORRECTABLE = ['MISS_IN', 'MISS_OUT', 'ABSENT', 'HALF_DAY', 'LATE', 'HALF_LEAVE']

// ── Vocabulary and colours ──────────────────────────────────────────────────
export interface KindMeta { label: string; code: string; fg: string; bg: string; bar: string }
/** AttendanceLog.tsx KIND_META, resolved for the active palette. */
export function kindMeta(C: Palette): Record<DayKind, KindMeta> {
  return {
    PRESENT:     { label: 'Present',          code: 'P',  fg: C.positive,  bg: C.positiveTint, bar: C.positive },
    LATE:        { label: 'Late',             code: 'LT', fg: C.warning,   bg: C.positiveTint, bar: C.positive },
    HALF_DAY:    { label: 'Half day',         code: '½',  fg: C.warning,   bg: C.warningTint,  bar: C.warning },
    MISS_IN:     { label: 'Missed punch-in',  code: 'MI', fg: C.critical,  bg: C.warningTint,  bar: C.critical },
    MISS_OUT:    { label: 'Missed punch-out', code: 'MO', fg: C.critical,  bg: C.warningTint,  bar: C.critical },
    IN_PROGRESS: { label: 'At work now',      code: '●',  fg: C.info,      bg: C.infoTint,     bar: C.info },
    ABSENT:      { label: 'Absent',           code: 'A',  fg: C.critical,  bg: C.criticalTint, bar: C.critical },
    LEAVE:       { label: 'Leave',            code: 'L',  fg: C.brandDeep, bg: C.brandTint,    bar: C.brand },
    HALF_LEAVE:  { label: 'Half-day leave',   code: '½L', fg: C.brandDeep, bg: C.brandTint,    bar: C.brand },
    HOLIDAY:     { label: 'Holiday',          code: 'H',  fg: C.info,      bg: C.infoTint,     bar: C.info },
    WEEKLY_OFF:  { label: 'Weekly off',       code: 'WO', fg: C.faint,     bg: C.sunken,       bar: C.lineStrong },
    UPCOMING:    { label: '—',                code: '',   fg: C.faint,     bg: 'transparent',  bar: C.line },
  }
}
/** Labels only (palette-free), for rules that print a kind's name. */
const KIND_LABEL: Record<DayKind, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', MISS_IN: 'Missed punch-in', MISS_OUT: 'Missed punch-out',
  IN_PROGRESS: 'At work now', ABSENT: 'Absent', LEAVE: 'Leave', HALF_LEAVE: 'Half-day leave', HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off', UPCOMING: '—',
}

const KEY_ALIAS: Record<string, DayKind> = { ON_LEAVE: 'LEAVE', FUTURE: 'UPCOMING', MISS_PUNCH: 'MISS_OUT' }

/** The calendar's vocabulary (EmployeePortal.tsx STATUS_STYLE / STATUS_BAR / STATUS_FULL / STATUS_LABEL). */
export interface StatusVocab {
  style: (s: string) => [string, string]
  bar: (s: string) => string
  full: (s: string) => string
  label: (s: string) => string
  meta: Record<DayKind, KindMeta>
}
export function statusVocab(C: Palette): StatusVocab {
  const meta = kindMeta(C)
  const metaOf = (s: string) => meta[(KEY_ALIAS[s] || s) as DayKind] || null
  const STYLE: Record<string, [string, string]> = {
    PRESENT: [C.sunken, C.positive], LATE: [C.sunken, C.warning], IN_PROGRESS: [C.infoTint, C.info],
    HALF_DAY: [C.warningTint, C.warning], MISS_IN: [C.warningTint, C.critical], MISS_OUT: [C.warningTint, C.critical],
    MISS_PUNCH: [C.warningTint, C.critical], ABSENT: [C.criticalTint, C.critical], LWP: [C.criticalTint, C.critical],
    WEEKLY_OFF: [C.sunken, C.faint], HOLIDAY: [C.infoTint, C.info], ON_LEAVE: [C.brandTint, C.brandDeep], HALF_LEAVE: [C.brandTint, C.brandDeep],
    FUTURE: ['transparent', C.lineStrong], TODAY: [C.canvas, C.brand],
  }
  return {
    meta,
    style: s => STYLE[s] || [C.brandTint, C.brandDeep],
    bar: s => (s === 'LWP' ? C.critical : metaOf(s)?.bar ?? C.line),
    full: s => (s === 'LWP' ? 'Loss of pay' : s === 'FUTURE' ? '—' : s === 'TODAY' ? 'Today, not in yet' : metaOf(s)?.label ?? s),
    label: s => (s === 'LWP' ? 'LWP' : metaOf(s)?.code ?? ''),
  }
}

/** CSS color-mix(in srgb, a p%, b) for two #RRGGBB colours. */
export function mixHex(a: string, b: string, p = 0.5) {
  const h = (x: string) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16))
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a
  const [A, B] = [h(a), h(b)]
  return '#' + A.map((v, i) => Math.round(v * p + B[i] * (1 - p)).toString(16).padStart(2, '0')).join('')
}

// ── Month statistics (EmployeePortal.tsx monthStats) ────────────────────────
export const pad2 = (n: number) => String(n).padStart(2, '0')
export type MonthSummary = ReturnType<typeof monthStats>
export function monthStats(year: number, month: number, md: MonthlyData | null, todayStr: string) {
  const empty = { present: 0, absent: 0, halfDay: 0, lateCount: 0, lopDays: 0, missPunch: 0,
                  onLeave: 0, totalOTHours: '0h 0m', working: 0, pct: null as number | null }
  if (!md) return empty
  const days = new Date(year, month, 0).getDate()
  let present = 0, absent = 0, halfDay = 0, late = 0, lop = 0, miss = 0, leave = 0, ot = 0
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(month)}-${pad2(d)}`
    if (ds > todayStr) continue
    const { status, rec } = resolveDay(ds, md, todayStr)
    if (rec?.late_minutes) late++
    if (rec?.overtime_minutes) ot += rec.overtime_minutes
    switch (status) {
      case 'PRESENT': case 'LATE': case 'IN_PROGRESS': present++; break
      case 'HALF_DAY': halfDay++; break
      case 'MISS_IN': case 'MISS_OUT': miss++; present++; break
      case 'LWP': lop++; break
      case 'ABSENT': absent++; break
      case 'ON_LEAVE': case 'HALF_LEAVE': leave++; break
      default: break
    }
  }
  const working = present + absent + halfDay + lop
  const earned = present + halfDay * 0.5
  return {
    present, absent, halfDay, lateCount: late, lopDays: lop, missPunch: miss, onLeave: leave,
    totalOTHours: `${Math.floor(ot / 60)}h ${ot % 60}m`,
    working,
    pct: working > 0 ? Math.round((earned / working) * 100) : null,
  }
}

// ── Formatting (en-IN, exactly as the website prints it) ────────────────────
// Written out by hand rather than through toLocale*String so Hermes on Android
// prints the same characters Chrome does on the website.
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = MONTH_NAMES.map(m => m.slice(0, 3))
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
/** 'YYYY-MM-DD' → local midnight (the website's `new Date(s + 'T00:00:00')`). */
export const atMidnight = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = atMidnight(s); d.setDate(d.getDate() + n); return ymdLocal(d) }

/** fmtT — HH:mm on the device clock, '-' for null. */
export const fmtT = (iso: string | null | undefined) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
/** istClock — HH:mm in Asia/Kolkata (AttendanceLog.tsx), null for null. */
export const istClock = (ts: string | null | undefined) => {
  if (!ts) return null
  const t = new Date(ts).getTime()
  if (isNaN(t)) return null
  const d = new Date(t + 330 * 60_000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}
/** 'Monday, 05 Oct 2026' */
export const fmtLongDay = (s: string) => { const d = atMidnight(s); return `${WD_LONG[d.getDay()]}, ${pad2(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}` }
/** 'Mon, 05 Oct' — AttendanceLog.tsx dayLabel */
export const dayLabel = (s: string) => { const d = atMidnight(s); return `${WEEKDAYS[d.getDay()]}, ${pad2(d.getDate())} ${MON[d.getMonth()]}` }
/** '05 Oct' */
export const shortDay = (s: string) => { const d = atMidnight(s); return `${pad2(d.getDate())} ${MON[d.getMonth()]}` }
/** EmployeePortal.tsx fmt — '05 Oct 2026' for a date or a timestamp, '-' for null. */
export const fmt = (s?: string | null) => {
  if (!s) return '-'
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? atMidnight(s) : new Date(s)
  return isNaN(d.getTime()) ? '-' : `${pad2(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`
}
/** EmployeePortal.tsx fmtDT — en-IN dateStyle medium + timeStyle short: '5 Oct 2026, 2:05 pm'. */
export const fmtDT = (s?: string | null) => {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '-'
  const h = d.getHours()
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}
/** AttendanceLog.tsx hours */
export const hours = (m: number | null) => (m == null || m <= 0 ? '—' : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`)
/** HH:mm of a TIME string ('09:30:00' → '09:30'), '—' for none. */
export const hm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '—')
export const plural = (n: number, w = 'day') => `${n} ${w}${n === 1 ? '' : 's'}`

// ── The list's rules (AttendanceLog.tsx) ────────────────────────────────────
export function selectable(d: AttendanceDay, today: string): { ok: boolean; why?: string } {
  if (d.date >= today) return { ok: false, why: d.date === today ? 'Today is not over yet' : 'This day has not happened yet' }
  if (d.kind === 'HOLIDAY' || d.kind === 'WEEKLY_OFF') return { ok: false, why: `${KIND_LABEL[d.kind]} — nothing to correct` }
  if (d.kind === 'LEAVE') return { ok: false, why: 'On approved leave' }
  if (d.correction?.status === 'PENDING') return { ok: false, why: `A correction is already waiting${d.correction.waiting_on ? ` on ${d.correction.waiting_on.name}` : ''}` }
  if (d.correction?.status === 'APPROVED' || d.regularised) return { ok: false, why: 'Already regularised' }
  return { ok: true }
}
export const NEEDS_ATTENTION: DayKind[] = ['ABSENT', 'MISS_IN', 'MISS_OUT', 'HALF_DAY', 'LATE']
export function proposed(d: AttendanceDay): { in: string; out: string } {
  return {
    in: istClock(d.work_in) ?? d.expected_in ?? '09:00',
    out: istClock(d.work_out) ?? d.expected_out ?? '18:00',
  }
}
export const isOff = (d: AttendanceDay) => d.kind === 'WEEKLY_OFF' || d.kind === 'HOLIDAY' || d.kind === 'LEAVE' || d.kind === 'UPCOMING'
export const MAX_DAYS = 62
export type Preset = 'week' | 'month' | 'last' | 'custom'
export type Filter = 'ALL' | 'ATTENTION' | DayKind
export function rangeFor(preset: Preset, custom: { from: string; to: string }, todayLocal: string) {
  if (preset === 'week') return { from: addDays(todayLocal, -6), to: todayLocal }
  if (preset === 'month') return { from: todayLocal.slice(0, 8) + '01', to: todayLocal }
  if (preset === 'last') {
    const d = atMidnight(todayLocal); d.setDate(1); d.setDate(0)
    const to = ymdLocal(d); return { from: to.slice(0, 8) + '01', to }
  }
  return custom
}
export function rangeErrorOf(r: { from: string; to: string }) {
  if (r.from > r.to) return 'The start date is after the end date.'
  return (Date.parse(r.to) - Date.parse(r.from)) / 86400000 + 1 > MAX_DAYS ? `Pick at most ${MAX_DAYS} days at a time.` : ''
}
