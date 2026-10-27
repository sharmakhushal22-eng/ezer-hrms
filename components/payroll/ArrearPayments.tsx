'use client'
// components/payroll/ArrearPayments.tsx — Payroll Run → Arrear & Payments.
//
// Two halves of the tail end of a payroll month:
//
//   ARREAR   — money owed for an EARLIER period that is being paid in THIS month.
//              It arrives two ways and both are shown together, because seeing only one
//              of them is how an arrear gets paid twice:
//                • arrear DAYS on the Month Master (Attendance → Arrear Days)
//                • arrear AMOUNTS as manual vouchers (Arrear Addition / Arrear Deduction)
//
//   PAYMENTS — what actually leaves the bank. Net pay comes from payroll_lines, so this
//              only has anything to show once the month has been Calculated.
//              Employees with no account number are listed BEFORE the file is generated,
//              not after the bank rejects the batch.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { loadRuns, buildNeftRows, loadUnbankable, setRunStatus, MONTHS, type PayrollRun } from '@/lib/payroll/core'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, S as SP, numeric, IconReceipt, IconDownload, IconCheck, IconBuilding } from '@/lib/ui'
import {
  SectionCard, InfoCallout, PButton, ControlSelect, SegmentedTabs, KpiTile, KpiGrid, DataTable, EmptyState,
  StatusPill, RunStatusPill, CountChip, IconMonth, IconBank, IconSync, dt,
} from '@/components/payroll/kit'
import { ScreenIntro, Note } from './attendanceShared'

const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const periodLabel = (r: { period_label?: string | null; month?: number; fy?: string }) =>
  r.period_label || `${MONTHS[((r.month || 1) - 1)]} ${String(r.fy || '').split('-')[0]}`
const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

interface ArrearRow {
  employee_code: string; full_name: string; company: string
  arrear_days: number; source_period: string; reason: string
  voucherAdd: number; voucherDed: number
}
interface PayRow { employee_code: string; full_name: string; net_pay: number }

// Table cell styles from the kit, with this screen's one tweak: names may wrap.
const ST = {
  th: dt.th, thNum: dt.thNum,
  td: { ...dt.td, whiteSpace: 'nowrap' } as React.CSSProperties,
  tdNum: dt.tdNum,
}

