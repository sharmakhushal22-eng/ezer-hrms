'use client'
// app/dashboard/holidays/page.tsx — Holiday & Weekly-off Configuration (Layer 1)
// Calendars + company mapping · Holidays (branch applicability + weekend override)
// · Weekly off (primary + NTH) · Employee preview (resolve_holidays / resolve_weekly_offs).
// Inline styles only. All sub-components OUTSIDE parent. Schema: migration 026.
import { useState, useEffect, useCallback } from 'react'
import {
  listCalendars, createCalendar, setCalendarStatus, deleteCalendar,
  listCompanies, listBranches, listDepartments, listEmployees, listCompanyMaps, upsertCompanyMap,
  listHolidays, listApplicability, createHoliday, deleteHoliday,
  listWeeklyOffs, createWeeklyOff, deleteWeeklyOff, weekendConflict,
  resolveHolidays, resolveWeeklyOffs, WEEKDAYS, HOLIDAY_TYPES,
  type HolidayCalendar, type CompanyCalendarMap, type HolidayEntry, type HolidayApplicability,
  type WeeklyOff, type CompanyLite, type BranchLite, type DeptLite, type EmployeeLite,
  type HolidayType, type WeeklyMode, type ResolvedHoliday,
} from '@/lib/supabase-holidays'

