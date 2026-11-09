// src/features/performance/logic.ts — the pure glue between the database rows
// and the Performance screens. It is the shaping the website does inside
// components/ess/Performance.tsx and components/pms/ManagerTabs.tsx, which are
// DOM components and cannot be imported here. Every rule is called from
// @web/pms/* (kpi, scoring, training, team, cycle), never restated.
// Unit-tested in __tests__/logic.test.ts.
import type { Category, Kra } from '@web/pms/kra'
import { blankKpi, kraRating, selfKey, shareOf, type Kpi } from '@web/pms/kpi'
import { DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { checkRaterRemark, compareRatings, DEFAULT_BANDS, ratingTone, type Band, type CompareSummary, type Line, type RaterRole, type RemarkCheck } from '@web/pms/scoring'
import { checkPip, checkRecognition, checkTrainingBlock, type PipIntent, type RecognitionIntent, type TrainingCategory } from '@web/pms/training'
import type { RatingContext } from '@web/pms/trainingAi'
import type { QueueRow, TeamMember } from '@web/pms/team'

export type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown) => String(v ?? '')

// ── the policy's KRA and KPI rules (usePeriod `rules`) ───────────────────
export interface PolicyRules {
  min_kra_count?: number | null; max_kra_count?: number | null
  total_weightage?: number | null; min_weightage_per_kra?: number | null
  min_kpi_per_kra?: number | null; max_kpi_per_kra?: number | null
}
/** DEFAULT_RULES only when no policy loaded; a missing column falls back one by one. */
export function rulesOf(p: PolicyRules | null | undefined): Rules {
  if (!p) return DEFAULT_RULES
  return {
    minKra: Number(p.min_kra_count) || DEFAULT_RULES.minKra,
    maxKra: Number(p.max_kra_count) || DEFAULT_RULES.maxKra,
    totalWeightage: Number(p.total_weightage) || DEFAULT_RULES.totalWeightage,
    minWeightagePerKra: Number(p.min_weightage_per_kra) || DEFAULT_RULES.minWeightagePerKra,
    minKpi: Number(p.min_kpi_per_kra) || DEFAULT_RULES.minKpi,
    maxKpi: Number(p.max_kpi_per_kra) || DEFAULT_RULES.maxKpi,
  }
}

// ── the employee's KRA form (MySide) ─────────────────────────────────────
/** A new KRA comes with one blank KPI: a KRA with no measure cannot be rated. */
export function blankKra(seq: number): Kra {
  return { seq_no: seq, kra_title: '', kpi_metric: '', target_value: '', category: 'BUSINESS', weightage: 0, kpis: [blankKpi(1)] }
}

const kpisOfGoal = (kpis: Row[], goalId: string) =>
  kpis.filter(x => String(x.goal_id) === goalId).sort((a, b) => Number(a.seq_no) - Number(b.seq_no))

/** Saved KRAs with their KPIs (220). A row with no KPI rows gets one built from the KRA's own columns. */
export function krasFromRows(goals: Row[], kpis: Row[]): Kra[] {
  return goals.map(g => {
    const mine: Kpi[] = kpisOfGoal(kpis, String(g.id)).map(x => ({
      id: String(x.id), seq_no: Number(x.seq_no), kpi_metric: str(x.kpi_metric), target_value: str(x.target_value), weightage: Number(x.weightage) || 0,
    }))
    return {
      seq_no: Number(g.seq_no), kra_title: str(g.kra_title), kpi_metric: str(g.kpi_metric), target_value: str(g.target_value),
      category: str(g.category || 'BUSINESS') as Category, weightage: Number(g.weightage) || 0,
      kpis: mine.length ? mine : [{ seq_no: 1, kpi_metric: str(g.kpi_metric), target_value: str(g.target_value), weightage: Number(g.weightage) || 0 }],
    }
  })
}

