// app/dashboard/onboarding/page.tsx
// EZER HRMS — Onboarding Admin Dashboard
// 5 tabs: Overview | All Candidates | Pending Actions | AI Insights | Compliance
'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { canSeeScreen } from '@/lib/rms/resolve'
import { companyFilter, scopedCompanies, defaultCompanyId } from '@/lib/rms/resolve'
// send-magic-link / resend-link are guarded server-side now, so the session goes along.
import { authHeaders } from '@/lib/auth-headers'
import RoleAssignmentModal from '@/components/onboarding/RoleAssignmentModal'
import GenerateCodeModal from '@/components/onboarding/GenerateCodeModal'
import ReviewDrawer from '@/components/onboarding/ReviewDrawer'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import {
  C as TK, R, E, IconChevron, IconMail, IconPolicies, IconCompliance, IconAlert, IconUser, IconCheck,
  IconAi, IconLetters, IconClock, IconHome, IconEmployees, IconCalendar, IconPlus, IconUpload,
} from '@/lib/ui'
import './onboarding-hr.css'

// ── Types ─────────────────────────────────────────────────────────
type Stage = 'NOT_INVITED'|'INVITED'|'IN_PROGRESS'|'SUBMITTED'|'HR_REVIEW'|'APPROVED'|'EMPLOYEE_CREATED'
type RiskLevel = 'LOW'|'MEDIUM'|'HIGH'
type Tab = 'overview'|'candidates'|'pending'|'insights'|'compliance'

