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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  loadEmployeeDetail, updateEmployeePhoto, loadDirectory, loadNotifications, markNotification, markAllNotifications,
  loadServiceRequests, createServiceRequest, loadLetterRequests, createLetterRequest,
  loadAnnouncements, loadKudos,
  loadLeaveBalances, loadLeaveApplications, applyLeave, loadEmployeeHolidays,
  type EmployeeDetail, type DirectoryEntry, type EssNotification,
  type ServiceRequest, type LetterRequest, type Announcement, type Kudo,
} from '@/lib/supabase-ess'
import {
  loadMonthlyAttendance, loadDayPunches, loadRegularisationRequests,
  submitRegularisation, submitRegularisationBulk,
  resolveDay, computeSummary,
  type MonthlyData, type DayPunch, type RegularisationRequest,
} from '@/lib/supabase-attendance'
import * as HR from '@/lib/employees/hr-actions'
import { loadLeaveTypes } from '@/lib/supabase-leave-config'
import { supabase } from '@/lib/supabase'
import { essAuthHeaders } from '@/lib/ess-session-client'
import FlexiTdsCalculator from '@/components/ess/FlexiTdsCalculator'
import FunZone from '@/components/ess/FunZone'
import FlexiClaims from '@/components/ess/FlexiClaims'
import InvestmentDeclaration from '@/components/ess/InvestmentDeclaration'
import InvestmentProofs from '@/components/ess/InvestmentProofs'
import TravelClaims from '@/components/ess/TravelClaims'

// The design system — see lib/ui/tokens.ts. This file has no colliding names,
// so the tokens come in under their own.
import {
  C, F, W, R, E, S, tone, eyebrow, numeric, inputStyle, UIKeyframes,
  IconHome, IconEmployees, IconPayroll, IconCalendar, IconLeave,
  IconLetters, IconReports, IconRecruitment, IconAi, IconBell,
} from '@/lib/ui'

// ── Styles ─────────────────────────────────────────────────────────
// Bound to the design system. See lib/ui/tokens.ts.
const T = {
  card:  { background:C.surface, borderRadius:R.lg, border:`1px solid ${C.line}`, padding:'14px 16px', marginBottom:S.md, boxShadow:E.raised } as React.CSSProperties,
  label: { ...eyebrow, display:'block', marginBottom:5 } as React.CSSProperties,
  input: { ...inputStyle() } as React.CSSProperties,
  btnP:  { height:36, padding:'0 16px', borderRadius:R.md, border:`1px solid ${C.brandDeep}`, cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:C.onAccent, boxShadow:E.brand } as React.CSSProperties,
  btnO:  { height:34, padding:'0 13px', borderRadius:R.md, border:`1px solid ${C.lineStrong}`, cursor:'pointer', fontSize:F.small, fontWeight:W.medium, fontFamily:'inherit', background:C.surface, color:C.ink, boxShadow:E.flat } as React.CSSProperties,
  section: { ...eyebrow, marginBottom:S.md, display:'flex', alignItems:'center', gap:8 } as React.CSSProperties,
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
    PENDING:[C.warningTint,C.warning], IN_REVIEW:[C.infoTint,C.info], APPROVED:[C.positiveTint,C.positive],
    REJECTED:[C.criticalTint,C.critical], COMPLETED:[C.positiveTint,C.positive], REQUESTED:[C.warningTint,C.warning],
    GENERATED:[C.positiveTint,C.positive],
  }
  const [bg,c] = map[status] || [C.brandTint,C.brandDeep]
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{status}</span>
}

// ── Transfer acknowledgement (ESS) ──────────────────────────────
function TransferAckCard({ empId, onAck }: { empId: string; onAck: () => void }) {
  const [transfers, setTransfers] = useState<any[]>([])
  useEffect(() => { HR.getPendingTransfers(empId).then(setTransfers) }, [empId])
  if (!transfers.length) return null
  return (<>{transfers.map(tr => (
    <div key={tr.id} style={{ background: C.warningTint, border: `1px solid ${C.warningTint}`, borderRadius:10, padding:'12px 16px', marginBottom:10 }}>
      <div style={{ fontSize:13, fontWeight:600, color: C.warning }}>Transfer Letter — action required</div>
      <div style={{ fontSize:11, color: C.warning, marginTop:3 }}>You are being transferred, effective {tr.effective_date}.</div>
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        {tr.letter_url && <a href={tr.letter_url} target="_blank" rel="noreferrer" style={{ padding:'7px 14px', background:C.surface, border: `1px solid ${C.warningTint}`, borderRadius:7, fontSize:11, color: C.warning, textDecoration:'none' }}>View Letter</a>}
        <button onClick={async () => { await HR.acknowledgeTransfer(tr.id); setTransfers(t=>t.filter(x=>x.id!==tr.id)); onAck() }} style={{ padding:'7px 14px', background:C.brand, color:C.onAccent, border:'none', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Acknowledge & Accept</button>
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
    <div style={{ ...T.card, borderLeft: `3px solid ${isOut ? C.critical : C.positive}` }}>
      <div style={T.section}>Attendance</div>
      <button onClick={punch} disabled={busy || punchedToday === null}
        style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', cursor: (busy || punchedToday === null) ? 'wait' : 'pointer', fontSize: 16, fontWeight: 700, color: C.onAccent, background: isOut ? C.critical : C.positive, opacity: (busy || punchedToday === null) ? .6 : 1 }}>
        {punchedToday === null ? 'Loading…' : busy ? '…' : (isOut ? 'Punch Out' : 'Punch In')}
      </button>
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('') ? C.positive : C.critical, marginTop: 8, textAlign: 'center' }}>{msg}</div>}
      <div style={{ fontSize: 11, color: C.faint, marginTop: 6, textAlign: 'center' }}>{isOut ? 'Punched in today · resets to “Punch In” at 12 AM.' : 'Tap to punch in for the day.'}</div>
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
        <div style={T.section}>Edit Profile Picture</div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
          <div style={{ width:120, height:120, borderRadius:'50%', overflow:'hidden', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontSize:34, fontWeight:700 }}>
            {preview ? <img src={preview} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}
          </div>
          <label style={{ ...T.btnO, cursor:'pointer' }}>Choose photo<input type="file" accept="image/*" style={{ display:'none' }} onChange={onFile} /></label>
          {preview && <button onClick={() => setPreview(null)} style={{ ...T.btnO, color:C.critical, borderColor: C.criticalTint }}>Remove photo</button>}
        </div>
        <div style={{ display:'flex', gap:10, marginTop:16 }}>
          <button onClick={onClose} style={{ ...T.btnO, flex:1 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ ...T.btnP, flex:1, opacity: busy?.6:1 }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Where the employee's travel claims currently sit.
 *
 * A claim leaves the employee's hands and then goes quiet — the only way to
 * find out where it had reached was to open Travel Claims and read a status
 * word. This puts the chain on the dashboard as a stepper, so "who has it now"
 * is answerable at a glance, and shows the wait in days, because that is the
 * actual question behind asking.
 *
 * The steps are derived from each claim's own status rather than assumed, so
 * this stays correct whether the company routes through a reporting manager,
 * an HR head, both, or neither.
 */
const CLAIM_STEP: Record<string, { step: number; label: string; tone: string }> = {
  DRAFT:           { step: 0, label: 'Draft',              tone: C.faint },
  SUBMITTED:       { step: 1, label: 'Submitted',          tone: C.warning },
  PENDING_RM:      { step: 1, label: 'With your manager',  tone: C.warning },
  PENDING_HR:      { step: 2, label: 'With HR',            tone: C.warning },
  PENDING_FINANCE: { step: 3, label: 'With Finance',       tone: C.brandDeep },
  APPROVED:        { step: 4, label: 'Approved, awaiting payment', tone: C.positive },
  PAID:            { step: 5, label: 'Paid',               tone: C.positive },
  SENT_BACK:       { step: 1, label: 'Sent back to you',   tone: C.critical },
  REJECTED:        { step: 0, label: 'Rejected',           tone: C.critical },
}

function ClaimStepper({ status }: { status: string }) {
  const here = CLAIM_STEP[status]?.step ?? 0
  const done = status === 'PAID'
  const dead = status === 'REJECTED' || status === 'SENT_BACK'
  const steps = ['Raised', 'Manager', 'Finance', 'Paid']
  const reached = [1, 2, 4, 5]   // status step at which each label is satisfied

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 8 }}>
      {steps.map((label, i) => {
        const on = !dead && here >= reached[i]
        const colour = dead ? C.criticalTint : on ? (done ? C.positive : C.brand) : C.line
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : '0 0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 15, height: 15, borderRadius: '50%', background: on ? colour: C.surface,
                            border: `2px solid ${colour}`, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 8, color: C.onAccent, fontWeight: 700 }}>
                {on ? '' : ''}
              </div>
              <span style={{ fontSize: 8.5, fontWeight: 600, color: on ? colour: C.line,
                             whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 4px', marginBottom: 13,
                            background: !dead && here >= reached[i + 1] ? colour : C.line }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function TravelClaimStatus({ emp, go }: { emp: EmployeeDetail; go: (k: string) => void }) {
  const [claims, setClaims] = useState<any[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        // No ESS token means this is the dashboard preview; fall back to the
        // dashboard session so an admin previewing a portal still sees it.
        let headers: Record<string, string> = essAuthHeaders()
        if (!headers.Authorization) {
          const { data } = await supabase.auth.getSession()
          const t = data?.session?.access_token
          headers = t ? { Authorization: `Bearer ${t}` } : {}
        }
        const r = await fetch(`/api/travel/claims?employee_id=${emp.id}`, { headers })
        if (live) setClaims(r.ok ? ((await r.json()).claims ?? []) : [])
      } catch { if (live) setClaims([]) }
    })()
    return () => { live = false }
  }, [emp.id])

  if (claims === null || claims.length === 0) return null

  const open = claims.filter(c => !['PAID', 'REJECTED'].includes(c.status))
  const show = (open.length ? open : claims).slice(0, 3)
  const owed = open.reduce((s, c) => s + (Number(c.total_claimed) || 0), 0)
  const daysSince = (d: string | null) =>
    d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 86400000)) : null

  return (
    <div style={T.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={T.section}>My Travel Claims</div>
        <button onClick={() => go('claims')} style={{ ...T.btnO, padding: '5px 11px', fontSize: 11.5 }}>
          Open
        </button>
      </div>
      {open.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
          ₹{Math.round(owed).toLocaleString('en-IN')} across {open.length} claim
          {open.length === 1 ? '' : 's'} still moving through approval
        </div>
      )}

      {show.map(c => {
        const st = CLAIM_STEP[c.status] ?? { label: c.status, tone: C.muted }
        const waited = daysSince(c.submitted_at)
        return (
          <div key={c.id} style={{ padding: '10px 0', borderTop: `1px solid ${C.brandEdge}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{c.claim_no}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                ₹{Math.round(Number(c.total_claimed) || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: st.tone }}>● {st.label}</span>
              {waited != null && !['PAID', 'REJECTED'].includes(c.status) && (
                <span style={{ fontSize: 10.5, color: waited > 5 ? C.warning : C.faint }}>
                  {waited === 0 ? 'submitted today' : `waiting ${waited} day${waited === 1 ? '' : 's'}`}
                </span>
              )}
            </div>
            <ClaimStepper status={c.status} />
          </div>
        )
      })}

      {claims.length > show.length && (
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
          + {claims.length - show.length} more in Travel Claims
        </div>
      )}
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
  const emoji = h < 12 ? '' : h < 17 ? '' : h < 21 ? '' : ''
  const quote = QUOTES[new Date().getDate() % QUOTES.length]
  const tenureYrs = emp.group_doj ? Math.floor((Date.now() - new Date(emp.group_doj).getTime()) / (365.25*24*3600*1000)) : 0
  const dob = emp.date_of_birth ? new Date(emp.date_of_birth) : null
  const bdaySoon = dob ? (() => { const n = new Date(); const t = new Date(n.getFullYear(), dob.getMonth(), dob.getDate()); const d = Math.ceil((t.getTime() - n.getTime())/86400000); return d >= -1 && d <= 30 ? d : null })() : null

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={T.card}><div style={{ fontSize:11, color:C.faint, fontWeight:600, textTransform:'uppercase' }}>{label}</div><div style={{ fontSize:18, fontWeight:700, marginTop:3, color: color || C.ink }}>{value}</div></div>
  )

  return (
    <div>
      <TransferAckCard empId={emp.id} onAck={()=>{}} />
      <div style={{ ...T.card, borderLeft: `3px solid ${C.brandEdge}`, display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:52, height:52, borderRadius:'50%', overflow:'hidden', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, flexShrink:0 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
        <div>
          <div style={{ fontSize:17, fontWeight:700 }}>{greet}, {emp.first_name || emp.full_name.split(' ')[0]}! {emoji}</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{emp.designation || '—'} · {emp.emp_code}</div>
          <div style={{ fontSize:12, color:C.brand, marginTop:4, fontStyle:'italic' }}>“{quote}”</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'stretch' }}>
        <div style={{ flex:'3 1 280px' }}><PunchButton employeeId={emp.id} /></div>
        <button onClick={() => setEditOpen(true)} style={{ flex:'1 1 160px', ...T.card, marginBottom:10, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'inherit' }}>
          <div style={{ width:46, height:46, borderRadius:'50%', overflow:'hidden', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
          <span style={{ fontSize:13, fontWeight:600, color:C.brandDeep }}>Edit Profile</span>
        </button>
      </div>
      {editOpen && <EditProfileModal emp={emp} onClose={() => setEditOpen(false)} onSaved={reload} notify={notify} />}

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:10 }}>
        <Stat label="Leave Balance" value="—" color={C.faint} />
        <Stat label="Net Salary" value={salaryVisible ? '—' : 'Hidden'} color={C.faint} />
        <Stat label="Attendance %" value="—" color={C.faint} />
        <Stat label="Pending Actions" value={String(pending)} color={pending ? C.warning : C.positive} />
      </div>

      {/* where the employee's travel claims currently sit */}
      <TravelClaimStatus emp={emp} go={go} />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
        <button onClick={() => go('leave')} style={T.btnO}>Apply Leave</button>
        <button onClick={() => go('payslip')} style={T.btnO}>Download Payslip</button>
        <button onClick={() => go('requests')} style={T.btnO}>Raise Ticket</button>
        <button onClick={() => go('directory')} style={T.btnO}>View Team</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:10 }}>
        {/* Birthday / Anniversary */}
        <div style={T.card}>
          <div style={T.section}>Birthday & Anniversary</div>
          {bdaySoon !== null
            ? <div style={{ fontSize:13 }}>Your birthday is {bdaySoon <= 0 ? 'today!' : `in ${bdaySoon} day(s)`} — wishing you ahead!</div>
            : <div style={{ fontSize:12, color:C.faint }}>No upcoming birthdays in the next 30 days.</div>}
          {emp.group_doj && <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>Joined {fmt(emp.group_doj)} · {tenureYrs} yr{tenureYrs===1?'':'s'} with us 🎊</div>}
        </div>

        {/* My Journey */}
        <div style={T.card}>
          <div style={T.section}>My Journey</div>
          <div style={{ fontSize:12, color:C.inkSoft, lineHeight:1.9 }}>
            <div>Joined: <b>{fmt(emp.group_doj)}</b></div>
            <div>Designation: <b>{emp.designation || '—'}</b></div>
            <div>Tenure: <b>{tenureYrs} year{tenureYrs===1?'':'s'}</b></div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' }}>
              {[1,3,5].map(y => <span key={y} style={{ fontSize:10, padding:'2px 9px', borderRadius:99, fontWeight:600, background: tenureYrs>=y?C.positiveTint:C.sunken, color: tenureYrs>=y?C.positive:C.faint }}>{tenureYrs>=y?'':''} {y}-yr</span>)}
            </div>
          </div>
        </div>

        {/* Kudos */}
        <div style={T.card}>
          <div style={T.section}>Recognition & Kudos</div>
          {kudos.length === 0 && <div style={{ fontSize:12, color:C.faint }}>No kudos yet — appreciation from peers will show here.</div>}
          {kudos.map(k => <div key={k.id} style={{ fontSize:12, padding:'6px 0', borderBottom: `1px solid ${C.brandEdge}` }}>{k.badge ? `🏆 ${k.badge} — ` : ''}{k.message || 'Kudos!'}<span style={{ color:C.faint, fontSize:10, marginLeft:6 }}>{fmt(k.created_at)}</span></div>)}
        </div>

        {/* Announcements */}
        <div style={T.card}>
          <div style={T.section}>Announcements</div>
          {ann.length === 0 && <div style={{ fontSize:12, color:C.faint }}>No announcements right now.</div>}
          {ann.map(a => <div key={a.id} style={{ padding:'7px 0', borderBottom: `1px solid ${C.brandEdge}` }}><div style={{ fontSize:12.5, fontWeight:600 }}>{a.title}</div>{a.body && <div style={{ fontSize:11.5, color:C.muted, marginTop:2 }}>{a.body}</div>}<div style={{ fontSize:10, color:C.faint, marginTop:2 }}>{fmt(a.published_at)}</div></div>)}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// PROFILE & KYC (B4)
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// PROFILE
// Rebuilt from a flat list of 21 label/value rows into something an employee
// can actually use. Three ideas drive it:
//
//   1. Identity first. A person opening their own profile wants to see
//      themselves, not a table. The hero carries the photo, the name, and the
//      four facts that place someone in a company.
//   2. Completeness is a prompt, not a decoration. The ring is computed from
//      fields that are genuinely missing, and names them — HR chases these,
//      and the employee is the only one who can supply them.
//   3. Sensitive values stay covered. PAN, Aadhaar and UAN are masked until
//      asked for, and copy is one tap because the reason people reveal them is
//      to paste them somewhere.
//
// Palette and inline-style convention follow T, as the rest of this file does.
// ════════════════════════════════════════════════════════════════

const P = {
  navy: C.ink, navyDeep: C.dark, purple: C.brand, purpleD: C.brandDeep,
  purpleLite: C.brandTint, line: C.brandEdge, muted: C.muted, dim: C.faint,
  green: C.positive, greenBg: C.positiveTint, amber: C.warning, amberBg: C.warningTint,
  red: C.critical, white: C.surface,
}

/** Years and months since a date, in words. */
function tenureOf(doj?: string | null): string {
  if (!doj) return '—'
  const from = new Date(doj), now = new Date()
  if (isNaN(from.getTime()) || from > now) return '—'
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth())
  if (now.getDate() < from.getDate()) months--
  const y = Math.floor(months / 12), m = months % 12
  if (y <= 0 && m <= 0) return 'Joined this month'
  return [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')
}

/** Days until the next occurrence of a day/month, ignoring the year. */
function daysUntilAnniversary(d?: string | null): number | null {
  if (!d) return null
  const src = new Date(d)
  if (isNaN(src.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(today.getFullYear(), src.getMonth(), src.getDate())
  if (next < today) next = new Date(today.getFullYear() + 1, src.getMonth(), src.getDate())
  return Math.round((next.getTime() - today.getTime()) / 86400000)
}

/** Which fields are missing, so the ring can name them rather than just score. */
function completenessOf(emp: EmployeeDetail): { pct: number; missing: string[]; total: number } {
  const checks: [string, unknown][] = [
    ['Date of birth', emp.date_of_birth], ['Gender', emp.gender],
    ['Blood group', emp.blood_group], ['Marital status', emp.marital_status],
    ['Mobile number', emp.mobile], ['Personal email', emp.personal_email],
    ['PAN', emp.pan_number], ['Aadhaar', emp.aadhar_last4],
    ['UAN', emp.uan_number], ['Profile photo', emp.profile_photo],
  ]
  const missing = checks.filter(([, v]) => !v).map(([k]) => k)
  return {
    pct: Math.round(((checks.length - missing.length) / checks.length) * 100),
    missing, total: checks.length,
  }
}

// ── sub-components, defined outside Profile so they keep their state ──────────

function Ring({ pct, size = 76 }: { pct: number; size?: number }) {
  const r = (size - 9) / 2
  const c = 2 * Math.PI * r
  const tone = pct >= 90 ? P.green : pct >= 60 ? P.purple : P.amber
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={tone} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${(c * pct) / 100} ${c}`}
                style={{ transition: 'stroke-dasharray .7s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', color: C.onAccent }}>
        <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontSize: 8.5, opacity: .7, letterSpacing: '.05em', marginTop: 1 }}>DONE</span>
      </div>
    </div>
  )
}

function Avatar({ emp, size = 84 }: { emp: EmployeeDetail; size?: number }) {
  const [broken, setBroken] = useState(false)
  const show = emp.profile_photo && !broken
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
                  background: show ? C.surface : 'linear-gradient(135deg,#2563EB,#93C5FD)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: C.onAccent, fontSize: size * 0.34, fontWeight: 700, letterSpacing: '.02em',
                  border: '3px solid rgba(255,255,255,0.25)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.22)', overflow: 'hidden' }}>
      {show
        ? <img src={emp.profile_photo!} alt="" onError={() => setBroken(true)}
               style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials(emp.full_name || '?')}
    </div>
  )
}

