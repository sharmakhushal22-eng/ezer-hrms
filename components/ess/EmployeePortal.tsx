'use client'
// components/ess/EmployeePortal.tsx — ESS Employee Portal.
//
// Six sections in the sidebar — Home, Profile, Payroll, Time, Workplace, Requests —
// with everything else reached as a sub-tab inside one of them. See SECTIONS near the
// bottom of this file for the map and why it is grouped that way.
//
// Anything not built yet renders a labelled placeholder naming the module it waits on,
// rather than a screen that looks finished and does nothing.
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback, useMemo } from 'react'
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
import * as HR from '@/lib/employees/hr-actions'
import { loadLeaveTypes } from '@/lib/supabase-leave-config'
import { supabase } from '@/lib/supabase'
import FlexiTdsCalculator from '@/components/ess/FlexiTdsCalculator'
import FunZone from '@/components/ess/FunZone'
import FlexiClaims from '@/components/ess/FlexiClaims'
import InvestmentDeclaration from '@/components/ess/InvestmentDeclaration'
import InvestmentProofs from '@/components/ess/InvestmentProofs'

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

// ── Transfer acknowledgement (ESS) ──────────────────────────────
function TransferAckCard({ empId, onAck }: { empId: string; onAck: () => void }) {
  const [transfers, setTransfers] = useState<any[]>([])
  useEffect(() => { HR.getPendingTransfers(empId).then(setTransfers) }, [empId])
  if (!transfers.length) return null
  return (<>{transfers.map(tr => (
    <div key={tr.id} style={{ background:'#FAEEDA', border:'1px solid #EF9F27', borderRadius:10, padding:'12px 16px', marginBottom:10 }}>
      <div style={{ fontSize:13, fontWeight:600, color:'#633806' }}>🔄 Transfer Letter — action required</div>
      <div style={{ fontSize:11, color:'#854F0B', marginTop:3 }}>You are being transferred, effective {tr.effective_date}.</div>
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        {tr.letter_url && <a href={tr.letter_url} target="_blank" rel="noreferrer" style={{ padding:'7px 14px', background:'#fff', border:'1px solid #EF9F27', borderRadius:7, fontSize:11, color:'#633806', textDecoration:'none' }}>📄 View Letter</a>}
        <button onClick={async () => { await HR.acknowledgeTransfer(tr.id); setTransfers(t=>t.filter(x=>x.id!==tr.id)); onAck() }} style={{ padding:'7px 14px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>✓ Acknowledge & Accept</button>
      </div>
    </div>
  ))}</>)
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
      <TransferAckCard empId={emp.id} onAck={()=>{}} />
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
        <button onClick={() => go('payslip')} style={T.btnO}>💰 Download Payslip</button>
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
function DirDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom:'1px solid #F3F0FF' }}>
      <span style={{ fontSize:11, color:'#6B7280', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }}>{label}</span>
      <span style={{ fontSize:13, color:'#1E1B4B', textAlign:'right', wordBreak:'break-word' }}>{value || '—'}</span>
    </div>
  )
}
function DirectoryDetailModal({ e, onClose }: { e: DirectoryEntry; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:4000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={ev => ev.stopPropagation()} style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:440, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'18px 20px', borderBottom:'1px solid #EDE9FE' }}>
          <div style={{ width:48, height:48, borderRadius:'50%', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:16, flexShrink:0 }}>{initials(e.full_name)}</div>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:16, fontWeight:700 }}>{e.full_name}</div>
            <div style={{ fontSize:12, color:'#9CA3AF' }}>{e.designation || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:24, lineHeight:1, cursor:'pointer', color:'#9CA3AF' }}>×</button>
        </div>
        <div style={{ padding:'6px 20px 16px' }}>
          <DirDetailRow label="Employee Code" value={e.emp_code} />
          <DirDetailRow label="Email ID" value={e.office_email || e.personal_email} />
          <DirDetailRow label="Mobile Number" value={e.mobile} />
          <DirDetailRow label="Department" value={e.dept_name} />
          <DirDetailRow label="Location" value={e.location_name} />
          <DirDetailRow label="Company Name" value={e.company_name} />
        </div>
        <div style={{ padding:'0 20px 18px', display:'flex', gap:8, flexWrap:'wrap' }}>
          {(e.office_email || e.personal_email) && <a href={`mailto:${e.office_email || e.personal_email}`} style={{ ...T.btnO, textDecoration:'none' }}>📧 Email</a>}
          {e.mobile && <a href={`tel:${e.mobile}`} style={{ ...T.btnO, textDecoration:'none' }}>📱 Call</a>}
          {e.mobile && <a href={`https://wa.me/91${(e.mobile||'').replace(/\D/g,'').slice(-10)}`} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration:'none' }}>WhatsApp</a>}
          <button onClick={onClose} style={{ ...T.btnO, marginLeft:'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
// A stable colour per person so the same face keeps the same avatar between visits.
const DIR_TINTS = [
  { bg: '#EDE9FE', fg: '#6D28D9' }, { bg: '#E6F1FB', fg: '#185FA5' }, { bg: '#ECFDF5', fg: '#059669' },
  { bg: '#FFF7ED', fg: '#C2410C' }, { bg: '#FCE7F3', fg: '#BE185D' }, { bg: '#EEF2FF', fg: '#4338CA' },
  { bg: '#F0FDFA', fg: '#0F766E' }, { bg: '#FEF3C7', fg: '#B45309' },
]
const dirTint = (s: string) => DIR_TINTS[Array.from(s || '?').reduce((a, c) => a + c.charCodeAt(0), 0) % DIR_TINTS.length]

function Directory({ isMobile }: { isMobile: boolean }) {
  const [rows, setRows] = useState<DirectoryEntry[]>([])
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [loc, setLoc] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<DirectoryEntry | null>(null)

  useEffect(() => {
    setLoading(true)
    loadDirectory()
      .then(r => { setRows(r); setErr('') })
      .catch(e => setErr(e?.message || 'Could not load the directory.'))
      .finally(() => setLoading(false))
  }, [])

  const depts = Array.from(new Set(rows.map(r => r.dept_name).filter(Boolean))).sort() as string[]
  const locs = Array.from(new Set(rows.map(r => r.location_name).filter(Boolean))).sort() as string[]
  // Search matches several terms, so a pasted list of names or codes works too.
  const terms = q.split(/[,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
  const filtered = rows.filter(e => {
    if (dept && e.dept_name !== dept) return false
    if (loc && e.location_name !== loc) return false
    if (!terms.length) return true
    return terms.some(t =>
      e.full_name.toLowerCase().includes(t) || (e.designation || '').toLowerCase().includes(t)
      || (e.dept_name || '').toLowerCase().includes(t) || (e.emp_code || '').toLowerCase().includes(t)
      || (e.location_name || '').toLowerCase().includes(t) || (e.office_email || '').toLowerCase().includes(t))
  })

  const chip = (txt: string, bg: string, fg: string) => (
    <span style={{ fontSize: 10, fontWeight: 600, background: bg, color: fg, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{txt}</span>
  )
  const sel2: React.CSSProperties = { ...T.input, minWidth: 150, flex: isMobile ? '1 1 100%' : '0 0 auto', width: 'auto' }

  return (
    <div>
      {/* header + filters */}
      <div style={{ ...T.card, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📇</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>Employee Directory</div>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>
              {loading ? 'Loading colleagues…' : `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''} colleague${filtered.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...T.input, flex: 1, minWidth: 200 }} placeholder="🔍 Search name, code, designation, department or email" value={q} onChange={e => setQ(e.target.value)} />
          <select style={sel2} value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select style={sel2} value={loc} onChange={e => setLoc(e.target.value)}>
            <option value="">All locations</option>
            {locs.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          {(q || dept || loc) && (
            <button onClick={() => { setQ(''); setDept(''); setLoc('') }} style={{ ...T.btnO, whiteSpace: 'nowrap' }}>Clear</button>
          )}
        </div>
      </div>

      {err && <div style={{ ...T.card, color: '#A32D2D', background: '#FCEBEB', border: '1px solid #F5C6C6' }}>Could not load the directory — {err}</div>}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ ...T.card, opacity: .6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#EEF' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 11, background: '#EEF', borderRadius: 4, width: '65%', marginBottom: 7 }} />
                  <div style={{ height: 9, background: '#F3F4F6', borderRadius: 4, width: '45%' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(290px,1fr))', gap: 10 }}>
          {filtered.map(e => {
            const t = dirTint(e.full_name || e.emp_code || '')
            return (
              <div key={e.id} onClick={() => setSel(e)}
                style={{ ...T.card, cursor: 'pointer', transition: 'box-shadow .15s, transform .1s', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{initials(e.full_name)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1E1B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.full_name}</div>
                    <div style={{ fontSize: 11, color: '#6B6B7B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.designation || '—'}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{e.emp_code}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {e.dept_name && chip(e.dept_name, '#F5F3FF', '#6D28D9')}
                  {e.location_name && chip('📍 ' + e.location_name, '#F8FAFC', '#475569')}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #F1F5F9', paddingTop: 8 }} onClick={ev => ev.stopPropagation()}>
                  {(e.office_email || e.personal_email) && <a href={`mailto:${e.office_email || e.personal_email}`} title={e.office_email || e.personal_email || ''} style={{ ...T.btnO, textDecoration: 'none' }}>📧 Email</a>}
                  {e.mobile && <a href={`tel:${e.mobile}`} title={e.mobile} style={{ ...T.btnO, textDecoration: 'none' }}>📱 Call</a>}
                  {e.mobile && <a href={`https://wa.me/91${(e.mobile || '').replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration: 'none' }}>💬 WhatsApp</a>}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && !err && (
            <div style={{ ...T.card, gridColumn: '1 / -1', textAlign: 'center', padding: '30px 16px' }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>🔍</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B', marginBottom: 3 }}>No colleagues match that search</div>
              <div style={{ fontSize: 11.5, color: '#9CA3AF' }}>Try a different name, code or department{(dept || loc) ? ', or clear the filters' : ''}.</div>
            </div>
          )}
        </div>
      )}
      {sel && <DirectoryDetailModal e={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// NOTIFICATIONS (B11)
// ════════════════════════════════════════════════════════════════
function Notifications({ emp, onChange }: { emp: EmployeeDetail; onChange?: () => void }) {
  const [rows, setRows] = useState<EssNotification[]>([])
  const load = useCallback(() => loadNotifications(emp.id).then(r => { setRows(r); onChange?.() }), [emp.id, onChange])
  useEffect(() => { load() }, [load])
  return (
    <div style={{ ...T.card, marginBottom:0, border:'none', boxShadow:'none' }}>
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
  const [types, setTypes] = useState<any[]>([])
  const [apps, setApps] = useState<any[]>([])
  const [hols, setHols] = useState<any[]>([])
  const [form, setForm] = useState({ leave_type_id: '', from_date: '', to_date: '', half_day: false, half_session: '', reason: '' })
  const [busy, setBusy] = useState(false)
  // Half-day is offered only for these leave types.
  const HALF_DAY_TYPES = ['EL', 'CL', 'SL', 'LWP', 'CP']
  useEffect(() => {
    loadLeaveBalances(emp.id).then(setBalances)
    loadLeaveApplications(emp.id).then(setApps)
    loadEmployeeHolidays(emp.id).then(setHols)
    // Leave-type catalog (EL, CL, …) — the apply dropdown lists every active,
    // employee-applicable type, not only the ones the employee has a balance row for.
    loadLeaveTypes().then(all => setTypes((all || []).filter((t: any) => t.is_active && t.application_mode !== 'HR_MARK')))
  }, [emp.id])
  // Balance lookup by leave_type_id → shows "(N left)" next to a type when seeded.
  const balByType = useMemo(() => { const m: Record<string, any> = {}; balances.forEach((b: any) => { m[b.leave_type_id] = b }); return m }, [balances])
  const avail = (b: any) => (Number(b.opening || 0) + Number(b.accrued || 0)) - Number(b.used || 0) - Number(b.encashed || 0)
  const barColor = (pct: number) => pct > 60 ? '#059669' : pct > 30 ? '#F59E0B' : '#DC2626'
  const submit = async () => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) { notify('Select leave type and dates', 'error'); return }
    if (form.half_day && !form.half_session) { notify('Select 1st half or 2nd half', 'error'); return }
    const days = form.half_day ? 0.5 : Math.max(1, Math.round((new Date(form.to_date).getTime() - new Date(form.from_date).getTime()) / 86400000) + 1)
    setBusy(true)
    const { error } = await applyLeave({ employee_id: emp.id, leave_type_id: form.leave_type_id, from_date: form.from_date, to_date: form.to_date, half_day: form.half_day, half_session: form.half_day ? form.half_session : '', days, reason: form.reason }) as any
    setBusy(false)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify('Leave request submitted ✓'); setForm({ leave_type_id: '', from_date: '', to_date: '', half_day: false, half_session: '', reason: '' })
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
            <select style={T.input} value={form.leave_type_id} onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value, half_day: false, half_session: '' }))}>
              <option value="">Select</option>
              {(types.length ? types : balances.map((b: any) => ({ id: b.leave_type_id, short_name: b.leave_types?.short_name, name: b.leave_types?.name }))).map((t: any) => {
                const bal = balByType[t.id]
                return <option key={t.id} value={t.id}>{t.short_name} · {t.name}{bal ? ` (${avail(bal)} left)` : ''}</option>
              })}
            </select></div>
          <div><label style={T.label}>From</label><input type="date" style={T.input} value={form.from_date} onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} /></div>
          <div><label style={T.label}>To</label><input type="date" style={T.input} value={form.to_date} onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} /></div>
          {(() => {
            const selShort = types.find((t: any) => t.id === form.leave_type_id)?.short_name || balByType[form.leave_type_id]?.leave_types?.short_name || ''
            if (!HALF_DAY_TYPES.includes(selShort)) return null
            return (
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.half_day} onChange={e => setForm(f => ({ ...f, half_day: e.target.checked, half_session: e.target.checked ? f.half_session : '' }))} /> Half day
                </label>
                {form.half_day && (
                  <div style={{ display: 'flex', gap: 18, marginTop: 8, paddingLeft: 24 }}>
                    {[['1st', '1st Half'], ['2nd', '2nd Half']].map(([val, lbl]) => (
                      <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.half_session === val} onChange={e => setForm(f => ({ ...f, half_session: e.target.checked ? val : '' }))} /> {lbl}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
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
  const [actualIn, setActualIn] = useState('09:00')   // default shift start 9 AM
  const [actualOut, setActualOut] = useState('18:00') // default shift end 6 PM
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Regularisation is allowed only for PAST dates — not today, not future.
  const localYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayStr = localYMD(new Date())
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localYMD(d) })()

  const submit = async () => {
    if (!dateVal) { setMsg({ text:'Select the attendance date', ok:false }); return }
    if (dateVal >= todayStr) { setMsg({ text:'Regularisation is allowed only for past dates — not the current day or future.', ok:false }); return }
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
        <div style={{ gridColumn:'1/-1' }}><label style={T.label}>Attendance date * <span style={{ fontWeight:400, color:'#9CA3AF' }}>(past dates only)</span></label>{editable
          ? <input type="date" max={yesterdayStr} style={T.input} value={dateVal} onChange={e => setDateVal(e.target.value)} />
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

// ── Voluntary PF (VPF) — EPF wage base × percent ──
function VpfSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:'#1E1B4B', purple:'#7C3AED', purpleDark:'#3C3489', border:'#E9E7F5', muted:'#6B6B7B', red:'#A32D2D', redBg:'#FCEBEB', amber:'#854F0B', amberBg:'#FAEEDA', teal:'#0F6E56' }
  const MAX_PCT = 88, HIGH_ALERT = 50
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [pctInput, setPctInput] = useState('10')
  const [ack, setAck] = useState(false)
  const [saving, setSaving] = useState(false)
  const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/ess/vpf?employee_id=${emp.id}`).then(r => r.json()).then(d => {
      setData(d); if (d?.current_vpf) setPctInput(String(d.current_vpf.vpf_percent)); setLoading(false)
    }).catch(() => setLoading(false))
  }, [emp.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading…</div>
  const e = data?.employee
  if (!e) return <div style={{ padding: 20, color: V.red, fontSize: 13 }}>Salary data not found.</div>
  const base = e.epf_wage_base
  const current = data?.current_vpf
  let rawPct = parseFloat(pctInput) || 0
  let capHit = false
  if (rawPct > MAX_PCT) { capHit = true; rawPct = MAX_PCT }
  const vpfMonthly = Math.round(base * rawPct / 100)
  const vpfAnnual = vpfMonthly * 12
  const total80c = e.epf_annual + vpfAnnual
  const over80c = total80c > e.c80_limit
  const barPct = Math.min(100, Math.round(total80c / e.c80_limit * 100))
  const showHighAlert = rawPct > HIGH_ALERT && !capHit

  const submit = async () => {
    setSaving(true)
    const res = await fetch('/api/ess/vpf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.id, vpf_percent: rawPct, effective_from_month: 4, acknowledged: true }) })
    setSaving(false)
    if (res.ok) { notify('VPF request submitted ✓'); setAck(false); load() }
    else { const j = await res.json().catch(() => ({})); notify('Failed: ' + (j.error || ''), 'error') }
  }
  const stop = async () => {
    const res = await fetch('/api/ess/vpf', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.id, stopped_reason: 'Employee requested', stopped_from_month: 4 }) })
    if (res.ok) { notify('VPF stopped'); load() } else notify('Failed to stop', 'error')
  }
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0' }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: V.navy }}>Voluntary PF (VPF)</div>
        <div style={{ fontSize: 12.5, color: V.muted, marginTop: 2 }}>Apni EPF wages se extra PF deduction — apna percentage set karo.</div>
      </div>

      {!e.has_ctc && (
        <div style={{ ...card, background: V.amberBg, border: '1px solid #EFD9A8' }}>
          <span style={{ fontSize: 12, color: '#633806' }}>ⓘ Your CTC is not configured yet, so the EPF wage base shows ₹0. Ask HR to set your CTC (ctc_master) — then VPF will calculate correctly.</span>
        </div>
      )}

      {current && (
        <div style={{ ...card, background: '#EEF7F3', border: '1px solid #C5E8DB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: V.teal }}>Active VPF: {current.vpf_percent}% ({inr(current.monthly_vpf_amount)}/mo) — modify below</span>
          <button onClick={stop} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: `1px solid ${V.red}`, background: '#fff', color: V.red, cursor: 'pointer', fontFamily: 'inherit' }}>Stop VPF</button>
        </div>
      )}

      <div style={{ ...card, background: '#FBFAFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: V.muted }}>Your EPF wages (from database)</span>
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: e.is_capped ? '#EEEDFE' : '#E1F5EE', color: e.is_capped ? V.purpleDark : V.teal }}>{e.is_capped ? 'Capped ₹15,000' : 'Actual (Gross − HRA)'}</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, color: V.purpleDark }}>{inr(base)}</div>
        <div style={{ ...row, borderTop: `1px solid ${V.border}`, marginTop: 10, paddingTop: 8 }}>
          <span style={{ fontSize: 12, color: V.muted }}>Current mandatory EPF (12%)</span>
          <span style={{ fontSize: 13, color: V.navy }}>{inr(e.mandatory_epf_monthly)}/mo</span>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: V.muted, display: 'block', marginBottom: 6 }}>VPF percentage</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="number" value={pctInput} min={1} step={1} onChange={e2 => setPctInput(e2.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${V.border}`, fontSize: 15, fontFamily: 'inherit' }} placeholder="e.g. 25" />
          <span style={{ fontSize: 16, fontWeight: 500, color: V.purpleDark }}>%</span>
        </div>
        <div style={{ fontSize: 11, color: '#9B9BA8', marginTop: 4 }}>Percentage of your EPF wages.</div>
      </div>

      {showHighAlert && (
        <div style={{ display: 'flex', gap: 8, background: V.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <span style={{ color: V.red }}>⚠</span>
          <span style={{ fontSize: 12, color: '#791F1F', lineHeight: 1.6 }}><strong>Itna zyada?</strong> {Math.round(rawPct)}% ({inr(vpfMonthly)}/mo) VPF — net in-hand bahut kam ho jayegi. Confirm karein.</span>
        </div>
      )}
      {capHit && (
        <div style={{ display: 'flex', gap: 8, background: V.amberBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <span style={{ color: V.amber }}>ⓘ</span>
          <span style={{ fontSize: 12, color: '#633806', lineHeight: 1.6 }}>Max {MAX_PCT}% allowed (12% mandatory + {MAX_PCT}% = 100%). Set to {MAX_PCT}%.</span>
        </div>
      )}

      <div style={{ ...card, background: '#FBFAFF' }}>
        <div style={row}><span style={{ fontSize: 13, color: V.muted }}>VPF deduction (monthly)</span><span style={{ fontSize: 15, fontWeight: 500, color: V.purpleDark }}>{inr(vpfMonthly)}</span></div>
        <div style={{ ...row, borderTop: `1px solid ${V.border}` }}><span style={{ fontSize: 13, color: V.muted }}>VPF (annual)</span><span style={{ fontSize: 13, color: V.navy }}>{inr(vpfAnnual)}</span></div>
        <div style={{ ...row, borderTop: `1px solid ${V.border}` }}><span style={{ fontSize: 13, color: V.red }}>Net in-hand impact</span><span style={{ fontSize: 13, fontWeight: 500, color: V.red }}>−{inr(vpfMonthly)}/mo</span></div>
      </div>

      <div style={{ ...card, background: '#FBFAFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: V.muted }}>80C usage (₹1.5L max)</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: V.navy }}>{inr(Math.min(total80c, e.c80_limit))} / ₹1.5L</span>
        </div>
        <div style={{ height: 8, background: '#E9E7F5', borderRadius: 20, overflow: 'hidden' }}><div style={{ height: '100%', width: `${barPct}%`, background: over80c ? '#EF9F27' : V.purple, borderRadius: 20 }} /></div>
        <div style={{ fontSize: 11, color: '#9B9BA8', marginTop: 6 }}>EPF ({inr(e.epf_annual)}) + VPF ({inr(vpfAnnual)}) = {inr(total80c)}{over80c ? ` — ${inr(total80c - e.c80_limit)} pe 80C benefit nahi` : ''}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, background: V.redBg, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <span style={{ color: V.red }}>ⓘ</span>
        <div style={{ fontSize: 12, color: '#791F1F', lineHeight: 1.7 }}><strong>Dhyaan se select karein:</strong><br />• VPF se aapki <strong>net in-hand salary kam</strong> ho jayegi<br />• 80C exemption sirf <strong>₹1.5 lakh tak</strong> (EPF + VPF + baaki 80C)<br />• Ye har mahine deduct hoga jab tak aap band na karein</div>
      </div>

      <label style={{ display: 'flex', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={e2 => setAck(e2.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: V.purple }} />
        <span style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>Main samajh gaya/gayi hoon ki isse meri net in-hand salary kam hogi aur 80C exemption ₹1.5L tak seemit hai. Main ye VPF deduction request karta/karti hoon.</span>
      </label>

      <button disabled={!ack || saving} onClick={submit} style={{ width: '100%', padding: 12, borderRadius: 8, fontWeight: 500, fontFamily: 'inherit', border: ack ? `1px solid ${V.purple}` : `1px solid ${V.border}`, background: ack ? V.purple : '#F5F3FF', color: ack ? '#fff' : '#9B9BA8', cursor: ack ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : 'Acknowledge & submit'}</button>
    </div>
  )
}

// ── Corporate NPS enrolment (80CCD(2)) — % of Basic by regime ──
function NpsSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:'#1E1B4B', purple:'#7C3AED', purpleDark:'#3C3489', border:'#E9E7F5', muted:'#6B6B7B', red:'#A32D2D', amber:'#854F0B', amberBg:'#FAEEDA', blue:'#185FA5', blueBg:'#E6F1FB', teal:'#0F6E56', bg:'#F5F3FF' }
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [hasPran, setHasPran] = useState(true)
  const [pran, setPran] = useState('')
  const [pranName, setPranName] = useState('')
  const [tier, setTier] = useState('Tier I')
  const [ack, setAck] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitPran, setSubmitPran] = useState('')
  const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/ess/nps?employee_id=${emp.id}`).then(r => r.json()).then(d => {
      setData(d); if (d?.employee) setPranName(d.employee.name); setLoading(false)
    }).catch(() => setLoading(false))
  }, [emp.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading…</div>
  const e = data?.employee
  if (!e) return <div style={{ padding: 20, color: V.red, fontSize: 13 }}>Salary data not found.</div>
  const current = data?.current_nps
  const effFmt = new Date(e.effective_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const pranClean = pran.replace(/\D/g, '')
  const pranValid = pranClean.length === e.pran_length
  const canSubmit = ack && (!hasPran || pranValid)
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }
  const label: React.CSSProperties = { fontSize: 12, color: V.muted, display: 'block', marginBottom: 6 }
  const input: React.CSSProperties = { width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${V.border}`, fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }

  const submit = async () => {
    setSaving(true)
    const res = await fetch('/api/ess/nps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.id, has_existing_pran: hasPran, pran_number: hasPran ? pranClean : null, pran_holder_name: pranName, tier_type: tier, acknowledged: true }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok) { notify(d.pending_pran ? 'PRAN form emailed — submit within 3 days' : 'NPS enrolment submitted ✓'); setAck(false); load() }
    else notify('Failed: ' + (d.error || ''), 'error')
  }
  const doSubmitPran = async () => {
    const res = await fetch('/api/ess/nps', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.id, action: 'SUBMIT_PRAN', pran_number: submitPran }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok) { notify('PRAN submitted — NPS active ✓'); setSubmitPran(''); load() } else notify('Failed: ' + (d.error || ''), 'error')
  }
  const stop = async () => {
    const res = await fetch('/api/ess/nps', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: emp.id, action: 'STOP', stopped_reason: 'Employee requested' }) })
    if (res.ok) { notify('NPS stopped'); load() } else notify('Failed to stop', 'error')
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: V.navy }}>Corporate NPS enrolment</div>
        <div style={{ fontSize: 12.5, color: V.muted, marginTop: 2 }}>Employer contributes to your NPS (Tier I) — extra tax benefit under Section 80CCD(2).</div>
      </div>

      {!e.has_ctc && (
        <div style={{ ...card, background: V.amberBg, border: '1px solid #EFD9A8' }}>
          <span style={{ fontSize: 12, color: '#633806' }}>ⓘ Your CTC (Basic) isn't configured yet, so NPS shows ₹0. Ask HR to set your CTC (ctc_master).</span>
        </div>
      )}

      {current && (
        <div style={{ ...card, background: current.status === 'PENDING_PRAN' ? V.blueBg : '#EEF7F3', border: `1px solid ${current.status === 'PENDING_PRAN' ? '#B5D4F4' : '#C5E8DB'}` }}>
          {current.status === 'PENDING_PRAN' ? (
            <div>
              <div style={{ fontSize: 12, color: V.blue, marginBottom: 8 }}>PRAN pending — generate & submit by {current.pran_deadline ? new Date(current.pran_deadline).toLocaleDateString('en-IN') : '—'}.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={submitPran} onChange={e2 => setSubmitPran(e2.target.value.replace(/\D/g, ''))} maxLength={e.pran_length} placeholder={`Enter ${e.pran_length}-digit PRAN`} style={{ ...input, letterSpacing: 2 }} />
                <button onClick={doSubmitPran} disabled={submitPran.replace(/\D/g, '').length !== e.pran_length} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: V.purple, color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Submit PRAN</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: V.teal }}>Active NPS: {current.contribution_percent}% of Basic ({inr(current.monthly_nps_amount)}/mo)</span>
              <button onClick={stop} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: `1px solid ${V.red}`, background: '#fff', color: V.red, cursor: 'pointer', fontFamily: 'inherit' }}>Stop NPS</button>
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, background: '#FBFAFF' }}>
        <div style={{ fontSize: 12, color: V.muted, marginBottom: 8 }}>Your contribution (from salary structure)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div><div style={{ fontSize: 11, color: V.muted }}>Monthly Basic</div><div style={{ fontSize: 15, fontWeight: 500, color: V.navy }}>{inr(e.basic_monthly)}</div></div>
          <div><div style={{ fontSize: 11, color: V.muted }}>Tax regime</div><div style={{ fontSize: 15, fontWeight: 500, color: V.navy }}>{e.tax_regime === 'OLD' ? 'Old' : 'New'}</div></div>
          <div><div style={{ fontSize: 11, color: V.muted }}>NPS rate</div><div style={{ fontSize: 15, fontWeight: 500, color: V.purpleDark }}>{e.contribution_percent}%</div></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${V.border}`, marginTop: 10, paddingTop: 8 }}>
          <span style={{ fontSize: 12, color: V.muted }}>Monthly NPS contribution</span><span style={{ fontSize: 14, fontWeight: 500, color: V.purpleDark }}>{inr(e.monthly_nps_amount)}/mo</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
          <span style={{ fontSize: 12, color: V.muted }}>Effective from</span><span style={{ fontSize: 13, color: V.navy }}>{effFmt}</span>
        </div>
        <div style={{ fontSize: 11, color: '#9B9BA8', marginTop: 6 }}>Old regime = 10% of Basic · New regime = 14% of Basic</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: V.muted, marginBottom: 8 }}>Do you already have an NPS account (PRAN)?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setHasPran(true)} style={{ flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', border: hasPran ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: hasPran ? V.bg : '#fff', color: hasPran ? V.purpleDark : V.navy }}>Yes, I have a PRAN</button>
          <button onClick={() => setHasPran(false)} style={{ flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', border: !hasPran ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: !hasPran ? V.bg : '#fff', color: !hasPran ? V.purpleDark : V.navy }}>No, I need one</button>
        </div>
      </div>

      {hasPran ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>PRAN number ({e.pran_length} digits)</label>
            <input type="text" value={pran} maxLength={e.pran_length} onChange={e2 => setPran(e2.target.value.replace(/\D/g, ''))} placeholder="e.g. 110012345678" style={{ ...input, letterSpacing: 2 }} />
            <div style={{ fontSize: 11, marginTop: 4, color: pran.length === 0 ? V.muted : pranValid ? V.teal : V.amber }}>{pran.length === 0 ? `Enter your ${e.pran_length}-digit PRAN` : pranValid ? `Valid ${e.pran_length}-digit PRAN` : `${e.pran_length - pranClean.length} more digit(s) needed`}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div><label style={label}>Name as per PRAN</label><input type="text" value={pranName} onChange={e2 => setPranName(e2.target.value)} style={input} /></div>
            <div><label style={label}>Account tier</label><select value={tier} onChange={e2 => setTier(e2.target.value)} style={input}><option>Tier I</option><option>Tier II</option></select></div>
          </div>
        </>
      ) : (
        <div style={{ background: V.blueBg, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: V.blue }}>✉</span>
            <div style={{ fontSize: 12, color: '#0C447C', lineHeight: 1.7 }}><strong>A new PRAN will be created for you.</strong><br />On submit, we'll email you the PRAN creation form. Generate your PRAN <strong>within 3 days</strong>, then resubmit here. For help, contact the <strong>Payroll team</strong>.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, background: V.amberBg, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <span style={{ color: V.amber }}>ⓘ</span>
        <div style={{ fontSize: 12, color: '#633806', lineHeight: 1.7 }}><strong>Please read carefully:</strong><br />• NPS is a long-term retirement product — locked in until age 60 (limited early withdrawal)<br />• Employer contribution is over & above your ₹1.5L 80C limit (Section 80CCD(2))<br />• Recurring monthly contribution, reflects in your salary structure<br />• Rate follows your tax regime (10% old / 14% new of Basic)</div>
      </div>

      <label style={{ display: 'flex', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={e2 => setAck(e2.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: V.purple }} />
        <span style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>I confirm I want to enrol in the corporate NPS. I understand the contribution will be a percentage of my Basic as per my tax regime, effective from the 1st of next month, and that NPS is a long-term retirement product with lock-in until age 60.</span>
      </label>

      <button disabled={!canSubmit || saving} onClick={submit} style={{ width: '100%', padding: 12, borderRadius: 8, fontWeight: 500, fontFamily: 'inherit', border: canSubmit ? `1px solid ${V.purple}` : `1px solid ${V.border}`, background: canSubmit ? V.purple : '#F5F3FF', color: canSubmit ? '#fff' : '#9B9BA8', cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{saving ? 'Submitting…' : hasPran ? 'Acknowledge & submit' : 'Submit & email me the PRAN form'}</button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// LOANS (ESS) — apply, track requests, sign agreement, manage loans
// ════════════════════════════════════════════════════════════════
const LOAN_V = { navy:'#1E1B4B', purple:'#7C3AED', purpleDark:'#3C3489', border:'#E9E7F5', muted:'#6B6B7B', red:'#A32D2D', redBg:'#FCEBEB', amber:'#854F0B', amberBg:'#FAEEDA', teal:'#0F6E56', tealBg:'#EEF7F3', bg:'#F5F3FF' }
const loanInr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
// reducing-balance EMI
function loanEmi(P: number, ratePct: number, n: number): number {
  if (!P || !n) return 0
  if (!ratePct) return Math.round(P / n)
  const r = ratePct / 12 / 100
  const f = Math.pow(1 + r, n)
  return Math.round(P * r * f / (f - 1))
}
function LoanStatusBadge({ status }: { status: string }) {
  const s = (status || '').toUpperCase()
  const map: Record<string, [string, string]> = {
    SUBMITTED:['#FAEEDA','#854F0B'], IN_APPROVAL:['#FAEEDA','#854F0B'], REQUESTED:['#FAEEDA','#854F0B'], GENERATED:['#FAEEDA','#854F0B'], UNDER_REVIEW:['#E6F1FB','#185FA5'], PENDING_PRAN:['#E6F1FB','#185FA5'],
    APPROVED:['#EEF7F3','#0F6E56'], RECOVERING:['#EEF7F3','#0F6E56'], DISBURSED:['#EEF7F3','#0F6E56'], SIGNED:['#EEF7F3','#0F6E56'],
    REJECTED:['#FCEBEB','#A32D2D'], CANCELLED:['#FCEBEB','#A32D2D'], EXIT_RECOVERY:['#FCEBEB','#A32D2D'],
    CLOSED:['#F1F5F9','#64748B'], FORECLOSED:['#F1F5F9','#64748B'],
  }
  const [bg, c] = map[s] || ['#F3F0FF','#6D28D9']
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600, whiteSpace:'nowrap' }}>{s.replace(/_/g,' ')}</span>
}

// Inline agreement signing panel
function LoanAgreementPanel({ requestId, employeeId, notify, onClose, onDone }: { requestId: string; employeeId: string; notify: (m: string, t?: 'success'|'error') => void; onClose: () => void; onDone: () => void }) {
  const V = LOAN_V
  const [agr, setAgr] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'ESIGN'|'UPLOAD'>('ESIGN')
  const [esignName, setEsignName] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setLoading(true)
    fetch(`/api/ess/loans/agreement?request_id=${requestId}`).then(r => r.json()).then(d => {
      setAgr(d?.agreement || null); setLoading(false)
    }).catch(() => setLoading(false))
  }, [requestId])
  const card: React.CSSProperties = { background:'#fff', border:`1px solid ${V.border}`, borderRadius:12, padding:16, marginBottom:14 }
  const input: React.CSSProperties = { width:'100%', padding:10, borderRadius:8, border:`1px solid ${V.border}`, fontSize:14, boxSizing:'border-box', fontFamily:'inherit' }

  const submit = async () => {
    if (!agr) return
    if (mode === 'ESIGN' && !esignName.trim()) { notify('Type your full name to e-sign', 'error'); return }
    if (mode === 'UPLOAD' && !pdfUrl.trim()) { notify('Paste the signed PDF URL', 'error'); return }
    setSaving(true)
    const body = mode === 'ESIGN'
      ? { agreement_id: agr.id, employee_id: employeeId, signature_type: 'ESIGN', esign_name: esignName.trim(), esign_image_url: 'data:text/plain,' + encodeURIComponent(esignName.trim()) }
      : { agreement_id: agr.id, employee_id: employeeId, signature_type: 'UPLOAD', signed_pdf_url: pdfUrl.trim() }
    const res = await fetch('/api/ess/loans/agreement', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok) { notify('Agreement submitted for review'); onDone() }
    else notify('Failed: ' + (d.error || ''), 'error')
  }

  if (loading) return <div style={{ ...card }}><div style={{ color:V.muted, fontSize:13 }}>Loading agreement…</div></div>
  if (!agr) return (
    <div style={card}>
      <div style={{ fontSize:13, color:V.red, marginBottom:8 }}>No agreement found yet — please check back shortly.</div>
      <button onClick={onClose} style={{ padding:'7px 13px', borderRadius:7, border:`1px solid ${V.border}`, background:'#fff', color:V.purpleDark, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>Close</button>
    </div>
  )
  const schedule: any[] = Array.isArray(agr.schedule_snapshot) ? agr.schedule_snapshot : (typeof agr.schedule_snapshot === 'string' ? (() => { try { return JSON.parse(agr.schedule_snapshot) } catch { return [] } })() : [])
  const th: React.CSSProperties = { fontSize:10, textAlign:'right', padding:'6px 8px', color:V.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }
  const td: React.CSSProperties = { fontSize:11, textAlign:'right', padding:'6px 8px', color:V.navy, whiteSpace:'nowrap' }
  return (
    <div style={{ ...card, borderColor:V.purple }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ fontSize:14, fontWeight:600, color:V.navy }}>Sign agreement — {agr.agreement_number}</div>
        <div style={{ display:'flex', gap:8 }}>
          <a href={`/api/ess/loans/agreement?request_id=${requestId}&format=html`} target="_blank" rel="noreferrer" style={{ padding:'5px 11px', borderRadius:7, border:`1px solid ${V.border}`, background:'#fff', color:V.purpleDark, textDecoration:'none', fontSize:11 }}>📄 View / print</a>
          <button onClick={onClose} style={{ padding:'5px 11px', borderRadius:7, border:`1px solid ${V.border}`, background:'#fff', color:V.purpleDark, cursor:'pointer', fontFamily:'inherit', fontSize:11 }}>Close</button>
        </div>
      </div>
      <div style={{ overflowX:'auto', border:`1px solid ${V.border}`, borderRadius:8, marginBottom:14 }}>
        <table style={{ borderCollapse:'collapse', width:'100%', minWidth:520 }}>
          <thead><tr style={{ background:'#FBFAFF' }}>
            <th style={{ ...th, textAlign:'left' }}>#</th><th style={th}>Due</th><th style={th}>EMI</th><th style={th}>Principal</th><th style={th}>Interest</th><th style={th}>Closing</th>
          </tr></thead>
          <tbody>
            {schedule.map((s, i) => (
              <tr key={i} style={{ borderTop:`1px solid ${V.border}` }}>
                <td style={{ ...td, textAlign:'left' }}>{s.installment_number}</td>
                <td style={td}>{s.due_date || s.month || '—'}</td>
                <td style={td}>{loanInr(s.emi_amount)}</td>
                <td style={td}>{loanInr(s.principal_component)}</td>
                <td style={td}>{loanInr(s.interest_component)}</td>
                <td style={td}>{loanInr(s.closing_balance)}</td>
              </tr>
            ))}
            {schedule.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign:'center', color:V.muted }}>No schedule rows.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <button onClick={() => setMode('ESIGN')} style={{ flex:1, padding:9, borderRadius:8, cursor:'pointer', fontWeight:500, fontFamily:'inherit', fontSize:12, border: mode==='ESIGN' ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: mode==='ESIGN' ? V.bg : '#fff', color: mode==='ESIGN' ? V.purpleDark : V.navy }}>✍️ E-sign</button>
        <button onClick={() => setMode('UPLOAD')} style={{ flex:1, padding:9, borderRadius:8, cursor:'pointer', fontWeight:500, fontFamily:'inherit', fontSize:12, border: mode==='UPLOAD' ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: mode==='UPLOAD' ? V.bg : '#fff', color: mode==='UPLOAD' ? V.purpleDark : V.navy }}>📎 Upload signed PDF</button>
      </div>
      {mode === 'ESIGN' ? (
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:V.muted, display:'block', marginBottom:6 }}>Type your full legal name to sign</label>
          <input value={esignName} onChange={e => setEsignName(e.target.value)} placeholder="e.g. Rahul Sharma" style={input} />
          {esignName.trim() && <div style={{ marginTop:8, padding:'10px 14px', border:`1px dashed ${V.purple}`, borderRadius:8, fontFamily:'"Segoe Script","Brush Script MT",cursive', fontSize:22, color:V.purpleDark }}>{esignName}</div>}
        </div>
      ) : (
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:V.muted, display:'block', marginBottom:6 }}>URL of your signed agreement PDF</label>
          <input value={pdfUrl} onChange={e => setPdfUrl(e.target.value)} placeholder="https://…/signed-agreement.pdf" style={input} />
        </div>
      )}
      <button disabled={saving} onClick={submit} style={{ width:'100%', padding:12, borderRadius:8, fontWeight:500, fontFamily:'inherit', border:`1px solid ${V.purple}`, background:V.purple, color:'#fff', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Submitting…' : 'Submit signed agreement'}</button>
    </div>
  )
}

function LoansSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = LOAN_V
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [typeId, setTypeId] = useState('')
  const [amount, setAmount] = useState('')
  const [tenure, setTenure] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [signingReq, setSigningReq] = useState<string | null>(null)
  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/ess/loans?employee_id=${emp.id}`).then(r => r.json()).then(d => {
      setData(d)
      if (d?.loan_types?.length && !typeId) setTypeId(d.loan_types[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [emp.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const card: React.CSSProperties = { background:'#fff', border:`1px solid ${V.border}`, borderRadius:12, padding:16, marginBottom:14 }
  const label: React.CSSProperties = { fontSize:12, color:V.muted, display:'block', marginBottom:6 }
  const input: React.CSSProperties = { width:'100%', padding:10, borderRadius:8, border:`1px solid ${V.border}`, fontSize:14, boxSizing:'border-box', fontFamily:'inherit' }

  if (loading) return <div style={{ padding:20, color:V.muted, fontSize:13 }}>Loading…</div>

  const loanTypes: any[] = data?.loan_types || []
  const myLoans: any[] = data?.my_loans || []
  const pending: any[] = data?.pending_requests || []
  const hasCtc = data?.has_ctc
  const sel = loanTypes.find((t: any) => t.id === typeId)
  const amtNum = parseFloat(amount) || 0
  const tenNum = parseInt(tenure) || 0
  const rate = sel ? Number(sel.interest_rate) || 0 : 0
  const indicativeEmi = loanEmi(amtNum, rate, tenNum)

  const submit = async () => {
    if (!sel) { notify('Select a loan type', 'error'); return }
    if (amtNum <= 0) { notify('Enter an amount', 'error'); return }
    if (tenNum <= 0) { notify('Enter tenure in months', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/ess/loans', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ employee_id: emp.id, loan_type_id: typeId, requested_amount: amtNum, requested_tenure_months: tenNum, reason }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.success) { notify('Loan request submitted ✓'); setAmount(''); setTenure(''); setReason(''); load() }
    else notify(d.error || 'Failed to submit', 'error')
  }

  const manage = async (loan: any, request_type: 'CLOSURE'|'PART_PAYMENT') => {
    let amt: number | undefined
    if (request_type === 'PART_PAYMENT') {
      const raw = window.prompt('Part-payment amount (₹):', String(Math.round(loan.outstanding_principal || 0)))
      if (raw == null) return
      amt = parseFloat(raw) || 0
      if (amt <= 0) { notify('Enter a valid amount', 'error'); return }
    } else {
      if (!window.confirm(`Foreclose ${loan.loan_number}? Outstanding ${loanInr(loan.outstanding_principal)} will be recovered.`)) return
    }
    const res = await fetch('/api/ess/loans', { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ loan_id: loan.id, employee_id: emp.id, request_type, amount: amt }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.success) { notify(request_type === 'CLOSURE' ? 'Foreclosure request submitted' : 'Part-payment request submitted'); load() }
    else notify(d.error || 'Failed', 'error')
  }

  const row: React.CSSProperties = { display:'flex', justifyContent:'space-between', gap:10, padding:'8px 0', borderBottom:`1px solid ${V.border}`, fontSize:12.5, alignItems:'center', flexWrap:'wrap' }

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:600, color:V.navy }}>Loans</div>
        <div style={{ fontSize:12.5, color:V.muted, marginTop:2 }}>Apply for a company loan, track approvals, sign your agreement, and manage repayments.</div>
      </div>

      {!hasCtc && (
        <div style={{ ...card, background:V.amberBg, border:'1px solid #EFD9A8' }}>
          <span style={{ fontSize:12, color:'#633806' }}>ⓘ CTC not configured — eligibility shows ₹0; ask HR to set CTC.</span>
        </div>
      )}

      {/* Apply for a loan */}
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:V.navy, marginBottom:12 }}>Apply for a loan</div>
        {loanTypes.length === 0 ? <div style={{ fontSize:12, color:V.muted }}>No loan types configured for your company.</div> : (
          <>
            <div style={{ marginBottom:12 }}>
              <label style={label}>Loan type</label>
              <select value={typeId} onChange={e => setTypeId(e.target.value)} style={input}>
                {loanTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {sel && <div style={{ fontSize:11, color:V.purpleDark, marginTop:6 }}>Max eligible {loanInr(sel.max_eligible)} · {Number(sel.interest_rate) || 0}% {sel.interest_type ? `(${sel.interest_type})` : ''} · tenure {sel.min_tenure_months}–{sel.max_tenure_months} months</div>}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <div>
                <label style={label}>Amount (₹)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 100000" style={input} />
                {sel && amtNum > Number(sel.max_eligible) && <div style={{ fontSize:11, color:V.red, marginTop:4 }}>Max eligible is {loanInr(sel.max_eligible)}</div>}
              </div>
              <div>
                <label style={label}>Tenure (months)</label>
                <input type="number" value={tenure} onChange={e => setTenure(e.target.value)} placeholder={sel ? `${sel.min_tenure_months}–${sel.max_tenure_months}` : 'months'} style={input} />
                {sel && tenNum > 0 && (tenNum < sel.min_tenure_months || tenNum > sel.max_tenure_months) && <div style={{ fontSize:11, color:V.red, marginTop:4 }}>Tenure must be {sel.min_tenure_months}–{sel.max_tenure_months} months</div>}
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={label}>Reason</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Purpose of the loan…" style={{ ...input, minHeight:70, resize:'vertical' }} />
            </div>
            <div style={{ ...card, background:'#FBFAFF', marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:12, color:V.muted }}>Indicative EMI (reducing balance)</span>
                <span style={{ fontSize:18, fontWeight:600, color:V.purpleDark }}>{loanInr(indicativeEmi)}<span style={{ fontSize:11, color:V.muted, fontWeight:400 }}>/mo</span></span>
              </div>
            </div>
            <button disabled={saving} onClick={submit} style={{ width:'100%', padding:12, borderRadius:8, fontWeight:500, fontFamily:'inherit', border:`1px solid ${V.purple}`, background:V.purple, color:'#fff', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Submitting…' : 'Submit loan request'}</button>
          </>
        )}
      </div>

      {/* Inline agreement signing */}
      {signingReq && <LoanAgreementPanel requestId={signingReq} employeeId={emp.id} notify={notify} onClose={() => setSigningReq(null)} onDone={() => { setSigningReq(null); load() }} />}

      {/* Pending requests */}
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:V.navy, marginBottom:10 }}>Pending requests</div>
        {pending.length === 0 ? <div style={{ fontSize:12, color:V.muted }}>No pending requests.</div> : pending.map((p: any) => {
          const t = loanTypes.find((x: any) => x.id === p.loan_type_id)
          return (
            <div key={p.id} style={row}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:V.navy }}>{t?.name || 'Loan'} · {loanInr(p.requested_amount)}</div>
                <div style={{ fontSize:11, color:V.muted, marginTop:2 }}>EMI {loanInr(p.indicative_emi)} · {p.requested_tenure_months} mo · approval level {p.current_approval_level ?? '—'}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <LoanStatusBadge status={p.status} />
                {(p.status || '').toUpperCase() === 'APPROVED' && <button onClick={() => setSigningReq(p.id)} style={{ padding:'6px 12px', borderRadius:7, border:'none', background:V.purple, color:'#fff', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Sign agreement</button>}
              </div>
            </div>
          )
        })}
      </div>

      {/* My loans */}
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:V.navy, marginBottom:10 }}>My loans</div>
        {myLoans.length === 0 ? <div style={{ fontSize:12, color:V.muted }}>No active loans.</div> : myLoans.map((l: any) => {
          const isRecovering = (l.status || '').toUpperCase() === 'RECOVERING'
          return (
            <div key={l.id} style={{ padding:'10px 0', borderBottom:`1px solid ${V.border}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ fontSize:13, fontWeight:600, color:V.navy }}>{l.loan_number}</div>
                <LoanStatusBadge status={l.status} />
              </div>
              <div style={{ fontSize:11.5, color:V.muted, marginTop:4, lineHeight:1.7 }}>
                Principal {loanInr(l.principal)} · EMI {loanInr(l.emi_amount)}/mo · Outstanding <b style={{ color:V.navy }}>{loanInr(l.outstanding_principal)}</b><br />
                Paid {l.paid_installments ?? 0} / {(l.paid_installments ?? 0) + (l.remaining_installments ?? 0)} installments · {l.remaining_installments ?? 0} remaining
                {l.disbursement_date ? ` · disbursed ${fmt(l.disbursement_date)}` : ''}
              </div>
              {isRecovering && (
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button onClick={() => manage(l, 'CLOSURE')} style={{ padding:'6px 12px', borderRadius:7, border:`1px solid ${V.red}`, background:'#fff', color:V.red, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Foreclose</button>
                  <button onClick={() => manage(l, 'PART_PAYMENT')} style={{ padding:'6px 12px', borderRadius:7, border:`1px solid ${V.purple}`, background:'#fff', color:V.purpleDark, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Part-payment</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
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

// ── Flexi Benefit Plan (FBP) — the employee's company policy for their salary slab ──
function FlexiSection({ emp }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:'#1E1B4B', purple:'#7C3AED', purpleDark:'#3C3489', border:'#E9E7F5', muted:'#6B6B7B', purpleBg:'#F5F3FF' }
  const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
  const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'nopolicy'>('loading')
  const [slab, setSlab] = useState<any>(null)
  const [rows, setRows] = useState<any[]>([])
  const [annualFixed, setAnnualFixed] = useState(0)
  const [regime, setRegime] = useState<'old' | 'new'>('old')
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      setStatus('loading')
      const { data: e } = await supabase.from('employees').select('company_id, tds_regime, companies(company_name)').eq('id', emp.id).maybeSingle()
      const companyId = (e as any)?.company_id
      if ((e as any)?.companies?.company_name) setCompanyName((e as any).companies.company_name)
      if ((e as any)?.tds_regime) setRegime(String((e as any).tds_regime).toLowerCase().includes('new') ? 'new' : 'old')
      if (!companyId) { if (live) setStatus('nopolicy'); return }

      // Annual fixed = CTC − variable (from salary_structures, else ctc_master).
      let fixed = 0
      const { data: ss } = await supabase.from('salary_structures').select('gross_monthly, employer_pf, employer_esic, gratuity_monthly').eq('employee_id', emp.id).order('effective_date', { ascending: false }).limit(1)
      if (ss?.[0]) {
        const s = ss[0]
        fixed = (num(s.gross_monthly) + num(s.employer_pf) + num(s.employer_esic) + num(s.gratuity_monthly)) * 12
      } else {
        const { data: cm } = await supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', emp.id).order('effective_from', { ascending: false }).limit(1)
        if (cm?.[0]) fixed = num(cm[0].annual_ctc) - num(cm[0].annual_variable)
      }
      if (live) setAnnualFixed(fixed)

      const { data: slabs } = await supabase.from('flexi_policy_slabs').select('*').eq('company_id', companyId).eq('is_active', true).order('sort_order')
      if (!slabs?.length) { if (live) setStatus('nopolicy'); return }
      const found = slabs.find((sl: any) => fixed >= num(sl.fixed_from) && fixed <= num(sl.fixed_to)) || slabs[slabs.length - 1]

      const [{ data: limits }, { data: comps }] = await Promise.all([
        supabase.from('flexi_slab_limits').select('*').eq('slab_id', found.id).eq('is_active', true),
        supabase.from('flexi_components').select('*'),
      ])
      const byId: Record<string, any> = {}
      ;(comps || []).forEach((c: any) => { byId[c.id] = c })
      const merged = (limits || []).map((l: any) => ({ ...l, comp: byId[l.component_id] })).filter((x: any) => x.comp)
        .sort((a: any, b: any) => (a.comp.sort_order || 0) - (b.comp.sort_order || 0))
      if (live) { setSlab(found); setRows(merged); setStatus(merged.length ? 'ready' : 'nopolicy') }
    })()
    return () => { live = false }
  }, [emp.id])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }

  if (status === 'loading') return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading flexi policy…</div>
  if (status === 'nopolicy') return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>🎛️ Flexi Benefit Plan</div>
      <div style={{ fontSize: 12.5, color: V.muted }}>No flexi (FBP) policy is configured for {companyName || 'your company'}{annualFixed ? ` at your salary band (${inr(annualFixed)} annual fixed)` : ''} yet. Please check with HR / Payroll.</div>
    </div>
  )

  const amt = (r: any) => {
    const max = regime === 'old' ? r.old_regime_max : r.new_regime_max
    const avail = regime === 'old' ? r.comp.old_available : r.comp.new_available
    if (max == null || avail === false) return { text: '—', muted: true }
    if (r.is_formula || max === -1) return { text: '8.33% of Basic', muted: false }
    return { text: inr(num(max)) + '/yr', muted: false }
  }
  const totalDeclarable = rows.reduce((s, r) => {
    const max = regime === 'old' ? r.old_regime_max : r.new_regime_max
    return (max == null || max === -1) ? s : s + num(max)
  }, 0)

  return (
    <div>
      <div style={{ ...card, background: V.purpleBg, borderColor: '#DDD6FE' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>🎛️ Flexi Benefit Plan (FBP)</div>
          <span style={{ fontSize: 11, background: '#EEEDFE', color: V.purpleDark, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>{companyName}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
          <div><span style={{ color: V.muted }}>Your annual fixed</span><div style={{ fontWeight: 700, fontSize: 15 }}>{inr(annualFixed)}</div></div>
          <div><span style={{ color: V.muted }}>Applicable slab</span><div style={{ fontWeight: 700, fontSize: 15 }}>{slab?.slab_label || `${inr(num(slab?.fixed_from))} – ${inr(num(slab?.fixed_to))}`}</div></div>
          <div><span style={{ color: V.muted }}>Max declarable ({regime})</span><div style={{ fontWeight: 700, fontSize: 15, color: V.purple }}>{inr(totalDeclarable)}/yr</div></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['old', 'new'] as const).map(rg => (
          <button key={rg} onClick={() => setRegime(rg)} style={{ padding: '7px 16px', borderRadius: 99, border: `1px solid ${regime === rg ? V.purple : V.border}`, background: regime === rg ? V.purple : '#fff', color: regime === rg ? '#fff' : V.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{rg === 'old' ? 'Old Regime' : 'New Regime'}</button>
        ))}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', padding: '10px 14px', background: V.navy, color: '#fff', fontSize: 11, fontWeight: 700 }}>
          <span>COMPONENT</span><span style={{ textAlign: 'right' }}>{regime === 'old' ? 'OLD REGIME' : 'NEW REGIME'}</span><span style={{ textAlign: 'right' }}>PERQUISITE / EXTRA</span>
        </div>
        {rows.map((r, i) => {
          const a = amt(r)
          const perq = num(r.perquisite_monthly) > 0 ? `${inr(num(r.perquisite_monthly))}/mo perq` : (r.comp.is_children_linked && r.children_count ? `${r.children_count} child` : '—')
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', padding: '9px 14px', borderBottom: `1px solid ${V.border}`, fontSize: 12.5, background: a.muted ? '#FAFAFE' : '#fff' }}>
              <span style={{ color: V.navy }}>{r.comp.name}</span>
              <span style={{ textAlign: 'right', fontWeight: 600, color: a.muted ? V.muted : V.navy }}>{a.text}</span>
              <span style={{ textAlign: 'right', color: V.muted }}>{perq}</span>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 10.5, color: V.muted, padding: '0 4px' }}>FBP entitlements for your company &amp; salary band. Declaration &amp; bill submission open during the flexi window — raise via HR / Payroll.</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SHELL
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// MY LETTERS — HR letters published to this employee's ESS
// ════════════════════════════════════════════════════════════════
function MyLetters({ emp }: { emp: EmployeeDetail }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('my_generated_letters').select('*').eq('employee_id', emp.id).order('letter_date', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) }, () => setLoading(false))
  }, [emp.id])
  async function download(fileUrl: string) {
    const { data } = await supabase.storage.from('generated-letters').createSignedUrl(fileUrl, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  return (
    <div style={T.card}>
      <div style={T.section}>🖋️ My Letters</div>
      {loading ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Loading…</div> :
        rows.length === 0 ? <div style={{ fontSize:12, color:'#9CA3AF' }}>No letters have been shared with you yet. HR-issued letters (offer, confirmation, etc.) will appear here.</div> :
        rows.map(r => (
          <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'1px solid #F3F0FF' }}>
            <span style={{ fontSize:20 }}>📄</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{r.letter_name}</div>
              <div style={{ fontSize:11, color:'#9CA3AF' }}>{new Date(r.letter_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</div>
            </div>
            <button onClick={() => download(r.file_url)} style={{ ...T.btnO }}>⬇ Download</button>
          </div>
        ))}
    </div>
  )
}

// ── Navigation ──────────────────────────────────────────────────
// The eleven tabs from ESS_Portal_New_Structure.html, in that file's order, with its
// navy sidebar, status dots and per-tab feature grid. The old portal had 21 flat
// entries; this replaces them. Modules that were separate rows (VPF, NPS, declaration,
// proofs, claims…) are now sub-tabs of the tab they belong to — Payroll alone absorbed
// eight of them, which is the whole point of the restructure.
//
// One thing is translated rather than copied. The mock's badges read "Built & Tested" /
// "Partially Built" / "Not Started" — build-tracker language. An employee opening their
// own portal should not be told a tab is "Not Started", so the same three states are
// worded as Available / Partly available / Coming soon. The colours and dots are the
// mock's.
//
// A tab that isn't built shows its feature grid — what is coming — instead of an empty
// screen or a fake one.
type Ready = 'ready' | 'partial' | 'soon'
interface NavItem { k: string; label: string; phase?: number; needs?: string }
interface Feature { icon: string; name: string; note: string }
interface NavSection {
  k: string; label: string; short: string; icon: string
  desc: string; status: Ready
  items: NavItem[]            // sub-tabs; a single entry means no pill row is drawn
  features?: Feature[]        // shown instead of the module when status is 'soon'
}

const SECTIONS: NavSection[] = [
  { k:'home', label:'Home', short:'Home', icon:'🏠', status:'ready',
    desc:'The landing dashboard — everything at a glance',
    items:[{ k:'home', label:'Dashboard' }] },

  { k:'profile', label:'Profile', short:'Profile', icon:'👤', status:'ready',
    desc:'Your personal details, documents and letters',
    items:[
      { k:'profile',     label:'My Details' },
      { k:'documents',   label:'Letter Requests' },
      { k:'letters',     label:'My Letters' },
    ]},

  { k:'team', label:'Team', short:'Team', icon:'👥', status:'soon',
    desc:'For managers — see and manage your team',
    items:[{ k:'team', label:'Team' }],
    features:[
      { icon:'📋', name:'Team List',          note:'Non-salary details visible' },
      { icon:'✅', name:'Task Assign',        note:'Give tasks to team members' },
      { icon:'📝', name:'TODO / Deliverables',note:'Track what is owed' },
    ]},

  { k:'payroll', label:'Payroll', short:'Payroll', icon:'💰', status:'partial',
    desc:'Salary, benefits, declarations and claims — all in one place',
    items:[
      { k:'payslip',     label:'Salary Slip',            phase:3, needs:'Payslip generation' },
      { k:'flexi',       label:'Flexi Benefits' },
      // 'declaration' (InvestmentDeclaration) is not listed — nav entry removed on
      // request. The component, its import and the render case below are untouched, so
      // restoring it is this one line back. Don't delete them as dead code.
      { k:'proofs',      label:'Investment Proofs' },
      { k:'flexiclaims', label:'Flexi Claims' },
      { k:'vpf',         label:'Voluntary PF' },
      { k:'nps',         label:'Corporate NPS' },
      { k:'loans',       label:'Loans' },
      { k:'claims',      label:'Travel Claims',          phase:3, needs:'Claims/Payroll' },
      { k:'statutory',   label:'Statutory',              phase:3, needs:'Payroll' },
    ]},

  { k:'attendance', label:'Attendance', short:'Attend', icon:'🕐', status:'ready',
    desc:'Your own attendance, self-service',
    items:[{ k:'attendance', label:'Attendance' }] },

  { k:'leave', label:'Leave', short:'Leave', icon:'🌴', status:'ready',
    desc:'Apply, track and plan leave',
    items:[{ k:'leave', label:'Leave' }] },

  { k:'hris', label:'HRIS', short:'HRIS', icon:'🗂️', status:'partial',
    desc:'Directory, requests, approvals and the exit process',
    items:[
      { k:'directory',   label:'Team Directory' },
      { k:'requests',    label:'Raise a Request' },
      { k:'approvals',   label:'Tasks & Approvals',      phase:4, needs:'Approval workflow' },
      { k:'exit',        label:'Exit Process',           phase:4, needs:'Exit & FnF' },
    ]},

  { k:'performance', label:'Performance', short:'PMS', icon:'⭐', status:'soon',
    desc:'Review and rating submission',
    items:[{ k:'performance', label:'Performance' }],
    features:[
      { icon:'📝', name:'Self Review',    note:'Employee assessment' },
      { icon:'👔', name:'Manager Review', note:'Rating submission' },
    ]},

  { k:'wall', label:'Wall of Fame', short:'Wall', icon:'🏆', status:'soon',
    desc:'Peer-to-peer appreciation, casual and public',
    items:[{ k:'wall', label:'Wall of Fame' }],
    features:[
      { icon:'💬', name:'Give a Shoutout', note:'Quick appreciation post' },
      { icon:'📰', name:'Company Feed',    note:'See everyone’s shoutouts' },
    ]},

  { k:'rnr', label:'RNR', short:'RNR', icon:'🎖️', status:'soon',
    desc:'Structured Reward & Recognition, points-based',
    items:[{ k:'rnr', label:'RNR' }],
    features:[
      { icon:'📝', name:'Nominate',    note:'Pick a category, write why' },
      { icon:'✅', name:'Approval',    note:'Manager / HR reviews' },
      { icon:'💎', name:'Points',      note:'Credited on approval' },
      { icon:'🎁', name:'Redeem',      note:'Vouchers, leave, merch' },
      { icon:'🏅', name:'Leaderboard', note:'Top recognized employees' },
    ]},

  { k:'funzone', label:'Fun Zone', short:'Fun', icon:'🎉', status:'ready',
    desc:'Take a break — play a quick game with your team',
    items:[{ k:'funzone', label:'Fun Zone' }] },
]

const VIEWS = SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s.k })))
const viewMeta = (k: string) => VIEWS.find(v => v.k === k) || VIEWS[0]
/** The four an employee opens daily — these get the mobile thumb bar, rest go under More. */
const MOBILE_PRIMARY = ['home','payroll','attendance','leave']

const DOT: Record<Ready, string> = { ready:'#059669', partial:'#B45309', soon:'#DC2626' }
const BADGE: Record<Ready, [string, string, string]> = {
  ready:   ['Available',        '#ECFDF5', '#059669'],
  partial: ['Partly available', '#FFFBEB', '#B45309'],
  soon:    ['Coming soon',      '#FEF2F2', '#DC2626'],
}

// ── Sidebar / sub-tab / feature-grid bits (outside the parent — no focus loss) ──
function SectionButton({ s, active, onClick }: { s: NavSection; active: boolean; onClick: () => void }) {
  // The mock's `.tab-link:hover` can't be an inline style, so the hover tint is state.
  const [hover, setHover] = useState(false)
  const bg = active ? 'rgba(124,58,237,0.25)' : hover ? 'rgba(255,255,255,0.05)' : 'transparent'
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ width:'100%', textAlign:'left', display:'flex', alignItems:'center', gap:10, padding:'10px 18px', color: active ? '#fff' : '#C4BFEE', cursor:'pointer', fontSize:12.5, fontWeight:600, fontFamily:'inherit', background:bg, border:'none', borderLeft:`3px solid ${active ? '#7C3AED' : 'transparent'}` }}>
      <span>{s.icon}</span>
      <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.label}</span>
      <span style={{ width:6, height:6, borderRadius:'50%', marginLeft:'auto', background:DOT[s.status], flexShrink:0 }} />
    </button>
  )
}

function TabHeader({ s }: { s: NavSection }) {
  const [label, bg, fg] = BADGE[s.status]
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap', marginBottom:4 }}>
        <div style={{ fontSize:22, fontWeight:700 }}>{s.icon} {s.label}</div>
        <span style={{ fontSize:10.5, fontWeight:700, padding:'4px 12px', borderRadius:999, background:bg, color:fg }}>{label}</span>
      </div>
      <div style={{ fontSize:12.5, color:'#6B7280' }}>{s.desc}</div>
    </div>
  )
}

function SubTabs({ items, view, go }: { items: NavItem[]; view: string; go: (k: string) => void }) {
  if (items.length < 2) return null
  return (
    <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:14 }}>
      {items.map(i => {
        const on = i.k === view
        return (
          <button key={i.k} onClick={() => go(i.k)} style={{ padding:'6px 14px', borderRadius:99, cursor:'pointer', fontFamily:'inherit', fontSize:12.5, fontWeight: on ? 600 : 500, border:`1px solid ${on ? '#7C3AED' : '#E9E7F5'}`, background: on ? '#7C3AED' : '#fff', color: on ? '#fff' : '#4B5563', whiteSpace:'nowrap' }}>
            {i.label}{i.phase ? <span style={{ marginLeft:5, fontSize:9, opacity:.7 }}>soon</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** What a tab will hold once it's built. Shown instead of the module, never alongside. */
function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
        {features.map(f => (
          <div key={f.name} style={{ background:'#fff', border:'1px solid #ECEAFB', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{f.icon}</div>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:3 }}>{f.name}</div>
            <div style={{ fontSize:11, color:'#6B7280' }}>{f.note}</div>
          </div>
        ))}
      </div>
      <div style={{ background:'#F3EEFF', borderRadius:10, padding:'12px 16px', marginTop:20, fontSize:12, color:'#6D28D9' }}>
        This tab isn’t live yet. Everything above is what it will hold — nothing here is clickable so far.
      </div>
    </div>
  )
}

function NotificationBell({ unread, open, onToggle }: { unread: number; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} title="Notifications" style={{ position:'relative', width:34, height:34, borderRadius:8, border:`1px solid ${open ? '#7C3AED' : '#E9E7F5'}`, background: open ? '#F5F3FF' : '#fff', cursor:'pointer', fontSize:16, lineHeight:1, fontFamily:'inherit', flexShrink:0 }}>
      🔔
      {unread > 0 && (
        <span style={{ position:'absolute', top:-5, right:-5, minWidth:17, height:17, padding:'0 4px', borderRadius:99, background:'#DC2626', color:'#fff', fontSize:9.5, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', boxSizing:'border-box' }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}

export default function EmployeePortal({ employeeId, adminMode, onExit }: { employeeId: string; adminMode?: boolean; onExit?: () => void }) {
  const [emp, setEmp] = useState<EmployeeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('home')
  const [isMobile, setIsMobile] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState<{ msg: string; type: 'success'|'error' } | null>(null)
  const notify = (msg: string, type: 'success'|'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check)
  }, [])
  useEffect(() => { setLoading(true); loadEmployeeDetail(employeeId).then(e => { setEmp(e); setLoading(false) }) }, [employeeId])
  const reload = useCallback(() => loadEmployeeDetail(employeeId).then(setEmp), [employeeId])

  // Unread count for the bell. Refreshed on mount and whenever the open panel
  // marks something read, so the badge never disagrees with the list behind it.
  const refreshUnread = useCallback(() => {
    loadNotifications(employeeId).then(r => setUnread(r.filter(n => !n.is_read).length)).catch(() => {})
  }, [employeeId])
  useEffect(() => { refreshUnread() }, [refreshUnread])

  const go = (k: string) => { setView(k); setBellOpen(false); setMoreOpen(false) }
  // Clicking a section lands on its first item — the section itself is never a
  // destination, so there is no empty "section landing page" to design or maintain.
  const goSection = (s: NavSection) => go(s.items.some(i => i.k === view) ? view : s.items[0].k)
  const salaryVisible = false // role-based salary visibility wired with auth in a later pass

  const meta = viewMeta(view)
  const section = SECTIONS.find(s => s.k === meta.section)!

  const renderView = () => {
    if (!emp) return null
    const m = meta
    // A tab with nothing behind it shows what it will hold, not an empty screen.
    if (section.status === 'soon' && section.features) return <FeatureGrid features={section.features} />
    switch (view) {
      case 'home':          return <Home emp={emp} isMobile={isMobile} go={go} salaryVisible={salaryVisible} notify={notify} reload={reload} />
      case 'profile':       return <Profile emp={emp} notify={notify} />
      case 'leave':         return <LeaveSection emp={emp} notify={notify} />
      case 'vpf':           return <VpfSection emp={emp} notify={notify} />
      case 'nps':           return <NpsSection emp={emp} notify={notify} />
      case 'loans':         return <LoansSection emp={emp} notify={notify} />
      case 'flexi':         return <FlexiTdsCalculator employeeId={emp.id} empName={emp.full_name} empCode={emp.emp_code} />
      case 'declaration':   return <InvestmentDeclaration employeeId={emp.id} empName={emp.full_name} empCode={emp.emp_code} />
      case 'proofs':        return <InvestmentProofs employeeId={emp.id} />
      case 'flexiclaims':   return <FlexiClaims employeeId={emp.id} />
      case 'attendance':    return <AttendanceModule emp={emp} />
      case 'documents':     return <Documents emp={emp} notify={notify} />
      case 'letters':       return <MyLetters emp={emp} />
      case 'requests':      return <Requests emp={emp} notify={notify} />
      case 'directory':     return <Directory isMobile={isMobile} />
      case 'funzone':       return <FunZone />
      default:              return <Placeholder title={m.label} phase={m.phase || 4} needs={m.needs || '—'} />
    }
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'#7C3AED', fontFamily:'"DM Sans",sans-serif' }}>Loading portal…</div>
  if (!emp) return <div style={{ padding:40, textAlign:'center', color:'#DC2626', fontFamily:'"DM Sans",sans-serif' }}>Employee not found.</div>

  return (
    <div style={{ minHeight:'100vh', background:'#F5F3FF', fontFamily:'"DM Sans","Segoe UI",sans-serif', color:'#1E1B4B', display:'flex', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Desktop sidebar — navy, eleven tabs, per ESS_Portal_New_Structure.html */}
      {!isMobile && (
        <div style={{ width:220, background:'#1E1B4B', padding:'20px 0', position:'sticky', top:0, height:'100vh', overflowY:'auto', flexShrink:0 }}>
          <div style={{ padding:'0 18px 16px', color:'#fff', fontWeight:700, fontSize:16, borderBottom:'1px solid rgba(255,255,255,0.1)', marginBottom:10 }}>EZER ESS</div>
          {SECTIONS.map(s => (
            <SectionButton key={s.k} s={s} active={s.k === section.k} onClick={() => goSection(s)} />
          ))}
        </div>
      )}

      <div style={{ flex:1, minWidth:0, paddingBottom: isMobile ? 70 : 0 }}>
        {/* Top bar */}
        <div style={{ background:'#fff', borderBottom:'1px solid #EDE9FE', padding: isMobile ? '10px 14px' : '10px 22px', display:'flex', alignItems:'center', gap:10, position:'sticky', top:0, zIndex:25 }}>
          {/* The tab's own name and badge live in TabHeader below, so this bar carries
              only what that header can't: the sub-tab you're on, and who you are. */}
          <div style={{ fontSize: isMobile ? 15 : 16, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {isMobile ? 'EZER ESS' : (section.items.length > 1 ? meta.label : '')}
          </div>
          {adminMode && <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:'#FEF3C7', color:'#92400E', fontWeight:600, whiteSpace:'nowrap' }}>Admin viewing {emp.first_name || emp.full_name}</span>}
          {/* Employee identity — always visible at the top */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap: isMobile ? 7 : 9 }}>
            <NotificationBell unread={unread} open={bellOpen} onToggle={() => setBellOpen(o => !o)} />
            <div style={{ width: isMobile ? 30 : 34, height: isMobile ? 30 : 34, borderRadius:'50%', overflow:'hidden', background:'#EDE9FE', color:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize: isMobile ? 12 : 13, fontWeight:700, flexShrink:0 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
            {!isMobile && (
              <div style={{ lineHeight:1.2, textAlign:'right' }}>
                <div style={{ fontSize:13, fontWeight:700, whiteSpace:'nowrap', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis' }}>{emp.full_name}</div>
                <div style={{ fontSize:11, color:'#6B7280', fontFamily:'monospace' }}>{emp.emp_code}</div>
              </div>
            )}
          </div>
          {onExit && <button onClick={onExit} style={{ ...T.btnO, whiteSpace:'nowrap' }}>{adminMode ? 'Exit Admin' : 'Close'}</button>}
        </div>

        <div style={{ padding: isMobile ? '14px 12px' : '18px 22px', maxWidth:1100 }}>
          <TabHeader s={section} />
          <SubTabs items={section.items} view={view} go={go} />
          {renderView()}
        </div>
      </div>

      {/* Notification panel — anchored to the bell, not a sidebar entry */}
      {bellOpen && (
        <div onClick={() => setBellOpen(false)} style={{ position:'fixed', inset:0, zIndex:40 }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'absolute', top: isMobile ? 56 : 60, right: isMobile ? 8 : 22, width: isMobile ? 'calc(100vw - 16px)' : 380, maxHeight:'70vh', overflowY:'auto', background:'#fff', border:'1px solid #EDE9FE', borderRadius:12, boxShadow:'0 12px 32px rgba(30,27,75,0.18)', padding:'12px 14px' }}>
            <Notifications emp={emp} onChange={refreshUnread} />
          </div>
        </div>
      )}

      {/* Mobile bottom bar — eleven tabs don't fit a thumb bar, so the four an employee
          opens daily sit here and the rest are one tap away under More. */}
      {isMobile && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'#fff', borderTop:'1px solid #EDE9FE', display:'flex', zIndex:20 }}>
          {MOBILE_PRIMARY.map(k => { const s = SECTIONS.find(x => x.k === k)!; const on = section.k === k && !moreOpen; return (
            <button key={k} onClick={() => { setMoreOpen(false); goSection(s) }} style={{ flex:1, minWidth:0, padding:'8px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: on ? '#7C3AED' : '#9CA3AF', fontWeight: on ? 600 : 500 }}>
              <div style={{ fontSize:17, lineHeight:1.3 }}>{s.icon}</div>{s.short}
            </button>
          )})}
          <button onClick={() => setMoreOpen(o => !o)} style={{ flex:1, minWidth:0, padding:'8px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: moreOpen ? '#7C3AED' : '#9CA3AF', fontWeight: moreOpen ? 600 : 500 }}>
            <div style={{ fontSize:17, lineHeight:1.3 }}>⋯</div>More
          </button>
        </div>
      )}

      {/* Mobile "More" sheet — every tab, including the four in the bar, so nothing
          is reachable from only one place. */}
      {isMobile && moreOpen && (
        <div onClick={() => setMoreOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:30, display:'flex', alignItems:'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', width:'100%', borderRadius:'14px 14px 0 0', padding:'16px 14px 24px', maxHeight:'72vh', overflowY:'auto' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>All tabs</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {SECTIONS.map(s => (
                <button key={s.k} onClick={() => goSection(s)} style={{ padding:'12px 10px', borderRadius:9, border:`1px solid ${section.k === s.k ? '#7C3AED' : '#EDE9FE'}`, background: section.k === s.k ? '#F5F3FF' : '#FAFAF8', cursor:'pointer', fontFamily:'inherit', fontSize:12, textAlign:'left', display:'flex', alignItems:'center', gap:8, color:'#1E1B4B' }}>
                  <span style={{ fontSize:16 }}>{s.icon}</span>
                  <span style={{ flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.label}</span>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:DOT[s.status], flexShrink:0 }} />
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
