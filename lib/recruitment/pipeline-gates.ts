// lib/recruitment/pipeline-gates.ts
//
// Who may occupy one of a requisition's openings, and which pipeline stages the
// funnel is allowed to write at all.
//
// Pure — no Supabase, no React — so the modal's Shortlist button and the server
// route that performs the write share ONE answer instead of each carrying its
// own half of the rule. The reason the button shows is literally the reason the
// write would give, because both call canShortlist().
//
// WHY THIS FILE EXISTS
//
// candidates.stage is free text. Migration 018 says so in as many words
// ("candidates.stage is free text (no CHECK constraint)"), RLS on candidates is
// allow-all for authenticated, and ten code paths write the column. The
// three-decided-rounds rule lived inside exactly one of them — the shortlist
// action of /api/recruitment/interview-invite — so:
//
//   · the pipeline's manual stage picker reached 'Shortlisted' after a single
//     Telephonic round, and
//   · reached 'Offer Sent' with no negotiation, no HR Head approval and no
//     offer letter,
//
// both because moveStage's ONLY check was that the target sits later in the
// STAGES array, and both of those targets do. Nothing was wrong with the rule;
// it was simply not on that path.
//
// A rule enforced at one write is not enforced. The same lesson, about MRF
// assignment, is already written down in mrf-assignment-rule.test.ts — four
// separate writes had to learn it one at a time.
//
// WHAT IS DELIBERATELY NOT HERE
//
// Nothing in this file reads a role. "Only the assigned HR Manager sends the
// offer" is enforced where the offer is actually sent — canDispatchOffer, plus
// the live re-read of offer_approval_requests.status before dispatch in
// offer-flow-components.tsx. This module's job is to stop the FUNNEL writing
// those stages at all, which is what made that role check bypassable in the
// first place. Forward-only ordering is not here either: that belongs to
// whoever owns the STAGES array.

import { ROUNDS_BEFORE_SHORTLIST } from './interview-decision.ts'

export { ROUNDS_BEFORE_SHORTLIST }

/**
 * A candidate on one of these holds one of the requisition's openings.
 *
 * 'Shortlisted' counts, and that is the point of the cap: a shortlisted
 * candidate is the one being taken to offer, so they occupy the opening from
 * that moment rather than from the moment the offer goes out.
 */
export const SLOT_STAGES: readonly string[] = ['Shortlisted', 'Offer Sent', 'Joined']

export function occupiesSlot(stage: string | null | undefined): boolean {
  return !!stage && SLOT_STAGES.includes(stage)
}

/**
 * The requisition's opening count.
 *
 * `no_of_openings` is the live column and `openings` the older echo kept beside
 * it; every other reader in the module already spells this
 * `no_of_openings || openings || 1`, so this matches rather than improves on it.
 * Anything missing, zero, negative or unparseable means one opening — never
 * zero, because zero openings would refuse every shortlist on the requisition.
 */
export function openingsOf(
  mrf: { no_of_openings?: number | null; openings?: number | null } | null | undefined,
): number {
  const n = Number(mrf?.no_of_openings ?? mrf?.openings ?? 1)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/**
 * How many of an MRF's openings are already taken.
 *
 * `exceptId` excludes one candidate from the count, and callers MUST pass the
 * candidate being moved. A candidate sent back from the offer flow (a revision
 * request, offer-flow-components and page.tsx both do this) still reads
 * 'Shortlisted', so counting them would refuse them their own slot.
 */
export function slotsUsed(
  candidates: readonly { id: string; mrf_id?: string | null; stage: string }[],
  mrfId: string | null | undefined,
  exceptId?: string | null,
): number {
  if (!mrfId) return 0
  return candidates.filter(
    c => c.mrf_id === mrfId && c.id !== exceptId && occupiesSlot(c.stage),
  ).length
}

export interface Gate {
  ok: boolean
  /** Why not — shown to the user verbatim, so it says what to do instead. */
  reason?: string
}

const ALLOW: Gate = { ok: true }

export interface ShortlistFacts {
  /** The candidate's stage right now. */
  currentStage: string
  /**
   * Rounds the candidate has CLEARED — decided SHORTLIST by their main
   * interviewer. Hold and Reject do not count.
   *
   * This used to be decidedRounds, counting any recorded decision, which let a
   * candidate sitting on Hold be shortlisted. Renamed rather than redefined so
   * a caller cannot keep passing a decided-count into a field that now means
   * something stricter.
   */
  clearedRounds: number
  /** The requisition's opening count — see openingsOf. */
  openings: number
  /** Slots already taken on that requisition, EXCLUDING this candidate. */
  slotsUsed: number
}

/** May this candidate be shortlisted? */
export function canShortlist(f: ShortlistFacts): Gate {
  if (f.currentStage === 'Rejected') {
    return { ok: false, reason: 'This candidate was rejected' }
  }
  if (occupiesSlot(f.currentStage)) {
    return { ok: false, reason: `This candidate is already ${f.currentStage}` }
  }
  if (f.clearedRounds < ROUNDS_BEFORE_SHORTLIST) {
    return {
      ok: false,
      reason: `${ROUNDS_BEFORE_SHORTLIST} rounds must be cleared before shortlisting — ${f.clearedRounds} so far`,
    }
  }
  if (f.slotsUsed >= f.openings) {
    return {
      ok: false,
      reason: f.openings === 1
        ? 'This requisition has one opening and a candidate already holds it'
        : `All ${f.openings} openings on this requisition are already taken`,
    }
  }
  return ALLOW
}

/* REMOVED WITH THE "Move to" PICKER: OFFER_FLOW_STAGES, offerFlowGate(),
 * ROUND_LADDER, roundStepGate() and stageGate().
 *
 * They existed to police manual stage changes — refuse Offer Sent / Joined,
 * and keep the interview rounds in order. Nothing changes a stage by hand any
 * more: a decision moves it (applyInterviewDecision), the Shortlist button
 * posts action:'shortlist' and Reject posts action:'reject', all enforced in
 * /api/recruitment/interview-invite.
 *
 * The rules did not disappear, they stopped being REACHABLE. A round's stage
 * comes from its own position, so the rounds run in order by construction; and
 * only the offer dispatch writes 'Offer Sent', alongside the letter, the DOJ,
 * the audit row and the MRF close. Re-adding any manual stage control means
 * re-adding these gates first. */
