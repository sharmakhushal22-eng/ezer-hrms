// lib/pms/kpi.ts — the KPIs under one KRA, and the weightage they share.
//
// Requested: a KRA can have several KPIs, each with its own rating; the KPIs
// split the KRA's weightage; the total across KRAs stays exactly 100; every
// rung rates every KPI.
//
// ── TWO RULES, ONE TOTAL ─────────────────────────────────────────────────
//
//   Across KRAs      the weightages total EXACTLY 100 — kra.ts, unchanged.
//   Inside a KRA     its KPIs total exactly that KRA's weightage — here.
//
// The second is what keeps the first true. A 30% KRA whose KPIs summed to 40
// would make the real total 110 while checkKras still read 100 off the KRA
// rows and said yes. Neither rule is sufficient alone.
//
// ── WHY SCORING DID NOT CHANGE ───────────────────────────────────────────
//
// score() in scoring.ts takes a flat list of weighted lines and returns the
// weighted mean over the RATED ones. It never cared what a line represented.
// So the KPI change is not a change to scoring at all: `lines()` below turns
// the KRA tree into the same flat list, one entry per KPI instead of one per
// KRA, and score() produces the right number without being touched.
//
// Migration 220 does exactly this on the SQL side, which is why it is
// score-neutral: every existing KRA was given one KPI carrying its whole
// weightage, so the flat list is identical to what it was.
//
// ENGINE COMPUTES, SQL DECIDES. The balance rule exists twice on purpose —
// pms_validate_kpis refuses, this file explains before anybody is refused.

import type { Line } from './scoring.ts'
import type { Category } from './kra.ts'

export interface Kpi {
  /** Present once saved; absent on a row being typed. */
  id?: string
  /** Position within its KRA. Unique per KRA — 220 enforces it. */
  seq_no: number
  kpi_metric: string
  target_value: string
  /**
   * THIS KPI'S SHARE OF ITS KRA, not of the whole appraisal. The KPIs under
   * one KRA add up to that KRA's weightage, and the KRAs add up to 100 — so
   * a number here is directly comparable with a KRA weightage, which is what
   * lets score() treat every KPI in the appraisal as one flat list.
   */
  weightage: number
}

/** The shape this module needs from a KRA. Narrower than kra.ts's Kra on
 *  purpose: nothing here reads a title or a category. */
export interface KraWithKpis {
  seq_no: number
  kra_title: string
  category?: Category
  weightage: number
  kpis: Kpi[]
}

export const MIN_KPI_PER_KRA = 1

export interface KpiFault {
  /** The KRA this is about. */
  seq: number
  /** The KPI, when the fault is about one rather than the set. */
  kpiSeq: number | null
  says: string
}

/** How a KRA's KPIs stand against the weightage they have to fill. */
export interface KpiBalance {
  total: number
  target: number
  /** Positive when there is still weightage to allocate, negative when over. */
  left: number
  count: number
  ok: boolean
}

export function balance(kra: KraWithKpis): KpiBalance {
  const target = Number(kra.weightage) || 0
  const total = (kra.kpis ?? []).reduce((s, k) => s + (Number(k.weightage) || 0), 0)
  return {
    total, target, left: target - total, count: (kra.kpis ?? []).length,
    ok: (kra.kpis ?? []).length >= MIN_KPI_PER_KRA && total === target,
  }
}

/**
 * What is wrong with this KRA's KPIs, if anything.
 *
 * Returns a LIST, unlike chainFault's single sentence: these faults are
 * per-KPI and a reader fixing one wants to see the others. The order is the
 * order to deal with them — the set first, then the rows, because a row-level
 * complaint is noise while the KRA has no KPIs at all.
 */
export function checkKpis(kra: KraWithKpis): KpiFault[] {
  const out: KpiFault[] = []
  const kpis = kra.kpis ?? []
  const b = balance(kra)

  if (kpis.length < MIN_KPI_PER_KRA) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: 'Add a KPI. A KRA is the objective; the KPI is how it is measured, '
          + 'and without one there is nothing to rate.' })
    return out
  }

  if (b.left > 0) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: `These KPIs come to ${b.total} of this KRA's ${b.target}. `
          + `${b.left} still to share out.` })
  } else if (b.left < 0) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: `These KPIs come to ${b.total}, which is ${-b.left} more than `
          + `this KRA's ${b.target}.` })
  }

  for (const k of kpis) {
    if (!String(k.kpi_metric ?? '').trim()) {
      out.push({ seq: kra.seq_no, kpiSeq: k.seq_no,
        says: 'Say how this one is measured.' })
    }
    // ZERO IS NOT A WEIGHTAGE, it is a KPI that cannot affect the rating.
    // Worth refusing rather than quietly carrying: somebody wrote it down
    // meaning it to count.
    if ((Number(k.weightage) || 0) <= 0) {
      out.push({ seq: kra.seq_no, kpiSeq: k.seq_no,
        says: 'Give this a weightage, or remove it — at 0 it cannot move the '
            + 'rating either way.' })
    }
  }
  return out
}

