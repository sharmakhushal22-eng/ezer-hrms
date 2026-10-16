// lib/te/entry-flow.ts — step 2 of "one way in": what the employee can continue
// on a trip kind, and the ways to start something new.
//
// Ported from the prototype's kindNow / FLOW_WAYS / wayOff
// (design/prototype/source/ui-09-entry-flow.js). Pure, so it is unit-tested and
// so the sheet in TeHome.tsx has no rules of its own.
//
// NOTHING HERE DECIDES POLICY. Whether a trip is ongoing, completed or missed is
// `trip.display`, which the server computed; whether a past trip is allowed is
// `cfg.postFacto`, which an admin set. This file only chooses the wording and
// the order the employee sees them in.
import type { IsoDate, TeLeg, TeTrip, TripScope, Uuid } from './types.ts'
import { day, plural } from './format.ts'

/** Which of the four tiles on the home screen a flow belongs to. */
export type FlowKind = TripScope | 'other'

/** The tone of a "Continue" row: the class on `.cont` in te.css. */
export type ContinueTone = 'live' | 'go' | 'warn' | ''

/** What the button on a "Continue" row does. The screen that handles it is named
 *  in UI-BUILD-GUIDE.md: legOpen and legStart are step 6, openTrip is step 5. */
export type ContinueAction = 'legOpen' | 'legStart' | 'openTrip'

export interface ContinueItem {
  tripId: Uuid
  /** The trip's name, drawn as the eyebrow above the title. */
  trip: string
  tone: ContinueTone
  title: string
  sub: string
  btn: string
  action: ContinueAction
  /** A leg id for legOpen / legStart, the trip id for openTrip. */
  id: Uuid
}

export interface EntryFacts {
  me: Uuid
  today: IsoDate
  trips: TeTrip[]
  journeys: TeLeg[]
  /** Place id → its short name (`TePlace.s`). */
  placeName: (id: Uuid) => string
  /** Mode id → its name (`cfg.modes[].name`). */
  modeName: (id: string) => string
}

/** A trip's legs, in the order they are travelled. */
export function legsOf(trip: Pick<TeTrip, 'id'>, journeys: TeLeg[]): TeLeg[] {
  return journeys.filter(j => j.tripId === trip.id).sort((a, b) => a.n - b.n)
}

/** 'EZER office → Manesar plant'. */
export function legTitle(leg: Pick<TeLeg, 'from' | 'to'>, placeName: (id: Uuid) => string): string {
  return `${placeName(leg.from)} → ${placeName(leg.to)}`
}

/** 'Home → Northwind Gulf, Dubai → Home' — every point of the plan in order. */
export function routeText(trip: Pick<TeTrip, 'points'>, placeName: (id: Uuid) => string): string {
  return (trip.points || []).map(p => placeName(p.place) || '…').join(' → ')
}

/** '7 Dec to 10 Dec', or one date when the trip is a single day. */
export function tripDates(trip: Pick<TeTrip, 'start' | 'end'>): string {
  if (!trip.start) return ''
  return trip.start === trip.end ? day(trip.start) : `${day(trip.start)} to ${day(trip.end)}`
}

/** The leg the employee is on, or the next one waiting. */
export function currentLeg(legs: TeLeg[]): TeLeg | null {
  return legs.find(j => j.status === 'ACTIVE' || j.status === 'PAUSED' || j.status === 'ENDED')
    ?? legs.find(j => j.status === 'PLANNED')
    ?? null
}

/** The trips of one kind whose legs may be started: the "Start an approved trip" way. */
export function approvedTrips(scope: TripScope, f: Pick<EntryFacts, 'me' | 'trips'>): TeTrip[] {
  return f.trips.filter(t => t.emp === f.me && t.scope === scope && (t.display === 'APPROVED' || t.display === 'ONGOING'))
}

/** What needs the employee on trips of one kind: a running leg, a report to save,
 *  today's leg, a claim to send. One row per trip, the most urgent reason only. */
