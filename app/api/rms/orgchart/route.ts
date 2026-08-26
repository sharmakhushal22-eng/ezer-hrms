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
import { requireModule } from '@/lib/api-auth'
import { orgTreeFor, peersFor, orphansFor, spanOfControlFor, driftReportFor } from '@/lib/rms/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Employees')
  if (gate.error) return gate.error

  const url = new URL(req.url)
  const view = url.searchParams.get('view') || 'tree'
  const companyId = url.searchParams.get('company_id') || undefined

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
