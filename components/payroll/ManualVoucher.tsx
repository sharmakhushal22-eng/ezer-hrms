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
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import {
  loadVoucherHeads, loadVoucherEntries, loadVoucherAudit, saveVoucher, deleteVoucher,
  type VoucherHead, type VoucherEntry, type VoucherAudit,
} from '@/lib/payroll/manual-voucher'
import { font, ddInp, SearchSelect, ScreenIntro, Fld, Note, FileDrop, type Opt } from './attendanceShared'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, S as SP, R, E, numeric, type Tone, IconReceipt, IconDownload, IconUpload, IconCheck, IconClose, IconAlert, IconPlus, IconEye, IconClock, IconUser } from '@/lib/ui'
import {
  SectionCard, InfoCallout, PButton, SegmentedTabs, ProcessStepper, DataTable, EmptyState, StatusPill, CountChip,
  IconTile, IconFile, IconMonth, dt,
} from '@/components/payroll/kit'

type Tab = 'individual' | 'bulk' | 'tracking'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const ACTION_TONE: Record<string, Tone> = {
  CREATED: 'positive',
  REPLACED: 'warning',
  DELETED: 'critical',
}
const scrim = `color-mix(in srgb, ${TK.dark} 52%, transparent)`

// One toggle chip in the head picker. Module level so the list does not remount.
function HeadChip({ name, type, on, title, onClick }: { name: string; type: string; on: boolean; title?: string; onClick: () => void }) {
  const add = type === 'Addition'
  return (
    <button onClick={onClick} title={title} aria-pressed={on} className="ez-press"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px 0 9px', borderRadius: R.pill,
        fontFamily: 'inherit', fontSize: F.tiny, fontWeight: on ? W.semi : W.medium, cursor: 'pointer', whiteSpace: 'nowrap',
        background: on ? TK.brandTint : TK.surface, color: on ? TK.brandDeep : TK.ink,
        border: `1px solid ${on ? TK.brand : TK.lineStrong}`, boxShadow: on ? 'none' : E.flat,
      }}>
      <span style={{
        width: 16, height: 16, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: on ? TK.brand : TK.sunken, color: on ? TK.onAccent : TK.faint, border: on ? 'none' : `1px solid ${TK.line}`,
      }}>{on ? <IconCheck size={10} strokeWidth={2.6} /> : null}</span>
      {name}
      <span style={{ fontSize: F.micro, fontWeight: W.bold, color: add ? TK.positive : TK.critical }}>{add ? '+' : '−'}</span>
    </button>
  )
}

