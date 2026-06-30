'use client'
// components/ess/EmployeePortal.tsx — ESS Employee Portal (Phase 2).
// Responsive shell + functional low-dependency modules (Home, Profile, Documents/
// Letters, Requests, Directory, Notifications). Payroll/Leave/Attendance/PMS show
// labeled placeholders until those upstream modules exist (Phase 3/4).
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback } from 'react'
import {
  loadEmployeeDetail, updateEmployeePhoto, loadDirectory, loadNotifications, markNotification, markAllNotifications,
  loadServiceRequests, createServiceRequest, loadLetterRequests, createLetterRequest,
  loadAnnouncements, loadKudos,
  loadLeaveBalances, loadLeaveApplications, applyLeave, loadEmployeeHolidays,
  type EmployeeDetail, type DirectoryEntry, type EssNotification,
  type ServiceRequest, type LetterRequest, type Announcement, type Kudo,
} from '@/lib/supabase-ess'
import {
  loadMonthlyAttendance, loadDayPunches, loadRegularisationRequests, submitRegularisation,
  resolveDay, computeSummary,
  type MonthlyData, type DayPunch, type RegularisationRequest,
} from '@/lib/supabase-attendance'

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
// ── Punch In / Out (ESS attendance) ─────────────────────────────
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
function PunchButton({ employeeId }: { employeeId: string }) {
  const [punchedToday, setPunchedToday] = useState<boolean | null>(null) // null = loading
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [day, setDay] = useState(istToday())

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/attendance/punch?employee_id=${employeeId}&date=${istToday()}`)
      const d = await r.json()
      setPunchedToday((d.punches?.length || 0) > 0)
    } catch { setPunchedToday(false) }
  }, [employeeId])
  useEffect(() => { refresh() }, [refresh])

  // Reset at IST midnight: when the calendar day rolls over, re-check → new day = "Punch In".
  useEffect(() => {
    const t = setInterval(() => { const d = istToday(); if (d !== day) { setDay(d); refresh() } }, 30000)
    return () => clearInterval(t)
  }, [day, refresh])

  const punch = async () => {
    if (busy || punchedToday === null) return
    const type = punchedToday ? 'OUT' : 'IN'
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/attendance/punch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: employeeId, punch_type: type }) })
      const d = await r.json()
      if (!r.ok) { setMsg(d.error || 'Punch failed'); setBusy(false); return }
      setPunchedToday(true) // after the first IN → "Punch Out"; stays till midnight
      setMsg(`✓ Punched ${type} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch { setMsg('Punch failed — try again') }
    setBusy(false)
  }

  const isOut = punchedToday === true
  return (
    <div style={{ ...T.card, borderLeft: `3px solid ${isOut ? '#DC2626' : '#059669'}` }}>
      <div style={T.section}>🕐 Attendance</div>
      <button onClick={punch} disabled={busy || punchedToday === null}
        style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', cursor: (busy || punchedToday === null) ? 'wait' : 'pointer', fontSize: 16, fontWeight: 700, color: '#fff', background: isOut ? '#DC2626' : '#059669', opacity: (busy || punchedToday === null) ? .6 : 1 }}>
        {punchedToday === null ? 'Loading…' : busy ? '…' : (isOut ? '🔴 Punch Out' : '🟢 Punch In')}
      </button>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? '#059669' : '#DC2626', marginTop: 8, textAlign: 'center' }}>{msg}</div>}
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6, textAlign: 'center' }}>{isOut ? 'Punched in today · resets to “Punch In” at 12 AM.' : 'Tap to punch in for the day.'}</div>
    </div>
  )
}

