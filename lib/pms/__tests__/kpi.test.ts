// Several KPIs under one KRA, each rated, sharing the KRA's weightage.
//
// ── THE PROPERTY THE WHOLE DESIGN RESTS ON ───────────────────────────────
//
// Scoring was not changed. score() takes a flat list of weighted lines and
// returns the weighted mean over the rated ones; it never cared what a line
// stood for. lines() turns the KRA tree into that same list, one entry per
// KPI instead of one per KRA.
//
// So the test that matters is not "does kraRating work". It is: a KRA split
// into KPIs scores the same as the KRA did whole, whenever the KPI ratings
// agree. If that ever stops holding, migration 220 stopped being
// score-neutral and every appraisal on record moved.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkKpis, checkAllKpis, kraRating, shareOf, submitGate,
         ratedCount, unratedCount, lines, blankKpi, renumber,
         canAddKpi, canRemoveKpi,
         DEFAULT_MIN_KPI_PER_KRA, DEFAULT_MAX_KPI_PER_KRA,
         type Kpi, type KraWithKpis } from '../kpi.ts'
import { score } from '../scoring.ts'
import { DEFAULT_RULES, type Rules } from '../cycle.ts'

/** A policy with a different KPI range, for testing that the range is read
 *  from the policy rather than from the defaults. */
const rules = (minKpi: number, maxKpi: number): Rules =>
  ({ ...DEFAULT_RULES, minKpi, maxKpi })

// 222: a KPI has no weightage. The fixture keeps its arity so the many
// call sites below read unchanged, but the number is IGNORED — and that is
// itself asserted, because a stored weightage silently being honoured again
// is exactly the regression this migration has to not have.
const kpi = (seq: number, _ignored = 0, metric = `m${seq}`): Kpi =>
  ({ seq_no: seq, kpi_metric: metric, target_value: 't' })

const kra = (w: number, kpis: Kpi[], seq = 1): KraWithKpis =>
  ({ seq_no: seq, kra_title: `KRA ${seq}`, category: 'BUSINESS', weightage: w, kpis })

// ── the property ─────────────────────────────────────────────────────────

test('splitting a KRA into KPIs does not move the score', () => {
  // The guarantee migration 220 makes. Four KRAs rated 4, 3, 5, 2 — scored
  // whole, then with each KRA split into KPIs that all carry the same rating.
  // A weighted mean cannot tell the difference, and if it ever can, every
  // appraisal on record moved the day 220 ran.
  const whole = [
    { goalId: 'a', title: 'A', category: 'BUSINESS' as const, weightage: 40, final: 4 },
    { goalId: 'b', title: 'B', category: 'BUSINESS' as const, weightage: 30, final: 3 },
    { goalId: 'c', title: 'C', category: 'BUSINESS' as const, weightage: 20, final: 5 },
    { goalId: 'd', title: 'D', category: 'BUSINESS' as const, weightage: 10, final: 2 },
  ]
  const split = lines([
    kra(40, [kpi(1, 15), kpi(2, 15), kpi(3, 10)], 1),
    kra(30, [kpi(1, 20), kpi(2, 10)], 2),
    kra(20, [kpi(1, 20)], 3),
    kra(10, [kpi(1, 5), kpi(2, 5)], 4),
  ], (_k, g) => ({ final: ({ 1: 4, 2: 3, 3: 5, 4: 2 } as Record<number, number>)[g.seq_no] }))

  assert.equal(score(split, 'final'), score(whole, 'final'))
  assert.equal(score(split, 'final'), 3.7)
})

test('the one-KPI case is exactly the old behaviour', () => {
  // How 220 backfilled every existing KRA: one KPI carrying the whole
  // weightage. The flat list must be indistinguishable from the KRA list.
  const l = lines([kra(60, [kpi(1, 60)], 1), kra(40, [kpi(1, 40)], 2)],
                  (_k, g) => ({ final: g.seq_no === 1 ? 5 : 3 }))
  assert.deepEqual(l.map(x => x.weightage), [60, 40])
  assert.equal(score(l, 'final'), 4.2)
})