// ── Delete confirmation ────────────────────────────────────────────────────
// One press used to delete the entry on the spot. A voucher row is money on
// somebody's payslip, and the Delete button sits a few pixels from the table —
// so the row now has to be confirmed in a dialog that shows exactly what is
// about to go. Portaled to body: the payroll page sits under transform-animated
// wrappers, and a transformed ancestor captures position:fixed.
function ConfirmDelete({ entry, company, busy, onCancel, onConfirm }: {
  entry: VoucherEntry; company: string; busy: boolean
  onCancel: () => void; onConfirm: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  if (!mounted) return null
  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: scrim, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      fontFamily: '"DM Sans","Segoe UI",sans-serif',
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="ez-rise" style={{
        background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.xl, width: 'min(440px, 100%)', padding: '20px 22px',
        boxShadow: E.overlay,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginBottom: SP.md }}>
          <IconTile icon={<IconAlert size={18} />} t="critical" size={38} />
          <div>
            <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink }}>Delete this entry?</div>
            <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 1 }}>Manual voucher</div>
          </div>
        </div>
        <div style={{ background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: R.md, padding: '11px 14px', fontSize: F.small, lineHeight: 1.7, marginBottom: SP.sm + 2, ...numeric }}>
          <div><b>{entry.employee_code}</b>{company ? <span style={{ color: TK.muted }}> · {company}</span> : null}</div>
          <div>{entry.head_name} <span style={{ color: entry.head_type === 'Addition' ? TK.positive : TK.critical, fontWeight: W.bold }}>({entry.head_type})</span> · <b>{inr(entry.amount)}</b></div>
          {entry.remark && <div style={{ color: TK.muted }}>“{entry.remark}”</div>}
        </div>
        <div style={{ fontSize: F.tiny, color: TK.muted, lineHeight: 1.55, marginBottom: SP.lg }}>
          The amount leaves this month's payroll for this employee. The removal is recorded in Tracking, but the entry itself cannot be brought back. It would have to be typed in again.
        </div>
        <div style={{ display: 'flex', gap: SP.sm + 2, justifyContent: 'flex-end' }}>
          <PButton onClick={onCancel}>Cancel</PButton>
          <PButton onClick={onConfirm} disabled={busy} icon={<IconClose size={14} />}
            style={busy ? undefined : { background: TK.critical, color: TK.onAccent, border: `1px solid ${TK.critical}` }}>{busy ? 'Deleting…' : 'Delete entry'}</PButton>
        </div>
      </div>
    </div>,
    document.body,
  )
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
  // The entries table renders only after View — a month can carry hundreds of rows,
  // and they pushed the add-entry form's feedback out of sight.
  const [viewList, setViewList] = useState(false)
  const [confirmDel, setConfirmDel] = useState<VoucherEntry | null>(null)
  const [delBusy, setDelBusy] = useState(false)

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
  useEffect(() => { setViewList(false) }, [monthVal])
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
      label: `${e.employee_code} · ${e.full_name}${isGroup && co[e.run_id] ? ` · ${co[e.run_id]}` : ''}`,
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
    setMsg(`${action === 'REPLACED' ? 'Replaced' : 'Saved'}: ${headName} ${inr(amount)} for ${empCode}.`)
    setAmount(''); setRemark(''); refresh()
  }

  // Runs only from the dialog's Delete button — the row button just opens it.
  async function removeEntry(e: VoucherEntry) {
    setErr(''); setMsg(''); setDelBusy(true)
    const { error } = await deleteVoucher(e.id)
    setDelBusy(false); setConfirmDel(null)
    if (error) { setErr(error); return }
    setMsg(`Deleted: ${e.head_name} for ${e.employee_code}.`); refresh()
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

  const okCount = bulkResults?.filter(r => r.ok).length || 0
  const badCount = bulkResults?.filter(r => !r.ok).length || 0

  // The Individual and Tracking lists are headed by the file the amounts came from —
  // not by a running count, which only ever showed the load cap. Entries typed by hand
  // carry no file, so a month with nothing uploaded shows no heading at all.
  const fileNames = (rows: { source_file?: string | null }[]) =>
    Array.from(new Set(rows.map(r => r.source_file).filter(Boolean))) as string[]
  const fileHead = (names: string[]) => names.length === 0 ? null : (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', padding: `${SP.md}px ${SP.lg}px`, borderBottom: `1px solid ${TK.line}`, background: TK.sunken }}>
      <span style={{ display: 'inline-flex', color: TK.muted }}><IconFile size={14} /></span>
      {names.map(n => (
        <span key={n} style={{ fontSize: F.tiny, fontWeight: W.semi, color: TK.brandDeep, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: R.pill, padding: '2px 11px' }}>{n}</span>
      ))}
    </div>
  )
  const th = dt.th
  const td: React.CSSProperties = { ...dt.td, whiteSpace: 'nowrap' }
  const bulkSteps = [
    { key: 'heads', label: 'Pick heads', hint: `${picked.length} selected`, state: (picked.length ? 'done' : 'current') as 'done' | 'current' },
    { key: 'file', label: 'Upload filled file', hint: bulkFile || 'Template .xlsx', state: (bulkRows ? 'done' : picked.length ? 'current' : 'todo') as 'done' | 'current' | 'todo' },
    { key: 'save', label: 'Save rows', hint: bulkRows ? `${bulkRows.length} rows` : 'Each row on its own', state: (bulkResults ? 'done' : bulkRows ? 'current' : 'todo') as 'done' | 'current' | 'todo' },
    { key: 'result', label: 'Result', hint: bulkResults ? `${okCount} saved · ${badCount} failed` : 'Saved / failed', state: (bulkResults ? (badCount ? 'blocked' : 'done') : 'todo') as 'done' | 'blocked' | 'todo' },
  ]

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 1040 }}>
      <ScreenIntro icon={<IconReceipt size={20} />} title="Manual Voucher"
        subtitle="One-off additions and deductions for a specific employee in a specific month"
        meta={<>
          <StatusPill t="positive" size="sm" dot>Addition</StatusPill>
          <StatusPill t="critical" size="sm" dot>Deduction</StatusPill>
        </>}
        actions={
          <div style={{ minWidth: 'min(280px, 100%)' }}>
            <span style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.09em', textTransform: 'uppercase', color: TK.muted, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}><IconMonth size={13} /> Payroll month</span>
            <SearchSelect value={monthVal} options={runOpts} placeholder={runOpts.length ? 'Select month' : 'No month created'} onChange={v => { setMonthVal(v); setMsg(''); setErr('') }} />
          </div>
        } />

      {!companyId && <InfoCallout t="warning" compact>Pick a specific company in the header to see its payroll months.</InfoCallout>}

      <SegmentedTabs<Tab> value={tab} onChange={k => { setTab(k); setMsg(''); setErr('') }} items={[
        { key: 'individual', label: 'Individual', icon: <IconUser size={14} /> },
        { key: 'bulk', label: 'Bulk upload', icon: <IconUpload size={14} /> },
        { key: 'tracking', label: 'Tracking', icon: <IconClock size={14} /> },
      ]} />

      {msg && <InfoCallout t="positive" compact title={msg} />}
      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}

      {/* ── Individual ── */}
      {tab === 'individual' && (
        <>
          <SectionCard icon={<IconPlus size={15} />} title="Add an entry"
            style={{ overflow: 'visible' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: SP.md }}>
              <Fld label="Employee"><SearchSelect value={empCode} options={empOpts} placeholder={empOpts.length ? 'Search emp code / name' : 'No employees in this month'} onChange={setEmpCode} /></Fld>
              <Fld label="Voucher head"><SearchSelect value={headName} options={headOpts} placeholder="Select head" onChange={setHeadName} /></Fld>
              <Fld label="Amount">
                <span style={{ position: 'relative', display: 'block' }}>
                  <span aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: TK.muted, fontSize: F.small, fontWeight: W.semi, pointerEvents: 'none' }}>₹</span>
                  <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...ddInp, paddingLeft: 26, ...numeric }} />
                </span>
              </Fld>
              <Fld label="Remark"><input value={remark} onChange={e => setRemark(e.target.value)} placeholder="e.g. Diwali bonus" style={ddInp} /></Fld>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginTop: SP.md, paddingTop: SP.md, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
              <PButton variant="primary" icon={<IconCheck size={15} />} onClick={saveOne} disabled={busy}>
                {busy ? 'Saving…' : 'Save entry'}
              </PButton>
              {headType && <StatusPill t={headType === 'Addition' ? 'positive' : 'critical'} dot>{headType}</StatusPill>}
              <span style={{ fontSize: F.tiny, color: TK.muted }}>Saving the same head again for this employee replaces the existing amount.</span>
            </div>
          </SectionCard>

          <SectionCard icon={<IconReceipt size={15} />} title="Entries this month" flush>
            {fileHead(fileNames([...entries].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))))}
            {entries.length === 0
              ? <EmptyState compact t="neutral" icon={<IconReceipt size={20} />} title="Nothing added for this month yet." />
              : !viewList ? (
                <div style={{ padding: `${SP.lg}px`, display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap' }}>
                  <PButton variant="secondary" icon={<IconEye size={15} />} onClick={() => setViewList(true)}>
                    View list ({entries.length})
                  </PButton>
                </div>
              ) : (
                <DataTable minWidth={720}>
                  <thead><tr>{[...(isGroup ? ['Company'] : []), 'Emp Code', 'Head', 'Type', 'Amount', 'Remark', 'Via', ''].map(h => <th key={h} style={h === 'Amount' ? dt.thNum : th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id} className={dt.rowClass}>
                        {isGroup && <td style={{ ...td, color: TK.muted }}>{coByRun[e.run_id] || '-'}</td>}
                        <td style={dt.tdMono}>{e.employee_code}</td>
                        <td style={{ ...td, color: TK.ink }}>{e.head_name}</td>
                        <td style={td}><StatusPill size="sm" t={e.head_type === 'Addition' ? 'positive' : 'critical'}>{e.head_type}</StatusPill></td>
                        <td style={{ ...dt.tdNum, fontWeight: W.bold }}>{inr(e.amount)}</td>
                        <td style={{ ...td, color: TK.muted }}>{e.remark || '-'}</td>
                        <td style={{ ...td, color: TK.muted, fontSize: F.micro }}>{e.uploaded_via}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <PButton size="sm" variant="danger" onClick={() => setConfirmDel(e)}>Delete</PButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
          </SectionCard>
        </>
      )}

      {confirmDel && (
        <ConfirmDelete entry={confirmDel} company={coByRun[confirmDel.run_id] || ''} busy={delBusy}
          onCancel={() => setConfirmDel(null)} onConfirm={() => removeEntry(confirmDel)} />
      )}

      {/* ── Bulk ── */}
      {tab === 'bulk' && (
        <>
          <SectionCard>
            <ProcessStepper compact steps={bulkSteps} />
          </SectionCard>

          <SectionCard icon={<span style={{ fontSize: F.small, fontWeight: W.bold, ...numeric }}>1</span>} title="Pick the heads to process"
            hint="The template will have one column per head, pre-filled with anything already saved."
            actions={<CountChip t={picked.length ? 'brand' : 'neutral'}>{picked.length} selected</CountChip>}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: SP.md }}>
              {heads.map(h => {
                const on = picked.includes(h.head_name)
                return (
                  <HeadChip key={h.id} name={h.head_name} type={h.head_type} on={on} title={h.note || h.head_type}
                    onClick={() => setPicked(p => on ? p.filter(x => x !== h.head_name) : [...p, h.head_name])} />
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: SP.sm + 2, alignItems: 'center', flexWrap: 'wrap', paddingTop: SP.md, borderTop: `1px solid ${TK.line}` }}>
              <PButton variant="primary" icon={<IconDownload size={15} />} onClick={downloadTemplate} disabled={!picked.length || !runIds.length}>
                Download template
              </PButton>
              <span style={{ fontSize: F.tiny, color: TK.muted, ...numeric }}>{picked.length} head{picked.length === 1 ? '' : 's'} selected</span>
              {picked.length > 0 && <button onClick={() => setPicked([])} className="ez-press" style={{ border: 'none', background: 'none', padding: 0, fontFamily: 'inherit', fontSize: F.tiny, color: TK.critical, cursor: 'pointer', fontWeight: W.semi }}>Clear</button>}
            </div>
          </SectionCard>

          <SectionCard icon={<span style={{ fontSize: F.small, fontWeight: W.bold, ...numeric }}>2</span>} title="Upload the filled file"
            hint="A blank cell is left alone. Each row saves on its own, so one bad value doesn't stop the rest.">
            <FileDrop accept=".xlsx,.xls" onChange={handleBulkFile} fileName={bulkFile} label="Choose the filled voucher template" />
            {bulkRows && (
              <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginTop: SP.md, paddingTop: SP.md, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
                <PButton variant="primary" size="lg" icon={<IconCheck size={15} />} onClick={processBulk} disabled={bulkBusy}>
                  {bulkBusy ? 'Saving…' : `Save ${bulkRows.length} rows`}
                </PButton>
                <span style={{ fontSize: F.tiny, color: TK.inkSoft }}><b style={{ color: TK.ink }}>{bulkFile}</b> · {bulkRows.length} employees</span>
              </div>
            )}
          </SectionCard>

          {bulkResults && (
            <SectionCard title="Result" flush
              actions={<>
                <StatusPill t="positive" icon={<IconCheck size={12} />}>{okCount} saved</StatusPill>
                {badCount > 0 && <StatusPill t="critical" icon={<IconClose size={12} />}>{badCount} failed</StatusPill>}
              </>}>
              <div className="ez-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {bulkResults.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: SP.sm, fontSize: F.tiny, padding: `7px ${SP.lg}px`, color: r.ok ? TK.ink : TK.critical, borderBottom: `1px solid ${TK.line}`, ...numeric }}>
                    <span style={{ display: 'inline-flex', color: r.ok ? TK.positive : TK.critical }}>{r.ok ? <IconCheck size={13} /> : <IconClose size={13} />}</span>
                    <span><b>{r.code}</b> · {r.head}: {r.detail}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── Tracking ── */}
      {tab === 'tracking' && (
        <SectionCard icon={<IconClock size={15} />} title="Voucher activity" hint="Every create, replace and delete, most recent first." flush>
          {fileHead(fileNames(audit))}
          {audit.length === 0
            ? <EmptyState compact t="neutral" icon={<IconClock size={20} />} title="No voucher activity for this month yet." />
            : (
              <DataTable minWidth={780}>
                <thead><tr>{['When', 'Emp Code', 'Head', 'Action', 'Old', 'New', 'Via'].map(h => <th key={h} style={h === 'Old' || h === 'New' ? dt.thNum : th}>{h}</th>)}</tr></thead>
                <tbody>
                  {audit.map(a => {
                    const t = ACTION_TONE[a.action] || 'neutral'
                    return (
                      <tr key={a.id} className={dt.rowClass}>
                        <td style={{ ...td, color: TK.muted, fontSize: F.tiny, ...numeric }}>{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={dt.tdMono}>{a.employee_code}</td>
                        <td style={{ ...td, color: TK.ink }}>{a.head_name}</td>
                        <td style={td}><StatusPill size="sm" t={t}>{a.action}</StatusPill></td>
                        <td style={{ ...dt.tdNum, color: TK.muted }}>{a.old_amount == null ? '-' : inr(a.old_amount)}</td>
                        <td style={{ ...dt.tdNum, fontWeight: W.bold }}>{a.new_amount == null ? '-' : inr(a.new_amount)}</td>
                        <td style={{ ...td, color: TK.muted, fontSize: F.micro }}>{a.uploaded_via || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </DataTable>
            )}
        </SectionCard>
      )}
    </div>
  )
}
