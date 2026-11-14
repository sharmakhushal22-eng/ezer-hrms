// lib/analytics/server/org.ts — the organisation-wide analytics payload.
//
// One request, every tab. The figures are computed here, on the server, with the
// service client and the caller's company scope applied before anything is read —
// the browser receives aggregates and the few named lists the caller may see, never
// the raw tables.
//
// Population: every non-test employee in the companies in scope, narrowed by the
// department / location / employment-type filters. Flows (joiners, exits, leave,
// attendance) are measured over the chosen period; trends always over the trailing
// twelve months, so a chart does not shrink to one bar when "This month" is picked.

import type { Grant } from '@/lib/rms/resolve'
import { companyFilter, scopedCompanies, canPickGroup } from '@/lib/rms/resolve'
import type { Module } from '@/lib/rms/modules'
import {
  resolvePeriod, previousPeriod, istToday, addMonths, monthOf, monthsBetween, addDays, daysBetween, yearFraction,
  fiscalToMonth, fyLabel, type PeriodKey,
} from '../period.ts'
import {
  type EmpLite, type AttRec, type LeaveApp, type Bucket,
  onBooks, headcountOn, monthlyFlow, periodAttrition, annualise, exitedIn, earlyAttrition, spanOfControl, tenureYears, tenureBand,
  TENURE_BANDS, ageBand, AGE_BANDS, probationOverdue, probationDue, countBy, toBuckets, pct, mean, median, round,
  summariseAttendance, lateByWeekday, daysWithin, isUnplanned, bridgeShare, bradford, weekdayName,
  ratingDistribution, pmsStage, PMS_STAGES, RATING_VALUE, funnelCounts, joinedIn,
} from '../metrics.ts'
import { riskSignals, riskLevel } from '../risk.ts'
import { orgInsights } from '../insights.ts'
import type { OrgAnalytics, PersonRef, Kpi, Change, RiskRow } from '../types.ts'
import { sb, all, inChunks, soft, EMP_COLS, toEmp, floorHalf, leaveYear, one, OPEN_RESIGNATION, STAGE_LABEL } from './db.ts'
import { allows, allowedPick, limitLabel, type OrgAccess } from '../access.ts'
import { computeMovers, moversReadFrom, type MoverInput } from '../movers.ts'

export interface OrgQuery {
  company?: string | null
  department?: string | null
  location?: string | null
  type?: string | null
  period?: PeriodKey
  cycle?: string | null
}

/** How far back attendance is read. Longer windows are summarised from the last 92
 *  days of the period: per-day rows grow with headcount × days, and three months is
 *  enough to see a pattern without making the screen wait. */
const ATT_MAX_DAYS = 92

/** Named lists ("Show all" on the page) are capped here so one request cannot carry a
 *  whole company's names; the Excel download gets the same rows. */
const LIST_MAX = 500

