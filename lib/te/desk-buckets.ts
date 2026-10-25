// lib/te/desk-buckets.ts — the Travel Desk's work, gathered by the trip it
// belongs to.
//
// WHY. The desk's six rooms are worklists: every hotel waiting to be chosen,
// every ticket waiting to be bought, every journey waiting to be agreed, each
// as a flat list across every trip. That is the right shape for working a queue
// and the wrong shape for the other question a desk gets asked twenty times a
// day — "where are we on TRP-2026-0004?" — which needed opening three rooms and
// reading past everybody else's trips in each.
//
// So this groups the same rows by trip id. Nothing is taken away: the rooms
// stay, and this is one more way to look at them.
//
// THE GROUPING KEY IS NOT THE SAME ON EVERY ROW, which is the whole reason this
// is a tested function rather than four lines in a component. Four of the five
// lists carry `trip_id` / `trip_no` / `trip_name`; DeskStay carries `id` as the
// trip id and `name` as the trip name, because it is a row OF a trip rather
// than a row ABOUT one. Grouping on `trip_id` alone silently drops every hotel
// row — they would land under `undefined` and vanish from the view meant to
// show them.
import type { DeskBooked, DeskJourney, DeskStay, DeskToBook, DeskWatch } from './client.ts'

/** The kinds of desk work, in the order work flows. */
export const WORK_KINDS = ['stays', 'book', 'booked', 'journeys', 'watch'] as const
export type WorkKind = (typeof WORK_KINDS)[number]

/** One line on a trip's card: what kind of work, how much, and a word about it. */
export interface BucketLine {
  kind: WorkKind
  /** What the room is called, so the card and the tabs agree. */
  label: string
  n: number
  /** A short human summary of the rows — "flight, hotel", "2 waiting". */
  detail: string
  /** Does this need the desk to act? `booked` and `watch` do not. */
  todo: boolean
}

export interface DeskBucket {
  tripId: string
  tripNo: string
  tripName: string
  /** The traveller, and their code, for the card's subtitle. */
  who: string
  empCode: string
  lines: BucketLine[]
  /** How many pieces of work on this trip still need the desk. */
  todo: number
}

const LABEL: Record<WorkKind, string> = {
  stays: 'Hotels to choose',
  book: 'To book',
  booked: 'Booked',
  journeys: 'Journeys',
  watch: 'For information',
}
/** Which kinds are work rather than a record of work already done. */
const IS_TODO: Record<WorkKind, boolean> = {
  stays: true, book: true, journeys: true, booked: false, watch: false,
}

interface Seed {
  tripId: string
  tripNo: string
  tripName: string
  who: string
  empCode: string
  rows: Record<WorkKind, unknown[]>
}

/**
 * Every trip the desk has anything on, with its work gathered under it.
 *
 * Ordered by how much is outstanding, then by trip number — a desk opening this
 * wants the trips that need something first, and a stable order after that so
 * the list does not reshuffle under a cursor when one item is dealt with.
 */
export function deskBuckets(d: {
  stays?: DeskStay[]
  toBook?: DeskToBook[]
  booked?: DeskBooked[]
  journeys?: DeskJourney[]
  watch?: DeskWatch[]
}): DeskBucket[] {
  const by = new Map<string, Seed>()
  const seed = (tripId: string | undefined, tripNo: string, tripName: string, who: string | null, code: string | null): Seed | null => {
    if (!tripId) return null
    const found = by.get(tripId)
    if (found) {
      // The first row to name the traveller wins; some lists carry no name.
      if (!found.who && who) found.who = who
      if (!found.empCode && code) found.empCode = code
      return found
    }
    const made: Seed = {
      tripId, tripNo, tripName: tripName || '',
      who: who || '', empCode: code || '',
      rows: { stays: [], book: [], booked: [], journeys: [], watch: [] },
    }
    by.set(tripId, made)
    return made
  }

  // DeskStay's trip id is `id` and its trip name is `name` — see the header.
  for (const r of d.stays ?? []) seed(r.id, r.trip_no, r.name, r.full_name, r.emp_code)?.rows.stays.push(r)
  for (const r of d.toBook ?? []) seed(r.trip_id, r.trip_no, r.trip_name, r.full_name, r.emp_code)?.rows.book.push(r)
  for (const r of d.booked ?? []) seed(r.trip_id, r.trip_no, r.trip_name, r.full_name, r.emp_code)?.rows.booked.push(r)
  for (const r of d.journeys ?? []) seed(r.trip_id, r.trip_no, r.trip_name, r.full_name, r.emp_code)?.rows.journeys.push(r)
  for (const r of d.watch ?? []) seed(r.trip_id, r.trip_no, r.trip_name, r.full_name, r.emp_code)?.rows.watch.push(r)

  const out: DeskBucket[] = []
  for (const s of by.values()) {
    const lines: BucketLine[] = []
    for (const kind of WORK_KINDS) {
      const rows = s.rows[kind]
      if (!rows.length) continue
      lines.push({
        kind,
        label: LABEL[kind],
        n: kind === 'journeys' ? waitingJourneys(rows as DeskJourney[]) || rows.length : rows.length,
        detail: detailOf(kind, rows),
        // A journey already confirmed by this desk is a record, not work.
        todo: IS_TODO[kind] && (kind !== 'journeys' || waitingJourneys(rows as DeskJourney[]) > 0),
      })
    }
    out.push({
      tripId: s.tripId, tripNo: s.tripNo, tripName: s.tripName,
      who: s.who, empCode: s.empCode,
      lines,
      todo: lines.filter(l => l.todo).reduce((a, l) => a + l.n, 0),
    })
  }
  return out.sort((a, b) => b.todo - a.todo || a.tripNo.localeCompare(b.tripNo))
}

