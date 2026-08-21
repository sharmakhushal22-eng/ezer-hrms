'use client'
// components/payroll/RunCycle.tsx — Payroll → Payroll Run → Run Cycle.
//
// This screen is a gate, not a control panel. Its only job is to answer "can this month
// be paid right now, and if not, who is in the way" — then run it.
//
// The old version of this tab exposed the whole status machine (create month, sync
// employees, advance, cancel) next to Calculate. Two of those were quietly dangerous:
// Sync employees deleted the month's snapshot before rewriting eleven columns, and
// Advance walked a run to APPROVED with zero payroll lines. Month creation lives in
// Configuration → Payroll Month (where the previous-month readiness check runs) and
// per-category sync lives in Data Sync, so neither is repeated here.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, loadRunsForPeriod, loadRunRegister, loadMonthMaster, RUN_SHEET_COLS, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { calculateRun } from '@/lib/payroll/engine'
import { SYNC_CATEGORIES, runCategorySync } from '@/lib/payroll/sync'
import { lockEmployees } from '@/lib/payroll/lock'
import {
  loadSnapshotRows, computeReadiness, applyFilter, filterOptions, blockerSummary,
  EMPTY_FILTER, isFiltered, NOT_ACTIVE,
  type Readiness, type ReadinessCheck, type ReadinessFilter, type SnapshotRow,
} from '@/lib/payroll/readiness'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.violet, purpleD: TK.violetDeep, purpleSoft: '#F3EEFF',
  card: TK.surface, border: '#ECEAFB', muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: '#A7F3D0',
  amber: TK.warning, amberBg: TK.warningTint, amberBd: '#FDE68A',
  red: TK.critical, redBg: TK.criticalTint, redBd: '#FECACA', redDark: TK.critical,
}
const font = '"DM Sans","Segoe UI",sans-serif'

const periodLabel = (r: { period_label?: string | null; month?: number; fy?: string }) =>
  r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

// Run Payroll applies the earned-salary formulas before the engine runs, through the
// same category sync that the Data Sync screen exposes — one implementation of
// Earn_X = ROUND(X × paid_days / days_in_month), not two that can drift apart.
const EARN_CAT = SYNC_CATEGORIES.find(c => c.key === 'earnings')
// Then the statutory pass: 50% basic floor, EPF/EPS/EDLI/Admin, every rate read
// from epf_config and wage_rules_config rather than written into the code.
const EPF_CAT = SYNC_CATEGORIES.find(c => c.key === 'epf')
const ESIC_CAT = SYNC_CATEGORIES.find(c => c.key === 'esic')
const PT_CAT = SYNC_CATEGORIES.find(c => c.key === 'pt')
const LWF_CAT = SYNC_CATEGORIES.find(c => c.key === 'lwf')
// Employer NPS reads earned basic, so it runs with the other post-earnings passes.
const NPS_CAT = SYNC_CATEGORIES.find(c => c.key === 'nps')
// Last: arrear differences a back month against what it actually paid, so it needs the
// other categories for this month settled first.
const ARREAR_CAT = SYNC_CATEGORIES.find(c => c.key === 'arrear')

// ── Tab strip button ───────────────────────────────────────────────────────
// Defined outside the parent: a tab that re-mounts on every render loses its hover
// state mid-click, and the whole strip re-renders each time the count refreshes.
function Tab({ check, active, onPick }: { check: ReadinessCheck; active: boolean; onPick: () => void }) {
  const off = !check.available
  const n = check.rows.length
  const blocked = check.blocking && n > 0
  const clear = check.available && n === 0

  const countStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
    background: active
      ? 'rgba(255,255,255,0.28)'
      : blocked ? C.red : clear ? C.greenBg : 'rgba(0,0,0,0.08)',
    color: active ? '#fff' : blocked ? '#fff' : clear ? C.green : C.navy,
  }
  return (
    <button
      onClick={off ? undefined : onPick}
      disabled={off}
      title={off ? check.unavailableNote : undefined}
      style={{
        flexShrink: 0, background: active ? C.purple : C.card,
        border: `1px solid ${active ? C.purple : C.border}`, borderRadius: 10,
        padding: '10px 16px', cursor: off ? 'not-allowed' : 'pointer',
        fontSize: 12.5, fontWeight: 600, color: active ? '#fff' : C.navy,
        display: 'flex', alignItems: 'center', gap: 8, fontFamily: font,
        opacity: off ? 0.45 : 1, transition: 'all .15s',
      }}>
      {check.icon} {check.label}
      <span style={countStyle}>{off ? '—' : n}</span>
    </button>
  )
}

