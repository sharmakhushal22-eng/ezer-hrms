'use client'
// app/dashboard/bulk-upload/page.tsx — Bulk Employee Data Uploader.
// 7 category uploaders · download template → fill → upload · client validation +
// server-side schema-aware upsert (via /api/employees/bulk-upload). Payroll-impact
// acknowledgement, per-row validation preview, error export, upload history.
import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'

const UPLOADERS = [
  { id: 'personal', label: 'Personal Info', icon: '', color: TK.brand, colorBg: TK.brandTint, desc: 'Name, DOB, gender, blood group, marital status, mobile, emergency contact', payrollAlert: false, dateColumns: ['date_of_birth'], requiredColumns: ['emp_code'], downloadFile: 'EZER_Uploader_Personal_Info.xlsx' },
  { id: 'employment', label: 'Employment Details', icon: '', color: TK.brandDeep, colorBg: TK.infoTint, desc: 'Designation, grade, department, location, DOJ, confirmation, reporting manager', payrollAlert: true, payrollAlertMsg: 'Changing Group DOJ or Company DOJ impacts gratuity seniority and EPF enrolment. Verify with payroll before uploading.', dateColumns: ['group_doj', 'company_doj', 'confirmation_date'], requiredColumns: ['emp_code'], downloadFile: 'EZER_Uploader_Employment.xlsx' },
  { id: 'statutory', label: 'Statutory IDs', icon: '', color: TK.critical, colorBg: TK.criticalTint, desc: 'PAN, UAN, ESIC IP, EPF method & wage limit, PT state, LWF, TDS regime', payrollAlert: true, payrollAlertMsg: 'Changing EPF method or wage limit impacts the current payroll run. Coordinate with payroll.', confidential: true, dateColumns: [], requiredColumns: ['emp_code'], downloadFile: 'EZER_Uploader_Statutory_IDs.xlsx' },
  { id: 'bank', label: 'Bank Details', icon: '', color: TK.positive, colorBg: TK.positiveTint, desc: 'Bank name, account number, IFSC, account type — for salary disbursement', payrollAlert: true, payrollAlertMsg: 'New bank accounts require penny-drop verification. Accounts changed after the 25th apply from next month.', confidential: true, dateColumns: ['effective_from'], requiredColumns: ['emp_code'], downloadFile: 'EZER_Uploader_Bank_Details.xlsx' },
  { id: 'salary', label: 'Salary Structure', icon: '', color: TK.warning, colorBg: TK.warningTint, desc: 'CTC revision, increment, grade-wise salary breakup, variable %, effective date', payrollAlert: true, payrollAlertMsg: 'PAYROLL IMPACT — Salary changes affect the current/next payroll run. Upload before the 25th. Coordinate with payroll.', dateColumns: ['effective_date'], requiredColumns: ['emp_code', 'effective_date', 'revision_reason', 'annual_ctc'], downloadFile: 'EZER_Uploader_Salary_Structure.xlsx' },
  { id: 'exit', label: 'Exit & Separation', icon: '', color: TK.critical, colorBg: TK.criticalTint, desc: 'Resignation, last working date, separation reason, FNF initiation, blacklist', payrollAlert: true, payrollAlertMsg: 'CRITICAL — Last Working Date triggers final payroll & FNF. Verify with payroll before uploading.', dateColumns: ['date_of_resignation', 'last_working_date', 'relieving_date', 'fnf_date'], requiredColumns: ['emp_code', 'employment_status', 'last_working_date', 'leaving_reason'], downloadFile: 'EZER_Uploader_Exit_Separation.xlsx' },
  { id: 'address', label: 'Address & Contact', icon: '', color: TK.brandDeep, colorBg: TK.brandTint, desc: 'Residential & permanent address — used for salary slip and statutory forms', payrollAlert: false, dateColumns: [], requiredColumns: ['emp_code'], downloadFile: 'EZER_Uploader_Address_Contact.xlsx' },
]

const sel: React.CSSProperties = { width: '100%', padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: font }
const priBtn: React.CSSProperties = { padding: '8px 16px', background: C.purple, color: TK.onAccent, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: font }
const secBtn: React.CSSProperties = { padding: '7px 12px', background: C.card, color: C.navy, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: font }

