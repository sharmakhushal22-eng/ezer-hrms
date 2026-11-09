'use client'
// components/learning/app/cache.ts — what EZER Learn has already fetched, kept so a screen seen
// once opens at once next time, and so a course can start loading while the pointer is still on
// its card.
//
// Every screen still asks the server again as it opens and shows the fresh answer when it lands;
// this only decides what is on screen in the meantime. Nothing here is a decision: locks, quiz
// gates and completion are re-checked by the API on every action.
//
// Memory, per tab. The home and catalogue answers are also kept in sessionStorage, so arriving
// from ESS (a full page load) draws them at once; that is this tab only, and goes when it closes.
import { lmsApi } from '@/lib/lms/client'

const store = new Map<string, unknown>()
const flying = new Map<string, Promise<unknown>>()
const SESSION = new Set(['dash', 'cat'])
/** Whose cache this is. A different person signing in on the same tab must never be shown the
 *  last person's learning, so the saved copy is filed under the signed-in employee, and nothing
 *  is saved without one. */
function owner(): string | null {
  try { return JSON.parse(localStorage.getItem('ezer_ess_session') || 'null')?.employee_id || null } catch { return null }
}
const sessionKey = (k: string) => { const o = owner(); return o ? `ezl-cache:${o}:${k}` : null }

export function cached<T>(key: string): T | null {
  if (store.has(key)) return store.get(key) as T
  if (SESSION.has(key)) {
    try {
      const sk = sessionKey(key)
      const raw = sk ? sessionStorage.getItem(sk) : null
      if (raw) { const v = JSON.parse(raw) as T; store.set(key, v); return v }
    } catch { /* private mode: memory only */ }
  }
  return null
}

export function remember<T>(key: string, value: T): T {
  store.set(key, value)
  if (SESSION.has(key)) { try { const sk = sessionKey(key); if (sk) sessionStorage.setItem(sk, JSON.stringify(value)) } catch { /* full or private */ } }
  return value
}

export function forget(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k)
}

/** Fetch through the cache: one request in flight per key, its answer remembered. */
export function fetchInto<T>(key: string, path: string): Promise<T> {
  const live = flying.get(key)
  if (live) return live as Promise<T>
  const p = lmsApi<T>(path).then(v => remember(key, v)).finally(() => flying.delete(key))
  flying.set(key, p)
  return p
}

/** Start loading something the person is about to open. Failures are left for the screen. */
export function prefetch(key: string, path: string) {
  if (store.has(key) || flying.has(key)) return
  fetchInto(key, path).catch(() => {})
}

export const keys = {
  course: (id: string) => `course:${id}`,
  view: (enrollmentId: string) => `view:${enrollmentId}`,
}
export const paths = {
  course: (id: string) => `/api/lms/me/catalog/${id}`,
  view: (enrollmentId: string) => `/api/lms/me/enrollments/${enrollmentId}`,
}
