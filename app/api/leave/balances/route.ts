// app/api/leave/balances/route.ts — bring leave_balances up to date.
//
//   POST { company? } → recompute accrued + used for every active employee in
//                        the caller's company scope and write them.
//
// The dashboard Leave Report reads leave_balances directly. It calls this first
// so the report shows what the Leave tab shows — accrual to the last completed
// month and every approved day — rather than whatever was last written. The
// daily job does the same for everybody (app/api/cron/leave-daily).
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { grantForRequest } from '@/lib/rms/server'
import { companyFilter, hasLevel } from '@/lib/rms/resolve'
import { syncAllBalances } from '@/lib/leave/ledger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await requireDashboardUser(req)
  if (user.error) return user.error
  const grant = await grantForRequest(req)
  // Whoever can open the Leave Report (Reports) or the attendance screens.
  if (!hasLevel(grant, 'Reports', 'VIEW') && !hasLevel(grant, 'Attendance', 'VIEW')) {
    return NextResponse.json({ error: 'Leave balances are not part of your access.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { company?: string }
  const co = companyFilter(grant, body.company ?? null)
  const r = await syncAllBalances(co)
  if (r.error) return NextResponse.json(r, { status: 500 })
  return NextResponse.json({ ok: true, ...r })
}
