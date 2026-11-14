// lib/analytics/__tests__/ai.test.ts — the fact sheets and the number check. The written
// pieces built on them are tested in briefs.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numbersIn, allowedNumbers, grounded, clean, parseJsonLoose } from '../ai/validate.ts'
import { orgFacts, teamFacts, myFacts } from '../ai/facts.ts'
import type { FactPack } from '../ai/types.ts'
import type { OrgAnalytics, TeamAnalytics, MyAnalytics } from '../types.ts'

const pack = (over: Partial<FactPack> = {}): FactPack => ({
  audience: 'org', scopeKey: 'x', context: 'Period: Last 12 months. Today is 13 Nov 2026.',
  facts: [
    { id: 'kpi.attrition', area: 'attrition', text: 'Attrition (annualised): 9.1% (previous period 12.4%)' },
    { id: 'at.dept.sales', area: 'attrition', text: 'Attrition in Sales: 6 exits on 40 people, 15% for the period — 2.3 times the organisation\'s 6.5%' },
    { id: 'att.summary', area: 'attendance', text: 'On-time punch-ins 85.3%; typical first punch 9:47 AM' },
    { id: 'cs.latest', area: 'cost', text: 'Payroll cost to company ₹1.24 Cr; 1,240 employees' },
  ],
  signals: [{ id: 'sig.late', area: 'attendance', text: '[warning] Mondays are late. 18% against 9%.' }],
  areas: ['attrition', 'attendance', 'cost', 'workforce'], noteAreas: ['attrition', 'attendance'],
  aliases: {}, ...over,
})

test('numbers are read the way the page prints them', () => {
  assert.deepEqual(numbersIn('85.3% of ₹1.24 Cr, 1,240 people at 9:47 AM'), [85.3, 1.24, 1240, 9, 47])
  assert.deepEqual(numbersIn('P3 and P12 were late 4 times'), [4], 'person tokens are not numbers')
  assert.deepEqual(numbersIn('Indian grouping 1,23,456'), [123456])
})

test('a sentence may repeat or round a figure on the sheet, never invent one', () => {
  const ok = allowedNumbers(pack())
  assert.ok(grounded('On time 85.3%, or about 85%', ok), 'rounding is allowed')
  assert.ok(grounded('Sales attrition is 2.3 times the 6.5% average', ok))
  assert.ok(!grounded('2 departments', ok) && !grounded('two departments', ok), 'no number is free, digits or words')
  assert.ok(grounded('one department stands out', ok), '"one" is a pronoun more often than a count')
  assert.ok(grounded('Sales attrition is 2.3 times the 6.5% average and twelve months of data', ok), 'number words on the sheet (12 in "Last 12 months") are allowed')
  assert.ok(!grounded('Payroll is about 1 crore', ok), '₹1.24 Cr does not license a bare 1 — below 10 a figure keeps its decimal')
  assert.ok(grounded('about 12% previously', ok), '12.4 may be written 12')
  assert.ok(!grounded('Sales attrition is 3 times the average', ok), 'an invented multiple is refused')
  assert.ok(!grounded('Attrition rose 3.3 points', ok), 'a computed difference is refused')
  assert.ok(!grounded('Industry average is 16%', ok), 'an outside statistic is refused')
})

test('clean strips markdown and fact ids and caps the length', () => {
  assert.equal(clean('**Sales** attrition is high [at.dept.sales].', 200), 'Sales attrition is high.')
  assert.equal(clean('High (kpi.attrition, at.flow) today', 200), 'High today')
  const long = clean('word '.repeat(100), 40)
  assert.ok(long.length <= 41 && long.endsWith('…'))
  assert.equal(clean(42, 10), '')
})

test('a small number is checked like any other — "0 goals" for someone with 4 is refused', () => {
  const ok = allowedNumbers({ context: '', facts: [{ id: 'me.cycle', area: 'performance', text: 'Current review cycle Q2 2026-27: stage Self review, 4 goals set' }], signals: [] })
  assert.equal(grounded('The Q2 cycle shows 0 goals set.', ok), false)
  assert.equal(grounded('The Q2 cycle shows four goals set.', ok), true, 'the true count passes, as a word too')
  assert.equal(grounded('The Q2 cycle shows five goals set.', ok), false, 'a wrong count in words is refused')
  assert.equal(grounded('Agree them within two weeks.', ok, false), true, 'advice may use number words')
})

