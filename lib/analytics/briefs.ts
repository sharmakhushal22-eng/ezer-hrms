// lib/analytics/briefs.ts — the four written pieces of People Analytics, and how each is
// written WITHOUT a model.
//
//   Briefing      the month on one page for leadership: what changed, likely causes,
//                 three things to do (owner and timing)
//   Explanation   "Why?" on a figure: what moved it, in which group
//   MondayNote    a manager's week: the headline, one priority, an opener per person
//                 showing warning signs
//   MySummary     an employee's month in three plain lines and one nudge
//
// Every one of them is complete from the figures alone (the templates below). When AI is
// on, lib/analytics/ai/tasks.ts asks a model to write the same thing better — joining
// causes up, choosing the actions, warmer wording — and keeps only what passes the
// number check. If AI is off, busy or wrong, the reader still gets this.

import type { Area, Insight, Mover, MoverRow, MoverSet, MoverWindow, OrgAnalytics, TeamAnalytics, MyAnalytics, RiskRow } from './types.ts'
import { fmt, inr, dLabelLong, clockOf } from './format.ts'
import { addDays } from './period.ts'
import { moveIsGood, moveSize } from './movers.ts'

export type Source = 'ai' | 'rules'
interface Written { source: Source; model: string | null; generatedAt: string; dropped: number }

export interface BriefChange { title: string; detail: string; area: Area; dir: 'up' | 'down' | 'flat'; good: boolean | null; topic: string | null; evidence: string[] }
export interface BriefCause { text: string; area: Area; evidence: string[] }
export interface BriefAction { action: string; owner: string; when: string; why: string; area: Area; evidence: string[] }
export interface Briefing extends Written { window: MoverWindow; headline: string; changes: BriefChange[]; causes: BriefCause[]; actions: BriefAction[] }

export interface Reason { text: string; evidence: string[] }
export interface Explanation extends Written { topic: string; question: string; window: MoverWindow | null; movers: Mover[]; summary: string; reasons: Reason[]; checks: string[] }

export interface Opener { id: string; name: string; signals: string[]; opener: string }
export interface MondayNote extends Written { weekOf: string; greeting: string; summary: string; focus: string; openers: Opener[] }

export interface SummaryLine { area: string; text: string }
export interface MySummary extends Written { lines: SummaryLine[]; nudge: SummaryLine | null }

const now = () => new Date().toISOString()
const rules = (): Written => ({ source: 'rules', model: null, generatedAt: now(), dropped: 0 })

// ── Words for a change ──────────────────────────────────────────────────────

/** "4.2 points", "12", "₹3.1 L", "8.5 days" — the size of a change, unsigned. */
export function sizeOf(m: Pick<Mover, 'fmt' | 'delta'>): string {
  const d = Math.abs(m.delta ?? 0)
  if (m.fmt === 'pct') return `${d.toFixed(1)} points`
  if (m.fmt === 'money') return inr(d)
  if (m.fmt === 'days') return `${fmt(d, 'days')} days`
  return fmt(d, 'count')
}

const val = (v: number | null, f: Mover['fmt']) => (f === 'days' ? `${fmt(v, 'days')} days` : f === 'pct' && v != null ? `${v.toFixed(1)}%` : fmt(v, f))
const verb = (m: Mover) => ((m.delta ?? 0) > 0 ? (m.fmt === 'count' || m.fmt === 'days' || m.fmt === 'money' ? 'rose' : 'rose') : 'fell')

/** "On-time punch-ins fell from 86.4% to 82.2% (down 4.2 points)". */
export function changeSentence(m: Mover): string {
  if (m.now == null || m.before == null) return `${m.label}: ${val(m.now, m.fmt)} — no comparison for the earlier window`
  if (!m.delta) return `${m.label} held at ${val(m.now, m.fmt)}`
  return `${m.label} ${verb(m)} from ${val(m.before, m.fmt)} to ${val(m.now, m.fmt)} (${(m.delta ?? 0) > 0 ? 'up' : 'down'} ${sizeOf(m)})`
}

/** "Why did on-time punch-ins fall 4.2 points?" */
export function questionFor(m: Mover): string {
  if (!m.delta) return `What is behind ${m.label.toLowerCase()} this month?`
  return `Why did ${m.label.toLowerCase()} ${(m.delta ?? 0) > 0 ? 'rise' : 'fall'} ${m.fmt === 'pct' ? sizeOf(m) : `by ${sizeOf(m)}`}?`
}

