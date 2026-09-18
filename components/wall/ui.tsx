'use client'
// components/wall/ui.tsx — the Wall of Fame's shared building blocks.
//
// v8 REDESIGN. Every surface in the module is assembled from the pieces in
// this file, so a spacing, radius or button change is made once and lands on
// the composer, the feed, the rail and the console together. Before v8 each
// component carried its own Label / Err / Chip / button styling, and they had
// already drifted apart.
//
// THE HOUSE RULES STILL HOLD, and nothing here bends them:
//
//   Inline styles only — no Tailwind classes in JSX. The one <style> block
//   below (WALL_CSS) exists for the same reason GOLD_CSS and BADGE_KEYFRAMES
//   do: hover, focus-visible, keyframes and reduced-motion cannot be written
//   as inline styles. It styles class hooks only; it never sets layout.
//
//   Every component is declared at module scope. Declared inside a parent,
//   React remounts it per render and inputs lose focus per keystroke.
//
//   No gold in this file. Gold belongs to the Spotlight frame, the #1 podium
//   row and the board's award ribbon — nowhere else.
//
//   No browser storage.

import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { C, F, W, S, R } from '@/lib/ui'

/** The module's one easing curve. Do not substitute another. */
export const EASE = 'cubic-bezier(.22,.72,.28,1)'

/** Radii, by role rather than by size, so hierarchy stays readable. */
export const RAD = {
  control: R.sm,   // inputs, buttons, chips with corners
  tile: R.md,      // category tiles, rows, inner cards
  panel: R.lg,     // panels
  hero: 22,        // the page hero only
  pill: 999,
} as const

// ── the one stylesheet ───────────────────────────────────────────────────

export const WALL_CSS = `
  .wof-root { -webkit-font-smoothing: antialiased; }
  .wof-root :focus-visible { outline: 2px solid ${C.brand}; outline-offset: 2px; border-radius: 6px; }
  .wof-root input:focus, .wof-root textarea:focus, .wof-root select:focus {
    outline: none; border-color: ${C.brand} !important; box-shadow: 0 0 0 3px ${C.brandTint};
  }
  .wof-btn { transition: background-color .18s ${EASE}, border-color .18s ${EASE}, color .18s ${EASE}, transform .12s ${EASE}; }
  .wof-btn:not(:disabled):active { transform: translateY(1px); }
  .wof-btn-primary:not(:disabled):hover { filter: brightness(1.06); }
  .wof-btn-secondary:not(:disabled):hover { border-color: ${C.brand}; color: ${C.brand}; }
  .wof-btn-ghost:not(:disabled):hover { background: ${C.sunken}; }
  .wof-btn-danger:not(:disabled):hover { border-color: ${C.critical}; }
  .wof-tile { transition: border-color .18s ${EASE}, background-color .18s ${EASE}, box-shadow .18s ${EASE}; }
  .wof-tile:not(:disabled):not([aria-pressed="true"]):not([aria-checked="true"]):hover {
    border-color: ${C.brandEdge}; background: ${C.brandTint};
  }
  .wof-row { transition: background-color .15s ${EASE}; }
  .wof-row:hover { background: ${C.sunken}; }
  .wof-open { animation: wofOpen .34s ${EASE} both; }
  @keyframes wofOpen { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
  .wof-skel { animation: wofPulse 1.4s ease-in-out infinite; }
  @keyframes wofPulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
  .wof-toast { animation: wofToast .38s ${EASE} both; }
  @keyframes wofToast { from { opacity: 0; transform: translate(-50%, 14px) } to { opacity: 1; transform: translate(-50%, 0) } }
  .wof-jump { display: none; }
  @media (max-width: 900px) {
    .wof-jump { display: flex; }
  }
  .wof-jump::-webkit-scrollbar { display: none; }
  .wof-anchor { scroll-margin-top: 72px; }
  @media (prefers-reduced-motion: reduce) {
    .wof-toast { animation: none !important; }
    .wof-open, .wof-skel { animation: none !important; }
    .wof-btn, .wof-tile, .wof-row { transition: none !important; }
  }
`

