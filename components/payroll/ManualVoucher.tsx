'use client'
// components/payroll/ManualVoucher.tsx — Payroll → Configuration → Manual Voucher.
//
// One-off Addition / Deduction amounts against a specific employee in a specific
// payroll month. Three tabs:
//   Individual  — one entry at a time
//   Bulk upload — pick heads → download a template of this month's employees
//                 (pre-filled with anything already saved) → fill → upload
//   Tracking    — every create / replace / delete, most recent first
//
// Both entry tabs call saveVoucher(), the one write path, so re-entering the same
// head for the same employee replaces the value identically either way.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import {
  loadVoucherHeads, loadVoucherEntries, loadVoucherAudit, saveVoucher, deleteVoucher,
  type VoucherHead, type VoucherEntry, type VoucherAudit,
} from '@/lib/payroll/manual-voucher'
import { C, font, lbl, ddInp, SearchSelect, type Opt } from './attendanceShared'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

type Tab = 'individual' | 'bulk' | 'tracking'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const ACTION_TONE: Record<string, { bg: string; fg: string }> = {
  CREATED: { bg: TK.positiveTint, fg: TK.positive },
  REPLACED: { bg: TK.warningTint, fg: TK.warning },
  DELETED: { bg: TK.criticalTint, fg: TK.critical },
}