// ── The selected check's employee list ─────────────────────────────────────
function CheckPanel({ check, isGroup }: { check: ReadinessCheck; isGroup: boolean }) {
  const th: React.CSSProperties = {
    textAlign: 'left', fontSize: 10.5, color: C.muted, textTransform: 'uppercase',
    letterSpacing: '0.03em', padding: 8, borderBottom: `1px solid ${C.border}`, fontWeight: 600,
  }
  const td: React.CSSProperties = { padding: '10px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 17 }}>{check.icon}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{check.label}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, marginLeft: 27 }}>{check.desc}</div>

      {check.rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: C.green }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}></div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Nobody in this month has this problem.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                {isGroup && <th style={th}>Company</th>}
                <th style={th}>Impact if unresolved</th>
              </tr>
            </thead>
            <tbody>
              {check.rows.map(e => (
                <tr key={e.code}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', background: C.purpleSoft, color: C.purpleD,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>{e.initials}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.name || '—'}</div>
                        <div style={{ fontSize: 10.5, color: C.muted }}>{e.code}</div>
                      </div>
                    </div>
                  </td>
                  {isGroup && <td style={{ ...td, color: C.muted, fontSize: 11.5 }}>{e.company || '—'}</td>}
                  <td style={{ ...td, color: check.blocking ? C.redDark : C.amber, fontSize: 11.5 }}>{e.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Banner ─────────────────────────────────────────────────────────────────
function Banner({ tone, title, sub }: { tone: 'red' | 'green' | 'amber'; title: string; sub: string }) {
  const t = tone === 'red'
    ? { bg: 'linear-gradient(135deg,#FEF2F2,#FFF5F5)', bd: C.redBd, dot: C.red, fg: C.red, sub: C.redDark, ic: '' }
    : tone === 'green'
      ? { bg: 'linear-gradient(135deg,#ECFDF5,#F3FDF8)', bd: C.greenBd, dot: C.green, fg: C.green, sub: '#047857', ic: '' }
      : { bg: 'linear-gradient(135deg,#FFFBEB,#FFFDF5)', bd: C.amberBd, dot: C.amber, fg: C.amber, sub: TK.warning, ic: '' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: '16px 20px',
      marginBottom: 20, background: t.bg, border: `1px solid ${t.bd}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, fontSize: 18, background: t.dot, color: '#fff',
      }}>{t.ic}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.fg }}>{title}</div>
        <div style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────────────
// Sits directly above the banner, because it defines the SCOPE the banner is judging.
// Filtering here narrows the payroll run itself, not just the view: HR routinely has to
// pay one late joiner or re-run one corrected salary out of three hundred, and doing
// that by recalculating the whole month would silently rewrite 299 payslips nobody
// asked to change. Everyone outside the filter keeps the line they already had.
function FilterBar({ rows, filter, onChange, onClear, matched, isGroup }: {
  rows: SnapshotRow[]
  filter: ReadinessFilter
  onChange: (patch: Partial<ReadinessFilter>) => void
  onClear: () => void
  matched: number
  isGroup: boolean
}) {
  const { companies, locations, departments, statuses } = filterOptions(rows)
  const on = isFiltered(filter)
  const inp: React.CSSProperties = {
    padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12,
    background: '#fff', color: C.navy, fontFamily: font, outline: 'none',
  }
  const lbl: React.CSSProperties = { fontSize: 9.5, color: C.muted, display: 'block', marginBottom: 3 }
  return (
    <div style={{
      background: on ? C.purpleSoft : TK.sunken, border: `1px solid ${on ? TK.violetEdge : C.border}`,
      borderRadius: 12, padding: '10px 12px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 8 }}>Filter</div>
        {isGroup && companies.length > 1 && (
          <div>
            <label style={lbl}>Company</label>
            <select style={{ ...inp, minWidth: 170 }} value={filter.company} onChange={e => onChange({ company: e.target.value })}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={lbl}>Location</label>
          <select style={{ ...inp, minWidth: 150 }} value={filter.location} onChange={e => onChange({ location: e.target.value })}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Department</label>
          <select style={{ ...inp, minWidth: 150 }} value={filter.department} onChange={e => onChange({ department: e.target.value })}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select style={{ ...inp, minWidth: 140 }} value={filter.status} onChange={e => onChange({ status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value={NOT_ACTIVE}>Not active</option>
            {/* The exact words in this month, for when "not active" is too broad. */}
            {statuses.length > 0 && (
              <optgroup label="Exactly">
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={lbl}>Employee — code or name, paste a list too</label>
          <input style={{ ...inp, width: '100%' }} value={filter.employee}
            onChange={e => onChange({ employee: e.target.value })}
            placeholder="SSM9001, SSM9002   ya   kavya" />
        </div>
        {on && (
          <button onClick={onClear} style={{
            padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff',
            color: C.red, fontWeight: 700, fontSize: 11.5, fontFamily: font, cursor: 'pointer',
          }}>Clear</button>
        )}
      </div>
      <div style={{ fontSize: 10.5, marginTop: 8, color: on ? C.purpleD : C.muted, lineHeight: 1.5 }}>
        {!on ? <>No filter — payroll will run on the <b>whole month</b> ({rows.length} employees).</>
          : matched === 0
            ? <b style={{ color: C.red }}>This filter matches no employees — there is nothing to run.</b>
            : <>Filter on — payroll will run on <b>only these {matched}</b> of {rows.length} employees. The other {rows.length - matched} payslips stay exactly as they are, and the month will <b>not be marked CALCULATED</b> until a full run happens.</>}
      </div>
    </div>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function RunCycle({ companyId, headerFy }: { companyId: string; headerFy: string }) {
  const fy = headerFy
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')
  const [monthRuns, setMonthRuns] = useState<PayrollRun[]>([])
  const [rows, setRows] = useState<SnapshotRow[] | null>(null)
  const [filter, setFilter] = useState<ReadinessFilter>(EMPTY_FILTER)
  const [tab, setTab] = useState('bank')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ processed: number; skipped: number; net: number } | null>(null)

  const isGroup = !companyId

  // Months that exist for this FY. One entry per month even in group mode, where a
  // single month legitimately spans one run per company.
  useEffect(() => {
    let live = true
    setLoading(true); setErr(''); setResult(null)
    loadRuns(companyId, fy)
      .then(rs => {
        if (!live) return
        const active = rs.filter(r => r.status !== 'CANCELLED')
        setRuns(active)
        const months = Array.from(new Set(active.map(r => r.month))).sort((a, b) => a - b)
        setMonthVal(v => (v && months.includes(Number(v)) ? v : String(months[months.length - 1] ?? '')))
      })
      .catch(e => live && setErr(e?.message || String(e)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [companyId, fy])

  const refresh = useCallback(async () => {
    if (!monthVal) { setMonthRuns([]); setRows(null); return }
    setLoading(true); setErr('')
    try {
      const list = await loadRunsForPeriod(companyId, fy, Number(monthVal))
      setMonthRuns(list)
      setRows(await loadSnapshotRows(list.map(r => ({ id: r.id, company_name: r.company_name }))))
    } catch (e: any) { setErr(e?.message || String(e)); setRows(null) } finally { setLoading(false) }
  }, [companyId, fy, monthVal])
  useEffect(() => { refresh() }, [refresh])

  // Two readings of the same month. `rd` follows the filter and drives what HR is
  // looking at; `rdAll` ignores it and drives the Run button — a payroll cannot become
  // runnable because someone narrowed the view to a location that happens to be clean.
  const shown = rows ? applyFilter(rows, filter) : []
  const rd: Readiness | null = rows ? computeReadiness(shown) : null
  const rdAll: Readiness | null = rows ? computeReadiness(rows) : null
  const filtering = isFiltered(filter)

  const sel = monthRuns[0] || null
  const label = sel ? periodLabel(sel) : monthVal ? `${MONTHS[Number(monthVal) - 1]} ${fy.split('-')[0]}` : ''
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => a.month - b.month)

  // A month past DISBURSED is closed to recalculation on purpose — a payslip that was
  // already paid out must not silently change under an employee's feet.
  const CALCULABLE = ['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED']
  const runnable = monthRuns.filter(r => CALCULABLE.includes(r.status))
  const closed = monthRuns.length > 0 && runnable.length === 0
  const calculated = monthRuns.length > 0 && monthRuns.every(r => r.status !== 'OPEN' && r.status !== 'SYNCED' && r.status !== 'ATTENDANCE_LOCKED')
  // The scope is whatever HR is looking at; within it, employees with a blocking problem
  // are left out and everybody else is paid. The run only stops when there is nobody
  // left to pay — one blank account number must never hold up 301 salaries.
  const scope = filtering ? rd : rdAll
  const blockers = scope?.blockers || []
  const willRun = scope?.runnableCodes || []
  const excluded = scope?.excludedCodes || []
  const canRun = willRun.length > 0 && runnable.length > 0 && !busy

  async function run() {
    if (!canRun) return
    setBusy(true); setErr(''); setResult(null)

    // Codes always go to the engine now, because the excluded employees have to be held
    // back even when no filter is on. `partial` is reserved for HR narrowing the scope
    // by hand — that is what must not let the month call itself CALCULATED.
    const partial = filtering
    const pay = new Set(willRun)
    const source = filtering ? shown : (rows || [])

    // In group mode a month is one run per company, so the list is split back out per
    // run — and a company with nobody left to pay is skipped, not failed.
    const codesByRun = new Map<string, string[]>()
    source.forEach(r => {
      const code = String(r.employee_code)
      if (!pay.has(code)) return
      const id = String(r.run_id)
      codesByRun.set(id, [...(codesByRun.get(id) || []), code])
    })
    const targets = runnable.filter(r => codesByRun.has(r.id))

    let processed = 0, skipped = 0, net = 0
    const fails: string[] = []
    for (const r of targets) {
      const codes = codesByRun.get(r.id) || []

      // Steps 1-2 — write the earned columns, then the statutory ones, back into the
      // Month Master. This is what turns
      // the frozen structure into money: Earn_X = ROUND(X × paid_days / days_in_month),
      // the uploader payments as-is, then total deduction and net pay. The sheet HR
      // downloads below is only meaningful once this has run.
      // Order matters and is not interchangeable: EPF wages are Earn_Gross − Earn_HRA,
      // so the earned columns have to exist before the statutory ones can be computed.
      // Earnings is the only genuine prerequisite — EPF wages are Earn_Gross − Earn_HRA,
      // so nothing downstream means anything without it. A failure there stops this
      // company.
      //
      // The statutory steps are different: each one only fills its own columns, and the
      // engine falls back to the frozen figures for whatever is missing. One of them
      // breaking used to abort the whole run, so a single bad step meant nobody got paid
      // and no sheet came out. Now the error is reported and payroll still runs.
      let prereqFailed = false
      for (const [what, cat] of [['earnings', EARN_CAT], ['EPF', EPF_CAT], ['ESIC', ESIC_CAT], ['PT', PT_CAT], ['LWF', LWF_CAT], ['employer NPS', NPS_CAT], ['arrear', ARREAR_CAT]] as const) {
        if (!cat) continue
        const { error } = await runCategorySync(cat, [r.id], codes)
        if (!error) continue
        fails.push(`${r.company_name || label}: ${what} — ${error}`)
        if (what === 'earnings') { prereqFailed = true; break }
      }
      if (prereqFailed) continue

      // Step 3 — the payroll engine, which writes payroll_lines (TDS, loans, net pay).
      const { error, result: res } = await calculateRun(r, codes, { partial, excluded })
      if (error) { fails.push(`${r.company_name || label}: ${error}`); continue }
      processed += res?.processed || 0
      skipped += res?.skipped || 0
      net += res?.totalNet || 0

      // Step 4 — freeze the people just paid. Their month is settled: no attendance edit,
      // no bank change, no second run. Only the ones this run actually paid — anybody
      // left out stays open so their problem can be fixed and they can be run after.
      const { error: lockErr } = await lockEmployees(r.id, codes)
      // Narrow on purpose — see lib/payroll/sync.ts. A match here SWALLOWS the failure,
      // so payroll would report success while the employees it just paid stayed unlocked
      // and open to a second run. `does not exist` also covers a bad column inside a
      // lock function that is present, and that must be reported, not hidden.
      if (lockErr && !/could not find the function|schema cache/i.test(lockErr)) {
        fails.push(`${r.company_name || label}: lock — ${lockErr}`)
      }
    }

    // Step 5 — hand over the sheet. HR's next move after a run is always to open the
    // numbers, so downloading it is the run's last step rather than a button they have
    // to find afterwards.
    // Only the employees actually paid — a sheet containing the ones who were left out
    // would be read as "these were run" by whoever opens it next.
    if (processed) {
      try { await downloadSheet(willRun) }
      catch (e: any) { fails.push('Sheet download failed: ' + (e?.message || e)) }
    }

    setBusy(false)
    if (fails.length) setErr(fails.join('  ·  '))
    if (processed) setResult({ processed, skipped, net })
    refresh()
  }

  /** The run's working-out sheet: identity, formula inputs, formula outputs. codes = those rows only. */
  async function downloadSheet(codes: string[] | null) {
    const all = await loadMonthMaster(monthRuns.map(r => ({ id: r.id, company_name: r.company_name, fy: r.fy })))
    const want = codes ? new Set(codes) : null
    const picked = want ? all.filter(r => want.has(String(r.employee_code))) : all
    if (!picked.length) throw new Error('nothing to export')

    // Company only means something when the month spans companies.
    const header = RUN_SHEET_COLS.filter(c => c !== 'Company' || isGroup)
    // Written explicitly rather than by deleting unwanted keys: a column added to the
    // snapshot later should not silently appear in this sheet.
    const out = picked.map(r => {
      const row: Record<string, any> = {}
      header.forEach(c => { row[c] = r[c] ?? '' })
      return row
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out, { header }), 'Payroll Run')
    const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    XLSX.writeFile(wb, `Payroll_Run_${safe(label)}_${out.length}emp.xlsx`)
  }

  async function downloadRegister() {
    setBusy(true); setErr('')
    try {
      const rows: Record<string, any>[] = []
      for (const r of monthRuns) {
        const part = await loadRunRegister(r.id)
        part.forEach(x => rows.push(isGroup ? { Company: r.company_name || '', ...x } : x))
      }
      if (!rows.length) { setErr('No payroll lines for this month yet — run payroll first.'); return }
      const header: string[] = []
      rows.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), 'Register')
      XLSX.writeFile(wb, `EZER_Payroll_Register_${label.replace(/\s+/g, '_')}.xlsx`)
    } catch (e: any) { setErr('Export failed: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  const active = rd?.checks.find(c => c.key === tab) || rd?.checks[0] || null

  // Banner text — the point is that HR reads one line and knows whether to keep going.
  const banner = (() => {
    if (loading && !rows) return { tone: 'amber' as const, title: 'Checking the month…', sub: 'Reading every employee in the Month Master.' }
    if (!monthRuns.length) return { tone: 'amber' as const, title: 'No payroll month selected', sub: 'Create one in Configuration → Payroll Month, then come back here.' }
    if (closed) return { tone: 'green' as const, title: `Month is ${monthRuns[0].status.toLowerCase()}`, sub: 'Payroll for this month is closed to recalculation. Reopen it from Lock / Unlock if it genuinely has to change.' }
    // The banner speaks for whatever will actually be run. Filtered, that is the
    // selected employees; unfiltered, the whole month. Anything else and HR reads a
    // verdict about people the button is not going to touch.
    if (filtering && shown.length === 0) {
      return { tone: 'amber' as const, title: 'Nobody matches this filter', sub: 'Clear it or widen it — there is nothing to run.' }
    }
    // Red is now reserved for "nobody can be paid at all". Some people being left out is
    // a warning, not a stop — the other 301 salaries still go out today.
    if (willRun.length === 0) {
      // Everyone locked is the normal end state of a finished month, not a failure —
      // saying "nobody can be run" there would read as a fault every single month.
      const onlyLocked = blockers.length === 1 && blockers[0].key === 'locked'
      if (onlyLocked) {
        return {
          tone: 'green' as const, title: 'Month is done',
          sub: `Payroll has run for all ${blockers[0].rows.length}. To re-run somebody, unlock them in Lock / Unlock with a reason.`,
        }
      }
      return {
        tone: 'red' as const, title: 'Nobody left to run',
        sub: `${blockerSummary(blockers)} — nobody in scope is available.`,
      }
    }
    if (result) {
      return {
        tone: excluded.length ? 'amber' as const : 'green' as const,
        title: 'Payroll run complete',
        sub: `${result.processed} paid · net ${inr(result.net)}`
          + (excluded.length ? ` · ${excluded.length} left out (${blockerSummary(blockers)}) — fix and run again for them` : ''),
      }
    }
    const inScope = filtering ? shown.length : (rdAll?.totalEmployees ?? 0)
    if (excluded.length) {
      return {
        tone: 'amber' as const,
        title: `Ready to run for ${willRun.length} of ${inScope}`,
        sub: `${excluded.length} will be left out — ${blockerSummary(blockers)}. Their payslips will not be produced; everyone else's will.`,
      }
    }
    if (filtering) {
      const rest = (rdAll?.totalEmployees ?? 0) - shown.length
      return {
        tone: 'green' as const,
        title: `Ready to run for ${shown.length} employee${shown.length === 1 ? '' : 's'}`,
        sub: rest > 0
          ? `Only the selected ${shown.length} will be calculated — the other ${rest} in this month stay exactly as they are.`
          : 'Every employee in this month is selected.',
      }
    }
    if (calculated) return { tone: 'green' as const, title: 'Payroll already calculated', sub: 'Nothing outstanding — re-run it if attendance or salary changed since.' }
    return { tone: 'green' as const, title: 'Ready to run', sub: `All ${inScope} employees have nothing outstanding.` }
  })()

  const hint = !monthRuns.length ? 'Create a payroll month first'
    : closed ? 'This month is locked — reopen it from Lock / Unlock'
      : filtering && shown.length === 0 ? 'Nobody matches the filter'
        : willRun.length === 0
          ? (blockers.length === 1 && blockers[0].key === 'locked'
            ? 'Everyone here is locked — unlock someone to run them again'
            : 'Nobody in scope is available — fix one to enable this')
          : busy ? 'Working…'
            : excluded.length ? `${excluded.length} left out — they keep their current payslip, nothing is zeroed`
              : filtering
                ? `Only these ${shown.length} — the rest of the month is not touched`
                : `Runs on all ${rdAll?.totalEmployees ?? 0} employees in this month`

  return (
    <div style={{ fontFamily: font, fontSize: 14, color: C.navy, maxWidth: 960 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, margin: '0 0 4px', letterSpacing: '-0.02em', fontWeight: 700 }}>Payroll Run</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            🏢 {isGroup ? `Group Companies${monthRuns.length ? ` · ${monthRuns.length} compan${monthRuns.length === 1 ? 'y' : 'ies'}` : ''}` : (sel?.company_name || 'Company')}
          </div>
        </div>
        <select value={monthVal} onChange={e => { setMonthVal(e.target.value); setResult(null) }}
          style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, padding: '7px 16px',
            fontSize: 12.5, fontWeight: 600, color: C.purpleD, fontFamily: font, cursor: 'pointer', outline: 'none',
            boxShadow: '0 1px 3px rgba(124,58,237,0.06)',
          }}>
          {monthOpts.length === 0 && <option value="">No month created</option>}
          {monthOpts.map(r => <option key={r.month} value={String(r.month)}>📅 {periodLabel(r)}</option>)}
        </select>
      </div>

      {rows && rows.length > 0 && (
        <FilterBar rows={rows} filter={filter} matched={shown.length} isGroup={isGroup}
          onChange={patch => setFilter(f => ({ ...f, ...patch }))}
          onClear={() => setFilter(EMPTY_FILTER)} />
      )}

      <Banner tone={banner.tone} title={banner.title} sub={banner.sub} />

      {rd && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 2 }}>
            {rd.checks.map(c => (
              <Tab key={c.key} check={c} active={active?.key === c.key} onPick={() => setTab(c.key)} />
            ))}
          </div>

          <div style={{
            background: C.card, borderRadius: 16, padding: '22px 24px', marginBottom: 18,
            boxShadow: '0 1px 4px rgba(124,58,237,0.06)', border: `1px solid ${C.border}`,
          }}>
            {active && <CheckPanel check={active} isGroup={isGroup} />}
          </div>
        </>
      )}

      {err && (
        <div style={{ fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>{err}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={!canRun}
          style={{
            fontFamily: font, fontSize: 14, fontWeight: 700, color: '#fff',
            background: canRun ? C.purple : '#D8D3F5', border: 'none', borderRadius: 12,
            padding: '14px 28px', cursor: canRun ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: canRun ? '0 4px 14px rgba(124,58,237,0.25)' : 'none',
          }}>
          {busy ? 'Running…'
            : willRun.length === 0 ? 'Run Payroll'
              : (filtering || excluded.length)
                ? `▶️ Run Payroll for ${willRun.length} employee${willRun.length === 1 ? '' : 's'}`
                : calculated ? 'Re-run Payroll' : 'Run Payroll'}
        </button>
        {/* Available whenever the month has rows, not only after a clean run. The sheet
            was previously produced only as the last step of a successful run, so any
            failure earlier in the chain left HR with no numbers at all to look at. */}
        {(rows?.length ?? 0) > 0 && (
          <button onClick={() => downloadSheet(null).catch(e => setErr('Sheet download failed: ' + (e?.message || e)))}
            disabled={busy}
            style={{
              fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.purpleD, background: C.card,
              border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 18px',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>Download sheet</button>
        )}
        {calculated && (
          <button onClick={downloadRegister} disabled={busy}
            style={{
              fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.purpleD, background: C.card,
              border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 18px', cursor: busy ? 'not-allowed' : 'pointer',
            }}>Register</button>
        )}
        <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>
      </div>
    </div>
  )
}
