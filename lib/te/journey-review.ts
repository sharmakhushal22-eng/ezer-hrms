// lib/te/journey-review.ts — where a journey's review has got to, and who may
// do what about it next.
//
// A "GPS sub-trip" is a journey added during a trip: land in Mumbai, add a
// journey to the client office, record it, add another. Until migration 180
// nobody outside the approval chain could see one — the travel desk's list
// shows a leg only while it is unstarted and desk-booked, and an added journey
// is always self-booked, so it could never appear there at all.
//
// WHO MUST CONFIRM IS THE COMPANY'S CHOICE, held in te_settings.extra as
// `journeyConfirm`. Four answers, and they are not interchangeable:
//
//   'both'     the travel desk agrees the journey happened, then Finance agrees
//              the money. The default, and the strictest: two people see every
//              cab ride. In turn, because "should we pay for this" only means
//              something once "did it happen" has been answered.
//   'finance'  Finance alone. The desk still sees every journey and can still
//              send one back; it is simply not a gate.
//   'desk'     the travel desk alone. For a company whose desk owns the travel
//              record and whose Finance team trusts it.
//   'none'     nobody has to. The list and the routes stay, as a record.
//
// NONE OF THIS PAYS ANYTHING. Confirming moves no money and refusing takes none
// away — the amount is the claim's, decided by the approval chain and by
// Finance on the claim itself. What this decides is whether a human has looked,
// and whether they asked for something first.
//
// SENDING ONE BACK HOLDS THE CLAIM, which is the point: the desk queried the
// route, the reason or the bill, and letting the claim through would ask the
// approver to sign off the very thing just queried. The traveller answers and
// the hold lifts — the confirmation does not come back, because whether the
// answer satisfies the desk is the desk's to say.
import type { DeskKind } from './desks'
import type { TeLegReview } from './types'

// Which desk is speaking is DeskKind from ./desks — 'finance' | 'travel', the
// same two words te_on_desk and te_desk_members take. Re-exported so a screen
// that only deals with journeys has one import, not two; deliberately NOT
// redefined, because a second spelling of the same pair is how 'travel_desk'
// and 'travel' end up being compared somewhere.
export type { DeskKind }

/** Who must confirm a journey before its review is finished. */
export type ConfirmPolicy = 'both' | 'finance' | 'desk' | 'none'

const POLICIES: ConfirmPolicy[] = ['both', 'finance', 'desk', 'none']

/**
 * The company's setting, or the default.
 *
 * Anything unrecognised reads as 'both' rather than as "no confirmation
 * needed": a typo in a settings box must not quietly switch the checks off.
 */
export function confirmPolicy(raw: unknown): ConfirmPolicy {
  const v = typeof raw === 'string' ? raw.trim() : ''
  return (POLICIES as string[]).includes(v) ? (v as ConfirmPolicy) : 'both'
}

/** Does this desk have to confirm, under this policy? */
export function mustConfirm(policy: ConfirmPolicy, desk: DeskKind): boolean {
  if (policy === 'none') return false
  if (policy === 'both') return true
  return policy === (desk === 'travel' ? 'desk' : 'finance')
}

/** Where one journey's review has got to, as one word. */
export type ReviewState =
  | 'waiting'    // reported, nobody has looked yet
  | 'desk-ok'    // the travel desk agreed; Finance still to come
  | 'fin-ok'     // Finance agreed; the desk still to come (policy 'both', out of order — see note)
  | 'done'       // everyone who had to confirm has
  | 'back'       // a desk asked the traveller for something; the claim is held
  | 'answered'   // the traveller answered; waiting on the desk again

export function reviewState(review: TeLegReview | null | undefined, policy: ConfirmPolicy): ReviewState {
  const r = review
  if (r?.backAt) return 'back'
  const desk = !!r?.deskAt
  const fin = !!r?.finAt
  // NOBODY HAD TO, SO NOBODY IS WAITING. A company on 'none' keeps the list and
  // the routes as a record, and every journey in it reads as finished.
  if (policy === 'none') return 'done'
  const deskDone = !mustConfirm(policy, 'travel') || desk
  const finDone = !mustConfirm(policy, 'finance') || fin
  if (deskDone && finDone) return 'done'
  // An answered question is not the same as an unexamined journey: somebody
  // asked, the traveller replied, and it is back with the desk. Showing it as
  // plain 'waiting' would lose the fact that a person is expecting a second
  // look at it.
  if (r?.answer && !desk && !fin) return 'answered'
  if (desk && !finDone) return 'desk-ok'
  if (fin && !deskDone) return 'fin-ok'
  return 'waiting'
}

