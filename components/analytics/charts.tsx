'use client'
// components/analytics/charts.tsx — the chart kit the analytics screens are drawn with.
//
// SVG and CSS, no charting dependency, every colour a token (lib/ui VIZ for series and
// magnitude, C for text and state), so light and dark both work and the colour ratchet
// stays green.
//
// The rules every chart here keeps (they are the difference between a dashboard that
// is read and one that is decorated):
//   * thin marks — bars ≤ 24px with a 4px rounded data end, 2px lines, ≥ 8px dots
//   * one y-axis, recessive hairline grid, nothing dashed
//   * a legend whenever there are two or more series; text never wears a series colour
//   * every value reachable without hovering (labels, legends or a table beside it);
//     the tooltip adds, it never gates
//   * a series keeps its colour when a filter removes its neighbours

import * as React from 'react'
import { C, F, W, R, S, E, Z, VIZ, seriesColour, numeric, eyebrow, tone, type Tone } from '@/lib/ui'
import { fmt as format, delta } from '@/lib/analytics/format'
import type { Fmt, Kpi, Insight, DayKind } from '@/lib/analytics/types'

// ───────────────────────────────────────────────────────────────────────────
// Plumbing
// ───────────────────────────────────────────────────────────────────────────

/** The rendered width of an element, kept current. Charts draw to real pixels so text
 *  is never stretched by a viewBox. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null)
  const [w, setW] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Round, readable axis ticks: 0 / 5 / 10 … rather than 0 / 4.3 / 8.6. */
export function niceTicks(max: number, count = 4, integer = false, min = 0): number[] {
  if (!(max > min)) return integer ? [min, min + 1] : [min, min + 1]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  let step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) as number
  // Whole things are counted in whole steps: never "0, 0.25, 0.5" people.
  if (integer) step = Math.max(1, Math.round(step) === step ? step : Math.ceil(step))
  const lo = Math.floor(min / step) * step
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/** The axis format for a value format: whole numbers for counts and days. */
const axisFmt = (f: Fmt): Fmt => (f === 'pct' ? 'pct' : f === 'money' ? 'money' : f === 'clock' ? 'clock' : f === 'days' ? 'days' : 'count')
const isWhole = (f: Fmt) => f === 'count' || f === 'days'

/** Left padding wide enough for the longest tick label — "₹3.00 Cr" was being clipped. */
const padFor = (ticks: number[], f: Fmt) => Math.max(30, Math.max(...ticks.map(t => format(t, axisFmt(f)).length)) * 6.6 + 12)

/** Show every Nth category label so none overlap, judged by the labels' own length. */
const labelStep = (labels: string[], band: number) => {
  const longest = Math.max(1, ...labels.map(l => l.length))
  return Math.max(1, Math.ceil((longest * 6.4 + 10) / Math.max(1, band)))
}

const axisText: React.CSSProperties = { fontSize: 11, fill: C.muted, fontFamily: F.family, ...numeric }

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  // Kept inside the chart's box: flips to the left of the pointer past the midline.
  const left = x > width / 2
  return (
    <div role="tooltip" style={{
      position: 'absolute', top: Math.max(0, y), left: left ? undefined : x + 12, right: left ? Math.max(0, width - x + 12) : undefined,
      background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, boxShadow: E.floating,
      padding: '8px 10px', fontSize: F.tiny, color: C.ink, pointerEvents: 'none', zIndex: Z.raised, minWidth: 120, whiteSpace: 'nowrap',
    }}>{children}</div>
  )
}

function TipRow({ colour, label, value, line }: { colour?: string; label: string; value: string; line?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
      {colour && <span aria-hidden style={{ width: line ? 12 : 9, height: line ? 2 : 9, borderRadius: line ? 1 : 2, background: colour, flexShrink: 0 }} />}
      <strong style={{ fontWeight: W.bold, ...numeric }}>{value}</strong>
      <span style={{ color: C.muted }}>{label}</span>
    </div>
  )
}

export function Legend({ items, line }: { items: { label: string; colour: string }[]; line?: boolean }) {
  if (items.length < 2) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: S.sm }}>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.inkSoft }}>
          <span aria-hidden style={{ width: line ? 14 : 10, height: line ? 2 : 10, borderRadius: line ? 1 : 3, background: i.colour }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function EmptyChart({ text = 'Nothing to show for this selection yet.', height = 120 }: { text?: string; height?: number }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: S.md,
      border: `1px dashed ${C.line}`, borderRadius: R.md, color: C.muted, fontSize: F.small, background: C.sunken,
    }}>{text}</div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Cards and figures
// ───────────────────────────────────────────────────────────────────────────

export function ChartCard({ title, sub, right, children, style, id }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; id?: string
}) {
  return (
    <section id={id} style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat,
      padding: S.lg, minWidth: 0, display: 'flex', flexDirection: 'column', ...style,
    }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.md, marginBottom: S.md }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: F.lead, fontWeight: W.semi, color: C.ink, letterSpacing: '-.01em' }}>{title}</h3>
          {sub != null && <div style={{ marginTop: 3, fontSize: F.tiny, color: C.muted, lineHeight: 1.45 }}>{sub}</div>}
        </div>
        {right}
      </header>
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </section>
  )
}

