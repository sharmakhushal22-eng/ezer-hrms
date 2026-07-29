'use client'
// components/payroll/AttendanceEdit.tsx — Payroll → Attendance → Edit & Arrear.
// After upload, correct one employee at a time: search within the month, edit Paid Days /
// leave / absent / OT inline (edit_employee_attendance — only changed fields move, and
// paid_days is NOT recomputed here so a manual value stands). Plus an Arrear Days form that
// lands arrear from a prior period into THIS run (add_arrear_days) without touching the source.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { loadRuns, editEmployeeAttendance, addArrearDays, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { C, font, lbl, ddInp, SearchSelect, type Opt } from './attendanceShared'

type SnapRow = {
  employee_code: string; full_name: string; department: string | null
  days_in_month: number | null; total_days: number | null
  paid_days: number | null; earned_leave: number | null; casual_leave: number | null
  sick_leave: number | null; other_leave: number | null; absent_days: number | null; ot_hours: number | null
  arrear_days: number | null; arrear_source_period: string | null; arrear_reason: string | null
}
const SNAP_COLS = 'employee_code, full_name, department, days_in_month, total_days, paid_days, earned_leave, casual_leave, sick_leave, other_leave, absent_days, ot_hours, arrear_days, arrear_source_period, arrear_reason'
const s = (v: number | null | undefined) => (v == null ? '' : String(v))
const n = (v: string) => (v.trim() === '' ? null : Number(v))

