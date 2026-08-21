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

export const C = {
  /** Primary text. Deeper than the old #1E1B4B for real contrast on white. */
  ink: '#17143B',
  /** Secondary text — headings' supporting line, table sub-values. */
  inkSoft: '#3D3766',

  /**
   * Body and label text. A violet-biased grey, not #6B7280.
   * A pure neutral grey next to violet reads as unconsidered; a grey carrying
   * a little of the accent's hue reads as chosen.
   */
  muted: '#6E6A85',
  /** Placeholder, disabled, and the quietest metadata. */
  faint: '#9A96AD',

  /** The brand. Re-tuned from #7C3AED — slightly deeper, holds white better. */
  violet: '#6D3BEF',
  /** Pressed states, gradient ends, and text on tinted backgrounds. */
  violetDeep: '#5426D9',
  /** Hover wash and selected rows. */
  violetTint: '#F3F0FF',
  /** Borders on tinted surfaces. */
  violetEdge: '#E4DDFB',

  /** Cards, panels, inputs. */
  surface: '#FFFFFF',
  /** The page behind the cards. Violet-biased, not neutral #F5F5F5. */
  canvas: '#F7F5FC',
  /** Table stripes, disabled fields, inset wells. */
  sunken: '#FBFAFE',

  /** Default hairline. Deliberately soft — structure should come from spacing. */
  line: '#E8E4F2',
  /** Where a divider genuinely needs to assert itself. */
  lineStrong: '#D6CFEA',

  // Semantic. Kept separate from the accent on purpose: an HRMS shows money and
  // compliance state, and "good" must never be confused with "branded".
  positive: '#0B7A5B',
  positiveTint: '#E8F7F1',
  warning: '#A9620A',
  warningTint: '#FDF3E3',
  critical: '#C42B32',
  criticalTint: '#FDEDEE',
  info: '#2563EB',
  infoTint: '#EAF1FE',

  /** The dark rail and any inverted surface. */
  dark: '#17143B',
  darkSoft: '#241F52',
  // NOT `as const`. With it, every value is its own literal type, so
  //   useState({ color: C.violet })
  // infers `color: "#6D3BEF"` and refuses every later colour. A palette is a
  // set of strings, not a set of singleton types. `satisfies` keeps the keys
  // checked and autocompleted without narrowing the values.
} satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// TYPE
//
// One scale, used everywhere. Sizes are deliberately few — an interface that
// reaches for a new size per screen stops having a hierarchy at all.
// ---------------------------------------------------------------------------

export const F = {
  family: '"DM Sans","Segoe UI",system-ui,sans-serif',
  /** Uppercase eyebrows, table column heads. */
  micro: 10.5,
  /** Metadata, helper text, chips. */
  tiny: 11.5,
  /** Dense table cells and secondary controls. */
  small: 12.5,
  /** Body default. */
  body: 13.5,
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
  flat: '0 1px 2px rgba(23,20,59,.05)',
  raised: '0 1px 2px rgba(23,20,59,.06), 0 4px 12px -4px rgba(23,20,59,.10)',
  floating: '0 2px 4px rgba(23,20,59,.07), 0 12px 28px -10px rgba(23,20,59,.18)',
  overlay: '0 4px 8px rgba(23,20,59,.09), 0 24px 56px -16px rgba(23,20,59,.26)',
  /** For a violet element that should glow in its own colour, not grey. */
  violet: '0 1px 2px rgba(84,38,217,.28), 0 8px 20px -6px rgba(109,59,239,.42)',
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

export type Tone = 'neutral' | 'violet' | 'positive' | 'warning' | 'critical' | 'info';

export const tone = (t: Tone): { fg: string; bg: string; edge: string } => ({
  neutral:  { fg: C.muted,     bg: C.sunken,        edge: C.line },
  violet:   { fg: C.violetDeep, bg: C.violetTint,   edge: C.violetEdge },
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
  color: C.faint,
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
