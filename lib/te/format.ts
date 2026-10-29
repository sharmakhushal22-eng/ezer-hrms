// lib/te/format.ts — how amounts, dates and statuses are worded.
// Pure (no React, no imports that run), so it can be unit-tested and reused by
// every screen that is ported from the prototype. The wording follows the
// prototype: design/prototype, functions rs / fd / claim chips.
import type { TeClaim, TeFlag, TeClaimFlag, TeStep } from './types.ts'

/** ₹1,58,840 — Indian digit grouping, no paise. */
export function rs(amount: number | string | null | undefined): string {
  const n = Math.round(Number(amount) || 0)
  return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-11-16' -> '16 Nov'. Read as a calendar date, never shifted by a time zone. */
export function day(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ''
}

/** A timestamp in India time: '16 Nov, 09:47'. */
export function when(iso: string | null | undefined): string {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  const d = new Date(t + 5.5 * 3600_000)                 // IST has no daylight saving
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm}`
}

/** '1 leg', '6 legs'. The prototype's `pl`: a plain -s, which is all the words
 *  this module counts ever need (leg, trip, bill, stop, day, claim). */
/** A date and, when it was recorded, the time with it. Migration 165 keeps
 *  "not recorded" and midnight apart, so '' must never print as 00:00. */
export function dayAt(iso: string | null | undefined, hhmm?: string | null): string {
  const d = day(iso)
  if (!d) return ''
  const t = (hhmm ?? '').trim()
  return /^\d{2}:\d{2}$/.test(t) ? `${d}, ${t}` : d
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export type Tone = 't-pos' | 't-warn' | 't-crit' | 't-info' | 't-brand' | 'plain'

/** The chip on a claim: what state it is in, in the employee's words. */
export function claimChip(c: Pick<TeClaim, 'status' | 'stage'>): { label: string; tone: Tone } {
  switch (c.status) {
    case 'IN_APPROVAL': return { label: 'With manager', tone: 't-warn' }
    case 'IN_VERIFICATION': return { label: 'With Finance', tone: 't-warn' }
    case 'ON_HOLD': return { label: 'On hold with Finance', tone: 't-warn' }
    case 'SENT_BACK': return { label: 'Needs your answer', tone: 't-crit' }
    case 'VERIFIED': return { label: 'Approved, awaiting payout', tone: 't-info' }
    case 'SETTLED': return { label: 'Settled', tone: 't-pos' }
    case 'REJECTED': return { label: 'Rejected', tone: 't-crit' }
    case 'CANCELLED': return { label: 'Taken back', tone: 'plain' }
    default: return { label: String(c.status).replace(/_/g, ' ').toLowerCase(), tone: 'plain' }
  }
}

/** The step whose turn it is, across the approval levels and the finance levels. */
export function currentStep(c: Pick<TeClaim, 'chain' | 'fin'>): TeStep | null {
  return [...c.chain, ...c.fin].find(s => s.status === 'pending') ?? null
}

/** The small line under a claim in a list: who holds it, or when it ended. */
export function claimHolder(c: Pick<TeClaim, 'status' | 'chain' | 'fin' | 'settledAt' | 'verifiedAt'>): string {
  if (c.status === 'SETTLED') return `Settled ${when(c.settledAt)}`
  if (c.status === 'VERIFIED') return `Verified ${when(c.verifiedAt)}. Paid in the next payout.`
  if (c.status === 'SENT_BACK') return 'Sent back to you'
  if (c.status === 'REJECTED' || c.status === 'CANCELLED') return ''
  const s = currentStep(c)
  return s ? `With ${s.whoName || s.role}` : ''
}

/** How a flag is drawn: a blocking one in red, the rest in amber. */
export function flagClass(f: Pick<TeFlag | TeClaimFlag, 'block'>): 'flag crit' | 'flag warn' {
  return f.block ? 'flag crit' : 'flag warn'
}

/** What to show when a call fails: the server's sentence when there is one. */
export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.'
}

/** Today in India, 'YYYY-MM-DD', for the date field's default before the snapshot arrives. */
export function todayIst(nowMs: number): string {
  return new Date(nowMs + 5.5 * 3600_000).toISOString().slice(0, 10)
}
