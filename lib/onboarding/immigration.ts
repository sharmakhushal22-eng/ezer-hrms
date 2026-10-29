// lib/onboarding/immigration.ts — SERVER ONLY. The immigration tracker for foreign nationals
// and overseas employees: every dated item on the employee record (passport, visa, work
// permit, FRRO due date, SSA coverage certificate) with the days left, and the daily
// reminders — a bell + mail to the employee and to HR at 60 / 30 / 7 days before and on the
// day, each sent once (immigration_reminders, migration 167).
// Read by /api/onboarding/immigration (the Compliance tab) and /api/cron/immigration-reminders.

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/ess/session'
import { roleHolders } from '@/lib/recruitment/offer-approval-notify'
import { sendMail } from '@/lib/mail/send'
import { immigrationExpiries, dueForReminder, TRACK_LABEL, trackOf, type Expiry } from './hiring-track'

const COLS = 'id, emp_code, full_name, designation, company_id, hiring_track, work_country, employing_entity, office_email, personal_email, passport_expiry, visa_type, visa_expiry, work_permit_expiry, frro_date, frro_due_date, ssa_coc_expiry, international_employee, pan_pending'

export interface TrackedEmployee {
  id: string; emp_code: string; full_name: string; designation: string | null; company_id: string
  hiring_track: string; track_label: string; work_country: string | null; employing_entity: string | null
  international_employee: boolean | null; pan_pending: boolean
  office_email: string | null; personal_email: string | null
  items: Expiry[]
  /** The soonest item, or null when nothing is dated. */
  next: Expiry | null
}

/** Everybody on a non-domestic track in the company (all companies when null), soonest expiry first. */
export async function trackedEmployees(sb: SupabaseClient, companyId: string | null, now = new Date()): Promise<TrackedEmployee[]> {
  let q = sb.from('employees').select(COLS).neq('hiring_track', 'DOMESTIC').eq('employment_status', 'Active').or('is_test.is.null,is_test.eq.false')
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q.limit(2000)
  const out: TrackedEmployee[] = ((data || []) as any[]).map(e => {
    const items = immigrationExpiries(e, now)
    return { id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation ?? null, company_id: e.company_id, hiring_track: e.hiring_track, track_label: TRACK_LABEL[trackOf(e.hiring_track)], work_country: e.work_country ?? null, employing_entity: e.employing_entity ?? null, international_employee: e.international_employee ?? null, pan_pending: e.pan_pending === true, office_email: e.office_email ?? null, personal_email: e.personal_email ?? null, items, next: items[0] || null }
  })
  return out.sort((a, b) => (a.next?.days_left ?? 1e9) - (b.next?.days_left ?? 1e9))
}

export interface ReminderRun { checked: number; due: number; sent: number; skipped: number; errors: string[] }

/** The daily run: for every tracked employee, every item at a reminder threshold that has not
 *  been reminded for that threshold yet. */
export async function runImmigrationReminders(sb: SupabaseClient, o: { now?: Date; baseUrl?: string } = {}): Promise<ReminderRun> {
  const now = o.now || new Date()
  const base = o.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'
  const run: ReminderRun = { checked: 0, due: 0, sent: 0, skipped: 0, errors: [] }
  const people = await trackedEmployees(sb, null, now)
  const hrByCompany = new Map<string, { id: string; email: string | null; full_name?: string | null }[]>()
  for (const p of people) {
    run.checked++
    for (const it of p.items) {
      if (!dueForReminder(it.days_left)) continue
      run.due++
      const { data: already } = await sb.from('immigration_reminders').select('id').eq('employee_id', p.id).eq('kind', it.kind).eq('due_on', it.date).eq('days_before', it.days_left).maybeSingle()
      if (already) { run.skipped++; continue }
      if (!hrByCompany.has(p.company_id)) hrByCompany.set(p.company_id, await roleHolders(sb, p.company_id, ['HR_MANAGER', 'HR_HEAD', 'ADMIN_COMPANY']).catch(() => []))
      const when = it.days_left === 0 ? 'today' : `in ${it.days_left} day${it.days_left === 1 ? '' : 's'} (${it.date})`
      const title = `${it.label} ${when} — ${p.full_name} (${p.emp_code})`
      const body = it.kind === 'frro'
        ? `${p.full_name}'s FRRO registration is due ${when}. A foreign national staying more than 180 days must register within 14 days of arrival — book the appointment and record the registration on the employee record.`
        : `${p.full_name}'s ${it.label.toLowerCase().replace(' expires', '')} ${it.days_left <= 0 ? 'has expired' : `expires ${when}`}. Start the renewal now and update the date on the employee record once done.`
      try {
        // The employee (bell + mail) and HR / Admin of the company (bell + mail).
        await notify(p.id, title, body, '/ess/profile', 'COMPLIANCE').catch(() => null)
        const to = [p.office_email, p.personal_email].find(Boolean) as string | undefined
        if (to) await sendMail({ to, subject: title, text: `${body}\n\n${base}/ess/profile\n\n— EZER HRMS`, html: `${body}<br><br><a href="${base}/ess/profile">Open your profile</a><br><br>— EZER HRMS` })
        for (const h of hrByCompany.get(p.company_id) || []) {
          await notify(h.id, title, body, '/ess/onboarding', 'COMPLIANCE').catch(() => null)
          if (h.email) await sendMail({ to: h.email, subject: title, text: `${body}\n\n${base}/dashboard/onboarding (Compliance)\n\n— EZER HRMS`, html: `${body}<br><br><a href="${base}/dashboard/onboarding">Open Onboarding → Compliance</a><br><br>— EZER HRMS` })
        }
        await sb.from('immigration_reminders').insert({ employee_id: p.id, kind: it.kind, due_on: it.date, days_before: it.days_left })
        run.sent++
      } catch (e: any) { run.errors.push(`${p.emp_code} ${it.kind}: ${e?.message || e}`) }
    }
  }
  return run
}
