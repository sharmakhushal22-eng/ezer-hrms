// app/api/onboarding/resend-link/route.ts
// Re-emails the EXISTING onboarding link to an already-invited candidate,
// and refreshes its 24h expiry. Does not create a new record.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export async function POST(req: NextRequest) {
  try {
    const { onboarding_id } = await req.json()
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: cand, error } = await supa.from('onboarding_candidates')
      .select('id, full_name, email, magic_link_token').eq('id', onboarding_id).single()
    if (error || !cand) return NextResponse.json({ error: 'candidate not found' }, { status: 404 })

    // Refresh the 24h expiry so the link is valid again.
    await supa.from('onboarding_candidates')
      .update({ token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', cand.id)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
    const magicLink = `${baseUrl}/onboarding/${cand.magic_link_token}`

    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    let emailed = false, emailError: string | null = null
    const subject = `Reminder: complete your onboarding — ${cand.full_name}`
    const text =
`Dear ${cand.full_name},

A reminder to complete your joining formalities. Please open your secure onboarding link below:

${magicLink}

This link is valid for 24 hours.

Warm regards,
HR Team`
    if (cand.email && user && pass) {
      try {
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
        const from = `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`
        await transporter.sendMail({ from, to: cand.email, subject, text, html: text.replace(/\n/g, '<br>') })
        emailed = true
      } catch (e: any) { emailError = e?.message || 'send failed' }
    } else if (!cand.email) emailError = 'candidate has no email on file'
    else emailError = 'email not configured'

    await supa.from('onboarding_notifications').insert({
      onboarding_id: cand.id, recipient_type: 'CANDIDATE', channel: 'EMAIL',
      subject, body: `Resent onboarding link: ${magicLink}`,
      status: emailed ? 'SENT' : 'FAILED', sent_at: emailed ? new Date().toISOString() : null,
    })

    return NextResponse.json({ ok: true, emailed, email_error: emailError, magic_link: magicLink })
  } catch (e: any) {
    console.error('resend-link error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
