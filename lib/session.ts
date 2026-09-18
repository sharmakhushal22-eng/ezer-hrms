// lib/session.ts — getSessionEmployee(), under the name the Today package
// imports it by.
//
// Identity in this app is a signed bearer token, and there are two kinds: an
// ESS session token issued at portal login, and a dashboard admin's Supabase
// token. essCaller() already resolves both, refuses the shared dashboard login
// unless it says whose portal is open, and decides whether an admin may look at
// somebody else's. Re-deriving any of that here would be a second copy of the
// rule, free to drift from the first.
//
// It needs the request, so the four Today routes pass the one they already
// hold. That is the only edit made to the package's own files.

import type { NextRequest } from 'next/server'
import { essCaller } from '@/lib/ess/session'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export interface SessionEmployee {
  id: string
  date_of_leaving: string | null
}

/** The signed-in employee, or null. Never throws: a route turns null into 401
 *  and a past date_of_leaving into 403, which is the standing rule — reads stop
 *  at the last working day. */
export async function getSessionEmployee(req?: NextRequest): Promise<SessionEmployee | null> {
  if (!req) return null
  const { caller, error } = await essCaller(req)
  if (error || !caller) return null

  const { data } = await sb.from('employees')
    .select('id, date_of_leaving').eq('id', caller.employeeId).maybeSingle()

  const row = data as { id?: string; date_of_leaving?: string | null } | null
  return { id: caller.employeeId, date_of_leaving: row?.date_of_leaving ?? null }
}
