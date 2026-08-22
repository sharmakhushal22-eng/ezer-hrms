'use client'
// app/dashboard/attendance/page.tsx — Shift config + assignment + attendance records.
// Schema: migration 036. Shift code auto-generates (DB trigger). Inline styles.
import { useState, useEffect, useCallback } from 'react'
import {
  loadCompanies, loadEmployees, loadShifts, createShift, setShiftActive, deleteShift,
  loadActiveAssignments, assignShift, loadAttendance, loadLocations, loadDepartments, SHIFT_TYPES,
  type Shift, type ShiftAssignment, type AttRecord, type CompanyLite, type EmpLite,
  type LocationLite, type DeptLite,
} from '@/lib/supabase-shift'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const T = {
  page:  { background:TK.canvas, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:  { background:TK.surface, borderRadius:10, border:'1px solid rgba(37,99,235,0.12)', padding:'14px 16px', marginBottom:12, boxShadow:'0 1px 4px rgba(37,99,235,0.06)' } as React.CSSProperties,
  lbl:   { fontSize:10, fontWeight:600, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:TK.brand, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10 } as React.CSSProperties,
  input: { width:'100%', padding:'8px 10px', background:TK.sunken, border: `1px solid ${TK.brandEdge}`, borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:   { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:TK.onAccent, whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:   { padding:'7px 12px', borderRadius:7, border: `1px solid ${TK.brandEdge}`, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:TK.surface, color:TK.brandDeep } as React.CSSProperties,
  danger:{ padding:'6px 11px', borderRadius:7, border: `1px solid ${TK.criticalTint}`, cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:TK.surface, color:TK.critical } as React.CSSProperties,
  tab:   (on: boolean) => ({ padding:'9px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background: on ? TK.brand: TK.surface, color: on ? TK.surface : TK.brandDeep, boxShadow: on ? 'none' : '0 1px 3px rgba(37,99,235,0.08)' }) as React.CSSProperties,
}
const hrs = (m: number | null) => m == null ? '—' : `${Math.floor(m / 60)}h ${m % 60}m`
const tm = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'
const STATUS_COLOR: Record<string, [string, string]> = {
  PRESENT:[TK.positiveTint,TK.positive], HALF_DAY:[TK.warningTint,TK.warning], ABSENT:[TK.criticalTint,TK.critical],
  LEAVE:[TK.brandTint,TK.brandDeep], HOLIDAY:[TK.infoTint,TK.brand], WEEKLY_OFF:[TK.sunken,TK.muted], LWP:[TK.criticalTint,TK.critical],
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:TK.onAccent, borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'':''} {msg}</div>
}

// ══ Tab 1 · Shifts ═══════════════════════════════════════════════════
function ShiftsTab({ companies, locations, departments, shifts, onCreate, onToggle, onDelete }: {
  companies: CompanyLite[]; locations: LocationLite[]; departments: DeptLite[]; shifts: Shift[]
  onCreate: (i: any) => Promise<void>; onToggle: (s: Shift) => void; onDelete: (s: Shift) => void
}) {
  const [f, setF] = useState<any>({ company_id:'', branch_id:'', department_id:'', shift_type:'GENERAL', in_time:'09:00', late_allowed_till:'09:15', max_late_punch:'11:00', lunch_start:'13:00', lunch_duration_mins:30, out_time:'18:00', max_out_punch:'18:30', overtime_applicable:false, effective_from:new Date().toISOString().slice(0,10) })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  const ready = f.company_id && f.in_time && f.late_allowed_till && f.out_time
  const coName = (id: string) => companies.find(c => c.id === id)?.name || '—'
  const brName = (id?: string | null) => id ? (locations.find(l => l.id === id)?.name || '—') : null
  const deName = (id?: string | null) => id ? (departments.find(d => d.id === id)?.name || '—') : null
  return (
    <>
      <div style={T.card}>
        <div style={T.sec}>New shift <span style={{ fontWeight:400, color:TK.faint, textTransform:'none' }}>· code auto-generates (e.g. GEN-SSM-001)</span></div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          <div><label style={T.lbl}>Company</label><select style={T.input} value={f.company_id} onChange={e => { set('company_id', e.target.value); set('branch_id', ''); set('department_id', '') }}><option value="">— Select —</option><option value="ALL">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label style={T.lbl}>Branch / Location</label><select style={T.input} value={f.branch_id} onChange={e => set('branch_id', e.target.value)} disabled={!f.company_id || f.company_id==='ALL'}><option value="">All branches</option>{locations.filter(l => l.company_id === f.company_id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label style={T.lbl}>Department</label><select style={T.input} value={f.department_id} onChange={e => set('department_id', e.target.value)} disabled={!f.company_id || f.company_id==='ALL'}><option value="">All departments</option>{departments.filter(d => d.company_id === f.company_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label style={T.lbl}>Type</label><select style={T.input} value={f.shift_type} onChange={e => set('shift_type', e.target.value)}>{SHIFT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label style={T.lbl}>In time</label><input type="time" style={T.input} value={f.in_time} onChange={e => set('in_time', e.target.value)} /></div>
          <div><label style={T.lbl}>Late allowed till</label><input type="time" style={T.input} value={f.late_allowed_till} onChange={e => set('late_allowed_till', e.target.value)} /></div>
          <div><label style={T.lbl}>Max late punch</label><input type="time" style={T.input} value={f.max_late_punch} onChange={e => set('max_late_punch', e.target.value)} /></div>
          <div><label style={T.lbl}>Lunch start</label><input type="time" style={T.input} value={f.lunch_start} onChange={e => set('lunch_start', e.target.value)} /></div>
          <div><label style={T.lbl}>Lunch mins</label><input type="number" style={T.input} value={f.lunch_duration_mins} onChange={e => set('lunch_duration_mins', Number(e.target.value))} /></div>
          <div><label style={T.lbl}>Out time</label><input type="time" style={T.input} value={f.out_time} onChange={e => set('out_time', e.target.value)} /></div>
          <div><label style={T.lbl}>Max out (OT after)</label><input type="time" style={T.input} value={f.max_out_punch} onChange={e => set('max_out_punch', e.target.value)} /></div>
          <div><label style={T.lbl}>Effective from</label><input type="date" style={T.input} value={f.effective_from} onChange={e => set('effective_from', e.target.value)} /></div>
          <div style={{ display:'flex', alignItems:'flex-end' }}><label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={f.overtime_applicable} onChange={e => set('overtime_applicable', e.target.checked)} /> Overtime applicable</label></div>
          <div style={{ display:'flex', alignItems:'flex-end' }}>
            <button disabled={!ready || busy} style={{ ...T.pri, width:'100%', opacity: ready ? 1 : 0.5 }} onClick={async () => {
              setBusy(true)
              const base = { ...f, max_late_punch: f.max_late_punch || null, lunch_start: f.lunch_start || null, max_out_punch: f.max_out_punch || null }
              if (f.company_id === 'ALL') {
                for (const c of companies) await onCreate({ ...base, company_id: c.id, branch_id: null, department_id: null })
              } else {
                await onCreate({ ...base, branch_id: f.branch_id || null, department_id: f.department_id || null })
              }
              setBusy(false)
            }}>{busy ? '…' : '+ Create shift'}</button>
          </div>
        </div>
      </div>

      <div style={{ ...T.card, overflowX:'auto', padding:0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead><tr style={{ background:TK.sunken }}>{['Code','Type','Company','In → Out','Lunch','OT','Active',''].map(h => <th key={h} style={{ padding:'9px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', borderBottom: `1px solid ${TK.brandEdge}`, whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {shifts.length === 0 && <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:TK.faint }}>No shifts. Has migration 036 been run? Or create one above.</td></tr>}
            {shifts.map(s => (
              <tr key={s.id} style={{ borderBottom: `1px solid ${TK.brandEdge}`, opacity: s.is_active ? 1 : 0.5 }}>
                <td style={{ padding:'8px 10px', fontWeight:700 }}>{s.shift_code}</td>
                <td style={{ padding:'8px 10px' }}>{s.shift_type}</td>
                <td style={{ padding:'8px 10px', color:TK.muted }}>{coName(s.company_id)}{s.branch_id ? ' · ' + brName(s.branch_id) : ''}{s.department_id ? ' · ' + deName(s.department_id) : ''}</td>
                <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{s.in_time?.slice(0,5)} → {s.out_time?.slice(0,5)}</td>
                <td style={{ padding:'8px 10px', color:TK.muted }}>{s.lunch_duration_mins}m</td>
                <td style={{ padding:'8px 10px' }}>{s.overtime_applicable ? '' : '—'}</td>
                <td style={{ padding:'8px 10px' }}>{s.is_active ? '' : ''}</td>
                <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}><div style={{ display:'flex', gap:6 }}><button style={T.out} onClick={() => onToggle(s)}>{s.is_active ? 'Off' : 'On'}</button><button style={T.danger} onClick={() => onDelete(s)}>Del</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ══ Tab 2 · Assign ═══════════════════════════════════════════════════
function AssignTab({ shifts, employees, assignments, onAssign }: {
  shifts: Shift[]; employees: EmpLite[]; assignments: ShiftAssignment[]
  onAssign: (ids: string[], shiftId: string, eff: string) => Promise<void>
}) {
  const [shiftId, setShiftId] = useState('')
  const [eff, setEff] = useState(new Date().toISOString().slice(0, 10))
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const shift = shifts.find(s => s.id === shiftId)
  const assignedEmpIds = new Set(assignments.map(a => a.employee_id))
  const shiftByEmp = new Map(assignments.map(a => [a.employee_id, a.shift_id]))
  const codeOf = (id: string) => shifts.find(s => s.id === id)?.shift_code || '—'
  const coEmps = employees.filter(e => !shift || e.company_id === shift.company_id)
  const filtered = coEmps.filter(e => !q || e.full_name.toLowerCase().includes(q.toLowerCase()) || (e.emp_code || '').toLowerCase().includes(q.toLowerCase()))
  const pending = employees.filter(e => !assignedEmpIds.has(e.id))
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <>
      <div style={T.card}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr auto', gap:12, alignItems:'flex-end' }}>
          <div><label style={T.lbl}>Shift</label><select style={T.input} value={shiftId} onChange={e => { setShiftId(e.target.value); setSel(new Set()) }}><option value="">— Select active shift —</option>{shifts.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.shift_code} · {s.shift_type}</option>)}</select></div>
          <div><label style={T.lbl}>Effective from</label><input type="date" style={T.input} value={eff} onChange={e => setEff(e.target.value)} /></div>
          <button disabled={!shiftId || sel.size === 0 || busy} style={{ ...T.pri, opacity: (shiftId && sel.size) ? 1 : 0.5 }} onClick={async () => { setBusy(true); await onAssign([...sel], shiftId, eff); setSel(new Set()); setBusy(false) }}>Assign {sel.size || ''}</button>
        </div>
      </div>

      {shiftId && (
        <div style={T.card}>
          <input style={{ ...T.input, marginBottom:10, maxWidth:320 }} placeholder="Search employee" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight:'42vh', overflowY:'auto' }}>
            {filtered.map(e => (
              <label key={e.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 6px', borderBottom: `1px solid ${TK.brandEdge}`, cursor:'pointer' }}>
                <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} />
                <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600 }}>{e.full_name}</div><div style={{ fontSize:10, color:TK.faint }}>{e.emp_code} · {e.dept_name || '—'}</div></div>
                {assignedEmpIds.has(e.id) && <span style={{ fontSize:10, color:TK.muted }}>current: {codeOf(shiftByEmp.get(e.id) || '')}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={T.card}>
        <div style={T.sec}>Pending — no active shift ({pending.length})</div>
        {pending.length === 0 ? <div style={{ fontSize:12, color:TK.faint }}>Every employee already has a shift assigned.</div> : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:6 }}>
            {pending.slice(0, 120).map(e => <div key={e.id} style={{ fontSize:12, padding:'5px 8px', background:TK.sunken, borderRadius:6, border: `1px solid ${TK.brandEdge}` }}>{e.full_name} <span style={{ color:TK.faint, fontSize:10 }}>{e.emp_code}</span></div>)}
          </div>
        )}
      </div>
    </>
  )
}

// ══ Tab 3 · Records ══════════════════════════════════════════════════
function RecordsTab({ employees, records, from, to, onFrom, onTo }: {
  employees: EmpLite[]; records: AttRecord[]; from: string; to: string; onFrom: (d: string) => void; onTo: (d: string) => void
}) {
  const emp = (id: string) => employees.find(e => e.id === id)
  return (
    <>
      <div style={{ ...T.card, display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap', position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
        <div><label style={T.lbl}>From date</label><input type="date" style={{ ...T.input, width:170 }} value={from} max={to || undefined} onChange={e => onFrom(e.target.value)} /></div>
        <div><label style={T.lbl}>To date</label><input type="date" style={{ ...T.input, width:170 }} value={to} min={from || undefined} onChange={e => onTo(e.target.value)} /></div>
        <div style={{ marginLeft:'auto', fontSize:11, color:TK.muted }}>{records.length} record(s)</div>
      </div>
      <div style={{ ...T.card, overflowX:'auto', padding:0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead><tr style={{ background:TK.sunken }}>{['Date','Employee','In','Out','Worked','Late','OT','Status'].map(h => <th key={h} style={{ padding:'9px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', borderBottom: `1px solid ${TK.brandEdge}`, whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {records.length === 0 && <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:TK.faint }}>No processed attendance in this range. (It appears here once punches are processed.)</td></tr>}
            {records.map(r => {
              const e = emp(r.employee_id)
              const [bg, c] = STATUS_COLOR[r.status] || STATUS_COLOR.PRESENT
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${TK.brandEdge}` }}>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', color:TK.inkSoft }}>{r.attendance_date}</td>
                  <td style={{ padding:'8px 10px' }}><div style={{ fontWeight:600 }}>{e?.full_name || r.employee_id.slice(0, 8)}</div><div style={{ fontSize:10, color:TK.faint }}>{e?.emp_code || ''}</div></td>
                  <td style={{ padding:'8px 10px' }}>{tm(r.work_in)}</td>
                  <td style={{ padding:'8px 10px' }}>{tm(r.work_out)}</td>
                  <td style={{ padding:'8px 10px' }}>{hrs(r.total_minutes)}</td>
                  <td style={{ padding:'8px 10px', color: r.late_minutes ? TK.warning : TK.faint }}>{r.late_minutes ? `${r.late_minutes}m` : '—'}</td>
                  <td style={{ padding:'8px 10px', color: r.overtime_minutes ? TK.positive : TK.faint }}>{r.overtime_minutes ? `${r.overtime_minutes}m` : '—'}</td>
                  <td style={{ padding:'8px 10px' }}><span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color:c }}>{r.status}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function AttendancePage() {
  const [tab, setTab] = useState<'shifts' | 'assign' | 'records'>('shifts')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const [companies, setCompanies] = useState<CompanyLite[]>([])
  const [locations, setLocations] = useState<LocationLite[]>([])
  const [departments, setDepartments] = useState<DeptLite[]>([])
  const [employees, setEmployees] = useState<EmpLite[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10))
  const [records, setRecords] = useState<AttRecord[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [c, e, s, a, lo, de] = await Promise.all([loadCompanies(), loadEmployees(), loadShifts(), loadActiveAssignments(), loadLocations(), loadDepartments()])
      setCompanies(c); setEmployees(e); setShifts(s); setAssignments(a); setLocations(lo); setDepartments(de)
    } catch (err: any) { notify('Load failed: ' + (err?.message || 'check migration 036'), 'error') }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { loadAttendance(fromDate, toDate).then(setRecords).catch(() => {}) }, [fromDate, toDate, tab])

  async function doCreate(i: any) {
    const { error } = await createShift(i) as any
    if (error) return notify('Create failed: ' + error.message, 'error')
    notify('Shift created — code auto-generated.'); reload()
  }
  async function doToggle(s: Shift) { const { error } = await setShiftActive(s.id, !s.is_active); if (error) return notify('Failed', 'error'); reload() }
  async function doDelete(s: Shift) { if (!confirm(`Delete ${s.shift_code}?`)) return; const { error } = await deleteShift(s.id); if (error) return notify('Delete failed: ' + error.message + ' (shift may be assigned)', 'error'); notify('Deleted.'); reload() }
  async function doAssign(ids: string[], shiftId: string, eff: string) {
    const { error } = await assignShift(ids, shiftId, eff) as any
    if (error) return notify('Assign failed: ' + error.message, 'error')
    notify(`Shift assigned to ${ids.length} employee(s).`); reload()
  }

  const tabs: [typeof tab, string][] = [['shifts', 'Shifts'], ['assign', 'Assign'], ['records', 'Attendance Records']]

  return (
    <div style={{ ...T.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1200, margin:'0 auto' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Attendance &amp; Shifts</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Shift config (auto-coded), employee assignment, and processed attendance (first IN / last OUT). ESS app / biometric / manual punches feed one engine.</div>
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>{tabs.map(([k, l]) => <button key={k} style={T.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}</div>
        {loading ? <div style={{ ...T.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading…</div> : (
          <>
            {tab === 'shifts' && <ShiftsTab companies={companies} locations={locations} departments={departments} shifts={shifts} onCreate={doCreate} onToggle={doToggle} onDelete={doDelete} />}
            {tab === 'assign' && <AssignTab shifts={shifts} employees={employees} assignments={assignments} onAssign={doAssign} />}
            {tab === 'records' && <RecordsTab employees={employees} records={records} from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />}
          </>
        )}
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