/** The employee's rating of one KPI while they write it, keyed by selfKey(kraSeq, kpiSeq). */
export interface KraSelf { achievement: string; rating: number | null; comment: string }
export const EMPTY_SELF: KraSelf = { achievement: '', rating: null, comment: '' }

/** selfKey → their saved SELF review, joined kpi.id → review.kpi_id. */
export function seedSelf(goals: Row[], kpis: Row[], reviews: Row[]): Record<string, KraSelf> {
  const out: Record<string, KraSelf> = {}
  for (const g of goals) {
    for (const x of kpisOfGoal(kpis, String(g.id))) {
      const row = reviews.find(r => String(r.kpi_id) === String(x.id) && r.rater_role === 'SELF')
      out[selfKey(Number(g.seq_no), Number(x.seq_no))] = {
        achievement: str(row?.achievement_value), rating: num(row?.rating), comment: str(row?.comments),
      }
    }
  }
  return out
}

export interface SelfRow {
  goalId: string; kpiId: string; title: string
  /** The KPI's share of the appraisal: its KRA's weightage split equally (222). */
  weightage: number
  category: Category; achievement: string; rating: number | null; comment: string
}
/** One row per KPI — that is what carries a rating. "KRA · KPI" so a flat list still names the objective. */
export function selfRowsOf(goals: Row[], kpis: Row[], reviews: Row[]): SelfRow[] {
  return goals.flatMap(g => {
    const list = kpisOfGoal(kpis, String(g.id))
    return list.map(x => {
      const row = reviews.find(r => String(r.kpi_id) === String(x.id) && r.rater_role === 'SELF')
      const metric = str(x.kpi_metric).trim()
      return {
        goalId: String(g.id), kpiId: String(x.id),
        title: metric ? `${str(g.kra_title)} · ${metric}` : str(g.kra_title),
        weightage: shareOf(Number(g.weightage) || 0, list.length),
        category: str(g.category || 'BUSINESS') as Category,
        achievement: str(row?.achievement_value), rating: num(row?.rating), comment: str(row?.comments),
      }
    })
  })
}

// ── every rung's rating of a KRA, rolled up from its measures (222) ──────
export interface RoleRating { rating: number | null; comment: string; achievement: string }
const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100)

/** goal_id → role → the plain mean of that role's measure ratings, every comment and achievement joined. */
export function byGoalAndRole(reviews: Row[]): Map<string, Partial<Record<RaterRole, RoleRating>>> {
  const acc = new Map<string, Map<RaterRole, { ratings: number[]; comments: string[]; achievements: string[] }>>()
  for (const row of reviews) {
    const k = String(row.goal_id)
    const role = String(row.rater_role) as RaterRole
    if (!acc.has(k)) acc.set(k, new Map())
    const forGoal = acc.get(k)!
    const cur = forGoal.get(role) ?? { ratings: [], comments: [], achievements: [] }
    if (row.rating != null) cur.ratings.push(Number(row.rating))
    const c = str(row.comments).trim()
    if (c) cur.comments.push(c)
    const a = str(row.achievement_value).trim()
    if (a) cur.achievements.push(a)
    forGoal.set(role, cur)
  }
  const out = new Map<string, Partial<Record<RaterRole, RoleRating>>>()
  for (const [k, roles] of acc) {
    const o: Partial<Record<RaterRole, RoleRating>> = {}
    for (const [role, v] of roles) o[role] = { rating: mean(v.ratings), comment: v.comments.join(' · '), achievement: v.achievements.join(' · ') }
    out.set(k, o)
  }
  return out
}

/** My Result / My Analytics, one line per KRA. The KRA's rating per role is the mean of its measures. */
export function resultLines(goals: Row[], reviews: Row[]): Line[] {
  const by = byGoalAndRole(reviews)
  return goals.map(g => {
    const r = by.get(String(g.id)) ?? {}
    const rv = (k: RaterRole) => r[k]?.rating ?? null
    return {
      goalId: String(g.id), title: str(g.kra_title), category: str(g.category || 'BUSINESS') as Category,
      weightage: Number(g.weightage) || 0,
      self: rv('SELF'), rmL1: rv('RM_L1'), rmL2: rv('RM_L2'), final: rv('HOD') ?? rv('RM_L2') ?? rv('RM_L1'),
    }
  })
}

