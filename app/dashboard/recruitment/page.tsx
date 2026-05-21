'use client'
import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────
type Tab = 'dashboard' | 'mrf' | 'jobs' | 'pipeline' | 'interviews' | 'offers' | 'analytics'
type MRFStatus = 'Pending' | 'Approved' | 'Rejected'
type JobStatus = 'Open' | 'On Hold' | 'Closed' | 'Draft'
type CandidateStage = 'Applied' | 'AI Screened' | 'HR Round' | 'L1 Interview' | 'L2 Interview' | 'Final Round' | 'Offer' | 'Joined' | 'Rejected'
type AITag = 'Strong Match' | 'Partial Match' | 'Not Suitable' | 'Pending'

// ── Sample Data ───────────────────────────────────────────
const mrfData = [
  { id: 'MRF-001', position: 'Senior Production Engineer', department: 'Manufacturing', location: 'Panipat Factory', openings: 2, urgency: 'High', reason: 'Expansion', status: 'Approved' as MRFStatus, requestedBy: 'Suresh Verma', date: '10 May 2026' },
  { id: 'MRF-002', position: 'HR Executive', department: 'Human Resources', location: 'Delhi HQ', openings: 1, urgency: 'Medium', reason: 'Replacement', status: 'Pending' as MRFStatus, requestedBy: 'Priya Malhotra', date: '13 May 2026' },
  { id: 'MRF-003', position: 'Sales Manager', department: 'Sales', location: 'Mumbai Office', openings: 3, urgency: 'High', reason: 'New Position', status: 'Approved' as MRFStatus, requestedBy: 'Rahul Gupta', date: '08 May 2026' },
  { id: 'MRF-004', position: 'Accounts Executive', department: 'Finance', location: 'Delhi HQ', openings: 1, urgency: 'Low', reason: 'Replacement', status: 'Rejected' as MRFStatus, requestedBy: 'Anita Sharma', date: '05 May 2026' },
]

const jobsData = [
  { id: 'JOB-001', title: 'Senior Production Engineer', dept: 'Manufacturing', location: 'Panipat Factory', expMin: 5, expMax: 10, salMin: 50000, salMax: 80000, applicants: 24, status: 'Open' as JobStatus, daysOpen: 7, skills: ['AutoCAD', 'PLC', 'Six Sigma'], stage: { applied: 24, screened: 18, interview: 6, offer: 2 } },
  { id: 'JOB-002', title: 'HR Executive', dept: 'Human Resources', location: 'Delhi HQ', expMin: 2, expMax: 5, salMin: 25000, salMax: 40000, applicants: 41, status: 'Open' as JobStatus, daysOpen: 4, skills: ['Payroll', 'Recruitment', 'HRMS'], stage: { applied: 41, screened: 30, interview: 8, offer: 0 } },
  { id: 'JOB-003', title: 'Sales Manager', dept: 'Sales', location: 'Mumbai Office', expMin: 7, expMax: 15, salMin: 80000, salMax: 150000, applicants: 15, status: 'Open' as JobStatus, daysOpen: 9, skills: ['B2B Sales', 'Team Management', 'CRM'], stage: { applied: 15, screened: 10, interview: 4, offer: 1 } },
  { id: 'JOB-004', title: 'React Developer', dept: 'IT', location: 'Delhi HQ', expMin: 3, expMax: 6, salMin: 60000, salMax: 100000, applicants: 38, status: 'On Hold' as JobStatus, daysOpen: 15, skills: ['React', 'TypeScript', 'Node.js'], stage: { applied: 38, screened: 25, interview: 0, offer: 0 } },
]

