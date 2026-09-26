// lib/recruitment/interview-decision.ts
//
// What a round's decision does to the candidate. Shared by the recruiter's
// route (Telephonic feedback recorded directly, final Shortlist) and the ESS
// route (a main interviewer submitting feedback from Tasks & Approvals).
//
//   REJECT    -> candidate.stage = 'Rejected'
//   HOLD      -> candidate.stage = 'Hold'   (the hiring manager may still add a round)
//   SHORTLIST -> candidate.stage = the round's pipeline stage; the next round can be added
//
// Rounds are free-form names, so a round maps to a funnel stage by name when
// it matches one (Telephonic / L1 / L2 / Optional Round), else by its position:
// the 1st round is Telephonic, 2nd L1, 3rd L2, anything later Optional Round.

import type { SupabaseClient } from '@supabase/supabase-js'

export type Decision = 'HOLD' | 'REJECT' | 'SHORTLIST'
export const DECISIONS: Decision[] = ['HOLD', 'REJECT', 'SHORTLIST']
export const DECISION_LABEL: Record<Decision, string> = { HOLD: 'On hold', REJECT: 'Rejected', SHORTLIST: 'Shortlisted' }

export const ROUND_STAGES = ['Telephonic', 'L1', 'L2', 'Optional Round']
export const HOLD_STAGE = 'Hold'
/** Rounds needed before the final "Shortlist" button appears on the candidate popup. */
export const ROUNDS_BEFORE_SHORTLIST = 3

export function stageForRound(round: string, ordinal: number): string {
  const byName = ROUND_STAGES.find(s => s.toLowerCase() === String(round || '').trim().toLowerCase())
  if (byName) return byName
  return ROUND_STAGES[Math.min(Math.max(ordinal - 1, 0), ROUND_STAGES.length - 1)]
}

export function isDecision(v: unknown): v is Decision {
  return typeof v === 'string' && (DECISIONS as string[]).includes(v)
}

/**
 * Apply a round decision to the candidate. `ordinal` is the 1-based position of
 * this round among the candidate's rounds (Telephonic = 1). Returns the stage
 * the candidate is now on (unchanged when the decision doesn't move them).
 */
export async function applyInterviewDecision(
  sb: SupabaseClient, candidateId: string, round: string, decision: Decision, ordinal: number,
): Promise<string | null> {
  const { data: cand } = await sb.from('candidates').select('stage').eq('id', candidateId).maybeSingle()
  const cur: string = (cand as any)?.stage || ''
  // Never disturb a candidate the offer flow already owns.
  if (['Offer Sent', 'Joined'].includes(cur)) return cur
  let next: string
  if (decision === 'REJECT') next = 'Rejected'
  else if (decision === 'HOLD') next = HOLD_STAGE
  else next = stageForRound(round, ordinal)
  if (next === cur) return cur
  const { error } = await sb.from('candidates').update({ stage: next }).eq('id', candidateId)
  if (error) throw new Error(error.message)
  return next
}

/** 1-based ordinal of `round` among the candidate's rounds in first-seen order. */
export function roundOrdinal(rounds: string[], round: string): number {
  const i = rounds.findIndex(r => r.toLowerCase() === round.toLowerCase())
  return i === -1 ? rounds.length + 1 : i + 1
}

/** Distinct round names in first-scheduled order, from invite rows sorted by created_at. */
export function distinctRounds(invites: { round: string }[]): string[] {
  const out: string[] = []
  for (const i of invites) if (i.round && !out.some(r => r.toLowerCase() === i.round.toLowerCase())) out.push(i.round)
  return out
}
