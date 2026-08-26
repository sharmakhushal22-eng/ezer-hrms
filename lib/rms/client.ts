'use client'
// lib/rms/client.ts — the browser's side of the permission check.
//
// Holds no opinion of its own. It reads the ESS session token, asks the server who that
// is, and hands the answer to whatever is rendering. Every decision about what the
// answer means lives in lib/rms/resolve.ts, so the sidebar and a page guard cannot
// disagree.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { emptyGrant, type Grant } from '@/lib/rms/resolve'
import type { ManagerSlot } from '@/lib/rms/hierarchy'

const ESS_KEY = 'ezer_ess_session'

export interface EssSession { employee_id?: string; name?: string; email?: string; token?: string | null }

export function readEssSession(): EssSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ESS_KEY)
    return raw ? (JSON.parse(raw) as EssSession) : null
  } catch { return null }
}

export function essToken(): string | null {
  return readEssSession()?.token || null
}

/** The token to send with a privileged request: the ESS session if there is one, else
 *  the legacy Supabase access token so the old dashboard login keeps working. */
export async function authToken(): Promise<string | null> {
  const t = essToken()
  if (t) return t
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

/** Resolved once per page load and shared. Without this every guarded page would ask the
 *  same question again on each navigation, and the sidebar would flicker between
 *  "everything" and "your modules" each time. */
let cached: { grant: Grant; managers: ManagerSlot[] } | null = null
let inflight: Promise<{ grant: Grant; managers: ManagerSlot[] }> | null = null

export async function loadGrant(force = false) {
  if (!force && cached) return cached
  if (!force && inflight) return inflight

  inflight = (async () => {
    const token = await authToken()
    if (!token) { cached = { grant: emptyGrant(), managers: [] }; return cached }
    try {
      const res = await fetch('/api/rms/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const json = await res.json()
      cached = { grant: (json?.grant as Grant) || emptyGrant(), managers: (json?.managers as ManagerSlot[]) || [] }
    } catch {
      // A network failure must not read as "not signed in" — that would bounce a working
      // user to the login page because one request timed out. They hold a valid token, so
      // they stay in, unenforced, exactly as the dashboard behaved before roles existed.
      const local = readEssSession()
      cached = {
        grant: { ...emptyGrant(), employeeId: local?.employee_id ?? null, name: local?.name ?? null, enforced: false, resolved: false },
        managers: [],
      }
    }
    return cached
  })()

  const out = await inflight
  inflight = null
  return out
}

export function clearGrant() { cached = null }

/** The hook every guarded surface uses. `loading` is true only on the first resolve. */
export function useGrant(): { grant: Grant; managers: ManagerSlot[]; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ grant: Grant; managers: ManagerSlot[] }>(cached || { grant: emptyGrant(), managers: [] })
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    let live = true
    loadGrant().then(v => { if (live) { setState(v); setLoading(false) } })
    return () => { live = false }
  }, [])

  const reload = () => {
    setLoading(true)
    loadGrant(true).then(v => { setState(v); setLoading(false) })
  }
  return { ...state, loading, reload }
}

/** Somebody else's reporting line — for the employee master view. Fetched rather than
 *  read from the client's own grant, because the server decides whether the caller is
 *  allowed to see it. */
export function useManagerChain(employeeId: string | null | undefined) {
  // The state carries the employee it belongs to. That makes `loading` something to
  // derive rather than something to set, which in turn means the effect never calls
  // setState synchronously — the cascading-render trap the React linter warns about.
  const [state, setState] = useState<{ id: string | null; managers: ManagerSlot[]; reportCount: number; error: string | null }>(
    { id: null, managers: [], reportCount: 0, error: null },
  )

  useEffect(() => {
    if (!employeeId) return
    let live = true
    ;(async () => {
      try {
        const token = await authToken()
        const res = await fetch(`/api/rms/hierarchy?employee_id=${encodeURIComponent(employeeId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        })
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) setState({ id: employeeId, managers: [], reportCount: 0, error: json?.error || 'Could not load the reporting line.' })
        else setState({ id: employeeId, managers: json.managers || [], reportCount: json.direct_report_count || 0, error: null })
      } catch {
        if (live) setState({ id: employeeId, managers: [], reportCount: 0, error: 'Could not reach the server.' })
      }
    })()
    return () => { live = false }
  }, [employeeId])

  // Until the answer for THIS employee arrives, report loading rather than the previous
  // employee's managers — otherwise opening a second person shows the first one's chain
  // for a frame.
  const settled = !!employeeId && state.id === employeeId
  return {
    managers: settled ? state.managers : [],
    reportCount: settled ? state.reportCount : 0,
    loading: !!employeeId && !settled,
    error: settled ? state.error : null,
  }
}

/** POST a privileged change. Returns { ok } or { error } — never throws, because every
 *  caller is a button that has to show the user what happened. */
export async function rmsAdmin(body: Record<string, any>): Promise<{ ok?: true; error?: string; [k: string]: any }> {
  const token = await authToken()
  if (!token) return { error: 'Your session has expired — sign in again.' }
  try {
    const res = await fetch('/api/rms/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: json?.error || `Request failed (${res.status})` }
    return json
  } catch (e: any) {
    return { error: e?.message || 'Network error' }
  }
}
