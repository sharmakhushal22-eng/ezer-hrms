'use client'
// components/analytics/AiBrief.tsx — the AI read on the analytics screens.
//
// The figures load first and are never held up by the model: the AI read arrives a
// few seconds later (or at once, from the cache) and takes the place of the rule
// sentences. The rule checks stay one click away ("Rule checks"), and are what the
// reader sees whenever the AI is off, busy, or its answer failed the number check.
//
// Every AI finding says what to do next and can show the exact figures it rests on —
// the same lines the model was given — so a reader can check it against the page.

import * as React from 'react'
import { C, F, W, R, S, E, Skeleton, IconAi, tone } from '@/lib/ui'
import type { Insight } from '@/lib/analytics/types'
import type { AiBriefResponse, AiFinding, AiNote as Note, AiAudience } from '@/lib/analytics/ai/types'
import { InsightCard, EmptyChart } from './charts'

export type AiLoad = (refresh: boolean) => Promise<AiBriefResponse>

export interface AiState { res: AiBriefResponse | null; busy: boolean; error: string; refresh: () => void }

/** Loads the AI read whenever `key` changes (new filters, new scope). `load` may change
 *  identity on every render; only `key` decides when to ask again. */
export function useAiBrief(load: AiLoad | null, key: string): AiState {
  const [res, setRes] = React.useState<AiBriefResponse | null>(null)
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
      .catch(e => { if (my === seq.current) setError(e?.message || 'The AI read could not be loaded.') })
      .finally(() => { if (my === seq.current) setBusy(false) })
  }, [])
  React.useEffect(() => {
    if (!key) return
    setRes(null)
    run(false)
  }, [key, run])
  return { res, busy, error, refresh: () => run(true) }
}

const MODEL_NAME = (m: string) => m
  .replace(/^gemini-/, 'Gemini ').replace(/^claude-/, 'Claude ')
  .replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-latest$/, '').replace(/-/g, ' ')
  .replace(/\b(flash|lite|pro|opus|sonnet|haiku)\b/g, w => w[0].toUpperCase() + w.slice(1))