// ── icons ────────────────────────────────────────────────────────────────
// Stroked, 24-unit grid, currentColor. Inline so the module ships no assets.

const PATHS = {
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M10 17h4',
  medal: 'M8 3l2.5 5M16 3l-2.5 5M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5v4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  power: 'M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  alert: 'M12 4l9 16H3zM12 10v4.5M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, stroke = 1.8, style }: {
  name: IconName; size?: number; stroke?: number; style?: CSSProperties
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}>
      <path d={PATHS[name]} />
    </svg>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '·'
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Stable pick from the six data-ramp hues, so a person keeps one avatar
 *  colour everywhere. Decorative only — it never implies a status. */
const AVATAR_TONES: [string, string][] = [
  ['#DBEAFE', '#1D4ED8'], ['#D1FAE5', '#047857'], ['#CFFAFE', '#0E7490'],
  ['#EDE9FE', '#6D28D9'], ['#FFE4E6', '#BE123C'], ['#E2E8F0', '#334155'],
]
function toneFor(name: string): [string, string] {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

// ── primitives ───────────────────────────────────────────────────────────

export function Avatar({ name, size = 40, ring }: { name: string; size?: number; ring?: string }) {
  const [bg, fg] = toneFor(name)
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', background: bg, color: fg,
      fontSize: Math.round(size * 0.38), fontWeight: W.bold, letterSpacing: '.01em',
      boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
    }}>{initialsOf(name)}</span>
  )
}

/** Overlapping avatars for a group recognition. Shows up to four. */
export function AvatarStack({ names, size = 28 }: { names: string[]; size?: number }) {
  const shown = names.slice(0, 4)
  const extra = names.length - shown.length
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} style={{ marginLeft: i ? -8 : 0, borderRadius: '50%',
                                         boxShadow: `0 0 0 2px ${C.surface}` }}>
          <Avatar name={n} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span style={{ marginLeft: -8, width: size, height: size, borderRadius: '50%',
                       display: 'grid', placeItems: 'center', background: C.sunken,
                       color: C.muted, fontSize: F.micro, fontWeight: W.bold,
                       boxShadow: `0 0 0 2px ${C.surface}` }}>+{extra}</span>
      )}
    </span>
  )
}

