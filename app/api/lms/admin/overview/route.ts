// app/api/lms/admin/overview/route.ts — who am I here, and the dashboard figures.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { overview } from '@/lib/lms/reports'
import { errorResponse, sb } from '@/lib/lms/server'

export const runtime = 'nodejs'

/** Everyone in Learning may see how much content exists. People's results are for Reports. */
function shape(o: any, reports: boolean) {
  if (reports) return o
  return { courses: o.courses, paths: o.paths, assignments: o.assignments }
}

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req)
  if (error) return error
  try {
    // ?lite=1: who this person is here, without the figures. The app asks this on every start to
    // decide whether to show the Studio at all; the Studio asks for the figures when it opens.
    const lite = req.nextUrl.searchParams.get('lite') === '1'
    const companies = await readCompanies(actor, req.nextUrl.searchParams.get('company'))
    const [{ data: names }, figures] = await Promise.all([
      sb.from('companies').select('id, company_name, company_code').in('id', actor.companies ?? await readCompanies(actor)),
      lite ? Promise.resolve(null) : overview(actor, companies),
    ])
    return NextResponse.json({
      caps: actor.caps, branch_only: !!actor.locationId, me: actor.employeeId, companies: names || [],
      overview: figures ? shape(figures, actor.caps.reports) : null,
    })
  } catch (e) { return errorResponse(e) }
}