function UploaderCard({ u, active, onClick }: any) {
  return (
    <div onClick={onClick} style={{ background: active ? u.colorBg : C.card, border: `${active ? '2' : '1'}px solid ${active ? u.color : C.border}`, borderLeft: `4px solid ${u.color}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{u.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{u.label}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{u.desc.slice(0, 52)}…</div>
        </div>
        {u.payrollAlert && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: C.amberBg, color: C.amber, fontWeight: 700 }}>Payroll</span>}
        {u.confidential && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: C.redBg, color: C.red, fontWeight: 700 }}></span>}
      </div>
    </div>
  )
}
function AlertBanner({ msg, type }: { msg: string; type: 'warn' | 'error' | 'success' }) {
  const map = { warn: [C.amberBg, C.amber, TK.warningTint], error: [C.redBg, C.red, TK.criticalTint], success: [C.greenBg, C.green, TK.positiveTint] } as const
  const [bg, fg, br] = map[type]
  return <div style={{ background: bg, border: `1px solid ${br}`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: fg, marginBottom: 10, display: 'flex', gap: 8 }}><span>{type === 'warn' ? '' : type === 'error' ? '' : ''}</span><span>{msg}</span></div>
}
function ValRow({ row, errors, index }: any) {
  const bad = errors?.length > 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderBottom: `1px solid ${C.border}`, background: bad ? C.redBg : 'transparent' }}>
      <span style={{ fontSize: 10, color: C.muted, width: 26 }}>{index + 1}</span>
      <span style={{ fontSize: 11, color: C.navy, flex: 1, fontFamily: 'monospace' }}>{row.emp_code || '—'}</span>
      {bad ? <span style={{ fontSize: 11, color: C.red }}>{errors.join(' · ')}</span> : <span style={{ fontSize: 11, color: C.green }}>Valid</span>}
    </div>
  )
}

function parseDateIndia(str: string): string | null {
  if (!str) return null
  const s = String(str).trim()
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d+$/.test(s)) { const d = new Date(Math.round((+s - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10) }
  return null
}

export default function BulkUploaderPage() {
  const [active, setActive] = useState(UPLOADERS[0])
  const [companies, setCompanies] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [filters, setFilters] = useState({ company: '', location: '', department: '', empType: '', status: '', empCodes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [validation, setValidation] = useState<{ row: any; errors: string[] }[]>([])
  const [stage, setStage] = useState<'idle' | 'parsed' | 'validated' | 'uploading' | 'done'>('idle')
  const [result, setResult] = useState<{ success: number; errors: number; details: string[] }>({ success: 0, errors: 0, details: [] })
  const [showAlert, setShowAlert] = useState(false)
  const [ack, setAck] = useState(false)
  const [toast, setToast] = useState('')
  const [logs, setLogs] = useState<any[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  const loadLogs = useCallback(() => { fetch('/api/employees/bulk-upload?limit=8').then(r => r.json()).then(d => setLogs(d.logs || [])) }, [])
  useEffect(() => {
    Promise.all([
      supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name'),
      supabase.from('locations').select('id, location_name').eq('status', 'Active').order('location_name'),
      supabase.from('departments').select('id, dept_name').eq('status', 'Active').order('dept_name'),
    ]).then(([c, l, d]) => { setCompanies(c.data || []); setLocations(l.data || []); setDepartments(d.data || []) })
    loadLogs()
  }, [loadLogs])

  function select(u: any) {
    setActive(u); setFile(null); setRows([]); setValidation([]); setStage('idle'); setAck(false); setShowAlert(false)
    setResult({ success: 0, errors: 0, details: [] }); if (fileRef.current) fileRef.current.value = ''
  }

  function parseFile(f: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array', cellDates: false })
      const ws = wb.Sheets[wb.SheetNames.find(n => !n.includes('Instruction')) || wb.SheetNames[0]]
      const all = XLSX.utils.sheet_to_json<any>(ws, { header: 1, raw: true, defval: '' })
      if (all.length < 4) { showToast('File too short — no data rows found'); return }
      const headers: string[] = (all[2] as string[]).map((h: string) => { const m = String(h || '').match(/\(([^)]+)\)$/); return m ? m[1].trim() : String(h || '').toLowerCase().trim().replace(/\s+/g, '_') })
      const parsed: any[] = []
      for (let i = 3; i < all.length; i++) {
        const r = all[i] as any[]
        if (!r || r.every((v: any) => v === '' || v == null)) continue
        const obj: any = {}
        headers.forEach((h, ci) => { obj[h] = r[ci] !== undefined ? String(r[ci]).trim() : '' })
        if (!obj.emp_code) continue
        active.dateColumns.forEach((dc: string) => { if (obj[dc]) obj[dc] = parseDateIndia(obj[dc]) || obj[dc] })
        parsed.push(obj)
      }
      setRows(parsed); setStage('parsed')
      if (active.payrollAlert && !ack) setShowAlert(true)
      showToast(`Parsed ${parsed.length} rows`)
    }
    reader.readAsArrayBuffer(f)
  }

  const validate = useCallback(() => {
    const res = rows.map(row => {
      const e: string[] = []
      active.requiredColumns.forEach((c: string) => { if (!row[c]) e.push(`${c} is required`) })
      if (row.emp_code && !/^[A-Z]{2,6}-?\d{3,6}$/.test(row.emp_code)) e.push('emp_code format invalid (e.g. SRS0001)')
      active.dateColumns.forEach((dc: string) => { if (row[dc] && !/^\d{4}-\d{2}-\d{2}$/.test(row[dc])) e.push(`${dc}: bad date (use DD-MM-YYYY)`) })
      if (row.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(row.pan_number)) e.push('PAN format invalid')
      if (row.mobile && !/^\d{10}$/.test(String(row.mobile).replace(/\s+/g, ''))) e.push('mobile must be 10 digits')
      if (row.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.personal_email)) e.push('personal_email invalid')
      if (row.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(row.ifsc_code)) e.push('IFSC invalid (XXXX0XXXXXX)')
      if (row.annual_ctc) { const n = Number(String(row.annual_ctc).replace(/,/g, '')); if (isNaN(n)) e.push('annual_ctc must be a number'); else if (n < 100000) e.push('annual_ctc too low (< ₹1L)'); else if (n > 50000000) e.push('annual_ctc too high (> ₹5Cr)') }
      return { row, errors: e }
    })
    const codes = filters.empCodes.split(',').map(s => s.trim()).filter(Boolean)
    const filtered = codes.length ? res.filter(r => codes.includes(r.row.emp_code)) : res
    setValidation(filtered); setStage('validated')
    const bad = filtered.filter(r => r.errors.length).length
    showToast(bad === 0 ? `All ${filtered.length} rows valid ✓` : `${bad} rows have errors`)
  }, [rows, filters, active])

  async function upload() {
    if (active.payrollAlert && !ack) { setShowAlert(true); return }
    const valid = validation.filter(r => !r.errors.length).map(r => r.row)
    if (!valid.length) { showToast('No valid rows to upload'); return }
    setStage('uploading')
    const res = await fetch('/api/employees/bulk-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploaderType: active.id, rows: valid, companyId: filters.company || null, acknowledged: ack, performedBy: 'HR' }),
    }).then(r => r.json()).catch(e => ({ error: e.message }))
    if (res.error) { setResult({ success: 0, errors: valid.length, details: [res.error] }); setStage('done'); showToast('Upload failed'); return }
    const details = (res.results || []).filter((r: any) => r.status === 'ERROR').slice(0, 20).map((r: any) => `${r.emp_code}: ${r.errors.join(', ')}`)
    setResult({ success: res.success || 0, errors: res.errors || 0, details }); setStage('done'); loadLogs()
    showToast(`Done: ${res.success || 0} uploaded, ${res.errors || 0} failed`)
  }

  const errRows = validation.filter(r => r.errors.length)
  const validCount = validation.filter(r => !r.errors.length).length

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100vh', fontFamily: font, fontSize: 13, color: C.navy }}>
      <div className="ez-page-head" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Bulk Uploader</div>
        <div style={{ fontSize: 12, color: C.muted }}>Update employee data in bulk via Excel templates · 7 categories · server-validated</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Uploader types</div>
          {UPLOADERS.map(u => <UploaderCard key={u.id} u={u} active={active.id === u.id} onClick={() => select(u)} />)}
          {/* Recent uploads */}
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '16px 0 8px' }}>Recent uploads</div>
          {!logs.length && <div style={{ fontSize: 11, color: C.muted }}>No uploads yet.</div>}
          {logs.map(l => (
            <div key={l.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', marginBottom: 6, fontSize: 11 }}>
              <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{l.uploader_type}</div>
              <div style={{ color: C.muted, marginTop: 1 }}><span style={{ color: C.green }}>{l.success_rows}✓</span>{l.error_rows > 0 && <span style={{ color: C.red }}> · {l.error_rows}✕</span>} · {new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          ))}
        </div>

        <div>
          {/* Header */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>{active.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{active.label} Uploader</div>
                <div style={{ fontSize: 12, color: C.muted }}>{active.desc}</div>
              </div>
              {active.confidential && <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: C.redBg, color: C.red, fontWeight: 600 }}>Confidential</span>}
              <a href={`/uploads/templates/${active.downloadFile}`} download style={{ ...priBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>⬇ Download template</a>
            </div>
            {active.payrollAlert && <div style={{ background: C.amberBg, border: `1px solid #FDE68A`, borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 12, color: C.amber }}>⚠️ {active.payrollAlertMsg}</div>}
          </div>

          {/* Filter bar (emp-code scoping) */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.purple, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Filter this upload</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, alignItems: 'end' }}>
              <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Company (for log)</div><select style={sel} value={filters.company} onChange={e => setFilters(f => ({ ...f, company: e.target.value }))}><option value="">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
              <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Location</div><select style={sel} value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))}><option value="">All locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}</select></div>
              <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Department</div><select style={sel} value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</select></div>
              <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Only these emp codes</div><input style={{ ...sel, fontFamily: 'monospace' }} placeholder="SRS0001,SSM0002…" value={filters.empCodes} onChange={e => setFilters(f => ({ ...f, empCodes: e.target.value }))} /></div>
            </div>
          </div>

          {/* Upload zone */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Upload filled template</div>
            <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${file ? C.purple : C.border}`, borderRadius: 10, padding: 20, textAlign: 'center', cursor: 'pointer', background: file ? C.purpleBg: TK.brandTint }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}></div>
              <div style={{ fontSize: 13, color: file ? C.purple : C.muted }}>{file ? `✓ ${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'Click to select a filled .xlsx template'}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Only .xlsx · Max 5,000 rows · must use the EZER template</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); parseFile(f) } }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={validate} disabled={!rows.length || stage === 'uploading'} style={{ ...priBtn, opacity: rows.length ? 1 : .5 }}>Validate {rows.length ? `(${rows.length} rows)` : ''}</button>
              {stage === 'validated' && <button onClick={() => setStage('parsed')} style={secBtn}>Re-parse</button>}
            </div>
          </div>

          {/* Payroll alert */}
          {showAlert && (
            <div style={{ background: C.amberBg, border: `1px solid #FDE68A`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, marginBottom: 8 }}>Payroll impact alert</div>
              <div style={{ fontSize: 12, color: TK.warning, marginBottom: 12, lineHeight: 1.6 }}>{active.payrollAlertMsg}<br /><b>Proceeding means you have verified this with the payroll team.</b></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setAck(true); setShowAlert(false) }} style={{ padding: '7px 16px', background: C.amber, color: TK.onAccent, border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: font }}>I have verified with payroll — proceed</button>
                <button onClick={() => setShowAlert(false)} style={secBtn}>Cancel</button>
              </div>
            </div>
          )}

          {/* Validation results */}
          {stage === 'validated' && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Validation results</div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11 }}><span style={{ color: C.green, fontWeight: 600 }}>✓ {validCount} valid</span>{errRows.length > 0 && <span style={{ color: C.red, fontWeight: 600 }}>✕ {errRows.length} errors</span>}</div>
              </div>
              {errRows.length > 0 && <div style={{ padding: '10px 14px' }}><AlertBanner msg={`${errRows.length} rows have errors — fix in Excel & re-upload. The ${validCount} valid rows can still be uploaded.`} type="warn" /></div>}
              {errRows.slice(0, 12).map((r, i) => <ValRow key={i} row={r.row} errors={r.errors} index={i} />)}
              {errRows.length > 12 && <div style={{ padding: '8px 16px', fontSize: 11, color: C.muted }}>… and {errRows.length - 12} more error rows (export below to see all)</div>}
              <div style={{ padding: '8px 16px', background: TK.positiveTint, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.green }}>✓ {validCount} rows ready to upload{errRows.length > 0 && <span style={{ color: C.muted }}> · {errRows.length} will be skipped</span>}</div>
            </div>
          )}

          {/* Upload */}
          {stage === 'validated' && validCount > 0 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={upload} disabled={active.payrollAlert && !ack} style={{ ...priBtn, padding: '10px 24px', fontSize: 13, opacity: (active.payrollAlert && !ack) ? .5 : 1 }}>⬆ Upload {validCount} valid rows</button>
              {errRows.length > 0 && <button onClick={() => { const ws = XLSX.utils.json_to_sheet(errRows.map(r => ({ ...r.row, ERRORS: r.errors.join(' | ') }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Errors'); XLSX.writeFile(wb, `EZER_Errors_${active.id}.xlsx`) }} style={secBtn}>⬇ Export error rows</button>}
            </div>
          )}

          {/* Done */}
          {stage === 'done' && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Upload complete</div>
              {result.success > 0 && <AlertBanner msg={`${result.success} rows uploaded successfully.`} type="success" />}
              {result.errors > 0 && <AlertBanner msg={`${result.errors} rows failed. See details below.`} type="error" />}
              {result.details.map((d, i) => <div key={i} style={{ fontSize: 11, color: C.red, padding: '3px 0' }}>{d}</div>)}
              <button onClick={() => select(active)} style={{ ...priBtn, marginTop: 10 }}>Upload another file</button>
            </div>
          )}
        </div>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 20, right: 20, background: C.navy, color: TK.onAccent, padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, zIndex: 999 }}>{toast}</div>}
    </div>
  )
}
