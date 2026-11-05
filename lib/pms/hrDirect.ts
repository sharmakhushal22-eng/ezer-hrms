// lib/pms/hrDirect.ts — the HR Head building an appraisal outside the chain.
//
// Requested: "HR head can give and set final rating of any employee even if
// he do not undergo the complete pms chain, hr head can directly set any
// employee kras rate them and set the final rating and publish them. this is
// a special case feature."
//
// ── WHAT IS BYPASSED, AND WHAT IS NOT ────────────────────────────────────
//
// Bypassed: the chain itself, and with it the final-review sign-off that
// 200/207 require before publication — because there is no manager to have
// had that conversation. 212 waives it for stamped rows only, openly, with
// the HR Head's name and a reason on the record.
//
// NOT bypassed, and this is the part worth holding on to:
//
//   The KRA rules. A direct appraisal goes through the same checkKras as one
//   the employee wrote — the same minimum count, the same weightage total,
//   the same per-KRA floor. Skipping the chain is not a reason to accept a
//   scorecard that would be invalid from anyone else.
//
//   The rating scale. The final rating is a band on the policy's own scale.
//
//   211. The HR Head still settles the final rating like any other, because
//   they are the one acting and the attestation is still the question.
//
// ── NEVER-STARTED ONLY ───────────────────────────────────────────────────
//
// Chosen over "anyone at any stage". It is what stops a special case from
// becoming a way around the chain: an appraisal managers are working on
// cannot be taken off them. The database enforces it too (212), because a
// rule that lives only in a screen is a rule until somebody writes a script.

import { checkKras, type Kra } from './kra.ts'
import { DEFAULT_RULES } from './cycle.ts'
import type { Rules } from './cycle.ts'
import type { Role } from './hierarchy.ts'

/**
 * The same role that settles a final rating, for the same reason — and now
 * a policy switch beside it (217).
 *
 * The policy only NARROWS. Turning hr_head_can_direct on does not let an RM
 * build an appraisal outside the chain: the question that setting answers
 * is "may the HR Head", not "who may". Defaults to allowed when the policy
 * cannot be read, so a missing row does not remove a power mid-cycle.
 */
export function canActDirect(
  role: Role,
  policy?: { hrHeadCanDirect?: boolean | null } | null,
): boolean {
  return role === 'HR_HEAD' && (policy?.hrHeadCanDirect ?? true) !== false
}

/** A reason shorter than this is not an account of an exception. */
export const MIN_DIRECT_REASON = 20

/** The appraisal row, as much of it as eligibility depends on. */
export interface DirectCandidateRow {
  employee_code?: string | null
  employee_name?: string | null
  final_rating?: number | null
  workflow_status?: string | null
  fill_status?: string | null
  kra_count?: number | null
  self_score?: number | null
  employment_flag?: string | null
  period_code?: string | null
}

/**
 * Why this person cannot be taken outside the chain, or null if they can.
 *
 * Returns the SENTENCE rather than a boolean so the screen can say why
 * somebody is not offered, instead of silently omitting them — "where is
 * Priya" is a question a hidden row cannot answer.
 */
export function whyNotDirect(row: DirectCandidateRow | null | undefined): string | null {
  if (!row) return 'No appraisal record for this person in this period.'

  if (row.final_rating !== null && row.final_rating !== undefined) {
    return 'This appraisal already has a final rating from the chain. A '
         + 'direct appraisal is only for a cycle that never picked the '
         + 'person up.'
  }
  const wf = String(row.workflow_status ?? 'NOT_STARTED').toUpperCase()
  if (wf !== 'NOT_STARTED') {
    return `This appraisal has already started in the chain (${wf
      .replace(/_/g, ' ').toLowerCase()}), so it cannot be taken outside it.`
  }
  if ((row.kra_count ?? 0) > 0) {
    return 'This person already has KRAs for this period. A direct appraisal '
         + 'starts from nothing; edit the existing set instead.'
  }
  if (row.self_score !== null && row.self_score !== undefined) {
    return 'This person has already rated themselves, so their appraisal is '
         + 'under way.'
  }
  return null
}

