'use client'
import { useState, useEffect, useRef } from 'react'
import { useGrant } from '@/lib/rms/client'
import { canSeeScreen } from '@/lib/rms/resolve'
import * as XLSX from 'xlsx'
import {
  loadCompanies, loadPayHeads, savePayHead, deletePayHead,
  loadRuns, createRun, setRunStatus, syncPayrollMonth, loadAudit, loadMonthMaster, checkMonthReadiness,
  loadPayrollEmployees,
  MONTHS,
  type PayHead, type PayrollRun, type PayrollEmployee, type MonthReadiness,
} from '@/lib/payroll/core'
import PayHeadCatalog from '@/components/payroll/PayHeadCatalog'
import CompanyProfileView from '@/components/payroll/CompanyProfileView'
import PerquisitesConfig from '@/components/payroll/PerquisitesConfig'
import BonusConfig from '@/components/payroll/BonusConfig'
import MinimumWageConfig from '@/components/payroll/MinimumWageConfig'
import LwfConfig from '@/components/payroll/LwfConfig'
import PtConfig from '@/components/payroll/PtConfig'
import IncomeTaxConfig from '@/components/payroll/IncomeTaxConfig'
import EsicConfig from '@/components/payroll/EsicConfig'
import EpfConfig from '@/components/payroll/EpfConfig'
import PayrollDashboard from '@/components/payroll/PayrollDashboard'
import AttendanceUpload from '@/components/payroll/AttendanceUpload'
import OtUpload from '@/components/payroll/OtUpload'
import AttendanceEdit from '@/components/payroll/AttendanceEdit'
import AttendanceEditTab from '@/components/payroll/AttendanceEditTab'
import BankDetailsTab from '@/components/payroll/BankDetailsTab'
import ManualVoucher from '@/components/payroll/ManualVoucher'
import ArrearPayments from '@/components/payroll/ArrearPayments'
import MonthSync from '@/components/payroll/MonthSync'
import RunCycle from '@/components/payroll/RunCycle'
import Appraisal from '@/components/payroll/Appraisal'
import LockUnlock from '@/components/payroll/LockUnlock'
import PerquisiteStatutoryPanel from '@/components/statutory/PerquisiteStatutoryPanel'
import NpsReport from '@/components/payroll/NpsReport'
import CompanyStructureView from '@/components/payroll/CompanyStructureView'

// The design system. This file owns C, S and F already, so the tokens are
// aliased: TK for colour, TF for type, SP for spacing.
import {
  C as TK, F as TF, W, R, E, S as SP, tone, eyebrow, numeric, inputStyle,
  IconSliders, IconCalendar, IconEmployees, IconPayroll, IconCompliance, IconHeart, IconAward,
  IconReports, IconAdmin, IconChevronDown, IconChevron, IconCheck, IconBuilding, IconDownload, IconPlus, IconLock,
  Z, type IconProps,
} from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'
import {
  PayrollPageHeader, SectionCard, ControlSelect, StatusPill, RunStatusPill, CountChip, InfoCallout, EmptyState,
  FilterBar, FilterField, fieldStyle, DataTable, dt, PButton, btnStyle, IconTile,
  IconGrid, IconLayers, IconInfo, IconXCircle, IconCheckCircle, IconMonth, IconArrowRight,
} from '@/components/payroll/kit'

// ── Palette (guide-mandated) ──────────────────────────────────────
// This file already owns the name C, so the design tokens come in as TK and
// every value below is bound to them. Nothing here is a private hex any more.
const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  success: TK.positive, amber: TK.warning, red: TK.critical,
  font: TF.family,
}
const S = {
  page: { background: C.bg, minHeight: '100vh', padding: `${SP.xl}px ${SP.xl}px ${SP.huge}px`,
          color: C.navy, fontFamily: C.font, fontSize: TF.body } as React.CSSProperties,
  // Payroll is read across the row — a wider column than the old 1100 keeps
  // the month tables from wrapping.
  content: { maxWidth: 1320, margin: '0 auto' } as React.CSSProperties,
  card: { background: C.card, borderRadius: R.lg, border: `1px solid ${C.border}`,
          padding: '16px 18px', marginBottom: SP.lg, boxShadow: E.raised } as React.CSSProperties,
  label: { ...eyebrow, display: 'block', marginBottom: 5 } as React.CSSProperties,
  input: { ...inputStyle() } as React.CSSProperties,
  btnPrimary: { height: 36, padding: '0 16px', borderRadius: R.md, border: `1px solid ${TK.brandDeep}`,
          cursor: 'pointer', fontSize: TF.small, fontWeight: W.semi, fontFamily: 'inherit',
          background: `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`, color: TK.onAccent,
          whiteSpace: 'nowrap', boxShadow: E.brand } as React.CSSProperties,
  btnOutline: { height: 34, padding: '0 13px', borderRadius: R.md, border: `1px solid ${TK.lineStrong}`,
          cursor: 'pointer', fontSize: TF.small, fontWeight: W.medium, fontFamily: 'inherit',
          background: TK.surface, color: TK.ink, whiteSpace: 'nowrap', boxShadow: E.flat } as React.CSSProperties,
  btnDanger: { height: 30, padding: '0 12px', borderRadius: R.md, border: `1px solid ${tone('critical').edge}`,
          cursor: 'pointer', fontSize: TF.tiny, fontWeight: W.semi, fontFamily: 'inherit',
          background: TK.surface, color: TK.critical } as React.CSSProperties,
  h1: { fontSize: TF.page, fontWeight: W.bold, color: C.navy, margin: 0, letterSpacing: '-.02em' } as React.CSSProperties,
  sub: { fontSize: TF.small, color: C.muted, marginTop: 5 } as React.CSSProperties,
  cardTitle: { fontSize: TF.lead, fontWeight: W.semi, color: C.navy, marginBottom: SP.md } as React.CSSProperties,
  note: { background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: R.md,
          padding: `${SP.md}px ${SP.lg}px`, fontSize: TF.small, color: TK.inkSoft } as React.CSSProperties,
}

const TABS: { id: string; label: string; title: string; subtitle: string }[] = [
  { id: 'dashboard', label: 'Dashboard', title: 'Dashboard', subtitle: 'Headcount, cost, compliance deadlines & recent activity at a glance' },
  { id: 'config', label: 'Configuration', title: 'Configuration', subtitle: 'Group setup, pay heads, statutory slabs & tax rules' },
  { id: 'attendance', label: 'Attendance', title: 'Attendance', subtitle: 'Upload attendance / leave / OT into the month snapshot' },
  { id: 'employees', label: 'Employees & CTC', title: 'Employees & CTC', subtitle: 'Payroll view of the workforce, CTC master and bank details' },
  { id: 'run', label: 'Payroll Run', title: 'Payroll Run', subtitle: 'The heart: month create → sync → calculate → approve → disburse → lock' },
  { id: 'statutory', label: 'Statutory & Tax', title: 'Statutory & Tax', subtitle: 'Compliance-by-design: PF, ESIC, PT, LWF, NPS and TDS' },
  { id: 'benefits', label: 'Benefits & Loans', title: 'Benefits & Loans', subtitle: 'Flexi benefits, NPS, insurance and the full loan lifecycle' },
  { id: 'offcycle', label: 'Off-cycle · Bonus · FNF', title: 'Off-cycle · Bonus · FNF', subtitle: 'Ad-hoc payments, bonus registers and full & final settlement' },
  { id: 'reports', label: 'Outputs & Reports', title: 'Outputs & Reports', subtitle: 'Payslips, registers, bank files, challans and dashboards' },
  { id: 'admin', label: 'Admin & Controls', title: 'Admin & Controls', subtitle: 'Access control, approvals and the full audit trail' },
]

// ── Navigation shape ──────────────────────────────────────────────
// The ten tabs are laid out in the order a payroll month actually moves through —
// set up, run the month, file the statutory side, take the outputs — so the bar
// reads as a process rather than ten equal buttons. Visibility is still decided
// per tab by canSeeScreen below; this only arranges what is shown.
const TAB_ICON: Record<string, (p: IconProps) => React.ReactElement> = {
  dashboard: IconGrid, config: IconSliders, employees: IconEmployees, attendance: IconCalendar,
  run: IconPayroll, benefits: IconHeart, offcycle: IconAward, statutory: IconCompliance,
  reports: IconReports, admin: IconAdmin,
}
const TAB_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Overview', ids: ['dashboard'] },
  { label: 'Setup', ids: ['config', 'employees'] },
  { label: 'Monthly run', ids: ['attendance', 'run', 'benefits', 'offcycle'] },
  { label: 'Statutory', ids: ['statutory'] },
  { label: 'Outputs & control', ids: ['reports', 'admin'] },
]

// ── Small shared bits ─────────────────────────────────────────────
function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 99, fontSize: TF.micro, fontWeight: W.semi, background: bg, color, letterSpacing: '.02em', whiteSpace: 'nowrap', lineHeight: 1.5 }}>{text}</span>
}

const HEAD_COLORS: Record<string, { bg: string; color: string }> = {
  EARNING: { bg: TK.positiveTint, color: C.success },
  DEDUCTION: { bg: TK.criticalTint, color: C.red },
  EMPLOYER: { bg: TK.brandTint, color: C.purple },
  NON_SALARY: { bg: TK.warningTint, color: C.amber },
}