export function Grid({ children, min = 320, gap = S.lg }: { children: React.ReactNode; min?: number; gap?: number }) {
  return <div style={{ display: 'grid', gap, gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, marginBottom: gap, alignItems: 'stretch' }}>{children}</div>
}

export function Sparkline({ values, width = 96, height = 28 }: { values: (number | null)[]; width?: number; height?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter(p => p.v != null) as { v: number; i: number }[]
  if (pts.length < 2) return null
  const max = Math.max(...pts.map(p => p.v)), min = Math.min(...pts.map(p => p.v))
  const span = max - min || 1
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6)
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6)
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke={C.faint} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill={VIZ.series[0]} stroke={C.surface} strokeWidth={1.5} />
    </svg>
  )
}

/** Up or down, coloured by whether that direction is good for this figure. */
export function DeltaChip({ now, before, f, good = 'neutral', label }: { now: number | null | undefined; before: number | null | undefined; f: Fmt; good?: 'up' | 'down' | 'neutral'; label?: string }) {
  const d = delta(now, before, f)
  if (!d) return null
  const t: Tone = d.dir === 'flat' || good === 'neutral' ? 'neutral' : (d.dir === good ? 'positive' : 'critical')
  const k = tone(t)
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•'
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: R.pill,
      background: k.bg, color: k.fg, border: `1px solid ${k.edge}`, fontSize: F.micro, fontWeight: W.semi, whiteSpace: 'nowrap', ...numeric,
    }}>
      <span aria-hidden style={{ fontSize: 8 }}>{arrow}</span>{d.text}
    </span>
  )
}

export function KpiTile({ k, onClick }: { k: Kpi; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={onClick ? 'ez-lift' : undefined} title={k.def} style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: '14px 16px', boxShadow: E.flat,
      minWidth: 0, cursor: onClick ? 'pointer' : undefined, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ ...eyebrow, display: 'flex', alignItems: 'center', gap: 6 }}>
        {k.label}
        {k.def && <span aria-label="Definition" style={{ width: 14, height: 14, borderRadius: R.pill, border: `1px solid ${C.lineStrong}`, color: C.faint, fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textTransform: 'none', letterSpacing: 0 }}>i</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: S.sm }}>
        <div style={{ fontSize: F.display, fontWeight: W.bold, color: C.ink, lineHeight: 1, letterSpacing: '-.02em' }}>{format(k.value, k.fmt)}</div>
        {k.spark && <Sparkline values={k.spark} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 20 }}>
        {k.prev !== undefined && <DeltaChip now={k.value} before={k.prev} f={k.fmt} good={k.good} label="Against the previous period" />}
        {k.sub && <span style={{ fontSize: F.tiny, color: C.muted }}>{k.sub}</span>}
      </div>
    </div>
  )
}

export function KpiRow({ items, min = 190, onPick }: { items: Kpi[]; min?: number; onPick?: (key: string) => void }) {
  return (
    <div className="ez-stagger" style={{ display: 'grid', gap: S.md, gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, marginBottom: S.lg }}>
      {items.map(k => <KpiTile key={k.key} k={k} onClick={onPick ? () => onPick(k.key) : undefined} />)}
    </div>
  )
}

