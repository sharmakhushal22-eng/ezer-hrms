// lib/pms/training.ts — training a rater suggests while rating somebody.
//
// Requested: an optional block on the rating form for R1, R2 and the HOD to
// suggest training — "python training / excel / other trainings" — with room
// to explain it, all of it reaching the HR Head at the end.
//
// WHY THIS IS NOT A BENEFIT, which is the mistake it would be easy to make.
// pms_additional_benefits already has a TRAINING_NOMINATION type, and reusing
// it would have been one line. But that table records awarded_by: it is the
// list of things GIVEN. A suggestion HR has not agreed to is not an award,
// and filing it as one makes the recognition list wrong and leaves HR no way
// to decline it. 208 gives recommendations their own table and their own
// PENDING → ACCEPTED / DECLINED lifecycle.
//
// NOT GATED BY RATING, unlike the PIP prompt. A strong performer may need
// training as much as a weak one — more, often, because the training that
// matters to them is the next job rather than the current one.

import type { Role } from './hierarchy.ts'

export const TRAINING_CATEGORIES = [
  'TECHNICAL', 'BEHAVIOURAL', 'LEADERSHIP', 'DOMAIN', 'COMPLIANCE', 'OTHER',
] as const
export type TrainingCategory = typeof TRAINING_CATEGORIES[number]

/**
 * Coarse on purpose. There is no training catalogue in this database —
 * checked for trainings, training_catalogue, lms_courses and
 * employee_trainings, none exist — so these are buckets a human picks from,
 * not a taxonomy anything is joined on.
 */
export const TRAINING_CATEGORY_LABEL: Record<TrainingCategory, string> = {
  TECHNICAL:   'Technical / tools',
  BEHAVIOURAL: 'Behavioural',
  LEADERSHIP:  'Leadership',
  DOMAIN:      'Domain knowledge',
  COMPLIANCE:  'Compliance / mandatory',
  OTHER:       'Other',
}

/** An example per bucket, shown as placeholder text. Concrete examples are
 *  what stop a free-text field filling up with "training needed". */
export const TRAINING_EXAMPLE: Record<TrainingCategory, string> = {
  TECHNICAL:   'Advanced Excel · Python for analysts · SQL',
  BEHAVIOURAL: 'Giving difficult feedback · Time management',
  LEADERSHIP:  'First-time manager · Running a review conversation',
  DOMAIN:      'IND AS updates · Statutory payroll changes',
  COMPLIANCE:  'POSH refresher · Information security',
  OTHER:       'Anything the buckets above do not cover',
}

export const HR_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED'] as const
export type HrStatus = typeof HR_STATUSES[number]

export const HR_STATUS_LABEL: Record<HrStatus, string> = {
  PENDING: 'Waiting on HR', ACCEPTED: 'Accepted', DECLINED: 'Declined',
}

export interface TrainingRecommendation {
  id?: string
  trainingName: string
  category: TrainingCategory
  details?: string | null
  recommendedBy?: string | null
  recommendedByRole?: Role | null
  recommendedAt?: string | null
  hrStatus?: HrStatus
  hrNote?: string | null
}

/** A name shorter than this is not a training, it is a word. */
export const MIN_TRAINING_NAME = 3

export interface TrainingCheck { ok: boolean; fault: string | null }

/**
 * Is this row worth saving?
 *
 * THE WHOLE BLOCK IS OPTIONAL, so an entirely empty row is fine — it means
 * the rater had nothing to suggest, and that must not block their approval.
 * What is not fine is a half-filled one: details typed against no training,
 * or a name of two characters. Those reach HR as a row they cannot act on.
 */
export function checkTraining(r: {
  trainingName?: string | null; details?: string | null
}): TrainingCheck {
  const name = (r.trainingName ?? '').trim()
  const details = (r.details ?? '').trim()
  if (!name && !details) return { ok: true, fault: null }
  if (!name) {
    return { ok: false, fault:
      'Name the training. The detail is written against something, and HR '
      + 'cannot act on a note with no course attached.' }
  }
  if (name.length < MIN_TRAINING_NAME) {
    return { ok: false, fault:
      `"${name}" is too short to be a training. At least ${MIN_TRAINING_NAME} characters.` }
  }
  return { ok: true, fault: null }
}

/** Only the rows that carry something, so an untouched block saves nothing. */
export function filled<T extends { trainingName?: string | null; details?: string | null }>(
  rows: T[],
): T[] {
  return rows.filter(r => (r.trainingName ?? '').trim() || (r.details ?? '').trim())
}

/**
 * Every fault across the block, for the approval gate.
 *
 * Returns the empty array when the block is untouched — which is the common
 * case and must never stop somebody approving.
 */
export function checkTrainingBlock(rows: {
  trainingName?: string | null; details?: string | null
}[]): string[] {
  return filled(rows ?? [])
    .map(checkTraining)
    .filter(c => !c.ok)
    .map(c => c.fault!)
}

/** What HR sees at a glance: how many, and how many still need a decision. */
export function trainingSummary(rows: TrainingRecommendation[]): {
  total: number; pending: number; accepted: number; declined: number
} {
  const by = (s: HrStatus) => rows.filter(r => (r.hrStatus ?? 'PENDING') === s).length
  return {
    total: rows.length,
    pending: by('PENDING'), accepted: by('ACCEPTED'), declined: by('DECLINED'),
  }
}