test('JSON is found inside a code fence or a sentence', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Here you go: {"a":2} hope that helps'), { a: 2 })
  assert.equal(parseJsonLoose('no json'), null)
  assert.equal(parseJsonLoose('[1,2]'), null)
})

// ── Fixtures: just enough of each payload ────────────────────────────────────

const ref = (id: string, name: string) => ({ id, code: `C-${id}`, name, designation: 'Executive', department: 'Sales' })

function orgFixture(): OrgAnalytics {
  const b = (label: string, value: number) => ({ key: label, label, value })
  return {
    generatedAt: '2026-11-13T00:00:00Z',
    scope: { company: null, companyLabel: 'All group companies', department: null, location: null, type: null,
      period: { key: 'last_12', label: 'Last 12 months', from: '2025-12-01', to: '2026-11-13', months: [] },
      previous: { from: '2024-12-01', to: '2025-11-30' }, trend: [], today: '2026-11-13' },
    filters: { companies: [{ id: 'c1', label: 'Co' }], departments: [], locations: [], types: [], canPickGroup: true },
    access: { cost: false, people: true },
    pulse: { kpis: [{ key: 'attrition', label: 'Attrition (annualised)', value: 9.1, fmt: 'pct', prev: 12.4 }], insights: [{ id: 'x', severity: 'warning', area: 'attrition', title: 'Sales is losing people', detail: 'Ravi Kumar and 3 others.' }, { id: 'skew-m1', severity: 'info', area: 'performance', title: 'Anita Bose rates more generously than the organisation', detail: '8 rated.' }], changes: [], flow: [] },
    workforce: { headcount: 400, byCompany: [], byDepartment: [b('Sales', 40), b('Ops', 60)], byLocation: [], byType: [], byGrade: [], gender: [b('Male', 300)], genderByDepartment: [], age: [], tenure: [], avgTenure: 3.2,
      span: { managers: 40, avgSpan: 6, medianSpan: 5, narrow: 4, wide: 1, distribution: [] },
      probation: { onProbation: 20, dueSoonCount: 3, overdueCount: 5, dueSoon: [ref('e9', 'Meena Iyer')], overdue: [ref('e8', 'Arjun Rao')] }, noManager: 2 },
    attrition: { flow: [], exits: 30, avgHeadcount: 400, rate: 7.5, annualised: 9.1, prevAnnualised: 12.4, voluntary: 20, involuntary: 10, unclassified: 0, regretted: 5,
      early90: { cohort: 50, left: 4, rate: 8 }, early180: { cohort: 40, left: 6, rate: 15 }, reasons: [{ key: 'r', label: 'Better pay', category: 'x', value: 8 }], categories: [],
      byDepartment: [{ key: 's', label: 'Sales', exits: 6, headcount: 40, rate: 15 }, { key: 't', label: 'Tiny', exits: 2, headcount: 3, rate: 66.7 }], tenureAtExit: [], pipelineCount: 4,
      pipeline: [{ ...ref('e7', 'Kiran Shah'), stage: 'With HR', lwd: null, regrettable: true }], recentExits: [{ ...ref('e6', 'Ravi Kumar'), lwd: '2026-10-01', reason: 'Pay', tenureYears: 1, kind: 'Voluntary' }],
      risk: [{ ...ref('e5', 'Sunita Das'), level: 'high', score: 4, signals: [{ code: 'LOW_RATING', label: 'Low rating', detail: 'Rated NI.', weight: 2 }, { code: 'LATE_SPIKE', label: 'Late marks rising', detail: '5 late.', weight: 1 }] }] },
    attendance: { window: { from: '2026-08-14', to: '2026-11-13', capped: true }, coverage: { tracked: 300, headcount: 400 },
      summary: { tracked: 300, days: 9000, punchedIn: 8000, late: 1200, onTimeRate: 85, lateRate: 15, missPunch: 100, missPunchRate: 1.1, halfDays: 20, avgHours: 8.6, medianIn: 587, overtimeHours: 0 },
      prevOnTime: 82, monthly: [], weekday: [], heat: { rows: [], cols: [] }, byDepartment: [], lateList: [{ ...ref('e4', 'Pooja Nair'), late: 9, days: 40 }], regularisation: { total: 0, approved: 0, rejected: 0, pending: 0, approvalRate: null } },
    leave: { days: 2800, perHead: 7, byType: [], monthly: [], unplannedShare: 42, bridge: { spells: 0, bridging: 0, share: null }, weekdayStarts: [], pending: { count: 0, olderThan3: 0, oldestDays: null },
      bradford: [{ ...ref('e3', 'Vikram Joshi'), spells: 6, days: 8, score: 288 }], noLeave90: { count: 30, of: 300, people: [{ ...ref('e2', 'Neha Gupta'), balance: 12 }] }, balances: [] },
    performance: { cycles: [], cycle: null, enrolled: 0, stages: [], completion: null, rated: 0, distribution: [], topShare: null, avgGap: null, byDepartment: [], managerSkew: [{ ...ref('m1', 'Anita Bose'), rated: 8, avg: 4.4, diff: 0.9 }], pip: { active: 0, requested: 0 }, recognitions: 0, trainingAsks: [] },
    learning: { enrolments: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0, completion: null, mandatoryCompletion: null, avgScore: null, byDepartment: [] },
    hiring: { openMrfs: 3, openPositions: 5, mrfAge: [], oldestMrfs: [], funnel: [], candidates: 0, rejected: 0, sources: [], offers: { made: 0, accepted: 0, backout: 0, declined: 0, acceptance: null }, timeToOffer: null, joiningSoon: [{ name: 'Rahul Menon', designation: null, doj: '2026-11-20', department: null }], monthlyApplicants: [] },
    cost: null,
  } as OrgAnalytics
}

