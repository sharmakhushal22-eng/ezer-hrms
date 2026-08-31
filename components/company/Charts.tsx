'use client'
// components/company/Charts.tsx — the small chart kit this screen needs.
//
// SVG and CSS, no charting dependency. Three shapes cover everything the
// company profile shows: a horizontal bar list (headcount per department, per
// location), a donut (compliance health, employment mix), and a capacity bar
// (headcount against sanctioned strength).
//
// Horizontal bars rather than vertical: the labels are department names, and
// vertical bars would either rotate them 45° or truncate them. A rotated axis
// label is a chart that has given up.
//
// Every chart states its numbers. A bar whose value you cannot read is
// decoration — and "how many people are in Finance" is the actual question.

import { C, F, W, R } from '@/lib/ui'

export interface BarDatum { label: string; value: number; sub?: string; colour?: string }

export function BarList({ data, max, unit = '', emptyText = 'No data' }: {
  data: BarDatum[]; max?: number; unit?: string; emptyText?: string
}) {
  if (!data.length) return <div style={{ fontSize: F.micro, color: C.faint, padding: '6px 0' }}>{emptyText}</div>
  // Scale to the largest bar, not to the total: this compares categories with
  // each other, and scaling to the sum makes every bar short and unreadable.
  const top = max ?? Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {data.map(d => (
        <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '132px 1fr 64px', gap: 10, alignItems: 'center' }}>
          <span title={d.label} style={{
            fontSize: F.micro, color: C.muted, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{d.label}</span>
          <div className="cp-bar" style={{ height: 18, background: C.sunken, borderRadius: R.sm,
                                            overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(15,23,42,.07)' }}>
            <i style={{
              width: `${Math.max((d.value / top) * 100, d.value > 0 ? 2 : 0)}%`,
              background: d.colour ?? `linear-gradient(90deg, ${C.brand}, ${C.brandDeep})`,
              borderRadius: R.sm,
              // The inner highlight is what stops a filled rectangle reading
              // as a block of colour and makes it read as a solid bar.
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30)',
            }} />
          </div>
          <span style={{
            fontSize: F.small, fontWeight: W.bold, color: C.ink, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>{d.value}{unit}</span>
        </div>
      ))}
    </div>
  )
}

export interface Slice { label: string; value: number; colour: string }

/** Shared with GenderSplit's pie — kept here so a second donut on the same
 *  screen cannot drift to a different arc convention. */
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  if (to - from >= 359.999) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
  const rad = (d: number) => ((d - 90) * Math.PI) / 180
  const x1 = cx + r * Math.cos(rad(from)), y1 = cy + r * Math.sin(rad(from))
  const x2 = cx + r * Math.cos(rad(to)),   y2 = cy + r * Math.sin(rad(to))
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2} Z`
}

export function Donut({ slices, size = 88, centre }: {
  slices: Slice[]; size?: number; centre?: string
}) {
  const live = slices.filter(s => s.value > 0)
  const total = live.reduce((a, s) => a + s.value, 0)
  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  let cursor = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}
           role="img" aria-label={live.map(s => `${s.label} ${s.value}`).join(', ') || 'No data'}>
        {total === 0
          ? <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke={C.line} strokeWidth="2" strokeDasharray="4 4" />
          : live.map(s => {
              const sweep = (s.value / total) * 360
              const d = arcPath(cx, cy, r, cursor, cursor + sweep)
              cursor += sweep
              return <path key={s.label} d={d} fill={s.colour} stroke={C.surface} strokeWidth="1.5" />
            })}
        <circle cx={cx} cy={cy} r={r * 0.58} fill={C.surface} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: size * 0.23, fontWeight: 800, fill: C.ink, fontFamily: 'inherit' }}>
          {centre ?? total}
        </text>
      </svg>
      <div style={{ display: 'grid', gap: 4 }}>
        {live.length === 0 && <span style={{ fontSize: F.micro, color: C.faint }}>Nothing recorded</span>}
        {live.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: s.colour }} />
            <span style={{ fontSize: F.micro, color: C.muted, minWidth: 92 }}>{s.label}</span>
            <strong style={{ fontSize: F.small, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Headcount against sanctioned strength. Over-capacity is a real state and is
 *  shown as such rather than clamped to 100% — a bar that stops at full cannot
 *  tell you that a site is eleven people over its cap. */
export function Capacity({ used, cap, label }: { used: number; cap: number | null; label: string }) {
  if (!cap) {
    return (
      <div>
        <div style={{ fontSize: F.micro, color: C.faint, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: F.small, color: C.ink }}>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{used}</strong>
          <span style={{ color: C.faint, fontWeight: 400 }}> · no sanctioned strength set</span>
        </div>
      </div>
    )
  }
  const pct = (used / cap) * 100
  const over = used > cap
  const tone = over ? C.critical : pct >= 90 ? C.warning : C.positive
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: F.micro, color: C.faint }}>{label}</span>
        <span style={{ fontSize: F.micro, color: tone, fontWeight: W.semi, fontVariantNumeric: 'tabular-nums' }}>
          {used} / {cap}{over ? ` · ${used - cap} over` : ''}
        </span>
      </div>
      <div style={{ height: 8, background: C.sunken, borderRadius: R.pill, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%', background: tone,
          borderRadius: R.pill, transition: 'width .4s cubic-bezier(.2,.8,.2,1)',
        }} />
        {over && (
          // A hatched cap line, so being over reads as over rather than as full.
          <div aria-hidden style={{
            position: 'absolute', inset: 0, borderRadius: R.pill,
            background: `repeating-linear-gradient(45deg, transparent 0 4px, ${C.criticalTint} 4px 8px)`,
          }} />
        )}
      </div>
    </div>
  )
}

/** A labelled value. The workhorse of the profile sections — used everywhere a
 *  field is read-only, so "not recorded" looks the same in all ten of them. */
export function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === '' || value === '—'
  return (
    // Label and value were 11px faint over 13px ink — half a step apart, which
    // is why a grid of them read as undifferentiated grey. The label is now
    // bolder and tighter, the value a size larger and heavier, and an empty
    // one is dashed rather than merely paler so "missing" is a shape, not a
    // shade you have to compare against its neighbour.
    <div>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                    letterSpacing: '.08em', fontWeight: W.bold, lineHeight: 1.3,
                    marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 15, color: empty ? C.faint : C.ink, fontWeight: empty ? 400 : 600,
        lineHeight: 1.4,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        wordBreak: 'break-word',
        ...(empty ? {
          display: 'inline-block', padding: '1px 9px', borderRadius: R.sm,
          border: `1px dashed ${C.line}`, fontSize: 12,
        } : {}),
      }}>
        {empty ? 'Not recorded' : value}
      </div>
    </div>
  )
}

// ── Summary strip ───────────────────────────────────────────────────────────
// A row of stat tiles at the head of a section. The sections were walls of
// label/value pairs in one grey at one weight — every token in them passes AA,
// so the dullness was never contrast. It was that nothing was EMPHASISED: no
// figure was larger than any other, and there was nothing to look at before
// reading. These tiles give each sub-section a headline before its detail.

export interface StatItem {
  label: string
  value: React.ReactNode
  hint?: string
  accent: string
  /** 0..1 — draws a progress rail under the number. Omit for a plain figure. */
  fill?: number
}

export function StatStrip({ items, isMobile }: { items: StatItem[]; isMobile?: boolean }) {
  if (!items.length) return null
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr 1fr' : `repeat(${Math.min(items.length, 4)}, minmax(0,1fr))`,
      gap: 10, marginBottom: 16,
    }}>
      {items.map(s => (
        <div key={s.label} style={{
          padding: '11px 13px', borderRadius: 12,
          // A wash of the accent rather than a flat tint, plus a hairline of
          // the same hue: enough to separate the tile from the card without
          // becoming a second card competing with it.
          background: `linear-gradient(158deg, ${s.accent}16, ${s.accent}07)`,
          border: `1px solid ${s.accent}30`,
          boxShadow: `inset 0 1px 0 ${s.accent}18`,
        }}>
          <div style={{
            fontSize: 22, fontWeight: W.bold, color: C.ink, lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em',
          }}>{s.value}</div>
          <div style={{
            fontSize: 10, fontWeight: W.bold, color: s.accent,
            textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4,
          }}>{s.label}</div>
          {s.hint && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{s.hint}</div>
          )}
          {s.fill != null && (
            <div style={{ height: 4, background: `${s.accent}22`, borderRadius: R.pill,
                          marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(0, Math.min(1, s.fill)) * 100}%`, height: '100%',
                            background: s.accent, borderRadius: R.pill }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** A value that should carry weight — a code, an identifier. Rendered as a
 *  tinted mono chip so it reads as data rather than as more prose. */
export function CodeChip({ value, accent }: { value: React.ReactNode; accent: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: R.sm,
      background: `${accent}14`, border: `1px solid ${accent}2E`, color: C.ink,
      fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: W.semi,
      letterSpacing: '.02em',
    }}>{value}</span>
  )
}
