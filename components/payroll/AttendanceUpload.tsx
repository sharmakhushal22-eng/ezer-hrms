'use client'
// components/payroll/AttendanceUpload.tsx — Payroll → Attendance → Attendance Upload.
// Pick a created payroll month (run), upload a Leave/Attendance Excel, run the client-side
// "% checking" validation pass, then Process (→ upload_attendance_batch) or Cancel.
// paid_days is computed server-side as (EL+CL+SL+Other) − Absent. OT is a SEPARATE uploader.
// Also: ⬇ Download attendance — a ready-to-fill sheet for the month master, filterable by
// company / location / department / employee codes (searchable; the code box accepts a
// pasted bulk list like "OXYZO680, OXYZO741, OXYZO1013").
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, loadCompanies, uploadAttendanceBatch, getValidEmpCodesForRun, MONTHS, type PayrollRun, type AttendanceUploadRow } from '@/lib/payroll/core'
import { C, font, num, ddInp, lbl, GROUP, SearchSelect, MultiSelect, ValidationCard, type Opt } from './attendanceShared'

// ── Month-day helpers, all computed LIVE from the employee master's DOJ/DOL for the
// report's month, so corrections show up in the download immediately. `period` is the
// 1st of the payroll month as 'YYYY-MM-01'. DOJ/DOL are pulled from the employee master.
function monthMeta(period: string) {
  const [py, pm] = String(period).slice(0, 7).split('-').map(Number)
  const start = Date.UTC(py, pm - 1, 1)
  const end = Date.UTC(py, pm, 0)                 // last day of the month
  return { py, pm, start, end, daysInMonth: new Date(end).getUTCDate() }
}
const toMs = (d: string | null) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return (y && m && dd) ? Date.UTC(y, m - 1, dd) : null }

// Max Days — the maximum days salary can be paid for in the month, capped by the leaving
// date. DOL 15-Apr → 15; no leaving this month → the full month (30/31/28).
function maxDaysLive(dol: string | null, period: string | null): number | null {
  if (!period) return null
  const { start, end, daysInMonth } = monthMeta(period)
  const dl = toMs(dol)
  if (dl != null && dl >= start && dl <= end) return new Date(dl).getUTCDate()
  return daysInMonth
}

// Dates in the report read as DD-MM-YY (e.g. 2018-09-24 → 24-09-18).
function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  if (!y || !m || !dd) return ''
  return `${dd}-${m}-${y.slice(2)}`
}

// Calendar 1st-of-month for a run, from fy + month (same math as the server's v_period).
function runPeriodISO(fy: string | null, month: number | null): string | null {
  if (!fy || !month) return null
  const startYr = Number(String(fy).split('-')[0])
  const cal = month <= 9 ? month + 3 : month - 9
  const yr = month <= 9 ? startYr : startYr + 1
  return `${yr}-${String(cal).padStart(2, '0')}-01`
}

// Map the template's friendly headers → snapshot keys. Tolerant of case/spacing.
// Only leave/absent columns are read here — paid_days is derived server-side, OT is separate.
function normalizeRow(r: Record<string, any>): AttendanceUploadRow | null {
  const g = (...keys: string[]) => { for (const k of Object.keys(r)) { const kk = k.trim().toLowerCase(); if (keys.some(x => kk === x)) return r[k] } return undefined }
  const code = g('emp code', 'emp_code', 'empcode', 'employee code')
  if (code == null || String(code).trim() === '') return null
  return {
    emp_code: String(code).trim(),
    earned_leave: num(g('el', 'earned leave', 'earned_leave')) ?? 0,
    casual_leave: num(g('cl', 'casual leave', 'casual_leave')) ?? 0,
    sick_leave: num(g('sl', 'sick leave', 'sick_leave')) ?? 0,
    other_leave: num(g('other leave', 'other_leave')) ?? 0,
    absent_days: num(g('absent days', 'absent_days', 'absent')) ?? 0,
  }
}

