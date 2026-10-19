// lib/te/trip-draft.ts — the trip planner's in-progress state.
//
// Ported from the prototype's twDefault / twSync / twDraft / twLbl / twStepOf /
// twFirstOpen / autoName (ui-06-trip-planner.js, ui-04-trips.js).
//
// TWO DIFFERENT THINGS ARE CALLED A DRAFT. `PlannerDraft` here is what the three
// screens edit: it carries which step you are on, which route line is open, and
// whether you have tried to move on yet. `TripDraft` in types.ts is the payload
// the server takes. `toTripDraft` turns the first into the second.
//
// EVERY FUNCTION RETURNS A NEW DRAFT. The prototype mutates a global; React needs
// a new object or the screen does not repaint.
//
// NOTHING HERE DECIDES WHETHER A TRIP IS ALLOWED. The distances, the money, the
// legs, the approval chain and every refusal come back from te.tripPreview. What
// lives here is the shape of the form: how many segments a route of N places has,
// what a line is called, which step owns an error. `syncDraft` repairs the shape
// after every edit, which is the one job the screen cannot hand to the server —
// the server never sees a half-edited route.
import type { IsoDate, TeMode, TeStayOption, TripDraft, TripIssue, TripOrigin, TripPattern, TripScope, Uuid } from './types.ts'
import { emptyStayOption, usableStayOptions, type StayOption } from './trip-stay.ts'
import { foldOther, splitOther } from './other-reason.ts'

/** One place on the route. */
export interface DraftPoint {
  /** '' until a place is chosen. */
  place: string
  /** A place type from cfg.ptypes. */
  pt: string
  /** The day you leave this place. On point 0 it is the trip's start date. */
  leave: IsoDate | ''
  /**
   * The day you ARRIVE here. Only asked for on the return point, where it is
   * the day you are back at your starting point — the second half of what a
   * round trip means, and the one date the planner used to derive instead of
   * ask for.
   *
   * It is a real date and not a calculation because the journey home can cross
   * midnight: leaving the client at 10pm on the 16th and reaching home at 6am
   * on the 17th is one trip ending on the 17th, and nothing but the traveller
   * knows that. Everywhere else the server fills arrival in from the legs.
   */
  arrive?: IsoDate | ''
  /**
   * The TIME of day, 'HH:MM' or '' for not recorded — which is not the same as
   * midnight, and the database keeps that difference (migration 165).
   *
   * Asked for where the date is asked for: the departure on point 0, and the
   * arrival back on the return point. A time tells the approver and the
   * Travel Desk whether "the 16th" is a 6am flight needing a cab at 4 or an
   * evening train, which is the whole reason it is collected.
   *
   * Nothing computes on it. No estimate and no leg timing reads it yet.
   */
  leaveAt?: string
  arriveAt?: string
  /** What you will do there, or why you stop. */
  what: string
  /** For the Travel Desk, about this place rather than about a journey:
   *  "need a late check-in", "the client office shuts at 6". Separate from
   *  `what`, which says why you are going and which the approver reads. */
  prefNote?: string
  /** A link about this place — the hotel, the venue, the booking. */
  prefUrl?: string
  /** Only ever set on the one point you come back to. */
  ret?: true
  /**
   * A place you pass through rather than the place you are going to.
   *
   * WHY THIS IS STORED AND NOT WORKED OUT FROM THE ORDER. It used to be: the
   * last place that was not the return point was the destination, and
   * everything before it was a stop. That can only ever express stops on the
   * way OUT. The moment you want one on the way back — go to Mumbai, break
   * the journey at Pune coming home — position cannot tell the two apart,
   * because "after the destination" and "is the destination" are the same
   * slot in the list.
   *
   * So the point says which it is. Undefined means "work it out from the
   * order", which keeps every trip saved before this column behaving exactly
   * as it did.
   */
  stop?: true
}

/** How you travel between two consecutive points. */
export interface DraftSeg {
  mode: string
  vehicleId: string
  bookedBy: 'desk' | 'self'
  xfer: { first: string; last: string; hubA?: string; hubB?: string }
  /**
   * WHAT THE TRAVEL DESK NEEDS TO ACTUALLY BOOK THIS.
   *
   * The plan says Mumbai to Jaipur by flight on the 2nd. That is not enough
   * to buy a ticket: there are a dozen flights that day and the desk has been
   * guessing, or writing to the traveller to ask. These are the answers to
   * the questions it would have asked.
   *
   * All three are optional. A plan with none of them is exactly the plan that
   * was sent before, and the desk books as it did.
   *
   * `prefTime` is the time of day the person wants to leave, 'HH:MM' or ''.
   * Not a promise and nothing computes on it — the leg's own date and times
   * stay on the route, where they belong.
   */
  prefTime?: string
  /** A link to the flight, train or fare they found, for the desk to match. */
  prefUrl?: string
  /** Anything the two fields above cannot say: "either the 6am or after 8pm",
   *  "same airline as the outbound", "aisle seat". */
  prefNote?: string
}

