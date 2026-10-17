// lib/te/commute.ts — the door-to-door shape of one journey.
//
// WHAT A JOURNEY ACTUALLY IS. "Delhi to Mumbai by flight" is three journeys,
// not one:
//
//     home ──cab──▶ Delhi airport ──flight──▶ Mumbai airport ──cab──▶ hotel
//
// The engine has always built it that way: buildLegs emits a `first` leg, the
// `main` leg between the two hubs, and a `last` leg, and every one of them is
// estimated, tracked and claimed separately. What the planner never did was
// ASK. xfer.first and xfer.last defaulted to 'cab' in newSeg and no screen
// ever showed them, so a person who took the metro to the airport, or whose
// colleague dropped them, had a cab planned for them and an estimate built on
// it. This file is the vocabulary for asking.
//
// WHICH JOURNEYS HAVE TRANSFERS. Only the ones that leave from somewhere other
// than where you are: a flight leaves from an airport, a train from a station.
// A cab, an auto, your own car or the metro is door to door, and asking "how
// will you get to the cab" is the kind of question that makes people stop
// filling in forms. HUB_MODES is therefore the engine's HUB_OF, not a guess.
import type { TeMode, TripScope } from './types.ts'

/** Modes that start somewhere other than where the traveller is standing.
 *  Mirrors HUB_OF in the engine; the word is what the hub is called. */
export const HUB_WORD: Record<string, 'airport' | 'station'> = {
  flight: 'airport',
  train: 'station',
}

/** The transfer value meaning "no journey here, nothing to claim". Matches
 *  NO_XFER in the engine, which omits the leg entirely rather than planning a
 *  cab nobody is taking. */
export const NO_XFER = 'none'

export type XferSide = 'first' | 'last'

/** Does this journey have transfers at all, and what is the hub called? */
export function hubKind(mode: string, scope: TripScope): 'airport' | 'station' | null {
  // A local trip has no hubs: it is one city, and a flight is not offered.
  if (scope === 'local') return null
  return HUB_WORD[mode] ?? null
}

/**
 * The modes a transfer can use.
 *
 * A transfer is travel inside one city, so the list is the modes the company
 * allows locally — which is why it reads scope_local rather than carrying its
 * own list. A hub mode is excluded even if some administrator switched flight
 * on for local travel: you cannot fly to the airport, and the one thing worse
 * than a missing option is an absurd one.
 */
export function xferModes(modes: TeMode[]): TeMode[] {
  return modes.filter(m => m.on && m.scopes.includes('local') && !HUB_WORD[m.id])
}

/** What a transfer is worth showing as, including the "none" case. */
export function xferLabel(mode: string | undefined, modes: TeMode[]): string {
  if (!mode || mode === NO_XFER) return 'No journey to claim'
  return modes.find(m => m.id === mode)?.name ?? mode
}

/** One step of the door-to-door chain, for the summary a person reads back. */
export interface ChainStep {
  kind: XferSide | 'main'
  mode: string
  /** '' when the place is not chosen yet. */
  from: string
  to: string
  /** true when this step is not travelled and not claimed. */
  skipped: boolean
}

/**
 * The full chain for one journey, in order, as the screen should show it.
 *
 * MIRRORS buildLegs AND IS NOT THE AUTHORITY. The engine decides what is
 * actually estimated and claimed; this exists so the person can see the shape
 * before the preview comes back, and so the step can say "three journeys" when
 * that is what they are planning. Its rules are buildLegs' rules:
 *   · no transfer when the journey already starts or ends at the hub
 *   · no transfer when the side is set to none
 *   · no hubs at all when the mode is door to door
 */
export function commuteChain(input: {
  mode: string
  scope: TripScope
  from: string
  to: string
  hubA?: string
  hubB?: string
  first?: string
  last?: string
}): ChainStep[] {
  const kind = hubKind(input.mode, input.scope)
  const { from, to } = input
  if (!kind) return [{ kind: 'main', mode: input.mode, from, to, skipped: false }]

  // A hub equal to the place it serves is not a transfer — somebody whose trip
  // starts at the airport is already there.
  const hubA = input.hubA && input.hubA !== from ? input.hubA : ''
  const hubB = input.hubB && input.hubB !== to ? input.hubB : ''
  // The same hub at both ends is not a journey. buildLegs drops both; so does
  // this, rather than drawing an arrow from a place to itself.
  const same = !!hubA && hubA === input.hubB
  const a = same ? '' : hubA
  const b = same ? '' : hubB

  const out: ChainStep[] = []
  if (a) out.push({ kind: 'first', mode: input.first || 'cab', from, to: a, skipped: input.first === NO_XFER })
  out.push({ kind: 'main', mode: input.mode, from: a || from, to: b || to, skipped: false })
  if (b) out.push({ kind: 'last', mode: input.last || 'cab', from: b, to, skipped: input.last === NO_XFER })
  return out
}

/** How many of those are actually travelled — what the person is told they are
 *  planning, and what the estimate will cover. */
export function chainCount(chain: ChainStep[]): number {
  return chain.filter(s => !s.skipped).length
}

/** What is still unanswered on one journey, in the order a person fills it in.
 *  '' when the journey is complete. */
export function commuteGap(input: {
  mode: string
  scope: TripScope
  from: string
  to: string
  hubA?: string
  hubB?: string
  first?: string
  last?: string
  vehicleId?: string
  needsVehicle?: boolean
}): string {
  if (!input.mode) return 'Choose how you travel.'
  if (input.needsVehicle && !input.vehicleId) return 'Choose which vehicle.'
  const kind = hubKind(input.mode, input.scope)
  if (!kind) return ''
  const word = kind === 'airport' ? 'airport' : 'station'
  if (!input.hubA) return `Choose the ${word} you leave from.`
  if (!input.hubB) return `Choose the ${word} you arrive at.`
  // The transfers default to a cab rather than to nothing, so they are never
  // "missing" — but a person who has not looked at them has had a cab chosen
  // for them, and the screen says so instead of calling the journey finished.
  return ''
}

/** True when the two hubs are the same place, which cannot be a journey.
 *  Worth saying out loud: it usually means the wrong city was picked. */
export function sameHub(hubA?: string, hubB?: string): boolean {
  return !!hubA && !!hubB && hubA === hubB
}
