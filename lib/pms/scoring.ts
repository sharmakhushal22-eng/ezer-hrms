// lib/pms/scoring.ts — turning ratings into a score, and a score into meaning.
// Spec §3.5, §3.6, §4.3, §5.3, and rules 6, 10 and 11 of §11.

import { CATEGORIES, CATEGORY_LABEL, type Category } from './kra.ts'

export const RATER_ROLES = ['SELF', 'RM_L1', 'RM_L2', 'HOD', 'MD'] as const
export type RaterRole = typeof RATER_ROLES[number]

export interface Line {
  goalId: string
  title: string
  category: Category
  weightage: number
  self?: number | null
  rmL1?: number | null
  rmL2?: number | null
  final?: number | null
}

/**
 * The weighted score. Weightages total 100 by rule 3, so this is a plain
 * weighted mean expressed on the rating scale.
 *
 * Unrated lines are EXCLUDED from the denominator rather than counted as
 * zero. Counting them as zero makes a half-finished appraisal read as a
 * terrible one, and that number then shows up on a dashboard next to
 * somebody's name.
 */
export function score(lines: Line[], who: 'self' | 'rmL1' | 'rmL2' | 'final'): number | null {
  let num = 0, den = 0
  for (const l of lines) {
    const v = l[who]
    if (v === null || v === undefined) continue
    num += v * l.weightage
    den += l.weightage
  }
  return den === 0 ? null : Math.round((num / den) * 100) / 100
}

export type GapFlag = 'ALIGNED' | 'MINOR_GAP' | 'MAJOR_GAP'

export interface Gap {
  delta: number | null
  flag: GapFlag
  /** What to do about it, which is the only reason to show a gap at all. */
  says: string
}

/**
 * §3.6 — self versus final, per KRA or overall.
 *
 * A gap of 2 or more is MAJOR_GAP. That is not a judgement about who is
 * right: it means the two of them are measuring the same work differently,
 * and the next one-to-one is where that gets resolved. The wording avoids
 * implying the employee over-rated themselves — the manager may be the one
 * who has not seen the work.
 */
export function gap(self: number | null | undefined, final: number | null | undefined): Gap {
  if (self === null || self === undefined || final === null || final === undefined) {
    return { delta: null, flag: 'ALIGNED', says: 'Not enough ratings in yet to compare.' }
  }
  const delta = Math.round((self - final) * 100) / 100
  const size = Math.abs(delta)
  if (size >= 2) {
    return { delta, flag: 'MAJOR_GAP', says:
      'You and your manager are reading this one very differently. Worth raising in the next one-to-one. Bring the evidence you rated yourself on.' }
  }
  if (size >= 1) {
    return { delta, flag: 'MINOR_GAP', says:
      'A one-point difference. Usually a difference in what "on target" meant, rather than a disagreement about the work.' }
  }
  return { delta, flag: 'ALIGNED', says: 'You and your manager saw this the same way.' }
}

export interface CategoryScore {
  category: Category
  label: string
  weightage: number
  score: number | null
  kraCount: number
}

/** §3.6 and §5.3 — strengths and development areas by category. Categories
 *  with no KRAs are omitted: a category nobody was measured on is not a
 *  weakness, and showing it at zero says it is. */
export function byCategory(lines: Line[], who: 'self' | 'final' = 'final'): CategoryScore[] {
  return CATEGORIES.map(c => {
    const mine = lines.filter(l => l.category === c)
    return {
      category: c, label: CATEGORY_LABEL[c],
      weightage: mine.reduce((s, l) => s + l.weightage, 0),
      score: score(mine, who), kraCount: mine.length,
    }
  }).filter(c => c.kraCount > 0)
}

// ── rating bands ─────────────────────────────────────────────────────────

export interface Band {
  value: number
  label: string
  /** Rule 10 — improvement feedback is mandatory at or below this band. */
  improvementMandatory: boolean
  /** Rule 11 — a comment this short is not a review. */
  minCommentChars: number
  /** The score window this band owns, from pms_rating_scale. Optional because
   *  the built-in fallback below has no ranges — see bandForScore. */
  scoreFrom?: number
  scoreTo?: number
  /** pms_rating_scale.rating_code — 'O' / 'EE' / 'ME' / 'NI' / 'U' / 'NR'. */
  code?: string
}

/**
 * THE FALLBACK, not the configuration.
 *
 * These were the only bands the product ever enforced, and they did not match
 * the ones in the database. pms_rating_scale ships seeded with 200/100/50/200/200
 * minimum comment characters and the labels "Exceeds Expectations" / "Meets
 * Expectations" / "Needs Improvement" / "Unsatisfactory"; this list says
 * 40/30/30/80/120 and "Exceeds" / "Meets" / "Partially meets" / "Below
 * expectations". So an admin raising a minimum saw it saved and saw nothing
 * change, and two screens could name the same rating differently.
 *
 * Kept as the shape to fall back on when the table cannot be read, so the
 * screens still work rather than going blank. Everything that enforces a rule
 * should be given the real bands from `bandsFromScale`.
 */
