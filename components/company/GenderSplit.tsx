'use client'
// components/company/GenderSplit.tsx — headcount by gender, as a number and a
// pie.
//
// Drawn with SVG arcs rather than a charting library: this is one chart of at
// most four slices, and a dependency would cost more than it saves. It also
// means the colours are tokens, so the chart follows the theme like everything
// else — most chart libraries hard-code a palette.
//
// The NUMBER is the primary reading and the pie supports it. A pie alone
// cannot answer "how many women work at the Ludhiana factory", which is the
// question this is here to answer.

import { C, F, W, R } from '@/lib/ui'
import type { GenderCount } from '@/lib/supabase-company-profile'

/** Distinct hues, not a light/dark pair of one hue: these two categories are
 *  peers, and shading one lighter implies it is a subset or a lesser case. */
const SLICE = {
  male:    '#2563EB',
  female:  '#DB2777',
  other:   '#7C3AED',
  unknown: '#94A3B8',
}
const LABEL: Record<keyof typeof SLICE, string> = {
  male: 'Male', female: 'Female', other: 'Other', unknown: 'Not recorded',
}
/** A wash of each hue for the chip ground. Kept at ~12% so the label stays
 *  legible on it in both themes rather than needing a per-theme pair. */
/**
 * The chip LABEL ink, which is not the same thing as the slice colour.
 *
 * The label used SLICE[k] directly — one hue, both themes, printed on a 12%
 * tint of itself. On white that is 4.37:1 for "Male" and 3.84:1 for "Female",
 * under the 4.5 bar for 11px semibold; on the dark card the same light-mode
 * hue drops to 3.0:1. "Unknown" was the worst at 2.33:1 and escaped notice
 * only because no site has an unknown row today.
 *
 * Two values per gender, each walked until it clears 4.5:1 against its own
 * tint on its own theme's card. The slice colours themselves are unchanged —
 * a donut segment is a graphic and 3:1 is the right bar for it.
 */
const INK: Record<keyof typeof SLICE, { l: string; d: string }> = {
  male:    { l: '#134DCE', d: '#5B8AF0' },
  female:  { l: '#C02067', d: '#E35996' },
  other:   { l: '#5813CE', d: '#A273F2' },
  unknown: { l: '#5A6C87', d: '#8496AE' },
}

/** Three states, not two: "System" stamps no attribute at all, so a rule
 *  written only for [data-ez-theme] never applies to most viewers. */
const GENDER_CSS = `
.cp-gi{ --gi: var(--gi-l) }
:root:not([data-ez-theme="light"]) .cp-gi{ --gi: var(--gi-d) }
@media (prefers-color-scheme: light){
  :root:not([data-ez-theme="dark"]) .cp-gi{ --gi: var(--gi-l) }
}
:root[data-ez-theme="dark"]  .cp-gi{ --gi: var(--gi-d) }
:root[data-ez-theme="light"] .cp-gi{ --gi: var(--gi-l) }
`

const TINT: Record<keyof typeof SLICE, string> = {
  male:    'rgba(37,99,235,.12)',
  female:  'rgba(219,39,119,.12)',
  other:   'rgba(124,58,237,.12)',
  unknown: 'rgba(148,163,184,.16)',
}

/** A pie slice as an SVG path. Angles run clockwise from twelve o'clock, which
 *  is where a reader expects a pie to start. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  // A full circle cannot be drawn as a single arc — the start and end points
  // coincide and the path collapses. One category holding 100% is the common
  // case here (a branch with four men and no women), so it is handled, not
  // left to render as nothing.
  if (to - from >= 359.999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
  }
  const rad = (d: number) => ((d - 90) * Math.PI) / 180
  const x1 = cx + r * Math.cos(rad(from)), y1 = cy + r * Math.sin(rad(from))
  const x2 = cx + r * Math.cos(rad(to)),   y2 = cy + r * Math.sin(rad(to))
  const large = to - from > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

export function GenderPie({ counts, size = 78 }: { counts: GenderCount; size?: number }) {
  const keys = (['male', 'female', 'other', 'unknown'] as const).filter(k => counts[k] > 0)
  const total = counts.total

  if (!total) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: `2px dashed ${C.line}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: F.micro, color: C.faint }}>none</div>
    )
  }

  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  let cursor = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}
         role="img" aria-label={keys.map(k => `${LABEL[k]} ${counts[k]}`).join(', ')}>
      {keys.map(k => {
        const sweep = (counts[k] / total) * 360
        const d = arc(cx, cy, r, cursor, cursor + sweep)
        cursor += sweep
        return <path key={k} d={d} fill={SLICE[k]} stroke={C.surface} strokeWidth="1.5" />
      })}
      {/* A hole turns the pie into a donut, which reads more accurately —
          people compare arc length better than wedge area — and gives the
          total somewhere to live. */}
      <circle cx={cx} cy={cy} r={r * 0.56} fill={C.surface} />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: size * 0.24, fontWeight: 800, fill: C.ink,
                     fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
        {total}
      </text>
    </svg>
  )
}

