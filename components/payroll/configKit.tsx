'use client'
// components/payroll/configKit.tsx — building blocks for the payroll CONFIGURATION and
// STATUTORY screens (EPF, ESIC, PT, LWF, Income tax, Minimum wages, Bonus, Perquisites,
// NPS). They sit on top of components/payroll/kit.tsx and follow the same house rules:
//
//   * colour only from the tokens in @/lib/ui — no hex, no rgb(); light and dark repaint
//     through lib/ui/theme.css.
//   * every component lives at module top level (a nested one remounts on each render
//     and drops focus mid-typing).
//   * z-index only from Z.
//   * purely presentational: nothing here loads data or owns business state. The one
//     stateful piece, StateSelect, only owns whether its own list is open and what is
//     typed into its own filter box — exactly what the three copies it replaces owned.

import * as React from 'react'
import { useState } from 'react'
import {
  C, F, W, S, R, E, M, Z, tone, numeric, eyebrow, inputStyle, type Tone,
  IconCheck, IconClose, IconChevronDown, IconSearch,
} from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'
import { IconTile } from '@/components/payroll/kit'

// ───────────────────────────────────────────────────────────────────────────
// FORM SKIN
// ───────────────────────────────────────────────────────────────────────────

/** Input / select skin for config forms (38px, surface, strong hairline). */
export const cfgInput: React.CSSProperties = { ...inputStyle(), ...numeric }
/** Same skin for a textarea: auto height, comfortable line height. */
export const cfgTextarea: React.CSSProperties = { ...inputStyle(), height: 'auto', padding: '9px 12px', lineHeight: 1.5, resize: 'vertical' }

/**
 * Label above a control, with an optional hint under it. `as="div"` for a custom
 * control (StateSelect) so a click on the label is not forwarded to an input inside it.
 */
export function CField({ label, hint, required, children, as = 'label', style }: {
  label: React.ReactNode; hint?: React.ReactNode; required?: boolean; children: React.ReactNode
  as?: 'label' | 'div'; style?: React.CSSProperties
}) {
  const Tag = as
  return (
    <Tag style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, ...style }}>
      <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft, lineHeight: 1.3 }}>
        {label}{required && <span style={{ color: C.critical, marginLeft: 3 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.45 }}>{hint}</span>}
    </Tag>
  )
}

/** Responsive form grid: fields reflow by `min` width and never push the page sideways. */
export function FormGrid({ children, min = 170, gap = S.md, style }: { children: React.ReactNode; min?: number; gap?: number; style?: React.CSSProperties }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap, alignItems: 'end', ...style }}>{children}</div>
}

// ───────────────────────────────────────────────────────────────────────────
// HEADERS
// ───────────────────────────────────────────────────────────────────────────

/**
 * The first card on a config screen: what the rule is, in one plain line, plus the
 * facts that scope it (FY, Act) as quiet chips and the screen's main action on the right.
 * `children` renders under a hairline — typically a KpiGrid of the current values.
 */
export function RuleSummary({ icon, eyebrow: eb, title, rule, meta, actions, children }: {
  icon: React.ReactNode; eyebrow?: React.ReactNode; title: React.ReactNode; rule?: React.ReactNode
  meta?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <section style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.raised,
      marginBottom: S.lg, minWidth: 0, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md + 2, flexWrap: 'wrap', padding: `${S.lg}px ${S.lg + 2}px` }}>
        <IconTile icon={icon} t="brand" size={42} solid />
        <div style={{ minWidth: 0, flex: '1 1 300px' }}>
          {eb && <div style={{ ...eyebrow, marginBottom: 3 }}>{eb}</div>}
          <div style={{ fontSize: F.title, fontWeight: W.bold, color: C.ink, letterSpacing: '-.015em', lineHeight: 1.2 }}>{title}</div>
          {rule && <div style={{ marginTop: 4, fontSize: F.small, color: C.inkSoft, lineHeight: 1.5, ...numeric }}>{rule}</div>}
          {meta && <div style={{ marginTop: S.sm, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{meta}</div>}
        </div>
        {actions && <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children != null && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: C.sunken, padding: `${S.lg}px ${S.lg + 2}px` }}>{children}</div>
      )}
    </section>
  )
}

/** A quiet reference chip: an Act, a section, a notification. Reads as metadata, not status. */
export function RefChip({ children, t = 'neutral', icon }: { children: React.ReactNode; t?: Tone; icon?: React.ReactNode }) {
  const k = tone(t)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: R.pill,
      fontSize: F.tiny, fontWeight: W.semi, lineHeight: 1.5, whiteSpace: 'nowrap', ...numeric,
      background: t === 'neutral' ? C.surface : k.bg, color: t === 'neutral' ? C.inkSoft : k.fg,
      border: `1px solid ${t === 'neutral' ? C.lineStrong : k.edge}`,
    }}>{icon}{children}</span>
  )
}