function Chip({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
                   borderRadius: 99, background: 'rgba(255,255,255,0.12)',
                   border: '1px solid rgba(255,255,255,0.16)', color: C.onAccent,
                   fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ opacity: .85 }}>{icon}</span>{children}
    </span>
  )
}

/**
 * One field. Copy appears on hover because it is useful often but never the
 * point; sensitive values stay masked until asked for.
 */
function Field({ label, value, icon, copyable, sensitive, notify }: {
  label: string; value?: string | null; icon?: string
  copyable?: boolean; sensitive?: boolean
  notify: (m: string, t?: 'success' | 'error') => void
}) {
  const [hover, setHover] = useState(false)
  const [shown, setShown] = useState(false)
  const has = !!value && value !== '—'
  const masked = sensitive && !shown && has
  const display = !has ? '—' : masked ? '•'.repeat(Math.min(String(value).length, 12)) : String(value)

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
         style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                  borderRadius: 8, background: hover ? P.purpleLite : 'transparent',
                  transition: 'background .15s' }}>
      {icon && <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: .8 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: P.dim,
                      textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: has ? P.navy : P.dim,
                      marginTop: 2, fontVariantNumeric: 'tabular-nums',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </div>
      </div>

      {sensitive && has && (
        <button onClick={() => setShown(v => !v)} title={shown ? 'Hide' : 'Reveal'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
                         fontSize: 13, opacity: hover || shown ? 1 : .35, transition: 'opacity .15s' }}>
          {shown ? '' : ''}
        </button>
      )}
      {copyable && has && (
        <button title="Copy"
                onClick={() => {
                  navigator.clipboard?.writeText(String(value))
                    .then(() => notify(`${label} copied`))
                    .catch(() => notify('Could not copy', 'error'))
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
                         fontSize: 12.5, opacity: hover ? 1 : 0, transition: 'opacity .15s' }}>
          📋
        </button>
      )}
    </div>
  )
}

function Panel({ title, icon, children, accent }: {
  title: string; icon: string; children: React.ReactNode; accent?: string
}) {
  return (
    <div style={{ background: P.white, borderRadius: 12, border: `1px solid ${P.line}`,
                  padding: '15px 14px', boxShadow: '0 1px 3px rgba(37,99,235,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                    paddingBottom: 9, borderBottom: `1px solid ${P.line}` }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                       background: accent || P.purpleLite, display: 'flex',
                       alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: P.navy,
                       letterSpacing: '.02em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function ProfileHero({ emp, notify }: {
  emp: EmployeeDetail; notify: (m: string, t?: 'success' | 'error') => void
}) {
  const c = completenessOf(emp)
  const bday = daysUntilAnniversary(emp.date_of_birth)
  const work = daysUntilAnniversary(emp.group_doj)

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12,
                  background: `linear-gradient(135deg, ${P.navy} 0%, #2A1F63 55%, #3C1E8C 100%)`,
                  boxShadow: '0 8px 28px rgba(30,27,75,0.28)', position: 'relative' }}>
      {/* soft light, so the band is not a flat rectangle */}
      <div style={{ position: 'absolute', top: -90, right: -60, width: 260, height: 260,
                    borderRadius: '50%', background: 'rgba(167,139,250,0.16)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -110, left: -40, width: 220, height: 220,
                    borderRadius: '50%', background: 'rgba(37,99,235,0.14)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', padding: '22px 22px 20px',
                    display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Avatar emp={emp} />

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.onAccent, lineHeight: 1.15,
                        letterSpacing: '-.02em' }}>{emp.full_name || '—'}</div>
          <div style={{ fontSize: 13, color: C.onAccentSoft, marginTop: 3 }}>
            {emp.designation || 'Designation not set'}
            {emp.dept_name ? ` · ${emp.dept_name}` : ''}
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 13 }}>
            <Chip icon="🆔">{emp.emp_code || '—'}</Chip>
            <Chip icon="🏢">{emp.company_name || '—'}</Chip>
            {(emp.location_name || emp.city) && (
              <Chip icon="📍">{[emp.location_name, emp.city].filter(Boolean).join(', ')}</Chip>
            )}
            <Chip icon="⏳">{tenureOf(emp.group_doj)}</Chip>
          </div>

          {/* Only worth the space when it is actually near. */}
          {(bday !== null && bday <= 30) || (work !== null && work <= 30) ? (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 9 }}>
              {bday !== null && bday <= 30 && (
                <Chip icon="🎂">{bday === 0 ? 'Birthday today' : `Birthday in ${bday} day${bday > 1 ? 's' : ''}`}</Chip>
              )}
              {work !== null && work <= 30 && (
                <Chip icon="🎉">{work === 0 ? 'Work anniversary today' : `Work anniversary in ${work} day${work > 1 ? 's' : ''}`}</Chip>
              )}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                      minWidth: 120 }}>
          <Ring pct={c.pct} />
          <div style={{ fontSize: 10.5, color: C.onAccentDim, textAlign: 'center' }}>
            {c.missing.length === 0
              ? 'Profile complete'
              : `${c.missing.length} of ${c.total} still missing`}
          </div>
        </div>
      </div>

      {/* Naming what is missing turns a score into something actionable. */}
      {c.missing.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.22)', padding: '10px 22px',
                      display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: C.onAccentDim }}>Still needed:</span>
          {c.missing.map(m => (
            <span key={m} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99,
                                   background: 'rgba(255,255,255,0.1)', color: C.warning,
                                   border: '1px solid rgba(251,191,36,0.28)' }}>{m}</span>
          ))}
          <span style={{ fontSize: 11, color: C.onAccentDim, marginLeft: 'auto' }}>
            Request an update below
          </span>
        </div>
      )}
    </div>
  )
}