/** The noun for a breakdown, in a sentence: "by department", "by leave type". */
export const DIM_WORD: Record<string, string> = { department: 'department', location: 'location', weekday: 'weekday', type: 'leave type', reason: 'reason given', source: 'source', kind: 'kind of exit' }

const rowWords = (r: MoverRow, f: Mover['fmt']) =>
  r.now != null && r.before != null ? `${r.label} (${val(r.before, f)} → ${val(r.now, f)})` : `${r.label} (${val(r.now, f)})`

/** The groups that pushed the figure the way it went, largest first. */
export function drivers(m: Mover, max = 3): { dim: string; fmt: Mover['fmt']; rows: MoverRow[] }[] {
  const sign = Math.sign(m.delta ?? 0)
  if (!sign) return []
  // A share that moved because of days: the days moved the other way for the share to fall.
  const want = (b: Mover['by'][number]) => (b.fmt && b.fmt !== m.fmt ? null : sign)
  return m.by.map(b => ({ dim: DIM_WORD[b.dim] || b.dim, fmt: b.fmt || m.fmt, rows: b.rows.filter(r => r.effect != null && r.effect !== 0 && (want(b) == null || Math.sign(r.effect) === want(b))).slice(0, max) }))
    .filter(b => b.rows.length > 0)
}

/** The plain explanation of one mover — what the "Why?" panel says without a model. */
export function explainMover(m: Mover, w: MoverWindow): { summary: string; reasons: string[] } {
  const reasons: string[] = []
  for (const d of drivers(m)) {
    const total = Math.abs(m.delta ?? 0)
    const share = d.rows.reduce((s, r) => s + Math.abs(r.effect ?? 0), 0)
    const most = total && m.fmt !== 'pct' && share / total >= 0.6 ? 'Most of the change' : 'The largest part'
    reasons.push(d.fmt !== m.fmt
      ? `By ${d.dim}, the days that moved most: ${d.rows.map(r => rowWords(r, d.fmt)).join(', ')}.`
      : `By ${d.dim}: ${most} came from ${d.rows.map(r => rowWords(r, d.fmt)).join(', ')}.`)
  }
  for (const n of m.notes) if (/tracked|paid/.test(n)) reasons.push(`For scale: ${n}.`)
  const summary = `${changeSentence(m)}, ${w.label}.${reasons.length ? '' : ' No single group stands out — the change is spread across the organisation.'}`
  return { summary, reasons: reasons.slice(0, 4) }
}

// ── Executive briefing ──────────────────────────────────────────────────────

/** A change worth a line in a briefing: a point or more on a rate, a fifth or more on a
 *  count with at least two behind it. */
export function notable(m: Mover): boolean {
  if (m.delta == null || !m.delta) return false
  if (m.fmt === 'pct') return Math.abs(m.delta) >= 1
  return Math.abs(m.delta) >= 2 && moveSize(m) >= 0.2
}

const ACTION: Record<string, { action: string; owner: string; when: string }> = {
  attendance: { action: 'Review late marks and missing punches with the department heads where punctuality slipped', owner: 'HR business partner', when: 'This week' },
  leave: { action: 'Ask managers to clear leave requests that have waited more than three days', owner: 'Line managers', when: 'This week' },
  attrition: { action: 'Hold stay conversations with the people on the flight-risk list', owner: 'HR with line managers', when: 'This month' },
  workforce: { action: 'Close overdue probation decisions and fill missing reporting managers', owner: 'HR operations', when: 'This month' },
  performance: { action: 'Chase managers whose review ratings are still pending', owner: 'HR with line managers', when: 'Before the cycle closes' },
  learning: { action: 'Send reminders for overdue mandatory courses', owner: 'Learning & development', when: 'This week' },
  hiring: { action: 'Review the oldest open requisitions with hiring managers', owner: 'Talent acquisition', when: 'This week' },
  cost: { action: 'Walk through the payroll cost change with Finance', owner: 'Payroll with Finance', when: 'Before next payroll' },
}
const SEV = { critical: 0, warning: 1, info: 2, positive: 3 } as const

