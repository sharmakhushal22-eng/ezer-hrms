// src/core/session.tsx — who is signed in.
//
// SAME AUTH AS THE WEBSITE, NOT A NEW ONE. ESS employees are not Supabase Auth
// users. The website's /ess-login posts { identifier, password } to
// /api/ess-auth/login, which checks the scrypt hash in ess_accounts and returns
// a token signed with a server-only secret (lib/ess-session.ts). The app does
// exactly that and keeps the response — the same JSON the website keeps in
// localStorage['ezer_ess_session'] — in SecureStore.
//
// The token lives 12 hours (TTL_HOURS on the server). Like the website's
// essToken(), the app reads the expiry only to decide whether the token is worth
// sending; the server verifies the signature and expiry on every call, which is
// what actually protects the data. An expired or rejected token signs the person
// out with a message saying why.
import * as React from 'react'
import { AppState } from 'react-native'
import { configureApi } from './api'
import { queryClient } from './query'
import { secureDel, secureGet, secureSet } from './secure'

const KEY = 'ezer_ess_session'
/** lib/ess-session-client.ts SKEW_MS — a token about to expire is treated as expired. */
const SKEW_MS = 30_000

export interface StoredSession {
  employee_id: string
  name: string
  /** What the person typed to sign in, lower-cased — as the website stores it. */
  email?: string
  token: string
}

type Status = 'loading' | 'signedOut' | 'signedIn'
interface SessionCtx {
  status: Status
  session: StoredSession | null
  /** Why the person was signed out, shown on the login screen. */
  notice: string | null
  adopt: (r: { employee_id: string; name: string; token: string | null }, email?: string) => Promise<StoredSession>
  signOut: (notice?: string | null) => Promise<void>
  update: (patch: Partial<StoredSession>) => Promise<void>
}
const Ctx = React.createContext<SessionCtx | null>(null)

/** The token's expiry in ms, or null if it is not a token we recognise. */
export function tokenExpiry(token: string | null | undefined): number | null {
  try {
    const body = String(token || '').split('.')[0]
    if (!body) return null
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof json?.exp === 'number' ? json.exp : null
  } catch { return null }
}
const usable = (token?: string | null) => { const e = tokenExpiry(token); return e !== null && Date.now() + SKEW_MS < e }

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>('loading')
  const [session, setSession] = React.useState<StoredSession | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  // Kept in step by every setter below (restore, adopt, update, signOut), so the
  // API layer can read the token synchronously without re-rendering.
  const ref = React.useRef<StoredSession | null>(null)

  const signOut = React.useCallback(async (why: string | null = null) => {
    ref.current = null
    setSession(null)
    setNotice(why)
    setStatus('signedOut')
    await secureDel(KEY)
    // Nothing of the previous person's data may survive into the next sign-in.
    queryClient.clear()
  }, [])

  React.useEffect(() => {
    configureApi({
      token: () => (ref.current && usable(ref.current.token) ? ref.current.token : null),
      onUnauthorized: () => { if (ref.current) void signOut('Your session expired. Please sign in again.') },
    })
  }, [signOut])

  // Restore on launch.
  React.useEffect(() => {
    (async () => {
      const raw = await secureGet(KEY)
      let s: StoredSession | null = null
      try { s = raw ? JSON.parse(raw) : null } catch { s = null }
      if (s?.employee_id && usable(s.token)) {
        ref.current = s
        setSession(s)
        setStatus('signedIn')
      } else {
        if (s) await secureDel(KEY)
        setNotice(s ? 'Your session expired. Please sign in again.' : null)
        setStatus('signedOut')
      }
    })()
  }, [])

  // Sign out when the 12 hours run out while the app is open.
  React.useEffect(() => {
    const exp = tokenExpiry(session?.token)
    if (!exp) return
    const t = setTimeout(() => void signOut('Your session expired. Please sign in again.'), Math.max(0, exp - Date.now() - SKEW_MS))
    return () => clearTimeout(t)
  }, [session?.token, signOut])

  // components/SessionGuard.tsx (397d32c) re-checks whenever the tab is shown again.
  // A phone's timers stop while the app is in the background, so check on return too.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && ref.current && !usable(ref.current.token)) void signOut('Your session expired. Please sign in again.')
    })
    return () => sub.remove()
  }, [signOut])

  /** Keep a login / change-password response as the session — the website's finish(). */
  const adopt = React.useCallback(async (r: { employee_id: string; name: string; token: string | null }, email?: string) => {
    if (!r.token) throw new Error('Sign-in is unavailable on this deployment (no session secret configured). Contact HR.')
    const s: StoredSession = { employee_id: r.employee_id, name: r.name, email: email || '', token: r.token }
    await secureSet(KEY, JSON.stringify(s))
    queryClient.clear()
    ref.current = s
    setSession(s)
    setNotice(null)
    setStatus('signedIn')
    return s
  }, [])

  const update = React.useCallback(async (patch: Partial<StoredSession>) => {
    if (!ref.current) return
    const s = { ...ref.current, ...patch }
    ref.current = s
    setSession(s)
    await secureSet(KEY, JSON.stringify(s))
  }, [])

  const value = React.useMemo(() => ({ status, session, notice, adopt, signOut, update }), [status, session, notice, adopt, signOut, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const c = React.useContext(Ctx)
  if (!c) throw new Error('useSession outside SessionProvider')
  return c
}

/** The signed-in employee's id. Only call under the signed-in tree. */
export function useEmployeeId(): string {
  const { session } = useSession()
  return session?.employee_id || ''
}
