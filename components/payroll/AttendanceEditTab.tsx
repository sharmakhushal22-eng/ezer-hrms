'use client'
// components/payroll/AttendanceEditTab.tsx — Payroll → Attendance → Attendance Edit.
//
// Only employees whose attendance has ALREADY been uploaded appear here. Filter by
// company / month / location / department / employee code, then Unprocess a row to
// reopen it: a form shows every attendance column, and Process re-applies exactly the
// same checks the upload runs (Paid Days ≤ Max Days, Total Days ≤ Max Days) before
// committing. Searching an employee whose attendance was never uploaded is an explicit
// error rather than an empty list, so "nothing found" can't be mistaken for "no data".
//
// Payroll provision: committing an edit on a month that was already CALCULATED rolls
// that run back to SYNCED, so payroll has to be recalculated against the new paid days.
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { scopedCompanies } from '@/lib/rms/resolve'
import { loadRuns, loadCompanies, editEmployeeAttendance, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { font, lbl, ddInp, GROUP, SearchSelect, MultiSelect, maxDaysLive, runPeriodISO, ScreenIntro, Fld, Note, type Opt } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK, F, W, S as SP, R, E, numeric, eyebrow, IconSliders, IconSearch, IconClose, IconCheck } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, DataTable, EmptyState, StatusPill, CountChip, IconFilter, dt } from '@/components/payroll/kit'

type Row = {
  employee_id: string; run_id: string; employee_code: string; full_name: string
  department: string | null; location: string | null; days_in_month: number | null
  weekly_off: number | null; earned_leave: number | null; casual_leave: number | null
  sick_leave: number | null; other_leave: number | null; absent_days: number | null
  paid_days: number | null; ot_hours: number | null; attendance_uploaded_at: string | null
  maxDays: number | null; companyName: string
}
const SEL = 'employee_id, run_id, employee_code, full_name, department, location, days_in_month, weekly_off, earned_leave, casual_leave, sick_leave, other_leave, absent_days, paid_days, ot_hours, attendance_uploaded_at'
const nn = (v: any) => Number(v) || 0
const s = (v: any) => (v == null ? '' : String(v))

