// src/features/funzone/live/client.ts — the app's side of /api/ess/funzone.
//
// Re-implementation of the website's lib/funzone/client.ts on top of the app's
// `api` (ESS bearer token, absolute base URL). Same contract: never throws,
// always `{ data, error: { message, status? } }`, and once setFunzoneOwner has
// run every call — GET and POST — carries ?employee_id=<portal owner>.
import { api, ApiError } from '@/core/api'
import type { Invite } from '@web/funzone/invite'

export type InviteRow = Invite & { sessionId: string | null }

export interface FzResult<T = unknown> {
  data: T | null
  error: { message: string; status?: number } | null
}

/** Whose portal this is (lib/funzone/client.ts). PlayTogether sets it on every load. */
let portalOwner: string | null = null
export const setFunzoneOwner = (id: string | null) => { portalOwner = id }

const UNREACHABLE = 'Could not reach the server.'

async function call<T>(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<FzResult<T>> {
  try {
    const data = await api<T>('/api/ess/funzone', { method, body, employeeId: portalOwner ?? undefined })
    return { data: (data ?? null) as T | null, error: null }
  } catch (e) {
    if (e instanceof ApiError) {
      // status 0 = fetch threw (the website's catch branch, which has no status).
      if (e.status === 0) return { data: null, error: { message: UNREACHABLE } }
      const b = e.body
      const msg = b && typeof b === 'object' && b.error != null ? String(b.error) : `Request failed (${e.status}).`
      return { data: null, error: { message: msg, status: e.status } }
    }
    return { data: null, error: { message: UNREACHABLE } }
  }
}

export const listInvites = () =>
  call<{ installed: boolean; invites: InviteRow[]; me?: string; reason?: string }>('GET')

export const funzone = <T = unknown>(action: string, args: Record<string, unknown> = {}) =>
  call<T>('POST', { action, ...args })