/** A small figure with its label, for inside a card. */
export function Figure({ label, value, sub, t = 'neutral' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; t?: Tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...eyebrow, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: W.bold, color: t === 'neutral' ? C.ink : tone(t).fg, lineHeight: 1.1, letterSpacing: '-.01em' }}>{value}</div>
      {sub != null && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export function Figures({ children, min = 120 }: { children: React.ReactNode; min?: number }) {
  return <div style={{ display: 'grid', gap: S.md, gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, marginBottom: S.md }}>{children}</div>
}

// ───────────────────────────────────────────────────────────────────────────
// Insights
// ───────────────────────────────────────────────────────────────────────────

const SEV: Record<Insight['severity'], { t: Tone; label: string; glyph: string }> = {
  critical: { t: 'critical', label: 'Act now', glyph: '!' },
  warning: { t: 'warning', label: 'Watch', glyph: '!' },
  info: { t: 'info', label: 'Note', glyph: 'i' },
  positive: { t: 'positive', label: 'Good news', glyph: '✓' },
}

/** A finding. Rule findings carry a title and a detail; AI findings add the next step
 *  and the fact lines they rest on ("Based on"), which open without following the card. */
export function InsightCard({ i, onOpen, areaLabel, action, evidence }: {
  i: Pick<Insight, 'severity' | 'title' | 'detail'>; onOpen?: () => void; areaLabel?: string; action?: string | null; evidence?: string[]
}) {
  const s = SEV[i.severity], k = tone(s.t)
  const [why, setWhy] = React.useState(false)
  return (
    <div onClick={onOpen} className={onOpen ? 'ez-lift' : undefined} style={{
      display: 'flex', gap: S.md, padding: '12px 14px', background: C.surface, border: `1px solid ${C.line}`,
      borderLeft: `3px solid ${k.fg}`, borderRadius: R.md, cursor: onOpen ? 'pointer' : undefined, minWidth: 0,
    }}>
      <span aria-hidden style={{
        width: 24, height: 24, borderRadius: R.pill, background: k.bg, color: k.fg, border: `1px solid ${k.edge}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: W.bold, fontSize: F.tiny, flexShrink: 0,
      }}>{s.glyph}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.micro, fontWeight: W.bold, color: k.fg, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</span>
          {areaLabel && <span style={{ fontSize: F.micro, color: C.faint }}>· {areaLabel}</span>}
        </div>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, marginTop: 2, lineHeight: 1.4 }}>{i.title}</div>
        {i.detail && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{i.detail}</div>}
        {action && (
          <div style={{ fontSize: F.tiny, color: C.inkSoft, marginTop: 6, lineHeight: 1.5 }}>
            <strong style={{ color: C.ink, fontWeight: W.semi }}>Next step: </strong>{action}
          </div>
        )}
        {evidence && evidence.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button type="button" aria-expanded={why} onClick={e => { e.stopPropagation(); setWhy(w => !w) }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi, color: C.brand }}>
              {why ? 'Hide the figures' : `Based on ${evidence.length} figure${evidence.length === 1 ? '' : 's'}`} {why ? '▴' : '▾'}
            </button>
            {why && (
              <ul onClick={e => e.stopPropagation()} style={{ margin: '6px 0 0', padding: '8px 10px 8px 24px', background: C.sunken, borderRadius: R.sm, display: 'grid', gap: 4, cursor: 'default' }}>
                {evidence.map((x, n) => <li key={n} style={{ fontSize: F.micro, color: C.inkSoft, lineHeight: 1.5 }}>{x}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      {onOpen && <span aria-hidden style={{ color: C.faint, alignSelf: 'center', fontSize: F.body }}>›</span>}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Column chart — grouped or stacked, one y-axis
// ───────────────────────────────────────────────────────────────────────────

export interface Series { key: string; label: string; values: (number | null)[]; colour?: string }

export function ColumnChart({ labels, series, stacked, height = 210, f = 'count', emptyText, labelEvery }: {
  labels: string[]; series: Series[]; stacked?: boolean; height?: number; f?: Fmt; emptyText?: string; labelEvery?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = React.useState<number | null>(null)
  const total = series.reduce((s, x) => s + x.values.reduce((a: number, v) => a + (v || 0), 0), 0)
  const colours = series.map((s, i) => s.colour || seriesColour(i))
  const top = stacked
    ? Math.max(0, ...labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0)))
    : Math.max(0, ...series.flatMap(s => s.values.map(v => v || 0)))
  const ticks = niceTicks(top, 4, isWhole(f))
  const yMax = ticks[ticks.length - 1] || 1
  const padL = padFor(ticks, f), padR = 8, padT = 10, padB = 26
  const plotW = Math.max(10, width - padL - padR), plotH = height - padT - padB
  const band = plotW / Math.max(1, labels.length)
  const groupW = Math.min(band * 0.72, stacked ? 24 : 24 * series.length + 2 * (series.length - 1))
  const barW = stacked ? groupW : Math.max(3, (groupW - 2 * (series.length - 1)) / series.length)
  const y = (v: number) => padT + plotH - (v / yMax) * plotH
  const every = labelEvery || labelStep(labels, band)

  if (!total) return <EmptyChart text={emptyText} height={height} />
  return (
    <div>
      <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map(s => s.label).join(', ')} style={{ display: 'block' }}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth={1} />
                <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" style={axisText}>{format(t, axisFmt(f))}</text>
              </g>
            ))}
            {labels.map((lab, i) => {
              const cx = padL + band * i + band / 2
              let acc = 0
              return (
                <g key={lab + i}>
                  {hover === i && <rect x={padL + band * i} y={padT} width={band} height={plotH} fill={C.brandTint} opacity={0.6} />}
                  {series.map((s, k) => {
                    const v = s.values[i] || 0
                    if (v <= 0) return null
                    let x0: number, y0: number, h: number
                    if (stacked) {
                      x0 = cx - barW / 2; y0 = y(acc + v); h = y(acc) - y(acc + v); acc += v
                      // 2px surface gap between stacked segments.
                      const gap = acc - v > 0 ? 2 : 0
                      h = Math.max(0, h - gap)
                    } else {
                      x0 = cx - groupW / 2 + k * (barW + 2); y0 = y(v); h = y(0) - y(v)
                    }
                    const isTop = !stacked || series.slice(k + 1).every(o => !(o.values[i] || 0))
                    return <path key={s.key} d={roundedTop(x0, y0, barW, h, isTop ? Math.min(4, barW / 2, h) : 0)} fill={colours[k]} />
                  })}
                  {(i % every === 0 || (i === labels.length - 1 && (labels.length - 1) % every >= Math.ceil(every / 2))) && (
                    <text x={cx} y={height - 8} textAnchor="middle" style={axisText}>{lab}</text>
                  )}
                  <rect x={padL + band * i} y={padT} width={band} height={plotH + padB} fill="transparent"
                        onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
                </g>
              )
            })}
            <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke={C.lineStrong} strokeWidth={1} />
          </svg>
        )}
        {hover != null && width > 0 && (
          <Tip x={padL + band * hover + band / 2} y={8} width={width}>
            <div style={{ fontWeight: W.semi, color: C.inkSoft }}>{labels[hover]}</div>
            {series.map((s, k) => <TipRow key={s.key} colour={colours[k]} label={s.label} value={format(s.values[hover], f)} />)}
            {stacked && series.length > 1 && <TipRow label="total" value={format(series.reduce((a, s) => a + (s.values[hover] || 0), 0), f)} />}
          </Tip>
        )}
      </div>
      <Legend items={series.map((s, i) => ({ label: s.label, colour: colours[i] }))} />
    </div>
  )
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return ''
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// ───────────────────────────────────────────────────────────────────────────
// Line chart — crosshair, one tooltip for every series
// ───────────────────────────────────────────────────────────────────────────

export function LineChart({ labels, series, height = 210, f = 'count', area, emptyText, yMax: fixedMax, endLabel = true, zeroBase = true }: {
  labels: string[]; series: Series[]; height?: number; f?: Fmt; area?: boolean; emptyText?: string; yMax?: number; endLabel?: boolean
  /** False lets a trend zoom to its own range: 390 → 395 is invisible on an axis from 0. */
  zeroBase?: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = React.useState<number | null>(null)
  const colours = series.map((s, i) => s.colour || seriesColour(i))
  const all = series.flatMap(s => s.values).filter((v): v is number => v != null)
  if (!all.length) return <EmptyChart text={emptyText} height={height} />
  const lo = zeroBase ? 0 : Math.max(0, Math.min(...all) - Math.max(1, (Math.max(...all) - Math.min(...all)) * 0.5))
  const ticks = niceTicks(fixedMax ?? Math.max(...all, 0), 4, isWhole(f), lo)
  const yMin = ticks[0]
  const yMax = fixedMax ?? (ticks[ticks.length - 1] || 1)
  const padL = padFor(ticks, f), padR = endLabel && series.length === 1 ? 46 : 12, padT = 12, padB = 26
  const plotW = Math.max(10, width - padL - padR), plotH = height - padT - padB
  const x = (i: number) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
  const y = (v: number) => padT + plotH - ((Math.min(v, yMax) - yMin) / ((yMax - yMin) || 1)) * plotH
  const every = labelStep(labels, plotW / Math.max(1, labels.length))
  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - r.left
    const i = labels.length === 1 ? 0 : Math.round(((px - padL) / plotW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, i)))
  }
  return (
    <div>
      <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map(s => s.label).join(', ')} style={{ display: 'block' }}>
            {ticks.filter(t => t <= yMax).map(t => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth={1} />
                <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" style={axisText}>{format(t, axisFmt(f))}</text>
              </g>
            ))}
            {labels.map((lab, i) => (i % every === 0 || i === labels.length - 1) && (
              <text key={lab + i} x={x(i)} y={height - 8} textAnchor="middle" style={axisText}>{lab}</text>
            ))}
            {series.map((s, k) => {
              const segs: string[] = []
              let cur = ''
              s.values.forEach((v, i) => {
                if (v == null) { if (cur) segs.push(cur); cur = ''; return }
                cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
              })
              if (cur) segs.push(cur)
              const pts = s.values.map((v, i) => ({ v, i })).filter(p => p.v != null) as { v: number; i: number }[]
              const last = pts[pts.length - 1]
              return (
                <g key={s.key}>
                  {area && series.length === 1 && pts.length > 1 && (
                    <path d={`M${x(pts[0].i)},${y(yMin)} ${pts.map(p => `L${x(p.i)},${y(p.v)}`).join(' ')} L${x(last.i)},${y(yMin)}Z`} fill={VIZ.wash} />
                  )}
                  {segs.map((d, j) => <path key={j} d={d} fill="none" stroke={colours[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
                  {pts.length === 1 && <circle cx={x(pts[0].i)} cy={y(pts[0].v)} r={4} fill={colours[k]} stroke={C.surface} strokeWidth={2} />}
                  {last && <circle cx={x(last.i)} cy={y(last.v)} r={4} fill={colours[k]} stroke={C.surface} strokeWidth={2} />}
                  {last && endLabel && series.length === 1 && (
                    <text x={x(last.i) + 8} y={y(last.v)} dy="0.32em" style={{ ...axisText, fill: C.ink, fontWeight: W.semi }}>{format(last.v, f)}</text>
                  )}
                </g>
              )
            })}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke={C.lineStrong} strokeWidth={1} />}
            {hover != null && series.map((s, k) => s.values[hover] != null && (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={colours[k]} stroke={C.surface} strokeWidth={2} />
            ))}
          </svg>
        )}
        {hover != null && width > 0 && (
          <Tip x={x(hover)} y={8} width={width}>
            <div style={{ fontWeight: W.semi, color: C.inkSoft }}>{labels[hover]}</div>
            {series.map((s, k) => <TipRow key={s.key} line colour={colours[k]} label={s.label} value={format(s.values[hover], f)} />)}
          </Tip>
        )}
      </div>
      <Legend line items={series.map((s, i) => ({ label: s.label, colour: colours[i] }))} />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Horizontal bars — categories with names (departments, sources, reasons)
// ───────────────────────────────────────────────────────────────────────────

export interface HBarItem { key: string; label: string; value: number; sub?: string; colour?: string; note?: string }

export function HBars({ items, f = 'count', max, emptyText, limit = 10, labelWidth = 150, total }: {
  items: HBarItem[]; f?: Fmt; max?: number; emptyText?: string; limit?: number; labelWidth?: number; total?: number
}) {
  const [open, setOpen] = React.useState(false)
  if (!items.length || items.every(i => !i.value)) return <EmptyChart text={emptyText} height={90} />
  const shown = open ? items : items.slice(0, limit)
  const top = max ?? Math.max(...items.map(i => i.value), 1)
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {shown.map(i => (
        <div key={i.key} title={i.note || `${i.label}: ${format(i.value, f)}${total ? ` (${Math.round((i.value / total) * 100)}%)` : ''}`}
             style={{ display: 'grid', gridTemplateColumns: `minmax(80px, ${labelWidth}px) 1fr auto`, gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: F.tiny, color: C.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</span>
          <div style={{ height: 12, background: C.sunken, borderRadius: R.pill, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max((i.value / top) * 100, i.value > 0 ? 2 : 0)}%`, height: '100%', background: i.colour || VIZ.series[0], borderRadius: R.pill, transition: 'width .5s cubic-bezier(.22,1,.36,1)' }} />
          </div>
          <span style={{ fontSize: F.tiny, color: C.ink, fontWeight: W.semi, minWidth: 44, textAlign: 'right', ...numeric }}>
            {format(i.value, f)}{total ? <span style={{ color: C.faint, fontWeight: W.regular }}> · {Math.round((i.value / total) * 100)}%</span> : null}
            {i.sub && <span style={{ color: C.faint, fontWeight: W.regular }}> {i.sub}</span>}
          </span>
        </div>
      ))}
      {items.length > limit && (
        <button onClick={() => setOpen(o => !o)} style={{ justifySelf: 'start', background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          {open ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Segmented bar — one whole, split into parts
// ───────────────────────────────────────────────────────────────────────────

export function Segmented({ parts, f = 'count', height = 28, colours }: {
  parts: { key: string; label: string; value: number }[]; f?: Fmt; height?: number; colours?: string[]
}) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const [hover, setHover] = React.useState<number | null>(null)
  if (!total) return <EmptyChart text="Nothing recorded yet." height={56} />
  const col = (i: number) => (colours && colours[i]) || seriesColour(i)
  return (
    <div>
      <div role="img" aria-label={parts.map(p => `${p.label} ${format(p.value, f)}`).join(', ')}
           style={{ display: 'flex', gap: 2, height, borderRadius: R.sm, overflow: 'hidden' }} onMouseLeave={() => setHover(null)}>
        {parts.map((p, i) => p.value > 0 && (
          <div key={p.key} onMouseEnter={() => setHover(i)} title={`${p.label}: ${format(p.value, f)} (${Math.round((p.value / total) * 100)}%)`}
               style={{
                 flex: `${p.value} 0 0`, background: col(i), borderRadius: 4, minWidth: 3, display: 'flex', alignItems: 'center', paddingLeft: 7,
                 color: C.onAccent, fontSize: F.micro, fontWeight: W.bold, opacity: hover == null || hover === i ? 1 : 0.55, transition: 'opacity .15s', overflow: 'hidden', whiteSpace: 'nowrap', ...numeric,
               }}>
            {height >= 24 && p.value / total >= 0.1 ? `${Math.round((p.value / total) * 100)}%` : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: S.sm }}>
        {parts.map((p, i) => (
          <span key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.inkSoft }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: col(i) }} />
            {p.label} <strong style={{ color: C.ink, ...numeric }}>{format(p.value, f)}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Funnel — stages that only narrow
// ───────────────────────────────────────────────────────────────────────────

export function Funnel({ steps }: { steps: { key: string; label: string; value: number; conversion: number | null }[] }) {
  const top = Math.max(...steps.map(s => s.value), 0)
  if (!top) return <EmptyChart text="No candidates in this period." />
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 74px', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: F.tiny, color: C.inkSoft }}>{s.label}</span>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div title={`${s.label}: ${s.value}`} style={{
              width: `${Math.max((s.value / top) * 100, s.value ? 3 : 0)}%`, height: 24, borderRadius: 4,
              background: VIZ.seq[Math.max(2, 5 - Math.floor(i * 0.7))], display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.onAccent, fontSize: F.micro, fontWeight: W.bold, ...numeric, transition: 'width .5s cubic-bezier(.22,1,.36,1)',
            }}>{s.value / top >= 0.12 ? s.value : ''}</div>
          </div>
          <span style={{ fontSize: F.tiny, color: C.muted, textAlign: 'right', ...numeric }}>
            {s.value / top < 0.12 ? <strong style={{ color: C.ink }}>{s.value} </strong> : null}
            {s.conversion != null ? `${Math.round(s.conversion)}%` : ''}
          </span>
        </div>
      ))}
      <div style={{ fontSize: F.micro, color: C.faint, textAlign: 'right' }}>% = carried on from the stage above</div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Heat grid — rows × columns, magnitude in one hue
// ───────────────────────────────────────────────────────────────────────────

export function HeatGrid({ rows, cols, f = 'pct', max, note, emptyText }: {
  rows: { key: string; label: string; cells: (number | null)[]; counts?: number[] }[]; cols: string[]; f?: Fmt; max?: number; note?: string; emptyText?: string
}) {
  const vals = rows.flatMap(r => r.cells).filter((v): v is number => v != null)
  if (!rows.length || !vals.length) return <EmptyChart text={emptyText} />
  const top = max ?? Math.max(...vals, 1)
  const step = (v: number) => Math.min(5, Math.max(1, Math.ceil((v / top) * 5)))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%', fontSize: F.tiny }}>
        <thead>
          <tr>
            <th />
            {cols.map(c => <th key={c} style={{ fontWeight: W.semi, color: C.muted, padding: '0 2px 4px', textAlign: 'center' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={{ color: C.inkSoft, paddingRight: 8, whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</td>
              {r.cells.map((v, i) => {
                const s = v == null ? 0 : step(v)
                return (
                  <td key={i} title={`${r.label} · ${cols[i]}: ${v == null ? 'no data' : format(v, f)}${r.counts ? ` (${r.counts[i]} days)` : ''}`}
                      style={{
                        background: v == null ? C.sunken : VIZ.seq[s], color: s >= 4 ? C.onAccent : C.ink, textAlign: 'center',
                        borderRadius: 4, height: 30, minWidth: 40, fontWeight: W.semi, ...numeric,
                      }}>{v == null ? '' : format(v, f)}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: F.micro, color: C.muted }}>
        <span>Low</span>
        {[1, 2, 3, 4, 5].map(s => <span key={s} aria-hidden style={{ width: 18, height: 8, borderRadius: 2, background: VIZ.seq[s] }} />)}
        <span>High</span>
        {note && <span style={{ marginLeft: 'auto', color: C.faint }}>{note}</span>}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Attendance days — calendar heat strip and the team grid
// ───────────────────────────────────────────────────────────────────────────

/** Attendance is state, so it wears the state colours — the same meaning as the ESS
 *  calendar — with a letter code beside it, never colour alone. */
export const DAY: Record<DayKind, { code: string; label: string; bg: string; fg: string; edge: string }> = {
  PRESENT:     { code: 'P',  label: 'Present',        bg: C.positiveTint, fg: C.positive, edge: C.positiveEdge },
  IN_PROGRESS: { code: 'P',  label: 'At work now',    bg: C.positiveTint, fg: C.positive, edge: C.positiveEdge },
  LATE:        { code: 'LT', label: 'Late',           bg: C.warningTint,  fg: C.warning,  edge: C.warningEdge },
  HALF_DAY:    { code: '½',  label: 'Half day',       bg: C.warningTint,  fg: C.warning,  edge: C.warningEdge },
  MISS_IN:     { code: 'MI', label: 'Missed punch-in', bg: C.criticalTint, fg: C.critical, edge: C.criticalEdge },
  MISS_OUT:    { code: 'MO', label: 'Missed punch-out', bg: C.criticalTint, fg: C.critical, edge: C.criticalEdge },
  ABSENT:      { code: 'A',  label: 'Absent',         bg: C.critical,     fg: C.onAccent, edge: C.critical },
  LEAVE:       { code: 'L',  label: 'Leave',          bg: C.infoTint,     fg: C.info,     edge: C.infoEdge },
  HALF_LEAVE:  { code: '½L', label: 'Half-day leave', bg: C.infoTint,     fg: C.info,     edge: C.infoEdge },
  HOLIDAY:     { code: 'H',  label: 'Holiday',        bg: C.brandTint,    fg: C.brandDeep, edge: C.brandEdge },
  WEEKLY_OFF:  { code: 'WO', label: 'Weekly off',     bg: C.sunken,       fg: C.faint,    edge: C.line },
  UPCOMING:    { code: '',   label: 'Upcoming',       bg: C.surface,      fg: C.faint,    edge: C.line },
  NOT_JOINED:  { code: '',   label: 'Before joining', bg: C.surface,      fg: C.faint,    edge: C.line },
}

const LEGEND_KINDS: DayKind[] = ['PRESENT', 'LATE', 'HALF_DAY', 'MISS_OUT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF']

export function DayLegend({ kinds = LEGEND_KINDS }: { kinds?: DayKind[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: S.sm }}>
      {kinds.map(k => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: F.micro, color: C.inkSoft }}>
          <span aria-hidden style={{ minWidth: 18, height: 14, padding: '0 3px', borderRadius: 3, background: DAY[k].bg, color: DAY[k].fg, border: `1px solid ${DAY[k].edge}`, fontSize: 9, fontWeight: W.bold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{DAY[k].code}</span>
          {DAY[k].label}
        </span>
      ))}
    </div>
  )
}

/** Weeks as columns, weekdays as rows — six months of someone's days at a glance. */
export function DayCalendar({ days, cell = 14, detail }: { days: { date: string; kind: DayKind }[]; cell?: number; detail?: (date: string) => string }) {
  // On a narrow screen the strip scrolls; open it on the most recent weeks, not the oldest.
  const box = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => { if (box.current) box.current.scrollLeft = box.current.scrollWidth }, [days.length])
  if (!days.length) return <EmptyChart text="No days to show." />
  const first = new Date(days[0].date + 'T00:00:00Z')
  const offset = (first.getUTCDay() + 6) % 7          // Monday = row 0
  const cells: ({ date: string; kind: DayKind } | null)[] = [...new Array(offset).fill(null), ...days]
  const weeks = Math.ceil(cells.length / 7)
  const monthAt: { col: number; label: string }[] = []
  for (let w = 0; w < weeks; w++) {
    const d = cells.slice(w * 7, w * 7 + 7).find(Boolean)
    if (d && (w === 0 || Number(d.date.slice(8, 10)) <= 7)) {
      const lab = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.date.slice(5, 7)) - 1]
      if (!monthAt.length || monthAt[monthAt.length - 1].label !== lab) monthAt.push({ col: w, label: lab })
    }
  }
  const gap = 3
  return (
    <div ref={box} style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'inline-grid', gridTemplateColumns: `22px repeat(${weeks}, ${cell}px)`, gridTemplateRows: `14px repeat(7, ${cell}px)`, gap }}>
        <span />
        {Array.from({ length: weeks }, (_, w) => {
          const m = monthAt.find(x => x.col === w)
          return <span key={w} style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>{m?.label || ''}</span>
        })}
        {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, r) => (
          <React.Fragment key={r}>
            <span style={{ gridColumn: 1, gridRow: r + 2, fontSize: 9, color: C.faint, lineHeight: `${cell}px` }}>{d}</span>
            {Array.from({ length: weeks }, (_, w) => {
              const c = cells[w * 7 + r]
              const m = c ? DAY[c.kind] : null
              return (
                <span key={w} title={c ? `${c.date}: ${m!.label}${detail ? detail(c.date) : ''}` : undefined}
                      style={{
                        gridColumn: w + 2, gridRow: r + 2, borderRadius: 3,
                        background: c ? (c.kind === 'PRESENT' || c.kind === 'IN_PROGRESS' ? C.positive : c.kind === 'LATE' ? C.warning : m!.bg) : 'transparent',
                        border: c ? `1px solid ${c.kind === 'PRESENT' || c.kind === 'IN_PROGRESS' ? C.positive : c.kind === 'LATE' ? C.warning : m!.edge}` : 'none',
                      }} />
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

/** A whole team across a month: one row per person, the ESS letter codes in each cell. */
export function TeamDayGrid({ members, dates, today }: {
  members: { id: string; name: string; days: DayKind[]; sub?: string }[]; dates: string[]; today: string
}) {
  if (!members.length) return <EmptyChart text="Nobody in this team yet." />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, background: C.surface, zIndex: Z.raised, textAlign: 'left', minWidth: 150 }} />
            {dates.map(d => {
              const wd = new Date(d + 'T00:00:00Z').getUTCDay()
              return (
                <th key={d} style={{ width: 24, fontWeight: d === today ? W.bold : W.medium, color: d === today ? C.brand : C.muted, textAlign: 'center' }}>
                  <div>{Number(d.slice(8, 10))}</div>
                  <div style={{ fontSize: 8, color: C.faint }}>{'SMTWTFS'[wd]}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td style={{ position: 'sticky', left: 0, background: C.surface, zIndex: Z.raised, paddingRight: 8, whiteSpace: 'nowrap', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <div style={{ fontSize: F.tiny, color: C.ink, fontWeight: W.medium }}>{m.name}</div>
                {m.sub && <div style={{ fontSize: 10, color: C.faint }}>{m.sub}</div>}
              </td>
              {m.days.map((k, i) => {
                const s = DAY[k]
                return (
                  <td key={i} title={`${m.name} · ${dates[i]}: ${s.label}`} style={{
                    width: 24, height: 22, textAlign: 'center', borderRadius: 4, background: s.bg, color: s.fg,
                    border: `1px solid ${dates[i] === today ? C.brand : s.edge}`, fontWeight: W.bold, fontSize: 9,
                  }}>{s.code}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Scores and ratings
// ───────────────────────────────────────────────────────────────────────────

export function ScoreRing({ score, size = 112, label = 'out of 100' }: { score: number | null; size?: number; label?: string }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r
  const t: Tone = score == null ? 'neutral' : score >= 75 ? 'positive' : score >= 55 ? 'warning' : 'critical'
  const k = tone(t)
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} role="img" aria-label={score == null ? 'Not enough data' : `${score} ${label}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.sunken} strokeWidth={8} />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={k.fg} strokeWidth={8} strokeLinecap="round"
                  strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  style={{ transition: 'stroke-dasharray .8s cubic-bezier(.22,1,.36,1)' }} />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: size * 0.28, fontWeight: W.bold, color: C.ink, lineHeight: 1 }}>{score ?? '—'}</div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{score == null ? 'not enough data' : label}</div>
      </div>
    </div>
  )
}

/** Rating distribution as columns, with the reference curve as a tick on each. */
export function RatingCurve({ dist, height = 190 }: { dist: { key: string; label: string; value: number; share: number | null; reference: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const n = dist.reduce((s, d) => s + d.value, 0)
  if (!n) return <EmptyChart text="No finalised ratings in this cycle yet." height={height} />
  const top = Math.max(60, ...dist.map(d => d.share || 0), ...dist.map(d => d.reference))
  const padL = 36, padB = 34, padT = 12
  const plotW = Math.max(10, width - padL - 8), plotH = height - padB - padT
  const band = plotW / dist.length
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const ticks = niceTicks(top, 3)
  return (
    <div>
      <div ref={ref} style={{ width: '100%' }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Rating distribution against the reference curve">
            {ticks.filter(t => t <= top).map(t => (
              <g key={t}>
                <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} stroke={VIZ.grid} />
                <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" style={axisText}>{t}%</text>
              </g>
            ))}
            {dist.map((d, i) => {
              const cx = padL + band * i + band / 2, bw = Math.min(28, band * 0.5)
              const s = d.share || 0
              return (
                <g key={d.key}>
                  <title>{`${d.label}: ${d.value} (${Math.round(s)}%) · reference ${d.reference}%`}</title>
                  <path d={roundedTop(cx - bw / 2, y(s), bw, y(0) - y(s), Math.min(4, y(0) - y(s)))} fill={VIZ.series[0]} />
                  <line x1={cx - bw / 2 - 6} x2={cx + bw / 2 + 6} y1={y(d.reference)} y2={y(d.reference)} stroke={C.ink} strokeWidth={2} strokeLinecap="round" />
                  {s > 0 && <text x={cx} y={y(s) - 6} textAnchor="middle" style={{ ...axisText, fill: C.ink, fontWeight: W.semi }}>{Math.round(s)}%</text>}
                  <text x={cx} y={height - 18} textAnchor="middle" style={{ ...axisText, fill: C.inkSoft, fontWeight: W.semi }}>{d.key}</text>
                  <text x={cx} y={height - 5} textAnchor="middle" style={{ ...axisText, fontSize: 10 }}>{d.value} {d.value === 1 ? 'person' : 'people'}</text>
                </g>
              )
            })}
            <line x1={padL} x2={width - 8} y1={y(0)} y2={y(0)} stroke={C.lineStrong} />
          </svg>
        )}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: F.tiny, color: C.inkSoft }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: VIZ.series[0] }} />Actual share</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ width: 14, height: 2, background: C.ink }} />Reference curve (10 / 20 / 40 / 20 / 10)</span>
      </div>
    </div>
  )
}

/** A thin meter: a share of something, with the track in the same family. */
export function Meter({ value, t = 'brand', height = 8 }: { value: number | null; t?: Tone; height?: number }) {
  const k = tone(t)
  return (
    <div style={{ height, background: C.sunken, borderRadius: R.pill, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, height: '100%', background: t === 'brand' ? C.brand : k.fg, borderRadius: R.pill, transition: 'width .6s cubic-bezier(.22,1,.36,1)' }} />
    </div>
  )
}

/** A compact, sortable-looking table for the people lists beside a chart. */
export function MiniTable({ head, rows, empty = 'Nobody to list.', align, limit = 12 }: { head: string[]; rows: React.ReactNode[][]; empty?: string; align?: ('left' | 'right' | 'center')[]; limit?: number }) {
  const [all, setAll] = React.useState(false)
  if (!rows.length) return <div style={{ fontSize: F.small, color: C.muted, padding: '10px 0' }}>{empty}</div>
  const shown = all ? rows : rows.slice(0, limit)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.tiny }}>
        <thead>
          <tr>{head.map((h, i) => <th key={h} style={{ ...eyebrow, fontSize: 10, textAlign: align?.[i] || 'left', padding: '6px 8px', borderBottom: `1px solid ${C.line}`, background: C.sunken, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="ez-row">
              {r.map((c, j) => <td key={j} style={{ padding: '7px 8px', borderBottom: `1px solid ${C.line}`, color: j === 0 ? C.ink : C.inkSoft, textAlign: align?.[j] || 'left', verticalAlign: 'top', ...numeric }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button onClick={() => setAll(a => !a)} style={{ background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', padding: '8px 0 0', fontFamily: 'inherit' }}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}

export function Pill({ children, t = 'neutral' }: { children: React.ReactNode; t?: Tone }) {
  const k = tone(t)
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: R.pill, background: k.bg, color: k.fg, border: `1px solid ${k.edge}`, fontSize: F.micro, fontWeight: W.semi, whiteSpace: 'nowrap' }}>{children}</span>
}
