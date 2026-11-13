// lib/analytics/risk.ts — "who might we lose", explained.
//
// Not a model. A handful of signals that each mean something on its own, drawn from
// modules a single-purpose tool cannot see together: attendance, leave, the
// performance cycle, the reporting line and the pay record. Each signal carries a
// weight and a sentence; the level is the sum. A manager or HR reading a "High"
// sees exactly which facts produced it and can disagree with any of them.
//
// Deliberately excluded: anything an employee wrote in confidence (survey text,
// exit-interview notes, grievances). Signals describe behaviour on record only, and
// the list is shown to HR and, for their own team, to managers — never to the
// employee it describes.

import type { RiskSignal } from './types.ts'

export interface RiskFacts {
  /** Their L1 manager has resigned and is serving notice. */
  managerLeaving?: boolean
  /** Exits from the same team (same L1) in the last 90 days, not counting them. */
  teamExits90?: number
  /** Latest finalised rating code (O/EE/ME/NI/U), and the one before it. */
  rating?: string | null
  prevRating?: string | null
  /** Late marks in the last 30 days, and in the 30 before that. */
  late30?: number
  latePrev30?: number
  /** Unplanned leave spells in the last 90 days. */
  unplanned90?: number
  /** Of their short leaves in the last 180 days, how many bridged a weekend. */
  bridging180?: number
  /** Months since their pay was last revised (null when unknown). */
  monthsSinceRevision?: number | null
  /** Tenure in years. */
  tenureYears?: number | null
  /** Probation running past its end without a decision. */
  probationOverdue?: boolean
}

const RV: Record<string, number> = { O: 5, EE: 4, ME: 3, NI: 2, U: 1 }

export function riskSignals(f: RiskFacts): RiskSignal[] {
  const out: RiskSignal[] = []
  if (f.managerLeaving) {
    out.push({ code: 'MANAGER_LEAVING', weight: 2, label: 'Manager is leaving', detail: 'Their reporting manager is serving notice.' })
  }
  if ((f.teamExits90 || 0) >= 2) {
    out.push({ code: 'TEAM_EXITS', weight: 1, label: 'Team exits', detail: `${f.teamExits90} people left the same team in the last 90 days.` })
  }
  const r = String(f.rating || '').toUpperCase(), p = String(f.prevRating || '').toUpperCase()
  if (r === 'NI' || r === 'U') {
    out.push({ code: 'LOW_RATING', weight: 2, label: 'Low rating', detail: `Rated ${r === 'U' ? 'Unsatisfactory' : 'Needs improvement'} in the latest cycle.` })
  } else if (RV[r] && RV[p] && RV[r] < RV[p]) {
    out.push({ code: 'RATING_DROP', weight: 2, label: 'Rating fell', detail: `Rating fell from ${p} to ${r}.` })
  }
  const l30 = f.late30 || 0, lp = f.latePrev30 || 0
  if (l30 >= 4 && l30 >= lp * 2) {
    out.push({ code: 'LATE_SPIKE', weight: 1, label: 'Late marks rising', detail: `${l30} late marks in the last 30 days (${lp} in the 30 before).` })
  }
  if ((f.unplanned90 || 0) >= 3) {
    out.push({ code: 'UNPLANNED_LEAVE', weight: 1, label: 'Frequent short-notice leave', detail: `${f.unplanned90} unplanned leave spells in the last 90 days.` })
  }
  if ((f.bridging180 || 0) >= 3) {
    out.push({ code: 'BRIDGING', weight: 1, label: 'Long-weekend pattern', detail: `${f.bridging180} short leaves next to a weekend in the last 6 months.` })
  }
  if (f.monthsSinceRevision != null && f.monthsSinceRevision >= 18) {
    out.push({ code: 'NO_REVISION', weight: 1, label: 'No pay revision', detail: `Pay last revised ${Math.round(f.monthsSinceRevision)} months ago.` })
  }
  if (f.probationOverdue) {
    out.push({ code: 'PROBATION_OVERDUE', weight: 1, label: 'Probation undecided', detail: 'Probation has ended but they have not been confirmed.' })
  }
  if (f.tenureYears != null && f.tenureYears >= 1 && f.tenureYears < 2 && out.reduce((s, x) => s + x.weight, 0) >= 2) {
    // On its own the second year is not a signal, and it must not turn one weak signal
    // into a "medium" either; it only sharpens a picture that is already there, because
    // the second year is where Indian attrition clusters.
    out.push({ code: 'TENURE_WINDOW', weight: 1, label: 'Second-year window', detail: 'In their second year, when most exits happen.' })
  }
  return out
}

/** Medium needs two different signals, never one heavy one: a single low rating is a
 *  performance conversation, not a flight risk. High needs two signals and a score of 4.
 *  The second-year window only sharpens — it never counts as one of the two. */
export function riskLevel(signals: RiskSignal[]): { score: number; level: 'high' | 'medium' | 'low' } {
  const score = signals.reduce((s, x) => s + x.weight, 0)
  const distinct = signals.filter(x => x.code !== 'TENURE_WINDOW').length
  if (distinct < 2) return { score, level: 'low' }
  return { score, level: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low' }
}
