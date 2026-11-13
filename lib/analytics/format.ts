// lib/analytics/format.ts — one way to print every kind of figure.

import type { Fmt } from './types.ts'

const IN = 'en-IN'

/** ₹ in the Indian way: lakh and crore past a lakh, so a payroll total reads at a glance. */
export function inr(n: number, compact = true): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : ''
  if (compact && a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)} Cr`
  if (compact && a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`
  return `${sign}₹${Math.round(a).toLocaleString(IN)}`
}

export function clockOf(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return '—'
  const h = Math.floor(mins / 60) % 24, m = Math.round(mins % 60)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function fmt(v: number | null | undefined, f: Fmt, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—'
  switch (f) {
    case 'count': return Math.round(v).toLocaleString(IN)
    case 'pct': return `${Math.abs(v) >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}%`
    case 'money': return inr(v, opts.compact !== false)
    case 'days': return v < 1 && v > 0 ? v.toFixed(v < 0.1 ? 2 : 1) : (Number.isInteger(v) ? String(v) : v.toFixed(1))
    case 'hours': return `${v.toFixed(1)} h`
    case 'clock': return clockOf(v)
    case 'score': return String(Math.round(v))
    case 'ratio': return v.toFixed(2)
  }
}

/** The delta between two figures, in the unit a reader expects: points for a rate,
 *  percent for a count or an amount. */
export function delta(now: number | null | undefined, before: number | null | undefined, f: Fmt): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return null
  const d = now - before
  if (Math.abs(d) < 1e-9) return { text: 'no change', dir: 'flat' }
  const dir = d > 0 ? 'up' : 'down'
  if (f === 'pct') return { text: `${Math.abs(d) >= 10 ? Math.round(Math.abs(d)) : Math.abs(d).toFixed(1)} pts`, dir }
  if (before === 0) return { text: f === 'money' ? inr(Math.abs(d)) : `${fmt(Math.abs(d), f)}`, dir }
  const rel = (d / Math.abs(before)) * 100
  return { text: `${Math.abs(rel) >= 10 ? Math.round(Math.abs(rel)) : Math.abs(rel).toFixed(1)}%`, dir }
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const mLabel = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
export const dLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`
export const dLabelLong = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
