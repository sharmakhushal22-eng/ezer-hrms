// lib/auth-headers.ts — the Authorization header for a browser call to our
// own API, from whichever session the person actually has.
//
// There are two, and a screen can be reached through either:
//
//   ESS session      an employee signed into the portal. The token is JSON in
//                    localStorage['ezer_ess_session'], read by essAuthHeaders.
//   Supabase session an admin who signed into the dashboard and is looking at
//                    an ESS screen, or any dashboard page.
//
// Checking only one of them is the bug this exists to stop. The ESS inbox
// shipped reading localStorage['ess_token'] — a key nothing writes — so every
// request went out unauthenticated and the screen said "Sign in first — this
// endpoint needs a dashboard session." The admin inbox panel sent no header at
// all and would have 403'd for everyone.
//
// This was already written correctly inside lib/company/client.ts, privately.
// It is here so the next caller finds it instead of guessing again.
//
// EXPIRED IS NOT THE SAME AS PRESENT
//
// Both branches used to hand back whatever they had. An expired ESS token is
// still a string and an expired Supabase access_token is still a session, so
// either could go out and come back 401 while the person was, in fact, signed
// in somewhere else — an admin viewing an employee portal behind a stale ESS
// token never reached their own valid session, because this function stopped at
// the first Authorization header it could build.
//
// So each branch now yields a header only if the credential is actually usable:
// essToken() checks exp, and the Supabase side refreshes rather than sending a
// token it can see has run out.

import { supabase } from '@/lib/supabase'
import { essAuthHeaders } from '@/lib/ess-session-client'

/** Same allowance as the ESS side: a token expiring inside this window is
 *  refreshed now rather than sent and refused. */
const SKEW_MS = 30_000

/** getSession() returns what is stored. That is usually current, but it can be a
 *  token past its expiry, and sending one is how a signed-in person gets a 401.
 *  Refresh instead, and fall back to the stored token if the refresh fails —
 *  offline, say — so a working call is never traded for no call at all. */
async function supabaseToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  if (!session?.access_token) return null

  // expires_at is epoch SECONDS, unlike the ESS token's milliseconds.
  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : null
  if (expiresAtMs !== null && Date.now() + SKEW_MS < expiresAtMs) {
    return session.access_token
  }

  const { data: refreshed } = await supabase.auth.refreshSession()
  return refreshed?.session?.access_token ?? session.access_token
}

export async function authHeaders(): Promise<Record<string, string>> {
  const base = { 'Content-Type': 'application/json' }

  // The ESS token wins when it is live: it names the employee, which is what the
  // ESS routes resolve the caller from.
  const h = essAuthHeaders()
  if (h.Authorization) return { ...base, ...h }

  try {
    const t = await supabaseToken()
    return t ? { ...base, Authorization: `Bearer ${t}` } : base
  } catch {
    // No session is a legitimate state — the caller gets a 401 and says so.
    // Throwing here would turn "signed out" into a broken screen.
    return base
  }
}
