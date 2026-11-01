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
    const companies = await readCompanies(actor, req.nextUrl.searchParams.get('company'))
    const { data: names } = await sb.from('companies').select('id, company_name, company_code').in('id', actor.companies ?? await readCompanies(actor))
    return NextResponse.json({
      caps: actor.caps, branch_only: !!actor.locationId, companies: names || [],
      overview: shape(await overview(actor, companies), actor.caps.reports),
    })
  } catch (e) { return errorResponse(e) }
}
