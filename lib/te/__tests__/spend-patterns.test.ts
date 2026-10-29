// Does the spend-pattern layer actually fire?
//
// D3, D5, D6 and D7 look at the SHAPE of a claim rather than any single line,
// which makes them the easiest checks in the module to write and believe in
// without ever seeing one trigger. The engine's own fixtures contain none of
// these patterns — running every seeded claim through assess() raises B5, C1,
// D4, D9, G3, LATE and POL and not one of these four — so each pattern is
// constructed here on purpose.
//
// Every test asserts BOTH directions: the pattern fires, and a near miss does
// not. A check that fires on everything is as useless as one that fires on
// nothing, and the second half is what catches a threshold written the wrong
// way round.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function engine(): Any {
  const { createEngine } = require_('../engine/te-engine.js') as Any
  const EZ = createEngine()
  EZ.seed()
  return EZ
}

/** Put a set of lines on a fresh claim for one employee and assess it. */
function flagsFor(EZ: Any, lines: Partial<Record<string, unknown>>[], empId?: string): string[] {
  const who = empId ?? EZ.S.expenses[0].emp
  const ids: string[] = []
  lines.forEach((l, i) => {
    const id = `TEST-${Date.now()}-${i}`
    EZ.S.expenses.push({
      id, emp: who, tripId: null, legId: null, cat: 'meals', date: '2026-10-06',
      merchant: 'Test merchant', bill: 100, claimed: 100, pay: 'self', payMode: 'UPI',
      status: 'UNCLAIMED', file: null, claimId: null, ...l,
    })
    ids.push(id)
  })
  const r = EZ.assess(ids, who, null, '')
  return (r.flags ?? []).map((f: Any) => f.code)
}

const noBill = (bill: number, over: Partial<Record<string, unknown>> = {}) =>
  ({ bill, claimed: bill, file: null, ...over })

// ── D3: amounts repeatedly just under the receipt threshold ─────────────────

test('D3 fires when several no-bill amounts sit just under the receipt threshold', () => {
  const EZ = engine()
  const above = EZ.S.cfg.receiptAbove
  assert.ok(above > 0, 'the fixture has no receipt threshold to sit under')
  // Default band is 15%, so anything from above*0.85 to above counts.
  const near = Math.round(above * 0.95)
  const codes = flagsFor(EZ, [noBill(near), noBill(near - 1), noBill(near - 2)])
  assert.ok(codes.includes('D3'), `expected D3, got ${codes.join(' ') || 'nothing'}`)
})

test('D3 stays quiet for amounts well under the threshold', () => {
  const EZ = engine()
  const low = Math.round(EZ.S.cfg.receiptAbove * 0.2)
  const codes = flagsFor(EZ, [noBill(low), noBill(low), noBill(low)])
  assert.ok(!codes.includes('D3'), 'D3 fired on amounts nowhere near the threshold')
})

test('D3 stays quiet for one such amount — a single line is not a pattern', () => {
  const EZ = engine()
  const near = Math.round(EZ.S.cfg.receiptAbove * 0.95)
  const codes = flagsFor(EZ, [noBill(near)])
  assert.ok(!codes.includes('D3'))
})

// ── D6: consecutive bill numbers from one merchant ──────────────────────────

test('D6 fires on a run of consecutive bill numbers from one merchant', () => {
  const EZ = engine()
  const codes = flagsFor(EZ, [
    { merchant: 'Shree Caterers', billNo: 'INV-1041', bill: 300, claimed: 300, file: { sha: 'a' } },
    { merchant: 'Shree Caterers', billNo: 'INV-1042', bill: 400, claimed: 400, file: { sha: 'b' } },
    { merchant: 'Shree Caterers', billNo: 'INV-1043', bill: 500, claimed: 500, file: { sha: 'c' } },
  ])
  assert.ok(codes.includes('D6'), `expected D6, got ${codes.join(' ') || 'nothing'}`)
})

test('D6 ignores a GST-style prefix and still sees the run', () => {
  // Only the trailing digits are compared, so a prefix must not defeat it.
  const EZ = engine()
  const codes = flagsFor(EZ, [
    { merchant: 'Shree Caterers', billNo: '27AAAA/2026/0088', bill: 300, claimed: 300, file: { sha: 'a' } },
    { merchant: 'Shree Caterers', billNo: '27AAAA/2026/0089', bill: 300, claimed: 300, file: { sha: 'b' } },
    { merchant: 'Shree Caterers', billNo: '27AAAA/2026/0090', bill: 300, claimed: 300, file: { sha: 'c' } },
  ])
  assert.ok(codes.includes('D6'), `expected D6, got ${codes.join(' ') || 'nothing'}`)
})

