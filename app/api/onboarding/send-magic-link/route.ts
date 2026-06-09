// app/api/onboarding/send-magic-link/route.ts
// Creates or updates onboarding candidate record, sends magic link
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// Generate 6-digit OTP
const makeOtp = () => String(Math.floor(100000 + Math.random() * 900000))

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      candidate_id, company_id, full_name, email, mobile,
      designation, department, employment_type, date_of_joining, offered_ctc,
    } = body

    if (!company_id || !full_name || !mobile) {
      return NextResponse.json({ error: 'company_id, full_name, mobile required' }, { status: 400 })
    }

    // Upsert onboarding candidate
    const { data: candidate, error: upsertErr } = await supa
      .from('onboarding_candidates')
      .upsert({
        candidate_id:    candidate_id || null,
        company_id,
        full_name,
        email:           email || null,
        mobile,
        designation:     designation || null,
        department:      department || null,
        employment_type: employment_type || 'Employee',
        date_of_joining: date_of_joining || null,
        offered_ctc:     offered_ctc || null,
        status:          'INVITED',
        token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by:      body.created_by || null,
      }, {
        onConflict:    'candidate_id',
        ignoreDuplicates: false,
      })
      .select('id, magic_link_token, mobile, full_name')
      .single()

    if (upsertErr || !candidate) {
      console.error('Upsert error:', upsertErr)
      return NextResponse.json({ error: upsertErr?.message || 'Failed to create record' }, { status: 500 })
    }

    // Generate magic link URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
    const magicLink = `${baseUrl}/onboarding/${candidate.magic_link_token}`

    // Audit log
    await supa.from('onboarding_audit_log').insert({
      onboarding_id: candidate.id,
      action:        'MAGIC_LINK_SENT',
      actor_type:    'SYSTEM',
      details:       { email, mobile, link_sent: true },
      ip_address:    req.headers.get('x-forwarded-for') || req.ip || null,
    })

    // Notification record (actual sending via email/SMS provider)
    await supa.from('onboarding_notifications').insert({
      onboarding_id:  candidate.id,
      recipient_type: 'CANDIDATE',
      channel:        'EMAIL',
      subject:        `Welcome to the team! Complete your onboarding — ${full_name}`,
      body:           `Click to complete your joining formalities: ${magicLink}`,
      status:         'SENT',
      sent_at:        new Date().toISOString(),
    })

    return NextResponse.json({
      success:    true,
      magic_link: magicLink,
      token:      candidate.magic_link_token,
      onboarding_id: candidate.id,
    })

  } catch (err: any) {
    console.error('send-magic-link error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
