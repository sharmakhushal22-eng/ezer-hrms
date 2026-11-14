// app/api/analytics/org/briefing/route.ts — the executive briefing: the month on one page.
//
// GET with the same query as ../route.ts, plus &window=last|mtd (last full month, or
// this month so far) and &refresh=1 for a fresh AI version. Same gate and slice as the
// figures (org-request.ts). Always answers: the AI version when it passed the number
// check, the template version otherwise (result.source says which).
import { NextRequest, NextResponse } from 'next/server'
import { orgFromRequest } from '@/lib/analytics/server/org-request'
import { briefingFor } from '@/lib/analytics/server/pieces'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const r = await orgFromRequest(req)
    if (r.error) return r.error
    const sp = req.nextUrl.searchParams
    const out = await briefingFor(r.full, r.body, r.access.tabs, sp.get('window') === 'mtd' ? 'mtd' : 'last', { actor: r.grant.employeeId, refresh: sp.get('refresh') === '1' })
    if (!out) return NextResponse.json({ error: 'No month-on-month figures for this selection yet.' }, { status: 404 })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not write the briefing.' }, { status: 500 })
  }
}
