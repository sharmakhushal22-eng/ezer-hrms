// lib/funzone/client.ts — the browser's side of /api/ess/funzone.
//
// Fun Zone multiplayer used to talk to Supabase straight from the component:
// a bare insert to send an invite, and RPCs that identify the player through a
// session setting PostgREST cannot set. So nobody was notified and nobody
// could join. Everything now goes through the route, which knows who you are.

import { authHeaders } from '@/lib/auth-headers'
import type { Invite } from '@/lib/funzone/invite'

export type InviteRow = Invite & { sessionId: string | null }

export interface FzResult<T = unknown> {
  data: T | null
  error: { message: string; status?: number } | null
}

async function call<T>(init: RequestInit): Promise<FzResult<T>> {
  try {
    const res = await fetch('/api/ess/funzone', { ...init, headers: await authHeaders() })
    const payload = await res.json().catch(() => null) as (Record<string, unknown> | null)
    if (!res.ok) {
      return { data: null, error: {
        message: String(payload?.error ?? `Request failed (${res.status}).`), status: res.status } }
    }
    return { data: (payload ?? null) as T, error: null }
  } catch {
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}

export const listInvites = () =>
  call<{ installed: boolean; invites: InviteRow[]; me?: string; reason?: string }>({ method: 'GET' })

export const funzone = <T = unknown>(action: string, args: Record<string, unknown> = {}) =>
  call<T>({ method: 'POST', body: JSON.stringify({ action, ...args }) })
