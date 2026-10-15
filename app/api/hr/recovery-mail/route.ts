// app/api/hr/recovery-mail/route.ts
// On resignation with notice shortfall, email the PAYROLL team to compute recovery.
// Words: Configuration → Employee lifecycle → "Notice-period recovery — Payroll", for the
// employee's company / branch. Sent through lib/mail/send.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { renderEmail, employeeScope } from '@/lib/config/store'
import { mailConfigured, sendMail } from '@/lib/mail/send'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

export async function POST(req: NextRequest) {
  // Sends employee data to Payroll — only someone who can edit employees may trigger it.
  const gate = await requireModule(req, 'Employees', 'EDIT')
  if (gate.error) return gate.error
  try {
    const { resignation_id } = await req.json()
    if (!resignation_id) return NextResponse.json({ error: 'resignation_id required' }, { status: 400 })

    const { data: r, error } = await supa.from('employee_resignation').select('*').eq('id', resignation_id).single()
    if (error || !r) return NextResponse.json({ error: 'resignation not found' }, { status: 404 })

    const { data: emp } = await supa.from('employees')
      .select('full_name, emp_code, designation, office_email, departments!employees_department_id_fkey(dept_name)')
      .eq('id', r.employee_id).single()

    const payrollTo = process.env.PAYROLL_EMAIL || process.env.HR_DEFAULT_EMAIL || process.env.GMAIL_USER
    if (!mailConfigured() || !payrollTo) {
      return NextResponse.json({ error: 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD / PAYROLL_EMAIL)' }, { status: 502 })
    }

    const e = emp as any
    const mail = await renderEmail('resignation.recovery_payroll', await employeeScope(r.employee_id), {
      employee_name: e?.full_name || '—',
      emp_code: e?.emp_code || '—',
      designation: e?.designation || '—',
      department: e?.departments?.dept_name || '—',
      official_email: e?.office_email || '—',
      resignation_date: r.date_of_resignation,
      notice_days: r.notice_period_days,
      lwd_policy: r.lwd_as_per_policy,
      lwd_confirmed: r.lwd_confirmed_by_emp,
      shortfall_days: r.notice_shortfall_days,
    })
    const sent = await sendMail({ to: payrollTo, subject: mail.subject, text: mail.text, html: mail.html })
    if (!sent.sent) return NextResponse.json({ error: sent.error || sent.skipped || 'Email not sent' }, { status: 502 })

    await supa.from('employee_resignation').update({ recovery_mail_to_payroll_at: new Date().toISOString() }).eq('id', resignation_id)
    return NextResponse.json({ ok: true, to: payrollTo })
  } catch (e: any) {
    console.error('recovery-mail error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
