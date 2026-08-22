// app/dashboard/onboarding/page.tsx
// EZER HRMS — Onboarding Admin Dashboard
// 5 tabs: Overview | All Candidates | Pending Actions | AI Insights | Compliance
'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import ActivationWizard from '@/components/onboarding/ActivationWizard'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, R, E, IconChevron } from '@/lib/ui'

// ── Types ─────────────────────────────────────────────────────────
type Stage = 'NOT_INVITED'|'INVITED'|'IN_PROGRESS'|'SUBMITTED'|'HR_REVIEW'|'APPROVED'|'EMPLOYEE_CREATED'
type RiskLevel = 'LOW'|'MEDIUM'|'HIGH'
type Tab = 'overview'|'candidates'|'pending'|'insights'|'compliance'

interface Candidate {
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
  HR_REVIEW:        { label:'HR review',         bg:TK.infoTint, color:TK.info },
  APPROVED:         { label:'Approved',          bg:TK.positiveTint, color:TK.positive },
  EMPLOYEE_CREATED: { label:'Employee created',  bg: TK.sunken, color: TK.positive },
}
const STEP_LABELS = ['','Welcome','OTP','Personal','Contact','Emergency','Documents','Statutory','Declaration']
const DOCS_REQ = ['AADHAAR_FRONT','AADHAAR_BACK','PAN','PHOTO','DEGREE','BANK_PROOF']

// ── Small helpers ─────────────────────────────────────────────────
const fmt = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '—'
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
  <span style={{fontSize:10,padding:'2px 8px',borderRadius:99,background:bg,color,fontWeight:600,display:'inline-flex',alignItems:'center'}}>{label}</span>
)
const RiskBadge = ({ risk }: {risk?: RiskLevel}) => {
  if (!risk) return null
  const m: Record<RiskLevel,{bg:string;color:string}> = {
    LOW:    {bg: TK.sunken,color: TK.positive},
    MEDIUM: {bg:TK.warningTint,color:TK.warning},
    HIGH:   {bg: TK.criticalTint,color:TK.critical},
  }
  return <Badge label={`${risk === 'HIGH' ? '⚠ ' : ''}${risk} risk`} {...m[risk]}/>
}

function Toast({msg,type,onClose}:{msg:string;type:'ok'|'err';onClose:()=>void}) {
  useEffect(()=>{const t=setTimeout(onClose,3500);return()=>clearTimeout(t)},[onClose])
  return <div style={{position:'fixed',bottom:24,right:24,zIndex:9999,borderRadius:10,padding:'12px 20px',fontSize:13,fontWeight:500,background:type==='ok'?TK.positive:TK.critical,color:TK.onAccent,boxShadow:'0 8px 24px rgba(0,0,0,.18)',maxWidth:320}}>{type==='ok'?'':''} {msg}</div>
}

