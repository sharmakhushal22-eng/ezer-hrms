// lib/analytics/__tests__/access.test.ts — who sees which slice of People Analytics.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rowApplies, rowTabs, accessFromRow, roleAccess, allows, allowedPick, limitLabel, redactTabs, restrictPack, ORG_TABS, type AccessRow,
} from '../access.ts'
import type { OrgAnalytics } from '../types.ts'
import type { FactPack } from '../ai/types.ts'

const row = (over: Partial<AccessRow> = {}): AccessRow => ({
  employee_id: 'e1', company_ids: ['c1'], locations: ['Pune Branch'], departments: null, employment_types: null,
  tabs: null, see_names: true, see_pay: false, can_export: true, valid_until: null, is_active: true, ...over,
})

test('a row applies while active and until its last day, inclusive', () => {
  assert.equal(rowApplies(row(), '2026-11-14'), true)
  assert.equal(rowApplies(row({ is_active: false }), '2026-11-14'), false)
  assert.equal(rowApplies(row({ valid_until: '2026-11-14' }), '2026-11-14'), true, 'the last day still counts')
  assert.equal(rowApplies(row({ valid_until: '2026-11-13' }), '2026-11-14'), false)
  assert.equal(rowApplies(null, '2026-11-14'), false)
})

test('Pay & cost opens only with see_pay, whatever the tab list says', () => {
  assert.deepEqual(rowTabs(row()), ORG_TABS.filter(t => t !== 'cost'), 'no list = every tab but pay')
  assert.deepEqual(rowTabs(row({ see_pay: true })), [...ORG_TABS])
  assert.deepEqual(rowTabs(row({ tabs: ['cost', 'hiring'], see_pay: false })), ['hiring'])
  assert.deepEqual(rowTabs(row({ tabs: ['hiring', 'workforce'] })), ['workforce', 'hiring'], 'kept in page order')
  assert.deepEqual(rowTabs(row({ tabs: [] })), ORG_TABS.filter(t => t !== 'cost'), 'an empty list means no limit')
})

test('a grant carries its data limit; a role carries none', () => {
  const a = accessFromRow(row({ departments: ['Sales', ' ', 'Sales'], see_names: false, can_export: false, valid_until: '2027-03-31' }))
  assert.equal(a.via, 'grant')
  assert.deepEqual(a.limit, { companies: ['c1'], departments: ['Sales'], locations: ['Pune Branch'], types: null })
  assert.equal(a.people, false)
  assert.equal(a.export, false)
  assert.equal(a.cost, false)
  assert.equal(a.until, '2027-03-31')
  const r = roleAccess({ cost: false, people: true })
  assert.equal(r.limit, null)
  assert.ok(!r.tabs.includes('cost'))
})

test('a pick outside the limit is dropped, not honoured', () => {
  assert.equal(allows(null, 'Anything'), true)
  assert.equal(allows(['Pune Branch'], 'Pune Branch'), true)
  assert.equal(allows(['Pune Branch'], 'Mumbai Head Office'), false)
  assert.equal(allows(['Pune Branch'], null), false, 'no location is not "any location"')
  assert.equal(allowedPick(['Pune Branch'], 'Mumbai Head Office'), null)
  assert.equal(allowedPick(['Pune Branch'], 'Pune Branch'), 'Pune Branch')
  assert.equal(allowedPick(null, 'Mumbai Head Office'), 'Mumbai Head Office')
})

test('the limit in words', () => {
  const name = (id: string) => ({ c1: 'Sharma Textiles', c2: 'Sharma Retail' } as Record<string, string>)[id]
  assert.equal(limitLabel({ companies: ['c1'], locations: ['Pune Branch'], departments: ['Sales', 'IT', 'HR', 'Ops'], types: null }, name), 'Sharma Textiles · Pune Branch · Sales, IT, HR +1')
  assert.equal(limitLabel(null), '')
})

const payload = () => ({
  access: { cost: true, people: true },
  pulse: {
    kpis: [{ key: 'headcount' }, { key: 'attrition' }, { key: 'ontime' }, { key: 'open' }, { key: 'cost' }, { key: 'pms' }],
    changes: [{ key: 'headcount' }, { key: 'ontime' }, { key: 'applicants' }],
    insights: [{ area: 'attrition' }, { area: 'leave' }, { area: 'cost' }, { area: 'hiring' }],
    flow: [{ month: '2026-11' }],
  },
  workforce: { headcount: 400, byDepartment: [{ key: 'a' }], probation: { overdue: [{ name: 'Arjun Rao' }] } },
  attrition: { exits: 30, risk: [{ name: 'Sunita Das' }] },
  attendance: { summary: { onTimeRate: 85 }, lateList: [{ name: 'Pooja Nair' }] },
  leave: { days: 2800, bradford: [{ name: 'Vikram Joshi' }] },
  performance: { completion: 50, managerSkew: [{ name: 'Anita Bose' }] },
  learning: { enrolments: 9 },
  hiring: { openMrfs: 3, joiningSoon: [{ name: 'Rahul Menon' }] },
  cost: { latest: { gross: 100 } },
}) as unknown as OrgAnalytics

test('a tab outside the grant leaves no figure and no name in the payload', () => {
  const out = redactTabs(payload(), ['attendance', 'hiring'])
  const text = JSON.stringify(out)
  for (const name of ['Arjun Rao', 'Sunita Das', 'Anita Bose']) assert.ok(!text.includes(name), `${name} must not be sent`)
  assert.ok(text.includes('Pooja Nair') && text.includes('Rahul Menon'), 'allowed tabs keep their lists')
  assert.equal(out.workforce.headcount, null)
  assert.deepEqual(out.workforce.byDepartment, [])
  assert.equal(out.cost, null)
  assert.equal(out.leave.days, 2800, 'leave rides with Attendance & leave')
  assert.deepEqual(out.pulse.kpis.map(k => k.key), ['ontime', 'open'])
  assert.deepEqual(out.pulse.changes.map(k => k.key), ['ontime', 'applicants'])
  assert.deepEqual(out.pulse.insights.map(i => i.area), ['leave', 'hiring'])
  assert.deepEqual(out.pulse.flow, [], 'no headcount trend without Workforce or Attrition')
  assert.deepEqual(out.access.tabs, ['attendance', 'hiring'])
})

test('redacting does not touch the figures it was given', () => {
  const p = payload()
  redactTabs(p, ['hiring'])
  assert.equal(p.workforce.headcount, 400, 'the server keeps the full copy for the AI read')
})

test('the AI is told only about the tabs its reader can open', () => {
  const pack: FactPack = {
    audience: 'org', scopeKey: 'k', context: 'c', aliases: {},
    facts: [{ id: 'a', area: 'attrition', text: 'x' }, { id: 'b', area: 'leave', text: 'y' }, { id: 'c', area: 'cost', text: 'z' }],
    signals: [{ id: 's', area: 'performance', text: 'w' }],
    areas: ['attrition', 'leave', 'cost', 'performance'], noteAreas: ['attrition', 'attendance', 'cost'],
  }
  const p = restrictPack(pack, ['attendance'])
  assert.deepEqual(p.facts.map(f => f.id), ['b'])
  assert.deepEqual(p.signals, [])
  assert.deepEqual(p.areas, ['leave'])
  assert.deepEqual(p.noteAreas, ['attendance'])
  assert.notEqual(p.scopeKey, pack.scopeKey, 'a narrower read is cached apart from the full one')
})
