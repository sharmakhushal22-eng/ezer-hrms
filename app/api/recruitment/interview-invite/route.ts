// app/api/recruitment/interview-invite/route.ts
//
//   GET  ?candidate_id=…                 -> { invites: [...] }  (all rounds, for the hiring manager's popup)
//   POST { action:'schedule', … }        -> one MAIN interviewer + any number of PANELISTS for a
//                                           round: a row per person, mails the candidate + everyone,
//                                           and drops an ESS task on each. Only the main interviewer's
//                                           task carries "Give feedback".
//   POST { action:'reschedule', … }      -> edit a scheduled round (interviewers, time, link — the link
//                                           AND passcode must be replaced); everyone re-mailed, re-acknowledges.
//   POST { action:'direct_feedback', … } -> the Telephonic (or any unscheduled) round: the recruiter
//                                           records the 8-parameter feedback + decision straight from
//                                           the candidate popup — no scheduling, no invite.
//   POST { action:'shortlist', … }       -> the final Shortlist after ≥3 decided rounds.
//
// Email is best-effort — if Gmail SMTP is not configured the invites and the
// ESS tasks are still created, and the response says email was skipped.

import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { renderResolvedEmail, resolveTemplate, mrfScope } from '@/lib/config/store'
import { notifyFromTemplate } from '@/lib/config/notify'
import { sendMail, mailConfigured } from '@/lib/mail/send'
import { applyInterviewDecision, distinctRounds, isDecision, roundOrdinal, ROUNDS_BEFORE_SHORTLIST } from '@/lib/recruitment/interview-decision'
import { CONFIDENTIAL_ROUNDS_BEFORE_SHORTLIST } from '@/lib/recruitment/confidential'
import { mrfOfCandidate } from '@/lib/recruitment/confidential-flow'
import { rescheduleProblems, changesOf, peopleDiff, type RoundSchedule } from '@/lib/recruitment/reschedule'
import { notify } from '@/lib/ess/session'

export const runtime = 'nodejs' // nodemailer needs Node, not Edge

const empEmail = (e: any) => e?.office_email || e?.personal_email || null
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const candidateId = req.nextUrl.searchParams.get('candidate_id')
  if (!candidateId) return bad('candidate_id is required')
  const { data, error } = await sb.from('interview_invites')
    .select('*').eq('candidate_id', candidateId).order('created_at', { ascending: true })
  if (error) return bad(error.message, 500)
  return NextResponse.json({ invites: data || [] })
}

