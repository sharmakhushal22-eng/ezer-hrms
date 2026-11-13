// app/api/analytics/org/ai/route.ts — the AI read of the organisation analytics.
//
// GET with the same query as ../route.ts, plus &refresh=1 to write a new read.
//
// Same gate and same slice as the figures (org-request.ts). What leaves the server is
// the fact sheet from lib/analytics/ai/facts.ts — aggregates, no names — and what
// comes back is shown only after lib/analytics/ai/validate.ts has checked every number.
import { NextRequest, NextResponse } from 'next/server'
import { orgFromRequest } from '@/lib/analytics/server/org-request'
import { orgFacts } from '@/lib/analytics/ai/facts'
import { aiBrief } from '@/lib/analytics/server/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const r = await orgFromRequest(req)
    if (r.error) return r.error
    const out = await aiBrief(orgFacts(r.body), { actor: r.grant.employeeId, refresh: req.nextUrl.searchParams.get('refresh') === '1' })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not write the AI read.' }, { status: 500 })
  }
}
