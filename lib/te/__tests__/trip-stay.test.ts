// lib/te/__tests__/trip-stay.test.ts — the stay ask and the food budget.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  badUrl, emptyStayOption, foodBalance, foodBalanceText, foodBudget, foodSpent,
  nightsBetween, platformOf, rejectReady, stayDecisionText, stayOptionFilled, stayOptionsNote,
  stayWaiting, usableStayOptions, STAY_OPTIONS_WANTED,
} from '../trip-stay.ts'
import type { TeExpense, Uuid } from '../types.ts'

const ME = 'me' as Uuid
const OTHER = 'other' as Uuid
const TRIP = 't1' as Uuid

const opt = (name: string, location = '', url = '', price: number | '' = '') => ({ name, location, url, price })
const rs = (n: number) => `₹${n.toLocaleString('en-IN')}`

// ── the three hotels ────────────────────────────────────────────────────────

test('a row counts once it has a name, even with nothing else', () => {
  assert.equal(stayOptionFilled(opt('Taj')), true)
  assert.equal(stayOptionFilled(opt('   ')), false)
  assert.equal(stayOptionFilled(emptyStayOption()), false)
  // A name with no link is still a real suggestion the desk can search for.
  assert.equal(stayOptionFilled(opt('Lemon Tree', '', '')), true)
})

test('usableStayOptions trims, drops the empties and keeps a real price', () => {
  const rows = [opt(' Taj ', ' Andheri ', ' https://x.com/taj ', 4200), emptyStayOption(), opt('Ibis', 'Powai', '', 0)]
  assert.deepEqual(usableStayOptions(rows), [
    { name: 'Taj', location: 'Andheri', url: 'https://x.com/taj', price: 4200 },
    { name: 'Ibis', location: 'Powai', url: '' },
  ])
})

test('stayOptionsNote warns under three but never refuses', () => {
  const none = stayOptionsNote([emptyStayOption(), emptyStayOption(), emptyStayOption()])
  assert.equal(none?.warn, true)
  assert.match(none!.text, /at least 3/)

  const two = stayOptionsNote([opt('Taj'), opt('Ibis'), emptyStayOption()])
  assert.equal(two?.warn, true)
  assert.match(two!.text, /2 of 3/)
  // The point of the decision: it can still be sent.
  assert.match(two!.text, /can send it like this/)

  const three = stayOptionsNote([opt('Taj'), opt('Ibis'), opt('Lemon Tree')])
  assert.equal(three?.warn, false)
  assert.match(three!.text, /3 hotels named/)
})

test('STAY_OPTIONS_WANTED is the number the wording promises', () => {
  assert.equal(STAY_OPTIONS_WANTED, 3)
})

test('platformOf names the site, and badUrl catches what is not a link', () => {
  assert.equal(platformOf('https://www.makemytrip.com/hotels/x'), 'makemytrip.com')
  assert.equal(platformOf('   '), null)
  assert.equal(badUrl(''), false, 'an empty link is not a bad link, it is no link')
  assert.equal(badUrl('the one near the station'), true)
  assert.equal(badUrl('https://goibibo.com/x'), false)
})

// ── the food budget ─────────────────────────────────────────────────────────

test('foodBudget is the trip’s own meals estimate, not a second number', () => {
  assert.equal(foodBudget({ estimate: { meals: 2400 } }), 2400)
  assert.equal(foodBudget({ estimate: {} }), 0)
  assert.equal(foodBudget({ estimate: null }), 0)
  assert.equal(foodBudget({}), 0)
})

test('foodSpent counts my meal bills on this trip and nothing else', () => {
  const x = (over: Partial<TeExpense>): Pick<TeExpense, 'tripId' | 'cat' | 'emp' | 'status' | 'claimed'> => ({
    tripId: TRIP, cat: 'meals', emp: ME, status: 'UNCLAIMED', claimed: 100, ...over,
  } as never)
  const lines = [
    x({ claimed: 300 }),
    x({ claimed: 450 }),
    x({ cat: 'hotel', claimed: 4000 }),          // not food
    x({ emp: OTHER, claimed: 900 }),             // a colleague's dinner
    x({ tripId: 'other-trip' as Uuid, claimed: 700 }), // another trip
    x({ status: 'DISCARDED', claimed: 999 }),    // thrown away
  ]
  assert.equal(foodSpent(lines, TRIP, ME), 750)
})

