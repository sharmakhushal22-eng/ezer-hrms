// src/features/performance/data.ts — the reads behind the cycle header and the
// employee's own side (website: components/ess/Performance.tsx usePeriod /
// MySide, components/pms/CycleHeader.tsx), copied query for query: same
// tables, columns, filters. The manager and HOD reads are in dataTeam.ts, the
// writes in actions.ts / actionsTeam.ts.
//
// WHY NOT GET /api/ess/pms. That route picks the company's latest period by
// period_start with NO status filter, so on the live data it returns the
// SCHEDULED Q4 period, while the website (and every employee's enrolment row)
// sits on the open Q2 KRA_SETTING period. Reading it would show a different
// period from the website and aim every write at the wrong period_id.
import { supabase } from '@/core/supabase'
import { nameThePeriod, periodSpanShort, frequencyPhrase, type PeriodNaming } from '@web/pms/language'
import { type Period as CyclePeriod, type Progress, type Queues, type Rules } from '@web/pms/cycle'
import { PERIOD_OPEN, GOAL_SENT, GOAL_STATUS, GOAL_AWAITING_RM, WORKFLOW, reached } from '@web/pms/status'
import { withoutFreshCols } from '@web/pms/policy'
import { effectiveChain, type Stage } from '@web/pms/chain'
import type { Log } from '@web/pms/oneToOne'
import type { Kra, Category } from '@web/pms/kra'
import type { Chain, Finaliser } from '@web/pms/hierarchy'
import type { PostFinalOwner } from '@web/pms/postFinal'
import { DEFAULT_FLAG_RULES, type FlagRules } from '@web/pms/employment'
import { bandsFromScale, DEFAULT_BANDS, type Band, type ScaleRow } from '@web/pms/scoring'
import { rulesOf, type PolicyRules } from './logic'

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
  // Counted the same way the roster is selected: L1, L2 OR HOD names this person.
  const [rep, d, hod] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true })
      .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId},hod_id.eq.${employeeId}`).is('date_of_leaving', null),
    supabase.from('departments').select('id', { count: 'exact', head: true }).eq('hod_employee_id', employeeId),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('hod_id', employeeId).is('date_of_leaving', null),
  ])
  const reportees = rep.count || 0
  const deptCount = d.error ? 0 : d.count || 0
  return { isRM: reportees > 0, isHOD: deptCount > 0 || (hod.count || 0) > 0, reportees, deptCount }
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
  period: { label: '' }, progress: {}, queues: {}, rules: rulesOf(null),
  naming: { title: 'No review period is open', sub: 'Nothing is running right now', code: '' },
  span: '', frequency: '', pending,
})

const PERIOD_SELECT =
  'id, period_name, period_code, financial_year, period_no, period_start, period_end,'
  + ' kra_window_from, kra_window_to, self_rating_from, self_rating_to, rm_review_from, rm_review_to,'
  + ' finalise_from, finalise_to, result_publish_date, status,'
  + ' pms_policies(frequency, min_kra_count, max_kra_count, total_weightage, min_weightage_per_kra, min_kpi_per_kra, max_kpi_per_kra)'

export async function loadHeader(employeeId: string, roles: { isRM: boolean; isHOD: boolean }, today: string): Promise<HeaderData> {
  try {
    // Website fix kept from the last sync: CycleHeader reads the newest open
    // period with NO company filter, so with one Q2 row per company it can
    // describe another company's period than the tabs below it. usePeriod's
    // company filter is applied here too.
    const me = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
    const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null
    const ask = (sel: string) => {
      let q = supabase.from('pms_periods').select(sel).in('status', PERIOD_OPEN)
      if (companyId) q = q.eq('company_id', companyId)
      return q.order('period_start', { ascending: false }).limit(1).maybeSingle()
    }
    let per = await ask(PERIOD_SELECT)
    // Tolerant of a migration not having run: the embedded policy columns would fail the period read too.
    if (per.error) {
      const narrowed = withoutFreshCols(PERIOD_SELECT)
      if (narrowed !== PERIOD_SELECT) per = await ask(narrowed)
    }
    if (missing(per.error)) return EMPTY(true)
    const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
    if (!row) return EMPTY()

    const win = (a: string, b: string) => row[a] && row[b] ? { from: row[a] as string, to: row[b] as string } : undefined
    const pol = (row as unknown as { pms_policies?: PolicyRules & { frequency?: string } }).pms_policies
    const freq = pol?.frequency ?? null
    // CycleHeader computes every rule with its own fallback, so a period with no policy still gets the defaults.
    const rules = rulesOf(pol ?? {})
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
/** The policy columns the review screens must agree with the database about. */
export interface Policy extends PolicyRules {
  approval_chain: Chain
  /** 218: a composed chain. effectiveChain() decides which of the two runs. */
  chain_id?: string | null
  pms_chain?: { rungs?: unknown } | { rungs?: unknown }[] | null
  who_can_finalise: Finaliser
  final_review_one_to_one: boolean
  new_joiner_cutoff_days?: number | null
  carry_forward_kras?: boolean | null
  /** 202: who runs the appraisal after the rating is settled. */
  post_final_owner?: string | null
  /** A policy that does not ask for the KRA conversation must not block a submission on confirming it. */
  one_to_one_mandatory?: boolean | null
}
export interface Overall {
  workflow_status?: string | null; self_score?: number | null; final_rating?: number | null
  final_rating_code?: string | null; is_readonly?: boolean | null
  chain_stage?: string | null; sent_back_to?: string | null
  sent_back_reason?: string | null; sent_back_at?: string | null
  /** The FROZEN RM L1 — the employee's one-to-one tick names this manager. */
  rm_l1_id?: string | null
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
  /** The chain this policy actually runs: a preset, or the composed one. */
  chain: Chain | Stage[]
  postFinalOwner: PostFinalOwner
}

const POLICY_SELECT = 'approval_chain,who_can_finalise,final_review_one_to_one,'
  + 'min_kra_count,max_kra_count,total_weightage,min_weightage_per_kra,'
  + 'min_kpi_per_kra,max_kpi_per_kra,'
  + 'new_joiner_cutoff_days,carry_forward_kras,post_final_owner,'
  + 'one_to_one_mandatory,chain_id,pms_chain(rungs)'

async function loadPolicy(policyId: string): Promise<Policy | null> {
  const ask = (sel: string) => supabase.from('pms_policies').select(sel).eq('id', policyId).maybeSingle()
  let po = await ask(POLICY_SELECT)
  // Tolerant of a migration not having run: one unknown column fails the whole read.
  if (po.error) {
    const narrowed = withoutFreshCols(POLICY_SELECT)
    if (narrowed !== POLICY_SELECT) po = await ask(narrowed)
  }
  return po.error ? null : (po.data as unknown as Policy | null)
}

export async function loadPeriod(employeeId: string): Promise<PeriodCtx> {
  const me = await supabase.from('employees').select('company_id,l1_manager_id').eq('id', employeeId).maybeSingle()
  const row = me.data as { company_id?: string; l1_manager_id?: string } | null
  const companyId = row?.company_id ?? null
  const managerId = row?.l1_manager_id ?? null
  const none: PeriodCtx = {
    period: null, overall: null, companyId, managerId, bands: [], policy: null, rules: rulesOf(null),
    flagRules: DEFAULT_FLAG_RULES, chain: effectiveChain(null), postFinalOwner: 'HR',
  }

  let q = supabase.from('pms_periods').select('id,period_code,status,policy_id,period_start,period_end').not('status', 'in', '("CLOSED","SCHEDULED")')
  if (companyId) q = q.eq('company_id', companyId)
  const p = await q.order('period_start', { ascending: false }).limit(1).maybeSingle()
  if (p.error || !p.data) return none
  const period = p.data as Period

  // Independent reads, in parallel (the website awaits them one by one).
  const [policy, o, sc] = await Promise.all([
    period.policy_id ? loadPolicy(period.policy_id) : Promise.resolve(null),
    supabase.from('pms_overall_rating')
      .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly,chain_stage,sent_back_to,sent_back_reason,sent_back_at,rm_l1_id')
      .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle(),
    companyId
      ? supabase.from('pms_rating_scale')
          .select('rating_value,rating_code,rating_label,score_from,score_to,min_comment_chars,improvement_feedback_mandatory,allows_pip_request,allows_recognition,sort_order,is_active')
          .eq('company_id', companyId)
      : Promise.resolve(null),
  ])
  const bands: Band[] = sc && !sc.error ? bandsFromScale(sc.data as ScaleRow[]) : []
  const flagRules: FlagRules = {
    newJoinerCutoffDays: Number(policy?.new_joiner_cutoff_days) || DEFAULT_FLAG_RULES.newJoinerCutoffDays,
    periodEnd: period.period_end ?? null,
  }
  return {
    period, overall: o.error ? null : (o.data as Overall | null), companyId, managerId, bands, policy,
    rules: rulesOf(policy), flagRules, chain: effectiveChain(policy),
    postFinalOwner: (policy?.post_final_owner ?? 'HR') as PostFinalOwner,
  }
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
  /** 220: the KPIs under those KRAs — a rating belongs to one. */
  kpis: Record<string, unknown>[]
  /** Last period's LOCKED KRAs, offered when this period has none (§3 carry-forward). */
  carried: Carried | null
  logs: Log[]
  reviews: Record<string, unknown>[]
  feedback: Record<string, unknown> | null
  /** §3.5's recognition list, already labelled. */
  benefits: { type: string; note: string }[]
}

export const BENEFIT_TYPES = ['CERTIFICATE', 'SPOT_AWARD', 'TRAINING_NOMINATION', 'SPECIAL_MENTION', 'STAR_PERFORMER', 'OTHER'] as const
export type BenefitType = typeof BENEFIT_TYPES[number]
// Copied from components/pms/ManagerTabs.tsx (a .tsx component, not importable).
export const BENEFIT_LABEL: Record<BenefitType, string> = {
  CERTIFICATE: 'Certificate', SPOT_AWARD: 'Spot award', TRAINING_NOMINATION: 'Training nomination',
  SPECIAL_MENTION: 'Special mention', STAR_PERFORMER: 'Star performer', OTHER: 'Other',
}

export async function loadPeriodData(employeeId: string, ctx: PeriodCtx): Promise<PeriodData> {
  const period = ctx.period!
  // The reads that do not depend on the goals start now, in parallel.
  const rest = Promise.all([
    supabase.from('pms_one_to_one')
      .select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack,duration_minutes,weightage_changes')
      .eq('employee_id', employeeId).eq('period_id', period.id).order('discussion_date', { ascending: true }),
    // kpi_id is selected: the self rating is seeded by it. The website's read leaves
    // it out, so its KRA form never shows a rating saved earlier (see the report).
    supabase.from('pms_reviews').select('goal_id,kpi_id,rater_role,rating,achievement_value,comments')
      .eq('employee_id', employeeId).eq('period_id', period.id),
    supabase.from('pms_feedback').select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
      .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle(),
    supabase.from('pms_additional_benefits').select('benefit_type,benefit_note')
      .eq('employee_id', employeeId).eq('period_id', period.id),
  ])
  const [g, kp] = await Promise.all([
    supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status')
      .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no'),
    supabase.from('pms_goal_kpi').select('id,goal_id,seq_no,kpi_metric,target_value,weightage')
      .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no'),
  ])
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
    goals, kpis: (kp.data ?? []) as Record<string, unknown>[], carried,
    logs: (l.data ?? []) as unknown as Log[],
    reviews: (r.data ?? []) as Record<string, unknown>[],
    feedback: f.error ? null : (f.data as Record<string, unknown> | null),
    benefits: ((bn.data ?? []) as { benefit_type: string; benefit_note?: string | null }[]).map(b => ({
      type: BENEFIT_LABEL[b.benefit_type as BenefitType] ?? String(b.benefit_type),
      note: String(b.benefit_note ?? ''),
    })),
  }
}
