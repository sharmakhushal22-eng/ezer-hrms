// src/features/performance/actions.ts — every write the website's Performance
// section makes (components/ess/Performance.tsx), copied call for call: same
// tables, columns, RPCs (pms_chain_submit / _approve / _reject, pms_lock_kras,
// pms_finalise), same order, and the same sentence shown afterwards. Each
// function returns that sentence (the website's setMsg) — the screen shows it.
import { supabase } from '@/core/supabase'
import { diffKras, type Kra, type KraChange } from '@web/pms/kra'
import type { Log } from '@web/pms/oneToOne'
import type { TeamMember } from '@web/pms/team'
import { rungFor } from '@web/pms/chain'
import { WORKFLOW } from '@web/pms/status'
import { MISSING_TABLE, type FeedbackDraft, type RateRow } from './data'

export const NO_COMPANY =
  'We could not tell which company your record belongs to, so this was not sent. Ask HR to check your employee record.'
export const SAVE_FAILED = (what: string) =>
  `Your ${what} could not be saved. Nothing was lost — try again, and tell HR if it keeps happening.`
const FINAL_REVIEW_LOGGED =
  'Final review logged and acknowledged by you. They acknowledge it from their own One-to-One Log, and then the rating can be settled.'
const now = () => new Date().toISOString()
const blocked = (d: unknown) => typeof d === 'string' && d.startsWith('BLOCKED')
const why = (d: unknown) => String(d).replace(/^BLOCKED:\s*/, '')

/** The employee's rating of one KRA while they write it, keyed by seq_no. */
export interface KraSelf { achievement: string; rating: number | null; comment: string }
export interface SelfRow {
  goalId: string; title: string; weightage: number; category: Kra['category']
  achievement: string; rating: number | null; comment: string
}

// ── the employee's own side ──────────────────────────────────────────────

