// lib/supabase-holidays.ts — Holiday & Weekly-off Config data layer
// CRUD over the 6 config tables (migration 026) + branch mapping + weekend
// conflict check + thin RPC wrappers around resolve_holidays / resolve_weekly_offs.
// Single source of truth for both the admin config UI and any ESS/attendance read.
import { supabase } from '@/lib/supabase'

// ── Types (mirror migration 026) ────────────────────────────────────
export type CalendarType = 'HOLIDAY' | 'LEAVE'
export type CalendarStatus = 'DRAFT' | 'PUBLISHED'
export type HolidayType = 'NATIONAL' | 'FESTIVAL' | 'DISCRETIONARY' | 'REGIONAL' | 'OPTIONAL'
export type WeeklyMode = 'EVERY' | 'NTH'

export interface HolidayCalendar {
  id: string; name: string; calendar_type: CalendarType
  from_date: string | null; to_date: string | null; status: CalendarStatus; created_at: string
}
export interface CompanyCalendarMap {
  id: string; company_id: string; holiday_calendar_id: string | null; leave_calendar_id: string | null
}
export interface HolidayEntry {
  id: string; calendar_id: string; holiday_date: string; description: string
  holiday_type: HolidayType; is_optional: boolean; on_weekly_off: boolean; created_at: string
}
export interface HolidayApplicability {
  id: string; holiday_id: string; company_id: string; branch_id: string | null
}
export interface WeeklyOff {
  id: string; calendar_id: string | null; weekday: number; mode: WeeklyMode
  nth_occurrences: number[] | null; is_primary: boolean
  company_id: string | null; branch_id: string | null; employment_type: string | null; created_at: string
}
export interface ResolvedHoliday { holiday_date: string; description: string; holiday_type: HolidayType; is_optional: boolean }

// lightweight lookups
export interface CompanyLite { id: string; company_name: string; company_code: string }
export interface BranchLite { id: string; location_name: string; company_id: string }
export interface EmployeeLite { id: string; full_name: string; emp_code: string; company_id: string; location_id: string | null; employment_type: string | null }

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const HOLIDAY_TYPES: HolidayType[] = ['NATIONAL', 'FESTIVAL', 'DISCRETIONARY', 'REGIONAL', 'OPTIONAL']

// ── Lookups (existing master tables) ────────────────────────────────
export async function listCompanies(): Promise<CompanyLite[]> {
  const { data } = await supabase.from('companies').select('id, company_name, company_code').eq('status', 'Active').order('company_code')
  return (data || []) as CompanyLite[]
}
export async function listBranches(): Promise<BranchLite[]> {
  const { data } = await supabase.from('locations').select('id, location_name, company_id').eq('status', 'Active').order('location_name')
  return (data || []) as BranchLite[]
}
export async function listEmployees(): Promise<EmployeeLite[]> {
  const { data } = await supabase
    .from('employees')
    .select('id, full_name, emp_code, company_id, location_id, employment_type')
    .neq('is_test', true)
    .order('full_name')
  return (data || []) as EmployeeLite[]
}

// ── Calendars ───────────────────────────────────────────────────────
export async function listCalendars(): Promise<HolidayCalendar[]> {
  const { data } = await supabase.from('holiday_calendar').select('*').order('from_date', { ascending: false })
  return (data || []) as HolidayCalendar[]
}
export async function createCalendar(input: { name: string; calendar_type: CalendarType; from_date: string; to_date: string }) {
  return supabase.from('holiday_calendar').insert({ ...input, status: 'DRAFT' }).select().maybeSingle()
}
export async function setCalendarStatus(id: string, status: CalendarStatus) {
  return supabase.from('holiday_calendar').update({ status }).eq('id', id)
}
export async function deleteCalendar(id: string) {
  return supabase.from('holiday_calendar').delete().eq('id', id)
}

// ── Company ↔ calendar mapping ──────────────────────────────────────
export async function listCompanyMaps(): Promise<CompanyCalendarMap[]> {
  const { data } = await supabase.from('company_calendar_map').select('*')
  return (data || []) as CompanyCalendarMap[]
}
// one mapping per company (company_id is UNIQUE) → upsert on conflict.
export async function upsertCompanyMap(input: { company_id: string; holiday_calendar_id: string | null; leave_calendar_id: string | null }) {
  return supabase.from('company_calendar_map').upsert(input, { onConflict: 'company_id' })
}