export default function AttendanceUpload({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [rows, setRows] = useState<AttendanceUploadRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseErr, setParseErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ emp_code: string; result: string }[] | null>(null)

  // client-side validation pass ("% checking")
  const [checking, setChecking] = useState(false)
  const [valPct, setValPct] = useState(0)
  const [matched, setMatched] = useState<string[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [showVal, setShowVal] = useState(false)

  // inline download filters
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

  const reloadRuns = useCallback(async () => {
    const list = await loadRuns(companyId, fy)
    setRuns(list); if (list.length && !runId) setRunId(list[0].id)
  }, [companyId, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadRuns() }, [reloadRuns])

  // download option data
  useEffect(() => {
    loadCompanies().then(cs => setCompanies((cs as any[]).map(c => ({ value: c.id, label: c.company_name })))).catch(() => {})
    loadRuns('', fy).then(setAllRuns).catch(() => {})
  }, [fy])
  useEffect(() => { setDlCompany(companyId || GROUP) }, [companyId])

  useEffect(() => {
    if (!dlCompany) { setLocOpts([]); setDeptOpts([]); setEmpOpts([]); setDlRunId(''); return }
    const grp = dlCompany === GROUP
    const scope = <T,>(q: any) => grp ? q : q.eq('company_id', dlCompany)
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

  function resetUpload() { setRows([]); setFileName(''); setShowVal(false); setResults(null); setMatched([]); setUnmatched([]); setValPct(0) }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseErr(''); resetUpload()
    const file = e.target.files?.[0]; if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
        const parsed = raw.map(normalizeRow).filter(Boolean) as AttendanceUploadRow[]
        if (parsed.length === 0) { setParseErr('No valid rows found — check the "Emp Code" column matches the template.'); return }
        setRows(parsed); runValidation(parsed)
      } catch (err: any) { setParseErr('Could not read the file: ' + (err.message || err)) }
    }
    reader.readAsArrayBuffer(file)
  }

  // The "% checking" pass — fetch the run's valid codes once, walk rows locally, animate.
  async function runValidation(parsed: AttendanceUploadRow[]) {
    if (!runId) { setParseErr('Pick a payroll month first, then re-select the file.'); return }
    setParseErr(''); setResults(null); setShowVal(true); setChecking(true); setValPct(0)
    let valid: Set<string>
    try { valid = await getValidEmpCodesForRun(runId) }
    catch (e: any) { setChecking(false); setShowVal(false); setParseErr('Could not load this month: ' + (e.message || e)); return }
    const m: string[] = [], u: string[] = []
    parsed.forEach(r => (valid.has(r.emp_code) ? m : u).push(r.emp_code))
    setMatched(m); setUnmatched(u)
    let p = 0
    const iv = setInterval(() => { p = Math.min(100, p + 7); setValPct(p); if (p >= 100) { clearInterval(iv); setChecking(false) } }, 80)
  }

  async function doProcess() {
    if (!runId) return
    const allow = new Set(matched)
    const send = rows.filter(r => allow.has(r.emp_code))
    if (send.length === 0) return
    setBusy(true)
    const { error, results: res } = await uploadAttendanceBatch(runId, send)
    setBusy(false); setShowVal(false)
    if (error) { setParseErr('Upload failed: ' + error); return }
    setResults(res)
  }

  const runLabel = (r: PayrollRun) => `month master for ${r.company_name || 'company'} for ${r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`}`
  const isGroup = dlCompany === GROUP
  const dlRunOptions: Opt[] = isGroup
    ? Array.from(new Map(allRuns.map(r => [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }])).values()).sort((a, b) => Number(a.value) - Number(b.value))
    : allRuns.filter(r => r.company_id === dlCompany).map(r => ({ value: r.id, label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }))

  async function downloadAttendance() {
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
        .select('run_id, employee_id, employee_code, full_name, department, designation, days_in_month, paid_days, earned_leave, casual_leave, sick_leave, other_leave, absent_days')
        .in('run_id', runIds).order('employee_code')
      if (error) throw new Error(error.message)
      let list = snap || []

      // Pull Date of Joining / Date of Leaving / employment_type LIVE from the employee
      // master (the snapshot copies may be NULL on older months). Only real "Employee"
      // types are allowed in this attendance record — interns / consultants / contract etc.
      // are dropped by the master's employment_type, not the (possibly stale) snapshot's.
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
      const nn = (v: any) => Number(v) || 0
      const sheet = list.map((r: any) => {
        const m = master[r.employee_id] || {}
        const doj = m.company_doj || null
        const dol = m.date_of_leaving || m.last_working_date || m.relieving_date || null
        const per = coPeriodISO[r.run_id] || null
        const weeklyOff = 0   // starts at 0 — HR fills the actual week-offs in the sheet
        // Attendance figures default to 0 (not blank) so every row always carries a number,
        // including months whose attendance has not been uploaded yet.
        const el = nn(r.earned_leave), cl = nn(r.casual_leave), sl = nn(r.sick_leave)
        const other = nn(r.other_leave), absent = nn(r.absent_days), paid = nn(r.paid_days)
        // Total Days (confirmed) = Weekly Off + EL + CL + SL + Other Leave + Paid Days − Absent Days
        const totalDays = weeklyOff + el + cl + sl + other + paid - absent
        return {
          ...(isGroup ? { 'Company': coName[r.run_id] || '' } : {}),
          'Emp Code': r.employee_code || '', 'Employee Name': r.full_name || '', 'Department': r.department || '',
          'Designation': r.designation || '', 'Month': coPeriod[r.run_id] || period,
          'Date of Joining': fmtDate(doj), 'Date of Leaving': fmtDate(dol),
          'Days in Month': r.days_in_month ?? (per ? monthMeta(per).daysInMonth : ''),
          'Max Days': maxDaysLive(dol, per) ?? '',
          'Weekly Off': weeklyOff,
          'EL': el, 'CL': cl, 'SL': sl,
          'Other Leave': other, 'Absent Days': absent, 'Paid Days': paid,
          'Total Days': totalDays,
        }
      })
      const ws = XLSX.utils.json_to_sheet(sheet)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
      const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      XLSX.writeFile(wb, `Attendance_${safe(isGroup ? 'Group' : (grpRuns[0]?.company_name || ''))}_${safe(period)}.xlsx`.replace(/_+/g, '_'))
    } catch (e: any) { setDlErr('Download failed: ' + (e.message || e)) } finally { setDlBusy(false) }
  }

  const updated = results?.filter(r => r.result === 'UPDATED').length || 0
  const notFound = results?.filter(r => r.result !== 'UPDATED') || []
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }
  const dlCompanyName = isGroup ? 'all companies' : (companies.find(c => c.value === dlCompany)?.label || '')
  const dlPeriod = isGroup
    ? (dlRunOptions.find(o => o.value === dlRunId)?.label || '')
    : (allRuns.find(r => r.id === dlRunId)?.period_label || '')

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>📤</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Attendance Upload</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Leave · absent days into the frozen month snapshot — Paid Days is computed as (EL+CL+SL+Other) − Absent</div>
        </div>
      </div>

      {!companyId && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>Pick a specific company in the header to see its payroll months. (Download works for any company.)</div>}

      {/* ── Download attendance — inline filters at the top ── */}
      <div style={{ background: C.card, border: `1px solid ${C.greenBd}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(5,150,105,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: C.greenBg, border: `1px solid ${C.greenBd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⬇</span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.navy }}>Download attendance sheet</span>
          <span style={{ fontSize: 10.5, color: C.muted }}>— filter and download a ready-to-fill sheet</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={lbl}>Company</label><SearchSelect value={dlCompany} options={[{ value: GROUP, label: '🏛️ Group Companies (all)' }, ...companies]} placeholder="Select company" onChange={setDlCompany} /></div>
          <div><label style={lbl}>Month</label><SearchSelect value={dlRunId} options={dlRunOptions} placeholder={dlRunOptions.length ? 'Select month' : 'No month created'} onChange={setDlRunId} /></div>
          <div><label style={lbl}>Location</label><SearchSelect value={dlLoc} options={[{ value: '', label: 'All locations' }, ...locOpts]} placeholder="All locations" onChange={setDlLoc} /></div>
          <div><label style={lbl}>Department</label><SearchSelect value={dlDept} options={[{ value: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" onChange={setDlDept} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Employee codes <span style={{ textTransform: 'none', fontWeight: 400, color: C.muted }}>(optional — leave empty for all; paste a comma / newline list to add many)</span></label>
          <MultiSelect values={dlEmpCodes} options={empOpts} placeholder="All employees" onChange={setDlEmpCodes} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={downloadAttendance} disabled={dlBusy || !dlRunId}
            style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: dlBusy || !dlRunId ? 'not-allowed' : 'pointer', opacity: dlBusy || !dlRunId ? 0.6 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
            {dlBusy ? 'Preparing…' : '⬇ Download'}
          </button>
          {dlRunId && <span style={{ fontSize: 11.5, color: C.purpleD }}>month master for <b>{dlCompanyName}</b> for <b>{dlPeriod}</b>{(dlLoc || dlDept || dlEmpCodes.length) ? ' · filtered' : ''}</span>}
        </div>
        {dlErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 7, padding: '8px 10px', marginTop: 10 }}>{dlErr}</div>}
      </div>

      {/* ── Upload attendance ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>📤 Upload filled attendance</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Payroll month</label>
            <select style={{ ...inp, minWidth: 300 }} value={runId} onChange={e => { setRunId(e.target.value); resetUpload() }}>
              {runs.length === 0 && <option value="">No month created — create one first</option>}
              {runs.map(r => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Attendance file (.xlsx)</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ ...inp, padding: '7px 10px' }} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>Columns: <b>Emp Code, EL, CL, SL, Other Leave, Absent Days</b>. Paid Days = (EL+CL+SL+Other) − Absent, computed on upload. OT is uploaded separately in the OT Upload tab.</div>
        {parseErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 7, marginTop: 10 }}>{parseErr}</div>}
      </div>

      {showVal && (
        <ValidationCard pct={valPct} checking={checking} total={rows.length} matched={matched} unmatched={unmatched}
          onProcess={doProcess} onCancel={resetUpload} busy={busy} kind="attendance" />
      )}

      {rows.length > 0 && !results && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Preview · {fileName} ({rows.length} rows)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr style={{ background: C.navy }}>{['Emp Code', 'EL', 'CL', 'SL', 'Other', 'Absent', 'Paid Days*'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Emp Code' ? 'left' : 'right', fontSize: 9.5, color: '#A5B4FC', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => {
                  const pd = (r.earned_leave || 0) + (r.casual_leave || 0) + (r.sick_leave || 0) + (r.other_leave || 0) - (r.absent_days || 0)
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: C.navy }}>{r.emp_code}</td>
                      {[r.earned_leave, r.casual_leave, r.sick_leave, r.other_leave, r.absent_days].map((v, j) => <td key={j} style={{ padding: '7px 10px', textAlign: 'right', color: C.navy }}>{v ?? '—'}</td>)}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: pd < 0 ? C.red : C.green }}>{pd}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 8 && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>+ {rows.length - 8} more rows…</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>* Paid Days preview is the confirmed formula; the server stores the same on Process.</div>
          </div>
        </div>
      )}

      {results && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Result</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: notFound.length ? 12 : 0 }}>
            ✓ {updated} of {results.length} rows updated
          </div>
          {notFound.length > 0 && (
            <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 9, padding: '10px 14px' }}>
              <b>{notFound.length}</b> emp code{notFound.length > 1 ? 's' : ''} not found in this month (skipped): {notFound.map(r => r.emp_code).join(', ')}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
