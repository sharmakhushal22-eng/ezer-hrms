// app/api/recruitment/interview-invite/route.ts
//
//   GET  ?candidate_id=…                 -> { invites: [...] }  (all rounds, for the hiring manager's popup)
//   POST { action:'schedule', … }        -> one MAIN interviewer + any number of PANELISTS for a
//                                           round: a row per person, mails the candidate + everyone,
//                                           and drops an ESS task on each. Only the main interviewer's
//                                           task carries "Give feedback".
//   POST { action:'direct_feedback', … } -> the Telephonic (or any unscheduled) round: the recruiter
//                                           records the 8-parameter feedback + decision straight from
//                                           the candidate popup — no scheduling, no invite.
//   POST { action:'shortlist', … }       -> the final Shortlist after ≥3 CLEARED rounds
//                                           (decided SHORTLIST; Hold and Reject do not count).
//
// Email is best-effort — if Gmail SMTP is not configured the invites and the
// ESS tasks are still created, and the response says email was skipped.

import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify as essNotify } from '@/lib/ess/session'
import { applyInterviewDecision, distinctRounds, isDecision, roundOrdinal } from '@/lib/recruitment/interview-decision'
// The shortlist rules: three CLEARED rounds, and one candidate per opening. The
// browser's "Move to" picker calls the SAME canShortlist(), so the reason it
// shows a user is the reason this route would have given them.
import { canShortlist, openingsOf, slotsUsed, SLOT_STAGES } from '@/lib/recruitment/pipeline-gates'
// A rejection needs a reason AND a remark. The dialog collects them; THIS route
// is what refuses without them — the same split as the shortlist rules above.
import { validateRejection, normaliseRemark, rejectionLabel } from '@/lib/recruitment/rejection'

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
  if (body.action === 'reject') return rejectCandidate(body, gate.user.employeeId)
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
  panelIds = [...new Set(panelIds.filter(id => id !== mainId))]
  const ids = [mainId, ...panelIds]

  // candidate + interviewers + scheduler, in as few round-trips as possible
  const [{ data: cand }, { data: emps }, { data: sched }] = await Promise.all([
    sb.from('candidates').select('full_name, email, designation').eq('id', candidate_id).maybeSingle(),
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
  const when = scheduled_at ? new Date(scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'a time to be confirmed'
  const joinBits = `${meet_link ? ` Join: ${meet_link}` : ''}${meet_passcode ? ` · Passcode: ${meet_passcode}` : ''}`
  await Promise.all(ids.map(id => {
    const isMain = id === mainId
    return essNotify(
      id,
      `Interview to conduct — ${cand?.full_name || 'a candidate'} (${round})`,
      isMain
        ? `You are the main interviewer for the ${round} round on ${when}.${joinBits} Acknowledge it in Tasks & Approvals, then give your feedback after the interview.`
        : `You've been added as a panelist for the ${round} round on ${when}.${joinBits} Main interviewer: ${mainEmp?.full_name || '—'}. Acknowledge it in Tasks & Approvals.`,
      '/ess?tab=approvals',
      'INTERVIEW',
    ).catch(() => null)
  }))

  // Email — best effort.
  let emailed = 0, emailSkipped: string | null = null
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    const from = `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`
    const linkLine = (meet_link ? `\nJoin link: ${meet_link}` : '') + (meet_passcode ? `\nPasscode: ${meet_passcode}` : '')
    const role = cand?.designation ? ` for the ${cand.designation} role` : ''
    const panelNames = panelIds.map(id => (empById.get(id) as any)?.full_name).filter(Boolean)
    const tasks: Promise<any>[] = []
    if (cand?.email) {
      tasks.push(t.sendMail({
        from, to: cand.email, subject: `Interview scheduled — ${round}`,
        text: `Dear ${cand.full_name || 'Candidate'},\n\nYour ${round} interview${role} is scheduled for ${when}.${linkLine}\n\nPlease join on time. All the best.\n\n${schedName}`,
      }).then(() => { emailed++ }).catch(() => null))
    }
    for (const id of ids) {
      const e: any = empById.get(id); const to = empEmail(e)
      if (!to) continue
      const isMain = id === mainId
      const who = isMain
        ? `You are the MAIN interviewer${panelNames.length ? ` (panel: ${panelNames.join(', ')})` : ''}. Please acknowledge in ESS → Tasks & Approvals and record your feedback after the interview.`
        : `You've been added as a PANELIST. Main interviewer: ${mainEmp?.full_name || '—'}. Please acknowledge in ESS → Tasks & Approvals.`
      tasks.push(t.sendMail({
        from, to, subject: `Interview to conduct — ${cand?.full_name || 'Candidate'} (${round})`,
        text: `Hi ${e.full_name || ''},\n\n${cand?.full_name || 'A candidate'} — ${round} round, scheduled for ${when}.${linkLine}\n\n${who}\n\n${schedName}`,
      }).then(() => { emailed++ }).catch(() => null))
    }
    await Promise.all(tasks)
  } else {
    emailSkipped = 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD) — invites and ESS tasks were still created.'
  }

  return NextResponse.json({ ok: true, invited: ins.data?.length || 0, main: mainEmp?.full_name || null, panelists: panelIds.length, emailed, emailSkipped })
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
  try { stage = await applyInterviewDecision(sb as any, candidate_id, round, feedback.decision, roundOrdinal(rounds, round)) }
  catch (e: any) { return bad(e.message || 'Could not update the candidate', 500) }
  return NextResponse.json({ ok: true, id: ins.data?.[0]?.id, decision: feedback.decision, stage })
}

