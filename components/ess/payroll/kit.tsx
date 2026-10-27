'use client'
// components/ess/payroll/kit.tsx — the ESS (employee) payroll design kit.
//
// Small, composable building blocks every screen under ESS → Payroll reuses
// (Salary Slip, Flexi Benefits, Investment Proofs, Flexi Claims, Voluntary PF,
// Corporate NPS, Loans, Travel Claims, Statutory), so the nine tabs read as one
// product instead of nine hand-styled pages.
//
// House rules this file keeps:
//   * every colour comes from the tokens in @/lib/ui (C, tone(), E, R, S, F, W, M) —
//     no hex, no rgb(). Light and dark both repaint through lib/ui/theme.css.
//   * every component is declared at module top level, never inside another one
//     (nesting remounts on every render and drops focus mid-typing).
//   * :hover / :active / :focus come from the ez-* classes in UIKeyframes
//     (ez-press, ez-row, ez-tab, ez-lift, ez-scroll) — inline styles cannot express them.
//   * purely presentational: nothing here loads data or owns business state.
//
// Import as:  import { SectionCard, KpiTile, InfoCallout, PButton } from '@/components/ess/payroll/kit'

import * as React from 'react'
import {
  C, F, W, S, R, E, M, Z, tone, numeric, eyebrow, scrollX, type Tone,
  IconCheck, IconAlert, IconChevronDown, IconLock, IconClose,
} from '@/lib/ui'

export type KitTone = Tone

// ───────────────────────────────────────────────────────────────────────────
// ICONS — the few payroll glyphs lib/ui/icons does not have. Same construction
// as that set (20×20 grid, 1.6 stroke, round caps, currentColor) so they sit in
// one family with IconPayroll, IconLock and friends.
// ───────────────────────────────────────────────────────────────────────────

/** Props for every kit icon. Matches lib/ui IconProps. */
export interface KitIconProps { size?: number; color?: string; strokeWidth?: number; style?: React.CSSProperties }

function KSvg({ size = 16, color = 'currentColor', strokeWidth = 1.6, style, children }: KitIconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block', ...style }}>
      {children}
    </svg>
  )
}

/** Circled "i" — context, neutral information. */
export const IconInfo = (p: KitIconProps) => <KSvg {...p}><circle cx="10" cy="10" r="7.2" /><path d="M10 9v4.6M10 6.4v.1" /></KSvg>
/** Circled tick — done, clear, nothing outstanding. */
export const IconCheckCircle = (p: KitIconProps) => <KSvg {...p}><circle cx="10" cy="10" r="7.2" /><path d="m6.9 10.2 2.2 2.2 4-4.4" /></KSvg>
/** Circled cross — blocked, cannot proceed. */
export const IconXCircle = (p: KitIconProps) => <KSvg {...p}><circle cx="10" cy="10" r="7.2" /><path d="m7.4 7.4 5.2 5.2M12.6 7.4l-5.2 5.2" /></KSvg>
/** Bank building — bank account / disbursal. */
export const IconBank = (p: KitIconProps) => <KSvg {...p}><path d="M2.5 8 10 3.5 17.5 8" /><path d="M4.5 8v6.5M8.2 8v6.5M11.8 8v6.5M15.5 8v6.5" /><path d="M2.5 17h15" /></KSvg>
/** Two arrows in a loop — sync / refresh. */
export const IconSync = (p: KitIconProps) => <KSvg {...p}><path d="M15.8 8.2A6 6 0 0 0 4.6 6.6M4.2 11.8a6 6 0 0 0 11.2 1.6" /><path d="M4.4 3.6v3.2h3.2M15.6 16.4v-3.2h-3.2" /></KSvg>
/** Pause bars — on hold. */
export const IconPause = (p: KitIconProps) => <KSvg {...p}><circle cx="10" cy="10" r="7.2" /><path d="M8.3 7.2v5.6M11.7 7.2v5.6" /></KSvg>
/** ID card — PAN / identity documents. */
export const IconIdCard = (p: KitIconProps) => <KSvg {...p}><rect x="2.5" y="4.5" width="15" height="11" rx="1.8" /><circle cx="7" cy="9.3" r="1.7" /><path d="M4.6 13c.5-1.2 1.4-1.8 2.4-1.8s1.9.6 2.4 1.8M11.5 8.5h3.5M11.5 11.3h2.5" /></KSvg>
/** Document with lines — sheets, registers, payslips. */
export const IconFile = (p: KitIconProps) => <KSvg {...p}><path d="M5 2.5h6.5L15 6v11.5H5Z" /><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5" /></KSvg>
/** Triangle "play" — run / execute. */
export const IconPlay = (p: KitIconProps) => <KSvg {...p}><path d="M6.5 4.2v11.6L15.5 10Z" /></KSvg>
/** Funnel — filter. */
export const IconFilter = (p: KitIconProps) => <KSvg {...p}><path d="M3 4.5h14l-5.4 6.2v4.6l-3.2 1.6v-6.2Z" /></KSvg>
/** Four squares — overview / dashboard. */
export const IconGrid = (p: KitIconProps) => <KSvg {...p}><rect x="3" y="3" width="5.8" height="5.8" rx="1.3" /><rect x="11.2" y="3" width="5.8" height="5.8" rx="1.3" /><rect x="3" y="11.2" width="5.8" height="5.8" rx="1.3" /><rect x="11.2" y="11.2" width="5.8" height="5.8" rx="1.3" /></KSvg>
/** Stopwatch — attendance not processed / pending. */
export const IconTimer = (p: KitIconProps) => <KSvg {...p}><circle cx="10" cy="11" r="6.3" /><path d="M10 7.8V11l2 1.3M8 2.5h4" /></KSvg>
/** Stacked layers — month master / snapshot. */
export const IconLayers = (p: KitIconProps) => <KSvg {...p}><path d="M10 3 17 6.8 10 10.6 3 6.8Z" /><path d="m3 10.2 7 3.8 7-3.8M3 13.6l7 3.8 7-3.8" /></KSvg>
/** Arrow right — next action / go. */
export const IconArrowRight = (p: KitIconProps) => <KSvg {...p}><path d="M4 10h11.5M11.5 6l4 4-4 4" /></KSvg>
/** Calendar with a dot — a payroll month. */
export const IconMonth = (p: KitIconProps) => <KSvg {...p}><rect x="3" y="4.5" width="14" height="12.5" rx="1.8" /><path d="M3 8.5h14M7 2.5v3M13 2.5v3" /><circle cx="10" cy="12.6" r="1.3" /></KSvg>

/** The glyph each tone uses by default in callouts and empty states. */
export function toneIcon(t: Tone, size = 16): React.ReactNode {
  switch (t) {
    case 'positive': return <IconCheckCircle size={size} />
    case 'warning': return <IconAlert size={size} />
    case 'critical': return <IconXCircle size={size} />
    default: return <IconInfo size={size} />
  }
}

