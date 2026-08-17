// lib/nps/pran-email.ts — PRAN creation email for new NPS enrolments.
// Wired to the existing Gmail/nodemailer setup (same as the rest of EZER).
import nodemailer from 'nodemailer'

interface PranEmailArgs { to: string; employeeName: string; deadline: string; reminder?: boolean }

/** The first mail goes out on enrolment. `reminder: true` is the chase for anyone still
 *  pending afterwards — same instructions, but it says how long is left, or that the
 *  date has gone, because "within 3 days" is meaningless a fortnight later. */
export async function sendPranCreationEmail({ to, employeeName, deadline, reminder }: PranEmailArgs) {
  const deadlineFmt = new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
  const overdue = days < 0
  const when = overdue
    ? `The date has passed — it was due on ${deadlineFmt}`
    : days === 0 ? `Due today (${deadlineFmt})`
    : `${days} day${days === 1 ? '' : 's'} left — due by ${deadlineFmt}`
  const subject = reminder
    ? (overdue
        ? 'Overdue: your NPS PRAN is still pending'
        : 'Reminder: your NPS PRAN is still pending')
    : 'Action required: Create your NPS PRAN within 3 days'
  const html = `
  <div style="font-family:system-ui,sans-serif; max-width:600px; margin:0 auto; color:#1E1B4B;">
    <div style="background:#1E1B4B; padding:20px 24px; border-radius:12px 12px 0 0;">
      <span style="color:#fff; font-size:18px; font-weight:600;">EZER — NPS Enrolment</span>
    </div>
    <div style="border:1px solid #E9E7F5; border-top:none; border-radius:0 0 12px 12px; padding:24px;">
      <p style="font-size:15px;">Dear ${employeeName},</p>
      <p style="font-size:14px; line-height:1.7;">${reminder
        ? 'Your corporate NPS enrolment is still waiting on your PRAN. Until it is submitted, no contribution starts — nothing has been deducted, and nothing has been credited to you.'
        : "Thank you for opting into the corporate NPS. Since you don't have an existing PRAN, you'll need to create one before your contribution can begin."}</p>
      <div style="background:${overdue ? '#FCEBEB' : '#FAEEDA'}; border-radius:8px; padding:14px 16px; margin:16px 0;">
        <strong style="color:${overdue ? '#A32D2D' : '#633806'};">${when}</strong>
        <ol style="font-size:14px; color:${overdue ? '#A32D2D' : '#633806'}; line-height:1.8; margin:8px 0 0; padding-left:20px;">
          <li>Fill in the PRAN creation form (CSRF/eNPS)</li>
          <li>Generate your PRAN via the NSDL/Protean eNPS portal</li>
          <li>Resubmit your new PRAN number in ESS → Payroll → NPS</li>
        </ol>
      </div>
      <p style="font-size:14px; line-height:1.7;">Your NPS contribution takes effect from the 1st of next month once your PRAN is submitted. If not provided within 3 days, your enrolment will need to be re-initiated.</p>
      <div style="background:#F5F3FF; border-radius:8px; padding:14px 16px; margin:16px 0;">
        <span style="font-size:13px; color:#3C3489;">For any questions or help with the form, please contact the <strong>Payroll team</strong>.</span>
      </div>
      <p style="font-size:13px; color:#6B6B7B; margin-top:20px;">This is an automated message from EZER HRMS.</p>
    </div>
  </div>`

  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return { to, subject, sent: false, reason: 'Gmail not configured' }
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    await transporter.sendMail({ from: `"${process.env.GMAIL_FROM_NAME || 'EZER Payroll'}" <${user}>`, to, subject, html })
    return { to, subject, sent: true }
  } catch (e: any) {
    return { to, subject, sent: false, reason: e?.message }
  }
}
