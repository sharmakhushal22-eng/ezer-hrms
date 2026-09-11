// lib/pms/adminClient.ts — the browser's side of app/api/pms/admin.
//
// Every PMS admin write goes through here. The components never touch Supabase
// directly for these: the actor has to come from the bearer token, and the
// route allowlists which columns may be set. A component writing straight to
// the table would bypass both.

import { authHeaders } from '@/lib/auth-headers'

export interface PmsAdminResult<T = unknown> {
  data: T | null
  /** 428 means the route wants an explicit confirm — see openPeriod. */
  error: { message: string; status?: number } | null
}

async function call<T>(init: RequestInit): Promise<PmsAdminResult<T>> {
  try {
    // authHeaders covers both session kinds — an ESS token and a dashboard
    // login. Sending neither is how the inbox shipped 401ing for everyone.
    const res = await fetch('/api/pms/admin', { ...init, headers: await authHeaders() })
    const payload = await res.json().catch(() => null) as
      { data?: T; error?: string } & Record<string, unknown> | null
    if (!res.ok) {
      return { data: null, error: { message: payload?.error ?? `Request failed (${res.status}).`, status: res.status } }
    }
    return { data: (payload?.data ?? payload ?? null) as T, error: null }
  } catch {
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}

export interface PmsAdminSnapshot {
  policies: Record<string, unknown>[]
  kras: Record<string, unknown>[]
  scale: Record<string, unknown>[]
  periods: Record<string, unknown>[]
  actor: { employeeId: string | null; name: string | null; legacy: boolean }
}

export const loadPmsAdmin = () => call<PmsAdminSnapshot>({ method: 'GET' })

export const pmsAdmin = <T = unknown>(action: string, args: Record<string, unknown> = {}) =>
  call<T>({ method: 'POST', body: JSON.stringify({ action, ...args }) })
