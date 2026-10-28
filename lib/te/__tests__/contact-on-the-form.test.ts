// How the travel desk reaches the traveller: asked on the form, prefilled from
// their ESS record, and never written back to it.
//
// The whole feature is one distinction held in three places, so each of them is
// tested here: a PREFILL is not a copy. The fields open with what ESS has; the
// traveller may replace any of them; what they leave belongs to the trip, which
// is what the desk is given and where the ticket is sent. The ESS record is
// untouched either way.
//
// The risk, as with every autofill, runs the other direction — it must never
// overwrite an answer somebody deliberately gave. So the pairs below are
// deliberate: it prefills when there is nothing, and it leaves well alone once
// there is something.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromTrip, newPlannerDraft, stepOfIssue, toTripDraft, type DraftContext, type PlannerDraft } from '../trip-draft.ts'
import { addressFor } from '../booking-mail.ts'

const MODES = [
  { id: 'flight', name: 'Flight', basis: 'ticket' as const, scopes: ['domestic'] as const, gps: 'checkin' as const, stops: false, ceil: 0, on: true },
  { id: 'cab', name: 'Cab', basis: 'bill' as const, scopes: ['local', 'domestic'] as const, gps: 'track' as const, stops: true, ceil: 0, on: true },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any

const ESS = { mobile: '9876543210', altMobile: '9811122233', email: 'vikram@sharma.example' }

// Not a default parameter: noRecord() must MEAN "nothing on record", and a
// default would quietly hand back the ESS one — which is how the first version
// of the two tests below passed while proving nothing.
const ctxWith = (contact: DraftContext['contact']): DraftContext => ({
  today: '2026-10-19', officePlace: 'off', vehicles: [], modes: MODES, placeName: (id: string) => id, contact,
})
const ctx = () => ctxWith(ESS)
const noRecord = () => ctxWith(undefined)

const fresh = (c = ctx()) => newPlannerDraft({ scope: 'domestic', origin: 'PRE_APPROVED', lastWorkday: '2026-10-16' }, c)

/** A saved trip, as te_trip_json hands one back. The three contact keys are
 *  '' on anything saved before migration 179 asked for them. */
const saved = (patch: Record<string, unknown> = {}) => ({
  id: 'trip-7', name: 'Mumbai client review', scope: 'domestic' as const, origin: 'PRE_APPROVED' as const,
  purpose: 'Client meeting', project: '', pax: 1, people: [], stayBy: 'self' as const, advance: 0,
  points: [
    { place: 'off', pt: 'corp', what: '', leave: '2026-12-01' as const },
    { place: 'bom', pt: 'client', what: '', leave: '2026-12-03' as const },
    { place: 'off', pt: 'corp', what: '', leave: '' as const, arrive: '2026-12-03' as const, ret: true as const },
  ],
  segs: [{ mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: {} }, { mode: 'flight', bookedBy: 'desk', vehicleId: null, xfer: {} }],
  contactMobile: '', contactAltMobile: '', contactEmail: '',
  pfReason: '', pfNote: '', status: 'APPROVED',
  ...patch,
})

// ── a new form opens prefilled ──────────────────────────────────────────────

test('a new plan opens with what ESS has on record', () => {
  const d = fresh()
  assert.equal(d.contactMobile, ESS.mobile)
  assert.equal(d.contactAltMobile, ESS.altMobile)
  assert.equal(d.contactEmail, ESS.email)
})

test('nothing on record leaves the fields blank, not undefined', () => {
  // Blank is what the gate below asks about. `undefined` would reach an input
  // as an uncontrolled value and React would warn rather than ask.
  const d = fresh(noRecord())
  assert.equal(d.contactMobile, '')
  assert.equal(d.contactAltMobile, '')
  assert.equal(d.contactEmail, '')
})

test('what the traveller types is what the trip is sent', () => {
  const d: PlannerDraft = { ...fresh(), contactMobile: '+971 50 123 4567', contactEmail: 'v@gmail.example' }
  const out = toTripDraft(d)
  assert.equal(out.contactMobile, '+971 50 123 4567', 'the local SIM, not the ESS number')
  assert.equal(out.contactEmail, 'v@gmail.example')
  // The alternate was never touched, so the prefill stands — which is the
  // point of a prefill, and not the same as having been ignored.
  assert.equal(out.contactAltMobile, ESS.altMobile)
})

test('surrounding spaces are not part of a phone number', () => {
  const out = toTripDraft({ ...fresh(), contactMobile: '  9876543210  ', contactEmail: ' v@x.example ' })
  assert.equal(out.contactMobile, '9876543210')
  assert.equal(out.contactEmail, 'v@x.example')
})

// ── reopening a saved trip ──────────────────────────────────────────────────

test('a trip that carries contact details keeps them', () => {
  const d = fromTrip(saved({ contactMobile: '9999988888', contactAltMobile: '9777766666', contactEmail: 'trip@x.example' }), ctx())
  assert.equal(d.contactMobile, '9999988888', 'the trip, not ESS')
  assert.equal(d.contactAltMobile, '9777766666')
  assert.equal(d.contactEmail, 'trip@x.example')
})

test('a trip saved before the form asked is prefilled from ESS again', () => {
  // Showing three empty fields would make somebody retype what their own
  // record already holds.
  const d = fromTrip(saved(), ctx())
  assert.equal(d.contactMobile, ESS.mobile)
  assert.equal(d.contactAltMobile, ESS.altMobile)
  assert.equal(d.contactEmail, ESS.email)
})

test('the fallback is field by field, not all or nothing', () => {
  // A trip may well carry a mobile and no alternate — the alternate should
  // still be offered rather than left blank because its neighbour was filled.
  const d = fromTrip(saved({ contactMobile: '9999988888' }), ctx())
  assert.equal(d.contactMobile, '9999988888', 'kept')
  assert.equal(d.contactAltMobile, ESS.altMobile, 'prefilled')
  assert.equal(d.contactEmail, ESS.email, 'prefilled')
})

test('a saved trip survives a reopen with nothing on record to fall back to', () => {
  const d = fromTrip(saved({ contactMobile: '9999988888' }), noRecord())
  assert.equal(d.contactMobile, '9999988888')
  assert.equal(d.contactAltMobile, '', 'asked for, not invented')
})

// ── where a refusal lands on the form ───────────────────────────────────────

test('all three contact refusals point at step 1', () => {
  // They are about the person, not the route or the money, and they sit under
  // the trip's own details. A key that routed anywhere else would send
  // somebody to a step with no such field on it.
  for (const k of ['contactMobile', 'contactAltMobile', 'contactEmail']) {
    assert.equal(stepOfIssue(k), 1, k)
  }
})

// ── where a ticket is sent ──────────────────────────────────────────────────

test('the address on the trip beats both addresses on the record', () => {
  // Somebody who asked for their itinerary on a personal inbox while they are
  // away has already answered this. Sending to the work address would ignore
  // both the answer and the question.
  const a = addressFor({ trip_email: 'away@gmail.example', office_email: 'vikram@sharma.example', personal_email: 'v@gmail.example' })
  assert.deepEqual(a, { to: 'away@gmail.example', kind: 'form' })
})

test('with nothing on the trip, the work address is still next', () => {
  const a = addressFor({ trip_email: '', office_email: 'vikram@sharma.example', personal_email: 'v@gmail.example' })
  assert.deepEqual(a, { to: 'vikram@sharma.example', kind: 'work' })
})

test('whitespace on the trip is not an address', () => {
  const a = addressFor({ trip_email: '   ', office_email: 'vikram@sharma.example' })
  assert.deepEqual(a, { to: 'vikram@sharma.example', kind: 'work' })
})

test('nowhere to send is still null, and the caller must refuse on it', () => {
  assert.equal(addressFor({ trip_email: '', office_email: '', personal_email: '' }), null)
})
