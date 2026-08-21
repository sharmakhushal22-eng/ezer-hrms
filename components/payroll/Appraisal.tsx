'use client'
// components/payroll/Appraisal.tsx — Payroll → Employees & CTC → Salary Revision & Arrears.
//
// Two dates, kept apart on purpose: the date the raise takes effect, and the month it is
// paid in. When they differ, the months in between have already gone out at the old rate,
// and the difference for each of them is owed head by head. This screen makes that gap
// visible before Save rather than after — the banner lists exactly which months become
// arrear, so nobody discovers it when the payslip is questioned.
import { useState, useCallback } from 'react'
import {
  appraisalBreakup, findEmployeeForAppraisal, saveAppraisal, loadAppraisals, backMonths,
  type AppraisalBreakup, type EmployeeForAppraisal, type AppraisalRecord,
} from '@/lib/payroll/appraisal'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.violet, purpleD: TK.violetDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint, greenBd: '#A7F3D0',
  amber: TK.warning, amberBg: TK.warningTint, amberBd: '#FDE68A',
  red: TK.critical, redBg: TK.criticalTint, purpleBg: TK.violetTint, gray: TK.sunken,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 11px', border: `1px solid #DDD6FE`, borderRadius: 7,
  fontSize: 12.5, boxSizing: 'border-box', fontFamily: font, outline: 'none',
  background: TK.sunken, color: C.navy,
}
const lbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase',
  letterSpacing: '.04em', display: 'block', marginBottom: 4,
}
const card: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
  padding: '16px 18px', marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.07)',
}

