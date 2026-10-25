'use client'
// components/SessionGuard.tsx — mounted once in app/layout.tsx. Two jobs:
//
// 1. Sign out a session that has run out (lib/session-policy.ts). An expired session used to
//    keep the portal on screen with every call failing "unauthenticated", and /ess-login sent
//    an expired session straight back to /ess. Checked on load, whenever the tab is shown or
//    focused, and every minute: the stored session, the Supabase session and their cookies
//    are cleared and the page goes to the login with ?expired=1.
//
// 2. Reload a tab that is out of date. After a deploy an open tab keeps the old build (and
//    breaks when a lazily-loaded file has gone). /api/version names the live build; when it
//    differs the tab reloads as soon as it is shown again or the user has been idle a minute.
//    A tab left in the background for an hour reloads on return, and a chunk-load error
//    reloads once.
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import {
  sessionState, tokenExpOf, isGuardedPath, loginPathFor, isStaleBuildError,
  ESS_KEY, LOGIN_AT_KEY, STALE_TAB_MINUTES, RELOAD_IDLE_SECONDS,
} from '@/lib/session-policy'

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || ''
const RELOAD_STAMP = 'ezer_reload_at'

function readEss(): { employee_id?: string; token?: string | null } | null {
  try { const raw = localStorage.getItem(ESS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

/** Expire every cookie this app or Supabase may have set, on this path and the root. */
function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (!name || !/^(sb-|ezer|supabase)/i.test(name)) continue
    for (const path of ['/', location.pathname]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`
  }
}

export async function signOutEverywhere(to?: string) {
  try { localStorage.removeItem(ESS_KEY); localStorage.removeItem(LOGIN_AT_KEY) } catch { /* private mode */ }
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* already gone */ }
  clearCookies()
  if (to) window.location.replace(to)
}

/** Reload, but never twice within a minute (a failing build must not loop). */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_STAMP) || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(RELOAD_STAMP, String(Date.now()))
  } catch { /* no storage: still reload */ }
  window.location.reload()
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export default function SessionGuard() {
  useEffect(() => {
    let alive = true
    let hiddenAt: number | null = document.hidden ? Date.now() : null
    let lastActive = Date.now()
    let newBuild = false

    const checkSession = async () => {
      const path = location.pathname
      const ess = readEss()
      let loginAt: number | null = null
      try { loginAt = Number(localStorage.getItem(LOGIN_AT_KEY)) || null } catch { /* */ }
      let hasSb = false
      try { hasSb = !!(await supabase.auth.getSession()).data?.session } catch { /* */ }
      // A session from before login times were recorded starts its clock now.
      if (loginAt == null && (ess?.employee_id || hasSb)) {
        try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())) } catch { /* */ }
        loginAt = Date.now()
      }
      const st = sessionState({ now: Date.now(), ess, tokenExp: tokenExpOf(ess?.token, atob), supabase: hasSb, loginAt })
      if (!alive) return
      if (st === 'expired') await signOutEverywhere(isGuardedPath(path) ? loginPathFor(path) : undefined)
      else if (st === 'none' && isGuardedPath(path) && path.startsWith('/ess')) window.location.replace('/ess-login')
    }

    const checkBuild = async () => {
      if (!BUILD || newBuild) return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        const j = await r.json()
        if (j?.build && j.build !== BUILD) newBuild = true
      } catch { /* offline: try again later */ }
    }

    const maybeReload = () => {
      if (!newBuild || document.hidden || typing()) return
      if (Date.now() - lastActive >= RELOAD_IDLE_SECONDS * 1000) reloadOnce()
    }

    const onShown = async () => {
      if (document.hidden) { hiddenAt = Date.now(); return }
      const away = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = null
      await checkSession()
      await checkBuild()
      // Back after a deploy, or after a long time away: start from a fresh page.
      if (newBuild || away >= STALE_TAB_MINUTES * 60_000) reloadOnce()
    }

    const onActivity = () => { lastActive = Date.now() }
    const onError = (msg: string) => { if (isStaleBuildError(msg)) reloadOnce() }
    const onWinError = (e: ErrorEvent) => onError(String(e?.message || e?.error?.name || ''))
    const onRejection = (e: PromiseRejectionEvent) => onError(String(e?.reason?.name || '') + ' ' + String(e?.reason?.message || e?.reason || ''))

    void checkSession()
    void checkBuild()
    const t1 = setInterval(() => { void checkSession(); maybeReload() }, 60_000)
    const t2 = setInterval(() => { void checkBuild() }, 5 * 60_000)
    document.addEventListener('visibilitychange', onShown)
    window.addEventListener('focus', onShown)
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, onActivity, { passive: true })
    window.addEventListener('error', onWinError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      alive = false
      clearInterval(t1); clearInterval(t2)
      document.removeEventListener('visibilitychange', onShown)
      window.removeEventListener('focus', onShown)
      for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.removeEventListener(ev, onActivity)
      window.removeEventListener('error', onWinError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