test('the organisation sheet carries no names and no small departments', () => {
  const p = orgFacts(orgFixture())
  const text = [p.context, ...p.facts.map(f => f.text), ...p.signals.map(f => f.text)].join('\n')
  for (const name of ['Meena Iyer', 'Arjun Rao', 'Kiran Shah', 'Ravi Kumar', 'Sunita Das', 'Pooja Nair', 'Vikram Joshi', 'Neha Gupta', 'Rahul Menon', 'Anita Bose', 'C-e5']) {
    assert.ok(!text.includes(name), `${name} must not reach the model`)
  }
  assert.ok(text.includes('Attrition in Sales: 6 exits on 40 people, 15% for the period — 2.0 times'), 'the ratio is stated so the model need not compute it')
  assert.ok(!text.includes('Tiny'), 'a 3-person department is left out')
  assert.ok(text.includes('1 people at high risk'), 'risk arrives as a count')
  assert.deepEqual(p.noteAreas, ['workforce', 'attrition', 'attendance', 'performance', 'hiring'], 'no cost note without pay access')
  assert.ok(!p.areas.includes('cost'))
  assert.equal(p.signals[0].text, '[warning] Sales is losing people. An employee and 3 others.', 'a name inside a rule sentence is scrubbed')
  assert.equal(p.signals[1].text, '[info] One manager rates more generously than the organisation. 8 rated.')
})

