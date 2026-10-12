// lib/nps/pran-email.ts — PRAN creation email for new NPS enrolments.
// Words: Configuration → Payroll & finance → "NPS — create your PRAN" (first mail) and
// "NPS — PRAN still pending (reminder)", for the employee's company / branch. The header bar
// and the highlighted box with the due date and the three steps are drawn here.
import { renderEmail, employeeScope } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

interface PranEmailArgs { to: string; employeeName: string; deadline: string; reminder?: boolean; employeeId?: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const STEPS = [
  'Fill in the PRAN creation form (CSRF/eNPS)',
  'Generate your PRAN via the NSDL/Protean eNPS portal',
  'Resubmit your new PRAN number in ESS → Payroll → NPS',
]

/** The first mail goes out on enrolment. `reminder: true` is the chase for anyone still
 *  pending afterwards — same instructions, but it says how long is left, or that the
 *  date has gone, because "within 3 days" is meaningless a fortnight later. */
export async function sendPranCreationEmail({ to, employeeName, deadline, reminder, employeeId }: PranEmailArgs) {
  const deadlineFmt = new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
  const overdue = days < 0
  const when = overdue
    ? `The date has passed — it was due on ${deadlineFmt}`
    : days === 0 ? `Due today (${deadlineFmt})`
    : `${days} day${days === 1 ? '' : 's'} left — due by ${deadlineFmt}`

  const ink = overdue ? '#A32D2D' : '#633806'
  const steps = {
    text: `${when}\n${STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    html: `<div style="background:${overdue ? '#FCEBEB' : '#FAEEDA'}; border-radius:8px; padding:14px 16px; margin:16px 0;">
        <strong style="color:${ink};">${esc(when)}</strong>
        <ol style="font-size:14px; color:${ink}; line-height:1.8; margin:8px 0 0; padding-left:20px;">
          ${STEPS.map(s => `<li>${esc(s)}</li>`).join('\n          ')}
        </ol>
      </div>`,
  }
  const mail = await renderEmail(reminder ? 'nps.pran_reminder' : 'nps.pran_creation', await employeeScope(employeeId),
    { employee_name: employeeName, overdue: overdue ? 'yes' : '', on_time: overdue ? '' : 'yes' }, { pran_steps: steps })
  const subject = mail.subject
  const html = `
  <div style="font-family:system-ui,sans-serif; max-width:600px; margin:0 auto; color:#1E1B4B;">
    <div style="background:#1E1B4B; padding:20px 24px; border-radius:12px 12px 0 0;">
      <span style="color:#fff; font-size:18px; font-weight:600;">EZER — NPS Enrolment</span>
    </div>
    <div style="border:1px solid #E9E7F5; border-top:none; border-radius:0 0 12px 12px; padding:24px; font-size:14px; line-height:1.7;">
      ${mail.html}
    </div>
  </div>`

  const r = await sendMail({ to, subject, text: mail.text, html, fromName: 'EZER Payroll' })
  return r.sent ? { to, subject, sent: true } : { to, subject, sent: false, reason: r.skipped ? 'Gmail not configured' : r.error }
}
