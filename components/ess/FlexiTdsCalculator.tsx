'use client'
// components/ess/FlexiTdsCalculator.tsx — Flexi + TDS calculator for the ESS Flexi section.
// Logic ported from the OFB TDS portal: 9 salary slabs, flexi wallet (Old/New regime),
// HRA exemption, 80C/80D/NPS/other deductions, old-vs-new regime tax comparison.
// EZER-themed. CTC auto-prefilled from the employee's ctc_master.
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { loadSalary, type SalaryStructure } from '@/lib/employees/hr-actions'
import * as XLSX from 'xlsx'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import {
  C as TK, F, W, S, R as RAD, E, M, tone, numeric, eyebrow,
  IconCheck, IconLock, IconDownload, IconUser, IconPayroll, IconCard, IconCalendar, IconEmployees,
  IconSliders, IconBuilding, IconFinance, IconHeart, IconAward, IconReceipt,
} from '@/lib/ui'
import {
  SectionCard, SubHead, KpiTile, KpiGrid, KeyValueGrid, StatusPill, InfoCallout, EmptyState,
  PButton, ActionBar, IconTile, DataTable, dt, IconArrowRight, IconCheckCircle, IconFile, IconLayers,
} from '@/components/ess/payroll/kit'

// ── Policy constants (OFB flexi + FY 2026-27 tax) ──
const SLAB_LABELS = ['≤5 LPA', '5.1–7.99 LPA', '8–11.99 LPA', '12–17.99 LPA', '18–24.99 LPA', '25–29.99 LPA', '30–39.99 LPA', '40–49.99 LPA', '50+ LPA']
const OLD: Record<string, number>[] = [
  {},
  { pda: 18000, fuel: 60000, meal: 55000, attire: 40000, childEdu: 36000, hostel: 84000 },
  { pda: 24000, device: 50000, fuel: 96000, meal: 55000, attire: 48000, childEdu: 36000, hostel: 84000 },
  { pda: 30000, tel: 18000, device: 50000, fuel: 144000, meal: 55000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 36000, tel: 18000, device: 90000, lta: 1, car: 216000, driver: 144000, fuel: 144000, meal: 80000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 48000, tel: 18000, device: 130000, lta: 1, car: 300000, driver: 192000, fuel: 160000, meal: 96000, attire: 78000, childEdu: 36000, hostel: 84000 },
  { pda: 54000, tel: 18000, device: 150000, lta: 1, car: 360000, driver: 240000, fuel: 192000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 420000, driver: 240000, fuel: 240000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 600000, driver: 240000, fuel: 300000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
]
const NEW: Record<string, number>[] = [
  {}, {},
  { device: 50000, fuel: 96000, meal: 55000 },
  { tel: 18000, device: 50000, fuel: 144000, meal: 55000 },
  { tel: 18000, device: 90000, car: 216000, driver: 144000, fuel: 144000, meal: 80000 },
  { tel: 18000, device: 130000, car: 300000, driver: 192000, fuel: 160000, meal: 96000 },
  { tel: 18000, device: 150000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
]
const COMPS: { k: string; l: string; perq?: boolean }[] = [
  { k: 'pda', l: 'Professional Dev. Allowance' }, { k: 'tel', l: 'Telephone / WiFi Bill' },
  { k: 'device', l: 'Device Leasing' }, { k: 'lta', l: 'Leave Travel Allowance' },
  { k: 'car', l: 'Car Lease', perq: true }, { k: 'driver', l: 'Driver Allowance', perq: true },
  { k: 'fuel', l: 'Fuel Reimbursement' }, { k: 'meal', l: 'Meal Coupon (Zaggle)' },
  { k: 'attire', l: 'Corporate Attire' }, { k: 'childEdu', l: "Children's Education" }, { k: 'hostel', l: 'Hostel Allowance' },
]
const PERQ_ANN = (7000 + 3000) * 12

const R = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const N = (v: any) => parseFloat(v) || 0
const getSlab = (c: number) => { const l = c / 1e5; if (l <= 5) return 0; if (l <= 7.99) return 1; if (l <= 11.99) return 2; if (l <= 17.99) return 3; if (l <= 24.99) return 4; if (l <= 29.99) return 5; if (l <= 39.99) return 6; if (l <= 49.99) return 7; return 8 }
const oldTax = (t: number) => { if (t <= 250000) return 0; if (t <= 500000) return (t - 250000) * .05; if (t <= 1000000) return 12500 + (t - 500000) * .2; return 112500 + (t - 1000000) * .3 }
const newTax = (t: number) => { if (t <= 400000) return 0; if (t <= 800000) return (t - 400000) * .05; if (t <= 1200000) return 20000 + (t - 800000) * .1; if (t <= 1600000) return 60000 + (t - 1200000) * .15; if (t <= 2000000) return 120000 + (t - 1600000) * .2; if (t <= 2400000) return 200000 + (t - 2000000) * .25; return 300000 + (t - 2400000) * .3 }
function finalize(base: number, inc: number, isNew: boolean) {
  const r = isNew ? (inc <= 1200000 ? base : 0) : (inc <= 500000 ? Math.min(base, 12500) : 0)
  const a = Math.max(0, base - r)
  const sc = inc > 5e7 ? (isNew ? .25 : .37) : inc > 2e7 ? .25 : inc > 1e7 ? .15 : inc > 5e6 ? .1 : 0
  return Math.round((a + a * sc) * 1.04)
}
function hraCalcPeriod(monthlyHRA: number, basic: number, rentM: number, fromM: number, toM: number, metro: boolean) {
  if (!rentM || fromM > toM) return 0
  const mo = toM - fromM + 1
  const hraP = monthlyHRA * mo, rentP = rentM * mo, basicP = (basic / 12) * mo
  return Math.min(hraP, Math.max(0, rentP - basicP * .1), basicP * (metro ? .5 : .4))
}

const MONTHS = ['April 2026', 'May 2026', 'June 2026', 'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027']

// ── styles (tokens only: light and dark both repaint through lib/ui/theme.css) ──
const s = {
  label: { display: 'block', fontSize: F.tiny, fontWeight: W.semi, color: TK.inkSoft, marginBottom: 5, lineHeight: 1.35 } as React.CSSProperties,
  input: { width: '100%', height: 38, padding: '0 12px', background: TK.surface, border: `1px solid ${TK.lineStrong}`, borderRadius: RAD.md, color: TK.ink, fontSize: F.small, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', ...numeric } as React.CSSProperties,
  well: { background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: RAD.md, padding: S.md } as React.CSSProperties,
  sumRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.sm, padding: '10px 12px', borderRadius: RAD.md, fontSize: F.small, fontWeight: W.bold, ...numeric } as React.CSSProperties,
}
/** Responsive grid that collapses to one column on a phone instead of squeezing. */
const grid = (min: number, gap: number = S.md): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap })

function Fg({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: S.md, minWidth: 0 }}>
      <label style={s.label}>{label}</label>
      {children}
      {hint}
    </div>
  )
}

/** Thin "used of limit" meter under a capped deduction. Display only: the caps themselves live in the tax computation. */
function LimitMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0
  const full = limit > 0 && used >= limit
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 4, borderRadius: RAD.pill, background: TK.sunken, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', borderRadius: RAD.pill, background: full ? TK.positive : TK.brand, transition: `width ${M.slow}` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.sm, fontSize: F.micro, color: TK.muted, marginTop: 3, ...numeric }}>
        <span>{used > limit ? `${R(limit)} counted (cap reached)` : `${R(used)} used`}</span>
        <span>of {R(limit)}</span>
      </div>
    </div>
  )
}

// ── Wizard stepper ──
const STEP_META = [
  { label: 'Employee & Salary', hint: 'Your pay on record' },
  { label: 'Flexi Declaration', hint: 'Tax-free allowances' },
  { label: 'Investments', hint: 'Rent, 80C, 80D & more' },
  { label: 'TDS Report', hint: 'Old vs New verdict' },
]

