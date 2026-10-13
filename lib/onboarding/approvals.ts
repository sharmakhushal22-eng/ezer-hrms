// lib/onboarding/approvals.ts — SERVER ONLY.
//
// After the candidate submits the onboarding form, four teams sign it off — IT, Admin,
// Payroll and the HR Manager — each from ESS → Tasks & Approvals. Any of them may return it
// to the candidate with a remark (the link reopens, the candidate fixes and resubmits, all
// four sign off again). When the fourth approval lands, the employee code is generated and
// the employees row written, automatically (lib/onboarding/create-employee.ts).
//
// Rows live in onboarding_approvals (migration 156), one per team per onboarding.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import { notify } from '@/lib/ess/session'
import { roleHolders, type Person } from '@/lib/recruitment/offer-approval-notify'
import { createEmployeeFromOnboarding } from './create-employee'

export type Team = 'IT' | 'ADMIN' | 'PAYROLL' | 'HR_MANAGER'
export const TEAMS: Team[] = ['IT', 'ADMIN', 'PAYROLL', 'HR_MANAGER']
export const TEAM_LABEL: Record<Team, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
/** Which ESS roles act for each team. */
export const TEAM_ROLES: Record<Team, string[]> = {
  IT: ['IT'], ADMIN: ['ADMIN_COMPANY'], PAYROLL: ['PAYROLL', 'PAYROLL_ADMIN'], HR_MANAGER: ['HR_MANAGER'],
}

/** The teams a caller may decide for. A super admin may act for every team. */
export function teamsFor(roles: string[], isSuperAdmin = false): Team[] {
  if (isSuperAdmin) return [...TEAMS]
  const up = new Set(roles.map(r => String(r).toUpperCase()))
  return TEAMS.filter(t => TEAM_ROLES[t].some(r => up.has(r)))
}

/** One PENDING row per team (idempotent). A re-submission after a return resets every team to PENDING. */
export async function openApprovals(sb: SupabaseClient, onboardingId: string): Promise<void> {
  await sb.from('onboarding_approvals').upsert(
    TEAMS.map(team => ({ onboarding_id: onboardingId, team, status: 'PENDING', acted_by: null, acted_by_name: null, remark: null, acted_at: null })),
    { onConflict: 'onboarding_id,team' },
  )
}

export async function approvalsOf(sb: SupabaseClient, onboardingId: string) {
  const { data } = await sb.from('onboarding_approvals').select('*').eq('onboarding_id', onboardingId)
  const by = new Map<Team, any>((data || []).map((r: any) => [r.team, r]))
  return TEAMS.map(t => by.get(t) || { team: t, status: 'PENDING', acted_by_name: null, remark: null, acted_at: null })
}

