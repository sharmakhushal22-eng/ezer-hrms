// ================================================================
// EZER HRMS — Attendance Report engine
// Path: lib/attendance/reports.ts
//
// One catalog of HR-grade attendance reports. Every report starts from
// the same common employee columns (Company, Code, Name, Father, Location,
// Department, Sub-dept, Reporting Manager, Company/Group DOJ, Date of
// Leaving) and layers report-specific columns on top. Returns a flat
// { columns, rows } shape the page renders and exports to Excel.
// Needs sql61 (date_of_leaving, sub_department_id, regularized_by/at,
// sub_departments, Sabbatical leave type).
// ================================================================
import { supabase } from '@/lib/supabase'

export type ReportGroup = 'Attendance' | 'Exceptions' | 'Leave' | 'Summary'
export interface ReportDef {
  id: string; label: string; group: ReportGroup; desc: string
  dateRange?: boolean; singleEmp?: boolean
}

export const REPORTS: ReportDef[] = [
  { id: 'daily_punch',        label: 'Daily Punch (In / Out)',      group: 'Attendance', desc: 'Every day’s in/out time, status, late & OT for the date range.', dateRange: true },
  { id: 'left_employees',     label: 'Left Employees Attendance',   group: 'Attendance', desc: 'Attendance of employees who have left, with their leaving date.', dateRange: true },
  { id: 'miss_punch',         label: 'Miss Punch — single employee', group: 'Exceptions', desc: 'Days a single employee has a missing in/out punch.', dateRange: true, singleEmp: true },
  { id: 'late_comers',        label: 'Late Comers',                 group: 'Exceptions', desc: 'Employees arriving late — late days & total late time.', dateRange: true },
  { id: 'regularisation',     label: 'Regularisation Audit',        group: 'Exceptions', desc: 'Every regularisation request — who, when, status.', dateRange: true },
  { id: 'absenteeism',        label: 'Absenteeism Summary',         group: 'Summary',    desc: 'Present / Absent / Leave / LOP days & attendance % per employee.', dateRange: true },
  { id: 'overtime',           label: 'Overtime Report',             group: 'Summary',    desc: 'Total overtime hours per employee over the range.', dateRange: true },
  { id: 'abscond',            label: 'Abscond Report',              group: 'Leave',      desc: 'Employees marked Abscond (AB) in the range.', dateRange: true },
  { id: 'sabbatical',         label: 'Sabbatical Report',           group: 'Leave',      desc: 'Employees on Sabbatical in the range.', dateRange: true },
  { id: 'long_leave',         label: 'Long Leave Report',           group: 'Leave',      desc: 'Approved leaves of 15+ days in the range.', dateRange: true },
]

export interface ReportFilters {
  companyId: string
  departmentId?: string
  locationId?: string
  employeeId?: string
  employeeCodes?: string[]   // specific emp codes (pasted) — report is limited to these
  from?: string
  to?: string
}
export interface ReportOutput { columns: string[]; rows: (string | number)[][]; note?: string }

