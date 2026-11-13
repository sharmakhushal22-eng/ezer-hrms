// lib/analytics/server/me.ts — an employee's own insights.
//
// Everything here is about the person asking, and nothing here is about anyone else
// except one anonymous comparison: their punctuality and hours against the median of
// their peers (same L1), shown only when there are at least three peers with data, so
// no single colleague can be read off it.
//
// A rating appears only once it has been PUBLISHED to them; a payroll month only once
// it is approved, disbursed or locked. Analytics must never show an employee something
// the rest of the portal is still holding back.

import { addDays, addMonths, daysBetween, istToday, monthOf, monthStart, monthsBetween, fyStartYear, fyLabel, fiscalToMonth } from '../period.ts'
import { tenureYears, pmsStage, PMS_STAGES, median, round, isUnplanned, type LeaveApp } from '../metrics.ts'
import { tallyDays, onTimeStreak } from '../days.ts'
import type { MyAnalytics, Insight } from '../types.ts'
import { sb, all, inChunks, soft, EMP_COLS, toEmp, floorHalf, leaveYear, one } from './db.ts'
import { calendarFor } from './calendar.ts'
import { nextAnniversary } from './team.ts'

const SETTLED_PAY = new Set(['APPROVED', 'DISBURSED', 'LOCKED'])
const VISIBLE_RATING = new Set(['PUBLISHED', 'ACKNOWLEDGED'])

