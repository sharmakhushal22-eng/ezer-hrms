// lib/onboarding/approvals.ts — SERVER ONLY.
//
// The sign-off chain after the candidate submits the onboarding form:
//
//   1. The HR Manager reviews the form from the onboarding card (lib/onboarding/review.ts) and
//      accepts it — that is the HR_MANAGER approval — or returns it to the candidate.
//   2. Acceptance opens it to the three heads — IT, Admin, Payroll — in ESS → Tasks &
//      Approvals. Each confirms their checklist (lib/onboarding/checklists.ts: laptop, email,
//      ID card, salary structure …) and approves, or returns the form with a remark.
//   3. When the third head has approved, the onboarding is APPROVED and the HR Manager is
//      told: assign the reporting line and the ESS role (Role assignment on the card,
//      lib/onboarding/role-assignment.ts), then generate the employee code.
//
// Rows live in onboarding_approvals (migration 156; checklist from 166), one per team.
// The employee code is NOT generated here any more — the HR Manager does that after the
// role assignment (app/api/onboarding/generate-code).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import { notify } from '@/lib/ess/session'
import { roleHolders, type Person } from '@/lib/recruitment/offer-approval-notify'
import { correctionsMail, type Corrections } from './corrections'
import { CHECKLISTS, HEAD_TEAMS, isHeadTeam, missingItems, normaliseChecklist, checklistColumns, summariseChecklist, type HeadTeam } from './checklists'

export type Team = 'IT' | 'ADMIN' | 'PAYROLL' | 'HR_MANAGER'
export const TEAMS: Team[] = ['IT', 'ADMIN', 'PAYROLL', 'HR_MANAGER']
export { HEAD_TEAMS }
export const TEAM_LABEL: Record<Team, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
/** Which ESS roles act for each team — the heads of IT, Admin and Payroll, and the HR Manager. */
export const TEAM_ROLES: Record<Team, string[]> = {
  IT: ['IT'], ADMIN: ['ADMIN_COMPANY'], PAYROLL: ['PAYROLL', 'PAYROLL_ADMIN'], HR_MANAGER: ['HR_MANAGER'],
}

/** The teams a caller may decide for. A super admin may act for every team. */
export function teamsFor(roles: string[], isSuperAdmin = false): Team[] {
  if (isSuperAdmin) return [...TEAMS]
  const up = new Set(roles.map(r => String(r).toUpperCase()))
  return TEAMS.filter(t => TEAM_ROLES[t].some(r => up.has(r)))
}

/**
 * One PENDING row per team. `reset` (a submission, including a re-submission after a return)
 * puts every team back to PENDING; without it, rows that already exist are left alone — a
 * decision must never undo another team's approval, which an unconditional upsert did.
 */
export async function openApprovals(sb: SupabaseClient, onboardingId: string, o: { reset?: boolean } = {}): Promise<void> {
  const rows = TEAMS.map(team => ({ onboarding_id: onboardingId, team, status: 'PENDING', acted_by: null, acted_by_name: null, remark: null, acted_at: null }))
  if (o.reset) { await sb.from('onboarding_approvals').upsert(rows, { onConflict: 'onboarding_id,team' }); return }
  await sb.from('onboarding_approvals').upsert(rows, { onConflict: 'onboarding_id,team', ignoreDuplicates: true })
}

export async function approvalsOf(sb: SupabaseClient, onboardingId: string) {
  const { data } = await sb.from('onboarding_approvals').select('*').eq('onboarding_id', onboardingId)
  const by = new Map<Team, any>((data || []).map((r: any) => [r.team, r]))
  return TEAMS.map(t => by.get(t) || { team: t, status: 'PENDING', acted_by_name: null, remark: null, acted_at: null, checklist: null })
}

