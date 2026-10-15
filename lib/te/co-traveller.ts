// lib/te/co-traveller.ts — a trip with more than one person on it.
//
// You add colleagues when you plan a trip. They are stored (te_trip_people),
// counted (`pax`), read back (`trip.co`), and the trip screen tells the planner
// "N people travel. Each claims their own expenses." For a long time none of
// that reached the colleagues: four server reads said "only the owner", so the
// people who actually went were the only ones who could not see the trip.
// Migration 155 opened those four. This file is the browser's half of it.
//
// TWO ROLES, NOT TWO PERMISSION SETS. There is exactly one question worth
// asking about a viewer: did they plan this trip, or were they taken on it.
// Everything else follows, and the server decides it anyway — `can.own` is
// false for a co-traveller, so every owner-only action on the trip screen
// already hides itself. What this file adds is the part the server cannot do:
// saying so, in words, instead of showing a stripped screen with no explanation.
//
// WHY `co` AND NOT `people`. `trip.people` is what was typed when the trip was
// planned, names and codes included, some of whom were never found in EZER.
// `trip.co` is te_trip_co: the resolved employee ids, which is exactly the set
// the SQL tests. Reading anything else here would let the screen disagree with
// the database about who is on the trip.
import type { TeTripPerson, Uuid } from './types.ts'

/** What the viewer is to a trip. */
export type TripRole = 'owner' | 'co' | 'none'

/** The little a trip has to carry for this file to answer anything. */
export interface TripWho {
  emp: Uuid
  co: Uuid[]
  people?: TeTripPerson[]
}

/**
 * Did the viewer plan this trip, were they taken on it, or neither.
 *
 * The owner wins if somehow both: a planner who also appears in the people
 * list is still the planner, and reading it the other way would hide their own
 * trip's controls from them.
 */
export function tripRole(trip: TripWho, me: Uuid): TripRole {
  if (trip.emp === me) return 'owner'
  if ((trip.co ?? []).includes(me)) return 'co'
  return 'none'
}

/** On this trip at all — the viewer planned it or travels on it. */
export function onTrip(trip: TripWho, me: Uuid): boolean {
  return tripRole(trip, me) !== 'none'
}

/** Taken on someone else's trip. */
export function isCoTraveller(trip: TripWho, me: Uuid): boolean {
  return tripRole(trip, me) === 'co'
}

/** More than one person travels, whoever is looking. */
export function isShared(trip: TripWho): boolean {
  return (trip.co ?? []).length > 0
}

/**
 * The other people on the trip, as names, the viewer left out.
 *
 * `people` holds what was typed, so somebody who was not found in EZER still
 * has a name and still travelled; they belong in the sentence even though they
 * have no employee id and cannot open the trip themselves.
 */
export function otherNames(trip: TripWho, me: Uuid): string[] {
  return (trip.people ?? [])
    .filter(p => p.emp !== me)
    .map(p => p.name.trim())
    .filter(Boolean)
}

/**
 * "With Asha Rao", "With Asha Rao and Rohit Mehta", "With Asha Rao and 3 others".
 *
 * Two names is the most that reads as a sentence; past that a count is kinder
 * than a list, and the full list is on the trip screen anyway.
 */
export function withText(trip: TripWho, me: Uuid): string {
  const names = otherNames(trip, me)
  if (!names.length) return ''
  if (names.length === 1) return `With ${names[0]}`
  if (names.length === 2) return `With ${names[0]} and ${names[1]}`
  return `With ${names[0]} and ${names.length - 1} others`
}

/**
 * What a co-traveller is told at the top of a trip that is not theirs.
 *
 * It answers the two questions that screen raises — why can I see this, and
 * why can I not change it — and names the person to go to, because "you cannot
 * edit this" without saying whose trip it is leaves them nowhere to go.
 *
 * Null for the owner and for anyone else: an owner needs no explanation of
 * their own trip, and nobody else gets this banner.
 */
export function coTravellerNote(trip: TripWho, me: Uuid, plannerName: string): string | null {
  if (!isCoTraveller(trip, me)) return null
  const who = plannerName.trim() || 'A colleague'
  return `${who} planned this trip and you are travelling on it. The route, the dates and the journeys are theirs to change — your own bills are yours to add, and you claim them yourself.`
}

/**
 * Whether it is worth offering a co-traveller the "add my bills" door.
 *
 * te_expense_save takes a bill in any trip state, so this is only about not
 * offering something pointless: a trip that was called off or refused is not
 * going to be spent on. CLAIMED and CLOSED stay open because a bill that turns
 * up late is exactly what a supplementary claim is for.
 */
const SPENT_NOTHING = ['CANCELLED', 'REJECTED']
export function coCanBill(trip: TripWho & { status: string }, me: Uuid): boolean {
  return isCoTraveller(trip, me) && !SPENT_NOTHING.includes(trip.status)
}

/**
 * My own claims on a trip. Everything else about a claim — its number, what
 * was approved, what was paid — belongs to the person who sent it.
 *
 * WHY THIS EXISTS. `te_trip_detail` returns every claim against the trip, and
 * until co-travellers could claim, "every claim on this trip" and "my claim"
 * were the same list. They are not any more, and two screens were reading one
 * and meaning the other: the card that offers to start a claim (which would go
 * quiet because a colleague had already claimed) and the cards that track one
 * (which would have shown a colleague their pay).
 */
export function myClaims<C extends { emp: Uuid }>(claims: C[], me: Uuid): C[] {
  return claims.filter(c => c.emp === me)
}
