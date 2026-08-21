'use client';
// lib/ui/index.tsx — EZER interface primitives.
//
// The pieces every screen in this product actually needs. An HRMS is mostly
// tables of people, sums of money, and states a record can be in — so those
// are what is built here, rather than a generic widget library.
//
// Two rules hold throughout:
//   * every colour, size and shadow comes from tokens.ts — no local hex
//   * every component is declared at module top level, never nested inside
//     another component (nesting remounts on each render and drops focus mid-
//     typing, a bug this codebase has hit before)
//
// Import as:  import { Card, PageHeader, Button } from '@/lib/ui'

import * as React from 'react';
import { C, F, W, S, R, E, M, tone, numeric, eyebrow, scrollX, type Tone } from './tokens';

export * from './tokens';
export * from './icons';

// ---------------------------------------------------------------------------
// KEYFRAMES
// One <style> for the handful of animations the system uses. Mounted once by
// AppFrame; anything relying on these classes must sit inside it.
// ---------------------------------------------------------------------------

export function UIKeyframes() {
  return (
    <style>{`
      @keyframes ezShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      @keyframes ezRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes ezFade{from{opacity:0}to{opacity:1}}
      .ez-rise{animation:ezRise ${M.ease} both}
      .ez-fade{animation:ezFade ${M.ease} both}

      /* :hover and :focus-visible cannot be expressed as inline styles, so the
         handful of states that need them live here. */
      .ez-row:hover{background:${C.violetTint}!important}
      .ez-press{transition:transform ${M.quick},box-shadow ${M.quick},background ${M.quick},border-color ${M.quick}}
      .ez-press:active:not(:disabled){transform:scale(.975)}
      .ez-lift{transition:transform ${M.ease},box-shadow ${M.ease}}
      .ez-lift:hover{transform:translateY(-2px);box-shadow:${E.floating}}

      :focus-visible{outline:2px solid ${C.violet};outline-offset:2px;border-radius:${R.sm}px}

      /* Scrollbars, so they belong to the palette instead of the OS. */
      .ez-scroll::-webkit-scrollbar{width:9px;height:9px}
      .ez-scroll::-webkit-scrollbar-thumb{background:${C.lineStrong};border-radius:99px;border:2px solid transparent;background-clip:content-box}
      .ez-scroll::-webkit-scrollbar-thumb:hover{background:${C.faint};background-clip:content-box}
      .ez-scroll::-webkit-scrollbar-track{background:transparent}
      .ez-scroll-dark::-webkit-scrollbar{width:8px}
      .ez-scroll-dark::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px}
      .ez-scroll-dark::-webkit-scrollbar-track{background:transparent}

      @media (prefers-reduced-motion: reduce){
        .ez-rise,.ez-fade{animation-duration:.01ms!important}
        .ez-lift:hover{transform:none}
        .ez-press:active:not(:disabled){transform:none}
      }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// PAGE SCAFFOLD
// ---------------------------------------------------------------------------

/** The padded column every dashboard page lives in. */
export function Page({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: `${S.xl}px ${S.xl}px ${S.huge}px`,
      maxWidth: 1440, margin: '0 auto',
      fontFamily: F.family, color: C.ink, fontSize: F.body,
      ...style,
    }}>{children}</div>
  );
}

/**
 * The heading block. Title, an optional line of context beneath it, and actions
 * pinned right.
 *
 * `context` is for the facts that qualify the title — "March 2026 · 398
 * employees" — because a heading alone rarely tells someone whether they are
 * looking at the right thing.
 */
export function PageHeader({ title, context, actions, back }: {
  title: string;
  context?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: S.lg, flexWrap: 'wrap', marginBottom: S.xl,
    }}>
      <div style={{ minWidth: 0 }}>
        {back}
        <h1 style={{
          margin: 0, fontSize: F.page, fontWeight: W.bold, color: C.ink,
          letterSpacing: '-.02em', textWrap: 'balance',
        }}>{title}</h1>
        {context != null && (
          <div style={{ marginTop: 5, fontSize: F.small, color: C.muted, ...numeric }}>
            {context}
          </div>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** A labelled band within a page. */
export function Section({ title, hint, actions, children, style }: {
  title?: string; hint?: string; actions?: React.ReactNode;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{ marginBottom: S.xl, ...style }}>
      {(title || actions) && (
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: S.md, marginBottom: S.md, flexWrap: 'wrap',
        }}>
          <div>
            {title && <h2 style={{ margin: 0, fontSize: F.title, fontWeight: W.semi, color: C.ink, letterSpacing: '-.01em' }}>{title}</h2>}
            {hint && <div style={{ marginTop: 3, fontSize: F.small, color: C.muted }}>{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SURFACES
// ---------------------------------------------------------------------------

export function Card({ children, pad = S.lg, elevation = 'raised', interactive, style, onClick, className }: {
  children: React.ReactNode;
  pad?: number;
  elevation?: keyof typeof E;
  interactive?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
  /** Extra class, for the entrance animations in UIKeyframes. */
  className?: string;
}) {
  return (
    <div
      className={[interactive ? 'ez-lift' : '', className || ''].filter(Boolean).join(' ') || undefined}
      onClick={onClick}
      style={{
        background: C.surface, border: `1px solid ${C.line}`,
        borderRadius: R.lg, padding: pad, boxShadow: E[elevation],
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >{children}</div>
  );
}

/**
 * A single figure with its label. The workhorse of an HRMS summary row.
 *
 * The label sits *above* the value: eyes land on the number first and the label
 * only qualifies it. Values are tabular so a row of tiles lines up.
 */
export function Stat({ label, value, sub, t = 'neutral', icon }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; t?: Tone; icon?: React.ReactNode;
}) {
  const k = tone(t);
  return (
    <Card pad={S.md} elevation="flat" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.sm }}>
        <div style={{ minWidth: 0 }}>
          {/* Reserve two lines. "Active" is one line and "Total Employees" is
              two, and without this the numbers beneath them sit at different
              heights — which is exactly what the eye picks up when scanning a
              row of tiles. */}
          <div style={{ ...eyebrow, marginBottom: 6, lineHeight: 1.3, minHeight: 27 }}>{label}</div>
          <div style={{
            fontSize: F.display, fontWeight: W.bold, lineHeight: 1.05,
            color: t === 'neutral' ? C.ink : k.fg, letterSpacing: '-.02em', ...numeric,
          }}>{value}</div>
          {sub != null && (
            <div style={{ marginTop: 5, fontSize: F.tiny, color: C.muted, ...numeric }}>{sub}</div>
          )}
        </div>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: R.md, flexShrink: 0,
            background: k.bg, color: k.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</div>
        )}
      </div>
    </Card>
  );
}

/** Responsive tile row. Collapses to fewer columns without a media query. */
/**
 * Responsive tile row.
 *
 * The 150px floor is measured, not guessed: at the dashboard's real content
 * width a 168px floor yields four columns and strands a fifth tile on its own
 * row, while 150px fits all five. Tiles still reflow to fewer columns as the
 * viewport narrows.
 */
export function StatRow({ children, min = 150 }: { children: React.ReactNode; min?: number }) {
  return (
    <div style={{
      display: 'grid', gap: S.md, marginBottom: S.xl,
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      alignItems: 'stretch',
    }}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// CONTROLS
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children, onClick, variant = 'secondary', size = 'md', icon, disabled, type = 'button', title, style, full,
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  style?: React.CSSProperties;
  full?: boolean;
}) {
  const dims = {
    sm: { h: 30, px: 11, fs: F.tiny },
    md: { h: 36, px: 14, fs: F.small },
    lg: { h: 44, px: 20, fs: F.body },
  }[size];

  const skin: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: `linear-gradient(180deg, ${C.violet}, ${C.violetDeep})`,
      color: '#fff', border: `1px solid ${C.violetDeep}`, boxShadow: E.violet,
    },
    secondary: {
      background: C.surface, color: C.ink,
      border: `1px solid ${C.lineStrong}`, boxShadow: E.flat,
    },
    ghost: { background: 'transparent', color: C.muted, border: '1px solid transparent' },
    danger: {
      background: C.surface, color: C.critical,
      border: `1px solid ${tone('critical').edge}`, boxShadow: E.flat,
    },
  };

  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title} className="ez-press"
      style={{
        height: dims.h, padding: `0 ${dims.px}px`, fontSize: dims.fs,
        fontWeight: W.semi, fontFamily: 'inherit', borderRadius: R.md,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, whiteSpace: 'nowrap', width: full ? '100%' : undefined,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? .5 : 1,
        ...skin[variant], ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A record's state, as a chip.
 *
 * Colour is never the only signal — the label always says the state in words,
 * so it survives greyscale printing and colour blindness alike. That matters
 * here: these chips carry payroll and compliance status.
 */
export function Badge({ children, t = 'neutral', dot, size = 'md' }: {
  children: React.ReactNode; t?: Tone; dot?: boolean; size?: 'sm' | 'md';
}) {
  const k = tone(t);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: size === 'sm' ? '2px 7px' : '3px 9px',
      borderRadius: R.pill, background: k.bg, color: k.fg,
      border: `1px solid ${k.edge}`,
      fontSize: size === 'sm' ? F.micro : F.tiny,
      fontWeight: W.semi, whiteSpace: 'nowrap', lineHeight: 1.5,
    }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: k.fg, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

/** Label + control + optional hint or error, spaced consistently. */
export function Field({ label, hint, error, required, children }: {
  label?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      {label && (
        <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft, marginBottom: 5 }}>
          {label}{required && <span style={{ color: C.critical, marginLeft: 3 }}>*</span>}
        </div>
      )}
      {children}
      {(error || hint) && (
        <div style={{ marginTop: 5, fontSize: F.tiny, color: error ? C.critical : C.muted }}>
          {error || hint}
        </div>
      )}
    </label>
  );
}

/** Shared input skin. Spread onto <input>, <select> or <textarea>. */
export const inputStyle = (invalid?: boolean): React.CSSProperties => ({
  width: '100%', height: 36, padding: '0 11px', boxSizing: 'border-box',
  fontSize: F.small, fontFamily: F.family, color: C.ink,
  background: C.surface, borderRadius: R.md,
  border: `1px solid ${invalid ? tone('critical').edge : C.lineStrong}`,
  outline: 'none', transition: `border-color ${M.quick}, box-shadow ${M.quick}`,
});

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return <input {...rest} style={{ ...inputStyle(invalid), ...style }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const { invalid, style, children, ...rest } = props;
  return (
    <select {...rest} style={{ ...inputStyle(invalid), cursor: 'pointer', ...style }}>
      {children}
    </select>
  );
}

/** Horizontal tabs. The underline is the selected state; colour reinforces it. */
export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="ez-scroll" style={{
      display: 'flex', gap: 2, borderBottom: `1px solid ${C.line}`,
      marginBottom: S.lg, ...scrollX,
    }}>
      {tabs.map(t => {
        const on = t.key === value;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} className="ez-press"
            style={{
              padding: '9px 14px', border: 'none', background: 'transparent',
              fontFamily: 'inherit', fontSize: F.small, cursor: 'pointer',
              fontWeight: on ? W.semi : W.medium,
              color: on ? C.violetDeep : C.muted,
              borderBottom: `2px solid ${on ? C.violet : 'transparent'}`,
              marginBottom: -1, whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {t.label}
            {t.count != null && (
              <span style={{
                fontSize: F.micro, fontWeight: W.bold, padding: '1px 6px', borderRadius: R.pill,
                background: on ? C.violetTint : C.sunken, color: on ? C.violetDeep : C.faint, ...numeric,
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TABLES — the bulk of an HRMS
// ---------------------------------------------------------------------------

/** Table in a card, scrolling horizontally inside its own bounds. */
export function TableWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="ez-scroll" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
      boxShadow: E.raised, ...scrollX, ...style,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.small }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', width }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; width?: number | string;
}) {
  return (
    <th style={{
      ...eyebrow, textAlign: align, padding: '11px 14px', width,
      borderBottom: `1px solid ${C.line}`, background: C.sunken,
      position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

export function Td({ children, align = 'left', mono, strong, style }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center';
  mono?: boolean; strong?: boolean; style?: React.CSSProperties;
}) {
  return (
    <td style={{
      padding: '11px 14px', textAlign: align,
      borderBottom: `1px solid ${C.line}`,
      color: strong ? C.ink : C.inkSoft,
      fontWeight: strong ? W.semi : W.regular,
      ...(mono || align === 'right' ? numeric : null),
      ...style,
    }}>{children}</td>
  );
}

export function Tr({ children, onClick, selected }: {
  children: React.ReactNode; onClick?: () => void; selected?: boolean;
}) {
  return (
    <tr className={onClick ? 'ez-row' : undefined} onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        background: selected ? C.violetTint : undefined,
        transition: `background ${M.quick}`,
      }}>{children}</tr>
  );
}

// ---------------------------------------------------------------------------
// STATES — what a screen shows when it has nothing, or is still fetching
// ---------------------------------------------------------------------------

/**
 * Empty state. `title` says what is missing and `hint` says how to change that
 * — an empty table with no explanation is indistinguishable from a broken one.
 */
export function Empty({ title, hint, action, icon }: {
  title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: `${S.huge}px ${S.xl}px`, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm,
    }}>
      {icon && (
        <div style={{
          width: 44, height: 44, borderRadius: R.lg, background: C.violetTint,
          color: C.violet, display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 2,
        }}>{icon}</div>
      )}
      <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink }}>{title}</div>
      {hint && <div style={{ fontSize: F.small, color: C.muted, maxWidth: 380, lineHeight: 1.55 }}>{hint}</div>}
      {action && <div style={{ marginTop: S.sm }}>{action}</div>}
    </div>
  );
}

/** Loading placeholder shaped like the content it replaces. */
export function Skeleton({ w = '100%', h = 14, r = R.sm, style }: {
  w?: number | string; h?: number; r?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: `linear-gradient(90deg,${C.sunken} 25%,${C.violetTint} 50%,${C.sunken} 75%)`,
      backgroundSize: '200% 100%', animation: 'ezShimmer 1.2s infinite',
      ...style,
    }} />
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.md, padding: S.lg }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: S.md, alignItems: 'center' }}>
          <Skeleton w={32} h={32} r={R.md} />
          <Skeleton w={`${38 + ((i * 13) % 34)}%`} />
          <Skeleton w={70} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

/**
 * An inline problem message. Says what went wrong; the caller supplies a retry
 * where one is possible. Never apologises, never hides the cause.
 */
export function Notice({ children, t = 'critical', title, action }: {
  children?: React.ReactNode; t?: Tone; title?: string; action?: React.ReactNode;
}) {
  const k = tone(t);
  return (
    <div style={{
      display: 'flex', gap: S.md, alignItems: 'flex-start',
      background: k.bg, border: `1px solid ${k.edge}`, borderRadius: R.md,
      padding: `${S.md}px ${S.lg}px`, marginBottom: S.lg,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontSize: F.small, fontWeight: W.semi, color: k.fg, marginBottom: 2 }}>{title}</div>}
        {children && <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PEOPLE — an HRMS shows the same person object on nearly every screen
// ---------------------------------------------------------------------------

/** Initials avatar. Colour is derived from the name, so it is stable per person. */
export function Avatar({ name, size = 32, src }: { name?: string | null; size?: number; src?: string | null }) {
  const initials = (name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  // Deterministic hue: the same person keeps the same colour across screens.
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + (name || '').charCodeAt(i)) % 360;
  return src ? (
    <img src={src} alt="" width={size} height={size}
      style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.line}` }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `hsl(${h} 62% 94%)`, color: `hsl(${h} 54% 34%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: W.bold, letterSpacing: '.01em',
      border: `1px solid hsl(${h} 46% 87%)`,
    }}>{initials}</div>
  );
}

/** Avatar + name + secondary line. The standard identity cell in a table. */
export function Person({ name, meta, size = 32, src }: {
  name?: string | null; meta?: React.ReactNode; size?: number; src?: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, minWidth: 0 }}>
      <Avatar name={name} size={size} src={src} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: F.small, fontWeight: W.semi, color: C.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{name || '—'}</div>
        {meta != null && (
          <div style={{ fontSize: F.micro, color: C.muted, ...numeric }}>{meta}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MONEY — payroll, claims and loans all render amounts; they should agree
// ---------------------------------------------------------------------------

/**
 * Indian-format currency. Groups by lakh/crore (12,34,567) because that is how
 * every number in this product is read by the people using it.
 */
export function money(n: number | null | undefined, opts?: { paise?: boolean; symbol?: boolean }): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: opts?.paise ? 2 : 0,
    maximumFractionDigits: opts?.paise ? 2 : 0,
  }).format(n);
  return opts?.symbol === false ? s : `₹${s}`;
}

/** Compact form for headline figures: ₹4.2 Cr, ₹12.5 L. */
export function moneyShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return money(n);
}

export function Money({ value, short, t }: { value: number | null | undefined; short?: boolean; t?: Tone }) {
  return (
    <span style={{ ...numeric, fontWeight: W.semi, color: t ? tone(t).fg : C.ink }}>
      {short ? moneyShort(value) : money(value)}
    </span>
  );
}
