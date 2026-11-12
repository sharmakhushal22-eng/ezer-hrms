'use client'
// components/payroll/StatutoryComponentReport.tsx — Payroll → Statutory & Tax → PF / EPF + VPF,
// ESIC, Professional Tax, LWF and TDS: an employee-wise register of every component that
// statutory touches, the way NPS has its enrolment report.
//
// The rows are the month's payroll_employee_snapshot (Run Payroll's own figures), so the
// register says what payroll actually used, not what it would use today. The columns come
// from lib/payroll/statutory-report.ts, grouped (settings → earnings in the wage → the wage →
// contributions → CTC structure → arrear); a group can be hidden to read a narrow slice.
//
// The month is the header's Month; when that month is not created for this selection yet,
// the latest month that is shows, and the screen says so.
//
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { STATUTORY_REPORTS, IDENTITY, snapshotColumns, cellValue, isYes, type StatCol, type StatReport } from '@/lib/payroll/statutory-report'
import { C, F, W, R, E, S, Z } from '@/lib/ui'

const font = F.family
const inr = (n: number) => Math.round(n || 0).toLocaleString('en-IN')
const fmtDate = (d?: string | null) =>
  d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const calYear = (fy: string, m: number) => (Number(fy.split('-')[0]) || 2026) + (m >= 10 ? 1 : 0)
const monthLabel = (fy: string, m: number) => `${MONTHS[m - 1]} ${calYear(fy, m)}`

const T = {
  card: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: `${S.lg}px ${S.lg + 2}px`, marginBottom: S.md, boxShadow: E.flat } as React.CSSProperties,
  sel: { height: 34, padding: '0 10px', border: `1px solid ${C.lineStrong}`, borderRadius: R.sm, fontSize: F.small, fontFamily: font, background: C.surface, color: C.ink, outline: 'none', minWidth: 150 } as React.CSSProperties,
  btnP: { height: 34, padding: '0 14px', borderRadius: R.md, border: `1px solid ${C.brandDeep}`, background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent, fontWeight: W.semi, fontSize: F.small, cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap', boxShadow: E.brand } as React.CSSProperties,
  btnO: { height: 34, padding: '0 12px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontWeight: W.medium, fontSize: F.small, cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap' } as React.CSSProperties,
  th: { padding: '8px 10px', fontSize: 10, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'left', whiteSpace: 'nowrap', background: C.sunken, borderBottom: `1px solid ${C.line}` } as React.CSSProperties,
  td: { padding: '7px 10px', fontSize: 12, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap', color: C.ink, background: C.surface } as React.CSSProperties,
}

type Row = Record<string, any> & { _company: string }

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div style={{ background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '9px 14px', minWidth: 104 }}>
      <div style={{ fontSize: 10, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: tone || C.ink, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function Cell({ col, row }: { col: StatCol; row: Row }) {
  const v = cellValue(col, row)
  if (col.kind === 'yn') {
    if (v == null || v === '') return <span style={{ color: C.faint }}>-</span>
    const y = isYes(v)
    return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 99, background: y ? C.positiveTint : C.sunken, color: y ? C.positive : C.muted }}>{y ? 'Y' : 'N'}</span>
  }
  if (v == null || v === '') return <span style={{ color: C.faint }}>-</span>
  if (col.kind === 'inr') return <span style={{ fontVariantNumeric: 'tabular-nums', color: Number(v) ? C.ink : C.faint }}>{inr(Number(v))}</span>
  if (col.kind === 'num') return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(v).toLocaleString('en-IN')}</span>
  if (col.kind === 'pct') return <>{Number(v)}%</>
  if (col.kind === 'date') return <>{fmtDate(v)}</>
  return <>{String(v)}</>
}