// ── Holiday entries + applicability ─────────────────────────────────
export async function listHolidays(calendar_id: string): Promise<HolidayEntry[]> {
  const { data } = await supabase.from('holiday_entries').select('*').eq('calendar_id', calendar_id).order('holiday_date')
  return (data || []) as HolidayEntry[]
}
export async function listApplicability(holiday_ids: string[]): Promise<HolidayApplicability[]> {
  if (!holiday_ids.length) return []
  const { data } = await supabase.from('holiday_applicability').select('*').in('holiday_id', holiday_ids)
  return (data || []) as HolidayApplicability[]
}

// Create a holiday + its applicability rows + (optional) override-log in one call.
// applicability: array of { company_id, branch_id|null }. branch_id null = all branches.
export async function createHoliday(input: {
  calendar_id: string; holiday_date: string; description: string; holiday_type: HolidayType
  is_optional: boolean; on_weekly_off: boolean
  applicability: { company_id: string; branch_id: string | null }[]
  override?: { weekday: string; confirmed_by: string; note?: string }
}) {
  const { data: he, error } = await supabase.from('holiday_entries').insert({
    calendar_id: input.calendar_id, holiday_date: input.holiday_date, description: input.description,
    holiday_type: input.holiday_type, is_optional: input.is_optional, on_weekly_off: input.on_weekly_off,
  }).select().maybeSingle()
  if (error || !he) return { error: error || new Error('insert failed') }

  if (input.applicability.length) {
    const rows = input.applicability.map(a => ({ holiday_id: he.id, company_id: a.company_id, branch_id: a.branch_id }))
    const { error: ae } = await supabase.from('holiday_applicability').insert(rows)
    if (ae) return { error: ae }
  }
  if (input.override) {
    await supabase.from('holiday_override_log').insert({
      holiday_id: he.id, holiday_date: input.holiday_date,
      weekday: input.override.weekday, confirmed_by: input.override.confirmed_by, note: input.override.note || null,
    })
  }
  return { data: he as HolidayEntry }
}
export async function deleteHoliday(id: string) {
  // applicability + override rows cascade via FK ON DELETE CASCADE.
  return supabase.from('holiday_entries').delete().eq('id', id)
}

// ── Weekly off ──────────────────────────────────────────────────────
export async function listWeeklyOffs(): Promise<WeeklyOff[]> {
  const { data } = await supabase.from('weekly_off_config').select('*').order('weekday')
  return (data || []) as WeeklyOff[]
}
export async function createWeeklyOff(input: {
  calendar_id: string | null; weekday: number; mode: WeeklyMode; nth_occurrences: number[] | null
  is_primary: boolean; company_id: string | null; branch_id: string | null; employment_type: string | null
}) {
  return supabase.from('weekly_off_config').insert(input)
}
export async function deleteWeeklyOff(id: string) {
  return supabase.from('weekly_off_config').delete().eq('id', id)
}

// ── Weekend-conflict check (real config, not hardcoded) ─────────────
// Does `dateStr` (yyyy-mm-dd) land on a weekly-off for the given company scope?
// Mirrors resolve_weekly_offs day-match logic, client-side, for the add-holiday popup.
export function weekendConflict(dateStr: string, rules: WeeklyOff[], company_id?: string | null): { conflict: boolean; weekday: string } {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()            // 0=Sun..6=Sat (matches Postgres DOW)
  const dom = d.getDate()
  const nth = Math.floor((dom - 1) / 7) + 1
  const hit = rules.some(w => {
    if (w.weekday !== dow) return false
    if (w.company_id && company_id && w.company_id !== company_id) return false
    if (w.mode === 'EVERY') return true
    return Array.isArray(w.nth_occurrences) && w.nth_occurrences.includes(nth)
  })
  return { conflict: hit, weekday: WEEKDAYS[dow] }
}

// ── Resolver RPC wrappers (single source of truth) ──────────────────
export async function resolveHolidays(employee_id: string): Promise<ResolvedHoliday[]> {
  const { data, error } = await supabase.rpc('resolve_holidays', { p_employee_id: employee_id })
  if (error) throw error
  return (data || []) as ResolvedHoliday[]
}
export async function resolveWeeklyOffs(employee_id: string, from: string, to: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('resolve_weekly_offs', { p_employee_id: employee_id, p_from: from, p_to: to })
  if (error) throw error
  return ((data || []) as { off_date: string }[]).map(r => r.off_date)
}
