// lib/pms/hrQueue.ts — what the chain asked for, gathered for the person who
// decides. Requested: "all this PIP checks, recommendations and recognization
// by r1/r2/hod will be shown to hr head at end so they can publish results and
// give recognizations and act accordingly."
//
// ── WHY THIS IS A FUNCTION AND NOT A QUERY ─────────────────────────────────
//
// Three streams arrive from three tables with three lifecycles: training
// suggestions and recognition proposals share pms_training_recommendation
// (told apart by kind — 210), and PIP requests live in pms_pip with a seven
// state machine of their own. The screen needs them as ONE answer per
// employee: what did the people who rated this person ask for, and what is
// still undecided.
//
// Doing that in SQL would put the rule in a view that no test can reach.
// ENGINE COMPUTES, SQL DECIDES: the shaping is here, with tests; the storage
// and the constraints stay in the migrations.
//
// ── THE DECISION THIS FILE REFUSES TO MAKE ─────────────────────────────────
//
// An undecided proposal does NOT block publishing. It is reported, loudly,
// and that is all.
//
// The argument for blocking is real: publish first and the employee reads
// their rating with no word of the bonus their HOD proposed, and HR is now
// explaining a decision after the fact. But the cost of blocking is worse
// and lands on the wrong person. A rater can attach a proposal to anybody;
// if a pending one held the result, any rater could stall any publication
// indefinitely by proposing something and nobody deciding. Results have a
// cycle to keep, and HR declining a proposal is a legitimate answer that the
// employee never needs to see.
//
// So these are WARNINGS. The faults that stop a publication stay what they
// were: no rating, no appreciation remark, no manager sign-off.

import {
  type TrainingRecommendation, type HrStatus,
  isTraining, isRecognition, trainingSummary,
} from './training.ts'
import { type Pip, pipFromRow, type PipRowDb, whatNext, STATUS_LABEL } from './pip.ts'

export interface ChainAsk {
  id?: string
  kind: 'TRAINING' | 'RECOGNITION'
  name: string
  details?: string | null
  category?: string | null
  byRole?: string | null
  byName?: string | null
  at?: string | null
  status: HrStatus
  hrNote?: string | null
}

export interface ChainPip {
  id?: string
  pip: Pip
  byRole?: string | null
  byName?: string | null
  reason?: string | null
  triggerRating?: number | null
  proposedStart?: string | null
  proposedEnd?: string | null
}

export interface ChainAsks {
  training: ChainAsk[]
  recognition: ChainAsk[]
  pips: ChainPip[]
  /** Undecided across both recommendation kinds. */
  pendingRecommendations: number
  /** PIP requests still sitting with HR. */
  pendingPips: number
  /** Nothing was asked for at all — the common case, and worth saying. */
  empty: boolean
}

const EMPTY: ChainAsks = {
  training: [], recognition: [], pips: [],
  pendingRecommendations: 0, pendingPips: 0, empty: true,
}

/**
 * A recommendation row as the database holds it. Snake-cased: PostgREST's
 * shape, translated here rather than in three components.
 */
export interface RecRowDb {
  id?: string
  employee_id?: string
  kind?: string | null
  training_name?: string | null
  category?: string | null
  details?: string | null
  recommended_by?: string | null
  recommended_by_role?: string | null
  recommended_at?: string | null
  hr_status?: string | null
  hr_note?: string | null
}

const toAsk = (r: RecRowDb, names: Record<string, string> = {}): ChainAsk => ({
  id: r.id,
  // Via the model's reader, so an unmarked row reads as TRAINING here too.
  kind: isRecognition(r) ? 'RECOGNITION' : 'TRAINING',
  name: (r.training_name ?? '').trim(),
  details: r.details ?? null,
  category: r.category ?? null,
  byRole: r.recommended_by_role ?? null,
  byName: r.recommended_by ? (names[r.recommended_by] ?? null) : null,
  at: r.recommended_at ?? null,
  // A row fetched without the column must not disappear from the pending
  // count: that would hide work from the person whose queue this is.
  status: (r.hr_status as HrStatus | undefined) ?? 'PENDING',
  hrNote: r.hr_note ?? null,
})

/**
 * Everything the chain asked for about ONE employee.
 *
 * Both lists are filtered by employee BEFORE anything is counted, so no
 * total can describe a wider set than the lists shown beneath it — the same
 * reason the publish table narrows by company first.
 */
