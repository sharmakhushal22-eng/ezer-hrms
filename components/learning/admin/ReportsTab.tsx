'use client'
// components/learning/admin/ReportsTab.tsx — the record, filtered and exported. The server
// applies a branch person's location itself, so the Location filter is simply not offered.
import { useEffect, useMemo, useState } from 'react'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { Badge, Button, C, Empty, F, Field, IconDownload, IconReports, Person, S, Select, SkeletonRows, TableWrap, Tabs, Td, Th, Tr, numeric } from '@/lib/ui'
import {
  ActionNotes, Bar, ENROL_STATUS, Hint, LoadError, Pager, SearchBox, StatusBadge, TextInput, day, grid, plural, row, useAction, useLoad, withCompany, type Ctx,
} from './shared'

interface Filters { course: string; department: string; location: string; status: string; mandatory: string; from: string; to: string }
const NONE: Filters = { course: '', department: '', location: '', status: '', mandatory: '', from: '', to: '' }

const STATUS_OPTIONS = ['OVERDUE', 'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED', 'WAIVED', 'CANCELLED', 'PENDING_APPROVAL', 'REJECTED']
const EXPORTS: { kind: string; label: string }[] = [
  { kind: 'enrollments', label: 'Enrolments' }, { kind: 'compliance', label: 'Compliance' }, { kind: 'overdue', label: 'Overdue' }, { kind: 'failed', label: 'Failed' }, { kind: 'quizzes', label: 'Assessments' },
]