/** The rungs Team Ratings reports, in chain order (ManagerTabs.tsx CHAIN_RATERS). */
export const CHAIN_RATERS: RaterRole[] = ['RM_L1', 'RM_L2', 'HOD']
export interface RateRow {
  goalId: string; title: string; category: Category; weightage: number; achievement: string
  by: Partial<Record<RaterRole, { rating: number | null; comment: string }>>
}
export function rateRowsOf(goals: Row[], reviews: Row[]): RateRow[] {
  const by = byGoalAndRole(reviews)
  return goals.map(g => {
    const b = by.get(String(g.id)) ?? {}
    return {
      goalId: String(g.id), title: str(g.kra_title), category: str(g.category || 'BUSINESS') as Category,
      weightage: Number(g.weightage) || 0,
      achievement: b.SELF?.achievement || CHAIN_RATERS.map(x => b[x]?.achievement).find(Boolean) || '',
      by: b,
    }
  })
}

// ── the reviewer's panel (openKras / KraDetail / KraStepper) ─────────────
// KpiLine / KraLine / measuresOf copied from components/pms/ManagerTabs.tsx.
export interface KpiLine {
  kpiId: string; seqNo: number; metric: string; target?: string | null
  /** Its KRA's weightage divided by how many measures the KRA has. */
  share: number
  achievement?: string | null; selfRating?: number | null; selfComment?: string | null
}
export interface KraLine {
  goalId?: string; seqNo: number; title: string
  kpi?: string | null; target?: string | null; category?: string | null
  weightage: number; status?: string | null; source?: string | null
  achievement?: string | null; selfRating?: number | null; selfComment?: string | null
  kpis?: KpiLine[]
}
export function kraLinesOf(goals: Row[], kpis: Row[], selfReviews: Row[]): KraLine[] {
  const selfByKpi = new Map(selfReviews.filter(r => r.kpi_id).map(r => [String(r.kpi_id), r]))
  const selfBy = new Map(selfReviews.map(r => [String(r.goal_id), r]))
  return goals.map(x => {
    const s = selfBy.get(String(x.id))
    const list = kpisOfGoal(kpis, String(x.id))
    return {
      goalId: String(x.id), seqNo: Number(x.seq_no), title: str(x.kra_title),
      kpi: (x.kpi_metric as string) ?? null, target: (x.target_value as string) ?? null, category: (x.category as string) ?? null,
      weightage: Number(x.weightage) || 0, status: (x.status as string) ?? null, source: (x.source as string) ?? null,
      achievement: (s?.achievement_value as string) ?? null, selfRating: num(s?.rating), selfComment: (s?.comments as string) ?? null,
      kpis: list.map(row => {
        const sk = selfByKpi.get(String(row.id))
        return {
          kpiId: String(row.id), seqNo: Number(row.seq_no), metric: str(row.kpi_metric), target: (row.target_value as string) ?? null,
          share: shareOf(Number(x.weightage) || 0, list.length),
          achievement: (sk?.achievement_value as string) ?? null, selfRating: num(sk?.rating), selfComment: (sk?.comments as string) ?? null,
        }
      }),
    }
  })
}

/** This rater's ratings and comments, keyed on kpi_id. */
export type Rate = Record<string, { rating: number | null; comment: string }>
export function mineOf(rows: Row[]): Rate {
  return Object.fromEntries(rows.filter(r => r.kpi_id).map(r => [String(r.kpi_id), { rating: num(r.rating), comment: str(r.comments) }]))
}