test('an unrated KPI is left out, not counted as zero', () => {
  // The same rule score() applies to KRAs, and the same reason: a half-rated
  // KRA should show the average of what was looked at, not a number dragged
  // down by work nobody has assessed.
  const ks = [kpi(1), kpi(2)]
  assert.equal(kraRating(ks, k => (k.seq_no === 1 ? 4 : null)), 4)
  assert.equal(kraRating(ks, k => (k.seq_no === 1 ? 4 : 1)), 2.5)
  // Nothing rated at all is null, not 0 — "not rated" and "rated badly" are
  // different answers and a screen shows them differently.
  assert.equal(kraRating(ks, () => null), null)
  assert.equal(kraRating([], () => 5), null)
})

test('a KRA rating is the plain mean of its rated KPIs', () => {
  // 222: the KPIs under a KRA carry EQUAL share, so weighting by that share
  // is the same as not weighting — (4w + 3w + 5w) / 3w = (4 + 3 + 5) / 3.
  const ks = [kpi(1), kpi(2), kpi(3)]
  const r = { 1: 4, 2: 3, 3: 5 } as Record<number, number>
  assert.equal(kraRating(ks, k => r[k.seq_no]), 4)
})

// ── 222: a KPI has no weightage of its own ───────────────────────────────

test('a stored KPI weightage is ignored, whatever it says', () => {
  // THE REGRESSION THIS MIGRATION MUST NOT HAVE. pms_goal_kpi.weightage is
  // retired, not dropped, so rows still come back carrying the old numbers.
  // If anything here started reading them again, a KRA whose KPIs were
  // written 20/10 would score differently from one written 15/15 — which is
  // the whole thing 222 removed.
  const lopsided: Kpi[] = [
    { seq_no: 1, kpi_metric: 'a', target_value: 't', weightage: 29 },
    { seq_no: 2, kpi_metric: 'b', target_value: 't', weightage: 1 },
  ]
  const even: Kpi[] = [
    { seq_no: 1, kpi_metric: 'a', target_value: 't', weightage: 15 },
    { seq_no: 2, kpi_metric: 'b', target_value: 't', weightage: 15 },
  ]
  const r = { 1: 5, 2: 1 } as Record<number, number>
  assert.equal(kraRating(lopsided, k => r[k.seq_no]), 3)
  assert.equal(kraRating(even, k => r[k.seq_no]), 3,
    'the stored weightage changed the answer — it is being read again')
  // And the same through lines(), which is what actually feeds score().
  const a = lines([kra(30, lopsided)], k => ({ final: r[k.seq_no] }))
  const b = lines([kra(30, even)], k => ({ final: r[k.seq_no] }))
  assert.deepEqual(a.map(x => x.weightage), b.map(x => x.weightage))
  assert.equal(score(a, 'final'), score(b, 'final'))
})

test('a KPI carries its KRA weightage divided by how many there are', () => {
  assert.equal(shareOf(30, 3), 10)
  assert.equal(shareOf(25, 2), 12.5)
  assert.equal(shareOf(100, 1), 100)
  // NOT ROUNDED. A 10% KRA across three KPIs is 3.333…; rounding each to
  // 3.33 would lose 0.01 of the KRA and the appraisal would stop totalling
  // 100. The sum has to come back exactly.
  const share = shareOf(10, 3)
  assert.equal(share * 3, 10)
  assert.notEqual(share, 3.33)
  // Degenerate inputs give 0 rather than Infinity or NaN.
  assert.equal(shareOf(30, 0), 0)
  assert.equal(shareOf(0, 3), 0)
})

test('however a KRA is split, it carries the same total weight', () => {
  // The property that replaces the balance rule: equal shares CANNOT fail to
  // add up, so there is nothing left to validate.
  for (const n of [1, 2, 3, 4, 5, 7]) {
    const ks = Array.from({ length: n }, (_, i) => kpi(i + 1))
    const l = lines([kra(30, ks)], () => ({ final: 4 }))
    const total = l.reduce((t, x) => t + x.weightage, 0)
    assert.ok(Math.abs(total - 30) < 1e-9,
      `${n} KPIs totalled ${total}, not 30`)
  }
})

