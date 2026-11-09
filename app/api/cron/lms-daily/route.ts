// app/api/cron/lms-daily/route.ts — daily (vercel.json, 06:00 IST): scheduled publishing,
// dynamic assignments and new joiners, recertification, pre-joining conversions, and
// reminders (lib/lms/daily.ts). Protected by CRON_SECRET when it is set.
import { NextRequest, NextResponse } from 'next/server'
import { runLmsDaily } from '@/lib/lms/daily'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'
export const maxDuration = 300

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}` && req.nextUrl.searchParams.get('secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try { return NextResponse.json({ ok: true, ...(await runLmsDaily()), ran_at: new Date().toISOString() }) }
  catch (e) { return errorResponse(e) }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
