'use client'
// components/analytics/why.tsx — the "Why?" button on charts, headline tiles and findings.
//
// It shows only where a page has said it can answer (People Analytics wraps itself in
// <ExplainProvider>), never in the PDF, and opens components/analytics/Explain.tsx.
import * as React from 'react'
import { C, F, W, R } from '@/lib/ui'
import { usePrinting } from './printing'

export const ExplainContext = React.createContext<((topic: string) => void) | null>(null)

export function WhyButton({ topic, label = 'Why?' }: { topic: string; label?: string }) {
  const open = React.useContext(ExplainContext)
  const printing = usePrinting()
  if (!open || printing) return null
  return (
    <button type="button" className="ez-press" title="Explain what is behind this figure"
      onClick={e => { e.stopPropagation(); open(topic) }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: R.pill, flexShrink: 0,
        border: `1px solid ${C.brandEdge}`, background: C.brandTint, color: C.brandDeep, cursor: 'pointer',
        fontSize: F.micro, fontWeight: W.semi, fontFamily: 'inherit', lineHeight: 1.4, whiteSpace: 'nowrap',
      }}>
      <svg aria-hidden width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8" cy="8" r="6.5" /><path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.8c0 1.3-1.8 1.6-1.8 2.8" /><circle cx="8" cy="11.6" r=".4" fill="currentColor" /></svg>
      {label}
    </button>
  )
}