function WizardStepper({ step, onGo, locked }: { step: number; onGo: (n: number) => void; locked: boolean[] }) {
  return (
    <nav aria-label="Calculator steps" className="ez-scroll" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: S.lg }}>
      <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: S.sm, listStyle: 'none', margin: 0, padding: 0 }}>
        {STEP_META.map((m, i) => {
          const n = i + 1, active = step === n, done = step > n, reachable = n <= step
          const accent = done ? TK.positive : active ? TK.brand : TK.line
          return (
            <li key={m.label} style={{ minWidth: 0 }}>
              <button onClick={() => n <= step && onGo(n)} aria-current={active ? 'step' : undefined} className={reachable && !active ? 'ez-press' : undefined} style={{
                width: '100%', height: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: reachable ? 'pointer' : 'default',
                background: active ? TK.surface : done ? TK.surface : TK.sunken, borderRadius: RAD.lg, padding: `${S.md}px ${S.md + 2}px ${S.md}px`,
                border: `1px solid ${active ? TK.brandEdge : TK.line}`, boxShadow: active ? E.raised : 'none', position: 'relative', overflow: 'hidden',
                transition: `box-shadow ${M.quick}, border-color ${M.quick}`,
              }}>
                <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: accent }} />
                <span style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: F.micro, fontWeight: W.bold, boxSizing: 'border-box', ...numeric,
                    background: done ? TK.positive : active ? TK.brand : TK.surface, color: done || active ? TK.onAccent : TK.muted,
                    border: done || active ? 'none' : `1.5px solid ${TK.lineStrong}`,
                  }}>{done ? <IconCheck size={13} strokeWidth={2.4} /> : n}</span>
                  <span style={{ fontSize: F.small, fontWeight: active ? W.bold : W.semi, color: active || done ? TK.ink : TK.muted, lineHeight: 1.25, minWidth: 0 }}>{m.label}</span>
                </span>
                <span style={{ display: 'block', fontSize: F.micro, color: TK.muted, marginTop: 6, lineHeight: 1.35 }}>{m.hint}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: F.micro, fontWeight: W.semi, color: locked[i] ? TK.muted : done ? TK.positive : active ? TK.brandDeep : TK.faint }}>
                  {locked[i] ? <><IconLock size={11} /> Locked</> : done ? 'Done' : active ? 'You are here' : `Step ${n} of 4`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ── Step 1 pieces ──
type SalaryRowKind = 'sub' | 'net' | 'total'
function SalaryRow({ label, m, kind }: { label: string; m: number; kind?: SalaryRowKind }) {
  const bg = kind === 'total' ? TK.brandTint : kind === 'net' ? TK.positiveTint : kind === 'sub' ? TK.sunken : undefined
  const col = kind === 'total' ? TK.brandDeep : kind === 'net' ? TK.positive : TK.ink
  const cell: React.CSSProperties = { ...dt.tdNum, background: bg, color: col, fontWeight: kind ? W.bold : W.regular }
  return (
    <tr className={kind ? undefined : dt.rowClass}>
      <td style={{ ...dt.td, background: bg, color: kind ? col : TK.inkSoft, fontWeight: kind ? W.bold : W.regular }}>{label}</td>
      <td style={cell}>{R(m)}</td>
      <td style={cell}>{R(m * 12)}</td>
    </tr>
  )
}
function GroupRow({ children, t = 'neutral' }: { children: React.ReactNode; t?: 'neutral' | 'critical' }) {
  return (
    <tr><td colSpan={3} style={{ ...eyebrow, padding: '7px 12px', borderBottom: `1px solid ${TK.line}`, background: t === 'critical' ? TK.criticalTint : TK.surface, color: t === 'critical' ? TK.critical : TK.muted }}>{children}</td></tr>
  )
}

/** Stacked bar of where a month's CTC goes, with a legend. Widths are each part's share of the parts shown. */
function CompositionBar({ parts }: { parts: { l: string; v: number; c: string }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0)
  if (!total) return null
  return (
    <div style={{ marginBottom: S.lg }}>
      <div style={{ ...eyebrow, marginBottom: S.sm }}>Where your monthly CTC goes</div>
      <div style={{ display: 'flex', height: 12, borderRadius: RAD.pill, overflow: 'hidden', background: TK.sunken, gap: 2 }}>
        {parts.map(p => <span key={p.l} title={`${p.l}: ${R(p.v)}`} style={{ width: `${p.v / total * 100}%`, background: p.c, minWidth: 3 }} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${S.xs}px ${S.lg}px`, marginTop: S.sm }}>
        {parts.map(p => (
          <span key={p.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: TK.inkSoft, ...numeric }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: p.c, flexShrink: 0 }} />
            {p.l} <b style={{ color: TK.ink, fontWeight: W.semi }}>{R(p.v)}</b>
            <span style={{ color: TK.faint }}>{Math.round(p.v / total * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Step 2 pieces ──
function WalletMeter({ title, used, budget, regimeNote }: { title: string; used: number; budget: number; regimeNote: string }) {
  const pctv = budget > 0 ? Math.min(used / budget * 100, 100) : 0, ov = used > budget + 1
  const col = ov ? TK.critical : pctv > 80 ? TK.warning : TK.brand
  return (
    <div style={{ background: TK.surface, border: `1px solid ${ov ? TK.criticalEdge : TK.line}`, borderRadius: RAD.lg, boxShadow: E.raised, padding: `${S.md + 2}px ${S.lg}px`, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...eyebrow }}>{title}</div>
          <div style={{ fontSize: F.micro, color: TK.faint, marginTop: 2 }}>{regimeNote}</div>
        </div>
        <StatusPill t={ov ? 'critical' : pctv > 80 ? 'warning' : 'positive'} size="sm" dot>{ov ? 'EXCEEDED!' : R(Math.max(0, budget - used)) + ' left'}</StatusPill>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: S.sm, ...numeric }}>
        <span style={{ fontSize: F.title + 4, fontWeight: W.bold, color: ov ? TK.critical : TK.ink, letterSpacing: '-.02em' }}>{R(used)}</span>
        <span style={{ fontSize: F.tiny, color: TK.muted }}>declared of {R(budget)}</span>
      </div>
      <div style={{ height: 8, background: TK.sunken, borderRadius: RAD.pill, overflow: 'hidden', marginTop: S.sm }}>
        <div style={{ width: pctv + '%', height: '100%', borderRadius: RAD.pill, background: col, transition: `width ${M.slow}` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.micro, color: TK.muted, marginTop: 6, ...numeric }}><span>Used: {R(used)}</span><span>Budget: {R(budget)}</span></div>
      {ov && <InfoCallout t="critical" compact style={{ marginTop: S.sm, marginBottom: 0 }}>Flexi wallet limit exceeded. Remove some allowances.</InfoCallout>}
    </div>
  )
}

function LimitSelect({ lim, val, onPick }: { lim: number; val: number; onPick: (v: number) => void }) {
  if (!lim) return <span style={{ fontSize: F.tiny, color: TK.faint, fontWeight: W.medium }}>Not eligible</span>
  return (
    <select style={{ ...s.input, height: 34, width: 'auto', minWidth: 112, fontWeight: val > 0 ? W.semi : W.regular, color: val > 0 ? TK.brandDeep : TK.ink, borderColor: val > 0 ? TK.brandEdge : TK.lineStrong }} value={val} onChange={e => onPick(+e.target.value)}>
      <option value={0}>₹0</option><option value={lim}>{R(lim)}</option>
    </select>
  )
}

function FlexiCard({ label, perq, oL, nL, oV, nV, onOld, onNew }: {
  label: string; perq?: boolean; oL: number; nL: number; oV: number; nV: number; onOld: (v: number) => void; onNew: (v: number) => void
}) {
  const on = oV > 0 || nV > 0
  const line = (rg: string, lim: number, val: number, pick: (v: number) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, padding: '8px 0', borderTop: `1px solid ${TK.line}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: TK.inkSoft }}>{rg}</div>
        <div style={{ fontSize: F.micro, color: TK.muted, ...numeric }}>{lim ? `Limit ${R(lim)} / yr` : 'Not offered in your slab'}</div>
      </div>
      <LimitSelect lim={lim} val={val} onPick={pick} />
    </div>
  )
  return (
    <div style={{ background: TK.surface, border: `1px solid ${on ? TK.brandEdge : TK.line}`, boxShadow: on ? `inset 3px 0 0 ${TK.brand}` : E.flat, borderRadius: RAD.lg, padding: `${S.md}px ${S.md + 2}px ${S.xs}px`, minWidth: 0, transition: `border-color ${M.quick}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.sm, marginBottom: S.sm, flexWrap: 'wrap' }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: TK.ink, flex: '1 1 140px', minWidth: 0, lineHeight: 1.35 }}>{label}</div>
        {perq && <StatusPill t="warning" size="sm">Perquisite Tax</StatusPill>}
        {on && <StatusPill t="positive" size="sm" icon={<IconCheck size={10} strokeWidth={2.4} />}>Declared</StatusPill>}
      </div>
      {line('Old Regime', oL, oV, onOld)}
      {line('New Regime', nL, nV, onNew)}
    </div>
  )
}

// ── Step 3 pieces ──
function RegimeHead({ title, sub, note, t }: { title: string; sub: string; note: string; t: 'info' | 'brand' }) {
  const k = tone(t)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, padding: `${S.md}px ${S.lg}px`, marginBottom: S.md, background: k.bg, border: `1px solid ${k.edge}`, borderRadius: RAD.lg }}>
      <IconTile icon={<IconFinance size={16} />} t={t} size={32} solid />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink }}>{title}</div>
        <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: k.fg, marginTop: 2, ...numeric }}>{sub}</div>
        <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 4, lineHeight: 1.5 }}>{note}</div>
      </div>
    </div>
  )
}

// ── Step 4 pieces ──
function CompareBar({ label, tax, mo, pct, best }: { label: string; tax: number; mo: number; pct: number; best: boolean }) {
  return (
    <div style={{ marginBottom: S.md }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.sm, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.small, fontWeight: W.semi, color: TK.ink }}>
          {label}{best && <StatusPill t="positive" size="sm">Lower tax</StatusPill>}
        </span>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: best ? TK.positive : TK.ink, ...numeric }}>{R(tax)} <span style={{ fontWeight: W.regular, color: TK.muted, fontSize: F.tiny }}>· {R(mo)}/mo</span></span>
      </div>
      <div style={{ height: 10, borderRadius: RAD.pill, background: TK.sunken, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, pct * 100)}%`, height: '100%', borderRadius: RAD.pill, background: best ? TK.positive : TK.lineStrong, transition: `width ${M.slow}` }} />
      </div>
    </div>
  )
}

function BreakRow({ label, o, n, exempt, indent }: { label: React.ReactNode; o: string; n: string; exempt?: boolean; indent?: boolean }) {
  const col = exempt ? TK.positive : TK.inkSoft
  return (
    <tr className={dt.rowClass}>
      <td style={{ ...dt.td, color: exempt ? TK.positive : TK.inkSoft, paddingLeft: indent ? 28 : 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{exempt && indent && <IconCheck size={12} strokeWidth={2.4} />}{label}</span>
      </td>
      <td style={{ ...dt.tdNum, color: col }}>{o}</td>
      <td style={{ ...dt.tdNum, color: col }}>{n}</td>
    </tr>
  )
}
function TotalRow({ label, o, n, bg, col }: { label: string; o: string; n: string; bg: string; col: string }) {
  const c: React.CSSProperties = { ...dt.tdNum, background: bg, color: col, fontWeight: W.bold, fontSize: F.body }
  return <tr><td style={{ ...dt.td, background: bg, color: col, fontWeight: W.bold, fontSize: F.body }}>{label}</td><td style={c}>{o}</td><td style={c}>{n}</td></tr>
}
function SecRow({ children }: { children: React.ReactNode }) {
  return <tr><td colSpan={3} style={{ ...eyebrow, padding: '8px 12px', background: TK.sunken, color: TK.brandDeep, borderBottom: `1px solid ${TK.line}` }}>{children}</td></tr>
}

/** `sandbox`: the Help → TDS Calculator for HR. Nothing is saved and no declaration is read —
 *  only the chosen employee's CTC and joining date are prefilled (or nothing, with no employee),
 *  and every figure stays editable. The employee's own Flexi section is the non-sandbox use. */
export default function FlexiTdsCalculator({ employeeId, empName, empCode, sandbox = false }: { employeeId: string; empName?: string; empCode?: string; sandbox?: boolean }) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState<Record<string, string>>({
    ctc: '', variable: '', doj: '',
    rentM: '', hra1From: '1', hra1To: '12', cityType: 'nonmetro', landlordPAN: '',
    showHra2: '', rentM2: '', hra2From: '7', hra2To: '12', cityType2: 'nonmetro', landlordPAN2: '',
    lic: '', ppf: '', elss: '', tuit: '', hlP: '',
    medSelf: '', medParents: '', hlInt: '', hlLoanNo: '',
    npsSelf: '0', emplrNpsOld: '0', emplrNpsNew: '0',
    eduLoan: '', eduLoanNo: '', dep80dd: '0', dis80ddb: '', pmFund: '',
    oi: '', bon: '', iinc: '', varEx: '', iInc: '',
  })
  const [oFlexi, setOFlexi] = useState<Record<string, number>>({})
  const [nFlexi, setNFlexi] = useState<Record<string, number>>({})
  const [child, setChild] = useState({ count: 0, c1: { school: false, hostel: false }, c2: { school: false, hostel: false } })
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  // Regime declaration: OLD / NEW chosen by the employee, stored in DB.
  const FY = '2026-27'
  const [chosenRegime, setChosenRegime] = useState<'OLD' | 'NEW' | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [defaultedNew, setDefaultedNew] = useState(false)   // mid-year joiner auto-defaulted to New
  const [userPicked, setUserPicked] = useState(false)       // has the employee explicitly chosen a regime?
  // Set by the "no election by the 4th ⇒ New" rule (072). Shown, not enforced — the
  // employee may still submit their own choice, which overwrites the default.
  const [defaultedByRule, setDefaultedByRule] = useState<string | null>(null)
  const [status, setStatus] = useState<'NEW' | 'DRAFT' | 'SUBMITTED'>('NEW')
  const [editMode, setEditMode] = useState<null | 'flexi' | 'all'>(null)  // after submit: what can be edited
  const [draftMsg, setDraftMsg] = useState('')
  const norm = (v: any): 'OLD' | 'NEW' => String(v || '').toUpperCase().includes('NEW') ? 'NEW' : 'OLD'

  // Read/write gates. Once SUBMITTED everything locks; Edit unlocks only the allowed sections:
  // Old regime → flexi + investments; New regime → flexi only. Regime itself never changes after submit.
  const isSubmitted = status === 'SUBMITTED'
  const flexiRW  = !isSubmitted || editMode === 'flexi' || editMode === 'all'
  const investRW = !isSubmitted || editMode === 'all'
  const basicRW  = !isSubmitted || editMode === 'all'
  const regimeLocked = isSubmitted
  const viewLocked = isSubmitted && !editMode
  const fsReset: React.CSSProperties = { border: 'none', padding: 0, margin: 0, minInlineSize: 'auto' }

  // Prefill CTC / variable + DOJ, restore any saved draft/submission, set the default regime.
  useEffect(() => {
    if (!employeeId) return   // sandbox with nobody chosen: a blank calculator
    (async () => {
      const [{ data: cm }, { data: emp }, declRes, formRes] = await Promise.all([
        supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1),
        supabase.from('employees').select('company_id, company_doj, group_doj, tds_regime').eq('id', employeeId).maybeSingle(),
        supabase.from('tds_declarations').select('regime, declaration_status').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
        supabase.from('flexi_tds_forms').select('regime, status, form_data').eq('employee_id', employeeId).eq('fy', FY).maybeSingle().then(r => r, () => ({ data: null })),
      ])
      setCompanyId((emp as any)?.company_id || null)
      const doj = (emp as any)?.company_doj || (emp as any)?.group_doj
      if (sandbox) {
        // A calculation, not this employee's declaration: CTC + DOJ only, nothing restored.
        if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)) || '', variable: String(Math.round(cm[0].annual_variable || 0)) }))
        if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))
        return
      }

      // ── Restore a previously saved form (draft or submitted) — every field comes back ──
      const savedForm: any = (formRes as any)?.data
      if (savedForm?.form_data) {
        const fd = savedForm.form_data || {}
        if (fd.f) setF(p => ({ ...p, ...fd.f }))
        if (fd.oFlexi) setOFlexi(fd.oFlexi)
        if (fd.nFlexi) setNFlexi(fd.nFlexi)
        if (fd.child) setChild(fd.child)
        if (savedForm.regime) { setChosenRegime(norm(savedForm.regime)); setUserPicked(true) }
        setStatus(savedForm.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT')
        if (savedForm.status === 'SUBMITTED') setSaved(true)
        // CTC, variable and DOJ always come from the record, never from the saved form: they
        // are not the employee's to change, and a form saved before a revision holds stale pay.
        if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)), variable: String(Math.round(cm[0].annual_variable || 0)) }))
        if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))
        return
      }

      // ── No saved form — fresh prefill ──
      if (cm?.[0]) setF(p => ({ ...p, ctc: String(Math.round(cm[0].annual_ctc || 0)), variable: String(Math.round(cm[0].annual_variable || 0)) }))
      if (doj) setF(p => ({ ...p, doj: String(doj).slice(0, 10) }))

      // Default regime: submitted declaration → saved tds_regime → (mid-year joiner, no declaration ⇒ NEW).
      const decl: any = (declRes as any)?.data
      if (decl?.declaration_status === 'SUBMITTED' && decl?.regime) { setChosenRegime(norm(decl.regime)); setUserPicked(true); return }
      if (decl?.declaration_status === 'DEFAULTED') setDefaultedByRule(decl.updated_at || decl.created_at || 'the 5th')
      if ((emp as any)?.tds_regime) { setChosenRegime(norm((emp as any).tds_regime)); setUserPicked(true); return }
      if (doj) {
        const d = new Date(String(doj).slice(0, 10)).getTime()
        const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
        if (d > fyStart && d <= fyEnd) { setChosenRegime('NEW'); setDefaultedNew(true) }
      }
    })()
  }, [employeeId])

  // Persist the full calculator state to flexi_tds_forms (draft or submitted).
  async function persistForm(newStatus: 'DRAFT' | 'SUBMITTED') {
    if (sandbox) return { error: { message: 'The Help calculator does not save.' } }
    const payload = {
      employee_id: employeeId, company_id: companyId, fy: FY,
      regime: chosenRegime, status: newStatus,
      form_data: { f, oFlexi, nFlexi, child },
      submitted_at: newStatus === 'SUBMITTED' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    return supabase.from('flexi_tds_forms').upsert(payload, { onConflict: 'employee_id,fy' })
  }

  async function saveDraft() {
    setDraftMsg(''); setSaving(true)
    const { error } = await persistForm('DRAFT')
    setSaving(false)
    if (error) { setDraftMsg('⚠ ' + error.message); return }
    setStatus('DRAFT')
    setDraftMsg('Draft saved. You can leave and return anytime')
    setTimeout(() => setDraftMsg(''), 3500)
  }

  // The employee's ACTUAL salary structure, from the same loader the Employee Master
  // uses (lib/employees/hr-actions → loadSalary). Both screens therefore render one
  // computation, so a figure can never read differently in one place than the other.
  const [real, setReal] = useState<SalaryStructure | null>(null)
  useEffect(() => { if (employeeId) loadSalary(employeeId).then(setReal).catch(() => setReal(null)) }, [employeeId])
  const rd = real?.detail || null

  // ── Derived salary ──
  const sal = useMemo(() => {
    const ctc = N(f.ctc), vari = N(f.variable)
    const fixed = ctc - vari
    if (rd) {
      // Real structure — annualise the stored monthly figures rather than assuming
      // Basic is 50% of Fixed and HRA 50% of Basic.
      const basic = rd.basic * 12, hra = rd.hra * 12, epf = rd.erPf * 12
      // Wallet = the GROSS Special Allowance. rd.special is already net of what has
      // been declared, so using it would shrink the budget as the employee declares.
      const other = Math.round((rd.specialGross || rd.special) * 12)
      return { ctc, vari, fixed, basic, hra, epf, lta8: Math.round(basic * .0833), other, si: getSlab(ctc) }
    }
    const basic = fixed * .5, hra = basic * .5
    const epf = Math.min((basic / 12) * .12, 1800) * 12, lta8 = Math.round(basic * .0833), other = Math.max(0, fixed - basic - hra - epf)
    return { ctc, vari, fixed, basic, hra, epf, lta8, other, si: getSlab(ctc) }
  }, [f.ctc, f.variable, rd])

  // ── Joining-date pro-ration for FY 2026-27 (1 Apr 2026 – 31 Mar 2027) ──
  // DOJ on/before 1 Apr 2026 → full 12 months. DOJ after → pro-rata on worked days,
  // with TDS spread over the remaining pay months.
  const join = useMemo(() => {
    const full = { pr: 1, months: 12, mid: false }
    if (!f.doj) return full
    const parts = f.doj.split('-').map(Number)
    if (parts.length < 3 || !parts[0]) return full
    const [y, mo, day] = parts
    const doj = Date.UTC(y, mo - 1, day)
    const fyStart = Date.UTC(2026, 3, 1), fyEnd = Date.UTC(2027, 2, 31)
    if (doj <= fyStart || doj > fyEnd) return full            // joined before this FY (or future) → full year
    const totalDays = Math.round((fyEnd - fyStart) / 86400000) + 1
    const workedDays = Math.round((fyEnd - doj) / 86400000) + 1
    const fyMonth = mo >= 4 ? mo - 3 : mo + 9                  // April=1 … March=12
    return { pr: Math.min(1, workedDays / totalDays), months: Math.max(1, 13 - fyMonth), mid: true }
  }, [f.doj])

  const schoolCount = (child.count >= 1 && child.c1.school ? 1 : 0) + (child.count >= 2 && child.c2.school ? 1 : 0)
  const hostelCount = (child.count >= 1 && child.c1.hostel ? 1 : 0) + (child.count >= 2 && child.c2.hostel ? 1 : 0)
  const getOldLimit = (k: string) => {
    const b = OLD[sal.si] || {}
    if (k === 'lta') return b.lta ? sal.lta8 : 0
    if (k === 'childEdu') return schoolCount > 0 ? (b.childEdu || 0) * schoolCount : 0
    if (k === 'hostel') return hostelCount > 0 ? (b.hostel || 0) * hostelCount : 0
    return b[k] || 0
  }
  const getNewLimit = (k: string) => (NEW[sal.si] || {})[k] || 0

  function setFlexi(rg: 'old' | 'new', k: string, v: number) {
    const upd = (prev: Record<string, number>, gl: (k: string) => number) => {
      const nx = { ...prev, [k]: v }
      if (k === 'car') nx.driver = v > 0 ? gl('driver') : 0
      if (k === 'driver') nx.car = v > 0 ? gl('car') : 0
      return nx
    }
    if (rg === 'old') setOFlexi(p => upd(p, getOldLimit)); else setNFlexi(p => upd(p, getNewLimit))
  }

  const oTot = Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0)
  const nTot = Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)

  const hraExempt = useMemo(() => {
    if (!sal.basic) return 0
    const mHRA = sal.hra / 12
    const p1 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM), +f.hra1From, +f.hra1To, f.cityType === 'metro')
    let p2 = 0
    if (f.showHra2) p2 = hraCalcPeriod(mHRA, sal.basic, N(f.rentM2), +f.hra2From, +f.hra2To, f.cityType2 === 'metro')
    return p1 + p2
  }, [f, sal])

  // ── Tax computation (with joining-date pro-ration) ──
  const T = useMemo(() => {
    const { ctc, basic, hra, epf, vari, other, si } = sal
    if (!ctc) return null
    const pr = join.pr, months = join.months
    // Salary income is earned only for the worked portion of the FY → pro-rate.
    const eBasic = basic * pr, eHra = hra * pr, eEpf = epf * pr, eOther = other * pr, eVari = vari * pr
    const earnedCtc = ctc * pr
    const hE = hraExempt                                              // period-based (worked months)
    // c80 = manual investments (full) + employee PF (salary-linked → pro-rated), capped ₹1.5L
    const c80 = Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + eEpf + N(f.tuit) + N(f.hlP), 150000)
    const medS = Math.min(N(f.medSelf), 25000), medP = Math.min(N(f.medParents), 50000)   // actual → full
    const hlI = Math.min(N(f.hlInt), 200000)
    const npsS = N(f.npsSelf)                                          // actual investment → full
    const eNpsO = f.emplrNpsOld === 'on' ? Math.round(eBasic * .1) : 0 // employer NPS is salary-linked → pro-rated
    const eNpsN = f.emplrNpsNew === 'on' ? Math.round(eBasic * .14) : 0
    const eduLoan = Math.min(N(f.eduLoan), 200000)
    const dep80dd = N(f.dep80dd), dis80ddb = Math.min(N(f.dis80ddb), 100000), pmFund = Math.min(N(f.pmFund), 200000)
    const addI = N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)  // actual income → full
    // Flexi claimed & perquisite are salary-wallet-linked → pro-rated.
    const oClaim = Math.round(oTot * pr), nClaim = Math.round(nTot * pr)
    const ltaAmt = Math.round((oFlexi.lta || 0) * pr)
    const oPerq = (oFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
    const nPerq = (nFlexi.car || 0) > 0 ? Math.round(PERQ_ANN * pr) : 0
    const walBalO = Math.max(0, eOther - oClaim), walBalN = Math.max(0, eOther - nClaim)
    const grossO = eBasic + (eHra - hE) + walBalO + eVari + addI + oPerq
    const grossN = eBasic + eHra + walBalN + eVari + addI + nPerq
    const extraOldDed = eduLoan + dep80dd + dis80ddb + pmFund
    const gO = earnedCtc + addI + oPerq, dO = 50000 + hE + ltaAmt + oClaim + c80 + medS + medP + hlI + npsS + eNpsO + eEpf + extraOldDed
    const tO = Math.max(0, gO - dO), bO = oldTax(tO), fO = finalize(bO, tO, false)
    const gN = earnedCtc + addI + nPerq, dN = 75000 + nClaim + eNpsN + eEpf
    const tN = Math.max(0, gN - dN), bN = newTax(tN), fN = finalize(bN, tN, true)
    const denom = earnedCtc || ctc
    return {
      gO, dO, tO, bO, fO, moO: Math.round(fO / months), efO: (fO / denom * 100).toFixed(2),
      gN, dN, tN, bN, fN, moN: Math.round(fN / months), efN: (fN / denom * 100).toFixed(2),
      hE, c80, medS, medP, hlI, npsS, eNpsO, eNpsN, eduLoan, dep80dd, dis80ddb, pmFund,
      ltaAmt, addI, oPerq, nPerq, walBalO, walBalN, grossO, grossN, si,
      eBasic, eHra, eOther, eVari, oClaim, nClaim, months, pr, mid: join.mid,
    }
  }, [sal, hraExempt, f, oFlexi, nFlexi, oTot, nTot, join])

  // Recommended regime = the one with the LOWER annual tax.
  const recRegime: 'OLD' | 'NEW' | null = T ? (T.fO <= T.fN ? 'OLD' : 'NEW') : null
  // Default selection follows the lower-tax regime until the employee explicitly picks (or it's locked).
  useEffect(() => {
    if (recRegime && !userPicked && !isSubmitted) setChosenRegime(recRegime)
  }, [recRegime, userPicked, isSubmitted])

  // ── STEP 1 — Employee & salary ──
  const dojLabel = f.doj ? new Date(f.doj + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not on record'
  const step1 = (
    <div>
      {/* An employee's CTC, variable and DOJ are HR's record, not inputs — the declaration and
          the TDS projection must be worked on the pay payroll will actually run. Only the
          Help → TDS Calculator sandbox (a what-if for hiring managers / HR) edits them. */}
      <SectionCard
        title="Employee Information"
        icon={<IconUser size={16} />}
        hint={sandbox ? 'Prefilled from the record when an employee is picked. Adjust CTC / variable to try a different package.' : 'From your salary record. If any of this is wrong, raise it with HR — it cannot be changed here.'}
        actions={sandbox
          ? <StatusPill t="info" size="sm">What-if figures</StatusPill>
          : <StatusPill t="neutral" size="sm" icon={<IconLock size={11} />}>HR record · read-only</StatusPill>}
      >
        {sandbox ? <>
          <KeyValueGrid min={180} dense items={[
            { label: 'Employee Name', value: empName || '—' },
            { label: 'Employee Code', value: empCode || '—', mono: true },
          ]} />
          <div style={{ ...grid(200), marginTop: S.md }}>
            <Fg label="Annual CTC (₹)"><input style={s.input} type="number" value={f.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1500000" /></Fg>
            <Fg label="Date of Joining"><input style={s.input} type="date" value={f.doj} onChange={e => set('doj', e.target.value)} /></Fg>
            <Fg label="Annual Variable Pay (₹)"><input style={s.input} type="number" value={f.variable} onChange={e => set('variable', e.target.value)} placeholder="0 if none" /></Fg>
          </div>
        </> : (
          <KeyValueGrid min={180} items={[
            { label: 'Employee Name', value: empName || '—' },
            { label: 'Employee Code', value: empCode || '—', mono: true },
            { label: 'Annual CTC (₹)', value: f.ctc ? R(N(f.ctc)) : 'Not on record', mono: true, t: f.ctc ? 'brand' : undefined },
            { label: 'Date of Joining', value: dojLabel },
            { label: 'Annual Variable Pay (₹)', value: f.ctc ? R(N(f.variable)) : 'Not on record', mono: true },
          ]} />
        )}
      </SectionCard>

      {/* Actual salary structure — identical rows, order and figures to
          Employee Master → View → Salary, because both read one loader. */}
      {rd && (
        <SectionCard
          title="Your Salary Structure"
          icon={<IconPayroll size={16} />}
          hint="FY 2026-27 salary structure: the same figures shown in your HR record."
          actions={<>
            <StatusPill t="positive" size="sm" icon={<IconCheck size={10} strokeWidth={2.4} />}>as per your record</StatusPill>
            {rd.payType && rd.payType !== 'Regular' && <StatusPill t="brand" size="sm">{rd.payType}</StatusPill>}
          </>}
        >
          <KpiGrid min={170}>
            <KpiTile label="Annual CTC" value={R(rd.totalCtc || rd.annualCtc)} emphasis sub="Cost to company, per year" />
            <KpiTile label="Net Take-home / mo" value={R(rd.net)} t="positive" sub="Lands in your bank each month" />
            <KpiTile label="Fixed / mo" value={R(rd.fixedMonthly)} sub="Before variable pay" />
          </KpiGrid>
          <CompositionBar parts={[
            { l: 'Basic', v: rd.basic, c: TK.brandDeep },
            { l: 'HRA', v: rd.hra, c: TK.brand },
            { l: 'Allowances', v: (rd.statBonus || 0) + (rd.conveyance || 0) + (rd.special || 0), c: TK.info },
            { l: 'Flexi', v: rd.flexiMonthly || 0, c: TK.positive },
            { l: 'Employer contributions', v: (rd.erPf || 0) + (rd.erEsic || 0) + (rd.gratuity || 0), c: TK.lineStrong },
            { l: 'Variable', v: Math.round((rd.variableAnnual || 0) / 12), c: TK.warning },
          ].filter(p => p.v > 0)} />
          <DataTable framed minWidth={420}>
            <thead><tr><th style={dt.th}>Component</th><th style={dt.thNum}>Monthly</th><th style={dt.thNum}>Annual</th></tr></thead>
            <tbody>
              <GroupRow>Earnings</GroupRow>
              <SalaryRow label="Basic" m={rd.basic} />
              <SalaryRow label="HRA" m={rd.hra} />
              {rd.statBonus > 0 && <SalaryRow label="Statutory Bonus" m={rd.statBonus} />}
              {rd.conveyance > 0 && <SalaryRow label="Conveyance" m={rd.conveyance} />}
              {rd.special > 0 && <SalaryRow label="Special Allowance" m={rd.special} />}
              {rd.flexiMonthly > 0 && <SalaryRow label="Flexi (declared)" m={rd.flexiMonthly} />}
              <SalaryRow label="Gross" m={rd.gross} kind="sub" />
              {(rd.erPf > 0 || rd.erEsic > 0 || rd.gratuity > 0) && <GroupRow>Employer contributions</GroupRow>}
              {rd.erPf > 0 && <SalaryRow label="Employer PF" m={rd.erPf} />}
              {rd.erEsic > 0 && <SalaryRow label="Employer ESIC" m={rd.erEsic} />}
              {rd.gratuity > 0 && <SalaryRow label="Gratuity" m={rd.gratuity} />}
              {(rd.eePf > 0 || rd.eeEsic > 0 || rd.pt > 0 || rd.lwf > 0) && <GroupRow t="critical">Deductions</GroupRow>}
              {rd.eePf > 0 && <SalaryRow label="Employee PF" m={rd.eePf} />}
              {rd.eeEsic > 0 && <SalaryRow label="Employee ESIC" m={rd.eeEsic} />}
              {rd.pt > 0 && <SalaryRow label="Professional Tax" m={rd.pt} />}
              {rd.lwf > 0 && <SalaryRow label="LWF" m={rd.lwf} />}
              <SalaryRow label="Net Take-home" m={rd.net} kind="net" />
              <SalaryRow label="Fixed" m={rd.fixedMonthly} kind="sub" />
              {rd.variableAnnual > 0 && <SalaryRow label="Variable" m={Math.round(rd.variableAnnual / 12)} />}
              <SalaryRow label="Total CTC" m={Math.round(rd.totalCtc / 12)} kind="total" />
            </tbody>
          </DataTable>
          <div style={{ fontSize: F.micro, color: TK.muted, marginTop: S.sm, lineHeight: 1.5 }}>
            FY 2026-27 salary structure: the same figures shown in your HR record. Monthly amounts are pro-rated on actual paid days during payroll.
          </div>
        </SectionCard>
      )}

      {sal.ctc > 0 && (
        <SectionCard
          title={rd ? 'Flexi Wallet Basis' : 'Salary Breakup'}
          icon={<IconCard size={16} />}
          hint="The budget you can split across tax-free flexi allowances in the next step."
          actions={<StatusPill t="brand" size="sm">Slab: {SLAB_LABELS[sal.si]}</StatusPill>}
        >
          {/* Monthly is shown first and largest because that is the figure the HR record
              (Employee Master → Salary) displays. The annual number sits beside it, labelled,
              so the wallet budget can't be mistaken for a different Special Allowance. */}
          <div style={{ background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: RAD.lg, padding: `${S.lg}px ${S.lg + 2}px` }}>
            <div style={{ ...eyebrow, color: TK.brandDeep }}>Flexi Wallet {rd ? '(funded by Special Allowance)' : '(Other Reimbursement)'}</div>
            {rd ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: S.lg, flexWrap: 'wrap', margin: '6px 0 4px', ...numeric }}>
                <div>
                  <span style={{ fontSize: F.display, fontWeight: W.bold, color: TK.brandDeep, letterSpacing: '-.02em' }}>{R(rd.specialGross || rd.special)}</span>
                  <span style={{ fontSize: F.tiny, color: TK.muted, marginLeft: 6 }}>per month</span>
                </div>
                <span aria-hidden style={{ width: 1, height: 22, background: TK.brandEdge }} />
                <div>
                  <span style={{ fontSize: F.title, fontWeight: W.bold, color: TK.ink }}>{R(sal.other)}</span>
                  <span style={{ fontSize: F.tiny, color: TK.muted, marginLeft: 6 }}>per year</span>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: F.display, fontWeight: W.bold, color: TK.brandDeep, margin: '6px 0 2px', letterSpacing: '-.02em', ...numeric }}>{R(sal.other)}</div>
                <div style={{ fontSize: F.tiny, color: TK.muted }}>Fixed − Basic − HRA − PF</div>
              </>
            )}
            {rd && (rd.specialGross || rd.special) > 0 && rd.flexiMonthly > 0 && (
              <div style={{ height: 6, borderRadius: RAD.pill, background: TK.surface, overflow: 'hidden', margin: `${S.sm}px 0 6px`, maxWidth: 420 }}>
                <div style={{ width: `${Math.min(1, rd.flexiMonthly / (rd.specialGross || rd.special)) * 100}%`, height: '100%', background: TK.brand, borderRadius: RAD.pill }} />
              </div>
            )}
            {rd && <div style={{ fontSize: F.tiny, color: TK.inkSoft, ...numeric }}>Your full Special Allowance: {R(rd.specialGross || rd.special)}/month. {rd.flexiMonthly > 0 ? `${R(rd.flexiMonthly)}/month already declared, ${R(Math.max(0,(rd.specialGross||rd.special)-rd.flexiMonthly))} left.` : ''}</div>}
          </div>
          <InfoCallout t="neutral" compact style={{ marginTop: S.md, marginBottom: 0 }}>
            {rd
              ? <><b>Source:</b> full Special Allowance <b>{R(rd.specialGross || rd.special)}/month</b> × 12 = <b>{R(sal.other)} annual wallet</b>. Declared flexi is deducted from the Special Allowance paid as salary.</>
              : <><b>Formula:</b> {R(sal.fixed)} − {R(sal.basic)} (Basic) − {R(sal.hra)} (HRA) − {R(sal.epf)} (PF) = <b>Flexi Wallet {R(sal.other)}</b></>}
          </InfoCallout>
        </SectionCard>
      )}
      {sal.ctc > 0 && join.mid && (
        <InfoCallout t="info" icon={<IconCalendar size={17} />} title="Mid-year joining: pro-rata applies">
          You are with the company for <b>{join.months} month{join.months === 1 ? '' : 's'}</b> of FY 2026-27, so your salary income is earned for ≈<b>{Math.round(join.pr * 100)}%</b> of the year. Tax is computed on this pro-rated income and the <b>monthly TDS is spread over the {join.months} remaining pay month{join.months === 1 ? '' : 's'}</b>. (Employees who joined on/before 1 Apr 2026 are taxed on the full 12 months.)
        </InfoCallout>
      )}
      {sal.ctc > 0 && !join.mid && f.doj && (
        <InfoCallout t="positive" compact>Joined on/before 1 Apr 2026: taxed on the full financial year.</InfoCallout>
      )}
    </div>
  )

  // ── STEP 2 — Flexi declaration ──
  const carSel = (oFlexi.car || 0) > 0 || (nFlexi.car || 0) > 0
  const step2 = (
    <div>
      {carSel && (
        <InfoCallout t="warning" title="Car Lease + Driver: Perquisite Tax Applied">
          <div style={{ ...grid(140, S.sm), margin: `${S.sm}px 0` }}>
            {[['Car Lease Perq', '₹7,000', 'per month'], ['Driver Perq', '₹3,000', 'per month'], ['Total Perquisite', '₹10,000', '₹1,20,000/yr → taxable']].map(([l, v, sub]) => (
              <div key={l} style={{ background: TK.surface, borderRadius: RAD.md, padding: '9px 11px', border: `1px solid ${TK.warningEdge}` }}>
                <div style={{ fontSize: F.micro, color: TK.muted }}>{l}</div><div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.warning, ...numeric }}>{v}</div><div style={{ fontSize: F.micro, color: TK.muted }}>{sub}</div>
              </div>
            ))}
          </div>
          <div>Car lease is tax-exempt; Car + Driver are always selected together.</div>
        </InfoCallout>
      )}
      <SectionCard
        title="Children Details"
        icon={<IconEmployees size={16} />}
        hint="Affects Children's Education & Hostel Allowance limits"
        actions={<StatusPill t="warning" size="sm">Old Regime only</StatusPill>}
      >
        <div style={{ maxWidth: 260 }}>
          <Fg label="Number of Children">
            <select style={s.input} value={child.count} onChange={e => setChild(c => ({ ...c, count: +e.target.value }))}>
              <option value={0}>0 children</option><option value={1}>1 child</option><option value={2}>2 children (max)</option>
            </select>
          </Fg>
        </div>
        {child.count > 0 && (
          <div style={grid(220)}>
            {[1, 2].slice(0, child.count).map(n => {
              const cd = n === 1 ? child.c1 : child.c2
              const upd = (patch: any) => setChild(c => ({ ...c, [n === 1 ? 'c1' : 'c2']: { ...cd, ...patch } }))
              return (
                <div key={n} style={s.well}>
                  <div style={{ fontSize: F.small, fontWeight: W.bold, color: TK.ink, marginBottom: S.sm }}>Child {n}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.small, color: TK.inkSoft, marginBottom: 6, cursor: 'pointer' }}><input type="checkbox" checked={cd.school} onChange={e => upd({ school: e.target.checked })} style={{ accentColor: TK.brand }} /> Going to school?</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.small, color: TK.inkSoft, cursor: 'pointer' }}><input type="checkbox" checked={cd.hostel} onChange={e => upd({ hostel: e.target.checked })} style={{ accentColor: TK.brand }} /> Staying in hostel?</label>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
      <div style={{ ...grid(260), marginBottom: S.lg }}>
        <WalletMeter title="Old Regime Wallet" used={oTot} budget={sal.other} regimeNote="If you file under the Old Regime" />
        <WalletMeter title="New Regime Wallet" used={nTot} budget={sal.other} regimeNote="If you file under the New Regime" />
      </div>
      <SectionCard
        title="Flexi components"
        icon={<IconSliders size={16} />}
        hint="For each allowance, pick ₹0 or the full limit under each regime. Declared amounts are paid against bills and are exempt from tax."
        actions={<StatusPill t="brand" size="sm">Slab: {SLAB_LABELS[sal.si]}</StatusPill>}
      >
        <div style={grid(250)}>
          {COMPS.map(({ k, l, perq }) => (
            <FlexiCard key={k} label={l} perq={perq}
              oL={getOldLimit(k)} nL={getNewLimit(k)} oV={oFlexi[k] || 0} nV={nFlexi[k] || 0}
              onOld={v => setFlexi('old', k, v)} onNew={v => setFlexi('new', k, v)} />
          ))}
        </div>
        <div style={{ marginTop: S.lg, borderTop: `1px solid ${TK.line}`, paddingTop: S.md }}>
          <div style={{ ...eyebrow, marginBottom: S.sm }}>Total Selected</div>
          <div style={grid(200, S.sm)}>
            {([['Old Regime', oTot, T?.oClaim], ['New Regime', nTot, T?.nClaim]] as [string, number, number | undefined][]).map(([lbl, tot, exempt]) => {
              const over = tot > sal.other
              return (
                <div key={lbl} style={{ ...s.well, background: over ? TK.criticalTint : TK.sunken, borderColor: over ? TK.criticalEdge : TK.line }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: S.sm }}>
                    <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: TK.inkSoft }}>{lbl}</span>
                    <span style={{ fontSize: F.title, fontWeight: W.bold, color: over ? TK.critical : TK.ink, ...numeric }}>{R(tot)}</span>
                  </div>
                  {exempt != null && <div style={{ fontSize: F.micro, color: TK.positive, marginTop: 4, ...numeric }}>Tax-exempt this FY{T?.mid ? ' (pro-rated)' : ''}: <b>{R(exempt)}</b></div>}
                </div>
              )
            })}
          </div>
        </div>
      </SectionCard>
    </div>
  )

  // ── STEP 3 — Investments ──
  const numIn = (k: string, ph = '0') => <input style={s.input} type="number" value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} />
  const c80Total = Math.min(N(f.lic) + N(f.ppf) + N(f.elss) + sal.epf + N(f.tuit) + N(f.hlP), 150000)
  const addITotal = N(f.oi) + N(f.bon) + N(f.iinc) + N(f.varEx) + N(f.iInc)
  const monthSelect = (k: string) => <select style={s.input} value={f[k]} onChange={e => set(k, e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
  const step3 = (
    <div style={{ ...grid(340, S.lg), alignItems: 'start' }}>
      {/* OLD */}
      <div style={{ minWidth: 0 }}>
        <RegimeHead t="info" title="Old Regime Declaration" sub="Std Deduction ₹50,000 | 80C max ₹1,50,000"
          note="These deductions lower your tax only if you choose the Old Regime." />

        <SectionCard title="HRA Exemption (Old Regime only)" icon={<IconBuilding size={16} />} hint="If you pay rent, part of your HRA becomes tax-free.">
          {sal.hra > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap', background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: RAD.md, padding: `${S.sm + 2}px ${S.md}px`, marginBottom: S.md }}>
              <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: TK.brandDeep, ...numeric }}>Your HRA: Annual {R(sal.hra)} · Monthly {R(sal.hra / 12)}</div>
              <PButton size="sm" variant="primary" iconRight={<IconArrowRight size={13} />} onClick={() => setF(p => ({ ...p, rentM: String(Math.round(sal.hra / 12)), hra1From: '1', hra1To: '12' }))}>Apply suggested rent</PButton>
            </div>
          )}
          <div style={{ ...s.well, marginBottom: S.md }}>
            <SubHead>Period 1: Rent Paid</SubHead>
            <div style={grid(150, S.sm)}>
              <Fg label="From Month">{monthSelect('hra1From')}</Fg>
              <Fg label="To Month">{monthSelect('hra1To')}</Fg>
            </div>
            <Fg label="Monthly Rent Paid (₹)">{numIn('rentM')}</Fg>
            <Fg label="City Type"><select style={s.input} value={f.cityType} onChange={e => set('cityType', e.target.value)}><option value="nonmetro">Non-Metro (40% of Basic)</option><option value="metro">Metro (50% of Basic)</option></select></Fg>
            <Fg label="Landlord PAN (required if annual rent > ₹1,00,000)"><input style={{ ...s.input, textTransform: 'uppercase' }} value={f.landlordPAN} onChange={e => set('landlordPAN', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></Fg>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.tiny, fontWeight: W.semi, color: TK.brandDeep, marginBottom: S.md, padding: '10px 12px', background: TK.surface, border: `1px dashed ${TK.brandEdge}`, borderRadius: RAD.md, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!f.showHra2} onChange={e => set('showHra2', e.target.checked ? 'y' : '')} style={{ accentColor: TK.brand }} /> Changed residence mid-year? Add second HRA period
          </label>
          {f.showHra2 && (
            <div style={{ ...s.well, marginBottom: S.md }}>
              <SubHead>Period 2</SubHead>
              <div style={grid(150, S.sm)}>
                <Fg label="From Month">{monthSelect('hra2From')}</Fg>
                <Fg label="To Month">{monthSelect('hra2To')}</Fg>
              </div>
              <Fg label="Monthly Rent Paid (₹)">{numIn('rentM2')}</Fg>
              <Fg label="City Type"><select style={s.input} value={f.cityType2} onChange={e => set('cityType2', e.target.value)}><option value="nonmetro">Non-Metro (40%)</option><option value="metro">Metro (50%)</option></select></Fg>
            </div>
          )}
          {N(f.rentM) > 0 && <div style={{ ...s.sumRow, background: TK.positiveTint, color: TK.positive, border: `1px solid ${TK.positiveEdge}` }}><span>Total HRA Exempt</span><span>{R(hraExempt)}</span></div>}
        </SectionCard>

        <SectionCard title="Section 80C (Max ₹1,50,000)" icon={<IconFinance size={16} />}
          hint="Tax-saving investments and payments: your PF, LIC, PPF, ELSS, children's tuition and home-loan principal, together capped at ₹1.5 lakh."
          actions={<StatusPill t={c80Total >= 150000 ? 'positive' : 'brand'} size="sm">{Math.round(c80Total / 150000 * 100)}% used</StatusPill>}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', background: TK.sunken, borderRadius: RAD.md, fontSize: F.tiny, marginBottom: S.md, border: `1px solid ${TK.line}`, ...numeric }}><span style={{ color: TK.muted }}>Employee PF (auto)</span><span style={{ fontWeight: W.bold, color: TK.ink }}>{R(sal.epf)}</span></div>
          <div style={grid(170, S.sm)}>
            <Fg label="LIC Premium">{numIn('lic')}</Fg><Fg label="PPF">{numIn('ppf')}</Fg><Fg label="ELSS / Mutual Funds">{numIn('elss')}</Fg>
            <Fg label="Tuition Fees">{numIn('tuit')}</Fg><Fg label="Home Loan Principal">{numIn('hlP')}</Fg>
          </div>
          <div style={{ ...s.sumRow, background: c80Total >= 150000 ? TK.positiveTint : TK.warningTint, color: c80Total >= 150000 ? TK.positive : TK.warning, border: `1px solid ${c80Total >= 150000 ? TK.positiveEdge : TK.warningEdge}` }}><span>Total 80C</span><span>{R(c80Total)} / ₹1,50,000</span></div>
          <LimitMeter used={c80Total} limit={150000} />
        </SectionCard>

        <SectionCard title="80D, Home Loan & NPS" icon={<IconHeart size={16} />} hint="Health-insurance premiums, home-loan interest and your own NPS contribution.">
          <Fg label="80D Self + Family (max ₹25,000)" hint={<LimitMeter used={N(f.medSelf)} limit={25000} />}>{numIn('medSelf')}</Fg>
          <Fg label="80D Parents (max ₹50,000)" hint={<LimitMeter used={N(f.medParents)} limit={50000} />}>{numIn('medParents')}</Fg>
          <Fg label="Home Loan Interest Sec 24(b) (max ₹2,00,000)" hint={<LimitMeter used={N(f.hlInt)} limit={200000} />}>{numIn('hlInt')}</Fg>
          <Fg label="NPS Self 80CCD(1B) (max ₹50,000)"><select style={s.input} value={f.npsSelf} onChange={e => set('npsSelf', e.target.value)}><option value="0">₹0: Not investing</option><option value="50000">₹50,000: Max benefit</option></select></Fg>
          <Fg label="Employer NPS 80CCD(2): 10% of Basic (fully exempt)"><select style={s.input} value={f.emplrNpsOld} onChange={e => set('emplrNpsOld', e.target.value)}><option value="0">₹0: Not applicable</option><option value="on">{R(Math.round(sal.basic * .1))} (Basic × 10%)</option></select></Fg>
        </SectionCard>

        <SectionCard title="Other Deductions (80E · 80DD · 80DDB · 80G)" icon={<IconAward size={16} />} hint="Education-loan interest, a disabled dependant, specified-disease treatment and PM relief donations.">
          <Fg label="80E: Education Loan Interest (max ₹2,00,000)" hint={<LimitMeter used={N(f.eduLoan)} limit={200000} />}>{numIn('eduLoan')}</Fg>
          <Fg label="80DD: Dependent Disability (fixed)"><select style={s.input} value={f.dep80dd} onChange={e => set('dep80dd', e.target.value)}><option value="0">₹0: Not applicable</option><option value="75000">₹75,000: 40–80% (Normal)</option><option value="125000">₹1,25,000: 80%+ Severe</option></select></Fg>
          <Fg label="80DDB: Specified Disease (max ₹1,00,000)" hint={<LimitMeter used={N(f.dis80ddb)} limit={100000} />}>{numIn('dis80ddb')}</Fg>
          <Fg label="80G: PM Relief / PM CARES (100%, max ₹2,00,000)" hint={<LimitMeter used={N(f.pmFund)} limit={200000} />}>{numIn('pmFund')}</Fg>
        </SectionCard>
      </div>

      {/* NEW */}
      <div style={{ minWidth: 0 }}>
        <RegimeHead t="brand" title="New Regime Declaration" sub="Std Deduction ₹75,000 | No HRA / 80C / 80D"
          note="Lower slab rates with fewer deductions. Only the items below count." />
        <SectionCard title="Standard Deduction & Employer NPS" icon={<IconCheckCircle size={16} />} iconTone="positive">
          <div style={{ ...s.well, background: TK.positiveTint, borderColor: TK.positiveEdge, marginBottom: S.md }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.small, marginBottom: 4, ...numeric }}><span style={{ color: TK.positive, fontWeight: W.semi }}>Standard Deduction (auto)</span><span style={{ fontWeight: W.bold, color: TK.ink }}>₹75,000</span></div>
            <div style={{ fontSize: F.micro, color: TK.muted }}>HRA · LTA · 80C · 80D · Home Loan: Not applicable</div>
          </div>
          <Fg label="Employer NPS 80CCD(2): 14% of Basic (fully exempt)"><select style={s.input} value={f.emplrNpsNew} onChange={e => set('emplrNpsNew', e.target.value)}><option value="0">₹0: Not applicable</option><option value="on">{R(Math.round(sal.basic * .14))} (Basic × 14%)</option></select></Fg>
        </SectionCard>
        <SectionCard title="Additional Income (FY 2026-27)" icon={<IconReceipt size={16} />} hint="Income outside this salary. It is added to your taxable income under both regimes.">
          <Fg label="Other Income (rental, freelance)">{numIn('oi')}</Fg>
          <Fg label="Bonus / Commission">{numIn('bon')}</Fg>
          <Fg label="Incentive / Award">{numIn('iinc')}</Fg>
          <Fg label="Variable Pay Expected (rest of year)">{numIn('varEx')}</Fg>
          <Fg label="Interest Income (FD / Savings)">{numIn('iInc')}</Fg>
          <div style={{ ...s.sumRow, background: TK.sunken, color: TK.ink, border: `1px solid ${TK.line}` }}><span>Total Additional Income</span><span>{R(addITotal)}</span></div>
        </SectionCard>
      </div>
    </div>
  )

  // Download the full declaration (all filled details) as a multi-sheet Excel.
  function downloadDeclaration() {
    if (!T) return
    const isOld = chosenRegime === 'OLD'
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
    const dt = new Date().toLocaleString('en-IN')
    const num = (v: any) => Math.round(Number(v) || 0)

    // 1) Summary
    const summary: any[][] = [
      ['EZER HRMS: Flexi & TDS Declaration', ''],
      ['Financial Year', 'FY 2026-27 (AY 2027-28)'],
      ['Employee', `${empName || ''} (${empCode || ''})`],
      ['Submitted On', dt],
      ['Chosen Regime', isOld ? 'OLD Regime' : 'NEW Regime'],
      ['', ''],
      ['SALARY', ''],
      ['Annual CTC', num(sal.ctc)],
      ['Variable Pay (annual)', num(sal.vari)],
      ['Fixed Salary (annual)', num(sal.fixed)],
      ['Basic (monthly)', num(sal.basic / 12)],
      ['HRA (monthly)', num(sal.hra / 12)],
      ['Employer PF (annual)', num(sal.epf)],
      ['Flexi Wallet (monthly)', num(sal.other)],
      ['Salary Slab', SLAB_LABELS[sal.si]],
      ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`],
    ]

    // 2) Flexi declaration (per component, both regimes, annual)
    const flexi: any[][] = [['Component', 'Old Regime (₹/yr)', 'New Regime (₹/yr)']]
    COMPS.forEach(c => { const o = oFlexi[c.k] || 0, n = nFlexi[c.k] || 0; if (o || n) flexi.push([c.l, o, n]) })
    flexi.push(['TOTAL', Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0), Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)])

    // 3) Investments / deductions (annual)
    const inv: any[][] = [
      ['Deduction / Investment', 'Amount (₹)', 'Applies to'],
      ['Monthly Rent Declared', N(f.rentM), 'Old (HRA)'],
      ['HRA Exemption', num(T.hE), 'Old'],
      ['80C: LIC', N(f.lic), 'Old'],
      ['80C: PPF', N(f.ppf), 'Old'],
      ['80C: ELSS / Mutual Funds', N(f.elss), 'Old'],
      ['80C: Tuition Fees', N(f.tuit), 'Old'],
      ['80C: Home Loan Principal', N(f.hlP), 'Old'],
      ['80C: Employee PF (auto)', num(sal.epf), 'Old'],
      ['80C Total (capped ₹1.5L)', num(T.c80), 'Old'],
      ['80D: Self + Family', num(T.medS), 'Old'],
      ['80D: Parents', num(T.medP), 'Old'],
      ['Home Loan Interest 24(b)', num(T.hlI), 'Old'],
      ['NPS Self 80CCD(1B)', num(T.npsS), 'Old'],
      ['Employer NPS 80CCD(2)', num(isOld ? T.eNpsO : T.eNpsN), 'Both'],
      ['80E: Education Loan', num(T.eduLoan), 'Old'],
      ['80DD: Dependent Disability', num(T.dep80dd), 'Old'],
      ['80DDB: Disease Treatment', num(T.dis80ddb), 'Old'],
      ['80G: PM Relief / Donations', num(T.pmFund), 'Old'],
      ['Additional Income', num(T.addI), 'Both'],
    ]

    // 4) TDS report (both regimes)
    const tds: any[][] = [
      ['', 'Old Regime', 'New Regime'],
      ['Gross Taxable Income', num(T.grossO), num(T.grossN)],
      ['Total Deductions', num(T.dO), num(T.dN)],
      ['Net Taxable Income', num(T.tO), num(T.tN)],
      ['Annual Tax', num(T.fO), num(T.fN)],
      ['Monthly TDS', num(T.moO), num(T.moN)],
      ['Effective Rate %', T.efO, T.efN],
      ['', '', ''],
      ['Recommended Regime', rec, ''],
      ['Your Chosen Regime', isOld ? 'OLD' : 'NEW', ''],
      ['Annual Tax Saving (best)', Math.abs(T.fO - T.fN), ''],
      ['Payable Monthly TDS (chosen)', isOld ? num(T.moO) : num(T.moN), ''],
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(flexi), 'Flexi Declaration')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Investments')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tds), 'TDS Report')
    XLSX.writeFile(wb, `EZER_Flexi_TDS_Declaration_${empCode || 'employee'}.xlsx`)
  }

  // Full declaration as a formatted, printable PDF (opens → Save as PDF).
  function downloadDeclarationPdf() {
    if (!T) return
    const isOld = chosenRegime === 'OLD'
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW'
    const dt = new Date().toLocaleString('en-IN')
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')
    const flexiRows = COMPS.filter(c => (oFlexi[c.k] || 0) || (nFlexi[c.k] || 0)).map(c => `<tr><td>${esc(c.l)}</td><td class="r">${R(oFlexi[c.k] || 0)}</td><td class="r">${R(nFlexi[c.k] || 0)}</td></tr>`).join('')
    const oTotV = Object.values(oFlexi).reduce((a, b) => a + (b || 0), 0), nTotV = Object.values(nFlexi).reduce((a, b) => a + (b || 0), 0)
    const invRows = ([
      ['HRA Exemption', R(T.hE)], ['80C (capped ₹1.5L)', R(T.c80)], ['80D Self+Family', R(T.medS)], ['80D Parents', R(T.medP)],
      ['Home Loan Interest 24(b)', R(T.hlI)], ['NPS Self 80CCD(1B)', R(T.npsS)], ['Employer NPS 80CCD(2)', R(isOld ? T.eNpsO : T.eNpsN)],
      ['80E Education Loan', R(T.eduLoan)], ['80DD Dependent Disability', R(T.dep80dd)], ['80DDB Disease', R(T.dis80ddb)], ['80G Donations', R(T.pmFund)], ['Additional Income', R(T.addI)],
    ] as [string, string][]).filter(([, v]) => v !== '₹0').map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Flexi & TDS Declaration: ${esc(empCode)}</title><style>
      *{box-sizing:border-box} body{font-family:"DM Sans","Segoe UI",sans-serif;color:#1E1B4B;margin:0;background:#F5F3FF}
      .doc{background:#fff;max-width:820px;margin:22px auto;padding:34px 40px;border:1px solid #E9E7F5;border-radius:14px}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563EB;padding-bottom:14px;margin-bottom:16px}
      .brand{font-size:22px;font-weight:800;color:#2563EB}.title{text-align:right;font-size:14px;font-weight:800;letter-spacing:.05em}
      .title .sub{font-size:11px;color:#2563EB}
      .badge{display:inline-block;padding:4px 14px;border-radius:99px;font-weight:800;font-size:13px;background:${isOld ? '#FEF3C7' : '#DCFCE7'};color:${isOld ? '#B45309' : '#047857'};border:2px solid ${isOld ? '#F59E0B' : '#10B981'}}
      h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#3C3489;margin:20px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td,th{padding:7px 10px;border-bottom:1px solid #F1F0FA;text-align:left}
      th{background:#1E1B4B;color:#fff;font-size:11px}.r{text-align:right}.k{color:#6B7280;width:45%}.v{font-weight:600}
      .tot td{font-weight:800;color:#2563EB;background:#F5F3FF}
      .note{margin-top:20px;font-size:11px;color:#9CA3AF;line-height:1.5;border-top:1px dashed #E9E7F5;padding-top:12px}
      @media print{body{background:#fff}.doc{border:none;margin:0;border-radius:0;max-width:100%}}
    </style></head><body><div class="doc">
      <div class="hd"><div><div class="brand">EZER HRMS</div><div style="font-size:12px;color:#6B7280">Flexi &amp; Tax Declaration</div></div>
        <div class="title"><div>FLEXI &amp; TDS</div><div class="sub">DECLARATION · FY 2026-27</div></div></div>
      <table>${kv([['Employee', `${empName || ''} (${empCode || ''})`], ['Submitted On', dt]])}
        <tr><td class="k">Chosen Regime</td><td><span class="badge">${isOld ? 'OLD REGIME' : 'NEW REGIME'}</span></td></tr></table>
      <h3>Salary</h3><table>${kv([['Annual CTC', R(sal.ctc)], ['Variable Pay', R(sal.vari)], ['Fixed Salary', R(sal.fixed)], ['Basic (monthly)', R(sal.basic / 12)], ['HRA (monthly)', R(sal.hra / 12)], ['Flexi Wallet (monthly)', R(sal.other)], ['Salary Slab', SLAB_LABELS[sal.si]], ['Months in FY (worked)', `${T.months} of 12 (${Math.round(T.pr * 100)}%)`]])}</table>
      <h3>Flexi Declaration (annual)</h3><table><thead><tr><th>Component</th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>${flexiRows || '<tr><td colspan="3" style="color:#9CA3AF">None declared</td></tr>'}<tr class="tot"><td>Total</td><td class="r">${R(oTotV)}</td><td class="r">${R(nTotV)}</td></tr></tbody></table>
      <h3>Investments &amp; Deductions</h3><table><tbody>${invRows || '<tr><td colspan="2" style="color:#9CA3AF">None declared</td></tr>'}</tbody></table>
      <h3>TDS Report</h3><table><thead><tr><th></th><th class="r">Old Regime</th><th class="r">New Regime</th></tr></thead><tbody>
        <tr><td>Gross Taxable</td><td class="r">${R(T.grossO)}</td><td class="r">${R(T.grossN)}</td></tr>
        <tr><td>Deductions</td><td class="r">${R(T.dO)}</td><td class="r">${R(T.dN)}</td></tr>
        <tr><td>Net Taxable</td><td class="r">${R(T.tO)}</td><td class="r">${R(T.tN)}</td></tr>
        <tr><td>Annual Tax</td><td class="r">${R(T.fO)}</td><td class="r">${R(T.fN)}</td></tr>
        <tr class="tot"><td>Monthly TDS</td><td class="r">${R(T.moO)}</td><td class="r">${R(T.moN)}</td></tr></tbody></table>
      <div style="margin-top:12px;font-size:13px"><b>Recommended:</b> ${rec} Regime (lower tax) · <b>Your choice:</b> ${isOld ? 'Old' : 'New'} · <b>Payable Monthly TDS:</b> ${R(isOld ? T.moO : T.moN)}</div>
      <div class="note">System-generated declaration for FY 2026-27 (AY 2027-28). Figures are estimates for planning; actual TDS may vary with final proofs and payroll processing. Not tax advice.</div>
    </div><script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Submit the chosen regime → store in DB + LOCK + download. Confirms first (Yes/No).
  async function submitRegime() {
    if (sandbox) return
    if (!chosenRegime || !T) return
    const isOldR = chosenRegime === 'OLD'
    const emplrNps = f.emplrNpsOld === 'on' || f.emplrNpsNew === 'on'
    // Confirmation: are you sure you want to select this regime? (+ NPS warning if applicable)
    let msg = `Are you sure you want to select the ${isOldR ? 'Old' : 'New'} Regime?\n\nYour regime will be locked after submission and your declaration will be downloaded.`
    if (emplrNps) msg = `You have chosen Employer NPS that will reduce your in-hand.\n\n` + msg
    msg += `\n\nYes → submit & download   ·   No → go back and choose`
    if (!window.confirm(msg)) return
    setSaving(true); setSaved(false)
    const isOld = chosenRegime === 'OLD'
    const monthlyTds = isOld ? T.moO : T.moN
    // Primary store: employees.tds_regime (read by flexi / claims / payroll).
    const { error } = await supabase.from('employees').update({ tds_regime: chosenRegime }).eq('id', employeeId)
    // Full calculator state (draft/submit persistence — every field returns on revisit).
    try { await persistForm('SUBMITTED') } catch { /* form store optional (needs sql52) */ }
    // Structured declaration → Investment report + payroll TDS.
    try {
      await supabase.from('tds_declarations').upsert({
        employee_id: employeeId, company_id: companyId, fy: FY, regime: chosenRegime,
        sec_80c: T.c80, sec_80d: T.medS + T.medP, sec_80e: T.eduLoan, sec_24b: T.hlI,
        hra_claimed: T.hE, lta_claimed: T.ltaAmt, nps_80ccd1b: T.npsS,
        employer_nps_80ccd2: isOld ? T.eNpsO : T.eNpsN,
        total_declared: T.c80 + T.medS + T.medP + T.hlI + T.eduLoan + T.npsS,
        annual_tax_old: T.fO, annual_tax_new: T.fN, monthly_tds: monthlyTds,
        // Write-through (C1a): the engine reads the RENT, the metro flag and the landlord
        // PAN from tds_declarations — not hra_claimed, which is this calculator's own
        // working. Leaving them behind here is how monthly_rent went missing on STC9064
        // and HRA exemption computed to zero.
        monthly_rent: N(f.rentM), is_metro: f.cityType === 'metro',
        landlord_pan: f.landlordPAN ? String(f.landlordPAN).toUpperCase() : null,
        sec_80d_self: T.medS, sec_80d_parents: T.medP,
        declaration_status: 'SUBMITTED', submitted_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,fy' })
    } catch { /* tds_declarations optional (needs sql44) */ }
    // The itemised split (C1c) — one row per section, so the payslip can print
    // "Provident Fund / LIC / PPF" under 80C instead of one capped total.
    try {
      const lines = [
        ['80C_LIC', N(f.lic)], ['80C_PPF', N(f.ppf)], ['80C_ELSS', N(f.elss)], ['80C_TUITION', N(f.tuit)],
        ['80C_PRINCIPAL', N(f.hlP)], ['80CCC', N(f.pmFund)], ['80CCD_1B', N(f.npsSelf)],
        ['80D_SELF', N(f.medSelf)], ['80D_PARENTS', N(f.medParents)], ['80E', N(f.eduLoan)], ['24B_SELF', N(f.hlInt)],
      ] as [string, number][]
      const rows = lines.map(([section_code, declared_amount]) => ({
        employee_id: employeeId, fy: FY, section_code, declared_amount, source: 'calculator', updated_at: new Date().toISOString(),
      }))
      await supabase.from('investment_declaration_lines').upsert(rows, { onConflict: 'employee_id,fy,section_code' })
    } catch { /* lines table optional (needs 066) */ }
    setSaving(false)
    if (error) { alert('Could not save your regime: ' + error.message); return }
    setSaved(true); setDefaultedNew(false); setStatus('SUBMITTED'); setEditMode(null)
    // Auto-download the full declaration (PDF) after submit.
    try { downloadDeclarationPdf() } catch { /* download best-effort */ }
  }

  // ── STEP 4 — TDS report ──
  // saveDraft prefixes its failure message with ⚠; anything else is a success note.
  const draftIsError = draftMsg.startsWith('⚠')
  const step4 = (() => {
    if (!T) return <SectionCard><EmptyState icon={<IconReceipt size={20} />} title="Complete Steps 1–3 first." hint="Your Old vs New regime comparison appears here once an Annual CTC is available." /></SectionCard>
    const rec = T.fO <= T.fN ? 'OLD' : 'NEW', save = Math.abs(T.fO - T.fN)
    const recName = rec === 'OLD' ? 'Old' : 'New'
    const maxTax = Math.max(T.fO, T.fN, 1)
    const metrics: { l: string; v: string; s: string; t?: 'positive' | 'brand'; e?: boolean }[] = [
      { l: 'Annual CTC', v: R(sal.ctc), s: SLAB_LABELS[sal.si] }, { l: T.mid ? 'Earned Salary' : 'Flexi Wallet', v: R(T.mid ? sal.ctc * T.pr : sal.other), s: T.mid ? `${T.months} mo · ${Math.round(T.pr * 100)}%` : 'Other Reimb.' },
      { l: 'Old Regime Tax', v: R(T.fO), s: 'Eff ' + T.efO + '%' }, { l: 'New Regime Tax', v: R(T.fN), s: 'Eff ' + T.efN + '%' },
      { l: 'HRA Exemption', v: R(T.hE), s: T.hE ? 'Old only' : 'No rent' }, { l: 'Tax Savings', v: R(save), s: rec + ' wins', t: 'positive' },
      { l: 'Monthly TDS', v: R(rec === 'OLD' ? T.moO : T.moN), s: 'Recommended', e: true }, { l: 'Best Regime', v: rec, s: 'For you', t: 'positive' },
    ]
    return (
      <div>
        {/* ── Verdict ── */}
        <section className="ez-rise" style={{ background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: RAD.lg, boxShadow: E.raised, marginBottom: S.lg, overflow: 'hidden', position: 'relative' }}>
          <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: TK.positive }} />
          <div style={{ padding: `${S.xl}px ${S.xl}px ${S.lg}px`, display: 'flex', flexWrap: 'wrap', gap: S.xl, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>
              <StatusPill t="positive" icon={<IconCheck size={11} strokeWidth={2.4} />}>Recommended: {recName} Regime</StatusPill>
              <div style={{ fontSize: F.title + 6, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.02em', lineHeight: 1.2, marginTop: S.md, ...numeric }}>
                {save > 0 ? <>{recName} regime saves you <span style={{ color: TK.positive }}>{R(save)}</span> a year</> : <>Both regimes cost you the same</>}
              </div>
              <div style={{ fontSize: F.small, color: TK.muted, marginTop: 6, lineHeight: 1.55, ...numeric }}>You save <b style={{ color: TK.ink }}>{R(save)}</b> annually with the {recName} Regime, based on everything you declared in Steps 1–3.</div>
            </div>
            <div style={{ flex: '0 1 240px', minWidth: 0, background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: RAD.lg, padding: `${S.md}px ${S.lg}px` }}>
              <div style={{ ...eyebrow }}>Annual Tax · {recName} Regime</div>
              <div style={{ fontSize: F.display + 4, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.02em', marginTop: 4, ...numeric }}>{R(rec === 'OLD' ? T.fO : T.fN)}</div>
              <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 2, ...numeric }}>Monthly TDS <b style={{ color: TK.brandDeep }}>{R(rec === 'OLD' ? T.moO : T.moN)}</b></div>
            </div>
          </div>
          <div style={{ padding: `0 ${S.xl}px ${S.md}px` }}>
            <CompareBar label="Old Regime" tax={T.fO} mo={T.moO} pct={T.fO / maxTax} best={rec === 'OLD'} />
            <CompareBar label="New Regime" tax={T.fN} mo={T.moN} pct={T.fN / maxTax} best={rec === 'NEW'} />
          </div>
        </section>

        {/* ── Save & Submit: choose Old / New regime, save draft, or submit (locks) ── */}
        {!sandbox && <>
          <SectionCard
            title="Save & Submit: Tax Regime"
            icon={<IconFile size={16} />}
            hint="Payroll deducts TDS every month on the regime you submit."
            actions={<>
              {isSubmitted && !editMode && <StatusPill t="positive" size="sm" icon={<IconLock size={10} />}>Submitted &amp; locked</StatusPill>}
              {editMode && <StatusPill t="warning" size="sm" dot>Editing {editMode === 'all' ? 'flexi + investments' : 'flexi only'}</StatusPill>}
              {status === 'DRAFT' && <StatusPill t="info" size="sm" dot>Draft saved</StatusPill>}
            </>}
          >
            {!userPicked && !isSubmitted && recRegime && (
              <InfoCallout t="info" compact>We&apos;ve pre-selected the <b>{recRegime === 'OLD' ? 'Old' : 'New'} Regime</b>. It gives you the <b>lower annual tax</b>. You can change it below before submitting.</InfoCallout>
            )}
            {isSubmitted && !editMode && (
              <InfoCallout t="brand" compact icon={<IconLock size={13} />}>You submitted the <b>{chosenRegime === 'OLD' ? 'Old' : 'New'} Regime</b>. Your regime is locked. {chosenRegime === 'OLD' ? 'Use Edit to change your flexi & investment declarations.' : 'Use Edit to change your flexi declaration (investment sections don’t apply to the New Regime).'}</InfoCallout>
            )}
            <div role="radiogroup" aria-label="Tax regime" style={grid(220)}>
              {(['OLD', 'NEW'] as const).map(rg => {
                const sel = chosenRegime === rg
                const isOld = rg === 'OLD'
                const tax = isOld ? T.fO : T.fN, mo = isOld ? T.moO : T.moN
                return (
                  <button key={rg} role="radio" aria-checked={sel} className={regimeLocked ? undefined : 'ez-press'} onClick={() => { if (!regimeLocked) { setChosenRegime(rg); setUserPicked(true); setSaved(false) } }} disabled={regimeLocked} style={{
                    textAlign: 'left', padding: `${S.md + 2}px ${S.lg}px`, borderRadius: RAD.lg, cursor: regimeLocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    border: `2px solid ${sel ? TK.brand : TK.line}`, boxShadow: sel ? `0 0 0 3px ${TK.brandTint}` : E.flat,
                    background: sel ? TK.brandTint : TK.surface, opacity: regimeLocked && !sel ? .45 : 1, transition: `border-color ${M.quick}, box-shadow ${M.quick}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
                      <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${sel ? TK.brand : TK.lineStrong}`, background: TK.surface, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' }}>
                        {sel && <span style={{ width: 8, height: 8, borderRadius: '50%', background: TK.brand }} />}
                      </span>
                      <span style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink }}>{isOld ? 'Old Regime' : 'New Regime'}</span>
                      {rec === rg && <StatusPill t="positive" size="sm">Recommended</StatusPill>}
                      {regimeLocked && sel && <span style={{ marginLeft: 'auto', display: 'inline-flex', color: TK.muted }}><IconLock size={13} /></span>}
                    </div>
                    <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: S.sm, ...numeric }}>Annual tax <b style={{ color: TK.ink }}>{R(tax)}</b> · Monthly TDS <b style={{ color: TK.ink }}>{R(mo)}</b></div>
                  </button>
                )
              })}
            </div>
          </SectionCard>
          <ActionBar
            hint={isSubmitted && !editMode
              ? `Your ${chosenRegime === 'OLD' ? 'Old' : 'New'} Regime is locked. Edit reopens ${chosenRegime === 'OLD' ? 'flexi & investments' : 'flexi'}; the regime itself stays as submitted.`
              : editMode ? 'Save & re-submit stores your changes and downloads an updated declaration.'
              : 'Submitting locks your regime and downloads your declaration. Save Draft keeps your work without submitting.'}
          >
            {(!isSubmitted || editMode) && (
              <PButton variant="primary" onClick={submitRegime} disabled={!chosenRegime || saving} icon={<IconCheckCircle size={15} />}>
                {saving ? 'Saving…' : editMode ? 'Save & re-submit' : `Submit ${chosenRegime || ''} declaration`}
              </PButton>
            )}
            {!isSubmitted && (
              <PButton onClick={saveDraft} disabled={saving}>Save Draft</PButton>
            )}
            {isSubmitted && !editMode && (
              <PButton variant="primary" onClick={() => setEditMode(chosenRegime === 'OLD' ? 'all' : 'flexi')}>Edit {chosenRegime === 'OLD' ? 'flexi & investments' : 'flexi'}
              </PButton>
            )}
            {isSubmitted && !editMode && (
              <>
                <PButton onClick={downloadDeclarationPdf} icon={<IconDownload size={14} />}>Download PDF</PButton>
                <PButton onClick={downloadDeclaration} icon={<IconDownload size={14} />}>Excel</PButton>
              </>
            )}
            {editMode && <PButton variant="ghost" onClick={() => { setEditMode(null); setStatus('SUBMITTED') }}>Cancel edit</PButton>}
            {draftMsg && <span style={{ fontSize: F.tiny, color: draftIsError ? TK.critical : TK.positive, fontWeight: W.semi }}>{draftMsg}</span>}
          </ActionBar>
        </>}

        {T.mid && (
          <InfoCallout t="info" icon={<IconCalendar size={17} />} title="Pro-rated for mid-year joining">
            Salary income taxed for <b>{T.months} of 12 months</b> (≈{Math.round(T.pr * 100)}%). Annual tax above is spread over the <b>{T.months} remaining pay month{T.months === 1 ? '' : 's'}</b>: Monthly TDS = Annual Tax ÷ {T.months}. Standard deduction &amp; your actual investment declarations are counted in full.
          </InfoCallout>
        )}
        <KpiGrid min={230}>
          {metrics.map(m => <KpiTile key={m.l} label={m.l} value={m.v} sub={m.s} t={m.t} emphasis={m.e} />)}
        </KpiGrid>
        <div style={{ ...grid(280), marginBottom: S.lg }}>
          {(['OLD', 'NEW'] as const).map(rg => {
            const io = rg === 'OLD', ir = rec === rg
            const tax = io ? T.fO : T.fN, gr = io ? T.gO : T.gN, ded = io ? T.dO : T.dN, tx2 = io ? T.tO : T.tN, mo = io ? T.moO : T.moN, eff = io ? T.efO : T.efN
            return (
              <div key={rg} style={{ background: TK.surface, border: `1px solid ${ir ? TK.positiveEdge : TK.line}`, borderRadius: RAD.lg, boxShadow: ir ? `0 0 0 3px ${TK.positiveTint}, ${E.raised}` : E.raised, padding: `${S.lg}px ${S.lg + 2}px`, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ ...eyebrow, color: TK.inkSoft }}>{io ? 'Old' : 'New'} Regime</span>
                  {ir && <StatusPill t="positive" size="sm" solid>Recommended</StatusPill>}
                </div>
                <div style={{ fontSize: F.display, fontWeight: W.bold, color: ir ? TK.positive : TK.ink, margin: '6px 0 2px', letterSpacing: '-.02em', ...numeric }}>{R(tax)}</div>
                <div style={{ fontSize: F.tiny, color: TK.muted, marginBottom: S.md, ...numeric }}>Effective {eff}% · Monthly TDS {R(mo)}</div>
                {[['Gross Income', R(gr)], ['(–) Deductions', R(ded)], ['= Net Taxable', R(tx2)], ['Annual Tax', R(tax)], ['Monthly TDS', R(mo)]].map(([l, v], i) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: F.small, borderTop: `1px solid ${TK.line}`, fontWeight: i >= 3 ? W.semi : W.regular, ...numeric }}>
                    <span style={{ color: TK.muted }}>{l}</span><span style={{ fontWeight: W.semi, color: TK.ink }}>{v}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <SectionCard flush title="Taxable Income Breakup (Component-wise)" icon={<IconLayers size={16} />} hint="What is taxable, what is exempt, and how TDS is computed">
          <DataTable minWidth={460}>
            <thead><tr><th style={dt.th}>Component</th><th style={dt.thNum}>Old (₹)</th><th style={dt.thNum}>New (₹)</th></tr></thead>
            <tbody>
              <SecRow>{T.mid ? `INCOME (${T.months} months · pro-rated ${Math.round(T.pr * 100)}%)` : 'INCOME'}</SecRow>
              <BreakRow label="Basic Salary (100% taxable)" o={R(T.eBasic)} n={R(T.eBasic)} />
              <BreakRow label={'HRA Received (' + R(T.eHra) + ')'} o="" n="" />
              {T.hE > 0 && <BreakRow indent exempt label="HRA Exemption" o={`(${R(T.hE)})`} n="N/A" />}
              <BreakRow indent label="= Net Taxable HRA" o={R(T.eHra - T.hE)} n={R(T.eHra)} />
              <BreakRow label={'Flexi Wallet: Total ' + R(T.eOther)} o="" n="" />
              {(T.oClaim > 0 || T.nClaim > 0) && <BreakRow indent exempt label="Flexi Claimed (exempt on bills)" o={T.oClaim ? `(${R(T.oClaim)})` : '-'} n={T.nClaim ? `(${R(T.nClaim)})` : '-'} />}
              <BreakRow indent label="= Wallet Balance (taxable)" o={R(T.walBalO)} n={R(T.walBalN)} />
              {T.eVari > 0 && <BreakRow label="Variable Pay" o={R(T.eVari)} n={R(T.eVari)} />}
              {T.addI > 0 && <BreakRow label="Additional Income" o={R(T.addI)} n={R(T.addI)} />}
              {(T.oPerq > 0 || T.nPerq > 0) && <BreakRow label="Car+Driver Perquisite (₹10,000/mo)" o={T.oPerq ? `+${R(T.oPerq)}` : '-'} n={T.nPerq ? `+${R(T.nPerq)}` : '-'} />}
              <TotalRow label="Gross Taxable Income" o={R(T.grossO)} n={R(T.grossN)} bg={TK.sunken} col={TK.ink} />
              <SecRow>DEDUCTIONS</SecRow>
              <BreakRow exempt label="Standard Deduction" o="(₹50,000)" n="(₹75,000)" />
              {T.ltaAmt > 0 && <BreakRow exempt label="Leave Travel Allowance" o={`(${R(T.ltaAmt)})`} n="N/A" />}
              {T.c80 > 0 && <BreakRow exempt label="80C: EPF + Investments" o={`(${R(T.c80)})`} n="N/A" />}
              {T.medS > 0 && <BreakRow exempt label="80D Self + Family" o={`(${R(T.medS)})`} n="N/A" />}
              {T.medP > 0 && <BreakRow exempt label="80D Parents" o={`(${R(T.medP)})`} n="N/A" />}
              {T.hlI > 0 && <BreakRow exempt label="Home Loan Interest 24(b)" o={`(${R(T.hlI)})`} n="N/A" />}
              {T.dep80dd > 0 && <BreakRow exempt label="80DD: Dependent Disability" o={`(${R(T.dep80dd)})`} n="N/A" />}
              {T.dis80ddb > 0 && <BreakRow exempt label="80DDB: Disease Treatment" o={`(${R(T.dis80ddb)})`} n="N/A" />}
              {T.pmFund > 0 && <BreakRow exempt label="80G: PM Relief Fund" o={`(${R(T.pmFund)})`} n="N/A" />}
              {T.eduLoan > 0 && <BreakRow exempt label="80E: Education Loan" o={`(${R(T.eduLoan)})`} n="N/A" />}
              {T.npsS > 0 && <BreakRow exempt label="NPS Self 80CCD(1B)" o={`(${R(T.npsS)})`} n="N/A" />}
              {(T.eNpsO > 0 || T.eNpsN > 0) && <BreakRow exempt label="Employer NPS 80CCD(2)" o={T.eNpsO ? `(${R(T.eNpsO)})` : '-'} n={T.eNpsN ? `(${R(T.eNpsN)})` : '-'} />}
              <TotalRow label="Net Taxable Income" o={R(T.tO)} n={R(T.tN)} bg={TK.brandTint} col={TK.brandDeep} />
              <SecRow>TAX</SecRow>
              <BreakRow label="Tax on income (slab)" o={R(T.bO)} n={R(T.bN)} />
              <BreakRow exempt label="Rebate u/s 87A" o={T.tO <= 500000 ? `(${R(Math.min(T.bO, 12500))})` : '-'} n={T.tN <= 1200000 ? `(${R(T.bN)})` : '-'} />
              <BreakRow label="Add: 4% Health & Edu Cess" o={R(Math.round(T.fO / 1.04 * .04))} n={R(Math.round(T.fN / 1.04 * .04))} />
              <TotalRow label="TOTAL ANNUAL TAX" o={R(T.fO)} n={R(T.fN)} bg={TK.dark} col={TK.onDark} />
              <TotalRow label={`MONTHLY TDS (÷${T.months})`} o={R(T.moO)} n={R(T.moN)} bg={TK.brandTint} col={TK.brandDeep} />
            </tbody>
          </DataTable>
        </SectionCard>
        <InfoCallout t="neutral" title="Important Disclaimer">
          This is an <b>estimate</b> for comparison &amp; investment planning only. Actual TDS may vary with final proofs, payroll processing, mid-year changes or tax-law amendments. Please confirm with your HR / Finance team and file your full investment declaration on the HRMS portal for accurate TDS. Not tax or financial advice. FY 2026-27 (AY 2027-28).
        </InfoCallout>
        <PButton onClick={() => setStep(3)} icon={<span aria-hidden style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><IconArrowRight size={14} /></span>}>Back</PButton>
      </div>
    )
  })()

  const statusPill = sandbox
    ? <StatusPill t="info" size="sm" dot>Sandbox · nothing is saved</StatusPill>
    : editMode ? <StatusPill t="warning" size="sm" dot>Editing</StatusPill>
    : isSubmitted ? <StatusPill t="positive" size="sm" icon={<IconLock size={10} />}>Submitted &amp; locked</StatusPill>
    : status === 'DRAFT' ? <StatusPill t="info" size="sm" dot>Draft saved</StatusPill>
    : <StatusPill t="neutral" size="sm" dot>Not submitted yet</StatusPill>
  const backIcon = <span aria-hidden style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><IconArrowRight size={14} /></span>

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, flexWrap: 'wrap', marginBottom: S.lg }}>
        <IconTile icon={<IconFinance size={18} />} t="brand" size={40} />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: F.title, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.01em', lineHeight: 1.25 }}>{sandbox ? 'TDS Calculator' : <>Flexi &amp; TDS Calculator</>}</div>
          <div style={{ fontSize: F.small, color: TK.muted, marginTop: 3, lineHeight: 1.5 }}>{sandbox
            ? <>Work out flexi, deductions and Old vs New regime tax for any figures · FY 2026-27 · <b>nothing here is saved</b> and no one&apos;s declaration changes</>
            : 'Plan your flexi benefit declaration and compare Old vs New tax regime · FY 2026-27'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: S.sm }}>
            <StatusPill t="neutral" size="sm">FY 2026-27</StatusPill>
            {statusPill}
            {!sandbox && chosenRegime && <StatusPill t="brand" size="sm">{chosenRegime === 'OLD' ? 'Old' : 'New'} Regime{isSubmitted ? '' : ' selected'}</StatusPill>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          {sandbox && sal.ctc > 0 && step === 4 && (
            <PButton onClick={downloadDeclaration} icon={<IconDownload size={14} />}>Download Excel</PButton>
          )}
          {/* Save Draft from any step (pre-submit) — data is stored and returns pre-filled */}
          {!isSubmitted && !sandbox && (
            <PButton onClick={saveDraft} disabled={saving}>Save Draft</PButton>
          )}
        </div>
      </div>
      {draftMsg && <InfoCallout t={draftIsError ? 'critical' : 'positive'} compact>{draftMsg}</InfoCallout>}
      {defaultedByRule && !isSubmitted && (
        <InfoCallout t="warning" title="New Regime applied by default">
          No regime was chosen by the 4th of the month{/^\d{4}-/.test(defaultedByRule) ? ` (set on ${new Date(defaultedByRule).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Payroll is taxing you on the New Regime. You can still submit your own choice here; submitting replaces the default.
        </InfoCallout>
      )}
      {viewLocked && (
        <InfoCallout t="brand" icon={<IconLock size={16} />} title={`Submitted & locked · ${chosenRegime === 'OLD' ? 'Old' : 'New'} Regime`}
          action={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: F.tiny, color: TK.muted }}><IconLock size={12} /> Regime can&apos;t change after submit</span>}>
          This declaration is submitted &amp; locked. Go to <b>Step 4</b> and press <b>Edit</b> to change {chosenRegime === 'OLD' ? 'flexi or investments' : 'your flexi'}.
        </InfoCallout>
      )}
      <WizardStepper step={step} onGo={setStep} locked={[!basicRW, !flexiRW, !investRW, false]} />
      {step === 1 && <fieldset disabled={!basicRW} style={fsReset}>{step1}</fieldset>}
      {step === 2 && <fieldset disabled={!flexiRW} style={fsReset}>{step2}</fieldset>}
      {step === 3 && <fieldset disabled={!investRW} style={fsReset}>{step3}</fieldset>}
      {step === 4 && step4}
      {/* Step navigation — kept OUTSIDE the disabled fieldsets so a submitted (locked) employee can still page through and view all steps. */}
      {step === 1 && sal.ctc > 0 && <ActionBar><span style={{ flex: 1 }} /><PButton variant="primary" onClick={() => setStep(2)} iconRight={<IconArrowRight size={14} />}>Next: Flexi Declaration</PButton></ActionBar>}
      {step === 2 && <ActionBar><PButton onClick={() => setStep(1)} icon={backIcon}>Back</PButton><span style={{ flex: 1 }} /><PButton variant="primary" onClick={() => setStep(3)} iconRight={<IconArrowRight size={14} />}>Next: Investments</PButton></ActionBar>}
      {step === 3 && <ActionBar><PButton onClick={() => setStep(2)} icon={backIcon}>Back</PButton><span style={{ flex: 1 }} /><PButton variant="primary" onClick={() => setStep(4)} iconRight={<IconArrowRight size={14} />}>Calculate TDS</PButton></ActionBar>}
    </div>
  )
}
