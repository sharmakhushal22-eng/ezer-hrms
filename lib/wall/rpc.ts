// lib/wall/rpc.ts
//
// The wall's client-side call. Replaces supabase.rpc(...) in the wall
// components and returns the same { data, error } shape, so call sites read
// as they did before.
//
// The browser must not call these functions directly. They derive the actor
// from a session setting that cannot survive a PostgREST request, so a direct
// call gets 'No acting employee in session.' — and the 094 wrappers that fix
// it take the actor as an argument, which makes them service-role only. The
// route resolves who you are from the session; this is just the wire to it.

import { authHeaders } from '@/lib/auth-headers'

export interface WallResult<T = unknown> {
  data: T | null
  error: { message: string; status?: number; installed?: boolean } | null
}

export async function wallRpc<T = unknown>(
  action: string,
  args: Record<string, unknown> = {},
  /** Whose portal this is. An ESS session already identifies the person and
   *  ignores this; a dashboard admin looking at an ESS screen has no employee
   *  of their own, and essCaller answers 400 without it. Omitting it was the
   *  bug that made the ESS inbox 401 for admins. */
  employeeId?: string,
): Promise<WallResult<T>> {
  try {
    const res = await fetch('/api/ess/wall', {
      method: 'POST',
      // authHeaders carries the bearer token from whichever session the person
      // has, ESS or dashboard. Without it requireDashboardUser answers 401
      // before the route runs at all.
      headers: await authHeaders(),
      body: JSON.stringify({ action, ...args, ...(employeeId ? { employee_id: employeeId } : {}) }),
    })

    // A body is expected either way; a proxy or a crash can still return HTML,
    // and JSON.parse on that would throw past the caller's error handling.
    const payload = await res.json().catch(() => null) as
      { data?: T; error?: string; installed?: boolean } | null

    if (!res.ok) {
      return {
        data: null,
        error: {
          message: payload?.error ?? `The request failed (${res.status}).`,
          status: res.status,
          installed: payload?.installed,
        },
      }
    }
    return { data: (payload?.data ?? null) as T | null, error: null }
  } catch {
    // Offline, or the request was cut. Say that rather than letting a
    // TypeError surface as "something went wrong".
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}
