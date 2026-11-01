// app/api/lms/admin/catalog/route.ts — course categories.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { listCategories, saveCategory } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req)
  if (error) return error
  try { return NextResponse.json({ categories: await listCategories(await readCompanies(actor, req.nextUrl.searchParams.get('company'))) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'publish')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json({ category: await saveCategory(actor, writeCompany(actor, b.company_id, 'publish'), b) })
  } catch (e) { return errorResponse(e) }
}