/** Is the claim for this trip held because of this journey? */
export const holdsClaim = (review: TeLegReview | null | undefined): boolean => !!review?.backAt

/**
 * May this desk confirm this journey right now, and if not, why not?
 *
 * The same four refusals te_leg_confirm makes, so the button can be disabled
 * with the reason showing rather than the person pressing it and reading a
 * server error. SQL is still the floor — this is the explanation, not the rule.
 */
export function canConfirm(o: {
  desk: DeskKind
  policy: ConfirmPolicy
  status: string
  review: TeLegReview | null | undefined
}): { ok: true } | { ok: false; why: string } {
  if (o.status !== 'SUBMITTED') {
    return {
      ok: false,
      why: o.status === 'ENDED' ? 'The traveller has not reported this journey yet.'
        : o.status === 'ACTIVE' || o.status === 'PAUSED' ? 'This journey is still running.'
          : o.status === 'PLANNED' ? 'This journey has not been recorded yet.'
            : o.status === 'SKIPPED' ? 'This journey was skipped, so there is nothing to confirm.'
              : 'This journey cannot be confirmed.',
    }
  }
  if (o.policy === 'none') return { ok: false, why: 'This company does not ask anyone to confirm journeys.' }
  if (!mustConfirm(o.policy, o.desk)) {
    return {
      ok: false,
      why: o.desk === 'travel'
        ? 'Here, Finance confirms journeys. You can still send one back.'
        : 'Here, the travel desk confirms journeys. You can still send one back.',
    }
  }
  const already = o.desk === 'travel' ? o.review?.deskAt : o.review?.finAt
  if (already) {
    return { ok: false, why: o.desk === 'travel' ? 'The travel desk has already confirmed this journey.' : 'Finance has already confirmed this journey.' }
  }
  // IN TURN. Finance is asked whether to pay; the desk is asked whether it
  // happened. The second question has to be answered first for the first one to
  // mean anything.
  if (o.desk === 'finance' && o.policy === 'both' && !o.review?.deskAt) {
    return { ok: false, why: 'The travel desk has not confirmed this journey yet.' }
  }
  return { ok: true }
}

/** May this desk send this journey back? Any desk may, whatever the policy —
 *  a desk that is not a gate can still have a question, and a company that asks
 *  nobody to confirm has not thereby said a wrong route must be accepted. */
export function canSendBack(o: { status: string; review: TeLegReview | null | undefined }): { ok: true } | { ok: false; why: string } {
  if (o.status !== 'SUBMITTED') return { ok: false, why: 'Only a journey that has been reported can be sent back.' }
  if (o.review?.backAt) return { ok: false, why: 'This journey has already been sent back and is waiting on the traveller.' }
  return { ok: true }
}

/** The badge wording and tone for one review state. */
export function reviewTone(state: ReviewState): { text: string; tone: 'ok' | 'warn' | 'bad' | 'plain' } {
  switch (state) {
    case 'done': return { text: 'Confirmed', tone: 'ok' }
    case 'desk-ok': return { text: 'Desk confirmed', tone: 'ok' }
    case 'fin-ok': return { text: 'Finance confirmed', tone: 'ok' }
    case 'back': return { text: 'Sent back', tone: 'bad' }
    case 'answered': return { text: 'Answered, waiting', tone: 'warn' }
    default: return { text: 'Not looked at yet', tone: 'plain' }
  }
}

/**
 * What a desk should be told about the evidence in front of it, before it
 * confirms anything. Not verdicts — the engine's twelve journey flags already
 * do that on the claim — but the handful of absences a reviewer would
 * otherwise have to notice for themselves.
 */
export function evidenceNotes(j: {
  routeLine?: string
  manual?: boolean
  noGps?: string
  gpsPoints?: number | null
  mode?: string
  fileCount?: number
  basis?: string
}): string[] {
  const out: string[] = []
  if (j.manual) {
    out.push(j.noGps
      ? `No GPS record: ${j.noGps}`
      : 'No GPS record. The traveller entered the distance themselves.')
  } else if (!j.routeLine) {
    // A tracked journey with nothing to draw is either very old (before the
    // route was kept) or something went wrong. Either way the reviewer should
    // not be left wondering why the map is empty.
    out.push('No route was kept for this journey, so it cannot be drawn.')
  }
  // The bill is the amount for a cab or a rental, so its absence is the first
  // thing worth knowing. A per-km or no-bill mode is not missing anything.
  if (j.basis === 'bill' && !j.fileCount) out.push('No bill is attached, and this mode is paid on the bill.')
  return out
}
