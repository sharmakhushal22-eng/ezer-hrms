'use client'
// components/ess/payroll/claimsKit.tsx — small presentational pieces shared by the
// ESS claim screens (Investment Proofs, Flexi Claims, Travel Claims).
//
// Sits beside kit.tsx (the payroll design kit) and only adds what these three
// screens need on top of it: usage meters, form field chrome, a figure cell, a
// toast and the drawer scrim. Same house rules: tokens only, top-level
// components, no data loading, no business state.

import * as React from 'react'
import { C, F, W, S, R, E, M, Z, tone, eyebrow, numeric, type Tone } from '@/lib/ui'

/** Single-value meter, 0–1. Track is the sunken well; fill is the tone colour. */
export function Meter({ value, t = 'brand', height = 6, label }: { value: number; t?: Tone; height?: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      style={{ height, borderRadius: R.pill, background: C.sunken, border: `1px solid ${C.line}`, overflow: 'hidden', boxSizing: 'content-box' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: tone(t).fg, borderRadius: R.pill, transition: `width ${M.slow}` }} />
    </div>
  )
}

/** Stacked meter: several segments (each a share of `total`) on one track — e.g. approved + pending of a limit. */
export function SplitMeter({ total, parts, height = 8, label }: {
  total: number; parts: { value: number; t: Tone; label: string }[]; height?: number; label?: string
}) {
  const safe = total > 0 ? total : 0
  return (
    <div aria-label={label} role="img" style={{ display: 'flex', height, borderRadius: R.pill, background: C.sunken, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
      {parts.map(p => {
        const w = safe ? Math.max(0, Math.min(100, (p.value / safe) * 100)) : 0
        return w > 0 ? <div key={p.label} title={p.label} style={{ width: `${w}%`, height: '100%', background: tone(p.t).fg, transition: `width ${M.slow}` }} /> : null
      })}
    </div>
  )
}

/** Legend row for a SplitMeter: coloured dot, label, value. */
export function LegendDot({ t, label, value }: { t: Tone; label: React.ReactNode; value?: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.muted, ...numeric }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: tone(t).fg, flexShrink: 0 }} />
      <span>{label}</span>
      {value != null && <b style={{ color: C.ink, fontWeight: W.semi }}>{value}</b>}
    </span>
  )
}

/** A small label-over-figure cell, used inside cards. */
export function Figure({ label, value, t, hint, align = 'left' }: {
  label: React.ReactNode; value: React.ReactNode; t?: Tone; hint?: React.ReactNode; align?: 'left' | 'center'
}) {
  return (
    <div style={{ minWidth: 0, padding: `${S.sm + 2}px ${S.md}px`, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, textAlign: align }}>
      <div style={{ ...eyebrow, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: F.lead, fontWeight: W.bold, color: t ? tone(t).fg : C.ink, letterSpacing: '-.01em', ...numeric, overflowWrap: 'anywhere' }}>{value}</div>
      {hint && <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

/** Form label in the kit's eyebrow voice. */
export const fieldLabel: React.CSSProperties = { ...eyebrow, display: 'block', marginBottom: 5 }

/** Numbered sub-section heading inside a form card ("1  Journey details"). */
export function FormStep({ n, title, hint, right }: { n: number | string; title: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.sm + 2, marginBottom: S.md }}>
      <span aria-hidden style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: C.brandTint, color: C.brandDeep, border: `1px solid ${C.brandEdge}`,
        fontSize: F.micro, fontWeight: W.bold, ...numeric,
      }}>{n}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: F.body, fontWeight: W.semi, color: C.ink, lineHeight: 1.35 }}>{title}</div>
        {hint && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  )
}

/** Hairline between form sections. */
export function FormDivider() {
  return <div aria-hidden style={{ height: 1, background: C.line, margin: `${S.lg}px 0` }} />
}

/** Fixed toast, bottom-right, on the toast tier. Sits above the mobile tab bar. */
export function Toast({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="ez-rise" style={{
      position: 'fixed', bottom: 88, right: 24, left: 'auto', maxWidth: 'calc(100vw - 48px)', zIndex: Z.toast,
      background: C.ink, color: C.surface, padding: '11px 18px', borderRadius: R.md,
      fontSize: F.small, fontWeight: W.semi, boxShadow: E.overlay,
    }}>{children}</div>
  )
}

/** Translucent scrim colour built from the dark token, so it follows the theme. */
export const scrim = `color-mix(in srgb, ${C.dark} 45%, transparent)`
