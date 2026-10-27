'use client'
// components/ess/payroll/PayrollHub.tsx — the head of ESS → Payroll.
//
// Replaces the generic section heading + flat sub-tab strip for the Payroll section
// only. Three things, top to bottom:
//   1. who/what: "Payroll", one plain line of purpose;
//   2. a read-only pay snapshot for the signed-in employee — annual CTC, monthly
//      take-home, tax regime, financial year — from the same loadSalary() the
//      Flexi calculator and the Employee Master read, so a figure here can never
//      disagree with those screens;
//   3. the nine tabs, grouped by what a person is trying to do (get paid, save
//      tax, claim money back, save / borrow). Same items, same go(k), same URLs.
//
// Also exports PayrollComingSoon — the Salary Slip / Statutory placeholder.
//
// Front end only: nothing here writes. Figures are hidden entirely when the portal
// is opened by someone else (admin "login as" / a manager viewing a team member).

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { loadSalary, type SalaryStructure } from '@/lib/employees/hr-actions'
import { supabase } from '@/lib/supabase'
import {
  C, F, W, S, R, E, eyebrow, numeric, scrollX, money,
  IconPayroll, IconLoans, IconReceipt, IconTravel, IconSliders, IconCompliance,
  IconEye, IconEyeOff, IconLock, IconCalendar,
} from '@/lib/ui'
import {
  IconTile, StatusPill, PButton, IconFile, IconPiggyBank, IconUmbrella, IconWallet,
  IconShieldCheck, IconUpload2, IconSparkle, IconArrowRight, IconInfo,
} from './kit'

/** A Payroll sub-tab as the portal's SECTIONS lists it. */
export interface HubItem { k: string; label: string; phase?: number; needs?: string }

type Glyph = (p: { size?: number; strokeWidth?: number }) => React.ReactElement

/** Tab key → glyph. A key not listed here falls back to the payroll glyph. */
const TAB_ICON: Record<string, Glyph> = {
  payslip: IconFile, statutory: IconShieldCheck,
  flexi: IconSliders, proofs: IconUpload2, declaration: IconCompliance,
  flexiclaims: IconReceipt, claims: IconTravel,
  vpf: IconPiggyBank, nps: IconUmbrella, loans: IconLoans,
}

/** How the tabs are grouped. Any item not named here lands in a trailing "More" group,
 *  so adding a tab to SECTIONS can never make it disappear from the hub. */
const GROUPS: { label: string; hint: string; keys: string[] }[] = [
  { label: 'Pay', hint: 'What you were paid', keys: ['payslip', 'statutory'] },
  { label: 'Tax & benefits', hint: 'Save tax on your salary', keys: ['flexi', 'declaration', 'proofs'] },
  { label: 'Claims', hint: 'Get money back', keys: ['flexiclaims', 'claims'] },
  { label: 'Savings & credit', hint: 'Grow savings or borrow', keys: ['vpf', 'nps', 'loans'] },
]