// ── formatting helpers ──
const fmtDate = (d?: string | null) => {
  if (!d) return ''
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtTime = (t?: string | null) => {
  if (!t) return ''
  const dt = new Date(t)
  return isNaN(dt.getTime()) ? String(t) : dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}
const hrs = (min?: number | null) => min ? (Math.round((min / 60) * 100) / 100) : 0

const COMMON_COLS = ['Company', 'Emp Code', 'Employee Name', 'Father Name', 'Location', 'Department', 'Sub Department', 'Reporting Manager', 'Company DOJ', 'Group DOJ', 'Date of Leaving']

interface EmpRow {
  id: string; emp_code: string; full_name: string; father_name: string | null
  employment_status: string | null; group_doj: string | null; company_doj: string | null
  date_of_leaving: string | null; last_working_date: string | null; relieving_date: string | null
  sub_department: string | null; l1_manager_id: string | null; reporting_manager: string | null
  companies?: { company_name: string } | null
  departments?: { dept_name: string } | null
  locations?: { location_name: string } | null
}

async function loadEmployees(f: ReportFilters): Promise<{ emps: EmpRow[]; mgr: (e: EmpRow) => string }> {
  let q = supabase.from('employees').select(`
    id, emp_code, full_name, father_name, employment_status,
    group_doj, company_doj, date_of_leaving, last_working_date, relieving_date,
    sub_department, l1_manager_id, reporting_manager,
    companies(company_name), departments(dept_name), locations!location_id(location_name)
  `).neq('is_test', true)
  if (f.companyId) q = q.eq('company_id', f.companyId)   // empty = all companies
  if (f.departmentId) q = q.eq('department_id', f.departmentId)
  if (f.locationId) q = q.eq('location_id', f.locationId)
  if (f.employeeId) q = q.eq('id', f.employeeId)
  if (f.employeeCodes?.length) q = q.in('emp_code', f.employeeCodes)
  const { data } = await q.order('emp_code')
  const emps = (data || []) as any as EmpRow[]
  const nameById: Record<string, string> = {}
  emps.forEach(e => { nameById[e.id] = e.full_name })
  const mgr = (e: EmpRow) => (e.l1_manager_id && nameById[e.l1_manager_id]) || e.reporting_manager || ''
  return { emps, mgr }
}

function commonRow(e: EmpRow, mgr: (e: EmpRow) => string): (string)[] {
  return [
    e.companies?.company_name || '',
    e.emp_code || '',
    e.full_name || '',
    e.father_name || '',
    e.locations?.location_name || '',
    e.departments?.dept_name || '',
    e.sub_department || '',
    mgr(e),
    fmtDate(e.company_doj),
    fmtDate(e.group_doj),
    fmtDate(e.date_of_leaving || e.last_working_date || e.relieving_date),
  ]
}

// Pull attendance_records for a set of employees within the range.
async function loadAttendance(empIds: string[], from?: string, to?: string) {
  if (!empIds.length) return [] as any[]
  const out: any[] = []
  for (let i = 0; i < empIds.length; i += 200) {
    let q = supabase.from('attendance_records').select('employee_id, attendance_date, work_in, work_out, status, late_minutes, total_minutes, overtime_minutes, punch_count, lop_applicable').in('employee_id', empIds.slice(i, i + 200))
    if (from) q = q.gte('attendance_date', from)
    if (to) q = q.lte('attendance_date', to)
    const { data } = await q
    if (data) out.push(...data)
  }
  return out
}

const PRESENT = new Set(['PRESENT', 'HALF_DAY', 'WFH'])
const ABSENT = new Set(['ABSENT', 'ABSENT_FULL'])
const OFF = new Set(['WEEKLY_OFF', 'HOLIDAY'])
const isLeft = (e: EmpRow) => (e.employment_status && e.employment_status !== 'Active') || !!(e.date_of_leaving || e.last_working_date || e.relieving_date)

export async function runReport(reportId: string, f: ReportFilters): Promise<ReportOutput> {
  const { emps, mgr } = await loadEmployees(f)
  const byId: Record<string, EmpRow> = {}; emps.forEach(e => byId[e.id] = e)

  // ── Attendance: daily punch (optionally only-left) ──
  if (reportId === 'daily_punch' || reportId === 'left_employees') {
    const pool = reportId === 'left_employees' ? emps.filter(isLeft) : emps
    const recs = await loadAttendance(pool.map(e => e.id), f.from, f.to)
    recs.sort((a, b) => (a.employee_id + a.attendance_date).localeCompare(b.employee_id + b.attendance_date))
    const rows = recs.filter(r => byId[r.employee_id]).map(r => {
      const e = byId[r.employee_id]
      return [...commonRow(e, mgr), fmtDate(r.attendance_date), fmtTime(r.work_in), fmtTime(r.work_out), r.status || '', r.late_minutes || 0, hrs(r.total_minutes), hrs(r.overtime_minutes)]
    })
    return { columns: [...COMMON_COLS, 'Date', 'In Time', 'Out Time', 'Status', 'Late (min)', 'Worked (hrs)', 'OT (hrs)'], rows, note: reportId === 'left_employees' ? `${pool.length} left employees` : undefined }
  }

  // ── Miss punch — single employee ──
  if (reportId === 'miss_punch') {
    const recs = await loadAttendance(emps.map(e => e.id), f.from, f.to)
    const miss = recs.filter(r => r.status === 'MISS_PUNCH' || (r.punch_count === 1) || (r.work_in && !r.work_out) || (!r.work_in && r.work_out))
    miss.sort((a, b) => a.attendance_date.localeCompare(b.attendance_date))
    const rows = miss.filter(r => byId[r.employee_id]).map(r => {
      const e = byId[r.employee_id]
      const missing = r.work_in && !r.work_out ? 'OUT missing' : !r.work_in && r.work_out ? 'IN missing' : 'Single punch'
      return [...commonRow(e, mgr), fmtDate(r.attendance_date), fmtTime(r.work_in), fmtTime(r.work_out), missing, r.status || '']
    })
    return { columns: [...COMMON_COLS, 'Date', 'In Time', 'Out Time', 'Missing', 'Status'], rows }
  }

  // ── Late comers (per-employee summary) ──
  if (reportId === 'late_comers') {
    const recs = await loadAttendance(emps.map(e => e.id), f.from, f.to)
    const agg: Record<string, { days: number; mins: number }> = {}
    recs.forEach(r => { if ((r.late_minutes || 0) > 0) { const a = agg[r.employee_id] || (agg[r.employee_id] = { days: 0, mins: 0 }); a.days++; a.mins += r.late_minutes } })
    const rows = Object.keys(agg).filter(id => byId[id]).map(id => {
      const e = byId[id]; const a = agg[id]
      return [...commonRow(e, mgr), a.days, a.mins, hrs(a.mins)]
    })
    return { columns: [...COMMON_COLS, 'Late Days', 'Total Late (min)', 'Total Late (hrs)'], rows }
  }

  // ── Overtime (per-employee) ──
  if (reportId === 'overtime') {
    const recs = await loadAttendance(emps.map(e => e.id), f.from, f.to)
    const agg: Record<string, number> = {}
    recs.forEach(r => { if ((r.overtime_minutes || 0) > 0) agg[r.employee_id] = (agg[r.employee_id] || 0) + r.overtime_minutes })
    const rows = Object.keys(agg).filter(id => byId[id]).map(id => [...commonRow(byId[id], mgr), agg[id], hrs(agg[id])])
    return { columns: [...COMMON_COLS, 'OT (min)', 'OT (hrs)'], rows }
  }

  // ── Absenteeism summary (per-employee) ──
  if (reportId === 'absenteeism') {
    const recs = await loadAttendance(emps.map(e => e.id), f.from, f.to)
    const agg: Record<string, any> = {}
    recs.forEach(r => {
      const a = agg[r.employee_id] || (agg[r.employee_id] = { present: 0, absent: 0, leave: 0, lop: 0, off: 0, total: 0 })
      a.total++
      if (PRESENT.has(r.status)) a.present += r.status === 'HALF_DAY' ? 0.5 : 1
      else if (ABSENT.has(r.status)) a.absent++
      else if (r.status === 'ON_LEAVE') a.leave++
      else if (r.status === 'LWP' || r.lop_applicable) a.lop++
      else if (OFF.has(r.status)) a.off++
    })
    const rows = emps.filter(e => agg[e.id]).map(e => {
      const a = agg[e.id]; const workingDays = a.total - a.off
      const pct = workingDays > 0 ? Math.round((a.present / workingDays) * 1000) / 10 : 0
      return [...commonRow(e, mgr), a.present, a.absent, a.leave, a.lop, a.off, `${pct}%`]
    })
    return { columns: [...COMMON_COLS, 'Present', 'Absent', 'On Leave', 'LOP', 'Off/Holiday', 'Attendance %'], rows }
  }

  // ── Regularisation audit ──
  if (reportId === 'regularisation') {
    const empIds = emps.map(e => e.id)
    const out: any[] = []
    for (let i = 0; i < empIds.length; i += 200) {
      let q = supabase.from('attendance_regularisation').select('*').in('employee_id', empIds.slice(i, i + 200))
      if (f.from) q = q.gte('attendance_date', f.from)
      if (f.to) q = q.lte('attendance_date', f.to)
      const { data } = await q
      if (data) out.push(...data)
    }
    out.sort((a, b) => String(b.attendance_date).localeCompare(String(a.attendance_date)))
    const rows = out.filter(r => byId[r.employee_id]).map(r => [
      ...commonRow(byId[r.employee_id], mgr), fmtDate(r.attendance_date),
      r.requested_in || '', r.requested_out || '', r.reason || '', r.status || '',
      byId[r.reviewed_by]?.full_name || r.reviewed_by || '', fmtDate(r.reviewed_at),
    ])
    return { columns: [...COMMON_COLS, 'Attendance Date', 'Requested In', 'Requested Out', 'Reason', 'Status', 'Reviewed By', 'Reviewed On'], rows }
  }

  // ── Leave-based: abscond / sabbatical / long_leave ──
  if (reportId === 'abscond' || reportId === 'sabbatical' || reportId === 'long_leave') {
    const empIds = emps.map(e => e.id)
    const apps: any[] = []
    for (let i = 0; i < empIds.length; i += 200) {
      let q = supabase.from('leave_applications')
        .select('employee_id, from_date, to_date, days, status, reason, leave_types(short_name, name)')
        .in('employee_id', empIds.slice(i, i + 200))
      if (f.from) q = q.gte('to_date', f.from)
      if (f.to) q = q.lte('from_date', f.to)
      const { data } = await q
      if (data) apps.push(...data)
    }
    const filtered = apps.filter(a => {
      const sn = a.leave_types?.short_name, nm = (a.leave_types?.name || '').toLowerCase()
      if (reportId === 'abscond') return sn === 'AB' || nm.includes('abscond')
      if (reportId === 'sabbatical') return sn === 'SAB' || nm.includes('sabbatical')
      return Number(a.days) >= 15 && (a.status === 'APPROVED')   // long leave
    })
    filtered.sort((a, b) => String(a.from_date).localeCompare(String(b.from_date)))
    const rows = filtered.filter(a => byId[a.employee_id]).map(a => [
      ...commonRow(byId[a.employee_id], mgr), a.leave_types?.name || '', fmtDate(a.from_date), fmtDate(a.to_date), Number(a.days) || '', a.status || '', a.reason || '',
    ])
    return { columns: [...COMMON_COLS, 'Leave Type', 'From', 'To', 'Days', 'Status', 'Reason'], rows }
  }

  return { columns: COMMON_COLS, rows: emps.map(e => commonRow(e, mgr)) }
}