function when(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

/** The badge that marks AI-written text, everywhere it appears. */
export function AiMark({ label = 'AI read' }: { label?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.06em' }}>
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: R.pill, background: C.brandTint, border: `1px solid ${C.brandEdge}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.brand }}>
        <IconAi size={13} />
      </span>
      {label}
    </span>
  )
}

/** Why there is no AI read — said for the person reading, not for the person who deploys. */
function unavailable(s: AiState, audience: AiAudience): { t: 'info' | 'warning'; text: string } | null {
  if (s.error) return { t: 'warning', text: audience === 'org' ? s.error : 'The AI read could not be loaded just now.' }
  const r = s.res
  if (!r || r.brief) return null
  if (r.status === 'off' && audience !== 'org') return { t: 'info', text: 'AI insights are not switched on for your company yet.' }
  return { t: r.status === 'off' || r.status === 'empty' ? 'info' : 'warning', text: r.message || 'No AI read this time.' }
}

/** Headline and summary, with who wrote it and when. */
export function AiBriefCard({ state, audience, style }: { state: AiState; audience: AiAudience; style?: React.CSSProperties }) {
  const { res, busy } = state
  const b = res?.brief
  const why = unavailable(state, audience)
  const canRefresh = !!res && res.status !== 'off'
  // An employee or manager cannot switch AI on, so an "off" card would only be noise
  // there. HR and admins see it, with what to set.
  if (audience !== 'org' && res?.status === 'off' && !b) return null
  return (
    <section aria-live="polite" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, padding: S.lg, marginBottom: S.lg, minWidth: 0, ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap' }}>
        <AiMark label={audience === 'org' ? 'AI briefing' : audience === 'team' ? 'AI read of your team' : 'AI read of your month'} />
        {canRefresh && (
          <button type="button" onClick={state.refresh} disabled={busy} className="ez-press"
            title="Ask the AI to read the current figures again"
            style={{ border: `1px solid ${C.line}`, background: C.surface, color: busy ? C.faint : C.inkSoft, borderRadius: R.sm, padding: '4px 10px', fontSize: F.micro, fontWeight: W.semi, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Reading…' : 'Read again'}
          </button>
        )}
      </div>

      {busy && !b && (
        <div style={{ marginTop: S.md }}>
          <div style={{ fontSize: F.small, color: C.muted, marginBottom: 10 }}>Reading the figures on this page…</div>
          <Skeleton w="72%" h={14} /><div style={{ height: 8 }} /><Skeleton w="94%" h={10} /><div style={{ height: 6 }} /><Skeleton w="60%" h={10} />
        </div>
      )}

      {b && (
        <div style={{ marginTop: S.md, opacity: busy ? 0.6 : 1, transition: 'opacity .2s' }}>
          {b.headline && <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink, lineHeight: 1.4, letterSpacing: '-.01em' }}>{b.headline}</div>}
          {b.summary && <p style={{ margin: `${b.headline ? 6 : 0}px 0 0`, fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>{b.summary}</p>}
          <div style={{ marginTop: S.sm, fontSize: F.micro, color: C.faint, lineHeight: 1.5 }}>
            Written by AI ({MODEL_NAME(b.model)}) from the figures on this page at {when(b.generatedAt)}
            {res?.stale ? ' — the figures may have moved since; "Read again" for a fresh read.' : '.'}
            {' '}Every number it quotes was checked against those figures.
          </div>
        </div>
      )}

      {!busy && why && (
        <div style={{ marginTop: S.sm, fontSize: F.tiny, color: tone(why.t).fg, lineHeight: 1.5 }}>{why.text}</div>
      )}
    </section>
  )
}

/** "AI read | Rule checks" — shown only when there is an AI read to choose. */
function Switch({ mode, set }: { mode: 'ai' | 'rules'; set: (m: 'ai' | 'rules') => void }) {
  return (
    <div role="tablist" aria-label="Findings" style={{ display: 'inline-flex', gap: 2, padding: 2, background: C.sunken, borderRadius: R.md, flexShrink: 0 }}>
      {([['ai', 'AI read'], ['rules', 'Rule checks']] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={mode === k} onClick={() => set(k)} className="ez-press" style={{
          border: 'none', borderRadius: R.sm, padding: '4px 10px', fontSize: F.micro, fontFamily: 'inherit', cursor: 'pointer',
          background: mode === k ? C.surface : 'transparent', color: mode === k ? C.brandDeep : C.muted, fontWeight: mode === k ? W.semi : W.medium,
          boxShadow: mode === k ? E.flat : 'none',
        }}>{l}</button>
      ))}
    </div>
  )
}

export function useFindingsMode(hasAi: boolean): ['ai' | 'rules', (m: 'ai' | 'rules') => void] {
  const [picked, setPicked] = React.useState<'ai' | 'rules' | null>(null)
  return [picked ?? (hasAi ? 'ai' : 'rules'), setPicked]
}

/** The findings, AI or rules. `grid` lays them out side by side (ESS), otherwise a list. */
export function Findings({ state, rules, mode, setMode, onOpen, areaLabel, grid, limit, empty }: {
  state: AiState; rules: Insight[]; mode: 'ai' | 'rules'; setMode: (m: 'ai' | 'rules') => void
  onOpen?: (area: string) => void; areaLabel?: (area: string) => string | undefined; grid?: boolean; limit?: number; empty?: string
}) {
  const [all, setAll] = React.useState(false)
  const ai = state.res?.brief?.findings ?? []
  const showAi = mode === 'ai' && ai.length > 0
  const items: (AiFinding | Insight)[] = showAi ? ai : rules
  const shown = limit && !all ? items.slice(0, limit) : items
  return (
    <div>
      {ai.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, marginBottom: S.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.micro, color: C.faint }}>
            {showAi ? 'Written by AI from the figures, with a next step for each.' : `The system's threshold checks — ${rules.length} fired.`}
          </span>
          <Switch mode={mode} set={setMode} />
        </div>
      )}
      {items.length === 0
        ? <EmptyChart text={empty || 'Nothing stands out — every measure is inside its normal range.'} height={90} />
        : (
          <div style={grid
            ? { display: 'grid', gap: S.sm, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px,100%), 1fr))' }
            : { display: 'grid', gap: S.sm }}>
            {shown.map(i => (
              <InsightCard key={i.id} i={i} areaLabel={areaLabel?.(i.area)}
                action={'action' in i ? i.action : undefined} evidence={'evidence' in i ? i.evidence : undefined}
                onOpen={onOpen ? () => onOpen(i.area) : undefined} />
            ))}
          </div>
        )}
      {limit != null && items.length > limit && (
        <button onClick={() => setAll(a => !a)} style={{ marginTop: S.sm, background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

/** One or two AI sentences at the top of a tab, about that tab's figures. */
export function AiNote({ note }: { note: Note }) {
  const [why, setWhy] = React.useState(false)
  return (
    <div className="ez-rise" style={{
      display: 'flex', gap: S.md, alignItems: 'flex-start', padding: '12px 14px', marginBottom: S.lg,
      background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.brand}`, borderRadius: R.md,
    }}>
      <AiMark label="" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{note.text}</div>
        <button type="button" aria-expanded={why} onClick={() => setWhy(w => !w)}
          style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi, color: C.brand }}>
          {why ? 'Hide the figures' : `AI read · based on ${note.evidence.length} figure${note.evidence.length === 1 ? '' : 's'}`} {why ? '▴' : '▾'}
        </button>
        {why && (
          <ul style={{ margin: '6px 0 0', padding: '8px 10px 8px 24px', background: C.sunken, borderRadius: R.sm, display: 'grid', gap: 4 }}>
            {note.evidence.map((x, n) => <li key={n} style={{ fontSize: F.micro, color: C.inkSoft, lineHeight: 1.5 }}>{x}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
