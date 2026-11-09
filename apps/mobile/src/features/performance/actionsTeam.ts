// src/features/performance/actionsTeam.ts — the manager's and HOD's writes
// (website: components/ess/Performance.tsx TeamSide / DeptSide handlers),
// copied call for call: same tables, columns, conflict keys, RPCs
// (pms_lock_kras, pms_chain_approve, pms_chain_reject, pms_finalise), the
// same order, and the same sentence shown afterwards.
import { supabase } from '@/core/supabase'
import { api, ApiError } from '@/core/api'
import type { TeamMember } from '@web/pms/team'
import { rungFor } from '@web/pms/chain'
import { compareRatings } from '@web/pms/scoring'
import { filled, RECOGNITION_LABEL, type PipIntent, type RecognitionIntent } from '@web/pms/training'
import type { BinSuggestion, RatingContext } from '@web/pms/trainingAi'
import { blocked, NO_COMPANY, now, recordOneToOne, SAVE_FAILED, why } from './actions'
import { measuresOf, type KraLine, type Rate, type TrainingDraft } from './logic'
import type { FeedbackDraft } from './dataTeam'

export const FINAL_REVIEW_LOGGED =
  'Final review confirmed and recorded against your name. The rating can be settled now; publishing it waits on the employee confirming the conversation too.'
const NOT_IN_CHAIN = 'You are not recorded in this employee’s chain for this period, so you cannot approve it.'

// ── KRA Approval & One-to-One ────────────────────────────────────────────

/** RM L1's tick through the shared recorder, then the lock. */
export async function acknowledgeAndLock(o: { managerId: string; id: string; periodId: string; companyId: string | null; today: string }): Promise<string> {
  if (!o.companyId) return NO_COMPANY
  const rec = await recordOneToOne({ companyId: o.companyId, periodId: o.periodId, employeeId: o.id, managerId: o.managerId, stage: 'RM_L1', today: o.today })
  if (rec === 'ERROR') return SAVE_FAILED('acknowledgement')
  const lock = await supabase.rpc('pms_lock_kras', { p_employee_id: o.id, p_period_id: o.periodId, p_manager_id: o.managerId })
  if (lock.error) return 'Acknowledged, but the weightages could not be locked. Try again, and tell HR if it keeps happening.'
  if (blocked(lock.data)) return `Acknowledged, but not locked yet — ${why(lock.data)}.`
  return 'Acknowledged, and their weightages are locked.'
}

/** The manager's tick on an existing FINAL_REVIEW. `side` picks the website's wording. */
export async function acknowledgeFinalReview(id: string, periodId: string, side: 'rm' | 'hod'): Promise<string> {
  const ack = await supabase.from('pms_one_to_one').update({ manager_ack: true, manager_ack_at: now() })
    .eq('employee_id', id).eq('period_id', periodId).eq('discussion_type', 'FINAL_REVIEW').select('id')
  if (ack.error) return SAVE_FAILED('acknowledgement')
  if (!ack.data?.length) {
    return side === 'hod'
      ? 'There is no final review logged for them yet. Use “Log final review” on that row.'
      : 'There is no final review discussion logged for them yet. Log it yourself from the Review & Finalise tab, or ask them to log it from their One-to-One Log.'
  }
  return side === 'hod'
    ? 'Acknowledged. Once they acknowledge it too, you can settle the rating.'
    : 'Final review acknowledged. Once they have acknowledged it too, the rating can be settled.'
}

