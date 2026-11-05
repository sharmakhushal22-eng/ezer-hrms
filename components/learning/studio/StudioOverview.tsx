'use client'
// components/learning/studio/StudioOverview.tsx — where learning stands, at a glance.
//
// Everything here is the overview route's own figures (lms_overview). People's results come
// back only for someone with Learning Reports, so without them this shows the content
// side and says where the rest lives, rather than tiles of zeros.
import { IconAlert, IconCheck, IconClock } from '@/lib/ui'
import { plural, type Ctx } from '../admin/shared'
import { CourseArt, Skel } from '../shared'
import { GBook, GLayers, GTarget, GUsers, GSparkle, GArrowRight } from '../glyphs'
import { linkProps, to } from '../app/router'
import { CountUp } from '../motion/CountUp'

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)
const inr = (n: number) => Math.round(n).toLocaleString('en-IN')
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`))

function Kpi({ icon, value, label, sub, t, href }: { icon: React.ReactNode; value: React.ReactNode; label: string; sub?: string; t?: string; href?: string }) {
  const body = <><i>{icon}</i><b>{value}</b><span>{label}</span>{sub && <small>{sub}</small>}</>
  if (href) return <a className="lx-st-kpi" data-t={t} data-link="1" style={{ textDecoration: 'none' }} {...linkProps(href)}>{body}</a>
  return <div className="lx-st-kpi" data-t={t}>{body}</div>
}

function Donut({ e }: { e: any }) {
  const total = Number(e.total) || 0
  const done = Number(e.completed) || 0, going = Number(e.in_progress) || 0, late = Number(e.overdue) || 0
  // Overdue rows are also counted as in progress or not started, so the ring shows done,
  // in progress (less what is overdue) and overdue as three slices that never overlap.
  const p1 = total ? (done / total) * 100 : 0
  const p2 = p1 + (total ? (Math.max(0, going - late) / total) * 100 : 0)
  const p3 = p2 + (total ? (late / total) * 100 : 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
      <div className="lx-st-donut" style={{ ['--p1' as string]: `${p1}%`, ['--p2' as string]: `${p2}%`, ['--p3' as string]: `${p3}%` }} role="img"
        aria-label={`${pct(done, total)}% of enrolments completed`}>
        <div><div><b>{pct(done, total)}%</b><span>completed</span></div></div>
      </div>
      <div className="lx-st-legend" style={{ flex: '1 1 180px' }}>
        <div><i style={{ background: 'var(--ez-positive)' }} /><span>Completed</span><b>{done.toLocaleString('en-IN')}</b></div>
        <div><i style={{ background: 'var(--ez-brand)' }} /><span>In progress</span><b>{going.toLocaleString('en-IN')}</b></div>
        <div><i style={{ background: 'var(--ez-critical)' }} /><span>Overdue</span><b>{late.toLocaleString('en-IN')}</b></div>
        <div><i style={{ background: 'var(--ez-sunken)', boxShadow: 'inset 0 0 0 1px var(--ez-line)' }} /><span>Not started</span><b>{(Number(e.not_started) || 0).toLocaleString('en-IN')}</b></div>
        {!!e.pending_approval && <div><i style={{ background: 'var(--ez-warning)' }} /><span>Waiting for a manager</span><b>{e.pending_approval}</b></div>}
      </div>
    </div>
  )
}

function Departments({ rows }: { rows: any[] }) {
  const top = rows.slice(0, 8)
  if (!top.length) return <div className="lx-st-hint">Nobody is enrolled yet.</div>
  return (
    <div className="lx-st-hbars">
      {top.map(r => (
        <div key={r.name} className="lx-st-hbar" title={`${r.completed} of ${r.total} completed, ${r.overdue} overdue`}>
          <span>{r.name}</span>
          <div className="lx-st-hbar-track">
            <i style={{ width: `${pct(r.completed, r.total)}%` }} />
            {!!r.overdue && <i data-t="overdue" style={{ left: `${pct(r.completed, r.total)}%`, width: `${pct(r.overdue, r.total)}%` }} />}
          </div>
          <b>{pct(r.completed, r.total)}%</b>
        </div>
      ))}
    </div>
  )
}

function Months({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="lx-st-hint">No completions in the last six months.</div>
  const top = Math.max(1, ...rows.map(r => Number(r.completed)))
  return (
    <div className="lx-st-cols">
      {rows.map(r => (
        <div key={r.month} className="lx-st-col">
          <b>{r.completed}</b>
          <i style={{ height: `${Math.max(3, (Number(r.completed) / top) * 120)}px` }} />
          <span>{monthName(r.month)}</span>
        </div>
      ))}
    </div>
  )
}

function Courses({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="lx-st-hint">Nobody is enrolled yet.</div>
  return (
    <div>
      {rows.slice(0, 6).map((r, i) => (
        <a key={r.course_id} className="lx-st-rank" style={{ textDecoration: 'none', color: 'inherit' }} {...linkProps(to.studio('courses', r.course_id))}>
          <em>{i + 1}</em>
          <CourseArt id={r.course_id} title={r.name} word={false} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ez-muted)', marginTop: 2 }} className="lx-num">
              {plural(r.total, 'learner')} · {r.completed} done{r.overdue ? ` · ${r.overdue} overdue` : ''}{r.avg_score != null ? ` · avg ${r.avg_score}%` : ''}{r.rating != null ? ` · ★ ${r.rating}` : ''}
            </div>
          </div>
          <span className="lx-tag lx-tag--positive lx-num">{pct(r.completed, r.total)}%</span>
        </a>
      ))}
    </div>
  )
}

function Full({ rows }: { rows: any[] }) {
  if (rows.length <= 6) return null
  return (
    <details className="lx-st-card">
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>All {rows.length} courses by enrolment</summary>
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--ez-muted)' }}>
            {['Course', 'Enrolled', 'Completed', 'Overdue', 'Failed', 'Avg score', 'Rating', 'Completion'].map(h => <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)', fontWeight: 650 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.course_id}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)' }} className="lx-num">{r.total}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)' }} className="lx-num">{r.completed}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)', color: r.overdue ? 'var(--ez-critical)' : undefined }} className="lx-num">{r.overdue}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)' }} className="lx-num">{r.failed}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)' }} className="lx-num">{r.avg_score != null ? `${r.avg_score}%` : '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)' }} className="lx-num">{r.rating != null ? `${r.rating} / 5` : '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--ez-line)', width: 160 }}><div className="lx-bar"><i style={{ width: `${pct(r.completed, r.total)}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export default function StudioOverview({ ctx, overview: o }: { ctx: Ctx; overview: any }) {
  // Null while the figures load: the app starts with the light answer, which has none.
  if (!o) return <div style={{ display: 'grid', gap: 16 }}><Skel h={110} r={18} /><Skel h={110} r={18} /><Skel h={260} r={18} /></div>
  const c = o.courses || {}
  const results = ctx.caps.reports && o.enrollments
  const e = o.enrollments || {}, m = o.compliance || {}
  return (
    <>
      <div className="lx-st-kpis lx-in">
        <Kpi icon={<GBook size={18} />} value={<CountUp value={c.published ?? 0} />} label="Published courses" sub={`${c.total ?? 0} in all · ${c.draft ?? 0} draft${c.archived ? ` · ${c.archived} archived` : ''}`} t="positive" href={ctx.caps.viewContent ? to.studio('courses') : undefined} />
        <Kpi icon={<IconClock size={18} />} value={<CountUp value={c.in_review ?? 0} />} label="Waiting for review" sub="versions sent for approval" t={c.in_review ? 'warning' : undefined} href={ctx.caps.viewContent ? to.studio('courses') : undefined} />
        <Kpi icon={<GLayers size={18} />} value={<CountUp value={o.paths ?? 0} />} label="Learning paths" sub="published" href={to.studio('paths')} />
        <Kpi icon={<GTarget size={18} />} value={<CountUp value={o.assignments ?? 0} />} label="Active assignments" sub="giving out learning now" href={ctx.caps.viewAssignments ? to.studio('assignments') : undefined} />
      </div>

      {results ? (
        <>
          <div className="lx-st-kpis lx-in lx-in-1" data-n="5">
            <Kpi icon={<GUsers size={18} />} value={<CountUp value={o.learners ?? 0} format={inr} />} label="Learners" sub={plural(e.total || 0, 'enrolment')} />
            <Kpi icon={<IconCheck size={18} />} value={<CountUp value={pct(e.completed, e.total)} suffix="%" />} label="Completion rate" sub={`${e.completed} of ${e.total}`} t="positive" />
            <Kpi icon={<IconAlert size={18} />} value={<CountUp value={e.overdue ?? 0} />} label="Overdue" sub="past their due date" t={e.overdue ? 'critical' : undefined} href={to.studio('reports')} />
            <Kpi icon={<GSparkle size={18} />} value={<CountUp value={pct(m.completed, m.assigned)} suffix="%" />} label="Mandatory compliance" sub={`${m.completed ?? 0} of ${m.assigned ?? 0}${m.overdue ? ` · ${m.overdue} overdue` : ''}`} t="gold" />
            <Kpi icon={<IconAlert size={18} />} value={<CountUp value={e.failed ?? 0} />} label="Out of attempts" sub="failed a required quiz" t={e.failed ? 'critical' : undefined} />
          </div>
          <div className="lx-st-two lx-in lx-in-2">
            <section className="lx-st-card">
              <div className="lx-st-card-head"><div><h3>Where every enrolment stands</h3><p>All courses, all learners in view.</p></div></div>
              <Donut e={e} />
            </section>
            <section className="lx-st-card">
              <div className="lx-st-card-head"><div><h3>Completions by month</h3><p>The last six months.</p></div></div>
              <Months rows={o.completions_by_month || []} />
            </section>
          </div>
          <div className="lx-st-two lx-in lx-in-3">
            <section className="lx-st-card">
              <div className="lx-st-card-head">
                <div><h3>Most taken courses</h3><p>By people enrolled. Open one to edit it.</p></div>
                <a className="lx-sec-link" {...linkProps(to.studio('reports'))}>Reports <GArrowRight size={14} /></a>
              </div>
              <Courses rows={o.by_course || []} />
            </section>
            <section className="lx-st-card">
              <div className="lx-st-card-head"><div><h3>By department</h3><p>Completed, with overdue in red.</p></div></div>
              <Departments rows={o.by_department || []} />
            </section>
          </div>
          <Full rows={o.by_course || []} />
        </>
      ) : (
        <div className="lx-note"><GSparkle size={16} /><span>People&apos;s results appear here for anyone with Learning Reports access.</span></div>
      )}
    </>
  )
}
