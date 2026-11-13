'use client'
// components/analytics/TeamInsights.tsx — a manager's team at a glance (ESS → Insights → My team).
//
// What a manager can act on this week: who is in, who is out, the requests waiting on
// them, who has not had a break, whose review is waiting, and the people showing
// several warning signs at once — each with its reasons.

import * as React from 'react'
import { C, F, W, R, S, E, eyebrow, numeric } from '@/lib/ui'
import { api } from '@/lib/ess/api'
import type { TeamAnalytics } from '@/lib/analytics/types'
import { fmt, clockOf, mLabel, dLabel, dLabelLong } from '@/lib/analytics/format'
import { ChartCard, Grid, Figure, Figures, ColumnChart, ScoreRing, TeamDayGrid, DayLegend, Meter, MiniTable, Pill, EmptyChart } from './charts'
import { RiskTable } from './RiskTable'
import { AiBriefCard, Findings, useAiBrief, useFindingsMode } from './AiBrief'
import type { AiBriefResponse } from '@/lib/analytics/ai/types'

/** Where a finding's click lands on this page. */
const SECTION: Record<string, string> = { attendance: 'tm-attendance', leave: 'tm-people', performance: 'tm-ratings', attrition: 'tm-risk', workforce: 'tm-people' }
const AREA: Record<string, string> = { attendance: 'Attendance', leave: 'Leave', performance: 'Reviews', attrition: 'Retention', workforce: 'Team' }
const jump = (area: string) => document.getElementById(SECTION[area] || '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

type Data = TeamAnalytics & { canDept?: boolean; canTeam?: boolean }

export default function TeamInsights({ employeeId }: { employeeId: string }) {
  const [scope, setScope] = React.useState<'TEAM' | 'DEPT'>('TEAM')
  const [d, setD] = React.useState<Data | null>(null)
  const [busy, setBusy] = React.useState(true)
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    let live = true
    setBusy(true); setErr('')
    api(`/api/analytics/team?scope=${scope}`, employeeId)
      .then(b => { if (live) { setD(b as Data); if ((b as Data).scope !== scope) setScope((b as Data).scope) } })
      .catch(e => { if (live) setErr(e?.message || 'Could not load your team.') })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [employeeId, scope])

  // The AI read of the team, once the team has loaded. Names never reach the model —
  // the server swaps them for P1, P2… and back (lib/analytics/ai/facts.ts).
  const ai = useAiBrief(
    refresh => api(`/api/analytics/team/ai?scope=${scope}${refresh ? '&refresh=1' : ''}`, employeeId) as Promise<AiBriefResponse>,
    d && d.members.length ? `${employeeId}|${d.scope}|${d.generatedAt}` : '',
  )
  const [mode, setMode] = useFindingsMode(!!ai.res?.brief?.findings.length)

  if (err) return <EmptyChart text={err} />
  if (!d) return <div style={{ height: 240, borderRadius: R.lg, background: C.sunken }} />

  const today = d.dates.find(x => x === new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)) || ''
  return (
    <div className="ez-fade" style={{ opacity: busy ? 0.55 : 1, transition: 'opacity .2s' }}>
      {d.canDept && d.canTeam && (
        <div role="group" aria-label="Scope" style={{ display: 'inline-flex', gap: 2, padding: 2, background: C.sunken, borderRadius: R.md, marginBottom: S.md }}>
          {(['TEAM', 'DEPT'] as const).map(k => (
            <button key={k} onClick={() => setScope(k)} className="ez-press" style={{
              border: 'none', borderRadius: R.sm, padding: '6px 12px', fontSize: F.tiny, fontFamily: 'inherit', cursor: 'pointer',
              background: scope === k ? C.surface : 'transparent', color: scope === k ? C.brandDeep : C.muted, fontWeight: scope === k ? W.semi : W.medium, boxShadow: scope === k ? E.flat : 'none',
            }}>{k === 'TEAM' ? 'My direct team' : 'My department'}</button>
          ))}
        </div>
      )}

      {d.members.length === 0 ? <EmptyChart text="Nobody reports to you in this view yet." /> : <>
        <Grid min={320}>
          <ChartCard title="Team health" sub="Average of the parts below that have enough data.">
            <div style={{ display: 'flex', gap: S.lg, alignItems: 'center', flexWrap: 'wrap' }}>
              <ScoreRing score={d.health.score} />
              <div style={{ flex: 1, minWidth: 200, display: 'grid', gap: 9 }}>
                {d.health.parts.map(p => (
                  <div key={p.key} title={p.note}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.tiny, marginBottom: 3 }}>
                      <span style={{ color: C.inkSoft }}>{p.label}</span>
                      <strong style={{ color: p.value == null ? C.faint : C.ink, ...numeric }}>{p.value == null ? 'no data' : p.value}</strong>
                    </div>
                    <Meter value={p.value} height={6} t={p.value == null ? 'neutral' : p.value >= 75 ? 'positive' : p.value >= 55 ? 'warning' : 'critical'} />
                  </div>
                ))}
              </div>
            </div>
          </ChartCard>
          <ChartCard title={d.today.off ? 'Today is a day off' : 'Today'} sub={`${d.members.length} ${d.scope === 'DEPT' ? 'in your department' : 'reporting to you'}`}>
            <Figures min={90}>
              <Figure label="In" value={d.today.present} t="positive" />
              <Figure label="Late" value={d.today.late} t={d.today.late ? 'warning' : 'neutral'} />
              <Figure label="On leave" value={d.today.onLeave} t="info" />
              <Figure label="Not in yet" value={d.today.notIn} />
            </Figures>
            <div style={{ ...eyebrow, margin: `${S.sm}px 0 6px` }}>Waiting on you</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill t={d.approvals.leave ? 'warning' : 'neutral'}>{d.approvals.leave} leave</Pill>
              <Pill t={d.approvals.regularisation ? 'warning' : 'neutral'}>{d.approvals.regularisation} attendance correction{d.approvals.regularisation === 1 ? '' : 's'}</Pill>
              <Pill t={d.performance.awaitingYou ? 'warning' : 'neutral'}>{d.performance.awaitingYou} review{d.performance.awaitingYou === 1 ? '' : 's'}</Pill>
              {d.approvals.oldestDays != null && <span style={{ fontSize: F.tiny, color: C.muted }}>oldest {d.approvals.oldestDays} day{d.approvals.oldestDays === 1 ? '' : 's'}</span>}
            </div>
          </ChartCard>
        </Grid>

        <AiBriefCard state={ai} audience="team" />
        <div style={{ marginBottom: S.lg }}>
          <Findings state={ai} rules={d.insights} mode={mode} setMode={setMode} grid onOpen={jump} areaLabel={a => AREA[a]}
            empty="Nothing in your team needs attention right now." />
        </div>

        <ChartCard id="tm-attendance" title={`Attendance, ${mLabel(d.month)}`} sub="Every working day so far, the same codes as the attendance calendar." style={{ marginBottom: S.lg }}>
          <TeamDayGrid today={today} dates={d.dates} members={d.members.map(m => ({ id: m.id, name: m.name, days: m.days, sub: m.onNotice ? 'Serving notice' : m.designation || undefined }))} />
          <DayLegend />
        </ChartCard>

        <ChartCard id="tm-people" title="Your people this month" style={{ marginBottom: S.lg }}>
          <MiniTable head={['Name', 'Present', 'Late', 'Absent', 'Usual in', 'Leave · 90 days', 'Last day off', 'EL left', 'Rating']}
            align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center']}
            rows={d.members.map(m => [
              <span key="n">{m.name}{m.onNotice && <> <Pill t="warning">Notice</Pill></>}</span>,
              `${m.month.present}/${m.month.workdays}`, m.month.late || '—', m.month.absent || '—', clockOf(m.month.avgIn),
              fmt(m.leave90, 'days'), m.lastLeave ? dLabel(m.lastLeave) : <span key="l" style={{ color: C.warning }}>none in a year</span>,
              fmt(m.balance, 'days'), m.rating || '—',
            ])} />
        </ChartCard>

        <Grid min={320}>
          <ChartCard id="tm-risk" title="Needs a conversation" sub="Two or more warning signs. Open a name for the reasons. Only you and HR see this.">
            <RiskTable rows={d.signals} empty="Nobody in your team shows two or more warning signs." />
          </ChartCard>
          <ChartCard id="tm-ratings" title="Ratings in your team" sub={d.performance.cycle ? `Latest finalised rating per person${d.performance.companyTopShare != null ? ` · company top-two share ${Math.round(d.performance.companyTopShare)}%` : ''}` : 'No review cycle yet'}>
            <ColumnChart labels={d.performance.distribution.map(x => x.key)} series={[{ key: 'r', label: 'People', values: d.performance.distribution.map(x => x.value) }]} height={170} emptyText="No finalised ratings in your team yet." />
          </ChartCard>
        </Grid>

        <Grid min={320}>
          <ChartCard title="Out this week">
            <MiniTable head={['Name', 'Leave', 'Dates', 'Days']} align={['left', 'left', 'left', 'right']} empty="Nobody is on approved leave in the next seven days."
              rows={d.outThisWeek.map(o => [o.name, o.type, `${dLabel(o.from)} – ${dLabel(o.to)}`, fmt(o.days, 'days')])} />
          </ChartCard>
          <ChartCard title="Coming up">
            <MiniTable head={['When', 'Who', 'What']} empty="Nothing in the next few weeks."
              rows={d.upcoming.slice(0, 12).map(u => [dLabelLong(u.date), u.name, <Pill key="k" t={u.kind === 'probation' ? 'warning' : 'info'}>{u.note}</Pill>])} />
          </ChartCard>
        </Grid>
      </>}
    </div>
  )
}
