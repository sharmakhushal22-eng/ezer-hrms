// app/api/ess/pms/route.ts — the employee's own side of the appraisal cycle.
//
// WHY THIS ROUTE EXISTS
//
// Performance is the one module where the rules are genuinely intricate —
// seven stages, two one-to-one gates, a weightage lock, an eligibility flag
// and a publish rule that exists so a rating never reaches somebody before the
// conversation does. All of it already lives in lib/pms/cycle.ts and
// lib/pms/oneToOne.ts as pure functions over data: no Supabase, no clock, no
// React. That is exactly what makes them safe to run here.
//
// So this route imports those rules rather than restating them, and the
// clients render the answer. The alternative — a second implementation in
// Dart — is the mistake Leave already made once, where a Friday-to-Monday
// request counted four days on the phone and two on the web.
//
// WHAT THE CLIENTS GET
//
// The stage, its state, and what is owed next, already decided. The KRAs with
// every rater's score attached. The one-to-one log with placeholders for a
// mandatory discussion that has not happened, so its absence is visible rather
// than merely not-listed. The result, and the feedback ONLY when HR has made
// it visible.
//
// Read-only on purpose. Writing KRAs and self-ratings is a desk job with a
// weightage validator and an approval chain behind it; the phone shows where
// the cycle stands, and the portal is where it is driven.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import {
  STAGES, DEFAULT_RULES, settled, currentStage, stageStates, nextAction, kraSetValid,
  type Progress, type Rules, type Period as CyclePeriod, type StageKey,
} from '@/lib/pms/cycle'
import { canLockWeightage, canPublishResult, logRows, type Log } from '@/lib/pms/oneToOne'

export const dynamic = 'force-dynamic'

interface PeriodRow {
  id: string
  period_code: string | null
  period_name: string | null
  financial_year: string | null
  status: string | null
  period_start: string | null
  period_end: string | null
  kra_window_from: string | null
  kra_window_to: string | null
  self_rating_from: string | null
  self_rating_to: string | null
  rm_review_from: string | null
  rm_review_to: string | null
  finalise_from: string | null
  finalise_to: string | null
  result_publish_date: string | null
  policy_id: string | null
}
interface PolicyRow {
  id: string
  min_kra_count: number | null
  max_kra_count: number | null
  total_weightage: number | null
  min_weightage_per_kra: number | null
  one_to_one_mandatory: boolean | null
  self_rating_mandatory: boolean | null
  rating_scale_type: string | null
}
interface GoalRow {
  id: string
  seq_no: number | null
  kra_title: string | null
  kpi_metric: string | null
  target_value: string | null
  category: string | null
  weightage: number | null
  status: string | null
}
interface ReviewRow {
  goal_id: string
  rater_role: string
  rating: number | null
  achievement_value: string | null
  comments: string | null
}
interface OverallRow {
  kra_count: number | null
  total_weightage: number | null
  self_score: number | null
  rm_l1_score: number | null
  rm_l2_score: number | null
  hod_score: number | null
  final_score: number | null
  final_rating: string | null
  final_rating_code: string | null
  self_vs_final_gap: number | null
  workflow_status: string | null
  published_at: string | null
  employee_ack: boolean | null
  employee_ack_at: string | null
  is_eligible: boolean | null
  ineligible_reason: string | null
}
interface FeedbackRow {
  appreciation_remark: string | null
  improvement_feedback: string | null
  development_plan: string | null
  visible_to_employee: boolean | null
}
interface ScaleRow {
  rating_value: number | null
  rating_code: string | null
  rating_label: string | null
  score_from: number | null
  score_to: number | null
  colour_hex: string | null
}

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : [])
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
/** The IST calendar date the cycle's windows are written against. */
const istToday = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

