'use client'
// app/pms-preview/page.tsx — a test harness, not a product screen.
//
// The real PMS sits behind auth and behind migration 066, so neither a
// screenshot nor an overflow probe can reach the tabs through it. This mounts
// each one directly, in a <section data-case> the harnesses key off.
//
// It is kept rather than deleted after use, because deleting it makes
// scripts/pms-overflow.py and scripts/pms-ux.py unrunnable — a suite you
// cannot re-run is a suite that stops being true. It renders nothing outside
// development, so no unauthenticated route ships.
//
// THE FIXTURES ARE DELIBERATELY AWKWARD. A team of four happy rows proves
// nothing: these carry a notice-period case, an exited one, a new joiner, a
// weightage that does not total 100, and a two-point self-versus-final gap,
// because those are the states the layout actually has to survive.

import { ConfigTab, PolicyTab, FillTab, UploadTab, PipTab, ReportsTab,
         FlowTab } from '@/components/pms/AdminTabs'
import { DashboardTab, KraTab, OneToOneTab, SelfRatingTab, ResultTab,
         AnalyticsTab } from '@/components/pms/EmployeeTabs'
import { TeamTab, ApproveTab, RateTab, PipRequestTab, TeamAnalyticsTab,
         FinaliseTab, FeedbackTab } from '@/components/pms/ManagerTabs'
import { STAGES } from '@/lib/pms/cycle'
import { type TeamMember } from '@/lib/pms/team'
import { type Kra } from '@/lib/pms/kra'
import { type Line } from '@/lib/pms/scoring'
import { type Log } from '@/lib/pms/oneToOne'
import Channel from '@/components/broadcast/Channel'
import { Compose, PublisherSetup, Responses } from '@/components/broadcast/Admin'
import { type Broadcast, type Publisher } from '@/lib/broadcast/channel'
import '@/components/pms/pms.css'

const TODAY = '2026-09-04'

const KRAS: Kra[] = [
  { seq_no: 1, kra_title: 'Payroll accuracy', kpi_metric: 'Error rate per run', target_value: 'under 0.2%', category: 'PROCESS', weightage: 25 },
  { seq_no: 2, kra_title: 'Statutory compliance', kpi_metric: 'Filings on time', target_value: '100%', category: 'COMPLIANCE', weightage: 20 },
  { seq_no: 3, kra_title: 'Query resolution', kpi_metric: 'Turnaround', target_value: 'under 2 days', category: 'CUSTOMER', weightage: 20 },
  { seq_no: 4, kra_title: 'Report automation', kpi_metric: 'Reports automated', target_value: '4 of 4', category: 'BUSINESS', weightage: 20 },
  // Deliberately below the per-KRA minimum, so the thin-row treatment shows.
  { seq_no: 5, kra_title: 'Audit readiness', kpi_metric: 'Observations', target_value: 'zero', category: 'COMPLIANCE', weightage: 3 },
]

const LINES: Line[] = [
  { goalId: '1', title: 'Payroll accuracy', category: 'PROCESS', weightage: 25, self: 4, rmL1: 5, rmL2: 5, final: 5 },
  { goalId: '2', title: 'Statutory compliance', category: 'COMPLIANCE', weightage: 20, self: 5, rmL1: 4, rmL2: 4, final: 4 },
  { goalId: '3', title: 'Query resolution', category: 'CUSTOMER', weightage: 20, self: 3, rmL1: 3, rmL2: 3, final: 3 },
  { goalId: '4', title: 'Report automation', category: 'BUSINESS', weightage: 20, self: 4, rmL1: 4, rmL2: 4, final: 4 },
  // A two-point gap — the MAJOR_GAP path.
  { goalId: '5', title: 'Audit readiness', category: 'COMPLIANCE', weightage: 15, self: 5, rmL1: 2, rmL2: 2, final: 2 },
]

const LOGS: Log[] = [
  { discussion_type: 'KRA_SETTING', discussion_date: '2026-04-05', mode: 'IN_PERSON',
    discussion_points: 'Weightage on automation cut from 20 to 15; audit readiness added at 10.',
    employee_ack: true, manager_ack: true },
  { discussion_type: 'MID_PERIOD', discussion_date: '2026-06-18', mode: 'VIDEO',
    discussion_points: 'Automation at 2 of 4. Query turnaround slipping — support discussed.',
    employee_ack: true, manager_ack: false },
]

const m = (o: Partial<TeamMember> & { employeeId: string; code: string; name: string }): TeamMember => ({
  kraCount: 6, totalWeightage: 100, oneToOneDone: true, selfSubmitted: true,
  selfScore: 4.15, rmL1Score: null, rmL2Score: null, finalRating: null, finalised: false, ...o,
})