export const DEFAULT_BANDS: Band[] = [
  { value: 5, label: 'Outstanding',        improvementMandatory: false, minCommentChars: 40 },
  { value: 4, label: 'Exceeds',            improvementMandatory: false, minCommentChars: 30 },
  { value: 3, label: 'Meets',              improvementMandatory: false, minCommentChars: 30 },
  { value: 2, label: 'Partially meets',    improvementMandatory: true,  minCommentChars: 80 },
  { value: 1, label: 'Below expectations', improvementMandatory: true,  minCommentChars: 120 },
]

/** One pms_rating_scale row, as PostgREST returns it. */
export interface ScaleRow {
  rating_value: number | string
  rating_label: string
  rating_code?: string | null
  min_comment_chars?: number | string | null
  improvement_feedback_mandatory?: boolean | null
  score_from?: number | string | null
  score_to?: number | string | null
  sort_order?: number | string | null
  is_active?: boolean | null
}

/**
 * The configured bands, highest first.
 *
 * Inactive rows are dropped rather than hidden in the UI: a band switched off
 * is not a rating anybody may give. An empty or unreadable table yields an
 * empty array, and callers fall back to DEFAULT_BANDS — saying so explicitly
 * beats silently enforcing numbers nobody chose.
 */
export function bandsFromScale(rows: ScaleRow[] | null | undefined): Band[] {
  const n = (v: unknown): number | undefined =>
    v === null || v === undefined || v === '' ? undefined : Number(v)
  return (rows ?? [])
    .filter(r => r.is_active !== false)
    .map(r => ({
      value: Number(r.rating_value),
      label: String(r.rating_label ?? ''),
      code: r.rating_code ?? undefined,
      improvementMandatory: r.improvement_feedback_mandatory === true,
      minCommentChars: Number(r.min_comment_chars ?? 0) || 0,
      scoreFrom: n(r.score_from),
      scoreTo: n(r.score_to),
    }))
    .filter(b => Number.isFinite(b.value))
    .sort((a, b) => b.value - a.value)
}

export function bandFor(rating: number | null | undefined, bands = DEFAULT_BANDS): Band | null {
  if (rating === null || rating === undefined) return null
  return bands.find(b => b.value === Math.round(rating)) ?? null
}

/**
 * Score to band.
 *
 * THE RANGES WIN WHERE THERE ARE RANGES. pms_rating_scale gives each band an
 * explicit window — 4.51-5.00, 3.51-4.50, 2.51-3.50 and so on — and rounding
 * disagrees with it at every boundary: a weighted score of exactly 3.50 sits
 * in "Meets Expectations" by the table and rounds up to "Exceeds" by
 * arithmetic. One of those is the band the admin configured.
 *
 * Falls back to rounding only for bands that carry no window, which is the
 * built-in list above.
 */
export function bandForScore(s: number | null, bands = DEFAULT_BANDS): Band | null {
  if (s === null) return null
  const windowed = bands.find(b =>
    b.scoreFrom !== undefined && b.scoreTo !== undefined && s >= b.scoreFrom && s <= b.scoreTo)
  if (windowed) return windowed
  // A score above the top window or below the bottom one still has a band:
  // clamp rather than return nothing, or a perfect 5.00 with a 4.51-5.00 top
  // band would be fine while 5.01 from a rounding artefact would be nameless.
  const ranged = bands.filter(b => b.scoreFrom !== undefined && b.scoreTo !== undefined)
  if (ranged.length) {
    if (s > Math.max(...ranged.map(b => b.scoreTo!))) return ranged[0]
    if (s < Math.min(...ranged.map(b => b.scoreFrom!))) return ranged[ranged.length - 1]
    return null
  }
  return bandFor(Math.round(s), bands)
}

export interface FeedbackCheck { ok: boolean; faults: string[] }

/**
 * Rules 10 and 11 — what a manager owes before finalising at a given rating.
 *
 * The low bands demand MORE words, not fewer. A 5 can stand on "consistently
 * excellent"; a 1 is the rating somebody may later have to defend, and
 * "needs to improve" defends nothing.
 */