/** Reject one rung back (pms_chain_reject), or the pre-197 direct send-back for a row with no stage. */
export async function sendBack(viewerId: string, member: TeamMember | undefined, id: string, periodId: string, reason: string): Promise<string> {
  const myRung = member ? rungFor(member, viewerId) : null
  if (member?.chainStage && myRung) {
    const r = await supabase.rpc('pms_chain_reject', {
      p_employee_id: id, p_period_id: periodId, p_actor_id: viewerId, p_actor_role: myRung, p_remark: reason,
    })
    if (r.error) return SAVE_FAILED('rejection')
    const out = String(r.data ?? '')
    if (out.startsWith('BLOCKED')) return out.replace(/^BLOCKED:\s*/, 'Not sent back — ')
    const to = out.split(':')[1]
    return to === 'EMPLOYEE' ? 'Sent back to the employee, with your reason.' : `Sent back to ${String(to).replace('_', ' ')}, with your reason.`
  }
  const { error } = await supabase.from('pms_employee_goals').update({ status: 'SENT_BACK', sent_back_reason: reason })
    .eq('employee_id', id).eq('period_id', periodId)
  return error ? SAVE_FAILED('note') : 'Sent back, with your reason.'
}

/** The tick, then pms_chain_approve — which locks at the first rung and finalises at the last. */
export async function approveInChain(o: { viewerId: string; member: TeamMember | undefined; periodId: string; companyId: string | null; today: string; rating?: number }): Promise<string> {
  const myRung = o.member ? rungFor(o.member, o.viewerId) : null
  if (!myRung || !o.member) return NOT_IN_CHAIN
  if (!o.companyId) return NO_COMPANY
  const id = o.member.employeeId
  const rec = await recordOneToOne({ companyId: o.companyId, periodId: o.periodId, employeeId: id, managerId: o.viewerId, stage: myRung, today: o.today })
  if (rec === 'ERROR') return 'The one-to-one could not be recorded, so nothing was approved. Try again.'
  const r = await supabase.rpc('pms_chain_approve', {
    p_employee_id: id, p_period_id: o.periodId, p_actor_id: o.viewerId, p_actor_role: myRung, p_rating: o.rating ?? null,
  })
  if (r.error) return SAVE_FAILED('approval')
  const out = String(r.data ?? '')
  if (out.startsWith('BLOCKED')) return out.replace(/^BLOCKED:\s*/, 'Not approved — ')
  const next = out.split(':')[1]
  return next === 'HR' ? 'Approved and settled. It is with HR to publish now.' : `Approved. It is with ${String(next).replace('_', ' ')} now.`
}

/**
 * RATE, CONFIRM AND APPROVE — one act, in this order: every measure's rating,
 * the overall comment, the training suggestions, the PIP request, the
 * recognition proposal, then the tick and the approval. A failure at any step
 * stops the next. `closed` says whether the website would close the panel.
 */
