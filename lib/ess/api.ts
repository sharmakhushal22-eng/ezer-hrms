// lib/ess/api.ts — the ESS fetch helper.
//
// Lifted verbatim out of components/ess/RoleTabs.tsx, where it was a private
// function, so that the Team module can call THE SAME helper rather than a
// copy of it. Importing it back out of RoleTabs would have made a cycle:
// RoleTabs -> team/TeamRoster -> RoleTabs.
//
// Behaviour is unchanged — same employee_id query parameter, same bearer
// token, same `cache: 'no-store'`, same "throw the body's error or HTTP n".
import { authToken } from '@/lib/rms/client'

export async function api(path: string, employeeId: string, init?: RequestInit) {
  const token = await authToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}
