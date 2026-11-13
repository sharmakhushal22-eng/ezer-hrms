'use client'
// components/analytics/MyInsights.tsx — an employee's own analytics (ESS → Insights).
//
// Their attendance over six months, punctuality against an anonymous team median,
// leave balances with what may lapse, take-home pay once payroll is approved, ratings
// once published, learning, milestones — and a few plain-language nudges at the top.

import * as React from 'react'
import { C, F, W, R, S, E, eyebrow, numeric, tone } from '@/lib/ui'
import { api } from '@/lib/ess/api'
import type { MyAnalytics } from '@/lib/analytics/types'
import { fmt, inr, clockOf, mLabel, dLabel, dLabelLong } from '@/lib/analytics/format'
import { ChartCard, Grid, Figure, Figures, ColumnChart, LineChart, Segmented, DayCalendar, DayLegend, Meter, MiniTable, Pill, EmptyChart } from './charts'
import { AiBriefCard, Findings, useAiBrief, useFindingsMode } from './AiBrief'
import type { AiBriefResponse } from '@/lib/analytics/ai/types'

/** Where a finding's click lands on this page. */
const SECTION: Record<string, string> = { attendance: 'me-attendance', leave: 'me-leave', pay: 'me-pay', performance: 'me-performance', learning: 'me-learning', recognition: 'me-milestones' }
const AREA: Record<string, string> = { attendance: 'Attendance', leave: 'Leave', pay: 'Pay', performance: 'Reviews', learning: 'Learning', recognition: 'Recognition' }
const jump = (area: string) => document.getElementById(SECTION[area] || '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export default function MyInsights({ employeeId }: { employeeId: string }) {
  const [d, setD] = React.useState<MyAnalytics | null>(null)
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    let live = true
    api('/api/analytics/me', employeeId).then(b => { if (live) setD(b as MyAnalytics) }).catch(e => { if (live) setErr(e?.message || 'Could not load your insights.') })
    return () => { live = false }
  }, [employeeId])

  // The AI read of their own month, once the figures are in.
  const ai = useAiBrief(
    refresh => api(`/api/analytics/me/ai${refresh ? '?refresh=1' : ''}`, employeeId) as Promise<AiBriefResponse>,
    d ? `${employeeId}|${d.generatedAt}` : '',
  )
  const [mode, setMode] = useFindingsMode(!!ai.res?.brief?.findings.length)

  if (err) return <EmptyChart text={err} />
  if (!d) return <Skeleton />

  const a = d.attendance
  const first = d.me.name.split(' ')[0]
  const inBy = new Map(a.days.map(x => [x.date, x]))
  return (
    <div className="ez-fade">
      <Hero d={d} first={first} />

      <AiBriefCard state={ai} audience="me" />
      <div style={{ marginBottom: S.lg }}>
        <Findings state={ai} rules={d.nudges} mode={mode} setMode={setMode} grid onOpen={jump} areaLabel={a => AREA[a]}
          empty="All clear — nothing needs your attention this month." />
      </div>

      <ChartCard id="me-attendance" title="Your attendance, last six months" sub={`${dLabelLong(a.from)} – ${dLabelLong(a.to)}. Same marks as your attendance calendar.`} style={{ marginBottom: S.lg }}>
        <DayCalendar days={a.days} detail={date => { const x = inBy.get(date); return x?.in ? ` · in ${clockOf(minsIst(x.in))}${x.hours ? ` · ${x.hours} h` : ''}` : '' }} />
        <DayLegend />
      </ChartCard>

      <Grid min={340}>
        <ChartCard title="On time, month by month" sub="Share of your punch-ins with no late minutes.">
          <LineChart labels={a.monthly.map(m => mLabel(m.month))} series={[{ key: 'o', label: 'On time', values: a.monthly.map(m => m.onTimeRate) }]} f="pct" yMax={100} height={180} emptyText="No punches in the last six months." />
        </ChartCard>
        <ChartCard title="Days by month" sub="Present, on leave and absent working days.">
          <ColumnChart stacked labels={a.monthly.map(m => mLabel(m.month))} series={[
            // Attendance is state, so it wears the state colours the calendar uses.
            { key: 'p', label: 'Present', values: a.monthly.map(m => m.present), colour: C.positive },
            { key: 'l', label: 'Leave', values: a.monthly.map(m => m.leave), colour: C.info },
            { key: 'a', label: 'Absent', values: a.monthly.map(m => m.absent), colour: C.critical },
          ]} f="days" height={180} />
        </ChartCard>
      </Grid>

      <Grid min={340}>
        <ChartCard id="me-leave" title="Leave balances" sub={`${fmt(d.leave.takenThisFy, 'days')} days taken this financial year${d.leave.lastLeave ? ` · last day off ${dLabelLong(d.leave.lastLeave)}` : ''}.`}>
          {d.leave.balances.length === 0 ? <EmptyChart text="No leave balances on record yet." height={90} /> : (
            <div style={{ display: 'grid', gap: S.md }}>
              {d.leave.balances.map(b => (
                <div key={b.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: F.small, color: C.ink, fontWeight: W.medium }}>{b.label}</span>
                    <span style={{ fontSize: F.small, color: C.ink, ...numeric }}><strong>{fmt(b.available, 'days')}</strong> <span style={{ color: C.muted }}>available · {fmt(b.used, 'days')} used</span></span>
                  </div>
                  <Meter value={b.accrued ? (b.available / b.accrued) * 100 : 0} />
                  {b.lapse != null && <div style={{ fontSize: F.micro, color: C.warning, marginTop: 4 }}>{fmt(b.lapse, 'days')} above the carry-forward limit</div>}
                </div>
              ))}
            </div>
          )}
        </ChartCard>
        <ChartCard title="Leave taken" sub="Approved days, last 12 months.">
          <ColumnChart labels={d.leave.taken.map(t => mLabel(t.month))} series={[{ key: 't', label: 'Days', values: d.leave.taken.map(t => t.days) }]} f="days" height={160} emptyText="No leave taken in the last 12 months." />
          {d.leave.upcoming.length > 0 && <>
            <div style={{ ...eyebrow, margin: `${S.md}px 0 6px` }}>Coming up</div>
            <MiniTable head={['Leave', 'Dates', 'Days', 'Status']} align={['left', 'left', 'right', 'left']}
              rows={d.leave.upcoming.slice(0, 5).map(u => [u.type, `${dLabel(u.from)} – ${dLabel(u.to)}`, fmt(u.days, 'days'), <Pill key="s" t={u.status === 'APPROVED' ? 'positive' : 'warning'}>{u.status === 'APPROVED' ? 'Approved' : 'Pending'}</Pill>])} />
          </>}
        </ChartCard>
      </Grid>

      <Grid min={340}>
        <ChartCard id="me-pay" title="Your pay" sub={d.pay.ctc ? `Annual CTC ${inr(d.pay.ctc)}${d.pay.ctcFy ? ` (FY ${d.pay.ctcFy})` : ''}.` : undefined}>
          {d.pay.months.length === 0 ? <EmptyChart text="Your take-home trend appears here once a month's payroll is approved." height={120} /> : <>
            <ColumnChart stacked labels={d.pay.months.map(m => mLabel(m.month))} series={[
              { key: 'n', label: 'Take-home', values: d.pay.months.map(m => m.net) },
              { key: 'd', label: 'Deductions', values: d.pay.months.map(m => m.deductions) },
            ]} f="money" height={170} />
            {d.pay.split.length > 0 && <>
              <div style={{ ...eyebrow, margin: `${S.md}px 0 6px` }}>Latest month: where your gross went</div>
              <Segmented parts={d.pay.split} f="money" height={22} />
            </>}
          </>}
        </ChartCard>
        <ChartCard id="me-performance" title="Performance">
          {d.performance.current && (
            <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
              <span style={{ fontSize: F.small, color: C.ink, fontWeight: W.semi }}>{d.performance.current.name}</span>
              <Pill t="info">{d.performance.current.stage}</Pill>
              <span style={{ fontSize: F.tiny, color: C.muted }}>{d.performance.current.goals} goal{d.performance.current.goals === 1 ? '' : 's'}{d.performance.current.weightage != null ? ` · ${d.performance.current.weightage}% weightage` : ''}</span>
            </div>
          )}
          <MiniTable head={['Cycle', 'Rating', 'Status']} empty="No review cycles yet."
            rows={d.performance.history.slice().reverse().map(h => [h.name, h.rating ? <strong key="r" style={{ color: C.ink }}>{h.rating}</strong> : <span key="r" style={{ color: C.faint }}>not published</span>, h.status])} />
        </ChartCard>
      </Grid>

      <Grid min={340}>
        <ChartCard id="me-learning" title="Learning">
          <Figures min={90}>
            <Figure label="Enrolled" value={d.learning.enrolled} />
            <Figure label="Completed" value={d.learning.completed} />
            <Figure label="Overdue" value={d.learning.overdue} t={d.learning.overdue ? 'warning' : 'neutral'} />
          </Figures>
          <div style={{ display: 'grid', gap: 8 }}>
            {d.learning.recent.map((r, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.tiny, marginBottom: 4 }}>
                  <span style={{ color: C.ink }}>{r.title}</span><span style={{ color: C.muted, textTransform: 'capitalize' }}>{r.status}</span>
                </div>
                <Meter value={r.progress} height={6} t={r.status === 'completed' ? 'positive' : 'brand'} />
              </div>
            ))}
            {d.learning.recent.length === 0 && <div style={{ fontSize: F.small, color: C.muted }}>No courses yet.</div>}
          </div>
        </ChartCard>
        <ChartCard id="me-milestones" title="Milestones and recognition">
          <Figures min={110}>
            <Figure label="Kudos received" value={d.recognition.kudos} />
            <Figure label="Awards" value={d.recognition.awards} />
            <Figure label="With us" value={d.me.tenureYears != null ? `${d.me.tenureYears} yrs` : '—'} />
          </Figures>
          <div style={{ display: 'grid', gap: 8 }}>
            {d.milestones.map(m => (
              <div key={m.label + m.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.sunken, borderRadius: R.md }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: R.pill, background: C.brand }} />
                <span style={{ fontSize: F.small, color: C.ink, fontWeight: W.medium, flex: 1 }}>{m.label}</span>
                <span style={{ fontSize: F.tiny, color: C.muted }}>{dLabelLong(m.date)} · {m.note}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </Grid>
    </div>
  )
}

