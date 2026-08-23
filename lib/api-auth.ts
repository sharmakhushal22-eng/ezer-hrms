// lib/api-auth.ts — "is this a signed-in dashboard user?" for API routes.
//
// Routes that write to storage or read bulk data run with the service-role key, which
// bypasses RLS entirely. Without a check of their own they are open to the whole
// internet: anyone could POST a file and have it hosted on our Supabase bucket, on our
// bill and under our domain. That is not hypothetical — the endpoints answered an
// anonymous curl from outside before this existed.
//
// The dashboard signs in with supabase.auth.signInWithPassword, so the browser holds a
// real access token. The client sends it as `Authorization: Bearer <token>` and this
// verifies it against Supabase. ESS is deliberately NOT covered — employees are not
// Supabase auth users at all (see the ESS notes in lib/supabase-ess.ts), so an ESS-facing
// route needs a different gate, not this one.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export interface ApiUser { id: string; email: string | null }

/** Returns the signed-in user, or a 401 response to return as-is. */
export async function requireDashboardUser(
  req: NextRequest,
): Promise<{ user: ApiUser; error: null } | { user: null; error: NextResponse }> {
  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return { user: null, error: NextResponse.json({ error: 'Sign in first — this endpoint needs a dashboard session.' }, { status: 401 }) }
  }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    return { user: null, error: NextResponse.json({ error: 'Your session has expired — sign in again.' }, { status: 401 }) }
  }
  return { user: { id: data.user.id, email: data.user.email ?? null }, error: null }
}
