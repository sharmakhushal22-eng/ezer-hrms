// lib/cron-auth.ts — one gate for every scheduled job.
//
// The cron routes each carried their own copy of "if CRON_SECRET is set, check it". Three
// things were wrong with that, in every copy: the route ran OPEN when the variable was not
// set (a preview deployment, a renamed env var), the secret was compared with `!==` (which
// returns on the first differing character), and some copies also accepted it as `?secret=`
// in the URL, where it lands in access logs and browser history.
//
// Now: no secret configured → refused (503, says so); header only; constant-time compare.
// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` by itself once the variable exists.
import { NextRequest, NextResponse } from 'next/server'
import { secretMatches } from '@/lib/rms/authz'

export function cronSecretGiven(req: NextRequest): boolean {
  const h = req.headers.get('authorization') || ''
  const given = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
  return secretMatches(given, process.env.CRON_SECRET)
}

/** Null when the caller holds the cron secret; otherwise the response to return. */
export function requireCron(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set on this deployment, so scheduled jobs are refused rather than run open.', code: 'CRON_NOT_CONFIGURED' },
      { status: 503 },
    )
  }
  if (!cronSecretGiven(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
