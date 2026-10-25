// src/features/attendance/api.ts — every read and write the Attendance screen makes.
//
// All through GET/POST/PATCH /api/ess/attendance (spec §4), with ?employee_id=
// as the website's lib/ess/api.ts appends it. The one direct Supabase read the
// website still makes (loadDayPunches) is replaced by the API's `day_punches`,
// as the spec recommends — same columns, same order, scoped by the token.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { invalidate } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import { toMonthly, type AttendanceRange, type FileResult, type RegularisationRequest } from './model'

const PATH = '/api/ess/attendance'
// Every query waits for the session: on a cold start straight into this route the
// screen can render before the stored session is restored, and a call without the
// token is a 401.

/** The month grid — loadMonthlyAttendance(emp.id, year, month). */
export function useMonth(year: number, month: number) {
  const employeeId = useEmployeeId()
  const ym = `${year}-${String(month).padStart(2, '0')}`
  return useQuery({
    queryKey: ['attendance', 'month', employeeId, ym],
    queryFn: async () => toMonthly(await api<AttendanceRange>(PATH, { query: { month: ym }, employeeId })),
    enabled: !!employeeId,
  })
}

/** "My Regularisation Requests" — GET with no params, only `regularisations` kept. */
export function useRegularisations() {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['attendance', 'regs', employeeId],
    queryFn: async () => ((await api<AttendanceRange>(PATH, { employeeId })).regularisations || []) as RegularisationRequest[],
    enabled: !!employeeId,
  })
}

/** One day's raw punches, for the day panel's timeline. */
export function useDayPunches(date: string) {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['attendance', 'punches', employeeId, date],
    queryFn: async () => (await api<AttendanceRange>(PATH, { query: { from: date, to: date, date }, employeeId })).day_punches || [],
    enabled: !!employeeId,
  })
}

/** The attendance log's range — loadAttendanceRange(empId, from, to). */
export function useRange(from: string, to: string, enabled: boolean) {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['attendance', 'range', employeeId, from, to],
    queryFn: () => api<AttendanceRange>(PATH, { query: { from, to }, employeeId }),
    enabled: enabled && !!employeeId,
    retry: false,
    // While a new range loads, the old one stays on screen, dimmed (web: opacity .6).
    placeholderData: keepPreviousData,
  })
}

/** Everything a filed or withdrawn correction changes. */
export const afterChange = () => invalidate('attendance', 'today', 'notifications')

export function fileRegularisation(employeeId: string, body:
  | { date: string; requested_in: string; requested_out: string; reason: string }
  | { reason: string; days: { date: string; requested_in: string; requested_out: string }[] }) {
  return api<FileResult>(PATH, { method: 'POST', body, employeeId })
}

export function withdrawRegularisation(employeeId: string, id: string) {
  return api<{ ok: true; status: 'CANCELLED' }>(PATH, { method: 'PATCH', body: { id }, employeeId })
}
