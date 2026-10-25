// app/dashboard/onboarding/page.tsx
// EZER HRMS — Onboarding Admin Dashboard
// 5 tabs: Overview | All Candidates | Pending Actions | AI Insights | Compliance
'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { canSeeScreen } from '@/lib/rms/resolve'
import { companyFilter, scopedCompanies, defaultCompanyId } from '@/lib/rms/resolve'
// send-magic-link / resend-link are guarded server-side now, so the session goes along.
import { authHeaders } from '@/lib/auth-headers'
import GenerateCodeModal from '@/components/onboarding/GenerateCodeModal'
import ReviewDrawer from '@/components/onboarding/ReviewDrawer'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, R, E, Z, tone as toneOf, IconChevron, IconCheck, IconPlus } from '@/lib/ui'
import { ApprovalsCell, type Readiness } from '@/components/onboarding/ApprovalTrail'
import { AnchoredPopover, MenuItem } from '@/components/onboarding/AnchoredPopover'
import { approvalTrail, dayLabel, daysFromToday, relDays, type ApprovalRow, type Holder, type TrailTeam, type Trail } from '@/lib/onboarding/approval-trail'

// ── Types ─────────────────────────────────────────────────────────
type Stage = 'NOT_INVITED'|'INVITED'|'IN_PROGRESS'|'SUBMITTED'|'HR_REVIEW'|'APPROVED'|'EMPLOYEE_CREATED'
type RiskLevel = 'LOW'|'MEDIUM'|'HIGH'
type Tab = 'overview'|'candidates'|'pending'|'insights'|'compliance'
type Holders = Record<string, Partial<Record<TrailTeam, Holder[]>>>

