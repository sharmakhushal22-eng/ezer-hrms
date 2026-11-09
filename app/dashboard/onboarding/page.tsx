// app/dashboard/onboarding/page.tsx
// EZER HRMS — Onboarding Admin Dashboard
// 5 tabs: Overview | All Candidates | Pending Actions | AI Insights | Compliance
'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { maskMobile } from '@/lib/ids/mask'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { canSeeScreen } from '@/lib/rms/resolve'
import { companyFilter, scopedCompanies, defaultCompanyId } from '@/lib/rms/resolve'
// send-magic-link / resend-link are guarded server-side now, so the session goes along.
import { authHeaders } from '@/lib/auth-headers'
import GenerateCodeModal from '@/components/onboarding/GenerateCodeModal'
import { CODE_QUEUE_ENFORCED } from '@/lib/onboarding/code-series'
import AppointmentLetterModal from '@/components/onboarding/AppointmentLetterModal'
import { TRACKS, requiredDocCodes, trackOf } from '@/lib/onboarding/hiring-track'
import ReviewDrawer from '@/components/onboarding/ReviewDrawer'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import {
  C as TK, R, E, IconChevron, IconMail, IconPolicies, IconCompliance, IconAlert, IconUser, IconCheck,
  IconAi, IconLetters, IconClock, IconHome, IconEmployees, IconCalendar, IconPlus,
} from '@/lib/ui'
import { ApprovalsCell, type Readiness } from '@/components/onboarding/ApprovalTrail'
import { approvalTrail, dayLabel, daysFromToday, relDays, type ApprovalRow, type Holder, type TrailTeam, type Trail } from '@/lib/onboarding/approval-trail'
import './onboarding-hr.css'

// ── Types ─────────────────────────────────────────────────────────
type Stage = 'NOT_INVITED'|'INVITED'|'IN_PROGRESS'|'SUBMITTED'|'HR_REVIEW'|'APPROVED'|'EMPLOYEE_CREATED'
type RiskLevel = 'LOW'|'MEDIUM'|'HIGH'
type Tab = 'overview'|'candidates'|'pending'|'insights'|'compliance'
type Holders = Record<string, Partial<Record<TrailTeam, Holder[]>>>

interface Candidate {
  /** Every onboarding_approvals row on record (team, status, who, when, remark). */
  approvals?: ApprovalRow[]
  docs_required_have?: number; docs_required_total?: number; docs_rejected?: number
  /** IT and Admin confirm these on their approval checklist (lib/onboarding/checklists.ts). */
  it_laptop_issued?: boolean | null; admin_id_card?: boolean | null
  esic_applicable?: boolean | null
  /** The HR Manager's assignments (lib/onboarding/hr-assignment.ts): managers from the review sheet (Assign managers), then the team + roles recorded at Generate code. */
  role_assignment?: { managers?: { l1_name?: string | null; l2_name?: string | null; hod_name?: string | null }; roles?: { role_code: string; role_name: string }[]; team?: { summary?: string; count?: number }; by_name?: string | null; at?: string } | null
  l1_manager_id?: string | null; l2_manager_id?: string | null; hod_id?: string | null
  /** The hiring track (lib/onboarding/hiring-track.ts): DOMESTIC | FOREIGN_IN_INDIA | OVERSEAS, with the work country, payroll currency and employing entity. */
  hiring_track?: string | null; work_country?: string | null; payroll_currency?: string | null; employing_entity?: string | null
  /** Notice period the joiner will serve (from the offer / typed here) — becomes employees.notice_period_days. */
  notice_period_days?: number | null
  /** The HR Manager's last review (Review form on the card): ACCEPTED / RETURNED / RESUBMITTED with the rejected documents and flagged details. */
  hr_review?: { outcome: string; by_name?: string | null; at?: string; documents?: { doc_code: string; label: string; reason: string }[]; details?: { field: string; reason: string }[]; note?: string | null } | null
  id: string; full_name: string; designation: string; department: string
  email: string; mobile: string; date_of_joining: string
  status: Stage; current_step: number; form_data: any
  employee_code?: string; employment_type?: string; magic_link_token: string
  submitted_at?: string; created_at: string; company_id: string
  candidate_id?: string; recruitment_id?: string  // link back to recruitment.candidates
  // Computed
  docs_uploaded?: number; docs_ai_flagged?: number
  form11?: boolean; form2?: boolean; bank?: boolean
  bgv_status?: string; policy_ack?: boolean
  laptop_issued?: boolean; id_card_issued?: boolean
  ai_risk?: RiskLevel; ai_risk_reason?: string
}

// ── EZER theme constants ───────────────────────────────────────────
const P = TK.brand
// The label says whose move it is; the colour backs it up: neutral = the candidate's,
// warning = HR's, info = the teams', positive = ready / done.
const STAGE_META: Record<Stage, {label:string; bg:string; color:string}> = {
  NOT_INVITED:      { label:'Not invited',       bg: TK.sunken, color:TK.muted },
  INVITED:          { label:'Link sent',         bg: TK.sunken, color:TK.inkSoft },
  IN_PROGRESS:      { label:'Filling the form',  bg: TK.brandTint, color: TK.brand },
  SUBMITTED:        { label:'HR to review',      bg:TK.warningTint, color:TK.warning },
  HR_REVIEW:        { label:'With the teams',    bg:TK.infoTint, color:TK.info },
  APPROVED:         { label:'Ready for code',    bg:TK.positiveTint, color:TK.positive },
  EMPLOYEE_CREATED: { label:'Employee created',  bg: TK.sunken, color: TK.positive },
}
const RETURNED_META = { label:'Returned for fixes', bg:TK.criticalTint, color:TK.critical }

// ── Small helpers ─────────────────────────────────────────────────
// One date format on every onboarding screen: "12 Oct 2026" (lib/onboarding/approval-trail.ts).
const fmt = (s?: string | null) => dayLabel(s)
// Whole calendar days from today (negative = in the past), so a same-day joining is 0.
const daysLeft = (doj?: string | null) => daysFromToday(doj)
/** "Today" · "Tomorrow" · "In 5 days" · "13 days ago" */
const relLabel = (d: number) => relDays(d).replace(/^./, m => m.toUpperCase())
const isReturned = (c: Candidate) => c.status === 'IN_PROGRESS' && (c.hr_review?.outcome === 'RETURNED' || (c.approvals || []).some(a => a.status === 'RETURNED'))

/**
 * The candidates toolbar is sticky, and inside ESS it must sit BELOW the host's own sticky bar
 * (the top bar with the Manage menus), not slide underneath it. The host is not this page's to
 * change, so measure it: the nearest earlier sibling (of this page or an ancestor) that is
 * sticky / fixed at top 0 and is a bar, not a full-height rail. Its height goes in --ob-top on
 * the page root; on /dashboard there is none and it stays 0.
 */
