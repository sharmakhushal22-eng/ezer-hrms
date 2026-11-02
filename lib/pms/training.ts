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
import { bandForScore, DEFAULT_BANDS, type Band } from './scoring.ts'

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

// ── what a score invites: a PIP at one end, recognition at the other ─────

export const RECOGNITION_KINDS = [
  'BONUS', 'PROMOTION', 'INCREMENT', 'AWARD', 'OTHER',
] as const
export type RecognitionKind = typeof RECOGNITION_KINDS[number]

export const RECOGNITION_LABEL: Record<RecognitionKind, string> = {
  BONUS:     'Salary bonus',
  PROMOTION: 'Promotion recommendation',
  INCREMENT: 'Out-of-cycle increment',
  AWARD:     'Award or special mention',
  OTHER:     'Other recognition',
}

/**
 * WHAT THIS SCORE INVITES THE RATER TO PROPOSE.
 *
 * Requested: a PIP checkbox when they rate somebody very low, a recognition
 * box when they rate somebody high, both optional, both reaching HR.
 *
 * DECIDED BY THE BAND, NOT A NUMBER IN CODE. pms_rating_scale has carried
 * allows_pip_request since 066 — seeded true at 2 and 1 on this company's
 * scale — and 209 adds allows_recognition as its mirror, seeded true for
 * the top two. The request said "you say rating > 2"; a hardcoded 2 would
 * mean something different on a three-point or ten-point scale, which is a
 * setting away, and the same trap the colour ramp avoided by normalising.
 *
 * THE BAND COMES FROM THE WEIGHTED SCORE through pms_rating_scale's own
 * windows, so one prompt appears per appraisal rather than one per KRA.
 * That was the chosen reading: "the rater's own overall weighted score".
 *
 * BOTH CAN BE FALSE and neither can sensibly be true at once on a scale
 * whose flags are set the obvious way — but nothing here enforces that,
 * because an admin who wants both on one band has said something coherent
 * (a band that could go either way), and refusing it would be this code
 * overruling configuration it does not own.
 */
export interface ScoreInvites {
  band: Band | null
  pip: boolean
  recognition: boolean
}


export function scoreInvites(
  score: number | null, bands = DEFAULT_BANDS,
): ScoreInvites {
  const band = bandForScore(score, bands)
  if (!band) return { band: null, pip: false, recognition: false }
  return {
    band,
    pip: band.allowsPip === true,
    recognition: band.allowsRecognition === true,
  }
}

export interface PipIntent {
  wanted: boolean
  reason: string
  proposedStart: string
  proposedEnd: string
}

export interface RecognitionIntent {
  wanted: boolean
  kind: RecognitionKind
  note: string
}

/**
 * 90 days from today, as an ISO date — the default PIP window. Long enough
 * to show a change, short enough that nobody is left on one indefinitely.
 *
 * BUILT FROM LOCAL PARTS, NEVER toISOString(). The first version parsed
 * `today + 'T00:00:00'` — local midnight — and then formatted with
 * toISOString(), which converts to UTC. Anywhere east of Greenwich that
 * lands on the previous day: on this machine (+05:30) asking for
 * 2026-11-03 returned 2026-11-02, so every PIP would have started a day
 * before the manager chose. Caught by the test, not by reading it.
 *
 * Date arithmetic itself is safe — setDate rolls months and years — it is
 * only the formatting that must stay local.
 */
export function defaultPipWindow(today: string): { start: string; end: string } {
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
    + `-${String(x.getDate()).padStart(2, '0')}`
  const d = new Date(today + 'T00:00:00')
  const end = new Date(d)
  end.setDate(end.getDate() + 90)
  return { start: iso(d), end: iso(end) }
}

export const MIN_PIP_REASON = 40

/**
 * A PIP request that HR can act on.
 *
 * pms_pip requires request_reason, proposed_start and proposed_end NOT NULL,
 * so a bare checkbox cannot create one — and should not. A plan that starts
 * with "rated low" is one nobody can run, review or defend, which is why the
 * reason has a floor at all.
 */
export function checkPip(p: PipIntent): string | null {
  if (!p.wanted) return null
  const reason = (p.reason ?? '').trim()
  if (reason.length < MIN_PIP_REASON) {
    return `Say why the plan is needed — at least ${MIN_PIP_REASON} characters, `
         + `and there ${reason.length === 1 ? 'is' : 'are'} ${reason.length}. `
         + `HR decides on this, and "rated low" is not something they can act on.`
  }
  if (!p.proposedStart || !p.proposedEnd) return 'Give the plan a start and an end date.'
  if (p.proposedEnd <= p.proposedStart) return 'The plan has to end after it starts.'
  return null
}

/** Recognition needs a line saying what for; the kind alone is not a case. */
export const MIN_RECOGNITION_NOTE = 20

export function checkRecognition(r: RecognitionIntent): string | null {
  if (!r.wanted) return null
  const note = (r.note ?? '').trim()
  if (note.length < MIN_RECOGNITION_NOTE) {
    return `Say what the recognition is for — at least ${MIN_RECOGNITION_NOTE} `
         + `characters, and there ${note.length === 1 ? 'is' : 'are'} ${note.length}. `
         + `HR acts on this, and a bonus with no case attached is one they cannot approve.`
  }
  return null
}