// ───────────────────────────────────────────────────────────────────────────
// LAYOUT
// ───────────────────────────────────────────────────────────────────────────

/** Square tinted tile holding an icon. Used by headers, section cards and KPI tiles. */
export function IconTile({ icon, t = 'brand', size = 32, solid }: { icon: React.ReactNode; t?: Tone; size?: number; solid?: boolean }) {
  const k = tone(t)
  return (
    <span style={{
      width: size, height: size, borderRadius: size >= 36 ? R.md : R.sm, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: solid ? k.fg : k.bg, color: solid ? C.onAccent : k.fg,
      border: solid ? 'none' : `1px solid ${k.edge}`,
    }}>{icon}</span>
  )
}

/**
 * Module / screen header: icon, eyebrow, title, one-line purpose, and a right-side
 * slot for the month picker or actions. Uses the product-wide `.ez-page-head` plane.
 */
export function PayrollPageHeader({ title, subtitle, eyebrow: eb, icon, meta, actions, children }: {
  title: React.ReactNode
  /** One line: what this screen is for. */
  subtitle?: React.ReactNode
  /** Small uppercase line above the title, e.g. "Money · Payroll". */
  eyebrow?: React.ReactNode
  icon?: React.ReactNode
  /** Facts under the subtitle (chips, counts). */
  meta?: React.ReactNode
  /** Right side: ControlSelect pickers, buttons. Wraps under the title on narrow widths. */
  actions?: React.ReactNode
  /** Optional full-width row under the header (e.g. a ProcessStepper). */
  children?: React.ReactNode
}) {
  return (
    <div className="ez-page-head">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: S.lg, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, minWidth: 0, flex: '1 1 320px' }}>
          {icon && <IconTile icon={icon} size={42} t="brand" solid />}
          <div style={{ minWidth: 0 }}>
            {eb && <div style={{ ...eyebrow, marginBottom: 3 }}>{eb}</div>}
            <h1 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, color: C.ink, letterSpacing: '-.02em', lineHeight: 1.15 }}>{title}</h1>
            {subtitle && <div style={{ marginTop: 4, fontSize: F.small, color: C.muted, lineHeight: 1.45 }}>{subtitle}</div>}
            {meta && <div style={{ marginTop: S.sm, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{meta}</div>}
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: S.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children && <div style={{ marginTop: S.lg }}>{children}</div>}
    </div>
  )
}

/**
 * The standard payroll card: optional icon tile, title, hint and actions in a header
 * separated from the body by a quiet hairline. `flush` drops body padding for tables.
 */
export function SectionCard({ title, icon, iconTone = 'brand', hint, actions, children, flush, pad = S.lg, style, bodyStyle, className, id }: {
  title?: React.ReactNode
  icon?: React.ReactNode
  iconTone?: Tone
  hint?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  /** Body has no padding — for a DataTable that should run edge to edge. */
  flush?: boolean
  pad?: number
  style?: React.CSSProperties
  bodyStyle?: React.CSSProperties
  className?: string
  id?: string
}) {
  const hasHead = title != null || actions != null
  return (
    <section id={id} className={className} style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
      boxShadow: E.raised, marginBottom: S.lg, minWidth: 0, overflow: 'hidden', ...style,
    }}>
      {hasHead && (
        <header style={{
          display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap',
          padding: `${S.md}px ${pad}px`, borderBottom: children != null ? `1px solid ${C.line}` : 'none',
        }}>
          {icon && <IconTile icon={icon} t={iconTone} size={30} />}
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            {title != null && <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink, letterSpacing: '-.01em', lineHeight: 1.3 }}>{title}</div>}
            {hint && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
        </header>
      )}
      {children != null && <div style={{ padding: flush ? 0 : pad, minWidth: 0, ...bodyStyle }}>{children}</div>}
    </section>
  )
}

/** Small uppercase heading inside a card, for grouping a few controls or rows. */
export function SubHead({ children, right, style }: { children: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: S.sm, ...style }}>
      <span style={{ ...eyebrow }}>{children}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// NUMBERS
// ───────────────────────────────────────────────────────────────────────────

/**
 * One headline figure. Label above, big tabular value, a sub-line, and optionally
 * a progress bar (0–1) or a trend chip. `tone` colours the value and the icon.
 */
export function KpiTile({ label, value, sub, t = 'neutral', icon, progress, progressTone, trend, emphasis, onClick, title }: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  t?: Tone
  icon?: React.ReactNode
  /** 0–1. Renders a thin bar under the value. */
  progress?: number
  progressTone?: Tone
  /** A short delta, e.g. { dir: 'up', text: '+4 vs last month' }. */
  trend?: { dir: 'up' | 'down' | 'flat'; text: React.ReactNode; t?: Tone }
  /** Hero tile: brand accent rule on top and a brand-deep value. */
  emphasis?: boolean
  onClick?: () => void
  title?: string
}) {
  const k = tone(t)
  const pk = tone(progressTone || (t === 'neutral' ? 'brand' : t))
  const valueColor = emphasis ? C.brandDeep : t === 'neutral' ? C.ink : k.fg
  return (
    <div title={title} onClick={onClick} className={onClick ? 'ez-lift' : undefined} style={{
      position: 'relative', background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
      padding: `${S.md + 2}px ${S.lg}px`, boxShadow: E.flat, minWidth: 0, overflow: 'hidden',
      cursor: onClick ? 'pointer' : undefined,
      // A size container, so the value below can scale to the tile's own width
      // instead of being cut off with an ellipsis. A figure is never truncated.
      containerType: 'inline-size',
    }}>
      {emphasis && <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: C.brand }} />}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.sm }}>
        <div style={{ ...eyebrow, flex: 1, minWidth: 0, lineHeight: 1.35 }}>{label}</div>
        {icon && <IconTile icon={icon} t={t === 'neutral' ? 'brand' : t} size={28} />}
      </div>
      <div style={{
        marginTop: 6, fontSize: `clamp(16px, 12.5cqi, ${F.display}px)`, fontWeight: W.bold, lineHeight: 1.12, color: valueColor,
        letterSpacing: '-.02em', whiteSpace: 'nowrap', ...numeric,
      }}>{value}</div>
      {progress != null && (
        <div style={{ marginTop: S.sm, height: 5, borderRadius: R.pill, background: C.sunken, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, height: '100%', background: pk.fg, borderRadius: R.pill, transition: `width ${M.slow}` }} />
        </div>
      )}
      {(sub != null || trend) && (
        <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: F.tiny, color: C.muted, ...numeric }}>
          {trend && <TrendChip {...trend} />}
          {sub != null && <span style={{ minWidth: 0 }}>{sub}</span>}
        </div>
      )}
    </div>
  )
}

