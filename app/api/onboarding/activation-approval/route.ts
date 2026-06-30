// app/api/onboarding/activation-approval/route.ts
// Sends HR-activation approval-request emails to the selected approvers
// (L1 / Payroll / IT / Admin) via the existing Gmail/nodemailer setup.
// Recipients are resolved from the chosen employees' office_email.
// Non-fatal: a missing key or address skips that recipient, never blocks the wizard.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

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
  try {
    const { onboarding_id, roles } = await req.json() as { onboarding_id: string; roles: Role[] }
    if (!onboarding_id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })

    const { data: c } = await supa.from('onboarding_candidates')
      .select('full_name, designation, date_of_joining, annual_ctc, basic_pct, l1_manager_id, hod_id, company_id')
      .eq('id', onboarding_id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) {
      return NextResponse.json({ ok: false, skipped: true, reason: 'Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' })
    }
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })

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
    const sent: string[] = []
    for (const t of targets) {
      const subject = `Action needed: approve activation for ${c.full_name}`
      const body =
        `Hi,\n\nPlease review and approve the joining activation for:\n\n` +
        `Candidate: ${c.full_name}\nDesignation: ${c.designation || '—'}\nDate of joining: ${doj}\n` +
        (t.role === 'payroll' && ctcLine ? `${ctcLine}\n` : '') +
        `\nApproval role: ${ROLE_LABEL[t.role]}\n\n` +
        `Open EZER HRMS → Onboarding → ${c.full_name} → Activation to record your approval.\n\n— EZER HRMS`
      try {
        await transporter.sendMail({
          from: `"${process.env.GMAIL_FROM_NAME || 'EZER HR'}" <${user}>`,
          to: t.to, subject, text: body, html: body.replace(/\n/g, '<br>'),
        })
        sent.push(`${t.role}:${t.to}`)
      } catch (e) { /* skip this recipient, keep going */ }
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
