// app/api/cron/offer-followup/route.ts
// Runs on a schedule (Vercel Cron). For every candidate whose offer was sent
// >48h ago and is still not accepted, emails the candidate (reply-to-accept)
// and HR (please-follow-up), then marks the reminder as sent so it fires once.
//
// The words of all four mails come from Configuration (Recruitment → "Offer follow-up —
// candidate / HR", Onboarding → "Onboarding setup reminder" / "Stay in touch reminder"),
// for each candidate's company and the branch of their MRF.
// Then the hiring manager's "connect with your candidate" reminder every 4 days (every 2
// once joining is within 6 days) and the joining-day mails (teams prepare, candidate
// welcomed, HR Manager reminded to send the link) — lib/recruitment/joining-followup-run.ts
// and lib/onboarding/joining-day-run.ts, which take a nodemailer transport.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { renderEmail, mrfScope } from '@/lib/config/store'
import { mailConfigured, sendMail, type MailResult } from '@/lib/mail/send'
import { runLeaveDaily } from '@/lib/leave/daily'
import nodemailer from 'nodemailer'
import { runJoiningFollowups } from '@/lib/recruitment/joining-followup-run'
import { runPrepareMails, runWelcomeMails, runLinkReminders } from '@/lib/onboarding/joining-day-run'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

/** Send one templated mail. A provider failure throws, so the candidate is not marked
 *  as reminded and the next run tries again — as before. */
async function send(key: string, c: { company_id?: string | null; mrf_id?: string | null }, to: string, vars: Record<string, string>) {
  const m = await renderEmail(key, await mrfScope(c.mrf_id, c.company_id), vars)
  const r: MailResult = await sendMail({ to, subject: m.subject, text: m.text, html: m.html })
  if (!r.sent) throw new Error(r.error || r.skipped || 'email not sent')
}

export async function POST(req: NextRequest) {
  return run(req)
}
export async function GET(req: NextRequest) {
  return run(req)
}

async function run(req: NextRequest) {
  // Optional protection: if CRON_SECRET is set, require it (Vercel sends it automatically).
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // The daily leave & attendance job (balances + approver reminders) rides on
  // this cron instead of adding one of its own. It never fails this run.
  let leaveDaily: unknown = null
  try { leaveDaily = await runLeaveDaily() } catch (e) { console.error('leave-daily failed:', e) }

  if (!mailConfigured()) return NextResponse.json({ error: 'email not configured' }, { status: 502 })
  // The joining runners below send through their own transport (same Gmail account).
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
  const from = `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${process.env.GMAIL_USER}>`

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: due, error } = await supabase
    .from('candidates')
    .select('id, full_name, email, hr_email, designation, company_id, mrf_id')
    .eq('stage', 'Offer Sent')
    .eq('offer_accepted', false)
    .eq('offer_reminder_sent', false)
    .lt('offer_sent_at', cutoff)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let processed = 0
  for (const c of due || []) {
    const role = c.designation || ''
    try {
      if (c.email) await send('offer.followup.candidate', c, c.email, { candidate_name: c.full_name, role })
      if (c.hr_email) await send('offer.followup.hr', c, c.hr_email, { candidate_name: c.full_name, role, candidate_email: c.email || '—' })
      await supabase.from('candidates').update({ offer_reminder_sent: true }).eq('id', c.id)
      processed++
    } catch (e) {
      console.error('offer-followup send failed for', c.id, e)
    }
  }

  // ── Onboarding reminders (10-day stay-in-touch while joining is far off) ───────
  let onboardingEmails = 0
  const { data: obCands } = await supabase
    .from('candidates')
    .select('id, full_name, email, hr_email, designation, company_id, mrf_id, onboarding_date, onboarding_tasks_emailed, last_touch_reminder_at')
    .eq('blacklisted', false)
    .not('onboarding_date', 'is', null)

  const DAY = 86400000
  for (const c of obCands || []) {
    if (!c.hr_email) continue
    const daysLeft = Math.ceil((new Date(c.onboarding_date as string).getTime() - Date.now()) / DAY)
    const role = c.designation || ''
    const joining = new Date(c.onboarding_date as string).toLocaleDateString('en-IN')
    try {
      // The pre-joining setup mail now goes to the teams two days before joining —
      // runPrepareMails below. Only the long-range stay-in-touch nudge is left here.
      if (daysLeft > 30) {
        const last = c.last_touch_reminder_at ? new Date(c.last_touch_reminder_at).getTime() : 0
        if (Date.now() - last >= 10 * DAY) {
          await send('onboarding.stay_in_touch', c, c.hr_email, { candidate_name: c.full_name, role, joining_date: joining, days_left: `${daysLeft} days` })
          await supabase.from('candidates').update({ last_touch_reminder_at: new Date().toISOString() }).eq('id', c.id)
          onboardingEmails++
        }
      }
    } catch (e) {
      console.error('onboarding reminder failed for', c.id, e)
    }
  }

  // ── Hiring manager: "connect with your candidate" until they join ───────────
  const joining = await runJoiningFollowups(supabase, transporter, from)
  if (joining.error) console.error('joining-followup skipped:', joining.error)

  // ── Joining day: the teams prepare (2 days before), the candidate is welcomed (the day
  //    before), the HR Manager is reminded to send the link (the day) ──
  const ctx = { sb: supabase, mail: transporter, from, now: Date.now() }
  const prepare = await runPrepareMails(ctx)
  const welcome = await runWelcomeMails(ctx)
  const linkReminder = await runLinkReminders(ctx)
  for (const [k, v] of Object.entries({ prepare, welcome, linkReminder })) if (v.error) console.error(`${k} skipped:`, v.error)

  return NextResponse.json({ ok: true, due: (due || []).length, processed, onboardingEmails, joining, prepare, welcome, linkReminder, leaveDaily })
}