function TrendChip({ dir, text, t }: { dir: 'up' | 'down' | 'flat'; text: React.ReactNode; t?: Tone }) {
  const k = tone(t || (dir === 'up' ? 'positive' : dir === 'down' ? 'critical' : 'neutral'))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, background: k.bg, color: k.fg, fontWeight: W.semi }}>
      <span aria-hidden>{dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'}</span>{text}
    </span>
  )
}

/** Responsive grid of KpiTiles. Reflows by `min` column width; never scrolls sideways. */
export function KpiGrid({ children, min = 168, style }: { children: React.ReactNode; min?: number; style?: React.CSSProperties }) {
  return (
    <div className="ez-stagger" style={{
      display: 'grid', gap: S.md, marginBottom: S.lg,
      gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, ...style,
    }}>{children}</div>
  )
}

/** Labelled facts laid out as a responsive grid. For run summaries, employee facts, config values. */
export function KeyValueGrid({ items, min = 160, dense }: {
  items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; t?: Tone; mono?: boolean }[]
  min?: number
  dense?: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: dense ? S.sm : S.md }}>
      {items.map((it, i) => (
        <div key={i} style={{ minWidth: 0, padding: dense ? `${S.sm}px ${S.md}px` : `${S.md}px ${S.md + 2}px`, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md }}>
          <div style={{ ...eyebrow, marginBottom: 4 }}>{it.label}</div>
          <div style={{ fontSize: dense ? F.small : F.lead, fontWeight: W.semi, color: it.t ? tone(it.t).fg : C.ink, ...(it.mono ? numeric : null), overflowWrap: 'anywhere' }}>{it.value}</div>
          {it.hint && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>{it.hint}</div>}
        </div>
      ))}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// PROCESS
// ───────────────────────────────────────────────────────────────────────────

export type StepState = 'done' | 'current' | 'todo' | 'blocked'
export interface Step { key: string; label: React.ReactNode; hint?: React.ReactNode; state: StepState }

/**
 * Horizontal process rail for a multi-step flow (Create → Freeze → Calculate → … → Lock).
 * Done steps show a tick, the current one a brand ring, blocked a red cross. Scrolls
 * inside itself on narrow widths.
 */
export function ProcessStepper({ steps, compact }: { steps: Step[]; compact?: boolean }) {
  return (
    <div className="ez-scroll" style={{ ...scrollX, paddingBottom: 2 }}>
      <ol style={{ display: 'flex', alignItems: 'flex-start', listStyle: 'none', margin: 0, padding: 0, minWidth: steps.length * (compact ? 88 : 112) }}>
        {steps.map((s, i) => <StepNode key={s.key} step={s} index={i} last={i === steps.length - 1} next={steps[i + 1]} compact={compact} />)}
      </ol>
    </div>
  )
}

function StepNode({ step, index, last, next, compact }: { step: Step; index: number; last: boolean; next?: Step; compact?: boolean }) {
  const d = compact ? 22 : 26
  const st = step.state
  const ring = st === 'done' ? C.positive : st === 'current' ? C.brand : st === 'blocked' ? C.critical : C.lineStrong
  const fill = st === 'done' ? C.positive : st === 'blocked' ? C.critical : st === 'current' ? C.brandTint : C.surface
  const fg = st === 'done' || st === 'blocked' ? C.onAccent : st === 'current' ? C.brandDeep : C.muted
  const lineDone = st === 'done' && next && next.state !== 'todo'
  return (
    <li style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      {!last && (
        <span aria-hidden style={{
          position: 'absolute', top: d / 2 - 1, left: `calc(50% + ${d / 2 + 4}px)`, right: `calc(-50% + ${d / 2 + 4}px)`,
          height: 2, borderRadius: 2, background: lineDone ? C.positive : C.line,
        }} />
      )}
      <span style={{
        width: d, height: d, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: fill, color: fg, border: `2px solid ${ring}`, fontSize: F.micro, fontWeight: W.bold, ...numeric,
        boxShadow: st === 'current' ? `0 0 0 4px ${C.brandTint}` : undefined, boxSizing: 'border-box',
      }}>
        {st === 'done' ? <IconCheck size={compact ? 12 : 14} strokeWidth={2.4} /> : st === 'blocked' ? <IconClose size={12} strokeWidth={2.4} /> : index + 1}
      </span>
      <span style={{
        marginTop: 6, fontSize: compact ? F.micro : F.tiny, fontWeight: st === 'current' ? W.bold : W.semi,
        color: st === 'todo' ? C.muted : st === 'blocked' ? C.critical : C.ink, lineHeight: 1.25, padding: '0 4px',
      }}>{step.label}</span>
      {step.hint && !compact && <span style={{ fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.3, padding: '0 4px', ...numeric }}>{step.hint}</span>}
    </li>
  )
}

/** The order a payroll_runs.status walks through. Shared so every screen agrees. */
export const RUN_FLOW = ['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'] as const

/** Human label for a run status ("ATTENDANCE_LOCKED" → "Attendance frozen"). */
export function humanStatus(status: string | null | undefined): string {
  const map: Record<string, string> = {
    OPEN: 'Open', SYNCED: 'Synced', ATTENDANCE_LOCKED: 'Attendance frozen', CALCULATED: 'Calculated',
    AI_CHECKED: 'Checked', APPROVED: 'Approved', DISBURSED: 'Disbursed', LOCKED: 'Locked', CANCELLED: 'Cancelled',
  }
  return status ? (map[status] || status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())) : '-'
}

/** Tone for a run status, so a status chip means the same colour on every screen. */
export function runStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'OPEN': return 'neutral'
    case 'SYNCED': case 'ATTENDANCE_LOCKED': case 'AI_CHECKED': return 'info'
    case 'CALCULATED': return 'brand'
    case 'APPROVED': case 'DISBURSED': return 'positive'
    case 'LOCKED': return 'positive'
    case 'CANCELLED': return 'critical'
    default: return 'neutral'
  }
}

/**
 * Steps for ProcessStepper from a run status: Created → Attendance frozen → Calculated →
 * Approved → Disbursed → Locked. Pass the LEAST advanced status when a month spans runs.
 */
