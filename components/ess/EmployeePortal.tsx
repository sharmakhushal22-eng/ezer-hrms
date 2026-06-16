'use client'
// components/ess/EmployeePortal.tsx — ESS Employee Portal (Phase 2).
// Responsive shell + functional low-dependency modules (Home, Profile, Documents/
// Letters, Requests, Directory, Notifications). Payroll/Leave/Attendance/PMS show
// labeled placeholders until those upstream modules exist (Phase 3/4).
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback } from 'react'
import {
  loadEmployeeDetail, loadDirectory, loadNotifications, markNotification, markAllNotifications,
  loadServiceRequests, createServiceRequest, loadLetterRequests, createLetterRequest,
  loadAnnouncements, loadKudos,
  type EmployeeDetail, type DirectoryEntry, type EssNotification,
  type ServiceRequest, type LetterRequest, type Announcement, type Kudo,
} from '@/lib/supabase-ess'

// ── Styles ─────────────────────────────────────────────────────────
const T = {
  card:  { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  btnP:  { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' } as React.CSSProperties,
  btnO:  { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9' } as React.CSSProperties,
  section: { fontSize:12, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10, display:'flex', alignItems:'center', gap:8 } as React.CSSProperties,
}
const fmt = (s?: string|null) => s ? new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const fmtDT = (s?: string|null) => s ? new Date(s).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—'
const initials = (n: string) => n.split(' ').filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase()
const QUOTES = [
  'Small steps every day lead to big results.',
  'Your work today builds tomorrow.',
  'Progress, not perfection.',
  'Great things take time — keep going.',
  'Be the energy you want to attract.',
]

function StatusPill({ status }: { status: string }) {
  const map: Record<string,[string,string]> = {
    PENDING:['#FFFBEB','#B45309'], IN_REVIEW:['#EFF6FF','#1D4ED8'], APPROVED:['#ECFDF5','#059669'],
    REJECTED:['#FEF2F2','#DC2626'], COMPLETED:['#F0FDF4','#16A34A'], REQUESTED:['#FFFBEB','#B45309'],
    GENERATED:['#ECFDF5','#059669'],
  }
  const [bg,c] = map[status] || ['#F3F0FF','#6D28D9']
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{status}</span>
}

// ════════════════════════════════════════════════════════════════
// HOME (B0) — feel-good dashboard
// ════════════════════════════════════════════════════════════════
function Home({ emp, isMobile, go, salaryVisible }: { emp: EmployeeDetail; isMobile: boolean; go: (k: string) => void; salaryVisible: boolean }) {
  const [ann, setAnn] = useState<Announcement[]>([])
  const [kudos, setKudos] = useState<Kudo[]>([])
  const [pending, setPending] = useState(0)
  useEffect(() => {
    loadAnnouncements().then(setAnn)
    loadKudos(emp.id).then(setKudos)
    Promise.all([loadServiceRequests(emp.id), loadLetterRequests(emp.id)]).then(([s, l]) =>
      setPending(s.filter(r => r.status === 'PENDING' || r.status === 'IN_REVIEW').length + l.filter(r => r.status === 'REQUESTED').length))
  }, [emp.id])

  const h = new Date().getHours()
  const greet = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : h < 21 ? 'Good Evening' : 'Working late'
  const emoji = h < 12 ? '☀️' : h < 17 ? '🌤️' : h < 21 ? '🌆' : '🌙'
  const quote = QUOTES[new Date().getDate() % QUOTES.length]
  const tenureYrs = emp.group_doj ? Math.floor((Date.now() - new Date(emp.group_doj).getTime()) / (365.25*24*3600*1000)) : 0
  const dob = emp.date_of_birth ? new Date(emp.date_of_birth) : null
  const bdaySoon = dob ? (() => { const n = new Date(); const t = new Date(n.getFullYear(), dob.getMonth(), dob.getDate()); const d = Math.ceil((t.getTime() - n.getTime())/86400000); return d >= -1 && d <= 30 ? d : null })() : null

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={T.card}><div style={{ fontSize:11, color:'#9CA3AF', fontWeight:600, textTransform:'uppercase' }}>{label}</div><div style={{ fontSize:18, fontWeight:700, marginTop:3, color: color || '#1E1B4B' }}>{value}</div></div>
  )

  return (
    <div>
      <div style={{ ...T.card, borderLeft:'3px solid #7C3AED', display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, flexShrink:0 }}>{initials(emp.full_name)}</div>
        <div>
          <div style={{ fontSize:17, fontWeight:700 }}>{greet}, {emp.first_name || emp.full_name.split(' ')[0]}! {emoji}</div>
          <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{emp.designation || '—'} · {emp.emp_code}</div>
          <div style={{ fontSize:12, color:'#7C3AED', marginTop:4, fontStyle:'italic' }}>“{quote}”</div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:10 }}>
        <Stat label="Leave Balance" value="—" color="#9CA3AF" />
        <Stat label="Net Salary" value={salaryVisible ? '—' : '🔒 Hidden'} color="#9CA3AF" />
        <Stat label="Attendance %" value="—" color="#9CA3AF" />
        <Stat label="Pending Actions" value={String(pending)} color={pending ? '#D97706' : '#059669'} />
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
        <button onClick={() => go('leave')} style={T.btnO}>🌴 Apply Leave</button>
        <button onClick={() => go('payroll')} style={T.btnO}>💰 Download Payslip</button>
        <button onClick={() => go('requests')} style={T.btnO}>✉️ Raise Ticket</button>
        <button onClick={() => go('directory')} style={T.btnO}>📒 View Team</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:10 }}>
        {/* Birthday / Anniversary */}
        <div style={T.card}>
          <div style={T.section}>🎉 Birthday & Anniversary</div>
          {bdaySoon !== null
            ? <div style={{ fontSize:13 }}>🎂 Your birthday is {bdaySoon <= 0 ? 'today!' : `in ${bdaySoon} day(s)`} — wishing you ahead!</div>
            : <div style={{ fontSize:12, color:'#9CA3AF' }}>No upcoming birthdays in the next 30 days.</div>}
          {emp.group_doj && <div style={{ fontSize:12, color:'#6B7280', marginTop:6 }}>Joined {fmt(emp.group_doj)} · {tenureYrs} yr{tenureYrs===1?'':'s'} with us 🎊</div>}
        </div>

        {/* My Journey */}
        <div style={T.card}>
          <div style={T.section}>🚀 My Journey</div>
          <div style={{ fontSize:12, color:'#374151', lineHeight:1.9 }}>
            <div>📅 Joined: <b>{fmt(emp.group_doj)}</b></div>
            <div>🏷️ Designation: <b>{emp.designation || '—'}</b></div>
            <div>⏳ Tenure: <b>{tenureYrs} year{tenureYrs===1?'':'s'}</b></div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' }}>
              {[1,3,5].map(y => <span key={y} style={{ fontSize:10, padding:'2px 9px', borderRadius:99, fontWeight:600, background: tenureYrs>=y?'#ECFDF5':'#F1F5F9', color: tenureYrs>=y?'#059669':'#9CA3AF' }}>{tenureYrs>=y?'🏅':'🔒'} {y}-yr</span>)}
            </div>
          </div>
        </div>

        {/* Kudos */}
        <div style={T.card}>
          <div style={T.section}>👏 Recognition & Kudos</div>
          {kudos.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No kudos yet — appreciation from peers will show here.</div>}
          {kudos.map(k => <div key={k.id} style={{ fontSize:12, padding:'6px 0', borderBottom:'1px solid #F3F0FF' }}>{k.badge ? `🏆 ${k.badge} — ` : ''}{k.message || 'Kudos!'}<span style={{ color:'#9CA3AF', fontSize:10, marginLeft:6 }}>{fmt(k.created_at)}</span></div>)}
        </div>

        {/* Announcements */}
        <div style={T.card}>
          <div style={T.section}>📣 Announcements</div>
          {ann.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No announcements right now.</div>}
          {ann.map(a => <div key={a.id} style={{ padding:'7px 0', borderBottom:'1px solid #F3F0FF' }}><div style={{ fontSize:12.5, fontWeight:600 }}>{a.title}</div>{a.body && <div style={{ fontSize:11.5, color:'#6B7280', marginTop:2 }}>{a.body}</div>}<div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>{fmt(a.published_at)}</div></div>)}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// PROFILE & KYC (B4)