/** §3's merged step: KRAs + self rating, change log, then into the chain. */
export async function submitKras(o: {
  employeeId: string; periodId: string; companyId: string | null
  goals: Record<string, unknown>[]; kras: Kra[]; self: Record<number, KraSelf>
}): Promise<{ ok: boolean; msg: string }> {
  const { employeeId, periodId, companyId, goals, kras, self } = o
  if (!companyId) return { ok: false, msg: NO_COMPANY }

  const ack = await supabase.from('pms_one_to_one').select('employee_ack,manager_ack')
    .eq('employee_id', employeeId).eq('period_id', periodId).eq('discussion_type', 'KRA_SETTING')
  const acknowledged = ((ack.data ?? []) as { employee_ack?: boolean; manager_ack?: boolean }[]).some(r => r.employee_ack || r.manager_ack)
  // Once locked, this submission is the rating only — never re-upsert (it would unlock the set).
  const kraLocked = goals.length > 0 && goals.every(g => String(g.status) === 'LOCKED')

  let changes: KraChange[] = []
  if (acknowledged && !kraLocked) {
    const before = await supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage')
      .eq('employee_id', employeeId).eq('period_id', periodId)
    changes = diffKras((before.data ?? []) as unknown as Parameters<typeof diffKras>[0], kras as unknown as Parameters<typeof diffKras>[1])
  }

  const { error } = kraLocked ? { error: null } : await supabase.from('pms_employee_goals').upsert(
    kras.map(k => ({
      company_id: companyId, employee_id: employeeId, period_id: periodId,
      seq_no: k.seq_no, kra_title: k.kra_title, kpi_metric: k.kpi_metric,
      target_value: k.target_value, category: k.category, weightage: k.weightage,
      source: k.source ?? 'MANUAL', carried_from_period_id: k.carried_from_period_id ?? null,
      status: 'PENDING_RM_APPROVAL',
    })),
    { onConflict: 'period_id,employee_id,seq_no' })
  if (!error && !kraLocked && kras.length) {
    await supabase.from('pms_employee_goals').delete()
      .eq('employee_id', employeeId).eq('period_id', periodId).gt('seq_no', kras.length).neq('status', 'LOCKED')
  }

  let ratingWarning = ''
  let ratedCount = 0
  if (!error) {
    const saved = await supabase.from('pms_employee_goals').select('id,seq_no').eq('employee_id', employeeId).eq('period_id', periodId)
    const idBySeq = new Map(((saved.data ?? []) as { id: string; seq_no: number }[]).map(g => [Number(g.seq_no), String(g.id)]))
    const rated = kras.map(k => ({ k, sr: self[k.seq_no], goalId: idBySeq.get(k.seq_no) }))
      .filter(x => x.goalId && x.sr && x.sr.rating !== null)
    ratedCount = rated.length
    if (rated.length) {
      const rv = await supabase.from('pms_reviews').upsert(
        rated.map(({ sr, goalId }) => ({
          company_id: companyId, period_id: periodId, employee_id: employeeId,
          goal_id: goalId, rater_id: employeeId, rater_role: 'SELF',
          achievement_value: sr!.achievement || null, rating: sr!.rating,
          comments: sr!.comment || null, submitted: true, submitted_at: now(),
        })),
        { onConflict: 'period_id,employee_id,goal_id,rater_role' })
      if (rv.error) ratingWarning = ' Your ratings did not save, though — send it again.'
    }
  }

  let logWarning = ''
  if (!error && changes.length) {
    const audit = await supabase.from('pms_audit_log').insert(changes.map(c => ({
      period_id: periodId, employee_id: employeeId, table_name: 'pms_employee_goals', record_id: c.record_id,
      action: c.action, old_value: c.old_value, new_value: c.new_value, actor_id: employeeId, actor_role: 'EMPLOYEE',
    })))
    if (audit.error) logWarning = ' The change log could not be written, though — tell HR.'
  }

  let chainWarning = ''
  if (!error && ratedCount && !ratingWarning) {
    const ch = await supabase.rpc('pms_chain_submit', { p_employee_id: employeeId, p_period_id: periodId })
    if (ch.error) chainWarning = ' It is saved, but could not be sent on for approval — try again.'
    else if (blocked(ch.data)) chainWarning = ' It is saved, but not sent on yet — ' + why(ch.data)
  }

  if (error) {
    return { ok: false, msg: (error as { code?: string }).code === MISSING_TABLE
      ? 'The performance module is not live yet: migration 066 has not been applied.' : SAVE_FAILED('KRAs') }
  }
  return {
    ok: true,
    msg: [
      kraLocked ? 'Your ratings are in with your manager.' : 'Sent to your reporting manager.',
      ratedCount && !kraLocked ? `${ratedCount} ${ratedCount === 1 ? 'rating' : 'ratings'} went with it.` : '',
      changes.length ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} recorded against the one-to-one.` : '',
      ratingWarning, logWarning, chainWarning,
    ].filter(Boolean).join(' '),
  }
}

/** The separate Self Rating tab — same event, enters the chain the same way. */
export async function submitSelf(employeeId: string, periodId: string, companyId: string | null, rows: SelfRow[]): Promise<{ ok: boolean; msg: string }> {
  if (!companyId) return { ok: false, msg: NO_COMPANY }
  const { error } = await supabase.from('pms_reviews').upsert(rows.map(r => ({
    company_id: companyId, period_id: periodId, employee_id: employeeId, goal_id: r.goalId,
    rater_id: employeeId, rater_role: 'SELF', achievement_value: r.achievement || null, rating: r.rating,
    comments: r.comment || null, submitted: true, submitted_at: now(),
  })), { onConflict: 'period_id,employee_id,goal_id,rater_role' })
  if (error) return { ok: false, msg: SAVE_FAILED('self rating') }
  const ch = await supabase.rpc('pms_chain_submit', { p_employee_id: employeeId, p_period_id: periodId })
  if (ch.error) return { ok: true, msg: 'Your ratings are saved, but could not be sent on for approval — try again.' }
  if (blocked(ch.data)) return { ok: true, msg: 'Your ratings are saved, but not sent on yet — ' + why(ch.data) }
  return { ok: true, msg: 'Your ratings are in with your manager.' }
}

export async function logDiscussion(o: { employeeId: string; periodId: string; companyId: string | null; managerId: string | null; l: Log }): Promise<{ ok: boolean; msg: string | null }> {
  if (!o.companyId) return { ok: false, msg: NO_COMPANY }
  if (!o.managerId) {
    return { ok: false, msg: 'Your record does not say who your reporting manager is, and a one-to-one is a record of two people. Ask HR to set your manager, then log it again.' }
  }
  const { error } = await supabase.from('pms_one_to_one').insert({
    company_id: o.companyId, manager_id: o.managerId, period_id: o.periodId, employee_id: o.employeeId,
    discussion_type: o.l.discussion_type, discussion_date: o.l.discussion_date, mode: o.l.mode,
    discussion_points: o.l.discussion_points,
    duration_minutes: o.l.duration_minutes ?? null, weightage_changes: o.l.weightage_changes ?? null,
    employee_ack: true, employee_ack_at: now(),
  })
  return error ? { ok: false, msg: SAVE_FAILED('discussion') } : { ok: true, msg: null }
}

/** The employee's half of a discussion somebody else logged — by row id. */
export async function acknowledgeDiscussion(employeeId: string, logId: string): Promise<{ ok: boolean; msg: string }> {
  const { error } = await supabase.from('pms_one_to_one').update({ employee_ack: true, employee_ack_at: now() })
    .eq('id', logId).eq('employee_id', employeeId)
  return error ? { ok: false, msg: SAVE_FAILED('acknowledgement') } : { ok: true, msg: 'Acknowledged.' }
}

/** §3.5's last rung: the employee acknowledges a published result. */
export async function acknowledgeResult(employeeId: string, periodId: string): Promise<{ ok: boolean; msg: string | null }> {
  const { error } = await supabase.from('pms_overall_rating')
    .update({ employee_ack: true, employee_ack_at: now(), workflow_status: WORKFLOW.ACKNOWLEDGED })
    .eq('employee_id', employeeId).eq('period_id', periodId)
  return error ? { ok: false, msg: SAVE_FAILED('acknowledgement') } : { ok: true, msg: null }
}

// ── the manager's side ───────────────────────────────────────────────────

/** Tick the manager's half of the KRA one-to-one, then ask pms_lock_kras. */
export async function acknowledgeAndLock(managerId: string, id: string, periodId: string): Promise<string> {
  const ack = await supabase.from('pms_one_to_one').update({ manager_ack: true, manager_ack_at: now() })
    .eq('employee_id', id).eq('period_id', periodId).eq('discussion_type', 'KRA_SETTING').select('id')
  if (ack.error) return SAVE_FAILED('acknowledgement')
  if (!ack.data?.length) return 'There is no KRA-setting discussion logged for them yet, so there is nothing to acknowledge. They log it from their own Performance screen.'
  const lock = await supabase.rpc('pms_lock_kras', { p_employee_id: id, p_period_id: periodId, p_manager_id: managerId })
  if (lock.error) return 'Acknowledged, but the weightages could not be locked. Try again, and tell HR if it keeps happening.'
  if (blocked(lock.data)) return `Acknowledged, but not locked yet — ${why(lock.data)}.`
  return 'Acknowledged, and their weightages are locked.'
}

/** Create the FINAL_REVIEW one-to-one from the manager's / HOD's side (website insertFinalReview). */
export async function logFinalReview(o: { companyId: string | null; periodId: string; employeeId: string; managerId: string; today: string; points: string }): Promise<string> {
  if (!o.companyId) return NO_COMPANY
  const existing = await supabase.from('pms_one_to_one').select('id').eq('employee_id', o.employeeId).eq('period_id', o.periodId)
    .eq('discussion_type', 'FINAL_REVIEW').limit(1)
  if (existing.data?.length) return 'A final review is already logged for them. Acknowledge that one instead.'
  const { error } = await supabase.from('pms_one_to_one').insert({
    company_id: o.companyId, manager_id: o.managerId, period_id: o.periodId, employee_id: o.employeeId,
    discussion_type: 'FINAL_REVIEW', discussion_date: o.today, mode: 'IN_PERSON',
    discussion_points: o.points.trim() || 'Final review discussion held.',
    manager_ack: true, manager_ack_at: now(),
  })
  return error ? SAVE_FAILED('final review') : FINAL_REVIEW_LOGGED
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

/** Approve and pass it up — or, at the last rung, finalise (pms_chain_approve). */
export async function approveInChain(viewerId: string, member: TeamMember | undefined, id: string, periodId: string, rating?: number): Promise<string> {
  const myRung = member ? rungFor(member, viewerId) : null
  if (!myRung) return 'You are not recorded in this employee’s chain for this period, so you cannot approve it.'
  const r = await supabase.rpc('pms_chain_approve', {
    p_employee_id: id, p_period_id: periodId, p_actor_id: viewerId, p_actor_role: myRung, p_rating: rating ?? null,
  })
  if (r.error) return SAVE_FAILED('approval')
  const out = String(r.data ?? '')
  if (out.startsWith('BLOCKED')) return out.replace(/^BLOCKED:\s*/, 'Not approved — ')
  const next = out.split(':')[1]
  return next === 'HR' ? 'Approved and settled. It is with HR to publish now.' : `Approved. It is with ${String(next).replace('_', ' ')} now.`
}

/** The manager's per-KRA rating (rater_role from the frozen chain) + the RM overall comment. */
export async function submitRating(o: {
  viewerId: string; member: TeamMember | null; periodId: string; companyId: string | null
  rows: RateRow[]; overall: string
}): Promise<{ ok: boolean; msg: string }> {
  const { viewerId, member, periodId, companyId, rows, overall } = o
  if (!member) return { ok: false, msg: '' }
  const myRaterRole = member.rmL1Id && member.rmL1Id === viewerId ? 'RM_L1' : member.rmL2Id && member.rmL2Id === viewerId ? 'RM_L2' : null
  if (!myRaterRole) {
    return { ok: false, msg: 'This period’s chain does not record you as either of their managers, so your rating has nowhere to go. Ask HR to check the chain for this period.' }
  }
  if (!companyId) return { ok: false, msg: NO_COMPANY }
  if (member.finalised) {
    return { ok: false, msg: 'Their rating has already been finalised, so it cannot be changed here. If it is wrong, ask HR to reopen the period — that keeps a record of why it changed.' }
  }
  if (!rows.length) return { ok: false, msg: 'Their KRAs have not loaded, so there is nothing to rate yet.' }
  const unrated = rows.filter(r => r.myRating == null)
  if (unrated.length) return { ok: false, msg: `${unrated.length} of ${rows.length} KRAs still have no rating from you. Rate every one before you send it.` }
  const { error } = await supabase.from('pms_reviews').upsert(rows.map(r => ({
    company_id: companyId, period_id: periodId, employee_id: member.employeeId, goal_id: r.goalId,
    rater_id: viewerId, rater_role: myRaterRole, achievement_value: r.achievement || null, rating: r.myRating,
    comments: r.myComment || null, submitted: true, submitted_at: now(),
  })), { onConflict: 'period_id,employee_id,goal_id,rater_role' })
  if (error) return { ok: false, msg: SAVE_FAILED('rating') }
  if (overall.trim()) {
    const fb = await supabase.from('pms_feedback').upsert({
      company_id: companyId, period_id: periodId, employee_id: member.employeeId,
      rm_overall_comment: overall.trim(), rm_overall_by: viewerId, given_by_role: myRaterRole, visible_to_employee: false,
    }, { onConflict: 'period_id,employee_id' })
    if (fb.error) return { ok: false, msg: 'The ratings were saved, but your overall comment was not. Try sending it again.' }
  }
  return { ok: true, msg: 'Your rating has been sent.' }
}

// ── the HOD's side ───────────────────────────────────────────────────────

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
