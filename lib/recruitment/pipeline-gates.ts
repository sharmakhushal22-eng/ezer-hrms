// lib/recruitment/pipeline-gates.ts
//
// Who may occupy one of a requisition's openings, and which pipeline stages the
// funnel is allowed to write at all.
//
// Pure — no Supabase, no React — so the browser's "Move to" picker and the
// server route that performs the write share ONE answer instead of each
// carrying its own half of the rule. The reason the picker shows is literally
// the reason the write would give, because both call the same function.
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

/**
 * Stages only the offer flow may write.
 *
 * It sets them alongside the offer_letters row, the candidate's DOJ, the audit
 * entry and the MRF auto-close — none of which a stage change performs. So a
 * stage change that *looks* equivalent leaves four other records wrong: a
 * candidate reading 'Offer Sent' with no letter, no joining date for the
 * pre-onboarding countdown and nothing in the audit trail.
 */
export const OFFER_FLOW_STAGES: readonly string[] = ['Offer Sent', 'Joined']

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
  /** Rounds carrying a main interviewer's decision. */
  decidedRounds: number
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
  if (f.decidedRounds < ROUNDS_BEFORE_SHORTLIST) {
    return {
      ok: false,
      reason: `${ROUNDS_BEFORE_SHORTLIST} rounds need a decision before shortlisting — ${f.decidedRounds} so far`,
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

/**
 * Refuses the stages the offer flow owns, whatever the funnel asks.
 *
 * Unconditional on purpose. There is no "but the approval is in place" branch,
 * because the approved path does not come through here — it comes through the
 * dispatch in offer-flow-components.tsx, which re-reads the approval live and
 * writes the letter, the DOJ and the audit row with it.
 */
export function offerFlowGate(target: string): Gate {
  if (target === 'Offer Sent') {
    return {
      ok: false,
      reason: 'The assigned HR Manager sends the offer from Offer Letters, once the HR Head has approved — sending it is what marks the candidate Offer Sent',
    }
  }
  if (target === 'Joined') {
    return {
      ok: false,
      reason: 'A candidate reaches Joined only after an offer has been sent and accepted',
    }
  }
  return ALLOW
}

/**
 * The gate for any target stage: what the picker shows, and what the write
 * checks. Stages this module has no opinion on are allowed — forward-only
 * ordering stays with the caller, which owns the STAGES array.
 */
export function stageGate(target: string, f: ShortlistFacts): Gate {
  const owned = offerFlowGate(target)
  if (!owned.ok) return owned
  if (target === 'Shortlisted') return canShortlist(f)
  return ALLOW
}
