// components/company/ui.ts — the company profile's visual system.
//
// The screen read as "pencil on white paper", and the cause was in the style
// constants rather than in any one component: a card was TK.surface with a
// hairline border and NO shadow, section headings were 11px uppercase muted,
// and field labels were 10px muted. Every element sat on the same plane in a
// close range of greys, so nothing was louder than anything else and the eye
// had nowhere to land.
//
// What this fixes, in order of how much it matters:
//
//   1. ELEVATION. Cards get two-layer shadows — a tight contact shadow plus a
//      soft cast one. One blur reads as a glow; two read as height.
//   2. HIERARCHY, IN THREE KINDS. A heading is 15px/800 SENTENCE CASE with a
//      coloured rule; a label is 10px/700 UPPERCASE muted; a value is 15px/600
//      full ink. Previously a heading and a label were both bold uppercase two
//      pixels apart, so only shade separated them — which is why a heading did
//      not read as a heading.
//   3. COLOUR PER SECTION. Each of the twelve tabs owns a hue, carried into
//      its heading rule and its active pill, so "where am I" is answered by
//      colour before it is answered by reading.
//   4. MOTION. Cards lift on hover, sections fade in on tab change, bars grow
//      from zero. All of it dropped under prefers-reduced-motion.
//
// Everything is a token, so it follows the theme rather than pinning a light
// palette the way most of this screen's colours previously did.

import { C, F, W, R } from '@/lib/ui'

/** One hue per section. Chosen to be distinguishable from each other AND from
 *  the status colours already on the screen — nothing here reuses the red of
 *  an expired certificate or the green of a valid one, because a heading in
 *  that colour would read as a status. */
export const ACCENT: Record<string, string> = {
  basic:      '#2563EB',
  compliance: '#7C3AED',
  location:   '#0891B2',
  contact:    '#DB2777',
  finance:    '#059669',
  org:        '#D97706',
  payroll:    '#4F46E5',
  statutory:  '#BE123C',
  hr:         '#0D9488',
  brand:      '#C026D3',
  documents:  '#1D4ED8',
  policy:     '#B45309',
}

export const CSS = `
  @keyframes cp-fade { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
  @keyframes cp-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }

  .cp-in    { animation: cp-fade .28s cubic-bezier(.2,.8,.2,1) both }
  .cp-card  { transition: box-shadow .22s ease, transform .22s cubic-bezier(.2,.8,.2,1), border-color .22s ease }
  .cp-card:hover { transform: translateY(-2px) }

  /* The expandable company header. A gradient wash rather than a flat grey
     bar, so the thing you click reads as the thing you click. */
  .cp-head  { transition: background .2s ease }
  .cp-head:hover { filter: brightness(1.03) }

  .cp-chev  { transition: transform .25s cubic-bezier(.2,.8,.2,1) }
  .cp-chev[data-open="1"] { transform: rotate(90deg) }

  .cp-tab   { transition: background .16s ease, color .16s ease, transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .16s ease }
  .cp-tab:hover  { transform: translateY(-1px) }
  .cp-tab:active { transform: translateY(0) scale(.97) }

  .cp-row   { transition: background .15s ease }
  .cp-row:hover { background: var(--ez-sunken) }

  .cp-bar > i { display:block; height:100%; transform-origin:left; animation: cp-grow .5s cubic-bezier(.2,.8,.2,1) both }

  @media (prefers-reduced-motion: reduce) {
    .cp-in, .cp-bar > i { animation: none }
    .cp-card, .cp-card:hover, .cp-tab, .cp-tab:hover, .cp-tab:active, .cp-chev { transition:none; transform:none }
  }
`

/** A raised surface. `accent` paints a 3px rail down the left edge — the
 *  cheapest way to give a white card an identity without tinting the whole
 *  thing, which would fight the content sitting on it. */
export const card = (accent?: string): React.CSSProperties => ({
  background: C.surface,
  borderRadius: 14,
  border: `1px solid ${C.line}`,
  borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.line}`,
  // Two layers: contact, then cast. This is the whole difference between a
  // card and a rectangle.
  boxShadow: '0 1px 2px rgba(15,23,42,.06), 0 8px 24px -8px rgba(15,23,42,.14)',
  padding: '16px 18px',
  marginBottom: 12,
})

/** Deliberately NOT uppercase. Field labels are uppercase, and a heading that
 *  is also bold uppercase two pixels larger is the same KIND of thing — only
 *  the shade separates them, which is why headings did not read as headings.
 *  Sentence case at 15/800 with a coloured rule is a different level. */
export const heading = (accent: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 9,
  fontSize: 15, fontWeight: W.bold, color: C.ink,
  letterSpacing: '-.01em',
  marginBottom: 12,
})

/** The short coloured rule that sits before a heading. */
export const rule = (accent: string): React.CSSProperties => ({
  width: 16, height: 3, borderRadius: 2, flexShrink: 0,
  background: `linear-gradient(90deg, ${accent}, ${accent}55)`,
})

/** A TAG. Small, uppercase, wide-tracked, muted — it names the thing below it
 *  and then gets out of the way. */
export const label: React.CSSProperties = {
  fontSize: 10, fontWeight: W.bold, color: C.muted,
  textTransform: 'uppercase', letterSpacing: '.08em', lineHeight: 1.3, marginBottom: 4,
}

/** THE CONTENT. The largest text in a field group and the only one in full
 *  ink. 15/600 against a 10/700 uppercase label is a difference in kind. */
export const value: React.CSSProperties = {
  fontSize: 15, fontWeight: W.semi, color: C.ink, lineHeight: 1.4,
}

/** A monogram tile for a company code. Gives every card a coloured anchor at
 *  the top-left, which is what the eye looks for first. */
export const monogram = (accent: string): React.CSSProperties => ({
  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: `linear-gradient(145deg, ${accent}, ${accent}CC)`,
  color: '#FFFFFF', fontSize: 13, fontWeight: W.bold, letterSpacing: '.02em',
  // Inner highlight along the top edge plus a coloured cast shadow: the two
  // together are what make a flat square read as a raised object.
  boxShadow: `inset 0 1px 0 rgba(255,255,255,.35), 0 4px 12px -2px ${accent}66`,
})

/** A tinted stat tile — used for the numbers at the top of a card. */
export const stat = (accent: string): React.CSSProperties => ({
  padding: '10px 13px', borderRadius: 11,
  background: `linear-gradient(160deg, ${accent}14, ${accent}08)`,
  border: `1px solid ${accent}2E`,
})

export const statValue: React.CSSProperties = {
  fontSize: 20, fontWeight: W.bold, color: C.ink,
  fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
}
export const statLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: W.semi, color: C.muted,
  textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 3,
}
