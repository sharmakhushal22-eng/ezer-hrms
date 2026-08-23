// lib/ui/tokens.ts — the EZER design system.
//
// WHY THIS FILE EXISTS
//
// Before this, 223 distinct hex colours were hardcoded across 84+ files. The
// brand purple alone appeared 375 times, flat grey #6B7280 231 times. Nothing
// could be adjusted centrally, so every screen drifted a little further from
// every other screen.
//
// Everything visual now comes from here. Changing a value in this file changes
// it everywhere, which is the whole point.
//
// HOUSE RULES THIS RESPECTS
//   * inline style objects only — no Tailwind, no CSS modules, no CSS variables
//   * plain TypeScript objects, so autocomplete works and typos are caught
//
// THE DIRECTION
//
// EZER's violet identity is kept; the execution is rebuilt. The greys are
// biased toward violet rather than flat neutral, so surfaces read as belonging
// to one family instead of "purple accents sitting on generic grey chrome".
// That single change does more for coherence than any amount of decoration.

// ---------------------------------------------------------------------------
// COLOUR
// ---------------------------------------------------------------------------

/**
 * Colour.
 *
 * Every value is a reference into lib/ui/theme.css rather than a literal, so
 * `background: C.surface` emits `background: var(--ez-surface)` and one
 * attribute on <html> repaints the entire product. That is what makes a dark
 * theme possible across 88 files of inline styles without editing any of them.
 *
 * The consequence to know about: these are no longer hex strings. Do not
 * concatenate an alpha suffix onto one (`C.brand + '20'` will not work) — use
 * a tint token, or colour-mix, instead.
 */
export const C = {
  /** Primary text. */
  ink: 'var(--ez-ink)',
  /** Secondary text — a heading's supporting line, table sub-values. */
  inkSoft: 'var(--ez-ink-soft)',
  /** Body and label text. Warm-biased, not a flat neutral grey. */
  muted: 'var(--ez-muted)',
  /** Placeholder, disabled, and the quietest metadata. */
  faint: 'var(--ez-faint)',

  /** The brand. Emerald — primary actions, active navigation, links. */
  brand: 'var(--ez-brand)',
  /** Pressed states and gradient ends. */
  brandDeep: 'var(--ez-brand-deep)',
  /** Hover wash and selected rows. */
  brandTint: 'var(--ez-brand-tint)',
  /** Borders on tinted surfaces. */
  brandEdge: 'var(--ez-brand-edge)',
  /**
   * Text and icons sitting ON a saturated accent fill — a primary button, a
   * filled badge. White in light; near-black in dark, because every accent
   * lightens there and white on it falls to 2.5:1.
   */
  onAccent: 'var(--ez-on-accent)',
  /** Secondary and tertiary text on an accent fill. */
  onAccentSoft: 'var(--ez-on-accent-soft)',
  onAccentDim: 'var(--ez-on-accent-dim)',

  /** Cards, panels, inputs. */
  surface: 'var(--ez-surface)',
  /** The page behind the cards. */
  canvas: 'var(--ez-canvas)',
  /** Table heads, disabled fields, inset wells. */
  sunken: 'var(--ez-sunken)',

  /** Default hairline. Structure should come from spacing, not rules. */
  line: 'var(--ez-line)',
  /** Where a divider genuinely needs to assert itself. */
  lineStrong: 'var(--ez-line-strong)',

  // State. Green = done, copper = waiting, red = wrong, teal = context.
  // The happy path shares the brand hue on purpose; see theme.css.
  positive: 'var(--ez-positive)',
  positiveTint: 'var(--ez-positive-tint)',
  warning: 'var(--ez-warning)',
  warningTint: 'var(--ez-warning-tint)',
  critical: 'var(--ez-critical)',
  criticalTint: 'var(--ez-critical-tint)',
  info: 'var(--ez-info)',
  infoTint: 'var(--ez-info-tint)',

  /** The navigation rail. White in light, one step above canvas in dark. */
  rail: 'var(--ez-rail)',
  railText: 'var(--ez-rail-text)',
  railMuted: 'var(--ez-rail-muted)',
  railFaint: 'var(--ez-rail-faint)',
  railLine: 'var(--ez-rail-line)',
  railHover: 'var(--ez-rail-hover)',
  railActiveBg: 'var(--ez-rail-active-bg)',
  railActiveText: 'var(--ez-rail-active-text)',

  /** Any surface that is still deliberately inverted. */
  dark: 'var(--ez-dark)',
  darkSoft: 'var(--ez-dark-soft)',
  /** Text and hairlines that sit ON a dark surface. */
  /** Gradient partners for `dark`, so an always-dark plane has depth. */
  darkMid: 'var(--ez-dark-mid)',
  darkAccent: 'var(--ez-dark-accent)',
  onDark: 'var(--ez-on-dark)',
  onDarkMuted: 'var(--ez-on-dark-muted)',
  onDarkFaint: 'var(--ez-on-dark-faint)',
  onDarkLine: 'var(--ez-on-dark-line)',
  onDarkHover: 'var(--ez-on-dark-hover)',
} satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// TYPE
//
// One scale, used everywhere. Sizes are deliberately few — an interface that
// reaches for a new size per screen stops having a hierarchy at all.
// ---------------------------------------------------------------------------

