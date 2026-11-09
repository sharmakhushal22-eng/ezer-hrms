// app/api/lms/sso/route.ts — HRMS side of the hand-off to EZER Learn's own domain.
// The signed-in person asks for a one-minute code that the LMS trades for a session of its own
// (lib/lms/sso.ts). Answers on both sites, so a hand-off can be tested on either.
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { issueHandoff } from '@/lib/lms/sso'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { user, error } = await requireDashboardUser(req)
  if (error) return error
  const code = user.kind === 'ess' && user.employeeId
    ? issueHandoff({ kind: 'ess', employeeId: user.employeeId })
    : user.email ? issueHandoff({ kind: 'legacy', userId: user.id, email: user.email }) : null
  if (!code) return NextResponse.json({ error: 'Sign-in hand-off is not available on this deployment.' }, { status: 503 })
  return NextResponse.json({ code }, { headers: { 'Cache-Control': 'no-store' } })
}
