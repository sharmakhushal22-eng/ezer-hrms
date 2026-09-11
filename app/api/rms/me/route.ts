// app/api/rms/me/route.ts — "who am I, and what may I open?"
//
// The one question the dashboard asks at the door. The browser sends its session token
// and gets back a resolved grant: roles, module access, approval rights, and whether
// enforcement is switched on yet.
//
// Resolution happens here rather than in the browser on purpose. The client never sends
// an employee id — it sends a signed token, and the id comes out of the signature. That
// is what stops somebody asking for somebody else's permissions.
import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, managerChainFor } from '@/lib/rms/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const grant = await grantForRequest(req)

  // The caller's own reporting line comes back with the grant, because every screen that
  // wants it already has the grant and would otherwise make a second round trip for it.
  const managers = grant.employeeId ? await managerChainFor(grant.employeeId) : []

  // 200 with an empty grant rather than 401: "not signed in" is an answer the dashboard
  // acts on by sending them to the login page, not an error it has to interpret.
  return NextResponse.json({ grant, managers }, { headers: { 'Cache-Control': 'no-store' } })
}
