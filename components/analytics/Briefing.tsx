'use client'
// components/analytics/Briefing.tsx — the executive briefing on Pulse: the month on one
// page. What changed, the likely causes, and three things to do, each with an owner and
// a time frame. "Last month" is the default (a whole month is the honest comparison);
// "This month so far" sets the same days of the two months side by side.
//
// The same view prints as a one-page PDF for a board pack, with the headline tiles on
// top. The route always answers (components/analytics/Written.tsx): AI-written when the
// model passed the number check, rule-written otherwise.

import * as React from 'react'
import { C, F, W, R, S, tone, Skeleton as Sk } from '@/lib/ui'
import type { Kpi, MoverWindowKey } from '@/lib/analytics/types'
import type { AiResponse } from '@/lib/analytics/ai/types'
import type { Briefing } from '@/lib/analytics/briefs'
import { authHeaders } from '@/lib/auth-headers'
import { KpiRow } from './charts'
import { WrittenCard, AiMark, SourceLine, Evidence, useWritten, type WrittenState } from './Written'
import { WhyButton } from './why'
import { usePrinting } from './printing'
import { usePdfExport, DownloadMenu, bylineOf, istDay } from './export'

const AREA: Record<string, string> = { workforce: 'Workforce', attrition: 'Attrition', attendance: 'Attendance', leave: 'Leave', performance: 'Performance', learning: 'Learning', hiring: 'Hiring', cost: 'Pay & cost' }

export interface BriefingHandle { state: WrittenState<Briefing>; win: MoverWindowKey; setWin: (w: MoverWindowKey) => void }

/** Loads the briefing for the page's filters (`query`); `dataKey` changes when the
 *  figures reload. Held by the page so the Excel and full-report PDF can carry it. */