const candidatesData = [
  { id: 'C001', name: 'Amit Kumar Singh', job: 'JOB-001', jobTitle: 'Senior Production Engineer', email: 'amit.singh@email.com', phone: '9876543210', exp: 7, currentCo: 'Tata Steel', currentCTC: 65000, expectedCTC: 75000, notice: 60, source: 'Naukri', stage: 'AI Screened' as CandidateStage, aiScore: 87, aiTag: 'Strong Match' as AITag, aiReason: 'Strong match — 7 yrs manufacturing, AutoCAD & PLC certified. Salary within range. Minor concern: no Six Sigma certification.', applied: '11 May 2026' },
  { id: 'C002', name: 'Priya Sharma', job: 'JOB-001', jobTitle: 'Senior Production Engineer', email: 'priya.s@email.com', phone: '9812345678', exp: 5, currentCo: 'Maruti Suzuki', currentCTC: 52000, expectedCTC: 68000, notice: 30, source: 'LinkedIn', stage: 'L1 Interview' as CandidateStage, aiScore: 79, aiTag: 'Strong Match' as AITag, aiReason: 'Good profile — 5 yrs relevant experience, PLC skills match. Salary fit. Expected CTC slightly above budget.', applied: '10 May 2026' },
  { id: 'C003', name: 'Rohit Verma', job: 'JOB-002', jobTitle: 'HR Executive', email: 'rohit.v@email.com', phone: '9998887776', exp: 3, currentCo: 'InfoEdge', currentCTC: 28000, expectedCTC: 35000, notice: 30, source: 'Reference', stage: 'HR Round' as CandidateStage, aiScore: 92, aiTag: 'Strong Match' as AITag, aiReason: 'Excellent match — HRMS experience, payroll knowledge, recruitment background. All skills match. Salary fit perfectly.', applied: '14 May 2026' },
  { id: 'C004', name: 'Sunita Devi', job: 'JOB-002', jobTitle: 'HR Executive', email: 'sunita.d@email.com', phone: '9876512345', exp: 2, currentCo: 'Freelance', currentCTC: 18000, expectedCTC: 28000, notice: 15, source: 'Walk-in', stage: 'Applied' as CandidateStage, aiScore: 45, aiTag: 'Not Suitable' as AITag, aiReason: 'Partial skills match — basic HR knowledge. Missing payroll & HRMS experience. Salary fit but experience below requirement.', applied: '15 May 2026' },
  { id: 'C005', name: 'Vikram Malhotra', job: 'JOB-003', jobTitle: 'Sales Manager', email: 'vikram.m@email.com', phone: '9111222333', exp: 10, currentCo: 'Hindustan Unilever', currentCTC: 120000, expectedCTC: 145000, notice: 90, source: 'LinkedIn', stage: 'Final Round' as CandidateStage, aiScore: 95, aiTag: 'Strong Match' as AITag, aiReason: 'Excellent profile — 10 yrs B2B sales, managed 15-person team, CRM expert. Premium brand experience. Salary at upper range.', applied: '09 May 2026' },
  { id: 'C006', name: 'Deepak Joshi', job: 'JOB-001', jobTitle: 'Senior Production Engineer', email: 'deepak.j@email.com', phone: '9444555666', exp: 4, currentCo: 'Bharat Electronics', currentCTC: 45000, expectedCTC: 60000, notice: 45, source: 'Naukri', stage: 'Rejected' as CandidateStage, aiScore: 38, aiTag: 'Not Suitable' as AITag, aiReason: 'Experience below requirement. Missing key skills — no PLC or AutoCAD experience. Salary fit but role mismatch.', applied: '11 May 2026' },
  { id: 'C007', name: 'Kavya Reddy', job: 'JOB-003', jobTitle: 'Sales Manager', email: 'kavya.r@email.com', phone: '9777888999', exp: 8, currentCo: 'Asian Paints', currentCTC: 95000, expectedCTC: 130000, notice: 60, source: 'Consultant', stage: 'Offer' as CandidateStage, aiScore: 88, aiTag: 'Strong Match' as AITag, aiReason: 'Strong profile — 8 yrs sales leadership, B2B experience, team of 10. Good cultural fit. Notice period is concern.', applied: '09 May 2026' },
]

const interviewsData = [
  { id: 'I001', candidate: 'Priya Sharma', job: 'Senior Production Engineer', round: 'L1 Interview', interviewer: 'Suresh Verma', date: '17 May 2026', time: '11:00 AM', mode: 'In-person', status: 'Today', feedback: null },
  { id: 'I002', candidate: 'Rohit Verma', job: 'HR Executive', round: 'HR Round', interviewer: 'Priya Malhotra', date: '17 May 2026', time: '3:00 PM', mode: 'Video', status: 'Today', feedback: null },
  { id: 'I003', candidate: 'Vikram Malhotra', job: 'Sales Manager', round: 'Final Round', interviewer: 'MD - Ramesh Sharma', date: '18 May 2026', time: '10:00 AM', mode: 'In-person', status: 'Tomorrow', feedback: null },
  { id: 'I004', candidate: 'Amit Kumar Singh', job: 'Senior Production Engineer', round: 'HR Round', interviewer: 'Priya Malhotra', date: '15 May 2026', time: '2:00 PM', mode: 'Video', status: 'Done', feedback: { rating: 4, notes: 'Good communication, technical knowledge solid.', recommendation: 'Proceed' } },
]

const offersData = [
  { id: 'OFF-001', candidate: 'Kavya Reddy', job: 'Sales Manager', ctc: 130000, doj: '01 Jun 2026', status: 'Accepted', sentDate: '14 May 2026', respondedDate: '16 May 2026' },
  { id: 'OFF-002', candidate: 'Vikram Malhotra', job: 'Sales Manager', ctc: 145000, doj: '15 Jun 2026', status: 'Pending', sentDate: '16 May 2026', respondedDate: null },
]

