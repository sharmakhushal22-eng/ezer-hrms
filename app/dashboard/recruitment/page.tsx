'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

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
}
interface Candidate {
  id:string; company_id:string; mrf_id?:string; full_name:string
  phone?:string; mobile?:string; email?:string; source?:string
  current_company?:string; designation?:string; experience_years?:number
  current_ctc?:number; expected_ctc?:number; notice_period?:number
  stage:string; ai_score?:number; ai_tag?:string; ai_match_tag?:string
  ai_reasoning?:string; ai_questions?:string[]; interview_notes?:string
  doj?:string; status?:string; created_at:string; resume_url?:string
}

const STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','MD Final','Offer Sent','Joined','Rejected']
const STAGE_COLOR:Record<string,string> = {
  'Applied':'#7C3AED','AI Screened':'#6D28D9','Telephonic':'#D97706',
  'L1':'#DB2777','L2':'#059669','Optional Round':'#4F46E5',
  'MD Final':'#EA580C','Offer Sent':'#0891B2','Joined':'#16A34A','Rejected':'#DC2626'
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
  const [tab, setTab] = useState<'dashboard'|'mrf'|'screening'|'pipeline'|'negotiation'|'offers'|'preonboarding'>('dashboard')
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

// ── MRF TAB ───────────────────────────────────────────────────────
function MRFTab({ supabase, companies, locations, departments, mrfs, candidates, onRefresh, showNotify }:any) {
  const EMPTY = { company_id:'', location_id:'', department_id:'', designation:'', no_of_openings:1,
    employment_type:'Employee', urgency:'MEDIUM', reason:'', job_description:'', budget_min:'',
    budget_max:'', experience_required:'', mrf_type:'Full MRF', education_required:'',
    skills_required:'', hiring_type:'New Hire', previous_company_preference:'' }
  const [showForm, setShowForm] = useState(false)
  const [editMRF, setEditMRF] = useState<MRF|null>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [approvalModal, setApprovalModal] = useState<MRF|null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null)

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
        body:JSON.stringify({ designation:form.designation, department:dept?.dept_name||'', experience:form.experience_required, employee_type:form.employment_type, education:form.education_required, skills:form.skills_required })
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
    const payload:any = {
      company_id:form.company_id, location_id:form.location_id||null,
      department_id:form.department_id||null,
      designation:form.designation, position:form.designation,
      no_of_openings:Number(form.no_of_openings)||1, openings:Number(form.no_of_openings)||1,
      employment_type:form.employment_type, urgency:form.urgency,
      reason:form.reason, reason_for_hire:form.reason,
      job_description:form.job_description||null, status,
      budget_min:Number(form.budget_min)||null, budget_max:Number(form.budget_max)||null,
      experience_required:form.experience_required||null,
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
    const { error } = await supabase.from('manpower_requisitions').delete().eq('id',id)
    if (error) { showNotify('Delete failed','error'); return }
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
              <div style={{ ...T.g3, marginBottom:10 }}>
                <div><label style={T.label}>Experience Required</label>
                  <input style={T.input} value={form.experience_required} onChange={e=>F('experience_required',e.target.value)} placeholder="e.g. 3-5 years" />
                </div>
                <div><label style={T.label}>Education Required</label>
                  <select style={T.select} value={form.education_required} onChange={e=>F('education_required',e.target.value)}>
                    <option value="">Any Education</option>
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
                <input style={T.input} value={form.skills_required} onChange={e=>F('skills_required',e.target.value)} placeholder="e.g. React, Node.js, SQL, Leadership" />
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

      {mrfs.map((m:MRF)=>{
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
              <div style={{ display:'flex', gap:6, marginLeft:10, flexShrink:0 }}>
                {m.status==='SUBMITTED'&&(
                  <button onClick={()=>setApprovalModal(m)} style={{ ...T.btn, background:'#ECFDF5', color:'#059669', border:'1px solid #A7F3D0', fontSize:11 }}>✅ Approve</button>
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

  async function extractText(file:File) {
    if (file.type==='text/plain'||file.type==='text/csv') return await file.text()
    return `File: ${file.name}\nSize: ${(file.size/1024).toFixed(0)}KB\nType: ${file.type}`
  }

  async function runScreening() {
    if (!selMRF) { showNotify('Please select an MRF','error'); return }
    if (!files.length) { showNotify('Please upload resumes','error'); return }
    if (!mrf?.job_description) { showNotify('The selected MRF has no JD','error'); return }
    setScreening(true); setResults([]); setProgress(0)
    const res:any[] = []
    for (let i=0; i<files.length; i++) {
      const text = await extractText(files[i])
      setProgress(Math.round(((i+1)/files.length)*100))
      try {
        const r = await fetch('/api/recruitment/screen-resumes', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ resume_text:text, jd_text:mrf.job_description, candidate_name:files[i].name.replace(/\.[^.]+$/,'') })
        })
        const d = await r.json()
        res.push({ ...d, file_name:files[i].name, added:false })
      } catch {
        res.push({ candidate_name:files[i].name, score:0, match_tag:'NOT_SUITABLE', reasoning:'Parse error', file_name:files[i].name, added:false })
      }
      setResults([...res])
    }
    setScreening(false)
  }

  async function addToBank(idx:number) {
    const r = results[idx]
    const { error } = await supabase.from('candidates').insert({
      mrf_id:selMRF, company_id:mrf?.company_id||null,
      full_name:r.candidate_name, phone:'TBD',
      source:'AI Screening', stage:'AI Screened',
      ai_score:r.score, ai_tag:r.match_tag, ai_match_tag:r.match_tag,
      ai_reasoning:r.reasoning, ai_questions:r.interview_questions||[],
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
              <option value="">Select MRF (must have a JD)</option>
              {mrfs.filter((m:MRF)=>m.job_description&&m.status==='APPROVED').map((m:MRF)=>(
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
  const [selMRF, setSelMRF] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selCand, setSelCand] = useState<Candidate|null>(null)
  const [aiQs, setAiQs] = useState<string[]>([])
  const [aiQLoading, setAiQLoading] = useState(false)
  const [aiFbLoading, setAiFbLoading] = useState(false)
  const EMPTY_C = { mrf_id:'', full_name:'', phone:'', email:'', current_company:'', designation:'', experience_years:'', current_ctc:'', expected_ctc:'', notice_period:'', source:'Direct' }
  const [cForm, setCForm] = useState<any>(EMPTY_C)
  const CF = (k:string,v:any) => setCForm((f:any)=>({...f,[k]:v}))
  const approvedMRFs = mrfs.filter((m:MRF)=>m.status==='APPROVED')
  const filtered = selMRF==='all'?candidates:candidates.filter((c:Candidate)=>c.mrf_id===selMRF)

  async function addCandidate() {
    if (!cForm.full_name||!cForm.phone) { showNotify('Name and Phone are required','error'); return }
    const { data:dup } = await supabase.from('candidates').select('id').or(`phone.eq.${cForm.phone},email.eq.${cForm.email||'none'}`).limit(1)
    if (dup?.length&&!window.confirm('A candidate with the same phone/email already exists. Add anyway?')) return
    const mrf = mrfs.find((m:MRF)=>m.id===cForm.mrf_id)
    const { error } = await supabase.from('candidates').insert({
      mrf_id:cForm.mrf_id||null, company_id:mrf?.company_id||null,
      full_name:cForm.full_name, phone:cForm.phone, mobile:cForm.phone,
      email:cForm.email||null, current_company:cForm.current_company||null,
      designation:cForm.designation||null, experience_years:Number(cForm.experience_years)||0,
      current_ctc:Number(cForm.current_ctc)||null, expected_ctc:Number(cForm.expected_ctc)||null,
      notice_period:Number(cForm.notice_period)||null, source:cForm.source, stage:'Applied',
      status:'active', applied_date:new Date().toISOString().split('T')[0],
    })
    if (error) { showNotify('Error: '+error.message,'error'); return }
    showNotify('Candidate added!'); setShowAdd(false); setCForm(EMPTY_C); onRefresh()
  }

  async function moveStage(id:string, stage:string) {
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
        <button onClick={()=>setShowAdd(true)} style={T.btnPrimary}>+ Add Candidate</button>
      </div>

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
                    <div style={{ fontSize:12, fontWeight:600, color:'#1E1B4B', marginBottom:2 }}>{c.full_name}</div>
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
              <div><label style={T.label}>Email</label><input style={T.input} value={cForm.email} onChange={e=>CF('email',e.target.value)} /></div>
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
              <div><label style={T.label}>Expected CTC (₹)</label><input style={T.input} type="number" value={cForm.expected_ctc} onChange={e=>CF('expected_ctc',e.target.value)} /></div>
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
          aiFbLoading={aiFbLoading} onGetFeedback={getAIFeedback} />
      )}
    </div>
  )
}

function CandidateDrawer({ candidate:c, mrfs, onClose, onStageChange, onSaveNotes, aiQs, aiQLoading, onGetQuestions, aiFbLoading, onGetFeedback }:any) {
  const [notes, setNotes] = useState(c.interview_notes||'')
  const [interviewer, setInterviewer] = useState('')
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
        {STAGES.map(s=>(
          <button key={s} onClick={()=>onStageChange(c.id,s)} style={{ ...T.btn, fontSize:10, padding:'4px 9px',
            background:c.stage===s?STAGE_COLOR[s]:STAGE_COLOR[s]+'12',
            color:c.stage===s?'#fff':STAGE_COLOR[s],
            border:c.stage===s?'none':`1px solid ${STAGE_COLOR[s]}30` }}>
            {s}
          </button>
        ))}
      </div>

      {/* Interviewer Assignment */}
      <SectionLine title="Assign Interviewer" />
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <input style={{ ...T.input, flex:1 }} value={interviewer} onChange={e=>setInterviewer(e.target.value)} placeholder="Interviewer name or email" />
        <button onClick={()=>{ const n = (c.interview_notes||'')+'\n\nInterviewer: '+interviewer; onSaveNotes(c.id,n); setNotes(n) }} style={T.btnOutline}>Assign</button>
      </div>

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
function NegotiationTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  const finalCands = candidates.filter((c:Candidate)=>['MD Final','Offer Sent','L2','Optional Round'].includes(c.stage))
  const [sel, setSel] = useState<Candidate|null>(null)
  const [form, setForm] = useState({ ctc:'', varPct:'10', joining_bonus:'', joining_freq:'With Salary', retention_bonus:'', retention_freq:'After 3 Months', esop:'', esop_plan:'', state:'HR' })
  const [calc, setCalc] = useState<any>(null)
  const [saving, setSaving] = useState(false)
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
    const totalCTC = gross + epfEmployee + epfEmployer + esicEmployer + statBonus
    const hike = sel?.current_ctc ? ((ctcAnnual-sel.current_ctc)/sel.current_ctc*100).toFixed(1) : null

    setCalc({ ctcAnnual, variable, varMonthly:variable/12, fixedMonthly, basic, hra, statBonus, otherAllow, gross, epfEmployee, esicEmployee, ptMonthly, lwfMonthly, totalDed, inHand, epfEmployer, esicEmployer, totalCTCMonthly:totalCTC, totalCTCAnnual:totalCTC*12, hike,
      joining_bonus:Number(form.joining_bonus)||0, retention_bonus:Number(form.retention_bonus)||0, esop:Number(form.esop)||0 })
  }

  async function saveNegotiation() {
    if (!sel||!calc) return
    setSaving(true)
    const { error } = await supabase.from('ctc_negotiations').upsert({
      candidate_id:sel.id, company_id:sel.company_id||null,
      offered_ctc:calc.ctcAnnual, variable_pct:form.varPct,
      basic_monthly:Math.round(calc.basic), hra_monthly:Math.round(calc.hra),
      epf_monthly:Math.round(calc.epfEmployee), net_monthly:Math.round(calc.inHand),
      current_ctc:sel.current_ctc||null, hike_pct:calc.hike,
      previous_company:sel.current_company||null,
      candidate_name:sel.full_name, position_title:sel.designation||null,
      calculation_data:calc,
      joining_bonus:calc.joining_bonus||0, joining_bonus_freq:form.joining_freq||null,
      retention_bonus:calc.retention_bonus||0, retention_bonus_freq:form.retention_freq||null,
      esop_value:calc.esop||0, esop_remark:form.esop_plan||null,
    })
    setSaving(false)
    if (error) { showNotify('Save failed: '+error.message); return }
    showNotify('Negotiation saved! Now create the offer letter from the Offers tab.')
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
      ['CTC','Gross+EmpEPF+EmpESIC',Math.round(calc.totalCTCMonthly),calc.ctcAnnual,''],
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
        <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B', marginBottom:10 }}>MD Final / Negotiation Stage ({finalCands.length})</div>
        {finalCands.map((c:Candidate)=>(
          <div key={c.id} onClick={()=>{ setSel(c); setCalc(null); F('ctc','') }}
            style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?'#F3F0FF':'#fff' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L exp':'—'}</div>
            <div style={{ marginTop:6 }}><Badge text={c.stage} /></div>
          </div>
        ))}
        {finalCands.length===0&&<div style={{ ...T.card, color:'#9CA3AF', fontSize:13, textAlign:'center' as const, padding:24 }}>No candidate is at the MD Final stage</div>}
      </div>

      {sel&&(
        <div>
          <div style={T.cardPurple}>
            <div style={{ fontSize:13, fontWeight:600, color:'#6D28D9', marginBottom:14 }}>💰 CTC Calculator — {sel.full_name}</div>
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
                  <tr style={{ background:'#EDE9FE' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:'#1E1B4B' }}>CTC</td>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── OFFERS TAB ────────────────────────────────────────────────────
function OffersTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  const [sel, setSel] = useState<Candidate|null>(null)
  const [letter, setLetter] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [cc, setCc] = useState('')
  const [doj, setDoj] = useState('')
  const offeredCands = candidates.filter((c:Candidate)=>['MD Final','Offer Sent'].includes(c.stage))

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
    await supabase.from('offer_letters').insert({
      candidate_id:sel.id, company_id:sel.company_id||null,
      letter_content:letter, to_email:toEmail,
      cc_emails:cc.split(',').map((e:string)=>e.trim()).filter(Boolean),
      status:'SENT', sent_at:new Date().toISOString()
    }).catch(()=>{})
    await supabase.from('candidates').update({ stage:'Offer Sent', doj:doj||null }).eq('id',sel.id)
    showNotify('Offer saved! Email ready.'); onRefresh()
  }

  return (
    <div style={T.g2}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B', marginBottom:10 }}>MD Final / Offer Stage ({offeredCands.length})</div>
        {offeredCands.map((c:Candidate)=>(
          <div key={c.id} style={{ ...T.card, cursor:'pointer', border:sel?.id===c.id?'1.5px solid #7C3AED':'1px solid rgba(124,58,237,0.12)', background:sel?.id===c.id?'#F3F0FF':'#fff' }}
            onClick={()=>generateLetter(c)}>
            <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{c.current_company} · ₹{c.expected_ctc?(c.expected_ctc/100000).toFixed(1)+'L':' — '}</div>
            <div style={{ marginTop:6 }}><Badge text={c.stage} /></div>
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
function PreOnboardTab({ supabase, candidates, onRefresh, showNotify }:any) {
  const [links, setLinks] = useState<any[]>([])
  const [dojMap, setDojMap] = useState<Record<string,string>>({})

  useEffect(()=>{
    supabase.from('preonboarding_links').select('*, candidates!inner(full_name,email,phone,stage)')
      .order('created_at',{ascending:false})
      .then(({data}:any)=>setLinks(data||[]))
  },[supabase])

  const offeredCands = candidates.filter((c:Candidate)=>['Offer Sent','Joined'].includes(c.stage))
  const linkedIds = new Set(links.map((l:any)=>l.candidate_id))
  const notLinked = offeredCands.filter((c:Candidate)=>!linkedIds.has(c.id))

  async function createLink(candidate_id:string) {
    const cand = candidates.find((c:Candidate)=>c.id===candidate_id)
    const { error } = await supabase.from('preonboarding_links').insert({
      candidate_id, company_id:cand?.company_id||null,
      doj:dojMap[candidate_id]||null, status:'CREATED', sent_at:new Date().toISOString()
    })
    if (error) { showNotify('Error: '+error.message,'error'); return }
    showNotify('Pre-onboarding link created!')
    const { data } = await supabase.from('preonboarding_links').select('*, candidates!inner(full_name,email,phone,stage)').order('created_at',{ascending:false})
    setLinks(data||[]); onRefresh()
  }

  return (
    <div>
      <div style={T.section}>🎉 Pre-onboarding Links</div>
      {notLinked.length>0&&(
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:8 }}>Create link — Offer-sent candidates</div>
          {notLinked.map((c:Candidate)=>(
            <div key={c.id} style={{ ...T.card, border:'1px solid #FDE68A', background:'#FFFBEB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{c.full_name}</div>
                <div style={{ fontSize:11, color:'#9CA3AF' }}>{c.phone} · {c.stage}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input type="date" style={{ ...T.input, width:150, fontSize:11 }} value={dojMap[c.id]||''} onChange={e=>setDojMap(m=>({...m,[c.id]:e.target.value}))} />
                <button onClick={()=>createLink(c.id)} style={{ ...T.btn, background:'#D97706', color:'#fff', fontWeight:600 }}>🔗 Create Link</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:8 }}>Sent Links ({links.length})</div>
      {links.map((l:any)=>{
        const daysSince = Math.floor((Date.now()-new Date(l.sent_at).getTime())/86400000)
        const backoutRisk = !l.opened_at&&daysSince>=2
        return (
          <div key={l.id} style={{ ...T.card, border:backoutRisk?'1.5px solid #FCA5A5':'1px solid rgba(124,58,237,0.12)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B' }}>{l.candidates?.full_name}</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>DOJ: {l.doj||'Not set'} · {l.candidates?.phone}</div>
                <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2, fontFamily:'monospace' }}>Token: {l.link_token}</div>
              </div>
              <div style={{ textAlign:'right' as const }}>
                <Badge text={l.status} />
                {backoutRisk&&<div style={{ fontSize:11, color:'#DC2626', marginTop:4, fontWeight:500 }}>🚨 {daysSince} days — BACKOUT RISK!</div>}
              </div>
            </div>
            {l.submitted_at&&(
              <div style={{ marginTop:10, background:'#ECFDF5', borderRadius:7, padding:10, border:'1px solid #A7F3D0' }}>
                <div style={{ fontSize:12, color:'#059669', fontWeight:500 }}>✅ Form Submitted — Code generation ready</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