/** Pie plus the numbers beside it. `dense` drops the legend to two columns for
 *  the per-branch rows, where the space is tighter. */
export function GenderSplit({ counts, size = 78, dense = false }: {
  counts: GenderCount; size?: number; dense?: boolean
}) {
  const keys = (['male', 'female', 'other', 'unknown'] as const).filter(k => counts[k] > 0)
  const pct = (n: number) => counts.total ? Math.round((n / counts.total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: dense ? 12 : 16 }}>
      <GenderPie counts={counts} size={size} />
      <div style={{ display: 'grid', gap: dense ? 3 : 5,
                    gridTemplateColumns: dense ? '1fr 1fr' : '1fr' }}>
        {keys.length === 0 && <span style={{ fontSize: F.micro, color: C.faint }}>No employees</span>}
        {keys.map(k => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3,
              background: SLICE[k], flexShrink: 0 }} />
            <span style={{ fontSize: F.micro, color: C.muted, minWidth: dense ? 44 : 62 }}>{LABEL[k]}</span>
            <strong style={{ fontSize: dense ? F.micro : F.small, fontWeight: W.bold, color: C.ink,
                             fontVariantNumeric: 'tabular-nums' }}>{counts[k]}</strong>
            <span style={{ fontSize: F.micro, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
              {pct(counts[k])}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The branch row version. Labelled chips, not bare dots.
 *
 * This showed a coloured dot and a number and nothing else — you had to know
 * that blue meant male, and at 11px against a legend that was somewhere else
 * on the page. The words and the percentage are the point: "how many women
 * work at this branch, and is that a lot" is one question, and a number
 * without its share cannot answer the second half.
 *
 * The percentage is of the BRANCH, not the company — this row is about this
 * site, and mixing the two denominators in one line is how a reader ends up
 * with the wrong figure. */
export function GenderInline({ counts }: { counts: GenderCount }) {
  if (!counts.total) {
    return <span style={{ fontSize: F.micro, color: C.faint }}>No employees at this site</span>
  }
  const pct = (n: number) => Math.round((n / counts.total) * 100)

  const chip = (k: keyof typeof SLICE) => counts[k] > 0 ? (
    <span key={k} className="cp-gi" style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      padding: '3px 10px', borderRadius: R.pill,
      background: TINT[k], border: `1px solid ${SLICE[k]}33`,
      whiteSpace: 'nowrap',
      ['--gi-l' as string]: INK[k].l, ['--gi-d' as string]: INK[k].d,
    }}>
      <span style={{ fontSize: F.micro, color: 'var(--gi)', fontWeight: W.semi }}>{LABEL[k]}</span>
      <strong style={{ fontSize: F.small, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
        {counts[k]}
      </strong>
      <span style={{ fontSize: F.micro, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
        {pct(counts[k])}%
      </span>
    </span>
  ) : null

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      <style>{GENDER_CSS}</style>
      {chip('male')}{chip('female')}{chip('other')}{chip('unknown')}
      <span style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 5,
        paddingLeft: 9, borderLeft: `1px solid ${C.line}`, whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: F.micro, color: C.muted }}>Total</span>
        <strong style={{ fontSize: F.small, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
          {counts.total}
        </strong>
      </span>
    </span>
  )
}

export { SLICE as GENDER_COLOURS }