const TEAM: TeamMember[] = [
  m({ employeeId: '1', code: 'SRS0512', name: 'Rajesh Mehta', rmL1Score: 4.0, rmL2Score: 4.0 }),
  m({ employeeId: '2', code: 'SRS0518', name: 'Neha Bansal', flagOverride: 'NOTICE_PERIOD',
      dateOfLeaving: '2026-09-28', selfScore: 4.6 }),
  m({ employeeId: '3', code: 'SRS0509', name: 'Deepak Nair', flagOverride: 'EXITED',
      dateOfLeaving: '2026-06-30', selfScore: 3.55, rmL1Score: 3.0, rmL2Score: 3.0 }),
  // Weightage that does not total 100 — the send-back path.
  m({ employeeId: '4', code: 'SRS0523', name: 'Amit Deshmukh', totalWeightage: 80,
      oneToOneDone: false, selfSubmitted: false, selfScore: null }),
  // A new joiner has nothing yet — no KRAs means there cannot have been a
  // KRA one-to-one either, and a row claiming both is incoherent.
  m({ employeeId: '5', code: 'SRS0547', name: 'Manish Gupta', flagOverride: 'NEW_JOINER',
      kraCount: 0, totalWeightage: 0, oneToOneDone: false,
      selfSubmitted: false, selfScore: null }),
  m({ employeeId: '6', code: 'SRS0529', name: 'Sneha Iyer', finalRating: 4, finalised: true,
      rmL1Score: 4, rmL2Score: 4 }),
]

const BROADCASTS: Broadcast[] = [
  { id: 'b1', title: 'Gurugram office closed this Friday for the electrical audit',
    body: 'The annual electrical safety audit runs all day on Friday 12 September and the building will be closed.\n\nWork from home; the VPN and all systems are unaffected. Anyone who needs to collect equipment should do so by Thursday 6pm.',
    priority: 'URGENT', publishedBy: 'hr', publisherName: 'Priya Nair',
    sourceDepartment: 'Administration', publishedAt: '2026-09-02T09:00:00Z',
    isPinned: true, isActive: true },
  { id: 'b2', title: 'Investment proof submission closes on 30 September',
    body: 'Upload your Section 80C, 80D and HRA proofs in ESS before 30 September. Anything not submitted by then is treated as not claimed for this year, and the December payroll will deduct accordingly.\n\nThe Finance helpdesk is open all week for questions.',
    priority: 'IMPORTANT', publishedBy: 'fin', publisherName: 'Rakesh Menon',
    sourceDepartment: 'Finance & Accounts', publishedAt: '2026-09-01T11:00:00Z',
    isPinned: false, isActive: true },
  { id: 'b3', title: 'Canteen menu for September is on the noticeboard',
    body: 'The September menu is up, with the new Thursday South Indian counter. Feedback goes to the admin desk as usual.',
    priority: 'NORMAL', publishedBy: 'hr', publisherName: 'Priya Nair',
    sourceDepartment: 'Administration', publishedAt: '2026-09-03T07:30:00Z',
    isPinned: false, isActive: true },
]

const PUBLISHERS: Publisher[] = [
  { employeeId: 'hr', name: 'Priya Nair', isActive: true,
    grantedBy: 'Anil Kapoor', grantReason: 'Head of HR' },
  { employeeId: 'fin', name: 'Rakesh Menon', isActive: true,
    grantedBy: 'Anil Kapoor', grantReason: 'Finance — payroll and statutory notices' },
  { employeeId: 'old', name: 'Sunil Bhat', isActive: false },
]