export function Pill({ children, tone = 'brand', icon }: {
  children: ReactNode; tone?: 'brand' | 'neutral' | 'positive' | 'warning' | 'critical'; icon?: IconName
}) {
  const map = {
    brand:    [C.brandTint, C.brand],
    neutral:  [C.sunken, C.muted],
    positive: [C.positiveTint, C.positive],
    warning:  [C.warningTint, C.warning],
    critical: [C.criticalTint, C.critical],
  } as const
  const [bg, fg] = map[tone]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                   borderRadius: RAD.pill, background: bg, color: fg, fontSize: F.micro,
                   fontWeight: W.semi, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
      {icon && <Icon name={icon} size={12} stroke={2} />}
      {children}
    </span>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  children, onClick, variant = 'secondary', size = 'md', icon, disabled, busy,
  pressed, label, type = 'button', full,
}: {
  children?: ReactNode; onClick?: () => void; variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'
  icon?: IconName; disabled?: boolean; busy?: boolean; pressed?: boolean; label?: string
  type?: 'button' | 'submit'; full?: boolean
}) {
  const pad = size === 'sm' ? '6px 11px' : size === 'lg' ? '12px 22px' : '9px 16px'
  const fs = size === 'sm' ? F.micro : F.small
  const look: Record<BtnVariant, CSSProperties> = {
    primary:   { background: C.brand, color: C.onAccent, border: `1px solid ${C.brand}` },
    secondary: { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` },
    ghost:     { background: 'transparent', color: C.inkSoft, border: '1px solid transparent' },
    danger:    { background: C.surface, color: C.critical, border: `1px solid ${C.line}` },
  }
  const off = disabled || busy
  return (
    <button type={type} onClick={onClick} disabled={off} aria-pressed={pressed}
      aria-label={label} aria-busy={busy || undefined}
      className={`wof-btn wof-btn-${variant}`}
      style={{
        ...look[variant],
        ...(off && variant === 'primary' ? { background: C.sunken, color: C.muted, borderColor: C.line } : {}),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: pad, borderRadius: RAD.control, fontFamily: 'inherit', fontSize: fs,
        fontWeight: W.bold, lineHeight: 1.2, cursor: off ? 'not-allowed' : 'pointer',
        opacity: busy ? .75 : 1, whiteSpace: 'nowrap', width: full ? '100%' : undefined,
      }}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} stroke={2} />}
      {children}
    </button>
  )
}

/** Every section of the page. Title, optional icon, sub-line and action. */
export function Panel({ title, sub, icon, action, children, tone = 'plain', pad = 'md', id }: {
  title?: string; sub?: string; icon?: IconName; action?: ReactNode; children: ReactNode
  tone?: 'plain' | 'sunken'; pad?: 'sm' | 'md'; id?: string
}) {
  const p = pad === 'sm' ? S.md : S.lg
  return (
    <section id={id} aria-label={title} style={{
      background: tone === 'sunken' ? C.sunken : C.surface,
      border: `1px solid ${C.line}`, borderRadius: RAD.panel,
      padding: p, minWidth: 0, scrollMarginTop: 72,
      boxShadow: tone === 'plain' ? '0 1px 2px rgba(15,23,42,.04)' : 'none',
    }}>
      {(title || action) && (
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                         gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
            {icon && (
              <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid',
                             placeItems: 'center', background: C.brandTint, color: C.brand,
                             flexShrink: 0 }}>
                <Icon name={icon} size={17} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              {title && (
                <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.bold, color: C.ink,
                             letterSpacing: '-.005em', lineHeight: 1.3 }}>{title}</h3>
              )}
              {sub && (
                <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>
                  {sub}
                </div>
              )}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

/** A form step. Numbered, because the composer really is filled in order —
 *  and the validator reports problems in that same order. */
export function Step({ n, title, hint, children, error, done }: {
  n: number; title: string; hint?: string; children: ReactNode; error?: string | null; done?: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span aria-hidden="true" style={{
          width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
          fontSize: F.micro, fontWeight: W.bold,
          background: error ? C.criticalTint : done ? C.brand : C.sunken,
          color: error ? C.critical : done ? C.onAccent : C.muted,
          border: `1px solid ${error ? C.critical : done ? C.brand : C.line}`,
        }}>{done && !error ? <Icon name="check" size={13} stroke={2.6} /> : n}</span>
        <span aria-hidden="true" style={{ flex: 1, width: 1, background: C.line, marginTop: 6 }} />
      </div>
      <div style={{ paddingBottom: S.lg, minWidth: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, lineHeight: 1.6 }}>{title}</div>
          {hint && <div style={{ fontSize: F.micro, color: C.muted, marginTop: 1 }}>{hint}</div>}
        </div>
        {children}
        <FieldError>{error}</FieldError>
      </div>
    </div>
  )
}

export function FieldLabel({ children, hint, htmlFor }: { children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label htmlFor={htmlFor} style={{ display: 'block', fontSize: F.micro, fontWeight: W.semi, color: C.inkSoft }}>
        {children}
      </label>
      {hint && <div style={{ fontSize: F.micro, color: C.faint, marginTop: 1 }}>{hint}</div>}
    </div>
  )
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8,
                               fontSize: F.micro, color: C.critical, fontWeight: W.semi, lineHeight: 1.45 }}>
      <Icon name="alert" size={13} stroke={2} style={{ marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}

export const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: RAD.control, fontFamily: 'inherit',
  fontSize: F.small, border: `1px solid ${C.line}`, background: C.surface, color: C.ink,
  boxSizing: 'border-box', lineHeight: 1.5,
}

/** A translucent edge that works whether a token is a hex or a CSS variable
 *  (appending "44" to a var() is invalid CSS and silently drops the border). */
const mix = (c: string, pct = 30) => `color-mix(in srgb, ${c} ${pct}%, transparent)`

/** Status banner. `critical` for failures, `positive` for confirmations,
 *  `info` for rules the person should know before acting. */
export function Notice({ tone = 'info', title, children, role }: {
  tone?: 'info' | 'positive' | 'warning' | 'critical'; title?: ReactNode; children?: ReactNode
  role?: 'alert' | 'status'
}) {
  const map = {
    info:     { bg: C.brandTint,    edge: C.brandEdge,       fg: C.brand,    icon: 'info' as IconName },
    positive: { bg: C.positiveTint, edge: mix(C.positive),   fg: C.positive, icon: 'check' as IconName },
    warning:  { bg: C.warningTint,  edge: mix(C.warning),    fg: C.warning,  icon: 'alert' as IconName },
    critical: { bg: C.criticalTint, edge: mix(C.critical),   fg: C.critical, icon: 'alert' as IconName },
  }[tone]
  return (
    <div role={role} style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                              background: map.bg, border: `1px solid ${map.edge}`,
                              borderRadius: RAD.tile, padding: '11px 14px' }}>
      <span style={{ color: map.fg, marginTop: 1 }}><Icon name={map.icon} size={16} stroke={2} /></span>
      <div style={{ minWidth: 0, fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>
        {title && <div style={{ fontWeight: W.bold, color: C.ink }}>{title}</div>}
        {children && <div style={{ marginTop: title ? 3 : 0 }}>{children}</div>}
      </div>
    </div>
  )
}

/** An empty state is an invitation, not a shrug. */
export function Empty({ icon = 'sparkle', title, children, compact, bare }: {
  icon?: IconName; title?: string; children: ReactNode; compact?: boolean
  /** No dashed frame — for when the parent already draws one. */
  bare?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: compact ? 'flex-start' : 'center',
                  flexDirection: compact ? 'row' : 'column', textAlign: compact ? 'left' : 'center',
                  padding: compact ? '4px 0' : `${S.lg}px ${S.md}px`,
                  border: compact || bare ? 'none' : `1px dashed ${C.line}`, borderRadius: RAD.tile }}>
      <span style={{ width: compact ? 30 : 44, height: compact ? 30 : 44, borderRadius: '50%',
                     display: 'grid', placeItems: 'center', background: C.sunken, color: C.faint,
                     flexShrink: 0 }}>
        <Icon name={icon} size={compact ? 15 : 20} />
      </span>
      <div style={{ maxWidth: '46ch' }}>
        {title && <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, marginBottom: 3 }}>{title}</div>}
        <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  )
}

/** A segmented control. Used for visibility and for the console's areas on
 *  narrow screens. */
export function Segmented<T extends string>({ options, value, onPick, label, render }: {
  options: readonly T[]; value: T; onPick: (v: T) => void; label: string
  render?: (v: T) => ReactNode
}) {
  return (
    <div role="group" aria-label={label} style={{
      display: 'inline-flex', flexWrap: 'wrap', gap: 3, padding: 3,
      background: C.sunken, borderRadius: RAD.control, border: `1px solid ${C.line}`,
    }}>
      {options.map(o => {
        const on = o === value
        return (
          <button key={o} type="button" onClick={() => onPick(o)} aria-pressed={on}
            className="wof-btn"
            style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '6px 13px',
                     borderRadius: RAD.control - 2, border: 'none', textTransform: 'capitalize',
                     fontSize: F.micro, fontWeight: on ? W.bold : W.semi,
                     background: on ? C.surface : 'transparent', color: on ? C.ink : C.muted,
                     boxShadow: on ? '0 1px 3px rgba(15,23,42,.12)' : 'none' }}>
            {render ? render(o) : o}
          </button>
        )
      })}
    </div>
  )
}

/** Selectable tile — categories and send modes use it. */
export function ChoiceTile({ on, onPick, glyph, title, text, disabled }: {
  on: boolean; onPick: () => void; glyph?: string | null; title: string; text?: string | null
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={() => !disabled && onPick()} aria-pressed={on} disabled={disabled}
      className="wof-tile"
      style={{
        position: 'relative', textAlign: 'left', fontFamily: 'inherit', minWidth: 0,
        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px',
        borderRadius: RAD.tile, cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1.5px solid ${on ? C.brand : C.line}`,
        background: on ? C.brandTint : C.surface, opacity: disabled ? .55 : 1,
      }}>
      {glyph && (
        <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                                          display: 'grid', placeItems: 'center', fontSize: 18,
                                          background: on ? C.surface : C.sunken }}>{glyph}</span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: F.small, fontWeight: W.bold,
                       color: on ? C.brand : C.ink, lineHeight: 1.35 }}>{title}</span>
        {text && (
          <span style={{ display: 'block', fontSize: F.micro, color: C.muted, marginTop: 2,
                         lineHeight: 1.45 }}>{text}</span>
        )}
      </span>
      {on && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18,
                                          borderRadius: '50%', background: C.brand, color: C.onAccent,
                                          display: 'grid', placeItems: 'center' }}>
          <Icon name="check" size={11} stroke={3} />
        </span>
      )}
    </button>
  )
}

