// lib/analytics/server/digest.ts — the two analytics emails: who gets them, and sending
// each one once.
//
//   Monday note        every manager with people reporting to them, unless they opted
//                      out — their own team only (the same note as ESS → My team)
//   Monthly briefing   the people HR listed — each on the slice of the company THEIR
//                      analytics access covers (lib/analytics/server/access.ts); a
//                      listed person who has lost access gets nothing
//
// Both are OFF until switched on (migration 233). Every email is written to
// analytics_digest_log first-come: a second run — the catch-up schedule, a retry —
// skips anyone already sent for that week or month. Mail that cannot be sent (no mail
// set up) is not logged, so it goes out once mail works.

import { sb, all } from './db.ts'
import { teamAnalytics } from './team.ts'
import { orgAnalytics } from './org.ts'
import { orgAccessFor, scopeModuleOf, isMissingTable } from './access.ts'
import { mondayFor, briefingFor } from './pieces.ts'
import { mondayMail, briefingMail } from './digest-mail.ts'
import { grantForEmployee } from '@/lib/rms/server'
import { redactTabs } from '../access.ts'
import { istToday } from '../period.ts'
import { moverWindow } from '../movers.ts'
import { mondayOf } from '../briefs.ts'
import { sendMail, mailConfigured } from '@/lib/mail/send'
import { deliverable } from '@/lib/leave/notify'

export type DigestKind = 'monday_note' | 'monthly_briefing'

export interface DigestSettings { monday_note: boolean; monthly_briefing: boolean; briefing_recipients: string[]; updated_by_name: string | null; updated_at: string | null }
const OFF: DigestSettings = { monday_note: false, monthly_briefing: false, briefing_recipients: [], updated_by_name: null, updated_at: null }

/** The settings, and whether migration 233 has been run at all. */
export async function digestSettings(): Promise<{ ready: boolean; settings: DigestSettings }> {
  const { data, error } = await sb.from('analytics_digest_settings').select('monday_note, monthly_briefing, briefing_recipients, updated_by_name, updated_at').eq('id', 1).maybeSingle()
  if (error) return { ready: !isMissingTable(error), settings: OFF }
  return { ready: true, settings: data ? { ...OFF, ...(data as DigestSettings), briefing_recipients: (data as DigestSettings).briefing_recipients || [] } : OFF }
}

export async function optedOut(employeeId: string, kind: DigestKind): Promise<boolean> {
  const { data } = await sb.from('analytics_digest_optout').select('employee_id').eq('employee_id', employeeId).eq('kind', kind).maybeSingle()
  return !!data
}