function useHostStickyOffset(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current
    if (!root || typeof ResizeObserver === 'undefined') return
    let bar: HTMLElement | null = null
    for (let el: HTMLElement | null = root; el && el !== document.body && !bar; el = el.parentElement) {
      for (let s = el.previousElementSibling as HTMLElement | null; s; s = s.previousElementSibling as HTMLElement | null) {
        const cs = getComputedStyle(s)
        if ((cs.position === 'sticky' || cs.position === 'fixed') && (parseFloat(cs.top) || 0) === 0 && s.offsetHeight > 0 && s.offsetHeight < 160 && s.offsetWidth >= el.offsetWidth * 0.6) { bar = s; break }
      }
    }
    if (!bar) return
    const b = bar
    const set = () => root.style.setProperty('--ob-top', `${b.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set); ro.observe(b)
    return () => ro.disconnect()
  }, [ref])
}
const progressPct = (c: Candidate) => {
  const baseStep = Math.min(c.current_step || 1, 8)
  const stepPct  = Math.round(((baseStep - 1)/7)*70)
  const docBonus = c.docs_uploaded ? 15 : 0
  const statBonus = (c.form11 && c.bank) ? 15 : c.bank ? 8 : 0
  return Math.min(100, stepPct + docBonus + statBonus)
}

const Badge = ({ label, bg, color, title }: {label:string;bg:string;color:string;title?:string}) => (
  <span title={title} style={{fontSize:11.5,padding:'3px 10px',borderRadius:99,background:bg,color,fontWeight:650,display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',border:`1px solid color-mix(in srgb, ${color} 22%, transparent)`}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>{label}
  </span>
)

/** The icons this page asked for by Tabler name. The Tabler icon font was never loaded in
 *  this app, so every one of them rendered as nothing; they map onto the product's own set. */
const TI: Record<string, (p:{size?:number;strokeWidth?:number})=>React.ReactElement> = {
  send: IconMail, 'list-check': IconPolicies, 'shield-check': IconCompliance, 'alert-triangle': IconAlert,
  user: IconUser, 'circle-check': IconCheck, bolt: IconAi, copy: IconLetters, robot: IconAi, 'file-alert': IconLetters,
  star: IconAi, clock: IconClock, 'info-circle': IconAlert, home: IconHome, users: IconEmployees, brain: IconAi,
  checklist: IconPolicies,
}
const Ti = ({ n, s = 14, color }: { n: string; s?: number; color?: string }) => {
  const I = TI[n] || IconCheck
  return <span aria-hidden style={{display:'inline-flex',verticalAlign:'middle',color,lineHeight:0,marginRight:3}}><I size={Math.round(s)} strokeWidth={1.9}/></span>
}

/** A KPI tile: tinted icon, big number, label. White, with the colour only in the icon. */
function StatCard({ label, val, color, tint, icon, hint, onClick }: { label:string; val:number; color:string; tint:string; icon:string; hint?:string; onClick?:()=>void }) {
  return (
    <div className={onClick ? 'ezob-lift' : undefined} onClick={onClick}
      style={{background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:16,padding:'16px 18px',cursor:onClick?'pointer':'default',boxShadow:'0 1px 2px rgba(16,24,40,.04)',display:'flex',flexDirection:'column',gap:10,minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <span style={{fontSize:12.5,fontWeight:600,color:TK.muted}}>{label}</span>
        <span style={{width:32,height:32,borderRadius:10,display:'grid',placeItems:'center',background:tint,color}}><Ti n={icon} s={16}/></span>
      </div>
      <div style={{fontSize:30,fontWeight:700,letterSpacing:'-.02em',lineHeight:1,color:val>0?TK.ink:TK.faint,fontVariantNumeric:'tabular-nums'}}>{val}</div>
      {hint && <div style={{fontSize:12,color:TK.faint,marginTop:-4}}>{hint}</div>}
    </div>
  )
}

/** Initials disc for a person row. */
const Avatar = ({ name, size = 34, className }: { name: string; size?: number; className?: string }) => (
  <span className={className} style={{width:size,height:size,borderRadius:'50%',flexShrink:0,display:'grid',placeItems:'center',fontSize:Math.round(size*.36),fontWeight:700,
    background:TK.brandTint,border:`1px solid ${TK.brandEdge}`,boxSizing:'border-box',color:TK.brandDeep}}>
    {(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()}
  </span>
)

/** A white panel with a title row. */
const Panel = ({ title, sub, icon, children, right }: { title:string; sub?:string; icon?:string; children:React.ReactNode; right?:React.ReactNode }) => (
  <section style={{background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:16,padding:'18px 20px',boxShadow:'0 1px 2px rgba(16,24,40,.04)',minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
      {icon && <span style={{width:30,height:30,borderRadius:9,display:'grid',placeItems:'center',background:TK.brandTint,color:TK.brand,flexShrink:0}}><Ti n={icon} s={15}/></span>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:15,fontWeight:700,color:TK.ink}}>{title}</div>
        {sub && <div style={{fontSize:12.5,color:TK.muted,marginTop:1}}>{sub}</div>}
      </div>
      {right}
    </div>
    {children}
  </section>
)

/** An empty state: soft icon, one line. */
const Empty = ({ icon, text, tone = 'neutral' }: { icon:string; text:string; tone?: 'neutral'|'ok' }) => (
  <div style={{padding:'28px 16px',textAlign:'center',color:TK.muted,fontSize:13.5}}>
    <span style={{width:48,height:48,borderRadius:14,display:'grid',placeItems:'center',margin:'0 auto 10px',background:tone==='ok'?TK.positiveTint:TK.sunken,color:tone==='ok'?TK.positive:TK.faint}}><Ti n={icon} s={22}/></span>
    {text}
  </div>
)

const btnSm = (kind: 'primary'|'ghost'|'warn' = 'ghost'): React.CSSProperties => ({
  height:30, padding:'0 11px', borderRadius:9, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap',
  display:'inline-flex', alignItems:'center', gap:5,
  ...(kind === 'primary' ? { border:`1px solid ${TK.brand}`, background:TK.brand, color:TK.onAccent }
    : kind === 'warn' ? { border:`1px solid ${TK.warningEdge}`, background:TK.warningTint, color:TK.warning }
    : { border:`1px solid ${TK.lineStrong}`, background:TK.surface, color:TK.inkSoft }),
})
const inputCss: React.CSSProperties = { height:40, padding:'0 12px', borderRadius:10, border:`1px solid ${TK.lineStrong}`, fontSize:13, fontFamily:'inherit', color:TK.ink, background:TK.surface, outline:'none', boxSizing:'border-box' }
const labelCss: React.CSSProperties = { fontSize:12.5, fontWeight:600, color:TK.inkSoft, marginBottom:6 }
const RiskBadge = ({ risk, reason, short }: {risk?: RiskLevel; reason?: string; short?: boolean}) => {
  if (!risk) return null
  const m: Record<RiskLevel,{bg:string;color:string}> = {
    LOW:    {bg: TK.sunken,color: TK.positive},
    MEDIUM: {bg:TK.warningTint,color:TK.warning},
    HIGH:   {bg: TK.criticalTint,color:TK.critical},
  }
  return <Badge label={`${risk[0]}${risk.slice(1).toLowerCase()}${short ? '' : ' risk'}`} {...m[risk]} title={reason || undefined}/>
}

function Toast({msg,type,onClose}:{msg:string;type:'ok'|'err';onClose:()=>void}) {
  // Errors stay a little longer: they are usually something to act on.
  useEffect(()=>{const t=setTimeout(onClose,type==='err'?6000:3500);return()=>clearTimeout(t)},[onClose,type])
  return <div role="status" style={{position:'fixed',bottom:24,right:24,zIndex:9999,borderRadius:12,padding:'12px 18px',fontSize:13,fontWeight:600,background:TK.ink,color:TK.surface,boxShadow:'0 18px 40px -16px rgba(0,0,0,.5)',maxWidth:360,display:'flex',alignItems:'center',gap:10}}>
    <span style={{width:22,height:22,borderRadius:'50%',display:'grid',placeItems:'center',background:type==='ok'?TK.positive:TK.critical,color:TK.onAccent,flexShrink:0}}><Ti n={type==='ok'?'circle-check':'alert-triangle'} s={13}/></span>{msg}</div>
}

function ProgressBar({pct,color=P}:{pct:number;color?:string}) {
  return (
    <div style={{height:6,background:TK.sunken,borderRadius:99,overflow:'hidden',marginTop:5}}>
      <div style={{height:'100%',background:color,borderRadius:99,width:`${pct}%`,transition:'width .4s'}}/>
    </div>
  )
}

type RowAction = { label: string; hint?: string; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'ghost' | 'warn'; icon?: string; static?: boolean }

/** A row's actions, every one visible as its own button (two to a line), in the order HR uses
 *  them. A `static` entry is a read-only chip, e.g. "L1 ✓ Anil Verma". */
function RowActions({ actions }: { actions: RowAction[] }) {
  if (!actions.length) return <span style={{ fontSize:12, color:TK.faint }}>-</span>
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,max-content)', gap:6 }}>
      {actions.map(a => a.static ? (
        <span key={a.label} className="ezob-btn is-ghost" title={a.hint} style={{ ...btnSm('ghost'), cursor:'default' }}>{a.label}</span>
      ) : (
        <button key={a.label} type="button" className={`ezob-btn${a.kind === 'ghost' || !a.kind ? ' is-ghost' : ''}`} onClick={a.onClick} disabled={a.disabled} title={a.hint}
          style={{ ...btnSm(a.kind || 'ghost'), opacity: a.disabled ? .55 : 1, cursor: a.disabled ? 'not-allowed' : 'pointer' }}>
          {a.icon && <Ti n={a.icon} s={11}/>}{a.label}
        </button>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════
// ── Immigration tracker (Compliance tab): foreign nationals in India and overseas employees with
//    their passport / visa / work permit / FRRO / SSA dates — lib/onboarding/immigration.ts. ──
type Tracked = { id:string; emp_code:string; full_name:string; designation:string|null; track_label:string; work_country:string|null; employing_entity:string|null; international_employee:boolean|null; pan_pending:boolean; items:{ kind:string; label:string; date:string; days_left:number }[]; next:{ kind:string; label:string; date:string; days_left:number }|null }
function ImmigrationTracker() {
  const [people, setPeople] = useState<Tracked[]|null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/onboarding/immigration', { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load')
        if (alive) setPeople(d.people || [])
      } catch (e:any) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [])
  const tone = (d:number) => d < 0 ? { c:TK.critical, bg:TK.criticalTint, t:'lapsed' } : d <= 7 ? { c:TK.critical, bg:TK.criticalTint, t:`${d} d` } : d <= 30 ? { c:TK.warning, bg:TK.warningTint, t:`${d} d` } : d <= 60 ? { c:TK.info, bg:TK.infoTint, t:`${d} d` } : { c:TK.positive, bg:TK.positiveTint, t:`${d} d` }
  const urgent = (people||[]).filter(p => p.next && p.next.days_left <= 30).length
  return (
    <div style={{border:`1px solid ${TK.line}`,borderRadius:16,overflow:'hidden',background:TK.surface,boxShadow:'0 1px 2px rgba(16,24,40,.04)',marginBottom:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:`1px solid ${TK.line}`,background:TK.sunken}}>
        <div>
          <div style={{fontSize:13,fontWeight:700}}>Immigration & overseas tracker</div>
          <div style={{fontSize:11.5,color:TK.muted}}>Foreign nationals in India and overseas employees · passport, visa, work permit, FRRO and SSA dates · reminders go out at 60, 30 and 7 days and on the day</div>
        </div>
        {people && <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:99,background:urgent?TK.warningTint:TK.positiveTint,color:urgent?TK.warning:TK.positive}}>{urgent ? `${urgent} due within 30 days` : `${people.length} tracked · nothing due soon`}</span>}
      </div>
      {err && <div style={{padding:14,color:TK.critical,fontSize:12.5}}>{err}</div>}
      {!err && !people && <div style={{padding:14,color:TK.muted,fontSize:12.5}}>Loading…</div>}
      {people && people.length === 0 && <div style={{padding:14,color:TK.muted,fontSize:12.5}}>No foreign national or overseas employee on record yet. Pick the hiring track when sending an onboarding link.</div>}
      {people && people.length > 0 && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{background:TK.sunken}}>{['Employee','Track','Next due','Passport','Visa','Work permit','FRRO','SSA / PF'].map(h=><th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:700,color:TK.faint,textTransform:'uppercase',letterSpacing:'.06em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
            <tbody>
              {people.map(p => {
                const by = (k:string) => p.items.find(i => i.kind === k)
                const cell = (k:string, empty = '—') => { const i = by(k); if (!i) return <span style={{color:TK.faint}}>{empty}</span>; const t = tone(i.days_left); return <span title={i.label} style={{fontSize:11.5,fontWeight:600,padding:'2px 8px',borderRadius:99,background:t.bg,color:t.c,whiteSpace:'nowrap'}}>{i.date} · {t.t}</span> }
                return (
                  <tr key={p.id} style={{borderBottom:`1px solid ${TK.line}`}}>
                    <td style={{padding:'9px 12px'}}><div style={{fontWeight:600}}>{p.full_name}</div><div style={{fontSize:11,color:TK.muted}}>{[p.emp_code,p.designation].filter(Boolean).join(' · ')}</div></td>
                    <td style={{padding:'9px 12px',fontSize:12}}>{p.track_label}{p.work_country ? <div style={{fontSize:11,color:TK.muted}}>{p.work_country}{p.employing_entity ? ` · ${p.employing_entity}` : ''}</div> : null}</td>
                    <td style={{padding:'9px 12px'}}>{p.next ? (()=>{ const t = tone(p.next.days_left); return <span style={{fontSize:11.5,fontWeight:700,color:t.c}}>{p.next.label} · {p.next.days_left < 0 ? 'lapsed' : p.next.days_left === 0 ? 'today' : `${p.next.days_left} days`}</span> })() : <span style={{color:TK.faint}}>nothing dated</span>}</td>
                    <td style={{padding:'9px 12px'}}>{cell('passport')}</td>
                    <td style={{padding:'9px 12px'}}>{cell('visa')}</td>
                    <td style={{padding:'9px 12px'}}>{cell('work_permit')}</td>
                    <td style={{padding:'9px 12px'}}>{by('frro') ? cell('frro') : <span style={{color:p.track_label==='Overseas'?TK.faint:TK.positive,fontSize:11.5}}>{p.track_label==='Overseas' ? 'n/a' : 'registered'}</span>}</td>
                    <td style={{padding:'9px 12px',fontSize:11.5}}>{by('ssa_coc') ? cell('ssa_coc') : p.international_employee === true ? <span style={{color:TK.inkSoft}}>PF · International Worker</span> : p.international_employee === false ? <span style={{color:TK.inkSoft}}>SSA exempt</span> : <span style={{color:TK.faint}}>n/a</span>}{p.pan_pending && <div style={{color:TK.warning,fontSize:11}}>PAN pending · TDS 20%</div>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function OnboardingDashboard() {
  const { grant, loading: grantLoading } = useGrant()
  const [tab,          setTab]        = useState<Tab>('overview')
  // Role-wise tab visibility (Roles → Screen Access). Bounce off a hidden tab.
  useEffect(() => {
    const vis = (['overview','candidates','pending','insights','compliance'] as Tab[]).filter(k => canSeeScreen(grant, 'onboarding.'+k))
    if (vis.length && !vis.includes(tab)) setTab(vis[0])
  }, [grant, tab])
  const [candidates,   setCandidates] = useState<Candidate[]>([])
  const [loading,      setLoading]    = useState(true)
  const [toast,        setToast]      = useState<{msg:string;type:'ok'|'err'}|null>(null)
  const [filterStage,  setFilterStage] = useState<Stage|'ALL'>('ALL')
  const [filterRisk,   setFilterRisk]  = useState<RiskLevel|'ALL'>('ALL')
  const [joinWindow,   setJoinWindow]  = useState<'all'|'today'|'3days'|'week'|'month'>('all')
  const [searchQ,      setSearchQ]    = useState('')
  // Modal state
  const [linkModal,    setLinkModal]  = useState(false)
  const [codeModal,    setCodeModal]  = useState<Candidate|null>(null)   // Generate code — team, roles, code (GenerateCodeModal)
  const [apptFor,      setApptFor]    = useState<Candidate|null>(null)   // Letter of Appointment, once the code exists (AppointmentLetterModal)
  // Joiners whose Letter of Appointment has gone out (onboarding_audit_log APPOINTMENT_LETTER_SENT).
  // A coded joiner stays on the default list, with the letter as their next step, until it has.
  const [apptSent,     setApptSent]   = useState<Set<string>>(new Set())
  const [saving,       setSaving]     = useState(false)
  const [dateModal,    setDateModal]  = useState<Candidate|null>(null)
  const [dateVal,      setDateVal]    = useState('')
  const [editEmail,    setEditEmail]  = useState('')
  const [editMobile,   setEditMobile] = useState('')
  // The hiring track edited on the card (lib/onboarding/hiring-track.ts). A recruitment joiner has no onboarding row yet, so their pick waits in trackPick until the link is sent.
  const [editTrack,    setEditTrack]  = useState({ hiring_track: 'DOMESTIC', work_country: '', payroll_currency: 'INR', employing_entity: '', notice_period_days: '' })
  const [trackPick,    setTrackPick]  = useState<Record<string, { hiring_track: string; work_country: string | null; payroll_currency: string | null; employing_entity: string | null; notice_period_days?: number | null }>>({})
  const [resendingId,  setResendingId] = useState('')
  const [reviewing,    setReviewing]  = useState<{ id: string; readOnly: boolean } | null>(null)
  const [selIds,       setSelIds]     = useState<Set<string>>(new Set())
  // Who acts for each approval team, per company (/api/onboarding/approvers). null = not loaded.
  const [holders,      setHolders]    = useState<Holders | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useHostStickyOffset(rootRef)
  // New link form
  const [companies, setCompanies] = useState<{id:string;company_name?:string;company_code?:string}[]>([])
  const [departments, setDepartments] = useState<{id:string;dept_name:string;company_id:string}[]>([])
  const [locations, setLocations] = useState<{id:string;location_name:string;company_id:string}[]>([])
  const [newForm, setNewForm] = useState({
    company_id:'', full_name:'', designation:'', department:'', department_id:'', location_id:'', email:'', mobile:'',
    date_of_joining:'', offered_ctc:'', employment_type:'Employee',
    hiring_track:'DOMESTIC', work_country:'', payroll_currency:'INR', employing_entity:'', notice_period_days:'',
  })

  // Load companies + departments for the link modal (auto-select if there's only one).
  useEffect(()=>{
    if (grantLoading) return
    supabase.from('companies').select('id,company_code,company_name').order('company_code')
      .then(({data})=>{
        const list = scopedCompanies(grant, data || [])
        setCompanies(list)
        const def = defaultCompanyId(grant) || (list.length === 1 ? list[0].id : '')
        if (def) setNewForm(f=> f.company_id ? f : { ...f, company_id:def })
      })
    supabase.from('departments').select('id,dept_name,company_id').order('dept_name')
      .then(({data})=>setDepartments(data || []))
    supabase.from('locations').select('id,location_name,company_id').order('location_name')
      .then(({data})=>setLocations(data || []))
  },[grantLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg:string, type:'ok'|'err'='ok') => setToast({msg,type})

  // ── Load all onboarding candidates ───────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const { data: cands, error } = await supabase
      .from('onboarding_candidates')
      .select('*')
      .order('created_at', {ascending:false})

    if (error) { showToast('Load error: '+error.message,'err'); setLoading(false); return }

    // Enrich with documents + statutory forms.
    //
    // This used to run three queries PER CANDIDATE. With 14 candidates that is
    // 42 round trips for data that is three queries — 84 in dev, where React
    // StrictMode invokes the effect twice. Measured: 84 requests, 8.4 seconds
    // of cumulative request time. It also got worse with every candidate
    // added, which is the part that matters.
    //
    // Now: every row for the whole set in one query per table, grouped in
    // memory. Three requests regardless of how many candidates there are.
    //
    // Chunked at 150 ids because PostgREST takes the filter in the URL and a
    // few hundred UUIDs would run past the request line limit.
    const ids = (cands || []).map(c => c.id)
    const chunk = <T,>(a: T[], n: number) =>
      Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
    const fetchAll = async (table: string, cols: string) => {
      if (!ids.length) return [] as any[]
      const parts = await Promise.all(
        chunk(ids, 150).map(part => supabase.from(table).select(cols).in('onboarding_id', part))
      )
      return parts.flatMap(p => (p.data as any[]) || [])
    }
    // Which coded joiners have had their Letter of Appointment sent.
    const codedIds = (cands || []).filter((c: any) => c.status === 'EMPLOYEE_CREATED').map((c: any) => c.id)
    void Promise.all(chunk(codedIds, 150).map(part => supabase.from('onboarding_audit_log').select('onboarding_id').eq('action', 'APPOINTMENT_LETTER_SENT').in('onboarding_id', part)))
      .then(parts => setApptSent(new Set(parts.flatMap(p => ((p.data as any[]) || []).map(r => r.onboarding_id)))))
    const [allDocs, allForms, allAssets, allApprovals, allAcks] = await Promise.all([
      fetchAll('onboarding_documents',       'onboarding_id,doc_code,ai_status,hr_verified'),
      fetchAll('onboarding_statutory_forms', 'onboarding_id,form_type'),
      fetchAll('onboarding_asset_requests',  'onboarding_id,asset_type,status'),
      fetchAll('onboarding_approvals',       'onboarding_id,team,status,acted_by_name,acted_at,remark'),
      fetchAll('onboarding_policy_acks',     'onboarding_id,acknowledged_at'),
    ])
    const groupBy = (rows: any[]) => {
      const m = new Map<string, any[]>()
      rows.forEach(r => { const a = m.get(r.onboarding_id); a ? a.push(r) : m.set(r.onboarding_id, [r]) })
      return m
    }
    const docsBy = groupBy(allDocs), formsBy = groupBy(allForms), assetsBy = groupBy(allAssets), approvalsBy = groupBy(allApprovals)
    const ackedIds = new Set(allAcks.filter((a: any) => a.acknowledged_at).map((a: any) => a.onboarding_id))

    const enriched: Candidate[] = (cands || []).map((c) => {
      const docs = docsBy.get(c.id) || []
      const forms = formsBy.get(c.id) || []
      const assets = assetsBy.get(c.id) || []
      // A document code can have more than one row (a re-upload, a copy carried over from before
      // the offer) and most codes are optional, so "have / required" counts DISTINCT required
      // codes, per hiring track, the same list the portal will not submit without. It used to
      // divide every row by six and showed "16/6".
      const codes     = new Set((docs||[]).map(d=>d.doc_code))
      const okCodes   = new Set((docs||[]).filter(d=>d.hr_verified!==false).map(d=>d.doc_code))
      const required  = requiredDocCodes(trackOf(c.hiring_track), { esic: c.esic_applicable === true })
      const flagged   = (docs||[]).filter(d=>d.ai_status==='MISMATCH'||d.ai_status==='FAILED').length
      const rejected  = (docs||[]).filter(d=>d.hr_verified===false).length
      const formTypes = (forms||[]).map(f=>f.form_type)
      const laptop    = (assets||[]).find(a=>a.asset_type==='LAPTOP')
      const idCard    = (assets||[]).find(a=>a.asset_type==='ID_CARD')

      // Compute AI risk
      let risk: RiskLevel = 'LOW'
      let riskReason = ''
      const days = daysLeft(c.date_of_joining)
      if (days !== null && days < 0 && c.status !== 'EMPLOYEE_CREATED') { risk='HIGH'; riskReason=`Joining date passed ${relDays(days)}, onboarding not complete` }
      else if (days !== null && days <= 3 && c.status !== 'EMPLOYEE_CREATED') { risk='HIGH'; riskReason=`Joining ${relDays(days)}, onboarding not complete` }
      else if (flagged > 0 && c.status !== 'EMPLOYEE_CREATED') { risk='MEDIUM'; riskReason=`${flagged} document${flagged===1?'':'s'} flagged by the AI check` }
      else if (c.status==='INVITED' && days !== null && days <= 7) { risk='MEDIUM'; riskReason='Link not opened, joining close' }
      else if (days === null && c.status !== 'EMPLOYEE_CREATED') { risk='MEDIUM'; riskReason='No date of joining set' }

      return {
        ...c,
        docs_uploaded:   codes.size,
        docs_required_have:  required.filter(r => okCodes.has(r)).length,
        docs_required_total: required.length,
        docs_ai_flagged: flagged,
        docs_rejected:   rejected,
        form11:          formTypes.includes('EPF_FORM11'),
        form2:           formTypes.includes('EPF_FORM2'),
        bank:            formTypes.includes('BANK_MANDATE'),
        // The portal records each policy acknowledgement in onboarding_policy_acks; nothing writes
        // form_data.step_8.declaration_accepted, so on its own this read "Policy pending" for everyone.
        policy_ack:      ackedIds.has(c.id) || !!(c.form_data?.step_8?.declaration_accepted),
        // IT and Admin confirm the laptop and the ID card on their approval checklist
        // (onboarding_candidates columns); the older "Mark issued" asset rows count too.
        laptop_issued:   laptop?.status === 'ISSUED' || c.it_laptop_issued === true,
        id_card_issued:  idCard?.status  === 'ISSUED' || c.admin_id_card === true,
        ai_risk:         risk,
        ai_risk_reason:  riskReason,
        approvals:       (approvalsBy.get(c.id) || []) as ApprovalRow[],
      } as Candidate
    })

    // ── Auto-pull joiners from recruitment ───────────────────────
    // A candidate appears here once they reach pre-onboarding (offer accepted /
    // joined) OR have a joining date set — so HR can send the onboarding link
    // even before a joining date is fixed. Not-yet-invited ones show as
    // NOT_INVITED cards with a "Send onboarding link" button.
    const scopeCo = companyFilter(grant, null)
    let recQ = supabase
      .from('candidates')
      .select('id, full_name, email, mobile, phone, designation, company_id, onboarding_date, blacklisted, offer_accepted, stage, created_at, application_details')
      .or('onboarding_date.not.is.null,offer_accepted.is.true,stage.eq.Joined')
    if (scopeCo) recQ = recQ.eq('company_id', scopeCo)
    const { data: recJoiners } = await recQ

    const invitedIds = new Set(enriched.map(c => c.candidate_id).filter(Boolean))
    const pending: Candidate[] = (recJoiners || [])
      .filter(r => !r.blacklisted && !invitedIds.has(r.id))
      .map(r => {
        const d = daysLeft(r.onboarding_date)
        return {
          id:              'rec_' + r.id,
          recruitment_id:  r.id,
          full_name:       r.full_name,
          designation:     r.designation || '',
          department:      '',
          email:           r.email || '',
          mobile:          r.mobile || r.phone || '',
          date_of_joining: r.onboarding_date,
          // An international candidate (Add candidate → International) arrives with their hiring track:
          // in India → FOREIGN_IN_INDIA, outside India → OVERSEAS (lib/onboarding/hiring-track.ts).
          hiring_track:    (r as any).application_details?.international?.hiring_track || 'DOMESTIC',
          work_country:    (r as any).application_details?.international?.work_country || null,
          payroll_currency: (r as any).application_details?.international?.payroll_currency || null,
          status:          'NOT_INVITED' as Stage,
          current_step:    0,
          form_data:       {},
          company_id:      r.company_id,
          magic_link_token:'',
          created_at:      r.created_at || r.onboarding_date,
          docs_uploaded:   0,
          docs_ai_flagged: 0,
          ai_risk:         (d !== null && d <= 3 ? 'HIGH' : d !== null && d <= 7 ? 'MEDIUM' : 'LOW') as RiskLevel,
          ai_risk_reason:  'Onboarding link not sent yet',
        } as Candidate
      })

    // Soonest joining date first; undated rows last.
    // Safety net: a non-cross caller only ever sees their own company's candidates,
    // covering both the invited (enriched) and pending lists.
    const both = scopeCo ? [...pending, ...enriched].filter(c => c.company_id === scopeCo) : [...pending, ...enriched]
    const merged = both.sort((a, b) => {
      const da = a.date_of_joining ? new Date(a.date_of_joining).getTime() : Infinity
      const db = b.date_of_joining ? new Date(b.date_of_joining).getTime() : Infinity
      return da - db
    })

    setCandidates(merged as Candidate[])
    setLoading(false)

    // Who acts for each approval team in these companies: the names in the approvals popover.
    // Non-blocking: the table shows without it, and says "the team" until it lands.
    const coIds = [...new Set(enriched.filter(c => c.status !== 'NOT_INVITED').map(c => c.company_id).filter(Boolean))]
    if (coIds.length) {
      try {
        const res = await fetch(`/api/onboarding/approvers?company_ids=${encodeURIComponent(coIds.join(','))}`, { headers: await authHeaders() })
        const d = await res.json().catch(() => ({}))
        setHolders(res.ok ? (d.holders || {}) : null)
      } catch { setHolders(null) }
    }
  }, [grant])

  /** Where this onboarding's sign-off is, and who has it (lib/onboarding/approval-trail.ts). */
  const trailOf = (c: Candidate): Trail => approvalTrail({
    status: c.status, submitted_at: c.submitted_at, approvals: c.approvals || [],
    holders: holders?.[c.company_id] || null, hr_review: c.hr_review || null,
    role_assignment: c.role_assignment || null, employee_code: c.employee_code || null,
  })
  const readinessOf = (c: Candidate): Readiness[] => [
    { label:'EPF Form 11', done:!!c.form11 }, { label:'EPF Form 2', done:!!c.form2 }, { label:'Bank mandate', done:!!c.bank },
    { label:'Policy acknowledged', done:!!c.policy_ack }, { label:'Laptop', done:!!c.laptop_issued }, { label:'ID card', done:!!c.id_card_issued },
  ]
  const approvalsCellFor = (c: Candidate) => (
    <ApprovalsCell name={c.full_name} trail={trailOf(c)} holdersKnown={holders!==null}
      managers={{ l1:c.role_assignment?.managers?.l1_name, l2:c.role_assignment?.managers?.l2_name, hod:c.role_assignment?.managers?.hod_name }}
      readiness={readinessOf(c)} />
  )

  useEffect(()=>{ if (!grantLoading) load() },[load, grantLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  // Escape closes the page's own small dialogs (the drawer and the code modal handle theirs).
  useEffect(()=>{
    if (!linkModal && !dateModal) return
    const onKey = (e: KeyboardEvent) => { if (e.key==='Escape' && !saving) { setLinkModal(false); setDateModal(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  },[linkModal, dateModal, saving])

  // ── Send onboarding link ────────────────────────────────────────────
  const sendMagicLink = async () => {
    const { company_id, full_name, mobile, date_of_joining, email, designation, employment_type } = newForm
    if (!company_id) { showToast('Please select a company','err'); return }
    // Everything the link mail, the review sheet and the employee record need — never a blank here.
    const need: string[] = []
    if (!full_name?.trim()) need.push('name')
    if (!/^[6-9]\d{9}$/.test(String(mobile || '').replace(/\D/g, ''))) need.push('a 10-digit mobile')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim())) need.push('a valid email (the link and the login go there)')
    if (!date_of_joining) need.push('date of joining')
    if (!designation?.trim()) need.push('designation')
    // The offer letter, the statutory forms and the employee record carry these too.
    if (!newForm.department_id) need.push('department')
    if (newForm.hiring_track !== 'OVERSEAS' && !newForm.location_id) need.push('work location')
    if (!employment_type) need.push('employment type')
    if (newForm.hiring_track === 'OVERSEAS' && !newForm.work_country?.trim()) need.push('work country (overseas employee)')
    if (need.length) { showToast(`Required: ${need.join(', ')}.`,'err'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/send-magic-link', {
        method:'POST', headers: await authHeaders(),
        body: JSON.stringify({ ...newForm, offered_ctc: newForm.offered_ctc ? parseFloat(newForm.offered_ctc) : null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed')
      showToast(data.emailed ? `Onboarding link emailed for ${full_name}! ✉️` : `Link created (email NOT sent: ${data.email_error || '-'}). Share manually: ${data.magic_link}`, data.emailed ? 'ok' : 'err')
      setLinkModal(false)
      setNewForm(f=>({company_id:f.company_id,full_name:'',designation:'',department:'',department_id:'',location_id:'',email:'',mobile:'',date_of_joining:'',offered_ctc:'',employment_type:'Employee',hiring_track:'DOMESTIC',work_country:'',payroll_currency:'INR',employing_entity:'',notice_period_days:''}))
      load()
    } catch(e:any) { showToast(e.message,'err') }
    setSaving(false)
  }

  // ── Send onboarding link for a recruitment joiner (from the card) ──
  // Returns true only if the link was actually created. In bulk mode we stay
  // quiet (no per-candidate toast/reload) so the caller can report a true count.
  const sendOnboardingFor = async (c: Candidate, opts?: { bulk?: boolean }): Promise<boolean> => {
    const bulk = !!opts?.bulk
    if (!c.mobile) { if (!bulk) showToast('This candidate has no mobile number. Add one in Recruitment first','err'); return false }
    // The joining date goes on the link mail, the sheet and the employee record; never send without it.
    if (!c.date_of_joining) { if (!bulk) { showToast(`Set ${c.full_name}'s date of joining first.`,'err'); openDateEdit(c) } return false }
    if (!c.email) { if (!bulk) { showToast(`Add ${c.full_name}'s email first — the link and the ESS login go there.`,'err'); openDateEdit(c) } return false }
    // Resolve company: candidate's own → company chosen during negotiation → single company.
    let companyId: string | undefined = c.company_id
    if (!companyId && c.recruitment_id) {
      const { data: neg } = await supabase.from('ctc_negotiations').select('company_id')
        .eq('candidate_id', c.recruitment_id).not('company_id','is',null)
        .order('created_at',{ ascending:false }).limit(1).maybeSingle()
      companyId = neg?.company_id || (companies.length === 1 ? companies[0].id : undefined)
    }
    if (!companyId) { if (!bulk) showToast('This candidate has no company set. Open them in Recruitment → Negotiation and pick a company first.','err'); return false }
    if (!bulk) setSaving(true)
    let success = false
    try {
      const res = await fetch('/api/onboarding/send-magic-link', {
        method:'POST', headers: await authHeaders(),
        body: JSON.stringify({
          candidate_id:    c.recruitment_id || null,
          company_id:      companyId,
          full_name:       c.full_name,
          email:           c.email,
          mobile:          c.mobile,
          designation:     c.designation,
          department:      c.department,
          date_of_joining: c.date_of_joining,
          // The hiring track picked in Edit (a recruitment joiner keeps it in trackPick until the link exists).
          ...(trackPick[c.id] || { hiring_track: c.hiring_track || 'DOMESTIC', work_country: c.work_country || null, payroll_currency: c.payroll_currency || null, employing_entity: c.employing_entity || null }),
          notice_period_days: trackPick[c.id]?.notice_period_days ?? c.notice_period_days ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed')
      success = true
      if (!bulk) {
        showToast(data.emailed ? `Onboarding link emailed to ${c.email} ✉️` : `Link created, email NOT sent (${data.email_error || 'no email'}). Copy it from the candidate's card.`, data.emailed ? 'ok' : 'err')
        load()
      }
    } catch(e:any) { if (!bulk) showToast(e.message,'err') }
    if (!bulk) setSaving(false)
    return success
  }

  // ── Edit candidate (DOJ + email + mobile) — HR Manager ─────────
  const openDateEdit = (c: Candidate) => {
    setDateModal(c); setDateVal(c.date_of_joining ? c.date_of_joining.slice(0,10) : ''); setEditEmail(c.email || ''); setEditMobile(c.mobile || '')
    const t = trackPick[c.id] || { hiring_track: c.hiring_track || 'DOMESTIC', work_country: c.work_country || '', payroll_currency: c.payroll_currency || 'INR', employing_entity: c.employing_entity || '', notice_period_days: c.notice_period_days ?? null }
    setEditTrack({ hiring_track: t.hiring_track || 'DOMESTIC', work_country: t.work_country || '', payroll_currency: t.payroll_currency || 'INR', employing_entity: t.employing_entity || '', notice_period_days: t.notice_period_days != null ? String(t.notice_period_days) : '' })
  }
  const saveDate = async () => {
    if (!dateModal) return
    // The joining date and the email are required everywhere else (the link, Generate code);
    // the edit must not be the one place that can blank them.
    if (!dateVal) { showToast('The date of joining is required.','err'); return }
    if (!dateModal.recruitment_id && !editEmail.trim()) { showToast('The email is required: the link and the ESS login go there.','err'); return }
    if (editEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(editEmail.trim())) { showToast('That email does not look right: the link and the ESS login go there.','err'); return }
    if (editMobile && !/^[6-9]\d{9}$/.test(editMobile.replace(/\D/g,'').slice(-10))) { showToast('The mobile must be a 10-digit Indian number.','err'); return }
    if (editTrack.hiring_track === 'OVERSEAS' && !editTrack.work_country.trim()) { showToast('Pick the work country for an overseas employee.', 'err'); return }
    setSaving(true)
    const c = dateModal
    const track = { hiring_track: editTrack.hiring_track, work_country: editTrack.hiring_track === 'OVERSEAS' ? editTrack.work_country.trim() : 'India', payroll_currency: editTrack.hiring_track === 'OVERSEAS' ? (editTrack.payroll_currency.trim().toUpperCase() || null) : 'INR', employing_entity: editTrack.employing_entity.trim() || null, notice_period_days: Number(editTrack.notice_period_days) > 0 ? Math.round(Number(editTrack.notice_period_days)) : null }
    // Recruitment joiner (not yet invited) → candidates (the track rides along until the link is sent). Already-invited → onboarding_candidates.
    const { error } = c.recruitment_id
      ? await supabase.from('candidates').update({ onboarding_date: dateVal || null, email: editEmail || null, phone: editMobile || null, mobile: editMobile || null }).eq('id', c.recruitment_id)
      : await supabase.from('onboarding_candidates').update({ date_of_joining: dateVal || null, email: editEmail || null, mobile: editMobile || null, ...track }).eq('id', c.id)
    setSaving(false)
    if (error) { showToast('Error: '+error.message, 'err'); return }
    if (c.recruitment_id) setTrackPick(p => ({ ...p, [c.id]: track }))
    showToast(`Updated ${c.full_name}.`); setDateModal(null); load()
  }

  // ── Bulk send onboarding links to selected not-invited candidates ──
  const bulkSend = async () => {
    const targets = filtered.filter(c => selIds.has(c.id) && c.status==='NOT_INVITED')
    if (!targets.length) { showToast('Select at least one "Not invited" candidate.', 'err'); return }
    if (!window.confirm(`Send onboarding link to ${targets.length} candidate(s)?`)) return
    setSaving(true)
    let ok = 0
    for (const c of targets) { if (await sendOnboardingFor(c, { bulk: true })) ok++ }
    setSaving(false); setSelIds(new Set())
    const failed = targets.length - ok
    showToast(
      failed === 0
        ? `Onboarding link sent to all ${ok} candidate(s).`
        : `Sent to ${ok}/${targets.length}. ${failed} skipped (missing mobile or company).`,
      failed === 0 ? 'ok' : 'err'
    )
    load()
  }

  // ── Extend link validity (+7 days) without re-emailing ─────────
  const extendValidity = async (c: Candidate) => {
    const { error } = await supabase.from('onboarding_candidates')
      .update({ token_expires_at: new Date(Date.now() + 7*24*3600*1000).toISOString() }).eq('id', c.id)
    if (error) { showToast('Error: '+error.message, 'err'); return }
    showToast(`Link validity extended to 7 days for ${c.full_name}.`); load()
  }

  // ── Resend the onboarding link to an already-invited candidate ──
  const resendLink = async (c: Candidate) => {
    setResendingId(c.id)
    try {
      const res = await fetch('/api/onboarding/resend-link', {
        method:'POST', headers: await authHeaders(),
        body: JSON.stringify({ onboarding_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      showToast(data.emailed ? (data.corrections ? `Link re-sent to ${c.email} with the list of corrections ✉️` : `Onboarding link re-sent to ${c.email} ✉️`) : `Link refreshed, email NOT sent (${data.email_error || 'no email'}). Copy it instead.`, data.emailed ? 'ok' : 'err')
    } catch(e:any) { showToast('Resend failed: '+e.message, 'err') }
    setResendingId('')
  }

  // ── Generate code: the modal (components/onboarding/GenerateCodeModal) does the work —
  //    the team, the roles, the code — and reports back through onDone. ──
  const openCodeModal = (candidate: Candidate) => setCodeModal(candidate)
  // FIFO (lib/onboarding/code-series.ts): codes go out in the order candidates came into
  // Onboarding. Earlier arrivals of the same company still without a code block this one.
  // The queue is switched off for now (CODE_QUEUE_ENFORCED): nobody waits behind anybody.
  const aheadOf = (c: Candidate) => !CODE_QUEUE_ENFORCED ? [] : candidates
    .filter(o => !o.id.startsWith('rec_') && o.id !== c.id && o.company_id === c.company_id && o.status !== 'EMPLOYEE_CREATED' && !o.employee_code)
    .filter(o => o.created_at < c.created_at || (o.created_at === c.created_at && o.id < c.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const fifoTitle = (c: Candidate) => { const a = aheadOf(c); return a.length ? `Waiting: ${a[0].full_name} came into Onboarding first and has no code yet${a.length > 1 ? ` (+${a.length - 1} more)` : ''}. Codes go out in order of arrival.` : '' }

  // ── Issue asset ───────────────────────────────────────────────
  const issueAsset = async (candidateId: string, assetType: 'LAPTOP'|'ID_CARD') => {
    // A recruitment joiner who has not been sent the link has no onboarding record to hang it on.
    if (candidateId.startsWith('rec_')) { showToast('Send the onboarding link first: there is no onboarding record yet.','err'); return }
    const { error } = await supabase.from('onboarding_asset_requests').upsert({
      onboarding_id: candidateId, asset_type: assetType,
      status:'ISSUED', issued_at: new Date().toISOString(),
    },{onConflict:'onboarding_id,asset_type'})
    if (error) { showToast('Could not mark it issued: '+error.message,'err'); return }
    showToast(`${assetType==='LAPTOP'?'Laptop':'ID card'} marked as issued`)
    load()
  }

  // ── Computed stats ─────────────────────────────────────────────
  const total       = candidates.length
  const active      = candidates.filter(c=>!['EMPLOYEE_CREATED'].includes(c.status)).length
  // "Awaiting code" = every team has approved and only Generate code is left. It used to count
  // SUBMITTED + HR_REVIEW, i.e. forms nobody had approved yet.
  const submitted   = candidates.filter(c=>c.status==='APPROVED').length
  const awaitingReview = candidates.filter(c=>c.status==='SUBMITTED').length
  const highRisk    = candidates.filter(c=>c.ai_risk==='HIGH').length
  const joined      = candidates.filter(c=>c.status==='EMPLOYEE_CREATED').length
  // Hidden from the default list: coded and their appointment letter sent.
  const doneHidden  = candidates.filter(c=>c.status==='EMPLOYEE_CREATED' && apptSent.has(c.id)).length
  const thisWeek    = candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).length
  const notInvitedCount = candidates.filter(c=>c.status==='NOT_INVITED').length
  /** Open All candidates with exactly these filters (the rest cleared). */
  const showList = (f: { stage?: Stage|'ALL'; risk?: RiskLevel|'ALL'; win?: typeof joinWindow }) => {
    setFilterStage(f.stage || 'ALL'); setFilterRisk(f.risk || 'ALL'); setJoinWindow(f.win || 'all'); setSearchQ(''); setTab('candidates')
  }

  // ── Filter candidates ─────────────────────────────────────────
  const filtered = candidates.filter(c=>{
    // Once the employee code is generated AND the Letter of Appointment has gone out, drop the
    // card from the default list — still reachable by explicitly filtering the stage. Until the
    // letter is sent, the row stays: its Appointment letter button is the next step.
    if (c.status==='EMPLOYEE_CREATED' && apptSent.has(c.id) && filterStage!=='EMPLOYEE_CREATED') return false
    if (filterStage!=='ALL' && c.status!==filterStage) return false
    if (filterRisk!=='ALL'  && c.ai_risk!==filterRisk)  return false
    if (joinWindow!=='all') {
      const d = daysLeft(c.date_of_joining)
      if (d===null) return false
      const within = joinWindow==='today' ? d===0
        : joinWindow==='3days' ? (d>=0 && d<=3)
        : joinWindow==='week'  ? (d>=0 && d<=7)
        :                        (d>=0 && d<=31)   // month
      if (!within) return false
    }
    if (searchQ && !c.full_name.toLowerCase().includes(searchQ.toLowerCase()) &&
        !c.designation?.toLowerCase().includes(searchQ.toLowerCase())) return false
    return true
  })

  // ── Pending actions ────────────────────────────────────────────
  const pendingActions = candidates.flatMap(c => {
    const actions: {priority:'HIGH'|'MEDIUM'|'LOW'; label:string; candidate:string; action:string; cid:string}[] = []
    const days = daysLeft(c.date_of_joining)

    if (c.status==='SUBMITTED') {
      // Flagged documents matter while HR still has to look at them: on the review sheet.
      const f = c.docs_ai_flagged || 0
      actions.push({priority:'HIGH',label:`Form submitted: review the documents and details${f ? ` (${f} document${f===1?'':'s'} flagged by the AI check)` : ''}`,candidate:c.full_name,action:'review',cid:c.id})
    }
    if (c.status==='HR_REVIEW') {
      actions.push({priority:'MEDIUM',label:`Accepted by HR, now with ${trailOf(c).nowWith} for their checklist (ESS → HRIS → Tasks & Approvals)`,candidate:c.full_name,action:'approvals',cid:c.id})
    }
    if (c.status==='APPROVED') {
      actions.push(aheadOf(c).length
        ? {priority:'MEDIUM',label:`Approved by all three teams, in the code queue behind ${aheadOf(c)[0].full_name} (codes go out in order of arrival)`,candidate:c.full_name,action:'generate',cid:c.id}
        : {priority:'HIGH',label:'IT, Admin and Payroll approved — generate the employee code (their team, ESS roles and the code; the login is mailed to them)',candidate:c.full_name,action:'generate',cid:c.id})
    }
    if (c.status==='EMPLOYEE_CREATED' && !apptSent.has(c.id)) {
      actions.push({priority:'HIGH',label:`Employee code ${c.employee_code || ''} generated: send the Letter of Appointment`,candidate:c.full_name,action:'appt',cid:c.id})
    }
    if (c.status==='IN_PROGRESS' && c.hr_review?.outcome==='RETURNED') {
      const n = (c.hr_review.documents||[]).length, m = (c.hr_review.details||[]).length
      actions.push({priority:'MEDIUM',label:`Returned to candidate: ${n} document${n===1?'':'s'} rejected, ${m} detail${m===1?'':'s'} flagged; resend the link if they have not acted`,candidate:c.full_name,action:'returned',cid:c.id})
    }
    if (c.status==='NOT_INVITED' && days!==null && days<=7) actions.push({priority:days<=3?'HIGH':'MEDIUM',label:`Onboarding link not sent, joining ${relDays(days)}`,candidate:c.full_name,action:'send',cid:c.id})
    if (c.status==='INVITED' && days!==null && days<=5) actions.push({priority:'HIGH',label:'Link not opened, follow up candidate',candidate:c.full_name,action:'followup',cid:c.id})
    if (c.status==='APPROVED' && !c.laptop_issued) actions.push({priority:'MEDIUM',label:'Laptop not issued, contact IT',candidate:c.full_name,action:'laptop',cid:c.id})
    if (c.status==='APPROVED' && !c.id_card_issued) actions.push({priority:'LOW',label:'ID card not issued, contact Admin',candidate:c.full_name,action:'idcard',cid:c.id})
    if (!c.policy_ack && c.status==='IN_PROGRESS') actions.push({priority:'LOW',label:'Policy acknowledgement pending',candidate:c.full_name,action:'policy',cid:c.id})
    return actions
  }).sort((a,b)=>{ const o={HIGH:0,MEDIUM:1,LOW:2}; return o[a.priority]-o[b.priority] })

  // ── Shared section header ──────────────────────────────────────
  const SH = ({title,sub}:{title:string;sub?:string}) => (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:17,fontWeight:700,color:TK.ink,letterSpacing:'-.01em'}}>{title}</div>
      {sub && <div style={{fontSize:13,color:TK.muted,marginTop:3}}>{sub}</div>}
    </div>
  )

  // ── OVERVIEW TAB ───────────────────────────────────────────────
  const OverviewTab = () => (
    <div>
      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18}}>
        {/* Each tile opens the list it counts. */}
        <StatCard label="Active onboarding"  val={active}         color={TK.info}     tint={TK.infoTint}     icon="clock"          onClick={()=>showList({})}/>
        <StatCard label="Joining this week"  val={thisWeek}       color={TK.warning}  tint={TK.warningTint}  icon="home"           onClick={()=>showList({ win:'week' })}/>
        <StatCard label="Awaiting HR review" val={awaitingReview} color={TK.warning}  tint={TK.warningTint}  icon="list-check"     onClick={()=>showList({ stage:'SUBMITTED' })}/>
        <StatCard label="Awaiting code"      val={submitted}      color={TK.brand}    tint={TK.brandTint}    icon="bolt"           onClick={()=>showList({ stage:'APPROVED' })}/>
        <StatCard label="High risk"          val={highRisk}       color={TK.critical} tint={TK.criticalTint} icon="alert-triangle" onClick={()=>showList({ risk:'HIGH' })}/>
        <StatCard label="Completed"          val={joined}         color={TK.positive} tint={TK.positiveTint} icon="circle-check"   onClick={()=>showList({ stage:'EMPLOYEE_CREATED' })}/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:16,alignItems:'start'}}>

        {/* Quick actions */}
        <Panel title="Quick actions" icon="bolt">
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <button onClick={()=>showList({ stage: notInvitedCount ? 'NOT_INVITED' : 'ALL' })} className="ez-cta"
              style={{
                // The primary action of the screen: solid brand, an arrow that travels on hover.
                padding:'14px 16px', borderRadius:R.md, border:`1px solid ${TK.brand}`,
                cursor:'pointer', background:TK.brand,
                color:TK.onAccent, fontSize:14, fontWeight:600, fontFamily:'inherit',
                textAlign:'left', display:'flex', alignItems:'center', gap:11, width:'100%',
              }}>
              <span style={{width:32,height:32,borderRadius:10,display:'grid',placeItems:'center',background:`color-mix(in srgb, ${TK.onAccent} 18%, transparent)`}}><Ti n="send" s={16}/></span>
              <span style={{flex:1}}>Send onboarding links</span>
              <span style={{fontSize:12, fontWeight:500, opacity:.85}}>{notInvitedCount ? `${notInvitedCount} not invited` : 'Everyone has a link'}</span>
              <span className="ez-cta-arrow" style={{display:'flex'}}><IconChevron size={16} /></span>
            </button>
            {[
              { t:'pending' as Tab, icon:'list-check', color:TK.warning, tint:TK.warningTint, title:`${pendingActions.filter(a=>a.priority==='HIGH').length} urgent pending actions`, sub:`${pendingActions.length} in total, most urgent first` },
              { t:'compliance' as Tab, icon:'shield-check', color:TK.brand, tint:TK.brandTint, title:'PF, ESI & BGV compliance', sub:'Forms, bank details, policies and assets' },
            ].map(q=>(
              <button key={q.t} onClick={()=>setTab(q.t)} className="ezob-lift"
                style={{padding:'12px 14px',borderRadius:12,border:`1px solid ${TK.line}`,cursor:'pointer',background:TK.surface,fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:12,color:TK.ink}}>
                <span style={{width:36,height:36,borderRadius:11,display:'grid',placeItems:'center',background:q.tint,color:q.color,flexShrink:0}}><Ti n={q.icon} s={17}/></span>
                <span style={{flex:1,minWidth:0}}><span style={{display:'block',fontSize:13.5,fontWeight:650}}>{q.title}</span><span style={{display:'block',fontSize:12,color:TK.muted,marginTop:1}}>{q.sub}</span></span>
                <span style={{color:TK.faint,display:'flex'}}><IconChevron size={16}/></span>
              </button>
            ))}
          </div>

          {/* AI alerts */}
          {highRisk > 0 && (
            <div style={{marginTop:14,background: TK.criticalTint,border: `1px solid ${TK.criticalEdge}`,borderRadius:12,padding:'12px 14px'}}>
              <div style={{fontSize:13,fontWeight:700,color: TK.critical,marginBottom:8,display:'flex',alignItems:'center',gap:7}}>
                <Ti n="alert-triangle" s={15}/>
                AI flagged {highRisk} high-risk joining{highRisk>1?'s':''}
              </div>
              {candidates.filter(c=>c.ai_risk==='HIGH').slice(0,3).map(c=>(
                <div key={c.id} style={{fontSize:12.5,color:TK.inkSoft,marginBottom:4,display:'flex',alignItems:'center',gap:8}}>
                  <Avatar name={c.full_name} size={22}/><b style={{fontWeight:650}}>{c.full_name}</b><span style={{color:TK.critical}}>{c.ai_risk_reason}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* This week joiners */}
        <Panel title="Joining this week" sub="Today and the next 7 days" icon="home">
          {candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).length === 0
            ? <Empty icon="home" text="No one is joining in the next 7 days."/>
            : candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).map(c=>{
              const days = daysLeft(c.date_of_joining)!
              const pct  = progressPct(c)
              const sm   = STAGE_META[c.status]
              return (
                <div key={c.id} style={{background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:12,padding:'12px 14px',marginBottom:10,borderLeft:`3px solid ${days<=1?TK.critical:days<=3?TK.warning:P}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                    <div style={{display:'flex',gap:10,alignItems:'center',minWidth:0}}>
                      <Avatar name={c.full_name}/>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13.5,fontWeight:650}}>{c.full_name}</div>
                        <div style={{fontSize:12,color:TK.muted,marginTop:1}}>{c.designation}</div>
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12.5,fontWeight:700,marginBottom:4,color:days<=1?TK.critical:days<=3?TK.warning:P}}>
                        {days===0?'Today!':days===1?'Tomorrow':`D-${days}`}
                      </div>
                      <Badge {...sm} label={sm.label}/>
                    </div>
                  </div>
                  <ProgressBar pct={pct} color={pct===100?TK.positive:days<=3?TK.critical:P}/>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:7,fontSize:12,color:TK.muted}}>
                    <span>{pct}% complete</span>
                    {c.status==='SUBMITTED' && (
                      <button className="ezob-btn" onClick={()=>setReviewing({ id: c.id, readOnly: false })} style={btnSm('primary')}>
                        <Ti n="checklist" s={13}/>Review form
                      </button>
                    )}
                    {c.status==='APPROVED' && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(c)}} disabled={aheadOf(c).length>0} title={fifoTitle(c)} style={{...btnSm('primary'),opacity:aheadOf(c).length?.5:1,cursor:aheadOf(c).length?'not-allowed':'pointer'}}>
                        <Ti n="bolt" s={13}/>{aheadOf(c).length ? 'In queue' : 'Generate code'}
                      </button>
                    )}
                    {c.status==='EMPLOYEE_CREATED' && (
                      <button className="ezob-btn" onClick={()=>setApptFor(c)} style={btnSm(apptSent.has(c.id) ? 'ghost' : 'primary')}>
                        <Ti n="send" s={13}/>{apptSent.has(c.id) ? 'Appointment letter (sent)' : 'Appointment letter'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          }
        </Panel>
      </div>
    </div>
  )

  // ── Row actions: one primary, the rest behind "⋯" ─────────────
  const copyLink = async (c: Candidate) => {
    const link = `${window.location.origin}/onboarding/${c.magic_link_token}`
    try { await navigator.clipboard.writeText(link); showToast('Link copied. Paste it to the candidate.') }
    catch { showToast(`Copy failed. The link is ${link}`, 'err') }
  }
  const viewForm = (c: Candidate): RowAction => ({ label:'View form', onClick:()=>setReviewing({ id:c.id, readOnly:true }) })
  // The same buttons, in the same order, as before the table was tidied; nothing is hidden.
  const actionsFor = (c: Candidate): RowAction[] => {
    const out: RowAction[] = []
    const edit: RowAction = { label:'Edit', hint:'Joining date, email, mobile, notice, hiring track', onClick:()=>openDateEdit(c) }
    const assets = () => {
      if (!c.laptop_issued) out.push({ label:'Issue laptop', kind:'warn', hint:'IT usually confirms it on their checklist', onClick:()=>issueAsset(c.id,'LAPTOP') })
      if (!c.id_card_issued) out.push({ label:'Issue ID card', hint:'Admin usually confirms it on their checklist', onClick:()=>issueAsset(c.id,'ID_CARD') })
    }
    switch (c.status) {
      case 'NOT_INVITED':
        out.push({ label:'Send onboarding link', kind:'primary', icon:'send', onClick:()=>sendOnboardingFor(c), disabled:saving, hint:'Email the onboarding link to the candidate' }, edit)
        break
      case 'INVITED':
      case 'IN_PROGRESS':
        out.push(
          { label:'Link', icon:'copy', hint:'Copy the onboarding link', onClick:()=>copyLink(c) },
          { label: resendingId===c.id ? 'Sending…' : 'Resend', kind:'primary', icon:'send', onClick:()=>resendLink(c), disabled:resendingId===c.id, hint: isReturned(c) ? 'Send the link again with the list of corrections' : 'Mail the link again' },
          { label:'Extend', hint:'+7 days, without mailing it again', onClick:()=>extendValidity(c) },
          edit)
        break
      case 'SUBMITTED':
        out.push({ label:'Review', kind:'primary', icon:'checklist', onClick:()=>setReviewing({ id:c.id, readOnly:false }) })
        break
      case 'HR_REVIEW':
        out.push(viewForm(c))
        break
      case 'APPROVED': {
        const ahead = aheadOf(c)
        out.push({ label: ahead.length ? `In queue · after ${ahead[0].full_name.split(' ')[0]}` : 'Generate code', kind:'primary', icon:'bolt', disabled: ahead.length > 0, onClick:()=>openCodeModal(c),
          hint: ahead.length ? fifoTitle(c) : `IT, Admin and Payroll have approved: the team, ESS roles and the employee code${c.role_assignment?.managers?.l1_name ? ` · reports to ${c.role_assignment.managers.l1_name}` : ''}` })
        if (c.role_assignment?.managers?.l1_name) out.push({ label:`L1 ✓ ${c.role_assignment.managers.l1_name}`, static:true, hint:'Assigned on the review sheet (View form, then Change)' })
        out.push(viewForm(c))
        assets()
        break
      }
      case 'EMPLOYEE_CREATED':
        out.push({ label:'Appointment letter', kind:'primary', icon:'send', onClick:()=>setApptFor(c), hint:'Auto-filled Letter of Appointment: edit it if needed and mail it to the candidate' })
        out.push(viewForm(c))
        assets()
        break
    }
    return out
  }
  const clearFilters = () => { setFilterStage('ALL'); setFilterRisk('ALL'); setJoinWindow('all'); setSearchQ('') }

  // ── ALL CANDIDATES TAB ─────────────────────────────────────────
  const th: React.CSSProperties = {padding:'11px 8px',textAlign:'left',fontSize:11,fontWeight:700,color:TK.faint,textTransform:'uppercase',letterSpacing:'.06em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap',background:TK.sunken}
  const td: React.CSSProperties = {padding:'11px 8px',verticalAlign:'middle'}
  const CandidatesTab = () => {
    const notInvitedShown = filtered.filter(c=>c.status==='NOT_INVITED')
    const allPicked = notInvitedShown.length>0 && notInvitedShown.every(c=>selIds.has(c.id))
    const selCount = notInvitedShown.filter(c=>selIds.has(c.id)).length
    const filtersOn = filterStage!=='ALL' || filterRisk!=='ALL' || joinWindow!=='all' || !!searchQ
    return (
    <div>
      {/* Joining-window filter */}
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:12.5,fontWeight:600,color:TK.muted,marginRight:4,display:'inline-flex',alignItems:'center',gap:6}}><IconCalendar size={14}/>Joining</span>
        {([
          {k:'all',   label:'All'},
          {k:'today', label:'Today'},
          {k:'3days', label:'Next 3 days'},
          {k:'week',  label:'This week'},
          {k:'month', label:'This month'},
        ] as {k:typeof joinWindow;label:string}[]).map(w=>(
          <button key={w.k} onClick={()=>setJoinWindow(w.k)} aria-pressed={joinWindow===w.k}
            className="ezob-pill" style={{height:32,padding:'0 14px',borderRadius:99,border:'1px solid '+(joinWindow===w.k?TK.brandEdge:TK.line),cursor:'pointer',fontSize:12.5,fontWeight:joinWindow===w.k?650:500,fontFamily:'inherit',background:joinWindow===w.k?TK.brandTint:TK.surface,color:joinWindow===w.k?TK.brand:TK.inkSoft}}>
            {w.label}
          </button>
        ))}
      </div>
      {/* Filters: sticky so they stay in reach while the list scrolls, and inside ESS they stop
          BELOW the portal's own top bar (--ob-top, measured by useHostStickyOffset). */}
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center',position:'sticky',top:'var(--ob-top, 0px)',zIndex:30,background:TK.surface,padding:'12px 14px',borderRadius:14,border:`1px solid ${TK.line}`,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Search candidates"
          placeholder="Search name or designation…"
          style={{...inputCss,minWidth:220,flex:'1 1 220px',maxWidth:320}}/>
        <select value={filterStage} onChange={e=>setFilterStage(e.target.value as any)} aria-label="Stage"
          style={{...inputCss,cursor:'pointer'}}>
          <option value="ALL">All stages</option>
          {(Object.keys(STAGE_META) as Stage[]).map(s=><option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <select value={filterRisk} onChange={e=>setFilterRisk(e.target.value as any)} aria-label="Risk"
          style={{...inputCss,cursor:'pointer'}}>
          <option value="ALL">All risk levels</option>
          <option value="HIGH">High risk only</option>
          <option value="MEDIUM">Medium risk</option>
          <option value="LOW">Low risk</option>
        </select>
        {filtersOn && <button type="button" className="ezob-btn is-ghost" onClick={clearFilters} style={{...btnSm('ghost'),height:40,padding:'0 12px',border:'1px solid transparent',color:TK.brand}}>Clear filters</button>}
        <div style={{marginLeft:'auto',fontSize:12.5,color:TK.muted,whiteSpace:'nowrap'}}><b style={{color:TK.ink}}>{filtered.length}</b> of {total} shown</div>
        {notInvitedShown.length > 0 && (
          <button className="ezob-btn is-ghost" onClick={()=>setSelIds(prev=>{ const n=new Set(prev); notInvitedShown.forEach(c=>allPicked?n.delete(c.id):n.add(c.id)); return n })} style={{...btnSm('ghost'),height:40,padding:'0 14px'}}>
            {allPicked ? 'Clear selection' : `Select ${notInvitedShown.length} not invited`}
          </button>
        )}
        {selCount > 0 && (
          <button className="ezob-btn" onClick={bulkSend} disabled={saving} style={{...btnSm('primary'),height:40,padding:'0 14px',opacity:saving?.6:1}}>
            <Ti n="send" s={14}/> Send link to {selCount} selected
          </button>
        )}
      </div>

      {/* Table: seven columns, one line of actions, so it fits a laptop screen without a sideways
          scroll (the scroll stays as a fallback). The approvals cell opens who-has-it on hover / click. */}
      <div style={{border:`1px solid ${TK.line}`,borderRadius:16,overflow:'hidden',background:TK.surface,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
        <div style={{overflowX:'auto'}}>
          <table className="ezob-table" style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:760}}>
            <thead>
              <tr style={{background:TK.sunken}}>
                <th style={{...th,paddingLeft:16}}>Candidate</th>
                <th style={th}>Stage · progress</th>
                <th style={th}>Joining</th>
                <th style={th}>Docs</th>
                <th style={th} title="Hover or click the approvals line to see who approved and who has it now">Statutory · approvals</th>
                <th style={th}>BGV</th>
                <th style={th}>Risk</th>
                <th style={{...th,paddingRight:14}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8}>
                  <Empty icon="users" text={candidates.length === 0 ? 'No onboarding candidates yet.' : 'No candidates match these filters.'}/>
                  {filtersOn && <div style={{textAlign:'center',marginTop:-14,paddingBottom:22}}><button type="button" className="ezob-btn is-ghost" onClick={clearFilters} style={btnSm('ghost')}>Clear filters</button></div>}
                </td></tr>
              )}
              {filtered.map(c=>{
                const returned = isReturned(c)
                const sm  = returned ? RETURNED_META : STAGE_META[c.status]
                const notInvited = c.status==='NOT_INVITED'
                const done = c.status==='EMPLOYEE_CREATED'
                const days = daysLeft(c.date_of_joining)
                const acts = actionsFor(c)
                const reqHave = c.docs_required_have||0, reqTotal = c.docs_required_total||0
                // Colour only when it calls for action: a passed date (still onboarding) or one close by.
                const joinTone = done || days===null ? TK.muted : days<0 ? TK.critical : days<=3 ? TK.warning : TK.muted
                const sub = [c.designation, c.department].filter(Boolean).join(' · ')
                return (
                  <tr key={c.id} style={{borderBottom:`1px solid ${TK.line}`,background:TK.surface}}>
                    <td style={{...td,paddingLeft:16,minWidth:140,maxWidth:230}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                        {/* Not-invited joiners can be picked for a bulk send; the box sits with the name. */}
                        {notInvited && <input type="checkbox" aria-label={`Select ${c.full_name} for the bulk send`} checked={selIds.has(c.id)} onChange={()=>setSelIds(prev=>{ const n=new Set(prev); n.has(c.id)?n.delete(c.id):n.add(c.id); return n })} style={{flex:'none',margin:0}} />}
                        <Avatar name={c.full_name} className="ezob-av"/>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:650,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={c.full_name}>{c.full_name}</div>
                          <div style={{fontSize:12,color:TK.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={sub || undefined}>{sub || 'No designation'}{c.employee_code && <b style={{color:TK.positive,fontWeight:650}}> · {c.employee_code}</b>}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{...td,whiteSpace:'nowrap'}}>
                      <Badge {...sm} label={sm.label} title={returned ? [...(c.hr_review?.documents||[]).map(d=>`${d.label}: ${d.reason}`), ...(c.hr_review?.details||[]).map(d=>`${d.field}: ${d.reason}`)].join('\n') || undefined : undefined}/>
                      <div style={{fontSize:11.5,color:returned?TK.critical:TK.muted,marginTop:4,fontWeight:returned?650:500}}>
                        {returned
                          ? `${(c.hr_review?.documents||[]).length} doc${(c.hr_review?.documents||[]).length===1?'':'s'} · ${(c.hr_review?.details||[]).length} detail${(c.hr_review?.details||[]).length===1?'':'s'} to fix`
                          : c.status==='SUBMITTED' && c.submitted_at ? `Since ${fmt(c.submitted_at)}`
                          : notInvited ? 'From recruitment' : ''}
                      </div>
                      {!notInvited && (() => {
                        const pct = progressPct(c)
                        return <div style={{width:130,marginTop:5}}>
                          <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,color:TK.muted,whiteSpace:'nowrap'}}>
                            <span>Step {Math.max(1,Math.min(c.current_step||1,8))}/8</span><b style={{color:TK.ink,fontWeight:650}}>{pct}%</b>
                          </div>
                          <ProgressBar pct={pct} color={pct===100?TK.positive:pct>=60?P:TK.warning}/>
                        </div>
                      })()}
                    </td>
                    <td style={{...td,whiteSpace:'nowrap',fontSize:12.5}}>
                      {c.date_of_joining ? <>
                        {fmt(c.date_of_joining)}
                        {days !== null && <div style={{fontSize:11.5,fontWeight:!done&&days<=3?650:500,marginTop:1,color:joinTone}}>{done && days<0 ? `Joined ${relDays(days)}` : relLabel(days)}</div>}
                      </> : <span style={{fontSize:12,fontWeight:650,color:TK.warning}}>Not set</span>}
                    </td>
                    <td style={{...td,whiteSpace:'nowrap'}}>
                      {notInvited ? <span style={{fontSize:12,color:TK.faint}}>-</span> : <>
                        <span title={`${reqHave} of the ${reqTotal} required documents uploaded`} style={{fontSize:12,fontWeight:650,padding:'2px 8px',borderRadius:8,background:reqTotal&&reqHave>=reqTotal?TK.positiveTint:TK.sunken,color:reqTotal&&reqHave>=reqTotal?TK.positive:TK.inkSoft}}>{reqHave}/{reqTotal} required</span>
                        <div style={{fontSize:11.5,color:TK.muted,marginTop:4}} title={(c.docs_ai_flagged||0)>0 ? 'Flagged = the AI check could not read the document or found a mismatch. HR decides on the review sheet.' : undefined}>
                          {c.docs_uploaded||0} file{(c.docs_uploaded||0)===1?'':'s'}
                          {(c.docs_rejected||0)>0 ? <span style={{color:TK.critical,fontWeight:600}}> · {c.docs_rejected} rejected</span>
                            : (c.docs_ai_flagged||0)>0 && !done ? <span style={{color:TK.warning,fontWeight:600}}> · {c.docs_ai_flagged} flagged</span> : null}
                        </div>
                      </>}
                    </td>
                    <td style={td}>
                      {notInvited ? <span style={{fontSize:12,color:TK.faint}}>-</span> : (
                        <div style={{display:'grid',gridTemplateColumns:'repeat(3,auto)',gap:4,justifyContent:'start'}}>
                          {([['F11','EPF Form 11',c.form11],['F2','EPF Form 2',c.form2],['Bank','Bank details',c.bank],['Policy','Policy acknowledgement',c.policy_ack],['Laptop','Laptop',c.laptop_issued],['ID','ID card',c.id_card_issued]] as [string,string,boolean|undefined][]).map(([l,full,ok])=>(
                            <span key={l} title={`${full}: ${ok?'done':'pending'}`} style={{fontSize:11,padding:'2px 7px',whiteSpace:'nowrap',borderRadius:7,fontWeight:650,display:'inline-flex',alignItems:'center',gap:3,
                              background:ok?TK.positiveTint:TK.sunken,color:ok?TK.positive:TK.faint,border:`1px solid ${ok?TK.positiveEdge:TK.line}`}}>
                              {ok && <IconCheck size={10} strokeWidth={3}/>}{l}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Where the IT / Admin / Payroll / HR Mgr ticks used to be: the summary, with
                          who approved and who has it now on hover or click. */}
                      {(c.status==='SUBMITTED'||c.status==='HR_REVIEW'||c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && (
                        <div style={{marginTop:6}}>{approvalsCellFor(c)}</div>
                      )}
                    </td>
                    <td style={td}><span style={{fontSize:12,color:TK.faint,whiteSpace:'nowrap'}}>Not started</span></td>
                    <td style={{...td,whiteSpace:'nowrap'}}>{done ? <span style={{fontSize:12,color:TK.faint}}>-</span> : <RiskBadge risk={c.ai_risk} reason={c.ai_risk_reason} short/>}</td>
                    <td style={{...td,paddingRight:14}}>
                      <RowActions actions={acts}/>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:12,color:TK.muted,marginTop:10,lineHeight:1.6}}>
        The HR Manager reviews the submitted form, IT, Admin and Payroll then confirm their checklists (ESS → HRIS → Tasks &amp; Approvals), and the HR Manager generates the code. Hover or click a row&apos;s approvals to see who has it.
        {filterStage!=='EMPLOYEE_CREATED' && doneHidden>0 && <> Completed onboardings (code generated and appointment letter sent) are hidden: <button type="button" onClick={()=>setFilterStage('EMPLOYEE_CREATED')} style={{border:'none',background:'none',padding:0,color:TK.brand,fontWeight:600,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit'}}>show {doneHidden}</button>.</>}
      </div>
    </div>
    )
  }

  // ── PENDING ACTIONS TAB ────────────────────────────────────────
  const PendingTab = () => {
    const groups: Record<string, typeof pendingActions> = {
      HIGH:   pendingActions.filter(a=>a.priority==='HIGH'),
      MEDIUM: pendingActions.filter(a=>a.priority==='MEDIUM'),
      LOW:    pendingActions.filter(a=>a.priority==='LOW'),
    }
    const gMeta = {
      HIGH:   {label:'Urgent: do today',     bg: TK.criticalTint, color:TK.critical, border: TK.criticalTint},
      MEDIUM: {label:'Important: this week',  bg:TK.warningTint, color:TK.warning, border: TK.warningTint},
      LOW:    {label:'When possible',          bg: TK.brandTint, color: TK.brand, border: TK.brandEdge},
    }
    return (
      <div>
        <SH title="Pending actions" sub="Priority-sorted. Resolve High first."/>
        {pendingActions.length === 0 && (
          <Empty icon="circle-check" tone="ok" text="All clear. Nothing is waiting on you."/>
        )}
        {(['HIGH','MEDIUM','LOW'] as const).map(pri => groups[pri].length > 0 && (
          <div key={pri} style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:gMeta[pri].color,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10,display:'flex',alignItems:'center',gap:7}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:gMeta[pri].color,flexShrink:0}}/>
              {gMeta[pri].label} ({groups[pri].length})
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {groups[pri].map((a,i)=>{
                const cand = candidates.find(c=>c.id===a.cid)
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 16px',background:TK.surface,borderRadius:14,border:`1px solid ${TK.line}`,borderLeft:`4px solid ${gMeta[pri].color}`,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
                    <span style={{width:36,height:36,borderRadius:11,display:'grid',placeItems:'center',background:gMeta[pri].bg,color:gMeta[pri].color,flexShrink:0}}>
                      <Ti n={a.action==='appt'?'send':a.action==='generate'?'bolt':a.action==='review'?'file-alert':a.action==='followup'||a.action==='send'||a.action==='returned'?'send':a.action==='policy'?'list-check':'shield-check'} s={17}/>
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13.5,fontWeight:650,color:TK.ink}}>{a.label}</div>
                      <div style={{fontSize:12.5,color:TK.muted,marginTop:2}}>
                        <Ti n="user" s={11}/>{a.candidate}
                        {cand?.date_of_joining ? <span style={{marginLeft:8}}>· Joining {fmt(cand.date_of_joining)}</span> : cand && <span style={{marginLeft:8,color:TK.warning}}>· No joining date</span>}
                      </div>
                    </div>
                    {a.action==='generate' && cand && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(cand)}} disabled={aheadOf(cand).length>0} title={fifoTitle(cand)} style={{...btnSm('primary'),height:34,opacity:aheadOf(cand).length?.5:1,cursor:aheadOf(cand).length?'not-allowed':'pointer'}}>
                        <Ti n="bolt" s={12}/>{aheadOf(cand).length ? 'In queue' : 'Generate code'}
                      </button>
                    )}
                    {a.action==='appt' && cand && (
                      <button className="ezob-btn" onClick={()=>setApptFor(cand)} style={{...btnSm('primary'),height:34}}>
                        <Ti n="send" s={12}/>Appointment letter
                      </button>
                    )}
                    {a.action==='review' && cand && (
                      <button className="ezob-btn" onClick={()=>setReviewing({ id: cand.id, readOnly: false })} style={{...btnSm('primary'),height:34}}>
                        <Ti n="checklist" s={12}/>Review form
                      </button>
                    )}
                    {a.action==='send' && cand && (
                      <button className="ezob-btn" onClick={()=>sendOnboardingFor(cand)} disabled={saving} style={{...btnSm('primary'),height:34,opacity:saving?.6:1}}>
                        <Ti n="send" s={12}/>Send link
                      </button>
                    )}
                    {a.action==='approvals' && cand && approvalsCellFor(cand)}
                    {(a.action==='followup'||a.action==='returned') && cand && (
                      <button className="ezob-btn" onClick={()=>resendLink(cand)} disabled={resendingId===cand.id} style={{...btnSm('primary'),height:34,opacity:resendingId===cand.id?.6:1}}>
                        <Ti n="send" s={12}/>{resendingId===cand.id ? 'Sending…' : 'Resend link'}
                      </button>
                    )}
                    {a.action==='followup' && cand && (
                      <button onClick={()=>copyLink(cand)} className="ezob-btn is-ghost" style={{...btnSm('ghost'),height:34}}>
                        <Ti n="copy" s={12}/>Copy link
                      </button>
                    )}
                    {(a.action==='laptop'||a.action==='idcard') && cand && (
                      <button className="ezob-btn is-ghost" onClick={()=>issueAsset(cand.id,a.action==='laptop'?'LAPTOP':'ID_CARD')} style={{...btnSm('ghost'),height:34}}>
                        Mark issued
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── AI INSIGHTS TAB ────────────────────────────────────────────
  const InsightsTab = () => {
    const atRisk = candidates.filter(c=>c.ai_risk==='HIGH'||c.ai_risk==='MEDIUM')
    const champs = candidates.filter(c=>progressPct(c)===100)
    // Only while someone still has to act on them, not for employees already created.
    const flaggedDocs = candidates.filter(c=>(c.docs_ai_flagged||0)>0 && c.status!=='EMPLOYEE_CREATED')
    return (
      <div>
        <SH title="AI insights" sub="Powered by EZER AI, updated on load"/>

        {/* Attrition risk */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:TK.criticalTint,color:TK.critical}}><Ti n="alert-triangle" s={15}/></span>
            At-risk joiners <span style={{color:TK.faint,fontWeight:600}}>{atRisk.length}</span>
          </div>
          {atRisk.length===0
            ? <Empty icon="circle-check" tone="ok" text="No at-risk joiners right now."/>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:12}}>{atRisk.map(c=>(
              <div key={c.id} className="ezob-lift" style={{background:TK.surface,border:`1px solid ${c.ai_risk==='HIGH'?TK.criticalEdge:TK.warningEdge}`,borderRadius:14,padding:'14px 16px',borderTop:`3px solid ${c.ai_risk==='HIGH'?TK.critical:TK.warning}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                  <div style={{display:'flex',gap:10,minWidth:0}}>
                    <Avatar name={c.full_name}/>
                    <div style={{minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:650,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>{c.full_name} <RiskBadge risk={c.ai_risk}/></div>
                    <div style={{fontSize:12,color:TK.muted,marginTop:2}}>{c.designation || 'No designation'} · {c.date_of_joining ? `Joins ${fmt(c.date_of_joining)}` : 'No joining date'}</div>
                    <div style={{fontSize:12.5,color:c.ai_risk==='HIGH'?TK.critical:TK.warning,marginTop:6,fontWeight:600,display:'flex',alignItems:'center',gap:5}}>
                      <Ti n="robot" s={12}/>
                      {c.ai_risk_reason}
                    </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    {c.status==='SUBMITTED' && (
                      <button className="ezob-btn" onClick={()=>setReviewing({ id: c.id, readOnly: false })} style={btnSm('primary')}>Review form</button>
                    )}
                    {c.status==='APPROVED' && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(c)}} disabled={aheadOf(c).length>0} title={fifoTitle(c)} style={{...btnSm('primary'),opacity:aheadOf(c).length?.5:1,cursor:aheadOf(c).length?'not-allowed':'pointer'}}>{aheadOf(c).length ? 'In queue' : 'Generate code'}</button>
                    )}
                  </div>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:TK.muted,marginTop:10}}><span>Progress</span><b style={{color:TK.ink}}>{progressPct(c)}%</b></div>
                <ProgressBar pct={progressPct(c)} color={c.ai_risk==='HIGH'?TK.critical:TK.warning}/>
              </div>
            ))}</div>
          }
        </div>

        {/* Document AI flags */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:10,display:'flex',alignItems:'center',gap:8,marginTop:22}}>
            <span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:TK.warningTint,color:TK.warning}}><Ti n="file-alert" s={15}/></span>
            Documents flagged for review <span style={{color:TK.faint,fontWeight:600}}>{flaggedDocs.length}</span>
          </div>
          {flaggedDocs.length===0
            ? <Empty icon="circle-check" tone="ok" text="Every uploaded document passed the AI check."/>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:10}}>{flaggedDocs.map(c=>(
              <div key={c.id} style={{display:'flex',gap:12,alignItems:'center',background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:12,padding:'12px 14px'}}>
                <Avatar name={c.full_name}/>
                <div style={{minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:650}}>{c.full_name}</div>
                <div style={{fontSize:12.5,color:TK.warning,marginTop:2,fontWeight:600}}>
                  <Ti n="robot" s={11}/>
                  {c.docs_ai_flagged} document{c.docs_ai_flagged===1?'':'s'} need a manual look
                </div>
                </div>
              </div>
            ))}</div>
          }
        </div>

        {/* Onboarding champions */}
        <div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:10,display:'flex',alignItems:'center',gap:8,marginTop:22}}>
            <span style={{width:28,height:28,borderRadius:8,display:'grid',placeItems:'center',background:TK.positiveTint,color:TK.positive}}><Ti n="star" s={15}/></span>
            Fully complete <span style={{color:TK.faint,fontWeight:600}}>{champs.length}</span>
          </div>
          {champs.length===0
            ? <Empty icon="star" text="No one has completed every step yet."/>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:10}}>
              {champs.map(c=>(
                <div key={c.id} style={{background: TK.surface,border: `1px solid ${TK.positiveEdge}`,borderRadius:14,padding:'14px 12px',textAlign:'center'}}>
                  <div style={{width:40,height:40,borderRadius:'50%',background:TK.positive,color:TK.onAccent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,margin:'0 auto 8px'}}>
                    {c.full_name.charAt(0)}
                  </div>
                  <div style={{fontSize:13.5,fontWeight:650,color: TK.ink}}>{c.full_name}</div>
                  <div style={{fontSize:12,color:TK.positive,marginTop:2,fontWeight:600}}>{c.employee_code||'Code pending'}</div>
                </div>
              ))}
            </div>
          }
        </div>
      </div>
    )
  }

  // ── COMPLIANCE TAB ─────────────────────────────────────────────
  const ComplianceTab = () => {
    // Recruitment joiners who have not been sent the link have nothing to track yet (and no
    // onboarding record an Issue could be written to).
    const rows = candidates.filter(c=>c.status!=='NOT_INVITED')
    const active = rows.filter(c=>c.status!=='EMPLOYEE_CREATED')
    // Called as a function, not mounted as <Tick/>: a component declared in here would be a new
    // type on every render.
    const tick = (done: boolean|undefined, what: string) => (
      <span title={`${what}: ${done?'done':'pending'}`} style={{width:26,height:26,borderRadius:8,display:'inline-grid',placeItems:'center',background:done?TK.positiveTint:TK.warningTint,color:done?TK.positive:TK.warning}}>
        {done ? <IconCheck size={14} strokeWidth={2.6}/> : <IconClock size={14} strokeWidth={2}/>}
      </span>
    )
    return (
      <div>
        <SH title="Compliance tracker" sub="PF, bank, policies and assets for every onboarding that has started. The counts are for the ones still in progress."/>

        {/* Summary row */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18}}>
          {[
            {label:'Form 11 pending', val:active.filter(c=>!c.form11).length, color:TK.warning},
            {label:'Form 2 pending',  val:active.filter(c=>!c.form2).length,  color:TK.warning},
            {label:'Bank pending',    val:active.filter(c=>!c.bank).length,   color:TK.warning},
            {label:'Policy pending',  val:active.filter(c=>!c.policy_ack).length, color: TK.brand},
            {label:'Laptop pending',  val:active.filter(c=>!c.laptop_issued).length, color:P},
            {label:'ID card pending', val:active.filter(c=>!c.id_card_issued).length, color:P},
          ].map(({label,val})=>(
            <StatCard key={label} label={label} val={val} color={val>0?TK.warning:TK.positive} tint={val>0?TK.warningTint:TK.positiveTint} icon={val>0?'clock':'circle-check'}/>
          ))}
        </div>

        {/* Immigration & overseas: foreign nationals in India and overseas employees, with their dated items */}
        <ImmigrationTracker/>

        {/* Compliance grid */}
        <div style={{border:`1px solid ${TK.line}`,borderRadius:16,overflow:'hidden',background:TK.surface,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
          <div style={{overflowX:'auto'}}>
            <table className="ezob-table" style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:TK.sunken}}>
                  {['Employee','Joining','EPF Form 11','EPF Form 2','Bank','Policy ack','Laptop','ID card','PT state','BGV'].map(h=>(
                    <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:TK.faint,textTransform:'uppercase',letterSpacing:'.06em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap',background:TK.sunken}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length===0 && (
                  <tr><td colSpan={10}><Empty icon="users" text="No onboarding has started yet."/></td></tr>
                )}
                {rows.map(c=>{
                  const ptState = (c.form_data as any)?.step_4?.perm_state || '-'
                  return (
                    <tr key={c.id} style={{borderBottom:`1px solid ${TK.line}`,background:TK.surface}}>
                      <td style={{padding:'11px 14px',minWidth:190}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <Avatar name={c.full_name} size={32}/>
                          <div style={{minWidth:0}}>
                            <div style={{fontWeight:650}}>{c.full_name}</div>
                            <div style={{fontSize:12,color:TK.muted}}>{c.designation||'No designation'}{c.employee_code && <b style={{color:TK.positive,fontWeight:650}}> · {c.employee_code}</b>}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'11px 14px',whiteSpace:'nowrap'}}>{fmt(c.date_of_joining)}</td>
                      <td style={{padding:'11px 14px'}}>{tick(c.form11,'EPF Form 11')}</td>
                      <td style={{padding:'11px 14px'}}>{tick(c.form2,'EPF Form 2')}</td>
                      <td style={{padding:'11px 14px'}}>{tick(c.bank,'Bank mandate')}</td>
                      <td style={{padding:'11px 14px'}}>{tick(c.policy_ack,'Policy acknowledgement')}</td>
                      <td style={{padding:'11px 14px'}}>
                        {c.laptop_issued
                          ? <span style={{fontSize:12,color:TK.positive,fontWeight:650}}>Issued</span>
                          : <button className="ezob-btn is-ghost" onClick={()=>issueAsset(c.id,'LAPTOP')} title="Mark the laptop issued" style={{...btnSm('ghost'),height:26}}>Mark issued</button>
                        }
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        {c.id_card_issued
                          ? <span style={{fontSize:12,color:TK.positive,fontWeight:650}}>Issued</span>
                          : <button className="ezob-btn is-ghost" onClick={()=>issueAsset(c.id,'ID_CARD')} title="Mark the ID card issued" style={{...btnSm('ghost'),height:26}}>Mark issued</button>
                        }
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12.5,color:TK.inkSoft}}>{ptState}</td>
                      <td style={{padding:'11px 14px',whiteSpace:'nowrap'}} title="Background verification is not tracked in EZER yet">
                        <span style={{fontSize:12,color:TK.faint}}>Not tracked</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────────
  const TABS: {key:Tab; icon:string; label:string; badge?:number}[] = [
    {key:'overview',    icon:'home',        label:'Overview'},
    {key:'candidates',  icon:'users',       label:'All candidates', badge:total-joined},
    {key:'pending',     icon:'list-check',  label:'Pending actions', badge:pendingActions.filter(a=>a.priority==='HIGH').length||undefined},
    {key:'insights',    icon:'brain',       label:'AI insights',    badge:highRisk||undefined},
    {key:'compliance',  icon:'shield-check',label:'Compliance'},
  ]

  return (
    <div ref={rootRef} className="ezob" style={{background:TK.canvas,minHeight:'100vh',fontFamily:'"DM Sans","Segoe UI",sans-serif',color:TK.ink}}>

      {/* Header */}
      {/* Header — the shared band, so this page reads like the other 31.
          It used to be a saturated blue gradient with white text. The tabs sat
          ON that gradient, which is why they had to move: on a light band a
          translucent white outline has nothing to hold against. They are the
          same outlined pills the ATS uses now, below the band rather than
          inside it. */}
      <div style={{padding:'16px 24px 0'}}>
        <div className="ez-page-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:24,fontWeight:700,color:TK.ink,letterSpacing:'-.02em'}}>Onboarding</div>
            <div style={{fontSize:13.5,color:TK.muted,marginTop:4,display:'flex',gap:14,flexWrap:'wrap'}}>
              <span><b style={{color:TK.ink}}>{active}</b> in progress</span>
              <span><b style={{color:TK.ink}}>{thisWeek}</b> joining this week</span>
              {awaitingReview>0 && <span style={{color:TK.warning,fontWeight:600}}>{awaitingReview} awaiting HR review</span>}
              {submitted>0 && <span style={{color:TK.brand,fontWeight:600}}>{submitted} awaiting employee code</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>setLinkModal(true)} className="ez-press" style={{height:40,padding:'0 16px',borderRadius:11,cursor:'pointer',background:TK.surface,border:`1px solid ${TK.lineStrong}`,color:TK.inkSoft,fontSize:13,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:7}}>
              <IconPlus size={15}/> Add candidate
            </button>
            <button onClick={()=>showList({ stage: notInvitedCount ? 'NOT_INVITED' : 'ALL' })} title="Recruitment joiners who have not been sent the onboarding link" className="ez-press" style={{height:40,padding:'0 16px',borderRadius:11,cursor:'pointer',background:TK.brand,border:`1px solid ${TK.brand}`,color:TK.onAccent,fontSize:13,fontWeight:650,fontFamily:'inherit',display:'flex',alignItems:'center',gap:7}}>
              <Ti n="send" s={15}/> Send onboarding links{notInvitedCount ? ` · ${notInvitedCount}` : ''}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{paddingBottom:4}}>
          <div className="ezob-tabs" role="tablist">
          {TABS.filter(t=>canSeeScreen(grant,'onboarding.'+t.key)).map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} role="tab" aria-selected={tab===t.key} data-on={tab===t.key ? '1' : '0'}>
              <Ti n={t.icon} s={15}/>
              {t.label}
              {t.badge!==undefined && t.badge > 0 && (
                <span style={{fontSize:11,padding:'1px 7px',borderRadius:99,background: t.key==='pending' ? TK.critical : (tab===t.key ? TK.brandTint : TK.surface),color: t.key==='pending' ? TK.onAccent : (tab===t.key ? TK.brand : TK.muted),fontWeight:700,minWidth:18,textAlign:'center',border: t.key==='pending' ? 'none' : `1px solid ${TK.line}`}}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
        {loading
          ? <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>{[0,1,2,3,4,5].map(i=><div key={i} style={{height:104,borderRadius:16,background:TK.sunken,border:`1px solid ${TK.line}`}}/>)}</div>
          : <>
            {/* Called as functions (not <Tab/>) so they render inline and don't
                remount on every keystroke — keeps search-input focus. */}
            {tab==='overview'    && OverviewTab()}
            {tab==='candidates'  && CandidatesTab()}
            {tab==='pending'     && PendingTab()}
            {tab==='insights'    && InsightsTab()}
            {tab==='compliance'  && ComplianceTab()}
          </>
        }
      </div>

      {/* ── SEND ONBOARDING LINK MODAL ────────────────────────────── */}
      {linkModal && (
        <div onMouseDown={e=>{ if (e.target===e.currentTarget && !saving) setLinkModal(false) }} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div role="dialog" aria-modal="true" aria-label="Send a joining link" style={{background:TK.surface,borderRadius:18,padding:'22px 24px',width:'100%',maxWidth:560,boxShadow:E.overlay,maxHeight:'90vh',overflowY:'auto',border:`1px solid ${TK.line}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div><div style={{fontSize:18,fontWeight:700}}>Send a joining link</div><div style={{fontSize:13,color:TK.muted,marginTop:2}}>The candidate gets an email with a secure link to complete their joining forms.</div></div>
              <button onClick={()=>setLinkModal(false)} style={{border:`1px solid ${TK.line}`,background:TK.surface,cursor:'pointer',fontSize:18,color:TK.muted,lineHeight:1,width:32,height:32,borderRadius:9,flexShrink:0}} aria-label="Close">×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div style={{marginBottom:8,gridColumn:'1 / -1'}}>
                <div style={labelCss}>Company *</div>
                <select value={newForm.company_id} onChange={e=>setNewForm(f=>({...f,company_id:e.target.value}))}
                  style={{...inputCss,width:'100%'}}>
                  <option value="">Select company…</option>
                  {companies.map(co=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
                </select>
              </div>
              {[
                {label:'Full Name *',       key:'full_name',      type:'text', placeholder:'As per Aadhaar'},
                {label:'Mobile *',          key:'mobile',         type:'tel',  placeholder:'10-digit mobile'},
                {label:'Email *',           key:'email',          type:'email',placeholder:'personal@email.com'},
                {label:'Designation *',     key:'designation',    type:'text', placeholder:'e.g. Software Engineer'},
                {label:'Date of Joining *', key:'date_of_joining',type:'date', placeholder:''},
                {label:'Offered CTC (₹)',   key:'offered_ctc',    type:'number',placeholder:'e.g. 800000'},
                {label:'Notice period (days)', key:'notice_period_days', type:'number', placeholder:'blank = offer / company default'},
              ].map(({label,key,type,placeholder})=>(
                <div key={key} style={{marginBottom:8}}>
                  <div style={labelCss}>{label}</div>
                  <input type={type} placeholder={placeholder} value={(newForm as any)[key]} onChange={e=>setNewForm(f=>({...f,[key]: key==='mobile' ? maskMobile(e.target.value) : e.target.value}))}
                    style={{...inputCss,width:'100%'}}/>
                </div>
              ))}
              <div style={{marginBottom:8}}>
                <div style={labelCss}>Department *</div>
                <select value={newForm.department_id} onChange={e=>{ const d = departments.find(x=>x.id===e.target.value); setNewForm(f=>({...f, department_id:e.target.value, department: d?.dept_name || ''})) }}
                  style={{...inputCss,width:'100%'}}>
                  <option value="">Select department…</option>
                  {departments.filter(d=>!newForm.company_id||d.company_id===newForm.company_id).map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8}}>
                <div style={labelCss}>Work location{newForm.hiring_track === 'OVERSEAS' ? '' : ' *'}</div>
                <select value={newForm.location_id} onChange={e=>setNewForm(f=>({...f, location_id:e.target.value}))}
                  style={{...inputCss,width:'100%'}}>
                  <option value="">Select work location…</option>
                  {locations.filter(l=>!newForm.company_id||l.company_id===newForm.company_id).map(l=><option key={l.id} value={l.id}>{l.location_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8}}>
                <div style={labelCss}>Employment Type *</div>
                <select value={newForm.employment_type} onChange={e=>setNewForm(f=>({...f,employment_type:e.target.value}))}
                  style={{...inputCss,width:'100%'}}>
                  <option>Employee</option><option>Intern</option><option>Consultant</option><option>Contract</option><option>NAPS</option><option>NATS</option>
                </select>
              </div>
              {/* The hiring track (lib/onboarding/hiring-track.ts): decides the portal's steps and documents, the statutory treatment and the payroll. */}
              <div style={{marginBottom:8,gridColumn:'1 / -1'}}>
                <div style={labelCss}>Hiring track *</div>
                <select value={newForm.hiring_track} onChange={e=>setNewForm(f=>({...f,hiring_track:e.target.value, work_country: e.target.value==='OVERSEAS' ? f.work_country : 'India', payroll_currency: e.target.value==='OVERSEAS' ? (f.payroll_currency==='INR' ? '' : f.payroll_currency) : 'INR'}))}
                  style={{...inputCss,width:'100%'}}>
                  {TRACKS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <div style={{fontSize:11.5,color:TK.muted,marginTop:4}}>{TRACKS.find(t=>t.value===newForm.hiring_track)?.hint}</div>
              </div>
              {newForm.hiring_track==='OVERSEAS' && (
                <>
                  <div style={{marginBottom:8}}>
                    <div style={labelCss}>Work country *</div>
                    <input type="text" placeholder="e.g. United Kingdom" value={newForm.work_country} onChange={e=>setNewForm(f=>({...f,work_country:e.target.value}))} style={{...inputCss,width:'100%'}}/>
                  </div>
                  <div style={{marginBottom:8}}>
                    <div style={labelCss}>Payroll currency</div>
                    <input type="text" placeholder="e.g. GBP" maxLength={3} value={newForm.payroll_currency} onChange={e=>setNewForm(f=>({...f,payroll_currency:e.target.value.toUpperCase()}))} style={{...inputCss,width:'100%'}}/>
                  </div>
                  <div style={{marginBottom:8,gridColumn:'1 / -1'}}>
                    <div style={labelCss}>Employing entity / EOR partner</div>
                    <input type="text" placeholder="e.g. EZER UK Ltd, or Deel / Remote" value={newForm.employing_entity} onChange={e=>setNewForm(f=>({...f,employing_entity:e.target.value}))} style={{...inputCss,width:'100%'}}/>
                  </div>
                </>
              )}
            </div>
            <div style={{background:TK.brandTint,border:`1px solid ${TK.brandEdge}`,borderRadius:12,padding:'11px 14px',marginTop:6,fontSize:12.5,color: TK.brandDeep,lineHeight:1.6,display:'flex',gap:9}}>
              <span style={{flexShrink:0,marginTop:1}}><Ti n="info-circle" s={14}/></span>
              <span>A secure onboarding link is generated and emailed to the candidate. You can also copy it and share it on WhatsApp. They verify with an OTP before starting.</span>
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setLinkModal(false)} style={{...btnSm('ghost'),height:42,padding:'0 18px',fontSize:13}}>Cancel</button>
              <button onClick={sendMagicLink} disabled={saving} style={{...btnSm('primary'),flex:1,justifyContent:'center',height:42,fontSize:13.5,opacity:saving?.6:1}}>
                {saving ? 'Generating...' : 'Generate & send onboarding link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT ONBOARDING DATE MODAL ───────────────────────── */}
      {dateModal && (
        <div onMouseDown={e=>{ if (e.target===e.currentTarget && !saving) setDateModal(null) }} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div role="dialog" aria-modal="true" aria-label={`Edit ${dateModal.full_name}`} style={{background:TK.surface,borderRadius:18,padding:'22px 24px',width:'100%',maxWidth:440,boxShadow:E.overlay,border:`1px solid ${TK.line}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700}}>Edit {dateModal.full_name}</div>
              <button onClick={()=>setDateModal(null)} style={{border:`1px solid ${TK.line}`,background:TK.surface,cursor:'pointer',fontSize:18,color:TK.muted,lineHeight:1,width:32,height:32,borderRadius:9,flexShrink:0}} aria-label="Close">×</button>
            </div>
            <div style={labelCss}>Date of joining *</div>
            <input type="date" value={dateVal} onChange={e=>setDateVal(e.target.value)}
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Email{dateModal.recruitment_id ? '' : ' *'}</div>
            <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder="candidate@email.com"
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Mobile</div>
            <input type="tel" inputMode="numeric" maxLength={10} value={editMobile} onChange={e=>setEditMobile(maskMobile(e.target.value))} placeholder="10-digit mobile"
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Notice period (days)</div>
            <input type="number" min={0} value={editTrack.notice_period_days} onChange={e=>setEditTrack(t=>({...t,notice_period_days:e.target.value}))} placeholder="blank = from the offer, else company default"
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Hiring track</div>
            <select value={editTrack.hiring_track} disabled={dateModal.status!=='NOT_INVITED'&&dateModal.status!=='INVITED'} onChange={e=>setEditTrack(t=>({...t,hiring_track:e.target.value}))} style={{...inputCss,width:'100%',marginBottom:4}}>
              {TRACKS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{fontSize:11.5,color:TK.muted,marginBottom:12}}>{dateModal.status!=='NOT_INVITED'&&dateModal.status!=='INVITED' ? 'The track is fixed once the candidate has started the form.' : TRACKS.find(t=>t.value===editTrack.hiring_track)?.hint}</div>
            {editTrack.hiring_track==='OVERSEAS' && (
              <>
                <div style={labelCss}>Work country *</div>
                <input type="text" value={editTrack.work_country} onChange={e=>setEditTrack(t=>({...t,work_country:e.target.value}))} placeholder="e.g. United Kingdom" style={{...inputCss,width:'100%',marginBottom:12}}/>
                <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:10}}>
                  <div><div style={labelCss}>Currency</div><input type="text" maxLength={3} value={editTrack.payroll_currency} onChange={e=>setEditTrack(t=>({...t,payroll_currency:e.target.value.toUpperCase()}))} placeholder="GBP" style={{...inputCss,width:'100%'}}/></div>
                  <div><div style={labelCss}>Employing entity / EOR</div><input type="text" value={editTrack.employing_entity} onChange={e=>setEditTrack(t=>({...t,employing_entity:e.target.value}))} placeholder="EZER UK Ltd / Deel" style={{...inputCss,width:'100%'}}/></div>
                </div>
              </>
            )}
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setDateModal(null)} style={{...btnSm('ghost'),height:42,padding:'0 18px',fontSize:13}}>Cancel</button>
              <button onClick={saveDate} disabled={saving} style={{...btnSm('primary'),flex:1,justifyContent:'center',height:42,fontSize:13.5,opacity:saving?.6:1}}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── GENERATE CODE (after the three heads approve): the team, the ESS roles, the code ── */}
      {codeModal && (
        <GenerateCodeModal onboardingId={codeModal.id}
          candidate={{ ...codeModal, approvals: ['HR_MANAGER','IT','ADMIN','PAYROLL'].map(team => ({ team, status: (codeModal.approvals||[]).find(a=>a.team===team)?.status || 'PENDING' })) }}
          onClose={() => setCodeModal(null)}
          onDone={(m,t)=>{ showToast(m,t); load() }}
          onGenerated={() => { const c = codeModal; if (c) setApptFor({ ...c, status: 'EMPLOYEE_CREATED' }) }} />
      )}

      {/* ── LETTER OF APPOINTMENT (after the code): auto-filled, editable, mailed to the candidate ── */}
      {apptFor && (
        <AppointmentLetterModal onboardingId={apptFor.id} name={apptFor.full_name}
          onClose={() => setApptFor(null)}
          onDone={(m,t)=>{ showToast(m,t); load() }} />
      )}

      {/* ── HR MANAGER REVIEW (Review form / View form on the card) ── */}
      {reviewing && (
        <ReviewDrawer onboardingId={reviewing.id} readOnly={reviewing.readOnly}
          onClose={()=>setReviewing(null)}
          onDone={(m,t)=>{ showToast(m, t); load() }} />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    </div>
  )
}