export async function rateAndApprove(o: {
  viewerId: string; member: TeamMember | undefined; periodId: string; companyId: string | null; today: string
  lines: KraLine[] | null; rate: Rate; overall: string; training: TrainingDraft[]; pip: PipIntent; recog: RecognitionIntent
  finalRating?: number
}): Promise<{ msg: string; closed: boolean }> {
  const { viewerId, member, periodId, companyId } = o
  const myRung = member ? rungFor(member, viewerId) : null
  if (!myRung || !member) return { msg: NOT_IN_CHAIN, closed: false }
  if (!companyId) return { msg: NO_COMPANY, closed: false }
  const id = member.employeeId
  const measures = measuresOf(o.lines)
  const missing = measures.filter(m => o.rate[m.kpi.kpiId]?.rating == null)
  if (!measures.length || missing.length) {
    return { closed: false, msg: measures.length
      ? `Rate every measure before sending it on — ${missing.length} of ${measures.length} still have no rating from you.`
      : 'There is nothing to rate: none of their KRAs has a measure under it.' }
  }
  const cmpNow = compareRatings(measures.map(({ kra, kpi }) => ({
    goalId: kpi.kpiId, title: `${kra.seqNo}. ${kra.title || 'untitled'} · ${kpi.metric}`, weightage: kpi.share,
    self: kpi.selfRating ?? null, mine: o.rate[kpi.kpiId]?.rating ?? null, comment: o.rate[kpi.kpiId]?.comment ?? null,
  })))
  if (cmpNow.missingReasons.length) {
    return { closed: false, msg: 'Say why where your rating differs from theirs — '
      + `${cmpNow.missingReasons.length} still unexplained: ` + cmpNow.missingReasons.map(m => m.title).join(', ') + '.' }
  }

  const rv = await supabase.from('pms_reviews').upsert(measures.map(({ kra, kpi }) => ({
    company_id: companyId, period_id: periodId, employee_id: id, goal_id: kra.goalId, kpi_id: kpi.kpiId,
    rater_id: viewerId, rater_role: myRung, rating: o.rate[kpi.kpiId]!.rating, comments: o.rate[kpi.kpiId]!.comment || null,
    submitted: true, submitted_at: now(),
  })), { onConflict: 'period_id,employee_id,kpi_id,rater_role' })
  if (rv.error) return { msg: SAVE_FAILED('rating'), closed: false }

  // The RM's half of pms_feedback, held back until the result is published.
  if (o.overall.trim()) {
    const fb = await supabase.from('pms_feedback').upsert({
      company_id: companyId, period_id: periodId, employee_id: id,
      rm_overall_comment: o.overall.trim(), rm_overall_by: viewerId, given_by_role: myRung, visible_to_employee: false,
    }, { onConflict: 'period_id,employee_id' })
    if (fb.error) return { msg: 'The ratings were saved, but your overall comment was not. Try sending it again.', closed: false }
  }
  const rows = filled(o.training)
  if (rows.length) {
    const tr = await supabase.from('pms_training_recommendation').upsert(rows.map(r => ({
      company_id: companyId, period_id: periodId, employee_id: id, recommended_by: viewerId, recommended_by_role: myRung,
      kind: 'TRAINING' as const, training_name: r.trainingName.trim(), category: r.category, details: r.details.trim() || null,
    })), { onConflict: 'period_id,employee_id,recommended_by,kind,training_name' })
    if (tr.error) return { msg: 'The ratings were saved, but your training suggestion was not. Try sending it again.', closed: false }
  }
  if (o.pip.wanted) {
    // A real request in HR's queue: REQUESTED / PENDING_HR. Nothing here starts a plan.
    const p = await supabase.from('pms_pip').insert({
      company_id: companyId, period_id: periodId, employee_id: id, requested_by: viewerId, requested_by_role: myRung,
      trigger_rating: cmpNow.myScore, request_reason: o.pip.reason.trim(),
      proposed_start: o.pip.proposedStart, proposed_end: o.pip.proposedEnd, hr_status: 'PENDING_HR', status: 'REQUESTED',
    })
    if (p.error) return { msg: 'The ratings were saved, but the PIP request was not. Try sending it again.', closed: false }
  }
  if (o.recog.wanted) {
    const rc = await supabase.from('pms_training_recommendation').upsert({
      company_id: companyId, period_id: periodId, employee_id: id, recommended_by: viewerId, recommended_by_role: myRung,
      kind: 'RECOGNITION', training_name: RECOGNITION_LABEL[o.recog.kind], category: 'OTHER', details: o.recog.note.trim(),
    }, { onConflict: 'period_id,employee_id,recommended_by,kind,training_name' })
    if (rc.error) return { msg: 'The ratings were saved, but the recognition proposal was not. Try sending it again.', closed: false }
  }
  const msg = await approveInChain({ viewerId, member, periodId, companyId, today: o.today, rating: o.finalRating })
  return { msg, closed: true }
}

// ── the AI suggestion bin ────────────────────────────────────────────────

/** POST /api/pms/training-ai with what is on screen. The route strips the name before any prompt. */
export async function askForTraining(o: { periodId: string; employeeId: string; companyId: string | null; context: RatingContext }): Promise<{ suggestions: BinSuggestion[] | null; note: string | null }> {
  try {
    const j = await api<{ suggestions?: BinSuggestion[]; message?: string }>('/api/pms/training-ai', {
      method: 'POST', body: { periodId: o.periodId, employeeId: o.employeeId, companyId: o.companyId, context: o.context },
    })
    const got = j?.suggestions ?? []
    return { suggestions: got, note: got.length ? null : (j?.message ?? 'Nothing came back this time.') }
  } catch (e) {
    // The route explains itself (a missing key, an empty catalogue): its sentence is shown as it is.
    if (e instanceof ApiError && e.status) return { suggestions: null, note: (e.body as { message?: string } | null)?.message ?? 'Suggestions are unavailable just now.' }
    return { suggestions: null, note: 'Could not reach the server for suggestions.' }
  }
}

