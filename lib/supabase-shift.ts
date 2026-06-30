// lib/supabase-shift.ts — Shift config + attendance data layer (migration 036)
import { supabase } from '@/lib/supabase'

export const SHIFT_TYPES = ['GENERAL', 'MORNING', 'AFTERNOON', 'NIGHT', 'SPLIT', 'ROTATING'] as const

export interface Shift {
  id: string; shift_code: string; shift_type: string; company_id: string
  branch_id?: string | null; department_id?: string | null
  in_time: string; late_allowed_till: string; max_late_punch: string | null
  lunch_start: string | null; lunch_duration_mins: number; out_time: string; max_out_punch: string | null
  overtime_applicable: boolean; effective_from: string; is_active: boolean
}
export interface ShiftAssignment { id: string; employee_id: string; shift_id: string; effective_from: string; effective_till: string | null; is_active: boolean; overtime_applicable: boolean | null }
export interface AttRecord {
  id: string; employee_id: string; attendance_date: string; shift_id: string | null
  work_in: string | null; work_out: string | null; total_minutes: number | null; late_minutes: number
  status: string; lop_applicable: boolean; overtime_minutes: number; punch_count: number; source: string | null
}
export interface CompanyLite { id: string; name: string; code?: string }
export interface EmpLite { id: string; emp_code: string; full_name: string; company_id: string; dept_name: string | null; location_name: string | null }

// ── Lookups ─────────────────────────────────────────────────────────
export async function loadCompanies(): Promise<CompanyLite[]> {
  const { data } = await supabase.from('companies').select('id, company_name, company_code').eq('status', 'Active').order('company_name')
  return (data || []).map((c: any) => ({ id: c.id, name: c.company_name, code: c.company_code }))
}
export async function loadEmployees(): Promise<EmpLite[]> {
  const { data } = await supabase.from('employees')
    .select('id, emp_code, full_name, company_id, departments(dept_name), locations!location_id(location_name)')
    .neq('is_test', true).order('full_name')
  return (data || []).map((e: any) => ({
    id: e.id, emp_code: e.emp_code, full_name: e.full_name, company_id: e.company_id,
    dept_name: e.departments?.dept_name || null, location_name: e.locations?.location_name || null,
  }))
}
export interface LocationLite { id: string; name: string; company_id: string }
export async function loadLocations(): Promise<LocationLite[]> {
  const { data } = await supabase.from('locations').select('id, location_name, company_id').eq('status', 'Active').order('location_name')
  return (data || []).map((l: any) => ({ id: l.id, name: l.location_name, company_id: l.company_id }))
}
export interface DeptLite { id: string; name: string; company_id: string }
export async function loadDepartments(): Promise<DeptLite[]> {
  const { data } = await supabase.from('departments').select('id, dept_name, company_id').eq('status', 'Active').order('dept_name')
  return (data || []).map((d: any) => ({ id: d.id, name: d.dept_name, company_id: d.company_id }))
}

// ── Shifts ──────────────────────────────────────────────────────────
export async function loadShifts(): Promise<Shift[]> {
  const { data } = await supabase.from('shift_master').select('*').order('created_at', { ascending: false })
  return (data || []) as Shift[]
}
// shift_code omitted → DB trigger auto-generates it.
export async function createShift(input: Omit<Shift, 'id' | 'shift_code' | 'is_active'>) {
  return supabase.from('shift_master').insert(input).select().maybeSingle()
}
export async function setShiftActive(id: string, is_active: boolean) {
  return supabase.from('shift_master').update({ is_active }).eq('id', id)
}
export async function deleteShift(id: string) {
  return supabase.from('shift_master').delete().eq('id', id)
}

// ── Assignments ─────────────────────────────────────────────────────
export async function loadActiveAssignments(): Promise<ShiftAssignment[]> {
  const { data } = await supabase.from('employee_shift_assignment').select('*').eq('is_active', true)
  return (data || []) as ShiftAssignment[]
}
// Assign a shift to employees: deactivate any current active assignment, then add new.
export async function assignShift(employee_ids: string[], shift_id: string, effective_from: string) {
  if (!employee_ids.length) return { error: { message: 'No employees selected' } }
  await supabase.from('employee_shift_assignment').update({ is_active: false }).in('employee_id', employee_ids).eq('is_active', true)
  return supabase.from('employee_shift_assignment').insert(
    employee_ids.map(id => ({ employee_id: id, shift_id, effective_from, assigned_by: 'Admin', is_active: true }))
  )
}

// ── Attendance records (processed) ──────────────────────────────────
// Attendance over a date range (inclusive). Pass the same value for from & to for a single day.
export async function loadAttendance(from: string, to: string): Promise<AttRecord[]> {
  const { data } = await supabase.from('attendance_records').select('*')
    .gte('attendance_date', from).lte('attendance_date', to)
    .order('attendance_date', { ascending: false })
  return (data || []) as AttRecord[]
}
