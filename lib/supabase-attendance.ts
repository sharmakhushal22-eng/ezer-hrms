// lib/supabase-attendance.ts — ESS Attendance module data layer (migration 036 + 026 + 030 + sql23)
// Monthly calendar = attendance_records + holidays (resolve_holidays) + weekly offs
// (resolve_weekly_offs) + approved leaves; plus per-day punches & miss-punch regularisation.
import { supabase } from '@/lib/supabase'

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
}
export interface DayPunch { punch_time: string; punch_type: 'IN' | 'OUT'; source: string | null; geofence_status: string | null }
export interface HolidayInfo { holiday_date: string; description: string; holiday_type: string; is_optional: boolean }
export interface LeaveDay { short_name: string; name: string; half_day: boolean }
export interface RegularisationRequest {
  id: string; attendance_date: string; recorded_in: string | null; recorded_out: string | null
  requested_in: string; requested_out: string; reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewed_by: string | null; reviewed_at: string | null; review_remark: string | null; created_at: string
}
export interface MonthlyData {
  records: AttendanceRecord[]
  recMap: Map<string, AttendanceRecord>
  holidayMap: Map<string, HolidayInfo>
  weekoffSet: Set<string>
  leaveMap: Map<string, LeaveDay>
}

export async function loadMonthlyAttendance(empId: string, year: number, month: number): Promise<MonthlyData> {
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const monthTo = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  const [recR, holR, woR, lvR] = await Promise.all([
    supabase.from('attendance_records')
      .select('attendance_date, work_in, work_out, total_minutes, late_minutes, overtime_minutes, status, lop_applicable, punch_count, source, shift_id')
      .eq('employee_id', empId).gte('attendance_date', monthFrom).lte('attendance_date', monthTo),
    supabase.rpc('resolve_holidays', { p_employee_id: empId }),
    supabase.rpc('resolve_weekly_offs', { p_employee_id: empId, p_from: monthFrom, p_to: monthTo }),
    supabase.from('leave_applications')
      .select('from_date, to_date, half_day, leave_types(short_name, name)')
      .eq('employee_id', empId).eq('status', 'APPROVED').lte('from_date', monthTo).gte('to_date', monthFrom),
  ])
  const records = (recR.data || []) as AttendanceRecord[]
  const recMap = new Map(records.map(r => [r.attendance_date, r]))
  const holidayMap = new Map<string, HolidayInfo>((holR.data || []).map((h: any) => [h.holiday_date, h]))
  const weekoffSet = new Set<string>((woR.data || []).map((w: any) => w.off_date))
  const leaveMap = new Map<string, LeaveDay>()
  ;(lvR.data || []).forEach((l: any) => {
    const d = new Date(l.from_date + 'T00:00:00'); const end = new Date(l.to_date + 'T00:00:00')
    while (d <= end) { leaveMap.set(d.toISOString().slice(0, 10), { short_name: l.leave_types?.short_name || 'LV', name: l.leave_types?.name || 'Leave', half_day: l.half_day }); d.setDate(d.getDate() + 1) }
  })
  return { records, recMap, holidayMap, weekoffSet, leaveMap }
}

export async function loadDayPunches(empId: string, date: string): Promise<DayPunch[]> {
  const { data } = await supabase.from('attendance_punches')
    .select('punch_time, punch_type, source, geofence_status')
    .eq('employee_id', empId).eq('punch_date', date).order('punch_time', { ascending: true })
  return (data || []) as DayPunch[]
}

export async function loadRegularisationRequests(empId: string): Promise<RegularisationRequest[]> {
  const { data } = await supabase.from('attendance_regularisation')
    .select('*').eq('employee_id', empId).order('created_at', { ascending: false }).limit(10)
  return (data || []) as RegularisationRequest[]
}

