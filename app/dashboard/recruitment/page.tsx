'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import * as XLSX from 'xlsx'

// ── TYPES ─────────────────────────────────────────────────────
interface MRF {
  id: string; company_id: string; location_id: string
  department_id: string; designation: string; no_of_openings: number
  experience_required: string; budget_min: number; budget_max: number
  employment_type: string; job_description: string; urgency: string
  reason_for_hire: string; status: string; created_at: string
  company_name?: string; location_name?: string; dept_name?: string
}
interface Candidate {
  id: string; company_id: string; mrf_id: string; full_name: string
  mobile: string; email: string; source: string; current_company: string
  designation: string; experience_years: number; current_ctc: number
  expected_ctc: number; notice_period_days: number; stage: string
  ai_score: number; ai_match_tag: string; ai_reasoning: string
  ai_questions: string[]; interview_notes: string; doj: string
  created_at: string
}
interface Company { id: string; company_code: string; }
interface Location { id: string; location_code: string; company_id: string }
interface Department { id: string; dept_name: string; dept_code: string; company_id: string }

const STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','MD Final','Offer Sent','Joined','Rejected']
const STAGE_COLORS: Record<string, string> = {
  'Applied':'#3B82F6','AI Screened':'#8B5CF6','Telephonic':'#F59E0B',
  'L1':'#EC4899','L2':'#10B981','Optional Round':'#6366F1',
  'MD Final':'#F97316','Offer Sent':'#14B8A6','Joined':'#22C55E','Rejected':'#EF4444'
}
const EMP_TYPES = ['Employee','Intern','Contract','Consultant','NAPS','NATS','Live Project']
const S = { // Styles object
  card: { background:'#1E293B', borderRadius:10, border:'1px solid rgba(255,255,255,0.07)', padding:'16px 18px', marginBottom:12 } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.5)', textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:5 },
  input: { width:'100%', padding:'9px 12px', background:'#0F172A', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#fff', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  select: { width:'100%', padding:'9px 12px', background:'#0F172A', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#fff', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  textarea: { width:'100%', padding:'9px 12px', background:'#0F172A', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#fff', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit', resize:'vertical' as const, minHeight:100 },
  btn: { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit' } as React.CSSProperties,
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } as React.CSSProperties,
  grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 } as React.CSSProperties,
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function RecruitmentPage() {
  
  const [tab, setTab] = useState<'dashboard'|'mrf'|'pipeline'|'screening'|'offers'|'preonboarding'>('dashboard')
  
  // Master data
  const [companies, setCompanies] = useState<Company[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [mrfs, setMrfs] = useState<MRF[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])

  // Stats
  const [stats, setStats] = useState({ total_mrfs:0, active_openings:0, pipeline:0, joined_this_month:0 })

  useEffect(() => { loadMasterData(); loadMRFs(); loadCandidates() }, [])

  async function loadMasterData() {
    const [{ data: co }, { data: lo }, { data: de }] = await Promise.all([
      supabase.from('companies').select('id, company_code'),
      supabase.from('locations').select('id, location_code, company_id'),
      supabase.from('departments').select('id, dept_name, dept_code, company_id'),
    ])
    setCompanies(co || []); setLocations(lo || []); setDepartments(de || [])
  }

  async function loadMRFs() {
    const { data } = await supabase.from('manpower_requisitions')
      .select('*').order('created_at', { ascending: false })
    setMrfs(data || [])
    setStats(s => ({ ...s, total_mrfs: data?.length || 0, active_openings: data?.filter(m => m.status === 'APPROVED').length || 0 }))
  }

  async function loadCandidates() {
    const { data } = await supabase.from('candidates')
      .select('*').order('created_at', { ascending: false })
    setCandidates(data || [])
    const now = new Date()
    const joined = data?.filter(c => c.stage === 'Joined' && new Date(c.created_at).getMonth() === now.getMonth()) || []
    setStats(s => ({ ...s, pipeline: data?.length || 0, joined_this_month: joined.length }))
  }

  const tabs = [
    { key:'dashboard', label:'📊 Dashboard' },
    { key:'mrf', label:'📝 MRF / Hiring Request' },
    { key:'pipeline', label:'🔀 Pipeline' },
    { key:'screening', label:'🤖 AI Screening' },
    { key:'offers', label:'📄 Offers & Negotiation' },
    { key:'preonboarding', label:'🎉 Pre-onboarding' },
  ]

  return (
    <div style={{ background:'#0F172A', minHeight:'100vh', color:'#E2E8F0', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#1E1B4B,#2D1B69)', padding:'20px 24px' }}>
        <div style={{ fontSize:20, fontWeight:700, color:'#fff', marginBottom:3 }}>Recruitment & ATS</div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>MRF → Screening → Interview → Offer → Pre-onboarding</div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#1E293B', borderBottom:'1px solid rgba(255,255,255,0.07)', padding:'0 24px', display:'flex', gap:2, overflowX:'auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            style={{ ...S.btn, background:'transparent', borderRadius:0, padding:'12px 16px', color: tab === t.key ? '#A78BFA' : 'rgba(255,255,255,0.5)', borderBottom: tab === t.key ? '2px solid #7C3AED' : '2px solid transparent', fontWeight: tab === t.key ? 600 : 400, whiteSpace:'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding:'20px 24px', maxWidth:1200 }}>
        {tab === 'dashboard' && <DashboardTab stats={stats} mrfs={mrfs} candidates={candidates} />}
        {tab === 'mrf' && <MRFTab supabase={supabase} companies={companies} locations={locations} departments={departments} mrfs={mrfs} onRefresh={loadMRFs} />}
        {tab === 'pipeline' && <PipelineTab supabase={supabase} candidates={candidates} mrfs={mrfs} onRefresh={loadCandidates} />}
        {tab === 'screening' && <ScreeningTab supabase={supabase} mrfs={mrfs} candidates={candidates} onRefresh={loadCandidates} />}
        {tab === 'offers' && <OffersTab supabase={supabase} candidates={candidates} companies={companies} onRefresh={loadCandidates} />}
        {tab === 'preonboarding' && <PreonboardingTab supabase={supabase} candidates={candidates} onRefresh={loadCandidates} />}
      </div>
    </div>
  )
}

// ── DASHBOARD TAB ──────────────────────────────────────────────
function DashboardTab({ stats, mrfs, candidates }: any) {
  const statCards = [
    { label:'Total MRFs', value: stats.total_mrfs, color:'#7C3AED' },
    { label:'Active Openings', value: stats.active_openings, color:'#3B82F6' },
    { label:'Total in Pipeline', value: stats.pipeline, color:'#F59E0B' },
    { label:'Joined This Month', value: stats.joined_this_month, color:'#22C55E' },
  ]
  const stageCount = STAGES.reduce((acc, s) => { acc[s] = candidates.filter((c:any) => c.stage === s).length; return acc }, {} as Record<string, number>)

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {statCards.map(sc => (
          <div key={sc.label} style={{ ...S.card, textAlign:'center' as const }}>
            <div style={{ fontSize:28, fontWeight:700, color:sc.color }}>{sc.value}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:4 }}>{sc.label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.card }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>Pipeline Overview</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
          {STAGES.map(s => (
            <div key={s} style={{ background:'rgba(255,255,255,0.04)', borderRadius:8, padding:'10px 14px', minWidth:80, textAlign:'center' as const, border:`1px solid ${STAGE_COLORS[s]}30` }}>
              <div style={{ fontSize:20, fontWeight:700, color:STAGE_COLORS[s] }}>{stageCount[s] || 0}</div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginTop:3 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.card }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Recent MRFs</div>
        {mrfs.slice(0,5).map((m:any) => (
          <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500 }}>{m.designation}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{m.employment_type} · {m.no_of_openings} openings</div>
            </div>
            <StatusBadge status={m.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MRF TAB ────────────────────────────────────────────────────
function MRFTab({ supabase, companies, locations, departments, mrfs, onRefresh }: any) {
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [form, setForm] = useState({
    company_id:'', location_id:'', department_id:'', designation:'',
    no_of_openings:1, experience_required:'', budget_min:'', budget_max:'',
    employment_type:'Employee', job_description:'', urgency:'MEDIUM',
    reason_for_hire:'', is_replacement:false
  })
  const [approvalModal, setApprovalModal] = useState<any>(null)

  const filteredLocations = locations.filter((l:any) => l.company_id === form.company_id)
  const filteredDepts = departments.filter((d:any) => d.company_id === form.company_id)

  function setF(key: string, val: any) { setForm(f => ({ ...f, [key]: val })) }

  async function generateJD() {
    if (!form.designation) { alert('Pehle designation daalo'); return }
    setAiLoading(true)
    const dept = departments.find((d:any) => d.id === form.department_id)
    try {
      const res = await fetch('/api/recruitment/generate-jd', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ designation: form.designation, department: dept?.dept_name || '', experience: form.experience_required, employee_type: form.employment_type })
      })
      const { jd } = await res.json()
      setF('job_description', jd)
    } catch { alert('JD generate nahi ho saka') }
    setAiLoading(false)
  }

  async function saveMRF(status: 'DRAFT'|'SUBMITTED') {
    if (!form.company_id || !form.designation || !form.no_of_openings) { alert('Company, Designation aur Openings zaroori hain'); return }
    setLoading(true)
    const { data, error } = await supabase.from('manpower_requisitions').insert({
      company_id: form.company_id, location_id: form.location_id || null,
      department_id: form.department_id || null, designation: form.designation,
      no_of_openings: Number(form.no_of_openings), experience_required: form.experience_required,
      budget_min: Number(form.budget_min) || null, budget_max: Number(form.budget_max) || null,
      employment_type: form.employment_type, job_description: form.job_description,
      urgency: form.urgency, reason_for_hire: form.reason_for_hire, status,
    }).select()
    if (!error) { onRefresh(); setShowForm(false); setForm({ company_id:'', location_id:'', department_id:'', designation:'', no_of_openings:1, experience_required:'', budget_min:'', budget_max:'', employment_type:'Employee', job_description:'', urgency:'MEDIUM', reason_for_hire:'', is_replacement:false }) }
    else alert('Error: ' + error.message)
    setLoading(false)
  }

  async function approveMRF(mrf_id: string, recruiter_email: string) {
    await supabase.from('manpower_requisitions').update({ status:'APPROVED', assigned_recruiter: recruiter_email, approved_at: new Date().toISOString() }).eq('id', mrf_id)
    await supabase.from('mrf_approvals').insert({ mrf_id, company_id: mrfs.find((m:any) => m.id === mrf_id)?.company_id, status:'APPROVED', assigned_recruiter_email: recruiter_email })
    setApprovalModal(null); onRefresh()
  }

  async function rejectMRF(mrf_id: string, reason: string) {
    await supabase.from('manpower_requisitions').update({ status:'REJECTED' }).eq('id', mrf_id)
    await supabase.from('mrf_approvals').insert({ mrf_id, company_id: mrfs.find((m:any) => m.id === mrf_id)?.company_id, status:'REJECTED', rejection_reason: reason })
    setApprovalModal(null); onRefresh()
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:600 }}>Manpower Requisitions ({mrfs.length})</div>
        <button onClick={() => setShowForm(!showForm)} style={{ ...S.btn, background:'#7C3AED', color:'#fff' }}>
          {showForm ? 'Cancel' : '+ New MRF / Quick Hire'}
        </button>
      </div>

      {showForm && (
        <div style={{ ...S.card, border:'1px solid rgba(124,58,237,0.3)', marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#A78BFA', marginBottom:16 }}>New Hiring Request</div>
          
          <div style={{ ...S.grid3, marginBottom:12 }}>
            <div><label style={S.label}>Company *</label>
              <select style={S.select} value={form.company_id} onChange={e => setF('company_id', e.target.value)}>
                <option value=''>Select Company</option>
                {companies.map((c:any) => <option key={c.id} value={c.id}>{c.company_code}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Branch / Location</label>
              <select style={S.select} value={form.location_id} onChange={e => setF('location_id', e.target.value)}>
                <option value=''>Select Location</option>
                {filteredLocations.map((l:any) => <option key={l.id} value={l.id}>{l.location_code}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Department</label>
              <select style={S.select} value={form.department_id} onChange={e => setF('department_id', e.target.value)}>
                <option value=''>Select Department</option>
                {filteredDepts.map((d:any) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ ...S.grid3, marginBottom:12 }}>
            <div><label style={S.label}>Designation / Position *</label>
              <input style={S.input} value={form.designation} onChange={e => setF('designation', e.target.value)} placeholder='e.g. Senior Software Engineer' />
            </div>
            <div><label style={S.label}>No. of Openings *</label>
              <input style={S.input} type='number' min={1} value={form.no_of_openings} onChange={e => setF('no_of_openings', e.target.value)} />
            </div>
            <div><label style={S.label}>Employment Type</label>
              <select style={S.select} value={form.employment_type} onChange={e => setF('employment_type', e.target.value)}>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{ ...S.grid3, marginBottom:12 }}>
            <div><label style={S.label}>Experience Required</label>
              <input style={S.input} value={form.experience_required} onChange={e => setF('experience_required', e.target.value)} placeholder='e.g. 3-5 years' />
            </div>
            <div><label style={S.label}>Budget Min (₹ LPA)</label>
              <input style={S.input} type='number' value={form.budget_min} onChange={e => setF('budget_min', e.target.value)} placeholder='e.g. 600000' />
            </div>
            <div><label style={S.label}>Budget Max (₹ LPA)</label>
              <input style={S.input} type='number' value={form.budget_max} onChange={e => setF('budget_max', e.target.value)} placeholder='e.g. 1000000' />
            </div>
          </div>

          <div style={{ ...S.grid2, marginBottom:12 }}>
            <div><label style={S.label}>Urgency</label>
              <select style={S.select} value={form.urgency} onChange={e => setF('urgency', e.target.value)}>
                <option value='HIGH'>🔴 High</option>
                <option value='MEDIUM'>🟡 Medium</option>
                <option value='LOW'>🟢 Low</option>
              </select>
            </div>
            <div><label style={S.label}>Reason for Hire</label>
              <input style={S.input} value={form.reason_for_hire} onChange={e => setF('reason_for_hire', e.target.value)} placeholder='New position / Replacement / Expansion' />
            </div>
          </div>

          <div style={{ marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
              <label style={{ ...S.label, marginBottom:0 }}>Job Description</label>
              <button onClick={generateJD} disabled={aiLoading} style={{ ...S.btn, background:'rgba(124,58,237,0.2)', color:'#A78BFA', fontSize:12, padding:'5px 12px' }}>
                {aiLoading ? '⏳ Generating...' : '🤖 AI se JD Generate Karo'}
              </button>
            </div>
            <textarea style={{ ...S.textarea, minHeight:160 }} value={form.job_description} onChange={e => setF('job_description', e.target.value)} placeholder='Job description yahan likhein... ya AI button use karein' />
          </div>

          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => saveMRF('DRAFT')} disabled={loading} style={{ ...S.btn, background:'rgba(255,255,255,0.08)', color:'#fff' }}>💾 Save as Draft</button>
            <button onClick={() => saveMRF('SUBMITTED')} disabled={loading} style={{ ...S.btn, background:'#7C3AED', color:'#fff' }}>📤 Submit for Approval</button>
          </div>
        </div>
      )}

      {/* MRF List */}
      {mrfs.map((m:any) => (
        <div key={m.id} style={{ ...S.card, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:5 }}>
              <span style={{ fontSize:14, fontWeight:600 }}>{m.designation}</span>
              <StatusBadge status={m.status} />
              <span style={{ fontSize:11, padding:'2px 7px', borderRadius:99, background: m.urgency==='HIGH'?'rgba(239,68,68,0.15)':m.urgency==='MEDIUM'?'rgba(245,158,11,0.15)':'rgba(34,197,94,0.15)', color: m.urgency==='HIGH'?'#FCA5A5':m.urgency==='MEDIUM'?'#FCD34D':'#86EFAC' }}>{m.urgency}</span>
            </div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', display:'flex', gap:16 }}>
              <span>👥 {m.no_of_openings} openings</span>
              <span>💼 {m.employment_type}</span>
              {m.experience_required && <span>⏱ {m.experience_required}</span>}
              {m.budget_max && <span>💰 ₹{(m.budget_max/100000).toFixed(1)}L max</span>}
            </div>
            {m.job_description && <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', marginTop:5 }}>{m.job_description.substring(0,120)}...</div>}
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0, marginLeft:12 }}>
            {m.status === 'SUBMITTED' && (
              <button onClick={() => setApprovalModal(m)} style={{ ...S.btn, background:'rgba(34,197,94,0.15)', color:'#86EFAC', fontSize:12 }}>✅ Approve / Reject</button>
            )}
          </div>
        </div>
      ))}

      {/* Approval Modal */}
      {approvalModal && <ApprovalModal mrf={approvalModal} onApprove={approveMRF} onReject={rejectMRF} onClose={() => setApprovalModal(null)} />}
    </div>
  )
}

function ApprovalModal({ mrf, onApprove, onReject, onClose }: any) {
  const [recruiterEmail, setRecruiterEmail] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [mode, setMode] = useState<'approve'|'reject'>('approve')
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#1E293B', borderRadius:12, padding:24, width:420, border:'1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:16 }}>MRF Approval: {mrf.designation}</div>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button onClick={() => setMode('approve')} style={{ ...S.btn, flex:1, background: mode==='approve'?'rgba(34,197,94,0.2)':'rgba(255,255,255,0.05)', color: mode==='approve'?'#86EFAC':'#94A3B8' }}>✅ Approve</button>
          <button onClick={() => setMode('reject')} style={{ ...S.btn, flex:1, background: mode==='reject'?'rgba(239,68,68,0.2)':'rgba(255,255,255,0.05)', color: mode==='reject'?'#FCA5A5':'#94A3B8' }}>❌ Reject</button>
        </div>
        {mode === 'approve' ? (
          <div>
            <label style={S.label}>Assign Recruiter Email</label>
            <input style={{ ...S.input, marginBottom:16 }} value={recruiterEmail} onChange={e => setRecruiterEmail(e.target.value)} placeholder='recruiter@company.com' />
            <button onClick={() => onApprove(mrf.id, recruiterEmail)} style={{ ...S.btn, background:'#22C55E', color:'#fff', width:'100%' }}>Approve & Assign</button>
          </div>
        ) : (
          <div>
            <label style={S.label}>Rejection Reason *</label>
            <textarea style={{ ...S.textarea, marginBottom:16 }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder='Reason batao...' rows={3} />
            <button onClick={() => rejectReason && onReject(mrf.id, rejectReason)} style={{ ...S.btn, background:'#EF4444', color:'#fff', width:'100%' }}>Reject MRF</button>
          </div>
        )}
        <button onClick={onClose} style={{ ...S.btn, background:'transparent', color:'rgba(255,255,255,0.4)', width:'100%', marginTop:8 }}>Cancel</button>
      </div>
    </div>
  )
}

// ── PIPELINE TAB ───────────────────────────────────────────────
function PipelineTab({ supabase, candidates, mrfs, onRefresh }: any) {
  const [selectedMRF, setSelectedMRF] = useState<string>('all')
  const [showAddCandidate, setShowAddCandidate] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null)
  const [aiQLoading, setAiQLoading] = useState(false)
  const [aiQuestions, setAiQuestions] = useState<string[]>([])
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false)
  const [form, setForm] = useState({ mrf_id:'', full_name:'', mobile:'', email:'', current_company:'', designation:'', experience_years:'', current_ctc:'', expected_ctc:'', notice_period_days:'', source:'Direct', stage:'Applied' })

  const filtered = selectedMRF === 'all' ? candidates : candidates.filter((c:any) => c.mrf_id === selectedMRF)

  async function addCandidate() {
    if (!form.full_name || !form.mobile) { alert('Name aur Mobile zaroori hai'); return }
    // Duplicate check
    const { data: dup } = await supabase.from('candidates').select('id').or(`mobile.eq.${form.mobile},email.eq.${form.email}`).limit(1)
    if (dup?.length) { if (!confirm('Same mobile/email ka candidate already hai. Phir bhi add karein?')) return }
    const mrf = mrfs.find((m:any) => m.id === form.mrf_id)
    const { error } = await supabase.from('candidates').insert({
      mrf_id: form.mrf_id || null, company_id: mrf?.company_id, full_name: form.full_name,
      mobile: form.mobile, email: form.email, current_company: form.current_company,
      designation: form.designation, experience_years: Number(form.experience_years) || 0,
      current_ctc: Number(form.current_ctc) || null, expected_ctc: Number(form.expected_ctc) || null,
      notice_period_days: Number(form.notice_period_days) || null, source: form.source, stage: form.stage
    })
    if (!error) { onRefresh(); setShowAddCandidate(false) }
    else alert('Error: ' + error.message)
  }

  async function moveStage(candidate_id: string, new_stage: string) {
    await supabase.from('candidates').update({ stage: new_stage }).eq('id', candidate_id)
    onRefresh()
  }

  async function saveNotes(candidate_id: string, notes: string) {
    await supabase.from('candidates').update({ interview_notes: notes }).eq('id', candidate_id)
    onRefresh()
  }

  async function getAIQuestions(candidate: any) {
    setAiQLoading(true); setAiQuestions([])
    const round = candidate.stage
    const mrf = mrfs.find((m:any) => m.id === candidate.mrf_id)
    try {
      const res = await fetch('/api/recruitment/interview-ai', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type:'questions', designation: mrf?.designation || candidate.designation, round, candidate_summary: `${candidate.experience_years}yr exp, ${candidate.current_company}, ${candidate.designation}` })
      })
      const { result } = await res.json()
      const parsed = JSON.parse(result.replace(/```json|```/g,'').trim())
      const qs = parsed.map((q:any) => q.question)
      setAiQuestions(qs)
      await supabase.from('candidates').update({ ai_questions: qs }).eq('id', candidate.id)
    } catch { setAiQuestions(['Could not generate questions']) }
    setAiQLoading(false)
  }

  async function getAIFeedback(candidate: any) {
    if (!candidate.interview_notes) { alert('Pehle interview notes likhein'); return }
    setAiFeedbackLoading(true)
    const mrf = mrfs.find((m:any) => m.id === candidate.mrf_id)
    const res = await fetch('/api/recruitment/interview-ai', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type:'feedback', designation: mrf?.designation || candidate.designation, round: candidate.stage, existing_notes: candidate.interview_notes })
    })
    const { result } = await res.json()
    const newNotes = candidate.interview_notes + '\n\n--- AI FEEDBACK ---\n' + result
    await supabase.from('candidates').update({ interview_notes: newNotes }).eq('id', candidate.id)
    onRefresh(); setSelectedCandidate({...candidate, interview_notes: newNotes})
    setAiFeedbackLoading(false)
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <select style={{ ...S.select, width:200 }} value={selectedMRF} onChange={e => setSelectedMRF(e.target.value)}>
            <option value='all'>All Openings ({candidates.length})</option>
            {mrfs.filter((m:any) => m.status === 'APPROVED').map((m:any) => (
              <option key={m.id} value={m.id}>{m.designation} ({candidates.filter((c:any) => c.mrf_id === m.id).length})</option>
            ))}
          </select>
        </div>
        <button onClick={() => setShowAddCandidate(true)} style={{ ...S.btn, background:'#7C3AED', color:'#fff' }}>+ Add Candidate</button>
      </div>

      {/* Kanban */}
      <div style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:12 }}>
        {STAGES.map(stage => {
          const stageCandidates = filtered.filter((c:any) => c.stage === stage)
          return (
            <div key={stage} style={{ minWidth:200, flexShrink:0 }}>
              <div style={{ background:`${STAGE_COLORS[stage]}20`, borderRadius:'8px 8px 0 0', padding:'8px 12px', borderTop:`3px solid ${STAGE_COLORS[stage]}`, display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, fontWeight:600, color:STAGE_COLORS[stage] }}>{stage}</span>
                <span style={{ fontSize:11, background:`${STAGE_COLORS[stage]}30`, color:STAGE_COLORS[stage], borderRadius:99, padding:'1px 7px' }}>{stageCandidates.length}</span>
              </div>
              <div style={{ background:'rgba(255,255,255,0.02)', borderRadius:'0 0 8px 8px', minHeight:200, padding:8 }}>
                {stageCandidates.map((c:any) => (
                  <div key={c.id} onClick={() => setSelectedCandidate(c)}
                    style={{ background:'#1E293B', borderRadius:8, padding:10, marginBottom:8, cursor:'pointer', border:'1px solid rgba(255,255,255,0.07)', transition:'border-color .15s' }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:3 }}>{c.full_name}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>{c.current_company} · {c.experience_years}yr</div>
                    {c.expected_ctc && <div style={{ fontSize:11, color:'#A78BFA' }}>₹{(c.expected_ctc/100000).toFixed(1)}L exp</div>}
                    {c.ai_score && <div style={{ fontSize:11, color: c.ai_match_tag==='STRONG'?'#22C55E':c.ai_match_tag==='PARTIAL'?'#F59E0B':'#EF4444' }}>AI: {c.ai_score}% {c.ai_match_tag === 'STRONG' ? '🟢' : c.ai_match_tag === 'PARTIAL' ? '🟡' : '🔴'}</div>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Candidate Modal */}
      {showAddCandidate && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', overflowY:'auto' }}>
          <div style={{ background:'#1E293B', borderRadius:12, padding:24, width:520, border:'1px solid rgba(255,255,255,0.1)', margin:'20px auto' }}>
            <div style={{ fontSize:15, fontWeight:600, marginBottom:16 }}>Add Candidate</div>
            <div style={{ ...S.grid2, marginBottom:10 }}>
              <div><label style={S.label}>Full Name *</label><input style={S.input} value={form.full_name} onChange={e => setForm(f => ({...f, full_name:e.target.value}))} placeholder='Candidate ka naam' /></div>
              <div><label style={S.label}>Mobile *</label><input style={S.input} value={form.mobile} onChange={e => setForm(f => ({...f, mobile:e.target.value}))} placeholder='10-digit mobile' /></div>
            </div>
            <div style={{ ...S.grid2, marginBottom:10 }}>
              <div><label style={S.label}>Email</label><input style={S.input} value={form.email} onChange={e => setForm(f => ({...f, email:e.target.value}))} placeholder='email@example.com' /></div>
              <div><label style={S.label}>Source</label>
                <select style={S.select} value={form.source} onChange={e => setForm(f => ({...f, source:e.target.value}))}>
                  {['Direct','Naukri','LinkedIn','Referral','Campus','WhatsApp','Other'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...S.grid2, marginBottom:10 }}>
              <div><label style={S.label}>Current Company</label><input style={S.input} value={form.current_company} onChange={e => setForm(f => ({...f, current_company:e.target.value}))} /></div>
              <div><label style={S.label}>Experience (Years)</label><input style={S.input} type='number' value={form.experience_years} onChange={e => setForm(f => ({...f, experience_years:e.target.value}))} /></div>
            </div>
            <div style={{ ...S.grid3, marginBottom:10 }}>
              <div><label style={S.label}>Current CTC (₹)</label><input style={S.input} type='number' value={form.current_ctc} onChange={e => setForm(f => ({...f, current_ctc:e.target.value}))} /></div>
              <div><label style={S.label}>Expected CTC (₹)</label><input style={S.input} type='number' value={form.expected_ctc} onChange={e => setForm(f => ({...f, expected_ctc:e.target.value}))} /></div>
              <div><label style={S.label}>Notice Period (Days)</label><input style={S.input} type='number' value={form.notice_period_days} onChange={e => setForm(f => ({...f, notice_period_days:e.target.value}))} /></div>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={S.label}>For MRF</label>
              <select style={S.select} value={form.mrf_id} onChange={e => setForm(f => ({...f, mrf_id:e.target.value}))}>
                <option value=''>Select MRF (optional)</option>
                {mrfs.map((m:any) => <option key={m.id} value={m.id}>{m.designation}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={addCandidate} style={{ ...S.btn, background:'#7C3AED', color:'#fff', flex:1 }}>Add Candidate</button>
              <button onClick={() => setShowAddCandidate(false)} style={{ ...S.btn, background:'rgba(255,255,255,0.05)', color:'#94A3B8' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate Detail Drawer */}
      {selectedCandidate && (
        <CandidateDrawer candidate={selectedCandidate} mrfs={mrfs} onClose={() => setSelectedCandidate(null)}
          onStageChange={moveStage} onSaveNotes={saveNotes}
          onGetQuestions={getAIQuestions} aiQLoading={aiQLoading} aiQuestions={aiQuestions}
          onGetFeedback={getAIFeedback} aiFeedbackLoading={aiFeedbackLoading} />
      )}
    </div>
  )
}

function CandidateDrawer({ candidate, mrfs, onClose, onStageChange, onSaveNotes, onGetQuestions, aiQLoading, aiQuestions, onGetFeedback, aiFeedbackLoading }: any) {
  const [notes, setNotes] = useState(candidate.interview_notes || '')
  const mrf = mrfs.find((m:any) => m.id === candidate.mrf_id)
  return (
    <div style={{ position:'fixed', right:0, top:0, bottom:0, width:460, background:'#0F172A', borderLeft:'1px solid rgba(255,255,255,0.1)', zIndex:200, overflowY:'auto', padding:24 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:17, fontWeight:700 }}>{candidate.full_name}</div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>{candidate.current_company} · {candidate.experience_years}yr · {candidate.mobile}</div>
        </div>
        <button onClick={onClose} style={{ ...S.btn, background:'rgba(255,255,255,0.05)', color:'#94A3B8', padding:'4px 10px' }}>✕</button>
      </div>

      {/* CTC Info */}
      <div style={{ ...S.card, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
        <div><div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>CURRENT CTC</div><div style={{ fontSize:14, fontWeight:600, color:'#A78BFA' }}>{candidate.current_ctc ? '₹' + (candidate.current_ctc/100000).toFixed(1) + 'L' : '-'}</div></div>
        <div><div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>EXPECTED CTC</div><div style={{ fontSize:14, fontWeight:600, color:'#4ADE80' }}>{candidate.expected_ctc ? '₹' + (candidate.expected_ctc/100000).toFixed(1) + 'L' : '-'}</div></div>
        <div><div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>NOTICE PERIOD</div><div style={{ fontSize:14, fontWeight:600 }}>{candidate.notice_period_days ? candidate.notice_period_days + ' days' : '-'}</div></div>
        <div><div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>AI SCORE</div><div style={{ fontSize:14, fontWeight:600, color: candidate.ai_match_tag==='STRONG'?'#22C55E':candidate.ai_match_tag==='PARTIAL'?'#F59E0B':'#EF4444' }}>{candidate.ai_score ? candidate.ai_score + '%' : '-'}</div></div>
      </div>

      {/* Stage Change */}
      <div style={{ marginBottom:16 }}>
        <label style={S.label}>Move to Stage</label>
        <div style={{ display:'flex', flexWrap:'wrap' as const, gap:6 }}>
          {STAGES.map(s => (
            <button key={s} onClick={() => onStageChange(candidate.id, s)}
              style={{ ...S.btn, fontSize:11, padding:'5px 10px', background: candidate.stage === s ? STAGE_COLORS[s] + '30' : 'rgba(255,255,255,0.05)', color: candidate.stage === s ? STAGE_COLORS[s] : '#94A3B8', border: candidate.stage === s ? `1px solid ${STAGE_COLORS[s]}` : '1px solid transparent' }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Interview Questions */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <label style={{ ...S.label, marginBottom:0 }}>Interview Questions</label>
          <button onClick={() => onGetQuestions(candidate)} disabled={aiQLoading}
            style={{ ...S.btn, background:'rgba(124,58,237,0.2)', color:'#A78BFA', fontSize:11, padding:'4px 10px' }}>
            {aiQLoading ? '⏳...' : '🤖 AI Questions Generate'}
          </button>
        </div>
        {(aiQuestions.length > 0 ? aiQuestions : candidate.ai_questions || []).map((q: string, i: number) => (
          <div key={i} style={{ background:'rgba(124,58,237,0.08)', borderRadius:7, padding:'7px 10px', marginBottom:6, fontSize:12, color:'#E2E8F0' }}>
            <span style={{ color:'#A78BFA', marginRight:6 }}>{i+1}.</span>{q}
          </div>
        ))}
      </div>

      {/* Interview Notes */}
      <div style={{ marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <label style={{ ...S.label, marginBottom:0 }}>Interview Notes</label>
          <button onClick={() => onGetFeedback({...candidate, interview_notes: notes})} disabled={aiFeedbackLoading}
            style={{ ...S.btn, background:'rgba(34,197,94,0.15)', color:'#86EFAC', fontSize:11, padding:'4px 10px' }}>
            {aiFeedbackLoading ? '⏳...' : '🤖 AI Feedback Generate'}
          </button>
        </div>
        <textarea style={{ ...S.textarea, minHeight:140 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder='Interview ke notes likhein...' />
        <button onClick={() => onSaveNotes(candidate.id, notes)} style={{ ...S.btn, background:'#7C3AED', color:'#fff', marginTop:6 }}>Save Notes</button>
      </div>
    </div>
  )
}

// ── AI SCREENING TAB ───────────────────────────────────────────
function ScreeningTab({ supabase, mrfs, candidates, onRefresh }: any) {
  const [selectedMRF, setSelectedMRF] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [screening, setScreening] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  async function extractTextFromFile(file: File): Promise<string> {
    // Simple text extraction for txt/csv; for PDF/docx returns filename as placeholder
    if (file.type === 'text/plain') {
      return await file.text()
    }
    // For PDF/Word: return file name + size as basic info (full extraction needs server-side)
    return `Resume: ${file.name}, Size: ${(file.size/1024).toFixed(0)}KB, Type: ${file.type}`
  }

  async function runScreening() {
    if (!selectedMRF) { alert('Pehle MRF select karo'); return }
    if (files.length === 0) { alert('Resumes upload karo pehle'); return }
    const mrf = mrfs.find((m:any) => m.id === selectedMRF)
    if (!mrf?.job_description) { alert('Selected MRF mein JD nahi hai'); return }

    setScreening(true); setResults([]); setProgress(0)
    const newResults: any[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const resumeText = await extractTextFromFile(file)
      setProgress(Math.round(((i+1)/files.length)*100))

      try {
        const res = await fetch('/api/recruitment/screen-resumes', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ resume_text: resumeText, jd_text: mrf.job_description, candidate_name: file.name.replace(/\.[^.]+$/, '') })
        })
        const result = await res.json()
        newResults.push({ ...result, file_name: file.name })
        setResults([...newResults])
      } catch {
        newResults.push({ candidate_name: file.name, score: 0, match_tag: 'NOT_SUITABLE', reasoning: 'Error processing', file_name: file.name })
        setResults([...newResults])
      }
    }
    setScreening(false)
  }

  function downloadExcel() {
    const data = results.map(r => ({
      'Candidate Name': r.candidate_name,
      'File': r.file_name,
      'Score (%)': r.score,
      'Match': r.match_tag,
      'AI Reasoning': r.reasoning,
      'Q1': r.interview_questions?.[0] || '',
      'Q2': r.interview_questions?.[1] || '',
      'Q3': r.interview_questions?.[2] || '',
      'Q4': r.interview_questions?.[3] || '',
      'Q5': r.interview_questions?.[4] || '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Screening Results')
    XLSX.writeFile(wb, 'AI_Screening_Results.xlsx')
  }

  const strong = results.filter(r => r.match_tag === 'STRONG')
  const partial = results.filter(r => r.match_tag === 'PARTIAL')
  const notSuitable = results.filter(r => r.match_tag === 'NOT_SUITABLE')

  return (
    <div>
      <div style={{ ...S.card }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:16, color:'#A78BFA' }}>🤖 AI Resume Screening</div>
        <div style={{ ...S.grid2, marginBottom:14 }}>
          <div>
            <label style={S.label}>Select Job Opening (MRF) *</label>
            <select style={S.select} value={selectedMRF} onChange={e => setSelectedMRF(e.target.value)}>
              <option value=''>Select MRF with JD</option>
              {mrfs.filter((m:any) => m.job_description).map((m:any) => (
                <option key={m.id} value={m.id}>{m.designation} ({m.no_of_openings} openings)</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.label}>Upload Resumes (PDF/Word/TXT — 200-500 files)</label>
            <input ref={fileRef} type='file' multiple accept='.pdf,.doc,.docx,.txt,.csv' onChange={e => setFiles(Array.from(e.target.files || []))} style={{ display:'none' }} />
            <button onClick={() => fileRef.current?.click()} style={{ ...S.btn, background:'rgba(255,255,255,0.08)', color:'#fff', width:'100%' }}>
              📂 {files.length > 0 ? `${files.length} files selected` : 'Choose Files'}
            </button>
          </div>
        </div>
        <button onClick={runScreening} disabled={screening || !selectedMRF || files.length === 0}
          style={{ ...S.btn, background: screening ? 'rgba(124,58,237,0.4)' : '#7C3AED', color:'#fff', padding:'10px 24px' }}>
          {screening ? `⏳ Screening... ${progress}% (${results.length}/${files.length})` : '🚀 Start AI Screening'}
        </button>
        {screening && (
          <div style={{ marginTop:12 }}>
            <div style={{ background:'rgba(255,255,255,0.05)', borderRadius:99, height:6, overflow:'hidden' }}>
              <div style={{ background:'#7C3AED', height:'100%', width:`${progress}%`, transition:'width .3s', borderRadius:99 }} />
            </div>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ display:'flex', gap:12, fontSize:13 }}>
              <span style={{ color:'#22C55E' }}>🟢 Strong: {strong.length}</span>
              <span style={{ color:'#F59E0B' }}>🟡 Partial: {partial.length}</span>
              <span style={{ color:'#EF4444' }}>🔴 Not Suitable: {notSuitable.length}</span>
            </div>
            <button onClick={downloadExcel} style={{ ...S.btn, background:'#22C55E', color:'#fff' }}>📥 Download Excel</button>
          </div>

          {[...strong, ...partial, ...notSuitable].map((r, i) => (
            <div key={i} style={{ ...S.card, display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ width:50, height:50, borderRadius:99, background: r.match_tag==='STRONG'?'rgba(34,197,94,0.15)':r.match_tag==='PARTIAL'?'rgba(245,158,11,0.15)':'rgba(239,68,68,0.15)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:18, fontWeight:700, color: r.match_tag==='STRONG'?'#22C55E':r.match_tag==='PARTIAL'?'#F59E0B':'#EF4444' }}>
                {r.score}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                  <span style={{ fontSize:14, fontWeight:600 }}>{r.candidate_name}</span>
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:99, background: r.match_tag==='STRONG'?'rgba(34,197,94,0.15)':r.match_tag==='PARTIAL'?'rgba(245,158,11,0.15)':'rgba(239,68,68,0.15)', color: r.match_tag==='STRONG'?'#22C55E':r.match_tag==='PARTIAL'?'#F59E0B':'#EF4444' }}>{r.match_tag}</span>
                </div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginBottom:6 }}>{r.reasoning}</div>
                {r.interview_questions?.length > 0 && (
                  <details>
                    <summary style={{ fontSize:11, color:'#A78BFA', cursor:'pointer' }}>View {r.interview_questions.length} Interview Questions</summary>
                    {r.interview_questions.map((q:string, qi:number) => <div key={qi} style={{ fontSize:11, padding:'4px 0', color:'rgba(255,255,255,0.6)', paddingLeft:12 }}>{qi+1}. {q}</div>)}
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── OFFERS TAB ─────────────────────────────────────────────────
function OffersTab({ supabase, candidates, companies, onRefresh }: any) {
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null)
  const [calcForm, setCalcForm] = useState({ ctc:'', variable_pct:'10', current_ctc:'', previous_company:'', doj:'' })
  const [calcResult, setCalcResult] = useState<any>(null)
  const [offerContent, setOfferContent] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  const [saving, setSaving] = useState(false)

  const finalCandidates = candidates.filter((c:any) => ['MD Final','Offer Sent'].includes(c.stage))

  function calculateCTC() {
    const ctc = Number(calcForm.ctc)
    if (!ctc) return
    const varPct = Number(calcForm.variable_pct) / 100
    const variable = ctc * varPct
    const fixed = ctc - variable
    const fixedMonthly = fixed / 12
    const basic = fixedMonthly * 0.5
    const hra = basic * 0.5
    const epfEmployee = Math.min(basic, 15000) * 0.12
    const gross = fixedMonthly
    const net = gross - epfEmployee
    const tdsNewEstimate = Math.max(0, (ctc - 75000) * 0.1 / 12)
    const currentCtc = Number(calcForm.current_ctc)
    const hike = currentCtc ? ((ctc - currentCtc) / currentCtc * 100).toFixed(1) : null
    setCalcResult({ ctc, variable: variable/12, fixedMonthly, basic, hra, epfEmployee, net, tdsNewEstimate, hike })
  }

  async function saveCtcAndCreateOffer() {
    if (!selectedCandidate || !calcResult) return
    setSaving(true)
    const co = companies.find((c:any) => c.id === selectedCandidate.company_id)
    const { data: neg } = await supabase.from('ctc_negotiations').insert({
      candidate_id: selectedCandidate.id, company_id: selectedCandidate.company_id,
      offered_ctc: calcForm.ctc, variable_pct: calcForm.variable_pct,
      basic_monthly: calcResult.basic, hra_monthly: calcResult.hra,
      epf_monthly: calcResult.epfEmployee, net_monthly: calcResult.net,
      tds_new_regime: calcResult.tdsNewEstimate, current_ctc: calcForm.current_ctc,
      hike_pct: calcResult.hike, previous_company: calcForm.previous_company
    }).select()
    // Auto-generate offer letter content
    const letterContent = generateOfferLetter(selectedCandidate, calcResult, calcForm, co?.company_code || 'Company')
    setOfferContent(letterContent)
    setToEmail(selectedCandidate.email || '')
    setSaving(false)
  }

  function generateOfferLetter(cand: any, calc: any, form: any, companyName: string) {
    return `Dear ${cand.full_name},

We are pleased to offer you the position of ${cand.designation} at ${companyName}.

OFFER DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CTC (Annual):              ₹${(Number(form.ctc)/100000).toFixed(2)} Lakhs
Fixed Component:           ₹${((Number(form.ctc) * (1 - Number(form.variable_pct)/100))/100000).toFixed(2)} Lakhs
Variable Component (${form.variable_pct}%): ₹${(Number(form.ctc) * Number(form.variable_pct)/100/100000).toFixed(2)} Lakhs

Monthly Breakdown:
  Basic:                   ₹${Math.round(calc.basic).toLocaleString('en-IN')}
  HRA:                     ₹${Math.round(calc.hra).toLocaleString('en-IN')}
  EPF (Employee):          ₹${Math.round(calc.epfEmployee).toLocaleString('en-IN')}
  Net Take-Home (approx):  ₹${Math.round(calc.net).toLocaleString('en-IN')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proposed Date of Joining: ${form.doj || 'To be mutually agreed'}

This offer is subject to:
1. Satisfactory completion of background verification
2. Submission of all required documents
3. Medical fitness certification

Please confirm your acceptance by replying to this email or clicking the acceptance link.

We look forward to welcoming you to the team.

With regards,
HR Team | ${companyName}`
  }

  async function sendOffer() {
    if (!selectedCandidate || !toEmail || !offerContent) { alert('Email aur offer content zaroori hai'); return }
    const { error } = await supabase.from('offer_letters').insert({
      candidate_id: selectedCandidate.id, company_id: selectedCandidate.company_id,
      letter_content: offerContent, to_email: toEmail,
      cc_emails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
      status: 'SENT', sent_at: new Date().toISOString()
    })
    if (!error) {
      await supabase.from('candidates').update({ stage: 'Offer Sent' }).eq('id', selectedCandidate.id)
      onRefresh(); alert('Offer saved! Email integration ke baad auto-send hoga.')
    }
  }

  return (
    <div style={{ ...S.grid2, alignItems:'start' as const }}>
      {/* Candidate list */}
      <div>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>MD Final + Offer Stage ({finalCandidates.length})</div>
        {finalCandidates.map((c:any) => (
          <div key={c.id} onClick={() => { setSelectedCandidate(c); setCalcForm(f => ({...f, current_ctc: c.current_ctc?.toString() || ''})) }}
            style={{ ...S.card, cursor:'pointer', border: selectedCandidate?.id === c.id ? '1px solid #7C3AED' : '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize:14, fontWeight:600 }}>{c.full_name}</div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', marginTop:3 }}>{c.current_company} · ₹{c.expected_ctc ? (c.expected_ctc/100000).toFixed(1) + 'L exp' : 'CTC not set'}</div>
            <div style={{ marginTop:6 }}><StatusBadge status={c.stage} /></div>
          </div>
        ))}
        {finalCandidates.length === 0 && <div style={{ color:'rgba(255,255,255,0.3)', fontSize:13 }}>Koi candidate MD Final ya Offer stage mein nahi hai</div>}
      </div>

      {/* CTC Calculator + Offer */}
      {selectedCandidate && (
        <div>
          <div style={{ ...S.card, border:'1px solid rgba(124,58,237,0.3)' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#A78BFA', marginBottom:12 }}>💰 CTC Calculator — {selectedCandidate.full_name}</div>
            <div style={{ ...S.grid2, marginBottom:10 }}>
              <div><label style={S.label}>Offered CTC (₹ Annual) *</label><input style={S.input} type='number' value={calcForm.ctc} onChange={e => setCalcForm(f => ({...f, ctc:e.target.value}))} placeholder='e.g. 1200000' /></div>
              <div><label style={S.label}>Variable % (default 10%)</label><input style={S.input} type='number' value={calcForm.variable_pct} onChange={e => setCalcForm(f => ({...f, variable_pct:e.target.value}))} /></div>
            </div>
            <div style={{ ...S.grid2, marginBottom:10 }}>
              <div><label style={S.label}>Current CTC (₹)</label><input style={S.input} type='number' value={calcForm.current_ctc} onChange={e => setCalcForm(f => ({...f, current_ctc:e.target.value}))} /></div>
              <div><label style={S.label}>Previous Company</label><input style={S.input} value={calcForm.previous_company} onChange={e => setCalcForm(f => ({...f, previous_company:e.target.value}))} /></div>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={S.label}>Date of Joining</label>
              <input style={S.input} type='date' value={calcForm.doj} onChange={e => setCalcForm(f => ({...f, doj:e.target.value}))} />
            </div>
            <button onClick={calculateCTC} style={{ ...S.btn, background:'#7C3AED', color:'#fff', marginBottom:12 }}>Calculate →</button>

            {calcResult && (
              <div style={{ background:'rgba(124,58,237,0.08)', borderRadius:8, padding:14, marginBottom:12 }}>
                {[
                  ['Basic (Monthly)', calcResult.basic],['HRA (Monthly)', calcResult.hra],
                  ['Variable (Monthly)', calcResult.variable],['EPF Deduction', calcResult.epfEmployee],
                  ['Est. Net Take-Home', calcResult.net],['Est. TDS (New Regime)', calcResult.tdsNewEstimate],
                ].map(([l, v]) => (
                  <div key={l as string} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:12 }}>
                    <span style={{ color:'rgba(255,255,255,0.5)' }}>{l}</span>
                    <span style={{ fontWeight:500 }}>₹{Math.round(v as number).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {calcResult.hike && <div style={{ marginTop:8, fontSize:13, color:'#4ADE80', fontWeight:600 }}>Hike: {calcResult.hike}%</div>}
                <button onClick={saveCtcAndCreateOffer} disabled={saving} style={{ ...S.btn, background:'#22C55E', color:'#fff', width:'100%', marginTop:10 }}>
                  {saving ? 'Saving...' : 'Generate Offer Letter'}
                </button>
              </div>
            )}
          </div>

          {offerContent && (
            <div style={{ ...S.card }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>📄 Offer Letter</div>
              <div><label style={S.label}>To Email</label><input style={{ ...S.input, marginBottom:8 }} value={toEmail} onChange={e => setToEmail(e.target.value)} /></div>
              <div><label style={S.label}>CC Emails (comma separated)</label><input style={{ ...S.input, marginBottom:8 }} value={ccEmails} onChange={e => setCcEmails(e.target.value)} placeholder='hr@company.com, md@company.com' /></div>
              <label style={S.label}>Offer Content (Edit if needed)</label>
              <textarea style={{ ...S.textarea, minHeight:300, fontFamily:'monospace', fontSize:12 }} value={offerContent} onChange={e => setOfferContent(e.target.value)} />
              <button onClick={sendOffer} style={{ ...S.btn, background:'#7C3AED', color:'#fff', width:'100%', marginTop:10 }}>📤 Send Offer Letter</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PRE-ONBOARDING TAB ─────────────────────────────────────────
function PreonboardingTab({ supabase, candidates, onRefresh }: any) {
  const [loading, setLoading] = useState(false)
  const [links, setLinks] = useState<any[]>([])
  const offeredCandidates = candidates.filter((c:any) => ['Offer Sent','Joined'].includes(c.stage))

  useEffect(() => { loadLinks() }, [])
  async function loadLinks() {
    const { data } = await supabase.from('preonboarding_links').select('*, candidates(full_name, email, mobile, stage)').order('created_at', { ascending:false })
    setLinks(data || [])
  }

  async function createLink(candidate_id: string, doj: string) {
    setLoading(true)
    const { data, error } = await supabase.from('preonboarding_links').insert({
      candidate_id, company_id: candidates.find((c:any) => c.id === candidate_id)?.company_id,
      doj: doj || null, status:'CREATED', sent_at: new Date().toISOString()
    }).select()
    if (!error) {
      await supabase.from('candidates').update({ doj }).eq('id', candidate_id)
      loadLinks(); onRefresh()
    }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:12, color:'#A78BFA' }}>🎉 Pre-onboarding Links — Candidates with Offer Sent</div>

      {/* Create link for offered candidates */}
      {offeredCandidates.filter((c:any) => !links.find((l:any) => l.candidate_id === c.id)).map((c:any) => (
        <CreateLinkCard key={c.id} candidate={c} onCreate={createLink} loading={loading} />
      ))}

      {/* Existing links */}
      {links.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Sent Links ({links.length})</div>
          {links.map((l:any) => (
            <div key={l.id} style={{ ...S.card }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'start' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{l.candidates?.full_name}</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', marginTop:2 }}>DOJ: {l.doj || 'Not set'} · {l.candidates?.mobile}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', marginTop:3, fontFamily:'monospace' }}>Token: {l.link_token}</div>
                </div>
                <div style={{ textAlign:'right' as const }}>
                  <StatusBadge status={l.status} />
                  {l.status === 'CREATED' || l.status === 'SENT' ? (
                    <div style={{ fontSize:11, color:'#FCD34D', marginTop:4 }}>
                      ⚠️ {l.sent_at && Math.floor((Date.now() - new Date(l.sent_at).getTime()) / 86400000)} days ago sent
                      {!l.opened_at && Math.floor((Date.now() - new Date(l.sent_at).getTime()) / 86400000) >= 2 && <span style={{ color:'#FCA5A5', display:'block' }}>🚨 Backout Risk! 2+ days no open</span>}
                    </div>
                  ) : null}
                </div>
              </div>
              {l.submitted_at && (
                <div style={{ marginTop:10, background:'rgba(34,197,94,0.08)', borderRadius:7, padding:10 }}>
                  <div style={{ fontSize:12, color:'#86EFAC', fontWeight:500 }}>✅ Form Submitted — Code generation ready</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:3 }}>Submitted: {new Date(l.submitted_at).toLocaleDateString('en-IN')}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateLinkCard({ candidate, onCreate, loading }: any) {
  const [doj, setDoj] = useState('')
  return (
    <div style={{ ...S.card, border:'1px solid rgba(255,183,7,0.2)', background:'rgba(255,183,7,0.03)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>{candidate.full_name}</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{candidate.mobile} · Offer Sent</div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div>
            <input type='date' value={doj} onChange={e => setDoj(e.target.value)} style={{ ...S.input, width:160, fontSize:12 }} placeholder='Date of Joining' />
          </div>
          <button onClick={() => onCreate(candidate.id, doj)} disabled={loading}
            style={{ ...S.btn, background:'#F59E0B', color:'#0F172A', fontWeight:600 }}>
            🔗 Create Pre-onboarding Link
          </button>
        </div>
      </div>
    </div>
  )
}

// ── HELPER COMPONENTS ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, [string, string]> = {
    'DRAFT': ['rgba(148,163,184,0.15)', '#94A3B8'],
    'SUBMITTED': ['rgba(59,130,246,0.15)', '#93C5FD'],
    'APPROVED': ['rgba(34,197,94,0.15)', '#86EFAC'],
    'REJECTED': ['rgba(239,68,68,0.15)', '#FCA5A5'],
    'CLOSED': ['rgba(148,163,184,0.1)', '#64748B'],
    'Offer Sent': ['rgba(20,184,166,0.15)', '#5EEAD4'],
    'Joined': ['rgba(34,197,94,0.2)', '#4ADE80'],
    'Applied': ['rgba(59,130,246,0.15)', '#93C5FD'],
    'CREATED': ['rgba(245,158,11,0.15)', '#FCD34D'],
    'SENT': ['rgba(59,130,246,0.15)', '#93C5FD'],
    'OPENED': ['rgba(124,58,237,0.15)', '#A78BFA'],
    'SUBMITTED': ['rgba(34,197,94,0.15)', '#86EFAC'],
  }
  const [bg, color] = configs[status] || ['rgba(148,163,184,0.1)', '#94A3B8']
  return <span style={{ fontSize:11, padding:'2px 9px', borderRadius:99, background:bg, color, fontWeight:500 }}>{status}</span>
}