// lib/payroll/__tests__/payroll-screen.test.ts — the Payroll screen's header and Data Sync:
// Group Companies in every company filter, the header Month, Configuration only from the admin
// dashboard, no Lock / Unlock Month in Configuration, Data Sync without the Run Payroll rows
// and with the "updates waiting" counters, and the Salary calculator on the dashboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canPickGroup, emptyGrant } from '../../rms/resolve.ts'

const CO = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
const grant = (o: Record<string, unknown>) => ({ ...emptyGrant(), ...o }) as any
const src = (p: string) => readFileSync(p, 'utf8')

test('Group Companies is offered to whoever may see every company, never to a partial scope', () => {
  assert.equal(canPickGroup(grant({ crossCompany: true, companyId: 'A' }), CO), true, 'cross-company')
  assert.equal(canPickGroup(grant({ companyId: null }), CO), true, 'legacy login, no company gate')
  assert.equal(canPickGroup(grant({ companyId: 'A', companyIds: ['A', 'B', 'C'], companiesByModule: {} }), CO, null), true, 'roles valid in all three')
  assert.equal(canPickGroup(grant({ companyId: 'A', companyIds: ['A', 'B'], companiesByModule: {} }), CO, null), false, 'two of three')
  assert.equal(canPickGroup(grant({ companyId: 'A', companyIds: ['A'], companiesByModule: {} }), CO, null), false, 'own company only')
})