export interface DraftPerson { id: string; name: string; autoName?: boolean }

/** The planner's five steps. Was three until the route, how you travel, and
 *  where you stay were pulled apart: one long "Route" step asked for places,
 *  dates, a mode per leg, first and last mile and who books it, all at once,
 *  and the stay was a block buried in Review where nobody expected a question.
 *
 *    1 Trip      what it is, why, who is going
 *    2 Route     one way or round trip, where from, where to, when
 *    3 Commute   how you travel each leg  (offered per trip kind)
 *    4 Stay      a hotel, and the food budget   (only when one is wanted)
 *    5 Review    the whole plan, the map, the money, then send
 *
 *  THESE NUMBERS ARE IDENTITIES, NOT POSITIONS. Step 4 is dropped for a trip
 *  that needs no stay, and Review is then the fourth screen while still being
 *  PlanStep 5. visibleSteps() gives the sequence; the planner numbers the chips
 *  from their place in it, so the reader counts 1, 2, 3, 4 and never wonders
 *  what happened to one of them.
 */
export type PlanStep = 1 | 2 | 3 | 4 | 5
export const LAST_STEP: PlanStep = 5

/** The modes that need a ticket and an airport or a station: the ones the
 *  step-1 question is about. Matches HUB_OF in the engine. */
export const HUB_MODES = ['flight', 'train']

/**
 * Which steps this draft actually shows, in order.
 *
 * The Stay step is dropped unless they said they need a hotel or food. A trip
 * out and back in a day has nothing to answer there, and a step that exists
 * only to be skipped teaches people to skip steps.
 *
 * Every other step is always shown: the route, how you travel and the review
 * are not optional on any kind of trip.
 */
export function visibleSteps(d: { stayWanted?: boolean }): PlanStep[] {
  return ([1, 2, 3, 4, 5] as PlanStep[]).filter(n => n !== 4 || d.stayWanted === true)
}

/** The step to land on when the one you are standing on disappears — the next
 *  one that still exists, or the last if there is none after it. */
export function nearestStep(d: { stayWanted?: boolean }, want: PlanStep): PlanStep {
  const steps = visibleSteps(d)
  return steps.includes(want) ? want : (steps.find(n => n > want) ?? steps[steps.length - 1])
}

/** The step after this one, or null at the end. */
export function stepAfter(d: { stayWanted?: boolean }, from: PlanStep): PlanStep | null {
  return visibleSteps(d).find(n => n > from) ?? null
}

/** The step before this one, or null at the start. */
export function stepBefore(d: { stayWanted?: boolean }, from: PlanStep): PlanStep | null {
  const before = visibleSteps(d).filter(n => n < from)
  return before.length ? before[before.length - 1] : null
}

/**
 * What step 1 is still waiting for, in the words the planner shows.
 *
 * Only the two new questions live here. Everything else on step 1 — the name,
 * the purpose, who is travelling — is the server's to refuse, and arrives as a
 * blocker with a field key. These two are the planner's own, because the
 * engine has no opinion about them: both answers only decide what the form
 * asks next.
 *
 * `offersHub` is whether this kind of trip can use a flight or a train at all,
 * which is the company's configuration (te_modes.scope_local and friends). When
 * it cannot — a local trip, by default — the question is not asked and not
 * waited for.
 */
export function step1Gaps(d: { stayWanted?: boolean; flightOrTrain?: boolean }, offersHub: boolean): string[] {
  const gaps: string[] = []
  if (d.stayWanted === undefined) gaps.push('Say whether you need a hotel or a food allowance.')
  if (offersHub && d.flightOrTrain === undefined) gaps.push('Say whether a flight or a train is part of this trip.')
  return gaps
}