function Profile({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const [tab, setTab] = useState<'OVERVIEW' | 'PERSONAL' | 'UPDATE'>('OVERVIEW')
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

  const TABS: [typeof tab, string, string][] = [
    ['OVERVIEW', 'Overview', ''],
    ['PERSONAL', 'Personal & KYC', ''],
    ['UPDATE', 'Request a change', ''],
  ]

  return (
    <div>
      <ProfileHero emp={emp} notify={notify} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6,
                           padding: '8px 15px', borderRadius: 9, cursor: 'pointer',
                           fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                           border: tab === k ? 'none' : `1px solid ${P.line}`,
                           background: tab === k ? P.purple : P.white,
                           color: tab === k ? C.surface : P.purpleD,
                           boxShadow: tab === k ? '0 3px 10px rgba(37,99,235,0.28)' : 'none',
                           transition: 'all .18s' }}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </div>

      {tab === 'OVERVIEW' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 11 }}>
          <Panel title="Where you sit" icon="🏛️">
            <Field label="Employee code" value={emp.emp_code} icon="🆔" copyable notify={notify} />
            <Field label="Designation" value={emp.designation} icon="💼" notify={notify} />
            <Field label="Department" value={emp.dept_name} icon="🗂️" notify={notify} />
            <Field label="Company" value={emp.company_name} icon="🏢" notify={notify} />
            <Field label="Location" value={[emp.location_name, emp.city].filter(Boolean).join(', ')} icon="📍" notify={notify} />
          </Panel>

          <Panel title="Your people" icon="👥" accent="#EEF2FF">
            <Field label="Reporting manager" value={emp.l1_manager_name} icon="👔" notify={notify} />
            <Field label="HR contact" value={emp.hr_manager_name} icon="🧑‍💼" notify={notify} />
            <Field label="Office email" value={emp.office_email} icon="✉️" copyable notify={notify} />
          </Panel>

          <Panel title="Service" icon="⏳" accent={P.greenBg}>
            <Field label="Date of joining" value={fmt(emp.group_doj)} icon="📅" notify={notify} />
            <Field label="Time with the company" value={tenureOf(emp.group_doj)} icon="⏳" notify={notify} />
            <Field label="Employment type" value={emp.employment_type} icon="📄" notify={notify} />
          </Panel>
        </div>
      )}

      {tab === 'PERSONAL' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 11 }}>
          <Panel title="About you" icon="🙋">
            <Field label="Date of birth" value={fmt(emp.date_of_birth)} icon="🎂" notify={notify} />
            <Field label="Gender" value={emp.gender} icon="⚧" notify={notify} />
            <Field label="Blood group" value={emp.blood_group} icon="🩸" notify={notify} />
            <Field label="Marital status" value={emp.marital_status} icon="💍" notify={notify} />
          </Panel>

          <Panel title="How to reach you" icon="📇" accent="#EEF2FF">
            <Field label="Mobile" value={emp.mobile} icon="📱" copyable notify={notify} />
            <Field label="Personal email" value={emp.personal_email} icon="📧" copyable notify={notify} />
            <Field label="Office email" value={emp.office_email} icon="✉️" copyable notify={notify} />
          </Panel>

          <Panel title="Statutory IDs" icon="🔐" accent={P.amberBg}>
            <Field label="PAN" value={emp.pan_number} icon="🪪" copyable sensitive notify={notify} />
            <Field label="Aadhaar" value={emp.aadhar_last4 ? `XXXX XXXX ${emp.aadhar_last4}` : null} icon="🆔" notify={notify} />
            <Field label="UAN" value={emp.uan_number} icon="🏦" copyable sensitive notify={notify} />
            <div style={{ fontSize: 10.5, color: P.dim, marginTop: 7, lineHeight: 1.5 }}>
              Hidden by default. Reveal only when you need to copy one.
            </div>
          </Panel>
        </div>
      )}

      {tab === 'UPDATE' && (
        <div style={{ background: P.white, borderRadius: 12, border: `1px solid ${P.line}`,
                      padding: '18px 18px', maxWidth: 720 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.navy }}>Request a change</div>
          <div style={{ fontSize: 12, color: P.muted, marginTop: 4, marginBottom: 15, lineHeight: 1.6 }}>
            You cannot edit these directly — payroll and statutory filings depend on them, so every
            change goes to HR for approval. You will see it under Raise a Request.
          </div>

          <label style={T.label}>What to update</label>
          <select style={{ ...T.input, marginBottom: 13 }} value={field} onChange={e => setField(e.target.value)}>
            {FIELDS.map(f => <option key={f}>{f}</option>)}
          </select>

          {field === 'Bank Account' ? (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11, marginBottom:12 }}>
              <div><label style={T.label}>IFSC code *</label><input style={T.input} value={bank.ifsc} maxLength={11} onChange={e => { const v = e.target.value.toUpperCase(); setBank(b => ({ ...b, ifsc: v })); lookupIfsc(v) }} placeholder="e.g. HDFC0001234" /></div>
              <div><label style={T.label}>Account type</label><select style={T.input} value={bank.account_type} onChange={e => setBank(b => ({ ...b, account_type: e.target.value }))}><option>Savings</option><option>Current</option></select></div>
              <div><label style={T.label}>Account number *</label><input style={T.input} value={bank.account_number} onChange={e => setBank(b => ({ ...b, account_number: e.target.value }))} /></div>
              <div><label style={T.label}>Confirm account number *</label><input style={{ ...T.input, borderColor: bank.confirm && bank.confirm !== bank.account_number ? P.red : undefined }} value={bank.confirm} onChange={e => setBank(b => ({ ...b, confirm: e.target.value }))} /></div>
              <div><label style={T.label}>Bank name</label><input style={{ ...T.input, background:C.positiveTint, border: `1px solid ${C.positiveTint}` }} value={bank.bank_name} onChange={e => setBank(b => ({ ...b, bank_name: e.target.value }))} placeholder="Fills in from IFSC" /></div>
              <div><label style={T.label}>Branch</label><input style={{ ...T.input, background:C.positiveTint, border: `1px solid ${C.positiveTint}` }} value={bank.branch} onChange={e => setBank(b => ({ ...b, branch: e.target.value }))} placeholder="Fills in from IFSC" /></div>
              <div style={{ gridColumn:'span 2' }}><label style={T.label}>Account holder name *</label><input style={T.input} value={bank.holder_name} onChange={e => setBank(b => ({ ...b, holder_name: e.target.value }))} placeholder="Exactly as your bank has it" /></div>
              {bank.confirm && bank.confirm !== bank.account_number && (
                <div style={{ gridColumn:'span 2', color:P.red, fontSize:12, marginTop:-4 }}>
                  The two account numbers do not match.
                </div>
              )}
            </div>
          ) : (
            <>
              <label style={T.label}>Details</label>
              <textarea style={{ ...T.input, minHeight:90, marginBottom:12, resize:'vertical' }} value={detail} onChange={e => setDetail(e.target.value)} placeholder="What it should say instead…" />
            </>
          )}

          <button onClick={submit} disabled={busy}
                  style={{ ...T.btnP, opacity: busy ? .6 : 1,
                           boxShadow: busy ? 'none' : '0 3px 12px rgba(37,99,235,0.3)' }}>
            {busy ? 'Sending…' : 'Send to HR'}
          </button>
        </div>
      )}
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
        <div style={T.section}>Request a Letter (HR generates on approval)</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={T.label}>Letter type</label><select style={T.input} value={type} onChange={e => setType(e.target.value)}>{LETTER_TYPES.map(l => <option key={l}>{l}</option>)}</select></div>
          <div><label style={T.label}>Purpose</label><input style={T.input} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. bank loan, visa…" /></div>
        </div>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, opacity: busy?.6:1 }}>{busy ? 'Sending…' : 'Request letter'}</button>
      </div>
      <div style={T.card}>
        <div style={T.section}>My Letter Requests</div>
        {rows.length === 0 && <div style={{ fontSize:12, color:C.faint }}>No requests yet.</div>}
        {rows.map(r => (
          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom: `1px solid ${C.brandEdge}` }}>
            <div><div style={{ fontSize:13, fontWeight:600 }}>{r.letter_type}</div><div style={{ fontSize:11, color:C.faint }}>{r.purpose || '—'} · {fmt(r.requested_at)}</div></div>
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
        <div style={T.section}>Raise a Request</div>
        <label style={T.label}>Type</label>
        <select style={{ ...T.input, marginBottom:10 }} value={type} onChange={e => setType(e.target.value)}>{REQ_TYPES.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}</select>
        {def.confidential && <div style={{ background:C.criticalTint, border: `1px solid ${C.criticalTint}`, borderRadius:7, padding:'8px 11px', marginBottom:10, fontSize:12, color:C.critical }}>This is confidential and routes only to the Internal Committee — not regular HR.</div>}
        <label style={T.label}>Details</label>
        <textarea style={{ ...T.input, minHeight:90, marginBottom:10, resize:'vertical' }} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Describe your request…" />
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, opacity: busy?.6:1 }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
      <div style={T.card}>
        <div style={T.section}>My Requests</div>
        {rows.length === 0 && <div style={{ fontSize:12, color:C.faint }}>No requests yet.</div>}
        {rows.map(r => (
          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom: `1px solid ${C.brandEdge}` }}>
            <div><div style={{ fontSize:13, fontWeight:600 }}>{REQ_TYPES.find(x => x.k === r.request_type)?.label || r.request_type}{r.is_confidential && ' 🔒'}</div><div style={{ fontSize:11, color:C.faint }}>{r.request_data?.detail?.slice(0,60) || '—'} · {fmt(r.submitted_at)}</div></div>
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
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom: `1px solid ${C.brandEdge}` }}>
      <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }}>{label}</span>
      <span style={{ fontSize:13, color:C.ink, textAlign:'right', wordBreak:'break-word' }}>{value || '—'}</span>
    </div>
  )
}
function DirectoryDetailModal({ e, onClose }: { e: DirectoryEntry; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:4000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={ev => ev.stopPropagation()} style={{ background:C.surface, borderRadius:14, width:'100%', maxWidth:440, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'18px 20px', borderBottom: `1px solid ${C.brandEdge}` }}>
          <div style={{ width:48, height:48, borderRadius:'50%', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:16, flexShrink:0 }}>{initials(e.full_name)}</div>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:16, fontWeight:700 }}>{e.full_name}</div>
            <div style={{ fontSize:12, color:C.faint }}>{e.designation || '—'}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:24, lineHeight:1, cursor:'pointer', color:C.faint }}>×</button>
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
          {(e.office_email || e.personal_email) && <a href={`mailto:${e.office_email || e.personal_email}`} style={{ ...T.btnO, textDecoration:'none' }}>Email</a>}
          {e.mobile && <a href={`tel:${e.mobile}`} style={{ ...T.btnO, textDecoration:'none' }}>Call</a>}
          {e.mobile && <a href={`https://wa.me/91${(e.mobile||'').replace(/\D/g,'').slice(-10)}`} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration:'none' }}>WhatsApp</a>}
          <button onClick={onClose} style={{ ...T.btnO, marginLeft:'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
// A stable colour per person so the same face keeps the same avatar between visits.
const DIR_TINTS = [
  { bg: C.brandTint, fg: C.brandDeep }, { bg: C.brandTint, fg: C.brand }, { bg: C.positiveTint, fg: C.positive },
  { bg: C.warningTint, fg: C.critical }, { bg: C.criticalTint, fg: C.critical }, { bg: C.brandTint, fg: C.brand },
  { bg: C.infoTint, fg: C.info }, { bg: C.warningTint, fg: C.warning },
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
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${C.brand},${C.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Employee Directory</div>
            <div style={{ fontSize: 11, color: C.faint }}>
              {loading ? 'Loading colleagues…' : `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''} colleague${filtered.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...T.input, flex: 1, minWidth: 200 }} placeholder="Search name, code, designation, department or email" value={q} onChange={e => setQ(e.target.value)} />
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

      {err && <div style={{ ...T.card, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalTint}` }}>Could not load the directory — {err}</div>}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ ...T.card, opacity: .6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: C.brandTint }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 11, background: C.brandTint, borderRadius: 4, width: '65%', marginBottom: 7 }} />
                  <div style={{ height: 9, background: C.sunken, borderRadius: 4, width: '45%' }} />
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
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.full_name}</div>
                    <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.designation || '—'}</div>
                    <div style={{ fontSize: 10, color: C.faint, marginTop: 1 }}>{e.emp_code}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {e.dept_name && chip(e.dept_name, C.canvas, C.brandDeep)}
                  {e.location_name && chip('📍 ' + e.location_name, C.sunken, C.inkSoft)}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: `1px solid ${C.line}`, paddingTop: 8 }} onClick={ev => ev.stopPropagation()}>
                  {(e.office_email || e.personal_email) && <a href={`mailto:${e.office_email || e.personal_email}`} title={e.office_email || e.personal_email || ''} style={{ ...T.btnO, textDecoration: 'none' }}>Email</a>}
                  {e.mobile && <a href={`tel:${e.mobile}`} title={e.mobile} style={{ ...T.btnO, textDecoration: 'none' }}>Call</a>}
                  {e.mobile && <a href={`https://wa.me/91${(e.mobile || '').replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noreferrer" style={{ ...T.btnO, textDecoration: 'none' }}>WhatsApp</a>}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && !err && (
            <div style={{ ...T.card, gridColumn: '1 / -1', textAlign: 'center', padding: '30px 16px' }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}></div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 3 }}>No colleagues match that search</div>
              <div style={{ fontSize: 11.5, color: C.faint }}>Try a different name, code or department{(dept || loc) ? ', or clear the filters' : ''}.</div>
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
        <div style={T.section}>Notifications</div>
        <button onClick={async () => { await markAllNotifications(emp.id); load() }} style={T.btnO}>Mark all read</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize:12, color:C.faint, padding:'8px 0' }}>You're all caught up. 🎉</div>}
      {rows.map(n => (
        <div key={n.id} onClick={async () => { if (!n.is_read) { await markNotification(n.id); load() } }} style={{ padding:'9px 0', borderBottom: `1px solid ${C.brandEdge}`, cursor: n.is_read ? 'default' : 'pointer', opacity: n.is_read ? .6 : 1 }}>
          <div style={{ fontSize:13, fontWeight:600 }}>{!n.is_read && <span style={{ color:C.brand }}>● </span>}{n.title}</div>
          {n.body && <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{n.body}</div>}
          <div style={{ fontSize:10, color:C.faint, marginTop:2 }}>{n.category || ''} · {fmtDT(n.created_at)}</div>
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
  const barColor = (pct: number) => pct > 60 ? C.positive : pct > 30 ? C.warning : C.critical
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
  const STATUS: Record<string, [string, string]> = { PENDING: [C.warningTint, C.warning], APPROVED: [C.positiveTint, C.positive], REJECTED: [C.criticalTint, C.critical], CANCELLED: [C.sunken, C.muted] }
  const HOL_STYLE: Record<string, [string, string]> = { NATIONAL: [C.infoTint, C.brand], FESTIVAL: [C.brandTint, C.muted], OPTIONAL: [C.warningTint, C.warning], REGIONAL: [C.brandTint, C.brand] }
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = hols.filter((h: any) => h.holiday_date >= today)
  return (
    <div>
      <div style={T.card}>
        <div style={T.section}>Leave Balance · FY 2026-27</div>
        {balances.length === 0 ? <div style={{ fontSize: 12, color: C.faint }}>No leave balances yet — contact HR.</div> :
          balances.map((b: any) => { const total = Number(b.opening || 0) + Number(b.accrued || 0); const av = avail(b); const pct = total > 0 ? Math.round(av / total * 100) : 0; return (
            <div key={b.id} style={{ background: C.sunken, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}><span style={{ fontSize: 10, background: C.brandTint, color: C.brandDeep, padding: '2px 7px', borderRadius: 99, marginRight: 6 }}>{b.leave_types?.short_name}</span>{b.leave_types?.name}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: barColor(pct) }}>{av}<span style={{ fontSize: 11, color: C.faint, fontWeight: 400 }}> / {total}</span></span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: C.line, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: barColor(pct) }} /></div>
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
        {apps.length === 0 ? <div style={{ fontSize: 12, color: C.faint }}>No leave applications yet.</div> :
          apps.map((a: any) => { const [bg, c] = STATUS[a.status] || [C.sunken, C.muted]; return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brandEdge}`, fontSize: 12 }}>
              <span style={{ fontSize: 10, background: C.brandTint, color: C.brandDeep, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>{a.leave_types?.short_name}</span>
              <span style={{ flex: 1 }}>{a.from_date}{a.to_date !== a.from_date ? ` → ${a.to_date}` : ''}{a.half_day ? ' (½)' : ''}</span>
              <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: bg, color: c, fontWeight: 600 }}>{a.status}</span>
            </div>
          )})}
      </div>
      <div style={T.card}>
        <div style={T.section}>Upcoming Holidays</div>
        {upcoming.length === 0 ? <div style={{ fontSize: 12, color: C.faint }}>No upcoming holidays.</div> :
          upcoming.map((h: any) => { const [bg, c] = HOL_STYLE[h.holiday_type] || [C.sunken, C.muted]; return (
            <div key={h.holiday_date + h.description} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brandEdge}`, fontSize: 12 }}>
              <span style={{ minWidth: 64, fontWeight: 600 }}>{new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
              <span style={{ flex: 1 }}>{h.description}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: bg, color: c, fontWeight: 600 }}>{h.holiday_type}</span>
              {h.is_optional && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: C.warningTint, color: C.warning }}>Optional</span>}
            </div>
          )})}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// ATTENDANCE (B3)
// ════════════════════════════════════════════════════════════════
// Higher-contrast pairs than the originals, which sat around olive on pale
// green and were hard to read at calendar-cell size. Each is [background, ink]
// and every pair clears WCAG AA at 11px.
const STATUS_STYLE: Record<string,[string,string]> = {
  PRESENT:[C.sunken,C.positive], ABSENT:[C.criticalTint,C.critical], HALF_DAY:[C.warningTint,C.warning],
  MISS_PUNCH:[C.warningTint,C.critical], LWP:[C.criticalTint,C.critical], WEEKLY_OFF:[C.sunken,C.faint],
  HOLIDAY:[C.brandTint,C.info], ON_LEAVE:[C.brandTint,C.brandDeep], FUTURE:['transparent',C.lineStrong], TODAY:[C.canvas,C.brand],
}
/** Accent bar colour per status — the saturated version of the ink. */
const STATUS_BAR: Record<string,string> = {
  PRESENT: C.positive, ABSENT:C.critical, HALF_DAY:C.warning, MISS_PUNCH: C.warning,
  LWP:C.critical, WEEKLY_OFF:C.lineStrong, HOLIDAY:C.info, ON_LEAVE: C.brand,
}
const STATUS_FULL: Record<string,string> = {
  PRESENT:'Present', ABSENT:'Absent', HALF_DAY:'Half day', MISS_PUNCH:'Missing punch',
  LWP:'Loss of pay', WEEKLY_OFF:'Weekly off', HOLIDAY:'Holiday', ON_LEAVE:'On leave', FUTURE:'—',
}
const STATUS_LABEL: Record<string,string> = { PRESENT:'P', ABSENT:'A', HALF_DAY:'½', MISS_PUNCH:'!', LWP:'LWP', WEEKLY_OFF:'W', HOLIDAY:'H', ON_LEAVE:'L', FUTURE:'', ABSENT_FULL:'Absent' }

const fmtT = (iso: string|null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const pad2 = (n: number) => String(n).padStart(2,'0')

function StatusBadge({ status }: { status: string }) {
  const [bg,c] = STATUS_STYLE[status] || [C.brandTint,C.brandDeep]
  const lbl = ({ PRESENT:'Present', ABSENT:'Absent', HALF_DAY:'Half Day', MISS_PUNCH:'Miss Punch', LWP:'LWP', WEEKLY_OFF:'Weekly Off', HOLIDAY:'Holiday', ON_LEAVE:'On Leave', FUTURE:'—' } as Record<string,string>)[status] || status
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{lbl}</span>
}

// 1) Summary chips ──────────────────────────────────────────────
/**
 * Month statistics read off the calendar itself.
 *
 * computeSummary() counts attendance_records, and a day with no record at all
 * produces no row — but resolveDay() shows that day as ABSENT on the grid,
 * because a past working day with nothing recorded is an absence. So the two
 * disagreed: with one PRESENT record and twelve blank days, the summary said
 * 100% while the calendar showed twelve A's.
 *
 * This walks the month the same way the grid does, so the number above the
 * calendar always describes the calendar below it. Weekly offs, holidays and
 * approved leave are excluded from the denominator — being off on a Sunday is
 * not an absence.
 */
function monthStats(year: number, month: number, md: MonthlyData | null, todayStr: string) {
  const empty = { present:0, absent:0, halfDay:0, lateCount:0, lopDays:0, missPunch:0,
                  onLeave:0, totalOTHours:'0h 0m', working:0, pct:null as number | null }
  if (!md) return empty

  const days = new Date(year, month, 0).getDate()
  let present=0, absent=0, halfDay=0, late=0, lop=0, miss=0, leave=0, ot=0

  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(month)}-${pad2(d)}`
    if (ds > todayStr) continue                    // the future is not a result yet
    const { status, rec } = resolveDay(ds, md, todayStr)

    if (rec?.late_minutes) late++
    if (rec?.overtime_minutes) ot += rec.overtime_minutes

    switch (status) {
      case 'PRESENT':    present++; break
      case 'HALF_DAY':   halfDay++; break
      case 'MISS_PUNCH': miss++; present++; break   // they were here; the punch is what is missing
      case 'LWP':        lop++; break
      case 'ABSENT':     absent++; break
      case 'ON_LEAVE':   leave++; break
      default: break                                 // weekly off, holiday — not working days
    }
  }

  const working = present + absent + halfDay + lop
  const earned = present + halfDay * 0.5
  return {
    present, absent, halfDay, lateCount: late, lopDays: lop, missPunch: miss, onLeave: leave,
    totalOTHours: `${Math.floor(ot/60)}h ${ot%60}m`,
    working,
    pct: working > 0 ? Math.round((earned / working) * 100) : null,
  }
}

/**
 * The month, as one glance.
 *
 * The old header was a bare Prev / Next bar and six equal chips. Nothing said
 * how the month was actually going, which is the only question an employee
 * opens this page with. The ring answers it before anything is read.
 *
 * Attendance % counts half days as half and ignores weekly offs, holidays and
 * approved leave — being off on a Sunday is not an absence, and scoring it as
 * one would make the number meaningless.
 */
function MonthHero({ month, year, summary, onPrev, onNext, onToday, isThisMonth, isMobile }: {
  month: number; year: number; summary: ReturnType<typeof monthStats>
  onPrev: () => void; onNext: () => void; onToday: () => void
  isThisMonth: boolean; isMobile: boolean
}) {
  const { working, pct } = summary
  const tone = pct == null ? C.faint : pct >= 95 ? C.positive : pct >= 85 ? C.warning : C.criticalTint

  const size = isMobile ? 68 : 82
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r

  const nav: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 9, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.10)',
    color: C.onAccent, fontSize: 15, fontFamily: 'inherit', lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .15s ease, transform .12s ease',
  }

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 11, position: 'relative',
                  background: `linear-gradient(135deg,${C.ink} 0%,${C.inkSoft} 55%,${C.brand} 100%)`,
                  boxShadow: '0 8px 26px rgba(30,27,75,0.26)' }}>
      <div style={{ position: 'absolute', top: -80, right: -50, width: 220, height: 220,
                    borderRadius: '50%', background: 'rgba(167,139,250,0.15)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', padding: isMobile ? '16px 16px' : '18px 20px',
                    display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 190 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
            <button onClick={onPrev} className="ezer-nav" style={nav} title="Previous month">‹</button>
            <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 700, color: C.onAccent, letterSpacing: '-.01em' }}>
              {MONTH_NAMES[month - 1]} <span style={{ opacity: .55, fontWeight: 500 }}>{year}</span>
            </div>
            <button onClick={onNext} className="ezer-nav" style={nav} title="Next month">›</button>
            {!isThisMonth && (
              <button onClick={onToday} className="ezer-nav"
                      style={{ ...nav, width: 'auto', padding: '0 11px', fontSize: 11.5, fontWeight: 600 }}>
                Today
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.onAccentDim }}>
            {working > 0
              ? `${working} working day${working === 1 ? '' : 's'} · ${summary.present} present, ${summary.absent} absent`
              : 'No working days recorded yet'}
          </div>
          {summary.totalOTHours && summary.totalOTHours !== '0h 0m' && (
            <div style={{ fontSize: 11.5, color: C.positive, marginTop: 5 }}>
              ⏱ {summary.totalOTHours} overtime this month
            </div>
          )}
        </div>

        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="7" />
            {pct != null && (
              <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={`${(circ * pct) / 100} ${circ}`}
                      style={{ transition: 'stroke-dasharray .9s cubic-bezier(.22,1,.36,1), stroke .4s ease',
                               filter: `drop-shadow(0 0 5px ${tone}66)` }} />
            )}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', color: C.onAccent }}>
            <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, lineHeight: 1 }}>
              {pct == null ? '—' : `${pct}%`}
            </span>
            <span style={{ fontSize: 8.5, opacity: .65, letterSpacing: '.06em', marginTop: 2 }}>ATTENDANCE</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One statistic. Zero is greyed, so the eye lands on what actually happened. */
