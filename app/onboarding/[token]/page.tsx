// app/onboarding/[token]/page.tsx
// Server component — validates token, passes data to client wizard
import { createClient } from '@supabase/supabase-js'
import OnboardingClient from './client'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'
import { IconAlert, IconClock, IconCheck } from '@/lib/ui/icons'
import './onboarding.css'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// The page a candidate sees when the link can't open the wizard. One calm card with an icon,
// a title and what to do next, on the same background as the wizard itself.
type Tone = 'bad' | 'warn' | 'ok'
const SCREEN = (title: string, subtitle: string, tone: Tone) => {
  const t = { bad: [TK.criticalTint, TK.critical], warn: [TK.warningTint, TK.warning], ok: [TK.positiveTint, TK.positive] }[tone]
  const Ic = tone === 'ok' ? IconCheck : tone === 'warn' ? IconClock : IconAlert
  return (
    <div className="ezo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: 20, padding: '40px 28px', boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 18px 40px -26px rgba(16,24,40,.35)' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px', display: 'grid', placeItems: 'center', background: t[0], color: t[1] }}>
          <Ic size={30} strokeWidth={2.2} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: TK.ink, marginBottom: 8, letterSpacing: '-.01em' }}>{title}</div>
        <div style={{ fontSize: 14.5, color: TK.muted, lineHeight: 1.65 }}>{subtitle}</div>
      </div>
    </div>
  )
}

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
    return SCREEN('This link doesn’t work', 'The onboarding link is not valid. Please ask your HR team to send you a new one.', 'bad')
  }

  if (new Date(candidate.token_expires_at) < new Date()) {
    return SCREEN('This link has expired', 'Onboarding links stay open for a limited time. Ask your HR team to resend it and you can carry on where you left off.', 'warn')
  }

  if (candidate.status === 'EMPLOYEE_CREATED') {
    return SCREEN('You’re all done', 'Your onboarding is complete and your Employee ID has been created. Check your email for your employee portal login.', 'ok')
  }

  if (candidate.status === 'SUBMITTED') {
    return SCREEN('Submitted and under review', 'Your joining form is with HR. You’ll get your Employee ID and portal login by email once they’ve checked it.', 'ok')
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
