'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { companyFilter, scopedCompanies, canSeeScreen } from '@/lib/rms/resolve'
import * as XLSX from 'xlsx'
import { CreateOfferApproval, HRHeadApprovalDashboard, HRManagerSendOffer, AuditTrailViewer } from './offer-flow-components'
import { compOf } from '@/lib/recruitment/compensation'
import InterviewPipeline from '@/components/recruitment/InterviewPipeline'
import CandidateInterviewModal from '@/components/recruitment/CandidateInterviewModal'
import MrfForm, { mrfToForm } from '@/components/ess/MrfForm'
import { api as essApi } from '@/lib/ess/api'
import { MIN_WAGE_STATES, WAGE_CATS, CAT_TO_DB, resolveMinWage, OLD_CODE_TO_STATE, DEFAULT_STATE, DEFAULT_CATEGORY, stateFromLocation } from '@/lib/recruitment/min-wages'
import { computeCtc, inr, EPF_WAGE_CEILING, hraMaxFor } from '@/lib/recruitment/ctc-model'
import { ctcStatementRows, type StmtRow } from '@/lib/recruitment/ctc-statement'
import { jobCodePrefix, nextJobCode, newMrfNumber } from '@/lib/recruitment/job-code'
import RecruiterPicker, { toPickerPeople } from '@/components/recruitment/RecruiterPicker'
// Every recruitment API route is guarded (docs/security/open-endpoints.md), so the
// browser hands over whichever session it holds. uploadAuthHeaders() is the same
// credentials WITHOUT Content-Type — mandatory for FormData, because setting it by
// hand suppresses the multipart boundary and the server cannot parse the parts.
import { authHeaders, uploadAuthHeaders } from '@/lib/auth-headers'

// The design system. This file declares its own Badge and Field, so those are
// deliberately not imported.
import {
  C, F, W, R, E, S, M, Z, tone, eyebrow, numeric, inputStyle,
  TableWrap, Th, Td, Tr, Empty,
} from '@/lib/ui'

// The Recruitment redesign kit. Presentation only — nothing here fetches, and
// the adapters reshape rows loadAll has already loaded. See
// docs/recruitment-redesign/01-WHAT-STAYS-THE-SAME.md for the contract.
import {
  TabRail, TAB_META, type RailTab,
  toMrfVM, toCandidateVM, dashboardTodos, REJECTED,
  DashboardView, MrfListView, PipelineView, CandidateCard, ScreeningResultCard, RxPage, RecruitmentHeader,
  Segmented, SearchBox, Help, RxDialog, Track, ApprovalChain, FilterPills, daysUntil,
  type ScreenResult, type ChainStepVM,
} from '@/components/recruitment/rx'
// NOT imported: Ring and missingDocuments. Section 10 wants a documents ring
// from document_collection_links, but PreOnboardTab reads preonboarding_links
// only, and those rows carry no per-document state — so both would need a new
// read. Importing them unused would be dead surface, which is the same reason
// COMPENSATION was dropped from this import list in phase 6b.
// NOTE: the kit also exports Badge, but this file declares its own Badge({text})
// at ~195 with a different signature, used a dozen times. Importing the kit's
// would shadow it. Where a kit badge is wanted here, write the markup directly
// (`rx-b b-brand rx-live`) — which is what the kit's own prototype emits.

/**
 * The type scale under a name this file does not shadow.
 *
 * Two components here declare their own `const F = (k, v) => setForm(...)`
 * field setter — MRFTab at ~1759 and NegotiationTab at ~4283 — which shadows
 * the imported `F` typography scale for their whole body. Inside them `F.micro`
 * is not 11px, it is a property lookup on a function, and it fails as a type
 * error rather than anything visible. Use TYPE inside those two components.
 */
const TYPE = F

// ── TYPES ────────────────────────────────────────────────────────
interface Company { id:string; company_code:string; company_name?:string }
interface Location { id:string; location_code:string; location_name:string; company_id:string }
interface Department { id:string; dept_name:string; dept_code:string; company_id:string }
interface MRF {
  id:string; company_id:string; location_id?:string; department_id?:string
  location_name?:string; dept_name?:string
  designation?:string; position?:string; no_of_openings?:number; openings?:number
  urgency?:string; reason?:string; reason_for_hire?:string; status:string
  job_description?:string; employment_type?:string; budget_min?:number; budget_max?:number; wage_category?:string
  experience_required?:string; assigned_recruiter?:string; mrf_number?:string
  remarks?:string; created_at:string
  mrf_type?:string; education_required?:string; skills_required?:string
  hiring_type?:string; previous_company_preference?:string
  experience_min?:string; experience_max?:string; education_min?:string; education_max?:string
}
interface Candidate {
  id:string; company_id:string; mrf_id?:string; full_name:string
  phone?:string; mobile?:string; email?:string; source?:string
  current_company?:string; designation?:string; experience_years?:number
  current_ctc?:number; expected_ctc?:number; notice_period?:number
  stage:string; ai_score?:number; ai_tag?:string; ai_match_tag?:string
  ai_reasoning?:string; ai_questions?:string[]; interview_notes?:string
  doj?:string; status?:string; created_at:string; resume_url?:string
  offer_revised?:boolean; offer_revision_note?:string; blacklisted?:boolean
  hr_email?:string; offer_accepted?:boolean; offer_sent_at?:string
  onboarding_date?:string
  aadhaar_url?:string; prev_offer_url?:string; pre_negotiation_done?:boolean
}

// 'Hold' is where an interviewer's Hold decision parks a candidate — still in play (a round
// can be added), but not yet Shortlisted.
const STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Hold','Shortlisted','Offer Sent','Joined','Rejected']
// A hiring pipeline is ordered — Applied is not "a different kind of thing"
// from Shortlisted, it is earlier. So colour follows the funnel: violet
// deepening as a candidate advances, green once the outcome is good, red when
// it is not. The old map gave ten stages ten unrelated hues, which made a
// ranked sequence look like ten categories and drew the eye equally to all of
// them. Same ramp as the dashboard pipeline chart, so the two agree.
const STAGE_COLOR:Record<string,string> = {
  'Applied':'var(--ez-ramp-1)', 'AI Screened':'var(--ez-ramp-2)', 'Telephonic':'var(--ez-ramp-3)',
  'L1':'var(--ez-ramp-4)', 'L2':'var(--ez-ramp-5)', 'Optional Round':'var(--ez-ramp-6)',
  'Hold':C.warning, 'Shortlisted':C.positive, 'Offer Sent':C.positive, 'Joined':C.positive,
  'Rejected':C.critical,
}

// Same stages, readable as text. A bar only has to be visible; the stage
// name has to be legible against the page in both themes.
const STAGE_TEXT:Record<string,string> = {
  'Applied':'var(--ez-ramp-1-fg)', 'AI Screened':'var(--ez-ramp-2-fg)', 'Telephonic':'var(--ez-ramp-3-fg)',
  'L1':'var(--ez-ramp-4-fg)', 'L2':'var(--ez-ramp-5-fg)', 'Optional Round':'var(--ez-ramp-6-fg)',
  'Hold':C.warning, 'Shortlisted':C.positive, 'Offer Sent':C.positive, 'Joined':C.positive,
  'Rejected':C.critical,
}
const EMP_TYPES = ['Employee','Intern','Contract','Consultant','NAPS','NATS','Live Project']
const EDUCATION_OPTIONS = ['Any Graduate','Bachelors','B.Tech/B.E.','MBA/PGDM','M.Tech','B.Com/M.Com','BCA/MCA','Diploma','12th Pass','Any Post Graduate','Masters']
const SOURCES = ['Direct','Naukri','LinkedIn','Referral','Campus','WhatsApp','Consultancy','Other']

// ── LIGHT THEME STYLES ───────────────────────────────────────────
// Bound to the design system — see lib/ui/tokens.ts. One object drives all 620
// inline style blocks on this page, so this is where the whole module's look
// is decided.
const T = {
  page: { background:C.canvas, minHeight:'100vh', color:C.ink, fontFamily:F.family } as React.CSSProperties,
  // ── SURFACES ────────────────────────────────────────────────────────────
  // Twenty-pixel corners and twenty pixels of air, with structure coming from
  // elevation rather than outline: the border is still present but recedes,
  // so a page of cards reads as a stack of planes instead of a grid of boxes.
  // 14x16 padding was dense enough that every card felt like a table cell.
  card: { background:C.surface, borderRadius:R.xl, border:`1px solid ${C.line}`,
          padding:S.xl, marginBottom:S.lg, boxShadow:E.raised,
          transition:`box-shadow ${M.ease}, border-color ${M.ease}` } as React.CSSProperties,

  // Emphasis as a tinted plane, which is how the rest of the system says
  // "this one" — a 2px brand outline drawn around an otherwise identical card
  // shouts at the same volume whatever it is applied to.
  cardPurple: { background:C.brandTint, borderRadius:R.xl, border:`1px solid ${C.brandEdge}`,
                padding:S.xl, marginBottom:S.lg, boxShadow:E.brand } as React.CSSProperties,

  label: { ...eyebrow, display:'block', marginBottom:6 } as React.CSSProperties,
  input: { ...inputStyle() } as React.CSSProperties,
  select: { ...inputStyle(), cursor:'pointer' } as React.CSSProperties,
  textarea: { ...inputStyle(), height:'auto', minHeight:90, padding:'9px 11px', resize:'vertical' as const, lineHeight:1.5 } as React.CSSProperties,
  // ── CONTROLS ────────────────────────────────────────────────────────────
  // 38px with 18px of side padding. btn was 36 and btnOutline 34 — two button
  // heights sitting side by side in the same toolbar. Raising them to 38 then
  // left them a step ABOVE inputStyle()'s 36, so that was lifted to 38 too:
  // buttons and inputs now share one height, which is what makes a filter row
  // like "Search […] [Apply]" sit on a single line rather than nearly one.
  // UIKeyframes already gives every button its press, hover and transition.
  btn: { height:38, padding:'0 18px', borderRadius:R.md, border:'none', cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', letterSpacing:'-.005em', whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnPrimary: { height:38, padding:'0 18px', borderRadius:R.md, border:`1px solid ${C.brandDeep}`, cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', letterSpacing:'-.005em', background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:C.onAccent, boxShadow:E.brand, whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnOutline: { height:38, padding:'0 16px', borderRadius:R.md, border:`1px solid ${C.lineStrong}`, cursor:'pointer', fontSize:F.small, fontWeight:W.medium, fontFamily:'inherit', background:C.surface, color:C.ink, boxShadow:E.flat, whiteSpace:'nowrap' as const } as React.CSSProperties,
  // Fixed 2/3/4-column grids collapsed badly on a laptop at the app's 130%
  // zoom. auto-fit lets each row find its own column count instead.
  g2: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:S.lg } as React.CSSProperties,
  g3: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:S.lg } as React.CSSProperties,
  g4: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:S.lg } as React.CSSProperties,
  row: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:`${S.sm}px 0`, borderBottom:`1px solid ${C.line}`, gap:S.md } as React.CSSProperties,

  // ── SECTION HEADING ─────────────────────────────────────────────────────
  // This was an 11px uppercase grey eyebrow — the quietest type in the system
  // doing the job of a heading, which is why every panel read as one flat
  // sheet with no hierarchy. It is a real heading now: 15px, bold, primary
  // ink, with a short brand rule in front of it so the eye finds the start of
  // a section without reading a word.
  // The brand rule is the heading's own left border rather than a <span>, so
  // all ~40 headings gain it without a single JSX edit — and there is no
  // accent component that call sites could forget to render.
  section: { fontSize:F.lead, fontWeight:W.bold, color:C.ink, letterSpacing:'-.01em',
             borderLeft:`3px solid ${C.brand}`, paddingLeft:S.sm,
             marginBottom:S.md, marginTop:S.xs, display:'flex', alignItems:'center', gap:S.sm,
             lineHeight:1.3 } as React.CSSProperties,
}

// ── RECRUITMENT FILTER BAR (Company / Department / Position / Location) ──
// Reusable filter bar + matcher used across the candidate & record tabs.
// A department name repeats once per company. In a filter that spans companies the plain
// name would appear several times with no way to tell the copies apart, so the owning
// company is appended only when the name is actually ambiguous in the visible list.
function deptLabel(d:any, list:any[], companies:any[]) {
  if (list.filter((x:any)=>x.dept_name===d.dept_name).length < 2) return d.dept_name
  const co = companies.find((c:any)=>c.id===d.company_id)
  return `${d.dept_name} — ${co?.company_name||co?.company_code||'—'}`
}


// True unless a set filter excludes the candidate. Department & location resolve via the candidate's MRF.
function candidateMatchesFilters(c:any, mrfs:any[], f:any): boolean {
  if (f.company && c.company_id !== f.company) return false
  if (f.position && (c.designation||'') !== f.position) return false
  if (f.department || f.location) {
    const m = mrfs.find((mm:any)=>mm.id===c.mrf_id)
    if (f.department && m?.department_id !== f.department) return false
    if (f.location && m?.location_id !== f.location) return false
  }
  return true
}

// Distinct, sorted position labels derived from a candidate list.
const distinctPositions = (cands:any[]) => Array.from(new Set(cands.map((c:any)=>c.designation).filter(Boolean))).sort() as string[]

// ── HELPERS ───────────────────────────────────────────────────────
function Badge({ text }:{ text:string }) {
  const map:Record<string,[string,string]> = {
    DRAFT:[C.brandTint,C.brandDeep], SUBMITTED:[C.infoTint,C.info],
    APPROVED:[C.positiveTint,C.positive], REJECTED:[C.criticalTint,C.critical],
    CLOSED:[C.sunken,C.muted], STRONG:[C.positiveTint,C.positive],
    PARTIAL:[C.warningTint,C.warning], NOT_SUITABLE:[C.criticalTint,C.critical],
    'Offer Sent':[C.infoTint,C.info], Joined:[C.positiveTint,C.positive],
    CREATED:[C.warningTint,C.warning], SENT:[C.infoTint,C.info],
    OPENED:[C.brandTint,C.brandDeep], SUBMITTED_PRE:[C.positiveTint,C.positive],
    'Quick Hire':[C.warningTint,C.warning], 'Full MRF':[C.brandTint,C.brand],
    'Revised Offer':[C.warningTint,C.warning], 'Blacklisted':[C.criticalTint,C.critical],
  }
  const [bg,c] = map[text] || [C.brandTint,C.brandDeep]
  // 11px, not 10. F.micro is the floor the rest of the system holds to, and a
  // status is the word that tells you what a row IS — it was being set smaller
  // than the table's own column heads. Same defect as the 9px stage labels.
  return <span style={{ fontSize:F.micro, padding:'3px 10px', borderRadius:R.pill,
                        background:bg, color:c, fontWeight:W.semi, lineHeight:1.45,
                        whiteSpace:'nowrap' as const, display:'inline-block' }}>{text}</span>
}

function Toast({ msg, type, onClose }:{ msg:string, type:'success'|'error', onClose:()=>void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return (
    // Radius, shadow and spacing off the scales rather than hand-picked. The
    // shadow was a literal rgba, so a toast kept its light-theme cast in dark.
    <div style={{ position:'fixed', bottom:S.xl, right:S.xl, zIndex:Z.toast,
      background:type==='success'?C.positive:C.critical, color:C.onAccent,
      borderRadius:R.md, padding:`${S.md}px ${S.lg}px`, fontSize:F.small, fontWeight:W.medium,
      boxShadow:E.overlay, display:'flex', alignItems:'center', gap:S.sm }}>
      {msg}
      <button onClick={onClose} style={{ background:'none', border:'none', color:C.onAccentDim, cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
    </div>
  )
}

function SectionLine({ title }:{ title:string }) {
  return (
    // The step headers inside every form ("3 · Employment details"). They were
    // an 11px brand-coloured eyebrow trailing a tint hairline — quieter than
    // the field labels beneath them, so a long form read as one undivided run
    // of inputs with no sense of where a step began. Now they speak with the
    // same voice as T.section: ink, bold, a brand rule at the head. The
    // trailing line stays, on C.line so it reads as structure and not accent.
    <div style={{ display:'flex', alignItems:'center', gap:S.md, margin:`${S.xl}px 0 ${S.md}px` }}>
      <div style={{ fontSize:F.small, fontWeight:W.bold, color:C.ink, letterSpacing:'-.01em',
                    borderLeft:`3px solid ${C.brand}`, paddingLeft:S.sm,
                    lineHeight:1.3, whiteSpace:'nowrap' as const }}>{title}</div>
      <div style={{ flex:1, height:1, background:C.line }} />
    </div>
  )
}

// Roles that get FULL oversight of recruitment — they see every MRF and candidate in
// their company. Everyone else who can open recruitment (a Hiring Manager / Recruiter) is
// scoped to the MRFs an HR Head assigned to them (manpower_requisitions.assigned_recruiter_ids).
const OVERSIGHT_CODES = ['ADMIN_SUPER', 'SUPER_ADMIN', 'ALL_ACCESS', 'HR_HEAD', 'HR_MANAGER', 'CHRO']

// ── MAIN ──────────────────────────────────────────────────────────
export default function RecruitmentPage() {
  const { grant, loading: grantLoading } = useGrant()
  // The HR Head tab is for the HR Head alone (and super admin / legacy dashboard login).
  const isHrHead = grant.legacy || grant.isSuperAdmin || (grant.roles || []).some((r: any) => r.role_code === 'HR_HEAD')
  const [tab, setTab] = useState<'dashboard'|'mrf'|'screening'|'pipeline'|'negotiation'|'offerapproval'|'hrhead'|'sendoffer'|'offers'|'preonboarding'|'jobstatus'>('dashboard')
  // Deep-link from ESS Tasks & Approvals: /ess-portal?module=recruitment&mrfSub=approvals&mrf=<id>
  // opens the MRF tab on its Approvals sub-tab with that requisition ready to review.
  const [mrfDeep, setMrfDeep] = useState<{ sub?:string; id?:string }>({})
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const sub = p.get('mrfSub'); const id = p.get('mrf')
    if (sub || id) { setTab('mrf'); setMrfDeep({ sub: sub || undefined, id: id || undefined }) }
  }, [])
  const [companies, setCompanies] = useState<Company[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [mrfs, setMrfs] = useState<MRF[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [notify, setNotify] = useState<{ msg:string, type:'success'|'error' }|null>(null)
  const [loading, setLoading] = useState(true)

  const showNotify = useCallback((msg:string, type:'success'|'error'='success') => setNotify({ msg, type }), [])

  const loadAll = useCallback(async () => {
    try {
      // Non-cross-company users only ever load their own company's MRFs and candidates,
      // so every tab (all rendered from this data) is company-scoped at the source.
      const co2 = companyFilter(grant, null)
      let mrfQ = supabase.from('manpower_requisitions').select('*').order('created_at',{ ascending:false })
      let candQ = supabase.from('candidates').select('*').order('created_at',{ ascending:false })
      if (co2) { mrfQ = mrfQ.eq('company_id', co2); candQ = candQ.eq('company_id', co2) }
      const [{ data:co },{ data:lo },{ data:de },{ data:mrf },{ data:cand }] = await Promise.all([
        supabase.from('companies').select('id,company_code,company_name').order('company_code'),
        supabase.from('locations').select('id,location_code,location_name,company_id').order('location_name'),
        supabase.from('departments').select('id,dept_name,dept_code,company_id').order('dept_name'),
        mrfQ,
        candQ,
      ])
      setCompanies(scopedCompanies(grant, co||[])); setLocations(lo||[]); setDepartments(de||[])
      // A hiring manager only sees the MRFs an HR Head assigned to them, and only the
      // candidates under those MRFs. Assigned HMs of the SAME MRF therefore share its
      // candidates; a different MRF's candidates never appear. Oversight roles see all.
      let mrf2: any[] = mrf || [], cand2: any[] = cand || []
      const myId = grant.employeeId
      const oversight = grant.legacy || grant.isSuperAdmin || grant.crossCompany || (grant.roles || []).some((r: any) => OVERSIGHT_CODES.includes(r.role_code))
      if (!oversight && myId) {
        const assigned = (m: any) => Array.isArray(m.assigned_recruiter_ids) && m.assigned_recruiter_ids.includes(myId)
        const approver = (m: any) => Array.isArray(m.approval_chain) && m.approval_chain.some((s: any) => s.approver_id === myId)
        // MRFs this person may see in the list: ones assigned to them to hire, ones THEY
        // raised (so a raiser sees their own requisitions here too, not only in HRIS), and
        // ones awaiting their approval.
        const mrfMine = new Set(mrf2.filter(m => assigned(m) || m.requested_by === myId || approver(m)).map(m => m.id))
        // Candidates stay scoped to the MRFs they actually run as the assigned recruiter.
        const assignedIds = new Set(mrf2.filter(assigned).map(m => m.id))
        mrf2 = mrf2.filter(m => mrfMine.has(m.id))
        cand2 = cand2.filter(c => c.mrf_id && assignedIds.has(c.mrf_id))
      }
      setMrfs(mrf2); setCandidates(cand2)
    } catch(e) { showNotify('Data load error','error') }
    setLoading(false)
  }, [grant, showNotify])

  useEffect(() => { if (!grantLoading) loadAll() }, [loadAll, grantLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Eleven tabs is a lot to scan, and eleven different emoji in front of them
  // made it harder rather than easier — each one drew the eye equally. The
  // words are the signal; they are also already in pipeline order.
  const TABS = [
    { k:'dashboard', l:'Dashboard' },
    { k:'mrf', l:'MRF' },
    { k:'screening', l:'AI Screening' },
    { k:'pipeline', l:'Pipeline' },
    { k:'negotiation', l:'Negotiation' },
    { k:'offerapproval', l:'Offer Approval' },
    { k:'hrhead', l:'HR Head' },
    { k:'sendoffer', l:'Send Offers' },
    { k:'offers', l:'Offers' },
    { k:'preonboarding', l:'Pre-onboarding' },
    { k:'jobstatus', l:'Job Status' },
  ]
  // hrhead stays HR-Head only; on top of that, role-wise tab visibility (Roles → Screen Access)
  const visibleTabs = TABS.filter(t => (t.k !== 'hrhead' || isHrHead) && canSeeScreen(grant, `recruitment.${t.k}`))
  // If the current tab is not one this role may see, fall back to the first it can.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some(t => t.k === tab)) setTab(visibleTabs[0].k as typeof tab)
  }, [visibleTabs, tab])
  // Scoped-HM MRF id set for the Send Offers tab (null = oversight, no filter). Memoised so
  // the child's fetch effect does not refire on every render.
  const sendOfferAllowed = useMemo(() => isHrHead ? null : new Set(mrfs.map(m => m.id)), [isHrHead, mrfs])
  const props = { supabase, companies, locations, departments, mrfs, candidates, onRefresh:loadAll, showNotify, employeeId: grant.employeeId, mrfInitialSub: mrfDeep.sub, mrfFocusId: mrfDeep.id, canEditAnyMrf: !!(grant.isSuperAdmin || grant.legacy) }

  // ── Redesign wiring ───────────────────────────────────────────────────
  // Adapters only reshape the rows loadAll already put in state. No query is
  // added, no handler changes, and the rail is built from the SAME visibleTabs
  // filter that already decides which tabs exist.
  //
  // nameOf stays a stub HERE, and that is correct rather than pending: the
  // employee roster (`people`) is fetched inside MRFTab, and the Dashboard
  // renders no recruiter initials. MRFTab builds its own view models with a
  // real resolver (see nameOf/budgetLabelOf there). Hoisting the roster fetch
  // to page level to share it would run that query on every tab instead of on
  // the one that needs it — a data-flow change the redesign brief rules out.
  //
  // The adapters take an index-signature row shape; this file's own interfaces
  // (MRF, Candidate, Department…) do not declare one, so each array is cast at
  // the boundary. Cast narrowly, per array, rather than blanket-casting the
  // context object — a genuinely wrong shape should still fail here.
  type RxRow = Record<string, unknown>
  const rxCtx = {
    departments: departments as unknown as RxRow[],
    locations: locations as unknown as RxRow[],
    candidates: candidates as unknown as RxRow[],
    companies: companies as unknown as RxRow[],
    quickHireCap: QUICK_HIRE_CAP,
    nameOf: () => '',
  }
  const mrfVMs = useMemo(() => mrfs.map(r => toMrfVM(r as unknown as RxRow, rxCtx)), [mrfs, candidates, departments, locations]) // eslint-disable-line react-hooks/exhaustive-deps
  const candVMs = useMemo(() => candidates.map(c => toCandidateVM(c as unknown as RxRow)), [candidates])

  // DashTab's own figure, lifted verbatim — same formula, same arrays. It reads
  // created_at, not a joining date; that is the existing definition and this
  // redesign does not change what the tile counts.
  const joinedThisMonth = useMemo(
    () => candidates.filter((c:Candidate) => c.stage==='Joined' && new Date(c.created_at).getMonth()===new Date().getMonth()).length,
    [candidates])

  // TABS here uses `k`/`l`, not `key`/`label` as the kit's example assumes.
  const railTabs: RailTab[] = visibleTabs.map(t => ({
    key: t.k, label: t.l, ...TAB_META[t.k],
    count: t.k === 'mrf' ? mrfs.length
         : t.k === 'pipeline' ? candVMs.filter(c => c.stage !== 'Rejected').length
         : null,
  }))
  const rail = <TabRail tabs={railTabs} active={tab} onSelect={k => setTab(k as typeof tab)} />

  if (loading) return (
    <div style={{ ...T.page, display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div style={{ color:C.brand, fontSize:14, fontWeight:500 }}>Loading...</div>
    </div>
  )

  return (
    <div style={T.page}>
      {/* page.tsx owns the frame. The rail is rendered ONCE, here, at index 0,
          with the current tab after it — so React keeps the SAME rail element
          mounted across tab switches and its active pill slides between
          sections instead of re-entering on every change. That is the whole
          reason the rail moved out of the tabs.
          RxPage no longer emits this wrapper or the rail; it supplies only a
          tab's header and body, so passing rail={} to it now would render a
          second rail underneath the first. The tab block below keeps its own
          indentation: re-indenting sixty lines would bury a structural change
          in a whitespace diff. */}
      <div className="rx">
        {rail}

      {tab==='dashboard' && (
        <DashboardView
          mrfs={mrfVMs}
          candidates={candVMs}
          stages={STAGES}
          joinedThisMonth={joinedThisMonth}
          todos={dashboardTodos({ mrfs: mrfVMs, viewerName: grant.name ?? '' })}
          onTab={k => setTab(k as typeof tab)}
          /* No page-level handler exists for either of these: setSelCand lives
             inside PipelineTab and setShowForm inside MRFTab. Routing through
             setTab keeps every handler where it is rather than lifting state. */
          onOpenCandidate={() => setTab('pipeline')}
          onRaiseMrf={() => setTab('mrf')}
        />
      )}
      {/* Job Status keeps its own component: it carries ten pieces of state
          and eight UI blocks, six of which JobStatusView has no slot for.
          Per Step 6 of the guide it is restyled in place inside RxPage
          rather than replaced by the view. */}
      {tab==='jobstatus' && <JobStatusTab {...props} />}
      {/* MRF renders MrfListView, which is a genuine fit here in a way
          JobStatusView was not: it has a passthrough slot for the existing
          filter bar and its actions map one-to-one onto the tab's handlers.
          The tab keeps its create/edit form, its detail drawer, its approval
          modal and its delete dialog. */}
      {tab==='mrf' && <MRFTab {...props} />}
      {/* Pipeline renders PipelineView. No drag-and-drop by design: every
          stage move still goes through the modal, so moveStage's forward-only
          rule and the modal's own feedback gate cannot be bypassed. */}
      {tab==='pipeline' && <PipelineTab {...props} />}
      {/* AI Screening is a WRAP, not a replace: the kit has no ScreeningView.
          The tab keeps its upload flow and handlers; only the result rows
          move to ScreeningResultCard, with the API's field names mapped. */}
      {tab==='screening' && <ScreeningTab {...props} />}
      {/* Negotiation is a WRAP. The payroll calculator's table and maths are
          untouched on purpose: restyling statutory EPF/ESIC/PT presentation
          risks real numbers for cosmetic gain. Only the frame, the list and
          the panel containers change. */}
      {tab==='negotiation' && <NegotiationTab {...props} />}
      {/* Offer Approval has TWO component returns -- the list, and an early
          return for the selected candidate. Both are wrapped, or the screen
          loses its chrome the moment a request is created. */}
      {tab==='offerapproval' && <OfferApprovalTab {...props} />}
      {/* Offers: the letter body and the Send flow are deliberately not
          restyled -- that text reaches a real candidate. Only the frame,
          the list and the panel container change. */}
      {tab==='offers' && <OffersTab {...props} />}
      {/* Pre-onboarding: render-only restyle. Every control here writes,
          deletes or emails a real candidate (sendAcceptance posts to
          send-letter), so the frame changed and the handlers did not. */}
      {tab==='preonboarding' && <PreOnboardTab {...props} />}
      {/* HR Head lives in offer-flow-components.tsx, which has its own style
          objects and its own RecFilterBar/SearchBar. Only this component was
          converted; CreateOfferApproval and AuditTrailViewer in that file are
          untouched, since the Offer Approval tab renders both. */}
      {tab==='hrhead' && isHrHead && <HRHeadApprovalDashboard companies={companies} departments={departments} locations={locations} mrfs={mrfs} />}
      {tab==='sendoffer' && <HRManagerSendOffer companies={companies} departments={departments} locations={locations} mrfs={mrfs} allowedMrfIds={sendOfferAllowed} />}

      </div>

      {/* Outside .rx: the toast is position:fixed to the viewport, not to the
          module frame. */}
      {notify && <Toast msg={notify.msg} type={notify.type} onClose={() => setNotify(null)} />}
    </div>
  )
}

// ── Skills multi-select (searchable + custom-add to DB) ───────────
function SkillsMultiSelect({ value, onChange, allSkills, onAddSkill }:{ value:string; onChange:(v:string)=>void; allSkills:string[]; onAddSkill:(n:string)=>void }) {
  const [q, setQ] = useState('')
  const selected = value ? value.split(',').map(s=>s.trim()).filter(Boolean) : []
  const lowerSel = selected.map(s=>s.toLowerCase())
  const matches = q.trim()
    ? allSkills.filter(s=>s.toLowerCase().includes(q.trim().toLowerCase()) && !lowerSel.includes(s.toLowerCase())).slice(0,8)
    : []
  const exact = allSkills.some(s=>s.toLowerCase()===q.trim().toLowerCase()) || lowerSel.includes(q.trim().toLowerCase())
  const add = (skill:string) => { if(!lowerSel.includes(skill.toLowerCase())) onChange([...selected, skill].join(', ')); setQ('') }
  const remove = (skill:string) => onChange(selected.filter(s=>s!==skill).join(', '))
  const addCustom = () => { const n=q.trim(); if(!n) return; onAddSkill(n); add(n) }
  return (
    <div>
      {selected.length>0 && (
        <div style={{ display:'flex', flexWrap:'wrap' as const, gap:6, marginBottom:6 }}>
          {selected.map(s=>(
            <span key={s} style={{ fontSize:11, padding:'3px 8px', borderRadius:99, background:C.brandTint, color:C.brandDeep, fontWeight:500, display:'inline-flex', alignItems:'center' }}>
              {s}<span onClick={()=>remove(s)} style={{ cursor:'pointer', marginLeft:5, fontWeight:700 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ position:'relative' as const }}>
        <input className="rx-input" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search skills — type e.g. 'py' then pick, or add custom"
          onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); if(matches[0]) add(matches[0]); else if(q.trim()&&!exact) addCustom() } }} />
        {q.trim() && (matches.length>0 || !exact) && (
          <div style={{ position:'absolute' as const, top:'100%', left:0, right:0, background:C.surface, border: `1px solid ${C.brandEdge}`, borderRadius:7, marginTop:2, zIndex:20, maxHeight:200, overflowY:'auto' as const, boxShadow:'0 6px 18px rgba(0,0,0,.1)' }}>
            {matches.map(s=>(
              <div key={s} onClick={()=>add(s)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:C.ink }}>{s}</div>
            ))}
            {!exact && q.trim() && (
              <div onClick={addCustom} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:C.brand, fontWeight:600, borderTop:matches.length?`1px solid ${C.line}`:'none' }}>+ Add custom: “{q.trim()}”</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// Close an MRF automatically once offers sent (Offer Sent + Joined) reach its openings.
async function closeMrfIfFilled(supabase:any, mrfId?:string) {
  if (!mrfId) return
  const { data:m } = await supabase.from('manpower_requisitions').select('no_of_openings, openings, status').eq('id', mrfId).maybeSingle()
  if (!m || m.status==='CLOSED') return
  const openings = Number(m.no_of_openings || m.openings || 1)
  const { count } = await supabase.from('candidates').select('id', { count:'exact', head:true }).eq('mrf_id', mrfId).in('stage', ['Offer Sent','Joined'])
  if ((count||0) >= openings) await supabase.from('manpower_requisitions').update({ status:'CLOSED' }).eq('id', mrfId)
}

// Re-open a CLOSED MRF (e.g. candidate backed out) so it shows up as hiring again.
async function reopenMrf(supabase:any, mrfId?:string) {
  if (!mrfId) return
  const { data:m } = await supabase.from('manpower_requisitions').select('status').eq('id', mrfId).maybeSingle()
  if (m?.status === 'CLOSED') await supabase.from('manpower_requisitions').update({ status:'APPROVED' }).eq('id', mrfId)
}

// ── MRF HELPERS ───────────────────────────────────────────────────
// Field taxonomy follows mrf-module-spec.md §2 (sections 1–10).
// The MRF_STATUSES list that sat here is gone with MrfOverview, its only
// consumer. MrfListView carries its own ordered status list, and MRF_LABEL /
// MRF_TONE in the kit's primitives cover all six of the same keys.
// Quick Hire is the ≤ ₹6L lane; Full MRF carries any CTC, with no floor.
const QUICK_HIRE_CAP = 600000
// §1 Requisition type · §3 Work mode · §9 Sourcing mode
const REQ_TYPES     = ['New Hire','Replacement','Temporary','Backfill']
const WORK_MODES    = ['Onsite','Hybrid','Remote']
const SOURCING_MODES= ['External','Internal','Both']
const ATTACH_KINDS  = [
  { k:'ORG_CHART',  label:'Org chart snapshot' },
  { k:'BUDGET_DOC', label:'Budget approval document' },
  { k:'OTHER',      label:'Other supporting file' },
]
// §7 CTQ — Critical-to-Qualify screening questions driving auto-reject.
const CTQ_TYPES = [
  { k:'YES_NO',     label:'Yes / No' },
  { k:'NUMBER_MIN', label:'Number — minimum' },
  { k:'TEXT',       label:'Free text' },
]
// §8 Default approval hierarchy. Stored per requisition (not hardcoded logic),
// so a different chain can be used per department without a code change.
const DEFAULT_CHAIN_ROLES = ['Reporting Manager','Department Head','HR','Finance']

const CUR_SYMBOL:Record<string,string> = { INR:'₹', USD:'$', GBP:'£', EUR:'€', AED:'AED ', SGD:'S$' }
const money  = (n?:number|null, cur='INR') => n==null ? '—' : (CUR_SYMBOL[cur]||'')+Number(n).toLocaleString('en-IN')
const lakhs  = (n?:number|null, cur='INR') => n==null ? '—' : cur==='INR' ? '₹'+(Number(n)/100000).toFixed(1)+'L' : money(n,cur)
const fmtDay = (s?:string|null) => s ? new Date(s).toLocaleDateString('en-IN',{ day:'2-digit', month:'short', year:'numeric' }) : '—'
const asArray = (v:any) => Array.isArray(v) ? v : (typeof v==='string' && v ? (()=>{ try { return JSON.parse(v) } catch { return [] } })() : [])

// ── Compensation basis, driven by employment type ─────────────────
// An employee draws a salary; interns, apprentices (NAPS/NATS) and live-project
// trainees draw a stipend; contractors and consultants are paid fees. The three
// are quoted on different bases, so the form must not label them all "Salary".
// `fixedTerm` marks engagements that run for a defined period and therefore
// need a duration — an internship without one is not a real requisition.
// Moved to lib/recruitment/compensation.ts so the HR Head's over-ceiling tile
// can apply the SAME annual/monthly normalisation this form does. Importing it
// back out of this page would have closed a cycle (this file imports
// ./offer-flow-components; components/ess/RecruitmentModule.tsx imports this
// page). The table and compOf are unchanged; all ten call sites below still
// read compOf(...) exactly as before.
const perLabel = (p:string) => p==='ANNUAL' ? 'per annum' : 'per month'
/** Annual figures read better in lakhs; monthly stipends and fees do not. */
const payAmount = (n?:number|null, cur='INR', period='ANNUAL') =>
  n==null ? '—' : period==='ANNUAL' ? lakhs(n,cur) : money(n,cur)+'/mo'
/** Target joining date + N months → the engagement's expected end date. */
function addMonths(dateStr?:string, months?:number|string) {
  const n = Number(months)
  if (!dateStr || !n) return null
  const d = new Date(dateStr); if (isNaN(d.getTime())) return null
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < day) d.setDate(0)   // clamp 31 Jan + 1 month → 28/29 Feb
  return d.toISOString().slice(0,10)
}

// Load several master_values lists in one round trip, keyed by master type code.
async function loadMasterValues(supabase:any, codes:string[]) {
  const out:Record<string,{code:string;label:string}[]> = {}
  codes.forEach(c=>{ out[c] = [] })
  const { data:types } = await supabase.from('master_types').select('id, code').in('code', codes)
  if (!types?.length) return out
  const byId = new Map(types.map((t:any)=>[t.id, t.code]))
  const { data:vals } = await supabase.from('master_values')
    .select('type_id, code, label, is_active, sort_order')
    .in('type_id', types.map((t:any)=>t.id)).order('sort_order')
  for (const v of vals||[]) {
    if (v.is_active === false) continue
    const c = byId.get(v.type_id) as string | undefined
    if (c) out[c].push({ code:v.code, label:v.label })
  }
  return out
}

// Field-level validation. Returns { field: message }; empty means valid.
// `strict` adds the checks that only matter when submitting for approval — a
// draft is allowed to be half-finished, a submission is not.
function validateMrf(form:any, strict:boolean) {
  const e:Record<string,string> = {}
  const bMin = Number(form.budget_min)||0, bMax = Number(form.budget_max)||0
  const xMin = Number(form.experience_min)||0, xMax = Number(form.experience_max)||0
  if (!form.company_id) e.company_id = 'Company is required'
  if (!String(form.designation||'').trim()) e.designation = 'Designation is required'
  if (Number(form.no_of_openings) < 1) e.no_of_openings = 'At least 1 opening'
  const comp = compOf(form.employment_type)
  if (bMin && bMax && bMin > bMax) e.budget_max = `Max ${comp.label.toLowerCase()} is below the minimum`
  if (form.experience_min && form.experience_max && xMin > xMax) e.experience_max = 'Max experience is below the minimum'
  // The two lanes split at ₹6L CTC and do not overlap:
  //   Quick Hire  → CTC ≤ ₹6L
  //   Full MRF    → CTC >  ₹6L
  // Monthly stipends and fees are annualised first, so the same ₹6L boundary
  // means the same thing whatever the employment type.
  const annualMax = comp.period==='ANNUAL' ? bMax : bMax * 12
  const perMo = comp.period==='ANNUAL' ? '' : ` (${money(bMax)}/mo = ${lakhs(annualMax)} a year)`
  if (bMax && form.mrf_type==='Quick Hire' && annualMax > QUICK_HIRE_CAP)
    e.budget_max = `Quick Hire covers CTC up to ₹${QUICK_HIRE_CAP/100000}L${perMo} — switch to Full MRF`
  if (bMax && form.mrf_type==='Full MRF' && annualMax <= QUICK_HIRE_CAP)
    e.budget_max = `Full MRF is for CTC above ₹${QUICK_HIRE_CAP/100000}L${perMo} — switch to Quick Hire`
  // A fixed-term engagement without a period is not a usable requisition.
  if (comp.fixedTerm && strict && !Number(form.duration_months))
    e.duration_months = `${form.employment_type} is a fixed-term engagement — enter its duration`
  if (form.duration_months && (Number(form.duration_months) < 1 || Number(form.duration_months) > 60))
    e.duration_months = 'Duration must be between 1 and 60 months'
  // §6 — a requisition cannot expire before the role is due to start.
  if (form.target_joining_date && form.validity_date && form.validity_date < form.target_joining_date)
    e.validity_date = 'Validity date is before the target joining date'
  // §5 — replacement hiring needs to say who is being replaced.
  if ((form.hiring_type==='Replacement'||form.hiring_type==='Backfill') && strict && !form.outgoing_employee_id)
    e.outgoing_employee_id = 'Select the outgoing employee for a replacement'
  if (strict) {
    if (!form.department_id) e.department_id = 'Pick a department before submitting'
    if (!form.reason) e.reason = 'Reason for hire is required'
    if (!bMax) e.budget_max = 'Budget is needed for approval'
    if (!form.target_joining_date) e.target_joining_date = 'Target joining date is required'
    if (form.mrf_type!=='Quick Hire' && !String(form.skills_required||'').trim() && !String(form.job_description||'').trim())
      e.skills_required = 'Add skills or a JD — AI screening needs one of them'
  }
  return e
}

async function logMrfAudit(supabase:any, mrf:{id:string; company_id?:string}, action_type:string, details:any) {
  await supabase.from('recruitment_audit_logs').insert({
    mrf_id:mrf.id, company_id:mrf.company_id||null, action_type, details,
    created_at:new Date().toISOString(),
  })
}

// Inline-error wrapper. Sub-components stay OUTSIDE the parent so typing in a
// field does not re-mount the input and lose focus.
function Field({ label, error, required, hint, children }:{ label:string; error?:string; required?:boolean; hint?:string; children:React.ReactNode }) {
  return (
    <div>
      {/* rx-label, not T.label. Every field in the ten-step MRF form goes
          through here, so this one line moves all 43 of them off the 11px
          uppercase eyebrow and onto the redesign's 12.5px sentence-case
          label — the same one MrfForm and the SearchBox above it use.
          The required marker is <em>, which is what .rx-label styles. */}
      <label className="rx-label" style={{ display:'block', marginBottom:6 }}>{label}{required && <em> *</em>}</label>
      {children}
      {error ? <div style={{ fontSize:11, color:C.critical, marginTop:3 }}>⚠ {error}</div>
             : hint ? <div style={{ fontSize:F.micro, color:C.muted, marginTop:S.xs }}>{hint}</div> : null}
    </div>
  )
}

function MrfMeta({ label, value }:{ label:string; value:React.ReactNode }) {
  return (
    <div>
      <div style={{ ...eyebrow }}>{label}</div>
      <div style={{ fontSize:13, color:C.ink, marginTop:2 }}>{value ?? '—'}</div>
    </div>
  )
}

// Reusable master-driven dropdown; falls back to a hint when the lookup is empty.
// `useCode` makes the option values the master's CODE instead of its label. Currency
// needs that: the column stores INR, not "INR - Indian Rupee". Without it the select
// held labels while the form held a code, nothing ever matched, and the box snapped
// back to "Select…" every time somebody picked a currency.
function MasterSelect({ options, value, onChange, placeholder, style, useCode }:any) {
  return (
    <select className="rx-input" style={style} value={value||''} onChange={e=>onChange(e.target.value)}>
      <option value="">{options?.length ? (placeholder||'Select…') : 'No options configured'}</option>
      {(options||[]).map((o:any)=>
        <option key={o.code} value={useCode ? o.code : o.label}>{o.label}</option>)}
    </select>
  )
}

// Type-to-filter person picker for RM1/RM2/HOD — the plain <select> made finding
// one name in a few hundred employees a scroll hunt. Shows the selected person's
// name+designation when idle; switches to a filter box while typing. Closes on
// pick or on a click outside the box.
function PersonSearchSelect({ people, value, onChange, placeholder }:{ people:any[]; value:string; onChange:(id:string)=>void; placeholder?:string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const selected = people.find((p:any)=>p.id===value)

  useEffect(() => {
    const onDocClick = (e:MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQ('') }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const needle = q.trim().toLowerCase()
  const filtered = (needle
    ? people.filter((p:any) =>
        (p.full_name||'').toLowerCase().includes(needle) ||
        (p.emp_code||'').toLowerCase().includes(needle) ||
        (p.designation||'').toLowerCase().includes(needle))
    : people
  ).slice(0, 50)

  return (
    <div ref={boxRef} style={{ position:'relative' }}>
      <input
        className="rx-input" style={{ paddingRight: value ? 28 : undefined }}
        value={open ? q : (selected ? `${selected.full_name}${selected.designation?` — ${selected.designation}`:''}` : '')}
        onChange={e=>setQ(e.target.value)}
        onFocus={()=>{ setOpen(true); setQ('') }}
        placeholder={placeholder||'Search by name, code or designation…'}
      />
      {value && !open && (
        <button type="button" onClick={()=>onChange('')} title="Clear"
          style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', border:'none', background:'transparent', color:C.faint, cursor:'pointer', fontSize:13, padding:2, lineHeight:1 }}
        >✕</button>
      )}
      {/* Every colour below was a literal, which meant this dropdown stayed
          white-on-white in dark mode: background '#fff', ink '#1E1B4B', and a
          '#F5F3FF' hover painted straight onto the node. The hover stays
          imperative — it is set on a DOM element, not in React state — but it
          can still read from a token.

          This sits ABOVE the open-guard rather than inside it. A JSX comment
          in an expression slot is not a comment at all but a second expression
          container, and that is only legal as a child of an element. */}
      {open && (
        <div style={{ position:'absolute', zIndex:20, top:'calc(100% + 4px)', left:0, right:0, maxHeight:220, overflowY:'auto', background:C.surface, border:`1px solid ${C.lineStrong}`, borderRadius:R.md, boxShadow:E.floating }}>
          {filtered.length===0 ? (
            <div style={{ padding:'10px 12px', fontSize:F.tiny, color:C.faint }}>No match</div>
          ) : filtered.map((p:any)=>(
            <div key={p.id}
              onMouseDown={e=>{ e.preventDefault(); onChange(p.id); setOpen(false); setQ('') }}
              style={{ padding:`${S.sm}px ${S.md}px`, fontSize:F.small, cursor:'pointer', color:C.ink, borderBottom:`1px solid ${C.line}` }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLDivElement).style.background=C.brandTint }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLDivElement).style.background=C.surface }}
            >
              <div style={{ fontWeight:W.semi }}>{p.full_name}</div>
              <div style={{ fontSize:F.micro, color:C.faint }}>{p.emp_code||'—'}{p.designation?` · ${p.designation}`:''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The private authHeaders(supabase) that used to live here read ONLY the Supabase
// session, so it handed back {} for an employee signed in through ESS — and this
// page renders inside ESS via components/ess/RecruitmentModule. Against the two
// routes that were already guarded that meant a silent 401 for ESS users.
// lib/auth-headers.ts checks both sessions and is imported at the top instead.

// ── §7 CTQ QUESTION EDITOR ────────────────────────────────────────
function CtqEditor({ items, onChange }:{ items:any[]; onChange:(v:any[])=>void }) {
  const add = () => onChange([...items, { id:`q${Date.now()}`, question:'', type:'YES_NO', expected:'Yes', knockout:true }])
  const set = (i:number, patch:any) => onChange(items.map((q,ix)=> ix===i ? { ...q, ...patch } : q))
  const del = (i:number) => onChange(items.filter((_,ix)=>ix!==i))
  return (
    <div>
      {items.length===0 && (
        <div style={{ fontSize:12, color:C.faint, marginBottom:8 }}>
          No screening questions. Add one to auto-reject applicants who miss a baseline requirement.
        </div>
      )}
      {items.map((q,i)=>(
        <div key={q.id||i} style={{ border: `1px solid ${C.brandEdge}`, borderRadius:10, padding:'10px 12px', marginBottom:8, background:C.sunken }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:C.brandDeep, minWidth:22 }}>Q{i+1}</span>
            <input className="rx-input" style={{ flex:1 }} value={q.question||''} placeholder="e.g. Do you have a valid B.Tech degree?"
              onChange={e=>set(i,{ question:e.target.value })} />
            {/* Was contentless — an empty red box with no label and no
                accessible name. Same stripped-glyph bug as MrfCard's Delete. */}
            <button onClick={()=>del(i)} style={{ ...T.btn, height:32, background:C.criticalTint, color:C.critical, border: `1px solid ${C.criticalEdge}`, fontSize:F.tiny }}>Remove</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, alignItems:'center' }}>
            <select className="rx-input" value={q.type||'YES_NO'} onChange={e=>set(i,{ type:e.target.value, expected: e.target.value==='YES_NO'?'Yes':'' })}>
              {CTQ_TYPES.map(t=><option key={t.k} value={t.k}>{t.label}</option>)}
            </select>
            {q.type==='YES_NO' ? (
              <select className="rx-input" value={q.expected||'Yes'} onChange={e=>set(i,{ expected:e.target.value })}>
                <option value="Yes">Expected: Yes</option><option value="No">Expected: No</option>
              </select>
            ) : (
              <input className="rx-input" value={q.expected||''} placeholder={q.type==='NUMBER_MIN'?'Minimum value':'Expected answer'}
                onChange={e=>set(i,{ expected:e.target.value })} />
            )}
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.muted, whiteSpace:'nowrap' as const }}>
              <input type="checkbox" checked={q.knockout!==false} onChange={e=>set(i,{ knockout:e.target.checked })} />
              Auto-reject
            </label>
          </div>
        </div>
      ))}
      <button onClick={add} style={{ ...T.btnOutline }}>+ Add screening question</button>
    </div>
  )
}

// ── §8 APPROVAL CHAIN EDITOR ──────────────────────────────────────
function ApprovalChainEditor({ chain, onChange }:{ chain:any[]; onChange:(v:any[])=>void }) {
  const add = (role:string) => onChange([...chain, { step:chain.length+1, role, status:'PENDING', actor:null, comments:null, acted_at:null }])
  const del = (i:number) => onChange(chain.filter((_,ix)=>ix!==i).map((s,ix)=>({ ...s, step:ix+1 })))
  const move = (i:number,d:number) => {
    const j = i+d; if (j<0||j>=chain.length) return
    const c = [...chain]; [c[i],c[j]] = [c[j],c[i]]
    onChange(c.map((s,ix)=>({ ...s, step:ix+1 })))
  }
  return (
    <div>
      {chain.length===0 && (
        <div style={{ fontSize:12, color:C.faint, marginBottom:8 }}>
          No chain defined — a single approval will approve this requisition outright.
        </div>
      )}
      {chain.map((s,i)=>(
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 11px', border: `1px solid ${C.brandEdge}`,
          borderRadius:10, marginBottom:6, background: s.status==='APPROVED'?C.positiveTint: s.status==='REJECTED'?C.criticalTint:C.sunken }}>
          <span style={{ width:22, height:22, borderRadius:'50%', background:C.brandTint, color:C.brandDeep, fontSize:11,
            fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i+1}</span>
          <span style={{ fontSize:13, fontWeight:600, flex:1 }}>{s.role}</span>
          {s.status && s.status!=='PENDING' && <Badge text={s.status} />}
          {s.actor && <span style={{ fontSize:11, color:C.faint }}>{s.actor}</span>}
          {/* All three rendered with no content: reordering and removing an
              approver were unlabelled boxes, unreachable by screen reader and
              unguessable by sight. Words, not glyphs — a stripped emoji is
              exactly how they ended up empty. */}
          <button onClick={()=>move(i,-1)} disabled={i===0} title="Move earlier" style={{ ...T.btn, height:32, background:C.brandTint, color:C.brandDeep, border:`1px solid ${C.brandEdge}`, fontSize:F.tiny, opacity:i===0?.4:1 }}>Up</button>
          <button onClick={()=>move(i,1)} disabled={i===chain.length-1} title="Move later" style={{ ...T.btn, height:32, background:C.brandTint, color:C.brandDeep, border:`1px solid ${C.brandEdge}`, fontSize:F.tiny, opacity:i===chain.length-1?.4:1 }}>Down</button>
          <button onClick={()=>del(i)} style={{ ...T.btn, height:32, background:C.criticalTint, color:C.critical, border:`1px solid ${C.criticalEdge}`, fontSize:F.tiny }}>Remove</button>
        </div>
      ))}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const, marginTop:6 }}>
        {DEFAULT_CHAIN_ROLES.filter(r=>!chain.some(s=>s.role===r)).map(r=>(
          <button key={r} onClick={()=>add(r)} style={T.btnOutline}>+ {r}</button>
        ))}
      </div>
    </div>
  )
}

// ── §9 SOURCING CHANNEL PICKER ────────────────────────────────────
function ChannelPicker({ options, value, onChange }:{ options:any[]; value:string[]; onChange:(v:string[])=>void }) {
  const toggle = (label:string) =>
    onChange(value.includes(label) ? value.filter(v=>v!==label) : [...value, label])
  if (!options?.length) return <div style={{ fontSize:12, color:C.faint }}>No sourcing channels configured in Masters.</div>
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
      {options.map((o:any)=>{
        const on = value.includes(o.label)
        return (
          <button key={o.code} onClick={()=>toggle(o.label)} style={{ ...T.btn, fontSize:11,
            background:on?C.brand: C.surface, color:on?C.onAccent:C.brandDeep, border:`1px solid ${on?C.brandDeep:C.brandEdge}` }}>
            {on?'✓ ':''}{o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── §10 ATTACHMENTS ───────────────────────────────────────────────
function AttachmentsPanel({ mrfId, attachments, onChanged, showNotify, supabase }:any) {
  const [kind, setKind] = useState('ORG_CHART')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file:File) {
    setBusy(true)
    const fd = new FormData()
    fd.append('mrf_id', mrfId); fd.append('kind', kind); fd.append('file', file)
    try {
      const r = await fetch('/api/recruitment/upload-mrf-doc', { method:'POST', body:fd, headers: await uploadAuthHeaders() })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error||'Upload failed')
      showNotify('File uploaded'); onChanged()
    } catch (e:any) { showNotify(e.message||'Upload failed','error') }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function open(path:string) {
    const r = await fetch('/api/recruitment/upload-mrf-doc?path='+encodeURIComponent(path), { headers: await authHeaders() })
    const j = await r.json()
    if (j.url) window.open(j.url,'_blank'); else showNotify(j.error||'Could not open file','error')
  }

  async function remove(path:string) {
    const r = await fetch(`/api/recruitment/upload-mrf-doc?mrf_id=${mrfId}&path=${encodeURIComponent(path)}`, { method:'DELETE', headers: await authHeaders() })
    if (r.ok) { showNotify('File removed'); onChanged() } else showNotify('Could not remove file','error')
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' as const, alignItems:'center' }}>
        <select className="rx-input" style={{ maxWidth:230 }} value={kind} onChange={e=>setKind(e.target.value)}>
          {ATTACH_KINDS.map(a=><option key={a.k} value={a.k}>{a.label}</option>)}
        </select>
        <input ref={inputRef} type="file" style={{ display:'none' }}
          onChange={e=>{ const f=e.target.files?.[0]; if (f) upload(f) }} />
        <button onClick={()=>inputRef.current?.click()} disabled={busy} style={{ ...T.btnPrimary, opacity:busy?.6:1 }}>
          {busy?'Uploading…':'Upload file'}
        </button>
        <span style={{ fontSize:11, color:C.faint }}>Max 10 MB</span>
      </div>
      {attachments.length===0 && <div style={{ fontSize:12, color:C.faint }}>No documents attached.</div>}
      {attachments.map((a:any)=>(
        <div key={a.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom: `1px solid ${C.line}`, gap:10 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>{a.name}</div>
            <div style={{ fontSize:11, color:C.faint }}>
              {ATTACH_KINDS.find(k=>k.k===a.kind)?.label||a.kind}
              {a.size?` · ${(a.size/1024).toFixed(0)} KB`:''} · {fmtDay(a.uploaded_at)}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button onClick={()=>open(a.path)} style={T.btnOutline}>Open</button>
            <button onClick={()=>remove(a.path)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border: `1px solid ${C.criticalTint}`, fontSize:11 }}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function MrfDetail({ supabase, mrf:m, org, cands, people, onClose, onEdit, onReview, onChanged, showNotify, canEdit, canSendBack, onSendBack }:any) {
  const [logs, setLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  useEffect(()=>{
    supabase.from('recruitment_audit_logs').select('*').eq('mrf_id', m.id)
      .order('created_at',{ ascending:false }).limit(50)
      .then(({data}:any)=>{ setLogs(data||[]); setLoadingLogs(false) })
  },[supabase, m.id])

  const openings = m.no_of_openings || m.openings || 0
  const filled = cands.filter((c:Candidate)=>c.stage==='Offer Sent'||c.stage==='Joined').length
  const byStage = STAGES.map(s=>({ stage:s, rows:cands.filter((c:Candidate)=>c.stage===s) })).filter(x=>x.rows.length)
  const fmtDT = (s?:string) => s ? new Date(s).toLocaleString('en-IN',{ dateStyle:'medium', timeStyle:'short' }) : '—'
  const nameOf = (id?:string) => people.find((p:any)=>p.id===id)?.full_name || '—'
  const ctq = asArray(m.ctq_questions), chain = asArray(m.approval_chain)
  const channels = asArray(m.sourcing_channels), files = asArray(m.attachments)
  const comp = compOf(m.employment_type)

  // Neutral scrim, not rgba(30,27,75,…): that was the pre-rebrand navy, frozen.
  // It is rgba rather than hex, so the colour ratchet never saw it — found by
  // walking the UI, not by a tool. CandidateInterviewModal was converted in
  // 5cdc45a; these two lived in page.tsx and were missed.
  //
  // The drawer shadow keeps its -8px geometry deliberately: this panel slides in
  // from the right, so the offset is directional and an elevation token would
  // flatten it. Only the colour changes.
  //
  // This comment sits ABOVE the return, not inside it: after `return (` the
  // parenthesis takes exactly one element, so a JSX comment there parses as an
  // empty object literal and breaks the file. (Written here once already, and
  // ignored once already — a {/* … */} placed on the next line took tsc from
  // 43 to 19 while this very warning sat ten lines above it.)
  //
  // padding:0 on the drawer: this panel came out of a container that had none,
  // so all twelve sections below pad themselves. The shell's own 28px would
  // double that and, worse, inset the gradient header that is meant to bleed
  // edge to edge — measured at 495px inside a 560px drawer before the override.
  return (
    <RxDialog open onClose={onClose} variant="drawer" label="Requisition detail" style={{ padding: 0 }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg,${C.brand},${C.brand})`, padding:'16px 20px', position:'sticky', top:0, zIndex:2 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:17, fontWeight:700, color:C.onAccent }}>{m.job_title||m.designation||m.position||'Untitled'}</div>
              <div style={{ fontSize:12, color:C.onAccentSoft, marginTop:3 }}>
                {m.mrf_number||'No MRF number'} · {org.company}
              </div>
            </div>
            <button onClick={onClose} style={{ border:'1px solid rgba(255,255,255,.3)', background:'transparent', color:C.onAccent, borderRadius:7, padding:'6px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit', flexShrink:0 }}>Close</button>
          </div>
          <div style={{ display:'flex', gap:7, marginTop:10, flexWrap:'wrap' as const }}>
            <Badge text={m.status} />
            {m.mrf_type && <Badge text={m.mrf_type} />}
            {m.urgency && <span style={{ fontSize:F.micro, padding:'3px 9px', borderRadius:R.pill, background:'rgba(255,255,255,.2)', color:C.onAccent, fontWeight:W.semi, lineHeight:1.45 }}>{m.urgency} priority</span>}
            {m.work_mode && <span style={{ fontSize:F.micro, padding:'3px 9px', borderRadius:R.pill, background:'rgba(255,255,255,.2)', color:C.onAccent, fontWeight:W.semi, lineHeight:1.45 }}>{m.work_mode}</span>}
          </div>
        </div>

        <div style={{ padding:'16px 20px' }}>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' as const }}>
            {canEdit && <button onClick={()=>{ onEdit(m); onClose() }} style={T.btnOutline}>Edit this MRF</button>}
            {canSendBack && <button onClick={()=>{ onSendBack(m); onClose() }} style={{ ...T.btnOutline, borderColor:C.warningEdge, color:C.warning }}>↩ Send back to raiser</button>}
            {(m.status==='SUBMITTED'||m.status==='ON_HOLD') && (
              <button onClick={()=>{ onReview(m); onClose() }} style={T.btnPrimary}>Review & Approve</button>
            )}
          </div>

          {/* §1 Requisition Meta */}
          <div style={T.card}>
            <div style={T.section}>Requisition Meta</div>
            <div style={{ ...T.g3, rowGap:12 }}>
              <MrfMeta label="Requisition ID" value={m.mrf_number} />
              <MrfMeta label="Date Raised" value={fmtDay(m.created_at)} />
              <MrfMeta label="Raised By" value={m.raised_by_name ? `${m.raised_by_name}${m.raised_by_role?` · ${m.raised_by_role}`:''}` : '—'} />
              <MrfMeta label="Requisition Type" value={m.hiring_type} />
              <MrfMeta label="Priority" value={m.urgency} />
              <MrfMeta label="Form Type" value={m.mrf_type} />
            </div>
          </div>

          {/* §2 Position Details */}
          <div style={T.card}>
            <div style={T.section}>Position Details</div>
            <div style={{ ...T.g3, rowGap:12 }}>
              <MrfMeta label="Job Title" value={m.job_title} />
              <MrfMeta label="Designation" value={m.designation||m.position} />
              <MrfMeta label="Department" value={org.dept} />
              <MrfMeta label="Business Unit" value={m.business_unit} />
              <MrfMeta label="Grade / Band" value={m.grade} />
              <MrfMeta label="Job Code" value={m.job_code} />
              <MrfMeta label="RM1 — Reporting Manager" value={m.reporting_manager_id ? nameOf(m.reporting_manager_id) : '—'} />
              <MrfMeta label="RM2 — Skip-level Manager" value={m.rm2_id ? nameOf(m.rm2_id) : '—'} />
              <MrfMeta label="HOD — Department Head" value={m.hod_id ? nameOf(m.hod_id) : '—'} />
              <MrfMeta label="Reports-to Designation" value={m.reports_to_designation} />
              <MrfMeta label="Openings" value={`${openings} (filled ${filled})`} />
            </div>
          </div>

          {/* §3 Employment Details */}
          <div style={T.card}>
            <div style={T.section}>Employment Details</div>
            <div style={{ ...T.g3, rowGap:12 }}>
              <MrfMeta label="Employment Type" value={m.employment_type} />
              <MrfMeta label="Work Mode" value={m.work_mode} />
              <MrfMeta label="Work Location" value={org.loc} />
              <MrfMeta label="Shift / Schedule" value={m.shift_schedule} />
            </div>
          </div>

          {/* §4 Budget & Cost — labelled by compensation basis */}
          <div style={T.card}>
            <div style={T.section}>Budget &amp; Cost</div>
            <div style={{ ...T.g3, rowGap:12 }}>
              <MrfMeta label="Cost Center" value={m.cost_center} />
              <MrfMeta label="Budgeted Position" value={m.is_budgeted==null?'—':(m.is_budgeted?'Yes — budgeted':'No — unbudgeted')} />
              <MrfMeta label="Worker / Skill Category" value={(m as any).wage_category||'—'} />
              <MrfMeta label="Headcount Reference" value={m.headcount_ref} />
              <MrfMeta label="Paid As" value={`${comp.label} · ${perLabel(comp.period)}`} />
              <MrfMeta label={`${comp.label} Range`}
                value={(m.budget_min||m.budget_max)
                  ? `${money(m.budget_min,m.currency)} — ${money(m.budget_max,m.currency)}${comp.period==='MONTHLY'?' /mo':''}` : '—'} />
              <MrfMeta label="Currency" value={m.currency} />
              {(m.duration_months || comp.fixedTerm) && (
                <MrfMeta label="Engagement Duration"
                  value={m.duration_months ? `${m.duration_months} month${m.duration_months===1?'':'s'}` : '—'} />
              )}
              {m.duration_end && <MrfMeta label="Expected End Date" value={fmtDay(m.duration_end)} />}
              {m.duration_months && m.budget_max && comp.period==='MONTHLY' && (
                <MrfMeta label={`Total ${comp.label} (est.)`} value={money(Number(m.budget_max)*Number(m.duration_months), m.currency)} />
              )}
            </div>
          </div>

          {/* §5 Justification */}
          <div style={T.card}>
            <div style={T.section}>Justification</div>
            <div style={{ ...T.g3, rowGap:12, marginBottom: m.business_justification?10:0 }}>
              <MrfMeta label="Reason for Hire" value={m.reason||m.reason_for_hire} />
              <MrfMeta label="Outgoing Employee" value={m.outgoing_employee_id ? nameOf(m.outgoing_employee_id) : '—'} />
              <MrfMeta label="Reason for Exit" value={m.exit_reason} />
            </div>
            {m.business_justification && (
              <div style={{ fontSize:13, color:C.inkSoft, lineHeight:1.7, whiteSpace:'pre-wrap' as const, borderTop: `1px solid ${C.brandEdge}`, paddingTop:9 }}>
                {m.business_justification}
              </div>
            )}
          </div>

          {/* §6 Timeline */}
          <div style={T.card}>
            <div style={T.section}>Timeline</div>
            <div style={{ ...T.g3, rowGap:12 }}>
              <MrfMeta label="Target Joining Date" value={fmtDay(m.target_joining_date)} />
              <MrfMeta label="Requisition Validity" value={fmtDay(m.validity_date)} />
              <MrfMeta label="Raised On" value={fmtDay(m.created_at)} />
            </div>
          </div>

          {/* §7 Candidate Requirements */}
          <div style={T.card}>
            <div style={T.section}>Candidate Requirements</div>
            <div style={{ ...T.g3, rowGap:12, marginBottom:10 }}>
              <MrfMeta label="Experience" value={m.experience_required} />
              <MrfMeta label="Education" value={[m.education_min, m.education_max].filter(Boolean).join(' → ') || m.education_required} />
              <MrfMeta label="Prev. Company" value={m.previous_company_preference} />
            </div>
            {m.skills_required && (
              <div style={{ marginBottom:10 }}>
                <div style={{ ...eyebrow, marginBottom:5 }}>Mandatory Skills</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                  {String(m.skills_required).split(',').map((s:string)=>s.trim()).filter(Boolean).map((s:string)=>(
                    <span key={s} style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:C.brandTint, color:C.brandDeep, fontWeight:500 }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {m.good_to_have_skills && (
              <div>
                <div style={{ ...eyebrow, marginBottom:5 }}>Good-to-have Skills</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                  {String(m.good_to_have_skills).split(',').map((s:string)=>s.trim()).filter(Boolean).map((s:string)=>(
                    <span key={s} style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:C.infoTint, color:C.info, fontWeight:500 }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* §7 CTQ */}
          {ctq.length>0 && (
            <div style={T.card}>
              <div style={T.section}>Screening (CTQ) Questions</div>
              {ctq.map((q:any,i:number)=>(
                <div key={q.id||i} style={{ padding:'8px 0', borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>Q{i+1}. {q.question}</div>
                  <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>
                    {CTQ_TYPES.find(t=>t.k===q.type)?.label||q.type} · expected: <b>{q.expected||'—'}</b>
                    {q.knockout!==false && <span style={{ color:C.critical }}> · auto-reject on fail</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* §8 Approval Workflow */}
          <div style={T.card}>
            <div style={T.section}>Approval Workflow</div>
            <div style={{ ...T.g2, rowGap:12, marginBottom: chain.length?10:0 }}>
              <MrfMeta label="Current Status" value={<Badge text={m.status} />} />
              <MrfMeta label="Decided On" value={fmtDay(m.approved_at)} />
            </div>
            {chain.length===0 && <div style={{ fontSize:12, color:C.faint }}>No approval chain configured — single-step approval.</div>}
            {chain.map((s:any,i:number)=>(
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 0', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, fontSize:11, fontWeight:700,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background: s.status==='APPROVED'?C.positiveTint: s.status==='REJECTED'?C.criticalTint:C.brandTint,
                  color: s.status==='APPROVED'?C.positive: s.status==='REJECTED'?C.critical:C.brandDeep }}>
                  {s.status==='APPROVED'?'':s.status==='REJECTED'?'':i+1}
                </span>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{s.role}</div>
                  <div style={{ fontSize:11, color:C.faint }}>
                    {s.status||'PENDING'}{s.actor?` · ${s.actor}`:''}{s.acted_at?` · ${fmtDay(s.acted_at)}`:''}
                  </div>
                  {s.comments && <div style={{ fontSize:12, color:C.muted, marginTop:3, fontStyle:'italic' as const }}>{s.comments}</div>}
                </div>
              </div>
            ))}
            {m.remarks && (
              <div style={{ fontSize:12, color: m.status==='REJECTED'?C.critical:C.inkSoft, marginTop:10, lineHeight:1.6 }}>
                <b>Approver comments:</b> {m.remarks}
              </div>
            )}
          </div>

          {/* §9 Sourcing */}
          <div style={T.card}>
            <div style={T.section}>Sourcing</div>
            <div style={{ ...T.g2, rowGap:12, marginBottom: channels.length?10:0 }}>
              <MrfMeta label="Assigned Recruiter" value={m.assigned_recruiter} />
              <MrfMeta label="Sourcing Mode" value={m.sourcing_mode} />
            </div>
            {channels.length>0 && (
              <div>
                <div style={{ ...eyebrow, marginBottom:5 }}>Preferred Channels</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                  {channels.map((c:string)=>(
                    <span key={c} style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:C.positiveTint, color:C.positive, fontWeight:500 }}>{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* §10 Attachments */}
          <div style={T.card}>
            <div style={T.section}>Attachments</div>
            <AttachmentsPanel mrfId={m.id} attachments={files} onChanged={onChanged} showNotify={showNotify} supabase={supabase} />
          </div>

          {/* JD */}
          {m.job_description && (
            <div style={T.card}>
              <div style={T.section}>Job Description</div>
              <div style={{ fontSize:13, color:C.inkSoft, lineHeight:1.75, whiteSpace:'pre-wrap' as const }}>{m.job_description}</div>
            </div>
          )}

          {/* Candidates */}
          <div style={T.card}>
            <div style={T.section}>Candidates ({cands.length})</div>
            {cands.length===0 && <div style={{ fontSize:12, color:C.faint }}>No candidates linked to this MRF yet.</div>}
            {byStage.map(({stage, rows})=>(
              <div key={stage} style={{ marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:STAGE_COLOR[stage]||C.faint }} />
                  <span style={{ fontSize:12, fontWeight:600, color:C.ink }}>{stage}</span>
                  <span style={{ fontSize:11, color:C.faint }}>{rows.length}</span>
                </div>
                {rows.map((c:Candidate)=>(
                  <div key={c.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 5px 15px', fontSize:12, borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color:C.inkSoft }}>{c.full_name}</span>
                    <span style={{ color:C.faint, fontSize:11 }}>
                      {c.ai_score!=null ? `AI ${Math.round(c.ai_score)}` : ''}{c.current_company?` · ${c.current_company}`:''}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Activity */}
          <div style={T.card}>
            <div style={T.section}>Activity</div>
            {loadingLogs && <div style={{ fontSize:12, color:C.faint }}>Loading…</div>}
            {!loadingLogs && logs.length===0 && (
              <div style={{ fontSize:12, color:C.faint }}>No activity recorded against this MRF yet.</div>
            )}
            {logs.map((l:any)=>(
              <div key={l.id} style={{ display:'flex', gap:10, padding:'7px 0', borderBottom: `1px solid ${C.line}` }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:C.brand, marginTop:5, flexShrink:0 }} />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>{String(l.action_type||'').replace(/_/g,' ')}</div>
                  {l.details && (
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                      {Object.entries(l.details).map(([k,v])=>`${k}: ${v}`).join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize:F.micro, color:C.muted, marginTop:2 }}>
                    {fmtDT(l.created_at)}{l.actor_email?` · ${l.actor_email}`:''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
    </RxDialog>
  )
}

// ── MRF TAB ───────────────────────────────────────────────────────
function MRFTab({ supabase, companies, locations, departments, mrfs, candidates, onRefresh, showNotify, employeeId, mrfInitialSub, mrfFocusId, canEditAnyMrf, rail }:any) {
  const EMPTY = {
    // §1 Requisition Meta
    mrf_type:'Full MRF', hiring_type:'New Hire', urgency:'MEDIUM',
    raised_by_name:'', raised_by_role:'',
    // §2 Position Details
    company_id:'', location_id:'', department_id:'', job_title:'', designation:'',
    business_unit:'', grade:'', job_code:'', reporting_manager_id:'', rm2_id:'', hod_id:'', no_of_openings:1, mrf_number:'',
    // §3 Employment Details
    employment_type:'Employee', work_mode:'Onsite', shift_schedule:'',
    // §4 Budget & Cost
    cost_center:'', is_budgeted:'', headcount_ref:'', budget_min:'', budget_max:'', currency:'INR', wage_category:'',
    duration_months:'',
    // §5 Justification
    reason:'', outgoing_employee_id:'', exit_reason:'', business_justification:'',
    // §6 Timeline
    target_joining_date:'', validity_date:'',
    // §7 Candidate Requirements
    experience_required:'', experience_min:'', experience_max:'',
    education_required:'', education_min:'', education_max:'',
    skills_required:'', good_to_have_skills:'', previous_company_preference:'',
    job_description:'', ctq_questions:[] as any[],
    // §8 Approval Workflow
    approval_chain:[] as any[],
    // §9 Sourcing
    sourcing_mode:'External', sourcing_channels:[] as string[],
  }
  // Only the raiser (or a super admin / legacy dashboard login) may edit or delete an MRF.
  const canEditMrf = (m:any) => !!canEditAnyMrf || (!!employeeId && m?.requested_by === employeeId)
  // The assigned hiring manager can send an APPROVED MRF back to the raiser for changes.
  const canSendBackMrf = (m:any) => m?.status==='APPROVED' && !!employeeId && Array.isArray(m?.assigned_recruiter_ids) && m.assigned_recruiter_ids.includes(employeeId)
  const [sendBackFor, setSendBackFor] = useState<MRF|null>(null)
  const [sbNote, setSbNote] = useState('')
  const [sbBusy, setSbBusy] = useState(false)
  async function sendBackMrf() {
    if (!sendBackFor || !sbNote.trim()) { showNotify('Add a remark explaining what to fix','error'); return }
    setSbBusy(true)
    try {
      await essApi('/api/ess/mrf', employeeId, { method:'POST', body: JSON.stringify({ action:'revise', id:sendBackFor.id, note:sbNote.trim() }) })
      showNotify('MRF sent back to the raiser for changes.'); setSendBackFor(null); setSbNote(''); onRefresh()
    } catch(e:any){ showNotify(e.message||'Could not send back','error') } finally { setSbBusy(false) }
  }
  const [showForm, setShowForm] = useState(false)
  const [editMRF, setEditMRF] = useState<MRF|null>(null)
  const [form, setForm] = useState<any>(EMPTY)

  // ── MRF Approvals sub-tab — the ESS chain approvals (approve / reject / send-back),
  //    reached from the hyperlink in ESS Tasks & Approvals. Data + actions go through the
  //    ESS API so the chain advances and notifications fire, exactly like Raise MRF.
  const [mrfSub, setMrfSub] = useState<'requisitions'|'approvals'>(mrfInitialSub==='approvals'?'approvals':'requisitions')
  const [toApprove, setToApprove] = useState<any[]>([])
  const [apprErr, setApprErr] = useState('')
  const [reviewMrf, setReviewMrf] = useState<any|null>(null)
  const [apprBusy, setApprBusy] = useState(false)
  const [apprFocused, setApprFocused] = useState(false)
  const loadApprovals = useCallback(async () => {
    if (!employeeId) { setToApprove([]); return }
    try { const d = await essApi('/api/ess/mrf', employeeId); setToApprove(d.toApprove||[]); setApprPeople(toPickerPeople(d)); setApprErr('') }
    catch(e:any){ setApprErr(e.message||'Could not load approvals') }
  }, [employeeId])
  useEffect(()=>{ if (mrfSub==='approvals') loadApprovals() }, [mrfSub, loadApprovals])
  // Open a requisition for review — fetch the full row (the pending-list select omits some
  // fields, e.g. job_description) so the read-only form shows everything.
  const openReviewMrf = useCallback(async (m:any) => {
    try {
      const { data } = await supabase.from('manpower_requisitions')
        .select('*, departments:department_id(dept_name), companies:company_id(company_name), locations:location_id(location_name)')
        .eq('id', m.id).maybeSingle()
      setReviewMrf({ ...m, ...(data||{}) })
    } catch { setReviewMrf(m) }
  }, [supabase])
  // Deep-link: once the pending list is in, open the requested MRF for review.
  useEffect(()=>{
    if (!mrfFocusId || apprFocused || !toApprove.length) return
    const m = toApprove.find((x:any)=>x.id===mrfFocusId)
    if (m) { openReviewMrf(m); setApprFocused(true) }
  }, [mrfFocusId, apprFocused, toApprove, openReviewMrf])
  // HR Head assigns hiring manager(s) as part of approving — searched by code / name.
  const [apprPeople, setApprPeople] = useState<any[]>([])
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignIds, setAssignIds] = useState<string[]>([])
  const pendingRole = (m:any) => (Array.isArray(m?.approval_chain)?m.approval_chain:[]).find((s:any)=>s.status==='PENDING')?.role
  const apprDecide = async (action:'approve'|'reject'|'revise', note?:string, assignedIds?:string[]) => {
    if (!reviewMrf) return
    setApprBusy(true)
    try {
      await essApi('/api/ess/mrf', employeeId, { method:'POST', body: JSON.stringify({ action, id:reviewMrf.id, ...(note!=null?{note}:{}), ...(assignedIds&&assignedIds.length?{ assigned_hr_ids:assignedIds }:{}) }) })
      showNotify(action==='approve'?'MRF approved.':action==='reject'?'MRF rejected.':'Sent back for revision.')
      setReviewMrf(null); setAssignOpen(false); setAssignIds([]); await loadApprovals(); onRefresh()
    } catch(e:any){ showNotify(e.message||'Action failed','error') } finally { setApprBusy(false) }
  }
  const [errors, setErrors] = useState<Record<string,string>>({})
  const [saving, setSaving] = useState(false)
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fPos, setFPos] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const mrfPositions = Array.from(new Set(mrfs.map((m:MRF)=>m.designation||m.position).filter(Boolean))).sort() as string[]
  const [aiLoading, setAiLoading] = useState(false)
  const [approvalModal, setApprovalModal] = useState<MRF|null>(null)
  const [detailMRF, setDetailMRF] = useState<MRF|null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null)
  const [skills, setSkills] = useState<string[]>([])
  const [masters, setMasters] = useState<Record<string,{code:string;label:string}[]>>({})
  const [people, setPeople] = useState<any[]>([])

  useEffect(()=>{
    supabase.from('skills').select('name').order('name').then(({data}:any)=>setSkills((data||[]).map((s:any)=>s.name)))
    // Lookups reused from the existing masters module (§2 grade, §3 shift,
    // §5 exit reason, §9 sourcing channel) plus the three added by 032.
    loadMasterValues(supabase, ['grade','shift_type','candidate_source','separation_reason','business_unit','cost_center','currency'])
      .then(setMasters)
    supabase.from('employees').select('id, full_name, emp_code, designation')
      .order('full_name').then(({data}:any)=>setPeople(data||[]))
  },[supabase])

  async function addSkill(name:string) {
    const { error } = await supabase.from('skills').insert({ name })
    if (!error) setSkills(s=>[...s, name].sort((a,b)=>a.localeCompare(b)))
  }

  // The HR Head for a company — the final MRF approver, resolved the same way the
  // ESS server does: whoever holds the HR_HEAD role, preferring the same company.
  async function resolveHrHead(companyId:string) {
    const { data:role } = await supabase.from('ess_roles').select('id').eq('role_code','HR_HEAD').maybeSingle()
    if (!role) return null
    const { data:urs } = await supabase.from('ess_user_roles').select('ess_account_id').eq('role_id',role.id).eq('is_active',true)
    const acctIds = (urs||[]).map((u:any)=>u.ess_account_id)
    if (!acctIds.length) return null
    const { data:accts } = await supabase.from('ess_accounts').select('employee_id').in('id',acctIds)
    const empIds = (accts||[]).map((a:any)=>a.employee_id)
    if (!empIds.length) return null
    const { data:emps } = await supabase.from('employees').select('id, full_name, emp_code, company_id').in('id',empIds).is('date_of_leaving',null)
    return (emps||[]).find((e:any)=>e.company_id===companyId) || (emps||[])[0] || null
  }

  const filtLocs = form.company_id ? locations.filter((l:Location)=>l.company_id===form.company_id) : locations
  const filtDepts = form.company_id ? departments.filter((d:Department)=>d.company_id===form.company_id) : departments
  const F = (k:string,v:any) => { setForm((f:any)=>({...f,[k]:v})); setErrors(e=> e[k] ? { ...e, [k]:'' } : e) }
  // Returns ONLY the error override now — .rx-input carries the base, so
  // spreading T.input back over it would undo the class. undefined when the
  // field is valid, which React treats as no inline style at all.
  const eb = (k:string): React.CSSProperties | undefined =>
    errors[k] ? { borderColor: C.critical, background: C.criticalTint } : undefined

  const isQuick = form.mrf_type === 'Quick Hire'
  const isReplacement = form.hiring_type==='Replacement' || form.hiring_type==='Backfill'
  // Salary vs stipend vs fees — drives the labels in §4 and the duration field.
  const comp = compOf(form.employment_type)

  const orgOf = (m:MRF) => ({
    company: companies.find((c:Company)=>c.id===m.company_id)?.company_name
      || companies.find((c:Company)=>c.id===m.company_id)?.company_code || '—',
    dept: departments.find((d:Department)=>d.id===m.department_id)?.dept_name || '—',
    loc: locations.find((l:Location)=>l.id===m.location_id)?.location_name || '—',
  })

  // The same resolver MrfDetail already uses. It lives HERE, not at page level,
  // because the employee roster is fetched in this tab — lifting the fetch up to
  // share it would run that query on every tab instead of on this one, which
  // changes the data flow rather than the design.
  const nameOf = (id?:string) => people.find((p:any)=>p.id===id)?.full_name || '—'

  // The card's budget chip, formatted by THIS file's helpers. Budget wording
  // depends on employment type (salary p.a. vs stipend/fees per month) and on
  // six currency symbols; the kit's formatLakh knows neither, so letting it
  // format would mislabel every intern, contractor and consultant requisition.
  const budgetLabelOf = (row:Record<string,unknown>) => {
    if (row.budget_max == null) return null
    const c = compOf(row.employment_type as string|undefined)
    return `${c.label} ${payAmount(Number(row.budget_max), (row.currency as string)||'INR', c.period)} max`
  }

  function openEdit(m:MRF) {
    setEditMRF(m); setErrors({})
    const a:any = m
    setForm({
      mrf_type:a.mrf_type||'Full MRF', hiring_type:a.hiring_type||'New Hire', urgency:m.urgency||'MEDIUM',
      raised_by_name:a.raised_by_name||'', raised_by_role:a.raised_by_role||'',
      company_id:m.company_id||'', location_id:m.location_id||'', department_id:m.department_id||'',
      job_title:a.job_title||m.designation||m.position||'', designation:m.designation||m.position||'',
      business_unit:a.business_unit||'', grade:a.grade||'', job_code:a.job_code||'',
      reporting_manager_id:a.reporting_manager_id||'', rm2_id:a.rm2_id||'', hod_id:a.hod_id||'', no_of_openings:m.no_of_openings||m.openings||1,
      employment_type:m.employment_type||'Employee', work_mode:a.work_mode||'Onsite', shift_schedule:a.shift_schedule||'',
      wage_category:(m as any).wage_category||'',
      cost_center:a.cost_center||'', is_budgeted: a.is_budgeted==null?'':(a.is_budgeted?'yes':'no'),
      headcount_ref:a.headcount_ref||'', budget_min:m.budget_min||'', budget_max:m.budget_max||'', currency:a.currency||'INR',
      duration_months:a.duration_months||'',
      reason:m.reason||m.reason_for_hire||'', outgoing_employee_id:a.outgoing_employee_id||'',
      exit_reason:a.exit_reason||'', business_justification:a.business_justification||'',
      target_joining_date:a.target_joining_date||'', validity_date:a.validity_date||'',
      experience_required:m.experience_required||'', experience_min:a.experience_min||'', experience_max:a.experience_max||'',
      education_required:a.education_required||'', education_min:a.education_min||'', education_max:a.education_max||'',
      skills_required:a.skills_required||'', good_to_have_skills:a.good_to_have_skills||'',
      previous_company_preference:a.previous_company_preference||'',
      job_description:m.job_description||'', ctq_questions:asArray(a.ctq_questions),
      approval_chain:asArray(a.approval_chain),
      sourcing_mode:a.sourcing_mode||'External', sourcing_channels:asArray(a.sourcing_channels),
    })
    setShowForm(true)
  }

  async function generateJD() {
    if (!form.designation && !form.job_title) { showNotify('Please enter the job title or designation first','error'); return }
    setAiLoading(true)
    const dept = departments.find((d:Department)=>d.id===form.department_id)
    try {
      const res = await fetch('/api/recruitment/generate-jd', {
        method:'POST', headers: await authHeaders(),
        body:JSON.stringify({ designation:form.designation||form.job_title, department:dept?.dept_name||'', experience:[form.experience_min,form.experience_max].filter(Boolean).join('-')+(form.experience_min||form.experience_max?' years':''), employee_type:form.employment_type, education:[form.education_min,form.education_max].filter(Boolean).join(' to '), skills:form.skills_required })
      })
      const data = await res.json()
      // Only claim success when text actually came back — an unconfigured key
      // used to surface as "JD generated!" over an untouched textarea.
      if (!res.ok || !data.jd) {
        showNotify(data.message || 'Could not generate JD', 'error')
        setAiLoading(false)
        return
      }
      F('job_description', data.jd)
      showNotify('JD generated!')
    } catch { showNotify('Could not reach the AI service','error') }
    setAiLoading(false)
  }

  async function saveMRF(status:string) {
    const errs = validateMrf(form, status==='SUBMITTED')
    setErrors(errs)
    if (Object.keys(errs).length) {
      showNotify(status==='SUBMITTED' ? 'Fix the highlighted fields before submitting' : 'Fix the highlighted fields', 'error')
      return
    }
    setSaving(true)
    const expReq = (form.experience_min||form.experience_max)
      ? `${form.experience_min||'0'}-${form.experience_max||'0'} years` : (form.experience_required||null)
    const eduReq = form.education_max || form.education_min || form.education_required || null
    // Derived so the requisition still reads correctly if that manager later moves on.
    const mgr = people.find((p:any)=>p.id===form.reporting_manager_id)

    // ── Approval routing — same flow as ESS "Raise MRF" ──────────────────────
    // On SUBMIT, build an approver-resolved chain (RM2 → HR Head) so the task
    // lands in each approver's ESS → Tasks & Approvals, exactly like Raise MRF.
    // RM2 = the manager picked on this form (RM2, else the Reporting Manager);
    // HR Head = whoever holds HR_HEAD for this company.
    let approvalChain: any[] = form.approval_chain || []
    if (status === 'SUBMITTED') {
      const rm2p = people.find((p:any)=>p.id===(form.rm2_id||form.reporting_manager_id))
      const hh = await resolveHrHead(form.company_id)
      const chain:any[] = []
      if (rm2p) chain.push({ order:1, role:'RM2', approver_id:rm2p.id, approver_name:rm2p.full_name, approver_code:rm2p.emp_code, status:'PENDING', acted_at:null, comment:null })
      if (hh && hh.id !== (form.rm2_id||form.reporting_manager_id))
        chain.push({ order:chain.length+1, role:'HR_HEAD', approver_id:hh.id, approver_name:hh.full_name, approver_code:hh.emp_code, status: chain.length ? 'WAITING' : 'PENDING', acted_at:null, comment:null })
      if (!chain.length) {
        setSaving(false)
        showNotify('No approver could be routed — pick a Reporting Manager / RM2 on the form, or set an HR Head for this company.','error')
        return
      }
      approvalChain = chain
    }

    const payload:any = {
      company_id:form.company_id, location_id:form.location_id||null, department_id:form.department_id||null,
      designation:form.designation, position:form.designation,
      job_title:form.job_title||form.designation||null,
      no_of_openings:Number(form.no_of_openings)||1, openings:Number(form.no_of_openings)||1,
      employment_type:form.employment_type, urgency:form.urgency,
      reason:form.reason, reason_for_hire:form.reason,
      job_description:form.job_description||null, status,
      budget_min:Number(form.budget_min)||null, budget_max:Number(form.budget_max)||null,
      ...(!editMRF && form.mrf_number ? { mrf_number:form.mrf_number } : {}),
      // only sent when chosen, so an edit still saves before migration 130 adds the column
      ...(form.wage_category ? { wage_category:form.wage_category } : {}),
      experience_required:expReq, experience_min:form.experience_min||null, experience_max:form.experience_max||null,
      education_required:eduReq, education_min:form.education_min||null, education_max:form.education_max||null,
      skills_required:form.skills_required||null,
      mrf_type:form.mrf_type||null, hiring_type:form.hiring_type||null,
      previous_company_preference:form.previous_company_preference||null,
      // ── added by 032 ──
      raised_by_name:form.raised_by_name||null, raised_by_role:form.raised_by_role||null,
      business_unit:form.business_unit||null, grade:form.grade||null,
      // blank job code → DEPT-DESIG-NN, numbered within the company (same rule as the API)
      job_code:form.job_code || (()=>{ const d=departments.find((x:Department)=>x.id===form.department_id); const prefix=jobCodePrefix(d?.dept_code, d?.dept_name, form.designation||form.job_title||''); return nextJobCode(prefix, mrfs.filter((m:MRF)=>!form.company_id || m.company_id===form.company_id).map((m:MRF)=>(m as any).job_code)) })(),
      reporting_manager_id:form.reporting_manager_id||null,
      reports_to_designation: mgr?.designation || null,
      rm2_id:form.rm2_id||null, hod_id:form.hod_id||null,
      work_mode:form.work_mode||null, shift_schedule:form.shift_schedule||null,
      cost_center:form.cost_center||null,
      is_budgeted: form.is_budgeted==='' ? null : form.is_budgeted==='yes',
      headcount_ref:form.headcount_ref||null, currency:form.currency||'INR',
      // Compensation basis is derived from employment type, then stored, so the
      // requisition keeps the basis it was raised on.
      compensation_type: compOf(form.employment_type).kind,
      pay_period: compOf(form.employment_type).period,
      duration_months: compOf(form.employment_type).fixedTerm || form.duration_months
        ? (Number(form.duration_months)||null) : null,
      duration_end: addMonths(form.target_joining_date, form.duration_months),
      outgoing_employee_id: isReplacement ? (form.outgoing_employee_id||null) : null,
      exit_reason: isReplacement ? (form.exit_reason||null) : null,
      business_justification:form.business_justification||null,
      target_joining_date:form.target_joining_date||null, validity_date:form.validity_date||null,
      good_to_have_skills:form.good_to_have_skills||null,
      ctq_questions:form.ctq_questions||[], approval_chain:approvalChain,
      sourcing_mode:form.sourcing_mode||null, sourcing_channels:form.sourcing_channels||[],
      // Attribute the requisition to the raiser so it shows in their ESS "My requests",
      // and so ESS approval treats it identically to a Raise-MRF submission.
      ...(editMRF ? {} : { requested_by: employeeId || null }),
    }
    let error:any, savedId = editMRF?.id
    if (editMRF) {
      const r = await supabase.from('manpower_requisitions').update(payload).eq('id',editMRF.id)
      error = r.error
    } else {
      const r = await supabase.from('manpower_requisitions').insert(payload).select('id').single()
      error = r.error; savedId = r.data?.id
    }
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    if (savedId) {
      await logMrfAudit(supabase, { id:savedId, company_id:form.company_id },
        editMRF ? 'MRF_UPDATED' : status==='DRAFT' ? 'MRF_DRAFTED' : 'MRF_SUBMITTED',
        { position:form.designation, openings:Number(form.no_of_openings)||1 })
    }
    showNotify(editMRF?'MRF updated!':status==='DRAFT'?'Draft saved!':'MRF submitted for approval!')
    setShowForm(false); setEditMRF(null); setForm(EMPTY); setErrors({}); onRefresh()
  }

  // §8 — single-click approval. One decision approves the requisition outright;
  // any configured chain is stamped complete by the same approver so the
  // recorded trail matches the decision, rather than leaving steps PENDING on
  // an MRF that is already open for hiring.
  async function approveMRF(id:string, recruiter:string, comments:string, actor:string) {
    const mrf = mrfs.find((m:MRF)=>m.id===id); if (!mrf) return
    const chain = asArray((mrf as any).approval_chain)
    const now = new Date().toISOString()
    const nextChain = chain.map((s:any)=> s.status==='APPROVED' ? s : {
      ...s, status:'APPROVED',
      actor: actor || s.actor || null,
      comments: comments || s.comments || null,
      acted_at: s.acted_at || now,
    })
    const patch:any = { status:'APPROVED', approval_chain:nextChain, remarks:comments||null, approved_at:now }
    if (recruiter) patch.assigned_recruiter = recruiter
    const { error } = await supabase.from('manpower_requisitions').update(patch).eq('id',id)
    if (error) { showNotify('Approval failed: '+error.message,'error'); return }
    await logMrfAudit(supabase, mrf, 'MRF_APPROVED', {
      position: mrf.designation||mrf.position,
      steps: chain.length ? chain.map((s:any)=>s.role).join(' → ') : 'single',
      recruiter: recruiter||'unassigned',
    })
    showNotify(recruiter ? 'MRF approved — recruiter assigned.' : 'MRF approved.')
    setApprovalModal(null); onRefresh()
  }

  async function rejectMRF(id:string, remarks:string, actor:string) {
    const mrf = mrfs.find((m:MRF)=>m.id===id); if (!mrf) return
    const chain = asArray((mrf as any).approval_chain)
    const idx = chain.findIndex((s:any)=>s.status!=='APPROVED')
    const nextChain = idx>=0 ? chain.map((s:any,i:number)=> i===idx
      ? { ...s, status:'REJECTED', actor:actor||null, comments:remarks, acted_at:new Date().toISOString() } : s) : chain
    const { error } = await supabase.from('manpower_requisitions')
      .update({ status:'REJECTED', remarks, approval_chain:nextChain }).eq('id',id)
    if (error) { showNotify('Rejection failed: '+error.message,'error'); return }
    await logMrfAudit(supabase, mrf, 'MRF_REJECTED', { position:mrf.designation||mrf.position, reason:remarks })
    showNotify('MRF rejected'); setApprovalModal(null); onRefresh()
  }

  async function holdMRF(id:string, remarks:string) {
    const mrf = mrfs.find((m:MRF)=>m.id===id); if (!mrf) return
    const { error } = await supabase.from('manpower_requisitions').update({ status:'ON_HOLD', remarks:remarks||null }).eq('id',id)
    if (error) { showNotify('Update failed: '+error.message,'error'); return }
    await logMrfAudit(supabase, mrf, 'MRF_ON_HOLD', { position:mrf.designation||mrf.position, reason:remarks||'—' })
    showNotify('MRF put on hold'); setApprovalModal(null); onRefresh()
  }

  async function setMrfStatus(m:MRF, status:string, action:string) {
    const { error } = await supabase.from('manpower_requisitions').update({ status }).eq('id',m.id)
    if (error) { showNotify('Update failed: '+error.message,'error'); return }
    await logMrfAudit(supabase, m, action, { position:m.designation||m.position })
    showNotify(status==='CLOSED'?'MRF closed':'MRF re-opened'); onRefresh()
  }

  async function deleteMRF(id:string) {
    await supabase.from('offer_approval_requests').update({ mrf_id:null }).eq('mrf_id', id)
    await supabase.from('recruitment_audit_logs').update({ mrf_id:null }).eq('mrf_id', id)
    await supabase.from('document_collection_links').update({ mrf_id:null }).eq('mrf_id', id)
    const { error } = await supabase.from('manpower_requisitions').delete().eq('id',id)
    if (error) { showNotify('Delete failed: '+error.message,'error'); return }
    showNotify('MRF deleted'); setDeleteConfirm(null); onRefresh()
  }

  // Search and status are NOT filtered here any more: MrfListView owns the
  // search box, and status is passed to it as a CONTROLLED filter so the
  // "awaiting approval · Show them" banner can still set it from outside.
  // Filtering twice would leave the overview counts disagreeing with the list.
  const visible = mrfs.filter((m:MRF)=>
    (!fCompany || m.company_id===fCompany) &&
    (!fDept || m.department_id===fDept) &&
    (!fLoc || m.location_id===fLoc) &&
    (!fPos || (m.designation||m.position)===fPos)
  ).sort((a:MRF,b:MRF)=>{
    if (sortBy==='oldest')   return +new Date(a.created_at) - +new Date(b.created_at)
    if (sortBy==='openings') return (b.no_of_openings||b.openings||0) - (a.no_of_openings||a.openings||0)
    if (sortBy==='urgency')  { const r:any={HIGH:0,MEDIUM:1,LOW:2}; return (r[a.urgency||'']??3)-(r[b.urgency||'']??3) }
    if (sortBy==='joining')  return +new Date((a as any).target_joining_date||'2999-01-01') - +new Date((b as any).target_joining_date||'2999-01-01')
    return +new Date(b.created_at) - +new Date(a.created_at)
  })

  // filledStages is ['Offer Sent','Joined'] on purpose: that is what this tab's
  // card and overview have always counted as a filled position. The adapter
  // defaults to 'Joined' alone (which is what the Dashboard uses), and taking
  // that default here would quietly drop every candidate holding an offer out
  // of the filled ring — a number going down with nothing on screen to explain it.
  const mrfVMs = visible.map((m:MRF) => toMrfVM(m as unknown as Record<string, unknown>, {
    departments: departments as unknown as Record<string, unknown>[],
    locations: locations as unknown as Record<string, unknown>[],
    candidates: candidates as unknown as Record<string, unknown>[],
    companies: companies as unknown as Record<string, unknown>[],
    quickHireCap: QUICK_HIRE_CAP,
    filledStages: ['Offer Sent', 'Joined'],
    nameOf,
    budgetLabelOf,
  }))

  const pendingCount = mrfs.filter((m:MRF)=>m.status==='SUBMITTED').length

  const bannerNode = pendingCount>0 ? (
    <div style={{ fontSize:12, color:C.warning, background:C.warningTint, border: `1px solid ${C.warningTint}`,
      borderRadius:7, padding:'8px 12px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
      ⏳ {pendingCount} requisition{pendingCount===1?'':'s'} awaiting approval
      <button onClick={()=>setFStatus('SUBMITTED')} style={{ ...T.btn, background:C.warning, color:C.onAccent, fontSize:11 }}>
        Show them
      </button>
    </div>
  ) : null

  // Passed through to MrfListView unchanged, so these five controls behave
  // exactly as before. Search and status are absent deliberately — the view
  // owns the search box and status is controlled above.
  const filterBar = (
    <>
      <select value={fCompany} onChange={e=>setFCompany(e.target.value)} className="rx-input" style={{ maxWidth:170 }}>
        <option value="">All Companies</option>
        {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
      </select>
      <select value={fDept} onChange={e=>setFDept(e.target.value)} className="rx-input" style={{ maxWidth:170 }}>
        <option value="">All Departments</option>
        {departments.filter((d:Department)=>!fCompany||d.company_id===fCompany).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
      </select>
      <select value={fLoc} onChange={e=>setFLoc(e.target.value)} className="rx-input" style={{ maxWidth:170 }}>
        <option value="">All Locations</option>
        {locations.filter((l:Location)=>!fCompany||l.company_id===fCompany).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
      </select>
      <select value={fPos} onChange={e=>setFPos(e.target.value)} className="rx-input" style={{ maxWidth:170 }}>
        <option value="">All Positions</option>
        {mrfPositions.map((p:string)=><option key={p} value={p}>{p}</option>)}
      </select>
      <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="rx-input" style={{ maxWidth:170 }}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="openings">Most openings</option>
        <option value="urgency">Most urgent</option>
        <option value="joining">Earliest joining</option>
      </select>
      {(fCompany||fDept||fLoc||fPos||fStatus)&&<button onClick={()=>{setFCompany('');setFDept('');setFLoc('');setFPos('');setFStatus('')}} style={T.btnOutline}>Clear filters</button>}
    </>
  )

  const formNode = (
    <>
      {/* New MRF → the same auto-filling form as ESS "Raise MRF" (MrfForm): company,
          department and reporting line (RM1/RM2/HOD) prefill from the raiser, and it
          routes through the reporting chain to the HR Head. Editing an existing MRF (or a
          legacy login with no employee record) still uses the detailed form below. */}
      {showForm && !editMRF && employeeId && (
        <div style={T.cardPurple}>
          <MrfForm employeeId={employeeId} notify={showNotify}
            onDone={() => { setShowForm(false); onRefresh() }}
            onCancel={() => setShowForm(false)} />
        </div>
      )}

      {showForm && (editMRF || !employeeId) && (
        <div style={T.cardPurple}>
          {/* A segmented control on a sunken track, matching MrfForm — the ESS
              twin that fills this exact slot when the login resolves an
              employeeId. Two hard-split brand-filled halves read as two
              competing buttons; a track with one raised half reads as one
              control with a current choice. */}
          <div style={{ display:'flex', gap:4, border:`1px solid ${C.line}`, background:C.sunken,
                        borderRadius:13, padding:4, marginBottom:16 }}>
            {['Quick Hire','Full MRF'].map(type=>(
              <button key={type} onClick={()=>F('mrf_type',type)} style={{ flex:1, height:36,
                border:'1px solid transparent', borderRadius:9, cursor:'pointer', fontSize:13,
                fontWeight:W.semi, fontFamily:'inherit',
                background:form.mrf_type===type?`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`:'transparent',
                borderColor:form.mrf_type===type?C.brandDeep:'transparent',
                boxShadow:form.mrf_type===type?E.brand:'none',
                color:form.mrf_type===type?C.onAccent:C.muted }}>
                {type==='Quick Hire'?'Quick Hire (CTC ≤ ₹6L)':'Full MRF (CTC > ₹6L)'}
              </button>
            ))}
          </div>

          {/* Live read on the ₹6L split, so the wrong lane is caught before
              submit. Monthly stipends/fees are annualised to compare like
              with like. Quick Hire ≤ ₹6L · Full MRF > ₹6L. */}
          {(()=>{
            const bMax = Number(form.budget_max)||0
            if (!bMax) return null
            const annual = comp.period==='ANNUAL' ? bMax : bMax*12
            const shouldBe = annual > QUICK_HIRE_CAP ? 'Full MRF' : 'Quick Hire'
            const asYearly = comp.period==='ANNUAL'
              ? lakhs(bMax, form.currency)
              : `${money(bMax, form.currency)}/mo = ${lakhs(annual, form.currency)} a year`
            if (shouldBe === form.mrf_type) return (
              <div style={{ background:C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius:11, padding:'9px 12px',
                marginBottom:14, fontSize:12.5, color:C.positive }}>
                ✓ {asYearly} — correct lane for {form.mrf_type}.
              </div>
            )
            return (
              <div style={{ background:C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius:11, padding:'9px 12px',
                marginBottom:14, fontSize:12.5, color:C.critical, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
                <span>
                  {asYearly} — {shouldBe==='Full MRF'
                    ? 'above ₹6L, so this belongs on a Full MRF.'
                    : 'at or below ₹6L, so this belongs on a Quick Hire.'}
                </span>
                <button onClick={()=>F('mrf_type', shouldBe)} style={{ ...T.btn, background:C.critical, color:C.onAccent, fontSize:11 }}>
                  Switch to {shouldBe}
                </button>
              </div>
            )
          })()}

          {/* ── §1 Requisition Meta ── */}
          <SectionLine title="1 · Requisition Meta" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Requisition Type">
              <select className="rx-input" value={form.hiring_type} onChange={e=>F('hiring_type',e.target.value)}>
                {REQ_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="rx-input" value={form.urgency} onChange={e=>F('urgency',e.target.value)}>
                <option value="HIGH">High / Urgent</option>
                <option value="MEDIUM">Medium / Normal</option>
                <option value="LOW">Low</option>
              </select>
            </Field>
            <Field label="Requisition ID" hint={editMRF?undefined:'Generated on save'}>
              <input className="rx-input" style={{ background:C.sunken, color:C.ink, fontWeight:700 }} value={(editMRF as any)?.mrf_number||form.mrf_number||'Auto-generated'} readOnly />
            </Field>
          </div>
          <div style={{ ...T.g2, marginBottom:10 }}>
            <Field label="Raised By — Name">
              <input className="rx-input" value={form.raised_by_name} onChange={e=>F('raised_by_name',e.target.value)} placeholder="Your name" />
            </Field>
            <Field label="Raised By — Role">
              <input className="rx-input" value={form.raised_by_role} onChange={e=>F('raised_by_role',e.target.value)} placeholder="e.g. Department Head" />
            </Field>
          </div>

          {/* ── §2 Position Details ── */}
          <SectionLine title="2 · Position Details" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Company" required error={errors.company_id}>
              <select className="rx-input" style={eb('company_id')} value={form.company_id} onChange={e=>F('company_id',e.target.value)}>
                <option value="">Select Company</option>
                {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
              </select>
            </Field>
            <Field label="Department / Function" error={errors.department_id}>
              <select className="rx-input" style={eb('department_id')} value={form.department_id} onChange={e=>F('department_id',e.target.value)}>
                <option value="">Select Department</option>
                {filtDepts.map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select>
            </Field>
            <Field label="Business Unit">
              <MasterSelect options={masters.business_unit} value={form.business_unit} onChange={(v:string)=>F('business_unit',v)} />
            </Field>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Job Title">
              <input className="rx-input" value={form.job_title} onChange={e=>F('job_title',e.target.value)} placeholder="e.g. Backend Engineer II" />
            </Field>
            <Field label="Designation" required error={errors.designation}>
              <input className="rx-input" style={eb('designation')} value={form.designation} onChange={e=>F('designation',e.target.value)} placeholder="e.g. Senior Engineer" />
            </Field>
            <Field label="No. of Openings" error={errors.no_of_openings}>
              <input className="rx-input" style={eb('no_of_openings')} type="number" min={1} value={form.no_of_openings} onChange={e=>F('no_of_openings',e.target.value)} />
            </Field>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Grade / Band">
              <MasterSelect options={masters.grade} value={form.grade} onChange={(v:string)=>F('grade',v)} />
            </Field>
            <Field label="Job Code" hint="Position-based staffing only">
              <input className="rx-input" value={form.job_code} onChange={e=>F('job_code',e.target.value)} placeholder={`${jobCodePrefix(departments.find((x:Department)=>x.id===form.department_id)?.dept_code, departments.find((x:Department)=>x.id===form.department_id)?.dept_name, form.designation||form.job_title||'')}## (auto)`} />
            </Field>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="RM1 — Reporting Manager"
              hint={people.find((p:any)=>p.id===form.reporting_manager_id)?.designation
                ? `Reports to: ${people.find((p:any)=>p.id===form.reporting_manager_id)?.designation}` : undefined}>
              <PersonSearchSelect people={people} value={form.reporting_manager_id} onChange={(id:string)=>F('reporting_manager_id',id)} />
            </Field>
            <Field label="RM2 — Skip-level Manager">
              <PersonSearchSelect people={people} value={form.rm2_id} onChange={(id:string)=>F('rm2_id',id)} />
            </Field>
            <Field label="HOD — Department Head">
              <PersonSearchSelect people={people} value={form.hod_id} onChange={(id:string)=>F('hod_id',id)} />
            </Field>
          </div>

          {/* ── §3 Employment Details ── */}
          <SectionLine title="3 · Employment Details" />
          <div style={{ ...T.g4, marginBottom:10 }}>
            <Field label="Employment Type">
              <select className="rx-input" value={form.employment_type} onChange={e=>F('employment_type',e.target.value)}>
                {EMP_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Work Mode">
              <select className="rx-input" value={form.work_mode} onChange={e=>F('work_mode',e.target.value)}>
                {WORK_MODES.map(w=><option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Work Location">
              <select className="rx-input" value={form.location_id} onChange={e=>F('location_id',e.target.value)}>
                <option value="">Select Location</option>
                {filtLocs.map((l:Location)=><option key={l.id} value={l.id}>{l.location_name||l.location_code}</option>)}
              </select>
            </Field>
            <Field label="Shift / Schedule">
              <MasterSelect options={masters.shift_type} value={form.shift_schedule} onChange={(v:string)=>F('shift_schedule',v)} />
            </Field>
          </div>

          {/* ── §4 Budget & Cost ── */}
          <SectionLine title="4 · Budget & Cost" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Cost Center">
              <MasterSelect options={masters.cost_center} value={form.cost_center} onChange={(v:string)=>F('cost_center',v)} />
            </Field>
            <Field label="Budgeted Position">
              <select className="rx-input" value={form.is_budgeted} onChange={e=>F('is_budgeted',e.target.value)}>
                <option value="">Not specified</option>
                <option value="yes">Yes — budgeted</option>
                <option value="no">No — unbudgeted</option>
              </select>
            </Field>
            <Field label="Approved Headcount Ref." hint="Link to the headcount plan record">
              <input className="rx-input" value={form.headcount_ref} onChange={e=>F('headcount_ref',e.target.value)} placeholder="e.g. HCP-2026-014" />
            </Field>
          </div>
          {/* Labels follow the employment type: employees draw a salary,
              interns/apprentices a stipend, contractors and consultants fees. */}
          <div style={{ background:C.brandTint, borderRadius:7, padding:'8px 11px', marginBottom:10, fontSize:12, color:C.brandDeep }}>
            <b>{form.employment_type}</b> → paid as <b>{comp.label.toLowerCase()}</b>, quoted <b>{perLabel(comp.period)}</b>
            {comp.fixedTerm && <> · fixed-term engagement, duration required</>}
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Currency">
              {masters.currency?.length
                ? <MasterSelect useCode options={masters.currency} value={form.currency} onChange={(v:string)=>F('currency', v)} />
                : <input className="rx-input" value={form.currency} onChange={e=>F('currency',e.target.value)} />}
            </Field>
            <Field label={`${comp.label} Range — Min`} hint={perLabel(comp.period)}>
              <input className="rx-input" type="number" value={form.budget_min} onChange={e=>F('budget_min',e.target.value)} placeholder={comp.ph[0]} />
            </Field>
            <Field label={`${comp.label} Range — Max`} error={errors.budget_max} hint={errors.budget_max?undefined:perLabel(comp.period)}>
              <input className="rx-input" style={eb('budget_max')} type="number" value={form.budget_max} onChange={e=>F('budget_max',e.target.value)} placeholder={comp.ph[1]} />
            </Field>
            <Field label="Worker / Skill Category" hint="Sets the minimum wage applied in salary negotiation">
              <select className="rx-input" value={form.wage_category||''} onChange={e=>F('wage_category',e.target.value)}>
                <option value="">Select category…</option>
                {WAGE_CATS.map(ct=><option key={ct} value={ct}>{ct}</option>)}
              </select>
            </Field>
          </div>
          {form.budget_min && form.budget_max && !errors.budget_max && (
            <div style={{ fontSize:11, color:C.brandDeep, marginBottom:10 }}>
              {comp.label} band: {payAmount(Number(form.budget_min), form.currency, comp.period)} — {payAmount(Number(form.budget_max), form.currency, comp.period)}
              {comp.period==='MONTHLY' && form.duration_months && (
                <> · total over {form.duration_months} month{Number(form.duration_months)===1?'':'s'}: {' '}
                  {money(Number(form.budget_max)*Number(form.duration_months), form.currency)}</>
              )}
            </div>
          )}

          {/* Fixed-term engagements run for a defined period. */}
          {(comp.fixedTerm || comp.period==='MONTHLY') && (
            <div style={{ ...T.g3, marginBottom:10 }}>
              <Field label={`${comp.kind==='STIPEND' && form.employment_type==='Intern' ? 'Internship' : 'Engagement'} Duration (months)`}
                required={comp.fixedTerm} error={errors.duration_months}
                hint={errors.duration_months?undefined:(comp.fixedTerm?'Required for this employment type':'Optional')}>
                <input className="rx-input" style={eb('duration_months')} type="number" min={1} max={60} value={form.duration_months}
                  onChange={e=>F('duration_months',e.target.value)} placeholder="e.g. 6" />
              </Field>
              <Field label="Expected End Date"
                hint={form.target_joining_date ? 'Derived from joining date + duration' : 'Set the target joining date first'}>
                <input className="rx-input" style={{ background:C.sunken, color:C.muted }} readOnly
                  value={addMonths(form.target_joining_date, form.duration_months) ? fmtDay(addMonths(form.target_joining_date, form.duration_months)) : '—'} />
              </Field>
              <div />
            </div>
          )}

          {/* ── §5 Justification ── */}
          <SectionLine title="5 · Justification" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Reason for Hire" error={errors.reason}>
              <select className="rx-input" style={eb('reason')} value={form.reason} onChange={e=>F('reason',e.target.value)}>
                <option value="">Select Reason</option>
                <option value="New position">New position</option>
                <option value="Replacement">Replacement</option>
                <option value="Expansion">Expansion</option>
                <option value="Attrition">Attrition</option>
              </select>
            </Field>
            <Field label="Outgoing Employee" error={errors.outgoing_employee_id}
              hint={isReplacement?undefined:'Only for Replacement / Backfill'}>
              <select className="rx-input" style={{ ...eb('outgoing_employee_id'), opacity:isReplacement?1:.55 }} disabled={!isReplacement}
                value={form.outgoing_employee_id} onChange={e=>F('outgoing_employee_id',e.target.value)}>
                <option value="">Select Employee</option>
                {people.map((p:any)=><option key={p.id} value={p.id}>{p.full_name} ({p.emp_code})</option>)}
              </select>
            </Field>
            <Field label="Reason for Exit">
              <select className="rx-input" style={{ opacity:isReplacement?1:.55 }} disabled={!isReplacement}
                value={form.exit_reason} onChange={e=>F('exit_reason',e.target.value)}>
                <option value="">Select Reason</option>
                {(masters.separation_reason||[]).map(o=><option key={o.code} value={o.label}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ marginBottom:10 }}>
            <Field label="Business Justification">
              <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:80 }} value={form.business_justification}
                onChange={e=>F('business_justification',e.target.value)}
                placeholder="Why this headcount is needed — business impact, workload, revenue linkage…" />
            </Field>
          </div>

          {/* ── §6 Timeline ── */}
          <SectionLine title="6 · Timeline" />
          <div style={{ ...T.g2, marginBottom:10 }}>
            <Field label="Target Joining Date" error={errors.target_joining_date}>
              <input type="date" className="rx-input" style={eb('target_joining_date')} value={form.target_joining_date} onChange={e=>F('target_joining_date',e.target.value)} />
            </Field>
            <Field label="Requisition Validity / Expiry" error={errors.validity_date} hint="Auto-flagged as expired if unfilled past this date">
              <input type="date" className="rx-input" style={eb('validity_date')} value={form.validity_date} onChange={e=>F('validity_date',e.target.value)} />
            </Field>
          </div>

          {/* ── §7 Candidate Requirements ── */}
          {!isQuick && (
            <>
              <SectionLine title="7 · Candidate Requirements" />
              <div style={{ ...T.g2, marginBottom:10 }}>
                <Field label="Experience — Min (years)">
                  <input className="rx-input" type="number" min="0" value={form.experience_min} onChange={e=>F('experience_min',e.target.value)} placeholder="e.g. 3" />
                </Field>
                <Field label="Experience — Max (years)" error={errors.experience_max}>
                  <input className="rx-input" style={eb('experience_max')} type="number" min="0" value={form.experience_max} onChange={e=>F('experience_max',e.target.value)} placeholder="e.g. 5" />
                </Field>
              </div>
              <div style={{ ...T.g3, marginBottom:10 }}>
                <Field label="Education — Minimum">
                  <select className="rx-input" value={form.education_min} onChange={e=>F('education_min',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </Field>
                <Field label="Education — Maximum">
                  <select className="rx-input" value={form.education_max} onChange={e=>F('education_max',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </Field>
                <Field label="Previous Company Preference">
                  <select className="rx-input" value={form.previous_company_preference} onChange={e=>F('previous_company_preference',e.target.value)}>
                    <option value="">Select Preference</option>
                    <option value="MNC">MNC</option>
                    <option value="STARTUP">Startup</option>
                  </select>
                </Field>
              </div>
              <div style={{ marginBottom:10 }}>
                <Field label="Mandatory Skills" error={errors.skills_required}>
                  <SkillsMultiSelect value={form.skills_required} onChange={(v:string)=>F('skills_required',v)} allSkills={skills} onAddSkill={addSkill} />
                </Field>
              </div>
              <div style={{ marginBottom:10 }}>
                <Field label="Good-to-have Skills">
                  <SkillsMultiSelect value={form.good_to_have_skills} onChange={(v:string)=>F('good_to_have_skills',v)} allSkills={skills} onAddSkill={addSkill} />
                </Field>
              </div>
              <div style={{ marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <label className="rx-label" style={{ marginBottom:0 }}>Job Description</label>
                  <button onClick={generateJD} disabled={aiLoading} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, border: `1px solid ${C.brandEdge}`, fontSize:11 }}>
                    {aiLoading?'Generating...':'Generate JD with AI'}
                  </button>
                </div>
                <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:150 }} value={form.job_description}
                  onChange={e=>F('job_description',e.target.value)}
                  placeholder="Write a job description or generate it with the AI button..." />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Screening (CTQ) Questions</label>
                <CtqEditor items={form.ctq_questions} onChange={(v:any[])=>F('ctq_questions',v)} />
              </div>
            </>
          )}

          {/* ── §8 Approval Workflow — auto-routed, same as ESS Raise MRF ── */}
          <SectionLine title="8 · Approval Workflow" />
          <div style={{ ...T.card, background:C.sunken, marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.inkSoft, lineHeight:1.6 }}>
              On <b>Submit</b>, this requisition is routed for approval automatically — the same flow as ESS “Raise MRF”. Each approver sees it in their <b>ESS → Tasks &amp; Approvals</b>.
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:S.sm, flexWrap:'wrap' as const, marginTop:S.md, fontSize:TYPE.small }}>
              <span style={{ fontWeight:600, padding:'4px 10px', borderRadius:99, background:C.brandTint, color:C.brandDeep }}>
                1 · RM2 — {people.find((p:any)=>p.id===(form.rm2_id||form.reporting_manager_id))?.full_name || <span style={{ color:C.critical }}>pick RM2 / Reporting Manager in §2</span>}
              </span>
              <span style={{ color:C.faint }}>→</span>
              <span style={{ fontWeight:600, padding:'4px 10px', borderRadius:99, background:C.positiveTint, color:C.positive }}>2 · HR Head (auto)</span>
            </div>
          </div>

          {/* ── §9 Sourcing ── */}
          {!isQuick && (
            <>
              <SectionLine title="9 · Sourcing" />
              <div style={{ ...T.g2, marginBottom:10 }}>
                <Field label="Internal vs External">
                  <select className="rx-input" value={form.sourcing_mode} onChange={e=>F('sourcing_mode',e.target.value)}>
                    {SOURCING_MODES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Assigned Recruiter" hint="Set on approval, or enter here">
                  <input className="rx-input" style={{ background:C.sunken, color:C.muted }}
                    value={(editMRF as any)?.assigned_recruiter||'Assigned at approval'} readOnly />
                </Field>
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Preferred Sourcing Channels</label>
                <ChannelPicker options={masters.candidate_source} value={form.sourcing_channels}
                  onChange={(v:string[])=>F('sourcing_channels',v)} />
              </div>
            </>
          )}

          {/* ── §10 Attachments ── */}
          <SectionLine title="10 · Attachments" />
          <div style={{ marginBottom:14 }}>
            {editMRF ? (
              <AttachmentsPanel mrfId={editMRF.id} attachments={asArray((editMRF as any).attachments)}
                onChanged={onRefresh} showNotify={showNotify} supabase={supabase} />
            ) : (
              <div style={{ fontSize:12, color:C.faint }}>
                Save the requisition first — files attach to a saved MRF.
              </div>
            )}
          </div>

          {Object.values(errors).filter(Boolean).length>0 && (
            <div style={{ background:C.criticalTint, border: `1px solid ${C.criticalTint}`, borderRadius:7, padding:'9px 12px', marginBottom:12, fontSize:12, color:C.critical }}>
              {Object.values(errors).filter(Boolean).length} field(s) need attention before this can be saved.
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>saveMRF('DRAFT')} disabled={saving} style={T.btnOutline}>Save Draft</button>
            <button onClick={()=>saveMRF('SUBMITTED')} disabled={saving} style={T.btnPrimary}>Submit for Approval</button>
          </div>
        </div>
      )}

    </>
  )

  return (
    <>
      {/* MRF sub-tabs — Requisitions (the list/create) and Approvals (chain approvals). */}
      <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' as const }}>
        <button onClick={()=>{ setMrfSub('requisitions'); setReviewMrf(null) }} style={{ ...T.btnOutline, ...(mrfSub==='requisitions'?{ background:C.brand, color:C.onAccent, borderColor:C.brand }:{}) }}>Requisitions</button>
        <button onClick={()=>{ setMrfSub('approvals'); loadApprovals() }} style={{ ...T.btnOutline, ...(mrfSub==='approvals'?{ background:C.brand, color:C.onAccent, borderColor:C.brand }:{}) }}>Approvals{toApprove.length?` (${toApprove.length})`:''}</button>
      </div>

      {mrfSub==='approvals' ? (
        reviewMrf ? (
          <div>
            <button onClick={()=>setReviewMrf(null)} style={{ ...T.btnOutline, marginBottom:12 }}>← Back to approvals</button>
            <div style={{ fontSize:15, fontWeight:600, color:C.ink, marginBottom:10 }}>
              Review requisition — {reviewMrf.designation||reviewMrf.position}{reviewMrf.mrf_number?` · ${reviewMrf.mrf_number}`:''}
            </div>
            <MrfForm readOnly viewRow={reviewMrf} initial={mrfToForm(reviewMrf)} employeeId={employeeId} notify={showNotify}
              onApprove={()=>{ if (pendingRole(reviewMrf)==='HR_HEAD') { setAssignIds([]); setAssignOpen(true) } else apprDecide('approve') }}
              onReject={(note:string)=>apprDecide('reject', note)} onRevise={(note:string)=>apprDecide('revise', note)}
              actionBusy={apprBusy} onDone={()=>setReviewMrf(null)} onCancel={()=>setReviewMrf(null)} />

            {/* HR Head step: approving also assigns the hiring manager(s) who will run the hiring */}
            {assignOpen && (
              <div onMouseDown={e=>{ if(e.target===e.currentTarget && !apprBusy) setAssignOpen(false) }} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:Z.overlay, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                <div style={{ background:C.surface, borderRadius:14, width:'min(520px,100%)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 70px rgba(30,27,75,0.3)', overflow:'hidden' }}>
                  <div style={{ padding:'16px 20px 12px', borderBottom:`1px solid ${C.line}` }}>
                    <div style={{ fontSize:15, fontWeight:700, color:C.ink }}>Assign Hiring Manager(s)</div>
                    <div style={{ fontSize:12.5, color:C.faint, marginTop:3 }}>Search by employee code or name and add one or more people to run the hiring for {reviewMrf.designation||reviewMrf.position}{reviewMrf.mrf_number?` · ${reviewMrf.mrf_number}`:''}. Approval is recorded with the assignment.</div>
                  </div>
                  <div style={{ padding:'14px 20px', overflowY:'auto', flex:1 }}>
                    <RecruiterPicker people={apprPeople} value={assignIds} onChange={setAssignIds} />
                  </div>
                  <div style={{ display:'flex', gap:8, padding:'12px 20px', borderTop:`1px solid ${C.line}` }}>
                    <button onClick={()=>setAssignOpen(false)} disabled={apprBusy} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
                    <button onClick={()=>apprDecide('approve', undefined, assignIds)} disabled={apprBusy||assignIds.length===0} style={{ ...T.btn, background:C.positive, color:C.onAccent, flex:1, opacity:(apprBusy||assignIds.length===0)?.6:1 }}>{apprBusy?'Approving…':`Approve & Assign${assignIds.length?` (${assignIds.length})`:''}`}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:C.ink, marginBottom:4 }}>MRFs awaiting your approval</div>
            <div style={{ fontSize:12, color:C.faint, marginBottom:12 }}>Open a requisition to review it, then Approve, Send back, or Reject.</div>
            {apprErr && <div style={{ fontSize:12.5, color:C.critical, background:C.criticalTint, borderRadius:8, padding:'9px 12px', marginBottom:12 }}>{apprErr}</div>}
            {toApprove.length===0 && !apprErr && <div style={{ ...T.card, color:C.faint, fontSize:13, textAlign:'center' as const, padding:24 }}>Nothing is waiting on your approval right now.</div>}
            {toApprove.map((m:any)=>(
              <div key={m.id} style={{ ...T.card, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' as const }}>
                <div style={{ flex:'1 1 240px', minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:600, color:C.ink }}>{m.designation||m.position} · {m.no_of_openings||m.openings||1} opening{(m.no_of_openings||m.openings||1)>1?'s':''}</div>
                  <div style={{ fontSize:11.5, color:C.faint, marginTop:2 }}>{m.companies?.company_name||'—'} · {m.departments?.dept_name||'—'} · raised by {m.raised_by_name||'—'}{m.raised_by_role?` (${m.raised_by_role})`:''} · {m.urgency||'Normal'}</div>
                </div>
                <button onClick={()=>openReviewMrf(m)} style={{ ...T.btnPrimary, flexShrink:0 }}>Review &amp; Approve</button>
              </div>
            ))}
          </div>
        )
      ) : (
      <MrfListView
        mrfs={mrfVMs}
        filterBar={filterBar}
        banner={bannerNode}
        form={formNode}
        quickHireCap={QUICK_HIRE_CAP}
        status={fStatus || '*'}
        onStatusChange={(v:string)=>setFStatus(v==='*' ? '' : v)}
        onCreate={()=>{ setEditMRF(null); setForm({ ...EMPTY, mrf_number:(()=>{ for(let i=0;i<6;i++){ const n=newMrfNumber(); if(!mrfs.some((m:MRF)=>m.mrf_number===n)) return n } return '' })() }); setErrors({}); setShowForm(!showForm) }}
        onEdit={(id:string)=>{ const m = mrfs.find((x:MRF)=>x.id===id); if (m) openEdit(m) }}
        onView={(id:string)=>{ const m = mrfs.find((x:MRF)=>x.id===id); if (m) setDetailMRF(m) }}
        onReview={(id:string)=>{ const m = mrfs.find((x:MRF)=>x.id===id); if (m) setApprovalModal(m) }}
        onCloseMrf={(id:string)=>{ const m = mrfs.find((x:MRF)=>x.id===id); if (m) setMrfStatus(m,'CLOSED','MRF_CLOSED') }}
        onReopen={(id:string)=>{ const m = mrfs.find((x:MRF)=>x.id===id); if (m) setMrfStatus(m,'APPROVED','MRF_REOPENED') }}
        onDelete={(id:string)=>setDeleteConfirm(id)}
      />
      )}

      {detailMRF && (
        <MrfDetail supabase={supabase} mrf={mrfs.find((x:MRF)=>x.id===detailMRF.id)||detailMRF} org={orgOf(detailMRF)}
          cands={candidates.filter((c:Candidate)=>c.mrf_id===detailMRF.id)} people={people}
          onClose={()=>setDetailMRF(null)} onEdit={openEdit} onReview={setApprovalModal}
          onChanged={onRefresh} showNotify={showNotify} canEdit={canEditMrf(detailMRF)} canSendBack={canSendBackMrf(detailMRF)} onSendBack={setSendBackFor} />
      )}

      {approvalModal&&<ApprovalModal mrf={approvalModal} org={orgOf(approvalModal)}
        onApprove={approveMRF} onReject={rejectMRF} onHold={holdMRF} onClose={()=>setApprovalModal(null)} />}
      {sendBackFor&&(
        <div onMouseDown={e=>{ if(e.target===e.currentTarget && !sbBusy) setSendBackFor(null) }} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:Z.overlay, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:C.surface, borderRadius:14, width:'min(440px,100%)', padding:'18px 20px', boxShadow:'0 24px 70px rgba(30,27,75,0.3)' }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.ink, marginBottom:4 }}>Send back to raiser</div>
            <div style={{ fontSize:12.5, color:C.faint, marginBottom:12 }}>{sendBackFor.designation||sendBackFor.position}{sendBackFor.mrf_number?` · ${sendBackFor.mrf_number}`:''} — the raiser will fix and resubmit; it re-enters approval from the top.</div>
            <label className="rx-label">Remark — what should the raiser fix?</label>
            <textarea autoFocus className="rx-input" style={{ minHeight:80 }} value={sbNote} onChange={e=>setSbNote(e.target.value)} placeholder="e.g. Budget needs revision / openings count is wrong…" />
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={sendBackMrf} disabled={sbBusy||!sbNote.trim()} style={{ ...T.btn, background:C.warning, color:C.onAccent, flex:1, opacity:(sbBusy||!sbNote.trim())?.6:1 }}>{sbBusy?'Sending…':'Send back'}</button>
              <button onClick={()=>{ setSendBackFor(null); setSbNote('') }} disabled={sbBusy} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirm&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:Z.overlay, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:C.surface, borderRadius:14, padding:24, width:340, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:15, fontWeight:600, color:C.ink, marginBottom:8 }}>Delete MRF?</div>
            <div style={{ fontSize:13, color:C.faint, marginBottom:20 }}>This action cannot be undone. Linked candidates are kept but unlinked from this requisition.</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>deleteMRF(deleteConfirm)} style={{ ...T.btn, background:C.critical, color:C.onAccent, flex:1 }}>Delete</button>
              <button onClick={()=>setDeleteConfirm(null)} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ApprovalModal({ mrf, org, onApprove, onReject, onHold, onClose }:any) {
  const [mode, setMode] = useState<'approve'|'reject'|'hold'>('approve')
  const [recruiter, setRecruiter] = useState(mrf.assigned_recruiter||'')
  const [actor, setActor] = useState('')
  const [comments, setComments] = useState('')
  const [busy, setBusy] = useState(false)
  const openings = mrf.no_of_openings||mrf.openings||0
  const emailOk = !recruiter || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recruiter.trim())
  const chain = asArray(mrf.approval_chain)
  const comp = compOf(mrf.employment_type)

  async function go(fn:()=>Promise<void>|void) { setBusy(true); await fn(); setBusy(false) }

  // Neutral scrim — the panel inside this very modal already used a neutral
  // rgba(0,0,0,0.2) shadow, so the frozen navy here was inconsistent with its
  // own child as well as with the sibling modal. Comment above the return, not
  // inside it, for the same reason as MrfDetail.
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:Z.overlay, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:C.surface, borderRadius:14, padding:24, width:'100%', maxWidth:480, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>{mrf.job_title||mrf.designation||mrf.position}</div>
        <div style={{ fontSize:12, color:C.faint, marginTop:3 }}>
          {mrf.mrf_number||'No MRF number'}{org?` · ${org.company} · ${org.dept}`:''}
        </div>

        <div style={{ background:C.sunken, border: `1px solid ${C.brandEdge}`, borderRadius:10, padding:'11px 13px', margin:'14px 0', fontSize:12, color:C.inkSoft, display:'grid', gridTemplateColumns:'1fr 1fr', gap:9 }}>
          <div><b>{openings}</b> opening{openings===1?'':'s'}</div>
          <div>{mrf.employment_type||'—'}{mrf.work_mode?` · ${mrf.work_mode}`:''}</div>
          <div>{comp.label}: {payAmount(mrf.budget_max, mrf.currency, comp.period)}</div>
          <div>Priority: {mrf.urgency||'—'}</div>
          {mrf.duration_months && <div>Duration: {mrf.duration_months} month{mrf.duration_months===1?'':'s'}</div>}
          {mrf.target_joining_date && <div>Join by: {fmtDay(mrf.target_joining_date)}</div>}
          {mrf.cost_center && <div>Cost centre: {mrf.cost_center}</div>}
          {mrf.reason && <div>Reason: {mrf.reason}</div>}
          {mrf.is_budgeted!=null && <div>{mrf.is_budgeted?'Budgeted':'Unbudgeted'}</div>}
        </div>

        {chain.length>0 && (
          <div style={{ background:C.brandTint, borderRadius:10, padding:'10px 12px', marginBottom:14, fontSize:12, color:C.brandDeep }}>
            Approving opens this requisition straight away and records the full chain
            — <b>{chain.map((s:any)=>s.role).join(' → ')}</b> — against your name.
          </div>
        )}

        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button onClick={()=>setMode('approve')} style={{ ...T.btn, flex:1, background:mode==='approve'?C.positiveTint:C.sunken, color:mode==='approve'?C.positive:C.faint, border:mode==='approve'?`1px solid ${C.positiveEdge}`:'1px solid var(--ez-line)' }}>Approve</button>
          <button onClick={()=>setMode('hold')} style={{ ...T.btn, flex:1, background:mode==='hold'?C.warningTint:C.sunken, color:mode==='hold'?C.warning:C.faint, border:mode==='hold'?`1px solid ${C.warningEdge}`:'1px solid var(--ez-line)' }}>Hold</button>
          <button onClick={()=>setMode('reject')} style={{ ...T.btn, flex:1, background:mode==='reject'?C.criticalTint:C.sunken, color:mode==='reject'?C.critical:C.faint, border:mode==='reject'?`1px solid ${C.criticalEdge}`:'1px solid var(--ez-line)' }}>Reject</button>
        </div>

        <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Approver name</label>
        <input className="rx-input" style={{ marginBottom:11 }} value={actor} onChange={e=>setActor(e.target.value)}
          placeholder="Your name" />

        {mode==='approve'?(
          <>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Assign Recruiter Email</label>
            <input className="rx-input" style={{ marginBottom:4, ...(emailOk?{}:{ border: `1px solid ${C.criticalTint}`, background:C.criticalTint }) }}
              value={recruiter} onChange={e=>setRecruiter(e.target.value)} placeholder="recruiter@company.com" />
            <div style={{ fontSize:11, color: emailOk?C.faint:C.critical, marginBottom:11 }}>
              {emailOk ? 'Optional — the MRF can be approved and assigned later.' : 'That does not look like a valid email.'}
            </div>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Approver comments</label>
            <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', marginBottom:16, minHeight:70 }} value={comments}
              onChange={e=>setComments(e.target.value)} placeholder="Optional note for the record" />
            <button onClick={()=>emailOk && go(()=>onApprove(mrf.id, recruiter.trim(), comments.trim(), actor.trim()))} disabled={busy||!emailOk}
              style={{ ...T.btnPrimary, width:'100%', opacity: busy||!emailOk?.6:1 }}>
              {busy?'Approving…':'Approve & Assign'}
            </button>
          </>
        ):mode==='hold'?(
          <>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Reason for hold *</label>
            <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', marginBottom:16 }} value={comments} onChange={e=>setComments(e.target.value)}
              placeholder="Why is this requisition being paused?" rows={3} />
            <button onClick={()=>comments.trim() && go(()=>onHold(mrf.id, comments.trim()))} disabled={busy||!comments.trim()}
              style={{ ...T.btn, background:C.warning, color:C.onAccent, width:'100%', opacity: busy||!comments.trim()?.6:1 }}>
              {busy?'Saving…':'Put on hold'}
            </button>
          </>
        ):(
          <>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Rejection Reason *</label>
            <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', marginBottom:16 }} value={comments} onChange={e=>setComments(e.target.value)}
              placeholder="Why is this requisition being rejected?" rows={3} />
            <button onClick={()=>comments.trim() && go(()=>onReject(mrf.id, comments.trim(), actor.trim()))} disabled={busy||!comments.trim()}
              style={{ ...T.btn, background:C.critical, color:C.onAccent, width:'100%', opacity: busy||!comments.trim()?.6:1 }}>
              {busy?'Rejecting…':'Reject MRF'}
            </button>
          </>
        )}
        <button onClick={onClose} style={{ ...T.btn, background:'transparent', color:C.faint, width:'100%', marginTop:8 }}>Cancel</button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// JOB STATUS — MRF deadlines, expiries and recruiter accountability
//
// Built from the Recruiter Performance handoff (094/095 + the filterable
// HTML reference). Those migrations were written against an ASSUMED `mrf`
// table and the guide flags it: "reconcile the column names against your
// actual mrf table before deploying". They do not match this codebase, so
// none of that SQL is used. The mapping applied here:
//
//   handoff              →  actual
//   mrf                  →  manpower_requisitions
//   mrf_code             →  mrf_number
//   recruiter_id (UUID)  →  assigned_recruiter (email text) — there is no
//                           recruiters master, so rollups group by email
//   positions_count      →  no_of_openings / openings
//   expiry_date          →  validity_date        (migration 032a)
//   status OPEN/FILLED/  →  DRAFT/SUBMITTED/ON_HOLD/APPROVED/REJECTED/
//     EXPIRED/CANCELLED     CLOSED — the lifecycle outcome is DERIVED below
//                           rather than overwriting the workflow status
//   filled_at            →  earliest candidate offer_sent_at / doj
//   first_shortlist_at   →  earliest linked candidate created_at
//
// Outcome is derived on read rather than written by a nightly
// expire_overdue_mrfs() job: the workflow status column drives approvals and
// must not be clobbered, and a derived flag can never drift out of date the
// way a cron-written one does if the job stops running.
// ══════════════════════════════════════════════════════════════════

// Fill-rate bands. The handoff calls 60/35 arbitrary and asks HR to confirm —
// kept here as named constants so they are a one-line change.
const FILL_STRONG = 60
const FILL_MID    = 35

// Days-to-deadline bands for the live-requisition flags.
const DUE_CRITICAL = 7
const DUE_WATCH    = 21

const JOB_FLAGS:Record<string,{ label:string; bg:string; fg:string; icon:string; help:string }> = {
  FILLED:      { label:'Filled',      bg:C.positiveTint, fg:C.positive, icon:'', help:'All openings have an offer out or a joiner' },
  ON_TRACK:    { label:'On Track',    bg:C.positiveTint, fg:C.positive, icon:'', help:'Live, comfortably inside its deadline' },
  WATCH:       { label:'Watch',       bg:C.warningTint, fg:C.warning, icon:'', help:'Deadline within three weeks' },
  CRITICAL:    { label:'Critical',    bg: C.warningTint, fg: C.critical, icon:'', help:'Deadline within a week' },
  BREACHED:    { label:'Breached',    bg:C.criticalTint, fg:C.critical, icon:'', help:'Past its validity date and still unfilled' },
  NO_DEADLINE: { label:'No Deadline', bg:C.sunken, fg:C.muted, icon:'', help:'Live but no validity date was set' },
  AWAITING:    { label:'Awaiting Approval', bg:C.infoTint, fg:C.info, icon:'', help:'Not yet released to a recruiter' },
  CANCELLED:   { label:'Cancelled',   bg:C.sunken, fg:C.muted, icon:'', help:'Rejected — excluded from performance' },
}

const dayDiff = (a:any, b:any) => Math.round((+new Date(a) - +new Date(b)) / 86400000)
const daysTo  = (d?:string|null) => d ? dayDiff(d, new Date(new Date().toDateString())) : null

/**
 * One MRF's lifecycle outcome and deadline standing.
 * `concluded` marks the MRFs that count toward fill rate — a live requisition
 * is neither a success nor a failure yet, so including it would drag the rate
 * in whichever direction happens to have more volume.
 */
function jobStatusOf(m:any, cands:Candidate[]) {
  const openings = m.no_of_openings || m.openings || 0
  const won = cands.filter(c=>c.stage==='Offer Sent'||c.stage==='Joined')
  const filledCount = won.length
  const isFilled = openings>0 && filledCount >= openings

  // Earliest point the requisition was satisfied — offer out, or a joiner.
  const fillDates = won.map(c=>c.offer_sent_at||c.doj).filter(Boolean).map(d=>+new Date(d as string))
  const filledAt = fillDates.length ? new Date(Math.min(...fillDates)).toISOString() : null
  const firstCand = cands.length
    ? new Date(Math.min(...cands.map(c=>+new Date(c.created_at)))).toISOString() : null

  const deadline = m.validity_date || m.target_joining_date || null
  const left = daysTo(deadline)

  let flag = 'NO_DEADLINE'
  if (m.status==='REJECTED') flag = 'CANCELLED'
  else if (m.status==='CLOSED' || isFilled) flag = 'FILLED'
  else if (m.status!=='APPROVED') flag = 'AWAITING'
  else if (left==null) flag = 'NO_DEADLINE'
  else if (left < 0) flag = 'BREACHED'
  else if (left <= DUE_CRITICAL) flag = 'CRITICAL'
  else if (left <= DUE_WATCH) flag = 'WATCH'
  else flag = 'ON_TRACK'

  const concluded = flag==='FILLED' || flag==='BREACHED'
  return {
    flag, openings, filledCount, isFilled, filledAt, firstCand, deadline, daysLeft:left, concluded,
    daysToFill:   filledAt  ? dayDiff(filledAt,  m.created_at) : null,
    daysToFirst:  firstCand ? dayDiff(firstCand, m.created_at) : null,
    ageDays:      dayDiff(new Date(), m.created_at),
  }
}

function fillTone(rate:number|null) {
  if (rate==null) return [C.sunken,C.muted] as [string,string]
  if (rate >= FILL_STRONG) return [C.positiveTint,C.positive] as [string,string]
  if (rate >= FILL_MID)    return [C.warningTint,C.warning] as [string,string]
  return [C.criticalTint,C.critical] as [string,string]
}

function JobFlag({ flag }:{ flag:string }) {
  const f = JOB_FLAGS[flag] || JOB_FLAGS.NO_DEADLINE
  return (
    <span title={f.help} style={{ fontSize:F.micro, padding:'3px 9px', borderRadius:R.pill, background:f.bg, color:f.fg,
      fontWeight:W.semi, lineHeight:1.45, whiteSpace:'nowrap' as const }}>{f.label}</span>
  )
}

// ── Deadline board ────────────────────────────────────────────────
function DeadlineBoard({ rows, orgOf }:any) {
  if (!rows.length) return (
    <div style={{ ...T.card, textAlign:'center' as const, padding:26, color:C.faint, fontSize:13 }}>
      No live requisitions with a deadline.
    </div>
  )
  return (
    // Every one of the eight cells repeated `borderBottom: 1px solid C.line`
    // by hand — that rule is what Td carries for you. The header's per-column
    // textAlign, computed from the index, becomes Th's align prop. No row
    // click here, so Tr takes no handler and stays non-interactive.
    <TableWrap minWidth={820} style={{ marginBottom:S.md }}>
      <thead>
        <tr>
          {['Requisition','Department','Recruiter','Openings','Progress','Deadline','Days Left','Flag'].map((h,i)=>(
            <Th key={h} align={i>=3&&i<=6 ? 'center':'left'}>{h}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ m, js }:any)=>{
          const org = orgOf(m)
          const pct = js.openings ? Math.min(100,(js.filledCount/js.openings)*100) : 0
          const late = js.daysLeft!=null && js.daysLeft < 0
          return (
            <Tr key={m.id}>
              <Td>
                <div style={{ fontWeight:W.semi, color:C.ink }}>{m.job_title||m.designation||m.position}</div>
                <div style={{ fontSize:F.micro, color:C.faint }}>{m.mrf_number||'—'}</div>
              </Td>
              <Td style={{ color:C.muted }}>{org.dept}</Td>
              <Td style={{ color:C.muted }}>{m.assigned_recruiter||'— unassigned'}</Td>
              <Td align="center">{js.openings}</Td>
              <Td style={{ minWidth:110 }}>
                <div style={{ fontSize:F.micro, color:C.faint, textAlign:'center', marginBottom:3, ...numeric }}>{js.filledCount}/{js.openings}</div>
                {/* The ratio above is a sibling div, so the bar itself announced
                    nothing: a screen reader met 23 identical unnamed graphics,
                    one per row. Naming it with the requisition makes each one
                    say which requisition it belongs to. Same defect the kit's QA
                    pass found in its own Track component. */}
                <div role="progressbar"
                     aria-label={`${m.job_title||m.designation||m.position}${m.mrf_number?` ${m.mrf_number}`:''}: ${js.filledCount} of ${js.openings} filled`}
                     aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
                     style={{ background:C.brandTint, borderRadius:R.pill, height:5, overflow:'hidden' }}>
                  <div style={{ width:`${pct}%`, height:'100%', background:pct>=100?C.positive:C.brand,
                                transition:`width ${M.ease}` }} />
                </div>
              </Td>
              <Td align="center" style={{ color:C.muted, whiteSpace:'nowrap' }}>{fmtDay(js.deadline)}</Td>
              <Td align="center" style={{ fontWeight:W.bold,
                color: late?C.critical: js.daysLeft<=DUE_CRITICAL?C.critical:C.positive, whiteSpace:'nowrap' }}>
                {js.daysLeft==null ? '—' : late ? `${Math.abs(js.daysLeft)}d over` : `${js.daysLeft}d`}
              </Td>
              <Td><JobFlag flag={js.flag} /></Td>
            </Tr>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

// ── Recruiter performance table ───────────────────────────────────
function RecruiterTable({ rows, sortKey, sortDir, onSort, selected, onSelect }:any) {
  // th/td/num are gone: Th and Td carry those styles, and Th now takes an
  // onClick so a sortable header stays a <th> rather than becoming a button
  // nested inside one. Td align="right" also brings tabular numerals, which
  // these count columns were not getting before.
  const arrow = (k:string) => sortKey===k ? (sortDir==='asc'?' ▲':' ▼') : ''
  const COLS:[string,string,boolean][] = [
    ['name','Recruiter',false], ['total','MRFs',true], ['filled','Filled',true],
    ['expired','Breached',true], ['open','Live',true], ['rate','Fill Rate',true],
    ['ttf','Avg Days to Fill',true], ['ttc','Avg Days to 1st CV',true],
  ]
  return (
    <TableWrap minWidth={860} style={{ marginBottom:S.md }}>
      <thead>
        <tr>{COLS.map(([k,l,n])=>(
          <Th key={k} align={n?'right':'left'} onClick={()=>onSort(k)}
              title={`Sort by ${l}`}>{l}{arrow(k)}</Th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.length===0 && (
          <tr><td colSpan={COLS.length}>
            <Empty title="No requisitions in this period"
                   hint="Widen the period, or clear the company and department filters." />
          </td></tr>
        )}
        {rows.map((r:any)=>{
          const [bg,fg] = fillTone(r.rate)
          const on = selected===r.key
          return (
            <Tr key={r.key} onClick={()=>onSelect(on?null:r.key)} selected={on}>
              <Td>
                <div style={{ display:'flex', alignItems:'center', gap:S.sm }}>
                  <span style={{ width:26, height:26, borderRadius:'50%', background:C.brandTint, color:C.brandDeep,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:F.micro, fontWeight:W.bold, flexShrink:0 }}>
                    {r.name.slice(0,2).toUpperCase()}
                  </span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:W.semi, color:C.ink }}>{r.name}</div>
                    {r.unassigned && <div style={{ fontSize:F.micro, color:C.warning }}>no recruiter assigned</div>}
                  </div>
                </div>
              </Td>
              <Td align="right">{r.total}</Td>
              <Td align="right" style={{ color:C.positive, fontWeight:W.semi }}>{r.filled}</Td>
              <Td align="right" style={{ color: r.expired?C.critical:C.faint, fontWeight: r.expired?W.semi:W.regular }}>{r.expired}</Td>
              <Td align="right">{r.open}</Td>
              <Td align="right">
                <span style={{ fontWeight:W.bold, padding:'3px 10px', borderRadius:R.pill, fontSize:F.tiny, background:bg, color:fg }}>
                  {r.rate==null ? '—' : r.rate+'%'}
                </span>
              </Td>
              <Td align="right">{r.ttf==null?'—':r.ttf}</Td>
              <Td align="right">{r.ttc==null?'—':r.ttc}</Td>
            </Tr>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

// ── JOB STATUS TAB ────────────────────────────────────────────────
function JobStatusTab({ companies, locations, departments, mrfs, candidates, showNotify, supabase, rail }:any) {
  const [fCompany, setFCompany] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fDept, setFDept] = useState('')
  const [period, setPeriod] = useState('all')
  const [sortKey, setSortKey] = useState('rate')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')
  const [selected, setSelected] = useState<string|null>(null)
  const [exportFmt, setExportFmt] = useState('xlsx')
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState('')

  const orgOf = (m:MRF) => ({
    company: companies.find((c:Company)=>c.id===m.company_id)?.company_name
      || companies.find((c:Company)=>c.id===m.company_id)?.company_code || '—',
    dept: departments.find((d:Department)=>d.id===m.department_id)?.dept_name || '—',
    loc: locations.find((l:Location)=>l.id===m.location_id)?.location_name || '—',
  })

  const cutoff = period==='all' ? null
    : new Date(Date.now() - Number(period)*86400000).toISOString()

  // Every MRF in scope, paired with its derived lifecycle standing.
  const scoped = mrfs
    .filter((m:MRF)=>
      (!fCompany || m.company_id===fCompany) &&
      (!fLoc || m.location_id===fLoc) &&
      (!fDept || m.department_id===fDept) &&
      (!cutoff || m.created_at >= cutoff))
    .map((m:MRF)=>({ m, js: jobStatusOf(m, candidates.filter((c:Candidate)=>c.mrf_id===m.id)) }))

  const counts = scoped.reduce((a:any,{js}:any)=>{ a[js.flag]=(a[js.flag]||0)+1; return a }, {})
  const concluded = scoped.filter(({js}:any)=>js.concluded)
  const filledN = concluded.filter(({js}:any)=>js.flag==='FILLED').length
  const breachedN = concluded.filter(({js}:any)=>js.flag==='BREACHED').length
  const overallRate = concluded.length ? Math.round(1000*filledN/concluded.length)/10 : null
  const ttfAll = scoped.filter(({js}:any)=>js.daysToFill!=null).map(({js}:any)=>js.daysToFill)
  const avgTtf = ttfAll.length ? Math.round(10*ttfAll.reduce((a:number,b:number)=>a+b,0)/ttfAll.length)/10 : null
  const atRisk = scoped.filter(({js}:any)=>js.flag==='CRITICAL'||js.flag==='BREACHED').length
  const noDeadline = scoped.filter(({js}:any)=>js.flag==='NO_DEADLINE').length

  // Deadline board — live requisitions only, most urgent first.
  const board = scoped
    .filter(({js}:any)=>['BREACHED','CRITICAL','WATCH','ON_TRACK','NO_DEADLINE'].includes(js.flag))
    .sort((a:any,b:any)=>{
      const av = a.js.daysLeft==null ? 99999 : a.js.daysLeft
      const bv = b.js.daysLeft==null ? 99999 : b.js.daysLeft
      return av-bv
    })

  // Rollup per recruiter. No recruiters master exists, so the owner is the
  // assigned_recruiter email; MRFs with none are grouped as Unassigned so the
  // gap is visible rather than silently dropped.
  const byRecruiter = new Map<string, any>()
  for (const { m, js } of scoped) {
    if (js.flag==='CANCELLED') continue           // rejected MRFs are nobody's failure
    const key = (m.assigned_recruiter||'').trim().toLowerCase() || '__unassigned'
    const cur = byRecruiter.get(key) || {
      key, name: m.assigned_recruiter || 'Unassigned', unassigned: !m.assigned_recruiter,
      total:0, filled:0, expired:0, open:0, ttfList:[] as number[], ttcList:[] as number[], items:[] as any[],
    }
    cur.total++
    if (js.flag==='FILLED') cur.filled++
    else if (js.flag==='BREACHED') cur.expired++
    else if (js.flag!=='AWAITING') cur.open++
    if (js.daysToFill!=null)  cur.ttfList.push(js.daysToFill)
    if (js.daysToFirst!=null) cur.ttcList.push(js.daysToFirst)
    cur.items.push({ m, js })
    byRecruiter.set(key, cur)
  }
  const avg = (xs:number[]) => xs.length ? Math.round(10*xs.reduce((a,b)=>a+b,0)/xs.length)/10 : null
  const recruiterRows = [...byRecruiter.values()].map(r=>({
    ...r,
    // Fill rate excludes live MRFs from the denominator — the handoff's
    // deliberate design decision, kept.
    rate: (r.filled+r.expired) ? Math.round(1000*r.filled/(r.filled+r.expired))/10 : null,
    ttf: avg(r.ttfList), ttc: avg(r.ttcList),
  })).sort((a,b)=>{
    const dir = sortDir==='asc' ? 1 : -1
    if (sortKey==='name') return dir * String(a.name).localeCompare(String(b.name))
    const av = (a as any)[sortKey], bv = (b as any)[sortKey]
    if (av==null && bv==null) return 0
    if (av==null) return 1
    if (bv==null) return -1
    return dir * (av - bv)
  })

  function sort(k:string) {
    if (sortKey===k) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortKey(k); setSortDir(k==='name'?'asc':'desc') }
  }

  const sel = recruiterRows.find(r=>r.key===selected)
  const hasDeadlines = scoped.some(({m}:any)=>m.validity_date || m.target_joining_date)

  const Tile = ({ label, value, sub, color }:any) => (
    <div style={{ background:C.surface, border:'1px solid var(--ez-line)', borderRadius:10, padding:'11px 13px' }}>
      <div style={{ ...eyebrow }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, marginTop:2, color:color||C.ink }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.faint, marginTop:1 }}>{sub}</div>}
    </div>
  )

  // ── Export ────────────────────────────────────────────────────
  // The report is built from `scoped`, so whatever filters are on screen are
  // exactly what leaves the building — a report that quietly covered a
  // different set than the dashboard would be worse than no report.
  const stamp = new Date().toISOString().slice(0,10)
  const filterLine = [
    fCompany ? companies.find((c:Company)=>c.id===fCompany)?.company_name : null,
    fLoc ? locations.find((l:Location)=>l.id===fLoc)?.location_name : null,
    fDept ? departments.find((d:Department)=>d.id===fDept)?.dept_name : null,
    period==='all' ? 'All time' : `Raised in last ${period} days`,
  ].filter(Boolean).join(' · ')

  function reportSheets() {
    const summary = [
      ['EZER HRMS — Job Status Report'], [],
      ['Generated', new Date().toLocaleString('en-IN')],
      ['Scope', filterLine || 'All companies · all time'],
      ['Requisitions in scope', scoped.length],
      ['Recruiters', recruiterRows.length], [],
      ['HEADLINE'],
      ['Fill rate %', overallRate==null?'—':overallRate],
      ['Filled', filledN], ['Breached', breachedN],
      ['Concluded (filled + breached)', concluded.length],
      ['At risk (due <=7d or overdue)', atRisk],
      ['Avg days to fill', avgTtf==null?'—':avgTtf],
      ['No deadline set', noDeadline], [],
      ['STATUS FLAGS'],
      ...Object.keys(JOB_FLAGS).map(k=>[JOB_FLAGS[k].label, counts[k]||0]),
    ]
    const requisitions = scoped.map(({m,js}:any)=>{
      const org = orgOf(m), c = compOf(m.employment_type)
      return {
        'MRF No': m.mrf_number||'', 'Job Title': m.job_title||m.designation||m.position||'',
        'Designation': m.designation||m.position||'', 'Company': org.company,
        'Department': org.dept, 'Location': org.loc, 'Business Unit': m.business_unit||'',
        'Grade': m.grade||'', 'Employment Type': m.employment_type||'', 'Work Mode': m.work_mode||'',
        'Form Type': m.mrf_type||'', 'Priority': m.urgency||'', 'Workflow Status': m.status,
        'Job Status Flag': JOB_FLAGS[js.flag].label,
        'Openings': js.openings, 'Filled': js.filledCount,
        'Remaining': Math.max(0, js.openings - js.filledCount),
        'Recruiter': m.assigned_recruiter||'Unassigned',
        'Raised On': m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN') : '',
        'Target Joining': m.target_joining_date||'', 'Validity / Expiry': m.validity_date||'',
        'Days Left': js.daysLeft==null?'':js.daysLeft,
        'Days Open': js.ageDays==null?'':js.ageDays,
        'Days To Fill': js.daysToFill==null?'':js.daysToFill,
        'Days To First CV': js.daysToFirst==null?'':js.daysToFirst,
        'Pay Basis': `${c.label} (${c.period==='ANNUAL'?'per annum':'per month'})`,
        'Budget Min': m.budget_min??'', 'Budget Max': m.budget_max??'', 'Currency': m.currency||'',
        'Cost Center': m.cost_center||'', 'Budgeted': m.is_budgeted==null?'':(m.is_budgeted?'Yes':'No'),
        'Reason': m.reason||m.reason_for_hire||'',
        'Approval Progress': (()=>{ const ch = asArray(m.approval_chain)
          return ch.length ? `${ch.filter((s:any)=>s.status==='APPROVED').length}/${ch.length}` : '—' })(),
      }
    })
    const performance = recruiterRows.map((r:any)=>({
      'Recruiter': r.name, 'Total MRFs': r.total, 'Filled': r.filled, 'Breached': r.expired,
      'Live': r.open, 'Fill Rate %': r.rate==null?'':r.rate,
      'Avg Days To Fill': r.ttf==null?'':r.ttf, 'Avg Days To First CV': r.ttc==null?'':r.ttc,
    }))
    const deadlines = board.map(({m,js}:any)=>({
      'MRF No': m.mrf_number||'', 'Requisition': m.job_title||m.designation||m.position||'',
      'Department': orgOf(m).dept, 'Recruiter': m.assigned_recruiter||'Unassigned',
      'Openings': js.openings, 'Filled': js.filledCount,
      'Deadline': m.validity_date||m.target_joining_date||'',
      'Days Left': js.daysLeft==null?'':js.daysLeft,
      'Status': JOB_FLAGS[js.flag].label,
    }))
    return { summary, requisitions, performance, deadlines }
  }

  /** Build the report as a Blob in the chosen format. */
  function buildReport(fmt:string): { blob:Blob; name:string } {
    const { summary, requisitions, performance, deadlines } = reportSheets()
    const base = `EZER_Job_Status_${stamp}`
    if (fmt === 'csv') {
      const ws = XLSX.utils.json_to_sheet(requisitions)
      const csv = XLSX.utils.sheet_to_csv(ws)
      return { blob:new Blob([csv], { type:'text/csv;charset=utf-8' }), name:`${base}.csv` }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(requisitions), 'Requisitions')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(performance), 'Recruiter Performance')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deadlines), 'Deadline Board')
    const legacy = fmt === 'xls'
    const out = XLSX.write(wb, { bookType: legacy ? 'xls' : 'xlsx', type:'array' })
    // Legacy .xls is an OLE2 container, not OOXML — mislabelling it makes strict
    // consumers (mail gateways, some viewers) reject an otherwise valid file.
    return {
      blob: new Blob([out], { type: legacy
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      name: `${base}.${legacy ? 'xls' : 'xlsx'}`,
    }
  }

  function downloadReport() {
    if (!scoped.length) { showNotify('Nothing to export for the current filters','error'); return }
    const { blob, name } = buildReport(exportFmt)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    setTimeout(()=>URL.revokeObjectURL(url), 2000)
    showNotify(`Report downloaded — ${name}`)
  }

  async function shareReport() {
    if (!scoped.length) { showNotify('Nothing to export for the current filters','error'); return }
    setSharing(true); setShareUrl('')
    try {
      const { blob, name } = buildReport(exportFmt)
      const fd = new FormData(); fd.append('file', new File([blob], name, { type:blob.type }))
      const r = await fetch('/api/recruitment/share-report', { method:'POST', body:fd, headers: await uploadAuthHeaders() })
      const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not create a share link')
      setShareUrl(j.url)
      try { await navigator.clipboard.writeText(j.url); showNotify(`Link copied — valid ${j.expiresInDays} days`) }
      catch { showNotify(`Share link ready — valid ${j.expiresInDays} days`) }
    } catch (e:any) { showNotify(e.message||'Could not share the report','error') }
    setSharing(false)
  }

  return (
    <RxPage header={
      <RecruitmentHeader
        title="Job status"
        subtitle="MRF deadlines, expiries and whether hiring is closing before requisitions lapse."
        actions={<>
          {/* The same three controls, the same state, the same handlers.
              downloadReport still builds the workbook through XLSX and
              shareReport still POSTs to share-report — only the frame changed. */}
          <select value={exportFmt} onChange={e=>{ setExportFmt(e.target.value); setShareUrl('') }}
            className="rx-input" style={{ width:'auto', padding:'7px 10px', fontSize:12 }}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="xls">Excel 97–2003 (.xls)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
          <button type="button" className="rx-btn" onClick={shareReport} disabled={sharing}>
            {sharing ? 'Preparing…' : 'Share link'}
          </button>
          <button type="button" className="rx-btn p" onClick={downloadReport}>Export report</button>
        </>}
      />}>

      {shareUrl && (
        <div style={{ ...T.card, background:C.positiveTint, border: `1px solid ${C.positiveTint}` }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.positive, marginBottom:6 }}>
            Shareable link ready — anyone with it can download the report for 7 days
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' as const }}>
            <input readOnly value={shareUrl} onFocus={e=>e.currentTarget.select()}
              className="rx-input" style={{ flex:'1 1 340px', fontSize:12, background:C.surface }} />
            <button onClick={()=>{ navigator.clipboard?.writeText(shareUrl); showNotify('Link copied') }} style={T.btnOutline}>Copy</button>
            <a href={shareUrl} target="_blank" rel="noreferrer" style={{ ...T.btnOutline, textDecoration:'none' }}>Open</a>
            <button onClick={()=>setShareUrl('')} style={{ ...T.btnOutline, color:C.muted }}>Dismiss</button>
          </div>
        </div>
      )}

      {!hasDeadlines && (
        <div style={{ background:C.warningTint, border: `1px solid ${C.warningTint}`, borderRadius:7, padding:'9px 12px',
          marginBottom:12, fontSize:12, color:C.warning }}>
          No requisition has a validity or target joining date yet, so deadline flags cannot be calculated.
          Those fields arrive with migration <b>032a</b>; set them on an MRF and this board fills in.
        </div>
      )}

      {/* Filters */}
      <div style={T.card}>
        <div style={T.section}>Filters</div>
        <div style={{ ...T.g4 }}>
          <div>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Company</label>
            <select className="rx-input" value={fCompany} onChange={e=>{ setFCompany(e.target.value); setFLoc(''); setFDept('') }}>
              <option value="">All companies</option>
              {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
            </select>
          </div>
          <div>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Branch / Location</label>
            <select className="rx-input" value={fLoc} onChange={e=>setFLoc(e.target.value)}>
              <option value="">All branches</option>
              {locations.filter((l:Location)=>!fCompany||l.company_id===fCompany).map((l:Location)=>(
                <option key={l.id} value={l.id}>{l.location_name}</option>))}
            </select>
          </div>
          <div>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Department</label>
            <select className="rx-input" value={fDept} onChange={e=>setFDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.filter((d:Department)=>!fCompany||d.company_id===fCompany).map((d:Department)=>(
                <option key={d.id} value={d.id}>{d.dept_name}</option>))}
            </select>
          </div>
          <div>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Raised Within</label>
            <select className="rx-input" value={period} onChange={e=>setPeriod(e.target.value)}>
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last 12 months</option>
            </select>
          </div>
        </div>
        <div style={{ fontSize:12, color:C.faint, marginTop:9 }}>
          {scoped.length} requisition{scoped.length===1?'':'s'} in scope · {recruiterRows.length} recruiter{recruiterRows.length===1?'':'s'}
          {(fCompany||fLoc||fDept||period!=='all') && (
            <button onClick={()=>{ setFCompany(''); setFLoc(''); setFDept(''); setPeriod('all') }}
              style={{ ...T.btnOutline, marginLeft:10, padding:'3px 10px' }}>Clear</button>
          )}
        </div>
      </div>

      {/* Headline numbers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:9, marginBottom:10 }}>
        <Tile label="Fill Rate" value={overallRate==null?'—':overallRate+'%'}
          sub={`${filledN} filled of ${concluded.length} concluded`} color={fillTone(overallRate)[1]} />
        <Tile label="Filled" value={filledN} sub="all openings covered" color={C.positive} />
        <Tile label="Breached" value={breachedN} sub="lapsed unfilled" color={breachedN?C.critical:C.faint} />
        <Tile label="At Risk" value={atRisk} sub="due ≤7d or overdue" color={atRisk?C.critical:C.faint} />
        <Tile label="Avg Days to Fill" value={avgTtf==null?'—':avgTtf} sub="raise → first offer" color={C.brand} />
        {noDeadline>0 && <Tile label="No Deadline Set" value={noDeadline} sub="cannot be tracked" color={C.warning} />}
      </div>

      {/* Flag spread */}
      <div style={{ ...T.card }}>
        <div style={T.section}>Status Flags</div>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' as const }}>
          {Object.keys(JOB_FLAGS).map(k=>(
            <span key={k} title={JOB_FLAGS[k].help} style={{ fontSize:11, padding:'4px 11px', borderRadius:99,
              background:JOB_FLAGS[k].bg, color:JOB_FLAGS[k].fg, fontWeight:600,
              opacity:(counts[k]||0)===0?.45:1 }}>
              {JOB_FLAGS[k].icon} {JOB_FLAGS[k].label} <b>{counts[k]||0}</b>
            </span>
          ))}
        </div>
      </div>

      {/* Deadline board */}
      <div style={{ ...T.section, marginTop:14 }}>Deadline Board — live requisitions, most urgent first</div>
      <DeadlineBoard rows={board} orgOf={orgOf} />

      {/* Recruiter performance */}
      <div style={{ ...T.section, marginTop:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
        <span>Recruiter Performance</span>
        <span style={{ fontSize:F.micro, color:C.muted, textTransform:'none' as const, letterSpacing:0, fontWeight:W.regular }}>
          Fill rate = filled ÷ (filled + breached). Live requisitions are excluded — they are neither yet.
        </span>
      </div>
      <RecruiterTable rows={recruiterRows} sortKey={sortKey} sortDir={sortDir} onSort={sort}
        selected={selected} onSelect={setSelected} />

      {/* Drill-down */}
      {sel && (
        <div style={T.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4, gap:10, flexWrap:'wrap' as const }}>
            <div style={T.section}>{sel.name} — every requisition behind these numbers</div>
            <button onClick={()=>setSelected(null)} style={T.btnOutline}>Close</button>
          </div>
          {sel.items.length===0 && <div style={{ fontSize:12, color:C.faint }}>No requisitions.</div>}
          {sel.items
            .slice()
            .sort((a:any,b:any)=>+new Date(b.m.created_at) - +new Date(a.m.created_at))
            .map(({ m, js }:any)=>(
            <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'9px 0', borderBottom: `1px solid ${C.line}`, gap:10, flexWrap:'wrap' as const }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>
                  {m.job_title||m.designation||m.position} <span style={{ fontSize:11, color:C.faint }}>{m.mrf_number||''}</span>
                </div>
                <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>
                  {orgOf(m).dept} · raised {fmtDay(m.created_at)}
                  {js.deadline?` · due ${fmtDay(js.deadline)}`:''} · {js.filledCount}/{js.openings} filled
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                <span style={{ fontSize:12, color:C.muted }}>
                  {js.flag==='FILLED' && js.daysToFill!=null ? `${js.daysToFill}d to fill`
                    : js.flag==='BREACHED' ? `${Math.abs(js.daysLeft??0)}d over`
                    : js.daysLeft!=null ? `${js.daysLeft}d left` : `${js.ageDays}d open`}
                </span>
                <JobFlag flag={js.flag} />
              </div>
            </div>
          ))}
        </div>
      )}
    </RxPage>
  )
}

// ── AI SCREENING ──────────────────────────────────────────────────
function ScreeningTab({ supabase, mrfs, candidates, onRefresh, showNotify, rail }:any) {
  const [selMRF, setSelMRF] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [screening, setScreening] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [progress, setProgress] = useState(0)
  // The file currently in front of the model, for the .rx-scan row. Presentation
  // only — it is set from the existing upload loop and changes no request.
  const [scanning, setScanning] = useState<string|null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mrf = mrfs.find((m:MRF)=>m.id===selMRF)

  async function runScreening() {
    if (!selMRF) { showNotify('Please select an MRF','error'); return }
    if (!files.length) { showNotify('Please upload resumes','error'); return }
    // No JD? Synthesise one from the MRF's role + skills so screening still works.
    const jdText = mrf?.job_description ||
      `Role: ${mrf?.designation||mrf?.position||'—'}. Required skills: ${mrf?.skills_required||'—'}. Experience: ${mrf?.experience_required||'—'}. Education: ${mrf?.education_required||'Any'}.`
    if (!mrf?.skills_required && !mrf?.job_description) { showNotify('This MRF has no JD or skills — add skills to screen','error'); return }
    setScreening(true); setResults([]); setProgress(0)
    const res:any[] = []
    for (let i=0; i<files.length; i++) {
      const file = files[i]
      setScanning(file.name)
      const fd = new FormData()
      fd.append('file', file)                               // send the real file — API extracts PDF/DOCX/TXT
      fd.append('jd_text', jdText)
      fd.append('skills_required', mrf.skills_required || '')
      fd.append('experience_required', mrf.experience_required || '')
      fd.append('education_required', mrf.education_required || '')
      fd.append('designation', mrf.designation || mrf.position || '')
      fd.append('previous_company_preference', mrf.previous_company_preference || '')
      fd.append('candidate_name', file.name.replace(/\.[^.]+$/,''))
      try {
        const r = await fetch('/api/recruitment/screen-resumes', { method:'POST', body:fd, headers: await uploadAuthHeaders() }) // uploadAuthHeaders omits Content-Type → browser sets the multipart boundary
        const d = await r.json()
        res.push({ ...d, file_name:file.name, added:false })
      } catch {
        res.push({ candidate_name:file.name.replace(/\.[^.]+$/,''), score:0, match_tag:'NOT_SUITABLE', reasoning:'Network/parse error', matched_skills:[], missing_skills:[], file_name:file.name, added:false })
      }
      setProgress(Math.round(((i+1)/files.length)*100))
      setResults([...res])
    }
    setScanning(null)
    setScreening(false)
  }

  async function addToBank(idx:number, quiet=false) {
    const r = results[idx]
    const summary = [
      r.matched_skills?.length ? `Matched: ${r.matched_skills.join(', ')}` : '',
      r.missing_skills?.length ? `Missing: ${r.missing_skills.join(', ')}` : '',
      r.experience_match ? `Exp: ${r.experience_match}` : '',
      r.education_match ? `Edu: ${r.education_match}` : '',
    ].filter(Boolean).join(' · ')
    const reasoning = summary ? `${r.reasoning||''}\n\n[ATS] ${summary}`.trim() : (r.reasoning||'')
    const { error } = await supabase.from('candidates').insert({
      mrf_id:selMRF, company_id:mrf?.company_id||null,
      full_name:r.candidate_name, phone:'TBD',
      source:'AI Screening', stage:'AI Screened',
      ai_score:r.score, ai_tag:r.match_tag, ai_match_tag:r.match_tag,
      ai_reasoning:reasoning, ai_questions:r.interview_questions||[],
      status:'active', applied_date:new Date().toISOString().split('T')[0],
    })
    if (error) { showNotify('Add failed: '+error.message,'error'); return }
    const updated = [...results]; updated[idx] = { ...updated[idx], added:true }
    setResults(updated); showNotify(`${r.candidate_name} added to pipeline!`); onRefresh()
    if (!quiet) await notifyRaiser([r.candidate_name])
  }

  // Selected resumes go straight to the hiring manager — the MRF raiser gets an ESS
  // notification (Tasks & bell) naming the candidates, with a link to the pipeline.
  async function notifyRaiser(names:string[]) {
    const to = mrf?.requested_by
    if (!to || !names.length) return
    const who = names.length===1 ? names[0] : `${names.length} candidates (${names.slice(0,3).join(', ')}${names.length>3?'…':''})`
    await supabase.from('ess_notifications').insert({
      employee_id: to, category:'RECRUITMENT', is_read:false, link:'/dashboard/recruitment',
      title:`Resume${names.length>1?'s':''} shortlisted — ${who}`,
      body:`AI screening selected ${who} for ${mrf?.designation||mrf?.position||'your requisition'}${mrf?.mrf_number?` (${mrf.mrf_number})`:''}. Review the profile${names.length>1?'s':''} in Recruitment → Pipeline and schedule the interview rounds.`,
    })
  }

  async function addAllStrong() {
    const strong = results.map((r,i)=>({ r, i })).filter(({r})=>r.match_tag==='STRONG'&&!r.added)
    for (const { i } of strong) await addToBank(i, true)
    await notifyRaiser(strong.map(({r})=>r.candidate_name))
    showNotify('All STRONG candidates added!')
  }

  function downloadExcel() {
    const data = results.map(r=>({ 'Name':r.candidate_name,'File':r.file_name,'Score':r.score,'Match':r.match_tag,'Reasoning':r.reasoning,'Q1':r.interview_questions?.[0]||'','Q2':r.interview_questions?.[1]||'','Q3':r.interview_questions?.[2]||'','Q4':r.interview_questions?.[3]||'','Q5':r.interview_questions?.[4]||'','Added':r.added?'Yes':'No' }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'AI Screening')
    XLSX.writeFile(wb,`Screening_${mrf?.designation||'Results'}.xlsx`)
  }

  const strong = results.filter(r=>r.match_tag==='STRONG')
  const partial = results.filter(r=>r.match_tag==='PARTIAL')
  const notSuitable = results.filter(r=>r.match_tag==='NOT_SUITABLE')

  // screen-resumes returns snake_case under DIFFERENT names than the kit card
  // expects, so map explicitly. The kit's own comment claimed the shapes already
  // matched; they do not (candidate_name/file_name/match_tag/matched_skills/
  // missing_skills/interview_questions), and trusting it would have blanked
  // every chip and question on every result.
  //
  // `error` is deliberately NOT set. The card's error branch collapses the row
  // to one line, but this tab has always shown a failed screen as a full row
  // whose reasoning carries the explanation ("Network/parse error",
  // "GEMINI_API_KEY is not configured on the server"). Leaving error undefined
  // keeps that behaviour.
  const toScreenResult = (r:any):ScreenResult => ({
    fileName:        r.file_name || '',
    name:            r.candidate_name || null,
    score:           Number(r.score) || 0,
    tag:             r.match_tag==='STRONG' ? 'STRONG' : r.match_tag==='PARTIAL' ? 'PARTIAL' : 'NOT_SUITABLE',
    matched:         Array.isArray(r.matched_skills) ? r.matched_skills : [],
    missing:         Array.isArray(r.missing_skills) ? r.missing_skills : [],
    questions:       Array.isArray(r.interview_questions) ? r.interview_questions : [],
    reasoning:       r.reasoning ?? null,
    atsScore:        typeof r.ats_score==='number' ? r.ats_score : null,
    experienceMatch: r.experience_match ?? null,
    educationMatch:  r.education_match ?? null,
    added:           !!r.added,
  })

  const ordered = [...strong, ...partial, ...notSuitable]

  return (
    <RxPage header={
      <RecruitmentHeader
        title="AI resume screening"
        subtitle="Score a batch of resumes against one approved opening, then send the strong ones straight into the pipeline."
        actions={results.length>0
          ? <button type="button" className="rx-btn" onClick={downloadExcel}>Export to Excel</button>
          : undefined}
      />}>
      <div className="rx-grid rx-stag">
        <section className="rx-mod s12">
          <div className="rx-mod-h"><div className="rx-mod-t">Screen a batch</div></div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:16, marginBottom:14 }}>
            <div>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Job opening <em>*</em></label>
              <select className="rx-input" value={selMRF} onChange={e=>setSelMRF(e.target.value)}>
                <option value="">Select an approved MRF</option>
                {mrfs.filter((m:MRF)=>m.status==='APPROVED').map((m:MRF)=>(
                  <option key={m.id} value={m.id}>{m.designation||m.position} — {m.no_of_openings||m.openings||0} openings</option>
                ))}
              </select>
            </div>
            <div>
              <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Resumes (PDF, Word or text)</label>
              <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv"
                onChange={e=>setFiles(Array.from(e.target.files||[]))} style={{ display:'none' }} />
              {/* The kit's drop zone. It stays a BUTTON rather than becoming a
                  real drag target: the upload loop reads from `files`, and
                  adding a drop handler would be new behaviour, not a new skin. */}
              <button type="button" className="rx-drop" onClick={()=>fileRef.current?.click()}
                style={{ width:'100%', border:'2px dashed var(--ez-brand-edge)', cursor:'pointer', font:'inherit', color:'inherit' }}>
                <span className="rx-ico" style={{ width:48, height:48, borderRadius:16 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20V9M7 14l5-5 5 5" /><path d="M5 4h14" />
                  </svg>
                </span>
                <span className="rx-name">{files.length>0?`${files.length} file${files.length===1?'':'s'} selected`:'Choose PDF, Word or TXT files'}</span>
                <span className="rx-meta">{files.length>0?'Click to change the selection':'Click to browse your computer'}</span>
              </button>
            </div>
          </div>
          <div className="rx-row" style={{ gap:10, flexWrap:'wrap' }}>
            <button type="button" className="rx-btn p" onClick={runScreening} disabled={screening||!selMRF||!files.length}>
              {screening?`Screening… ${progress}% (${results.length}/${files.length})`:'Start AI screening'}
            </button>
            {strong.filter(r=>!r.added).length>0 && (
              <button type="button" className="rx-btn ok" onClick={addAllStrong}>
                Add all strong ({strong.filter(r=>!r.added).length})
              </button>
            )}
          </div>
          {/* The kit's own progress track. The hand-rolled one this replaces had
              a documented regression (a brandTint fill on a brandTint plane, 1.0
              contrast); .rx-track carries its own fill and hairline so that
              cannot recur.

              <Track> rather than the bare div: a progressbar with no accessible
              name reads as an unnamed control, the same QA finding that put a
              label on the deadline bars. */}
          {screening && (
            <div style={{ marginTop:14 }}>
              <div className="rx-row" style={{ justifyContent:'space-between', marginBottom:8 }}>
                <span className="rx-label">Screening {Math.min(results.length+1, files.length)} of {files.length} file{files.length===1?'':'s'}</span>
                <span className="rx-meta rx-num">{progress}%</span>
              </div>
              <Track pct={progress} label={`Screening ${files.length} resume${files.length===1?'':'s'}`} />
              {scanning && (
                <div className="rx-li rx-scan" style={{ marginTop:10, border:'1px solid var(--ez-line)', borderRadius:12 }}>
                  <span className="rx-ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z" />
                    </svg>
                  </span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="rx-name" style={{ fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{scanning}</div>
                    <div className="rx-meta">Reading skills and experience</div>
                  </div>
                  {/* Written out rather than <Badge>: this file's Badge is its own. */}
                  <span className="rx-b b-brand rx-live">Scoring</span>
                </div>
              )}
            </div>
          )}
        </section>

        {results.length>0 && (
          <div className="s12 rx-bar" style={{ gap:8 }}>
            <span className="rx-b b-pos">Strong {strong.length}</span>
            <span className="rx-b b-warn">Partial {partial.length}</span>
            <span className="rx-b b-crit">Not suitable {notSuitable.length}</span>
            <span className="rx-b b-mute nodot">Total {results.length}</span>
          </div>
        )}

        {ordered.map((r, i)=>(
          <div className="s12" key={(r.file_name||'')+i}>
            <ScreeningResultCard r={toScreenResult(r)} onAdd={()=>addToBank(results.indexOf(r))} />
          </div>
        ))}
      </div>
    </RxPage>
  )
}

// ── PIPELINE ──────────────────────────────────────────────────────
function PipelineTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify, employeeId, rail }:any) {
  const [interviewCand, setInterviewCand] = useState<Candidate|null>(null)
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const [selMRF, setSelMRF] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selCand, setSelCand] = useState<Candidate|null>(null)
  // Full Add-candidate form. Core identity fields map to their own candidates
  // columns; everything else rides along in application_details (migration 121).
  const EMPTY_C = {
    // 1 requisition
    mrf_id:'', job_location:'', recruiter:'', employment_type:'Full time — permanent',
    // 2 personal
    first_name:'', middle_name:'', last_name:'', dob:'', gender:'', marital_status:'', nationality:'Indian', languages:'',
    // 3 contact
    email:'', dial_code:'+91', phone:'', alt_mobile:'', current_city:'', preferred_location:'', permanent_address:'', relocate:'Not applicable',
    // permanent address — structured (permanent_address is kept as the composed string for compatibility)
    perm_line1:'', perm_line2:'', perm_pincode:'', perm_city:'', perm_state:'', perm_country:'India',
    // 4 professional
    total_exp_years:'', total_exp_months:'', relevant_exp:'', current_company:'', designation:'', function:'', qualification:'', specialization:'', passing_year:'', institute:'', certifications:'', skills:[] as string[], custom_skill:'', notice_period:'', last_working_day:'', buyout:'No',
    // 5 compensation (₹ LPA)
    current_fixed:'', current_variable:'', expected_ctc:'', negotiable:'Yes', offer_in_hand:'No', offer_company:'', offer_amount:'', offer_deadline:'',
    // 6 source
    source:'', source_remark:'', sourced_on:new Date().toISOString().slice(0,10), referrer_id:'', referrer_name:'', referrer_relation:'Ex-colleague', vendor_name:'', vendor_fee:'', portal_link:'',
    // 7 documents
    resume_name:'', photo_name:'', linkedin:'', portfolio:'', consent:false,
    // 8 screening
    q1:'', q2:'', stage:'Applied', availability:'', remarks:'', notify:'Yes',
    hr_email:'',
  }
  const [cForm, setCForm] = useState<any>(EMPTY_C)
  // PIN code → city / state / country auto-fill (India Post directory via /api/recruitment/pincode).
  const [pinLookup, setPinLookup] = useState<{ pin:string; status:'loading'|'ok'|'fail'; label?:string }|null>(null)
  useEffect(()=>{
    const pin = (cForm.perm_pincode||'').trim()
    if (!/^\d{6}$/.test(pin)) { setPinLookup(null); return }
    let alive = true
    setPinLookup({ pin, status:'loading' })
    // Not awaited — this runs in a useEffect body, so the headers are fetched as
    // the first link of the same promise chain rather than by making it async.
    authHeaders().then(h => fetch(`/api/recruitment/pincode?pin=${pin}`, { headers: h })).then(r=>r.json()).then((j:any)=>{
      if (!alive) return
      if (!j?.ok) { setPinLookup({ pin, status:'fail' }); return }
      setCForm((f:any)=>({ ...f, perm_city: j.city||f.perm_city, perm_state: j.state||f.perm_state, perm_country: j.country||f.perm_country||'India' }))
      setPinLookup({ pin, status:'ok', label:[j.area, j.city, j.state].filter(Boolean).join(', ') })
    }).catch(()=>{ if (alive) setPinLookup({ pin, status:'fail' }) })
    return ()=>{ alive = false }
  },[cForm.perm_pincode]) // eslint-disable-line react-hooks/exhaustive-deps
  // Add Candidate is a 4-part wizard: Next validates only the current part, Submit sits on part 4.
  const [addStep, setAddStep] = useState(1)
  const addBodyRef = useRef<HTMLDivElement>(null)
  // "Upload & Parse Resume" — fills the form from the resume via /api/recruitment/parse-resume
  const resumeRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [parseNote, setParseNote] = useState<{ ok:boolean; text:string; missing?:string[] }|null>(null)
  async function parseResume(file: File) {
    setParsing(true); setParseNote(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch('/api/recruitment/parse-resume', { method:'POST', body: fd, headers: await uploadAuthHeaders() })
      const j = await r.json().catch(()=>({}))
      if (!r.ok || !j.ok) { setParseNote({ ok:false, text: j.error || 'Could not parse this resume' }); setParsing(false); return }
      const f = j.fields || {}
      setCForm((prev:any) => {
        const next:any = { ...prev, resume_name: file.name }
        const LPA_FIELDS = new Set(['current_fixed','current_variable','expected_ctc'])   // parser returns LPA; the form takes rupees
        for (const [k, v] of Object.entries(f)) {
          if (k === 'skills') { const arr = Array.isArray(v) ? v : []; if (arr.length) next.skills = Array.from(new Set([...(prev.skills||[]), ...arr])) }
          else if (LPA_FIELDS.has(k)) { const n = Number(v); if (n > 0) next[k] = String(Math.round(n * 100000)) }
          else if (v !== '' && v != null && k in prev) next[k] = v
        }
        return next
      })
      const n = (j.filled||[]).length
      setParseNote({ ok:true, text:`Auto-filled ${n} field${n===1?'':'s'} from "${file.name}"${j.meta?.confidence!=null?` · AI confidence ${Math.round(j.meta.confidence*100)}%`:''} — please review before saving.`, missing: (j.missing||[]).filter((k:string)=>['first_name','last_name','email','phone','current_company','designation','total_exp_years','skills','qualification'].includes(k)) })
      showNotify(`Resume parsed — ${n} fields filled`)
    } catch { setParseNote({ ok:false, text:'Could not reach the parser — try again' }) }
    setParsing(false)
  }
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)   // reveal red on the missing fields only after a submit attempt
  const [myEmail, setMyEmail] = useState('')
  useEffect(()=>{ supabase.auth.getUser().then(({data}:any)=>{ const em=data?.user?.email; if(em){ setMyEmail(em); setCForm((f:any)=>({...f, hr_email:f.hr_email||em, recruiter:f.recruiter||em})) } }) },[])
  const cMrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
  // Compensation is typed as the full annual amount in rupees — 110000, not 1.1. No LPA
  // decimals, no unit auto-detection: what you type is what is saved (candidates.current_ctc /
  // expected_ctc are rupees). The LPA figure is only echoed back for a quick sanity check.
  const toRs = (v:any) => Math.round(Number(v)||0)
  const curFixedLpa = toRs(cForm.current_fixed)/100000, curVarLpa = toRs(cForm.current_variable)/100000, expLpa = toRs(cForm.expected_ctc)/100000, offerLpa = toRs(cForm.offer_amount)/100000
  const totalCurLpa = curFixedLpa + curVarLpa
  const hikePct = (totalCurLpa>0 && expLpa>0) ? ((expLpa-totalCurLpa)/totalCurLpa)*100 : null
  const rsYr = (lpa:number) => `₹${Math.round(lpa*100000).toLocaleString('en-IN')}/yr`
  // "= ₹1,10,000 (1.10 LPA)" — shown under each figure
  const echo = (v:any) => (v===''||v==null||!(Number(v)>0)) ? null : `= ₹${toRs(v).toLocaleString('en-IN')} per year (${(toRs(v)/100000).toFixed(2)} LPA)`
  // expected_ctc (rupees) vs the MRF budget (rupees)
  const expCtcOver = !!(cMrf?.budget_max && cForm.expected_ctc!=='' && toRs(cForm.expected_ctc) > Number(cMrf.budget_max))
  const CF = (k:string,v:any) => setCForm((f:any)=>({...f,[k]:v}))
  const toggleSkill = (s:string) => setCForm((f:any)=>({ ...f, skills: f.skills.includes(s) ? f.skills.filter((x:string)=>x!==s) : [...f.skills, s] }))
  const addCustomSkill = () => { const s=(cForm.custom_skill||'').trim(); if(!s) return; setCForm((f:any)=>({ ...f, skills: f.skills.includes(s)?f.skills:[...f.skills,s], custom_skill:'' })) }
  // MRF carries its department and location as ids; resolve them to names against
  // the lists this tab already loaded (the raw mrf row has no *_name field).
  const mrfLocName = (m:any) => (locations||[]).find((l:any)=>l.id===m?.location_id)?.location_name || m?.location_name || ''
  const mrfDeptName = (m:any) => (departments||[]).find((d:any)=>d.id===m?.department_id)?.dept_name || m?.dept_name || ''
  const mrfCompanyName = (m:any) => (companies||[]).find((c:Company)=>c.id===m?.company_id)?.company_name || (companies||[]).find((c:Company)=>c.id===m?.company_id)?.company_code || ''
  const EMP_TYPES = ['Full time — permanent','Fixed term contract','Third party payroll','Intern']
  // Autofill everything the chosen opening already knows, the moment it is picked:
  // job location, recruiter, employment type and the role's required skills. Only
  // the requisition-derived fields are touched — the candidate's own details stay.
  useEffect(() => {
    if (!cForm.mrf_id) return
    const m = mrfs.find((x:MRF)=>x.id===cForm.mrf_id)
    if (!m) return
    const parsedSkills = String(m.skills_required||'').split(/[,;/|\n]+/).map((s:string)=>s.trim()).filter(Boolean)
    setCForm((f:any)=>({
      ...f,
      job_location:    mrfLocName(m) || f.job_location,
      recruiter:       m.assigned_recruiter || f.recruiter,
      employment_type: m.employment_type || f.employment_type,
      skills:          parsedSkills.length ? Array.from(new Set([...f.skills, ...parsedSkills])) : f.skills,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cForm.mrf_id])
  // Fields that must be filled before a candidate can be saved.
  const isEmail = (v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
  const missing = {
    mrf_id: !cForm.mrf_id, first_name: !cForm.first_name.trim(), last_name: !cForm.last_name.trim(),
    email: !isEmail(cForm.email.trim()), phone: !/^\d{10}$/.test(cForm.phone.trim()),
    current_city: !cForm.current_city.trim(), total_exp_years: cForm.total_exp_years==='',
    qualification: !cForm.qualification, notice_period: !cForm.notice_period,
    current_fixed: cForm.current_fixed==='', expected_ctc: cForm.expected_ctc==='',
    source: !cForm.source, source_remark: cForm.source==='Other' && !String(cForm.source_remark||'').trim(), consent: !cForm.consent,
  } as Record<string,boolean>
  const bad = (k:string)=> touched && missing[k]
  const STEP_TITLES = ['Requisition & Personal', 'Contact & Professional', 'Compensation & Source', 'Documents & Screening']
  const STEP_FIELDS: Record<number,string[]> = { 1:['mrf_id','first_name','last_name'], 2:['email','phone','current_city','total_exp_years','qualification','notice_period'], 3:['current_fixed','expected_ctc','source','source_remark'], 4:['consent'] }
  const stepMissing = (n:number) => STEP_FIELDS[n].filter(k=>missing[k]).length
  const goToStep = (n:number) => { setAddStep(Math.max(1, Math.min(4, n))); setTouched(false); addBodyRef.current?.scrollTo({ top:0, behavior:'smooth' }) }
  const goNext = () => {
    const miss = stepMissing(addStep)
    if (miss > 0) { setTouched(true); showNotify(`${miss} required field${miss>1?'s':''} missing in this part`, 'error'); return }
    goToStep(addStep + 1)
  }
  const missingCount = Object.values(missing).filter(Boolean).length
  const errStyle = { borderColor:C.critical, background:C.criticalTint } as React.CSSProperties
  // These return ONLY the error override now — .rx-input carries the base, so
  // spreading T.input back over it would undo the class. Same shape as eb() in
  // MRFTab. undefined when valid, which React treats as no inline style.
  //
  // These two are why the first census of this tab was wrong: they are style
  // FACTORIES, not style props, so scanning for the inline style prop never
  // saw the twelve fields that route through them. (This sentence used to
  // quote that prop verbatim — and the bulk rewrite duly edited the comment
  // along with the code, which is how the site count came out one too high.)
  const inp = (k:string):React.CSSProperties|undefined => (bad(k)?errStyle:undefined)
  const sel = (k:string):React.CSSProperties|undefined => (bad(k)?errStyle:undefined)
  const reqMark = <span style={{ color:C.critical }}> *</span>
  const approvedMRFs = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const [stageF, setStageF] = useState('')   // '' = all stages
  const baseList = (selMRF==='all'?candidates:candidates.filter((c:Candidate)=>c.mrf_id===selMRF))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))
  const filtered = stageF ? baseList.filter((c:Candidate)=>c.stage===stageF) : baseList

  async function addCandidate() {
    setTouched(true)
    if (missingCount > 0) { const first = [1,2,3,4].find(n => stepMissing(n) > 0); if (first && first !== addStep) setAddStep(first); showNotify(`${missingCount} required field${missingCount>1?'s':''} still missing`,'error'); return }
    setSaving(true)
    try {
      const phone = cForm.phone.trim()
      const email = cForm.email.trim()
      const { data:dup } = await supabase.from('candidates').select('id').or(`phone.eq.${phone},email.eq.${email||'none'}`).limit(1)
      if (dup?.length && !window.confirm('A candidate with the same phone/email already exists. Add anyway?')) { setSaving(false); return }

      const mrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
      const fullName = [cForm.first_name, cForm.middle_name, cForm.last_name].map((s:string)=>s.trim()).filter(Boolean).join(' ')
      // total experience → the column is an integer number of years; the exact
      // years + months are kept in application_details.professional.
      const expYears = Math.round((Number(cForm.total_exp_years)||0) + (Number(cForm.total_exp_months)||0)/12)
      const noticeDays = cForm.notice_period==='Immediate' ? 0 : (parseInt(cForm.notice_period,10) || null)
      // ₹ LPA → rupees, the unit every existing card and offer screen already reads.
      const fixedRs = toRs(cForm.current_fixed) || null
      const varRs = toRs(cForm.current_variable) || null
      const expRs = toRs(cForm.expected_ctc) || null
      const absurd = [fixedRs, varRs, expRs].find(v => v != null && (v > 1e8 || (v > 0 && v < 1000)))
      if (absurd != null) { showNotify(`CTC ₹${absurd.toLocaleString('en-IN')} doesn’t look right — enter the full annual amount in rupees (e.g. 840000 for 8.4 LPA).`,'error'); return }
      // Knockout screening: a "No" on either question drops the candidate into Rejected.
      const knockedOut = cForm.q1==='No' || cForm.q2==='No'
      const stage = knockedOut ? 'Rejected' : cForm.stage

      const details = {
        requisition:{ job_location:cForm.job_location||mrf?.location_name||null, recruiter:cForm.recruiter||null, employment_type:cForm.employment_type },
        personal:{ first_name:cForm.first_name, middle_name:cForm.middle_name, last_name:cForm.last_name, dob:cForm.dob||null, gender:cForm.gender||null, marital_status:cForm.marital_status||null, nationality:cForm.nationality||null, languages:cForm.languages||null },
        contact:{ dial_code:cForm.dial_code, alt_mobile:cForm.alt_mobile||null, current_city:cForm.current_city, preferred_location:cForm.preferred_location||null,
          permanent_address:[cForm.perm_line1, cForm.perm_line2, cForm.perm_city, cForm.perm_state, cForm.perm_pincode, cForm.perm_country].map((x:string)=>(x||'').trim()).filter(Boolean).join(', ') || cForm.permanent_address || null,
          permanent_address_parts:{ line1:cForm.perm_line1||null, line2:cForm.perm_line2||null, pincode:cForm.perm_pincode||null, city:cForm.perm_city||null, state:cForm.perm_state||null, country:cForm.perm_country||null },
          willing_to_relocate:cForm.relocate },
        professional:{ relevant_exp:cForm.relevant_exp||null, function:cForm.function||null, qualification:cForm.qualification, specialization:cForm.specialization||null, passing_year:cForm.passing_year||null, institute:cForm.institute||null, certifications:cForm.certifications||null, skills:cForm.skills, buyout:cForm.buyout, last_working_day:cForm.last_working_day||null },
        compensation:{ current_fixed_lpa:curFixedLpa||null, current_variable_lpa:curVarLpa||null, total_current_ctc_rs:(fixedRs||0)+(varRs||0)||null, expected_ctc_lpa:expLpa||null, hike_pct: hikePct!=null ? Math.round(hikePct*10)/10 : null, entry_unit:'RUPEES_PER_YEAR', negotiable:cForm.negotiable, offer_in_hand:cForm.offer_in_hand, offer_company:cForm.offer_company||null, offer_amount_lpa:offerLpa||null, offer_deadline:cForm.offer_deadline||null },
        source:{ channel:cForm.source, remark: cForm.source==='Other' ? (cForm.source_remark||'').trim()||null : null, sourced_on:cForm.sourced_on||null, referrer_id:cForm.referrer_id||null, referrer_name:cForm.referrer_name||null, referrer_relation:cForm.referrer_relation||null, vendor_name:cForm.vendor_name||null, vendor_fee:cForm.vendor_fee||null, portal_link:cForm.portal_link||null },
        documents:{ resume_name:cForm.resume_name||null, photo_name:cForm.photo_name||null, linkedin:cForm.linkedin||null, portfolio:cForm.portfolio||null, consent:cForm.consent, consent_at:cForm.consent?new Date().toISOString():null },
        screening:{ q1:cForm.q1||null, q2:cForm.q2||null, chosen_stage:cForm.stage, availability:cForm.availability||null, notify_hiring_manager:cForm.notify, knocked_out:knockedOut },
      }

      const base:any = {
        mrf_id:cForm.mrf_id||null, company_id:mrf?.company_id||null,
        full_name:fullName, phone, mobile:phone,
        email:email||null, hr_email:cForm.hr_email||null, current_company:cForm.current_company||null,
        designation:cForm.designation||null, experience_years:expYears,
        current_ctc:fixedRs, expected_ctc:expRs,
        notice_period:noticeDays, notice_period_days:noticeDays,
        source: cForm.source==='Other' && (cForm.source_remark||'').trim() ? `Other — ${cForm.source_remark.trim()}` : (cForm.source||null), stage,
        status:'active', applied_date:new Date().toISOString().split('T')[0],
        interview_notes:cForm.remarks||null,
        ...(knockedOut ? { blacklist_reason:`Screening knockout: ${cForm.q1==='No'?'cannot run 500+ payroll independently':'cannot join within notice'}` } : {}),
      }

      let error = (await supabase.from('candidates').insert({ ...base, application_details:details })).error
      // Graceful fallback if migration 121 (application_details column) is not applied yet —
      // the candidate still saves with all its core fields.
      if (error && (error.code==='42703' || /application_details/i.test(error.message))) {
        error = (await supabase.from('candidates').insert(base)).error
        if (!error) showNotify('Candidate added (run migration 121 to also store the extended details).')
      } else if (!error) {
        showNotify('Candidate added!')
      }
      if (error) { showNotify('Error: '+error.message,'error'); setSaving(false); return }
      setShowAdd(false); setTouched(false); setCForm({...EMPTY_C, hr_email:myEmail, recruiter:myEmail}); onRefresh()
    } finally {
      setSaving(false)
    }
  }

  async function moveStage(id:string, stage:string) {
    // Pipeline moves forward only — a candidate can't be sent back to an earlier round.
    const cur = candidates.find((c:Candidate)=>c.id===id)?.stage
    const ci = STAGES.indexOf(cur as string), ti = STAGES.indexOf(stage)
    if (ci!==-1 && ti!==-1 && ti<ci) {
      showNotify(`Can't move back to "${stage}" — the pipeline only moves forward`,'error')
      return
    }
    await supabase.from('candidates').update({ stage }).eq('id',id)
    setSelCand(c=>c?{...c,stage}:null); onRefresh()
  }

  const [showRejected, setShowRejected] = useState(false)

  // What this tab can HONESTLY say about a next step. interview_rounds is not
  // loaded here at all -- the rounds live in interview_invites and
  // CandidateInterviewModal fetches them per candidate when it opens. So
  // candidateNextStep(c, []) would print "Schedule the next round" over people
  // who already have one booked: a NEW claim, and a false one. The cards say
  // nothing about next steps today, so inventing one would be a regression in
  // truthfulness, not a restyle. These branches are what the stage alone proves.
  const nextStepFor = (c:any) => {
    if (c.stage === 'Joined')      return { text:'Joined', tone:'pos' as const, icon:'check' as const }
    if (c.stage === 'Offer Sent')  return { text:'Waiting for the candidate to reply', tone:'mute' as const, icon:'clock' as const }
    if (c.stage === 'Shortlisted') return { text:'Start salary negotiation', tone:'' as const, icon:'coin' as const }
    return { text:`At ${c.stage}`, tone:'' as const, icon:'flow' as const }
  }

  const candVMs = filtered.map((c:Candidate) => toCandidateVM(c as unknown as Record<string, unknown>))
  const rejectedVMs = baseList.filter((c:Candidate)=>c.stage===REJECTED)
    .map((c:Candidate) => toCandidateVM(c as unknown as Record<string, unknown>))

  const openingSelect = (
    <select className="rx-input" style={{ width:280 }} value={selMRF} onChange={e=>setSelMRF(e.target.value)}>
      <option value="all">All Openings ({candidates.length} candidates)</option>
      {approvedMRFs.map((m:MRF)=>(
        <option key={m.id} value={m.id}>{m.designation||m.position} ({candidates.filter((c:Candidate)=>c.mrf_id===m.id).length})</option>
      ))}
    </select>
  )

  // These four controls are inline rather than the old shared RecFilterBar.
  // That component's root carried inline position:sticky; top:0; zIndex:30, and
  // the redesign's rail is sticky at --ez-z-rail (20) -- the token's own comment
  // says the rail sits "below Z.sticky(30)" -- so dropped into this frame it
  // scrolled up over the rail, and inline sticky cannot be unset by a parent.
  // Same `f` state, same setF, same behaviour. It no longer exists in this file;
  // offer-flow-components.tsx keeps its own copy for the two unconverted tabs.
  const filterBar = (
    <>
      <select className="rx-input" style={{ maxWidth:170 }} value={f.company} onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
        <option value="">All Companies</option>
        {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
      </select>
      <select className="rx-input" style={{ maxWidth:170 }} value={f.department} onChange={e=>setF({ ...f, department:e.target.value })}>
        <option value="">All Departments</option>
        {departments.filter((d:Department)=>!f.company||d.company_id===f.company).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
      </select>
      <select className="rx-input" style={{ maxWidth:170 }} value={f.location} onChange={e=>setF({ ...f, location:e.target.value })}>
        <option value="">All Locations</option>
        {locations.filter((l:Location)=>!f.company||l.company_id===f.company).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
      </select>
      <select className="rx-input" style={{ maxWidth:170 }} value={f.position} onChange={e=>setF({ ...f, position:e.target.value })}>
        <option value="">All Positions</option>
        {distinctPositions(candidates).map((p:string)=><option key={p} value={p}>{p}</option>)}
      </select>
      {/* Stage filter, minus Rejected. The board already shows every flow stage
          as its own column, but this still filters the List view. Rejected is
          excluded because PipelineView drops it unconditionally -- leaving it
          selectable would hand the view a list it then empties completely. */}
      <select className="rx-input" style={{ maxWidth:170 }} value={stageF} onChange={e=>setStageF(e.target.value)}>
        <option value="">All stages</option>
        {STAGES.filter((s:string)=>s!==REJECTED).map((s:string)=>(
          <option key={s} value={s}>{s} ({baseList.filter((c:Candidate)=>c.stage===s).length})</option>
        ))}
      </select>
    </>
  )

  return (
    <>
      <PipelineView
        candidates={candVMs}
        stages={STAGES}
        nextStepFor={nextStepFor}
        openingSelect={openingSelect}
        filterBar={filterBar}
        onOpen={(id:string)=>{ const c = candidates.find((x:Candidate)=>x.id===id); if (c) setSelCand(c) }}
        onAddCandidate={()=>{ setCForm({...EMPTY_C, hr_email:myEmail}); setAddStep(1); setTouched(false); setShowAdd(true) }}
        onShowRejected={()=>setShowRejected(true)}
      />

      {approvedMRFs.length===0&&(
        <div style={{ ...T.card, textAlign:'center' as const, color:C.faint, padding:32, margin:'0 24px 18px' }}>
          No approved MRF yet. Approve one in the MRF tab first.
        </div>
      )}


      {/* Add Candidate — full form */}
      {showAdd&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:100, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'24px 16px' }}
          onMouseDown={e=>{ if(e.target===e.currentTarget && !saving) setShowAdd(false) }}>
          <div style={{ background:C.surface, borderRadius:16, width:'min(920px, 100%)', boxShadow:'0 24px 70px rgba(0,0,0,0.28)', overflow:'hidden', display:'flex', flexDirection:'column', maxHeight:'92vh' }}>
            {/* header */}
            <div style={{ background:`linear-gradient(135deg,${C.brand},${C.brandDeep})`, color:C.onAccent, padding:'16px 22px', display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
              <div>
                <div style={{ fontSize:17, fontWeight:700 }}>Add candidate</div>
                <div style={{ fontSize:12, color:C.onAccentDim, marginTop:2 }}>
                  {cMrf ? [cMrf.designation||cMrf.position, mrfDeptName(cMrf), mrfLocName(cMrf)].filter(Boolean).join(' · ') : 'Attach the candidate to an approved opening'}
                </div>
              </div>
              <input ref={resumeRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display:'none' }}
                onChange={e=>{ const f=e.target.files?.[0]; if (f) parseResume(f); e.currentTarget.value='' }} />
              <button onClick={()=>!parsing&&resumeRef.current?.click()} disabled={parsing}
                style={{ marginLeft:'auto', background:C.onAccent, color:C.brandDeep, border:'none', borderRadius:8, padding:'7px 14px', cursor:parsing?'wait':'pointer', fontSize:12.5, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap' as const, opacity:parsing?.7:1 }}>
                {parsing ? '⏳ Parsing resume…' : '📄 Upload & Parse Resume'}
              </button>
              <button onClick={()=>!saving&&setShowAdd(false)} style={{ background:'transparent', border:`1px solid ${C.onAccentDim}`, color:C.onAccent, borderRadius:8, padding:'5px 12px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>Close</button>
            </div>

            {/* scrollable body */}
            <div ref={addBodyRef} style={{ overflowY:'auto', padding:'6px 22px 18px' }}>
              {/* step indicator — click a completed part to go back to it */}
              <div style={{ display:'flex', gap:6, margin:'12px 0 6px', flexWrap:'wrap' as const }}>
                {STEP_TITLES.map((t,i)=>{ const n=i+1, active=n===addStep, done=n<addStep; return (
                  <button key={n} type="button" onClick={()=>{ if (done) goToStep(n) }} disabled={!done && !active}
                    style={{ display:'flex', alignItems:'center', gap:7, flex:'1 1 150px', padding:'7px 10px', borderRadius:9, border:`1px solid ${active?C.brand:done?C.positiveEdge:C.line}`, background:active?C.brandTint:done?C.positiveTint:C.surface, cursor:done?'pointer':'default', fontFamily:'inherit', textAlign:'left' as const }}>
                    <span style={{ width:20, height:20, borderRadius:'50%', display:'grid', placeItems:'center', fontSize:11, fontWeight:800, background:active?C.brand:done?C.positive:C.sunken, color:(active||done)?C.onAccent:C.faint, flexShrink:0 }}>{done?'✓':n}</span>
                    <span style={{ fontSize:11.5, fontWeight:active?700:600, color:active?C.brandDeep:done?C.positive:C.faint, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{t}</span>
                  </button>
                )})}
              </div>
              {parseNote && (
                <div style={{ margin:'10px 0 4px', padding:'9px 12px', borderRadius:9, fontSize:12.5, lineHeight:1.5, background: parseNote.ok?C.positiveTint:C.criticalTint, color: parseNote.ok?C.positive:C.critical, border:`1px solid ${parseNote.ok?C.positiveEdge:C.criticalEdge}` }}>
                  <b>{parseNote.ok?'✓ Resume parsed.':'✗ Parse failed.'}</b> {parseNote.text}
                  {parseNote.ok && parseNote.missing && parseNote.missing.length>0 && <div style={{ marginTop:3, fontSize:11.5, opacity:.9 }}>Not found in the resume — fill manually: {parseNote.missing.map((k:string)=>k.replace(/_/g,' ')).join(', ')}</div>}
                </div>
              )}

              {addStep===1 && (<>
              {/* 1 · Requisition */}
              <SectionLine title="Requisition" />
              <div style={{ ...T.g2, marginBottom:14 }}>
                <div style={{ gridColumn:'1 / -1' }}>
                  <label className="rx-label" style={{ display:'block', marginBottom:6 }}>For Opening (MRF){reqMark}</label>
                  <select className="rx-input" style={sel('mrf_id')} value={cForm.mrf_id} onChange={e=>CF('mrf_id',e.target.value)}>
                    <option value="">Select an approved opening</option>
                    {approvedMRFs.map((m:MRF)=><option key={m.id} value={m.id}>{m.designation||m.position} ({m.no_of_openings||m.openings||0} openings){m.location_name?` · ${m.location_name}`:''}</option>)}
                  </select>
                  {approvedMRFs.length===0 && <div style={{ fontSize:11, color:C.warning, marginTop:4 }}>No approved MRF yet — approve one in the MRF tab first.</div>}
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Company</label><input className="rx-input" style={{ opacity:.7 }} value={mrfCompanyName(cMrf)||'—'} readOnly placeholder="Auto-filled from the opening" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Department</label><input className="rx-input" style={{ opacity:.7 }} value={mrfDeptName(cMrf)||'—'} readOnly /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Job location</label>
                  <input className="rx-input" value={cForm.job_location} onChange={e=>CF('job_location',e.target.value)} placeholder={mrfLocName(cMrf)||'City / Remote'} />
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Recruiter</label><input className="rx-input" value={cForm.recruiter} onChange={e=>CF('recruiter',e.target.value)} placeholder="Recruiter name / email" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Employment type</label>
                  <select className="rx-input" value={cForm.employment_type} onChange={e=>CF('employment_type',e.target.value)}>
                    {Array.from(new Set([...EMP_TYPES, cForm.employment_type].filter(Boolean))).map(o=><option key={o as string}>{o as string}</option>)}
                  </select>
                </div>
              </div>

              {/* 2 · Personal */}
              <SectionLine title="Personal details" />
              <div style={{ ...T.g3, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>First name{reqMark}</label><input className="rx-input" style={inp('first_name')} value={cForm.first_name} onChange={e=>CF('first_name',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Middle name</label><input className="rx-input" value={cForm.middle_name} onChange={e=>CF('middle_name',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Last name{reqMark}</label><input className="rx-input" style={inp('last_name')} value={cForm.last_name} onChange={e=>CF('last_name',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Date of birth</label><input className="rx-input" type="date" max="2010-01-01" value={cForm.dob} onChange={e=>CF('dob',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Gender</label>
                  <select className="rx-input" value={cForm.gender} onChange={e=>CF('gender',e.target.value)}>
                    <option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option>
                  </select>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Marital status</label>
                  <select className="rx-input" value={cForm.marital_status} onChange={e=>CF('marital_status',e.target.value)}>
                    <option value="">Select</option><option>Single</option><option>Married</option><option>Other</option>
                  </select>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Nationality</label><input className="rx-input" value={cForm.nationality} onChange={e=>CF('nationality',e.target.value)} /></div>
                <div style={{ gridColumn:'span 2' }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Languages known <span style={{ color:C.faint, fontWeight:400 }}>(comma separated)</span></label><input className="rx-input" value={cForm.languages} onChange={e=>CF('languages',e.target.value)} placeholder="Hindi, English" /></div>
              </div>

              </>)}
              {addStep===2 && (<>
              {/* 3 · Contact */}
              <SectionLine title="Contact" />
              <div style={{ ...T.g2, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Personal email{reqMark}</label><input className="rx-input" style={inp('email')} type="email" value={cForm.email} onChange={e=>CF('email',e.target.value)} placeholder="name@example.com" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Mobile{reqMark} <span style={{ color:C.faint, fontWeight:400 }}>(10 digits)</span></label>
                  <div style={{ display:'flex', gap:6 }}>
                    <select className="rx-input" style={{ flex:'0 0 80px' }} value={cForm.dial_code} onChange={e=>CF('dial_code',e.target.value)}>{['+91','+971','+1','+44','+65'].map(o=><option key={o}>{o}</option>)}</select>
                    <input className="rx-input" style={{ ...inp('phone'), flex:1 }} inputMode="numeric" maxLength={10} value={cForm.phone} onChange={e=>CF('phone',e.target.value.replace(/\D/g,''))} placeholder="10 digits" />
                  </div>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Alternate number</label><input className="rx-input" inputMode="numeric" maxLength={10} value={cForm.alt_mobile} onChange={e=>CF('alt_mobile',e.target.value.replace(/\D/g,''))} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Current city{reqMark}</label><input className="rx-input" style={inp('current_city')} value={cForm.current_city} onChange={e=>CF('current_city',e.target.value)} placeholder="Gurugram" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>HR email (for follow-ups)</label><input className="rx-input" value={cForm.hr_email} onChange={e=>CF('hr_email',e.target.value)} placeholder="hr@company.com" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Willing to relocate</label>
                  <select className="rx-input" value={cForm.relocate} onChange={e=>CF('relocate',e.target.value)}><option>Not applicable</option><option>Yes</option><option>No</option></select>
                </div>
                <div style={{ gridColumn:'1 / -1' }}>
                  <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Permanent address</label>
                  <input className="rx-input" style={{ marginBottom:8 }} value={cForm.perm_line1} onChange={e=>CF('perm_line1',e.target.value)} placeholder="Address line 1 — house / flat, building, street" />
                  <input className="rx-input" style={{ marginBottom:8 }} value={cForm.perm_line2} onChange={e=>CF('perm_line2',e.target.value)} placeholder="Address line 2 — area / locality, landmark (optional)" />
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
                    <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>PIN code</label><input className="rx-input" style={{ ...(pinLookup?.status==='fail'?{ borderColor:C.warning }:{}) }} inputMode="numeric" maxLength={6} value={cForm.perm_pincode} onChange={e=>CF('perm_pincode',e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="560011" />
                      {pinLookup && <div style={{ fontSize:10, marginTop:3, color: pinLookup.status==='ok'?C.positive:pinLookup.status==='fail'?C.warning:C.faint, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{pinLookup.status==='loading'?'Looking up…':pinLookup.status==='ok'?`✓ ${pinLookup.label}`:'PIN not found — fill manually'}</div>}
                    </div>
                    <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>City</label><input className="rx-input" value={cForm.perm_city} onChange={e=>CF('perm_city',e.target.value)} placeholder="Bengaluru" /></div>
                    <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>State</label>
                      <select className="rx-input" value={cForm.perm_state} onChange={e=>CF('perm_state',e.target.value)}>
                        <option value="">Select state</option>
                        {MIN_WAGE_STATES.map(st=><option key={st} value={st}>{st}</option>)}
                      </select>
                    </div>
                    <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Country</label><input className="rx-input" value={cForm.perm_country} onChange={e=>CF('perm_country',e.target.value)} placeholder="India" /></div>
                  </div>
                </div>
              </div>

              {/* 4 · Professional */}
              <SectionLine title="Professional background" />
              <div style={{ ...T.g3, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Total experience — years{reqMark}</label><input className="rx-input" style={inp('total_exp_years')} type="number" min={0} max={50} value={cForm.total_exp_years} onChange={e=>CF('total_exp_years',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Months</label><input className="rx-input" type="number" min={0} max={11} value={cForm.total_exp_months} onChange={e=>CF('total_exp_months',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Relevant experience (yrs)</label><input className="rx-input" type="number" min={0} max={50} step={0.5} value={cForm.relevant_exp} onChange={e=>CF('relevant_exp',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Current employer</label><input className="rx-input" value={cForm.current_company} onChange={e=>CF('current_company',e.target.value)} placeholder="Blank if fresher" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Current designation</label><input className="rx-input" value={cForm.designation} onChange={e=>CF('designation',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Function</label>
                  <select className="rx-input" value={cForm.function} onChange={e=>CF('function',e.target.value)}>
                    <option value="">Select</option>{['Payroll','HR Operations','HR Compliance','Talent Acquisition','Finance','Engineering','Sales','Other'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Highest qualification{reqMark}</label>
                  <select className="rx-input" style={sel('qualification')} value={cForm.qualification} onChange={e=>CF('qualification',e.target.value)}>
                    <option value="">Select</option>{['Diploma','Graduate','Post graduate','Professional — CA / CS / CMA','Doctorate'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Specialization</label><input className="rx-input" value={cForm.specialization} onChange={e=>CF('specialization',e.target.value)} placeholder="B.Com (Hons), MBA-HR" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Year of passing</label><input className="rx-input" type="number" min={1970} max={2035} value={cForm.passing_year} onChange={e=>CF('passing_year',e.target.value)} placeholder="2019" /></div>
                <div style={{ gridColumn:'span 2' }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Institute / university</label><input className="rx-input" value={cForm.institute} onChange={e=>CF('institute',e.target.value)} /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Certifications</label><input className="rx-input" value={cForm.certifications} onChange={e=>CF('certifications',e.target.value)} placeholder="SHRM-CP, Payroll (NPI)" /></div>
              </div>
              {/* skills */}
              <div style={{ marginBottom:14 }}>
                <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Key skills</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:2 }}>
                  {['Payroll processing','Statutory compliance','PF / ESIC','Income tax — TDS','Advanced Excel','Recruitment','Stakeholder management','Communication'].concat(cForm.skills.filter((s:string)=>!['Payroll processing','Statutory compliance','PF / ESIC','Income tax — TDS','Advanced Excel','Recruitment','Stakeholder management','Communication'].includes(s))).map((s:string)=>{
                    const on = cForm.skills.includes(s)
                    return <button key={s} type="button" onClick={()=>toggleSkill(s)} style={{ ...T.btn, height:30, padding:'0 12px', borderRadius:99, fontSize:12, fontWeight:on?600:500, background:on?C.brand:C.sunken, color:on?C.onAccent:C.inkSoft, border:`1px solid ${on?C.brand:C.line}` }}>{s}</button>
                  })}
                </div>
                <div style={{ display:'flex', gap:6, marginTop:8, maxWidth:340 }}>
                  <input className="rx-input" style={{ height:32 }} value={cForm.custom_skill} onChange={e=>CF('custom_skill',e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addCustomSkill() } }} placeholder="Add a custom skill…" />
                  <button type="button" onClick={addCustomSkill} style={{ ...T.btnOutline, height:32 }}>Add</button>
                </div>
              </div>
              <div style={{ ...T.g3, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Notice period{reqMark}</label>
                  <select className="rx-input" style={sel('notice_period')} value={cForm.notice_period} onChange={e=>CF('notice_period',e.target.value)}>
                    <option value="">Select</option>{['Immediate','15 days','30 days','60 days','90 days','Serving notice'].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                {cForm.notice_period==='Serving notice' && <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Last working day</label><input className="rx-input" type="date" value={cForm.last_working_day} onChange={e=>CF('last_working_day',e.target.value)} /></div>}
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Buyout possible</label>
                  <select className="rx-input" value={cForm.buyout} onChange={e=>CF('buyout',e.target.value)}><option>No</option><option>Yes</option><option>To be discussed</option></select>
                </div>
              </div>

              </>)}
              {addStep===3 && (<>
              {/* 5 · Compensation */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' as const }}>
                <SectionLine title="Compensation" />
                <span style={{ fontSize:11, color:C.faint, whiteSpace:'nowrap' as const }}>All amounts in ₹ per year — type the full figure, e.g. 110000 for 1.1 LPA</span>
              </div>
              <div style={{ ...T.g3, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Current fixed CTC{reqMark}</label><input className="rx-input" style={inp('current_fixed')} type="number" min={0} step={1} value={cForm.current_fixed} onChange={e=>CF('current_fixed',e.target.value)} placeholder="e.g. 840000" />
                  {echo(cForm.current_fixed) && <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{echo(cForm.current_fixed)}</div>}
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Current variable</label><input className="rx-input" type="number" min={0} step={1} value={cForm.current_variable} onChange={e=>CF('current_variable',e.target.value)} placeholder="e.g. 60000" />
                  {echo(cForm.current_variable) && <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{echo(cForm.current_variable)}</div>}
                </div>
                {/* C.dark/C.onDark: a surface meant to stay inverted in both themes (C.ink is a text token). */}
                <div style={{ background:C.dark, color:C.onDark, borderRadius:R.md, padding:`${S.sm}px ${S.md}px`, alignSelf:'end' }}>
                  <div style={{ fontSize:F.micro, color:C.onDarkMuted }}>Total current CTC</div>
                  <div style={{ fontSize:F.title, fontWeight:W.bold, ...numeric }}>{totalCurLpa>0 ? rsYr(totalCurLpa) : '₹0/yr'}</div>
                  {totalCurLpa>0 && <div style={{ fontSize:F.micro, color:C.onDarkMuted }}>= {totalCurLpa.toFixed(2)} LPA</div>}
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Expected CTC{reqMark}</label>
                  <input className="rx-input" style={{ ...inp('expected_ctc'), ...(expCtcOver?errStyle:{}) }} type="number" min={0} step={1} value={cForm.expected_ctc} onChange={e=>CF('expected_ctc',e.target.value)} placeholder="e.g. 1100000" />
                  {echo(cForm.expected_ctc) && <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{echo(cForm.expected_ctc)}</div>}
                  {expCtcOver
                    ? <div style={{ fontSize:F.micro, color:C.critical, marginTop:S.xs, fontWeight:W.semi }}>Exceeds MRF max budget (₹{(Number(cMrf.budget_max)/100000).toFixed(1)}L) — you can still save.</div>
                    : cMrf?.budget_max ? <div style={{ fontSize:F.micro, color:C.muted, marginTop:S.xs }}>MRF budget: ₹{(Number(cMrf.budget_min||0)/100000).toFixed(1)}L – ₹{(Number(cMrf.budget_max)/100000).toFixed(1)}L</div> : null}
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Negotiable</label>
                  <select className="rx-input" value={cForm.negotiable} onChange={e=>CF('negotiable',e.target.value)}><option>Yes</option><option>No</option><option>Depends on role</option></select>
                </div>
                <div style={{ background:C.sunken, borderRadius:R.md, padding:'8px 12px', alignSelf:'end', border:`1px solid ${C.line}` }}>
                  <div style={{ fontSize:F.micro, color:C.muted }}>Hike over current</div>
                  <div style={{ fontSize:F.title, fontWeight:W.bold, color: hikePct==null ? C.faint : hikePct<0 ? C.critical : C.positive, ...numeric }}>{hikePct==null ? '—' : `${hikePct>0?'+':''}${hikePct.toFixed(1)}%`}</div>
                  {hikePct!=null && <div style={{ fontSize:F.micro, color:C.faint }}>₹{totalCurLpa.toFixed(2)}L → ₹{expLpa.toFixed(2)}L</div>}
                </div>
                <div style={{ gridColumn:'1 / -1' }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Offer in hand</label>
                  <select className="rx-input" style={{ maxWidth:200 }} value={cForm.offer_in_hand} onChange={e=>CF('offer_in_hand',e.target.value)}><option>No</option><option>Yes</option></select>
                </div>
                {cForm.offer_in_hand==='Yes' && <>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Offering company</label><input className="rx-input" value={cForm.offer_company} onChange={e=>CF('offer_company',e.target.value)} /></div>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Offered CTC</label><input className="rx-input" type="number" min={0} step={1} value={cForm.offer_amount} onChange={e=>CF('offer_amount',e.target.value)} placeholder="e.g. 1200000" />
                    {echo(cForm.offer_amount) && <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{echo(cForm.offer_amount)}</div>}
                  </div>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Joining deadline</label><input className="rx-input" type="date" value={cForm.offer_deadline} onChange={e=>CF('offer_deadline',e.target.value)} /></div>
                </>}
              </div>

              {/* 6 · Source */}
              <SectionLine title="Source" />
              <div style={{ ...T.g2, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Source{reqMark}</label>
                  <select className="rx-input" style={sel('source')} value={cForm.source} onChange={e=>CF('source',e.target.value)}>
                    <option value="">Select</option>{SOURCES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                {cForm.source==='Other' && (
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Source remark{reqMark}</label>
                    <input className="rx-input" style={sel('source_remark')} value={cForm.source_remark} onChange={e=>CF('source_remark',e.target.value)} placeholder="Where did this candidate come from?" />
                  </div>
                )}
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Sourced on</label><input className="rx-input" type="date" value={cForm.sourced_on} onChange={e=>CF('sourced_on',e.target.value)} /></div>
                {cForm.source==='Referral' && <>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Referring employee ID</label><input className="rx-input" value={cForm.referrer_id} onChange={e=>CF('referrer_id',e.target.value)} placeholder="EMP-10234" /></div>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Referring employee name</label><input className="rx-input" value={cForm.referrer_name} onChange={e=>CF('referrer_name',e.target.value)} /></div>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Relationship</label>
                    <select className="rx-input" value={cForm.referrer_relation} onChange={e=>CF('referrer_relation',e.target.value)}><option>Ex-colleague</option><option>Friend</option><option>Family</option><option>Other</option></select>
                  </div>
                </>}
                {cForm.source==='Consultancy' && <>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Vendor name</label><input className="rx-input" value={cForm.vendor_name} onChange={e=>CF('vendor_name',e.target.value)} /></div>
                  <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Agreed fee (% of CTC)</label><input className="rx-input" type="number" min={0} max={30} step={0.5} value={cForm.vendor_fee} onChange={e=>CF('vendor_fee',e.target.value)} placeholder="8.33" /></div>
                </>}
                <div style={{ gridColumn:'1 / -1' }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Job portal / profile link</label><input className="rx-input" type="url" value={cForm.portal_link} onChange={e=>CF('portal_link',e.target.value)} placeholder="https://" /></div>
              </div>

              </>)}
              {addStep===4 && (<>
              {/* 7 · Documents */}
              <SectionLine title="Documents" />
              <div style={{ ...T.g2, marginBottom:14 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Resume <span style={{ color:C.faint, fontWeight:400 }}>(PDF/DOCX)</span></label>
                  <input className="rx-input" style={{ padding:'7px 9px' }} type="file" accept=".pdf,.doc,.docx" onChange={e=>CF('resume_name',e.target.files?.[0]?.name||'')} />
                  {cForm.resume_name && <div style={{ fontSize:11, color:C.positive, marginTop:3 }}>Attached: {cForm.resume_name}</div>}
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Photograph <span style={{ color:C.faint, fontWeight:400 }}>(optional)</span></label>
                  <input className="rx-input" style={{ padding:'7px 9px' }} type="file" accept="image/*" onChange={e=>CF('photo_name',e.target.files?.[0]?.name||'')} />
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>LinkedIn profile</label><input className="rx-input" type="url" value={cForm.linkedin} onChange={e=>CF('linkedin',e.target.value)} placeholder="https://linkedin.com/in/" /></div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Portfolio / other link</label><input className="rx-input" type="url" value={cForm.portfolio} onChange={e=>CF('portfolio',e.target.value)} placeholder="https://" /></div>
                <div style={{ gridColumn:'1 / -1' }}>
                  <label style={{ display:'flex', alignItems:'flex-start', gap:S.sm, cursor:'pointer', fontSize:F.small, color:C.ink, ...(bad('consent')?{ color:C.critical }:{}) }}>
                    <input type="checkbox" checked={cForm.consent} onChange={e=>CF('consent',e.target.checked)} style={{ marginTop:2 }} />
                    <span>Candidate has consented to their data being stored and processed for this hiring process{reqMark}</span>
                  </label>
                </div>
              </div>

              {/* 8 · Screening */}
              <SectionLine title="Screening" />
              <div style={{ marginBottom:10 }}>
                <div style={{ background:C.sunken, border:`1px solid ${C.line}`, borderRadius:R.md, padding:'10px 12px', marginBottom:8 }}>
                  <div style={{ fontSize:F.small, fontWeight:W.medium, marginBottom:S.sm }}>Has the candidate independently run a monthly payroll cycle for 500+ employees?</div>
                  <div style={{ display:'flex', gap:16 }}>{['Yes','No','Partially'].map(o=><label key={o} style={{ display:'flex', gap:5, alignItems:'center', fontSize:13 }}><input type="radio" name="q1" checked={cForm.q1===o} onChange={()=>CF('q1',o)} />{o}</label>)}</div>
                </div>
                <div style={{ background:C.sunken, border:`1px solid ${C.line}`, borderRadius:R.md, padding:'10px 12px' }}>
                  <div style={{ fontSize:F.small, fontWeight:W.medium, marginBottom:S.sm }}>Can the candidate join within the notice period stated above?</div>
                  <div style={{ display:'flex', gap:16 }}>{['Yes','No'].map(o=><label key={o} style={{ display:'flex', gap:5, alignItems:'center', fontSize:13 }}><input type="radio" name="q2" checked={cForm.q2===o} onChange={()=>CF('q2',o)} />{o}</label>)}</div>
                </div>
                {(cForm.q1==='No'||cForm.q2==='No') && <div style={{ fontSize:F.tiny, color:C.critical, marginTop:S.sm, fontWeight:W.semi }}>A “No” on a knockout question will file this candidate under Rejected.</div>}
              </div>
              <div style={{ ...T.g2, marginBottom:6 }}>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Stage</label>
                  <select className="rx-input" value={cForm.stage} onChange={e=>CF('stage',e.target.value)}>
                    {['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Shortlisted'].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Interview availability</label><input className="rx-input" value={cForm.availability} onChange={e=>CF('availability',e.target.value)} placeholder="Weekdays after 6 pm, Sat full day" /></div>
                <div style={{ gridColumn:'1 / -1' }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Recruiter remarks <span style={{ color:C.faint, fontWeight:400 }}>(visible to hiring manager)</span></label><textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:64 }} value={cForm.remarks} onChange={e=>CF('remarks',e.target.value)} placeholder="Screening call summary, red flags, why this profile fits" /></div>
              </div>
              </>)}
            </div>

            {/* sticky footer */}
            <div style={{ borderTop:`1px solid ${C.line}`, padding:'12px 22px', display:'flex', alignItems:'center', gap:10, flexShrink:0, background:C.surface }}>
              {addStep>1 && <button onClick={()=>goToStep(addStep-1)} disabled={saving} style={T.btnOutline}>← Back</button>}
              {addStep<4
                ? <button onClick={goNext} disabled={saving} style={T.btnPrimary}>Next: {STEP_TITLES[addStep]} →</button>
                : <button onClick={addCandidate} disabled={saving} style={{ ...T.btnPrimary, opacity:saving?.6:1, cursor:saving?'default':'pointer' }}>{saving?'Saving…':'Add to pipeline'}</button>}
              <button onClick={()=>!saving&&setShowAdd(false)} style={T.btnOutline}>Cancel</button>
              <span style={{ marginLeft:'auto', fontSize:12, fontWeight:500, color: touched&&stepMissing(addStep)>0 ? C.critical : C.faint }}>
                Part {addStep} of 4 · {touched&&stepMissing(addStep)>0 ? `${stepMissing(addStep)} required field${stepMissing(addStep)>1?'s':''} missing here` : 'Fields marked * are required'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Candidate popup — centered modal; runs the round-by-round interview flow */}
      {selCand&&(
        <CandidateInterviewModal
          candidate={selCand}
          mrf={mrfs.find((m:MRF)=>m.id===selCand.mrf_id) || null}
          stages={STAGES} stageColor={STAGE_COLOR} stageText={STAGE_TEXT}
          schedulerId={employeeId}
          onClose={()=>setSelCand(null)}
          onStageChange={moveStage}
          onChanged={(stage)=>{ if (stage) setSelCand(c=>c?{...c,stage}:null); onRefresh() }}
          showNotify={showNotify} />
      )}

      {/* ── Interview Pipeline full-screen overlay ── */}
      {interviewCand && (
        <div style={{ position:'fixed', inset:0, background:C.canvas, zIndex:Z.overlay, overflowY:'auto', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ background: `linear-gradient(135deg,${C.brand},${C.brand})`, padding:'12px 20px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:10 }}>
            <button onClick={()=>setInterviewCand(null)} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(255,255,255,.3)', background:'transparent', color:C.onAccent, cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:500 }}>Back to Pipeline</button>
            <div style={{ fontSize:15, fontWeight:600, color:C.onAccent }}>Interview Pipeline — {interviewCand.full_name}</div>
            <div style={{ marginLeft:'auto', fontSize:12, color:C.onAccentDim }}>{interviewCand.designation || '—'} · {interviewCand.current_company || '—'}</div>
          </div>
          <InterviewPipeline candidate={{
            id:          interviewCand.id,
            full_name:   interviewCand.full_name,
            designation: interviewCand.designation || '—',
            department:  mrfs.find((m:MRF)=>m.id===interviewCand.mrf_id)?.dept_name || undefined,
            current_ctc: interviewCand.current_ctc,
            ai_score:    interviewCand.ai_score ? Math.round(interviewCand.ai_score) : undefined,
          }} />
        </div>
      )}

      {/* Rejected candidates. PipelineView filters REJECTED out of the board
          unconditionally, so they need their own surface -- this keeps them
          reachable exactly as the old "Rejected" stage pill did. Fixed overlay,
          the same pattern the add form and the interview modal already use. */}
      {showRejected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:100, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'24px 16px' }}
          onMouseDown={e=>{ if(e.target===e.currentTarget) setShowRejected(false) }}>
          <div style={{ background:C.surface, borderRadius:16, width:'min(900px, 100%)', boxShadow:'0 24px 70px rgba(0,0,0,0.28)', padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>Rejected candidates ({rejectedVMs.length})</div>
              <button onClick={()=>setShowRejected(false)} style={{ ...T.btnOutline, marginLeft:'auto' }}>Close</button>
            </div>
            {rejectedVMs.length===0 ? (
              <div style={{ textAlign:'center' as const, color:C.faint, padding:28 }}>No rejected candidates.</div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
                {rejectedVMs.map((c:any)=>(
                  <CandidateCard key={c.id} c={c} next={nextStepFor(c)}
                    onOpen={()=>{ const full = candidates.find((x:Candidate)=>x.id===c.id); if (full) { setShowRejected(false); setSelCand(full) } }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Shared search / filter controls kept for the Negotiation tab (the other tabs inline theirs).
function SearchBar({ placeholder, onApply, width=300 }:{ placeholder:string; onApply:(q:string)=>void; width?:number }) {
  const [draft, setDraft] = useState('')
  return (
    <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center', flexWrap:'wrap' as const }}>
      <input className="rx-input" style={{ maxWidth:width }} value={draft} placeholder={placeholder}
        onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') onApply(draft.trim()) }} />
      <button style={T.btnPrimary} onClick={()=>onApply(draft.trim())}>Apply</button>
      {draft && <button style={T.btnOutline} onClick={()=>{ setDraft(''); onApply('') }}>Clear</button>}
    </div>
  )
}

function RecFilterBar({ companies, departments, locations, positions, f, setF }:any) {
  return (
    <div style={{ ...T.card, display:'flex', gap:12, flexWrap:'wrap' as const, alignItems:'flex-end', position:'sticky', top:0, zIndex:Z.sticky, boxShadow:'var(--ez-shadow-flat)' }}>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label className="rx-label">Company</label>
        <select className="rx-input" value={f.company} onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
          <option value="">All companies</option>
          {(companies||[]).map((c:any)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label className="rx-label">Department</label>
        <select className="rx-input" value={f.department} onChange={e=>setF({ ...f, department:e.target.value })}>
          <option value="">All departments</option>
          {(() => {
            const vis = (departments||[]).filter((d:any)=>!f.company||d.company_id===f.company)
            return vis.map((d:any)=><option key={d.id} value={d.id}>{deptLabel(d, vis, companies||[])}</option>)
          })()}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label className="rx-label">Position</label>
        <select className="rx-input" value={f.position} onChange={e=>setF({ ...f, position:e.target.value })}>
          <option value="">All positions</option>
          {(positions||[]).map((p:string)=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label className="rx-label">Location</label>
        <select className="rx-input" value={f.location} onChange={e=>setF({ ...f, location:e.target.value })}>
          <option value="">All locations</option>
          {(locations||[]).filter((l:any)=>!f.company||l.company_id===f.company).map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
        </select>
      </div>
      {(f.company||f.department||f.position||f.location) && (
        <button style={T.btnOutline} onClick={()=>setF({ company:'', department:'', position:'', location:'' })}>Clear filters</button>
      )}
    </div>
  )
}

// ── NEGOTIATION CALCULATOR ────────────────────────────────────────
// ── Stipend calculator (Intern / NATS / NAPS / Contract / Live Project / Consultant) ──
// ── Minimum wages — read-only view of the payroll master (minimum_wage_config), opened from the
// CTC calculator. HR edits the figures in Payroll → Minimum Wages; nothing here is editable.
const MW_CAT_LABEL:Record<string,string> = { UNSKILLED:'Unskilled', SEMI_SKILLED:'Semi Skilled', SKILLED:'Skilled', HIGHLY_SKILLED:'Highly Skilled' }
const MW_CAT_ORDER = ['UNSKILLED','SEMI_SKILLED','SKILLED','HIGHLY_SKILLED']
function MinWagesPopup({ rates, state, category, onClose }:{ rates:any[]; state?:string; category?:string; onClose:()=>void }) {
  const [q, setQ] = useState('')
  const curCat = (CAT_TO_DB as any)[category||''] || ''
  const list = (rates||[]).filter(r => !q.trim() || (r.state||'').toLowerCase().includes(q.trim().toLowerCase()))
  // group by state (+ zone) → one row per category
  const groups:Record<string, any[]> = {}
  for (const r of list) { const k = `${r.state}${r.zone && r.zone!=='ALL' ? ` · ${r.zone}` : ''}`; (groups[k] ||= []).push(r) }
  const keys = Object.keys(groups).sort((a,b)=>a.localeCompare(b))
  const rs = (n:any) => n==null||n==='' ? '—' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`
  const isCur = (r:any) => (r.state||'').toLowerCase()===(state||'').toLowerCase()
  return (
    <div onMouseDown={e=>{ if (e.target===e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:320, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'28px 16px' }}>
      <div style={{ background:C.surface, borderRadius:14, width:'min(960px, 100%)', boxShadow:'0 24px 70px rgba(30,27,75,0.35)', padding:'16px 18px', color:C.ink }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' as const }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800 }}>Minimum wages — payroll master</div>
            <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>Monthly figures, currently effective · read-only here — HR maintains them under Payroll → Minimum Wages</div>
          </div>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search state…" className="rx-input" style={{ width:200, marginLeft:'auto' }} />
          <button onClick={onClose} style={T.btnOutline}>Close</button>
        </div>
        {keys.length===0 ? (
          <div style={{ fontSize:12.5, color:C.faint, padding:'24px 0', textAlign:'center' as const }}>{rates?.length ? 'No state matches that search.' : 'No minimum-wage rows in the payroll master yet.'}</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:C.sunken }}>
                  {['State','Category','Basic','VDA','Total / month','Effective from','Notification'].map(h=>(
                    <th key={h} style={{ textAlign: ['Basic','VDA','Total / month'].includes(h)?'right':'left', padding:'8px 10px', fontSize:10.5, fontWeight:700, color:C.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.05em', borderBottom:`1px solid ${C.line}`, whiteSpace:'nowrap' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map(k => {
                  const rows = [...groups[k]].sort((a,b)=>MW_CAT_ORDER.indexOf(a.category)-MW_CAT_ORDER.indexOf(b.category))
                  return rows.map((r,i) => {
                    const hl = isCur(r)
                    const exact = hl && r.category===curCat
                    return (
                      <tr key={`${k}-${r.category}-${i}`} style={{ background: exact ? C.brandTint : hl ? C.sunken : 'transparent' }}>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, fontWeight: i===0 ? 700 : 400, color: i===0 ? C.ink : 'transparent', whiteSpace:'nowrap' as const }}>{k}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, fontWeight: exact ? 700 : 500 }}>{MW_CAT_LABEL[r.category]||r.category}{exact && <span style={{ marginLeft:6, fontSize:9.5, fontWeight:700, color:C.brandDeep, background:C.surface, border:`1px solid ${C.brandEdge}`, borderRadius:99, padding:'1px 6px' }}>in use</span>}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', ...numeric }}>{rs(r.basic_amount)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', ...numeric }}>{rs(r.vda_amount)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', fontWeight:700, ...numeric }}>{rs(r.total_minimum_wage)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, color:C.muted, whiteSpace:'nowrap' as const }}>{r.effective_from ? new Date(r.effective_from).toLocaleDateString('en-IN',{ day:'2-digit', month:'short', year:'numeric' }) : '—'}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, color:C.muted, fontSize:11 }}>{r.notification_reference||'—'}</td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize:10.5, color:C.faint, marginTop:10 }}>{rates?.length||0} rows · the highlighted state is the one selected in this negotiation.</div>
      </div>
    </div>
  )
}

function StipendCalc({ sel, mrf, companies, supabase, showNotify, onRefresh, mwRates, locations }:any) {
  const [stipend, setStipend] = useState('')
  const [tds, setTds] = useState(false)
  const [tdsPct, setTdsPct] = useState('')
  const [addAmt, setAddAmt] = useState('')
  const [addFreq, setAddFreq] = useState('One-time')
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedLink, setSavedLink] = useState<string|null>(null)
  const [companyOverride, setCompanyOverride] = useState('')
  const autoCompany = sel?.company_id || mrf?.company_id || (companies?.length===1 ? companies[0].id : '')
  const effCompany = autoCompany || companyOverride
  // Consultants / contractors are paid "Fees", interns / NATS / NAPS a "Stipend" — one
  // calculator, the label follows the engagement type.
  const comp = compOf(mrf?.employment_type)
  const payLabel = comp.label   // 'Stipend' | 'Fees'
  const s = Number(stipend)||0
  const pct = tds ? (Number(tdsPct)||0) : 0
  const tdsAmt = Math.round(s*pct/100)
  const net = s - tdsAmt
  const addAmount = Number(addAmt)||0

  // The offered stipend may not exceed the MRF's approved budget. For stipend roles the
  // budget is a monthly figure; annualise only if the MRF stored it per year.
  const mrfStipendCapMonthly = mrf?.budget_max ? Number(mrf.budget_max) / (mrf?.pay_period==='ANNUAL' ? 12 : 1) : 0
  const overBudget = mrfStipendCapMonthly>0 && s > mrfStipendCapMonthly
  const lakh = (v:number) => `₹${(v/100000).toFixed(2)}L`
  const money = (v:number) => `₹${Math.round(v).toLocaleString('en-IN')}`

  // Minimum-wage floor applies to EVERY engagement type: the monthly stipend / fees may
  // not be below the state + worker-category minimum wage (HR master → default table).
  const mrfLoc = (locations||[]).find((l:any)=>l.id===mrf?.location_id)
  const mrfState = stateFromLocation(mrfLoc)   // e.g. Ahmedabad Branch → Gujarat
  const [mwState, setMwState] = useState<string>(mrfState || DEFAULT_STATE)
  useEffect(()=>{ if (mrfState) setMwState(mrfState) }, [mrf?.id, mrfState])
  const [mwCat, setMwCat] = useState<string>(mrf?.wage_category || DEFAULT_CATEGORY)
  useEffect(()=>{ if (mrf?.wage_category) setMwCat(mrf.wage_category) }, [mrf?.id, mrf?.wage_category])
  const mw = resolveMinWage(mwRates, mwState, mwCat as any)
  const belowMinWage = s>0 && s < mw.amount

  async function save() {
    if (!s) { showNotify(`Enter the monthly ${payLabel.toLowerCase()}`,'error'); return }
    if (mrfStipendCapMonthly>0 && s > mrfStipendCapMonthly) { showNotify(`${payLabel} ${money(s)}/mo exceeds the MRF budget of ${money(mrfStipendCapMonthly)}/mo. Reduce it before saving.`,'error'); return }
    if (s < mw.amount) { showNotify(`${payLabel} ${money(s)}/mo is below the minimum wage for ${mwState} (${mwCat}): ${money(mw.amount)}/mo. Raise it to continue.`,'error'); return }
    const companyId = effCompany || null
    if (!companyId) { showNotify('Select the company for this candidate first (dropdown in the calculator).','error'); return }
    if (!sel.company_id) await supabase.from('candidates').update({ company_id:companyId }).eq('id', sel.id)
    setSaving(true); setSavedLink(null)
    const calcData = { is_stipend:true, pay_kind:comp.kind, pay_label:payLabel, employment_type:mrf?.employment_type, stipend_monthly:s, tds_applicable:tds, tds_pct:pct, tds_amount:tdsAmt, net_monthly:net, annual:s*12,
      additional_amount:addAmount, additional_freq:addFreq, remark:remark.trim()||null,
      mw_state:mwState, mw_category:mwCat, min_wage:mw.amount, min_wage_source:mw.source }
    const { data, error } = await supabase.from('ctc_negotiations').upsert({
      candidate_id:sel.id, company_id:companyId, link_sent_at:new Date().toISOString(),
      offered_ctc:s*12, net_monthly:net,
      candidate_name:sel.full_name, position_title:sel.designation||null,
      is_stipend:true, stipend_monthly:s, tds_applicable:tds, tds_pct:pct,
      calculation_data:calcData,
    }).select('link_token').single()
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    setSavedLink(data?.link_token ? `${window.location.origin}/salary-view/${data.link_token}` : null)
    showNotify(`${payLabel} saved! Salary link ready 👇`); onRefresh()
  }

  return (
    <div>
      <div style={T.cardPurple}>
        <div style={{ fontSize:13, fontWeight:600, color:C.brandDeep, marginBottom:4 }}>{payLabel} Calculator — {sel.full_name}{mrf?.mrf_number && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mrf.mrf_number}</span>}</div>
        <div style={{ fontSize:11, color:C.faint, marginBottom:14 }}>{mrf?.employment_type||'Non-employee'} engagement · {payLabel.toLowerCase()} only (no PF/HRA structure)</div>
        {!autoCompany && (
          <div style={{ marginBottom:12, padding:'8px 12px', background:C.warningTint, border: `1px solid ${C.warningTint}`, borderRadius:10 }}>
            <label className="rx-label" style={{ display:'block', marginBottom:6 }}>Company * <span style={{ color:C.warning, fontWeight:400 }}>— not set on this candidate, please choose</span></label>
            <select className="rx-input" value={companyOverride} onChange={e=>setCompanyOverride(e.target.value)}>
              <option value="">Select company…</option>
              {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
            </select>
          </div>
        )}
        <div style={{ ...T.g2, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>State / UT</label>
            <select className="rx-input" value={mwState} onChange={e=>setMwState(e.target.value)} disabled={!!mrfState}>
              {MIN_WAGE_STATES.map(st=><option key={st} value={st}>{st}</option>)}
            </select>
            <div style={{ fontSize:10.5, color:mrfState?C.positive:C.faint, marginTop:3 }}>{mrfState ? `Auto-filled from MRF branch: ${mrfLoc?.location_name||'branch'} → ${mrfState}` : 'No branch on the MRF — choose the state'}</div>
          </div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Worker Category</label>
            <select className="rx-input" value={mwCat} onChange={e=>setMwCat(e.target.value)} disabled={!!mrf?.wage_category}>
              {WAGE_CATS.map(ct=><option key={ct} value={ct}>{ct}</option>)}
            </select>
            <div style={{ fontSize:10.5, color:mrf?.wage_category?C.positive:C.faint, marginTop:3 }}>{mrf?.wage_category ? 'Auto-filled from the MRF' : 'Not set on the MRF — choose here'}</div>
          </div>
        </div>
        <div style={{ ...T.g2, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Monthly {payLabel} (₹) *</label>
            <input className="rx-input" style={{ ...((overBudget||belowMinWage)?{ borderColor:C.critical }:{}) }} type="number" value={stipend} onChange={e=>setStipend(e.target.value)} placeholder={comp.ph?.[0]||'25000'} />
            {mrfStipendCapMonthly>0 && (
              overBudget
                ? <div style={{ fontSize:10.5, color:C.critical, marginTop:3, fontWeight:600 }}>Exceeds MRF budget ({money(mrfStipendCapMonthly)}/mo) — {payLabel.toLowerCase()} can’t be higher than the approved budget.</div>
                : <div style={{ fontSize:10.5, color:C.faint, marginTop:3 }}>MRF budget: up to {money(mrfStipendCapMonthly)}/mo</div>
            )}
            {belowMinWage
              ? <div style={{ fontSize:10.5, color:C.critical, marginTop:3, fontWeight:600 }}>Below minimum wage for {mwState} ({mwCat}): {money(mw.amount)}/mo — {payLabel.toLowerCase()} can’t be lower than this.</div>
              : <div style={{ fontSize:10.5, color:C.faint, marginTop:3 }}>Minimum wage · {mwState} · {mwCat}: <b style={{ color:C.ink }}>{money(mw.amount)}/mo</b> {mw.source==='master'?'(HR master)':mw.source==='default'?'(default table)':'(fallback)'}</div>}
          </div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>TDS Applicable?</label>
            <select className="rx-input" value={tds?'Yes':'No'} onChange={e=>setTds(e.target.value==='Yes')}><option>No</option><option>Yes</option></select>
          </div>
        </div>
        {tds&&(<div style={{ marginBottom:10 }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>TDS %</label><input className="rx-input" type="number" value={tdsPct} onChange={e=>setTdsPct(e.target.value)} placeholder="10" /></div>)}

        {/* Additional amount — one-off or recurring, with an optional remark */}
        <div style={{ ...T.g2, marginBottom:10 }}>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Additional Amount (₹)</label><input className="rx-input" type="number" value={addAmt} onChange={e=>setAddAmt(e.target.value)} placeholder="e.g. 5000" /></div>
          <div><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Frequency</label>
            <select className="rx-input" value={addFreq} onChange={e=>setAddFreq(e.target.value)}>
              {['One-time','Monthly','Quarterly','Half-yearly','Yearly'].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom:10 }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Remark</label>
          <textarea className="rx-input" style={{ minHeight:60 }} value={remark} onChange={e=>setRemark(e.target.value)} placeholder="Any note for the candidate (shown on the salary link)…" />
        </div>

        {s>0&&(
          <div style={{ marginTop:8, background:C.sunken, border: `1px solid ${C.brandEdge}`, borderRadius:10, padding:'12px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13 }}><span style={{ color: C.inkSoft }}>Monthly {payLabel}</span><span style={{ fontWeight:600 }}>₹{s.toLocaleString('en-IN')}</span></div>
            {tds&&<div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13, color:C.critical }}><span>(-) TDS ({pct}%)</span><span>-₹{tdsAmt.toLocaleString('en-IN')}</span></div>}
            <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0 0', fontSize:14, fontWeight:700, color:C.positive, borderTop: `1px solid ${C.brandEdge}`, marginTop:4 }}><span>Net In-Hand (monthly)</span><span>₹{net.toLocaleString('en-IN')}</span></div>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 0', fontSize:12, color:C.brand }}><span>Annual {payLabel}</span><span>₹{(s*12).toLocaleString('en-IN')}</span></div>
            {addAmount>0&&<div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 0', fontSize:12, color:C.inkSoft }}><span>Additional ({addFreq})</span><span>₹{addAmount.toLocaleString('en-IN')}</span></div>}
          </div>
        )}
        <button onClick={save} disabled={saving||overBudget||belowMinWage} style={{ ...T.btnPrimary, width:'100%', marginTop:12, padding:10, opacity:(saving||overBudget||belowMinWage)?.6:1, cursor:(overBudget||belowMinWage)?'not-allowed':'pointer' }}>{overBudget?`${payLabel} exceeds MRF budget`:belowMinWage?`${payLabel} below minimum wage`:saving?'Saving…':`Save ${payLabel} & Move to Offers`}</button>
        {savedLink&&(
          <div style={{ marginTop:12, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:600, color: C.brand, marginBottom:6 }}>CANDIDATE SALARY LINK</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input readOnly value={savedLink} onFocus={e=>e.target.select()} className="rx-input" style={{ fontSize:11, fontFamily:'monospace' }} />
              <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btn, background:C.brand, color:C.onAccent, whiteSpace:'nowrap' as const }}>Copy</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CTC Negotiation — document collection link (24h) ──────────────────────────
// Replaces the old Aadhaar/offer uploader. The recruiter sends the candidate a
// secure 24h link to upload their documents; CC colleagues; then Resend / see Status.
function CtcDocLink({ candidate, mrf, companyId, supabase, showNotify, onClose, onRefresh }:any) {
  const [loading, setLoading] = useState(true)
  const [link, setLink] = useState<any>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [mode, setMode] = useState<'main'|'send'|'status'>('main')
  const [email, setEmail] = useState<string>(candidate.email||'')
  const [cc, setCc] = useState<{id:string;name:string;email:string}[]>([])
  const [ccQ, setCcQ] = useState('')
  const [emps, setEmps] = useState<any[]>([])
  const [sending, setSending] = useState(false)
  const [meEmail, setMeEmail] = useState<string>('')
  const [busyDoc, setBusyDoc] = useState<string>('')          // doc id currently acting on
  const [viewDoc, setViewDoc] = useState<{url:string; name:string}|null>(null) // View popup
  const [selDocs, setSelDocs] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)
  const [rejecting, setRejecting] = useState<any|null>(null)  // doc pending reject confirm

  const signDoc = async (docId:string, mode:'view'|'download') => {
    const r = await fetch(`/api/recruitment/doc-collection/file?doc_id=${docId}&mode=${mode}`, { cache:'no-store', headers: await authHeaders() })
    const j = await r.json().catch(()=>({}))
    if (!r.ok || !j.url) throw new Error(j.error||'Could not open file')
    return j as { url:string; file_name?:string }
  }
  async function onView(d:any) {
    setBusyDoc(d.id)
    try { const j = await signDoc(d.id,'view'); setViewDoc({ url:j.url, name:d.doc_label||d.file_name||'Document' }) }
    catch(e:any){ showNotify(e.message||'Could not open','error') }
    setBusyDoc('')
  }
  async function onDownload(d:any) {
    setBusyDoc(d.id)
    try { const j = await signDoc(d.id,'download'); const a=document.createElement('a'); a.href=j.url; a.download=d.file_name||''; document.body.appendChild(a); a.click(); a.remove() }
    catch(e:any){ showNotify(e.message||'Could not download','error') }
    setBusyDoc('')
  }
  async function onReject(d:any) {
    setBusyDoc(d.id)
    try {
      const r = await fetch('/api/recruitment/doc-collection', { method:'POST', headers: await authHeaders(), body: JSON.stringify({ action:'reject', doc_id:d.id }) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { showNotify(j.error||'Could not reject','error'); setBusyDoc(''); setRejecting(null); return }
      showNotify(`${d.doc_label||d.doc_type} rejected — resend the link so the candidate re-uploads it.`)
      setSelDocs(new Set()); setRejecting(null); await loadStatus(); onRefresh?.()
    } catch { showNotify('Could not reject','error') }
    setBusyDoc('')
  }
  async function onDownloadZip(ids?:string[]) {
    setZipping(true)
    try {
      const qs = ids && ids.length ? `&ids=${ids.join(',')}` : ''
      const r = await fetch(`/api/recruitment/doc-collection/zip?candidate_id=${candidate.id}${qs}`, { cache:'no-store', headers: await authHeaders() })
      if (!r.ok) { const j = await r.json().catch(()=>({})); showNotify(j.error||'Could not build zip','error'); setZipping(false); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href=url; a.download=`${(candidate.full_name||'candidate').replace(/[^A-Za-z0-9]+/g,'_')}_documents.zip`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch { showNotify('Could not build zip','error') }
    setZipping(false)
  }
  const toggleSel = (id:string) => setSelDocs(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })

  const loadStatus = async () => {
    try {
      const r = await fetch(`/api/recruitment/doc-collection?candidate_id=${candidate.id}`, { cache:'no-store', headers: await authHeaders() })
      const j = await r.json().catch(()=>({}))
      setLink(j.link||null); setDocs(j.docs||[])
    } catch {} finally { setLoading(false) }
  }
  useEffect(()=>{ loadStatus() },[candidate.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    supabase.from('employees').select('id, full_name, emp_code, office_email, personal_email').is('date_of_leaving',null).order('full_name').then(({data}:any)=>setEmps(data||[]))
    supabase.auth.getUser().then(({data}:any)=>setMeEmail(data?.user?.email||''))
  },[supabase])

  const empEmail = (e:any) => e.office_email || e.personal_email || ''
  const ccHits = ccQ.trim() ? emps.filter((e:any)=> empEmail(e) && !cc.some(c=>c.id===e.id) && ((e.full_name||'').toLowerCase().includes(ccQ.toLowerCase()) || (e.emp_code||'').toLowerCase().includes(ccQ.toLowerCase()))).slice(0,8) : []
  const now = Date.now()
  const active = link && link.status==='ACTIVE' && link.expires_at && new Date(link.expires_at).getTime()>now
  const timeLeft = link?.expires_at ? Math.max(0, Math.floor((new Date(link.expires_at).getTime()-now)/3600000)) : 0

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { showNotify('Enter a valid candidate email','error'); return }
    setSending(true)
    try {
      const r = await fetch('/api/recruitment/doc-collection', { method:'POST', headers: await authHeaders(),
        body: JSON.stringify({ action:'send', candidate_id:candidate.id, mrf_id:candidate.mrf_id||mrf?.id||null, company_id:companyId||candidate.company_id||mrf?.company_id||null, email:email.trim(), cc:cc.map(c=>c.email), created_by:meEmail||null }) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { showNotify(j.error||'Could not send','error'); setSending(false); return }
      showNotify(j.emailSkipped ? `Link created (email off: ${j.emailSkipped})` : `Document link sent to ${email}${cc.length?` (cc ${cc.length})`:''}`)
      await loadStatus(); setMode('main'); onRefresh?.()
    } catch { showNotify('Could not send','error') }
    setSending(false)
  }

  return (
    <div onMouseDown={e=>{ if(e.target===e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:Z.drawer, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'24px 16px' }}>
      <div style={{ background:C.surface, borderRadius:16, width:'min(560px, 100%)', boxShadow:'0 24px 70px rgba(30,27,75,0.3)', padding:'18px 20px', margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <div style={{ fontSize:16, fontWeight:700, color:C.ink, flex:1 }}>CTC Negotiation — {candidate.full_name}{mrf?.mrf_number && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mrf.mrf_number}</span>}</div>
          <button onClick={onClose} style={{ ...T.btnOutline }}>Close</button>
        </div>

        {loading ? <div style={{ fontSize:13, color:C.faint, padding:'10px 0' }}>Loading…</div> : (
          <>
          {mode==='main' && (
            <div>
              <div style={{ fontSize:12, color:C.faint, marginBottom:2 }}>Registered email</div>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>{candidate.email || <span style={{ color:C.critical }}>no email on file</span>}</div>
              {link ? (
                <>
                  <div style={{ background:C.sunken, border:`1px solid ${C.line}`, borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99,
                        background: link.status==='SUBMITTED'?C.positiveTint : active?C.infoTint : C.criticalTint,
                        color: link.status==='SUBMITTED'?C.positive : active?C.info : C.critical }}>
                        {link.status==='SUBMITTED'?'Submitted ✓' : active?`Active · ${timeLeft}h left` : 'Expired'}
                      </span>
                      <span style={{ fontSize:11, color:C.faint }}>{docs.length} document{docs.length===1?'':'s'} uploaded</span>
                    </div>
                    <div style={{ fontSize:11, color:C.faint, marginTop:6 }}>Sent to {link.candidate_email||candidate.email}{Array.isArray(link.cc_emails)&&link.cc_emails.length?` · cc ${link.cc_emails.join(', ')}`:''}</div>
                  </div>
                  {link.status==='SUBMITTED' ? (
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=>setMode('status')} style={{ ...T.btnPrimary, flex:1 }}>Review Documents</button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=>{ setEmail(link.candidate_email||candidate.email||''); setCc((link.cc_emails||[]).map((em:string)=>({id:em,name:em,email:em}))); setMode('send') }} style={{ ...T.btnPrimary, flex:1 }}>Resend link</button>
                      <button onClick={()=>setMode('status')} style={{ ...T.btnOutline, flex:1 }}>Status</button>
                    </div>
                  )}
                </>
              ) : (
                <button onClick={()=>{ setEmail(candidate.email||''); setMode('send') }} style={{ ...T.btnPrimary, width:'100%', padding:11 }}>Create CTC Negotiation Link</button>
              )}
            </div>
          )}

          {mode==='send' && (
            <div>
              <label className="rx-label">Candidate email</label>
              <input className="rx-input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="candidate@email.com" />
              <label className="rx-label" style={{ marginTop:12 }}>CC <span style={{ color:C.faint, fontWeight:400 }}>— search employees to add to the email</span></label>
              {cc.length>0 && (
                <div style={{ display:'flex', flexWrap:'wrap' as const, gap:6, marginBottom:6 }}>
                  {cc.map(c=>(
                    <span key={c.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:C.brandTint, color:C.brandDeep, borderRadius:99, padding:'3px 6px 3px 10px', fontSize:11.5, fontWeight:600 }}>
                      {c.name}<button onClick={()=>setCc(cc.filter(x=>x.id!==c.id))} style={{ border:'none', background:'transparent', cursor:'pointer', color:C.brandDeep, fontSize:13, lineHeight:1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ position:'relative' }}>
                <input className="rx-input" value={ccQ} onChange={e=>setCcQ(e.target.value)} placeholder="Type a name or emp code…" />
                {ccHits.length>0 && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:5, background:C.surface, border:`1px solid ${C.line}`, borderRadius:8, marginTop:3, boxShadow:'0 8px 24px rgba(30,27,75,0.14)', maxHeight:220, overflowY:'auto' }}>
                    {ccHits.map((e:any)=>(
                      <button key={e.id} onClick={()=>{ setCc([...cc,{id:e.id,name:`${e.full_name} (${e.emp_code})`,email:empEmail(e)}]); setCcQ('') }}
                        style={{ display:'block', width:'100%', textAlign:'left' as const, padding:'8px 11px', border:'none', borderBottom:`1px solid ${C.line}`, background:C.surface, cursor:'pointer', fontFamily:'inherit', fontSize:12.5, color:C.ink }}>
                        {e.full_name} <span style={{ color:C.faint }}>· {e.emp_code} · {empEmail(e)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize:11, color:C.faint, margin:'10px 0' }}>Sends a secure upload link, valid 24 hours, for PAN, Aadhaar, bank statement, education, appointment/appraisal letters, 3 salary slips, Form 16 and a photo.</div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={send} disabled={sending} style={{ ...T.btnPrimary, flex:1, opacity:sending?.6:1 }}>{sending?'Sending…':'Send link'}</button>
                <button onClick={()=>setMode('main')} style={T.btnOutline}>Back</button>
              </div>
            </div>
          )}

          {mode==='status' && (
            <div>
              <div style={{ fontSize:12, color:C.faint, marginBottom:8 }}>
                {link?.status==='SUBMITTED' ? `Submitted on ${fmtDay(link.submitted_at)}` : active ? `Link active — ${timeLeft}h left (expires ${new Date(link.expires_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})})` : 'Link expired'}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' as const }}>
                <div style={{ fontSize:12, fontWeight:600 }}>Uploaded documents ({docs.length})</div>
                {docs.length>0 && (
                  <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11.5, color:C.faint, cursor:'pointer' }}>
                      <input type="checkbox" checked={selDocs.size===docs.length && docs.length>0} onChange={e=>setSelDocs(e.target.checked ? new Set(docs.map((d:any)=>d.id)) : new Set())} />
                      Select all
                    </label>
                    <button onClick={()=>onDownloadZip(selDocs.size?Array.from(selDocs):undefined)} disabled={zipping} style={{ ...T.btnPrimary, fontSize:11.5, opacity:zipping?.6:1 }}>
                      {zipping?'Zipping…':selDocs.size?`Download ${selDocs.size} as ZIP`:'Download all as ZIP'}
                    </button>
                  </div>
                )}
              </div>
              {docs.length===0 ? <div style={{ fontSize:12, color:C.faint }}>Nothing uploaded yet.</div> : (
                <div style={{ maxHeight:'46vh', overflowY:'auto' }}>
                  {docs.map((d:any)=>(
                    <div key={d.id||d.doc_type} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${C.line}`, fontSize:12.5 }}>
                      <input type="checkbox" checked={selDocs.has(d.id)} onChange={()=>toggleSel(d.id)} style={{ flexShrink:0 }} />
                      <div style={{ minWidth:0, flex:1 }}>
                        <div style={{ fontWeight:600 }}>{d.doc_label||d.doc_type}</div>
                        <div style={{ color:C.faint, fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.file_name}</div>
                      </div>
                      <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                        <button onClick={()=>onView(d)} disabled={busyDoc===d.id} style={{ ...T.btnOutline, padding:'5px 9px', fontSize:11 }}>View</button>
                        <button onClick={()=>onDownload(d)} disabled={busyDoc===d.id} style={{ ...T.btnOutline, padding:'5px 9px', fontSize:11 }}>Download</button>
                        <button onClick={()=>setRejecting(d)} disabled={busyDoc===d.id} style={{ padding:'5px 9px', fontSize:11, borderRadius:7, border:`1px solid ${C.criticalEdge}`, background:C.criticalTint, color:C.critical, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={()=>setMode('main')} style={{ ...T.btnOutline, marginTop:14 }}>Back</button>

              {/* Reject confirm */}
              {rejecting && (
                <div onMouseDown={e=>{ if(e.target===e.currentTarget && !busyDoc) setRejecting(null) }} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:210, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                  <div style={{ background:C.surface, borderRadius:14, width:'min(400px,100%)', padding:'18px 20px', boxShadow:'0 24px 70px rgba(30,27,75,0.3)' }}>
                    <div style={{ fontSize:15, fontWeight:700, color:C.ink, marginBottom:8 }}>Reject this document?</div>
                    <div style={{ fontSize:12.5, color:C.faint, marginBottom:18, lineHeight:1.5 }}>“{rejecting.doc_label||rejecting.doc_type}” will be removed and the upload link reopened for 24h. Resend the link so the candidate re-uploads only this document.</div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=>onReject(rejecting)} disabled={busyDoc===rejecting.id} style={{ ...T.btn, background:C.critical, color:C.onAccent, flex:1, opacity:busyDoc===rejecting.id?.6:1 }}>{busyDoc===rejecting.id?'Rejecting…':'Reject document'}</button>
                      <button onClick={()=>setRejecting(null)} disabled={busyDoc===rejecting.id} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* View popup */}
              {viewDoc && (
                <div onMouseDown={e=>{ if(e.target===e.currentTarget) setViewDoc(null) }} style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.6)', zIndex:220, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'20px 16px' }}>
                  <div style={{ background:C.surface, borderRadius:12, width:'min(900px,100%)', height:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 70px rgba(30,27,75,0.4)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${C.line}` }}>
                      <div style={{ fontSize:13, fontWeight:600, color:C.ink, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{viewDoc.name}</div>
                      <a href={viewDoc.url} target="_blank" rel="noreferrer" style={{ ...T.btnOutline, textDecoration:'none' }}>Open in new tab</a>
                      <button onClick={()=>setViewDoc(null)} style={T.btnOutline}>Close</button>
                    </div>
                    <iframe src={viewDoc.url} title={viewDoc.name} style={{ flex:1, width:'100%', border:'none', background:C.sunken }} />
                  </div>
                </div>
              )}
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}

function NegotiationTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify, employeeId, rail }:any) {
  // Offer Sent is intentionally excluded — once an offer goes out there's no more negotiation.
  // A revised offer moves the candidate back to 'Shortlisted', so they reappear here with the calculator.
  const finalCands = candidates.filter((c:Candidate)=>['Shortlisted'].includes(c.stage))
  const [subTab, setSubTab] = useState<'checks'|'ctc'>('checks')
  const [negQ, setNegQ] = useState('')
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  // Map candidate_id -> latest doc-collection link status ('ACTIVE' | 'SUBMITTED' | 'EXPIRED').
  const [docStatusMap, setDocStatusMap] = useState<Record<string,string>>({})
  useEffect(()=>{
    const ids = finalCands.map((c:Candidate)=>c.id)
    if (!ids.length) { setDocStatusMap({}); return }
    supabase.from('document_collection_links').select('candidate_id, status, created_at').in('candidate_id', ids).order('created_at',{ascending:false})
      .then(({data}:any)=>{
        const m:Record<string,string> = {}
        for (const r of data||[]) { if(!(r.candidate_id in m)) m[r.candidate_id]=r.status }
        setDocStatusMap(m)
      })
  },[candidates]) // eslint-disable-line react-hooks/exhaustive-deps
  const docsReceived = (c:Candidate) => docStatusMap[c.id]==='SUBMITTED'
  // Once documents are received, the candidate STAYS in Pre-negotiation Checks (with a
  // "Documents received" badge) rather than disappearing — the recruiter reviews them here.
  const checksCands = finalCands.filter((c:Candidate)=>!c.pre_negotiation_done || docsReceived(c))
  const ctcCands = finalCands.filter((c:Candidate)=>c.pre_negotiation_done)
  const activeList = subTab==='checks' ? checksCands : ctcCands
  const shownCands = activeList
    .filter((c:Candidate)=>!negQ || c.full_name.toLowerCase().includes(negQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))
  const [sel, setSel] = useState<Candidate|null>(null)
  const selMrf = mrfs.find((m:MRF)=>m.id===sel?.mrf_id)
  // The MRF's branch decides the minimum-wage state (e.g. Ahmedabad Branch → Gujarat).
  const mrfLocOf = (m:any) => (locations||[]).find((l:any)=>l.id===m?.location_id)
  const mrfStateOf = (m:any) => stateFromLocation(mrfLocOf(m))
  // Interns / contract / consultants etc. use the simple stipend calculator, not the full CTC one.
  const isStipend = !!sel && (selMrf?.employment_type||'Employee') !== 'Employee'
  // Inputs mirror the "Automated CTC Calculator Studio": state + worker category drive the
  // minimum-wage floor on Basic; variable is an absolute annual amount; gratuity and the
  // statutory bonus are rules that reshape the breakdown (see calculate()).
  const [form, setForm] = useState({ ctc:'', varAmt:'', joining_bonus:'', joining_freq:'With Salary', retention_bonus:'', retention_freq:'After 3 Months', esop:'', esop_plan:'', terms:'',
    state:DEFAULT_STATE, category:DEFAULT_CATEGORY as string, gratuity:'yes', bonusPct:'8.33', bonusMode:'salary' })
  // Current minimum-wage master (HR-maintained). The lib's defaults fill any state it lacks.
  const [mwRates, setMwRates] = useState<any[]>([])
  useEffect(()=>{
    supabase.from('minimum_wage_config').select('state, zone, category, basic_amount, vda_amount, total_minimum_wage, effective_from, notification_reference').is('effective_to', null)
      .order('state').then(({data}:any)=>setMwRates(data||[]))
  },[supabase])
  const [showMw, setShowMw] = useState(false)   // read-only minimum-wage table popup
  // Extra additional-amount rows the recruiter can add on top of CTC (amount + frequency + remark).
  const [addItems, setAddItems] = useState<{amount:string; freq:string; remark:string}[]>([])
  const ADD_FREQS = ['One-time','Monthly','Quarterly','Half-yearly','Yearly']
  const addRow = () => setAddItems(a=>[...a,{ amount:'', freq:'One-time', remark:'' }])
  const setRow = (i:number,k:'amount'|'freq'|'remark',v:string) => setAddItems(a=>a.map((r,idx)=>idx===i?{...r,[k]:v}:r))
  const delRow = (i:number) => setAddItems(a=>a.filter((_,idx)=>idx!==i))
  const cleanAddItems = () => addItems.map(r=>({ amount:Number(r.amount)||0, freq:r.freq, remark:r.remark.trim() })).filter(r=>r.amount>0)
  const [saving, setSaving] = useState(false)
  const [savedLink, setSavedLink] = useState<string|null>(null)
  const [loadedNeg, setLoadedNeg] = useState<any>(null)
  const [respMap, setRespMap] = useState<Record<string,string>>({})
  useEffect(()=>{
    supabase.from('ctc_negotiations').select('candidate_id, candidate_response, created_at').order('created_at',{ascending:false})
      .then(({data}:any)=>{
        const m:Record<string,string> = {}
        for (const r of data||[]) { if(!(r.candidate_id in m) && r.candidate_response) m[r.candidate_id]=r.candidate_response }
        setRespMap(m)
      })
  },[candidates])
  async function rejectCand(c:Candidate, e:React.MouseEvent) {
    e.stopPropagation()
    if (!window.confirm(`Move ${c.full_name} to Rejected? They'll leave the negotiation list.`)) return
    const { error } = await supabase.from('candidates').update({ stage:'Rejected' }).eq('id', c.id)
    if (error) { showNotify('Error: '+error.message,'error'); return }
    showNotify(`${c.full_name} moved to Rejected.`); if (sel?.id===c.id) setSel(null); onRefresh()
  }
  const [companyOverride, setCompanyOverride] = useState('')
  const autoCompany = sel?.company_id || selMrf?.company_id || (companies?.length===1 ? companies[0].id : '')
  const effCompany = autoCompany || companyOverride
  const F = (k:string,v:any) => setForm(f=>({...f,[k]:v}))

  // The offered CTC must sit INSIDE the MRF's approved budget range (min–max). Budgets are
  // stored per pay period, so annualise a monthly figure. All figures are in rupees.
  const annualise = (v:any) => (Number(v)||0) * (selMrf?.pay_period==='MONTHLY' ? 12 : 1)
  const mrfBudgetMax = annualise(selMrf?.budget_max)
  const mrfBudgetMin = annualise(selMrf?.budget_min)
  const ctcOverBudget = mrfBudgetMax>0 && form.ctc!=='' && Number(form.ctc) > mrfBudgetMax
  const ctcBelowBudget = mrfBudgetMin>0 && form.ctc!=='' && Number(form.ctc) < mrfBudgetMin
  const ctcOutOfRange = ctcOverBudget || ctcBelowBudget
  const lakh = (v:number) => `₹${(v/100000).toFixed(2)}L`
  const budgetRangeText = mrfBudgetMin>0 && mrfBudgetMax>0 ? `${lakh(mrfBudgetMin)} – ${lakh(mrfBudgetMax)}` : mrfBudgetMax>0 ? `up to ${lakh(mrfBudgetMax)}` : mrfBudgetMin>0 ? `from ${lakh(mrfBudgetMin)}` : ''

  // Minimum wage for the chosen state + worker category (HR master → default table).
  const mw = resolveMinWage(mwRates, form.state, form.category as any)

  // ── Automated CTC model — lives in lib/recruitment/ctc-model.ts (EPF ceiling ₹25,000,
  // ESIC on gross, statutory bonus on the Act's base, state PT/LWF). It runs LIVE: every
  // input change recomputes the statement, exactly like the reference calculator.
  const model = useMemo(()=>{
    const ctcAnnual = Number(form.ctc)
    if (!ctcAnnual) return null
    const loc = mrfLocOf(selMrf)
    return computeCtc({ ctcAnnual, variableAnnual:Number(form.varAmt)||0, minWage:mw.amount, state:form.state,
      gratuity:form.gratuity as 'yes'|'no', bonusPct:Number(form.bonusPct)||0, bonusMode:form.bonusMode as 'salary'|'ctc',
      hraMax: hraMaxFor([loc?.city, loc?.location_name].filter(Boolean).join(' ')) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[form.ctc, form.varAmt, form.state, form.gratuity, form.bonusPct, form.bonusMode, mw.amount, selMrf?.location_id])
  const calcError = model && !model.ok
    ? `Required minimum fixed CTC for ${form.state} (${form.category}) is ${inr(model.minReqFixedAnn)}/year (${inr(model.minReqFixedAnn/12)}/month) to satisfy basic wages (₹${Math.round(model.basic).toLocaleString('en-IN')}), PF/ESIC, gratuity and bonus rules. Given fixed CTC is ${inr(model.fixedAnnual)}/year.`
    : ''
  const calc = useMemo(()=>{
    if (!model || !model.ok) return null
    // Hike needs a believable current CTC (₹1,000 – ₹10 crore a year). Anything else is bad
    // data (the old LPA-unit bug stored ₹2,000 crore) and would print a meaningless −100%.
    const curCtc = Number(sel?.current_ctc)||0
    const hike = curCtc >= 1000 && curCtc <= 1e8 ? ((model.ctcAnnual-curCtc)/curCtc*100).toFixed(1) : null
    return { ...model, hike,
      minWage:mw.amount, minWageSource:mw.source, state:form.state, category:form.category,
      gratuity:form.gratuity, bonusPct:Number(form.bonusPct)||0, bonusMode:form.bonusMode,
      joining_bonus:Number(form.joining_bonus)||0, retention_bonus:Number(form.retention_bonus)||0, esop:Number(form.esop)||0,
      additional_items:cleanAddItems(), terms_conditions:(form.terms||'').trim()||null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[model, sel?.current_ctc, mw.amount, mw.source, form.category, form.joining_bonus, form.retention_bonus, form.esop, form.terms, addItems])
  const [pulse, setPulse] = useState(0)   // "Recalculate" re-animates the statement
  const recalc = () => setPulse(p=>p+1)

  // Load this candidate into the CTC calculator, pre-filling any saved negotiation.
  async function selectCtcCandidate(c:Candidate) {
    setSel(c); setSavedLink(null); setLoadedNeg(null); setAddItems([]); F('ctc','')
    // Worker category comes from the MRF (set beside its salary min/max) so the right minimum wage applies.
    const mrfCat = (mrfs.find((m:MRF)=>m.id===c.mrf_id) as any)?.wage_category || ''
    if (mrfCat) F('category', mrfCat)
    const mrfState = mrfStateOf(mrfs.find((m:MRF)=>m.id===c.mrf_id))
    if (mrfState) F('state', mrfState)
    const { data } = await supabase.from('ctc_negotiations').select('*')
      .eq('candidate_id', c.id).order('created_at',{ascending:false}).limit(1).maybeSingle()
    // First time (no saved negotiation): seed Annual CTC from the candidate's expected CTC.
    if (!data) { F('ctc', c.expected_ctc ? String(c.expected_ctc) : ''); return }
    setLoadedNeg(data)
    const savedAdd = Array.isArray(data.calculation_data?.additional_items) ? data.calculation_data.additional_items : []
    setAddItems(savedAdd.map((r:any)=>({ amount:String(r.amount||''), freq:r.freq||'One-time', remark:r.remark||'' })))
    setForm(f=>({ ...f,
      ctc:            data.offered_ctc!=null ? String(data.offered_ctc) : '',
      varAmt:         (()=>{ const cd=data.calculation_data||{}; const v = cd.variableAnnual ?? cd.variable ?? (data.offered_ctc!=null && data.variable_pct!=null ? Number(data.offered_ctc)*Number(data.variable_pct)/100 : null); return v!=null ? String(Math.round(Number(v))) : '' })(),
      category:       mrfCat || data.calculation_data?.category || DEFAULT_CATEGORY,
      gratuity:       data.calculation_data?.gratuity || 'yes',
      bonusPct:       data.calculation_data?.bonusPct!=null ? String(data.calculation_data.bonusPct) : '8.33',
      bonusMode:      data.calculation_data?.bonusMode || 'salary',
      joining_bonus:  data.joining_bonus ? String(data.joining_bonus) : '',
      joining_freq:   data.joining_bonus_freq || 'With Salary',
      retention_bonus:data.retention_bonus ? String(data.retention_bonus) : '',
      retention_freq: data.retention_bonus_freq || 'After 3 Months',
      esop:           data.esop_value ? String(data.esop_value) : '',
      esop_plan:      data.esop_remark || '',
      terms:          data.calculation_data?.terms_conditions || '',
      state:          mrfState || (()=>{ const st = data.calculation_data?.state; if (!st) return f.state || DEFAULT_STATE; return OLD_CODE_TO_STATE[st] || st })(),
    }))
    if (data.link_token) setSavedLink(`${window.location.origin}/salary-view/${data.link_token}`)
  }

  async function saveNegotiation() {
    if (!sel||!calc) return
    if (mrfBudgetMax>0 && Number(form.ctc) > mrfBudgetMax) { showNotify(`CTC ${lakh(Number(form.ctc))} exceeds the MRF budget of ${lakh(mrfBudgetMax)}. Reduce it before saving.`,'error'); return }
    if (mrfBudgetMin>0 && Number(form.ctc) < mrfBudgetMin) { showNotify(`CTC ${lakh(Number(form.ctc))} is below the MRF budget range (${budgetRangeText}). Raise it before saving.`,'error'); return }
    const companyId = effCompany || null
    if (!companyId) { showNotify('Select the company for this candidate first (dropdown in the calculator).','error'); return }
    if (!sel.company_id) await supabase.from('candidates').update({ company_id:companyId }).eq('id', sel.id)
    setSaving(true); setSavedLink(null)
    const { data, error } = await supabase.from('ctc_negotiations').upsert({
      candidate_id:sel.id, company_id:companyId, link_sent_at:new Date().toISOString(),
      offered_ctc:calc.ctcAnnual, variable_pct: calc.ctcAnnual>0 ? Math.round((Number(calc.variable)||0)/calc.ctcAnnual*10000)/100 : null,
      basic_monthly:Math.round(calc.basic), hra_monthly:Math.round(calc.hra),
      epf_monthly:Math.round(calc.epfEmployee), net_monthly:Math.round(calc.inHand),
      current_ctc:sel.current_ctc||null, hike_pct:calc.hike?Number(calc.hike):null,
      previous_company:sel.current_company||null,
      candidate_name:sel.full_name, position_title:sel.designation||null,
      calculation_data:calc,
      joining_bonus:calc.joining_bonus||0, joining_bonus_freq:form.joining_freq||null,
      retention_bonus:calc.retention_bonus||0, retention_bonus_freq:form.retention_freq||null,
      esop_value:calc.esop||0, esop_remark:form.esop_plan||null,
    }).select('link_token').single()
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message); return }
    setSavedLink(data?.link_token ? `${window.location.origin}/salary-view/${data.link_token}` : null)
    showNotify('Negotiation saved! Salary link ready 👇')
  }

  // Every statement line, in order — one source for the on-screen table, Excel and PDF.
  const statementRows = () => calc ? ctcStatementRows(calc, form) : []

  function downloadExcel() {
    if (!calc||!sel) return
    const rows:any[] = [['Component','Formula / basis','Monthly (₹)','Annual (₹)','Remark'],
      ['State / Category',`${calc.state} / ${calc.category}`,'','',`Minimum wage ₹${Math.round(calc.minWage||0)}/mo (${calc.minWageSource})`]]
    for (const r of statementRows()) rows.push(r.kind==='head' ? [r.label] : [r.label, r.basis||'', r.monthly!=null?Math.round(r.monthly):'', r.annual!=null?Math.round(r.annual):'', r.remark||''])
    rows.push([])
    rows.push(['Joining Bonus ('+form.joining_freq+')','','',calc.joining_bonus,'One-time'])
    rows.push(['Retention Bonus ('+form.retention_freq+')','','',calc.retention_bonus,'One-time'])
    rows.push(['ESOP','','',calc.esop,form.esop_plan||'As per grant letter'])
    for (const a of calc.additional_items||[]) rows.push(['Additional amount',a.remark||'','',a.amount,a.freq])
    if (calc.gratuity==='no') { rows.push([]); rows.push(['Note:','Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.']) }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'CTC Structure')
    XLSX.writeFile(wb,`CTC_${sel.full_name}.xlsx`)
  }

  // PDF: a clean print view of the statement in a new window (the browser's Save as PDF).
  function printPdf() {
    if (!calc||!sel) return
    const w = window.open('', '_blank', 'width=900,height=1000'); if (!w) { showNotify('Allow pop-ups to export the PDF','error'); return }
    const esc = (s:any)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const tr = statementRows().map(r => r.kind==='head'
      ? `<tr><td colspan="3" class="head">${esc(r.label)}</td></tr>`
      : `<tr class="${r.kind}"><td>${esc(r.label)}${r.basis?`<span class="b"> · ${esc(r.basis)}</span>`:''}</td><td class="n">${r.monthly!=null?inr(r.monthly):''}</td><td class="n">${r.annual!=null?inr(r.annual):''}</td></tr>`).join('')
    const extras = [
      calc.joining_bonus>0 ? `<tr><td>Joining Bonus <span class="b">(${esc(form.joining_freq)})</span></td><td></td><td class="n">${inr(calc.joining_bonus)}</td></tr>` : '',
      calc.retention_bonus>0 ? `<tr><td>Retention Bonus <span class="b">(${esc(form.retention_freq)})</span></td><td></td><td class="n">${inr(calc.retention_bonus)}</td></tr>` : '',
      calc.esop>0 ? `<tr><td>ESOP Grant Value <span class="b">${esc(form.esop_plan)}</span></td><td></td><td class="n">${inr(calc.esop)}</td></tr>` : '',
      ...(calc.additional_items||[]).map((a:any)=>`<tr><td>Additional amount <span class="b">(${esc(a.freq)}${a.remark?` · ${esc(a.remark)}`:''})</span></td><td></td><td class="n">${inr(a.amount)}</td></tr>`),
    ].join('')
    w.document.write(`<!doctype html><html><head><title>CTC Annexure — ${esc(sel.full_name)}</title><style>
      body{font-family:"DM Sans","Segoe UI",sans-serif;color:#1E1B4B;padding:28px;font-size:12px}
      h1{font-size:18px;margin:0 0 2px}.sub{color:#6B7280;font-size:11px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid #E9E7F5}.n{text-align:right;white-space:nowrap}
      th{font-size:10px;text-transform:uppercase;color:#6B7280;text-align:left;padding:6px 8px;background:#F5F3FF}th.n{text-align:right}
      .head td{padding-top:14px;font-weight:700;font-size:11px;color:#6B7280;border:none}
      .b{color:#9CA3AF;font-size:10px}.total td{background:#7C3AED;color:#fff;font-weight:700}.sum td{background:#F5F3FF;font-weight:700}
      .net td{background:#059669;color:#fff;font-weight:700}.ded td{color:#DC2626}.emp td{color:#6D28D9}.grat td{color:#059669}.bonus td{color:#2563EB}.muted td{color:#9CA3AF}
      .note{margin-top:12px;font-size:11px;color:#2563EB;background:#EFF6FF;padding:8px 10px;border-radius:8px}
      @media print{body{padding:0}}
    </style></head><body>
      <h1>Salary Breakdown Statement — ${esc(sel.full_name)}</h1>
      <div class="sub">${esc(sel.designation||selMrf?.designation||'')}${selMrf?.mrf_number?` · MRF ${esc(selMrf.mrf_number)}`:''} · ${esc(calc.state)} · ${esc(calc.category)} · Minimum wage ₹${Math.round(calc.minWage||0).toLocaleString('en-IN')}/mo · EPF ceiling ₹${Number(calc.epfCeiling||EPF_WAGE_CEILING).toLocaleString('en-IN')}</div>
      <table><thead><tr><th>Component</th><th class="n">Monthly (₹)</th><th class="n">Annual (₹)</th></tr></thead><tbody>${tr}
      ${extras?`<tr><td colspan="3" class="head">One-time payments &amp; additional amounts</td></tr>${extras}`:''}</tbody></table>
      ${calc.gratuity==='no'?'<div class="note"><b>Note:</b> Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.</div>':''}
      ${calc.terms_conditions?`<div class="note" style="color:#1E1B4B;background:#F7F6FD"><b>Terms &amp; conditions:</b> ${esc(calc.terms_conditions)}</div>`:''}
      <div class="sub" style="margin-top:12px">Net in-hand is before income tax (TDS). Generated by EZER HRMS on ${new Date().toLocaleDateString('en-IN')}.</div>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  // The calculator panel is open for a regular employee → the candidate column narrows and
  // the panel slides in from the right (grid-template-columns is animatable in Chromium/Firefox).
  const calcOpen = subTab==='ctc' && !!sel && !isStipend
  const compact = calcOpen
  const [showFilters, setShowFilters] = useState(false)
  // The one-time payments / T&C / additional amounts fold away so the inputs card stays
  // short; the summary line says what is inside while it is closed.
  const [extrasOpen, setExtrasOpen] = useState(false)
  const extrasSummary = (()=>{
    const bits:string[] = []
    if (Number(form.joining_bonus)>0) bits.push(`Joining ${lakh(Number(form.joining_bonus))}`)
    if (Number(form.retention_bonus)>0) bits.push(`Retention ${lakh(Number(form.retention_bonus))}`)
    if (Number(form.esop)>0) bits.push(`ESOP ${lakh(Number(form.esop))}`)
    const n = addItems.filter(r=>Number(r.amount)>0).length
    if (n) bits.push(`${n} additional`)
    if ((form.terms||'').trim()) bits.push('T&C')
    return bits.length ? bits.join(' · ') : 'none yet — joining / retention / ESOP / T&C / additional'
  })()
  const ceilingNote = `EPF ceiling ₹${EPF_WAGE_CEILING.toLocaleString('en-IN')} • Gratuity • Statutory bonus • Pan-India minimum wages`

  // Negotiation was the one tab of eleven that destructured `rail` and then
  // never rendered it, so opening Negotiation FROM the rail made the rail
  // itself vanish — no route back to Dashboard/MRF/Pipeline short of the
  // browser's Back button. Every sibling renders it: six via RxPage, MRF and
  // Pipeline via their View components. This tab is a "WRAP" (see the switch
  // at ~438) whose frame was never added, so the omission was structural and
  // silent rather than a regression — it shipped broken.
  //
  // The body below deliberately keeps its original indentation. Re-indenting
  // ~300 lines one level deeper would bury a two-line structural fix under a
  // 300-line whitespace diff, and JSX does not care about indentation.
  return (
    <RxPage header={
      <RecruitmentHeader
        title="CTC negotiation"
        subtitle="Clear the pre-negotiation checks, build the CTC against the MRF budget and the state minimum wage, then send a salary link the candidate can accept or decline."
      />}>
    <div style={{ display:'grid', gridTemplateColumns: compact ? 'minmax(200px, 250px) minmax(0, 1fr)' : '1fr 1fr', gap:12, alignItems:'start', transition:'grid-template-columns .45s cubic-bezier(.4,0,.2,1)' }}>
      {/* ── Candidate column — full cards normally, compact list while the calculator is open ── */}
      <div style={{ minWidth:0 }}>
        <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' as const }}>
          <button onClick={()=>{ setSubTab('checks'); setSel(null) }} style={{ ...T.btnOutline, ...(compact?{ padding:'5px 9px', fontSize:11 }:{}), ...(subTab==='checks'?{ background:C.brand, color:C.onAccent, borderColor:C.brand }:{}) }}>{compact?'Checks':'Pre-negotiation Checks'} ({checksCands.length})</button>
          <button onClick={()=>{ setSubTab('ctc'); setSel(null) }} style={{ ...T.btnOutline, ...(compact?{ padding:'5px 9px', fontSize:11 }:{}), ...(subTab==='ctc'?{ background:C.brand, color:C.onAccent, borderColor:C.brand }:{}) }}>{compact?'CTC':'CTC Negotiations'} ({ctcCands.length})</button>
        </div>
        <SearchBar placeholder="Search candidate…" onApply={setNegQ} width={compact?200:240} />
        {compact
          ? <button onClick={()=>setShowFilters(s=>!s)} style={{ ...T.btnOutline, padding:'4px 10px', fontSize:11, marginBottom:8 }}>{showFilters?'Hide filters ▴':'Filters ▾'}</button>
          : null}
        {(!compact || showFilters) && <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />}
        {shownCands.map((c:Candidate)=>{
          const on = sel?.id===c.id
          const mn = mrfs.find((m:MRF)=>m.id===c.mrf_id)?.mrf_number
          return (
            <div key={c.id} onClick={()=>{ if(subTab==='ctc'){ selectCtcCandidate(c) } else { setSel(c) } }}
              style={{ ...T.card, cursor:'pointer', padding: compact ? '9px 11px' : T.card.padding, marginBottom: compact ? 6 : T.card.marginBottom,
                border:on?`2px solid ${C.brand}`:'1px solid var(--ez-line)', background:on?C.brandTint: C.surface, transition:'padding .3s, background .2s' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:compact?12.5:13, fontWeight:600, color:C.ink, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{c.full_name}</div>
                  {!compact && <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L exp':'—'}{mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null}</div>}
                </div>
                {subTab==='ctc' && (
                  <button onClick={(e)=>rejectCand(c,e)} title="Move to Rejected" style={{ padding: compact?'2px 7px':'4px 10px', borderRadius:7, border: `1px solid ${C.criticalTint}`, cursor:'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit', background:C.criticalTint, color:C.critical, flexShrink:0 }}>{compact?'✕':'Reject'}</button>
                )}
              </div>
              <div style={{ marginTop:compact?4:6, display:'flex', gap:5, flexWrap:'wrap' as const, alignItems:'center' }}>
                {compact && mn && <span style={{ fontSize:9.5, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 6px', borderRadius:99, whiteSpace:'nowrap' as const }}>{mn}</span>}
                {!compact && <Badge text={c.stage} />}
                {subTab==='checks' && docStatusMap[c.id]==='SUBMITTED' && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 10px', borderRadius:99, fontSize:10.5, fontWeight:700, background:C.positiveTint, color:C.positive }}>✓ Documents received</span>
                )}
                {subTab==='checks' && docStatusMap[c.id]==='ACTIVE' && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 10px', borderRadius:99, fontSize:10.5, fontWeight:700, background:C.infoTint, color:C.info }}>Link sent</span>
                )}
                {subTab==='ctc' && respMap[c.id]==='ACCEPTED' && <Badge text="Offer Accepted" />}
                {subTab==='ctc' && respMap[c.id]==='REJECTED' && <Badge text="Offer Rejected" />}
                {c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}
              </div>
            </div>
          )
        })}
        {shownCands.length===0&&<div style={{ ...T.card, color:C.faint, fontSize:13, textAlign:'center' as const, padding:24 }}>{negQ?'No matching candidate':(subTab==='checks'?'No candidates awaiting pre-negotiation checks':'No candidates ready for CTC negotiation')}</div>}
      </div>

      {subTab==='checks'&&sel&&(
        <CtcDocLink candidate={sel} mrf={selMrf} companyId={effCompany} supabase={supabase} showNotify={showNotify}
          onClose={()=>setSel(null)} onRefresh={onRefresh} />
      )}

      {subTab==='ctc'&&sel&&isStipend&&<StipendCalc sel={sel} mrf={selMrf} companies={companies} supabase={supabase} showNotify={showNotify} onRefresh={onRefresh} mwRates={mwRates} locations={locations} />}

      {/* ── Automated CTC Calculator — slides in; inputs (5) | statement (7), like the reference studio ── */}
      {calcOpen&&sel&&(
        <div key={sel.id} style={{ minWidth:0, animation:'ezSlideInRight .45s cubic-bezier(.4,0,.2,1)' }}>
          {/* header strip */}
          <div style={{ ...T.card, display:'flex', alignItems:'center', gap:12, padding:'12px 16px', marginBottom:12, position:'sticky', top:0, zIndex:31 }}>
            <div style={{ width:40, height:40, borderRadius:12, background:C.brand, color:C.onAccent, display:'grid', placeItems:'center', fontSize:17, fontWeight:800, flexShrink:0, boxShadow:'0 8px 20px rgba(124,58,237,.30)' }}>₹</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700, color:C.ink, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' as const }}>
                Automated CTC Calculator <span style={{ color:C.faint, fontWeight:500 }}>—</span> {sel.full_name}
                {selMrf?.mrf_number && <span style={{ fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, whiteSpace:'nowrap' as const }}>{selMrf.mrf_number}</span>}
                {loadedNeg?.candidate_response && (
                  <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 9px', borderRadius:99, background: loadedNeg.candidate_response==='ACCEPTED'?C.positiveTint:C.criticalTint, color: loadedNeg.candidate_response==='ACCEPTED'?C.positive:C.critical }}>
                    {loadedNeg.candidate_response==='ACCEPTED'?'Candidate accepted':'Candidate rejected'}{loadedNeg.response_note?` — “${loadedNeg.response_note}”`:''}
                  </span>
                )}
              </div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{ceilingNote}</div>
            </div>
            <button onClick={()=>setSel(null)} style={T.btnOutline}>Close</button>
          </div>

          {/* minmax(0,…), not minmax(300px,…)/minmax(360px,…). Those floors sum
              to 672px plus the gap, and with the rail and page padding the
              calculator has less than that at 1440px — so the right track held
              its 360px and pushed the document to 1544px, a 104px horizontal
              overhang, measured. A grid track containing wide content needs a
              zero minimum or it cannot honour its container. The fr ratios are
              untouched, so nothing moves at widths where the room exists. */}
          <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 5fr) minmax(0, 7fr)', gap:12, alignItems:'start' }}>
            {/* ── Inputs & Rules Selection ── compact: two fields per row, the extras folded away ── */}
            <div style={{ ...T.cardPurple, padding:'12px 14px' }}>
              <div style={{ ...T.section, borderBottom:`1px solid ${C.brandEdge}`, paddingBottom:8, marginBottom:10 }}>Inputs &amp; Rules Selection</div>
              {!autoCompany && (
                <div style={{ marginBottom:10, padding:'8px 12px', background:C.warningTint, border: `1px solid ${C.warningTint}`, borderRadius:10 }}>
                  <label className="rx-label">Company * <span style={{ color:C.warning, fontWeight:400 }}>— not set on this candidate, please choose</span></label>
                  <select className="rx-input" value={companyOverride} onChange={e=>setCompanyOverride(e.target.value)}>
                    <option value="">Select company…</option>
                    {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                <div><label className="rx-label">State / UT</label>
                  <select className="rx-input" value={form.state} onChange={e=>F('state',e.target.value)} disabled={!!mrfStateOf(selMrf)}>
                    {MIN_WAGE_STATES.map(st=><option key={st} value={st}>{st}</option>)}
                  </select>
                  <div style={{ fontSize:10, color:mrfStateOf(selMrf)?C.positive:C.faint, marginTop:2, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{mrfStateOf(selMrf) ? `From MRF branch: ${mrfLocOf(selMrf)?.location_name||'branch'}` : 'No branch on the MRF — choose'}</div>
                </div>
                <div><label className="rx-label">Worker Category</label>
                  <select className="rx-input" value={form.category} onChange={e=>F('category',e.target.value)} disabled={!!(selMrf as any)?.wage_category}>
                    {WAGE_CATS.map(ct=><option key={ct} value={ct}>{ct}</option>)}
                  </select>
                  <div style={{ fontSize:10, color:(selMrf as any)?.wage_category?C.positive:C.faint, marginTop:2 }}>{(selMrf as any)?.wage_category ? 'From the MRF' : 'Not set on the MRF — choose'}</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:6 }}>
                <div><label className="rx-label">Total CTC (Annual ₹) *</label>
                  <input className="rx-input" style={{ fontWeight:700, ...(ctcOutOfRange?{ borderColor:C.critical }:{}) }} type="number" value={form.ctc} onChange={e=>F('ctc',e.target.value)} placeholder={mrfBudgetMin>0?String(mrfBudgetMin):"600000"} />
                  {budgetRangeText && (
                    ctcOverBudget
                      ? <div style={{ fontSize:10, color:C.critical, marginTop:2, fontWeight:600 }}>Above the MRF budget range ({budgetRangeText}) — reduce to {lakh(mrfBudgetMax)} or less</div>
                      : ctcBelowBudget
                      ? <div style={{ fontSize:10, color:C.critical, marginTop:2, fontWeight:600 }}>Below the MRF budget range ({budgetRangeText}) — must be at least {lakh(mrfBudgetMin)}</div>
                      : <div style={{ fontSize:10, color: form.ctc!=='' ? C.positive : C.faint, marginTop:2 }}>{form.ctc!=='' ? '✓ Within ' : ''}MRF budget range: {budgetRangeText}</div>
                  )}
                </div>
                <div><label className="rx-label">Variable CTC (Annual ₹)</label><input className="rx-input" style={{ fontWeight:700 }} type="number" value={form.varAmt} onChange={e=>F('varAmt',e.target.value)} placeholder="0" /></div>
              </div>
              <div style={{ fontSize:10.5, color:C.faint, margin:'2px 0 10px', lineHeight:1.5 }}>
                Min wage · {form.state} · {form.category}: <b style={{ color:C.ink }}>₹{Math.round(mw.amount).toLocaleString('en-IN')}/mo</b>
                <span style={{ marginLeft:6, fontSize:9.5, padding:'1px 7px', borderRadius:99, background:mw.source==='master'?C.positiveTint:C.sunken, color:mw.source==='master'?C.positive:C.faint }}>{mw.source==='master'?'HR master':mw.source==='default'?'default table':'fallback'}</span>
                {' '}— Basic = higher of 50% of fixed CTC and this floor.
              </div>

              <div style={{ ...T.section, borderTop:`1px solid ${C.brandEdge}`, paddingTop:10, marginBottom:8 }}>Statutory &amp; Benefit Rules</div>
              <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr', gap:8, marginBottom:10 }}>
                <div><label className="rx-label">Gratuity in CTC?</label>
                  <select className="rx-input" value={form.gratuity} onChange={e=>F('gratuity',e.target.value)}>
                    <option value="yes">Yes (4.81% of Basic)</option>
                    <option value="no">No (Over and above)</option>
                  </select>
                </div>
                <div><label className="rx-label">Bonus Rate</label>
                  <select className="rx-input" value={form.bonusPct} onChange={e=>F('bonusPct',e.target.value)}>
                    <option value="8.33">8.33% (Min)</option>
                    <option value="20">20% (Max)</option>
                    <option value="0">0% (N/A)</option>
                  </select>
                </div>
                <div><label className="rx-label">Bonus Mode</label>
                  <select className="rx-input" value={form.bonusMode} onChange={e=>F('bonusMode',e.target.value)}>
                    <option value="salary">With Salary</option>
                    <option value="ctc">Only in CTC</option>
                  </select>
                </div>
              </div>
              <button onClick={recalc} style={{ ...T.btnPrimary, width:'100%', padding:'9px', fontSize:12.5, marginBottom:12, boxShadow:'0 6px 16px rgba(124,58,237,.25)' }}>Recalculate Breakdown</button>

              {/* One-time payments, T&C and additional amounts — folded, with a summary line */}
              <details open={extrasOpen} onToggle={e=>setExtrasOpen((e.target as HTMLDetailsElement).open)} style={{ border:`1px solid ${C.brandEdge}`, borderRadius:10, background:C.sunken, marginBottom:12 }}>
                <summary style={{ listStyle:'none', cursor:'pointer', padding:'9px 12px', display:'flex', alignItems:'center', gap:8, userSelect:'none' as const }}>
                  <span style={{ display:'inline-block', transform: extrasOpen?'rotate(90deg)':'none', transition:'transform .2s', color:C.brand, fontSize:11 }}>▶</span>
                  <span style={{ ...T.section, marginBottom:0, marginTop:0 }}>One-time payments &amp; extras</span>
                  <span style={{ marginLeft:'auto', fontSize:10.5, color:C.faint, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{extrasSummary}</span>
                </summary>
                <div style={{ padding:'4px 12px 12px', borderTop:`1px solid ${C.brandEdge}` }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:8, marginTop:8 }}>
                    <div><label className="rx-label">Joining Bonus (₹)</label><input className="rx-input" type="number" value={form.joining_bonus} onChange={e=>F('joining_bonus',e.target.value)} placeholder="100000" /></div>
                    <div><label className="rx-label">Paid</label>
                      <select className="rx-input" style={{ opacity: Number(form.joining_bonus)>0 ? 1 : .45, cursor: Number(form.joining_bonus)>0 ? 'pointer' : 'not-allowed' }} disabled={!(Number(form.joining_bonus)>0)} value={form.joining_freq} onChange={e=>F('joining_freq',e.target.value)}>
                        <option>With Salary</option><option>After 3 Months</option><option>After 6 Months</option><option>As per Policy</option>
                      </select>
                    </div>
                    <div><label className="rx-label">Retention Bonus (₹)</label><input className="rx-input" type="number" value={form.retention_bonus} onChange={e=>F('retention_bonus',e.target.value)} placeholder="200000" /></div>
                    <div><label className="rx-label">Paid</label>
                      <select className="rx-input" style={{ opacity: Number(form.retention_bonus)>0 ? 1 : .45, cursor: Number(form.retention_bonus)>0 ? 'pointer' : 'not-allowed' }} disabled={!(Number(form.retention_bonus)>0)} value={form.retention_freq} onChange={e=>F('retention_freq',e.target.value)}>
                        <option>After 3 Months</option><option>After 6 Months</option><option>After 1 Year</option><option>As per Policy</option>
                      </select>
                    </div>
                    <div><label className="rx-label">ESOP (₹ Grant Value)</label><input className="rx-input" type="number" value={form.esop} onChange={e=>F('esop',e.target.value)} placeholder="2000000" /></div>
                    <div><label className="rx-label">ESOP Plan / Vesting</label><input className="rx-input" value={form.esop_plan} onChange={e=>F('esop_plan',e.target.value)} placeholder="4 yr, 1 yr cliff" /></div>
                  </div>
                  <div style={{ marginTop:8 }}>
                    <label className="rx-label">Terms &amp; Conditions <span style={{ color:C.faint, fontWeight:400, textTransform:'none' as const, letterSpacing:0 }}>— shown on the salary link</span></label>
                    <textarea className="rx-input" style={{ minHeight:52 }} value={form.terms} onChange={e=>F('terms',e.target.value)} placeholder="e.g. Joining bonus is recoverable if the employee leaves within 12 months…" />
                  </div>
                  {/* Additional Amounts — add as many as needed (amount + frequency + remark) */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:10, marginBottom:6 }}>
                    <div style={{ ...T.section, marginBottom:0, marginTop:0 }}>Additional Amounts</div>
                    <button onClick={addRow} style={{ ...T.btnOutline, padding:'4px 10px', fontSize:11.5, whiteSpace:'nowrap' as const }}>+ Add</button>
                  </div>
                  {addItems.length===0 && <div style={{ fontSize:10.5, color:C.faint }}>Optional — e.g. a monthly allowance or a quarterly incentive.</div>}
                  {addItems.map((r,i)=>(
                    <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1.4fr auto', gap:6, alignItems:'end', marginBottom:6, animation:'ezFadeUp .25s ease' }}>
                      <div><label className="rx-label">Amount (₹)</label><input className="rx-input" type="number" value={r.amount} onChange={e=>setRow(i,'amount',e.target.value)} placeholder="5000" /></div>
                      <div><label className="rx-label">Frequency</label>
                        <select className="rx-input" value={r.freq} onChange={e=>setRow(i,'freq',e.target.value)}>{ADD_FREQS.map(o=><option key={o}>{o}</option>)}</select>
                      </div>
                      <div><label className="rx-label">Remark</label><input className="rx-input" value={r.remark} onChange={e=>setRow(i,'remark',e.target.value)} placeholder="Optional note" /></div>
                      <button onClick={()=>delRow(i)} title="Remove" style={{ padding:'8px 10px', borderRadius:7, border:`1px solid ${C.criticalEdge}`, background:C.criticalTint, color:C.critical, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700 }}>✕</button>
                    </div>
                  ))}
                </div>
              </details>

              {/* Candidate salary link — save the negotiation, then share */}
              <div style={{ borderTop:`1px solid ${C.brandEdge}`, paddingTop:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <div style={{ ...T.section, color:C.positive, marginBottom:0, marginTop:0 }}>Candidate salary link</div>
                  <span style={{ fontSize:10.5, color:C.faint }}>— breakup + one-time payments only, valid 7 days</span>
                </div>
                <button onClick={saveNegotiation} disabled={saving||!calc||ctcOutOfRange} style={{ ...T.btnPrimary, width:'100%', padding:'9px', fontSize:12.5, background:C.positive, opacity:(saving||!calc||ctcOutOfRange)?.6:1, cursor:(saving||!calc||ctcOutOfRange)?'not-allowed':'pointer', boxShadow:'0 6px 16px rgba(5,150,105,.25)' }}>
                  {saving?'Saving…':ctcOverBudget?'CTC exceeds MRF budget':ctcBelowBudget?'CTC below MRF budget':!calc?'Enter a valid CTC first':'Save Negotiation & Generate Link'}
                </button>
                {savedLink&&(
                  <div style={{ marginTop:8, background:C.positiveTint, border:`1px solid ${C.positiveEdge}`, borderRadius:10, padding:'8px 10px', animation:'ezFadeUp .3s ease' }}>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <input readOnly value={savedLink} onFocus={e=>e.target.select()} className="rx-input" style={{ fontSize:10.5, fontFamily:'monospace', flex:1, padding:'7px 9px' }} />
                      <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btnOutline, background:C.surface, borderColor:C.positive, color:C.positive, fontWeight:700, padding:'6px 10px', fontSize:11.5 }}>Copy</button>
                      <a href={savedLink} target="_blank" rel="noopener noreferrer" style={{ ...T.btn, background:C.positive, color:C.onAccent, textDecoration:'none', padding:'6px 10px', fontSize:11.5 }}>Open ↗</a>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Salary Breakdown Statement ── */}
            <div style={{ ...T.card, position:'sticky', top:64 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, borderBottom:`1px solid ${C.brandEdge}`, paddingBottom:10, marginBottom:10 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>Salary Breakdown Statement</div>
                  <div style={{ fontSize:10.5, color:C.faint, marginTop:2 }}>Compliant with statutory minimum wage ({form.state} · {form.category}: ₹{Math.round(mw.amount).toLocaleString('en-IN')}/mo) &amp; EPFO regulations</div>
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={()=>setShowMw(true)} style={{ ...T.btnOutline, background:C.brandTint, borderColor:C.brandEdge, color:C.brandDeep, fontWeight:700, fontSize:11.5 }}>Min wages</button>
                  <button onClick={downloadExcel} disabled={!calc} style={{ ...T.btnOutline, background:C.positiveTint, borderColor:C.positiveEdge, color:C.positive, fontWeight:700, fontSize:11.5, opacity:calc?1:.5 }}>Excel</button>
                  <button onClick={printPdf} disabled={!calc} style={{ ...T.btnOutline, background:C.criticalTint, borderColor:C.criticalEdge, color:C.critical, fontWeight:700, fontSize:11.5, opacity:calc?1:.5 }}>PDF</button>
                </div>
                {showMw && <MinWagesPopup rates={mwRates} state={form.state} category={form.category} onClose={()=>setShowMw(false)} />}
              </div>

              {calcError&&(
                <div style={{ background:C.criticalTint, border:`1px solid ${C.criticalEdge}`, color:C.critical, fontSize:12, lineHeight:1.6, borderRadius:10, padding:'10px 12px', marginBottom:10 }}>
                  <b>Given CTC is too low!</b> {calcError}
                </div>
              )}
              {!model && (
                <div style={{ padding:'28px 12px', textAlign:'center' as const, color:C.faint, fontSize:12.5 }}>Enter the Total CTC to see the live breakdown.</div>
              )}

              {calc&&(
                <div key={pulse} style={{ animation:'ezFadeUp .3s ease' }}>
                  <CtcStatementTable rows={statementRows()} />

                  {calc.gratuity==='no'&&(
                    <div style={{ marginTop:10, background:C.infoTint, border:`1px solid ${C.infoEdge}`, borderRadius:10, padding:'9px 13px', fontSize:12, color:C.info, lineHeight:1.5 }}>
                      <b>Note:</b> Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.
                    </div>
                  )}

                  {/* One-time Payments */}
                  {(calc.joining_bonus>0||calc.retention_bonus>0||calc.esop>0)&&(
                    <div style={{ marginTop:12 }}>
                      <div style={T.section}>One-time Payments</div>
                      {calc.joining_bonus>0&&(
                        <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom: `1px solid ${C.brandEdge}`, fontSize:12 }}>
                          <span>Joining Bonus <span style={{ fontSize:10, color:C.faint }}>({form.joining_freq})</span></span>
                          <span style={{ fontWeight:600, color:C.positive }}>₹{calc.joining_bonus.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      {calc.retention_bonus>0&&(
                        <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom: `1px solid ${C.brandEdge}`, fontSize:12 }}>
                          <span>Retention Bonus <span style={{ fontSize:10, color:C.faint }}>({form.retention_freq})</span></span>
                          <span style={{ fontWeight:600, color:C.positive }}>₹{calc.retention_bonus.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      {calc.esop>0&&(
                        <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', fontSize:12 }}>
                          <span>ESOP Grant Value <span style={{ fontSize:10, color:C.faint }}>{form.esop_plan&&`(${form.esop_plan})`}</span></span>
                          <span style={{ fontWeight:600, color:C.brand }}>₹{calc.esop.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      {calc.terms_conditions && <div style={{ fontSize:11, color:C.muted, padding:'6px 10px', lineHeight:1.5 }}><b style={{ color:C.ink }}>T&amp;C:</b> {calc.terms_conditions}</div>}
                    </div>
                  )}

                  {/* Additional Amounts */}
                  {Array.isArray(calc.additional_items)&&calc.additional_items.length>0&&(
                    <div style={{ marginTop:12 }}>
                      <div style={T.section}>Additional Amounts</div>
                      {calc.additional_items.map((r:any,i:number)=>(
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:`1px solid ${C.brandEdge}`, fontSize:12 }}>
                          <span>Additional <span style={{ fontSize:10, color:C.faint }}>({r.freq}{r.remark?` · ${r.remark}`:''})</span></span>
                          <span style={{ fontWeight:600, color:C.positive }}>₹{Number(r.amount).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {calc.hike&&(
                    <div style={{ marginTop:12, background:C.positiveTint, borderRadius:10, padding:'10px 14px', display:'flex', gap:16, flexWrap:'wrap' as const }}>
                      <span style={{ fontSize:13, color:C.positive, fontWeight:600 }}>Hike: {calc.hike}%</span>
                      <span style={{ fontSize:12, color:C.inkSoft }}>Current: ₹{((sel?.current_ctc||0)/100000).toFixed(1)}L → Offered: ₹{(calc.ctcAnnual/100000).toFixed(1)}L</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </RxPage>
  )
}

// Module-scope (never re-mounts) — the statement table, themed like the reference studio.
function CtcStatementTable({ rows }:{ rows:StmtRow[] }) {
  const cell:React.CSSProperties = { padding:'6px 10px', fontSize:12 }
  const num:React.CSSProperties = { ...cell, textAlign:'right' as const, whiteSpace:'nowrap' as const, fontVariantNumeric:'tabular-nums' }
  const tone:Record<string,{ color?:string; bg?:string; weight?:number }> = {
    row:{}, sum:{ bg:C.sunken, weight:700 }, emp:{ color:C.brandDeep }, grat:{ color:C.positive }, bonus:{ color:C.info },
    muted:{ color:C.faint }, total:{ bg:C.brand, color:C.onAccent, weight:700 }, ded:{ color:C.critical }, net:{ bg:C.positive, color:C.onAccent, weight:700 },
  }
  // The ₹ columns are nowrap and cannot shrink, so once the grid track above
  // was allowed a zero minimum this table became the thing that would overflow.
  // A table is permitted to be wider than the page — but inside its own
  // scroller, not by dragging the whole document sideways. Comment sits above
  // the return: a JSX comment after `return (` parses as an empty object
  // literal and breaks the file.
  return (
    <div style={{ overflowX:'auto' }}>
    <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:0 }}>
      <thead>
        <tr style={{ background:C.sunken }}>
          <th style={{ ...cell, textAlign:'left' as const, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700, borderRadius:'8px 0 0 8px' }}>Component</th>
          <th style={{ ...num, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700 }}>Monthly (₹)</th>
          <th style={{ ...num, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700, borderRadius:'0 8px 8px 0' }}>Annual (₹)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r,i)=>{
          if (r.kind==='head') return <tr key={i}><td colSpan={3} style={{ ...cell, paddingTop:16, paddingBottom:4, fontSize:11, fontWeight:700, color:C.muted }}>{r.label}</td></tr>
          if (r.kind==='note') return <tr key={i}><td colSpan={3} style={{ ...cell, fontSize:10, color:C.faint, lineHeight:1.5 }}>{r.label}</td></tr>
          const t = tone[r.kind]||{}
          const big = r.kind==='total'||r.kind==='net'
          const base:React.CSSProperties = { background:t.bg, color:t.color||C.ink, fontWeight:t.weight||500, borderBottom: t.bg?'none':`1px solid ${C.brandEdge}` }
          const nil = (r.monthly||0)===0 && (r.kind==='emp'||r.kind==='ded')
          return (
            <tr key={i}>
              <td style={{ ...cell, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?13:12, borderRadius: t.bg?'10px 0 0 10px':0 }}>
                {r.label}{r.basis && <span style={{ fontSize:10, color: t.bg&&t.color===C.onAccent ? 'rgba(255,255,255,.75)' : C.faint, fontWeight:400, marginLeft:6 }}>· {r.basis}</span>}
              </td>
              <td style={{ ...num, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?13:12, opacity: nil?.55:1 }}>{nil?'Nil':`₹${Math.round(r.monthly||0).toLocaleString('en-IN')}`}</td>
              <td style={{ ...num, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?14:12, borderRadius: t.bg?'0 10px 10px 0':0, opacity: nil?.55:1 }}>{nil?'Nil':`₹${Math.round(r.annual||0).toLocaleString('en-IN')}`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </div>
  )
}

// ── OFFERS TAB ────────────────────────────────────────────────────
// ── OFFER APPROVAL TAB (Recruiter → HR Head) ──────────────────────
function OfferApprovalTab({ supabase, companies, departments, locations, candidates, mrfs, onRefresh, rail }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
  // Request-status filter (05 #11). In memory only — no query changes.
  const [oaStatus, setOaStatus] = useState<string>('*')
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const [neg, setNeg] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set())
  // #9 — existing offer-approval requests, so we can block re-create and show status.
  const [reqMap, setReqMap] = useState<Map<string,{status:string;submitted_at:string}>>(new Map())
  useEffect(()=>{
    supabase.from('ctc_negotiations').select('candidate_id, candidate_response, created_at').order('created_at',{ascending:false})
      .then(({data}:any)=>{
        const latest = new Map<string,string>()
        for (const r of data||[]) { if(!latest.has(r.candidate_id)) latest.set(r.candidate_id, r.candidate_response) }
        const acc = new Set<string>(); latest.forEach((resp,cid)=>{ if(resp==='ACCEPTED') acc.add(cid) })
        setAcceptedIds(acc)
      })
    supabase.from('offer_approval_requests').select('candidate_id, status, submitted_at').order('submitted_at',{ascending:false})
      .then(({data}:any)=>{
        const m = new Map<string,{status:string;submitted_at:string}>()
        for (const r of data||[]) { if(r.candidate_id && !m.has(r.candidate_id)) m.set(r.candidate_id, { status:r.status, submitted_at:r.submitted_at }) }
        setReqMap(m)
      })
  },[candidates])
  // A request is "active" (blocks re-create) unless HR Head rejected it.
  const activeReq = (cid:string) => { const r = reqMap.get(cid); return r && r.status !== 'HR_HEAD_REJECTED' ? r : null }
  // Only candidates who ACCEPTED their CTC offer (and aren't already sent/closed) need HR-Head approval.
  const eligible = candidates.filter((c:Candidate)=>acceptedIds.has(c.id) && !['Offer Sent','Joined','Rejected'].includes(c.stage))
  const [oaQ, setOaQ] = useState('')
  const shownEligible = eligible
    .filter((c:Candidate)=>!oaQ || c.full_name.toLowerCase().includes(oaQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))

  const STATUS_LABEL: Record<string,string> = {
    SUBMITTED: 'Offer request sent to HR Head',
    HR_HEAD_APPROVED: 'Approved by HR Head — offer letter pending',
    OFFER_SENT: 'Offer letter sent',
    HR_HEAD_REJECTED: 'Rejected by HR Head — you can re-create',
  }

  /**
   * The request's own status, told as the three steps it actually passes
   * through: Raised → HR Head → Ready to send.
   *
   * ApprovalChain does NOT understand this table's statuses. It reads only
   * APPROVED / REJECTED / PENDING, and marks a step "now" solely when it is
   * PENDING *and* every earlier step is APPROVED. Passing HR_HEAD_APPROVED
   * straight through would leave every step neither done nor current — so the
   * domain status is translated here rather than handed over raw.
   *
   * HR_HEAD_REJECTED deliberately leaves the third step PENDING: its
   * predecessor is REJECTED, so the chain renders it blank rather than "now",
   * which is right — nothing is waiting to be sent.
   */
  const chainFor = (status:string, submittedAt?:string|null): ChainStepVM[] => {
    const when = submittedAt ? new Date(submittedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '—'
    const hrHead = status==='HR_HEAD_REJECTED' ? 'REJECTED'
      : (status==='HR_HEAD_APPROVED'||status==='OFFER_SENT') ? 'APPROVED' : 'PENDING'
    return [
      { role:'Raised',        approverName: when,                                   status:'APPROVED' },
      { role:'HR Head',       approverName: hrHead==='PENDING' ? 'Awaiting sign-off' : hrHead==='REJECTED' ? 'Sent back' : 'Approved', status: hrHead },
      { role:'Ready to send', approverName: status==='OFFER_SENT' ? 'Offer sent' : 'Not yet', status: status==='OFFER_SENT' ? 'APPROVED' : 'PENDING' },
    ]
  }

  // In-memory status filter (05 #11). Counts are real, because FilterPills
  // disables a zero-count pill rather than hiding it.
  //
  // Reads reqMap directly rather than activeReq(): activeReq deliberately
  // returns null for HR_HEAD_REJECTED, because a rejected request no longer
  // blocks re-creating one. Filtering through it would report every sent-back
  // request as "Not raised", leaving the "Sent back" pill permanently at 0 and
  // therefore permanently disabled — a control that could never fire.
  const statusOf = (c:Candidate) => reqMap.get(c.id)?.status || 'NONE'
  const statusShown = oaStatus==='*' ? shownEligible : shownEligible.filter((c:Candidate)=>statusOf(c)===oaStatus)
  async function pick(c:Candidate) {
    if (activeReq(c.id)) return   // #9 — already requested; cannot re-create
    setSel(c); setNeg(null); setLoading(true)
    const { data } = await supabase.from('ctc_negotiations').select('*').eq('candidate_id',c.id).order('created_at',{ascending:false}).limit(1)
    setNeg(data?.[0]||null); setLoading(false)
  }
  const mrf = sel ? mrfs.find((m:MRF)=>m.id===sel.mrf_id) : null

  if (sel) {
    return (
      <RxPage header={
        <RecruitmentHeader
          title="Offer approval"
          subtitle="Send an offer to the HR Head for sign-off once the candidate has accepted their salary."
          help={<Help label="Who appears here">
            <p>A candidate reaches this list only after <b>accepting</b> the salary link sent from Negotiation.</p>
            <p>One request per candidate: once sent, the row shows its status instead of the button. A rejected request can be re-created.</p>
          </Help>}
          actions={<button type="button" className="rx-btn" onClick={()=>{setSel(null);setNeg(null)}}>Back to candidates</button>}
        />}>
        <div className="rx-grid rx-stag">
          <div className="s12">
            {loading ? <div className="rx-mod" style={{ textAlign:'center' as const, padding:24 }}><span className="rx-meta">Loading negotiation…</span></div>
              : neg ? (
                <>
                  <CreateOfferApproval candidate={sel} negotiation={neg} mrf={mrf} onSubmitted={()=>{ onRefresh?.(); setSel(null); setNeg(null) }} />
                  <div style={{ maxWidth:700, margin:'16px auto 0' }}><AuditTrailViewer candidateId={sel.id} /></div>
                </>
              ) : (
                <div className="rx-mod" style={{ borderColor:'var(--ez-warning-edge)' }}>
                  <span className="rx-meta">No CTC negotiation found for <b>{sel.full_name}</b>. Create one in the Negotiation tab first.</span>
                </div>
              )}
          </div>
        </div>
      </RxPage>
    )
  }

  return (
    <RxPage header={
      <RecruitmentHeader
        title="Offer approval"
        subtitle="Send an offer to the HR Head for sign-off once the candidate has accepted their salary."
        help={<Help label="Who appears here">
          <p>A candidate reaches this list only after <b>accepting</b> the salary link sent from Negotiation.</p>
          <p>One request per candidate: once sent, the row shows its status instead of the button. A rejected request can be re-created.</p>
        </Help>}
      />}>
      <div className="rx-grid rx-stag">
        <div className="s12 rx-bar" style={{ gap:10 }}>
          {/* SearchBox filters as you type; the old SearchBar needed Apply. */}
          <SearchBox value={oaQ} onChange={setOaQ} placeholder="Search candidate…" label="Search candidates" />
          {/* Inline rather than the old shared RecFilterBar, whose root
              carried position:sticky; zIndex:30 and scrolled over the rail
              (--ez-z-rail, 20); inline sticky cannot be unset by a parent. Same
              four controls, same `f` state, same setF. */}
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.company}
            onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
            <option value="">All companies</option>
            {companies.map((co:Company)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.department}
            onChange={e=>setF({ ...f, department:e.target.value })}>
            <option value="">All departments</option>
            {departments.filter((d:Department)=>!f.company||d.company_id===f.company).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.location}
            onChange={e=>setF({ ...f, location:e.target.value })}>
            <option value="">All locations</option>
            {locations.filter((l:Location)=>!f.company||l.company_id===f.company).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.position}
            onChange={e=>setF({ ...f, position:e.target.value })}>
            <option value="">All positions</option>
            {distinctPositions(candidates).map((p:string)=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {shownEligible.length>0 && (
          <div className="s12">
            <FilterPills label="Filter by request status" value={oaStatus} onChange={setOaStatus}
              options={[
                { value:'*',                label:'All',              count: shownEligible.length },
                { value:'NONE',             label:'Not raised',       count: shownEligible.filter((c:Candidate)=>statusOf(c)==='NONE').length },
                { value:'SUBMITTED',        label:'Awaiting HR Head', count: shownEligible.filter((c:Candidate)=>statusOf(c)==='SUBMITTED').length },
                { value:'HR_HEAD_APPROVED', label:'Approved',         count: shownEligible.filter((c:Candidate)=>statusOf(c)==='HR_HEAD_APPROVED').length },
                { value:'OFFER_SENT',       label:'Offer sent',       count: shownEligible.filter((c:Candidate)=>statusOf(c)==='OFFER_SENT').length },
                { value:'HR_HEAD_REJECTED', label:'Sent back',        count: shownEligible.filter((c:Candidate)=>statusOf(c)==='HR_HEAD_REJECTED').length },
              ]} />
          </div>
        )}

        {statusShown.length===0 ? (
          <div className="s12 rx-mod" style={{ textAlign:'center' as const, padding:28 }}>
            <span className="rx-meta">{oaQ||oaStatus!=='*'?'No matching candidate':'No candidates have accepted their CTC offer yet. They appear here once a candidate Accepts the salary link.'}</span>
          </div>
        ) : statusShown.map((c:Candidate)=>{
          // DISPLAY reads the request itself; the RE-CREATE GATE stays on
          // activeReq(). Conflating the two is why a sent-back request rendered
          // as a bare "Create request" button with no trace of the rejection:
          // activeReq() returns null for HR_HEAD_REJECTED *so that* a new
          // request can be raised, and the row was keyed off that. Its
          // STATUS_LABEL entry and the critical-colour branch below were both
          // unreachable in consequence. pick()'s guard is unchanged.
          const ar = reqMap.get(c.id) || null
          const canRaise = !activeReq(c.id)
          return (
          <div className="s12" key={c.id}>
            <div className="rx-mod" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <div className="rx-row" style={{ gap:6 }}>
                  <span className="rx-name">{c.full_name}</span>
                  {c.offer_revised&&<Badge text="Revised Offer" />}
                </div>
                <div className="rx-meta" style={{ marginTop:2 }}>{c.designation||'—'} · {c.stage}{(()=>{ const mn=mrfs.find((m:MRF)=>m.id===c.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, flexShrink:0, minWidth: ar ? 260 : undefined }}>
                {ar && (
                  <>
                    <div style={{ fontSize:12, fontWeight:600, textAlign:'right' as const, color: ar.status==='HR_HEAD_REJECTED' ? C.critical : C.positive }}>
                      {STATUS_LABEL[ar.status] || ar.status}
                    </div>
                    {/* The same status, shown as the journey it is. The wording
                        above stays: it is what tells a recruiter what to DO. */}
                    <div style={{ alignSelf:'stretch' }}><ApprovalChain steps={chainFor(ar.status, ar.submitted_at)} /></div>
                  </>
                )}
                {/* A sent-back request shows its chain AND the way forward. */}
                {canRaise && <button type="button" className="rx-btn p" onClick={()=>pick(c)}>{ar?'Re-create request':'Create request'}</button>}
              </div>
            </div>
          </div>
        )})}
      </div>
    </RxPage>
  )
}

function OffersTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify, rail }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const [letter, setLetter] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [cc, setCc] = useState('')
  const [doj, setDoj] = useState('')
  // A candidate reaches Offers only AFTER HR Head has APPROVED the offer (offer_approval_requests
  // status = HR_HEAD_APPROVED) — or an offer is already sent. So the flow is:
  // shortlist → Negotiation → Offer Approval → HR Head approves → Offers. No bypass.
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    supabase.from('offer_approval_requests').select('candidate_id, status').then(({ data }: any) => {
      setApprovedIds(new Set((data || []).filter((r: any) => r.status === 'HR_HEAD_APPROVED').map((r: any) => r.candidate_id)))
    })
  }, [supabase])
  const offeredCands = candidates.filter((c:Candidate)=> approvedIds.has(c.id) || c.stage==='Offer Sent')
  const [offQ, setOffQ] = useState('')
  const shownOffered = offeredCands
    .filter((c:Candidate)=>!offQ || c.full_name.toLowerCase().includes(offQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))

  async function generateLetter(c:Candidate) {
    const mrf = mrfs.find((m:MRF)=>m.id===c.mrf_id)
    const { data:neg } = await supabase.from('ctc_negotiations').select('*').eq('candidate_id',c.id).order('created_at',{ascending:false}).limit(1)
    const n = neg?.[0]
    const content = `Dear ${c.full_name},

We are pleased to extend an offer of employment for the position of ${mrf?.designation||c.designation||'—'}.

OFFER DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Annual CTC:         ₹${n?.offered_ctc?(n.offered_ctc/100000).toFixed(2):' — '} Lakhs
Monthly Basic:      ₹${n?.basic_monthly?Math.round(n.basic_monthly).toLocaleString('en-IN'):' — '}
Monthly HRA:        ₹${n?.hra_monthly?Math.round(n.hra_monthly).toLocaleString('en-IN'):' — '}
Est. Net Take-Home: ₹${n?.net_monthly?Math.round(n.net_monthly).toLocaleString('en-IN'):' — '}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Date of Joining: ${doj||'To be confirmed'}

This offer is valid for 7 days and subject to:
1. Successful completion of background verification
2. Submission of all required documents
3. Medical fitness certification

Please confirm acceptance by replying to this email.

With regards,
HR Team`
    setLetter(content)
    setToEmail(c.email||'')
    setSel(c)
  }

  async function sendOffer() {
    if (!sel||!letter) return
    const { error } = await supabase.from('offer_letters').insert({
      candidate_id:sel.id, candidate_name:sel.full_name, designation:sel.designation||'Not specified', company_id:sel.company_id||null,
      letter_content:letter, to_email:toEmail,
      cc_emails:cc.split(',').map((e:string)=>e.trim()).filter(Boolean),
      status:'SENT', sent_at:new Date().toISOString()
    })
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    await supabase.from('candidates').update({ stage:'Offer Sent', doj:doj||null, offer_accepted:false, offer_sent_at:new Date().toISOString(), offer_reminder_sent:false }).eq('id',sel.id)
    await closeMrfIfFilled(supabase, sel.mrf_id)
    showNotify('Offer saved! Email ready.'); onRefresh()
  }

  // ── Post-offer-letter response (#13): Accepted / Revision / Backout ──
  // Accepted → moves into Pre-onboarding; MRF stays/closes per openings.
  async function markAccepted(c:Candidate) {
    const { error } = await supabase.from('candidates').update({ offer_accepted:true, offer_response:'ACCEPTED' }).eq('id', c.id)
    if (error) { showNotify('Error: '+error.message,'error'); return }
    await closeMrfIfFilled(supabase, c.mrf_id)
    await supabase.from('recruitment_audit_logs').insert({ candidate_id:c.id, company_id:c.company_id||null, action_type:'OFFER_ACCEPTED', details:{ name:c.full_name }, created_at:new Date().toISOString() })
    showNotify(`${c.full_name} marked Accepted — moved to Pre-onboarding.`); onRefresh()
  }
  // Revision → send the offer back to HR Head for re-approval.
  async function markRevision(c:Candidate) {
    const reason = window.prompt(`Revision requested for ${c.full_name}.\nWhat needs to change? (sent back to HR Head)`); if (reason===null) return
    const { error } = await supabase.from('candidates').update({ offer_response:'REVISION', offer_revised:true, offer_accepted:false, stage:'Shortlisted' }).eq('id', c.id)
    if (error) { showNotify('Error: '+error.message,'error'); return }
    // Re-open the candidate's latest approval request so HR Head sees it again.
    const { data:reqs } = await supabase.from('offer_approval_requests').select('id').eq('candidate_id', c.id).order('submitted_at',{ascending:false}).limit(1)
    if (reqs?.[0]) await supabase.from('offer_approval_requests').update({ status:'SUBMITTED', hr_head_action:null, submitted_at:new Date().toISOString() }).eq('id', reqs[0].id)
    await reopenMrf(supabase, c.mrf_id)   // free the slot while it's re-approved
    await supabase.from('recruitment_audit_logs').insert({ candidate_id:c.id, company_id:c.company_id||null, action_type:'OFFER_REVISE_REQUESTED', details:{ name:c.full_name, reason }, created_at:new Date().toISOString() })
    showNotify(`Revision sent back to HR Head for ${c.full_name}.`); onRefresh()
  }
  // Backout → candidate declined; reopen the MRF so it's hiring again.
  async function markBackout(c:Candidate) {
    if (!window.confirm(`Mark ${c.full_name} as Backed Out?\nThe candidate will be rejected and the MRF re-opened for hiring.`)) return
    const { error } = await supabase.from('candidates').update({ offer_response:'BACKOUT', offer_accepted:false, stage:'Rejected', blacklist_reason:'Backed out after offer' }).eq('id', c.id)
    if (error) { showNotify('Error: '+error.message,'error'); return }
    await reopenMrf(supabase, c.mrf_id)
    await supabase.from('recruitment_audit_logs').insert({ candidate_id:c.id, company_id:c.company_id||null, action_type:'OFFER_BACKOUT', details:{ name:c.full_name }, created_at:new Date().toISOString() })
    showNotify(`${c.full_name} marked Backed Out — MRF re-opened.`); onRefresh()
  }

  /**
   * Where an offer has got to, derived ONLY from fields the Candidate interface
   * actually declares. The writes also set `offer_response`
   * ('ACCEPTED' | 'REVISION' | 'BACKOUT'), but that column is not on the
   * interface, so reading it here would not type-check — and every state it
   * encodes is recoverable from what is typed.
   *
   * Order matters. `awaiting` is tested before `revision` because a revised
   * offer that has been re-sent carries offer_revised AND stage 'Offer Sent';
   * it is waiting on the candidate again, and the "Revised Offer" badge already
   * says how it got there.
   */
  type OfferState = 'accepted' | 'awaiting' | 'backout' | 'revision' | 'notsent'
  const offerState = (c:Candidate): OfferState =>
    c.offer_accepted ? 'accepted'
    : c.stage==='Offer Sent' ? 'awaiting'
    : c.stage==='Rejected' ? 'backout'
    : c.offer_revised ? 'revision'
    : 'notsent'

  /** Two steps, because that is the whole of this stage: it goes out, they reply. */
  const offerChain = (c:Candidate): ChainStepVM[] => {
    const st = offerState(c)
    const sentOn = c.offer_sent_at ? new Date(c.offer_sent_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : null
    return [
      { role:'Sent', approverName: sentOn || (st==='notsent' ? 'Not yet' : 'Sent'), status: st==='notsent' ? 'PENDING' : 'APPROVED' },
      { role:'Candidate reply',
        approverName: st==='accepted' ? 'Accepted' : st==='backout' ? 'Backed out' : st==='revision' ? 'Revision asked' : st==='awaiting' ? 'Awaiting' : '—',
        status: st==='accepted' ? 'APPROVED' : st==='backout' ? 'REJECTED' : 'PENDING' },
    ]
  }

  const OFFER_TILES: { key:OfferState; label:string }[] = [
    { key:'notsent',  label:'Not sent' },
    { key:'awaiting', label:'Awaiting reply' },
    { key:'accepted', label:'Accepted' },
    { key:'revision', label:'Revision asked' },
    { key:'backout',  label:'Backed out' },
  ]

  return (
    <RxPage header={
      <RecruitmentHeader
        title="Offer letters"
        subtitle="Draft and send the letter once HR Head has approved the offer, then record how the candidate replied."
        help={<Help label="Who appears here">
          <p>A candidate reaches this list only after <b>HR Head approval</b>, or once an offer has already been sent. There is no bypass.</p>
          <p>Picking someone builds their letter from the saved CTC negotiation. Nothing is sent until you press Send.</p>
        </Help>}
      />}>
      <div className="rx-grid rx-stag">
        {/* Where every offer stands. Five tiles, not the kit's four: the data
            distinguishes a revision request from a backout, and calling both
            "Declined" would merge a candidate still in play with one who is
            gone. Read-outs, not filters — section 9 asks for the counts, and
            adding a filter here would be new behaviour rather than a new look. */}
        {shownOffered.length>0 && (
          <div className="s12" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
            {OFFER_TILES.map(t => {
              const n = shownOffered.filter((c:Candidate)=>offerState(c)===t.key).length
              return (
                <div key={t.key} className={t.key==='backout' && n>0 ? 'rx-tile crit' : 'rx-tile'}>
                  <div style={{ ...eyebrow }}>{t.label}</div>
                  <div className="rx-num" style={{ fontSize:20, fontWeight:700, marginTop:2, color: n===0 ? C.faint : undefined }}>{n}</div>
                </div>
              )
            })}
          </div>
        )}
        <div className="s4" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div className="rx-label">Shortlisted / offer stage ({shownOffered.length})</div>
          <SearchBox value={offQ} onChange={setOffQ} placeholder="Search candidate…" label="Search candidates" />
          {/* Inline rather than the old shared RecFilterBar, whose root
              carried position:sticky; zIndex:30 and scrolled over the rail
              (--ez-z-rail, 20); inline sticky cannot be unset by a parent.
              Same four controls, same `f` state, same setF. */}
          <div className="rx-bar" style={{ gap:8 }}>
            <select className="rx-input" style={{ height:34, fontSize:13 }} value={f.company}
              onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
              <option value="">All companies</option>
              {companies.map((co:Company)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
            </select>
            <select className="rx-input" style={{ height:34, fontSize:13 }} value={f.department}
              onChange={e=>setF({ ...f, department:e.target.value })}>
              <option value="">All departments</option>
              {departments.filter((d:Department)=>!f.company||d.company_id===f.company).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
            </select>
            <select className="rx-input" style={{ height:34, fontSize:13 }} value={f.location}
              onChange={e=>setF({ ...f, location:e.target.value })}>
              <option value="">All locations</option>
              {locations.filter((l:Location)=>!f.company||l.company_id===f.company).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
            </select>
            <select className="rx-input" style={{ height:34, fontSize:13 }} value={f.position}
              onChange={e=>setF({ ...f, position:e.target.value })}>
              <option value="">All positions</option>
              {distinctPositions(candidates).map((p:string)=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        {shownOffered.map((c:Candidate)=>(
          <div key={c.id} className="rx-card" style={{ cursor:'pointer',
              borderColor: sel?.id===c.id ? 'var(--ez-brand)' : undefined,
              background:  sel?.id===c.id ? 'var(--ez-brand-tint)' : undefined }}
            onClick={()=>generateLetter(c)}>
            <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>{c.full_name}{(()=>{ const mn=mrfs.find((m:MRF)=>m.id===c.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
            <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L':' — '}</div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' as const }}><Badge text={c.stage} />{c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}</div>
            {/* Out, then back. The same two facts the tiles count, said per
                candidate. markAccepted/markRevision/markBackout are untouched —
                each still writes exactly what it always did. */}
            <div style={{ marginTop:8 }}><ApprovalChain steps={offerChain(c)} /></div>
            {c.stage==='Offer Sent'&&!c.offer_accepted&&(
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button type="button" className="rx-btn sm ok" style={{ flex:1 }} onClick={(e)=>{ e.stopPropagation(); markAccepted(c) }}>Accepted</button>
                <button type="button" className="rx-btn sm" style={{ flex:1, background:C.warningTint, color:C.warning, borderColor:C.warningTint }} onClick={(e)=>{ e.stopPropagation(); markRevision(c) }}>Revision</button>
                <button type="button" className="rx-btn sm d" style={{ flex:1 }} onClick={(e)=>{ e.stopPropagation(); markBackout(c) }}>Backout</button>
              </div>
            )}
            {c.stage==='Offer Sent'&&c.offer_accepted&&(
              <div style={{ fontSize:F.micro, color:C.positive, marginTop:S.sm, fontWeight:W.semi }}>Accepted — moved to Pre-onboarding</div>
            )}
          </div>
        ))}
        {offeredCands.length===0&&(
          <div className="rx-mod" style={{ textAlign:'center' as const, padding:24 }}>
            <span className="rx-meta">No candidates have reached the offer stage yet.</span>
          </div>
        )}
        </div>
      {sel&&letter&&(
        <div className="s8">
          <div className="rx-mod">
            <div className="rx-mod-h"><div className="rx-mod-t">Offer letter</div></div>
            <div style={{ marginBottom:8 }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>To Email</label><input className="rx-input" value={toEmail} onChange={e=>setToEmail(e.target.value)} /></div>
            <div style={{ marginBottom:8 }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>CC (comma separated)</label><input className="rx-input" value={cc} onChange={e=>setCc(e.target.value)} placeholder="hr@co.com, md@co.com" /></div>
            <div style={{ marginBottom:10 }}><label className="rx-label" style={{ display:'block', marginBottom:6 }}>Date of Joining</label><input className="rx-input" type="date" value={doj} onChange={e=>setDoj(e.target.value)} /></div>
            <textarea className="rx-input" style={{ height:'auto', resize:'vertical', padding:'10px 13px', minHeight:300, fontFamily:'monospace', fontSize:11 }} value={letter} onChange={e=>setLetter(e.target.value)} />
            <button onClick={sendOffer} style={{ ...T.btnPrimary, width:'100%', marginTop:10, padding:10 }}>Send Offer Letter</button>
          </div>
        </div>
      )}
      </div>
    </RxPage>
  )
}

// ── PRE-ONBOARDING ────────────────────────────────────────────────
function PreOnboardTab({ supabase, candidates, companies, departments, locations, mrfs, onRefresh, showNotify, rail }:any) {
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const [links, setLinks] = useState<any[]>([])
  const [busy, setBusy] = useState('')        // candidate_id being processed
  const [choose, setChoose] = useState('')    // candidate_id showing Experienced/Fresher choice
  const [obDates, setObDates] = useState<Record<string,string>>({})
  const [hrEmails, setHrEmails] = useState<Record<string,string>>({})
  const [poQ, setPoQ] = useState('')

  const obVal = (c:Candidate) => obDates[c.id] ?? (c.onboarding_date || '')
  const hrVal = (c:Candidate) => hrEmails[c.id] ?? (c.hr_email || '')
  async function saveOnboarding(c:Candidate) {
    const { error } = await supabase.from('candidates').update({ onboarding_date: obVal(c)||null, hr_email: hrVal(c)||null }).eq('id', c.id)
    if (error) { showNotify('Error: '+error.message,'error'); return }
    showNotify(`Saved onboarding details for ${c.full_name}.`); onRefresh()
  }
  const daysToJoin = (c:Candidate) => c.onboarding_date ? Math.ceil((new Date(c.onboarding_date).getTime()-Date.now())/86400000) : null

  /**
   * Days to the date of joining, as a chip. Uses the kit's daysUntil(), which
   * compares calendar days in LOCAL time rather than subtracting timestamps —
   * so a joining date "tomorrow" reads 1 whatever the hour, instead of flipping
   * to 0 after midday. daysToJoin() above is the tab's own older calculation and
   * still drives the three-day badge; this only labels.
   */
  const dojChip = (c:Candidate, rowDoj?:string|null) => {
    const d = daysUntil(rowDoj || c.doj || c.onboarding_date || null)
    if (d === null) return null
    const tone = d < 0 ? 'b-mute' : d <= 3 ? 'b-warn' : 'b-pos'
    const text = d < 0 ? `Joined ${Math.abs(d)}d ago` : d === 0 ? 'Joins today' : `${d}d to joining`
    return <span className={`rx-b ${tone}`}>{text}</span>
  }

  const load = useCallback(()=>{
    supabase.from('preonboarding_links').select('*').order('created_at',{ascending:false})
      .then(({data}:any)=>setLinks(data||[]))
  },[supabase])
  useEffect(()=>{ load() },[load])

  const linkByCand = new Map(links.map((l:any)=>[l.candidate_id,l]))
  // Only candidates who have ACCEPTED their offer (or already joined) flow into pre-onboarding.
  const onboardingCands = candidates.filter((c:Candidate)=>(c.stage==='Offer Sent'&&c.offer_accepted)||c.stage==='Joined')
  const shownOnboarding = onboardingCands
    .filter((c:Candidate)=>!poQ || c.full_name.toLowerCase().includes(poQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))
  const companyName = (c:Candidate)=> companies?.find((co:any)=>co.id===c.company_id)?.company_name || 'our organization'

  // Find the candidate's onboarding row, creating one if it doesn't exist yet.
  // Resolve a company for a candidate that may not have one set directly:
  // candidate → its MRF → the company chosen during negotiation → single company.
  async function resolveCompanyId(c:Candidate): Promise<string|null> {
    if (c.company_id) return c.company_id
    const mrfC = mrfs?.find((m:any)=>m.id===c.mrf_id)?.company_id
    if (mrfC) return mrfC
    const { data: neg } = await supabase.from('ctc_negotiations').select('company_id')
      .eq('candidate_id', c.id).not('company_id','is',null).order('created_at',{ ascending:false }).limit(1).maybeSingle()
    if (neg?.company_id) return neg.company_id
    if (companies?.length===1) return companies[0].id
    return null
  }

  async function ensureRow(c:Candidate) {
    const existing = linkByCand.get(c.id)
    if (existing) return existing
    const companyId = await resolveCompanyId(c)
    if (!companyId) { showNotify('This candidate has no company set. Set it on the candidate (or its MRF) first.','error'); return null }
    const { data, error } = await supabase.from('preonboarding_links').insert({
      candidate_id:c.id, company_id:companyId, doj:c.doj||null, status:'CREATED', sent_at:new Date().toISOString()
    }).select('*').single()
    if (error) { showNotify('Error: '+error.message,'error'); return null }
    return data
  }

  async function sendAcceptance(c:Candidate, type:'EXPERIENCED'|'FRESHER') {
    if (!c.email) { showNotify('Candidate has no email on file','error'); return }
    setBusy(c.id)
    const row = await ensureRow(c); if (!row) { setBusy(''); return }
    const company = companyName(c)
    const role = c.designation || 'the role'
    const doj = row.doj || c.doj || 'to be confirmed'
    const exp = type==='EXPERIENCED'
    const title = exp ? 'OFFER ACCEPTANCE & RESIGNATION ADVISORY' : 'JOINING CONFIRMATION LETTER'
    const subject = exp
      ? `Acceptance Confirmed & Next Steps — ${role} | ${company}`
      : `Joining Confirmation — ${role} | ${company}`
    const paragraphs = exp ? [
      `Thank you for accepting our offer for the position of ${role} at ${company}. We are delighted to have you join us.`,
      `As your next step, kindly submit your resignation to your current employer and share your acceptance / relieving documentation with us. Please keep us informed of your last working day so we can finalise your date of joining.`,
      `Do ensure all notice-period formalities are completed in time for a smooth transition. We look forward to welcoming you on board.`,
    ] : [
      `Congratulations and welcome to ${company}! We are pleased to confirm your joining as ${role}.`,
      `Please report on your date of joining with the required documents. Our HR team will guide you through the onboarding formalities and your workspace setup.`,
      `We are excited to have you begin your career with us and look forward to a great journey together.`,
    ]
    const letter = { company_name:company, title, recipient:c.full_name, paragraphs,
      highlights:[ { label:'Position', value:role }, { label:'Date of Joining', value:String(doj) } ] }
    try {
      const r = await fetch('/api/recruitment/send-letter', { method:'POST', headers: await authHeaders(),
        body:JSON.stringify({ to:c.email, cc:'', subject,
          body:`Dear ${c.full_name},\n\n${paragraphs.join('\n\n')}\n\nWarm regards,\n${company} — Human Resources`, letter }) })
      const d = await r.json().catch(()=>({}))
      if (!r.ok || !d.ok) { showNotify('Letter email failed: '+(d.error||r.status),'error'); setBusy(''); return }
    } catch { showNotify('Letter email failed (network)','error'); setBusy(''); return }
    await supabase.from('preonboarding_links').update({ offer_response:'ACCEPTED', candidate_type:type,
      response_at:new Date().toISOString(), acceptance_letter_sent_at:new Date().toISOString() }).eq('id', row.id)
    showNotify(`${exp?'Resignation Acceptance':'Joining Confirmation'} letter emailed to ${c.full_name}!`)
    setChoose(''); setBusy(''); load(); onRefresh()
  }

  async function markRevise(c:Candidate) {
    const note = window.prompt('What needs to be revised? This sends the candidate back to the Negotiation tab to restart the offer flow.'); if (note===null) return
    setBusy(c.id)
    // Clear the pre-onboarding record so the next offer cycle starts fresh,
    // log the revision, then send the candidate back to Negotiation (Shortlisted).
    const existing = linkByCand.get(c.id)
    if (existing) await supabase.from('preonboarding_links').delete().eq('id', existing.id)
    await supabase.from('recruitment_audit_logs').insert({
      candidate_id:c.id, company_id:(await resolveCompanyId(c))||null, action_type:'OFFER_REVISE_REQUESTED',
      details:{ note }, created_at:new Date().toISOString()
    })
    await supabase.from('candidates').update({ stage:'Shortlisted', offer_revised:true, offer_revision_note:note }).eq('id', c.id)
    showNotify(`${c.full_name} sent back to Negotiation — marked Revised Offer.`)
    setBusy(''); load(); onRefresh()
  }

  async function markBackout(c:Candidate) {
    const reason = window.prompt('Backout reason (candidate will be blacklisted & the MRF reopened):'); if (reason===null) return
    if (!window.confirm(`Confirm backout for ${c.full_name}?\nThis blacklists the candidate and reopens the MRF.`)) return
    setBusy(c.id); const row = await ensureRow(c); if (!row) { setBusy(''); return }
    await supabase.from('preonboarding_links').update({ offer_response:'BACKOUT', response_at:new Date().toISOString(), revise_note:reason }).eq('id', row.id)
    await supabase.from('candidates').update({ blacklisted:true, blacklist_reason:reason, stage:'Rejected' }).eq('id', c.id)
    if (c.mrf_id) await supabase.from('manpower_requisitions').update({ status:'APPROVED' }).eq('id', c.mrf_id)
    showNotify(`${c.full_name} backed out — blacklisted & MRF reopened.`); setBusy(''); load(); onRefresh()
  }

  const respStyle:Record<string,[string,string]> = { ACCEPTED:[C.positiveTint,C.positive], REVISE:[C.warningTint,C.warning], BACKOUT:[C.criticalTint,C.critical] }

  return (
    <RxPage header={
      <RecruitmentHeader
        title="Pre-onboarding"
        subtitle="Confirm how each candidate responded to their offer, set the joining date, and start their onboarding."
        help={<Help label="Who appears here">
          <p>Candidates who have <b>accepted an offer</b>, plus anyone already marked Joined.</p>
          <p>Set an <b>HR email</b> so the joining reminder can be sent; the badge turns green three days out.</p>
        </Help>}
      />}>
      <div className="rx-grid rx-stag">
        <div className="s12 rx-bar" style={{ gap:10 }}>
          <SearchBox value={poQ} onChange={setPoQ} placeholder="Search candidate…" label="Search candidates" />
          {/* Inline rather than the old shared RecFilterBar, whose root
              carried position:sticky; zIndex:30 and scrolled over the rail
              (--ez-z-rail, 20); inline sticky cannot be unset by a parent.
              Same four controls, same `f` state, same setF. */}
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.company}
            onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
            <option value="">All companies</option>
            {companies.map((co:Company)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.department}
            onChange={e=>setF({ ...f, department:e.target.value })}>
            <option value="">All departments</option>
            {departments.filter((d:Department)=>!f.company||d.company_id===f.company).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.location}
            onChange={e=>setF({ ...f, location:e.target.value })}>
            <option value="">All locations</option>
            {locations.filter((l:Location)=>!f.company||l.company_id===f.company).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select className="rx-input" style={{ height:34, fontSize:13, maxWidth:170 }} value={f.position}
            onChange={e=>setF({ ...f, position:e.target.value })}>
            <option value="">All positions</option>
            {distinctPositions(candidates).map((p:string)=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {shownOnboarding.length===0&&(
          <div className="s12 rx-mod" style={{ textAlign:'center' as const, padding:24 }}>
            <span className="rx-meta">{poQ?'No matching candidate':'No offer-sent candidates yet.'}</span>
          </div>
        )}
      {shownOnboarding.map((c:Candidate)=>{
        const row:any = linkByCand.get(c.id)
        const resp = row?.offer_response
        const [bg,fg] = resp ? respStyle[resp] : [C.surface,C.muted]
        // Both halves of this border were broken. fg+'40' concatenates an
        // alpha suffix onto a design token, giving "var(--ez-...)40", which is
        // not a colour — so a card WITH a response had no border at all. And
        // the fallback was a frozen rgba brand blue that could not follow the
        // theme. A responded card now takes its state colour; the rest take
        // the hairline.
        //
        // Line comment above the return, NOT a {} container after it — see the
        // same note in PipelineTab. Third time I made that mistake today.
        return (
          <div key={c.id} className="s12 rx-card"
            style={{ borderColor: resp ? fg : undefined }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:C.ink }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.designation||'—'} · {companyName(c)} · DOJ: {row?.doj||c.doj||'Not set'}{(()=>{ const mn=mrfs.find((m:MRF)=>m.id===c.mrf_id)?.mrf_number; return mn ? <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:C.brandDeep, background:C.brandTint, padding:'1px 7px', borderRadius:99, verticalAlign:'middle', whiteSpace:'nowrap' as const }}>{mn}</span> : null })()}</div>
                {c.email&&<div style={{ fontSize:11, color:C.faint, marginTop:1 }}>{c.email}</div>}
              </div>
              {/* bg and fg stay SEPARATE token values. See the note above the
                  return: concatenating an alpha suffix onto one of these is
                  what silently removed this card's border once already. */}
              <div className="rx-row" style={{ gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                {dojChip(c, row?.doj)}
                {resp&&(
                  <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:bg, color:fg }}>
                    {resp==='ACCEPTED'?`✅ Accepted (${row?.candidate_type==='EXPERIENCED'?'Experienced':'Fresher'})`:resp==='REVISE'?'Revision requested':'Backed out'}
                  </span>
                )}
              </div>
            </div>

            {/* Onboarding date + HR email — drive the reminder emails */}
            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' as const }}>
              <label style={{ fontSize:11, color:C.brandDeep, fontWeight:600 }}>Onboarding date:</label>
              <input type="date" value={obVal(c)} onChange={e=>setObDates(m=>({...m,[c.id]:e.target.value}))} className="rx-input" style={{ width:150, fontSize:12 }} />
              <label style={{ fontSize:11, color:C.brandDeep, fontWeight:600 }}>HR email:</label>
              <input value={hrVal(c)} onChange={e=>setHrEmails(m=>({...m,[c.id]:e.target.value}))} placeholder="hr@company.com" className="rx-input" style={{ width:180, fontSize:12 }} />
              <button type="button" className="rx-btn sm" onClick={()=>saveOnboarding(c)}>Save</button>
              {/* Only the three-day call to action stays here. The plain
                  "N days to join" this used to render in every other case is
                  now the chip in the card header, and showing both said the
                  same thing twice in one card. */}
              {(()=>{ const d=daysToJoin(c); if(d===null||d<0||d>3) return null
                return <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:C.positiveTint, color:C.positive }}>Joining in {d} day{d===1?'':'s'} — start onboarding</span> })()}
            </div>
            {!c.hr_email&&!hrEmails[c.id]&&<div style={{ fontSize:F.micro, color:C.critical, marginTop:S.xs }}>Add an HR email so onboarding reminder mails can be sent.</div>}

            {!resp&&(
              choose===c.id ? (
                <div style={{ marginTop:12, background:C.sunken, borderRadius:10, padding:'10px 12px', border: `1px solid ${C.brandEdge}` }}>
                  <div style={{ fontSize:12, color:C.brandDeep, fontWeight:600, marginBottom:8 }}>Candidate type — sends the right letter:</div>
                  <div style={{ display:'flex', gap:8 }}>
                    {/* sendAcceptance is untouched — same send-letter POST,
                        same preonboarding_links write, same notification. */}
                    <button type="button" className="rx-btn p" disabled={busy===c.id} onClick={()=>sendAcceptance(c,'EXPERIENCED')}>{busy===c.id?'Sending…':'Experienced → Resignation Acceptance'}</button>
                    <button type="button" className="rx-btn" disabled={busy===c.id} onClick={()=>sendAcceptance(c,'FRESHER')} style={{ background:C.info, color:C.onAccent, borderColor:C.info }}>{busy===c.id?'Sending…':'Fresher → Joining Confirmation'}</button>
                    <button type="button" className="rx-btn g" onClick={()=>setChoose('')}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  {/* markRevise still asks for its reason; markBackout still
                      blacklists and re-opens the MRF. Styling only. */}
                  <button type="button" className="rx-btn" style={{ background:C.positiveTint, color:C.positive, borderColor:C.positiveTint }} onClick={()=>setChoose(c.id)}>Accepted</button>
                  <button type="button" className="rx-btn" style={{ background:C.warningTint, color:C.warning, borderColor:C.warningTint }} onClick={()=>markRevise(c)}>Revise Offer</button>
                  <button type="button" className="rx-btn d" onClick={()=>markBackout(c)}>Backout</button>
                </div>
              )
            )}

            {resp==='ACCEPTED'&&row?.acceptance_letter_sent_at&&(
              <div style={{ marginTop:S.md, fontSize:F.micro, color:C.positive }}>{row.candidate_type==='EXPERIENCED'?'Resignation Acceptance':'Joining Confirmation'} letter sent · {new Date(row.acceptance_letter_sent_at).toLocaleDateString('en-IN')}</div>
            )}
            {resp==='REVISE'&&row?.revise_note&&(
              <div style={{ marginTop:10, fontSize:11, color:C.warning, background:C.warningTint, borderRadius:7, padding:'6px 10px' }}>Revision note: {row.revise_note}</div>
            )}
            {resp==='BACKOUT'&&(
              <div style={{ marginTop:10, fontSize:11, color: C.critical, background:C.criticalTint, borderRadius:7, padding:'6px 10px' }}>Blacklisted · MRF reopened{row?.revise_note?` · Reason: ${row.revise_note}`:''}</div>
            )}
            {/* Backout available any day (even after acceptance) — blacklists + reopens the MRF */}
            {(resp==='ACCEPTED'||resp==='REVISE')&&(
              <div style={{ marginTop:10 }}>
                <button type="button" className="rx-btn sm d" onClick={()=>markBackout(c)}>Candidate Backed Out</button>
              </div>
            )}
          </div>
        )
      })}
      </div>
    </RxPage>
  )
}
