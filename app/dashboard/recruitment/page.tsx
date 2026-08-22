'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
import { CreateOfferApproval, HRHeadApprovalDashboard, HRManagerSendOffer, AuditTrailViewer } from './offer-flow-components'
import InterviewPipeline from '@/components/recruitment/InterviewPipeline'

// The design system. This file declares its own Badge and Field, so those are
// deliberately not imported.
import {
  C, F, W, R, E, S, tone, eyebrow, numeric, inputStyle,
} from '@/lib/ui'

// ── TYPES ────────────────────────────────────────────────────────
interface Company { id:string; company_code:string; company_name?:string }
interface Location { id:string; location_code:string; location_name:string; company_id:string }
interface Department { id:string; dept_name:string; dept_code:string; company_id:string }
interface MRF {
  id:string; company_id:string; location_id?:string; department_id?:string
  designation?:string; position?:string; no_of_openings?:number; openings?:number
  urgency?:string; reason?:string; reason_for_hire?:string; status:string
  job_description?:string; employment_type?:string; budget_min?:number; budget_max?:number
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

const STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Shortlisted','Offer Sent','Joined','Rejected']
// A hiring pipeline is ordered — Applied is not "a different kind of thing"
// from Shortlisted, it is earlier. So colour follows the funnel: violet
// deepening as a candidate advances, green once the outcome is good, red when
// it is not. The old map gave ten stages ten unrelated hues, which made a
// ranked sequence look like ten categories and drew the eye equally to all of
// them. Same ramp as the dashboard pipeline chart, so the two agree.
const STAGE_COLOR:Record<string,string> = {
  'Applied':'var(--ez-ramp-1)', 'AI Screened':'var(--ez-ramp-2)', 'Telephonic':'var(--ez-ramp-3)',
  'L1':'var(--ez-ramp-4)', 'L2':'var(--ez-ramp-5)', 'Optional Round':'var(--ez-ramp-6)',
  'Shortlisted':'#0B7A5B', 'Offer Sent':'#0B7A5B', 'Joined':'#0B7A5B',
  'Rejected':'#C42B32',
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
  card: { background:C.surface, borderRadius:R.lg, border:`1px solid ${C.line}`, padding:'14px 16px', marginBottom:S.md, boxShadow:E.raised } as React.CSSProperties,
  cardPurple: { background:C.surface, borderRadius:R.lg, border:`1.5px solid ${C.brand}`, padding:'14px 16px', marginBottom:S.md, boxShadow:E.floating } as React.CSSProperties,
  label: { ...eyebrow, display:'block', marginBottom:5 } as React.CSSProperties,
  input: { ...inputStyle() } as React.CSSProperties,
  select: { ...inputStyle(), cursor:'pointer' } as React.CSSProperties,
  textarea: { ...inputStyle(), height:'auto', minHeight:90, padding:'9px 11px', resize:'vertical' as const, lineHeight:1.5 } as React.CSSProperties,
  btn: { height:36, padding:'0 16px', borderRadius:R.md, border:'none', cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnPrimary: { height:36, padding:'0 16px', borderRadius:R.md, border:`1px solid ${C.brandDeep}`, cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:'#fff', boxShadow:E.brand, whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnOutline: { height:34, padding:'0 13px', borderRadius:R.md, border:`1px solid ${C.lineStrong}`, cursor:'pointer', fontSize:F.small, fontWeight:W.medium, fontFamily:'inherit', background:C.surface, color:C.ink, boxShadow:E.flat, whiteSpace:'nowrap' as const } as React.CSSProperties,
  // Fixed 2/3/4-column grids collapsed badly on a laptop at the app's 130%
  // zoom. auto-fit lets each row find its own column count instead.
  g2: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:S.md } as React.CSSProperties,
  g3: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:S.md } as React.CSSProperties,
  g4: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:S.md } as React.CSSProperties,
  row: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:`1px solid ${C.line}` } as React.CSSProperties,
  section: { ...eyebrow, marginBottom:S.md, marginTop:S.xs, display:'flex', alignItems:'center', gap:8 } as React.CSSProperties,
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

