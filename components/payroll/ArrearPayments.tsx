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
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint, greenBd: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint, red: TK.critical, redBg: TK.criticalTint,
  purpleBg: TK.brandTint, gray: TK.sunken,
}
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

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' } as React.CSSProperties,
  th: { padding: '8px 11px', fontSize: 10, color: TK.brand, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.05em', textAlign: 'left' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '8px 11px', color: C.navy, borderTop: `1px solid ${C.border}`, whiteSpace: 'nowrap' as const },
  inp: { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: TK.surface, color: C.navy, fontFamily: font, outline: 'none' } as React.CSSProperties,
  btnP: { padding: '9px 17px', borderRadius: 8, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
  btnO: { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
}

function Stat({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
    </div>
  )
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
      if (!rows.length) { setErr('No payable employee found — run Calculate for the month first.'); return }
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
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 940 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)', flexShrink: 0 }}></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Arrear &amp; Payments</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            What is owed from earlier periods and being paid this month, and what leaves the bank this month.
          </div>
        </div>
      </div>

      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Payroll month</label>
          <select style={{ ...S.inp, minWidth: 220 }} value={monthVal} onChange={e => { setMonthVal(e.target.value); setMsg(''); setErr('') }}>
            {monthOpts.length === 0 && <option value="">No month created</option>}
            {monthOpts.map(r => <option key={r.month} value={String(r.month)}>{periodLabel(r)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['arrear', 'payments'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${tab === k ? C.purple : C.border}`, background: tab === k ? C.purple: TK.surface, color: tab === k ? TK.surface : C.navy, fontWeight: tab === k ? 700 : 500, fontSize: 13, cursor: 'pointer', fontFamily: font }}>
              {k === 'arrear' ? 'Arrear' : 'Payments'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: C.muted, paddingBottom: 8 }}>
          {sel && <>Status: <b style={{ color: C.purple }}>{isGroup && monthRuns.length > 1 ? `${monthRuns.length} companies` : sel.status}</b></>}
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>{err}</div>}
      {loading && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Loading…</div>}

      {/* ── ARREAR ── */}
      {tab === 'arrear' && !loading && (
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Employees" value={arrears.length} color={C.navy} />
            <Stat label="Arrear paid" value={inr(totalArrearAdd)} color={C.green} />
            <Stat label="Arrear recovered" value={inr(totalArrearDed)} color={C.amber} />
            <Stat label="Net arrear" value={inr(totalArrearAdd - totalArrearDed)} color={C.purple} />
            <div style={{ flex: 1 }} />
            <button onClick={downloadArrear} disabled={!arrears.length} style={{ ...S.btnP, alignSelf: 'center', opacity: arrears.length ? 1 : 0.5, cursor: arrears.length ? 'pointer' : 'not-allowed' }}>Download</button>
          </div>

          {arrears.length === 0 ? (
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, background: C.gray, borderRadius: 9, padding: '12px 14px' }}>
              There is no arrear in this month. Arrear arrives from two places — <b>Attendance → Arrear Days</b> (days from an earlier month), and the <b>Arrear Addition / Arrear Deduction</b> heads in the <b>Bulk Uploader</b> (money). Both are shown together here.
            </div>
          ) : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: C.purpleD }}>
                  {isGroup && <th style={S.th}>Company</th>}
                  <th style={S.th}>Emp Code</th><th style={S.th}>Name</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Arrear Days</th>
                  <th style={S.th}>Source Period</th><th style={S.th}>Reason</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Addition</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Deduction</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Net</th>
                </tr></thead>
                <tbody>
                  {arrears.map((r, i) => (
                    <tr key={r.employee_code + i} style={{ background: i % 2 ? '#fff' : C.gray }}>
                      {isGroup && <td style={{ ...S.td, color: C.muted }}>{r.company}</td>}
                      <td style={{ ...S.td, fontWeight: 700 }}>{r.employee_code}</td>
                      <td style={S.td}>{r.full_name || '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{r.arrear_days || '—'}</td>
                      <td style={{ ...S.td, color: C.muted }}>{r.source_period || '—'}</td>
                      <td style={{ ...S.td, color: C.muted, whiteSpace: 'normal', maxWidth: 220 }}>{r.reason || '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: C.green }}>{r.voucherAdd ? inr(r.voucherAdd) : '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: C.red }}>{r.voucherDed ? inr(r.voucherDed) : '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{inr(r.voucherAdd - r.voucherDed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 11, color: C.muted, marginTop: 10, background: C.gray, borderRadius: 8, padding: '9px 11px', lineHeight: 1.55 }}>
            Arrear <b>days</b> and arrear <b>amounts</b> arrive by different routes. They are shown together because looking at only one is how the same arrear gets paid <b>twice</b> — once through days, once through a voucher.
          </div>
        </div>
      )}

      {/* ── PAYMENTS ── */}
      {tab === 'payments' && !loading && (
        <div style={S.card}>
          {!calculated ? (
            <div style={{ fontSize: 13, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 9, padding: '12px 14px', lineHeight: 1.6 }}>
              <b>{label} has not been calculated yet.</b> A payment only exists once net pay has been worked out — run <b>Run Cycle → ⚙️ Calculate</b> first.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
                <Stat label="Payable" value={pays.filter(p => p.net_pay > 0).length} color={C.navy} />
                <Stat label="Total net" value={inr(totalNet)} color={C.green} />
                {unbankable.length > 0 && <Stat label="No bank detail" value={unbankable.length} color={C.red} />}
                <div style={{ flex: 1 }} />
                <button onClick={downloadNeft} disabled={busy === 'neft' || !pays.length} style={{ ...S.btnP, alignSelf: 'center', opacity: pays.length ? 1 : 0.5 }}>
                  {busy === 'neft' ? 'Building…' : 'NEFT file'}
                </button>
                <button onClick={markDisbursed} disabled={busy === 'disburse' || !pays.length}
                  style={{ ...S.btnO, alignSelf: 'center', borderColor: C.green, color: C.green, fontWeight: 700 }}>
                  {busy === 'disburse' ? 'Marking…' : 'Mark disbursed'}
                </button>
              </div>

              {unbankable.length > 0 && (
                <div style={{ fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 9, padding: '11px 13px', marginBottom: 12, lineHeight: 1.6 }}>
                  <b>{unbankable.length} employees cannot be paid</b> — their salary is ready but their bank details are incomplete. They will not appear in the NEFT file:
                  <div style={{ marginTop: 6 }}>
                    {unbankable.slice(0, 8).map(u => (
                      <div key={u.employee_code} style={{ fontSize: 12 }}>· <b>{u.employee_code}</b> {u.full_name} — {u.missing} missing ({inr(u.net_pay)})</div>
                    ))}
                    {unbankable.length > 8 && <div style={{ fontSize: 12, marginTop: 3 }}>…and {unbankable.length - 8} more</div>}
                  </div>
                  <div style={{ marginTop: 6 }}>Fix them under Employees &amp; CTC → <b>Bank Details</b>, then run <b>Data Sync → Bank</b>.</div>
                </div>
              )}

              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: 420 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: C.purpleD }}>
                    <th style={S.th}>Emp Code</th><th style={S.th}>Name</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Net Pay</th>
                  </tr></thead>
                  <tbody>
                    {pays.map((p, i) => (
                      <tr key={p.employee_code + i} style={{ background: i % 2 ? '#fff' : C.gray }}>
                        <td style={{ ...S.td, fontWeight: 700 }}>{p.employee_code}</td>
                        <td style={S.td}>{p.full_name}</td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: p.net_pay > 0 ? C.navy : C.red }}>{inr(p.net_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 10, background: C.gray, borderRadius: 8, padding: '9px 11px', lineHeight: 1.55 }}>
                The NEFT file carries the <b>full account number</b> (not masked — a masked file is rejected by the bank), and Excel keeps it as text so leading zeros survive. After <b>Mark disbursed</b>, changing the month needs a formal reopen.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
