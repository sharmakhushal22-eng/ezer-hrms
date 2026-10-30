// src/features/performance/data.ts — every read and write the website's
// Performance section makes (components/ess/Performance.tsx + components/pms/
// CycleHeader.tsx), copied query for query: same tables, columns, filters.
//
// WHY NOT GET /api/ess/pms. That route picks the company's latest period by
// period_start with NO status filter, so on the live data it returns the
// SCHEDULED Q4 period, while the website (and every employee's enrolment row)
// sits on the open Q2 KRA_SETTING period. Reading it would show a different
// period from the website and aim every write at the wrong period_id.
//
// Reads only. The writes (and the chain RPCs) live in actions.ts.
import { supabase } from '@/core/supabase'
import { nameThePeriod, periodSpanShort, frequencyPhrase, type PeriodNaming } from '@web/pms/language'
import { DEFAULT_RULES, type Period as CyclePeriod, type Progress, type Queues, type Rules } from '@web/pms/cycle'
import { PERIOD_OPEN, GOAL_SENT, GOAL_STATUS, GOAL_AWAITING_RM, WORKFLOW, reached } from '@web/pms/status'
import type { Log } from '@web/pms/oneToOne'
import type { Kra, Category } from '@web/pms/kra'
import type { TeamMember } from '@web/pms/team'
import { DEFAULT_FLAG_RULES, type FlagRules } from '@web/pms/employment'
import { bandsFromScale, DEFAULT_BANDS, type Band, type ScaleRow } from '@web/pms/scoring'
import type { Chain, Finaliser } from '@web/pms/hierarchy'

export const MISSING_TABLE = 'PGRST205'
const missing = (e: unknown) => (e as { code?: string } | null)?.code === MISSING_TABLE

/** Today in the device's own zone (Performance.tsx / CycleHeader.tsx localToday). */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── roles + module probe (Performance.tsx) ───────────────────────────────
export interface Roles { isRM: boolean; isHOD: boolean; reportees: number; deptCount: number }