// ── Profile picture editor ──────────────────────────────────────
function resizeToDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d'); if (!ctx) return reject(new Error('no canvas'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
function EditProfileModal({ emp, onClose, onSaved, notify }: { emp: EmployeeDetail; onClose: () => void; onSaved: () => void; notify: (m: string, t?: 'success'|'error') => void }) {
  const [preview, setPreview] = useState<string | null>(emp.profile_photo || null)
  const [busy, setBusy] = useState(false)
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    if (!f.type.startsWith('image/')) { notify('Please choose an image file', 'error'); return }
    try { setPreview(await resizeToDataUrl(f)) } catch { notify('Could not read that image', 'error') }
  }
  const save = async () => {
    setBusy(true)
    const { error } = await updateEmployeePhoto(emp.id, preview) as any
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify('Profile picture updated.'); onSaved(); onClose()
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...T.card, maxWidth:380, width:'100%', marginBottom:0 }} onClick={e => e.stopPropagation()}>
        <div style={T.section}>✏️ Edit Profile Picture</div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
          <div style={{ width:120, height:120, borderRadius:'50%', overflow:'hidden', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize:34, fontWeight:700 }}>
            {preview ? <img src={preview} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}
          </div>
          <label style={{ ...T.btnO, cursor:'pointer' }}>📷 Choose photo<input type="file" accept="image/*" style={{ display:'none' }} onChange={onFile} /></label>
          {preview && <button onClick={() => setPreview(null)} style={{ ...T.btnO, color:'#DC2626', borderColor:'#FCA5A5' }}>Remove photo</button>}
        </div>
        <div style={{ display:'flex', gap:10, marginTop:16 }}>
          <button onClick={onClose} style={{ ...T.btnO, flex:1 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ ...T.btnP, flex:1, opacity: busy?.6:1 }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function Home({ emp, isMobile, go, salaryVisible, notify, reload }: { emp: EmployeeDetail; isMobile: boolean; go: (k: string) => void; salaryVisible: boolean; notify: (m: string, t?: 'success'|'error') => void; reload: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
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
        <div style={{ width:52, height:52, borderRadius:'50%', overflow:'hidden', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, flexShrink:0 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
        <div>
          <div style={{ fontSize:17, fontWeight:700 }}>{greet}, {emp.first_name || emp.full_name.split(' ')[0]}! {emoji}</div>
          <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{emp.designation || '—'} · {emp.emp_code}</div>
          <div style={{ fontSize:12, color:'#7C3AED', marginTop:4, fontStyle:'italic' }}>“{quote}”</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'stretch' }}>
        <div style={{ flex:'3 1 280px' }}><PunchButton employeeId={emp.id} /></div>
        <button onClick={() => setEditOpen(true)} style={{ flex:'1 1 160px', ...T.card, marginBottom:10, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'inherit' }}>
          <div style={{ width:46, height:46, borderRadius:'50%', overflow:'hidden', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
          <span style={{ fontSize:13, fontWeight:600, color:'#6D28D9' }}>✏️ Edit Profile</span>
        </button>
      </div>
      {editOpen && <EditProfileModal emp={emp} onClose={() => setEditOpen(false)} onSaved={reload} notify={notify} />}

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
  const [bank, setBank] = useState({ account_number:'', confirm:'', ifsc:'', bank_name:'', branch:'', holder_name: emp.full_name || '', account_type:'Savings' })
  const lookupIfsc = async (ifsc: string) => {
    if (ifsc.length < 11) return
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`)
      if (r.ok) { const d = await r.json(); setBank(b => ({ ...b, bank_name: d.BANK || b.bank_name, branch: d.BRANCH || b.branch })) }
    } catch { /* IFSC lookup is best-effort */ }
  }
  const Row = ({ k, v }: { k: string; v: any }) => (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F3F0FF', fontSize:12.5 }}><span style={{ color:'#6B7280' }}>{k}</span><span style={{ fontWeight:600 }}>{v || '—'}</span></div>
  )
  async function submit() {
    if (field === 'Bank Account') {
      if (!bank.ifsc.trim() || !bank.account_number.trim() || !bank.holder_name.trim()) { notify('Fill IFSC, account number and holder name', 'error'); return }
      if (bank.account_number !== bank.confirm) { notify('Account numbers do not match', 'error'); return }
      setBusy(true)
      const detailStr = `Bank: ${bank.bank_name || '—'} · A/C ${bank.account_number} · IFSC ${bank.ifsc} · Branch ${bank.branch || '—'} · Holder ${bank.holder_name} · ${bank.account_type}`
      const { error } = await createServiceRequest(emp.id, 'PROFILE_UPDATE', { field, detail: detailStr, bank }, { assigned_to: 'HR' })
      setBusy(false)
      if (error) { notify('Failed: ' + error.message, 'error'); return }
      setBank({ account_number:'', confirm:'', ifsc:'', bank_name:'', branch:'', holder_name: emp.full_name || '', account_type:'Savings' })
      notify('Bank account update request sent to HR for approval.')
      return
    }
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

        {field === 'Bank Account' ? (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div><label style={T.label}>IFSC Code *</label><input style={T.input} value={bank.ifsc} maxLength={11} onChange={e => { const v = e.target.value.toUpperCase(); setBank(b => ({ ...b, ifsc: v })); lookupIfsc(v) }} placeholder="e.g. HDFC0001234" /></div>
            <div><label style={T.label}>Account Type</label><select style={T.input} value={bank.account_type} onChange={e => setBank(b => ({ ...b, account_type: e.target.value }))}><option>Savings</option><option>Current</option></select></div>
            <div><label style={T.label}>Account Number *</label><input style={T.input} value={bank.account_number} onChange={e => setBank(b => ({ ...b, account_number: e.target.value }))} /></div>
            <div><label style={T.label}>Confirm Account Number *</label><input style={T.input} value={bank.confirm} onChange={e => setBank(b => ({ ...b, confirm: e.target.value }))} /></div>
            <div><label style={T.label}>Bank Name (auto)</label><input style={{ ...T.input, background:'#F0FDF4', border:'1px solid #A7F3D0' }} value={bank.bank_name} onChange={e => setBank(b => ({ ...b, bank_name: e.target.value }))} placeholder="Auto-fills from IFSC" /></div>
            <div><label style={T.label}>Branch (auto)</label><input style={{ ...T.input, background:'#F0FDF4', border:'1px solid #A7F3D0' }} value={bank.branch} onChange={e => setBank(b => ({ ...b, branch: e.target.value }))} placeholder="Auto-fills from IFSC" /></div>
            <div style={{ gridColumn:'span 2' }}><label style={T.label}>Account Holder Name *</label><input style={T.input} value={bank.holder_name} onChange={e => setBank(b => ({ ...b, holder_name: e.target.value }))} placeholder="As per bank records" /></div>
            {bank.confirm && bank.confirm !== bank.account_number && <div style={{ gridColumn:'span 2', color:'#DC2626', fontSize:12, marginTop:-4 }}>⚠️ Account numbers don't match</div>}
          </div>
        ) : (
          <>
            <label style={T.label}>Details</label>
            <textarea style={{ ...T.input, minHeight:80, marginBottom:10, resize:'vertical' }} value={detail} onChange={e => setDetail(e.target.value)} placeholder="New value / what changed…" />
          </>
        )}
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

// ── Leave & Holidays (ESS) — balances, apply, history, upcoming holidays ──
function LeaveSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const [balances, setBalances] = useState<any[]>([])
  const [apps, setApps] = useState<any[]>([])
  const [hols, setHols] = useState<any[]>([])
  const [form, setForm] = useState({ leave_type_id: '', from_date: '', to_date: '', half_day: false, reason: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    loadLeaveBalances(emp.id).then(setBalances)
    loadLeaveApplications(emp.id).then(setApps)
    loadEmployeeHolidays(emp.id).then(setHols)
  }, [emp.id])
  const avail = (b: any) => (Number(b.opening || 0) + Number(b.accrued || 0)) - Number(b.used || 0) - Number(b.encashed || 0)
  const barColor = (pct: number) => pct > 60 ? '#059669' : pct > 30 ? '#F59E0B' : '#DC2626'
  const submit = async () => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) { notify('Select leave type and dates', 'error'); return }
    const days = form.half_day ? 0.5 : Math.max(1, Math.round((new Date(form.to_date).getTime() - new Date(form.from_date).getTime()) / 86400000) + 1)
    setBusy(true)
    const { error } = await applyLeave({ employee_id: emp.id, leave_type_id: form.leave_type_id, from_date: form.from_date, to_date: form.to_date, half_day: form.half_day, days, reason: form.reason }) as any
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify('Leave request submitted ✓'); setForm({ leave_type_id: '', from_date: '', to_date: '', half_day: false, reason: '' })
    loadLeaveApplications(emp.id).then(setApps)
  }
  const STATUS: Record<string, [string, string]> = { PENDING: ['#FFFBEB', '#B45309'], APPROVED: ['#ECFDF5', '#059669'], REJECTED: ['#FEF2F2', '#DC2626'], CANCELLED: ['#F3F4F6', '#6B7280'] }
  const HOL_STYLE: Record<string, [string, string]> = { NATIONAL: ['#EFF6FF', '#1E40AF'], FESTIVAL: ['#EDE9FE', '#534AB7'], OPTIONAL: ['#FFFBEB', '#B45309'], REGIONAL: ['#E0F2FE', '#0369A1'] }
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = hols.filter((h: any) => h.holiday_date >= today)
  return (
    <div>
      <div style={T.card}>
        <div style={T.section}>🌴 Leave Balance · FY 2026-27</div>
        {balances.length === 0 ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>No leave balances yet — contact HR.</div> :
          balances.map((b: any) => { const total = Number(b.opening || 0) + Number(b.accrued || 0); const av = avail(b); const pct = total > 0 ? Math.round(av / total * 100) : 0; return (
            <div key={b.id} style={{ background: '#FAFAF8', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 10, background: '#EDE9FE', color: '#6D28D9', padding: '2px 7px', borderRadius: 99, marginRight: 6 }}>{b.leave_types?.short_name}</span>{b.leave_types?.name}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: barColor(pct) }}>{av}<span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}> / {total}</span></span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: '#E2E8F0', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: barColor(pct) }} /></div>
            </div>
          )})}
      </div>
      <div style={T.card}>
        <div style={T.section}>Apply for Leave</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1/-1' }}><label style={T.label}>Leave type</label>
            <select style={T.input} value={form.leave_type_id} onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">Select</option>{balances.map((b: any) => <option key={b.leave_type_id} value={b.leave_type_id}>{b.leave_types?.short_name} · {b.leave_types?.name} ({avail(b)} left)</option>)}
            </select></div>
          <div><label style={T.label}>From</label><input type="date" style={T.input} value={form.from_date} onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} /></div>
          <div><label style={T.label}>To</label><input type="date" style={T.input} value={form.to_date} onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} /></div>
          <label style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={form.half_day} onChange={e => setForm(f => ({ ...f, half_day: e.target.checked }))} /> Half day</label>
          <div style={{ gridColumn: '1/-1' }}><label style={T.label}>Reason</label><input style={T.input} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Brief reason" /></div>
        </div>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, marginTop: 10, opacity: busy ? .6 : 1 }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
      <div style={T.card}>
        <div style={T.section}>Recent Requests</div>
        {apps.length === 0 ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>No leave applications yet.</div> :
          apps.map((a: any) => { const [bg, c] = STATUS[a.status] || ['#F3F4F6', '#6B7280']; return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F3F0FF', fontSize: 12 }}>
              <span style={{ fontSize: 10, background: '#EDE9FE', color: '#6D28D9', padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>{a.leave_types?.short_name}</span>
              <span style={{ flex: 1 }}>{a.from_date}{a.to_date !== a.from_date ? ` → ${a.to_date}` : ''}{a.half_day ? ' (½)' : ''}</span>
              <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: bg, color: c, fontWeight: 600 }}>{a.status}</span>
            </div>
          )})}
      </div>
      <div style={T.card}>
        <div style={T.section}>📅 Upcoming Holidays</div>
        {upcoming.length === 0 ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>No upcoming holidays.</div> :
          upcoming.map((h: any) => { const [bg, c] = HOL_STYLE[h.holiday_type] || ['#F3F4F6', '#6B7280']; return (
            <div key={h.holiday_date + h.description} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F3F0FF', fontSize: 12 }}>
              <span style={{ minWidth: 64, fontWeight: 600 }}>{new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
              <span style={{ flex: 1 }}>{h.description}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: bg, color: c, fontWeight: 600 }}>{h.holiday_type}</span>
              {h.is_optional && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: '#FEF3C7', color: '#92400E' }}>Optional</span>}
            </div>
          )})}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// ATTENDANCE (B3)
// ════════════════════════════════════════════════════════════════
const STATUS_STYLE: Record<string,[string,string]> = {
  PRESENT:['#EAF3DE','#3B6D11'], ABSENT:['#FCEBEB','#A32D2D'], HALF_DAY:['#FAEEDA','#633806'],
  MISS_PUNCH:['#FAEEDA','#854F0B'], LWP:['#FCEBEB','#A32D2D'], WEEKLY_OFF:['#F1F5F9','#94A3B8'],
  HOLIDAY:['#E6F1FB','#0C447C'], ON_LEAVE:['#EEEDFE','#3C3489'], FUTURE:['transparent','#CBD5E1'], TODAY:['#F5F3FF','#7C3AED'],
}
const STATUS_LABEL: Record<string,string> = { PRESENT:'P', ABSENT:'A', HALF_DAY:'½', MISS_PUNCH:'!', LWP:'LWP', WEEKLY_OFF:'W', HOLIDAY:'H', ON_LEAVE:'L', FUTURE:'', ABSENT_FULL:'Absent' }

const fmtT = (iso: string|null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const pad2 = (n: number) => String(n).padStart(2,'0')

function StatusBadge({ status }: { status: string }) {
  const [bg,c] = STATUS_STYLE[status] || ['#F3F0FF','#6D28D9']
  const lbl = ({ PRESENT:'Present', ABSENT:'Absent', HALF_DAY:'Half Day', MISS_PUNCH:'Miss Punch', LWP:'LWP', WEEKLY_OFF:'Weekly Off', HOLIDAY:'Holiday', ON_LEAVE:'On Leave', FUTURE:'—' } as Record<string,string>)[status] || status
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{lbl}</span>
}

// 1) Summary chips ──────────────────────────────────────────────
function AttendanceSummaryChips({ summary, isMobile }: { summary: ReturnType<typeof computeSummary>; isMobile: boolean }) {
  const chips: { label: string; value: string; style: [string,string] }[] = [
    { label:'Present',  value:String(summary.present),   style:STATUS_STYLE.PRESENT },
    { label:'Absent',   value:String(summary.absent),    style:STATUS_STYLE.ABSENT },
    { label:'Half Day', value:String(summary.halfDay),   style:STATUS_STYLE.HALF_DAY },
    { label:'Late',     value:String(summary.lateCount), style:STATUS_STYLE.MISS_PUNCH },
    { label:'OT',       value:summary.totalOTHours,      style:['#EEEDFE','#3C3489'] },
    { label:'LOP',      value:String(summary.lopDays),   style:STATUS_STYLE.LWP },
  ]
  const wrap: React.CSSProperties = isMobile
    ? { overflowX:'auto', display:'flex', whiteSpace:'nowrap', gap:8, marginBottom:10, paddingBottom:4 }
    : { display:'flex', flexWrap:'wrap', gap:8, marginBottom:10 }
  return (
    <div style={wrap}>
      {chips.map(ch => (
        <div key={ch.label} style={{ background:ch.style[0], color:ch.style[1], borderRadius:9, padding:'8px 14px', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-start', minWidth:64 }}>
          <span style={{ fontSize:20, fontWeight:700, lineHeight:1.1 }}>{ch.value}</span>
          <span style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', opacity:.85 }}>{ch.label}</span>
        </div>
      ))}
    </div>
  )
}

// 2) Calendar ────────────────────────────────────────────────────
function AttendanceCalendar({ year, month, monthData, todayStr, isMobile, onDayClick, selectedDate }: {
  year: number; month: number; monthData: MonthlyData; todayStr: string; isMobile: boolean
  onDayClick: (d: string) => void; selectedDate: string|null
}) {
  const cell = isMobile ? 38 : 58
  const fs = isMobile ? 9 : 11
  const gap = isMobile ? 2 : 3
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = new Date(year, month-1, 1).getDay()
  const cells: React.ReactNode[] = []
  for (let i = 0; i < lead; i++) cells.push(<div key={'b'+i} />)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`
    const { status, rec, leave } = resolveDay(dateStr, monthData, todayStr)
    const [bg, c] = STATUS_STYLE[status] || ['#fff', '#1E1B4B']
    const isToday = dateStr === todayStr
    const isSel = dateStr === selectedDate
    cells.push(
      <button key={dateStr} onClick={() => onDayClick(dateStr)} style={{
        minHeight:cell, background:bg, color:c, border: isToday ? '1.5px solid #7C3AED' : '1px solid rgba(124,58,237,0.10)',
        borderRadius:7, padding:isMobile?'3px 2px':'4px 5px', cursor:'pointer', fontFamily:'inherit',
        display:'flex', flexDirection:'column', alignItems:'flex-start', gap:1, overflow:'hidden',
        outline: isSel ? '2px solid #7C3AED' : 'none', outlineOffset: isSel ? 1 : 0,
      }}>
        <span style={{ fontSize:fs, fontWeight:700, lineHeight:1 }}>{d}</span>
        {!isMobile && rec && (rec.work_in || rec.work_out) && (
          <span style={{ fontSize:8, opacity:.8, lineHeight:1.2 }}>{fmtT(rec.work_in)}–{fmtT(rec.work_out)}</span>
        )}
        {status === 'ON_LEAVE'
          ? <span style={{ fontSize:isMobile?8:9, fontWeight:600 }}>{leave?.short_name || 'L'}</span>
          : (STATUS_LABEL[status] ? <span style={{ fontSize:isMobile?8:9, fontWeight:600 }}>{STATUS_LABEL[status]}</span> : null)}
      </button>
    )
  }
  const legend: [string,string][] = [['PRESENT','Present'],['ABSENT','Absent'],['HALF_DAY','Half'],['MISS_PUNCH','Miss Punch'],['ON_LEAVE','Leave'],['HOLIDAY','Holiday'],['WEEKLY_OFF','Week Off'],['LWP','LOP']]
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap, marginBottom:gap }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign:'center', fontSize:10, fontWeight:600, color:'#9CA3AF', padding:'2px 0' }}>{w}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap }}>{cells}</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 12px', marginTop:12 }}>
        {legend.map(([k,lbl]) => { const [bg,c] = STATUS_STYLE[k]; return (
          <span key={k} style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, color:'#6B7280' }}>
            <span style={{ width:11, height:11, borderRadius:3, background:bg, border:'1px solid '+c, display:'inline-block' }} />{lbl}
          </span>
        )})}
      </div>
    </div>
  )
}