export function runSteps(status: string | null | undefined): Step[] {
  const stages: { key: string; label: string; reached: string[] }[] = [
    { key: 'created', label: 'Month created', reached: [...RUN_FLOW] },
    { key: 'frozen', label: 'Attendance frozen', reached: ['ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'] },
    { key: 'calc', label: 'Calculated', reached: ['CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'] },
    { key: 'approved', label: 'Approved', reached: ['APPROVED', 'DISBURSED', 'LOCKED'] },
    { key: 'paid', label: 'Disbursed', reached: ['DISBURSED', 'LOCKED'] },
    { key: 'locked', label: 'Locked', reached: ['LOCKED'] },
  ]
  if (!status) return stages.map(s => ({ key: s.key, label: s.label, state: 'todo' as StepState }))
  if (status === 'CANCELLED') return stages.map((s, i) => ({ key: s.key, label: s.label, state: (i === 0 ? 'blocked' : 'todo') as StepState }))
  let currentSet = false
  return stages.map(s => {
    if (s.reached.includes(status)) return { key: s.key, label: s.label, state: 'done' as StepState }
    if (!currentSet) { currentSet = true; return { key: s.key, label: s.label, state: 'current' as StepState } }
    return { key: s.key, label: s.label, state: 'todo' as StepState }
  })
}

/** Of several run statuses, the one furthest BEHIND in RUN_FLOW (for a group-mode month). */
export function leastAdvanced(statuses: (string | null | undefined)[]): string | null {
  const list = statuses.filter(Boolean) as string[]
  if (!list.length) return null
  return list.reduce((a, b) => {
    const ia = (RUN_FLOW as readonly string[]).indexOf(a), ib = (RUN_FLOW as readonly string[]).indexOf(b)
    return (ib === -1 ? 99 : ib) < (ia === -1 ? 99 : ia) ? b : a
  })
}

// ───────────────────────────────────────────────────────────────────────────
// STATUS
// ───────────────────────────────────────────────────────────────────────────

/** A state chip. Always carries words, never colour alone. `solid` for the loudest state on a screen. */
export function StatusPill({ children, t = 'neutral', dot, icon, size = 'md', solid, title }: {
  children: React.ReactNode; t?: Tone; dot?: boolean; icon?: React.ReactNode; size?: 'sm' | 'md'; solid?: boolean; title?: string
}) {
  const k = tone(t)
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', lineHeight: 1.5,
      padding: size === 'sm' ? '1px 8px' : '3px 10px', borderRadius: R.pill,
      fontSize: size === 'sm' ? F.micro : F.tiny, fontWeight: W.semi,
      background: solid ? k.fg : k.bg, color: solid ? C.onAccent : k.fg, border: `1px solid ${solid ? k.fg : k.edge}`,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: solid ? C.onAccent : k.fg, flexShrink: 0 }} />}
      {icon}
      {children}
    </span>
  )
}

/** StatusPill for a payroll_runs.status. Shows the human label; the raw code is in the tooltip. */
export function RunStatusPill({ status, size, raw }: { status: string | null | undefined; size?: 'sm' | 'md'; raw?: boolean }) {
  return <StatusPill t={runStatusTone(status)} dot size={size} title={status || undefined}>{raw ? status || '-' : humanStatus(status)}</StatusPill>
}

/** Neutral count chip, e.g. "3 companies". */
export function CountChip({ children, t = 'neutral' }: { children: React.ReactNode; t?: Tone }) {
  const k = tone(t)
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: R.pill, fontSize: F.micro, fontWeight: W.bold, background: k.bg, color: k.fg, ...numeric }}>{children}</span>
}

/**
 * Message strip with a real icon disc: positive / warning / critical / info / neutral / brand.
 * Title in the tone colour, body in ink-soft, optional action on the right.
 */
export function InfoCallout({ t = 'info', title, children, icon, action, compact, style }: {
  t?: Tone; title?: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode
  action?: React.ReactNode; compact?: boolean; style?: React.CSSProperties
}) {
  const k = tone(t)
  return (
    <div role={t === 'critical' ? 'alert' : 'status'} className="ez-rise" style={{
      display: 'flex', alignItems: compact ? 'center' : 'flex-start', gap: compact ? S.sm + 2 : S.md, flexWrap: 'wrap',
      background: k.bg, border: `1px solid ${k.edge}`, borderRadius: R.lg,
      padding: compact ? `${S.sm + 2}px ${S.md + 2}px` : `${S.md + 2}px ${S.lg}px`, marginBottom: S.lg, ...style,
    }}>
      <span aria-hidden style={{
        width: compact ? 24 : 34, height: compact ? 24 : 34, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: k.fg, color: C.onAccent,
      }}>{icon || toneIcon(t, compact ? 14 : 18)}</span>
      <div style={{ flex: '1 1 240px', minWidth: 0, paddingTop: compact ? 0 : 1 }}>
        {title && <div style={{ fontSize: compact ? F.small : F.body, fontWeight: W.bold, color: k.fg, lineHeight: 1.35 }}>{title}</div>}
        {children && <div style={{ fontSize: compact ? F.tiny : F.small, color: C.inkSoft, lineHeight: 1.55, marginTop: title ? 2 : 0, ...numeric }}>{children}</div>}
      </div>
      {action && <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>{action}</div>}
    </div>
  )
}

/** Centered empty / all-clear state. `t="positive"` for "nothing outstanding". */
export function EmptyState({ icon, title, hint, action, t = 'brand', compact }: {
  icon?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; t?: Tone; compact?: boolean
}) {
  return (
    <div className="ez-rise" style={{
      padding: compact ? `${S.xl}px ${S.lg}px` : `${S.huge - 8}px ${S.xl}px`, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm,
    }}>
      <IconTile icon={icon || toneIcon(t, 20)} t={t} size={44} />
      <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink, marginTop: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: F.small, color: C.muted, maxWidth: 420, lineHeight: 1.55 }}>{hint}</div>}
      {action && <div style={{ marginTop: S.sm }}>{action}</div>}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// CONTROLS
// ───────────────────────────────────────────────────────────────────────────

export type PButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'positive'
export type PButtonSize = 'sm' | 'md' | 'lg'

/**
 * Button style object, for places that must stay a raw <button>/<a> (a download link,
 * a child component's own button). Disabled is a real, legible state: sunken well,
 * muted text, no shadow — never white-on-white.
 */
export function btnStyle(variant: PButtonVariant = 'secondary', size: PButtonSize = 'md', disabled = false): React.CSSProperties {
  const dims = { sm: { h: 30, px: 11, fs: F.tiny }, md: { h: 36, px: 14, fs: F.small }, lg: { h: 44, px: 20, fs: F.body } }[size]
  const base: React.CSSProperties = {
    height: dims.h, padding: `0 ${dims.px}px`, fontSize: dims.fs, fontWeight: W.semi, fontFamily: 'inherit',
    borderRadius: R.md, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    whiteSpace: 'nowrap', textDecoration: 'none', boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'pointer',
    // The global `button:disabled{opacity:.55}` rule is overridden on purpose: the
    // disabled skin below is already quiet, and halving it again made it vanish.
    opacity: 1,
  }
  if (disabled) {
    return {
      ...base, background: C.sunken, color: C.muted, boxShadow: 'none',
      border: `1px ${variant === 'primary' || variant === 'positive' ? 'dashed' : 'solid'} ${C.lineStrong}`,
    }
  }
  const skin: Record<PButtonVariant, React.CSSProperties> = {
    primary: { background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent, border: `1px solid ${C.brandDeep}`, boxShadow: E.brand },
    positive: { background: C.positive, color: C.onAccent, border: `1px solid ${C.positive}`, boxShadow: E.flat },
    secondary: { background: C.surface, color: C.ink, border: `1px solid ${C.lineStrong}`, boxShadow: E.flat },
    ghost: { background: 'transparent', color: C.brandDeep, border: '1px solid transparent' },
    danger: { background: C.surface, color: C.critical, border: `1px solid ${C.criticalEdge}`, boxShadow: E.flat },
  }
  return { ...base, ...skin[variant] }
}

