// app/api/onboarding/resend-link/route.ts
// Re-emails the EXISTING onboarding link to an already-invited candidate,
// and refreshes its 24h expiry. Does not create a new record.
// The email's words come from Configuration → 'Onboarding reminder' for the company.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { renderEmail } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export async function POST(req: NextRequest) {
  // Signed in and able to open Onboarding — the same people who see the Resend button.
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error

  try {
    const { onboarding_id } = await req.json()
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: cand, error } = await supa.from('onboarding_candidates')
      .select('id, full_name, email, magic_link_token, company_id').eq('id', onboarding_id).single()
    if (error || !cand) return NextResponse.json({ error: 'candidate not found' }, { status: 404 })

    // Refresh the 24h expiry so the link is valid again.
    await supa.from('onboarding_candidates')
      .update({ token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', cand.id)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'
    const magicLink = `${baseUrl}/onboarding/${cand.magic_link_token}`

    const { data: co } = cand.company_id
      ? await supa.from('companies').select('company_name').eq('id', cand.company_id).maybeSingle()
      : { data: null as any }
    const mail = await renderEmail('onboarding.reminder', cand.company_id, {
      candidate_name:      cand.full_name,
      onboarding_link:     magicLink,
      link_validity_hours: '24',
      company_name:        co?.company_name || '',
    })
    const subject = mail.subject
    let emailed = false, emailError: string | null = null
    if (!cand.email) emailError = 'candidate has no email on file'
    else {
      const sent = await sendMail({ to: cand.email, subject, text: mail.text, html: mail.html, fromName: 'HR Team' })
      emailed = sent.sent
      if (!sent.sent) emailError = sent.skipped ? 'email not configured' : (sent.error || 'send failed')
    }

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
