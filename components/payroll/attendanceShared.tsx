'use client'
// components/payroll/attendanceShared.tsx — shared primitives for the Attendance tab
// (Attendance Upload · OT Upload · Attendance Edit). Palette + searchable dropdowns +
// the bulk-paste employee-code multi-select + the "% checking" validation animation card.
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, loadCompanies, MONTHS, type PayrollRun } from '@/lib/payroll/core'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

export const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint, amber: TK.warning, amberBg: TK.warningTint,
  purpleBg: TK.brandTint, gray: TK.sunken,
}
export const font = '"DM Sans","Segoe UI",sans-serif'
export const num = (v: any) => { const n = Number(v); return isNaN(n) ? null : n }
export const ddInp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${TK.brandEdge}`, borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', background: TK.surface, color: C.navy, fontFamily: font, outline: 'none' }
export const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 }
export type Opt = { value: string; label: string }
export const GROUP = '__group__'   // Company dropdown sentinel → all companies at once

// Split a pasted / typed blob of codes into clean tokens.
// Handles "OXYZO680,\nOXYZO741,\n OXYZO1013 , OXYZO1022" and the like.
export const splitCodes = (text: string): string[] =>
  text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean)

// ── Searchable single-select ────────────────────────────────────────
export function SearchSelect({ value, options, placeholder, onChange, disabled }: { value: string; options: Opt[]; placeholder: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const sel = options.find(o => o.value === value)
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { if (!disabled) { setOpen(o => !o); setQ('') } }}
        style={{ ...ddInp, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', color: sel ? C.navy : TK.faint, background: disabled ? TK.sunken: TK.surface }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? sel.label : placeholder}</span>
        <span style={{ color: TK.faint, fontSize: 11 }}></span>
      </div>
      {open && !disabled && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 200, background: TK.surface, border: `1px solid ${TK.brandEdge}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.18)', zIndex: 501, overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: `1px solid ${TK.brandEdge}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: font }} />
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: TK.faint }}>No matches</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', background: o.value === value ? TK.brandTint : TK.surface, color: C.navy }}>{o.label}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Searchable multi-select (chips) — for employee codes.
// Accepts a pasted / typed bulk list (comma / newline / space separated),
// e.g. "OXYZO680, OXYZO741, OXYZO1013" → four chips at once.
export function MultiSelect({ values, options, placeholder, onChange }: { values: string[]; options: Opt[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])

  // Add many tokens at once, canonicalising each against the option list
  // (case-insensitive) and de-duplicating against what's already selected.
  const addTokens = (text: string) => {
    const byUpper = new Map(options.map(o => [o.value.toUpperCase(), o.value]))
    const next = [...values]
    for (const tok of splitCodes(text)) {
      const canon = byUpper.get(tok.toUpperCase()) ?? tok
      if (!next.includes(canon)) next.push(canon)
    }
    if (next.length !== values.length) onChange(next)
    setQ('')
  }
  const onQChange = (v: string) => { if (/[\s,;]/.test(v)) addTokens(v); else setQ(v) }

  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQ('') }}
        style={{ ...ddInp, cursor: 'pointer', minHeight: 36, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {values.length === 0 && <span style={{ color: TK.faint }}>{placeholder}</span>}
        {values.map(v => (
          <span key={v} onClick={e => { e.stopPropagation(); toggle(v) }} style={{ fontSize: 11, background: C.purpleBg, color: C.purpleD, borderRadius: 99, padding: '2px 8px', fontWeight: 700 }}>{v} ✕</span>
        ))}
        <span style={{ marginLeft: 'auto', color: TK.faint, fontSize: 11 }}></span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 240, background: TK.surface, border: `1px solid ${TK.brandEdge}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.18)', zIndex: 501, overflow: 'hidden' }}>
            <input autoFocus value={q}
              onChange={e => onQChange(e.target.value)}
              onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t)) { e.preventDefault(); addTokens(t) } }}
              onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); addTokens(q) } }}
              placeholder="Search or paste codes (comma / newline separated)…"
              style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: `1px solid ${TK.brandEdge}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: font }} />
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: TK.faint }}>Press Enter to add “{q.trim()}”</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => toggle(o.value)}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, background: values.includes(o.value) ? TK.brandTint : TK.surface, color: C.navy }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {values.includes(o.value) && <span style={{ color: C.green }}></span>}
                </div>
              ))}
            </div>
            {values.length > 0 && (
              <div style={{ borderTop: `1px solid ${TK.brandEdge}`, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: C.muted }}>{values.length} selected</span>
                <span onClick={() => onChange([])} style={{ fontSize: 10.5, color: C.red, cursor: 'pointer', fontWeight: 700 }}>Clear all</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Month/date helpers, shared by the Attendance and OT download sheets ──
export function monthMeta(period: string) {
  const [py, pm] = String(period).slice(0, 7).split('-').map(Number)
  const start = Date.UTC(py, pm - 1, 1)
  const end = Date.UTC(py, pm, 0)                 // last day of the month
  return { py, pm, start, end, daysInMonth: new Date(end).getUTCDate() }
}
export const toMs = (d: string | null) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return (y && m && dd) ? Date.UTC(y, m - 1, dd) : null }

// Max Days — the maximum days salary can be paid for in the month, capped by the leaving
// date. DOL 15-Apr → 15; no leaving this month → the full month (30/31/28).
export function maxDaysLive(dol: string | null, period: string | null): number | null {
  if (!period) return null
  const { start, end, daysInMonth } = monthMeta(period)
  const dl = toMs(dol)
  if (dl != null && dl >= start && dl <= end) return new Date(dl).getUTCDate()
  return daysInMonth
}

// Dates in the sheets read as DD-MM-YY (e.g. 2018-09-24 → 24-09-18).
export function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  if (!y || !m || !dd) return ''
  return `${dd}-${m}-${y.slice(2)}`
}

