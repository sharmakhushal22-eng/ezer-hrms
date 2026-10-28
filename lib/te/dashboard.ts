// lib/te/dashboard.ts — the words and the arithmetic of the Reports and
// Dashboard tab. No fetching, no React: te_dashboard has already decided what
// this person may see, and this file only decides how to say it.
//
// WHY THE SCORECARD IS FIVE TILES AND NOT ONE NUMBER. "You approved 12 things"
// is not a useful sentence on its own. What makes it useful is the four other
// numbers beside it: how many came to you at all, how many you turned down or
// sent back, and how many are still sitting with you right now. The last one
// is the only one that is work; the rest are a record.
//
// WAITING IS NOT IN THE WINDOW, and that is deliberate. A date filter answers
// "what did I do in April". "What is still on my desk" has no date — it is
// true now — so `waiting` is counted over everything, not over the window.
// te_dashboard counts it that way; this file labels it that way.
import type { TeDashboard, TeDashboardMineClaim, TeTeamClaim } from './types.ts'
import type { Tone } from './format.ts'

/** What a decision on one approval step is called, and how it should look. */
export function decisionOf(status: string): { label: string; tone: Tone } {
  if (status === 'approved') return { label: 'Approved', tone: 't-pos' }
  // An automatic step is a decision the rules made, not one this person made.
  // te_dashboard counts it in nothing — acted_by is null on such a row — so
  // this label only ever appears where a step list shows the whole chain.
  // It is never dressed up as somebody's judgement.
  if (status === 'auto') return { label: 'Approved automatically', tone: 't-info' }
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'plain' }
  if (status === 'rejected') return { label: 'Rejected', tone: 't-crit' }
  if (status === 'sent_back') return { label: 'Sent back', tone: 't-warn' }
  if (status === 'pending') return { label: 'Waiting on you', tone: 't-brand' }
  return { label: status, tone: 'plain' }
}

/** The five scorecard tiles, in the order they are read. */
export function scoreTiles(s: TeDashboard['score']): { k: string; l: string; v: number; sub: string }[] {
  const decided = s.approved + s.rejected + s.sentBack
  return [
    { k: 'came', l: 'Came to you', v: s.cameToMe, sub: decided ? `${decided} decided` : 'nothing decided yet' },
    { k: 'approved', l: 'Approved', v: s.approved, sub: pctOf(s.approved, decided) },
    { k: 'rejected', l: 'Rejected', v: s.rejected, sub: pctOf(s.rejected, decided) },
    { k: 'sentback', l: 'Sent back', v: s.sentBack, sub: 'returned for a fix' },
    // No date on this one. See the header.
    { k: 'waiting', l: 'Still with you', v: s.waiting, sub: s.waiting ? 'right now, any month' : 'your desk is clear' },
  ]
}

/** "4 of 11" rather than a bare percentage: eleven decisions is a small enough
 *  number that a percentage of it is false precision. */
function pctOf(n: number, total: number): string {
  if (!total) return 'none yet'
  if (!n) return `none of ${total}`
  return `${n} of ${total}`
}

/** Who a request is sitting with, said in full. */
export function holder(withWhom: string | null | undefined): string {
  return withWhom ? `with ${withWhom}` : 'with nobody — no step is open'
}

/** The date window, as a human would say it. `isMonth` is true when the window
 *  is exactly one calendar month, which is the default and needs no dates. */
export function rangeLabel(from: string, to: string): { text: string; isMonth: boolean } {
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return { text: 'All dates', isMonth: false }
  const monthStart = a.getUTCDate() === 1
  const monthEnd = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate() === b.getUTCDate()
  const sameMonth = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
  if (monthStart && monthEnd && sameMonth) {
    return { text: `${MONTH[a.getUTCMonth()]} ${a.getUTCFullYear()}`, isMonth: true }
  }
  return { text: `${d(a)} – ${d(b)}`, isMonth: false }
}

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const d = (x: Date) => `${x.getUTCDate()} ${SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`

function parse(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(t) ? null : new Date(t)
}

/** The whole calendar month that a date falls in. Used by the month stepper,
 *  which is the only control most people will ever touch on the filter. */
export function monthAround(iso: string, delta = 0): { from: string; to: string } | null {
  const a = parse(iso)
  if (!a) return null
  const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { from: iso10(start), to: iso10(end) }
}

const iso10 = (x: Date) => x.toISOString().slice(0, 10)

/** The sentence over the team block. Says what it is AND what it is not,
 *  because a manager seeing a colleague's claim should know at a glance that
 *  it is tracking rather than a second approval queue. */
export function teamNote(team: TeDashboard['team']): string {
  if (!team.people) return ''
  const who = team.people === 1 ? '1 person reports' : `${team.people} people report`
  const n = team.trips.length + team.claims.length
  if (!n) return `${who} to you. Nothing of theirs falls in this window.`
  return `${who} to you. Read only — what they asked for and how far it got, never what they were paid.`
}

/** True when there is genuinely nothing to draw, so the screen can say so once
 *  instead of stacking four empty cards. */
export function dashboardEmpty(data: TeDashboard): boolean {
  return !data.mine.trips.length && !data.mine.claims.length
    && !data.acted.length && !data.score.cameToMe && !data.score.waiting
    && !data.team.trips.length && !data.team.claims.length
}

/** What a claim is worth to show: the approved figure once there is one, the
 *  claimed figure until then — and the label says which, so nobody reads a
 *  pending number as a settled one. */
export function claimAmount(c: TeDashboardMineClaim | TeTeamClaim): { amount: number; label: string } {
  if (c.approved !== null && c.approved !== undefined) return { amount: c.approved, label: 'approved' }
  return { amount: c.claimed, label: 'claimed' }
}
