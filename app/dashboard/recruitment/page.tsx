'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
import { CreateOfferApproval, HRHeadApprovalDashboard, HRManagerSendOffer, AuditTrailViewer } from './offer-flow-components'
import InterviewPipeline from '@/components/recruitment/InterviewPipeline'

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
const STAGE_COLOR:Record<string,string> = {
  'Applied':'#7C3AED','AI Screened':'#6D28D9','Telephonic':'#D97706',
  'L1':'#DB2777','L2':'#059669','Optional Round':'#4F46E5',
  'Shortlisted':'#16A34A','Offer Sent':'#0891B2','Joined':'#15803D','Rejected':'#DC2626'
}
const EMP_TYPES = ['Employee','Intern','Contract','Consultant','NAPS','NATS','Live Project']
const EDUCATION_OPTIONS = ['Any Graduate','B.Tech/B.E.','MBA/PGDM','M.Tech','B.Com/M.Com','BCA/MCA','Diploma','12th Pass','Any Post Graduate']
const SOURCES = ['Direct','Naukri','LinkedIn','Referral','Campus','WhatsApp','Consultancy','Other']

// ── LIGHT THEME STYLES ───────────────────────────────────────────
const T = {
  page: { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
  card: { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  cardPurple: { background:'#FFFFFF', borderRadius:10, border:'1.5px solid #7C3AED', padding:'14px 16px', marginBottom:10, boxShadow:'0 2px 12px rgba(124,58,237,0.1)' } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  select: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  textarea: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', resize:'vertical' as const, minHeight:90, fontFamily:'inherit', boxSizing:'border-box' as const },
  btn: { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnPrimary: { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' } as React.CSSProperties,
  btnOutline: { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9' } as React.CSSProperties,
  g2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
  g3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 } as React.CSSProperties,
  g4: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 } as React.CSSProperties,
  row: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F3F0FF' } as React.CSSProperties,
  section: { fontSize:12, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10, marginTop:4, display:'flex', alignItems:'center', gap:8 } as React.CSSProperties,
}

// ── HELPERS ───────────────────────────────────────────────────────
function Badge({ text }:{ text:string }) {
  const map:Record<string,[string,string]> = {
    DRAFT:['#F3F0FF','#6D28D9'], SUBMITTED:['#EFF6FF','#1D4ED8'],
    APPROVED:['#ECFDF5','#059669'], REJECTED:['#FEF2F2','#DC2626'],
    CLOSED:['#F1F5F9','#64748B'], STRONG:['#ECFDF5','#059669'],
    PARTIAL:['#FFFBEB','#D97706'], NOT_SUITABLE:['#FEF2F2','#DC2626'],
    'Offer Sent':['#ECFEFF','#0891B2'], Joined:['#F0FDF4','#16A34A'],
    CREATED:['#FFFBEB','#D97706'], SENT:['#EFF6FF','#1D4ED8'],
    OPENED:['#F3F0FF','#6D28D9'], SUBMITTED_PRE:['#ECFDF5','#059669'],
    'Quick Hire':['#FFF7ED','#EA580C'], 'Full MRF':['#EEF2FF','#4338CA'],
    'Revised Offer':['#FEF3C7','#B45309'], 'Blacklisted':['#FEF2F2','#DC2626'],
  }
  const [bg,c] = map[text] || ['#F3F0FF','#6D28D9']
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{text}</span>
}

function Toast({ msg, type, onClose }:{ msg:string, type:'success'|'error', onClose:()=>void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
      background:type==='success'?'#059669':'#DC2626', color:'#fff',
      borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500,
      boxShadow:'0 8px 24px rgba(0,0,0,0.2)', display:'flex', alignItems:'center', gap:10 }}>
      {type==='success'?'✓':'✗'} {msg}
      <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
    </div>
  )
}

function SectionLine({ title }:{ title:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, margin:'14px 0 10px' }}>
      <div style={{ fontSize:11, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.06em', whiteSpace:'nowrap' as const }}>{title}</div>
      <div style={{ flex:1, height:1, background:'#EDE9FE' }} />
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────
export default function RecruitmentPage() {
  const [tab, setTab] = useState<'dashboard'|'mrf'|'screening'|'pipeline'|'negotiation'|'offerapproval'|'hrhead'|'sendoffer'|'offers'|'preonboarding'>('dashboard')
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

  const TABS = [
    { k:'dashboard', l:'📊 Dashboard' },
    { k:'mrf', l:'📝 MRF' },
    { k:'screening', l:'🤖 AI Screening' },
    { k:'pipeline', l:'🔀 Pipeline' },
    { k:'negotiation', l:'💰 Negotiation' },
    { k:'offerapproval', l:'📋 Offer Approval' },
    { k:'hrhead', l:'✅ HR Head' },
    { k:'sendoffer', l:'📨 Send Offers' },
    { k:'offers', l:'📄 Offers' },
    { k:'preonboarding', l:'🎉 Pre-onboarding' },
  ]
  const props = { supabase, companies, locations, departments, mrfs, candidates, onRefresh:loadAll, showNotify }

  if (loading) return (
    <div style={{ ...T.page, display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div style={{ color:'#7C3AED', fontSize:14, fontWeight:500 }}>Loading...</div>
    </div>
  )

  return (
    <div style={T.page}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#7C3AED,#4F46E5)', padding:'16px 24px' }}>
        <div style={{ fontSize:18, fontWeight:600, color:'#fff', marginBottom:2 }}>Recruitment & ATS</div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.6)' }}>MRF → AI Screening → Pipeline → Negotiation → Offer → Pre-onboarding</div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#fff', display:'flex', padding:'0 24px', borderBottom:'1px solid #EDE9FE', overflowX:'auto', boxShadow:'0 1px 4px rgba(124,58,237,0.08)' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)} style={{ ...T.btn, background:'transparent', borderRadius:0, padding:'11px 16px',
            color:tab===t.k?'#7C3AED':'#9CA3AF', borderBottom:tab===t.k?'2px solid #7C3AED':'2px solid transparent',
            fontWeight:tab===t.k?600:400 }}>
            {t.l}
          </button>
        ))}
      </div>

      <div style={{ padding:'18px 24px', maxWidth:1300 }}>
        {tab==='dashboard' && <DashTab {...props} />}
        {tab==='mrf' && <MRFTab {...props} />}
        {tab==='screening' && <ScreeningTab {...props} />}
        {tab==='pipeline' && <PipelineTab {...props} />}
        {tab==='negotiation' && <NegotiationTab {...props} />}
        {tab==='offerapproval' && <OfferApprovalTab {...props} />}
        {tab==='hrhead' && <HRHeadApprovalDashboard />}
        {tab==='sendoffer' && <HRManagerSendOffer />}
        {tab==='offers' && <OffersTab {...props} />}
        {tab==='preonboarding' && <PreOnboardTab {...props} />}
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
        {[{l:'Total MRFs',v:mrfs.length,c:'#7C3AED',bg:'#F3F0FF'},{l:'Active Openings',v:openings,c:'#1D4ED8',bg:'#EFF6FF'},{l:'In Pipeline',v:candidates.length,c:'#D97706',bg:'#FFFBEB'},{l:'Joined This Month',v:joined.length,c:'#059669',bg:'#ECFDF5'}].map(s=>(
          <div key={s.l} style={{ ...T.card, textAlign:'center' as const, background:s.bg, border:`1px solid ${s.c}20` }}>
            <div style={{ fontSize:28, fontWeight:600, color:s.c }}>{s.v}</div>
            <div style={{ fontSize:11, color:'#6B7280', marginTop:3 }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={T.card}>
        <div style={T.section}>Pipeline Overview</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
          {STAGES.map(s=>(
            <div key={s} style={{ background:STAGE_COLOR[s]+'12', borderRadius:8, padding:'8px 12px', textAlign:'center' as const, minWidth:72, border:`1px solid ${STAGE_COLOR[s]}25` }}>
              <div style={{ fontSize:20, fontWeight:600, color:STAGE_COLOR[s] }}>{stageCount[s]||0}</div>
              <div style={{ fontSize:9, color:'#6B7280', marginTop:2, lineHeight:1.3 }}>{s}</div>
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
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:1 }}>{m.employment_type} · {m.no_of_openings||m.openings||0} openings</div>
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
              <span style={{ fontSize:14, fontWeight:600, color:'#1E1B4B' }}>{mrfs.filter((m:MRF)=>m.status===st).length}</span>
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
            <span key={s} style={{ fontSize:11, padding:'3px 8px', borderRadius:99, background:'#EDE9FE', color:'#6D28D9', fontWeight:500, display:'inline-flex', alignItems:'center' }}>
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
              <div key={s} onClick={()=>add(s)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:'#1E1B4B' }}>{s}</div>
            ))}
            {!exact && q.trim() && (
              <div onClick={addCustom} style={{ padding:'7px 10px', cursor:'pointer', fontSize:13, color:'#7C3AED', fontWeight:600, borderTop:matches.length?'1px solid #F3F0FF':'none' }}>+ Add custom: “{q.trim()}”</div>
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

// ── MRF TAB ───────────────────────────────────────────────────────
function MRFTab({ supabase, companies, locations, departments, mrfs, candidates, onRefresh, showNotify }:any) {
  const EMPTY = { company_id:'', location_id:'', department_id:'', designation:'', no_of_openings:1,
    employment_type:'Employee', urgency:'MEDIUM', reason:'', job_description:'', budget_min:'',
    budget_max:'', experience_required:'', mrf_type:'Full MRF', education_required:'',
    skills_required:'', hiring_type:'New Hire', previous_company_preference:'',
    experience_min:'', experience_max:'', education_min:'', education_max:'' }
  const [showForm, setShowForm] = useState(false)
  const [editMRF, setEditMRF] = useState<MRF|null>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [mrfQ, setMrfQ] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fPos, setFPos] = useState('')
  const mrfPositions = Array.from(new Set(mrfs.map((m:MRF)=>m.designation||m.position).filter(Boolean))).sort() as string[]
  const [aiLoading, setAiLoading] = useState(false)
  const [approvalModal, setApprovalModal] = useState<MRF|null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null)
  const [skills, setSkills] = useState<string[]>([])

  useEffect(()=>{
    supabase.from('skills').select('name').order('name').then(({data}:any)=>setSkills((data||[]).map((s:any)=>s.name)))
  },[supabase])

  // Insert a custom skill into the shared skills DB (ignore duplicates), keep local list fresh.
  async function addSkill(name:string) {
    const { error } = await supabase.from('skills').insert({ name })
    if (!error) setSkills(s=>[...s, name].sort((a,b)=>a.localeCompare(b)))
  }

  const filtLocs = form.company_id ? locations.filter((l:Location)=>l.company_id===form.company_id) : locations
  const filtDepts = form.company_id ? departments.filter((d:Department)=>d.company_id===form.company_id) : departments
  const F = (k:string,v:any) => setForm((f:any)=>({...f,[k]:v}))

  const isQuick = form.mrf_type === 'Quick Hire'

  function openEdit(m:MRF) {
    setEditMRF(m)
    setForm({ company_id:m.company_id||'', location_id:m.location_id||'', department_id:m.department_id||'',
      designation:m.designation||m.position||'', no_of_openings:m.no_of_openings||m.openings||1,
      employment_type:m.employment_type||'Employee', urgency:m.urgency||'MEDIUM',
      reason:m.reason||m.reason_for_hire||'', job_description:m.job_description||'',
      budget_min:m.budget_min||'', budget_max:m.budget_max||'', experience_required:m.experience_required||'',
      mrf_type:(m as any).mrf_type||'Full MRF', education_required:(m as any).education_required||'',
      skills_required:(m as any).skills_required||'', hiring_type:(m as any).hiring_type||'New Hire',
      previous_company_preference:(m as any).previous_company_preference||'',
      experience_min:(m as any).experience_min||'', experience_max:(m as any).experience_max||'',
      education_min:(m as any).education_min||'', education_max:(m as any).education_max||'',
    })
    setShowForm(true)
  }

  async function generateJD() {
    if (!form.designation) { showNotify('Please enter the designation first','error'); return }
    setAiLoading(true)
    const dept = departments.find((d:Department)=>d.id===form.department_id)
    try {
      const res = await fetch('/api/recruitment/generate-jd', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ designation:form.designation, department:dept?.dept_name||'', experience:[form.experience_min,form.experience_max].filter(Boolean).join('-')+(form.experience_min||form.experience_max?' years':''), employee_type:form.employment_type, education:[form.education_min,form.education_max].filter(Boolean).join(' to '), skills:form.skills_required })
      })
      const { jd } = await res.json()
      if (jd) F('job_description', jd)
      showNotify('JD generated!')
    } catch { showNotify('Could not generate JD','error') }
    setAiLoading(false)
  }

  async function saveMRF(status:string) {
    if (!form.company_id||!form.designation) { showNotify('Company and Designation are required','error'); return }
    setSaving(true)
    // Derive the legacy single fields (used by screening + JD-gen) from min/max.
    const expReq = (form.experience_min||form.experience_max)
      ? `${form.experience_min||'0'}-${form.experience_max||'0'} years` : (form.experience_required||null)
    const eduReq = form.education_max || form.education_min || form.education_required || null
    const payload:any = {
      company_id:form.company_id, location_id:form.location_id||null,
      department_id:form.department_id||null,
      designation:form.designation, position:form.designation,
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
    }
    let error:any
    if (editMRF) {
      const r = await supabase.from('manpower_requisitions').update(payload).eq('id',editMRF.id)
      error = r.error
    } else {
      const r = await supabase.from('manpower_requisitions').insert(payload)
      error = r.error
    }
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message,'error'); return }
    showNotify(editMRF?'MRF updated!':status==='DRAFT'?'Draft saved!':'MRF submitted for approval!')
    setShowForm(false); setEditMRF(null); setForm(EMPTY); onRefresh()
  }

  async function approveMRF(id:string, recruiter:string) {
    const { error } = await supabase.from('manpower_requisitions')
      .update({ status:'APPROVED', assigned_recruiter:recruiter, approved_at:new Date().toISOString() }).eq('id',id)
    if (error) { showNotify('Error','error'); return }
    showNotify('MRF Approved! Recruiter assigned.'); setApprovalModal(null); onRefresh()
  }

  async function rejectMRF(id:string, remarks:string) {
    const { error } = await supabase.from('manpower_requisitions').update({ status:'REJECTED', remarks }).eq('id',id)
    if (error) { showNotify('Error','error'); return }
    showNotify('MRF Rejected'); setApprovalModal(null); onRefresh()
  }

  async function deleteMRF(id:string) {
    // Detach rows whose FK to the MRF is RESTRICT (would otherwise block delete).
    // candidates.mrf_id is ON DELETE SET NULL, so it needs no handling here.
    await supabase.from('offer_approval_requests').update({ mrf_id:null }).eq('mrf_id', id)
    await supabase.from('recruitment_audit_logs').update({ mrf_id:null }).eq('mrf_id', id)
    await supabase.from('document_collection_links').update({ mrf_id:null }).eq('mrf_id', id)
    const { error } = await supabase.from('manpower_requisitions').delete().eq('id',id)
    if (error) { showNotify('Delete failed: '+error.message,'error'); return }
    showNotify('MRF deleted'); setDeleteConfirm(null); onRefresh()
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontSize:15, fontWeight:600, color:'#1E1B4B' }}>Manpower Requisitions ({mrfs.length})</div>
        <button onClick={()=>{setEditMRF(null);setForm(EMPTY);setShowForm(!showForm)}} style={T.btnPrimary}>
          {showForm?'✕ Cancel':'+ New MRF'}
        </button>
      </div>

      {showForm && (
        <div style={T.cardPurple}>
          {/* MRF Type Selector */}
          <div style={{ display:'flex', gap:10, marginBottom:16 }}>
            {['Quick Hire','Full MRF'].map(type=>(
              <button key={type} onClick={()=>F('mrf_type',type)} style={{ ...T.btn, flex:1, padding:'10px',
                background:form.mrf_type===type?'#7C3AED':'#F3F0FF', color:form.mrf_type===type?'#fff':'#6D28D9',
                border:form.mrf_type===type?'none':'1px solid #DDD6FE', fontSize:13 }}>
                {type==='Quick Hire'?'⚡ Quick Hire (< ₹6L)':'📋 Full MRF (≥ ₹6L)'}
              </button>
            ))}
          </div>

          <SectionLine title="Basic Details" />
          <div style={{ ...T.g3, marginBottom:10 }}>
            <div><label style={T.label}>Company *</label>
              <select style={T.select} value={form.company_id} onChange={e=>F('company_id',e.target.value)}>
                <option value="">Select Company</option>
                {companies.map((c:Company)=><option key={c.id} value={c.id}>{c.company_name||c.company_code}</option>)}
              </select>
            </div>
            <div><label style={T.label}>Branch / Location</label>
              <select style={T.select} value={form.location_id} onChange={e=>F('location_id',e.target.value)}>
                <option value="">Select Location</option>
                {filtLocs.map((l:Location)=><option key={l.id} value={l.id}>{l.location_name||l.location_code}</option>)}
              </select>
            </div>
            <div><label style={T.label}>Department</label>
              <select style={T.select} value={form.department_id} onChange={e=>F('department_id',e.target.value)}>
                <option value="">Select Department</option>
                {filtDepts.map((d:Department)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <div><label style={T.label}>Designation *</label>
              <input style={T.input} value={form.designation} onChange={e=>F('designation',e.target.value)} placeholder="e.g. Senior Engineer" />
            </div>
            <div><label style={T.label}>No. of Openings</label>
              <input style={T.input} type="number" min={1} value={form.no_of_openings} onChange={e=>F('no_of_openings',e.target.value)} />
            </div>
            <div><label style={T.label}>Employment Type</label>
              <select style={T.select} value={form.employment_type} onChange={e=>F('employment_type',e.target.value)}>
                {EMP_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ ...T.g3, marginBottom:10 }}>
            <div><label style={T.label}>Hiring Type</label>
              <select style={T.select} value={form.hiring_type} onChange={e=>F('hiring_type',e.target.value)}>
                <option value="New Hire">New Hire</option>
                <option value="Replacement">Replacement</option>
                <option value="Backfill">Backfill</option>
              </select>
            </div>
            <div><label style={T.label}>Budget Min (₹)</label>
              <input style={T.input} type="number" value={form.budget_min} onChange={e=>F('budget_min',e.target.value)} placeholder="600000" />
            </div>
            <div><label style={T.label}>Budget Max (₹)</label>
              <input style={T.input} type="number" value={form.budget_max} onChange={e=>F('budget_max',e.target.value)} placeholder="1200000" />
            </div>
          </div>

          {!isQuick && (
            <>
              <SectionLine title="Requirements" />
              <div style={{ ...T.g2, marginBottom:10 }}>
                <div><label style={T.label}>Experience — Min (years)</label>
                  <input style={T.input} type="number" min="0" value={form.experience_min} onChange={e=>F('experience_min',e.target.value)} placeholder="e.g. 3" />
                </div>
                <div><label style={T.label}>Experience — Max (years)</label>
                  <input style={T.input} type="number" min="0" value={form.experience_max} onChange={e=>F('experience_max',e.target.value)} placeholder="e.g. 5" />
                </div>
              </div>
              <div style={{ ...T.g3, marginBottom:10 }}>
                <div><label style={T.label}>Education — Minimum</label>
                  <select style={T.select} value={form.education_min} onChange={e=>F('education_min',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </div>
                <div><label style={T.label}>Education — Maximum</label>
                  <select style={T.select} value={form.education_max} onChange={e=>F('education_max',e.target.value)}>
                    <option value="">Any</option>
                    {EDUCATION_OPTIONS.map(e=><option key={e}>{e}</option>)}
                  </select>
                </div>
                <div><label style={T.label}>Previous Company Preference</label>
                  <select style={T.select} value={form.previous_company_preference} onChange={e=>F('previous_company_preference',e.target.value)}>
                    <option value="">Select Preference</option>
                    <option value="MNC">MNC</option>
                    <option value="STARTUP">Startup</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={T.label}>Key Skills Required</label>
                <SkillsMultiSelect value={form.skills_required} onChange={(v:string)=>F('skills_required',v)} allSkills={skills} onAddSkill={addSkill} />
              </div>
            </>
          )}

          <div style={{ ...T.g2, marginBottom:10 }}>
            <div><label style={T.label}>Urgency</label>
              <select style={T.select} value={form.urgency} onChange={e=>F('urgency',e.target.value)}>
                <option value="HIGH">🔴 High</option>
                <option value="MEDIUM">🟡 Medium</option>
                <option value="LOW">🟢 Low</option>
              </select>
            </div>
            <div><label style={T.label}>Reason for Hire</label>
              <select style={T.select} value={form.reason} onChange={e=>F('reason',e.target.value)}>
                <option value="">Select Reason</option>
                <option value="Expansion">Expansion</option>
                <option value="Attrition">Attrition</option>
                <option value="New role">New role</option>
              </select>
            </div>
          </div>

          {!isQuick && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                <label style={{ ...T.label, marginBottom:0 }}>Job Description</label>
                <button onClick={generateJD} disabled={aiLoading} style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', border:'1px solid #DDD6FE', fontSize:11 }}>
                  {aiLoading?'⏳ Generating...':'🤖 Generate JD with AI'}
                </button>
              </div>
              <textarea style={{ ...T.textarea, minHeight:150 }} value={form.job_description}
                onChange={e=>F('job_description',e.target.value)}
                placeholder="Write a job description or generate it with the AI button..." />
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>saveMRF('DRAFT')} disabled={saving} style={T.btnOutline}>💾 Save Draft</button>
            <button onClick={()=>saveMRF('SUBMITTED')} disabled={saving} style={T.btnPrimary}>📤 Submit for Approval</button>
          </div>
        </div>
      )}

      <SearchBar placeholder="Search MRF by job role…" onApply={setMrfQ} />
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
        {(fCompany||fDept||fLoc||fPos)&&<button onClick={()=>{setFCompany('');setFDept('');setFLoc('');setFPos('')}} style={T.btnOutline}>Clear filters</button>}
      </div>
      {mrfs.filter((m:MRF)=>
        (!mrfQ || (m.designation||(m as any).position||'').toLowerCase().includes(mrfQ.toLowerCase())) &&
        (!fCompany || m.company_id===fCompany) &&
        (!fDept || m.department_id===fDept) &&
        (!fLoc || m.location_id===fLoc) &&
        (!fPos || (m.designation||m.position)===fPos)
      ).map((m:MRF)=>{
        const cands = candidates.filter((c:Candidate)=>c.mrf_id===m.id)
        return (
          <div key={m.id} style={T.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:5, flexWrap:'wrap' as const }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'#1E1B4B' }}>{m.designation||m.position||'Untitled'}</span>
                  <Badge text={m.status} />
                  {m.urgency&&<span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, background:m.urgency==='HIGH'?'#FEF2F2':m.urgency==='MEDIUM'?'#FFFBEB':'#ECFDF5', color:m.urgency==='HIGH'?'#DC2626':m.urgency==='MEDIUM'?'#D97706':'#059669', fontWeight:500 }}>{m.urgency}</span>}
                </div>
                <div style={{ fontSize:12, color:'#9CA3AF', display:'flex', gap:14, flexWrap:'wrap' as const }}>
                  <span>👥 {m.no_of_openings||m.openings||0} openings</span>
                  <span>💼 {m.employment_type||'—'}</span>
                  {m.experience_required&&<span>⏱ {m.experience_required}</span>}
                  {m.budget_max&&<span>💰 ₹{(m.budget_max/100000).toFixed(1)}L max</span>}
                  <span style={{ color:'#7C3AED' }}>🧑 {cands.length} candidates</span>
                  {m.assigned_recruiter&&<span>👤 {m.assigned_recruiter}</span>}
                </div>
                {(m as any).skills_required&&<div style={{ fontSize:11, color:'#6D28D9', marginTop:4 }}>Skills: {(m as any).skills_required}</div>}
              </div>
              <div style={{ display:'flex', gap:6, marginLeft:10, flexShrink:0, alignItems:'center' }}>
                {m.status==='SUBMITTED'&&(
                  <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' as const }}>Awaiting HR Head approval</span>
                )}
                <button onClick={()=>openEdit(m)} style={{ ...T.btn, background:'#EFF6FF', color:'#1D4ED8', border:'1px solid #BFDBFE', fontSize:11 }}>✏️ Edit</button>
                <button onClick={()=>setDeleteConfirm(m.id)} style={{ ...T.btn, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FCA5A5', fontSize:11 }}>🗑️</button>
              </div>
            </div>
          </div>
        )
      })}

      {approvalModal&&<ApprovalModal mrf={approvalModal} onApprove={approveMRF} onReject={rejectMRF} onClose={()=>setApprovalModal(null)} />}
      {deleteConfirm&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, width:340, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:15, fontWeight:600, color:'#1E1B4B', marginBottom:8 }}>Delete MRF?</div>
            <div style={{ fontSize:13, color:'#9CA3AF', marginBottom:20 }}>This action cannot be undone.</div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>deleteMRF(deleteConfirm)} style={{ ...T.btn, background:'#DC2626', color:'#fff', flex:1 }}>Delete</button>
              <button onClick={()=>setDeleteConfirm(null)} style={{ ...T.btnOutline, flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalModal({ mrf, onApprove, onReject, onClose }:any) {
  const [mode, setMode] = useState<'approve'|'reject'>('approve')
  const [recruiter, setRecruiter] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:12, padding:24, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize:15, fontWeight:600, color:'#1E1B4B', marginBottom:4 }}>{mrf.designation||mrf.position}</div>
        <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:16 }}>{mrf.no_of_openings||mrf.openings||0} openings · {mrf.employment_type}</div>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button onClick={()=>setMode('approve')} style={{ ...T.btn, flex:1, background:mode==='approve'?'#ECFDF5':'#F9FAFB', color:mode==='approve'?'#059669':'#9CA3AF', border:mode==='approve'?'1px solid #A7F3D0':'1px solid #E5E7EB' }}>✅ Approve</button>
          <button onClick={()=>setMode('reject')} style={{ ...T.btn, flex:1, background:mode==='reject'?'#FEF2F2':'#F9FAFB', color:mode==='reject'?'#DC2626':'#9CA3AF', border:mode==='reject'?'1px solid #FCA5A5':'1px solid #E5E7EB' }}>❌ Reject</button>
        </div>
        {mode==='approve'?(
          <>
            <label style={T.label}>Assign Recruiter Email</label>
            <input style={{ ...T.input, marginBottom:16 }} value={recruiter} onChange={e=>setRecruiter(e.target.value)} placeholder="recruiter@company.com" />
            <button onClick={()=>onApprove(mrf.id,recruiter)} style={{ ...T.btnPrimary, width:'100%' }}>Approve & Assign</button>
          </>
        ):(
          <>
            <label style={T.label}>Rejection Reason *</label>
            <textarea style={{ ...T.textarea, marginBottom:16 }} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Enter a reason..." rows={3} />
            <button onClick={()=>reason&&onReject(mrf.id,reason)} style={{ ...T.btn, background:'#DC2626', color:'#fff', width:'100%' }}>Reject MRF</button>
          </>
        )}
        <button onClick={onClose} style={{ ...T.btn, background:'transparent', color:'#9CA3AF', width:'100%', marginTop:8 }}>Cancel</button>
      </div>
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
        <div style={T.section}>🤖 AI Resume Screening — Bulk Upload</div>
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
            {screening?`⏳ ${progress}% (${results.length}/${files.length})` :'🚀 Start AI Screening'}
          </button>
          {results.length>0&&<button onClick={downloadExcel} style={{ ...T.btn, background:'#059669', color:'#fff' }}>📥 Excel Download</button>}
          {strong.filter(r=>!r.added).length>0&&(
            <button onClick={addAllStrong} style={{ ...T.btn, background:'#ECFDF5', color:'#059669', border:'1px solid #A7F3D0' }}>
              ✅ Add All Strong ({strong.filter(r=>!r.added).length})
            </button>
          )}
        </div>
        {screening&&(
          <div style={{ marginTop:10, background:'#EDE9FE', borderRadius:99, height:6, overflow:'hidden' }}>
            <div style={{ background:'#7C3AED', height:'100%', width:`${progress}%`, transition:'width .3s', borderRadius:99 }} />
          </div>
        )}
      </div>

      {results.length>0&&(
        <>
          <div style={{ display:'flex', gap:16, fontSize:13, marginBottom:10 }}>
            <span style={{ color:'#059669', fontWeight:500 }}>🟢 Strong: {strong.length}</span>
            <span style={{ color:'#D97706', fontWeight:500 }}>🟡 Partial: {partial.length}</span>
            <span style={{ color:'#DC2626', fontWeight:500 }}>🔴 Not Suitable: {notSuitable.length}</span>
            <span style={{ color:'#9CA3AF' }}>Total: {results.length}</span>
          </div>
          {[...strong,...partial,...notSuitable].map((r,i)=>(
            <div key={i} style={{ ...T.card, display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ width:46, height:46, borderRadius:99, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700,
                background:r.match_tag==='STRONG'?'#ECFDF5':r.match_tag==='PARTIAL'?'#FFFBEB':'#FEF2F2',
                color:r.match_tag==='STRONG'?'#059669':r.match_tag==='PARTIAL'?'#D97706':'#DC2626' }}>
                {r.score}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4, flexWrap:'wrap' as const }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{r.candidate_name}</span>
                  <Badge text={r.match_tag} />
                  {r.added&&<span style={{ fontSize:10, color:'#059669', fontWeight:500 }}>✓ Added to pipeline</span>}
                </div>
                <div style={{ fontSize:11, color:'#6B7280', marginBottom:6 }}>{r.reasoning}</div>
                {typeof r.ats_score==='number'&&(
                  <div style={{ fontSize:11, color:'#6D28D9', marginBottom:4 }}>ATS skills match: <b>{r.ats_score}%</b> · Overall: <b>{r.score}</b></div>
                )}
                {(r.matched_skills?.length||r.missing_skills?.length)?(
                  <div style={{ display:'flex', flexWrap:'wrap' as const, gap:4, marginBottom:6 }}>
                    {(r.matched_skills||[]).map((s:string,si:number)=>(
                      <span key={'m'+si} style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#ECFDF5', color:'#059669', fontWeight:500 }}>✓ {s}</span>
                    ))}
                    {(r.missing_skills||[]).map((s:string,si:number)=>(
                      <span key={'x'+si} style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#FEF2F2', color:'#DC2626', fontWeight:500 }}>✕ {s}</span>
                    ))}
                  </div>
                ):null}
                {(r.experience_match||r.education_match)&&(
                  <div style={{ fontSize:11, color:'#6B7280', marginBottom:6 }}>
                    {r.experience_match&&<span>⏱ {r.experience_match}</span>}
                    {r.experience_match&&r.education_match&&<span> · </span>}
                    {r.education_match&&<span>🎓 {r.education_match}</span>}
                  </div>
                )}
                {r.interview_questions?.length>0&&(
                  <details style={{ cursor:'pointer' }}>
                    <summary style={{ fontSize:11, color:'#6D28D9', fontWeight:500 }}>View {r.interview_questions.length} Interview Questions</summary>
                    {r.interview_questions.map((q:string,qi:number)=>(
                      <div key={qi} style={{ fontSize:11, padding:'3px 0 3px 12px', color:'#6B7280' }}>{qi+1}. {q}</div>
                    ))}
                  </details>
                )}
              </div>
              {!r.added&&(
                <button onClick={()=>addToBank(results.indexOf(r))} style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', border:'1px solid #DDD6FE', flexShrink:0, fontSize:11 }}>+ Pipeline</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── PIPELINE ──────────────────────────────────────────────────────
function PipelineTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  const [interviewCand, setInterviewCand] = useState<Candidate|null>(null)
  const [selMRF, setSelMRF] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selCand, setSelCand] = useState<Candidate|null>(null)
  const [aiQs, setAiQs] = useState<string[]>([])
  const [aiQLoading, setAiQLoading] = useState(false)
  const [aiFbLoading, setAiFbLoading] = useState(false)
  const EMPTY_C = { mrf_id:'', full_name:'', phone:'', email:'', hr_email:'', current_company:'', designation:'', experience_years:'', current_ctc:'', expected_ctc:'', notice_period:'', source:'Direct' }
  const [cForm, setCForm] = useState<any>(EMPTY_C)
  const [myEmail, setMyEmail] = useState('')
  useEffect(()=>{ supabase.auth.getUser().then(({data}:any)=>{ const em=data?.user?.email; if(em){ setMyEmail(em); setCForm((f:any)=>({...f, hr_email:f.hr_email||em})) } }) },[])
  const cMrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
  const expCtcOver = !!(cMrf?.budget_max && cForm.expected_ctc!=='' && Number(cForm.expected_ctc) > Number(cMrf.budget_max))
  const CF = (k:string,v:any) => setCForm((f:any)=>({...f,[k]:v}))
  const approvedMRFs = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const [pipeQ, setPipeQ] = useState('')
  const filtered = (selMRF==='all'?candidates:candidates.filter((c:Candidate)=>c.mrf_id===selMRF))
    .filter((c:Candidate)=>!pipeQ || c.full_name.toLowerCase().includes(pipeQ.toLowerCase()))

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

      {approvedMRFs.length===0&&(
        <div style={{ ...T.card, textAlign:'center' as const, color:'#9CA3AF', padding:32 }}>
          No approved MRF yet. Approve one in the MRF tab first.
        </div>
      )}

      {/* Kanban */}
      <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:10 }}>
        {STAGES.map(stage=>{
          const sc = filtered.filter((c:Candidate)=>c.stage===stage)
          return (
            <div key={stage} style={{ minWidth:168, flexShrink:0 }}>
              <div style={{ background:STAGE_COLOR[stage]+'15', borderRadius:'7px 7px 0 0', padding:'7px 10px', borderTop:`3px solid ${STAGE_COLOR[stage]}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:11, fontWeight:600, color:STAGE_COLOR[stage] }}>{stage}</span>
                <span style={{ fontSize:10, background:STAGE_COLOR[stage]+'20', color:STAGE_COLOR[stage], borderRadius:99, padding:'1px 7px', fontWeight:600 }}>{sc.length}</span>
              </div>
              <div style={{ background:'rgba(0,0,0,0.02)', borderRadius:'0 0 7px 7px', minHeight:180, padding:6 }}>
                {sc.map((c:Candidate)=>(
                  <div key={c.id} onClick={()=>{setSelCand(c);setAiQs([])}}
                    style={{ background:'#fff', borderRadius:7, padding:'9px 10px', marginBottom:6, cursor:'pointer', border:'1px solid #EDE9FE', boxShadow:'0 1px 3px rgba(124,58,237,0.06)' }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#1E1B4B', marginBottom:2 }}>{c.full_name}{c.offer_revised&&<span style={{ fontSize:9, color:'#B45309', fontWeight:600, marginLeft:5 }}>✏️ Revised</span>}</div>
                    <div style={{ fontSize:10, color:'#9CA3AF' }}>{c.current_company||'—'} · {c.experience_years||0}yr</div>
                    {c.expected_ctc&&<div style={{ fontSize:10, color:'#7C3AED', marginTop:2, fontWeight:500 }}>₹{(c.expected_ctc/100000).toFixed(1)}L</div>}
                    {c.ai_score&&(
                      <div style={{ fontSize:10, color:(c.ai_tag||c.ai_match_tag)==='STRONG'?'#059669':(c.ai_tag||c.ai_match_tag)==='PARTIAL'?'#D97706':'#DC2626', marginTop:2, fontWeight:500 }}>
                        AI: {c.ai_score}% {(c.ai_tag||c.ai_match_tag)==='STRONG'?'🟢':(c.ai_tag||c.ai_match_tag)==='PARTIAL'?'🟡':'🔴'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Candidate Modal */}
      {showAdd&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', overflowY:'auto' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, width:520, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', margin:'20px auto' }}>
            <div style={{ fontSize:15, fontWeight:600, color:'#1E1B4B', marginBottom:16 }}>Add Candidate</div>
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
            </div>
            <div style={{ ...T.g2, marginBottom:10 }}>
              <div><label style={T.label}>Current Company</label><input style={T.input} value={cForm.current_company} onChange={e=>CF('current_company',e.target.value)} /></div>
              <div><label style={T.label}>Experience (Yrs)</label><input style={T.input} type="number" value={cForm.experience_years} onChange={e=>CF('experience_years',e.target.value)} /></div>
            </div>
            <div style={{ ...T.g3, marginBottom:16 }}>
              <div><label style={T.label}>Current CTC (₹)</label><input style={T.input} type="number" value={cForm.current_ctc} onChange={e=>CF('current_ctc',e.target.value)} /></div>
              <div>
                <label style={T.label}>Expected CTC (₹)</label>
                <input style={{ ...T.input, ...(expCtcOver?{ borderColor:'#FCA5A5', background:'#FEF2F2' }:{}) }} type="number" value={cForm.expected_ctc} onChange={e=>CF('expected_ctc',e.target.value)} />
                {expCtcOver && <div style={{ fontSize:10, color:'#DC2626', marginTop:3, fontWeight:600 }}>⚠ Exceeds MRF max budget (₹{(Number(cMrf.budget_max)/100000).toFixed(1)}L) — you can still save.</div>}
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
        <div style={{ position:'fixed', inset:0, background:'#F5F3FF', zIndex:300, overflowY:'auto', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ background:'linear-gradient(135deg,#7C3AED,#4F46E5)', padding:'12px 20px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:10 }}>
            <button onClick={()=>setInterviewCand(null)} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(255,255,255,.3)', background:'transparent', color:'#fff', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:500 }}>← Back to Pipeline</button>
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
          <div style={{ fontSize:16, fontWeight:700, color:'#1E1B4B' }}>{c.full_name}</div>
          <div style={{ fontSize:12, color:'#9CA3AF', marginTop:2 }}>{c.current_company} · {c.experience_years}yr · {c.phone||c.mobile}</div>
          {mrf&&<div style={{ fontSize:11, color:'#7C3AED', marginTop:2, fontWeight:500 }}>MRF: {mrf.designation||mrf.position}</div>}
        </div>
        <button onClick={onClose} style={{ ...T.btn, background:'#F3F0FF', color:'#6D28D9', padding:'4px 10px' }}>✕</button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
        {[['Current CTC',c.current_ctc?`₹${(c.current_ctc/100000).toFixed(1)}L`:'—','#7C3AED'],['Expected CTC',c.expected_ctc?`₹${(c.expected_ctc/100000).toFixed(1)}L`:'—','#059669'],['Notice Period',c.notice_period?c.notice_period+' days':'—','#D97706'],['AI Score',c.ai_score?c.ai_score+'%':'—',(c.ai_tag||c.ai_match_tag)==='STRONG'?'#059669':'#D97706']].map(([l,v,col])=>(
          <div key={l as string} style={{ background:'#F9FAFB', borderRadius:7, padding:10, border:'1px solid #F3F0FF' }}>
            <div style={{ fontSize:10, color:'#9CA3AF', textTransform:'uppercase' as const, letterSpacing:'.04em' }}>{l}</div>
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
        style={{ ...T.btnPrimary, width:'100%', marginBottom:14, padding:10, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        📋 Manage Interview Rounds →
      </button>

      {/* AI Questions */}
      <SectionLine title="Interview Questions" />
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:7 }}>
        <button onClick={()=>onGetQuestions(c)} disabled={aiQLoading} style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', border:'1px solid #DDD6FE', fontSize:11 }}>
          {aiQLoading?'⏳...':'🤖 AI Questions Generate'}
        </button>
      </div>
      {(aiQs.length?aiQs:(c.ai_questions||[])).map((q:string,i:number)=>(
        <div key={i} style={{ background:'#F9FAFB', borderRadius:6, padding:'7px 10px', marginBottom:5, fontSize:11, color:'#1E1B4B', border:'1px solid #EDE9FE' }}>
          <span style={{ color:'#7C3AED', marginRight:5, fontWeight:600 }}>{i+1}.</span>{q}
        </div>
      ))}

      {/* Interview Notes & Feedback */}
      <SectionLine title="Interview Notes & Feedback" />
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:6 }}>
        <button onClick={()=>onGetFeedback(c,notes)} disabled={aiFbLoading} style={{ ...T.btn, background:'#ECFDF5', color:'#059669', border:'1px solid #A7F3D0', fontSize:11 }}>
          {aiFbLoading?'⏳...':'🤖 AI Feedback Generate'}
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
        <div style={{ fontSize:13, fontWeight:600, color:'#6D28D9', marginBottom:4 }}>💰 Stipend Calculator — {sel.full_name}</div>
        <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:14 }}>{mrf?.employment_type||'Non-employee'} engagement · stipend only (no PF/HRA structure)</div>
        {!autoCompany && (
          <div style={{ marginBottom:12, padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8 }}>
            <label style={T.label}>Company * <span style={{ color:'#92400E', fontWeight:400 }}>— not set on this candidate, please choose</span></label>
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
          <div style={{ marginTop:8, background:'#F8F7FF', border:'1px solid #E9E5FF', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13 }}><span style={{ color:'#4B5563' }}>Monthly Stipend</span><span style={{ fontWeight:600 }}>₹{s.toLocaleString('en-IN')}</span></div>
            {tds&&<div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:13, color:'#DC2626' }}><span>(-) TDS ({pct}%)</span><span>-₹{tdsAmt.toLocaleString('en-IN')}</span></div>}
            <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0 0', fontSize:14, fontWeight:700, color:'#059669', borderTop:'1px solid #EDE9FE', marginTop:4 }}><span>Net In-Hand (monthly)</span><span>₹{net.toLocaleString('en-IN')}</span></div>
            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0 0', fontSize:12, color:'#7C3AED' }}><span>Annual Stipend</span><span>₹{(s*12).toLocaleString('en-IN')}</span></div>
          </div>
        )}
        <button onClick={save} disabled={saving} style={{ ...T.btnPrimary, width:'100%', marginTop:12, padding:10 }}>{saving?'Saving…':'💾 Save Stipend & Move to Offers'}</button>
        {savedLink&&(
          <div style={{ marginTop:12, background:'#F0F9FF', border:'1px solid #BAE6FD', borderRadius:8, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#0369A1', marginBottom:6 }}>🔗 CANDIDATE SALARY LINK</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input readOnly value={savedLink} onFocus={e=>e.target.select()} style={{ ...T.input, fontSize:11, fontFamily:'monospace' }} />
              <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btn, background:'#0EA5E9', color:'#fff', whiteSpace:'nowrap' as const }}>📋 Copy</button>
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
    <div style={{ border:`2px dashed ${val?'#A7F3D0':'#DDD6FE'}`, borderRadius:10, padding:'14px 16px', background:val?'#F0FDF4':'#FAFAF8', marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>{val?'✅':'📤'} {label} <span style={{ color:'#DC2626', fontSize:11 }}>*</span></div>
          {val && <div style={{ fontSize:11, color:'#059669', marginTop:3 }}>Uploaded</div>}
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
      <div style={{ fontSize:13, fontWeight:600, color:'#6D28D9', marginBottom:6 }}>📋 Pre-negotiation Checks — {candidate.full_name}</div>
      <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:14 }}>Upload the candidate's documents, then save to begin CTC negotiation.</div>
      {box('AADHAAR','Aadhaar Card', aadhaar, aadhaarRef)}
      {box('PREV_OFFER','Previous Offer Letter', prevOffer, prevRef)}
      <button onClick={save} disabled={saving||!aadhaar||!prevOffer} style={{ ...T.btnPrimary, width:'100%', padding:11, marginTop:6, opacity:(saving||!aadhaar||!prevOffer)?.6:1 }}>
        {saving?'Saving…':'Save & Move to CTC Negotiations →'}
      </button>
    </div>
  )
}

function NegotiationTab({ supabase, companies, mrfs, candidates, onRefresh, showNotify }:any) {
  // Offer Sent is intentionally excluded — once an offer goes out there's no more negotiation.
  // A revised offer moves the candidate back to 'Shortlisted', so they reappear here with the calculator.
  const finalCands = candidates.filter((c:Candidate)=>['Shortlisted'].includes(c.stage))
  const [subTab, setSubTab] = useState<'checks'|'ctc'>('checks')
  const [negQ, setNegQ] = useState('')
  const checksCands = finalCands.filter((c:Candidate)=>!c.pre_negotiation_done)
  const ctcCands = finalCands.filter((c:Candidate)=>c.pre_negotiation_done)
  const activeList = subTab==='checks' ? checksCands : ctcCands
  const shownCands = activeList.filter((c:Candidate)=>!negQ || c.full_name.toLowerCase().includes(negQ.toLowerCase()))
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
          <button onClick={()=>{ setSubTab('checks'); setSel(null) }} style={{ ...T.btnOutline, ...(subTab==='checks'?{ background:'#7C3AED', color:'#fff', borderColor:'#7C3AED' }:{}) }}>📋 Pre-negotiation Checks ({checksCands.length})</button>
          <button onClick={()=>{ setSubTab('ctc'); setSel(null) }} style={{ ...T.btnOutline, ...(subTab==='ctc'?{ background:'#7C3AED', color:'#fff', borderColor:'#7C3AED' }:{}) }}>💰 CTC Negotiations ({ctcCands.length})</button>
        </div>
        <SearchBar placeholder="Search candidate…" onApply={setNegQ} width={240} />
        {shownCands.map((c:Candidate)=>(
          <div key={c.id} onClick={()=>{ if(subTab==='ctc'){ selectCtcCandidate(c) } else { setSel(c) } }}
            style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?'#F3F0FF':'#fff' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L exp':'—'}</div>
              </div>
              {subTab==='ctc' && (
                <button onClick={(e)=>rejectCand(c,e)} style={{ padding:'4px 10px', borderRadius:7, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit', background:'#FEF2F2', color:'#DC2626', flexShrink:0 }}>Reject</button>
              )}
            </div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' as const }}>
              <Badge text={c.stage} />
              {subTab==='ctc' && respMap[c.id]==='ACCEPTED' && <Badge text="✅ Offer Accepted" />}
              {subTab==='ctc' && respMap[c.id]==='REJECTED' && <Badge text="❌ Offer Rejected" />}
              {c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}
            </div>
          </div>
        ))}
        {shownCands.length===0&&<div style={{ ...T.card, color:'#9CA3AF', fontSize:13, textAlign:'center' as const, padding:24 }}>{negQ?'No matching candidate':(subTab==='checks'?'No candidates awaiting pre-negotiation checks':'No candidates ready for CTC negotiation')}</div>}
      </div>

      {subTab==='checks'&&sel&&(
        <PreNegoChecks candidate={sel} supabase={supabase} showNotify={showNotify}
          onDone={()=>{ setSel(null); setSubTab('ctc'); onRefresh() }} />
      )}

      {subTab==='ctc'&&sel&&isStipend&&<StipendCalc sel={sel} mrf={selMrf} companies={companies} supabase={supabase} showNotify={showNotify} onRefresh={onRefresh} />}

      {subTab==='ctc'&&sel&&!isStipend&&(
        <div>
          <div style={T.cardPurple}>
            <div style={{ fontSize:13, fontWeight:600, color:'#6D28D9', marginBottom:14 }}>💰 CTC Calculator — {sel.full_name}</div>
            {loadedNeg?.candidate_response && (
              <div style={{ marginBottom:12, padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:600,
                background: loadedNeg.candidate_response==='ACCEPTED'?'#ECFDF5':'#FEF2F2',
                color: loadedNeg.candidate_response==='ACCEPTED'?'#059669':'#DC2626',
                border:`1px solid ${loadedNeg.candidate_response==='ACCEPTED'?'#A7F3D0':'#FCA5A5'}` }}>
                {loadedNeg.candidate_response==='ACCEPTED'?'✅ Candidate ACCEPTED this offer':'❌ Candidate REJECTED this offer'}
                {loadedNeg.response_note?` — “${loadedNeg.response_note}”`:''}
              </div>
            )}
            {!autoCompany && (
              <div style={{ marginBottom:12, padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8 }}>
                <label style={T.label}>Company * <span style={{ color:'#92400E', fontWeight:400 }}>— not set on this candidate, please choose</span></label>
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
                <button onClick={downloadExcel} style={{ ...T.btn, background:'#059669', color:'#fff', fontSize:11 }}>📥 Download Excel</button>
              </div>

              {/* Salary Table */}
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#F3F0FF' }}>
                    <th style={{ padding:'7px 10px', textAlign:'left' as const, color:'#6D28D9', fontWeight:600, fontSize:11 }}>Component</th>
                    <th style={{ padding:'7px 10px', textAlign:'right' as const, color:'#6D28D9', fontWeight:600, fontSize:11 }}>Monthly (₹)</th>
                    <th style={{ padding:'7px 10px', textAlign:'right' as const, color:'#6D28D9', fontWeight:600, fontSize:11 }}>Annual (₹)</th>
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
                      <td style={{ padding:'6px 10px', color:'#374151' }}>{l}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, fontWeight:500 }}>₹{Math.round(v as number).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round((v as number)*12).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#EDE9FE' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:'#1E1B4B' }}>Gross</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:'#7C3AED' }}>₹{Math.round(calc.gross).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:'#7C3AED' }}>₹{Math.round(calc.gross*12).toLocaleString('en-IN')}</td>
                  </tr>
                  <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                    <td style={{ padding:'6px 10px', color:'#DC2626', fontSize:11 }}>(-) Employee EPF</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{Math.round(calc.epfEmployee).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{Math.round(calc.epfEmployee*12).toLocaleString('en-IN')}</td>
                  </tr>
                  {calc.esicEmployee>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:'#DC2626', fontSize:11 }}>(-) Employee ESIC</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{Math.round(calc.esicEmployee).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{Math.round(calc.esicEmployee*12).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  {calc.ptMonthly>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:'#DC2626', fontSize:11 }}>(-) PT ({form.state})</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{calc.ptMonthly}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#DC2626' }}>-₹{calc.ptMonthly*12}</td>
                    </tr>
                  )}
                  <tr style={{ background:'#ECFDF5', borderBottom:'2px solid #A7F3D0' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:'#059669', fontSize:13 }}>In Hand</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:'#059669', fontSize:14 }}>₹{Math.round(calc.inHand).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:'#059669' }}>₹{Math.round(calc.inHand*12).toLocaleString('en-IN')}</td>
                  </tr>
                  <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                    <td style={{ padding:'6px 10px', color:'#6B7280', fontSize:11 }}>Employer EPF</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round(calc.epfEmployer).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round(calc.epfEmployer*12).toLocaleString('en-IN')}</td>
                  </tr>
                  {calc.esicEmployer>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:'#6B7280', fontSize:11 }}>Employer ESIC</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round(calc.esicEmployer).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round(calc.esicEmployer*12).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  {calc.variable>0&&(
                    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
                      <td style={{ padding:'6px 10px', color:'#374151' }}>Variable Pay ({form.varPct}%) <span style={{ fontSize:10, color:'#9CA3AF' }}>performance-linked</span></td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, fontWeight:500 }}>₹{Math.round(calc.varMonthly).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' as const, color:'#6B7280' }}>₹{Math.round(calc.variable).toLocaleString('en-IN')}</td>
                    </tr>
                  )}
                  <tr style={{ background:'#EDE9FE' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:'#1E1B4B' }}>CTC <span style={{ fontSize:10, fontWeight:400, color:'#9CA3AF' }}>(Fixed Gross + Variable)</span></td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:600, color:'#7C3AED' }}>₹{Math.round(calc.totalCTCMonthly).toLocaleString('en-IN')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' as const, fontWeight:700, color:'#7C3AED', fontSize:14 }}>₹{calc.ctcAnnual.toLocaleString('en-IN')}</td>
                  </tr>
                </tbody>
              </table>

              {/* One-time Payments */}
              {(calc.joining_bonus>0||calc.retention_bonus>0||calc.esop>0)&&(
                <div style={{ marginTop:12 }}>
                  <div style={T.section}>One-time Payments</div>
                  {calc.joining_bonus>0&&(
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
                      <span>Joining Bonus <span style={{ fontSize:10, color:'#9CA3AF' }}>({form.joining_freq})</span></span>
                      <span style={{ fontWeight:600, color:'#059669' }}>₹{calc.joining_bonus.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.retention_bonus>0&&(
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
                      <span>Retention Bonus <span style={{ fontSize:10, color:'#9CA3AF' }}>({form.retention_freq})</span></span>
                      <span style={{ fontWeight:600, color:'#059669' }}>₹{calc.retention_bonus.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.esop>0&&(
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', fontSize:12 }}>
                      <span>ESOP Grant Value <span style={{ fontSize:10, color:'#9CA3AF' }}>{form.esop_plan&&`(${form.esop_plan})`}</span></span>
                      <span style={{ fontWeight:600, color:'#7C3AED' }}>₹{calc.esop.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </div>
              )}

              {calc.hike&&(
                <div style={{ marginTop:12, background:'#F0FDF4', borderRadius:8, padding:'10px 14px', display:'flex', gap:16 }}>
                  <span style={{ fontSize:13, color:'#059669', fontWeight:600 }}>Hike: {calc.hike}%</span>
                  <span style={{ fontSize:12, color:'#374151' }}>Current: ₹{((sel?.current_ctc||0)/100000).toFixed(1)}L → Offered: ₹{(calc.ctcAnnual/100000).toFixed(1)}L</span>
                </div>
              )}

              <button onClick={saveNegotiation} disabled={saving} style={{ ...T.btnPrimary, width:'100%', marginTop:12, padding:10 }}>
                {saving?'Saving...':'💾 Save Negotiation & Move to Offers'}
              </button>

              {savedLink&&(
                <div style={{ marginTop:12, background:'#F0F9FF', border:'1px solid #BAE6FD', borderRadius:8, padding:'12px 14px' }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#0369A1', marginBottom:6 }}>🔗 CANDIDATE SALARY LINK</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <input readOnly value={savedLink} onFocus={e=>e.target.select()} style={{ ...T.input, fontSize:11, fontFamily:'monospace' }} />
                    <button onClick={()=>{ navigator.clipboard?.writeText(savedLink); showNotify('Link copied!') }} style={{ ...T.btn, background:'#0EA5E9', color:'#fff', whiteSpace:'nowrap' as const }}>📋 Copy</button>
                    <a href={savedLink} target="_blank" rel="noopener noreferrer" style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', textDecoration:'none', whiteSpace:'nowrap' as const }}>Open ↗</a>
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
function OfferApprovalTab({ supabase, candidates, mrfs, onRefresh }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
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
  const shownEligible = eligible.filter((c:Candidate)=>!oaQ || c.full_name.toLowerCase().includes(oaQ.toLowerCase()))

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
        <button style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', marginBottom:12 }} onClick={()=>{setSel(null);setNeg(null)}}>← Back to candidates</button>
        {loading ? <div style={{ ...T.card, textAlign:'center' as const, color:'#7C3AED' }}>Loading negotiation…</div>
          : neg ? (
            <>
              <CreateOfferApproval candidate={sel} negotiation={neg} mrf={mrf} onSubmitted={()=>{ onRefresh?.(); setSel(null); setNeg(null) }} />
              <div style={{ maxWidth:700, margin:'16px auto 0' }}><AuditTrailViewer candidateId={sel.id} /></div>
            </>
          ) : (
            <div style={{ ...T.card, color:'#B45309', background:'#FFFBEB', border:'1px solid #FDE68A' }}>
              No CTC negotiation found for <b>{sel.full_name}</b>. Create one in the 💰 Negotiation tab first.
            </div>
          )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize:13, color:'#6B7280', marginBottom:12 }}>Select a candidate to create an offer approval request for HR Head review.</div>
      <SearchBar placeholder="Search candidate…" onApply={setOaQ} width={240} />
      {shownEligible.length===0 ? (
        <div style={{ ...T.card, textAlign:'center' as const, color:'#9CA3AF' }}>{oaQ?'No matching candidate':'No candidates have accepted their CTC offer yet. They appear here once a candidate Accepts the salary link.'}</div>
      ) : shownEligible.map((c:Candidate)=>{
        const ar = activeReq(c.id)
        return (
        <div key={c.id} style={{ ...T.card, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600, display:'flex', gap:6, alignItems:'center' }}>{c.full_name}{c.offer_revised&&<Badge text="Revised Offer" />}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.designation||'—'} · {c.stage}</div>
          </div>
          {ar ? (
            <div style={{ textAlign:'right' as const, flexShrink:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color: ar.status==='HR_HEAD_REJECTED' ? '#DC2626' : '#059669' }}>
                {ar.status==='SUBMITTED' ? '⏳ ' : ar.status==='OFFER_SENT' ? '📤 ' : '✅ '}{STATUS_LABEL[ar.status] || ar.status}
              </div>
              {ar.submitted_at && <div style={{ fontSize:10.5, color:'#9CA3AF', marginTop:2 }}>on {new Date(ar.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>}
            </div>
          ) : (
            <button style={{ ...T.btn, background:'#7C3AED', color:'#fff', flexShrink:0 }} onClick={()=>pick(c)}>Create Request →</button>
          )}
        </div>
      )})}
    </div>
  )
}

function OffersTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
  const [letter, setLetter] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [cc, setCc] = useState('')
  const [doj, setDoj] = useState('')
  const offeredCands = candidates.filter((c:Candidate)=>['Shortlisted','Offer Sent'].includes(c.stage))
  const [offQ, setOffQ] = useState('')
  const shownOffered = offeredCands.filter((c:Candidate)=>!offQ || c.full_name.toLowerCase().includes(offQ.toLowerCase()))

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
        <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B', marginBottom:10 }}>Shortlisted / Offer Stage ({shownOffered.length})</div>
        <SearchBar placeholder="Search candidate…" onApply={setOffQ} width={240} />
        {shownOffered.map((c:Candidate)=>(
          <div key={c.id} style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?'#F3F0FF':'#fff' }}
            onClick={()=>generateLetter(c)}>
            <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L':' — '}</div>
            <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' as const }}><Badge text={c.stage} />{c.offer_revised&&<Badge text="Revised Offer" />}{c.blacklisted&&<Badge text="Blacklisted" />}</div>
            {c.stage==='Offer Sent'&&!c.offer_accepted&&(
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button onClick={(e)=>{ e.stopPropagation(); markAccepted(c) }} style={{ ...T.btn, background:'#059669', color:'#fff', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>✅ Accepted</button>
                <button onClick={(e)=>{ e.stopPropagation(); markRevision(c) }} style={{ ...T.btn, background:'#FFFBEB', color:'#B45309', border:'1px solid #FDE68A', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>✏️ Revision</button>
                <button onClick={(e)=>{ e.stopPropagation(); markBackout(c) }} style={{ ...T.btn, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FCA5A5', fontSize:11, fontWeight:600, flex:1, padding:'7px 4px' }}>🚪 Backout</button>
              </div>
            )}
            {c.stage==='Offer Sent'&&c.offer_accepted&&(
              <div style={{ fontSize:10, color:'#059669', marginTop:6, fontWeight:600 }}>✓ Accepted — moved to Pre-onboarding</div>
            )}
          </div>
        ))}
        {offeredCands.length===0&&<div style={{ ...T.card, color:'#9CA3AF', textAlign:'center' as const, padding:24 }}>No candidates</div>}
      </div>
      {sel&&letter&&(
        <div>
          <div style={T.card}>
            <div style={T.section}>📄 Offer Letter</div>
            <div style={{ marginBottom:8 }}><label style={T.label}>To Email</label><input style={T.input} value={toEmail} onChange={e=>setToEmail(e.target.value)} /></div>
            <div style={{ marginBottom:8 }}><label style={T.label}>CC (comma separated)</label><input style={T.input} value={cc} onChange={e=>setCc(e.target.value)} placeholder="hr@co.com, md@co.com" /></div>
            <div style={{ marginBottom:10 }}><label style={T.label}>Date of Joining</label><input style={T.input} type="date" value={doj} onChange={e=>setDoj(e.target.value)} /></div>
            <textarea style={{ ...T.textarea, minHeight:300, fontFamily:'monospace', fontSize:11 }} value={letter} onChange={e=>setLetter(e.target.value)} />
            <button onClick={sendOffer} style={{ ...T.btnPrimary, width:'100%', marginTop:10, padding:10 }}>📤 Send Offer Letter</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PRE-ONBOARDING ────────────────────────────────────────────────
function PreOnboardTab({ supabase, candidates, companies, mrfs, onRefresh, showNotify }:any) {
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
  const shownOnboarding = onboardingCands.filter((c:Candidate)=>!poQ || c.full_name.toLowerCase().includes(poQ.toLowerCase()))
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

  const respStyle:Record<string,[string,string]> = { ACCEPTED:['#ECFDF5','#059669'], REVISE:['#FFFBEB','#D97706'], BACKOUT:['#FEF2F2','#DC2626'] }

  return (
    <div>
      <div style={T.section}>🎉 Pre-onboarding & Offer Response</div>
      <SearchBar placeholder="Search candidate…" onApply={setPoQ} width={260} />
      {shownOnboarding.length===0&&<div style={{ ...T.card, color:'#9CA3AF', textAlign:'center' as const, padding:24 }}>{poQ?'No matching candidate':'No offer-sent candidates yet.'}</div>}
      {shownOnboarding.map((c:Candidate)=>{
        const row:any = linkByCand.get(c.id)
        const resp = row?.offer_response
        const [bg,fg] = resp ? respStyle[resp] : ['#fff','#6B7280']
        return (
          <div key={c.id} style={{ ...T.card, border:`1px solid ${resp?fg+'40':'rgba(124,58,237,0.12)'}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.designation||'—'} · {companyName(c)} · DOJ: {row?.doj||c.doj||'Not set'}</div>
                {c.email&&<div style={{ fontSize:11, color:'#9CA3AF', marginTop:1 }}>{c.email}</div>}
              </div>
              {resp&&(
                <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:bg, color:fg }}>
                  {resp==='ACCEPTED'?`✅ Accepted (${row?.candidate_type==='EXPERIENCED'?'Experienced':'Fresher'})`:resp==='REVISE'?'✏️ Revision requested':'🚫 Backed out'}
                </span>
              )}
            </div>

            {/* Onboarding date + HR email — drive the reminder emails */}
            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' as const }}>
              <label style={{ fontSize:11, color:'#6D28D9', fontWeight:600 }}>Onboarding date:</label>
              <input type="date" value={obVal(c)} onChange={e=>setObDates(m=>({...m,[c.id]:e.target.value}))} style={{ ...T.input, width:150, fontSize:12 }} />
              <label style={{ fontSize:11, color:'#6D28D9', fontWeight:600 }}>HR email:</label>
              <input value={hrVal(c)} onChange={e=>setHrEmails(m=>({...m,[c.id]:e.target.value}))} placeholder="hr@company.com" style={{ ...T.input, width:180, fontSize:12 }} />
              <button onClick={()=>saveOnboarding(c)} style={{ ...T.btn, background:'#EDE9FE', color:'#6D28D9', fontSize:11 }}>Save</button>
              {(()=>{ const d=daysToJoin(c); if(d===null) return null
                return d>=0 && d<=3
                  ? <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:99, background:'#ECFDF5', color:'#059669' }}>🚀 Joining in {d} day{d===1?'':'s'} — start onboarding</span>
                  : <span style={{ fontSize:11, color:d<0?'#DC2626':'#9CA3AF' }}>{d<0?'past joining date':`${d} days to join`}</span> })()}
            </div>
            {!c.hr_email&&!hrEmails[c.id]&&<div style={{ fontSize:10, color:'#DC2626', marginTop:4 }}>⚠ Add an HR email so onboarding reminder mails can be sent.</div>}

            {!resp&&(
              choose===c.id ? (
                <div style={{ marginTop:12, background:'#F8F7FF', borderRadius:8, padding:'10px 12px', border:'1px solid #E9E5FF' }}>
                  <div style={{ fontSize:12, color:'#6D28D9', fontWeight:600, marginBottom:8 }}>Candidate type — sends the right letter:</div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button disabled={busy===c.id} onClick={()=>sendAcceptance(c,'EXPERIENCED')} style={{ ...T.btn, background:'#7C3AED', color:'#fff' }}>{busy===c.id?'Sending…':'Experienced → Resignation Acceptance'}</button>
                    <button disabled={busy===c.id} onClick={()=>sendAcceptance(c,'FRESHER')} style={{ ...T.btn, background:'#2563EB', color:'#fff' }}>{busy===c.id?'Sending…':'Fresher → Joining Confirmation'}</button>
                    <button onClick={()=>setChoose('')} style={{ ...T.btn, background:'transparent', color:'#9CA3AF' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  <button onClick={()=>setChoose(c.id)} style={{ ...T.btn, background:'#ECFDF5', color:'#059669', border:'1px solid #A7F3D0', fontWeight:600 }}>✅ Accepted</button>
                  <button onClick={()=>markRevise(c)} style={{ ...T.btn, background:'#FFFBEB', color:'#D97706', border:'1px solid #FDE68A', fontWeight:600 }}>✏️ Revise Offer</button>
                  <button onClick={()=>markBackout(c)} style={{ ...T.btn, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', fontWeight:600 }}>🚫 Backout</button>
                </div>
              )
            )}

            {resp==='ACCEPTED'&&row?.acceptance_letter_sent_at&&(
              <div style={{ marginTop:10, fontSize:11, color:'#059669' }}>✉️ {row.candidate_type==='EXPERIENCED'?'Resignation Acceptance':'Joining Confirmation'} letter sent · {new Date(row.acceptance_letter_sent_at).toLocaleDateString('en-IN')}</div>
            )}
            {resp==='REVISE'&&row?.revise_note&&(
              <div style={{ marginTop:10, fontSize:11, color:'#92400E', background:'#FFFBEB', borderRadius:6, padding:'6px 10px' }}>Revision note: {row.revise_note}</div>
            )}
            {resp==='BACKOUT'&&(
              <div style={{ marginTop:10, fontSize:11, color:'#991B1B', background:'#FEF2F2', borderRadius:6, padding:'6px 10px' }}>Blacklisted · MRF reopened{row?.revise_note?` · Reason: ${row.revise_note}`:''}</div>
            )}
            {/* Backout available any day (even after acceptance) — blacklists + reopens the MRF */}
            {(resp==='ACCEPTED'||resp==='REVISE')&&(
              <div style={{ marginTop:10 }}>
                <button onClick={()=>markBackout(c)} style={{ ...T.btn, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', fontSize:11 }}>🚫 Candidate Backed Out</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
