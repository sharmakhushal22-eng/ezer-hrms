// lib/pms/publishGate.ts — what stops a result going out.
//
// ONE DEFINITION, TWO CALLERS. The publish card asks this about the person
// open in front of it; the bulk screen asks it about everybody selected. It
// was written inline in the card, which was fine while the card was the only
// way to publish — the moment there were two, two copies would have drifted,
// and the one that drifted looser would quietly become the way to release a
// result that the strict one refuses.
//
// It is deliberately NOT the database's rules re-implemented. Two of these
// faults mirror triggers (207's sign-off, 211's settlement) and exist so the
// button is disabled rather than throwing on click; two are the application's
// own (the remark, the mandatory improvement feedback) and the database has
// no opinion on them. Where a trigger is the authority, the condition is
// asked of the same helper the trigger's migration shipped with.
//
// ── THE DIFFERENCE BETWEEN THE TWO CALLERS ───────────────────────────────
//
// The card passes what is TYPED, including text not yet saved, so somebody
// writing a remark sees the fault clear as they type. Bulk passes what is
// SAVED, because there is nothing typed — a batch releases results that were
// already prepared. Same rule, different inputs, and the caller decides
// which because only the caller knows.

import { publishFault as hrPublishFault, type HrFinalRow } from './hrFinal.ts'

export interface GateInput {
  finalRating: number | null
  /** The words that go out. Typed on the card, saved in bulk. */
  appreciation?: string | null
  improvement?: string | null
  /** Whether this rating's band makes improvement feedback mandatory. */
  improvementRequired?: boolean
  /** 207: the final-review one-to-one with the manager's acknowledgement. */
  signedOff?: boolean
  /** 212: built outside the chain, so 207's rule does not apply. */
  hrDirect?: boolean
  /** 211: the HR Head's settlement. */
  hrFinal?: HrFinalRow | null
  hrFinalRequired?: boolean
}

/**
 * Everything stopping this result, in the order to deal with it.
 *
 * Empty means publishable. The list is returned rather than a boolean
 * because every caller shows the reasons: the card above its button, the
 * bulk screen beside the person it skipped.
 */
export function publishFaults(i: GateInput): string[] {
  const faults: string[] = []

  // A RESULT HAS TO EXIST. The card never sees a row without one — it lists
  // only settled appraisals — but bulk works from a filter, and a filter can
  // reach somebody the chain has not finished with.
  if (i.finalRating === null || i.finalRating === undefined) {
    faults.push('There is no final rating yet, so there is nothing to publish.')
  }

  if (!(i.appreciation ?? '').trim()) faults.push('An appreciation remark is needed.')

  if (i.improvementRequired && !(i.improvement ?? '').trim()) {
    faults.push(`Improvement feedback is mandatory at a rating of ${i.finalRating}.`)
  }

  // 211, via the helper its own migration shipped with.
  const hrFault = hrPublishFault(i.hrFinal, i.hrFinalRequired !== false)
  if (hrFault) faults.push(hrFault)

  // 207, which 212 waives for an appraisal built outside the chain: there is
  // no manager who could have had that conversation.
  if (i.signedOff === false && !i.hrDirect) {
    faults.push('The final review one-to-one is not on record with the '
              + 'manager’s acknowledgement yet. The conversation has to '
              + 'have happened before the rating reaches them.')
  }

  return faults
}

export const canPublish = (i: GateInput) => publishFaults(i).length === 0
