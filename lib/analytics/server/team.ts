// lib/analytics/server/team.ts — a manager's view of their own people.
//
// Scope comes from the reporting line, never from a request: TEAM is everyone whose
// L1 is the caller (ess_scope_employee_ids, the same function the team roster uses);
// DEPT is the departments the caller heads. Nothing here reaches beyond those people.
//
// What a manager can act on this week is the point: who is in, who is out, whose
// approvals are waiting, who has not had a break, and which of their people show
// several warning signs at once — each with its reasons.

import { addDays, daysBetween, istToday, monthOf, monthStart, monthEnd } from '../period.ts'
import { tenureYears, probationOverdue, probationDue, isUnplanned, bridgeShare, ratingDistribution, pmsStage, RATING_VALUE, pct, round, clock, mean, type LeaveApp } from '../metrics.ts'
import { tallyDays } from '../days.ts'
import { riskSignals, riskLevel } from '../risk.ts'
import type { TeamAnalytics, TeamMember, Insight, RiskRow } from '../types.ts'
import { sb, all, inChunks, soft, EMP_COLS, toEmp, floorHalf, leaveYear, one, OPEN_RESIGNATION } from './db.ts'
import { calendarFor, pool } from './calendar.ts'

const MAX_MEMBERS = 80

export async function teamAnalytics(managerId: string, managerName: string, scope: 'TEAM' | 'DEPT', companyId: string | null): Promise<TeamAnalytics> {
  const today = istToday()
  const month = monthOf(today)
  const from = monthStart(month), to = monthEnd(month)

  const { data: idRows, error } = await sb.rpc('ess_scope_employee_ids', { p_employee_id: managerId, p_scope: scope })
  if (error) throw new Error(error.message)
  const ids = ((idRows || []) as any[]).map(x => (typeof x === 'string' ? x : x.ess_scope_employee_ids)).filter((x: string) => x && x !== managerId)

  const empRows = ids.length ? await inChunks<any>(ids, c => sb.from('employees').select(EMP_COLS + ', departments!employees_department_id_fkey(dept_name)').in('id', c).order('id') as any, 'team') : []
  const emps = empRows.filter(r => r.is_test !== true).map(r => ({ ...toEmp(r), deptName: one<any>(r.departments)?.dept_name || null }))
    .filter(e => !e.exit || e.exit > today)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_MEMBERS)
  const memberIds = emps.map(e => e.id)

  const empty: TeamAnalytics = {
    generatedAt: new Date().toISOString(), scope, manager: { id: managerId, name: managerName }, month, dates: [], members: [],
    today: { present: 0, late: 0, onLeave: 0, notIn: 0, off: false }, outThisWeek: [],
    health: { score: null, parts: [] }, approvals: { leave: 0, regularisation: 0, oldestDays: null },
    performance: { cycle: null, distribution: [], awaitingYou: 0, companyTopShare: null, teamTopShare: null },
    signals: [], upcoming: [], insights: [],
  }

  const [att, lvs, bal, resig, pendLeave, pendReg, periods, ctc] = await Promise.all([
    memberIds.length ? inChunks<any>(memberIds, c => sb.from('attendance_records').select('employee_id, attendance_date, work_in, work_out, total_minutes, late_minutes, status').in('employee_id', c).gte('attendance_date', [addDays(today, -59), from].sort()[0]).lte('attendance_date', to).order('attendance_date') as any, 'attendance') : [],
    memberIds.length ? inChunks<any>(memberIds, c => sb.from('leave_applications').select('employee_id, from_date, to_date, days, half_day, status, applied_at, resolved_at, leave_types(short_name, name)').in('employee_id', c).in('status', ['APPROVED', 'PENDING']).gte('to_date', addDays(today, -365)).order('from_date') as any, 'leave') : [],
    memberIds.length ? soft(inChunks<any>(memberIds, c => sb.from('leave_balances').select('employee_id, opening, accrued, used, encashed, leave_types(short_name)').eq('year', leaveYear(today)).in('employee_id', c).order('employee_id') as any, 'balances')) : [],
    memberIds.length ? soft(inChunks<any>(memberIds, c => sb.from('employee_resignation').select('employee_id, status').in('employee_id', c).order('created_at') as any, 'resignations')) : [],
    soft(all<any>(() => sb.from('leave_applications').select('applied_at').eq('status', 'PENDING').eq('current_approver_id', managerId).order('applied_at') as any, 'pending leave')),
    soft(all<any>(() => sb.from('attendance_regularisation').select('created_at').eq('status', 'PENDING').eq('current_approver_id', managerId).order('created_at') as any, 'pending regularisation')),
    companyId ? soft(all<any>(() => sb.from('pms_periods').select('id, period_code, period_name, period_start').eq('company_id', companyId).order('period_start') as any, 'periods')) : Promise.resolve([] as any[]),
    memberIds.length ? soft(inChunks<any>(memberIds, c => sb.from('ctc_master').select('employee_id, effective_from').in('employee_id', c).order('employee_id') as any, 'ctc')) : [],
  ])
  if (!emps.length) return empty

  // People who left this team in the last year: for TEAM, anyone whose L1 was the caller;
  // for DEPT, anyone in the departments the caller heads.
  const deptIds = [...new Set(emps.map(e => e.department_id).filter(Boolean) as string[])]
  const exitsYear = await soft(all<any>(() => {
    const q = sb.from('employees').select('id, date_of_leaving, last_working_date, relieving_date, is_test')
    return (scope === 'DEPT' && deptIds.length ? q.in('department_id', deptIds) : q.eq('l1_manager_id', managerId))
      .not('employment_status', 'eq', 'Active').order('id') as any
  }, 'team exits'))

  const leaves: (LeaveApp & { name: string })[] = (lvs as any[]).map(r => ({
    employee_id: r.employee_id, type: String(one<any>(r.leave_types)?.short_name || 'LV').toUpperCase(), name: one<any>(r.leave_types)?.name || 'Leave',
    from_date: r.from_date, to_date: r.to_date, days: Number(r.days) || 0, half_day: !!r.half_day,
    status: String(r.status).toUpperCase(), applied_at: r.applied_at, resolved_at: r.resolved_at,
  }))
  const approved = leaves.filter(l => l.status === 'APPROVED')
  const attBy = groupBy(att as any[], r => r.employee_id)
  const lvBy = groupBy(approved, l => l.employee_id)
  const onNotice = new Set((resig as any[]).filter(r => OPEN_RESIGNATION.has(String(r.status).toUpperCase())).map(r => r.employee_id))
  const balBy = new Map<string, number>()
  for (const b of bal as any[]) {
    const code = String(one<any>(b.leave_types)?.short_name || '').toUpperCase()
    if (code !== 'EL') continue   // PL here is Paternity Leave, not Privilege Leave
    balBy.set(b.employee_id, (balBy.get(b.employee_id) || 0) + floorHalf(Number(b.opening || 0) + Number(b.accrued || 0) - Number(b.used || 0) - Number(b.encashed || 0)))
  }

  // ── PMS: the current cycle for this company, and the last two ratings per person ──
  const ratingRows = await soft(inChunks<any>(memberIds, c => sb.from('pms_overall_rating').select('period_id, employee_id, workflow_status, final_rating_code, rm_l1_id, rm_l2_id').in('employee_id', c).order('id') as any, 'ratings'))
  const startOf = new Map<string, string>((periods as any[]).map(p => [p.id, p.period_start || '']))
  const ratingsBy = groupBy((ratingRows as any[]).filter(r => r.final_rating_code && RATING_VALUE[String(r.final_rating_code).toUpperCase()])
    .sort((a, b) => String(startOf.get(b.period_id)).localeCompare(String(startOf.get(a.period_id)))), r => r.employee_id)
  // The cycle in progress: the latest one that has started AND enrols this team. A quarter
  // that is scheduled but not yet populated is not "current" for anyone in it.
  const enrolled = new Set((ratingRows as any[]).map(r => r.period_id))
  const started = (periods as any[]).filter(p => (p.period_start || '') <= today)
  const current = [...started].reverse().find(p => enrolled.has(p.id)) || null
  const currentRows = current ? (ratingRows as any[]).filter(r => r.period_id === current.id) : []
  const curBy = new Map<string, any>(currentRows.map(r => [r.employee_id, r]))

  // ── Each member's month, resolved day by day ──
  const cal = await pool(emps, 6, e => calendarFor(e.id, e.doj, from, to, today,
    (attBy.get(e.id) || []).filter((r: any) => r.attendance_date >= from),
    (lvBy.get(e.id) || []).map(l => ({ from_date: l.from_date, to_date: l.to_date, half_day: l.half_day }))))
  const dates = cal[0]?.map(d => d.date) || []

  const members: TeamMember[] = emps.map((e, i) => {
    const days = cal[i]
    const upto = days.filter(d => d.date <= today)
    const t = tallyDays(upto)
    const todayDay = days.find(d => d.date === today)
    const lv = lvBy.get(e.id) || []
    const took = lv.filter(l => l.to_date >= addDays(today, -90) && l.from_date <= today)
    const last = lv.filter(l => l.from_date <= today).map(l => l.to_date < today ? l.to_date : today).sort().pop() || null
    const rh = ratingsBy.get(e.id) || []
    const cur = curBy.get(e.id)
    return {
      id: e.id, code: e.code, name: e.name, designation: e.designation, department: e.deptName,
      doj: e.doj,
      today: todayDay?.kind || 'UPCOMING',
      todayIn: todayDay?.rec?.work_in ? clock(minutesIst(todayDay.rec.work_in)) : null,
      month: { present: t.present, late: t.late, absent: t.absent, leave: t.leave, miss: t.miss, workdays: t.workdays, avgIn: t.avgIn, avgHours: t.avgHours },
      days: days.map(d => d.kind),
      leave90: round(took.reduce((s, l) => s + daysIn(l, addDays(today, -90), today), 0), 1),
      lastLeave: last,
      balance: balBy.has(e.id) ? (balBy.get(e.id) as number) : null,
      rating: rh[0] ? String(rh[0].final_rating_code).toUpperCase() : null,
      pmsStage: cur ? pmsStage(cur.workflow_status) : null,
      onNotice: onNotice.has(e.id),
      anniversary: nextAnniversary(e.doj, today, 30),
      birthday: nextAnniversary(e.dob, today, 14),
    }
  })

  // ── Today ──
  const todayKinds = members.map(m => m.today)
  const offToday = todayKinds.length > 0 && todayKinds.every(k => k === 'HOLIDAY' || k === 'WEEKLY_OFF')
  const todaySum = {
    present: todayKinds.filter(k => ['PRESENT', 'LATE', 'HALF_DAY', 'IN_PROGRESS', 'MISS_IN', 'MISS_OUT'].includes(k)).length,
    late: members.filter(m => m.today === 'LATE' || (m.today === 'IN_PROGRESS' && (attBy.get(m.id) || []).some((r: any) => r.attendance_date === today && Number(r.late_minutes) > 0))).length,
    onLeave: todayKinds.filter(k => k === 'LEAVE' || k === 'HALF_LEAVE').length,
    notIn: todayKinds.filter(k => k === 'UPCOMING' || k === 'ABSENT').length,
    off: offToday,
  }
  const weekEnd = addDays(today, 6)
  const nameOf = new Map(emps.map(e => [e.id, e.name]))
  const outThisWeek = approved.filter(l => l.to_date >= today && l.from_date <= weekEnd)
    .map(l => ({ name: nameOf.get(l.employee_id) || '', type: (l as any).name || l.type, from: l.from_date, to: l.to_date, days: l.days }))
    .sort((a, b) => a.from.localeCompare(b.from))

  // ── Health ──
  const tracked = members.filter(m => m.month.present > 0)
  const punctuality = (() => {
    const recs = emps.flatMap(e => (attBy.get(e.id) || []).filter((r: any) => r.attendance_date >= from && r.work_in))
    return recs.length ? pct(recs.filter((r: any) => !(Number(r.late_minutes) > 0)).length, recs.length, 0) : null
  })()
  const attendanceRate = (() => {
    const wd = tracked.reduce((s, m) => s + m.month.workdays, 0)
    const pr = tracked.reduce((s, m) => s + m.month.present + m.month.leave, 0)
    return wd ? Math.min(100, Math.round((pr / wd) * 100)) : null
  })()
  const settled = members.filter(m => m.doj && daysBetween(m.doj, today) >= 120)
  const restRate = settled.length ? pct(settled.filter(m => m.leave90 > 0).length, settled.length, 0) : null
  const leftYear = (exitsYear as any[]).filter(r => r.is_test !== true).map(r => r.date_of_leaving || r.last_working_date || r.relieving_date).filter((d: string | null) => d && d >= addDays(today, -365) && d <= today).length
  const retention = members.length >= 3 ? Math.max(0, Math.round(100 - (leftYear / (members.length + leftYear / 2)) * 100)) : null
  const reviewRate = currentRows.length ? pct(currentRows.filter(r => ['manager', 'final', 'published'].includes(pmsStage(r.workflow_status))).length, currentRows.length, 0) : null
  const parts = [
    { key: 'punctuality', label: 'Punctuality', value: punctuality, note: 'On-time punch-ins this month' },
    { key: 'attendance', label: 'Attendance', value: attendanceRate, note: 'Working days present or on approved leave, among people who punch' },
    { key: 'rest', label: 'Time off', value: restRate, note: 'Share of the team who took leave in the last 90 days' },
    { key: 'retention', label: 'Retention', value: retention, note: 'People kept over the last 12 months' },
    { key: 'reviews', label: 'Reviews', value: reviewRate, note: current ? `${current.period_name || current.period_code}: past your review stage` : 'No cycle running' },
  ]
  const have = parts.map(p => p.value).filter((v): v is number => v != null)
  const health = { score: have.length >= 2 ? Math.round(mean(have) as number) : null, parts }

  // ── Approvals waiting on the manager ──
  const ages = [...(pendLeave as any[]).map(r => r.applied_at), ...(pendReg as any[]).map(r => r.created_at)].filter(Boolean).map((d: string) => daysBetween(d.slice(0, 10), today))
  const approvals = { leave: (pendLeave as any[]).length, regularisation: (pendReg as any[]).length, oldestDays: ages.length ? Math.max(...ages) : null }

  // ── Performance ──
  const latestRated = members.map(m => m.rating).filter(Boolean) as string[]
  const teamDist = ratingDistribution(latestRated)
  let companyTopShare: number | null = null
  if (companyId && current) {
    const { data: co } = await sb.from('pms_overall_rating').select('final_rating_code').eq('company_id', companyId).not('final_rating_code', 'is', null).limit(5000)
    const d = ratingDistribution(((co || []) as any[]).map(r => r.final_rating_code))
    const n = d.reduce((s, x) => s + x.value, 0)
    companyTopShare = n >= 10 ? pct(d[0].value + d[1].value, n) : null
  }
  const awaitingYou = currentRows.filter(r =>
    (r.rm_l1_id === managerId && String(r.workflow_status).toUpperCase() === 'SELF_SUBMITTED') ||
    (r.rm_l2_id === managerId && String(r.workflow_status).toUpperCase() === 'RM_L1_DONE')).length
  const performance = {
    cycle: current ? (current.period_name || current.period_code) : null,
    distribution: teamDist.map(d => ({ key: d.key, label: d.label, value: d.value })),
    awaitingYou,
    companyTopShare,
    teamTopShare: latestRated.length >= 3 ? pct(teamDist[0].value + teamDist[1].value, latestRated.length) : null,
  }

  // ── Signals ──
  const lastRev = new Map<string, string>()
  for (const c of ctc as any[]) if (c.effective_from && (!lastRev.get(c.employee_id) || c.effective_from > (lastRev.get(c.employee_id) as string))) lastRev.set(c.employee_id, c.effective_from)
  const exits90 = (exitsYear as any[]).filter(r => { const d = r.date_of_leaving || r.last_working_date || r.relieving_date; return d && d >= addDays(today, -90) && d <= today }).length
  const signals: RiskRow[] = []
  for (const e of emps) {
    if (onNotice.has(e.id)) continue
    const recs = attBy.get(e.id) || []
    const lateIn = (a: string, b: string) => recs.filter((r: any) => r.attendance_date >= a && r.attendance_date <= b && r.work_in && Number(r.late_minutes) > 0).length
    const lv = lvBy.get(e.id) || []
    const rh = ratingsBy.get(e.id) || []
    const rev = lastRev.get(e.id)
    const sig = riskSignals({
      teamExits90: exits90,
      rating: rh[0]?.final_rating_code || null, prevRating: rh[1]?.final_rating_code || null,
      late30: lateIn(addDays(today, -29), today), latePrev30: lateIn(addDays(today, -59), addDays(today, -30)),
      unplanned90: lv.filter(l => l.from_date >= addDays(today, -90) && isUnplanned(l)).length,
      bridging180: bridgeShare(lv.filter(l => l.from_date >= addDays(today, -180))).bridging,
      monthsSinceRevision: rev ? daysBetween(rev, today) / 30.44 : null,
      tenureYears: e.doj ? tenureYears(e.doj, today) : null,
      probationOverdue: probationOverdue(e, today),
    })
    const lvl = riskLevel(sig)
    if (lvl.level !== 'low') signals.push({ id: e.id, code: e.code, name: e.name, designation: e.designation, department: e.deptName, level: lvl.level, score: lvl.score, signals: sig })
  }
  signals.sort((a, b) => b.score - a.score)

  // ── Coming up ──
  const upcoming: TeamAnalytics['upcoming'] = []
  for (const m of members) {
    if (m.birthday) upcoming.push({ kind: 'birthday', name: m.name, date: m.birthday, note: 'Birthday' })
    if (m.anniversary && m.doj) {
      const yrs = Number(m.anniversary.slice(0, 4)) - Number(m.doj.slice(0, 4))
      if (yrs >= 1) upcoming.push({ kind: 'anniversary', name: m.name, date: m.anniversary, note: `${yrs} year${yrs === 1 ? '' : 's'} at work` })
    }
  }
  for (const e of emps) {
    if (probationOverdue(e, today)) upcoming.push({ kind: 'probation', name: e.name, date: today, note: 'Probation ended — confirm or extend' })
    else if (probationDue(e, today, 30)) upcoming.push({ kind: 'probation', name: e.name, date: probationEnd(e.doj as string, e.probation_months ?? 6), note: 'Probation ends — confirmation due' })
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date))

  // ── Words ──
  const insights: Insight[] = []
  if (approvals.leave + approvals.regularisation > 0) insights.push({ id: 'appr', severity: (approvals.oldestDays || 0) > 3 ? 'warning' : 'info', area: 'leave', title: `${approvals.leave + approvals.regularisation} request${approvals.leave + approvals.regularisation === 1 ? '' : 's'} waiting on you`, detail: `${approvals.leave} leave, ${approvals.regularisation} attendance correction${approvals.regularisation === 1 ? '' : 's'}${approvals.oldestDays != null ? `; the oldest is ${approvals.oldestDays} day${approvals.oldestDays === 1 ? '' : 's'} old` : ''}.` })
  if (awaitingYou > 0) insights.push({ id: 'pms', severity: 'warning', area: 'performance', title: `${awaitingYou} review${awaitingYou === 1 ? '' : 's'} waiting for your rating`, detail: 'Self-reviews are in; the cycle moves when you rate.' })
  const tired = members.filter(m => m.doj && daysBetween(m.doj, today) >= 120 && m.leave90 === 0 && !m.onNotice)
  if (tired.length) insights.push({ id: 'rest', severity: 'info', area: 'leave', title: `${tired.length} of your team ${tired.length === 1 ? 'has' : 'have'} not taken leave in 90 days`, detail: `${tired.slice(0, 3).map(m => m.name).join(', ')}${tired.length > 3 ? ' and others' : ''}. A nudge to plan a break helps prevent burnout.` })
  const lateMost = members.filter(m => m.month.late >= 4).sort((a, b) => b.month.late - a.month.late)
  if (lateMost.length) insights.push({ id: 'late', severity: 'info', area: 'attendance', title: `${lateMost.length} ${lateMost.length === 1 ? 'person has' : 'people have'} 4+ late marks this month`, detail: lateMost.slice(0, 3).map(m => `${m.name} (${m.month.late})`).join(', ') + '.' })
  if (signals.some(s => s.level === 'high')) insights.push({ id: 'risk', severity: 'warning', area: 'attrition', title: 'Someone in your team may need a conversation', detail: 'Several signals at once — see "Needs a conversation" for the reasons.' })
  if (performance.teamTopShare != null && performance.companyTopShare != null && performance.teamTopShare - performance.companyTopShare >= 20) {
    insights.push({ id: 'skew', severity: 'info', area: 'performance', title: 'Your ratings run higher than the company\'s', detail: `${performance.teamTopShare}% of your team is in the top two bands, against ${performance.companyTopShare}% company-wide.` })
  }
  if (health.score != null && health.score >= 85) insights.push({ id: 'healthy', severity: 'positive', area: 'workforce', title: 'Your team is in good shape', detail: `Team health ${health.score} out of 100.` })

  return { generatedAt: new Date().toISOString(), scope, manager: { id: managerId, name: managerName }, month, dates, members, today: todaySum, outThisWeek, health, approvals, performance, signals, upcoming, insights }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) { const k = key(r); const l = m.get(k) || []; l.push(r); m.set(k, l) }
  return m
}

function minutesIst(ts: string): number {
  const d = new Date(Date.parse(ts) + 5.5 * 3600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function daysIn(l: LeaveApp, from: string, to: string): number {
  const s = l.from_date > from ? l.from_date : from, e = l.to_date < to ? l.to_date : to
  if (s > e) return 0
  const span = daysBetween(l.from_date, l.to_date) + 1
  return ((Number(l.days) || span) * (daysBetween(s, e) + 1)) / span
}

/** The next yearly recurrence of a date within `within` days, as an ISO day. */
export function nextAnniversary(date: string | null, today: string, within: number): string | null {
  if (!date || date.length < 10) return null
  const md = date.slice(5, 10)
  const y = Number(today.slice(0, 4))
  for (const yr of [y, y + 1]) {
    const cand = md === '02-29' && !leap(yr) ? `${yr}-02-28` : `${yr}-${md}`
    if (cand >= today && daysBetween(today, cand) <= within && cand > date) return cand
  }
  return null
}
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

function probationEnd(doj: string, months: number): string {
  const [y, m] = doj.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  const ym = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
  const last = Number(monthEnd(ym).slice(8, 10))
  return `${ym}-${String(Math.min(Number(doj.slice(8, 10)), last)).padStart(2, '0')}`
}