export function checkFeedback(
  rating: number | null,
  { appreciation, improvement }: { appreciation?: string | null; improvement?: string | null },
  bands = DEFAULT_BANDS,
): FeedbackCheck {
  const band = bandFor(rating, bands)
  const faults: string[] = []
  if (!band) return { ok: false, faults: ['No rating has been given yet.'] }

  const imp = (improvement ?? '').trim()
  if (band.improvementMandatory && !imp) {
    faults.push(`Improvement feedback is required at ${band.value} (${band.label.toLowerCase()}). This is the rating somebody may have to act on, and it needs to say what would change it.`)
  }
  const written = imp.length >= (appreciation ?? '').trim().length ? imp : (appreciation ?? '').trim()
  if (written && written.length < band.minCommentChars) {
    faults.push(`At least ${band.minCommentChars} characters of comment at this rating. There are ${written.length}.`)
  }
  if (!written) {
    faults.push('Neither an appreciation remark nor improvement feedback has been written.')
  }
  return { ok: faults.length === 0, faults }
}

// ── rule 6: self first ───────────────────────────────────────────────────

/**
 * RULE 6 — a manager cannot rate before the employee has submitted their own.
 *
 * Enforced by trigger trg_pms_self_first too. The reason it is a rule and not
 * a convention: a manager's number anchors the conversation, and an employee
 * who fills theirs in afterwards is answering it rather than assessing their
 * own year.
 */
export function canManagerRate(selfSubmitted: boolean): Gate {
  return selfSubmitted
    ? { open: true, because: '' }
    : { open: false, because:
        'They have not submitted their self rating yet. Rating first would anchor their assessment to yours, and the database refuses it in any case.' }
}

export interface Gate { open: boolean; because: string }

// ── the rater's own view: theirs, mine, and the distance between ─────────

export interface RatingCompare {
  goalId: string
  title: string
  weightage: number
  /** What the employee said about themselves. */
  self: number | null
  /** What this rater is saying. */
  mine: number | null
  /**
   * mine − self. POSITIVE MEANS YOU RATED THEM HIGHER than they rated
   * themselves.
   *
   * The opposite sign to gap() above, which computes self − final because it
   * speaks to the employee ("you rated yourself higher than your manager
   * did"). Two functions with opposite conventions is a trap, so the
   * direction is stated in both and neither is inferred from the other.
   */
  delta: number | null
  flag: GapFlag
  /**
   * Does this line need a written reason?
   *
   * Any difference at all. Ratings are whole numbers on the band scale, so a
   * delta of 1 is a whole band — "exceeds" against "meets" — and that is a
   * judgement the employee will want explained. An unexplained downgrade is
   * the single most common thing an appraisal is disputed over, and the
   * cheapest moment to write the sentence is while the rating is being made.
   */
  needsReason: boolean
  hasReason: boolean
}

export interface CompareSummary {
  lines: RatingCompare[]
  /** Weighted, on the rating scale. Null until every line is rated. */
  selfScore: number | null
  myScore: number | null
  /** myScore − selfScore. Positive means you scored them higher overall. */
  delta: number | null
  rated: number
  total: number
  agreed: number
  higher: number
  lower: number
  /** Lines that differ and carry no explanation. */
  missingReasons: RatingCompare[]
}

/**
 * Compare this rater's scores with the employee's own, line by line.
 *
 * Built on score() and gap() rather than recomputing: the weighted mean and
 * the gap thresholds are already defined once, and a second definition of
 * "major gap" that disagreed with the employee's own screen would be worse
 * than no comparison at all.
 */
export function compareRatings(
  rows: { goalId: string; title: string; weightage: number
          self: number | null; mine: number | null; comment?: string | null }[],
): CompareSummary {
  const lines: RatingCompare[] = rows.map(r => {
    const delta = r.self == null || r.mine == null
      ? null : Math.round((r.mine - r.self) * 100) / 100
    // gap() takes (self, final) and returns self − final, so the arguments go
    // in that order and only the FLAG is used from it — the delta here keeps
    // this function's own direction.
    const flag = gap(r.self, r.mine).flag
    const needsReason = delta !== null && delta !== 0
    return {
      goalId: r.goalId, title: r.title, weightage: r.weightage,
      self: r.self, mine: r.mine, delta, flag,
      needsReason, hasReason: !!(r.comment && r.comment.trim()),
    }
  })

  const asLines = rows.map(r => ({
    goalId: r.goalId, title: r.title, category: 'BUSINESS' as Category,
    weightage: r.weightage, self: r.self, final: r.mine,
  }))
  const selfScore = score(asLines, 'self')
  const myScore = score(asLines, 'final')

  return {
    lines, selfScore, myScore,
    delta: selfScore == null || myScore == null
      ? null : Math.round((myScore - selfScore) * 100) / 100,
    rated: lines.filter(l => l.mine != null).length,
    total: lines.length,
    agreed: lines.filter(l => l.delta === 0).length,
    higher: lines.filter(l => (l.delta ?? 0) > 0).length,
    lower: lines.filter(l => (l.delta ?? 0) < 0).length,
    missingReasons: lines.filter(l => l.needsReason && !l.hasReason),
  }
}
