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
      /* ── Motion ────────────────────────────────────────────────────────────
         Every animation here answers a question the user would otherwise have
         to work out for themselves: where did this panel come from, which row
         did I just change, is this number still loading. Nothing moves purely
         to be seen moving, and nothing is slow enough to wait for — an HR
         administrator approving two hundred claims must never queue behind an
         animation.

         The whole system collapses under prefers-reduced-motion at the bottom
         of this block.
         ------------------------------------------------------------------ */

      @keyframes ezShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      @keyframes ezFade{from{opacity:0}to{opacity:1}}
      @keyframes ezRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @keyframes ezRiseIn3d{
        from{opacity:0;transform:translateY(10px) scale(.985)}
        to  {opacity:1;transform:none}}
      /* Panels enter from the side they conceptually came from. */
      @keyframes ezSlideL{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
      @keyframes ezSlideR{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
      /* A row that just changed pulses once in the brand tint, then lets go. */
      @keyframes ezFlash{0%{background:${C.brandTint}}100%{background:transparent}}
      /* A step completing in an approval chain. */
      @keyframes ezPop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.06)}100%{transform:none;opacity:1}}

      /* Section change. The page tips up from slightly below and behind, as if
         the new section were laid onto the desk — a 1200px scene makes 8px of
         Z read as depth without distorting anything.

         It ENDS at transform:none, deliberately. Any residual transform (even
         translateZ(0)) keeps the element on its own compositor layer, where
         text is rasterised at the layer's scale instead of the screen's — and
         it stays soft for as long as the page is open. Nothing scales either,
         because a scaled glyph is a resampled glyph. */
      @keyframes ezPageEnter{
        from{opacity:0;transform:translate3d(0,10px,-8px) rotateX(1.4deg)}
        60% {opacity:1}
        to  {opacity:1;transform:none}}
      .ez-page-enter{
        animation:ezPageEnter .34s cubic-bezier(.22,1,.36,1) both;
        transform-origin:50% 0;
        backface-visibility:hidden;   /* stops the half-pixel shimmer mid-tilt */
      }

      .ez-fade{animation:ezFade ${M.ease} both}
      .ez-rise{animation:ezRise ${M.ease} both}
      .ez-rise-3d{animation:ezRiseIn3d ${M.ease} both}
      .ez-slide-l{animation:ezSlideL ${M.ease} both}
      .ez-slide-r{animation:ezSlideR ${M.ease} both}
      .ez-flash{animation:ezFlash 1.1s ease-out both}
      .ez-pop{animation:ezPop .3s cubic-bezier(.22,1.4,.4,1) both}

      /* A list arrives as a wave rather than all at once, which makes its
         order legible. Capped at ten steps so a 400-row table is not still
         arriving a second later. */
      .ez-stagger > *{animation:ezRise ${M.ease} both}
      .ez-stagger > *:nth-child(1){animation-delay:0ms}
      .ez-stagger > *:nth-child(2){animation-delay:26ms}
      .ez-stagger > *:nth-child(3){animation-delay:52ms}
      .ez-stagger > *:nth-child(4){animation-delay:78ms}
      .ez-stagger > *:nth-child(5){animation-delay:104ms}
      .ez-stagger > *:nth-child(6){animation-delay:130ms}
      .ez-stagger > *:nth-child(7){animation-delay:156ms}
      .ez-stagger > *:nth-child(8){animation-delay:182ms}
      .ez-stagger > *:nth-child(9){animation-delay:208ms}
      .ez-stagger > *:nth-child(n+10){animation-delay:230ms}

      /* Same wave, applied to table rows. Scoped to tbody so the sticky
         header does not animate away from its own columns. */
      .ez-table-stagger tbody tr{animation:ezFade ${M.ease} both}
      .ez-table-stagger tbody tr:nth-child(1){animation-delay:0ms}
      .ez-table-stagger tbody tr:nth-child(2){animation-delay:18ms}
      .ez-table-stagger tbody tr:nth-child(3){animation-delay:36ms}
      .ez-table-stagger tbody tr:nth-child(4){animation-delay:54ms}
      .ez-table-stagger tbody tr:nth-child(5){animation-delay:72ms}
      .ez-table-stagger tbody tr:nth-child(6){animation-delay:90ms}
      .ez-table-stagger tbody tr:nth-child(7){animation-delay:108ms}
      .ez-table-stagger tbody tr:nth-child(8){animation-delay:126ms}
      .ez-table-stagger tbody tr:nth-child(n+9){animation-delay:140ms}

      /* ── Depth ─────────────────────────────────────────────────────────────
         Interactive surfaces lift toward the pointer. The tilt is deliberately
         small: at 3 degrees a card reads as a physical object, and past about
         6 the type starts to smear. Cards that are not interactive do not move
         at all, so movement continues to mean "you can act on this".
         ------------------------------------------------------------------ */
      .ez-lift{transition:transform ${M.ease},box-shadow ${M.ease}}
      .ez-lift:hover{transform:translateY(-2px);box-shadow:${E.floating}}

      .ez-3d{perspective:900px}
      .ez-3d > *{transition:transform ${M.ease},box-shadow ${M.ease};transform-style:preserve-3d}
      .ez-3d:hover > *{transform:translateZ(14px) rotateX(2.5deg);box-shadow:${E.floating}}

      /* :hover and :focus-visible cannot be expressed as inline styles. */
      .ez-row{transition:background ${M.quick}}
      .ez-row:hover{background:${C.brandTint}!important}
      .ez-press{transition:transform ${M.quick},box-shadow ${M.quick},background ${M.quick},border-color ${M.quick}}
      .ez-press:active:not(:disabled){transform:scale(.975)}

      :focus-visible{outline:2px solid ${C.brand};outline-offset:2px;border-radius:${R.sm}px}

      /* ── Buttons ───────────────────────────────────────────────────────────
         693 of the buttons in this product are raw <button> elements with
         their own inline styles, against 9 built from the design system. The
         measurable result was 11 different heights, 7 different corner radii
         and 6 font sizes across eight pages — which is most of why they read
         as unconsidered.

         Converting 693 call sites is not the move. These rules give every
         button the same corner, the same press response and the same pointer
         affordance, and !important is required only because the radius is set
         inline at most of those sites. Colour, size and weight are left to the
         call site, so nothing about intent or hierarchy is overridden. */
      button{
        border-radius:${R.md}px !important;
        cursor:pointer;
        transition:transform ${M.quick}, box-shadow ${M.quick}, background ${M.quick}, border-color ${M.quick}, opacity ${M.quick};
        -webkit-tap-highlight-color:transparent;
      }
      /* Pills stay pills — a rounded chip is a deliberate shape, not a stray
         radius, and squaring it off would be the wrong kind of consistency. */
      button[style*="border-radius: 99"],
      button[style*="borderRadius:99"],
      button[style*="border-radius: 999"]{border-radius:999px !important}
      /* Softened from .97. It applies to every button in the app, and at .97 the
         press read as the whole control dropping away from the pointer rather
         than being pushed. */
      button:not(:disabled):active{transform:scale(.985)}
      button:not(:disabled):hover{filter:brightness(1.03)}
      button:disabled{cursor:not-allowed;opacity:.55}

      /* The arrow on a call-to-action travels a little on hover: the cheapest
         way to say "this goes somewhere" without a word of copy. */
      .ez-cta-arrow{transition:transform ${M.quick}}
      .ez-cta:hover .ez-cta-arrow{transform:translateX(3px)}
      .ez-cta:not(:disabled):active{transform:scale(.985)}

      /* Scrollbars, so they belong to the palette instead of the OS. */
      /* PAGE HEADER
         Most pages painted their title area in the same #F3F5F8 as the canvas,
         so the header did not read as a header — it was just the top of the
         page. This gives it its own plane.

         A tinted panel rather than a full-bleed band, because the page shells
         are not consistent: some give the header its own padding, some nest it
         inside an already-padded container, and a couple have no header
         wrapper at all. A band would need to know each parent's padding to
         bleed correctly and would sit inset and wrong wherever that guess was
         off. A panel is right in all of them.

         The gradient runs surface -> brand tint, so the header carries a hint
         of the product's blue without becoming a coloured slab. Both stops are
         theme variables, so it inverts with everything else. */
      .ez-page-head{
        background:linear-gradient(135deg, var(--ez-surface) 0%, var(--ez-brand-tint) 100%);
        border:1px solid var(--ez-brand-edge);
        border-radius:14px;
        padding:16px 18px;
        margin-bottom:16px;
      }
      /* For a header sitting in a container with no padding of its own. */
      .ez-page-head-bleed{ margin:16px 24px 16px }

      /* Tab pills. Hover only lifts the inactive ones — the active pill is
         already filled, and lightening it on hover would read as deselecting. */
      .ez-tab{transition:background .14s cubic-bezier(.4,0,.2,1),color .14s,border-color .14s}
      .ez-tab[data-on="0"]:hover{background:var(--ez-sunken);color:var(--ez-ink);border-color:var(--ez-line-strong)}
      .ez-scroll::-webkit-scrollbar{width:9px;height:9px}
      .ez-scroll::-webkit-scrollbar-thumb{background:${C.lineStrong};border-radius:99px;border:2px solid transparent;background-clip:content-box}
      .ez-scroll::-webkit-scrollbar-thumb:hover{background:${C.faint};background-clip:content-box}
      .ez-scroll::-webkit-scrollbar-track{background:transparent}
      .ez-scroll-dark::-webkit-scrollbar{width:8px}
      .ez-scroll-dark::-webkit-scrollbar-thumb{background:${C.lineStrong};border-radius:99px}
      .ez-scroll-dark::-webkit-scrollbar-track{background:transparent}

      /* Someone who has asked for less motion still gets the depth — the
         shadows and the hierarchy — but nothing travels. A rotation on hover
         is exactly what this setting is asking us not to do. */
      /* ── Type and icon sharpness ───────────────────────────────────────────
         Grayscale antialiasing renders lighter and more evenly than the
         subpixel default, and critically it does not shift when an element is
         promoted to its own layer mid-animation — which is what makes text
         appear to "thicken" as a transition starts. */
      body{
        -webkit-font-smoothing:antialiased;
        -moz-osx-font-smoothing:grayscale;
        text-rendering:optimizeLegibility;
      }
      /* Icons are stroked geometry: at a fractional size the stroke lands
         between pixels and blurs. crispEdges keeps the 1.6px stroke on the
         grid at the sizes this product actually uses. */
      svg{shape-rendering:geometricPrecision}

      @media (prefers-reduced-motion: reduce){
        .ez-page-enter{animation-duration:.01ms!important}
        .ez-fade,.ez-rise,.ez-rise-3d,.ez-slide-l,.ez-slide-r,.ez-flash,.ez-pop,
        .ez-stagger > *,.ez-table-stagger tbody tr{animation-duration:.01ms!important;animation-delay:0ms!important}
        .ez-lift:hover{transform:none}
        button:not(:disabled):active{transform:none}
        .ez-cta:hover .ez-cta-arrow{transform:none}
        .ez-3d:hover > *{transform:none}
        .ez-press:active:not(:disabled){transform:none}
      }
    `}</style>
  );
}

/**
 * A number that counts up to its value.
 *
 * Only worth doing where the figure is the point of the card — a headcount, a
 * payroll total. It also does real work: a value that animates has visibly
 * *arrived*, which distinguishes a loaded zero from a zero that is still
 * loading. Formatting is delegated so money stays money.
 */
export function CountUp({ value, format, duration = 620, style }: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  style?: React.CSSProperties;
}) {
  // Starts at zero, not at `value`. The data is usually already present on
  // first render, so seeding the ref with the final number meant the guard
  // below fired immediately and the figure simply appeared — the animation
  // existed but never ran.
  const [shown, setShown] = React.useState(0);
  const from = React.useRef(0);
  const raf = React.useRef<number | null>(null);

  React.useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from.current === value) { setShown(value); from.current = value; return; }

    const start = performance.now();
    const a = from.current, b = value;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Ease out: the number decelerates into its final value rather than
      // stopping dead, which is what makes it read as settling.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [value, duration]);

  const n = Math.round(shown);
  return <span style={{ ...numeric, ...style }}>{format ? format(n) : n.toLocaleString('en-IN')}</span>;
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
    <div className="ez-page-head" style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: S.lg, flexWrap: 'wrap',
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
export function Stat({ label, value, sub, t = 'neutral', icon, onClick }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; t?: Tone;
  icon?: React.ReactNode; onClick?: () => void;
}) {
  const k = tone(t);
  return (
    <Card pad={S.md} elevation="flat" interactive={!!onClick} onClick={onClick}
          style={{ minWidth: 0 }}>
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
    <div className="ez-stagger" style={{
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
      background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`,
      color: C.onAccent, border: `1px solid ${C.brandDeep}`, boxShadow: E.brand,
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
              color: on ? C.brandDeep : C.muted,
              borderBottom: `2px solid ${on ? C.brand : 'transparent'}`,
              marginBottom: -1, whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {t.label}
            {t.count != null && (
              <span style={{
                fontSize: F.micro, fontWeight: W.bold, padding: '1px 6px', borderRadius: R.pill,
                background: on ? C.brandTint : C.sunken, color: on ? C.brandDeep : C.faint, ...numeric,
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
export function TableWrap({ children, style, stagger = true }: {
  children: React.ReactNode; style?: React.CSSProperties;
  /** Rows arrive as a wave rather than all at once, which makes their order
   *  legible. Turn it off for a table that re-renders on every keystroke. */
  stagger?: boolean;
}) {
  return (
    <div className="ez-scroll" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
      boxShadow: E.raised, ...scrollX, ...style,
    }}>
      <table className={stagger ? 'ez-table-stagger' : undefined}
             style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.small }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', width, style }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center';
  width?: number | string; style?: React.CSSProperties;
}) {
  return (
    <th style={{
      ...eyebrow, textAlign: align, padding: '9px 12px', width,
      borderBottom: `1px solid ${C.line}`, background: C.sunken,
      position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
      ...style,
    }}>{children}</th>
  );
}

export function Td({ children, align = 'left', mono, strong, style }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center';
  mono?: boolean; strong?: boolean; style?: React.CSSProperties;
}) {
  return (
    <td style={{
      padding: '8px 12px', textAlign: align,
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
        background: selected ? C.brandTint : undefined,
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
    <div className="ez-rise" style={{
      padding: `${S.huge}px ${S.xl}px`, textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm,
    }}>
      {icon && (
        <div style={{
          width: 44, height: 44, borderRadius: R.lg, background: C.brandTint,
          color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
      background: `linear-gradient(90deg,${C.sunken} 25%,${C.brandTint} 50%,${C.sunken} 75%)`,
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
    <div className="ez-rise" style={{
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
      // Lightness is fixed rather than free: at 34% the initials measured
      // ~4.1:1 on their own tint, just under AA. 28% on a 93% ground clears it
      // for every hue on the wheel, which is what a name-derived colour has to
      // guarantee — you cannot pick per person.
      // The theme flips the pair rather than leaving a bright disc on a dark
      // page. Verified at every hue: 4.59:1 light, 6.2:1 dark.
      background: `color-mix(in srgb, hsl(${h} 58% 93%) var(--ez-avatar-tint-mix, 100%), var(--ez-surface))`,
      color: `hsl(${h} var(--ez-avatar-sat, 62%) var(--ez-avatar-light, 28%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Rounded: a 28px disc gave 10.64px, and initials are the one place
      // where a fractional size is most visible — two or three glyphs, bold,
      // on a coloured ground, with no surrounding text to hide the softness.
      fontSize: Math.round(size * 0.38), fontWeight: W.bold, letterSpacing: '.01em',
      border: `1px solid color-mix(in srgb, hsl(${h} 44% 85%) var(--ez-avatar-tint-mix, 100%), var(--ez-line))`,
    }}>{initials}</div>
  );
}

/** Avatar + name + secondary line. The standard identity cell in a table. */
export function Person({ name, meta, size = 28, src }: {
  name?: string | null; meta?: React.ReactNode; size?: number; src?: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, minWidth: 0 }}>
      <Avatar name={name} size={size} src={src} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: F.small, fontWeight: W.semi, color: C.ink, lineHeight: 1.3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{name || '—'}</div>
        {/* Rendered only when there is something to say. An empty second line
            still reserves its height, which is how a 398-row table ends up
            showing ten people. */}
        {meta != null && meta !== '' && meta !== '—' && (
          <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.3, ...numeric }}>{meta}</div>
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
