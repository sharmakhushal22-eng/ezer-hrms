// app/api/analytics/me/route.ts — an employee's own insights (ESS).
//
// GET  (&employee_id= only for the audited admin "view as" preview, which essRoute checks)
//
// Identity comes from the session. The payload is the caller's own data plus one
// anonymous peer median (see lib/analytics/server/me.ts).
import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'
import { myAnalytics } from '@/lib/analytics/server/me'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  try {
    const body = await myAnalytics(r.ctx.caller.employeeId)
    return NextResponse.json({ ...body, isManager: r.ctx.menu.is_rm || r.ctx.menu.is_hod }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not build your insights.' }, { status: 500 })
  }
}
