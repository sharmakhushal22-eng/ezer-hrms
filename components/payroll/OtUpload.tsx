'use client'
// components/payroll/OtUpload.tsx — Payroll → Attendance → OT Upload.
// The SEPARATE overtime uploader. Same shape as Attendance Upload (pick month →
// file → "% checking" validation → Process/Cancel) but touches ONLY ot_hours via
// upload_ot_batch, so it can never overwrite leave/paid_days already uploaded.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, uploadOtBatch, getValidEmpCodesForRun, MONTHS, type PayrollRun, type OtUploadRow } from '@/lib/payroll/core'
import { C, font, num, fmtDate, DownloadCard, ValidationCard } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK } from '@/lib/ui'

function normalizeRow(r: Record<string, any>): OtUploadRow | null {
  const g = (...keys: string[]) => { for (const k of Object.keys(r)) { const kk = k.trim().toLowerCase(); if (keys.some(x => kk === x)) return r[k] } return undefined }
  const code = g('emp code', 'emp_code', 'empcode', 'employee code')
  if (code == null || String(code).trim() === '') return null
  return { emp_code: String(code).trim(), ot_hours: num(g('total ot hours', 'ot hours', 'ot_hours', 'ot', 'overtime hours', 'overtime')) ?? 0 }
}

export default function OtUpload({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [rows, setRows] = useState<OtUploadRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseErr, setParseErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ emp_code: string; result: string }[] | null>(null)

  const [checking, setChecking] = useState(false)
  const [valPct, setValPct] = useState(0)
  const [matched, setMatched] = useState<string[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [showVal, setShowVal] = useState(false)

  const reloadRuns = useCallback(async () => {
    const list = await loadRuns(companyId, fy)
    setRuns(list); if (list.length && !runId) setRunId(list[0].id)
  }, [companyId, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadRuns() }, [reloadRuns])

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
        const parsed = raw.map(normalizeRow).filter(Boolean) as OtUploadRow[]
        if (parsed.length === 0) { setParseErr('No valid rows found — check the "Emp Code" and "OT Hours" columns.'); return }
        setRows(parsed); runValidation(parsed)
      } catch (err: any) { setParseErr('Could not read the file: ' + (err.message || err)) }
    }
    reader.readAsArrayBuffer(file)
  }

  async function runValidation(parsed: OtUploadRow[]) {
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
    const { error, results: res } = await uploadOtBatch(runId, send)
    setBusy(false); setShowVal(false)
    if (error) { setParseErr('Upload failed: ' + error); return }
    setResults(res)
  }

  const runLabel = (r: PayrollRun) => `month master for ${r.company_name || 'company'} for ${r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`}`
  const updated = results?.filter(r => r.result === 'UPDATED').length || 0
  const notFound = results?.filter(r => r.result !== 'UPDATED') || []
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: TK.surface, color: C.navy, fontFamily: font, outline: 'none' }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.warning},${TK.warning})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(217,119,6,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>OT Upload</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Overtime hours only — a separate sheet that never overwrites leave or paid days</div>
        </div>
      </div>

      {!companyId && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>Pick a specific company in the header to see its payroll months. (Download works for any company.)</div>}

      <DownloadCard companyId={companyId} fy={fy}
        heading="Download OT sheet" note="— filter and download a ready-to-fill OT sheet"
        filePrefix="OT" sheetName="OT"
        buildRow={(r, ctx) => ({
          ...(ctx.isGroup ? { 'Company': ctx.companyName } : {}),
          'Emp Code': r.employee_code || '', 'Employee Name': r.full_name || '',
          'Date of Joining': fmtDate(ctx.doj), 'Date of Leaving': fmtDate(ctx.dol),
          'Total OT Hours': Number(r.ot_hours) || 0,
        })} />

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Upload filled OT</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Payroll month</label>
            <select style={{ ...inp, minWidth: 300 }} value={runId} onChange={e => { setRunId(e.target.value); resetUpload() }}>
              {runs.length === 0 && <option value="">No month created — create one first</option>}
              {runs.map(r => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>OT file (.xlsx)</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ ...inp, padding: '7px 10px' }} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>Columns: <b>Emp Code, Total OT Hours</b>. Only rows whose Emp Code exists in the selected month are updated. Leave / paid days are untouched.</div>
        {parseErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 7, marginTop: 10 }}>{parseErr}</div>}
      </div>

      {showVal && (
        <ValidationCard pct={valPct} checking={checking} stage="Matching employee codes…" total={rows.length}
          matched={matched} unmatched={unmatched} violations={[]}
          onProcess={doProcess} onCancel={resetUpload} busy={busy} kind="OT" />
      )}

      {rows.length > 0 && !results && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Preview · {fileName} ({rows.length} rows)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 320 }}>
              <thead><tr style={{ background: C.navy }}>{['Emp Code', 'OT Hours'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Emp Code' ? 'left' : 'right', fontSize: 9.5, color: `${TK.brandEdge}`, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                    <td style={{ padding: '7px 10px', fontWeight: 700, color: C.navy }}>{r.emp_code}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: C.navy }}>{r.ot_hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>+ {rows.length - 8} more rows…</div>}
          </div>
        </div>
      )}

      {results && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Result</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: notFound.length ? 12 : 0 }}>
            ✓ {updated} of {results.length} OT rows updated
          </div>
          {notFound.length > 0 && (
            <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 9, padding: '10px 14px' }}>
              <b>{notFound.length}</b> emp code{notFound.length > 1 ? 's' : ''} not found in this month (skipped): {notFound.map(r => r.emp_code).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
