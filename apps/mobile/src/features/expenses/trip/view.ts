// src/features/expenses/trip/view.ts — what TeTripDetail derives from one detail
// read, as one pure function (components/te/trip/TeTripDetail.tsx, the block of
// consts after `if (!detail)`). Every card reads from this, so the rules stay
// in one place and in the website's words.
import type { TeLeg, TeTripDetail, Uuid } from '@web/te/types'
import type { MapPlace } from '@web/te/trip-map'
import { tripChip } from '@web/te/trips-list'
import { canBillTrip, coTravellerNote, isCoTraveller, myClaims, withText } from '@web/te/co-traveller'
import { foodBalance, foodBudget, foodSpent, stayDecisionText } from '@web/te/trip-stay'

export function tripView(detail: TeTripDetail, me: Uuid, today: string) {
  const t = detail.trip
  const st = t.display
  // Asking only makes sense on your own trip, and only while there is still a trip to book for.
  const canAskStay = !!detail.can?.own && !['CANCELLED', 'REJECTED', 'CLAIMED', 'CLOSED'].includes(t.status)
  const legs = [...detail.legs].sort((a, b) => a.n - b.n)
  const chip = tripChip(t)
  const pname = (id: string) => detail.places[id]?.s ?? ''
  const places = new Map<string, MapPlace>(
    Object.entries(detail.places).map(([id, p]) => [id, { id, s: p.s, lat: p.lat, lng: p.lng }]),
  )
  const started = legs.some(l => l.startedAt || l.manual)
  // `can.act` means "may approve"; this is the employee's own screen, so the guard is `can.own`.
  const mine = !!detail.can.own
  const note = coTravellerNote(t, me, detail.employee.name)
  const riding = isCoTraveller(t, me)
  const withWho = withText(t, me)
  const canBill = canBillTrip(t, me)
  const decided = stayDecisionText(t.stay)
  // detail.expenses is every line on the trip, everyone's: narrowed to mine.
  const myLines = canBill ? detail.expenses.filter(x => x.emp === me && x.status === 'UNCLAIMED') : []
  const food = canBill && t.foodWanted ? foodBalance(foodBudget(t), foodSpent(detail.expenses, t.id, me)) : null
  // MY claims on this trip, not everybody's.
  const claims = myClaims(detail.claims, me)
  const openLegs = legs.filter(l => l.status !== 'SUBMITTED' && l.status !== 'SKIPPED' && l.status !== 'CANCELLED')
  const nextLeg: TeLeg | null = legs.find(l => l.status === 'ACTIVE' || l.status === 'PAUSED' || l.status === 'ENDED')
    ?? legs.find(l => l.status === 'PLANNED')
    ?? null
  const isDraftPostFacto = st === 'DRAFT' && t.origin === 'POST_FACTO'
  return {
    detail, t, st, me, today, canAskStay, legs, chip, pname, places, started, mine, note, riding, withWho,
    canBill, decided, myLines, food, claims, openLegs, nextLeg, isDraftPostFacto,
  }
}

export type TripView = ReturnType<typeof tripView>