function ProgressBar({pct,color=P}:{pct:number;color?:string}) {
  return (
    <div style={{height:5,background:'rgba(37,99,235,.1)',borderRadius:99,overflow:'hidden',marginTop:4}}>
      <div style={{height:'100%',background:color,borderRadius:99,width:`${pct}%`,transition:'width .4s'}}/>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════
export default function OnboardingDashboard() {
  const [tab,          setTab]        = useState<Tab>('overview')
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
    supabase.from('companies').select('id,company_code,company_name').order('company_code')
      .then(({data})=>{
        const list = data || []
        setCompanies(list)
        if (list.length === 1) setNewForm(f=>({...f, company_id:list[0].id}))
      })
    supabase.from('departments').select('id,dept_name,company_id').order('dept_name')
      .then(({data})=>setDepartments(data || []))
  },[])

  const showToast = (msg:string, type:'ok'|'err'='ok') => setToast({msg,type})

  // ── Load all onboarding candidates ───────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const { data: cands, error } = await supabase
      .from('onboarding_candidates')
      .select('*')
      .order('created_at', {ascending:false})

    if (error) { showToast('Load error: '+error.message,'err'); setLoading(false); return }

    // Enrich with documents + statutory forms
    const enriched: Candidate[] = await Promise.all((cands||[]).map(async (c) => {
      const [{ data: docs }, { data: forms }, { data: assets }] = await Promise.all([
        supabase.from('onboarding_documents').select('doc_code,ai_status').eq('onboarding_id',c.id),
        supabase.from('onboarding_statutory_forms').select('form_type').eq('onboarding_id',c.id),
        supabase.from('onboarding_asset_requests').select('asset_type,status').eq('onboarding_id',c.id),
      ])
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
      } as Candidate
    }))

    // ── Auto-pull joiners from recruitment ───────────────────────
    // A candidate appears here once they reach pre-onboarding (offer accepted /
    // joined) OR have a joining date set — so HR can send the onboarding link
    // even before a joining date is fixed. Not-yet-invited ones show as
    // NOT_INVITED cards with a "Send onboarding link" button.
    const { data: recJoiners } = await supabase
      .from('candidates')
      .select('id, full_name, email, mobile, phone, designation, company_id, onboarding_date, blacklisted, offer_accepted, stage, created_at')
      .or('onboarding_date.not.is.null,offer_accepted.is.true,stage.eq.Joined')

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
    const merged = [...pending, ...enriched].sort((a, b) => {
      const da = a.date_of_joining ? new Date(a.date_of_joining).getTime() : Infinity
      const db = b.date_of_joining ? new Date(b.date_of_joining).getTime() : Infinity
      return da - db
    })

    setCandidates(merged)
    setLoading(false)
  }, [])

  useEffect(()=>{ load() },[load])

  // ── Send onboarding link ────────────────────────────────────────────
  const sendMagicLink = async () => {
    const { company_id, full_name, mobile, date_of_joining } = newForm
    if (!company_id) { showToast('Please select a company','err'); return }
    if (!full_name || !mobile || !date_of_joining) { showToast('Name, mobile, date of joining required','err'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/send-magic-link', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...newForm, offered_ctc: newForm.offered_ctc ? parseFloat(newForm.offered_ctc) : null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed')
      showToast(data.emailed ? `Onboarding link emailed for ${full_name}! ✉️` : `Link created (email NOT sent: ${data.email_error || '—'}). Share manually: ${data.magic_link}`, data.emailed ? 'ok' : 'err')
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
    if (!c.mobile) { if (!bulk) showToast('This candidate has no mobile number — add one in Recruitment first','err'); return false }
    // Resolve company: candidate's own → company chosen during negotiation → single company.
    let companyId: string | undefined = c.company_id
    if (!companyId && c.recruitment_id) {
      const { data: neg } = await supabase.from('ctc_negotiations').select('company_id')
        .eq('candidate_id', c.recruitment_id).not('company_id','is',null)
        .order('created_at',{ ascending:false }).limit(1).maybeSingle()
      companyId = neg?.company_id || (companies.length === 1 ? companies[0].id : undefined)
    }
    if (!companyId) { if (!bulk) showToast('This candidate has no company set — open them in Recruitment → Negotiation and pick a company first.','err'); return false }
    if (!bulk) setSaving(true)
    let success = false
    try {
      const res = await fetch('/api/onboarding/send-magic-link', {
        method:'POST', headers:{'Content-Type':'application/json'},
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
        showToast(data.emailed ? `Onboarding link emailed to ${c.email} ✉️` : `Link created — email NOT sent (${data.email_error || 'no email'}). Copy it from the candidate's card.`, data.emailed ? 'ok' : 'err')
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
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ onboarding_id: c.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      showToast(data.emailed ? `Onboarding link re-sent to ${c.email} ✉️` : `Link refreshed — email NOT sent (${data.email_error || 'no email'}). Copy it instead.`, data.emailed ? 'ok' : 'err')
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
      const res = await fetch('/api/onboarding/generate-code', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ onboarding_id: codeModal.id, employee_code: genCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Failed')
      const code = data.employee_code || genCode
      // Surface the master-sync result — earlier this was hidden, so a failed
      // employees insert looked like success while the master stayed empty.
      if (data.employee_synced === false) {
        showToast(`Code ${code} generated, but Employee Master sync FAILED: ${data.sync_error || 'unknown error'}`, 'err')
      } else {
        showToast(`✓ ${code} generated — added to Employee Master + ESS unlocked.`)
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

    if (c.status==='SUBMITTED') actions.push({priority:'HIGH',label:'Review & generate employee code',candidate:c.full_name,action:'generate',cid:c.id})
    if (c.status==='INVITED' && days!==null && days<=5) actions.push({priority:'HIGH',label:'Link not opened — follow up candidate',candidate:c.full_name,action:'followup',cid:c.id})
    if (c.docs_ai_flagged && c.docs_ai_flagged>0) actions.push({priority:'MEDIUM',label:`${c.docs_ai_flagged} document(s) AI flagged — review`,candidate:c.full_name,action:'docs',cid:c.id})
    if (c.status==='APPROVED' && !c.laptop_issued) actions.push({priority:'MEDIUM',label:'Laptop not issued — contact IT',candidate:c.full_name,action:'laptop',cid:c.id})
    if (c.status==='APPROVED' && !c.id_card_issued) actions.push({priority:'LOW',label:'ID card not issued — contact Admin',candidate:c.full_name,action:'idcard',cid:c.id})
    if (!c.policy_ack && c.status==='IN_PROGRESS') actions.push({priority:'LOW',label:'Policy acknowledgement pending',candidate:c.full_name,action:'policy',cid:c.id})
    return actions
  }).sort((a,b)=>{ const o={HIGH:0,MEDIUM:1,LOW:2}; return o[a.priority]-o[b.priority] })

  // ── Shared section header ──────────────────────────────────────
  const SH = ({title,sub}:{title:string;sub?:string}) => (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:14,fontWeight:500,color:TK.ink}}>{title}</div>
      {sub && <div style={{fontSize:11,color:TK.muted,marginTop:2}}>{sub}</div>}
    </div>
  )

  // ── OVERVIEW TAB ───────────────────────────────────────────────
  const OverviewTab = () => (
    <div>
      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:18}}>
        {[
          {label:'Total pipeline',    val:total,     color:P},
          {label:'Active onboarding', val:active,    color: TK.brand},
          {label:'Joining this week', val:thisWeek,  color:TK.warning},
          {label:'Awaiting code',     val:submitted, color:TK.brand},
          {label:'High risk',         val:highRisk,  color:TK.critical},
          {label:'Completed',         val:joined,    color:TK.positive},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:TK.sunken,borderRadius:'8px',padding:'12px 14px',borderTop:`3px solid ${color}`}}>
            <div style={{fontSize:10,color:TK.muted,fontWeight:500,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>{label}</div>
            <div style={{fontSize:26,fontWeight:500,color}}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>

        {/* Quick actions */}
        <div>
          <SH title="Quick actions"/>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
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
              <i className="ti ti-send" style={{fontSize:16}} aria-hidden="true"/>
              <span style={{flex:1}}>Send onboarding links</span>
              <span style={{fontSize:12, fontWeight:500, opacity:.82}}>All candidates</span>
              <span className="ez-cta-arrow" style={{display:'flex'}}><IconChevron size={16} /></span>
            </button>
            <button onClick={()=>setTab('pending')} style={{padding:'11px 14px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8,color:TK.ink}}>
              <i className="ti ti-list-check" style={{fontSize:16,color:TK.warning}} aria-hidden="true"/> View {pendingActions.filter(a=>a.priority==='HIGH').length} urgent pending actions
            </button>
            <button onClick={()=>setTab('compliance')} style={{padding:'11px 14px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8,color:TK.ink}}>
              <i className="ti ti-shield-check" style={{fontSize:16,color: TK.brand}} aria-hidden="true"/> Review PF / ESI / BGV compliance status
            </button>
          </div>

          {/* AI alerts */}
          {highRisk > 0 && (
            <div style={{marginTop:14,background: TK.criticalTint,border: `1px solid ${TK.criticalTint}`,borderRadius:'8px',padding:'12px 14px'}}>
              <div style={{fontSize:12,fontWeight:500,color: TK.critical,marginBottom:8}}>
                <i className="ti ti-alert-triangle" style={{fontSize:14,verticalAlign:-2,marginRight:5}} aria-hidden="true"/>
                AI flagged {highRisk} high-risk joining{highRisk>1?'s':''}
              </div>
              {candidates.filter(c=>c.ai_risk==='HIGH').slice(0,3).map(c=>(
                <div key={c.id} style={{fontSize:11,color:TK.critical,marginBottom:4,display:'flex',alignItems:'center',gap:5}}>
                  <i className="ti ti-user" style={{fontSize:12}} aria-hidden="true"/> {c.full_name} — {c.ai_risk_reason}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* This week joiners */}
        <div>
          <SH title="Joining this week" sub="D-7 to today"/>
          {candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).length === 0
            ? <div style={{padding:20,textAlign:'center',color:TK.muted,fontSize:12}}>No joinings this week</div>
            : candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).map(c=>{
              const days = daysLeft(c.date_of_joining)!
              const pct  = progressPct(c)
              const sm   = STAGE_META[c.status]
              return (
                <div key={c.id} style={{background:TK.surface,border:'1px solid rgba(37,99,235,0.12)',borderRadius:'8px',padding:'10px 12px',marginBottom:8,borderLeft:`3px solid ${days<=1?TK.critical:days<=3?TK.warning:P}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500}}>{c.full_name}</div>
                      <div style={{fontSize:11,color:TK.muted,marginTop:1}}>{c.designation}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,fontWeight:600,color:days<=1?TK.critical:days<=3?TK.warning:P}}>
                        {days===0?'Today!':days===1?'Tomorrow':`D-${days}`}
                      </div>
                      <Badge {...sm} label={sm.label}/>
                    </div>
                  </div>
                  <ProgressBar pct={pct} color={pct===100?TK.positive:days<=3?TK.critical:P}/>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:5,fontSize:10,color:TK.muted}}>
                    <span>Step {c.current_step||1}/8 · {pct}% complete</span>
                    {c.status==='SUBMITTED' && (
                      <button onClick={()=>{openCodeModal(c)}} style={{fontSize:10,padding:'2px 8px',borderRadius:99,border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontFamily:'inherit'}}>
                        Generate code
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>
    </div>
  )

  // ── ALL CANDIDATES TAB ─────────────────────────────────────────
  const CandidatesTab = () => (
    <div>
      {/* Joining-window filter */}
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,color:TK.muted,marginRight:2}}>Joining:</span>
        {([
          {k:'all',   label:'All'},
          {k:'today', label:'Today'},
          {k:'3days', label:'Next 3 days'},
          {k:'week',  label:'This week'},
          {k:'month', label:'This month'},
        ] as {k:typeof joinWindow;label:string}[]).map(w=>(
          <button key={w.k} onClick={()=>setJoinWindow(w.k)}
            style={{padding:'6px 13px',borderRadius:99,border:'1px solid '+(joinWindow===w.k?P:TK.brandTint),cursor:'pointer',fontSize:12,fontWeight:joinWindow===w.k?600:500,fontFamily:'inherit',background:joinWindow===w.k?P:TK.sunken,color:joinWindow===w.k?TK.surface:TK.ink}}>
            {w.label}
          </button>
        ))}
      </div>
      {/* Filters — frozen (sticky) so they stay visible while the list scrolls */}
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center',position:'sticky',top:0,zIndex:30,background:TK.canvas,padding:'10px 12px',borderRadius:10,boxShadow:'0 2px 8px rgba(15,23,42,0.06)'}}>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
          placeholder="Search name, designation..."
          style={{padding:'7px 11px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,fontSize:12,fontFamily:'inherit',color:TK.ink,background:TK.sunken,outline:'none',minWidth:200}}/>
        <select value={filterStage} onChange={e=>setFilterStage(e.target.value as any)}
          style={{padding:'7px 11px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,fontSize:12,fontFamily:'inherit',background:TK.sunken,color:TK.ink,outline:'none'}}>
          <option value="ALL">All stages</option>
          {(Object.keys(STAGE_META) as Stage[]).map(s=><option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <select value={filterRisk} onChange={e=>setFilterRisk(e.target.value as any)}
          style={{padding:'7px 11px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,fontSize:12,fontFamily:'inherit',background:TK.sunken,color:TK.ink,outline:'none'}}>
          <option value="ALL">All risk levels</option>
          <option value="HIGH">High risk only</option>
          <option value="MEDIUM">Medium risk</option>
          <option value="LOW">Low risk</option>
        </select>
        <div style={{marginLeft:'auto',fontSize:11,color:TK.muted}}>{filtered.length} of {total} shown</div>
        <button onClick={()=>{ const ni = filtered.filter(c=>c.status==='NOT_INVITED'); const all = ni.length>0 && ni.every(c=>selIds.has(c.id)); setSelIds(prev=>{ const n=new Set(prev); ni.forEach(c=>all?n.delete(c.id):n.add(c.id)); return n }) }} style={{padding:'7px 12px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',color:TK.brandDeep}}>Select all (not invited)</button>
        {filtered.some(c=>c.status==='NOT_INVITED'&&selIds.has(c.id)) && (
          <button onClick={bulkSend} disabled={saving} style={{padding:'7px 14px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:12,fontWeight:600,fontFamily:'inherit',opacity:saving?.6:1,display:'flex',alignItems:'center',gap:5}}>
            <i className="ti ti-send" style={{fontSize:14}} aria-hidden="true"/> Send link to {filtered.filter(c=>c.status==='NOT_INVITED'&&selIds.has(c.id)).length} selected
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{border:'1px solid rgba(37,99,235,0.12)',borderRadius:'10px',overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:TK.sunken}}>
                {['','Candidate','Stage','Progress','DOJ','Docs','Statutory','BGV','Risk','Actions'].map((h,hi)=>(
                  <th key={hi} style={{padding:'9px 12px',textAlign:'left',fontSize:10,fontWeight:500,color:TK.muted,textTransform:'uppercase',letterSpacing:'.04em',borderBottom:'1px solid rgba(37,99,235,0.12)',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{padding:32,textAlign:'center',color:TK.muted}}>No candidates found</td></tr>
              )}
              {filtered.map((c,i)=>{
                const sm  = STAGE_META[c.status]
                const notInvited = c.status==='NOT_INVITED'
                const pct = notInvited ? 0 : progressPct(c)
                const days = daysLeft(c.date_of_joining)
                return (
                  <tr key={c.id} style={{borderBottom:'1px solid rgba(37,99,235,0.12)',background:i%2===0?TK.surface:TK.sunken}}>
                    <td style={{padding:'10px 12px'}}>
                      {notInvited && <input type="checkbox" checked={selIds.has(c.id)} onChange={()=>setSelIds(prev=>{ const n=new Set(prev); n.has(c.id)?n.delete(c.id):n.add(c.id); return n })} />}
                    </td>
                    <td style={{padding:'10px 12px',minWidth:160}}>
                      <div style={{fontWeight:500}}>{c.full_name}</div>
                      <div style={{fontSize:10,color:TK.muted,marginTop:1}}>{c.designation || '—'}</div>
                      {c.employee_code && <div style={{fontSize:10,color:TK.positive,marginTop:1,fontWeight:600}}>{c.employee_code}</div>}
                    </td>
                    <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><Badge {...sm} label={sm.label}/></td>
                    <td style={{padding:'10px 12px',minWidth:100}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>—</span> : <>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:TK.muted,marginBottom:2}}>
                        <span>Step {c.current_step||1}/8</span><span>{pct}%</span>
                      </div>
                      <ProgressBar pct={pct} color={pct===100?TK.positive:pct>=60?P:TK.warning}/>
                      </>}
                    </td>
                    <td style={{padding:'10px 12px',whiteSpace:'nowrap',fontSize:11}}>
                      {fmt(c.date_of_joining)}
                      {days !== null && <div style={{fontSize:10,fontWeight:600,color:days<=3?TK.critical:days<=7?TK.warning:TK.positive}}>{days<0?`${Math.abs(days)}d ago`:days===0?'Today!':days===1?'Tomorrow':`D-${days}`}</div>}
                    </td>
                    <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>—</span> : <>
                      <span style={{fontSize:11}}>{c.docs_uploaded||0}/{DOCS_REQ.length}</span>
                      {(c.docs_ai_flagged||0)>0 && <div style={{fontSize:10,color:TK.warning,marginTop:1}}>⚠ {c.docs_ai_flagged} flagged</div>}
                      </>}
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      {notInvited ? <span style={{fontSize:11,color:TK.faint}}>—</span> : <>
                      <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.form11?'#EAF3DE':'#FCEBEB',color:c.form11?'#3B6D11':TK.critical,fontWeight:600}}>F11</span>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.form2?'#EAF3DE':'#FCEBEB',color:c.form2?'#3B6D11':TK.critical,fontWeight:600}}>F2</span>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.bank?'#EAF3DE':'#FCEBEB',color:c.bank?'#3B6D11':TK.critical,fontWeight:600}}>Bank</span>
                      </div>
                      <div style={{display:'flex',gap:3,marginTop:3}}>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.laptop_issued?'#EAF3DE':TK.brandTint,color:c.laptop_issued?'#3B6D11':P,fontWeight:600}}>
                          {c.laptop_issued?'':''}
                        </span>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.id_card_issued?'#EAF3DE':TK.brandTint,color:c.id_card_issued?'#3B6D11':P,fontWeight:600}}>
                          {c.id_card_issued?'':''}
                        </span>
                        <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background:c.policy_ack?'#EAF3DE':TK.brandTint,color:c.policy_ack?'#3B6D11':P,fontWeight:600}}>
                          {c.policy_ack?'Policy✓':'Policy'}
                        </span>
                      </div>
                      </>}
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      <span style={{fontSize:10,fontWeight:600,color:TK.muted}}>—</span>
                    </td>
                    <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><RiskBadge risk={c.ai_risk}/></td>
                    <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        {notInvited && (
                          <button onClick={()=>sendOnboardingFor(c)} disabled={saving} style={{padding:'4px 9px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:10,fontWeight:600,fontFamily:'inherit',opacity:saving?.6:1}}>
                            <i className="ti ti-send" style={{fontSize:11,verticalAlign:-1,marginRight:2}} aria-hidden="true"/>Send onboarding link
                          </button>
                        )}
                        {notInvited && (
                          <button onClick={()=>openDateEdit(c)} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:10,fontFamily:'inherit',color:TK.brandDeep}}>Edit</button>
                        )}
                        {c.status==='SUBMITTED' && (
                          <button onClick={()=>{openCodeModal(c)}} style={{padding:'4px 9px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:10,fontWeight:600,fontFamily:'inherit'}}>
                            <i className="ti ti-bolt" style={{fontSize:11,verticalAlign:-1,marginRight:2}} aria-hidden="true"/>Code
                          </button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button onClick={async()=>{
                            const link=`${window.location.origin}/onboarding/${c.magic_link_token}`
                            await navigator.clipboard.writeText(link).catch(()=>{})
                            showToast('Link copied!')
                          }} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:10,fontFamily:'inherit',color:TK.ink}}>
                            <i className="ti ti-copy" style={{fontSize:11,verticalAlign:-1,marginRight:2}} aria-hidden="true"/>Link
                          </button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button onClick={()=>resendLink(c)} disabled={resendingId===c.id} style={{padding:'4px 9px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:10,fontWeight:600,fontFamily:'inherit',opacity:resendingId===c.id?.6:1}}>
                            <i className="ti ti-send" style={{fontSize:11,verticalAlign:-1,marginRight:2}} aria-hidden="true"/>{resendingId===c.id?'Sending…':'Resend'}
                          </button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button onClick={()=>extendValidity(c)} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:10,fontFamily:'inherit',color:TK.ink}}>Extend</button>
                        )}
                        {(c.status==='INVITED'||c.status==='IN_PROGRESS') && (
                          <button onClick={()=>openDateEdit(c)} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:10,fontFamily:'inherit',color:TK.brandDeep}}>Edit</button>
                        )}
                        {(c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && !c.laptop_issued && (
                          <button onClick={()=>issueAsset(c.id,'LAPTOP')} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.warningTint,fontSize:10,fontFamily:'inherit',color: TK.warning}}>Issue
                          </button>
                        )}
                        {(c.status==='APPROVED'||c.status==='EMPLOYEE_CREATED') && !c.id_card_issued && (
                          <button onClick={()=>issueAsset(c.id,'ID_CARD')} style={{padding:'4px 9px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background: TK.brandTint,fontSize:10,fontFamily:'inherit',color: TK.brand}}>Issue
                          </button>
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
      HIGH:   {label:'Urgent — do today',     bg: TK.criticalTint, color:TK.critical, border: TK.criticalTint},
      MEDIUM: {label:'Important — this week',  bg:TK.warningTint, color:TK.warning, border: TK.warningTint},
      LOW:    {label:'When possible',          bg: TK.brandTint, color: TK.brand, border: TK.brandEdge},
    }
    return (
      <div>
        <SH title="Pending actions" sub="Priority-sorted. Resolve High first."/>
        {pendingActions.length === 0 && (
          <div style={{padding:40,textAlign:'center',color:TK.muted}}>
            <i className="ti ti-circle-check" style={{fontSize:40,color:TK.positive,display:'block',marginBottom:10}} aria-hidden="true"/>
            All clear! No pending actions.
          </div>
        )}
        {(['HIGH','MEDIUM','LOW'] as const).map(pri => groups[pri].length > 0 && (
          <div key={pri} style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:gMeta[pri].color,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:gMeta[pri].color,flexShrink:0}}/>
              {gMeta[pri].label} ({groups[pri].length})
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {groups[pri].map((a,i)=>{
                const cand = candidates.find(c=>c.id===a.cid)
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:gMeta[pri].bg,borderRadius:'8px',border:`1px solid ${gMeta[pri].border}`}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:500,color:TK.ink}}>{a.label}</div>
                      <div style={{fontSize:11,color:TK.muted,marginTop:1}}>
                        <i className="ti ti-user" style={{fontSize:11,verticalAlign:-1,marginRight:3}} aria-hidden="true"/>{a.candidate}
                        {cand?.date_of_joining && <span style={{marginLeft:8}}>· DOJ: {fmt(cand.date_of_joining)}</span>}
                      </div>
                    </div>
                    {a.action==='generate' && cand && (
                      <button onClick={()=>{openCodeModal(cand)}} style={{padding:'5px 12px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        <i className="ti ti-bolt" style={{fontSize:12,verticalAlign:-1,marginRight:3}} aria-hidden="true"/>Generate code
                      </button>
                    )}
                    {a.action==='followup' && cand && (
                      <button onClick={async()=>{
                        const link=`${window.location.origin}/onboarding/${cand.magic_link_token}`
                        await navigator.clipboard.writeText(link).catch(()=>{})
                        showToast('Link copied — send to candidate')
                      }} style={{padding:'5px 12px',borderRadius:'8px',border:`1px solid ${gMeta[pri].border}`,cursor:'pointer',background:TK.surface,fontSize:11,fontFamily:'inherit',color:gMeta[pri].color,whiteSpace:'nowrap'}}>
                        <i className="ti ti-copy" style={{fontSize:12,verticalAlign:-1,marginRight:3}} aria-hidden="true"/>Copy link
                      </button>
                    )}
                    {(a.action==='laptop'||a.action==='idcard') && cand && (
                      <button onClick={()=>issueAsset(cand.id,a.action==='laptop'?'LAPTOP':'ID_CARD')} style={{padding:'5px 12px',borderRadius:'8px',border:`1px solid ${gMeta[pri].border}`,cursor:'pointer',background:TK.surface,fontSize:11,fontFamily:'inherit',color:gMeta[pri].color,whiteSpace:'nowrap'}}>
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
        <SH title="AI insights" sub="Powered by EZER AI — updated on load"/>

        {/* Attrition risk */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
            <i className="ti ti-alert-triangle" style={{fontSize:15,color:TK.critical}} aria-hidden="true"/>
            Attrition & at-risk joiners ({atRisk.length})
          </div>
          {atRisk.length===0
            ? <div style={{padding:16,background: TK.sunken,borderRadius:'8px',fontSize:12,color: TK.positive}}>No at-risk candidates right now.</div>
            : atRisk.map(c=>(
              <div key={c.id} style={{background:TK.surface,border:`1px solid ${c.ai_risk==='HIGH'?'#F09595':'#FDE68A'}`,borderRadius:'8px',padding:'12px 14px',marginBottom:8,borderLeft:`3px solid ${c.ai_risk==='HIGH'?TK.critical:TK.warning}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{c.full_name} <RiskBadge risk={c.ai_risk}/></div>
                    <div style={{fontSize:11,color:TK.muted,marginTop:2}}>{c.designation} · DOJ: {fmt(c.date_of_joining)}</div>
                    <div style={{fontSize:11,color:c.ai_risk==='HIGH'?TK.critical:TK.warning,marginTop:4,fontStyle:'italic'}}>
                      <i className="ti ti-robot" style={{fontSize:12,verticalAlign:-1,marginRight:4}} aria-hidden="true"/>
                      {c.ai_risk_reason}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    {c.status==='SUBMITTED' && (
                      <button onClick={()=>{openCodeModal(c)}} style={{padding:'5px 10px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:10,fontFamily:'inherit'}}>Generate code</button>
                    )}
                  </div>
                </div>
                <ProgressBar pct={progressPct(c)} color={c.ai_risk==='HIGH'?TK.critical:TK.warning}/>
              </div>
            ))
          }
        </div>

        {/* Document AI flags */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
            <i className="ti ti-file-alert" style={{fontSize:15,color:TK.warning}} aria-hidden="true"/>
            Document AI flags ({flaggedDocs.length} candidates)
          </div>
          {flaggedDocs.length===0
            ? <div style={{padding:16,background: TK.sunken,borderRadius:'8px',fontSize:12,color: TK.positive}}>All uploaded documents verified by AI.</div>
            : flaggedDocs.map(c=>(
              <div key={c.id} style={{background:TK.warningTint,border: `1px solid ${TK.warningTint}`,borderRadius:'8px',padding:'10px 12px',marginBottom:6}}>
                <div style={{fontSize:12,fontWeight:500}}>{c.full_name}</div>
                <div style={{fontSize:11,color:TK.warning,marginTop:2}}>
                  <i className="ti ti-robot" style={{fontSize:11,verticalAlign:-1,marginRight:3}} aria-hidden="true"/>
                  {c.docs_ai_flagged} document(s) flagged — low confidence or mismatch detected. Manual review recommended.
                </div>
              </div>
            ))
          }
        </div>

        {/* Onboarding champions */}
        <div>
          <div style={{fontSize:12,fontWeight:500,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
            <i className="ti ti-star" style={{fontSize:15,color:TK.warning}} aria-hidden="true"/>
            Onboarding champions — 100% complete ({champs.length})
          </div>
          {champs.length===0
            ? <div style={{padding:16,background:TK.brandTint,borderRadius:'8px',fontSize:12,color:P}}>No 100% complete onboardings yet.</div>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
              {champs.map(c=>(
                <div key={c.id} style={{background: TK.sunken,border: `1px solid ${TK.positiveTint}`,borderRadius:'8px',padding:'10px 12px',textAlign:'center'}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:TK.positive,color:TK.onAccent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:500,margin:'0 auto 6px'}}>
                    {c.full_name.charAt(0)}
                  </div>
                  <div style={{fontSize:12,fontWeight:500,color: TK.positive}}>{c.full_name}</div>
                  <div style={{fontSize:10,color:TK.positive,marginTop:2}}>{c.employee_code||'Code pending'}</div>
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
        <SH title="Compliance tracker" sub="India-specific: PF / ESI / PT / BGV — employee-wise"/>

        {/* Summary row */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginBottom:16}}>
          {[
            {label:'Form 11 pending', val:active.filter(c=>!c.form11).length, color:TK.warning},
            {label:'Form 2 pending',  val:active.filter(c=>!c.form2).length,  color:TK.warning},
            {label:'Bank pending',    val:active.filter(c=>!c.bank).length,   color:TK.warning},
            {label:'Policy pending',  val:active.filter(c=>!c.policy_ack).length, color: TK.brand},
            {label:'Laptop pending',  val:active.filter(c=>!c.laptop_issued).length, color:P},
            {label:'ID card pending', val:active.filter(c=>!c.id_card_issued).length, color:P},
          ].map(({label,val,color})=>(
            <div key={label} style={{background:TK.sunken,borderRadius:'8px',padding:'10px 12px',borderLeft:`3px solid ${val>0?color:TK.positive}`}}>
              <div style={{fontSize:10,color:TK.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:'.04em',fontWeight:500}}>{label}</div>
              <div style={{fontSize:22,fontWeight:500,color:val>0?color:TK.positive}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Compliance grid */}
        <div style={{border:'1px solid rgba(37,99,235,0.12)',borderRadius:'10px',overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead>
                <tr style={{background:TK.sunken}}>
                  {['Employee','DOJ','EPF Form 11','EPF Form 2','Bank','Policy Ack','Laptop','ID Card','PT State','BGV'].map(h=>(
                    <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:9,fontWeight:600,color:TK.muted,textTransform:'uppercase',letterSpacing:'.04em',borderBottom:'1px solid rgba(37,99,235,0.12)',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.length===0 && (
                  <tr><td colSpan={10} style={{padding:24,textAlign:'center',color:TK.muted}}>No data</td></tr>
                )}
                {candidates.map((c,i)=>{
                  const ptState = (c.form_data as any)?.step_4?.perm_state || '—'
                  const Tick = ({done}:{done?:boolean}) => (
                    <span style={{fontSize:14,color:done?TK.positive:TK.warning}}>
                      {done
                        ? <i className="ti ti-circle-check" style={{verticalAlign:-1}} aria-hidden="true"/>
                        : <i className="ti ti-clock" style={{verticalAlign:-1}} aria-hidden="true"/>
                      }
                    </span>
                  )
                  return (
                    <tr key={c.id} style={{borderBottom:'1px solid rgba(37,99,235,0.12)',background:i%2===0?TK.surface:TK.sunken}}>
                      <td style={{padding:'9px 10px',minWidth:130}}>
                        <div style={{fontWeight:500,fontSize:12}}>{c.full_name}</div>
                        <div style={{fontSize:10,color:TK.muted}}>{c.designation||'—'}</div>
                        {c.employee_code && <div style={{fontSize:10,color:TK.positive,fontWeight:600}}>{c.employee_code}</div>}
                      </td>
                      <td style={{padding:'9px 10px',whiteSpace:'nowrap'}}>{fmt(c.date_of_joining)}</td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}><Tick done={c.form11}/></td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}><Tick done={c.form2}/></td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}><Tick done={c.bank}/></td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}><Tick done={c.policy_ack}/></td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}>
                        {c.laptop_issued
                          ? <span style={{fontSize:10,color:TK.positive,fontWeight:600}}>Issued</span>
                          : <button onClick={()=>issueAsset(c.id,'LAPTOP')} style={{fontSize:9,padding:'2px 7px',borderRadius:99,border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontFamily:'inherit',color:TK.muted}}>Issue</button>
                        }
                      </td>
                      <td style={{padding:'9px 10px',textAlign:'center'}}>
                        {c.id_card_issued
                          ? <span style={{fontSize:10,color:TK.positive,fontWeight:600}}>Issued</span>
                          : <button onClick={()=>issueAsset(c.id,'ID_CARD')} style={{fontSize:9,padding:'2px 7px',borderRadius:99,border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontFamily:'inherit',color:TK.muted}}>Issue</button>
                        }
                      </td>
                      <td style={{padding:'9px 10px',fontSize:11,color:TK.muted}}>{ptState}</td>
                      <td style={{padding:'9px 10px'}}>
                        <span style={{fontSize:10,color:TK.muted}}>—</span>
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
    {key:'overview',    icon:'ti-home',        label:'Overview'},
    {key:'candidates',  icon:'ti-users',       label:'All candidates', badge:total},
    {key:'pending',     icon:'ti-list-check',  label:'Pending actions', badge:pendingActions.filter(a=>a.priority==='HIGH').length||undefined},
    {key:'insights',    icon:'ti-brain',       label:'AI insights',    badge:highRisk||undefined},
    {key:'compliance',  icon:'ti-shield-check',label:'Compliance'},
  ]

  return (
    <div style={{background:TK.canvas,minHeight:'100vh',fontFamily:'"DM Sans","Segoe UI",sans-serif',color:TK.ink}}>

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
            <div style={{fontSize:20,fontWeight:700,color:TK.ink,letterSpacing:'-.02em'}}>Onboarding</div>
            <div style={{fontSize:13,color:TK.muted,marginTop:3}}>
              {active} active · {thisWeek} joining this week
            </div>
          </div>
          <button onClick={()=>setTab('candidates')} className="ez-press" style={{padding:'9px 16px',borderRadius:8,cursor:'pointer',background:TK.brand,border:`1px solid ${TK.brand}`,color:TK.onAccent,fontSize:12,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:6,boxShadow:E.brand}}>
            <i className="ti ti-send" style={{fontSize:14}} aria-hidden="true"/> Send onboarding links
          </button>
        </div>

        {/* Tab nav */}
        <div style={{display:'flex',gap:6,paddingBottom:14,flexWrap:'wrap'}}>
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)}
              className="ez-tab" data-on={tab===t.key ? '1' : '0'}
              style={{padding:'7px 13px',cursor:'pointer',fontSize:12,fontWeight:tab===t.key?600:500,fontFamily:'inherit',
                background: tab===t.key ? TK.brand : 'transparent',
                color: tab===t.key ? TK.onAccent : TK.muted,
                border: `1px solid ${tab===t.key ? TK.brand : TK.line}`,
                display:'flex',alignItems:'center',gap:5}}>
              <i className={`ti ${t.icon}`} style={{fontSize:14}} aria-hidden="true"/>
              {t.label}
              {t.badge!==undefined && t.badge > 0 && (
                <span style={{fontSize:9,padding:'1px 5px',borderRadius:99,background: t.key==='pending' ? TK.critical : (tab===t.key ? `color-mix(in srgb, ${TK.onAccent} 24%, transparent)` : TK.sunken),color: t.key==='pending' ? TK.onAccent : (tab===t.key ? TK.onAccent : TK.muted),fontWeight:600,minWidth:16,textAlign:'center'}}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
        {loading
          ? <div style={{textAlign:'center',padding:60,color:TK.muted}}>Loading onboarding data...</div>
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
          <div style={{background:TK.surface,borderRadius:'16px',padding:'20px 22px',width:'100%',maxWidth:520,boxShadow:'0 20px 60px rgba(0,0,0,.2)',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:500}}>Send joining link to new candidate</div>
              <button onClick={()=>setLinkModal(false)} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:TK.muted,lineHeight:1}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div style={{marginBottom:8,gridColumn:'1 / -1'}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Company *</div>
                <select value={newForm.company_id} onChange={e=>setNewForm(f=>({...f,company_id:e.target.value}))}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
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
                  <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{label}</div>
                  <input type={type} placeholder={placeholder} value={(newForm as any)[key]} onChange={e=>setNewForm(f=>({...f,[key]:e.target.value}))}
                    style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Department</div>
                <select value={newForm.department_id} onChange={e=>{ const d = departments.find(x=>x.id===e.target.value); setNewForm(f=>({...f, department_id:e.target.value, department: d?.dept_name || ''})) }}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
                  <option value="">Select department…</option>
                  {departments.filter(d=>!newForm.company_id||d.company_id===newForm.company_id).map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Employment Type</div>
                <select value={newForm.employment_type} onChange={e=>setNewForm(f=>({...f,employment_type:e.target.value}))}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
                  <option>Employee</option><option>Intern</option><option>Consultant</option><option>Contract</option><option>NAPS</option><option>NATS</option>
                </select>
              </div>
            </div>
            <div style={{background:TK.brandTint,borderRadius:'8px',padding:'9px 12px',marginTop:4,fontSize:11,color: TK.muted,lineHeight:1.7}}>
              <i className="ti ti-info-circle" style={{fontSize:12,verticalAlign:-1,marginRight:4}} aria-hidden="true"/>
              A 24-hour onboarding link will be generated. Share with candidate via email or WhatsApp. OTP will be sent to their mobile for verification.
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setLinkModal(false)} style={{padding:'9px 16px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',color:TK.ink}}>Cancel</button>
              <button onClick={sendMagicLink} disabled={saving} style={{flex:1,padding:'9px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:13,fontWeight:500,fontFamily:'inherit',opacity:saving?.6:1}}>
                {saving ? 'Generating...' : 'Generate & send onboarding link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT ONBOARDING DATE MODAL ───────────────────────── */}
      {dateModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:TK.surface,borderRadius:'16px',padding:'20px 22px',width:'100%',maxWidth:420,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:500}}>Edit candidate — {dateModal.full_name}</div>
              <button onClick={()=>setDateModal(null)} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:TK.muted,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Joining / Onboarding Date</div>
            <input type="date" value={dateVal} onChange={e=>setDateVal(e.target.value)}
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box',marginBottom:10}}/>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Email</div>
            <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder="candidate@email.com"
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box',marginBottom:10}}/>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Mobile</div>
            <input type="tel" value={editMobile} onChange={e=>setEditMobile(e.target.value)} placeholder="+91 XXXXXXXXXX"
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'8px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}/>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setDateModal(null)} style={{padding:'9px 16px',borderRadius:'8px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',color:TK.ink}}>Cancel</button>
              <button onClick={saveDate} disabled={saving} style={{flex:1,padding:'9px',borderRadius:'8px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:13,fontWeight:500,fontFamily:'inherit',opacity:saving?.6:1}}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HR ACTIVATION WIZARD ─────────────────────────────── */}
      {codeModal && (
        <ActivationWizard
          candidate={codeModal}
          genCode={genCode} setGenCode={setGenCode}
          codeType={codeType} codeLoading={codeLoading} saving={saving}
          onGenerate={generateCode}
          onClose={() => setCodeModal(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    </div>
  )
}
