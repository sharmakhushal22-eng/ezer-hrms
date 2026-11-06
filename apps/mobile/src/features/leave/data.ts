// src/features/leave/data.ts — the three calls the website's Leave tab makes,
// all to /api/ess/leave with ?employee_id= (lib/ess/api.ts appends it).
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { invalidate } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import type { LeaveForm, Payload, Waiting } from './logic'

export const leaveKey = (employeeId: string) => ['leave', employeeId] as const

export function useLeave() {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: leaveKey(employeeId),
    queryFn: () => api<Payload>('/api/ess/leave', { employeeId }),
    enabled: !!employeeId,
  })
}

/** Everything a leave write can move: this tab, Home's figures, the attendance
 *  calendar (approved leave paints days), and the bell. */
export const afterLeaveWrite = () => invalidate('leave', 'today', 'attendance', 'notifications')

export interface ApplyResult {
  ok: true; id: string; days: number; excluded?: string[]
  unrouted?: boolean; waiting_on?: Waiting | null
  split?: { id: string; leave_type: string; from_date: string; to_date: string; days: number }[] | null
}

/** POST — the body is byte-for-byte the website's. */
export function applyLeave(employeeId: string, form: LeaveForm, splitWithLwp: boolean) {
  return api<ApplyResult>('/api/ess/leave', {
    method: 'POST', employeeId,
    body: {
      leave_type_id: form.leave_type_id,
      from_date: form.from_date, to_date: form.to_date,
      half_day: form.half_day,
      half_session: form.half_day ? form.half_session : '',
      reason: form.reason,
      split_with_lwp: splitWithLwp,
    },
  })
}

/** PATCH { id } — withdraw a PENDING request. */
export function withdrawLeave(employeeId: string, id: string) {
  return api<{ ok: true; status: string }>('/api/ess/leave', { method: 'PATCH', employeeId, body: { id } })
}

/** PATCH { id, action:'cancel', reason } — ask the approver to cancel APPROVED leave. */
export function requestLeaveCancel(employeeId: string, id: string, reason: string) {
  return api<{ ok: true; status: string; waiting_on?: Waiting | null; message?: string }>('/api/ess/leave', {
    method: 'PATCH', employeeId, body: { id, action: 'cancel', reason },
  })
}