/** The category grid, shared by both composers. */
export interface CategoryLike {
  id: string; code: string; label: string; glyph?: string | null; helper_text?: string | null
}
export function CategoryGrid<Cat extends CategoryLike>({ cats, value, onPick }: {
  cats: Cat[]; value: string | null; onPick: (code: string) => void
}) {
  return (
    <div style={{ display: 'grid', gap: 8,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))' }}>
      {cats.map(c => (
        <ChoiceTile key={c.id} on={value === c.code} onPick={() => onPick(c.code)}
          glyph={c.glyph} title={c.label} text={c.helper_text} />
      ))}
    </div>
  )
}

/** A person who has been picked. */
export function PersonChip({ name, meta, onRemove }: { name: string; meta?: string | null; onRemove: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 4px 4px 4px',
                   borderRadius: RAD.pill, background: C.surface, border: `1px solid ${C.brandEdge}`,
                   maxWidth: '100%' }}>
      <Avatar name={name} size={24} />
      <span style={{ minWidth: 0, lineHeight: 1.2 }}>
        <span style={{ display: 'block', fontSize: F.micro, fontWeight: W.bold, color: C.ink,
                       whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {meta && <span style={{ display: 'block', fontSize: 11, color: C.faint }}>{meta}</span>}
      </span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="wof-btn wof-btn-ghost"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted,
                 width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                 padding: 0 }}>
        <Icon name="close" size={12} stroke={2.4} />
      </button>
    </span>
  )
}

