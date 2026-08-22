'use client'
// app/dashboard/attendance-reports/page.tsx — HR Attendance Reports.
// Pick a report, set filters (company / dept / location / employee / date range),
// generate a preview and export to Excel. Report logic lives in lib/attendance/reports.
import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { REPORTS, runReport, type ReportOutput, type ReportGroup } from '@/lib/attendance/reports'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted, green: TK.positive, amber: TK.warning, red: TK.critical, purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: font, boxSizing: 'border-box' }
const GROUP_ICON: Record<ReportGroup, string> = { Attendance: '', Exceptions: '', Leave: '', Summary: '' }

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }

export default function AttendanceReportsPage() {
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([])
  const [companyId, setCompanyId] = useState('')
  const [depts, setDepts] = useState<{ id: string; dept_name: string }[]>([])
  const [locs, setLocs] = useState<{ id: string; location_name: string }[]>([])
  const [emps, setEmps] = useState<{ id: string; emp_code: string; full_name: string }[]>([])

  const [reportId, setReportId] = useState('daily_punch')
  const [departmentId, setDepartmentId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [codesText, setCodesText] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())

  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<ReportOutput | null>(null)
  const [err, setErr] = useState('')

  const report = useMemo(() => REPORTS.find(r => r.id === reportId)!, [reportId])

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => setCompanies(data || []))   // default '' = All companies
  }, [])

  useEffect(() => {
    setDepartmentId(''); setLocationId(''); setEmployeeId('')
    // Empty companyId = All companies: load the filter options across every company.
    let dq = supabase.from('departments').select('id, dept_name').order('dept_name')
    let lq = supabase.from('locations').select('id, location_name').order('location_name')
    let eq = supabase.from('employees').select('id, emp_code, full_name').neq('is_test', true).order('emp_code')
    if (companyId) { dq = dq.eq('company_id', companyId); lq = lq.eq('company_id', companyId); eq = eq.eq('company_id', companyId) }
    dq.then(({ data }) => setDepts(data || []))
    lq.then(({ data }) => setLocs(data || []))
    eq.then(({ data }) => setEmps(data || []))
  }, [companyId])

  async function generate() {
    setErr(''); setOut(null)
    if (report.singleEmp && !employeeId) { setErr('This report needs a single employee — pick one.'); return }
    setBusy(true)
    try {
      const codes = codesText.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean)
      const res = await runReport(reportId, { companyId, departmentId: departmentId || undefined, locationId: locationId || undefined, employeeId: report.singleEmp ? employeeId : undefined, employeeCodes: (!report.singleEmp && codes.length) ? codes : undefined, from, to })
      setOut(res)
    } catch (e: any) { setErr(e?.message || 'Report failed.') }
    setBusy(false)
  }

  function exportXlsx() {
    if (!out) return
    try {
      // Excel sheet names can't contain : \ / ? * [ ] and max 31 chars.
      const sheetName = (report.label.replace(/[:\\/?*[\]]/g, '-').slice(0, 28) || 'Report')
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet([out.columns, ...out.rows])
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      XLSX.writeFile(wb, `EZER_${report.id}_${from}_to_${to}.xlsx`)
    } catch (e: any) {
      setErr('Excel export failed: ' + (e?.message || 'unknown'))
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, typeof REPORTS> = {}
    REPORTS.forEach(r => (g[r.group] = g[r.group] || []).push(r))
    return g
  }, [])

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: font, color: C.navy, padding: 24 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Attendance Reports</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, marginBottom: 16 }}>Daily punch, exceptions, leave & summary reports — filter and export to Excel.</div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Report picker */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: '0 1px 4px rgba(37,99,235,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Choose a report</div>
            {Object.entries(grouped).map(([grp, list]) => (
              <div key={grp} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{GROUP_ICON[grp as ReportGroup]} {grp}</div>
                {list.map(r => {
                  const on = r.id === reportId
                  return (
                    <button key={r.id} onClick={() => setReportId(r.id)} style={{
                      width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, marginBottom: 3, cursor: 'pointer', fontFamily: font,
                      border: `1px solid ${on ? C.purple : 'transparent'}`, background: on ? C.purpleBg : 'transparent',
                    }}>
                      <div style={{ fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? C.purpleD : C.navy }}>{r.label}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{r.desc}</div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Filters + results */}
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 4px rgba(37,99,235,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>{report.label} — filters</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <div>
                  <label style={lbl}>Company</label>
                  <select style={inp} value={companyId} onChange={e => setCompanyId(e.target.value)}><option value="">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
                </div>
                <div>
                  <label style={lbl}>Department</label>
                  <select style={inp} value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">All departments</option>{depts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</select>
                </div>
                <div>
                  <label style={lbl}>Location</label>
                  <select style={inp} value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">All locations</option>{locs.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}</select>
                </div>
                {report.singleEmp && (
                  <div style={{ gridColumn: 'span 3' }}>
                    <label style={lbl}>Employee *</label>
                    <select style={inp} value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Select employee</option>{emps.map(e => <option key={e.id} value={e.id}>{e.emp_code} — {e.full_name}</option>)}</select>
                  </div>
                )}
                {report.dateRange && (<>
                  <div><label style={lbl}>From date</label><input type="date" style={inp} value={from} onChange={e => setFrom(e.target.value)} /></div>
                  <div><label style={lbl}>To date</label><input type="date" style={inp} value={to} onChange={e => setTo(e.target.value)} /></div>
                </>)}
                {!report.singleEmp && (
                  <div style={{ gridColumn: 'span 3' }}>
                    <label style={lbl}>Employee codes <span style={{ fontWeight: 400, color: C.muted, textTransform: 'none', letterSpacing: 0 }}>(optional — leave blank for everyone; one per line or comma-separated for specific employees)</span></label>
                    <textarea value={codesText} onChange={e => setCodesText(e.target.value)} placeholder={'SRS0001, SRS9007\nSRS9001'} style={{ ...inp, height: 64, fontFamily: 'monospace', resize: 'vertical' }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <button onClick={generate} disabled={busy} style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#2563EB,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 4px 12px rgba(37,99,235,0.28)' }}>{busy ? 'Generating…' : 'Generate report'}</button>
                {err && <span style={{ fontSize: 12, color: C.red }}>⚠ {err}</span>}
              </div>
            </div>

            {out && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(37,99,235,0.06)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: out.rows.length ? 'rgba(5,150,105,0.10)' : TK.sunken, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{out.rows.length ? '' : ''}</div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{out.rows.length ? `${report.label} ready` : 'No matching data'}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{out.rows.length ? <><b style={{ color: C.navy }}>{out.rows.length}</b> row{out.rows.length !== 1 ? 's' : ''}{out.note ? ` · ${out.note}` : ''} · {out.columns.length} columns</> : 'No records for these filters — try a wider date range or different filters.'}</div>
                </div>
                {out.rows.length > 0 && (
                  <button onClick={exportXlsx} style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(120deg,#059669,#047857)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 12px rgba(5,150,105,0.30)', whiteSpace: 'nowrap' }}>⬇ Export Excel</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