export interface PlannerDraft {
  step: PlanStep
  origin: TripOrigin
  scope: TripScope
  /** Derived by syncDraft from the route; never set by hand. */
  pattern: TripPattern
  name: string
  /** Once you type a name, it stops being replaced by the generated one. */
  nameTouched: boolean
  purpose: string
  /** The explanation behind "Other". Held apart from `purpose` while the form
   *  is open so the picker and the box are each editable, and folded into the
   *  one `purpose` string on the way to the server. */
  purposeNote: string
  project: string
  pax: number
  people: DraftPerson[]
  points: DraftPoint[]
  /** Always points.length - 1 entries. syncDraft keeps it so. */
  segs: DraftSeg[]
  retSame: boolean
  stayBy: 'self' | 'desk'
  /** "Do you need a stay?" — undefined until the planner is answered, so an
   *  untouched draft can be told from a deliberate no. */
  /** "Do you need a hotel or a food allowance?", asked on step 1. The Stay
   *  step is shown only when this is true: a same-day trip has nothing to
   *  answer there, and four empty questions are worse than none.
   *  undefined = not asked yet, which is not the same as a deliberate no. */
  stayWanted?: boolean
  foodWanted?: boolean
  /** "Will a flight or a train be part of this?", asked on step 1. When it is
   *  false the commute step stops offering those modes, and with no flight or
   *  train segment there is no airport or station to choose on the route.
   *
   *  NOT STORED ON THE TRIP, and it does not need to be: a saved trip answers
   *  the question by itself — a flight or train segment means yes. fromTrip
   *  derives it, which is why this needed no migration. */
  flightOrTrain?: boolean
  /** Always three rows while planning, however many are filled in. */
  stayOptions: StayOption[]
  advance: number | ''
  pfReason: string
  pfNote: string
  /** The route line showing its fields: 'p0', 's1', … undefined means "open the
   *  first one that needs work"; null means "the person closed them all". */
  open?: string | null
  /** Set the first time a gate refuses. No error is shown before it. */
  tried?: boolean
  /** Set when editing a trip that already exists. */
  editId?: Uuid
  answerNeeded?: boolean
  answer?: string
  /** The kind was chosen on the way in, so the planner shows it rather than asking. */
  lockScope?: boolean
}

/** What the draft functions need to know about the company and the employee. */
export interface DraftContext {
  today: IsoDate
  /** The employee's base office, which a trip starts and ends at by default. */
  officePlace: string
  /** Vehicles the company pays for, best first. */
  vehicles: { id: string }[]
  modes: TeMode[]
  /** Place id -> its short name, for the generated trip name. */
  placeName: (id: string) => string
}

const PURPOSE_NOUN: Record<string, string> = {
  'Client meeting': 'client meeting',
  'Site or plant visit': 'visit',
  'Dealer or partner visit': 'dealer visit',
  'Delivery or collection': 'delivery',
  'Audit or inspection': 'audit',
  'Training or event': 'training',
  'Bank or government work': 'bank work',
}

export const PURPOSES = [
  'Client meeting', 'Site or plant visit', 'Dealer or partner visit', 'Delivery or collection',
  'Audit or inspection', 'Training or event', 'Bank or government work', 'Other',
]

export const MAX_PEOPLE = 20
export const MAX_NAME = 60

/** The name the planner fills in while you have not typed one. */
export function autoName(purpose: string, placeNames: string[]): string {
  const n = placeNames.filter(Boolean).join(' and ')
  if (!n) return purpose && purpose !== 'Other' ? purpose : ''
  const v = `${n} ${PURPOSE_NOUN[purpose] || 'trip'}`
  return v.length > MAX_NAME ? `${v.slice(0, MAX_NAME - 1)}…` : v
}

const firstVehicle = (c: DraftContext) => c.vehicles[0]?.id ?? ''

/** What a trip of this kind travels by unless told otherwise. */
export function defaultMode(scope: TripScope, c: DraftContext, flightOrTrain?: boolean): string {
  if (scope === 'local') return firstVehicle(c) ? 'own' : 'cab'
  // SAID NO TO A FLIGHT OR A TRAIN, so defaulting an outstation trip to
  // 'flight' would put back the very thing they just ruled out, and syncDraft
  // would then replace it again on the next edit. A cab is the honest default
  // for a long trip somebody is driving.
  if (flightOrTrain === false) return firstVehicle(c) ? 'own' : 'cab'
  return 'flight'
}

export function newSeg(mode: string, vehicleId: string): DraftSeg {
  return { mode, vehicleId: mode === 'own' ? vehicleId : '', bookedBy: 'desk', xfer: { first: 'cab', last: 'cab' } }
}

const blankPoint = (): DraftPoint => ({ place: '', pt: '', leave: '', what: '' })