test('D6 stays quiet on scattered bill numbers from one merchant', () => {
  const EZ = engine()
  const codes = flagsFor(EZ, [
    { merchant: 'Shree Caterers', billNo: 'INV-1041', bill: 300, claimed: 300, file: { sha: 'a' } },
    { merchant: 'Shree Caterers', billNo: 'INV-2297', bill: 300, claimed: 300, file: { sha: 'b' } },
    { merchant: 'Shree Caterers', billNo: 'INV-7715', bill: 300, claimed: 300, file: { sha: 'c' } },
  ])
  assert.ok(!codes.includes('D6'), 'D6 fired on bill numbers that are not a sequence')
})

test('D6 does not join two different merchants into one run', () => {
  const EZ = engine()
  const codes = flagsFor(EZ, [
    { merchant: 'Shree Caterers', billNo: 'INV-1041', bill: 300, claimed: 300, file: { sha: 'a' } },
    { merchant: 'Another Place', billNo: 'INV-1042', bill: 300, claimed: 300, file: { sha: 'b' } },
    { merchant: 'Third Shop', billNo: 'INV-1043', bill: 300, claimed: 300, file: { sha: 'c' } },
  ])
  assert.ok(!codes.includes('D6'))
})

// ── D7: most of the claim's VALUE has no bill ───────────────────────────────

test('D7 fires when most of the claim value is unreceipted', () => {
  const EZ = engine()
  const codes = flagsFor(EZ, [
    noBill(4000), noBill(3000), noBill(2000),
    { bill: 500, claimed: 500, file: { sha: 'x' } },
  ])
  assert.ok(codes.includes('D7'), `expected D7, got ${codes.join(' ') || 'nothing'}`)
})

test('D7 judges value, not count — many small no-bill lines do not trigger it', () => {
  // Ten small unreceipted autos is how people actually travel. One large
  // unreceipted line is the thing worth asking about, and this is the
  // distinction the check is built on.
  const EZ = engine()
  const codes = flagsFor(EZ, [
    noBill(40), noBill(40), noBill(40), noBill(40), noBill(40),
    { bill: 9000, claimed: 9000, file: { sha: 'x' } },
  ])
  assert.ok(!codes.includes('D7'), 'D7 fired on a claim that is mostly receipted by value')
})

test('D7 stays quiet on a fully receipted claim', () => {
  const EZ = engine()
  const codes = flagsFor(EZ, [
    { bill: 900, claimed: 900, file: { sha: 'a' } },
    { bill: 800, claimed: 800, file: { sha: 'b' } },
    { bill: 700, claimed: 700, file: { sha: 'c' } },
    { bill: 600, claimed: 600, file: { sha: 'd' } },
  ])
  assert.ok(!codes.includes('D7'))
})

// ── the switch still governs ────────────────────────────────────────────────

test('switching a check off silences it', () => {
  // Every one of these is an administrator's to turn off, and the engine's
  // own `chk(code).on` gate is what makes that true. Worth pinning: a check
  // that ignores its switch is a different kind of lie from one that never
  // runs.
  const EZ = engine()
  const d3 = EZ.S.cfg.checks.find((c: Any) => c.c === 'D3')
  d3.on = false
  const near = Math.round(EZ.S.cfg.receiptAbove * 0.95)
  const codes = flagsFor(EZ, [noBill(near), noBill(near - 1), noBill(near - 2)])
  assert.ok(!codes.includes('D3'), 'D3 fired while switched off')
})

// ── D5: far above what peers of the same grade pay ──────────────────────────
//
// The only one of the four that needs other people's data, so the peer group
// is built here: the fixture has grades M2:1 M1:2 E1:1 L1:4, and D5 wants at
// least four peers of the SAME grade before it will compare anything.

/** Give colleagues of one grade an ordinary bill for the same thing, and
 *  return a claimant of that grade who is NOT among them.
 *
 *  The claimant has to be excluded: D5 compares against `o.emp !== x.emp`, so
 *  counting somebody among their own peers both shrinks the group and drags
 *  the median toward the very amount being tested. Getting that wrong in the
 *  fixture is what made this test fail the first time, and the check was
 *  right. */
function withPeers(EZ: Any, grade: string, cat: string, amounts: number[]): string {
  const all = Object.values(EZ.S.emp).filter((e: Any) => e.grade === grade) as Any[]
  assert.ok(all.length >= 2, `the fixture has too few grade ${grade} employees`)
  const claimant = all[0]
  const peers = all.slice(1)
  assert.ok(peers.length >= 1, 'no peer left once the claimant is excluded')
  amounts.forEach((amount, i) => {
    EZ.S.expenses.push({
      id: `PEER-${cat}-${i}`, emp: peers[i % peers.length].id, tripId: null, legId: null,
      cat, date: '2026-10-06', merchant: 'Peer merchant', bill: amount, claimed: amount,
      pay: 'self', payMode: 'UPI', status: 'PAID', file: { sha: `p${i}` }, claimId: `CLM-PEER-${i}`,
    })
  })
  return claimant.id
}

