// app/api/cron/lms-daily/route.ts — daily (vercel.json, 06:00 IST): scheduled publishing,
// dynamic assignments and new joiners, recertification, pre-joining conversions, and
// reminders (lib/lms/daily.ts). Protected by CRON_SECRET when it is set.
import { NextRequest, NextResponse } from 'next/server'
import { runLmsDaily } from '@/lib/lms/daily'
import { errorResponse } from '@/lib/lms/server'
import { requireCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const maxDuration = 300

async function run(req: NextRequest) {
  const denied = requireCron(req)
  if (denied) return denied
  try { return NextResponse.json({ ok: true, ...(await runLmsDaily()), ran_at: new Date().toISOString() }) }
  catch (e) { return errorResponse(e) }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
