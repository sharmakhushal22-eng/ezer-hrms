'use client'
// components/analytics/MySummary.tsx — an employee's month in three plain lines and one
// nudge (ESS → Insights → My insights). Friendly, about them only, never a comparison
// with a named colleague. Rule-written when AI is off; AI-written when it answered and
// passed the number check.

import * as React from 'react'
import { C, F, W, R, S } from '@/lib/ui'
import type { MySummary } from '@/lib/analytics/briefs'
import { WrittenCard, AiMark, SourceLine, type WrittenState } from './Written'

const ICON: Record<string, string> = { attendance: '◷', leave: '☼', performance: '◎', learning: '▤', pay: '₹', recognition: '★' }

export function MySummaryCard({ state, first }: { state: WrittenState<MySummary>; first: string }) {
  const s = state.res?.result
  return (
    <WrittenCard>
      <AiMark label={`${first}, your month in three lines`} ai={s?.source === 'ai'} />
      {!s && <div style={{ marginTop: S.md, fontSize: F.small, color: C.muted }}>{state.error || 'Reading your month…'}</div>}
      {s && (
        <div style={{ marginTop: S.md, opacity: state.busy ? 0.6 : 1, transition: 'opacity .2s' }}>
          <div style={{ display: 'grid', gap: S.sm }}>
            {s.lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span aria-hidden style={{ flexShrink: 0, width: 26, height: 26, borderRadius: R.pill, background: C.sunken, color: C.brandDeep, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: F.small }}>{ICON[l.area] || '•'}</span>
                <div style={{ fontSize: F.body, color: C.ink, lineHeight: 1.55, paddingTop: 2 }}>{l.text}</div>
              </div>
            ))}
          </div>
          {s.nudge && (
            <div style={{ marginTop: S.md, padding: '10px 14px', borderRadius: R.md, background: C.brandTint, border: `1px solid ${C.brandEdge}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.07em', paddingTop: 2, whiteSpace: 'nowrap' }}>One nudge</span>
              <span style={{ fontSize: F.small, color: C.ink, lineHeight: 1.5 }}>{s.nudge.text}</span>
            </div>
          )}
          <SourceLine state={state} />
        </div>
      )}
    </WrittenCard>
  )
}
