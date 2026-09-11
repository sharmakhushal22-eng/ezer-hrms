// lib/rms/grant-state.ts — the two decisions the dashboard gate turns on.
//
// Pulled out of lib/rms/client.ts so they can be tested at all. They were
// inline expressions inside an async function that needs fetch, localStorage
// and a Supabase client, which meant the logic that decides whether somebody
// gets into the dashboard had no test covering it — and it shipped a bug that
// locked people out after a SUCCESSFUL login.
//
// Both are pure. No I/O, no globals.

/** Anything shaped like a grant. Deliberately loose: this runs on whatever
 *  /api/rms/me returned, including nothing at all. */
export interface GrantLike {
  employeeId?: string | null
  legacy?: boolean
  [k: string]: unknown
}

/**
 * Did this token buy us anything?
 *
 * A grant with no employee and no legacy flag is what the server returns for
 * "no token", "expired token" and "token I cannot read" alike — they are the
 * same answer to a caller. The dashboard gate treats it as "not signed in".
 */
export function grantIsUseless(g: GrantLike | null | undefined): boolean {
  if (!g) return true
  return !g.employeeId && !g.legacy
}

/**
 * Should we throw away the ESS token and retry with the Supabase session?
 *
 * THE BUG THIS EXISTS TO PREVENT
 * authToken() prefers the ESS session over the Supabase one. Anybody who had
 * used the ESS portal kept sending that token to the dashboard afterwards.
 * Once it expired the server could not verify it as an ESS token, could not
 * read it as a Supabase JWT either, and returned an empty grant — so the
 * dashboard bounced them back to the login screen immediately after a
 * successful sign-in. Their valid Supabase session was never tried.
 *
 * All four conditions are required, and each one is load-bearing:
 *
 *   usedEssToken        we are not throwing away a token we never used
 *   grantIsUseless      it already produced nothing, so it cannot be working
 *   hasSupabaseSession  there is something better to fall back TO. Without
 *                       this we would log an ESS user out of ESS to replace
 *                       their token with nothing
 *   !alreadyRetried     one retry, never a loop
 */
export function shouldDropEssToken(opts: {
  usedEssToken: boolean
  grant: GrantLike | null | undefined
  hasSupabaseSession: boolean
  alreadyRetried?: boolean
}): boolean {
  const { usedEssToken, grant, hasSupabaseSession, alreadyRetried = false } = opts
  if (alreadyRetried) return false
  if (!usedEssToken) return false
  if (!hasSupabaseSession) return false
  return grantIsUseless(grant)
}
