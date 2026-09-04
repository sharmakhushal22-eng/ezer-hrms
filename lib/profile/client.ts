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

async function call<T>(init: RequestInit, qs = ''): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/ess/profile${qs}`, { ...init, headers: await authHeaders() })
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
