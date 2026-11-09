'use client'
// components/learning/studio/Studio.tsx — the HR and L&D workspace inside EZER Learn, at
// /learning/studio/<section>[/<item>]. Each section offers only what its API would accept;
// the routes check again regardless.
//
// The frame is a header for the section, the section list beside it, and the section itself.
// A course opened from Courses gets the whole width instead: the builder has its own header.
import { useEffect, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import type { LmsCaps } from '@/lib/lms/caps'
import { IconCompliance, IconOnboarding, IconPlus, IconReports, IconUpload } from '@/lib/ui'
import type { Company, Ctx } from '../admin/shared'
import PathsTab from '../admin/PathsTab'
import AutomationTab from '../admin/AutomationTab'
import PreboardingTab from '../admin/PreboardingTab'
import ReportsTab from '../admin/ReportsTab'
import CertificatesTab from '../admin/CertificatesTab'
import SettingsTab from '../admin/SettingsTab'
import AuditTab from '../admin/AuditTab'
import { GBook, GCert, GGear, GLayers, GLive, GRedo, GSparkle, GStudio, GTarget } from '../glyphs'
import { linkProps, navigate, to } from '../app/router'
import StudioOverview from './StudioOverview'
import StudioCourses from './StudioCourses'
import StudioBuilder from './StudioBuilder'
import StudioAssignments from './StudioAssignments'
import StudioLive from './StudioLive'
import './studio.css'

const PICK_KEY = 'ezl-studio-company'

export interface StudioBoot { caps: LmsCaps; branch_only: boolean; me: string | null; companies: Company[]; overview: any }

export type SectionKey = 'overview' | 'courses' | 'paths' | 'assignments' | 'live' | 'automation' | 'preboarding' | 'reports' | 'certificates' | 'settings' | 'audit'

interface SectionDef {
  key: SectionKey; label: string; group: 'Build' | 'Deliver' | 'Measure' | 'Govern'
  title: string; line: string; icon: React.ReactNode
  show: (c: LmsCaps, branchOnly: boolean) => boolean
}

export const SECTIONS: SectionDef[] = [
  { key: 'overview', label: 'Overview', group: 'Build', title: 'Learning at a glance', line: 'What exists, who is learning, and what needs attention.', icon: <GSparkle size={20} />, show: c => c.reports || c.viewContent || c.viewAssignments },
  { key: 'courses', label: 'Courses', group: 'Build', title: 'Courses', line: 'Build courses from videos, slides, documents and quizzes, then publish them.', icon: <GBook size={20} />, show: c => c.viewContent },
  { key: 'paths', label: 'Learning paths', group: 'Build', title: 'Learning paths', line: 'A few courses that belong together, taken in order or in any order.', icon: <GLayers size={20} />, show: c => c.viewContent || c.assign },
  { key: 'assignments', label: 'Assignments', group: 'Deliver', title: 'Assignments', line: 'Give courses and paths to people, teams or the whole company, with due dates.', icon: <GTarget size={20} />, show: c => c.viewAssignments },
  { key: 'live', label: 'Live sessions', group: 'Deliver', title: 'Live sessions', line: 'Webinars on your own Zoom, Meet or Teams: invitations, reminders, attendance and the recording.', icon: <GLive size={20} />, show: c => c.viewAssignments },
  { key: 'automation', label: 'Automation', group: 'Deliver', title: 'Automation', line: 'Rules that keep assigning: new joiners, moves between teams, and renewals.', icon: <GRedo size={20} />, show: c => c.automate },
  { key: 'preboarding', label: 'Preboarding', group: 'Deliver', title: 'Preboarding', line: 'Learning for candidates before their first day, on a private link.', icon: <IconOnboarding size={20} />, show: c => c.viewAssignments },
  { key: 'reports', label: 'Reports', group: 'Measure', title: 'Reports', line: 'Everyone\'s record, filtered and exported to Excel.', icon: <IconReports size={20} />, show: c => c.reports },
  { key: 'certificates', label: 'Certificates', group: 'Measure', title: 'Certificates', line: 'Every certificate issued, with its verification code.', icon: <GCert size={20} />, show: c => c.reports },
  { key: 'settings', label: 'Settings', group: 'Govern', title: 'Learning policies', line: 'Defaults, reminders, reviews and certificates for the company.', icon: <GGear size={20} />, show: c => c.publish },
  { key: 'audit', label: 'Audit log', group: 'Govern', title: 'Audit log', line: 'Who changed what, and when.', icon: <IconCompliance size={20} />, show: (c, b) => !b && (c.publish || c.automate || c.reports) },
]

function count(boot: StudioBoot, key: SectionKey): { n: number; hot?: boolean } | null {
  const o = boot.overview || {}
  if (key === 'courses' && o.courses?.total) return { n: o.courses.total }
  if (key === 'assignments' && o.assignments) return { n: o.assignments }
  if (key === 'paths' && o.paths) return { n: o.paths }
  if (key === 'reports' && o.enrollments?.overdue) return { n: o.enrollments.overdue, hot: true }
  return null
}

function SectionNav({ sections, active, boot }: { sections: SectionDef[]; active: SectionKey; boot: StudioBoot }) {
  const groups = ['Build', 'Deliver', 'Measure', 'Govern'] as const
  return (
    <nav className="lx-st-nav" aria-label="Studio sections">
      {groups.map(g => {
        const mine = sections.filter(s => s.group === g)
        if (!mine.length) return null
        return [
          <div key={`${g}-l`} className="lx-st-nav-label">{g}</div>,
          ...mine.map(s => {
            const c = count(boot, s.key)
            return (
              <a key={s.key} aria-current={s.key === active ? 'page' : undefined} {...linkProps(to.studio(s.key))}>
                <span>{s.icon}</span>{s.label}
                {c && <b data-hot={c.hot ? '1' : '0'}>{c.n}</b>}
              </a>
            )
          }),
        ]
      })}
    </nav>
  )
}

function Header({ def, boot, picked, onPick, action }: { def: SectionDef; boot: StudioBoot; picked: string; onPick: (v: string) => void; action?: React.ReactNode }) {
  return (
    <header className="lx-st-hero lx-in">
      <div className="lx-st-hero-row">
        <div className="lx-st-hero-id">
          <div className="lx-st-hero-ic">{def.icon}</div>
          <div style={{ minWidth: 0 }}>
            <div className="lx-st-kicker">Learning Studio{boot.branch_only ? ' · your branch' : ''}</div>
            <h1>{def.title}</h1>
            <p>{def.line}</p>
          </div>
        </div>
        <div className="lx-st-hero-actions">
          {boot.companies.length > 1 && (
            <select className="lx-st-glass-select" value={picked} onChange={e => onPick(e.target.value)} aria-label="Company">
              <option value="">All companies</option>
              {boot.companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          )}
          {action}
        </div>
      </div>
    </header>
  )
}

export default function Studio({ boot, section, item, onBootChange }: {
  boot: StudioBoot; section: string | null; item: string | null; onBootChange: (b: StudioBoot) => void
}) {
  // The company stays chosen across sections, the builder and a reload of the page.
  const [picked, setPicked] = useState(() => {
    try { const v = sessionStorage.getItem(PICK_KEY) || ''; return boot.companies.some(c => c.id === v) ? v : '' } catch { return '' }
  })
  const [newTick, setNewTick] = useState(0)
  const [liveTick, setLiveTick] = useState(0)
  const [assignTick, setAssignTick] = useState<{ n: number; mode: 'form' | 'excel' }>({ n: 0, mode: 'form' })
  const sections = useMemo(() => SECTIONS.filter(s => s.show(boot.caps, boot.branch_only)), [boot])
  const def = sections.find(s => s.key === section) || sections[0]
  const ctx: Ctx = useMemo(() => {
    const solo = boot.companies.length === 1 ? boot.companies[0].id : null
    return { caps: boot.caps, companies: boot.companies, company: picked || solo, branchOnly: boot.branch_only, me: boot.me }
  }, [boot, picked])

  const pick = (v: string) => {
    setPicked(v)
    try { sessionStorage.setItem(PICK_KEY, v) } catch { /* private mode: the choice lasts this visit */ }
    lmsApi<StudioBoot>(`/api/lms/admin/overview${v ? `?company=${v}` : ''}`).then(onBootChange).catch(() => {})
  }
  // A company remembered from before arrives with the shell's all-company figures: fetch its own.
  const [restored] = useState(picked)
  // The shell starts with the light answer (overview?lite=1), which has no figures: fetch them
  // once the Studio is open. A remembered company fetches its own instead.
  const needFigures = !boot.overview
  useEffect(() => {
    if (restored || needFigures) lmsApi<StudioBoot>(`/api/lms/admin/overview${restored ? `?company=${restored}` : ''}`).then(onBootChange).catch(() => {})
  }, [restored, needFigures]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!def) {
    return <div className="lx-empty"><div className="lx-empty-art"><GStudio size={34} /></div><h3>Learning is not part of your access</h3><p>Ask HR to add a Learning module to one of your roles.</p></div>
  }

  const active = def.key
  // The builder takes the whole width: it has its own header and needs the room.
  if (active === 'courses' && item) {
    return (
      <div className="lx-st">
        <StudioBuilder key={`${item}:${ctx.company || 'all'}`} ctx={ctx} courseId={item}
          onBack={() => navigate(to.studio('courses'))} onOpen={id => navigate(to.studio('courses', id))} />
      </div>
    )
  }

  let action: React.ReactNode = null
  if (active === 'courses' && ctx.caps.editContent) {
    action = <button className="lx-btn lx-btn--white" onClick={() => setNewTick(n => n + 1)}><IconPlus size={16} /> New course</button>
  } else if (active === 'assignments' && ctx.caps.assign) {
    action = (
      <>
        <button className="lx-btn lx-btn--light" onClick={() => setAssignTick(t => ({ n: t.n + 1, mode: 'excel' }))}><IconUpload size={15} /> Import from Excel</button>
        <button className="lx-btn lx-btn--white" onClick={() => setAssignTick(t => ({ n: t.n + 1, mode: 'form' }))}><IconPlus size={16} /> Assign learning</button>
      </>
    )
  } else if (active === 'live' && ctx.caps.assign && !item) {
    action = <button className="lx-btn lx-btn--white" onClick={() => setLiveTick(n => n + 1)}><IconPlus size={16} /> New live session</button>
  } else if (active === 'overview' && ctx.caps.assign) {
    action = <a className="lx-btn lx-btn--white" {...linkProps(to.studio('assignments'))}><GTarget size={16} /> Assign learning</a>
  }

  return (
    <div className="lx-st">
      <Header def={def} boot={boot} picked={picked} onPick={pick} action={action} />
      <div className="lx-st-body">
        <SectionNav sections={sections} active={active} boot={boot} />
        {/* Keyed by company, so a section never shows one company's rows under another's name. */}
        <div className="lx-st-main" key={`${active}:${ctx.company || 'all'}`}>
          {active === 'overview' && <StudioOverview ctx={ctx} overview={boot.overview} />}
          {active === 'courses' && <StudioCourses ctx={ctx} newTick={newTick} onOpen={id => navigate(to.studio('courses', id))} />}
          {active === 'assignments' && <StudioAssignments ctx={ctx} tick={assignTick} />}
          {active === 'live' && <StudioLive ctx={ctx} item={item} tick={liveTick} />}
          {active === 'paths' && <div className="lx-st-host"><PathsTab ctx={ctx} /></div>}
          {active === 'automation' && <div className="lx-st-host"><AutomationTab ctx={ctx} /></div>}
          {active === 'preboarding' && <div className="lx-st-host"><PreboardingTab ctx={ctx} /></div>}
          {active === 'reports' && <div className="lx-st-host"><ReportsTab ctx={ctx} /></div>}
          {active === 'certificates' && <div className="lx-st-host"><CertificatesTab ctx={ctx} /></div>}
          {active === 'settings' && <div className="lx-st-host"><SettingsTab ctx={ctx} /></div>}
          {active === 'audit' && <div className="lx-st-host"><AuditTab ctx={ctx} /></div>}
        </div>
      </div>
    </div>
  )
}