export const appLink = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'https://ezer-hrms-chi.vercel.app').replace(/\/+$/, '')}/ess/insights`

/** The Monday note's period key: the Monday of this week. */
export const weekKey = mondayOf

interface Person { id: string; full_name: string; company_id: string | null; office_email: string | null; personal_email: string | null }
const PERSON = 'id, full_name, company_id, office_email, personal_email, is_test, date_of_leaving'
const emailOf = (p: Person) => [p.office_email, p.personal_email].map(e => (e || '').trim()).find(e => deliverable(e)) || null

// ── Building one email ──────────────────────────────────────────────────────

export async function mondayEmailFor(p: Person): Promise<{ subject: string; html: string; text: string } | null> {
  const team = await teamAnalytics(p.id, p.full_name, 'TEAM', p.company_id)
  if (!team.members.length) return null
  const note = await mondayFor(team, { actor: null, cron: true })
  return mondayMail(team, note.result, istToday(), appLink())
}

export async function briefingEmailFor(p: Person): Promise<{ subject: string; html: string; text: string } | null> {
  const grant = await grantForEmployee(p.id)
  const access = await orgAccessFor(grant)
  if (!access) return null
  const full = await orgAnalytics(grant, scopeModuleOf(grant), { period: 'last_month' }, access)
  const body = redactTabs(full, access.tabs)
  const out = await briefingFor(full, body, access.tabs, 'last', { actor: null, cron: true })
  if (!out) return null
  const sc = body.scope
  return briefingMail(out.result, body.pulse.kpis, [sc.companyLabel, body.access.limitLabel].filter(Boolean).join(' · '), appLink())
}

export async function person(id: string): Promise<Person | null> {
  const { data } = await sb.from('employees').select(PERSON).eq('id', id).maybeSingle()
  return (data as Person | null) ?? null
}

// ── The scheduled run ───────────────────────────────────────────────────────

export interface DigestReport { kind: DigestKind; period: string; considered: number; sent: number; skipped: number; failed: number; left: number; note?: string }

/** Managers with at least one current, non-test report. */
async function managers(): Promise<Person[]> {
  const today = istToday()
  const emps = await all<any>(() => sb.from('employees').select('id, l1_manager_id, is_test, date_of_leaving').not('l1_manager_id', 'is', null).order('id') as any, 'reports')
  const ids = [...new Set(emps.filter(e => e.is_test !== true && (!e.date_of_leaving || String(e.date_of_leaving).slice(0, 10) >= today)).map(e => e.l1_manager_id as string))]
  const out: Person[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from('employees').select(PERSON).in('id', ids.slice(i, i + 150))
    for (const p of (data || []) as any[]) if (p.is_test !== true && (!p.date_of_leaving || String(p.date_of_leaving).slice(0, 10) >= today)) out.push(p as Person)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Send one kind of digest to everyone due it, within `budgetMs`. Safe to call again:
 * people already logged for the period are skipped, so a second run finishes the list.
 */
export async function runDigest(kind: DigestKind, budgetMs = 240_000): Promise<DigestReport> {
  const started = Date.now()
  const today = istToday()
  const period = kind === 'monday_note' ? weekKey(today) : moverWindow('last', today).from.slice(0, 7)
  const report: DigestReport = { kind, period, considered: 0, sent: 0, skipped: 0, failed: 0, left: 0 }
  const { ready, settings } = await digestSettings()
  if (!ready) return { ...report, note: 'Migration 233 has not been run.' }
  if (kind === 'monday_note' ? !settings.monday_note : !settings.monthly_briefing) return { ...report, note: 'Switched off in People Analytics → Email digests.' }
  if (!mailConfigured()) return { ...report, note: 'Email is not set up on this deployment.' }

  let people: Person[]
  if (kind === 'monday_note') people = await managers()
  else {
    const ids = settings.briefing_recipients
    const { data } = ids.length ? await sb.from('employees').select(PERSON).in('id', ids) : { data: [] }
    people = ((data || []) as any[]).filter(p => p.is_test !== true) as Person[]
  }
  const [{ data: done }, { data: outs }] = await Promise.all([
    sb.from('analytics_digest_log').select('employee_id, status').eq('kind', kind).eq('period_key', period),
    sb.from('analytics_digest_optout').select('employee_id').eq('kind', kind),
  ])
  const finished = new Set(((done || []) as any[]).filter(r => r.status !== 'failed').map(r => r.employee_id))
  const off = new Set(((outs || []) as any[]).map(r => r.employee_id))
  const queue = people.filter(p => !finished.has(p.id) && !off.has(p.id))
  report.considered = people.length

  const log = (employee_id: string, status: 'sent' | 'skipped' | 'failed', detail: string | null) =>
    sb.from('analytics_digest_log').upsert({ kind, employee_id, period_key: period, status, detail }, { onConflict: 'kind,employee_id,period_key' })

  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - started > budgetMs) { report.left = queue.length - i; break }
    const p = queue[i]
    const to = emailOf(p)
    if (!to) { report.skipped++; await log(p.id, 'skipped', 'No deliverable email address'); continue }
    try {
      const mail = kind === 'monday_note' ? await mondayEmailFor(p) : await briefingEmailFor(p)
      if (!mail) { report.skipped++; await log(p.id, 'skipped', kind === 'monday_note' ? 'No current reports' : 'No analytics access'); continue }
      const r = await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text, fromName: 'EZER HRMS' })
      if (r.sent) { report.sent++; await log(p.id, 'sent', null) }
      else { report.failed++; await log(p.id, 'failed', r.error || r.skipped || 'Not sent') }
    } catch (e: any) {
      report.failed++; await log(p.id, 'failed', String(e?.message || e).slice(0, 300))
    }
  }
  return report
}

/** The week's Monday note and the month's briefing for one person, without sending —
 *  for "Preview" and "Send me a test". */
export async function previewFor(kind: DigestKind, employeeId: string) {
  const p = await person(employeeId)
  if (!p) return null
  const mail = kind === 'monday_note' ? await mondayEmailFor(p) : await briefingEmailFor(p)
  return mail ? { ...mail, to: emailOf(p) } : null
}