export const neverStarted = (row: DirectCandidateRow | null | undefined) =>
  whyNotDirect(row) === null

/** What the HR Head is about to write. */
export interface DirectIntent {
  reason?: string | null
  kras: Kra[]
  /** A rating per KRA, keyed by seq_no. */
  scores: Record<number, number | null | undefined>
  finalRating?: number | null
}

export interface DirectCheck { ok: boolean; faults: string[] }

/**
 * Everything wrong with it, in the order to fix it.
 *
 * The KRA faults come from checkKras — the same function the employee's own
 * screen uses — rather than from a second set of rules written here. Two
 * implementations of "is this scorecard valid" would be two answers, and
 * the looser one would become the way to get an invalid set in.
 */
export function checkDirect(
  intent: DirectIntent,
  scale: number[] = [1, 2, 3, 4, 5],
  rules: Rules = DEFAULT_RULES,
): DirectCheck {
  const faults: string[] = []

  const reason = (intent.reason ?? '').trim()
  if (!reason) {
    faults.push('Say why this appraisal is being taken outside the chain. It '
              + 'is the only account of an exception.')
  } else if (reason.length < MIN_DIRECT_REASON) {
    faults.push(`That reason is too short to be read later. At least `
              + `${MIN_DIRECT_REASON} characters.`)
  }

  // THE SAME KRA RULES AS EVERYBODY ELSE.
  const kc = checkKras(intent.kras ?? [], rules)
  for (const f of kc.faults) {
    faults.push(f.seq === null ? f.says : `KRA ${f.seq}: ${f.says}`)
  }

  // Every KRA scored, and on the scale. A scorecard with an unrated
  // objective is the thing the chain would never have produced.
  for (const k of intent.kras ?? []) {
    const v = intent.scores?.[k.seq_no]
    if (v === null || v === undefined || v === ('' as unknown as number)) {
      faults.push(`KRA ${k.seq_no} has no rating.`)
    } else if (!scale.includes(Number(v))) {
      faults.push(`KRA ${k.seq_no} is rated ${v}, which is not on this `
                + `policy’s scale.`)
    }
  }

  const fr = intent.finalRating
  if (fr === null || fr === undefined) {
    faults.push('Choose the final rating that will stand.')
  } else if (!scale.includes(Number(fr))) {
    faults.push(`${fr} is not on this policy’s rating scale.`)
  }

  return { ok: faults.length === 0, faults }
}

/**
 * The weighted average of the per-KRA ratings.
 *
 * Offered as the SUGGESTION for the final rating, never imposed: the whole
 * point of this feature is a case the normal computation did not cover, and
 * the HR Head may have a reason to land elsewhere. Null when nothing is
 * rated yet, rather than 0 — zero is a rating and "nothing yet" is not.
 */
export function suggestedFinal(intent: DirectIntent): number | null {
  const rows = (intent.kras ?? [])
    .map(k => ({ w: Number(k.weightage) || 0, v: intent.scores?.[k.seq_no] }))
    .filter(r => r.v !== null && r.v !== undefined && Number.isFinite(Number(r.v)))
  const w = rows.reduce((s, r) => s + r.w, 0)
  if (!rows.length || w <= 0) return null
  const score = rows.reduce((s, r) => s + r.w * Number(r.v), 0) / w
  return Math.round(score * 100) / 100
}

/** The stamp that marks the record and waives the sign-off rule. */
export function directStamp(
  reason: string,
  actorId: string | null,
  now = new Date().toISOString(),
): Record<string, unknown> {
  return {
    hr_direct: true,
    hr_direct_by: actorId,
    hr_direct_at: now,
    hr_direct_reason: reason.trim(),
  }
}

/** Was this appraisal built outside the chain? */
export const isDirect = (row: { hr_direct?: boolean | null } | null | undefined) =>
  row?.hr_direct === true