/** The payroll button: primary / secondary / ghost / danger / positive, sm / md / lg, with an icon slot and a clear disabled state. */
export function PButton({ children, onClick, variant = 'secondary', size = 'md', icon, iconRight, disabled, title, type = 'button', full, style }: {
  children?: React.ReactNode; onClick?: (e: React.MouseEvent) => void; variant?: PButtonVariant; size?: PButtonSize
  icon?: React.ReactNode; iconRight?: React.ReactNode; disabled?: boolean; title?: string; type?: 'button' | 'submit'
  full?: boolean; style?: React.CSSProperties
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className="ez-press ez-cta"
      style={{ ...btnStyle(variant, size, !!disabled), width: full ? '100%' : undefined, ...style }}>
      {icon}
      {children}
      {iconRight && <span className="ez-cta-arrow" style={{ display: 'inline-flex' }}>{iconRight}</span>}
    </button>
  )
}

/**
 * The action row at the foot of a flow: a hint line (what pressing the primary will do)
 * above a wrapping row of buttons. `sticky` pins it to the bottom of the scroll area.
 */
export function ActionBar({ children, hint, hintTone = 'neutral', sticky, style }: {
  children: React.ReactNode; hint?: React.ReactNode; hintTone?: Tone; sticky?: boolean; style?: React.CSSProperties
}) {
  const k = tone(hintTone)
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: sticky ? E.floating : E.raised,
      padding: `${S.md}px ${S.lg}px`, marginBottom: S.lg,
      ...(sticky ? { position: 'sticky', bottom: S.md, zIndex: Z.sticky } : null), ...style,
    }}>
      {hint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: hintTone === 'neutral' ? C.muted : k.fg, marginBottom: S.md, fontWeight: W.medium, ...numeric }}>
          <span style={{ display: 'inline-flex', color: hintTone === 'neutral' ? C.faint : k.fg }}>{hintTone === 'neutral' ? <IconInfo size={14} /> : toneIcon(hintTone, 14)}</span>
          <span>{hint}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm + 2, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

/** Vertical hairline between button groups inside an ActionBar (hidden when the row wraps tight). */
export function ActionDivider() {
  return <span aria-hidden style={{ width: 1, alignSelf: 'stretch', minHeight: 28, background: C.line, margin: `0 ${S.xs}px` }} />
}

/** Labelled cluster of related buttons, e.g. "Downloads". */
export function ActionGroup({ label, children }: { label?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
      {label && <span style={{ ...eyebrow, marginRight: 2 }}>{label}</span>}
      {children}
    </div>
  )
}

/**
 * A select dressed as a proper control: leading icon, optional label above, custom chevron.
 * Pass the same value/onChange/children a <select> takes.
 */
export function ControlSelect({ label, icon, value, onChange, children, minWidth = 150, title, disabled, strong }: {
  label?: React.ReactNode; icon?: React.ReactNode; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  children: React.ReactNode; minWidth?: number; title?: string; disabled?: boolean
  /** Brand-tinted value text — for the one picker that scopes the screen (the month). */
  strong?: boolean
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      {label && <span style={{ ...eyebrow }}>{label}</span>}
      <span style={{ position: 'relative', display: 'block', minWidth: `min(${minWidth}px, 100%)` }}>
        {icon && <span aria-hidden style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: strong ? C.brand : C.muted, pointerEvents: 'none', display: 'inline-flex' }}>{icon}</span>}
        <select value={value} onChange={onChange} title={title} disabled={disabled} style={{
          width: '100%', height: 38, boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none',
          padding: `0 32px 0 ${icon ? 34 : 12}px`, fontSize: F.small, fontFamily: F.family,
          fontWeight: strong ? W.semi : W.medium, color: strong ? C.brandDeep : C.ink,
          background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, boxShadow: E.flat,
          outline: 'none', cursor: disabled ? 'not-allowed' : 'pointer', transition: `border-color ${M.quick}`,
        }}>{children}</select>
        <span aria-hidden style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none', display: 'inline-flex' }}><IconChevronDown size={14} /></span>
      </span>
    </label>
  )
}

/**
 * Filter card shell: an eyebrow label, a wrapping row of FilterFields, then a summary
 * line ("payroll will run on 12 of 302") and a Clear button when `active`.
 */
export function FilterBar({ label = 'Filter', children, summary, active, onClear, clearLabel = 'Clear filters', summaryTone }: {
  label?: React.ReactNode; children: React.ReactNode; summary?: React.ReactNode; active?: boolean
  onClear?: () => void; clearLabel?: string; summaryTone?: Tone
}) {
  const st = summaryTone || (active ? 'brand' : 'neutral')
  const k = tone(st)
  return (
    <div style={{
      background: C.surface, border: `1px solid ${active ? C.brandEdge : C.line}`, borderRadius: R.lg,
      boxShadow: active ? `0 0 0 3px ${C.brandTint}` : E.flat, marginBottom: S.lg, overflow: 'hidden',
      transition: `box-shadow ${M.quick}, border-color ${M.quick}`,
    }}>
      <div style={{ padding: `${S.md}px ${S.lg}px`, display: 'flex', flexDirection: 'column', gap: S.md }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', color: active ? C.brand : C.muted }}><IconFilter size={14} /></span>
          <span style={{ ...eyebrow, color: active ? C.brandDeep : C.muted }}>{label}</span>
          {active && <StatusPill t="brand" size="sm" dot>On</StatusPill>}
          {active && onClear && (
            <button onClick={onClear} className="ez-press" style={{ ...btnStyle('ghost', 'sm'), marginLeft: 'auto', color: C.critical, height: 26 }}>
              <IconClose size={12} /> {clearLabel}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: S.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
      </div>
      {summary && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 7, padding: `${S.sm + 2}px ${S.lg}px`,
          background: st === 'neutral' ? C.sunken : k.bg, borderTop: `1px solid ${st === 'neutral' ? C.line : k.edge}`,
          fontSize: F.tiny, color: st === 'neutral' ? C.muted : C.inkSoft, lineHeight: 1.55, ...numeric,
        }}>
          <span style={{ display: 'inline-flex', color: st === 'neutral' ? C.faint : k.fg, marginTop: 2 }}>{st === 'critical' || st === 'warning' ? toneIcon(st, 13) : <IconInfo size={13} />}</span>
          <span>{summary}</span>
        </div>
      )}
    </div>
  )
}

