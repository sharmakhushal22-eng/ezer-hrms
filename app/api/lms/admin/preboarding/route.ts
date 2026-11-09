// app/api/lms/admin/preboarding/route.ts — pre-joining candidates: list, invite, resend, revoke.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { inviteCandidate, listCandidates, resendInvite, revokeCandidate } from '@/lib/lms/preboarding'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'viewAssignments')
  if (error) return error
  try { return NextResponse.json(await listCandidates(await readCompanies(actor, req.nextUrl.searchParams.get('company')), actor.locationId)) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    switch (b.action) {
      case 'invite': return NextResponse.json(await inviteCandidate(actor, writeCompany(actor, b.company_id, 'assign'), b))
      case 'resend': return NextResponse.json(await resendInvite(actor, String(b.learner_id || '')))
      case 'revoke': return NextResponse.json(await revokeCandidate(actor, String(b.learner_id || '')))
      default: throw new LmsError('Unknown action.')
    }
  } catch (e) { return errorResponse(e) }
}
