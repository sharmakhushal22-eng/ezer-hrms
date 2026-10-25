// lib/te/trips-list.ts — how the trips list sorts itself out.
//
// Ported from the prototype's tripGroup / tripChip / tripMoney / T_LABEL / TONE
// (ui-04-trips.js, ui-01-core-ess.js). Pure, so the grouping and the wording
// are tested rather than eyeballed across seven trips in four states.
//
// The STATE of a trip is `trip.display`, which the server computed. What this
// file decides is only where that state belongs on the page and what to call
// it — a trip approved for next week and one approved for this morning are the
// same state and belong under different headings.
import type { TeClaim, TeExpense, TeTrip, TripDisplayStatus, TripScope, Uuid } from './types.ts'
import type { Tone } from './format.ts'
import { onTrip, type TripWho } from './co-traveller.ts'

export type TripGroupId = 'now' | 'next' | 'claim' | 'done'

export const TRIP_GROUPS: { id: TripGroupId; title: string }[] = [
  { id: 'now', title: 'Now and today' },
  { id: 'next', title: 'Coming up' },
  { id: 'claim', title: 'Back, to close and claim' },
  { id: 'done', title: 'Done' },
]

/**
 * Which heading a trip sits under.
 *
 * "Now and today" is the one that earns its place: a trip you are on, or one
 * approved whose first day has arrived. Everything else approved or waiting is
 * still ahead of you, and a trip you are back from is work to do rather than
 * history.
 */
export function tripGroup(trip: Pick<TeTrip, 'display' | 'start'>, today: string): TripGroupId {
  const st = trip.display
  if (st === 'ONGOING') return 'now'
  if (st === 'APPROVED' && !!trip.start && trip.start <= today) return 'now'
  if (st === 'APPROVED' || st === 'PENDING_APPROVAL' || st === 'SENT_BACK') return 'next'
  if (st === 'COMPLETED' || st === 'MISSED' || st === 'DRAFT') return 'claim'
  return 'done'
}

/** The tone each state is drawn in. The prototype's TONE table, trips only. */
const TRIP_TONE: Partial<Record<TripDisplayStatus, Tone>> = {
  DRAFT: 't-info',
  PENDING_APPROVAL: 't-warn',
  SENT_BACK: 't-warn',
  APPROVED: 't-brand',
  ONGOING: 't-info',
  COMPLETED: 't-info',
  MISSED: 't-warn',
  EXPIRED: 't-crit',
  CLAIMED: 't-brand',
  CLOSED: 't-pos',
  CANCELLED: 'plain',
  REJECTED: 't-crit',
}

const TRIP_LABEL: Partial<Record<TripDisplayStatus, string>> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  SENT_BACK: 'Sent back to you',
  ONGOING: 'On the trip',
  COMPLETED: 'Back, close and claim',
  MISSED: 'Missed',
  EXPIRED: 'Expired',
  CLAIMED: 'Claimed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
}

/**
 * The chip on a trip: what state it is in, in the employee's words.
 *
 * Approved says two different things depending on whether anybody had to
 * approve it. A short local trip needs nobody, and telling someone their trip
 * is "Approved" when no approver was involved invites them to wonder who did it.
 */
export function tripChip(trip: Pick<TeTrip, 'display' | 'chain'>): { label: string; tone: Tone } {
  const st = trip.display
  const tone = TRIP_TONE[st] ?? 'plain'
  if (st === 'APPROVED') {
    return { label: (trip.chain ?? []).length ? 'Approved' : 'Ready, no approval needed', tone }
  }
  return { label: TRIP_LABEL[st] ?? String(st).replace(/_/g, ' ').toLowerCase(), tone }
}

/**
 * The money shown against a trip, and what that number means.
 *
 * It changes as the trip moves: an estimate before you go, what you have ready
 * to claim while you are back, and what was approved or paid once a claim
 * exists. Showing an estimate next to a settled trip would be noise.
 */