// Calendar 1st-of-month for a run, from fy + month (same math as the server's v_period).
export function runPeriodISO(fy: string | null, month: number | null): string | null {
  if (!fy || !month) return null
  const startYr = Number(String(fy).split('-')[0])
  const cal = month <= 9 ? month + 3 : month - 9
  const yr = month <= 9 ? startYr : startYr + 1
  return `${yr}-${String(cal).padStart(2, '0')}-01`
}

export type SheetCtx = { isGroup: boolean; companyName: string; periodLabel: string; periodISO: string | null; doj: string | null; dol: string | null }

// ── Download card — the inline filter block used by BOTH the Attendance and the OT
// uploaders. Identical UI and behaviour (company / month / location / department /
// employee codes, Group Companies mode, live employee-master join, Employee-type only);
// only the sheet's columns differ, supplied by the caller's buildRow.
export function DownloadCard({ companyId, fy, heading, note, filePrefix, sheetName, buildRow }: {
  companyId: string; fy: string; heading: string; note: string; filePrefix: string; sheetName: string
  buildRow: (snapRow: any, ctx: SheetCtx) => Record<string, any>
}) {
  const [dlBusy, setDlBusy] = useState(false)
  const [dlErr, setDlErr] = useState('')
  const [dlCompany, setDlCompany] = useState('')
  const [dlRunId, setDlRunId] = useState('')
  const [dlLoc, setDlLoc] = useState('')
  const [dlDept, setDlDept] = useState('')
  const [dlEmpCodes, setDlEmpCodes] = useState<string[]>([])
  const [companies, setCompanies] = useState<Opt[]>([])
  const [allRuns, setAllRuns] = useState<PayrollRun[]>([])
  const [locOpts, setLocOpts] = useState<Opt[]>([])
  const [deptOpts, setDeptOpts] = useState<Opt[]>([])
  const [empOpts, setEmpOpts] = useState<Opt[]>([])

  useEffect(() => {
    loadCompanies().then(cs => setCompanies((cs as any[]).map(c => ({ value: c.id, label: c.company_name })))).catch(() => {})
    loadRuns('', fy).then(setAllRuns).catch(() => {})
  }, [fy])
  useEffect(() => { setDlCompany(companyId || GROUP) }, [companyId])

  useEffect(() => {
    if (!dlCompany) { setLocOpts([]); setDeptOpts([]); setEmpOpts([]); setDlRunId(''); return }
    const grp = dlCompany === GROUP
    const scope = (q: any) => grp ? q : q.eq('company_id', dlCompany)
    scope(supabase.from('locations').select('id, location_name').eq('status', 'Active').order('location_name'))
      .then(({ data }: any) => setLocOpts((data || []).map((l: any) => ({ value: l.id, label: l.location_name }))))
    scope(supabase.from('departments').select('id, dept_name').eq('status', 'Active').order('dept_name'))
      .then(({ data }: any) => setDeptOpts((data || []).map((d: any) => ({ value: d.id, label: d.dept_name }))))
    scope(supabase.from('employees').select('emp_code, full_name').neq('is_test', true).order('emp_code'))
      .then(({ data }: any) => setEmpOpts((data || []).filter((e: any) => e.emp_code).map((e: any) => ({ value: e.emp_code, label: `${e.emp_code} — ${e.full_name}` }))))
    setDlLoc(''); setDlDept(''); setDlEmpCodes([])
    if (grp) {
      const firstMonth = allRuns.map(r => r.month).sort((a, b) => (a || 0) - (b || 0))[0]
      setDlRunId(firstMonth != null ? String(firstMonth) : '')
    } else {
      const first = allRuns.find(r => r.company_id === dlCompany)
      setDlRunId(first ? first.id : '')
    }
  }, [dlCompany, allRuns])

  const isGroup = dlCompany === GROUP
  const dlRunOptions: Opt[] = isGroup
    ? Array.from(new Map(allRuns.map(r => [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }])).values()).sort((a, b) => Number(a.value) - Number(b.value))
    : allRuns.filter(r => r.company_id === dlCompany).map(r => ({ value: r.id, label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }))

  async function download() {
    if (!dlRunId) { setDlErr('Pick a month first.'); return }
    setDlBusy(true); setDlErr('')
    try {
      const grpRuns = isGroup ? allRuns.filter(r => String(r.month) === dlRunId) : allRuns.filter(r => r.id === dlRunId)
      const runIds = grpRuns.map(r => r.id)
      const coName: Record<string, string> = {}; const coPeriod: Record<string, string> = {}; const coPeriodISO: Record<string, string> = {}
      grpRuns.forEach(r => {
        coName[r.id] = r.company_name || ''
        coPeriod[r.id] = r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`
        coPeriodISO[r.id] = runPeriodISO(r.fy, r.month) || ''
      })
      const period = grpRuns[0]?.period_label || ''
      const { data: snap, error } = await supabase.from('payroll_employee_snapshot')
        .select('run_id, employee_id, employee_code, full_name, department, designation, days_in_month, paid_days, earned_leave, casual_leave, sick_leave, other_leave, absent_days, ot_hours')
        .in('run_id', runIds).order('employee_code')
      if (error) throw new Error(error.message)
      let list = snap || []

      // DOJ / DOL / employment_type come LIVE from the employee master (the snapshot's
      // copies can be NULL on older months). Only real "Employee" types are included.
      const ids = Array.from(new Set(list.map((r: any) => r.employee_id)))
      const master: Record<string, any> = {}
      for (let i = 0; i < ids.length; i += 300) {
        const { data: emp } = await supabase.from('employees')
          .select('id, company_doj, date_of_leaving, last_working_date, relieving_date, employment_type')
          .in('id', ids.slice(i, i + 300))
        ;(emp || []).forEach((e: any) => { master[e.id] = e })
      }
      list = list.filter((r: any) => master[r.employee_id]?.employment_type === 'Employee')

      if (dlLoc || dlDept || dlEmpCodes.length) {
        let q = supabase.from('employees').select('id')
        if (!isGroup) q = q.eq('company_id', dlCompany)
        if (dlLoc) q = q.eq('location_id', dlLoc)
        if (dlDept) q = q.eq('department_id', dlDept)
        if (dlEmpCodes.length) q = q.in('emp_code', dlEmpCodes)
        const { data: matchedEmp } = await q
        const allow = new Set((matchedEmp || []).map((e: any) => e.id))
        list = list.filter((r: any) => allow.has(r.employee_id))
      }
      if (list.length === 0) { setDlErr('No matching Employee-type employees for these filters.'); setDlBusy(false); return }

      const sheet = list.map((r: any) => {
        const m = master[r.employee_id] || {}
        return buildRow(r, {
          isGroup,
          companyName: coName[r.run_id] || '',
          periodLabel: coPeriod[r.run_id] || period,
          periodISO: coPeriodISO[r.run_id] || null,
          doj: m.company_doj || null,
          dol: m.date_of_leaving || m.last_working_date || m.relieving_date || null,
        })
      })
      const ws = XLSX.utils.json_to_sheet(sheet)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      XLSX.writeFile(wb, `${filePrefix}_${safe(isGroup ? 'Group' : (grpRuns[0]?.company_name || ''))}_${safe(period)}.xlsx`.replace(/_+/g, '_'))
    } catch (e: any) { setDlErr('Download failed: ' + (e.message || e)) } finally { setDlBusy(false) }
  }

  const dlCompanyName = isGroup ? 'all companies' : (companies.find(c => c.value === dlCompany)?.label || '')
  const dlPeriod = isGroup
    ? (dlRunOptions.find(o => o.value === dlRunId)?.label || '')
    : (allRuns.find(r => r.id === dlRunId)?.period_label || '')

  return (
    <div style={{ background: C.card, border: `1px solid ${C.greenBd}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(5,150,105,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: C.greenBg, border: `1px solid ${C.greenBd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}></span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.navy }}>{heading}</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{note}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div><label style={lbl}>Company</label><SearchSelect value={dlCompany} options={[{ value: GROUP, label: 'Group Companies (all)' }, ...companies]} placeholder="Select company" onChange={setDlCompany} /></div>
        <div><label style={lbl}>Month</label><SearchSelect value={dlRunId} options={dlRunOptions} placeholder={dlRunOptions.length ? 'Select month' : 'No month created'} onChange={setDlRunId} /></div>
        <div><label style={lbl}>Location</label><SearchSelect value={dlLoc} options={[{ value: '', label: 'All locations' }, ...locOpts]} placeholder="All locations" onChange={setDlLoc} /></div>
        <div><label style={lbl}>Department</label><SearchSelect value={dlDept} options={[{ value: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" onChange={setDlDept} /></div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Employee codes <span style={{ textTransform: 'none', fontWeight: 400, color: C.muted }}>(optional — leave empty for all; paste a comma / newline list to add many)</span></label>
        <MultiSelect values={dlEmpCodes} options={empOpts} placeholder="All employees" onChange={setDlEmpCodes} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={download} disabled={dlBusy || !dlRunId}
          style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: dlBusy || !dlRunId ? 'not-allowed' : 'pointer', opacity: dlBusy || !dlRunId ? 0.6 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
          {dlBusy ? 'Preparing…' : '⬇ Download'}
        </button>
        {dlRunId && <span style={{ fontSize: 11.5, color: C.purpleD }}>month master for <b>{dlCompanyName}</b> for <b>{dlPeriod}</b>{(dlLoc || dlDept || dlEmpCodes.length) ? ' · filtered' : ''}</span>}
      </div>
      {dlErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 7, padding: '8px 10px', marginTop: 10 }}>{dlErr}</div>}
    </div>
  )
}

// A failed sheet rule for one employee. `rule` names the quantity that broke the
// ceiling ("Paid Days" / "Total Days"), so one card can report several rules at once.
export type Violation = { code: string; rule: string; actual: number; max: number }

// ── The staged "% checking" validation card (Process / Cancel) ──
// Mirrors the Create Month Master progress experience: a green bar that fills
// over at least ten seconds with a live percentage and a stage caption.
// Any Paid Days > Max Days violation is a hard block — Process stays disabled.
export function ValidationCard({ pct, checking, stage, total, matched, unmatched, violations, onProcess, onCancel, busy, kind, strictUnmatched }: {
  pct: number; checking: boolean; stage: string; total: number
  matched: string[]; unmatched: string[]; violations: Violation[]
  onProcess: () => void; onCancel: () => void; busy: boolean; kind: string
  // When set, a code that is not in this month's master is an extra row and is
  // treated as a hard failure rather than a skipped line.
  strictUnmatched?: boolean
}) {
  const blocked = violations.length > 0 || (!!strictUnmatched && unmatched.length > 0)
  return (
    <div style={{ background: C.card, border: `1px solid ${blocked && !checking ? '#FECACA' : C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
        {checking ? `Checking ${kind} sheet…` : blocked ? 'Validation failed' : `Ready to process · ${total} rows`}
      </div>
      <div style={{ height: 10, borderRadius: 99, background: TK.brandTint, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: blocked && !checking ? 'linear-gradient(90deg,#F87171,#DC2626)' : `linear-gradient(90deg,#10B981,${C.green})`, transition: 'width .15s linear' }} />
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: C.muted, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, color: C.navy }}>{pct}%</span>
        {checking && <span>{stage}</span>}
        {!checking && <>
          <span style={{ color: C.green, fontWeight: 700 }}>✓ {matched.length} matched</span>
          {unmatched.length > 0 && <span style={{ color: C.amber, fontWeight: 700 }}>⚠ {unmatched.length} not in this month</span>}
          {blocked && <span style={{ color: C.red, fontWeight: 700 }}>✕ {violations.length} over Max Days</span>}
        </>}
      </div>

      {!checking && strictUnmatched && unmatched.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Extra rows — these codes are not in this month&apos;s master. Remove them and upload again.</div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>{unmatched.slice(0, 60).join(', ')}{unmatched.length > 60 ? ` +${unmatched.length - 60} more` : ''}</div>
        </div>
      )}

      {!checking && violations.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Nothing can exceed Max Days. Fix the sheet and upload again.</div>
          <div style={{ maxHeight: 170, overflowY: 'auto' }}>
            {violations.slice(0, 60).map((v, i) => (
              <div key={`${v.code}-${v.rule}-${i}`} style={{ padding: '2px 0' }}>
                <b>{v.code}</b> — {v.rule} <b>{v.actual}</b> &gt; Max Days <b>{v.max}</b>
              </div>
            ))}
            {violations.length > 60 && <div style={{ marginTop: 4 }}>+ {violations.length - 60} more…</div>}
          </div>
        </div>
      )}

      {!checking && !strictUnmatched && unmatched.length > 0 && (
        <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          Skipped (wrong code / extra person / not in this month's master): <b>{unmatched.slice(0, 40).join(', ')}</b>{unmatched.length > 40 ? ` +${unmatched.length - 40} more` : ''}
        </div>
      )}

      {!checking && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onProcess} disabled={busy || blocked || matched.length === 0}
            style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: busy || blocked || matched.length === 0 ? 'not-allowed' : 'pointer', opacity: busy || blocked || matched.length === 0 ? 0.5 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
            {busy ? 'Processing…' : blocked ? 'Blocked' : `Process ${matched.length} rows`}
          </button>
          <button onClick={onCancel} disabled={busy}
            style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${C.border}`, background: TK.surface, color: C.muted, fontWeight: 700, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
