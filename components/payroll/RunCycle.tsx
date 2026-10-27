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
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, loadRunsForPeriod, loadRunRegister, loadMonthMaster, RUN_SHEET_COLS, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { calculateRun } from '@/lib/payroll/engine'
import { SYNC_CATEGORIES, runCategorySync, defaultRegimesForFy } from '@/lib/payroll/sync'
import { lockEmployees } from '@/lib/payroll/lock'
import PayslipDownload from '@/components/payroll/PayslipDownload'
import {
  loadSnapshotRows, computeReadiness, applyFilter, filterOptions, blockerSummary,
  EMPTY_FILTER, isFiltered, NOT_ACTIVE,
  type Readiness, type ReadinessCheck, type ReadinessFilter, type SnapshotRow,
} from '@/lib/payroll/readiness'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, S, Person, Th, Td, IconLock, IconDownload, IconBuilding } from '@/lib/ui'
import {
  SectionCard, InfoCallout, ChipTab, ChipTabs, FilterBar as KitFilterBar, FilterField, fieldStyle, ControlSelect,
  ActionBar, ActionDivider, ActionGroup, PButton, EmptyState, ProcessStepper, runSteps, leastAdvanced, RunStatusPill,
  DataTable, IconBank, IconTimer, IconSync, IconPause, IconIdCard, IconFile, IconPlay, IconMonth, IconCheckCircle,
  type KitTone,
} from '@/components/payroll/kit'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, purpleSoft: TK.brandTint,
  card: TK.surface, border: TK.brandEdge, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint,
  red: TK.critical, redBg: TK.criticalTint, redBd: TK.criticalTint, redDark: TK.critical,
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
// Very last: the monthly TDS figure reads this month's own earned income, arrear (now
// taxed as actual), professional tax and the regime — all of which have to be settled
// by the time this runs. This is what turns tds_declarations.monthly_tds from the
// figure the payslip actually deducts into a fallback for a month synced before this
// engine existed — see lib/payroll/engine.ts.
const TDS_CAT = SYNC_CATEGORIES.find(c => c.key === 'tds')

// ── Tab strip button ───────────────────────────────────────────────────────
// Defined outside the parent: a tab that re-mounts on every render loses its hover
// state mid-click, and the whole strip re-renders each time the count refreshes.
//
// Each check reads as a status chip: a blocking check with people in it is critical,
// a non-blocking one is a warning, an empty one is quiet. "Already Run" is the
// exception — readiness.ts calls it a finished job, not a fault, so it is informational.
const CHECK_ICON: Record<string, React.ReactNode> = {
  locked: <IconLock size={15} />, bank: <IconBank size={15} />, days: <IconMonth size={15} />,
  attendance: <IconTimer size={15} />, ctc: <IconSync size={15} />, hold: <IconPause size={15} />,
  pan: <IconIdCard size={15} />, arrear: <IconFile size={15} />,
}
function checkTone(check: ReadinessCheck): KitTone {
  const n = check.rows.length
  if (!check.available) return 'neutral'
  if (n === 0) return 'positive'
  if (check.key === 'locked') return 'info'
  return check.blocking ? 'critical' : 'warning'
}
function Tab({ check, active, onPick }: { check: ReadinessCheck; active: boolean; onPick: () => void }) {
  const off = !check.available
  const n = check.rows.length
  return (
    <ChipTab
      label={check.label}
      icon={CHECK_ICON[check.key] || <span>{check.icon}</span>}
      count={off ? '-' : n}
      t={checkTone(check)}
      active={active}
      disabled={off}
      title={off ? check.unavailableNote : check.blocking ? 'Blocking: people here are left out of the run' : 'Heads-up: does not stop anyone being paid'}
      onClick={onPick}
    />
  )
}