function StatTile({ label, value, bg, fg, bar, wide }: {
  label: string; value: string; bg: string; fg: string; bar: string; wide?: boolean
}) {
  const empty = value === '0' || value === '0h 0m'
  return (
    <div className="ezer-tile" style={{ background: empty ? '#FAFAFA' : bg, borderRadius: 10, padding: '10px 13px',
                  border: `1px solid ${empty ? C.line : bg}`, position: 'relative',
                  overflow: 'hidden', minWidth: wide ? 96 : 74, flex: wide ? '1 1 96px' : '1 1 74px' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                    background: empty ? C.line : bar }} />
      <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.05, marginLeft: 4,
                    color: empty ? C.line : fg }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
                    marginLeft: 4, marginTop: 3, color: empty ? C.line : fg, opacity: empty ? 1 : .8 }}>
        {label}
      </div>
    </div>
  )
}

function AttendanceSummaryChips({ summary, isMobile }: { summary: ReturnType<typeof monthStats>; isMobile: boolean }) {
  const tiles: { label: string; value: string; k: string; wide?: boolean }[] = [
    { label:'Present',   value:String(summary.present),   k:'PRESENT' },
    { label:'Absent',    value:String(summary.absent),    k:'ABSENT' },
    { label:'Half day',  value:String(summary.halfDay),   k:'HALF_DAY' },
    { label:'Late',      value:String(summary.lateCount), k:'MISS_PUNCH' },
    { label:'Overtime',  value:summary.totalOTHours,      k:'ON_LEAVE', wide:true },
    { label:'Loss of pay', value:String(summary.lopDays), k:'LWP' },
  ]
  return (
    <div style={{ display:'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', gap:8, marginBottom:11,
                  overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
      {tiles.map(t => {
        const [bg, fg] = STATUS_STYLE[t.k]
        return <StatTile key={t.label} label={t.label} value={t.value}
                         bg={bg} fg={fg} bar={STATUS_BAR[t.k]} wide={t.wide} />
      })}
    </div>
  )
}

/** What the colours mean. Without this the calendar is a puzzle on first visit. */
function CalendarLegend() {
  const items = ['PRESENT','ABSENT','HALF_DAY','MISS_PUNCH','ON_LEAVE','HOLIDAY','WEEKLY_OFF']
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 13px', marginTop:11, paddingTop:9,
                  borderTop: `1px solid ${C.brandEdge}` }}>
      {items.map(k => (
        <span key={k} style={{ display:'inline-flex', alignItems:'center', gap:5,
                               fontSize:10, color:C.faint }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:STATUS_BAR[k] }} />
          {STATUS_FULL[k]}
        </span>
      ))}
    </div>
  )
}

// 2) Calendar ────────────────────────────────────────────────────
/**
 * The month grid.
 *
 * Changes from the original that matter:
 *   · a real weekday header, so a date can be located without counting
 *   · weekend columns tinted, which is how people actually scan a month
 *   · status carried by a left accent bar as well as fill, so the grid stays
 *     readable for the ~8% of men with colour vision deficiency
 *   · today ringed and labelled; the selected day lifts rather than just
 *     outlining, so the day detail below has a visible origin
 *   · punch times shown when there is room, since "when did I leave" is the
 *     second question after "was I present"
 *   · future days rendered flat and unclickable — nothing to see, and a
 *     clickable empty panel is a dead end
 */
/* Keyframes for the calendar. Injected once — this file uses inline styles,
   which cannot express @keyframes or :active, and a media query for reduced
   motion cannot be written inline either.

   The last block is the important one. Motion here is decorative: it tells you
   a month changed and which cell you are on. For anyone who has asked their OS
   to reduce motion — vestibular disorders, migraine triggers — the same
   information has to arrive without the movement, so every animation collapses
   to a near-instant fade and the 3D tilt is dropped entirely. */
function ShimmerKeyframes() {
  return <style>{`
    @keyframes ezerShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

    /* Cells arrive as a wave across the grid, so a month reads as one object
       being dealt rather than 31 things appearing at once. */
    @keyframes ezerCellIn{
      from{opacity:0;transform:translateY(6px) scale(.94)}
      to  {opacity:1;transform:none}
    }
    @keyframes ezerPanelIn{
      from{opacity:0;transform:translateX(8px)}
      to  {opacity:1;transform:none}
    }
    .ezer-cell{
      animation:ezerCellIn .32s cubic-bezier(.22,1,.36,1) both;
      transform-origin:center;
      will-change:transform;
    }
    /* The lift is a real one — the cell rises toward the viewer and tips very
       slightly, which is what makes it read as a tile rather than a rectangle
       that changed colour. */
    .ezer-cell:not(:disabled):hover{
      transform:translateZ(16px) translateY(-2px) rotateX(6deg);
      z-index:2;
    }
    .ezer-cell:not(:disabled):active{
      transform:translateZ(2px) scale(.95);
      transition-duration:.06s;
    }
    .ezer-day-panel{animation:ezerPanelIn .3s cubic-bezier(.22,1,.36,1) both}

    /* Month navigation. Inline styles cannot express :hover or :active. */
    .ezer-nav:hover{background:rgba(255,255,255,.2)!important}
    .ezer-nav:active{transform:scale(.9)}

    /* Stat tiles rise very slightly, enough to say they are a group of objects. */
    .ezer-tile{transition:transform .16s cubic-bezier(.22,1,.36,1), box-shadow .16s ease}
    .ezer-tile:hover{transform:translateY(-2px);box-shadow:0 6px 16px -6px rgba(30,27,75,.22)}

    @media (prefers-reduced-motion: reduce){
      .ezer-cell,.ezer-day-panel{animation-duration:.01ms!important;animation-delay:0ms!important}
      .ezer-cell:not(:disabled):hover{transform:translateY(-1px);}
      .ezer-cell:not(:disabled):active{transform:none}
    }
  `}</style>
}

/**
 * The month grid.
 *
 * Sized deliberately. The previous version used `repeat(7, 1fr)` with 74px
 * cells and no width cap, so on a wide screen the columns stretched to fill the
 * content area and the calendar became a wall of oversized boxes. A month is a
 * fixed shape — it should not grow just because the window did. The grid is
 * capped at 476px (7 x 60 + gaps), which is about as wide as a month wants to
 * be before the eye stops reading it as a unit.
 *
 * Density follows from that: the grid is for scanning, the panel below is for
 * detail. Each cell carries the date, a status dot, and — only where it fits
 * and matters — the punch times. Everything else moved to the day panel.
 *
 * Status is a coloured dot plus a tinted fill rather than a heavy accent bar,
 * so the grid reads as a calendar instead of a bar chart, and still works
 * without relying on colour alone.
 */
