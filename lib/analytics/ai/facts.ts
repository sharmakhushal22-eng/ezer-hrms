// lib/analytics/ai/facts.ts — the fact sheet an AI is allowed to read.
//
// ── WHY A FACT SHEET AND NOT THE PAYLOAD ─────────────────────────────────────
//
// 1. PRIVACY. The analytics payload carries names (flight-risk lists, late-comers,
//    probation lists). None of that may leave the server. The sheet is written from
//    aggregates; where a manager's view must talk about individuals, each person is
//    a token (P1, P2…) and the names go back in on the server, after the answer.
//    No employee code, email, phone, date of birth or company name is ever written.
//
// 2. GROUNDING. Every figure the model may quote is written here, already formatted
//    the way the page prints it ("85%", "₹1.24 Cr", "10:12 AM"). The validator
//    rejects any sentence whose numbers are not on this sheet — so an AI sentence can
//    only repeat a figure the reader can find on the page.
//
// 3. COST. A few hundred short lines instead of a 300 KB JSON payload: the call stays
//    cheap and fast, and small-sample noise (a 3-person department) is cut out here,
//    before the model can make a headline of it.

import type { OrgAnalytics, TeamAnalytics, MyAnalytics, Kpi } from '../types.ts'
import type { Fact, FactPack } from './types.ts'
import { fmt, inr, clockOf, mLabel, dLabelLong } from '../format.ts'
import { istToday, daysBetween } from '../period.ts'
import { tenureYears } from '../metrics.ts'

/** Departments smaller than this are left out of breakdowns sent to the model. */
export const MIN_GROUP = 5

const pc = (v: number | null | undefined) => fmt(v, 'pct')
const ct = (v: number | null | undefined) => fmt(v, 'count')
const dy = (v: number | null | undefined) => fmt(v, 'days')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x'
const list = <T>(xs: T[], f: (x: T) => string, max = 8) => xs.slice(0, max).map(f).join(', ')
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