export function measuresOf(lines: KraLine[] | null): { kra: KraLine; kpi: KpiLine }[] {
  return (lines ?? []).flatMap(kra => (kra.kpis ?? []).map(kpi => ({ kra, kpi })))
}

/** Theirs against yours, one row per measure, each carrying its share. */
export function compareFor(lines: KraLine[] | null, rate: Rate): CompareSummary {
  return compareRatings(measuresOf(lines).map(({ kra, kpi }) => ({
    goalId: kpi.kpiId,
    title: `${kra.seqNo}. ${kra.title || 'untitled'} · ${kpi.metric}`,
    weightage: kpi.share,
    self: kpi.selfRating ?? null,
    mine: rate[kpi.kpiId]?.rating ?? null,
    comment: rate[kpi.kpiId]?.comment ?? null,
  })))
}

const asKpis = (l: KraLine): Kpi[] => (l.kpis ?? []).map(k => ({ id: k.kpiId, seq_no: k.seqNo, kpi_metric: k.metric, target_value: '' }))
/** One KRA in the stepper: how many of its measures this rater scored, and its rolled-up rating (kraRating). */
export function kraProgress(l: KraLine | undefined, rate: Rate) {
  const of = (l?.kpis ?? []).length
  const done = (l?.kpis ?? []).filter(k => rate[k.kpiId]?.rating != null).length
  return { done, of, full: of > 0 && done === of, rollup: l ? kraRating(asKpis(l), k => rate[k.id!]?.rating ?? null) : null }
}

/** What a progress chip says about one KRA: every measure rated and none missing a reason. */
export function kraChip(l: KraLine, cmp: CompareSummary) {
  const own = cmp.lines.filter(c => (l.kpis ?? []).some(k => k.kpiId === c.goalId))
  const needs = own.some(c => c.needsReason && !c.hasReason)
  const rated = own.filter(c => c.mine != null).length
  return { rated, of: own.length, needs, done: own.length > 0 && rated === own.length && !needs }
}

/** One row of the training block (ManagerTabs.tsx TrainingDraft). */
export interface TrainingDraft { trainingName: string; category: TrainingCategory; details: string }
export const EMPTY_TRAINING: TrainingDraft = { trainingName: '', category: 'TECHNICAL', details: '' }

/** Everything the approval gate at the foot of the panel checks, in one place. */
export interface PanelGate {
  ready: boolean; allRated: boolean; rated: number; total: number; ticked: boolean
  reasoned: boolean; remark: RemarkCheck; trainingFaults: string[]; pipFault: string | null; recFault: string | null
  frOk: boolean; fr: number | null; lo: number; hi: number
}
export function panelGate(o: {
  cmp: CompareSummary; alreadyConfirmed: boolean; confirmed: boolean; finalises: boolean; finalRating: string
  bands: Band[]; overall: string; training: TrainingDraft[]; pip: PipIntent; recog: RecognitionIntent
}): PanelGate {
  const rated = o.cmp.lines.filter(l => l.mine != null).length
  const total = o.cmp.total
  const allRated = total > 0 && rated === total
  const ticked = o.alreadyConfirmed || o.confirmed
  const lo = o.bands.length ? Math.min(...o.bands.map(x => x.value)) : 1
  const hi = o.bands.length ? Math.max(...o.bands.map(x => x.value)) : 5
  const fr = o.finalRating === '' ? null : Number(o.finalRating)
  const frOk = !o.finalises || (fr !== null && fr >= lo && fr <= hi)
  const reasoned = o.cmp.missingReasons.length === 0
  const remark = checkRaterRemark(o.cmp.myScore, o.overall, o.bands)
  const trainingFaults = checkTrainingBlock(o.training)
  const pipFault = checkPip(o.pip)
  const recFault = checkRecognition(o.recog)
  const ready = allRated && ticked && frOk && reasoned && remark.ok && trainingFaults.length === 0 && !pipFault && !recFault
  return { ready, allRated, rated, total, ticked, reasoned, remark, trainingFaults, pipFault, recFault, frOk, fr, lo, hi }
}

