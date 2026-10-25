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
// WRITES go straight to Supabase with the anon key, exactly as the website
// sends them — no company_id / manager_id, because the website sends neither.
// If the database refuses them (repo DDL has company_id NOT NULL, and
// manager_id NOT NULL on pms_one_to_one) the screen shows error.message, as the
// website does.
import { supabase } from '@/core/supabase'
import { nameThePeriod, periodSpanShort, frequencyPhrase, type PeriodNaming } from '@web/pms/language'
import { DEFAULT_RULES, type Period as CyclePeriod, type Progress, type Queues, type Rules } from '@web/pms/cycle'
import { PERIOD_OPEN, GOAL_SENT, GOAL_STATUS, GOAL_AWAITING_RM, WORKFLOW, reached } from '@web/pms/status'
import type { Log } from '@web/pms/oneToOne'
import type { Kra } from '@web/pms/kra'
import type { TeamMember } from '@web/pms/team'
import type { Flag } from '@web/pms/employment'

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
      .select('id, period_name, period_code, financial_year, period_no, period_start, period_end, kra_window_from, kra_window_to, self_rating_from, self_rating_to, rm_review_from, rm_review_to, finalise_from, finalise_to, result_publish_date, status, pms_policies(frequency)')
      .in('status', PERIOD_OPEN)
    if (companyId) pq = pq.eq('company_id', companyId)
    const per = await pq.order('period_start', { ascending: false }).limit(1).maybeSingle()
    if (missing(per.error)) return EMPTY(true)
    const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
    if (!row) return EMPTY()

    const win = (a: string, b: string) => row[a] && row[b] ? { from: row[a] as string, to: row[b] as string } : undefined
    const freq = ((row as unknown as { pms_policies?: { frequency?: string } }).pms_policies?.frequency) ?? null
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
      period, progress, queues, rules: DEFAULT_RULES, naming,
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
export interface Period { id: string; period_code: string; status: string }
export interface Overall {
  workflow_status?: string | null; self_score?: number | null; final_rating?: number | null
  final_rating_code?: string | null; is_readonly?: boolean | null
}
export async function loadPeriod(employeeId: string): Promise<{ period: Period | null; overall: Overall | null }> {
  const me = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
  const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null
  let q = supabase.from('pms_periods').select('id,period_code,status').not('status', 'in', '("CLOSED","SCHEDULED")')
  if (companyId) q = q.eq('company_id', companyId)
  const p = await q.order('period_start', { ascending: false }).limit(1).maybeSingle()
  if (p.error || !p.data) return { period: null, overall: null }
  const period = p.data as Period
  const o = await supabase.from('pms_overall_rating')
    .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly')
    .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle()
  return { period, overall: o.error ? null : (o.data as Overall | null) }
}

// ── MySide ───────────────────────────────────────────────────────────────
export interface Who { name: string; code: string; designation?: string | null }
export async function loadWho(employeeId: string): Promise<Who | null> {
  const e = await supabase.from('employees').select('emp_code,full_name,designation').eq('id', employeeId).maybeSingle()
  if (e.error || !e.data) return null
  const r = e.data as Record<string, unknown>
  return { name: String(r.full_name ?? ''), code: String(r.emp_code ?? ''), designation: r.designation ? String(r.designation) : null }
}

export interface PeriodData {
  goals: Record<string, unknown>[]
  logs: Log[]
  reviews: Record<string, unknown>[]
  feedback: Record<string, unknown> | null
}
export async function loadPeriodData(employeeId: string, periodId: string): Promise<PeriodData> {
  const g = await supabase.from('pms_employee_goals').select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status')
    .eq('employee_id', employeeId).eq('period_id', periodId).order('seq_no')
  const l = await supabase.from('pms_one_to_one').select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack')
    .eq('employee_id', employeeId).eq('period_id', periodId).order('discussion_date', { ascending: true })
  const r = await supabase.from('pms_reviews').select('goal_id,rater_role,rating,achievement_value,comments')
    .eq('employee_id', employeeId).eq('period_id', periodId)
  const f = await supabase.from('pms_feedback').select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
    .eq('employee_id', employeeId).eq('period_id', periodId).maybeSingle()
  return {
    goals: (g.data ?? []) as Record<string, unknown>[],
    logs: (l.data ?? []) as unknown as Log[],
    reviews: (r.data ?? []) as Record<string, unknown>[],
    feedback: f.error ? null : (f.data as Record<string, unknown> | null),
  }
}

