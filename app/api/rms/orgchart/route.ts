// app/api/rms/orgchart/route.ts — the whole org, and the diagnostics that come with it.
//
//   GET ?company_id=…                the whole company as a flat, parent-linked list
//   GET ?employee_id=…&view=peers    who shares this person's L1 manager
//   GET ?company_id=…&view=orphans   active employees with nobody above them
//   GET ?company_id=…&view=span      managers ranked by direct reports
//   GET ?company_id=…&view=drift     l1_manager_id / l2_manager_id vs the tree
//
// Gated on the Employees module: an org chart is an employee data view, not a module
// of its own, and giving it a separate permission would mean two grants for one job.
import { NextRequest, NextResponse } from 'next/server'
import { requireModule, requireDashboardUser } from '@/lib/api-auth'
import { orgTreeFor, peersFor, orphansFor, spanOfControlFor, driftReportFor, grantForRequest } from '@/lib/rms/server'
import { companyFilter } from '@/lib/rms/resolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const view = url.searchParams.get('view') || 'tree'

  // The TREE is for every signed-in employee — an org chart is who works here and
  // who they report to, the same facts the ESS Team tab and the inbox directory
  // already show. The diagnostics stay behind the Employees module: orphans and
  // span-of-control are HR's problem list, not a colleague directory.
  const gate = view === 'tree'
    ? await requireDashboardUser(req)
    : await requireModule(req, 'Employees')
  if (gate.error) return gate.error

  // Force the company to the caller's own unless they are a cross-company (super-admin)
  // role. A non-cross caller asking for another company — or 'ALL' — is pinned back to
  // theirs; a cross caller may narrow to a pick or, with none, see every company (null).
  const grant = await grantForRequest(req)
  const requested = url.searchParams.get('company_id')
  const companyId = companyFilter(grant, requested) || undefined

  if (view === 'peers') {
    const employeeId = url.searchParams.get('employee_id')
    if (!employeeId) return NextResponse.json({ error: 'employee_id is required.' }, { status: 400 })
    const peers = await peersFor(employeeId)
    return NextResponse.json({ peers }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (view === 'orphans') {
    return NextResponse.json({ orphans: await orphansFor(companyId) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (view === 'span') {
    return NextResponse.json({ span: await spanOfControlFor(companyId) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (view === 'drift') {
    return NextResponse.json({ drift: await driftReportFor(companyId) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (!companyId) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })
  const tree = await orgTreeFor(companyId)
  return NextResponse.json({ tree }, { headers: { 'Cache-Control': 'no-store' } })
}