test('a team sheet names nobody — tokens only — and drops birthdays', () => {
  const m = (id: string, name: string, late: number) => ({
    ...ref(id, name), doj: '2024-01-01', today: 'PRESENT' as const, todayIn: null,
    month: { present: 10, late, absent: 0, leave: 0, miss: 0, workdays: 12, avgIn: 590, avgHours: 8.5 }, days: [],
    leave90: 0, lastLeave: null, balance: 10, rating: 'ME', pmsStage: null, onNotice: false, anniversary: null, birthday: '2026-11-20',
  })
  const d = {
    generatedAt: '', scope: 'TEAM', manager: { id: 'mgr', name: 'Shreya Kapoor' }, month: '2026-11', dates: [],
    members: [m('b', 'Asha Verma', 5), m('a', 'Rohit Sen', 0)],
    today: { present: 2, late: 1, onLeave: 0, notIn: 0, off: false }, outThisWeek: [{ name: 'Rohit Sen', type: 'CL', from: '2026-11-14', to: '2026-11-14', days: 1 }],
    health: { score: 74, parts: [] }, approvals: { leave: 1, regularisation: 0, oldestDays: 2 },
    performance: { cycle: null, distribution: [], awaitingYou: 0, companyTopShare: null, teamTopShare: null },
    signals: [{ ...ref('b', 'Asha Verma'), level: 'medium', score: 2, signals: [{ code: 'X', label: 'Late marks rising', detail: 'Shreya Kapoor noted Asha Verma was late.', weight: 1 }] }],
    upcoming: [{ kind: 'birthday', name: 'Asha Verma', date: '2026-11-20', note: 'Birthday' }, { kind: 'probation', name: 'Rohit Sen', date: '2026-12-01', note: 'Probation ends' }],
    insights: [{ id: 'late', severity: 'info', area: 'attendance', title: '1 person has 4+ late marks', detail: 'Asha Verma (5).' }],
  } as TeamAnalytics
  const p = teamFacts(d, '2026-11-13')
  const text = [p.context, ...p.facts.map(f => f.text), ...p.signals.map(f => f.text)].join('\n')
  for (const name of ['Asha Verma', 'Rohit Sen', 'Shreya Kapoor', 'C-a', 'C-b']) assert.ok(!text.includes(name), `${name} must not reach the model`)
  assert.ok(!/birthday/i.test(text), 'birthdays stay off the sheet')
  assert.deepEqual(p.aliases, { P1: 'Rohit Sen', P2: 'Asha Verma' }, 'tokens follow id order, so they are stable')
  assert.ok(text.includes('P2 (5)'), 'rule text is re-written with tokens')
  assert.ok(text.includes('People on approved leave in the next 7 days: 1 — P1 (CL, 1 days)'))
  assert.ok(text.includes('Probation decisions due or overdue: 1 — P1 (probation ends, 1 Dec 2026)'), 'counted per kind')
  assert.ok(text.includes('you noted P2 was late'), 'the manager is "you"')
})

test('an employee sheet has no name, code, department or birthday', () => {
  const d = {
    generatedAt: '', me: { id: 'e1', name: 'Asha Verma', doj: '2024-01-01', tenureYears: 2.9, designation: 'Lead', department: 'Sales' },
    attendance: { from: '', to: '', days: [], monthly: [], thisMonth: { present: 8, late: 1, absent: 0, leave: 0, workdays: 9, onTimeRate: 88, avgIn: 580, avgHours: 9 }, streak: 4, team: null },
    leave: { balances: [{ key: 'EL', label: 'Earned Leave', available: 20, used: 2, accrued: 22, lapse: 5 }], taken: [], takenThisFy: 2, lastLeave: null, upcoming: [] },
    pay: { ctc: 1200000, ctcFy: '2026-27', months: [], split: [] },
    performance: { history: [], current: null }, learning: { enrolled: 0, completed: 0, inProgress: 0, overdue: 0, recent: [] },
    recognition: { kudos: 0, awards: 0 }, milestones: [{ label: 'Birthday', date: '2026-11-20', note: '' }, { label: '3 years at work', date: '2027-01-01', note: '' }], nudges: [],
  } as MyAnalytics
  const p = myFacts(d, '2026-11-13')
  const text = [p.context, ...p.facts.map(f => f.text)].join('\n')
  for (const s of ['Asha', 'Sales', 'Lead', 'Birthday', '20 Nov']) assert.ok(!text.includes(s), `${s} must not reach the model`)
  assert.ok(text.includes('3 years at work on 1 Jan 2027'))
  assert.ok(text.includes('5 above the carry-forward limit'))
})