function Hero({ d, first }: { d: MyAnalytics; first: string }) {
  const a = d.attendance, tm = a.thisMonth, t = a.team
  const comp = (mine: number | null, team: number | null, f: 'pct' | 'clock' | 'hours', betterHigh: boolean) => {
    if (mine == null || team == null) return null
    const diff = mine - team
    if (Math.abs(diff) < (f === 'clock' ? 3 : f === 'hours' ? 0.2 : 2)) return <span style={{ color: C.muted }}>in line with your team</span>
    const good = betterHigh ? diff > 0 : diff < 0
    const k = tone(good ? 'positive' : 'warning')
    const txt = f === 'clock' ? `${Math.abs(Math.round(diff))} min ${diff < 0 ? 'earlier' : 'later'} than your team` : f === 'hours' ? `${Math.abs(diff).toFixed(1)} h ${diff > 0 ? 'more' : 'less'} than your team` : `${Math.abs(Math.round(diff))} pts ${diff > 0 ? 'above' : 'below'} your team`
    return <span style={{ color: k.fg }}>{txt}</span>
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, padding: S.lg, marginBottom: S.lg }}>
      <div style={{ fontSize: F.title, fontWeight: W.semi, color: C.ink }}>Hi {first}, here is your month so far</div>
      <div style={{ fontSize: F.small, color: C.muted, marginTop: 3, marginBottom: S.md }}>
        {d.me.designation || ''}{d.me.department ? ` · ${d.me.department}` : ''}{t ? ` · compared with the median of ${t.size} teammates, never with anyone by name` : ''}
      </div>
      <Figures min={140}>
        <Figure label="Present" value={`${tm.present} / ${tm.workdays}`} sub="working days so far" />
        <Figure label="On time" value={fmt(tm.onTimeRate, 'pct')} sub={comp(tm.onTimeRate, t?.onTimeRate ?? null, 'pct', true) || `${tm.late} late mark${tm.late === 1 ? '' : 's'}`} />
        <Figure label="Usual first punch" value={clockOf(tm.avgIn)} sub={comp(tm.avgIn, t?.avgIn ?? null, 'clock', false) || 'average this month'} />
        <Figure label="Hours a day" value={tm.avgHours != null ? `${tm.avgHours} h` : '—'} sub={comp(tm.avgHours, t?.avgHours ?? null, 'hours', true) || 'on complete days'} />
        <Figure label="On-time streak" value={`${a.streak} day${a.streak === 1 ? '' : 's'}`} sub="in a row" t={a.streak >= 10 ? 'positive' : 'neutral'} />
      </Figures>
    </div>
  )
}

function Skeleton() {
  return <div style={{ display: 'grid', gap: S.lg }}>{[140, 220, 200].map((h, i) => <div key={i} style={{ height: h, borderRadius: R.lg, background: C.sunken }} className="ez-fade" />)}</div>
}

function minsIst(ts: string): number {
  const d = new Date(Date.parse(ts) + 5.5 * 3600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