// ── Constants ─────────────────────────────────────────────
const STAGES: CandidateStage[] = ['Applied', 'AI Screened', 'HR Round', 'L1 Interview', 'L2 Interview', 'Final Round', 'Offer', 'Joined', 'Rejected']
const STAGE_COLORS: Record<CandidateStage, { bg: string; color: string }> = {
  'Applied': { bg: '#F1F5F9', color: '#64748B' },
  'AI Screened': { bg: '#EDE9FE', color: '#7C3AED' },
  'HR Round': { bg: '#DBEAFE', color: '#1D4ED8' },
  'L1 Interview': { bg: '#FEF3C7', color: '#D97706' },
  'L2 Interview': { bg: '#FED7AA', color: '#C2410C' },
  'Final Round': { bg: '#FCE7F3', color: '#BE185D' },
  'Offer': { bg: '#D1FAE5', color: '#065F46' },
  'Joined': { bg: '#DCFCE7', color: '#16A34A' },
  'Rejected': { bg: '#FEE2E2', color: '#DC2626' },
}
const AI_TAG_CONFIG: Record<AITag, { bg: string; color: string; icon: string }> = {
  'Strong Match': { bg: '#DCFCE7', color: '#16A34A', icon: '✅' },
  'Partial Match': { bg: '#FEF3C7', color: '#D97706', icon: '⚠️' },
  'Not Suitable': { bg: '#FEE2E2', color: '#DC2626', icon: '❌' },
  'Pending': { bg: '#F1F5F9', color: '#64748B', icon: '⏳' },
}
const URGENCY_COLORS: Record<string, { bg: string; color: string }> = {
  High: { bg: '#FEE2E2', color: '#DC2626' },
  Medium: { bg: '#FEF3C7', color: '#D97706' },
  Low: { bg: '#DCFCE7', color: '#16A34A' },
}
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Approved: { bg: '#DCFCE7', color: '#16A34A' },
  Pending: { bg: '#FEF3C7', color: '#D97706' },
  Rejected: { bg: '#FEE2E2', color: '#DC2626' },
  Open: { bg: '#DCFCE7', color: '#16A34A' },
  'On Hold': { bg: '#FEF3C7', color: '#D97706' },
  Closed: { bg: '#FEE2E2', color: '#DC2626' },
  Draft: { bg: '#F1F5F9', color: '#64748B' },
  Accepted: { bg: '#DCFCE7', color: '#16A34A' },
  'Pending Acceptance': { bg: '#FEF3C7', color: '#D97706' },
}

const TAB_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'mrf', label: 'Requisitions', icon: '📋' },
  { id: 'jobs', label: 'Job Openings', icon: '💼' },
  { id: 'pipeline', label: 'Pipeline', icon: '👥' },
  { id: 'interviews', label: 'Interviews', icon: '📅' },
  { id: 'offers', label: 'Offers', icon: '📄' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
]

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: '#F8FAFC', boxSizing: 'border-box' as any, color: '#0F172A' }
const sel: React.CSSProperties = { ...inp, appearance: 'auto' as any }
const priBtn: React.CSSProperties = { padding: '9px 20px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }
const secBtn: React.CSSProperties = { padding: '9px 16px', background: '#fff', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }
const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '16px' }