/** One labelled control inside a FilterBar. `grow` lets it take the spare width (search boxes). */
export function FilterField({ label, children, grow, minWidth = 150 }: { label: React.ReactNode; children: React.ReactNode; grow?: boolean; minWidth?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: grow ? `1 1 ${minWidth}px` : `0 1 ${minWidth}px`, minWidth: `min(${minWidth}px, 100%)` }}>
      <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>{label}</span>
      {children}
    </label>
  )
}

/** Input / select skin that matches ControlSelect height (38) for use inside FilterField. */
export const fieldStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px', boxSizing: 'border-box', fontSize: F.small, fontFamily: F.family,
  color: C.ink, background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, outline: 'none',
  transition: `border-color ${M.quick}`,
}

/**
 * Sub-tabs as a segmented track (the well is sunken, the active segment lifts to the surface).
 * Scrolls sideways inside itself if it runs out of room.
 */
export function SegmentedTabs<T extends string>({ items, value, onChange, size = 'md' }: {
  items: { key: T; label: React.ReactNode; icon?: React.ReactNode; count?: number; disabled?: boolean; title?: string }[]
  value: T; onChange: (k: T) => void; size?: 'sm' | 'md'
}) {
  return (
    <div className="ez-scroll" style={{ ...scrollX, marginBottom: S.lg }}>
      <div role="tablist" className="ez-tabseg" style={{ display: 'inline-flex', gap: 2, padding: 3, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md + 2 }}>
        {items.map(it => {
          const on = it.key === value
          return (
            <button key={it.key} role="tab" aria-selected={on} disabled={it.disabled} title={it.title}
              onClick={() => !it.disabled && onChange(it.key)} className="ez-tab" data-on={on ? '1' : '0'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                height: size === 'sm' ? 28 : 32, padding: `0 ${size === 'sm' ? 10 : 13}px`, borderRadius: R.sm,
                fontFamily: 'inherit', fontSize: size === 'sm' ? F.tiny : F.small, fontWeight: on ? W.semi : W.medium,
                // Inactive segments leave background unset so the .ez-tabseg hover rule
                // (an inline value would always beat it) can lift them to the surface.
                color: on ? C.ink : C.muted, background: on ? C.surface : undefined,
                border: `1px solid ${on ? C.line : 'transparent'}`, boxShadow: on ? E.flat : 'none',
                cursor: it.disabled ? 'not-allowed' : 'pointer',
              }}>
              {it.icon}
              {it.label}
              {it.count != null && <CountChip t={on ? 'brand' : 'neutral'}>{it.count}</CountChip>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A selectable status chip with a count — readiness checks, issue buckets. The tone says
 * how serious the bucket is (critical = blocks pay, warning = heads-up, positive = clear);
 * `active` marks the one whose detail is open below.
 */
export function ChipTab({ label, icon, count, t = 'neutral', active, disabled, title, onClick }: {
  label: React.ReactNode; icon?: React.ReactNode; count?: React.ReactNode; t?: Tone
  active?: boolean; disabled?: boolean; title?: string; onClick?: () => void
}) {
  const k = tone(t)
  const quiet = t === 'positive' || t === 'neutral'
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title} aria-pressed={!!active}
      className="ez-press ez-tab" data-on={active ? '1' : '0'}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        height: 40, padding: '0 10px 0 12px', borderRadius: R.md, fontFamily: 'inherit', fontSize: F.small,
        fontWeight: active ? W.bold : W.semi, opacity: disabled ? .6 : 1,
        color: active ? (quiet ? C.ink : k.fg) : C.inkSoft,
        background: active ? k.bg : C.surface,
        border: `1px solid ${active ? (quiet ? C.lineStrong : k.fg) : (quiet ? C.line : k.edge)}`,
        boxShadow: active ? `inset 0 -2px 0 ${quiet ? C.brand : k.fg}` : E.flat,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      {icon && <span style={{ display: 'inline-flex', color: disabled ? C.faint : quiet ? C.muted : k.fg }}>{icon}</span>}
      <span>{label}</span>
      {count != null && (
        <span style={{
          minWidth: 22, height: 22, padding: '0 7px', borderRadius: R.pill, boxSizing: 'border-box',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: F.micro, fontWeight: W.bold, ...numeric,
          background: disabled ? C.sunken : quiet ? k.bg : k.fg,
          color: disabled ? C.faint : quiet ? k.fg : C.onAccent,
          border: quiet && !disabled ? `1px solid ${k.edge}` : '1px solid transparent',
        }}>{count}</span>
      )}
    </button>
  )
}

/** Horizontal row of ChipTabs that scrolls inside itself instead of wrapping. */
export function ChipTabs({ children }: { children: React.ReactNode }) {
  return <div className="ez-scroll" style={{ display: 'flex', gap: S.sm, ...scrollX, paddingBottom: 4, marginBottom: S.md }}>{children}</div>
}

// ───────────────────────────────────────────────────────────────────────────
// TABLES — use lib/ui Th / Td / Tr inside DataTable; these add the scroll frame
// and the right-aligned numeric variants.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Scroll frame for a table: horizontal scroll inside its own bounds, optional max height
 * with the (lib/ui) Th header sticking, hairline rows. `framed` adds the card border.
 */
export function DataTable({ children, minWidth, maxHeight, framed = false, style }: {
  children: React.ReactNode; minWidth?: number; maxHeight?: number | string; framed?: boolean; style?: React.CSSProperties
}) {
  return (
    <div className="ez-scroll" style={{
      ...scrollX, maxHeight, overflowY: maxHeight ? 'auto' : undefined,
      ...(framed ? { background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md } : null), ...style,
    }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: F.small, minWidth }}>{children}</table>
    </div>
  )
}

/** Inline style fragments for tables that keep their own <th>/<td> markup. */
export const dt = {
  th: { ...eyebrow, textAlign: 'left', padding: '9px 12px', background: C.sunken, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: Z.raised } as React.CSSProperties,
  thNum: { ...eyebrow, textAlign: 'right', padding: '9px 12px', background: C.sunken, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: Z.raised } as React.CSSProperties,
  td: { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, color: C.inkSoft, verticalAlign: 'middle' } as React.CSSProperties,
  tdNum: { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, color: C.ink, textAlign: 'right', whiteSpace: 'nowrap', ...numeric } as React.CSSProperties,
  tdStrong: { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, color: C.ink, fontWeight: W.semi } as React.CSSProperties,
  tdMono: { padding: '9px 12px', borderBottom: `1px solid ${C.line}`, color: C.ink, fontWeight: W.semi, whiteSpace: 'nowrap', ...numeric } as React.CSSProperties,
  /** className for a hover-washed row: <tr className={dt.rowClass}> */
  rowClass: 'ez-row',
}

/** Small locked-state chip used beside a disabled primary action. */
export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: F.tiny, color: C.muted }}>
      <IconLock size={13} /> {children}
    </span>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// EMPLOYEE-PORTAL ADDITIONS — glyphs and building blocks the ESS payroll tabs
// need that the admin kit did not: savings/retirement icons, a stacked meter,
// labelled form fields, radio cards, a consent box and figure rows.
// ───────────────────────────────────────────────────────────────────────────

/** Piggy bank — savings, Voluntary PF. */
export const IconPiggyBank = (p: KitIconProps) => <KSvg {...p}><path d="M15.6 8.4c.9.4 1.6 1.2 1.9 2.1h.5v3h-1.2a5.6 5.6 0 0 1-1.8 1.7V17h-2.4v-1.2a7 7 0 0 1-2.8 0V17H7.4v-1.8A4.9 4.9 0 0 1 4.5 11c0-3 2.6-5 5.8-5 1.1 0 2.2.2 3 .7l2-1.2Z" /><path d="M2.5 9.5c.4.9 1.1 1.4 2 1.5M12.7 9.4h.1" /><path d="M8.3 7.4c.7-.3 1.5-.4 2.3-.3" /></KSvg>
/** Umbrella — retirement cover, NPS. */
export const IconUmbrella = (p: KitIconProps) => <KSvg {...p}><path d="M2.6 10a7.4 7.4 0 0 1 14.8 0Z" /><path d="M10 10v5.4a1.7 1.7 0 0 1-3.4 0M10 2.6v.4" /></KSvg>
/** Percent sign in a tag — rates, contribution %. */
export const IconPercent = (p: KitIconProps) => <KSvg {...p}><path d="m5.5 14.5 9-9" /><circle cx="6.3" cy="6.3" r="1.8" /><circle cx="13.7" cy="13.7" r="1.8" /></KSvg>
/** Calculator — EMI and impact previews. */
export const IconCalculator = (p: KitIconProps) => <KSvg {...p}><rect x="4" y="2.5" width="12" height="15" rx="2" /><path d="M6.8 5.5h6.4v2.6H6.8Z" /><path d="M7 11h.1M10 11h.1M13 11h.1M7 14h.1M10 14h.1M13 14h.1" /></KSvg>
/** Wallet — take-home / in-hand pay. */
export const IconWallet = (p: KitIconProps) => <KSvg {...p}><path d="M15.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H4.5a2 2 0 0 0 0 4" /><path d="M2.5 5.5v9a2 2 0 0 0 2 2h11a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-11a2 2 0 0 1-2-2Z" /><path d="M13.5 12h.1" /></KSvg>
/** Shield with a tick — statutory, protected, compliant. */
export const IconShieldCheck = (p: KitIconProps) => <KSvg {...p}><path d="M10 2.6 16 5v4.6c0 3.6-2.5 6.4-6 7.8-3.5-1.4-6-4.2-6-7.8V5Z" /><path d="m7.4 10 1.8 1.8 3.4-3.6" /></KSvg>
/** Rising line — growth, savings building up. */
export const IconTrendUp = (p: KitIconProps) => <KSvg {...p}><path d="m2.8 14.2 4.6-4.6 3 3 6.2-6.4" /><path d="M12.6 6.2h4v4" /></KSvg>
/** Pen — signing an agreement. */
export const IconPen = (p: KitIconProps) => <KSvg {...p}><path d="m12.6 3.8 3.6 3.6-8.8 8.8H3.8v-3.6Z" /><path d="m10.8 5.6 3.6 3.6" /></KSvg>
/** Sparkle — something new is coming. */
export const IconSparkle = (p: KitIconProps) => <KSvg {...p}><path d="M10 2.8c.5 3.4 1.8 4.7 5.2 5.2-3.4.5-4.7 1.8-5.2 5.2-.5-3.4-1.8-4.7-5.2-5.2 3.4-.5 4.7-1.8 5.2-5.2Z" /><path d="M15.4 13.2c.2 1.2.7 1.7 1.9 1.9-1.2.2-1.7.7-1.9 1.9-.2-1.2-.7-1.7-1.9-1.9 1.2-.2 1.7-.7 1.9-1.9Z" /></KSvg>
/** Tray with an up arrow — upload a proof or a bill. */
export const IconUpload2 = (p: KitIconProps) => <KSvg {...p}><path d="M10 13V3.5M6.4 7 10 3.5 13.6 7" /><path d="M3.5 12.5v2.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></KSvg>

/**
 * Screen intro inside the Payroll hub: icon tile, title, one plain-language line and a
 * right-hand slot (usually a StatusPill saying where the person stands). Lighter than
 * PayrollPageHeader — the hub above already carries the page title.
 */
export function ScreenIntro({ icon, title, subtitle, right, t = 'brand' }: {
  icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; t?: Tone
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', marginBottom: S.lg }}>
      {icon && <IconTile icon={icon} t={t} size={40} />}
      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
        <h2 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, color: C.ink, letterSpacing: '-.015em', lineHeight: 1.25 }}>{title}</h2>
        {subtitle && <div style={{ marginTop: 3, fontSize: F.small, color: C.muted, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
    </div>
  )
}

/** One segment of a Meter. `value` is in the same unit as the Meter's `max`. */
export interface MeterSegment { value: number; t?: Tone; label?: React.ReactNode; striped?: boolean }

/**
 * Horizontal meter that can stack several segments (EPF + VPF against the 80C cap,
 * paid vs remaining instalments). Segments are clipped at `max`; an optional legend
 * names each one with its colour swatch.
 */
export function Meter({ segments, max, height = 10, legend, ariaLabel }: {
  segments: MeterSegment[]; max: number; height?: number; legend?: boolean; ariaLabel?: string
}) {
  let used = 0
  const parts = segments.map(sg => {
    const room = Math.max(0, max - used)
    const v = Math.max(0, Math.min(room, sg.value || 0))
    used += v
    return { ...sg, pct: max > 0 ? (v / max) * 100 : 0 }
  })
  const total = segments.reduce((a, b) => a + Math.max(0, b.value || 0), 0)
  return (
    <div>
      <div role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(total, max)}
        style={{ display: 'flex', height, borderRadius: R.pill, background: C.sunken, border: `1px solid ${C.line}`, overflow: 'hidden', boxSizing: 'border-box' }}>
        {parts.map((p, i) => (
          <span key={i} style={{
            width: `${p.pct}%`, height: '100%', background: tone(p.t || 'brand').fg, transition: `width ${M.slow}`,
            borderRight: i < parts.length - 1 && p.pct > 0 ? `2px solid ${C.surface}` : undefined, boxSizing: 'border-box',
            backgroundImage: p.striped ? `repeating-linear-gradient(135deg, transparent 0 5px, ${C.surface} 5px 7px)` : undefined,
          }} />
        ))}
      </div>
      {legend && (
        <div style={{ display: 'flex', gap: S.md, flexWrap: 'wrap', marginTop: S.sm }}>
          {parts.filter(p => p.label != null).map((p, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.inkSoft, ...numeric }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: tone(p.t || 'brand').fg, flexShrink: 0 }} />
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** A labelled form control: label, the control, then a hint line (tone-coloured for validation). */
export function LabeledField({ label, hint, hintTone = 'neutral', children, style }: {
  label: React.ReactNode; hint?: React.ReactNode; hintTone?: Tone; children: React.ReactNode; style?: React.CSSProperties
}) {
  const k = tone(hintTone)
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>{label}</span>
      {children}
      {hint != null && hint !== '' && <span style={{ fontSize: F.tiny, color: hintTone === 'neutral' ? C.muted : k.fg, lineHeight: 1.45, fontWeight: hintTone === 'neutral' ? W.regular : W.semi, ...numeric }}>{hint}</span>}
    </label>
  )
}

/** Comfortable input skin for employee forms (44px, larger type than the 38px filter skin). */
export function inputSkin(opts?: { invalid?: boolean; big?: boolean; mono?: boolean }): React.CSSProperties {
  return {
    width: '100%', height: opts?.big ? 52 : 44, padding: '0 14px', boxSizing: 'border-box',
    fontSize: opts?.big ? F.title : F.body, fontWeight: opts?.big ? W.semi : W.regular, fontFamily: F.family,
    color: C.ink, background: C.surface, border: `1px solid ${opts?.invalid ? C.critical : C.lineStrong}`,
    borderRadius: R.md, outline: 'none', boxShadow: opts?.invalid ? `0 0 0 3px ${C.criticalTint}` : E.flat,
    transition: `border-color ${M.quick}, box-shadow ${M.quick}`, ...(opts?.mono ? { ...numeric, letterSpacing: '.12em' } : null),
  }
}

/**
 * A radio-style choice drawn as a card — "Yes, I have a PRAN" / "No, I need one", a loan
 * type. `selected` lifts it with a brand ring; the whole card is the button.
 */
export function ChoiceCard({ selected, onClick, title, sub, icon, badge, children }: {
  selected: boolean; onClick: () => void; title: React.ReactNode; sub?: React.ReactNode
  icon?: React.ReactNode; badge?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className="ez-press"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: S.md, textAlign: 'left', width: '100%', minWidth: 0,
        padding: `${S.md + 2}px ${S.lg}px`, borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
        background: selected ? C.brandTint : C.surface, color: C.ink,
        border: `1px solid ${selected ? C.brand : C.line}`,
        boxShadow: selected ? `0 0 0 3px ${C.brandTint}, ${E.flat}` : E.flat,
      }}>
      <span aria-hidden style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1, boxSizing: 'border-box',
        border: `2px solid ${selected ? C.brand : C.lineStrong}`, background: C.surface,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.brand }} />}</span>
      {icon && <span style={{ display: 'inline-flex', color: selected ? C.brandDeep : C.muted, marginTop: 1 }}>{icon}</span>}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.body, fontWeight: W.semi, color: selected ? C.brandDeep : C.ink }}>{title}</span>
          {badge}
        </span>
        {sub && <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 3, lineHeight: 1.45, ...numeric }}>{sub}</span>}
        {children}
      </span>
    </button>
  )
}