/** Returns the banner message the website shows. */
export async function submitKras(employeeId: string, periodId: string, kras: Kra[]): Promise<{ ok: boolean; msg: string }> {
  const { error } = await supabase.from('pms_employee_goals').insert(
    kras.map(k => ({ ...k, employee_id: employeeId, period_id: periodId, status: 'PENDING_RM_APPROVAL' })))
  if (!error) return { ok: true, msg: 'Sent to your reporting manager.' }
  return { ok: false, msg: missing(error) ? 'The performance module is not live yet: migration 066 has not been applied.' : error.message }
}

export interface SelfRow {
  goalId: string; title: string; weightage: number; category: Kra['category']
  achievement: string; rating: number | null; comment: string
}
export async function submitSelf(employeeId: string, periodId: string, rows: SelfRow[]): Promise<string | null> {
  const { error } = await supabase.from('pms_reviews').upsert(rows.map(r => ({
    period_id: periodId, employee_id: employeeId, goal_id: r.goalId,
    rater_id: employeeId, rater_role: 'SELF',
    achievement_value: r.achievement || null, rating: r.rating,
    comments: r.comment || null, submitted: true, submitted_at: new Date().toISOString(),
  })), { onConflict: 'period_id,employee_id,goal_id,rater_role' })
  return error ? error.message : null
}

export async function logDiscussion(employeeId: string, periodId: string, l: Log): Promise<string | null> {
  const { error } = await supabase.from('pms_one_to_one').insert({
    period_id: periodId, employee_id: employeeId,
    discussion_type: l.discussion_type, discussion_date: l.discussion_date,
    mode: l.mode, discussion_points: l.discussion_points,
    employee_ack: true, employee_ack_at: new Date().toISOString(),
  })
  return error ? error.message : null
}

// ── useRoster (Performance.tsx) — the frozen chain on pms_overall_rating ──
export async function loadRoster(employeeId: string, periodId: string, as: 'rm' | 'hod'): Promise<TeamMember[]> {
  const q = supabase.from('pms_overall_rating')
    .select('employee_id,workflow_status,kra_count,total_weightage,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,employment_flag')
    .eq('period_id', periodId)
  const { data } = as === 'hod' ? await q.eq('hod_id', employeeId) : await q.or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)
  if (!data?.length) return []
  const ids = data.map((d: any) => d.employee_id)
  const { data: emps } = await supabase.from('employees').select('id,emp_code,full_name,date_of_leaving').in('id', ids)
  const byId = new Map((emps ?? []).map((e: any) => [e.id, e as Record<string, unknown>]))
  return data.map((d: any) => {
    const e = byId.get(d.employee_id)
    return {
      employeeId: String(d.employee_id),
      code: String(e?.emp_code ?? ''),
      name: String(e?.full_name ?? 'Unknown'),
      dateOfLeaving: (e?.date_of_leaving as string | null) ?? null,
      flagOverride: (d.employment_flag as Flag | null) ?? null,
      kraCount: Number(d.kra_count) || 0,
      totalWeightage: Number(d.total_weightage) || 0,
      oneToOneDone: String(d.workflow_status ?? '') !== 'NOT_STARTED' && Number(d.total_weightage) === DEFAULT_RULES.totalWeightage,
      selfSubmitted: d.self_score != null,
      selfScore: d.self_score == null ? null : Number(d.self_score),
      rmL1Score: d.rm_l1_score == null ? null : Number(d.rm_l1_score),
      rmL2Score: d.rm_l2_score == null ? null : Number(d.rm_l2_score),
      finalRating: d.final_rating == null ? null : Number(d.final_rating),
      finalised: d.final_rating != null,
    }
  })
}