// module-level field so typing never loses focus
function NumField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type="number" step="0.5" value={value} onChange={e => onChange(e.target.value)} style={ddInp} />
      {hint && <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

export default function AttendanceEdit({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [snap, setSnap] = useState<SnapRow[]>([])
  const [selCode, setSelCode] = useState('')

  // edit form
  const [f, setF] = useState({ paid_days: '', earned_leave: '', casual_leave: '', sick_leave: '', other_leave: '', absent_days: '', ot_hours: '' })
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState(''); const [saveErr, setSaveErr] = useState('')

  // arrear form
  const [arrDays, setArrDays] = useState(''); const [arrMonth, setArrMonth] = useState(''); const [arrReason, setArrReason] = useState('')
  const [arrBusy, setArrBusy] = useState(false); const [arrMsg, setArrMsg] = useState(''); const [arrErr, setArrErr] = useState('')

  const reloadRuns = useCallback(async () => {
    const list = await loadRuns(companyId, fy)
    setRuns(list); if (list.length && !runId) setRunId(list[0].id)
  }, [companyId, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadRuns() }, [reloadRuns])

  const loadSnap = useCallback(async () => {
    if (!runId) { setSnap([]); return }
    const { data } = await supabase.from('payroll_employee_snapshot').select(SNAP_COLS).eq('run_id', runId).order('employee_code')
    setSnap((data as any[]) || []); setSelCode('')
  }, [runId])
  useEffect(() => { loadSnap() }, [loadSnap])

  const cur = snap.find(r => r.employee_code === selCode) || null
  // populate the edit form when the selected employee changes
  useEffect(() => {
    if (!cur) return
    setF({ paid_days: s(cur.paid_days), earned_leave: s(cur.earned_leave), casual_leave: s(cur.casual_leave), sick_leave: s(cur.sick_leave), other_leave: s(cur.other_leave), absent_days: s(cur.absent_days), ot_hours: s(cur.ot_hours) })
    setArrDays(s(cur.arrear_days)); setArrReason(cur.arrear_reason || ''); setArrMonth(cur.arrear_source_period ? String(cur.arrear_source_period).slice(0, 7) : '')
    setSaveMsg(''); setSaveErr(''); setArrMsg(''); setArrErr('')
  }, [selCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const empOpts: Opt[] = snap.map(r => ({ value: r.employee_code, label: `${r.employee_code} — ${r.full_name}` }))
  const runOpts: Opt[] = runs.map(r => ({ value: r.id, label: `month master for ${r.company_name || 'company'} for ${r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`}` }))

  async function save() {
    if (!selCode) return
    setSaveBusy(true); setSaveMsg(''); setSaveErr('')
    const { error } = await editEmployeeAttendance(runId, selCode, {
      paid_days: n(f.paid_days), earned_leave: n(f.earned_leave), casual_leave: n(f.casual_leave),
      sick_leave: n(f.sick_leave), other_leave: n(f.other_leave), absent_days: n(f.absent_days), ot_hours: n(f.ot_hours),
    })
    setSaveBusy(false)
    if (error) { setSaveErr(error); return }
    setSaveMsg(`Saved — ${selCode} updated.`); loadSnap()
  }

  async function saveArrear() {
    if (!selCode) return
    if (arrDays.trim() === '' || !arrMonth) { setArrErr('Enter arrear days and the source month.'); return }
    setArrBusy(true); setArrMsg(''); setArrErr('')
    const { error } = await addArrearDays(runId, selCode, Number(arrDays), `${arrMonth}-01`, arrReason)
    setArrBusy(false)
    if (error) { setArrErr(error); return }
    setArrMsg(`Arrear recorded — ${arrDays} day(s) from ${arrMonth} added to this run.`); loadSnap()
  }

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }
  const stat = (label: string, val: any) => (
    <div style={{ background: C.gray, borderRadius: 8, padding: '8px 11px', minWidth: 90 }}>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{val ?? '—'}</div>
    </div>
  )

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 780 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>✏️</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Attendance Edit &amp; Arrear</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Correct one employee after upload · add arrear days from a prior period</div>
        </div>
      </div>

      {!companyId && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>Pick a specific company in the header to see its payroll months.</div>}

      {/* month + employee pickers */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div><label style={lbl}>Payroll month</label><SearchSelect value={runId} options={runOpts} placeholder={runOpts.length ? 'Select month' : 'No month created'} onChange={v => { setRunId(v); setSelCode('') }} /></div>
          <div><label style={lbl}>Employee</label><SearchSelect value={selCode} options={empOpts} placeholder={empOpts.length ? 'Search emp code / name' : 'No employees in this month'} onChange={setSelCode} /></div>
        </div>
      </div>

      {cur && (
        <>
          {/* context stats */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {stat('Department', cur.department || '—')}
            {stat('Days in Month', cur.days_in_month)}
            {stat('Total Days', cur.total_days)}
            {stat('Paid Days', cur.paid_days)}
          </div>

          {/* edit form */}
          <div style={card}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>✏️ Edit attendance — {cur.employee_code} · {cur.full_name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <NumField label="Paid Days" value={f.paid_days} onChange={v => setF({ ...f, paid_days: v })} hint="not auto-recomputed" />
              <NumField label="Earned Leave" value={f.earned_leave} onChange={v => setF({ ...f, earned_leave: v })} />
              <NumField label="Casual Leave" value={f.casual_leave} onChange={v => setF({ ...f, casual_leave: v })} />
              <NumField label="Sick Leave" value={f.sick_leave} onChange={v => setF({ ...f, sick_leave: v })} />
              <NumField label="Other Leave" value={f.other_leave} onChange={v => setF({ ...f, other_leave: v })} />
              <NumField label="Absent Days" value={f.absent_days} onChange={v => setF({ ...f, absent_days: v })} />
              <NumField label="OT Hours" value={f.ot_hours} onChange={v => setF({ ...f, ot_hours: v })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={save} disabled={saveBusy}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saveBusy ? 'not-allowed' : 'pointer', opacity: saveBusy ? 0.6 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
                {saveBusy ? 'Saving…' : 'Save changes'}
              </button>
              {saveMsg && <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ {saveMsg}</span>}
              {saveErr && <span style={{ fontSize: 12, color: C.red }}>{saveErr}</span>}
            </div>
          </div>

          {/* arrear form */}
          <div style={{ ...card, borderColor: C.greenBd }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 4 }}>📌 Arrear days</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 12 }}>Days owed from a prior month land in THIS run — the source month is only recorded for audit and is never reopened.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div><label style={lbl}>Arrear days</label><input type="number" step="0.5" value={arrDays} onChange={e => setArrDays(e.target.value)} style={ddInp} /></div>
              <div><label style={lbl}>Source period</label><input type="month" value={arrMonth} onChange={e => setArrMonth(e.target.value)} style={ddInp} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Reason</label><input value={arrReason} onChange={e => setArrReason(e.target.value)} placeholder="e.g. March correction" style={ddInp} /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={saveArrear} disabled={arrBusy}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: arrBusy ? 'not-allowed' : 'pointer', opacity: arrBusy ? 0.6 : 1, boxShadow: '0 3px 10px rgba(5,150,105,0.22)' }}>
                {arrBusy ? 'Saving…' : 'Add arrear'}
              </button>
              {cur.arrear_days ? <span style={{ fontSize: 11.5, color: C.purpleD }}>current: <b>{cur.arrear_days}</b> day(s){cur.arrear_source_period ? ` from ${String(cur.arrear_source_period).slice(0, 7)}` : ''}</span> : null}
              {arrMsg && <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ {arrMsg}</span>}
              {arrErr && <span style={{ fontSize: 12, color: C.red }}>{arrErr}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