/** A new plan: out of the office, somewhere yet to be chosen, and back again. */
export function newPlannerDraft(o: { scope: TripScope; origin: TripOrigin; lastWorkday: IsoDate }, c: DraftContext): PlannerDraft {
  const mode = defaultMode(o.scope, c)
  const veh = firstVehicle(c)
  // A local trip is one day, so it has its date from the start. A trip with
  // nights in it has no sensible default, so it asks.
  const start: IsoDate | '' = o.scope === 'local' ? (o.origin === 'POST_FACTO' ? o.lastWorkday : c.today) : ''
  return syncDraft({
    step: 1,
    origin: o.origin,
    scope: o.scope,
    pattern: 'round',
    name: '', nameTouched: false, purpose: '', purposeNote: '', project: '',
    pax: 1, people: [],
    points: [
      { place: c.officePlace, pt: 'corp', leave: start, what: '' },
      blankPoint(),
      { place: c.officePlace, pt: 'corp', leave: '', arrive: '', what: '', ret: true },
    ],
    segs: [newSeg(mode, veh), newSeg(mode, veh)],
    retSame: true, stayBy: 'self', advance: '', pfReason: '', pfNote: '',
    stayOptions: [emptyStayOption(), emptyStayOption(), emptyStayOption()],
  }, c)
}

/**
 * A saved trip, opened for changing. Screens 68b and 68c.
 *
 * The trip comes back from the server with `arrive` filled in on every point.
 * That is derived, not typed, so it is dropped — except on the return point,
 * where the arrival IS what the person typed (the day they are back). The
 * planner stores only what was entered and lets the server work out the rest.
 *
 * `answerNeeded` is the difference between editing a plan of your own and
 * answering one your approver sent back: the second has to say what changed,
 * and opens on Review where that box is.
 */
export function fromTrip(trip: {
  id: Uuid; name: string; scope: TripScope; origin: TripOrigin; purpose: string; project: string
  points: { place: Uuid; pt: string; what: string; leave: IsoDate | ''; arrive?: IsoDate | ''; leaveAt?: string; arriveAt?: string; ret?: true; stop?: true; prefNote?: string; prefUrl?: string }[]
  segs: { mode: string; bookedBy: string; vehicleId: Uuid | null; xfer: { first?: string; last?: string; hubA?: Uuid; hubB?: Uuid }; prefTime?: string; prefUrl?: string; prefNote?: string }[]
  pax: number; people: { id: string; name?: string }[]; stayBy: 'self' | 'desk'; advance: number
  stayWanted?: boolean | null; foodWanted?: boolean | null; stayOptions?: TeStayOption[]
  pfReason: string; pfNote: string; status: string
}, c: DraftContext): PlannerDraft {
  const sentBack = trip.status === 'SENT_BACK'
  return syncDraft({
    // Answering a question starts where the answer is asked for; an ordinary
    // edit starts at the beginning, because anything may be what you came for.
    step: sentBack ? LAST_STEP : 1,
    origin: trip.origin,
    scope: trip.scope,
    pattern: 'round',
    name: trip.name ?? '',
    // The name is already the person's, whether they typed it or accepted the
    // generated one. Reopening a trip must not silently rename it.
    nameTouched: true,
    // A saved "Other — <reason>" comes back as the option plus its note, so
    // reopening a trip shows the picker selected and the box filled rather
    // than an unrecognised purpose and nothing chosen.
    purpose: splitOther(trip.purpose).choice,
    purposeNote: splitOther(trip.purpose).note,
    project: trip.project ?? '',
    pax: trip.pax || 1,
    people: (trip.people ?? []).map(p => ({ id: p.id ?? '', name: p.name ?? '' })),
    points: (trip.points ?? []).map((p, i) => ({
      place: p.place ?? '', pt: p.pt ?? '', what: p.what ?? '', leave: p.leave ?? '',
      leaveAt: p.leaveAt ?? '', arriveAt: p.arriveAt ?? '',
      // The arrival of every point now, not only the return's. It used to be
      // dropped here because the server derived it and pulling it back would
      // have stored an answer the planner never asked for. The planner asks
      // for it, so reopening a trip has to show what was said.
      //
      // Except the start: you do not arrive where you begin. derive() clears
      // it on every trip, so carrying it into the draft would show a field
      // the engine is about to throw away.
      ...(i > 0 && p.arrive ? { arrive: p.arrive } : {}),
      ...(p.prefNote ? { prefNote: p.prefNote } : {}),
      ...(p.prefUrl ? { prefUrl: p.prefUrl } : {}),
      ...(p.ret ? { ret: true as const } : {}),
      ...(p.stop ? { stop: true as const } : {}),
    })),
    segs: (trip.segs ?? []).map(s => ({
      mode: s.mode,
      vehicleId: s.vehicleId ?? '',
      bookedBy: s.bookedBy === 'self' ? 'self' : 'desk',
      xfer: { first: s.xfer?.first ?? 'cab', last: s.xfer?.last ?? 'cab', hubA: s.xfer?.hubA, hubB: s.xfer?.hubB },
      ...(s.prefTime ? { prefTime: s.prefTime } : {}),
      ...(s.prefUrl ? { prefUrl: s.prefUrl } : {}),
      ...(s.prefNote ? { prefNote: s.prefNote } : {}),
    })),
    // Whether the return mirrors the start is not stored on a saved trip, so it
    // is read back off the route: the same place means it still does.
    retSame: isReturnSameAsStart(trip.points ?? []),
    stayBy: trip.stayBy ?? 'self',
    stayWanted: trip.stayWanted ?? undefined,
    foodWanted: trip.foodWanted ?? undefined,
    // The trip answers this itself: a flight or train segment means yes. So
    // reopening a saved plan never asks again, and no column was needed.
    flightOrTrain: (trip.segs ?? []).some(s => HUB_MODES.includes(s.mode)),
    // Always three rows on screen, however many were saved.
    stayOptions: [0, 1, 2].map(i => trip.stayOptions?.[i]
      ? { ...trip.stayOptions[i], price: trip.stayOptions[i].price ?? '' }
      : emptyStayOption()),
    advance: trip.advance || '',
    pfReason: trip.pfReason ?? '',
    pfNote: trip.pfNote ?? '',
    editId: trip.id,
    answerNeeded: sentBack,
    // The kind can be changed when editing, so the picker is shown rather than
    // the fixed row the entry flow leaves behind.
    lockScope: false,
  }, c)
}

