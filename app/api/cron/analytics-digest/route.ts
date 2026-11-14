// app/api/cron/analytics-digest/route.ts — the scheduled analytics emails (vercel.json):
//   ?kind=monday    09:00 IST every Monday, again at 09:30 to finish anyone left over
//   ?kind=monthly   10:00 IST on the 1st — last month's executive briefing
// Both are off until switched on in People Analytics → Email digests (migration 233).
// Each run sends to whoever has not had it yet this week / month, within ~4 minutes.
// Protected by CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runDigest } from '@/lib/analytics/server/digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(req: NextRequest) {
  const denied = requireCron(req)
  if (denied) return denied
  const k = req.nextUrl.searchParams.get('kind')
  if (k !== 'monday' && k !== 'monthly') return NextResponse.json({ error: 'kind must be monday or monthly' }, { status: 400 })
  try {
    const report = await runDigest(k === 'monday' ? 'monday_note' : 'monthly_briefing')
    return NextResponse.json({ ok: true, ...report, ran_at: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Digest run failed.' }, { status: 500 })
  }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