export function tripMoney(
  trip: Pick<TeTrip, 'id' | 'selfEstimate'>,
  claims: Pick<TeClaim, 'tripId' | 'status' | 'approved' | 'claimed'>[],
  expenses: Pick<TeExpense, 'tripId' | 'status' | 'claimed'>[],
): { value: number; label: string } {
  const claim = claims.find(c => c.tripId === trip.id && c.status !== 'CANCELLED')
  if (claim) return { value: claim.approved ?? claim.claimed, label: claim.status === 'SETTLED' ? 'paid' : 'claimed' }
  const waiting = expenses.filter(x => x.tripId === trip.id && x.status === 'UNCLAIMED')
  if (waiting.length) return { value: waiting.reduce((a, x) => a + (Number(x.claimed) || 0), 0), label: 'to claim' }
  return { value: trip.selfEstimate ?? 0, label: 'estimate' }
}

/** The counts beside All / Local / Domestic / International. */
export function scopeCounts(trips: Pick<TeTrip, 'scope'>[]): { all: number; local: number; domestic: number; international: number } {
  return {
    all: trips.length,
    local: trips.filter(t => t.scope === 'local').length,
    domestic: trips.filter(t => t.scope === 'domestic').length,
    international: trips.filter(t => t.scope === 'international').length,
  }
}

/** The list, grouped and in order, with empty groups left out. */
export function groupTrips<T extends Pick<TeTrip, 'display' | 'start'>>(
  trips: T[],
  today: string,
): { id: TripGroupId; title: string; trips: T[] }[] {
  return TRIP_GROUPS
    .map(g => ({ ...g, trips: trips.filter(t => tripGroup(t, today) === g.id) }))
    .filter(g => g.trips.length > 0)
}

/**
 * The trips on my list, newest first. `scope` null means every kind.
 *
 * MINE, AND THE ONES I WAS TAKEN ON. This used to read `t.emp === me`, which
 * quietly undid the whole point of adding colleagues to a trip: they were
 * stored, counted in `pax` and told "each claims their own expenses", and the
 * trip never appeared on their own screen. The server now sends them the trip
 * (migration 155); filtering it back out here would leave that invisible.
 *
 * They are not separated into another group. A trip you are travelling on is a
 * trip you are travelling on, and it belongs under "Coming up" with the rest;
 * what differs is what you may do to it, which the row says and the trip screen
 * explains.
 */
export function myTrips(trips: TeTrip[], me: Uuid, scope: TripScope | null): TeTrip[] {
  return trips
    .filter(t => onTrip(t, me) && (!scope || t.scope === scope))
    .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))
}

/**
 * My unclaimed lines that belong to a trip, grouped by that trip. Screen 44.
 *
 * WHY THIS CARD EXISTS. "Other expenses" is the standing monthly claim, and it
 * holds only lines with no trip. A bill saved against a trip is real, saved and
 * unclaimed — and completely invisible on that screen, because it is not part
 * of that claim and never will be. Without this an employee adds a hotel bill
 * to a trip, opens Other expenses, sees nothing, and adds it again.
 *
 * Colleagues' lines (`other`) are in the snapshot only so the server can check
 * for duplicates, and are never mine to claim.
 */
