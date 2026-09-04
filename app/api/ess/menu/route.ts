// GET /api/ess/menu — the nav as data. The UI renders whatever comes back; it is a
// convenience for the UI and never the authorization (every route re-checks).
import { NextRequest, NextResponse } from 'next/server'
import { essRoute } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  return NextResponse.json({
    tabs: ctx.tabs,
    is_rm: ctx.menu.is_rm, direct_reports: ctx.menu.direct_reports,
    is_hod: ctx.menu.is_hod, hod_departments: ctx.menu.hod_departments,
    roles: ctx.grant.roles.map(x => ({ code: x.role_code, name: x.role_name, scope: x.scope })),
    functional_scope: ctx.menu.functional_scope,
    approval_types: ctx.menu.approval_types,
    can: { approvals: ctx.canApprovals, company: ctx.canCompany, reports: ctx.canReports },
    super_admin: ctx.grant.isSuperAdmin,
    view_as: ctx.caller.viewAs,
  })
}