export default function Recruitment() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [selectedJob, setSelectedJob] = useState<string>('JOB-001')
  const [showMRFForm, setShowMRFForm] = useState(false)
  const [showJobForm, setShowJobForm] = useState(false)
  const [showAddCandidate, setShowAddCandidate] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [showAIResult, setShowAIResult] = useState<string | null>(null)
  const [candidates, setCandidates] = useState(candidatesData)
  const [dragOver, setDragOver] = useState<CandidateStage | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const pipelineCandidates = candidates.filter(c => c.job === selectedJob && c.stage !== 'Rejected')
  const selectedCandidateData = candidates.find(c => c.id === selectedCandidate)

  const moveCandidate = (candidateId: string, newStage: CandidateStage) => {
    setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, stage: newStage } : c))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F0F4F8', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: '13px' }}>

      {/* Topbar */}
      <div style={{ background: '#fff', padding: '11px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '12px', color: '#64748B' }}>
          Sharma Group &nbsp;›&nbsp; <span style={{ color: '#7C3AED', fontWeight: 500 }}>Recruitment</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button style={secBtn} onClick={() => setShowMRFForm(true)}>+ New Requisition</button>
          <button style={priBtn} onClick={() => setShowJobForm(true)}>+ Post Job</button>
          <div style={{ width: '30px', height: '30px', background: '#7C3AED', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 600 }}>KS</div>
        </div>
      </div>

      {/* Sub Navigation */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E2E8F0', padding: '0 20px', display: 'flex', gap: '0', overflowX: 'auto' }}>
        {TAB_ITEMS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#7C3AED' : '#64748B', borderBottom: tab === t.id ? '2px solid #7C3AED' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'Open Positions', value: '4', sub: '8 total openings', color: '#7C3AED' },
                { label: 'Total Applicants', value: '118', sub: '▲ 23 this week', color: '#16A34A' },
                { label: 'Interviews Today', value: '2', sub: 'Priya & Rohit', color: '#3B82F6' },
                { label: 'Offers Pending', value: '1', sub: 'Vikram Malhotra', color: '#F97316' },
                { label: 'Avg. Time to Hire', value: '18d', sub: 'Industry avg: 30d', color: '#EF4444' },
              ].map((s, i) => (
                <div key={i} style={{ ...card, borderTop: `3px solid ${s.color}`, padding: '12px 14px' }}>
                  <div style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '4px' }}>{s.label}</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{s.value}</div>
                  <div style={{ fontSize: '10px', color: '#64748B' }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {/* Active Jobs */}
              <div style={card}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                  💼 Active Job Openings
                  <span style={{ fontSize: '11px', color: '#7C3AED', cursor: 'pointer' }} onClick={() => setTab('jobs')}>View All →</span>
                </div>
                {jobsData.filter(j => j.status === 'Open').map((j, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < 2 ? '1px solid #F1F5F9' : 'none' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>💼</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: '#0F172A' }}>{j.title}</div>
                      <div style={{ fontSize: '10px', color: '#94A3B8' }}>{j.dept} · {j.location} · {j.daysOpen} days open</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#7C3AED' }}>{j.applicants}</div>
                      <div style={{ fontSize: '10px', color: '#94A3B8' }}>applicants</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Today's Interviews */}
              <div style={card}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                  📅 Today's Schedule
                  <span style={{ fontSize: '11px', color: '#7C3AED', cursor: 'pointer' }} onClick={() => setTab('interviews')}>View All →</span>
                </div>
                {interviewsData.filter(i => i.status === 'Today' || i.status === 'Tomorrow').map((iv, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: i < 2 ? '1px solid #F1F5F9' : 'none', alignItems: 'flex-start' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: iv.status === 'Today' ? '#DBEAFE' : '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>📅</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500 }}>{iv.candidate}</div>
                      <div style={{ fontSize: '10px', color: '#94A3B8' }}>{iv.round} · {iv.time} · {iv.mode}</div>
                      <div style={{ fontSize: '10px', color: '#64748B' }}>Interviewer: {iv.interviewer}</div>
                    </div>
                    <span style={{ padding: '2px 7px', borderRadius: '8px', fontSize: '10px', fontWeight: 500, background: iv.status === 'Today' ? '#DBEAFE' : '#F1F5F9', color: iv.status === 'Today' ? '#1D4ED8' : '#64748B' }}>{iv.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pipeline Overview */}
            <div style={card}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>🔄 Pipeline Overview — All Jobs</div>
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                {['Applied', 'AI Screened', 'HR Round', 'Interview', 'Offer', 'Joined'].map((stage, i) => {
                  const counts = [118, 83, 24, 10, 2, 1]
                  const colors = ['#64748B', '#7C3AED', '#3B82F6', '#F97316', '#16A34A', '#16A34A']
                  return (
                    <div key={i} style={{ flex: '0 0 130px', background: '#F8FAFC', borderRadius: '8px', padding: '12px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: colors[i] }}>{counts[i]}</div>
                      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>{stage}</div>
                      {i < 5 && <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>→ {Math.round(counts[i + 1] / counts[i] * 100)}% conversion</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── MRF ── */}
        {tab === 'mrf' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A' }}>Manpower Requisitions</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>Department head requests for new hiring</div>
              </div>
              <button style={priBtn} onClick={() => setShowMRFForm(true)}>+ New Requisition</button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: 'Pending Approval', value: mrfData.filter(m => m.status === 'Pending').length, color: '#D97706', bg: '#FEF3C7' },
                { label: 'Approved', value: mrfData.filter(m => m.status === 'Approved').length, color: '#16A34A', bg: '#DCFCE7' },
                { label: 'Total Openings', value: mrfData.filter(m => m.status === 'Approved').reduce((sum, m) => sum + m.openings, 0), color: '#7C3AED', bg: '#EDE9FE' },
              ].map((s, i) => (
                <div key={i} style={{ ...card, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* MRF Table */}
            <div style={card}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['MRF ID', 'Position', 'Department', 'Location', 'Openings', 'Urgency', 'Reason', 'Requested By', 'Date', 'Status', 'Action'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mrfData.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 12px', color: '#7C3AED', fontWeight: 500 }}>{m.id}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 500, color: '#0F172A' }}>{m.position}</td>
                      <td style={{ padding: '10px 12px', color: '#64748B' }}>{m.department}</td>
                      <td style={{ padding: '10px 12px', color: '#64748B' }}>{m.location}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>{m.openings}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '10px', fontWeight: 500, background: URGENCY_COLORS[m.urgency].bg, color: URGENCY_COLORS[m.urgency].color }}>{m.urgency}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748B' }}>{m.reason}</td>
                      <td style={{ padding: '10px 12px', color: '#64748B' }}>{m.requestedBy}</td>
                      <td style={{ padding: '10px 12px', color: '#64748B', whiteSpace: 'nowrap' }}>{m.date}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '10px', fontWeight: 500, background: STATUS_COLORS[m.status]?.bg, color: STATUS_COLORS[m.status]?.color }}>{m.status}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {m.status === 'Pending' && (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button style={{ padding: '3px 8px', background: '#DCFCE7', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#16A34A', fontWeight: 500 }}>Approve</button>
                            <button style={{ padding: '3px 8px', background: '#FEE2E2', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#DC2626', fontWeight: 500 }}>Reject</button>
                          </div>
                        )}
                        {m.status === 'Approved' && <span style={{ fontSize: '11px', color: '#16A34A' }}>✓ Done</span>}
                        {m.status === 'Rejected' && <span style={{ fontSize: '11px', color: '#DC2626' }}>✗ Closed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── JOB OPENINGS ── */}
        {tab === 'jobs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A' }}>Job Openings</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>{jobsData.filter(j => j.status === 'Open').length} active positions</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select style={{ ...sel, width: 'auto', padding: '7px 12px' }}>
                  <option>All Departments</option>
                  <option>Manufacturing</option>
                  <option>Sales</option>
                  <option>HR</option>
                </select>
                <button style={priBtn} onClick={() => setShowJobForm(true)}>+ Post Job</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {jobsData.map((j, i) => (
                <div key={i} style={{ ...card, cursor: 'pointer' }} onClick={() => { setSelectedJob(j.id); setTab('pipeline') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', marginBottom: '3px' }}>{j.title}</div>
                      <div style={{ fontSize: '11px', color: '#64748B' }}>{j.dept} · {j.location}</div>
                    </div>
                    <span style={{ padding: '3px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: 500, background: STATUS_COLORS[j.status]?.bg, color: STATUS_COLORS[j.status]?.color }}>{j.status}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: '#64748B' }}>
                    <span>💰 ₹{(j.salMin / 1000).toFixed(0)}K–{(j.salMax / 1000).toFixed(0)}K</span>
                    <span>📅 {j.expMin}–{j.expMax} yrs exp</span>
                    <span>⏱ {j.daysOpen} days open</span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                    {j.skills.map(s => <span key={s} style={{ padding: '2px 7px', background: '#EDE9FE', color: '#7C3AED', borderRadius: '6px', fontSize: '10px' }}>{s}</span>)}
                  </div>

                  {/* Pipeline mini */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { label: 'Applied', count: j.stage.applied, color: '#64748B' },
                      { label: 'Screened', count: j.stage.screened, color: '#7C3AED' },
                      { label: 'Interview', count: j.stage.interview, color: '#F97316' },
                      { label: 'Offer', count: j.stage.offer, color: '#16A34A' },
                    ].map((s, si) => (
                      <div key={si} style={{ flex: 1, textAlign: 'center', padding: '6px 4px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: s.color }}>{s.count}</div>
                        <div style={{ fontSize: '9px', color: '#94A3B8' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── PIPELINE (KANBAN) ── */}
        {tab === 'pipeline' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A' }}>Candidate Pipeline</div>
                <select style={{ ...sel, width: 'auto', fontSize: '12px', padding: '5px 10px', marginTop: '4px' }} value={selectedJob} onChange={e => setSelectedJob(e.target.value)}>
                  {jobsData.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ background: '#EDE9FE', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', color: '#7C3AED', fontWeight: 500 }}>
                  🤖 AI Screening Active
                </div>
                <button style={priBtn} onClick={() => setShowAddCandidate(true)}>+ Add Candidate</button>
              </div>
            </div>

            {/* Kanban */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', minHeight: '500px' }}>
              {STAGES.filter(s => s !== 'Joined').map(stage => {
                const stageCandidates = pipelineCandidates.filter(c => c.stage === stage)
                return (
                  <div
                    key={stage}
                    onDragOver={e => { e.preventDefault(); setDragOver(stage) }}
                    onDrop={() => { if (dragging) { moveCandidate(dragging, stage); setDragging(null); setDragOver(null) } }}
                    style={{ flex: '0 0 180px', background: dragOver === stage ? '#EDE9FE' : '#F8FAFC', borderRadius: '10px', border: `2px solid ${dragOver === stage ? '#7C3AED' : '#E2E8F0'}`, padding: '10px', transition: 'all .15s' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: STAGE_COLORS[stage].color }}>{stage}</div>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: STAGE_COLORS[stage].bg, color: STAGE_COLORS[stage].color, fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stageCandidates.length}</span>
                    </div>

                    {stageCandidates.map(c => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={() => setDragging(c.id)}
                        onDragEnd={() => { setDragging(null); setDragOver(null) }}
                        onClick={() => setSelectedCandidate(c.id)}
                        style={{ background: '#fff', borderRadius: '8px', border: `1px solid ${dragging === c.id ? '#7C3AED' : '#E2E8F0'}`, padding: '10px', marginBottom: '6px', cursor: 'grab', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'transform .1s', opacity: dragging === c.id ? 0.7 : 1 }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#0F172A', marginBottom: '3px' }}>{c.name}</div>
                        <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '5px' }}>{c.exp}y exp · {c.currentCo}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '6px', background: AI_TAG_CONFIG[c.aiTag].bg, color: AI_TAG_CONFIG[c.aiTag].color, fontWeight: 500 }}>
                            {AI_TAG_CONFIG[c.aiTag].icon} {c.aiScore}%
                          </span>
                          <span style={{ fontSize: '9px', color: '#94A3B8' }}>{c.source}</span>
                        </div>
                      </div>
                    ))}

                    {stageCandidates.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 10px', color: '#CBD5E1', fontSize: '11px' }}>
                        Drop here
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── INTERVIEWS ── */}
        {tab === 'interviews' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>Interviews</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>2 scheduled today</div>
              </div>
              <button style={priBtn}>+ Schedule Interview</button>
            </div>

            {/* Today */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' }}>Today — 17 May 2026</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
              {interviewsData.filter(i => i.status === 'Today').map((iv, i) => (
                <div key={i} style={{ ...card, borderLeft: '4px solid #3B82F6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{iv.candidate}</div>
                      <div style={{ fontSize: '11px', color: '#64748B' }}>{iv.job}</div>
                    </div>
                    <span style={{ padding: '3px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: 600, background: '#DBEAFE', color: '#1D4ED8' }}>{iv.round}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#64748B', marginBottom: '10px' }}>
                    <span>🕐 {iv.time}</span>
                    <span>📱 {iv.mode}</span>
                    <span>👤 {iv.interviewer}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button style={{ ...priBtn, fontSize: '11px', padding: '6px 12px', flex: 1 }}>Submit Feedback</button>
                    <button style={{ ...secBtn, fontSize: '11px', padding: '6px 10px' }}>Reschedule</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Upcoming */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' }}>Upcoming</div>
            {interviewsData.filter(i => i.status === 'Tomorrow').map((iv, i) => (
              <div key={i} style={{ ...card, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>📅</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{iv.candidate} — {iv.round}</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{iv.job} · {iv.date} at {iv.time} · {iv.mode}</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Interviewer: {iv.interviewer}</div>
                </div>
                <span style={{ padding: '3px 9px', borderRadius: '8px', fontSize: '10px', background: '#F1F5F9', color: '#64748B' }}>{iv.status}</span>
              </div>
            ))}

            {/* Completed */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em', margin: '14px 0 8px' }}>Completed</div>
            {interviewsData.filter(i => i.status === 'Done').map((iv, i) => (
              <div key={i} style={{ ...card, marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{iv.candidate} — {iv.round}</div>
                    <div style={{ fontSize: '11px', color: '#64748B' }}>{iv.date} · {iv.interviewer}</div>
                  </div>
                  {iv.feedback && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[1,2,3,4,5].map(s => <span key={s} style={{ fontSize: '14px' }}>{s <= iv.feedback!.rating ? '⭐' : '☆'}</span>)}
                    </div>
                  )}
                </div>
                {iv.feedback && (
                  <div style={{ background: '#F8FAFC', borderRadius: '7px', padding: '8px 10px', fontSize: '11px', color: '#374151' }}>
                    <div style={{ marginBottom: '4px' }}>"{iv.feedback.notes}"</div>
                    <div style={{ fontSize: '10px', color: iv.feedback.recommendation === 'Proceed' ? '#16A34A' : '#DC2626', fontWeight: 500 }}>
                      Recommendation: {iv.feedback.recommendation}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── OFFERS ── */}
        {tab === 'offers' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>Offer Management</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>Generate and track candidate offers</div>
              </div>
              <button style={priBtn}>+ Generate Offer</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: 'Offers Sent', value: offersData.length, color: '#3B82F6', bg: '#DBEAFE' },
                { label: 'Accepted', value: offersData.filter(o => o.status === 'Accepted').length, color: '#16A34A', bg: '#DCFCE7' },
                { label: 'Acceptance Rate', value: '75%', color: '#7C3AED', bg: '#EDE9FE' },
              ].map((s, i) => (
                <div key={i} style={{ ...card, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {offersData.map((o, i) => (
              <div key={i} style={{ ...card, marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{o.candidate}</div>
                    <div style={{ fontSize: '12px', color: '#64748B' }}>{o.job} · DOJ: {o.doj}</div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 500, background: o.status === 'Accepted' ? '#DCFCE7' : '#FEF3C7', color: o.status === 'Accepted' ? '#16A34A' : '#D97706' }}>{o.status}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#374151', marginBottom: '12px' }}>
                  <span>💰 CTC: ₹{(o.ctc / 1000).toFixed(0)}K/month (₹{(o.ctc * 12 / 100000).toFixed(1)}L p.a.)</span>
                  <span>📤 Sent: {o.sentDate}</span>
                  {o.respondedDate && <span>✅ Responded: {o.respondedDate}</span>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ ...secBtn, fontSize: '11px', padding: '6px 12px' }}>📄 View Letter</button>
                  <button style={{ ...secBtn, fontSize: '11px', padding: '6px 12px' }}>📧 Resend</button>
                  {o.status !== 'Accepted' && <button style={{ ...priBtn, fontSize: '11px', padding: '6px 12px' }}>✓ Mark Accepted</button>}
                  {o.status === 'Accepted' && <button style={{ ...priBtn, fontSize: '11px', padding: '6px 12px', background: '#16A34A' }}>👤 Convert to Employee</button>}
                </div>
              </div>
            ))}

            {/* AI Offer Letter Generator */}
            <div style={{ ...card, background: 'linear-gradient(135deg,#EDE9FE,#E0F2FE)', border: '1px solid #C4B5FD', marginTop: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#7C3AED', marginBottom: '6px' }}>🤖 AI Offer Letter Generator</div>
              <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '12px' }}>Enter CTC details → Claude generates professional offer letter with company letterhead in 30 seconds</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Candidate Name</label><input style={inp} placeholder="Vikram Malhotra" /></div>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Designation</label><input style={inp} placeholder="Sales Manager" /></div>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Date of Joining</label><input style={{ ...inp }} type="date" /></div>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Basic (₹/month)</label><input style={inp} placeholder="72000" /></div>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>HRA (₹/month)</label><input style={inp} placeholder="36000" /></div>
                <div><label style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Special Allowance</label><input style={inp} placeholder="37000" /></div>
              </div>
              <button style={{ ...priBtn, background: '#7C3AED' }}>🤖 Generate Offer Letter with AI</button>
            </div>
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {tab === 'analytics' && (
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Recruitment Analytics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

              {/* Source effectiveness */}
              <div style={card}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Source Effectiveness</div>
                {[
                  { source: 'Naukri', candidates: 45, hired: 3, color: '#7C3AED' },
                  { source: 'LinkedIn', candidates: 32, hired: 2, color: '#3B82F6' },
                  { source: 'Reference', candidates: 18, hired: 4, color: '#16A34A' },
                  { source: 'Walk-in', candidates: 14, hired: 1, color: '#F97316' },
                  { source: 'Consultant', candidates: 9, hired: 2, color: '#EF4444' },
                ].map((s, i) => (
                  <div key={i} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '12px' }}>
                      <span style={{ fontWeight: 500 }}>{s.source}</span>
                      <span style={{ color: '#64748B' }}>{s.candidates} candidates · {s.hired} hired · {Math.round(s.hired / s.candidates * 100)}% conversion</span>
                    </div>
                    <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(s.candidates / 45 * 100)}%`, background: s.color, borderRadius: '4px' }} />
                    </div>
                  </div>
                ))}
                <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px', fontSize: '11px', color: '#374151', marginTop: '8px' }}>
                  🏆 Best source: <strong>Reference</strong> — 22% conversion rate (3x better than Naukri)
                </div>
              </div>

              {/* Time to hire */}
              <div style={card}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Time to Hire (Days)</div>
                {[
                  { stage: 'MRF to Job Post', days: 2, max: 7 },
                  { stage: 'Job Post to First Apply', days: 1, max: 7 },
                  { stage: 'AI Screening', days: 0.5, max: 7 },
                  { stage: 'HR Round', days: 3, max: 7 },
                  { stage: 'Technical Interviews', days: 5, max: 7 },
                  { stage: 'Offer to Acceptance', days: 4, max: 7 },
                  { stage: 'Acceptance to Joining', days: 30, max: 90 },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', fontSize: '11px' }}>
                    <div style={{ width: '140px', color: '#64748B', flexShrink: 0 }}>{s.stage}</div>
                    <div style={{ flex: 1, height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(s.days / s.max * 100)}%`, background: '#7C3AED', borderRadius: '4px' }} />
                    </div>
                    <div style={{ width: '30px', textAlign: 'right', fontWeight: 500, color: '#374151' }}>{s.days}d</div>
                  </div>
                ))}
                <div style={{ background: '#EDE9FE', borderRadius: '8px', padding: '10px', fontSize: '11px', color: '#7C3AED', marginTop: '8px', fontWeight: 500 }}>
                  Total avg: 18 days · Industry avg: 30 days · Ezer saves 40% time!
                </div>
              </div>

              {/* AI Screening stats */}
              <div style={{ ...card, gridColumn: '1 / -1' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>🤖 AI Screening Performance</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {[
                    { label: 'Resumes Screened', value: '118', icon: '📄', sub: 'This month', color: '#7C3AED', bg: '#EDE9FE' },
                    { label: 'Strong Matches', value: '31', icon: '✅', sub: '26% of total', color: '#16A34A', bg: '#DCFCE7' },
                    { label: 'AI Accuracy', value: '89%', icon: '🎯', sub: 'HR override rate: 11%', color: '#3B82F6', bg: '#DBEAFE' },
                    { label: 'Time Saved', value: '47 hrs', icon: '⏱', sub: 'vs manual screening', color: '#F97316', bg: '#FEF3C7' },
                  ].map((s, i) => (
                    <div key={i} style={{ background: s.bg, borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>{s.icon}</div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: '11px', fontWeight: 500, color: '#374151', marginTop: '2px' }}>{s.label}</div>
                      <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CANDIDATE DETAIL MODAL ── */}
      {selectedCandidate && selectedCandidateData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <div style={{ background: '#fff', width: '480px', height: '100vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>Candidate Profile</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748B' }} onClick={() => setSelectedCandidate(null)}>✕</button>
            </div>

            {/* Profile */}
            <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 600, color: '#7C3AED', flexShrink: 0 }}>
                  {selectedCandidateData.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '2px' }}>{selectedCandidateData.name}</div>
                  <div style={{ fontSize: '12px', color: '#64748B' }}>{selectedCandidateData.exp} yrs exp · {selectedCandidateData.currentCo}</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{selectedCandidateData.email} · {selectedCandidateData.phone}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                <div><span style={{ color: '#94A3B8' }}>Current CTC:</span> <strong>₹{(selectedCandidateData.currentCTC / 1000).toFixed(0)}K</strong></div>
                <div><span style={{ color: '#94A3B8' }}>Expected:</span> <strong>₹{(selectedCandidateData.expectedCTC / 1000).toFixed(0)}K</strong></div>
                <div><span style={{ color: '#94A3B8' }}>Notice:</span> <strong>{selectedCandidateData.notice} days</strong></div>
                <div><span style={{ color: '#94A3B8' }}>Source:</span> <strong>{selectedCandidateData.source}</strong></div>
              </div>
            </div>

            {/* Current Stage */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Current Stage</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {STAGES.filter(s => s !== 'Joined').map(s => (
                  <button key={s} onClick={() => moveCandidate(selectedCandidateData.id, s)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: s === selectedCandidateData.stage ? 600 : 400, background: s === selectedCandidateData.stage ? STAGE_COLORS[s].bg : '#F1F5F9', color: s === selectedCandidateData.stage ? STAGE_COLORS[s].color : '#64748B' }}>{s}</button>
                ))}
              </div>
            </div>

            {/* AI Analysis */}
            <div style={{ background: 'linear-gradient(135deg,#EDE9FE,#E0F2FE)', borderRadius: '10px', padding: '14px', marginBottom: '14px', border: '1px solid #C4B5FD' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#7C3AED' }}>🤖 AI Analysis</div>
                <div style={{ display: 'flex', align: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#7C3AED' }}>{selectedCandidateData.aiScore}%</span>
                  <span style={{ padding: '2px 7px', borderRadius: '6px', fontSize: '10px', fontWeight: 500, background: AI_TAG_CONFIG[selectedCandidateData.aiTag].bg, color: AI_TAG_CONFIG[selectedCandidateData.aiTag].color }}>{selectedCandidateData.aiTag}</span>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#374151', lineHeight: 1.6 }}>{selectedCandidateData.aiReason}</div>
              <button style={{ marginTop: '8px', padding: '4px 10px', background: 'rgba(124,58,237,0.1)', border: '1px solid #C4B5FD', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', color: '#7C3AED', fontWeight: 500 }}>Override AI Decision</button>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button style={{ ...priBtn, width: '100%' }}>📅 Schedule Interview</button>
              <button style={{ ...secBtn, width: '100%' }}>📄 View Resume</button>
              <button style={{ ...secBtn, width: '100%' }}>📨 Send Email</button>
              {selectedCandidateData.stage === 'Final Round' && <button style={{ ...priBtn, width: '100%', background: '#16A34A' }}>📋 Generate Offer Letter</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── ADD CANDIDATE MODAL ── */}
      {showAddCandidate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>Add Candidate</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }} onClick={() => setShowAddCandidate(false)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Full Name *</label><input style={inp} placeholder="Rahul Kumar" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Phone *</label><input style={inp} placeholder="9876543210" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Email *</label><input style={inp} placeholder="rahul@email.com" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Experience (years)</label><input style={inp} placeholder="5" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Current Company</label><input style={inp} placeholder="ABC Ltd" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Current CTC (₹/month)</label><input style={inp} placeholder="50000" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Expected CTC</label><input style={inp} placeholder="65000" /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Notice Period (days)</label><input style={inp} placeholder="30" /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Source</label>
                <select style={sel}>
                  {['Naukri', 'LinkedIn', 'Reference', 'Walk-in', 'Consultant', 'Campus', 'Other'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Resume Upload</label>
                <label style={{ cursor: 'pointer' }}>
                  <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} />
                  <div style={{ border: '2px dashed #E2E8F0', borderRadius: '8px', padding: '16px', textAlign: 'center', color: '#94A3B8', fontSize: '12px' }}>
                    📄 Click to upload resume (PDF/DOC)
                  </div>
                </label>
              </div>
            </div>
            <div style={{ background: '#EDE9FE', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: '#7C3AED', marginBottom: '12px' }}>
              🤖 Resume upload hone ke baad AI automatically screen karega aur match score dega
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={secBtn} onClick={() => setShowAddCandidate(false)}>Cancel</button>
              <button style={priBtn} onClick={() => setShowAddCandidate(false)}>Add & Screen with AI</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}