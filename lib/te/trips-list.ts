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

/** My own trips of a kind, newest first. `scope` null means every kind. */
export function myTrips(trips: TeTrip[], me: Uuid, scope: TripScope | null): TeTrip[] {
  return trips
    .filter(t => t.emp === me && (!scope || t.scope === scope))
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
