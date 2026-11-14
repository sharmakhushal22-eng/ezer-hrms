'use client'
// components/analytics/Written.tsx — what the written pieces share on screen.
//
// The briefing, "Why?", the Monday note and the personal summary each arrive from a
// route that ALWAYS answers: the AI's version when it passed the number check, the
// template version otherwise. So nothing here shows an empty "AI is off" card — the
// small print says how the piece was written, and "Write again" asks for a fresh one.
//
// The rule findings (threshold checks) stay a separate, plain list: they never needed a
// model, and each can be explained with "Why?".

import * as React from 'react'
import { C, F, W, R, S, IconAi } from '@/lib/ui'
import type { Insight } from '@/lib/analytics/types'
import type { AiResponse } from '@/lib/analytics/ai/types'
import { InsightCard, EmptyChart } from './charts'
import { usePrinting } from './printing'

export interface WrittenState<T> { res: AiResponse<T> | null; busy: boolean; error: string; refresh: () => void }

/** Loads a written piece whenever `key` changes (new filters, new scope, new window).
 *  `load` may change identity on every render; only `key` decides when to ask again. */
export function useWritten<T>(load: ((refresh: boolean) => Promise<AiResponse<T>>) | null, key: string): WrittenState<T> {
  const [res, setRes] = React.useState<AiResponse<T> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const fn = React.useRef(load)
  React.useLayoutEffect(() => { fn.current = load })
  const seq = React.useRef(0)
  const run = React.useCallback((refresh: boolean) => {
    const f = fn.current
    if (!f) return
    const my = ++seq.current
    setBusy(true); setError('')
    f(refresh)
      .then(r => { if (my === seq.current) setRes(r) })
      .catch(e => { if (my === seq.current) setError(e?.message || 'This could not be loaded.') })
      .finally(() => { if (my === seq.current) setBusy(false) })
  }, [])
  React.useEffect(() => {
    if (!key) return
    run(false)
  }, [key, run])
  return { res, busy, error, refresh: () => run(true) }
}

export const modelName = (m: string) => m
  .replace(/^gemini-/, 'Gemini ').replace(/^claude-/, 'Claude ')
  .replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-latest$/, '').replace(/-/g, ' ')
  .replace(/\b(flash|lite|pro|opus|sonnet|haiku)\b/g, w => w[0].toUpperCase() + w.slice(1))

export function when(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

/** The badge that marks a written piece. */
export function AiMark({ label, ai = true }: { label: string; ai?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.07em' }}>
      <span aria-hidden style={{ width: 24, height: 24, borderRadius: R.pill, background: C.brandTint, border: `1px solid ${C.brandEdge}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.brand, opacity: ai ? 1 : 0.7 }}>
        <IconAi size={13} />
      </span>
      {label}
    </span>
  )
}

/** How the piece was written, and "Write again". */
export function SourceLine<T extends { source: 'ai' | 'rules'; model: string | null; generatedAt: string }>({ state }: { state: WrittenState<T> }) {
  const printing = usePrinting()
  const r = state.res
  if (!r) return null
  const p = r.result
  const text = p.source === 'ai'
    ? `Written by AI (${modelName(p.model || '')}) from the figures at ${when(p.generatedAt)}. Every number it quotes was checked against the figures.${r.stale && !printing ? ' The figures have moved a little since.' : ''}`
    : `Written from the figures by fixed rules${r.status === 'off' ? ' — AI is not switched on' : r.status === 'busy' ? ' — the AI did not answer in time' : r.status === 'empty' ? ' — the AI answer failed the number check' : ''}.`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: S.md, fontSize: F.micro, color: C.faint, lineHeight: 1.5 }}>
      <span style={{ flex: 1, minWidth: 200 }}>{text}</span>
      {!printing && r.status !== 'off' && (
        <button type="button" onClick={state.refresh} disabled={state.busy} className="ez-press" title="Ask for a fresh version from the current figures"
          style={{ border: `1px solid ${C.line}`, background: C.surface, color: state.busy ? C.faint : C.inkSoft, borderRadius: R.sm, padding: '3px 9px', fontSize: F.micro, fontWeight: W.semi, fontFamily: 'inherit', cursor: state.busy ? 'default' : 'pointer' }}>
          {state.busy ? 'Writing…' : 'Write again'}
        </button>
      )}
    </div>
  )
}

/** "Based on n figures" — the exact lines a written sentence rests on. */
export function Evidence({ items }: { items: string[] }) {
  const [open, setOpen] = React.useState(false)
  const printing = usePrinting()
  if (!items.length || printing) return null
  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi, color: C.brand }}>
        {open ? 'Hide the figures' : `Based on ${items.length} figure${items.length === 1 ? '' : 's'}`} {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul style={{ margin: '6px 0 0', padding: '8px 10px 8px 24px', background: C.sunken, borderRadius: R.sm, display: 'grid', gap: 4 }}>
          {items.map((x, n) => <li key={n} style={{ fontSize: F.micro, color: C.inkSoft, lineHeight: 1.5 }}>{x}</li>)}
        </ul>
      )}
    </div>
  )
}

/** The rule findings: threshold checks the system ran, each with "Why?" where offered. */
export function Findings({ rules, onOpen, areaLabel, grid, limit, empty, why }: {
  rules: Insight[]; onOpen?: (area: string) => void; areaLabel?: (area: string) => string | undefined
  grid?: boolean; limit?: number; empty?: string; why?: (i: Insight) => string | undefined
}) {
  const printing = usePrinting()
  const [all, setAll] = React.useState(false)
  const shown = limit && !all && !printing ? rules.slice(0, limit) : rules
  if (!rules.length) return <EmptyChart text={empty || 'Nothing stands out — every measure is inside its normal range.'} height={90} />
  return (
    <div>
      <div style={grid ? { display: 'grid', gap: S.sm, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px,100%), 1fr))' } : { display: 'grid', gap: S.sm }}>
        {shown.map(i => (
          <InsightCard key={i.id} i={i} areaLabel={areaLabel?.(i.area)} why={why?.(i)} onOpen={onOpen ? () => onOpen(i.area) : undefined} />
        ))}
      </div>
      {limit != null && rules.length > limit && !printing && (
        <button onClick={() => setAll(a => !a)} style={{ marginTop: S.sm, background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          {all ? 'Show fewer' : `Show all ${rules.length}`}
        </button>
      )}
    </div>
  )
}

/** A card frame shared by the written pieces. */
export function WrittenCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section aria-live="polite" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.brand}`, borderRadius: R.lg,
      padding: S.lg, marginBottom: S.lg, minWidth: 0, ...style,
    }}>{children}</section>
  )
}
