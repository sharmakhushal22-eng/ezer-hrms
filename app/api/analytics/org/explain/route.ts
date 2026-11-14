// app/api/analytics/org/explain/route.ts — "Why?" on a figure, chart or finding.
//
// GET with the same query as ../route.ts, plus &topic=m:ontime|k:attrition|c:att-heat|i:<id>
// (lib/analytics/topics.ts) and &window=mtd|last. Answers with the breakdown that moved
// the figure and an explanation: the AI's when it passed the number check, else the
// template's. Same gate and slice as the figures — a topic outside the reader's tabs
// finds nothing.
import { NextRequest, NextResponse } from 'next/server'
import { orgFromRequest } from '@/lib/analytics/server/org-request'
import { explainFor } from '@/lib/analytics/server/pieces'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const r = await orgFromRequest(req)
    if (r.error) return r.error
    const sp = req.nextUrl.searchParams
    const topic = (sp.get('topic') || '').slice(0, 60)
    const out = await explainFor(r.full, r.body, r.access.tabs, topic, sp.get('window') === 'last' ? 'last' : 'mtd', { actor: r.grant.employeeId, refresh: sp.get('refresh') === '1' })
    if (!out) return NextResponse.json({ error: 'There is nothing to explain for that figure in your view.' }, { status: 404 })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not explain that figure.' }, { status: 500 })
  }
}
