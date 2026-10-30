// src/features/social/wall/rpc.ts — the phone's copy of lib/wall/rpc.ts.
//
// Same wire and the same { data, error } contract: POST /api/ess/wall with
// { action, ...args, employee_id }. The route resolves the actor from the ESS
// token and calls the service-role `_as` wrapper; the device never calls a wall
// RPC directly. (lib/wall/rpc.ts cannot be shared: it imports the browser's
// auth headers and fetches a relative URL.)
import { api, ApiError } from '@/core/api'

export interface WallResult<T = unknown> {
  data: T | null
  error: { message: string; status?: number; installed?: boolean } | null
}

export async function wallRpc<T = unknown>(action: string, args: Record<string, unknown> = {}, employeeId?: string): Promise<WallResult<T>> {
  try {
    const payload = await api<{ data?: T } | null>('/api/ess/wall', {
      method: 'POST',
      body: { action, ...args, ...(employeeId ? { employee_id: employeeId } : {}) },
    })
    return { data: (payload?.data ?? null) as T | null, error: null }
  } catch (e) {
    if (e instanceof ApiError) {
      // Offline → the website's own sentence. A bodiless failure → its fallback.
      if (e.status === 0) return { data: null, error: { message: 'Could not reach the server.' } }
      const body = e.body && typeof e.body === 'object' ? e.body : null
      return {
        data: null,
        error: { message: body?.error ?? `The request failed (${e.status}).`, status: e.status, installed: body?.installed },
      }
    }
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}
