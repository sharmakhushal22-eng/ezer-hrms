// lib/pms/kpi.ts — the KPIs under one KRA, and the share of it they carry.
//
// Requested: a KRA can have several KPIs, each rated on its own. A KPI has NO
// WEIGHTAGE of its own — only KRAs do — and the KRA weightages total no more
// than 100, and exactly 100 before anything can be submitted. Every KRA must
// be rated, by every rung, before the appraisal moves.
//
// ── ONE NUMBER, NOT TWO ──────────────────────────────────────────────────
//
//   Across KRAs      the weightages total EXACTLY 100 to submit — kra.ts.
//   Inside a KRA     its KPIs share that KRA's weightage equally — here.
//
// 220 and 221 gave each KPI a stored weightage that had to sum to its KRA's.
// That was a second balance to keep, on every screen, and it bought nothing:
// the arithmetic below produces the same appraisal score without it. An equal
// share CANNOT fail to add up, so there is no second rule to break.
//
// ── WHY SCORING STILL DID NOT CHANGE ─────────────────────────────────────
//
// score() in scoring.ts takes a flat list of weighted lines and returns the
// weighted mean over the RATED ones. It never cared what a line represented.
// `lines()` below turns the KRA tree into that flat list, one entry per KPI,
// each carrying kra.weightage / n. score() is untouched.
//
// And the change is SCORE-NEUTRAL for everything on record: for a KRA with
// one KPI, w/1 is w, and 220's backfill gave every existing KRA exactly one
// KPI carrying its whole weightage. Migration 222 does the same arithmetic in
// SQL for the same reason.
//
// ── PARTLY RATED IS AN AVERAGE, NOT A ZERO ───────────────────────────────
//
// A KRA with three KPIs of which two are rated shows the average of those
// two. An unrated KPI leaves the divisor rather than counting as zero — the
// rule score() already applies to unrated KRAs. 4 and 5 with one blank is
// 4.5, not 3.0; 3.0 is a verdict nobody gave.
//
// ENGINE COMPUTES, SQL DECIDES. The gates exist twice on purpose — 222's
// pms_unrated_kpis and pms_validate_kpis refuse, this file explains before
// anybody is refused.

import type { Line } from './scoring.ts'
import { checkKras, type Category, type Kra } from './kra.ts'
import { DEFAULT_RULES, type Rules } from './cycle.ts'

export interface Kpi {
  /** Present once saved; absent on a row being typed. */
  id?: string
  /** Position within its KRA. Unique per KRA — 220 enforces it. */
  seq_no: number
  kpi_metric: string
  target_value: string
  /**
   * RETIRED by 222 and read by nothing. The column still exists and still
   * holds whatever was written into it, so the field is kept to describe a
   * row that comes back from the database — but a KPI's share is its KRA's
   * weightage divided by how many KPIs the KRA has, and that is computed,
   * never stored. Reading this is a bug; writing it is dead weight.
   */
  weightage?: number
}

/** The shape this module needs from a KRA. Narrower than kra.ts's Kra on
 *  purpose: nothing here reads anything else off one. */
export interface KraWithKpis {
  seq_no: number
  kra_title: string
  category?: Category
  weightage: number
  kpis: Kpi[]
}

/**
 * THE FLOOR AND CEILING ARE POLICY — 221.
 *
 * Every function here that cares takes `r: Rules = DEFAULT_RULES`, as
 * kra.ts's checkKras/canAdd/canDelete do. The default is a FALLBACK for a
 * screen rendered before the policy loads, never the rule.
 */
export const DEFAULT_MIN_KPI_PER_KRA = DEFAULT_RULES.minKpi
export const DEFAULT_MAX_KPI_PER_KRA = DEFAULT_RULES.maxKpi

/** The ceiling in `pms_policies_kpi_range`. A guard against a typo — 50 where
 *  5 was meant — producing a form nobody can scroll, not an editorial limit. */
export const KPI_PER_KRA_CEILING = 20

