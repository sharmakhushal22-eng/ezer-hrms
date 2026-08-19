// lib/travel/actor.ts — who is actually making this request.
//
// The travel routes used to take employee_id straight from the body or the query
// string and act on it. Nothing proved the caller was that employee, so anyone could
// file a travel log in somebody else's name, or read their claims, by changing one
// value. The tables carry money, so that is not a small hole.
//
// Two kinds of caller are legitimate:
//   · an ESS employee acting on themselves — identified by the signed session token
//     issued at login (lib/ess-session.ts)
//   · a dashboard user acting on someone else — HR opening a claim to approve it,
//     identified by their Supabase session (lib/api-auth.ts)
//
// Anything else is refused. A supplied employee_id is only honoured for the second
// kind; for the first it must match the token, or the request is a impersonation
// attempt and is treated as one.
import { NextRequest, NextResponse } from 'next/server'
import { essEmployeeFromRequest, essSessionUnavailable } from '@/lib/ess-session'
import { requireDashboardUser } from '@/lib/api-auth'

export type Actor =
  | { ok: true; employeeId: string; onBehalf: boolean }
  | { ok: false; response: NextResponse }

/**
 * @param suppliedId the employee_id the request asked to act on, if any
 * @param opts.selfOnly refuse dashboard users acting on others (write paths that are
 *        only ever an employee acting for themselves)
 */
export async function resolveActor(
  req: NextRequest,
  suppliedId?: string | null,
  opts: { selfOnly?: boolean } = {},
): Promise<Actor> {
  const essId = essEmployeeFromRequest(req)

  if (essId) {
    // An employee may only ever act as themselves.
    if (suppliedId && suppliedId !== essId) {
      return { ok: false, response: NextResponse.json(
        { error: 'You can only act on your own travel records.' }, { status: 403 }) }
    }
    return { ok: true, employeeId: essId, onBehalf: false }
  }

  // No ESS token. A dashboard session can act on a named employee — that is how HR
  // reviews somebody's claim — but it has to name one.
  if (!opts.selfOnly) {
    const gate = await requireDashboardUser(req)
    if (!gate.error) {
      if (!suppliedId) {
        return { ok: false, response: NextResponse.json(
          { error: 'employee_id is required when acting on behalf of an employee.' }, { status: 400 }) }
      }
      return { ok: true, employeeId: suppliedId, onBehalf: true }
    }
  }

  // Fail closed. If no signing secret is configured, no ESS token can be verified —
  // say so plainly rather than letting every request through unauthenticated.
  if (essSessionUnavailable()) {
    return { ok: false, response: NextResponse.json(
      { error: 'ESS sessions are not configured on this deployment (ESS_SESSION_SECRET). Signed-in employees cannot be identified, so this request is refused.' },
      { status: 503 }) }
  }
  return { ok: false, response: NextResponse.json(
    { error: 'Sign in to continue.' }, { status: 401 }) }
}
