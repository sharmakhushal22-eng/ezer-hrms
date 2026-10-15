// app/api/onboarding/activation-approval/route.ts
// Sends HR-activation approval-request emails to the selected approvers
// (L1 / Payroll / IT / Admin). Words: Configuration → Onboarding → "Activation approval
// request", for the joiner's company / branch.
// Recipients are resolved from the chosen employees' office_email.
// Non-fatal: a missing key or address skips that recipient, never blocks the wizard.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { resolveTemplate, renderResolvedEmail } from '@/lib/config/store'
import { mailConfigured, sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

type Role = 'l1' | 'payroll' | 'it' | 'admin'
const ROLE_LABEL: Record<Role, string> = { l1: 'L1 / Reporting Manager', payroll: 'Payroll', it: 'IT', admin: 'Admin / Facilities' }

async function emailFor(empId: string | null | undefined): Promise<string | null> {
  if (!empId) return null
  const { data } = await supa.from('employees').select('office_email, personal_email').eq('id', empId).maybeSingle()
  return data?.office_email || data?.personal_email || null
}

export async function POST(req: NextRequest) {
  // Mails a joiner's CTC to Payroll — only someone who can edit onboarding may trigger it.
  const gate = await requireModule(req, 'Onboarding', 'EDIT')
  if (gate.error) return gate.error
  try {
    const { onboarding_id, roles } = await req.json() as { onboarding_id: string; roles: Role[] }
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: c } = await supa.from('onboarding_candidates')
      .select('full_name, designation, date_of_joining, annual_ctc, basic_pct, l1_manager_id, hod_id, company_id, location_id')
      .eq('id', onboarding_id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    if (!mailConfigured()) {
      return NextResponse.json({ ok: false, skipped: true, reason: 'Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' })
    }

    // Resolve a recipient per requested role.
    const targets: { role: Role; to: string }[] = []
    for (const role of (roles || ['l1', 'payroll'])) {
      let to: string | null = null
      if (role === 'l1') to = await emailFor(c.l1_manager_id)
      else if (role === 'payroll') to = process.env.PAYROLL_EMAIL || process.env.HR_DEFAULT_EMAIL || null
      else if (role === 'admin') to = process.env.HR_DEFAULT_EMAIL || null
      else if (role === 'it') to = process.env.HR_DEFAULT_EMAIL || null
      if (to) targets.push({ role, to })
    }
    if (!targets.length) return NextResponse.json({ ok: false, skipped: true, reason: 'No approver email addresses resolved' })

    const doj = c.date_of_joining || 'TBD'
    const ctcLine = c.annual_ctc ? `CTC: ₹${Number(c.annual_ctc).toLocaleString('en-IN')} · Basic ${c.basic_pct || 50}%` : ''
    const tpl = (await resolveTemplate('onboarding.activation_approval', { companyId: c.company_id, locationId: c.location_id }))!
    const sent: string[] = []
    for (const t of targets) {
      const mail = renderResolvedEmail(tpl, {
        candidate_name: c.full_name, designation: c.designation || '—', joining_date: doj,
        ctc_line: t.role === 'payroll' ? ctcLine : '', approval_role: ROLE_LABEL[t.role],
      })
      // A failed recipient is skipped; the others still go.
      const r = await sendMail({ to: t.to, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'EZER HR' })
      if (r.sent) sent.push(`${t.role}:${t.to}`)
    }

    try {
      await supa.from('onboarding_audit_log').insert({
        onboarding_id, action: 'ACTIVATION_APPROVAL_REQUESTED', actor_type: 'HR',
        details: { sent },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({ ok: true, sent })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
