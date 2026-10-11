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
import type { IsoDate, TeMode, TripDraft, TripIssue, TripOrigin, TripPattern, TripScope, Uuid } from './types.ts'

/** One place on the route. */
export interface DraftPoint {
  /** '' until a place is chosen. */
  place: string
  /** A place type from cfg.ptypes. */
  pt: string
  /** The day you leave this place. On point 0 it is the trip's start date. */
  leave: IsoDate | ''
  /** What you will do there, or why you stop. */
  what: string
  /** Only ever set on the one point you come back to. */
  ret?: true
}

/** How you travel between two consecutive points. */
export interface DraftSeg {
  mode: string
  vehicleId: string
  bookedBy: 'desk' | 'self'
  xfer: { first: string; last: string; hubA?: string; hubB?: string }
}

export interface DraftPerson { id: string; name: string; autoName?: boolean }

export interface PlannerDraft {
  step: 1 | 2 | 3
  origin: TripOrigin
  scope: TripScope
  /** Derived by syncDraft from the route; never set by hand. */
  pattern: TripPattern
  name: string
  /** Once you type a name, it stops being replaced by the generated one. */
  nameTouched: boolean
  purpose: string
  project: string
  pax: number
  people: DraftPerson[]
  points: DraftPoint[]
  /** Always points.length - 1 entries. syncDraft keeps it so. */
  segs: DraftSeg[]
  retSame: boolean
  stayBy: 'self' | 'desk'
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
export function defaultMode(scope: TripScope, c: DraftContext): string {
  return scope === 'local' ? (firstVehicle(c) ? 'own' : 'cab') : 'flight'
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
    name: '', nameTouched: false, purpose: '', project: '',
    pax: 1, people: [],
    points: [
      { place: c.officePlace, pt: 'corp', leave: start, what: '' },
      blankPoint(),
      { place: c.officePlace, pt: 'corp', leave: '', what: '', ret: true },
    ],
    segs: [newSeg(mode, veh), newSeg(mode, veh)],
    retSame: true, stayBy: 'self', advance: '', pfReason: '', pfNote: '',
  }, c)
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
  const fallback = newSeg(defaultMode(d.scope, c), firstVehicle(c))
  const segs: DraftSeg[] = points.slice(1).map((_, i) => {
    const kept = d.segs[i] ?? d.segs[i - 1] ?? fallback
    return { ...kept, xfer: { ...kept.xfer } }
  })

  for (const s of segs) {
    // A mode switched off by an admin, or one that does not apply to this kind of
    // trip, is replaced rather than left to be refused at save.
    const md = c.modes.find(m => m.id === s.mode)
    if (!md || !md.on || !md.scopes.includes(d.scope)) {
      s.mode = defaultMode(d.scope, c)
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

/** One way, or back again. A stop is added with addStop, not here. */
export function setPattern(d: PlannerDraft, pattern: 'oneway' | 'round', c: DraftContext): PlannerDraft {
  const has = d.points.some(p => p.ret)
  if (pattern === 'oneway') {
    if (!has) return d
    return syncDraft({ ...d, points: d.points.filter(p => !p.ret) }, c)
  }
  if (has) return d
  const first = d.points[0]
  return syncDraft({ ...d, retSame: true, points: [...d.points, { place: first.place, pt: first.pt, leave: '', what: '', ret: true }] }, c)
}

/** A stop on the way, inserted after point `i`. */
export function addStop(d: PlannerDraft, i: number, c: DraftContext): PlannerDraft {
  const points = [...d.points]
  const segs = [...d.segs]
  points.splice(i + 1, 0, blankPoint())
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
  const last = destinations[destinations.length - 1]
  const isStop = i > 0 && !p.ret && i !== last
  const no = destinations.indexOf(i) + 1
  const label = i === 0 ? 'Start' : p.ret ? 'Back to' : isStop ? `Stop ${no}` : 'Destination'
  return { label, isStop, no, destinations, last }
}

// ── errors ──────────────────────────────────────────────────────────────────

/** Which step owns a refusal, so the planner can send the person to it.
 *  The keys are the server's (TripIssue.k), not the screen's. */
export function stepOfIssue(k: string | undefined): 1 | 2 | 3 {
  if (/^(scope|purpose|name|pax)$/.test(k ?? '')) return 1
  if (/^(p|m|d)\d+$|^pr$/.test(k ?? '')) return 2
  // Everything else, a refusal with no key included, belongs to the last step —
  // where the summary lists it, since it has no field to sit under.
  return 3
}

/** The message to show under one field. Nothing is shown before the person has
 *  tried to move on: a form that turns red while you are still filling it in is
 *  telling you off for not having finished. */
export function errorFor(issues: TripIssue[], k: string, tried: boolean | undefined): string {
  if (!tried) return ''
  return issues.find(i => i.block && i.k === k)?.t ?? ''
}

export function blockingOn(issues: TripIssue[], step: 1 | 2 | 3): TripIssue[] {
  return issues.filter(i => i.block && stepOfIssue(i.k) === step)
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
    purpose: d.purpose,
    project: d.project || '',
    points: d.points.map(p => ({ place: p.place, pt: p.pt, what: p.what, leave: p.leave, ...(p.ret ? { ret: true } : {}) })),
    segs: d.segs.map(s => ({ mode: s.mode, bookedBy: s.bookedBy, vehicleId: s.vehicleId || null, xfer: { ...s.xfer } })),
    pax: Number(d.pax) || 1,
    people,
    // A local trip is one day out of the office: nobody books a hotel for it and
    // there is nothing to advance against.
    stayBy: d.scope === 'local' ? 'self' : d.stayBy,
    advance: d.scope === 'local' ? 0 : Number(d.advance) || 0,
    pfReason: d.pfReason || '',
    pfNote: d.pfNote || '',
    ...(d.answer ? { answer: d.answer } : {}),
  }
}