export function continueItems(scope: TripScope, f: EntryFacts): ContinueItem[] {
  const running = f.journeys.find(j => j.emp === f.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null
  const out: ContinueItem[] = []

  for (const t of f.trips.filter(x => x.emp === f.me && x.scope === scope)) {
    const legs = legsOf(t, f.journeys)
    const live = running && running.tripId === t.id ? running : null
    const report = legs.find(j => j.status === 'ENDED')
    // Today's leg, but only once every leg before it is closed: the legs of a trip
    // are travelled in order.
    const open = (j: TeLeg) => j.status === 'PLANNED' || j.status === 'ACTIVE' || j.status === 'PAUSED'
    const now = legs.find(j => j.status === 'PLANNED' && j.date === f.today && !legs.some(k => k.n < j.n && open(k)))
    const row = (x: Omit<ContinueItem, 'tripId' | 'trip'>) => out.push({ tripId: t.id, trip: t.name, ...x })

    if (live) {
      row({ tone: 'live', title: `On the way: journey ${live.n}`, sub: legTitle(live, f.placeName), btn: 'Open the journey', action: 'legOpen', id: live.id })
    } else if (report) {
      row({ tone: 'warn', title: `Journey ${report.n} ended. Save its report`, sub: legTitle(report, f.placeName), btn: 'Save report', action: 'legOpen', id: report.id })
    } else if (now && (t.display === 'APPROVED' || t.display === 'ONGOING')) {
      row({
        tone: 'go',
        title: `Ready today: journey ${now.n} of ${legs.length}`,
        sub: `${legTitle(now, f.placeName)} · ${f.modeName(now.mode)}`,
        btn: now.gps === 'checkin' ? 'Check in' : 'Start journey',
        action: 'legStart',
        id: now.id,
      })
    } else if (t.display === 'COMPLETED') {
      row({ tone: 'warn', title: 'Back. Send the claim', sub: `${plural(legs.length, 'journey')} closed`, btn: 'Open trip', action: 'openTrip', id: t.id })
    } else if (t.display === 'MISSED') {
      row({ tone: 'warn', title: `Not travelled on ${day(t.start)}`, sub: 'Add the journeys without GPS, or remove it', btn: 'Open trip', action: 'openTrip', id: t.id })
    } else if (t.display === 'SENT_BACK') {
      row({ tone: 'warn', title: 'Your approver asked a question', sub: 'Answer and send it again', btn: 'Open trip', action: 'openTrip', id: t.id })
    } else if (t.display === 'DRAFT' && t.origin === 'POST_FACTO') {
      row({ tone: '', title: 'Recorded after travel: add the fares', sub: plural(legs.length, 'journey'), btn: 'Open trip', action: 'openTrip', id: t.id })
    }
  }
  return out
}

// ── the ways to start something new ─────────────────────────────────────────

/** The id is the prototype's data-id, kept so each way can be traced to its handler. */
export type WayId = 'start' | 'plan' | 'approved' | 'past' | 'add' | 'submit'

export interface WayDef {
  id: WayId
  title: string
  /** A key of TeIcon's PATHS. */
  icon: string
  text: string
  /** The small pills under the text. */
  chips: string[]
}

/** The ways in, per kind, in the order they are offered. The first enabled one is
 *  drawn as the primary. Wording is the prototype's FLOW_WAYS, unchanged. */
export const FLOW_WAYS: Record<FlowKind, WayDef[]> = {
  local: [
    { id: 'start', title: 'Start now', icon: 'play', text: 'Leaving now. Your phone records each journey, with stops, until you are back.', chips: ['GPS on every journey', 'No approval up to 75 km'] },
    { id: 'plan', title: 'Plan a trip', icon: 'cal', text: 'For later today or another day. Add stops and the people going with you.', chips: ['Approval above 75 km'] },
    { id: 'past', title: 'I already travelled', icon: 'history', text: 'The trip was not tracked and you want the reimbursement. Within 7 days.', chips: ['Journeys without GPS', 'Reason needed'] },
  ],
  domestic: [
    { id: 'plan', title: 'Plan a trip', icon: 'cal', text: 'Flights, trains, cabs and hotel. It goes for approval, the Travel Desk books.', chips: ['Approval before you leave', 'Advance if needed'] },
    { id: 'approved', title: 'Start an approved trip', icon: 'play', text: 'Your trip is approved. Start its first journey or check in at the airport.', chips: ['GPS and check-ins'] },
    { id: 'past', title: 'I already travelled', icon: 'history', text: 'You travelled without approval and want the reimbursement.', chips: ['HOD approves', 'Reason needed'] },
  ],
  international: [
    { id: 'plan', title: 'Plan a trip', icon: 'cal', text: 'Any country. Flights, cabs abroad and hotel. RM and HOD approve.', chips: ['Approval before you leave', 'Advance if needed'] },
    { id: 'approved', title: 'Start an approved trip', icon: 'play', text: 'Your trip is approved. Start its first journey or check in at the airport.', chips: ['Check-ins abroad'] },
    { id: 'past', title: 'I already travelled', icon: 'history', text: 'You travelled without approval and want the reimbursement.', chips: ['HOD approves', 'Reason needed'] },
  ],
  other: [
    { id: 'add', title: 'Add a bill', icon: 'plus', text: 'Photograph or upload the bill, pick what it was for, and save it. It is checked against your limits at once.', chips: ['Bill scan', 'Checked against policy'] },
    { id: 'submit', title: 'Submit saved bills', icon: 'other', text: 'Send the bills you saved as one claim to your manager.', chips: ['One claim for the month'] },
  ],
}

export const KIND_NAME: Record<FlowKind, string> = {
  local: 'Local trip',
  domestic: 'Domestic trip',
  international: 'International trip',
  other: 'Other expense',
}

export interface WayFacts {
  /** cfg.track.manualAllowed — may a local trip be claimed without GPS. */
  manualAllowed: boolean
  /** cfg.postFacto — 'blocked' means approval is needed before every trip. */
  postFacto: 'allowed' | 'limited' | 'blocked'
  /** How many bills are saved but not yet in a claim. */
  savedBills: number
  /** How many trips of this kind are approved and may be started. */
  approved: number
}

/** Why a way cannot be taken, in the sentence the employee sees. Empty when it can.
 *  These are the company's settings, not the screen's opinion. */
export function wayOff(kind: FlowKind, way: WayId, f: WayFacts): string {
  if (way === 'past' && kind === 'local' && !f.manualAllowed) return 'Your company accepts local trips only with GPS.'
  if (way === 'past' && kind !== 'local' && f.postFacto === 'blocked') return 'Your company needs approval before every trip.'
  if (way === 'submit' && !f.savedBills) return 'No saved bills yet. Add one first.'
  if (way === 'approved' && !f.approved) return `No approved ${KIND_NAME[kind].toLowerCase()} yet. Plan one first.`
  return ''
}

/** The count badge beside a way's title; 0 means no badge. */
export function wayCount(way: WayId, f: Pick<WayFacts, 'savedBills' | 'approved'>): number {
  if (way === 'submit') return f.savedBills
  if (way === 'approved') return f.approved
  return 0
}

/** The three labels across the top of the sheet. Which one is current is the
 *  caller's business; this only words them from what has been chosen so far. */
export function flowSteps(kind: FlowKind | null, way: WayId | null): { small: string; label: string }[] {
  const chosen = kind ? FLOW_WAYS[kind].find(w => w.id === way) : undefined
  return [
    { small: 'What', label: kind ? KIND_NAME[kind] : 'Choose' },
    { small: 'How', label: chosen ? chosen.title : 'Choose' },
    { small: 'Details', label: way === 'approved' ? 'Choose the trip' : 'Fill the form' },
  ]
}