/** A circled step number, for numbered setup cards ("1 · When is bonus paid?"). */
export function StepBadge({ n }: { n: React.ReactNode }) {
  return <span style={{ fontSize: F.small, fontWeight: W.bold, ...numeric }}>{n}</span>
}

// ───────────────────────────────────────────────────────────────────────────
// CHOICES
// ───────────────────────────────────────────────────────────────────────────

/** An on/off pill with a real checkbox glyph. `onChange` receives the new value. */
export function ToggleChip({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="ez-press"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 13px 0 10px',
        borderRadius: R.pill, fontFamily: 'inherit', fontSize: F.small, fontWeight: W.semi, whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: 1,
        border: `1px solid ${checked ? C.brandEdge : C.lineStrong}`,
        background: checked ? C.brandTint : C.surface, color: checked ? C.brandDeep : C.inkSoft,
        boxShadow: checked ? 'none' : E.flat, transition: `background ${M.quick}, border-color ${M.quick}`,
      }}>
      <span aria-hidden style={{
        width: 16, height: 16, borderRadius: 5, flexShrink: 0, boxSizing: 'border-box',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? C.brand : C.surface, border: `1.5px solid ${checked ? C.brand : C.lineStrong}`, color: C.onAccent,
      }}>{checked && <IconCheck size={11} strokeWidth={2.6} />}</span>
      {label}
    </button>
  )
}

/** A native checkbox dressed as a row: box, text, and an optional sunken well. */
export function CheckRow({ checked, onChange, children, well }: {
  checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; children: React.ReactNode; well?: boolean
}) {
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
      ...(well ? { background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.md}px ${S.md + 2}px` } : null),
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ marginTop: 2, width: 16, height: 16, accentColor: C.brand, flexShrink: 0 }} />
      <span style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{children}</span>
    </label>
  )
}

/**
 * A selectable card, radio-style: a ring that fills when chosen, a label and a sub-line.
 * `t` tints the chosen state (brand by default; positive / critical for yes / no choices).
 */
export function OptionCard({ label, sub, active, onClick, t = 'brand', disabled, type }: {
  label: React.ReactNode; sub?: React.ReactNode; active: boolean; onClick: () => void
  t?: Tone; disabled?: boolean; type?: 'button'
}) {
  const k = tone(t)
  const ring = t === 'brand' ? C.brand : k.fg
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-pressed={active} className="ez-press"
      style={{
        flex: '1 1 140px', minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
        padding: '11px 13px', borderRadius: R.md, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${active ? ring : C.lineStrong}`, background: active ? k.bg : C.surface,
        boxShadow: active ? `inset 0 0 0 1px ${ring}` : E.flat, opacity: disabled ? .55 : 1,
        transition: `background ${M.quick}, border-color ${M.quick}`,
      }}>
      <span aria-hidden style={{
        marginTop: 2, width: 16, height: 16, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
        border: `1.5px solid ${active ? ring : C.lineStrong}`, background: C.surface,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: ring }} />}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: F.body, fontWeight: W.semi, color: active ? (t === 'brand' ? C.brandDeep : k.fg) : C.ink, ...numeric }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: F.tiny, marginTop: 2, color: C.muted, fontWeight: W.medium }}>{sub}</span>}
      </span>
    </button>
  )
}

/** Small outline button for "quick fill" shortcuts above a control. */
export function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ez-press" style={{
      height: 26, padding: '0 10px', borderRadius: R.pill, border: `1px solid ${C.brandEdge}`,
      background: C.surface, color: C.brandDeep, fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi,
      cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{children}</button>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// RESULTS
// ───────────────────────────────────────────────────────────────────────────

/**
 * A horizontal strip of labelled figures separated by hairlines — the answer of a
 * calculator. The `strong` cell (usually the total) sits on a brand tint.
 */
