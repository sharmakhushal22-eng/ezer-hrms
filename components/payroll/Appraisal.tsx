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
import { C as TK, F, W, S as SP, R, numeric, IconPerformance, IconUser, IconSearch, IconUpload, IconReports, IconCheck } from '@/lib/ui'
import {
  SectionCard, InfoCallout, PButton, SegmentedTabs, DataTable, EmptyState, StatusPill, ActionBar, KeyValueGrid,
  fieldStyle, IconSync, dt,
} from '@/components/payroll/kit'
import { ScreenIntro } from './attendanceShared'

const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

const inp: React.CSSProperties = { ...fieldStyle, fontFamily: font }
const lbl: React.CSSProperties = { fontSize: F.tiny, fontWeight: W.semi, color: TK.inkSoft, display: 'block', marginBottom: 5 }

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
  // Gross pay and Fixed CTC are the two lines people compare — set them apart.
  const strongRow = (label: string) => label === 'Gross pay' || label === 'Fixed CTC / month'
  return (
    <div style={{ marginTop: SP.lg, border: `1px solid ${TK.line}`, borderRadius: R.md, overflow: 'hidden' }}>
      <DataTable>
        <thead>
          <tr>
            <th style={dt.th}>Component</th>
            <th style={dt.thNum}>Current</th>
            <th style={dt.thNum}>Revised</th>
            <th style={dt.thNum}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, p, n]) => {
            const d = n - (p ?? 0)
            const strong = strongRow(label)
            const bg = strong ? { background: TK.sunken } : null
            return (
              <tr key={label} className={dt.rowClass}>
                <td style={{ ...dt.tdStrong, ...bg, fontWeight: strong ? W.bold : W.semi }}>{label}</td>
                <td style={{ ...dt.tdNum, ...bg, color: TK.muted }}>{p == null ? '-' : inr(p)}</td>
                <td style={{ ...dt.tdNum, ...bg, fontWeight: W.bold }}>{inr(n)}</td>
                <td style={{ ...dt.tdNum, ...bg, fontWeight: W.bold, color: d > 0 ? TK.positive : d < 0 ? TK.critical : TK.muted }}>
                  {p == null ? '-' : (d > 0 ? '+' : '') + inr(d)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
      {next.special_allowance_monthly < 0 && (
        <InfoCallout t="critical" compact style={{ margin: 0, borderRadius: 0, border: 'none', borderTop: `1px solid ${TK.criticalEdge}` }}>
          Special Allowance is negative: Basic, HRA and Flexi together already exceed the fixed
          monthly. Raise the CTC or reduce the flexi declaration before saving.
        </InfoCallout>
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
      + (record?.requires_data_sync ? ' That month’s payroll is already calculated, so the designation was left unchanged. Pull it in through Data Sync.' : ''))
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

  const pickTab = (id: typeof tab) => { setTab(id); if (id === 'report' && !report.length) loadReport() }

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 1040 }}>
      <ScreenIntro icon={<IconPerformance size={20} />} title={<>Appraisal &amp; Arrear</>}
        subtitle="Revise CTC with an effective date. Back months become head-wise arrear in the pay-out month"
        meta={<>
          <StatusPill t="neutral" size="sm" dot>With effect from</StatusPill>
          <span style={{ color: TK.faint, fontSize: F.tiny }}>→</span>
          <StatusPill t="neutral" size="sm" dot>Pay-out month</StatusPill>
          <span style={{ color: TK.faint, fontSize: F.tiny }}>=</span>
          <StatusPill t="warning" size="sm" dot>Head-wise arrear</StatusPill>
        </>} />

      <SegmentedTabs<typeof tab> value={tab} onChange={pickTab} items={[
        { key: 'employee', label: 'Employee Wise', icon: <IconUser size={14} /> },
        { key: 'bulk', label: 'Bulk Upload', icon: <IconUpload size={14} /> },
        { key: 'report', label: 'Report', icon: <IconReports size={14} />, count: report.length || undefined },
      ]} />

      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}

      {tab === 'employee' && (
        <>
          <SectionCard icon={<IconUser size={15} />} title="Employee" hint="Load the employee by code to see the current structure.">
            <div style={{ display: 'flex', gap: SP.sm + 2, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>Employee code</label>
                <span style={{ position: 'relative', display: 'block' }}>
                  <span aria-hidden style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TK.muted, display: 'inline-flex', pointerEvents: 'none' }}><IconSearch size={14} /></span>
                  <input style={{ ...inp, paddingLeft: 32 }} value={code} placeholder="e.g. SRS9004"
                    onChange={e => setCode(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') lookup() }} />
                </span>
              </div>
              <PButton variant="primary" onClick={lookup} disabled={busy || !code.trim()}>
                {busy ? 'Loading…' : 'Load'}
              </PButton>
            </div>
            {lookupErr && <InfoCallout t="critical" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{lookupErr}</InfoCallout>}
            {emp && (
              <div style={{ marginTop: SP.md }}>
                <KeyValueGrid min={170} dense items={[
                  { label: 'Employee', value: <>{emp.full_name} <span style={{ color: TK.muted, fontWeight: W.medium }}>· {emp.emp_code}</span></> },
                  { label: 'Company', value: emp.company_name },
                  { label: 'Designation', value: emp.designation || '-' },
                  { label: 'Current CTC', value: <>{inr(emp.annual_ctc)}<span style={{ color: TK.muted, fontWeight: W.medium }}>/yr</span></>, mono: true, t: 'brand' },
                ]} />
              </div>
            )}
          </SectionCard>

          {emp && (
            <SectionCard icon={<IconPerformance size={15} />} title="Revision" hint="Hike % and New CTC drive each other. Type whichever you were given.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px, 100%),1fr))', gap: SP.md }}>
                <div><label style={lbl}>Hike %</label>
                  <input style={{ ...inp, ...numeric }} type="number" value={hike} onChange={e => onHike(e.target.value)} placeholder="e.g. 12" /></div>
                <div><label style={lbl}>New CTC / year</label>
                  <input style={{ ...inp, ...numeric }} type="number" value={newCtc} onChange={e => onCtc(e.target.value)} placeholder="e.g. 900000" /></div>
                <div><label style={lbl}>Variable / year</label>
                  <input style={{ ...inp, ...numeric }} type="number" value={newVar} onChange={e => setNewVar(e.target.value)} /></div>
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
                <InfoCallout t="warning" title={`${months.length} back month${months.length === 1 ? '' : 's'} → arrear: ${months.join(', ')}.`} style={{ marginTop: SP.md, marginBottom: 0 }}>
                  All of those months were already paid at the old rate. The difference is
                  worked out head-wise (Basic / HRA / Special) and lands in the arrear columns of
                  the <b>{payOut.slice(0, 7)}</b> salary. The pay-out month itself is not in that
                  list: it gets the new rate as regular salary.
                </InfoCallout>
              )}
              {effFrom && payOut && months.length === 0 && (
                <InfoCallout t="positive" compact style={{ marginTop: SP.md, marginBottom: 0 }}>
                  No back months: the raise takes effect in the pay-out month itself, so there is no arrear.
                </InfoCallout>
              )}

              <ActionBar style={{ marginTop: SP.lg, marginBottom: 0, boxShadow: 'none', background: TK.sunken }}
                hint={!canSave && emp ? 'New CTC, effective date and pay-out month are all needed.' : undefined}>
                <PButton variant="primary" size="lg" icon={<IconCheck size={15} />} onClick={save} disabled={!canSave}>
                  {busy ? 'Saving…' : 'Save appraisal'}
                </PButton>
              </ActionBar>
              {msg && <InfoCallout t="positive" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{msg}</InfoCallout>}
            </SectionCard>
          )}
        </>
      )}

      {tab === 'bulk' && (
        <SectionCard>
          <EmptyState t="neutral" icon={<IconUpload size={20} />} title="Bulk Upload"
            hint={<>Not built yet. One appraisal at a time goes through Employee Wise, which validates the
              breakup and shows the back months before saving. A bulk sheet has to reproduce both of
              those checks per row, and doing it without them would push arrear into payroll unseen.</>} />
        </SectionCard>
      )}

      {tab === 'report' && (
        <SectionCard icon={<IconReports size={15} />} title="Saved appraisals" flush={report.length > 0}
          actions={
            <PButton size="sm" icon={<IconSync size={14} />} onClick={loadReport} disabled={repBusy}>
              {repBusy ? 'Loading…' : 'Refresh'}
            </PButton>
          }>
          {report.length === 0 ? (
            <EmptyState compact t="neutral" icon={<IconReports size={20} />} title={repBusy ? 'Loading…' : 'No appraisals saved yet.'} />
          ) : (
            <DataTable minWidth={760}>
              <thead>
                <tr>
                  {['Employee', 'Previous CTC', 'New CTC', 'Hike', 'Effective', 'Pay out', 'Back months', 'Status'].map(h => (
                    <th key={h} style={h === 'Employee' ? dt.th : dt.thNum}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.map(r => {
                  const bm = backMonths(r.effective_from, r.pay_out_month)
                  const td: React.CSSProperties = dt.tdNum
                  return (
                    <tr key={r.id} className={dt.rowClass}>
                      <td style={dt.tdMono}>{r.employee_code}</td>
                      <td style={{ ...td, color: TK.muted }}>{inr(r.previous_ctc)}</td>
                      <td style={{ ...td, fontWeight: W.bold }}>{inr(r.new_ctc)}</td>
                      <td style={{ ...td, color: TK.positive, fontWeight: W.bold }}>{r.hike_percent != null ? `${r.hike_percent}%` : '-'}</td>
                      <td style={td}>{r.effective_from}</td>
                      <td style={td}>{r.pay_out_month}</td>
                      <td style={{ ...td, color: bm.length ? TK.warning : TK.muted, fontWeight: bm.length ? W.bold : W.regular, whiteSpace: 'normal' }}>
                        {bm.length ? bm.join(', ') : '-'}
                      </td>
                      <td style={td}>
                        <StatusPill size="sm" t={r.status === 'ARREAR_PROCESSED' ? 'positive' : 'brand'}>{r.status}</StatusPill>
                        {r.requires_data_sync && <div style={{ fontSize: F.micro, color: TK.warning, marginTop: 3, fontWeight: W.semi }}>needs Data Sync</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </SectionCard>
      )}

      <InfoCallout t="info" title="The effective date and the pay-out month can differ.">
        The months in between were
        already paid at the old rate, so their difference becomes <b>head-wise arrear</b> and is
        added to the pay-out month&apos;s salary: Basic, HRA and Special each in their own arrear column.
        <br />Every back month&apos;s difference is worked out from <b>that month&apos;s actual frozen figures</b>,
        not an estimate, and is pro-rated by <b>that month&apos;s paid days</b>.
      </InfoCallout>
    </div>
  )
}
