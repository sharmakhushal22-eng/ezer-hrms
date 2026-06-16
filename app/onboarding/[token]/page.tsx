// app/onboarding/[token]/page.tsx
// Server component — validates token, passes data to client wizard
import { createClient } from '@supabase/supabase-js'
import OnboardingClient from './client'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const SCREEN = (title: string, subtitle: string, emoji: string) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#F5F3FF', fontFamily: '"DM Sans",sans-serif' }}>
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>{emoji}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: '#1E1B4B', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: '#21252bff', lineHeight: 1.7 }}>{subtitle}</div>
    </div>
  </div>
)

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Fetch candidate by token (server-side, service role)
  const { data: candidate, error } = await supa
    .from('onboarding_candidates')
    .select(`
      id, full_name, email, mobile, designation, department,
      employment_type, date_of_joining, offered_ctc, status,
      current_step, form_data, otp_verified, token_expires_at,
      company_id, magic_link_token, esic_applicable
    `)
    .eq('magic_link_token', token)
    .single()

  if (error || !candidate) {
    return SCREEN('Invalid Link', 'This onboarding link is not valid or has expired. Please contact HR for a new link.', '❌')
  }

  if (new Date(candidate.token_expires_at) < new Date()) {
    return SCREEN('Link Expired', 'This onboarding link has expired (24 hours). Please contact HR to resend the link.', '⏰')
  }

  if (candidate.status === 'EMPLOYEE_CREATED') {
    return SCREEN('Already Complete ✓', 'Your onboarding is complete and your Employee ID has been generated. Check your email for ESS access details.', '🎉')
  }

  if (candidate.status === 'SUBMITTED') {
    return SCREEN('Submitted! Under Review', 'Your joining form has been submitted. HR is reviewing it and will generate your Employee ID shortly.', '📋')
  }

  // Fetch company details
  const { data: company } = await supa
    .from('companies')
    .select('company_name, company_code, letterhead_header')
    .eq('id', candidate.company_id)
    .maybeSingle()

  // Fetch uploaded documents
  const { data: documents } = await supa
    .from('onboarding_documents')
    .select('doc_code, ai_status, ai_extracted_data, ai_confidence, ai_flags, file_name, uploaded_at')
    .eq('onboarding_id', candidate.id)

  // Audit: page loaded (non-blocking — Supabase builder has no .catch)
  try {
    await supa.from('onboarding_audit_log').insert({
      onboarding_id: candidate.id,
      action: 'PAGE_LOADED',
      actor_type: 'CANDIDATE',
      details: { step: candidate.current_step },
    })
  } catch { /* ignore */ }

  return (
    <OnboardingClient
      token={token}
      candidate={candidate}
      company={company}
      uploadedDocs={(documents || []).reduce((acc: any, d) => {
        acc[d.doc_code] = d; return acc
      }, {})}
    />
  )
}