/** Throwing one away sticks: DISMISSED with who and when, or without them before 216. */
export async function dismissSuggestion(viewerId: string, sugId: string | undefined): Promise<void> {
  if (!sugId) return
  const stamped = await supabase.from('pms_training_suggestion').update({ status: 'DISMISSED', status_by: viewerId, status_at: now() }).eq('id', sugId)
  if (stamped.error) await supabase.from('pms_training_suggestion').update({ status: 'DISMISSED' }).eq('id', sugId)
}

// ── the HOD's side ───────────────────────────────────────────────────────

/** "Log final review" — the HOD's tick through the shared recorder. */
export async function logFinalReview(o: { companyId: string | null; periodId: string; employeeId: string; managerId: string; today: string }): Promise<string> {
  if (!o.companyId) return NO_COMPANY
  const r = await recordOneToOne({ companyId: o.companyId, periodId: o.periodId, employeeId: o.employeeId, managerId: o.managerId, stage: 'HOD', today: o.today })
  return r === 'RECORDED' ? FINAL_REVIEW_LOGGED : r === 'ALREADY' ? 'You have already confirmed the final review for them.' : SAVE_FAILED('final review')
}

/** §5.1 — the HOD signs off (pms_finalise, role HOD from the frozen chain). */
export async function finalise(viewerId: string, id: string, periodId: string, rating: number): Promise<string> {
  const r = await supabase.rpc('pms_finalise', {
    p_employee_id: id, p_period_id: periodId, p_actor_id: viewerId, p_actor_role: 'HOD', p_rating: rating, p_reason: null,
  })
  if (r.error) return SAVE_FAILED('final rating')
  if (blocked(r.data)) return `Not finalised — ${why(r.data)}`
  return 'Finalised. Their rating is settled for this period.'
}

/** §5.2 — feedback (visible) → recognition (delete + insert) → PUBLISHED / chain DONE. */
export async function publishResult(o: { viewerId: string; companyId: string | null; periodId: string; member: TeamMember; draft: FeedbackDraft }): Promise<string> {
  const { viewerId, companyId, periodId, member, draft } = o
  if (!companyId) return NO_COMPANY
  const fb = await supabase.from('pms_feedback').upsert({
    company_id: companyId, period_id: periodId, employee_id: member.employeeId,
    appreciation_remark: draft.appreciation.trim() || null, improvement_feedback: draft.improvement.trim() || null,
    given_by: viewerId, given_by_role: 'HOD', visible_to_employee: true,
  }, { onConflict: 'period_id,employee_id' })
  if (fb.error) return SAVE_FAILED('feedback')
  const kept = draft.benefits.filter(b => b.note.trim())
  await supabase.from('pms_additional_benefits').delete().eq('period_id', periodId).eq('employee_id', member.employeeId)
  if (kept.length) {
    const ben = await supabase.from('pms_additional_benefits').insert(kept.map(b => ({
      company_id: companyId, period_id: periodId, employee_id: member.employeeId,
      benefit_type: b.type, benefit_note: b.note.trim(), awarded_by: viewerId,
    })))
    if (ben.error) return 'The feedback saved, but the recognition rows did not. Add them again before telling them it is published.'
  }
  const st = await supabase.from('pms_overall_rating')
    .update({ workflow_status: 'PUBLISHED', published_at: now(), chain_stage: 'DONE' })
    .eq('employee_id', member.employeeId).eq('period_id', periodId)
  if (st.error) return 'The feedback saved but the result was not opened to them. Try publishing again.'
  return `Published. ${member.name} can see their rating and feedback now.`
}
