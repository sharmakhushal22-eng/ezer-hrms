// src/features/performance/dataTeam.ts — the manager's and HOD's reads (website:
// components/ess/Performance.tsx useRoster, TeamSide's openKras and Team
// Ratings effect, DeptSide's published-results and feedback effects,
// useHrHead), copied query for query. Shaping is in logic.ts.
import { supabase } from '@/core/supabase'
import type { TeamMember } from '@web/pms/team'
import type { Log } from '@web/pms/oneToOne'
import { CHAIN_RATERS, kraLinesOf, mineOf, rateRowsOf, type KraLine, type Rate, type RateRow } from './logic'
import type { BenefitType } from './data'

// ── useRoster — the frozen chain on pms_overall_rating ───────────────────
export async function loadRoster(employeeId: string, periodId: string, as: 'rm' | 'hod'): Promise<TeamMember[]> {
  const q = supabase.from('pms_overall_rating')
    .select('employee_id,workflow_status,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,hod_id,employment_flag,chain_stage,sent_back_to,sent_back_reason,published_at,employee_ack')
    .eq('period_id', periodId)
  // Everyone whose chain names me — the HOD rung included, or a HOD can never rate.
  const { data } = as === 'hod'
    ? await q.eq('hod_id', employeeId)
    : await q.or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId},hod_id.eq.${employeeId}`)
  if (!data?.length) return []
  const rowsIn = data as Record<string, unknown>[]
  const ids = rowsIn.map(d => String(d.employee_id))
  const [{ data: emps }, { data: goals }, { data: talksRaw }] = await Promise.all([
    supabase.from('employees').select('id,emp_code,full_name,date_of_leaving,date_of_resignation,company_doj').in('id', ids),
    // KRA count / weightage counted from the KRAs (the overall-rating counters are never written).
    supabase.from('pms_employee_goals').select('employee_id,weightage,status').eq('period_id', periodId).in('employee_id', ids),
    supabase.from('pms_one_to_one').select('employee_id,discussion_type,manager_role,employee_ack,manager_ack')
      .eq('period_id', periodId).in('discussion_type', ['KRA_SETTING', 'FINAL_REVIEW', 'ADHOC']).in('employee_id', ids),
  ])
  const byId = new Map(((emps ?? []) as Record<string, unknown>[]).map(e => [String(e.id), e]))

  const goalsBy = new Map<string, { n: number; wt: number; locked: boolean }>()
  for (const g of (goals ?? []) as { employee_id: string; weightage?: number; status?: string }[]) {
    const k = String(g.employee_id)
    const cur = goalsBy.get(k) ?? { n: 0, wt: 0, locked: false }
    cur.n += 1
    cur.wt += Number(g.weightage) || 0
    if (g.status === 'LOCKED') cur.locked = true
    goalsBy.set(k, cur)
  }
  type Talk = { employee_id: string; discussion_type?: string; manager_role?: string; employee_ack?: boolean; manager_ack?: boolean }
  const talks = (talksRaw ?? []) as Talk[]
  const idsOf = (f: (t: Talk) => boolean) => new Set(talks.filter(f).map(t => String(t.employee_id)))
  const bothAcked = idsOf(t => t.discussion_type === 'KRA_SETTING' && !!t.employee_ack && !!t.manager_ack)
  const finalAcked = idsOf(t => t.discussion_type === 'FINAL_REVIEW' && !!t.employee_ack && !!t.manager_ack)
  const finalLogged = idsOf(t => t.discussion_type === 'FINAL_REVIEW')
  const finalMgrAcked = idsOf(t => t.discussion_type === 'FINAL_REVIEW' && !!t.manager_ack)
  // RM L2's own confirmation: ADHOC is the type autoLogFor gives that rung.
  const l2Confirmed = idsOf(t => t.discussion_type === 'ADHOC' && t.manager_role === 'RM_L2' && !!t.manager_ack)
  const num = (v: unknown) => (v == null ? null : Number(v))
  const str = (v: unknown) => (v == null ? null : String(v))

  return rowsIn.map(d => {
    const id = String(d.employee_id)
    const e = byId.get(id)
    const g = goalsBy.get(id) ?? { n: 0, wt: 0, locked: false }
    return {
      employeeId: id,
      code: String(e?.emp_code ?? ''),
      name: String(e?.full_name ?? 'Unknown'),
      dateOfLeaving: str(e?.date_of_leaving),
      resignationDate: str(e?.date_of_resignation),
      dateOfJoining: str(e?.company_doj),
      // Left null on purpose (website): flagFor derives it from the dates with the policy's cut-off.
      flagOverride: null,
      kraCount: g.n,
      totalWeightage: g.wt,
      kraLocked: g.locked,
      oneToOneDone: bothAcked.has(id),
      finalReviewDone: finalAcked.has(id),
      finalReviewLogged: finalLogged.has(id),
      finalReviewMgrAcked: finalMgrAcked.has(id),
      rmL2ConfirmedOneToOne: l2Confirmed.has(id),
      selfSubmitted: d.self_score != null,
      selfScore: num(d.self_score),
      rmL1Score: num(d.rm_l1_score),
      rmL2Score: num(d.rm_l2_score),
      rmL1Id: str(d.rm_l1_id),
      rmL2Id: str(d.rm_l2_id),
      hodId: str(d.hod_id),
      chainStage: str(d.chain_stage),
      sentBackTo: str(d.sent_back_to),
      sentBackReason: str(d.sent_back_reason),
      finalRating: num(d.final_rating),
      finalised: d.final_rating != null,
      // Either marker means released (the rule HR's publish queue uses).
      published: d.workflow_status === 'PUBLISHED' || d.workflow_status === 'ACKNOWLEDGED' || d.chain_stage === 'DONE',
      publishedAt: str(d.published_at),
      resultAcknowledged: d.employee_ack === true,
    }
  })
}

// ── Team Ratings: what every rung scored, read-only ──────────────────────
export async function loadRateRows(pickedId: string, periodId: string): Promise<RateRow[]> {
  const g = await supabase.from('pms_employee_goals').select('id,seq_no,kra_title,category,weightage')
    .eq('employee_id', pickedId).eq('period_id', periodId).neq('status', 'SENT_BACK').order('seq_no')
  if (g.error) throw new Error(g.error.message)
  const r = await supabase.from('pms_reviews').select('goal_id,kpi_id,rater_id,rater_role,rating,comments,achievement_value')
    .eq('employee_id', pickedId).eq('period_id', periodId).in('rater_role', ['SELF', ...CHAIN_RATERS])
  return rateRowsOf((g.data ?? []) as Record<string, unknown>[], (r.data ?? []) as Record<string, unknown>[])
}

// ── openKras: the employee's filled form, and this rater's own scores ────
export interface KraPanelData { lines: KraLine[]; mine: Rate }
export async function loadKraPanel(id: string, periodId: string, myRole: string | null): Promise<KraPanelData> {
  const [goalsQ, kpisQ, selfQ, mineQ] = await Promise.all([
    supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status,source')
      .eq('employee_id', id).eq('period_id', periodId).order('seq_no'),
    supabase.from('pms_goal_kpi').select('id,goal_id,seq_no,kpi_metric,target_value,weightage')
      .eq('employee_id', id).eq('period_id', periodId).order('seq_no'),
    supabase.from('pms_reviews').select('goal_id,kpi_id,achievement_value,rating,comments')
      .eq('employee_id', id).eq('period_id', periodId).eq('rater_role', 'SELF'),
    myRole
      ? supabase.from('pms_reviews').select('goal_id,kpi_id,rating,comments').eq('employee_id', id).eq('period_id', periodId).eq('rater_role', myRole)
      : Promise.resolve(null),
  ])
  if (goalsQ.error) throw new Error(goalsQ.error.message)
  return {
    lines: kraLinesOf((goalsQ.data ?? []) as Record<string, unknown>[], (kpisQ.data ?? []) as Record<string, unknown>[], (selfQ.data ?? []) as Record<string, unknown>[]),
    mine: mineOf((mineQ?.data ?? []) as Record<string, unknown>[]),
  }
}

// ── Published Results (DeptSide) ─────────────────────────────────────────
export interface PublishedResult { employeeId: string; appreciation?: string | null; improvement?: string | null; benefits?: { type: string; note: string }[] }
/** Driven off the PUBLISHED ids: somebody published with no written feedback still belongs in the list. */
export async function loadPublished(periodId: string, ids: string[]): Promise<PublishedResult[]> {
  if (!ids.length) return []
  const [fb, ben] = await Promise.all([
    supabase.from('pms_feedback').select('employee_id,appreciation_remark,improvement_feedback').eq('period_id', periodId).in('employee_id', ids),
    supabase.from('pms_additional_benefits').select('employee_id,benefit_type,benefit_note').eq('period_id', periodId).in('employee_id', ids),
  ])
  const benBy = new Map<string, { type: string; note: string }[]>()
  for (const b of (ben.data ?? []) as { employee_id: string; benefit_type: string; benefit_note?: string | null }[]) {
    benBy.set(String(b.employee_id), [...(benBy.get(String(b.employee_id)) ?? []), { type: String(b.benefit_type), note: String(b.benefit_note ?? '') }])
  }
  const fbs = (fb.data ?? []) as { employee_id: string; appreciation_remark?: string | null; improvement_feedback?: string | null }[]
  return ids.map(id => {
    const f = fbs.find(x => String(x.employee_id) === id)
    return { employeeId: id, appreciation: f?.appreciation_remark ?? null, improvement: f?.improvement_feedback ?? null, benefits: benBy.get(id) ?? [] }
  })
}

/** useHrHead — the HR Head this company has named (205). Any failure reads as "nobody named". */
export async function loadHrHead(policyId: string | null | undefined): Promise<{ name: string; code: string } | null> {
  if (!policyId) return null
  const p = await supabase.from('pms_policies').select('hr_head_id').eq('id', policyId).maybeSingle()
  const id = (p.data as { hr_head_id?: string | null } | null)?.hr_head_id
  if (p.error || !id) return null
  const e = await supabase.from('employees').select('full_name,emp_code').eq('id', id).maybeSingle()
  if (e.error || !e.data) return null
  const r = e.data as { full_name?: string; emp_code?: string }
  return { name: String(r.full_name ?? ''), code: String(r.emp_code ?? '') }
}

// ── Feedback & Recognition: the HOD's draft for one person ───────────────
export interface FeedbackDraft { appreciation: string; improvement: string; benefits: { type: BenefitType; note: string }[] }
export async function loadFeedbackDraft(pickedId: string, periodId: string): Promise<{ draft: FeedbackDraft; logs: Log[] }> {
  const [fb, oo, ben] = await Promise.all([
    supabase.from('pms_feedback').select('appreciation_remark,improvement_feedback').eq('employee_id', pickedId).eq('period_id', periodId).maybeSingle(),
    supabase.from('pms_one_to_one').select('discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack').eq('employee_id', pickedId).eq('period_id', periodId),
    supabase.from('pms_additional_benefits').select('benefit_type,benefit_note').eq('employee_id', pickedId).eq('period_id', periodId),
  ])
  const f = fb.data as { appreciation_remark?: string | null; improvement_feedback?: string | null } | null
  return {
    draft: {
      appreciation: String(f?.appreciation_remark ?? ''),
      improvement: String(f?.improvement_feedback ?? ''),
      benefits: ((ben.data ?? []) as { benefit_type: BenefitType; benefit_note?: string | null }[]).map(b => ({ type: b.benefit_type, note: String(b.benefit_note ?? '') })),
    },
    logs: (oo.data ?? []) as unknown as Log[],
  }
}