/** Set a check's thresholds the way an administrator would. Reading these at
 *  all is what migration 167 enables; before it, te_config never sent params
 *  to the engine and every threshold was stuck at its default. */
function tune(EZ: Any, code: string, params: Record<string, number>) {
  const k = EZ.S.cfg.checks.find((c: Any) => c.c === code)
  assert.ok(k, `${code} is not in the catalogue`)
  k.params = params
}

test('D5 fires when an amount dwarfs the peer median for the same category and grade', () => {
  const EZ = engine()
  // The fixture has four L1 employees, and one of them is the claimant, so
  // three peers are all there can be. Lowering minPeers is how an
  // administrator would handle a small company — and proves the params read.
  tune(EZ, 'D5', { minPeers: 3, times: 2.5 })
  const who = withPeers(EZ, 'L1', 'meals', [400, 450, 500])
  const codes = flagsFor(EZ, [{ cat: 'meals', bill: 4000, claimed: 4000, file: { sha: 'big' } }], who)
  assert.ok(codes.includes('D5'), `expected D5, got ${codes.join(' ') || 'nothing'}`)
})

test('D5 respects a tuned multiple, not just a tuned group size', () => {
  const EZ = engine()
  // Median 450; 1000 is 2.2x. Above a 2x threshold, below the 2.5x default.
  tune(EZ, 'D5', { minPeers: 3, times: 2 })
  const who = withPeers(EZ, 'L1', 'meals', [400, 450, 500])
  assert.ok(flagsFor(EZ, [{ cat: 'meals', bill: 1000, claimed: 1000, file: { sha: 'a' } }], who).includes('D5'))

  const EZ2 = engine()
  tune(EZ2, 'D5', { minPeers: 3, times: 3 })
  const who2 = withPeers(EZ2, 'L1', 'meals', [400, 450, 500])
  assert.ok(!flagsFor(EZ2, [{ cat: 'meals', bill: 1000, claimed: 1000, file: { sha: 'a' } }], who2).includes('D5'),
    'a tuned multiple of 3x should not fire on 2.2x')
})

test('D5 stays quiet on an amount in line with peers', () => {
  const EZ = engine()
  tune(EZ, 'D5', { minPeers: 3, times: 2.5 })
  const who = withPeers(EZ, 'L1', 'meals', [400, 450, 500])
  const codes = flagsFor(EZ, [{ cat: 'meals', bill: 520, claimed: 520, file: { sha: 'ok' } }], who)
  assert.ok(!codes.includes('D5'), 'D5 fired on an ordinary amount')
})

test('D5 says nothing when there are too few peers to compare against', () => {
  // Two colleagues is not a peer group, and calling an amount an outlier
  // against two numbers would be arithmetic pretending to be evidence.
  const EZ = engine()
  const who = withPeers(EZ, 'L1', 'meals', [400, 450])
  const codes = flagsFor(EZ, [{ cat: 'meals', bill: 9000, claimed: 9000, file: { sha: 'big' } }], who)
  assert.ok(!codes.includes('D5'), 'D5 compared against too small a group')
})

test('D5 compares within a category, not across them', () => {
  // A hotel bill is not an outlier because it is larger than four meals.
  const EZ = engine()
  tune(EZ, 'D5', { minPeers: 3, times: 2.5 })
  const who = withPeers(EZ, 'L1', 'meals', [400, 450, 500])
  const codes = flagsFor(EZ, [{ cat: 'local', bill: 4000, claimed: 4000, desc: 'auto', file: { sha: 'other' } }], who)
  assert.ok(!codes.includes('D5'), 'D5 compared a local ride against meal bills')
})

// ── C7: in another city on that date ────────────────────────────────────────

/** Checksum-valid GSTINs, which gstValid() demands before C5 or C7 look at a
 *  bill at all, and dates that sit before the engine's today (2026-11-16) and
 *  inside its 90-day bill-age limit.
 *
 *  Both of those sank the first version of these tests: an invented GSTIN
 *  raises A4 and a future date raises A2, and in either case the line never
 *  reaches the check under test. The flags said so plainly — "got A2 A4" — and
 *  the check was right both times. */
