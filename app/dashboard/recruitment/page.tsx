'use client'
import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────
type MainTab = 'dashboard' | 'mrf' | 'jobs' | 'pipeline' | 'interviews' | 'offers' | 'ai' | 'analytics'
type MRFTab = 'full' | 'quick'
type MRFStatus = 'Draft' | 'Submitted' | 'HR Review' | 'Approved' | 'Rejected' | 'On Hold'
type JobStatus = 'Open' | 'On Hold' | 'Closed' | 'Draft'
type CandidateStage = 'Applied' | 'AI Screened' | 'Telephonic' | 'L1 Interview' | 'L2 Interview' | 'Optional' | 'MD Final' | 'Offer Sent' | 'Joined' | 'Rejected'
type AITag = 'Strong Match' | 'Partial Match' | 'Not Suitable'
type OfferStatus = 'Draft' | 'Pending Approval' | 'MD Approved' | 'Sent' | 'Accepted' | 'Rejected' | 'Negotiating'

// ── Dummy Data ────────────────────────────────────────────────────
const MRF_DATA = [
  { id: 1, mrfNo: 'MRF/SSM/2026/001', position: 'Senior Executive — Accounts', dept: 'Finance & Accounts', location: 'Delhi Head Office', grade: 'E3', type: 'Full MRF', count: 2, urgency: 'Urgent', reason: 'Replacement', status: 'Approved' as MRFStatus, requestedBy: 'Rohit Modi', date: '05-May-2026', ctcMin: 700000, ctcMax: 1000000, empType: 'Permanent' },
  { id: 2, mrfNo: 'MRF/SSM/2026/002', position: 'IT Manager', dept: 'IT', location: 'Gurugram Branch', grade: 'M1', type: 'Full MRF', count: 1, urgency: 'Normal', reason: 'New Position', status: 'HR Review' as MRFStatus, requestedBy: 'Sunil Singh', date: '08-May-2026', ctcMin: 1000000, ctcMax: 1400000, empType: 'Permanent' },
  { id: 3, mrfNo: 'MRF/STC/2026/001', position: 'Sales Executive', dept: 'Sales & Marketing', location: 'Mumbai Head Office', grade: 'E2', type: 'Full MRF', count: 5, urgency: 'Immediate', reason: 'Expansion', status: 'Approved' as MRFStatus, requestedBy: 'Neha Agarwal', date: '01-May-2026', ctcMin: 600000, ctcMax: 750000, empType: 'Permanent' },
  { id: 4, mrfNo: 'QH/SSM/2026/001', position: 'Helper', dept: 'Production', location: 'Panipat Factory', grade: 'W1', type: 'Quick Hire', count: 10, urgency: 'Immediate', reason: 'Seasonal', status: 'Approved' as MRFStatus, requestedBy: 'Site HR — Panipat', date: '10-May-2026', ctcMin: 72000, ctcMax: 90000, empType: 'Contract' },
  { id: 5, mrfNo: 'QH/SSM/2026/002', position: 'NAPS Apprentice — Fitter', dept: 'Manufacturing', location: 'Ludhiana Factory', grade: 'NAPS', type: 'Quick Hire', count: 3, urgency: 'Normal', reason: 'NAPS Scheme', status: 'Submitted' as MRFStatus, requestedBy: 'Plant Head — Ludhiana', date: '12-May-2026', ctcMin: 60000, ctcMax: 72000, empType: 'NAPS' },
]

const JOB_DATA = [
  { id: 1, title: 'Senior Executive — Accounts', dept: 'Finance & Accounts', location: 'Delhi Head Office', company: 'SSM', grade: 'E3', expMin: 4, expMax: 8, ctcMin: 700000, ctcMax: 1000000, openings: 2, applied: 18, shortlisted: 5, status: 'Open' as JobStatus, postedDate: '06-May-2026', mrfNo: 'MRF/SSM/2026/001' },
  { id: 2, title: 'Sales Executive', dept: 'Sales & Marketing', location: 'Mumbai Head Office', company: 'STC', grade: 'E2', expMin: 2, expMax: 5, ctcMin: 600000, ctcMax: 750000, openings: 5, applied: 42, shortlisted: 12, status: 'Open' as JobStatus, postedDate: '02-May-2026', mrfNo: 'MRF/STC/2026/001' },
  { id: 3, title: 'IT Manager', dept: 'IT', location: 'Gurugram Branch', company: 'SSM', grade: 'M1', expMin: 8, expMax: 12, ctcMin: 1000000, ctcMax: 1400000, openings: 1, applied: 9, shortlisted: 3, status: 'Open' as JobStatus, postedDate: '09-May-2026', mrfNo: 'MRF/SSM/2026/002' },
]

const CANDIDATE_DATA = [
  { id: 1, name: 'Vikram Malhotra', jobId: 1, jobTitle: 'Sr Executive — Accounts', company: 'SSM', currentCo: 'ABC Ltd', exp: 5, currentCTC: 650000, expectedCTC: 800000, notice: 30, aiScore: 88, aiTag: 'Strong Match' as AITag, source: 'Naukri', stage: 'MD Final' as CandidateStage, mobile: '9111222333', email: 'vikram.m@gmail.com', location: 'Delhi', daysInStage: 2 },
  { id: 2, name: 'Priya Sharma', jobId: 1, jobTitle: 'Sr Executive — Accounts', company: 'SSM', currentCo: 'XYZ Corp', exp: 6, currentCTC: 720000, expectedCTC: 900000, notice: 60, aiScore: 79, aiTag: 'Strong Match' as AITag, source: 'LinkedIn', stage: 'L2 Interview' as CandidateStage, mobile: '9222333444', email: 'priya.s@gmail.com', location: 'Noida', daysInStage: 4 },
  { id: 3, name: 'Rahul Gupta', jobId: 1, jobTitle: 'Sr Executive — Accounts', company: 'SSM', currentCo: 'PQR Industries', exp: 3, currentCTC: 480000, expectedCTC: 700000, notice: 15, aiScore: 62, aiTag: 'Partial Match' as AITag, source: 'Reference', stage: 'L1 Interview' as CandidateStage, mobile: '9333444555', email: 'rahul.g@gmail.com', location: 'Delhi', daysInStage: 1 },
  { id: 4, name: 'Anita Verma', jobId: 2, jobTitle: 'Sales Executive', company: 'STC', currentCo: 'Fresh Graduate', exp: 0, currentCTC: 0, expectedCTC: 650000, notice: 0, aiScore: 71, aiTag: 'Partial Match' as AITag, source: 'Campus', stage: 'Telephonic' as CandidateStage, mobile: '9444555666', email: 'anita.v@gmail.com', location: 'Mumbai', daysInStage: 1 },
  { id: 5, name: 'Suresh Patel', jobId: 2, jobTitle: 'Sales Executive', company: 'STC', currentCo: 'DEF Sales', exp: 3, currentCTC: 550000, expectedCTC: 700000, notice: 30, aiScore: 91, aiTag: 'Strong Match' as AITag, source: 'Naukri', stage: 'Offer Sent' as CandidateStage, mobile: '9555666777', email: 'suresh.p@gmail.com', location: 'Mumbai', daysInStage: 3 },
  { id: 6, name: 'Deepak Yadav', jobId: 1, jobTitle: 'Sr Executive — Accounts', company: 'SSM', currentCo: 'GHI Ltd', exp: 7, currentCTC: 850000, expectedCTC: 1000000, notice: 90, aiScore: 35, aiTag: 'Not Suitable' as AITag, source: 'Naukri', stage: 'Rejected' as CandidateStage, mobile: '9666777888', email: 'deepak.y@gmail.com', location: 'Gurgaon', daysInStage: 0 },
  { id: 7, name: 'Neha Singh', jobId: 2, jobTitle: 'Sales Executive', company: 'STC', currentCo: 'JKL Corp', exp: 2, currentCTC: 480000, expectedCTC: 620000, notice: 30, aiScore: 84, aiTag: 'Strong Match' as AITag, source: 'Reference', stage: 'AI Screened' as CandidateStage, mobile: '9777888999', email: 'neha.s@gmail.com', location: 'Mumbai', daysInStage: 0 },
  { id: 8, name: 'Amit Chauhan', jobId: 2, jobTitle: 'Sales Executive', company: 'STC', currentCo: 'MNO Industries', exp: 4, currentCTC: 600000, expectedCTC: 720000, notice: 45, aiScore: 76, aiTag: 'Strong Match' as AITag, source: 'LinkedIn', stage: 'Applied' as CandidateStage, mobile: '9888999000', email: 'amit.c@gmail.com', location: 'Pune', daysInStage: 0 },
]

