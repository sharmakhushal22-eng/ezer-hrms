// src/features/performance/actions.ts — the employee's writes, and the
// one-to-one recorder every side shares (website: components/ess/Performance.tsx
// MySide handlers and recordOneToOne), copied call for call: same tables,
// columns, conflict keys, RPCs and order, and the same sentence shown
// afterwards. Each function returns that sentence (the website's setMsg).
// The manager's and HOD's writes are in actionsTeam.ts.
import { supabase } from '@/core/supabase'
import { diffKras, type Kra, type KraChange } from '@web/pms/kra'
import { selfKey } from '@web/pms/kpi'
import { autoLogFor, type ConfirmStage, type Log } from '@web/pms/oneToOne'
import { WORKFLOW } from '@web/pms/status'
import { MISSING_TABLE } from './data'
import type { KraSelf, SelfRow } from './logic'

export const NO_COMPANY =
  'We could not tell which company your record belongs to, so this was not sent. Ask HR to check your employee record.'
export const SAVE_FAILED = (what: string) =>
  `Your ${what} could not be saved. Nothing was lost — try again, and tell HR if it keeps happening.`
export const now = () => new Date().toISOString()
export const blocked = (d: unknown) => typeof d === 'string' && d.startsWith('BLOCKED')
export const why = (d: unknown) => String(d).replace(/^BLOCKED:\s*/, '')

/**
 * Record the one-to-one for a stage, from a tick. Idempotent: an existing row
 * of that type gets this side's acknowledgement; otherwise one is inserted
 * with the stage's manager_role and the stated discussion points.
 */
export async function recordOneToOne(o: {
  companyId: string; periodId: string; employeeId: string
  /** The OTHER party. For the employee's own tick: the FROZEN RM L1. */
  managerId: string
  stage: ConfirmStage; today: string
}): Promise<'RECORDED' | 'ALREADY' | 'ERROR'> {
  const spec = autoLogFor(o.stage)
  const ackCol = spec.side === 'employee' ? 'employee_ack' : 'manager_ack'
  const atCol = spec.side === 'employee' ? 'employee_ack_at' : 'manager_ack_at'
  const existing = await supabase.from('pms_one_to_one').select(`id,${ackCol}`)
    .eq('employee_id', o.employeeId).eq('period_id', o.periodId).eq('discussion_type', spec.discussion_type).limit(1)
  if (existing.data?.length) {
    const row = existing.data[0] as unknown as Record<string, unknown>
    if (row[ackCol] === true) return 'ALREADY'
    const up = await supabase.from('pms_one_to_one').update({ [ackCol]: true, [atCol]: now() }).eq('id', String(row.id))
    return up.error ? 'ERROR' : 'RECORDED'
  }
  const ins = await supabase.from('pms_one_to_one').insert({
    company_id: o.companyId, period_id: o.periodId, employee_id: o.employeeId,
    manager_id: o.managerId, manager_role: spec.manager_role, discussion_type: spec.discussion_type,
    discussion_date: o.today, mode: 'IN_PERSON', discussion_points: spec.discussion_points,
    [ackCol]: true, [atCol]: now(),
  })
  return ins.error ? 'ERROR' : 'RECORDED'
}

// ── the employee's own side ──────────────────────────────────────────────

