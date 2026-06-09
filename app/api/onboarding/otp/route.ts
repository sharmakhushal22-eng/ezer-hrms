// app/api/onboarding/otp/route.ts
// POST: send OTP | PUT: verify OTP
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const makeOtp = () => String(Math.floor(100000 + Math.random() * 900000))

// POST /api/onboarding/otp — send OTP to candidate mobile
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, mobile, full_name, otp_verified')
      .eq('magic_link_token', token)
      .single()

    if (error || !cand) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    if (cand.otp_verified) return NextResponse.json({ success: true, already_verified: true })

    const otp = makeOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await supa.from('onboarding_candidates').update({
      otp_code: otp, otp_expires_at: expiresAt,
    }).eq('id', cand.id)

    // TODO: Send via SMS provider (Twilio / Gupshup / MSG91)
    // For development, log the OTP
    if (process.env.NODE_ENV === 'development') {
      console.log(`📱 OTP for ${cand.mobile}: ${otp}`)
    }

    // Audit
    await supa.from('onboarding_audit_log').insert({
      onboarding_id: cand.id,
      action: 'OTP_SENT',
      actor_type: 'SYSTEM',
      details: { mobile: cand.mobile?.replace(/\d(?=\d{4})/g, '*') },
      ip_address: req.headers.get('x-forwarded-for') || null,
    })

    return NextResponse.json({
      success: true,
      message: `OTP sent to ${cand.mobile?.replace(/\d(?=\d{4})/g, '*')}`,
      // In dev: return OTP for testing
      ...(process.env.NODE_ENV === 'development' ? { dev_otp: otp } : {}),
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PUT /api/onboarding/otp — verify OTP
export async function PUT(req: NextRequest) {
  try {
    const { token, otp } = await req.json()
    if (!token || !otp) return NextResponse.json({ error: 'Token and OTP required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, otp_code, otp_expires_at, otp_verified')
      .eq('magic_link_token', token)
      .single()

    if (error || !cand) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    if (cand.otp_verified) return NextResponse.json({ success: true })

    if (!cand.otp_code || !cand.otp_expires_at) {
      return NextResponse.json({ error: 'OTP not sent. Request a new one.' }, { status: 400 })
    }
    if (new Date(cand.otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'OTP expired. Request a new one.' }, { status: 400 })
    }
    if (cand.otp_code !== otp.trim()) {
      return NextResponse.json({ error: 'Incorrect OTP. Try again.' }, { status: 400 })
    }

    // Mark verified
    await supa.from('onboarding_candidates').update({
      otp_verified: true,
      otp_code: null,
      status: 'IN_PROGRESS',
      current_step: 3,
    }).eq('id', cand.id)

    await supa.from('onboarding_audit_log').insert({
      onboarding_id: cand.id,
      action: 'OTP_VERIFIED',
      actor_type: 'CANDIDATE',
      details: {},
      ip_address: req.headers.get('x-forwarded-for') || null,
    })

    return NextResponse.json({ success: true, verified: true })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