export const F = {
  family: '"DM Sans","Segoe UI",system-ui,sans-serif',
  // Whole pixels, not halves. A 10.5px label multiplied by the app's zoom
  // lands on a fraction twice over; integers survive the quarter-step zoom
  // factors intact, which is a large part of why type reads crisply.
  /** Uppercase eyebrows, table column heads. */
  micro: 11,
  /** Metadata, helper text, chips. */
  tiny: 12,
  /** Dense table cells and secondary controls. */
  small: 13,
  /** Body default. */
  body: 14,
  /** Card titles and emphasised values. */
  lead: 15,
  /** Section headings. */
  title: 18,
  /** Page headings. */
  page: 22,
  /** Hero figures — a payroll total, a headcount. */
  display: 28,
} as const;

export const W = {
  regular: 400,
  medium: 500,
  semi: 600,
  bold: 700,
} as const;

// ---------------------------------------------------------------------------
// SPACE, RADIUS, ELEVATION, MOTION
// ---------------------------------------------------------------------------

/** 4px base. Layout uses flex/grid `gap` from this, never ad-hoc margins. */
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48,
} as const;

export const R = {
  sm: 7, md: 10, lg: 14, xl: 20, pill: 999,
} as const;

/**
 * Two-layer shadows throughout: a tight contact shadow plus a softer cast one.
 * A single blur reads as a glow; two read as height.
 */
export const E = {
  none: 'none',
  flat: 'var(--ez-shadow-flat)',
  raised: 'var(--ez-shadow-raised)',
  floating: 'var(--ez-shadow-floating)',
  overlay: 'var(--ez-shadow-overlay)',
  /** For a brand-coloured element that should glow in its own colour. */
  brand: 'var(--ez-shadow-brand)',
  /** @deprecated old name for `brand`, kept so existing calls still resolve. */
  violet: 'var(--ez-shadow-brand)',
} as const;

export const M = {
  /** Hover, colour change — fast enough to feel instant. */
  quick: '.14s cubic-bezier(.4,0,.2,1)',
  /** Panels, reveals. */
  ease: '.26s cubic-bezier(.22,1,.36,1)',
  /** Layout shifts like the rail opening. */
  slow: '.34s cubic-bezier(.22,1,.36,1)',
} as const;

// ---------------------------------------------------------------------------
// TONES — semantic colour as a set, so a status never half-matches
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'critical' | 'info';

export const tone = (t: Tone): { fg: string; bg: string; edge: string } => ({
  neutral:  { fg: C.muted,     bg: C.sunken,        edge: C.line },
  brand:    { fg: C.brandDeep, bg: C.brandTint,    edge: C.brandEdge },
  positive: { fg: C.positive,  bg: C.positiveTint,  edge: '#C9EADD' },
  warning:  { fg: C.warning,   bg: C.warningTint,   edge: '#F2DFBE' },
  critical: { fg: C.critical,  bg: C.criticalTint,  edge: '#F5CFD1' },
  info:     { fg: C.info,      bg: C.infoTint,      edge: '#CFE0FC' },
}[t]);

// ---------------------------------------------------------------------------
// SHARED STYLE FRAGMENTS
// ---------------------------------------------------------------------------

/** Digits that must line up in a column. Money, counts, dates, durations. */
export const numeric: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

/** Uppercase eyebrow above a section or a table column. */
export const eyebrow: React.CSSProperties = {
  fontSize: F.micro,
  fontWeight: W.bold,
  letterSpacing: '.09em',
  textTransform: 'uppercase',
  // `muted`, not `faint`. These are labels — the word that tells you what a
  // number means — and they were being drawn in the lightest colour in the
  // system at 10.5px, which is where "grey text is not visible" came from.
  color: C.muted,
};

/**
 * Wide content — tables, code, wide charts — scrolls inside its own container.
 * The page body must never scroll sideways.
 */
export const scrollX: React.CSSProperties = {
  overflowX: 'auto',
  WebkitOverflowScrolling: 'touch',
};

/** Visually hidden but still read aloud. */
export const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};
