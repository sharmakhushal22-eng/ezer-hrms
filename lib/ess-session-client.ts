'use client'
// lib/ess-session-client.ts — hands the ESS session token to an API call.
//
// The token is issued at login and lives beside employee_id in the same localStorage
// entry. Sessions created before this existed have no token; those callers get no
// header, the server refuses, and the employee is asked to sign in again. That is the
// correct outcome — the alternative is trusting an unauthenticated id, which is the
// hole this closes.
//
// WHY THE EXPIRY IS CHECKED HERE
//
// It used to return whatever string was in localStorage. An expired token is still a
// string, so it went out confidently and came back 401 — and because authHeaders()
// stops as soon as it has an Authorization header, a signed-in admin sitting behind a
// stale ESS token never fell through to their own valid session. The screen simply
// failed, with nothing on it explaining why.
//
// Reading the payload here is not a trust decision. The server verifies the HMAC and
// re-checks exp on every request (lib/ess-session.ts) and that is what actually
// protects the API. This only decides whether the token is worth SENDING, so a
// tampered exp buys nothing but a request that is refused a moment later.

/** Clock skew allowance. A token expiring inside this window is treated as already
 *  expired, so a call cannot leave here valid and arrive expired. */
const SKEW_MS = 30_000

interface StoredSession { token?: string | null }

/** The token, only while it is actually usable. Null covers every failure —
 *  absent, unparseable, malformed, expired — because the caller does the same
 *  thing in all four cases. */
export function essToken(): string | null {
  try {
    const raw = localStorage.getItem('ezer_ess_session')
    if (!raw) return null
    const token = (JSON.parse(raw) as StoredSession)?.token
    if (!token) return null

    const body = String(token).split('.')[0]
    if (!body) return null

    // atob wants standard base64; the token is base64url and unpadded.
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))

    // A token with no readable expiry is not treated as eternal. It is issued with
    // one (issueEssToken always sets exp), so its absence means this is not a token
    // we recognise.
    if (typeof payload?.exp !== 'number') return null
    if (Date.now() + SKEW_MS >= payload.exp) return null

    return token
  } catch { return null }
}

/** True when a session exists but has run out — the one case worth telling somebody
 *  about, since "sign in again" fixes it and nothing else will. */
export function essSessionExpired(): boolean {
  try {
    const raw = localStorage.getItem('ezer_ess_session')
    if (!raw) return false
    return Boolean((JSON.parse(raw) as StoredSession)?.token) && essToken() === null
  } catch { return false }
}

export function essAuthHeaders(): Record<string, string> {
  const token = essToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