// Defined outside the parent so typing in the form never loses focus.
function NumIn({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type="number" step="0.5" value={value} onChange={e => onChange(e.target.value)} style={ddInp} />
    </div>
  )
}
function ReadOut({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return (
    <div style={{ background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: R.md, padding: '9px 12px', minWidth: 0 }}>
      <div style={{ ...eyebrow, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: F.title, fontWeight: W.bold, color: tone || TK.ink, lineHeight: 1.2, ...numeric }}>{value ?? '-'}</div>
    </div>
  )
}

export default function AttendanceEditTab({ companyId, fy }: { companyId: string; fy: string }) {
  const { grant } = useGrant()
  const [companies, setCompanies] = useState<Opt[]>([])
  const [allRuns, setAllRuns] = useState<PayrollRun[]>([])
  const [coId, setCoId] = useState('')
  const [monthVal, setMonthVal] = useState('')
  const [loc, setLoc] = useState(''); const [dept, setDept] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [locOpts, setLocOpts] = useState<Opt[]>([]); const [deptOpts, setDeptOpts] = useState<Opt[]>([]); const [empOpts, setEmpOpts] = useState<Opt[]>([])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(''); const [notProcessed, setNotProcessed] = useState<string[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)

  // the row being edited (Unprocess → form → Process)
  const [editing, setEditing] = useState<Row | null>(null)
  const [f, setF] = useState({ weekly_off: '', earned_leave: '', casual_leave: '', sick_leave: '', other_leave: '', absent_days: '', ot_hours: '', paid_days: '' })
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveErr, setSaveErr] = useState(''); const [saveMsg, setSaveMsg] = useState(''); const [recalc, setRecalc] = useState('')

  useEffect(() => {
    loadCompanies().then(cs => setCompanies(scopedCompanies(grant, cs as any[]).map((c: any) => ({ value: c.id, label: c.company_name })))).catch(() => {})
    loadRuns('', fy).then(setAllRuns).catch(() => {})
  }, [fy, grant]) // eslint-disable-line react-hooks/exhaustive-deps
  // Non-cross-company users are forced onto their own company; GROUP is never selected.
  useEffect(() => {
    setCoId(!grant.crossCompany && grant.companyId ? grant.companyId : (companyId || GROUP))
  }, [companyId, grant]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!coId) return
    const grp = coId === GROUP
    const scope = (q: any) => grp ? q : q.eq('company_id', coId)
    scope(supabase.from('locations').select('id, location_name').eq('status', 'Active').order('location_name'))
      .then(({ data }: any) => setLocOpts((data || []).map((l: any) => ({ value: l.id, label: l.location_name }))))
    scope(supabase.from('departments').select('id, dept_name').eq('status', 'Active').order('dept_name'))
      .then(({ data }: any) => setDeptOpts((data || []).map((d: any) => ({ value: d.id, label: d.dept_name }))))
    scope(supabase.from('employees').select('emp_code, full_name').neq('is_test', true).order('emp_code'))
      .then(({ data }: any) => setEmpOpts((data || []).filter((e: any) => e.emp_code).map((e: any) => ({ value: e.emp_code, label: `${e.emp_code} · ${e.full_name}` }))))
    setLoc(''); setDept(''); setCodes([]); setRows(null); setNotProcessed([])
    const first = allRuns.map(r => r.month).sort((a, b) => (a || 0) - (b || 0))[0]
    setMonthVal(first != null ? String(first) : '')
  }, [coId, allRuns])

  const isGroup = coId === GROUP
  const monthOpts: Opt[] = Array.from(new Map(allRuns.map(r =>
    [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }]
  )).values()).sort((a, b) => Number(a.value) - Number(b.value))

  async function search() {
    if (!monthVal) { setErr('Pick a payroll month first.'); return }
    setBusy(true); setErr(''); setNotProcessed([]); setRows(null)
    try {
      const monthRuns = allRuns.filter(r => String(r.month) === monthVal && (isGroup || r.company_id === coId))
      if (!monthRuns.length) throw new Error('No month master exists for this selection.')
      const runIds = monthRuns.map(r => r.id)
      const coName: Record<string, string> = {}; const periodISO: Record<string, string> = {}
      monthRuns.forEach(r => { coName[r.id] = r.company_name || ''; periodISO[r.id] = runPeriodISO(r.fy, r.month) || '' })

      const { data: snap, error } = await supabase.from('payroll_employee_snapshot').select(SEL).in('run_id', runIds).order('employee_code')
      if (error) throw new Error(error.message)
      let list = (snap || []) as any[]

      if (loc || dept || codes.length) {
        let q = supabase.from('employees').select('id, emp_code')
        if (!isGroup) q = q.eq('company_id', coId)
        if (loc) q = q.eq('location_id', loc)
        if (dept) q = q.eq('department_id', dept)
        if (codes.length) q = q.in('emp_code', codes)
        const { data: m } = await q
        const allow = new Set((m || []).map((e: any) => e.id))
        list = list.filter(r => allow.has(r.employee_id))
      }

      // An employee that exists in the month but has no attendance yet is reported
      // explicitly — that is the "attendance not processed" case, not an empty result.
      const unprocessed = list.filter(r => !r.attendance_uploaded_at).map(r => r.employee_code)
      const processed = list.filter(r => r.attendance_uploaded_at)
      // Codes typed by the user that are not in this month's master at all.
      const found = new Set(list.map(r => r.employee_code))
      const missing = codes.filter(c => !found.has(c))
      setNotProcessed([...unprocessed, ...missing.map(c => `${c} (not in this month)`)])

      // Max Days from the employee master's leaving date, same source as the upload check.
      const ids = Array.from(new Set(processed.map(r => r.employee_id)))
      const master: Record<string, any> = {}
      for (let i = 0; i < ids.length; i += 300) {
        const { data: emp } = await supabase.from('employees')
          .select('id, date_of_leaving, last_working_date, relieving_date').in('id', ids.slice(i, i + 300))
        ;(emp || []).forEach((e: any) => { master[e.id] = e })
      }
      setRows(processed.map(r => {
        const m = master[r.employee_id] || {}
        const dol = m.date_of_leaving || m.last_working_date || m.relieving_date || null
        return { ...r, companyName: coName[r.run_id] || '', maxDays: maxDaysLive(dol, periodISO[r.run_id] || null) } as Row
      }))
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  function unprocess(r: Row) {
    setEditing(r); setSaveErr(''); setSaveMsg(''); setRecalc('')
    setF({ weekly_off: s(r.weekly_off), earned_leave: s(r.earned_leave), casual_leave: s(r.casual_leave), sick_leave: s(r.sick_leave), other_leave: s(r.other_leave), absent_days: s(r.absent_days), ot_hours: s(r.ot_hours), paid_days: s(r.paid_days) })
  }

  // Paid Days as typed wins; blank it out to fall back to the leave formula.
  const formulaPaid = nn(f.earned_leave) + nn(f.casual_leave) + nn(f.sick_leave) + nn(f.other_leave) - nn(f.absent_days)
  const calcPaid = f.paid_days.trim() === '' ? formulaPaid : nn(f.paid_days)
  const calcTotal = nn(f.weekly_off) + nn(f.earned_leave) + nn(f.casual_leave) + nn(f.sick_leave) + nn(f.other_leave) + calcPaid - nn(f.absent_days)
  const maxD = editing?.maxDays ?? null

  // Typing Absent Days re-derives Paid Days as Max Days − Absent, because that is what
  // the number means: every day of the month the employee was on roll, minus the ones
  // they were away for. Max Days rather than days-in-month, so a mid-month leaver is
  // measured against the days they were actually here.
  // It is written into the field, not just displayed, so what HR sees is what is saved —
  // a derived-but-invisible value is how a payslip ends up disagreeing with the screen
  // that produced it. HR can still type over it afterwards.
  function setAbsent(v: string) {
    setF(prev => (maxD == null ? { ...prev, absent_days: v } : { ...prev, absent_days: v, paid_days: s(maxD - nn(v)) }))
  }

  const violations = maxD == null ? [] : [
    ...(calcPaid > maxD ? [`Paid Days ${calcPaid} > Max Days ${maxD}`] : []),
    ...(calcTotal > maxD ? [`Total Days ${calcTotal} > Max Days ${maxD}`] : []),
    // Reachable only by typing more absent days than the month has. Payroll floors it at
    // zero anyway, so saving it would just hide a typo until someone asks why the salary
    // was wrong.
    ...(calcPaid < 0 ? [`Paid Days ${calcPaid} is negative. Absent Days cannot exceed Max Days ${maxD}`] : []),
  ]

  async function process() {
    if (!editing || violations.length) return
    setSaveBusy(true); setSaveErr(''); setSaveMsg(''); setRecalc('')
    const { error, paidDays, runStatusReset } = await editEmployeeAttendance(editing.run_id, editing.employee_code, {
      weekly_off: nn(f.weekly_off), earned_leave: nn(f.earned_leave), casual_leave: nn(f.casual_leave),
      sick_leave: nn(f.sick_leave), other_leave: nn(f.other_leave), absent_days: nn(f.absent_days), ot_hours: nn(f.ot_hours),
      // null when blank → server falls back to the leave formula
      paid_days: f.paid_days.trim() === '' ? null : nn(f.paid_days),
    })
    setSaveBusy(false)
    if (error) { setSaveErr(error); return }
    setSaveMsg(`${editing.employee_code} processed: Paid Days ${paidDays ?? calcPaid}.`)
    if (runStatusReset) setRecalc('This month was already calculated. It has been reset to SYNCED. Recalculate payroll before approval.')
    setEditing(null); search()
  }

  const th: React.CSSProperties = dt.thNum
  const td: React.CSSProperties = { ...dt.tdNum, color: TK.inkSoft }
  const scrim = `color-mix(in srgb, ${TK.dark} 52%, transparent)`

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 1080 }}>
      <ScreenIntro icon={<IconSliders size={20} />} title="Attendance Edit"
        subtitle="Only employees whose attendance is already processed. Unprocess to reopen, then Process to re-apply the upload checks"
        meta={<>
          <StatusPill t="neutral" size="sm" dot>Paid Days ≤ Max Days</StatusPill>
          <StatusPill t="neutral" size="sm" dot>Total Days ≤ Max Days</StatusPill>
          <StatusPill t="warning" size="sm" dot>Editing a calculated month resets it to SYNCED</StatusPill>
        </>} />

      {/* filters */}
      <SectionCard icon={<IconFilter size={15} />} title="Find processed attendance"
        hint="Narrow by company, month, location, department or a pasted list of codes."
        style={{ overflow: 'visible' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: SP.md, marginBottom: SP.md }}>
          <Fld label="Company"><SearchSelect value={coId} options={[...(grant.crossCompany ? [{ value: GROUP, label: 'Group Companies (all)' }] : []), ...companies]} placeholder="Select company" onChange={setCoId} /></Fld>
          <Fld label="Month"><SearchSelect value={monthVal} options={monthOpts} placeholder={monthOpts.length ? 'Select month' : 'No month created'} onChange={setMonthVal} /></Fld>
          <Fld label="Location / Branch"><SearchSelect value={loc} options={[{ value: '', label: 'All locations' }, ...locOpts]} placeholder="All locations" onChange={setLoc} /></Fld>
          <Fld label="Department"><SearchSelect value={dept} options={[{ value: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" onChange={setDept} /></Fld>
        </div>
        <div style={{ marginBottom: SP.md }}>
          <Fld label="Employee codes" hint="(type or paste several, e.g. SRS0001, SRS0002)">
            <MultiSelect values={codes} options={empOpts} placeholder="Click, then type or paste codes, e.g. SRS0001, SRS0002" onChange={setCodes} />
          </Fld>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, paddingTop: SP.md, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
          <PButton variant="primary" icon={<IconSearch size={15} />} onClick={search} disabled={busy || !monthVal}>
            {busy ? 'Searching…' : 'Search'}
          </PButton>
          {codes.length > 0 && <StatusPill t="brand" size="sm" dot>{codes.length} code{codes.length === 1 ? '' : 's'} picked</StatusPill>}
        </div>
        {err && <InfoCallout t="critical" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{err}</InfoCallout>}
      </SectionCard>

      {saveMsg && <InfoCallout t="positive" compact title={saveMsg} />}
      {recalc && <InfoCallout t="warning" compact title={recalc} />}

      {notProcessed.length > 0 && (
        <InfoCallout t="critical" compact title="Attendance not processed">
          These employees have no uploaded attendance for this month, so they cannot be edited: {notProcessed.slice(0, 40).join(', ')}{notProcessed.length > 40 ? ` +${notProcessed.length - 40} more` : ''}
        </InfoCallout>
      )}

      {rows && (
        <SectionCard title="Processed attendance" flush
          hint={`${rows.length} employee${rows.length === 1 ? '' : 's'}`}
          actions={<CountChip t="brand">{rows.length}</CountChip>}>
          {rows.length === 0
            ? <EmptyState compact t="neutral" icon={<IconSearch size={20} />} title="No processed attendance matches these filters." />
            : (
              <DataTable minWidth={860}>
                <thead><tr>
                  {isGroup && <th style={dt.th}>Company</th>}
                  <th style={dt.th}>Emp Code</th>
                  <th style={dt.th}>Name</th>
                  <th style={dt.th}>Department</th>
                  {['Max Days', 'WO', 'EL', 'CL', 'SL', 'Other', 'Absent', 'Paid', 'OT'].map(h => <th key={h} style={th}>{h}</th>)}
                  <th style={{ ...dt.th, textAlign: 'center' }}>Action</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.run_id + r.employee_code} className={dt.rowClass}>
                      {isGroup && <td style={{ ...dt.td, color: TK.muted, whiteSpace: 'nowrap' }}>{r.companyName}</td>}
                      <td style={dt.tdMono}>{r.employee_code}</td>
                      <td style={{ ...dt.tdStrong, whiteSpace: 'nowrap' }}>{r.full_name}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.department || '-'}</td>
                      <td style={{ ...td, color: TK.ink, fontWeight: W.semi }}>{r.maxDays ?? '-'}</td>
                      <td style={td}>{nn(r.weekly_off)}</td>
                      <td style={td}>{nn(r.earned_leave)}</td>
                      <td style={td}>{nn(r.casual_leave)}</td>
                      <td style={td}>{nn(r.sick_leave)}</td>
                      <td style={td}>{nn(r.other_leave)}</td>
                      <td style={td}>{nn(r.absent_days)}</td>
                      <td style={{ ...td, fontWeight: W.bold, color: TK.positive }}>{nn(r.paid_days)}</td>
                      <td style={td}>{nn(r.ot_hours)}</td>
                      <td style={{ ...dt.td, textAlign: 'center' }}>
                        <PButton size="sm" onClick={() => unprocess(r)} style={{ color: TK.warning, borderColor: TK.warningEdge }}>Unprocess</PButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
        </SectionCard>
      )}

      {/* Unprocess → edit form → Process */}
      {editing && (
        <>
          <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: scrim, zIndex: 600 }} />
          <div role="dialog" aria-modal="true" className="ez-rise" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(700px, 94vw)', maxHeight: '90vh', overflowY: 'auto', background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.xl, boxShadow: E.overlay, zIndex: 601, padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: SP.md, padding: `${SP.lg}px ${SP.xl}px`, borderBottom: `1px solid ${TK.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
                  <StatusPill t="warning" size="sm" dot>Unprocessed</StatusPill>
                  <span style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink }}>{editing.employee_code} · {editing.full_name}</span>
                </div>
                <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 5 }}>
                  {editing.companyName ? editing.companyName + ' · ' : ''}{editing.department || '-'}{editing.location ? ' · ' + editing.location : ''}. Edit the values, then Process to re-apply the upload checks.
                </div>
              </div>
              <button onClick={() => setEditing(null)} aria-label="Close" className="ez-press"
                style={{ width: 32, height: 32, borderRadius: R.sm, border: `1px solid ${TK.line}`, background: TK.surface, cursor: 'pointer', color: TK.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IconClose size={15} /></button>
            </div>

            <div style={{ padding: `${SP.lg}px ${SP.xl}px` }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))', gap: SP.sm + 2, marginBottom: SP.lg }}>
                <ReadOut label="Days in Month" value={editing.days_in_month ?? '-'} />
                <ReadOut label="Max Days" value={editing.maxDays ?? '-'} />
                <ReadOut label="Paid Days" value={calcPaid} tone={calcPaid < 0 ? TK.critical : TK.positive} />
                <ReadOut label="Total Days" value={calcTotal} tone={maxD != null && calcTotal > maxD ? TK.critical : TK.brandDeep} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: SP.md }}>
                <NumIn label="Weekly Off" value={f.weekly_off} onChange={v => setF({ ...f, weekly_off: v })} />
                <NumIn label="Earned Leave" value={f.earned_leave} onChange={v => setF({ ...f, earned_leave: v })} />
                <NumIn label="Casual Leave" value={f.casual_leave} onChange={v => setF({ ...f, casual_leave: v })} />
                <NumIn label="Sick Leave" value={f.sick_leave} onChange={v => setF({ ...f, sick_leave: v })} />
                <NumIn label="Other Leave" value={f.other_leave} onChange={v => setF({ ...f, other_leave: v })} />
                <NumIn label="Absent Days" value={f.absent_days} onChange={setAbsent} />
                <NumIn label="OT Hours" value={f.ot_hours} onChange={v => setF({ ...f, ot_hours: v })} />
                <NumIn label="Paid Days" value={f.paid_days} onChange={v => setF({ ...f, paid_days: v })} />
              </div>

              <Note style={{ marginTop: SP.md }}>
                Typing <b>Absent Days</b> sets <b>Paid Days = Max Days − Absent</b>{maxD != null && <> (right now <b>{maxD} − {nn(f.absent_days)} = {maxD - nn(f.absent_days)}</b>)</>}. Type over it if the case needs something else; whatever is in the box is what gets saved.
                <br />Clear the box entirely and the server falls back to the leave formula instead, which would give <b>{formulaPaid}</b> = (EL + CL + SL + Other) − Absent.
                <br />Total Days = Weekly Off + EL + CL + SL + Other + Paid Days − Absent. Both Paid Days and Total Days must be ≤ Max Days, exactly as on upload.
              </Note>

              {violations.length > 0 && (
                <InfoCallout t="critical" compact title="Cannot process" style={{ marginTop: SP.md, marginBottom: 0 }}>
                  {violations.join(' · ')}
                </InfoCallout>
              )}
              {saveErr && <InfoCallout t="critical" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{saveErr}</InfoCallout>}
            </div>

            <div style={{ display: 'flex', gap: SP.sm + 2, padding: `${SP.md}px ${SP.xl}px`, borderTop: `1px solid ${TK.line}`, background: TK.sunken, justifyContent: 'flex-end', flexWrap: 'wrap', borderRadius: `0 0 ${R.xl}px ${R.xl}px` }}>
              <PButton onClick={() => setEditing(null)} disabled={saveBusy}>Cancel</PButton>
              <PButton variant="primary" icon={<IconCheck size={15} />} onClick={process} disabled={saveBusy || violations.length > 0}>
                {saveBusy ? 'Processing…' : 'Process'}
              </PButton>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