interface Candidate {
  approvals?: { team: string; status: string }[]
  /** The HR Manager's Role assignment (after IT, Admin and Payroll approve): role, permissions snapshot, L1 / L2 / HOD. Required before Generate code. */
  role_assignment?: { role_id: string; role_code: string; role_name: string; permissions?: { module: string; access_level: string }[]; l1_name?: string | null; l2_name?: string | null; hod_name?: string | null; by_name?: string | null; at?: string } | null
  l1_manager_id?: string | null; l2_manager_id?: string | null
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
const STAGE_META: Record<Stage, {label:string; bg:string; color:string}> = {
  NOT_INVITED:      { label:'Not invited',       bg: TK.sunken, color:TK.muted },
  INVITED:          { label:'Link sent',        bg:TK.warningTint, color:TK.warning },
  IN_PROGRESS:      { label:'In progress',      bg: TK.brandTint, color: TK.brand },
  SUBMITTED:        { label:'Submitted',         bg:TK.brandTint, color:P        },
  HR_REVIEW:        { label:'HR accepted · with teams', bg:TK.infoTint, color:TK.info },
  APPROVED:         { label:'Teams approved',    bg:TK.positiveTint, color:TK.positive },
  EMPLOYEE_CREATED: { label:'Employee created',  bg: TK.sunken, color: TK.positive },
}
const TEAM_SHORT: Record<string,string> = { IT:'IT', ADMIN:'Admin', PAYROLL:'Payroll', HR_MANAGER:'HR Mgr' }
const STEP_LABELS = ['','Welcome','OTP','Personal','Contact','Emergency','Documents','Statutory','Declaration']
const DOCS_REQ = ['AADHAAR_FRONT','AADHAAR_BACK','PAN','PHOTO','DEGREE','BANK_PROOF']

// ── Small helpers ─────────────────────────────────────────────────
const fmt = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '-'
const daysLeft = (doj?: string) => {
  if (!doj) return null
  // Compare calendar dates (ignore time of day) so a same-day joining = 0, not negative.
  const a = new Date(doj); a.setHours(0, 0, 0, 0)
  const b = new Date(); b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}
const progressPct = (c: Candidate) => {
  const baseStep = Math.min(c.current_step || 1, 8)
  const stepPct  = Math.round(((baseStep - 1)/7)*70)
  const docBonus = c.docs_uploaded ? 15 : 0
  const statBonus = (c.form11 && c.bank) ? 15 : c.bank ? 8 : 0
  return Math.min(100, stepPct + docBonus + statBonus)
}

const Badge = ({ label, bg, color }: {label:string;bg:string;color:string}) => (
  <span style={{fontSize:11.5,padding:'3px 10px',borderRadius:99,background:bg,color,fontWeight:650,display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',border:`1px solid color-mix(in srgb, ${color} 22%, transparent)`}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>{label}
  </span>
)

/** The icons this page asked for by Tabler name. The Tabler icon font was never loaded in
 *  this app, so every one of them rendered as nothing; they map onto the product's own set. */
const TI: Record<string, (p:{size?:number;strokeWidth?:number})=>React.ReactElement> = {
  send: IconMail, 'list-check': IconPolicies, 'shield-check': IconCompliance, 'alert-triangle': IconAlert,
  user: IconUser, 'circle-check': IconCheck, bolt: IconAi, copy: IconLetters, robot: IconAi, 'file-alert': IconLetters,
  star: IconAi, clock: IconClock, 'info-circle': IconAlert, home: IconHome, users: IconEmployees, brain: IconAi,
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
const Avatar = ({ name, size = 34 }: { name: string; size?: number }) => (
  <span style={{width:size,height:size,borderRadius:'50%',flexShrink:0,display:'grid',placeItems:'center',fontSize:Math.round(size*.36),fontWeight:700,
    background:`linear-gradient(145deg, ${TK.brandTint}, ${TK.brandEdge})`,color:TK.brandDeep}}>
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
const RiskBadge = ({ risk }: {risk?: RiskLevel}) => {
  if (!risk) return null
  const m: Record<RiskLevel,{bg:string;color:string}> = {
    LOW:    {bg: TK.sunken,color: TK.positive},
    MEDIUM: {bg:TK.warningTint,color:TK.warning},
    HIGH:   {bg: TK.criticalTint,color:TK.critical},
  }
  return <Badge label={`${risk[0]}${risk.slice(1).toLowerCase()} risk`} {...m[risk]}/>
}

function Toast({msg,type,onClose}:{msg:string;type:'ok'|'err';onClose:()=>void}) {
  useEffect(()=>{const t=setTimeout(onClose,3500);return()=>clearTimeout(t)},[onClose])
  return <div style={{position:'fixed',bottom:24,right:24,zIndex:9999,borderRadius:12,padding:'12px 18px',fontSize:13,fontWeight:600,background:TK.ink,color:TK.surface,boxShadow:'0 18px 40px -16px rgba(0,0,0,.5)',maxWidth:360,display:'flex',alignItems:'center',gap:10}}>
    <span style={{width:22,height:22,borderRadius:'50%',display:'grid',placeItems:'center',background:type==='ok'?TK.positive:TK.critical,color:TK.onAccent,flexShrink:0}}><Ti n={type==='ok'?'circle-check':'alert-triangle'} s={13}/></span>{msg}</div>
}

function ProgressBar({pct,color=P}:{pct:number;color?:string}) {
  return (
    <div style={{height:6,background:TK.sunken,borderRadius:99,overflow:'hidden',marginTop:5}}>
      <div style={{height:'100%',background:color,borderRadius:99,width:`${pct}%`,transition:'width .4s'}}/>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════
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
  const [codeModal,    setCodeModal]  = useState<Candidate|null>(null)
  const [genCode,      setGenCode]    = useState('')
  const [codeLoading,  setCodeLoading] = useState(false)
  const [codeType,     setCodeType]   = useState('')
  const [saving,       setSaving]     = useState(false)
  const [dateModal,    setDateModal]  = useState<Candidate|null>(null)
  const [dateVal,      setDateVal]    = useState('')
  const [editEmail,    setEditEmail]  = useState('')
  const [editMobile,   setEditMobile] = useState('')
  const [resendingId,  setResendingId] = useState('')
  const [reviewing,    setReviewing]  = useState<{ id: string; readOnly: boolean } | null>(null)
  const [assigning,    setAssigning]  = useState<Candidate|null>(null)
  const [selIds,       setSelIds]     = useState<Set<string>>(new Set())
  // New link form
  const [companies, setCompanies] = useState<{id:string;company_name?:string;company_code?:string}[]>([])
  const [departments, setDepartments] = useState<{id:string;dept_name:string;company_id:string}[]>([])
  const [newForm, setNewForm] = useState({
    company_id:'', full_name:'', designation:'', department:'', department_id:'', email:'', mobile:'',
    date_of_joining:'', offered_ctc:'', employment_type:'Employee',
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
    const [allDocs, allForms, allAssets, allApprovals] = await Promise.all([
      fetchAll('onboarding_documents',       'onboarding_id,doc_code,ai_status'),
      fetchAll('onboarding_statutory_forms', 'onboarding_id,form_type'),
      fetchAll('onboarding_asset_requests',  'onboarding_id,asset_type,status'),
      fetchAll('onboarding_approvals',       'onboarding_id,team,status'),
    ])
    const groupBy = (rows: any[]) => {
      const m = new Map<string, any[]>()
      rows.forEach(r => { const a = m.get(r.onboarding_id); a ? a.push(r) : m.set(r.onboarding_id, [r]) })
      return m
    }
    const docsBy = groupBy(allDocs), formsBy = groupBy(allForms), assetsBy = groupBy(allAssets), approvalsBy = groupBy(allApprovals)

    const enriched: Candidate[] = (cands || []).map((c) => {
      const docs = docsBy.get(c.id) || []
      const forms = formsBy.get(c.id) || []
      const assets = assetsBy.get(c.id) || []
      const docCodes  = (docs||[]).map(d=>d.doc_code)
      const flagged   = (docs||[]).filter(d=>d.ai_status==='MISMATCH'||d.ai_status==='FAILED').length
      const formTypes = (forms||[]).map(f=>f.form_type)
      const laptop    = (assets||[]).find(a=>a.asset_type==='LAPTOP')
      const idCard    = (assets||[]).find(a=>a.asset_type==='ID_CARD')

      // Compute AI risk
      let risk: RiskLevel = 'LOW'
      let riskReason = ''
      const days = daysLeft(c.date_of_joining)
      if (days !== null && days <= 3 && c.status !== 'EMPLOYEE_CREATED') { risk='HIGH'; riskReason='Joining in ≤3 days, not complete' }
      else if (flagged > 0) { risk='MEDIUM'; riskReason=`${flagged} document(s) AI flagged` }
      else if (c.status==='INVITED' && days !== null && days <= 7) { risk='MEDIUM'; riskReason='Link not opened, joining close' }

      return {
        ...c,
        docs_uploaded:   docCodes.length,
        docs_ai_flagged: flagged,
        form11:          formTypes.includes('EPF_FORM11'),
        form2:           formTypes.includes('EPF_FORM2'),
        bank:            formTypes.includes('BANK_MANDATE'),
        policy_ack:      !!(c.form_data?.step_8?.declaration_accepted),
        laptop_issued:   laptop?.status === 'ISSUED',
        id_card_issued:  idCard?.status  === 'ISSUED',
        ai_risk:         risk,
        ai_risk_reason:  riskReason,
        approvals:       ['IT','ADMIN','PAYROLL','HR_MANAGER'].map(team => ({ team, status: (approvalsBy.get(c.id) || []).find((a: any) => a.team === team)?.status || 'PENDING' })),
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
      .select('id, full_name, email, mobile, phone, designation, company_id, onboarding_date, blacklisted, offer_accepted, stage, created_at')
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
  }, [grant])

  useEffect(()=>{ if (!grantLoading) load() },[load, grantLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send onboarding link ────────────────────────────────────────────
  const sendMagicLink = async () => {
    const { company_id, full_name, mobile, date_of_joining } = newForm
    if (!company_id) { showToast('Please select a company','err'); return }
    if (!full_name || !mobile || !date_of_joining) { showToast('Name, mobile, date of joining required','err'); return }
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
      setNewForm(f=>({company_id:f.company_id,full_name:'',designation:'',department:'',department_id:'',email:'',mobile:'',date_of_joining:'',offered_ctc:'',employment_type:'Employee'}))
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
  const openDateEdit = (c: Candidate) => { setDateModal(c); setDateVal(c.date_of_joining ? c.date_of_joining.slice(0,10) : ''); setEditEmail(c.email || ''); setEditMobile(c.mobile || '') }
  const saveDate = async () => {
    if (!dateModal) return
    setSaving(true)
    const c = dateModal
    // Recruitment joiner (not yet invited) → candidates. Already-invited → onboarding_candidates.
    const { error } = c.recruitment_id
      ? await supabase.from('candidates').update({ onboarding_date: dateVal || null, email: editEmail || null, phone: editMobile || null, mobile: editMobile || null }).eq('id', c.recruitment_id)
      : await supabase.from('onboarding_candidates').update({ date_of_joining: dateVal || null, email: editEmail || null, mobile: editMobile || null }).eq('id', c.id)
    setSaving(false)
    if (error) { showToast('Error: '+error.message, 'err'); return }
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

  // ── Open code modal + auto-suggest the next type-wise code ────
  const openCodeModal = async (candidate: Candidate) => {
    setCodeModal(candidate); setGenCode(''); setCodeType(''); setCodeLoading(true)
    try {
      const res = await fetch(`/api/onboarding/generate-code?onboarding_id=${candidate.id}`)
      if (res.ok) {
        const data = await res.json()
        setGenCode(data.suggested || '')
        setCodeType(data.employment_type || '')
      }
    } catch { /* silent — HR can still type manually */ }
    setCodeLoading(false)
  }

  // ── Generate employee code ────────────────────────────────────
  const generateCode = async () => {
    if (!codeModal || !genCode.trim()) { showToast('Code required','err'); return }
    setSaving(true)
    try {
      const post = (force: boolean) => fetch('/api/onboarding/generate-code', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ onboarding_id: codeModal.id, employee_code: genCode.trim(), force }),
      })
      let res = await post(false)
      let data = await res.json()
      // The other teams have not all approved yet (ESS → Tasks & Approvals). HR may still go ahead.
      if (res.status === 409 && Array.isArray(data.pending) && data.pending.length) {
        if (!window.confirm(`Still waiting on ${data.pending.join(', ')} approval${data.pending.length > 1 ? 's' : ''}.\n\nGenerate the employee code anyway?`)) { setSaving(false); return }
        res = await post(true); data = await res.json()
      }
      if (!res.ok) throw new Error(data.error||'Failed')
      const code = data.employee_code || genCode
      // Surface the master-sync result — earlier this was hidden, so a failed
      // employees insert looked like success while the master stayed empty.
      if (data.employee_synced === false) {
        showToast(`Code ${code} generated, but Employee Master sync FAILED: ${data.sync_error || 'unknown error'}`, 'err')
      } else {
        showToast(`✓ ${code} generated. Added to Employee Master + ESS unlocked.`)
      }
      setCodeModal(null); setGenCode('')
      load()
    } catch(e:any) { showToast(e.message,'err') }
    setSaving(false)
  }

  // ── Issue asset ───────────────────────────────────────────────
  const issueAsset = async (candidateId: string, assetType: string) => {
    await supabase.from('onboarding_asset_requests').upsert({
      onboarding_id: candidateId, asset_type: assetType,
      status:'ISSUED', issued_at: new Date().toISOString(),
    },{onConflict:'onboarding_id,asset_type'})
    showToast(`${assetType} marked as issued`)
    load()
  }

  // ── Computed stats ─────────────────────────────────────────────
  const total       = candidates.length
  const active      = candidates.filter(c=>!['EMPLOYEE_CREATED'].includes(c.status)).length
  const submitted   = candidates.filter(c=>c.status==='SUBMITTED'||c.status==='HR_REVIEW').length
  const highRisk    = candidates.filter(c=>c.ai_risk==='HIGH').length
  const joined      = candidates.filter(c=>c.status==='EMPLOYEE_CREATED').length
  const thisWeek    = candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).length

  // ── Filter candidates ─────────────────────────────────────────
  const filtered = candidates.filter(c=>{
    // Once the employee code is generated (onboarding 100% complete), drop the card
    // from the default list — still reachable by explicitly filtering the stage.
    if (c.status==='EMPLOYEE_CREATED' && filterStage!=='EMPLOYEE_CREATED') return false
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
      actions.push({priority:'HIGH',label:'Form submitted: review the documents and details',candidate:c.full_name,action:'review',cid:c.id})
    }
    if (c.status==='HR_REVIEW') {
      const waiting = (c.approvals||[]).filter(a=>a.status!=='APPROVED'&&a.team!=='HR_MANAGER').map(a=>TEAM_SHORT[a.team]||a.team)
      actions.push({priority:'MEDIUM',label:`Accepted by HR, with ${waiting.join(', ') || 'the teams'} for their checklist (ESS → HRIS → Tasks & Approvals)`,candidate:c.full_name,action:'approvals',cid:c.id})
    }
    if (c.status==='APPROVED') {
      actions.push(c.role_assignment
        ? {priority:'HIGH',label:`Role assigned (${c.role_assignment.role_name}): generate the employee code`,candidate:c.full_name,action:'generate',cid:c.id}
        : {priority:'HIGH',label:'IT, Admin and Payroll approved: assign the role (L1, L2, ESS role), then generate the code',candidate:c.full_name,action:'assign',cid:c.id})
    }
    if (c.status==='IN_PROGRESS' && c.hr_review?.outcome==='RETURNED') {
      const n = (c.hr_review.documents||[]).length, m = (c.hr_review.details||[]).length
      actions.push({priority:'MEDIUM',label:`Returned to candidate: ${n} document${n===1?'':'s'} rejected, ${m} detail${m===1?'':'s'} flagged; resend the link if they have not acted`,candidate:c.full_name,action:'returned',cid:c.id})
    }
    if (c.status==='INVITED' && days!==null && days<=5) actions.push({priority:'HIGH',label:'Link not opened, follow up candidate',candidate:c.full_name,action:'followup',cid:c.id})
    if (c.docs_ai_flagged && c.docs_ai_flagged>0) actions.push({priority:'MEDIUM',label:`${c.docs_ai_flagged} document(s) AI flagged, review`,candidate:c.full_name,action:'docs',cid:c.id})
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
        <StatCard label="Total pipeline"    val={total}     color={TK.brand}    tint={TK.brandTint}    icon="users"         onClick={()=>setTab('candidates')}/>
        <StatCard label="Active onboarding" val={active}    color={TK.info}     tint={TK.infoTint}     icon="clock"         onClick={()=>setTab('candidates')}/>
        <StatCard label="Joining this week" val={thisWeek}  color={TK.warning}  tint={TK.warningTint}  icon="home"/>
        <StatCard label="Awaiting code"     val={submitted} color={TK.brand}    tint={TK.brandTint}    icon="bolt"          onClick={()=>setTab('pending')}/>
        <StatCard label="High risk"         val={highRisk}  color={TK.critical} tint={TK.criticalTint} icon="alert-triangle" onClick={()=>setTab('insights')}/>
        <StatCard label="Completed"         val={joined}    color={TK.positive} tint={TK.positiveTint} icon="circle-check"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:16,alignItems:'start'}}>

        {/* Quick actions */}
        <Panel title="Quick actions" icon="bolt">
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <button onClick={()=>setTab('candidates')} className="ez-cta"
              style={{
                // This is the primary action of the whole screen and it read as
                // one more row in a list. It now carries the brand gradient,
                // elevation in its own colour, and an arrow that travels on
                // hover — the three things that make a control look pressable
                // rather than painted on.
                padding:'14px 16px', borderRadius:R.md, border:`1px solid ${TK.brandDeep}`,
                cursor:'pointer', background:`linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`,
                color:TK.onAccent, fontSize:14, fontWeight:600, fontFamily:'inherit',
                textAlign:'left', display:'flex', alignItems:'center', gap:11,
                boxShadow:E.brand, width:'100%',
              }}>
              <span style={{width:32,height:32,borderRadius:10,display:'grid',placeItems:'center',background:'rgba(255,255,255,.18)'}}><Ti n="send" s={16}/></span>
              <span style={{flex:1}}>Send onboarding links</span>
              <span style={{fontSize:12, fontWeight:500, opacity:.82}}>All candidates</span>
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
                    {c.status==='APPROVED' && !c.role_assignment && (
                      <button className="ezob-btn" onClick={()=>setAssigning(c)} style={btnSm('primary')}>
                        <Ti n="user-check" s={13}/>Assign role
                      </button>
                    )}
                    {c.status==='APPROVED' && c.role_assignment && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(c)}} style={btnSm('primary')}>
                        <Ti n="bolt" s={13}/>Generate code
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

  // ── ALL CANDIDATES TAB ─────────────────────────────────────────
  const CandidatesTab = () => (
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
          <button key={w.k} onClick={()=>setJoinWindow(w.k)}
            className="ezob-pill" style={{height:32,padding:'0 14px',borderRadius:99,border:'1px solid '+(joinWindow===w.k?TK.brandEdge:TK.line),cursor:'pointer',fontSize:12.5,fontWeight:joinWindow===w.k?650:500,fontFamily:'inherit',background:joinWindow===w.k?TK.brandTint:TK.surface,color:joinWindow===w.k?TK.brand:TK.inkSoft}}>
            {w.label}
          </button>
        ))}
      </div>
      {/* Filters — frozen (sticky) so they stay visible while the list scrolls */}
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center',position:'sticky',top:0,zIndex:30,background:TK.surface,padding:'12px 14px',borderRadius:14,border:`1px solid ${TK.line}`,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
          placeholder="Search name or designation…"
          style={{...inputCss,minWidth:240}}/>
        <select value={filterStage} onChange={e=>setFilterStage(e.target.value as any)}
          style={{...inputCss,cursor:'pointer'}}>
          <option value="ALL">All stages</option>
          {(Object.keys(STAGE_META) as Stage[]).map(s=><option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <select value={filterRisk} onChange={e=>setFilterRisk(e.target.value as any)}
          style={{...inputCss,cursor:'pointer'}}>
          <option value="ALL">All risk levels</option>
          <option value="HIGH">High risk only</option>
          <option value="MEDIUM">Medium risk</option>
          <option value="LOW">Low risk</option>
        </select>
        <div style={{marginLeft:'auto',fontSize:12.5,color:TK.muted}}><b style={{color:TK.ink}}>{filtered.length}</b> of {total} shown</div>
        <button className="ezob-btn is-ghost" onClick={()=>{ const ni = filtered.filter(c=>c.status==='NOT_INVITED'); const all = ni.length>0 && ni.every(c=>selIds.has(c.id)); setSelIds(prev=>{ const n=new Set(prev); ni.forEach(c=>all?n.delete(c.id):n.add(c.id)); return n }) }} style={{...btnSm('ghost'),height:40,padding:'0 14px'}}>Select all not invited</button>
        {filtered.some(c=>c.status==='NOT_INVITED'&&selIds.has(c.id)) && (
          <button className="ezob-btn" onClick={bulkSend} disabled={saving} style={{...btnSm('primary'),height:40,padding:'0 14px',opacity:saving?.6:1}}>
            <Ti n="send" s={14}/> Send link to {filtered.filter(c=>c.status==='NOT_INVITED'&&selIds.has(c.id)).length} selected
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{border:`1px solid ${TK.line}`,borderRadius:16,overflow:'hidden',background:TK.surface,boxShadow:'0 1px 2px rgba(16,24,40,.04)'}}>
        <div style={{overflowX:'auto'}}>
          <table className="ezob-table" style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:TK.sunken}}>
                {['','Candidate','Stage','Progress','Joining','Docs','Statutory','BGV','Risk','Actions'].map((h,hi)=>(
                  <th key={hi} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:TK.faint,textTransform:'uppercase',letterSpacing:'.06em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap',background:TK.sunken}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10}><Empty icon="users" text="No candidates match these filters."/></td></tr>
              )}
              {filtered.map((c,i)=>{
                const sm  = STAGE_META[c.status]
                const notInvited = c.status==='NOT_INVITED'
                const pct = notInvited ? 0 : progressPct(c)
                const days = daysLeft(c.date_of_joining)
                return (
                  <tr key={c.id} style={{borderBottom:`1px solid ${TK.line}`,background:TK.surface}}>
                    <td style={{padding:'12px 14px',width:28}}>
                      {notInvited && <input type="checkbox" checked={selIds.has(c.id)} onChange={()=>setSelIds(prev=>{ const n=new Set(prev); n.has(c.id)?n.delete(c.id):n.add(c.id); return n })} />}
                    </td>
                    <td style={{padding:'12px 14px',minWidth:190}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <Avatar name={c.full_name}/>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:650}}>{c.full_name}</div>
                          <div style={{fontSize:12,color:TK.muted,marginTop:1}}>{c.designation || 'No designation'}{c.employee_code && <b style={{color:TK.positive,fontWeight:650}}> · {c.employee_code}</b>}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'12px 14px',whiteSpace:'nowrap'}}>
                      <Badge {...sm} label={sm.label}/>
                      {c.status==='IN_PROGRESS' && c.hr_review?.outcome==='RETURNED' && (
                        <div title={[...(c.hr_review.documents||[]).map(d=>`${d.label}: ${d.reason}`), ...(c.hr_review.details||[]).map(d=>`${d.field}: ${d.reason}`)].join('\n')} style={{fontSize:11,fontWeight:650,color:TK.critical,marginTop:4}}>↩ Returned · {(c.hr_review.documents||[]).length} doc{(c.hr_review.documents||[]).length===1?'':'s'} rejected</div>
                      )}
                    </td>
                    <td style={{padding:'12px 14px',minWidth:120}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>-</span> : <>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,color:TK.muted,marginBottom:2,whiteSpace:'nowrap'}}>
                        <span>Step {c.current_step||1}/8</span><b style={{color:TK.ink,fontWeight:650}}>{pct}%</b>
                      </div>
                      <ProgressBar pct={pct} color={pct===100?TK.positive:pct>=60?P:TK.warning}/>
                      </>}
                    </td>
                    <td style={{padding:'12px 14px',whiteSpace:'nowrap',fontSize:12.5}}>
                      {fmt(c.date_of_joining)}
                      {days !== null && <div style={{fontSize:11.5,fontWeight:650,marginTop:1,color:days<=3?TK.critical:days<=7?TK.warning:TK.positive}}>{days<0?`${Math.abs(days)}d ago`:days===0?'Today!':days===1?'Tomorrow':`D-${days}`}</div>}
                    </td>
                    <td style={{padding:'12px 14px',whiteSpace:'nowrap'}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>-</span> : <>
                      <span style={{fontSize:12,fontWeight:650,padding:'2px 8px',borderRadius:8,background:(c.docs_uploaded||0)>=DOCS_REQ.length?TK.positiveTint:TK.sunken,color:(c.docs_uploaded||0)>=DOCS_REQ.length?TK.positive:TK.inkSoft}}>{c.docs_uploaded||0}/{DOCS_REQ.length}</span>
                      {(c.docs_ai_flagged||0)>0 && <div style={{fontSize:11.5,color:TK.warning,marginTop:4,fontWeight:600}}>{c.docs_ai_flagged} flagged</div>}
                      </>}
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>-</span> : <>
                      {/* Done = green with a tick, not done = grey. The laptop and ID-card chips
                          were blank: their emoji had been stripped and nothing replaced them. */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(3,auto)',gap:4,justifyContent:'start'}}>
                        {([['F11',c.form11],['F2',c.form2],['Bank',c.bank],['Policy',c.policy_ack],['Laptop',c.laptop_issued],['ID',c.id_card_issued]] as [string,boolean|undefined][]).map(([l,ok])=>(
                          <span key={l} title={`${({F11:'EPF Form 11',F2:'EPF Form 2',ID:'ID card'} as Record<string,string>)[l]||l}: ${ok?'done':'pending'}`} style={{fontSize:11,padding:'2px 7px',whiteSpace:'nowrap',borderRadius:7,fontWeight:650,display:'inline-flex',alignItems:'center',gap:3,
                            background:ok?TK.positiveTint:TK.sunken,color:ok?TK.positive:TK.faint,border:`1px solid ${ok?TK.positiveEdge:TK.line}`}}>
                            {ok && <IconCheck size={10} strokeWidth={3}/>}{l}
                          </span>
                        ))}
                      </div>
                      {(c.status==='SUBMITTED'||c.status==='HR_REVIEW'||c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && (
                        <div style={{display:'flex',gap:3,marginTop:3}} title="HR Manager accepts the form; then IT, Admin and Payroll confirm their checklists (ESS → HRIS → Tasks & Approvals)">
                          {(c.approvals||[]).map(a=>(
                            <span key={a.team} style={{fontSize:9,padding:'1px 5px',borderRadius:99,fontWeight:600,background:a.status==='APPROVED'?TK.positiveTint:a.status==='RETURNED'?TK.criticalTint:TK.warningTint,color:a.status==='APPROVED'?TK.positive:a.status==='RETURNED'?TK.critical:TK.warning}}>
                              {TEAM_SHORT[a.team]} {a.status==='APPROVED'?'✓':a.status==='RETURNED'?'↩':'○'}
                            </span>
                          ))}
                        </div>
                      )}
                      </>}
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      <span style={{fontSize:12,color:TK.faint}}>Not started</span>
                    </td>
                    <td style={{padding:'12px 14px',whiteSpace:'nowrap'}}><RiskBadge risk={c.ai_risk}/></td>
                    <td style={{padding:'12px 14px',minWidth:170}}>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(2,max-content)',gap:6}}>
                        {notInvited && (
                          <button className="ezob-btn" onClick={()=>sendOnboardingFor(c)} disabled={saving} style={{...btnSm('primary'),opacity:saving?.6:1}}>
                            <Ti n="send" s={11}/>Send onboarding link
                          </button>
                        )}
                        {notInvited && (
                          <button className="ezob-btn is-ghost" onClick={()=>openDateEdit(c)} style={btnSm('ghost')}>Edit</button>
                        )}
                        {c.status==='SUBMITTED' && (
                          <button className="ezob-btn" onClick={()=>setReviewing({ id: c.id, readOnly: false })} style={btnSm('primary')}>
                            <Ti n="checklist" s={11}/>Review
                          </button>
                        )}
                        {c.status==='APPROVED' && !c.role_assignment && (
                          <button className="ezob-btn" onClick={()=>setAssigning(c)} title="IT, Admin and Payroll have approved: assign the L1, L2 and the ESS role" style={btnSm('primary')}>
                            <Ti n="user-cog" s={11}/>Assign role
                          </button>
                        )}
                        {c.status==='APPROVED' && c.role_assignment && (
                          <button onClick={()=>{openCodeModal(c)}} title={`Role ${c.role_assignment.role_name} · L1 ${c.role_assignment.l1_name||'-'}`} className="ezob-btn" style={btnSm('primary')}>
                            <Ti n="bolt" s={11}/>Code
                          </button>
                        )}
                        {c.status==='APPROVED' && c.role_assignment && (
                          <button className="ezob-btn is-ghost" onClick={()=>setAssigning(c)} title="Change the role assignment" style={btnSm('ghost')}>Role ✓ {c.role_assignment.role_name}</button>
                        )}
                        {(c.status==='HR_REVIEW'||c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && (
                          <button className="ezob-btn is-ghost" onClick={()=>setReviewing({ id: c.id, readOnly: true })} style={btnSm('ghost')}>View form</button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button onClick={async()=>{
                            const link=`${window.location.origin}/onboarding/${c.magic_link_token}`
                            await navigator.clipboard.writeText(link).catch(()=>{})
                            showToast('Link copied!')
                          }} className="ezob-btn is-ghost" style={btnSm('ghost')}>
                            <Ti n="copy" s={11}/>Link
                          </button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button className="ezob-btn" onClick={()=>resendLink(c)} disabled={resendingId===c.id} style={{...btnSm('primary'),opacity:resendingId===c.id?.6:1}}>
                            <Ti n="send" s={11}/>{resendingId===c.id?'Sending…':'Resend'}
                          </button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button className="ezob-btn is-ghost" onClick={()=>extendValidity(c)} style={btnSm('ghost')}>Extend</button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button className="ezob-btn is-ghost" onClick={()=>openDateEdit(c)} style={btnSm('ghost')}>Edit</button>
                        )}
                        {(c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && !c.laptop_issued && (
                          <button className="ezob-btn" onClick={()=>issueAsset(c.id,'LAPTOP')} style={btnSm('warn')}>Issue laptop</button>
                        )}
                        {(c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && !c.id_card_issued && (
                          <button className="ezob-btn is-ghost" onClick={()=>issueAsset(c.id,'ID_CARD')} style={btnSm('ghost')}>Issue ID card</button>
                        )}
                      </div>
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
                      <Ti n={a.action==='generate'?'bolt':a.action==='docs'?'file-alert':a.action==='followup'?'send':a.action==='policy'?'list-check':'shield-check'} s={17}/>
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13.5,fontWeight:650,color:TK.ink}}>{a.label}</div>
                      <div style={{fontSize:12.5,color:TK.muted,marginTop:2}}>
                        <Ti n="user" s={11}/>{a.candidate}
                        {cand?.date_of_joining && <span style={{marginLeft:8}}>· DOJ: {fmt(cand.date_of_joining)}</span>}
                      </div>
                    </div>
                    {a.action==='assign' && cand && (
                      <button onClick={()=>setAssigning(cand)} style={{padding:'5px 12px',borderRadius:'10px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        <i className="ti ti-user-cog" style={{fontSize:12,verticalAlign:-1,marginRight:3}} aria-hidden="true"/>Role assignment
                      </button>
                    )}
                    {a.action==='generate' && cand && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(cand)}} style={{...btnSm('primary'),height:34}}>
                        <Ti n="bolt" s={12}/>Generate code
                      </button>
                    )}
                    {a.action==='followup' && cand && (
                      <button onClick={async()=>{
                        const link=`${window.location.origin}/onboarding/${cand.magic_link_token}`
                        await navigator.clipboard.writeText(link).catch(()=>{})
                        showToast('Link copied. Send to candidate')
                      }} className="ezob-btn is-ghost" style={{...btnSm('ghost'),height:34}}>
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
    const flaggedDocs = candidates.filter(c=>(c.docs_ai_flagged||0)>0)
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
                    <div style={{fontSize:12,color:TK.muted,marginTop:2}}>{c.designation || 'No designation'} · Joins {fmt(c.date_of_joining)}</div>
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
                    {c.status==='APPROVED' && !c.role_assignment && (
                      <button className="ezob-btn" onClick={()=>setAssigning(c)} style={btnSm('primary')}>Assign role</button>
                    )}
                    {c.status==='APPROVED' && c.role_assignment && (
                      <button className="ezob-btn" onClick={()=>{openCodeModal(c)}} style={btnSm('primary')}>Generate code</button>
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
    const active = candidates.filter(c=>c.status!=='EMPLOYEE_CREATED')
    return (
      <div>
        <SH title="Compliance tracker" sub="India-specific: PF / ESI / PT / BGV, employee-wise"/>

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
                {candidates.length===0 && (
                  <tr><td colSpan={10}><Empty icon="users" text="No one is being onboarded right now."/></td></tr>
                )}
                {candidates.map((c,i)=>{
                  const ptState = (c.form_data as any)?.step_4?.perm_state || '-'
                  const Tick = ({done}:{done?:boolean}) => (
                    <span title={done?'Done':'Pending'} style={{width:26,height:26,borderRadius:8,display:'inline-grid',placeItems:'center',background:done?TK.positiveTint:TK.warningTint,color:done?TK.positive:TK.warning}}>
                      {done ? <IconCheck size={14} strokeWidth={2.6}/> : <IconClock size={14} strokeWidth={2}/>}
                    </span>
                  )
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
                      <td style={{padding:'11px 14px'}}><Tick done={c.form11}/></td>
                      <td style={{padding:'11px 14px'}}><Tick done={c.form2}/></td>
                      <td style={{padding:'11px 14px'}}><Tick done={c.bank}/></td>
                      <td style={{padding:'11px 14px'}}><Tick done={c.policy_ack}/></td>
                      <td style={{padding:'11px 14px'}}>
                        {c.laptop_issued
                          ? <span style={{fontSize:12,color:TK.positive,fontWeight:650}}>Issued</span>
                          : <button className="ezob-btn is-ghost" onClick={()=>issueAsset(c.id,'LAPTOP')} style={{...btnSm('ghost'),height:26}}>Issue</button>
                        }
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        {c.id_card_issued
                          ? <span style={{fontSize:12,color:TK.positive,fontWeight:650}}>Issued</span>
                          : <button className="ezob-btn is-ghost" onClick={()=>issueAsset(c.id,'ID_CARD')} style={{...btnSm('ghost'),height:26}}>Issue</button>
                        }
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12.5,color:TK.inkSoft}}>{ptState}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{fontSize:12,color:TK.faint}}>Not started</span>
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
    {key:'candidates',  icon:'users',       label:'All candidates', badge:total},
    {key:'pending',     icon:'list-check',  label:'Pending actions', badge:pendingActions.filter(a=>a.priority==='HIGH').length||undefined},
    {key:'insights',    icon:'brain',       label:'AI insights',    badge:highRisk||undefined},
    {key:'compliance',  icon:'shield-check',label:'Compliance'},
  ]

  return (
    <div className="ezob" style={{background:TK.canvas,minHeight:'100vh',fontFamily:'"DM Sans","Segoe UI",sans-serif',color:TK.ink}}>

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
              {submitted>0 && <span style={{color:TK.brand,fontWeight:600}}>{submitted} awaiting employee code</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>setLinkModal(true)} className="ez-press" style={{height:40,padding:'0 16px',borderRadius:11,cursor:'pointer',background:TK.surface,border:`1px solid ${TK.lineStrong}`,color:TK.inkSoft,fontSize:13,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:7}}>
              <IconPlus size={15}/> Add candidate
            </button>
            <button onClick={()=>setTab('candidates')} className="ez-press" style={{height:40,padding:'0 16px',borderRadius:11,cursor:'pointer',background:`linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`,border:`1px solid ${TK.brandDeep}`,color:TK.onAccent,fontSize:13,fontWeight:650,fontFamily:'inherit',display:'flex',alignItems:'center',gap:7,boxShadow:E.brand}}>
              <Ti n="send" s={15}/> Send onboarding links
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
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:TK.surface,borderRadius:18,padding:'22px 24px',width:'100%',maxWidth:560,boxShadow:E.overlay,maxHeight:'90vh',overflowY:'auto',border:`1px solid ${TK.line}`}}>
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
                {label:'Mobile *',          key:'mobile',         type:'tel',  placeholder:'+91 XXXXXXXXXX'},
                {label:'Email',             key:'email',          type:'email',placeholder:'personal@email.com'},
                {label:'Designation',       key:'designation',    type:'text', placeholder:'e.g. Software Engineer'},
                {label:'Date of Joining *', key:'date_of_joining',type:'date', placeholder:''},
                {label:'Offered CTC (₹)',   key:'offered_ctc',    type:'number',placeholder:'e.g. 800000'},
              ].map(({label,key,type,placeholder})=>(
                <div key={key} style={{marginBottom:8}}>
                  <div style={labelCss}>{label}</div>
                  <input type={type} placeholder={placeholder} value={(newForm as any)[key]} onChange={e=>setNewForm(f=>({...f,[key]:e.target.value}))}
                    style={{...inputCss,width:'100%'}}/>
                </div>
              ))}
              <div style={{marginBottom:8}}>
                <div style={labelCss}>Department</div>
                <select value={newForm.department_id} onChange={e=>{ const d = departments.find(x=>x.id===e.target.value); setNewForm(f=>({...f, department_id:e.target.value, department: d?.dept_name || ''})) }}
                  style={{...inputCss,width:'100%'}}>
                  <option value="">Select department…</option>
                  {departments.filter(d=>!newForm.company_id||d.company_id===newForm.company_id).map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8}}>
                <div style={labelCss}>Employment Type</div>
                <select value={newForm.employment_type} onChange={e=>setNewForm(f=>({...f,employment_type:e.target.value}))}
                  style={{...inputCss,width:'100%'}}>
                  <option>Employee</option><option>Intern</option><option>Consultant</option><option>Contract</option><option>NAPS</option><option>NATS</option>
                </select>
              </div>
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
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:TK.surface,borderRadius:18,padding:'22px 24px',width:'100%',maxWidth:440,boxShadow:E.overlay,border:`1px solid ${TK.line}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700}}>Edit {dateModal.full_name}</div>
              <button onClick={()=>setDateModal(null)} style={{border:`1px solid ${TK.line}`,background:TK.surface,cursor:'pointer',fontSize:18,color:TK.muted,lineHeight:1,width:32,height:32,borderRadius:9,flexShrink:0}} aria-label="Close">×</button>
            </div>
            <div style={labelCss}>Joining / Onboarding Date</div>
            <input type="date" value={dateVal} onChange={e=>setDateVal(e.target.value)}
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Email</div>
            <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder="candidate@email.com"
              style={{...inputCss,width:'100%',marginBottom:12}}/>
            <div style={labelCss}>Mobile</div>
            <input type="tel" value={editMobile} onChange={e=>setEditMobile(e.target.value)} placeholder="+91 XXXXXXXXXX"
              style={{...inputCss,width:'100%'}}/>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setDateModal(null)} style={{...btnSm('ghost'),height:42,padding:'0 18px',fontSize:13}}>Cancel</button>
              <button onClick={saveDate} disabled={saving} style={{...btnSm('primary'),flex:1,justifyContent:'center',height:42,fontSize:13.5,opacity:saving?.6:1}}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── GENERATE CODE (after the three heads approve and the role is assigned) ── */}
      {codeModal && (
        <GenerateCodeModal
          candidate={codeModal}
          genCode={genCode} setGenCode={setGenCode}
          codeType={codeType} codeLoading={codeLoading} saving={saving}
          onGenerate={generateCode}
          onClose={() => setCodeModal(null)}
        />
      )}

      {/* ── ROLE ASSIGNMENT (L1, L2, HOD and the ESS role) ── */}
      {assigning && (
        <RoleAssignmentModal onboardingId={assigning.id} name={assigning.full_name}
          onClose={()=>setAssigning(null)}
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
