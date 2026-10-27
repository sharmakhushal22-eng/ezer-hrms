'use client'
// components/payroll/OtUpload.tsx — Payroll → Attendance → OT Upload.
// The SEPARATE overtime uploader. Same shape as Attendance Upload (pick month →
// file → "% checking" validation → Process/Cancel) but touches ONLY ot_hours via
// upload_ot_batch, so it can never overwrite leave/paid_days already uploaded.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, uploadOtBatch, getValidEmpCodesForRun, MONTHS, type PayrollRun, type OtUploadRow } from '@/lib/payroll/core'
import { font, num, fmtDate, DownloadCard, ValidationCard, ScreenIntro, FileDrop, uploadSteps } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK, F, W, S as SP, IconClock, IconUpload } from '@/lib/ui'
import { SectionCard, InfoCallout, ControlSelect, ProcessStepper, DataTable, StatusPill, IconMonth, dt } from '@/components/payroll/kit'

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
        if (parsed.length === 0) { setParseErr('No valid rows found. Check the "Emp Code" and "OT Hours" columns.'); return }
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

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 860 }}>
      <ScreenIntro icon={<IconClock size={20} />} title="OT Upload"
        subtitle="Overtime hours only: a separate sheet that never overwrites leave or paid days"
        meta={<>
          <StatusPill t="info" size="sm" dot>Touches OT hours only</StatusPill>
          {rows.length > 0 && <StatusPill t="brand" size="sm">{rows.length} rows in file</StatusPill>}
        </>}>
        <ProcessStepper compact steps={uploadSteps({ hasFile: rows.length > 0, showVal, checking, blocked: false, done: !!results })} />
      </ScreenIntro>

      {!companyId && <InfoCallout t="warning" compact>Pick a specific company in the header to see its payroll months. (Download works for any company.)</InfoCallout>}

      <DownloadCard companyId={companyId} fy={fy}
        heading="Download OT sheet" note="· filter and download a ready-to-fill OT sheet"
        filePrefix="OT" sheetName="OT"
        buildRow={(r, ctx) => ({
          ...(ctx.isGroup ? { 'Company': ctx.companyName } : {}),
          'Emp Code': r.employee_code || '', 'Employee Name': r.full_name || '',
          'Date of Joining': fmtDate(ctx.doj), 'Date of Leaving': fmtDate(ctx.dol),
          'Total OT Hours': Number(r.ot_hours) || 0,
        })} />

      <SectionCard icon={<IconUpload size={16} />} title="Upload filled OT"
        hint="Choose the month, then the file. Codes are matched as soon as the file is read.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: SP.md, alignItems: 'end' }}>
          <ControlSelect label="Payroll month" icon={<IconMonth size={15} />} strong minWidth={280}
            value={runId} onChange={e => { setRunId(e.target.value); resetUpload() }}>
            {runs.length === 0 && <option value="">No month yet. Create one first</option>}
            {runs.map(r => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
          </ControlSelect>
          <div>
            <span style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.09em', textTransform: 'uppercase', color: TK.muted, display: 'block', marginBottom: 5 }}>OT file (.xlsx)</span>
            <FileDrop accept=".xlsx,.xls" onChange={handleFile} fileName={fileName} label="Choose the filled OT sheet" />
          </div>
        </div>
        <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: SP.md, lineHeight: 1.55 }}>Columns: <b style={{ color: TK.inkSoft }}>Emp Code, Total OT Hours</b>. Only rows whose Emp Code exists in the selected month are updated. Leave / paid days are untouched.</div>
        {parseErr && <InfoCallout t="critical" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{parseErr}</InfoCallout>}
      </SectionCard>

      {showVal && (
        <ValidationCard pct={valPct} checking={checking} stage="Matching employee codes…" total={rows.length}
          matched={matched} unmatched={unmatched} violations={[]}
          onProcess={doProcess} onCancel={resetUpload} busy={busy} kind="OT" />
      )}

      {rows.length > 0 && !results && (
        <SectionCard title="Preview" hint={`${fileName} (${rows.length} rows)`} flush
          actions={rows.length > 8 ? <StatusPill t="neutral" size="sm">First 8 shown</StatusPill> : undefined}>
          <DataTable minWidth={320}>
            <thead><tr>{['Emp Code', 'OT Hours'].map(h => <th key={h} style={h === 'Emp Code' ? dt.th : dt.thNum}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i} className={dt.rowClass}>
                  <td style={dt.tdMono}>{r.emp_code}</td>
                  <td style={dt.tdNum}>{r.ot_hours ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {rows.length > 8 && <div style={{ fontSize: F.tiny, color: TK.muted, padding: `${SP.sm + 2}px ${SP.lg}px` }}>+ {rows.length - 8} more rows…</div>}
        </SectionCard>
      )}

      {results && (
        <SectionCard title="Result" iconTone="positive">
          <InfoCallout t="positive" title={`${updated} of ${results.length} OT rows updated`} style={{ marginBottom: notFound.length ? SP.md : 0 }} />
          {notFound.length > 0 && (
            <InfoCallout t="warning" compact style={{ marginBottom: 0 }}>
              <b>{notFound.length}</b> emp code{notFound.length > 1 ? 's' : ''} not found in this month (skipped): {notFound.map(r => r.emp_code).join(', ')}
            </InfoCallout>
          )}
        </SectionCard>
      )}
    </div>
  )
}
