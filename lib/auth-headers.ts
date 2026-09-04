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

import { supabase } from '@/lib/supabase'
import { essAuthHeaders } from '@/lib/ess-session-client'

export async function authHeaders(): Promise<Record<string, string>> {
  const base = { 'Content-Type': 'application/json' }
  const h = essAuthHeaders()
  if (h.Authorization) return { ...base, ...h }
  try {
    const { data } = await supabase.auth.getSession()
    const t = data?.session?.access_token
    return t ? { ...base, Authorization: `Bearer ${t}` } : base
  } catch {
    // No session is a legitimate state — the caller gets a 401 and says so.
    // Throwing here would turn "signed out" into a broken screen.
    return base
  }
}