/**
 * WHY THIS POLICY'S KPI RANGE CANNOT BE SAVED, OR NULL.
 *
 * ── THE SAME SHAPE AS chainFault, AND FOR THE SAME REASON ────────────────
 *
 * 221 put this rule in the database as CHECK pms_policies_kpi_range:
 *
 *     min_kpi_per_kra >= 1
 *     AND max_kpi_per_kra >= min_kpi_per_kra
 *     AND max_kpi_per_kra <= 20
 *
 * and the database is still what refuses — nothing here weakens that. But a
 * CHECK can only say no. Saving min 6 against max 5 put this in front of an
 * administrator, verbatim:
 *
 *     new row for relation "pms_policies" violates check constraint
 *     "pms_policies_kpi_range"
 *
 * which names no field, no value, and nothing to do about it. Worse, ONE
 * constraint covers THREE different mistakes, so any single translation of
 * its name would have misreported two of them.
 *
 * So this returns the fault for the PAIR, and both sides use it: the browser
 * to explain before the button is pressed, the route to refuse a posted body
 * that never reached the browser. Exactly the chainFault arrangement.
 *
 * ── BOTH NUMBERS, ALWAYS ─────────────────────────────────────────────────
 *
 * The caller passes the pair as it WOULD BE after the edit, not the fields
 * it happens to be changing. A PATCH that sends only max_kpi_per_kra can
 * still break the rule against a stored minimum it never mentioned, and a
 * message about "the value you sent" would then be talking about the wrong
 * number.
 *
 * Returns ONE fault, like chainFault: it is shown against a save button, and
 * the first thing wrong is the thing to fix.
 */
export function policyKpiRangeFault(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  const lo = Number(min), hi = Number(max)

  // A non-number reaches the database as null and trips NOT NULL instead,
  // which is a different and equally unhelpful message.
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return 'Both the minimum and the maximum KPIs per KRA have to be numbers.'
  }
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    return 'KPIs are counted, so both numbers have to be whole.'
  }
  if (lo < 1) {
    return 'The minimum has to be at least 1 — a KRA with no KPIs has '
         + 'nothing to rate, and nobody could submit against it.'
  }
  if (hi < lo) {
    return `The maximum cannot be below the minimum. As it stands a KRA `
         + `would have to hold at least ${lo} KPIs and at most ${hi}, which `
         + `no number satisfies.`
  }
  if (hi > KPI_PER_KRA_CEILING) {
    return `${hi} is past the ceiling of ${KPI_PER_KRA_CEILING}. Each KPI `
         + `takes an equal share of its KRA's weightage, so past twenty the `
         + `shares are too thin to mean anything.`
  }
  return null
}

export interface KpiFault {
  /** The KRA this is about. */
  seq: number
  /** The KPI, when the fault is about one rather than the set. */
  kpiSeq: number | null
  says: string
}

/**
 * THE SHARE ONE KPI CARRIES, as a percentage of the whole appraisal.
 *
 * Not stored anywhere and deliberately not rounded: a 10% KRA with three
 * KPIs gives 3.333…% each, and rounding each to 3.33 would lose 0.01 of the
 * KRA every time. The sum has to come back to the KRA's weightage exactly,
 * because that is what keeps the appraisal total at 100.
 */
export function shareOf(kraWeightage: number, kpiCount: number): number {
  const n = Math.max(0, Math.trunc(kpiCount))
  if (n === 0) return 0
  return (Number(kraWeightage) || 0) / n
}

/**
 * What is wrong with this KRA's KPIs, if anything.
 *
 * Returns a LIST: these faults are per-KPI and somebody fixing one wants to
 * see the others. The order is the order to deal with them — the set first,
 * then the rows, because a row-level complaint is noise while the KRA has
 * the wrong number of KPIs.
 *
 * There is no weightage fault any more. That is the point of 222: equal
 * shares cannot fail to balance, so the only thing left to get wrong is how
 * many there are and whether they say anything.
 */
export function checkKpis(kra: KraWithKpis, r: Rules = DEFAULT_RULES): KpiFault[] {
  const out: KpiFault[] = []
  const kpis = kra.kpis ?? []

  if (kpis.length === 0) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: 'Add a KPI. A KRA is the objective; the KPI is how it is measured, '
          + 'and without one there is nothing to rate.' })
    return out
  }

  // A FLOOR ABOVE ONE NEEDS ITS OWN SENTENCE. "Add a KPI" is right for an
  // empty KRA and useless at two of three: it does not say how many.
  if (kpis.length < r.minKpi) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: `This KRA has ${kpis.length} of the ${r.minKpi} KPIs the policy `
          + `asks for. Add ${r.minKpi - kpis.length} more.` })
    return out
  }

  if (kpis.length > r.maxKpi) {
    out.push({ seq: kra.seq_no, kpiSeq: null,
      says: `This KRA has ${kpis.length} KPIs; the policy allows ${r.maxKpi}. `
          + `Remove ${kpis.length - r.maxKpi}, or merge two measures into one.` })
    return out
  }

  for (const k of kpis) {
    if (!String(k.kpi_metric ?? '').trim()) {
      out.push({ seq: kra.seq_no, kpiSeq: k.seq_no,
        says: 'Say how this one is measured.' })
    }
  }
  return out
}

