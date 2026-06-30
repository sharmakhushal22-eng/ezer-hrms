// app/api/onboarding/acknowledge-policy/route.ts
// POST — record a single policy acknowledgement (saved immediately, resume-safe).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { token, policy_id, policy_code, policy_title, policy_version } = await req.json()
    if (!token || !policy_id) return NextResponse.json({ error: 'token and policy_id required' }, { status: 400 })

    const { data: cand } = await supa.from('onboarding_candidates').select('id').eq('magic_link_token', token).single()
    if (!cand) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    // ack_order = how many already acknowledged + 1
    const { count } = await supa.from('onboarding_policy_acks')
      .select('id', { count: 'exact', head: true }).eq('onboarding_id', cand.id).not('acknowledged_at', 'is', null)

    const { error } = await supa.from('onboarding_policy_acks').upsert({
      onboarding_id: cand.id, policy_id, policy_code, policy_title,
      policy_version: policy_version || '1.0', acknowledged_at: new Date().toISOString(),
      scroll_completed: true, ack_order: (count || 0) + 1,
    }, { onConflict: 'onboarding_id,policy_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supa.from('onboarding_audit_log').insert({
      onboarding_id: cand.id, action: 'POLICY_ACKNOWLEDGED', actor_type: 'CANDIDATE',
      details: { policy_code, policy_title },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