export function linesWaitingInTrips<L extends { tripId: Uuid | null; status: string; other?: boolean; claimed?: number }>(
  expenses: L[],
  trips: Pick<TeTrip, 'id' | 'name'>[],
): { tripId: Uuid; name: string; count: number; total: number }[] {
  const byTrip = new Map<Uuid, { tripId: Uuid; name: string; count: number; total: number }>()
  for (const x of expenses) {
    if (x.other || x.status !== 'UNCLAIMED' || !x.tripId) continue
    const seen = byTrip.get(x.tripId)
    if (seen) {
      seen.count += 1
      seen.total += x.claimed ?? 0
    } else {
      byTrip.set(x.tripId, {
        tripId: x.tripId,
        // A trip missing from the snapshot still gets a row: the lines exist
        // either way, and hiding them is the bug this card is here to stop.
        name: trips.find(t => t.id === x.tripId)?.name ?? 'A trip',
        count: 1,
        total: x.claimed ?? 0,
      })
    }
  }
  return [...byTrip.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Stored trip statuses that can take a new expense line.
 *
 *  Deliberately keyed on `status` and not `display`: `display` folds ONGOING,
 *  COMPLETED, MISSED and EXPIRED out of a single stored APPROVED, and the SQL
 *  that will actually accept or refuse the move (185) reads `status`. Offering
 *  a trip the server would then refuse is worse than not offering it.
 */
const TAKES_LINES = new Set(['APPROVED', 'CLAIMED'])

/**
 * The trips a loose bill can be moved into.
 *
 * WHY THIS IS NOT JUST "my trips". A bill cannot go into a plan nobody has
 * approved yet — there is no policy to price it against — nor into one that was
 * cancelled, rejected, or closed and settled. Those are the same conditions
 * te_expense_move_trip enforces, repeated here only to decide what to put in
 * the picker; SQL remains the thing that says no.
 *
 * Newest first: a bill somebody is filing late almost always belongs to the
 * trip they have just come back from.
 */
export function tripsForLine<T extends Pick<TeTrip, 'id' | 'status' | 'start'> & TripWho>(
  trips: T[],
  me: Uuid,
  o: { exclude?: Uuid | null } = {},
): T[] {
  return trips
    .filter(t => TAKES_LINES.has(t.status))
    // The bucket it is already in is not somewhere to move it to.
    .filter(t => t.id !== o.exclude)
    .filter(t => onTrip(t, me))
    .slice()
    .sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')))
}

/**
 * What the mid-trip hero offers on this trip, for this reader.
 *
 * WHY THIS REPLACED A SINGLE "is it live" FLAG. The first version asked for
 * ONGOING, or APPROVED with the first day passed. That window sounds right and
 * is nearly always empty: a trip stops being ONGOING the moment its last
 * journey is closed, which is BEFORE the hotel bill is typed up, and it is
 * APPROVED-with-a-future-date for the week before anybody travels. Measured
 * against the live data, every one of the test traveller's three trips was
 * COMPLETED, CLAIMED or EXPIRED, and the one ONGOING trip in the whole
 * database belonged to somebody else — so the new screen could not be seen at
 * all. It was not a rendering fault; the gate simply never opened.
 *
 * So neither tile invents a window any more. Each follows the rule that
 * already governs the same action further down the same page:
 *
 *   a bill     canBillTrip's rule — anything the trip was not called off or
 *              refused for — with the addition that the trip must have been
 *              approved at some point. A bill on a request still waiting for
 *              approval has nothing to attach to, and `display` can read
 *              EXPIRED for a plan that was never approved at all, which is how
 *              a pending request ended up looking billable.
 *              CLOSED is left out: settled is finished, and the bill card
 *              lower down still takes a late one for a supplementary claim.
 *   a journey   the Route card's rule — ONGOING or COMPLETED, and only the
 *              planner's own trip. You cannot record a GPS journey against a
 *              trip whose claim has gone.
 *
 * The hero appears when either is true, so a trip you have just come back
 * from — the commonest moment for both acts — finally shows it.
 */
export interface TripHero { bill: boolean; journey: boolean; any: boolean }

/** Stored statuses where a bill still has a trip to belong to. */
const BILLABLE = new Set(['APPROVED', 'CLAIMED'])

export function tripHero(
  trip: Pick<TeTrip, 'display' | 'status'>,
  who: { canBill: boolean; mine: boolean },
): TripHero {
  const bill = who.canBill && BILLABLE.has(trip.status)
  const journey = who.mine && (trip.display === 'ONGOING' || trip.display === 'COMPLETED')
  return { bill, journey, any: bill || journey }
}

/**
 * The one trip Home's card is about: the trip that still wants something from
 * this person.
 *
 * A TRIP UNDER WAY OUTRANKS ONE YOU ARE BACK FROM, whatever the dates say.
 * Ordering by start alone picked a COMPLETED trip over an ONGOING one as soon
 * as the finished trip had the later date — which is how a traveller with a
 * journey actually recording was shown a different trip's card.
 *
 * COMPLETED-and-still-APPROVED is included because that is the commonest
 * moment for adding a bill: every journey closed, nothing claimed. A trip
 * stops being ONGOING before the hotel bill is typed up, and gating on ONGOING
 * alone left Home with nothing to show on real data.
 */
export function tripForHomeCard<T extends Pick<TeTrip, 'emp' | 'display' | 'status' | 'start'>>(
  trips: T[],
  me: Uuid,
): T | null {
  return trips
    .filter(t => t.emp === me
      && (t.display === 'ONGOING' || (t.display === 'COMPLETED' && t.status === 'APPROVED')))
    .slice()
    .sort((a, b) =>
      Number(b.display === 'ONGOING') - Number(a.display === 'ONGOING')
      || (b.start ?? '').localeCompare(a.start ?? ''))[0] ?? null
}