/** §3's merged step: KRAs → KPIs → self ratings (per KPI) → change log → the one-to-one tick → into the chain. */
export async function submitKras(o: {
  employeeId: string; periodId: string; companyId: string | null; managerId: string | null
  frozenRmL1: string | null; today: string
  goals: Record<string, unknown>[]; kras: Kra[]; self: Record<string, KraSelf>
  confirmOneToOne: boolean; oneToOneAlready: boolean
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

    // The KPIs, between the KRAs and the ratings (220): goal_id must exist first, kpi_id before any rating.
    if (!kraLocked) {
      const kpiRows = kras.flatMap(k => {
        const goalId = idBySeq.get(k.seq_no)
        if (!goalId) return []
        // 222: weightage is not named — the column is retired and keeps its DEFAULT 0.
        return (k.kpis ?? []).map(x => ({
          company_id: companyId, period_id: periodId, employee_id: employeeId,
          goal_id: goalId, seq_no: x.seq_no, kpi_metric: x.kpi_metric, target_value: x.target_value || null,
        }))
      })
      if (kpiRows.length) await supabase.from('pms_goal_kpi').upsert(kpiRows, { onConflict: 'goal_id,seq_no' })
      // A shorter KPI list leaves a tail, per KRA, removed after the write.
      for (const k of kras) {
        const goalId = idBySeq.get(k.seq_no)
        if (!goalId) continue
        await supabase.from('pms_goal_kpi').delete().eq('goal_id', goalId).gt('seq_no', (k.kpis ?? []).length)
      }
    }

    const savedKpis = await supabase.from('pms_goal_kpi').select('id,goal_id,seq_no').eq('employee_id', employeeId).eq('period_id', periodId)
    const kpiByGoalSeq = new Map(((savedKpis.data ?? []) as { id: string; goal_id: string; seq_no: number }[])
      .map(x => [`${x.goal_id}|${x.seq_no}`, String(x.id)]))
    const rated = kras.flatMap(k => {
      const goalId = idBySeq.get(k.seq_no)
      if (!goalId) return []
      return (k.kpis ?? []).map(x => ({ sr: self[selfKey(k.seq_no, x.seq_no)], goalId, kpiId: kpiByGoalSeq.get(`${goalId}|${x.seq_no}`) ?? null }))
    }).filter(x => x.goalId && x.kpiId && x.sr && x.sr.rating !== null)
    ratedCount = rated.length
    if (rated.length) {
      const rv = await supabase.from('pms_reviews').upsert(
        rated.map(({ sr, goalId, kpiId }) => ({
          company_id: companyId, period_id: periodId, employee_id: employeeId,
          goal_id: goalId, kpi_id: kpiId, rater_id: employeeId, rater_role: 'SELF',
          achievement_value: sr!.achievement || null, rating: sr!.rating,
          comments: sr!.comment || null, submitted: true, submitted_at: now(),
        })),
        { onConflict: 'period_id,employee_id,kpi_id,rater_role' })
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

  // The one-to-one, recorded by the tick — before the chain submit, naming the FROZEN RM L1.
  let oneToOneWarning = ''
  if (!error && o.confirmOneToOne && !o.oneToOneAlready) {
    const counterpart = o.frozenRmL1 ?? o.managerId
    if (!counterpart) {
      oneToOneWarning = ' Your record does not say who your reporting manager is, so the discussion could not be logged — ask HR to set your manager.'
    } else {
      const rec = await recordOneToOne({ companyId, periodId, employeeId, managerId: counterpart, stage: 'EMPLOYEE', today: o.today })
      if (rec === 'ERROR') oneToOneWarning = ' The one-to-one could not be logged, though — your weightages cannot lock until it is. Tell HR.'
    }
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
      ratingWarning, logWarning, oneToOneWarning, chainWarning,
    ].filter(Boolean).join(' '),
  }
}

/** The separate Self Rating tab — one row per KPI, and it enters the chain the same way. */
export async function submitSelf(employeeId: string, periodId: string, companyId: string | null, rows: SelfRow[]): Promise<{ ok: boolean; msg: string }> {
  if (!companyId) return { ok: false, msg: NO_COMPANY }
  const { error } = await supabase.from('pms_reviews').upsert(rows.filter(r => r.kpiId).map(r => ({
    company_id: companyId, period_id: periodId, employee_id: employeeId, goal_id: r.goalId, kpi_id: r.kpiId,
    rater_id: employeeId, rater_role: 'SELF', achievement_value: r.achievement || null, rating: r.rating,
    comments: r.comment || null, submitted: true, submitted_at: now(),
  })), { onConflict: 'period_id,employee_id,kpi_id,rater_role' })
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