test('a KRA with no KPI is refused, and told what a KPI is for', () => {
  const f = checkKpis(kra(30, []))
  assert.equal(f.length, 1, 'row faults are noise while there are no rows')
  assert.equal(f[0].kpiSeq, null)
  assert.match(f[0].says, /nothing to rate/)
})

// ── 221: the range is policy, and both ends are read from it ─────────────
//
// It used to be `MIN_KPI_PER_KRA = 1` with no ceiling. These tests are the
// ones that would have failed before: every assertion below passes a policy
// whose range is NOT the default, so a function that went on reading the
// constant would answer the default's question.

test('the shipped default is 1 to 5, as requested', () => {
  assert.equal(DEFAULT_MIN_KPI_PER_KRA, 1)
  assert.equal(DEFAULT_MAX_KPI_PER_KRA, 5)
  assert.equal(DEFAULT_RULES.minKpi, 1)
  assert.equal(DEFAULT_RULES.maxKpi, 5)
})

test('a floor above one asks for a count, not just "add a KPI"', () => {
  // "Add a KPI" is right for an empty KRA and useless at 2 of 3: it does not
  // say how many are wanted.
  const f = checkKpis(kra(30, [kpi(1, 15), kpi(2, 15)]), rules(3, 5))
  assert.equal(f.length, 1)
  assert.equal(f[0].kpiSeq, null)
  assert.match(f[0].says, /2 of the 3 KPIs/)
  assert.match(f[0].says, /Add 1 more/)
  // And the weightage is NOT complained about at the same time: this set
  // balances at 30 already, and will not once the third row is added.
  assert.ok(!/total/i.test(f[0].says))
})

test('a set over the ceiling is refused, and says how many to lose', () => {
  const six = [kpi(1, 5), kpi(2, 5), kpi(3, 5), kpi(4, 5), kpi(5, 5), kpi(6, 5)]
  const f = checkKpis(kra(30, six))            // default max 5
  assert.equal(f.length, 1)
  assert.match(f[0].says, /6 KPIs; the policy allows 5/)
  assert.match(f[0].says, /Remove 1/)
  // Under a policy that allows six, the same set is fine.
  assert.deepEqual(checkKpis(kra(30, six), rules(1, 6)), [])
})

test('the count rules still bite after the balance rule went', () => {
  const six = [kpi(1), kpi(2), kpi(3), kpi(4), kpi(5), kpi(6)]
  assert.equal(checkKpis(kra(30, six)).length, 1, 'six under a max of five')
  assert.deepEqual(checkKpis(kra(30, six), rules(1, 6)), [])
  assert.equal(checkKpis(kra(30, [kpi(1)]), rules(2, 5)).length, 1, 'one under a floor of two')
  assert.deepEqual(checkKpis(kra(30, [kpi(1)])), [])
})

test('the add button closes at the ceiling and says why', () => {
  const four = [kpi(1, 5), kpi(2, 5), kpi(3, 5), kpi(4, 5)]
  assert.equal(canAddKpi(four).allowed, true)
  const full = canAddKpi([...four, kpi(5, 5)])
  assert.equal(full.allowed, false)
  assert.match(full.reason ?? '', /5 KPIs is the most/)
  // The sentence carries the POLICY's number, so it changes with the setting.
  assert.match(canAddKpi(four, rules(1, 4)).reason ?? '', /4 KPIs is the most/)
  // And it points at where the limit is changed, since an admin reading it
  // can do something about it.
  assert.match(full.reason ?? '', /Setup and Configuration/)
})

test('the remove button closes at the floor and says why', () => {
  assert.equal(canRemoveKpi([kpi(1, 10), kpi(2, 10)]).allowed, true)
  const last = canRemoveKpi([kpi(1, 10)])
  assert.equal(last.allowed, false)
  assert.match(last.reason ?? '', /nothing to rate/)
  // At a floor above one the sentence is about the policy, not about rating:
  // "there would be nothing to rate" is false when two of three remain.
  const third = canRemoveKpi([kpi(1, 10), kpi(2, 10), kpi(3, 10)], rules(3, 5))
  assert.equal(third.allowed, false)
  assert.match(third.reason ?? '', /3 KPIs is the fewest/)
  assert.ok(!/nothing to rate/.test(third.reason ?? ''))
})

