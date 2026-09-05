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
    // The modules THIS employee holds — module name → NONE|VIEW|EDIT|FULL. The ESS
    // sidebar builds "What you manage" from this rather than from the browser's own
    // useGrant(), which answers for whoever is signed in. Those are the same person
    // until an admin opens somebody else's portal from Access Control, and then they
    // are not: the admin's modules would render inside the employee's sidebar.
    modules: ctx.grant.modules,
    can: { approvals: ctx.canApprovals, company: ctx.canCompany, reports: ctx.canReports },
    super_admin: ctx.grant.isSuperAdmin,
    view_as: ctx.caller.viewAs,
  })
}
