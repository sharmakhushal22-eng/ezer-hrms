// app/api/lms/me/certificates/[id]/route.ts — the certificate PDF, for its owner.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { certificatePdf } from '@/lib/lms/certificate'
import { errorResponse, notFound, sb } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const { data: c } = await sb.from('lms_certificates').select('*').eq('id', (await params).id).maybeSingle()
    if (!c || !learner.allIds.includes(c.learner_id) || c.revoked_at) throw notFound('That certificate')
    const bytes = await certificatePdf(c)
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${c.cert_no}.pdf"` } })
  } catch (e) { return errorResponse(e) }
}