const INTERVIEW_DATA = [
  { id: 1, candidateName: 'Vikram Malhotra', position: 'Sr Executive — Accounts', stage: 'MD Final', interviewer: 'MD — Tarun Kapoor', date: '2026-05-22', time: '11:00 AM', mode: 'In-person', status: 'Scheduled', company: 'SSM' },
  { id: 2, candidateName: 'Priya Sharma', position: 'Sr Executive — Accounts', stage: 'L2 Interview', interviewer: 'Mahesh Srivastava', date: '2026-05-22', time: '3:00 PM', mode: 'Video', status: 'Scheduled', company: 'SSM' },
  { id: 3, candidateName: 'Rahul Gupta', position: 'Sr Executive — Accounts', stage: 'L1 Interview', interviewer: 'Naresh Joshi', date: '2026-05-21', time: '2:00 PM', mode: 'In-person', status: 'Completed', company: 'SSM' },
]

const OFFER_DATA = [
  { id: 1, offerNo: 'OFR/2026/001', candidateName: 'Suresh Patel', position: 'Sales Executive', company: 'STC', grade: 'E2', annualCTC: 680000, netTH: 47800, joiningDate: '2026-06-15', status: 'Sent' as OfferStatus, sentDate: '2026-05-18', mdApproved: true },
  { id: 2, offerNo: 'OFR/2026/002', candidateName: 'Vikram Malhotra', position: 'Sr Executive — Accounts', company: 'SSM', grade: 'E3', annualCTC: 850000, netTH: 58200, joiningDate: '2026-06-01', status: 'MD Approved' as OfferStatus, sentDate: '', mdApproved: true },
]