const CASES: [string, React.ReactNode][] = [
  // Broadcast channel
  ['bc-channel', <Channel key="bc" employeeId="emp" items={BROADCASTS}
      readIds={new Set(['b3'])} onRead={() => {}} onRespond={() => {}} />],
  ['bc-compose', <Compose key="bcc" me="hr" publishers={PUBLISHERS} headcount={402}
      departments={[{ id: 'd1', name: 'Finance & Accounts' }, { id: 'd2', name: 'Administration' }]}
      onSend={() => {}} />],
  ['bc-setup', <PublisherSetup key="bcs" publishers={PUBLISHERS}
      staff={[{ id: 'x', name: 'Meera Krishnan', code: 'SRS0101' }]}
      onGrant={() => {}} onRevoke={() => {}} />],
  ['bc-responses', <Responses key="bcr" rows={[
      { id: 'r1', broadcastTitle: 'Gurugram office closed this Friday',
        authorName: 'Amit Deshmukh', createdAt: '2026-09-02T10:00:00Z', readAt: null,
        body: 'The Pune plant runs a Friday shift — does the closure apply there too? The notice says Gurugram but the subject line reads company-wide.' },
    ]} onOpen={() => {}} />],
  // HR Admin
  ['config',   <ConfigTab key="c" freq="QUARTERLY" onFreq={() => {}}
                          fyStart="2026-04-01" fyLabel="2026-27" today={TODAY} />],
  ['policies', <PolicyTab key="p" policies={[]} people={[]} />],
  ['fill',     <FillTab key="f" rows={[]} deptNames={{}} loading={false} />],
  ['upload',   <UploadTab key="u" />],
  ['pip',      <PipTab key="i" queue={[]} />],
  ['reports',  <ReportsTab key="r" />],
  ['flow',     <FlowTab key="h" />],
  // Employee
  ['emp-dashboard', <DashboardTab key="ed" who={{ name: 'Rajesh Mehta', code: 'SRS0512',
      designation: 'Senior Executive — Payroll', department: 'Finance & Accounts',
      rmL1: 'Priya Nair', rmL2: 'Sunil Bhat', hod: 'Anil Kapoor' }}
      stages={STAGES.map((s, i) => ({ key: s.key,
        state: i < 3 ? 'done' as const : i === 3 ? 'active' as const : 'upcoming' as const,
        detail: i === 0 ? '5 KRAs' : '' }))}
      current="self" kraCount={5} weightage={88} frequency="Quarterly"
      periodLabel="July to September 2026" lastRating={4} lastScore={3.86}
      actionLabel="Your self rating" actionNote="Rate every KRA, then submit — it locks" />],
  ['emp-kras', <KraTab key="ek" kras={KRAS} onChange={() => {}} locked={false}
      lockGate={{ open: false, because: 'Neither side has acknowledged this yet.' }}
      onSubmit={() => {}} />],
  ['emp-o2o',  <OneToOneTab key="eo" logs={LOGS} managerName="Priya Nair (RM L1)" />],
  ['emp-self', <SelfRatingTab key="es" submitted={false} onSubmit={() => {}} onChange={() => {}}
      rows={LINES.map(l => ({ goalId: l.goalId, title: l.title, weightage: l.weightage,
        category: l.category, achievement: '0.11% across 3 runs', rating: l.self ?? null,
        comment: 'Pre-run validation checklist introduced' }))} />],
  ['emp-result', <ResultTab key="er" published lines={LINES} finalRating={4}
      finalisedBy="Anil Kapoor (HOD)" finalisedOn="2026-08-30" deptAverage={3.24}
      appreciation="Took the payroll checklist from an idea to something the whole department now runs."
      improvement="Audit readiness slipped twice. Book the compliance calendar review before the next period opens."
      benefits={[{ type: 'Certificate', note: 'Process improvement, Q1' }]}
      publishGate={{ open: true, because: '' }} onAcknowledge={() => {}} />],
  ['emp-analytics', <AnalyticsTab key="ea" published lines={LINES}
      trend={[{ period: 'April to June 2026', score: 3.6 },
              { period: 'July to September 2026', score: 3.86 }]} />],
  // RM
  ['rm-team',     <TeamTab key="rt" members={TEAM} today={TODAY} managerName="Priya Nair (RM L1)" />],
  ['rm-approve',  <ApproveTab key="ra" members={TEAM} today={TODAY} />],
  ['rm-rate',     <RateTab key="rr" member={TEAM[0]} overallComment="" onOverallComment={() => {}}
      onChange={() => {}} onSubmit={() => {}}
      rows={LINES.map(l => ({ goalId: l.goalId, title: l.title, category: l.category,
        weightage: l.weightage, achievement: '0.11% across 3 runs', selfRating: l.self ?? null,
        selfComment: 'Checklist introduced', myRating: l.rmL1 ?? null,
        myComment: '' }))} />],
  ['rm-pip',      <PipRequestTab key="rp" members={TEAM} today={TODAY} />],
  ['rm-analytics',<TeamAnalyticsTab key="rn" members={TEAM} today={TODAY} lines={LINES}
      deptAverage={3.24} companyAverage={3.41} scopeLabel="your team" />],
  // HOD
  ['hod-finalise', <FinaliseTab key="hf" members={TEAM} today={TODAY} role="HOD"
      chain="SELF_RM1_RM2_HOD" whoCanFinalise="RM1_RM2_HOD" deptName="Finance & Accounts" />],
  ['hod-feedback', <FeedbackTab key="hb" member={TEAM[0]} rating={2}
      appreciation="" improvement="" benefits={[]} logs={LOGS} onChange={() => {}} />],
]

export default function PmsPreview() {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div className="pms" style={{ padding: 24, maxWidth: 1440, margin: '0 auto' }}>
      {CASES.map(([name, node]) => (
        <section key={name} data-case={name} style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em',
                       color: 'var(--ez-faint)', marginBottom: 10 }}>{name}</h2>
          {node}
        </section>
      ))}
    </div>
  )
}
