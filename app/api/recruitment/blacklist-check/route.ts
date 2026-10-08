// app/api/recruitment/blacklist-check/route.ts — is this Aadhaar / PAN blacklisted?
//   POST { aadhaar?, pan? } -> { blocked: null | { by:'AADHAAR'|'PAN', candidate_name, reason, created_at } }
// Called by Add Candidate before the candidate is saved. The blacklist itself is server-only.

import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { findBlacklisted, normAadhaar, normPan, validAadhaar, validPan } from '@/lib/recruitment/blacklist'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const b = await req.json().catch(() => ({})) as any
  const a = normAadhaar(b.aadhaar), p = normPan(b.pan)
  if (a && !validAadhaar(a)) return NextResponse.json({ error: 'Aadhaar must be 12 digits.' }, { status: 400 })
  if (p && !validPan(p)) return NextResponse.json({ error: 'PAN must look like ABCDE1234F.' }, { status: 400 })
  try {
    return NextResponse.json({ blocked: await findBlacklisted(a, p) })
  } catch (e: any) {
    // A missing table (migration 134 not run yet) must not stop recruiters adding candidates.
    return NextResponse.json({ blocked: null, warning: e?.message || 'Blacklist check unavailable' })
  }
}
