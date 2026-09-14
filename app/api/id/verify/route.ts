// app/api/id/verify/route.ts
//
//   POST { token, gate? } -> { valid, ... }
//
// The gate side. Deliberately UNAUTHENTICATED: a guard's phone camera and a
// fixed scanner at a turnstile have no EZER login, and requiring one would
// mean putting a shared credential on a device by the door.
//
// That is safe because the token itself is the credential — signed with a
// per-employee secret that never leaves the server, single use, and dead
// after 30 seconds. Somebody posting random tokens here learns nothing and
// leaves a row in id_card_scans for every attempt.
//
// The response is deliberately thin: name, code, designation, photo path,
// card number and access zones. No salary, no contact details, no identifiers.

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/profile/idcard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: string; gate?: string }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return NextResponse.json({ valid: false, reason: 'No code supplied.' }, { status: 400 })

  const result = await verifyToken(token, {
    gate: body.gate || req.headers.get('x-gate-id') || undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    ua: req.headers.get('user-agent') || undefined,
  })
  // 200 either way. A gate device reads `valid`; an HTTP error would make a
  // refused-but-genuine scan indistinguishable from a network fault.
  return NextResponse.json(result)
}
