// app/api/onboarding/send-magic-link/route.ts
// Creates or updates onboarding candidate record, sends onboarding link
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs' // nodemailer needs Node.js runtime, not Edge

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

    // Actually email the link to the candidate (Gmail SMTP via nodemailer).
    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    let emailed = false
    let emailError: string | null = null
    const subject = `Welcome aboard! Complete your onboarding — ${full_name}`
    const text =
`Dear ${full_name},

Welcome! Please complete your joining formalities by opening the secure link below:

${magicLink}

This link is valid for 24 hours. You'll verify your mobile via OTP, then fill in your details and upload documents.

Warm regards,
HR Team`
    if (email && user && pass) {
      try {
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
        const from = `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`
        await transporter.sendMail({ from, to: email, subject, text, html: text.replace(/\n/g, '<br>') })
        emailed = true
      } catch (e: any) {
        emailError = e?.message || 'send failed'
        console.error('send-magic-link email failed:', e)
      }
    } else if (!email) {
      emailError = 'candidate has no email on file'
    } else {
      emailError = 'email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)'
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