test('foodBalance: under, close, and over', () => {
  const under = foodBalance(2000, 500)
  assert.deepEqual(
    { left: under.left, over: under.over, pct: under.pct, tone: under.tone },
    { left: 1500, over: 0, pct: 25, tone: 'ok' },
  )

  // Four fifths is the point of telling somebody, while they can still choose.
  const close = foodBalance(2000, 1600)
  assert.equal(close.tone, 'close')
  assert.equal(close.pct, 80)

  const over = foodBalance(2000, 2500)
  assert.deepEqual(
    { left: over.left, over: over.over, pct: over.pct, tone: over.tone },
    { left: 0, over: 500, pct: 100, tone: 'over' },
  )
})

test('foodBalance: the bar cannot run off the card, and nothing goes negative', () => {
  assert.equal(foodBalance(1000, 9000).pct, 100)
  assert.equal(foodBalance(1000, 9000).left, 0)
  assert.equal(foodBalance(-5, -5).budget, 0)
  // No budget set at all: spending registers as full rather than dividing by zero.
  assert.equal(foodBalance(0, 0).pct, 0)
  assert.equal(foodBalance(0, 300).pct, 100)
  assert.equal(foodBalance(0, 300).tone, 'over')
})

test('foodBalanceText says what is LEFT, which is the number you want', () => {
  assert.match(foodBalanceText(foodBalance(2000, 750), rs), /₹1,250 left/)
  assert.match(foodBalanceText(foodBalance(2000, 0), rs), /₹2,000 for food/)
  assert.match(foodBalanceText(foodBalance(2000, 2500), rs), /₹500 over/)
  assert.match(foodBalanceText(foodBalance(0, 0), rs), /No food budget is set/)
})

test('nightsBetween', () => {
  assert.equal(nightsBetween('2026-10-20', '2026-10-22'), 2)
  assert.equal(nightsBetween('2026-10-20', '2026-10-20'), 0)
  assert.equal(nightsBetween('2026-10-22', '2026-10-20'), 0, 'backwards is not negative nights')
  assert.equal(nightsBetween(null, '2026-10-22'), 0)
})

// ── what the desk decided ───────────────────────────────────────────────────

test('stayWaiting: only NONE is still waiting, and a missing decision counts as waiting', () => {
  assert.equal(stayWaiting({ status: 'NONE' }), true)
  assert.equal(stayWaiting(null), true, 'a trip saved before the column existed is waiting')
  assert.equal(stayWaiting(undefined), true)
  assert.equal(stayWaiting({ status: 'CHOSEN' }), false)
  assert.equal(stayWaiting({ status: 'REJECTED' }), false)
})

test('stayDecisionText says nothing while nobody has decided', () => {
  assert.equal(stayDecisionText(null), null)
  assert.equal(stayDecisionText({ status: 'NONE', chosen: null, name: '', remark: '' }), null)
})

test('stayDecisionText: chosen names the hotel and who picked it', () => {
  const d = stayDecisionText({ status: 'CHOSEN', chosen: 1, name: 'Lemon Tree', remark: 'Closest to the client.', byName: 'Asha Rao' })
  assert.equal(d?.tone, 'ok')
  assert.match(d!.text, /picked Lemon Tree/)
  assert.match(d!.text, /Asha Rao/)
  assert.match(d!.text, /Closest to the client\./)
})

test('stayDecisionText: a refusal leads with the reason', () => {
  const d = stayDecisionText({ status: 'REJECTED', chosen: null, name: '', remark: 'All three are over the limit.', byName: 'Asha Rao' })
  assert.equal(d?.tone, 'bad')
  assert.match(d!.text, /turned these down/)
  assert.match(d!.text, /All three are over the limit\./)
})

test('stayDecisionText: a refusal with no reason still reads as a sentence', () => {
  // The SQL will not allow this, but a row written before that rule, or by
  // hand, must not render as a dangling fragment.
  const d = stayDecisionText({ status: 'REJECTED', chosen: null, name: '', remark: '' })
  assert.match(d!.text, /No reason was given\./)
})

test('rejectReady: a refusal needs a reason', () => {
  assert.equal(rejectReady(''), false)
  assert.equal(rejectReady('   '), false)
  assert.equal(rejectReady('Too far from the office'), true)
})