/** Excel value for a cell: numbers stay numbers, Y/N spelled out. */
function excelValue(col: StatCol, row: Row) {
  const v = cellValue(col, row)
  if (v == null || v === '') return ''
  if (col.kind === 'yn') return isYes(v) ? 'Y' : 'N'
  if (col.kind === 'inr' || col.kind === 'num' || col.kind === 'pct') return Number(v)
  if (col.kind === 'date') return String(v).slice(0, 10)
  return String(v)
}

export default function StatutoryComponentReport({ kind, companyId, fy, month }: { kind: keyof typeof STATUTORY_REPORTS; companyId: string; fy: string; month?: number }) {
  const rep: StatReport = STATUTORY_REPORTS[kind]
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fApp, setFApp] = useState<'all' | 'y' | 'n'>('all')
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const isGroup = !companyId

  useEffect(() => {
    loadRuns(companyId, fy).then(rs => setRuns(rs.filter(r => r.status !== 'CANCELLED'))).catch(e => setErr(e?.message || String(e)))
  }, [companyId, fy])

  // The header's month when it exists here, else the latest month that does.
  const months = useMemo(() => Array.from(new Set(runs.map(r => r.month as number))).sort((a, b) => a - b), [runs])
  const shownMonth = month && months.includes(month) ? month : months[months.length - 1]
  const monthRuns = useMemo(() => runs.filter(r => r.month === shownMonth), [runs, shownMonth])

  const load = useCallback(async () => {
    setErr('')
    if (!monthRuns.length) { setRows([]); setLoading(false); return }
    setLoading(true)
    try {
      const cols = snapshotColumns(rep).join(',')
      const out: Row[] = []
      for (const run of monthRuns) {
        // Paginated: PostgREST caps a response at 1000 rows.
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from('payroll_employee_snapshot').select(cols)
            .eq('run_id', run.id).order('employee_code').range(from, from + 999)
          if (error) throw new Error(error.message)
          const batch = (data || []) as any[]
          batch.forEach(r => out.push({ ...r, _company: run.company_name || '-' }))
          if (batch.length < 1000) break
        }
      }
      setRows(out)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [monthRuns, rep])
  useEffect(() => { load() }, [load])

  const companies = useMemo(() => Array.from(new Set(rows.map(r => r._company))).sort(), [rows])
  const depts = useMemo(() => Array.from(new Set(rows.map(r => r.department).filter(Boolean))).sort() as string[], [rows])
  const locs = useMemo(() => Array.from(new Set(rows.map(r => r.location).filter(Boolean))).sort() as string[], [rows])

  const shown = useMemo(() => {
    const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    return rows.filter(r => {
      if (fCompany && r._company !== fCompany) return false
      if (fDept && r.department !== fDept) return false
      if (fLoc && r.location !== fLoc) return false
      if (fApp === 'y' && !rep.applicable(r)) return false
      if (fApp === 'n' && rep.applicable(r)) return false
      if (!terms.length) return true
      return terms.some(t => String(r.employee_code || '').toLowerCase().includes(t) || String(r.full_name || '').toLowerCase().includes(t))
    })
  }, [rows, fCompany, fDept, fLoc, fApp, q, rep])

  const groups = rep.groups.filter(g => !hidden.has(g.title))
  // Code and name always; company in group mode; department, location, DOJ and DOL behind
  // the "Employee details" chip so the statutory columns can sit next to the name.
  const DETAILS = 'Employee details'
  const identity = [
    ...(isGroup ? [{ key: '_company', label: 'Company', kind: 'text' as const }] : []),
    ...IDENTITY.filter(col => !hidden.has(DETAILS) || col.key === 'employee_code' || col.key === 'full_name'),
  ]
  const applicableCount = shown.filter(rep.applicable).length
  const sum = (k: string) => shown.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const coCount = new Set(monthRuns.map(r => r.company_id)).size
  const monthMissing = !!month && !!shownMonth && month !== shownMonth

  function download() {
    const all = rep.groups
    const groupRow: any[] = identity.map(() => ''), headRow: any[] = identity.map(col => col.label)
    const merges: any[] = []
    let at = identity.length
    for (const g of all) {
      groupRow.push(g.title.toUpperCase(), ...g.cols.slice(1).map(() => ''))
      headRow.push(...g.cols.map(col => col.label))
      if (g.cols.length > 1) merges.push({ s: { r: 0, c: at }, e: { r: 0, c: at + g.cols.length - 1 } })
      at += g.cols.length
    }
    const body = shown.map(r => [...identity.map(col => excelValue(col, r)), ...all.flatMap(g => g.cols.map(col => excelValue(col, r)))])
    const ws = XLSX.utils.aoa_to_sheet([groupRow, headRow, ...body])
    ws['!merges'] = merges
    ws['!cols'] = headRow.map((h: string) => ({ wch: Math.max(10, Math.min(26, String(h).length + 3)) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, rep.title.slice(0, 30))
    XLSX.writeFile(wb, `${rep.key.toUpperCase()}_Register_${MONTHS[(shownMonth || 1) - 1]}_${calYear(fy, shownMonth || 1)}.xlsx`)
  }

  const stickyL = (i: number): React.CSSProperties => i === 0 ? { position: 'sticky', left: 0, zIndex: Z.raised } : {}

  return (
    <div style={{ fontFamily: font, color: C.ink }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: S.md, flexWrap: 'wrap', marginBottom: S.md }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-.01em' }}>{rep.title}</div>
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{rep.subtitle}</div>
        </div>
        {shownMonth && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 99, background: C.brandTint, border: `1px solid ${C.brandEdge}`, fontSize: F.tiny, color: C.brandDeep, fontWeight: W.semi, whiteSpace: 'nowrap' }}>
            {monthLabel(fy, shownMonth)} · {isGroup ? `${coCount} compan${coCount === 1 ? 'y' : 'ies'}` : (monthRuns[0]?.company_name || '')}
            {monthRuns.length > 0 && <span style={{ color: C.muted, fontWeight: W.medium }}>· {Array.from(new Set(monthRuns.map(r => r.status))).join(', ')}</span>}
          </div>
        )}
      </div>

      {monthMissing && (
        <div style={{ ...T.card, background: C.warningTint, border: `1px solid ${C.warningEdge}`, color: C.warning, fontSize: F.small, padding: '10px 14px' }}>
          {monthLabel(fy, month!)} has not been created for this selection yet, so this shows {monthLabel(fy, shownMonth!)}, the latest month that has.
        </div>
      )}
      {err && <div style={{ ...T.card, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, color: C.critical, fontSize: F.small }}>{err}</div>}

      <div style={T.card}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <Stat label="Employees" value={shown.length} />
          <Stat label={`${rep.applicableLabel}: Y`} value={applicableCount} tone={applicableCount ? C.positive : C.muted} />
          <Stat label={`${rep.applicableLabel}: N`} value={shown.length - applicableCount} tone={C.muted} />
          {rep.totals.map(t => <Stat key={t.key} label={t.label} value={inr(sum(t.key))} tone={C.brandDeep} />)}
          <div style={{ flex: 1 }} />
          <button className="ez-press" onClick={download} disabled={!shown.length} style={{ ...T.btnP, opacity: shown.length ? 1 : 0.5 }}>Download Excel ({shown.length})</button>
          <button className="ez-press" onClick={load} style={T.btnO}>Refresh</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isGroup && (
            <select style={T.sel} value={fCompany} onChange={e => setFCompany(e.target.value)}>
              <option value="">Group Companies (all)</option>{companies.map(x => <option key={x}>{x}</option>)}
            </select>
          )}
          <select style={T.sel} value={fDept} onChange={e => setFDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <select style={T.sel} value={fLoc} onChange={e => setFLoc(e.target.value)}>
            <option value="">All locations</option>{locs.map(l => <option key={l}>{l}</option>)}
          </select>
          <select style={T.sel} value={fApp} onChange={e => setFApp(e.target.value as any)}>
            <option value="all">{rep.applicableLabel}: all</option>
            <option value="y">{rep.applicableLabel}: Y only</option>
            <option value="n">{rep.applicableLabel}: N only</option>
          </select>
          <input style={{ ...T.sel, flex: 1, minWidth: 200 }} placeholder="Employee code or name, or paste a list" value={q} onChange={e => setQ(e.target.value)} />
          {(fCompany || fDept || fLoc || fApp !== 'all' || q) && (
            <button onClick={() => { setFCompany(''); setFDept(''); setFLoc(''); setFApp('all'); setQ('') }} style={T.btnO}>Clear</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.semi, marginRight: 2 }}>Columns:</span>
          {[{ title: DETAILS, cols: IDENTITY.slice(2) }, ...rep.groups].map(g => {
            const on = !hidden.has(g.title)
            return (
              <button key={g.title} onClick={() => setHidden(h => { const n = new Set(h); on ? n.add(g.title) : n.delete(g.title); return n })}
                style={{ fontSize: 11, fontWeight: W.semi, padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: font,
                  border: `1px solid ${on ? C.brandEdge : C.line}`, background: on ? C.brandTint : C.surface, color: on ? C.brandDeep : C.muted }}>
                {on ? '✓ ' : ''}{g.title} <span style={{ opacity: .7 }}>{g.cols.length}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ ...T.card, padding: 0, overflow: 'auto', maxHeight: '72vh' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: F.small }}>Loading…</div>
        ) : !monthRuns.length ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: F.small }}>No payroll month for FY {fy} yet. Create one in Configuration → Payroll Month and run payroll; this register fills from it.</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: F.small }}>{rows.length === 0 ? 'No employees in this month.' : 'Nothing matched this filter.'}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: Z.sticky }}>
              <tr>
                <th colSpan={identity.length} style={{ ...T.th, ...stickyL(0), zIndex: Z.sticky, background: C.surface, color: C.ink }}></th>
                {groups.map(g => (
                  <th key={g.title} colSpan={g.cols.length} style={{ ...T.th, background: C.brandTint, color: C.brandDeep, borderLeft: `1px solid ${C.brandEdge}` }}>{g.title}</th>
                ))}
              </tr>
              <tr>
                {identity.map((col, i) => <th key={col.key} style={{ ...T.th, ...stickyL(i), zIndex: i === 0 ? Z.sticky : undefined }}>{col.label}</th>)}
                {groups.flatMap(g => g.cols.map((col, i) => (
                  <th key={g.title + col.key} style={{ ...T.th, textAlign: col.kind === 'inr' || col.kind === 'num' ? 'right' : 'left', borderLeft: i === 0 ? `1px solid ${C.line}` : undefined }}>{col.label}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={`${r._company}-${r.employee_code}`}>
                  {identity.map((col, i) => (
                    <td key={col.key} style={{ ...T.td, ...stickyL(i), fontWeight: col.key === 'employee_code' ? W.bold : undefined }}><Cell col={col} row={r} /></td>
                  ))}
                  {groups.flatMap(g => g.cols.map((col, i) => (
                    <td key={g.title + col.key} style={{ ...T.td, textAlign: col.kind === 'inr' || col.kind === 'num' ? 'right' : 'left', borderLeft: i === 0 ? `1px solid ${C.line}` : undefined }}><Cell col={col} row={r} /></td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: F.tiny, color: C.brandDeep, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: R.md, padding: '11px 13px', lineHeight: 1.6 }}>
        {rep.notes.map((n, i) => <div key={i}>• {n}</div>)}
        <div style={{ marginTop: 4, color: C.muted }}>Figures are the month as Run Payroll froze and calculated it. A blank means that step has not run for the employee yet, not a zero.</div>
      </div>
    </div>
  )
}