/** Tell the heads their sign-off is waiting (mail when a transporter is given, bell always). */
export async function notifyTeams(sb: SupabaseClient, onboardingId: string, mail?: { t: Transporter; from: string } | null, teams: Team[] = HEAD_TEAMS): Promise<number> {
  const { data: oc } = await sb.from('onboarding_candidates').select('id, full_name, designation, company_id, date_of_joining').eq('id', onboardingId).maybeSingle()
  if (!oc) return 0
  const people: Person[] = []
  const seen = new Set<string>()
  for (const t of teams) for (const p of await roleHolders(sb, oc.company_id, TEAM_ROLES[t])) if (!seen.has(p.id)) { seen.add(p.id); people.push({ ...p, role: t }) }
  const who = `${oc.full_name}${oc.designation ? ` (${oc.designation})` : ''}`
  const subject = `Onboarding approval waiting — ${who}`
  const text = `Hi,

The HR Manager has accepted the onboarding form of ${who}${oc.date_of_joining ? ` (joining ${new Date(oc.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}.

Please open it in EZER ESS → HRIS → Tasks & Approvals → Onboarding approvals, confirm your team's checklist (what is ready for the joiner) and approve. If something in the form is wrong, return it with a remark and the candidate will fix it.

Once IT, Admin and Payroll have all approved, the HR Manager assigns the role and generates the employee code.

— EZER HRMS`
  let n = 0
  for (const p of people) {
    if (mail && p.email) { try { await mail.t.sendMail({ from: mail.from, to: p.email, subject, text, html: text.replace(/\n/g, '<br>') }); n++ } catch (e) { console.error('onboarding approval mail failed', p.email, e) } }
    await notify(p.id, subject, `${who}'s form is accepted by HR. Confirm the ${CHECKLISTS[p.role as HeadTeam]?.title.toLowerCase() || 'checklist'} for ${TEAM_LABEL[p.role as Team] || 'your team'} and approve in Tasks & Approvals.`, '/ess/approvals', 'ONBOARDING').then(() => { n++ }, () => null)
  }
  return n
}

export interface Decision {
  onboardingId: string; team: Team; action: 'approve' | 'return' | 'save'; actorId: string | null; actorName: string | null; remark: string | null
  /** A head team's checklist, as the form sent it. Required (complete) to approve; `save` keeps it without deciding. */
  checklist?: Record<string, any> | null
  /** The HR Manager's itemised return (lib/onboarding/review.ts): the mail lists every rejected document and flagged detail. */
  corrections?: Corrections | null
  mail?: { t: Transporter; from: string } | null; baseUrl?: string | null
}
export const RETURN_LINK_HOURS = 48

export interface DecisionResult {
  ok: boolean; error?: string; status?: number
  /** True when the third head has just approved — the role assignment is next. */
  all_approved?: boolean
  /** Which required checklist items are still missing (a refused approve). */
  missing?: string[]
}

/** A team's decision (or a checklist save). */
export async function decideApproval(sb: SupabaseClient, d: Decision): Promise<DecisionResult> {
  const { data: oc } = await sb.from('onboarding_candidates').select('id, status, full_name, email, designation, company_id, magic_link_token, candidate_id').eq('id', d.onboardingId).maybeSingle()
  if (!oc) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (oc.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'The employee code is already generated.', status: 409 }
  if (!['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(oc.status)) return { ok: false, error: 'The candidate has not submitted the form yet.', status: 409 }
  if (d.action === 'return' && !String(d.remark || '').trim()) return { ok: false, error: 'Say what the candidate should fix.', status: 400 }

  await openApprovals(sb, d.onboardingId).catch(() => null)   // rows exist for a legacy submission too; never resets a decision
  const all = await approvalsOf(sb, d.onboardingId)
  const hrAccepted = all.find(a => a.team === 'HR_MANAGER')?.status === 'APPROVED'

  // The heads act only once the HR Manager has accepted the form.
  if (isHeadTeam(d.team) && !hrAccepted) return { ok: false, error: 'The HR Manager has not accepted the form yet — it reaches IT, Admin and Payroll after that.', status: 409 }

  // The checklist: saved on the team's row and, for the columns, on the candidate.
  const now = new Date().toISOString()
  let checklist: Record<string, any> | null = null
  if (isHeadTeam(d.team) && d.checklist) {
    checklist = normaliseChecklist(d.team, d.checklist)
    const cols = checklistColumns(d.team, checklist)
    if (Object.keys(cols).length) await sb.from('onboarding_candidates').update(cols).eq('id', d.onboardingId)
  }
  if (d.action === 'save') {
    if (!isHeadTeam(d.team)) return { ok: false, error: 'Only IT, Admin and Payroll keep a checklist.', status: 400 }
    await sb.from('onboarding_approvals').update({ checklist }).eq('onboarding_id', d.onboardingId).eq('team', d.team)
    return { ok: true, all_approved: false }
  }
  if (d.action === 'approve' && isHeadTeam(d.team)) {
    const have = checklist ?? all.find(a => a.team === d.team)?.checklist ?? null
    const missing = missingItems(d.team, have)
    if (missing.length) return { ok: false, error: `Confirm the ${CHECKLISTS[d.team].title.toLowerCase()} first: ${missing.join(', ')}.`, status: 400, missing }
    if (!checklist) checklist = have
  }

  const { error } = await sb.from('onboarding_approvals').update({
    status: d.action === 'approve' ? 'APPROVED' : 'RETURNED', acted_by: d.actorId, acted_by_name: d.actorName, remark: d.remark || null, acted_at: now,
    ...(checklist ? { checklist } : {}),
  }).eq('onboarding_id', d.onboardingId).eq('team', d.team)
  if (error) return { ok: false, error: error.message, status: 500 }
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: d.onboardingId, action: d.action === 'approve' ? 'TEAM_APPROVED' : 'RETURNED_TO_CANDIDATE', actor_type: 'HR', actor_id: d.actorId,
    details: { team: d.team, by: d.actorName, remark: d.remark || null, checklist: checklist && isHeadTeam(d.team) ? summariseChecklist(d.team, checklist) : null },
  }).then(() => null, () => null)

  if (d.action === 'return') {
    // Back to the candidate: the link reopens for 48 hours and they are told what to fix.
    const expires = new Date(Date.now() + RETURN_LINK_HOURS * 3600_000).toISOString()
    await sb.from('onboarding_candidates').update({ status: 'IN_PROGRESS', hr_notes: `${TEAM_LABEL[d.team]} returned the form: ${d.remark}`, token_expires_at: expires }).eq('id', d.onboardingId)
    if (d.mail && oc.email) {
      const link = `${d.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'}/onboarding/${oc.magic_link_token}`
      const c: Corrections = d.corrections || { documents: [], details: [], note: d.remark }
      const m = correctionsMail({ name: oc.full_name, link, validityHours: RETURN_LINK_HOURS, byTeam: d.team === 'HR_MANAGER' ? 'The HR Manager' : `The ${TEAM_LABEL[d.team]} team` }, c)
      try { await d.mail.t.sendMail({ from: d.mail.from, to: oc.email, subject: m.subject, text: m.text, html: m.html }) } catch (e) { console.error('return mail failed', e) }
    }
    return { ok: true, all_approved: false }
  }

  // The HR Manager's acceptance opens the form to the three heads.
  if (d.team === 'HR_MANAGER') {
    await notifyTeams(sb, d.onboardingId, d.mail).catch(e => console.error('head notification failed', e))
    return { ok: true, all_approved: false }
  }

  const after = await approvalsOf(sb, d.onboardingId)
  if (!after.every(a => a.status === 'APPROVED')) return { ok: true, all_approved: false }

  // The third head: the onboarding is approved; the HR Manager assigns the role, then the code.
  await sb.from('onboarding_candidates').update({ status: 'APPROVED' }).eq('id', d.onboardingId)
  const hr = await roleHolders(sb, oc.company_id, ['HR_MANAGER', 'HR_HEAD'])
  const who = `${oc.full_name}${oc.designation ? ` (${oc.designation})` : ''}`
  for (const p of hr) {
    await notify(p.id, `Approved by IT, Admin and Payroll — ${oc.full_name}`,
      `${who} is approved by all three teams. Open Onboarding, press Role assignment on the card (L1, L2 and the ESS role), then generate the employee code.`,
      '/ess/onboarding', 'ONBOARDING').catch(() => null)
  }
  return { ok: true, all_approved: true }
}