export function useBriefing(query: string, dataKey: string): BriefingHandle {
  const [win, setWin] = React.useState<MoverWindowKey>('last')
  const state = useWritten<Briefing>(async refresh => {
    const qs = new URLSearchParams(query)
    qs.set('window', win)
    if (refresh) qs.set('refresh', '1')
    const res = await fetch(`/api/analytics/org/briefing?${qs}`, { headers: await authHeaders(), cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body as AiResponse<Briefing>
  }, dataKey ? `${query}|${dataKey}|${win}` : '')
  return { state, win, setWin }
}

export function ExecutiveBriefing({ handle, kpis, scopeLine, viewer, canDownload }: {
  handle: BriefingHandle; kpis: Kpi[]; scopeLine: string; viewer?: string | null; canDownload: boolean
}) {
  const { state, win, setWin } = handle
  const printing = usePrinting()
  const pdf = usePdfExport()
  const b = state.res?.result

  const download = () => b && pdf.run({
    title: `Executive briefing — ${b.window.month}`, subtitle: `${scopeLine} · ${b.window.label}`, byline: bylineOf(viewer),
    filename: `EZER-executive-briefing-${b.window.from.slice(0, 7)}-${istDay()}.pdf`,
    sections: [{ key: 'b', node: <><KpiRow items={kpis} /><BriefingView state={state} /></> }],
  })

  return (
    <WrittenCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
        <AiMark label="Executive briefing" ai={b?.source === 'ai'} />
        {b && <span style={{ fontSize: F.tiny, color: C.muted }}>· {b.window.label}</span>}
        <span style={{ flex: 1 }} />
        {!printing && <div role="group" aria-label="Which month" style={{ display: 'inline-flex', gap: 2, padding: 2, background: C.sunken, borderRadius: R.md }}>
          {([['last', 'Last month'], ['mtd', 'This month so far']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setWin(k)} aria-pressed={win === k} className="ez-press" style={{
              border: 'none', borderRadius: R.sm, padding: '5px 10px', fontSize: F.micro, fontFamily: 'inherit', cursor: 'pointer',
              background: win === k ? C.surface : 'transparent', color: win === k ? C.brandDeep : C.muted, fontWeight: win === k ? W.semi : W.medium,
            }}>{l}</button>
          ))}
        </div>}
        {canDownload && b && !printing && <DownloadMenu variant="secondary" step={pdf.step} options={[{ key: 'pdf', label: 'One-page PDF', hint: 'For a board pack: the headline figures and this briefing', run: download }]} />}
      </div>
      {state.error && <div style={{ fontSize: F.small, color: tone('warning').fg }}>{state.error}</div>}
      {!b && !state.error && <BriefingSkeleton />}
      {b && <div style={{ opacity: state.busy ? 0.55 : 1, transition: 'opacity .2s' }}><BriefingView state={state} /></div>}
      {pdf.stage}
    </WrittenCard>
  )
}

function BriefingSkeleton() {
  return (
    <div>
      <Sk w="70%" h={18} /><div style={{ height: 14 }} />
      <div style={{ display: 'grid', gap: S.lg, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
        {[0, 1, 2].map(i => <div key={i} style={{ display: 'grid', gap: 8 }}><Sk w="40%" h={10} /><Sk h={12} /><Sk w="85%" h={12} /><Sk w="70%" h={12} /></div>)}
      </div>
    </div>
  )
}

/** The briefing itself — on the page and in the PDF. */
export function BriefingView({ state }: { state: WrittenState<Briefing> }) {
  const printing = usePrinting()
  const b = state.res?.result
  if (!b) return null
  return (
    <div>
      <div style={{ fontSize: F.title, fontWeight: W.semi, color: C.ink, lineHeight: 1.35, letterSpacing: '-.01em', marginBottom: S.lg }}>{b.headline}</div>
      <div style={{ display: 'grid', gap: S.lg, gridTemplateColumns: printing ? '1.1fr 1fr 1.1fr' : 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', alignItems: 'start' }}>
        <Column title="What changed">
          {b.changes.length === 0 && <Quiet>No headline figure moved much in this window.</Quiet>}
          {b.changes.map((c, i) => {
            const k = tone(c.good == null ? 'neutral' : c.good ? 'positive' : 'critical')
            return (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-label={c.dir === 'up' ? 'Up' : 'Down'} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: R.pill, background: k.bg, border: `1px solid ${k.edge}`, color: k.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{c.dir === 'up' ? '▲' : '▼'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, lineHeight: 1.4 }}>{c.title}</div>
                    {c.topic && <WhyButton topic={c.topic} />}
                  </div>
                  {c.detail && <div style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{c.detail}</div>}
                  <Evidence items={c.evidence} />
                </div>
              </div>
            )
          })}
        </Column>
        <Column title="Likely causes">
          {b.causes.length === 0 && <Quiet>No single department, site or weekday stands behind the changes.</Quiet>}
          {b.causes.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <span aria-hidden style={{ flexShrink: 0, width: 6, height: 6, borderRadius: R.pill, background: C.brand, marginTop: 7 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.5 }}>{c.text}</div>
                <Evidence items={c.evidence} />
              </div>
            </div>
          ))}
        </Column>
        <Column title={`${b.actions.length === 3 ? 'Three' : b.actions.length} thing${b.actions.length === 1 ? '' : 's'} to do`}>
          {b.actions.length === 0 && <Quiet>Nothing urgent — keep the regular reviews going.</Quiet>}
          {b.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: C.sunken, borderRadius: R.md }}>
              <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: R.pill, background: C.brand, color: C.onAccent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: F.micro, fontWeight: W.bold }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, lineHeight: 1.4 }}>{a.action}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '5px 0 3px' }}>
                  <Tag>{a.owner}</Tag><Tag>{a.when}</Tag><Tag soft>{AREA[a.area] || a.area}</Tag>
                </div>
                {a.why && <div style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.5 }}>Why: {a.why}</div>}
                <Evidence items={a.evidence} />
              </div>
            </div>
          ))}
        </Column>
      </div>
      <SourceLine state={state} />
    </div>
  )
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: S.sm }}>{title}</div>
      <div style={{ display: 'grid', gap: S.md }}>{children}</div>
    </div>
  )
}

const Quiet = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: F.small, color: C.muted }}>{children}</div>

function Tag({ children, soft }: { children: React.ReactNode; soft?: boolean }) {
  return <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '2px 8px', borderRadius: R.pill, background: soft ? 'transparent' : C.surface, border: `1px solid ${C.line}`, color: soft ? C.muted : C.inkSoft }}>{children}</span>
}
