// app/api/onboarding/validate-token/route.ts
// Validates onboarding link token and returns candidate info (no auth needed)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const { data, error } = await supa
    .from('onboarding_candidates')
    .select(`
      id, full_name, email, mobile, designation, department,
      employment_type, date_of_joining, offered_ctc, status,
      current_step, form_data, otp_verified, token_expires_at,
      company_id, companies(company_name, company_code)
    `)
    .eq('magic_link_token', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  if (new Date(data.token_expires_at) < new Date()) return NextResponse.json({ error: 'Link expired. Contact HR.' }, { status: 410 })
  if (data.status === 'EMPLOYEE_CREATED') return NextResponse.json({ error: 'ALREADY_COMPLETE', employee_code: true }, { status: 409 })

  // Audit: link opened
  await supa.from('onboarding_audit_log').insert({
    onboarding_id: data.id,
    action:        'MAGIC_LINK_OPENED',
    actor_type:    'CANDIDATE',
    details:       { step: data.current_step },
    ip_address:    req.headers.get('x-forwarded-for') || null,
    user_agent:    req.headers.get('user-agent') || null,
  })

  return NextResponse.json({ success: true, candidate: data })
}
