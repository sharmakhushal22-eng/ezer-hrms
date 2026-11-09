// src/core/config.ts — where the app's backend lives.
//
// The app has no backend of its own. It talks to the SAME Next.js deployment and
// the SAME Supabase project as the website, so a record changed on one shows up
// on the other.
//
// Everything here is EXPO_PUBLIC_*, which means it is compiled into the APK and
// anyone can read it. That is fine for these three — the website ships the same
// values to every browser — and it is why no secret may ever be added here:
// no service-role key, no ESS_SESSION_SECRET, no API keys with spend.

/** The website. Every /api/* call goes here. No trailing slash. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://ezer-hrms-chi.vercel.app').replace(/\/+$/, '')

/** Supabase — the public URL and the public anon key, exactly what the website's
 *  browser bundle carries (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY). Used only by the
 *  screens that, on the website too, read Supabase directly. */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''

export const configProblems = (): string[] => {
  const p: string[] = []
  if (!SUPABASE_URL) p.push('EXPO_PUBLIC_SUPABASE_URL is not set')
  if (!SUPABASE_ANON_KEY) p.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set')
  return p
}
