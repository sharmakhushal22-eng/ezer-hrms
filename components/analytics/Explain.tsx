'use client'
// components/analytics/Explain.tsx — the "Why?" panel.
//
// A leader clicks "Why?" on a tile, a chart or a finding. The panel opens at once with
// the answer in words and the table that answers it: which departments, sites,
// weekdays, leave types or sources moved the figure, and how much of the change each
// accounts for. That table is plain arithmetic (lib/analytics/movers.ts) and is the same
// whether AI is on or not; the AI joins it up into causes and suggests what to check.

import * as React from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, S, E, Z, tone, numeric } from '@/lib/ui'
import type { Mover, MoverBreakdown, MoverWindowKey } from '@/lib/analytics/types'
import type { AiResponse } from '@/lib/analytics/ai/types'
import { unitOf, type Explanation } from '@/lib/analytics/briefs'
import { authHeaders } from '@/lib/auth-headers'
import { fmt } from '@/lib/analytics/format'
import { ExplainContext } from './why'
import { AiMark, SourceLine, Evidence, useWritten } from './Written'

/** Wrap a page in this to give its charts, tiles and findings a "Why?" button. */
export function ExplainProvider({ query, dataKey, children }: { query: string; dataKey: string; children: React.ReactNode }) {
  const [topic, setTopic] = React.useState<string | null>(null)
  return (
    <ExplainContext.Provider value={setTopic}>
      {children}
      {topic && <ExplainPanel key={topic} topic={topic} query={query} dataKey={dataKey} onClose={() => setTopic(null)} />}
    </ExplainContext.Provider>
  )
}

const defaultWindow = (): MoverWindowKey => (Number(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(8, 10)) >= 10 ? 'mtd' : 'last')

function ExplainPanel({ topic, query, dataKey, onClose }: { topic: string; query: string; dataKey: string; onClose: () => void }) {
  const [win, setWin] = React.useState<MoverWindowKey>(defaultWindow)
  const state = useWritten<Explanation>(async refresh => {
    const qs = new URLSearchParams(query)
    qs.set('topic', topic); qs.set('window', win)
    if (refresh) qs.set('refresh', '1')
    const res = await fetch(`/api/analytics/org/explain?${qs}`, { headers: await authHeaders(), cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body as AiResponse<Explanation>
  }, `${topic}|${win}|${query}|${dataKey}`)
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const x = state.res?.result

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: Z.drawer }} />
      <aside role="dialog" aria-modal="true" aria-label="Why this figure moved" className="ez-rise" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(600px, 100vw)', zIndex: Z.drawer + 1,
        background: C.surface, borderLeft: `1px solid ${C.line}`, boxShadow: E.overlay, display: 'flex', flexDirection: 'column',
        fontFamily: F.family, color: C.ink,
      }}>
        <header style={{ padding: `${S.lg}px ${S.lg}px ${S.md}px`, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
            <AiMark label="Why?" ai={x?.source === 'ai'} />
            <span style={{ flex: 1 }} />
            <button type="button" onClick={onClose} aria-label="Close" className="ez-press" style={{ border: `1px solid ${C.line}`, background: C.surface, borderRadius: R.sm, width: 30, height: 30, cursor: 'pointer', color: C.muted, fontSize: F.lead, lineHeight: 1 }}>×</button>
          </div>
          <h2 style={{ margin: `${S.md}px 0 ${S.sm}px`, fontSize: F.title, fontWeight: W.semi, lineHeight: 1.35, letterSpacing: '-.01em' }}>{x?.question || 'Working it out…'}</h2>
          <div role="group" aria-label="Compare" style={{ display: 'inline-flex', gap: 2, padding: 2, background: C.sunken, borderRadius: R.md }}>
            {([['mtd', 'This month so far'], ['last', 'Last month']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setWin(k)} aria-pressed={win === k} className="ez-press" style={{
                border: 'none', borderRadius: R.sm, padding: '5px 10px', fontSize: F.micro, fontFamily: 'inherit', cursor: 'pointer',
                background: win === k ? C.surface : 'transparent', color: win === k ? C.brandDeep : C.muted, fontWeight: win === k ? W.semi : W.medium,
              }}>{l}</button>
            ))}
          </div>
          {x?.window && <span style={{ marginLeft: S.sm, fontSize: F.micro, color: C.faint }}>{x.window.label}</span>}
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: S.lg, display: 'grid', gap: S.lg, alignContent: 'start', opacity: state.busy && x ? 0.6 : 1 }}>
          {state.error && <div style={{ fontSize: F.small, color: tone('warning').fg }}>{state.error}</div>}
          {!x && !state.error && <div style={{ fontSize: F.small, color: C.muted }}>Looking at what moved…</div>}
          {x && (
            <>
              <p style={{ margin: 0, fontSize: F.body, color: C.ink, lineHeight: 1.6 }}>{x.summary}</p>
              {x.reasons.length > 0 && (
                <div style={{ display: 'grid', gap: S.sm }}>
                  {x.reasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      <span aria-hidden style={{ flexShrink: 0, width: 6, height: 6, borderRadius: R.pill, background: C.brand, marginTop: 8 }} />
                      <div style={{ minWidth: 0 }}><div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{r.text}</div><Evidence items={r.evidence} /></div>
                    </div>
                  ))}
                </div>
              )}
              {x.movers.map(m => <MoverTable key={m.key} m={m} />)}
              {x.checks.length > 0 && (
                <div style={{ padding: '12px 14px', background: C.sunken, borderRadius: R.md }}>
                  <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Worth checking next</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                    {x.checks.map((c, i) => <li key={i} style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.5 }}>{c}</li>)}
                  </ul>
                </div>
              )}
              <SourceLine state={state} />
            </>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

