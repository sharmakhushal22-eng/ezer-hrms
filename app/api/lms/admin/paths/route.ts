// app/api/lms/admin/paths/route.ts — learning paths.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { listPaths, savePath } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['viewContent', 'assign'])
  if (error) return error
  try { return NextResponse.json({ paths: await listPaths(await readCompanies(actor, req.nextUrl.searchParams.get('company'))) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'editContent')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await savePath(actor, b.id ? '' : writeCompany(actor, b.company_id, 'editContent'), b))
  } catch (e) { return errorResponse(e) }
}