/** The "I understand…" checkbox, set in a quiet well so it reads as a deliberate step. */
export function ConsentCheck({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label style={{
      display: 'flex', gap: S.md, alignItems: 'flex-start', cursor: 'pointer', marginBottom: S.md,
      padding: `${S.md}px ${S.md + 2}px`, borderRadius: R.md,
      background: checked ? C.brandTint : C.sunken, border: `1px solid ${checked ? C.brandEdge : C.line}`,
      transition: `background ${M.quick}, border-color ${M.quick}`,
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, width: 17, height: 17, accentColor: C.brand, flexShrink: 0, cursor: 'pointer' }} />
      <span style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{children}</span>
    </label>
  )
}

/** One label → figure row in a list of figures. `strong` for the total line. */
export function StatLine({ label, value, sub, t, strong, first }: {
  label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; t?: Tone; strong?: boolean; first?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.md, padding: `${S.sm + 2}px 0`, borderTop: first ? 'none' : `1px solid ${C.line}` }}>
      <span style={{ fontSize: F.small, color: t && t !== 'neutral' ? tone(t).fg : C.inkSoft, minWidth: 0 }}>
        {label}
        {sub && <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 1 }}>{sub}</span>}
      </span>
      <span style={{
        fontSize: strong ? F.title : F.body, fontWeight: strong ? W.bold : W.semi, whiteSpace: 'nowrap',
        color: t && t !== 'neutral' ? tone(t).fg : strong ? C.ink : C.ink, letterSpacing: strong ? '-.01em' : undefined, ...numeric,
      }}>{value}</span>
    </div>
  )
}