/** The right column before a day is picked. An empty panel reads as broken. */
function DayPanelResting({ summary }: { summary: ReturnType<typeof monthStats> }) {
  const rows: [string, string, string][] = [
    ['Present',   String(summary.present),   STATUS_BAR.PRESENT],
    ['Absent',    String(summary.absent),    STATUS_BAR.ABSENT],
    ['Half day',  String(summary.halfDay),   STATUS_BAR.HALF_DAY],
    ['On leave',  String(summary.onLeave),   STATUS_BAR.ON_LEAVE],
  ]
  return (
    <div style={{ ...T.card, height: '100%', display: 'flex', flexDirection: 'column',
                  justifyContent: 'center', marginBottom: 0 }}>
      <div style={{ textAlign: 'center', padding: '6px 0 16px' }}>
        <div style={{ fontSize: 26, marginBottom: 6 }}></div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Pick a day</div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, lineHeight: 1.55 }}>
          Its punches, hours and status appear here.
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${C.brandEdge}`, paddingTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: '.06em',
                      textTransform: 'uppercase', marginBottom: 8 }}>This month so far</div>
        {rows.map(([k, v, c]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
            <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 700,
                           color: v === '0' ? C.line : C.ink }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The calendar card as a physical object: it sits above the page at rest and
// turns to face the cursor. The tilt is written straight to the node on a
// rAF — routing it through useState would re-render all 31 cells per pointer
// move, which is exactly what made the per-cell tilt stutter.
const TILT_MAX = 7          // degrees; past ~9 the type starts to smear
const LIFT_REST = 8         // px off the page when idle
const LIFT_HOVER = 26

function TiltCard({ children, disabled, style }: {
  children: React.ReactNode; disabled?: boolean; style?: React.CSSProperties
}) {
  const wrap  = useRef<HTMLDivElement | null>(null)
  const card  = useRef<HTMLDivElement | null>(null)
  const sheen = useRef<HTMLDivElement | null>(null)
  const frame = useRef<number | null>(null)

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])

  // Someone who has asked for less motion gets the depth (shadow, lift) but
  // not the movement.
  const still = () => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const rest = () => {
    const el = card.current
    if (!el) return
    el.style.transform = `translateZ(${LIFT_REST}px)`
    el.style.boxShadow = '0 2px 6px rgba(30,27,75,.07), 0 14px 34px -18px rgba(30,27,75,.30)'
    if (sheen.current) sheen.current.style.opacity = '0'
  }

  const track = (e: React.MouseEvent) => {
    if (disabled || still()) return
    const w = wrap.current, el = card.current
    if (!w || !el) return
    const r = w.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width      // 0..1 across the card
    const py = (e.clientY - r.top) / r.height
    const rx = (0.5 - py) * 2 * TILT_MAX           // cursor high -> top leans back
    const ry = (px - 0.5) * 2 * TILT_MAX
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      el.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(${LIFT_HOVER}px)`
      // The shadow is cast by a light above and behind the viewer, so it slides
      // opposite the tilt. A shadow that does not move gives the trick away.
      el.style.boxShadow = `${(-ry * 1.7).toFixed(1)}px ${(20 + rx * 1.7).toFixed(1)}px 46px -20px rgba(30,27,75,.42), 0 2px 6px rgba(30,27,75,.10)`
      if (sheen.current) {
        sheen.current.style.opacity = '1'
        sheen.current.style.background =
          `radial-gradient(340px circle at ${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%, rgba(167,139,250,.16), rgba(37,99,235,.05) 45%, rgba(37,99,235,0) 70%)`
      }
    })
  }

  if (disabled) return <div style={style}>{children}</div>

  return (
    <div ref={wrap}
         onMouseMove={track}
         onMouseLeave={rest}
         style={{ perspective: 1300, perspectiveOrigin: '50% 45%', flex: '0 0 auto' }}>
      <div ref={card}
           style={{
             ...style,
             position: 'relative',
             transformStyle: 'preserve-3d',
             transform: `translateZ(${LIFT_REST}px)`,
             boxShadow: '0 2px 6px rgba(30,27,75,.07), 0 14px 34px -18px rgba(30,27,75,.30)',
             transition: 'transform .34s cubic-bezier(.22,1,.36,1), box-shadow .34s cubic-bezier(.22,1,.36,1)',
           }}>
        {children}
        {/* Specular highlight. Sits above the content but takes no clicks. */}
        <div ref={sheen} aria-hidden
             style={{ position: 'absolute', inset: 0, borderRadius: 10, opacity: 0,
                      pointerEvents: 'none', transition: 'opacity .28s ease' }} />
      </div>
    </div>
  )
}

