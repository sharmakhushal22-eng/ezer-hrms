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
import { loadRuns, loadCompanies, editEmployeeAttendance, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { C, font, lbl, ddInp, GROUP, SearchSelect, MultiSelect, maxDaysLive, runPeriodISO, type Opt } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK } from '@/lib/ui'

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
    <div style={{ background: C.gray, borderRadius: 8, padding: '8px 11px' }}>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: tone || C.navy }}>{value ?? '—'}</div>
    </div>
  )
}

export default function AttendanceEditTab({ companyId, fy }: { companyId: string; fy: string }) {
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
    loadCompanies().then(cs => setCompanies((cs as any[]).map(c => ({ value: c.id, label: c.company_name })))).catch(() => {})
    loadRuns('', fy).then(setAllRuns).catch(() => {})
  }, [fy])
  useEffect(() => { setCoId(companyId || GROUP) }, [companyId])

  useEffect(() => {
    if (!coId) return
    const grp = coId === GROUP
    const scope = (q: any) => grp ? q : q.eq('company_id', coId)
    scope(supabase.from('locations').select('id, location_name').eq('status', 'Active').order('location_name'))
      .then(({ data }: any) => setLocOpts((data || []).map((l: any) => ({ value: l.id, label: l.location_name }))))
    scope(supabase.from('departments').select('id, dept_name').eq('status', 'Active').order('dept_name'))
      .then(({ data }: any) => setDeptOpts((data || []).map((d: any) => ({ value: d.id, label: d.dept_name }))))
    scope(supabase.from('employees').select('emp_code, full_name').neq('is_test', true).order('emp_code'))
      .then(({ data }: any) => setEmpOpts((data || []).filter((e: any) => e.emp_code).map((e: any) => ({ value: e.emp_code, label: `${e.emp_code} — ${e.full_name}` }))))
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
    ...(calcPaid < 0 ? [`Paid Days ${calcPaid} is negative — Absent Days cannot exceed Max Days ${maxD}`] : []),
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
    setSaveMsg(`${editing.employee_code} processed — Paid Days ${paidDays ?? calcPaid}.`)
    if (runStatusReset) setRecalc('This month was already calculated — it has been reset to SYNCED. Recalculate payroll before approval.')
    setEditing(null); search()
  }

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(37,99,235,0.06)' }
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 9.5, color: `${TK.brandEdge}`, fontWeight: 700, textTransform: 'uppercase', textAlign: 'right', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '7px 10px', textAlign: 'right', color: C.navy, whiteSpace: 'nowrap' }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.brand},${TK.brandDeep})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Attendance Edit</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Only employees whose attendance is already processed — Unprocess to reopen, then Process to re-apply the upload checks</div>
        </div>
      </div>

      {/* filters */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={lbl}>Company</label><SearchSelect value={coId} options={[{ value: GROUP, label: 'Group Companies (all)' }, ...companies]} placeholder="Select company" onChange={setCoId} /></div>
          <div><label style={lbl}>Month</label><SearchSelect value={monthVal} options={monthOpts} placeholder={monthOpts.length ? 'Select month' : 'No month created'} onChange={setMonthVal} /></div>
          <div><label style={lbl}>Location / Branch</label><SearchSelect value={loc} options={[{ value: '', label: 'All locations' }, ...locOpts]} placeholder="All locations" onChange={setLoc} /></div>
          <div><label style={lbl}>Department</label><SearchSelect value={dept} options={[{ value: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" onChange={setDept} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Employee codes <span style={{ textTransform: 'none', fontWeight: 400, color: C.muted }}>(type or paste several — e.g. SRS0001, SRS0002)</span></label>
          <MultiSelect values={codes} options={empOpts} placeholder="Click, then type or paste codes — e.g. SRS0001, SRS0002" onChange={setCodes} />
        </div>
        <button onClick={search} disabled={busy || !monthVal}
          style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brandDeep})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: busy || !monthVal ? 'not-allowed' : 'pointer', opacity: busy || !monthVal ? 0.6 : 1, boxShadow: '0 3px 10px rgba(37,99,235,0.22)' }}>
          {busy ? 'Searching…' : 'Search'}
        </button>
        {err && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 7, padding: '8px 10px', marginTop: 10 }}>{err}</div>}
      </div>

      {saveMsg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>✓ {saveMsg}</div>}
      {recalc && <div style={{ fontSize: 11.5, fontWeight: 700, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 9, padding: '10px 12px', marginBottom: 12 }}>⚠️ {recalc}</div>}

      {notProcessed.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 9, padding: '10px 12px', marginBottom: 12 }}>
          <b>Attendance not processed</b> — these employees have no uploaded attendance for this month, so they cannot be edited: {notProcessed.slice(0, 40).join(', ')}{notProcessed.length > 40 ? ` +${notProcessed.length - 40} more` : ''}
        </div>
      )}

      {rows && (
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
            Processed attendance · {rows.length} employee{rows.length === 1 ? '' : 's'}
          </div>
          {rows.length === 0
            ? <div style={{ fontSize: 12, color: C.muted, padding: '14px 0', textAlign: 'center' }}>No processed attendance matches these filters.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr style={{ background: C.navy }}>
                    {isGroup && <th style={{ ...th, textAlign: 'left' }}>Company</th>}
                    <th style={{ ...th, textAlign: 'left' }}>Emp Code</th>
                    <th style={{ ...th, textAlign: 'left' }}>Name</th>
                    <th style={{ ...th, textAlign: 'left' }}>Department</th>
                    {['Max Days', 'WO', 'EL', 'CL', 'SL', 'Other', 'Absent', 'Paid', 'OT'].map(h => <th key={h} style={th}>{h}</th>)}
                    <th style={{ ...th, textAlign: 'center' }}>Action</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.run_id + r.employee_code} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                        {isGroup && <td style={{ ...td, textAlign: 'left' }}>{r.companyName}</td>}
                        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{r.employee_code}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{r.full_name}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{r.department || '—'}</td>
                        <td style={td}>{r.maxDays ?? '—'}</td>
                        <td style={td}>{nn(r.weekly_off)}</td>
                        <td style={td}>{nn(r.earned_leave)}</td>
                        <td style={td}>{nn(r.casual_leave)}</td>
                        <td style={td}>{nn(r.sick_leave)}</td>
                        <td style={td}>{nn(r.other_leave)}</td>
                        <td style={td}>{nn(r.absent_days)}</td>
                        <td style={{ ...td, fontWeight: 700, color: C.green }}>{nn(r.paid_days)}</td>
                        <td style={td}>{nn(r.ot_hours)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button onClick={() => unprocess(r)}
                            style={{ padding: '5px 12px', borderRadius: 99, border: `0.5px solid ${C.amber}`, background: C.amberBg, color: C.amber, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Unprocess
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* Unprocess → edit form → Process */}
      {editing && (
        <>
          <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 600 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(680px, 94vw)', maxHeight: '90vh', overflowY: 'auto', background: TK.surface, borderRadius: 14, boxShadow: '0 24px 70px rgba(30,27,75,0.35)', zIndex: 601, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Unprocessed — {editing.employee_code} · {editing.full_name}</span>
              <button onClick={() => setEditing(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.muted }}></button>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 14 }}>
              {editing.companyName ? editing.companyName + ' · ' : ''}{editing.department || '—'}{editing.location ? ' · ' + editing.location : ''} — edit the values, then Process to re-apply the upload checks.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 14 }}>
              <ReadOut label="Days in Month" value={editing.days_in_month ?? '—'} />
              <ReadOut label="Max Days" value={editing.maxDays ?? '—'} />
              <ReadOut label="Paid Days" value={calcPaid} tone={calcPaid < 0 ? C.red : C.green} />
              <ReadOut label="Total Days" value={calcTotal} tone={maxD != null && calcTotal > maxD ? C.red : C.purpleD} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <NumIn label="Weekly Off" value={f.weekly_off} onChange={v => setF({ ...f, weekly_off: v })} />
              <NumIn label="Earned Leave" value={f.earned_leave} onChange={v => setF({ ...f, earned_leave: v })} />
              <NumIn label="Casual Leave" value={f.casual_leave} onChange={v => setF({ ...f, casual_leave: v })} />
              <NumIn label="Sick Leave" value={f.sick_leave} onChange={v => setF({ ...f, sick_leave: v })} />
              <NumIn label="Other Leave" value={f.other_leave} onChange={v => setF({ ...f, other_leave: v })} />
              <NumIn label="Absent Days" value={f.absent_days} onChange={setAbsent} />
              <NumIn label="OT Hours" value={f.ot_hours} onChange={v => setF({ ...f, ot_hours: v })} />
              <NumIn label="Paid Days" value={f.paid_days} onChange={v => setF({ ...f, paid_days: v })} />
            </div>

            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10, background: C.gray, borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
              Typing <b>Absent Days</b> sets <b>Paid Days = Max Days − Absent</b>{maxD != null && <> — right now <b>{maxD} − {nn(f.absent_days)} = {maxD - nn(f.absent_days)}</b></>}. Type over it if the case needs something else; whatever is in the box is what gets saved.
              <br />Clear the box entirely and the server falls back to the leave formula instead — that would give <b>{formulaPaid}</b> = (EL + CL + SL + Other) − Absent.
              <br />Total Days = Weekly Off + EL + CL + SL + Other + Paid Days − Absent. Both Paid Days and Total Days must be ≤ Max Days, exactly as on upload.
            </div>

            {violations.length > 0 && (
              <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
                <b>Cannot process</b> — {violations.join(' · ')}
              </div>
            )}
            {saveErr && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 8, padding: '9px 11px', marginTop: 12 }}>{saveErr}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={process} disabled={saveBusy || violations.length > 0}
                style={{ padding: '10px 24px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: saveBusy || violations.length ? 'not-allowed' : 'pointer', opacity: saveBusy || violations.length ? 0.5 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
                {saveBusy ? 'Processing…' : 'Process'}
              </button>
              <button onClick={() => setEditing(null)} disabled={saveBusy}
                style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${C.border}`, background: TK.surface, color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