// The hiring manager rejects a candidate, at any round, with a mandatory reason and
// remark. Both are checked HERE rather than only in the dialog: a disabled button is
// not an enforcement point, which is the lesson mrf-assignment-rule.test.ts exists to
// record.
//
// Rejecting is allowed from any stage the funnel owns. It deliberately does NOT touch a
// candidate the offer flow already owns ('Offer Sent' / 'Joined') — those have their own
// backout path, which blacklists the candidate and reopens the requisition, and none of
// that would happen here.
//
// A rejection FREES the requisition's opening, because occupiesSlot() does not count
// 'Rejected'. That is intended: the cap is about who is in play.
async function rejectCandidate(body: any, actorEmployeeId: string | null) {
  const { candidate_id, reason, remark } = body
  if (!candidate_id) return bad('candidate_id is required')

  const check = validateRejection({ reason, remark })
  if (!check.ok) return bad(check.reason as string)

  const { data: cand } = await sb.from('candidates')
    .select('stage, mrf_id, company_id, full_name').eq('id', candidate_id).maybeSingle()
  if (!cand) return bad('Candidate not found', 404)
  const stage = String((cand as any).stage || '')
  if (stage === 'Rejected') return bad('This candidate is already rejected')
  if (['Offer Sent', 'Joined'].includes(stage)) {
    return bad(`This candidate is ${stage}. Use the offer backout flow, which also reopens the requisition.`)
  }

  const patch: Record<string, unknown> = {
    stage: 'Rejected',
    rejection_reason: reason,
    rejection_remark: normaliseRemark(remark),
    rejected_at: new Date().toISOString(),
    rejected_by: actorEmployeeId || null,
  }
  let up = await sb.from('candidates').update(patch).eq('id', candidate_id)
  // Tolerate a database without migration 143: the rejection itself still lands,
  // because losing the stage change would be worse than losing the reason. The
  // reason is never lost outright — the audit row below carries it either way.
  if (up.error && (up.error.code === '42703' || up.error.code === 'PGRST204')) {
    up = await sb.from('candidates').update({ stage: 'Rejected' }).eq('id', candidate_id)
  }
  if (up.error) return bad(up.error.message, 500)

  await sb.from('recruitment_audit_logs').insert({
    candidate_id,
    mrf_id: (cand as any).mrf_id || null,
    company_id: (cand as any).company_id || null,
    action_type: 'CANDIDATE_REJECTED',
    details: {
      name: (cand as any).full_name || null,
      from_stage: stage,
      reason, reason_label: rejectionLabel(reason as string),
      remark: normaliseRemark(remark),
    },
    created_at: new Date().toISOString(),
  }).then(() => null, () => null)   // the audit row must never fail the rejection

  return NextResponse.json({ ok: true, stage: 'Rejected', from_stage: stage })
}