test('checkAllKpis passes the policy down, not the array index', () => {
  // `kras.flatMap(checkKpis)` compiles and is wrong: flatMap hands the
  // callback (item, index, array), so KRA 0 would be checked against a
  // "policy" of 0 and KRA 2 against 2. Every KRA here holds one KPI and
  // balances, so the only way to see a fault is a floor of 2 reaching all
  // of them.
  const set = [kra(50, [kpi(1, 50)], 1), kra(30, [kpi(1, 30)], 2),
               kra(20, [kpi(1, 20)], 3)]
  assert.deepEqual(checkAllKpis(set), [])
  const strict = checkAllKpis(set, rules(2, 5))
  assert.equal(strict.length, 3, 'the floor did not reach every KRA')
  assert.deepEqual(strict.map(f => f.seq), [1, 2, 3])
})

test('a KPI with no measure is named individually', () => {
  // The only per-row fault left. "No weightage" is gone with the column —
  // a KPI cannot have a weightage to be missing.
  const f = checkKpis(kra(20, [kpi(1, 0, ''), kpi(2, 0, 'x')]))
  assert.equal(f.length, 1)
  assert.equal(f[0].kpiSeq, 1)
  assert.match(f[0].says, /how this one is measured/)
  // Each fault names its KRA as well, so a list across KRAs is navigable.
  assert.ok(f.every(x => x.seq === 1))
})

test('a balanced, measured set has nothing to say', () => {
  assert.deepEqual(checkKpis(kra(25, [kpi(1, 15), kpi(2, 10)])), [])
})

test('faults across a whole set come back in KRA order', () => {
  const all = checkAllKpis([
    kra(50, [kpi(1, 50)], 1),            // fine
    kra(30, [], 2),                      // no KPI
    kra(20, [kpi(1)], 3),                // fine
  ])
  // Only the empty KRA is a fault now: 222 removed the weightage balance, so
  // a KRA with one measure is complete whatever the numbers used to say.
  assert.deepEqual(all.map(f => f.seq), [2])
})

// ── helpers ──────────────────────────────────────────────────────────────

test('a new KPI carries no weightage at all', () => {
  // 222: not zero, ABSENT. A blank row writing weightage: 0 would put a
  // number back into pms_goal_kpi.weightage, which is retired — and the next
  // person to read that column would find a mixture of real old splits and
  // meaningless zeroes.
  const b = blankKpi(3)
  assert.equal(b.weightage, undefined)
  assert.ok(!('weightage' in b), 'blankKpi still writes a weightage field')
  assert.equal(b.seq_no, 3)
  assert.equal(b.kpi_metric, '')
})

test('renumbering leaves 1..n with no holes', () => {
  // 220 makes (goal_id, seq_no) unique, so a hole is a write that fails.
  const after = renumber([kpi(1), kpi(4), kpi(9)])
  assert.deepEqual(after.map(k => k.seq_no), [1, 2, 3])
  assert.deepEqual(after.map(k => k.kpi_metric), ['m1', 'm4', 'm9'],
    'renumber moved a measure onto the wrong row')
  assert.deepEqual(renumber([]), [])
})

test('rated counts drive the "3 of 5" line', () => {
  const ks = [kpi(1, 10), kpi(2, 10), kpi(3, 10)]
  assert.deepEqual(ratedCount(ks, k => (k.seq_no < 3 ? 4 : null)), { rated: 2, of: 3 })
  assert.deepEqual(ratedCount([], () => 4), { rated: 0, of: 0 })
})

test('a line names both the KRA and the KPI', () => {
  // The flat list loses the tree, so the title has to carry it or a reader
  // cannot tell which objective a line belongs to.
  const l = lines([kra(20, [kpi(1, 20, 'Cycle-count variance')], 1)], () => ({ final: 4 }))
  assert.equal(l[0].title, 'KRA 1 · Cycle-count variance')
  assert.equal(l[0].weightage, 20)
})