// ════════════════════════════════════════════════════════════════
function Profile({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const [field, setField] = useState('Personal Details')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const FIELDS = ['Personal Details','PAN Card','Aadhaar','Bank Account','Emergency Contact','Family / Dependents','Nominee','Education']
  const Row = ({ k, v }: { k: string; v: any }) => (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F3F0FF', fontSize:12.5 }}><span style={{ color:'#6B7280' }}>{k}</span><span style={{ fontWeight:600 }}>{v || '—'}</span></div>
  )
  async function submit() {
    if (!detail.trim()) { notify('Describe what to update', 'error'); return }
    setBusy(true)
    const { error } = await createServiceRequest(emp.id, 'PROFILE_UPDATE', { field, detail }, { assigned_to: 'HR' })
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    setDetail(''); notify('Update request sent to HR for approval.')
  }
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10 }}>
      <div style={T.card}>
        <div style={T.section}>👤 My Profile</div>
        <Row k="Name" v={emp.full_name} /><Row k="Employee Code" v={emp.emp_code} />
        <Row k="Designation" v={emp.designation} /><Row k="Department" v={emp.dept_name} />
        <Row k="Company" v={emp.company_name} /><Row k="Location" v={[emp.location_name, emp.city].filter(Boolean).join(', ')} />
        <Row k="Date of Joining" v={fmt(emp.group_doj)} /><Row k="Employment Type" v={emp.employment_type} />
        <Row k="Reporting Manager" v={emp.l1_manager_name} /><Row k="HR" v={emp.hr_manager_name} />
      </div>
      <div style={T.card}>
        <div style={T.section}>🪪 KYC & Personal</div>
        <Row k="Gender" v={emp.gender} /><Row k="Date of Birth" v={fmt(emp.date_of_birth)} />
        <Row k="Blood Group" v={emp.blood_group} /><Row k="Marital Status" v={emp.marital_status} />
        <Row k="Mobile" v={emp.mobile} /><Row k="Personal Email" v={emp.personal_email} /><Row k="Office Email" v={emp.office_email} />
        <Row k="PAN" v={emp.pan_number} /><Row k="Aadhaar" v={emp.aadhar_last4 ? `XXXX XXXX ${emp.aadhar_last4}` : '—'} /><Row k="UAN" v={emp.uan_number} />
      </div>
      <div style={T.card}>
        <div style={T.section}>✏️ Request an Update (→ HR approval)</div>
        <label style={T.label}>What to update</label>
        <select style={{ ...T.input, marginBottom:10 }} value={field} onChange={e => setField(e.target.value)}>{FIELDS.map(f => <option key={f}>{f}</option>)}</select>
        <label style={T.label}>Details</label>
        <textarea style={{ ...T.input, minHeight:80, marginBottom:10, resize:'vertical' }} value={detail} onChange={e => setDetail(e.target.value)} placeholder="New value / what changed…" />
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, opacity: busy?.6:1 }}>{busy ? 'Sending…' : 'Submit update request'}</button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// DOCUMENTS & LETTERS (B5)
// ════════════════════════════════════════════════════════════════
const LETTER_TYPES = ['Salary Certificate','Experience Letter','Address/Employment Verification','Bonafide Certificate','NOC','Visa / Travel Letter','Bank Loan Letter','Relieving Letter','PF Transfer Letter','Custom Request']
function Documents({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const [rows, setRows] = useState<LetterRequest[]>([])
  const [type, setType] = useState(LETTER_TYPES[0])
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => loadLetterRequests(emp.id).then(setRows), [emp.id])
  useEffect(() => { load() }, [load])
  async function submit() {
    setBusy(true)
    const { error } = await createLetterRequest(emp.id, type, purpose, '')
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    setPurpose(''); notify('Letter request sent to HR.'); load()
  }
  return (
    <div>
      <div style={T.card}>
        <div style={T.section}>📄 Request a Letter (HR generates on approval)</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={T.label}>Letter type</label><select style={T.input} value={type} onChange={e => setType(e.target.value)}>{LETTER_TYPES.map(l => <option key={l}>{l}</option>)}</select></div>
          <div><label style={T.label}>Purpose</label><input style={T.input} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. bank loan, visa…" /></div>
        </div>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, opacity: busy?.6:1 }}>{busy ? 'Sending…' : 'Request letter'}</button>
      </div>
      <div style={T.card}>
        <div style={T.section}>🗂️ My Letter Requests</div>
        {rows.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No requests yet.</div>}
        {rows.map(r => (
          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
            <div><div style={{ fontSize:13, fontWeight:600 }}>{r.letter_type}</div><div style={{ fontSize:11, color:'#9CA3AF' }}>{r.purpose || '—'} · {fmt(r.requested_at)}</div></div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <StatusPill status={r.status} />
              {r.letter_url && <a href={r.letter_url} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration:'none' }}>Download</a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SELF-SERVICE REQUESTS (B9)
// ════════════════════════════════════════════════════════════════
const REQ_TYPES: { k: string; label: string; confidential?: boolean; assigned?: string }[] = [
  { k:'LOAN', label:'Loan / Advance Salary' }, { k:'RESIGNATION', label:'Exit / Resignation' },
  { k:'NOMINEE', label:'Nominee Update' }, { k:'INSURANCE_CHANGE', label:'Insurance Family Change' },
  { k:'MARRIAGE', label:'Marriage Detail Update' }, { k:'EMERGENCY', label:'Emergency / SOS' },
  { k:'BLOOD_DONATION', label:'Blood Donation Request' },
  { k:'POSH', label:'POSH Complaint (Confidential)', confidential:true, assigned:'IC' },
]
function Requests({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const [rows, setRows] = useState<ServiceRequest[]>([])
  const [type, setType] = useState(REQ_TYPES[0].k)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const def = REQ_TYPES.find(r => r.k === type)!
  const load = useCallback(() => loadServiceRequests(emp.id).then(setRows), [emp.id])
  useEffect(() => { load() }, [load])
  async function submit() {
    if (!detail.trim()) { notify('Please add details', 'error'); return }
    setBusy(true)
    const { error } = await createServiceRequest(emp.id, type, { detail }, { is_confidential: def.confidential, assigned_to: def.assigned || 'HR' })
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    setDetail(''); notify(def.confidential ? 'Confidential request sent to the Internal Committee.' : 'Request submitted.'); load()
  }
  return (
    <div>
      <div style={T.card}>
        <div style={T.section}>✉️ Raise a Request</div>
        <label style={T.label}>Type</label>
        <select style={{ ...T.input, marginBottom:10 }} value={type} onChange={e => setType(e.target.value)}>{REQ_TYPES.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}</select>
        {def.confidential && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:7, padding:'8px 11px', marginBottom:10, fontSize:12, color:'#B91C1C' }}>🔒 This is confidential and routes only to the Internal Committee — not regular HR.</div>}
        <label style={T.label}>Details</label>
        <textarea style={{ ...T.input, minHeight:90, marginBottom:10, resize:'vertical' }} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Describe your request…" />
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, opacity: busy?.6:1 }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
      <div style={T.card}>
        <div style={T.section}>📋 My Requests</div>
        {rows.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No requests yet.</div>}
        {rows.map(r => (
          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
            <div><div style={{ fontSize:13, fontWeight:600 }}>{REQ_TYPES.find(x => x.k === r.request_type)?.label || r.request_type}{r.is_confidential && ' 🔒'}</div><div style={{ fontSize:11, color:'#9CA3AF' }}>{r.request_data?.detail?.slice(0,60) || '—'} · {fmt(r.submitted_at)}</div></div>
            <StatusPill status={r.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// DIRECTORY (B10)
// ════════════════════════════════════════════════════════════════
function Directory({ isMobile }: { isMobile: boolean }) {
  const [rows, setRows] = useState<DirectoryEntry[]>([])
  const [q, setQ] = useState('')
  useEffect(() => { loadDirectory().then(setRows) }, [])
  const filtered = rows.filter(e => !q || e.full_name.toLowerCase().includes(q.toLowerCase()) || (e.designation||'').toLowerCase().includes(q.toLowerCase()) || (e.dept_name||'').toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <div style={T.card}><input style={T.input} placeholder="🔍 Search name / designation / department" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap:10 }}>
        {filtered.map(e => (
          <div key={e.id} style={T.card}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:40, height:40, borderRadius:'50%', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13, flexShrink:0 }}>{initials(e.full_name)}</div>
              <div style={{ minWidth:0 }}><div style={{ fontSize:13, fontWeight:600 }}>{e.full_name}</div><div style={{ fontSize:11, color:'#9CA3AF' }}>{e.designation || '—'} · {e.dept_name || '—'}</div></div>
            </div>
            <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
              {(e.office_email || e.personal_email) && <a href={`mailto:${e.office_email || e.personal_email}`} style={{ ...T.btnO, textDecoration:'none' }}>📧 Email</a>}
              {e.mobile && <a href={`tel:${e.mobile}`} style={{ ...T.btnO, textDecoration:'none' }}>📱 Call</a>}
              {e.mobile && <a href={`https://wa.me/91${(e.mobile||'').replace(/\D/g,'').slice(-10)}`} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration:'none' }}>WhatsApp</a>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ ...T.card, color:'#9CA3AF', textAlign:'center' }}>No matches.</div>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// NOTIFICATIONS (B11)
// ════════════════════════════════════════════════════════════════
function Notifications({ emp }: { emp: EmployeeDetail }) {
  const [rows, setRows] = useState<EssNotification[]>([])
  const load = useCallback(() => loadNotifications(emp.id).then(setRows), [emp.id])
  useEffect(() => { load() }, [load])
  return (
    <div style={T.card}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={T.section}>🔔 Notifications</div>
        <button onClick={async () => { await markAllNotifications(emp.id); load() }} style={T.btnO}>Mark all read</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF', padding:'8px 0' }}>You're all caught up. 🎉</div>}
      {rows.map(n => (
        <div key={n.id} onClick={async () => { if (!n.is_read) { await markNotification(n.id); load() } }} style={{ padding:'9px 0', borderBottom:'1px solid #F3F0FF', cursor: n.is_read ? 'default' : 'pointer', opacity: n.is_read ? .6 : 1 }}>
          <div style={{ fontSize:13, fontWeight:600 }}>{!n.is_read && <span style={{ color:'#7C3AED' }}>● </span>}{n.title}</div>
          {n.body && <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{n.body}</div>}
          <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>{n.category || ''} · {fmtDT(n.created_at)}</div>
        </div>
      ))}
    </div>
  )
}

// Placeholder for Phase 3/4 modules
function Placeholder({ title, phase, needs }: { title: string; phase: number; needs: string }) {
  return (
    <div style={{ ...T.card, textAlign:'center', padding:40 }}>
      <div style={{ fontSize:38, marginBottom:8 }}>🚧</div>
      <div style={{ fontSize:16, fontWeight:600 }}>{title}</div>
      <div style={{ fontSize:13, color:'#6B7280', marginTop:6, lineHeight:1.7 }}>Coming in Phase {phase}. This module needs the <b>{needs}</b> module's data, which isn't built yet.</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SHELL
// ════════════════════════════════════════════════════════════════
const MODULES = [
  { k:'home',          label:'Home',         icon:'🏠', phase:2 },
  { k:'payroll',       label:'Payroll',      icon:'💰', phase:3, needs:'Payroll' },
  { k:'attendance',    label:'Attendance',   icon:'🗓️', phase:3, needs:'Attendance' },
  { k:'leave',         label:'Leave',        icon:'🌴', phase:3, needs:'Leave' },
  { k:'profile',       label:'Profile',      icon:'👤', phase:2 },
  { k:'documents',     label:'Documents',    icon:'📄', phase:2 },
  { k:'claims',        label:'Claims',       icon:'🧾', phase:3, needs:'Claims/Payroll' },
  { k:'pms',           label:'Performance',  icon:'📈', phase:4, needs:'Performance' },
  { k:'statutory',     label:'Statutory',    icon:'🏛️', phase:3, needs:'Payroll' },
  { k:'requests',      label:'Requests',     icon:'✉️', phase:2 },
  { k:'directory',     label:'Directory',    icon:'📒', phase:2 },
  { k:'notifications', label:'Notifications',icon:'🔔', phase:2 },
  { k:'nayan',         label:'Nayan AI',     icon:'🤖', phase:4, needs:'Gemini AI' },
]
const MOBILE_PRIMARY = ['home','payroll','leave','profile']

export default function EmployeePortal({ employeeId, adminMode, onExit }: { employeeId: string; adminMode?: boolean; onExit?: () => void }) {
  const [emp, setEmp] = useState<EmployeeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('home')
  const [isMobile, setIsMobile] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success'|'error' } | null>(null)
  const notify = (msg: string, type: 'success'|'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check)
  }, [])
  useEffect(() => { setLoading(true); loadEmployeeDetail(employeeId).then(e => { setEmp(e); setLoading(false) }) }, [employeeId])

  const go = (k: string) => { setView(k); setMoreOpen(false) }
  const salaryVisible = false // role-based salary visibility wired with auth in a later pass

  const renderView = () => {
    if (!emp) return null
    const m = MODULES.find(x => x.k === view)!
    switch (view) {
      case 'home':          return <Home emp={emp} isMobile={isMobile} go={go} salaryVisible={salaryVisible} />
      case 'profile':       return <Profile emp={emp} notify={notify} />
      case 'documents':     return <Documents emp={emp} notify={notify} />
      case 'requests':      return <Requests emp={emp} notify={notify} />
      case 'directory':     return <Directory isMobile={isMobile} />
      case 'notifications': return <Notifications emp={emp} />
      default:              return <Placeholder title={m.label} phase={m.phase} needs={(m as any).needs || '—'} />
    }
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'#7C3AED', fontFamily:'"DM Sans",sans-serif' }}>Loading portal…</div>
  if (!emp) return <div style={{ padding:40, textAlign:'center', color:'#DC2626', fontFamily:'"DM Sans",sans-serif' }}>Employee not found.</div>

  return (
    <div style={{ minHeight:'100vh', background:'#F5F3FF', fontFamily:'"DM Sans","Segoe UI",sans-serif', color:'#1E1B4B', display:'flex', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <div style={{ width:210, background:'#fff', borderRight:'1px solid #EDE9FE', padding:'16px 10px', position:'sticky', top:0, height:'100vh', overflowY:'auto', flexShrink:0 }}>
          <div style={{ fontSize:15, fontWeight:700, padding:'0 8px 12px' }}>EZER · ESS</div>
          {MODULES.map(m => (
            <button key={m.k} onClick={() => go(m.k)} style={{ width:'100%', textAlign:'left', padding:'9px 10px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13, marginBottom:2, background: view===m.k ? '#EDE9FE' : 'transparent', color: view===m.k ? '#6D28D9' : '#374151', fontWeight: view===m.k ? 600 : 500, display:'flex', alignItems:'center', gap:9 }}>
              <span>{m.icon}</span>{m.label}{m.phase>2 && <span style={{ marginLeft:'auto', fontSize:8, color:'#9CA3AF' }}>P{m.phase}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex:1, minWidth:0, paddingBottom: isMobile ? 70 : 0 }}>
        {/* Top bar */}
        <div style={{ background:'#fff', borderBottom:'1px solid #EDE9FE', padding: isMobile ? '12px 14px' : '12px 22px', display:'flex', alignItems:'center', gap:10, position:'sticky', top:0, zIndex:5 }}>
          <div style={{ fontSize: isMobile ? 15 : 16, fontWeight:600 }}>{MODULES.find(m => m.k === view)?.label}</div>
          {adminMode && <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:'#FEF3C7', color:'#92400E', fontWeight:600 }}>Admin viewing {emp.first_name || emp.full_name}</span>}
          {onExit && <button onClick={onExit} style={{ marginLeft:'auto', ...T.btnO }}>{adminMode ? 'Exit Admin Mode' : 'Close'}</button>}
        </div>

        <div style={{ padding: isMobile ? '14px 12px' : '18px 22px', maxWidth:1100 }}>{renderView()}</div>
      </div>

      {/* Mobile bottom bar */}
      {isMobile && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'#fff', borderTop:'1px solid #EDE9FE', display:'flex', zIndex:20 }}>
          {MOBILE_PRIMARY.map(k => { const m = MODULES.find(x => x.k === k)!; return (
            <button key={k} onClick={() => go(k)} style={{ flex:1, padding:'9px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: view===k ? '#7C3AED' : '#9CA3AF', fontWeight: view===k ? 600 : 500 }}>
              <div style={{ fontSize:18 }}>{m.icon}</div>{m.label}
            </button>
          )})}
          <button onClick={() => setMoreOpen(o => !o)} style={{ flex:1, padding:'9px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: moreOpen ? '#7C3AED' : '#9CA3AF', fontWeight:500 }}>
            <div style={{ fontSize:18 }}>⋯</div>More
          </button>
        </div>
      )}

      {/* Mobile "More" sheet */}
      {isMobile && moreOpen && (
        <div onClick={() => setMoreOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:30, display:'flex', alignItems:'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', width:'100%', borderRadius:'14px 14px 0 0', padding:'16px 14px 24px', maxHeight:'70vh', overflowY:'auto' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>All modules</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {MODULES.filter(m => !MOBILE_PRIMARY.includes(m.k)).map(m => (
                <button key={m.k} onClick={() => go(m.k)} style={{ padding:'12px 10px', borderRadius:9, border:'1px solid #EDE9FE', background:'#FAFAF8', cursor:'pointer', fontFamily:'inherit', fontSize:12, textAlign:'left', display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:16 }}>{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:'fixed', bottom: isMobile ? 80 : 24, right:24, zIndex:9999, background: toast.type==='success'?'#059669':'#DC2626', color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{toast.type==='success'?'✓':'✗'} {toast.msg}</div>}
    </div>
  )
}
