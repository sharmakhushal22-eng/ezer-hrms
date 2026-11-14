// lib/analytics/topics.ts — what "Why?" on a figure is asking, and its answer without AI.
//
// A topic is a short key the page sends:
//   m:<mover>     a month-on-month measure (m:ontime)
//   k:<kpi>       a Pulse headline tile (k:attrition)
//   c:<chart>     a chart, by its id below (c:att-heat)
//   i:<finding>   a rule finding, by its id (i:late-monday)
// Each resolves to the question in words, the area, and the movers (lib/analytics/
// movers.ts) that can answer it. The template answer is explainMover's; the AI answer
// is lib/analytics/ai/tasks.ts explainTask's.

import type { Area, Mover, MoverSet, OrgAnalytics } from './types.ts'
import type { Explanation } from './briefs.ts'
import { explainMover, questionFor } from './briefs.ts'
import { moveSize } from './movers.ts'

const KPI_MOVERS: Record<string, string[]> = {
  headcount: ['headcount', 'joiners', 'exits'], joiners: ['joiners'], exits: ['exits'], attrition: ['exits', 'joiners'],
  ontime: ['ontime', 'misspunch'], leave: ['leave', 'unplanned'], open: ['applicants', 'offers'], cost: ['cost'], pms: [],
}
const KPI_AREA: Record<string, Area> = { headcount: 'workforce', joiners: 'attrition', exits: 'attrition', attrition: 'attrition', ontime: 'attendance', leave: 'leave', open: 'hiring', cost: 'cost', pms: 'performance' }

const AREA_MOVERS: Record<Area, string[]> = {
  attendance: ['ontime', 'misspunch'], leave: ['leave', 'unplanned'], attrition: ['exits', 'joiners'], workforce: ['headcount'],
  hiring: ['applicants', 'offers'], cost: ['cost'], performance: [], learning: [],
}

/** Every chart on People Analytics that carries a "Why?" — its area and the measures behind it. */
export const CHARTS: Record<string, { title: string; area: Area | null; movers: string[] }> = {
  'pulse-changes': { title: 'This month against last month', area: null, movers: ['headcount', 'joiners', 'exits', 'ontime', 'leave', 'applicants'] },
  'pulse-headcount': { title: 'Headcount, last 12 months', area: 'workforce', movers: ['headcount', 'joiners', 'exits'] },
  'pulse-flow': { title: 'Joiners and exits', area: 'attrition', movers: ['joiners', 'exits'] },
  'wf-dept': { title: 'Headcount by department', area: 'workforce', movers: ['headcount'] },
  'wf-location': { title: 'Headcount by location', area: 'workforce', movers: ['headcount'] },
  'wf-gender': { title: 'Gender', area: 'workforce', movers: [] },
  'wf-type': { title: 'Employment type and company', area: 'workforce', movers: [] },
  'wf-tenure': { title: 'Tenure', area: 'workforce', movers: [] },
  'wf-age': { title: 'Age', area: 'workforce', movers: [] },
  'wf-span': { title: 'Span of control', area: 'workforce', movers: [] },
  'wf-probation': { title: 'Probation past its end date', area: 'workforce', movers: [] },
  'at-rate': { title: 'Monthly attrition rate', area: 'attrition', movers: ['exits', 'joiners'] },
  'at-bridge': { title: 'Headcount bridge', area: 'attrition', movers: ['joiners', 'exits'] },
  'at-reasons': { title: 'Why people left', area: 'attrition', movers: ['exits'] },
  'at-tenure': { title: 'Tenure when they left', area: 'attrition', movers: ['exits'] },
  'at-dept': { title: 'Attrition by department', area: 'attrition', movers: ['exits'] },
  'at-risk': { title: 'Flight-risk watchlist', area: 'attrition', movers: [] },
  'att-monthly': { title: 'Punctuality by month', area: 'attendance', movers: ['ontime'] },
  'att-weekday': { title: 'Late marks by weekday', area: 'attendance', movers: ['ontime'] },
  'att-heat': { title: 'Where and when people are late', area: 'attendance', movers: ['ontime'] },
  'att-dept': { title: 'Attendance by department', area: 'attendance', movers: ['ontime', 'misspunch'] },
  'att-late': { title: 'Most late marks', area: 'attendance', movers: ['ontime'] },
  'lv-monthly': { title: 'Planned and unplanned leave by month', area: 'leave', movers: ['leave', 'unplanned'] },
  'lv-type': { title: 'Leave by type', area: 'leave', movers: ['leave'] },
  'lv-balances': { title: 'Leave balances on the books', area: 'leave', movers: [] },
  'lv-bradford': { title: 'Short-absence pattern', area: 'leave', movers: ['unplanned'] },
  'lv-rest': { title: 'Longest without a break', area: 'leave', movers: [] },
  'pf-stage': { title: 'Where the review cycle stands', area: 'performance', movers: [] },
  'pf-dist': { title: 'Rating distribution', area: 'performance', movers: [] },
  'pf-dept': { title: 'Ratings by department', area: 'performance', movers: [] },
  'pf-skew': { title: 'How managers rate', area: 'performance', movers: [] },
  'ln-status': { title: 'Status of every enrolment', area: 'learning', movers: [] },
  'ln-dept': { title: 'Learning by department', area: 'learning', movers: [] },
  'hr-funnel': { title: 'Hiring funnel', area: 'hiring', movers: ['applicants', 'offers'] },
  'hr-sources': { title: 'Which sources work', area: 'hiring', movers: ['applicants', 'offers'] },
  'hr-applicants': { title: 'Applicants per month', area: 'hiring', movers: ['applicants'] },
  'hr-mrfage': { title: 'How long requisitions stay open', area: 'hiring', movers: [] },
  'hr-oldest': { title: 'Oldest open requisitions', area: 'hiring', movers: [] },
  'cs-trend': { title: 'Payroll cost by month', area: 'cost', movers: ['cost'] },
  'cs-dept': { title: 'Gross pay by department', area: 'cost', movers: ['cost'] },
  'cs-ctc': { title: 'Annual CTC', area: 'cost', movers: [] },
}

