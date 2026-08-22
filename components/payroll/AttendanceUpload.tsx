'use client'
// components/payroll/AttendanceUpload.tsx — Payroll → Attendance → Attendance Upload.
// Download a ready-to-fill attendance sheet, then upload it back for the whole GROUP at
// once: attendance is always uploaded across every company for the chosen month, so HR
// works from a single consolidated sheet rather than one file per company.
//
// Before anything is written, the sheet is validated over a deliberate ~10s staged pass
// (green progress bar + live percentage, mirroring Create Month Master):
//   • every Emp Code must exist in that month's master
//   • Paid Days must be <= Max Days for every employee — a violation is a hard block
// Only then does Process commit via upload_attendance_batch, run by run.
import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, uploadAttendanceBatch, MONTHS, type PayrollRun, type AttendanceUploadRow } from '@/lib/payroll/core'
import { C, font, num, monthMeta, maxDaysLive, fmtDate, runPeriodISO, DownloadCard, ValidationCard, SearchSelect, lbl, type Opt, type Violation } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK } from '@/lib/ui'

// A parsed sheet row. Paid Days is read so it can be validated against Max Days;
// the stored value is still recomputed server-side as (EL+CL+SL+Other) − Absent.
type ParsedRow = AttendanceUploadRow & { paid_days: number | null; weekly_off: number }

function normalizeRow(r: Record<string, any>): ParsedRow | null {
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
    // Blank must stay null, not 0. Number('') is 0, so num() alone would turn an empty
    // Paid Days cell into an explicit zero and the server would faithfully store it —
    // silently wiping the value instead of falling back to the leave formula.
    paid_days: (() => { const v = g('paid days', 'paid_days'); return v === null || v === undefined || String(v).trim() === '' ? null : num(v) })(),
    weekly_off: num(g('weekly off', 'weekly_off', 'week off', 'wo')) ?? 0,
  }
}
// Weekly Off is stored with the rest, so Edit can recompute Total Days identically.

// Emp code out of a raw sheet row, using the same tolerant header matching as the parser.
function codeOfRaw(r: Record<string, any>): string {
  for (const k of Object.keys(r)) {
    const kk = k.trim().toLowerCase()
    if (['emp code', 'emp_code', 'empcode', 'employee code'].includes(kk)) return String(r[k] ?? '').trim()
  }
  return ''
}

// Total Days, as confirmed:
//   Weekly Off + EL + CL + SL + Other Leave + Paid Days − Absent Days
function totalDaysOf(r: ParsedRow, paid: number): number {
  return (r.weekly_off || 0) + (r.earned_leave || 0) + (r.casual_leave || 0)
    + (r.sick_leave || 0) + (r.other_leave || 0) + paid - (r.absent_days || 0)
}

// Every header the downloaded template can legitimately carry, plus the aliases the
// parser accepts. Anything outside this set means a column was added to the sheet.
const ALLOWED_HEADERS = new Set([
  'company', 'emp code', 'emp_code', 'empcode', 'employee code',
  'employee name', 'name', 'department', 'designation', 'month',
  'date of joining', 'date of leaving', 'days in month', 'max days',
  'weekly off', 'weekly_off', 'week off', 'wo',
  'el', 'earned leave', 'earned_leave',
  'cl', 'casual leave', 'casual_leave',
  'sl', 'sick leave', 'sick_leave',
  'other leave', 'other_leave',
  'paid days', 'paid_days',
  'absent days', 'absent_days', 'absent',
  'total days', 'ot hours', 'ot_hours', 'arrear days',
])

const STAGES: [number, string][] = [
  [0, 'Reading the attendance sheet…'],
  [20, 'Matching employee codes to the month master…'],
  [45, 'Fetching joining & leaving dates…'],
  [68, 'Checking Paid Days & Total Days against Max Days…'],
  [88, 'Finalising validation…'],
]