export async function submitRegularisation(
  empId: string, date: string, recordedIn: string | null, recordedOut: string | null,
  requestedIn: string, requestedOut: string, reason: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('attendance_regularisation').upsert({
    employee_id: empId, attendance_date: date, recorded_in: recordedIn, recorded_out: recordedOut,
    requested_in: requestedIn, requested_out: requestedOut, reason, status: 'PENDING',
  }, { onConflict: 'employee_id,attendance_date' })
  return { error: error?.message || null }
}

/**
 * One request per day, submitted together.
 *
 * Regularising a week of missed punches one day at a time is seven forms with
 * the same times and the same reason typed seven times. This takes the range
 * once. Each day is still its own row, because HR approves days individually
 * and the table is keyed on (employee_id, attendance_date) — a bulk submission
 * is a convenience at entry, not a different kind of record.
 *
 * Upsert, so re-submitting a day that was already pending updates it rather
 * than failing the whole batch on one duplicate.
 */
export async function submitRegularisationBulk(
  empId: string,
  days: { date: string; recordedIn: string | null; recordedOut: string | null }[],
  requestedIn: string, requestedOut: string, reason: string
): Promise<{ inserted: number; error: string | null }> {
  if (!days.length) return { inserted: 0, error: 'No eligible days in that range.' }

  const rows = days.map(d => ({
    employee_id: empId,
    attendance_date: d.date,
    recorded_in: d.recordedIn,
    recorded_out: d.recordedOut,
    requested_in: requestedIn,
    requested_out: requestedOut,
    reason,
    status: 'PENDING',
  }))

  const { error } = await supabase
    .from('attendance_regularisation')
    .upsert(rows, { onConflict: 'employee_id,attendance_date' })

  return { inserted: error ? 0 : rows.length, error: error?.message || null }
}

// ── Day status resolution (priority: HOLIDAY > WEEKLY_OFF > ON_LEAVE > record.status) ──
export interface DayInfo { status: string; rec: AttendanceRecord | null; holiday: HolidayInfo | null; leave: LeaveDay | null }
export function resolveDay(dateStr: string, m: MonthlyData, todayStr: string): DayInfo {
  const rec = m.recMap.get(dateStr) || null
  const holiday = m.holidayMap.get(dateStr) || null
  const leave = m.leaveMap.get(dateStr) || null
  if (holiday) return { status: 'HOLIDAY', rec, holiday, leave: null }
  if (m.weekoffSet.has(dateStr)) return { status: 'WEEKLY_OFF', rec, holiday: null, leave: null }
  if (leave) return { status: 'ON_LEAVE', rec, holiday: null, leave }
  if (rec) {
    if ((!rec.work_in || !rec.work_out) && rec.status === 'PRESENT') return { status: 'MISS_PUNCH', rec, holiday: null, leave: null }
    return { status: rec.status, rec, holiday: null, leave: null }
  }
  if (dateStr > todayStr) return { status: 'FUTURE', rec: null, holiday: null, leave: null }
  return { status: 'ABSENT', rec: null, holiday: null, leave: null }
}

export interface MonthlySummary { present: number; absent: number; halfDay: number; lateCount: number; totalOTHours: string; lopDays: number; missPunch: number }
export function computeSummary(records: AttendanceRecord[]): MonthlySummary {
  let present = 0, absent = 0, halfDay = 0, lateCount = 0, totalOT = 0, lop = 0, miss = 0
  records.forEach(r => {
    if (r.status === 'PRESENT') present++
    if (r.status === 'ABSENT') absent++
    if (r.status === 'HALF_DAY') halfDay++
    if (r.late_minutes > 0) lateCount++
    totalOT += r.overtime_minutes || 0
    if (r.lop_applicable) lop++
    if ((!r.work_in || !r.work_out) && r.status === 'PRESENT') miss++
  })
  return { present, absent, halfDay, lateCount, lopDays: lop, missPunch: miss, totalOTHours: (totalOT / 60).toFixed(1) + 'h' }
}