// Final Shortlist: allowed once ≥3 rounds have been CLEARED — decided SHORTLIST by
// their main interviewer — and the requisition still has an opening free.
//
// CLEARED, NOT MERELY DECIDED. This counted any recorded decision, so a round decided
// Hold counted toward the three and a candidate sitting on Hold could still be
// shortlisted. A round is now cleared only when its decision is SHORTLIST; Hold and
// Reject do not count. A Reject ends the pipeline anyway (applyInterviewDecision moves
// the candidate to Rejected), so in practice this rule bites on Hold.
//
// A held round cannot be re-decided — both feedback paths return 409 once a round is
// submitted — so a Hold permanently costs a round, and the hiring manager recovers by
// adding another one. That is why canAddRound still permits a new round after a Hold.
//
// THIS IS THE ONLY WRITE OF 'Shortlisted' THE FUNNEL MAKES. The pipeline's manual stage
// picker used to update the column itself, checking nothing but STAGES order — so one
// Telephonic round was enough. It posts here instead, which is why both rules live in
// one place. The cap especially has to be server-side: two recruiters shortlisting at
// the same moment both pass any check made in a browser.
async function finalShortlist(body: any) {
  const { candidate_id } = body
  if (!candidate_id) return bad('candidate_id is required')
  const { data } = await sb.from('interview_invites').select('*')   // '*' — tolerant of a DB without migration 131
    .eq('candidate_id', candidate_id).order('created_at', { ascending: true })
  const rows = ((data || []) as any[]).filter(r => (r.role || 'MAIN') === 'MAIN' && r.status === 'submitted')
  const decisionOf = (r: any) => r.decision || r.feedback?.decision
  const cleared = distinctRounds(rows.filter(r => decisionOf(r) === 'SHORTLIST'))
  const last = rows[rows.length - 1]
  const lastDecision = decisionOf(last || {})
  if (lastDecision === 'REJECT') return bad('The latest round rejected this candidate')

  // The candidate's row carries the requisition; the cap needs both.
  const { data: cand } = await sb.from('candidates').select('stage, mrf_id').eq('id', candidate_id).maybeSingle()
  const mrfId = (cand as any)?.mrf_id || null
  let openings = 1
  let used = 0
  if (mrfId) {
    const [{ data: mrf }, { data: peers }] = await Promise.all([
      sb.from('manpower_requisitions').select('no_of_openings, openings').eq('id', mrfId).maybeSingle(),
      sb.from('candidates').select('id, mrf_id, stage').eq('mrf_id', mrfId).in('stage', [...SLOT_STAGES]),
    ])
    openings = openingsOf(mrf as any)
    // exceptId is this candidate. One sent back from the offer flow for a revision
    // still reads 'Shortlisted', and counting them would refuse them their own slot.
    used = slotsUsed((peers || []) as any[], mrfId, candidate_id)
  }

  const gate = canShortlist({
    currentStage: String((cand as any)?.stage || ''),
    clearedRounds: cleared.length,
    openings,
    slotsUsed: used,
  })
  if (!gate.ok) return bad(gate.reason as string)

  const { error } = await sb.from('candidates').update({ stage: 'Shortlisted' }).eq('id', candidate_id)
  if (error) return bad(error.message, 500)
  return NextResponse.json({ ok: true, stage: 'Shortlisted', rounds: cleared.length })
}