function isReturnSameAsStart(points: { place: Uuid; ret?: true }[]): boolean {
  const ret = points.find(p => p.ret)
  return !!ret && !!points[0] && ret.place === points[0].place
}

/**
 * Repair the shape of the draft after any edit. Run this after every change to
 * the route or the people; the screens never build a draft by hand.
 *
 * The route decides the pattern, not the other way round: more than one
 * destination makes it multi-city, coming back makes it a round trip.
 */
export function syncDraft(d: PlannerDraft, c: DraftContext): PlannerDraft {
  const points = d.points.map(p => ({ ...p }))

  // The point you come back to mirrors the one you left, until you say otherwise.
  const ret = points.find(p => p.ret)
  if (ret && d.retSame) { ret.place = points[0].place; ret.pt = points[0].pt }

  // ONE SEGMENT BETWEEN EACH PAIR OF POINTS. A new one copies the one before it,
  // because a trip that flew out usually flies back.
  const fallback = newSeg(defaultMode(d.scope, c, d.flightOrTrain), firstVehicle(c))
  const segs: DraftSeg[] = points.slice(1).map((_, i) => {
    const kept = d.segs[i] ?? d.segs[i - 1] ?? fallback
    return { ...kept, xfer: { ...kept.xfer } }
  })

  for (const s of segs) {
    // A mode switched off by an admin, or one that does not apply to this kind of
    // trip, is replaced rather than left to be refused at save.
    const md = c.modes.find(m => m.id === s.mode)
    // The last test is the step-1 answer: somebody who picked a flight and then
    // said "no flight or train" must not keep the flight. Replaced here rather
    // than refused at save, the same way a mode an admin switched off is.
    if (!md || !md.on || !md.scopes.includes(d.scope)
        || (d.flightOrTrain === false && HUB_MODES.includes(s.mode))) {
      s.mode = defaultMode(d.scope, c, d.flightOrTrain)
      s.vehicleId = s.mode === 'own' ? firstVehicle(c) : ''
    }
    if (s.mode === 'own' && !s.vehicleId) s.vehicleId = firstVehicle(c)
    // Nobody books a local trip for you.
    if (d.scope === 'local') s.bookedBy = 'self'
  }

  const destinations = points.filter((p, i) => i > 0 && !p.ret).length
  const pattern: TripPattern = destinations > 1 ? 'multi' : ret ? 'round' : 'oneway'

  const pax = Math.max(1, Math.min(MAX_PEOPLE, Math.floor(Number(d.pax) || 1)))
  const people = [...(d.people ?? [])]
  while (people.length < pax - 1) people.push({ id: '', name: '' })
  people.length = pax - 1

  const name = d.nameTouched
    ? d.name
    : autoName(d.purpose, points.filter((p, i) => i > 0 && !p.ret && p.place).map(p => c.placeName(p.place)))

  return { ...d, points, segs, pattern, pax, people, name }
}

