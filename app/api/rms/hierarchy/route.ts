// app/api/rms/hierarchy/route.ts — the reporting structure, read.
//
//   GET ?employee_id=…                 the chain above them: L1, L2, L3, L4, HOD
//   GET ?employee_id=…&view=reports    who reports to them directly
//   GET ?employee_id=…&view=tree       everybody beneath them, following L1
//
// The employee id comes from the query string, so it is checked rather than trusted:
// a caller may read their OWN line, or anybody's if their roles let them see the
// Employees module. Without that, an ESS employee could enumerate the whole org chart —
// including who reports to whom across companies — by changing one parameter.
import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, managerChainFor, directReportsFor, allReportsFor } from '@/lib/rms/server'
import { canSee } from '@/lib/rms/resolve'
import { isRelationshipType, type RelationshipType } from '@/lib/rms/hierarchy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const grant = await grantForRequest(req)
  if (!grant.employeeId && !grant.legacy) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  }

  const url = new URL(req.url)
  const employeeId = (url.searchParams.get('employee_id') || grant.employeeId || '').trim()
  if (!employeeId) {
    return NextResponse.json({ error: 'employee_id is required.' }, { status: 400 })
  }

  const isSelf = employeeId === grant.employeeId
  if (!isSelf && !canSee(grant, 'Employees')) {
    return NextResponse.json(
      { error: 'You can only see your own reporting line.' },
      { status: 403 },
    )
  }

  const view = url.searchParams.get('view') || 'managers'

  if (view === 'reports') {
    const t = url.searchParams.get('type')
    const type: RelationshipType | null = t === 'any' ? null : (t && isRelationshipType(t) ? t : 'L1')
    return NextResponse.json({ reports: await directReportsFor(employeeId, type) },
      { headers: { 'Cache-Control': 'no-store' } })
  }

  if (view === 'tree') {
    return NextResponse.json({ tree: await allReportsFor(employeeId) },
      { headers: { 'Cache-Control': 'no-store' } })
  }

  const [managers, reports] = await Promise.all([
    managerChainFor(employeeId),
    directReportsFor(employeeId, 'L1'),
  ])
  return NextResponse.json({ managers, direct_report_count: reports.length },
    { headers: { 'Cache-Control': 'no-store' } })
}
