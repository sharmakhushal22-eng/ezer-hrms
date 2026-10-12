// app/api/cron/leave-daily/route.ts — the daily leave & attendance job, by hand.
//
// The scheduled run happens inside app/api/cron/offer-followup (see
// lib/leave/daily.ts for why). This route exists to run it on demand — after
// changing a quota, say — with the same CRON_SECRET protection.
import { NextRequest, NextResponse } from 'next/server'
import { runLeaveDaily } from '@/lib/leave/daily'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const r = await runLeaveDaily()
  return NextResponse.json({ ok: !r.balances.error, ...r })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
