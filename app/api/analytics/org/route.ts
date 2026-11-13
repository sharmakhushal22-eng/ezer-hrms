// app/api/analytics/org/route.ts — the organisation analytics, for admin, CXO and HR.
//
// GET ?company=&department=&location=&type=&period=&cycle=  (&fresh=1 skips the
// 90-second reuse — the page's Refresh button sends it)
//
// The gate, the company pinning and the narrower slices (pay, named people) are in
// lib/analytics/server/org-request.ts, shared with the AI read at ./ai.
import { NextRequest, NextResponse } from 'next/server'
import { orgFromRequest } from '@/lib/analytics/server/org-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const r = await orgFromRequest(req, { fresh: req.nextUrl.searchParams.get('fresh') === '1' })
    if (r.error) return r.error
    return NextResponse.json(r.body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not build the analytics.' }, { status: 500 })
  }
}