export function FigureStrip({ items }: { items: { label: React.ReactNode; value: React.ReactNode; t?: Tone; strong?: boolean }[] }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(130px, 100%), 1fr))`,
      background: C.line, gap: 1, border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden',
    }}>
      {items.map((it, i) => (
        <div key={i} style={{ background: it.strong ? C.brandTint : C.surface, padding: `${S.md}px ${S.md + 2}px`, minWidth: 0 }}>
          <div style={{ ...eyebrow, marginBottom: 4, color: it.strong ? C.brandDeep : C.muted }}>{it.label}</div>
          <div style={{
            fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.01em', ...numeric, overflowWrap: 'anywhere',
            color: it.strong ? C.brandDeep : it.t ? tone(it.t).fg : C.ink,
          }}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}

/** A sunken result panel that holds a FigureStrip and its explanation. */
export function ResultWell({ children, t, style }: { children: React.ReactNode; t?: Tone; style?: React.CSSProperties }) {
  const k = t ? tone(t) : null
  return (
    <div className="ez-rise" style={{
      background: k ? k.bg : C.sunken, border: `1px solid ${k ? k.edge : C.line}`, borderRadius: R.lg,
      padding: `${S.md + 2}px ${S.lg}px`, display: 'flex', flexDirection: 'column', gap: S.md, ...style,
    }}>{children}</div>
  )
}

/** A rate / percentage rendered as a tone chip — slab tables. */
export function RateChip({ children, t = 'brand' }: { children: React.ReactNode; t?: Tone }) {
  const k = tone(t)
  return (
    <span style={{
      display: 'inline-block', minWidth: 46, textAlign: 'center', padding: '2px 9px', borderRadius: R.pill,
      fontSize: F.tiny, fontWeight: W.bold, background: k.bg, color: k.fg, border: `1px solid ${k.edge}`, ...numeric,
    }}>{children}</span>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// OVERLAYS
// ───────────────────────────────────────────────────────────────────────────

/**
 * Dialog on a scrim. The header carries an icon tile, title and sub-line; the body
 * scrolls; the footer (buttons) stays pinned under a hairline.
 * `onBackdrop` closes on a click outside — pass it only where the screen already did.
 */
export function Modal({ icon, title, subtitle, onClose, onBackdrop, footer, children, maxWidth = 540 }: {
  icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode
  /** Shows the header close button when given. */
  onClose?: () => void
  onBackdrop?: () => void
  footer?: React.ReactNode; children: React.ReactNode; maxWidth?: number
}) {
  return (
    <div onClick={onBackdrop} style={{
      position: 'fixed', inset: 0, zIndex: Z.modal, background: `color-mix(in srgb, ${C.dark} 52%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: S.lg, fontFamily: F.family,
    }}>
      <div role="dialog" aria-modal="true" onClick={onBackdrop ? (e => e.stopPropagation()) : undefined} className="ez-rise" style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.overlay,
        width: '100%', maxWidth, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.ink,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: `${S.lg}px ${S.lg + 4}px`, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
          {icon && <IconTile icon={icon} t="brand" size={36} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink, letterSpacing: '-.01em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="ez-press" style={{
              width: 32, height: 32, borderRadius: R.md, border: `1px solid ${C.line}`, background: C.surface,
              color: C.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><IconClose size={14} /></button>
          )}
        </div>
        <div style={{ overflowY: 'auto', padding: `${S.lg}px ${S.lg + 4}px`, flex: 1, display: 'flex', flexDirection: 'column', gap: S.md }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', gap: S.sm + 2, padding: `${S.md}px ${S.lg + 4}px ${S.lg}px`, borderTop: `1px solid ${C.line}`, background: C.sunken, flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

/** Bottom-right confirmation / failure message. */
export function Toast({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="ez-rise" style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: Z.toast, maxWidth: 'min(420px, calc(100vw - 40px))',
      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: R.md,
      background: C.surface, color: C.ink, border: `1px solid ${C.lineStrong}`, boxShadow: E.overlay,
      fontSize: F.small, fontWeight: W.semi, fontFamily: F.family,
    }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: C.brand, flexShrink: 0 }} />
      {children}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// STATE SELECT — the searchable dropdown the PT, LWF and Minimum wage screens share.
// Same behaviour as the three copies it replaces: click to open, type to filter, first
// 100 matches, pick to close; dismissed by useDismiss (one click to move between two).
// ───────────────────────────────────────────────────────────────────────────

export function StateSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 100)
  return (
    <div ref={pop} style={{ position: 'relative', minWidth: 0 }}>
      <div role="button" tabIndex={0} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setOpen(o => !o); setQ('') }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); setQ('') } }}
        style={{
          ...cfgInput, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          color: value ? C.ink : C.faint, borderColor: open ? C.brand : C.lineStrong,
          boxShadow: open ? `0 0 0 3px ${C.brandTint}` : 'none',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: C.muted, display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: `transform ${M.quick}` }}><IconChevronDown size={14} /></span>
      </div>
      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: '100%', minWidth: 220, zIndex: Z.sticky,
          background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, boxShadow: E.floating, overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', borderBottom: `1px solid ${C.line}` }}>
            <span aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'inline-flex' }}><IconSearch size={14} /></span>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', height: 36, padding: '0 10px 0 32px', border: 'none', fontSize: F.small, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: C.surface, color: C.ink }} />
          </div>
          <div className="ez-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: F.tiny, color: C.faint }}>No matches</div>}
            {filtered.map(o => (
              <div key={o} role="option" aria-selected={o === value} className="ez-row" onClick={() => { onChange(o); setOpen(false) }}
                style={{
                  padding: '7px 10px', fontSize: F.small, cursor: 'pointer', borderRadius: R.sm,
                  background: o === value ? C.brandTint : undefined, color: o === value ? C.brandDeep : C.ink,
                  fontWeight: o === value ? W.semi : W.regular, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}>
                {o}
                {o === value && <IconCheck size={13} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
