// lib/api-auth.ts — "is this a signed-in dashboard user?" for API routes.
//
// Routes that write to storage or read bulk data run with the service-role key, which
// bypasses RLS entirely. Without a check of their own they are open to the whole
// internet: anyone could POST a file and have it hosted on our Supabase bucket, on our
// bill and under our domain. That is not hypothetical — the endpoints answered an
// anonymous curl from outside before this existed.
//
// Two kinds of session are accepted now:
//
//   ESS session    the front door. Every dashboard user signs in at /ess-login and
//                  carries an HMAC token from lib/ess-session.ts. This used to be
//                  refused here, which would have locked every ESS-authenticated admin
//                  out of the seven routes below the moment the door changed.
//
//   Supabase auth  the legacy shared dashboard login, still accepted while the
//                  SUPER_ADMIN role has nobody attached to it. See LEGACY_SUPABASE_BRIDGE
//                  in lib/rms-server.ts — turning that off closes this too.
//
// Module-level permission is a separate question, asked with requireModule() below.
// Being signed in is not the same as being allowed, and conflating the two is how a
// recruiter ends up able to call a payroll endpoint.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyEssToken } from '@/lib/ess-session'
import { grantForRequest, LEGACY_SUPABASE_BRIDGE } from '@/lib/rms-server'
import { canSee, atLeast, type Module, type AccessLevel } from '@/lib/permissions'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export interface ApiUser {
  id: string
  email: string | null
  /** The employee behind the session, when it is an ESS one. Null for the legacy login,
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

  // ESS first — it is the common case now, and it needs no network round trip.
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

/** Signed in AND allowed to touch this module at this level. Use this on any route that
 *  reads or writes something a role could be denied — being authenticated says who
 *  somebody is, not what they may do. */
export async function requireModule(
  req: NextRequest,
  module: Module,
  level: AccessLevel = 'VIEW',
): Promise<{ user: ApiUser; error: null } | { user: null; error: NextResponse }> {
  const base = await requireDashboardUser(req)
  if (base.error) return base

  const grant = await grantForRequest(req)
  const allowed = level === 'VIEW' ? canSee(grant, module) : (!grant.enforced || atLeast(grant.modules[module], level))
  if (!allowed) {
    return {
      user: null,
      error: NextResponse.json({ error: `${module} is not part of your access.` }, { status: 403 }),
    }
  }
  return base
}
