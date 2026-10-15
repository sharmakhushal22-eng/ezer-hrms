// lib/supabase-attendance.ts — ESS Attendance module data layer.
//
// THE DAY'S STATUS IS THE SERVER'S. The calendar used to decide it here, from
// four anon reads, while /api/ess/attendance decided it again for the mobile
// app — two copies of one rule that disagreed on today ("Missing punch" at
// lunchtime), on a missed IN vs a missed OUT (both "Missing punch"), and on half
// days. Both the calendar and the attendance list now render GET
// /api/ess/attendance, which returns each day's `kind`; this module only shapes
// it. Raw punches for one day are still a direct read.
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/ess/api'

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
  source: string | null
  shift_id: string | null
  /** Set when an approved correction wrote this record (migration 138 flow). */
  regularized_at?: string | null
}
export interface DayPunch { punch_time: string; punch_type: 'IN' | 'OUT'; source: string | null; geofence_status: string | null }
export interface HolidayInfo { holiday_date: string; description: string; holiday_type: string; is_optional: boolean }
export interface LeaveDay { short_name: string; name: string; half_day: boolean; half_session?: string | null }
export interface RegularisationRequest {
  id: string; attendance_date: string; recorded_in: string | null; recorded_out: string | null
  requested_in: string; requested_out: string; reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reviewed_by: string | null; reviewed_at: string | null; review_remark: string | null; created_at: string
  request_group?: string | null
  /** From GET /api/ess/attendance: who a pending one is with, by name. */
  waiting_on?: { id: string; name: string; role: string } | null
  decided_by?: string | null
}

/**
 * What a day is — the server's `kind` (app/api/ess/attendance/route.ts kindFor):
 * PRESENT · LATE · HALF_DAY · MISS_IN · MISS_OUT · IN_PROGRESS · ABSENT ·
 * LEAVE · HALF_LEAVE · HOLIDAY · WEEKLY_OFF · UPCOMING
 */
export type DayKind =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'MISS_IN' | 'MISS_OUT' | 'IN_PROGRESS' | 'ABSENT'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING'

export interface DayCorrection {
  id: string; group: string | null; status: RegularisationRequest['status']
  requested_in: string | null; requested_out: string | null
  waiting_on: { id: string; name: string; role: string } | null
  decided_by: string | null; review_remark: string | null
}

/** One day, as GET /api/ess/attendance returns it. */
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

export interface AttendanceRange {
  from: string; to: string; today: string
  days: AttendanceDay[]
  holidays: HolidayInfo[]
  weekly_offs: string[]
  regularisations: RegularisationRequest[]
  summary: { by_kind: Record<string, number> } & Record<string, unknown>
}

/** Any range up to 62 days (the server's limit). */
export async function loadAttendanceRange(empId: string, from: string, to: string): Promise<AttendanceRange> {
  return api(`/api/ess/attendance?from=${from}&to=${to}`, empId) as Promise<AttendanceRange>
}

export interface MonthlyData {
  records: AttendanceRecord[]
  recMap: Map<string, AttendanceRecord>
  holidayMap: Map<string, HolidayInfo>
  weekoffSet: Set<string>
  leaveMap: Map<string, LeaveDay>
  /** The server's verdict per day. */
  dayMap: Map<string, AttendanceDay>
  regularisations: RegularisationRequest[]
}

export async function loadMonthlyAttendance(empId: string, year: number, month: number): Promise<MonthlyData> {
  const ym = `${year}-${String(month).padStart(2, '0')}`
  const r = await api(`/api/ess/attendance?month=${ym}`, empId) as AttendanceRange
  const dayMap = new Map<string, AttendanceDay>(r.days.map(d => [d.date, d]))
  const records: AttendanceRecord[] = r.days
    .filter(d => d.work_in || d.work_out)
    .map(d => ({
      attendance_date: d.date, work_in: d.work_in, work_out: d.work_out,
      total_minutes: d.total_minutes, late_minutes: d.late_minutes, overtime_minutes: d.overtime_minutes,
      status: d.status || 'PRESENT', lop_applicable: d.lop, punch_count: d.punch_count,
      source: null, shift_id: null, regularized_at: d.regularised ? 'yes' : null,
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

export async function loadDayPunches(empId: string, date: string): Promise<DayPunch[]> {
  const { data } = await supabase.from('attendance_punches')
    .select('punch_time, punch_type, source, geofence_status')
    .eq('employee_id', empId).eq('punch_date', date).order('punch_time', { ascending: true })
  return (data || []) as DayPunch[]
}

// Regularisation requests are read and filed through /api/ess/attendance
// (GET returns them with the approver's name; POST files and routes; PATCH
// withdraws). The browser no longer writes attendance_regularisation: since
// migration 138 it is read-only to anon, so an employee cannot approve their
// own correction with a direct REST call.

// ── Day status, for the calendar ────────────────────────────────────────────
//
// Status keys the calendar renders. FUTURE is UPCOMING; ON_LEAVE is LEAVE.
// Everything else is the server's kind as-is.
export interface DayInfo { status: string; rec: AttendanceRecord | null; holiday: HolidayInfo | null; leave: LeaveDay | null; day: AttendanceDay | null }
export function resolveDay(dateStr: string, m: MonthlyData, todayStr: string): DayInfo {
  const rec = m.recMap.get(dateStr) || null
  const holiday = m.holidayMap.get(dateStr) || null
  const leave = m.leaveMap.get(dateStr) || null
  const day = m.dayMap.get(dateStr) || null
  const k = day?.kind ?? (dateStr > todayStr ? 'UPCOMING' : 'ABSENT')
  const status = k === 'UPCOMING' ? 'FUTURE' : k === 'LEAVE' ? 'ON_LEAVE' : k
  return { status, rec, holiday: k === 'HOLIDAY' ? holiday : null, leave: k === 'LEAVE' || k === 'HALF_LEAVE' ? leave : null, day }
}

/** Kinds that are an exception worth correcting. */
export const CORRECTABLE: DayKind[] = ['ABSENT', 'MISS_IN', 'MISS_OUT', 'HALF_DAY', 'LATE', 'HALF_LEAVE']
