'use client'
// lib/ess-session-client.ts — hands the ESS session token to an API call.
//
// The token is issued at login and lives beside employee_id in the same localStorage
// entry. Sessions created before this existed have no token; those callers get no
// header, the server refuses, and the employee is asked to sign in again. That is the
// correct outcome — the alternative is trusting an unauthenticated id, which is the
// hole this closes.
export function essAuthHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem('ezer_ess_session')
    const token = raw ? JSON.parse(raw)?.token : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch { return {} }
}