// 3) Day detail panel ────────────────────────────────────────────
function DayDetailPanel({ emp, date, dayInfo, isMobile, onRaise }: {
  emp: EmployeeDetail; date: string; dayInfo: ReturnType<typeof resolveDay>; isMobile: boolean; onRaise: (d: string) => void
}) {
  const [punches, setPunches] = useState<DayPunch[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    loadDayPunches(emp.id, date).then(p => { if (active) { setPunches(p); setLoading(false) } })
    return () => { active = false }
  }, [emp.id, date])

  const { status, rec, holiday, leave } = dayInfo
  const worked = rec?.total_minutes != null ? `${Math.floor(rec.total_minutes/60)}h ${rec.total_minutes%60}m` : '—'
  const heading = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'short', year:'numeric' })

  return (
    <div style={T.card}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:14, fontWeight:700 }}>{heading}</div>
        <StatusBadge status={status} />
      </div>

      {holiday && <div style={{ fontSize:13, color:'#0C447C', background:'#E6F1FB', borderRadius:7, padding:'8px 11px', marginBottom:10 }}>🎌 {holiday.description}{holiday.is_optional ? ' (Optional)' : ''}</div>}
      {status === 'WEEKLY_OFF' && <div style={{ fontSize:13, color:'#94A3B8', background:'#F1F5F9', borderRadius:7, padding:'8px 11px', marginBottom:10 }}>Weekly Off</div>}
      {leave && <div style={{ fontSize:13, color:'#3C3489', background:'#EEEDFE', borderRadius:7, padding:'8px 11px', marginBottom:10 }}>On Leave — {leave.name}{leave.half_day ? ' (Half day)' : ''}</div>}

      {rec && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:8, marginBottom:10 }}>
          {([['In', fmtT(rec.work_in)],['Out', fmtT(rec.work_out)],['Worked', worked],['Late', `${rec.late_minutes||0}m`],['OT', `${rec.overtime_minutes||0}m`]] as [string,string][]).map(([k,v]) => (
            <div key={k} style={{ background:'#FAFAF8', borderRadius:7, padding:'7px 10px' }}>
              <div style={{ fontSize:10, color:'#9CA3AF', fontWeight:600, textTransform:'uppercase' }}>{k}</div>
              <div style={{ fontSize:13, fontWeight:600, marginTop:2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Punch Timeline</div>
      {loading ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Loading punches…</div>
        : punches.length === 0 ? <div style={{ fontSize:12, color:'#9CA3AF' }}>No raw punches recorded.</div>
        : punches.map((p, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
            <span style={{ fontWeight:600, minWidth:52 }}>{fmtT(p.punch_time)}</span>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: p.punch_type==='IN' ? '#ECFDF5' : '#FEF2F2', color: p.punch_type==='IN' ? '#059669' : '#DC2626' }}>{p.punch_type}</span>
            <span style={{ color:'#6B7280' }}>{p.source || '—'}</span>
            {p.geofence_status && <span style={{ marginLeft:'auto', fontSize:10, color:'#9CA3AF' }}>{p.geofence_status}</span>}
          </div>
        ))}

      {status === 'MISS_PUNCH' && (
        <button onClick={() => onRaise(date)} style={{ ...T.btnP, marginTop:12, background:'#D97706' }}>⚠ Raise regularisation</button>
      )}
    </div>
  )
}

// 4) Regularisation form ─────────────────────────────────────────
function RegularisationForm({ emp, date, rec, editable, onDone, onCancel }: {
  emp: EmployeeDetail; date: string; rec: MonthlyData['records'][number] | null; editable?: boolean
  onDone: () => void; onCancel: () => void
}) {
  const [dateVal, setDateVal] = useState(date)
  const [actualIn, setActualIn] = useState('')
  const [actualOut, setActualOut] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const submit = async () => {
    if (!dateVal) { setMsg({ text:'Select the attendance date', ok:false }); return }
    if (!actualIn || !actualOut) { setMsg({ text:'Enter both actual IN and OUT times', ok:false }); return }
    if (actualIn >= actualOut) { setMsg({ text:'Actual IN must be before Actual OUT', ok:false }); return }
    if (!reason.trim()) { setMsg({ text:'Reason is required', ok:false }); return }
    setBusy(true); setMsg(null)
    const { error } = await submitRegularisation(emp.id, dateVal, rec?.work_in || null, rec?.work_out || null, actualIn, actualOut, reason.trim())
    setBusy(false)
    if (error) { setMsg({ text: error, ok:false }); return }
    setMsg({ text:'✓ Regularisation request submitted', ok:true })
    onDone()
  }
  const dateLbl = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
  return (
    <div style={T.card}>
      <div style={T.section}>⚠ Raise Regularisation</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        <div style={{ gridColumn:'1/-1' }}><label style={T.label}>Attendance date *</label>{editable
          ? <input type="date" max={new Date().toISOString().slice(0, 10)} style={T.input} value={dateVal} onChange={e => setDateVal(e.target.value)} />
          : <input style={{ ...T.input, background:'#F1F5F9' }} value={dateLbl} readOnly />}</div>
        <div><label style={T.label}>Recorded IN</label><input style={{ ...T.input, background:'#F1F5F9' }} value={rec?.work_in ? fmtT(rec.work_in) : 'Not recorded'} readOnly /></div>
        <div><label style={T.label}>Recorded OUT</label><input style={{ ...T.input, background:'#F1F5F9' }} value={rec?.work_out ? fmtT(rec.work_out) : 'Not recorded'} readOnly /></div>
        <div><label style={T.label}>Actual IN *</label><input type="time" style={T.input} value={actualIn} onChange={e => setActualIn(e.target.value)} /></div>
        <div><label style={T.label}>Actual OUT *</label><input type="time" style={T.input} value={actualOut} onChange={e => setActualOut(e.target.value)} /></div>
        <div style={{ gridColumn:'1/-1' }}><label style={T.label}>Reason *</label><input style={T.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why was the punch missed?" /></div>
      </div>
      {msg && <div style={{ fontSize:12, marginBottom:10, color: msg.ok ? '#059669' : '#DC2626' }}>{msg.text}</div>}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={onCancel} style={{ ...T.btnO, flex:1 }}>Cancel</button>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, flex:1, opacity: busy?.6:1 }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </div>
  )
}

// 5) Regularisation list ─────────────────────────────────────────
function RegularisationList({ requests }: { requests: RegularisationRequest[] }) {
  const STY: Record<string,[string,string]> = { PENDING:['#FEF3C7','#D97706'], APPROVED:['#ECFDF5','#059669'], REJECTED:['#FEF2F2','#DC2626'] }
  return (
    <div style={T.card}>
      <div style={T.section}>🗂️ My Regularisation Requests</div>
      {requests.length === 0 && <div style={{ fontSize:12, color:'#9CA3AF' }}>No regularisation requests yet.</div>}
      {requests.map(r => { const [bg,c] = STY[r.status] || ['#F3F0FF','#6D28D9']; return (
        <div key={r.id} style={{ padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>{fmt(r.attendance_date)}</div>
            <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{r.status}</span>
          </div>
          <div style={{ fontSize:11, color:'#6B7280', marginTop:3 }}>Recorded: IN {r.recorded_in ? fmtT(r.recorded_in) : '—'} · OUT {r.recorded_out ? fmtT(r.recorded_out) : '—'}</div>
          <div style={{ fontSize:11, color:'#374151', marginTop:1 }}>Requested: {r.requested_in} → {r.requested_out}</div>
          {r.reason && <div style={{ fontSize:12, color:'#374151', marginTop:3 }}>{r.reason}</div>}
          <div style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Submitted {fmtDT(r.created_at)}</div>
        </div>
      )})}
    </div>
  )
}

// 6) Attendance module wrapper ───────────────────────────────────
function AttendanceModule({ emp }: { emp: EmployeeDetail }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [monthData, setMonthData] = useState<MonthlyData | null>(null)
  const [regs, setRegs] = useState<RegularisationRequest[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [raiseDate, setRaiseDate] = useState<string | null>(null)
  const [manualRaise, setManualRaise] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [loading, setLoading] = useState(true)
  const todayStr = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check)
  }, [])

  const loadRegs = useCallback(() => { loadRegularisationRequests(emp.id).then(setRegs) }, [emp.id])
  const loadMonth = useCallback(() => {
    setLoading(true)
    loadMonthlyAttendance(emp.id, year, month).then(d => { setMonthData(d); setLoading(false) })
  }, [emp.id, year, month])

  useEffect(() => { loadMonth() }, [loadMonth])
  useEffect(() => { loadRegs() }, [loadRegs])

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1); setSelectedDate(null); setRaiseDate(null) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1); setSelectedDate(null); setRaiseDate(null) }

  const dayInfo = selectedDate && monthData ? resolveDay(selectedDate, monthData, todayStr) : null
  const raiseRec = raiseDate && monthData ? (monthData.recMap.get(raiseDate) || null) : null

  return (
    <div>
      {/* (A) month nav */}
      <div style={{ ...T.card, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <button onClick={prevMonth} style={T.btnO}>‹ Prev</button>
        <div style={{ fontSize:15, fontWeight:700 }}>{MONTH_NAMES[month-1]} {year}</div>
        <button onClick={nextMonth} style={T.btnO}>Next ›</button>
      </div>

      {/* (B) summary chips */}
      <AttendanceSummaryChips summary={computeSummary(monthData?.records || [])} isMobile={isMobile} />

      {/* (C) calendar */}
      <div style={T.card}>
        {loading || !monthData
          ? <div style={{ fontSize:12, color:'#9CA3AF', padding:'20px 0', textAlign:'center' }}>Loading attendance…</div>
          : <AttendanceCalendar year={year} month={month} monthData={monthData} todayStr={todayStr} isMobile={isMobile} onDayClick={d => { setSelectedDate(d); setRaiseDate(null) }} selectedDate={selectedDate} />}
      </div>

      {/* (D) day detail */}
      {selectedDate && dayInfo && <DayDetailPanel emp={emp} date={selectedDate} dayInfo={dayInfo} isMobile={isMobile} onRaise={d => setRaiseDate(d)} />}

      {/* (E) regularisation form */}
      {raiseDate && <RegularisationForm emp={emp} date={raiseDate} rec={raiseRec} onDone={() => { loadRegs(); loadMonth(); setRaiseDate(null) }} onCancel={() => setRaiseDate(null)} />}

      {/* (F) raise regularisation + list */}
      <div style={{ ...T.card, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom: (manualRaise && !raiseDate) ? 0 : undefined }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>Attendance Regularisation</div>
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>Forgot to punch or wrong time? Raise a correction for any day → HR approval.</div>
        </div>
        {!manualRaise && !raiseDate && <button onClick={() => setManualRaise(true)} style={T.btnP}>+ Raise Regularisation</button>}
      </div>
      {manualRaise && !raiseDate && <RegularisationForm emp={emp} date={todayStr} rec={null} editable onDone={() => { loadRegs(); loadMonth(); setManualRaise(false) }} onCancel={() => setManualRaise(false)} />}
      <RegularisationList requests={regs} />
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
  const reload = useCallback(() => loadEmployeeDetail(employeeId).then(setEmp), [employeeId])

  const go = (k: string) => { setView(k); setMoreOpen(false) }
  const salaryVisible = false // role-based salary visibility wired with auth in a later pass

  const renderView = () => {
    if (!emp) return null
    const m = MODULES.find(x => x.k === view)!
    switch (view) {
      case 'home':          return <Home emp={emp} isMobile={isMobile} go={go} salaryVisible={salaryVisible} notify={notify} reload={reload} />
      case 'profile':       return <Profile emp={emp} notify={notify} />
      case 'leave':         return <LeaveSection emp={emp} notify={notify} />
      case 'attendance':    return <AttendanceModule emp={emp} />
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
