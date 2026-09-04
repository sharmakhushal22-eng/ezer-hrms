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
      'You and your manager are reading this one very differently. Worth raising in the next one-to-one — bring the evidence you rated yourself on.' }
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
}

/** The 5-point default of §15's open question 1. Configurable per policy;
 *  this is what ships until somebody decides otherwise. */
export const DEFAULT_BANDS: Band[] = [
  { value: 5, label: 'Outstanding',        improvementMandatory: false, minCommentChars: 40 },
  { value: 4, label: 'Exceeds',            improvementMandatory: false, minCommentChars: 30 },
  { value: 3, label: 'Meets',              improvementMandatory: false, minCommentChars: 30 },
  { value: 2, label: 'Partially meets',    improvementMandatory: true,  minCommentChars: 80 },
  { value: 1, label: 'Below expectations', improvementMandatory: true,  minCommentChars: 120 },
]

export function bandFor(rating: number | null | undefined, bands = DEFAULT_BANDS): Band | null {
  if (rating === null || rating === undefined) return null
  return bands.find(b => b.value === Math.round(rating)) ?? null
}

/** Score to band. Rounds to nearest, so 3.5 is a 4 rather than silently a 3. */
export function bandForScore(s: number | null, bands = DEFAULT_BANDS): Band | null {
  return s === null ? null : bandFor(Math.round(s), bands)
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
    faults.push(`Improvement feedback is required at ${band.value} — ${band.label.toLowerCase()}. This is the rating somebody may have to act on, and it needs to say what would change it.`)
  }
  const written = imp.length >= (appreciation ?? '').trim().length ? imp : (appreciation ?? '').trim()
  if (written && written.length < band.minCommentChars) {
    faults.push(`At least ${band.minCommentChars} characters of comment at this rating — there are ${written.length}.`)
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
        'They have not submitted their self rating yet. Rating first would anchor their assessment to yours — and the database refuses it in any case.' }
}

export interface Gate { open: boolean; because: string }