/** Tell every team their sign-off is waiting (mail when a transporter is given, bell always). */
export async function notifyTeams(sb: SupabaseClient, onboardingId: string, mail?: { t: Transporter; from: string } | null): Promise<number> {
  const { data: oc } = await sb.from('onboarding_candidates').select('id, full_name, designation, company_id, date_of_joining').eq('id', onboardingId).maybeSingle()
  if (!oc) return 0
  const people: Person[] = []
  const seen = new Set<string>()
  for (const t of TEAMS) for (const p of await roleHolders(sb, oc.company_id, TEAM_ROLES[t])) if (!seen.has(p.id)) { seen.add(p.id); people.push({ ...p, role: t }) }
  const who = `${oc.full_name}${oc.designation ? ` (${oc.designation})` : ''}`
  const subject = `Onboarding form to approve — ${who}`
  const text = `Hi,

${who} has submitted their onboarding form${oc.date_of_joining ? ` (joining ${new Date(oc.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}.

Please review the details and documents and approve them for your team in EZER ESS → Tasks & Approvals → Onboarding approvals. If something is wrong, return the form with a remark and the candidate will fix it.

The employee code is generated automatically once IT, Admin, Payroll and the HR Manager have all approved.

— EZER HRMS`
  let n = 0
  for (const p of people) {
    if (mail && p.email) { try { await mail.t.sendMail({ from: mail.from, to: p.email, subject, text, html: text.replace(/\n/g, '<br>') }); n++ } catch (e) { console.error('onboarding approval mail failed', p.email, e) } }
    await notify(p.id, subject, `${who} submitted the onboarding form. Review and approve it for ${TEAM_LABEL[p.role as Team] || 'your team'} in Tasks & Approvals.`, '/ess/approvals', 'ONBOARDING').then(() => { n++ }, () => null)
  }
  return n
}

export interface Decision { onboardingId: string; team: Team; action: 'approve' | 'return'; actorId: string | null; actorName: string | null; remark: string | null; mail?: { t: Transporter; from: string } | null; baseUrl?: string | null }

/** A team's decision. Returns what happened, including the employee code when this was the last approval. */
export async function decideApproval(sb: SupabaseClient, d: Decision): Promise<{ ok: boolean; error?: string; status?: number; all_approved?: boolean; employee_code?: string | null; create_error?: string | null }> {
  const { data: oc } = await sb.from('onboarding_candidates').select('id, status, full_name, email, designation, company_id, magic_link_token, candidate_id').eq('id', d.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated.', status: 409 }
  if (!['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(oc.status)) return { ok: false, error: 'The candidate has not submitted the form yet.', status: 409 }
  if (d.action === 'return' && !String(d.remark || '').trim()) return { ok: false, error: 'Say what the candidate should fix.', status: 400 }

  const now = new Date().toISOString()
  await openApprovals(sb, d.onboardingId).catch(() => null)   // rows exist for a legacy submission too
  const { error } = await sb.from('onboarding_approvals').update({
    status: d.action === 'approve' ? 'APPROVED' : 'RETURNED', acted_by: d.actorId, acted_by_name: d.actorName, remark: d.remark || null, acted_at: now,
  }).eq('onboarding_id', d.onboardingId).eq('team', d.team)
  if (error) return { ok: false, error: error.message, status: 500 }
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: d.onboardingId, action: d.action === 'approve' ? 'TEAM_APPROVED' : 'RETURNED_TO_CANDIDATE', actor_type: 'HR', actor_id: d.actorId,
    details: { team: d.team, by: d.actorName, remark: d.remark || null },
  }).then(() => null, () => null)

  if (d.action === 'return') {
    // Back to the candidate: the link reopens for 48 hours and they are told what to fix.
    const expires = new Date(Date.now() + 48 * 3600_000).toISOString()
    await sb.from('onboarding_candidates').update({ status: 'IN_PROGRESS', hr_notes: `${TEAM_LABEL[d.team]} returned the form: ${d.remark}`, token_expires_at: expires }).eq('id', d.onboardingId)
    if (d.mail && oc.email) {
      const link = `${d.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'}/onboarding/${oc.magic_link_token}`
      const text = `Dear ${oc.full_name},

Thank you for submitting your onboarding form. The ${TEAM_LABEL[d.team]} team has asked for a small correction before it can be approved:

"${d.remark}"

Please open your onboarding link, make the change and submit again:
${link}

The link is valid for 48 hours.

Warm regards,
HR Team`
      try { await d.mail.t.sendMail({ from: d.mail.from, to: oc.email, subject: `A correction is needed on your onboarding form`, text, html: text.replace(/\n/g, '<br>') }) } catch (e) { console.error('return mail failed', e) }
    }
    return { ok: true, all_approved: false }
  }

  const all = await approvalsOf(sb, d.onboardingId)
  const allApproved = all.every(a => a.status === 'APPROVED')
  if (!allApproved) return { ok: true, all_approved: false }

  // The fourth approval: generate the code and create the employee.
  await sb.from('onboarding_candidates').update({ status: 'APPROVED' }).eq('id', d.onboardingId)
  const r = await createEmployeeFromOnboarding(sb, { onboardingId: d.onboardingId, by: d.actorName, notes: 'Approved by IT, Admin, Payroll and the HR Manager', actorType: 'SYSTEM' })
  // Tell HR either way; the HR Manager(s) of the company hear the outcome.
  const hr = await roleHolders(sb, oc.company_id, ['HR_MANAGER', 'HR_HEAD'])
  const who = `${oc.full_name}${oc.designation ? ` (${oc.designation})` : ''}`
  for (const p of hr) {
    await notify(p.id, r.ok ? `Employee code ${r.employee_code} generated — ${oc.full_name}` : `Employee creation failed — ${oc.full_name}`,
      r.ok ? `${who} is approved by all four teams. Employee code ${r.employee_code} is generated and the employee record is created.` : `${who} is approved by all four teams but the employee record could not be created: ${r.error}`,
      '/ess/onboarding', 'ONBOARDING').catch(() => null)
  }
  return { ok: true, all_approved: true, employee_code: r.employee_code || null, create_error: r.ok ? null : (r.error || 'failed') }
}
