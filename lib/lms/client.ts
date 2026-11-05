'use client'
// lib/lms/client.ts — the browser's way to the /api/lms routes.
//
// Two kinds of caller share the same screens: an employee in ESS, and a candidate on their
// /learn link who holds a token nothing else accepts. setCandidateSession() switches this
// module to the candidate's token; everything above it stays the same.
import { authHeaders } from '@/lib/auth-headers'

let candidateToken: string | null = null
/** Set when the page in front of the person is someone else's portal. */
let viewingEmployee: string | null = null

export function setCandidateSession(token: string | null) { candidateToken = token }
export function setViewing(employeeId: string | null) { viewingEmployee = employeeId }

export class LmsApiError extends Error {
  status: number
  setup: boolean
  problems: string[]
  constructor(message: string, status: number, body: any) {
    super(message)
    this.status = status
    this.setup = !!body?.setup
    this.problems = body?.problems || []
  }
}

async function headers(json = true): Promise<Record<string, string>> {
  if (candidateToken) return { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${candidateToken}` }
  const h = await authHeaders()
  if (!json) delete h['Content-Type']
  return h
}

const withView = (path: string) => {
  if (!viewingEmployee || !path.startsWith('/api/lms/me')) return path
  return `${path}${path.includes('?') ? '&' : '?'}employee_id=${encodeURIComponent(viewingEmployee)}`
}

/** GET when there is no body, POST when there is; `method` overrides. Throws LmsApiError.
 *  `keepalive` lets a report finish even if the page is closed or reloaded while it is sent. */
export async function lmsApi<T = any>(path: string, body?: unknown, method?: string, opts?: { keepalive?: boolean }): Promise<T> {
  const r = await fetch(withView(path), {
    method: method || (body === undefined ? 'GET' : 'POST'), cache: 'no-store', headers: await headers(), keepalive: !!opts?.keepalive,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new LmsApiError(j.error || `HTTP ${r.status}`, r.status, j)
  return j as T
}

/** A file from an authenticated route, handed to the browser to save. */
export async function lmsDownload(path: string, filename: string): Promise<void> {
  const r = await fetch(withView(path), { cache: 'no-store', headers: await headers(false) })
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new LmsApiError(j.error || `HTTP ${r.status}`, r.status, j) }
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** The last player heartbeat, sent as the tab goes away. sendBeacon cannot carry an
 *  Authorization header, so this is fetch with keepalive, which can. */
export async function lmsBeacon(path: string, body: unknown): Promise<void> {
  try {
    await fetch(withView(path), { method: 'POST', keepalive: true, headers: await headers(), body: JSON.stringify(body) })
  } catch { /* the next open resumes from the last beat that landed */ }
}