/**
 * Change the kind of trip, on an edit. Screen 68c.
 *
 * The dates move with it, because the two kinds mean different things by a
 * date. A local trip carries its start date from point 0 and is not asked for
 * a date per place; a trip with nights in it has one per place, and none of
 * them can be guessed. The day you are back survives either way.
 */
export function setScope(d: PlannerDraft, scope: TripScope, c: DraftContext, lastWorkday: IsoDate): PlannerDraft {
  if (scope === d.scope) return d
  let points = d.points
  if (scope === 'local') {
    // Becoming a one-day trip: it starts today (or the last working day, if it
    // already happened), and the per-place dates stop meaning anything.
    const start = d.origin === 'POST_FACTO' ? lastWorkday : c.today
    // The per-place LEAVE dates go: a local trip is not asked for them. The
    // return arrival STAYS, because a local trip can run over more than one
    // day. What makes a trip local is where it goes, not whether it ends the
    // day it started — Dwarka to Green Park is local because both are in one
    // state. (The engine's own test for that is a distance: every place within
    // cfg.localMaxKm, 120 km by default. It agrees with "same state" for a city
    // like Delhi and disagrees across a large one.) So "the day I am back" is
    // as true of a local trip as of any other, and it was typed, not derived.
    points = points.map((p, i) => (i === 0 ? { ...p, leave: p.leave || start } : { ...p, leave: '' }))
  } else if (d.origin !== 'POST_FACTO' && points[0]?.leave === c.today) {
    // Leaving local behind, today was a default rather than a decision, so it
    // is cleared and asked for. A date the person actually chose is kept.
    points = points.map((p, i) => (i === 0 ? { ...p, leave: '' } : p))
  }
  // The reason belonged to the old kind: "no GPS" and "no prior approval" are
  // different questions with different answers.
  return syncDraft({ ...d, scope, points, pfReason: '', pfNote: '' }, c)
}

/** One way, or back again. A stop is added with addStop, not here. */
export function setPattern(d: PlannerDraft, pattern: 'oneway' | 'round', c: DraftContext): PlannerDraft {
  const has = d.points.some(p => p.ret)
  if (pattern === 'oneway') {
    if (!has) return d
    return syncDraft({ ...d, points: d.points.filter(p => !p.ret) }, c)
  }
  if (has) return d
  const first = d.points[0]
  return syncDraft({ ...d, retSame: true, points: [...d.points, { place: first.place, pt: first.pt, leave: '', arrive: '', what: '', ret: true }] }, c)
}

/** A stop on the way, inserted after point `i`. */
/** Put a stop in the gap after point `i`. Works on either leg: before the
 *  destination (`i` = the point you leave) or after it, on the way home. The
 *  new point is marked as a stop so the destination stays the destination. */
export function addStop(d: PlannerDraft, i: number, c: DraftContext): PlannerDraft {
  const points = [...d.points]
  const segs = [...d.segs]
  points.splice(i + 1, 0, { ...blankPoint(), stop: true as const })
  // The new place needs a way to reach it: copy how you were already travelling.
  if (segs[i]) segs.splice(i + 1, 0, { ...segs[i], xfer: { ...segs[i].xfer } })
  return syncDraft({ ...d, points, segs, open: `p${i + 1}` }, c)
}

export function removePoint(d: PlannerDraft, i: number, c: DraftContext): PlannerDraft {
  const points = [...d.points]
  const segs = [...d.segs]
  points.splice(i, 1)
  segs.splice(i, 1)
  return syncDraft({ ...d, points, segs, open: null }, c)
}

/** Move a destination earlier or later. The start and the return stay put. */
export function movePoint(d: PlannerDraft, i: number, dir: -1 | 1, c: DraftContext): PlannerDraft {
  const j = i + dir
  // i < 1 guards the start itself. The prototype leaves this to the screen —
  // it only draws the Earlier/Later buttons on a destination — but a function
  // that silently reorders the start when called wrongly is a trap.
  if (i < 1 || j < 1 || j >= d.points.length) return d
  if (d.points[i]?.ret || d.points[j]?.ret) return d
  const points = [...d.points]
  ;[points[i], points[j]] = [points[j], points[i]]
  // Only the places move. How you travel belongs to the position in the route,
  // not to the place: flying out and driving back stays that way.
  return syncDraft({ ...d, points, open: `p${j}` }, c)
}

