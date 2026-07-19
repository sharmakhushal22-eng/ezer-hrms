// lib/nps/pran-email.ts — PRAN creation email for new NPS enrolments.
// Wired to the existing Gmail/nodemailer setup (same as the rest of EZER).
import nodemailer from 'nodemailer'

interface PranEmailArgs { to: string; employeeName: string; deadline: string }

export async function sendPranCreationEmail({ to, employeeName, deadline }: PranEmailArgs) {
  const deadlineFmt = new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const subject = 'Action required: Create your NPS PRAN within 3 days'
  const html = `
  <div style="font-family:system-ui,sans-serif; max-width:600px; margin:0 auto; color:#1E1B4B;">
    <div style="background:#1E1B4B; padding:20px 24px; border-radius:12px 12px 0 0;">
      <span style="color:#fff; font-size:18px; font-weight:600;">EZER — NPS Enrolment</span>
    </div>
    <div style="border:1px solid #E9E7F5; border-top:none; border-radius:0 0 12px 12px; padding:24px;">
      <p style="font-size:15px;">Dear ${employeeName},</p>
      <p style="font-size:14px; line-height:1.7;">Thank you for opting into the corporate NPS. Since you don't have an existing PRAN, you'll need to create one before your contribution can begin.</p>
      <div style="background:#FAEEDA; border-radius:8px; padding:14px 16px; margin:16px 0;">
        <strong style="color:#633806;">Please complete within 3 days (by ${deadlineFmt}):</strong>
        <ol style="font-size:14px; color:#633806; line-height:1.8; margin:8px 0 0; padding-left:20px;">
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
