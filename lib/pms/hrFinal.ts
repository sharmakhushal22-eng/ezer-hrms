// lib/pms/hrFinal.ts — the HR Head settling the final rating.
//
// Requested: a checkbox asking whether the HR Head discussed the rating with
// the company's management; their rating overwrites what the chain settled
// and counts as THE final rating; they may instead keep the chain's rating;
// and nothing can be published until they have done one or the other.
//
// ── THE SHAPE OF THE DECISION ────────────────────────────────────────────
//
// Two paths, one act. KEEP the rating the chain settled, or REPLACE it. Both
// are "giving the final rating", and both need the attestation, because the
// question the checkbox asks — did you discuss this with management — is
// just as live when the HR Head agrees with the HOD as when they overrule
// them. Only replacing needs a written reason: agreeing explains itself.
//
// ── WHY THE CHAIN'S SCORES SURVIVE ───────────────────────────────────────
//
// "Overwrite the ratings of the people behind in the chain" means the HR
// Head's number supersedes theirs as the final rating. It does not mean
// deleting what they said. rm_l1_score, rm_l2_score and hod_score stay; the
// band the chain settled is copied to chain_final_rating before being
// written over, so the row can still answer "the HOD settled 4, the HR Head
// set 3".

import type { Role } from './hierarchy.ts'

/**
 * WHO MAY SETTLE IT: the HR_HEAD role, and only that.
 *
 * Chosen over "any HR-level user", which would have let an HR Manager set
 * the number that overrides the HOD. ADMIN is deliberately NOT included —
 * it is the escalation path for the finalise identity checks (188), not a
 * second HR Head, and widening this quietly is exactly how a gate stops
 * meaning anything.
 */
export function canSettleFinal(role: Role): boolean {
  return role === 'HR_HEAD'
}

export const HR_FINAL_PROMPT =
  'Have you discussed this final rating with the company’s management?'

/** What the HR Head chose to do. */
export type FinalChoice = 'KEEP' | 'REPLACE'

export interface FinalIntent {
  choice: FinalChoice
  /** Only read when the choice is REPLACE. */
  rating?: number | null
  reason?: string | null
  /** The checkbox. */
  discussed?: boolean
}

export interface FinalCheck { ok: boolean; faults: string[] }

/** A reason shorter than this is not a reason, it is a keystroke. */
export const MIN_FINAL_REASON = 15

/**
 * Can this be confirmed?
 *
 * Returns EVERY fault rather than the first, so somebody fixing one does not
 * discover the next on the following attempt.
 */
export function checkFinal(
  intent: FinalIntent,
  chainRating: number | null,
  scale: number[] = [1, 2, 3, 4, 5],
): FinalCheck {
  const faults: string[] = []

  if (intent.choice === 'KEEP' && chainRating === null) {
    faults.push('There is no rating from the chain to keep. The chain has '
              + 'not settled this appraisal yet.')
  }

  if (intent.choice === 'REPLACE') {
    const r = intent.rating
    if (r === null || r === undefined || Number.isNaN(Number(r))) {
      faults.push('Choose the rating that will stand.')
    } else if (!scale.includes(Number(r))) {
      faults.push(`${r} is not on this policy’s rating scale.`)
    } else if (chainRating !== null && Number(r) === chainRating) {
      // Not an error of fact, but of intent: they have chosen "replace" and
      // typed the number that is already there, so the reason they are about
      // to write would describe a change that never happened.
      faults.push(`That is the rating the chain already settled. Choose `
                + `“keep” instead, or pick a different rating.`)
    }
    const reason = (intent.reason ?? '').trim()
    if (!reason) {
      faults.push('Say why this rating replaces the one the chain settled. '
                + 'It is the only record of that decision.')
    } else if (reason.length < MIN_FINAL_REASON) {
      faults.push(`That reason is too short to be read later. At least `
                + `${MIN_FINAL_REASON} characters.`)
    }
  }

  // LAST, so it is the fault somebody sees once the rest is right — and
  // checked on both paths, because the question is as live when the HR Head
  // agrees with the chain as when they overrule it.
  if (!intent.discussed) {
    faults.push(HR_FINAL_PROMPT + ' Confirm it before settling the rating.')
  }

  return { ok: faults.length === 0, faults }
}

/** The row as the database holds it, for reading back a settled rating. */
export interface HrFinalRow {
  final_rating?: number | null
  chain_final_rating?: number | null
  hr_final_confirmed_at?: string | null
  hr_final_confirmed_by?: string | null
  hr_management_discussed?: boolean | null
  hr_final_reason?: string | null
}

export interface HrFinalState {
  settled: boolean
  /** True only when the HR Head's number differs from the chain's. */
  overrode: boolean
  /** What stands now. */
  rating: number | null
  /** What the chain had settled, when that differs. */
  chainRating: number | null
  reason: string | null
  at: string | null
  by: string | null
}

/**
 * Where this appraisal has got to.
 *
 * settled requires BOTH the timestamp and the attestation. A row carrying a
 * confirmation with the checkbox false is not settled — the database refuses
 * to publish it, and a screen that called it settled would be describing a
 * state the database disagrees with.
 */
export function hrFinalState(row: HrFinalRow | null | undefined): HrFinalState {
  const r = row ?? {}
  const num = (v: unknown) =>
    v === null || v === undefined || v === '' ? null : Number(v)
  const chain = num(r.chain_final_rating)
  return {
    settled: !!r.hr_final_confirmed_at && r.hr_management_discussed === true,
    overrode: chain !== null,
    rating: num(r.final_rating),
    chainRating: chain,
    reason: r.hr_final_reason ?? null,
    at: r.hr_final_confirmed_at ?? null,
    by: r.hr_final_confirmed_by ?? null,
  }
}

/**
 * The publish fault, or null.
 *
 * The UI's gate and the database trigger have to agree, so the condition is
 * written once here and the screen asks this rather than re-deriving it.
 */
export function publishFault(
  row: HrFinalRow | null | undefined,
  required = true,
): string | null {
  if (!required) return null
  const s = hrFinalState(row)
  if (s.settled) return null
  if (row?.hr_final_confirmed_at && row?.hr_management_discussed !== true) {
    return 'This rating was confirmed without the management discussion being '
         + 'recorded. The HR Head has to settle it again.'
  }
  return 'The HR Head has not settled the final rating yet. Until they do, '
       + 'this result cannot be published.'
}

/**
 * What to write when the HR Head settles it.
 *
 * Built here rather than in the component so the two paths cannot drift: a
 * KEEP must not stamp chain_final_rating (nothing was replaced) and must not
 * touch final_rating, and a REPLACE must capture the chain's band BEFORE
 * overwriting it, which is the only moment that number still exists.
 */
export function finalPatch(
  intent: FinalIntent,
  chainRating: number | null,
  actorId: string | null,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const base = {
    hr_final_confirmed_at: now,
    hr_final_confirmed_by: actorId,
    hr_management_discussed: true,
  }
  if (intent.choice === 'KEEP') {
    return { ...base, hr_final_reason: null, chain_final_rating: null }
  }
  return {
    ...base,
    final_rating: Number(intent.rating),
    chain_final_rating: chainRating,
    hr_final_reason: (intent.reason ?? '').trim() || null,
    // 055 already allows this value. The rating no longer came from the
    // chain, and a report that cannot tell the difference is wrong.
    rating_source: 'HR_OVERRIDE',
  }
}