interface Candidate {
  /** Every onboarding_approvals row on record (team, status, who, when, remark). */
  approvals?: ApprovalRow[]
  docs_required_have?: number; docs_required_total?: number; docs_rejected?: number
  it_laptop_issued?: boolean | null; admin_id_card?: boolean | null
  /** The HR Manager's assignments (lib/onboarding/hr-assignment.ts): managers from the review sheet (Assign managers), then the team + roles recorded at Generate code. */
  role_assignment?: { managers?: { l1_name?: string | null; l2_name?: string | null; hod_name?: string | null }; roles?: { role_code: string; role_name: string }[]; team?: { summary?: string; count?: number }; by_name?: string | null; at?: string } | null
  l1_manager_id?: string | null; l2_manager_id?: string | null; hod_id?: string | null
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
// Colour says whose move it is: neutral = the candidate's, warning = HR's, info = the teams',
// positive = done / ready. Every stage reads as words too, never colour alone.
const stageTone = (t: 'neutral'|'brand'|'warning'|'info'|'positive'|'critical') => { const k = toneOf(t); return { bg: k.bg, color: k.fg, edge: k.edge } }
const STAGE_META: Record<Stage, {label:string; bg:string; color:string; edge:string}> = {
  NOT_INVITED:      { label:'Not invited',          ...stageTone('neutral') },
  INVITED:          { label:'Link sent',            ...stageTone('neutral') },
  IN_PROGRESS:      { label:'Filling the form',     ...stageTone('brand') },
  SUBMITTED:        { label:'HR to review',         ...stageTone('warning') },
  HR_REVIEW:        { label:'With the teams',       ...stageTone('info') },
  APPROVED:         { label:'Ready for code',       ...stageTone('positive') },
  EMPLOYEE_CREATED: { label:'Employee created',     ...stageTone('positive') },
}
const RETURNED_META = { label:'Returned for fixes', ...stageTone('critical') }
// The documents the portal will not submit without (app/onboarding/[token]/client.tsx DOC_LIST);
// the experience letter too unless the candidate ticked Fresher.
const DOCS_REQ = ['AADHAAR_FRONT','AADHAAR_BACK','PAN','PHOTO','DEGREE','BANK_PROOF']

// ── Small helpers ─────────────────────────────────────────────────
// One date format on every onboarding screen: "12 Oct 2026".
const fmt = (s?: string | null) => dayLabel(s)
const daysLeft = (doj?: string | null) => daysFromToday(doj)
const isReturned = (c: Candidate) => c.status === 'IN_PROGRESS' && (c.hr_review?.outcome === 'RETURNED' || (c.approvals || []).some(a => a.status === 'RETURNED'))

/**
 * Sticky bars on this page must sit BELOW the host's own sticky bar — the ESS top bar with
 * the Manage menus — not slide underneath it. The host is not ours to change, so measure it:
 * the nearest earlier sibling (of this page or an ancestor) that is sticky at top 0 and is a
 * bar, not a full-height rail. Its height goes in --ob-top on the page root; 0 on /dashboard.
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

const Badge = ({ label, bg, color, edge, title }: {label:string;bg:string;color:string;edge?:string;title?:string}) => (
  <span title={title} style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:bg,color,fontWeight:600,display:'inline-flex',alignItems:'center',whiteSpace:'nowrap',lineHeight:1.5,border:`1px solid ${edge || 'transparent'}`}}>{label}</span>
)
const RISK_META: Record<RiskLevel,{label:string;t:'neutral'|'warning'|'critical'}> = {
  LOW:    {label:'Low',    t:'neutral'},
  MEDIUM: {label:'Medium', t:'warning'},
  HIGH:   {label:'High',   t:'critical'},
}
const RiskBadge = ({ risk, reason, long }: {risk?: RiskLevel; reason?: string; long?: boolean}) => {
  if (!risk) return null
  const k = toneOf(RISK_META[risk].t)
  return <Badge label={`${RISK_META[risk].label}${long ? ' risk' : ''}`} bg={k.bg} color={risk==='LOW'?TK.muted:k.fg} edge={k.edge} title={reason || undefined}/>
}

function Toast({msg,type,onClose}:{msg:string;type:'ok'|'err';onClose:()=>void}) {
  // Errors stay a little longer — they are usually something to act on.
  useEffect(()=>{const t=setTimeout(onClose,type==='err'?6000:3500);return()=>clearTimeout(t)},[onClose,type])
  return <div role="status" style={{position:'fixed',bottom:24,right:24,zIndex:Z.toast,borderRadius:10,padding:'12px 20px',fontSize:13,fontWeight:500,background:type==='ok'?TK.positive:TK.critical,color:TK.onAccent,boxShadow:E.overlay,maxWidth:380,lineHeight:1.45}}>{msg}</div>
}

function ProgressBar({pct,color=P}:{pct:number;color?:string}) {
  return (
    <div style={{height:5,background:TK.sunken,borderRadius:99,overflow:'hidden',marginTop:4}}>
      <div style={{height:'100%',background:color,borderRadius:99,width:`${pct}%`,transition:'width .4s'}}/>
    </div>
  )
}

type RowAction = { label: string; hint?: string; onClick: () => void; disabled?: boolean; kind?: 'primary' | 'go' | 'outline' }

/** A row's actions: one primary button, the rest behind "⋯" — so every row is one line high. */
function RowActions({ name, primary, more }: { name: string; primary?: RowAction | null; more: RowAction[] }) {
  const btn: React.CSSProperties = { padding:'5px 10px', borderRadius:R.sm, fontSize:12, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap', cursor:'pointer', lineHeight:1.4 }
  const skin = (k?: RowAction['kind']): React.CSSProperties =>
    k === 'go' ? { background:TK.positive, color:TK.onAccent, border:`1px solid ${TK.positive}` }
    : k === 'outline' ? { background:TK.surface, color:TK.brandDeep, border:`1px solid ${TK.brandEdge}` }
    : { background:TK.brand, color:TK.onAccent, border:`1px solid ${TK.brand}` }
  return (
    <div style={{ display:'flex', gap:5, alignItems:'center', justifyContent:'flex-end' }}>
      {primary && <button type="button" onClick={primary.onClick} disabled={primary.disabled} title={primary.hint} style={{ ...btn, ...skin(primary.kind) }}>{primary.label}</button>}
      {more.length > 0 && (
        <AnchoredPopover label={`More actions for ${name}`} width={230} align="end" triggerTitle="More actions"
          triggerStyle={{ ...btn, padding:'5px 7px', background:TK.surface, color:TK.inkSoft, border:`1px solid ${TK.line}`, letterSpacing:'.08em' }}
          trigger={<span aria-hidden="true">⋯</span>}>
          {close => (
            <div role="menu" style={{ padding:5 }}>
              {more.map(a => <MenuItem key={a.label} hint={a.hint} disabled={a.disabled} onClick={() => { close(); a.onClick() }}>{a.label}</MenuItem>)}
            </div>
          )}
        </AnchoredPopover>
      )}
      {!primary && !more.length && <span style={{ fontSize:11, color:TK.faint }}>—</span>}
    </div>
  )
}

const POP_CSS = `.ob-mi:not(:disabled):hover,.ob-mi:focus-visible{background:${TK.sunken};outline:none}
  .ob-row:hover td{background:${TK.brandTint}}
  .ob-row td{vertical-align:middle}`

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
  const [codeModal,    setCodeModal]  = useState<Candidate|null>(null)   // Generate code — team, roles, code (GenerateCodeModal)
  const [saving,       setSaving]     = useState(false)
  const [dateModal,    setDateModal]  = useState<Candidate|null>(null)
  const [dateVal,      setDateVal]    = useState('')
  const [editEmail,    setEditEmail]  = useState('')
  const [editMobile,   setEditMobile] = useState('')
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
      // A document code can have more than one row (a re-upload, a carried-over pre-offer copy),
      // and most codes are optional — so "uploaded / required" counts DISTINCT required codes.
      // It used to divide every row by the six required ones and showed "16/6".
      const codes     = new Set((docs||[]).map(d=>d.doc_code))
      const required  = [...DOCS_REQ, ...(c.form_data?.step_5 && c.form_data.step_5.is_fresher !== true ? ['EXP_LETTER'] : [])]
      const flagged   = (docs||[]).filter(d=>d.ai_status==='MISMATCH'||d.ai_status==='FAILED').length
      const rejected  = (docs||[]).filter(d=>d.hr_verified===false).length
      const formTypes = (forms||[]).map(f=>f.form_type)
      const laptop    = (assets||[]).find(a=>a.asset_type==='LAPTOP')
      const idCard    = (assets||[]).find(a=>a.asset_type==='ID_CARD')

      // Compute AI risk
      let risk: RiskLevel = 'LOW'
      let riskReason = ''
      const days = daysLeft(c.date_of_joining)
      if (days !== null && days < 0 && c.status !== 'EMPLOYEE_CREATED') { risk='HIGH'; riskReason=`Joining date passed ${relDays(days)} — onboarding not complete` }
      else if (days !== null && days <= 3 && c.status !== 'EMPLOYEE_CREATED') { risk='HIGH'; riskReason=`Joining ${relDays(days)} — onboarding not complete` }
      else if (flagged > 0 && c.status !== 'EMPLOYEE_CREATED') { risk='MEDIUM'; riskReason=`${flagged} document${flagged===1?'':'s'} flagged by the AI check` }
      else if (c.status==='INVITED' && days !== null && days <= 7) { risk='MEDIUM'; riskReason='Link not opened, joining close' }
      else if (days === null && c.status !== 'EMPLOYEE_CREATED') { risk='MEDIUM'; riskReason='No date of joining set' }

      return {
        ...c,
        docs_uploaded:   codes.size,
        docs_required_have:  required.filter(r => codes.has(r)).length,
        docs_required_total: required.length,
        docs_ai_flagged: flagged,
        docs_rejected:   rejected,
        form11:          formTypes.includes('EPF_FORM11'),
        form2:           formTypes.includes('EPF_FORM2'),
        bank:            formTypes.includes('BANK_MANDATE'),
        // The portal records each policy acknowledgement in onboarding_policy_acks; nothing ever
        // wrote form_data.step_8.declaration_accepted, so this read "Policy pending" for everyone.
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

    // Who acts for each approval team in these companies — names for the approvals popover.
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
    if (!employment_type) need.push('employment type')
    if (need.length) { showToast(`Required: ${need.join(', ')}.`,'err'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/send-magic-link', {
        method:'POST', headers: await authHeaders(),
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
    if (!companyId) { if (!bulk) showToast('This candidate has no company set — open them in Recruitment → Negotiation and pick a company first.','err'); return false }
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
    // The joining date and the email are required everywhere else (the link, Generate code);
    // the edit must not be the one place that can blank them.
    if (!dateVal) { showToast('The date of joining is required.','err'); return }
    if (editEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(editEmail.trim())) { showToast('That email does not look right.','err'); return }
    if (editMobile && !/^[6-9]\d{9}$/.test(editMobile.replace(/\D/g,'').slice(-10))) { showToast('The mobile must be a 10-digit Indian number.','err'); return }
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
      showToast(data.emailed ? (data.corrections ? `Link re-sent to ${c.email} with the list of corrections ✉️` : `Onboarding link re-sent to ${c.email} ✉️`) : `Link refreshed — email NOT sent (${data.email_error || 'no email'}). Copy it instead.`, data.emailed ? 'ok' : 'err')
    } catch(e:any) { showToast('Resend failed: '+e.message, 'err') }
    setResendingId('')
  }

  // ── Generate code: the modal (components/onboarding/GenerateCodeModal) does the work —
  //    the team, the roles, the code — and reports back through onDone. ──
  const openCodeModal = (candidate: Candidate) => setCodeModal(candidate)

  // ── Issue asset ───────────────────────────────────────────────
  const issueAsset = async (candidateId: string, assetType: 'LAPTOP'|'ID_CARD') => {
    // A recruitment joiner who has not been sent the link has no onboarding record to hang it on.
    if (candidateId.startsWith('rec_')) { showToast('Send the onboarding link first — there is no onboarding record yet.','err'); return }
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
      // Flagged documents matter while HR still has to look at them — on the review sheet.
      const f = c.docs_ai_flagged || 0
      actions.push({priority:'HIGH',label:`Form submitted — review the documents and details${f ? ` (${f} document${f===1?'':'s'} flagged by the AI check)` : ''}`,candidate:c.full_name,action:'review',cid:c.id})
    }
    if (c.status==='HR_REVIEW') {
      actions.push({priority:'MEDIUM',label:`Accepted by HR — now with ${trailOf(c).nowWith} for their checklist (ESS → HRIS → Tasks & Approvals)`,candidate:c.full_name,action:'approvals',cid:c.id})
    }
    if (c.status==='APPROVED') {
      actions.push({priority:'HIGH',label:'IT, Admin and Payroll approved — generate the employee code (their team, ESS roles and the code; the login is mailed to them)',candidate:c.full_name,action:'generate',cid:c.id})
    }
    if (c.status==='IN_PROGRESS' && c.hr_review?.outcome==='RETURNED') {
      const n = (c.hr_review.documents||[]).length, m = (c.hr_review.details||[]).length
      actions.push({priority:'MEDIUM',label:`Returned to candidate — ${n} document${n===1?'':'s'} rejected, ${m} detail${m===1?'':'s'} flagged; resend the link if they have not acted`,candidate:c.full_name,action:'returned',cid:c.id})
    }
    if (c.status==='NOT_INVITED' && days!==null && days<=7) actions.push({priority:days<=3?'HIGH':'MEDIUM',label:`Onboarding link not sent — joining ${relDays(days)}`,candidate:c.full_name,action:'send',cid:c.id})
    if (c.status==='INVITED' && days!==null && days<=5) actions.push({priority:'HIGH',label:'Link not opened — follow up candidate',candidate:c.full_name,action:'followup',cid:c.id})
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
      {/* Stat cards — white, the figure in ink; colour only where it is a signal. Each opens the list it counts. */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:18}}>
        {([
          {label:'Active onboarding',  val:active,         t:'neutral',  go:()=>{ setFilterStage('ALL'); setJoinWindow('all'); setFilterRisk('ALL'); setTab('candidates') }},
          {label:'Joining this week',  val:thisWeek,       t:'neutral',  go:()=>{ setFilterStage('ALL'); setFilterRisk('ALL'); setJoinWindow('week'); setTab('candidates') }},
          {label:'Awaiting HR review', val:awaitingReview, t:'warning',  go:()=>{ setJoinWindow('all'); setFilterRisk('ALL'); setFilterStage('SUBMITTED'); setTab('candidates') }},
          {label:'Awaiting code',      val:submitted,      t:'positive', go:()=>{ setJoinWindow('all'); setFilterRisk('ALL'); setFilterStage('APPROVED'); setTab('candidates') }},
          {label:'High risk',          val:highRisk,       t:'critical', go:()=>{ setJoinWindow('all'); setFilterStage('ALL'); setFilterRisk('HIGH'); setTab('candidates') }},
          {label:'Completed',          val:joined,         t:'neutral',  go:()=>{ setJoinWindow('all'); setFilterRisk('ALL'); setFilterStage('EMPLOYEE_CREATED'); setTab('candidates') }},
        ] as const).map(({label,val,t,go})=>(
          <button key={label} type="button" onClick={go} className="ez-press" style={{textAlign:'left',background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:R.md,padding:'12px 14px',cursor:'pointer',fontFamily:'inherit',boxShadow:E.flat}}>
            <div style={{fontSize:11,color:TK.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>{label}</div>
            <div style={{fontSize:24,fontWeight:700,color:val>0&&t!=='neutral'?toneOf(t).fg:TK.ink,fontVariantNumeric:'tabular-nums'}}>{val}</div>
          </button>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>

        {/* Quick actions */}
        <div>
          <SH title="Quick actions"/>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button onClick={()=>{ setFilterStage('NOT_INVITED'); setJoinWindow('all'); setTab('candidates') }} className="ez-cta"
              style={{
                padding:'13px 16px', borderRadius:R.md, border:`1px solid ${TK.brand}`,
                cursor:'pointer', background:TK.brand,
                color:TK.onAccent, fontSize:14, fontWeight:600, fontFamily:'inherit',
                textAlign:'left', display:'flex', alignItems:'center', gap:11, width:'100%',
              }}>
                            <span style={{flex:1}}>Send onboarding links</span>
              <span style={{fontSize:12, fontWeight:500, opacity:.85}}>{candidates.filter(c=>c.status==='NOT_INVITED').length} not invited</span>
              <span className="ez-cta-arrow" style={{display:'flex'}}><IconChevron size={16} /></span>
            </button>
            <button onClick={()=>setTab('pending')} style={{padding:'11px 14px',borderRadius:R.md,border: `1px solid ${TK.line}`,cursor:'pointer',background:TK.surface,fontSize:12.5,fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8,color:TK.ink}}>
              View {pendingActions.filter(a=>a.priority==='HIGH').length} urgent pending actions
            </button>
            <button onClick={()=>setTab('compliance')} style={{padding:'11px 14px',borderRadius:R.md,border: `1px solid ${TK.line}`,cursor:'pointer',background:TK.surface,fontSize:12.5,fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8,color:TK.ink}}>
              Review PF / ESI / BGV compliance status
            </button>
          </div>

          {/* AI alerts */}
          {highRisk > 0 && (
            <div style={{marginTop:14,background: TK.criticalTint,border: `1px solid ${TK.criticalEdge}`,borderRadius:'10px',padding:'12px 14px'}}>
              <div style={{fontSize:12,fontWeight:500,color: TK.critical,marginBottom:8}}>
                                AI flagged {highRisk} high-risk joining{highRisk>1?'s':''}
              </div>
              {candidates.filter(c=>c.ai_risk==='HIGH').slice(0,3).map(c=>(
                <div key={c.id} style={{fontSize:11,color:TK.critical,marginBottom:4,display:'flex',alignItems:'center',gap:5}}>
                  {c.full_name} — {c.ai_risk_reason}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* This week joiners */}
        <div>
          <SH title="Joining this week" sub="Today and the next 7 days"/>
          {candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).length === 0
            ? <div style={{padding:20,textAlign:'center',color:TK.muted,fontSize:12}}>No joinings this week</div>
            : candidates.filter(c=>{ const d=daysLeft(c.date_of_joining); return d!==null&&d>=0&&d<=7 }).map(c=>{
              const days = daysLeft(c.date_of_joining)!
              const pct  = progressPct(c)
              const sm   = STAGE_META[c.status]
              return (
                <div key={c.id} style={{background:TK.surface,border:'1px solid var(--ez-line)',borderRadius:'10px',padding:'10px 12px',marginBottom:8,borderLeft:`3px solid ${days<=1?TK.critical:days<=3?TK.warning:P}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500}}>{c.full_name}</div>
                      <div style={{fontSize:11,color:TK.muted,marginTop:1}}>{c.designation}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,fontWeight:600,color:days<=1?TK.critical:days<=3?TK.warning:P}}>
                        {days===0?'Today':days===1?'Tomorrow':`In ${days} days`}
                      </div>
                      <Badge {...sm} label={sm.label}/>
                    </div>
                  </div>
                  <div style={{fontSize:10.5,color:TK.muted,marginTop:4}}>Joining {fmt(c.date_of_joining)}</div>
                  <ProgressBar pct={pct} color={pct===100?TK.positive:days<=3?TK.critical:P}/>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:5,fontSize:10,color:TK.muted}}>
                    <span>Step {c.current_step||1}/8 · {pct}% complete</span>
                    {c.status==='SUBMITTED' && (
                      <button onClick={()=>setReviewing({ id: c.id, readOnly: false })} style={{fontSize:10,padding:'2px 8px',borderRadius:99,border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontFamily:'inherit'}}>
                        Review form
                      </button>
                    )}
                    {c.status==='APPROVED' && (
                      <button onClick={()=>{openCodeModal(c)}} style={{fontSize:10,padding:'2px 8px',borderRadius:99,border:'none',cursor:'pointer',background:TK.positive,color:TK.onAccent,fontFamily:'inherit'}}>
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

  // ── Row actions: one primary, the rest behind "⋯" ─────────────
  const copyLink = async (c: Candidate) => {
    const link = `${window.location.origin}/onboarding/${c.magic_link_token}`
    try { await navigator.clipboard.writeText(link); showToast('Link copied — paste it to the candidate') }
    catch { showToast(`Copy failed — the link is ${link}`, 'err') }
  }
  const actionsFor = (c: Candidate): { primary: RowAction | null; more: RowAction[] } => {
    const more: RowAction[] = []
    const asset = () => {
      if (!c.laptop_issued) more.push({ label:'Mark laptop issued', hint:'IT usually confirms it on their checklist', onClick:()=>issueAsset(c.id,'LAPTOP') })
      if (!c.id_card_issued) more.push({ label:'Mark ID card issued', hint:'Admin usually confirms it on their checklist', onClick:()=>issueAsset(c.id,'ID_CARD') })
    }
    switch (c.status) {
      case 'NOT_INVITED':
        more.push({ label:'Edit details', hint:'Joining date, email, mobile', onClick:()=>openDateEdit(c) })
        return { primary:{ label:'Send link', onClick:()=>sendOnboardingFor(c), disabled:saving, hint:'Email the onboarding link (valid 24 hours)' }, more }
      case 'INVITED':
      case 'IN_PROGRESS':
        more.push({ label:'Copy link', onClick:()=>copyLink(c) })
        more.push({ label:'Extend validity', hint:'+7 days, without re-mailing', onClick:()=>extendValidity(c) })
        more.push({ label:'Edit details', hint:'Joining date, email, mobile', onClick:()=>openDateEdit(c) })
        return { primary:{ label: resendingId===c.id ? 'Sending…' : 'Resend link', onClick:()=>resendLink(c), disabled:resendingId===c.id, kind: isReturned(c) ? 'primary' : 'outline', hint: isReturned(c) ? 'Re-send the link with the list of corrections' : 'Mail the link again (a fresh 24 hours)' }, more }
      case 'SUBMITTED':
        return { primary:{ label:'Review form', onClick:()=>setReviewing({ id:c.id, readOnly:false }) }, more }
      case 'HR_REVIEW':
        return { primary:{ label:'View form', kind:'outline', onClick:()=>setReviewing({ id:c.id, readOnly:true }) }, more }
      case 'APPROVED':
        more.push({ label:'View form', onClick:()=>setReviewing({ id:c.id, readOnly:true }) })
        asset()
        return { primary:{ label:'Generate code', kind:'go', onClick:()=>openCodeModal(c), hint:`IT, Admin and Payroll have approved — the team, ESS roles and the employee code${c.role_assignment?.managers?.l1_name ? ` · reports to ${c.role_assignment.managers.l1_name}` : ''}` }, more }
      case 'EMPLOYEE_CREATED':
        asset()
        return { primary:{ label:'View form', kind:'outline', onClick:()=>setReviewing({ id:c.id, readOnly:true }) }, more }
    }
    return { primary:null, more }
  }

  // ── ALL CANDIDATES TAB ─────────────────────────────────────────
  const ctl: React.CSSProperties = {padding:'7px 11px',borderRadius:R.sm,border:`1px solid ${TK.lineStrong}`,fontSize:12.5,fontFamily:'inherit',color:TK.ink,background:TK.surface,outline:'none'}
  const th: React.CSSProperties = {padding:'9px 7px',textAlign:'left',fontSize:11,fontWeight:600,color:TK.muted,textTransform:'uppercase',letterSpacing:'.05em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap',background:TK.sunken}
  const td: React.CSSProperties = {padding:'9px 7px',borderBottom:`1px solid ${TK.line}`}
  const CandidatesTab = () => {
    const notInvitedShown = filtered.filter(c=>c.status==='NOT_INVITED')
    const selCount = notInvitedShown.filter(c=>selIds.has(c.id)).length
    const filtersOn = filterStage!=='ALL' || filterRisk!=='ALL' || joinWindow!=='all' || !!searchQ
    return (
    <div>
      {/* Toolbar — sticky, below the host's own sticky bar (--ob-top), on a solid ground so
          nothing scrolling underneath shows through. */}
      <div style={{position:'sticky',top:'var(--ob-top, 0px)',zIndex:Z.sticky,background:TK.canvas,padding:'10px 0',marginBottom:6,display:'flex',flexDirection:'column',gap:8,boxShadow:`0 1px 0 ${TK.line}`}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search name or designation…" aria-label="Search candidates" style={{...ctl,minWidth:200,flex:'1 1 200px',maxWidth:300}}/>
          <select value={filterStage} onChange={e=>setFilterStage(e.target.value as any)} aria-label="Stage" style={ctl}>
            <option value="ALL">All stages</option>
            {(Object.keys(STAGE_META) as Stage[]).map(s=><option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </select>
          <select value={filterRisk} onChange={e=>setFilterRisk(e.target.value as any)} aria-label="Risk" style={ctl}>
            <option value="ALL">All risk levels</option>
            <option value="HIGH">High risk</option>
            <option value="MEDIUM">Medium risk</option>
            <option value="LOW">Low risk</option>
          </select>
          <div role="group" aria-label="Joining" style={{display:'inline-flex',border:`1px solid ${TK.lineStrong}`,borderRadius:R.sm,overflow:'hidden',background:TK.surface}}>
            {([
              {k:'all',   label:'Any date'},
              {k:'today', label:'Today'},
              {k:'3days', label:'3 days'},
              {k:'week',  label:'7 days'},
              {k:'month', label:'30 days'},
            ] as {k:typeof joinWindow;label:string}[]).map((w,wi)=>(
              <button key={w.k} type="button" onClick={()=>setJoinWindow(w.k)} aria-pressed={joinWindow===w.k}
                style={{padding:'6px 10px',border:'none',borderLeft:wi?`1px solid ${TK.line}`:'none',cursor:'pointer',fontSize:12,fontWeight:joinWindow===w.k?700:500,fontFamily:'inherit',background:joinWindow===w.k?TK.brandTint:'transparent',color:joinWindow===w.k?TK.brandDeep:TK.inkSoft}}>
                {w.label}
              </button>
            ))}
          </div>
          {filtersOn && <button type="button" onClick={()=>{ setFilterStage('ALL'); setFilterRisk('ALL'); setJoinWindow('all'); setSearchQ('') }} style={{...ctl,border:'none',background:'transparent',color:TK.brandDeep,fontWeight:600,cursor:'pointer',padding:'7px 4px'}}>Clear filters</button>}
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12,color:TK.muted,whiteSpace:'nowrap'}}>{filtered.length} shown</span>
            {notInvitedShown.length > 0 && (
              <button type="button" onClick={()=>{ const all = notInvitedShown.every(c=>selIds.has(c.id)); setSelIds(prev=>{ const n=new Set(prev); notInvitedShown.forEach(c=>all?n.delete(c.id):n.add(c.id)); return n }) }}
                style={{...ctl,cursor:'pointer',color:TK.brandDeep,fontWeight:600,whiteSpace:'nowrap'}}>
                {notInvitedShown.every(c=>selIds.has(c.id)) ? 'Clear selection' : `Select ${notInvitedShown.length} not invited`}
              </button>
            )}
            {selCount > 0 && (
              <button type="button" onClick={bulkSend} disabled={saving} style={{...ctl,border:`1px solid ${TK.brand}`,background:P,color:TK.onAccent,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5}}>
                Send link to {selCount}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table — sized to fit without a sideways scroll at 125–130% zoom; the scroll is only a fallback. */}
      <div style={{border:`1px solid ${TK.line}`,borderRadius:R.md,overflow:'hidden',background:TK.surface,boxShadow:E.flat}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0,fontSize:12.5,minWidth:740}}>
            <thead>
              <tr>
                <th style={{...th,paddingLeft:12}}>Candidate</th>
                <th style={th}>Stage</th>
                <th style={th}>Joining</th>
                <th style={th}>Documents</th>
                <th style={th} title="Hover or click a row's summary to see who has it">Approvals</th>
                <th style={th}>Risk</th>
                <th style={{...th,textAlign:'right',paddingRight:10}}><span style={{position:'absolute',width:1,height:1,overflow:'hidden',clip:'rect(0,0,0,0)'}}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{padding:32,textAlign:'center',color:TK.muted}}>
                  {candidates.length === 0 ? 'No onboarding candidates yet.' : 'No candidates match these filters.'}
                  {filtersOn && <> <button type="button" onClick={()=>{ setFilterStage('ALL'); setFilterRisk('ALL'); setJoinWindow('all'); setSearchQ('') }} style={{border:'none',background:'none',color:TK.brandDeep,fontWeight:600,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit'}}>Clear filters</button></>}
                </td></tr>
              )}
              {filtered.map(c=>{
                const returned = isReturned(c)
                const sm  = returned ? RETURNED_META : STAGE_META[c.status]
                const notInvited = c.status==='NOT_INVITED'
                const days = daysLeft(c.date_of_joining)
                const done = c.status==='EMPLOYEE_CREATED'
                const trail = trailOf(c)
                const acts = actionsFor(c)
                const reqHave = c.docs_required_have||0, reqTotal = c.docs_required_total||DOCS_REQ.length
                const joinTone = days===null ? TK.warning : done ? TK.muted : days<0 ? TK.critical : days<=3 ? TK.warning : TK.muted
                const sub = [c.designation, c.department].filter(Boolean).join(' · ')
                return (
                  <tr key={c.id} className="ob-row" style={{background:TK.surface}}>
                    <td style={{...td,paddingLeft:12,minWidth:116,maxWidth:200}}>
                      <div style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}>
                        {/* Not-invited joiners can be picked for a bulk send; the box sits with the name. */}
                        {notInvited && <input type="checkbox" aria-label={`Select ${c.full_name} for the bulk send`} checked={selIds.has(c.id)} onChange={()=>setSelIds(prev=>{ const n=new Set(prev); n.has(c.id)?n.delete(c.id):n.add(c.id); return n })} style={{margin:0,flex:'none'}} />}
                        <div style={{fontWeight:600,color:TK.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={c.full_name}>{c.full_name}</div>
                      </div>
                      <div style={{fontSize:11.5,color:TK.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={sub}>
                        {sub || '—'}{c.employee_code && <span style={{color:TK.positive,fontWeight:700}}> · {c.employee_code}</span>}
                      </div>
                    </td>
                    <td style={td}>
                      <Badge {...sm} label={sm.label} title={returned ? [...(c.hr_review?.documents||[]).map(d=>`${d.label}: ${d.reason}`), ...(c.hr_review?.details||[]).map(d=>`${d.field}: ${d.reason}`)].join('\n') || undefined : undefined}/>
                      <div style={{fontSize:11,color:returned?TK.critical:TK.muted,marginTop:3,whiteSpace:'nowrap'}}>
                        {returned
                          ? `${(c.hr_review?.documents||[]).length} doc${(c.hr_review?.documents||[]).length===1?'':'s'} · ${(c.hr_review?.details||[]).length} detail${(c.hr_review?.details||[]).length===1?'':'s'} to fix`
                          : c.status==='INVITED'||c.status==='IN_PROGRESS' ? `Step ${Math.max(1,Math.min(c.current_step||1,8))} of 8`
                          : c.status==='SUBMITTED' && c.submitted_at ? `Since ${fmt(c.submitted_at)}`
                          : notInvited ? 'From recruitment' : ''}
                      </div>
                    </td>
                    <td style={{...td,whiteSpace:'nowrap'}}>
                      {c.date_of_joining ? <>
                        <div style={{color:TK.ink}}>{fmt(c.date_of_joining)}</div>
                        {days!==null && <div style={{fontSize:11,fontWeight:days<=3&&!done?600:500,color:joinTone,marginTop:1}}>{relDays(days).replace(/^./,m=>m.toUpperCase())}</div>}
                      </> : <span style={{fontSize:12,fontWeight:600,color:TK.warning}}>Not set</span>}
                    </td>
                    <td style={{...td,whiteSpace:'nowrap'}}>
                      {notInvited ? <span style={{fontSize:12,color:TK.faint}}>—</span> : <>
                        <div style={{color:reqHave>=reqTotal?TK.positive:TK.ink,fontWeight:600}} title={`${reqHave} of the ${reqTotal} required documents uploaded`}>{reqHave}/{reqTotal} required</div>
                        <div style={{fontSize:11,color:TK.muted,marginTop:1}} title={(c.docs_ai_flagged||0)>0 ? 'Flagged = the AI check could not read the document or found a mismatch. HR decides on the review sheet.' : undefined}>
                          {c.docs_uploaded||0} file{(c.docs_uploaded||0)===1?'':'s'}
                          {(c.docs_rejected||0)>0 ? <span style={{color:TK.critical,fontWeight:600}}> · {c.docs_rejected} rejected</span>
                            : (c.docs_ai_flagged||0)>0 && !done ? <span style={{color:TK.warning,fontWeight:600}}> · {c.docs_ai_flagged} flagged</span> : null}
                        </div>
                      </>}
                    </td>
                    <td style={td}>
                      {notInvited ? <span style={{fontSize:12,color:TK.faint}}>—</span>
                        : <ApprovalsCell name={c.full_name} trail={trail} holdersKnown={holders!==null}
                            managers={{ l1:c.role_assignment?.managers?.l1_name, l2:c.role_assignment?.managers?.l2_name, hod:c.role_assignment?.managers?.hod_name }}
                            readiness={readinessOf(c)} />}
                    </td>
                    <td style={{...td,whiteSpace:'nowrap'}}>{done ? <span style={{fontSize:12,color:TK.faint}}>—</span> : <RiskBadge risk={c.ai_risk} reason={c.ai_risk_reason}/>}</td>
                    <td style={{...td,whiteSpace:'nowrap',paddingRight:10}}>
                      <RowActions name={c.full_name} primary={acts.primary} more={acts.more} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{fontSize:11.5,color:TK.muted,marginTop:8}}>
        Approvals: the HR Manager reviews the submitted form, then IT, Admin and Payroll confirm their checklists in ESS → HRIS → Tasks &amp; Approvals, then the HR Manager generates the code. Hover or click a row's approvals to see who has it.
        {filterStage!=='EMPLOYEE_CREATED' && joined>0 && <> Completed onboardings are hidden — <button type="button" onClick={()=>setFilterStage('EMPLOYEE_CREATED')} style={{border:'none',background:'none',padding:0,color:TK.brandDeep,fontWeight:600,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit'}}>show {joined}</button>.</>}
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
      HIGH:   {label:'Urgent — do today',     bg: TK.surface, color:TK.critical, border: TK.criticalEdge},
      MEDIUM: {label:'Important — this week',  bg: TK.surface, color:TK.warning, border: TK.warningEdge},
      LOW:    {label:'When possible',          bg: TK.surface, color: TK.brandDeep, border: TK.line},
    }
    return (
      <div>
        <SH title="Pending actions" sub="Priority-sorted. Resolve High first."/>
        {pendingActions.length === 0 && (
          <div style={{padding:40,textAlign:'center',color:TK.muted}}>
            <span aria-hidden="true" style={{display:'flex',width:44,height:44,margin:'0 auto 10px',borderRadius:'50%',alignItems:'center',justifyContent:'center',background:TK.positiveTint,color:TK.positive}}><IconCheck size={22}/></span>
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
                  <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:gMeta[pri].bg,borderRadius:'10px',border:`1px solid ${gMeta[pri].border}`,flexWrap:'wrap'}}>
                    <div style={{flex:'1 1 260px',minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:TK.ink}}>{a.label}</div>
                      <div style={{fontSize:11,color:TK.muted,marginTop:1}}>
                        {a.candidate}
                        {cand?.date_of_joining ? <span style={{marginLeft:8}}>· Joining {fmt(cand.date_of_joining)}</span> : cand && <span style={{marginLeft:8,color:TK.warning}}>· No joining date</span>}
                      </div>
                    </div>
                    {a.action==='generate' && cand && (
                      <button onClick={()=>{openCodeModal(cand)}} style={{padding:'5px 12px',borderRadius:'10px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        Generate code
                      </button>
                    )}
                    {a.action==='review' && cand && (
                      <button onClick={()=>setReviewing({ id: cand.id, readOnly: false })} style={{padding:'5px 12px',borderRadius:R.sm,border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11.5,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        Review form
                      </button>
                    )}
                    {a.action==='send' && cand && (
                      <button onClick={()=>sendOnboardingFor(cand)} disabled={saving} style={{padding:'5px 12px',borderRadius:R.sm,border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11.5,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        Send link
                      </button>
                    )}
                    {a.action==='approvals' && cand && (
                      <ApprovalsCell name={cand.full_name} trail={trailOf(cand)} holdersKnown={holders!==null}
                        managers={{ l1:cand.role_assignment?.managers?.l1_name, l2:cand.role_assignment?.managers?.l2_name, hod:cand.role_assignment?.managers?.hod_name }}
                        readiness={readinessOf(cand)} />
                    )}
                    {(a.action==='followup'||a.action==='returned') && cand && (
                      <button onClick={()=>resendLink(cand)} disabled={resendingId===cand.id} style={{padding:'5px 12px',borderRadius:R.sm,border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:11.5,fontWeight:600,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                        {resendingId===cand.id ? 'Sending…' : 'Resend link'}
                      </button>
                    )}
                    {a.action==='followup' && cand && (
                      <button onClick={()=>copyLink(cand)} style={{padding:'5px 12px',borderRadius:R.sm,border:`1px solid ${gMeta[pri].border}`,cursor:'pointer',background:TK.surface,fontSize:11.5,fontFamily:'inherit',color:gMeta[pri].color,whiteSpace:'nowrap'}}>
                        Copy link
                      </button>
                    )}
                    {(a.action==='laptop'||a.action==='idcard') && cand && (
                      <button onClick={()=>issueAsset(cand.id,a.action==='laptop'?'LAPTOP':'ID_CARD')} style={{padding:'5px 12px',borderRadius:'10px',border:`1px solid ${gMeta[pri].border}`,cursor:'pointer',background:TK.surface,fontSize:11,fontFamily:'inherit',color:gMeta[pri].color,whiteSpace:'nowrap'}}>
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
    // Only while someone still has to act on them — not for employees already created.
    const flaggedDocs = candidates.filter(c=>(c.docs_ai_flagged||0)>0 && c.status!=='EMPLOYEE_CREATED')
    return (
      <div>
        <SH title="AI insights" sub="Powered by EZER AI — updated on load"/>

        {/* Attrition risk */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                        Attrition & at-risk joiners ({atRisk.length})
          </div>
          {atRisk.length===0
            ? <div style={{padding:16,background: TK.sunken,borderRadius:'10px',fontSize:12,color: TK.positive}}>No at-risk candidates right now.</div>
            : atRisk.map(c=>(
              <div key={c.id} style={{background:TK.surface,border:`1px solid ${c.ai_risk==='HIGH'?TK.criticalEdge:TK.warningEdge}`,borderRadius:'10px',padding:'12px 14px',marginBottom:8,borderLeft:`3px solid ${c.ai_risk==='HIGH'?TK.critical:TK.warning}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{c.full_name} <RiskBadge risk={c.ai_risk} long/></div>
                    <div style={{fontSize:11,color:TK.muted,marginTop:2}}>{c.designation || '—'} · {c.date_of_joining ? `Joining ${fmt(c.date_of_joining)}` : 'No joining date'}</div>
                    <div style={{fontSize:11,color:c.ai_risk==='HIGH'?TK.critical:TK.warning,marginTop:4,fontStyle:'italic'}}>
                                            {c.ai_risk_reason}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    {c.status==='SUBMITTED' && (
                      <button onClick={()=>setReviewing({ id: c.id, readOnly: false })} style={{padding:'5px 10px',borderRadius:'10px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:10,fontFamily:'inherit'}}>Review form</button>
                    )}
                    {c.status==='APPROVED' && (
                      <button onClick={()=>{openCodeModal(c)}} style={{padding:'5px 10px',borderRadius:'10px',border:'none',cursor:'pointer',background:TK.positive,color:TK.onAccent,fontSize:10,fontFamily:'inherit'}}>Generate code</button>
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
                        Document AI flags ({flaggedDocs.length} candidates)
          </div>
          {flaggedDocs.length===0
            ? <div style={{padding:16,background: TK.sunken,borderRadius:'10px',fontSize:12,color: TK.positive}}>All uploaded documents verified by AI.</div>
            : flaggedDocs.map(c=>(
              <div key={c.id} style={{background:TK.surface,border: `1px solid ${TK.warningEdge}`,borderRadius:'10px',padding:'10px 12px',marginBottom:6}}>
                <div style={{fontSize:12,fontWeight:500}}>{c.full_name}</div>
                <div style={{fontSize:11,color:TK.warning,marginTop:2}}>
                                    {c.docs_ai_flagged} document(s) flagged — low confidence or mismatch detected. Manual review recommended.
                </div>
              </div>
            ))
          }
        </div>

        {/* Onboarding champions */}
        <div>
          <div style={{fontSize:12,fontWeight:500,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                        Onboarding champions — 100% complete ({champs.length})
          </div>
          {champs.length===0
            ? <div style={{padding:16,background:TK.brandTint,borderRadius:'10px',fontSize:12,color:P}}>No 100% complete onboardings yet.</div>
            : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
              {champs.map(c=>(
                <div key={c.id} style={{background: TK.sunken,border: `1px solid ${TK.positiveTint}`,borderRadius:'10px',padding:'10px 12px',textAlign:'center'}}>
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
    // Recruitment joiners who have not been sent the link have nothing to track yet.
    const rows = candidates.filter(c=>c.status!=='NOT_INVITED')
    const active = rows.filter(c=>c.status!=='EMPLOYEE_CREATED')
    // Words, not an icon font: the tabler font is not loaded everywhere this page is mounted
    // (inside ESS the icons rendered as nothing and the columns looked empty).
    const tick = (done?: boolean, what?: string) => (
      <span title={`${what}: ${done ? 'done' : 'pending'}`} style={{fontSize:11.5,fontWeight:600,color:done?TK.positive:TK.warning,whiteSpace:'nowrap'}}>
        {done ? '✓ Done' : 'Pending'}
      </span>
    )
    const cell: React.CSSProperties = {padding:'9px 10px',borderBottom:`1px solid ${TK.line}`}
    const issueBtn: React.CSSProperties = {fontSize:11,padding:'2px 8px',borderRadius:99,border:`1px solid ${TK.lineStrong}`,cursor:'pointer',background:TK.surface,fontFamily:'inherit',color:TK.inkSoft}
    return (
      <div>
        <SH title="Compliance tracker" sub="PF / bank / policy / assets for every onboarding that has started — the counts are for the ones still in progress"/>

        {/* Summary row */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,marginBottom:16}}>
          {[
            {label:'Form 11 pending', val:active.filter(c=>!c.form11).length},
            {label:'Form 2 pending',  val:active.filter(c=>!c.form2).length},
            {label:'Bank pending',    val:active.filter(c=>!c.bank).length},
            {label:'Policy pending',  val:active.filter(c=>!c.policy_ack).length},
            {label:'Laptop pending',  val:active.filter(c=>!c.laptop_issued).length},
            {label:'ID card pending', val:active.filter(c=>!c.id_card_issued).length},
          ].map(({label,val})=>(
            <div key={label} style={{background:TK.surface,border:`1px solid ${TK.line}`,borderRadius:R.md,padding:'10px 12px'}}>
              <div style={{fontSize:11,color:TK.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:'.04em',fontWeight:600}}>{label}</div>
              <div style={{fontSize:22,fontWeight:700,color:val>0?TK.warning:TK.positive,fontVariantNumeric:'tabular-nums'}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Compliance grid */}
        <div style={{border:`1px solid ${TK.line}`,borderRadius:R.md,overflow:'hidden',background:TK.surface}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:TK.sunken}}>
                  {['Candidate','Joining','EPF Form 11','EPF Form 2','Bank','Policy','Laptop','ID card','PT state','BGV'].map(h=>(
                    <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:11,fontWeight:600,color:TK.muted,textTransform:'uppercase',letterSpacing:'.04em',borderBottom:`1px solid ${TK.line}`,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length===0 && (
                  <tr><td colSpan={10} style={{padding:24,textAlign:'center',color:TK.muted}}>No onboarding has started yet.</td></tr>
                )}
                {rows.map(c=>{
                  const ptState = (c.form_data as any)?.step_4?.perm_state || '—'
                  return (
                    <tr key={c.id} className="ob-row">
                      <td style={{...cell,minWidth:140}}>
                        <div style={{fontWeight:600,fontSize:12.5}}>{c.full_name}</div>
                        <div style={{fontSize:11,color:TK.muted}}>{c.designation||'—'}{c.employee_code && <span style={{color:TK.positive,fontWeight:700}}> · {c.employee_code}</span>}</div>
                      </td>
                      <td style={{...cell,whiteSpace:'nowrap'}}>{fmt(c.date_of_joining)}</td>
                      <td style={{...cell,textAlign:'center'}}>{tick(c.form11,'EPF Form 11')}</td>
                      <td style={{...cell,textAlign:'center'}}>{tick(c.form2,'EPF Form 2')}</td>
                      <td style={{...cell,textAlign:'center'}}>{tick(c.bank,'Bank mandate')}</td>
                      <td style={{...cell,textAlign:'center'}}>{tick(c.policy_ack,'Policy acknowledgement')}</td>
                      <td style={{...cell,textAlign:'center'}}>
                        {c.laptop_issued
                          ? <span style={{fontSize:11,color:TK.positive,fontWeight:600}}>Issued</span>
                          : <button onClick={()=>issueAsset(c.id,'LAPTOP')} style={issueBtn} title="Mark the laptop issued">Mark issued</button>}
                      </td>
                      <td style={{...cell,textAlign:'center'}}>
                        {c.id_card_issued
                          ? <span style={{fontSize:11,color:TK.positive,fontWeight:600}}>Issued</span>
                          : <button onClick={()=>issueAsset(c.id,'ID_CARD')} style={issueBtn} title="Mark the ID card issued">Mark issued</button>}
                      </td>
                      <td style={{...cell,color:TK.muted}}>{ptState}</td>
                      <td style={{...cell,color:TK.faint,whiteSpace:'nowrap'}} title="Background verification is not tracked in EZER yet">Not tracked</td>
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
    {key:'candidates',  icon:'ti-users',       label:'All candidates', badge:candidates.filter(c=>c.status!=='EMPLOYEE_CREATED').length},
    {key:'pending',     icon:'ti-list-check',  label:'Pending actions', badge:pendingActions.filter(a=>a.priority==='HIGH').length||undefined},
    {key:'insights',    icon:'ti-brain',       label:'AI insights',    badge:highRisk||undefined},
    {key:'compliance',  icon:'ti-shield-check',label:'Compliance'},
  ]

  const notInvitedCount = candidates.filter(c=>c.status==='NOT_INVITED').length

  return (
    <div ref={rootRef} style={{background:TK.canvas,minHeight:'100vh',fontFamily:'"DM Sans","Segoe UI",sans-serif',color:TK.ink}}>
      <style>{POP_CSS}</style>

      {/* Header — the shared band. Not sticky: the host page (ESS) already keeps its own bar
          at the top, and a second sticky band under it is what used to collide with it. The
          All-candidates toolbar is the one thing that sticks, and it sits below the host's bar. */}
      <div style={{padding:'16px clamp(14px, 2vw, 24px) 0',maxWidth:1400,margin:'0 auto'}}>
        <div className="ez-page-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:20,fontWeight:700,color:TK.ink,letterSpacing:'-.02em'}}>Onboarding</div>
            <div style={{fontSize:13,color:TK.muted,marginTop:3}}>
              {active} in progress · {thisWeek} joining in the next 7 days · {awaitingReview} awaiting HR review · {submitted} awaiting employee code
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button type="button" onClick={()=>setLinkModal(true)} className="ez-press" style={{padding:'9px 14px',borderRadius:R.md,cursor:'pointer',background:TK.surface,border:`1px solid ${TK.lineStrong}`,color:TK.ink,fontSize:12.5,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}>
              <IconPlus size={14}/> Add candidate
            </button>
            <button type="button" onClick={()=>{ setFilterStage('NOT_INVITED'); setFilterRisk('ALL'); setJoinWindow('all'); setTab('candidates') }} className="ez-press" title="Recruitment joiners who have not been sent the onboarding link"
              style={{padding:'9px 14px',borderRadius:R.md,cursor:'pointer',background:TK.brand,border:`1px solid ${TK.brand}`,color:TK.onAccent,fontSize:12.5,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}>
              Send onboarding links{notInvitedCount ? ` · ${notInvitedCount}` : ''}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div role="tablist" aria-label="Onboarding" style={{display:'flex',gap:6,paddingBottom:4,flexWrap:'wrap'}}>
          {TABS.filter(t=>canSeeScreen(grant,'onboarding.'+t.key)).map(t=>(
            <button key={t.key} type="button" role="tab" aria-selected={tab===t.key} onClick={()=>setTab(t.key)}
              className="ez-tab" data-on={tab===t.key ? '1' : '0'}
              style={{padding:'7px 13px',cursor:'pointer',fontSize:12.5,fontWeight:tab===t.key?600:500,fontFamily:'inherit',borderRadius:R.md,
                background: tab===t.key ? TK.brand : 'transparent',
                color: tab===t.key ? TK.onAccent : TK.inkSoft,
                border: `1px solid ${tab===t.key ? TK.brand : TK.line}`,
                display:'flex',alignItems:'center',gap:5}}>
              <i className={`ti ${t.icon}`} style={{fontSize:14}} aria-hidden="true"/>
              {t.label}
              {t.badge!==undefined && t.badge > 0 && (
                <span style={{fontSize:10.5,padding:'1px 6px',borderRadius:99,background: t.key==='pending' ? TK.critical : (tab===t.key ? `color-mix(in srgb, ${TK.onAccent} 24%, transparent)` : TK.sunken),color: t.key==='pending' ? TK.onAccent : (tab===t.key ? TK.onAccent : TK.muted),fontWeight:700,minWidth:16,textAlign:'center'}}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{padding:'14px clamp(14px, 2vw, 24px) 32px',maxWidth:1400,margin:'0 auto'}}>
        {loading
          ? <div style={{textAlign:'center',padding:60,color:TK.muted}}>Loading onboarding…</div>
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
        <div onMouseDown={e=>{ if (e.target===e.currentTarget && !saving) setLinkModal(false) }} style={{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:Z.modal,padding:16}}>
          <div role="dialog" aria-label="Add a candidate and send the onboarding link" style={{background:TK.surface,borderRadius:'14px',padding:'20px 22px',width:'100%',maxWidth:520,boxShadow:E.overlay,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:600}}>Add a candidate · send the onboarding link</div>
              <button onClick={()=>setLinkModal(false)} aria-label="Close" style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:TK.muted,lineHeight:1}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div style={{marginBottom:8,gridColumn:'1 / -1'}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Company *</div>
                <select value={newForm.company_id} onChange={e=>setNewForm(f=>({...f,company_id:e.target.value}))}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
                  <option value="">Select company…</option>
                  {companies.map(co=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
                </select>
              </div>
              {[
                {label:'Full Name *',       key:'full_name',      type:'text', placeholder:'As per Aadhaar'},
                {label:'Mobile *',          key:'mobile',         type:'tel',  placeholder:'+91 XXXXXXXXXX'},
                {label:'Email *',           key:'email',          type:'email',placeholder:'personal@email.com'},
                {label:'Designation *',     key:'designation',    type:'text', placeholder:'e.g. Software Engineer'},
                {label:'Date of Joining *', key:'date_of_joining',type:'date', placeholder:''},
                {label:'Offered CTC (₹)',   key:'offered_ctc',    type:'number',placeholder:'e.g. 800000'},
              ].map(({label,key,type,placeholder})=>(
                <div key={key} style={{marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{label}</div>
                  <input type={type} placeholder={placeholder} value={(newForm as any)[key]} onChange={e=>setNewForm(f=>({...f,[key]:e.target.value}))}
                    style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Department</div>
                <select value={newForm.department_id} onChange={e=>{ const d = departments.find(x=>x.id===e.target.value); setNewForm(f=>({...f, department_id:e.target.value, department: d?.dept_name || ''})) }}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
                  <option value="">Select department…</option>
                  {departments.filter(d=>!newForm.company_id||d.company_id===newForm.company_id).map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Employment Type *</div>
                <select value={newForm.employment_type} onChange={e=>setNewForm(f=>({...f,employment_type:e.target.value}))}
                  style={{width:'100%',padding:'8px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:12,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}>
                  <option>Employee</option><option>Intern</option><option>Consultant</option><option>Contract</option><option>NAPS</option><option>NATS</option>
                </select>
              </div>
            </div>
            <div style={{background:TK.brandTint,borderRadius:'10px',padding:'9px 12px',marginTop:4,fontSize:11,color: TK.muted,lineHeight:1.7}}>
                            The onboarding link is emailed to the candidate and stays valid for 24 hours (Resend or Extend from the row's menu). They verify with an OTP on their mobile.
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setLinkModal(false)} style={{padding:'9px 16px',borderRadius:'10px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',color:TK.ink}}>Cancel</button>
              <button onClick={sendMagicLink} disabled={saving} style={{flex:1,padding:'9px',borderRadius:'10px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:13,fontWeight:500,fontFamily:'inherit',opacity:saving?.6:1}}>
                {saving ? 'Generating...' : 'Generate & send onboarding link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT ONBOARDING DATE MODAL ───────────────────────── */}
      {dateModal && (
        <div onMouseDown={e=>{ if (e.target===e.currentTarget && !saving) setDateModal(null) }} style={{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:Z.modal,padding:16}}>
          <div role="dialog" aria-label={`Edit ${dateModal.full_name}`} style={{background:TK.surface,borderRadius:'14px',padding:'20px 22px',width:'100%',maxWidth:420,boxShadow:E.overlay}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:600}}>Edit candidate — {dateModal.full_name}</div>
              <button onClick={()=>setDateModal(null)} aria-label="Close" style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:TK.muted,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Date of joining *</div>
            <input type="date" value={dateVal} onChange={e=>setDateVal(e.target.value)}
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box',marginBottom:10}}/>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Email</div>
            <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder="candidate@email.com"
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box',marginBottom:10}}/>
            <div style={{fontSize:10,fontWeight:600,color:TK.brandDeep,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Mobile</div>
            <input type="tel" value={editMobile} onChange={e=>setEditMobile(e.target.value)} placeholder="+91 XXXXXXXXXX"
              style={{width:'100%',padding:'9px 11px',background:TK.sunken,border: `1px solid ${TK.brandEdge}`,borderRadius:'10px',fontSize:13,color:TK.ink,outline:'none',fontFamily:'inherit',boxSizing:'border-box'}}/>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={()=>setDateModal(null)} style={{padding:'9px 16px',borderRadius:'10px',border: `1px solid ${TK.brandEdge}`,cursor:'pointer',background:TK.sunken,fontSize:12,fontFamily:'inherit',color:TK.ink}}>Cancel</button>
              <button onClick={saveDate} disabled={saving} style={{flex:1,padding:'9px',borderRadius:'10px',border:'none',cursor:'pointer',background:P,color:TK.onAccent,fontSize:13,fontWeight:500,fontFamily:'inherit',opacity:saving?.6:1}}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── GENERATE CODE (after the three heads approve): the team, the ESS roles, the code ── */}
      {codeModal && (
        <GenerateCodeModal onboardingId={codeModal.id}
          candidate={{ ...codeModal, approvals: ['HR_MANAGER','IT','ADMIN','PAYROLL'].map(team => ({ team, status: (codeModal.approvals||[]).find(a=>a.team===team)?.status || 'PENDING' })) }}
          onClose={() => setCodeModal(null)}
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