test('a line is identified by the KPI, because that is what is rated', () => {
  const saved = lines([kra(10, [{ ...kpi(1, 10), id: 'kpi-uuid' }], 1)], () => ({}))
  assert.equal(saved[0].goalId, 'kpi-uuid')
  // Unsaved rows still need a stable key for React and for diffing.
  const unsaved = lines([kra(10, [kpi(2, 10)], 3)], () => ({}))
  assert.equal(unsaved[0].goalId, '3.2')
})

test('an empty tree produces no lines rather than throwing', () => {
  assert.deepEqual(lines([], () => ({})), [])
  assert.deepEqual(lines([kra(10, [], 1)], () => ({})), [])
  assert.equal(score(lines([], () => ({})), 'final'), null)
})

// ── 222: the one submit gate ─────────────────────────────────────────────
//
// Requested: "user can not proceed to submit kras without achieving 100%
// weightage and filling all the minimum kras and kpis", and every KRA must be
// rated before it moves.
//
// Three rules enforced in three places, and the screen checked one of them:
// the button read checkKras alone, which knows about weightage and nothing
// whatever about KPIs. A KRA with no measure under it sailed past.

/** Four KRAs totalling exactly 100, one measure each — the minimum valid set
 *  under the shipped policy. Each test below breaks one thing about it. */
const valid = (): KraWithKpis[] => [
  kra(25, [kpi(1)], 1), kra(25, [kpi(1)], 2),
  kra(25, [kpi(1)], 3), kra(25, [kpi(1)], 4),
]
const allRated = () => 4

test('a complete set passes the gate', () => {
  const g = submitGate(valid(), DEFAULT_RULES, allRated)
  assert.deepEqual(g.faults, [])
  assert.equal(g.ok, true)
  assert.equal(g.total, 100)
  assert.equal(g.short, 0)
  assert.deepEqual([g.rated, g.of], [4, 4])
})

test('under 100 is refused, and says how far short', () => {
  const set = valid()
  set[0].weightage = 15                      // 90 total
  const g = submitGate(set, DEFAULT_RULES, allRated)
  assert.equal(g.ok, false)
  assert.equal(g.total, 90)
  assert.equal(g.short, -10)
  assert.ok(g.faults.some(f => /10 short of 100/.test(f)), g.faults.join(' | '))
})

test('over 100 is refused too — it is a state you can type, not send', () => {
  // The chosen behaviour: the form ALLOWS going over while rebalancing, so
  // the gate is what stops it leaving. A hard cap on the input would mean
  // you could not raise one KRA before lowering another.
  const set = valid()
  set[0].weightage = 40                      // 115 total
  const g = submitGate(set, DEFAULT_RULES, allRated)
  assert.equal(g.ok, false)
  assert.equal(g.total, 115)
  assert.equal(g.short, 15)
  assert.ok(g.faults.some(f => /15 over 100/.test(f)), g.faults.join(' | '))
})

test('too few KRAs is refused even at exactly 100', () => {
  // 100% spread over three KRAs is still three KRAs. The weightage rule and
  // the count rule are independent, and passing one is not passing the other.
  const g = submitGate([kra(40, [kpi(1)], 1), kra(30, [kpi(1)], 2),
                        kra(30, [kpi(1)], 3)], DEFAULT_RULES, allRated)
  assert.equal(g.ok, false)
  assert.equal(g.total, 100)
  assert.ok(g.faults.some(f => /Add 1 more/.test(f)), g.faults.join(' | '))
})

test('a KRA with no KPI is refused — the gap checkKras could not see', () => {
  // THE BUG THIS GATE EXISTS FOR. checkKras returns canSubmit: true here —
  // four KRAs, exactly 100, every title filled — and the button believed it.
  const set = valid()
  set[2].kpis = []
  const g = submitGate(set, DEFAULT_RULES, allRated)
  assert.equal(g.ok, false)
  assert.ok(g.faults.some(f => /^KRA 3: Add a KPI/.test(f)), g.faults.join(' | '))
  // And the fault names which KRA, because the list sits beside a form of
  // nine rows and "add a KPI" alone sends the reader hunting.
  assert.ok(g.faults.some(f => f.startsWith('KRA 3:')))
})