export function chainAsks(
  employeeId: string | null | undefined,
  recs: RecRowDb[] | null | undefined,
  pips: PipRowDb[] | null | undefined,
  names: Record<string, string> = {},
): ChainAsks {
  if (!employeeId) return EMPTY
  const mine = (recs ?? []).filter(r => r.employee_id === employeeId)
  const asks = mine.map(r => toAsk(r, names))
  const training = asks.filter(a => a.kind === 'TRAINING')
  const recognition = asks.filter(a => a.kind === 'RECOGNITION')

  const myPips = (pips ?? [])
    .filter(p => p.employee_id === employeeId)
    .map(p => ({
      id: p.id,
      pip: pipFromRow(p),
      byRole: p.requested_by_role ?? null,
      byName: p.requested_by ? (names[p.requested_by] ?? null) : null,
      reason: p.request_reason ?? null,
      // PostgREST returns numeric as a string. Number('') is 0, which would
      // read as a rating of zero, so an empty value stays null.
      triggerRating: p.trigger_rating === null || p.trigger_rating === undefined
        || p.trigger_rating === '' ? null : Number(p.trigger_rating),
      proposedStart: p.proposed_start ?? null,
      proposedEnd: p.proposed_end ?? null,
    }))

  const pendingRecommendations = asks.filter(a => a.status === 'PENDING').length
  const pendingPips = myPips.filter(p => p.pip.status === 'PENDING_HR').length
  return {
    training, recognition, pips: myPips,
    pendingRecommendations, pendingPips,
    empty: asks.length === 0 && myPips.length === 0,
  }
}

/** The same gathering for everybody at once, keyed by employee. */
export function chainAsksByEmployee(
  recs: RecRowDb[] | null | undefined,
  pips: PipRowDb[] | null | undefined,
  names: Record<string, string> = {},
): Record<string, ChainAsks> {
  const ids = new Set<string>()
  for (const r of recs ?? []) if (r.employee_id) ids.add(r.employee_id)
  for (const p of pips ?? []) if (p.employee_id) ids.add(p.employee_id)
  const out: Record<string, ChainAsks> = {}
  for (const id of ids) out[id] = chainAsks(id, recs, pips, names)
  return out
}

/**
 * WHAT HR SHOULD KNOW BEFORE RELEASING — none of which stops them.
 *
 * Phrased as what happens if they go ahead, not as "pending: 2". A count
 * tells somebody there is a number; this tells them what the employee will
 * and will not read.
 */
export function publishWarnings(a: ChainAsks): string[] {
  const w: string[] = []
  const pendingRec = a.recognition.filter(r => r.status === 'PENDING')
  if (pendingRec.length) {
    w.push(`${pendingRec.length === 1
      ? 'A recognition proposal from the chain has'
      : `${pendingRec.length} recognition proposals from the chain have`}`
      + ' not been decided. Publishing now releases the rating without it'
      + ' — accepting one adds it to the recognition list below.')
  }
  const pendingTr = a.training.filter(r => r.status === 'PENDING')
  if (pendingTr.length) {
    w.push(`${pendingTr.length === 1 ? 'A training suggestion is' : `${pendingTr.length} training suggestions are`}`
      + ' still undecided. These are not shown to the employee, so this does'
      + ' not change what they read.')
  }
  if (a.pendingPips) {
    w.push('A PIP request on this person is waiting with HR. It has its own'
      + ' review, in PIP Requests — the rating can be released without it.')
  }
  return w
}

/** One line for the table, so a row shows there is something to look at. */
export function asksBadge(a: ChainAsks | undefined): string | null {
  if (!a || a.empty) return null
  const bits: string[] = []
  if (a.recognition.length) bits.push(`${a.recognition.length} recognition`)
  if (a.training.length) bits.push(`${a.training.length} training`)
  if (a.pips.length) bits.push(`${a.pips.length} PIP`)
  return bits.join(' · ')
}

/** Where a PIP has got to, for a one-line read on the publish card. */
export function pipLine(p: ChainPip): string {
  const n = whatNext(p.pip)
  return `${STATUS_LABEL[p.pip.status]} — ${n.what}`
}

/** HR's own tally across the whole period, for the queue header. */
export function queueTotals(recs: RecRowDb[] | null | undefined): {
  training: ReturnType<typeof trainingSummary>
  recognition: ReturnType<typeof trainingSummary>
} {
  const asks = (recs ?? []).map(r => ({
    kind: isRecognition(r) ? 'RECOGNITION' : 'TRAINING',
    trainingName: r.training_name ?? '',
    category: (r.category ?? 'OTHER') as never,
    hrStatus: (r.hr_status as HrStatus | undefined) ?? 'PENDING',
  })) as (TrainingRecommendation & { kind: string })[]
  return {
    training: trainingSummary(asks.filter(isTraining)),
    recognition: trainingSummary(asks.filter(isRecognition)),
  }
}