class Sheet {
  facts: Fact[] = []
  add(id: string, area: string, text: string | null | false | undefined) {
    if (!text) return
    // Ids must be unique; a second department with the same slug gets a suffix.
    let k = id, n = 2
    while (this.facts.some(f => f.id === k)) k = `${id}-${n++}`
    this.facts.push({ id: k, area, text: text.replace(/\s+/g, ' ').trim() })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Organisation (admin / HR / leadership)
// ───────────────────────────────────────────────────────────────────────────

const KPI_AREA: Record<string, string> = {
  headcount: 'workforce', joiners: 'attrition', exits: 'attrition', attrition: 'attrition',
  ontime: 'attendance', leave: 'leave', open: 'hiring', cost: 'cost', pms: 'performance',
}

const kpiLine = (k: Kpi) =>
  k.value == null ? null : `${k.label}: ${fmt(k.value, k.fmt)}${k.prev != null ? ` (previous period ${fmt(k.prev, k.fmt)})` : ''}${k.sub ? ` — ${k.sub}` : ''}`

export function orgFacts(d: OrgAnalytics): FactPack {
  const s = new Sheet()
  const sc = d.scope
  const filters = [sc.department && `department ${sc.department}`, sc.location && `location ${sc.location}`, sc.type && `employment type ${sc.type}`].filter(Boolean).join(', ')
  const context = `Scope: ${sc.companyLabel}${filters ? ` (${filters})` : ''}. Period: ${sc.period.label}, ${dLabelLong(sc.period.from)} to ${dLabelLong(sc.period.to)}. Today is ${dLabelLong(sc.today)}.`

  // Headline figures
  for (const k of d.pulse.kpis) s.add(`kpi.${k.key}`, KPI_AREA[k.key] || 'workforce', kpiLine(k))
  for (const c of d.pulse.changes) {
    if (c.now == null && c.before == null) continue
    s.add(`mtd.${c.key}`, KPI_AREA[c.key] || (c.key === 'applicants' ? 'hiring' : 'workforce'),
      `${c.label}, this month so far: ${fmt(c.now, c.fmt)}; same days last month: ${fmt(c.before, c.fmt)}`)
  }

  // Workforce
  const w = d.workforce
  s.add('wf.headcount', 'workforce', `People on the books: ${ct(w.headcount)}${w.avgTenure != null ? `; average tenure ${w.avgTenure} years` : ''}`)
  const flow = d.pulse.flow.filter(f => f.closing > 0 || f.joiners || f.exits)
  if (flow.length >= 2) {
    s.add('wf.trend', 'workforce', `Headcount at each month end: ${list(flow, f => `${mLabel(f.month)} ${ct(f.closing)}`, 12)}`)
    s.add('at.flow', 'attrition', `Joiners and exits by month: ${list(flow, f => `${mLabel(f.month)} ${f.joiners} joined / ${f.exits} left`, 12)}`)
  }
  if (w.byDepartment.length > 1) s.add('wf.dept', 'workforce', `Largest departments by headcount: ${list(w.byDepartment.filter(b => b.value > 0), b => `${b.label} ${ct(b.value)}`)}`)
  if (w.byLocation.length > 1) s.add('wf.location', 'workforce', `By location: ${list(w.byLocation, b => `${b.label} ${ct(b.value)}`, 6)}`)
  if (w.byType.length > 1) s.add('wf.type', 'workforce', `By employment type: ${list(w.byType, b => `${b.label} ${ct(b.value)}`, 6)}`)
  if (w.gender.length) s.add('wf.gender', 'workforce', `By gender: ${list(w.gender, b => `${b.label} ${ct(b.value)}`, 4)}`)
  if (w.tenure.some(b => b.value)) s.add('wf.tenure', 'workforce', `By tenure: ${list(w.tenure, b => `${b.label} ${ct(b.value)}`)}`)
  if (w.age.some(b => b.value)) s.add('wf.age', 'workforce', `By age: ${list(w.age, b => `${b.label} ${ct(b.value)}`)}`)
  if (w.span.managers) s.add('wf.span', 'workforce', `Managers with direct reports: ${ct(w.span.managers)}; average ${w.span.avgSpan ?? '—'} reports each (median ${w.span.medianSpan ?? '—'}); ${ct(w.span.narrow)} have only 1–2 reports; ${ct(w.span.wide)} have more than 12`)
  s.add('wf.probation', 'workforce', `On probation: ${ct(w.probation.onProbation)}; ${ct(w.probation.overdueCount)} are past their probation end date with no confirmation decision; ${ct(w.probation.dueSoonCount)} are due for a decision in the next 30 days`)
  if (w.noManager) s.add('wf.nomanager', 'workforce', `Employees with no reporting manager on record: ${ct(w.noManager)}`)

  // Attrition
  const a = d.attrition
  if (a.avgHeadcount > 0) {
    s.add('at.summary', 'attrition', `Exits in the period: ${ct(a.exits)} (${ct(a.voluntary)} voluntary, ${ct(a.involuntary)} involuntary${a.unclassified ? `, ${ct(a.unclassified)} not classified` : ''}; ${ct(a.regretted)} marked regretted) on an average headcount of ${ct(Math.round(a.avgHeadcount))}. Attrition for the period ${pc(a.rate)}; annualised ${pc(a.annualised)}${a.prevAnnualised != null ? `; previous period annualised ${pc(a.prevAnnualised)}` : ''}`)
  }
  const early = [a.early90.cohort ? `${ct(a.early90.left)} of ${ct(a.early90.cohort)} joiners left within 90 days (${pc(a.early90.rate)})` : '', a.early180.cohort ? `${ct(a.early180.left)} of ${ct(a.early180.cohort)} left within 180 days (${pc(a.early180.rate)})` : ''].filter(Boolean)
  if (early.length) s.add('at.early', 'attrition', `Early attrition: ${early.join('; ')}`)
  if (a.reasons.length) s.add('at.reasons', 'attrition', `Exit reasons given: ${list(a.reasons, r => `${r.label} ${r.value}`, 6)}`)
  if (a.tenureAtExit.some(b => b.value)) s.add('at.tenure', 'attrition', `Tenure of leavers at exit: ${list(a.tenureAtExit.filter(b => b.value), b => `${b.label} ${b.value}`)}`)
  const orgRate = a.avgHeadcount ? (a.exits / a.avgHeadcount) * 100 : null
  // The same floor the rule check uses (8 people, 2 exits): below it a rate is noise.
  const depts = a.byDepartment.filter(x => x.headcount >= 8 && x.exits >= 2 && x.rate != null).sort((x, y) => (y.rate as number) - (x.rate as number)).slice(0, 8)
  for (const x of depts) {
    const ratio = orgRate ? (x.rate as number) / orgRate : null
    s.add(`at.dept.${slug(x.label)}`, 'attrition', `Attrition in ${x.label}: ${x.exits} exits on ${x.headcount} people, ${pc(x.rate)} for the period${orgRate && ratio != null ? ` — ${ratio.toFixed(1)} times the organisation's ${pc(orgRate)}` : ''}`)
  }
  s.add('at.pipeline', 'attrition', `Resignations in progress (filed, on notice or awaiting approval): ${ct(a.pipelineCount)}`)
  if (a.risk.length) {
    const high = a.risk.filter(r => r.level === 'high').length
    const why = new Map<string, number>()
    for (const r of a.risk) for (const g of r.signals) why.set(g.label, (why.get(g.label) || 0) + 1)
    const byDept = new Map<string, number>()
    for (const r of a.risk) byDept.set(r.department || 'Unassigned', (byDept.get(r.department || 'Unassigned') || 0) + 1)
    s.add('at.risk', 'attrition', `Flight-risk screen (two or more warning signs on record): ${high} people at high risk, ${a.risk.length - high} at medium. Most common signs: ${list([...why].sort((x, y) => y[1] - x[1]), ([k, v]) => `${k} ${v}`, 6)}`)
    const big = [...byDept].filter(([, v]) => v >= 2).sort((x, y) => y[1] - x[1])
    if (big.length) s.add('at.risk-dept', 'attrition', `Flight risks by department: ${list(big, ([k, v]) => `${k} ${v}`, 6)}`)
  }

  // Attendance
  const t = d.attendance, sm = t.summary
  if (t.coverage.headcount) {
    s.add('att.coverage', 'attendance', `Attendance punches are recorded for ${ct(t.coverage.tracked)} of ${ct(t.coverage.headcount)} people (${pc((t.coverage.tracked / t.coverage.headcount) * 100)}), read over ${dLabelLong(t.window.from)} to ${dLabelLong(t.window.to)}`)
  }
  if (sm.punchedIn) {
    s.add('att.summary', 'attendance', `On-time punch-ins ${pc(sm.onTimeRate)}${t.prevOnTime != null ? ` (previous period ${pc(t.prevOnTime)})` : ''}; late on ${pc(sm.lateRate)} of punch-ins; a punch missing on ${pc(sm.missPunchRate)} of days; ${ct(sm.halfDays)} half days; average ${sm.avgHours ?? '—'} hours a day; typical first punch ${clockOf(sm.medianIn)}`)
    const months = t.monthly.filter(m => m.onTimeRate != null)
    if (months.length >= 2) s.add('att.monthly', 'attendance', `On-time rate by month: ${list(months, m => `${mLabel(m.month)} ${pc(m.onTimeRate)}`, 12)}`)
    const wd = t.weekday.filter(x => x.days >= 20 && x.rate != null)
    if (wd.length >= 3) s.add('att.weekday', 'attendance', `Late-mark rate by weekday: ${list(wd, x => `${x.label} ${pc(x.rate)}`, 7)}`)
    const ad = t.byDepartment.filter(x => x.tracked >= MIN_GROUP && x.onTimeRate != null).sort((x, y) => (x.onTimeRate as number) - (y.onTimeRate as number))
    if (ad.length >= 2) {
      s.add('att.dept-low', 'attendance', `Lowest on-time rates by department: ${list(ad.slice(0, 4), x => `${x.label} ${pc(x.onTimeRate)} (${x.tracked} tracked)`)}`)
      s.add('att.dept-high', 'attendance', `Highest on-time rates by department: ${list(ad.slice(-3).reverse(), x => `${x.label} ${pc(x.onTimeRate)} (${x.tracked} tracked)`)}`)
    }
  }
  const rg = t.regularisation
  if (rg.total) s.add('att.corrections', 'attendance', `Attendance corrections: ${ct(rg.total)} requested — ${ct(rg.approved)} approved, ${ct(rg.rejected)} rejected, ${ct(rg.pending)} pending (approval rate ${pc(rg.approvalRate)})`)

  // Leave
  const l = d.leave
  if (l.days) {
    s.add('lv.summary', 'leave', `Leave taken in the period: ${dy(l.days)} days, ${dy(l.perHead)} days per person; ${pc(l.unplannedShare)} of leave days were unplanned (sick, casual, loss of pay or applied on the day)`)
    if (l.byType.length) s.add('lv.types', 'leave', `Leave by type: ${list(l.byType, x => `${x.label} ${dy(x.days)} days in ${x.spells} spells`, 6)}`)
    if (l.bridge.spells) s.add('lv.bridge', 'leave', `Short leaves next to a weekend (starting Monday or ending Friday): ${l.bridge.bridging} of ${l.bridge.spells} (${pc(l.bridge.share)})`)
    if (l.weekdayStarts.some(b => b.value)) s.add('lv.starts', 'leave', `Leave spells by starting weekday: ${list(l.weekdayStarts, b => `${b.label} ${b.value}`, 7)}`)
    const months = l.monthly.filter(m => m.planned || m.unplanned)
    if (months.length >= 2) s.add('lv.monthly', 'leave', `Leave days by month (planned / unplanned): ${list(months, m => `${mLabel(m.month)} ${dy(m.planned)} / ${dy(m.unplanned)}`, 12)}`)
  }
  s.add('lv.pending', 'leave', l.pending.count ? `Leave requests waiting for approval: ${ct(l.pending.count)}, of which ${ct(l.pending.olderThan3)} are older than 3 days${l.pending.oldestDays != null ? `; the oldest is ${l.pending.oldestDays} days old` : ''}` : 'Leave requests waiting for approval: 0')
  if (l.noLeave90.of) s.add('lv.rest', 'leave', `People who have not taken any leave in 90 days: ${ct(l.noLeave90.count)} of ${ct(l.noLeave90.of)}`)
  if (l.balances.length) s.add('lv.balance', 'leave', `Average leave balance per person: ${list(l.balances, b => `${b.label} ${dy(b.perHead)} days`, 4)}`)

  // Performance and learning
  const p = d.performance
  if (p.cycle) {
    s.add('pf.cycle', 'performance', `Review cycle ${p.cycle}: ${ct(p.enrolled)} enrolled, ${pc(p.completion)} complete. By stage: ${list(p.stages.filter(x => x.value), x => `${x.label} ${x.value}`)}`)
    if (p.rated) {
      s.add('pf.distribution', 'performance', `Final ratings (${ct(p.rated)} rated): ${list(p.distribution, x => `${x.label} ${pc(x.share)} (reference curve ${x.reference}%)`, 5)}; share in the top two bands ${pc(p.topShare)}`)
      if (p.avgGap != null) s.add('pf.gap', 'performance', `Average gap between self-rating and final rating: ${p.avgGap} points`)
      const pd = p.byDepartment.filter(x => x.rated >= MIN_GROUP && x.avg != null).sort((x, y) => (x.avg as number) - (y.avg as number))
      if (pd.length >= 2) s.add('pf.dept', 'performance', `Average final rating by department (5 = Outstanding, 3 = Meets expectations): ${list(pd, x => `${x.label} ${x.avg} (${x.rated} rated)`, 10)}`)
      if (p.managerSkew.length) {
        const hi = p.managerSkew.filter(m => m.diff > 0).length
        s.add('pf.skew', 'performance', `Managers whose average rating is 0.6 points or more away from the organisation's: ${p.managerSkew.length} (${hi} rate higher, ${p.managerSkew.length - hi} rate lower)`)
      }
    }
  }
  if (p.pip.active || p.pip.requested || p.recognitions) s.add('pf.pip', 'performance', `Improvement plans: ${p.pip.active} active, ${p.pip.requested} requested. Recognitions given in the period: ${ct(p.recognitions)}`)
  if (p.trainingAsks.length) s.add('pf.training', 'learning', `Training most asked for in reviews: ${list(p.trainingAsks, b => `${b.label} ${b.value}`, 6)}`)
  const ln = d.learning
  if (ln.enrolments) {
    s.add('ln.summary', 'learning', `Learning: ${ct(ln.enrolments)} enrolments, ${ct(ln.completed)} completed (${pc(ln.completion)}), ${ct(ln.inProgress)} in progress, ${ct(ln.notStarted)} not started, ${ct(ln.overdue)} overdue; mandatory courses ${pc(ln.mandatoryCompletion)} complete${ln.avgScore != null ? `; average score ${Math.round(ln.avgScore)}` : ''}`)
    const lw = ln.byDepartment.filter(x => x.enrolments >= MIN_GROUP && x.completion != null).sort((x, y) => (x.completion as number) - (y.completion as number))
    if (lw.length >= 2) s.add('ln.dept', 'learning', `Lowest learning completion by department: ${list(lw.slice(0, 4), x => `${x.label} ${pc(x.completion)} (${x.overdue} overdue)`)}`)
  }

  // Hiring
  const h = d.hiring
  s.add('hr.open', 'hiring', `Open requisitions: ${ct(h.openMrfs)} for ${ct(h.openPositions)} positions${h.mrfAge.some(b => b.value) ? `; by age ${list(h.mrfAge, b => `${b.label} ${b.value}`)}` : ''}${h.oldestMrfs.length ? `; oldest: ${list(h.oldestMrfs, m => `${m.title}${m.department ? ` (${m.department})` : ''} open ${m.days} days`, 3)}` : ''}`)
  if (h.candidates) s.add('hr.funnel', 'hiring', `Hiring funnel: ${list(h.funnel, x => `${x.label} ${ct(x.value)}${x.conversion != null ? ` (${pc(x.conversion)} of the step before)` : ''}`, 8)}; ${ct(h.rejected)} rejected`)
  const decided = h.offers.accepted + h.offers.declined + h.offers.backout
  if (h.offers.made) s.add('hr.offers', 'hiring', `Offers: ${ct(h.offers.made)} made; ${ct(h.offers.accepted)} accepted, ${ct(h.offers.declined)} declined, ${ct(h.offers.backout)} backed out after accepting${decided ? `; acceptance ${pc(h.offers.acceptance)}` : ''}${h.timeToOffer != null ? `; median ${h.timeToOffer} days from application to offer` : ''}`)
  const src = h.sources.filter(x => x.candidates >= MIN_GROUP)
  if (src.length >= 2) s.add('hr.sources', 'hiring', `Candidate sources: ${list(src, x => `${x.label} ${x.candidates} candidates, ${x.offers} offers${x.rate != null ? ` (${pc(x.rate)})` : ''}`, 6)}`)
  if (h.joiningSoon.length) s.add('hr.joining', 'hiring', `Joining in the next 30 days: ${h.joiningSoon.length}`)
  const apps = h.monthlyApplicants.filter(m => m.value)
  if (apps.length >= 2) s.add('hr.applicants', 'hiring', `Applicants by month: ${list(apps, m => `${mLabel(m.month)} ${m.value}`, 12)}`)

  // Pay and cost — only when the caller may see it, and only aggregates.
  const c = d.cost
  if (c) {
    const lt = c.latest
    if (lt) {
      s.add('cs.latest', 'cost', `Payroll for ${mLabel(lt.month)} (${lt.status.toLowerCase()}): ${ct(lt.employees)} employees, gross ${inr(lt.gross)}, net ${inr(lt.net)}, employer statutory ${inr(lt.employerStatutory)}, cost to company ${inr(lt.costToCompany)}${lt.perHead != null ? `, ${inr(lt.perHead)} per head` : ''}`)
      if (lt.byDepartment.length) s.add('cs.dept', 'cost', `Gross pay by department, ${mLabel(lt.month)}: ${list(lt.byDepartment.filter(x => x.employees >= MIN_GROUP), x => `${x.label} ${inr(x.gross)} (${x.employees} people)`, 6)}`)
    }
    if (c.runs.length >= 2) s.add('cs.trend', 'cost', `Payroll cost to company by month: ${list(c.runs, r => `${mLabel(r.month)} ${inr(r.cost)} (${r.employees} paid)`, 12)}`)
    if (c.ctc.employees) {
      s.add('cs.ctc', 'cost', `Annual CTC on record: ${ct(c.ctc.employees)} people, total ${inr(c.ctc.total)}, median ${c.ctc.median != null ? inr(c.ctc.median) : '—'}`)
      const g = c.ctc.byGrade.filter(x => x.n >= MIN_GROUP && x.median != null)
      if (g.length) s.add('cs.grade', 'cost', `Median CTC by grade: ${list(g, x => `${x.label} ${inr(x.median as number)} (${x.n})`, 8)}`)
      const gr = c.ctc.genderRatio.filter(x => x.ratio != null)
      if (gr.length) s.add('cs.gender', 'cost', `Women's median CTC as a share of men's, by grade: ${list(gr, x => `${x.label} ${(x.ratio as number).toFixed(2)} (${x.female} women, ${x.male} men)`, 8)}`)
    }
  }

  // The rule sentences are written for HR, and one of them names a manager. Every
  // person the payload names anywhere is scrubbed out before a rule reaches the model.
  const managers = new Set(p.managerSkew.map(m => m.name))
  const named = [
    ...p.managerSkew, ...a.risk, ...a.pipeline, ...a.recentExits, ...w.probation.dueSoon, ...w.probation.overdue,
    ...t.lateList, ...l.bradford, ...l.noLeave90.people, ...h.joiningSoon,
  ].map(x => x.name).filter(Boolean).sort((x, y) => y.length - x.length)
  const scrub = (text: string) => named.reduce((out, nm) => out.split(nm).join(managers.has(nm) ? 'One manager' : 'An employee'), text)
  const signals: Fact[] = d.pulse.insights.map((i, n) => ({ id: `sig.${n + 1}`, area: i.area, text: scrub(`[${i.severity}] ${i.title}. ${i.detail}`) }))
  const noteAreas = ['workforce', 'attrition', 'attendance', 'performance', 'hiring', ...(c ? ['cost'] : [])]
  const scopeKey = JSON.stringify({
    a: 'org', companies: d.filters.companies.map(x => x.id).sort(), c: sc.company, d: sc.department, l: sc.location, t: sc.type,
    p: sc.period.key, cy: p.cycle, cost: !!c,
  })
  return {
    audience: 'org', scopeKey, context, facts: s.facts, signals,
    areas: ['workforce', 'attrition', 'attendance', 'leave', 'performance', 'learning', 'hiring', ...(c ? ['cost'] : [])],
    noteAreas, aliases: {},
  }
}

// ───────────────────────────────────────────────────────────────────────────
// A manager's team
// ───────────────────────────────────────────────────────────────────────────

/** Members sent to the model. A department head may have hundreds; the model gets the
 *  ones with something to say about them first, and counts for the rest. */
const MAX_MEMBERS = 40

export function teamFacts(d: TeamAnalytics, today = istToday()): FactPack {
  const s = new Sheet()
  // Tokens in a stable order (by id), so the same team gets the same tokens.
  const ordered = [...d.members].sort((a, b) => a.id.localeCompare(b.id))
  const tok = new Map(ordered.map((m, i) => [m.id, `P${i + 1}`]))
  const byName = new Map(ordered.map(m => [m.name, tok.get(m.id) as string]))
  const aliases: Record<string, string> = Object.fromEntries(ordered.map(m => [tok.get(m.id) as string, m.name]))
  const T = (id: string) => tok.get(id) || 'a team member'
  const scrub = (text: string) => {
    let out = text
    // Longest names first, so "Ravi Kumar Singh" is not half-replaced by "Ravi Kumar".
    for (const [name, t] of [...byName].sort((a, b) => b[0].length - a[0].length)) if (name) out = out.split(name).join(t)
    if (d.manager.name) out = out.split(d.manager.name).join('you')
    return out
  }

  const who = d.scope === 'DEPT' ? 'your department' : 'your direct team'
  const context = `This is ${who}: ${d.members.length} people. Month: ${mLabel(d.month)}. Today is ${dLabelLong(today)}.`

  const td = d.today
  s.add('tm.today', 'attendance', td.off ? 'Today is a day off for the team' : `Today: ${td.present} in, ${td.late} late, ${td.onLeave} on leave, ${td.notIn} not in yet`)
  s.add('tm.approvals', 'leave', `Waiting on you: ${d.approvals.leave} leave requests, ${d.approvals.regularisation} attendance corrections, ${d.performance.awaitingYou} reviews to rate${d.approvals.oldestDays != null ? `; the oldest request is ${d.approvals.oldestDays} days old` : ''}`)
  if (d.health.score != null) s.add('tm.health', 'workforce', `Team health ${d.health.score} out of 100. Parts: ${list(d.health.parts, x => `${x.label} ${x.value ?? 'no data'}`, 6)}`)
  const dist = d.performance.distribution.filter(x => x.value)
  if (dist.length) s.add('tm.ratings', 'performance', `Latest final ratings in the team: ${list(dist, x => `${x.key} ${x.value}`)}${d.performance.teamTopShare != null ? `; ${d.performance.teamTopShare}% in the top two bands` : ''}${d.performance.companyTopShare != null ? ` against ${d.performance.companyTopShare}% company-wide` : ''}`)
  if (d.outThisWeek.length) s.add('tm.out', 'leave', `People on approved leave in the next 7 days: ${d.outThisWeek.length} — ${list(d.outThisWeek, o => `${byName.get(o.name) || 'a team member'} (${o.type}, ${o.days} days)`)}`)
  // Counted per kind, so "5 probation decisions" has a fact behind it. Birthdays are
  // left out: a date of birth is not the model's business.
  const probation = d.upcoming.filter(u => u.kind === 'probation')
  const anniv = d.upcoming.filter(u => u.kind === 'anniversary')
  if (probation.length) s.add('tm.probation', 'workforce', `Probation decisions due or overdue: ${probation.length} — ${list(probation, u => `${byName.get(u.name) || 'a team member'} (${u.note.toLowerCase()}, ${dLabelLong(u.date)})`)}`)
  if (anniv.length) s.add('tm.anniversaries', 'workforce', `Work anniversaries coming up: ${anniv.length} — ${list(anniv, u => `${byName.get(u.name) || 'a team member'} (${u.note}, ${dLabelLong(u.date)})`)}`)

  const flagged = new Set(d.signals.map(r => r.id))
  const interesting = (m: TeamAnalytics['members'][number]) =>
    (flagged.has(m.id) ? 8 : 0) + (m.onNotice ? 6 : 0) + m.month.late + m.month.absent * 2 + m.month.miss + (m.lastLeave ? 0 : 3)
  const members = [...d.members].sort((a, b) => interesting(b) - interesting(a)).slice(0, MAX_MEMBERS)
  for (const m of members) {
    const t = T(m.id)
    const yrs = m.doj ? tenureYears(m.doj, today) : null
    const mo = m.month
    s.add(`p.${t}`, 'workforce', `${t}${m.designation ? ` (${m.designation})` : ''}${yrs != null ? `, ${yrs < 1 ? plural(Math.max(0, Math.round(yrs * 12)), 'month') : plural(Math.floor(yrs), 'year')} in the company` : ''}: this month present ${mo.present} of ${mo.workdays} working days, late ${mo.late}, absent ${mo.absent}, missing punch ${mo.miss}${mo.avgIn != null ? `, usually in by ${clockOf(mo.avgIn)}` : ''}${mo.avgHours != null ? `, ${mo.avgHours} hours a day` : ''}; leave in the last 90 days ${dy(m.leave90)} days, last day off ${m.lastLeave ? dLabelLong(m.lastLeave) : 'none in a year'}; EL balance ${dy(m.balance)} days; latest rating ${m.rating || 'none yet'}${m.pmsStage ? `; review stage ${m.pmsStage.replace(/_/g, ' ').toLowerCase()}` : ''}${m.onNotice ? '; serving notice' : ''}`)
  }
  if (d.members.length > members.length) s.add('p.rest', 'workforce', `${d.members.length - members.length} more people are in the team with nothing unusual on record this month`)
  for (const r of d.signals) {
    s.add(`risk.${T(r.id)}`, 'attrition', `${T(r.id)} shows several warning signs at once (${r.level}): ${r.signals.map(g => `${g.label} — ${scrub(g.detail)}`).join('; ')}`)
  }

  const signals: Fact[] = d.insights.map((i, n) => ({ id: `sig.${n + 1}`, area: i.area, text: scrub(`[${i.severity}] ${i.title}. ${i.detail}`) }))
  // Last guard: no real name may survive into the sheet, whatever wrote the text.
  for (const f of [...s.facts, ...signals]) f.text = scrub(f.text)
  return {
    audience: 'team', scopeKey: JSON.stringify({ a: 'team', m: d.manager.id, s: d.scope }), context, facts: s.facts, signals,
    areas: ['attendance', 'leave', 'performance', 'attrition', 'workforce'], noteAreas: [], aliases,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// An employee's own record
// ───────────────────────────────────────────────────────────────────────────

export function myFacts(d: MyAnalytics, today = istToday()): FactPack {
  const s = new Sheet()
  // No name, code, department or designation: the model needs the pattern, not the person.
  const context = `This is one employee's own record, written for them. ${d.me.tenureYears != null ? `They have been with the company ${d.me.tenureYears < 1 ? `${Math.max(0, Math.round(d.me.tenureYears * 12))} months` : `${d.me.tenureYears} years`}. ` : ''}Today is ${dLabelLong(today)}.`

  const a = d.attendance, tm = a.thisMonth
  s.add('me.month', 'attendance', `This month so far: present ${tm.present} of ${tm.workdays} working days, late ${tm.late}, absent ${tm.absent}, on leave ${dy(tm.leave)} days; on time ${pc(tm.onTimeRate)}${tm.avgIn != null ? `; usually in by ${clockOf(tm.avgIn)}` : ''}${tm.avgHours != null ? `; ${tm.avgHours} hours a day` : ''}`)
  const months = a.monthly.filter(m => m.workdays)
  if (months.length >= 2) s.add('me.monthly', 'attendance', `By month: ${list(months, m => `${mLabel(m.month)} present ${m.present}/${m.workdays}, late ${m.late}, absent ${m.absent}, on time ${pc(m.onTimeRate)}`, 6)}`)
  if (a.streak) s.add('me.streak', 'attendance', `Current run of on-time days: ${a.streak}`)
  if (a.team) s.add('me.team', 'attendance', `Team medians for comparison (${a.team.size} colleagues, anonymous): on time ${pc(a.team.onTimeRate)}${a.team.avgIn != null ? `, in by ${clockOf(a.team.avgIn)}` : ''}${a.team.avgHours != null ? `, ${a.team.avgHours} hours a day` : ''}`)
  const miss = a.days.filter(x => (x.kind === 'MISS_IN' || x.kind === 'MISS_OUT') && daysBetween(x.date, today) <= 31).length
  if (miss) s.add('me.miss', 'attendance', `Days with a missing punch in the last month: ${miss}`)

  const l = d.leave
  if (l.balances.length) s.add('me.balances', 'leave', `Leave balances: ${list(l.balances, b => `${b.label} ${dy(b.available)} available (${dy(b.used)} used${b.lapse != null ? `, ${dy(b.lapse)} above the carry-forward limit and will lapse on 31 March` : ''})`, 6)}`)
  s.add('me.taken', 'leave', `Leave taken this financial year: ${dy(l.takenThisFy)} days; last day off ${l.lastLeave ? dLabelLong(l.lastLeave) : 'none in the last year'}`)
  if (l.upcoming.length) s.add('me.upcoming', 'leave', `Leave coming up: ${list(l.upcoming, u => `${u.type} ${dLabelLong(u.from)} for ${dy(u.days)} days (${u.status.toLowerCase()})`, 4)}`)

  const pay = d.pay.months
  if (pay.length) s.add('me.pay', 'pay', `Take-home pay by month: ${list(pay, m => `${mLabel(m.month)} net ${inr(m.net, false)} (gross ${inr(m.gross, false)}, deductions ${inr(m.deductions, false)})`, 6)}`)
  if (d.pay.ctc != null) s.add('me.ctc', 'pay', `Annual CTC on record${d.pay.ctcFy ? ` for ${d.pay.ctcFy}` : ''}: ${inr(d.pay.ctc)}`)

  const hist = d.performance.history.filter(x => x.rating)
  if (hist.length) s.add('me.ratings', 'performance', `Published review ratings: ${list(hist, x => `${x.name} ${x.rating}`, 4)}`)
  const cur = d.performance.current
  if (cur) s.add('me.cycle', 'performance', `Current review cycle ${cur.name}: stage ${cur.stage}, ${cur.goals} goals set`)

  const lr = d.learning
  if (lr.enrolled) s.add('me.learning', 'learning', `Learning: ${lr.enrolled} courses, ${lr.completed} completed, ${lr.inProgress} in progress, ${lr.overdue} overdue`)
  if (d.recognition.kudos || d.recognition.awards) s.add('me.recognition', 'recognition', `Recognition received: ${d.recognition.kudos} kudos, ${d.recognition.awards} awards`)
  // The birthday stays on the page and off the sheet — it is a date of birth.
  const ms = d.milestones.filter(m => m.label !== 'Birthday')
  if (ms.length) s.add('me.milestones', 'recognition', `Milestones: ${list(ms, m => `${m.label} on ${dLabelLong(m.date)}`, 4)}`)

  const signals: Fact[] = d.nudges.map((i, n) => ({ id: `sig.${n + 1}`, area: i.area, text: `[${i.severity}] ${i.title}. ${i.detail}` }))
  return {
    audience: 'me', scopeKey: JSON.stringify({ a: 'me', e: d.me.id }), context, facts: s.facts, signals,
    areas: ['attendance', 'leave', 'pay', 'performance', 'learning', 'recognition'], noteAreas: [], aliases: {},
  }
}
