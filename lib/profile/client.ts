// lib/profile/client.ts — the browser's side of /api/ess/profile.
//
// The profile is never read from Supabase directly. get_employee_profile()
// decides what this viewer may see and strips the rest server-side; a direct
// table or view read would walk straight past that, which is exactly the hole
// migration 100 closes on v_employee_profile_360.

import { authHeaders, uploadAuthHeaders } from '@/lib/auth-headers'
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
  call<{ ok: true; request_id: string; status?: string; waiting_on?: string | null }>({
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
  /** Added by the route: "HR — Asha Rao" while pending, null once decided. */
  waiting_on?: string | null
  decided_by?: string | null
  route_to?: string | null
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

// ── self-service editors (POST /api/ess/profile/self-service) ────────────
//
// Multipart, because several of them carry a file (an Aadhaar card, a
// cancelled cheque). uploadAuthHeaders, never authHeaders: the latter sets
// Content-Type: application/json, which strips the multipart boundary — the
// exact bug that kept the photo upload from ever working (see PhotoUploader).

export interface SelfServiceResult { ok: true; message?: string; waiting_on?: string | null; status?: string }

export async function selfService(payload: Record<string, unknown>, file?: File | null): Promise<Result<SelfServiceResult>> {
  try {
    const fd = new FormData()
    fd.append('payload', JSON.stringify(payload))
    if (file) fd.append('file', file)
    const owner = portalOwner ? `?employee_id=${encodeURIComponent(portalOwner)}` : ''
    const res = await fetch(`/api/ess/profile/self-service${owner}`, { method: 'POST', body: fd, headers: await uploadAuthHeaders() })
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    if (!res.ok) return { data: null, error: { message: String(body?.error ?? `Request failed (${res.status}).`), status: res.status } }
    return { data: body as unknown as SelfServiceResult, error: null }
  } catch {
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}

export interface DocOnFile {
  id: string; doc_type: string; label: string; status: string
  uploaded_at: string | null; remarks: string | null; source: 'profile' | 'onboarding'; url: string | null
}
export interface DocRequired { code: string; label: string; mandatory: boolean; hint?: string }

export const loadDocuments = () =>
  call<{ ok: true; required: DocRequired[]; documents: DocOnFile[] }>({ method: 'GET' }, '?scope=documents', '/self-service')

/** Fired on window after any profile save, so whatever else shows the person
 *  (the portal header's avatar, mainly) can refresh itself. */
export const PROFILE_UPDATED = 'ez:profile-updated'
export function announceProfileUpdate(detail: { photoUrl?: string | null } = {}) {
  try { window.dispatchEvent(new CustomEvent(PROFILE_UPDATED, { detail })) } catch { /* SSR / old browser */ }
}
