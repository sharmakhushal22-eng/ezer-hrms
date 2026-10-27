'use client'
// components/payroll/PayrollDashboard.tsx — Payroll module home/landing page.
// Single-glance, read-only aggregation: headcount, cost, gender split, department cost,
// compliance calendar, recent activity, branches — filterable by company (from the page
// header) + department + month. Sourced from LIVE data that exists today (employees,
// salary_structures, locations) rather than the still-empty payroll_run snapshot tables;
// payroll-run status degrades to "No run yet". Every section is independently guarded so
// one missing source never blanks the whole page.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { companyFilter, scopedCompanies } from '@/lib/rms/resolve'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK , CountUp, F, W, S, R, money, numeric, eyebrow, tone,
  IconEmployees, IconPayroll, IconCompliance, IconBuilding, IconOnboarding, IconCalendar, IconAward, IconReports } from '@/lib/ui'
import {
  SectionCard, KpiTile, KpiGrid, FilterBar, FilterField, fieldStyle, ProcessStepper, runSteps, leastAdvanced,
  RunStatusPill, StatusPill, CountChip, EmptyState, IconTile, InfoCallout, humanStatus,
  IconLayers, IconInfo, IconArrowRight, IconMonth,
} from '@/components/payroll/kit'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint, pink: TK.critical,
  purpleBg: TK.brandTint, gray: TK.sunken, teal: TK.info,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0)

function inrShort(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}
const MONTHS_FY = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
function fyMonthOptions(fy: string) {
  const start = Number(String(fy).split('-')[0]) || 2026
  return MONTHS_FY.map((m, i) => {
    const cal = i <= 8 ? i + 4 : i - 8          // Apr=4 … Mar=3
    const yr = i <= 8 ? start : start + 1
    return { label: `${m} ${yr}`, value: `${yr}-${String(cal).padStart(2, '0')}-01` }
  })
}
function fmtDate(d: string | null) {
  if (!d) return '-'
  try { return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) } catch { return d }
}
function timeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const d = Math.floor(diff / 86400000)
    if (d <= 0) return 'today'
    if (d === 1) return '1d ago'
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30); return `${mo}mo ago`
  } catch { return '' }
}

// ── Presentational bits (defined outside parent) ──

