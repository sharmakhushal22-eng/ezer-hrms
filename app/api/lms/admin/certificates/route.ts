// app/api/lms/admin/certificates/route.ts — every certificate issued; revoke one.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { certificatesFor, revokeCertificate } from '@/lib/lms/reports'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'reports')
  if (error) return error
  try { return NextResponse.json({ certificates: await certificatesFor(actor, await readCompanies(actor, req.nextUrl.searchParams.get('company'))) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'publish')
  if (error) return error
  try {
    const b = await req.json()
    if (!String(b.reason || '').trim()) throw new LmsError('Record why this is being revoked.')
    await revokeCertificate(actor, String(b.id || ''), String(b.reason))
    return NextResponse.json({ ok: true })
  } catch (e) { return errorResponse(e) }
}