/** Every fault across a whole KRA set, in KRA order. */
export function checkAllKpis(kras: KraWithKpis[], r: Rules = DEFAULT_RULES): KpiFault[] {
  // `kras.flatMap(checkKpis)` would pass the INDEX as the second argument,
  // so KRA 0 would be checked against a "policy" of 0.
  return kras.flatMap(k => checkKpis(k, r))
}

/**
 * Whether the + button is live, and what to say when it is not.
 *
 * Same shape as kra.ts's canAdd/canDelete so the two forms behave alike: the
 * button is disabled rather than hidden, because a control that vanishes at
 * the limit leaves the reader wondering whether they mis-clicked.
 */
export function canAddKpi(kpis: Kpi[], r: Rules = DEFAULT_RULES):
  { allowed: boolean; reason?: string } {
  const n = (kpis ?? []).length
  return n < r.maxKpi
    ? { allowed: true }
    : { allowed: false,
        reason: `${r.maxKpi} KPIs is the most this policy allows for one KRA. `
              + 'Merge two measures, or raise the limit in Setup and Configuration.' }
}

/**
 * Whether this KPI may be removed.
 *
 * Blocked at the remove rather than reported after it, for kra.ts's reason:
 * letting the row go and then complaining leaves a set that cannot be
 * submitted and no obvious way back, because what they need is the row they
 * just deleted.
 */
export function canRemoveKpi(kpis: Kpi[], r: Rules = DEFAULT_RULES):
  { allowed: boolean; reason?: string } {
  const n = (kpis ?? []).length
  if (n > r.minKpi) return { allowed: true }
  return { allowed: false,
    reason: r.minKpi === 1
      ? 'A KRA needs at least one KPI — there would be nothing to rate.'
      : `${r.minKpi} KPIs is the fewest this policy allows for one KRA. `
      + 'Edit this one instead of removing it.' }
}

/**
 * THE KRA'S OWN RATING, rolled up from its KPIs.
 *
 * A PLAIN MEAN of the rated ones, because the KPIs under a KRA now carry
 * equal share. Weighting by an equal weight is the same as not weighting —
 * (4w + 5w) / 2w = (4 + 5) / 2 — so the weights cancel and are not computed.
 *
 * Unrated KPIs leave the divisor rather than counting as zero. Null when
 * nothing under it is rated, which is how a screen tells "not rated" from
 * "rated badly".
 */