/**
 * What /api/pms/training-ai is told. Each KRA carries this rater's rolled-up
 * rating and their comments, read on kpi_id — the website's version reads the
 * rating map on goal_id, which since 222 is keyed on kpi_id, so it always sent
 * no ratings (noted in the report).
 */
export function trainingContext(m: { name: string; code: string }, lines: KraLine[] | null, rate: Rate, cmp: CompareSummary, o: {
  overall: string; bands: Band[]; pip: PipIntent; recog: RecognitionIntent
}): RatingContext {
  return {
    employeeName: m.name, employeeCode: m.code,
    overallRating: cmp.myScore,
    scaleMax: o.bands.length ? Math.max(...o.bands.map(b => b.value)) : 5,
    overallRemark: o.overall,
    kras: (lines ?? []).map(l => {
      const comments = (l.kpis ?? []).map(k => (rate[k.kpiId]?.comment ?? '').trim()).filter(Boolean)
      return { title: l.title, weightage: l.weightage, rating: kraProgress(l, rate).rollup, comment: comments.length ? comments.join(' · ') : null }
    }),
    recognitionNote: o.recog.wanted ? o.recog.note : null,
    pipReason: o.pip.wanted ? o.pip.reason : null,
  }
}

// ── queues ───────────────────────────────────────────────────────────────
/** Rows stuck on the same thing, said once (ManagerTabs.tsx GroupedQueue). Order of first appearance kept. */
export function groupQueue<T extends QueueRow>(rows: T[]): { key: string; head: string; why: string; rows: T[] }[] {
  const groups: { key: string; head: string; why: string; rows: T[] }[] = []
  for (const r of rows) {
    const g = groups.find(x => x.key === r.next)
    if (g) { g.rows.push(r); continue }
    const key = r.next ?? ''
    const cut = key.indexOf('. ')
    groups.push({ key, head: cut < 0 ? key : key.slice(0, cut + 1), why: cut < 0 ? '' : key.slice(cut + 2), rows: [r] })
  }
  return groups
}

/** Published Results: released rows only, most recently released first. */
export function publishedFirst<T extends TeamMember>(members: T[]): T[] {
  return members.filter(m => m.published).sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
}

// ── the score as colour (scoring.ts ratingTone, resolved for React Native) ──
// ratingTone names CSS custom properties and leaves the blending to CSS
// color-mix(in oklab, …). Native has no CSS, so the stops are resolved here and
// blended in oklab, exactly as the browser does.
export interface RampStops { low: string; mid: string; high: string }

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toLin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
const fromLin = (x: number) => { const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255) }
function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromOklab([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return '#' + rgb.map(fromLin).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
/** CSS color-mix(in oklab, a, b pct%): pct is b's share, 0–100. A colour that is not #RRGGBB comes back as `a`. */
export function mixOklab(a: string, b: string, pct: number): string {
  const ra = hexToRgb(a), rb = hexToRgb(b)
  if (!ra || !rb) return a
  const t = Math.min(1, Math.max(0, pct / 100))
  const oa = toOklab(ra), ob = toOklab(rb)
  return fromOklab([oa[0] + (ob[0] - oa[0]) * t, oa[1] + (ob[1] - oa[1]) * t, oa[2] + (ob[2] - oa[2]) * t])
}
/** The rating's place on the red-yellow-green ramp, normalised to the policy's own bands. Null when not rated. */
export function toneColour(rating: number | null | undefined, bands: Band[] = DEFAULT_BANDS, stops: RampStops): string | null {
  const t = ratingTone(rating, bands)
  if (!t) return null
  const pick = (tok: string) => (tok.endsWith('low') ? stops.low : tok.endsWith('mid') ? stops.mid : stops.high)
  return mixOklab(pick(t.from), pick(t.to), t.mix)
}
