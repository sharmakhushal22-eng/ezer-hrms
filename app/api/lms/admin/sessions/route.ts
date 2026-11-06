// app/api/lms/admin/sessions/route.ts — live sessions (webinars): the list, and a new one.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { createSession, listSessions } from '@/lib/lms/live'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'viewAssignments')
  if (error) return error
  try { return NextResponse.json({ sessions: await listSessions(actor, await readCompanies(actor, req.nextUrl.searchParams.get('company'))) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await createSession(actor, writeCompany(actor, b.company_id, 'assign'), b))
  } catch (e) { return errorResponse(e) }
}
