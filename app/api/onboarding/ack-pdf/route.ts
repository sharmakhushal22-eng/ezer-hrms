// app/api/onboarding/ack-pdf/route.ts
// GET ?token= — the joining acknowledgement as a PDF on the company's letterhead, for the
// "Download acknowledgement" button on the last screen of the onboarding link.
// Token-gated like every other /api/onboarding route; read-only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ackPdf } from '@/lib/onboarding/ack-pdf'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const { data: cand } = await supa.from('onboarding_candidates')
      .select('id, full_name, designation, department, date_of_joining, employee_code, company_id, location_id, form_data, esic_applicable, offered_ctc, esign_completed_at, magic_link_token')
      .eq('magic_link_token', token).single()
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    const [{ data: company }, { data: policies }, { count: docCount }, { data: esign }, loc] = await Promise.all([
      supa.from('companies').select('id, company_name, company_code, group_id, reg_office, corp_office, cin, gstin, pan').eq('id', cand.company_id).maybeSingle(),
      supa.from('onboarding_policy_acks').select('policy_code, policy_title, policy_version, acknowledged_at')
        .eq('onboarding_id', cand.id).not('acknowledged_at', 'is', null).order('ack_order'),
      supa.from('onboarding_documents').select('id', { count: 'exact', head: true }).eq('onboarding_id', cand.id),
      supa.from('onboarding_esign_records').select('aadhaar_last4, otp_verified_at').eq('onboarding_id', cand.id)
        .order('otp_verified_at', { ascending: false }).limit(1).maybeSingle(),
      cand.location_id
        ? supa.from('locations').select('location_name, city').eq('id', cand.location_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
    ])

    const fd: any = cand.form_data || {}
    const gross = cand.offered_ctc ? Number(cand.offered_ctc) / 12 : 0
    const esic = cand.esic_applicable === true || fd.step_7?.esic_applicable === true || (gross > 0 && gross <= 21000)
    const locData: any = (loc as any)?.data

    const { name, content } = await ackPdf(company || { company_name: 'Your company' }, {
      ackNo: `EZR-ACK-${token.slice(0, 8).toUpperCase()}`,
      generatedAt: new Date(),
      employeeName: fd.step_3?.full_name || cand.full_name,
      fatherName: fd.step_3?.father_name || null,
      employeeCode: cand.employee_code || null,
      designation: cand.designation,
      department: cand.department,
      doj: cand.date_of_joining,
      companyName: company?.company_name || 'Your company',
      workLocation: [locData?.location_name, locData?.city].filter(Boolean).join(', ') || null,
      aadhaarLast4: esign?.aadhaar_last4 || fd.step_7?.aadhaar_last4 || null,
      esignedAt: esign?.otp_verified_at || cand.esign_completed_at || null,
      forms: ['EPF Form 11', 'EPF Form 2', 'Gratuity Form F', ...(esic ? ['ESIC Form 1'] : []), 'Policy acknowledgements'],
      documents: docCount || 0,
      policies: (policies || []).map(p => ({ code: p.policy_code, title: p.policy_title, version: p.policy_version, at: p.acknowledged_at })),
    })

    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${req.nextUrl.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Could not build the PDF' }, { status: 500 })
  }
}
