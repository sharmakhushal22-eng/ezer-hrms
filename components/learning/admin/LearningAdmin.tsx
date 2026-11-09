'use client'
// components/learning/admin/LearningAdmin.tsx — the shell: who this person is, which company
// they are in, and the tabs their permissions open. Each tab offers only what its API would
// accept; the routes check again regardless.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import type { LmsCaps } from '@/lib/lms/caps'
import { C, F, Page, PageHeader, S, Select, Skeleton, Tabs, W } from '@/lib/ui'
import { LoadError, useLoad, type Company, type Ctx } from './shared'
import OverviewTab from './OverviewTab'
import CoursesTab from './CoursesTab'
import CourseBuilder from './CourseBuilder'
import PathsTab from './PathsTab'
import AssignmentsTab from './AssignmentsTab'
import AutomationTab from './AutomationTab'
import PreboardingTab from './PreboardingTab'
import ReportsTab from './ReportsTab'
import CertificatesTab from './CertificatesTab'
import SettingsTab from './SettingsTab'
import AuditTab from './AuditTab'

type TabKey = 'overview' | 'courses' | 'paths' | 'assignments' | 'automation' | 'preboarding' | 'reports' | 'certificates' | 'settings' | 'audit'

const TABS: { key: TabKey; label: string; show: (c: LmsCaps) => boolean }[] = [
  { key: 'overview', label: 'Overview', show: c => c.reports || c.viewContent || c.viewAssignments },
  { key: 'courses', label: 'Courses', show: c => c.viewContent },
  { key: 'paths', label: 'Learning Paths', show: c => c.viewContent || c.assign },
  { key: 'assignments', label: 'Assignments', show: c => c.viewAssignments },
  { key: 'automation', label: 'Automation', show: c => c.automate },
  { key: 'preboarding', label: 'Preboarding', show: c => c.viewAssignments },
  { key: 'reports', label: 'Reports', show: c => c.reports },
  { key: 'certificates', label: 'Certificates', show: c => c.reports },
  { key: 'settings', label: 'Settings', show: c => c.publish },
  { key: 'audit', label: 'Audit log', show: c => c.publish || c.automate || c.reports },
]

interface Boot { caps: LmsCaps; branch_only: boolean; me: string | null; companies: Company[]; overview: any }

function CompanyPicker({ companies, value, onChange }: { companies: Company[]; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: S.sm, fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>
      Company
      <Select value={value} onChange={e => onChange(e.target.value)} style={{ width: 220 }}>
        <option value="">All companies</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
      </Select>
    </label>
  )
}

export default function LearningAdmin() {
  const [picked, setPicked] = useState('')
  const [tab, setTab] = useState<TabKey | null>(null)
  const [course, setCourse] = useState<string | null>(null)
  const boot = useLoad<Boot>(() => lmsApi(`/api/lms/admin/overview${picked ? `?company=${picked}` : ''}`), [picked])
  const d = boot.data

  const ctx: Ctx | null = useMemo(() => {
    if (!d) return null
    const solo = d.companies.length === 1 ? d.companies[0].id : null
    return { caps: d.caps, companies: d.companies, company: picked || solo, branchOnly: d.branch_only, me: d.me }
  }, [d, picked])

  const tabs = useMemo(() => (d ? TABS.filter(t => (t.key !== 'audit' || !d.branch_only) && t.show(d.caps)) : []), [d])
  const active: TabKey | undefined = tabs.some(t => t.key === tab) ? tab! : tabs[0]?.key

  const header = (
    <PageHeader
      title="Learning"
      context={ctx?.branchOnly ? 'Courses, assignments and reports. Your access covers your branch.' : 'Courses, assignments and reports'}
      actions={d && d.companies.length > 1 ? <CompanyPicker companies={d.companies} value={picked} onChange={v => { setCourse(null); setPicked(v) }} /> : undefined}
    />
  )

  if (!ctx) {
    return (
      <Page>
        <PageHeader title="Learning" context="Courses, assignments and reports" />
        {boot.error
          ? <LoadError error={boot.error} setup={boot.setup} />
          : <div style={{ display: 'grid', gap: S.md }}><Skeleton h={38} /><Skeleton h={120} /><Skeleton h={240} /></div>}
      </Page>
    )
  }

  // The builder takes the whole page: it has its own sections and needs the width.
  if (course) {
    return (
      <Page>
        <CourseBuilder key={course} ctx={ctx} courseId={course} onBack={() => { setCourse(null); boot.reload() }} onOpen={setCourse} />
      </Page>
    )
  }

  return (
    <Page>
      {header}
      <LoadError error={boot.error} setup={boot.setup} />
      {!tabs.length
        ? <LoadError error="Learning is not part of your access." />
        : <Tabs tabs={tabs.map(t => ({ key: t.key, label: t.label }))} value={active!} onChange={setTab} />}
      {/* Keyed by company, so a tab never shows one company's rows under another's name. */}
      <div key={ctx.company || 'all'}>
        {active === 'overview' && <OverviewTab ctx={ctx} overview={d!.overview} loading={boot.loading} />}
        {active === 'courses' && <CoursesTab ctx={ctx} onOpen={setCourse} />}
        {active === 'paths' && <PathsTab ctx={ctx} />}
        {active === 'assignments' && <AssignmentsTab ctx={ctx} />}
        {active === 'automation' && <AutomationTab ctx={ctx} />}
        {active === 'preboarding' && <PreboardingTab ctx={ctx} />}
        {active === 'reports' && <ReportsTab ctx={ctx} />}
        {active === 'certificates' && <CertificatesTab ctx={ctx} />}
        {active === 'settings' && <SettingsTab ctx={ctx} />}
        {active === 'audit' && <AuditTab ctx={ctx} />}
      </div>
    </Page>
  )
}