/** Every fault across a whole KRA set, in KRA order. */
export function checkAllKpis(kras: KraWithKpis[]): KpiFault[] {
  return kras.flatMap(checkKpis)
}

/**
 * Spread a KRA's weightage across n KPIs as evenly as whole numbers allow,
 * remainder on the first — the same rule suggestSplit uses for KRAs, so the
 * two screens behave the same way.
 *
 * Offered as a starting point, never applied silently.
 */
export function suggestKpiSplit(kraWeightage: number, n: number): number[] {
  if (n <= 0) return []
  const total = Number(kraWeightage) || 0
  const base = Math.floor(total / n)
  const out = Array(n).fill(base)
  out[0] += total - base * n
  return out
}

/**
 * THE KRA'S OWN RATING, rolled up from its KPIs.
 *
 * Weighted by each KPI's share, over the RATED ones only — the same rule
 * score() applies to the appraisal as a whole. An unrated KPI is left out of
 * the denominator rather than counted as zero: a half-rated KRA shows the
 * average of what has been looked at, not a number dragged down by work
 * nobody has assessed yet.
 *
 * Null when nothing under it is rated, which is how a screen tells "not rated"
 * from "rated badly".
 */
export function kraRating(
  kpis: Kpi[],
  ratingOf: (kpi: Kpi) => number | null | undefined,
): number | null {
  let num = 0, den = 0
  for (const k of kpis ?? []) {
    const v = ratingOf(k)
    if (v === null || v === undefined) continue
    const w = Number(k.weightage) || 0
    num += v * w
    den += w
  }
  return den === 0 ? null : Math.round((num / den) * 100) / 100
}

/** How many of a KRA's KPIs this rater has rated. For "3 of 5 rated". */
export function ratedCount(
  kpis: Kpi[],
  ratingOf: (kpi: Kpi) => number | null | undefined,
): { rated: number; of: number } {
  const list = kpis ?? []
  return { rated: list.filter(k => {
    const v = ratingOf(k); return v !== null && v !== undefined
  }).length, of: list.length }
}

/**
 * The KRA tree flattened into the lines score() already consumes.
 *
 * ONE LINE PER KPI, carrying the KPI's weightage. This is the whole bridge
 * between the new shape and the existing scoring: score() is unchanged and
 * cannot tell the difference, because a weighted mean does not care whether
 * its weights came from four KRAs or from eleven KPIs that add up the same.
 *
 * `goalId` carries the KPI's identity rather than the KRA's, since that is
 * what a rating now belongs to. Where a caller needs the KRA back, the title
 * names both: "Reduce stock variance · Cycle-count variance".
 */
export function lines(
  kras: KraWithKpis[],
  ratings: (kpi: Kpi, kra: KraWithKpis) => Pick<Line, 'self' | 'rmL1' | 'rmL2' | 'final'>,
): Line[] {
  const out: Line[] = []
  for (const kra of kras ?? []) {
    for (const k of kra.kpis ?? []) {
      out.push({
        goalId: k.id ?? `${kra.seq_no}.${k.seq_no}`,
        title: `${kra.kra_title} · ${k.kpi_metric}`.trim(),
        category: (kra.category ?? 'BUSINESS') as Category,
        weightage: Number(k.weightage) || 0,
        ...ratings(k, kra),
      })
    }
  }
  return out
}

/**
 * A new KPI row, ready to type into.
 *
 * Weightage starts at 0 rather than guessing a share: a guess that happens to
 * balance is one nobody checks, and checkKpis refuses 0 with a sentence that
 * says what to do. suggestKpiSplit is there for when somebody wants the even
 * split, by asking for it.
 */
export function blankKpi(seq: number): Kpi {
  return { seq_no: seq, kpi_metric: '', target_value: '', weightage: 0 }
}

/** Renumber after an add or a remove, so seq_no stays 1..n with no holes.
 *  220 makes (goal_id, seq_no) unique, so a hole is a write that fails. */
export function renumber(kpis: Kpi[]): Kpi[] {
  return (kpis ?? []).map((k, i) => ({ ...k, seq_no: i + 1 }))
}

/**
 * HOW A RATING IN PROGRESS IS KEYED, before anything has an id.
 *
 * A KPI being typed has no `id` until it is written, so a draft rating cannot
 * be keyed by one. The KRA's position and the KPI's position within it are
 * stable for the life of the form and unique together — and `renumber` keeps
 * them that way across adds and removes.
 *
 * Exported rather than spelled inline at each end, because the form writes
 * these keys and the save reads them: two places building the same string
 * slightly differently is a rating that silently fails to save. Matches the
 * fallback `lines()` uses for an unsaved row, so the two agree by
 * construction.
 */
export const selfKey = (kraSeq: number, kpiSeq: number) => `${kraSeq}.${kpiSeq}`