export async function orgAnalytics(grant: Grant, module: Module | null, q0: OrgQuery, acc: OrgAccess | { cost: boolean; people: boolean }): Promise<OrgAnalytics> {
  const access = { cost: acc.cost, people: acc.people }
  // A grant (analytics_access) carries its own data limit; a role has none beyond its
  // company scope. Picks outside the limit are dropped, never honoured.
  const lim = 'limit' in acc ? acc.limit : null
  const q: OrgQuery = { ...q0, department: allowedPick(lim?.departments, q0.department), location: allowedPick(lim?.locations, q0.location), type: allowedPick(lim?.types, q0.type) }
  const today = istToday()
  const period = resolvePeriod(q.period || 'last_12', today)
  const prev = previousPeriod(period)
  const trend = monthsBetween(addMonths(monthOf(today), -11), monthOf(today))

  // ── Scope ────────────────────────────────────────────────────────────────
  const { data: compRows } = await sb.from('companies').select('id, company_code, company_name, short_name').order('company_name')
  const companiesAll = ((compRows || []) as any[]).map(c => ({ id: c.id as string, label: (c.short_name || c.company_code || c.company_name) as string, name: c.company_name as string }))
  let companiesOk: typeof companiesAll, group: boolean, pinned: string | null
  if (lim) {
    // The grant names its companies (none = all of them); the role's scope does not apply.
    companiesOk = lim.companies ? companiesAll.filter(c => lim.companies!.includes(c.id)) : companiesAll
    pinned = q.company && companiesOk.some(c => c.id === q.company) ? q.company : companiesOk.length === 1 ? companiesOk[0].id : null
    group = companiesOk.length > 1
  } else {
    companiesOk = scopedCompanies(grant, companiesAll, module)
    group = canPickGroup(grant, companiesAll, module)
    pinned = companyFilter(grant, q.company || null, module)
  }
  // An empty list would read as no filter at all; a grant naming no company that exists sees nobody.
  const companyIds = pinned ? [pinned] : companiesOk.length ? companiesOk.map(c => c.id) : ['00000000-0000-0000-0000-000000000000']
  const someCompanies = companiesOk.length < companiesAll.length
  const groupLabel = lim && someCompanies ? `All my companies (${companiesOk.length})` : 'All group companies'
  const companyLabel = pinned ? (companiesAll.find(c => c.id === pinned)?.name || 'Company') : groupLabel.replace(/^All my/, 'Your')

  const [deptRows, locRows, empRows] = await Promise.all([
    all<any>(() => sb.from('departments').select('id, dept_name, company_id').in('company_id', companyIds).order('dept_name') as any, 'departments'),
    all<any>(() => sb.from('locations').select('id, location_name, company_id').in('company_id', companyIds).order('location_name') as any, 'locations'),
    all<any>(() => sb.from('employees').select(EMP_COLS).in('company_id', companyIds).order('id') as any, 'employees'),
  ])
  const deptName = new Map<string, string>(deptRows.map(d => [d.id, d.dept_name]))
  const locName = new Map<string, string>(locRows.map(l => [l.id, l.location_name]))
  const coName = new Map<string, string>(companiesAll.map(c => [c.id, c.label]))
  const dn = (id: string | null) => (id ? deptName.get(id) || 'Unassigned' : 'Unassigned')

  const everyone = empRows.filter(r => r.is_test !== true).map(toEmp)
  const types = [...new Set(everyone.map(e => e.type).filter(Boolean) as string[])].filter(t => allows(lim?.types, t)).sort()
  // Department and location filter by NAME: in the group view the same department
  // exists once per company, and "Finance & Accounts" means all of them.
  const ln = (id: string | null) => (id ? locName.get(id) || 'Unassigned' : 'Unassigned')
  const emps = everyone.filter(e =>
    allows(lim?.departments, dn(e.department_id)) && allows(lim?.locations, ln(e.location_id)) && allows(lim?.types, e.type) &&
    (!q.department || dn(e.department_id) === q.department) &&
    (!q.location || ln(e.location_id) === q.location) &&
    (!q.type || e.type === q.type))
  const ids = emps.map(e => e.id)
  const byId = new Map(emps.map(e => [e.id, e]))
  const allById = new Map(everyone.map(e => [e.id, e]))
  const ref = (e: EmpLite): PersonRef => ({ id: e.id, code: e.code, name: e.name, designation: e.designation, department: e.department_id ? dn(e.department_id) : null })
  const active = emps.filter(e => onBooks(e, today))
  const activeIds = new Set(active.map(e => e.id))

  // ── Reads that depend on the population ─────────────────────────────────
  const attTo = period.to
  const attFrom = daysBetween(period.from, period.to) + 1 > ATT_MAX_DAYS ? addDays(period.to, -(ATT_MAX_DAYS - 1)) : period.from
  const attLen = daysBetween(attFrom, attTo) + 1
  const attPrevFrom = addDays(attFrom, -attLen)
  // Also far enough back for "last month against the month before" (lib/analytics/movers.ts).
  const readFrom = [attPrevFrom, addDays(today, -60), moversReadFrom(today)].sort()[0]
  const leaveFrom = [period.from, prev.from, addDays(today, -365)].sort()[0]
  const fy = fyLabel(today)

  const [resig, hrExits, reasons, attAll, leaveAll, balances, regs, periods, ratings, learners, mrfs, cands, joiners, ctc] = await Promise.all([
    soft(inChunks<any>(ids, c => sb.from('employee_resignation').select('employee_id, status, date_of_resignation, final_lwd, tentative_lwd, proposed_lwd, lwd_as_per_policy, reason_code, is_regrettable, created_at').in('employee_id', c).order('created_at') as any, 'resignations')),
    soft(all<any>(() => sb.from('hr_exit_requests').select('employee_id, status, reason_code, reason_label, last_working_day').in('company_id', companyIds).order('created_at') as any, 'hr exits')),
    soft(all<any>(() => sb.from('exit_reason_master').select('code, category, label').order('code') as any, 'exit reasons')),
    all<any>(() => sb.from('attendance_records').select('employee_id, attendance_date, work_in, work_out, total_minutes, late_minutes, overtime_minutes, status').gte('attendance_date', readFrom).lte('attendance_date', [attTo, today].sort()[1]).order('attendance_date').order('employee_id') as any, 'attendance'),
    all<any>(() => sb.from('leave_applications').select('employee_id, from_date, to_date, days, half_day, status, applied_at, resolved_at, leave_types(short_name, name)').lte('from_date', [period.to, today].sort()[1]).gte('to_date', leaveFrom).order('from_date').order('employee_id') as any, 'leave'),
    soft(inChunks<any>(ids, c => sb.from('leave_balances').select('employee_id, leave_type_id, opening, accrued, used, encashed, leave_types(short_name, name)').eq('year', leaveYear(today)).in('employee_id', c).order('employee_id') as any, 'balances')),
    soft(all<any>(() => sb.from('attendance_regularisation').select('employee_id, attendance_date, status').gte('attendance_date', period.from).lte('attendance_date', period.to).order('attendance_date') as any, 'regularisations')),
    soft(all<any>(() => sb.from('pms_periods').select('id, company_id, period_code, period_name, period_start, period_end, status').in('company_id', companyIds).order('period_start') as any, 'pms periods')),
    soft(all<any>(() => sb.from('pms_overall_rating').select('period_id, employee_id, department_id, rm_l1_id, workflow_status, final_rating_code, final_score, self_vs_final_gap').in('company_id', companyIds).order('id') as any, 'pms ratings')),
    soft(all<any>(() => sb.from('lms_learners').select('id, employee_id, department_id').in('company_id', companyIds).order('id') as any, 'learners')),
    soft(all<any>(() => sb.from('manpower_requisitions').select('id, mrf_number, position, job_title, designation, department_id, location_id, no_of_openings, openings, status, created_at, approved_at').in('company_id', companyIds).order('created_at') as any, 'mrfs')),
    soft(all<any>(() => sb.from('candidates').select('id, mrf_id, stage, source, offer_response, created_at, applied_date, offer_sent_at').in('company_id', companyIds).order('created_at') as any, 'candidates')),
    soft(all<any>(() => sb.from('onboarding_candidates').select('full_name, designation, department, department_id, location_id, date_of_joining, status').in('company_id', companyIds).gte('date_of_joining', today).lte('date_of_joining', addDays(today, 30)).order('date_of_joining') as any, 'joiners')),
    access.cost ? soft(inChunks<any>(ids, c => sb.from('ctc_master').select('employee_id, fy, annual_ctc, effective_from, status').in('employee_id', c).order('employee_id') as any, 'ctc')) : Promise.resolve([] as any[]),
  ])

  const inPop = (id: string) => byId.has(id)
  const att: AttRec[] = (attAll as AttRec[]).filter(r => inPop(r.employee_id))
  const leaves: LeaveApp[] = (leaveAll as any[]).filter(r => inPop(r.employee_id)).map(r => ({
    employee_id: r.employee_id, type: String(one<any>(r.leave_types)?.short_name || 'LV').toUpperCase(),
    from_date: r.from_date, to_date: r.to_date, days: Number(r.days) || 0, half_day: !!r.half_day,
    status: String(r.status || '').toUpperCase(), applied_at: r.applied_at, resolved_at: r.resolved_at,
  }))
  const leaveTypeName = new Map<string, string>()
  for (const r of leaveAll as any[]) { const t = one<any>(r.leave_types); if (t?.short_name) leaveTypeName.set(String(t.short_name).toUpperCase(), t.name || t.short_name) }
  const approved = leaves.filter(l => l.status === 'APPROVED')

  // ════════════════════════════════════════════════════════════════════════
  // WORKFORCE
  // ════════════════════════════════════════════════════════════════════════
  const tenure = active.filter(e => e.doj).map(e => tenureYears(e.doj as string, today))
  const genderOf = (g: string | null) => { const s = String(g || '').toLowerCase(); return s.startsWith('f') ? 'Female' : s.startsWith('m') ? 'Male' : s ? 'Other' : 'Not recorded' }
  const deptCounts = countBy(active, e => e.department_id ? dn(e.department_id) : 'Unassigned')
  const topDepts = toBuckets(deptCounts, k => k, 12)
  const genderByDepartment = topDepts.filter(b => b.key !== '__other').slice(0, 10).map(b => {
    const ppl = active.filter(e => (e.department_id ? dn(e.department_id) : 'Unassigned') === b.key)
    const g = countBy(ppl, e => genderOf(e.gender))
    return { key: b.key, label: b.label, male: g.get('Male') || 0, female: g.get('Female') || 0, other: (g.get('Other') || 0) + (g.get('Not recorded') || 0) }
  })
  const tenureCounts = countBy(tenure, y => tenureBand(y))
  const ageCounts = countBy(active.filter(e => e.dob && ageBand(e.dob, today)), e => ageBand(e.dob as string, today))
  const span = spanOfControl(active)
  const onProbation = active.filter(e => (e.confirmation || '').toLowerCase() === 'probation')
  const workforce: OrgAnalytics['workforce'] = {
    headcount: active.length,
    byCompany: toBuckets(countBy(active, e => (e.company_id && coName.get(e.company_id)) || '—')),
    byDepartment: topDepts,
    byLocation: toBuckets(countBy(active, e => (e.location_id && locName.get(e.location_id)) || 'Unassigned'), k => k, 10),
    byType: toBuckets(countBy(active, e => e.type || 'Not set')),
    byGrade: toBuckets(countBy(active, e => (e.grade || 'Not set').trim()), k => k, 10),
    gender: toBuckets(countBy(active, e => genderOf(e.gender))),
    genderByDepartment,
    age: AGE_BANDS.map(b => ({ key: b.key, label: b.label, value: ageCounts.get(b.key) || 0 })),
    tenure: TENURE_BANDS.map(b => ({ key: b.key, label: b.label, value: tenureCounts.get(b.key) || 0 })),
    avgTenure: tenure.length ? round(mean(tenure) as number, 1) : null,
    span,
    probation: {
      onProbation: onProbation.length,
      dueSoonCount: onProbation.filter(e => probationDue(e, today, 30)).length,
      overdueCount: onProbation.filter(e => probationOverdue(e, today)).length,
      // Counts drive the insight for everyone; names only for those who may see people.
      dueSoon: access.people ? onProbation.filter(e => probationDue(e, today, 30)).map(ref) : [],
      overdue: access.people ? onProbation.filter(e => probationOverdue(e, today)).map(ref) : [],
    },
    noManager: active.filter(e => !e.l1 || !allById.has(e.l1)).length,
  }

  // ════════════════════════════════════════════════════════════════════════
  // ATTRITION
  // ════════════════════════════════════════════════════════════════════════
  const trendFlow = monthlyFlow(emps, trend, today)
  const periodFlow = monthlyFlow(emps, period.months, today)
  const prevFlow = monthlyFlow(emps, prev.months, prev.to)
  const pa = periodAttrition(periodFlow)
  const pp = periodAttrition(prevFlow)
  const exits = exitedIn(emps, period.from, period.to)
  const reasonBy = new Map<string, { label: string; category: string }>((reasons as any[]).map(r => [r.code, { label: r.label, category: r.category }]))
  const resigByEmp = new Map<string, any>()
  for (const r of resig as any[]) {
    if (String(r.status).toUpperCase() === 'WITHDRAWN') continue
    resigByEmp.set(r.employee_id, r)            // latest wins (ordered by created_at)
  }
  const hrExitByEmp = new Map<string, any>()
  for (const r of hrExits as any[]) if (String(r.status).toUpperCase() === 'APPROVED') hrExitByEmp.set(r.employee_id, r)
  const kindOf = (e: EmpLite): 'Voluntary' | 'Involuntary' | 'Unclassified' => {
    if (hrExitByEmp.has(e.id)) return 'Involuntary'
    const r = resigByEmp.get(e.id)
    if (r) {
      const cat = reasonBy.get(r.reason_code)?.category
      return cat === 'EMPLOYER' ? 'Involuntary' : 'Voluntary'
    }
    const s = String(e.status || '').toLowerCase()
    if (s.startsWith('terminat') || s.startsWith('abscond')) return 'Involuntary'
    if (s === 'resigned') return 'Voluntary'
    return 'Unclassified'
  }
  const reasonOf = (e: EmpLite): { code: string; label: string; category: string } | null => {
    const h = hrExitByEmp.get(e.id)
    if (h) return { code: h.reason_code || 'HR', label: h.reason_label || reasonBy.get(h.reason_code)?.label || h.reason_code || 'Company-initiated', category: 'EMPLOYER' }
    const r = resigByEmp.get(e.id)
    if (r?.reason_code) return { code: r.reason_code, label: reasonBy.get(r.reason_code)?.label || r.reason_code, category: reasonBy.get(r.reason_code)?.category || 'OTHER' }
    return null
  }
  const reasonCount = new Map<string, { label: string; category: string; value: number }>()
  const catCount = new Map<string, number>()
  for (const e of exits) {
    const r = reasonOf(e)
    const key = r?.code || '__none'
    const cur = reasonCount.get(key) || { label: r?.label || 'Reason not recorded', category: r?.category || '—', value: 0 }
    cur.value++
    reasonCount.set(key, cur)
    const cat = r?.category ? ({ PUSH: 'Push (work)', PULL: 'Pull (opportunity)', PERSONAL: 'Personal', EMPLOYER: 'Company-initiated' } as Record<string, string>)[r.category] || r.category : 'Not recorded'
    catCount.set(cat, (catCount.get(cat) || 0) + 1)
  }
  const kinds = countBy(exits, kindOf)
  // By department NAME, like the filters and Performance: in the group view "Sales &
  // Marketing" exists once per company and is one department to the reader.
  const deptKey = (e: EmpLite) => (e.department_id ? dn(e.department_id) : 'Unassigned')
  const deptAttr = [...countBy(exits, deptKey).entries()].map(([k, n]) => {
    const members = emps.filter(e => deptKey(e) === k)
    const r = periodAttrition(monthlyFlow(members, period.months, today))
    return { key: k, label: k, exits: n, headcount: members.filter(e => onBooks(e, today)).length, rate: r.rate }
  }).sort((a, b) => b.exits - a.exits)
  const tenureAtExit = countBy(exits.filter(e => e.doj), e => tenureBand(tenureYears(e.doj as string, e.exit as string)))
  const pipeline = (resig as any[]).filter(r => {
    const e = byId.get(r.employee_id)
    const st = String(r.status).toUpperCase()
    if (!e || !OPEN_RESIGNATION.has(st)) return false
    const lwd = r.final_lwd || r.tentative_lwd || r.proposed_lwd || r.lwd_as_per_policy || e.exit
    return (!lwd || lwd >= today) && onBooks(e, today)
  })
  const leaving = new Set(pipeline.map(r => r.employee_id))

  // ── Flight risk ─────────────────────────────────────────────────────────
  const risk: RiskRow[] = []
  if (access.people) {
    const exits90 = exitedIn(emps, addDays(today, -90), today)
    const teamExits = countBy(exits90, e => e.l1 || '__none')
    const attByEmp = new Map<string, AttRec[]>()
    for (const r of att) { const l = attByEmp.get(r.employee_id) || []; l.push(r); attByEmp.set(r.employee_id, l) }
    const lateIn = (id: string, from: string, to: string) => (attByEmp.get(id) || []).filter(r => r.attendance_date >= from && r.attendance_date <= to && r.work_in && Number(r.late_minutes) > 0).length
    const lvByEmp = new Map<string, LeaveApp[]>()
    for (const l of approved) { const x = lvByEmp.get(l.employee_id) || []; x.push(l); lvByEmp.set(l.employee_id, x) }
    const ratingHistory = latestRatings(periods as any[], ratings as any[])
    const lastRevision = new Map<string, string>()
    for (const c of ctc as any[]) if (c.effective_from && (!lastRevision.get(c.employee_id) || c.effective_from > (lastRevision.get(c.employee_id) as string))) lastRevision.set(c.employee_id, c.effective_from)
    for (const e of active) {
      if (leaving.has(e.id)) continue
      const recs = attByEmp.get(e.id) || []
      const lv = lvByEmp.get(e.id) || []
      const rh = ratingHistory.get(e.id) || []
      const rev = lastRevision.get(e.id)
      const sig = riskSignals({
        managerLeaving: !!e.l1 && leaving.has(e.l1),
        teamExits90: e.l1 ? (teamExits.get(e.l1) || 0) : 0,
        rating: rh[0] || null, prevRating: rh[1] || null,
        late30: recs.length ? lateIn(e.id, addDays(today, -29), today) : 0,
        latePrev30: recs.length ? lateIn(e.id, addDays(today, -59), addDays(today, -30)) : 0,
        unplanned90: lv.filter(l => l.from_date >= addDays(today, -90) && isUnplanned(l)).length,
        bridging180: bridgeShare(lv.filter(l => l.from_date >= addDays(today, -180))).bridging,
        monthsSinceRevision: rev ? daysBetween(rev, today) / 30.44 : null,
        tenureYears: e.doj ? tenureYears(e.doj, today) : null,
        probationOverdue: probationOverdue(e, today),
      })
      const lv2 = riskLevel(sig)
      if (lv2.level !== 'low') risk.push({ ...ref(e), level: lv2.level, score: lv2.score, signals: sig })
    }
    risk.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  }

  const attrition: OrgAnalytics['attrition'] = {
    flow: trendFlow,
    exits: pa.exits,
    avgHeadcount: pa.avgHeadcount,
    rate: pa.rate,
    annualised: annualise(pa.rate, yearFraction(period)),
    prevAnnualised: annualise(pp.rate, yearFraction(prev)),
    voluntary: kinds.get('Voluntary') || 0,
    involuntary: kinds.get('Involuntary') || 0,
    unclassified: kinds.get('Unclassified') || 0,
    regretted: exits.filter(e => resigByEmp.get(e.id)?.is_regrettable === true).length,
    early90: earlyAttrition(emps, 90, today),
    early180: earlyAttrition(emps, 180, today),
    reasons: [...reasonCount.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value),
    categories: toBuckets(catCount),
    byDepartment: deptAttr,
    tenureAtExit: TENURE_BANDS.map(b => ({ key: b.key, label: b.label, value: tenureAtExit.get(b.key) || 0 })),
    pipelineCount: pipeline.length,
    pipeline: access.people ? pipeline.map(r => {
      const e = byId.get(r.employee_id) as EmpLite
      return { ...ref(e), stage: STAGE_LABEL[String(r.status).toUpperCase()] || r.status, lwd: r.final_lwd || r.tentative_lwd || r.proposed_lwd || r.lwd_as_per_policy || null, regrettable: r.is_regrettable ?? null }
    }) : [],
    recentExits: access.people ? exits.slice().sort((a, b) => String(b.exit).localeCompare(String(a.exit))).slice(0, LIST_MAX).map(e => ({
      ...ref(e), lwd: e.exit as string, reason: reasonOf(e)?.label || null,
      tenureYears: e.doj ? round(tenureYears(e.doj, e.exit as string), 1) : null, kind: kindOf(e),
    })) : [],
    risk,
  }

  // ════════════════════════════════════════════════════════════════════════
  // ATTENDANCE
  // ════════════════════════════════════════════════════════════════════════
  const attNow = att.filter(r => r.attendance_date >= attFrom && r.attendance_date <= attTo)
  const attPrev = att.filter(r => r.attendance_date >= attPrevFrom && r.attendance_date < attFrom)
  const summary = summariseAttendance(attNow, today)
  const prevSummary = summariseAttendance(attPrev, today)
  const attMonths = monthsBetween(monthOf(attFrom), monthOf(attTo))
  const monthlyAtt = attMonths.map(m => {
    const s = summariseAttendance(attNow.filter(r => r.attendance_date.startsWith(m)), today)
    return { month: m, onTimeRate: s.onTimeRate, late: s.late, punchedIn: s.punchedIn, avgHours: s.avgHours }
  })
  const deptOf = (id: string) => { const e = byId.get(id); return e?.department_id ? dn(e.department_id) : 'Unassigned' }
  const attByDept = new Map<string, AttRec[]>()
  for (const r of attNow) { const k = deptOf(r.employee_id); const l = attByDept.get(k) || []; l.push(r); attByDept.set(k, l) }
  const deptAtt = [...attByDept.entries()].map(([k, rows]) => {
    const s = summariseAttendance(rows, today)
    return { key: k, label: k, tracked: s.tracked, onTimeRate: s.onTimeRate, avgHours: s.avgHours, missPunch: s.missPunch, rows }
  }).sort((a, b) => b.tracked - a.tracked)
  const weekdayAll = lateByWeekday(attNow)
  const heat = {
    cols: weekdayAll.map(w => w.label),
    rows: deptAtt.slice(0, 10).map(d => {
      const w = lateByWeekday(d.rows)
      return { key: d.key, label: d.label, cells: weekdayAll.map(col => w.find(x => x.label === col.label)?.rate ?? null), days: weekdayAll.map(col => w.find(x => x.label === col.label)?.days ?? 0) }
    }),
  }
  const lateCount = countBy(attNow.filter(r => r.work_in && Number(r.late_minutes) > 0), r => r.employee_id)
  const inDays = countBy(attNow.filter(r => r.work_in), r => r.employee_id)
  const regList = (regs as any[]).filter(r => inPop(r.employee_id))
  const regStatus = countBy(regList, r => String(r.status).toUpperCase())
  const regDecided = (regStatus.get('APPROVED') || 0) + (regStatus.get('REJECTED') || 0)
  const attendance: OrgAnalytics['attendance'] = {
    window: { from: attFrom, to: attTo, capped: attFrom !== period.from },
    coverage: { tracked: summary.tracked, headcount: active.length },
    summary,
    prevOnTime: prevSummary.punchedIn >= 20 ? prevSummary.onTimeRate : null,
    monthly: monthlyAtt,
    weekday: weekdayAll,
    heat,
    byDepartment: deptAtt.map(d => ({ key: d.key, label: d.label, tracked: d.tracked, onTimeRate: d.onTimeRate, avgHours: d.avgHours, missPunch: d.missPunch })),
    lateList: access.people ? [...lateCount.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, LIST_MAX).map(([id, n]) => ({ ...ref(byId.get(id) as EmpLite), late: n, days: inDays.get(id) || 0 })) : [],
    regularisation: {
      total: regList.length,
      approved: regStatus.get('APPROVED') || 0,
      rejected: regStatus.get('REJECTED') || 0,
      pending: regStatus.get('PENDING') || 0,
      approvalRate: pct(regStatus.get('APPROVED') || 0, regDecided),
    },
  }

  // ════════════════════════════════════════════════════════════════════════
  // LEAVE
  // ════════════════════════════════════════════════════════════════════════
  const inPeriod = approved.filter(l => daysWithin(l, period.from, period.to) > 0)
  const typeDays = new Map<string, { days: number; spells: number }>()
  for (const l of inPeriod) {
    const cur = typeDays.get(l.type) || { days: 0, spells: 0 }
    cur.days += daysWithin(l, period.from, period.to); cur.spells++
    typeDays.set(l.type, cur)
  }
  const leaveDays = round([...typeDays.values()].reduce((s, v) => s + v.days, 0), 1)
  const unplannedDays = inPeriod.filter(isUnplanned).reduce((s, l) => s + daysWithin(l, period.from, period.to), 0)
  const leaveMonthly = period.months.map(m => {
    const from = `${m}-01`, to = addDays(addMonths(m, 1) + '-01', -1)
    let planned = 0, unplanned = 0
    for (const l of approved) { const d = daysWithin(l, from, to); if (!d) continue; if (isUnplanned(l)) unplanned += d; else planned += d }
    return { month: m, planned: round(planned, 1), unplanned: round(unplanned, 1) }
  })
  const pending = leaves.filter(l => l.status === 'PENDING')
  const pendAge = pending.map(l => (l.applied_at ? daysBetween(l.applied_at.slice(0, 10), today) : 0))
  const year = approved.filter(l => l.from_date >= addDays(today, -365))
  const brad = new Map<string, LeaveApp[]>()
  for (const l of year) { const x = brad.get(l.employee_id) || []; x.push(l); brad.set(l.employee_id, x) }
  const took90 = new Set(approved.filter(l => l.to_date >= addDays(today, -90) && l.from_date <= today).map(l => l.employee_id))
  const eligible90 = active.filter(e => e.doj && daysBetween(e.doj, today) >= 120)
  const balByEmp = new Map<string, number>()
  const balType = new Map<string, { label: string; total: number; people: Set<string> }>()
  for (const b of balances as any[]) {
    if (!activeIds.has(b.employee_id)) continue
    const t = one<any>(b.leave_types)
    const code = String(t?.short_name || '').toUpperCase()
    const avail = floorHalf(Number(b.opening || 0) + Number(b.accrued || 0) - Number(b.used || 0) - Number(b.encashed || 0))
    if (code === 'EL') balByEmp.set(b.employee_id, (balByEmp.get(b.employee_id) || 0) + avail)
    const cur = balType.get(code) || { label: t?.name || code, total: 0, people: new Set<string>() }
    cur.total += avail; cur.people.add(b.employee_id)
    balType.set(code, cur)
  }
  const noLeave = eligible90.filter(e => !took90.has(e.id))
  const leave: OrgAnalytics['leave'] = {
    days: leaveDays,
    perHead: active.length ? round(leaveDays / active.length, 2) : null,
    byType: [...typeDays.entries()].map(([k, v]) => ({ key: k, label: leaveTypeName.get(k) || k, days: round(v.days, 1), spells: v.spells })).sort((a, b) => b.days - a.days),
    monthly: leaveMonthly,
    unplannedShare: pct(unplannedDays, leaveDays),
    bridge: bridgeShare(inPeriod),
    weekdayStarts: [1, 2, 3, 4, 5, 6].map(w => ({ key: String(w), label: weekdayName(w), value: inPeriod.filter(l => new Date(l.from_date + 'T00:00:00Z').getUTCDay() === w).length })),
    pending: { count: pending.length, olderThan3: pendAge.filter(d => d > 3).length, oldestDays: pendAge.length ? Math.max(...pendAge) : null },
    bradford: access.people ? [...brad.entries()].map(([id, l]) => ({ id, ...bradford(l) })).filter(b => b.score >= 50 && byId.has(b.id))
      .sort((a, b) => b.score - a.score).slice(0, LIST_MAX).map(b => ({ ...ref(byId.get(b.id) as EmpLite), spells: b.spells, days: b.days, score: b.score })) : [],
    noLeave90: {
      count: noLeave.length, of: eligible90.length,
      people: access.people ? noLeave.map(e => ({ ...ref(e), balance: balByEmp.get(e.id) ?? null })).sort((a, b) => (b.balance ?? -1) - (a.balance ?? -1)).slice(0, LIST_MAX) : [],
    },
    balances: [...balType.entries()].map(([k, v]) => ({ key: k, label: v.label, available: round(v.total, 1), perHead: v.people.size ? round(v.total / v.people.size, 1) : null }))
      .filter(b => b.available > 0).sort((a, b) => b.available - a.available),
  }

  // ════════════════════════════════════════════════════════════════════════
  // PERFORMANCE
  // ════════════════════════════════════════════════════════════════════════
  const periodById = new Map<string, any>((periods as any[]).map(p => [p.id, p]))
  const ratingRows = (ratings as any[]).filter(r => inPop(r.employee_id))
  const cycleCodes = new Map<string, { code: string; name: string; status: string; start: string | null; end: string | null; enrolled: number }>()
  for (const r of ratingRows) {
    const p = periodById.get(r.period_id); if (!p) continue
    const cur = cycleCodes.get(p.period_code) || { code: p.period_code, name: p.period_name || p.period_code, status: p.status, start: p.period_start, end: p.period_end, enrolled: 0 }
    cur.enrolled++
    cycleCodes.set(p.period_code, cur)
  }
  const cycles = [...cycleCodes.values()].sort((a, b) => String(b.start).localeCompare(String(a.start)))
  const defaultCycle = cycles.find(c => (c.start || '') <= today) || cycles[0]
  const cycle = (q.cycle && cycleCodes.has(q.cycle) ? q.cycle : defaultCycle?.code) || null
  const cyc = cycle ? ratingRows.filter(r => periodById.get(r.period_id)?.period_code === cycle) : []
  const stageCount = countBy(cyc, r => pmsStage(r.workflow_status))
  const rated = cyc.filter(r => r.final_rating_code && RATING_VALUE[String(r.final_rating_code).toUpperCase()])
  const dist = ratingDistribution(rated.map(r => r.final_rating_code))
  const orgAvg = mean(rated.map(r => RATING_VALUE[String(r.final_rating_code).toUpperCase()]))
  const byMgr = new Map<string, number[]>()
  for (const r of rated) if (r.rm_l1_id) { const l = byMgr.get(r.rm_l1_id) || []; l.push(RATING_VALUE[String(r.final_rating_code).toUpperCase()]); byMgr.set(r.rm_l1_id, l) }
  const deptRated = new Map<string, any[]>()
  // Grouped by department NAME, as everywhere else: each company has its own "IT".
  for (const r of rated) { const k = dn(r.department_id || byId.get(r.employee_id)?.department_id || null); const l = deptRated.get(k) || []; l.push(r); deptRated.set(k, l) }
  const cycPeriodIds = new Set(cyc.map(r => r.period_id))
  const [pips, recs] = await Promise.all([
    soft(inChunks<any>(ids, c => sb.from('pms_pip').select('employee_id, status').in('employee_id', c).order('employee_id') as any, 'pip')),
    soft(inChunks<any>([...cycPeriodIds], c => sb.from('pms_training_recommendation').select('employee_id, kind, category, hr_status').in('period_id', c).order('employee_id') as any, 'training')),
  ])
  const recsPop = (recs as any[]).filter(r => inPop(r.employee_id))
  const performance: OrgAnalytics['performance'] = {
    cycles,
    cycle,
    enrolled: cyc.length,
    stages: PMS_STAGES.map(s => ({ key: s.key, label: s.label, value: stageCount.get(s.key) || 0 })),
    completion: pct((stageCount.get('final') || 0) + (stageCount.get('published') || 0), cyc.length),
    rated: rated.length,
    distribution: dist,
    topShare: pct(dist[0].value + dist[1].value, rated.length),
    avgGap: (() => { const g = rated.map(r => Number(r.self_vs_final_gap)).filter(Number.isFinite); return g.length ? round(mean(g) as number, 2) : null })(),
    byDepartment: [...deptRated.entries()].map(([k, rows]) => {
      const d = ratingDistribution(rows.map(r => r.final_rating_code))
      return { key: k, label: k, rated: rows.length, avg: round(mean(rows.map(r => RATING_VALUE[String(r.final_rating_code).toUpperCase()])) as number, 2), dist: d.map(x => x.value) }
    }).sort((a, b) => b.rated - a.rated),
    managerSkew: access.people && orgAvg != null ? [...byMgr.entries()].filter(([, v]) => v.length >= 3).map(([id, v]) => {
      const m = allById.get(id)
      const avg = round(mean(v) as number, 2)
      return { id, code: m?.code ?? null, name: m?.name || 'Unknown manager', designation: m?.designation ?? null, department: m?.department_id ? dn(m.department_id) : null, rated: v.length, avg, diff: round(avg - orgAvg, 2) }
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)) : [],
    pip: {
      active: (pips as any[]).filter(p => inPop(p.employee_id) && ['ACTIVE', 'UNDER_REVIEW'].includes(String(p.status).toUpperCase())).length,
      requested: (pips as any[]).filter(p => inPop(p.employee_id) && String(p.status).toUpperCase() === 'REQUESTED').length,
    },
    recognitions: recsPop.filter(r => String(r.kind).toUpperCase() === 'RECOGNITION').length,
    trainingAsks: toBuckets(countBy(recsPop.filter(r => String(r.kind).toUpperCase() !== 'RECOGNITION'), r => titleCase(r.category || 'Other'))),
  }

  // ════════════════════════════════════════════════════════════════════════
  // LEARNING
  // ════════════════════════════════════════════════════════════════════════
  const lrn = (learners as any[]).filter(l => l.employee_id && inPop(l.employee_id))
  const learnerEmp = new Map<string, string>(lrn.map(l => [l.id, l.employee_id]))
  const enr = learnerEmp.size ? await soft(inChunks<any>([...learnerEmp.keys()], c => sb.from('lms_enrollments').select('learner_id, status, mandatory, due_at, score_pct').in('learner_id', c).order('learner_id') as any, 'enrolments')) : []
  const live = (enr as any[]).filter(e => !['CANCELLED', 'WAIVED', 'REJECTED', 'PENDING_APPROVAL'].includes(String(e.status).toUpperCase()))
  const isDone = (e: any) => String(e.status).toUpperCase() === 'COMPLETED'
  const isOverdue = (e: any) => !isDone(e) && e.due_at && String(e.due_at).slice(0, 10) < today
  const mand = live.filter(e => e.mandatory)
  const lByDept = new Map<string, any[]>()
  for (const e of live) { const emp = byId.get(learnerEmp.get(e.learner_id) as string); const k = emp?.department_id ? dn(emp.department_id) : 'Unassigned'; const l = lByDept.get(k) || []; l.push(e); lByDept.set(k, l) }
  const scores = live.map(e => Number(e.score_pct)).filter(x => Number.isFinite(x) && x > 0)
  const learning: OrgAnalytics['learning'] = {
    enrolments: live.length,
    completed: live.filter(isDone).length,
    inProgress: live.filter(e => String(e.status).toUpperCase() === 'IN_PROGRESS').length,
    notStarted: live.filter(e => String(e.status).toUpperCase() === 'NOT_STARTED').length,
    overdue: live.filter(isOverdue).length,
    completion: pct(live.filter(isDone).length, live.length),
    mandatoryCompletion: pct(mand.filter(isDone).length, mand.length),
    avgScore: scores.length ? round(mean(scores) as number, 1) : null,
    byDepartment: [...lByDept.entries()].map(([k, l]) => ({ key: k, label: k, enrolments: l.length, completion: pct(l.filter(isDone).length, l.length), overdue: l.filter(isOverdue).length })).sort((a, b) => b.enrolments - a.enrolments),
  }

  // ════════════════════════════════════════════════════════════════════════
  // HIRING
  // ════════════════════════════════════════════════════════════════════════
  const mrfIn = (mrfs as any[]).filter(m => allows(lim?.departments, dn(m.department_id)) && allows(lim?.locations, ln(m.location_id)) && (!q.department || dn(m.department_id) === q.department) && (!q.location || ln(m.location_id) === q.location))
  const mrfIds = new Set(mrfIn.map(m => m.id))
  const openMrfs = mrfIn.filter(m => String(m.status).toUpperCase() === 'APPROVED')
  const ageOf = (m: any) => daysBetween(String(m.approved_at || m.created_at).slice(0, 10), today)
  const ageBandOf = (d: number) => (d <= 30 ? '0–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : '90+ days')
  const ageCount = countBy(openMrfs, m => ageBandOf(ageOf(m)))
  const candIn = (cands as any[]).filter(c => (!q.department && !q.location && !lim?.departments && !lim?.locations) || (c.mrf_id && mrfIds.has(c.mrf_id)))
  const candPeriod = candIn.filter(c => String(c.applied_date || c.created_at).slice(0, 10) >= period.from && String(c.applied_date || c.created_at).slice(0, 10) <= period.to)
  const offerMade = (c: any) => !!c.offer_sent_at || ['offer sent', 'joined'].includes(String(c.stage).toLowerCase()) || !!c.offer_response
  const srcMap = new Map<string, { candidates: number; offers: number }>()
  for (const c of candPeriod) { const k = c.source || 'Not recorded'; const cur = srcMap.get(k) || { candidates: 0, offers: 0 }; cur.candidates++; if (offerMade(c)) cur.offers++; srcMap.set(k, cur) }
  const offers = candPeriod.filter(offerMade)
  const resp = countBy(offers, c => String(c.offer_response || 'PENDING').toUpperCase())
  const decided = (resp.get('ACCEPTED') || 0) + (resp.get('BACKOUT') || 0) + (resp.get('DECLINED') || 0)
  const tto = candPeriod.filter(c => c.offer_sent_at).map(c => daysBetween(String(c.applied_date || c.created_at).slice(0, 10), String(c.offer_sent_at).slice(0, 10))).filter(d => d >= 0)
  const hiring: OrgAnalytics['hiring'] = {
    openMrfs: openMrfs.length,
    openPositions: openMrfs.reduce((s, m) => s + (Number(m.no_of_openings ?? m.openings) || 1), 0),
    mrfAge: ['0–30 days', '31–60 days', '61–90 days', '90+ days'].map(k => ({ key: k, label: k, value: ageCount.get(k) || 0 })),
    oldestMrfs: openMrfs.map(m => ({ id: m.id, number: m.mrf_number, title: m.job_title || m.position || m.designation || 'Untitled role', days: ageOf(m), openings: Number(m.no_of_openings ?? m.openings) || 1, department: m.department_id ? dn(m.department_id) : null }))
      .sort((a, b) => b.days - a.days).slice(0, 8),
    funnel: withAccepted(funnelCounts(candPeriod.map(c => c.stage)), candPeriod),
    candidates: candPeriod.length,
    rejected: candPeriod.filter(c => String(c.stage).toLowerCase() === 'rejected').length,
    sources: [...srcMap.entries()].map(([k, v]) => ({ key: k, label: k, candidates: v.candidates, offers: v.offers, rate: pct(v.offers, v.candidates) })).sort((a, b) => b.candidates - a.candidates),
    offers: { made: offers.length, accepted: resp.get('ACCEPTED') || 0, backout: resp.get('BACKOUT') || 0, declined: resp.get('DECLINED') || 0, acceptance: pct(resp.get('ACCEPTED') || 0, decided) },
    timeToOffer: median(tto),
    joiningSoon: (joiners as any[]).filter(j => !['REJECTED', 'CANCELLED'].includes(String(j.status).toUpperCase()) &&
      (allows(lim?.departments, dn(j.department_id)) || allows(lim?.departments, j.department)) && allows(lim?.locations, ln(j.location_id)) && (!q.department || dn(j.department_id) === q.department || j.department === q.department) && (!q.location || ln(j.location_id) === q.location))
      .map(j => ({ name: access.people ? j.full_name : 'New joiner', designation: j.designation, doj: j.date_of_joining, department: j.department_id ? dn(j.department_id) : (j.department || null) })),
    monthlyApplicants: trend.map(m => ({ month: m, value: candIn.filter(c => String(c.applied_date || c.created_at).slice(0, 7) === m).length })),
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAY & COST
  // ════════════════════════════════════════════════════════════════════════
  const cost = access.cost ? await costSection(companyIds, emps, byId, inPop, dn, ctc as any[], fy, today) : null

  // ════════════════════════════════════════════════════════════════════════
  // WHAT MOVED — month against month, by group (the briefing and "Why?")
  // ════════════════════════════════════════════════════════════════════════
  const mrfDept = new Map<string, string>(mrfIn.map(m => [m.id, m.department_id ? dn(m.department_id) : 'Unassigned']))
  const moverInput: MoverInput = {
    today, emps, att, approved,
    candidates: candIn.map(c => ({
      applied: String(c.applied_date || c.created_at || '').slice(0, 10),
      offered: c.offer_sent_at ? String(c.offer_sent_at).slice(0, 10) : null,
      source: c.source || null,
      department: c.mrf_id ? mrfDept.get(c.mrf_id) || null : null,
    })),
    runs: cost?.runs.map(r => ({ month: r.month, cost: r.cost, employees: r.employees })) || null,
    dept: e => (e.department_id ? dn(e.department_id) : 'Unassigned'),
    loc: e => ln(e.location_id),
    reason: e => reasonOf(e)?.label || 'Not recorded',
    kind: e => kindOf(e),
    leaveType: code => leaveTypeName.get(code) || code,
  }
  const movers = { mtd: computeMovers(moverInput, 'mtd'), last: computeMovers(moverInput, 'last') }

  // ════════════════════════════════════════════════════════════════════════
  // PULSE
  // ════════════════════════════════════════════════════════════════════════
  const thisM = monthOf(today), lastM = addMonths(thisM, -1)
  const tf = (m: string) => trendFlow.find(f => f.month === m)
  const sparkHead = trendFlow.map(f => f.closing)
  const sparkAttr = trendFlow.map(f => f.attrition)
  const hcPrev = headcountOn(emps, addDays(period.from, -1))
  const kpis: Kpi[] = [
    { key: 'headcount', label: 'Headcount', value: active.length, fmt: 'count', prev: hcPrev, good: 'neutral', sub: 'on the books today · Δ vs start of period', def: 'Employees who have joined and not yet reached their last working day.', spark: sparkHead },
    { key: 'joiners', label: 'Joiners', value: joinedIn(emps, period.from, period.to).length, fmt: 'count', prev: joinedIn(emps, prev.from, prev.to).length, good: 'up', sub: period.label.toLowerCase(), spark: trendFlow.map(f => f.joiners) },
    { key: 'exits', label: 'Exits', value: pa.exits, fmt: 'count', prev: pp.exits, good: 'down', sub: period.label.toLowerCase(), spark: trendFlow.map(f => f.exits) },
    { key: 'attrition', label: 'Attrition (annualised)', value: attrition.annualised, fmt: 'pct', prev: attrition.prevAnnualised, good: 'down', sub: `${pa.exits} exits on ${Math.round(pa.avgHeadcount)} avg. headcount`, def: 'Exits ÷ average headcount, scaled to a full year. Average headcount is the mean of each month\'s (opening + closing) ÷ 2.', spark: sparkAttr },
    { key: 'ontime', label: 'On-time punch-ins', value: summary.onTimeRate, fmt: 'pct', prev: attendance.prevOnTime, good: 'up', sub: summary.tracked ? `${summary.tracked} people tracked` : 'no punches in this window', def: 'Punch-ins with no late minutes ÷ all punch-ins, over the attendance window.' },
    { key: 'leave', label: 'Leave days / person', value: leave.perHead, fmt: 'days', good: 'neutral', sub: `${leaveDays} approved days`, def: 'Approved leave days that fall in the period ÷ current headcount.' },
    { key: 'open', label: 'Open positions', value: hiring.openPositions, fmt: 'count', good: 'neutral', sub: `${hiring.openMrfs} approved MRFs` },
    ...(cost?.latest ? [{ key: 'cost', label: 'Monthly payroll cost', value: cost.latest.costToCompany, fmt: 'money' as const, prev: cost.runs.length >= 2 ? cost.runs[cost.runs.length - 2].cost : null, good: 'neutral' as const, sub: `${monthName(cost.latest.month)} · gross + employer statutory`, def: 'Gross earnings plus employer PF, ESIC and gratuity provision for the latest payroll month.', spark: cost.runs.map(r => r.cost) }] : []),
    { key: 'pms', label: 'Reviews complete', value: performance.completion, fmt: 'pct', good: 'up', sub: cycle ? `${cycle} · ${performance.enrolled} enrolled` : 'no cycle running' },
  ]
  const changes: Change[] = [
    { key: 'headcount', label: 'Headcount', now: tf(thisM)?.closing ?? null, before: tf(lastM)?.closing ?? null, fmt: 'count', good: 'neutral' },
    { key: 'joiners', label: 'Joiners', now: tf(thisM)?.joiners ?? null, before: tf(lastM)?.joiners ?? null, fmt: 'count', good: 'up' },
    { key: 'exits', label: 'Exits', now: tf(thisM)?.exits ?? null, before: tf(lastM)?.exits ?? null, fmt: 'count', good: 'down' },
    ...monthPair(att, thisM, lastM, today),
    { key: 'leave', label: 'Leave days', now: round(approved.reduce((s, l) => s + daysWithin(l, `${thisM}-01`, today), 0), 1), before: round(approved.reduce((s, l) => s + daysWithin(l, `${lastM}-01`, addDays(`${thisM}-01`, -1)), 0), 1), fmt: 'days', good: 'neutral' },
    { key: 'applicants', label: 'Applicants', now: hiring.monthlyApplicants.find(x => x.month === thisM)?.value ?? null, before: hiring.monthlyApplicants.find(x => x.month === lastM)?.value ?? null, fmt: 'count', good: 'up' },
  ]

  const base = {
    generatedAt: new Date().toISOString(),
    scope: {
      company: pinned, companyLabel, department: q.department || null, location: q.location || null, type: q.type || null,
      period: { key: period.key, label: period.label, from: period.from, to: period.to, months: period.months },
      previous: { from: prev.from, to: prev.to },
      trend, today,
    },
    filters: {
      companies: companiesOk.map(c => ({ id: c.id, label: c.name })),
      departments: uniqueNames(deptRows.map(d => d.dept_name)).filter(o => allows(lim?.departments, o.label)),
      locations: uniqueNames(locRows.map(l => l.location_name)).filter(o => allows(lim?.locations, o.label)),
      types,
      canPickGroup: group,
      groupLabel,
    },
    access: {
      ...access,
      ...('via' in acc ? { via: acc.via, export: acc.export, tabs: [...acc.tabs], until: acc.until } : {}),
      limitLabel: limitLabel(lim && { ...lim, companies: lim.companies && someCompanies ? lim.companies : null }, id => coName.get(id)),
    },
    workforce, attrition, attendance, leave, performance, learning, hiring, cost, movers,
  }
  const insights = orgInsights(base)
  return { ...base, pulse: { kpis, insights, changes, flow: trendFlow } }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function monthPair(att: AttRec[], thisM: string, lastM: string, today: string): Change[] {
  const a = summariseAttendance(att.filter(r => r.attendance_date.startsWith(thisM)), today)
  const b = summariseAttendance(att.filter(r => r.attendance_date.startsWith(lastM)), today)
  return [{ key: 'ontime', label: 'On-time punch-ins', now: a.punchedIn ? a.onTimeRate : null, before: b.punchedIn ? b.onTimeRate : null, fmt: 'pct', good: 'up' }]
}

/** "Offer accepted" between Offer sent and Joined. The stage column stops at Offer Sent
 *  for people who accepted and moved on to onboarding, so without this step the funnel
 *  would read as if every offer were lost. */
function withAccepted(f: { key: string; label: string; value: number; conversion: number | null }[], cands: any[]) {
  const at = f.findIndex(x => x.key === 'joined')
  if (at < 0) return f
  const joined = f[at].value
  const accepted = Math.max(joined, cands.filter(c => String(c.offer_response || '').toUpperCase() === 'ACCEPTED' || String(c.stage).toLowerCase() === 'joined').length)
  // Never wider than the step above it: the funnel only narrows.
  const out = [...f.slice(0, at), { key: 'accepted', label: 'Offer accepted', value: Math.min(accepted, f[at - 1]?.value ?? accepted), conversion: null }, f[at]]
  return out.map((x, i) => ({ ...x, conversion: i === 0 ? null : pct(x.value, out[i - 1].value) }))
}

const uniqueNames = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)).map(x => ({ id: x, label: x }))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const titleCase = (s: string) => String(s).toLowerCase().replace(/(^|[\s_])\w/g, m => m.toUpperCase()).replace(/_/g, ' ')

/** Latest two finalised rating codes per employee, newest first. */
function latestRatings(periods: any[], ratings: any[]): Map<string, string[]> {
  const start = new Map<string, string>(periods.map(p => [p.id, p.period_start || '']))
  const rows = ratings.filter(r => r.final_rating_code && RATING_VALUE[String(r.final_rating_code).toUpperCase()])
    .sort((a, b) => String(start.get(b.period_id)).localeCompare(String(start.get(a.period_id))))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const l = out.get(r.employee_id) || []
    if (l.length < 2) l.push(String(r.final_rating_code).toUpperCase())
    out.set(r.employee_id, l)
  }
  return out
}