/** What a route line is called, and where it sits among the destinations. */
export function pointLabel(d: PlannerDraft, i: number): { label: string; isStop: boolean; no: number; destinations: number[]; last: number } {
  const p = d.points[i] ?? ({} as DraftPoint)
  const destinations = d.points.map((q, k) => (k > 0 && !q.ret ? k : -1)).filter(k => k > 0)
  // THE DESTINATION IS THE ONE PLACE NOT MARKED AS A STOP. A point carries
  // `stop` from the moment it is added as one, so a stop can sit on either
  // side of the destination — which is the whole reason the flag exists.
  //
  // Nothing is marked on a trip saved before the flag, and then the old rule
  // stands: the last place that is not the return point is where you were
  // going. So old trips read exactly as they always did.
  const named = destinations.filter(k => !d.points[k]?.stop)
  const dest = named.length ? named[named.length - 1] : destinations[destinations.length - 1]
  const isStop = i > 0 && !p.ret && i !== dest
  // Stops are numbered in the order they are passed, which is the order they
  // sit in, whether that is before the destination or after it.
  const no = destinations.filter(k => k !== dest).indexOf(i) + 1
  const label = i === 0 ? 'Start' : p.ret ? 'Back to' : isStop ? `Stop ${no}` : 'Destination'
  return { label, isStop, no, destinations, last: dest }
}

// ── errors ──────────────────────────────────────────────────────────────────

/** Which step owns a refusal, so the planner can send the person to it.
 *  The keys are the server's (TripIssue.k), not the screen's. */
export function stepOfIssue(k: string | undefined): PlanStep {
  const key = k ?? ''
  if (/^(scope|purpose|name|pax)$/.test(key)) return 1
  // Where you go and when: the points and their dates, and the shape of the
  // route. `pr` is the pattern — one way, round trip or multi-city.
  if (/^(p|d)\d+$|^pr$/.test(key)) return 2
  // How you travel: one segment per gap between two points. `m` is the mode,
  // `s` its sub-questions (the vehicle, the ride to the airport).
  if (/^(m|s)\d+$/.test(key)) return 3
  // Nothing routes to step 4 from the server: whether three hotels were named
  // warns, it does not block, so it has no issue key. See trip-stay.ts.
  //
  // Everything else — and any refusal with no key at all — belongs to the last
  // step, where the summary lists it, since it has no field to sit under.
  return LAST_STEP
}

/** The message to show under one field. Nothing is shown before the person has
 *  tried to move on: a form that turns red while you are still filling it in is
 *  telling you off for not having finished. */
export function errorFor(issues: TripIssue[], k: string, tried: boolean | undefined): string {
  if (!tried) return ''
  return issues.find(i => i.block && i.k === k)?.t ?? ''
}

export function blockingOn(issues: TripIssue[], step: PlanStep): TripIssue[] {
  return issues.filter(i => i.block && stepOfIssue(i.k) === step)
}

/** Give every journey the same mode. A round trip is two journeys and a
 *  multi-city one is four or six; choosing "flight" once and then again, and
 *  again, is the kind of repetition a form should do for you.
 *
 *  A VEHICLE IS CARRIED ONLY WHERE IT MAKES SENSE. 'own' needs one, and the
 *  same car drives every leg. Any other mode has no vehicle, so the field is
 *  cleared rather than left pointing at a car nobody is driving.
 *
 *  WHO BOOKS IT IS NOT TOUCHED. That is a separate decision per journey — a
 *  flight out booked by the desk and a train back booked by the traveller is a
 *  real trip — and silently rewriting it would undo an answer nobody revisited.
 */
export function applyModeToAll(d: PlannerDraft, mode: string, vehicleId: string): PlannerDraft {
  return {
    ...d,
    segs: d.segs.map(sg => ({
      ...sg,
      mode,
      vehicleId: mode === 'own' ? (vehicleId || sg.vehicleId || '') : '',
    })),
  }
}

/** How many journeys do NOT already travel this way. 0 means the button that
 *  offers to apply it has nothing to do and should not be shown. */
export function journeysUnlike(d: PlannerDraft, mode: string): number {
  return d.segs.filter(sg => sg.mode !== mode).length
}

/** The position of a route line, so "the next one that needs work" has an order:
 *  a point is 2i, the travel after it is 2i+1. */
