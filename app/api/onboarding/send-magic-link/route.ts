// app/api/onboarding/send-magic-link/route.ts
// Creates or updates onboarding candidate record, sends onboarding link.
// The email's words come from Configuration → 'Onboarding invitation' for the company.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { renderEmail } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs' // nodemailer needs Node.js runtime, not Edge

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// Generate 6-digit OTP
const makeOtp = () => String(Math.floor(100000 + Math.random() * 900000))

export async function POST(req: NextRequest) {
  // Signed in and able to open Onboarding — the same people who see the Send link button.
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error

  try {
    const body = await req.json()
    const {
      candidate_id, company_id, full_name, email, mobile,
      designation, department, department_id, employment_type, date_of_joining, offered_ctc,
    } = body

    if (!company_id || !full_name || !mobile) {
      return NextResponse.json({ error: 'company_id, full_name, mobile required' }, { status: 400 })
    }

    // Insert a fresh onboarding candidate. (No upsert: candidate_id has no unique
    // constraint, so onConflict:'candidate_id' would error. The dashboard always
    // creates a new record; recruitment linking is a separate, future flow.)
    const { data: candidate, error: insertErr } = await supa
      .from('onboarding_candidates')
      .insert({
        candidate_id:    candidate_id || null,
        company_id,
        full_name,
        email:           email || null,
        mobile,
        designation:     designation || null,
        department:      department || null,
        department_id:   department_id || null,
        employment_type: employment_type || 'Employee',
        date_of_joining: date_of_joining || null,
        offered_ctc:     offered_ctc || null,
        status:          'INVITED',
        token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by:      body.created_by || null,
      })
      .select('id, magic_link_token, mobile, full_name')
      .single()

    if (insertErr || !candidate) {
      console.error('Insert error:', insertErr)
      return NextResponse.json({ error: insertErr?.message || 'Failed to create record' }, { status: 500 })
    }

    // Generate onboarding link URL
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

    // Email the link to the candidate (Gmail SMTP, lib/mail/send.ts).
    const { data: co } = await supa.from('companies').select('company_name').eq('id', company_id).maybeSingle()
    const mail = await renderEmail('onboarding.invite', company_id, {
      candidate_name:      full_name,
      onboarding_link:     magicLink,
      link_validity_hours: '24',
      company_name:        co?.company_name || '',
      designation:         designation || '',
      joining_date:        date_of_joining ? new Date(date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
    })
    const subject = mail.subject
    let emailed = false
    let emailError: string | null = null
    if (!email) {
      emailError = 'candidate has no email on file'
    } else {
      const sent = await sendMail({ to: email, subject, text: mail.text, html: mail.html, fromName: 'HR Team' })
      emailed = sent.sent
      if (!sent.sent) {
        emailError = sent.skipped ? 'email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' : (sent.error || 'send failed')
        if (sent.error) console.error('send-magic-link email failed:', sent.error)
      }
    }

    // Notification record
    await supa.from('onboarding_notifications').insert({
      onboarding_id:  candidate.id,
      recipient_type: 'CANDIDATE',
      channel:        'EMAIL',
      subject,
      body:           `Click to complete your joining formalities: ${magicLink}`,
      status:         emailed ? 'SENT' : 'FAILED',
      sent_at:        emailed ? new Date().toISOString() : null,
    })

    return NextResponse.json({
      success:    true,
      magic_link: magicLink,
      token:      candidate.magic_link_token,
      onboarding_id: candidate.id,
      emailed,
      email_error: emailError,
    })

  } catch (err: any) {
    console.error('send-magic-link error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