// Insert, tolerating a DB that hasn't had migration 131 (role/decision) or 127 (passcode) applied.
async function insertInvites(rows: any[]) {
  let ins = await sb.from('interview_invites').insert(rows).select('id, interviewer_id, round')
  const colMissing = (e: any) => e && (e.code === '42703' || e.code === 'PGRST204')
  if (colMissing(ins.error) && /role|decision/i.test(ins.error!.message)) {
    ins = await sb.from('interview_invites').insert(rows.map(({ role: _r, decision: _d, decision_remark: _m, ...r }) => r)).select('id, interviewer_id, round')
  }
  if (colMissing(ins.error) && /meet_passcode/i.test(ins.error!.message)) {
    ins = await sb.from('interview_invites').insert(rows.map(({ meet_passcode: _p, ...r }) => r)).select('id, interviewer_id, round')
  }
  return ins
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error

  const body = await req.json().catch(() => null) as any
  if (!body) return bad('Bad request')

  if (body.action === 'direct_feedback') return directFeedback(body)
  if (body.action === 'shortlist') return finalShortlist(body)
  if (body.action === 'reschedule') return reschedule(body)
  if (body.action !== 'schedule') return bad('Unknown action')

  const { candidate_id, mrf_id, company_id, round, scheduled_at, meet_link, meet_passcode, scheduled_by } = body
  if (!candidate_id || !round) return bad('candidate_id and round are required')

  // One main interviewer, any number of panelists. (Legacy `interviewer_ids`: first = main.)
  let mainId: string | null = body.main_interviewer_id || null
  let panelIds: string[] = Array.isArray(body.panelist_ids) ? body.panelist_ids.filter(Boolean) : []
  if (!mainId && Array.isArray(body.interviewer_ids) && body.interviewer_ids.length) {
    [mainId, ...panelIds] = body.interviewer_ids.filter(Boolean)
  }
  if (!mainId) return bad('Select the main interviewer')
  // A confidential search invites nobody: the HR Head / HR Manager records the Telephonic
  // round themselves (direct_feedback).
  if ((await mrfOfCandidate(sb as any, candidate_id))?.is_confidential) return bad('Confidential hiring: interviews are not scheduled or shared. Record the Telephonic feedback directly from the candidate card.', 409)
  panelIds = [...new Set(panelIds.filter(id => id !== mainId))]
  const ids = [mainId, ...panelIds]

  // candidate + interviewers + scheduler, in as few round-trips as possible
  const [{ data: cand }, { data: emps }, { data: sched }] = await Promise.all([
    sb.from('candidates').select('full_name, email, designation, company_id, mrf_id').eq('id', candidate_id).maybeSingle(),
    sb.from('employees').select('id, emp_code, full_name, office_email, personal_email').in('id', ids),
    scheduled_by ? sb.from('employees').select('full_name').eq('id', scheduled_by).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const empById = new Map((emps || []).map((e: any) => [e.id, e]))
  const schedName = (sched as any)?.full_name || 'The hiring manager'
  const mainEmp: any = empById.get(mainId)

  const rows = ids.map(id => {
    const e: any = empById.get(id)
    return {
      candidate_id, mrf_id: mrf_id || null, company_id: company_id || null, round,
      interviewer_id: id, interviewer_emp_code: e?.emp_code || null,
      interviewer_name: e?.full_name || null, interviewer_email: empEmail(e),
      role: id === mainId ? 'MAIN' : 'PANELIST',
      scheduled_at: scheduled_at || null, meet_link: meet_link || null, meet_passcode: meet_passcode || null,
      scheduled_by: scheduled_by || null, scheduled_by_name: schedName,
      candidate_name: cand?.full_name || null, candidate_email: cand?.email || null,
      status: 'invited',
    }
  })

  const ins = await insertInvites(rows)
  if (ins.error) return bad(ins.error.message, 500)

  // In-app ESS task for everyone (surfaces in Tasks & Approvals + bell). The wording tells
  // the main interviewer feedback is theirs; panelists are asked only to acknowledge.
  // Words: Configuration → Recruitment → Notifications ("Interview to conduct — main
  // interviewer / panelist"), for the candidate's company and the MRF's branch.
  const companyId = company_id || (cand as any)?.company_id || null
  const scope = await mrfScope(mrf_id || (cand as any)?.mrf_id, companyId)
  const when = scheduled_at ? new Date(scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'a time to be confirmed'
  const nVars = { candidate_name: cand?.full_name || 'a candidate', round, interview_time: when, meet_link: meet_link || '', meet_passcode: meet_passcode || '', main_interviewer: mainEmp?.full_name || '—' }
  await Promise.all(ids.map(id => notifyFromTemplate(id, id === mainId ? 'notify.interview.main' : 'notify.interview.panel', nVars, { scope, link: '/ess?tab=approvals', category: 'INTERVIEW' })))

  // Email — best effort (mailRound below).
  const { emailed, emailSkipped } = await mailRound({ cand, candidateId: candidate_id, companyId, scope, round, when, meetLink: meet_link || '', meetPasscode: meet_passcode || '', schedName, mainId, panelIds, empById })

  return NextResponse.json({ ok: true, invited: ins.data?.length || 0, main: mainEmp?.full_name || null, panelists: panelIds.length, emailed, emailSkipped })
}

interface MailRoundInput {
  cand: any; candidateId: string; companyId: string | null; scope: any; round: string; when: string
  meetLink: string; meetPasscode: string; schedName: string; mainId: string; panelIds: string[]
  empById: Map<string, any>
  /** Set on a reschedule: every mail is marked as an update and says what changed. */
  update?: { what: string }
}

/** Mails the candidate and every interviewer of a round. The words come from Configuration
 *  (Interview invite — candidate / main interviewer / panelist) for the candidate's company /
 *  branch; each template is looked up once and filled per recipient. Best effort. */
async function mailRound(m: MailRoundInput): Promise<{ emailed: number; emailSkipped: string | null }> {
  if (!mailConfigured()) return { emailed: 0, emailSkipped: 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD). Invites and ESS tasks were still created.' }
  let emailed = 0
  const [tCand, tMain, tPanel, { data: co }] = await Promise.all([
    resolveTemplate('interview.candidate', m.scope),
    resolveTemplate('interview.interviewer_main', m.scope),
    resolveTemplate('interview.interviewer_panel', m.scope),
    m.companyId ? sb.from('companies').select('company_name').eq('id', m.companyId).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const mainEmp: any = m.empById.get(m.mainId)
  const panelNames = m.panelIds.map(id => (m.empById.get(id) as any)?.full_name).filter(Boolean)
  const common = {
    candidate_name: m.cand?.full_name || 'Candidate',
    round: m.round, interview_time: m.when,
    meet_link: m.meetLink, meet_passcode: m.meetPasscode,
    scheduler_name: m.schedName,
    company_name: (co as any)?.company_name || '',
  }
  // An update says so first, in the subject and above the template's own words.
  const mark = (mail: { subject: string; text: string; html: string }) => !m.update ? mail : {
    subject: `Rescheduled: ${mail.subject}`,
    text: `This interview has been updated (${m.update.what}). The details below replace the earlier invite; the old link and passcode no longer apply.\n\n${mail.text}`,
    html: `<p style="padding:10px 12px;background:#FFF7E6;border-radius:8px"><b>This interview has been updated</b> (${escapeHtml(m.update.what)}). The details below replace the earlier invite; the old link and passcode no longer apply.</p>${mail.html}`,
  }
  const tasks: Promise<any>[] = []
  const send = (to: string, mail: { subject: string; text: string; html: string }) =>
    sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'EZER HR Team' })
      .then(r => { if (r.sent) emailed++ })
  if (m.cand?.email && tCand) tasks.push(send(m.cand.email, mark(renderResolvedEmail(tCand, { ...common, job_title: m.cand?.designation || '' }))))
  for (const id of [m.mainId, ...m.panelIds]) {
    const e: any = m.empById.get(id); const to = empEmail(e)
    const tpl = id === m.mainId ? tMain : tPanel
    if (!to || !tpl) continue
    tasks.push(send(to, mark(renderResolvedEmail(tpl, { ...common, interviewer_name: e.full_name || '', panel_names: panelNames.join(', '), main_interviewer_name: mainEmp?.full_name || '—' }))))
  }
  await Promise.all(tasks)
  return { emailed, emailSkipped: null }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Edit a scheduled round: change / remove interviewers, move the time, replace the link.
// lib/recruitment/reschedule.ts holds the rules (the link and passcode must both be replaced).
// Kept interviewers' rows are updated and go back to "invited" (they acknowledge again), removed
// ones are deleted and told, added ones get new rows; the candidate and every interviewer get the
// new details by mail and an ESS task. Refused once the main interviewer's feedback is in.
async function reschedule(body: any) {
  const { candidate_id, round, scheduled_by } = body
  if (!candidate_id || !round) return bad('candidate_id and round are required')
  const { data: rowsAll, error } = await sb.from('interview_invites').select('*').eq('candidate_id', candidate_id).order('created_at', { ascending: true })
  if (error) return bad(error.message, 500)
  const rows = (rowsAll || []).filter((r: any) => String(r.round).toLowerCase() === String(round).toLowerCase())
  if (!rows.length) return bad('This round has not been scheduled yet.', 404)
  if (rows.some((r: any) => r.status === 'submitted')) return bad('Feedback for this round is already in, so it can no longer be changed.', 409)
  const mainRow: any = rows.find((r: any) => (r.role || 'MAIN') === 'MAIN') || rows[0]
  const prev: RoundSchedule = {
    mainId: mainRow.interviewer_id, panelIds: rows.filter((r: any) => r !== mainRow).map((r: any) => r.interviewer_id),
    scheduledAt: mainRow.scheduled_at, link: mainRow.meet_link || '', passcode: mainRow.meet_passcode || '',
  }
  const mainId: string | null = body.main_interviewer_id || null
  const next: RoundSchedule = {
    mainId, panelIds: [...new Set((Array.isArray(body.panelist_ids) ? body.panelist_ids : []).filter((x: any) => x && x !== mainId))] as string[],
    scheduledAt: body.scheduled_at || null, link: String(body.meet_link || '').trim(), passcode: String(body.meet_passcode || '').trim(),
  }
  const problems = rescheduleProblems(prev, next)
  if (problems.length) return bad(problems.join(' '))
  const c = changesOf(prev, next)
  const who = peopleDiff(prev, next)
  const ids = [next.mainId!, ...next.panelIds]

  const [{ data: cand }, { data: emps }, { data: sched }] = await Promise.all([
    sb.from('candidates').select('full_name, email, designation, company_id, mrf_id').eq('id', candidate_id).maybeSingle(),
    sb.from('employees').select('id, emp_code, full_name, office_email, personal_email').in('id', [...ids, ...who.removed]),
    scheduled_by ? sb.from('employees').select('full_name').eq('id', scheduled_by).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const empById = new Map((emps || []).map((e: any) => [e.id, e]))
  const schedName = (sched as any)?.full_name || mainRow.scheduled_by_name || 'The hiring manager'
  const now = new Date().toISOString()
  const details = { scheduled_at: next.scheduledAt, meet_link: next.link, meet_passcode: next.passcode, scheduled_by: scheduled_by || mainRow.scheduled_by || null, scheduled_by_name: schedName }

  // kept: new details, new role, and a fresh acknowledgement
  for (const r of rows as any[]) {
    if (!who.kept.includes(r.interviewer_id)) continue
    const { error: e1 } = await sb.from('interview_invites').update({ ...details, role: r.interviewer_id === next.mainId ? 'MAIN' : 'PANELIST', status: 'invited', acknowledged_at: null }).eq('id', r.id)
    if (e1) return bad(e1.message, 500)
  }
  // removed
  const removedRows = (rows as any[]).filter(r => who.removed.includes(r.interviewer_id))
  if (removedRows.length) {
    const { error: e2 } = await sb.from('interview_invites').delete().in('id', removedRows.map(r => r.id))
    if (e2) return bad(e2.message, 500)
  }
  // added
  if (who.added.length) {
    const ins = await insertInvites(who.added.map(id => {
      const e: any = empById.get(id)
      return {
        candidate_id, mrf_id: mainRow.mrf_id || null, company_id: mainRow.company_id || null, round: mainRow.round,
        interviewer_id: id, interviewer_emp_code: e?.emp_code || null, interviewer_name: e?.full_name || null, interviewer_email: empEmail(e),
        role: id === next.mainId ? 'MAIN' : 'PANELIST', ...details,
        candidate_name: cand?.full_name || null, candidate_email: cand?.email || null, status: 'invited',
      }
    }))
    if (ins.error) return bad(ins.error.message, 500)
  }

  const what = [c.time && 'new time', (c.main || c.panel) && 'interviewers changed', 'new meeting link and passcode'].filter(Boolean).join(', ')
  const companyId = mainRow.company_id || (cand as any)?.company_id || null
  const scope = await mrfScope(mainRow.mrf_id || (cand as any)?.mrf_id, companyId)
  const when = next.scheduledAt ? new Date(next.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'a time to be confirmed'
  const mainEmp: any = empById.get(next.mainId!)
  const nVars = { candidate_name: cand?.full_name || 'a candidate', round: mainRow.round, interview_time: when, meet_link: next.link, meet_passcode: next.passcode, main_interviewer: mainEmp?.full_name || '—' }
  await Promise.all(ids.map(id => notifyFromTemplate(id, id === next.mainId ? 'notify.interview.main' : 'notify.interview.panel', nVars, { scope, link: '/ess?tab=approvals', category: 'INTERVIEW' }).catch(() => null)))
  // Removed interviewers: a bell and a mail, so nobody turns up to an interview they left.
  for (const id of who.removed) {
    const e: any = empById.get(id)
    await notify(id, `Interview update: ${mainRow.round}`, `You are no longer on the ${mainRow.round} interview of ${cand?.full_name || 'the candidate'}. ${schedName} updated the panel.`, '/ess?tab=approvals', 'INTERVIEW').catch(() => null)
    const to = empEmail(e)
    if (to && mailConfigured()) await sendMail({ to, fromName: 'EZER HR Team', subject: `Interview update: you are off the ${mainRow.round} panel for ${cand?.full_name || 'a candidate'}`, text: `Hi ${e?.full_name || ''},\n\nYou are no longer on the ${mainRow.round} interview of ${cand?.full_name || 'the candidate'}. Please ignore the earlier invite; nothing is needed from you.\n\n${schedName}`, html: `<p>Hi ${escapeHtml(e?.full_name || '')},</p><p>You are no longer on the <b>${escapeHtml(mainRow.round)}</b> interview of <b>${escapeHtml(cand?.full_name || 'the candidate')}</b>. Please ignore the earlier invite; nothing is needed from you.</p><p>${escapeHtml(schedName)}</p>` }).catch(() => null)
  }
  const { emailed, emailSkipped } = await mailRound({ cand, candidateId: candidate_id, companyId, scope, round: mainRow.round, when, meetLink: next.link, meetPasscode: next.passcode, schedName, mainId: next.mainId!, panelIds: next.panelIds, empById, update: { what } })

  await sb.from('recruitment_audit_logs').insert({
    candidate_id, company_id: companyId, action_type: 'INTERVIEW_RESCHEDULED', created_at: now,
    details: { round: mainRow.round, by: schedName, changes: c, before: { ...prev, passcode: prev.passcode ? '••••' : '' }, after: { ...next, passcode: '••••' }, added: who.added, removed: who.removed },
  }).then(() => null, () => null)

  return NextResponse.json({ ok: true, changed: what, added: who.added.length, removed: who.removed.length, interviewers: ids.length, emailed, emailSkipped })
}

// The Telephonic round (or any round the recruiter runs themselves): feedback lands as a
// submitted MAIN row with no schedule, and the decision moves the candidate.
async function directFeedback(body: any) {
  const { candidate_id, mrf_id, company_id, round, interviewer_id, feedback } = body
  if (!candidate_id || !round) return bad('candidate_id and round are required')
  if (!feedback || typeof feedback !== 'object') return bad('feedback payload is required')
  if (!isDecision(feedback.decision)) return bad('Choose Hold, Reject or Shortlist')
  if (feedback.decision !== 'SHORTLIST' && !String(feedback.decision_remark || '').trim()) return bad('A remark is required for Hold / Reject')

  const [{ data: cand }, { data: me }, { data: existing }] = await Promise.all([
    sb.from('candidates').select('full_name, email, stage').eq('id', candidate_id).maybeSingle(),
    interviewer_id ? sb.from('employees').select('id, emp_code, full_name, office_email, personal_email').eq('id', interviewer_id).maybeSingle() : Promise.resolve({ data: null } as any),
    sb.from('interview_invites').select('*').eq('candidate_id', candidate_id).order('created_at', { ascending: true }),   // '*' — tolerant of a DB without migration 131
  ])
  if (!cand) return bad('Candidate not found', 404)
  const rows = (existing || []) as any[]
  if (rows.some(r => r.round.toLowerCase() === String(round).toLowerCase() && (r.role || 'MAIN') === 'MAIN' && r.status === 'submitted'))
    return bad(`Feedback for the ${round} round is already on record`, 409)

  const now = new Date().toISOString()
  const ins = await insertInvites([{
    candidate_id, mrf_id: mrf_id || null, company_id: company_id || null, round,
    interviewer_id: (me as any)?.id || null, interviewer_emp_code: (me as any)?.emp_code || null,
    interviewer_name: (me as any)?.full_name || 'Recruiter', interviewer_email: empEmail(me),
    role: 'MAIN', scheduled_at: null, meet_link: null, meet_passcode: null,
    scheduled_by: (me as any)?.id || null, scheduled_by_name: (me as any)?.full_name || 'Recruiter',
    candidate_name: cand.full_name, candidate_email: cand.email,
    status: 'submitted', acknowledged_at: now, submitted_at: now,
    feedback, decision: feedback.decision, decision_remark: feedback.decision_remark || null,
  }])
  if (ins.error) {
    if (/interviewer_id/.test(ins.error.message) && /not-null/.test(ins.error.message))
      return bad('Your login is not linked to an employee record, and the database needs migration 131 to record feedback without one.', 500)
    return bad(ins.error.message, 500)
  }

  const rounds = distinctRounds(rows)
  let stage: string | null = null
  // Confidential hiring: the Telephonic round is the only round, so a Shortlist decision
  // takes the candidate straight to Shortlisted (Negotiation) — no further rounds, no
  // separate Shortlist click.
  const confidential = !!(await mrfOfCandidate(sb as any, candidate_id))?.is_confidential
  try {
    if (confidential && feedback.decision === 'SHORTLIST' && !['Offer Sent', 'Joined'].includes(String(cand.stage))) {
      const { error } = await sb.from('candidates').update({ stage: 'Shortlisted' }).eq('id', candidate_id)
      if (error) throw new Error(error.message)
      stage = 'Shortlisted'
    } else stage = await applyInterviewDecision(sb as any, candidate_id, round, feedback.decision, roundOrdinal(rounds, round))
  } catch (e: any) { return bad(e.message || 'Could not update the candidate', 500) }
  return NextResponse.json({ ok: true, id: ins.data?.[0]?.id, decision: feedback.decision, stage, confidential })
}

// Final Shortlist: allowed once ≥3 rounds carry a main-interviewer decision and the latest
// decision is Shortlist or Hold (a Reject ends the pipeline).
async function finalShortlist(body: any) {
  const { candidate_id } = body
  if (!candidate_id) return bad('candidate_id is required')
  const { data } = await sb.from('interview_invites').select('*')   // '*' — tolerant of a DB without migration 131
    .eq('candidate_id', candidate_id).order('created_at', { ascending: true })
  const rows = ((data || []) as any[]).filter(r => (r.role || 'MAIN') === 'MAIN' && r.status === 'submitted')
  const decided = distinctRounds(rows.filter(r => r.decision || r.feedback?.decision))
  const need = (await mrfOfCandidate(sb as any, candidate_id))?.is_confidential ? CONFIDENTIAL_ROUNDS_BEFORE_SHORTLIST : ROUNDS_BEFORE_SHORTLIST
  if (decided.length < need) return bad(`${need} decided round${need === 1 ? ' is' : 's are'} needed before shortlisting (have ${decided.length})`)
  const last = rows[rows.length - 1]
  const lastDecision = last?.decision || last?.feedback?.decision
  if (lastDecision === 'REJECT') return bad('The latest round rejected this candidate')
  const { data: cand } = await sb.from('candidates').select('stage').eq('id', candidate_id).maybeSingle()
  if (['Offer Sent', 'Joined'].includes((cand as any)?.stage)) return bad('Candidate is already past Shortlisted')
  const { error } = await sb.from('candidates').update({ stage: 'Shortlisted' }).eq('id', candidate_id)
  if (error) return bad(error.message, 500)
  return NextResponse.json({ ok: true, stage: 'Shortlisted', rounds: decided.length })
}
