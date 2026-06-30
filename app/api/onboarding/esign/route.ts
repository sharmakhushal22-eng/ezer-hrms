// app/api/onboarding/esign/route.ts
// POST — record the Aadhaar OTP eSign (mock) for the onboarding bundle (Phase 11).
// Marks policies_ack_complete + esign_complete; the existing /submit route owns final status.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { token, aadhaar_last4 } = await req.json()
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const { data: cand } = await supa.from('onboarding_candidates')
      .select('id, form_data').eq('magic_link_token', token).single()
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    const fd: any = cand.form_data || {}
    const last4 = aadhaar_last4 || fd.step_7?.aadhaar_last4 || fd.statutory?.aadhaar_last4 || null
    const now = new Date().toISOString()

    await supa.from('onboarding_esign_records').insert({
      onboarding_id: cand.id, aadhaar_last4: last4, otp_verified_at: now,
      signed_bundle: ['PERSONAL_FORM', 'EPF_FORM11', 'EPF_FORM2', 'GRATUITY_FORM_F', 'POLICY_ACK_BUNDLE'],
      esign_hash: randomUUID(),
    })

    await supa.from('onboarding_candidates').update({
      policies_ack_complete: true, esign_complete: true, esign_completed_at: now,
    }).eq('id', cand.id)

    await supa.from('onboarding_audit_log').insert({
      onboarding_id: cand.id, action: 'ESIGN_COMPLETED', actor_type: 'CANDIDATE',
      details: { aadhaar_last4: last4 },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
