// app/api/lms/admin/audit/route.ts — the audit trail, newest first.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { auditTrail } from '@/lib/lms/reports'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['publish', 'automate', 'reports'])
  if (error) return error
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json({ rows: await auditTrail(await readCompanies(actor, sp.get('company')), Number(sp.get('page') || 0)) })
  } catch (e) { return errorResponse(e) }
}
