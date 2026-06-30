// app/api/onboarding/ack-preview/route.ts
// GET — auto-filled data for the Acknowledgement document preview (Phase 10).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const { data: cand } = await supa.from('onboarding_candidates')
      .select('id, full_name, designation, department, date_of_joining, employment_type, employee_code, company_id, location_id, form_data')
      .eq('magic_link_token', token).single()
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    // companies.work_location doesn't exist in this schema — fall back to the branch name.
    const { data: company } = await supa.from('companies').select('company_name, company_code').eq('id', cand.company_id).single()
    let work_location = '—'
    if (cand.location_id) {
      const { data: loc } = await supa.from('locations').select('location_name, city').eq('id', cand.location_id).maybeSingle()
      work_location = [loc?.location_name, loc?.city].filter(Boolean).join(', ') || '—'
    }

    const { data: policies } = await supa.from('onboarding_policy_acks')
      .select('policy_code, policy_title, acknowledged_at').eq('onboarding_id', cand.id)
      .not('acknowledged_at', 'is', null).order('ack_order')

    const fd: any = cand.form_data || {}
    return NextResponse.json({
      employee_name: cand.full_name,
      father_name:   fd.step_3?.father_name || fd.personal?.father_name || '—',
      employee_code: cand.employee_code || 'Pending',
      designation:   cand.designation,
      department:    cand.department,
      doj:           cand.date_of_joining,
      company_name:  company?.company_name,
      work_location,
      aadhaar_last4: fd.step_7?.aadhaar_last4 || fd.statutory?.aadhaar_last4 || '****',
      policies_acked: policies || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
