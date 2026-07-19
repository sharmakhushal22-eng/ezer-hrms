// lib/loans/notify.ts — Loan notifications (wired to existing Gmail/nodemailer; best-effort).
import nodemailer from 'nodemailer'

async function send(to: string | undefined, subject: string, body: string) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  const dest = to || process.env.HR_DEFAULT_EMAIL || process.env.PAYROLL_EMAIL
  if (!user || !pass || !dest) return { sent: false }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    await t.sendMail({ from: `"${process.env.GMAIL_FROM_NAME || 'EZER Payroll'}" <${user}>`, to: dest, subject, text: body, html: body.replace(/\n/g, '<br>') })
    return { sent: true }
  } catch { return { sent: false } }
}

// Notify finance when a loan is approved (agreement generated).
export async function notifyFinance({ request, agreement }: { request: any; agreement: any }) {
  const subject = `Loan approved — ready for agreement & disbursement (${agreement.agreement_number})`
  const body = `A loan request has been fully approved.\nAmount: ${request.requested_amount}\nTenure: ${request.requested_tenure_months} months\nAgreement: ${agreement.agreement_number}\nAction: review signed agreement, then disburse via Finance.`
  await send(process.env.PAYROLL_EMAIL || process.env.HR_DEFAULT_EMAIL, subject, body)
  return { notified: true, subject }
}

// Alert HR Manager + Payroll when an employee with an active loan exits.
export async function alertLoanOnExit({ employee, loan }: { employee: any; loan: any }) {
  const subject = `ALERT: Exiting employee has active loan (${loan.loan_number})`
  const body = `${employee.full_name} (${employee.emp_code || employee.employee_code}) has an exit/resignation date set.\nOutstanding loan: ${loan.outstanding_principal}\nAction: recover outstanding first; balance to flow into FNF settlement.`
  await send(process.env.HR_DEFAULT_EMAIL, subject, body)
  return { alerted: true, subject }
}
