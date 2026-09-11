'use client'
// lib/company/client.ts — the browser half of authorised editing.
//
// Every write goes through /api/company/profile, never to Supabase directly.
// That is the whole point: the old path called supabase.from(...).update from
// the browser with the anon key, so the write was authorised by "can load the
// page". These helpers cannot bypass the check because they do not hold a
// service key — the route does.


export interface EditRight { canEdit: boolean; reason: string; actor: string }

// Moved to lib/auth-headers, so the ESS inbox and the admin panel could not
// each invent their own version. Both did, and both got it wrong.
import { authHeaders } from '@/lib/auth-headers'

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

// ── The certificate behind a registration ───────────────────────────────────
// Its own endpoint rather than the generic row writer, because a file is not
// a column: it needs multipart in, a signed URL out, and the old bytes
// cleaned up when it is replaced.

export interface RegDoc { url: string; name: string; mime: string; inline: boolean }

/** Upload or replace. Refused server-side unless the caller holds an EZER
 *  admin role — the file input is hidden for everyone else, but that is
 *  cosmetic and the route is the actual rule. */
export async function uploadRegDoc(registrationId: string, file: File) {
  const fd = new FormData()
  fd.append('registration_id', registrationId)
  fd.append('file', file)
  // No Content-Type header: the browser must set the multipart boundary
  // itself, and passing our JSON headers here would break the parse.
  const h = await authHeaders()
  delete (h as any)['Content-Type']
  const r = await fetch('/api/company/registration-doc', { method: 'POST', headers: h, body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Upload failed.')
  return j
}

/** A short-lived signed URL. Fetched at the moment of opening rather than
 *  held in state, so a link cannot be shared out of the page and still work. */
export async function regDocUrl(registrationId: string): Promise<RegDoc> {
  const r = await fetch(`/api/company/registration-doc?id=${registrationId}`,
                        { headers: await authHeaders() })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Could not open that document.')
  return j as RegDoc
}

export async function removeRegDoc(registrationId: string) {
  const r = await fetch(`/api/company/registration-doc?id=${registrationId}`,
                        { method: 'DELETE', headers: await authHeaders() })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Could not remove that document.')
  return j
}