export async function loadRoles(employeeId: string): Promise<Roles> {
  const { count: reportees } = await supabase.from('employees').select('id', { count: 'exact', head: true })
    .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`).is('date_of_leaving', null)
  let deptCount = 0
  const d = await supabase.from('departments').select('id', { count: 'exact', head: true }).eq('hod_employee_id', employeeId)
  if (!d.error) deptCount = d.count || 0
  const { count: hodOf } = await supabase.from('employees').select('id', { count: 'exact', head: true })
    .eq('hod_id', employeeId).is('date_of_leaving', null)
  return { isRM: (reportees || 0) > 0, isHOD: deptCount > 0 || (hodOf || 0) > 0, reportees: reportees || 0, deptCount }
}

/** false when the pms_* tables do not exist (PGRST205). */
export async function probeModule(): Promise<boolean> {
  const probe = await supabase.from('pms_periods').select('id').limit(1)
  return !(probe.error && missing(probe.error))
}

// ── the cycle header (CycleHeader.tsx) ───────────────────────────────────
export interface HeaderData {
  period: CyclePeriod; progress: Progress; queues: Queues; rules: Rules
  naming: PeriodNaming; span: string; frequency: string
  lastRating?: { score: number | null; label: string | null } | null
  pending: boolean
}
const EMPTY = (pending = false): HeaderData => ({
  period: { label: '' }, progress: {}, queues: {}, rules: DEFAULT_RULES,
  naming: { title: 'No review period is open', sub: 'Nothing is running right now', code: '' },
  span: '', frequency: '', pending,
})

export async function loadHeader(employeeId: string, roles: { isRM: boolean; isHOD: boolean }, today: string): Promise<HeaderData> {
  try {
    // Website fix: CycleHeader read the newest open period with NO company
    // filter, so with one Q2 row per company it could describe another
    // company's period than the tabs below it (usePeriod filters by company).
    // The same company filter usePeriod uses is applied here.
    const me = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
    const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null
    let pq = supabase.from('pms_periods')
      .select('id, period_name, period_code, financial_year, period_no, period_start, period_end, kra_window_from, kra_window_to, self_rating_from, self_rating_to, rm_review_from, rm_review_to, finalise_from, finalise_to, result_publish_date, status, pms_policies(frequency, min_kra_count, max_kra_count, total_weightage, min_weightage_per_kra)')
      .in('status', PERIOD_OPEN)
    if (companyId) pq = pq.eq('company_id', companyId)
    const per = await pq.order('period_start', { ascending: false }).limit(1).maybeSingle()
    if (missing(per.error)) return EMPTY(true)
    const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
    if (!row) return EMPTY()

    const win = (a: string, b: string) => row[a] && row[b] ? { from: row[a] as string, to: row[b] as string } : undefined
    const pol = (row as unknown as { pms_policies?: {
      frequency?: string; min_kra_count?: number; max_kra_count?: number
      total_weightage?: number; min_weightage_per_kra?: number
    } }).pms_policies
    const freq = pol?.frequency ?? null
    // The policy's KRA rules (CycleHeader.tsx); DEFAULT_RULES only as the fallback.
    const rules: Rules = {
      minKra: Number(pol?.min_kra_count) || DEFAULT_RULES.minKra,
      maxKra: Number(pol?.max_kra_count) || DEFAULT_RULES.maxKra,
      totalWeightage: Number(pol?.total_weightage) || DEFAULT_RULES.totalWeightage,
      minWeightagePerKra: Number(pol?.min_weightage_per_kra) || DEFAULT_RULES.minWeightagePerKra,
    }
    const perYear = freq === 'MONTHLY' ? 12 : freq === 'QUARTERLY' ? 4 : freq === 'HALF_YEARLY' ? 2 : freq === 'ANNUAL' ? 1 : null
    const naming = nameThePeriod({
      periodName: row.period_name, periodCode: row.period_code, financialYear: row.financial_year,
      periodStart: row.period_start, periodEnd: row.period_end,
      periodNo: row.period_no ? Number(row.period_no) : null, totalPeriods: perYear, frequency: freq,
    }, today)
    const period: CyclePeriod = {
      label: naming.title,
      kra: win('kra_window_from', 'kra_window_to'),
      self: win('self_rating_from', 'self_rating_to'),
      review: win('rm_review_from', 'rm_review_to'),
      finalise: win('finalise_from', 'finalise_to'),
      publishedOn: row.result_publish_date,
    }
    const periodId = row.id
    const [goals, o2o, overall] = await Promise.all([
      supabase.from('pms_employee_goals').select('weightage, status').eq('period_id', periodId).eq('employee_id', employeeId),
      supabase.from('pms_one_to_one').select('employee_ack, manager_ack').eq('period_id', periodId).eq('employee_id', employeeId),
      supabase.from('pms_overall_rating').select('workflow_status, published_at, self_score, final_score, final_rating')
        .eq('period_id', periodId).eq('employee_id', employeeId).maybeSingle(),
    ])
    const rows = (goals.data ?? []) as unknown as { weightage: number; status: string }[]
    const ov = (overall.data ?? null) as unknown as Record<string, unknown> | null
    const meet = (o2o.data ?? []) as unknown as { employee_ack: boolean; manager_ack: boolean }[]
    const wf = (ov?.workflow_status as string | undefined) ?? undefined
    const progress: Progress = {
      kraCount: rows.length,
      weightageTotal: rows.reduce((t, r) => t + (Number(r.weightage) || 0), 0),
      kraSubmitted: rows.some(r => GOAL_SENT.includes(r.status)) || reached(wf, WORKFLOW.KRA_DRAFT),
      kraApproved: rows.some(r => r.status === GOAL_STATUS.LOCKED) || reached(wf, WORKFLOW.KRA_LOCKED),
      oneToOneLogged: meet.length > 0,
      oneToOneBothConfirmed: meet.some(m => m.employee_ack && m.manager_ack),
      selfSubmitted: ov?.self_score != null || reached(wf, WORKFLOW.SELF_SUBMITTED),
      rmL1Done: reached(wf, WORKFLOW.RM_L1_DONE),
      rmL2Done: reached(wf, WORKFLOW.RM_L2_DONE),
      finalised: reached(wf, WORKFLOW.FINALISED),
      published: Boolean(ov?.published_at) || reached(wf, WORKFLOW.PUBLISHED),
    }
    const queues: Queues = {}
    if (roles.isRM || roles.isHOD) {
      const team = await supabase.from('employees').select('id')
        .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`).is('date_of_leaving', null)
      const ids = ((team.data ?? []) as unknown as { id: string }[]).map(t => t.id)
      if (ids.length) {
        const pend = await supabase.from('pms_employee_goals').select('employee_id, status').eq('period_id', periodId).in('employee_id', ids)
        const byEmp = new Map<string, string[]>()
        for (const g of (pend.data ?? []) as unknown as { employee_id: string; status: string }[]) {
          byEmp.set(g.employee_id, [...(byEmp.get(g.employee_id) ?? []), g.status])
        }
        queues.kraApprovals = [...byEmp.values()].filter(ss =>
          ss.some(x => GOAL_AWAITING_RM.includes(x)) && !ss.some(x => x === GOAL_STATUS.LOCKED)).length
      }
    }
    return {
      period, progress, queues, rules, naming,
      span: periodSpanShort(row.period_start, row.period_end),
      frequency: frequencyPhrase(freq),
      lastRating: ov?.final_score != null ? { score: Number(ov.final_score), label: (ov.final_rating as string) ?? null } : null,
      pending: false,
    }
  } catch {
    return EMPTY()
  }
}

