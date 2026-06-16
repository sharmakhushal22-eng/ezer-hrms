// app/api/hr/recovery-mail/route.ts
// On resignation with notice shortfall, email the PAYROLL team to compute recovery.
// Uses the project's Gmail/nodemailer setup (same as offer-followup / send-offer-email).
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
    const { resignation_id } = await req.json()
    if (!resignation_id) return NextResponse.json({ error: 'resignation_id required' }, { status: 400 })

    const { data: r, error } = await supa.from('employee_resignation').select('*').eq('id', resignation_id).single()
    if (error || !r) return NextResponse.json({ error: 'resignation not found' }, { status: 404 })

    const { data: emp } = await supa.from('employees')
      .select('full_name, emp_code, designation, office_email, departments(dept_name)')
      .eq('id', r.employee_id).single()

    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    const payrollTo = process.env.PAYROLL_EMAIL || process.env.HR_DEFAULT_EMAIL || user
    if (!user || !pass || !payrollTo) {
      return NextResponse.json({ error: 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD / PAYROLL_EMAIL)' }, { status: 502 })
    }

    const body = `Hi Payroll Team,

A resignation has been processed with a NOTICE-PERIOD SHORTFALL. Please calculate the recovery and proceed.

Employee:        ${(emp as any)?.full_name || '—'} (${(emp as any)?.emp_code || '—'})
Designation:     ${(emp as any)?.designation || '—'}
Department:      ${(emp as any)?.departments?.dept_name || '—'}
Official email:  ${(emp as any)?.office_email || '—'}

Date of resignation:   ${r.date_of_resignation}
Notice period (policy):${r.notice_period_days} days
LWD as per policy:     ${r.lwd_as_per_policy}
LWD confirmed by emp:  ${r.lwd_confirmed_by_emp}
Notice shortfall:      ${r.notice_shortfall_days} day(s)

Action: Calculate the recovery amount, update the resignation record, and send the
recovery intimation to the employee's official email.

— EZER HRMS`

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    const from = `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`
    await transporter.sendMail({
      from, to: payrollTo,
      subject: `Notice-period recovery needed — ${(emp as any)?.full_name || r.employee_id} (${r.notice_shortfall_days}d shortfall)`,
      text: body, html: body.replace(/\n/g, '<br>'),
    })

    await supa.from('employee_resignation').update({ recovery_mail_to_payroll_at: new Date().toISOString() }).eq('id', resignation_id)
    return NextResponse.json({ ok: true, to: payrollTo })
  } catch (e: any) {
    console.error('recovery-mail error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
