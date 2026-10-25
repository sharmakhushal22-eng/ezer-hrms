// app/api/cron/immigration-reminders/route.ts — daily (vercel.json, 09:30 IST): the passport /
// visa / work permit / FRRO / SSA reminders for foreign nationals and overseas employees, at
// 60, 30 and 7 days before and on the day, each once (lib/onboarding/immigration.ts).
// Protected by CRON_SECRET when it is set (Vercel sends it as a bearer token).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runImmigrationReminders } from '@/lib/onboarding/immigration'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}` && req.nextUrl.searchParams.get('secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const out = await runImmigrationReminders(supabase as any, { baseUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin })
    return NextResponse.json({ ok: true, ...out, ran_at: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