export function Divider({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: `${S.sm}px 0` }}>
      <span style={{ flex: 1, height: 1, background: C.line }} />
      {label && <span style={{ fontSize: F.micro, color: C.faint, fontWeight: W.semi }}>{label}</span>}
      {label && <span style={{ flex: 1, height: 1, background: C.line }} />}
    </div>
  )
}

/** Placeholder bars while a panel loads. Better than the word "Loading…"
 *  because the page keeps its shape. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="wof-skel" style={{ height: i === 0 ? 16 : 11, borderRadius: 6,
                                                   background: C.sunken, width: `${92 - i * 17}%` }} />
      ))}
    </div>
  )
}

/** Two columns that fall to one without a media query: the rail wraps under
 *  the main column once the main column would drop below `mainMin`. */
export function Split({ main, rail, mainMin = 520, railMin = 300, gap = S.lg, stickyRail }: {
  main: ReactNode; rail: ReactNode; mainMin?: number; railMin?: number; gap?: number; stickyRail?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'flex-start' }}>
      <div style={{ flex: `999 1 ${mainMin}px`, minWidth: 0, display: 'grid', gap }}>{main}</div>
      <div style={{ flex: `1 1 ${railMin}px`, minWidth: 0, display: 'grid', gap,
                    position: stickyRail ? 'sticky' : undefined, top: stickyRail ? 16 : undefined }}>
        {rail}
      </div>
    </div>
  )
}