// ── usePeriod (Performance.tsx) ──────────────────────────────────────────
export interface Period {
  id: string; period_code: string; status: string; policy_id?: string | null
  period_start?: string | null; period_end?: string | null
}
/** The policy columns the review screens must agree with pms_finalise about. */
export interface Policy {
  approval_chain: Chain
  who_can_finalise: Finaliser
  final_review_one_to_one: boolean
  new_joiner_cutoff_days?: number | null
  carry_forward_kras?: boolean | null
  min_kra_count: number; max_kra_count: number; total_weightage: number; min_weightage_per_kra: number
}
export interface Overall {
  workflow_status?: string | null; self_score?: number | null; final_rating?: number | null
  final_rating_code?: string | null; is_readonly?: boolean | null
  chain_stage?: string | null; sent_back_to?: string | null
  sent_back_reason?: string | null; sent_back_at?: string | null
}
export interface PeriodCtx {
  period: Period | null; overall: Overall | null
  /** Every pms_* write needs company_id (NOT NULL); pms_one_to_one also manager_id. */
  companyId: string | null; managerId: string | null
  /** The company's configured pms_rating_scale bands; [] → callers use DEFAULT_BANDS. */
  bands: Band[]
  policy: Policy | null
  rules: Rules
  flagRules: FlagRules
}

export async function loadPeriod(employeeId: string): Promise<PeriodCtx> {
  const me = await supabase.from('employees').select('company_id,l1_manager_id').eq('id', employeeId).maybeSingle()
  const row = me.data as { company_id?: string; l1_manager_id?: string } | null
  const companyId = row?.company_id ?? null
  const managerId = row?.l1_manager_id ?? null
  const none: PeriodCtx = { period: null, overall: null, companyId, managerId, bands: [], policy: null, rules: DEFAULT_RULES, flagRules: DEFAULT_FLAG_RULES }

  let q = supabase.from('pms_periods').select('id,period_code,status,policy_id,period_start,period_end').not('status', 'in', '("CLOSED","SCHEDULED")')
  if (companyId) q = q.eq('company_id', companyId)
  const p = await q.order('period_start', { ascending: false }).limit(1).maybeSingle()
  if (p.error || !p.data) return none
  const period = p.data as Period

  // Independent reads, in parallel (the website awaits them one by one).
  const [po, o, sc] = await Promise.all([
    period.policy_id
      ? supabase.from('pms_policies')
          .select('approval_chain,who_can_finalise,final_review_one_to_one,min_kra_count,max_kra_count,total_weightage,min_weightage_per_kra,new_joiner_cutoff_days,carry_forward_kras')
          .eq('id', period.policy_id).maybeSingle()
      : Promise.resolve(null),
    supabase.from('pms_overall_rating')
      .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly,chain_stage,sent_back_to,sent_back_reason,sent_back_at')
      .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle(),
    companyId
      ? supabase.from('pms_rating_scale')
          .select('rating_value,rating_code,rating_label,score_from,score_to,min_comment_chars,improvement_feedback_mandatory,sort_order,is_active')
          .eq('company_id', companyId)
      : Promise.resolve(null),
  ])
  const policy = po && !po.error ? (po.data as Policy | null) : null
  const bands: Band[] = sc && !sc.error ? bandsFromScale(sc.data as ScaleRow[]) : []
  const rules: Rules = policy ? {
    minKra: Number(policy.min_kra_count) || DEFAULT_RULES.minKra,
    maxKra: Number(policy.max_kra_count) || DEFAULT_RULES.maxKra,
    totalWeightage: Number(policy.total_weightage) || DEFAULT_RULES.totalWeightage,
    minWeightagePerKra: Number(policy.min_weightage_per_kra) || DEFAULT_RULES.minWeightagePerKra,
  } : DEFAULT_RULES
  const flagRules: FlagRules = {
    newJoinerCutoffDays: Number(policy?.new_joiner_cutoff_days) || DEFAULT_FLAG_RULES.newJoinerCutoffDays,
    periodEnd: period.period_end ?? null,
  }
  return { period, overall: o.error ? null : (o.data as Overall | null), companyId, managerId, bands, policy, rules, flagRules }
}