export default function ManualVoucher({ companyId, fy }: { companyId: string; fy: string }) {
  const [tab, setTab] = useState<Tab>('individual')
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')          // month number — one entry per month, not per company
  const [runByCode, setRunByCode] = useState<Record<string, string>>({})
  const [coByRun, setCoByRun] = useState<Record<string, string>>({})
  const [heads, setHeads] = useState<VoucherHead[]>([])
  const [entries, setEntries] = useState<VoucherEntry[]>([])
  const [audit, setAudit] = useState<VoucherAudit[]>([])
  const [empOpts, setEmpOpts] = useState<Opt[]>([])

  // individual form
  const [empCode, setEmpCode] = useState('')
  const [headName, setHeadName] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  // bulk
  const [picked, setPicked] = useState<string[]>([])
  const [bulkRows, setBulkRows] = useState<any[] | null>(null)
  const [bulkFile, setBulkFile] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResults, setBulkResults] = useState<{ code: string; head: string; ok: boolean; detail: string }[] | null>(null)

  useEffect(() => { loadVoucherHeads().then(setHeads).catch(() => {}) }, [])
  useEffect(() => {
    loadRuns(companyId, fy).then(list => {
      setRuns(list)
      if (list.length) setMonthVal(p => p || String([...list].sort((a, b) => (a.month || 0) - (b.month || 0))[0].month))
    }).catch(() => {})
  }, [companyId, fy])

  // In Group Companies mode one calendar month spans several runs — one per company.
  // Everything below works off that set, so the month appears once rather than three times.
  const monthRuns = runs.filter(r => String(r.month) === monthVal)
  const runIds = monthRuns.map(r => r.id)
  const isGroup = !companyId

  const refresh = useCallback(async () => {
    if (!runIds.length) { setEntries([]); setAudit([]); setEmpOpts([]); setRunByCode({}); return }
    setEntries(await loadVoucherEntries(runIds))
    setAudit(await loadVoucherAudit(runIds))
    const { data } = await supabase.from('payroll_employee_snapshot')
      .select('run_id, employee_code, full_name').in('run_id', runIds).order('employee_code')
    const co: Record<string, string> = {}; monthRuns.forEach(r => { co[r.id] = r.company_name || '' })
    const byCode: Record<string, string> = {}
    ;(data || []).forEach((e: any) => { byCode[e.employee_code] = e.run_id })
    setCoByRun(co); setRunByCode(byCode)
    setEmpOpts((data || []).map((e: any) => ({
      value: e.employee_code,
      label: `${e.employee_code} — ${e.full_name}${isGroup && co[e.run_id] ? ` · ${co[e.run_id]}` : ''}`,
    })))
  }, [runIds.join(','), isGroup])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [refresh])

  const runOpts: Opt[] = Array.from(new Map(runs.map(r =>
    [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }]
  )).values()).sort((a, b) => Number(a.value) - Number(b.value))
  const headOpts: Opt[] = heads.map(h => ({ value: h.head_name, label: `${h.head_name} · ${h.head_type}` }))
  const headType = heads.find(h => h.head_name === headName)?.head_type || ''

  async function saveOne() {
    setErr(''); setMsg('')
    if (!runIds.length || !empCode || !headName || amount.trim() === '') { setErr('Month, employee, head and amount are all required.'); return }
    const rid = runByCode[empCode]
    if (!rid) { setErr(`${empCode} is not in this payroll month.`); return }
    setBusy(true)
    const { error, action } = await saveVoucher({ runId: rid, empCode, headName, amount: Number(amount), remark, via: 'INDIVIDUAL' })
    setBusy(false)
    if (error) { setErr(error); return }
    setMsg(`${action === 'REPLACED' ? 'Replaced' : 'Saved'} — ${headName} ${inr(amount)} for ${empCode}.`)
    setAmount(''); setRemark(''); refresh()
  }

  async function removeEntry(e: VoucherEntry) {
    setErr(''); setMsg('')
    const { error } = await deleteVoucher(e.id)
    if (error) { setErr(error); return }
    setMsg(`Deleted — ${e.head_name} for ${e.employee_code}.`); refresh()
  }

  // ── Bulk template: this month's employees × the picked heads, pre-filled ──
  async function downloadTemplate() {
    if (!runIds.length || !picked.length) { setErr('Pick a month and at least one head.'); return }
    setErr('')
    const { data: snap } = await supabase.from('payroll_employee_snapshot')
      .select('run_id, employee_code, full_name, department').in('run_id', runIds).order('employee_code')
    const existing = new Map(entries.map(e => [`${e.employee_code}|${e.head_name}`, e.amount]))
    const sheet = (snap || []).map((s: any) => {
      const row: Record<string, any> = {
        ...(isGroup ? { 'Company': coByRun[s.run_id] || '' } : {}),
        'Emp Code': s.employee_code, 'Employee Name': s.full_name, 'Department': s.department || '',
      }
      // Blank, not 0, where nothing is saved — so "not set" stays distinguishable
      // from "deliberately set to zero".
      picked.forEach(h => { const v = existing.get(`${s.employee_code}|${h}`); row[h] = v == null ? '' : v })
      return row
    })
    const header = [...(isGroup ? ['Company'] : []), 'Emp Code', 'Employee Name', 'Department', ...picked]
    const ws = XLSX.utils.json_to_sheet(sheet, { header })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Manual Voucher')
    const label = (monthRuns[0]?.period_label || 'Month').replace(/[^A-Za-z0-9]+/g, '_')
    XLSX.writeFile(wb, `Manual_Voucher_${label}.xlsx`)
  }

  function handleBulkFile(ev: React.ChangeEvent<HTMLInputElement>) {
    setErr(''); setBulkResults(null); setBulkRows(null)
    const file = ev.target.files?.[0]; if (!file) return
    setBulkFile(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        if (!raw.length) { setErr('That file has no rows.'); return }
        setBulkRows(raw)
      } catch (x: any) { setErr('Could not read the file: ' + (x.message || x)) }
    }
    reader.readAsArrayBuffer(file)
  }

  // Each row is saved on its own — one bad row reports an error, the rest still save.
  async function processBulk() {
    if (!bulkRows || !runIds.length) return
    setBulkBusy(true); setBulkResults(null); setErr('')
    const known = new Set(heads.map(h => h.head_name))
    const out: { code: string; head: string; ok: boolean; detail: string }[] = []
    for (const row of bulkRows) {
      const codeKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'emp code' || k.trim().toLowerCase() === 'emp_code')
      const code = String(row[codeKey || 'Emp Code'] ?? '').trim()
      if (!code) continue
      for (const key of Object.keys(row)) {
        const head = key.trim()
        if (!known.has(head)) continue                     // skip the label columns
        const cell = row[key]
        if (cell === '' || cell === null || cell === undefined) continue   // blank = leave alone
        const amt = Number(cell)
        if (isNaN(amt)) { out.push({ code, head, ok: false, detail: `"${cell}" is not a number` }); continue }
        const rid = runByCode[code]
        if (!rid) { out.push({ code, head, ok: false, detail: 'not in this payroll month' }); continue }
        const { error, action } = await saveVoucher({ runId: rid, empCode: code, headName: head, amount: amt, remark: null, via: 'BULK', sourceFile: bulkFile })
        out.push({ code, head, ok: !error, detail: error || (action === 'REPLACED' ? `Replaced → ${inr(amt)}` : `Created → ${inr(amt)}`) })
      }
      // Flag heads present in the sheet that this system doesn't know about.
      Object.keys(row).forEach(k => {
        const h = k.trim()
        if (['Company', 'Emp Code', 'Employee Name', 'Department'].includes(h) || known.has(h) || h.startsWith('__EMPTY')) return
        if (!out.some(o => o.head === h && o.code === code)) out.push({ code, head: h, ok: false, detail: 'Unknown voucher head' })
      })
    }
    setBulkBusy(false); setBulkResults(out); refresh()
  }

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 9.5, color: TK.brand, fontWeight: 700, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '7px 10px', color: C.navy, whiteSpace: 'nowrap' }
  const pill = (on: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 99, border: `0.5px solid ${on ? C.purple : TK.brandTint}`, cursor: 'pointer',
    fontSize: 11.5, fontWeight: on ? 600 : 500, fontFamily: 'inherit', background: on ? C.purple : TK.sunken, color: on ? TK.surface : C.navy,
  })
  const okCount = bulkResults?.filter(r => r.ok).length || 0
  const badCount = bulkResults?.filter(r => !r.ok).length || 0

  // The Individual and Tracking lists are headed by the file the amounts came from —
  // not by a running count, which only ever showed the load cap. Entries typed by hand
  // carry no file, so a month with nothing uploaded shows no heading at all.
  const fileNames = (rows: { source_file?: string | null }[]) =>
    Array.from(new Set(rows.map(r => r.source_file).filter(Boolean))) as string[]
  const fileHead = (names: string[]) => names.length === 0 ? null : (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
      <span style={{ fontSize: 13 }}></span>
      {names.map(n => (
        <span key={n} style={{ fontSize: 11.5, fontWeight: 700, color: C.purpleD, background: TK.brandTint, border: `0.5px solid ${C.border}`, borderRadius: 99, padding: '3px 11px' }}>{n}</span>
      ))}
    </div>
  )

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Manual Voucher</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>One-off additions and deductions for a specific employee in a specific month</div>
        </div>
      </div>

      {!companyId && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>Pick a specific company in the header to see its payroll months.</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {([['individual', 'Individual'], ['bulk', 'Bulk upload'], ['tracking', 'Tracking']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(''); setErr('') }} style={pill(tab === k)}>{l}</button>
        ))}
      </div>

      <div style={card}>
        <label style={lbl}>Payroll month</label>
        <div style={{ maxWidth: 340 }}>
          <SearchSelect value={monthVal} options={runOpts} placeholder={runOpts.length ? 'Select month' : 'No month created'} onChange={v => { setMonthVal(v); setMsg(''); setErr('') }} />
        </div>
      </div>

      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 9, padding: '10px 12px', marginBottom: 12 }}>{err}</div>}

      {/* ── Individual ── */}
      {tab === 'individual' && (
        <>
          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Add an entry</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div><label style={lbl}>Employee</label><SearchSelect value={empCode} options={empOpts} placeholder={empOpts.length ? 'Search emp code / name' : 'No employees in this month'} onChange={setEmpCode} /></div>
              <div><label style={lbl}>Voucher head</label><SearchSelect value={headName} options={headOpts} placeholder="Select head" onChange={setHeadName} /></div>
              <div><label style={lbl}>Amount</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={ddInp} /></div>
              <div><label style={lbl}>Remark</label><input value={remark} onChange={e => setRemark(e.target.value)} placeholder="e.g. Diwali bonus" style={ddInp} /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={saveOne} disabled={busy}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save entry'}
              </button>
              {headType && <span style={{ fontSize: 11.5, fontWeight: 700, color: headType === 'Addition' ? C.green : C.red }}>{headType}</span>}
              <span style={{ fontSize: 10.5, color: C.muted }}>Saving the same head again for this employee replaces the existing amount.</span>
            </div>
          </div>

          <div style={card}>
            {fileHead(fileNames([...entries].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))))}
            {entries.length === 0
              ? <div style={{ fontSize: 12, color: C.muted, padding: '14px 0', textAlign: 'center' }}>Nothing added for this month yet.</div>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                    <thead><tr style={{ background: C.navy }}>{[...(isGroup ? ['Company'] : []), 'Emp Code', 'Head', 'Type', 'Amount', 'Remark', 'Via', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                          {isGroup && <td style={{ ...td, color: C.muted }}>{coByRun[e.run_id] || '—'}</td>}
                          <td style={{ ...td, fontWeight: 700 }}>{e.employee_code}</td>
                          <td style={td}>{e.head_name}</td>
                          <td style={{ ...td, color: e.head_type === 'Addition' ? C.green : C.red, fontWeight: 700 }}>{e.head_type}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{inr(e.amount)}</td>
                          <td style={{ ...td, color: C.muted }}>{e.remark || '—'}</td>
                          <td style={{ ...td, color: C.muted, fontSize: 11 }}>{e.uploaded_via}</td>
                          <td style={td}>
                            <button onClick={() => removeEntry(e)} style={{ padding: '4px 10px', borderRadius: 99, border: `0.5px solid ${C.red}`, background: C.redBg, color: C.red, fontWeight: 700, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      )}

      {/* ── Bulk ── */}
      {tab === 'bulk' && (
        <>
          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 4 }}>1 · Pick the heads to process</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 12 }}>The template will have one column per head, pre-filled with anything already saved.</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
              {heads.map(h => {
                const on = picked.includes(h.head_name)
                return (
                  <button key={h.id} onClick={() => setPicked(p => on ? p.filter(x => x !== h.head_name) : [...p, h.head_name])}
                    title={h.note || h.head_type}
                    style={{ ...pill(on), fontSize: 11, padding: '5px 11px' }}>
                    {h.head_name}
                    <span style={{ marginLeft: 6, opacity: 0.75, fontSize: 9.5 }}>{h.head_type === 'Addition' ? '+' : '−'}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={downloadTemplate} disabled={!picked.length || !runIds.length}
                style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: TK.onAccent, fontWeight: 700, fontSize: 12.5, cursor: picked.length && runIds.length ? 'pointer' : 'not-allowed', opacity: picked.length && runIds.length ? 1 : 0.5 }}>
                ⬇ Download template
              </button>
              <span style={{ fontSize: 11, color: C.muted }}>{picked.length} head{picked.length === 1 ? '' : 's'} selected</span>
              {picked.length > 0 && <span onClick={() => setPicked([])} style={{ fontSize: 11, color: C.red, cursor: 'pointer', fontWeight: 700 }}>Clear</span>}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>2 · Upload the filled file</div>
            <input type="file" accept=".xlsx,.xls" onChange={handleBulkFile} style={{ ...ddInp, padding: '7px 10px' }} />
            {bulkRows && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={processBulk} disabled={bulkBusy}
                  style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>
                  {bulkBusy ? 'Saving…' : `Save ${bulkRows.length} rows`}
                </button>
                <span style={{ fontSize: 11.5, color: C.purpleD }}><b>{bulkFile}</b> · {bulkRows.length} employees</span>
              </div>
            )}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10 }}>A blank cell is left alone. Each row saves on its own, so one bad value doesn&apos;t stop the rest.</div>
          </div>

          {bulkResults && (
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Result</div>
              <div style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ color: C.green }}>✓ {okCount} saved</span>
                {badCount > 0 && <span style={{ color: C.red }}>✕ {badCount} failed</span>}
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {bulkResults.map((r, i) => (
                  <div key={i} style={{ fontSize: 11.5, padding: '4px 0', color: r.ok ? C.navy : C.red, borderBottom: `1px solid ${TK.brandEdge}` }}>
                    {r.ok ? '' : ''} <b>{r.code}</b> · {r.head} — {r.detail}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tracking ── */}
      {tab === 'tracking' && (
        <div style={card}>
          {fileHead(fileNames(audit))}
          {audit.length === 0
            ? <div style={{ fontSize: 12, color: C.muted, padding: '14px 0', textAlign: 'center' }}>No voucher activity for this month yet.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                  <thead><tr style={{ background: C.navy }}>{['When', 'Emp Code', 'Head', 'Action', 'Old', 'New', 'Via'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {audit.map((a, i) => {
                      const t = ACTION_TONE[a.action] || { bg: C.gray, fg: C.muted }
                      return (
                        <tr key={a.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                          <td style={{ ...td, color: C.muted, fontSize: 11 }}>{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{a.employee_code}</td>
                          <td style={td}>{a.head_name}</td>
                          <td style={td}><span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: t.bg, color: t.fg }}>{a.action}</span></td>
                          <td style={{ ...td, color: C.muted }}>{a.old_amount == null ? '—' : inr(a.old_amount)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{a.new_amount == null ? '—' : inr(a.new_amount)}</td>
                          <td style={{ ...td, color: C.muted, fontSize: 11 }}>{a.uploaded_via || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
