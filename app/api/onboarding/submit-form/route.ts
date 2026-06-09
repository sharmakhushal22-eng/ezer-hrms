// app/api/onboarding/submit-form/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Uses the anon key (no service-role key configured); the onboarding tables
// are created without RLS, so the anon role can read/write them.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { tokenId, candidateId, companyId, form, nominee, gratNominee, acceptedPolicies } = await req.json()

    // 1. Save joining form
    const { error: formErr } = await supabase.from('employee_joining_forms').upsert({
      token_id: tokenId, candidate_id: candidateId, company_id: companyId,
      full_name: form.full_name, dob: form.dob || null, father_name: form.father_name,
      gender: form.gender, blood_group: form.blood_group, marital_status: form.marital_status,
      mobile: form.mobile, personal_email: form.personal_email,
      aadhaar_number: form.aadhaar, pan_number: form.pan, nationality: form.nationality || 'Indian',
      photo_url: form.photo_uploaded ? 'uploaded' : null,
      perm_address: { street: form.perm_street, city: form.perm_city, state: form.perm_state, pin: form.perm_pin },
      curr_address: form.curr_same ? null : { street: form.curr_street, city: form.curr_city, state: form.curr_state, pin: form.curr_pin },
      same_address: form.curr_same,
      emergency_1: { name: form.emergency_1_name, relation: form.emergency_1_relation, mobile: form.emergency_1_mobile },
      emergency_2: { name: form.emergency_2_name, relation: form.emergency_2_relation, mobile: form.emergency_2_mobile },
      designation: form.designation, doj: form.doj || null, highest_qual: form.highest_qual,
      prev_employer: form.prev_employer, prev_uan: form.prev_uan, prev_pf_id: form.prev_pf_id,
      pf_transfer: form.pf_transfer,
      bank_account: form.bank_account ? '***' + form.bank_account.slice(-4) : null,
      bank_ifsc: form.bank_ifsc, bank_name: form.bank_name, bank_branch: form.bank_branch,
      account_type: form.account_type, account_holder: form.account_holder,
      reference_1: { name: form.ref1_name, designation: form.ref1_desig, company: form.ref1_company, relation: form.ref1_relation, mobile: form.ref1_mobile, email: form.ref1_email },
      reference_2: { name: form.ref2_name, designation: form.ref2_desig, company: form.ref2_company, relation: form.ref2_relation, mobile: form.ref2_mobile, email: form.ref2_email },
      photo_uploaded: form.photo_uploaded, uan_card_uploaded: form.uan_uploaded, esic_card_uploaded: form.esic_uploaded,
      form_status: 'SUBMITTED', submitted_at: new Date().toISOString(),
    })
    if (formErr) throw new Error('Form save failed: ' + formErr.message)

    // 2. Save compliance forms
    await supabase.from('policy_acceptance_records').insert(
      acceptedPolicies.map((p: string) => ({
        candidate_id: candidateId, company_id: companyId,
        policy_name: p, accepted_at: new Date().toISOString(),
      }))
    )

    // 3. Update token status
    await supabase.from('joining_formalities_tokens').update({
      status: 'SUBMITTED', submitted_at: new Date().toISOString(),
    }).eq('id', tokenId)

    // 4. Update candidate DOJ if provided
    if (form.doj) {
      await supabase.from('candidates').update({ doj: form.doj }).eq('id', candidateId)
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