function PlannedBadge() {
  return <Badge text="Planned" bg={TK.sunken} color={C.muted} />
}

// ══ Sub-tab framework (architecture per ezer_payroll_full_architecture_tabs) ══
interface SubTab {
  id: string; label: string; icon: string
  built?: boolean                 // green dot = shipped
  href?: string                   // built module that lives on another screen
  desc?: string                   // shown in built/planned panel
  points?: string[]               // feature bullets/chips
  render?: () => React.ReactNode   // inline functional module
  groupGlobal?: boolean            // true = not company-specific; hide the Group-mode company switcher
  children?: { id: string; label: string }[]   // nested sub-views, shown indented inside the tab dropdown
}

// Group-mode context passed down so company-specific sub-tabs can show a company switcher.

// The section heading under the tab bar: where you are (Tab › Section › View), what the
// tab is for, and how much of it is built.
function SubTabHead({ crumbs, subtitle, built, total, icon }: { crumbs: string[]; subtitle: string; built: number; total: number; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap', marginBottom: SP.lg }}>
      {icon && <IconTile icon={icon} t="brand" size={36} />}
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: TK.faint, display: 'inline-flex' }}><IconChevron size={13} /></span>}
                <span style={{ fontSize: last ? TF.title : TF.lead, fontWeight: last ? W.bold : W.medium, color: last ? C.navy : C.muted, letterSpacing: last ? '-.01em' : undefined }}>{c}</span>
              </span>
            )
          })}
        </nav>
        <div style={{ fontSize: TF.small, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>{subtitle}</div>
      </div>
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill t="positive" dot size="sm">{built} built</StatusPill>
          <StatusPill t="neutral" dot size="sm">{total - built} planned</StatusPill>
        </div>
      )}
    </div>
  )
}