/** A short confirmation after something was sent. Announced politely,
 *  dismisses itself, and says exactly what happened. */
export function Toast({ message, onDone, ms = 3800 }: { message: string; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
  }, [message, onDone, ms])
  return (
    <div role="status" aria-live="polite" className="wof-toast" style={{
      position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 60,
      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px 11px 14px',
      borderRadius: RAD.pill, background: C.ink, color: C.surface,
      boxShadow: '0 16px 40px rgba(15,23,42,.28)', fontSize: F.small, fontWeight: W.semi,
      maxWidth: 'calc(100vw - 32px)',
    }}>
      <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                     background: C.positive, color: C.surface, flexShrink: 0 }}>
        <Icon name="check" size={13} stroke={3} />
      </span>
      <span style={{ minWidth: 0 }}>{message}</span>
      <button type="button" onClick={onDone} aria-label="Dismiss" className="wof-btn"
        style={{ border: 'none', background: 'transparent', color: 'inherit', opacity: .7,
                 cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={13} stroke={2.4} />
      </button>
    </div>
  )
}

/** Jump links to the page's sections. Only shown on narrow screens, where
 *  the rail has dropped far below the feed. */
export function JumpBar({ items }: { items: { href: string; label: string; icon: IconName }[] }) {
  return (
    <nav aria-label="Sections" className="wof-jump" style={{
      position: 'sticky', top: 8, zIndex: 15, gap: 6, overflowX: 'auto', padding: 5,
      borderRadius: RAD.pill, background: C.surface, border: `1px solid ${C.line}`,
      boxShadow: '0 6px 18px rgba(15,23,42,.08)', scrollbarWidth: 'none',
    }}>
      {items.map(i => (
        <a key={i.href} href={i.href} className="wof-btn wof-btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                   borderRadius: RAD.pill, fontSize: F.micro, fontWeight: W.semi, color: C.inkSoft,
                   textDecoration: 'none', whiteSpace: 'nowrap' }}>
          <Icon name={i.icon} size={13} />{i.label}
        </a>
      ))}
    </nav>
  )
}

/** Filter chips with counts. */
export function FilterChips<T extends string>({ options, value, onPick, label }: {
  options: { k: T; label: string; count: number }[]; value: T; onPick: (k: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o.k === value
        return (
          <button key={o.k} type="button" aria-pressed={on} onClick={() => onPick(o.k)}
            className="wof-tile"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                     fontFamily: 'inherit', padding: '5px 6px 5px 12px', borderRadius: RAD.pill,
                     fontSize: F.micro, fontWeight: W.semi,
                     border: `1px solid ${on ? C.ink : C.line}`,
                     background: on ? C.ink : C.surface, color: on ? C.surface : C.inkSoft }}>
            {o.label}
            <span style={{ minWidth: 20, padding: '1px 6px', borderRadius: RAD.pill, fontSize: 11,
                           fontWeight: W.bold, textAlign: 'center',
                           background: on ? mix(C.surface, 22) : C.sunken,
                           color: on ? C.surface : C.muted }}>{o.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A quiet label that separates groups in a list. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 2px' }}>
      <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  )
}