// ── Styles ────────────────────────────────────────────────────────
const C = {
  page: { display:'flex' as const, flexDirection:'column' as const, minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  topbar: { background:'#fff', padding:'11px 20px', borderBottom:'1px solid #E2E8F0', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const },
  nav: { background:'#fff', borderBottom:'1px solid #E2E8F0', padding:'0 20px', display:'flex' as const, overflowX:'auto' as const },
  navBtn: (active: boolean) => ({ padding:'12px 16px', border:'none', background:'transparent', cursor:'pointer', fontSize:'13px', fontWeight:active?600:400, color:active?'#7C3AED':'#64748B', borderBottom:active?'2px solid #7C3AED':'2px solid transparent', whiteSpace:'nowrap' as const }),
  body: { flex:1, padding:'16px 20px', overflowY:'auto' as const },
  card: { background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:'10px' },
  priBtn: { padding:'9px 18px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'9px 14px', background:'#fff', color:'#374151', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', fontWeight:500 as const, cursor:'pointer' },
  inp: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
  sel: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
}

const STAGE_COLORS: Record<CandidateStage, { bg: string; color: string }> = {
  'Applied':      { bg:'#F1F5F9', color:'#374151' },
  'AI Screened':  { bg:'#EDE9FE', color:'#7C3AED' },
  'Telephonic':   { bg:'#DBEAFE', color:'#1D4ED8' },
  'L1 Interview': { bg:'#CCFBF1', color:'#0D9488' },
  'L2 Interview': { bg:'#FEF3C7', color:'#D97706' },
  'Optional':     { bg:'#FEE2E2', color:'#DC2626' },
  'MD Final':     { bg:'#F5F3FF', color:'#9333EA' },
  'Offer Sent':   { bg:'#DCFCE7', color:'#16A34A' },
  'Joined':       { bg:'#BBF7D0', color:'#059669' },
  'Rejected':     { bg:'#FEE2E2', color:'#DC2626' },
}

const AI_COLORS: Record<AITag, { bg: string; color: string }> = {
  'Strong Match':  { bg:'#DCFCE7', color:'#16A34A' },
  'Partial Match': { bg:'#FEF3C7', color:'#D97706' },
  'Not Suitable':  { bg:'#FEE2E2', color:'#DC2626' },
}

const MRF_STATUS_COLORS: Record<MRFStatus, { bg: string; color: string }> = {
  'Draft':      { bg:'#F1F5F9', color:'#374151' },
  'Submitted':  { bg:'#DBEAFE', color:'#1D4ED8' },
  'HR Review':  { bg:'#FEF3C7', color:'#D97706' },
  'Approved':   { bg:'#DCFCE7', color:'#16A34A' },
  'Rejected':   { bg:'#FEE2E2', color:'#DC2626' },
  'On Hold':    { bg:'#F1F5F9', color:'#374151' },
}

const PIPELINE_STAGES: CandidateStage[] = ['Applied','AI Screened','Telephonic','L1 Interview','L2 Interview','Optional','MD Final','Offer Sent','Joined','Rejected']

// ── Stat Card ─────────────────────────────────────────────────────
const StatCard = ({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) => (
  <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:'10px', padding:'12px 14px', borderTop:`3px solid ${color}` }}>
    <div style={{ fontSize:'10px', color:'#94A3B8', fontWeight:500, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:'3px' }}>{label}</div>
    <div style={{ fontSize:'24px', fontWeight:700, color }}>{value}</div>
    {sub && <div style={{ fontSize:'10px', color:'#94A3B8', marginTop:'2px' }}>{sub}</div>}
  </div>
)

// ── Main Component ────────────────────────────────────────────────
export default function RecruitmentModule() {
  const [tab, setTab] = useState<MainTab>('dashboard')
  const [mrfTab, setMrfTab] = useState<MRFTab>('full')
  const [showMRFForm, setShowMRFForm] = useState(false)
  const [showQuickForm, setShowQuickForm] = useState(false)
  const [showJobForm, setShowJobForm] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<typeof CANDIDATE_DATA[0] | null>(null)
  const [pipelineFilter, setPipelineFilter] = useState('All')

  const tabs = [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'mrf',       label: '📋 Requisitions' },
    { id: 'jobs',      label: '💼 Job Openings' },
    { id: 'pipeline',  label: '👥 Pipeline' },
    { id: 'interviews',label: '📅 Interviews' },
    { id: 'offers',    label: '📄 Offers' },
    { id: 'ai',        label: '🤖 AI Screening' },
    { id: 'analytics', label: '📈 Analytics' },
  ]

  return (
    <div style={C.page}>

      {/* Topbar */}
      <div style={C.topbar}>
        <div style={{ fontSize:'12px', color:'#64748B' }}>
          Sharma Group &nbsp;›&nbsp; <span style={{ color:'#7C3AED', fontWeight:500 }}>Recruitment</span>
          {tab === 'pipeline' && <span style={{ color:'#64748B' }}> &nbsp;›&nbsp; Candidate Pipeline</span>}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {tab === 'mrf' && <button style={C.secBtn} onClick={() => setShowQuickForm(true)}>⚡ Quick Hire</button>}
          {tab === 'mrf' && <button style={C.priBtn} onClick={() => setShowMRFForm(true)}>+ New MRF</button>}
          {tab === 'jobs' && <button style={C.priBtn} onClick={() => setShowJobForm(true)}>+ New Job Opening</button>}
          {tab === 'pipeline' && <button style={C.secBtn}>📥 Bulk Upload</button>}
          {tab === 'pipeline' && <button style={C.secBtn}>📷 QR Code</button>}
          {tab === 'pipeline' && <button style={C.priBtn}>+ Add Candidate</button>}
        </div>
      </div>

      {/* Sub Nav */}
      <div style={C.nav}>
        {tabs.map(t => (
          <button key={t.id} style={C.navBtn(tab === t.id)} onClick={() => setTab(t.id as MainTab)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={C.body}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === 'dashboard' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Open Positions" value={8} color="#7C3AED" />
              <StatCard label="Active Candidates" value={42} color="#1D4ED8" />
              <StatCard label="Interviews Today" value={3} color="#D97706" />
              <StatCard label="Offers Pending" value={2} color="#0D9488" />
              <StatCard label="Joined This Month" value={4} color="#16A34A" />
              <StatCard label="Avg Time to Hire" value="18d" color="#374151" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px' }}>
              {/* Pipeline Funnel */}
              <div style={C.card}>
                <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Pipeline Funnel</div>
                {[
                  { stage:'Applied', count:67, color:'#94A3B8' },
                  { stage:'AI Screened', count:42, color:'#7C3AED' },
                  { stage:'Telephonic', count:24, color:'#1D4ED8' },
                  { stage:'L1 Interview', count:14, color:'#0D9488' },
                  { stage:'L2 Interview', count:8, color:'#D97706' },
                  { stage:'MD Final', count:4, color:'#9333EA' },
                  { stage:'Offer Sent', count:3, color:'#16A34A' },
                ].map((s, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
                    <div style={{ fontSize:'11px', color:'#64748B', width:'100px', flexShrink:0 }}>{s.stage}</div>
                    <div style={{ flex:1, background:'#F1F5F9', borderRadius:'4px', height:'20px', overflow:'hidden' }}>
                      <div style={{ width:`${(s.count/67)*100}%`, background:s.color, height:'100%', borderRadius:'4px', display:'flex', alignItems:'center', paddingLeft:'6px' }}>
                        <span style={{ fontSize:'10px', color:'#fff', fontWeight:600 }}>{s.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent Activity */}
              <div style={C.card}>
                <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Recent Activity</div>
                {[
                  { text:'Vikram Malhotra → MD Final', time:'2h ago', color:'#7C3AED' },
                  { text:'Offer sent to Suresh Patel', time:'5h ago', color:'#16A34A' },
                  { text:'L1 completed — Rahul Gupta', time:'Yesterday', color:'#0D9488' },
                  { text:'5 new candidates — Sales Executive', time:'Yesterday', color:'#1D4ED8' },
                  { text:'MRF/SSM/2026/002 approved', time:'2 days ago', color:'#D97706' },
                ].map((a, i) => (
                  <div key={i} style={{ display:'flex', gap:'8px', padding:'6px 0', borderBottom:'1px solid #F1F5F9' }}>
                    <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:a.color, marginTop:'5px', flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:'11px', color:'#374151' }}>{a.text}</div>
                      <div style={{ fontSize:'10px', color:'#94A3B8' }}>{a.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Open Positions Summary */}
            <div style={C.card}>
              <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Open Positions</div>
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#F8FAFC' }}>
                    {['Position','Company','Grade','Openings','Applied','Shortlisted','Status'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left' as const, fontWeight:600, color:'#374151', borderBottom:'1px solid #E2E8F0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {JOB_DATA.map((j, i) => (
                    <tr key={j.id} style={{ borderBottom:'1px solid #F1F5F9' }}>
                      <td style={{ padding:'9px 10px', fontWeight:500 }}>{j.title}</td>
                      <td style={{ padding:'9px 10px', color:'#64748B' }}>{j.company}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 7px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'6px', fontSize:'10px', fontWeight:600 }}>{j.grade}</span>
                      </td>
                      <td style={{ padding:'9px 10px' }}>{j.openings}</td>
                      <td style={{ padding:'9px 10px', color:'#1D4ED8', fontWeight:500 }}>{j.applied}</td>
                      <td style={{ padding:'9px 10px', color:'#16A34A', fontWeight:500 }}>{j.shortlisted}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 8px', background:'#DCFCE7', color:'#16A34A', borderRadius:'6px', fontSize:'10px', fontWeight:500 }}>Open</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ MRF ═══ */}
        {tab === 'mrf' && (
          <div>
            {/* MRF Sub tabs */}
            <div style={{ display:'flex', gap:'8px', marginBottom:'14px', background:'#fff', padding:'10px 14px', borderRadius:'10px', border:'1px solid #E2E8F0', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', gap:'6px' }}>
                {[{ id:'full', label:'📋 Full MRF' }, { id:'quick', label:'⚡ Quick Hire' }].map(t => (
                  <button key={t.id} onClick={() => setMrfTab(t.id as MRFTab)} style={{ padding:'7px 16px', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'12px', fontWeight:mrfTab===t.id?600:400, background:mrfTab===t.id?'#7C3AED':'#F8FAFC', color:mrfTab===t.id?'#fff':'#64748B' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:'11px', color:'#94A3B8' }}>
                {mrfTab==='full' ? 'CTC ≥ ₹6L · MD Approval Required' : 'CTC < ₹6L · Site HR Approve · W1/W2/NAPS/Intern'}
              </div>
            </div>

            {/* MRF List */}
            <div style={C.card}>
              <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>
                {mrfTab==='full' ? 'Manpower Requisitions' : 'Quick Hire Requests'}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#1E1B4B' }}>
                    {['MRF No.','Position','Dept','Location','Grade','Count','Type','Urgency','Status','Requested By','Date','Action'].map(h => (
                      <th key={h} style={{ padding:'9px 10px', color:'#fff', fontWeight:600, textAlign:'left' as const, whiteSpace:'nowrap' as const, fontSize:'11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MRF_DATA.filter(m => mrfTab==='full' ? m.type==='Full MRF' : m.type==='Quick Hire').map((m, i) => (
                    <tr key={m.id} style={{ background:i%2===0?'#F8FAFC':'#fff', borderBottom:'1px solid #E2E8F0' }}>
                      <td style={{ padding:'9px 10px', color:'#7C3AED', fontWeight:600, fontSize:'11px' }}>{m.mrfNo}</td>
                      <td style={{ padding:'9px 10px', fontWeight:500 }}>{m.position}</td>
                      <td style={{ padding:'9px 10px', color:'#64748B' }}>{m.dept}</td>
                      <td style={{ padding:'9px 10px', color:'#64748B', fontSize:'11px' }}>{m.location}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 6px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{m.grade}</span>
                      </td>
                      <td style={{ padding:'9px 10px', textAlign:'center' as const, fontWeight:600 }}>{m.count}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 6px', background:m.type==='Quick Hire'?'#FEF3C7':'#DBEAFE', color:m.type==='Quick Hire'?'#D97706':'#1D4ED8', borderRadius:'5px', fontSize:'10px' }}>{m.type}</span>
                      </td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 6px', background:m.urgency==='Immediate'?'#FEE2E2':m.urgency==='Urgent'?'#FEF3C7':'#F1F5F9', color:m.urgency==='Immediate'?'#DC2626':m.urgency==='Urgent'?'#D97706':'#374151', borderRadius:'5px', fontSize:'10px' }}>{m.urgency}</span>
                      </td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 8px', borderRadius:'8px', fontSize:'10px', fontWeight:500, ...MRF_STATUS_COLORS[m.status] }}>{m.status}</span>
                      </td>
                      <td style={{ padding:'9px 10px', color:'#64748B', fontSize:'11px' }}>{m.requestedBy}</td>
                      <td style={{ padding:'9px 10px', color:'#64748B', fontSize:'11px' }}>{m.date}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <button style={{ padding:'3px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Hire Form Modal */}
            {showQuickForm && (
              <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
                <div style={{ background:'#fff', borderRadius:'12px', padding:'24px', width:'480px', maxHeight:'90vh', overflowY:'auto' as const }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
                    <div>
                      <div style={{ fontSize:'15px', fontWeight:600 }}>⚡ Quick Hire</div>
                      <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>CTC &lt; ₹6L · Site HR / Plant Head</div>
                    </div>
                    <button onClick={() => setShowQuickForm(false)} style={{ background:'none', border:'none', fontSize:'18px', cursor:'pointer', color:'#94A3B8' }}>✕</button>
                  </div>
                  <div style={{ background:'#FEF3C7', borderRadius:'8px', padding:'8px 12px', fontSize:'11px', color:'#92400E', marginBottom:'14px' }}>
                    ⚡ System auto-check: CTC ceiling · Grade · Location auth · Headcount · MD notification auto-send
                  </div>
                  {[
                    { label:'1. Position Type', type:'select', opts:['Helper / Unskilled Worker (W1)','Skilled Worker / Operator (W2)','NAPS Apprentice','NATS Graduate Trainee','Intern','Contract Worker'] },
                    { label:'2. Location', type:'select', opts:['Panipat Factory','Ludhiana Factory','Delhi Head Office','Gurugram Branch'] },
                    { label:'3. Number of Positions', type:'number', placeholder:'e.g. 5' },
                    { label:'4. Expected Joining Date', type:'date', placeholder:'' },
                    { label:'5. Reason', type:'select', opts:['New Requirement','Replacement (someone left)','Seasonal / Peak Load','Project Based','NAPS Government Scheme'] },
                  ].map((f, i) => (
                    <div key={i} style={{ marginBottom:'12px' }}>
                      <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.label} <span style={{ color:'#DC2626' }}>*</span></label>
                      {f.type==='select' ? (
                        <select style={C.sel}><option value="">Select...</option>{f.opts?.map(o => <option key={o}>{o}</option>)}</select>
                      ) : (
                        <input type={f.type} style={C.inp} placeholder={f.placeholder} />
                      )}
                    </div>
                  ))}
                  <div style={{ background:'#F8FAFC', borderRadius:'8px', padding:'10px 12px', marginBottom:'14px', fontSize:'11px', color:'#64748B' }}>
                    <div style={{ fontWeight:500, marginBottom:'4px' }}>Auto-filled:</div>
                    Requested By: Site HR (login) · Company: SSM · Quick Hire ID: QH/SSM/2026/003
                  </div>
                  <div style={{ display:'flex', gap:'8px' }}>
                    <button style={{ ...C.priBtn, flex:1, background:'#16A34A' }}>✅ Approve & Create Opening</button>
                    <button style={C.secBtn} onClick={() => setShowQuickForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Full MRF Form Modal */}
            {showMRFForm && (
              <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
                <div style={{ background:'#fff', borderRadius:'12px', padding:'24px', width:'680px', maxHeight:'90vh', overflowY:'auto' as const }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
                    <div>
                      <div style={{ fontSize:'15px', fontWeight:600 }}>📋 New Manpower Requisition</div>
                      <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>MRF/SSM/2026/003 · Auto-generated</div>
                    </div>
                    <button onClick={() => setShowMRFForm(false)} style={{ background:'none', border:'none', fontSize:'18px', cursor:'pointer', color:'#94A3B8' }}>✕</button>
                  </div>

                  {/* Section A */}
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:'8px', paddingBottom:'5px', borderBottom:'2px solid #EDE9FE' }}>A. Position Details</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'14px' }}>
                    {[
                      { l:'Company', t:'select', o:['Sharma Sons Manufacturing (SSM)','Sharma Trading Corporation (STC)','Sharma Retail Solutions (SRS)'] },
                      { l:'Department', t:'select', o:['Manufacturing','Quality Control','Finance & Accounts','HR & Admin','Sales & Marketing','IT','Logistics','Procurement'] },
                      { l:'Location', t:'select', o:['Delhi Head Office','Panipat Factory','Ludhiana Factory','Gurugram Branch','Mumbai HO','Ahmedabad','Jaipur'] },
                      { l:'Position Title', t:'text', p:'e.g. Senior Executive — Accounts' },
                      { l:'Grade Required', t:'select', o:['L2','L1','M3','M2','M1','E3','E2','E1','W2','W1'] },
                      { l:'No. of Positions', t:'number', p:'e.g. 2' },
                      { l:'Employment Type', t:'select', o:['Permanent','Contract','Trainee','Intern','NAPS','NATS'] },
                      { l:'Collar Type', t:'select', o:['White Collar (WC)','Blue Collar (BC)'] },
                    ].map((f, i) => (
                      <div key={i}>
                        <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.l} <span style={{ color:'#DC2626' }}>*</span></label>
                        {f.t==='select' ? <select style={C.sel}><option>Select...</option>{f.o?.map(o => <option key={o}>{o}</option>)}</select> : <input type={f.t} style={C.inp} placeholder={f.p} />}
                      </div>
                    ))}
                  </div>

                  {/* Section B */}
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#1D4ED8', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:'8px', paddingBottom:'5px', borderBottom:'2px solid #DBEAFE' }}>B. Requirement Type</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'14px' }}>
                    {[
                      { l:'Reason', t:'select', o:['New Position','Replacement','Expansion','Seasonal'] },
                      { l:'Urgency', t:'select', o:['Immediate (0-15 days)','Urgent (15-30 days)','Normal (30-60 days)'] },
                      { l:'Expected Joining Date', t:'date' },
                    ].map((f, i) => (
                      <div key={i}>
                        <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.l} <span style={{ color:'#DC2626' }}>*</span></label>
                        {f.t==='select' ? <select style={C.sel}><option>Select...</option>{f.o?.map(o => <option key={o}>{o}</option>)}</select> : <input type={f.t} style={C.inp} />}
                      </div>
                    ))}
                  </div>

                  {/* Section C */}
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#16A34A', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:'8px', paddingBottom:'5px', borderBottom:'2px solid #DCFCE7' }}>C. Candidate Profile</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'14px' }}>
                    {[
                      { l:'Min Experience (yrs)', t:'number', p:'e.g. 4' },
                      { l:'Max Experience (yrs)', t:'number', p:'e.g. 8' },
                      { l:'Education', t:'select', o:['10th','12th','Diploma','Graduate','Post Graduate','CA','MBA'] },
                      { l:'Preferred Industry', t:'select', o:['Manufacturing','Trading','Retail','Any'] },
                      { l:'L1 Interviewer', t:'text', p:'Search employee...' },
                      { l:'L2 Interviewer', t:'text', p:'Search employee...' },
                    ].map((f, i) => (
                      <div key={i}>
                        <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.l}</label>
                        {f.t==='select' ? <select style={C.sel}><option>Select...</option>{f.o?.map(o => <option key={o}>{o}</option>)}</select> : <input type={f.t} style={C.inp} placeholder={f.p} />}
                      </div>
                    ))}
                  </div>

                  {/* Section D */}
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#D97706', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:'8px', paddingBottom:'5px', borderBottom:'2px solid #FEF3C7' }}>D. Business Justification</div>
                  <textarea style={{ ...C.inp, height:'70px', resize:'none' as const, marginBottom:'14px' }} placeholder="Why this position is needed — business impact, current workload gap..." />

                  <div style={{ background:'#EDE9FE', borderRadius:'8px', padding:'8px 12px', fontSize:'11px', color:'#7C3AED', marginBottom:'14px' }}>
                    💜 Final interview by MD is mandatory · CTC to be approved by MD before offer
                  </div>

                  <div style={{ display:'flex', gap:'8px' }}>
                    <button style={{ ...C.secBtn }}>Save as Draft</button>
                    <button style={{ ...C.priBtn, flex:1 }}>Submit for HR Review →</button>
                    <button style={C.secBtn} onClick={() => setShowMRFForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ JOB OPENINGS ═══ */}
        {tab === 'jobs' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Open Jobs" value={3} color="#7C3AED" />
              <StatCard label="Total Openings" value={8} color="#1D4ED8" />
              <StatCard label="Total Applied" value={67} color="#D97706" />
              <StatCard label="Shortlisted" value={20} color="#16A34A" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px,1fr))', gap:'12px' }}>
              {JOB_DATA.map(j => (
                <div key={j.id} style={{ ...C.card, cursor:'pointer', borderTop:'3px solid #7C3AED' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:600, color:'#0F172A' }}>{j.title}</div>
                      <div style={{ fontSize:'11px', color:'#64748B', marginTop:'2px' }}>{j.dept} · {j.location}</div>
                    </div>
                    <span style={{ padding:'3px 8px', background:'#DCFCE7', color:'#16A34A', borderRadius:'6px', fontSize:'10px', fontWeight:500 }}>{j.status}</span>
                  </div>
                  <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' as const, marginBottom:'10px' }}>
                    <span style={{ padding:'2px 7px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{j.grade}</span>
                    <span style={{ padding:'2px 7px', background:'#F1F5F9', color:'#374151', borderRadius:'5px', fontSize:'10px' }}>{j.company}</span>
                    <span style={{ padding:'2px 7px', background:'#F1F5F9', color:'#374151', borderRadius:'5px', fontSize:'10px' }}>{j.expMin}-{j.expMax} yrs</span>
                    <span style={{ padding:'2px 7px', background:'#F1F5F9', color:'#374151', borderRadius:'5px', fontSize:'10px' }}>₹{(j.ctcMin/100000).toFixed(1)}L-₹{(j.ctcMax/100000).toFixed(1)}L</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', padding:'8px', background:'#F8FAFC', borderRadius:'8px', marginBottom:'10px' }}>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:'18px', fontWeight:700, color:'#1D4ED8' }}>{j.applied}</div>
                      <div style={{ fontSize:'10px', color:'#94A3B8' }}>Applied</div>
                    </div>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:'18px', fontWeight:700, color:'#16A34A' }}>{j.shortlisted}</div>
                      <div style={{ fontSize:'10px', color:'#94A3B8' }}>Shortlisted</div>
                    </div>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:'18px', fontWeight:700, color:'#7C3AED' }}>{j.openings}</div>
                      <div style={{ fontSize:'10px', color:'#94A3B8' }}>Openings</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'6px' }}>
                    <button style={{ flex:1, ...C.priBtn, fontSize:'11px', padding:'7px' }}>View Pipeline</button>
                    <button style={{ ...C.secBtn, fontSize:'11px', padding:'7px' }}>🤖 AI Screen</button>
                    <button style={{ ...C.secBtn, fontSize:'11px', padding:'7px' }}>Edit</button>
                  </div>
                  <div style={{ fontSize:'10px', color:'#94A3B8', marginTop:'8px' }}>Posted: {j.postedDate} · MRF: {j.mrfNo}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ PIPELINE ═══ */}
        {tab === 'pipeline' && (
          <div>
            {/* Filter bar */}
            <div style={{ ...C.card, display:'flex', gap:'8px', alignItems:'center', marginBottom:'12px' }}>
              <span style={{ fontSize:'12px', color:'#64748B', flexShrink:0 }}>Job Opening:</span>
              <select style={{ ...C.sel, width:'auto', flex:1 }}>
                <option>All Openings</option>
                {JOB_DATA.map(j => <option key={j.id}>{j.title} — {j.company}</option>)}
              </select>
              <select style={{ ...C.sel, width:'160px' }}>
                <option>All Companies</option>
                <option>SSM</option><option>STC</option><option>SRS</option>
              </select>
              <select style={{ ...C.sel, width:'160px' }}>
                <option>All Sources</option>
                <option>Naukri</option><option>LinkedIn</option><option>Reference</option><option>Campus</option>
              </select>
            </div>

            {/* Kanban Board */}
            <div style={{ display:'flex', gap:'10px', overflowX:'auto' as const, paddingBottom:'8px' }}>
              {PIPELINE_STAGES.map(stage => {
                const stageCandidates = CANDIDATE_DATA.filter(c => c.stage === stage)
                return (
                  <div key={stage} style={{ minWidth:'200px', maxWidth:'200px', flexShrink:0 }}>
                    {/* Stage header */}
                    <div style={{ padding:'8px 10px', borderRadius:'8px', marginBottom:'8px', background:STAGE_COLORS[stage].bg, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:'11px', fontWeight:600, color:STAGE_COLORS[stage].color }}>{stage}</span>
                      <span style={{ fontSize:'11px', fontWeight:700, color:STAGE_COLORS[stage].color, background:'#fff', width:'20px', height:'20px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>{stageCandidates.length}</span>
                    </div>
                    {/* Cards */}
                    {stageCandidates.map(c => (
                      <div key={c.id} onClick={() => setSelectedCandidate(c)} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:'8px', padding:'10px', marginBottom:'8px', cursor:'pointer', borderLeft:`3px solid ${STAGE_COLORS[c.stage].color}` }}>
                        <div style={{ fontSize:'12px', fontWeight:600, color:'#0F172A', marginBottom:'3px' }}>{c.name}</div>
                        <div style={{ fontSize:'10px', color:'#64748B', marginBottom:'6px' }}>{c.currentCo} · {c.exp}y exp</div>
                        {/* AI Score */}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                          <span style={{ padding:'1px 6px', borderRadius:'4px', fontSize:'9px', fontWeight:600, ...AI_COLORS[c.aiTag] }}>{c.aiTag}</span>
                          <span style={{ fontSize:'10px', fontWeight:700, color:c.aiScore>=75?'#16A34A':c.aiScore>=50?'#D97706':'#DC2626' }}>{c.aiScore}%</span>
                        </div>
                        {/* Source + Notice */}
                        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' as const }}>
                          <span style={{ fontSize:'9px', padding:'1px 5px', background:'#F1F5F9', color:'#64748B', borderRadius:'4px' }}>{c.source}</span>
                          <span style={{ fontSize:'9px', padding:'1px 5px', background:'#F1F5F9', color:'#64748B', borderRadius:'4px' }}>{c.notice}d notice</span>
                          <span style={{ fontSize:'9px', padding:'1px 5px', background:'#F1F5F9', color:'#64748B', borderRadius:'4px' }}>₹{(c.expectedCTC/100000).toFixed(1)}L exp</span>
                        </div>
                        {c.daysInStage > 0 && (
                          <div style={{ fontSize:'9px', color:'#D97706', marginTop:'4px' }}>⏱ {c.daysInStage}d in stage</div>
                        )}
                      </div>
                    ))}
                    {/* Add button */}
                    <button style={{ width:'100%', padding:'7px', background:'transparent', border:'1px dashed #E2E8F0', borderRadius:'8px', cursor:'pointer', fontSize:'11px', color:'#94A3B8' }}>+ Add</button>
                  </div>
                )
              })}
            </div>

            {/* Candidate Drawer */}
            {selectedCandidate && (
              <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.3)', zIndex:1000 }} onClick={() => setSelectedCandidate(null)}>
                <div style={{ position:'absolute' as const, right:0, top:0, bottom:0, width:'400px', background:'#fff', padding:'20px', overflowY:'auto' as const }} onClick={e => e.stopPropagation()}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
                    <div style={{ fontSize:'15px', fontWeight:600 }}>{selectedCandidate.name}</div>
                    <button onClick={() => setSelectedCandidate(null)} style={{ background:'none', border:'none', fontSize:'18px', cursor:'pointer' }}>✕</button>
                  </div>
                  <div style={{ fontSize:'12px', color:'#64748B', marginBottom:'12px' }}>{selectedCandidate.currentCo} · {selectedCandidate.exp} yrs · {selectedCandidate.location}</div>
                  
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'14px' }}>
                    {[
                      { l:'AI Score', v:`${selectedCandidate.aiScore}%`, c:selectedCandidate.aiScore>=75?'#16A34A':selectedCandidate.aiScore>=50?'#D97706':'#DC2626' },
                      { l:'AI Tag', v:selectedCandidate.aiTag, c:'#7C3AED' },
                      { l:'Current CTC', v:`₹${(selectedCandidate.currentCTC/100000).toFixed(1)}L`, c:'#374151' },
                      { l:'Expected CTC', v:`₹${(selectedCandidate.expectedCTC/100000).toFixed(1)}L`, c:'#374151' },
                      { l:'Notice Period', v:`${selectedCandidate.notice} days`, c:'#374151' },
                      { l:'Source', v:selectedCandidate.source, c:'#374151' },
                      { l:'Mobile', v:selectedCandidate.mobile, c:'#1D4ED8' },
                      { l:'Email', v:selectedCandidate.email, c:'#1D4ED8' },
                    ].map((f, i) => (
                      <div key={i} style={{ padding:'8px 10px', background:'#F8FAFC', borderRadius:'8px' }}>
                        <div style={{ fontSize:'10px', color:'#94A3B8' }}>{f.l}</div>
                        <div style={{ fontSize:'12px', fontWeight:500, color:f.c, marginTop:'2px' }}>{f.v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom:'12px' }}>
                    <div style={{ fontSize:'11px', fontWeight:600, color:'#374151', marginBottom:'6px' }}>Move Stage</div>
                    <select style={C.sel}>
                      {PIPELINE_STAGES.map(s => <option key={s} selected={s===selectedCandidate.stage}>{s}</option>)}
                    </select>
                  </div>

                  <div style={{ display:'flex', flexDirection:'column' as const, gap:'8px' }}>
                    <button style={{ ...C.priBtn, width:'100%' }}>📅 Schedule Interview</button>
                    <button style={{ ...C.secBtn, width:'100%' }}>📄 Generate Offer</button>
                    <button style={{ ...C.secBtn, width:'100%' }}>💬 WhatsApp Contact</button>
                    <button style={{ ...C.secBtn, color:'#DC2626', borderColor:'#FECACA', width:'100%' }}>❌ Reject Candidate</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ INTERVIEWS ═══ */}
        {tab === 'interviews' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Today" value={2} color="#7C3AED" sub="interviews scheduled" />
              <StatCard label="Tomorrow" value={3} color="#1D4ED8" sub="interviews" />
              <StatCard label="This Week" value={8} color="#D97706" sub="total" />
              <StatCard label="Feedback Pending" value={1} color="#DC2626" sub="overdue" />
            </div>

            {['Today — 22 May 2026', 'Yesterday — 21 May 2026'].map((day, di) => (
              <div key={di} style={C.card}>
                <div style={{ fontSize:'12px', fontWeight:600, color:'#64748B', marginBottom:'10px' }}>{day}</div>
                <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['Candidate','Position','Round','Interviewer','Time','Mode','Status','Action'].map(h => (
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left' as const, fontWeight:600, color:'#374151', borderBottom:'1px solid #E2E8F0', fontSize:'11px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {INTERVIEW_DATA.filter((_, i) => di === 0 ? i < 2 : i === 2).map((iv, i) => (
                      <tr key={iv.id} style={{ borderBottom:'1px solid #F1F5F9' }}>
                        <td style={{ padding:'9px 10px', fontWeight:500 }}>{iv.candidateName}</td>
                        <td style={{ padding:'9px 10px', color:'#64748B', fontSize:'11px' }}>{iv.position}</td>
                        <td style={{ padding:'9px 10px' }}>
                          <span style={{ padding:'2px 7px', borderRadius:'6px', fontSize:'10px', fontWeight:600, ...STAGE_COLORS[iv.stage as CandidateStage] }}>{iv.stage}</span>
                        </td>
                        <td style={{ padding:'9px 10px', color:'#374151', fontSize:'11px' }}>{iv.interviewer}</td>
                        <td style={{ padding:'9px 10px', fontWeight:500 }}>{iv.time}</td>
                        <td style={{ padding:'9px 10px' }}>
                          <span style={{ padding:'2px 6px', background:'#F1F5F9', color:'#374151', borderRadius:'5px', fontSize:'10px' }}>{iv.mode}</span>
                        </td>
                        <td style={{ padding:'9px 10px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:500, background:iv.status==='Scheduled'?'#DBEAFE':'#DCFCE7', color:iv.status==='Scheduled'?'#1D4ED8':'#16A34A' }}>{iv.status}</span>
                        </td>
                        <td style={{ padding:'9px 10px' }}>
                          <div style={{ display:'flex', gap:'4px' }}>
                            {iv.status==='Completed' ? (
                              <button style={{ padding:'3px 8px', background:'#FEF3C7', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#D97706' }}>Add Feedback</button>
                            ) : (
                              <button style={{ padding:'3px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>Reschedule</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* ═══ OFFERS ═══ */}
        {tab === 'offers' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Offers Sent" value={3} color="#7C3AED" />
              <StatCard label="Pending MD Approval" value={1} color="#D97706" />
              <StatCard label="Accepted" value={1} color="#16A34A" />
              <StatCard label="Acceptance Rate" value="67%" color="#0D9488" />
            </div>

            {/* New Offer Button */}
            <div style={{ ...C.card, background:'#EDE9FE', borderColor:'#C4B5FD', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:'13px', fontWeight:600, color:'#7C3AED' }}>Generate New Offer Letter</div>
                <div style={{ fontSize:'11px', color:'#6D28D9', marginTop:'2px' }}>Candidate select karo → CTC Calculator → MD Approve → Send via Email + WhatsApp</div>
              </div>
              <button style={{ ...C.priBtn, whiteSpace:'nowrap' as const }}>+ New Offer</button>
            </div>

            {/* Offers Table */}
            <div style={C.card}>
              <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Offer Tracker</div>
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#1E1B4B' }}>
                    {['Offer No.','Candidate','Position','Company','Grade','Annual CTC','Net/Month','Joining Date','MD Approved','Status','Action'].map(h => (
                      <th key={h} style={{ padding:'9px 10px', color:'#fff', fontWeight:600, textAlign:'left' as const, fontSize:'11px', whiteSpace:'nowrap' as const }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OFFER_DATA.map((o, i) => (
                    <tr key={o.id} style={{ background:i%2===0?'#F8FAFC':'#fff', borderBottom:'1px solid #E2E8F0' }}>
                      <td style={{ padding:'9px 10px', color:'#7C3AED', fontWeight:600, fontSize:'11px' }}>{o.offerNo}</td>
                      <td style={{ padding:'9px 10px', fontWeight:500 }}>{o.candidateName}</td>
                      <td style={{ padding:'9px 10px', color:'#64748B' }}>{o.position}</td>
                      <td style={{ padding:'9px 10px' }}>{o.company}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 6px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{o.grade}</span>
                      </td>
                      <td style={{ padding:'9px 10px', fontWeight:600, color:'#7C3AED' }}>₹{(o.annualCTC/100000).toFixed(2)}L</td>
                      <td style={{ padding:'9px 10px', color:'#16A34A', fontWeight:500 }}>₹{o.netTH.toLocaleString('en-IN')}</td>
                      <td style={{ padding:'9px 10px', color:'#374151' }}>{o.joiningDate}</td>
                      <td style={{ padding:'9px 10px', textAlign:'center' as const }}>
                        {o.mdApproved ? <span style={{ color:'#16A34A', fontWeight:600 }}>✅ Yes</span> : <span style={{ color:'#D97706' }}>⏳ Pending</span>}
                      </td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{ padding:'2px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:500, background:o.status==='Sent'?'#DCFCE7':o.status==='MD Approved'?'#FEF3C7':'#EDE9FE', color:o.status==='Sent'?'#16A34A':o.status==='MD Approved'?'#D97706':'#7C3AED' }}>{o.status}</span>
                      </td>
                      <td style={{ padding:'9px 10px' }}>
                        <div style={{ display:'flex', gap:'4px' }}>
                          <button style={{ padding:'3px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View PDF</button>
                          {o.status==='MD Approved' && <button style={{ padding:'3px 8px', background:'#DCFCE7', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#16A34A' }}>Send</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ AI SCREENING ═══ */}
        {tab === 'ai' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Screened Today" value={12} color="#7C3AED" />
              <StatCard label="Strong Match" value={4} color="#16A34A" sub="≥75% score" />
              <StatCard label="Partial Match" value={5} color="#D97706" sub="50-74% score" />
              <StatCard label="Not Suitable" value={3} color="#DC2626" sub="<50% score" />
            </div>

            {/* Upload Zone */}
            <div style={{ ...C.card, border:'2px dashed #C4B5FD', background:'#F5F3FF', textAlign:'center' as const, padding:'28px' }}>
              <div style={{ fontSize:'28px', marginBottom:'8px' }}>🤖</div>
              <div style={{ fontSize:'14px', fontWeight:600, color:'#7C3AED', marginBottom:'4px' }}>AI Resume Screener</div>
              <div style={{ fontSize:'12px', color:'#6D28D9', marginBottom:'16px' }}>Resume upload karo → Claude API → JD match → Score + reasoning auto-generate</div>
              <div style={{ display:'flex', gap:'8px', justifyContent:'center' }}>
                <button style={C.priBtn}>📎 Upload Resume(s)</button>
                <select style={{ ...C.sel, width:'250px' }}>
                  <option>Select Job Opening for matching...</option>
                  {JOB_DATA.map(j => <option key={j.id}>{j.title} — {j.company}</option>)}
                </select>
              </div>
            </div>

            {/* Screened Candidates */}
            <div style={C.card}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                <div style={{ fontSize:'13px', fontWeight:600 }}>Screened Candidates</div>
                <div style={{ display:'flex', gap:'6px' }}>
                  {['All','Strong Match','Partial Match','Not Suitable'].map(f => (
                    <button key={f} style={{ padding:'4px 10px', background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#64748B' }}>{f}</button>
                  ))}
                </div>
              </div>

              {CANDIDATE_DATA.map(c => (
                <div key={c.id} style={{ display:'flex', gap:'12px', alignItems:'center', padding:'10px 12px', borderRadius:'8px', border:'1px solid #E2E8F0', marginBottom:'8px', background:'#F8FAFC' }}>
                  {/* Score Circle */}
                  <div style={{ width:'48px', height:'48px', borderRadius:'50%', background:c.aiScore>=75?'#DCFCE7':c.aiScore>=50?'#FEF3C7':'#FEE2E2', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, border:`2px solid ${c.aiScore>=75?'#16A34A':c.aiScore>=50?'#D97706':'#DC2626'}` }}>
                    <span style={{ fontSize:'13px', fontWeight:700, color:c.aiScore>=75?'#16A34A':c.aiScore>=50?'#D97706':'#DC2626' }}>{c.aiScore}%</span>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'3px' }}>
                      <span style={{ fontSize:'13px', fontWeight:600 }}>{c.name}</span>
                      <span style={{ padding:'1px 7px', borderRadius:'5px', fontSize:'10px', fontWeight:600, ...AI_COLORS[c.aiTag] }}>{c.aiTag}</span>
                    </div>
                    <div style={{ fontSize:'11px', color:'#64748B' }}>{c.currentCo} · {c.exp}y · Expected ₹{(c.expectedCTC/100000).toFixed(1)}L · {c.notice}d notice · {c.source}</div>
                    <div style={{ fontSize:'11px', color:'#7C3AED', marginTop:'3px' }}>Applied: {c.jobTitle}</div>
                  </div>
                  <div style={{ display:'flex', gap:'6px', flexShrink:0 }}>
                    <button style={{ padding:'5px 10px', background:'#EDE9FE', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'11px', color:'#7C3AED' }}>View Reasoning</button>
                    <button style={{ padding:'5px 10px', background:'#DCFCE7', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'11px', color:'#16A34A' }}>✓ Shortlist</button>
                    <button style={{ padding:'5px 10px', background:'#FEE2E2', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'11px', color:'#DC2626' }}>✗ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ ANALYTICS ═══ */}
        {tab === 'analytics' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginBottom:'14px' }}>
              <StatCard label="Avg Time to Hire" value="18d" color="#7C3AED" />
              <StatCard label="Offer Accept Rate" value="67%" color="#16A34A" />
              <StatCard label="AI Shortlist Accuracy" value="82%" color="#1D4ED8" />
              <StatCard label="Cost Per Hire" value="₹0" color="#D97706" sub="(Consultant fees pending)" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
              {/* Source Effectiveness */}
              <div style={C.card}>
                <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Source Effectiveness</div>
                {[
                  { source:'Naukri', applied:32, shortlisted:12, joined:3, color:'#7C3AED' },
                  { source:'LinkedIn', applied:18, shortlisted:6, joined:1, color:'#1D4ED8' },
                  { source:'Reference', applied:8, shortlisted:5, joined:2, color:'#16A34A' },
                  { source:'Campus', applied:6, shortlisted:4, joined:1, color:'#D97706' },
                  { source:'Walk-in', applied:3, shortlisted:1, joined:0, color:'#DC2626' },
                ].map((s, i) => (
                  <div key={i} style={{ marginBottom:'10px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
                      <span style={{ fontSize:'12px', fontWeight:500 }}>{s.source}</span>
                      <span style={{ fontSize:'11px', color:'#64748B' }}>{s.applied} → {s.shortlisted} → {s.joined} joined</span>
                    </div>
                    <div style={{ background:'#F1F5F9', borderRadius:'4px', height:'8px', overflow:'hidden' }}>
                      <div style={{ width:`${(s.applied/32)*100}%`, background:s.color, height:'100%', borderRadius:'4px' }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Time to Hire by Grade */}
              <div style={C.card}>
                <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>Time to Hire by Grade</div>
                {[
                  { grade:'L1/L2', days:45, color:'#7C3AED' },
                  { grade:'M3/M2', days:32, color:'#1D4ED8' },
                  { grade:'M1', days:24, color:'#0D9488' },
                  { grade:'E3/E2', days:18, color:'#16A34A' },
                  { grade:'E1', days:12, color:'#D97706' },
                  { grade:'W1/W2', days:5, color:'#DC2626' },
                ].map((g, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
                    <div style={{ fontSize:'11px', width:'60px', fontWeight:500, color:g.color }}>{g.grade}</div>
                    <div style={{ flex:1, background:'#F1F5F9', borderRadius:'4px', height:'20px', overflow:'hidden' }}>
                      <div style={{ width:`${(g.days/45)*100}%`, background:g.color, height:'100%', borderRadius:'4px', display:'flex', alignItems:'center', paddingLeft:'6px' }}>
                        <span style={{ fontSize:'10px', color:'#fff', fontWeight:600 }}>{g.days}d</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI vs HR Decision */}
            <div style={C.card}>
              <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'12px' }}>AI vs HR Decision Comparison</div>
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#F8FAFC' }}>
                    {['Candidate','Job','AI Tag','AI Score','HR Decision','Outcome','Match?'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left' as const, fontWeight:600, color:'#374151', borderBottom:'1px solid #E2E8F0', fontSize:'11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CANDIDATE_DATA.filter(c => c.stage !== 'Applied').slice(0,5).map((c, i) => (
                    <tr key={c.id} style={{ borderBottom:'1px solid #F1F5F9', background:i%2===0?'#F8FAFC':'#fff' }}>
                      <td style={{ padding:'8px 10px', fontWeight:500 }}>{c.name}</td>
                      <td style={{ padding:'8px 10px', color:'#64748B', fontSize:'11px' }}>{c.jobTitle}</td>
                      <td style={{ padding:'8px 10px' }}>
                        <span style={{ padding:'2px 6px', borderRadius:'5px', fontSize:'10px', fontWeight:500, ...AI_COLORS[c.aiTag] }}>{c.aiTag}</span>
                      </td>
                      <td style={{ padding:'8px 10px', fontWeight:600, color:c.aiScore>=75?'#16A34A':c.aiScore>=50?'#D97706':'#DC2626' }}>{c.aiScore}%</td>
                      <td style={{ padding:'8px 10px', color:'#374151' }}>{c.stage==='Rejected'?'Rejected':'Proceeding'}</td>
                      <td style={{ padding:'8px 10px' }}>
                        <span style={{ padding:'2px 6px', borderRadius:'5px', fontSize:'10px', background:c.stage==='Joined'?'#DCFCE7':c.stage==='Rejected'?'#FEE2E2':'#F1F5F9', color:c.stage==='Joined'?'#16A34A':c.stage==='Rejected'?'#DC2626':'#374151' }}>{c.stage}</span>
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'center' as const }}>
                        {c.aiTag==='Strong Match' && c.stage!=='Rejected' ? '✅' : c.aiTag==='Not Suitable' && c.stage==='Rejected' ? '✅' : '⚠️'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}