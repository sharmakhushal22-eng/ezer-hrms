'use client'
// lib/lms/sso-client.ts — both ends of the HRMS → EZER Learn hand-off, in the browser.
// The server half and the reasons are in lib/lms/sso.ts.
import { supabase } from '@/lib/supabase'
import { authHeaders } from '@/lib/auth-headers'
import { signOutEverywhere } from '@/components/SessionGuard'
import { ESS_KEY, LOGIN_AT_KEY } from '@/lib/session-policy'
import { HRMS_URL, LMS_URL } from './site'

/** Where the person arrived from: '1' for the HRMS website, so the LMS can offer a way back;
 *  'app' for the EZER HRMS phone app, which opens the LMS in its own in-app browser — closing
 *  that browser is the way back, and a link to the HRMS website would only lead away from it. */
const VIA_HRMS_KEY = 'ezl_via_hrms'

/** HRMS: leave for the LMS domain at the same screen, signed in. With no session, or if the
 *  hand-off fails, they still go, and the LMS asks them to sign in. */
export async function handOffToLms(): Promise<void> {
  const path = (location.pathname.replace(/^\/learning/, '') || '/') + location.search
  let code = ''
  try {
    const headers = await authHeaders()
    if ('Authorization' in headers) {
      const r = await fetch('/api/lms/sso', { method: 'POST', headers, cache: 'no-store' })
      if (r.ok) code = String((await r.json())?.code || '')
    }
  } catch { /* offline or no session: go anyway */ }
  location.replace(`${LMS_URL}${path}${code ? `#sso=${encodeURIComponent(code)}` : ''}`)
}

/** LMS: if the address carries a hand-off code, trade it for a session on this domain. It
 *  replaces whoever was signed in here before, since the person just came from somewhere they
 *  are signed in. Returns once the session is in place, or once it is clear there is none. */
export async function adoptHandoff(): Promise<void> {
  const fromApp = /(?:^#|&)from=app(?:&|$)/.test(location.hash)
  const m = /(?:^#|&)sso=([^&]+)/.exec(location.hash)
  if (fromApp) { try { localStorage.setItem(VIA_HRMS_KEY, 'app') } catch { /* private mode */ } }
  if (!m && !fromApp) return
  // Off the address at once: out of history, out of anything copied or shared.
  history.replaceState(history.state, '', location.pathname + location.search)
  if (!m) return
  let d: { kind?: string; employee_id?: string; name?: string; email?: string; token?: string; token_hash?: string; employee?: { id: string; name: string } | null }
  try {
    const r = await fetch('/api/lms/sso/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: decodeURIComponent(m[1]) }), cache: 'no-store' })
    if (!r.ok) return
    d = await r.json()
  } catch { return }

  await signOutEverywhere()
  try {
    if (d.kind === 'ess' && d.employee_id && d.token) {
      localStorage.setItem(ESS_KEY, JSON.stringify({ employee_id: d.employee_id, name: d.name || '', email: d.email || '', token: d.token }))
    } else if (d.kind === 'legacy' && d.token_hash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: d.token_hash, type: 'magiclink' })
      if (error) return
      if (d.employee) localStorage.setItem(ESS_KEY, JSON.stringify({ employee_id: d.employee.id, name: d.employee.name, email: d.email || '', token: null }))
    } else return
    localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
    localStorage.setItem(VIA_HRMS_KEY, fromApp ? 'app' : '1')
  } catch { /* private mode: they are asked to sign in here */ }
}

/** Where "Back to EZER HRMS" goes on the LMS site, or null when it should not be offered:
 *  a company that has only the LMS never came from HRMS and has nowhere to go back to. */
export function hrmsBackHref(employee: boolean): string | null {
  if (!HRMS_URL) return null
  try { if (localStorage.getItem(VIA_HRMS_KEY) !== '1') return null } catch { return null }
  return `${HRMS_URL}${employee ? '/ess' : '/dashboard'}`
}

/** Sign out of EZER Learn on this domain only. HRMS keeps its own session, the way each
 *  product in a suite signs out on its own unless the company runs single logout. */
export async function signOutOfLms(): Promise<void> {
  try { localStorage.removeItem(VIA_HRMS_KEY) } catch { /* private mode */ }
  await signOutEverywhere('/')
}