export interface Resolved { topic: string; title: string; question: string; area: Area | null; movers: Mover[] }

/** The topic in words and the movers behind it, or null for a key that is not ours. */
export function resolveTopic(topic: string, d: OrgAnalytics, set: MoverSet): Resolved | null {
  const [kind, key] = [topic.slice(0, 1), topic.slice(2)]
  const pick = (keys: string[]) => keys.map(k => set.items.find(m => m.key === k)).filter((m): m is Mover => !!m)
  // A tile or a chart asks about its own measure first (the order listed), and only
  // falls back to the neighbour that moved when its own did not. A finding has no
  // measure of its own, so the one that moved most leads.
  const lead = (ms: Mover[]) => [...ms].sort((a, b) => moveSize(b) - moveSize(a))
  const own = (ms: Mover[]) => (ms[0]?.delta ? ms : lead(ms))
  if (kind === 'm') {
    const m = set.items.find(x => x.key === key)
    return m ? { topic, title: m.label, question: questionFor(m), area: m.area, movers: [m] } : null
  }
  if (kind === 'k' && key in KPI_MOVERS) {
    const ms = own(pick(KPI_MOVERS[key]))
    const kpi = d.pulse.kpis.find(k => k.key === key)
    return { topic, title: kpi?.label || key, question: ms[0]?.delta ? questionFor(ms[0]) : `What is behind ${String(kpi?.label || key).toLowerCase()}?`, area: KPI_AREA[key], movers: ms }
  }
  if (kind === 'c' && CHARTS[key]) {
    const c = CHARTS[key]
    const ms = own(pick(c.movers))
    return { topic, title: c.title, question: ms[0]?.delta ? `${c.title}: ${questionFor(ms[0]).charAt(0).toLowerCase()}${questionFor(ms[0]).slice(1)}` : `What stands out in "${c.title}", and why?`, area: c.area, movers: ms }
  }
  if (kind === 'i') {
    const i = d.pulse.insights.find(x => x.id === key)
    if (!i) return null
    return { topic, title: i.title, question: `Why: ${i.title.replace(/\.$/, '')}?`, area: i.area, movers: lead(pick(AREA_MOVERS[i.area] || [])) }
  }
  return null
}

/** The "Why?" answer from the figures alone. */
export function explainFallback(r: Resolved, set: MoverSet, d: OrgAnalytics): Explanation {
  const moved = r.movers.find(m => m.delta) || r.movers[0]
  const reasons: string[] = []
  let summary: string
  if (moved) {
    const e = explainMover(moved, set.window)
    summary = e.summary
    reasons.push(...e.reasons)
    for (const m of r.movers) if (m !== moved && m.delta) reasons.push(explainMover(m, set.window).summary)
  } else {
    summary = `"${r.title}" is not compared month to month, so there is no single change to explain. The checks below are what the system flags in this area.`
  }
  for (const i of d.pulse.insights.filter(x => r.area && x.area === r.area).slice(0, 2)) reasons.push(`${i.title}. ${i.detail}`)
  return {
    source: 'rules', model: null, generatedAt: new Date().toISOString(), dropped: 0,
    topic: r.topic, question: r.question, window: r.movers.length ? set.window : null, movers: r.movers,
    summary, reasons: reasons.slice(0, 4).map(text => ({ text, evidence: [] })), checks: [],
  }
}
