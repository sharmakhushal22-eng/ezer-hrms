// app/api/lms/admin/overview/route.ts — who am I here, and the dashboard figures.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { overview } from '@/lib/lms/reports'
import { errorResponse, sb } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req)
  if (error) return error
  try {
    const companies = await readCompanies(actor, req.nextUrl.searchParams.get('company'))
    const { data: names } = await sb.from('companies').select('id, company_name, company_code').in('id', actor.companies ?? await readCompanies(actor))
    return NextResponse.json({
      caps: actor.caps, branch_only: !!actor.locationId, companies: names || [],
      overview: actor.caps.reports || actor.caps.viewContent || actor.caps.viewAssignments ? await overview(actor, companies) : null,
    })
  } catch (e) { return errorResponse(e) }
}