function AttendanceCalendar({ year, month, monthData, todayStr, isMobile, onDayClick, selectedDate }: {
  year: number; month: number; monthData: MonthlyData; todayStr: string; isMobile: boolean
  onDayClick: (d: string) => void; selectedDate: string|null
}) {
  const cell = isMobile ? 40 : 56
  const gap = 4
  const maxW = isMobile ? '100%' : 7 * 60 + gap * 6   // a month, not a banner
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = new Date(year, month-1, 1).getDay()

  const cells: React.ReactNode[] = []
  for (let i = 0; i < lead; i++) cells.push(<div key={'b'+i} />)

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`
    const { status, rec, leave } = resolveDay(dateStr, monthData, todayStr)
    const [bg, ink] = STATUS_STYLE[status] || [C.surface, C.ink]
    const dot = STATUS_BAR[status]
    const isToday = dateStr === todayStr
    const isSel = dateStr === selectedDate
    const isFuture = status === 'FUTURE'
    const hasTimes = !isMobile && !isFuture && rec && (rec.work_in || rec.work_out)
    // Wave across the grid rather than a uniform fade. Capped so the last cell
    // of a 31-day month is not still arriving half a second later.
    const delay = Math.min((lead + d - 1) * 9, 260)

    cells.push(
      <button key={dateStr}
        className="ezer-cell"
        onClick={() => !isFuture && onDayClick(dateStr)}
        disabled={isFuture}
        title={isFuture ? '' : `${STATUS_FULL[status] || status}${rec?.work_in ? ` · in ${fmtT(rec.work_in)}` : ''}${rec?.late_minutes ? ` · ${rec.late_minutes}m late` : ''}`}
        style={{
          height: cell, position: 'relative', overflow: 'hidden', fontFamily: 'inherit',
          background: isSel ? 'linear-gradient(145deg,#3B82F6,#1D4ED8)'
                    : isFuture ? 'transparent' : bg,
          color: isSel ? C.surface : ink,
          border: isSel ? '1px solid #1D4ED8'
                : isToday ? '1.5px solid #93C5FD'
                : '1px solid rgba(37,99,235,0.09)',
          borderRadius: 8, padding: 0,
          cursor: isFuture ? 'default' : 'pointer',
          opacity: isFuture ? .45 : 1,
          animationDelay: `${delay}ms`,
          // Two-layer shadow: a tight contact shadow plus a softer cast one.
          // A single blur reads as a glow; two read as height.
          boxShadow: isSel
            ? '0 1px 2px rgba(76,29,149,.4), 0 8px 20px -4px rgba(37,99,235,.45)'
            : isToday ? '0 1px 2px rgba(37,99,235,.12)' : 'none',
          transition: 'box-shadow .18s ease, background .18s ease, transform .18s cubic-bezier(.22,1,.36,1)',
          transformStyle: 'preserve-3d',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1,
        }}>

        <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: isToday ? 800 : 600, lineHeight: 1 }}>
          {d}
        </span>

        {/* the status, as a dot — small, and never the only signal */}
        {!isFuture && dot && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', marginTop: 1,
                         background: isSel ? 'rgba(255,255,255,0.9)' : dot }} />
        )}

        {hasTimes && (
          <span style={{ fontSize: 7.5, lineHeight: 1, opacity: .75, marginTop: 1,
                         fontVariantNumeric: 'tabular-nums' }}>
            {fmtT(rec!.work_in)}
          </span>
        )}

        {!isFuture && status === 'ON_LEAVE' && leave?.short_name && (
          <span style={{ fontSize: 7.5, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
            {leave.short_name}
          </span>
        )}

        {isToday && !isSel && (
          <span style={{ position: 'absolute', top: 3, right: 4, width: 4, height: 4,
                         borderRadius: '50%', background: C.brand }} />
        )}
      </button>
    )
  }

  return (
    <div style={{ maxWidth: maxW }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap, marginBottom: 3,
                    transform: 'translateZ(14px)' }}>
        {WEEKDAYS.map((w, n) => (
          <div key={w} style={{ textAlign:'center', fontSize:9.5, fontWeight:700,
                                letterSpacing:'.05em', padding:'3px 0',
                                color: n % 6 === 0 ? C.brand : C.line }}>
            {w[0]}{isMobile ? '' : w[1]}
          </div>
        ))}
      </div>
      {/* The perspective lives on the container, so a hovered cell tilts within
          a shared vanishing point instead of each one having its own. Re-keyed
          on the month so changing it replays the entrance. */}
      <div key={`${year}-${month}`}
           style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap,
                    perspective: 700, perspectiveOrigin: '50% 40%',
                    // Lifted off the card face. Combined with the card's own
                    // tilt this is what parallaxes — the grid moves further
                    // than the legend beneath it.
                    transform: 'translateZ(26px)' }}>
        {cells}
      </div>
      <div style={{ transform: 'translateZ(6px)' }}><CalendarLegend /></div>
    </div>
  )
}

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

      {holiday && <div style={{ fontSize:13, color: C.brand, background: C.brandTint, borderRadius:7, padding:'8px 11px', marginBottom:10 }}>🎌 {holiday.description}{holiday.is_optional ? ' (Optional)' : ''}</div>}
      {status === 'WEEKLY_OFF' && <div style={{ fontSize:13, color:C.faint, background:C.sunken, borderRadius:7, padding:'8px 11px', marginBottom:10 }}>Weekly Off</div>}
      {leave && <div style={{ fontSize:13, color:C.brandDeep, background:C.brandTint, borderRadius:7, padding:'8px 11px', marginBottom:10 }}>On Leave — {leave.name}{leave.half_day ? ' (Half day)' : ''}</div>}

      {rec && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:8, marginBottom:10 }}>
          {([['In', fmtT(rec.work_in)],['Out', fmtT(rec.work_out)],['Worked', worked],['Late', `${rec.late_minutes||0}m`],['OT', `${rec.overtime_minutes||0}m`]] as [string,string][]).map(([k,v]) => (
            <div key={k} style={{ background:C.sunken, borderRadius:7, padding:'7px 10px' }}>
              <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' }}>{k}</div>
              <div style={{ fontSize:13, fontWeight:600, marginTop:2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize:11, fontWeight:600, color:C.brandDeep, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Punch Timeline</div>
      {loading ? <div style={{ fontSize:12, color:C.faint }}>Loading punches…</div>
        : punches.length === 0 ? <div style={{ fontSize:12, color:C.faint }}>No raw punches recorded.</div>
        : punches.map((p, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom: `1px solid ${C.brandEdge}`, fontSize:12 }}>
            <span style={{ fontWeight:600, minWidth:52 }}>{fmtT(p.punch_time)}</span>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: p.punch_type==='IN' ? C.positiveTint : C.criticalTint, color: p.punch_type==='IN' ? C.positive : C.critical }}>{p.punch_type}</span>
            <span style={{ color:C.muted }}>{p.source || '—'}</span>
            {p.geofence_status && <span style={{ marginLeft:'auto', fontSize:10, color:C.faint }}>{p.geofence_status}</span>}
          </div>
        ))}

      {status === 'MISS_PUNCH' && (
        <button onClick={() => onRaise(date)} style={{ ...T.btnP, marginTop:12, background:C.warning }}>Raise regularisation</button>
      )}
    </div>
  )
}

// 4) Regularisation form ─────────────────────────────────────────
/**
 * Regularise a range of days in one submission.
 *
 * The single-day form is right when one punch was missed. It is the wrong shape
 * for "I was on site all last week and the biometric never picked me up" —
 * that was seven identical forms.
 *
 * The preview is the important half. A date range will always contain days that
 * must not be regularised: weekly offs, holidays, approved leave, and days
 * already recorded properly. Submitting those would put work on HR that should
 * never have reached them, and could overwrite a correct record with a guess.
 * So the range is filtered against the same rules resolveDay() uses, and every
 * skipped day says why before anything is sent.
 */
function BulkRegularisationForm({ emp, onDone, onCancel }: {
  emp: EmployeeDetail; onDone: () => void; onCancel: () => void
}) {
  const localYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const todayStr = localYMD(new Date())
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate()-1); return localYMD(d) })()
  const weekAgo   = (() => { const d = new Date(); d.setDate(d.getDate()-7); return localYMD(d) })()

  const [from, setFrom] = useState(weekAgo)
  const [to, setTo] = useState(yesterday)
  const [actualIn, setActualIn] = useState('09:00')
  const [actualOut, setActualOut] = useState('18:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [preview, setPreview] = useState<{
    eligible: { date: string; recordedIn: string | null; recordedOut: string | null; why: string }[]
    skipped: { date: string; why: string }[]
  } | null>(null)

  const MAX_DAYS = 62   // two months: enough for a real backlog, not a whole year

  // Walk the range, pulling each month's attendance once, and decide day by day.
  const scan = useCallback(async () => {
    setPreview(null); setMsg(null)
    if (!from || !to) return
    if (from > to) { setMsg({ text: 'The start date is after the end date.', ok: false }); return }
    if (to >= todayStr) { setMsg({ text: 'Regularisation is for past days only — the end date must be before today.', ok: false }); return }

    const days: string[] = []
    for (const d = new Date(from + 'T00:00:00'); localYMD(d) <= to; d.setDate(d.getDate() + 1)) {
      days.push(localYMD(d))
      if (days.length > MAX_DAYS) break
    }
    if (days.length > MAX_DAYS) {
      setMsg({ text: `That range is longer than ${MAX_DAYS} days. Split it into smaller periods.`, ok: false }); return
    }

    setScanning(true)
    const months = Array.from(new Set(days.map(d => d.slice(0, 7))))
    const data = new Map<string, MonthlyData>()
    for (const ym of months) {
      const [y, mo] = ym.split('-').map(Number)
      data.set(ym, await loadMonthlyAttendance(emp.id, y, mo))
    }

    const eligible: { date: string; recordedIn: string | null; recordedOut: string | null; why: string }[] = []
    const skipped: { date: string; why: string }[] = []

    for (const date of days) {
      const md = data.get(date.slice(0, 7))
      if (!md) { skipped.push({ date, why: 'could not load that month' }); continue }
      const info = resolveDay(date, md, todayStr)

      if (info.status === 'HOLIDAY')      { skipped.push({ date, why: info.holiday?.description ? `holiday — ${info.holiday.description}` : 'holiday' }); continue }
      if (info.status === 'WEEKLY_OFF')   { skipped.push({ date, why: 'weekly off' }); continue }
      if (info.status === 'ON_LEAVE')     { skipped.push({ date, why: 'on approved leave' }); continue }
      if (info.status === 'PRESENT' && info.rec?.work_in && info.rec?.work_out) {
        skipped.push({ date, why: 'already recorded in full' }); continue
      }
      eligible.push({
        date,
        recordedIn: info.rec?.work_in || null,
        recordedOut: info.rec?.work_out || null,
        why: info.status === 'MISS_PUNCH' ? 'missing a punch'
           : info.status === 'ABSENT' ? 'marked absent'
           : info.status.toLowerCase().replace(/_/g, ' '),
      })
    }

    setScanning(false)
    setPreview({ eligible, skipped })
  }, [from, to, emp.id, todayStr])

  useEffect(() => { scan() }, [scan])

  const submit = async () => {
    if (!preview || preview.eligible.length === 0) { setMsg({ text: 'Nothing in that range needs regularising.', ok: false }); return }
    if (!actualIn || !actualOut) { setMsg({ text: 'Enter both actual IN and OUT times', ok: false }); return }
    if (actualIn >= actualOut) { setMsg({ text: 'Actual IN must be before Actual OUT', ok: false }); return }
    if (!reason.trim()) { setMsg({ text: 'Reason is required', ok: false }); return }

    setBusy(true); setMsg(null)
    const { inserted, error } = await submitRegularisationBulk(emp.id, preview.eligible, actualIn, actualOut, reason.trim())
    setBusy(false)
    if (error) { setMsg({ text: error, ok: false }); return }
    setMsg({ text: `✓ ${inserted} day${inserted === 1 ? '' : 's'} sent to HR for approval`, ok: true })
    onDone()
  }

  const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  return (
    <div style={T.card}>
      <div style={T.section}>Regularise a date range</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: -4, marginBottom: 12, lineHeight: 1.6 }}>
        For a stretch of days with the same story — biometric down, on site, working from home.
        Weekly offs, holidays, leave and days already recorded are left out automatically.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div><label style={T.label}>From *</label>
          <input type="date" max={yesterday} style={T.input} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label style={T.label}>To *</label>
          <input type="date" max={yesterday} style={T.input} value={to} onChange={e => setTo(e.target.value)} /></div>
        <div><label style={T.label}>Actual IN *</label>
          <input type="time" style={T.input} value={actualIn} onChange={e => setActualIn(e.target.value)} /></div>
        <div><label style={T.label}>Actual OUT *</label>
          <input type="time" style={T.input} value={actualOut} onChange={e => setActualOut(e.target.value)} /></div>
        <div style={{ gridColumn: '1/-1' }}><label style={T.label}>Reason * <span style={{ fontWeight: 400, color: C.faint }}>(applies to every day)</span></label>
          <input style={T.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Biometric device was down all week" /></div>
      </div>

      {scanning && <div style={{ fontSize: 12, color: C.faint, marginBottom: 10 }}>Checking those dates…</div>}

      {preview && !scanning && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99,
                           background: preview.eligible.length ? C.positiveTint : C.criticalTint,
                           color: preview.eligible.length ? C.positive : C.critical }}>
              {preview.eligible.length} day{preview.eligible.length === 1 ? '' : 's'} will be sent
            </span>
            {preview.skipped.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
                             background: C.brandTint, color: C.brandDeep }}>
                {preview.skipped.length} skipped
              </span>
            )}
          </div>

          {preview.eligible.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
              {preview.eligible.map(d => (
                <span key={d.date} title={d.why}
                      style={{ fontSize: 11, padding: '4px 9px', borderRadius: 7,
                               background: C.positiveTint, color: C.positive,
                               border: `1px solid ${C.positiveTint}`, fontWeight: 600 }}>
                  {short(d.date)} <span style={{ fontWeight: 400, opacity: .8 }}>· {d.why}</span>
                </span>
              ))}
            </div>
          )}

          {preview.skipped.length > 0 && (
            <details>
              <summary style={{ fontSize: 11.5, color: C.muted, cursor: 'pointer', marginBottom: 6 }}>
                Why {preview.skipped.length} day{preview.skipped.length === 1 ? ' was' : 's were'} left out
              </summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {preview.skipped.map(d => (
                  <span key={d.date} style={{ fontSize: 11, padding: '4px 9px', borderRadius: 7,
                                              background: C.sunken, color: C.faint,
                                              border: `1px solid ${C.line}` }}>
                    {short(d.date)} · {d.why}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {msg && <div style={{ fontSize: 12, marginBottom: 10, color: msg.ok ? C.positive : C.critical }}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={{ ...T.btnO, flex: 1 }}>Cancel</button>
        <button onClick={submit} disabled={busy || scanning || !preview?.eligible.length}
                style={{ ...T.btnP, flex: 2, opacity: busy || scanning || !preview?.eligible.length ? .5 : 1 }}>
          {busy ? 'Sending…'
            : preview?.eligible.length
              ? `Send ${preview.eligible.length} day${preview.eligible.length === 1 ? '' : 's'} to HR`
              : 'Nothing to send'}
        </button>
      </div>
    </div>
  )
}

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
    setMsg({ text:'Regularisation request submitted', ok:true })
    onDone()
  }
  const dateLbl = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
  return (
    <div style={T.card}>
      <div style={T.section}>Raise Regularisation</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        <div style={{ gridColumn:'1/-1' }}><label style={T.label}>Attendance date * <span style={{ fontWeight:400, color:C.faint }}>(past dates only)</span></label>{editable
          ? <input type="date" max={yesterdayStr} style={T.input} value={dateVal} onChange={e => setDateVal(e.target.value)} />
          : <input style={{ ...T.input, background:C.sunken }} value={dateLbl} readOnly />}</div>
        <div><label style={T.label}>Recorded IN</label><input style={{ ...T.input, background:C.sunken }} value={rec?.work_in ? fmtT(rec.work_in) : 'Not recorded'} readOnly /></div>
        <div><label style={T.label}>Recorded OUT</label><input style={{ ...T.input, background:C.sunken }} value={rec?.work_out ? fmtT(rec.work_out) : 'Not recorded'} readOnly /></div>
        <div><label style={T.label}>Actual IN *</label><input type="time" style={T.input} value={actualIn} onChange={e => setActualIn(e.target.value)} /></div>
        <div><label style={T.label}>Actual OUT *</label><input type="time" style={T.input} value={actualOut} onChange={e => setActualOut(e.target.value)} /></div>
        <div style={{ gridColumn:'1/-1' }}><label style={T.label}>Reason *</label><input style={T.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why was the punch missed?" /></div>
      </div>
      {msg && <div style={{ fontSize:12, marginBottom:10, color: msg.ok ? C.positive : C.critical }}>{msg.text}</div>}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={onCancel} style={{ ...T.btnO, flex:1 }}>Cancel</button>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, flex:1, opacity: busy?.6:1 }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </div>
  )
}

// 5) Regularisation list ─────────────────────────────────────────
function RegularisationList({ requests }: { requests: RegularisationRequest[] }) {
  const STY: Record<string,[string,string]> = { PENDING:[C.warningTint,C.warning], APPROVED:[C.positiveTint,C.positive], REJECTED:[C.criticalTint,C.critical] }
  return (
    <div style={T.card}>
      <div style={T.section}>My Regularisation Requests</div>
      {requests.length === 0 && <div style={{ fontSize:12, color:C.faint }}>No regularisation requests yet.</div>}
      {requests.map(r => { const [bg,c] = STY[r.status] || [C.brandTint,C.brandDeep]; return (
        <div key={r.id} style={{ padding:'9px 0', borderBottom: `1px solid ${C.brandEdge}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>{fmt(r.attendance_date)}</div>
            <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{r.status}</span>
          </div>
          <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>Recorded: IN {r.recorded_in ? fmtT(r.recorded_in) : '—'} · OUT {r.recorded_out ? fmtT(r.recorded_out) : '—'}</div>
          <div style={{ fontSize:11, color:C.inkSoft, marginTop:1 }}>Requested: {r.requested_in} → {r.requested_out}</div>
          {r.reason && <div style={{ fontSize:12, color:C.inkSoft, marginTop:3 }}>{r.reason}</div>}
          <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>Submitted {fmtDT(r.created_at)}</div>
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
  const [bulkRaise, setBulkRaise] = useState(false)
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

  // One walk, shared by the ring and the tiles, so both agree with the grid.
  const stats = monthStats(year, month, monthData, todayStr)
  const dayInfo = selectedDate && monthData ? resolveDay(selectedDate, monthData, todayStr) : null
  const raiseRec = raiseDate && monthData ? (monthData.recMap.get(raiseDate) || null) : null

  return (
    <div>
      <ShimmerKeyframes />
      {/* (A) the month, as one glance */}
      <MonthHero
        month={month} year={year}
        summary={stats}
        onPrev={prevMonth} onNext={nextMonth}
        onToday={() => { const n = new Date(); setMonth(n.getMonth()+1); setYear(n.getFullYear()); setSelectedDate(null); setRaiseDate(null) }}
        isThisMonth={month === new Date().getMonth()+1 && year === new Date().getFullYear()}
        isMobile={isMobile} />

      {/* (B) the month in numbers */}
      <AttendanceSummaryChips summary={stats} isMobile={isMobile} />

      {/* (C+D) calendar and the selected day, side by side.
           The month is a fixed shape, so it keeps its width and the detail
           takes the rest — clicking a day fills the right column instead of
           pushing the grid down the page. */}
      <div style={{ display:'flex', gap:11, alignItems:'stretch',
                    flexWrap: isMobile ? 'wrap' : 'nowrap', marginBottom:10 }}>
        <TiltCard disabled={isMobile}
                  style={{ ...T.card, marginBottom:0,
                           width: isMobile ? '100%' : 'auto' }}>
          {loading || !monthData
            ? <div style={{ display:'grid', gridTemplateColumns:'repeat(7,60px)', gap:4 }}>
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} style={{ height: isMobile ? 40 : 56, borderRadius:8,
                                        background: `linear-gradient(90deg,${C.brandTint} 25%,${C.brandTint} 50%,${C.brandTint} 75%)`,
                                        backgroundSize:'200% 100%', animation:'ezerShimmer 1.2s infinite' }} />
                ))}
              </div>
            : <AttendanceCalendar year={year} month={month} monthData={monthData} todayStr={todayStr} isMobile={isMobile} onDayClick={d => { setSelectedDate(d); setRaiseDate(null) }} selectedDate={selectedDate} />}
        </TiltCard>

        <div key={selectedDate || 'resting'} className="ezer-day-panel"
             style={{ flex:'1 1 300px', minWidth: isMobile ? '100%' : 280 }}>
          {selectedDate && dayInfo
            ? <DayDetailPanel emp={emp} date={selectedDate} dayInfo={dayInfo} isMobile={isMobile} onRaise={d => setRaiseDate(d)} />
            : <DayPanelResting summary={stats} />}
        </div>
      </div>

      {/* (E) regularisation form */}
      {raiseDate && <RegularisationForm emp={emp} date={raiseDate} rec={raiseRec} onDone={() => { loadRegs(); loadMonth(); setRaiseDate(null) }} onCancel={() => setRaiseDate(null)} />}

      {/* (F) raise regularisation + list */}
      <div style={{ ...T.card, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom: ((manualRaise || bulkRaise) && !raiseDate) ? 0 : undefined }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>Attendance Regularisation</div>
          <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>Forgot to punch or wrong time? Raise a correction → HR approval. Use a range when several days share the same reason.</div>
        </div>
        {!manualRaise && !bulkRaise && !raiseDate && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => setManualRaise(true)} style={T.btnO}>+ Single day</button>
            <button onClick={() => setBulkRaise(true)} style={T.btnP}>Date range</button>
          </div>
        )}
      </div>
      {manualRaise && !raiseDate && <RegularisationForm emp={emp} date={todayStr} rec={null} editable onDone={() => { loadRegs(); loadMonth(); setManualRaise(false) }} onCancel={() => setManualRaise(false)} />}
      {bulkRaise && !raiseDate && <BulkRegularisationForm emp={emp} onDone={() => { loadRegs(); loadMonth(); setBulkRaise(false) }} onCancel={() => setBulkRaise(false)} />}
      <RegularisationList requests={regs} />
    </div>
  )
}