/** Journeys this desk has not confirmed yet. */
const waitingJourneys = (rows: DeskJourney[]) => rows.filter(j => !j.desk_confirmed_at).length

/** A few words about what the rows are, for the card. */
function detailOf(kind: WorkKind, rows: unknown[]): string {
  if (kind === 'book') {
    const r = rows as DeskToBook[]
    const legs = r.filter(x => x.kind === 'leg')
    const hotels = r.filter(x => x.kind === 'hotel')
    const bits: string[] = []
    // Name the modes rather than saying "2 legs": a desk reads "flight" and
    // knows which supplier to open.
    const modes = [...new Set(legs.map(l => l.mode).filter(Boolean))] as string[]
    if (legs.length) bits.push(modes.length ? modes.join(', ') : `${legs.length} to book`)
    if (hotels.length) bits.push(hotels.length === 1 ? 'a hotel' : `${hotels.length} hotels`)
    return bits.join(' · ')
  }
  if (kind === 'booked') {
    const r = rows as DeskBooked[]
    const noTicket = r.filter(b => !b.ticket_url).length
    const unsent = r.filter(b => b.ticket_url && !b.emailed_at).length
    const bits = [[...new Set(r.map(b => b.vendor).filter(Boolean))].slice(0, 2).join(', ')]
    if (noTicket) bits.push(`${noTicket} with no ticket`)
    else if (unsent) bits.push(`${unsent} not sent yet`)
    return bits.filter(Boolean).join(' · ')
  }
  if (kind === 'journeys') {
    const r = rows as DeskJourney[]
    const waiting = waitingJourneys(r)
    const subs = r.filter(j => j.is_subtrip).length
    const bits: string[] = []
    bits.push(waiting ? `${waiting} waiting` : 'all confirmed')
    if (subs) bits.push(subs === 1 ? 'one a sub-trip' : `${subs} sub-trips`)
    return bits.join(' · ')
  }
  if (kind === 'stays') {
    const r = rows as DeskStay[]
    const opts = r[0]?.stay_options?.length ?? 0
    return opts ? `${opts} offered · pick one` : 'no options given'
  }
  return 'nothing to do'
}

/**
 * One room's rows, narrowed to a single trip.
 *
 * SAME TRAP AS THE GROUPING, so it lives next to it: a hotel row's trip id is
 * `id`, not `trip_id`, because DeskStay is a row OF a trip. Filtering the
 * hotels room on `trip_id` would compare `undefined` to a uuid and quietly
 * empty the room — which reads exactly like "nothing to choose" and is the one
 * message that must never be wrong, because somebody is waiting on that answer.
 *
 * Vehicles are deliberately not here. A vehicle belongs to a person, not a
 * trip, so there is nothing to narrow it by and the room ignores a focus
 * rather than pretending to honour one.
 */
export function focusDeskRows<T>(kind: WorkKind, rows: T[], tripId: string | null): T[] {
  if (!tripId) return rows
  if (kind === 'stays') return rows.filter(r => (r as { id?: string }).id === tripId)
  return rows.filter(r => (r as { trip_id?: string }).trip_id === tripId)
}
