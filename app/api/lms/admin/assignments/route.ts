// app/api/lms/admin/assignments/route.ts — list, preview, create, and import from Excel.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { createAssignment, importAssignments, listAssignments, previewAudience } from '@/lib/lms/assign'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'viewAssignments')
  if (error) return error
  try { return NextResponse.json({ assignments: await listAssignments(actor, await readCompanies(actor, req.nextUrl.searchParams.get('company'))) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    const company = writeCompany(actor, b.company_id, 'assign')
    if (b.mode === 'preview') return NextResponse.json(await previewAudience(actor, company, b))
    if (b.mode === 'import') return NextResponse.json(await importAssignments(actor, company, b))
    return NextResponse.json(await createAssignment(actor, company, b))
  } catch (e) { return errorResponse(e) }
}