/** "FY 2026-27" for today's date (the Indian financial year starts 1 April). */
function currentFy(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

function regimeLabel(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const s = String(raw).toLowerCase()
  if (s.includes('new')) return 'New regime'
  if (s.includes('old')) return 'Old regime'
  return String(raw)
}

const MASK_KEY = 'ess-payroll-hide-amounts'

/** Where the employee's regime for the year came from — decides the sub-line. */
type RegimeInfo = { label: string; source: 'submitted' | 'record' | 'draft' | 'default' }

/**
 * The tax regime for `fy`, read-only, from the same rows FlexiTdsCalculator restores
 * from: a SUBMITTED flexi/TDS form → a SUBMITTED tds_declaration → employees.tds_regime
 * → a draft form → the statutory default (New). Nothing is written.
 */
async function loadRegime(employeeId: string, fy: string, fallback: unknown): Promise<RegimeInfo> {
  const [formRes, declRes, empRes] = await Promise.all([
    supabase.from('flexi_tds_forms').select('regime, status').eq('employee_id', employeeId).eq('fy', fy).maybeSingle().then(r => r, () => ({ data: null })),
    supabase.from('tds_declarations').select('regime, declaration_status').eq('employee_id', employeeId).eq('fy', fy).maybeSingle().then(r => r, () => ({ data: null })),
    supabase.from('employees').select('tds_regime').eq('id', employeeId).maybeSingle().then(r => r, () => ({ data: null })),
  ])
  const form: any = (formRes as any)?.data, decl: any = (declRes as any)?.data, emp: any = (empRes as any)?.data
  const lab = (v: unknown) => regimeLabel(v)
  if (form?.status === 'SUBMITTED' && lab(form.regime)) return { label: lab(form.regime)!, source: 'submitted' }
  if (decl?.declaration_status === 'SUBMITTED' && lab(decl.regime)) return { label: lab(decl.regime)!, source: 'submitted' }
  if (lab(emp?.tds_regime ?? fallback)) return { label: lab(emp?.tds_regime ?? fallback)!, source: 'record' }
  if (lab(form?.regime)) return { label: lab(form.regime)!, source: 'draft' }
  return { label: 'New regime', source: 'default' }
}

// ───────────────────────────────────────────────────────────────────────────
// SNAPSHOT
// ───────────────────────────────────────────────────────────────────────────

function SnapCell({ icon, label, value, sub, loading, index, cols }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; loading?: boolean
  /** Position in the grid, so hairlines fall between cells and never on the outer edge. */
  index: number; cols: number
}) {
  return (
    <div style={{
      minWidth: 0, padding: `${S.md}px ${S.lg}px`,
      borderLeft: index % cols === 0 ? 'none' : `1px solid ${C.line}`,
      borderTop: index >= cols ? `1px solid ${C.line}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted }}>
        <span style={{ display: 'inline-flex', color: C.brand }}>{icon}</span>
        <span style={{ ...eyebrow }}>{label}</span>
      </div>
      {loading ? (
        <div aria-hidden style={{
          marginTop: 8, height: 22, width: '70%', borderRadius: R.sm,
          background: `linear-gradient(90deg,${C.sunken} 25%,${C.brandTint} 50%,${C.sunken} 75%)`,
          backgroundSize: '200% 100%', animation: 'ezShimmer 1.2s infinite',
        }} />
      ) : (
        <div style={{ marginTop: 5, fontSize: F.title + 2, fontWeight: W.bold, color: C.ink, letterSpacing: '-.02em', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...numeric }}>{value}</div>
      )}
      {sub && <div style={{ marginTop: 3, fontSize: F.tiny, color: C.muted, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// GROUPED TABS
// ───────────────────────────────────────────────────────────────────────────

function HubTab({ item, on, go, stacked }: { item: HubItem; on: boolean; go: (k: string) => void; stacked?: boolean }) {
  const I = TAB_ICON[item.k] || IconPayroll
  return (
    <button role="tab" aria-selected={on} data-on={on ? '1' : '0'} onClick={() => go(item.k)}
      className="ez-tab ez-press"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', flexShrink: 0,
        width: stacked ? '100%' : undefined, textAlign: 'left',
        height: 34, padding: stacked ? '0 10px 0 12px' : '0 11px', borderRadius: R.md, fontFamily: 'inherit', fontSize: F.small,
        fontWeight: on ? W.semi : W.medium, cursor: 'pointer',
        color: on ? C.brandDeep : C.inkSoft,
        background: on ? C.surface : 'transparent',
        border: `1px solid ${on ? C.brandEdge : 'transparent'}`,
        boxShadow: on ? `${E.flat}, inset ${stacked ? '3px 0 0' : '0 -2px 0'} ${C.brand}` : 'none',
      }}>
      <span style={{ display: 'inline-flex', color: on ? C.brand : C.muted }}><I size={15} strokeWidth={on ? 1.9 : 1.6} /></span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
      {item.phase ? (
        <span style={{
          marginLeft: stacked ? 'auto' : undefined,
          fontSize: F.micro - 2, fontWeight: W.bold, letterSpacing: '.06em', textTransform: 'uppercase',
          padding: '1px 6px', borderRadius: R.pill, background: on ? C.brandTint : C.surface, color: C.muted, border: `1px solid ${C.line}`,
        }}>Soon</span>
      ) : null}
    </button>
  )
}

/** One purpose group. Desktop: a column (label, one-line hint, stacked tabs). Phone: a
 *  label over a single row, laid side by side with the other groups in a scroller. */
function HubGroup({ label, hint, items, view, go, first, isMobile }: {
  label: string; hint?: string; items: HubItem[]; view: string; go: (k: string) => void; first: boolean; isMobile?: boolean
}) {
  const active = items.some(i => i.k === view)
  return (
    <div role="group" aria-label={label} style={{
      display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : 4, flexShrink: 0, minWidth: 0,
      ...(isMobile ? { paddingLeft: first ? 0 : S.sm + 2, borderLeft: first ? 'none' : `1px solid ${C.line}` } : null),
    }}>
      <div style={{ paddingLeft: isMobile ? 4 : 12, marginBottom: isMobile ? 0 : 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {active && <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.brand }} />}
          <span style={{ ...eyebrow, color: active ? C.brandDeep : C.muted }}>{label}</span>
        </div>
        {!isMobile && hint && <div style={{ fontSize: F.tiny, color: C.faint, marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 2 }}>
        {items.map(i => <HubTab key={i.k} item={i} on={i.k === view} go={go} stacked={!isMobile} />)}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// THE HUB
// ───────────────────────────────────────────────────────────────────────────

/**
 * Payroll section header + grouped tab navigation.
 *
 * `showPay` false (someone else's portal) never loads salary at all and shows the
 * amounts as hidden. When true, the employee can still mask the two rupee figures
 * (remembered in this browser only) — payroll screens get opened in open offices.
 */
export function PayrollHub({ employeeId, regime, title = 'Payroll', desc, items, view, go, showPay, isMobile }: {
  employeeId: string
  /** employees.tds_regime if the portal already has it; null/undefined shows "—". */
  regime?: unknown
  title?: string
  desc?: string
  items: HubItem[]
  view: string
  go: (k: string) => void
  showPay: boolean
  isMobile?: boolean
}) {
  const [sal, setSal] = useState<SalaryStructure | null>(null)
  const [loading, setLoading] = useState(showPay)
  const [masked, setMasked] = useState(false)
  const [regimeInfo, setRegimeInfo] = useState<RegimeInfo | null>(null)
  const [regimeLoading, setRegimeLoading] = useState(true)
  // Phone: the groups sit in a sideways scroller, so bring the open tab into view
  // (otherwise opening Loans shows the Pay group and no sign of where you are).
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    if (!rail || !isMobile) return
    const on = rail.querySelector<HTMLElement>('[data-on="1"]')
    if (!on) return
    const r = rail.getBoundingClientRect(), b = on.getBoundingClientRect()
    rail.scrollLeft += (b.left - r.left) - (r.width - b.width) / 2
  }, [view, isMobile])

  useEffect(() => {
    try { setMasked(window.localStorage.getItem(MASK_KEY) === '1') } catch { /* storage blocked */ }
  }, [])
  useEffect(() => {
    if (!showPay || !employeeId) { setLoading(false); return }
    let live = true
    setLoading(true)
    loadSalary(employeeId)
      .then(s => { if (live) setSal(s) })
      .catch(() => { if (live) setSal(null) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [employeeId, showPay])

  useEffect(() => {
    if (!employeeId) { setRegimeLoading(false); return }
    let live = true
    setRegimeLoading(true)
    loadRegime(employeeId, currentFy().replace('FY ', ''), regime)
      .then(r => { if (live) setRegimeInfo(r) })
      .catch(() => { if (live) setRegimeInfo(null) })
      .finally(() => { if (live) setRegimeLoading(false) })
    return () => { live = false }
  }, [employeeId, regime])

  const toggleMask = () => {
    setMasked(m => {
      const next = !m
      try { window.localStorage.setItem(MASK_KEY, next ? '1' : '0') } catch { /* storage blocked */ }
      return next
    })
  }

  const ctc = sal?.offered_ctc ?? sal?.detail?.totalCtc ?? null
  const net = sal?.net_monthly ?? sal?.detail?.net ?? null
  const hide = !showPay || masked
  const amount = (n: number | null | undefined) => hide ? '₹ • • • • •' : (n == null || !n ? '—' : money(n))
  const regimeText = regimeInfo?.label || regimeLabel(regime)
  const regimeSub: React.ReactNode = !regimeInfo ? (regimeText ? 'Used for your TDS' : '—')
    : regimeInfo.source === 'submitted' ? <StatusPill t="positive" size="sm" dot>Submitted for {currentFy().replace('FY ', '')}</StatusPill>
    : regimeInfo.source === 'record' ? 'On your record, used for TDS'
    : regimeInfo.source === 'draft' ? <StatusPill t="warning" size="sm" dot>Draft, not submitted</StatusPill>
    : 'Default: New, until you declare'
  const fy = currentFy()
  const cols = isMobile ? 2 : 4

  // Group the items; keep anything unknown in a trailing group so nothing is lost.
  const known = new Set(GROUPS.flatMap(g => g.keys))
  const groups = GROUPS
    .map(g => ({ label: g.label, hint: g.hint as string | undefined, items: g.keys.map(k => items.find(i => i.k === k)).filter(Boolean) as HubItem[] }))
    .filter(g => g.items.length > 0)
  const rest = items.filter(i => !known.has(i.k))
  if (rest.length) groups.push({ label: 'More', hint: undefined, items: rest })

  return (
    <section className="ez-rise" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg + 2, boxShadow: E.raised,
      marginBottom: S.xl, overflow: 'hidden', minWidth: 0,
    }}>
      {/* A thin brand rule along the top edge — the one accent on the card. */}
      <div aria-hidden style={{ height: 3, background: C.brand }} />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 0 }}>
        {/* Title + purpose */}
        <div style={{ flex: '1 1 300px', minWidth: 0, padding: isMobile ? `${S.lg}px ${S.lg}px ${S.md}px` : `${S.xl - 4}px ${S.xl}px` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
            <IconTile icon={<IconPayroll size={22} strokeWidth={1.7} />} t="brand" size={isMobile ? 42 : 48} />
            <div style={{ minWidth: 0 }}>
              <div style={{ ...eyebrow, color: C.brandDeep, marginBottom: 2 }}>My money · {fy}</div>
              <h1 style={{ margin: 0, fontSize: isMobile ? F.page : F.page + 2, fontWeight: W.bold, color: C.ink, letterSpacing: '-.022em', lineHeight: 1.15 }}>{title}</h1>
            </div>
          </div>
          <p style={{ margin: `${S.md}px 0 0`, fontSize: F.small, color: C.muted, lineHeight: 1.55, maxWidth: 440 }}>
            {desc || 'Salary, benefits, tax declarations and claims'}. Your pay at a glance, and everything you can save, claim or request, in one place.
          </p>
        </div>

        {/* Pay snapshot */}
        <div style={{ flex: '2 1 460px', minWidth: 0, padding: isMobile ? `0 ${S.md}px ${S.md}px` : `${S.lg}px ${S.lg}px ${S.lg}px 0`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.lg, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, padding: `${S.sm}px ${S.lg}px`, borderBottom: `1px solid ${C.line}` }}>
              <span style={{ ...eyebrow, color: C.inkSoft }}>Your pay snapshot</span>
              {!showPay && <StatusPill size="sm" icon={<IconLock size={11} />}>Hidden in this view</StatusPill>}
              {showPay && (
                <button onClick={toggleMask} className="ez-press" aria-pressed={masked} title={masked ? 'Show amounts' : 'Hide amounts'}
                  style={{
                    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px',
                    borderRadius: R.pill, border: `1px solid ${C.line}`, background: C.surface, color: C.inkSoft,
                    fontSize: F.micro, fontWeight: W.semi, fontFamily: 'inherit', cursor: 'pointer',
                  }}>
                  {masked ? <IconEye size={13} /> : <IconEyeOff size={13} />}{masked ? 'Show amounts' : 'Hide amounts'}
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, background: C.surface }}>
              <SnapCell index={0} cols={cols} icon={<IconPayroll size={14} />} label="Annual CTC" loading={loading} value={amount(ctc)} sub="Cost to company, a year" />
              <SnapCell index={1} cols={cols} icon={<IconWallet size={14} />} label="Take-home" loading={loading} value={amount(net)} sub="Net pay, a month" />
              <SnapCell index={2} cols={cols} icon={<IconCompliance size={14} />} label="Tax regime" loading={regimeLoading} value={regimeText || '—'}
                sub={<span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  {regimeSub}
                  {regimeInfo && regimeInfo.source !== 'submitted' && items.some(i => i.k === 'flexi') && view !== 'flexi' && (
                    <button onClick={() => go('flexi')} className="ez-press" style={{ padding: 0, border: 'none', background: 'none', color: C.brandDeep, fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Compare in Flexi Benefits <IconArrowRight size={12} /></button>
                  )}
                </span>} />
              <SnapCell index={3} cols={cols} icon={<IconCalendar size={14} />} label="Financial year" value={fy.replace('FY ', '')} sub="1 Apr – 31 Mar" />
            </div>
          </div>
        </div>
      </div>

      {/* Grouped tabs */}
      <nav aria-label="Payroll sections" style={{ borderTop: `1px solid ${C.line}`, background: C.sunken }}>
        <div ref={railRef} className="ez-scroll" role="tablist" aria-orientation="horizontal" style={isMobile ? {
          ...scrollX, display: 'flex', alignItems: 'flex-start', columnGap: S.sm + 2, padding: `${S.md}px ${S.md}px`,
        } : {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: `${S.md}px ${S.lg}px`,
          padding: `${S.md + 2}px ${S.lg}px ${S.md + 2}px`,
        }}>
          {groups.map((g, i) => <HubGroup key={g.label} label={g.label} hint={g.hint} items={g.items} view={view} go={go} first={i === 0} isMobile={isMobile} />)}
        </div>
      </nav>
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// COMING SOON (Salary Slip, Statutory)
// ───────────────────────────────────────────────────────────────────────────

/** What each not-yet-live tab will hold, in the employee's words. */
const SOON_COPY: Record<string, { lead: string; points: { icon: Glyph; name: string; note: string }[]; meanwhile?: { k: string; label: string } }> = {
  payslip: {
    lead: 'Your monthly payslip: what you earned, what was deducted and what reached your bank.',
    points: [
      { icon: IconFile, name: 'Monthly payslips', note: 'Earnings, deductions and net pay for every month' },
      { icon: IconWallet, name: 'Download as PDF', note: 'For a loan, a visa or your own records' },
      { icon: IconSparkle, name: 'Year so far', note: 'What you have earned and paid in tax this year' },
    ],
    meanwhile: { k: 'flexi', label: 'Plan your Flexi Benefits' },
  },
  statutory: {
    lead: 'Your statutory deductions and the certificates that come with them.',
    points: [
      { icon: IconPiggyBank, name: 'PF & ESIC', note: 'Your share and the company’s, month by month' },
      { icon: IconCompliance, name: 'Professional tax & LWF', note: 'What was deducted, and for which state' },
      { icon: IconShieldCheck, name: 'Tax certificates', note: 'Form 16 and TDS summaries once they are issued' },
    ],
    meanwhile: { k: 'vpf', label: 'Check your Voluntary PF' },
  },
}

/** The Salary Slip / Statutory "coming soon" screen inside the Payroll hub. */
export function PayrollComingSoon({ viewKey, title, phase, needs, go }: {
  viewKey: string; title: string; phase: number; needs: string; go?: (k: string) => void
}) {
  const copy = SOON_COPY[viewKey] || {
    lead: 'We’re getting this ready for you.',
    points: [] as { icon: Glyph; name: string; note: string }[],
  }
  const I = TAB_ICON[viewKey] || IconPayroll
  return (
    <section className="ez-rise" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.raised, overflow: 'hidden' }}>
      <div style={{ padding: `${S.xl + 8}px ${S.xl}px ${S.xl}px`, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <IconTile icon={<I size={28} strokeWidth={1.6} />} t="brand" size={64} />
          <span aria-hidden style={{
            position: 'absolute', right: -8, top: -8, width: 26, height: 26, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: C.surface, color: C.brand, border: `1px solid ${C.brandEdge}`, boxShadow: E.flat,
          }}><IconSparkle size={14} /></span>
        </div>
        <div style={{ marginTop: S.lg }}><StatusPill t="brand" dot>Coming soon</StatusPill></div>
        <h2 style={{ margin: `${S.md}px 0 0`, fontSize: F.page, fontWeight: W.bold, color: C.ink, letterSpacing: '-.02em' }}>{title} is coming soon</h2>
        <p style={{ margin: `${S.sm}px 0 0`, fontSize: F.body, color: C.inkSoft, lineHeight: 1.6, maxWidth: 480 }}>{copy.lead}</p>
        <p style={{ margin: `${S.xs}px 0 0`, fontSize: F.small, color: C.muted, lineHeight: 1.6, maxWidth: 480 }}>
          We’re getting this ready for you. It will appear here as soon as your HR team switches it on.
        </p>
      </div>

      {copy.points.length > 0 && (
        <div style={{ padding: `0 ${S.xl}px ${S.xl}px` }}>
          <div style={{ ...eyebrow, textAlign: 'center', marginBottom: S.md }}>What you’ll see here</div>
          <div className="ez-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: S.md, maxWidth: 820, margin: '0 auto' }}>
            {copy.points.map(p => {
              const P = p.icon
              return (
                <div key={p.name} style={{ background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: S.lg, display: 'flex', gap: S.md, alignItems: 'flex-start' }}>
                  <IconTile icon={<P size={17} />} t="brand" size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{p.name}</div>
                    <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{p.note}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', justifyContent: 'space-between',
        padding: `${S.md}px ${S.xl}px`, background: C.sunken, borderTop: `1px solid ${C.line}`,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: F.tiny, color: C.muted, lineHeight: 1.5 }}>
          <span style={{ display: 'inline-flex', color: C.brand }}><IconInfo size={14} /></span>
          Arrives with {needs && needs !== '-' ? <strong style={{ color: C.inkSoft, fontWeight: W.semi }}>{needs}</strong> : 'a later release'}
          {phase ? <span style={{ color: C.faint }}>· phase {phase}</span> : null}
        </span>
        {go && copy.meanwhile && (
          <PButton size="sm" variant="ghost" onClick={() => go(copy.meanwhile!.k)} iconRight={<IconArrowRight size={14} />}>
            Meanwhile: {copy.meanwhile.label}
          </PButton>
        )}
      </div>
    </section>
  )
}
