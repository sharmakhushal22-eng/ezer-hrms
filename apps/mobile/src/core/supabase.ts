// src/core/supabase.ts — the same public Supabase client the website's browser uses.
//
// WHY THE APP HAS ONE AT ALL. Several website screens (investment proofs, flexi
// benefits, performance, wall of fame, broadcast, the directory, raise-a-request,
// parts of profile) read and write Supabase straight from the browser with the
// public anon key, not through /api. For parity the app runs the same queries,
// scoped to the signed-in employee exactly as the website scopes them. That is a
// decision recorded in docs/mobile-app-architecture.md (§ Security): it adds no
// exposure the website does not already have, and those screens should move
// behind token-checked /api routes — in both clients at once — when RLS is
// tightened.
//
// No Supabase Auth: ESS employees are not auth users, so there is no session to
// persist and nothing to refresh.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export const supabase = createClient(SUPABASE_URL || 'https://invalid.supabase.co', SUPABASE_ANON_KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

/** Throw the PostgREST error as a normal Error, so screens handle both clients the same way. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
