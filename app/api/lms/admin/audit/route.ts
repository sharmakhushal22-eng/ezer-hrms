// app/api/lms/admin/audit/route.ts — the audit trail, newest first.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { auditTrail } from '@/lib/lms/reports'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['publish', 'automate', 'reports'])
  if (error) return error
  try {
    // The trail spans the whole company, which is more than a branch-limited role may read.
    if (actor.locationId) throw new LmsError('The audit log covers the whole company, and your access covers your branch.', 403)
    const sp = req.nextUrl.searchParams
    return NextResponse.json({ rows: await auditTrail(await readCompanies(actor, sp.get('company')), Number(sp.get('page') || 0)) })
  } catch (e) { return errorResponse(e) }
}
