'use client'
// lib/rms-client.ts — the browser's side of the permission check.
//
// Holds no opinion of its own. It reads the ESS session token, asks the server who that
// is, and hands the answer to whatever is rendering. Every decision about what the answer
// means lives in lib/permissions.ts, so the sidebar and a page guard cannot disagree.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { emptyGrant, type Grant } from '@/lib/permissions'

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

/** The token to send with a privileged request: the ESS session if there is one, else the
 *  legacy Supabase access token so the old dashboard login keeps working until a real
 *  person holds SUPER_ADMIN. */
export async function authToken(): Promise<string | null> {
  const t = essToken()
  if (t) return t
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

/** Resolved once per page load and shared. Without this every guarded page would ask the
 *  same question again on every navigation, and the sidebar would flicker between
 *  "everything" and "your modules" each time. */
let cached: Grant | null = null
let inflight: Promise<Grant> | null = null

export async function loadGrant(force = false): Promise<Grant> {
  if (!force && cached) return cached
  if (!force && inflight) return inflight

  inflight = (async () => {
    const token = await authToken()
    if (!token) { cached = emptyGrant(); return cached }
    try {
      const res = await fetch('/api/rms/me', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const json = await res.json()
      cached = (json?.grant as Grant) || emptyGrant()
    } catch {
      // A network failure must not read as "not signed in" — that would bounce a working
      // user to the login page because one request timed out. They hold a valid token, so
      // they stay in, unenforced, exactly as the dashboard behaved before roles existed.
      const local = readEssSession()
      cached = {
        ...emptyGrant(),
        employeeId: local?.employee_id ?? null,
        name: local?.name ?? null,
        legacy: false,
        enforced: false,
        resolved: false,
      }
    }
    return cached
  })()

  const out = await inflight
  inflight = null
  return out
}

export function clearGrant() { cached = null }

/** The hook every guarded surface uses. `loading` is true only on the first resolve;
 *  after that the cached answer is returned synchronously. */
export function useGrant(): { grant: Grant; loading: boolean; reload: () => void } {
  const [grant, setGrant] = useState<Grant>(cached || emptyGrant())
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    let live = true
    loadGrant().then(g => { if (live) { setGrant(g); setLoading(false) } })
    return () => { live = false }
  }, [])

  const reload = () => {
    setLoading(true)
    loadGrant(true).then(g => { setGrant(g); setLoading(false) })
  }
  return { grant, loading, reload }
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
