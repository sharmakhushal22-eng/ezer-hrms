// app/api/ess/id-card/token/route.ts
//
//   GET -> a fresh 30-second QR token for YOUR OWN card
//
// The screen calls this every 15 seconds. It refuses any card but the
// caller's own: a manager or an HR admin has no business pulling somebody
// else's live gate code, and "I can see their profile" is not the same
// permission as "I can walk through their door".

import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'
import { issueToken } from '@/lib/profile/idcard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error

  // viewAs covers both the shared dashboard login and a real person looking
  // at a colleague's portal. Neither may mint that colleague's gate code.
  if (ctx.caller.viewAs) {
    return NextResponse.json({
      error: 'A gate code can only be issued for your own card. Open your own portal.',
    }, { status: 403 })
  }

  try {
    // The origin the browser actually reached us on. Without it a QR minted on
    // a LAN address would still encode whatever NEXT_PUBLIC_APP_URL says, and
    // a phone cannot scan its way to somebody else's localhost.
    //
    // Read from the Host header, NOT req.nextUrl.origin: nextUrl normalises to
    // the configured origin, so it answered "localhost" even for a request
    // that arrived on 10.0.1.42 — which is precisely the case this is for.
    // x-forwarded-* first, so it stays correct behind a proxy.
    const fwdHost  = req.headers.get('x-forwarded-host')
    const fwdProto = req.headers.get('x-forwarded-proto')
    const host = fwdHost || req.headers.get('host')
    const proto = fwdProto || (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
    const origin = host ? `${proto}://${host}` : null

    return NextResponse.json(await issueToken(ctx.caller.employeeId, origin))
  } catch (e) {
    const m = e instanceof Error ? e.message : 'failed'
    if (m.includes('ID_CARD_PEPPER')) {
      return NextResponse.json({
        error: 'The ID card is not configured on this server yet (ID_CARD_PEPPER).',
      }, { status: 503 })
    }
    if (m === 'rate_limited') {
      return NextResponse.json({
        error: 'Too many codes requested. Wait a moment and try again.',
      }, { status: 429 })
    }
    if (m.startsWith('card_')) {
      return NextResponse.json({
        error: `This card is ${m.slice(5)}. Ask HR to reissue it.`,
      }, { status: 403 })
    }
    return NextResponse.json({ error: m }, { status: 500 })
  }
}
