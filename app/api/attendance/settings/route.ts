// app/api/attendance/settings/route.ts
//
//   GET  -> every company's backdated-leave window
//   POST -> set one company's window
//
// THE ROUTE MIGRATION 132 SAID EXISTED AND DIDN'T.
//
// 132 puts a deny-all RLS policy on leave_backdate_config for anon and
// authenticated, with a comment saying reads and writes go through a route
// holding the service-role key. That route was never written: the admin screen
// called supabase.from(...).upsert() straight from the browser with the anon
// key, exactly as lib/supabase-shift.ts does for its other tables — which works
// there only because those tables are not locked down. The result was a Save
// button that always failed with "new row violates row-level security policy".
//
// The lesson is not "the policy was wrong". The policy is right: this table
// says how far back anybody in a company may rewrite their attendance, and the
// browser has no business writing it directly. What was missing is this file.

import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { grantForRequest } from '@/lib/rms/server'
import { companyFilter } from '@/lib/rms/resolve'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Matches the CHECK constraint in 132, and the reason for it: leave outside
 *  the financial year is never counted by the balance arithmetic, so a window
 *  wide enough to cross two FY boundaries would approve leave that is then
 *  never deducted from anybody's entitlement. */
const MAX_WINDOW = 365

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Attendance', 'VIEW')
  if (gate.error) return gate.error

  const grant = await grantForRequest(req)
  let q = sb.from('leave_backdate_config').select('company_id, window_days, updated_at')
  // A caller pinned to one company sees only their own row. companyFilter
  // returns null for a cross-company role, which leaves the query unfiltered.
  const co = companyFilter(grant, null)
  if (co) q = q.eq('company_id', co)

  const { data, error } = await q
  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Migration 132 has not been run — leave_backdate_config does not exist.' : error.message },
      { status: missing ? 503 : 500 },
    )
  }
  return NextResponse.json({ windows: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  // EDIT, not VIEW: this changes a policy that applies to every employee in the
  // company. Worth knowing that while rms_config.enforce_module_access is false
  // this check passes for any signed-in dashboard user — hasLevel() short
  // circuits when enforcement is off. That is a pre-existing property of every
  // requireModule call in the app, not something this route introduces, but it
  // means the real protection here is still the service-role boundary.
  const gate = await requireModule(req, 'Attendance', 'EDIT')
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({})) as { company_id?: unknown; window_days?: unknown }
  const requested = typeof body.company_id === 'string' ? body.company_id : ''
  if (!requested) return NextResponse.json({ error: 'Choose a company.' }, { status: 400 })

  const n = Number(body.window_days)
  if (!Number.isFinite(n) || n < 0 || n > MAX_WINDOW || Math.floor(n) !== n) {
    return NextResponse.json(
      { error: `The window must be a whole number of days between 0 and ${MAX_WINDOW}.` },
      { status: 400 },
    )
  }

  // The company is pinned server-side. A caller who is not cross-company may
  // only write their own, whatever the body asks for — the same choke point
  // every other dashboard write uses.
  const grant = await grantForRequest(req)
  const pinned = companyFilter(grant, requested)
  const company_id = pinned || requested
  if (pinned && pinned !== requested) {
    return NextResponse.json({ error: 'That company is outside your access.' }, { status: 403 })
  }

  const { data, error } = await sb
    .from('leave_backdate_config')
    .upsert(
      { company_id, window_days: n, updated_at: new Date().toISOString(), updated_by: grant.employeeId },
      { onConflict: 'company_id' },
    )
    .select('company_id, window_days, updated_at')
    .maybeSingle()

  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Migration 132 has not been run — leave_backdate_config does not exist.' : error.message },
      { status: missing ? 503 : 500 },
    )
  }
  return NextResponse.json({ ok: true, window: data }, { headers: { 'Cache-Control': 'no-store' } })
}