// ── The selected check's employee list ─────────────────────────────────────
// The list is behind a View button. Every one of these tabs can hold three hundred
// names, and rendering them the moment a tab is touched pushed the Run Payroll button
// itself off the bottom of the screen — the count on the tab is what HR is reading at
// this stage, and the names only matter once they decide to go fix them.
//
// The panel is remounted per tab (see `key` at the call site), so switching tabs starts
// closed again rather than carrying the previous tab's decision across.
function CheckPanel({ check, isGroup }: { check: ReadinessCheck; isGroup: boolean }) {
  const [shown, setShown] = useState(false)
  const t = checkTone(check)
  return (
    <SectionCard
      icon={CHECK_ICON[check.key] || <span>{check.icon}</span>}
      iconTone={t === 'neutral' ? 'brand' : t}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{check.label}
        <span style={{ fontSize: F.micro, fontWeight: W.semi, color: check.blocking ? C.red : C.amber, textTransform: 'uppercase', letterSpacing: '.06em' }}>{check.blocking ? 'Blocking' : 'Non-blocking'}</span></span>}
      hint={check.desc}
      /* No button when there is nothing behind it — a View that reveals an empty state
         is one more click for no answer. */
      actions={check.rows.length > 0 ? (
        <PButton size="sm" variant={shown ? 'secondary' : 'primary'} onClick={() => setShown(v => !v)}>
          {shown ? 'Hide list' : `View list (${check.rows.length})`}
        </PButton>
      ) : undefined}
      flush={check.rows.length > 0}
      style={{ marginBottom: S.lg }}
    >
      {check.rows.length === 0 ? (
        <EmptyState compact t="positive" icon={<IconCheckCircle size={22} />} title="Nobody in this month has this problem." />
      ) : !shown ? (
        <div style={{ padding: `${S.md}px ${S.lg}px`, fontSize: F.small, color: C.muted }}>
          <b style={{ color: C.navy }}>{check.rows.length}</b> employee{check.rows.length === 1 ? '' : 's'} {check.blocking ? 'will be left out of this run' : 'flagged'}. Open the list to see who and why.
        </div>
      ) : (
        <DataTable maxHeight={420}>
          <thead>
            <tr>
              <Th>Employee</Th>
              {isGroup && <Th>Company</Th>}
              <Th>Impact if unresolved</Th>
            </tr>
          </thead>
          <tbody>
            {check.rows.map(e => (
              <tr key={e.code} className="ez-row">
                <Td><Person name={e.name || '-'} meta={e.code} size={30} /></Td>
                {isGroup && <Td style={{ color: C.muted, fontSize: 12 }}>{e.company || '-'}</Td>}
                <Td style={{ color: check.blocking ? C.redDark : C.amber, fontSize: 12 }}>{e.impact}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </SectionCard>
  )
}

// ── Banner ─────────────────────────────────────────────────────────────────
// One status callout with a real icon disc (the old one drew an empty coloured square).
function Banner({ tone, title, sub }: { tone: 'red' | 'green' | 'amber'; title: string; sub: string }) {
  const t: KitTone = tone === 'red' ? 'critical' : tone === 'green' ? 'positive' : 'warning'
  return <InfoCallout t={t} title={title} style={{ marginBottom: S.lg }}>{sub}</InfoCallout>
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
  const sel: React.CSSProperties = { ...fieldStyle, cursor: 'pointer' }
  return (
    <KitFilterBar label="Run scope" active={on} onClear={onClear} clearLabel="Clear"
      summaryTone={on && matched === 0 ? 'critical' : undefined}
      summary={!on ? <>No filter: payroll will run on the <b>whole month</b> ({rows.length} employees).</>
        : matched === 0
          ? <b style={{ color: C.red }}>This filter matches no employees, so there is nothing to run.</b>
          : <>Filter on: payroll will run on <b>only these {matched}</b> of {rows.length} employees. The other {rows.length - matched} payslips stay exactly as they are, and the month will <b>not be marked CALCULATED</b> until a full run happens.</>}>
      {isGroup && companies.length > 1 && (
        <FilterField label="Company" minWidth={180}>
          <select style={sel} value={filter.company} onChange={e => onChange({ company: e.target.value })}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterField>
      )}
      <FilterField label="Location" minWidth={160}>
        <select style={sel} value={filter.location} onChange={e => onChange({ location: e.target.value })}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </FilterField>
      <FilterField label="Department" minWidth={160}>
        <select style={sel} value={filter.department} onChange={e => onChange({ department: e.target.value })}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </FilterField>
      <FilterField label="Status" minWidth={150}>
        <select style={sel} value={filter.status} onChange={e => onChange({ status: e.target.value })}>
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
      </FilterField>
      <FilterField label="Employee (code or name, paste a list too)" grow minWidth={240}>
        <input style={fieldStyle} value={filter.employee}
          onChange={e => onChange({ employee: e.target.value })}
          placeholder="SSM9001, SSM9002   ya   kavya" />
      </FilterField>
    </KitFilterBar>
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
  // Downloads follow the filter too: with one on, the sheet, register and payslips hold
  // only the employees it matches — not the whole month.
  const shownCodes = useMemo(() => filtering ? shown.map(r => String(r.employee_code)) : null, [filtering, shown])

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
      //
      // Regime rule first: anyone still undecided after the 4th goes on the New
      // Regime before the TDS step reads the snapshot (072). Reported, never fatal.
      const rd = await defaultRegimesForFy(r.fy)
      if (rd.error) fails.push(`${r.company_name || label}: regime default (${rd.error})`)
      let prereqFailed = false
      for (const [what, cat] of [['earnings', EARN_CAT], ['EPF', EPF_CAT], ['ESIC', ESIC_CAT], ['PT', PT_CAT], ['LWF', LWF_CAT], ['employer NPS', NPS_CAT], ['arrear', ARREAR_CAT], ['TDS', TDS_CAT]] as const) {
        if (!cat) continue
        const { error } = await runCategorySync(cat, [r.id], codes)
        if (!error) continue
        fails.push(`${r.company_name || label}: ${what} (${error})`)
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
        fails.push(`${r.company_name || label}: lock (${lockErr})`)
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

  async function downloadRegister(codes: string[] | null) {
    setBusy(true); setErr('')
    try {
      const want = codes ? new Set(codes) : null
      const rows: Record<string, any>[] = []
      for (const r of monthRuns) {
        const part = await loadRunRegister(r.id)
        part.forEach(x => { if (!want || want.has(String(x.employee_code))) rows.push(isGroup ? { Company: r.company_name || '', ...x } : x) })
      }
      if (!rows.length) { setErr(want ? 'Nobody in this filter has a payroll line for this month yet.' : 'No payroll lines for this month yet. Run payroll first.'); return }
      const header: string[] = []
      rows.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), 'Register')
      XLSX.writeFile(wb, `EZER_Payroll_Register_${label.replace(/\s+/g, '_')}${want ? `_${rows.length}emp` : ''}.xlsx`)
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
      return { tone: 'amber' as const, title: 'Nobody matches this filter', sub: 'Clear it or widen it. There is nothing to run.' }
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
        sub: `${blockerSummary(blockers)}, so nobody in scope is available.`,
      }
    }
    if (result) {
      return {
        tone: excluded.length ? 'amber' as const : 'green' as const,
        title: 'Payroll run complete',
        sub: `${result.processed} paid · net ${inr(result.net)}`
          + (excluded.length ? ` · ${excluded.length} left out (${blockerSummary(blockers)}). Fix them and run again` : ''),
      }
    }
    const inScope = filtering ? shown.length : (rdAll?.totalEmployees ?? 0)
    if (excluded.length) {
      return {
        tone: 'amber' as const,
        title: `Ready to run for ${willRun.length} of ${inScope}`,
        sub: `${excluded.length} will be left out: ${blockerSummary(blockers)}. Their payslips will not be produced; everyone else's will.`,
      }
    }
    if (filtering) {
      const rest = (rdAll?.totalEmployees ?? 0) - shown.length
      return {
        tone: 'green' as const,
        title: `Ready to run for ${shown.length} employee${shown.length === 1 ? '' : 's'}`,
        sub: rest > 0
          ? `Only the selected ${shown.length} will be calculated. The other ${rest} in this month stay exactly as they are.`
          : 'Every employee in this month is selected.',
      }
    }
    if (calculated) return { tone: 'green' as const, title: 'Payroll already calculated', sub: 'Nothing outstanding. Re-run it if attendance or salary changed since.' }
    return { tone: 'green' as const, title: 'Ready to run', sub: `All ${inScope} employees have nothing outstanding.` }
  })()

  const hint = !monthRuns.length ? 'Create a payroll month first'
    : closed ? 'This month is locked. Reopen it from Lock / Unlock'
      : filtering && shown.length === 0 ? 'Nobody matches the filter'
        : willRun.length === 0
          ? (blockers.length === 1 && blockers[0].key === 'locked'
            ? 'Everyone here is locked. Unlock someone to run them again'
            : 'Nobody in scope is available. Fix one to enable this')
          : busy ? 'Working…'
            : excluded.length ? `${excluded.length} left out: they keep their current payslip, nothing is zeroed`
              : filtering
                ? `Only these ${shown.length}. The rest of the month is not touched`
                : `Runs on all ${rdAll?.totalEmployees ?? 0} employees in this month`

  const runLabel = busy ? 'Running…'
    : willRun.length === 0 ? 'Run Payroll'
      : (filtering || excluded.length)
        ? `Run Payroll for ${willRun.length} employee${willRun.length === 1 ? '' : 's'}`
        : calculated ? 'Re-run Payroll' : 'Run Payroll'
  const hintTone: KitTone = !canRun && !busy ? (closed || (blockers.length === 1 && blockers[0]?.key === 'locked') ? 'neutral' : 'warning') : excluded.length ? 'warning' : 'neutral'
  const monthStatus = leastAdvanced(monthRuns.map(r => r.status))

  return (
    <div style={{ fontFamily: font, fontSize: 14, color: C.navy, maxWidth: 1080 }}>
      {/* Context row: what is being run, for which month, and how far the month has got. */}
      <SectionCard style={{ marginBottom: S.lg }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: F.title, margin: '0 0 4px', letterSpacing: '-0.01em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              Payroll Run
              {sel && <RunStatusPill status={monthStatus} raw size="sm" />}
            </h1>
            <div style={{ fontSize: 13, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconBuilding size={14} /> {isGroup ? `Group Companies${monthRuns.length ? ` · ${monthRuns.length} compan${monthRuns.length === 1 ? 'y' : 'ies'}` : ''}` : (sel?.company_name || 'Company')}
            </div>
          </div>
          <ControlSelect label="Payroll month" icon={<IconMonth size={15} />} strong minWidth={180}
            value={monthVal} onChange={e => { setMonthVal(e.target.value); setResult(null) }}>
            {monthOpts.length === 0 && <option value="">No month created</option>}
            {monthOpts.map(r => <option key={r.month} value={String(r.month)}>{periodLabel(r)}</option>)}
          </ControlSelect>
        </div>
        {monthRuns.length > 0 && (
          <div style={{ marginTop: S.lg, paddingTop: S.md, borderTop: `1px solid ${TK.line}` }}>
            <ProcessStepper steps={runSteps(monthStatus)} compact />
          </div>
        )}
      </SectionCard>

      {rows && rows.length > 0 && (
        <FilterBar rows={rows} filter={filter} matched={shown.length} isGroup={isGroup}
          onChange={patch => setFilter(f => ({ ...f, ...patch }))}
          onClear={() => setFilter(EMPTY_FILTER)} />
      )}

      <Banner tone={banner.tone} title={banner.title} sub={banner.sub} />

      {rd && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: S.sm }}>
            <span style={{ fontSize: F.micro, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: C.muted }}>Readiness checks</span>
            <span style={{ fontSize: F.tiny, color: TK.faint }}>Red blocks pay for those people · amber is a heads-up · green is clear</span>
          </div>
          <ChipTabs>
            {rd.checks.map(c => (
              <Tab key={c.key} check={c} active={active?.key === c.key} onPick={() => setTab(c.key)} />
            ))}
          </ChipTabs>

          {active && <CheckPanel key={active.key} check={active} isGroup={isGroup} />}
        </>
      )}

      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}

      <ActionBar hint={hint} hintTone={hintTone}>
        <PButton variant="primary" size="lg" onClick={run} disabled={!canRun}
          icon={canRun || busy ? <IconPlay size={15} /> : <IconLock size={15} />}
          title={!canRun ? hint : undefined}>
          {runLabel}
        </PButton>
        <ActionDivider />
        <ActionGroup label="Downloads">
          {/* Available whenever the month has rows, not only after a clean run. The sheet
              was previously produced only as the last step of a successful run, so any
              failure earlier in the chain left HR with no numbers at all to look at. */}
          {(rows?.length ?? 0) > 0 && (
            <PButton icon={<IconDownload size={14} />}
              onClick={() => downloadSheet(shownCodes).catch(e => setErr('Sheet download failed: ' + (e?.message === 'nothing to export' && shownCodes ? 'nobody in this filter is in the month yet' : (e?.message || e))))}
              disabled={busy || (!!shownCodes && shownCodes.length === 0)}
              title={shownCodes ? `Only the ${shownCodes.length} employee${shownCodes.length === 1 ? '' : 's'} matching the filter` : 'Every employee in the month'}
            >Download sheet{shownCodes ? ` (${shownCodes.length})` : ''}</PButton>
          )}
          {calculated && (
            <PButton icon={<IconFile size={14} />} onClick={() => downloadRegister(shownCodes)} disabled={busy || (!!shownCodes && shownCodes.length === 0)}
              title={shownCodes ? `Only the ${shownCodes.length} employee${shownCodes.length === 1 ? '' : 's'} matching the filter` : 'Every employee in the month'}
            >Register{shownCodes ? ` (${shownCodes.length})` : ''}</PButton>
          )}
          {/* Payslips exist only for a calculated month; the server confirms payroll_lines
              are there and that the run is not older than its own inputs before anything
              is rendered. Re-mounted per month AND per run result, so a stale preflight
              never survives a month change or a re-run. */}
          {monthRuns.length > 0 && (
            <PayslipDownload key={`${monthRuns.map(r => r.id).join(',')}|${result ? `${result.processed}:${result.net}` : ''}`}
              runs={monthRuns.map(r => ({ id: r.id, company_name: r.company_name }))}
              enabled={calculated} busyOutside={busy} only={shownCodes} />
          )}
        </ActionGroup>
      </ActionBar>
    </div>
  )
}
