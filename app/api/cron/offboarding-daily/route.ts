// app/api/cron/offboarding-daily/route.ts — daily (vercel.json, 00:30 IST): everybody whose
// last working day has passed loses ESS access, roles and reporting lines
// (lib/offboarding/run.ts). Protected by CRON_SECRET when it is set.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runOffboardingDaily } from '@/lib/offboarding/run'

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
    const out = await runOffboardingDaily(supabase as any)
    return NextResponse.json({ ok: true, checked: out.checked, revoked: out.revoked.map(r => ({ emp_code: r.emp_code, roles_off: r.roles_off, lines_closed: r.lines_closed, reports: r.reports, warnings: r.warnings })), errors: out.errors, notice_updated: out.notice_updated, ran_at: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