// ── Live breakup table ─────────────────────────────────────────────────────
// Outside the parent so typing a hike percent does not re-mount it on every keystroke.
function BreakupTable({ prev, next }: { prev: AppraisalBreakup | null; next: AppraisalBreakup | null }) {
  if (!next) return null
  // Ordered the way the appraisal letter's Annexure A reads, so the screen and the letter
  // can be compared line by line. Employer PF/ESIC sit below the gross because they are
  // inside the CTC but are not part of what the employee is paid.
  const rows: [string, number | undefined, number][] = [
    ['Basic', prev?.basic_monthly, next.basic_monthly],
    ['HRA', prev?.hra_monthly, next.hra_monthly],
    ['Special Allowance', prev?.special_allowance_monthly, next.special_allowance_monthly],
    ['Statutory Bonus', prev?.statutory_bonus_monthly, next.statutory_bonus_monthly],
    ['Flexi', prev?.flexi_monthly, next.flexi_monthly],
    ['Gross pay', prev?.gross_monthly, next.gross_monthly],
    ['Employer PF', prev?.employer_pf_monthly, next.employer_pf_monthly],
    ['Employer ESIC', prev?.employer_esic_monthly, next.employer_esic_monthly],
    ['Fixed CTC / month', prev?.fixed_monthly, next.fixed_monthly],
  ]
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: `1px solid ${C.border}`, textAlign: 'right' }
  return (
    <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.gray }}>
            <th style={{ ...td, textAlign: 'left', fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Component</th>
            <th style={{ ...td, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Current</th>
            <th style={{ ...td, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Revised</th>
            <th style={{ ...td, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, p, n]) => {
            const d = n - (p ?? 0)
            return (
              <tr key={label}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: C.navy }}>{label}</td>
                <td style={{ ...td, color: C.muted }}>{p == null ? '—' : inr(p)}</td>
                <td style={{ ...td, fontWeight: 700, color: C.navy }}>{inr(n)}</td>
                <td style={{ ...td, fontWeight: 700, color: d > 0 ? C.green : d < 0 ? C.red : C.muted }}>
                  {p == null ? '—' : (d > 0 ? '+' : '') + inr(d)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {next.special_allowance_monthly < 0 && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, padding: '9px 12px' }}>
          Special Allowance is negative — Basic, HRA and Flexi together already exceed the fixed
          monthly. Raise the CTC or reduce the flexi declaration before saving.
        </div>
      )}
    </div>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function Appraisal() {
  const [tab, setTab] = useState<'employee' | 'bulk' | 'report'>('employee')

  const [code, setCode] = useState('')
  const [emp, setEmp] = useState<EmployeeForAppraisal | null>(null)
  const [lookupErr, setLookupErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [hike, setHike] = useState('')
  const [newCtc, setNewCtc] = useState('')
  const [newVar, setNewVar] = useState('')
  const [desig, setDesig] = useState('')
  const [effFrom, setEffFrom] = useState('')
  const [payOut, setPayOut] = useState('')
  const [prevBk, setPrevBk] = useState<AppraisalBreakup | null>(null)
  const [nextBk, setNextBk] = useState<AppraisalBreakup | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [report, setReport] = useState<AppraisalRecord[]>([])
  const [repBusy, setRepBusy] = useState(false)

  async function lookup() {
    if (!code.trim()) return
    setBusy(true); setLookupErr(''); setEmp(null); setPrevBk(null); setNextBk(null); setMsg('')
    try {
      const e = await findEmployeeForAppraisal(code)
      if (!e) { setLookupErr(`No employee with code ${code.trim()}`); return }
      setEmp(e); setDesig(e.designation || ''); setNewVar(String(e.annual_variable || 0))
      setPrevBk(await appraisalBreakup(e.annual_ctc, 0, undefined, e.statutory_bonus))
    } catch (e: any) { setLookupErr(e?.message || String(e)) } finally { setBusy(false) }
  }

  // Hike and New CTC drive each other — HR types whichever they were given, and the
  // other follows, so the two can never be saved disagreeing.
  const recalc = useCallback(async (ctc: number) => {
    if (!emp || !(ctc > 0)) { setNextBk(null); return }
    try { setNextBk(await appraisalBreakup(ctc, 0, effFrom || undefined, emp.statutory_bonus)) } catch { /* ignore */ }
  }, [emp, effFrom])

  async function onHike(v: string) {
    setHike(v); setMsg('')
    if (!emp) return
    const pct = Number(v)
    if (!v.trim() || Number.isNaN(pct)) { setNewCtc(''); setNextBk(null); return }
    const ctc = Math.round(emp.annual_ctc * (1 + pct / 100))
    setNewCtc(String(ctc)); await recalc(ctc)
  }
  async function onCtc(v: string) {
    setNewCtc(v); setMsg('')
    if (!emp) return
    const ctc = Number(v)
    if (!v.trim() || Number.isNaN(ctc)) { setHike(''); setNextBk(null); return }
    setHike(emp.annual_ctc > 0 ? (((ctc - emp.annual_ctc) / emp.annual_ctc) * 100).toFixed(2) : '')
    await recalc(ctc)
  }

  const months = effFrom && payOut ? backMonths(effFrom, payOut) : []
  const canSave = !!emp && Number(newCtc) > 0 && !!effFrom && !!payOut && !busy
    && (nextBk?.special_allowance_monthly ?? 0) >= 0

  async function save() {
    if (!emp || !canSave) return
    setBusy(true); setErr(''); setMsg('')
    const { error, record } = await saveAppraisal({
      employeeId: emp.id, employeeCode: emp.emp_code, companyId: emp.company_id,
      previousCtc: emp.annual_ctc, hikePercent: hike ? Number(hike) : null,
      newCtc: Number(newCtc), newVariable: Number(newVar) || 0,
      newDesignation: desig && desig !== emp.designation ? desig : null,
      additionalLines: [], effectiveFrom: effFrom, payOutMonth: payOut,
    })
    setBusy(false)
    if (error) { setErr(error); return }
    setMsg(
      `Saved for ${emp.emp_code}.`
      + (months.length ? ` ${months.length} month${months.length === 1 ? '' : 's'} of arrear (${months.join(', ')}) will be worked out when ${payOut.slice(0, 7)}'s payroll runs.` : '')
      + (record?.requires_data_sync ? ' That month’s payroll is already calculated, so the designation was left unchanged — pull it in through Data Sync.' : ''))
  }

  async function loadReport() {
    setRepBusy(true); setErr('')
    try { setReport(await loadAppraisals()) }
    catch (e: any) {
      // Only a genuinely absent function means "migration not applied". `does not exist`
      // on its own also covers a bad column inside a function that IS there, and blaming
      // sql111 for that sends HR to re-run a file they have already run.
      setErr(/could not find the function|schema cache/i.test(e?.message || '')
        ? `Appraisal needs a migration that has not been applied to this database yet. (${e?.message || ''})`
        : (e?.message || String(e)))
    } finally { setRepBusy(false) }
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button key={id} onClick={() => { setTab(id); if (id === 'report' && !report.length) loadReport() }}
      style={{
        padding: '9px 16px', borderRadius: 9, fontFamily: font, fontSize: 12.5, fontWeight: 700,
        cursor: 'pointer', border: `1px solid ${tab === id ? C.purple : C.border}`,
        background: tab === id ? C.purple : '#fff', color: tab === id ? '#fff' : C.navy,
      }}>{label}</button>
  )

  return (
    <div style={{ fontFamily: font, fontSize: 13, color: C.navy, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>Appraisal &amp; Arrear</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>
            Revise CTC with an effective date — back months become head-wise arrear in the pay-out month
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {tabBtn('employee', 'Employee Wise')}
        {tabBtn('bulk', 'Bulk Upload')}
        {tabBtn('report', 'Report')}
      </div>

      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 12px', marginBottom: 12 }}>{err}</div>}

      {tab === 'employee' && (
        <>
          <div style={card}>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Employee</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>Employee code</label>
                <input style={inp} value={code} placeholder="e.g. SRS9004"
                  onChange={e => setCode(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') lookup() }} />
              </div>
              <button onClick={lookup} disabled={busy || !code.trim()}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', fontFamily: font, fontSize: 12.5, fontWeight: 700, color: '#fff', background: !code.trim() ? '#D8D3F5' : C.purple, cursor: !code.trim() ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Loading…' : 'Load'}
              </button>
            </div>
            {lookupErr && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>{lookupErr}</div>}
            {emp && (
              <div style={{ marginTop: 12, background: C.gray, borderRadius: 9, padding: '11px 13px', display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                <span><b>{emp.full_name}</b> · {emp.emp_code}</span>
                <span style={{ color: C.muted }}>{emp.company_name}</span>
                <span style={{ color: C.muted }}>{emp.designation || '—'}</span>
                <span style={{ marginLeft: 'auto' }}>Current CTC <b>{inr(emp.annual_ctc)}</b>/yr</span>
              </div>
            )}
          </div>

          {emp && (
            <div style={card}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Revision</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                <div><label style={lbl}>Hike %</label>
                  <input style={inp} type="number" value={hike} onChange={e => onHike(e.target.value)} placeholder="e.g. 12" /></div>
                <div><label style={lbl}>New CTC / year</label>
                  <input style={inp} type="number" value={newCtc} onChange={e => onCtc(e.target.value)} placeholder="e.g. 900000" /></div>
                <div><label style={lbl}>Variable / year</label>
                  <input style={inp} type="number" value={newVar} onChange={e => setNewVar(e.target.value)} /></div>
                <div><label style={lbl}>Designation</label>
                  <input style={inp} value={desig} onChange={e => setDesig(e.target.value)} /></div>
                <div><label style={lbl}>With effect from</label>
                  <input style={inp} type="date" value={effFrom} onChange={e => { setEffFrom(e.target.value); recalc(Number(newCtc)) }} /></div>
                <div><label style={lbl}>Pay out month</label>
                  <input style={inp} type="date" value={payOut} onChange={e => setPayOut(e.target.value)} /></div>
              </div>

              <BreakupTable prev={prevBk} next={nextBk} />

              {/* The whole point of the screen — say which months become arrear BEFORE Save,
                  not after somebody questions the payslip. */}
              {months.length > 0 && (
                <div style={{ marginTop: 12, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 9, padding: '11px 13px', fontSize: 11.5, color: TK.warning, lineHeight: 1.6 }}>
                  <b>{months.length} back month{months.length === 1 ? '' : 's'} → arrear:</b> {months.join(', ')}.
                  <br />All of those months were already paid at the old rate. The difference is
                  worked out head-wise (Basic / HRA / Special) and lands in the arrear columns of
                  the <b>{payOut.slice(0, 7)}</b> salary. The pay-out month itself is not in that
                  list — it gets the new rate as regular salary.
                </div>
              )}
              {effFrom && payOut && months.length === 0 && (
                <div style={{ marginTop: 12, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '11px 13px', fontSize: 11.5, color: '#047857' }}>
                  No back months — the raise takes effect in the pay-out month itself, so there is no arrear.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                <button onClick={save} disabled={!canSave}
                  style={{ padding: '11px 24px', borderRadius: 9, border: 'none', fontFamily: font, fontSize: 13, fontWeight: 700, color: '#fff', background: canSave ? 'linear-gradient(120deg,#7C3AED,#5B21B6)' : '#D8D3F5', cursor: canSave ? 'pointer' : 'not-allowed', boxShadow: canSave ? '0 3px 10px rgba(124,58,237,0.22)' : 'none' }}>
                  {busy ? 'Saving…' : 'Save appraisal'}
                </button>
                {!canSave && emp && <span style={{ fontSize: 11, color: C.muted }}>New CTC, effective date and pay-out month are all needed.</span>}
              </div>
              {msg && <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 13px', lineHeight: 1.6 }}>✓ {msg}</div>}
            </div>
          )}
        </>
      )}

      {tab === 'bulk' && (
        <div style={{ ...card, textAlign: 'center', padding: '38px 24px' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}></div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Bulk Upload</div>
          <div style={{ fontSize: 12, color: C.muted, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            Not built yet. One appraisal at a time goes through Employee Wise, which validates the
            breakup and shows the back months before saving — a bulk sheet has to reproduce both of
            those checks per row, and doing it without them would push arrear into payroll unseen.
          </div>
        </div>
      )}

      {tab === 'report' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Saved appraisals</div>
            <button onClick={loadReport} disabled={repBusy}
              style={{ marginLeft: 'auto', padding: '6px 13px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: font }}>
              {repBusy ? 'Loading…' : '⟳ Refresh'}
            </button>
          </div>
          {report.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted, padding: '20px 0', textAlign: 'center' }}>
              {repBusy ? 'Loading…' : 'No appraisals saved yet.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.gray }}>
                    {['Employee', 'Previous CTC', 'New CTC', 'Hike', 'Effective', 'Pay out', 'Back months', 'Status'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 10, color: C.muted, textTransform: 'uppercase', textAlign: h === 'Employee' ? 'left' : 'right', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.map(r => {
                    const bm = backMonths(r.effective_from, r.pay_out_month)
                    const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', borderBottom: `1px solid ${C.border}` }
                    return (
                      <tr key={r.id}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.employee_code}</td>
                        <td style={{ ...td, color: C.muted }}>{inr(r.previous_ctc)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{inr(r.new_ctc)}</td>
                        <td style={{ ...td, color: C.green, fontWeight: 700 }}>{r.hike_percent != null ? `${r.hike_percent}%` : '—'}</td>
                        <td style={td}>{r.effective_from}</td>
                        <td style={td}>{r.pay_out_month}</td>
                        <td style={{ ...td, color: bm.length ? C.amber : C.muted, fontWeight: bm.length ? 700 : 400 }}>
                          {bm.length ? bm.join(', ') : '—'}
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: r.status === 'ARREAR_PROCESSED' ? C.greenBg : C.purpleBg, color: r.status === 'ARREAR_PROCESSED' ? C.green : C.purpleD }}>
                            {r.status}
                          </span>
                          {r.requires_data_sync && <div style={{ fontSize: 9.5, color: C.amber, marginTop: 2 }}>needs Data Sync</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: C.purpleD, background: C.purpleBg, borderRadius: 9, padding: '11px 13px', lineHeight: 1.6 }}>
        <b>The effective date and the pay-out month can differ.</b> The months in between were
        already paid at the old rate, so their difference becomes <b>head-wise arrear</b> and is
        added to the pay-out month&apos;s salary — Basic, HRA and Special each in their own arrear column.
        <br />Every back month&apos;s difference is worked out from <b>that month&apos;s actual frozen figures</b>,
        not an estimate, and is pro-rated by <b>that month&apos;s paid days</b>.
      </div>
    </div>
  )
}
