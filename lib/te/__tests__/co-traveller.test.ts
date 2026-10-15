// lib/te/__tests__/co-traveller.test.ts — who is on a trip, and what they are told.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canBillTrip, coTravellerNote, isCoTraveller, isShared, myClaims, onTrip, otherNames, tripRole, withText,
} from '../co-traveller.ts'
import type { TeTripPerson, Uuid } from '../types.ts'

const ME = 'me' as Uuid
const BOSS = 'boss' as Uuid
const ASHA = 'asha' as Uuid

const person = (name: string, emp: Uuid | null): TeTripPerson => ({ id: name.toUpperCase(), name, emp, found: !!emp })

/** Mine, with Asha taken along. */
const own = { emp: ME, co: [ASHA], people: [person('Asha Rao', ASHA)] }
/** The boss's, with me taken along. */
const taken = { emp: BOSS, co: [ME], people: [person('Me Myself', ME)] }
/** Neither mine nor one I am on. */
const theirs = { emp: BOSS, co: [ASHA], people: [person('Asha Rao', ASHA)] }

test('tripRole: the planner, the passenger and the stranger', () => {
  assert.equal(tripRole(own, ME), 'owner')
  assert.equal(tripRole(taken, ME), 'co')
  assert.equal(tripRole(theirs, ME), 'none')
})

test('tripRole: a planner listed among the people is still the planner', () => {
  // Owning the trip has to win, or the screen would hide the owner's own
  // controls from them on a technicality.
  const both = { emp: ME, co: [ME, ASHA], people: [person('Me Myself', ME)] }
  assert.equal(tripRole(both, ME), 'owner')
  assert.equal(isCoTraveller(both, ME), false)
})

test('tripRole: a trip with nobody else on it', () => {
  const alone = { emp: ME, co: [] }
  assert.equal(tripRole(alone, ME), 'owner')
  assert.equal(tripRole(alone, BOSS), 'none')
  assert.equal(isShared(alone), false)
  assert.equal(isShared(own), true)
})

test('onTrip: owner and co-traveller, nobody else', () => {
  assert.equal(onTrip(own, ME), true)
  assert.equal(onTrip(taken, ME), true)
  assert.equal(onTrip(theirs, ME), false)
})

test('otherNames: everyone but me, including those not found in EZER', () => {
  const trip = {
    emp: ME,
    co: [ASHA],
    people: [person('Asha Rao', ASHA), person('A contractor', null), person('Me Myself', ME)],
  }
  // The contractor has no employee id and cannot open the trip, but they
  // travelled, so they are part of who went.
  assert.deepEqual(otherNames(trip, ME), ['Asha Rao', 'A contractor'])
})

test('otherNames: blank names are left out rather than shown as gaps', () => {
  const trip = { emp: ME, co: [], people: [person('   ', null), person('Asha Rao', ASHA)] }
  assert.deepEqual(otherNames(trip, ME), ['Asha Rao'])
})

test('withText: one name, two names, then a count', () => {
  assert.equal(withText({ emp: ME, co: [], people: [] }, ME), '')
  assert.equal(withText(own, ME), 'With Asha Rao')
  assert.equal(
    withText({ emp: ME, co: [], people: [person('Asha Rao', ASHA), person('Rohit Mehta', null)] }, ME),
    'With Asha Rao and Rohit Mehta',
  )
  assert.equal(
    withText({ emp: ME, co: [], people: [person('Asha Rao', ASHA), person('Rohit Mehta', null), person('Sana Iqbal', null), person('Dev Nair', null)] }, ME),
    'With Asha Rao and 3 others',
  )
})

test('coTravellerNote: only a passenger gets it, and it names the planner', () => {
  const note = coTravellerNote(taken, ME, 'Ravi Kumar')
  assert.ok(note && note.startsWith('Ravi Kumar planned this trip'))
  // It must say both halves: why they can see it, and what is not theirs.
  assert.match(note!, /theirs to change/)
  assert.match(note!, /your own bills/)
  assert.equal(coTravellerNote(own, ME, 'Ravi Kumar'), null)
  assert.equal(coTravellerNote(theirs, ME, 'Ravi Kumar'), null)
})

test('coTravellerNote: a missing planner name still reads as a sentence', () => {
  const note = coTravellerNote(taken, ME, '   ')
  assert.ok(note && note.startsWith('A colleague planned this trip'))
})

test('canBillTrip: yes on a live trip, no on one called off', () => {
  assert.equal(canBillTrip({ ...taken, status: 'APPROVED' }, ME), true)
  assert.equal(canBillTrip({ ...taken, status: 'PENDING_APPROVAL' }, ME), true)
  // A bill that turns up after the claim went is what a supplementary claim is for.
  assert.equal(canBillTrip({ ...taken, status: 'CLAIMED' }, ME), true)
  assert.equal(canBillTrip({ ...taken, status: 'CLOSED' }, ME), true)
  assert.equal(canBillTrip({ ...taken, status: 'CANCELLED' }, ME), false)
  assert.equal(canBillTrip({ ...taken, status: 'REJECTED' }, ME), false)
})

test('canBillTrip: the OWNER can bill their own trip while they are on it', () => {
  // The bug this replaced: the owner's only door to a trip's bills opened when
  // the trip was COMPLETED with every journey closed, so there was no way to
  // record a hotel or a dinner while actually travelling — and those two
  // categories need a trip, so they appeared nowhere at all.
  assert.equal(canBillTrip({ ...own, status: 'APPROVED' }, ME), true)
  assert.equal(canBillTrip({ ...own, status: 'ONGOING' }, ME), true)
  assert.equal(canBillTrip({ ...own, status: 'CANCELLED' }, ME), false)
})

test('canBillTrip: somebody with nothing to do with the trip cannot', () => {
  assert.equal(canBillTrip({ ...theirs, status: 'APPROVED' }, ME), false)
})

test('myClaims: a colleague’s claim on the same trip is not mine', () => {
  const claims = [
    { id: 'c1', emp: ME, status: 'SUBMITTED' },
    { id: 'c2', emp: BOSS, status: 'SETTLED' },
  ]
  assert.deepEqual(myClaims(claims, ME).map(c => c.id), ['c1'])
  assert.deepEqual(myClaims(claims, BOSS).map(c => c.id), ['c2'])
  assert.deepEqual(myClaims(claims, ASHA), [])
})
