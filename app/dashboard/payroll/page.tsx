'use client'
import { useState, useEffect, useRef } from 'react'
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
import CompanyStructureView from '@/components/payroll/CompanyStructureView'

// ── Palette (guide-mandated) ──────────────────────────────────────
const C = {
  bg: '#F5F3FF', navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#3C3489',
  card: '#FFFFFF', border: '#E9E7F5', muted: '#6B6B7B',
  success: '#059669', amber: '#B45309', red: '#DC2626',
  font: '"DM Sans","Segoe UI",sans-serif',
}
const S = {
  page: { background: C.bg, minHeight: '100vh', padding: 20, color: C.navy, fontFamily: C.font, fontSize: 13 } as React.CSSProperties,
  content: { maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  card: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: '16px 18px', marginBottom: 14, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  label: { fontSize: 11, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 } as React.CSSProperties,
  input: { width: '100%', padding: '8px 11px', background: '#FAFAF8', border: `1px solid ${C.border}`, borderRadius: 8, color: C.navy, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: C.purple, color: '#fff', whiteSpace: 'nowrap' } as React.CSSProperties,
  btnOutline: { padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: C.purple, whiteSpace: 'nowrap' } as React.CSSProperties,
  btnDanger: { padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.red}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', background: '#fff', color: C.red } as React.CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, color: C.navy, margin: 0 } as React.CSSProperties,
  sub: { fontSize: 12, color: C.muted, marginTop: 2 } as React.CSSProperties,
  cardTitle: { fontSize: 14, fontWeight: 600, color: C.navy, marginBottom: 12 } as React.CSSProperties,
  note: { background: 'rgba(124,58,237,0.05)', border: `1px dashed ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: C.muted } as React.CSSProperties,
}

const TABS: { id: string; label: string; title: string; subtitle: string }[] = [
  { id: 'dashboard', label: '📊 Dashboard', title: 'Dashboard', subtitle: 'Headcount, cost, compliance deadlines & recent activity at a glance' },
  { id: 'config', label: '🔧 Configuration', title: 'Configuration', subtitle: 'Group setup, pay heads, statutory slabs & tax rules' },
  { id: 'attendance', label: '📤 Attendance', title: 'Attendance', subtitle: 'Upload attendance / leave / OT into the month snapshot' },
  { id: 'employees', label: '👥 Employees & CTC', title: 'Employees & CTC', subtitle: 'Payroll view of the workforce, CTC master and bank details' },
  { id: 'run', label: '▶️ Payroll Run', title: 'Payroll Run', subtitle: 'The heart — month create → sync → calculate → approve → disburse → lock' },
  { id: 'statutory', label: '⚖️ Statutory & Tax', title: 'Statutory & Tax', subtitle: 'Compliance-by-design — PF, ESIC, PT, LWF, NPS and TDS' },
  { id: 'benefits', label: '🎁 Benefits & Loans', title: 'Benefits & Loans', subtitle: 'Flexi benefits, NPS, insurance and the full loan lifecycle' },
  { id: 'offcycle', label: '🔁 Off-cycle · Bonus · FNF', title: 'Off-cycle · Bonus · FNF', subtitle: 'Ad-hoc payments, bonus registers and full & final settlement' },
  { id: 'reports', label: '📊 Outputs & Reports', title: 'Outputs & Reports', subtitle: 'Payslips, registers, bank files, challans and dashboards' },
  { id: 'admin', label: '🛡️ Admin & Controls', title: 'Admin & Controls', subtitle: 'Access control, approvals and the full audit trail' },
]

// ── Small shared bits ─────────────────────────────────────────────
function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: bg, color, letterSpacing: '.03em' }}>{text}</span>
}

const HEAD_COLORS: Record<string, { bg: string; color: string }> = {
  EARNING: { bg: 'rgba(5,150,105,0.12)', color: C.success },
  DEDUCTION: { bg: 'rgba(220,38,38,0.12)', color: C.red },
  EMPLOYER: { bg: 'rgba(124,58,237,0.12)', color: C.purple },
  NON_SALARY: { bg: 'rgba(180,83,9,0.12)', color: C.amber },
}

function PlannedBadge() {
  return <Badge text="Planned" bg="rgba(107,107,123,0.14)" color={C.muted} />
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

function SubTabHead({ crumbs, subtitle, built, total }: { crumbs: string[]; subtitle: string; built: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: '#C9C7D6', fontSize: 15 }}>›</span>}
                <span style={{ fontSize: 17, fontWeight: last ? 700 : 600, color: last ? C.navy : C.muted }}>{c}</span>
              </span>
            )
          })}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: C.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: C.success }} />{built} built</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: '#C9C7D6' }} />{total - built} planned</span>
      </div>
    </div>
  )
}

// Main-tab button that opens a dropdown of its own sub-sections. Clicking a section
// enters that tab + section. The menu hangs directly off the tab button.
function MainTabDropdown({ label, isActive, sections, activeSub, activeChild, onPick }: {
  label: string; isActive: boolean; sections: SubTab[]; activeSub: string; activeChild?: string; onPick: (id: string, childId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // which sections have their children expanded
  const btnRef = useRef<HTMLButtonElement>(null)
  const built = sections.filter(s => s.built).length

  // The menu is anchored to the button by LAYOUT (position: absolute inside the button's
  // relative wrapper), not by viewport coordinates written into position: fixed.
  //
  // It used to measure getBoundingClientRect() and place a fixed-position panel at those
  // numbers. That silently breaks whenever anything between the button and the viewport
  // creates a containing block — a transform, a filter, contain: paint — because fixed
  // then resolves against that ancestor instead of the screen, and the panel lands
  // hundreds of pixels away. It looked fine on most machines and badly wrong on others,
  // which is exactly how that class of bug behaves. Layout anchoring cannot drift: the
  // menu is a child of the button's wrapper, so it goes where the button is, full stop.
  //
  // The original reason for fixed — escaping the tab bar's horizontal scroll — no longer
  // exists; the bar wraps onto multiple rows instead of scrolling.
  const toggle = () => {
    if (sections.length === 0) { onPick(''); return }   // no sub-sections (e.g. Dashboard) → just activate the tab
    if (!open) {
      // Only decides which EDGE the menu hangs from. If this measurement is off the menu
      // is still glued to the button — it just opens leftward instead of rightward.
      const r = btnRef.current?.getBoundingClientRect()
      setAlignRight(!!r && typeof window !== 'undefined' && r.left > window.innerWidth * 0.55)
      setExpanded(new Set())   // each time the menu opens, sub-sections start collapsed
    }
    setOpen(o => !o)
  }
  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button ref={btnRef} onClick={toggle} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 8,
        border: `1px solid ${isActive || open ? C.purple : C.border}`, background: isActive ? C.purple : '#fff',
        color: isActive ? '#fff' : C.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        boxShadow: open ? '0 6px 20px rgba(124,58,237,0.18)' : 'none',
      }}>
        {label}
        {sections.length > 0 && <span style={{ fontSize: 10, opacity: .9, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}>▾</span>}
      </button>
      {open && sections.length > 0 && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)',
            ...(alignRight ? { right: 0 } : { left: 0 }),
            zIndex: 1001, minWidth: 262, maxHeight: '70vh', overflowY: 'auto',
            background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12,
            boxShadow: '0 14px 38px rgba(30,27,75,0.22)', padding: 6,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', padding: '6px 10px 8px' }}>Sections · {built}/{sections.length} built</div>
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
                    onMouseEnter={e => { if (!rowActive) (e.currentTarget as HTMLButtonElement).style.background = '#F7F5FF' }}
                    onMouseLeave={e => { if (!rowActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 9,
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: 2,
                      background: rowActive ? 'rgba(124,58,237,0.09)' : 'transparent',
                    }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: 'center', flexShrink: 0 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? C.purpleDark : C.navy, flex: 1 }}>{s.label}</span>
                    {hasKids ? (
                      <span style={{ color: C.muted, fontSize: 11, flexShrink: 0, transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
                    ) : (
                      <>
                        <span title={s.built ? 'Built' : 'Planned'} style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: s.built ? C.success : '#C9C7D6' }} />
                        {on && <span style={{ color: C.purple, fontSize: 13, marginLeft: 2 }}>✓</span>}
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
                            onMouseEnter={e => { if (!kon) (e.currentTarget as HTMLButtonElement).style.background = '#F7F5FF' }}
                            onMouseLeave={e => { if (!kon) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8,
                              border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: 1,
                              background: kon ? 'rgba(124,58,237,0.09)' : 'transparent',
                            }}>
                            <span style={{ fontSize: 12.5, fontWeight: kon ? 700 : 500, color: kon ? C.purpleDark : C.navy, flex: 1 }}>{k.label}</span>
                            {kon && <span style={{ color: C.purple, fontSize: 12 }}>✓</span>}
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

function Chips({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, justifyContent: 'center' }}>
      {items.map(p => (
        <span key={p} style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 99, background: 'rgba(124,58,237,0.06)', border: `1px solid ${C.border}`, color: C.purpleDark }}>{p}</span>
      ))}
    </div>
  )
}

function PlannedPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, textAlign: 'center', padding: '38px 24px' }}>
      <div style={{ width: 58, height: 58, borderRadius: 16, background: 'rgba(124,58,237,0.07)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px' }}>{s.icon}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>{s.label}</span>
        <PlannedBadge />
      </div>
      {s.desc && <div style={{ fontSize: 13, color: C.muted, maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>{s.desc}</div>}
      {s.points && <Chips items={s.points} />}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 16, opacity: 0.8 }}>On the payroll roadmap — structure ready, wiring next.</div>
    </div>
  )
}

function BuiltPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, padding: '26px 24px' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(5,150,105,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{s.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>{s.label}</span>
            <Badge text="Built" bg="rgba(5,150,105,0.12)" color={C.success} />
          </div>
          {s.desc && <div style={{ fontSize: 13, color: C.muted, margin: '7px 0 0', lineHeight: 1.6 }}>{s.desc}</div>}
          {s.points && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>{s.points.map(p => <span key={p} style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 99, background: 'rgba(5,150,105,0.08)', color: C.success }}>{p}</span>)}</div>}
          {s.href && <div style={{ marginTop: 14 }}><a href={s.href} style={{ ...S.btnPrimary, display: 'inline-block', textDecoration: 'none' }}>Open →</a></div>}
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
    { id: 'payheads', label: 'Pay Heads', icon: '🧾', built: true,
      children: [
        { id: 'catalog', label: '📋 Standard Pay Heads' },
        { id: 'flexi', label: '🎛️ Flexi / FBP' },
        { id: 'nonstd', label: '👥 Non-standard Types' },
        { id: 'rules', label: '⚖️ Business Rules' },
      ],
      render: () => <PayHeadCatalog view={['flexi', 'nonstd', 'rules'].includes(subView) ? subView : 'catalog'} /> },
    { id: 'group', label: 'Group & Company', icon: '🏢', built: true, groupGlobal: true, render: () => <CompanyProfileView /> },
    { id: 'fymonth', label: 'Payroll Month', icon: '🗓️', built: true,
      children: [
        { id: 'create', label: '📅 Create Month' },
        { id: 'freeze', label: '❄️ Freeze Month' },
        { id: 'unfreeze', label: '☀️ Unfreeze Month' },
        // PayrollMonthTab always supported this mode; it just had no menu entry, so the
        // only way to lock a month was the Advance button that Run Cycle no longer has.
        { id: 'lock', label: '🔒 Lock / Unlock Month' },
      ],
      render: () => <PayrollMonthTab companyId={companyId} fy={fy} mode={(['create', 'freeze', 'unfreeze'].includes(subView) ? subView : 'create') as PmMode} /> },
    { id: 'categories', label: 'Department · Sub-dept · Location', icon: '🗂️', built: true, render: () => <CompanyStructureView companyId={companyId} /> },
    { id: 'perquisite', label: 'Perquisite', icon: '🚗', built: true, render: () => <PerquisitesConfig fy={fy} /> },
    { id: 'bonus', label: 'Bonus Config', icon: '🎯', built: true, render: () => <BonusConfig fy={fy} /> },
    { id: 'tax', label: 'Tax Config', icon: '🧮', built: true, render: () => <IncomeTaxConfig /> },
    { id: 'lwf', label: 'LWF', icon: '🏛️', built: true, render: () => <LwfConfig /> },
    { id: 'esic', label: 'ESIC', icon: '🏥', built: true, render: () => <EsicConfig /> },
    { id: 'epf', label: 'EPF', icon: '🏦', built: true, render: () => <EpfConfig /> },
    { id: 'slabs', label: 'PT Slabs', icon: '⚖️', built: true, render: () => <PtConfig /> },
    { id: 'minwages', label: 'Minimum Wages', icon: '📊', built: true, render: () => <MinimumWageConfig /> },
  ]
}

function attendanceSubs(companyId: string, fy: string): SubTab[] {
  return [
    { id: 'upload', label: 'Attendance Upload', icon: '📤', built: true, render: () => <AttendanceUpload companyId={companyId} fy={fy} /> },
    { id: 'ot', label: 'OT Upload', icon: '⏱️', built: true, render: () => <OtUpload companyId={companyId} fy={fy} /> },
    { id: 'edit', label: 'Attendance Edit', icon: '✏️', built: true, render: () => <AttendanceEditTab companyId={companyId} fy={fy} /> },
    { id: 'arrear', label: 'Arrear Days', icon: '📌', built: true, render: () => <AttendanceEdit companyId={companyId} fy={fy} mode="arrear" /> },
  ]
}

function employeeSubs(companyId: string): SubTab[] {
  return [
    { id: 'master', label: 'Employee & CTC Master', icon: '👥', built: true, render: () => <EmployeesTab companyId={companyId} /> },
    { id: 'bank', label: 'Bank Details', icon: '🏦', built: true, render: () => <BankDetailsTab companyId={companyId} /> },
    { id: 'revision', label: 'Salary Revision & Arrears', icon: '📈', built: true, render: () => <Appraisal /> },
  ]
}

function runSubs(companyId: string, fy: string): SubTab[] {
  return [
    { id: 'cycle', label: 'Run Cycle', icon: '▶️', built: true, render: () => <RunCycle companyId={companyId} headerFy={fy} /> },
    { id: 'sync', label: 'Data Sync', icon: '🔄', built: true, render: () => <MonthSync companyId={companyId} fy={fy} /> },
    { id: 'uploaders', label: 'Bulk Uploaders', icon: '📤', built: true, render: () => <ManualVoucher companyId={companyId} fy={fy} /> },
    { id: 'arrearpay', label: 'Arrear & Payments', icon: '💸', built: true, render: () => <ArrearPayments companyId={companyId} fy={fy} /> },
    { id: 'lock', label: 'Lock / Unlock', icon: '🔒', built: true, render: () => <LockUnlock companyId={companyId} fy={fy} /> },
    { id: 'minwage', label: 'Minimum Wages Check', icon: '🛡️', desc: 'Flags employees whose gross falls below the applicable state minimum wage before payroll is processed.' },
  ]
}

function statutorySubs(fy: string): SubTab[] {
  return [
    { id: 'pf', label: 'PF / EPF + VPF', icon: '🏦', built: true, href: '/dashboard/ess', desc: 'EPF @12% of capped wage is computed in the engine; VPF opt-in is available in the employee ESS portal.' },
    { id: 'esic', label: 'ESIC', icon: '🩺', built: true, desc: '0.75% employee / 3.25% employer, auto-applied for gross ≤ ₹21,000 during Calculate. Challan export is planned.' },
    // Same components the Configuration menu shows — one screen each, not copies:
    // two LWF or PT screens would eventually disagree, and whichever one HR happened to
    // open would decide what they believed.
    { id: 'lwf', label: 'LWF', icon: '🏛️', built: true, render: () => <LwfConfig /> },
    { id: 'ptlwf', label: 'Professional Tax', icon: '⚖️', built: true, render: () => <PtConfig /> },
    { id: 'nps', label: 'NPS', icon: '🏛️', built: true, href: '/dashboard/ess', desc: 'Corporate NPS enrolment via ESS; 80CCD(2) contribution is deducted in the engine.' },
    { id: 'tds', label: 'TDS Calculation', icon: '🧮', built: true, desc: 'Monthly TDS from each employee’s investment declaration feeds directly into the payroll run.' },
    { id: 'form16', label: 'Form 16 / 24Q', icon: '📄', desc: 'Quarterly 24Q returns and annual Form 16 generation for employees.' },
    { id: 'perq', label: 'Perquisite Tax', icon: '🚗', built: true, render: () => <PerquisiteStatutoryPanel fy={fy} /> },
  ]
}

function benefitsSubs(): SubTab[] {
  return [
    { id: 'flexi', label: 'Flexi Benefit Plan', icon: '🎛️', built: true, href: '/dashboard/flexi-policy', desc: 'FBP components, slabs and employee declarations (old vs new regime).' },
    { id: 'flexiclaims', label: 'Flexi Claims', icon: '💳', built: true, href: '/dashboard/flexi-claims', desc: 'Review reimbursement bills, manage the monthly submission window and per-employee limits. Approved claims flow into payroll.' },
    { id: 'flexiinvoices', label: 'Flexi Invoices & Vouchers', icon: '🧾', built: true, href: '/dashboard/flexi-invoices', desc: 'Generate reimbursement vouchers (PDF) for approved flexi claims — one per employee per month, with invoice number EZER-FLX-…' },
    { id: 'nps', label: 'Corporate NPS', icon: '🏛️', built: true, href: '/dashboard/ess', desc: 'Employer NPS enrolment and monthly contribution.' },
    { id: 'insurance', label: 'Insurance / Meal Cards', icon: '🍱', desc: 'GMC / GPA insurance, meal & fuel cards and other benefit heads.' },
    { id: 'loan', label: 'Loan Disbursal & Schedule', icon: '💸', built: true, href: '/dashboard/loans', desc: 'Loan requests, approval workflow, disbursal and the EMI amortisation schedule.' },
    { id: 'emi', label: 'EMI Auto-Deduct', icon: '🔁', built: true, desc: 'Pending EMIs for the month are pulled into the payroll run automatically during Calculate.' },
    { id: 'foreclose', label: 'Part-payment / Foreclosure', icon: '✅', built: true, href: '/dashboard/loans', desc: 'Part-prepayment and foreclosure recalculate the outstanding schedule.' },
  ]
}

function offcycleSubs(): SubTab[] {
  return [
    { id: 'offcycle', label: 'Off-cycle Payments', icon: '💵', desc: 'Ad-hoc payments outside the monthly cycle — incentives, reimbursements, one-time payouts.' },
    { id: 'bonuscalc', label: 'Bonus Calculation', icon: '🎯', desc: 'Statutory (8.33–20%) and performance bonus computation with eligibility rules.' },
    { id: 'bonusreg', label: 'Bonus Register', icon: '📖', desc: 'Form C bonus register for statutory compliance.' },
    { id: 'fnfcreate', label: 'FNF Creation', icon: '📝', desc: 'Initiate full & final settlement for exited / resigned employees.' },
    { id: 'fnfprocess', label: 'FNF Process', icon: '📤', desc: 'Leave encashment, gratuity, notice recovery and the final settlement statement.' },
  ]
}

function reportsSubs(): SubTab[] {
  return [
    { id: 'register', label: 'Payroll Register', icon: '📊', built: true, desc: 'The full computed register for a run — export from Payroll Run → 📥 Register (one row per employee with every earning & deduction).' },
    { id: 'payslip', label: 'Salary Slip Generator', icon: '🧾', desc: 'Branded PDF payslips per employee on the Sharma Group letterhead, pushed to the ESS portal.' },
    { id: 'annual', label: 'Annual Salary', icon: '📅', desc: 'Year-to-date earnings & deductions statement per employee.' },
    { id: 'neft', label: 'Bank Transfer File (NEFT)', icon: '🏦', desc: 'Bank-ready NEFT / RTGS salary file with UTF-8 BOM (IFSC, account, amount, narration).' },
    { id: 'challans', label: 'PF ECR · ESIC · PT Challans', icon: '📑', desc: 'Statutory challan and PF ECR text files for upload to government portals.' },
    { id: 'dashboards', label: 'Month-end Dashboards', icon: '📈', desc: 'Headcount, pay summary, location-wise cost and month-on-month variance.' },
    { id: 'mis', label: 'MIS / Variance', icon: '🔍', desc: 'Custom MIS and variance reports across runs.' },
  ]
}

function adminSubs(companyId: string): SubTab[] {
  return [
    { id: 'audit', label: 'Audit Trail', icon: '📜', built: true, render: () => <AuditCard companyId={companyId} refreshKey={0} /> },
    { id: 'rbac', label: 'Role-based Access', icon: '🔑', built: true, href: '/dashboard/roles', desc: 'Payroll roles and permissions are managed in ESS & Role Management.' },
    { id: 'approval', label: 'Approval Workflows', icon: '✅', desc: 'Maker-checker approval chains for payroll sign-off before disbursement.' },
    { id: 'approvalmail', label: 'Approval Mail + Reports', icon: '✉️', desc: 'Automated approval emails with the run summary attached.' },
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
      <div style={S.card}>
        <div style={S.cardTitle}>Pay Heads</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr 0.8fr', gap: 10, marginBottom: 10 }}>
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
            <select style={S.input} value={headType} onChange={e => setHeadType(e.target.value)}>
              <option value="EARNING">EARNING</option>
              <option value="DEDUCTION">DEDUCTION</option>
              <option value="EMPLOYER">EMPLOYER</option>
              <option value="NON_SALARY">NON_SALARY</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Calc type</label>
            <select style={S.input} value={calcType} onChange={e => setCalcType(e.target.value)}>
              <option value="FIXED">FIXED</option>
              <option value="PCT_BASIC">PCT_BASIC</option>
              <option value="PCT_CTC">PCT_CTC</option>
              <option value="FORMULA">FORMULA</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Value</label>
            <input style={S.input} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.navy, cursor: 'pointer' }}>
            <input type="checkbox" checked={taxable} onChange={e => setTaxable(e.target.checked)} /> Taxable
          </label>
          <button style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={add}>Add</button>
          {err && <span style={{ color: C.red, fontSize: 12 }}>{err}</span>}
        </div>
      </div>

      <div style={S.card}>
        {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : heads.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12 }}>No pay heads yet. Add one above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ padding: '6px 8px' }}>Code</th>
                  <th style={{ padding: '6px 8px' }}>Name</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Calc</th>
                  <th style={{ padding: '6px 8px' }}>Taxable</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {heads.map(h => {
                  const hc = HEAD_COLORS[h.head_type] || HEAD_COLORS.EARNING
                  return (
                    <tr key={h.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: C.purpleDark }}>{h.code}</td>
                      <td style={{ padding: '8px', color: C.navy }}>{h.name}</td>
                      <td style={{ padding: '8px' }}><Badge text={h.head_type} bg={hc.bg} color={hc.color} /></td>
                      <td style={{ padding: '8px', color: C.navy }}>{calcLabel(h)}</td>
                      <td style={{ padding: '8px', color: C.muted }}>{h.taxable ? 'Y' : 'N'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}><button style={S.btnDanger} onClick={() => remove(h.id)}>Delete</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={S.note}>Other config (FY/month, PT/LWF/min-wages slabs, tax config, perquisite, bonus) — planned.</div>
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
      if (!rows.length) { setErr(`No month master rows for ${label} — sync the month first.`); return }
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
        summary: `${MONTHS[m - 1]} ${fy} — month master created for ${created} compan${created === 1 ? 'y' : 'ies'}${skipped ? `, ${skipped} already existed` : ''}.`,
        error: failed.length ? failed.join('  ·  ') : undefined,
      }
    }
    const e = await createOne(companyId, m)
    return { summary: e ? '' : `${MONTHS[m - 1]} ${fy} — month master created.`, error: e || undefined }
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

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>{mode === 'create' ? '📅 Create payroll month' : mode === 'freeze' ? '❄️ Freeze payroll month' : mode === 'unfreeze' ? '☀️ Unfreeze payroll month' : '🔒 Lock payroll month'} · FY {fy}</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          {mode === 'create' ? 'Open a new payroll month so it can be processed.'
            : mode === 'freeze' ? 'Freezing locks the attendance snapshot so it can’t change while payroll is calculated.'
              : mode === 'unfreeze' ? 'Re-open a frozen month so attendance can be edited again (reverts it to OPEN).'
                : 'Locking finalises the month — the payroll snapshot becomes immutable. Unlock to re-open it.'}
        </div>
        {mode === 'create' && (
          <>
            {allCo && <div style={{ fontSize: 12, color: C.purpleD, marginTop: 10, background: '#EEEDFE', borderRadius: 7, padding: '7px 11px', display: 'inline-block' }}>Group Companies mode — this creates the month for <b>every company</b> at once (companies that already have it are skipped).</div>}
            <div style={{ marginTop: 12 }}>
              <button style={{ ...S.btnPrimary }} onClick={() => setShowCreate(true)}>➕ {allCo ? 'Create for all companies' : 'Create month'}</button>
            </div>
          </>
        )}
        {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>

      {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : runs.length === 0 ? (
        <div style={S.card}><div style={{ color: C.muted, fontSize: 12 }}>No payroll months for FY {fy}{allCo ? ' across any company' : ''} yet.</div></div>
      ) : (
        <div style={S.card}>
          {allCo ? (
            // Group Companies → one consolidated "Sharma Group · Month" row per month (rolls up all companies' runs).
            Object.values(runs.reduce((acc, r) => { (acc[r.month as number] = acc[r.month as number] || []).push(r); return acc }, {} as Record<number, PayrollRun[]>))
              .sort((a, b) => (a[0].month || 0) - (b[0].month || 0))
              .map(g => {
                const statuses = Array.from(new Set(g.map(r => r.status)))
                const totalEmp = g.reduce((s, r) => s + (r.emp_count || 0), 0)
                const active = g.filter(r => r.status !== 'CANCELLED')
                const freezable = active.filter(r => !FROZEN_OR_BEYOND.includes(r.status))
                const unfreezable = active.filter(r => r.status === 'ATTENDANCE_LOCKED')
                const lockable = active.filter(r => r.status !== 'LOCKED')
                const single = statuses.length === 1
                const pill = single ? statusPill(statuses[0]) : { bg: 'rgba(107,107,123,0.14)', color: C.muted }
                return (
                  <div key={g[0].month} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, minWidth: 200 }}>🏛️ {groupName} · {g[0].period_label || `${g[0].fy} · M${g[0].month}`}</div>
                    <Badge text={`${g.length} compan${g.length === 1 ? 'y' : 'ies'}`} bg="rgba(124,58,237,0.12)" color={C.purple} />
                    <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.color }}>{single ? statuses[0] : statuses.join(' · ')}</span>
                    {mode === 'create' && <span style={{ fontSize: 11, color: C.muted }}>{totalEmp} employees across {g.length}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button style={{ ...S.btnOutline, opacity: dlKey === `g${g[0].month}` ? 0.6 : 1 }} disabled={!!dlKey}
                        onClick={() => downloadMaster(g, `${groupName} ${g[0].period_label || `${g[0].fy} M${g[0].month}`}`, `g${g[0].month}`)}>
                        {dlKey === `g${g[0].month}` ? 'Preparing…' : '⬇ Month Master'}
                      </button>
                      {mode === 'freeze' && (freezable.length
                        ? <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => applyGroup(freezable, 'ATTENDANCE_LOCKED')}>❄️ Freeze all</button>
                        : <span style={{ fontSize: 11, color: C.success, fontWeight: 600 }}>❄️ Frozen</span>)}
                      {mode === 'unfreeze' && (unfreezable.length
                        ? <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => applyGroup(unfreezable, 'OPEN')}>☀️ Unfreeze all</button>
                        : <span style={{ fontSize: 11, color: C.muted }}>nothing to unfreeze</span>)}
                      {mode === 'lock' && (lockable.length
                        ? <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => applyGroup(lockable, 'LOCKED')}>🔒 Lock all</button>
                        : <button style={S.btnOutline} disabled={busy} onClick={() => applyGroup(active, 'DISBURSED')}>🔓 Unlock all</button>)}
                    </div>
                  </div>
                )
              })
          ) : runs.map(run => {
            const pill = statusPill(run.status)
            const frozen = FROZEN_OR_BEYOND.includes(run.status)
            const locked = run.status === 'LOCKED'
            const cancelled = run.status === 'CANCELLED'
            return (
              <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, minWidth: 120 }}>{run.period_label || `${run.fy} · M${run.month}`}</div>
                <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.color }}>{run.status}</span>
                {mode === 'create' && <span style={{ fontSize: 11, color: C.muted }}>{run.emp_count || 0} employees</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button style={{ ...S.btnOutline, opacity: dlKey === run.id ? 0.6 : 1 }} disabled={!!dlKey}
                    onClick={() => downloadMaster([run], `${run.company_name || ''} ${run.period_label || `${run.fy} M${run.month}`}`, run.id)}>
                    {dlKey === run.id ? 'Preparing…' : '⬇ Month Master'}
                  </button>
                  {mode === 'freeze' && !cancelled && (
                    frozen
                      ? <span style={{ fontSize: 11, color: C.success, fontWeight: 600 }}>❄️ Frozen</span>
                      : <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => apply(run, 'ATTENDANCE_LOCKED')}>❄️ Freeze</button>
                  )}
                  {mode === 'unfreeze' && !cancelled && (
                    run.status === 'ATTENDANCE_LOCKED'
                      ? <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => apply(run, 'OPEN')}>☀️ Unfreeze</button>
                      : <span style={{ fontSize: 11, color: C.muted }}>{frozen ? 'processed — can’t unfreeze' : 'not frozen'}</span>
                  )}
                  {mode === 'lock' && !cancelled && (
                    locked
                      ? <button style={S.btnOutline} disabled={busy} onClick={() => apply(run, 'DISBURSED')}>🔓 Unlock</button>
                      : <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => apply(run, 'LOCKED')}>🔒 Lock</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={S.note}>The full run lifecycle (sync → calculate → approve → disburse) lives in <b>Payroll Run</b>. These are shortcuts to create, freeze and lock a month.</div>

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

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: '"DM Sans","Segoe UI",sans-serif' }
  const box: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 20px 55px rgba(30,27,75,0.35)' }
  const GREEN = '#059669'

  return (
    <div style={overlay}>
      <div style={box}>
        {step === 'pick' && (
          <>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, marginBottom: 4 }}>📅 Create payroll month</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{allCo ? 'A month master will be built for every company.' : 'A month master will be built for the selected company.'} Months already created are not listed.</div>
            {availableMonths.length === 0 ? (
              <>
                <div style={{ fontSize: 13, color: C.navy, background: '#EEEDFE', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>All months for FY {fy} have already been created{allCo ? ' for every company' : ''}. 🎉</div>
                <button style={{ ...S.btnOutline, width: '100%' }} onClick={onClose}>Close</button>
              </>
            ) : (
              <>
                <label style={{ fontSize: 10.5, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>Month · FY {fy}</label>
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
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🚫</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, textAlign: 'center', marginBottom: 6 }}>
              Can&apos;t create {monthLabel} yet
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, textAlign: 'center', marginBottom: 16 }}>
              {blockers[0]?.prevLabel} has to be closed off first — attendance processed, month frozen and payroll locked.
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 18 }}>
              {blockers.map(b => (
                <div key={b.companyId} style={{ border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy, marginBottom: 6 }}>{b.companyName} · {b.prevLabel}</div>
                  {[
                    ['Attendance processed', b.attendanceDone, b.attendanceDetail],
                    ['Month frozen', b.frozen, b.frozenDetail],
                    ['Payroll locked', b.locked, b.lockedDetail],
                  ].map(([label, ok, detail]: any) => (
                    <div key={label} style={{ fontSize: 11.5, color: ok ? C.success : C.red, padding: '2px 0' }}>
                      {ok ? '✓' : '✕'} <b>{label}</b>{ok ? '' : ` — ${detail}`}
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
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🗓️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, textAlign: 'center', lineHeight: 1.5, marginBottom: 6 }}>
              Create the month master for<br /><span style={{ color: C.purple, fontSize: 18, fontWeight: 800 }}>{monthLabel}</span>{allCo ? <span style={{ color: C.muted, fontWeight: 600 }}> for all companies</span> : ''}?
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, textAlign: 'center', marginBottom: 20 }}>Each eligible employee&apos;s salary, statutory &amp; bank data will be frozen for this month.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...S.btnPrimary, flex: 1, background: GREEN }} onClick={begin}>✓ Confirm</button>
              <button style={{ ...S.btnOutline }} onClick={() => setStep('pick')}>Cancel</button>
            </div>
          </>
        )}

        {step === 'progress' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginBottom: 4 }}>Creating month master…</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>{monthLabel}{allCo ? ' · all companies' : ''}</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: GREEN, marginBottom: 12 }}>{pct}%</div>
            <div style={{ height: 14, background: '#E7F6EF', borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#10B981,#059669)', borderRadius: 99, transition: 'width .2s ease' }} />
            </div>
            <div style={{ fontSize: 12.5, color: C.navy, fontWeight: 600, minHeight: 18 }}>{stage}</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: 99, background: '#ECFDF5', border: `2px solid ${GREEN}`, color: GREEN, fontSize: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, marginBottom: 8 }}>Month master ready</div>
            {summary && <div style={{ fontSize: 12.5, color: C.navy, marginBottom: err ? 10 : 18 }}>{summary}</div>}
            {err && <div style={{ fontSize: 11.5, color: C.red, background: '#FEF2F2', borderRadius: 8, padding: '8px 10px', marginBottom: 18 }}>{err}</div>}
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
    OPEN: { bg: 'rgba(107,107,123,0.14)', color: C.muted },
    SYNCED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    ATTENDANCE_LOCKED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    CALCULATED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    AI_CHECKED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    APPROVED: { bg: 'rgba(5,150,105,0.12)', color: C.success },
    DISBURSED: { bg: 'rgba(5,150,105,0.12)', color: C.success },
    LOCKED: { bg: 'rgba(30,27,75,0.12)', color: C.navy },
    CANCELLED: { bg: 'rgba(220,38,38,0.12)', color: C.red },
  }
  return map[status] || map.OPEN
}

// ── AuditCard ─────────────────────────────────────────────────────
function AuditCard({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { loadAudit(companyId).then(setRows) }, [companyId, refreshKey])
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>Recent activity</div>
      {rows.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No activity yet.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.slice(0, 12).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'center', borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, paddingTop: i === 0 ? 0 : 6 }}>
              <span style={{ fontWeight: 600, color: C.purpleDark, minWidth: 150 }}>{r.action}</span>
              <span style={{ color: C.muted }}>{r.performed_by || '—'}</span>
              <span style={{ color: C.muted, marginLeft: 'auto' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardTitle}>Benefits &amp; Loans</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
          {items.map(it => (
            <div key={it.title} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: '#FAFAF8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {it.href ? (
                  <a href={it.href} style={{ fontSize: 13, fontWeight: 700, color: C.purple, textDecoration: 'none' }}>{it.title} →</a>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{it.title}</span>
                )}
                {it.built && <Badge text="Built (employee ESS)" bg="rgba(5,150,105,0.12)" color={C.success} />}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{it.note}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={S.note}>Loans, salary advance &amp; recovery schedules — planned.</div>
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
      <div style={{ ...S.card, position: 'sticky', top: 46, zIndex: 29, boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={S.cardTitle}>Employees &amp; CTC ({filtered.length})</div>
          <input style={{ ...S.input, width: 200 }} placeholder="Search code / name…" value={q} onChange={e => setQ(e.target.value)} />
          <select style={{ ...S.input, width: 180 }} value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button style={{ ...S.btnPrimary, marginLeft: 'auto' }} onClick={exportExcel}>📥 Export Excel</button>
        </div>
        {missingCtc > 0 && <div style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>⚠ {missingCtc} employee(s) have no CTC in ctc_master — CTC/Basic show ₹0. Seed ctc_master to populate.</div>}
      </div>
      {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>
              {['Code', 'Name', ...(allCo ? ['Company'] : []), 'Dept', 'Regime', 'PF/ESIC/PT/LWF', 'Bank'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{e.emp_code}</td>
                  <td style={{ padding: '6px 8px' }}>{e.full_name}<div style={{ fontSize: 10, color: C.muted }}>{e.designation || '—'}</div></td>
                  {allCo && <td style={{ padding: '6px 8px', fontSize: 11 }}>{e.company || '—'}</td>}
                  <td style={{ padding: '6px 8px' }}>{e.department || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{e.tds_regime || '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 10 }}>{[e.pf_applicable && 'PF', e.esic_applicable && 'ESIC', e.pt_applicable && 'PT', e.lwf_applicable && 'LWF'].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11 }}>{e.bank_name || '—'}{e.bank_account_last4 ? ` ••${e.bank_account_last4}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={S.note}>Source of truth is HRMS (employees + ctc_master). Versioned CTC (from_date/active_month), salary revision &amp; arrears — planned.</div>
    </div>
  )
}

// ── PlannedTab (generic) ──────────────────────────────────────────
function PlannedTab({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={S.cardTitle}>{title}</div>
        <PlannedBadge />
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => <li key={i} style={{ fontSize: 13, color: C.navy }}>{it}</li>)}
      </ul>
    </div>
  )
}

