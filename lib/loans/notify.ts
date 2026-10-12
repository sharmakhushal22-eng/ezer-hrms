// lib/loans/notify.ts — Loan notifications (best-effort).
// Words: Configuration → Payroll & finance → "Loan approved — Finance" / "Exiting employee
// with a loan — HR", for the employee's company / branch. Sent through lib/mail/send.ts.
import { renderEmail, employeeScope } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'
import type { Vars } from '@/lib/config/render'

async function send(to: string | undefined, key: string, employeeId: string | null | undefined, vars: Vars) {
  const dest = to || process.env.HR_DEFAULT_EMAIL || process.env.PAYROLL_EMAIL
  const m = await renderEmail(key, await employeeScope(employeeId), vars)
  if (!dest) return { sent: false, subject: m.subject }
  const r = await sendMail({ to: dest, subject: m.subject, text: m.text, html: m.html, fromName: 'EZER Payroll' })
  return { sent: r.sent, subject: m.subject }
}

// Notify finance when a loan is approved (agreement generated).
export async function notifyFinance({ request, agreement }: { request: any; agreement: any }) {
  const { subject } = await send(process.env.PAYROLL_EMAIL || process.env.HR_DEFAULT_EMAIL, 'loan.approved_finance', request?.employee_id, {
    amount: request.requested_amount, tenure_months: request.requested_tenure_months, agreement_number: agreement.agreement_number,
  })
  return { notified: true, subject }
}

// Alert HR Manager + Payroll when an employee with an active loan exits.
export async function alertLoanOnExit({ employee, loan }: { employee: any; loan: any }) {
  const { subject } = await send(process.env.HR_DEFAULT_EMAIL, 'loan.exit_alert', employee?.id, {
    employee_name: employee.full_name, emp_code: employee.emp_code || employee.employee_code,
    loan_number: loan.loan_number, outstanding: loan.outstanding_principal,
  })
  return { alerted: true, subject }
}