/** The day after, because the filter's upper bound is exclusive. */
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00+05:30`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString() }

function toParams(f: Filters, q: string) {
  const p = new URLSearchParams()
  if (f.course) p.set('course', f.course)
  if (f.department) p.set('department', f.department)
  if (f.location) p.set('location', f.location)
  if (f.status) p.set('status', f.status)
  if (f.mandatory) p.set('mandatory', f.mandatory)
  if (f.from) p.set('from', `${f.from}T00:00:00+05:30`)
  if (f.to) p.set('to', nextDay(f.to))
  if (q) p.set('q', q)
  return p
}

function FilterBar({ ctx, f, set, courses, departments, locations }: { ctx: Ctx; f: Filters; set: (p: Partial<Filters>) => void; courses: any[]; departments: any[]; locations: any[] }) {
  return (
    <div style={{ ...grid(170), marginBottom: S.md }}>
      <Field label="Course">
        <Select value={f.course} onChange={e => set({ course: e.target.value })}><option value="">All courses</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
      </Field>
      <Field label="Department">
        <Select value={f.department} onChange={e => set({ department: e.target.value })}><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</Select>
      </Field>
      {!ctx.branchOnly && (
        <Field label="Location">
          <Select value={f.location} onChange={e => set({ location: e.target.value })}><option value="">All locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}</Select>
        </Field>
      )}
      <Field label="Status">
        <Select value={f.status} onChange={e => set({ status: e.target.value })}><option value="">All, except cancelled</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{ENROL_STATUS[s].label}</option>)}</Select>
      </Field>
      <Field label="Mandatory">
        <Select value={f.mandatory} onChange={e => set({ mandatory: e.target.value })}><option value="">Both</option><option value="true">Mandatory</option><option value="false">Optional</option></Select>
      </Field>
      <Field label="Assigned from"><TextInput type="date" value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} /></Field>
      <Field label="Assigned to"><TextInput type="date" value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} /></Field>
    </div>
  )
}

function Rows({ rows, multi }: { rows: any[]; multi: boolean }) {
  return (
    <TableWrap minWidth={1010} stagger={false}>
      <thead>
        <tr><Th>Person</Th>{multi && <Th>Company</Th>}<Th>Department</Th><Th>Course</Th><Th>Status</Th><Th>Progress</Th><Th align="right">Score</Th><Th>Assigned</Th><Th>Due</Th><Th>Completed</Th></tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <Tr key={r.enrollment_id}>
            <Td style={{ minWidth: 180 }}><Person name={r.full_name} meta={[r.emp_code, r.designation].filter(Boolean).join(' · ') || (r.learner_kind === 'CANDIDATE' ? 'Candidate' : '')} /></Td>
            {multi && <Td>{r.company_code}</Td>}
            <Td><div>{r.dept_name || '-'}</div>{r.location_name && <div style={{ fontSize: F.micro, color: C.muted }}>{r.location_name}</div>}</Td>
            <Td style={{ minWidth: 190 }}>
              <div style={{ color: C.ink, fontWeight: 500 }}>{r.course_title}</div>
              <div style={{ ...row(4), fontSize: F.micro, color: C.muted, ...numeric }}>{r.course_code} · v{r.version_no}{r.mandatory && <Badge size="sm" t="info">Mandatory</Badge>}</div>
            </Td>
            <Td><StatusBadge map={ENROL_STATUS} value={r.display_status} /></Td>
            <Td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Bar pct={Number(r.progress_pct)} width={64} /><span style={{ fontSize: F.tiny, ...numeric }}>{Math.round(Number(r.progress_pct))}%</span></div></Td>
            <Td align="right">{r.score_pct != null ? `${Number(r.score_pct)}%` : '-'}</Td>
            <Td style={{ whiteSpace: 'nowrap' }}>{day(r.enrolled_at)}</Td><Td style={{ whiteSpace: 'nowrap' }}>{day(r.due_at)}</Td>
            <Td style={{ whiteSpace: 'nowrap' }}>{day(r.completed_at)}{r.expires_at && <div style={{ fontSize: F.micro, color: C.muted }}>valid until {day(r.expires_at)}</div>}</Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

function Assessments({ ctx, course }: { ctx: Ctx; course: string }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, `/api/lms/admin/reports?kind=quizzes${course ? `&course=${course}` : ''}`)), [ctx.company, course])
  const rows: any[] = list.data?.rows || []
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {list.loading && !list.data ? <SkeletonRows /> : rows.length ? (
        <TableWrap minWidth={820} stagger={false}>
          <thead><tr><Th>Quiz</Th><Th>Course</Th><Th align="right">Pass mark</Th><Th align="right">Attempts</Th><Th align="right">Learners</Th><Th align="right">Average</Th><Th>Pass rate</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.quiz_id}>
                <Td strong>{r.title}</Td><Td>{r.course_title}</Td><Td align="right">{r.pass_pct}%</Td><Td align="right">{r.attempts}</Td><Td align="right">{r.learners}</Td>
                <Td align="right">{r.avg_pct != null ? `${r.avg_pct}%` : '-'}</Td>
                <Td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Bar pct={Number(r.pass_rate)} width={90} t={Number(r.pass_rate) < 50 ? 'warning' : 'brand'} /><span style={{ fontSize: F.tiny, ...numeric }}>{r.pass_rate != null ? `${r.pass_rate}%` : '-'}</span></div></Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Empty icon={<IconReports size={22} />} title="No quiz attempts yet" hint="Figures appear once people have sat a quiz. The lowest pass rates come first." />}
      {rows.length > 0 && <Hint style={{ marginTop: S.sm }}>Lowest pass rate first, so the quizzes that may need attention are at the top.</Hint>}
    </>
  )
}

export default function ReportsTab({ ctx }: { ctx: Ctx }) {
  const [view, setView] = useState<'rows' | 'assessments'>('rows')
  const [f, setF] = useState(NONE)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const a = useAction()
  const set = (p: Partial<Filters>) => { setF(x => ({ ...x, ...p })); setPage(0) }

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(0) }, 300); return () => clearTimeout(t) }, [q])

  const courses = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/courses')), [ctx.company])
  const look = useLoad<any>(() => (ctx.company ? lmsApi(`/api/lms/admin/lookups?company=${ctx.company}`) : Promise.resolve(null)), [ctx.company])
  const params = useMemo(() => toParams(f, search).toString(), [f, search])
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, `/api/lms/admin/reports?page=${page}${params ? `&${params}` : ''}`)), [ctx.company, page, params])

  const exportFile = (kind: string) => a.run(() => lmsDownload(
    withCompany(ctx, `/api/lms/admin/reports?format=xlsx&kind=${kind}${params ? `&${params}` : ''}`),
    `learning-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`))

  const rows: any[] = list.data?.rows || []
  const filtered = !!params
  return (
    <>
      <ActionNotes a={a} />
      <FilterBar ctx={ctx} f={f} set={set} courses={courses.data?.courses || []} departments={look.data?.departments || []} locations={look.data?.locations || []} />
      <div style={{ ...row(), marginBottom: S.md, justifyContent: 'space-between' }}>
        <div style={row()}>
          <SearchBox value={q} onChange={setQ} placeholder="Name, employee code or course" />
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setF(NONE); setQ(''); setPage(0) }}>Clear filters</Button>}
        </div>
        <div style={row(6)}>
          <span style={{ fontSize: F.tiny, color: C.muted }}>Export to Excel:</span>
          {EXPORTS.map(x => <Button key={x.kind} size="sm" icon={<IconDownload size={13} />} disabled={a.busy} onClick={() => exportFile(x.kind)}>{x.label}</Button>)}
        </div>
      </div>
      <Tabs tabs={[{ key: 'rows', label: 'People', count: list.data?.total }, { key: 'assessments', label: 'Assessments' }]} value={view} onChange={setView} />
      {view === 'assessments' ? <Assessments ctx={ctx} course={f.course} /> : (
        <>
          <LoadError error={list.error} setup={list.setup} />
          {list.loading && !list.data ? <SkeletonRows /> : rows.length
            ? <Rows rows={rows} multi={ctx.companies.length > 1 && !ctx.company} />
            : <Empty icon={<IconReports size={22} />} title="Nothing matches" hint={filtered ? 'Clear a filter to see more.' : 'Report rows appear once people are enrolled.'} />}
          {list.data && <Pager page={list.data.page} size={list.data.size} total={list.data.total} shown={rows.length} onPage={setPage} />}
          {list.data?.total > 0 && list.loading && <Hint style={{ marginTop: S.xs }}>Updating {plural(list.data.total, 'row')}…</Hint>}
        </>
      )}
    </>
  )
}