const val = (v: number | null, f: Mover['fmt']) => (v == null ? '—' : f === 'pct' ? `${v.toFixed(1)}%` : f === 'days' ? fmt(v, 'days') : fmt(v, f))
const dval = (v: number | null, f: Mover['fmt']) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f === 'pct' ? `${Math.abs(v).toFixed(1)} pts` : f === 'money' ? fmt(Math.abs(v), 'money') : fmt(Math.abs(v), f === 'days' ? 'days' : 'count')}`)

/** One measure: the change, then a table per breakdown with each group's share of it. */
function MoverTable({ m }: { m: Mover }) {
  const [dim, setDim] = React.useState(0)
  const b: MoverBreakdown | undefined = m.by[dim]
  const goodWay = (d: number | null) => (d == null || !d || m.good === 'neutral' ? 'neutral' : (m.good === 'up') === d > 0 ? 'positive' : 'critical')
  const t = tone(goodWay(m.delta))
  const maxEff = Math.max(...(b?.rows.map(r => Math.abs(r.effect ?? 0)) || [0]), 0.0001)
  const f = b?.fmt || m.fmt
  // Rows in another unit (leave days under a share) have no good direction of their own.
  const rowTone = (d: number | null) => (f !== m.fmt ? 'neutral' : goodWay(d))
  return (
    <section style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', background: C.sunken, display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: F.small, color: C.ink }}>{m.label}</strong>
        <span style={{ fontSize: F.small, color: C.inkSoft, ...numeric }}>{val(m.before, m.fmt)} → <strong style={{ color: C.ink }}>{val(m.now, m.fmt)}</strong></span>
        {m.delta != null && <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '1px 7px', borderRadius: R.pill, background: t.bg, color: t.fg, border: `1px solid ${t.edge}`, ...numeric }}>{dval(m.delta, m.fmt)}</span>}
      </div>
      {m.notes.length > 0 && <div style={{ padding: '6px 12px 0', fontSize: F.micro, color: C.muted }}>{m.notes.join(' · ')}</div>}
      {m.by.length > 1 && (
        <div style={{ display: 'flex', gap: 4, padding: '8px 12px 0', flexWrap: 'wrap' }}>
          {m.by.map((x, i) => (
            <button key={x.dim} type="button" onClick={() => setDim(i)} aria-pressed={dim === i} style={{
              border: `1px solid ${dim === i ? C.brandEdge : C.line}`, background: dim === i ? C.brandTint : C.surface, color: dim === i ? C.brandDeep : C.muted,
              borderRadius: R.pill, padding: '2px 9px', fontSize: F.micro, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit',
            }}>{x.label}</button>
          ))}
        </div>
      )}
      {b ? (
        <div style={{ padding: '6px 12px 10px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.tiny }}>
            <thead>
              <tr>{['', 'Before', 'Now', 'Change', 'Share of the change'].map((h, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : i === 4 ? 'left' : 'right', padding: '6px 6px', color: C.faint, fontWeight: W.semi, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map(r => {
                const k = tone(rowTone(r.effect))
                return (
                  <tr key={r.label}>
                    <td style={{ padding: '6px', color: C.ink, borderBottom: `1px solid ${C.line}` }}>{r.label}<div style={{ fontSize: 10, color: C.faint }}>{r.n} {unitOf(r.n, b.unit)}</div></td>
                    <td style={{ padding: '6px', textAlign: 'right', color: C.muted, borderBottom: `1px solid ${C.line}`, ...numeric }}>{val(r.before, f)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', color: C.ink, borderBottom: `1px solid ${C.line}`, ...numeric }}>{val(r.now, f)}</td>
                    <td style={{ padding: '6px', textAlign: 'right', color: k.fg, fontWeight: W.semi, borderBottom: `1px solid ${C.line}`, ...numeric }}>{dval(r.delta, f)}</td>
                    <td style={{ padding: '6px', borderBottom: `1px solid ${C.line}`, minWidth: 110 }}>
                      {r.effect != null && <div title={`Accounts for ${dval(r.effect, f)} of the change`} style={{ height: 8, width: `${Math.max(4, (Math.abs(r.effect) / maxEff) * 100)}%`, background: k.fg, borderRadius: R.pill, opacity: 0.75 }} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {m.fmt === 'pct' && <div style={{ fontSize: 10, color: C.faint, marginTop: 6 }}>{`Groups with fewer than 20 ${b.unit} in a month are left out; their rate is noise. “Share of the change” weighs each group’s change by its size.`}</div>}
        </div>
      ) : <div style={{ padding: '10px 12px', fontSize: F.tiny, color: C.muted }}>No group stands out.</div>}
    </section>
  )
}