function linePos(k: string | undefined): number {
  const m = /^([pdms])(\d+)$/.exec(k ?? '')
  return m ? 2 * Number(m[2]) + (/[ms]/.test(m[1]) ? 1 : 0) : -1
}

/** Which route line to open: the first one with something missing, after `after`.
 *  Date issues ('d2') and travel issues ('m1') map onto the line that can fix them. */
export function firstOpenLine(issues: TripIssue[], after?: string | null): string | null {
  const from = after ? linePos(after) : -1
  const candidates = issues
    .filter(i => i.block && /^(p\d+|m\d+|d[1-9]\d*)$/.test(i.k ?? ''))
    .map(i => ({ key: (i.k![0] === 'm' ? 's' : 'p') + i.k!.slice(1), at: linePos(i.k) }))
    .filter(x => x.at > from)
    .sort((a, b) => a.at - b.at)
  return candidates.length ? candidates[0].key : null
}

// ── what gets sent ──────────────────────────────────────────────────────────

/** The payload for te.tripPreview and te.tripSave. */
export function toTripDraft(d: PlannerDraft): TripDraft {
  const people = (d.people ?? [])
    .map(p => ({ id: (p.id || '').trim().toUpperCase(), name: (p.name || '').trim() }))
    .filter(p => p.id || p.name)
  return {
    ...(d.editId ? { id: d.editId } : {}),
    name: (d.name || '').trim(),
    scope: d.scope,
    pattern: d.pattern,
    origin: d.origin,
    // One column holds both. te_trips.purpose is free text and every screen
    // that shows a purpose then shows the real reason.
    purpose: foldOther(d.purpose, d.purposeNote),
    project: d.project || '',
    // `arrive` is sent only where it was asked for — the return point. The
    // engine computes t.end as the latest of every point's (leave || arrive),
    // so this date becomes the trip's end without the engine changing at all.
    points: d.points.map((p, i) => ({
      place: p.place, pt: p.pt, what: p.what, leave: p.leave,
      // EVERY TIME ON EVERY POINT, not just the two the planner used to ask
      // for. The arrival was derived from the previous departure, which is
      // wrong for anything that travels overnight, and the Travel Desk had no
      // way to be told when somebody actually wants to be somewhere.
      //
      // Each is omitted when blank, so the server's nullif() sees nothing
      // rather than an empty string pretending to be a time, and a trip that
      // answers none of them sends what it always sent.
      ...(p.leaveAt ? { leaveAt: p.leaveAt } : {}),
      ...(i > 0 && p.arriveAt ? { arriveAt: p.arriveAt } : {}),
      ...(i > 0 && p.arrive ? { arrive: p.arrive } : {}),
      ...(p.prefNote ? { prefNote: p.prefNote.trim() } : {}),
      ...(p.prefUrl ? { prefUrl: p.prefUrl.trim() } : {}),
      ...(p.ret ? { ret: true } : {}),
      // Which places are only passed through. Omitted when false so a trip
      // saved before migration 170 keeps sending exactly what it always did.
      ...(p.stop ? { stop: true } : {}),
    })),
    segs: d.segs.map(s => ({
      mode: s.mode, bookedBy: s.bookedBy, vehicleId: s.vehicleId || null, xfer: { ...s.xfer },
      // Omitted when blank, so a plan that says nothing to the desk sends
      // exactly the keys it always sent.
      ...(s.prefTime ? { prefTime: s.prefTime } : {}),
      ...(s.prefUrl ? { prefUrl: s.prefUrl.trim() } : {}),
      ...(s.prefNote ? { prefNote: s.prefNote.trim() } : {}),
    })),
    pax: Number(d.pax) || 1,
    people,
    // A local trip used to be defined as one day out of the office with nowhere
    // to sleep, so it was forced to book its own (non-existent) stay. It can ask
    // for one now, and if it does the desk can book it like any other.
    stayBy: d.scope === 'local' && !d.stayWanted ? 'self' : d.stayBy,
    ...(d.stayWanted === undefined ? {} : { stayWanted: d.stayWanted }),
    ...(d.foodWanted === undefined ? {} : { foodWanted: d.foodWanted }),
    stayOptions: d.stayWanted ? usableStayOptions(d.stayOptions) : [],
    advance: d.scope === 'local' ? 0 : Number(d.advance) || 0,
    pfReason: d.pfReason || '',
    pfNote: d.pfNote || '',
    ...(d.answer ? { answer: d.answer } : {}),
  }
}