// ── Style constant (project palette) ────────────────────────────────
const C = {
  page:    { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:    { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  lbl:     { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 } as React.CSSProperties,
  sec:     { fontSize:12, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:8 } as React.CSSProperties,
  input:   { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:     { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff', whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:     { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9', whiteSpace:'nowrap' as const } as React.CSSProperties,
  danger:  { padding:'5px 10px', borderRadius:7, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#DC2626' } as React.CSSProperties,
  tab:     (on: boolean) => ({ padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background: on ? '#7C3AED' : '#fff', color: on ? '#fff' : '#6D28D9', boxShadow: on ? 'none' : '0 1px 3px rgba(124,58,237,0.08)' }) as React.CSSProperties,
}
const TYPE_COLOR: Record<HolidayType, [string, string]> = {
  NATIONAL:['#E0E7FF','#3730A3'], FESTIVAL:['#FCE7F3','#9D174D'], DISCRETIONARY:['#FEF3C7','#92400E'],
  REGIONAL:['#DBEAFE','#1E40AF'], OPTIONAL:['#D1FAE5','#065F46'],
}
const fmt = (s?: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// ── Toast ───────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?'#059669':'#DC2626', color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'✓':'✗'} {msg}</div>
}
function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color }}>{text}</span>
}

// ══ TAB 1 · Calendars + company mapping ════════════════════════════
function CalendarsTab({ calendars, companies, maps, onCreate, onStatus, onDelete, onMap }: {
  calendars: HolidayCalendar[]; companies: CompanyLite[]; maps: CompanyCalendarMap[]
  onCreate: (i: { name: string; calendar_type: 'HOLIDAY' | 'LEAVE'; from_date: string; to_date: string }) => Promise<void>
  onStatus: (id: string, s: 'DRAFT' | 'PUBLISHED') => Promise<void>
  onDelete: (id: string) => Promise<void>
  onMap: (company_id: string, holiday: string | null, leave: string | null) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'HOLIDAY' | 'LEAVE'>('HOLIDAY')
  const [from, setFrom] = useState('2026-04-01')
  const [to, setTo] = useState('2027-03-31')
  const [busy, setBusy] = useState(false)
  const holCals = calendars.filter(c => c.calendar_type === 'HOLIDAY')
  const leaveCals = calendars.filter(c => c.calendar_type === 'LEAVE')

  return (
    <>
      <div style={C.card}>
        <div style={C.sec}>New calendar</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr auto', gap:10, alignItems:'flex-end' }}>
          <div><label style={C.lbl}>Name</label><input style={C.input} value={name} onChange={e => setName(e.target.value)} placeholder="FY 2026-27 Holiday Calendar" /></div>
          <div><label style={C.lbl}>Type</label><select style={C.input} value={type} onChange={e => setType(e.target.value as any)}><option value="HOLIDAY">HOLIDAY</option><option value="LEAVE">LEAVE</option></select></div>
          <div><label style={C.lbl}>From</label><input type="date" style={C.input} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label style={C.lbl}>To</label><input type="date" style={C.input} value={to} onChange={e => setTo(e.target.value)} /></div>
          <button disabled={busy || !name.trim()} style={{ ...C.pri, opacity: name.trim() ? 1 : 0.5 }}
            onClick={async () => { setBusy(true); await onCreate({ name: name.trim(), calendar_type: type, from_date: from, to_date: to }); setName(''); setBusy(false) }}>
            {busy ? '…' : '+ Create'}
          </button>
        </div>
      </div>

      <div style={C.card}>
        <div style={C.sec}>Calendars ({calendars.length})</div>
        {calendars.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No calendars yet. Create one above.</div>}
        {calendars.map(c => (
          <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
            <span style={{ fontSize:13, fontWeight:600 }}>{c.name}</span>
            <Badge text={c.calendar_type} bg="#EDE9FE" color="#7C3AED" />
            {c.status === 'PUBLISHED'
              ? <Badge text="PUBLISHED" bg="#D1FAE5" color="#065F46" />
              : <Badge text="DRAFT" bg="#F3F4F6" color="#6B7280" />}
            <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmt(c.from_date)} – {fmt(c.to_date)}</span>
            <span style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              {c.status === 'DRAFT'
                ? <button style={C.out} onClick={() => onStatus(c.id, 'PUBLISHED')}>Publish</button>
                : <button style={C.out} onClick={() => onStatus(c.id, 'DRAFT')}>Unpublish</button>}
              <button style={C.danger} onClick={() => { if (confirm(`Delete "${c.name}"? All of its holidays will be deleted too.`)) onDelete(c.id) }}>Delete</button>
            </span>
          </div>
        ))}
      </div>

      <div style={C.card}>
        <div style={C.sec}>Company → calendar mapping</div>
        <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:10 }}>Which holiday + leave calendar each company follows. (The holiday resolver runs off this mapping.)</div>
        {companies.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No company found.</div>}
        {companies.map(co => {
          const m = maps.find(x => x.company_id === co.id)
          return (
            <div key={co.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr', gap:10, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F3F0FF' }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{co.company_name} <span style={{ fontSize:11, color:'#9CA3AF' }}>{co.company_code}</span></div>
              <select style={C.input} value={m?.holiday_calendar_id || ''} onChange={e => onMap(co.id, e.target.value || null, m?.leave_calendar_id || null)}>
                <option value="">— Holiday calendar —</option>
                {holCals.map(hc => <option key={hc.id} value={hc.id}>{hc.name}</option>)}
              </select>
              <select style={C.input} value={m?.leave_calendar_id || ''} onChange={e => onMap(co.id, m?.holiday_calendar_id || null, e.target.value || null)}>
                <option value="">— Leave calendar —</option>
                {leaveCals.map(lc => <option key={lc.id} value={lc.id}>{lc.name}</option>)}
              </select>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ══ TAB 2 · Holidays ════════════════════════════════════════════════
function HolidaysTab({ calendars, companies, branches, weeklyOffs, selCal, setSelCal, holidays, appl, onAdd, onDelete }: {
  calendars: HolidayCalendar[]; companies: CompanyLite[]; branches: BranchLite[]; weeklyOffs: WeeklyOff[]
  selCal: string; setSelCal: (id: string) => void
  holidays: HolidayEntry[]; appl: HolidayApplicability[]
  onAdd: (i: any) => Promise<void>; onDelete: (id: string) => Promise<void>
}) {
  const holCals = calendars.filter(c => c.calendar_type === 'HOLIDAY')
  const coName = (id: string) => companies.find(c => c.id === id)?.company_name || id.slice(0, 6)
  const brName = (id: string | null) => id ? (branches.find(b => b.id === id)?.location_name || id.slice(0, 6)) : 'All branches'

  return (
    <>
      <div style={{ ...C.card, position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
        <label style={C.lbl}>Calendar</label>
        <select style={{ ...C.input, maxWidth:420 }} value={selCal} onChange={e => setSelCal(e.target.value)}>
          <option value="">— Select a holiday calendar —</option>
          {holCals.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
        </select>
      </div>

      {selCal && <AddHolidayForm calendar_id={selCal} companies={companies} branches={branches} weeklyOffs={weeklyOffs} onAdd={onAdd} />}

      {selCal && (
        <div style={C.card}>
          <div style={C.sec}>Holidays ({holidays.length})</div>
          {holidays.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No holidays in this calendar yet.</div>}
          {holidays.map(h => {
            const rows = appl.filter(a => a.holiday_id === h.id)
            const [bg, col] = TYPE_COLOR[h.holiday_type]
            return (
              <div key={h.id} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
                <div style={{ width:120, fontSize:12, fontWeight:600 }}>{fmt(h.holiday_date)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, fontWeight:600 }}>{h.description}</span>
                    <Badge text={h.holiday_type} bg={bg} color={col} />
                    {h.is_optional && <Badge text="OPTIONAL" bg="#FFEDD5" color="#9A3412" />}
                    {h.on_weekly_off && <Badge text="ON WEEKLY-OFF" bg="#FEE2E2" color="#991B1B" />}
                  </div>
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:3 }}>
                    {rows.length === 0 ? 'No applicability' : rows.map(r => `${coName(r.company_id)} · ${brName(r.branch_id)}`).join('  |  ')}
                  </div>
                </div>
                <button style={C.danger} onClick={() => { if (confirm('Delete this holiday?')) onDelete(h.id) }}>Delete</button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function AddHolidayForm({ calendar_id, companies, branches, weeklyOffs, onAdd }: {
  calendar_id: string; companies: CompanyLite[]; branches: BranchLite[]; weeklyOffs: WeeklyOff[]
  onAdd: (i: any) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState<HolidayType>('FESTIVAL')
  const [isOptional, setIsOptional] = useState(false)
  const [scopes, setScopes] = useState<{ company_id: string | null; branch_id: string | null }[]>([])
  const [pickCo, setPickCo] = useState('')
  const [pickBr, setPickBr] = useState('') // '' = all branches
  const [confirmWeekend, setConfirmWeekend] = useState(false)
  const [busy, setBusy] = useState(false)

  const addScope = () => {
    if (!pickCo) return
    // "All companies" → add one scope row per company (company_id is NOT NULL in the DB),
    // so the holiday genuinely applies to every company. Skips any already-added.
    if (pickCo === 'ALL') {
      setScopes(prev => {
        const next = [...prev]
        companies.forEach(c => {
          if (!next.some(s => s.company_id === c.id && s.branch_id === null)) next.push({ company_id: c.id, branch_id: null })
        })
        return next
      })
      setPickCo(''); setPickBr('')
      return
    }
    const row = { company_id: pickCo, branch_id: pickBr || null }
    if (scopes.some(s => s.company_id === row.company_id && s.branch_id === row.branch_id)) return
    setScopes([...scopes, row]); setPickBr('')
  }
  const coName = (id: string | null) => id ? (companies.find(c => c.id === id)?.company_name || id.slice(0, 6)) : 'All companies'
  const brName = (id: string | null) => id ? (branches.find(b => b.id === id)?.location_name || id.slice(0, 6)) : 'All branches'

  const conflict = date ? weekendConflict(date, weeklyOffs, scopes[0]?.company_id || null) : { conflict: false, weekday: '' }
  const ready = date && desc.trim() && scopes.length > 0
  const blockedByWeekend = conflict.conflict && !confirmWeekend

  async function save() {
    if (!ready) return
    setBusy(true)
    await onAdd({
      calendar_id, holiday_date: date, description: desc.trim(), holiday_type: type,
      is_optional: isOptional, on_weekly_off: conflict.conflict,
      applicability: scopes,
      override: conflict.conflict ? { weekday: conflict.weekday, confirmed_by: 'Admin', note: 'Weekend override confirmed' } : undefined,
    })
    setDate(''); setDesc(''); setType('FESTIVAL'); setIsOptional(false); setScopes([]); setConfirmWeekend(false)
    setBusy(false)
  }

  return (
    <div style={C.card}>
      <div style={C.sec}>Add holiday</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr', gap:10, marginBottom:10 }}>
        <div><label style={C.lbl}>Date</label><input type="date" style={C.input} value={date} onChange={e => { setDate(e.target.value); setConfirmWeekend(false) }} /></div>
        <div><label style={C.lbl}>Description</label><input style={C.input} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Diwali" /></div>
        <div><label style={C.lbl}>Type</label><select style={C.input} value={type} onChange={e => setType(e.target.value as HolidayType)}>{HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, marginBottom:10, cursor:'pointer' }}>
        <input type="checkbox" checked={isOptional} onChange={e => setIsOptional(e.target.checked)} /> Optional / restricted holiday (employee picks)
      </label>

      <div style={{ ...C.lbl, marginTop:4 }}>Applicability — company × branch</div>
      <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1.4fr auto', gap:8, marginBottom:8 }}>
        <select style={C.input} value={pickCo} onChange={e => { setPickCo(e.target.value); setPickBr('') }}>
          <option value="">— Company —</option>
          <option value="ALL">🌐 All companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select style={C.input} value={pickBr} onChange={e => setPickBr(e.target.value)} disabled={!pickCo}>
          <option value="">All branches</option>
          {branches.filter(b => b.company_id === pickCo).map(b => <option key={b.id} value={b.id}>{b.location_name}</option>)}
        </select>
        <button style={C.out} onClick={addScope} disabled={!pickCo}>+ Add scope</button>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
        {scopes.map((s, i) => (
          <span key={i} style={{ fontSize:11, background:'#F5F3FF', border:'1px solid #DDD6FE', borderRadius:99, padding:'3px 10px', display:'inline-flex', gap:6, alignItems:'center' }}>
            {coName(s.company_id)} · {brName(s.branch_id)}
            <span style={{ cursor:'pointer', color:'#DC2626', fontWeight:700 }} onClick={() => setScopes(scopes.filter((_, j) => j !== i))}>×</span>
          </span>
        ))}
        {scopes.length === 0 && <span style={{ fontSize:11, color:'#9CA3AF' }}>No scope — add at least one company.</span>}
      </div>

      {conflict.conflict && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:12, color:'#991B1B' }}>
          ⚠️ {fmt(date)} is a {conflict.weekday} — a weekly off in this scope. Add it anyway?
          <label style={{ display:'flex', alignItems:'center', gap:7, marginTop:7, cursor:'pointer', fontWeight:600 }}>
            <input type="checkbox" checked={confirmWeekend} onChange={e => setConfirmWeekend(e.target.checked)} /> Yes, confirm the weekend override (it goes into the audit log)
          </label>
        </div>
      )}

      <button disabled={!ready || blockedByWeekend || busy} style={{ ...C.pri, opacity: (ready && !blockedByWeekend) ? 1 : 0.5 }} onClick={save}>
        {busy ? '…' : '+ Add holiday'}
      </button>
    </div>
  )
}

// ══ TAB 3 · Weekly off ══════════════════════════════════════════════
function WeeklyOffTab({ calendars, companies, branches, departments, weeklyOffs, onAdd, onDelete }: {
  calendars: HolidayCalendar[]; companies: CompanyLite[]; branches: BranchLite[]; departments: DeptLite[]; weeklyOffs: WeeklyOff[]
  onAdd: (i: any) => Promise<void>; onDelete: (id: string) => Promise<void>
}) {
  const [weekday, setWeekday] = useState(0)
  const [mode, setMode] = useState<WeeklyMode>('EVERY')
  const [nth, setNth] = useState<number[]>([])
  const [isPrimary, setIsPrimary] = useState(false)
  const [calId, setCalId] = useState('')
  const [coId, setCoId] = useState('')
  const [brId, setBrId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [empType, setEmpType] = useState('')
  const [busy, setBusy] = useState(false)
  const coName = (id: string | null) => id ? (companies.find(c => c.id === id)?.company_name || id.slice(0, 6)) : 'All companies'
  const brName = (id: string | null) => id ? (branches.find(b => b.id === id)?.location_name || id.slice(0, 6)) : 'All branches'
  const deptName = (id: string | null) => id ? (departments.find(d => d.id === id)?.dept_name || id.slice(0, 6)) : 'All departments'

  const toggleNth = (n: number) => setNth(nth.includes(n) ? nth.filter(x => x !== n) : [...nth, n].sort())
  const ready = mode === 'EVERY' || nth.length > 0

  async function save() {
    setBusy(true)
    await onAdd({
      calendar_id: calId || null, weekday, mode, nth_occurrences: mode === 'NTH' ? nth : null,
      is_primary: isPrimary, company_id: coId || null, branch_id: brId || null, department_id: deptId || null, employment_type: empType || null,
    })
    setNth([]); setIsPrimary(false); setBusy(false)
  }

  return (
    <>
      <div style={C.card}>
        <div style={C.sec}>Add weekly-off rule</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={C.lbl}>Weekday</label><select style={C.input} value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
          <div><label style={C.lbl}>Mode</label><select style={C.input} value={mode} onChange={e => setMode(e.target.value as WeeklyMode)}><option value="EVERY">Every week</option><option value="NTH">Specific weeks (NTH)</option></select></div>
          <div><label style={C.lbl}>Calendar (optional)</label><select style={C.input} value={calId} onChange={e => setCalId(e.target.value)}><option value="">— none —</option>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={{ display:'flex', alignItems:'flex-end' }}>
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
              <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} /> Primary off
            </label>
          </div>
        </div>

        {mode === 'NTH' && (
          <div style={{ marginBottom:10 }}>
            <label style={C.lbl}>Which occurrences</label>
            <div style={{ display:'flex', gap:8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, cursor:'pointer', border:'1px solid #DDD6FE', borderRadius:7, padding:'5px 10px', background: nth.includes(n) ? '#EDE9FE' : '#fff' }}>
                  <input type="checkbox" checked={nth.includes(n)} onChange={() => toggleNth(n)} /> {n}{n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...C.lbl }}>Scope (blank = all)</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:10, alignItems:'flex-end' }}>
          <select style={C.input} value={coId} onChange={e => { setCoId(e.target.value); setBrId(''); setDeptId('') }}><option value="">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          <select style={C.input} value={brId} onChange={e => setBrId(e.target.value)} disabled={!coId}><option value="">All branches</option>{branches.filter(b => b.company_id === coId).map(b => <option key={b.id} value={b.id}>{b.location_name}</option>)}</select>
          <select style={C.input} value={deptId} onChange={e => setDeptId(e.target.value)} disabled={!coId}><option value="">All departments</option>{departments.filter(d => d.company_id === coId).map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</select>
          <input style={C.input} value={empType} onChange={e => setEmpType(e.target.value)} placeholder="Employment type (blank = all)" />
          <button disabled={!ready || busy} style={{ ...C.pri, opacity: ready ? 1 : 0.5 }} onClick={save}>{busy ? '…' : '+ Add rule'}</button>
        </div>
      </div>

      <div style={C.card}>
        <div style={C.sec}>Weekly-off rules ({weeklyOffs.length})</div>
        {weeklyOffs.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No rules.</div>}
        {weeklyOffs.map(w => (
          <div key={w.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
            <span style={{ fontWeight:600, width:90 }}>{WEEKDAYS[w.weekday]}</span>
            <Badge text={w.mode === 'EVERY' ? 'EVERY WEEK' : `WEEKS ${(w.nth_occurrences || []).join(',')}`} bg="#EDE9FE" color="#7C3AED" />
            {w.is_primary && <Badge text="PRIMARY" bg="#D1FAE5" color="#065F46" />}
            <span style={{ color:'#9CA3AF' }}>{coName(w.company_id)} · {brName(w.branch_id)} · {deptName(w.department_id)}{w.employment_type ? ` · ${w.employment_type}` : ''}</span>
            <button style={{ ...C.danger, marginLeft:'auto' }} onClick={() => onDelete(w.id)}>Delete</button>
          </div>
        ))}
      </div>
    </>
  )
}

// ══ TAB 4 · Employee preview (resolver proof / ESS view) ════════════
function PreviewTab({ employees, companies, notify }: { employees: EmployeeLite[]; companies: CompanyLite[]; notify: (m: string, t?: 'success' | 'error') => void }) {
  const [empId, setEmpId] = useState('')
  const [month, setMonth] = useState(ym(new Date()))
  const [hols, setHols] = useState<ResolvedHoliday[]>([])
  const [offs, setOffs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const coName = (id: string) => companies.find(c => c.id === id)?.company_name || '—'

  async function run() {
    if (!empId) return
    setLoading(true)
    try {
      const [y, m] = month.split('-').map(Number)
      const from = `${month}-01`
      const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
      const [h, o] = await Promise.all([resolveHolidays(empId), resolveWeeklyOffs(empId, from, to)])
      setHols(h); setOffs(o)
    } catch (e: any) { notify('Resolve failed: ' + (e?.message || 'check migration 026'), 'error') }
    setLoading(false)
  }

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstDow = new Date(y, m - 1, 1).getDay()
  const offSet = new Set(offs)
  const holMap = new Map(hols.filter(h => h.holiday_date.startsWith(month)).map(h => [h.holiday_date, h]))
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <>
      <div style={C.card}>
        <div style={C.sec}>Employee preview — what they’ll see in ESS</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr auto', gap:10, alignItems:'flex-end' }}>
          <div><label style={C.lbl}>Employee</label>
            <select style={C.input} value={empId} onChange={e => setEmpId(e.target.value)}>
              <option value="">— Select employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_code}) · {coName(e.company_id)}</option>)}
            </select>
          </div>
          <div><label style={C.lbl}>Month</label><input type="month" style={C.input} value={month} onChange={e => setMonth(e.target.value)} /></div>
          <button disabled={!empId || loading} style={{ ...C.pri, opacity: empId ? 1 : 0.5 }} onClick={run}>{loading ? '…' : 'Resolve'}</button>
        </div>
        <div style={{ fontSize:11, color:'#9CA3AF', marginTop:8 }}>Live from the resolver functions — for this company + branch, only PUBLISHED calendar holidays plus scoped weekly offs.</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:10 }}>
        <div style={C.card}>
          <div style={C.sec}>Weekly off — {new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month:'long', year:'numeric' })}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:4 }}>
            {WEEKDAYS.map(d => <div key={d} style={{ fontSize:10, fontWeight:600, color:'#9CA3AF', textAlign:'center', padding:'4px 0' }}>{d.slice(0, 3)}</div>)}
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />
              const ds = `${month}-${String(day).padStart(2, '0')}`
              const isOff = offSet.has(ds)
              const isHol = holMap.has(ds)
              return (
                <div key={i} title={isHol ? holMap.get(ds)!.description : ''} style={{ textAlign:'center', padding:'8px 0', borderRadius:6, fontSize:12, fontWeight: (isOff || isHol) ? 600 : 400, background: isHol ? '#FCE7F3' : isOff ? '#F3F4F6' : '#fff', color: isHol ? '#9D174D' : isOff ? '#9CA3AF' : '#1E1B4B', border:'1px solid #F3F0FF' }}>{day}</div>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:14, marginTop:10, fontSize:11, color:'#6B7280' }}>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#F3F4F6', borderRadius:3, marginRight:4 }} />Weekly off</span>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#FCE7F3', borderRadius:3, marginRight:4 }} />Holiday</span>
          </div>
        </div>

        <div style={C.card}>
          <div style={C.sec}>Holidays ({hols.length})</div>
          {hols.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>{empId ? 'Press Resolve, or there is no mapped holiday.' : 'Select an employee.'}</div>}
          {hols.map((h, i) => {
            const [bg, col] = TYPE_COLOR[h.holiday_type]
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderBottom:'1px solid #F3F0FF' }}>
                <span style={{ width:110, fontSize:12, fontWeight:600 }}>{fmt(h.holiday_date)}</span>
                <span style={{ flex:1, fontSize:13 }}>{h.description}</span>
                <Badge text={h.holiday_type} bg={bg} color={col} />
                {h.is_optional ? <Badge text="OPTIONAL" bg="#FFEDD5" color="#9A3412" /> : <Badge text="FIXED" bg="#F3F4F6" color="#6B7280" />}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
export function HolidaysSection() {
  const [tab, setTab] = useState<'cal' | 'hol' | 'week' | 'prev'>('cal')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const [calendars, setCalendars] = useState<HolidayCalendar[]>([])
  const [companies, setCompanies] = useState<CompanyLite[]>([])
  const [branches, setBranches] = useState<BranchLite[]>([])
  const [departments, setDepartments] = useState<DeptLite[]>([])
  const [employees, setEmployees] = useState<EmployeeLite[]>([])
  const [maps, setMaps] = useState<CompanyCalendarMap[]>([])
  const [weeklyOffs, setWeeklyOffs] = useState<WeeklyOff[]>([])
  // holidays tab
  const [selCal, setSelCal] = useState('')
  const [holidays, setHolidays] = useState<HolidayEntry[]>([])
  const [appl, setAppl] = useState<HolidayApplicability[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [c, co, b, d, e, mp, w] = await Promise.all([
        listCalendars(), listCompanies(), listBranches(), listDepartments(), listEmployees(), listCompanyMaps(), listWeeklyOffs(),
      ])
      setCalendars(c); setCompanies(co); setBranches(b); setDepartments(d); setEmployees(e); setMaps(mp); setWeeklyOffs(w)
    } catch (err: any) { notify('Load failed: ' + (err?.message || 'check migration 026'), 'error') }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  const reloadHolidays = useCallback(async (calId: string) => {
    if (!calId) { setHolidays([]); setAppl([]); return }
    const h = await listHolidays(calId)
    setHolidays(h)
    setAppl(await listApplicability(h.map(x => x.id)))
  }, [])
  useEffect(() => { reloadHolidays(selCal) }, [selCal, reloadHolidays])

  // ── handlers ──
  async function hCreateCal(i: any) { const { error } = await createCalendar(i); if (error) return notify('Failed: ' + error.message, 'error'); notify('Calendar created.'); reload() }
  async function hStatus(id: string, s: 'DRAFT' | 'PUBLISHED') { const { error } = await setCalendarStatus(id, s); if (error) return notify('Failed: ' + error.message, 'error'); notify(s === 'PUBLISHED' ? 'Published — ESS pe live.' : 'Unpublished.'); reload() }
  async function hDeleteCal(id: string) { const { error } = await deleteCalendar(id); if (error) return notify('Failed: ' + error.message, 'error'); notify('Deleted.'); if (selCal === id) setSelCal(''); reload() }
  async function hMap(company_id: string, holiday: string | null, leave: string | null) { const { error } = await upsertCompanyMap({ company_id, holiday_calendar_id: holiday, leave_calendar_id: leave }); if (error) return notify('Failed: ' + error.message, 'error'); notify('Mapping saved.'); reload() }
  async function hAddHoliday(i: any) { const r = await createHoliday(i); if ((r as any).error) return notify('Failed: ' + (r as any).error.message, 'error'); notify('Holiday added.'); reloadHolidays(selCal) }
  async function hDeleteHoliday(id: string) { const { error } = await deleteHoliday(id); if (error) return notify('Failed: ' + error.message, 'error'); notify('Holiday deleted.'); reloadHolidays(selCal) }
  async function hAddWeekly(i: any) { const { error } = await createWeeklyOff(i); if (error) return notify('Failed: ' + error.message, 'error'); notify('Weekly-off rule added.'); reload() }
  async function hDeleteWeekly(id: string) { const { error } = await deleteWeeklyOff(id); if (error) return notify('Failed: ' + error.message, 'error'); notify('Rule deleted.'); reload() }

  const tabs: [typeof tab, string][] = [['cal', 'Calendars'], ['hol', 'Holidays'], ['week', 'Weekly Off'], ['prev', 'Employee Preview']]

  return (
    <>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Holiday &amp; Weekly-off Configuration</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:14 }}>Attendance &amp; Leave config layer — calendars, holidays (branch-wise), weekly offs. Only a PUBLISHED calendar reaches ESS.</div>

        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {tabs.map(([k, label]) => <button key={k} style={C.tab(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
        </div>

        {loading ? <div style={{ ...C.card, textAlign:'center', color:'#7C3AED', padding:40 }}>Loading…</div> : (
          <>
            {tab === 'cal' && <CalendarsTab calendars={calendars} companies={companies} maps={maps} onCreate={hCreateCal} onStatus={hStatus} onDelete={hDeleteCal} onMap={hMap} />}
            {tab === 'hol' && <HolidaysTab calendars={calendars} companies={companies} branches={branches} weeklyOffs={weeklyOffs} selCal={selCal} setSelCal={setSelCal} holidays={holidays} appl={appl} onAdd={hAddHoliday} onDelete={hDeleteHoliday} />}
            {tab === 'week' && <WeeklyOffTab calendars={calendars} companies={companies} branches={branches} departments={departments} weeklyOffs={weeklyOffs} onAdd={hAddWeekly} onDelete={hDeleteWeekly} />}
            {tab === 'prev' && <PreviewTab employees={employees} companies={companies} notify={notify} />}
          </>
        )}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

export default function HolidaysPage() {
  return (
    <div style={{ ...C.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1200, margin:'0 auto' }}>
        <HolidaysSection />
      </div>
    </div>
  )
}
