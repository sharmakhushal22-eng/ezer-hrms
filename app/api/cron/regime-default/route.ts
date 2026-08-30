// GET /api/cron/regime-default — runs on the 5th of every month (vercel.json).
// Anyone without a regime election for the current FY is put on the New Regime
// (migration 072, fn_default_regime_new). Safe to call any day: the function
// refuses on the 1st–4th unless ?force=1 is passed by an admin.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const fy = req.nextUrl.searchParams.get('fy') || null
  const { data, error } = await sb.rpc('fn_default_regime_new', { p_fy: fy, p_force: force })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ...data })
}
