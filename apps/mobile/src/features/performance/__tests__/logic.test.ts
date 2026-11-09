// @ts-nocheck — a node:test file (no @types/node in the app; the .ts import is what node --experimental-strip-types needs).
// Checks ../logic.ts, which imports the website's pure lib through `@web/*`.
// Node has no such alias, so a resolve hook maps `@web/x` to ../../../../../../lib/x.ts
// before logic.ts is loaded — the same files Metro bundles into the app.
//   node --experimental-strip-types --test src/features/performance/__tests__/logic.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const LIB = new URL('../../../../../../lib/', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@web/')) { const p = spec.slice(5); return next(${JSON.stringify(LIB)} + (p.endsWith('.ts') ? p : p + '.ts'), ctx) }
  return next(spec, ctx)
}`), import.meta.url)

const L = await import('../logic.ts')
const { DEFAULT_RULES } = await import(LIB + 'pms/cycle.ts')
const { DEFAULT_BANDS } = await import(LIB + 'pms/scoring.ts')

const goals = [
  { id: 'g1', seq_no: 1, kra_title: 'Ship it', kpi_metric: '', target_value: '', category: 'BUSINESS', weightage: 60, status: 'LOCKED' },
  { id: 'g2', seq_no: 2, kra_title: 'Grow', kpi_metric: 'old metric', target_value: '3', category: 'LEARNING', weightage: 40, status: 'LOCKED' },
]
const kpis = [
  { id: 'k12', goal_id: 'g1', seq_no: 2, kpi_metric: 'Latency', target_value: '200ms', weightage: 0 },
  { id: 'k11', goal_id: 'g1', seq_no: 1, kpi_metric: 'Uptime', target_value: '99.9', weightage: 0 },
  { id: 'k13', goal_id: 'g1', seq_no: 3, kpi_metric: 'Bugs', target_value: '<5', weightage: 0 },
]
const reviews = [
  { goal_id: 'g1', kpi_id: 'k11', rater_role: 'SELF', rating: 5, achievement_value: '99.95', comments: 'logs' },
  { goal_id: 'g1', kpi_id: 'k12', rater_role: 'SELF', rating: 4, achievement_value: null, comments: null },
  { goal_id: 'g1', kpi_id: 'k13', rater_role: 'SELF', rating: 4, achievement_value: '3', comments: 'jira' },
  { goal_id: 'g1', kpi_id: 'k11', rater_role: 'RM_L1', rating: 3, comments: 'ok' },
  { goal_id: 'g1', kpi_id: 'k12', rater_role: 'RM_L1', rating: null, comments: '' },
]

test('the policy decides the rules, column by column, and no policy means the defaults', () => {
  assert.deepEqual(L.rulesOf(null), DEFAULT_RULES)
  const r = L.rulesOf({ min_kra_count: 5, max_kra_count: 8, total_weightage: 100, min_weightage_per_kra: 10, min_kpi_per_kra: 2, max_kpi_per_kra: 3 })
  assert.deepEqual(r, { minKra: 5, maxKra: 8, totalWeightage: 100, minWeightagePerKra: 10, minKpi: 2, maxKpi: 3 })
  // a database behind 221 has no KPI columns: those fall back, the rest stay the policy's
  const old = L.rulesOf({ min_kra_count: 6 })
  assert.equal(old.minKra, 6)
  assert.equal(old.minKpi, DEFAULT_RULES.minKpi)
  assert.equal(old.maxKpi, DEFAULT_RULES.maxKpi)
})

test('a blank KRA comes with one blank KPI and no weightage on it', () => {
  const k = L.blankKra(3)
  assert.equal(k.seq_no, 3)
  assert.deepEqual(k.kpis, [{ seq_no: 1, kpi_metric: '', target_value: '' }])
})

test('saved KRAs carry their KPIs in order; one with no KPI rows gets one from its own columns', () => {
  const k = L.krasFromRows(goals, kpis)
  assert.deepEqual(k[0].kpis.map(x => x.kpi_metric), ['Uptime', 'Latency', 'Bugs'])
  assert.equal(k[0].kpis[0].id, 'k11')
  assert.equal(k[1].kpis.length, 1)
  assert.equal(k[1].kpis[0].kpi_metric, 'old metric')
  assert.equal(k[1].category, 'LEARNING')
})

test('the self rating seeds per KPI on selfKey, joined on kpi_id', () => {
  const s = L.seedSelf(goals, kpis, reviews)
  assert.deepEqual(s['1.1'], { achievement: '99.95', rating: 5, comment: 'logs' })
  assert.deepEqual(s['1.2'], { achievement: '', rating: 4, comment: '' })
  assert.equal(s['1.3'].rating, 4)
  assert.equal(s['2.1'], undefined) // g2 has no KPI rows
})

test('self rows are one per KPI, titled KRA · KPI, each carrying an equal share of the KRA', () => {
  const rows = L.selfRowsOf(goals, kpis, reviews)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].title, 'Ship it · Uptime')
  assert.equal(rows[0].kpiId, 'k11')
  assert.equal(rows[0].weightage, 20)
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.weightage, 0) - 60) < 1e-9)
})

test('a KRA rating per role is the mean of its rated measures, comments joined', () => {
  const by = L.byGoalAndRole(reviews)
  assert.equal(by.get('g1').SELF.rating, 4.33) // 5, 4, 4 — not whichever row came last
  assert.equal(by.get('g1').SELF.comment, 'logs · jira')
  assert.equal(by.get('g1').RM_L1.rating, 3) // an unrated measure leaves the divisor
  const lines = L.resultLines(goals, reviews)
  assert.equal(lines[0].self, 4.33)
  assert.equal(lines[0].final, 3) // HOD ?? RM_L2 ?? RM_L1
  assert.equal(lines[1].self, null)
})

test('Team Ratings rows keep each rung apart and take the employee’s achievement first', () => {
  const rows = L.rateRowsOf(goals, reviews)
  assert.equal(rows[0].by.RM_L1.rating, 3)
  assert.equal(rows[0].achievement, '99.95 · 3')
  assert.deepEqual(rows[1].by, {})
})

test('the panel lines carry each measure with its share and the employee’s own answer', () => {
  const self = reviews.filter(r => r.rater_role === 'SELF')
  const lines = L.kraLinesOf(goals, kpis, self)
  assert.equal(lines[0].kpis.length, 3)
  assert.equal(lines[0].kpis[1].metric, 'Latency')
  assert.equal(lines[0].kpis[1].selfRating, 4)
  assert.equal(lines[0].kpis[0].share, 20)
  assert.equal(L.measuresOf(lines).length, 3)
  assert.equal(L.measuresOf(null).length, 0)
})

test('the comparison, progress and chips count measures, and a difference needs a reason', () => {
  const lines = L.kraLinesOf(goals, kpis, reviews.filter(r => r.rater_role === 'SELF'))
  const rate = L.mineOf([{ kpi_id: 'k11', rating: 5, comments: '' }, { kpi_id: 'k12', rating: 3, comments: '' }, { goal_id: 'g2', rating: 1 }])
  assert.deepEqual(Object.keys(rate), ['k11', 'k12'])
  const cmp = L.compareFor(lines, rate)
  assert.equal(cmp.total, 3)
  assert.equal(cmp.rated, 2)
  assert.equal(cmp.missingReasons.length, 1) // 3 against their 4
  assert.equal(cmp.missingReasons[0].title, '1. Ship it · Latency')
  const p = L.kraProgress(lines[0], rate)
  assert.deepEqual({ done: p.done, of: p.of, full: p.full, rollup: p.rollup }, { done: 2, of: 3, full: false, rollup: 4 })
  const chip = L.kraChip(lines[0], cmp)
  assert.deepEqual(chip, { rated: 2, of: 3, needs: true, done: false })
})

const pipOff = { wanted: false, reason: '', proposedStart: '2026-11-09', proposedEnd: '2027-02-07' }
const recOff = { wanted: false, kind: 'BONUS', note: '' }

test('the approval gate: every measure, every reason, the remark, the tick and the final rating', () => {
  const lines = [{ goalId: 'g', seqNo: 1, title: 'A', weightage: 100, kpis: [{ kpiId: 'k', seqNo: 1, metric: 'm', share: 100, selfRating: 3 }] }]
  const base = { alreadyConfirmed: false, confirmed: false, finalises: false, finalRating: '', bands: DEFAULT_BANDS, overall: '', training: [L.EMPTY_TRAINING], pip: pipOff, recog: recOff }
  let g = L.panelGate({ ...base, cmp: L.compareFor(lines, {}) })
  assert.equal(g.ready, false)
  assert.equal(g.allRated, false)
  assert.equal(g.ticked, false)
  const rated = L.compareFor(lines, { k: { rating: 3, comment: '' } })
  g = L.panelGate({ ...base, cmp: rated, confirmed: true })
  assert.equal(g.allRated, true)
  assert.equal(g.reasoned, true)
  assert.equal(g.remark.ok, false) // a 3 owes an overall remark
  g = L.panelGate({ ...base, cmp: rated, confirmed: true, overall: 'x'.repeat(g.remark.need) })
  assert.equal(g.ready, true)
  // the rung that finalises must also give the final rating, inside the scale
  assert.equal(L.panelGate({ ...base, cmp: rated, alreadyConfirmed: true, overall: 'x'.repeat(400), finalises: true }).frOk, false)
  assert.equal(L.panelGate({ ...base, cmp: rated, alreadyConfirmed: true, overall: 'x'.repeat(400), finalises: true, finalRating: '4' }).ready, true)
  // a half-filled training row and a ticked PIP with no reason both block
  const t = L.panelGate({ ...base, cmp: rated, confirmed: true, overall: 'x'.repeat(400), training: [{ trainingName: '', category: 'TECHNICAL', details: 'why' }] })
  assert.equal(t.trainingFaults.length, 1)
  assert.equal(t.ready, false)
  const p = L.panelGate({ ...base, cmp: rated, confirmed: true, overall: 'x'.repeat(400), pip: { ...pipOff, wanted: true } })
  assert.ok(p.pipFault)
})

test('the training context carries this rater’s rolled-up rating per KRA, read on kpi_id', () => {
  const lines = L.kraLinesOf(goals, kpis, [])
  const rate = { k11: { rating: 4, comment: 'fast' }, k12: { rating: 2, comment: '' }, k13: { rating: null, comment: 'later' } }
  const ctx = L.trainingContext({ name: 'A B', code: 'X1' }, lines, rate, L.compareFor(lines, rate), { overall: 'ok', bands: DEFAULT_BANDS, pip: pipOff, recog: recOff })
  assert.equal(ctx.kras[0].rating, 3)
  assert.equal(ctx.kras[0].comment, 'fast · later')
  assert.equal(ctx.kras[1].rating, null)
  assert.equal(ctx.scaleMax, 5)
  assert.equal(ctx.pipReason, null)
})

test('a queue is grouped on what is owed, first sentence as the heading, order kept', () => {
  const r = (id, next) => ({ member: { employeeId: id }, next })
  const g = L.groupQueue([r('a', 'No KRAs written yet. They cannot be rated.'), r('b', 'Your rating is owed.'), r('c', 'No KRAs written yet. They cannot be rated.')])
  assert.deepEqual(g.map(x => [x.head, x.why, x.rows.length]), [['No KRAs written yet.', 'They cannot be rated.', 2], ['Your rating is owed.', '', 1]])
})

test('published results are the released rows, newest first', () => {
  const m = [{ employeeId: 'a', published: true, publishedAt: '2026-10-01' }, { employeeId: 'b', published: false }, { employeeId: 'c', published: true, publishedAt: '2026-10-28' }]
  assert.deepEqual(L.publishedFirst(m).map(x => x.employeeId), ['c', 'a'])
})

test('the score ramp blends in oklab: bottom is the low stop, top the high, middle the mid', () => {
  const stops = { low: '#C0201F', mid: '#EAB308', high: '#16A34A' }
  assert.equal(L.toneColour(1, DEFAULT_BANDS, stops), '#C0201F')
  assert.equal(L.toneColour(3, DEFAULT_BANDS, stops), '#EAB308')
  assert.equal(L.toneColour(5, DEFAULT_BANDS, stops), '#16A34A')
  assert.equal(L.toneColour(null, DEFAULT_BANDS, stops), null)
  const four = L.toneColour(4, DEFAULT_BANDS, stops)
  assert.match(four, /^#[0-9A-F]{6}$/)
  assert.notEqual(four, '#EAB308')
  assert.equal(L.mixOklab('#000000', '#FFFFFF', 0), '#000000')
  assert.equal(L.mixOklab('#000000', '#FFFFFF', 100), '#FFFFFF')
  assert.equal(L.mixOklab('rgba(0,0,0,.5)', '#FFFFFF', 50), 'rgba(0,0,0,.5)')
})