async function costSection(
  companyIds: string[], emps: EmpLite[], byId: Map<string, EmpLite>, inPop: (id: string) => boolean,
  dn: (id: string | null) => string, ctcRows: any[], fy: string, today: string,
): Promise<NonNullable<OrgAnalytics['cost']>> {
  const runs = await soft(all<any>(() => sb.from('payroll_runs').select('id, company_id, fy, month, status, run_type').in('company_id', companyIds).order('fy').order('month') as any, 'payroll runs'))
  const live = (runs as any[]).filter(r => String(r.status).toUpperCase() !== 'CANCELLED')
  const runMonth = new Map<string, string>()
  for (const r of live) { const m = fiscalToMonth(r.fy, Number(r.month)); if (m) runMonth.set(r.id, m) }
  const recent = [...new Set([...runMonth.values()])].sort().slice(-12)
  const runIds = live.filter(r => recent.includes(runMonth.get(r.id) as string)).map(r => r.id)
  const lines = runIds.length ? await soft(inChunks<any>(runIds, c => sb.from('payroll_lines')
    .select('employee_id, run_id, gross_earning, net_pay, employer_pf, employer_esic, gratuity, total_deductions, basic, hra, conveyance, special_allow, statutory_bonus, other_earnings, flexi_reimbursement, ded_epf, ded_vpf, ded_nps, ded_esic, ded_pt, ded_lwf, ded_tds, ded_loan_emi')
    .in('run_id', c).order('employee_id') as any, 'payroll lines')) : []
  const pop = (lines as any[]).filter(l => inPop(l.employee_id))
  const status = new Map<string, string>()
  for (const r of live) { const m = runMonth.get(r.id); if (m) status.set(m, worstStatus(status.get(m), r.status)) }
  const n = (x: unknown) => Number(x) || 0
  const byMonth = new Map<string, any[]>()
  for (const l of pop) { const m = runMonth.get(l.run_id); if (!m) continue; const x = byMonth.get(m) || []; x.push(l); byMonth.set(m, x) }
  const runsOut = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, ls]) => ({
    month: m, gross: Math.round(ls.reduce((s, l) => s + n(l.gross_earning), 0)), net: Math.round(ls.reduce((s, l) => s + n(l.net_pay), 0)),
    cost: Math.round(ls.reduce((s, l) => s + n(l.gross_earning) + n(l.employer_pf) + n(l.employer_esic) + n(l.gratuity), 0)),
    employees: new Set(ls.map(l => l.employee_id)).size, status: status.get(m) || '',
  }))
  let latest: NonNullable<OrgAnalytics['cost']>['latest'] = null
  if (runsOut.length) {
    const m = runsOut[runsOut.length - 1].month
    const ls = byMonth.get(m) as any[]
    const sum = (k: string) => Math.round(ls.reduce((s, l) => s + n(l[k]), 0))
    const gross = sum('gross_earning'), employerStatutory = sum('employer_pf') + sum('employer_esic') + sum('gratuity')
    const lmRunIds = live.filter(r => runMonth.get(r.id) === m).map(r => r.id)
    const snap = await soft(inChunks<any>(lmRunIds, c => sb.from('payroll_employee_snapshot').select('employee_id, department').in('run_id', c).order('employee_id') as any, 'snapshot'))
    const deptByEmp = new Map<string, string>((snap as any[]).map(s => [s.employee_id, s.department]))
    const dep = new Map<string, { gross: number; employees: number }>()
    for (const l of ls) {
      const k = deptByEmp.get(l.employee_id) || (byId.get(l.employee_id)?.department_id ? dn(byId.get(l.employee_id)!.department_id) : 'Unassigned')
      const cur = dep.get(k) || { gross: 0, employees: 0 }
      cur.gross += n(l.gross_earning); cur.employees++
      dep.set(k, cur)
    }
    const employees = new Set(ls.map(l => l.employee_id)).size
    const bucket = (key: string, label: string, value: number): Bucket => ({ key, label, value })
    latest = {
      month: m, status: status.get(m) || '', employees, gross, net: sum('net_pay'), employerStatutory,
      costToCompany: gross + employerStatutory,
      perHead: employees ? Math.round((gross + employerStatutory) / employees) : null,
      earnings: [
        bucket('basic', 'Basic', sum('basic')), bucket('hra', 'HRA', sum('hra')), bucket('special', 'Special allowance', sum('special_allow')),
        bucket('conveyance', 'Conveyance', sum('conveyance')), bucket('bonus', 'Statutory bonus', sum('statutory_bonus')),
        bucket('other', 'Other earnings', sum('other_earnings') + sum('flexi_reimbursement')),
      ].filter(b => b.value > 0),
      employer: [bucket('pf', 'Employer PF', sum('employer_pf')), bucket('esic', 'Employer ESIC', sum('employer_esic')), bucket('gratuity', 'Gratuity provision', sum('gratuity'))].filter(b => b.value > 0),
      deductions: [
        bucket('tds', 'Income tax (TDS)', sum('ded_tds')), bucket('pf', 'Employee PF + VPF', sum('ded_epf') + sum('ded_vpf')), bucket('nps', 'NPS', sum('ded_nps')),
        bucket('esic', 'Employee ESIC', sum('ded_esic')), bucket('pt', 'Professional tax', sum('ded_pt')), bucket('lwf', 'LWF', sum('ded_lwf')), bucket('loan', 'Loan EMI', sum('ded_loan_emi')),
      ].filter(b => b.value > 0),
      byDepartment: [...dep.entries()].map(([k, v]) => ({ key: k, label: k, gross: Math.round(v.gross), employees: v.employees })).sort((a, b) => b.gross - a.gross),
    }
  }

  // CTC — the current FY's active row per person, else their latest.
  const best = new Map<string, any>()
  for (const r of ctcRows) {
    if (!inPop(r.employee_id) || !(Number(r.annual_ctc) > 0)) continue
    const e = byId.get(r.employee_id)
    if (!e || !onBooks(e, today)) continue
    const cur = best.get(r.employee_id)
    const score = (x: any) => (x.fy === fy ? 2 : 0) + (String(x.status).toUpperCase() === 'ACTIVE' ? 1 : 0)
    if (!cur || score(r) > score(cur) || (score(r) === score(cur) && String(r.fy) > String(cur.fy))) best.set(r.employee_id, r)
  }
  const ctcs = [...best.values()].map(r => ({ e: byId.get(r.employee_id) as EmpLite, ctc: Number(r.annual_ctc) }))
  const group = <K extends string>(key: (x: { e: EmpLite; ctc: number }) => K) => {
    const m = new Map<K, number[]>()
    for (const x of ctcs) { const k = key(x); const l = m.get(k) || []; l.push(x.ctc); m.set(k, l) }
    return m
  }
  const g = (s: string | null) => { const v = String(s || '').toLowerCase(); return v.startsWith('f') ? 'F' : v.startsWith('m') ? 'M' : '' }
  const byGrade = group(x => (x.e.grade || 'Not set').trim())
  const genderRatio = [...byGrade.keys()].map(k => {
    const ppl = ctcs.filter(x => (x.e.grade || 'Not set').trim() === k)
    const f = ppl.filter(x => g(x.e.gender) === 'F').map(x => x.ctc), m = ppl.filter(x => g(x.e.gender) === 'M').map(x => x.ctc)
    const ok = f.length >= 5 && m.length >= 5
    return { key: k, label: k, female: f.length, male: m.length, ratio: ok ? round((median(f) as number) / (median(m) as number), 3) : null }
  }).filter(r => r.female + r.male > 0).sort((a, b) => a.label.localeCompare(b.label))
  return {
    runs: runsOut,
    latest,
    ctc: {
      employees: ctcs.length,
      total: Math.round(ctcs.reduce((s, x) => s + x.ctc, 0)),
      median: median(ctcs.map(x => x.ctc)),
      byGrade: [...byGrade.entries()].map(([k, v]) => ({ key: k, label: k, n: v.length, median: v.length >= 3 ? median(v) : null })).sort((a, b) => a.label.localeCompare(b.label)),
      byDepartment: [...group(x => (x.e.department_id ? dn(x.e.department_id) : 'Unassigned')).entries()].map(([k, v]) => ({ key: k, label: k, n: v.length, total: Math.round(v.reduce((s, x) => s + x, 0)), median: v.length >= 3 ? median(v) : null })).sort((a, b) => b.total - a.total),
      genderRatio,
    },
  }
}

const ORDER = ['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED']
/** A group month is several company runs; it is only as far along as its slowest. */
function worstStatus(a: string | undefined, b: string): string {
  if (!a) return String(b).toUpperCase()
  return ORDER.indexOf(a) <= ORDER.indexOf(String(b).toUpperCase()) ? a : String(b).toUpperCase()
}