const window = (from: string | null, to: string | null) =>
  from && to ? { from, to } : undefined

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const today = istToday()

  const { data: empRow } = await sb.from('employees')
    .select('company_id').eq('id', me).maybeSingle()
  const companyId = (empRow as { company_id?: string | null } | null)?.company_id ?? null

  // The period being looked at: the company's most recent one. The cycle's own
  // windows say where it is; `status` is not read as a stage, because a stored
  // stage is a second source of truth that drifts the first time anything is
  // backdated (cycle.ts says so at length, and it is right).
  const { data: periodRow } = companyId
    ? await sb.from('pms_periods')
        .select('id, period_code, period_name, financial_year, status, period_start, period_end, kra_window_from, kra_window_to, self_rating_from, self_rating_to, rm_review_from, rm_review_to, finalise_from, finalise_to, result_publish_date, policy_id')
        .eq('company_id', companyId)
        .order('period_start', { ascending: false, nullsFirst: false })
        .limit(1).maybeSingle()
    : { data: null }

  const period = (periodRow ?? null) as PeriodRow | null
  if (!period) {
    return NextResponse.json({
      period: null, stage: null, stages: [], kras: [], one_to_ones: [], result: null,
      diagnostics: { noCompany: !companyId, noPeriod: true, noKras: true, noOneToOnes: true, noResult: true },
    })
  }

  const [policyR, goalR, logR, reviewR, overallR, feedbackR, scaleR] = await Promise.all([
    period.policy_id
      ? sb.from('pms_policies')
          .select('id, min_kra_count, max_kra_count, total_weightage, min_weightage_per_kra, one_to_one_mandatory, self_rating_mandatory, rating_scale_type')
          .eq('id', period.policy_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from('pms_employee_goals')
      .select('id, seq_no, kra_title, kpi_metric, target_value, category, weightage, status')
      .eq('employee_id', me).eq('period_id', period.id).order('seq_no'),
    sb.from('pms_one_to_one')
      .select('id, discussion_type, discussion_date, mode, discussion_points, employee_ack, manager_ack')
      .eq('employee_id', me).eq('period_id', period.id).order('discussion_date', { ascending: true }),
    sb.from('pms_reviews')
      .select('goal_id, rater_role, rating, achievement_value, comments')
      .eq('employee_id', me).eq('period_id', period.id),
    sb.from('pms_overall_rating')
      .select('kra_count, total_weightage, self_score, rm_l1_score, rm_l2_score, hod_score, final_score, final_rating, final_rating_code, self_vs_final_gap, workflow_status, published_at, employee_ack, employee_ack_at, is_eligible, ineligible_reason')
      .eq('employee_id', me).eq('period_id', period.id).maybeSingle(),
    sb.from('pms_feedback')
      .select('appreciation_remark, improvement_feedback, development_plan, visible_to_employee')
      .eq('employee_id', me).eq('period_id', period.id).maybeSingle(),
    companyId
      ? sb.from('pms_rating_scale')
          .select('rating_value, rating_code, rating_label, score_from, score_to, colour_hex')
          .eq('company_id', companyId).eq('is_active', true).order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  const policy = (policyR.data ?? null) as PolicyRow | null
  const goals = rows<GoalRow>(goalR.data)
  const logs = rows<Log>(logR.data)
  const reviews = rows<ReviewRow>(reviewR.data)
  const overall = (overallR.data ?? null) as OverallRow | null
  const feedback = (feedbackR.data ?? null) as FeedbackRow | null

  // The policy's own numbers where it has them; the shipped defaults where it
  // does not, so a screen rendered before config lands still teaches the right
  // rules rather than looser invented ones.
  const rules: Rules = {
    minKra: policy?.min_kra_count ?? DEFAULT_RULES.minKra,
    maxKra: policy?.max_kra_count ?? DEFAULT_RULES.maxKra,
    totalWeightage: policy?.total_weightage ?? DEFAULT_RULES.totalWeightage,
    minWeightagePerKra: policy?.min_weightage_per_kra ?? DEFAULT_RULES.minWeightagePerKra,
  }

  const ratingOf = (goalId: string, role: string): number | null => {
    const row = reviews.find(x => String(x.goal_id) === goalId && x.rater_role === role)
    return row?.rating === null || row?.rating === undefined ? null : Number(row.rating)
  }

  const kras = goals.map(g => ({
    id: g.id,
    seq_no: Number(g.seq_no ?? 0),
    title: g.kra_title ?? '',
    metric: g.kpi_metric ?? '',
    target: g.target_value ?? '',
    category: g.category ?? 'BUSINESS',
    weightage: num(g.weightage),
    status: g.status ?? null,
    self: ratingOf(g.id, 'SELF'),
    rm_l1: ratingOf(g.id, 'RM_L1'),
    rm_l2: ratingOf(g.id, 'RM_L2'),
    final: ratingOf(g.id, 'HOD') ?? ratingOf(g.id, 'RM_L2') ?? ratingOf(g.id, 'RM_L1'),
    achievement: reviews.find(x => String(x.goal_id) === g.id && x.rater_role === 'SELF')?.achievement_value ?? null,
  }))

  const weightageTotal = kras.reduce((s, k) => s + k.weightage, 0)
  const lockGate = canLockWeightage(logs)
  const publishGate = canPublishResult(logs)
  const published = !!feedback?.visible_to_employee || overall?.final_rating != null

  // Exactly the progress the web builds, so both sides land on the same stage.
  const progress: Progress = settled({
    kraCount: goals.length,
    weightageTotal,
    kraSubmitted: goals.length > 0,
    kraApproved: goals.length > 0 && goals.every(g => g.status === 'LOCKED'),
    oneToOneLogged: logs.length > 0,
    oneToOneBothConfirmed: lockGate.open,
    selfSubmitted: !!(overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED'
      && overall.self_score != null),
    rmL1Done: kras.some(k => k.rm_l1 !== null),
    rmL2Done: kras.some(k => k.rm_l2 !== null),
    finalised: overall?.final_rating != null,
    published,
  })

  const cyclePeriod: CyclePeriod = {
    label: period.period_name ?? period.period_code ?? period.financial_year ?? 'This cycle',
    kra: window(period.kra_window_from, period.kra_window_to),
    self: window(period.self_rating_from, period.self_rating_to),
    review: window(period.rm_review_from, period.rm_review_to),
    finalise: window(period.finalise_from, period.finalise_to),
    publishedOn: period.result_publish_date,
  }

  const states = stageStates(cyclePeriod, progress, today)
  const at: StageKey = currentStage(progress)
  const stage = STAGES.find(s => s.key === at) ?? STAGES[0]

  // The employee's own side only. Manager and HOD queues are a portal job, so
  // no reportee counts are passed and no manager action can come back.
  const action = nextAction(cyclePeriod, progress, { isEmployee: true }, {}, today, rules)

  return NextResponse.json({
    period: {
      id: period.id,
      label: cyclePeriod.label,
      code: period.period_code,
      financial_year: period.financial_year,
      status: period.status,
      starts_on: period.period_start,
      ends_on: period.period_end,
      windows: {
        kra: cyclePeriod.kra ?? null,
        self: cyclePeriod.self ?? null,
        review: cyclePeriod.review ?? null,
        finalise: cyclePeriod.finalise ?? null,
      },
      result_publish_date: period.result_publish_date,
    },
    policy: {
      min_kra: rules.minKra,
      max_kra: rules.maxKra,
      total_weightage: rules.totalWeightage,
      min_weightage_per_kra: rules.minWeightagePerKra,
      one_to_one_mandatory: policy?.one_to_one_mandatory ?? true,
      self_rating_mandatory: policy?.self_rating_mandatory ?? true,
    },
    stage: { key: stage.key, n: stage.n, label: stage.label, blurb: stage.blurb },
    stages: STAGES.map(s => ({ key: s.key, n: s.n, label: s.label, blurb: s.blurb, state: states[s.key] })),
    // Whatever the rule module decided is owed next, passed through as it came.
    next_action: action,
    kras,
    weightage_total: weightageTotal,
    kra_set_valid: kraSetValid(progress, rules),
    // Placeholders included, so a mandatory discussion that never happened is
    // visible rather than simply absent.
    one_to_ones: logRows(logs),
    // `because` keeps the rule module's own word for it rather than inventing
    // a third name for the same sentence.
    gates: {
      weightage_lock: { open: lockGate.open, because: lockGate.because },
      publish: { open: publishGate.open, because: publishGate.because },
    },
    result: overall,
    // Feedback is HR's to release. Until it is visible, it does not leave the
    // server — a rating that reaches somebody before the conversation does is
    // how an appraisal turns into a grievance.
    feedback: feedback?.visible_to_employee
      ? {
          appreciation: feedback.appreciation_remark,
          improvement: feedback.improvement_feedback,
          development_plan: feedback.development_plan,
        }
      : null,
    rating_scale: rows<ScaleRow>(scaleR.data),
    diagnostics: {
      noCompany: !companyId,
      noPeriod: false,
      noPolicy: !policy,
      noKras: !goals.length,
      noOneToOnes: !logs.length,
      noResult: !overall,
      notPublished: !published,
    },
  })
}
