'use client'
// components/learning/admin/OverviewTab.tsx — where learning stands.
//
// The route returns people's results only to someone with Learning Reports. Anyone else gets
// the content counts alone, so `enrollments`, `compliance` and the breakdowns can be absent,
// and this screen then shows what exists rather than empty result tiles.
import { Empty, F, IconLearning, S, Stat, StatRow, TableWrap, Td, Th, Tr, numeric } from '@/lib/ui'
import { Bar, Hint, Panel, PctBar, plural, type Ctx } from './shared'

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`))

function ContentStats({ o }: { o: any }) {
  const c = o.courses || {}
  return (
    <StatRow>
      <Stat label="Published courses" value={c.published ?? 0} sub={`${c.total ?? 0} in all`} t="positive" />
      <Stat label="Draft courses" value={c.draft ?? 0} />
      <Stat label="In review" value={c.in_review ?? 0} t={c.in_review ? 'warning' : 'neutral'} />
      <Stat label="Learning paths" value={o.paths ?? 0} sub="published" />
      <Stat label="Active assignments" value={o.assignments ?? 0} />
    </StatRow>
  )
}

function ResultStats({ o }: { o: any }) {
  const e = o.enrollments, m = o.compliance
  return (
    <StatRow>
      <Stat label="Learners" value={(o.learners ?? 0).toLocaleString('en-IN')} sub={`${plural(e.total, 'enrolment')}`} />
      <Stat label="Completion rate" value={`${pct(e.completed, e.total)}%`} sub={`${e.completed} of ${e.total}`} t="positive" />
      <Stat label="Overdue" value={e.overdue} t={e.overdue ? 'critical' : 'neutral'} sub="past their due date" />
      <Stat label="Failed" value={e.failed} t={e.failed ? 'critical' : 'neutral'} sub="out of attempts" />
      <Stat label="Mandatory compliance" value={`${pct(m.completed, m.assigned)}%`} sub={`${m.completed} of ${m.assigned}`} t="brand" />
    </StatRow>
  )
}

function ByDepartment({ rows }: { rows: any[] }) {
  return (
    <Panel title="By department" hint="Completed against everyone enrolled.">
      {rows.length ? (
        <TableWrap stagger={false} style={{ boxShadow: 'none' }}>
          <thead><tr><Th>Department</Th><Th align="right">Enrolled</Th><Th align="right">Completed</Th><Th align="right">Overdue</Th><Th>Completion</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.name}>
                <Td strong>{r.name}</Td><Td align="right">{r.total}</Td><Td align="right">{r.completed}</Td><Td align="right">{r.overdue}</Td>
                <Td><PctBar value={r.completed} total={r.total} /></Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Hint>Nobody is enrolled yet.</Hint>}
    </Panel>
  )
}

function ByCourse({ rows }: { rows: any[] }) {
  return (
    <Panel title="By course" hint="The 25 courses with the most people enrolled.">
      {rows.length ? (
        <TableWrap stagger={false} minWidth={720} style={{ boxShadow: 'none' }}>
          <thead><tr><Th>Course</Th><Th align="right">Enrolled</Th><Th align="right">Completed</Th><Th align="right">Overdue</Th><Th align="right">Failed</Th><Th align="right">Avg score</Th><Th align="right">Rating</Th><Th>Completion</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.course_id}>
                <Td strong>{r.name}</Td><Td align="right">{r.total}</Td><Td align="right">{r.completed}</Td><Td align="right">{r.overdue}</Td><Td align="right">{r.failed}</Td>
                <Td align="right">{r.avg_score != null ? `${r.avg_score}%` : '-'}</Td><Td align="right">{r.rating != null ? `${r.rating} / 5` : '-'}</Td>
                <Td><PctBar value={r.completed} total={r.total} /></Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Hint>Nobody is enrolled yet.</Hint>}
    </Panel>
  )
}

function ByMonth({ rows }: { rows: any[] }) {
  const top = Math.max(1, ...rows.map(r => Number(r.completed)))
  return (
    <Panel title="Completions by month" hint="The last six months.">
      {rows.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: `${S.sm}px ${S.md}px`, alignItems: 'center' }}>
          {rows.map(r => [
            <span key={`${r.month}-m`} style={{ fontSize: F.small }}>{monthName(r.month)}</span>,
            <Bar key={`${r.month}-b`} pct={(Number(r.completed) / top) * 100} width="100%" />,
            <span key={`${r.month}-n`} style={{ fontSize: F.small, ...numeric }}>{r.completed}</span>,
          ])}
        </div>
      ) : <Hint>No completions in the last six months.</Hint>}
    </Panel>
  )
}

export default function OverviewTab({ ctx, overview, loading }: { ctx: Ctx; overview: any; loading: boolean }) {
  if (!overview) return loading ? null : <Empty icon={<IconLearning size={22} />} title="Nothing to show yet" />
  const results = ctx.caps.reports && overview.enrollments
  return (
    <>
      <ContentStats o={overview} />
      {results ? (
        <>
          <ResultStats o={overview} />
          <ByDepartment rows={overview.by_department || []} />
          <ByCourse rows={overview.by_course || []} />
          <ByMonth rows={overview.completions_by_month || []} />
        </>
      ) : <Hint>People&apos;s results appear here for anyone with Learning Reports access.</Hint>}
    </>
  )
}
