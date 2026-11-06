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
import { balance, checkKpis, checkAllKpis, suggestKpiSplit, kraRating,
         ratedCount, lines, blankKpi, renumber, canAddKpi, canRemoveKpi,
         DEFAULT_MIN_KPI_PER_KRA, DEFAULT_MAX_KPI_PER_KRA,
         type Kpi, type KraWithKpis } from '../kpi.ts'
import { score } from '../scoring.ts'
import { DEFAULT_RULES, type Rules } from '../cycle.ts'

/** A policy with a different KPI range, for testing that the range is read
 *  from the policy rather than from the defaults. */
const rules = (minKpi: number, maxKpi: number): Rules =>
  ({ ...DEFAULT_RULES, minKpi, maxKpi })

const kpi = (seq: number, w: number, metric = `m${seq}`): Kpi =>
  ({ seq_no: seq, kpi_metric: metric, target_value: 't', weightage: w })

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
  const ks = [kpi(1, 20), kpi(2, 10)]
  assert.equal(kraRating(ks, k => (k.seq_no === 1 ? 4 : null)), 4)
  assert.equal(kraRating(ks, k => (k.seq_no === 1 ? 4 : 1)), 3)
  // Nothing rated at all is null, not 0 — "not rated" and "rated badly" are
  // different answers and a screen shows them differently.
  assert.equal(kraRating(ks, () => null), null)
  assert.equal(kraRating([], () => 5), null)
})

test('a KRA rating is weighted by its KPIs, not averaged flat', () => {
  // The worked example from the request: 15/10/5 rated 4/3/5.
  const ks = [kpi(1, 15), kpi(2, 10), kpi(3, 5)]
  const r = { 1: 4, 2: 3, 3: 5 } as Record<number, number>
  assert.equal(kraRating(ks, k => r[k.seq_no]), 3.83)
  // A flat average would say 4.00, which is a different and wrong answer.
  assert.notEqual(kraRating(ks, k => r[k.seq_no]), 4)
})

// ── the balance rule ─────────────────────────────────────────────────────

test('KPIs must total their KRA, not 100', () => {
  // The rule that keeps the across-KRA total honest. A 30% KRA's KPIs total
  // 30; they have nothing to do with the 100.
  assert.equal(balance(kra(30, [kpi(1, 15), kpi(2, 10), kpi(3, 5)])).ok, true)
  assert.equal(balance(kra(30, [kpi(1, 15), kpi(2, 15), kpi(3, 15)])).ok, false)
  const b = balance(kra(30, [kpi(1, 10)]))
  assert.deepEqual([b.total, b.target, b.left, b.count], [10, 30, 20, 1])
})

test('a short set says how much is left; an over set says how much too many', () => {
  const short = checkKpis(kra(30, [kpi(1, 10), kpi(2, 5)]))
  assert.match(short[0].says, /come to 15 of this KRA's 30/)
  assert.match(short[0].says, /15 still to share out/)
  const over = checkKpis(kra(30, [kpi(1, 25), kpi(2, 20)]))
  assert.match(over[0].says, /come to 45/)
  assert.match(over[0].says, /15 more than this KRA's 30/)
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

test('balance().ok respects both ends of the policy range', () => {
  const six = [kpi(1, 5), kpi(2, 5), kpi(3, 5), kpi(4, 5), kpi(5, 5), kpi(6, 5)]
  // Balanced at 30, but one too many: not ok, or the form would enable a
  // submit the database refuses.
  assert.equal(balance(kra(30, six)).ok, false)
  assert.equal(balance(kra(30, six), rules(1, 6)).ok, true)
  // And the floor, read from the policy rather than assumed to be 1.
  assert.equal(balance(kra(30, [kpi(1, 30)]), rules(2, 5)).ok, false)
  assert.equal(balance(kra(30, [kpi(1, 30)])).ok, true)
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

test('a KPI with no measure, or no weightage, is named individually', () => {
  const f = checkKpis(kra(20, [kpi(1, 20, ''), { ...kpi(2, 0), kpi_metric: 'x' }]))
  const blank = f.find(x => x.kpiSeq === 1)
  const zero = f.find(x => x.kpiSeq === 2)
  assert.match(blank?.says ?? '', /how this one is measured/)
  assert.match(zero?.says ?? '', /cannot move the rating/)
  // Each fault names its KRA as well, so a list across KRAs is navigable.
  assert.ok(f.every(x => x.seq === 1))
})

test('zero weightage is refused rather than quietly carried', () => {
  // Somebody wrote the KPI down meaning it to count. Carrying it at 0 is a
  // row on the screen that cannot affect the rating either way.
  const f = checkKpis(kra(10, [kpi(1, 10), kpi(2, 0)]))
  assert.ok(f.some(x => x.kpiSeq === 2 && /remove it/.test(x.says)))
})

test('a balanced, measured set has nothing to say', () => {
  assert.deepEqual(checkKpis(kra(25, [kpi(1, 15), kpi(2, 10)])), [])
})

test('faults across a whole set come back in KRA order', () => {
  const all = checkAllKpis([
    kra(50, [kpi(1, 50)], 1),            // fine
    kra(30, [], 2),                      // no KPI
    kra(20, [kpi(1, 5)], 3),             // short
  ])
  assert.deepEqual(all.map(f => f.seq), [2, 3])
})

// ── helpers ──────────────────────────────────────────────────────────────

test('the suggested split fills the KRA exactly, remainder first', () => {
  // Same rule as suggestSplit uses for KRAs, so the two screens behave alike.
  assert.deepEqual(suggestKpiSplit(30, 3), [10, 10, 10])
  assert.deepEqual(suggestKpiSplit(10, 3), [4, 3, 3])
  assert.deepEqual(suggestKpiSplit(25, 2), [13, 12])
  for (const [w, n] of [[30, 3], [10, 3], [25, 2], [7, 4], [100, 7]] as const) {
    assert.equal(suggestKpiSplit(w, n).reduce((a, b) => a + b, 0), w,
      `split of ${w} across ${n} does not fill the KRA`)
  }
  assert.deepEqual(suggestKpiSplit(30, 0), [])
})

test('a new KPI starts at zero rather than guessing a share', () => {
  // A guess that happens to balance is one nobody checks. checkKpis refuses
  // 0 with a sentence saying what to do, which is the honest prompt.
  const b = blankKpi(3)
  assert.equal(b.weightage, 0)
  assert.equal(b.seq_no, 3)
  assert.equal(b.kpi_metric, '')
})

test('renumbering leaves 1..n with no holes', () => {
  // 220 makes (goal_id, seq_no) unique, so a hole is a write that fails.
  const after = renumber([kpi(1, 5), kpi(4, 5), kpi(9, 5)])
  assert.deepEqual(after.map(k => k.seq_no), [1, 2, 3])
  assert.deepEqual(after.map(k => k.weightage), [5, 5, 5], 'renumber changed a weightage')
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
