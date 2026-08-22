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
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK , CountUp } from '@/lib/ui'

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
  if (!d) return '—'
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
function Kpi({ label, value, accent, warn }: { label: string; value: string; accent?: string; warn?: boolean }) {
  return (
    <div style={{ background: warn ? C.amberBg : C.card, border: `1px solid ${warn ? C.amberBd : C.border}`, borderRadius: 12, padding: '13px 15px', boxShadow: '0 1px 4px rgba(37,99,235,0.05)', minWidth: 120 }}>
      <div style={{ fontSize: 9.5, color: warn ? C.amber : C.muted, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: accent || (warn ? C.amber : C.navy), lineHeight: 1 }}>{value}</div>
    </div>
  )
}
function Panel({ title, right, children, style }: { title: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '15px 17px', boxShadow: '0 1px 6px rgba(37,99,235,0.06)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: C.purple, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </div>
  )
}
function GenderDonut({ male, female, other }: { male: number; female: number; other: number }) {
  const total = male + female + other || 1
  const R = 34, CIRC = 2 * Math.PI * R
  const segs = [
    { v: male, c: C.purple, label: 'Male' },
    { v: female, c: C.pink, label: 'Female' },
    { v: other, c: TK.faint, label: 'Other' },
  ].filter(s => s.v > 0)
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={R} fill="none" stroke={C.gray} strokeWidth="15" />
        {segs.map((s, i) => {
          const len = (s.v / total) * CIRC
          const el = <circle key={i} cx="44" cy="44" r={R} fill="none" stroke={s.c} strokeWidth="15" strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset} transform="rotate(-90 44 44)" />
          offset += len
          return el
        })}
        <text x="44" y="48" textAnchor="middle" fontSize="15" fontWeight="800" fill={C.navy}>{total}</text>
      </svg>
      <div>
        {[['Male', male, C.purple], ['Female', female, C.pink], ['Other', other, TK.faint]].filter(r => (r[1] as number) > 0).map(([l, v, c]) => (
          <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, fontSize: 12, color: C.navy }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c as string }} />{l as string} — <b>{v as number}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PayrollDashboard({ companyId, fy, companies }: { companyId: string; fy: string; companies: { id: string; company_name: string; group_name?: string | null }[] }) {
  const monthOpts = fyMonthOptions(fy)
  const defMonth = monthOpts.find(m => m.value.startsWith('2026-07')) || monthOpts[3] || monthOpts[0]
  const [month, setMonth] = useState(defMonth.value)
  const [coFilter, setCoFilter] = useState(companyId)   // dashboard's own company filter (seeded from header)
  const [deptId, setDeptId] = useState('')
  const [depts, setDepts] = useState<{ id: string; dept_name: string; company_id: string }[]>([])

  // keep the dashboard's company filter in sync if the header company changes
  useEffect(() => { setCoFilter(companyId); setDeptId('') }, [companyId])

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
    if (coFilter) q = q.eq('company_id', coFilter)
    q.then(({ data }) => setDepts(data || []), () => setDepts([]))
  }, [coFilter])

  const load = useCallback(async () => {
    setLoading(true)
    // ── Employees (active, filtered) ──
    let eq = supabase.from('employees')
      .select('id, gender, department_id, company_id, created_at, full_name')
      .eq('employment_status', 'Active').neq('is_test', true)
    if (coFilter) eq = eq.eq('company_id', coFilter)
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
      const name = id === 'unassigned' ? 'Unassigned' : (deptName[id] || '—')
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
      if (coFilter) lq = lq.eq('company_id', coFilter)
      const { data: locs } = await lq
      const cm: Record<string, string> = {}; companies.forEach(c => { cm[c.id] = c.company_name })
      const bc: Record<string, number> = {}; (locs || []).forEach((l: any) => { bc[l.company_id] = (bc[l.company_id] || 0) + 1 })
      setBranches(Object.entries(bc).map(([id, count]) => ({ company: cm[id] || '—', count })).sort((a, b) => b.count - a.count))
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
      ;(revs || []).forEach((r: any) => acts.push({ text: `Salary updated — ${r.employees?.full_name || 'employee'}`, when: timeAgo(r.created_at), iso: r.created_at }))
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
      if (coFilter) rq = rq.eq('company_id', coFilter)
      const { data: runs } = await rq
      const statuses = Array.from(new Set((runs || []).map((r: any) => r.status).filter(Boolean)))
      setRunStatus(statuses.length ? statuses.join(', ') : '')
    } catch { setRunStatus('') }

    setLoading(false)
  }, [coFilter, deptId, fy, month, companies])

  useEffect(() => { load() }, [load])

  const selStyle: React.CSSProperties = { padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: TK.surface, color: C.navy, fontFamily: font, outline: 'none' }
  const maxDept = Math.max(1, ...deptCost.map(d => d.cost))

  return (
    <div style={{ fontFamily: font }}>
      {/* Filter bar — Company → Department cascade + Month */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Filters:</span>
        <select style={selStyle} value={coFilter} onChange={e => { setCoFilter(e.target.value); setDeptId('') }}>
          {(() => {
            const groups = Array.from(new Set(companies.map(c => c.group_name || 'Companies')))
            return <>
              <option value="">All companies</option>
              {groups.map(g => (
                <optgroup key={g} label={g}>
                  {companies.filter(c => (c.group_name || 'Companies') === g).map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </optgroup>
              ))}
            </>
          })()}
        </select>
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
        <select style={selStyle} value={month} onChange={e => setMonth(e.target.value)}>
          {monthOpts.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <span style={{ fontSize: 10.5, color: C.muted }}>FY set from the header above.</span>
        {loading && <span style={{ fontSize: 11, color: C.purple, marginLeft: 'auto' }}>Refreshing…</span>}
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi label="Headcount" value={String(kpi.headcount)} />
        <Kpi label="Total gross / mo" value={inrShort(kpi.gross)} accent={C.purpleD} />
        <Kpi label="Total basic / mo" value={inrShort(kpi.basic)} />
        <Kpi label="Statutory (employer)" value={inrShort(kpi.statutory)} />
        <Kpi label="Perquisites" value={inrShort(kpi.perquisites)} />
        <Kpi label="Bonus accrued" value={inrShort(kpi.bonus)} />
      </div>

      {/* Row 1: gender + dept cost + month status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr minmax(180px, 220px)', gap: 12, alignItems: 'stretch' }}>
          <Panel title="Gender split">
            {kpi.headcount === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No employees.</div> : <GenderDonut male={gender.male} female={gender.female} other={gender.other} />}
          </Panel>

          <Panel title="Department-wise cost (gross + statutory)">
            {deptCost.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No salary structures for this FY yet.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deptCost.map(d => (
                  <div key={d.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                      <span style={{ color: C.navy, fontWeight: 600 }}>{d.name}</span>
                      <span style={{ color: C.muted }}>{inrShort(d.cost)}</span>
                    </div>
                    <div style={{ height: 7, background: C.gray, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(3, (d.cost / maxDept) * 100)}%`, height: '100%', background: `linear-gradient(90deg,${TK.brand},${TK.brand})`, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Payroll month status">
            {runStatus
              ? <span style={{ fontSize: 12, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '5px 14px' }}>{runStatus}</span>
              : <div style={{ fontSize: 12, color: C.muted }}>No payroll run created yet. Create one in <b>Payroll Run</b>.</div>}
          </Panel>
        </div>
      </div>

      {/* Row 2: compliance + activity + branches */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <Panel title={`Compliance calendar · ${monthOpts.find(m => m.value === month)?.label || ''}`}>
          {compliance.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No statutory modules configured yet.</div> : (
            <div>
              {compliance.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < compliance.length - 1 ? `1px solid ${C.gray}` : 'none' }}>
                  <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700, minWidth: 52 }}>{fmtDate(e.date)}</span>
                  <span style={{ fontSize: 12, color: C.navy, textAlign: 'right' }}>{e.label}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent activity">
          {activity.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No recent activity.</div> : (
            <div>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: i < activity.length - 1 ? `1px solid ${C.gray}` : 'none' }}>
                  <span style={{ fontSize: 12, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
                  <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: 'nowrap' }}>{a.when}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Branches per company">
          {branches.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No branches.</div> : (
            <div>
              {branches.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < branches.length - 1 ? `1px solid ${C.gray}` : 'none' }}>
                  <span style={{ fontSize: 12, color: C.navy }}>{b.company}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.purpleD }}>{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
