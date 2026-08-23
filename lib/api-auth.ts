// lib/api-auth.ts — "is this a signed-in dashboard user?" for API routes.
//
// Routes that write to storage or read bulk data run with the service-role key, which
// bypasses RLS entirely. Without a check of their own they are open to the whole
// internet: anyone could POST a file and have it hosted on our Supabase bucket, on our
// bill and under our domain. That is not hypothetical — the endpoints answered an
// anonymous curl from outside before this existed.
//
// Two kinds of session are accepted:
//
//   ESS session    an HMAC token from lib/ess-session.ts. Dashboard users sign in
//                  through ESS, so refusing these would lock every one of them out of
//                  the routes below.
//
//   Supabase auth  the legacy shared dashboard login, still accepted while
//                  LEGACY_SUPABASE_BRIDGE is on (see lib/rms/server.ts).
//
// Being signed in is not the same as being allowed. requireModule() asks the second
// question, and conflating the two is how a recruiter ends up able to call a payroll
// endpoint by hand.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyEssToken } from '@/lib/ess-session'
import { grantForRequest, LEGACY_SUPABASE_BRIDGE } from '@/lib/rms/server'
import { hasLevel } from '@/lib/rms/resolve'
import type { AccessLevel, Module } from '@/lib/rms/modules'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export interface ApiUser {
  id: string
  email: string | null
  /** The employee behind the session when it is an ESS one; null for the legacy login,
   *  which is not attached to an employee record. */
  employeeId: string | null
  kind: 'ess' | 'legacy'
}

const UNAUTHORISED = 'Sign in first — this endpoint needs a dashboard session.'
const EXPIRED = 'Your session has expired — sign in again.'

/** Returns the signed-in user, or a 401 response to return as-is. */
export async function requireDashboardUser(
  req: NextRequest,
): Promise<{ user: ApiUser; error: null } | { user: null; error: NextResponse }> {
  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return { user: null, error: NextResponse.json({ error: UNAUTHORISED }, { status: 401 }) }
  }

  // ESS first — it is the common case and needs no network round trip.
  const ess = verifyEssToken(token)
  if (ess?.employeeId) {
    return { user: { id: ess.employeeId, email: null, employeeId: ess.employeeId, kind: 'ess' }, error: null }
  }

  if (LEGACY_SUPABASE_BRIDGE) {
    const { data, error } = await admin.auth.getUser(token)
    if (!error && data?.user) {
      return { user: { id: data.user.id, email: data.user.email ?? null, employeeId: null, kind: 'legacy' }, error: null }
    }
  }
  return { user: null, error: NextResponse.json({ error: EXPIRED }, { status: 401 }) }
}

/**
 * Signed in AND allowed to touch this module at this level.
 *
 * Use this on any route that reads or writes something a role could be denied. Hiding a
 * sidebar entry stops nobody from calling the endpoint by hand; this does.
 */
export async function requireModule(
  req: NextRequest,
  module: Module,
  level: AccessLevel = 'VIEW',
): Promise<{ user: ApiUser; error: null } | { user: null; error: NextResponse }> {
  const base = await requireDashboardUser(req)
  if (base.error) return base

  const grant = await grantForRequest(req)
  if (!hasLevel(grant, module, level)) {
    return {
      user: null,
      error: NextResponse.json({ error: `${module} is not part of your access.` }, { status: 403 }),
    }
  }
  return base
}
