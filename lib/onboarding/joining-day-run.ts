// lib/onboarding/joining-day-run.ts — SERVER ONLY.
//
// The cron half of the three joining-day mails (rules and words: ./joining-day.ts). Runs from
// /api/cron/offer-followup once a day, over the joiners that lib/recruitment/joiners.ts lists.
//
//   runPrepareMails   2 days before joining → IT, Admin (Company), HR Ops (HR Executive, Branch
//                     HR) and HR Manager of the company, plus the hr_email on the card. Mail and
//                     bell. candidates.prep_mail_sent_at.
//   runWelcomeMails   the day before → the candidate: welcome mail, the company's joining-day
//                     programme, the greeting card PDF. candidates.welcome_mail_sent_at.
//   runLinkReminders  joining day, no onboarding link yet → HR Manager(s) + hr_email.
//                     candidates.link_reminder_sent_at.
//
// Needs migration 156. Until it is applied the select fails and the run reports that.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import { notify } from '@/lib/ess/session'
import { roleHolders, type Person } from '@/lib/recruitment/offer-approval-notify'
import { loadJoiners, type Joiner } from '@/lib/recruitment/joiners'
import { prepDue, welcomeDue, linkReminderDue, prepareMail, welcomeMail, linkReminderMail, scheduleFor, type JoinerFacts } from './joining-day'
import { welcomeCardPdf } from './welcome-card'

/** The teams that get the givables ready. HR Ops has no role of its own; HR Executive and Branch HR are it. */
export const PREP_TEAM_ROLES = ['IT', 'ADMIN_COMPANY', 'HR_EXECUTIVE', 'BRANCH_HR', 'HR_MANAGER']
const HR_MANAGER_ROLES = ['HR_MANAGER']

export interface RunSummary { considered: number; due: number; mailed: number; notified: number; skipped: Record<string, number>; error?: string }
const fresh = (): RunSummary => ({ considered: 0, due: 0, mailed: 0, notified: 0, skipped: {} })
const skip = (s: RunSummary, why: string) => { s.skipped[why] = (s.skipped[why] || 0) + 1 }

type Ctx = { sb: SupabaseClient; mail: Transporter; from: string; now: number }