export function kraRating(
  kpis: Kpi[],
  ratingOf: (kpi: Kpi) => number | null | undefined,
): number | null {
  let sum = 0, n = 0
  for (const k of kpis ?? []) {
    const v = ratingOf(k)
    if (v === null || v === undefined) continue
    sum += v
    n += 1
  }
  return n === 0 ? null : Math.round((sum / n) * 100) / 100
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

/** Every KPI in the set, each with the KRA it belongs to. The order the
 *  screens show them in, and the order faults are reported in. */
export function allKpis<T extends KraWithKpis>(kras: T[]): { kra: T; kpi: Kpi }[] {
  return (kras ?? []).flatMap(kra => (kra.kpis ?? []).map(kpi => ({ kra, kpi })))
}

/** How many measures across the whole set this rater has still not rated. */
export function unratedCount(
  kras: KraWithKpis[],
  ratingOf: (kpi: Kpi, kra: KraWithKpis) => number | null | undefined,
): { rated: number; of: number } {
  const all = allKpis(kras)
  const rated = all.filter(({ kra, kpi }) => {
    const v = ratingOf(kpi, kra); return v !== null && v !== undefined
  }).length
  return { rated, of: all.length }
}

/**
 * The KRA tree flattened into the lines score() already consumes.
 *
 * ONE LINE PER KPI, carrying kra.weightage / n. This is the whole bridge
 * between the shape and the existing scoring: score() is unchanged and cannot
 * tell the difference, because a weighted mean does not care whether its
 * weights came from four KRAs or from eleven KPIs that add up the same.
 *
 * `goalId` carries the KPI's identity rather than the KRA's, since that is
 * what a rating belongs to. Where a caller needs the KRA back, the title
 * names both: "Reduce stock variance · Cycle-count variance".
 */
export function lines(
  kras: KraWithKpis[],
  ratings: (kpi: Kpi, kra: KraWithKpis) => Pick<Line, 'self' | 'rmL1' | 'rmL2' | 'final'>,
): Line[] {
  const out: Line[] = []
  for (const kra of kras ?? []) {
    const list = kra.kpis ?? []
    const share = shareOf(kra.weightage, list.length)
    for (const k of list) {
      out.push({
        goalId: k.id ?? `${kra.seq_no}.${k.seq_no}`,
        title: `${kra.kra_title} · ${k.kpi_metric}`.trim(),
        category: (kra.category ?? 'BUSINESS') as Category,
        weightage: share,
        ...ratings(k, kra),
      })
    }
  }
  return out
}

/** A new KPI row, ready to type into. No weightage: it has none. */
export function blankKpi(seq: number): Kpi {
  return { seq_no: seq, kpi_metric: '', target_value: '' }
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
 * slightly differently is a rating that silently fails to save.
 */
export const selfKey = (kraSeq: number, kpiSeq: number) => `${kraSeq}.${kpiSeq}`

// ── the one gate ─────────────────────────────────────────────────────────

/** Everything standing between this KRA set and the next rung. */
export interface SubmitGate {
  ok: boolean
  /** What to fix, in the order to fix it. Empty when ok. */
  faults: string[]
  /** The weightage total, and how far off 100 it is. */
  total: number
  short: number
  /** Measures rated by this person, out of how many there are. */
  rated: number
  of: number
}

/**
 * CAN THIS BE SENT? One function, because it is one question.
 *
 * Requested: "user can not proceed to submit kras without achieving 100%
 * weightage and filling all the minimum kras and kpis", and every KRA must be
 * rated. Three rules that were enforced in three places and checked by the
 * screen in none of them consistently — the submit button read `canSubmit`
 * off checkKras alone, which knows about weightage and nothing about KPIs.
 *
 * The order is the order somebody should deal with them. Weightage and KRA
 * counts first (they change what else needs doing), then KPI counts, then the
 * ratings — rating a set you are about to add a KRA to is wasted work.
 *
 * `ratingOf` is passed in rather than read, so the same function answers for
 * the employee and for each manager. 222's pms_unrated_kpis asks exactly this
 * in SQL, and refuses; this is the half that says so first.
 */
export function submitGate(
  kras: KraWithKpis[],
  r: Rules = DEFAULT_RULES,
  ratingOf?: (kpi: Kpi, kra: KraWithKpis) => number | null | undefined,
): SubmitGate {
  const set = kras ?? []
  const total = set.reduce((s, k) => s + (Number(k.weightage) || 0), 0)

  // checkKras owns the KRA-level rules — count, exactly 100, minimum per KRA,
  // blank titles. Restating them here would be a second copy to drift.
  //
  // THE KRA NUMBER IS PART OF THE SENTENCE, not a separate field. These are
  // rendered as one flat list beside a form of eight or nine rows, and
  // "Say how this one is measured" without a number sends the reader hunting.
  // Set-level faults (seq null) carry no prefix because they are about the
  // set, and "KRA null:" is worse than nothing.
  const kra = checkKras(set as unknown as Kra[], r)
  const faults = kra.faults.map(f => f.seq === null ? f.says : `KRA ${f.seq}: ${f.says}`)

  for (const f of checkAllKpis(set, r)) {
    faults.push(f.kpiSeq === null
      ? `KRA ${f.seq}: ${f.says}`
      : `KRA ${f.seq}, KPI ${f.kpiSeq}: ${f.says}`)
  }

  const { rated, of } = ratingOf
    ? unratedCount(set, ratingOf)
    : { rated: 0, of: 0 }
  if (ratingOf && of > 0 && rated < of) {
    faults.push(`${of - rated} of ${of} measures still need a rating. `
      + 'Every KRA has to be rated before this can be sent.')
  }

  return { ok: faults.length === 0, faults, total, short: total - r.totalWeightage, rated, of }
}