// ── Parent ────────────────────────────────────────────────────────
const FY_OPTIONS = ['2026-27', '2025-26', '2024-25']
interface CompanyOpt { id: string; company_name: string; group_id?: string | null; group_name?: string | null }

export default function PayrollPage() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([])
  const [companyId, setCompanyId] = useState('')   // '' = Group Companies
  const [fy, setFy] = useState('2026-27')
  const [tab, setTab] = useState('dashboard')
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

  return (
    <div style={S.page}>
      <div style={S.content}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={S.h1}>Payroll</h1>
          </div>
          <div>
            <label style={S.label}>Financial Year</label>
            <select style={{ ...S.input, minWidth: 130 }} value={fy} onChange={e => setFy(e.target.value)}>
              {FY_OPTIONS.map(y => <option key={y} value={y}>FY {y}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Company</label>
            <select style={{ ...S.input, minWidth: 240 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              {(() => {
                // Group the companies under their group name (e.g. "Sharma Group").
                const groups = Array.from(new Set(companies.map(c => c.group_name || 'Companies')))
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
            </select>
          </div>
        </div>

        {/* Tab bar — each main tab is a dropdown of its sub-sections; pick one to enter it.
            Wraps onto multiple rows so every section is always visible without scrolling. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, rowGap: 8, marginBottom: 16, paddingBottom: 8, position: 'sticky', top: 0, zIndex: 30, background: C.bg, paddingTop: 8, boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
          {TABS.map(t => (
            <MainTabDropdown
              key={t.id}
              label={t.label}
              isActive={tab === t.id}
              sections={subsForTab(t.id, ctx)}
              activeSub={tab === t.id ? (activeSub?.id || '') : ''}
              activeChild={tab === t.id ? subView : ''}
              onPick={(subId, childId) => { setTab(t.id); setSub(subId); if (childId) setSubView(childId) }}
            />
          ))}
        </div>

        {/* Active panel */}
        {tab === 'dashboard' ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>Dashboard</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{tabMeta.subtitle}</div>
            </div>
            <PayrollDashboard companyId={companyId} fy={fy} companies={companies} />
          </>
        ) : (
          <>
            <SubTabHead crumbs={(() => {
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
