'use client'
// components/analytics/RiskTable.tsx — the explained flight-risk list.
//
// Shared by HR's Attrition tab and a manager's "Needs a conversation". Each row opens
// to show every signal and its weight, so the level is never a black box.

import * as React from 'react'
import { C, F, W, R, numeric } from '@/lib/ui'
import type { RiskRow } from '@/lib/analytics/types'
import { Pill } from './charts'

export function RiskTable({ rows, empty = 'Nobody shows two or more warning signs right now.' }: { rows: RiskRow[]; empty?: string }) {
  const [open, setOpen] = React.useState<string | null>(null)
  if (!rows.length) return <div style={{ fontSize: F.small, color: C.muted, padding: '8px 0' }}>{empty}</div>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(r => (
        <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden' }}>
          <button onClick={() => setOpen(o => (o === r.id ? null : r.id))} aria-expanded={open === r.id} style={{
            width: '100%', display: 'grid', gridTemplateColumns: 'minmax(140px,1.2fr) minmax(100px,1fr) auto auto', gap: 10, alignItems: 'center',
            padding: '9px 12px', background: C.surface, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: F.small, color: C.ink, fontWeight: W.semi }}>{r.name}</span>
              <span style={{ display: 'block', fontSize: F.micro, color: C.muted }}>{[r.code, r.designation].filter(Boolean).join(' · ')}</span>
            </span>
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {r.signals.slice(0, 3).map(s => <Pill key={s.code}>{s.label}</Pill>)}
              {r.signals.length > 3 && <Pill>+{r.signals.length - 3}</Pill>}
            </span>
            <Pill t={r.level === 'high' ? 'critical' : 'warning'}>{r.level === 'high' ? 'High' : 'Medium'}</Pill>
            <span aria-hidden style={{ color: C.faint }}>{open === r.id ? '▾' : '▸'}</span>
          </button>
          {open === r.id && (
            <div style={{ padding: '8px 14px 12px', background: C.sunken, display: 'grid', gap: 5 }}>
              {r.signals.map(s => (
                <div key={s.code} style={{ fontSize: F.tiny, color: C.inkSoft, display: 'flex', gap: 8 }}>
                  <span style={{ color: C.faint, ...numeric }}>+{s.weight}</span>
                  <span><strong style={{ color: C.ink }}>{s.label}.</strong> {s.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