const VALID_GSTIN = { MH: '27AAAAA0000A1Z2', KL: '32AAAAA0000A1ZB' }
//
// The sharp complement of C5. C5 fires when the merchant's state is NOWHERE on
// the trip; C7 when the state IS on the trip but not on that day. They must
// never both fire, which is asserted below — two flags for one fact is how an
// approver learns to skim them.

/** A two-city domestic trip: Jaipur on the 10th, Mumbai on the 11th-12th. */
function twoCityTrip(EZ: Any): Any {
  const place = (id: string, city: string, state: string) => {
    EZ.S.places.push({ id, src: 'saved', pt: 'client', s: city, name: city, addr: city, city, state, pin: '', country: 'India', lat: 0, lng: 0, code: null, owner: null })
    return id
  }
  const home = EZ.S.places[0]?.id ?? place('P-HOME', 'Gurugram', '06')
  const jai = place('P-JAI', 'Jaipur', '08')
  const bom = place('P-BOM', 'Mumbai', '27')
  const t = {
    id: 'TRIP-C7', emp: EZ.S.expenses[0].emp, no: 'TRP-C7', name: 'Two city', scope: 'domestic',
    pattern: 'multi', origin: 'PRE_APPROVED', purpose: 'Client meeting', project: '',
    status: 'APPROVED', start: '2026-11-10', end: '2026-11-12', pax: 1, co: [],
    points: [
      { place: home, pt: 'off', what: '', leave: '2026-11-10' },
      { place: jai, pt: 'client', what: '', arrive: '2026-11-10', leave: '2026-11-10' },
      { place: bom, pt: 'client', what: '', arrive: '2026-11-11', leave: '2026-11-12' },
    ],
    segs: [], legIds: [], history: [],
  }
  EZ.S.trips.push(t)
  return t
}

test('C7 fires on a bill from a trip city you were not in that day', () => {
  const EZ = engine()
  const t = twoCityTrip(EZ)
  // Mumbai GSTIN (27), dated the 10th — the day the trip was in Jaipur.
  const codes = flagsFor(EZ, [{
    cat: 'meals', tripId: t.id, date: '2026-11-10',
    gstin: VALID_GSTIN.MH, bill: 900, claimed: 900, file: { sha: 'c7' },
  }], t.emp)
  assert.ok(codes.includes('C7'), `expected C7, got ${codes.join(' ') || 'nothing'}`)
})

test('C7 and C5 never both fire — they are complements, not duplicates', () => {
  const EZ = engine()
  const t = twoCityTrip(EZ)
  // Kerala (32): nowhere on this trip, so this is C5's case and not C7's.
  const codes = flagsFor(EZ, [{
    cat: 'meals', tripId: t.id, date: '2026-11-10',
    gstin: VALID_GSTIN.KL, bill: 900, claimed: 900, file: { sha: 'c5' },
  }], t.emp)
  assert.ok(codes.includes('C5'), 'a state nowhere on the trip should raise C5')
  assert.ok(!codes.includes('C7'), 'C7 fired on a state that is not on the trip at all — that is C5')
})

test('C7 stays quiet when the bill matches where you were that day', () => {
  const EZ = engine()
  const t = twoCityTrip(EZ)
  const codes = flagsFor(EZ, [{
    cat: 'meals', tripId: t.id, date: '2026-11-11',
    gstin: VALID_GSTIN.MH, bill: 900, claimed: 900, file: { sha: 'ok' },
  }], t.emp)
  assert.ok(!codes.includes('C7'), 'C7 fired on a Mumbai bill dated a Mumbai day')
})

test('a stay is judged over its whole range, not its first night', () => {
  // Three nights spanning the move: one of them is in the right city, so the
  // stay is in the right city. Judging only check-in would flag every hotel
  // somebody checks into the evening they arrive.
  const EZ = engine()
  const t = twoCityTrip(EZ)
  const codes = flagsFor(EZ, [{
    cat: 'hotel', tripId: t.id, date: '2026-11-10',
    checkIn: '2026-11-10', checkOut: '2026-11-12',
    gstin: VALID_GSTIN.MH, bill: 6000, claimed: 6000, file: { sha: 'stay' },
  }], t.emp)
  assert.ok(!codes.includes('C7'), `a stay covering a Mumbai night should not raise C7, got ${codes.join(' ')}`)
})

test('C7 says nothing without a GSTIN, because it has no city to compare', () => {
  const EZ = engine()
  const t = twoCityTrip(EZ)
  const codes = flagsFor(EZ, [{
    cat: 'meals', tripId: t.id, date: '2026-11-10', bill: 900, claimed: 900, file: { sha: 'n' },
  }], t.emp)
  assert.ok(!codes.includes('C7'))
})
