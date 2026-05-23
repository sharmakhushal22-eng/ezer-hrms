'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  getMRFs, createMRF, updateMRFStatus,
  getJobOpenings, createJobOpening, updateJobStatus,
  getCandidates, addCandidate, updateCandidateStage, checkDuplicate,
  getRecruitmentStats, getPipelineCounts,
  getCompanies, getLocations, getDepartments,
} from '../../../lib/supabase-recruitment'

// ── Types ─────────────────────────────────────────────────────────
type MainTab = 'dashboard' | 'mrf' | 'jobs' | 'pipeline' | 'interviews' | 'offers' | 'ai' | 'analytics'
type MRFTab = 'full' | 'quick'
type CandidateStage = 'Applied'|'AI Screened'|'Telephonic'|'L1 Interview'|'L2 Interview'|'Optional'|'MD Final'|'Offer Sent'|'Joined'|'Rejected'

// ── Styles ────────────────────────────────────────────────────────
const C = {
  page: { display:'flex' as const, flexDirection:'column' as const, minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  topbar: { background:'#fff', padding:'11px 20px', borderBottom:'1px solid #E2E8F0', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const },
  nav: { background:'#fff', borderBottom:'1px solid #E2E8F0', padding:'0 20px', display:'flex' as const, overflowX:'auto' as const },
  navBtn: (a:boolean) => ({ padding:'12px 16px', border:'none', background:'transparent', cursor:'pointer', fontSize:'13px', fontWeight:a?600:400, color:a?'#7C3AED':'#64748B', borderBottom:a?'2px solid #7C3AED':'2px solid transparent', whiteSpace:'nowrap' as const }),
  body: { flex:1, padding:'16px 20px', overflowY:'auto' as const },
  card: { background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:'10px' },
  priBtn: { padding:'9px 18px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'9px 14px', background:'#fff', color:'#374151', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' },
  inp: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
  sel: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
  lbl: { fontSize:'11px', fontWeight:500 as const, color:'#374151', display:'block' as const, marginBottom:'4px' },
}

const STAGE_COLORS: Record<string,{bg:string;color:string}> = {
  'Applied':      {bg:'#F1F5F9',color:'#374151'},
  'AI Screened':  {bg:'#EDE9FE',color:'#7C3AED'},
  'Telephonic':   {bg:'#DBEAFE',color:'#1D4ED8'},
  'L1 Interview': {bg:'#CCFBF1',color:'#0D9488'},
  'L2 Interview': {bg:'#FEF3C7',color:'#D97706'},
  'Optional':     {bg:'#FEE2E2',color:'#DC2626'},
  'MD Final':     {bg:'#F5F3FF',color:'#9333EA'},
  'Offer Sent':   {bg:'#DCFCE7',color:'#16A34A'},
  'Joined':       {bg:'#BBF7D0',color:'#059669'},
  'Rejected':     {bg:'#FEE2E2',color:'#DC2626'},
}

const AI_COLORS: Record<string,{bg:string;color:string}> = {
  'Strong Match':  {bg:'#DCFCE7',color:'#16A34A'},
  'Partial Match': {bg:'#FEF3C7',color:'#D97706'},
  'Not Suitable':  {bg:'#FEE2E2',color:'#DC2626'},
}

const STATUS_COLORS: Record<string,{bg:string;color:string}> = {
  'Draft':     {bg:'#F1F5F9',color:'#374151'},
  'Submitted': {bg:'#DBEAFE',color:'#1D4ED8'},
  'HR Review': {bg:'#FEF3C7',color:'#D97706'},
  'Approved':  {bg:'#DCFCE7',color:'#16A34A'},
  'Rejected':  {bg:'#FEE2E2',color:'#DC2626'},
  'On Hold':   {bg:'#F1F5F9',color:'#64748B'},
  'Open':      {bg:'#DCFCE7',color:'#16A34A'},
  'Closed':    {bg:'#FEE2E2',color:'#DC2626'},
}

const PIPELINE_STAGES: CandidateStage[] = ['Applied','AI Screened','Telephonic','L1 Interview','L2 Interview','Optional','MD Final','Offer Sent','Joined','Rejected']

// ── Stat Card ─────────────────────────────────────────────────────
const StatCard = ({label,value,color,sub}:{label:string;value:any;color:string;sub?:string}) => (
  <div style={{background:'#fff',border:'1px solid #E2E8F0',borderRadius:'10px',padding:'12px 14px',borderTop:`3px solid ${color}`}}>
    <div style={{fontSize:'10px',color:'#94A3B8',fontWeight:500,textTransform:'uppercase' as const,letterSpacing:'.05em',marginBottom:'3px'}}>{label}</div>
    <div style={{fontSize:'24px',fontWeight:700,color}}>{value}</div>
    {sub && <div style={{fontSize:'10px',color:'#94A3B8',marginTop:'2px'}}>{sub}</div>}
  </div>
)

// ── Loading Spinner ───────────────────────────────────────────────
const Spinner = () => (
  <div style={{display:'flex',justifyContent:'center',padding:'40px',color:'#94A3B8',fontSize:'13px'}}>
    ⏳ Loading...
  </div>
)

// ── Main Component ────────────────────────────────────────────────
export default function RecruitmentModule() {
  const [tab, setTab] = useState<MainTab>('dashboard')
  const [mrfTab, setMrfTab] = useState<MRFTab>('full')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Data states
  const [stats, setStats] = useState<any>({})
  const [pipelineCounts, setPipelineCounts] = useState<Record<string,number>>({})
  const [mrfs, setMrfs] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [candidates, setCandidates] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])

  // Modal states
  const [showMRFForm, setShowMRFForm] = useState(false)
  const [showQuickForm, setShowQuickForm] = useState(false)
  const [showJobForm, setShowJobForm] = useState(false)
  const [showCandidateForm, setShowCandidateForm] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null)
  const [selectedJobId, setSelectedJobId] = useState('')

  // Form states — MRF
  const [mrf, setMrf] = useState({
    company_id:'', position:'', department_id:'', location_id:'',
    openings:1, urgency:'Normal', reason:'New Position', remarks:''
  })
  // Form states — Quick Hire
  const [qh, setQh] = useState({
    company_id:'', position_type:'Helper / Unskilled Worker (W1)',
    location_id:'', openings:1, joining_date:'', reason:'New Requirement'
  })
  // Form states — Job Opening
  const [job, setJob] = useState({
    company_id:'', mrf_id:'', job_title:'', department_id:'',
    location_id:'', exp_min:0, exp_max:5, sal_min:600000, sal_max:1000000,
    employment_type:'Permanent', skills:'', jd_text:'', openings_count:1
  })
  // Form states — Candidate
  const [cand, setCand] = useState({
    job_id:'', company_id:'', full_name:'', email:'', phone:'',
    source:'Naukri', current_company:'', current_ctc:0,
    expected_ctc:0, notice_period:30, experience_years:0
  })

  // ── Load Data ─────────────────────────────────────────────────
  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([getRecruitmentStats(), getPipelineCounts()])
      setStats(s); setPipelineCounts(p)
    } catch(e) { setError('Dashboard load failed') }
    finally { setLoading(false) }
  }, [])

  const loadMRFs = useCallback(async () => {
    setLoading(true)
    try { setMrfs(await getMRFs()) }
    catch(e) { setError('MRF load failed') }
    finally { setLoading(false) }
  }, [])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try { setJobs(await getJobOpenings()) }
    catch(e) { setError('Jobs load failed') }
    finally { setLoading(false) }
  }, [])

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    try { setCandidates(await getCandidates()) }
    catch(e) { setError('Candidates load failed') }
    finally { setLoading(false) }
  }, [])

  const loadMeta = useCallback(async () => {
    try {
      const [co, lo, de] = await Promise.all([getCompanies(), getLocations(), getDepartments()])
      setCompanies(co || []); setLocations(lo || []); setDepartments(de || [])
    } catch(e) {}
  }, [])

  useEffect(() => { loadMeta() }, [])
  useEffect(() => {
    if(tab==='dashboard') loadDashboard()
    if(tab==='mrf') loadMRFs()
    if(tab==='jobs') loadJobs()
    if(tab==='pipeline') loadCandidates()
  }, [tab])

  // ── Save MRF ─────────────────────────────────────────────────
  const saveMRF = async () => {
    if(!mrf.company_id || !mrf.position) { setError('Company aur Position required hai'); return }
    setSaving(true); setError('')
    try {
      await createMRF({
        company_id: mrf.company_id, position: mrf.position,
        department_id: mrf.department_id || undefined,
        location_id: mrf.location_id || undefined,
        openings: mrf.openings, urgency: mrf.urgency,
        reason: mrf.reason, remarks: mrf.remarks
      })
      setShowMRFForm(false)
      setMrf({company_id:'',position:'',department_id:'',location_id:'',openings:1,urgency:'Normal',reason:'New Position',remarks:''})
      loadMRFs()
    } catch(e:any) { setError(e.message || 'MRF save failed') }
    finally { setSaving(false) }
  }

  // ── Save Quick Hire ───────────────────────────────────────────
  const saveQuickHire = async () => {
    if(!qh.company_id || !qh.location_id) { setError('Company aur Location required'); return }
    setSaving(true); setError('')
    try {
      await createMRF({
        company_id: qh.company_id, position: qh.position_type,
        location_id: qh.location_id, openings: qh.openings,
        urgency: 'Immediate', reason: qh.reason,
        remarks: `Quick Hire · Joining: ${qh.joining_date}`
      }, true)
      setShowQuickForm(false)
      setQh({company_id:'',position_type:'Helper / Unskilled Worker (W1)',location_id:'',openings:1,joining_date:'',reason:'New Requirement'})
      loadMRFs()
    } catch(e:any) { setError(e.message || 'Quick Hire save failed') }
    finally { setSaving(false) }
  }

  // ── Save Job Opening ──────────────────────────────────────────
  const saveJob = async () => {
    if(!job.company_id || !job.job_title) { setError('Company aur Job Title required'); return }
    setSaving(true); setError('')
    try {
      await createJobOpening({
        company_id: job.company_id, mrf_id: job.mrf_id || undefined,
        job_title: job.job_title,
        department_id: job.department_id || undefined,
        location_id: job.location_id || undefined,
        experience_min: job.exp_min, experience_max: job.exp_max,
        salary_min: job.sal_min, salary_max: job.sal_max,
        employment_type: job.employment_type,
        skills_required: job.skills.split(',').map(s=>s.trim()).filter(Boolean),
        jd_text: job.jd_text, openings_count: job.openings_count
      })
      setShowJobForm(false)
      setJob({company_id:'',mrf_id:'',job_title:'',department_id:'',location_id:'',exp_min:0,exp_max:5,sal_min:600000,sal_max:1000000,employment_type:'Permanent',skills:'',jd_text:'',openings_count:1})
      loadJobs()
    } catch(e:any) { setError(e.message || 'Job save failed') }
    finally { setSaving(false) }
  }

  // ── Add Candidate ─────────────────────────────────────────────
  const saveCandidate = async () => {
    if(!cand.full_name || !cand.phone || !cand.job_id) { setError('Name, Phone aur Job required'); return }
    setSaving(true); setError('')
    try {
      // Duplicate check
      const dups = await checkDuplicate(cand.phone, cand.email)
      if(dups.length > 0) {
        if(!confirm(`⚠️ ${cand.phone} ya ${cand.email} pehle se apply kar chuka hai. Phir bhi add karo?`)) { setSaving(false); return }
      }
      await addCandidate({
        job_id: cand.job_id, company_id: cand.company_id,
        full_name: cand.full_name, email: cand.email, phone: cand.phone,
        source: cand.source, current_company: cand.current_company,
        current_ctc: cand.current_ctc, expected_ctc: cand.expected_ctc,
        notice_period: cand.notice_period, experience_years: cand.experience_years
      })
      setShowCandidateForm(false)
      setCand({job_id:'',company_id:'',full_name:'',email:'',phone:'',source:'Naukri',current_company:'',current_ctc:0,expected_ctc:0,notice_period:30,experience_years:0})
      loadCandidates()
    } catch(e:any) { setError(e.message || 'Candidate add failed') }
    finally { setSaving(false) }
  }

  // ── Update Stage ──────────────────────────────────────────────
  const moveStage = async (id:string, stage:string) => {
    try { await updateCandidateStage(id, stage); loadCandidates() }
    catch(e) { setError('Stage update failed') }
  }

  // ── Approve/Reject MRF ────────────────────────────────────────
  const approveMRF = async (id:string, status:string) => {
    try { await updateMRFStatus(id, status); loadMRFs() }
    catch(e) { setError('Status update failed') }
  }

  const tabs = [
    {id:'dashboard',label:'📊 Dashboard'},
    {id:'mrf',label:'📋 Requisitions'},
    {id:'jobs',label:'💼 Job Openings'},
    {id:'pipeline',label:'👥 Pipeline'},
    {id:'interviews',label:'📅 Interviews'},
    {id:'offers',label:'📄 Offers'},
    {id:'ai',label:'🤖 AI Screening'},
    {id:'analytics',label:'📈 Analytics'},
  ]

  // ── Modal Base ────────────────────────────────────────────────
  const Modal = ({title,sub,onClose,children,onSave,saveLabel='Save'}:{title:string;sub?:string;onClose:()=>void;children:any;onSave?:()=>void;saveLabel?:string}) => (
    <div style={{position:'fixed' as const,inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'#fff',borderRadius:'14px',padding:'24px',width:'620px',maxHeight:'88vh',overflowY:'auto' as const,boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'16px'}}>
          <div>
            <div style={{fontSize:'15px',fontWeight:600}}>{title}</div>
            {sub && <div style={{fontSize:'11px',color:'#94A3B8',marginTop:'2px'}}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#94A3B8'}}>✕</button>
        </div>
        {error && <div style={{padding:'8px 12px',background:'#FEE2E2',borderRadius:'8px',fontSize:'12px',color:'#DC2626',marginBottom:'12px'}}>⚠️ {error}</div>}
        {children}
        {onSave && (
          <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
            <button style={{...C.priBtn,flex:1,opacity:saving?0.7:1}} onClick={onSave} disabled={saving}>
              {saving?'Saving...':saveLabel}
            </button>
            <button style={C.secBtn} onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )

  const FldRow = ({children}:{children:any}) => <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>{children}</div>
  const Fld = ({label,req,children}:{label:string;req?:boolean;children:any}) => (
    <div>
      <label style={C.lbl}>{label}{req&&<span style={{color:'#DC2626'}}> *</span>}</label>
      {children}
    </div>
  )
  const SecHead = ({label,color}:{label:string;color:string}) => (
    <div style={{fontSize:'11px',fontWeight:600,color,textTransform:'uppercase' as const,letterSpacing:'.05em',marginBottom:'8px',paddingBottom:'5px',borderBottom:`2px solid ${color}22`}}>{label}</div>
  )

  return (
    <div style={C.page}>

      {/* Topbar */}
      <div style={C.topbar}>
        <div style={{fontSize:'12px',color:'#64748B'}}>
          Sharma Group &nbsp;›&nbsp; <span style={{color:'#7C3AED',fontWeight:500}}>Recruitment</span>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          {tab==='mrf' && <button style={C.secBtn} onClick={()=>{setError('');setShowQuickForm(true)}}>⚡ Quick Hire</button>}
          {tab==='mrf' && <button style={C.priBtn} onClick={()=>{setError('');setShowMRFForm(true)}}>+ New MRF</button>}
          {tab==='jobs' && <button style={C.priBtn} onClick={()=>{setError('');setShowJobForm(true)}}>+ New Job Opening</button>}
          {tab==='pipeline' && <button style={C.priBtn} onClick={()=>{setError('');setShowCandidateForm(true)}}>+ Add Candidate</button>}
        </div>
      </div>

      {/* Sub Nav */}
      <div style={C.nav}>
        {tabs.map(t=>(
          <button key={t.id} style={C.navBtn(tab===t.id)} onClick={()=>setTab(t.id as MainTab)}>{t.label}</button>
        ))}
      </div>

      <div style={C.body}>
        {error && tab!=='mrf' && (
          <div style={{padding:'8px 14px',background:'#FEE2E2',borderRadius:'8px',fontSize:'12px',color:'#DC2626',marginBottom:'12px'}}>⚠️ {error} <button onClick={()=>setError('')} style={{marginLeft:'8px',background:'none',border:'none',cursor:'pointer',color:'#DC2626'}}>✕</button></div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {tab==='dashboard' && (
          <div>
            {loading ? <Spinner/> : (
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginBottom:'14px'}}>
                  <StatCard label="Open Positions" value={stats.openJobs||0} color="#7C3AED"/>
                  <StatCard label="Total Openings" value={stats.totalOpenings||0} color="#1D4ED8"/>
                  <StatCard label="Active Candidates" value={stats.totalCandidates||0} color="#D97706"/>
                  <StatCard label="Offers Sent" value={stats.offers||0} color="#0D9488"/>
                  <StatCard label="Joined This Month" value={stats.joined||0} color="#16A34A"/>
                </div>

                {/* Pipeline Funnel */}
                <div style={C.card}>
                  <div style={{fontSize:'13px',fontWeight:600,marginBottom:'12px'}}>Candidate Pipeline</div>
                  {PIPELINE_STAGES.map(stage=>(
                    <div key={stage} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
                      <div style={{fontSize:'11px',color:'#64748B',width:'110px',flexShrink:0}}>{stage}</div>
                      <div style={{flex:1,background:'#F1F5F9',borderRadius:'4px',height:'22px',overflow:'hidden'}}>
                        {(pipelineCounts[stage]||0)>0 && (
                          <div style={{width:`${Math.min(((pipelineCounts[stage]||0)/Math.max(...Object.values(pipelineCounts),1))*100,100)}%`,background:STAGE_COLORS[stage]?.color||'#7C3AED',height:'100%',borderRadius:'4px',display:'flex',alignItems:'center',paddingLeft:'8px',minWidth:'30px'}}>
                            <span style={{fontSize:'10px',color:'#fff',fontWeight:600}}>{pipelineCounts[stage]||0}</span>
                          </div>
                        )}
                        {(pipelineCounts[stage]||0)===0 && <div style={{padding:'3px 8px',fontSize:'10px',color:'#94A3B8'}}>0</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick links */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                  <div style={C.card}>
                    <div style={{fontSize:'13px',fontWeight:600,marginBottom:'10px'}}>Open MRFs</div>
                    {mrfs.filter(m=>m.status==='Approved').slice(0,4).map((m:any)=>(
                      <div key={m.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #F1F5F9',fontSize:'12px'}}>
                        <span style={{color:'#374151'}}>{m.position}</span>
                        <span style={{color:'#7C3AED',fontSize:'11px'}}>{m.mrf_number}</span>
                      </div>
                    ))}
                    {mrfs.filter(m=>m.status==='Approved').length===0 && <div style={{fontSize:'12px',color:'#94A3B8'}}>No approved MRFs yet</div>}
                  </div>
                  <div style={C.card}>
                    <div style={{fontSize:'13px',fontWeight:600,marginBottom:'10px'}}>Recent Jobs</div>
                    {jobs.slice(0,4).map((j:any)=>(
                      <div key={j.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #F1F5F9',fontSize:'12px'}}>
                        <span style={{color:'#374151'}}>{j.job_title}</span>
                        <span style={{padding:'1px 6px',background:'#DCFCE7',color:'#16A34A',borderRadius:'4px',fontSize:'10px'}}>{j.status}</span>
                      </div>
                    ))}
                    {jobs.length===0 && <div style={{fontSize:'12px',color:'#94A3B8'}}>No job openings yet</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ MRF ═══ */}
        {tab==='mrf' && (
          <div>
            {/* Toggle */}
            <div style={{...C.card,display:'flex',gap:'8px',alignItems:'center',justifyContent:'space-between',marginBottom:'12px'}}>
              <div style={{display:'flex',gap:'6px'}}>
                {[{id:'full',label:'📋 Full MRF'},{id:'quick',label:'⚡ Quick Hire'}].map(t=>(
                  <button key={t.id} onClick={()=>setMrfTab(t.id as MRFTab)} style={{padding:'7px 16px',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:mrfTab===t.id?600:400,background:mrfTab===t.id?'#7C3AED':'#F8FAFC',color:mrfTab===t.id?'#fff':'#64748B'}}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{fontSize:'11px',color:'#94A3B8'}}>
                {mrfTab==='full'?'CTC ≥ ₹6L · MD Approval':'CTC < ₹6L · Site HR Approve · W1/W2/NAPS'}
              </div>
            </div>

            {loading?<Spinner/>:(
              <div style={C.card}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'12px'}}>
                  <div style={{fontSize:'13px',fontWeight:600}}>{mrfTab==='full'?'Manpower Requisitions':'Quick Hire Requests'}</div>
                  <span style={{fontSize:'12px',color:'#64748B'}}>{mrfs.filter(m=>mrfTab==='full'?!m.mrf_number?.startsWith('QH'):m.mrf_number?.startsWith('QH')).length} records</span>
                </div>
                <div style={{overflowX:'auto' as const}}>
                  <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                    <thead>
                      <tr style={{background:'#1E1B4B'}}>
                        {['MRF No.','Position','Location','Count','Urgency','Status','Date','Action'].map(h=>(
                          <th key={h} style={{padding:'9px 10px',color:'#fff',fontWeight:600,textAlign:'left' as const,fontSize:'11px',whiteSpace:'nowrap' as const}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mrfs
                        .filter(m=>mrfTab==='full'?!m.mrf_number?.startsWith('QH'):m.mrf_number?.startsWith('QH'))
                        .map((m:any,i:number)=>(
                        <tr key={m.id} style={{background:i%2===0?'#F8FAFC':'#fff',borderBottom:'1px solid #E2E8F0'}}>
                          <td style={{padding:'9px 10px',color:'#7C3AED',fontWeight:600,fontSize:'11px'}}>{m.mrf_number}</td>
                          <td style={{padding:'9px 10px',fontWeight:500}}>{m.position}</td>
                          <td style={{padding:'9px 10px',color:'#64748B',fontSize:'11px'}}>{m.locations?.location_name||'—'}</td>
                          <td style={{padding:'9px 10px',textAlign:'center' as const,fontWeight:600}}>{m.openings}</td>
                          <td style={{padding:'9px 10px'}}>
                            <span style={{padding:'2px 7px',borderRadius:'5px',fontSize:'10px',background:m.urgency==='Immediate'?'#FEE2E2':m.urgency==='Urgent'?'#FEF3C7':'#F1F5F9',color:m.urgency==='Immediate'?'#DC2626':m.urgency==='Urgent'?'#D97706':'#374151'}}>{m.urgency}</span>
                          </td>
                          <td style={{padding:'9px 10px'}}>
                            <span style={{padding:'2px 8px',borderRadius:'6px',fontSize:'10px',fontWeight:500,...(STATUS_COLORS[m.status]||{bg:'#F1F5F9',color:'#374151'})}}>{m.status}</span>
                          </td>
                          <td style={{padding:'9px 10px',color:'#64748B',fontSize:'11px'}}>{m.created_at?.split('T')[0]}</td>
                          <td style={{padding:'9px 10px'}}>
                            <div style={{display:'flex',gap:'4px'}}>
                              {m.status==='Submitted'&&<button onClick={()=>approveMRF(m.id,'Approved')} style={{padding:'3px 8px',background:'#DCFCE7',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#16A34A'}}>✓ Approve</button>}
                              {m.status==='Submitted'&&<button onClick={()=>approveMRF(m.id,'Rejected')} style={{padding:'3px 8px',background:'#FEE2E2',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#DC2626'}}>✗ Reject</button>}
                              {m.status==='Approved'&&<button onClick={()=>{setJob(j=>({...j,mrf_id:m.id,company_id:m.company_id||'',job_title:m.position}));setShowJobForm(true)}} style={{padding:'3px 8px',background:'#EDE9FE',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#7C3AED'}}>+ Job</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {mrfs.filter(m=>mrfTab==='full'?!m.mrf_number?.startsWith('QH'):m.mrf_number?.startsWith('QH')).length===0&&(
                        <tr><td colSpan={8} style={{padding:'24px',textAlign:'center' as const,color:'#94A3B8',fontSize:'12px'}}>
                          No {mrfTab==='full'?'MRFs':'Quick Hire requests'} yet · Click + New {mrfTab==='full'?'MRF':'Quick Hire'} to create
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ JOB OPENINGS ═══ */}
        {tab==='jobs' && (
          <div>
            {loading?<Spinner/>:(
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'14px'}}>
                  <StatCard label="Open Jobs" value={jobs.filter((j:any)=>j.status==='Open').length} color="#7C3AED"/>
                  <StatCard label="Total Openings" value={jobs.reduce((s:number,j:any)=>s+(j.openings_count||1),0)} color="#1D4ED8"/>
                  <StatCard label="Total Candidates" value={candidates.length} color="#16A34A"/>
                </div>

                {jobs.length===0?(
                  <div style={{...C.card,textAlign:'center' as const,padding:'40px'}}>
                    <div style={{fontSize:'28px',marginBottom:'8px'}}>💼</div>
                    <div style={{fontSize:'14px',fontWeight:500,marginBottom:'4px'}}>No Job Openings Yet</div>
                    <div style={{fontSize:'12px',color:'#94A3B8',marginBottom:'16px'}}>MRF approve hone ke baad Job Opening create karo</div>
                    <button style={C.priBtn} onClick={()=>setShowJobForm(true)}>+ Create Job Opening</button>
                  </div>
                ):(
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'12px'}}>
                    {jobs.map((j:any)=>(
                      <div key={j.id} style={{...C.card,borderTop:'3px solid #7C3AED',cursor:'pointer'}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'8px'}}>
                          <div>
                            <div style={{fontSize:'13px',fontWeight:600}}>{j.job_title}</div>
                            <div style={{fontSize:'11px',color:'#64748B',marginTop:'2px'}}>
                              {j.departments?.dept_name||'—'} · {j.locations?.location_name||'—'}
                            </div>
                          </div>
                          <span style={{padding:'3px 8px',borderRadius:'6px',fontSize:'10px',fontWeight:500,...(STATUS_COLORS[j.status]||{bg:'#F1F5F9',color:'#374151'})}}>{j.status}</span>
                        </div>
                        <div style={{display:'flex',gap:'6px',flexWrap:'wrap' as const,marginBottom:'10px'}}>
                          <span style={{padding:'2px 7px',background:'#EDE9FE',color:'#7C3AED',borderRadius:'5px',fontSize:'10px'}}>{j.companies?.company_code}</span>
                          <span style={{padding:'2px 7px',background:'#F1F5F9',color:'#374151',borderRadius:'5px',fontSize:'10px'}}>{j.experience_min}-{j.experience_max}y</span>
                          <span style={{padding:'2px 7px',background:'#F1F5F9',color:'#374151',borderRadius:'5px',fontSize:'10px'}}>₹{((j.salary_min||0)/100000).toFixed(1)}L-₹{((j.salary_max||0)/100000).toFixed(1)}L</span>
                          <span style={{padding:'2px 7px',background:'#F1F5F9',color:'#374151',borderRadius:'5px',fontSize:'10px'}}>{j.openings_count} openings</span>
                        </div>
                        <div style={{display:'flex',gap:'6px'}}>
                          <button onClick={()=>{setSelectedJobId(j.id);setTab('pipeline')}} style={{flex:1,padding:'7px',background:'#EDE9FE',border:'none',borderRadius:'7px',cursor:'pointer',fontSize:'11px',color:'#7C3AED',fontWeight:500}}>View Pipeline</button>
                          {j.status==='Open'&&<button onClick={()=>updateJobStatus(j.id,'Closed').then(loadJobs)} style={{padding:'7px 12px',background:'#FEE2E2',border:'none',borderRadius:'7px',cursor:'pointer',fontSize:'11px',color:'#DC2626'}}>Close</button>}
                        </div>
                        <div style={{fontSize:'10px',color:'#94A3B8',marginTop:'8px'}}>Posted: {j.posted_date||'—'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ PIPELINE ═══ */}
        {tab==='pipeline' && (
          <div>
            {/* Filter */}
            <div style={{...C.card,display:'flex',gap:'8px',alignItems:'center',marginBottom:'12px'}}>
              <span style={{fontSize:'12px',color:'#64748B',flexShrink:0}}>Job:</span>
              <select style={{...C.sel,flex:1}} value={selectedJobId} onChange={e=>setSelectedJobId(e.target.value)}>
                <option value="">All Jobs</option>
                {jobs.map((j:any)=><option key={j.id} value={j.id}>{j.job_title}</option>)}
              </select>
            </div>

            {loading?<Spinner/>:(
              <div style={{display:'flex',gap:'10px',overflowX:'auto' as const,paddingBottom:'8px'}}>
                {PIPELINE_STAGES.map(stage=>{
                  const sc = candidates.filter((c:any)=>c.stage===stage&&(selectedJobId?c.job_id===selectedJobId:true))
                  const col = STAGE_COLORS[stage]||{bg:'#F1F5F9',color:'#374151'}
                  return (
                    <div key={stage} style={{minWidth:'190px',maxWidth:'190px',flexShrink:0}}>
                      <div style={{padding:'7px 10px',borderRadius:'8px',marginBottom:'8px',background:col.bg,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontSize:'10px',fontWeight:600,color:col.color}}>{stage}</span>
                        <span style={{fontSize:'11px',fontWeight:700,color:col.color,background:'#fff',width:'20px',height:'20px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>{sc.length}</span>
                      </div>
                      {sc.map((c:any)=>(
                        <div key={c.id} onClick={()=>setSelectedCandidate(c)} style={{background:'#fff',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px',marginBottom:'8px',cursor:'pointer',borderLeft:`3px solid ${col.color}`}}>
                          <div style={{fontSize:'12px',fontWeight:600,marginBottom:'2px'}}>{c.full_name}</div>
                          <div style={{fontSize:'10px',color:'#64748B',marginBottom:'5px'}}>{c.current_company||'—'} · {c.experience_years}y</div>
                          {c.ai_tag&&<span style={{padding:'1px 6px',borderRadius:'4px',fontSize:'9px',fontWeight:600,...(AI_COLORS[c.ai_tag]||{bg:'#F1F5F9',color:'#374151'})}}>{c.ai_tag}</span>}
                          {c.ai_score&&<span style={{marginLeft:'4px',fontSize:'10px',fontWeight:700,color:c.ai_score>=75?'#16A34A':c.ai_score>=50?'#D97706':'#DC2626'}}>{c.ai_score}%</span>}
                          <div style={{fontSize:'9px',color:'#94A3B8',marginTop:'4px'}}>{c.source} · ₹{((c.expected_ctc||0)/100000).toFixed(1)}L exp</div>
                        </div>
                      ))}
                      <button style={{width:'100%',padding:'6px',background:'transparent',border:'1px dashed #E2E8F0',borderRadius:'8px',cursor:'pointer',fontSize:'10px',color:'#94A3B8'}}>+ Add</button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Candidate Drawer */}
            {selectedCandidate&&(
              <div style={{position:'fixed' as const,inset:0,background:'rgba(0,0,0,0.3)',zIndex:1000}} onClick={()=>setSelectedCandidate(null)}>
                <div style={{position:'absolute' as const,right:0,top:0,bottom:0,width:'380px',background:'#fff',padding:'20px',overflowY:'auto' as const,boxShadow:'-4px 0 20px rgba(0,0,0,0.1)'}} onClick={e=>e.stopPropagation()}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'14px'}}>
                    <div style={{fontSize:'15px',fontWeight:600}}>{selectedCandidate.full_name}</div>
                    <button onClick={()=>setSelectedCandidate(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#94A3B8'}}>✕</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'14px'}}>
                    {[
                      {l:'Current Company',v:selectedCandidate.current_company||'—'},
                      {l:'Experience',v:`${selectedCandidate.experience_years} years`},
                      {l:'Current CTC',v:`₹${((selectedCandidate.current_ctc||0)/100000).toFixed(1)}L`},
                      {l:'Expected CTC',v:`₹${((selectedCandidate.expected_ctc||0)/100000).toFixed(1)}L`},
                      {l:'Notice Period',v:`${selectedCandidate.notice_period} days`},
                      {l:'Source',v:selectedCandidate.source},
                      {l:'Phone',v:selectedCandidate.phone},
                      {l:'Email',v:selectedCandidate.email||'—'},
                    ].map((f,i)=>(
                      <div key={i} style={{padding:'8px',background:'#F8FAFC',borderRadius:'8px'}}>
                        <div style={{fontSize:'10px',color:'#94A3B8'}}>{f.l}</div>
                        <div style={{fontSize:'12px',fontWeight:500,marginTop:'2px'}}>{f.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:'12px'}}>
                    <label style={C.lbl}>Move to Stage</label>
                    <select style={C.sel} value={selectedCandidate.stage} onChange={e=>{moveStage(selectedCandidate.id,e.target.value);setSelectedCandidate({...selectedCandidate,stage:e.target.value})}}>
                      {PIPELINE_STAGES.map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{display:'flex',flexDirection:'column' as const,gap:'8px'}}>
                    <button style={{...C.priBtn,width:'100%'}}>📅 Schedule Interview</button>
                    <button style={{...C.secBtn,width:'100%'}}>📄 Generate Offer</button>
                    <button onClick={()=>{moveStage(selectedCandidate.id,'Rejected');setSelectedCandidate(null)}} style={{...C.secBtn,color:'#DC2626',borderColor:'#FECACA',width:'100%'}}>❌ Reject</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ INTERVIEWS / OFFERS / AI / ANALYTICS ═══ */}
        {['interviews','offers','ai','analytics'].includes(tab) && (
          <div style={{...C.card,textAlign:'center' as const,padding:'48px'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>
              {tab==='interviews'?'📅':tab==='offers'?'📄':tab==='ai'?'🤖':'📈'}
            </div>
            <div style={{fontSize:'16px',fontWeight:600,marginBottom:'6px',textTransform:'capitalize' as const}}>{tab} Module</div>
            <div style={{fontSize:'13px',color:'#94A3B8',marginBottom:'20px'}}>
              {tab==='interviews'&&'Interview scheduling aur feedback coming soon'}
              {tab==='offers'&&'CTC Calculator aur Offer Letter Generator coming soon'}
              {tab==='ai'&&'Claude API integration — Resume screening coming soon'}
              {tab==='analytics'&&'Source effectiveness aur hiring analytics coming soon'}
            </div>
            <span style={{padding:'6px 16px',background:'#EDE9FE',color:'#7C3AED',borderRadius:'8px',fontSize:'12px',fontWeight:500}}>Under Development</span>
          </div>
        )}

      </div>

      {/* ═══ MODALS ═══ */}

      {/* Full MRF Form */}
      {showMRFForm&&(
        <Modal title="📋 New Manpower Requisition" sub="MRF number auto-generate hoga" onClose={()=>setShowMRFForm(false)} onSave={saveMRF} saveLabel={saving?'Saving...':'Submit for HR Review →'}>
          <SecHead label="A. Position Details" color="#7C3AED"/>
          <FldRow>
            <Fld label="Company" req><select style={C.sel} value={mrf.company_id} onChange={e=>setMrf(m=>({...m,company_id:e.target.value}))}><option value="">Select...</option>{companies.map((c:any)=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></Fld>
            <Fld label="Department"><select style={C.sel} value={mrf.department_id} onChange={e=>setMrf(m=>({...m,department_id:e.target.value}))}><option value="">Select...</option>{departments.map((d:any)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}</select></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Location"><select style={C.sel} value={mrf.location_id} onChange={e=>setMrf(m=>({...m,location_id:e.target.value}))}><option value="">Select...</option>{locations.filter((l:any)=>!mrf.company_id||true).map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}</select></Fld>
            <Fld label="Position Title" req><input style={C.inp} placeholder="e.g. Senior Executive — Accounts" value={mrf.position} onChange={e=>setMrf(m=>({...m,position:e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="No. of Positions" req><input type="number" style={C.inp} min="1" value={mrf.openings} onChange={e=>setMrf(m=>({...m,openings:parseInt(e.target.value)||1}))}/></Fld>
            <Fld label="Urgency" req><select style={C.sel} value={mrf.urgency} onChange={e=>setMrf(m=>({...m,urgency:e.target.value}))}>{['Immediate','Urgent','Normal'].map(u=><option key={u}>{u}</option>)}</select></Fld>
          </FldRow>
          <div style={{marginBottom:'10px'}}>
            <SecHead label="B. Reason" color="#1D4ED8"/>
            <select style={C.sel} value={mrf.reason} onChange={e=>setMrf(m=>({...m,reason:e.target.value}))}>
              {['New Position','Replacement','Expansion','Seasonal'].map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={{marginBottom:'10px'}}>
            <SecHead label="C. Remarks / Justification" color="#16A34A"/>
            <textarea style={{...C.inp,height:'70px',resize:'none' as const}} placeholder="Business justification — why this hire is needed..." value={mrf.remarks} onChange={e=>setMrf(m=>({...m,remarks:e.target.value}))}/>
          </div>
          <div style={{padding:'8px 12px',background:'#EDE9FE',borderRadius:'8px',fontSize:'11px',color:'#7C3AED'}}>
            💜 MD final interview mandatory · CTC MD approve karega
          </div>
        </Modal>
      )}

      {/* Quick Hire Form */}
      {showQuickForm&&(
        <Modal title="⚡ Quick Hire" sub="CTC < ₹6L · Site HR / Plant Head · 5 fields only" onClose={()=>setShowQuickForm(false)} onSave={saveQuickHire} saveLabel="✅ Approve & Create Opening">
          <div style={{padding:'8px 12px',background:'#FEF3C7',borderRadius:'8px',fontSize:'11px',color:'#92400E',marginBottom:'14px'}}>
            ⚡ System auto-check: CTC ceiling · Grade · Location auth · MD notification auto-send
          </div>
          <Fld label="1. Company" req><select style={C.sel} value={qh.company_id} onChange={e=>setQh(q=>({...q,company_id:e.target.value}))}><option value="">Select...</option>{companies.map((c:any)=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></Fld>
          <div style={{marginBottom:'10px'}}/>
          <Fld label="2. Position Type" req><select style={C.sel} value={qh.position_type} onChange={e=>setQh(q=>({...q,position_type:e.target.value}))}>{['Helper / Unskilled Worker (W1)','Skilled Worker / Operator (W2)','NAPS Apprentice','NATS Graduate Trainee','Intern','Contract Worker'].map(p=><option key={p}>{p}</option>)}</select></Fld>
          <div style={{marginBottom:'10px'}}/>
          <Fld label="3. Location" req><select style={C.sel} value={qh.location_id} onChange={e=>setQh(q=>({...q,location_id:e.target.value}))}><option value="">Select...</option>{locations.map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}</select></Fld>
          <div style={{marginBottom:'10px'}}/>
          <FldRow>
            <Fld label="4. No. of Positions" req><input type="number" style={C.inp} min="1" max="50" value={qh.openings} onChange={e=>setQh(q=>({...q,openings:parseInt(e.target.value)||1}))}/></Fld>
            <Fld label="5. Expected Joining Date"><input type="date" style={C.inp} value={qh.joining_date} onChange={e=>setQh(q=>({...q,joining_date:e.target.value}))}/></Fld>
          </FldRow>
          <Fld label="Reason"><select style={C.sel} value={qh.reason} onChange={e=>setQh(q=>({...q,reason:e.target.value}))}>{['New Requirement','Replacement','Seasonal / Peak Load','Project Based','NAPS Government Scheme'].map(r=><option key={r}>{r}</option>)}</select></Fld>
          <div style={{marginTop:'12px',padding:'8px 12px',background:'#F8FAFC',borderRadius:'8px',fontSize:'11px',color:'#64748B'}}>
            Auto-filled: Quick Hire ID auto-generate · Status: Approved · MD ko notification
          </div>
        </Modal>
      )}

      {/* Job Opening Form */}
      {showJobForm&&(
        <Modal title="💼 New Job Opening" sub="MRF se link karo ya directly create karo" onClose={()=>setShowJobForm(false)} onSave={saveJob} saveLabel="Create Job Opening">
          <FldRow>
            <Fld label="Company" req><select style={C.sel} value={job.company_id} onChange={e=>setJob(j=>({...j,company_id:e.target.value}))}><option value="">Select...</option>{companies.map((c:any)=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></Fld>
            <Fld label="Link to MRF"><select style={C.sel} value={job.mrf_id} onChange={e=>setJob(j=>({...j,mrf_id:e.target.value}))}><option value="">None (Direct)</option>{mrfs.filter((m:any)=>m.status==='Approved').map((m:any)=><option key={m.id} value={m.id}>{m.mrf_number} — {m.position}</option>)}</select></Fld>
          </FldRow>
          <div style={{marginBottom:'10px'}}>
            <Fld label="Job Title" req><input style={C.inp} placeholder="e.g. Senior Executive — Accounts" value={job.job_title} onChange={e=>setJob(j=>({...j,job_title:e.target.value}))}/></Fld>
          </div>
          <FldRow>
            <Fld label="Department"><select style={C.sel} value={job.department_id} onChange={e=>setJob(j=>({...j,department_id:e.target.value}))}><option value="">Select...</option>{departments.map((d:any)=><option key={d.id} value={d.id}>{d.dept_name}</option>)}</select></Fld>
            <Fld label="Location"><select style={C.sel} value={job.location_id} onChange={e=>setJob(j=>({...j,location_id:e.target.value}))}><option value="">Select...</option>{locations.map((l:any)=><option key={l.id} value={l.id}>{l.location_name}</option>)}</select></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Min Experience (yrs)"><input type="number" style={C.inp} value={job.exp_min} onChange={e=>setJob(j=>({...j,exp_min:+e.target.value}))}/></Fld>
            <Fld label="Max Experience (yrs)"><input type="number" style={C.inp} value={job.exp_max} onChange={e=>setJob(j=>({...j,exp_max:+e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="CTC Min (₹)"><input type="number" style={C.inp} value={job.sal_min} onChange={e=>setJob(j=>({...j,sal_min:+e.target.value}))}/></Fld>
            <Fld label="CTC Max (₹)"><input type="number" style={C.inp} value={job.sal_max} onChange={e=>setJob(j=>({...j,sal_max:+e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Employment Type"><select style={C.sel} value={job.employment_type} onChange={e=>setJob(j=>({...j,employment_type:e.target.value}))}>{['Permanent','Contract','Intern','NAPS','NATS'].map(t=><option key={t}>{t}</option>)}</select></Fld>
            <Fld label="No. of Openings"><input type="number" style={C.inp} value={job.openings_count} onChange={e=>setJob(j=>({...j,openings_count:+e.target.value}))}/></Fld>
          </FldRow>
          <div style={{marginBottom:'10px'}}>
            <Fld label="Required Skills (comma separated)"><input style={C.inp} placeholder="e.g. Tally, GST, MS Excel" value={job.skills} onChange={e=>setJob(j=>({...j,skills:e.target.value}))}/></Fld>
          </div>
          <Fld label="Job Description"><textarea style={{...C.inp,height:'80px',resize:'none' as const}} placeholder="Role overview, responsibilities, requirements..." value={job.jd_text} onChange={e=>setJob(j=>({...j,jd_text:e.target.value}))}/></Fld>
        </Modal>
      )}

      {/* Add Candidate Form */}
      {showCandidateForm&&(
        <Modal title="👤 Add Candidate" sub="Duplicate auto-check hoga" onClose={()=>setShowCandidateForm(false)} onSave={saveCandidate} saveLabel="Add to Pipeline">
          <FldRow>
            <Fld label="Job Opening" req><select style={C.sel} value={cand.job_id} onChange={e=>{const j=jobs.find((j:any)=>j.id===e.target.value);setCand(c=>({...c,job_id:e.target.value,company_id:j?.company_id||''}))}}>
              <option value="">Select Job...</option>
              {jobs.filter((j:any)=>j.status==='Open').map((j:any)=><option key={j.id} value={j.id}>{j.job_title} — {j.companies?.company_code}</option>)}
            </select></Fld>
            <Fld label="Source"><select style={C.sel} value={cand.source} onChange={e=>setCand(c=>({...c,source:e.target.value}))}>{['Naukri','LinkedIn','Reference','Walk-in','Campus','Consultant','Internal'].map(s=><option key={s}>{s}</option>)}</select></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Full Name" req><input style={C.inp} placeholder="Ramesh Kumar" value={cand.full_name} onChange={e=>setCand(c=>({...c,full_name:e.target.value}))}/></Fld>
            <Fld label="Mobile" req><input style={C.inp} placeholder="9876543210" value={cand.phone} onChange={e=>setCand(c=>({...c,phone:e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Email"><input style={C.inp} placeholder="email@gmail.com" value={cand.email} onChange={e=>setCand(c=>({...c,email:e.target.value}))}/></Fld>
            <Fld label="Current Company"><input style={C.inp} placeholder="ABC Ltd" value={cand.current_company} onChange={e=>setCand(c=>({...c,current_company:e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Experience (years)"><input type="number" style={C.inp} value={cand.experience_years} onChange={e=>setCand(c=>({...c,experience_years:+e.target.value}))}/></Fld>
            <Fld label="Notice Period (days)"><input type="number" style={C.inp} value={cand.notice_period} onChange={e=>setCand(c=>({...c,notice_period:+e.target.value}))}/></Fld>
          </FldRow>
          <FldRow>
            <Fld label="Current CTC (₹/year)"><input type="number" style={C.inp} value={cand.current_ctc} onChange={e=>setCand(c=>({...c,current_ctc:+e.target.value}))}/></Fld>
            <Fld label="Expected CTC (₹/year)"><input type="number" style={C.inp} value={cand.expected_ctc} onChange={e=>setCand(c=>({...c,expected_ctc:+e.target.value}))}/></Fld>
          </FldRow>
        </Modal>
      )}

    </div>
  )
}