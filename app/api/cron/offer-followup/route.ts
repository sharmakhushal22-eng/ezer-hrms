// app/api/cron/offer-followup/route.ts
// Runs on a schedule (Vercel Cron). For every candidate whose offer was sent
// >48h ago and is still not accepted, emails the candidate (reply-to-accept)
// and HR (please-follow-up), then marks the reminder as sent so it fires once.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

function candidateBody(name: string, role: string) {
  return `Dear ${name},

We recently sent you an offer of employment${role ? ` for the position of ${role}` : ''}, and we haven't yet received your confirmation.

If you'd like to accept the offer, simply REPLY to this email confirming your acceptance. If you have any questions before deciding, reply here and our HR team will be glad to help.

We hope to welcome you on board soon.

Warm regards,
HR Team`
}

function hrBody(name: string, role: string, candEmail: string) {
  return `Hi,

This is an automated reminder: ${name}${role ? ` (${role})` : ''} was sent an offer more than 48 hours ago and has NOT confirmed acceptance yet.

Please reach out to the candidate to get their response.
Candidate email: ${candEmail || '—'}

— EZER HRMS`
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

  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return NextResponse.json({ error: 'email not configured' }, { status: 502 })

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: due, error } = await supabase
    .from('candidates')
    .select('id, full_name, email, hr_email, designation')
    .eq('stage', 'Offer Sent')
    .eq('offer_accepted', false)
    .eq('offer_reminder_sent', false)
    .lt('offer_sent_at', cutoff)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const from = `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })

  let processed = 0
  for (const c of due || []) {
    const role = c.designation || ''
    try {
      if (c.email) {
        const body = candidateBody(c.full_name, role)
        await transporter.sendMail({ from, to: c.email, subject: `Action needed — confirm your offer${role ? ` (${role})` : ''}`, text: body, html: body.replace(/\n/g, '<br>') })
      }
      if (c.hr_email) {
        const body = hrBody(c.full_name, role, c.email)
        await transporter.sendMail({ from, to: c.hr_email, subject: `Follow up: ${c.full_name} hasn't accepted the offer`, text: body, html: body.replace(/\n/g, '<br>') })
      }
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
    .select('id, full_name, email, hr_email, designation, onboarding_date, onboarding_tasks_emailed, last_touch_reminder_at')
    .eq('offer_accepted', true)
    .eq('blacklisted', false)
    .not('onboarding_date', 'is', null)

  const DAY = 86400000
  for (const c of obCands || []) {
    if (!c.hr_email) continue
    const daysLeft = Math.ceil((new Date(c.onboarding_date as string).getTime() - Date.now()) / DAY)
    const role = c.designation || ''
    try {
      // 3 days before joining → ask HR to complete the onboarding setup (once).
      if (daysLeft >= 0 && daysLeft <= 3 && !c.onboarding_tasks_emailed) {
        const body = `Hi,

${c.full_name}${role ? ` (${role})` : ''} is joining on ${new Date(c.onboarding_date as string).toLocaleDateString('en-IN')} — that's ${daysLeft} day${daysLeft === 1 ? '' : 's'} away.

Please complete the onboarding setup before the joining date:
  • Laptop / workstation
  • Official email + ERP / system access
  • SIM / phone (if applicable)
  • ID card & access card
  • Seat / desk allotment
  • Joining kit & welcome pack

Kindly ensure everything is ready so the candidate has a smooth first day.

— EZER HRMS`
        await transporter.sendMail({ from, to: c.hr_email, subject: `Onboarding setup — ${c.full_name} joins in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, text: body, html: body.replace(/\n/g, '<br>') })
        await supabase.from('candidates').update({ onboarding_tasks_emailed: true }).eq('id', c.id)
        onboardingEmails++
      }
      // Joining is >30 days away → nudge HR every 10 days to stay in touch.
      else if (daysLeft > 30) {
        const last = c.last_touch_reminder_at ? new Date(c.last_touch_reminder_at).getTime() : 0
        if (Date.now() - last >= 10 * DAY) {
          const body = `Hi,

${c.full_name}${role ? ` (${role})` : ''} is joining on ${new Date(c.onboarding_date as string).toLocaleDateString('en-IN')} — still ${daysLeft} days away.

Please reach out and keep the candidate engaged so they stay committed until their joining date. A quick check-in call or message helps reduce last-minute drop-offs.

— EZER HRMS`
          await transporter.sendMail({ from, to: c.hr_email, subject: `Stay in touch — ${c.full_name} (joining ${new Date(c.onboarding_date as string).toLocaleDateString('en-IN')})`, text: body, html: body.replace(/\n/g, '<br>') })
          await supabase.from('candidates').update({ last_touch_reminder_at: new Date().toISOString() }).eq('id', c.id)
          onboardingEmails++
        }
      }
    } catch (e) {
      console.error('onboarding reminder failed for', c.id, e)
    }
  }

  return NextResponse.json({ ok: true, due: (due || []).length, processed, onboardingEmails })
}