/** `bands.length ? bands : undefined` on the website — the lib falls back to DEFAULT_BANDS. */
export const bandsOrDefault = (b: Band[] | undefined) => (b?.length ? b : DEFAULT_BANDS)

// ── MySide ───────────────────────────────────────────────────────────────
export interface Who { name: string; code: string; designation?: string | null }
export async function loadWho(employeeId: string): Promise<Who | null> {
  const e = await supabase.from('employees').select('emp_code,full_name,designation').eq('id', employeeId).maybeSingle()
  if (e.error || !e.data) return null
  const r = e.data as Record<string, unknown>
  return { name: String(r.full_name ?? ''), code: String(r.emp_code ?? ''), designation: r.designation ? String(r.designation) : null }
}

export interface Carried { fromPeriodId: string; fromPeriodCode: string; kras: Kra[] }
export interface PeriodData {
  goals: Record<string, unknown>[]
  /** Last period's LOCKED KRAs, offered when this period has none (§3 carry-forward). */
  carried: Carried | null
  logs: Log[]
  reviews: Record<string, unknown>[]
  feedback: Record<string, unknown> | null
  /** §3.5's recognition list, already labelled. */
  benefits: { type: string; note: string }[]
}
export async function loadPeriodData(employeeId: string, ctx: PeriodCtx): Promise<PeriodData> {
  const period = ctx.period!
  // The reads that do not depend on the goals start now, in parallel.
  const rest = Promise.all([
    supabase.from('pms_one_to_one')
      .select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack,duration_minutes,weightage_changes')
      .eq('employee_id', employeeId).eq('period_id', period.id).order('discussion_date', { ascending: true }),
    supabase.from('pms_reviews').select('goal_id,rater_role,rating,achievement_value,comments')
      .eq('employee_id', employeeId).eq('period_id', period.id),
    supabase.from('pms_feedback').select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
      .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle(),
    supabase.from('pms_additional_benefits').select('benefit_type,benefit_note')
      .eq('employee_id', employeeId).eq('period_id', period.id),
  ])
  const g = await supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status')
    .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no')
  const goals = (g.data ?? []) as Record<string, unknown>[]

  // §13.2(3): carry-forward is a policy choice defaulting to ON (`!== false`).
  let carried: Carried | null = null
  if (ctx.policy?.carry_forward_kras !== false && !goals.length && ctx.companyId) {
    const prev = await supabase.from('pms_periods').select('id,period_code,period_start')
      .eq('company_id', ctx.companyId).lt('period_start', period.period_start ?? '9999-12-31')
      .order('period_start', { ascending: false }).limit(1).maybeSingle()
    const prevRow = prev.data as { id: string; period_code?: string } | null
    if (prevRow?.id) {
      const pg = await supabase.from('pms_employee_goals').select('seq_no,kra_title,kpi_metric,target_value,category,weightage')
        .eq('employee_id', employeeId).eq('period_id', prevRow.id).eq('status', 'LOCKED').order('seq_no')
      if (!pg.error && (pg.data ?? []).length) {
        carried = {
          fromPeriodId: prevRow.id, fromPeriodCode: String(prevRow.period_code ?? ''),
          kras: (pg.data ?? []).map((k: Record<string, unknown>) => ({
            seq_no: Number(k.seq_no), kra_title: String(k.kra_title ?? ''),
            kpi_metric: String(k.kpi_metric ?? ''), target_value: String(k.target_value ?? ''),
            category: String(k.category ?? 'BUSINESS') as Category, weightage: Number(k.weightage) || 0,
            source: 'CARRIED_FORWARD' as const, carried_from_period_id: prevRow.id,
          })),
        }
      }
    }
  }
  const [l, r, f, bn] = await rest
  return {
    goals, carried,
    logs: (l.data ?? []) as unknown as Log[],
    reviews: (r.data ?? []) as Record<string, unknown>[],
    feedback: f.error ? null : (f.data as Record<string, unknown> | null),
    benefits: ((bn.data ?? []) as { benefit_type: string; benefit_note?: string | null }[]).map(b => ({
      type: BENEFIT_LABEL[b.benefit_type as BenefitType] ?? String(b.benefit_type),
      note: String(b.benefit_note ?? ''),
    })),
  }
}

