// app/api/cron/offer-followup/route.ts
// Runs on a schedule (Vercel Cron). For every candidate whose offer was sent
// >48h ago and is still not accepted, emails the candidate (reply-to-accept)
// and HR (please-follow-up), then marks the reminder as sent so it fires once.
//
// The words of all four mails come from Configuration (Recruitment → "Offer follow-up —
// candidate / HR", Onboarding → "Onboarding setup reminder" / "Stay in touch reminder"),
// for each candidate's company and the branch of their MRF.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { renderEmail, mrfScope } from '@/lib/config/store'
import { mailConfigured, sendMail, type MailResult } from '@/lib/mail/send'
import { daysLabel } from '@/lib/config/workflow-templates'
import { runLeaveDaily } from '@/lib/leave/daily'

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

  // ── Onboarding reminders (3-day tasks + 10-day stay-in-touch) ──────────────
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
      // 3 days before joining → ask HR to complete the onboarding setup (once).
      if (daysLeft >= 0 && daysLeft <= 3 && !c.onboarding_tasks_emailed) {
        await send('onboarding.setup_reminder', c, c.hr_email, { candidate_name: c.full_name, role, joining_date: joining, days_left: daysLabel(daysLeft) })
        await supabase.from('candidates').update({ onboarding_tasks_emailed: true }).eq('id', c.id)
        onboardingEmails++
      }
      // Joining is >30 days away → nudge HR every 10 days to stay in touch.
      else if (daysLeft > 30) {
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

  return NextResponse.json({ ok: true, due: (due || []).length, processed, onboardingEmails, leaveDaily })
}