// ── Voluntary PF (VPF) — EPF wage base × percent ──
function VpfSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:C.ink, purple:C.brand, purpleDark:C.brandDeep, border:C.line, muted:C.muted, red: C.critical, redBg: C.criticalTint, amber: C.warning, amberBg: C.warningTint, teal: C.positive }
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
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0' }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: V.navy }}>Voluntary PF (VPF)</div>
        <div style={{ fontSize: 12.5, color: V.muted, marginTop: 2 }}>Extra PF deducted from your EPF wages — set your own percentage.</div>
      </div>

      {!e.has_ctc && (
        <div style={{ ...card, background: V.amberBg, border: `1px solid ${C.warningTint}` }}>
          <span style={{ fontSize: 12, color: C.warning }}>Your CTC is not configured yet, so the EPF wage base shows ₹0. Ask HR to set your CTC (ctc_master) — then VPF will calculate correctly.</span>
        </div>
      )}

      {current && (
        <div style={{ ...card, background: C.sunken, border: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: V.teal }}>Active VPF: {current.vpf_percent}% ({inr(current.monthly_vpf_amount)}/mo) — modify below</span>
          <button onClick={stop} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: `1px solid ${V.red}`, background: C.surface, color: V.red, cursor: 'pointer', fontFamily: 'inherit' }}>Stop VPF</button>
        </div>
      )}

      <div style={{ ...card, background: C.brandTint }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: V.muted }}>Your EPF wages (from database)</span>
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: e.is_capped ? C.brandTint: C.sunken, color: e.is_capped ? V.purpleDark : V.teal }}>{e.is_capped ? 'Capped ₹15,000' : 'Actual (Gross − HRA)'}</span>
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
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Percentage of your EPF wages.</div>
      </div>

      {showHighAlert && (
        <div style={{ display: 'flex', gap: 8, background: V.redBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <span style={{ color: V.red }}></span>
          <span style={{ fontSize: 12, color: C.critical, lineHeight: 1.6 }}><strong>That high?</strong> {Math.round(rawPct)}% ({inr(vpfMonthly)}/mo) VPF will cut your net in-hand a lot. Please confirm.</span>
        </div>
      )}
      {capHit && (
        <div style={{ display: 'flex', gap: 8, background: V.amberBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <span style={{ color: V.amber }}></span>
          <span style={{ fontSize: 12, color: C.warning, lineHeight: 1.6 }}>Max {MAX_PCT}% allowed (12% mandatory + {MAX_PCT}% = 100%). Set to {MAX_PCT}%.</span>
        </div>
      )}

      <div style={{ ...card, background: C.brandTint }}>
        <div style={row}><span style={{ fontSize: 13, color: V.muted }}>VPF deduction (monthly)</span><span style={{ fontSize: 15, fontWeight: 500, color: V.purpleDark }}>{inr(vpfMonthly)}</span></div>
        <div style={{ ...row, borderTop: `1px solid ${V.border}` }}><span style={{ fontSize: 13, color: V.muted }}>VPF (annual)</span><span style={{ fontSize: 13, color: V.navy }}>{inr(vpfAnnual)}</span></div>
        <div style={{ ...row, borderTop: `1px solid ${V.border}` }}><span style={{ fontSize: 13, color: V.red }}>Net in-hand impact</span><span style={{ fontSize: 13, fontWeight: 500, color: V.red }}>−{inr(vpfMonthly)}/mo</span></div>
      </div>

      <div style={{ ...card, background: C.brandTint }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: V.muted }}>80C usage (₹1.5L max)</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: V.navy }}>{inr(Math.min(total80c, e.c80_limit))} / ₹1.5L</span>
        </div>
        <div style={{ height: 8, background: C.line, borderRadius: 20, overflow: 'hidden' }}><div style={{ height: '100%', width: `${barPct}%`, background: over80c ? '#EF9F27' : V.purple, borderRadius: 20 }} /></div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>EPF ({inr(e.epf_annual)}) + VPF ({inr(vpfAnnual)}) = {inr(total80c)}{over80c ? ` — no 80C benefit on ${inr(total80c - e.c80_limit)}` : ''}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, background: V.redBg, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <span style={{ color: V.red }}></span>
        <div style={{ fontSize: 12, color: C.critical, lineHeight: 1.7 }}><strong>Choose carefully:</strong><br />• VPF will <strong>reduce your net in-hand salary</strong><br />• The 80C exemption only goes <strong>up to ₹1.5 lakh</strong> (EPF + VPF + your other 80C)<br />• It is deducted every month until you stop it</div>
      </div>

      <label style={{ display: 'flex', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={e2 => setAck(e2.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: V.purple }} />
        <span style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>I understand this will reduce my net in-hand salary and that the 80C exemption is capped at ₹1.5L. I request this VPF deduction.</span>
      </label>

      <button disabled={!ack || saving} onClick={submit} style={{ width: '100%', padding: 12, borderRadius: 8, fontWeight: 500, fontFamily: 'inherit', border: ack ? `1px solid ${V.purple}` : `1px solid ${V.border}`, background: ack ? V.purple : C.canvas, color: ack ? C.surface : C.muted, cursor: ack ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : 'Acknowledge & submit'}</button>
    </div>
  )
}

// ── Corporate NPS enrolment (80CCD(2)) — % of Basic by regime ──
function NpsSection({ emp, notify }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:C.ink, purple:C.brand, purpleDark:C.brandDeep, border:C.line, muted:C.muted, red: C.critical, amber: C.warning, amberBg: C.warningTint, blue: C.brand, blueBg: C.brandTint, teal: C.positive, bg:C.canvas }
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
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }
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
        <div style={{ ...card, background: V.amberBg, border: `1px solid ${C.warningTint}` }}>
          <span style={{ fontSize: 12, color: C.warning }}>Your CTC (Basic) isn't configured yet, so NPS shows ₹0. Ask HR to set your CTC (ctc_master).</span>
        </div>
      )}

      {current && (
        <div style={{ ...card, background: current.status === 'PENDING_PRAN' ? V.blueBg: C.sunken, border: `1px solid ${current.status === 'PENDING_PRAN' ? '#B5D4F4' : '#C5E8DB'}` }}>
          {current.status === 'PENDING_PRAN' ? (
            <div>
              <div style={{ fontSize: 12, color: V.blue, marginBottom: 8 }}>PRAN pending — generate & submit by {current.pran_deadline ? new Date(current.pran_deadline).toLocaleDateString('en-IN') : '—'}.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={submitPran} onChange={e2 => setSubmitPran(e2.target.value.replace(/\D/g, ''))} maxLength={e.pran_length} placeholder={`Enter ${e.pran_length}-digit PRAN`} style={{ ...input, letterSpacing: 2 }} />
                <button onClick={doSubmitPran} disabled={submitPran.replace(/\D/g, '').length !== e.pran_length} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: V.purple, color: C.onAccent, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Submit PRAN</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: V.teal }}>Active NPS: {current.contribution_percent}% of Basic ({inr(current.monthly_nps_amount)}/mo)</span>
              <button onClick={stop} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: `1px solid ${V.red}`, background: C.surface, color: V.red, cursor: 'pointer', fontFamily: 'inherit' }}>Stop NPS</button>
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, background: C.brandTint }}>
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
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Old regime = 10% of Basic · New regime = 14% of Basic</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: V.muted, marginBottom: 8 }}>Do you already have an NPS account (PRAN)?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setHasPran(true)} style={{ flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', border: hasPran ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: hasPran ? V.bg: C.surface, color: hasPran ? V.purpleDark : V.navy }}>Yes, I have a PRAN</button>
          <button onClick={() => setHasPran(false)} style={{ flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', border: !hasPran ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: !hasPran ? V.bg: C.surface, color: !hasPran ? V.purpleDark : V.navy }}>No, I need one</button>
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
            <span style={{ color: V.blue }}></span>
            <div style={{ fontSize: 12, color: C.brand, lineHeight: 1.7 }}><strong>A new PRAN will be created for you.</strong><br />On submit, we'll email you the PRAN creation form. Generate your PRAN <strong>within 3 days</strong>, then resubmit here. For help, contact the <strong>Payroll team</strong>.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, background: V.amberBg, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <span style={{ color: V.amber }}></span>
        <div style={{ fontSize: 12, color: C.warning, lineHeight: 1.7 }}><strong>Please read carefully:</strong><br />• NPS is a long-term retirement product — locked in until age 60 (limited early withdrawal)<br />• Employer contribution is over & above your ₹1.5L 80C limit (Section 80CCD(2))<br />• Recurring monthly contribution, reflects in your salary structure<br />• Rate follows your tax regime (10% old / 14% new of Basic)</div>
      </div>

      <label style={{ display: 'flex', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={e2 => setAck(e2.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: V.purple }} />
        <span style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>I confirm I want to enrol in the corporate NPS. I understand the contribution will be a percentage of my Basic as per my tax regime, effective from the 1st of next month, and that NPS is a long-term retirement product with lock-in until age 60.</span>
      </label>

      <button disabled={!canSubmit || saving} onClick={submit} style={{ width: '100%', padding: 12, borderRadius: 8, fontWeight: 500, fontFamily: 'inherit', border: canSubmit ? `1px solid ${V.purple}` : `1px solid ${V.border}`, background: canSubmit ? V.purple : C.canvas, color: canSubmit ? C.surface : C.muted, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{saving ? 'Submitting…' : hasPran ? 'Acknowledge & submit' : 'Submit & email me the PRAN form'}</button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// LOANS (ESS) — apply, track requests, sign agreement, manage loans
// ════════════════════════════════════════════════════════════════
const LOAN_V = { navy:C.ink, purple:C.brand, purpleDark:C.brandDeep, border:C.line, muted:C.muted, red: C.critical, redBg: C.criticalTint, amber: C.warning, amberBg: C.warningTint, teal: C.positive, tealBg: C.sunken, bg:C.canvas }
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
    SUBMITTED:[C.warningTint,C.warning], IN_APPROVAL:[C.warningTint,C.warning], REQUESTED:[C.warningTint,C.warning], GENERATED:[C.warningTint,C.warning], UNDER_REVIEW:[C.brandTint,C.brand], PENDING_PRAN:[C.brandTint,C.brand],
    APPROVED:[C.sunken,C.positive], RECOVERING:[C.sunken,C.positive], DISBURSED:[C.sunken,C.positive], SIGNED:[C.sunken,C.positive],
    REJECTED:[C.criticalTint,C.critical], CANCELLED:[C.criticalTint,C.critical], EXIT_RECOVERY:[C.criticalTint,C.critical],
    CLOSED:[C.sunken,C.muted], FORECLOSED:[C.sunken,C.muted],
  }
  const [bg, c] = map[s] || [C.brandTint,C.brandDeep]
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
  const card: React.CSSProperties = { background:C.surface, border:`1px solid ${V.border}`, borderRadius:12, padding:16, marginBottom:14 }
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
      <button onClick={onClose} style={{ padding:'7px 13px', borderRadius:7, border:`1px solid ${V.border}`, background:C.surface, color:V.purpleDark, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>Close</button>
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
          <a href={`/api/ess/loans/agreement?request_id=${requestId}&format=html`} target="_blank" rel="noreferrer" style={{ padding:'5px 11px', borderRadius:7, border:`1px solid ${V.border}`, background:C.surface, color:V.purpleDark, textDecoration:'none', fontSize:11 }}>View / print</a>
          <button onClick={onClose} style={{ padding:'5px 11px', borderRadius:7, border:`1px solid ${V.border}`, background:C.surface, color:V.purpleDark, cursor:'pointer', fontFamily:'inherit', fontSize:11 }}>Close</button>
        </div>
      </div>
      <div style={{ overflowX:'auto', border:`1px solid ${V.border}`, borderRadius:8, marginBottom:14 }}>
        <table style={{ borderCollapse:'collapse', width:'100%', minWidth:520 }}>
          <thead><tr style={{ background: C.brandTint }}>
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
        <button onClick={() => setMode('ESIGN')} style={{ flex:1, padding:9, borderRadius:8, cursor:'pointer', fontWeight:500, fontFamily:'inherit', fontSize:12, border: mode==='ESIGN' ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: mode==='ESIGN' ? V.bg: C.surface, color: mode==='ESIGN' ? V.purpleDark : V.navy }}>E-sign</button>
        <button onClick={() => setMode('UPLOAD')} style={{ flex:1, padding:9, borderRadius:8, cursor:'pointer', fontWeight:500, fontFamily:'inherit', fontSize:12, border: mode==='UPLOAD' ? `2px solid ${V.purple}` : `1px solid ${V.border}`, background: mode==='UPLOAD' ? V.bg: C.surface, color: mode==='UPLOAD' ? V.purpleDark : V.navy }}>Upload signed PDF</button>
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
      <button disabled={saving} onClick={submit} style={{ width:'100%', padding:12, borderRadius:8, fontWeight:500, fontFamily:'inherit', border:`1px solid ${V.purple}`, background:V.purple, color:C.onAccent, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Submitting…' : 'Submit signed agreement'}</button>
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

  const card: React.CSSProperties = { background:C.surface, border:`1px solid ${V.border}`, borderRadius:12, padding:16, marginBottom:14 }
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
        <div style={{ ...card, background:V.amberBg, border: `1px solid ${C.warningTint}` }}>
          <span style={{ fontSize:12, color: C.warning }}>CTC not configured — eligibility shows ₹0; ask HR to set CTC.</span>
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
            <div style={{ ...card, background: C.brandTint, marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:12, color:V.muted }}>Indicative EMI (reducing balance)</span>
                <span style={{ fontSize:18, fontWeight:600, color:V.purpleDark }}>{loanInr(indicativeEmi)}<span style={{ fontSize:11, color:V.muted, fontWeight:400 }}>/mo</span></span>
              </div>
            </div>
            <button disabled={saving} onClick={submit} style={{ width:'100%', padding:12, borderRadius:8, fontWeight:500, fontFamily:'inherit', border:`1px solid ${V.purple}`, background:V.purple, color:C.onAccent, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Submitting…' : 'Submit loan request'}</button>
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
                {(p.status || '').toUpperCase() === 'APPROVED' && <button onClick={() => setSigningReq(p.id)} style={{ padding:'6px 12px', borderRadius:7, border:'none', background:V.purple, color:C.onAccent, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Sign agreement</button>}
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
                  <button onClick={() => manage(l, 'CLOSURE')} style={{ padding:'6px 12px', borderRadius:7, border:`1px solid ${V.red}`, background:C.surface, color:V.red, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Foreclose</button>
                  <button onClick={() => manage(l, 'PART_PAYMENT')} style={{ padding:'6px 12px', borderRadius:7, border:`1px solid ${V.purple}`, background:C.surface, color:V.purpleDark, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Part-payment</button>
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
      <div style={{ fontSize:38, marginBottom:8 }}></div>
      <div style={{ fontSize:16, fontWeight:600 }}>{title}</div>
      <div style={{ fontSize:13, color:C.muted, marginTop:6, lineHeight:1.7 }}>Coming in Phase {phase}. This module needs the <b>{needs}</b> module's data, which isn't built yet.</div>
    </div>
  )
}

// ── Flexi Benefit Plan (FBP) — the employee's company policy for their salary slab ──
function FlexiSection({ emp }: { emp: EmployeeDetail; notify: (m: string, t?: 'success'|'error') => void }) {
  const V = { navy:C.ink, purple:C.brand, purpleDark:C.brandDeep, border:C.line, muted:C.muted, purpleBg:C.canvas }
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

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }

  if (status === 'loading') return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading flexi policy…</div>
  if (status === 'nopolicy') return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Flexi Benefit Plan</div>
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
      <div style={{ ...card, background: V.purpleBg, borderColor: C.brandEdge }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Flexi Benefit Plan (FBP)</div>
          <span style={{ fontSize: 11, background: C.brandTint, color: V.purpleDark, padding: '2px 9px', borderRadius: 99, fontWeight: 600 }}>{companyName}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
          <div><span style={{ color: V.muted }}>Your annual fixed</span><div style={{ fontWeight: 700, fontSize: 15 }}>{inr(annualFixed)}</div></div>
          <div><span style={{ color: V.muted }}>Applicable slab</span><div style={{ fontWeight: 700, fontSize: 15 }}>{slab?.slab_label || `${inr(num(slab?.fixed_from))} – ${inr(num(slab?.fixed_to))}`}</div></div>
          <div><span style={{ color: V.muted }}>Max declarable ({regime})</span><div style={{ fontWeight: 700, fontSize: 15, color: V.purple }}>{inr(totalDeclarable)}/yr</div></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['old', 'new'] as const).map(rg => (
          <button key={rg} onClick={() => setRegime(rg)} style={{ padding: '7px 16px', borderRadius: 99, border: `1px solid ${regime === rg ? V.purple : V.border}`, background: regime === rg ? V.purple: C.surface, color: regime === rg ? C.surface : V.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{rg === 'old' ? 'Old Regime' : 'New Regime'}</button>
        ))}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', padding: '10px 14px', background: V.navy, color: C.onAccent, fontSize: 11, fontWeight: 700 }}>
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
      <div style={T.section}>My Letters</div>
      {loading ? <div style={{ fontSize:12, color:C.faint }}>Loading…</div> :
        rows.length === 0 ? <div style={{ fontSize:12, color:C.faint }}>No letters have been shared with you yet. HR-issued letters (offer, confirmation, etc.) will appear here.</div> :
        rows.map(r => (
          <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom: `1px solid ${C.brandEdge}` }}>
            <span style={{ fontSize:20 }}></span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{r.letter_name}</div>
              <div style={{ fontSize:11, color:C.faint }}>{new Date(r.letter_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</div>
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

/**
 * Section key → interface icon.
 *
 * The ESS rail used the same emoji the dashboard rail did, for the same
 * reasons it should not: they render differently per OS, sit off the text
 * baseline, and cannot take the colour of the state they are in. The emoji
 * remain in SECTIONS.features, where they illustrate a not-yet-built feature
 * rather than label a control.
 */
const ESS_ICON: Record<string, (p: { size?: number; strokeWidth?: number }) => React.ReactElement> = {
  home: IconHome, profile: IconEmployees, team: IconEmployees, payroll: IconPayroll,
  attendance: IconCalendar, leave: IconLeave, hris: IconLetters, performance: IconReports,
  wall: IconRecruitment, rnr: IconAi, funzone: IconAi,
}
function EssIcon({ k, size = 16, strokeWidth = 1.6 }: { k: string; size?: number; strokeWidth?: number }) {
  const I = ESS_ICON[k]
  return I ? <I size={size} strokeWidth={strokeWidth} /> : null
}

const SECTIONS: NavSection[] = [
  { k:'home', label:'Home', short:'Home', icon:'', status:'ready',
    desc:'The landing dashboard — everything at a glance',
    items:[{ k:'home', label:'Dashboard' }] },

  { k:'profile', label:'Profile', short:'Profile', icon:'', status:'ready',
    desc:'Your personal details, documents and letters',
    items:[
      { k:'profile',     label:'My Details' },
      { k:'documents',   label:'Letter Requests' },
      { k:'letters',     label:'My Letters' },
    ]},

  { k:'team', label:'Team', short:'Team', icon:'', status:'soon',
    desc:'For managers — see and manage your team',
    items:[{ k:'team', label:'Team' }],
    features:[
      { icon:'', name:'Team List',          note:'Non-salary details visible' },
      { icon:'', name:'Task Assign',        note:'Give tasks to team members' },
      { icon:'', name:'TODO / Deliverables',note:'Track what is owed' },
    ]},

  { k:'payroll', label:'Payroll', short:'Payroll', icon:'', status:'partial',
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
      { k:'claims',      label:'Travel Claims' },
      { k:'statutory',   label:'Statutory',              phase:3, needs:'Payroll' },
    ]},

  { k:'attendance', label:'Attendance', short:'Attend', icon:'', status:'ready',
    desc:'Your own attendance, self-service',
    items:[{ k:'attendance', label:'Attendance' }] },

  { k:'leave', label:'Leave', short:'Leave', icon:'', status:'ready',
    desc:'Apply, track and plan leave',
    items:[{ k:'leave', label:'Leave' }] },

  { k:'hris', label:'HRIS', short:'HRIS', icon:'', status:'partial',
    desc:'Directory, requests, approvals and the exit process',
    items:[
      { k:'directory',   label:'Team Directory' },
      { k:'requests',    label:'Raise a Request' },
      { k:'approvals',   label:'Tasks & Approvals',      phase:4, needs:'Approval workflow' },
      { k:'exit',        label:'Exit Process',           phase:4, needs:'Exit & FnF' },
    ]},

  { k:'performance', label:'Performance', short:'PMS', icon:'', status:'soon',
    desc:'Review and rating submission',
    items:[{ k:'performance', label:'Performance' }],
    features:[
      { icon:'', name:'Self Review',    note:'Employee assessment' },
      { icon:'', name:'Manager Review', note:'Rating submission' },
    ]},

  { k:'wall', label:'Wall of Fame', short:'Wall', icon:'', status:'soon',
    desc:'Peer-to-peer appreciation, casual and public',
    items:[{ k:'wall', label:'Wall of Fame' }],
    features:[
      { icon:'', name:'Give a Shoutout', note:'Quick appreciation post' },
      { icon:'', name:'Company Feed',    note:'See everyone’s shoutouts' },
    ]},

  { k:'rnr', label:'RNR', short:'RNR', icon:'', status:'soon',
    desc:'Structured Reward & Recognition, points-based',
    items:[{ k:'rnr', label:'RNR' }],
    features:[
      { icon:'', name:'Nominate',    note:'Pick a category, write why' },
      { icon:'', name:'Approval',    note:'Manager / HR reviews' },
      { icon:'', name:'Points',      note:'Credited on approval' },
      { icon:'', name:'Redeem',      note:'Vouchers, leave, merch' },
      { icon:'', name:'Leaderboard', note:'Top recognized employees' },
    ]},

  { k:'funzone', label:'Fun Zone', short:'Fun', icon:'', status:'ready',
    desc:'Take a break — play a quick game with your team',
    items:[{ k:'funzone', label:'Fun Zone' }] },
]

const VIEWS = SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s.k })))
const viewMeta = (k: string) => VIEWS.find(v => v.k === k) || VIEWS[0]
/** The four an employee opens daily — these get the mobile thumb bar, rest go under More. */
const MOBILE_PRIMARY = ['home','payroll','attendance','leave']

const DOT: Record<Ready, string> = { ready:C.positive, partial:C.warning, soon:C.critical }
const BADGE: Record<Ready, [string, string, string]> = {
  ready:   ['Available',        C.positiveTint, C.positive],
  partial: ['Partly available', C.warningTint, C.warning],
  soon:    ['Coming soon',      C.criticalTint, C.critical],
}

// ── Sidebar / sub-tab / feature-grid bits (outside the parent — no focus loss) ──
function SectionButton({ s, active, onClick }: { s: NavSection; active: boolean; onClick: () => void }) {
  // The mock's `.tab-link:hover` can't be an inline style, so the hover tint is state.
  const [hover, setHover] = useState(false)
  const bg = active ? 'rgba(37,99,235,0.25)' : hover ? 'rgba(255,255,255,0.05)' : 'transparent'
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ width:'100%', textAlign:'left', display:'flex', alignItems:'center', gap:10, padding:'10px 18px', color: active ? C.surface : C.brand, cursor:'pointer', fontSize:12.5, fontWeight:600, fontFamily:'inherit', background:bg, border:'none', borderLeft:`3px solid ${active ? C.brand : 'transparent'}` }}>
      <EssIcon k={s.k} size={16} />
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
        <div style={{ fontSize:F.page, fontWeight:W.bold, letterSpacing:'-.02em',
                      display:'flex', alignItems:'center', gap:9 }}>
          <EssIcon k={s.k} size={20} strokeWidth={1.8} />{s.label}
        </div>
        <span style={{ fontSize:10.5, fontWeight:700, padding:'4px 12px', borderRadius:999, background:bg, color:fg }}>{label}</span>
      </div>
      <div style={{ fontSize:12.5, color:C.muted }}>{s.desc}</div>
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
          <button key={i.k} onClick={() => go(i.k)} style={{ padding:'6px 14px', borderRadius:99, cursor:'pointer', fontFamily:'inherit', fontSize:12.5, fontWeight: on ? 600 : 500, border:`1px solid ${on ? C.brand : C.line}`, background: on ? C.brand: C.surface, color: on ? C.surface : C.inkSoft, whiteSpace:'nowrap' }}>
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
          <div key={f.name} style={{ background:C.surface, border: `1px solid ${C.brandEdge}`, borderRadius:12, padding:16 }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{f.icon}</div>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:3 }}>{f.name}</div>
            <div style={{ fontSize:11, color:C.muted }}>{f.note}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.brandTint, borderRadius:10, padding:'12px 16px', marginTop:20, fontSize:12, color:C.brandDeep }}>
        This tab isn’t live yet. Everything above is what it will hold — nothing here is clickable so far.
      </div>
    </div>
  )
}

function NotificationBell({ unread, open, onToggle }: { unread: number; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} title="Notifications" style={{ position:'relative', width:34, height:34, borderRadius:R.md, border:`1px solid ${open ? C.brand : C.line}`, background: open ? C.brandTint : C.surface, color: open ? C.brandDeep : C.muted, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit', flexShrink:0 }}>
      <IconBell size={16} />
      {unread > 0 && (
        <span style={{ position:'absolute', top:-5, right:-5, minWidth:17, height:17, padding:'0 4px', borderRadius:R.pill, background:C.critical, color:C.onAccent, fontSize:9.5, fontWeight:W.bold, display:'flex', alignItems:'center', justifyContent:'center', boxSizing:'border-box' }}>
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
      case 'claims':        return <TravelClaims employeeId={emp.id} />
      case 'attendance':    return <AttendanceModule emp={emp} />
      case 'documents':     return <Documents emp={emp} notify={notify} />
      case 'letters':       return <MyLetters emp={emp} />
      case 'requests':      return <Requests emp={emp} notify={notify} />
      case 'directory':     return <Directory isMobile={isMobile} />
      case 'funzone':       return <FunZone />
      default:              return <Placeholder title={m.label} phase={m.phase || 4} needs={m.needs || '—'} />
    }
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:C.brand, fontFamily:'"DM Sans",sans-serif' }}>Loading portal…</div>
  if (!emp) return <div style={{ padding:40, textAlign:'center', color:C.critical, fontFamily:'"DM Sans",sans-serif' }}>Employee not found.</div>

  return (
    <div style={{ minHeight:'100vh', background:C.canvas, fontFamily:'"DM Sans","Segoe UI",sans-serif', color:C.ink, display:'flex', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Desktop sidebar — navy, eleven tabs, per ESS_Portal_New_Structure.html */}
      {!isMobile && (
        <div style={{ width:220, background: C.dark, padding:'20px 0', position:'sticky', top:0, height:'100vh', overflowY:'auto', flexShrink:0 }}>
          <div style={{ padding:'0 18px 16px', color:C.onDark, fontWeight:700, fontSize:16, borderBottom:'1px solid rgba(255,255,255,0.1)', marginBottom:10 }}>EZER ESS</div>
          {SECTIONS.map(s => (
            <SectionButton key={s.k} s={s} active={s.k === section.k} onClick={() => goSection(s)} />
          ))}
        </div>
      )}

      <div style={{ flex:1, minWidth:0, paddingBottom: isMobile ? 70 : 0 }}>
        {/* Top bar */}
        <div style={{ background:C.surface, borderBottom: `1px solid ${C.brandEdge}`, padding: isMobile ? '10px 14px' : '10px 22px', display:'flex', alignItems:'center', gap:10, position:'sticky', top:0, zIndex:25 }}>
          {/* The tab's own name and badge live in TabHeader below, so this bar carries
              only what that header can't: the sub-tab you're on, and who you are. */}
          <div style={{ fontSize: isMobile ? 15 : 16, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {isMobile ? 'EZER ESS' : (section.items.length > 1 ? meta.label : '')}
          </div>
          {adminMode && <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:C.warningTint, color:C.warning, fontWeight:600, whiteSpace:'nowrap' }}>Admin viewing {emp.first_name || emp.full_name}</span>}
          {/* Employee identity — always visible at the top */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap: isMobile ? 7 : 9 }}>
            <NotificationBell unread={unread} open={bellOpen} onToggle={() => setBellOpen(o => !o)} />
            <div style={{ width: isMobile ? 30 : 34, height: isMobile ? 30 : 34, borderRadius:'50%', overflow:'hidden', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontSize: isMobile ? 12 : 13, fontWeight:700, flexShrink:0 }}>{emp.profile_photo ? <img src={emp.profile_photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(emp.full_name)}</div>
            {!isMobile && (
              <div style={{ lineHeight:1.2, textAlign:'right' }}>
                <div style={{ fontSize:13, fontWeight:700, whiteSpace:'nowrap', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis' }}>{emp.full_name}</div>
                <div style={{ fontSize:11, color:C.muted, fontFamily:'monospace' }}>{emp.emp_code}</div>
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
          <div onClick={e => e.stopPropagation()} style={{ position:'absolute', top: isMobile ? 56 : 60, right: isMobile ? 8 : 22, width: isMobile ? 'calc(100vw - 16px)' : 380, maxHeight:'70vh', overflowY:'auto', background:C.surface, border: `1px solid ${C.brandEdge}`, borderRadius:12, boxShadow:'0 12px 32px rgba(30,27,75,0.18)', padding:'12px 14px' }}>
            <Notifications emp={emp} onChange={refreshUnread} />
          </div>
        </div>
      )}

      {/* Mobile bottom bar — eleven tabs don't fit a thumb bar, so the four an employee
          opens daily sit here and the rest are one tap away under More. */}
      {isMobile && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:C.surface, borderTop: `1px solid ${C.brandEdge}`, display:'flex', zIndex:20 }}>
          {MOBILE_PRIMARY.map(k => { const s = SECTIONS.find(x => x.k === k)!; const on = section.k === k && !moreOpen; return (
            <button key={k} onClick={() => { setMoreOpen(false); goSection(s) }} style={{ flex:1, minWidth:0, padding:'8px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: on ? C.brand : C.faint, fontWeight: on ? 600 : 500 }}>
              <EssIcon k={s.k} size={16} />{s.short}
            </button>
          )})}
          <button onClick={() => setMoreOpen(o => !o)} style={{ flex:1, minWidth:0, padding:'8px 0', border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit', fontSize:10, color: moreOpen ? C.brand : C.faint, fontWeight: moreOpen ? 600 : 500 }}>
            <div style={{ fontSize:17, lineHeight:1.3 }}>⋯</div>More
          </button>
        </div>
      )}

      {/* Mobile "More" sheet — every tab, including the four in the bar, so nothing
          is reachable from only one place. */}
      {isMobile && moreOpen && (
        <div onClick={() => setMoreOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:30, display:'flex', alignItems:'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:C.surface, width:'100%', borderRadius:'14px 14px 0 0', padding:'16px 14px 24px', maxHeight:'72vh', overflowY:'auto' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>All tabs</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {SECTIONS.map(s => (
                <button key={s.k} onClick={() => goSection(s)} style={{ padding:'12px 10px', borderRadius:9, border:`1px solid ${section.k === s.k ? C.brand : C.brandTint}`, background: section.k === s.k ? C.canvas : C.sunken, cursor:'pointer', fontFamily:'inherit', fontSize:12, textAlign:'left', display:'flex', alignItems:'center', gap:8, color:C.ink }}>
                  <span style={{ display:'flex' }}><EssIcon k={s.k} size={16} /></span>
                  <span style={{ flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.label}</span>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:DOT[s.status], flexShrink:0 }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:'fixed', bottom: isMobile ? 80 : 24, right:24, zIndex:9999, background: toast.type==='success'?C.positive:C.critical, color:C.onAccent, borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{toast.type==='success'?'':''} {toast.msg}</div>}
    </div>
  )
}
