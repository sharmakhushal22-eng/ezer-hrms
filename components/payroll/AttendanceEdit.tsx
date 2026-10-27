'use client'
// components/payroll/AttendanceEdit.tsx — Payroll → Attendance → Edit & Arrear.
// After upload, correct one employee at a time: search within the month, edit Paid Days /
// leave / absent / OT inline (edit_employee_attendance — only changed fields move, and
// paid_days is always recomputed from the leave fields — same rule as the upload, so the
// two can never drift, and an edit to an already-calculated month rolls it back to SYNCED).
// Plus an Arrear Days form that
// lands arrear from a prior period into THIS run (add_arrear_days) without touching the source.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { loadRuns, editEmployeeAttendance, addArrearDays, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { font, lbl, ddInp, SearchSelect, ScreenIntro, Fld, type Opt } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK, F, W, S as SP, R, numeric, IconCalendar, IconSliders, IconPlus, IconCheck } from '@/lib/ui'
import { SectionCard, InfoCallout, PButton, KeyValueGrid, StatusPill } from '@/components/payroll/kit'

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
      {hint && <div style={{ fontSize: F.micro, color: TK.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const okMsg: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: F.tiny, fontWeight: W.semi, color: TK.positive }

// One component, two tabs: 'edit' corrects attendance, 'arrear' adds prior-period days.
// They share the month + employee picker and the snapshot load, so the two screens can
// never disagree about which employee is selected or what the stored figures are.
export default function AttendanceEdit({ companyId, fy, mode = 'edit' }: { companyId: string; fy: string; mode?: 'edit' | 'arrear' }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [snap, setSnap] = useState<SnapRow[]>([])
  const [selCode, setSelCode] = useState('')

  // edit form
  // No paid_days field — it is derived from these on save, never entered.
  const [f, setF] = useState({ earned_leave: '', casual_leave: '', sick_leave: '', other_leave: '', absent_days: '', ot_hours: '' })
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState(''); const [saveErr, setSaveErr] = useState('')
  const [recalcMsg, setRecalcMsg] = useState('')   // run was rolled back to SYNCED

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
    setF({ earned_leave: s(cur.earned_leave), casual_leave: s(cur.casual_leave), sick_leave: s(cur.sick_leave), other_leave: s(cur.other_leave), absent_days: s(cur.absent_days), ot_hours: s(cur.ot_hours) })
    setArrDays(s(cur.arrear_days)); setArrReason(cur.arrear_reason || ''); setArrMonth(cur.arrear_source_period ? String(cur.arrear_source_period).slice(0, 7) : '')
    setSaveMsg(''); setSaveErr(''); setArrMsg(''); setArrErr(''); setRecalcMsg('')
  }, [selCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const empOpts: Opt[] = snap.map(r => ({ value: r.employee_code, label: `${r.employee_code} · ${r.full_name}` }))
  const runOpts: Opt[] = runs.map(r => ({ value: r.id, label: `month master for ${r.company_name || 'company'} for ${r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`}` }))

  async function save() {
    if (!selCode) return
    setSaveBusy(true); setSaveMsg(''); setSaveErr(''); setRecalcMsg('')
    const { error, paidDays, runStatusReset } = await editEmployeeAttendance(runId, selCode, {
      earned_leave: n(f.earned_leave), casual_leave: n(f.casual_leave),
      sick_leave: n(f.sick_leave), other_leave: n(f.other_leave), absent_days: n(f.absent_days), ot_hours: n(f.ot_hours),
    })
    setSaveBusy(false)
    if (error) { setSaveErr(error); return }
    setSaveMsg(`Saved: ${selCode} updated. Paid Days recalculated to ${paidDays ?? '-'}.`)
    if (runStatusReset) setRecalcMsg('This month was already calculated. It has been reset to SYNCED. Payroll must be recalculated before approval.')
    reloadRuns(); loadSnap()
  }

  async function saveArrear() {
    if (!selCode) return
    if (arrDays.trim() === '' || !arrMonth) { setArrErr('Enter arrear days and the source month.'); return }
    setArrBusy(true); setArrMsg(''); setArrErr('')
    const { error } = await addArrearDays(runId, selCode, Number(arrDays), `${arrMonth}-01`, arrReason)
    setArrBusy(false)
    if (error) { setArrErr(error); return }
    setArrMsg(`Arrear recorded: ${arrDays} day(s) from ${arrMonth} added to this run.`); loadSnap()
  }

  const livePaid = (Number(f.earned_leave) || 0) + (Number(f.casual_leave) || 0) + (Number(f.sick_leave) || 0) + (Number(f.other_leave) || 0) - (Number(f.absent_days) || 0)

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 860 }}>
      <ScreenIntro icon={mode === 'arrear' ? <IconPlus size={20} /> : <IconSliders size={20} />}
        title={mode === 'arrear' ? 'Arrear Days' : 'Attendance Edit'}
        subtitle={mode === 'arrear'
          ? 'Add days owed from a prior month into this run. The source month is never reopened'
          : 'Correct one employee after upload. Paid Days is recalculated by the same rule as the upload'}
        meta={cur ? <StatusPill t="brand" size="sm" dot>{cur.employee_code} · {cur.full_name}</StatusPill> : undefined} />

      {!companyId && <InfoCallout t="warning" compact>Pick a specific company in the header to see its payroll months.</InfoCallout>}

      {/* month + employee pickers */}
      <SectionCard icon={<IconCalendar size={15} />} title="Month and employee" style={{ overflow: 'visible' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: SP.md }}>
          <Fld label="Payroll month"><SearchSelect value={runId} options={runOpts} placeholder={runOpts.length ? 'Select month' : 'No month created'} onChange={v => { setRunId(v); setSelCode('') }} /></Fld>
          <Fld label="Employee"><SearchSelect value={selCode} options={empOpts} placeholder={empOpts.length ? 'Search emp code / name' : 'No employees in this month'} onChange={setSelCode} /></Fld>
        </div>
      </SectionCard>

      {cur && (
        <>
          {/* context stats */}
          <div style={{ marginBottom: SP.lg }}>
            <KeyValueGrid min={150} items={[
              { label: 'Department', value: cur.department || '-' },
              { label: 'Days in Month', value: cur.days_in_month ?? '-', mono: true },
              { label: 'Total Days', value: cur.total_days ?? '-', mono: true },
              { label: 'Paid Days', value: cur.paid_days ?? '-', mono: true, t: 'positive' },
            ]} />
          </div>

          {/* edit form */}
          {mode === 'edit' && (
          <SectionCard icon={<IconSliders size={15} />} title={`Edit attendance: ${cur.employee_code} · ${cur.full_name}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: SP.md }}>
              <NumField label="Earned Leave" value={f.earned_leave} onChange={v => setF({ ...f, earned_leave: v })} />
              <NumField label="Casual Leave" value={f.casual_leave} onChange={v => setF({ ...f, casual_leave: v })} />
              <NumField label="Sick Leave" value={f.sick_leave} onChange={v => setF({ ...f, sick_leave: v })} />
              <NumField label="Other Leave" value={f.other_leave} onChange={v => setF({ ...f, other_leave: v })} />
              <NumField label="Absent Days" value={f.absent_days} onChange={v => setF({ ...f, absent_days: v })} />
              <NumField label="OT Hours" value={f.ot_hours} onChange={v => setF({ ...f, ot_hours: v })} />
            </div>
            {/* Paid Days is derived, never typed — same rule as the upload. */}
            <div style={{ marginTop: SP.md, background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: R.md, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap' }}>
              <span style={{ fontSize: F.micro, color: TK.muted, fontWeight: W.bold, textTransform: 'uppercase', letterSpacing: '.09em' }}>Paid Days</span>
              <span style={{ fontSize: F.title, fontWeight: W.bold, color: livePaid < 0 ? TK.critical : TK.positive, ...numeric }}>
                {livePaid}
              </span>
              <span style={{ fontSize: F.tiny, color: TK.muted }}>= (EL + CL + SL + Other) − Absent · calculated on save, same as the upload</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginTop: SP.md, paddingTop: SP.md, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
              <PButton variant="primary" icon={<IconCheck size={15} />} onClick={save} disabled={saveBusy}>
                {saveBusy ? 'Saving…' : 'Save changes'}
              </PButton>
              {saveMsg && <span style={okMsg}><IconCheck size={13} /> {saveMsg}</span>}
              {saveErr && <span style={{ fontSize: F.tiny, color: TK.critical }}>{saveErr}</span>}
            </div>
            {recalcMsg && <InfoCallout t="warning" compact title={recalcMsg} style={{ marginTop: SP.md, marginBottom: 0 }} />}
          </SectionCard>

          )}

          {/* arrear form */}
          {mode === 'arrear' && (
          <SectionCard icon={<IconPlus size={15} />} iconTone="positive" title="Arrear days"
            hint="Days owed from a prior month land in THIS run. The source month is only recorded for audit and is never reopened.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: SP.md }}>
              <Fld label="Arrear days"><input type="number" step="0.5" value={arrDays} onChange={e => setArrDays(e.target.value)} style={ddInp} /></Fld>
              <Fld label="Source period"><input type="month" value={arrMonth} onChange={e => setArrMonth(e.target.value)} style={ddInp} /></Fld>
              <Fld label="Reason" span><input value={arrReason} onChange={e => setArrReason(e.target.value)} placeholder="e.g. March correction" style={ddInp} /></Fld>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginTop: SP.md, paddingTop: SP.md, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
              <PButton variant="primary" icon={<IconPlus size={15} />} onClick={saveArrear} disabled={arrBusy}>
                {arrBusy ? 'Saving…' : 'Add arrear'}
              </PButton>
              {cur.arrear_days ? <span style={{ fontSize: F.tiny, color: TK.inkSoft }}>current: <b>{cur.arrear_days}</b> day(s){cur.arrear_source_period ? ` from ${String(cur.arrear_source_period).slice(0, 7)}` : ''}</span> : null}
              {arrMsg && <span style={okMsg}><IconCheck size={13} /> {arrMsg}</span>}
              {arrErr && <span style={{ fontSize: F.tiny, color: TK.critical }}>{arrErr}</span>}
            </div>
          </SectionCard>
          )}
        </>
      )}
    </div>
  )
}
