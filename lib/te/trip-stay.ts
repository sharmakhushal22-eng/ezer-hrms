// lib/te/trip-stay.ts — asking for a stay, and the food budget.
//
// Two questions the planner now asks, and the rules behind them. Pure, so the
// wording and the arithmetic are tested rather than eyeballed on a form.
//
// THE TWO ARE NOT SYMMETRIC, and that is deliberate.
//
// A STAY can be planned. You know before you leave roughly where you will
// sleep, so you name three hotels you would accept, with a link each, and the
// desk books one of them. Three because a single suggestion is a demand, and
// the desk needs room to find a rate.
//
// FOOD cannot. Nobody knows where they will eat on the road, and a budget
// typed in advance would be fiction. So the planner only asks whether food is
// needed at all, and if it is, SHOWS the budget the company already set —
// te_grade_limits.meals_per_day, per grade and city tier, which an admin edits
// under Policy as "Food a day". Then the bills arrive during the trip and come
// off that budget. What the employee needs to see is the balance, not a form.
import type { IsoDate, TeExpense, Uuid } from './types.ts'

/** One hotel the employee would accept, as typed in the planner. */
export interface StayOption {
  /** The hotel's name. */
  name: string
  /** Where it is — an area, a landmark, "near the client office". */
  location: string
  /** The page it was found on. Stored as given and never fetched. */
  url: string
  /** What they expect it to cost, per night. Optional: the desk often knows
   *  better, and the trip's estimate does not use this (see tripHotelBudget). */
  price?: number | ''
}

/** A row as the trip stores it: the price is a real number or absent. */
export interface SavedStayOption { name: string; location: string; url: string; price?: number }

export const STAY_OPTIONS_WANTED = 3

/** An empty row, for seeding the planner's three slots. */
export const emptyStayOption = (): StayOption => ({ name: '', location: '', url: '', price: '' })

/**
 * A row counts as filled once it has a name. Location and link are strongly
 * wanted but a hotel with only a name is still a real suggestion the desk can
 * search for; refusing it would lose information the employee has.
 */
export function stayOptionFilled(o: StayOption): boolean {
  return !!o.name.trim()
}

/**
 * The rows worth sending: filled ones, trimmed.
 *
 * The result is narrower than the form's own shape. In the planner `price` is
 * a string-or-number because it comes from an `<input>`; what leaves here is a
 * real number or nothing at all, which is what the trip stores.
 */
export function usableStayOptions(options: StayOption[]): SavedStayOption[] {
  return options.filter(stayOptionFilled).map(o => ({
    name: o.name.trim(),
    location: o.location.trim(),
    url: o.url.trim(),
    ...(Number(o.price) > 0 ? { price: Number(o.price) } : {}),
  }))
}

/**
 * What to tell the employee about how many they have named.
 *
 * Fewer than three WARNS, it does not block — the plan can still be sent. A
 * trip held up because somebody could only find two acceptable hotels would be
 * the rule getting in the way of the work.
 */
export function stayOptionsNote(options: StayOption[]): { text: string; warn: boolean } | null {
  const n = usableStayOptions(options).length
  if (n === 0) return { text: `Name at least ${STAY_OPTIONS_WANTED} hotels you would be happy with, so the desk can compare rates.`, warn: true }
  if (n < STAY_OPTIONS_WANTED) {
    return {
      text: `${n} of ${STAY_OPTIONS_WANTED} named. You can send it like this, and your approver will see that fewer than ${STAY_OPTIONS_WANTED} were given.`,
      warn: true,
    }
  }
  return { text: `${n} hotels named. The desk picks one and books it.`, warn: false }
}

/** The site a link points at, for the row's subtitle. Best effort only. */
export function platformOf(url: string): string | null {
  const v = url.trim()
  if (!v) return null
  try {
    return new URL(v).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** A link that is not a link at all, so the row can say so before it is sent. */
export function badUrl(url: string): boolean {
  return !!url.trim() && !platformOf(url)
}

// ── food ────────────────────────────────────────────────────────────────────

/**
 * The money set aside for food on this trip.
 *
 * NOT A NEW NUMBER. It is the trip's own meals estimate, which the engine
 * already builds by summing the per-day food limit for each day of the trip
 * (and the local cap for a local trip). That limit is the one an admin sets
 * per grade and city tier. Inventing a second budget here would give the
 * employee one figure and the approver another.
 */
export function foodBudget(trip: { estimate?: { meals?: number } | null }): number {
  return Number(trip.estimate?.meals) || 0
}

/** The food and drink already billed to this trip by this person. */
export function foodSpent(
  expenses: Pick<TeExpense, 'tripId' | 'cat' | 'emp' | 'status' | 'claimed'>[],
  tripId: Uuid,
  me: Uuid,
): number {
  return expenses
    .filter(x => x.tripId === tripId && x.emp === me && x.cat === 'meals' && x.status !== 'DISCARDED')
    .reduce((a, x) => a + (Number(x.claimed) || 0), 0)
}

export interface FoodBalance {
  budget: number
  spent: number
  /** Never negative: what is still available. */
  left: number
  /** How far over, when the bills passed the budget. 0 when they have not. */
  over: number
  /** 0–100, for a bar. Capped at 100 so the bar cannot run off the card. */
  pct: number
  tone: 'ok' | 'close' | 'over'
}

/**
 * Where the food budget stands.
 *
 * "close" from four fifths, because the useful moment to tell somebody is
 * while they can still choose a cheaper dinner, not after.
 */
export function foodBalance(budget: number, spent: number): FoodBalance {
  const b = Math.max(0, budget)
  const s = Math.max(0, spent)
  const over = Math.max(0, s - b)
  return {
    budget: b,
    spent: s,
    left: Math.max(0, b - s),
    over,
    pct: b > 0 ? Math.min(100, Math.round((s / b) * 100)) : (s > 0 ? 100 : 0),
    tone: over > 0 ? 'over' : b > 0 && s / b >= 0.8 ? 'close' : 'ok',
  }
}

/**
 * The sentence under the bar. It says what is left, because that is the
 * number somebody standing in a restaurant actually wants.
 */
export function foodBalanceText(f: FoodBalance, rs: (n: number) => string): string {
  if (f.budget === 0) return f.spent > 0 ? `${rs(f.spent)} on food so far. No food budget is set for this trip.` : 'No food budget is set for this trip.'
  if (f.over > 0) return `${rs(f.spent)} of ${rs(f.budget)}. That is ${rs(f.over)} over — your approver will see it and may ask why.`
  if (f.spent === 0) return `${rs(f.budget)} for food on this trip. Add each bill as you go and this comes down.`
  return `${rs(f.spent)} of ${rs(f.budget)} used. ${rs(f.left)} left.`
}

// THE STAY IS ASKED ON EVERY KIND OF TRIP, local included, so there is no
// "can this scope have a stay" predicate here. A local trip used to be defined
// as one day out of the office with nowhere to sleep, and three separate
// places enforced it: the draft forced "I book it myself", the estimate gave
// local no hotel line, and check C11 refused a hotel bill outright. A late
// finish near the client is a real thing, so all three were relaxed together.

/** Nights away, for the hint under the stay question. Never negative. */
export function nightsBetween(start: IsoDate | null, end: IsoDate | null): number {
  if (!start || !end) return 0
  const n = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 864e5)
  return n > 0 ? n : 0
}