// Main-tab button that opens a dropdown of its own sub-sections. Clicking a section
// enters that tab + section. The menu hangs directly off the tab button.
function MainTabDropdown({ id, label, isActive, sections, activeSub, activeChild, onPick }: {
  id: string; label: string; isActive: boolean; sections: SubTab[]; activeSub: string; activeChild?: string; onPick: (id: string, childId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const [anchor, setAnchor] = useState<{ left?: number; right?: number }>({ left: 0 })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // which sections have their children expanded
  const built = sections.filter(s => s.built).length
  const Icon = TAB_ICON[id] || IconLayers

  // The menu is anchored by LAYOUT (position: absolute), never by viewport coordinates
  // written into position: fixed. That silently breaks whenever anything between the
  // button and the viewport creates a containing block — a transform, a filter,
  // contain: paint — because fixed then resolves against that ancestor instead of the
  // screen, and the panel lands hundreds of pixels away.
  //
  // The tab strip now scrolls sideways instead of wrapping onto two rows, and a scroll
  // container clips anything positioned inside it. So this wrapper is deliberately NOT
  // positioned: the menu's containing block is the sticky bar OUTSIDE the scroller,
  // which does not clip it. Its offset is this wrapper's layout offset (offsetLeft, which
  // no transform can distort) minus how far the strip has been scrolled.
  const toggle = () => {
    if (sections.length === 0) { onPick(''); return }   // no sub-sections (e.g. Dashboard) → just activate the tab
    if (!open) {
      const el = pop.current
      const strip = el?.closest('[data-tabstrip]') as HTMLElement | null
      const bar = el?.offsetParent as HTMLElement | null
      const left = (el?.offsetLeft || 0) - (strip?.scrollLeft || 0)
      const barW = bar?.clientWidth || 0
      // Only decides which EDGE the menu hangs from; either way it stays under the tab.
      if (barW && left + 290 > barW) setAnchor({ right: Math.max(0, barW - (left + (el?.offsetWidth || 0))) })
      else setAnchor({ left: Math.max(0, left) })
      setExpanded(new Set())   // each time the menu opens, sub-sections start collapsed
    }
    setOpen(o => !o)
  }
  // The strip scrolling would leave the open menu hanging under the wrong tab.
  useEffect(() => {
    if (!open) return
    const strip = pop.current?.closest('[data-tabstrip]')
    const close = () => setOpen(false)
    strip?.addEventListener('scroll', close, { passive: true })
    return () => strip?.removeEventListener('scroll', close)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div ref={pop} data-ptab={id} style={{ flexShrink: 0 }}>
      <button onClick={toggle} aria-expanded={sections.length > 0 ? open : undefined} aria-current={isActive ? 'page' : undefined}
        className="ez-tab ez-press" data-on={isActive ? '1' : '0'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', borderRadius: R.md,
          border: `1px solid ${isActive ? TK.brandEdge : open ? TK.lineStrong : 'transparent'}`,
          // Inactive leaves background unset so the .ez-tab hover wash can show.
          background: isActive ? TK.brandTint : open ? TK.sunken : undefined,
          color: isActive ? C.purpleDark : TK.inkSoft, fontSize: TF.small, fontWeight: isActive ? W.semi : W.medium,
          cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          boxShadow: isActive ? `inset 0 -2px 0 ${TK.brand}` : 'none',
        }}>
        <span style={{ display: 'inline-flex', color: isActive ? C.purple : C.muted }}><Icon size={15} /></span>
        {label}
        {sections.length > 0 && (
          <span style={{ display: 'inline-flex', color: isActive ? C.purple : TK.faint, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}>
            <IconChevronDown size={12} />
          </span>
        )}
      </button>
      {open && sections.length > 0 && (
        <>
          <div className="ez-rise" style={{
            position: 'absolute', top: 'calc(100% + 6px)',
            ...(anchor.right != null ? { right: anchor.right } : { left: anchor.left }),
            zIndex: 1001, minWidth: 270, maxHeight: '70vh', overflowY: 'auto',
            background: TK.surface, border: `1px solid ${C.border}`, borderRadius: R.lg,
            boxShadow: E.overlay, padding: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 8px' }}>
              <span style={{ ...eyebrow }}>{label}</span>
              <span style={{ marginLeft: 'auto', fontSize: TF.micro, color: C.muted, ...numeric }}>{built}/{sections.length} built</span>
            </div>
            {sections.map(s => {
              const on = isActive && s.id === activeSub
              const kids = s.children || []
              const hasKids = kids.length > 0
              const isExp = expanded.has(s.id)
              const rowActive = on && !hasKids
              return (
                <div key={s.id}>
                  <button
                    onClick={() => { if (hasKids) { toggleExpand(s.id) } else { onPick(s.id); setOpen(false) } }}
                    className={rowActive ? undefined : 'ez-row'}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: R.md,
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: 1,
                      background: rowActive ? TK.brandTint : undefined,
                    }}>
                    <span title={s.built ? 'Built' : 'Planned'} style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: s.built ? C.success : TK.lineStrong }} />
                    {s.icon && <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{s.icon}</span>}
                    <span style={{ fontSize: TF.small, fontWeight: on ? W.semi : W.medium, color: on ? C.purpleDark : C.navy, flex: 1 }}>{s.label}</span>
                    {hasKids ? (
                      <span style={{ color: C.muted, display: 'inline-flex', flexShrink: 0, transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><IconChevron size={13} /></span>
                    ) : (
                      <>
                        {!s.built && <span style={{ fontSize: TF.micro, color: TK.faint, fontWeight: W.semi }}>Planned</span>}
                        {on && <span style={{ color: C.purple, display: 'inline-flex' }}><IconCheck size={14} /></span>}
                      </>
                    )}
                  </button>
                  {/* Nested sub-views — hidden until the parent section is clicked (expanded). */}
                  {hasKids && isExp && (
                    <div style={{ margin: '0 0 4px 22px', borderLeft: `1px solid ${C.border}`, paddingLeft: 6 }}>
                      {kids.map(k => {
                        const kon = on && k.id === activeChild
                        return (
                          <button key={k.id} onClick={() => { onPick(s.id, k.id); setOpen(false) }}
                            className={kon ? undefined : 'ez-row'}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: R.md,
                              border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: 1,
                              background: kon ? TK.brandTint : undefined,
                            }}>
                            <span style={{ fontSize: TF.small, fontWeight: kon ? W.semi : W.medium, color: kon ? C.purpleDark : C.navy, flex: 1 }}>{k.label}</span>
                            {kon && <span style={{ color: C.purple, display: 'inline-flex' }}><IconCheck size={13} /></span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Chips({ items, t = 'brand', center }: { items: string[]; t?: 'brand' | 'positive'; center?: boolean }) {
  const k = tone(t)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, justifyContent: center ? 'center' : undefined }}>
      {items.map(p => (
        <span key={p} style={{ fontSize: TF.tiny, fontWeight: W.medium, padding: '3px 10px', borderRadius: 99, background: k.bg, border: `1px solid ${k.edge}`, color: k.fg }}>{p}</span>
      ))}
    </div>
  )
}

function PlannedPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        {s.icon
          ? <span style={{ width: 52, height: 52, borderRadius: R.lg, background: TK.sunken, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{s.icon}</span>
          : <IconTile icon={<IconLayers size={22} />} t="neutral" size={52} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: TF.title, fontWeight: W.bold, color: C.navy, letterSpacing: '-.01em' }}>{s.label}</span>
        <PlannedBadge />
      </div>
      {s.desc && <div style={{ fontSize: TF.small, color: C.muted, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>{s.desc}</div>}
      {s.points && <Chips items={s.points} center />}
      <div style={{ fontSize: TF.tiny, color: TK.faint, marginTop: 18 }}>On the payroll roadmap: structure ready, wiring next.</div>
    </div>
  )
}

function BuiltPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, padding: '22px 24px' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {s.icon
          ? <span style={{ width: 48, height: 48, borderRadius: R.lg, background: TK.positiveTint, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{s.icon}</span>
          : <IconTile icon={<IconCheckCircle size={22} />} t="positive" size={48} />}
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: TF.title, fontWeight: W.bold, color: C.navy, letterSpacing: '-.01em' }}>{s.label}</span>
            <StatusPill t="positive" dot size="sm">Built</StatusPill>
          </div>
          {s.desc && <div style={{ fontSize: TF.small, color: C.muted, margin: '7px 0 0', lineHeight: 1.6, maxWidth: 680 }}>{s.desc}</div>}
          {s.points && <Chips items={s.points} t="positive" />}
          {s.href && (
            <div style={{ marginTop: 16 }}>
              <a href={s.href} className="ez-press ez-cta" style={{ ...btnStyle('primary', 'md') }}>
                Open <span className="ez-cta-arrow" style={{ display: 'inline-flex' }}><IconArrowRight size={14} /></span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Resolve the sub-section list for a main tab. companyId '' = Group Companies (all companies at once).
function subsForTab(tab: string, ctx: { companyId: string; fy: string; subView: string }): SubTab[] {
  switch (tab) {
    case 'config': return configSubs(ctx.companyId, ctx.subView, ctx.fy)
    case 'attendance': return attendanceSubs(ctx.companyId, ctx.fy)
    case 'employees': return employeeSubs(ctx.companyId)
    case 'run': return runSubs(ctx.companyId, ctx.fy)
    case 'statutory': return statutorySubs(ctx.fy)
    case 'benefits': return benefitsSubs()
    case 'offcycle': return offcycleSubs()
    case 'reports': return reportsSubs()
    case 'admin': return adminSubs(ctx.companyId)
    default: return []
  }
}

// ── Sub-section definitions per main tab (metadata + inline render) ──
function configSubs(companyId: string, subView: string, fy: string): SubTab[] {
  return [
    { id: 'payheads', label: 'Pay Heads', icon: '', built: true,
      children: [
        { id: 'catalog', label: 'Standard Pay Heads' },
        { id: 'flexi', label: 'Flexi / FBP' },
        { id: 'nonstd', label: 'Non-standard Types' },
        { id: 'rules', label: 'Business Rules' },
      ],
      render: () => <PayHeadCatalog view={['flexi', 'nonstd', 'rules'].includes(subView) ? subView : 'catalog'} /> },
    { id: 'group', label: 'Group & Company', icon: '', built: true, groupGlobal: true, render: () => <CompanyProfileView /> },
    { id: 'fymonth', label: 'Payroll Month', icon: '', built: true,
      children: [
        { id: 'create', label: 'Create Month' },
        { id: 'freeze', label: 'Freeze Month' },
        { id: 'unfreeze', label: 'Unfreeze Month' },
        // PayrollMonthTab always supported this mode; it just had no menu entry, so the
        // only way to lock a month was the Advance button that Run Cycle no longer has.
        { id: 'lock', label: 'Lock / Unlock Month' },
      ],
      render: () => <PayrollMonthTab companyId={companyId} fy={fy} mode={(['create', 'freeze', 'unfreeze'].includes(subView) ? subView : 'create') as PmMode} /> },
    { id: 'categories', label: 'Department · Sub-dept · Location', icon: '', built: true, render: () => <CompanyStructureView companyId={companyId} /> },
    { id: 'perquisite', label: 'Perquisite', icon: '', built: true, render: () => <PerquisitesConfig fy={fy} /> },
    { id: 'bonus', label: 'Bonus Config', icon: '', built: true, render: () => <BonusConfig fy={fy} /> },
    { id: 'tax', label: 'Tax Config', icon: '', built: true, render: () => <IncomeTaxConfig /> },
    { id: 'lwf', label: 'LWF', icon: '', built: true, render: () => <LwfConfig /> },
    { id: 'esic', label: 'ESIC', icon: '', built: true, render: () => <EsicConfig /> },
    { id: 'epf', label: 'EPF', icon: '', built: true, render: () => <EpfConfig /> },
    { id: 'slabs', label: 'PT Slabs', icon: '', built: true, render: () => <PtConfig /> },
    { id: 'minwages', label: 'Minimum Wages', icon: '', built: true, render: () => <MinimumWageConfig /> },
  ]
}

function attendanceSubs(companyId: string, fy: string): SubTab[] {
  return [
    { id: 'upload', label: 'Attendance Upload', icon: '', built: true, render: () => <AttendanceUpload companyId={companyId} fy={fy} /> },
    { id: 'ot', label: 'OT Upload', icon: '', built: true, render: () => <OtUpload companyId={companyId} fy={fy} /> },
    { id: 'edit', label: 'Attendance Edit', icon: '', built: true, render: () => <AttendanceEditTab companyId={companyId} fy={fy} /> },
    { id: 'arrear', label: 'Arrear Days', icon: '', built: true, render: () => <AttendanceEdit companyId={companyId} fy={fy} mode="arrear" /> },
  ]
}

function employeeSubs(companyId: string): SubTab[] {
  return [
    { id: 'master', label: 'Employee & CTC Master', icon: '', built: true, render: () => <EmployeesTab companyId={companyId} /> },
    { id: 'bank', label: 'Bank Details', icon: '', built: true, render: () => <BankDetailsTab companyId={companyId} /> },
    { id: 'revision', label: 'Salary Revision & Arrears', icon: '', built: true, render: () => <Appraisal /> },
  ]
}

function runSubs(companyId: string, fy: string): SubTab[] {
  return [
    { id: 'cycle', label: 'Run Cycle', icon: '', built: true, render: () => <RunCycle companyId={companyId} headerFy={fy} /> },
    { id: 'sync', label: 'Data Sync', icon: '', built: true, render: () => <MonthSync companyId={companyId} fy={fy} /> },
    { id: 'uploaders', label: 'Bulk Uploaders', icon: '', built: true, render: () => <ManualVoucher companyId={companyId} fy={fy} /> },
    { id: 'arrearpay', label: 'Arrear & Payments', icon: '', built: true, render: () => <ArrearPayments companyId={companyId} fy={fy} /> },
    { id: 'lock', label: 'Lock / Unlock', icon: '', built: true, render: () => <LockUnlock companyId={companyId} fy={fy} /> },
    { id: 'minwage', label: 'Minimum Wages Check', icon: '', desc: 'Flags employees whose gross falls below the applicable state minimum wage before payroll is processed.' },
  ]
}

function statutorySubs(fy: string): SubTab[] {
  return [
    { id: 'pf', label: 'PF / EPF + VPF', icon: '', built: true, href: '/dashboard/ess', desc: 'EPF @12% of capped wage is computed in the engine; VPF opt-in is available in the employee ESS portal.' },
    { id: 'esic', label: 'ESIC', icon: '', built: true, desc: '0.75% employee / 3.25% employer, auto-applied for gross ≤ ₹21,000 during Calculate. Challan export is planned.' },
    // Same components the Configuration menu shows — one screen each, not copies:
    // two LWF or PT screens would eventually disagree, and whichever one HR happened to
    // open would decide what they believed.
    { id: 'lwf', label: 'LWF', icon: '', built: true, render: () => <LwfConfig /> },
    { id: 'ptlwf', label: 'Professional Tax', icon: '', built: true, render: () => <PtConfig /> },
    // Enrolment itself happens in ESS; this is the report side — who is in, who is not.
    { id: 'nps', label: 'NPS', icon: '', built: true, render: () => <NpsReport fy={fy} /> },
    { id: 'tds', label: 'TDS Calculation', icon: '', built: true, desc: 'Monthly TDS from each employee’s investment declaration feeds directly into the payroll run.' },
    { id: 'form16', label: 'Form 16 / 24Q', icon: '', desc: 'Quarterly 24Q returns and annual Form 16 generation for employees.' },
    { id: 'perq', label: 'Perquisite Tax', icon: '', built: true, render: () => <PerquisiteStatutoryPanel fy={fy} /> },
  ]
}

function benefitsSubs(): SubTab[] {
  return [
    { id: 'flexi', label: 'Flexi Benefit Plan', icon: '', built: true, href: '/dashboard/flexi-policy', desc: 'FBP components, slabs and employee declarations (old vs new regime).' },
    { id: 'flexiclaims', label: 'Flexi Claims', icon: '', built: true, href: '/dashboard/flexi-claims', desc: 'Review reimbursement bills, manage the monthly submission window and per-employee limits. Approved claims flow into payroll.' },
    { id: 'flexiinvoices', label: 'Flexi Invoices & Vouchers', icon: '', built: true, href: '/dashboard/flexi-invoices', desc: 'Generate reimbursement vouchers (PDF) for approved flexi claims, one per employee per month, with invoice number EZER-FLX-…' },
    { id: 'nps', label: 'Corporate NPS', icon: '', built: true, href: '/dashboard/ess', desc: 'Employer NPS enrolment and monthly contribution.' },
    { id: 'insurance', label: 'Insurance / Meal Cards', icon: '', desc: 'GMC / GPA insurance, meal & fuel cards and other benefit heads.' },
    { id: 'loan', label: 'Loan Disbursal & Schedule', icon: '', built: true, href: '/dashboard/loans', desc: 'Loan requests, approval workflow, disbursal and the EMI amortisation schedule.' },
    { id: 'emi', label: 'EMI Auto-Deduct', icon: '', built: true, desc: 'Pending EMIs for the month are pulled into the payroll run automatically during Calculate.' },
    { id: 'foreclose', label: 'Part-payment / Foreclosure', icon: '', built: true, href: '/dashboard/loans', desc: 'Part-prepayment and foreclosure recalculate the outstanding schedule.' },
  ]
}

function offcycleSubs(): SubTab[] {
  return [
    { id: 'offcycle', label: 'Off-cycle Payments', icon: '', desc: 'Ad-hoc payments outside the monthly cycle: incentives, reimbursements, one-time payouts.' },
    { id: 'bonuscalc', label: 'Bonus Calculation', icon: '', desc: 'Statutory (8.33–20%) and performance bonus computation with eligibility rules.' },
    { id: 'bonusreg', label: 'Bonus Register', icon: '', desc: 'Form C bonus register for statutory compliance.' },
    { id: 'fnfcreate', label: 'FNF Creation', icon: '', desc: 'Initiate full & final settlement for exited / resigned employees.' },
    { id: 'fnfprocess', label: 'FNF Process', icon: '', desc: 'Leave encashment, gratuity, notice recovery and the final settlement statement.' },
  ]
}

function reportsSubs(): SubTab[] {
  return [
    { id: 'register', label: 'Payroll Register', icon: '', built: true, desc: 'The full computed register for a run. Export from Payroll Run → 📥 Register (one row per employee with every earning & deduction).' },
    { id: 'payslip', label: 'Salary Slip Generator', icon: '', desc: 'Branded PDF payslips per employee on the Sharma Group letterhead, pushed to the ESS portal.' },
    { id: 'annual', label: 'Annual Salary', icon: '', desc: 'Year-to-date earnings & deductions statement per employee.' },
    { id: 'neft', label: 'Bank Transfer File (NEFT)', icon: '', desc: 'Bank-ready NEFT / RTGS salary file with UTF-8 BOM (IFSC, account, amount, narration).' },
    { id: 'challans', label: 'PF ECR · ESIC · PT Challans', icon: '', desc: 'Statutory challan and PF ECR text files for upload to government portals.' },
    { id: 'dashboards', label: 'Month-end Dashboards', icon: '', desc: 'Headcount, pay summary, location-wise cost and month-on-month variance.' },
    { id: 'mis', label: 'MIS / Variance', icon: '', desc: 'Custom MIS and variance reports across runs.' },
  ]
}

function adminSubs(companyId: string): SubTab[] {
  return [
    { id: 'audit', label: 'Audit Trail', icon: '', built: true, render: () => <AuditCard companyId={companyId} refreshKey={0} /> },
    { id: 'rbac', label: 'Role-based Access', icon: '', built: true, href: '/dashboard/roles', desc: 'Payroll roles and permissions are managed in ESS & Role Management.' },
    { id: 'approval', label: 'Approval Workflows', icon: '', desc: 'Maker-checker approval chains for payroll sign-off before disbursement.' },
    { id: 'approvalmail', label: 'Approval Mail + Reports', icon: '', desc: 'Automated approval emails with the run summary attached.' },
  ]
}

// ── ConfigTab ─────────────────────────────────────────────────────
function ConfigTab({ companyId }: { companyId: string }) {
  const [heads, setHeads] = useState<PayHead[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [headType, setHeadType] = useState('EARNING')
  const [calcType, setCalcType] = useState('FIXED')
  const [value, setValue] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function reload() {
    setLoading(true)
    setHeads(await loadPayHeads(companyId))
    setLoading(false)
  }
  useEffect(() => { reload() }, [companyId])

  async function add() {
    if (!code.trim() || !name.trim()) { setErr('Code and Name are required.'); return }
    setErr(''); setSaving(true)
    const { error } = await savePayHead(companyId, {
      code: code.trim().toUpperCase(), name: name.trim(), head_type: headType,
      calc_type: calcType, calc_value: value === '' ? null : Number(value), taxable,
    })
    setSaving(false)
    if (error) { setErr(error); return }
    setCode(''); setName(''); setValue(''); setHeadType('EARNING'); setCalcType('FIXED'); setTaxable(true)
    reload()
  }

  async function remove(id: string) {
    await deletePayHead(id)
    reload()
  }

  function calcLabel(h: PayHead) {
    if (h.calc_type === 'FIXED') return `FIXED ₹${h.calc_value ?? 0}`
    if (h.calc_type === 'PCT_BASIC') return `PCT_BASIC ${h.calc_value ?? 0}%`
    if (h.calc_type === 'PCT_CTC') return `PCT_CTC ${h.calc_value ?? 0}%`
    return 'FORMULA'
  }

  return (
    <div>
      <SectionCard title="Pay Heads" icon={<IconSliders size={16} />} hint="Add a head: code, name, type and how it is calculated.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={S.label}>Code</label>
            <input style={S.input} value={code} onChange={e => setCode(e.target.value)} placeholder="BASIC" />
          </div>
          <div>
            <label style={S.label}>Name</label>
            <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Basic Salary" />
          </div>
          <div>
            <label style={S.label}>Type</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={headType} onChange={e => setHeadType(e.target.value)}>
              <option value="EARNING">EARNING</option>
              <option value="DEDUCTION">DEDUCTION</option>
              <option value="EMPLOYER">EMPLOYER</option>
              <option value="NON_SALARY">NON_SALARY</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Calc type</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={calcType} onChange={e => setCalcType(e.target.value)}>
              <option value="FIXED">FIXED</option>
              <option value="PCT_BASIC">PCT_BASIC</option>
              <option value="PCT_CTC">PCT_CTC</option>
              <option value="FORMULA">FORMULA</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Value</label>
            <input style={{ ...S.input, ...numeric }} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: TF.small, color: C.navy, cursor: 'pointer' }}>
            <input type="checkbox" checked={taxable} onChange={e => setTaxable(e.target.checked)} style={{ accentColor: TK.brand, width: 15, height: 15 }} /> Taxable
          </label>
          <PButton variant="primary" icon={<IconPlus size={14} />} disabled={saving} onClick={add}>Add</PButton>
          {err && <span style={{ color: C.red, fontSize: TF.tiny }}>{err}</span>}
        </div>
      </SectionCard>

      <SectionCard flush>
        {loading ? <EmptyState compact t="neutral" title="Loading…" /> : heads.length === 0 ? (
          <EmptyState compact t="neutral" title="No pay heads yet." hint="Add one above." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th style={dt.th}>Code</th>
                <th style={dt.th}>Name</th>
                <th style={dt.th}>Type</th>
                <th style={dt.th}>Calc</th>
                <th style={dt.th}>Taxable</th>
                <th style={dt.th}></th>
              </tr>
            </thead>
            <tbody>
              {heads.map(h => {
                const hc = HEAD_COLORS[h.head_type] || HEAD_COLORS.EARNING
                return (
                  <tr key={h.id} className={dt.rowClass}>
                    <td style={{ ...dt.tdMono, color: C.purpleDark }}>{h.code}</td>
                    <td style={dt.tdStrong}>{h.name}</td>
                    <td style={dt.td}><Badge text={h.head_type} bg={hc.bg} color={hc.color} /></td>
                    <td style={{ ...dt.td, ...numeric }}>{calcLabel(h)}</td>
                    <td style={{ ...dt.td, color: C.muted }}>{h.taxable ? 'Y' : 'N'}</td>
                    <td style={{ ...dt.td, textAlign: 'right' }}><PButton size="sm" variant="danger" onClick={() => remove(h.id)}>Delete</PButton></td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </SectionCard>

      <InfoCallout t="info" compact>Other config (FY/month, PT/LWF/min-wages slabs, tax config, perquisite, bonus): planned.</InfoCallout>
    </div>
  )
}

// ── PayrollMonthTab — Create / Freeze / Unfreeze / Lock payroll months ──
type PmMode = 'create' | 'freeze' | 'unfreeze' | 'lock'
function PayrollMonthTab({ companyId, fy, mode }: { companyId: string; fy: string; mode: PmMode }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [companyCount, setCompanyCount] = useState(0)
  const [coList, setCoList] = useState<{ id: string; company_name: string }[]>([])
  const [groupName, setGroupName] = useState('Group')
  const allCo = !companyId
  const FROZEN_OR_BEYOND = ['ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED']

  const [dlKey, setDlKey] = useState('')   // which month's master export is in flight

  async function reload() { setLoading(true); setRuns(await loadRuns(companyId, fy)); setLoading(false) }
  useEffect(() => { reload() }, [companyId, fy])   // eslint-disable-line react-hooks/exhaustive-deps

  // Download the frozen Month Master — every snapshot column for the month. In group mode
  // this spans every company's run for that month, with a Company column to tell them apart.
  async function downloadMaster(list: PayrollRun[], label: string, key: string) {
    if (!list.length) return
    setDlKey(key); setErr('')
    try {
      const rows = await loadMonthMaster(list.map(r => ({ id: r.id, company_name: r.company_name, fy: r.fy })))
      if (!rows.length) { setErr(`No month master rows for ${label}. Sync the month first.`); return }
      // Header is the union of every row's keys, passed explicitly — otherwise a column
      // absent from the first row would be silently dropped from the whole sheet.
      const header: string[] = []
      rows.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
      const ws = XLSX.utils.json_to_sheet(rows, { header })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Month Master')
      const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      XLSX.writeFile(wb, `Month_Master_${safe(label)}.xlsx`.replace(/_+/g, '_'))
    } catch (e: any) { setErr('Download failed: ' + (e.message || e)) } finally { setDlKey('') }
  }
  useEffect(() => { loadCompanies().then(c => { setCompanyCount(c.length); setCoList(c.map((x: any) => ({ id: x.id, company_name: x.company_name }))); setGroupName(c[0]?.group_name || 'Group') }).catch(() => {}) }, [])

  // Months already created — hidden from the Create dropdown. In all-companies mode a month is
  // only "taken" once every company has it; for a single company, any run for that month counts.
  const disabledMonths = (() => {
    const byMonth: Record<number, Set<string>> = {}
    runs.forEach(r => { const m = r.month as number; (byMonth[m] = byMonth[m] || new Set()).add(r.company_id) })
    const set = new Set<number>()
    for (let m = 1; m <= 12; m++) {
      const covered = byMonth[m]?.size || 0
      if (allCo ? (companyCount > 0 && covered >= companyCount) : covered > 0) set.add(m)
    }
    return set
  })()

  // Create a month for one company: run + Month Master snapshot.
  async function createOne(cid: string, m: number): Promise<string | null> {
    const { error, run } = await createRun(cid, fy, m)
    if (error) return error
    if (run?.id) { const s = await syncPayrollMonth(run.id); if (s.error) return 'snapshot sync failed: ' + s.error }
    return null
  }

  // Run the create for the chosen month; returns a summary + optional error. Used by the modal.
  async function runCreate(m: number): Promise<{ summary: string; error?: string }> {
    if (!companyId) {
      const comps = await loadCompanies()
      const existing = await loadRuns('', fy)
      const already = new Set(existing.filter(r => r.month === m).map(r => r.company_id))
      let created = 0, skipped = 0; const failed: string[] = []
      for (const c of comps) {
        if (already.has(c.id)) { skipped++; continue }
        const e = await createOne(c.id, m)
        if (e) failed.push(`${c.company_name}: ${e}`); else created++
      }
      return {
        summary: `${MONTHS[m - 1]} ${fy}: month master created for ${created} compan${created === 1 ? 'y' : 'ies'}${skipped ? `, ${skipped} already existed` : ''}.`,
        error: failed.length ? failed.join('  ·  ') : undefined,
      }
    }
    const e = await createOne(companyId, m)
    return { summary: e ? '' : `${MONTHS[m - 1]} ${fy}: month master created.`, error: e || undefined }
  }
  async function apply(run: PayrollRun, status: string) {
    setErr(''); setBusy(true)
    const { error } = await setRunStatus(run, status)
    setBusy(false)
    if (error) { setErr(error); return }
    reload()
  }
  // Group mode — apply a status change to every company's run for that month at once.
  async function applyGroup(list: PayrollRun[], status: string) {
    setErr(''); setBusy(true)
    for (const r of list) { const { error } = await setRunStatus(r, status); if (error) { setErr(error); break } }
    setBusy(false)
    reload()
  }

  const pmTitle = mode === 'create' ? 'Create payroll month' : mode === 'freeze' ? 'Freeze payroll month' : mode === 'unfreeze' ? 'Unfreeze payroll month' : 'Lock payroll month'
  const pmIcon = mode === 'create' ? <IconPlus size={16} /> : mode === 'lock' ? <IconLock size={16} /> : <IconMonth size={16} />
  return (
    <div>
      <SectionCard
        icon={pmIcon}
        title={<>{pmTitle} <span style={{ color: C.muted, fontWeight: W.medium }}>· FY {fy}</span></>}
        hint={mode === 'create' ? 'Open a new payroll month so it can be processed.'
          : mode === 'freeze' ? 'Freezing locks the attendance snapshot so it can’t change while payroll is calculated.'
            : mode === 'unfreeze' ? 'Re-open a frozen month so attendance can be edited again (reverts it to OPEN).'
              : 'Locking finalises the month: the payroll snapshot becomes immutable. Unlock to re-open it.'}
        actions={mode === 'create'
          ? <PButton variant="primary" icon={<IconPlus size={14} />} onClick={() => setShowCreate(true)}>{allCo ? 'Create for all companies' : 'Create month'}</PButton>
          : undefined}
      >
        {(mode === 'create' && allCo) || err ? (
          <>
            {mode === 'create' && allCo && (
              <InfoCallout t="brand" compact style={{ marginBottom: err ? SP.md : 0 }}>
                Group Companies mode: this creates the month for <b>every company</b> at once (companies that already have it are skipped).
              </InfoCallout>
            )}
            {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
          </>
        ) : null}
      </SectionCard>

      {loading ? <SectionCard><div style={{ color: C.muted, fontSize: TF.small }}>Loading…</div></SectionCard> : runs.length === 0 ? (
        <SectionCard><EmptyState compact icon={<IconMonth size={20} />} title={`No payroll months for FY ${fy}${allCo ? ' across any company' : ''} yet.`} /></SectionCard>
      ) : (
        <SectionCard title="Months" icon={<IconLayers size={16} />} hint={`${allCo ? 'One row per month, rolled up across every company.' : 'Every payroll month created for this company.'}`} flush>
          {allCo ? (
            // Group Companies → one consolidated "Sharma Group · Month" row per month (rolls up all companies' runs).
            Object.values(runs.reduce((acc, r) => { (acc[r.month as number] = acc[r.month as number] || []).push(r); return acc }, {} as Record<number, PayrollRun[]>))
              .sort((a, b) => (a[0].month || 0) - (b[0].month || 0))
              .map((g, gi) => {
                const statuses = Array.from(new Set(g.map(r => r.status)))
                const totalEmp = g.reduce((s, r) => s + (r.emp_count || 0), 0)
                const active = g.filter(r => r.status !== 'CANCELLED')
                const freezable = active.filter(r => !FROZEN_OR_BEYOND.includes(r.status))
                const unfreezable = active.filter(r => r.status === 'ATTENDANCE_LOCKED')
                const lockable = active.filter(r => r.status !== 'LOCKED')
                const single = statuses.length === 1
                return (
                  <div key={g[0].month} className="ez-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: gi === 0 ? 'none' : `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220, flex: '1 1 220px' }}>
                      <IconTile icon={<IconBuilding size={15} />} t="brand" size={30} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: TF.body, fontWeight: W.semi, color: C.navy }}>{groupName} · {g[0].period_label || `${g[0].fy} · M${g[0].month}`}</div>
                        {mode === 'create' && <div style={{ fontSize: TF.tiny, color: C.muted, ...numeric }}>{totalEmp} employees across {g.length}</div>}
                      </div>
                    </div>
                    <CountChip t="brand">{`${g.length} compan${g.length === 1 ? 'y' : 'ies'}`}</CountChip>
                    {single ? <RunStatusPill status={statuses[0]} raw /> : <StatusPill t="neutral" dot>{statuses.join(' · ')}</StatusPill>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <PButton size="sm" icon={<IconDownload size={14} />} disabled={!!dlKey}
                        onClick={() => downloadMaster(g, `${groupName} ${g[0].period_label || `${g[0].fy} M${g[0].month}`}`, `g${g[0].month}`)}>
                        {dlKey === `g${g[0].month}` ? 'Preparing…' : 'Month Master'}
                      </PButton>
                      {mode === 'freeze' && (freezable.length
                        ? <PButton size="sm" variant="primary" disabled={busy} onClick={() => applyGroup(freezable, 'ATTENDANCE_LOCKED')}>Freeze all</PButton>
                        : <StatusPill t="positive" size="sm" icon={<IconCheck size={12} />}>Frozen</StatusPill>)}
                      {mode === 'unfreeze' && (unfreezable.length
                        ? <PButton size="sm" variant="primary" disabled={busy} onClick={() => applyGroup(unfreezable, 'OPEN')}>Unfreeze all</PButton>
                        : <span style={{ fontSize: TF.tiny, color: C.muted }}>nothing to unfreeze</span>)}
                      {mode === 'lock' && (lockable.length
                        ? <PButton size="sm" variant="primary" icon={<IconLock size={13} />} disabled={busy} onClick={() => applyGroup(lockable, 'LOCKED')}>Lock all</PButton>
                        : <PButton size="sm" disabled={busy} onClick={() => applyGroup(active, 'DISBURSED')}>Unlock all</PButton>)}
                    </div>
                  </div>
                )
              })
          ) : runs.map((run, ri) => {
            const frozen = FROZEN_OR_BEYOND.includes(run.status)
            const locked = run.status === 'LOCKED'
            const cancelled = run.status === 'CANCELLED'
            return (
              <div key={run.id} className="ez-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: ri === 0 ? 'none' : `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160, flex: '1 1 160px' }}>
                  <IconTile icon={<IconMonth size={15} />} t="brand" size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: TF.body, fontWeight: W.semi, color: C.navy }}>{run.period_label || `${run.fy} · M${run.month}`}</div>
                    {mode === 'create' && <div style={{ fontSize: TF.tiny, color: C.muted, ...numeric }}>{run.emp_count || 0} employees</div>}
                  </div>
                </div>
                <RunStatusPill status={run.status} raw />
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PButton size="sm" icon={<IconDownload size={14} />} disabled={!!dlKey}
                    onClick={() => downloadMaster([run], `${run.company_name || ''} ${run.period_label || `${run.fy} M${run.month}`}`, run.id)}>
                    {dlKey === run.id ? 'Preparing…' : 'Month Master'}
                  </PButton>
                  {mode === 'freeze' && !cancelled && (
                    frozen
                      ? <StatusPill t="positive" size="sm" icon={<IconCheck size={12} />}>Frozen</StatusPill>
                      : <PButton size="sm" variant="primary" disabled={busy} onClick={() => apply(run, 'ATTENDANCE_LOCKED')}>Freeze</PButton>
                  )}
                  {mode === 'unfreeze' && !cancelled && (
                    run.status === 'ATTENDANCE_LOCKED'
                      ? <PButton size="sm" variant="primary" disabled={busy} onClick={() => apply(run, 'OPEN')}>Unfreeze</PButton>
                      : <span style={{ fontSize: TF.tiny, color: C.muted }}>{frozen ? 'processed, can’t unfreeze' : 'not frozen'}</span>
                  )}
                  {mode === 'lock' && !cancelled && (
                    locked
                      ? <PButton size="sm" disabled={busy} onClick={() => apply(run, 'DISBURSED')}>Unlock</PButton>
                      : <PButton size="sm" variant="primary" icon={<IconLock size={13} />} disabled={busy} onClick={() => apply(run, 'LOCKED')}>Lock</PButton>
                  )}
                </div>
              </div>
            )
          })}
        </SectionCard>
      )}
      <InfoCallout t="info" compact>The full run lifecycle (sync → calculate → approve → disburse) lives in <b>Payroll Run</b>. These are shortcuts to create, freeze and lock a month.</InfoCallout>

      {showCreate && (
        <CreateMonthModal fy={fy} allCo={allCo} onRun={runCreate} disabledMonths={disabledMonths}
          checkReady={(m: number) => checkMonthReadiness(allCo ? coList : coList.filter(c => c.id === companyId), fy, m)}
          onClose={() => setShowCreate(false)}
          onDone={() => reload()} />
      )}
    </div>
  )
}

// ── CreateMonthModal — pick month → confirm → animated progress → done ──
function CreateMonthModal({ fy, allCo, onRun, disabledMonths, checkReady, onClose, onDone }: {
  fy: string; allCo: boolean
  onRun: (m: number) => Promise<{ summary: string; error?: string }>
  disabledMonths: Set<number>
  checkReady: (m: number) => Promise<MonthReadiness[]>
  onClose: () => void; onDone: () => void
}) {
  const availableMonths = MONTHS.map((_, i) => i + 1).filter(m => !disabledMonths.has(m))
  const [step, setStep] = useState<'pick' | 'confirm' | 'progress' | 'done' | 'blocked'>('pick')
  const [checking, setChecking] = useState(false)
  const [blockers, setBlockers] = useState<MonthReadiness[]>([])
  const [month, setMonth] = useState(availableMonths[0] || 1)
  const [pct, setPct] = useState(0)
  const [stage, setStage] = useState('')
  const [summary, setSummary] = useState('')
  const [err, setErr] = useState('')
  const startYear = Number(fy.split('-')[0]) || 2026
  const calYearOf = (mi: number) => mi <= 8 ? startYear : startYear + 1   // mi 0-based, 0=Apr … 11=Mar
  const monthLabel = `${MONTHS[month - 1]} ${calYearOf(month - 1)}`

  const STAGES: [number, string][] = [
    [0, 'Fetching employee details…'],
    [22, 'Applying joining & leaving rules…'],
    [45, 'Brewing month master…'],
    [68, 'Freezing salary snapshot…'],
    [88, 'Finalising…'],
  ]

  function begin() {
    setStep('progress'); setPct(0); setStage(STAGES[0][1]); setErr('')
    const startedAt = Date.now()
    let done = false
    let result: { summary: string; error?: string } | null = null
    onRun(month).then(r => { result = r }).catch(e => { result = { summary: '', error: String(e?.message || e) } }).finally(() => { done = true })

    let cur = 0
    const timer = setInterval(() => {
      cur = Math.min(95, cur + 1.45)   // ~10s to reach 95%
      setPct(Math.round(cur))
      const st = [...STAGES].reverse().find(([t]) => cur >= t); if (st) setStage(st[1])
      if (done && Date.now() - startedAt >= 10000 && cur >= 95) {
        clearInterval(timer)
        setPct(100); setStage('Done ✓')
        setTimeout(() => {
          setSummary(result?.summary || '')
          setErr(result?.error || '')
          setStep('done'); onDone()
        }, 500)
      }
    }, 150)
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: `color-mix(in srgb, ${TK.dark} 52%, transparent)`, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: '"DM Sans","Segoe UI",sans-serif' }
  const box: React.CSSProperties = { background: TK.surface, borderRadius: 14, padding: 24, width: '100%', maxWidth: 440, boxShadow: E.overlay, border: `1px solid ${TK.line}` }
  const GREEN = TK.positive

  return (
    <div style={overlay}>
      <div style={box}>
        {step === 'pick' && (
          <>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, marginBottom: 4 }}>Create payroll month</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{allCo ? 'A month master will be built for every company.' : 'A month master will be built for the selected company.'} Months already created are not listed.</div>
            {availableMonths.length === 0 ? (
              <>
                <div style={{ fontSize: 13, color: C.navy, background: TK.brandTint, borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>All months for FY {fy} have already been created{allCo ? ' for every company' : ''}. 🎉</div>
                <button style={{ ...S.btnOutline, width: '100%' }} onClick={onClose}>Close</button>
              </>
            ) : (
              <>
                <label style={{ ...S.label, marginBottom: 6 }}>Month · FY {fy}</label>
                <select style={{ ...S.input, width: '100%', marginBottom: 20 }} value={month} onChange={e => setMonth(Number(e.target.value))}>
                  {availableMonths.map(m => <option key={m} value={m}>{MONTHS[m - 1]} {calYearOf(m - 1)}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ ...S.btnPrimary, flex: 1, opacity: checking ? 0.6 : 1 }} disabled={checking}
                    onClick={async () => {
                      // A month can only be opened once the previous one is fully closed off.
                      setChecking(true)
                      const res = await checkReady(month).catch(() => [] as MonthReadiness[])
                      setChecking(false)
                      const bad = res.filter(r => !r.ok)
                      if (bad.length) { setBlockers(bad); setStep('blocked'); return }
                      setStep('confirm')
                    }}>{checking ? 'Checking…' : 'Submit'}</button>
                  <button style={{ ...S.btnOutline }} onClick={onClose}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'blocked' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><IconTile icon={<IconXCircle size={24} />} t="critical" size={52} /></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, textAlign: 'center', marginBottom: 6 }}>
              Can&apos;t create {monthLabel} yet
            </div>
            <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', marginBottom: 16 }}>
              {blockers[0]?.prevLabel} has to be closed off first: attendance processed, month frozen and payroll locked.
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 18 }}>
              {blockers.map(b => (
                <div key={b.companyId} style={{ border: `1px solid ${TK.criticalEdge}`, background: TK.criticalTint, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 6 }}>{b.companyName} · {b.prevLabel}</div>
                  {[
                    ['Attendance processed', b.attendanceDone, b.attendanceDetail],
                    ['Month frozen', b.frozen, b.frozenDetail],
                    ['Payroll locked', b.locked, b.lockedDetail],
                  ].map(([label, ok, detail]: any) => (
                    <div key={label} style={{ fontSize: 12, color: ok ? C.success : C.red, padding: '2px 0', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <span style={{ display: 'inline-flex', marginTop: 1 }}>{ok ? <IconCheckCircle size={14} /> : <IconXCircle size={14} />}</span>
                      <span><b>{label}</b>{ok ? '' : `: ${detail}`}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...S.btnOutline, flex: 1 }} onClick={() => setStep('pick')}>Back</button>
              <button style={{ ...S.btnPrimary, flex: 1 }} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><IconTile icon={<IconMonth size={24} />} t="brand" size={52} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, textAlign: 'center', lineHeight: 1.5, marginBottom: 6 }}>
              Create the month master for<br /><span style={{ color: C.purple, fontSize: 18, fontWeight: 800 }}>{monthLabel}</span>{allCo ? <span style={{ color: C.muted, fontWeight: 600 }}> for all companies</span> : ''}?
            </div>
            <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', marginBottom: 20 }}>Each eligible employee&apos;s salary, statutory &amp; bank data will be frozen for this month.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...S.btnPrimary, flex: 1, background: GREEN }} onClick={begin}>Confirm</button>
              <button style={{ ...S.btnOutline }} onClick={() => setStep('pick')}>Cancel</button>
            </div>
          </>
        )}

        {step === 'progress' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginBottom: 4 }}>Creating month master…</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>{monthLabel}{allCo ? ' · all companies' : ''}</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: GREEN, marginBottom: 12 }}>{pct}%</div>
            <div style={{ height: 14, background: TK.sunken, borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg,${TK.positive},${TK.positive})`, borderRadius: 99, transition: 'width .2s ease' }} />
            </div>
            <div style={{ fontSize: 13, color: C.navy, fontWeight: 600, minHeight: 18 }}>{stage}</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: 99, background: TK.positiveTint, border: `2px solid ${GREEN}`, color: GREEN, fontSize: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><IconCheck size={28} strokeWidth={2.2} /></div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, marginBottom: 8 }}>Month master ready</div>
            {summary && <div style={{ fontSize: 13, color: C.navy, marginBottom: err ? 10 : 18 }}>{summary}</div>}
            {err && <div style={{ fontSize: 12, color: C.red, background: TK.criticalTint, borderRadius: 10, padding: '8px 10px', marginBottom: 18 }}>{err}</div>}
            <button style={{ ...S.btnPrimary, background: GREEN, width: '100%' }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Run tab helpers ───────────────────────────────────────────────
function statusPill(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    OPEN: { bg: TK.sunken, color: C.muted },
    SYNCED: { bg: TK.infoTint, color: TK.info },
    ATTENDANCE_LOCKED: { bg: TK.infoTint, color: TK.info },
    CALCULATED: { bg: TK.infoTint, color: TK.info },
    AI_CHECKED: { bg: TK.infoTint, color: TK.info },
    APPROVED: { bg: TK.positiveTint, color: C.success },
    DISBURSED: { bg: TK.positiveTint, color: C.success },
    LOCKED: { bg: TK.sunken, color: C.navy },
    CANCELLED: { bg: TK.criticalTint, color: C.red },
  }
  return map[status] || map.OPEN
}

// ── AuditCard ─────────────────────────────────────────────────────
function AuditCard({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { loadAudit(companyId).then(setRows) }, [companyId, refreshKey])
  return (
    <SectionCard title="Recent activity" icon={<IconLayers size={16} />} hint="The latest payroll actions, newest first." flush>
      {rows.length === 0 ? <EmptyState compact icon={<IconInfo size={20} />} t="neutral" title="No activity yet." /> : (
        <DataTable>
          <thead><tr>
            <th style={dt.th}>Action</th>
            <th style={dt.th}>By</th>
            <th style={dt.thNum}>When</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={i} className={dt.rowClass}>
                <td style={{ ...dt.tdStrong, color: C.purpleDark }}>{r.action}</td>
                <td style={dt.td}>{r.performed_by || '-'}</td>
                <td style={{ ...dt.tdNum, color: C.muted }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </SectionCard>
  )
}

// ── BenefitsTab ───────────────────────────────────────────────────
function BenefitsTab() {
  const items = [
    { title: 'Flexi Policy Config', href: '/dashboard/flexi-policy', note: 'Configure flexi benefit plan components', built: true },
    { title: 'Voluntary PF (VPF)', href: null, note: 'ESS → Voluntary PF', built: true },
    { title: 'Corporate NPS', href: null, note: 'ESS → Corporate NPS', built: true },
  ]
  return (
    <div>
      <SectionCard title="Benefits & Loans" icon={<IconHeart size={16} />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(240px, 100%),1fr))', gap: 12 }}>
          {items.map(it => (
            <div key={it.title} style={{ border: `1px solid ${C.border}`, borderRadius: R.md, padding: 14, background: TK.sunken }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                {it.href ? (
                  <a href={it.href} style={{ fontSize: TF.small, fontWeight: W.bold, color: C.purple, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{it.title} <IconArrowRight size={13} /></a>
                ) : (
                  <span style={{ fontSize: TF.small, fontWeight: W.bold, color: C.navy }}>{it.title}</span>
                )}
                {it.built && <StatusPill t="positive" size="sm" dot>Built (employee ESS)</StatusPill>}
              </div>
              <div style={{ fontSize: TF.tiny, color: C.muted }}>{it.note}</div>
            </div>
          ))}
        </div>
      </SectionCard>
      <InfoCallout t="info" compact>Loans, salary advance &amp; recovery schedules: planned.</InfoCallout>
    </div>
  )
}

// ── EmployeesTab — payroll view of active employees + CTC + export ──
function EmployeesTab({ companyId }: { companyId: string }) {
  const [emps, setEmps] = useState<PayrollEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const allCo = !companyId   // Group Companies mode → show all companies together
  const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
  useEffect(() => { setLoading(true); loadPayrollEmployees(companyId).then(d => { setEmps(d); setLoading(false) }) }, [companyId])

  const depts = Array.from(new Set(emps.map(e => e.department).filter(Boolean))) as string[]
  const filtered = emps.filter(e => {
    if (dept && e.department !== dept) return false
    if (q.trim()) { const s = q.toLowerCase(); return (e.emp_code || '').toLowerCase().includes(s) || (e.full_name || '').toLowerCase().includes(s) }
    return true
  })
  const missingCtc = emps.filter(e => !e.annual_ctc).length

  function exportExcel() {
    const rows = filtered.map(e => ({
      'Company': e.company || '', 'Employee Code': e.emp_code, 'Name': e.full_name, 'Designation': e.designation || '', 'Department': e.department || '', 'Location': e.location || '',
      'Annual CTC': e.annual_ctc, 'Basic (monthly)': e.basic_monthly, 'HRA (monthly)': e.hra_monthly,
      'Tax Regime': e.tds_regime || '', 'PF': e.pf_applicable ? 'Yes' : 'No', 'ESIC': e.esic_applicable ? 'Yes' : 'No', 'PT': e.pt_applicable ? 'Yes' : 'No', 'LWF': e.lwf_applicable ? 'Yes' : 'No',
      'Bank': e.bank_name || '', 'IFSC': e.ifsc_code || '', 'Account (last4)': e.bank_account_last4 || '',
    }))
    if (!rows.length) { alert('No employees to export.'); return }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Payroll Employees')
    XLSX.writeFile(wb, `EZER_Payroll_Employees_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div>
      {/* Sticky under the tab bar (its height plus a hairline gap), so the search and the
          export count stay in reach while scrolling a 400-row table. */}
      <div style={{ position: 'sticky', top: 76, zIndex: 29, marginBottom: SP.lg }}>
        <FilterBar label={<>Employees &amp; CTC <span style={{ ...numeric }}>({filtered.length})</span></>}
          active={!!(q.trim() || dept)}
          summary={missingCtc > 0
            ? <span style={{ color: C.amber }}>{missingCtc} employee(s) have no CTC in ctc_master, so CTC/Basic show ₹0. Seed ctc_master to populate.</span>
            : <>Showing <b>{filtered.length}</b> of {emps.length} employees{allCo ? ' across all companies' : ''}. Export follows the search and department.</>}
          summaryTone={missingCtc > 0 ? 'warning' : undefined}>
          <FilterField label="Search" grow minWidth={220}>
            <input style={fieldStyle} placeholder="Search code / name…" value={q} onChange={e => setQ(e.target.value)} />
          </FilterField>
          <FilterField label="Department" minWidth={200}>
            <select style={{ ...fieldStyle, cursor: 'pointer' }} value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </FilterField>
          <div style={{ marginLeft: 'auto' }}>
            <PButton variant="primary" icon={<IconDownload size={14} />} onClick={exportExcel} title={filtered.length < emps.length ? `Only the ${filtered.length} employees matching the search / department` : undefined}>Export Excel ({filtered.length})</PButton>
          </div>
        </FilterBar>
      </div>
      {loading ? <SectionCard><div style={{ color: C.muted, fontSize: TF.small }}>Loading…</div></SectionCard> : (
        <SectionCard flush style={{ overflow: 'visible' }}>
          <DataTable minWidth={allCo ? 880 : 760}>
            <thead><tr>
              {['Code', 'Name', ...(allCo ? ['Company'] : []), 'Dept', 'Regime', 'PF/ESIC/PT/LWF', 'Bank'].map(h =>
                <th key={h} style={dt.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map(e => {
                const stat = [e.pf_applicable && 'PF', e.esic_applicable && 'ESIC', e.pt_applicable && 'PT', e.lwf_applicable && 'LWF'].filter(Boolean) as string[]
                return (
                  <tr key={e.id} className={dt.rowClass}>
                    <td style={dt.tdMono}>{e.emp_code}</td>
                    <td style={dt.td}>
                      <div style={{ color: C.navy, fontWeight: W.semi }}>{e.full_name}</div>
                      <div style={{ fontSize: TF.tiny, color: C.muted }}>{e.designation || '-'}</div>
                    </td>
                    {allCo && <td style={{ ...dt.td, fontSize: TF.tiny }}>{e.company || '-'}</td>}
                    <td style={dt.td}>{e.department || '-'}</td>
                    <td style={dt.td}>{e.tds_regime ? <StatusPill size="sm" t="info">{e.tds_regime}</StatusPill> : '-'}</td>
                    <td style={dt.td}>
                      {stat.length ? (
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {stat.map(x => <span key={x} style={{ fontSize: TF.micro, fontWeight: W.semi, padding: '1px 7px', borderRadius: 99, background: TK.brandTint, color: C.purpleDark, border: `1px solid ${TK.brandEdge}` }}>{x}</span>)}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ ...dt.td, fontSize: TF.tiny, whiteSpace: 'nowrap' }}>{e.bank_name || '-'}<span style={{ ...numeric, color: C.muted }}>{e.bank_account_last4 ? ` ••${e.bank_account_last4}` : ''}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        </SectionCard>
      )}
      <InfoCallout t="info" compact>Source of truth is HRMS (employees + ctc_master). Versioned CTC (from_date/active_month), salary revision &amp; arrears: planned.</InfoCallout>
    </div>
  )
}

// ── PlannedTab (generic) ──────────────────────────────────────────
function PlannedTab({ title, items }: { title: string; items: string[] }) {
  return (
    <SectionCard title={title} icon={<IconLayers size={16} />} iconTone="neutral" actions={<PlannedBadge />}>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: TF.small, color: C.navy }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: TK.lineStrong, marginTop: 7, flexShrink: 0 }} />{it}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

// The scrolling strip inside the tab bar. When the ten tabs do not fit, the edge that
// hides more tabs fades out and carries a small arrow, so "there is more this way" is
// visible instead of discovered by accident. The arrows are positioned against the
// sticky bar (this strip is not positioned), same as the menus.
function TabStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const upd = () => setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    window.addEventListener('resize', upd)
    return () => { el.removeEventListener('scroll', upd); window.removeEventListener('resize', upd) }
  }, [])
  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 320, behavior: 'smooth' })
  const arrow = (side: 'l' | 'r'): React.CSSProperties => ({
    position: 'absolute', top: 0, bottom: 0, [side === 'l' ? 'left' : 'right']: 0, width: 56, zIndex: Z.raised,
    display: 'flex', alignItems: 'center', justifyContent: side === 'l' ? 'flex-start' : 'flex-end', padding: '0 6px',
    background: `linear-gradient(${side === 'l' ? '90deg' : '270deg'}, ${TK.surface} 45%, transparent)`,
    borderRadius: side === 'l' ? `${R.lg}px 0 0 ${R.lg}px` : `0 ${R.lg}px ${R.lg}px 0`, pointerEvents: 'none',
  })
  const btn: React.CSSProperties = {
    pointerEvents: 'auto', width: 28, height: 28, borderRadius: 99, border: `1px solid ${TK.lineStrong}`,
    background: TK.surface, color: TK.inkSoft, boxShadow: E.flat, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  }
  return (
    <>
      <div ref={ref} data-tabstrip className="ez-scroll" style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: '6px 8px 7px', scrollbarWidth: 'none' }}>
        {children}
      </div>
      {edge.l && <div style={arrow('l')}><button aria-label="Scroll tabs left" onClick={() => nudge(-1)} style={btn}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><IconChevron size={14} /></span></button></div>}
      {edge.r && <div style={arrow('r')}><button aria-label="Scroll tabs right" onClick={() => nudge(1)} style={btn}><IconChevron size={14} /></button></div>}
    </>
  )
}

// ── Parent ────────────────────────────────────────────────────────
const FY_OPTIONS = ['2026-27', '2025-26', '2024-25']
interface CompanyOpt { id: string; company_name: string; group_id?: string | null; group_name?: string | null }

export default function PayrollPage() {
  const { grant } = useGrant()
  const [companies, setCompanies] = useState<CompanyOpt[]>([])
  const [companyId, setCompanyId] = useState('')   // '' = Group Companies
  const [fy, setFy] = useState('2026-27')
  const [tab, setTab] = useState('dashboard')
  useEffect(() => {
    const vis = ['dashboard','config','attendance','employees','run','statutory','benefits','offcycle','reports','admin'].filter(k => canSeeScreen(grant, 'payroll.'+k))
    if (vis.length && !vis.includes(tab)) setTab(vis[0])
  }, [grant, tab])
  const [sub, setSub] = useState('')                // active sub-section id within the current tab
  const [subView, setSubView] = useState('catalog') // active nested sub-view (e.g. Pay Heads → Standard)

  useEffect(() => {
    loadCompanies().then(list => setCompanies(list as any))   // default header = "Group Companies" ('' = all)
  }, [])

  // companyId '' = Group Companies → the scoped tabs show/act on all companies at once.
  const ctx = { companyId, fy, subView }
  const sections = subsForTab(tab, ctx)
  const activeSub = sections.find(s => s.id === sub) || sections[0]
  const tabMeta = TABS.find(t => t.id === tab)!

  const visibleTabs = TABS.filter(t => canSeeScreen(grant, 'payroll.' + t.id))
  const groupNames = Array.from(new Set(companies.map(c => c.group_name || 'Companies')))
  const scopeCompany = companyId ? companies.find(c => c.id === companyId)?.company_name : ''
  const TabIcon = TAB_ICON[tab] || IconLayers

  return (
    <div style={S.page}>
      <div style={S.content}>
        {/* Header */}
        <PayrollPageHeader
          eyebrow="Money"
          icon={<IconPayroll size={20} />}
          title="Payroll"
          subtitle="Set up, run, file and close each month’s pay — attendance to payslips, with statutory built in."
          meta={<>
            <StatusPill t="brand" size="sm" icon={<IconCalendar size={12} />}>FY {fy}</StatusPill>
            <StatusPill t="neutral" size="sm" icon={<IconBuilding size={12} />}>
              {companyId ? (scopeCompany || 'Company') : `Group Companies${companies.length ? ` · ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}` : ''}`}
            </StatusPill>
          </>}
          actions={<>
            <ControlSelect label="Financial Year" icon={<IconCalendar size={15} />} minWidth={150} strong
              value={fy} onChange={e => setFy(e.target.value)}>
              {FY_OPTIONS.map(y => <option key={y} value={y}>FY {y}</option>)}
            </ControlSelect>
            <ControlSelect label="Company" icon={<IconBuilding size={15} />} minWidth={260}
              value={companyId} onChange={e => setCompanyId(e.target.value)}>
              {(() => {
                // Group the companies under their group name (e.g. "Sharma Group").
                const groups = groupNames
                return <>
                  <option value="">Group Companies{groups.length === 1 && groups[0] !== 'Companies' ? ` (${groups[0]})` : ''}</option>
                  {groups.map(g => (
                    <optgroup key={g} label={g}>
                      {companies.filter(c => (c.group_name || 'Companies') === g).map(c => (
                        <option key={c.id} value={c.id}>{c.company_name}</option>
                      ))}
                    </optgroup>
                  ))}
                </>
              })()}
            </ControlSelect>
          </>}
        />

        {/* Tab bar — each main tab is a dropdown of its sub-sections; pick one to enter it.
            Laid out by stage of the payroll month, and scrolls sideways inside itself
            rather than wrapping onto a second row. The bar (sticky, so positioned) is the
            menus' containing block; the strip inside it is the scroller. See
            MainTabDropdown for why that split matters. */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 30, marginBottom: SP.lg,
          background: TK.surface, border: `1px solid ${C.border}`, borderRadius: R.lg, boxShadow: E.raised,
        }}>
          <TabStrip>
            {TAB_GROUPS.map(g => ({ ...g, tabs: g.ids.map(id => visibleTabs.find(t => t.id === id)).filter(Boolean) as typeof TABS }))
              .filter(g => g.tabs.length > 0)
              .map((g, gi) => (
                <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, paddingLeft: gi === 0 ? 0 : 8, marginLeft: gi === 0 ? 0 : 8, borderLeft: gi === 0 ? 'none' : `1px solid ${C.border}` }}>
                  <span style={{ ...eyebrow, fontSize: 10, color: TK.faint, padding: '2px 11px 0', whiteSpace: 'nowrap' }}>{g.label}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {g.tabs.map(t => (
                      <MainTabDropdown
                        key={t.id}
                        id={t.id}
                        label={t.label}
                        isActive={tab === t.id}
                        sections={subsForTab(t.id, ctx)}
                        activeSub={tab === t.id ? (activeSub?.id || '') : ''}
                        activeChild={tab === t.id ? subView : ''}
                        onPick={(subId, childId) => { setTab(t.id); setSub(subId); if (childId) setSubView(childId) }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            {/* Any visible tab not placed in a group above still gets a slot. */}
            {visibleTabs.filter(t => !TAB_GROUPS.some(g => g.ids.includes(t.id))).map(t => (
              <MainTabDropdown key={t.id} id={t.id} label={t.label} isActive={tab === t.id} sections={subsForTab(t.id, ctx)}
                activeSub={tab === t.id ? (activeSub?.id || '') : ''} activeChild={tab === t.id ? subView : ''}
                onPick={(subId, childId) => { setTab(t.id); setSub(subId); if (childId) setSubView(childId) }} />
            ))}
          </TabStrip>
        </div>

        {/* Active panel */}
        {tab === 'dashboard' ? (
          <>
            <SubTabHead crumbs={['Dashboard']} subtitle={tabMeta.subtitle} built={0} total={0} icon={<TabIcon size={18} />} />
            <PayrollDashboard companyId={companyId} fy={fy} companies={companies} />
          </>
        ) : (
          <>
            <SubTabHead icon={<TabIcon size={18} />} crumbs={(() => {
              const crumbs = [tabMeta.title]
              if (activeSub) crumbs.push(activeSub.label)
              const child = activeSub?.children?.find(c => c.id === subView)
              if (child) crumbs.push(child.label.replace(/^[^A-Za-z0-9]+/, ''))   // strip leading emoji
              return crumbs
            })()} subtitle={tabMeta.subtitle} built={sections.filter(s => s.built).length} total={sections.length} />
            {activeSub && (activeSub.render ? activeSub.render() : activeSub.built ? <BuiltPanel s={activeSub} /> : <PlannedPanel s={activeSub} />)}
          </>
        )}
      </div>
    </div>
  )
}
