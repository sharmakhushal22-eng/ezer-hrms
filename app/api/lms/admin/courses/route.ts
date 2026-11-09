// app/api/lms/admin/courses/route.ts — the course list, and starting a new one.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { createCourse, listCourses } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Assigning needs the list too: a coordinator picks from it without being able to edit it.
  const { actor, error } = await lmsAdmin(req, ['viewContent', 'assign', 'reports'])
  if (error) return error
  try {
    const rows = await listCourses(await readCompanies(actor, req.nextUrl.searchParams.get('company')))
    return NextResponse.json({ courses: actor.caps.viewContent ? rows : rows.filter(r => r.status === 'PUBLISHED') })
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'editContent')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await createCourse(actor, writeCompany(actor, b.company_id, 'editContent'), b))
  } catch (e) { return errorResponse(e) }
}
