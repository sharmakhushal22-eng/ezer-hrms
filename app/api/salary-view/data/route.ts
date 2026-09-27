// app/api/salary-view/data/route.ts — the offer itself, only after the OTP login.
//   GET ?token=…  (header x-salary-access: <access from /otp verify>)  -> { data, meta }
//
// Before the OTP gate the page fetched the negotiation server-side and rendered it
// straight away; now nothing about the salary leaves the server until the candidate
// has proved they own the registered email.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { negotiationByToken, verifiedCaller } from '../_shared'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  const neg = await negotiationByToken(token)
  if (!neg) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (!(await verifiedCaller(req, token, neg))) return NextResponse.json({ error: 'Please verify your email to open this offer.' }, { status: 401 })

  // Company · branch · department for the header — from the offer's company and the
  // candidate's requisition (location = branch, department from the MRF).
  const meta: { company_name?: string; branch?: string; department?: string; designation?: string } = {}
  if (neg.company_id) {
    const { data: co } = await sb.from('companies').select('company_name, company_code').eq('id', neg.company_id).maybeSingle()
    meta.company_name = co?.company_name || co?.company_code || undefined
  }
  if (neg.candidate_id) {
    const { data: cand } = await sb.from('candidates').select('mrf_id, designation').eq('id', neg.candidate_id).maybeSingle()
    if (cand?.designation) meta.designation = cand.designation
    if (cand?.mrf_id) {
      const { data: mrf } = await sb.from('manpower_requisitions')
        .select('designation, position, departments:department_id(dept_name), locations:location_id(location_name)').eq('id', cand.mrf_id).maybeSingle()
      meta.department = (mrf as any)?.departments?.dept_name || undefined
      meta.branch = (mrf as any)?.locations?.location_name || undefined
      meta.designation = meta.designation || (mrf as any)?.designation || (mrf as any)?.position || undefined
    }
  }

  // "Viewed" now means the candidate actually got past the login.
  if (!neg.link_viewed_at) await sb.from('ctc_negotiations').update({ link_viewed_at: new Date().toISOString() }).eq('id', neg.id)

  const { otp_hash: _h, otp_expires_at: _e, otp_attempts: _a, ...data } = neg
  return NextResponse.json({ data, meta })
}
