// lib/profile/client.ts — the browser's side of /api/ess/profile.
//
// The profile is never read from Supabase directly. get_employee_profile()
// decides what this viewer may see and strips the rest server-side; a direct
// table or view read would walk straight past that, which is exactly the hole
// migration 100 closes on v_employee_profile_360.

import { authHeaders } from '@/lib/auth-headers'
import type { ProfilePayload } from '@/lib/profile/types'

export interface Result<T> {
  data: T | null
  error: { message: string; status?: number } | null
}

/** Whose portal this is. An ESS session already identifies the person and
 *  ignores it; the shared dashboard login has no employee of its own, and
 *  essCaller answers 400 "employee_id is required for the dashboard login"
 *  without it. Omitting it is why the Profile tab broke on that login. */
let portalOwner: string | null = null
export const setProfileOwner = (id: string | null) => { portalOwner = id }

async function call<T>(init: RequestInit, qs = '', path = ''): Promise<Result<T>> {
  try {
    const sep = qs.includes('?') ? '&' : '?'
    const owner = portalOwner ? `${sep}employee_id=${encodeURIComponent(portalOwner)}` : ''
    const res = await fetch(`/api/ess/profile${path}${qs}${owner}`, { ...init, headers: await authHeaders() })
    const body = await res.json().catch(() => null) as (Record<string, unknown> | null)
    if (!res.ok) {
      return { data: null, error: { message: String(body?.error ?? `Request failed (${res.status}).`), status: res.status } }
    }
    return { data: (body ?? null) as T, error: null }
  } catch {
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}

/** No code = my own profile. */
export const loadProfile = (code?: string) =>
  call<ProfilePayload>({ method: 'GET' }, code ? `?code=${encodeURIComponent(code)}` : '')

export const editField = (key: string, value: string) =>
  call<{ ok: true; saved: string }>({ method: 'POST', body: JSON.stringify({ action: 'edit', key, value }) })

export const requestChange = (key: string, value: string, reason: string) =>
  call<{ ok: true; request_id: string }>({
    method: 'POST', body: JSON.stringify({ action: 'request', key, value, reason }),
  })

// ── change requests (105) ───────────────────────────────────────────────
//
// Same employee_id handling as everything above: the shared dashboard login
// carries no employee of its own, and leaving it off is what broke the Profile
// tab on that login. These go through the same call() for exactly that reason.

export interface MyRequest {
  id: string; field_key: string; field_label: string
  old_value: string | null; new_value: string; reason: string | null
  status: string; stage_label: string; remarks: string | null
  requested_at: string; decided_at: string | null
}

export interface QueueRequest {
  id: string; employee_id: string; emp_code: string; employee: string
  field_key: string; field_label: string
  old_value: string | null; new_value: string; reason: string | null
  route_to: string; status: string; stage_label: string
  requested_at: string; waiting_days: number
}

export const loadMyRequests = () =>
  call<{ ok: true; requests: MyRequest[] }>({ method: 'GET' }, '?scope=mine', '/requests')

export const loadReviewQueue = () =>
  call<{ ok: true; requests: QueueRequest[] }>({ method: 'GET' }, '?scope=queue', '/requests')

export const decideRequest = (id: string, decision: 'approve' | 'reject', remarks?: string) =>
  call<{ ok: true; status: string; applied: boolean; message?: string }>({
    method: 'POST', body: JSON.stringify({ action: decision, id, remarks }),
  }, '', '/requests')

export const cancelRequest = (id: string) =>
  call<{ ok: true; status: string }>({
    method: 'POST', body: JSON.stringify({ action: 'cancel', id }),
  }, '', '/requests')