export default function ArrearPayments({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')
  const [tab, setTab] = useState<'arrear' | 'payments'>('arrear')
  const [arrears, setArrears] = useState<ArrearRow[]>([])
  const [pays, setPays] = useState<PayRow[]>([])
  const [unbankable, setUnbankable] = useState<{ employee_code: string; full_name: string; net_pay: number; missing: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    loadRuns(companyId, fy).then(list => {
      setRuns(list)
      setMonthVal(p => (list.some(r => String(r.month) === p) ? p : String(list[0]?.month ?? '')))
    }).catch(e => setErr(e.message))
  }, [companyId, fy])

  // In Group mode a month spans several runs — one per company.
  const monthRuns = runs.filter(r => String(r.month) === monthVal)
  const runIds = monthRuns.map(r => r.id)
  const sel = monthRuns[0] || null
  const isGroup = !companyId
  const label = sel ? periodLabel(sel) : ''
  const calculated = monthRuns.some(r => ['CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'].includes(r.status))

  const load = useCallback(async () => {
    if (!runIds.length) { setArrears([]); setPays([]); setUnbankable([]); return }
    setLoading(true); setErr('')
    try {
      const coByRun: Record<string, string> = {}
      monthRuns.forEach(r => { coByRun[r.id] = r.company_name || '' })

      // Arrear days from the Month Master + arrear amounts from the voucher heads.
      const arr: ArrearRow[] = []
      const byCode = new Map<string, ArrearRow>()
      for (const id of runIds) {
        const { data } = await supabase.from('payroll_employee_snapshot')
          .select('employee_code, full_name, arrear_days, arrear_source_period, arrear_reason')
          .eq('run_id', id).order('employee_code')
        ;(data || []).forEach((r: any) => {
          if (!num(r.arrear_days)) return
          const row: ArrearRow = {
            employee_code: r.employee_code, full_name: r.full_name || '', company: coByRun[id] || '',
            arrear_days: num(r.arrear_days), source_period: r.arrear_source_period || '', reason: r.arrear_reason || '',
            voucherAdd: 0, voucherDed: 0,
          }
          arr.push(row); byCode.set(r.employee_code, row)
        })
      }
      const { data: v } = await supabase.from('manual_voucher_entries')
        .select('employee_code, head_name, head_type, amount, run_id').in('run_id', runIds).ilike('head_name', '%arrear%')
      ;(v || []).forEach((e: any) => {
        let row = byCode.get(e.employee_code)
        if (!row) {
          // An arrear paid purely as a voucher, with no arrear days recorded — still arrear.
          row = { employee_code: e.employee_code, full_name: '', company: coByRun[e.run_id] || '', arrear_days: 0, source_period: '', reason: '', voucherAdd: 0, voucherDed: 0 }
          arr.push(row); byCode.set(e.employee_code, row)
        }
        if (String(e.head_type || '').toLowerCase().startsWith('d')) row.voucherDed += num(e.amount)
        else row.voucherAdd += num(e.amount)
      })
      setArrears(arr.sort((a, b) => a.employee_code.localeCompare(b.employee_code)))

      // Payments — only exists once the month has been calculated.
      const p: PayRow[] = []
      const unb: typeof unbankable = []
      for (const id of runIds) {
        const { data: lines } = await supabase.from('payroll_lines').select('employee_id, net_pay').eq('run_id', id)
        if (!lines?.length) continue
        const { data: snap } = await supabase.from('payroll_employee_snapshot')
          .select('employee_id, employee_code, full_name').eq('run_id', id)
        const by = new Map<string, any>((snap || []).map((x: any) => [x.employee_id, x]))
        ;(lines || []).forEach((l: any) => {
          const x = by.get(l.employee_id) || {}
          p.push({ employee_code: x.employee_code || '', full_name: x.full_name || '', net_pay: num(l.net_pay) })
        })
        unb.push(...await loadUnbankable(id))
      }
      setPays(p.sort((a, b) => a.employee_code.localeCompare(b.employee_code)))
      setUnbankable(unb)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [runIds.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  function downloadArrear() {
    if (!arrears.length) { setErr('There is no arrear in this month.'); return }
    const sheet = arrears.map(r => ({
      ...(isGroup ? { Company: r.company } : {}),
      'Emp Code': r.employee_code, 'Name': r.full_name,
      'Arrear Days': r.arrear_days || '', 'Source Period': r.source_period, 'Reason': r.reason,
      'Arrear Addition': r.voucherAdd || '', 'Arrear Deduction': r.voucherDed || '',
      'Net Arrear': r.voucherAdd - r.voucherDed,
    }))
    const header: string[] = []
    sheet.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet, { header }), 'Arrear')
    XLSX.writeFile(wb, `Arrear_${safe(label)}.xlsx`.replace(/_+/g, '_'))
  }

  async function downloadNeft() {
    setErr(''); setMsg(''); setBusy('neft')
    try {
      const rows: Record<string, string>[] = []
      for (const id of runIds) rows.push(...await buildNeftRows(id))
      if (!rows.length) { setErr('No payable employee found. Run Calculate for the month first.'); return }
      const header = Object.keys(rows[0])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), 'NEFT')
      XLSX.writeFile(wb, `NEFT_${safe(label)}.xlsx`.replace(/_+/g, '_'))
      setMsg(`Bank file created for ${rows.length} employees.`)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy('') }
  }

  async function markDisbursed() {
    if (!confirm(`Mark ${label} as DISBURSED?\n\nThis records that the salary has been sent to the bank. After that, syncing or editing the month needs a formal reopen.`)) return
    setBusy('disburse'); setErr(''); setMsg('')
    for (const r of monthRuns) {
      const { error } = await setRunStatus(r, 'DISBURSED')
      if (error) { setErr(error); setBusy(''); return }
    }
    setBusy('')
    setMsg(`${label} marked DISBURSED.`)
    loadRuns(companyId, fy).then(setRuns)
  }

  const totalNet = pays.reduce((a, r) => a + r.net_pay, 0)
  const totalArrearAdd = arrears.reduce((a, r) => a + r.voucherAdd, 0)
  const totalArrearDed = arrears.reduce((a, r) => a + r.voucherDed, 0)
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => (a.month || 0) - (b.month || 0))

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 1000 }}>
      <ScreenIntro icon={<IconReceipt size={20} />} title={<>Arrear &amp; Payments</>}
        subtitle="What is owed from earlier periods and being paid this month, and what leaves the bank this month."
        meta={sel ? <>
          {isGroup && monthRuns.length > 1
            ? <StatusPill t="info" size="sm" icon={<IconBuilding size={12} />}>Status: {monthRuns.length} companies</StatusPill>
            : <RunStatusPill status={sel.status} raw size="sm" />}
          {calculated ? <StatusPill t="positive" size="sm" dot>Net pay calculated</StatusPill> : <StatusPill t="warning" size="sm" dot>Not calculated yet</StatusPill>}
        </> : undefined}
        actions={
          <ControlSelect label="Payroll month" icon={<IconMonth size={15} />} strong minWidth={200}
            value={monthVal} onChange={e => { setMonthVal(e.target.value); setMsg(''); setErr('') }}>
            {monthOpts.length === 0 && <option value="">No month created</option>}
            {monthOpts.map(r => <option key={r.month} value={String(r.month)}>{periodLabel(r)}</option>)}
          </ControlSelect>
        } />

      <SegmentedTabs<'arrear' | 'payments'> value={tab} onChange={setTab} items={[
        { key: 'arrear', label: 'Arrear', icon: <IconReceipt size={14} />, count: loading ? undefined : arrears.length },
        { key: 'payments', label: 'Payments', icon: <IconBank size={14} />, count: loading || !calculated ? undefined : pays.length },
      ]} />

      {msg && <InfoCallout t="positive" compact title={msg} />}
      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}
      {loading && <div style={{ fontSize: F.tiny, color: TK.muted, marginBottom: SP.md, display: 'flex', alignItems: 'center', gap: 6 }}><IconSync size={13} /> Loading…</div>}

      {/* ── ARREAR ── */}
      {tab === 'arrear' && !loading && (
        <>
          <KpiGrid min={170}>
            <KpiTile label="Employees" value={arrears.length} />
            <KpiTile label="Arrear paid" value={inr(totalArrearAdd)} t="positive" />
            <KpiTile label="Arrear recovered" value={inr(totalArrearDed)} t="warning" />
            <KpiTile label="Net arrear" value={inr(totalArrearAdd - totalArrearDed)} emphasis />
          </KpiGrid>

          <SectionCard icon={<IconReceipt size={15} />} title={`Arrear in ${label || 'this month'}`} flush={arrears.length > 0}
            hint="Arrear days from the Month Master and arrear vouchers, side by side."
            actions={<PButton variant="primary" size="sm" icon={<IconDownload size={14} />} onClick={downloadArrear} disabled={!arrears.length}>Download</PButton>}>
            {arrears.length === 0 ? (
              <EmptyState compact t="neutral" icon={<IconReceipt size={20} />} title="There is no arrear in this month."
                hint={<>Arrear arrives from two places: <b>Attendance → Arrear Days</b> (days from an earlier month), and the <b>Arrear Addition / Arrear Deduction</b> heads in the <b>Bulk Uploader</b> (money). Both are shown together here.</>} />
            ) : (
              <DataTable minWidth={isGroup ? 860 : 760}>
                <thead><tr>
                  {isGroup && <th style={ST.th}>Company</th>}
                  <th style={ST.th}>Emp Code</th><th style={ST.th}>Name</th>
                  <th style={ST.thNum}>Arrear Days</th>
                  <th style={ST.th}>Source Period</th><th style={ST.th}>Reason</th>
                  <th style={ST.thNum}>Addition</th>
                  <th style={ST.thNum}>Deduction</th>
                  <th style={ST.thNum}>Net</th>
                </tr></thead>
                <tbody>
                  {arrears.map((r, i) => (
                    <tr key={r.employee_code + i} className={dt.rowClass}>
                      {isGroup && <td style={{ ...ST.td, color: TK.muted }}>{r.company}</td>}
                      <td style={dt.tdMono}>{r.employee_code}</td>
                      <td style={{ ...ST.td, color: TK.ink, fontWeight: W.medium }}>{r.full_name || '-'}</td>
                      <td style={ST.tdNum}>{r.arrear_days || '-'}</td>
                      <td style={{ ...ST.td, color: TK.muted, ...numeric }}>{r.source_period || '-'}</td>
                      <td style={{ ...ST.td, color: TK.muted, whiteSpace: 'normal', maxWidth: 220 }}>{r.reason || '-'}</td>
                      <td style={{ ...ST.tdNum, color: TK.positive }}>{r.voucherAdd ? inr(r.voucherAdd) : '-'}</td>
                      <td style={{ ...ST.tdNum, color: TK.critical }}>{r.voucherDed ? inr(r.voucherDed) : '-'}</td>
                      <td style={{ ...ST.tdNum, fontWeight: W.bold }}>{inr(r.voucherAdd - r.voucherDed)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </SectionCard>
          <Note style={{ marginBottom: SP.lg }}>
            Arrear <b>days</b> and arrear <b>amounts</b> arrive by different routes. They are shown together because looking at only one is how the same arrear gets paid <b>twice</b>: once through days, once through a voucher.
          </Note>
        </>
      )}

      {/* ── PAYMENTS ── */}
      {tab === 'payments' && !loading && (
        <>
          {!calculated ? (
            <InfoCallout t="warning" title={`${label} has not been calculated yet.`}>
              A payment only exists once net pay has been worked out. Run <b>Run Cycle → Calculate</b> first.
            </InfoCallout>
          ) : (
            <>
              <KpiGrid min={170}>
                <KpiTile label="Payable" value={pays.filter(p => p.net_pay > 0).length} />
                <KpiTile label="Total net" value={inr(totalNet)} t="positive" emphasis />
                {unbankable.length > 0 && <KpiTile label="No bank detail" value={unbankable.length} t="critical" />}
              </KpiGrid>

              {unbankable.length > 0 && (
                <InfoCallout t="critical" title={`${unbankable.length} employees cannot be paid`}>
                  Their salary is ready but their bank details are incomplete. They will not appear in the NEFT file:
                  <div style={{ marginTop: 6 }}>
                    {unbankable.slice(0, 8).map(u => (
                      <div key={u.employee_code}>· <b>{u.employee_code}</b> {u.full_name} · {u.missing} missing ({inr(u.net_pay)})</div>
                    ))}
                    {unbankable.length > 8 && <div style={{ marginTop: 3 }}>…and {unbankable.length - 8} more</div>}
                  </div>
                  <div style={{ marginTop: 6 }}>Fix them under Employees &amp; CTC → <b>Bank Details</b>, then run <b>Data Sync → Bank</b>.</div>
                </InfoCallout>
              )}

              <SectionCard icon={<IconBank size={15} />} title={`Net pay · ${label}`} flush
                hint="What leaves the bank for each employee this month."
                actions={<>
                  <CountChip t="brand">{pays.length}</CountChip>
                  <PButton variant="primary" size="sm" icon={<IconBank size={14} />} onClick={downloadNeft} disabled={busy === 'neft' || !pays.length}>
                    {busy === 'neft' ? 'Building…' : 'NEFT file'}
                  </PButton>
                  <PButton size="sm" icon={<IconCheck size={14} />} onClick={markDisbursed} disabled={busy === 'disburse' || !pays.length}
                    style={busy === 'disburse' || !pays.length ? undefined : { color: TK.positive, borderColor: TK.positiveEdge }}>
                    {busy === 'disburse' ? 'Marking…' : 'Mark disbursed'}
                  </PButton>
                </>}>
                <DataTable maxHeight={420} minWidth={420}>
                  <thead><tr>
                    <th style={ST.th}>Emp Code</th><th style={ST.th}>Name</th>
                    <th style={ST.thNum}>Net Pay</th>
                  </tr></thead>
                  <tbody>
                    {pays.map((p, i) => (
                      <tr key={p.employee_code + i} className={dt.rowClass}>
                        <td style={dt.tdMono}>{p.employee_code}</td>
                        <td style={{ ...ST.td, color: TK.ink }}>{p.full_name}</td>
                        <td style={{ ...ST.tdNum, fontWeight: W.bold, color: p.net_pay > 0 ? TK.ink : TK.critical }}>{inr(p.net_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </SectionCard>
              <Note style={{ marginBottom: SP.lg }}>
                The NEFT file carries the <b>full account number</b> (not masked, as a masked file is rejected by the bank), and Excel keeps it as text so leading zeros survive. After <b>Mark disbursed</b>, changing the month needs a formal reopen.
              </Note>
            </>
          )}
        </>
      )}
    </div>
  )
}
