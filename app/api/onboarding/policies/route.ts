// app/api/onboarding/policies/route.ts
// GET — company-specific active policies for a candidate's onboarding (Phase 9, config-driven).
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
      .select('id, company_id').eq('magic_link_token', token).single()
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    const { data: policies } = await supa.from('company_policies')
      .select('id, policy_code, policy_title, policy_body, is_mandatory, sort_order, version')
      .eq('company_id', cand.company_id).eq('is_active', true).order('sort_order')

    const { data: acks } = await supa.from('onboarding_policy_acks')
      .select('policy_id, acknowledged_at').eq('onboarding_id', cand.id)
    const ackedIds = (acks || []).filter((a: any) => a.acknowledged_at).map((a: any) => a.policy_id)

    return NextResponse.json({ policies: policies || [], ackedIds, total: policies?.length || 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
