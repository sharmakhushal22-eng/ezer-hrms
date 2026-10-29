// lib/session-policy.ts — pure. When a signed-in browser session has run out, and when an open
// tab should reload itself. Used by components/SessionGuard.tsx; kept free of window/React so
// the rules can be tested.
//
// Two ways to be signed in, and both must end:
//   ESS token   ezer_ess_session.token — signed, 12 hours (lib/ess-session.ts TTL_HOURS).
//   Supabase    the main login (app/page.tsx) stores token: null and leans on the Supabase
//               session, which refreshes itself for ever. So every session also carries a
//               login time (ezer_login_at) and ends MAX_SESSION_HOURS after it, whichever
//               kind it is.

export const MAX_SESSION_HOURS = 12
export const LOGIN_AT_KEY = 'ezer_login_at'
export const ESS_KEY = 'ezer_ess_session'
/** A tab left in the background this long reloads when it is shown again (fresh data). */
export const STALE_TAB_MINUTES = 60
/** A tab that knows a newer build is live reloads once the user has been idle this long. */
export const RELOAD_IDLE_SECONDS = 60

export type SessionState = 'ok' | 'expired' | 'none'

export interface SessionFacts {
  now: number
  /** ezer_ess_session parsed, or null. */
  ess: { employee_id?: string; token?: string | null } | null
  /** exp (ms) read from the ESS token, null when there is no readable token. */
  tokenExp: number | null
  /** Whether a Supabase session is stored. */
  supabase: boolean
  /** ms epoch of the login, null when unknown. */
  loginAt: number | null
}

export function sessionState(f: SessionFacts): SessionState {
  const hasEss = !!f.ess?.employee_id
  if (!hasEss && !f.supabase) return 'none'
  if (f.loginAt != null && f.now - f.loginAt > MAX_SESSION_HOURS * 3600_000) return 'expired'
  if (hasEss && f.ess?.token) {
    // A token that cannot be read is not trusted to be live.
    if (f.tokenExp == null || f.tokenExp <= f.now) return 'expired'
    return 'ok'
  }
  // ESS session with no token rides on the Supabase session (app/page.tsx): gone = expired.
  if (hasEss && !f.supabase) return 'expired'
  return 'ok'
}

/** exp (ms) from an ESS token's payload — base64url JSON before the dot. */
export function tokenExpOf(token: string | null | undefined, decode: (b64: string) => string): number | null {
  try {
    const body = String(token || '').split('.')[0]
    if (!body) return null
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const p = JSON.parse(decode(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof p?.exp === 'number' ? p.exp : null
  } catch { return null }
}

/** Pages that need a signed-in session. Login pages and the public candidate links do not. */
export function isGuardedPath(path: string): boolean {
  if (path.startsWith('/ess-login')) return false
  return path === '/ess' || path.startsWith('/ess/') || path.startsWith('/ess-portal') || path === '/dashboard' || path.startsWith('/dashboard/')
}

/** Where to sign in again from this page. */
export function loginPathFor(path: string): string {
  return path.startsWith('/dashboard') ? '/?expired=1' : '/ess-login?expired=1'
}

/** Chunk-load failures: the tab is running a build whose files are gone after a deploy. */
export function isStaleBuildError(msg: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg)
}