test('every payroll company filter offers Group Companies', () => {
  for (const f of ['LockUnlock', 'RunCycle', 'MonthSync', 'NpsReport', 'PayrollDashboard']) {
    const s = src(`components/payroll/${f}.tsx`)
    assert.ok(s.includes('Group Companies (all)'), f)
    assert.ok(!s.includes('>All companies<'), `${f} still says All companies`)
  }
  for (const f of ['AttendanceEditTab', 'attendanceShared', 'PayrollDashboard']) {
    const s = src(`components/payroll/${f}.tsx`)
    assert.ok(/canPickGroup\(grant/.test(s) && !/grant\.crossCompany \?/.test(s), `${f} gates Group on canPickGroup`)
  }
})

test('the header has a Month that every month screen follows; Configuration only on the admin dashboard', () => {
  const page = src('app/dashboard/payroll/page.tsx')
  assert.ok(/<label style=\{S\.label\}>Month<\/label>/.test(page), 'a Month filter in the header')
  assert.ok(/useState\(\(\) => fyMonthOf\(new Date\(\)\)\)/.test(page), 'defaults to the current month')
  for (const c of ['RunCycle', 'MonthSync', 'ManualVoucher', 'ArrearPayments', 'LockUnlock', 'AttendanceUpload', 'AttendanceEditTab', 'PayrollDashboard'])
    assert.ok(new RegExp(`<${c} [^>]*month=\\{month\\}`).test(page), `${c} gets the month`)
  assert.ok(/\(k !== 'config' \|\| onAdmin\)/.test(page) && /startsWith\('\/dashboard'\)/.test(page), 'Configuration hidden when opened from ESS')
  assert.ok(!/label: 'Lock \/ Unlock Month'/.test(page), 'no Lock / Unlock Month under Configuration → Payroll Month')
  assert.ok(/label: 'Lock \/ Unlock', icon: '', built: true, render: \(\) => <LockUnlock/.test(page), 'Payroll Run → Lock / Unlock stays')
})

test('Data Sync drops the Run Payroll rows and counts what changed since the freeze', () => {
  const s = src('components/payroll/MonthSync.tsx')
  assert.ok(s.includes("SYNC_CATEGORIES.filter(c => c.key !== 'tds' && c.syncable !== false)"))
  assert.ok(!/>\s*Run Payroll\s*</.test(s), 'no Run Payroll badge left')
  assert.ok(/<PendingStrip cats=\{DATA_SYNC_CATEGORIES\}/.test(s), 'the counters sit on top')
  assert.ok(/loadPendingChanges\(cat, runIds\)\.then\(m => \(m \? m\.size : null\)\)/.test(s), 'a count per change-tracked category')
  assert.ok(/refresh\(\); refreshPending\(\)/.test(s), 'counters refresh after a sync')
  const lib = src('lib/payroll/sync.ts')
  for (const k of ['earnings', 'epf', 'esic', 'pt', 'lwf'])
    assert.ok(new RegExp(`key: '${k}'[^\\n]*syncable: false`).test(lib), `${k} is run-owned`)
})

test('the dashboard opens the Negotiation salary calculator', () => {
  assert.ok(/<SalaryCalculatorButton \/>/.test(src('components/payroll/PayrollDashboard.tsx')))
  const panel = src('components/payroll/SalaryCalculatorPanel.tsx')
  assert.ok(/import\('@\/components\/recruitment\/CtcBreakupCalculator'\)/.test(panel) && /<CtcBreakupCalculator bare \/>/.test(panel))
  assert.ok(/createPortal\(/.test(panel), 'drawn on document.body, clear of transformed ancestors')
})

test('every Statutory & Tax sub-tab has an employee-wise register of its components', async () => {
  const { STATUTORY_REPORTS, snapshotColumns, IDENTITY } = await import('../statutory-report.ts')
  assert.deepEqual(Object.keys(STATUTORY_REPORTS), ['pf', 'esic', 'pt', 'lwf', 'tds'])
  const must: Record<string, string[]> = {
    pf: ['uan_number', 'pf_applicable', 'vpf_percent', 'epf_wage_base', 'epf_employee', 'vpf_amount', 'eps_contribution', 'edli_contribution', 'admin_charges', 'employer_pf', 'arrear_employee_pf'],
    esic: ['esic_number', 'esic_covered', 'esic_threshold_wage', 'earn_basic_monthly', 'earn_hra_monthly', 'pay_incentive', 'esic_wages', 'esic_employee', 'esic_employer', 'employer_esic', 'arrear_employee_esic'],
    pt: ['pt_state', 'earn_gross_monthly', 'pt_gross', 'pt_slab', 'pt_amount', 'pt_monthly', 'arrear_pt'],
    lwf: ['lwf_state_used', 'lwf_month_applicable', 'lwf_employee', 'lwf_employer', 'lwf_total', 'arrear_lwf'],
    tds: ['pan_number', 'tds_regime_used', 'tds_annual_gross', 'tds_hra_exempt', 'tds_chapter_via', 'employer_nps', 'tds_taxable_income', 'tds_rebate_87a', 'tds_cess', 'tds_monthly', 'tds_additional'],
  }
  for (const [k, keys] of Object.entries(must)) {
    const rep = STATUTORY_REPORTS[k]
    const have = rep.groups.flatMap(g => g.cols.map(c => c.key))
    for (const key of keys) assert.ok(have.includes(key), `${k} shows ${key}`)
    const sel = snapshotColumns(rep)
    assert.ok(!sel.includes('vpf_amount') && !sel.includes('lwf_total'), 'derived columns are not selected')
    for (const id of IDENTITY) assert.ok(sel.includes(id.key), `${k} selects ${id.key}`)
  }
  const pf = STATUTORY_REPORTS.pf.groups.flatMap(g => g.cols).find(c => c.key === 'vpf_amount')!
  assert.equal(pf.derive!({ voluntary_pf_applicable: true, vpf_percent: 4, epf_wage_base: 25000 }), 1000)
  assert.equal(pf.derive!({ voluntary_pf_applicable: false, vpf_percent: 4, epf_wage_base: 25000 }), 0)
  const page = src('app/dashboard/payroll/page.tsx')
  for (const [id, kind] of [['pf', 'pf'], ['esic', 'esic'], ['lwf', 'lwf'], ['ptlwf', 'pt'], ['tds', 'tds']])
    assert.ok(new RegExp(`id: '${id}'[^\\n]*reg\\('${kind}'\\)`).test(page), `${id} renders the ${kind} register`)
  assert.ok(/<NpsReport fy=\{fy\} \/>/.test(page), 'NPS keeps its report')
})