export default function AttendanceUpload({ companyId, fy }: { companyId: string; fy: string }) {
  const [allRuns, setAllRuns] = useState<PayrollRun[]>([])
  const [upMonth, setUpMonth] = useState('')            // month number as string — group-wide
  const [rows, setRows] = useState<ParsedRow[]>([])
  // The sheet exactly as uploaded — re-emitted on download with a Status column appended.
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([])
  const [fileName, setFileName] = useState('')
  const [parseErr, setParseErr] = useState('')
  const [sheetErrs, setSheetErrs] = useState<string[]>([])   // structure / duplicate problems
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ emp_code: string; result: string }[] | null>(null)

  // staged validation
  const [checking, setChecking] = useState(false)
  const [valPct, setValPct] = useState(0)
  const [stage, setStage] = useState('')
  const [matched, setMatched] = useState<string[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [violations, setViolations] = useState<Violation[]>([])
  const [showVal, setShowVal] = useState(false)
  const runByCode = useRef<Map<string, string>>(new Map())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    loadRuns('', fy).then(list => {
      setAllRuns(list)
      if (list.length) {
        const first = list.map(r => r.month).sort((a, b) => (a || 0) - (b || 0))[0]
        setUpMonth(first != null ? String(first) : '')
      }
    }).catch(() => {})
  }, [fy])
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  // One entry per distinct month across every company — the upload is group-wide.
  const monthOptions: Opt[] = Array.from(new Map(allRuns.map(r =>
    [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }]
  )).values()).sort((a, b) => Number(a.value) - Number(b.value))

  function resetUpload() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRows([]); setRawRows([]); setFileName(''); setShowVal(false); setResults(null); setSheetErrs([])
    setMatched([]); setUnmatched([]); setViolations([]); setValPct(0); setStage(''); setChecking(false)
  }

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
        const parsed = raw.map(normalizeRow).filter(Boolean) as ParsedRow[]
        if (parsed.length === 0) { setParseErr('No valid rows found — check the "Emp Code" column matches the template.'); return }

        // ── Sheet-shape checks: the template's columns may be edited, never added to ──
        const issues: string[] = []
        const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || []) as any[]
        const unknown = headerRow
          .map(h => String(h ?? '').trim())
          .filter(h => h && !ALLOWED_HEADERS.has(h.toLowerCase()))
        if (unknown.length) issues.push(`Extra column${unknown.length > 1 ? 's' : ''} added: ${unknown.join(', ')}. Remove ${unknown.length > 1 ? 'them' : 'it'} and keep the template's columns only.`)

        // A column with data but no header — XLSX names these __EMPTY, __EMPTY_1, …
        const headerless = new Set<string>()
        raw.forEach(r => Object.keys(r).forEach(k => {
          if (/^__EMPTY/.test(k) && String(r[k] ?? '').trim() !== '') headerless.add(k)
        }))
        if (headerless.size) issues.push(`${headerless.size} column${headerless.size > 1 ? 's' : ''} filled outside the template's headers. Clear anything to the right of "Absent Days".`)

        // Duplicate employee codes
        const seen = new Map<string, number>()
        parsed.forEach(p => seen.set(p.emp_code, (seen.get(p.emp_code) || 0) + 1))
        const dupes = [...seen.entries()].filter(([, n]) => n > 1)
        if (dupes.length) issues.push(`Duplicate employee code${dupes.length > 1 ? 's' : ''}: ${dupes.map(([c, n]) => `${c} (${n}×)`).join(', ')}. Each employee must appear once.`)

        setSheetErrs(issues)
        // Parsed and previewed only — the checking pass starts when Upload is clicked.
        setRows(parsed); setRawRows(raw)
      } catch (err: any) { setParseErr('Could not read the file: ' + (err.message || err)) }
    }
    reader.readAsArrayBuffer(file)
  }

  // Gather the month's master data, then check codes + Paid Days ≤ Max Days.
  async function validate(parsed: ParsedRow[]) {
    const monthRuns = allRuns.filter(r => String(r.month) === upMonth)
    if (!monthRuns.length) throw new Error('No payroll month created for this period yet.')
    const runIds = monthRuns.map(r => r.id)
    const periodISO = runPeriodISO(monthRuns[0].fy, monthRuns[0].month)

    // every employee in this month, across all companies in the group
    const { data: snap, error } = await supabase.from('payroll_employee_snapshot')
      .select('run_id, employee_id, employee_code').in('run_id', runIds)
    if (error) throw new Error(error.message)

    // Max Days comes from the employee master's leaving date — the authoritative
    // source — so an edited "Max Days" column in the sheet cannot weaken the check.
    const ids = Array.from(new Set((snap || []).map((s: any) => s.employee_id)))
    const master: Record<string, any> = {}
    for (let i = 0; i < ids.length; i += 300) {
      const { data: emp } = await supabase.from('employees')
        .select('id, date_of_leaving, last_working_date, relieving_date')
        .in('id', ids.slice(i, i + 300))
      ;(emp || []).forEach((e: any) => { master[e.id] = e })
    }

    const runMap = new Map<string, string>()
    const maxByCode = new Map<string, number>()
    ;(snap || []).forEach((s: any) => {
      runMap.set(s.employee_code, s.run_id)
      const m = master[s.employee_id] || {}
      const dol = m.date_of_leaving || m.last_working_date || m.relieving_date || null
      const md = maxDaysLive(dol, periodISO)
      if (md != null) maxByCode.set(s.employee_code, md)
    })
    runByCode.current = runMap

    const m: string[] = [], u: string[] = [], v: Violation[] = []
    parsed.forEach(r => {
      if (!runMap.has(r.emp_code)) { u.push(r.emp_code); return }
      m.push(r.emp_code)
      // Validate the Paid Days in the sheet; if the column is blank, fall back to the
      // value the server will compute, so the rule holds either way.
      const computed = (r.earned_leave || 0) + (r.casual_leave || 0) + (r.sick_leave || 0) + (r.other_leave || 0) - (r.absent_days || 0)
      const paid = r.paid_days ?? computed
      const max = maxByCode.get(r.emp_code)
      if (max == null) return
      // Neither the paid days nor the reconstructed total may exceed the month's ceiling.
      if (paid > max) v.push({ code: r.emp_code, rule: 'Paid Days', actual: paid, max })
      const total = totalDaysOf(r, paid)
      if (total > max) v.push({ code: r.emp_code, rule: 'Total Days', actual: total, max })
    })
    return { m, u, v }
  }

  // Staged progress: always takes at least 10 seconds, like Create Month Master.
  function runValidation(parsed: ParsedRow[]) {
    if (!upMonth) { setParseErr('Pick a payroll month first, then re-select the file.'); return }
    setParseErr(''); setResults(null); setShowVal(true); setChecking(true); setValPct(0); setStage(STAGES[0][1])
    const startedAt = Date.now()
    let done = false
    let out: { m: string[]; u: string[]; v: Violation[] } | null = null
    let failed = ''
    validate(parsed).then(r => { out = r }).catch(e => { failed = String(e?.message || e) }).finally(() => { done = true })

    let cur = 0
    timerRef.current = setInterval(() => {
      cur = Math.min(95, cur + 1.45)          // ~10s to reach 95%
      setValPct(Math.round(cur))
      const st = [...STAGES].reverse().find(([t]) => cur >= t); if (st) setStage(st[1])
      if (done && Date.now() - startedAt >= 10000 && cur >= 95) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        setValPct(100); setStage('Done ✓')
        setTimeout(() => {
          setChecking(false)
          if (failed) { setShowVal(false); setParseErr('Could not validate: ' + failed); return }
          setMatched(out!.m); setUnmatched(out!.u); setViolations(out!.v)
        }, 400)
      }
    }, 150)
  }

  // Commit — rows are grouped by the run their emp code belongs to.
  async function doProcess() {
    const allow = new Set(matched)
    const send = rows.filter(r => allow.has(r.emp_code))
    if (send.length === 0) return
    setBusy(true)
    const byRun = new Map<string, AttendanceUploadRow[]>()
    send.forEach(r => {
      const rid = runByCode.current.get(r.emp_code); if (!rid) return
      // paid_days is sent as typed — the server keeps it when present and falls back to
      // (EL+CL+SL+Other) − Absent only when the cell was left blank.
      if (!byRun.has(rid)) byRun.set(rid, [])
      byRun.get(rid)!.push(r as AttendanceUploadRow)
    })
    const all: { emp_code: string; result: string }[] = []
    let err = ''
    for (const [rid, batch] of byRun) {
      const { error, results: res } = await uploadAttendanceBatch(rid, batch)
      if (error) { err = error; break }
      all.push(...res)
    }
    setBusy(false); setShowVal(false)
    if (err) { setParseErr('Upload failed: ' + err); return }
    setResults(all)
  }

  // Re-emit the uploaded sheet unchanged, with a Status column appended per employee.
  function downloadProcessed() {
    if (!results) return
    const statusBy = new Map(results.map(r => [r.emp_code, r.result]))
    // Emp codes are unique here (duplicates are blocked before upload), so the parsed
    // row can be looked up by code rather than relying on positional alignment.
    const parsedBy = new Map(rows.map(r => [r.emp_code, r]))
    const out = rawRows.map(r => {
      const code = codeOfRaw(r)
      const p = parsedBy.get(code)
      const paid = p ? (p.paid_days ?? ((p.earned_leave || 0) + (p.casual_leave || 0) + (p.sick_leave || 0) + (p.other_leave || 0) - (p.absent_days || 0))) : null
      return {
        ...r,
        // Weekly Off + EL + CL + SL + Other Leave + Paid Days − Absent Days
        'Total Days': p && paid != null ? totalDaysOf(p, paid) : '',
        'Status': statusBy.get(code) === 'UPDATED' ? 'Processed' : 'Not processed',
      }
    })
    const ws = XLSX.utils.json_to_sheet(out)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    const base = fileName.replace(/\.(xlsx|xls)$/i, '') || 'Attendance'
    XLSX.writeFile(wb, `${base}_Processed.xlsx`)
  }

  const updated = results?.filter(r => r.result === 'UPDATED').length || 0
  const notFound = results?.filter(r => r.result !== 'UPDATED') || []
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }
  const nn = (v: any) => Number(v) || 0
  const companyCount = allRuns.filter(r => String(r.month) === upMonth).length

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Attendance Upload</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Leave · absent days into the frozen month snapshot — Paid Days is computed as (EL+CL+SL+Other) − Absent</div>
        </div>
      </div>

      <DownloadCard companyId={companyId} fy={fy}
        heading="Download attendance sheet" note="— filter and download a ready-to-fill sheet"
        filePrefix="Attendance" sheetName="Attendance"
        buildRow={(r, ctx) => ({
          ...(ctx.isGroup ? { 'Company': ctx.companyName } : {}),
          'Emp Code': r.employee_code || '', 'Employee Name': r.full_name || '', 'Department': r.department || '',
          'Designation': r.designation || '', 'Month': ctx.periodLabel,
          'Date of Joining': fmtDate(ctx.doj), 'Date of Leaving': fmtDate(ctx.dol),
          'Days in Month': r.days_in_month ?? (ctx.periodISO ? monthMeta(ctx.periodISO).daysInMonth : ''),
          'Max Days': maxDaysLive(ctx.dol, ctx.periodISO) ?? '',
          'Weekly Off': 0,
          'EL': nn(r.earned_leave), 'CL': nn(r.casual_leave), 'SL': nn(r.sick_leave),
          'Other Leave': nn(r.other_leave), 'Paid Days': nn(r.paid_days), 'Absent Days': nn(r.absent_days),
        })} />

      {/* ── Upload attendance — always group-wide ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Upload filled attendance</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <div>
            <label style={lbl}>Company</label>
            <SearchSelect value="__group__" options={[{ value: '__group__', label: 'Group Companies (all)' }]}
              placeholder="Group Companies" onChange={() => {}} />
          </div>
          <div>
            <label style={lbl}>Payroll month</label>
            <SearchSelect value={upMonth} options={monthOptions}
              placeholder={monthOptions.length ? 'Select month' : 'No month created'}
              onChange={v => { setUpMonth(v); resetUpload() }} />
          </div>
          <div>
            <label style={lbl}>Attendance file (.xlsx)</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ ...inp, padding: '7px 10px', width: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10 }}>
          One sheet covers <b>every company</b> in the group{companyCount ? ` (${companyCount} this month)` : ''} — codes are matched across all of them.
          Columns: <b>Emp Code, Weekly Off, EL, CL, SL, Other Leave, Paid Days, Absent Days</b>. Before anything is saved every row is checked for
          <b> Paid Days ≤ Max Days</b> and <b>Total Days ≤ Max Days</b>, where Total Days = Weekly Off + EL + CL + SL + Other Leave + Paid Days − Absent Days.
        </div>

        {/* Upload — starts the checking pass. Nothing is read until this is clicked. */}
        {sheetErrs.length > 0 && (
          <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>This sheet has been modified — upload blocked.</div>
            {sheetErrs.map((e, i) => <div key={i} style={{ padding: '2px 0' }}>• {e}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {(() => {
            const off = !rows.length || !upMonth || checking || busy || sheetErrs.length > 0
            return (
              <button onClick={() => runValidation(rows)} disabled={off}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brandDeep})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1, boxShadow: '0 3px 10px rgba(37,99,235,0.22)' }}>
                {checking ? 'Checking…' : '⬆ Upload attendance'}
              </button>
            )
          })()}
          {rows.length > 0 && !checking && sheetErrs.length === 0 && (
            <span style={{ fontSize: 11.5, color: C.purpleD }}><b>{fileName}</b> · {rows.length} rows ready</span>
          )}
          {!rows.length && <span style={{ fontSize: 11.5, color: C.muted }}>Choose a file to enable upload</span>}
        </div>

        {parseErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 7, marginTop: 10 }}>{parseErr}</div>}
      </div>

      {showVal && (
        <ValidationCard pct={valPct} checking={checking} stage={stage} total={rows.length}
          matched={matched} unmatched={unmatched} violations={violations}
          onProcess={doProcess} onCancel={resetUpload} busy={busy} kind="attendance" strictUnmatched />
      )}

      {rows.length > 0 && !results && !showVal && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Preview · {fileName} ({rows.length} rows)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr style={{ background: C.navy }}>{['Emp Code', 'WO', 'EL', 'CL', 'SL', 'Other', 'Absent', 'Paid Days', 'Total Days'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Emp Code' ? 'left' : 'right', fontSize: 9.5, color: `${TK.brandEdge}`, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => {
                  const pd = r.paid_days ?? ((r.earned_leave || 0) + (r.casual_leave || 0) + (r.sick_leave || 0) + (r.other_leave || 0) - (r.absent_days || 0))
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: C.navy }}>{r.emp_code}</td>
                      {[r.weekly_off, r.earned_leave, r.casual_leave, r.sick_leave, r.other_leave, r.absent_days].map((v, j) => <td key={j} style={{ padding: '7px 10px', textAlign: 'right', color: C.navy }}>{v ?? '—'}</td>)}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: pd < 0 ? C.red : C.green }}>{pd}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.purpleD }}>{totalDaysOf(r, pd)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 8 && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>+ {rows.length - 8} more rows…</div>}
          </div>
        </div>
      )}

      {results && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Result</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>
            ✓ {updated} of {results.length} rows updated
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: notFound.length ? 12 : 0 }}>
            <button onClick={downloadProcessed}
              style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
              ⬇ Download processed file
            </button>
            <span style={{ fontSize: 11.5, color: C.muted }}>Your uploaded sheet plus <b>Total Days</b> and <b>Status</b> — each employee marked <b>Processed</b>.</span>
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
