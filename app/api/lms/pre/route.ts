// app/api/lms/pre/route.ts — a candidate signing in from their personal link. Public by
// design: the link token is the credential, and every path through it is rate-limited.
import { NextRequest, NextResponse } from 'next/server'
import { openLink, sendOtp, verifyOtp } from '@/lib/lms/preboarding'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const token = String(b.token || '')
    if (!token) throw new LmsError('This link is not valid any more. Ask HR for a new one.', 404)
    switch (b.action) {
      case 'open': return NextResponse.json(await openLink(token))
      case 'send': return NextResponse.json(await sendOtp(token))
      case 'verify': return NextResponse.json(await verifyOtp(token, String(b.otp || '')))
      default: throw new LmsError('Unknown action.')
    }
  } catch (e) { return errorResponse(e) }
}