export function briefingFallback(d: OrgAnalytics, set: MoverSet): Briefing {
  // Bad news first (a leader acts on it), then neutral, then good — biggest first within each.
  const rank = (m: Mover) => { const g = moveIsGood(m); return g === false ? 0 : g === null ? 1 : 2 }
  const moved = set.items.filter(notable).sort((a, b) => rank(a) - rank(b) || moveSize(b) - moveSize(a)).slice(0, 4)
  const changes: BriefChange[] = moved.map(m => ({
    title: `${m.label} ${(m.delta ?? 0) > 0 ? 'up' : 'down'} ${sizeOf(m)}`,
    detail: `${val(m.now, m.fmt)} against ${val(m.before, m.fmt)}${m.notes[0] ? `; ${m.notes[0]}` : ''}.`,
    area: m.area, dir: (m.delta ?? 0) > 0 ? 'up' : 'down', good: moveIsGood(m), topic: `m:${m.key}`, evidence: [changeSentence(m)],
  }))
  const causes: BriefCause[] = []
  for (const m of moved) {
    const d = drivers(m, 2)[0]
    if (d) causes.push({ text: d.fmt !== m.fmt
      ? `${m.label}: by ${d.dim}, the days that moved most were ${d.rows.map(r => rowWords(r, d.fmt)).join(' and ')}.`
      : `${m.label}: by ${d.dim}, the largest part of the change came from ${d.rows.map(r => rowWords(r, d.fmt)).join(' and ')}.`, area: m.area, evidence: [changeSentence(m)] })
    if (causes.length >= 3) break
  }
  const urgent = [...d.pulse.insights].filter(i => i.severity === 'critical' || i.severity === 'warning').sort((a, b) => SEV[a.severity] - SEV[b.severity])
  const actions: BriefAction[] = []
  const used = new Set<string>()
  for (const i of [...urgent, ...d.pulse.insights]) {
    const t = ACTION[i.area]
    if (!t || used.has(i.area)) continue
    used.add(i.area)
    actions.push({ ...t, why: i.title, area: i.area, evidence: [`${i.title}. ${i.detail}`] })
    if (actions.length >= 3) break
  }
  const head = changes[0]
  const headline = head
    ? `${set.window.month}: ${head.title.charAt(0).toLowerCase() + head.title.slice(1)}${changes[1] ? `, and ${changes[1].title.charAt(0).toLowerCase() + changes[1].title.slice(1)}` : ''}.`
    : `${set.window.month}: no headline figure moved much — ${urgent.length} item${urgent.length === 1 ? '' : 's'} still need attention.`
  return { ...rules(), window: set.window, headline: headline.replace(/^(\w)/, c => c.toUpperCase()), changes, causes, actions }
}

// ── Manager's Monday note ───────────────────────────────────────────────────

/** A respectful way to start the conversation, by the strongest sign. Never names the
 *  sign as an accusation; always an open question. */
export const OPENER: Record<string, string> = {
  MANAGER_LEAVING: 'With the changes in the team coming up, how are you feeling about what is next for you here?',
  TEAM_EXITS: 'A few people have moved on recently — how is that landing for you, and is the workload still fair?',
  LOW_RATING: 'I would like to understand what support would help you most this quarter — what is getting in the way?',
  RATING_DROP: 'Your last review was tougher than before. What changed for you, and what would help you get back on track?',
  LATE_SPIKE: 'Mornings seem to have been harder lately. Is something getting in the way that we could sort out together?',
  UNPLANNED_LEAVE: 'You have needed a few short-notice days recently — is everything all right, and is there anything I can help with?',
  BRIDGING: 'How are you finding the balance between work and time off? Would planning a proper break help?',
  NO_REVISION: 'I would like to talk about your growth here — where do you see yourself in the next year, and what would make that happen?',
  PROBATION_OVERDUE: 'Your probation review is due. Let us sit down this week and talk about how the first months have gone for you.',
  TENURE_WINDOW: 'You have been with us a while now — what keeps you here, and what would make the next year better?',
}
const OPENER_DEFAULT = 'How are things going for you at the moment — is there anything I could be doing differently?'

export function openerFor(r: Pick<RiskRow, 'signals'>): string {
  const top = [...r.signals].sort((a, b) => b.weight - a.weight)[0]
  return (top && OPENER[top.code]) || OPENER_DEFAULT
}

/** The Monday of the week `day` is in. */
export function mondayOf(day: string): string {
  const wd = new Date(day + 'T00:00:00Z').getUTCDay()
  return addDays(day, -((wd + 6) % 7))
}