/** Company, department and location names for the joiners, one query each. */
async function facts(sb: SupabaseClient, joiners: Joiner[]) {
  const companyIds = [...new Set(joiners.map(j => j.companyId).filter(Boolean))] as string[]
  const deptIds = [...new Set(joiners.map(j => j.mrf?.department_id).filter(Boolean))] as string[]
  const locIds = [...new Set(joiners.map(j => j.mrf?.location_id).filter(Boolean))] as string[]
  const [cos, depts, locs, scheds] = await Promise.all([
    companyIds.length ? sb.from('companies').select('id, company_name, company_code, group_id, corp_office, reg_office, cin, gstin, pan').in('id', companyIds) : Promise.resolve({ data: [] as any[] }),
    deptIds.length ? sb.from('departments').select('id, dept_name').in('id', deptIds) : Promise.resolve({ data: [] as any[] }),
    locIds.length ? sb.from('locations').select('id, location_name, address_line1, address_line2, city, state, pin_code').in('id', locIds) : Promise.resolve({ data: [] as any[] }),
    companyIds.length ? sb.from('onboarding_day_schedules').select('*').in('company_id', companyIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const by = (rows: any) => new Map<string, any>(((rows as any).data || []).map((r: any) => [r.id, r]))
  const coBy = by(cos), deptBy = by(depts), locBy = by(locs)
  const schedBy = new Map<string, any>((((scheds as any).data || []) as any[]).map(r => [r.company_id, r]))
  const of = (j: Joiner): JoinerFacts & { venue: string | null; sched: any } => {
    const co = coBy.get(j.companyId || ''), loc = locBy.get(j.mrf?.location_id || '')
    const addr = loc ? [loc.address_line1, loc.address_line2, loc.city, loc.state, loc.pin_code].filter(Boolean).join(', ') : ''
    const sched = schedBy.get(j.companyId || '') || null
    return {
      name: j.cand.full_name, role: j.role, department: deptBy.get(j.mrf?.department_id || '')?.dept_name || null,
      company: co?.company_name || 'the company', doj: j.doj!, mrfNumber: j.mrf?.mrf_number || null,
      location: loc?.location_name || null, employmentType: null,
      venue: sched?.venue || (loc ? `${loc.location_name}${addr ? `, ${addr}` : ''}` : (co?.corp_office || co?.reg_office || null)),
      sched,
    }
  }
  return { of, coBy }
}

const peopleByCompany = async (sb: SupabaseClient, joiners: Joiner[], roles: string[]) => {
  const m = new Map<string, Person[]>()
  for (const id of [...new Set(joiners.map(j => j.companyId).filter(Boolean))] as string[]) m.set(id, await roleHolders(sb, id, roles))
  return m
}

async function sendToPeople(c: Ctx, s: RunSummary, people: Person[], extraEmail: string | null, subject: string, text: string, body: string, link: string): Promise<boolean> {
  let any = false
  const seen = new Set<string>()
  for (const p of people) {
    if (p.email && !seen.has(p.email.toLowerCase())) {
      seen.add(p.email.toLowerCase())
      try { await c.mail.sendMail({ from: c.from, to: p.email, subject, text, html: text.replace(/\n/g, '<br>') }); s.mailed++; any = true } catch (e) { console.error('joining-day mail failed', p.email, e) }
    }
    await notify(p.id, subject, body, link, 'ONBOARDING').then(() => { s.notified++; any = true }, () => null)
  }
  if (extraEmail && /@/.test(extraEmail) && !seen.has(extraEmail.toLowerCase())) {
    try { await c.mail.sendMail({ from: c.from, to: extraEmail, subject, text, html: text.replace(/\n/g, '<br>') }); s.mailed++; any = true } catch (e) { console.error('joining-day mail failed', extraEmail, e) }
  }
  return any
}

/** 2 days before joining: the teams prepare the givables. */
export async function runPrepareMails(c: Ctx): Promise<RunSummary> {
  const s = fresh()
  const { joiners, error } = await loadJoiners(c.sb, c.now)
  if (error) { s.error = error; return s }
  const due = joiners.filter(j => prepDue(j.daysToJoin, j.cand.prep_mail_sent_at))
  s.considered = joiners.length; s.due = due.length
  if (!due.length) return s
  const F = await facts(c.sb, due)
  const teams = await peopleByCompany(c.sb, due, PREP_TEAM_ROLES)
  for (const j of due) {
    const f = F.of(j)
    const { subject, text } = prepareMail(f, j.daysToJoin!)
    const sent = await sendToPeople(c, s, teams.get(j.companyId || '') || [], j.cand.hr_email, subject, text,
      `${f.name}${f.role ? ` (${f.role})` : ''} joins ${j.daysToJoin === 0 ? 'today' : j.daysToJoin === 1 ? 'tomorrow' : `in ${j.daysToJoin} days`}. Please prepare the givables and onboarding formalities.`, '/ess/onboarding')
    if (sent) await c.sb.from('candidates').update({ prep_mail_sent_at: new Date(c.now).toISOString() }).eq('id', j.cand.id)
    else skip(s, 'no-team-address')
  }
  return s
}

/** The day before joining: the candidate's welcome mail with the programme and the card. */
export async function runWelcomeMails(c: Ctx): Promise<RunSummary> {
  const s = fresh()
  const { joiners, error } = await loadJoiners(c.sb, c.now)
  if (error) { s.error = error; return s }
  const due = joiners.filter(j => welcomeDue(j.daysToJoin, j.cand.welcome_mail_sent_at))
  s.considered = joiners.length; s.due = due.length
  if (!due.length) return s
  const F = await facts(c.sb, due)
  const hr = await peopleByCompany(c.sb, due, HR_MANAGER_ROLES)
  for (const j of due) {
    if (!j.cand.email) { skip(s, 'no-candidate-email'); continue }
    const f = F.of(j)
    const sched = scheduleFor(f.sched)
    const hrm = (hr.get(j.companyId || '') || [])[0]
    const contact = { name: f.sched?.contact_name || (hrm ? `${hrm.name} (HR)` : null), phone: f.sched?.contact_phone || null, email: j.cand.hr_email && /@/.test(j.cand.hr_email) ? j.cand.hr_email : (hrm?.email || null) }
    const { subject, text, html } = welcomeMail(f, sched, f.venue, contact)
    let attachments: any[] = []
    try { const pdf = await welcomeCardPdf(F.coBy.get(j.companyId || '') || null, f, sched, f.venue, contact); attachments = [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }] }
    catch (e) { console.error('welcome card failed', j.cand.id, e) }
    try {
      await c.mail.sendMail({ from: c.from, to: j.cand.email, subject, text, html, attachments })
      s.mailed++
      await c.sb.from('candidates').update({ welcome_mail_sent_at: new Date(c.now).toISOString() }).eq('id', j.cand.id)
    } catch (e) { console.error('welcome mail failed', j.cand.email, e); skip(s, 'send-failed') }
  }
  return s
}

/** Joining day: no onboarding link has gone out → the HR Manager is reminded. */
export async function runLinkReminders(c: Ctx): Promise<RunSummary> {
  const s = fresh()
  const { joiners, error } = await loadJoiners(c.sb, c.now)
  if (error) { s.error = error; return s }
  const today = joiners.filter(j => j.daysToJoin === 0 && !j.cand.link_reminder_sent_at)
  s.considered = joiners.length
  if (!today.length) return s
  const { data: links } = await c.sb.from('onboarding_candidates').select('candidate_id').in('candidate_id', today.map(j => j.cand.id))
  const linked = new Set((links || []).map((l: any) => l.candidate_id))
  const due = today.filter(j => linkReminderDue(j.daysToJoin, j.cand.link_reminder_sent_at, linked.has(j.cand.id)))
  s.due = due.length
  if (!due.length) return s
  const F = await facts(c.sb, due)
  const hr = await peopleByCompany(c.sb, due, HR_MANAGER_ROLES)
  for (const j of due) {
    const f = F.of(j)
    const { subject, text } = linkReminderMail(f)
    const sent = await sendToPeople(c, s, hr.get(j.companyId || '') || [], j.cand.hr_email, subject, text,
      `${f.name}${f.role ? ` (${f.role})` : ''} joins today and no onboarding link has gone out. Send it from Onboarding → Candidates.`, '/ess/onboarding')
    if (sent) await c.sb.from('candidates').update({ link_reminder_sent_at: new Date(c.now).toISOString() }).eq('id', j.cand.id)
    else skip(s, 'no-hr-address')
  }
  return s
}