// ── useRoster (Performance.tsx) — the frozen chain on pms_overall_rating ──
export async function loadRoster(employeeId: string, periodId: string, as: 'rm' | 'hod'): Promise<TeamMember[]> {
  const q = supabase.from('pms_overall_rating')
    .select('employee_id,workflow_status,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,hod_id,employment_flag,chain_stage,sent_back_to,sent_back_reason')
    .eq('period_id', periodId)
  const { data } = as === 'hod' ? await q.eq('hod_id', employeeId) : await q.or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)
  if (!data?.length) return []
  const rowsIn = data as Record<string, unknown>[]
  const ids = rowsIn.map(d => String(d.employee_id))
  const [{ data: emps }, { data: goals }, { data: talksRaw }] = await Promise.all([
    supabase.from('employees').select('id,emp_code,full_name,date_of_leaving,date_of_resignation,company_doj').in('id', ids),
    // KRA count / weightage counted from the KRAs (the overall-rating counters are never written).
    supabase.from('pms_employee_goals').select('employee_id,weightage,status').eq('period_id', periodId).in('employee_id', ids),
    supabase.from('pms_one_to_one').select('employee_id,discussion_type,employee_ack,manager_ack')
      .eq('period_id', periodId).in('discussion_type', ['KRA_SETTING', 'FINAL_REVIEW']).in('employee_id', ids),
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
  const talks = (talksRaw ?? []) as { employee_id: string; discussion_type?: string; employee_ack?: boolean; manager_ack?: boolean }[]
  const ackedOf = (kind: string) => new Set(talks.filter(t => t.discussion_type === kind && t.employee_ack && t.manager_ack).map(t => String(t.employee_id)))
  const bothAcked = ackedOf('KRA_SETTING')
  const finalAcked = ackedOf('FINAL_REVIEW')
  const finalLogged = new Set(talks.filter(t => t.discussion_type === 'FINAL_REVIEW').map(t => String(t.employee_id)))
  const finalMgrAcked = new Set(talks.filter(t => t.discussion_type === 'FINAL_REVIEW' && t.manager_ack).map(t => String(t.employee_id)))
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
    }
  })
}

// ── Rate My Team: the picked reportee's KRAs + ratings (TeamSide effect) ──
export interface RateRow {
  goalId: string; title: string; category: Category; weightage: number
  achievement: string; selfRating: number | null; selfComment: string
  myRating: number | null; myComment: string
}
export async function loadRateRows(viewerId: string, pickedId: string, periodId: string): Promise<RateRow[]> {
  const g = await supabase.from('pms_employee_goals').select('id,seq_no,kra_title,category,weightage')
    .eq('employee_id', pickedId).eq('period_id', periodId).neq('status', 'SENT_BACK').order('seq_no')
  if (g.error) throw new Error(g.error.message)
  const r = await supabase.from('pms_reviews').select('goal_id,rater_id,rater_role,rating,comments,achievement_value')
    .eq('employee_id', pickedId).eq('period_id', periodId).in('rater_role', ['SELF', 'RM_L1', 'RM_L2'])
  const byGoal = new Map<string, Record<string, Record<string, unknown>>>()
  for (const row of (r.data ?? []) as Record<string, unknown>[]) {
    const k = String(row.goal_id)
    const slot = String(row.rater_role) === 'SELF' ? 'SELF' : String(row.rater_id) === viewerId ? 'MINE' : 'OTHER'
    byGoal.set(k, { ...(byGoal.get(k) ?? {}), [slot]: row })
  }
  return ((g.data ?? []) as Record<string, unknown>[]).map(gr => {
    const seen = byGoal.get(String(gr.id)) ?? {}
    const self = seen.SELF, mine = seen.MINE
    return {
      goalId: String(gr.id), title: String(gr.kra_title ?? ''),
      category: String(gr.category ?? 'BUSINESS') as Category, weightage: Number(gr.weightage) || 0,
      achievement: String(self?.achievement_value ?? mine?.achievement_value ?? ''),
      selfRating: self?.rating == null ? null : Number(self.rating),
      selfComment: String(self?.comments ?? ''),
      myRating: mine?.rating == null ? null : Number(mine.rating),
      myComment: String(mine?.comments ?? ''),
    }
  })
}

// ── Feedback & Recognition: the HOD's draft for one person (DeptSide effect) ──
export const BENEFIT_TYPES = ['CERTIFICATE', 'SPOT_AWARD', 'TRAINING_NOMINATION', 'SPECIAL_MENTION', 'STAR_PERFORMER', 'OTHER'] as const
export type BenefitType = typeof BENEFIT_TYPES[number]
// Copied from components/pms/ManagerTabs.tsx (a .tsx component, not importable).
export const BENEFIT_LABEL: Record<BenefitType, string> = {
  CERTIFICATE: 'Certificate', SPOT_AWARD: 'Spot award', TRAINING_NOMINATION: 'Training nomination',
  SPECIAL_MENTION: 'Special mention', STAR_PERFORMER: 'Star performer', OTHER: 'Other',
}
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