export async function myAnalytics(employeeId: string): Promise<MyAnalytics> {
  const today = istToday()
  const { data: row, error } = await sb.from('employees').select(EMP_COLS + ', departments!employees_department_id_fkey(dept_name)').eq('id', employeeId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) throw new Error('Employee not found.')
  const e = toEmp(row as any)
  const deptName = one<any>((row as any).departments)?.dept_name || null

  // Six months of days, or since joining if that is later.
  const sixFrom = monthStart(addMonths(monthOf(today), -5))
  const from = e.doj && e.doj > sixFrom ? e.doj : sixFrom
  const to = today
  const fyFrom = `${fyStartYear(today)}-04-01`

  const [recs, lvs, bal, policy, peers, ctc, runs, ratings, periods, learner, kudos, awards] = await Promise.all([
    all<any>(() => sb.from('attendance_records').select('attendance_date, work_in, work_out, total_minutes, late_minutes, status').eq('employee_id', employeeId).gte('attendance_date', from).lte('attendance_date', to).order('attendance_date') as any, 'attendance'),
    all<any>(() => sb.from('leave_applications').select('from_date, to_date, days, half_day, status, applied_at, resolved_at, leave_types(short_name, name)').eq('employee_id', employeeId).in('status', ['APPROVED', 'PENDING']).gte('to_date', addDays(today, -400)).order('from_date') as any, 'leave'),
    soft(all<any>(() => sb.from('leave_balances').select('leave_type_id, opening, accrued, used, encashed, leave_types(short_name, name)').eq('employee_id', employeeId).eq('year', leaveYear(today)).order('leave_type_id') as any, 'balances')),
    e.company_id ? soft(all<any>(() => sb.from('leave_policy').select('leave_type_id, max_carry_forward, branch_id').eq('company_id', e.company_id as string).eq('fy', fyLabel(today)).eq('is_active', true).order('leave_type_id') as any, 'policy')) : Promise.resolve([] as any[]),
    e.l1 ? soft(all<any>(() => sb.from('employees').select('id, is_test, employment_status').eq('l1_manager_id', e.l1 as string).neq('id', employeeId).order('id') as any, 'peers')) : Promise.resolve([] as any[]),
    soft(all<any>(() => sb.from('ctc_master').select('fy, annual_ctc, status').eq('employee_id', employeeId).order('fy') as any, 'ctc')),
    soft(all<any>(() => sb.from('payroll_lines').select('gross_earning, net_pay, total_deductions, ded_epf, ded_vpf, ded_nps, ded_esic, ded_pt, ded_lwf, ded_tds, ded_loan_emi, payroll_runs!inner(fy, month, status)').eq('employee_id', employeeId).order('run_id') as any, 'pay')),
    soft(all<any>(() => sb.from('pms_overall_rating').select('period_id, workflow_status, final_rating_code, final_score').eq('employee_id', employeeId).order('id') as any, 'ratings')),
    e.company_id ? soft(all<any>(() => sb.from('pms_periods').select('id, period_code, period_name, period_start').eq('company_id', e.company_id as string).order('period_start') as any, 'periods')) : Promise.resolve([] as any[]),
    soft(all<any>(() => sb.from('lms_learners').select('id').eq('employee_id', employeeId).order('id') as any, 'learner')),
    soft(all<any>(() => sb.from('ess_kudos').select('created_at').eq('to_employee_id', employeeId).order('created_at') as any, 'kudos')),
    soft(all<any>(() => sb.from('recognitions').select('published_at, is_archived').contains('receiver_employee_ids', [employeeId]).order('published_at') as any, 'recognitions')),
  ])

  const leaves: (LeaveApp & { name: string })[] = (lvs as any[]).map(r => ({
    employee_id: employeeId, type: String(one<any>(r.leave_types)?.short_name || 'LV').toUpperCase(), name: one<any>(r.leave_types)?.name || 'Leave',
    from_date: r.from_date, to_date: r.to_date, days: Number(r.days) || 0, half_day: !!r.half_day,
    status: String(r.status).toUpperCase(), applied_at: r.applied_at, resolved_at: r.resolved_at,
  }))
  const approved = leaves.filter(l => l.status === 'APPROVED')

  // ── Attendance ──
  const days = await calendarFor(employeeId, e.doj, from, to, today, recs as any[], approved.map(l => ({ from_date: l.from_date, to_date: l.to_date, half_day: l.half_day })))
  const months = monthsBetween(monthOf(from), monthOf(to))
  const monthly = months.map(m => {
    const t = tallyDays(days.filter(d => d.date.startsWith(m)))
    return { month: m, present: t.present, late: t.late, absent: t.absent, leave: t.leave, workdays: t.workdays, avgIn: t.avgIn, avgHours: t.avgHours, onTimeRate: t.onTimeRate }
  })
  const tm = tallyDays(days.filter(d => d.date.startsWith(monthOf(today))))

  // Peers: same L1, active, not test. Their last 60 days, as medians.
  const peerIds = (peers as any[]).filter(p => p.is_test !== true && String(p.employment_status || 'Active').toLowerCase() === 'active').map(p => p.id)
  let team: MyAnalytics['attendance']['team'] = null
  if (peerIds.length >= 3) {
    const pr = await soft(inChunks<any>(peerIds, c => sb.from('attendance_records').select('employee_id, work_in, work_out, total_minutes, late_minutes').in('employee_id', c).gte('attendance_date', addDays(today, -59)).lte('attendance_date', today).order('attendance_date') as any, 'peer attendance'))
    const per = new Map<string, any[]>()
    for (const r of pr as any[]) { const l = per.get(r.employee_id) || []; l.push(r); per.set(r.employee_id, l) }
    const withData = [...per.values()].filter(l => l.filter(r => r.work_in).length >= 5)
    if (withData.length >= 3) {
      const tallies = withData.map(l => tallyDays(l.map(r => ({ kind: 'PRESENT' as const, rec: r }))))
      team = {
        onTimeRate: median(tallies.map(t => t.onTimeRate).filter((x): x is number => x != null)),
        avgIn: median(tallies.map(t => t.avgIn).filter((x): x is number => x != null)),
        avgHours: median(tallies.map(t => t.avgHours).filter((x): x is number => x != null)),
        size: withData.length,
      }
    }
  }

  // ── Leave ──
  const carry = new Map<string, number>()
  for (const p of policy as any[]) if (p.max_carry_forward != null) carry.set(p.leave_type_id, Number(p.max_carry_forward))
  const balances = (bal as any[]).map(b => {
    const t = one<any>(b.leave_types)
    const accrued = floorHalf(Number(b.opening || 0) + Number(b.accrued || 0))
    const used = Number(b.used || 0) + Number(b.encashed || 0)
    const available = floorHalf(accrued - used)
    const cap = carry.get(b.leave_type_id)
    return { key: String(t?.short_name || '').toUpperCase(), label: t?.name || t?.short_name || 'Leave', available, used: round(used, 1), accrued, lapse: cap != null && available > cap ? round(available - cap, 1) : null }
  // Unpaid leave has no balance to show — it is a count of days, and "−16 available"
  // reads as a debt. Only types that actually accrue are listed.
  }).filter(b => b.key && b.key !== 'LWP' && b.accrued > 0).sort((a, b) => b.available - a.available)
  const tw = monthsBetween(addMonths(monthOf(today), -11), monthOf(today))
  const taken = tw.map(m => ({ month: m, days: round(approved.reduce((s, l) => s + inMonth(l, m), 0), 1) }))
  const takenThisFy = round(approved.reduce((s, l) => s + span(l, fyFrom, today), 0), 1)
  const lastLeave = approved.filter(l => l.from_date <= today).map(l => (l.to_date < today ? l.to_date : today)).sort().pop() || null
  const upcoming = leaves.filter(l => l.to_date >= today).map(l => ({ type: l.name, from: l.from_date, to: l.to_date, days: l.days, status: l.status }))

  // ── Pay ──
  const ctcRow = (ctc as any[]).slice().sort((a, b) => (a.fy === fyLabel(today) ? -1 : 0) - (b.fy === fyLabel(today) ? -1 : 0) || String(b.fy).localeCompare(String(a.fy)))[0]
  const paid = (runs as any[]).map(l => ({ l, run: one<any>(l.payroll_runs) }))
    .filter(x => x.run && SETTLED_PAY.has(String(x.run.status).toUpperCase()))
    .map(x => ({ month: fiscalToMonth(x.run.fy, Number(x.run.month)) as string, l: x.l }))
    .filter(x => x.month).sort((a, b) => a.month.localeCompare(b.month)).slice(-12)
  const n = (v: unknown) => Number(v) || 0
  const lastPay = paid[paid.length - 1]?.l
  const pay: MyAnalytics['pay'] = {
    ctc: ctcRow ? n(ctcRow.annual_ctc) || null : null,
    ctcFy: ctcRow?.fy || null,
    months: paid.map(x => ({ month: x.month, gross: Math.round(n(x.l.gross_earning)), net: Math.round(n(x.l.net_pay)), deductions: Math.round(n(x.l.total_deductions)) })),
    split: lastPay ? [
      { key: 'net', label: 'Take-home', value: Math.round(n(lastPay.net_pay)) },
      { key: 'tax', label: 'Income tax', value: Math.round(n(lastPay.ded_tds)) },
      { key: 'pf', label: 'PF / VPF / NPS', value: Math.round(n(lastPay.ded_epf) + n(lastPay.ded_vpf) + n(lastPay.ded_nps)) },
      { key: 'other', label: 'ESIC, PT, LWF, loans', value: Math.round(n(lastPay.ded_esic) + n(lastPay.ded_pt) + n(lastPay.ded_lwf) + n(lastPay.ded_loan_emi)) },
    ].filter(s => s.value > 0) : [],
  }

  // ── Performance ──
  const periodBy = new Map<string, any>((periods as any[]).map(p => [p.id, p]))
  const history = (ratings as any[]).map(r => ({ r, p: periodBy.get(r.period_id) })).filter(x => x.p)
    .sort((a, b) => String(a.p.period_start).localeCompare(String(b.p.period_start)))
    .map(({ r, p }) => {
      const visible = VISIBLE_RATING.has(String(r.workflow_status).toUpperCase())
      return { cycle: p.period_code, name: p.period_name || p.period_code, rating: visible ? (r.final_rating_code || null) : null, score: visible && r.final_score != null ? Number(r.final_score) : null, status: PMS_STAGES.find(s => s.key === pmsStage(r.workflow_status))?.label || '' }
    })
  const mineIds = new Set((ratings as any[]).map(r => r.period_id))
  const curP = (periods as any[]).filter(p => (p.period_start || '') <= today && mineIds.has(p.id)).pop()
  let current: MyAnalytics['performance']['current'] = null
  if (curP) {
    const mine = (ratings as any[]).find(r => r.period_id === curP.id)
    if (mine) {
      const { data: goals } = await sb.from('pms_employee_goals').select('weightage, status').eq('employee_id', employeeId).eq('period_id', curP.id)
      const g = ((goals || []) as any[]).filter(x => String(x.status).toUpperCase() !== 'TERMINATED')
      current = { cycle: curP.period_code, name: curP.period_name || curP.period_code, stage: PMS_STAGES.find(s => s.key === pmsStage(mine.workflow_status))?.label || 'Not started', goals: g.length, weightage: g.length ? g.reduce((s, x) => s + n(x.weightage), 0) : null }
    }
  }

  // ── Learning ──
  const learnerIds = (learner as any[]).map(l => l.id)
  const enr = learnerIds.length ? await soft(inChunks<any>(learnerIds, c => sb.from('lms_enrollments').select('status, progress_pct, due_at, enrolled_at, lms_courses(title)').in('learner_id', c).order('enrolled_at') as any, 'enrolments')) : []
  const live = (enr as any[]).filter(x => !['CANCELLED', 'WAIVED', 'REJECTED'].includes(String(x.status).toUpperCase()))
  const learning = {
    enrolled: live.length,
    completed: live.filter(x => String(x.status).toUpperCase() === 'COMPLETED').length,
    inProgress: live.filter(x => String(x.status).toUpperCase() === 'IN_PROGRESS').length,
    overdue: live.filter(x => String(x.status).toUpperCase() !== 'COMPLETED' && x.due_at && String(x.due_at).slice(0, 10) < today).length,
    recent: live.slice(-5).reverse().map(x => ({ title: one<any>(x.lms_courses)?.title || 'Course', status: String(x.status).replace(/_/g, ' ').toLowerCase(), progress: x.progress_pct != null ? Number(x.progress_pct) : null })),
  }

  // ── Milestones ──
  const milestones: MyAnalytics['milestones'] = []
  const anniv = nextAnniversary(e.doj, today, 366)
  if (anniv && e.doj) {
    const yrs = Number(anniv.slice(0, 4)) - Number(e.doj.slice(0, 4))
    if (yrs >= 1) milestones.push({ label: `${yrs} year${yrs === 1 ? '' : 's'} at work`, date: anniv, note: `in ${daysBetween(today, anniv)} days` })
  }
  if (e.doj) {
    const d = daysBetween(e.doj, today)
    const next = [100, 365, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000].find(x => x > d)
    if (next) milestones.push({ label: `Day ${next.toLocaleString('en-IN')}`, date: addDays(e.doj, next), note: `in ${next - d} days` })
  }
  const bday = nextAnniversary(e.dob, today, 366)
  if (bday) milestones.push({ label: 'Birthday', date: bday, note: daysBetween(today, bday) === 0 ? 'today' : `in ${daysBetween(today, bday)} days` })
  milestones.sort((a, b) => a.date.localeCompare(b.date))

  // ── Nudges ──
  const nudges: Insight[] = []
  const lapse = balances.filter(b => b.lapse && b.lapse > 0)
  if (lapse.length) nudges.push({ id: 'lapse', severity: 'warning', area: 'leave', title: `${lapse[0].lapse} ${lapse[0].label} day${lapse[0].lapse === 1 ? '' : 's'} above the carry-forward limit`, detail: 'Days above the limit do not carry into next year. Plan some time off before 31 March.' })
  const tookRecent = approved.some(l => l.to_date >= addDays(today, -90) && l.from_date <= today)
  if (!tookRecent && e.doj && daysBetween(e.doj, today) >= 120) nudges.push({ id: 'rest', severity: 'info', area: 'leave', title: 'You have not taken a day off in 90 days', detail: 'Regular breaks help. Your balances are below.' })
  const streak = onTimeStreak(days)
  if (streak >= 10) nudges.push({ id: 'streak', severity: 'positive', area: 'attendance', title: `${streak} on-time days in a row`, detail: 'Your longest current streak of punctual punch-ins.' })
  const lastM = monthly[monthly.length - 2]
  if (lastM && tm.late >= 3 && tm.late > lastM.late) nudges.push({ id: 'late', severity: 'info', area: 'attendance', title: `${tm.late} late marks this month`, detail: `Up from ${lastM.late} last month. Late marks can affect pay under your company's attendance policy.` })
  const miss = days.filter(d => (d.kind === 'MISS_IN' || d.kind === 'MISS_OUT') && d.date >= addDays(today, -30)).length
  if (miss > 0) nudges.push({ id: 'miss', severity: 'warning', area: 'attendance', title: `${miss} day${miss === 1 ? '' : 's'} with a missing punch`, detail: 'File a correction from Attendance before payroll closes, or the day may count as absent.' })
  if (current && current.stage === 'Goals set') nudges.push({ id: 'pms', severity: 'info', area: 'performance', title: `${current.name}: your self-review is next`, detail: 'Your goals are set. Add your self-rating when the window opens.' })
  if (learning.overdue > 0) nudges.push({ id: 'lms', severity: 'warning', area: 'learning', title: `${learning.overdue} course${learning.overdue === 1 ? '' : 's'} overdue`, detail: 'Open Learning to finish them.' })
  const unplannedYr = approved.filter(l => l.from_date >= addDays(today, -365) && l.from_date <= today && isUnplanned(l)).length
  if (unplannedYr >= 6) nudges.push({ id: 'unplanned', severity: 'info', area: 'leave', title: `${unplannedYr} short-notice leaves this year`, detail: 'Applying ahead where you can helps your team plan.' })

  return {
    generatedAt: new Date().toISOString(),
    me: { id: e.id, name: e.name, doj: e.doj, tenureYears: e.doj ? round(tenureYears(e.doj, today), 1) : null, designation: e.designation, department: deptName },
    attendance: {
      from, to,
      days: days.map(d => ({ date: d.date, kind: d.kind, in: d.rec?.work_in ?? null, late: Number(d.rec?.late_minutes || 0), hours: d.rec?.total_minutes ? round(Number(d.rec.total_minutes) / 60, 1) : null })),
      monthly,
      thisMonth: { present: tm.present, late: tm.late, absent: tm.absent, leave: tm.leave, workdays: tm.workdays, onTimeRate: tm.onTimeRate, avgIn: tm.avgIn, avgHours: tm.avgHours },
      streak,
      team,
    },
    leave: { balances, taken, takenThisFy, lastLeave, upcoming },
    pay,
    performance: { history, current },
    learning,
    recognition: { kudos: (kudos as any[]).length, awards: (awards as any[]).filter(a => !a.is_archived && a.published_at).length },
    milestones,
    nudges,
  }
}

function span(l: LeaveApp, from: string, to: string): number {
  const s = l.from_date > from ? l.from_date : from, e = l.to_date < to ? l.to_date : to
  if (s > e) return 0
  const total = daysBetween(l.from_date, l.to_date) + 1
  return ((Number(l.days) || total) * (daysBetween(s, e) + 1)) / total
}
function inMonth(l: LeaveApp, m: string): number {
  const end = addDays(monthStart(addMonths(m, 1)), -1)
  return span(l, monthStart(m), end)
}