// `f` shape: { company, department, position, location } — all '' means "All".
function RecFilterBar({ companies, departments, locations, positions, f, setF }:any) {
  return (
    <div style={{ ...T.card, display:'flex', gap:12, flexWrap:'wrap' as const, alignItems:'flex-end', position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label style={T.label}>Company</label>
        <select style={T.select} value={f.company} onChange={e=>setF({ ...f, company:e.target.value, department:'', location:'' })}>
          <option value="">All companies</option>
          {(companies||[]).map((c:any)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label style={T.label}>Department</label>
        <select style={T.select} value={f.department} onChange={e=>setF({ ...f, department:e.target.value })}>
          <option value="">All departments</option>
          {(() => {
            const vis = (departments||[]).filter((d:any)=>!f.company||d.company_id===f.company)
            return vis.map((d:any)=><option key={d.id} value={d.id}>{deptLabel(d, vis, companies||[])}</option>)
          })()}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label style={T.label}>Position</label>
        <select style={T.select} value={f.position} onChange={e=>setF({ ...f, position:e.target.value })}>
          <option value="">All positions</option>
          {(positions||[]).map((p:string)=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div style={{ flex:'1 1 160px', minWidth:140 }}>
        <label style={T.label}>Location</label>
        <select style={T.select} value={f.location} onChange={e=>setF({ ...f, location:e.target.value })}>
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
    'Offer Sent':['#ECFEFF','#0891B2'], Joined:[C.positiveTint,C.positive],
    CREATED:[C.warningTint,C.warning], SENT:[C.infoTint,C.info],
    OPENED:[C.brandTint,C.brandDeep], SUBMITTED_PRE:[C.positiveTint,C.positive],
    'Quick Hire':['#FFF7ED','#EA580C'], 'Full MRF':['#EEF2FF','#4338CA'],
    'Revised Offer':[C.warningTint,C.warning], 'Blacklisted':[C.criticalTint,C.critical],
  }
  const [bg,c] = map[text] || [C.brandTint,C.brandDeep]
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{text}</span>
}

function Toast({ msg, type, onClose }:{ msg:string, type:'success'|'error', onClose:()=>void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
      background:type==='success'?C.positive:C.critical, color:'#fff',
      borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500,
      boxShadow:'0 8px 24px rgba(0,0,0,0.2)', display:'flex', alignItems:'center', gap:10 }}>
      {type==='success'?'':''} {msg}
      <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
    </div>
  )
}

function SectionLine({ title }:{ title:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, margin:'14px 0 10px' }}>
      <div style={{ fontSize:11, fontWeight:600, color:C.brand, textTransform:'uppercase' as const, letterSpacing:'.06em', whiteSpace:'nowrap' as const }}>{title}</div>
      <div style={{ flex:1, height:1, background:C.brandTint }} />
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────
export default function RecruitmentPage() {
  const [tab, setTab] = useState<'dashboard'|'mrf'|'screening'|'pipeline'|'negotiation'|'offerapproval'|'hrhead'|'sendoffer'|'offers'|'preonboarding'|'jobstatus'>('dashboard')
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
      const [{ data:co },{ data:lo },{ data:de },{ data:mrf },{ data:cand }] = await Promise.all([
        supabase.from('companies').select('id,company_code,company_name').order('company_code'),
        supabase.from('locations').select('id,location_code,location_name,company_id').order('location_name'),
        supabase.from('departments').select('id,dept_name,dept_code,company_id').order('dept_name'),
        supabase.from('manpower_requisitions').select('*').order('created_at',{ ascending:false }),
        supabase.from('candidates').select('*').order('created_at',{ ascending:false }),
      ])
      setCompanies(co||[]); setLocations(lo||[]); setDepartments(de||[])
      setMrfs(mrf||[]); setCandidates(cand||[])
    } catch(e) { showNotify('Data load error','error') }
    setLoading(false)
  }, [supabase, showNotify])

  useEffect(() => { loadAll() }, [loadAll])

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
  const props = { supabase, companies, locations, departments, mrfs, candidates, onRefresh:loadAll, showNotify }

  if (loading) return (
    <div style={{ ...T.page, display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div style={{ color:C.brand, fontSize:14, fontWeight:500 }}>Loading...</div>
    </div>
  )

  return (
    <div style={T.page}>
      {/* Header */}
      <div style={{ padding:`${S.xl}px ${S.xl}px ${S.lg}px` }}>
        <h1 style={{ margin:0, fontSize:F.page, fontWeight:W.bold, color:C.ink, letterSpacing:'-.02em' }}>
          Recruitment &amp; ATS
        </h1>
        <div style={{ marginTop:5, fontSize:F.small, color:C.muted }}>
          MRF → AI Screening → Pipeline → Negotiation → Offer → Pre-onboarding
        </div>
      </div>

      {/* Tabs */}
      <div className="ez-scroll" style={{ background:C.surface, display:'flex', gap:6, padding:`10px ${S.xl}px`,
                    borderTop:`1px solid ${C.line}`, borderBottom:`1px solid ${C.line}`,
                    overflowX:'auto', position:'sticky', top:0, zIndex:30, boxShadow:E.flat }}>
        {TABS.map(t => {
          const on = tab === t.k
          return (
            // Pill tabs — same shape as the Onboarding page's join-window buttons.
            <button key={t.k} onClick={() => setTab(t.k as any)}
              style={{ padding:'6px 13px', borderRadius:99, border:'0.5px solid '+(on?C.brand:C.brandTint),
                cursor:'pointer', fontSize:11.5, fontWeight:on?600:500, fontFamily:'inherit',
                background:on?C.brand:C.sunken, color:on?'#fff':C.ink, whiteSpace:'nowrap', flexShrink:0 }}>
              {t.l}
            </button>
          )
        })}
      </div>

      <div style={{ padding:'18px 24px', maxWidth:1300 }}>
        {tab==='dashboard' && <DashTab {...props} />}
        {tab==='mrf' && <MRFTab {...props} />}
        {tab==='screening' && <ScreeningTab {...props} />}
        {tab==='pipeline' && <PipelineTab {...props} />}
        {tab==='negotiation' && <NegotiationTab {...props} />}
        {tab==='offerapproval' && <OfferApprovalTab {...props} />}
        {tab==='hrhead' && <HRHeadApprovalDashboard companies={companies} departments={departments} locations={locations} mrfs={mrfs} />}
        {tab==='sendoffer' && <HRManagerSendOffer companies={companies} departments={departments} locations={locations} mrfs={mrfs} />}
        {tab==='offers' && <OffersTab {...props} />}
        {tab==='preonboarding' && <PreOnboardTab {...props} />}
        {tab==='jobstatus' && <JobStatusTab {...props} />}
      </div>

      {notify && <Toast msg={notify.msg} type={notify.type} onClose={() => setNotify(null)} />}
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────
function DashTab({ mrfs, candidates }:any) {
  const approved = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const openings = approved.reduce((s:number,m:MRF)=>s+(m.no_of_openings||m.openings||0),0)
  const joined = candidates.filter((c:Candidate)=>c.stage==='Joined'&&new Date(c.created_at).getMonth()===new Date().getMonth())
  const stageCount = STAGES.reduce((a:any,s)=>{ a[s]=candidates.filter((c:Candidate)=>c.stage===s).length; return a },{})

  return (
    <div>
      <div style={T.g4}>
        {[{l:'Total MRFs',v:mrfs.length,c:C.ink},
          {l:'Active Openings',v:openings,c:C.ink},
          {l:'In Pipeline',v:candidates.length,c:C.brandDeep},
          {l:'Joined This Month',v:joined.length,c:C.positive}].map(s=>(
          <div key={s.l} style={{ ...T.card, boxShadow:E.flat }}>
            <div style={{ ...eyebrow, lineHeight:1.3, minHeight:27 }}>{s.l}</div>
            <div style={{ fontSize:F.display, fontWeight:W.bold, color:s.c, marginTop:4,
                          letterSpacing:'-.02em', lineHeight:1.05, ...numeric }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={T.card}>
        <div style={T.section}>Pipeline Overview</div>
        {/* Ten stages, five columns — a deliberate 5x2. auto-fit gave nine and
            stranded "Rejected" alone on the second row; ten across does not
            fit the content column at the app's 130% zoom. */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:8 }}>
          {STAGES.map(s=>(
            <div key={s} style={{ background:C.surface, borderRadius:R.md, padding:'9px 12px',
                                  textAlign:'center' as const, minWidth:76,
                                  border:`1px solid ${C.line}`,
                                  borderTop:`2px solid ${STAGE_COLOR[s]}` }}>
              <div style={{ fontSize:F.title, fontWeight:W.bold, color:STAGE_COLOR[s], ...numeric }}>{stageCount[s]||0}</div>
              <div style={{ fontSize:9, color:C.muted, marginTop:2, lineHeight:1.3 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={T.g2}>
        <div style={T.card}>
          <div style={T.section}>Recent MRFs</div>
          {mrfs.slice(0,5).map((m:MRF)=>(
            <div key={m.id} style={T.row}>
              <div>
                <div style={{ fontSize:13, fontWeight:500 }}>{m.designation||m.position||'—'}</div>
                <div style={{ fontSize:11, color:C.faint, marginTop:1 }}>{m.employment_type} · {m.no_of_openings||m.openings||0} openings</div>
              </div>
              <Badge text={m.status} />
            </div>
          ))}
        </div>
        <div style={T.card}>
          <div style={T.section}>MRF Status</div>
          {['DRAFT','SUBMITTED','APPROVED','CLOSED','REJECTED'].map(st=>(
            <div key={st} style={T.row}>
              <Badge text={st} />
              <span style={{ fontSize:14, fontWeight:600, color:C.ink }}>{mrfs.filter((m:MRF)=>m.status===st).length}</span>
            </div>
          ))}
        </div>
      </div>
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
        <input style={T.input} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search skills — type e.g. 'py' then pick, or add custom"
          onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); if(matches[0]) add(matches[0]); else if(q.trim()&&!exact) addCustom() } }} />
        {q.trim() && (matches.length>0 || !exact) && (
          <div style={{ position:'absolute' as const, top:'100%', left:0, right:0, background:'#fff', border:'1px solid #DDD6FE', borderRadius:7, marginTop:2, zIndex:20, maxHeight:200, overflowY:'auto' as const, boxShadow:'0 6px 18px rgba(0,0,0,.1)' }}>
            {matches.map(s=>(
              <div key={s} onClick={()=>add(s)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:C.ink }}>{s}</div>
            ))}
            {!exact && q.trim() && (
              <div onClick={addCustom} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:C.brand, fontWeight:600, borderTop:matches.length?'1px solid #F3F0FF':'none' }}>+ Add custom: “{q.trim()}”</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reusable search: type, then press Apply (or Enter). Clear resets it. ──
function SearchBar({ placeholder, onApply, width=300 }:{ placeholder:string; onApply:(q:string)=>void; width?:number }) {
  const [draft, setDraft] = useState('')
  return (
    <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center', flexWrap:'wrap' as const }}>
      <input style={{ ...T.input, maxWidth:width }} value={draft} placeholder={placeholder}
        onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') onApply(draft.trim()) }} />
      <button style={T.btnPrimary} onClick={()=>onApply(draft.trim())}>Apply</button>
      {draft && <button style={T.btnOutline} onClick={()=>{ setDraft(''); onApply('') }}>Clear</button>}
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
const MRF_STATUSES = ['DRAFT','SUBMITTED','ON_HOLD','APPROVED','REJECTED','CLOSED']
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

const URGENCY_STYLE:Record<string,[string,string]> = {
  HIGH:[C.criticalTint,C.critical], MEDIUM:[C.warningTint,C.warning], LOW:[C.positiveTint,C.positive],
}
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
const COMPENSATION:Record<string,{ kind:'SALARY'|'STIPEND'|'FEES'; label:string; period:'ANNUAL'|'MONTHLY'; fixedTerm:boolean; ph:[string,string] }> = {
  'Employee':     { kind:'SALARY',  label:'Salary',  period:'ANNUAL',  fixedTerm:false, ph:['600000','1200000'] },
  'Intern':       { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['10000','25000'] },
  'NAPS':         { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['9000','15000'] },
  'NATS':         { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['9000','15000'] },
  'Live Project': { kind:'STIPEND', label:'Stipend', period:'MONTHLY', fixedTerm:true,  ph:['5000','15000'] },
  'Contract':     { kind:'FEES',    label:'Fees',    period:'MONTHLY', fixedTerm:true,  ph:['50000','120000'] },
  'Consultant':   { kind:'FEES',    label:'Fees',    period:'MONTHLY', fixedTerm:false, ph:['75000','200000'] },
}
const compOf = (empType?:string) => COMPENSATION[empType||'Employee'] || COMPENSATION['Employee']
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
      <label style={T.label}>{label}{required && <span style={{ color:C.critical }}> *</span>}</label>
      {children}
      {error ? <div style={{ fontSize:10.5, color:C.critical, marginTop:3 }}>⚠ {error}</div>
             : hint ? <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{hint}</div> : null}
    </div>
  )
}

function MrfMeta({ label, value }:{ label:string; value:React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em' }}>{label}</div>
      <div style={{ fontSize:12.5, color:C.ink, marginTop:2 }}>{value ?? '—'}</div>
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
    <select style={style||T.select} value={value||''} onChange={e=>onChange(e.target.value)}>
      <option value="">{options?.length ? (placeholder||'Select…') : 'No options configured'}</option>
      {(options||[]).map((o:any)=>
        <option key={o.code} value={useCode ? o.code : o.label}>{o.label}</option>)}
    </select>
  )
}

// The recruitment upload/share routes run on the service-role key, so they check for a
// dashboard session of their own. The browser already holds one — this hands it over.
async function authHeaders(supabase:any): Promise<Record<string,string>> {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// ── §7 CTQ QUESTION EDITOR ────────────────────────────────────────
function CtqEditor({ items, onChange }:{ items:any[]; onChange:(v:any[])=>void }) {
  const add = () => onChange([...items, { id:`q${Date.now()}`, question:'', type:'YES_NO', expected:'Yes', knockout:true }])
  const set = (i:number, patch:any) => onChange(items.map((q,ix)=> ix===i ? { ...q, ...patch } : q))
  const del = (i:number) => onChange(items.filter((_,ix)=>ix!==i))
  return (
    <div>
      {items.length===0 && (
        <div style={{ fontSize:11.5, color:C.faint, marginBottom:8 }}>
          No screening questions. Add one to auto-reject applicants who miss a baseline requirement.
        </div>
      )}
      {items.map((q,i)=>(
        <div key={q.id||i} style={{ border:'1px solid #EDE9FE', borderRadius:8, padding:'10px 12px', marginBottom:8, background:C.sunken }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:10.5, fontWeight:700, color:C.brandDeep, minWidth:22 }}>Q{i+1}</span>
            <input style={{ ...T.input, flex:1 }} value={q.question||''} placeholder="e.g. Do you have a valid B.Tech degree?"
              onChange={e=>set(i,{ question:e.target.value })} />
            <button onClick={()=>del(i)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FCA5A5', fontSize:11 }}></button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, alignItems:'center' }}>
            <select style={T.select} value={q.type||'YES_NO'} onChange={e=>set(i,{ type:e.target.value, expected: e.target.value==='YES_NO'?'Yes':'' })}>
              {CTQ_TYPES.map(t=><option key={t.k} value={t.k}>{t.label}</option>)}
            </select>
            {q.type==='YES_NO' ? (
              <select style={T.select} value={q.expected||'Yes'} onChange={e=>set(i,{ expected:e.target.value })}>
                <option value="Yes">Expected: Yes</option><option value="No">Expected: No</option>
              </select>
            ) : (
              <input style={T.input} value={q.expected||''} placeholder={q.type==='NUMBER_MIN'?'Minimum value':'Expected answer'}
                onChange={e=>set(i,{ expected:e.target.value })} />
            )}
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, color:C.muted, whiteSpace:'nowrap' as const }}>
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
        <div style={{ fontSize:11.5, color:C.faint, marginBottom:8 }}>
          No chain defined — a single approval will approve this requisition outright.
        </div>
      )}
      {chain.map((s,i)=>(
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 11px', border:'1px solid #EDE9FE',
          borderRadius:8, marginBottom:6, background: s.status==='APPROVED'?C.positiveTint: s.status==='REJECTED'?C.criticalTint:C.sunken }}>
          <span style={{ width:22, height:22, borderRadius:'50%', background:C.brandTint, color:C.brandDeep, fontSize:11,
            fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i+1}</span>
          <span style={{ fontSize:12.5, fontWeight:600, flex:1 }}>{s.role}</span>
          {s.status && s.status!=='PENDING' && <Badge text={s.status} />}
          {s.actor && <span style={{ fontSize:10.5, color:C.faint }}>{s.actor}</span>}
          <button onClick={()=>move(i,-1)} disabled={i===0} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, fontSize:11, opacity:i===0?.4:1 }}></button>
          <button onClick={()=>move(i,1)} disabled={i===chain.length-1} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, fontSize:11, opacity:i===chain.length-1?.4:1 }}></button>
          <button onClick={()=>del(i)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, fontSize:11 }}></button>
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
  if (!options?.length) return <div style={{ fontSize:11.5, color:C.faint }}>No sourcing channels configured in Masters.</div>
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
      {options.map((o:any)=>{
        const on = value.includes(o.label)
        return (
          <button key={o.code} onClick={()=>toggle(o.label)} style={{ ...T.btn, fontSize:11,
            background:on?C.brand:'#fff', color:on?'#fff':C.brandDeep, border:on?'none':'1px solid #DDD6FE' }}>
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
      const r = await fetch('/api/recruitment/upload-mrf-doc', { method:'POST', body:fd, headers: await authHeaders(supabase) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error||'Upload failed')
      showNotify('File uploaded'); onChanged()
    } catch (e:any) { showNotify(e.message||'Upload failed','error') }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function open(path:string) {
    const r = await fetch('/api/recruitment/upload-mrf-doc?path='+encodeURIComponent(path), { headers: await authHeaders(supabase) })
    const j = await r.json()
    if (j.url) window.open(j.url,'_blank'); else showNotify(j.error||'Could not open file','error')
  }

  async function remove(path:string) {
    const r = await fetch(`/api/recruitment/upload-mrf-doc?mrf_id=${mrfId}&path=${encodeURIComponent(path)}`, { method:'DELETE', headers: await authHeaders(supabase) })
    if (r.ok) { showNotify('File removed'); onChanged() } else showNotify('Could not remove file','error')
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' as const, alignItems:'center' }}>
        <select style={{ ...T.select, maxWidth:230 }} value={kind} onChange={e=>setKind(e.target.value)}>
          {ATTACH_KINDS.map(a=><option key={a.k} value={a.k}>{a.label}</option>)}
        </select>
        <input ref={inputRef} type="file" style={{ display:'none' }}
          onChange={e=>{ const f=e.target.files?.[0]; if (f) upload(f) }} />
        <button onClick={()=>inputRef.current?.click()} disabled={busy} style={{ ...T.btnPrimary, opacity:busy?.6:1 }}>
          {busy?'Uploading…':'Upload file'}
        </button>
        <span style={{ fontSize:10.5, color:C.faint }}>Max 10 MB</span>
      </div>
      {attachments.length===0 && <div style={{ fontSize:11.5, color:C.faint }}>No documents attached.</div>}
      {attachments.map((a:any)=>(
        <div key={a.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F3F0FF', gap:10 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:12.5, fontWeight:600, color:C.ink }}>{a.name}</div>
            <div style={{ fontSize:10.5, color:C.faint }}>
              {ATTACH_KINDS.find(k=>k.k===a.kind)?.label||a.kind}
              {a.size?` · ${(a.size/1024).toFixed(0)} KB`:''} · {fmtDay(a.uploaded_at)}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button onClick={()=>open(a.path)} style={T.btnOutline}>Open</button>
            <button onClick={()=>remove(a.path)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FCA5A5', fontSize:11 }}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── MRF OVERVIEW ──────────────────────────────────────────────────
// Headline position maths plus a clickable status breakdown. "Available" is
// the number still to hire on live requisitions — openings on APPROVED MRFs
// that no offer has been made against yet, which is what a recruiter is
// actually working from.
const STATUS_TONE:Record<string,[string,string]> = {
  DRAFT:[C.sunken,C.muted], SUBMITTED:[C.warningTint,C.warning], ON_HOLD:['#FFF7ED','#C2410C'],
  APPROVED:[C.positiveTint,C.positive], REJECTED:[C.criticalTint,C.critical], CLOSED:[C.sunken,C.inkSoft],
}
const STATUS_HELP:Record<string,string> = {
  DRAFT:'Not yet submitted', SUBMITTED:'Waiting on approval', ON_HOLD:'Paused by an approver',
  APPROVED:'Open for hiring', REJECTED:'Turned down', CLOSED:'Filled or withdrawn',
}

function MrfOverview({ mrfs, candidates, fStatus, onPickStatus, view, onView }:any) {
  const filledFor = (m:MRF) => candidates.filter((c:Candidate)=>
    c.mrf_id===m.id && (c.stage==='Offer Sent'||c.stage==='Joined')).length
  const openingsOf = (m:MRF) => m.no_of_openings || m.openings || 0

  const live      = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const totalOpen = live.reduce((s:number,m:MRF)=>s+openingsOf(m), 0)
  const totalFill = live.reduce((s:number,m:MRF)=>s+Math.min(filledFor(m), openingsOf(m)), 0)
  const available = Math.max(0, totalOpen - totalFill)
  const counts = Object.fromEntries(MRF_STATUSES.map(s=>[s, mrfs.filter((m:MRF)=>m.status===s).length]))
  const expiring = mrfs.filter((m:MRF)=>{
    const v = (m as any).validity_date
    if (!v || ['CLOSED','REJECTED'].includes(m.status)) return false
    const days = Math.ceil((+new Date(v) - +new Date(new Date().toDateString()))/86400000)
    return days <= 14
  }).length

  const Tile = ({ label, value, sub, color }:any) => (
    <div style={{ background:C.surface, border:'1px solid rgba(124,58,237,0.12)', borderRadius:10, padding:'11px 13px' }}>
      <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em' }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, marginTop:2, color:color||C.ink }}>{value}</div>
      {sub && <div style={{ fontSize:10.5, color:C.faint, marginTop:1 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ ...T.card, padding:'14px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:11, gap:10, flexWrap:'wrap' as const }}>
        <div style={T.section}>Requisition Overview</div>
        <div style={{ display:'flex', gap:6 }}>
          {[['cards','Cards'],['table','List']].map(([k,l])=>(
            <button key={k} onClick={()=>onView(k)} style={{ ...T.btn, fontSize:11,
              background:view===k?C.brand:'#fff', color:view===k?'#fff':C.brandDeep,
              border:view===k?'none':'1px solid #DDD6FE' }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:9, marginBottom:13 }}>
        <Tile label="Total MRFs" value={mrfs.length} color={C.brand} />
        <Tile label="Open Positions" value={totalOpen} sub="on approved MRFs" color={C.info} />
        <Tile label="Available to Hire" value={available} sub={`${totalFill} already filled`} color={available?C.positive:C.faint} />
        <Tile label="Pending Approval" value={counts.SUBMITTED} sub={counts.ON_HOLD?`${counts.ON_HOLD} on hold`:'awaiting sign-off'} color={counts.SUBMITTED?C.warning:C.faint} />
        <Tile label="Approved" value={counts.APPROVED} sub="live requisitions" color={C.positive} />
        {expiring>0 && <Tile label="Expiring Soon" value={expiring} sub="within 14 days" color={C.critical} />}
      </div>

      {/* Proportional bar — the shape of the pipeline at a glance. */}
      {mrfs.length>0 && (
        <div style={{ display:'flex', height:7, borderRadius:99, overflow:'hidden', marginBottom:10, background:C.brandTint }}>
          {MRF_STATUSES.filter(s=>counts[s]>0).map(s=>(
            <div key={s} title={`${s.replace('_',' ')}: ${counts[s]}`}
              style={{ width:`${(counts[s]/mrfs.length)*100}%`, background:STATUS_TONE[s][1] }} />
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:7, flexWrap:'wrap' as const }}>
        <button onClick={()=>onPickStatus('')} style={{ ...T.btn, fontSize:11,
          background: fStatus===''?C.brand:'#fff', color: fStatus===''?'#fff':C.brandDeep,
          border: fStatus===''?'none':'1px solid #DDD6FE' }}>
          All <span style={{ fontWeight:700 }}>{mrfs.length}</span>
        </button>
        {MRF_STATUSES.map(s=>{
          const on = fStatus===s
          const [bg,fg] = STATUS_TONE[s]
          return (
            <button key={s} onClick={()=>onPickStatus(on?'':s)} title={STATUS_HELP[s]}
              style={{ ...T.btn, fontSize:11, display:'flex', alignItems:'center', gap:6,
                background:on?fg:bg, color:on?'#fff':fg, border:'1px solid '+(on?fg:'transparent'),
                opacity: counts[s]===0 && !on ? .55 : 1 }}>
              {s.replace('_',' ')}<span style={{ fontWeight:700 }}>{counts[s]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── MRF TABLE (list view) ─────────────────────────────────────────
function MrfTable({ rows, orgOf, candidates, onOpen, onReview }:any) {
  const th:React.CSSProperties = { fontSize:10, color:C.brandDeep, fontWeight:600, textTransform:'uppercase',
    letterSpacing:'.05em', textAlign:'left', padding:'8px 10px', borderBottom:'1px solid #EDE9FE', whiteSpace:'nowrap' }
  const td:React.CSSProperties = { fontSize:12, color:C.ink, padding:'9px 10px', borderBottom:'1px solid #F3F0FF', verticalAlign:'middle' }
  return (
    <div style={{ ...T.card, padding:0, overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
        <thead>
          <tr>
            <th style={th}>MRF No.</th><th style={th}>Position</th><th style={th}>Department</th>
            <th style={th}>Type</th><th style={{ ...th, textAlign:'center' }}>Openings</th>
            <th style={{ ...th, textAlign:'center' }}>Filled</th><th style={th}>Status</th>
            <th style={th}>Recruiter</th><th style={th}>Target</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m:MRF)=>{
            const org = orgOf(m)
            const openings = m.no_of_openings||m.openings||0
            const filled = candidates.filter((c:Candidate)=>c.mrf_id===m.id && (c.stage==='Offer Sent'||c.stage==='Joined')).length
            return (
              <tr key={m.id} style={{ cursor:'pointer' }} onClick={()=>onOpen(m)}>
                <td style={{ ...td, color:C.muted, whiteSpace:'nowrap' }}>{m.mrf_number||'—'}</td>
                <td style={td}>
                  <div style={{ fontWeight:600 }}>{(m as any).job_title||m.designation||m.position||'Untitled'}</div>
                  {(m as any).grade && <div style={{ fontSize:10.5, color:C.faint }}>{(m as any).grade}</div>}
                </td>
                <td style={{ ...td, color:C.muted }}>{org.dept}</td>
                <td style={{ ...td, color:C.muted, whiteSpace:'nowrap' }}>
                  {m.employment_type||'—'}{(m as any).work_mode?` · ${(m as any).work_mode}`:''}
                </td>
                <td style={{ ...td, textAlign:'center', fontWeight:600 }}>{openings}</td>
                <td style={{ ...td, textAlign:'center', color: filled>=openings&&openings>0?C.positive:C.muted }}>{filled}</td>
                <td style={td}><Badge text={m.status} /></td>
                <td style={{ ...td, color:C.muted }}>{m.assigned_recruiter||'—'}</td>
                <td style={{ ...td, color:C.muted, whiteSpace:'nowrap' }}>{fmtDay((m as any).target_joining_date)}</td>
                <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                  {(m.status==='SUBMITTED'||m.status==='ON_HOLD') && (
                    <button onClick={e=>{ e.stopPropagation(); onReview(m) }}
                      style={{ ...T.btn, background:C.brand, color:'#fff', fontSize:10.5 }}>Review</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length===0 && (
        <div style={{ padding:26, textAlign:'center', color:C.faint, fontSize:12.5 }}>No requisitions match.</div>
      )}
    </div>
  )
}

// ── MRF CARD ──────────────────────────────────────────────────────
function MrfCard({ m, org, cands, onOpen, onEdit, onDelete, onReview, onClose, onReopen }:any) {
  const openings = m.no_of_openings || m.openings || 0
  const filled = cands.filter((c:Candidate)=>c.stage==='Offer Sent'||c.stage==='Joined').length
  const pct = openings ? Math.min(100, (filled/openings)*100) : 0
  const [ubg,uc] = URGENCY_STYLE[m.urgency] || [C.brandTint,C.brandDeep]
  const chain = asArray(m.approval_chain)
  const doneSteps = chain.filter((s:any)=>s.status==='APPROVED').length
  // §6 — flag a requisition that has run past its validity date.
  const expired = m.validity_date && new Date(m.validity_date) < new Date(new Date().toDateString())
    && !['CLOSED','REJECTED'].includes(m.status)
  return (
    <div style={T.card}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
        <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={()=>onOpen(m)}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4, flexWrap:'wrap' as const }}>
            <span style={{ fontSize:14, fontWeight:600, color:C.ink }}>{m.job_title||m.designation||m.position||'Untitled'}</span>
            <Badge text={m.status} />
            {m.mrf_type && <Badge text={m.mrf_type} />}
            {m.urgency && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, background:ubg, color:uc, fontWeight:600 }}>{m.urgency}</span>}
            {expired && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, background:C.criticalTint, color:C.critical, fontWeight:600 }}>EXPIRED</span>}
          </div>
          <div style={{ fontSize:11, color:C.faint, marginBottom:6 }}>
            {m.mrf_number || 'No MRF number'} · {org.company} · {org.dept} · {org.loc}
            {m.business_unit?` · ${m.business_unit}`:''}
          </div>
          <div style={{ fontSize:12, color:C.faint, display:'flex', gap:14, flexWrap:'wrap' as const }}>
            <span>👥 {openings} opening{openings===1?'':'s'}</span>
            <span>💼 {m.employment_type||'—'}</span>
            {m.work_mode && <span>🏢 {m.work_mode}</span>}
            {m.grade && <span>🏷 {m.grade}</span>}
            {m.experience_required && <span>⏱ {m.experience_required}</span>}
            {m.budget_max && <span>💰 {compOf(m.employment_type).label} {payAmount(m.budget_max, m.currency, compOf(m.employment_type).period)} max</span>}
            {m.duration_months && <span>⏳ {m.duration_months} month{m.duration_months===1?'':'s'}</span>}
            {m.target_joining_date && <span>📅 by {fmtDay(m.target_joining_date)}</span>}
            <span style={{ color:C.brand }}>🧑 {cands.length} candidate{cands.length===1?'':'s'}</span>
            {m.assigned_recruiter && <span>👤 {m.assigned_recruiter}</span>}
          </div>
          {m.skills_required && (
            <div style={{ fontSize:11, color:C.brandDeep, marginTop:5 }}>Skills: {m.skills_required}</div>
          )}
          {m.status==='REJECTED' && m.remarks && (
            <div style={{ fontSize:11, color:C.critical, marginTop:5 }}>Rejected: {m.remarks}</div>
          )}
          {chain.length>0 && m.status!=='CLOSED' && (
            <div style={{ fontSize:11, color:C.muted, marginTop:5 }}>
              Approvals: {doneSteps}/{chain.length}
              {chain.map((s:any,i:number)=>(
                <span key={i} style={{ marginLeft:5, color: s.status==='APPROVED'?C.positive: s.status==='REJECTED'?C.critical:C.lineStrong }}>
                  {s.status==='APPROVED'?'':s.status==='REJECTED'?'':''}
                </span>
              ))}
            </div>
          )}
          {openings > 0 && (m.status==='APPROVED'||m.status==='CLOSED') && (
            <div style={{ marginTop:8, maxWidth:260 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, color:C.faint, marginBottom:3 }}>
                <span>Positions filled</span><span>{filled} / {openings}</span>
              </div>
              <div style={{ background:C.brandTint, borderRadius:99, height:5, overflow:'hidden' }}>
                <div style={{ width:`${pct}%`, height:'100%', background: pct>=100?C.positive:C.brand, borderRadius:99 }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center', flexWrap:'wrap' as const, justifyContent:'flex-end', maxWidth:290 }}>
          <button onClick={()=>onOpen(m)} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, border:'1px solid #DDD6FE', fontSize:11 }}>View</button>
          {(m.status==='SUBMITTED'||m.status==='ON_HOLD')&&(
            <button onClick={()=>onReview(m)} style={{ ...T.btn, background:C.brand, color:'#fff', fontSize:11 }}>Review & Approve</button>
          )}
          {m.status==='APPROVED' && (
            <button onClick={()=>onClose(m)} style={{ ...T.btn, background:C.sunken, color:C.inkSoft, border:'1px solid #CBD5E1', fontSize:11 }}>Close MRF</button>
          )}
          {m.status==='CLOSED' && (
            <button onClick={()=>onReopen(m)} style={{ ...T.btn, background:C.positiveTint, color:C.positive, border:'1px solid #A7F3D0', fontSize:11 }}>Re-open</button>
          )}
          <button onClick={()=>onEdit(m)} style={{ ...T.btn, background:C.infoTint, color:C.info, border:'1px solid #BFDBFE', fontSize:11 }}>Edit</button>
          <button onClick={()=>onDelete(m.id)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FCA5A5', fontSize:11 }}></button>
        </div>
      </div>
    </div>
  )
}

// ── MRF DETAIL ────────────────────────────────────────────────────
function MrfDetail({ supabase, mrf:m, org, cands, people, onClose, onEdit, onReview, onChanged, showNotify }:any) {
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

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:200, display:'flex', justifyContent:'flex-end' }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.canvas, width:'100%', maxWidth:760, height:'100%', overflowY:'auto', boxShadow:'-8px 0 30px rgba(30,27,75,0.25)' }}>
        {/* Header */}
        <div style={{ background:'linear-gradient(135deg,#7C3AED,#4F46E5)', padding:'16px 20px', position:'sticky', top:0, zIndex:2 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:17, fontWeight:700, color:'#fff' }}>{m.job_title||m.designation||m.position||'Untitled'}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,.75)', marginTop:3 }}>
                {m.mrf_number||'No MRF number'} · {org.company}
              </div>
            </div>
            <button onClick={onClose} style={{ border:'1px solid rgba(255,255,255,.3)', background:'transparent', color:'#fff', borderRadius:7, padding:'6px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit', flexShrink:0 }}>Close</button>
          </div>
          <div style={{ display:'flex', gap:7, marginTop:10, flexWrap:'wrap' as const }}>
            <Badge text={m.status} />
            {m.mrf_type && <Badge text={m.mrf_type} />}
            {m.urgency && <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:'rgba(255,255,255,.2)', color:'#fff', fontWeight:600 }}>{m.urgency} priority</span>}
            {m.work_mode && <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:'rgba(255,255,255,.2)', color:'#fff', fontWeight:600 }}>{m.work_mode}</span>}
          </div>
        </div>

        <div style={{ padding:'16px 20px' }}>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' as const }}>
            <button onClick={()=>{ onEdit(m); onClose() }} style={T.btnOutline}>Edit this MRF</button>
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
              <MrfMeta label="Reporting Manager" value={m.reporting_manager_id ? nameOf(m.reporting_manager_id) : '—'} />
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
              <div style={{ fontSize:12.5, color:C.inkSoft, lineHeight:1.7, whiteSpace:'pre-wrap' as const, borderTop:'1px solid #F3F0FF', paddingTop:9 }}>
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
                <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:5 }}>Mandatory Skills</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                  {String(m.skills_required).split(',').map((s:string)=>s.trim()).filter(Boolean).map((s:string)=>(
                    <span key={s} style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:C.brandTint, color:C.brandDeep, fontWeight:500 }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {m.good_to_have_skills && (
              <div>
                <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:5 }}>Good-to-have Skills</div>
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
                <div key={q.id||i} style={{ padding:'8px 0', borderBottom:'1px solid #F3F0FF' }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:C.ink }}>Q{i+1}. {q.question}</div>
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
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 0', borderBottom:'1px solid #F3F0FF' }}>
                <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, fontSize:11, fontWeight:700,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background: s.status==='APPROVED'?C.positiveTint: s.status==='REJECTED'?C.criticalTint:C.brandTint,
                  color: s.status==='APPROVED'?C.positive: s.status==='REJECTED'?C.critical:C.brandDeep }}>
                  {s.status==='APPROVED'?'':s.status==='REJECTED'?'':i+1}
                </span>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12.5, fontWeight:600 }}>{s.role}</div>
                  <div style={{ fontSize:10.5, color:C.faint }}>
                    {s.status||'PENDING'}{s.actor?` · ${s.actor}`:''}{s.acted_at?` · ${fmtDay(s.acted_at)}`:''}
                  </div>
                  {s.comments && <div style={{ fontSize:11.5, color:C.muted, marginTop:3, fontStyle:'italic' as const }}>{s.comments}</div>}
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
                <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:5 }}>Preferred Channels</div>
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
              <div style={{ fontSize:12.5, color:C.inkSoft, lineHeight:1.75, whiteSpace:'pre-wrap' as const }}>{m.job_description}</div>
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
                  <span style={{ fontSize:11.5, fontWeight:600, color:C.ink }}>{stage}</span>
                  <span style={{ fontSize:10.5, color:C.faint }}>{rows.length}</span>
                </div>
                {rows.map((c:Candidate)=>(
                  <div key={c.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 5px 15px', fontSize:12, borderBottom:'1px solid #F9FAFB' }}>
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
              <div key={l.id} style={{ display:'flex', gap:10, padding:'7px 0', borderBottom:'1px solid #F3F0FF' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:C.brand, marginTop:5, flexShrink:0 }} />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:C.ink }}>{String(l.action_type||'').replace(/_/g,' ')}</div>
                  {l.details && (
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                      {Object.entries(l.details).map(([k,v])=>`${k}: ${v}`).join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize:10, color:C.faint, marginTop:2 }}>
                    {fmtDT(l.created_at)}{l.actor_email?` · ${l.actor_email}`:''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MRF TAB ───────────────────────────────────────────────────────
function MRFTab({ supabase, companies, locations, departments, mrfs, candidates, onRefresh, showNotify }:any) {
  const EMPTY = {
    // §1 Requisition Meta
    mrf_type:'Full MRF', hiring_type:'New Hire', urgency:'MEDIUM',
    raised_by_name:'', raised_by_role:'',
    // §2 Position Details
    company_id:'', location_id:'', department_id:'', job_title:'', designation:'',
    business_unit:'', grade:'', job_code:'', reporting_manager_id:'', no_of_openings:1,
    // §3 Employment Details
    employment_type:'Employee', work_mode:'Onsite', shift_schedule:'',
    // §4 Budget & Cost
    cost_center:'', is_budgeted:'', headcount_ref:'', budget_min:'', budget_max:'', currency:'INR',
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
  const [showForm, setShowForm] = useState(false)
  const [editMRF, setEditMRF] = useState<MRF|null>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [errors, setErrors] = useState<Record<string,string>>({})
  const [saving, setSaving] = useState(false)
  const [mrfQ, setMrfQ] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fPos, setFPos] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [view, setView] = useState<'cards'|'table'>('cards')
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

  const filtLocs = form.company_id ? locations.filter((l:Location)=>l.company_id===form.company_id) : locations
  const filtDepts = form.company_id ? departments.filter((d:Department)=>d.company_id===form.company_id) : departments
  const F = (k:string,v:any) => { setForm((f:any)=>({...f,[k]:v})); setErrors(e=> e[k] ? { ...e, [k]:'' } : e) }
  const eb = (k:string) => errors[k] ? { ...T.input, border:'1px solid #FCA5A5', background:C.criticalTint } : T.input

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

  function openEdit(m:MRF) {
    setEditMRF(m); setErrors({})
    const a:any = m
    setForm({
      mrf_type:a.mrf_type||'Full MRF', hiring_type:a.hiring_type||'New Hire', urgency:m.urgency||'MEDIUM',
      raised_by_name:a.raised_by_name||'', raised_by_role:a.raised_by_role||'',
      company_id:m.company_id||'', location_id:m.location_id||'', department_id:m.department_id||'',
      job_title:a.job_title||m.designation||m.position||'', designation:m.designation||m.position||'',
      business_unit:a.business_unit||'', grade:a.grade||'', job_code:a.job_code||'',
      reporting_manager_id:a.reporting_manager_id||'', no_of_openings:m.no_of_openings||m.openings||1,
      employment_type:m.employment_type||'Employee', work_mode:a.work_mode||'Onsite', shift_schedule:a.shift_schedule||'',
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
        method:'POST', headers:{'Content-Type':'application/json'},
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
    const payload:any = {
      company_id:form.company_id, location_id:form.location_id||null, department_id:form.department_id||null,
      designation:form.designation, position:form.designation,
      job_title:form.job_title||form.designation||null,
      no_of_openings:Number(form.no_of_openings)||1, openings:Number(form.no_of_openings)||1,
      employment_type:form.employment_type, urgency:form.urgency,
      reason:form.reason, reason_for_hire:form.reason,
      job_description:form.job_description||null, status,
      budget_min:Number(form.budget_min)||null, budget_max:Number(form.budget_max)||null,
      experience_required:expReq, experience_min:form.experience_min||null, experience_max:form.experience_max||null,
      education_required:eduReq, education_min:form.education_min||null, education_max:form.education_max||null,
      skills_required:form.skills_required||null,
      mrf_type:form.mrf_type||null, hiring_type:form.hiring_type||null,
      previous_company_preference:form.previous_company_preference||null,
      // ── added by 032 ──
      raised_by_name:form.raised_by_name||null, raised_by_role:form.raised_by_role||null,
      business_unit:form.business_unit||null, grade:form.grade||null, job_code:form.job_code||null,
      reporting_manager_id:form.reporting_manager_id||null,
      reports_to_designation: mgr?.designation || null,
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
      ctq_questions:form.ctq_questions||[], approval_chain:form.approval_chain||[],
      sourcing_mode:form.sourcing_mode||null, sourcing_channels:form.sourcing_channels||[],
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

  const visible = mrfs.filter((m:MRF)=>
    (!mrfQ || (m.designation||(m as any).position||'').toLowerCase().includes(mrfQ.toLowerCase())
           || ((m as any).job_title||'').toLowerCase().includes(mrfQ.toLowerCase())
           || (m.mrf_number||'').toLowerCase().includes(mrfQ.toLowerCase())) &&
    (!fCompany || m.company_id===fCompany) &&
    (!fDept || m.department_id===fDept) &&
    (!fLoc || m.location_id===fLoc) &&
    (!fPos || (m.designation||m.position)===fPos) &&
    (!fStatus || m.status===fStatus)
  ).sort((a:MRF,b:MRF)=>{
    if (sortBy==='oldest')   return +new Date(a.created_at) - +new Date(b.created_at)
    if (sortBy==='openings') return (b.no_of_openings||b.openings||0) - (a.no_of_openings||a.openings||0)
    if (sortBy==='urgency')  { const r:any={HIGH:0,MEDIUM:1,LOW:2}; return (r[a.urgency||'']??3)-(r[b.urgency||'']??3) }
    if (sortBy==='joining')  return +new Date((a as any).target_joining_date||'2999-01-01') - +new Date((b as any).target_joining_date||'2999-01-01')
    return +new Date(b.created_at) - +new Date(a.created_at)
  })

  const pendingCount = mrfs.filter((m:MRF)=>m.status==='SUBMITTED').length

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:10, flexWrap:'wrap' as const }}>
        <div style={{ fontSize:15, fontWeight:600, color:C.ink }}>Manpower Requisitions ({mrfs.length})</div>
        <button onClick={()=>{setEditMRF(null);setForm(EMPTY);setErrors({});setShowForm(!showForm)}} style={T.btnPrimary}>
          {showForm?'Cancel':'+ New MRF'}
        </button>
      </div>

      <MrfOverview mrfs={mrfs} candidates={candidates} fStatus={fStatus}
        onPickStatus={setFStatus} view={view} onView={setView} />

      {pendingCount>0 && (
        <div style={{ fontSize:11.5, color:C.warning, background:C.warningTint, border:'1px solid #FDE68A',
          borderRadius:7, padding:'8px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
          ⏳ {pendingCount} requisition{pendingCount===1?'':'s'} awaiting approval
          <button onClick={()=>setFStatus('SUBMITTED')} style={{ ...T.btn, background:C.warning, color:'#fff', fontSize:11 }}>
            Show them
          </button>
        </div>
      )}

      {showForm && (
        <div style={T.cardPurple}>
          <div style={{ display:'flex', gap:10, marginBottom:16 }}>
            {['Quick Hire','Full MRF'].map(type=>(
              <button key={type} onClick={()=>F('mrf_type',type)} style={{ ...T.btn, flex:1, padding:'10px',
                background:form.mrf_type===type?C.brand:C.brandTint, color:form.mrf_type===type?'#fff':C.brandDeep,
                border:form.mrf_type===type?'none':'1px solid #DDD6FE', fontSize:13 }}>
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
              <div style={{ background:C.positiveTint, border:'1px solid #A7F3D0', borderRadius:7, padding:'8px 12px',
                marginBottom:14, fontSize:11.5, color:C.positive }}>
                ✓ {asYearly} — correct lane for {form.mrf_type}.
              </div>
            )
            return (
              <div style={{ background:C.criticalTint, border:'1px solid #FECACA', borderRadius:7, padding:'9px 12px',
                marginBottom:14, fontSize:12, color:C.critical, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
                <span>
                  {asYearly} — {shouldBe==='Full MRF'
                    ? 'above ₹6L, so this belongs on a Full MRF.'
                    : 'at or below ₹6L, so this belongs on a Quick Hire.'}
                </span>
                <button onClick={()=>F('mrf_type', shouldBe)} style={{ ...T.btn, background:C.critical, color:'#fff', fontSize:11 }}>
                  Switch to {shouldBe}
                </button>
              </div>
            )
          })()}

          {/* ── §1 Requisition Meta ── */}
          <SectionLine title="1 · Requisition Meta" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Requisition Type">
              <select style={T.select} value={form.hiring_type} onChange={e=>F('hiring_type',e.target.value)}>
                {REQ_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select style={T.select} value={form.urgency} onChange={e=>F('urgency',e.target.value)}>
                <option value="HIGH">High / Urgent</option>
                <option value="MEDIUM">Medium / Normal</option>
                <option value="LOW">Low</option>
              </select>
            </Field>
            <Field label="Requisition ID" hint={editMRF?undefined:'Generated on save'}>
              <input style={{ ...T.input, background:C.sunken, color:C.muted }} value={(editMRF as any)?.mrf_number||'Auto-generated'} readOnly />
            </Field>
          </div>
          <div style={{ ...T.g2, marginBottom:10 }}>
            <Field label="Raised By — Name">
              <input style={T.input} value={form.raised_by_name} onChange={e=>F('raised_by_name',e.target.value)} placeholder="Your name" />
            </Field>
            <Field label="Raised By — Role">
              <input style={T.input} value={form.raised_by_role} onChange={e=>F('raised_by_role',e.target.value)} placeholder="e.g. Department Head" />
            </Field>
          </div>

          {/* ── §2 Position Details ── */}
          <SectionLine title="2 · Position Details" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Company" required error={errors.company_id}>
              <select style={eb('company_id')} value={form.company_id} onChange={e=>F('company_id',e.target.value)}>
                <option value="">Select Company</option>
                {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
              </select>
            </Field>
            <Field label="Department / Function" error={errors.department_id}>
              <select style={eb('department_id')} value={form.department_id} onChange={e=>F('department_id',e.target.value)}>
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
              <input style={T.input} value={form.job_title} onChange={e=>F('job_title',e.target.value)} placeholder="e.g. Backend Engineer II" />
            </Field>
            <Field label="Designation" required error={errors.designation}>
              <input style={eb('designation')} value={form.designation} onChange={e=>F('designation',e.target.value)} placeholder="e.g. Senior Engineer" />
            </Field>
            <Field label="No. of Openings" error={errors.no_of_openings}>
              <input style={eb('no_of_openings')} type="number" min={1} value={form.no_of_openings} onChange={e=>F('no_of_openings',e.target.value)} />
            </Field>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Grade / Band">
              <MasterSelect options={masters.grade} value={form.grade} onChange={(v:string)=>F('grade',v)} />
            </Field>
            <Field label="Job Code" hint="Position-based staffing only">
              <input style={T.input} value={form.job_code} onChange={e=>F('job_code',e.target.value)} placeholder="e.g. ENG-BE-02" />
            </Field>
            <Field label="Reporting Manager"
              hint={people.find((p:any)=>p.id===form.reporting_manager_id)?.designation
                ? `Reports to: ${people.find((p:any)=>p.id===form.reporting_manager_id)?.designation}` : undefined}>
              <select style={T.select} value={form.reporting_manager_id} onChange={e=>F('reporting_manager_id',e.target.value)}>
                <option value="">Select Manager</option>
                {people.map((p:any)=><option key={p.id} value={p.id}>{p.full_name} — {p.designation||'—'}</option>)}
              </select>
            </Field>
          </div>

          {/* ── §3 Employment Details ── */}
          <SectionLine title="3 · Employment Details" />
          <div style={{ ...T.g4, marginBottom:10 }}>
            <Field label="Employment Type">
              <select style={T.select} value={form.employment_type} onChange={e=>F('employment_type',e.target.value)}>
                {EMP_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Work Mode">
              <select style={T.select} value={form.work_mode} onChange={e=>F('work_mode',e.target.value)}>
                {WORK_MODES.map(w=><option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Work Location">
              <select style={T.select} value={form.location_id} onChange={e=>F('location_id',e.target.value)}>
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
              <select style={T.select} value={form.is_budgeted} onChange={e=>F('is_budgeted',e.target.value)}>
                <option value="">Not specified</option>
                <option value="yes">Yes — budgeted</option>
                <option value="no">No — unbudgeted</option>
              </select>
            </Field>
            <Field label="Approved Headcount Ref." hint="Link to the headcount plan record">
              <input style={T.input} value={form.headcount_ref} onChange={e=>F('headcount_ref',e.target.value)} placeholder="e.g. HCP-2026-014" />
            </Field>
          </div>
          {/* Labels follow the employment type: employees draw a salary,
              interns/apprentices a stipend, contractors and consultants fees. */}
          <div style={{ background:C.brandTint, borderRadius:7, padding:'8px 11px', marginBottom:10, fontSize:11.5, color:C.brandDeep }}>
            <b>{form.employment_type}</b> → paid as <b>{comp.label.toLowerCase()}</b>, quoted <b>{perLabel(comp.period)}</b>
            {comp.fixedTerm && <> · fixed-term engagement, duration required</>}
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Currency">
              {masters.currency?.length
                ? <MasterSelect useCode options={masters.currency} value={form.currency} onChange={(v:string)=>F('currency', v)} />
                : <input style={T.input} value={form.currency} onChange={e=>F('currency',e.target.value)} />}
            </Field>
            <Field label={`${comp.label} Range — Min`} hint={perLabel(comp.period)}>
              <input style={T.input} type="number" value={form.budget_min} onChange={e=>F('budget_min',e.target.value)} placeholder={comp.ph[0]} />
            </Field>
            <Field label={`${comp.label} Range — Max`} error={errors.budget_max} hint={errors.budget_max?undefined:perLabel(comp.period)}>
              <input style={eb('budget_max')} type="number" value={form.budget_max} onChange={e=>F('budget_max',e.target.value)} placeholder={comp.ph[1]} />
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
                <input style={eb('duration_months')} type="number" min={1} max={60} value={form.duration_months}
                  onChange={e=>F('duration_months',e.target.value)} placeholder="e.g. 6" />
              </Field>
              <Field label="Expected End Date"
                hint={form.target_joining_date ? 'Derived from joining date + duration' : 'Set the target joining date first'}>
                <input style={{ ...T.input, background:C.sunken, color:C.muted }} readOnly
                  value={addMonths(form.target_joining_date, form.duration_months) ? fmtDay(addMonths(form.target_joining_date, form.duration_months)) : '—'} />
              </Field>
              <div />
            </div>
          )}

          {/* ── §5 Justification ── */}
          <SectionLine title="5 · Justification" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <Field label="Reason for Hire" error={errors.reason}>
              <select style={eb('reason')} value={form.reason} onChange={e=>F('reason',e.target.value)}>
                <option value="">Select Reason</option>
                <option value="New position">New position</option>
                <option value="Replacement">Replacement</option>
                <option value="Expansion">Expansion</option>
                <option value="Attrition">Attrition</option>
              </select>
            </Field>
            <Field label="Outgoing Employee" error={errors.outgoing_employee_id}
              hint={isReplacement?undefined:'Only for Replacement / Backfill'}>
              <select style={{ ...eb('outgoing_employee_id'), opacity:isReplacement?1:.55 }} disabled={!isReplacement}
                value={form.outgoing_employee_id} onChange={e=>F('outgoing_employee_id',e.target.value)}>
                <option value="">Select Employee</option>
                {people.map((p:any)=><option key={p.id} value={p.id}>{p.full_name} ({p.emp_code})</option>)}
              </select>
            </Field>
            <Field label="Reason for Exit">
              <select style={{ ...T.select, opacity:isReplacement?1:.55 }} disabled={!isReplacement}
                value={form.exit_reason} onChange={e=>F('exit_reason',e.target.value)}>
                <option value="">Select Reason</option>
                {(masters.separation_reason||[]).map(o=><option key={o.code} value={o.label}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ marginBottom:10 }}>
            <Field label="Business Justification">
              <textarea style={{ ...T.textarea, minHeight:80 }} value={form.business_justification}
                onChange={e=>F('business_justification',e.target.value)}
                placeholder="Why this headcount is needed — business impact, workload, revenue linkage…" />
            </Field>
          </div>

          {/* ── §6 Timeline ── */}
          <SectionLine title="6 · Timeline" />
          <div style={{ ...T.g2, marginBottom:10 }}>
            <Field label="Target Joining Date" error={errors.target_joining_date}>
              <input type="date" style={eb('target_joining_date')} value={form.target_joining_date} onChange={e=>F('target_joining_date',e.target.value)} />
            </Field>
            <Field label="Requisition Validity / Expiry" error={errors.validity_date} hint="Auto-flagged as expired if unfilled past this date">
              <input type="date" style={eb('validity_date')} value={form.validity_date} onChange={e=>F('validity_date',e.target.value)} />
            </Field>
          </div>

          {/* ── §7 Candidate Requirements ── */}
          {!isQuick && (
            <>
              <SectionLine title="7 · Candidate Requirements" />
              <div style={{ ...T.g2, marginBottom:10 }}>
                <Field label="Experience — Min (years)">
                  <input style={T.input} type="number" min="0" value={form.experience_min} onChange={e=>F('experience_min',e.target.value)} placeholder="e.g. 3" />
                </Field>
                <Field label="Experience — Max (years)" error={errors.experience_max}>
                  <input style={eb('experience_max')} type="number" min="0" value={form.experience_max} onChange={e=>F('experience_max',e.target.value)} placeholder="e.g. 5" />
                </Field>
              </div>
              <div style={{ ...T.g3, marginBottom:10 }}>
                <Field label="Education — Minimum">
                  <select style={T.select} value={form.education_min} onChange={e=>F('education_min',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </Field>
                <Field label="Education — Maximum">
                  <select style={T.select} value={form.education_max} onChange={e=>F('education_max',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </Field>
                <Field label="Previous Company Preference">
                  <select style={T.select} value={form.previous_company_preference} onChange={e=>F('previous_company_preference',e.target.value)}>
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
                  <label style={{ ...T.label, marginBottom:0 }}>Job Description</label>
                  <button onClick={generateJD} disabled={aiLoading} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, border:'1px solid #DDD6FE', fontSize:11 }}>
                    {aiLoading?'Generating...':'Generate JD with AI'}
                  </button>
                </div>
                <textarea style={{ ...T.textarea, minHeight:150 }} value={form.job_description}
                  onChange={e=>F('job_description',e.target.value)}
                  placeholder="Write a job description or generate it with the AI button..." />
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={T.label}>Screening (CTQ) Questions</label>
                <CtqEditor items={form.ctq_questions} onChange={(v:any[])=>F('ctq_questions',v)} />
              </div>
            </>
          )}

          {/* ── §8 Approval Workflow ── */}
          <SectionLine title="8 · Approval Workflow" />
          <div style={{ marginBottom:14 }}>
            <label style={T.label}>Approval Hierarchy</label>
            <ApprovalChainEditor chain={form.approval_chain} onChange={(v:any[])=>F('approval_chain',v)} />
          </div>

          {/* ── §9 Sourcing ── */}
          {!isQuick && (
            <>
              <SectionLine title="9 · Sourcing" />
              <div style={{ ...T.g2, marginBottom:10 }}>
                <Field label="Internal vs External">
                  <select style={T.select} value={form.sourcing_mode} onChange={e=>F('sourcing_mode',e.target.value)}>
                    {SOURCING_MODES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Assigned Recruiter" hint="Set on approval, or enter here">
                  <input style={{ ...T.input, background:C.sunken, color:C.muted }}
                    value={(editMRF as any)?.assigned_recruiter||'Assigned at approval'} readOnly />
                </Field>
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={T.label}>Preferred Sourcing Channels</label>
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
              <div style={{ fontSize:11.5, color:C.faint }}>
                Save the requisition first — files attach to a saved MRF.
              </div>
            )}
          </div>

          {Object.values(errors).filter(Boolean).length>0 && (
            <div style={{ background:C.criticalTint, border:'1px solid #FECACA', borderRadius:7, padding:'9px 12px', marginBottom:12, fontSize:12, color:C.critical }}>
              {Object.values(errors).filter(Boolean).length} field(s) need attention before this can be saved.
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>saveMRF('DRAFT')} disabled={saving} style={T.btnOutline}>Save Draft</button>
            <button onClick={()=>saveMRF('SUBMITTED')} disabled={saving} style={T.btnPrimary}>Submit for Approval</button>
          </div>
        </div>
      )}

      <SearchBar placeholder="Search by job title, role or MRF number…" onApply={setMrfQ} />
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' as const, marginBottom:12, alignItems:'center' }}>
        <select value={fCompany} onChange={e=>setFCompany(e.target.value)} style={{ ...T.select, maxWidth:170 }}>
          <option value="">All Companies</option>
          {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
        </select>
        <select value={fDept} onChange={e=>setFDept(e.target.value)} style={{ ...T.select, maxWidth:170 }}>
          <option value="">All Departments</option>
          {departments.filter((d:Department)=>!fCompany||d.company_id===fCompany).map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
        </select>
        <select value={fLoc} onChange={e=>setFLoc(e.target.value)} style={{ ...T.select, maxWidth:170 }}>
          <option value="">All Locations</option>
          {locations.filter((l:Location)=>!fCompany||l.company_id===fCompany).map((l:Location)=><option key={l.id} value={l.id}>{l.location_name}</option>)}
        </select>
        <select value={fPos} onChange={e=>setFPos(e.target.value)} style={{ ...T.select, maxWidth:170 }}>
          <option value="">All Positions</option>
          {mrfPositions.map((p:string)=><option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ ...T.select, maxWidth:170 }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="openings">Most openings</option>
          <option value="urgency">Most urgent</option>
          <option value="joining">Earliest joining</option>
        </select>
        {(fCompany||fDept||fLoc||fPos||fStatus)&&<button onClick={()=>{setFCompany('');setFDept('');setFLoc('');setFPos('');setFStatus('')}} style={T.btnOutline}>Clear filters</button>}
      </div>

      {visible.length>0 && (
        <div style={{ fontSize:11.5, color:C.faint, marginBottom:8 }}>
          Showing {visible.length} of {mrfs.length} requisition{mrfs.length===1?'':'s'}
          {fStatus?` · ${fStatus.replace('_',' ')}`:''}
        </div>
      )}

      {visible.length===0 && (
        <div style={{ ...T.card, textAlign:'center' as const, padding:34, color:C.faint }}>
          <div style={{ fontSize:30, marginBottom:8 }}></div>
          <div style={{ fontSize:14, fontWeight:600, color:C.ink }}>No requisitions match</div>
          <div style={{ fontSize:12.5, marginTop:5 }}>
            {mrfs.length ? 'Try clearing the filters above.' : 'Create your first MRF with the + New MRF button.'}
          </div>
        </div>
      )}

      {view==='table' && visible.length>0 && (
        <MrfTable rows={visible} orgOf={orgOf} candidates={candidates}
          onOpen={setDetailMRF} onReview={setApprovalModal} />
      )}

      {view==='cards' && visible.map((m:MRF)=>(
        <MrfCard key={m.id} m={m} org={orgOf(m)}
          cands={candidates.filter((c:Candidate)=>c.mrf_id===m.id)}
          onOpen={setDetailMRF} onEdit={openEdit} onDelete={setDeleteConfirm}
          onReview={setApprovalModal}
          onClose={(x:MRF)=>setMrfStatus(x,'CLOSED','MRF_CLOSED')}
          onReopen={(x:MRF)=>setMrfStatus(x,'APPROVED','MRF_REOPENED')} />
      ))}

      {detailMRF && (
        <MrfDetail supabase={supabase} mrf={mrfs.find((x:MRF)=>x.id===detailMRF.id)||detailMRF} org={orgOf(detailMRF)}
          cands={candidates.filter((c:Candidate)=>c.mrf_id===detailMRF.id)} people={people}
          onClose={()=>setDetailMRF(null)} onEdit={openEdit} onReview={setApprovalModal}
          onChanged={onRefresh} showNotify={showNotify} />
      )}

      {approvalModal&&<ApprovalModal mrf={approvalModal} org={orgOf(approvalModal)}
        onApprove={approveMRF} onReject={rejectMRF} onHold={holdMRF} onClose={()=>setApprovalModal(null)} />}
      {deleteConfirm&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, width:340, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:15, fontWeight:600, color:C.ink, marginBottom:8 }}>Delete MRF?</div>
            <div style={{ fontSize:13, color:C.faint, marginBottom:20 }}>This action cannot be undone. Linked candidates are kept but unlinked from this requisition.</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>deleteMRF(deleteConfirm)} style={{ ...T.btn, background:C.critical, color:'#fff', flex:1 }}>Delete</button>
              <button onClick={()=>setDeleteConfirm(null)} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
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

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.45)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:24, width:'100%', maxWidth:480, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>{mrf.job_title||mrf.designation||mrf.position}</div>
        <div style={{ fontSize:11.5, color:C.faint, marginTop:3 }}>
          {mrf.mrf_number||'No MRF number'}{org?` · ${org.company} · ${org.dept}`:''}
        </div>

        <div style={{ background:C.sunken, border:'1px solid #EDE9FE', borderRadius:8, padding:'11px 13px', margin:'14px 0', fontSize:12, color:C.inkSoft, display:'grid', gridTemplateColumns:'1fr 1fr', gap:9 }}>
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
          <div style={{ background:C.brandTint, borderRadius:8, padding:'10px 12px', marginBottom:14, fontSize:12, color:C.brandDeep }}>
            Approving opens this requisition straight away and records the full chain
            — <b>{chain.map((s:any)=>s.role).join(' → ')}</b> — against your name.
          </div>
        )}

        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button onClick={()=>setMode('approve')} style={{ ...T.btn, flex:1, background:mode==='approve'?C.positiveTint:C.sunken, color:mode==='approve'?C.positive:C.faint, border:mode==='approve'?'1px solid #A7F3D0':'1px solid #E5E7EB' }}>Approve</button>
          <button onClick={()=>setMode('hold')} style={{ ...T.btn, flex:1, background:mode==='hold'?C.warningTint:C.sunken, color:mode==='hold'?C.warning:C.faint, border:mode==='hold'?'1px solid #FDE68A':'1px solid #E5E7EB' }}>Hold</button>
          <button onClick={()=>setMode('reject')} style={{ ...T.btn, flex:1, background:mode==='reject'?C.criticalTint:C.sunken, color:mode==='reject'?C.critical:C.faint, border:mode==='reject'?'1px solid #FCA5A5':'1px solid #E5E7EB' }}>Reject</button>
        </div>

        <label style={T.label}>Approver name</label>
        <input style={{ ...T.input, marginBottom:11 }} value={actor} onChange={e=>setActor(e.target.value)}
          placeholder="Your name" />

        {mode==='approve'?(
          <>
            <label style={T.label}>Assign Recruiter Email</label>
            <input style={{ ...T.input, marginBottom:4, ...(emailOk?{}:{ border:'1px solid #FCA5A5', background:C.criticalTint }) }}
              value={recruiter} onChange={e=>setRecruiter(e.target.value)} placeholder="recruiter@company.com" />
            <div style={{ fontSize:10.5, color: emailOk?C.faint:C.critical, marginBottom:11 }}>
              {emailOk ? 'Optional — the MRF can be approved and assigned later.' : 'That does not look like a valid email.'}
            </div>
            <label style={T.label}>Approver comments</label>
            <textarea style={{ ...T.textarea, marginBottom:16, minHeight:70 }} value={comments}
              onChange={e=>setComments(e.target.value)} placeholder="Optional note for the record" />
            <button onClick={()=>emailOk && go(()=>onApprove(mrf.id, recruiter.trim(), comments.trim(), actor.trim()))} disabled={busy||!emailOk}
              style={{ ...T.btnPrimary, width:'100%', opacity: busy||!emailOk?.6:1 }}>
              {busy?'Approving…':'Approve & Assign'}
            </button>
          </>
        ):mode==='hold'?(
          <>
            <label style={T.label}>Reason for hold *</label>
            <textarea style={{ ...T.textarea, marginBottom:16 }} value={comments} onChange={e=>setComments(e.target.value)}
              placeholder="Why is this requisition being paused?" rows={3} />
            <button onClick={()=>comments.trim() && go(()=>onHold(mrf.id, comments.trim()))} disabled={busy||!comments.trim()}
              style={{ ...T.btn, background:C.warning, color:'#fff', width:'100%', opacity: busy||!comments.trim()?.6:1 }}>
              {busy?'Saving…':'Put on hold'}
            </button>
          </>
        ):(
          <>
            <label style={T.label}>Rejection Reason *</label>
            <textarea style={{ ...T.textarea, marginBottom:16 }} value={comments} onChange={e=>setComments(e.target.value)}
              placeholder="Why is this requisition being rejected?" rows={3} />
            <button onClick={()=>comments.trim() && go(()=>onReject(mrf.id, comments.trim(), actor.trim()))} disabled={busy||!comments.trim()}
              style={{ ...T.btn, background:C.critical, color:'#fff', width:'100%', opacity: busy||!comments.trim()?.6:1 }}>
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
  CRITICAL:    { label:'Critical',    bg:'#FFF7ED', fg:'#C2410C', icon:'', help:'Deadline within a week' },
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
    <span title={f.help} style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:f.bg, color:f.fg,
      fontWeight:600, whiteSpace:'nowrap' as const }}>{f.icon} {f.label}</span>
  )
}

// ── Deadline board ────────────────────────────────────────────────
function DeadlineBoard({ rows, orgOf }:any) {
  if (!rows.length) return (
    <div style={{ ...T.card, textAlign:'center' as const, padding:26, color:C.faint, fontSize:12.5 }}>
      No live requisitions with a deadline. ✅
    </div>
  )
  return (
    <div style={{ ...T.card, padding:0, overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
        <thead>
          <tr>
            {['Requisition','Department','Recruiter','Openings','Progress','Deadline','Days Left','Flag'].map((h,i)=>(
              <th key={h} style={{ fontSize:10, color:C.brandDeep, fontWeight:600, textTransform:'uppercase' as const,
                letterSpacing:'.05em', textAlign: i>=3&&i<=6 ? 'center':'left', padding:'8px 10px',
                borderBottom:'1px solid #EDE9FE', whiteSpace:'nowrap' as const }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, js }:any)=>{
            const org = orgOf(m)
            const pct = js.openings ? Math.min(100,(js.filledCount/js.openings)*100) : 0
            const late = js.daysLeft!=null && js.daysLeft < 0
            return (
              <tr key={m.id}>
                <td style={{ fontSize:12, padding:'9px 10px', borderBottom:'1px solid #F3F0FF' }}>
                  <div style={{ fontWeight:600 }}>{m.job_title||m.designation||m.position}</div>
                  <div style={{ fontSize:10.5, color:C.faint }}>{m.mrf_number||'—'}</div>
                </td>
                <td style={{ fontSize:12, color:C.muted, padding:'9px 10px', borderBottom:'1px solid #F3F0FF' }}>{org.dept}</td>
                <td style={{ fontSize:12, color:C.muted, padding:'9px 10px', borderBottom:'1px solid #F3F0FF' }}>{m.assigned_recruiter||'— unassigned'}</td>
                <td style={{ fontSize:12, textAlign:'center', padding:'9px 10px', borderBottom:'1px solid #F3F0FF' }}>{js.openings}</td>
                <td style={{ padding:'9px 10px', borderBottom:'1px solid #F3F0FF', minWidth:110 }}>
                  <div style={{ fontSize:10.5, color:C.faint, textAlign:'center', marginBottom:3 }}>{js.filledCount}/{js.openings}</div>
                  <div style={{ background:C.brandTint, borderRadius:99, height:5, overflow:'hidden' }}>
                    <div style={{ width:`${pct}%`, height:'100%', background:pct>=100?C.positive:C.brand }} />
                  </div>
                </td>
                <td style={{ fontSize:12, color:C.muted, textAlign:'center', padding:'9px 10px', borderBottom:'1px solid #F3F0FF', whiteSpace:'nowrap' as const }}>{fmtDay(js.deadline)}</td>
                <td style={{ fontSize:12.5, fontWeight:700, textAlign:'center', padding:'9px 10px',
                  borderBottom:'1px solid #F3F0FF', color: late?C.critical: js.daysLeft<=DUE_CRITICAL?'#C2410C':C.positive, whiteSpace:'nowrap' as const }}>
                  {js.daysLeft==null ? '—' : late ? `${Math.abs(js.daysLeft)}d over` : `${js.daysLeft}d`}
                </td>
                <td style={{ padding:'9px 10px', borderBottom:'1px solid #F3F0FF' }}><JobFlag flag={js.flag} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Recruiter performance table ───────────────────────────────────
function RecruiterTable({ rows, sortKey, sortDir, onSort, selected, onSelect }:any) {
  const th = (k:string, label:string, num=false):React.CSSProperties => ({
    fontSize:10, color:C.brandDeep, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em',
    textAlign: num?'right':'left', padding:'9px 10px', borderBottom:'1px solid #EDE9FE',
    cursor:'pointer', whiteSpace:'nowrap',
  })
  const td:React.CSSProperties = { fontSize:12.5, padding:'10px', borderBottom:'1px solid #F3F0FF' }
  const num:React.CSSProperties = { ...td, textAlign:'right' }
  const arrow = (k:string) => sortKey===k ? (sortDir==='asc'?' ▲':' ▼') : ''
  const COLS:[string,string,boolean][] = [
    ['name','Recruiter',false], ['total','MRFs',true], ['filled','Filled',true],
    ['expired','Breached',true], ['open','Live',true], ['rate','Fill Rate',true],
    ['ttf','Avg Days to Fill',true], ['ttc','Avg Days to 1st CV',true],
  ]
  return (
    <div style={{ ...T.card, padding:0, overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', minWidth:860 }}>
        <thead>
          <tr>{COLS.map(([k,l,n])=>(
            <th key={k} style={th(k,l,n)} onClick={()=>onSort(k)}>{l}{arrow(k)}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r:any)=>{
            const [bg,fg] = fillTone(r.rate)
            const on = selected===r.key
            return (
              <tr key={r.key} onClick={()=>onSelect(on?null:r.key)}
                style={{ cursor:'pointer', background: on?'#FAF8FF':'transparent' }}>
                <td style={td}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ width:26, height:26, borderRadius:'50%', background:C.brandTint, color:C.brandDeep,
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>
                      {r.name.slice(0,2).toUpperCase()}
                    </span>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:600 }}>{r.name}</div>
                      {r.unassigned && <div style={{ fontSize:10, color:C.warning }}>no recruiter assigned</div>}
                    </div>
                  </div>
                </td>
                <td style={num}>{r.total}</td>
                <td style={{ ...num, color:C.positive, fontWeight:600 }}>{r.filled}</td>
                <td style={{ ...num, color: r.expired?C.critical:C.faint, fontWeight: r.expired?600:400 }}>{r.expired}</td>
                <td style={num}>{r.open}</td>
                <td style={num}>
                  <span style={{ fontWeight:700, padding:'3px 10px', borderRadius:99, fontSize:11.5, background:bg, color:fg }}>
                    {r.rate==null ? '—' : r.rate+'%'}
                  </span>
                </td>
                <td style={num}>{r.ttf==null?'—':r.ttf}</td>
                <td style={num}>{r.ttc==null?'—':r.ttc}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length===0 && (
        <div style={{ padding:26, textAlign:'center', color:C.faint, fontSize:12.5 }}>
          No requisitions in this period.
        </div>
      )}
    </div>
  )
}

// ── JOB STATUS TAB ────────────────────────────────────────────────
function JobStatusTab({ companies, locations, departments, mrfs, candidates, showNotify, supabase }:any) {
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
    <div style={{ background:C.surface, border:'1px solid rgba(124,58,237,0.12)', borderRadius:10, padding:'11px 13px' }}>
      <div style={{ fontSize:10, color:C.faint, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.05em' }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, marginTop:2, color:color||C.ink }}>{value}</div>
      {sub && <div style={{ fontSize:10.5, color:C.faint, marginTop:1 }}>{sub}</div>}
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
      const r = await fetch('/api/recruitment/share-report', { method:'POST', body:fd, headers: await authHeaders(supabase) })
      const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not create a share link')
      setShareUrl(j.url)
      try { await navigator.clipboard.writeText(j.url); showNotify(`Link copied — valid ${j.expiresInDays} days`) }
      catch { showNotify(`Share link ready — valid ${j.expiresInDays} days`) }
    } catch (e:any) { showNotify(e.message||'Could not share the report','error') }
    setSharing(false)
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:10, flexWrap:'wrap' as const }}>
        <div>
          <div style={{ fontSize:15, fontWeight:600, color:C.ink }}>Job Status &amp; Recruiter Performance</div>
          <div style={{ fontSize:11.5, color:C.faint, marginTop:2 }}>
            MRF deadlines, expiries and whether hiring is closing before requisitions lapse
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' as const }}>
          <select value={exportFmt} onChange={e=>{ setExportFmt(e.target.value); setShareUrl('') }}
            style={{ ...T.select, width:'auto', padding:'7px 10px', fontSize:12 }}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="xls">Excel 97–2003 (.xls)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
          <button onClick={downloadReport} style={T.btnPrimary}>⬇ Export Report</button>
          <button onClick={shareReport} disabled={sharing} style={{ ...T.btnOutline, opacity: sharing?.6:1 }}>
            {sharing ? 'Preparing…' : 'Share link'}
          </button>
        </div>
      </div>

      {shareUrl && (
        <div style={{ ...T.card, background:C.positiveTint, border:'1px solid #A7F3D0' }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.positive, marginBottom:6 }}>
            Shareable link ready — anyone with it can download the report for 7 days
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' as const }}>
            <input readOnly value={shareUrl} onFocus={e=>e.currentTarget.select()}
              style={{ ...T.input, flex:'1 1 340px', fontSize:11.5, background:'#fff' }} />
            <button onClick={()=>{ navigator.clipboard?.writeText(shareUrl); showNotify('Link copied') }} style={T.btnOutline}>Copy</button>
            <a href={shareUrl} target="_blank" rel="noreferrer" style={{ ...T.btnOutline, textDecoration:'none' }}>Open</a>
            <button onClick={()=>setShareUrl('')} style={{ ...T.btnOutline, color:C.muted }}>Dismiss</button>
          </div>
        </div>
      )}

      {!hasDeadlines && (
        <div style={{ background:C.warningTint, border:'1px solid #FDE68A', borderRadius:7, padding:'9px 12px',
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
            <label style={T.label}>Company</label>
            <select style={T.select} value={fCompany} onChange={e=>{ setFCompany(e.target.value); setFLoc(''); setFDept('') }}>
              <option value="">All companies</option>
              {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
            </select>
          </div>
          <div>
            <label style={T.label}>Branch / Location</label>
            <select style={T.select} value={fLoc} onChange={e=>setFLoc(e.target.value)}>
              <option value="">All branches</option>
              {locations.filter((l:Location)=>!fCompany||l.company_id===fCompany).map((l:Location)=>(
                <option key={l.id} value={l.id}>{l.location_name}</option>))}
            </select>
          </div>
          <div>
            <label style={T.label}>Department</label>
            <select style={T.select} value={fDept} onChange={e=>setFDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.filter((d:Department)=>!fCompany||d.company_id===fCompany).map((d:Department)=>(
                <option key={d.id} value={d.id}>{d.dept_name}</option>))}
            </select>
          </div>
          <div>
            <label style={T.label}>Raised Within</label>
            <select style={T.select} value={period} onChange={e=>setPeriod(e.target.value)}>
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last 12 months</option>
            </select>
          </div>
        </div>
        <div style={{ fontSize:11.5, color:C.faint, marginTop:9 }}>
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
        <Tile label="At Risk" value={atRisk} sub="due ≤7d or overdue" color={atRisk?'#C2410C':C.faint} />
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
        <span style={{ fontSize:10, color:C.faint, textTransform:'none' as const, letterSpacing:0, fontWeight:400 }}>
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
              padding:'9px 0', borderBottom:'1px solid #F3F0FF', gap:10, flexWrap:'wrap' as const }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:12.5, fontWeight:600 }}>
                  {m.job_title||m.designation||m.position} <span style={{ fontSize:10.5, color:C.faint }}>{m.mrf_number||''}</span>
                </div>
                <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>
                  {orgOf(m).dept} · raised {fmtDay(m.created_at)}
                  {js.deadline?` · due ${fmtDay(js.deadline)}`:''} · {js.filledCount}/{js.openings} filled
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                <span style={{ fontSize:11.5, color:C.muted }}>
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
    </div>
  )
}

// ── AI SCREENING ──────────────────────────────────────────────────
function ScreeningTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  const [selMRF, setSelMRF] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [screening, setScreening] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [progress, setProgress] = useState(0)
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
        const r = await fetch('/api/recruitment/screen-resumes', { method:'POST', body:fd }) // no Content-Type → browser sets multipart boundary
        const d = await r.json()
        res.push({ ...d, file_name:file.name, added:false })
      } catch {
        res.push({ candidate_name:file.name.replace(/\.[^.]+$/,''), score:0, match_tag:'NOT_SUITABLE', reasoning:'Network/parse error', matched_skills:[], missing_skills:[], file_name:file.name, added:false })
      }
      setProgress(Math.round(((i+1)/files.length)*100))
      setResults([...res])
    }
    setScreening(false)
  }

  async function addToBank(idx:number) {
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
  }

  async function addAllStrong() {
    const strong = results.map((r,i)=>({ r, i })).filter(({r})=>r.match_tag==='STRONG'&&!r.added)
    for (const { i } of strong) await addToBank(i)
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

  return (
    <div>
      <div style={T.cardPurple}>
        <div style={T.section}>AI Resume Screening — Bulk Upload</div>
        <div style={{ ...T.g2, marginBottom:12 }}>
          <div>
            <label style={T.label}>Select Job Opening *</label>
            <select style={T.select} value={selMRF} onChange={e=>setSelMRF(e.target.value)}>
              <option value="">Select MRF (approved)</option>
              {mrfs.filter((m:MRF)=>m.status==='APPROVED').map((m:MRF)=>(
                <option key={m.id} value={m.id}>{m.designation||m.position} — {m.no_of_openings||m.openings||0} openings</option>
              ))}
            </select>
          </div>
          <div>
            <label style={T.label}>Upload Resumes (PDF/Word/TXT)</label>
            <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv" onChange={e=>setFiles(Array.from(e.target.files||[]))} style={{ display:'none' }} />
            <button onClick={()=>fileRef.current?.click()} style={{ ...T.btnOutline, width:'100%', textAlign:'left' as const }}>
              📂 {files.length>0?`${files.length} files selected`:'Choose Files'}
            </button>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={runScreening} disabled={screening||!selMRF||!files.length} style={{ ...T.btnPrimary, padding:'9px 20px', opacity:screening||!selMRF||!files.length?0.5:1 }}>
            {screening?`⏳ ${progress}% (${results.length}/${files.length})` :'Start AI Screening'}
          </button>
          {results.length>0&&<button onClick={downloadExcel} style={{ ...T.btn, background:C.positive, color:'#fff' }}>Excel Download</button>}
          {strong.filter(r=>!r.added).length>0&&(
            <button onClick={addAllStrong} style={{ ...T.btn, background:C.positiveTint, color:C.positive, border:'1px solid #A7F3D0' }}>Add All Strong ({strong.filter(r=>!r.added).length})
            </button>
          )}
        </div>
        {screening&&(
          <div style={{ marginTop:10, background:C.brandTint, borderRadius:99, height:6, overflow:'hidden' }}>
            <div style={{ background:C.brand, height:'100%', width:`${progress}%`, transition:'width .3s', borderRadius:99 }} />
          </div>
        )}
      </div>

      {results.length>0&&(
        <>
          <div style={{ display:'flex', gap:16, fontSize:13, marginBottom:10 }}>
            <span style={{ color:C.positive, fontWeight:500 }}>Strong: {strong.length}</span>
            <span style={{ color:C.warning, fontWeight:500 }}>Partial: {partial.length}</span>
            <span style={{ color:C.critical, fontWeight:500 }}>Not Suitable: {notSuitable.length}</span>
            <span style={{ color:C.faint }}>Total: {results.length}</span>
          </div>
          {[...strong,...partial,...notSuitable].map((r,i)=>(
            <div key={i} style={{ ...T.card, display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ width:46, height:46, borderRadius:99, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700,
                background:r.match_tag==='STRONG'?C.positiveTint:r.match_tag==='PARTIAL'?C.warningTint:C.criticalTint,
                color:r.match_tag==='STRONG'?C.positive:r.match_tag==='PARTIAL'?C.warning:C.critical }}>
                {r.score}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4, flexWrap:'wrap' as const }}>
                  <span style={{ fontSize:13, fontWeight:600, color:C.ink }}>{r.candidate_name}</span>
                  <Badge text={r.match_tag} />
                  {r.added&&<span style={{ fontSize:10, color:C.positive, fontWeight:500 }}>Added to pipeline</span>}
                </div>
                <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{r.reasoning}</div>
                {typeof r.ats_score==='number'&&(
                  <div style={{ fontSize:11, color:C.brandDeep, marginBottom:4 }}>ATS skills match: <b>{r.ats_score}%</b> · Overall: <b>{r.score}</b></div>
                )}
                {(r.matched_skills?.length||r.missing_skills?.length)?(
                  <div style={{ display:'flex', flexWrap:'wrap' as const, gap:4, marginBottom:6 }}>
                    {(r.matched_skills||[]).map((s:string,si:number)=>(
                      <span key={'m'+si} style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:C.positiveTint, color:C.positive, fontWeight:500 }}>✓ {s}</span>
                    ))}
                    {(r.missing_skills||[]).map((s:string,si:number)=>(
                      <span key={'x'+si} style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:C.criticalTint, color:C.critical, fontWeight:500 }}>✕ {s}</span>
                    ))}
                  </div>
                ):null}
                {(r.experience_match||r.education_match)&&(
                  <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>
                    {r.experience_match&&<span>⏱ {r.experience_match}</span>}
                    {r.experience_match&&r.education_match&&<span> · </span>}
                    {r.education_match&&<span>🎓 {r.education_match}</span>}
                  </div>
                )}
                {r.interview_questions?.length>0&&(
                  <details style={{ cursor:'pointer' }}>
                    <summary style={{ fontSize:11, color:C.brandDeep, fontWeight:500 }}>View {r.interview_questions.length} Interview Questions</summary>
                    {r.interview_questions.map((q:string,qi:number)=>(
                      <div key={qi} style={{ fontSize:11, padding:'3px 0 3px 12px', color:C.muted }}>{qi+1}. {q}</div>
                    ))}
                  </details>
                )}
              </div>
              {!r.added&&(
                <button onClick={()=>addToBank(results.indexOf(r))} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, border:'1px solid #DDD6FE', flexShrink:0, fontSize:11 }}>+ Pipeline</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── PIPELINE ──────────────────────────────────────────────────────
function PipelineTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify }:any) {
  const [interviewCand, setInterviewCand] = useState<Candidate|null>(null)
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const [selMRF, setSelMRF] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selCand, setSelCand] = useState<Candidate|null>(null)
  const [aiQs, setAiQs] = useState<string[]>([])
  const [aiQLoading, setAiQLoading] = useState(false)
  const [aiFbLoading, setAiFbLoading] = useState(false)
  const EMPTY_C = { mrf_id:'', full_name:'', phone:'', email:'', hr_email:'', current_company:'', designation:'', experience_years:'', current_ctc:'', expected_ctc:'', notice_period:'', source:'Direct', overtime_pay_applicable:'No' }
  const [cForm, setCForm] = useState<any>(EMPTY_C)
  const [myEmail, setMyEmail] = useState('')
  useEffect(()=>{ supabase.auth.getUser().then(({data}:any)=>{ const em=data?.user?.email; if(em){ setMyEmail(em); setCForm((f:any)=>({...f, hr_email:f.hr_email||em})) } }) },[])
  const cMrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
  const expCtcOver = !!(cMrf?.budget_max && cForm.expected_ctc!=='' && Number(cForm.expected_ctc) > Number(cMrf.budget_max))
  const CF = (k:string,v:any) => setCForm((f:any)=>({...f,[k]:v}))
  const approvedMRFs = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const [pipeQ, setPipeQ] = useState('')
  const [stageF, setStageF] = useState('')   // '' = all stages
  const baseList = (selMRF==='all'?candidates:candidates.filter((c:Candidate)=>c.mrf_id===selMRF))
    .filter((c:Candidate)=>!pipeQ || c.full_name.toLowerCase().includes(pipeQ.toLowerCase()) || (c.current_company||'').toLowerCase().includes(pipeQ.toLowerCase()) || (c.designation||'').toLowerCase().includes(pipeQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))
  const filtered = stageF ? baseList.filter((c:Candidate)=>c.stage===stageF) : baseList

  async function addCandidate() {
    if (!cForm.full_name||!cForm.phone) { showNotify('Name and Phone are required','error'); return }
    const { data:dup } = await supabase.from('candidates').select('id').or(`phone.eq.${cForm.phone},email.eq.${cForm.email||'none'}`).limit(1)
    if (dup?.length&&!window.confirm('A candidate with the same phone/email already exists. Add anyway?')) return
    const mrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
    const { error } = await supabase.from('candidates').insert({
      mrf_id:cForm.mrf_id||null, company_id:mrf?.company_id||null,
      full_name:cForm.full_name, phone:cForm.phone, mobile:cForm.phone,
      email:cForm.email||null, hr_email:cForm.hr_email||null, current_company:cForm.current_company||null,
      designation:cForm.designation||null, experience_years:Number(cForm.experience_years)||0,
      current_ctc:Number(cForm.current_ctc)||null, expected_ctc:Number(cForm.expected_ctc)||null,
      notice_period:Number(cForm.notice_period)||null, source:cForm.source, stage:'Applied',
      overtime_pay_applicable: cForm.overtime_pay_applicable === 'Yes',
      status:'active', applied_date:new Date().toISOString().split('T')[0],
    })
    if (error) { showNotify('Error: '+error.message,'error'); return }
    showNotify('Candidate added!'); setShowAdd(false); setCForm({...EMPTY_C, hr_email:myEmail}); onRefresh()
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

  async function saveNotes(id:string, notes:string) {
    const { error } = await supabase.from('candidates').update({ interview_notes:notes }).eq('id',id)
    if (error) { showNotify('Save failed','error'); return }
    showNotify('Notes saved!')
    onRefresh()
  }

  async function getAIQuestions(c:Candidate) {
    setAiQLoading(true); setAiQs([])
    const mrf = mrfs.find((m:MRF)=>m.id===c.mrf_id)
    try {
      const res = await fetch('/api/recruitment/interview-ai', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ type:'questions', designation:mrf?.designation||c.designation||'Role', round:c.stage, candidate_summary:`${c.experience_years}yr, ${c.current_company}, ${c.designation}` })
      })
      const { result } = await res.json()
      const parsed = JSON.parse(result.replace(/```json|```/g,'').trim())
      const qs = parsed.map((q:any)=>q.question||q)
      setAiQs(qs)
      await supabase.from('candidates').update({ ai_questions:qs }).eq('id',c.id)
      onRefresh()
    } catch { showNotify('Could not generate questions','error') }
    setAiQLoading(false)
  }

  async function getAIFeedback(c:Candidate, notes:string) {
    if (!notes.trim()) { showNotify('Please write notes first','error'); return }
    setAiFbLoading(true)
    const mrf = mrfs.find((m:MRF)=>m.id===c.mrf_id)
    try {
      const res = await fetch('/api/recruitment/interview-ai', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ type:'feedback', designation:mrf?.designation||c.designation||'Role', round:c.stage, existing_notes:notes })
      })
      const { result } = await res.json()
      const newNotes = notes+'\n\n--- AI FEEDBACK ---\n'+result
      await saveNotes(c.id, newNotes)
      setSelCand(c2=>c2?{...c2,interview_notes:newNotes}:null)
    } catch { showNotify('Could not generate feedback','error') }
    setAiFbLoading(false)
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <select style={{ ...T.select, width:280 }} value={selMRF} onChange={e=>setSelMRF(e.target.value)}>
          <option value="all">All Openings ({candidates.length} candidates)</option>
          {approvedMRFs.map((m:MRF)=>(
            <option key={m.id} value={m.id}>{m.designation||m.position} ({candidates.filter((c:Candidate)=>c.mrf_id===m.id).length})</option>
          ))}
        </select>
        <button onClick={()=>{ setCForm({...EMPTY_C, hr_email:myEmail}); setShowAdd(true) }} style={T.btnPrimary}>+ Add Candidate</button>
      </div>
      <SearchBar placeholder="Filter pipeline by candidate name…" onApply={setPipeQ} />
      <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />

      {approvedMRFs.length===0&&(
        <div style={{ ...T.card, textAlign:'center' as const, color:C.faint, padding:32 }}>
          No approved MRF yet. Approve one in the MRF tab first.
        </div>
      )}

      {/* Stage filter pills */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const, marginBottom:14 }}>
        <button onClick={()=>setStageF('')} style={{ ...T.btn, fontSize:11, padding:'5px 12px', borderRadius:99,
          background: stageF===''?C.brand:'#fff', color: stageF===''?'#fff':C.muted, border:`1px solid ${stageF===''?C.brand:C.brandTint}` }}>
          All <span style={{ opacity:.8 }}>({baseList.length})</span>
        </button>
        {STAGES.map(stage=>{
          const n = baseList.filter((c:Candidate)=>c.stage===stage).length
          const on = stageF===stage
          return (
            <button key={stage} onClick={()=>setStageF(on?'':stage)} style={{ ...T.btn, fontSize:11, padding:'5px 12px', borderRadius:99,
              background: on?STAGE_COLOR[stage]:STAGE_COLOR[stage]+'12', color: on?'#fff':STAGE_COLOR[stage],
              border:`1px solid ${on?STAGE_COLOR[stage]:STAGE_COLOR[stage]+'30'}` }}>
              {stage} <span style={{ opacity:.85 }}>({n})</span>
            </button>
          )
        })}
      </div>

      {/* Candidate cards */}
      {filtered.length===0 ? (
        <div style={{ ...T.card, textAlign:'center' as const, color:C.faint, padding:36 }}>No candidates match your search / filters.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12 }}>
          {filtered.map((c:Candidate)=>{
            const mrf = mrfs.find((m:MRF)=>m.id===c.mrf_id)
            const tag = c.ai_tag||c.ai_match_tag
            const tagCol = tag==='STRONG'?C.positive:tag==='PARTIAL'?C.warning:C.critical
            const initials = c.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
            return (
              <div key={c.id} onClick={()=>{setSelCand(c);setAiQs([])}}
                style={{ background:'#fff', borderRadius:12, padding:'14px 15px', cursor:'pointer', border:'1px solid #EDE9FE', boxShadow:'0 1px 4px rgba(124,58,237,0.06)', transition:'box-shadow .15s, transform .1s' }}
                onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 6px 18px rgba(124,58,237,0.14)'; e.currentTarget.style.transform='translateY(-1px)' }}
                onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 1px 4px rgba(124,58,237,0.06)'; e.currentTarget.style.transform='' }}>
                {/* header */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <div style={{ width:40, height:40, borderRadius:'50%', background:C.brandTint, color:C.brand, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, flexShrink:0 }}>{initials}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.full_name}{c.offer_revised&&<span style={{ fontSize:9, color:C.warning, fontWeight:600, marginLeft:5 }}></span>}</div>
                    <div style={{ fontSize:11, color:C.faint, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.designation||mrf?.designation||'—'}</div>
                  </div>
                  <span style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:99, background:STAGE_COLOR[c.stage]+'18', color:STAGE_COLOR[c.stage], whiteSpace:'nowrap' }}>{c.stage}</span>
                </div>
                {/* role / opening */}
                {mrf && <div style={{ fontSize:11, color:C.brand, fontWeight:500, marginBottom:8 }}>🎯 {mrf.designation||mrf.position}</div>}
                {/* detail rows */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 10px', fontSize:11.5, color:C.inkSoft }}>
                  <div><span style={{ color:C.faint }}>Company</span><div style={{ fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.current_company||'—'}</div></div>
                  <div><span style={{ color:C.faint }}>Experience</span><div style={{ fontWeight:600 }}>{c.experience_years||0} yr</div></div>
                  <div><span style={{ color:C.faint }}>Expected CTC</span><div style={{ fontWeight:600, color:C.positive }}>{c.expected_ctc?`₹${(c.expected_ctc/100000).toFixed(1)}L`:'—'}</div></div>
                  <div><span style={{ color:C.faint }}>Notice</span><div style={{ fontWeight:600 }}>{c.notice_period?`${c.notice_period}d`:'—'}</div></div>
                </div>
                {/* footer chips */}
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:10, flexWrap:'wrap' as const }}>
                  {c.ai_score!=null&&<span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:99, background:tagCol+'14', color:tagCol }}>AI {c.ai_score}% {tag==='STRONG'?'':tag==='PARTIAL'?'':''}</span>}
                  {c.source&&<span style={{ fontSize:10, color:C.faint, background:C.sunken, border:'1px solid #EDE9FE', borderRadius:99, padding:'2px 8px' }}>{c.source}</span>}
                  <span style={{ marginLeft:'auto', fontSize:11, color:C.brand, fontWeight:600 }}>View →</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Candidate Modal */}
      {showAdd&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', overflowY:'auto' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, width:520, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', margin:'20px auto' }}>
            <div style={{ fontSize:15, fontWeight:600, color:C.ink, marginBottom:16 }}>Add Candidate</div>
            <div style={{ marginBottom:10 }}>
              <label style={T.label}>For Opening (MRF)</label>
              <select style={T.select} value={cForm.mrf_id} onChange={e=>CF('mrf_id',e.target.value)}>
                <option value="">Select Opening</option>
                {approvedMRFs.map((m:MRF)=><option key={m.id} value={m.id}>{m.designation||m.position} ({m.no_of_openings||m.openings||0} openings)</option>)}
              </select>
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Full Name *</label><input style={T.input} value={cForm.full_name} onChange={e=>CF('full_name',e.target.value)} /></div>
              <div><label style={T.label}>Phone *</label><input style={T.input} value={cForm.phone} onChange={e=>CF('phone',e.target.value)} /></div>
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Candidate Email</label><input style={T.input} value={cForm.email} onChange={e=>CF('email',e.target.value)} placeholder="candidate@email.com" /></div>
              <div><label style={T.label}>HR Email (for follow-ups)</label><input style={T.input} value={cForm.hr_email} onChange={e=>CF('hr_email',e.target.value)} placeholder="hr@company.com" /></div>
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Source</label>
                <select style={T.select} value={cForm.source} onChange={e=>CF('source',e.target.value)}>
                  {SOURCES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={T.label}>Overtime Pay Applicable</label>
                <select style={T.select} value={cForm.overtime_pay_applicable} onChange={e=>CF('overtime_pay_applicable',e.target.value)}>
                  <option>No</option><option>Yes</option>
                </select>
              </div>
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Current Company</label><input style={T.input} value={cForm.current_company} onChange={e=>CF('current_company',e.target.value)} /></div>
              <div><label style={T.label}>Experience (Yrs)</label><input style={T.input} type="number" value={cForm.experience_years} onChange={e=>CF('experience_years',e.target.value)} /></div>
            </div>
            <div style={{ ...T.g3, marginBottom:16 }}>
              <div><label style={T.label}>Current CTC (₹)</label><input style={T.input} type="number" value={cForm.current_ctc} onChange={e=>CF('current_ctc',e.target.value)} /></div>
              <div>
                <label style={T.label}>Expected CTC (₹)</label>
                <input style={{ ...T.input, ...(expCtcOver?{ borderColor:'#FCA5A5', background:C.criticalTint }:{}) }} type="number" value={cForm.expected_ctc} onChange={e=>CF('expected_ctc',e.target.value)} />
                {expCtcOver && <div style={{ fontSize:10, color:C.critical, marginTop:3, fontWeight:600 }}>Exceeds MRF max budget (₹{(Number(cMrf.budget_max)/100000).toFixed(1)}L) — you can still save.</div>}
              </div>
              <div><label style={T.label}>Notice Period (Days)</label><input style={T.input} type="number" value={cForm.notice_period} onChange={e=>CF('notice_period',e.target.value)} /></div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={addCandidate} style={{ ...T.btnPrimary, flex:1 }}>Add to Pipeline</button>
              <button onClick={()=>setShowAdd(false)} style={{ ...T.btnOutline }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate Drawer */}
      {selCand&&(
        <CandidateDrawer candidate={selCand} mrfs={mrfs} onClose={()=>setSelCand(null)}
          onStageChange={moveStage} onSaveNotes={saveNotes}
          aiQs={aiQs} aiQLoading={aiQLoading} onGetQuestions={getAIQuestions}
          aiFbLoading={aiFbLoading} onGetFeedback={getAIFeedback}
          onOpenInterviews={(c:Candidate)=>{ setSelCand(null); setInterviewCand(c) }} />
      )}

      {/* ── Interview Pipeline full-screen overlay ── */}
      {interviewCand && (
        <div style={{ position:'fixed', inset:0, background:C.canvas, zIndex:300, overflowY:'auto', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ background:'linear-gradient(135deg,#7C3AED,#4F46E5)', padding:'12px 20px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:10 }}>
            <button onClick={()=>setInterviewCand(null)} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(255,255,255,.3)', background:'transparent', color:'#fff', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:500 }}>Back to Pipeline</button>
            <div style={{ fontSize:15, fontWeight:600, color:'#fff' }}>Interview Pipeline — {interviewCand.full_name}</div>
            <div style={{ marginLeft:'auto', fontSize:12, color:'rgba(255,255,255,.65)' }}>{interviewCand.designation || '—'} · {interviewCand.current_company || '—'}</div>
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
    </div>
  )
}

function CandidateDrawer({ candidate:c, mrfs, onClose, onStageChange, onSaveNotes, aiQs, aiQLoading, onGetQuestions, aiFbLoading, onGetFeedback, onOpenInterviews }:any) {
  const [notes, setNotes] = useState(c.interview_notes||'')
  const mrf = mrfs.find((m:MRF)=>m.id===c.mrf_id)

  return (
    <div style={{ position:'fixed', right:0, top:0, bottom:0, width:460, background:'#fff', borderLeft:'1px solid #EDE9FE', zIndex:200, overflowY:'auto', padding:20, boxShadow:'-4px 0 20px rgba(124,58,237,0.1)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' as const }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>{c.full_name}</div>
            <span style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:99, background:STAGE_COLOR[c.stage]+'18', color:STAGE_COLOR[c.stage] }}>{c.stage}</span>
          </div>
          <div style={{ fontSize:12, color:C.faint, marginTop:3 }}>{c.current_company} · {c.experience_years}yr · {c.phone||c.mobile}</div>
          {c.email&&<div style={{ fontSize:11, color:C.faint, marginTop:1 }}>✉️ {c.email}</div>}
          {mrf&&<div style={{ fontSize:11, color:C.brand, marginTop:3, fontWeight:600 }}>🎯 {mrf.designation||mrf.position}{c.source?` · Source: ${c.source}`:''}</div>}
        </div>
        <button onClick={onClose} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, padding:'4px 10px' }}></button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
        {[['Current CTC',c.current_ctc?`₹${(c.current_ctc/100000).toFixed(1)}L`:'—',C.brand],['Expected CTC',c.expected_ctc?`₹${(c.expected_ctc/100000).toFixed(1)}L`:'—',C.positive],['Notice Period',c.notice_period?c.notice_period+' days':'—',C.warning],['AI Score',c.ai_score?c.ai_score+'%':'—',(c.ai_tag||c.ai_match_tag)==='STRONG'?C.positive:C.warning]].map(([l,v,col])=>(
          <div key={l as string} style={{ background:C.sunken, borderRadius:7, padding:10, border:'1px solid #F3F0FF' }}>
            <div style={{ fontSize:10, color:C.faint, textTransform:'uppercase' as const, letterSpacing:'.04em' }}>{l}</div>
            <div style={{ fontSize:14, fontWeight:600, color:col as string, marginTop:2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Stage Move */}
      <SectionLine title="Stage Move" />
      <div style={{ display:'flex', flexWrap:'wrap' as const, gap:5, marginBottom:14 }}>
        {STAGES.map(s=>{
          const isBack = STAGES.indexOf(s) < STAGES.indexOf(c.stage)
          return (
            <button key={s} onClick={()=>{ if(!isBack) onStageChange(c.id,s) }} disabled={isBack}
              title={isBack?'Pipeline moves forward only — cannot return to an earlier round':''}
              style={{ ...T.btn, fontSize:10, padding:'4px 9px',
                background:c.stage===s?STAGE_COLOR[s]:STAGE_COLOR[s]+'12',
                color:c.stage===s?'#fff':STAGE_COLOR[s],
                border:c.stage===s?'none':`1px solid ${STAGE_COLOR[s]}30`,
                opacity:isBack?0.35:1, cursor:isBack?'not-allowed':'pointer',
                textDecoration:isBack?'line-through':'none' }}>
              {s}
            </button>
          )
        })}
      </div>

      {/* Interview Pipeline */}
      <SectionLine title="Interview Rounds" />
      <button onClick={()=>onOpenInterviews && onOpenInterviews(c)}
        style={{ ...T.btnPrimary, width:'100%', marginBottom:14, padding:10, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>Manage Interview Rounds →
      </button>

      {/* AI Questions */}
      <SectionLine title="Interview Questions" />
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:7 }}>
        <button onClick={()=>onGetQuestions(c)} disabled={aiQLoading} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, border:'1px solid #DDD6FE', fontSize:11 }}>
          {aiQLoading?'⏳...':'AI Questions Generate'}
        </button>
      </div>
      {(aiQs.length?aiQs:(c.ai_questions||[])).map((q:string,i:number)=>(
        <div key={i} style={{ background:C.sunken, borderRadius:6, padding:'7px 10px', marginBottom:5, fontSize:11, color:C.ink, border:'1px solid #EDE9FE' }}>
          <span style={{ color:C.brand, marginRight:5, fontWeight:600 }}>{i+1}.</span>{q}
        </div>
      ))}

      {/* Interview Notes & Feedback */}
      <SectionLine title="Interview Notes & Feedback" />
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:6 }}>
        <button onClick={()=>onGetFeedback(c,notes)} disabled={aiFbLoading} style={{ ...T.btn, background:C.positiveTint, color:C.positive, border:'1px solid #A7F3D0', fontSize:11 }}>
          {aiFbLoading?'⏳...':'AI Feedback Generate'}
        </button>
      </div>
      <textarea style={{ ...T.textarea, minHeight:140 }} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Write interview notes..." />
      <button onClick={()=>onSaveNotes(c.id,notes)} style={{ ...T.btnPrimary, marginTop:6 }}>Save Notes</button>
    </div>
  )
}

// ── NEGOTIATION CALCULATOR ────────────────────────────────────────
// ── Stipend calculator (Intern / NATS / NAPS / Contract / Live Project / Consultant) ──
function StipendCalc({ sel, mrf, companies, supabase, showNotify, onRefresh }:any) {
  const [stipend, setStipend] = useState('')
  const [tds, setTds] = useState(false)
  const [tdsPct, setTdsPct] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedLink, setSavedLink] = useState<string|null>(null)
  const [companyOverride, setCompanyOverride] = useState('')
  const autoCompany = sel?.company_id || mrf?.company_id || (companies?.length===1 ? companies[0].id : '')
  const effCompany = autoCompany || companyOverride
  const s = Number(stipend)||0
  const pct = tds ? (Number(tdsPct)||0) : 0
  const tdsAmt = Math.round(s*pct/100)
  const net = s - tdsAmt

  async function save() {
    if (!s) { showNotify('Enter the monthly stipend','error'); return }
    const companyId = effCompany || null
    if (!companyId) { showNotify('Select the company for this candidate first (dropdown in the calculator).','error'); return }
    if (!sel.company_id) await supabase.from('candidates').update({ company_id:companyId }).eq('id', sel.id)
    setSaving(true); setSavedLink(null)
    const calcData = { is_stipend:true, employment_type:mrf?.employment_type, stipend_monthly:s, tds_applicable:tds, tds_pct:pct, tds_amount:tdsAmt, net_monthly:net, annual:s*12 }
    const { data, error } = await supabase.from('ctc_negotiations').upsert({
      candidate_id:sel.id, company_id:companyId,
      offered_ctc:s*12, net_monthly:net,
      candidate_name:sel.full_name, position_title:sel.designation||null,
      is_stipend:true, stipend_monthly:s, tds_applicable:tds, tds_pct:pct,
      calculation_data:calcData,
    }).select('link_token').single()
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    setSavedLink(data?.link_token ? `${window.location.origin}/salary-view/${data.link_token}` : null)
    showNotify('Stipend saved! Salary link ready 👇'); onRefresh()
  }

  return (
    <div>
      <div style={T.cardPurple}>
        <div style={{ fontSize:13, fontWeight:600, color:C.brandDeep, marginBottom:4 }}>Stipend Calculator — {sel.full_name}</div>
        <div style={{ fontSize:11, color:C.faint, marginBottom:14 }}>{mrf?.employment_type||'Non-employee'} engagement · stipend only (no PF/HRA structure)</div>
        {!autoCompany && (
          <div style={{ marginBottom:12, padding:'8px 12px', background:C.warningTint, border:'1px solid #FDE68A', borderRadius:8 }}>
            <label style={T.label}>Company * <span style={{ color:C.warning, fontWeight:400 }}>— not set on this candidate, please choose</span></label>
            <select style={T.select} value={companyOverride} onChange={e=>setCompanyOverride(e.target.value)}>
              <option value="">Select company…</option>
              {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
            </select>
          </div>
        )}
        <div style={{ ...T.g2, marginBottom:10 }}>
          <div><label style={T.label}>Monthly Stipend (₹) *</label><input style={T.input} type="number" value={stipend} onChange={e=>setStipend(e.target.value)} placeholder="25000" /></div>
          <div><label style={T.label}>TDS Applicable?</label>
            <select style={T.select} value={tds?'Yes':'No'} onChange={e=>setTds(e.target.value==='Yes')}><option>No</option><option>Yes</option></select>
          </div>
        </div>
        {tds&&(<div style={{ marginBottom:10 }}><label style={T.label}>TDS %</label><input style={T.input} type="number" value={tdsPct} onChange={e=>setTdsPct(e.target.value)} placeholder="10" /></div>)}
        {s>0&&(
          <div style={{ marginTop:8, background:C.sunken, border:'1px solid #E9E5FF', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13 }}><span style={{ color:'#4B5563' }}>Monthly Stipend</span><span style={{ fontWeight:600 }}>₹{s.toLocaleString('en-IN')}</span></div>
            {tds&&<div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13, color:C.critical }}><span>(-) TDS ({pct}%)</span><span>-₹{tdsAmt.toLocaleString('en-IN')}</span></div>}
            <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0 0', fontSize:14, fontWeight:700, color:C.positive, borderTop:'1px solid #EDE9FE', marginTop:4 }}><span>Net In-Hand (monthly)</span><span>₹{net.toLocaleString('en-IN')}</span></div>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 0', fontSize:12, color:C.brand }}><span>Annual Stipend</span><span>₹{(s*12).toLocaleString('en-IN')}</span></div>
          </div>
        )}
        <button onClick={save} disabled={saving} style={{ ...T.btnPrimary, width:'100%', marginTop:12, padding:10 }}>{saving?'Saving…':'Save Stipend & Move to Offers'}</button>
        {savedLink&&(
          <div style={{ marginTop:12, background:'#F0F9FF', border:'1px solid #BAE6FD', borderRadius:8, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#0369A1', marginBottom:6 }}>CANDIDATE SALARY LINK</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input readOnly value={savedLink} onFocus={e=>e.target.select()} style={{ ...T.input, fontSize:11, fontFamily:'monospace' }} />
              <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btn, background:'#0EA5E9', color:'#fff', whiteSpace:'nowrap' as const }}>Copy</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Pre-negotiation document checks (Aadhaar + previous offer letter) ──
function PreNegoChecks({ candidate, supabase, showNotify, onDone }:any) {
  const [aadhaar, setAadhaar] = useState<string>(candidate.aadhaar_url||'')
  const [prevOffer, setPrevOffer] = useState<string>(candidate.prev_offer_url||'')
  const [busy, setBusy] = useState('')
  const [saving, setSaving] = useState(false)
  const aadhaarRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef<HTMLInputElement>(null)

  async function upload(docType:'AADHAAR'|'PREV_OFFER', file:File) {
    if (!file) return
    if (file.size > 5*1024*1024) { showNotify('File too large (max 5MB)','error'); return }
    setBusy(docType)
    const fd = new FormData()
    fd.append('candidate_id', candidate.id); fd.append('doc_type', docType); fd.append('file', file)
    try {
      const r = await fetch('/api/recruitment/upload-doc', { method:'POST', body:fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error||'Upload failed')
      if (docType==='AADHAAR') setAadhaar(d.path); else setPrevOffer(d.path)
      showNotify(`${docType==='AADHAAR'?'Aadhaar':'Previous offer letter'} uploaded ✓`)
    } catch(e:any){ showNotify('Upload failed: '+e.message,'error') }
    setBusy('')
  }

  async function save() {
    if (!aadhaar || !prevOffer) { showNotify('Please upload both documents first','error'); return }
    setSaving(true)
    const { error } = await supabase.from('candidates').update({ pre_negotiation_done:true }).eq('id', candidate.id)
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    showNotify(`${candidate.full_name} cleared pre-negotiation checks — moved to CTC Negotiations.`)
    onDone()
  }

  const box = (docType:'AADHAAR'|'PREV_OFFER', label:string, val:string, ref:React.RefObject<HTMLInputElement|null>) => (
    <div style={{ border:`2px dashed ${val?'#A7F3D0':C.brandEdge}`, borderRadius:10, padding:'14px 16px', background:val?C.positiveTint:C.sunken, marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>{val?'':''} {label} <span style={{ color:C.critical, fontSize:11 }}>*</span></div>
          {val && <div style={{ fontSize:11, color:C.positive, marginTop:3 }}>Uploaded</div>}
        </div>
        <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display:'none' }}
          onChange={e=>{ const f=e.target.files?.[0]; if(f) upload(docType,f); if(ref.current) ref.current.value='' }} />
        <button onClick={()=>ref.current?.click()} disabled={busy===docType} style={{ ...T.btnPrimary, opacity:busy===docType?.6:1 }}>
          {busy===docType?'Uploading…':val?'Re-upload':'Upload'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={T.cardPurple}>
      <div style={{ fontSize:13, fontWeight:600, color:C.brandDeep, marginBottom:6 }}>Pre-negotiation Checks — {candidate.full_name}</div>
      <div style={{ fontSize:11, color:C.faint, marginBottom:14 }}>Upload the candidate's documents, then save to begin CTC negotiation.</div>
      {box('AADHAAR','Aadhaar Card', aadhaar, aadhaarRef)}
      {box('PREV_OFFER','Previous Offer Letter', prevOffer, prevRef)}
      <button onClick={save} disabled={saving||!aadhaar||!prevOffer} style={{ ...T.btnPrimary, width:'100%', padding:11, marginTop:6, opacity:(saving||!aadhaar||!prevOffer)?.6:1 }}>
        {saving?'Saving…':'Save & Move to CTC Negotiations →'}
      </button>
    </div>
  )
}

function NegotiationTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify }:any) {
  // Offer Sent is intentionally excluded — once an offer goes out there's no more negotiation.
  // A revised offer moves the candidate back to 'Shortlisted', so they reappear here with the calculator.
  const finalCands = candidates.filter((c:Candidate)=>['Shortlisted'].includes(c.stage))
  const [subTab, setSubTab] = useState<'checks'|'ctc'>('checks')
  const [negQ, setNegQ] = useState('')
  const [f, setF] = useState({ company:'', department:'', position:'', location:'' })
  const checksCands = finalCands.filter((c:Candidate)=>!c.pre_negotiation_done)
  const ctcCands = finalCands.filter((c:Candidate)=>c.pre_negotiation_done)
  const activeList = subTab==='checks' ? checksCands : ctcCands
  const shownCands = activeList
    .filter((c:Candidate)=>!negQ || c.full_name.toLowerCase().includes(negQ.toLowerCase()))
    .filter((c:Candidate)=>candidateMatchesFilters(c, mrfs, f))
  const [sel, setSel] = useState<Candidate|null>(null)
  const selMrf = mrfs.find((m:MRF)=>m.id===sel?.mrf_id)
  // Interns / contract / consultants etc. use the simple stipend calculator, not the full CTC one.
  const isStipend = !!sel && (selMrf?.employment_type||'Employee') !== 'Employee'
  const [form, setForm] = useState({ ctc:'', varPct:'10', joining_bonus:'', joining_freq:'With Salary', retention_bonus:'', retention_freq:'After 3 Months', esop:'', esop_plan:'', state:'HR' })
  const [calc, setCalc] = useState<any>(null)
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

  const PT_RATES:Record<string,number> = { 'KA':200,'MH':200,'TN':0,'TS':200,'AP':200,'WB':200,'GJ':200,'MP':208,'OD':250,'AS':208,'KL':0,'HR':0,'DL':0,'UP':0 }

  function calculate() {
    const ctcAnnual = Number(form.ctc)
    if (!ctcAnnual) return
    const varPct = Number(form.varPct)/100
    const variable = ctcAnnual * varPct
    const fixed = ctcAnnual - variable
    const fixedMonthly = fixed/12
    const basic = fixedMonthly * 0.50
    const hra = basic * 0.50
    const statBonus = basic <= 21000 ? Math.round(basic*0.0833) : 0
    const otherAllow = Math.max(0, fixedMonthly - basic - hra - statBonus)
    const gross = basic + hra + statBonus + otherAllow
    const epfEmployee = Math.min(basic, 15000) * 0.12
    const esicEmployee = gross <= 21000 ? gross * 0.0075 : 0
    const ptMonthly = PT_RATES[form.state] || 0
    const lwfMonthly = 34
    const totalDed = epfEmployee + esicEmployee + ptMonthly + lwfMonthly
    const inHand = gross - totalDed
    const epfEmployer = Math.min(basic, 15000) * 0.12
    const esicEmployer = gross <= 21000 ? gross * 0.0325 : 0
    // CTC = fixed gross (annual) + variable pay. By construction gross*12 = fixed = ctcAnnual - variable,
    // so (gross + varMonthly)*12 = ctcAnnual — i.e. monthly CTC reconciles to the entered annual CTC.
    const ctcMonthly = ctcAnnual / 12
    const hike = sel?.current_ctc ? ((ctcAnnual-sel.current_ctc)/sel.current_ctc*100).toFixed(1) : null

    setCalc({ ctcAnnual, variable, varMonthly:variable/12, fixedMonthly, basic, hra, statBonus, otherAllow, gross, epfEmployee, esicEmployee, ptMonthly, lwfMonthly, totalDed, inHand, epfEmployer, esicEmployer, totalCTCMonthly:ctcMonthly, totalCTCAnnual:ctcAnnual, hike,
      joining_bonus:Number(form.joining_bonus)||0, retention_bonus:Number(form.retention_bonus)||0, esop:Number(form.esop)||0, state:form.state })
  }

  // Load this candidate into the CTC calculator, pre-filling any saved negotiation.
  async function selectCtcCandidate(c:Candidate) {
    setSel(c); setCalc(null); setSavedLink(null); setLoadedNeg(null); F('ctc','')
    const { data } = await supabase.from('ctc_negotiations').select('*')
      .eq('candidate_id', c.id).order('created_at',{ascending:false}).limit(1).maybeSingle()
    // First time (no saved negotiation): seed Annual CTC from the candidate's expected CTC.
    if (!data) { F('ctc', c.expected_ctc ? String(c.expected_ctc) : ''); return }
    setLoadedNeg(data)
    setForm(f=>({ ...f,
      ctc:            data.offered_ctc!=null ? String(data.offered_ctc) : '',
      varPct:         data.variable_pct!=null ? String(data.variable_pct) : '10',
      joining_bonus:  data.joining_bonus ? String(data.joining_bonus) : '',
      joining_freq:   data.joining_bonus_freq || 'With Salary',
      retention_bonus:data.retention_bonus ? String(data.retention_bonus) : '',
      retention_freq: data.retention_bonus_freq || 'After 3 Months',
      esop:           data.esop_value ? String(data.esop_value) : '',
      esop_plan:      data.esop_remark || '',
      state:          data.calculation_data?.state || f.state || 'HR',
    }))
    if (data.calculation_data) setCalc(data.calculation_data)
    if (data.link_token) setSavedLink(`${window.location.origin}/salary-view/${data.link_token}`)
  }

  async function saveNegotiation() {
    if (!sel||!calc) return
    const companyId = effCompany || null
    if (!companyId) { showNotify('Select the company for this candidate first (dropdown in the calculator).','error'); return }
    if (!sel.company_id) await supabase.from('candidates').update({ company_id:companyId }).eq('id', sel.id)
    setSaving(true); setSavedLink(null)
    const { data, error } = await supabase.from('ctc_negotiations').upsert({
      candidate_id:sel.id, company_id:companyId,
      offered_ctc:calc.ctcAnnual, variable_pct:Number(form.varPct)||null,
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
    showNotify('Negotiation saved! Salary link ready below 👇')
  }

  function downloadExcel() {
    if (!calc||!sel) return
    const rows = [
      ['Component','Formula','Monthly (₹)','Annual (₹)','Remark'],
      ['Basic','CTC*50%',Math.round(calc.basic),Math.round(calc.basic*12),''],
      ['HRA','Basic*50%',Math.round(calc.hra),Math.round(calc.hra*12),''],
      ['Other Allowance','Fixed-Basic-HRA-Stat Bonus',Math.round(calc.otherAllow),Math.round(calc.otherAllow*12),'Flexi pool'],
      ['Statutory Bonus','Basic*8.33% (if Basic≤21K)',Math.round(calc.statBonus),Math.round(calc.statBonus*12),''],
      ['Gross','',Math.round(calc.gross),Math.round(calc.gross*12),''],
      ['Emp EPF','Min(Basic,15K)*12%',Math.round(calc.epfEmployee),Math.round(calc.epfEmployee*12),'Deduction'],
      ['Emp ESIC','Gross*0.75% (if≤21K)',Math.round(calc.esicEmployee),Math.round(calc.esicEmployee*12),'Deduction'],
      ['PT','As per state',calc.ptMonthly,calc.ptMonthly*12,'Deduction'],
      ['LWF','As per state',calc.lwfMonthly,calc.lwfMonthly*12,'Deduction'],
      ['Total Deductions','',Math.round(calc.totalDed),Math.round(calc.totalDed*12),''],
      ['In Hand','Gross-Deductions',Math.round(calc.inHand),Math.round(calc.inHand*12),''],
      ['','','','',''],
      ['Emp EPF (Employer)','',Math.round(calc.epfEmployer),Math.round(calc.epfEmployer*12),''],
      ['Emp ESIC (Employer)','',Math.round(calc.esicEmployer),Math.round(calc.esicEmployer*12),''],
      ['','','','',''],
      ['Fixed Component','',Math.round(calc.fixedMonthly),Math.round(calc.fixedMonthly*12),''],
      ['Variable Component','',Math.round(calc.varMonthly),Math.round(calc.variable),''],
      ['CTC','Fixed Gross + Variable',Math.round(calc.totalCTCMonthly),calc.ctcAnnual,''],
      ['','','','',''],
      ['Joining Bonus ('+form.joining_freq+')','',' ',calc.joining_bonus,'One-time'],
      ['Retention Bonus ('+form.retention_freq+')','',' ',calc.retention_bonus,'One-time'],
      ['ESOP','',' ',calc.esop,'As per grant letter'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'CTC Structure')
    XLSX.writeFile(wb,`CTC_${sel.full_name}.xlsx`)
  }

  return (
    <div style={T.g2}>
      <div>
        <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' as const }}>
          <button onClick={()=>{ setSubTab('checks'); setSel(null) }} style={{ ...T.btnOutline, ...(subTab==='checks'?{ background:C.brand, color:'#fff', borderColor:C.brand }:{}) }}>Pre-negotiation Checks ({checksCands.length})</button>
          <button onClick={()=>{ setSubTab('ctc'); setSel(null) }} style={{ ...T.btnOutline, ...(subTab==='ctc'?{ background:C.brand, color:'#fff', borderColor:C.brand }:{}) }}>CTC Negotiations ({ctcCands.length})</button>
        </div>
        <SearchBar placeholder="Search candidate…" onApply={setNegQ} width={240} />
        <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />
        {shownCands.map((c:Candidate)=>(
          <div key={c.id} onClick={()=>{ if(subTab==='ctc'){ selectCtcCandidate(c) } else { setSel(c) } }}
            style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?C.brandTint:'#fff' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L exp':'—'}</div>
              </div>
              {subTab==='ctc' && (
                <button onClick={(e)=>rejectCand(c,e)} style={{ padding:'4px 10px', borderRadius:7, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit', background:C.criticalTint, color:C.critical, flexShrink:0 }}>Reject</button>
              )}
            </div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' as const }}>
              <Badge text={c.stage} />
              {subTab==='ctc' && respMap[c.id]==='ACCEPTED' && <Badge text="Offer Accepted" />}
              {subTab==='ctc' && respMap[c.id]==='REJECTED' && <Badge text="Offer Rejected" />}
              {c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}
            </div>
          </div>
        ))}
        {shownCands.length===0&&<div style={{ ...T.card, color:C.faint, fontSize:13, textAlign:'center' as const, padding:24 }}>{negQ?'No matching candidate':(subTab==='checks'?'No candidates awaiting pre-negotiation checks':'No candidates ready for CTC negotiation')}</div>}
      </div>

      {subTab==='checks'&&sel&&(
        <PreNegoChecks candidate={sel} supabase={supabase} showNotify={showNotify}
          onDone={()=>{ setSel(null); setSubTab('ctc'); onRefresh() }} />
      )}

      {subTab==='ctc'&&sel&&isStipend&&<StipendCalc sel={sel} mrf={selMrf} companies={companies} supabase={supabase} showNotify={showNotify} onRefresh={onRefresh} />}

      {subTab==='ctc'&&sel&&!isStipend&&(
        <div>
          <div style={T.cardPurple}>
            <div style={{ fontSize:13, fontWeight:600, color:C.brandDeep, marginBottom:14 }}>CTC Calculator — {sel.full_name}</div>
            {loadedNeg?.candidate_response && (
              <div style={{ marginBottom:12, padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:600,
                background: loadedNeg.candidate_response==='ACCEPTED'?C.positiveTint:C.criticalTint,
                color: loadedNeg.candidate_response==='ACCEPTED'?C.positive:C.critical,
                border:`1px solid ${loadedNeg.candidate_response==='ACCEPTED'?'#A7F3D0':'#FCA5A5'}` }}>
                {loadedNeg.candidate_response==='ACCEPTED'?'Candidate ACCEPTED this offer':'Candidate REJECTED this offer'}
                {loadedNeg.response_note?` — “${loadedNeg.response_note}”`:''}
              </div>
            )}
            {!autoCompany && (
              <div style={{ marginBottom:12, padding:'8px 12px', background:C.warningTint, border:'1px solid #FDE68A', borderRadius:8 }}>
                <label style={T.label}>Company * <span style={{ color:C.warning, fontWeight:400 }}>— not set on this candidate, please choose</span></label>
                <select style={T.select} value={companyOverride} onChange={e=>setCompanyOverride(e.target.value)}>
                  <option value="">Select company…</option>
                  {(companies||[]).map((co:any)=><option key={co.id} value={co.id}>{co.company_name||co.company_code}</option>)}
                </select>
              </div>
            )}
            <SectionLine title="Input" />
            <div style={{ ...T.g3, marginBottom:10 }}>
              <div><label style={T.label}>Annual CTC (₹) *</label><input style={T.input} type="number" value={form.ctc} onChange={e=>F('ctc',e.target.value)} placeholder="2400000" /></div>
              <div><label style={T.label}>Variable % (default 10)</label><input style={T.input} type="number" value={form.varPct} onChange={e=>F('varPct',e.target.value)} /></div>
              <div><label style={T.label}>Employee State (PT)</label>
                <select style={T.select} value={form.state} onChange={e=>F('state',e.target.value)}>
                  {[['HR','Haryana'],['DL','Delhi'],['KA','Karnataka'],['MH','Maharashtra'],['UP','UP'],['TS','Telangana'],['AP','Andhra Pradesh'],['WB','West Bengal'],['GJ','Gujarat'],['MP','MP'],['TN','Tamil Nadu']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <SectionLine title="One-time Payments" />
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Joining Bonus (₹)</label><input style={T.input} type="number" value={form.joining_bonus} onChange={e=>F('joining_bonus',e.target.value)} placeholder="100000" /></div>
              <div><label style={T.label}>Payment Frequency</label>
                <select style={T.select} value={form.joining_freq} onChange={e=>F('joining_freq',e.target.value)}>
                  <option>With Salary</option><option>After 3 Months</option><option>After 6 Months</option><option>As per Policy</option>
                </select>
              </div>
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Retention Bonus (₹)</label><input style={T.input} type="number" value={form.retention_bonus} onChange={e=>F('retention_bonus',e.target.value)} placeholder="200000" /></div>
              <div><label style={T.label}>Payment Frequency</label>
                <select style={T.select} value={form.retention_freq} onChange={e=>F('retention_freq',e.target.value)}>
                  <option>After 3 Months</option><option>After 6 Months</option><option>After 1 Year</option><option>As per Policy</option>
                </select>
              </div>
            </div>
            <div style={{ ...T.g2, marginBottom:14 }}>
              <div><label style={T.label}>ESOP (₹ Grant Value)</label><input style={T.input} type="number" value={form.esop} onChange={e=>F('esop',e.target.value)} placeholder="2000000" /></div>
              <div><label style={T.label}>ESOP Plan / Vesting</label><input style={T.input} value={form.esop_plan} onChange={e=>F('esop_plan',e.target.value)} placeholder="4 yr vesting, 1 yr cliff" /></div>
            </div>
            <button onClick={calculate} style={{ ...T.btnPrimary, width:'100%', padding:'10px', fontSize:13 }}>Calculate CTC Structure →</button>
          </div>

          {calc&&(
            <div style={T.card}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div style={T.section}>CTC Breakdown</div>
                <button onClick={downloadExcel} style={{ ...T.btn, background:C.positive, color:'#fff', fontSize:11 }}>Download Excel</button>
              </div>

              {/* Salary Table */}
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:C.brandTint }}>
                    <th style={{ padding:'7px 10px', textAlign:'left' as const, color:C.brandDeep, fontWeight:600, fontSize:11 }}>Component</th>
                    <th style={{ padding:'7px 10px', textAlign:'right' as const, color:C.brandDeep, fontWeight:600, fontSize:11 }}>Monthly (₹)</th>
                    <th style={{ padding:'7px 10px', textAlign:'right' as const, color:C.brandDeep, fontWeight:600, fontSize:11 }}>Annual (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Basic', calc.basic, true],
                    ['HRA', calc.hra, true],
                    ['Other Allowance (Flexi Pool)', calc.otherAllow, true],
                    ['Statutory Bonus', calc.statBonus, true],
                  ].map(([l,v,show])=>show&&(
                    <tr key={l as string} style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:C.inkSoft }}>{l}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, fontWeight:500 }}>₹{Math.round(v as number).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round((v as number)*12).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  <tr style={{ background:C.brandTint }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:C.ink }}>Gross</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:C.brand }}>₹{Math.round(calc.gross).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:C.brand }}>₹{Math.round(calc.gross*12).toLocaleString('en-IN')}</td>
                  </tr>
                  <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                    <td style={{ padding:'6px 10px', color:C.critical, fontSize:11 }}>(-) Employee EPF</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{Math.round(calc.epfEmployee).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{Math.round(calc.epfEmployee*12).toLocaleString('en-IN')}</td>
                  </tr>
                  {calc.esicEmployee>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:C.critical, fontSize:11 }}>(-) Employee ESIC</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{Math.round(calc.esicEmployee).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{Math.round(calc.esicEmployee*12).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  {calc.ptMonthly>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:C.critical, fontSize:11 }}>(-) PT ({form.state})</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{calc.ptMonthly}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.critical }}>-₹{calc.ptMonthly*12}</td>
                    </tr>
                  )}
                  <tr style={{ background:C.positiveTint, borderBottom:'2px solid #A7F3D0' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:C.positive, fontSize:13 }}>In Hand</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:C.positive, fontSize:14 }}>₹{Math.round(calc.inHand).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:C.positive }}>₹{Math.round(calc.inHand*12).toLocaleString('en-IN')}</td>
                  </tr>
                  <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                    <td style={{ padding:'6px 10px', color:C.muted, fontSize:11 }}>Employer EPF</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round(calc.epfEmployer).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round(calc.epfEmployer*12).toLocaleString('en-IN')}</td>
                  </tr>
                  {calc.esicEmployer>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:C.muted, fontSize:11 }}>Employer ESIC</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round(calc.esicEmployer).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round(calc.esicEmployer*12).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  {calc.variable>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:C.inkSoft }}>Variable Pay ({form.varPct}%) <span style={{ fontSize:10, color:C.faint }}>performance-linked</span></td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, fontWeight:500 }}>₹{Math.round(calc.varMonthly).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:C.muted }}>₹{Math.round(calc.variable).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  <tr style={{ background:C.brandTint }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:C.ink }}>CTC <span style={{ fontSize:10, fontWeight:400, color:C.faint }}>(Fixed Gross + Variable)</span></td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:C.brand }}>₹{Math.round(calc.totalCTCMonthly).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:C.brand, fontSize:14 }}>₹{calc.ctcAnnual.toLocaleString('en-IN')}</td>
                  </tr>
                </tbody>
              </table>

              {/* One-time Payments */}
              {(calc.joining_bonus>0||calc.retention_bonus>0||calc.esop>0)&&(
                <div style={{ marginTop:12 }}>
                  <div style={T.section}>One-time Payments</div>
                  {calc.joining_bonus>0&&(
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
                      <span>Joining Bonus <span style={{ fontSize:10, color:C.faint }}>({form.joining_freq})</span></span>
                      <span style={{ fontWeight:600, color:C.positive }}>₹{calc.joining_bonus.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.retention_bonus>0&&(
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
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
                </div>
              )}

              {calc.hike&&(
                <div style={{ marginTop:12, background:C.positiveTint, borderRadius:8, padding:'10px 14px', display:'flex', gap:16 }}>
                  <span style={{ fontSize:13, color:C.positive, fontWeight:600 }}>Hike: {calc.hike}%</span>
                  <span style={{ fontSize:12, color:C.inkSoft }}>Current: ₹{((sel?.current_ctc||0)/100000).toFixed(1)}L → Offered: ₹{(calc.ctcAnnual/100000).toFixed(1)}L</span>
                </div>
              )}

              <button onClick={saveNegotiation} disabled={saving} style={{ ...T.btnPrimary, width:'100%', marginTop:12, padding:10 }}>
                {saving?'Saving...':'Save Negotiation & Move to Offers'}
              </button>

              {savedLink&&(
                <div style={{ marginTop:12, background:'#F0F9FF', border:'1px solid #BAE6FD', borderRadius:8, padding:'12px 14px' }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#0369A1', marginBottom:6 }}>CANDIDATE SALARY LINK</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <input readOnly value={savedLink} onFocus={e=>e.target.select()} style={{ ...T.input, fontSize:11, fontFamily:'monospace' }} />
                    <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btn, background:'#0EA5E9', color:'#fff', whiteSpace:'nowrap' as const }}>Copy</button>
                    <a href={savedLink} target="_blank" rel="noopener noreferrer" style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, textDecoration:'none', whiteSpace:'nowrap' as const }}>Open ↗</a>
                  </div>
                  <div style={{ fontSize:10, color:'#0C4A6E', marginTop:6 }}>Share with the candidate — shows salary breakdown only (no internal data).</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── OFFERS TAB ────────────────────────────────────────────────────
// ── OFFER APPROVAL TAB (Recruiter → HR Head) ──────────────────────
function OfferApprovalTab({ supabase, companies, departments, locations, candidates, mrfs, onRefresh }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
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
  async function pick(c:Candidate) {
    if (activeReq(c.id)) return   // #9 — already requested; cannot re-create
    setSel(c); setNeg(null); setLoading(true)
    const { data } = await supabase.from('ctc_negotiations').select('*').eq('candidate_id',c.id).order('created_at',{ascending:false}).limit(1)
    setNeg(data?.[0]||null); setLoading(false)
  }
  const mrf = sel ? mrfs.find((m:MRF)=>m.id===sel.mrf_id) : null

  if (sel) {
    return (
      <div>
        <button style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, marginBottom:12 }} onClick={()=>{setSel(null);setNeg(null)}}>Back to candidates</button>
        {loading ? <div style={{ ...T.card, textAlign:'center' as const, color:C.brand }}>Loading negotiation…</div>
          : neg ? (
            <>
              <CreateOfferApproval candidate={sel} negotiation={neg} mrf={mrf} onSubmitted={()=>{ onRefresh?.(); setSel(null); setNeg(null) }} />
              <div style={{ maxWidth:700, margin:'16px auto 0' }}><AuditTrailViewer candidateId={sel.id} /></div>
            </>
          ) : (
            <div style={{ ...T.card, color:C.warning, background:C.warningTint, border:'1px solid #FDE68A' }}>
              No CTC negotiation found for <b>{sel.full_name}</b>. Create one in the 💰 Negotiation tab first.
            </div>
          )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:12 }}>Select a candidate to create an offer approval request for HR Head review.</div>
      <SearchBar placeholder="Search candidate…" onApply={setOaQ} width={240} />
      <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />
      {shownEligible.length===0 ? (
        <div style={{ ...T.card, textAlign:'center' as const, color:C.faint }}>{oaQ?'No matching candidate':'No candidates have accepted their CTC offer yet. They appear here once a candidate Accepts the salary link.'}</div>
      ) : shownEligible.map((c:Candidate)=>{
        const ar = activeReq(c.id)
        return (
        <div key={c.id} style={{ ...T.card, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600, display:'flex', gap:6, alignItems:'center' }}>{c.full_name}{c.offer_revised&&<Badge text="Revised Offer" />}</div>
            <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.designation||'—'} · {c.stage}</div>
          </div>
          {ar ? (
            <div style={{ textAlign:'right' as const, flexShrink:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color: ar.status==='HR_HEAD_REJECTED' ? C.critical : C.positive }}>
                {ar.status==='SUBMITTED' ? '⏳ ' : ar.status==='OFFER_SENT' ? '📤 ' : '✅ '}{STATUS_LABEL[ar.status] || ar.status}
              </div>
              {ar.submitted_at && <div style={{ fontSize:10.5, color:C.faint, marginTop:2 }}>on {new Date(ar.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>}
            </div>
          ) : (
            <button style={{ ...T.btn, background:C.brand, color:'#fff', flexShrink:0 }} onClick={()=>pick(c)}>Create Request →</button>
          )}
        </div>
      )})}
    </div>
  )
}

function OffersTab({ supabase, companies, departments, locations, mrfs, candidates, onRefresh, showNotify }:any) {
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

  return (
    <div style={T.g2}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:C.ink, marginBottom:10 }}>Shortlisted / Offer Stage ({shownOffered.length})</div>
        <SearchBar placeholder="Search candidate…" onApply={setOffQ} width={240} />
        <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />
        {shownOffered.map((c:Candidate)=>(
          <div key={c.id} style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?C.brandTint:'#fff' }}
            onClick={()=>generateLetter(c)}>
            <div style={{ fontSize:13, fontWeight:600, color:C.ink }}>{c.full_name}</div>
            <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L':' — '}</div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' as const }}><Badge text={c.stage} />{c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}</div>
            {c.stage==='Offer Sent'&&!c.offer_accepted&&(
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button onClick={(e)=>{ e.stopPropagation(); markAccepted(c) }} style={{ ...T.btn, background:C.positive, color:'#fff', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>Accepted</button>
                <button onClick={(e)=>{ e.stopPropagation(); markRevision(c) }} style={{ ...T.btn, background:C.warningTint, color:C.warning, border:'1px solid #FDE68A', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>Revision</button>
                <button onClick={(e)=>{ e.stopPropagation(); markBackout(c) }} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FCA5A5', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>Backout</button>
              </div>
            )}
            {c.stage==='Offer Sent'&&c.offer_accepted&&(
              <div style={{ fontSize:10, color:C.positive, marginTop:6, fontWeight:600 }}>Accepted — moved to Pre-onboarding</div>
            )}
          </div>
        ))}
        {offeredCands.length===0&&<div style={{ ...T.card, color:C.faint, textAlign:'center' as const, padding:24 }}>No candidates</div>}
      </div>
      {sel&&letter&&(
        <div>
          <div style={T.card}>
            <div style={T.section}>Offer Letter</div>
            <div style={{ marginBottom:8 }}><label style={T.label}>To Email</label><input style={T.input} value={toEmail} onChange={e=>setToEmail(e.target.value)} /></div>
            <div style={{ marginBottom:8 }}><label style={T.label}>CC (comma separated)</label><input style={T.input} value={cc} onChange={e=>setCc(e.target.value)} placeholder="hr@co.com, md@co.com" /></div>
            <div style={{ marginBottom:10 }}><label style={T.label}>Date of Joining</label><input style={T.input} type="date" value={doj} onChange={e=>setDoj(e.target.value)} /></div>
            <textarea style={{ ...T.textarea, minHeight:300, fontFamily:'monospace', fontSize:11 }} value={letter} onChange={e=>setLetter(e.target.value)} />
            <button onClick={sendOffer} style={{ ...T.btnPrimary, width:'100%', marginTop:10, padding:10 }}>Send Offer Letter</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PRE-ONBOARDING ────────────────────────────────────────────────
function PreOnboardTab({ supabase, candidates, companies, departments, locations, mrfs, onRefresh, showNotify }:any) {
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
      const r = await fetch('/api/recruitment/send-letter', { method:'POST', headers:{'Content-Type':'application/json'},
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
    <div>
      <div style={T.section}>Pre-onboarding & Offer Response</div>
      <SearchBar placeholder="Search candidate…" onApply={setPoQ} width={260} />
      <RecFilterBar companies={companies} departments={departments} locations={locations} positions={distinctPositions(candidates)} f={f} setF={setF} />
      {shownOnboarding.length===0&&<div style={{ ...T.card, color:C.faint, textAlign:'center' as const, padding:24 }}>{poQ?'No matching candidate':'No offer-sent candidates yet.'}</div>}
      {shownOnboarding.map((c:Candidate)=>{
        const row:any = linkByCand.get(c.id)
        const resp = row?.offer_response
        const [bg,fg] = resp ? respStyle[resp] : ['#fff',C.muted]
        return (
          <div key={c.id} style={{ ...T.card, border:`1px solid ${resp?fg+'40':'rgba(124,58,237,0.12)'}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:C.ink }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{c.designation||'—'} · {companyName(c)} · DOJ: {row?.doj||c.doj||'Not set'}</div>
                {c.email&&<div style={{ fontSize:11, color:C.faint, marginTop:1 }}>{c.email}</div>}
              </div>
              {resp&&(
                <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:bg, color:fg }}>
                  {resp==='ACCEPTED'?`✅ Accepted (${row?.candidate_type==='EXPERIENCED'?'Experienced':'Fresher'})`:resp==='REVISE'?'Revision requested':'Backed out'}
                </span>
              )}
            </div>

            {/* Onboarding date + HR email — drive the reminder emails */}
            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' as const }}>
              <label style={{ fontSize:11, color:C.brandDeep, fontWeight:600 }}>Onboarding date:</label>
              <input type="date" value={obVal(c)} onChange={e=>setObDates(m=>({...m,[c.id]:e.target.value}))} style={{ ...T.input, width:150, fontSize:12 }} />
              <label style={{ fontSize:11, color:C.brandDeep, fontWeight:600 }}>HR email:</label>
              <input value={hrVal(c)} onChange={e=>setHrEmails(m=>({...m,[c.id]:e.target.value}))} placeholder="hr@company.com" style={{ ...T.input, width:180, fontSize:12 }} />
              <button onClick={()=>saveOnboarding(c)} style={{ ...T.btn, background:C.brandTint, color:C.brandDeep, fontSize:11 }}>Save</button>
              {(()=>{ const d=daysToJoin(c); if(d===null) return null
                return d>=0 && d<=3
                  ? <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:C.positiveTint, color:C.positive }}>Joining in {d} day{d===1?'':'s'} — start onboarding</span>
                  : <span style={{ fontSize:11, color:d<0?C.critical:C.faint }}>{d<0?'past joining date':`${d} days to join`}</span> })()}
            </div>
            {!c.hr_email&&!hrEmails[c.id]&&<div style={{ fontSize:10, color:C.critical, marginTop:4 }}>Add an HR email so onboarding reminder mails can be sent.</div>}

            {!resp&&(
              choose===c.id ? (
                <div style={{ marginTop:12, background:C.sunken, borderRadius:8, padding:'10px 12px', border:'1px solid #E9E5FF' }}>
                  <div style={{ fontSize:12, color:C.brandDeep, fontWeight:600, marginBottom:8 }}>Candidate type — sends the right letter:</div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button disabled={busy===c.id} onClick={()=>sendAcceptance(c,'EXPERIENCED')} style={{ ...T.btn, background:C.brand, color:'#fff' }}>{busy===c.id?'Sending…':'Experienced → Resignation Acceptance'}</button>
                    <button disabled={busy===c.id} onClick={()=>sendAcceptance(c,'FRESHER')} style={{ ...T.btn, background:C.info, color:'#fff' }}>{busy===c.id?'Sending…':'Fresher → Joining Confirmation'}</button>
                    <button onClick={()=>setChoose('')} style={{ ...T.btn, background:'transparent', color:C.faint }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  <button onClick={()=>setChoose(c.id)} style={{ ...T.btn, background:C.positiveTint, color:C.positive, border:'1px solid #A7F3D0', fontWeight:600 }}>Accepted</button>
                  <button onClick={()=>markRevise(c)} style={{ ...T.btn, background:C.warningTint, color:C.warning, border:'1px solid #FDE68A', fontWeight:600 }}>Revise Offer</button>
                  <button onClick={()=>markBackout(c)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FECACA', fontWeight:600 }}>Backout</button>
                </div>
              )
            )}

            {resp==='ACCEPTED'&&row?.acceptance_letter_sent_at&&(
              <div style={{ marginTop:10, fontSize:11, color:C.positive }}>✉️ {row.candidate_type==='EXPERIENCED'?'Resignation Acceptance':'Joining Confirmation'} letter sent · {new Date(row.acceptance_letter_sent_at).toLocaleDateString('en-IN')}</div>
            )}
            {resp==='REVISE'&&row?.revise_note&&(
              <div style={{ marginTop:10, fontSize:11, color:C.warning, background:C.warningTint, borderRadius:6, padding:'6px 10px' }}>Revision note: {row.revise_note}</div>
            )}
            {resp==='BACKOUT'&&(
              <div style={{ marginTop:10, fontSize:11, color:'#991B1B', background:C.criticalTint, borderRadius:6, padding:'6px 10px' }}>Blacklisted · MRF reopened{row?.revise_note?` · Reason: ${row.revise_note}`:''}</div>
            )}
            {/* Backout available any day (even after acceptance) — blacklists + reopens the MRF */}
            {(resp==='ACCEPTED'||resp==='REVISE')&&(
              <div style={{ marginTop:10 }}>
                <button onClick={()=>markBackout(c)} style={{ ...T.btn, background:C.criticalTint, color:C.critical, border:'1px solid #FECACA', fontSize:11 }}>Candidate Backed Out</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