/** Bulleted points inside a callout or card, with a small tone-coloured dot. */
export function PointList({ items, t = 'neutral' }: { items: React.ReactNode[]; t?: Tone }) {
  const k = tone(t)
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', lineHeight: 1.55 }}>
          <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: t === 'neutral' ? C.faint : k.fg, marginTop: '.62em', flexShrink: 0 }} />
          <span style={{ minWidth: 0 }}>{it}</span>
        </li>
      ))}
    </ul>
  )
}

/** Responsive two-column layout that becomes one column under ~2 × `min` px. */
export function TwoCol({ children, min = 340, gap = S.lg, style }: { children: React.ReactNode; min?: number; gap?: number; style?: React.CSSProperties }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap, alignItems: 'start', ...style }}>{children}</div>
}

/** Loading placeholder for a payroll tab — a few shimmering blocks, not a bare "Loading…". */
export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: i === 0 ? 92 : 64, borderRadius: R.lg, border: `1px solid ${C.line}`,
          background: `linear-gradient(90deg,${C.sunken} 25%,${C.brandTint} 50%,${C.sunken} 75%)`,
          backgroundSize: '200% 100%', animation: 'ezShimmer 1.2s infinite',
        }} />
      ))}
      <span style={{ fontSize: F.tiny, color: C.muted }}>{label}</span>
    </div>
  )
}