/** "1 person", "3 people", "1 punch-in" — the unit a count is of. */
export function unitOf(n: number, unit: string): string {
  if (n !== 1) return unit
  return ({ people: 'person', 'punch-ins': 'punch-in', spells: 'spell', days: 'day' } as Record<string, string>)[unit] || unit
}

export function mondayFallback(d: TeamAnalytics, today: string): MondayNote {
  const first = (d.manager.name || '').split(' ')[0] || 'there'
  const waiting = d.approvals.leave + d.approvals.regularisation + d.performance.awaitingYou
  const summary = [
    d.today.off ? 'Today is a day off for the team' : `${d.today.present} of ${d.members.length} are in today${d.today.onLeave ? `, ${d.today.onLeave} on leave` : ''}`,
    d.health.score != null ? `team health ${d.health.score} out of 100` : '',
    waiting ? `${waiting} request${waiting === 1 ? '' : 's'} waiting on you${d.approvals.oldestDays != null ? ` (oldest ${d.approvals.oldestDays} days)` : ''}` : 'nothing waiting on you',
  ].filter(Boolean).join('; ') + '.'
  const tired = d.members.filter(m => !m.lastLeave)
  const focus = d.approvals.oldestDays != null && d.approvals.oldestDays > 3
    ? `Clear the ${waiting} request${waiting === 1 ? '' : 's'} waiting on you first — the oldest has waited ${d.approvals.oldestDays} days.`
    : d.signals.length ? `Make time this week for a one-to-one with ${d.signals[0].name}.`
      : tired.length ? `Nudge ${tired[0].name} to plan a break — no leave in the last year.`
        : 'No fires this week — a good time for one-to-ones.'
  return {
    ...rules(), weekOf: dLabelLong(mondayOf(today)), greeting: `Hi ${first}, here is your team this week.`, summary, focus,
    openers: d.signals.slice(0, 6).map(r => ({ id: r.id, name: r.name, signals: r.signals.map(s => s.label), opener: openerFor(r) })),
  }
}

// ── An employee's month ─────────────────────────────────────────────────────

export function summaryFallback(d: MyAnalytics): MySummary {
  const a = d.attendance, tm = a.thisMonth, t = a.team
  const lines: SummaryLine[] = []
  const vsTeam = tm.onTimeRate != null && t?.onTimeRate != null
    ? (tm.onTimeRate - t.onTimeRate >= 2 ? ', ahead of your team' : t.onTimeRate - tm.onTimeRate >= 2 ? ', a little behind your team' : ', in line with your team')
    : ''
  lines.push({ area: 'attendance', text: tm.workdays ? `You have been in ${tm.present} of ${tm.workdays} working days this month, on time ${fmt(tm.onTimeRate, 'pct')} of mornings${vsTeam}${tm.avgIn != null ? `, usually by ${clockOf(tm.avgIn)}` : ''}.` : 'No working days recorded this month yet.' })
  const el = d.leave.balances.find(b => /earned|privilege/i.test(b.label)) || d.leave.balances[0]
  const lapse = d.leave.balances.find(b => b.lapse)
  lines.push({ area: 'leave', text: lapse ? `${fmt(lapse.lapse, 'days')} ${lapse.label} days are above the carry-forward limit and will lapse on 31 March unless you plan them.`
    : el ? `You have ${fmt(el.available, 'days')} days of ${el.label} available${d.leave.lastLeave ? `; your last day off was ${dLabelLong(d.leave.lastLeave)}` : ' and have not taken a day off in the last year'}.`
      : `${fmt(d.leave.takenThisFy, 'days')} days of leave taken this financial year.` })
  const cur = d.performance.current
  lines.push({ area: cur ? 'performance' : 'learning', text: cur ? `Your ${cur.name} review is at "${cur.stage}" with ${cur.goals} goal${cur.goals === 1 ? '' : 's'} set.`
    : d.learning.enrolled ? `Learning: ${d.learning.completed} of ${d.learning.enrolled} courses done${d.learning.overdue ? `, ${d.learning.overdue} overdue` : ''}.`
      : d.recognition.kudos ? `You have received ${d.recognition.kudos} kudos.` : 'No review cycle is running for you right now.' })
  const n: Insight | undefined = [...d.nudges].sort((x, y) => SEV[x.severity] - SEV[y.severity])[0]
  return { ...rules(), lines, nudge: n ? { area: n.area, text: `${n.title}. ${n.detail}` } : null }
}
