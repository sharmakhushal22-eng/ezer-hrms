// lib/analytics/__tests__/briefs.test.ts — what moved, the written pieces, and what the
// number check lets back from the model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moverWindow, computeMovers, type MoverInput } from '../movers.ts'
import { explainMover, briefingFallback, mondayFallback, summaryFallback, questionFor, openerFor, notable } from '../briefs.ts'
import { resolveTopic, explainFallback } from '../topics.ts'
import { briefingTask, explainTask, mondayTask, summaryTask, moverFacts } from '../ai/tasks.ts'
import type { EmpLite, AttRec } from '../metrics.ts'
import type { MoverSet, OrgAnalytics, TeamAnalytics, MyAnalytics } from '../types.ts'

const TODAY = '2026-11-14'

test('the windows compare like with like', () => {
  const m = moverWindow('mtd', TODAY), l = moverWindow('last', TODAY)
  assert.deepEqual([m.from, m.to, m.prevFrom, m.prevTo], ['2026-11-01', '2026-11-14', '2026-10-01', '2026-10-14'])
  assert.equal(m.label, '1–14 Nov against 1–14 Oct')
  assert.deepEqual([l.from, l.to, l.prevFrom, l.prevTo], ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30'])
  assert.equal(l.label, 'October against September')
  assert.equal(moverWindow('mtd', '2026-03-31').prevTo, '2026-02-28', 'a short month is not overrun')
})

// Two departments; Sales gets much later in October, Ops stays the same.
const emp = (id: string, dept: string, extra: Partial<EmpLite> = {}): EmpLite => ({
  id, code: id, name: `Person ${id}`, company_id: 'c', department_id: dept, location_id: 'pune', designation: null, grade: null,
  type: 'Employee', gender: null, dob: null, doj: '2024-01-01', exit: null, status: 'Active', l1: null, confirmation: null,
  probationMonths: null, confirmationDate: null, ...extra,
} as EmpLite)
function input(): MoverInput {
  const emps = [...Array.from({ length: 6 }, (_, i) => emp(`s${i}`, 'Sales')), ...Array.from({ length: 6 }, (_, i) => emp(`o${i}`, 'Ops')), emp('x1', 'Sales', { exit: '2026-10-20' })]
  const att: AttRec[] = []
  const day = (d: string, id: string, late: number): AttRec => ({ employee_id: id, attendance_date: d, work_in: `${d}T04:00:00Z`, work_out: `${d}T12:00:00Z`, total_minutes: 480, late_minutes: late, overtime_minutes: 0, status: 'PRESENT' })
  for (const [month, salesLate] of [['2026-09', 0], ['2026-10', 1]] as const) {
    for (let d = 1; d <= 10; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`
      for (let i = 0; i < 6; i++) { att.push(day(date, `s${i}`, salesLate && i < 4 ? 12 : 0)); att.push(day(date, `o${i}`, 0)) }
    }
  }
  return {
    today: TODAY, emps, att, approved: [], candidates: [], runs: null,
    dept: e => e.department_id || 'Unassigned', loc: () => 'Pune', reason: () => 'Better pay', kind: () => 'Voluntary', leaveType: c => c,
  }
}

test('a fall in punctuality is traced to the department that moved', () => {
  const set = computeMovers(input(), 'last')
  const ot = set.items.find(m => m.key === 'ontime')!
  assert.equal(ot.before, 100)
  assert.equal(ot.now, 66.7, 'four of twelve people late every day in October')
  const dept = ot.by.find(b => b.dim === 'department')!
  assert.equal(dept.rows[0].label, 'Sales', 'the largest effect first')
  assert.equal(dept.rows[0].delta, -66.7)
  assert.equal(dept.rows[0].effect, -33.3, 'weighted by Sales\' half of the punch-ins')
  assert.equal(dept.rows[1].effect, 0)
  const ex = set.items.find(m => m.key === 'exits')!
  assert.deepEqual([ex.now, ex.before], [1, 0])
  const e = explainMover(ot, set.window)
  assert.match(e.summary, /On-time punch-ins fell from 100\.0% to 66\.7% \(down 33\.3 points\), October against September/)
  assert.match(e.reasons[0], /Sales \(100\.0% → 33\.3%\)/)
  assert.equal(questionFor(ot), 'Why did on-time punch-ins fall 33.3 points?')
})

const orgOf = (set: MoverSet) => ({
  generatedAt: '', access: { cost: false, people: true }, movers: { mtd: set, last: set },
  scope: { company: null, companyLabel: 'All group companies', department: null, location: null, type: null, period: { key: 'last_12', label: 'Last 12 months', from: '2025-12-01', to: TODAY, months: [] }, previous: { from: '', to: '' }, trend: [], today: TODAY },
  filters: { companies: [{ id: 'c', label: 'Co' }], departments: [], locations: [], types: [], canPickGroup: false },
  pulse: { kpis: [{ key: 'ontime', label: 'On-time punch-ins', value: 66.7, fmt: 'pct' }], changes: [], flow: [], insights: [
    { id: 'late-mon', severity: 'warning', area: 'attendance', title: 'Mondays are late', detail: '18% against 9%.' },
    { id: 'rest', severity: 'info', area: 'leave', title: '30 people have not taken leave', detail: 'In 90 days.' },
  ] },
  workforce: { headcount: 12, byDepartment: [], byLocation: [], byType: [], gender: [], tenure: [], age: [], span: { managers: 0, avgSpan: null, medianSpan: null, narrow: 0, wide: 0, distribution: [] }, probation: { onProbation: 0, overdueCount: 0, dueSoonCount: 0, overdue: [], dueSoon: [] }, noManager: 0 },
  attrition: { avgHeadcount: 0, byDepartment: [], reasons: [], tenureAtExit: [], risk: [], pipeline: [], recentExits: [], pipelineCount: 0, early90: { cohort: 0 }, early180: { cohort: 0 } },
  attendance: { coverage: { headcount: 0, tracked: 0 }, summary: { punchedIn: 0 }, monthly: [], weekday: [], byDepartment: [], regularisation: { total: 0 }, lateList: [] },
  leave: { days: 0, byType: [], bridge: { spells: 0 }, weekdayStarts: [], monthly: [], pending: { count: 0 }, noLeave90: { of: 0, count: 0, people: [] }, balances: [], bradford: [] },
  performance: { cycle: null, managerSkew: [], pip: { active: 0, requested: 0 }, recognitions: 0, trainingAsks: [], byDepartment: [] },
  learning: { enrolments: 0, byDepartment: [] },
  hiring: { openMrfs: 0, openPositions: 0, mrfAge: [], oldestMrfs: [], funnel: [], candidates: 0, offers: { made: 0, accepted: 0, declined: 0, backout: 0 }, sources: [], joiningSoon: [], monthlyApplicants: [] },
  cost: null,
}) as unknown as OrgAnalytics

test('the template briefing names the change, where it came from, and three things at most', () => {
  const set = computeMovers(input(), 'last')
  const b = briefingFallback(orgOf(set), set)
  assert.equal(b.source, 'rules')
  assert.equal(b.changes[0].title, 'On-time punch-ins down 33.3 points')
  assert.equal(b.changes[0].good, false)
  assert.match(b.causes[0].text, /by department, the largest part of the change came from Sales/)
  assert.ok(b.actions.length <= 3 && b.actions.length >= 1)
  assert.equal(b.actions[0].area, 'attendance', 'the warning comes first')
  assert.ok(notable(set.items.find(m => m.key === 'ontime')!))
})

test('the model\'s briefing keeps what is grounded and drops what is invented', () => {
  const set = computeMovers(input(), 'last')
  const d = orgOf(set)
  const base = briefingFallback(d, set)
  const task = briefingTask(d, set, base, ['workforce', 'attrition', 'attendance', 'performance', 'hiring'])
  assert.match(task.system, /TASK: executive briefing/)
  assert.ok(task.user.includes('[mv.ontime.department]'), 'the breakdowns are on the sheet')
  const raw = JSON.stringify({
    headline: 'Punctuality fell 33.3 points in October.',
    changes: [
      { title: 'On-time punch-ins down 33.3 points', detail: '66.7% against 100.0%.', area: 'attendance', direction: 'down', facts: ['mv.ontime'] },
      { title: 'One exit', detail: 'Exits rose from 0 to 1.', area: 'attrition', direction: 'up', facts: ['mv.exits'] },
      { title: 'Leave up 40%', detail: 'Invented.', area: 'leave', direction: 'up', facts: ['mv.ontime'] },
    ],
    causes: [{ text: 'Sales likely drove it: 33.3% against 100.0%.', area: 'attendance', facts: ['mv.ontime.department'] }],
    actions: [{ action: 'Review late marks with the Head of Sales', owner: 'HR business partner', when: 'This week', why: 'Sales fell 66.7 points.', area: 'attendance', facts: ['mv.ontime.department'] },
      { action: 'Hold an exit review', owner: 'HR', when: 'This month', why: 'One exit.', area: 'attrition', facts: ['mv.exits'] }],
  })
  const b = task.parse(raw, 'gemini-test')!
  assert.equal(b.source, 'ai')
  assert.equal(b.changes.length, 2, 'the change with an invented 40% is dropped')
  assert.equal(b.dropped, 1)
  assert.equal(b.changes[0].topic, 'm:ontime', 'a change knows its "Why?"')
  assert.equal(b.actions.length, 3, 'topped up to three from the template')
  assert.equal(task.parse(JSON.stringify({ headline: 'x', changes: [], actions: [] }), 'm'), null, 'too little left: the template is used')
})

test('the model never hears about a tab its reader cannot open', () => {
  const set = computeMovers(input(), 'last')
  const d = orgOf(set)
  const t = briefingTask(d, set, briefingFallback(d, set), ['hiring'])
  assert.ok(!t.pack.facts.some(f => f.area === 'attendance'), 'attendance facts are cut')
})

test('"Why?" resolves tiles, charts and findings, and refuses keys it does not know', () => {
  const set = computeMovers(input(), 'last')
  const d = orgOf(set)
  assert.equal(resolveTopic('k:ontime', d, set)?.movers[0].key, 'ontime')
  assert.equal(resolveTopic('c:att-heat', d, set)?.title, 'Where and when people are late')
  assert.equal(resolveTopic('i:late-mon', d, set)?.question, 'Why: Mondays are late?')
  assert.equal(resolveTopic('c:nope', d, set), null)
  assert.equal(resolveTopic('x:anything', d, set), null)
  const base = explainFallback(resolveTopic('c:wf-gender', d, set)!, set, d)
  assert.match(base.summary, /not compared month to month/)
  const r = resolveTopic('m:ontime', d, set)!
  const t = explainTask(d, set, explainFallback(r, set, d), r.area, ['attendance'])
  assert.match(t.user, /^QUESTION: Why did on-time punch-ins fall 33\.3 points\?/)
  const x = t.parse(JSON.stringify({ answer: 'Almost all of it came from Sales, at 33.3% against 100.0%.', facts: ['mv.ontime.department'], checks: ['Check the Pune biometric device', 'Look at 14 shifts'] }), 'm')!
  assert.equal(x.source, 'ai')
  assert.deepEqual(x.checks, ['Check the Pune biometric device'], 'a check may not bring in a figure')
  assert.equal(t.parse(JSON.stringify({ answer: 'Sales fell 50 points.', facts: ['mv.ontime.department'] }), 'm'), null)
})

const team = () => ({
  generatedAt: '', scope: 'TEAM', manager: { id: 'mgr', name: 'Shreya Kapoor' }, month: '2026-11', dates: [],
  members: [
    { id: 'a', code: 'A', name: 'Rohit Sen', designation: null, department: null, doj: '2024-01-01', today: 'PRESENT', todayIn: null, month: { present: 8, late: 0, absent: 0, leave: 0, miss: 0, workdays: 9, avgIn: 560, avgHours: 9 }, days: [], leave90: 2, lastLeave: '2026-10-01', balance: 8, rating: 'ME', pmsStage: null, onNotice: false, anniversary: null, birthday: null },
    { id: 'b', code: 'B', name: 'Asha Verma', designation: null, department: null, doj: '2024-01-01', today: 'PRESENT', todayIn: null, month: { present: 8, late: 5, absent: 0, leave: 0, miss: 0, workdays: 9, avgIn: 610, avgHours: 9 }, days: [], leave90: 0, lastLeave: null, balance: 12, rating: 'NI', pmsStage: null, onNotice: false, anniversary: null, birthday: null },
  ],
  today: { present: 2, late: 1, onLeave: 0, notIn: 0, off: false }, outThisWeek: [],
  health: { score: 70, parts: [] }, approvals: { leave: 2, regularisation: 1, oldestDays: 5 },
  performance: { cycle: null, distribution: [], awaitingYou: 0, companyTopShare: null, teamTopShare: null },
  signals: [{ id: 'b', code: 'B', name: 'Asha Verma', designation: null, department: null, level: 'medium', score: 3, signals: [{ code: 'LATE_SPIKE', label: 'Late marks rising', detail: '5 late.', weight: 1 }, { code: 'LOW_RATING', label: 'Low rating', detail: 'NI.', weight: 2 }] }],
  upcoming: [], insights: [],
}) as unknown as TeamAnalytics

test('the Monday note: the oldest wait first, and an opener by the strongest sign', () => {
  const n = mondayFallback(team(), TODAY)
  assert.equal(n.greeting, 'Hi Shreya, here is your team this week.')
  assert.equal(n.weekOf, '9 Nov 2026', 'the week starts on Monday')
  assert.match(n.summary, /3 requests waiting on you \(oldest 5 days\)/)
  assert.match(n.focus, /^Clear the 3 requests/)
  assert.equal(n.openers[0].name, 'Asha Verma')
  assert.equal(n.openers[0].opener, openerFor(team().signals[0]), 'low rating outweighs late marks')
  assert.match(n.openers[0].opener, /support would help you most/)
})

test('the model\'s Monday note: names come back, figures stay out of openers, strangers are ignored', () => {
  const d = team()
  const t = mondayTask(d, mondayFallback(d, TODAY), TODAY)
  assert.ok(!t.user.includes('Asha') && !t.user.includes('Rohit'), 'no names reach the model')
  assert.match(t.system, /for each of these people only: P2/)
  const n = t.parse(JSON.stringify({
    summary: 'Two of your team are in today and 2 leave requests are waiting.', focus: 'Clear the requests first.',
    openers: [{ person: 'P2', opener: 'How are mornings going for you, P2? Anything I can help with?' }, { person: 'P1', opener: 'Hello' }],
  }), 'm')!
  assert.equal(n.openers.length, 1)
  assert.equal(n.openers[0].opener, 'How are mornings going for you, Asha Verma? Anything I can help with?', 'the token becomes the name after the check')
  const bad = t.parse(JSON.stringify({ summary: '', focus: '', openers: [{ person: 'P2', opener: 'You were late 5 times.' }] }), 'm')
  assert.equal(bad, null, 'an opener quoting a figure is not kept')
})

test('the employee summary: three lines and one nudge, all from their own figures', () => {
  const d = {
    generatedAt: '', me: { id: 'e1', name: 'Asha Verma', doj: '2024-01-01', tenureYears: 2.9, designation: 'Lead', department: 'Sales' },
    attendance: { from: '', to: '', days: [], monthly: [], thisMonth: { present: 8, late: 1, absent: 0, leave: 0, workdays: 9, onTimeRate: 88.9, avgIn: 580, avgHours: 9 }, streak: 4, team: { onTimeRate: 80, avgIn: 590, avgHours: 9, size: 6 } },
    leave: { balances: [{ key: 'EL', label: 'Earned Leave', available: 20, used: 2, accrued: 22, lapse: 5 }], taken: [], takenThisFy: 2, lastLeave: null, upcoming: [] },
    pay: { ctc: null, ctcFy: null, months: [], split: [] },
    performance: { history: [], current: { cycle: 'Q2', name: 'Q2 2026-27', stage: 'Goals set', goals: 4, weightage: 100 } },
    learning: { enrolled: 0, completed: 0, inProgress: 0, overdue: 0, recent: [] }, recognition: { kudos: 0, awards: 0 }, milestones: [],
    nudges: [{ id: 'lapse', severity: 'warning', area: 'leave', title: '5 Earned Leave days above the carry-forward limit', detail: 'Plan some time off before 31 March.' }],
  } as unknown as MyAnalytics
  const s = summaryFallback(d)
  assert.equal(s.lines.length, 3)
  assert.match(s.lines[0].text, /8 of 9 working days.*ahead of your team/)
  assert.match(s.lines[1].text, /^5 Earned Leave days are above the carry-forward limit/)
  assert.match(s.lines[2].text, /Q2 2026-27 review is at "Goals set" with 4 goals/)
  assert.match(s.nudge!.text, /^5 Earned Leave days/)
  const t = summaryTask(d, s, TODAY)
  const ai = t.parse(JSON.stringify({ lines: [
    { text: 'You were in 8 of 9 days — nicely done.', area: 'attendance', facts: ['me.month'] },
    { text: 'You have 20 days of earned leave waiting.', area: 'leave', facts: ['me.balances'] },
    { text: 'Your review has 7 goals.', area: 'performance', facts: ['me.cycle'] },
  ], nudge: { text: 'Book a few days off before March.', area: 'leave', facts: ['me.balances'] } }), 'm')!
  assert.equal(ai.lines.length, 3, 'the invented line is replaced by the template\'s')
  assert.equal(ai.lines[2].text, s.lines[2].text)
  assert.equal(ai.dropped, 1)
})

test('mover facts carry groups, never people', () => {
  const set = computeMovers(input(), 'last')
  const text = moverFacts(set).map(f => f.text).join('\n')
  assert.ok(!/Person s\d/.test(text))
  assert.match(text, /Sales 33\.3% against 100\.0% \(down 66\.7 points, 60 punch-ins\)/)
})
