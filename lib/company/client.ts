'use client'
// lib/company/client.ts — the browser half of authorised editing.
//
// Every write goes through /api/company/profile, never to Supabase directly.
// That is the whole point: the old path called supabase.from(...).update from
// the browser with the anon key, so the write was authorised by "can load the
// page". These helpers cannot bypass the check because they do not hold a
// service key — the route does.

import { supabase } from '@/lib/supabase'
import { essAuthHeaders } from '@/lib/ess-session-client'

export interface EditRight { canEdit: boolean; reason: string; actor: string }

async function authHeaders(): Promise<Record<string, string>> {
  const h = essAuthHeaders()
  if (h.Authorization) return { 'Content-Type': 'application/json', ...h }
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

/** Ask the server whether this person may edit. Asked rather than assumed:
 *  the client does not know the role model, and a button shown on a guess is
 *  a button that 403s on click. */
export async function fetchEditRight(): Promise<EditRight> {
  try {
    const r = await fetch('/api/company/profile', { headers: await authHeaders() })
    if (!r.ok) return { canEdit: false, reason: `Not authorised (${r.status})`, actor: 'unknown' }
    return await r.json()
  } catch {
    return { canEdit: false, reason: 'Could not reach the server.', actor: 'unknown' }
  }
}

async function send(method: string, body: unknown) {
  const r = await fetch('/api/company/profile', { method, headers: await authHeaders(), body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}

export const updateRow = (entity: string, id: string, patch: Record<string, unknown>) =>
  send('PATCH', { entity, id, patch })

export const createRow = (entity: string, company_id: string | null, row: Record<string, unknown>) =>
  send('POST', { entity, company_id, row })

/** Soft delete — the route sets status='Inactive'. Named `archiveRow` rather
 *  than `deleteRow` so a caller is not surprised that the row survives. */
export const archiveRow = (entity: string, id: string) =>
  send('DELETE', { entity, id })