test('a KPI with no measure written is refused, and named', () => {
  const set = valid()
  set[1].kpis = [{ seq_no: 1, kpi_metric: '  ', target_value: '' }]
  const g = submitGate(set, DEFAULT_RULES, allRated)
  assert.equal(g.ok, false)
  assert.ok(g.faults.some(f => /^KRA 2, KPI 1:/.test(f)), g.faults.join(' | '))
})

test('an unrated measure is refused, and counted', () => {
  const set = valid()
  const g = submitGate(set, DEFAULT_RULES, (_k, k) => k.seq_no === 3 ? null : 4)
  assert.equal(g.ok, false)
  assert.deepEqual([g.rated, g.of], [3, 4])
  assert.ok(g.faults.some(f => /1 of 4 measures still need a rating/.test(f)),
    g.faults.join(' | '))
})

test('every KPI counts, not every KRA', () => {
  // A KRA with three measures of which two are rated is NOT a rated KRA.
  // Counting KRAs would call it done with a third of it untouched.
  const set: KraWithKpis[] = [
    kra(25, [kpi(1), kpi(2), kpi(3)], 1), kra(25, [kpi(1)], 2),
    kra(25, [kpi(1)], 3), kra(25, [kpi(1)], 4),
  ]
  const g = submitGate(set, DEFAULT_RULES,
    (k, kr) => (kr.seq_no === 1 && k.seq_no === 3) ? null : 4)
  assert.equal(g.ok, false)
  assert.deepEqual([g.rated, g.of], [5, 6])
})

test('without a ratingOf, the gate judges the set and not the ratings', () => {
  // The KRA tab before the self rating is required: weightage and structure
  // must hold, but there is nothing to have rated yet.
  const g = submitGate(valid(), DEFAULT_RULES)
  assert.equal(g.ok, true)
  assert.deepEqual([g.rated, g.of], [0, 0])
})

test('the faults are ordered set, then KPIs, then ratings', () => {
  // The order to deal with them in. Rating a set you are about to add a KRA
  // to is wasted work, so the counts come first.
  const set = valid()
  set[0].weightage = 15     // short
  set[2].kpis = []          // no KPI
  const g = submitGate(set, DEFAULT_RULES, (_k, k) => k.seq_no === 4 ? null : 4)
  const weight = g.faults.findIndex(f => /short of 100/.test(f))
  const kpis = g.faults.findIndex(f => /Add a KPI/.test(f))
  const rating = g.faults.findIndex(f => /need a rating/.test(f))
  assert.ok(weight >= 0 && kpis >= 0 && rating >= 0, g.faults.join(' | '))
  assert.ok(weight < kpis, 'the KPI fault is listed before the weightage one')
  assert.ok(kpis < rating, 'the rating fault is listed before the KPI one')
})

test('the policy decides the gate, not the shipped defaults', () => {
  // A total of 80 under a policy whose total is 80 is complete, and four KRAs
  // under a policy asking for six is not.
  const eighty: Rules = { ...DEFAULT_RULES, totalWeightage: 80, minKra: 4 }
  const set = [kra(20, [kpi(1)], 1), kra(20, [kpi(1)], 2),
               kra(20, [kpi(1)], 3), kra(20, [kpi(1)], 4)]
  assert.equal(submitGate(set, eighty, allRated).ok, true)
  assert.equal(submitGate(set, DEFAULT_RULES, allRated).ok, false)
  const six: Rules = { ...DEFAULT_RULES, minKra: 6 }
  assert.equal(submitGate(valid(), six, allRated).ok, false)
})

test('unratedCount walks every KPI in order', () => {
  const set: KraWithKpis[] = [kra(50, [kpi(1), kpi(2)], 1), kra(50, [kpi(1)], 2)]
  assert.deepEqual(unratedCount(set, () => 4), { rated: 3, of: 3 })
  assert.deepEqual(unratedCount(set, () => null), { rated: 0, of: 3 })
  assert.deepEqual(unratedCount([], () => 4), { rated: 0, of: 0 })
})
