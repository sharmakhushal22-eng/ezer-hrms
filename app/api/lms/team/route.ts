// app/api/lms/team/route.ts — a manager's team. Reach comes from the reporting line, resolved
// on the server from the session. A candidate token cannot get here: essCaller refuses it.
import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'
import { decideRequest, managerAssign, teamView } from '@/lib/lms/team'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  try {
    if (!ctx.companyId) return NextResponse.json({ is_manager: false, people: [], rows: [], requests: [] })
    return NextResponse.json(await teamView(ctx.caller.employeeId, ctx.companyId))
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  try {
    if (ctx.caller.viewAs) throw new LmsError('You are viewing someone else\'s portal. Only they can do this.', 403)
    const b = await req.json()
    const me = ctx.grant.name || 'Manager'
    if (b.action === 'decide') return NextResponse.json(await decideRequest(ctx.caller.employeeId, me, String(b.enrollment_id || ''), !!b.approve, b.note || null))
    if (b.action === 'assign') return NextResponse.json(await managerAssign(ctx.caller.employeeId, me, ctx.companyId!, b))
    throw new LmsError('Unknown action.')
  } catch (e) { return errorResponse(e) }
}
