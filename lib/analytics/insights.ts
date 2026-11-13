// lib/analytics/insights.ts — the sentences at the top of the dashboard.
//
// Rules over figures the screen already shows. Each rule states its threshold and a
// minimum sample, because "attrition is 50%" about a two-person team is not a finding,
// it is noise with a percent sign. Nothing here invents a number: every figure in a
// sentence comes from the payload, so the reader can find it on the page.
//
// Ordered critical → warning → info → positive, then by the order the rules run in,
// which is roughly "what would a CHRO want to hear first".

import type { Insight, OrgAnalytics, Severity } from './types.ts'

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, positive: 3 }

const n = (x: number) => x.toLocaleString('en-IN')
const p = (x: number | null | undefined) => (x == null ? '—' : `${x.toFixed(x >= 10 || Number.isInteger(x) ? 0 : 1)}%`)
const plural = (k: number, one: string, many = one + 's') => `${n(k)} ${k === 1 ? one : many}`

export function orgInsights(a: Omit<OrgAnalytics, 'pulse'> & { pulse?: unknown }): Insight[] {
  const out: Insight[] = []
  const add = (id: string, severity: Severity, area: Insight['area'], title: string, detail: string) =>
    out.push({ id, severity, area, title, detail })

  // ── Attrition ──────────────────────────────────────────────────────────
  const at = a.attrition
  if (at.annualised != null && at.avgHeadcount >= 20 && at.exits >= 3) {
    if (at.annualised >= 30) add('attr-high', 'critical', 'attrition', `Attrition is running at ${p(at.annualised)} a year`,
      `${plural(at.exits, 'exit')} against an average of ${n(Math.round(at.avgHeadcount))} people in ${a.scope.period.label.toLowerCase()}. India's 2025 average was about 16%.`)
    else if (at.annualised >= 18) add('attr-high', 'warning', 'attrition', `Attrition is above the Indian average at ${p(at.annualised)} a year`,
      `${plural(at.exits, 'exit')} in ${a.scope.period.label.toLowerCase()}. The 2025 India average was about 16%.`)
  }
  if (at.annualised != null && at.prevAnnualised != null && at.exits >= 3 && at.annualised < at.prevAnnualised * 0.75) {
    add('attr-down', 'positive', 'attrition', 'Attrition has come down', `Annualised ${p(at.annualised)}, from ${p(at.prevAnnualised)} in the period before.`)
  }
  const orgRate = at.avgHeadcount ? (at.exits / at.avgHeadcount) * 100 : null
  for (const d of at.byDepartment) {
    if (orgRate && d.rate != null && d.exits >= 2 && d.headcount >= 8 && d.rate >= orgRate * 2) {
      add(`attr-dept-${d.key}`, 'warning', 'attrition', `${d.label} is losing people twice as fast`,
        `${plural(d.exits, 'exit')} on ${n(d.headcount)} people — ${p(d.rate)} against ${p(orgRate)} across the organisation.`)
    }
  }
  if (at.early180.cohort >= 15 && at.early180.rate != null && at.early180.rate >= 15) {
    add('early', 'warning', 'attrition', `${p(at.early180.rate)} of new joiners leave within six months`,
      `${n(at.early180.left)} of ${n(at.early180.cohort)} people who joined in the year before last left inside 180 days — look at hiring fit and onboarding.`)
  }
  if (at.regretted > 0) {
    add('regretted', at.regretted >= 3 ? 'warning' : 'info', 'attrition', `${plural(at.regretted, 'regretted exit')} in ${a.scope.period.label.toLowerCase()}`,
      'Marked regrettable on the resignation — people the company wanted to keep.')
  }
  if (at.pipelineCount > 0) {
    add('pipeline', 'info', 'attrition', `${plural(at.pipelineCount, 'person', 'people')} serving notice or awaiting approval`,
      `Open resignations that have not reached their last day yet.${at.pipeline.some(x => x.regrettable) ? ' Some are marked regrettable.' : ''}`)
  }
  const high = at.risk.filter(r => r.level === 'high').length
  if (high > 0) {
    add('risk', 'warning', 'attrition', `${plural(high, 'person', 'people')} showing several warning signs`,
      'Flight-risk signals across attendance, leave, rating and reporting line. Open Attrition to see each reason.')
  }

  // ── Workforce ──────────────────────────────────────────────────────────
  const wf = a.workforce
  if (wf.probation.overdueCount > 0) {
    add('probation-overdue', 'warning', 'workforce', `${plural(wf.probation.overdueCount, 'probation')} past the end date`,
      'Still on probation after the probation period ended — confirm, extend or close each one.')
  }
  if (wf.probation.dueSoonCount > 0) {
    add('probation-due', 'info', 'workforce', `${plural(wf.probation.dueSoonCount, 'confirmation')} due in the next 30 days`, 'Reviews to schedule with their managers.')
  }
  if (wf.span.narrow >= 3 && wf.span.managers >= 5 && wf.span.narrow / wf.span.managers >= 0.3) {
    add('span-narrow', 'info', 'workforce', `${n(wf.span.narrow)} of ${n(wf.span.managers)} managers have only one or two reports`,
      'Narrow spans add layers and cost. Worth checking whether each is a real management role.')
  }
  if (wf.span.wide > 0) {
    add('span-wide', 'info', 'workforce', `${plural(wf.span.wide, 'manager')} with more than 12 direct reports`, 'Very wide spans make one-to-ones and reviews hard to keep up.')
  }
  if (wf.noManager > 0 && wf.headcount >= 10) {
    add('no-manager', 'info', 'workforce', `${plural(wf.noManager, 'employee')} without a reporting manager`,
      'Leave, attendance and review approvals have nowhere to go for them.')
  }

  // ── Attendance ─────────────────────────────────────────────────────────
  const att = a.attendance
  if (att.coverage.headcount > 0 && att.coverage.tracked / att.coverage.headcount < 0.5) {
    add('att-coverage', 'info', 'attendance', `Attendance covers ${n(att.coverage.tracked)} of ${n(att.coverage.headcount)} people`,
      'Everyone else has no punches in this window, so attendance figures describe the tracked group only.')
  }
  const s = att.summary
  if (s.punchedIn >= 40 && s.onTimeRate != null) {
    if (s.onTimeRate < 80) add('ontime', 'warning', 'attendance', `Only ${p(s.onTimeRate)} of punch-ins are on time`, `${n(s.late)} late marks on ${n(s.punchedIn)} working days.`)
    else if (att.prevOnTime != null && s.onTimeRate - att.prevOnTime >= 5) add('ontime-up', 'positive', 'attendance', 'Punctuality is improving', `${p(s.onTimeRate)} on time, up from ${p(att.prevOnTime)}.`)
  }
  const wk = att.weekday.filter(w => w.days >= 15 && w.rate != null)
  if (wk.length >= 3 && s.lateRate != null) {
    const worst = wk.reduce((x, y) => ((y.rate as number) > (x.rate as number) ? y : x))
    if ((worst.rate as number) >= Math.max(s.lateRate * 1.5, s.lateRate + 8)) {
      add('late-weekday', 'info', 'attendance', `Late marks peak on ${worst.label}`, `${p(worst.rate)} of ${worst.label} punch-ins are late, against ${p(s.lateRate)} overall.`)
    }
  }
  if (s.days >= 40 && s.missPunchRate != null && s.missPunchRate >= 8) {
    add('miss', 'warning', 'attendance', `${p(s.missPunchRate)} of attendance days are missing a punch`,
      'A process problem more than a people problem — check devices, the app\'s geofence, and shift end times.')
  }

  // ── Leave ──────────────────────────────────────────────────────────────
  const lv = a.leave
  if (lv.pending.olderThan3 > 0) {
    add('leave-pending', 'warning', 'leave', `${plural(lv.pending.olderThan3, 'leave request')} waiting more than 3 days`,
      `The oldest has waited ${plural(lv.pending.oldestDays || 0, 'day')}. Slow approvals are the most common ESS complaint.`)
  }
  if (lv.bridge.spells >= 10 && lv.bridge.share != null && lv.bridge.share >= 55) {
    add('bridge', 'warning', 'leave', `${p(lv.bridge.share)} of short leaves touch a weekend`,
      `${n(lv.bridge.bridging)} of ${n(lv.bridge.spells)} one- and two-day leaves start on a Monday or end on a Friday — chance alone would give about 40%.`)
  }
  if (lv.unplannedShare != null && lv.days >= 20 && lv.unplannedShare >= 45) {
    add('unplanned', 'info', 'leave', `${p(lv.unplannedShare)} of leave is unplanned`, 'Sick, casual or applied on the day itself. High unplanned leave makes staffing hard to plan.')
  }
  if (lv.noLeave90.of >= 10 && lv.noLeave90.count / lv.noLeave90.of >= 0.4) {
    add('no-leave', 'info', 'leave', `${n(lv.noLeave90.count)} people have not taken a day off in 90 days`,
      'Unbroken stretches without leave are an early burnout sign. Managers can nudge them to plan a break.')
  }

  // ── Performance ────────────────────────────────────────────────────────
  const pf = a.performance
  if (pf.cycle && pf.enrolled >= 10 && pf.completion != null && pf.completion < 50) {
    const ns = pf.stages.find(x => x.key === 'not_started')?.value || 0
    add('pms-progress', ns / pf.enrolled > 0.7 ? 'warning' : 'info', 'performance', `${pf.cycle}: ${p(pf.completion)} of reviews are complete`,
      `${n(ns)} of ${n(pf.enrolled)} people have not started.`)
  }
  if (pf.rated >= 10 && pf.topShare != null && pf.topShare >= 50) {
    add('inflation', 'warning', 'performance', `${p(pf.topShare)} rated in the top two bands`, 'Ratings that cluster at the top stop telling performers apart. Consider a calibration round.')
  }
  for (const m of pf.managerSkew.filter(x => Math.abs(x.diff) >= 0.6).slice(0, 2)) {
    add(`skew-${m.id}`, 'info', 'performance', `${m.name} rates ${m.diff > 0 ? 'more generously' : 'more strictly'} than the organisation`,
      `Average ${m.avg.toFixed(1)} across ${n(m.rated)} people, ${Math.abs(m.diff).toFixed(1)} ${m.diff > 0 ? 'above' : 'below'} the company.`)
  }

  // ── Learning ───────────────────────────────────────────────────────────
  const ln = a.learning
  if (ln.overdue > 0) add('lms-overdue', ln.overdue >= 10 ? 'warning' : 'info', 'learning', `${plural(ln.overdue, 'course')} overdue`, 'Assigned courses past their due date and not complete.')
  if (ln.mandatoryCompletion != null && ln.mandatoryCompletion < 80 && ln.enrolments >= 10) {
    add('lms-mandatory', 'warning', 'learning', `Mandatory training is ${p(ln.mandatoryCompletion)} complete`, 'Compliance courses carry audit risk when they lapse.')
  }

  // ── Hiring ─────────────────────────────────────────────────────────────
  const h = a.hiring
  const stale = h.oldestMrfs.filter(m => m.days > 60)
  if (stale.length > 0) {
    add('mrf-stale', 'warning', 'hiring', `${plural(stale.length, 'requisition')} open for more than 60 days`,
      `The oldest, ${stale[0].title}, has been open ${n(stale[0].days)} days.`)
  }
  if (h.offers.made >= 5 && h.offers.acceptance != null && h.offers.acceptance < 70) {
    add('offer-accept', 'warning', 'hiring', `Only ${p(h.offers.acceptance)} of offers are accepted`, `${n(h.offers.backout + h.offers.declined)} declined or backed out of ${n(h.offers.made)}. Check offer competitiveness and notice-period buyouts.`)
  }
  if (h.joiningSoon.length > 0) {
    add('joining', 'positive', 'hiring', `${plural(h.joiningSoon.length, 'person', 'people')} joining in the next 30 days`, 'Make sure laptops, IDs and day-one plans are ready.')
  }

  // ── Cost ───────────────────────────────────────────────────────────────
  const c = a.cost
  if (c && c.runs.length >= 2) {
    const [prev, last] = c.runs.slice(-2)
    if (prev.gross > 0) {
      const ch = ((last.gross - prev.gross) / prev.gross) * 100
      if (Math.abs(ch) >= 5) add('cost-move', ch > 0 ? 'info' : 'positive', 'cost', `Payroll gross ${ch > 0 ? 'rose' : 'fell'} ${Math.abs(ch).toFixed(1)}% month on month`,
        `Compare headcount (${n(prev.employees)} → ${n(last.employees)}) before reading it as a pay change.`)
    }
  }
  if (c) {
    const gaps = c.ctc.genderRatio.filter(g => g.ratio != null && (g.ratio as number) < 0.9)
    if (gaps.length) add('pay-gap', 'warning', 'cost', `Women are paid less than men in ${plural(gaps.length, 'grade')}`,
      `Median CTC for women is ${Math.round((gaps[0].ratio as number) * 100)}% of men's in ${gaps[0].label}. Only grades with five or more of each are compared.`)
  }

  return out.sort((x, y) => RANK[x.severity] - RANK[y.severity])
}