// One horizontal flex row whose cards wrap on narrow widths instead of squeezing.
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.md, marginBottom: S.md, alignItems: 'stretch' }}>{children}</div>
}
function Col({ grow = 1, basis = 300, children }: { grow?: number; basis?: number; children: React.ReactNode }) {
  return <div style={{ flex: `${grow} 1 ${basis}px`, minWidth: `min(${basis}px, 100%)`, display: 'flex', flexDirection: 'column' }}>{children}</div>
}
function Panel({ title, icon, hint, right, children, style }: { title: string; icon?: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <SectionCard title={title} icon={icon} hint={hint} actions={right} style={{ marginBottom: 0, flex: 1, ...style }}>
      {children}
    </SectionCard>
  )
}
function GenderDonut({ male, female, other }: { male: number; female: number; other: number }) {
  const total = male + female + other || 1
  const R = 36, CIRC = 2 * Math.PI * R
  const segs = [
    { v: male, c: C.purple, label: 'Male' },
    { v: female, c: C.teal, label: 'Female' },
    { v: other, c: TK.faint, label: 'Other' },
  ].filter(s => s.v > 0)
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
        <circle cx="48" cy="48" r={R} fill="none" stroke={C.gray} strokeWidth="12" />
        {segs.map((s, i) => {
          const len = (s.v / total) * CIRC
          const el = <circle key={i} cx="48" cy="48" r={R} fill="none" stroke={s.c} strokeWidth="12" strokeDasharray={`${Math.max(0, len - 1.5)} ${CIRC - len + 1.5}`} strokeDashoffset={-offset} transform="rotate(-90 48 48)" />
          offset += len
          return el
        })}
        <text x="48" y="50" textAnchor="middle" fontSize="18" fontWeight="700" fill={C.navy} style={{ fontVariantNumeric: 'tabular-nums' }}>{total}</text>
        <text x="48" y="64" textAnchor="middle" fontSize="9" fontWeight="600" fill={C.muted} letterSpacing=".08em">PEOPLE</text>
      </svg>
      <div style={{ flex: 1, minWidth: 120 }}>
        {[['Male', male, C.purple], ['Female', female, C.teal], ['Other', other, TK.faint]].filter(r => (r[1] as number) > 0).map(([l, v, c]) => (
          <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: F.small, color: C.navy, borderBottom: `1px solid ${TK.line}` }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c as string, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{l as string}</span>
            <b style={{ ...numeric }}>{v as number}</b>
            <span style={{ ...numeric, color: C.muted, fontSize: F.tiny, width: 38, textAlign: 'right' }}>{Math.round(((v as number) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// What to do next for the run furthest behind. Text only; it names the screen to open.
function nextStepFor(status: string | null): { title: string; body: string; t: 'warning' | 'info' | 'positive' } {
  switch (status) {
    case null: return { t: 'warning', title: 'Create the first payroll month', body: 'Configuration → Payroll Month → Create Month builds the month master for each company.' }
    case 'OPEN': case 'SYNCED': return { t: 'info', title: 'Process attendance, then freeze the month', body: 'Attendance → upload / edit, then Configuration → Payroll Month → Freeze.' }
    case 'ATTENDANCE_LOCKED': return { t: 'info', title: 'Run payroll', body: 'Payroll Run → Run Cycle checks readiness and calculates every eligible employee.' }
    case 'CALCULATED': case 'AI_CHECKED': return { t: 'info', title: 'Review, download payslips and approve', body: 'Payroll Run → Run Cycle: download the sheet and register, then approve.' }
    case 'APPROVED': return { t: 'info', title: 'Disburse salaries', body: 'Send the bank file and mark the month disbursed.' }
    case 'DISBURSED': return { t: 'info', title: 'Lock the month', body: 'Payroll Run → Lock / Unlock makes the month immutable.' }
    case 'LOCKED': return { t: 'positive', title: 'Every run on record is closed', body: 'Nothing outstanding. Create the next month when attendance is ready.' }
    default: return { t: 'info', title: humanStatus(status), body: 'Open Payroll Run to continue.' }
  }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const t = new Date(d + (d.length === 10 ? 'T00:00:00' : '')).getTime()
  if (Number.isNaN(t)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86400000)
}

export default function PayrollDashboard({ companyId, fy, companies }: { companyId: string; fy: string; companies: { id: string; company_name: string; group_name?: string | null }[] }) {
  const { grant } = useGrant()
  // Non-cross-company users see only their own company in the dropdown.
  const scopedCos = scopedCompanies(grant, companies)
  const monthOpts = fyMonthOptions(fy)
  const defMonth = monthOpts.find(m => m.value.startsWith('2026-07')) || monthOpts[3] || monthOpts[0]
  const [month, setMonth] = useState(defMonth.value)
  const [coFilter, setCoFilter] = useState(companyId)   // dashboard's own company filter (seeded from header)
  const [deptId, setDeptId] = useState('')
  const [depts, setDepts] = useState<{ id: string; dept_name: string; company_id: string }[]>([])

  // keep the dashboard's company filter in sync if the header company changes; a
  // non-cross-company user is forced onto their own company, never "All".
  useEffect(() => {
    setCoFilter(!grant.crossCompany && grant.companyId ? grant.companyId : companyId)
    setDeptId('')
  }, [companyId, grant]) // eslint-disable-line react-hooks/exhaustive-deps

  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState({ headcount: 0, gross: 0, basic: 0, statutory: 0, perquisites: 0, bonus: 0 })
  const [gender, setGender] = useState({ male: 0, female: 0, other: 0 })
  const [deptCost, setDeptCost] = useState<{ name: string; cost: number }[]>([])
  const [branches, setBranches] = useState<{ company: string; count: number }[]>([])
  const [activity, setActivity] = useState<{ text: string; when: string; iso: string }[]>([])
  const [compliance, setCompliance] = useState<{ date: string; label: string }[]>([])
  const [runStatus, setRunStatus] = useState<string>('')

  // department options cascade from the selected company
  useEffect(() => {
    let q = supabase.from('departments').select('id, dept_name, company_id').eq('status', 'Active').order('dept_name')
    { const co = companyFilter(grant, coFilter); if (co) q = q.eq('company_id', co) }
    q.then(({ data }) => setDepts(data || []), () => setDepts([]))
  }, [coFilter, grant]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    // ── Employees (active, filtered) ──
    let eq = supabase.from('employees')
      .select('id, gender, department_id, company_id, created_at, full_name')
      .eq('employment_status', 'Active').neq('is_test', true)
    { const co = companyFilter(grant, coFilter); if (co) eq = eq.eq('company_id', co) }
    if (deptId) eq = eq.eq('department_id', deptId)
    const { data: emps } = await eq
    const empList = emps || []
    const empIds = new Set(empList.map(e => e.id))
    const deptOf: Record<string, string> = {}; empList.forEach(e => { deptOf[e.id] = e.department_id })

    // gender split
    const g = { male: 0, female: 0, other: 0 }
    empList.forEach(e => {
      const v = (e.gender || '').toString().toLowerCase()
      if (v.startsWith('m')) g.male++; else if (v.startsWith('f')) g.female++; else g.other++
    })

    // ── Salary structures (latest per employee for the FY) → cost ──
    let gross = 0, basic = 0, statutory = 0
    const deptCostMap: Record<string, number> = {}
    try {
      const { data: ss } = await supabase.from('salary_structures')
        .select('employee_id, basic_monthly, hra_monthly, gross_monthly, employer_pf, employer_esic, effective_date, fy')
        .eq('fy', fy).order('effective_date', { ascending: false })
      const latest: Record<string, any> = {}
      ;(ss || []).forEach(r => { if (empIds.has(r.employee_id) && !latest[r.employee_id]) latest[r.employee_id] = r })
      Object.values(latest).forEach((r: any) => {
        const cost = num(r.gross_monthly) + num(r.employer_pf) + num(r.employer_esic)
        gross += num(r.gross_monthly); basic += num(r.basic_monthly)
        statutory += num(r.employer_pf) + num(r.employer_esic)
        const d = deptOf[r.employee_id] || 'unassigned'
        deptCostMap[d] = (deptCostMap[d] || 0) + cost
      })
    } catch { /* salary structures optional */ }

    // dept names
    const deptName: Record<string, string> = {}
    try {
      const { data: allDepts } = await supabase.from('departments').select('id, dept_name')
      ;(allDepts || []).forEach((d: any) => { deptName[d.id] = d.dept_name })
    } catch { /* ignore */ }
    // Costs accumulate per department ID, but each company has its own
    // departments row — so "Sales & Marketing" exists several times with
    // different IDs. Mapping IDs straight to names produced two rows with the
    // same label and different figures, which read as a bug and gave React
    // duplicate keys. Fold by name once the names are known: in a group view
    // "Sales & Marketing" means the function across the group.
    const byName: Record<string, number> = {}
    Object.entries(deptCostMap).forEach(([id, cost]) => {
      const name = id === 'unassigned' ? 'Unassigned' : (deptName[id] || '-')
      byName[name] = (byName[name] || 0) + cost
    })
    const deptCostArr = Object.entries(byName)
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost).slice(0, 6)

    // ── Bonus (empty today → 0) ──
    let bonus = 0
    try {
      const { data: ba } = await supabase.from('bonus_accrual').select('employee_id, bonus_accrued')
      ;(ba || []).forEach((r: any) => { if (empIds.has(r.employee_id)) bonus += num(r.bonus_accrued) })
    } catch { /* bonus optional */ }

    // ── Perquisites (per-employee amounts, if configured) ──
    let perquisites = 0
    try {
      const { data: pq } = await supabase.from('employee_perquisites').select('employee_id, amount, fy').eq('fy', fy)
      ;(pq || []).forEach((r: any) => { if (empIds.has(r.employee_id)) perquisites += num(r.amount) })
    } catch { /* perquisites optional */ }

    setKpi({ headcount: empList.length, gross, basic, statutory, perquisites, bonus })
    setGender(g)
    setDeptCost(deptCostArr)

    // ── Branches per company ──
    try {
      let lq = supabase.from('locations').select('company_id').eq('status', 'Active')
      { const co = companyFilter(grant, coFilter); if (co) lq = lq.eq('company_id', co) }
      const { data: locs } = await lq
      const cm: Record<string, string> = {}; companies.forEach(c => { cm[c.id] = c.company_name })
      const bc: Record<string, number> = {}; (locs || []).forEach((l: any) => { bc[l.company_id] = (bc[l.company_id] || 0) + 1 })
      setBranches(Object.entries(bc).map(([id, count]) => ({ company: cm[id] || '-', count })).sort((a, b) => b.count - a.count))
    } catch { setBranches([]) }

    // ── Recent activity: new joiners + salary revisions ──
    try {
      const acts: { text: string; when: string; iso: string }[] = []
      const { data: joiners } = await supabase.from('employees')
        .select('full_name, created_at').eq('employment_status', 'Active').neq('is_test', true)
        .order('created_at', { ascending: false }).limit(6)
      ;(joiners || []).forEach((j: any) => acts.push({ text: `${j.full_name} joined`, when: timeAgo(j.created_at), iso: j.created_at }))
      const { data: revs } = await supabase.from('salary_structures')
        .select('employee_id, created_at, employees(full_name)').order('created_at', { ascending: false }).limit(6)
      ;(revs || []).forEach((r: any) => acts.push({ text: `Salary updated: ${r.employees?.full_name || 'employee'}`, when: timeAgo(r.created_at), iso: r.created_at }))
      acts.sort((a, b) => (b.iso || '').localeCompare(a.iso || ''))
      setActivity(acts.slice(0, 7))
    } catch { setActivity([]) }

    // ── Compliance calendar (RPC-driven; each guarded) ──
    const events: { date: string; label: string }[] = []
    const push = async (fn: Promise<{ data: any; error: any }>, label: string, pick?: (d: any) => string | null) => {
      try { const { data, error } = await fn; if (!error && data) { const dt = pick ? pick(data) : data; if (dt) events.push({ date: dt as string, label }) } } catch { /* skip */ }
    }
    await push(supabase.rpc('get_tds_deposit_due_date', { p_period_month: month }), 'TDS deposit')
    await push(supabase.rpc('get_esic_deposit_due_date', { p_period_month: month }), 'ESIC deposit')
    await push(supabase.rpc('get_iw_return_due_date', { p_period_month: month }), 'PF / IW return')
    await push(supabase.rpc('get_tds_quarterly_return_due_date', { p_period_month: month }), 'Form 24Q (quarter)', (d) => Array.isArray(d) ? d[0]?.return_due_date : d?.return_due_date)
    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    setCompliance(events)

    // ── Payroll month status (runs are empty today) ──
    try {
      let rq = supabase.from('payroll_runs').select('status')
      { const co = companyFilter(grant, coFilter); if (co) rq = rq.eq('company_id', co) }
      const { data: runs } = await rq
      const statuses = Array.from(new Set((runs || []).map((r: any) => r.status).filter(Boolean)))
      setRunStatus(statuses.length ? statuses.join(', ') : '')
    } catch { setRunStatus('') }

    setLoading(false)
  }, [coFilter, deptId, fy, month, companies, grant]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const selStyle: React.CSSProperties = { ...fieldStyle, cursor: 'pointer' }
  const maxDept = Math.max(1, ...deptCost.map(d => d.cost))
  const deptTotal = deptCost.reduce((n, d) => n + d.cost, 0) || 1
  const statuses = runStatus ? runStatus.split(', ').filter(Boolean) : []
  const behind = leastAdvanced(statuses)
  const next = nextStepFor(behind)
  const monthLabel = monthOpts.find(m => m.value === month)?.label || ''
  const firstDue = compliance.find(e => (daysUntil(e.date) ?? -1) >= 0) || null
  const firstDueIn = firstDue ? daysUntil(firstDue.date) : null

  return (
    <div style={{ fontFamily: font }}>
      {/* Filter bar — Company → Department cascade + Month */}
      <FilterBar label="Filters" active={!!deptId}
        summary={<>Compliance dates for <b>{monthLabel}</b>. FY set from the header above.{loading && <span style={{ color: C.purple, marginLeft: 8, fontWeight: 600 }}>Refreshing…</span>}</>}>
        <FilterField label="Company" minWidth={240}>
          <select style={selStyle} value={coFilter} onChange={e => { setCoFilter(e.target.value); setDeptId('') }}>
            {(() => {
              const groups = Array.from(new Set(scopedCos.map(c => c.group_name || 'Companies')))
              return <>
                {grant.crossCompany && <option value="">All companies</option>}
                {groups.map(g => (
                  <optgroup key={g} label={g}>
                    {scopedCos.filter(c => (c.group_name || 'Companies') === g).map(c => (
                      <option key={c.id} value={c.id}>{c.company_name}</option>
                    ))}
                  </optgroup>
                ))}
              </>
            })()}
          </select>
        </FilterField>
        <FilterField label="Department" minWidth={200}>
          <select style={selStyle} value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">All departments</option>
            {coFilter
              ? depts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)
              : (() => {
                  // All companies → group departments under their company so duplicate names aren't ambiguous
                  const cm: Record<string, string> = {}; companies.forEach(c => { cm[c.id] = c.company_name })
                  const byCo: Record<string, typeof depts> = {}
                  depts.forEach(d => { (byCo[d.company_id] = byCo[d.company_id] || []).push(d) })
                  return Object.entries(byCo).map(([cid, ds]) => (
                    <optgroup key={cid} label={cm[cid] || 'Company'}>
                      {ds.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
                    </optgroup>
                  ))
                })()}
          </select>
        </FilterField>
        <FilterField label="Month" minWidth={150}>
          <select style={selStyle} value={month} onChange={e => setMonth(e.target.value)}>
            {monthOpts.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </FilterField>
      </FilterBar>

      {/* KPI row */}
      <KpiGrid min={140}>
        <KpiTile label="Headcount" value={<CountUp value={kpi.headcount} />}
          sub={`${gender.male} M · ${gender.female} F${gender.other ? ` · ${gender.other} other` : ''}`} />
        <KpiTile label="Total gross / mo" emphasis t="brand" value={inrShort(kpi.gross)}
          sub={kpi.headcount ? `avg ${inrShort(kpi.gross / kpi.headcount)} per head` : money(kpi.gross)} title={money(kpi.gross)} />
        <KpiTile label="Total basic / mo" value={inrShort(kpi.basic)} title={money(kpi.basic)}
          sub={kpi.gross ? `${Math.round((kpi.basic / kpi.gross) * 100)}% of gross` : money(kpi.basic)}
          progress={kpi.gross ? kpi.basic / kpi.gross : 0} />
        <KpiTile label="Statutory (employer)" t="info" value={inrShort(kpi.statutory)} title={money(kpi.statutory)}
          sub="Employer PF + ESIC" />
        <KpiTile label="Employer cost / mo" value={inrShort(kpi.gross + kpi.statutory)} title={money(kpi.gross + kpi.statutory)} sub="Gross + employer statutory" />
        <KpiTile label="Perquisites" value={inrShort(kpi.perquisites)} title={money(kpi.perquisites)} sub={`FY ${fy}`} />
        <KpiTile label="Bonus accrued" value={inrShort(kpi.bonus)} title={money(kpi.bonus)} sub="Accrued to date" />
      </KpiGrid>

      {/* Row 1: month status + next action | compliance */}
      <Row>
        <Col grow={2} basis={460}>
          <Panel title="Payroll month status" icon={<IconMonth size={16} />}
            hint={statuses.length ? 'Run statuses on record; the rail follows the run furthest behind.' : 'No payroll run on record yet.'}
            right={statuses.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{statuses.map(st => <RunStatusPill key={st} status={st} raw size="sm" />)}</div> : undefined}>
            {runStatus
              ? <div style={{ marginBottom: S.lg }}><ProcessStepper steps={runSteps(behind)} /></div>
              : <div style={{ fontSize: 12, color: C.muted, marginBottom: S.md }}>No payroll run created yet. Create one in <b>Payroll Run</b>.</div>}
            <InfoCallout t={next.t} compact title={next.title} icon={<IconArrowRight size={14} />} style={{ marginBottom: 0 }}>{next.body}</InfoCallout>
          </Panel>
        </Col>
        <Col basis={300}>
          <Panel title={`Compliance calendar · ${monthLabel}`} icon={<IconCalendar size={16} />}
            hint={firstDue && firstDueIn != null ? <>Next: <b>{firstDue.label}</b> {firstDueIn === 0 ? 'today' : `in ${firstDueIn} day${firstDueIn === 1 ? '' : 's'}`}</> : 'Statutory due dates for the month.'}>
            {compliance.length === 0 ? <EmptyState compact t="neutral" icon={<IconCalendar size={20} />} title="No statutory modules configured yet." /> : (
              <div>
                {compliance.map((e, i) => {
                  const dd = daysUntil(e.date)
                  const t = dd == null ? 'neutral' : dd < 0 ? 'neutral' : dd <= 7 ? 'warning' : 'info'
                  const [day, mon] = fmtDate(e.date).split(' ')
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < compliance.length - 1 ? `1px solid ${TK.line}` : 'none' }}>
                      <div style={{ width: 44, flexShrink: 0, textAlign: 'center', borderRadius: R.md, background: tone(t).bg, border: `1px solid ${tone(t).edge}`, padding: '4px 0' }}>
                        <div style={{ fontSize: F.lead, fontWeight: W.bold, color: tone(t).fg, lineHeight: 1.1, ...numeric }}>{day}</div>
                        <div style={{ fontSize: 10, fontWeight: W.semi, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{mon || ''}</div>
                      </div>
                      <span style={{ flex: 1, fontSize: F.small, color: C.navy, fontWeight: W.medium }}>{e.label}</span>
                      {dd != null && <span style={{ fontSize: F.tiny, color: dd < 0 ? TK.faint : dd <= 7 ? C.amber : C.muted, whiteSpace: 'nowrap', ...numeric }}>{dd < 0 ? 'passed' : dd === 0 ? 'today' : `in ${dd}d`}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </Col>
      </Row>

      {/* Row 2: dept cost | gender */}
      <Row>
        <Col grow={2} basis={460}>
          <Panel title="Department-wise cost (gross + statutory)" icon={<IconReports size={16} />} hint="Top departments by monthly cost.">
            {deptCost.length === 0 ? <EmptyState compact t="neutral" icon={<IconLayers size={20} />} title="No salary structures for this FY yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {deptCost.map((d, i) => (
                  <div key={d.name}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: F.small, marginBottom: 5 }}>
                      <span style={{ color: C.navy, fontWeight: W.semi, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <span style={{ color: C.muted, fontSize: F.tiny, ...numeric }}>{Math.round((d.cost / deptTotal) * 100)}%</span>
                      <span style={{ color: C.navy, fontWeight: W.semi, minWidth: 72, textAlign: 'right', ...numeric }} title={money(d.cost)}>{inrShort(d.cost)}</span>
                    </div>
                    <div style={{ height: 8, background: C.gray, borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(3, (d.cost / maxDept) * 100)}%`, height: '100%', background: i === 0 ? TK.brand : `color-mix(in srgb, ${TK.brand} 62%, ${TK.surface})`, borderRadius: 99, transition: 'width .4s cubic-bezier(.22,1,.36,1)' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </Col>
        <Col basis={300}>
          <Panel title="Gender split" icon={<IconEmployees size={16} />}>
            {kpi.headcount === 0 ? <EmptyState compact t="neutral" icon={<IconEmployees size={20} />} title="No employees." /> : <GenderDonut male={gender.male} female={gender.female} other={gender.other} />}
          </Panel>
        </Col>
      </Row>

      {/* Row 3: activity + branches */}
      <Row>
        <Col grow={2} basis={460}>
          <Panel title="Recent activity" icon={<IconInfo size={16} />}>
            {activity.length === 0 ? <EmptyState compact t="neutral" title="No recent activity." /> : (
              <div>
                {activity.map((a, i) => {
                  const joined = a.text.endsWith(' joined')
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < activity.length - 1 ? `1px solid ${TK.line}` : 'none' }}>
                      <IconTile icon={joined ? <IconOnboarding size={13} /> : <IconPayroll size={13} />} t={joined ? 'positive' : 'brand'} size={26} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: F.small, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
                      <span style={{ fontSize: F.tiny, color: C.muted, whiteSpace: 'nowrap', ...numeric }}>{a.when}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </Col>
        <Col basis={300}>
          <Panel title="Branches per company" icon={<IconBuilding size={16} />}>
            {branches.length === 0 ? <EmptyState compact t="neutral" title="No branches." /> : (
              <div>
                {branches.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < branches.length - 1 ? `1px solid ${TK.line}` : 'none' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: F.small, color: C.navy }}>{b.company}</span>
                    <CountChip t="brand">{b.count}</CountChip>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </Col>
      </Row>
    </div>
  )
}
