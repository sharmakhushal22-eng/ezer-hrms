'use client'
// components/learning/admin/EnrolmentsView.tsx — one row per person per course, with what HR
// can do about each. It reads the reports route, so it needs Learning Reports; acting needs
// assign. The action panel opens under its row rather than in a dialog, so the person's
// details stay in view.
import { useEffect, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, F, Field, Person, S, Select, SkeletonRows, Empty, TableWrap, Td, Th, Tr, IconLearning, numeric } from '@/lib/ui'
import {
  ActionNotes, Bar, ENROL_STATUS, Hint, LoadError, Pager, SearchBox, StatusBadge, TextInput, day, plural, row, stack, today, useAction, useLoad, withCompany, type Ctx,
} from './shared'

type Act = 'extend' | 'waive' | 'cancel' | 'reassign' | 'grant'
const OPEN = ['NOT_STARTED', 'IN_PROGRESS']

function actionsFor(status: string): Act[] {
  if (OPEN.includes(status)) return ['extend', 'waive', 'cancel']
  if (status === 'FAILED') return ['grant', 'reassign', 'waive', 'cancel']
  if (status === 'PENDING_APPROVAL') return ['cancel']
  return ['reassign']
}
const LABEL: Record<Act, string> = { extend: 'Extend', waive: 'Waive', cancel: 'Cancel', reassign: 'Reassign', grant: 'Give attempts' }

function GrantForm({ r, busy, onSubmit }: { r: any; busy: boolean; onSubmit: (body: any) => void }) {
  const quizzes = useLoad<any>(() => lmsApi(`/api/lms/admin/enrollments/${r.enrollment_id}`), [r.enrollment_id])
  const list: any[] = useMemo(() => quizzes.data?.quizzes || [], [quizzes.data])
  const [picked, setPicked] = useState('')
  const [n, setN] = useState('1')
  const [reason, setReason] = useState('')
  // The quiz that locked them, unless HR picks another.
  const lesson: string = picked || (list.find(q => q.locked) || list[0])?.lesson_id || ''
  if (quizzes.error) return <LoadError error={quizzes.error} />
  if (!list.length) return <Hint>{quizzes.loading ? 'Finding their quizzes…' : 'This person has not reached a quiz yet, so there is nothing to give attempts on.'}</Hint>
  return (
    <div style={{ ...row(), alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        <Field label="Quiz">
          <Select value={lesson} onChange={e => setPicked(e.target.value)}>
            {list.map(q => <option key={q.lesson_id} value={q.lesson_id}>{q.quiz_title}: best {q.best_pct ?? 0}%, used {q.attempts_used}{q.attempts_allowed != null ? ` of ${q.attempts_allowed}` : ''}{q.locked ? ' (out of attempts)' : ''}</option>)}
          </Select>
        </Field>
      </div>
      <div style={{ width: 110 }}><Field label="Attempts"><TextInput type="number" min={1} max={10} value={n} onChange={e => setN(e.target.value)} /></Field></div>
      <div style={{ flex: '1 1 200px' }}><Field label="Reason"><TextInput value={reason} onChange={e => setReason(e.target.value)} /></Field></div>
      <Button variant="primary" disabled={busy || !lesson} onClick={() => onSubmit({ action: 'grant_attempts', lesson_id: lesson, attempts: Number(n) || 1, reason })}>Give attempts</Button>
    </div>
  )
}

function ActionForm({ act, r, busy, onSubmit, onClose }: { act: Act; r: any; busy: boolean; onSubmit: (body: any) => void; onClose: () => void }) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const needDate = act === 'extend'
  const needReason = act === 'waive'
  return (
    <div style={stack(S.sm)}>
      <div style={row()}>
        <span style={{ fontSize: F.small, fontWeight: 600, color: C.ink }}>{LABEL[act]}: {r.full_name}, {r.course_title}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {act === 'grant' ? <GrantForm r={r} busy={busy} onSubmit={onSubmit} /> : (
        <>
          <Hint>
            {act === 'extend' && 'Moves their due date. The change is recorded in the audit log.'}
            {act === 'waive' && 'They no longer have to do this, and it stops counting against them.'}
            {act === 'cancel' && 'Takes this off their list. The record stays.'}
            {act === 'reassign' && 'Starts a fresh attempt on the live version. The earlier record stays as it was.'}
          </Hint>
          <div style={{ ...row(), alignItems: 'flex-end' }}>
            {(act === 'extend' || act === 'reassign') && (
              <div style={{ width: 190 }}>
                <Field label={act === 'extend' ? 'New due date' : 'Due date (optional)'} required={needDate}><TextInput type="date" min={today()} value={date} onChange={e => setDate(e.target.value)} /></Field>
              </div>
            )}
            <div style={{ flex: '1 1 260px' }}><Field label="Reason" required={needReason}><TextInput value={reason} onChange={e => setReason(e.target.value)} /></Field></div>
            <Button variant="primary" disabled={busy || (needDate && !date) || (needReason && !reason.trim())}
              onClick={() => onSubmit({ action: act, due_date: date || undefined, reason: reason.trim() || undefined })}>{LABEL[act]}</Button>
          </div>
        </>
      )}
    </div>
  )
}

function EnrolmentRow({ r, canAct, busy, panel, onPanel, onRemind, onSubmit }: {
  r: any; canAct: boolean; busy: boolean; panel: Act | null; onPanel: (a: Act | null) => void; onRemind: () => void; onSubmit: (body: any) => void
}) {
  const acts = actionsFor(r.status)
  const open = OPEN.includes(r.status)
  return (
    <>
      <Tr selected={!!panel}>
        <Td style={{ minWidth: 190 }}><Person name={r.full_name} meta={[r.emp_code, r.dept_name].filter(Boolean).join(' · ') || (r.learner_kind === 'CANDIDATE' ? 'Candidate' : '')} /></Td>
        <Td style={{ minWidth: 190 }}>
          <div style={{ color: C.ink, fontWeight: 500 }}>{r.course_title}</div>
          <div style={{ fontSize: F.micro, color: C.muted, ...numeric }}>{r.course_code} · v{r.version_no}{r.mandatory ? ' · Mandatory' : ''}{r.cycle_no > 1 ? ` · Round ${r.cycle_no}` : ''}</div>
        </Td>
        <Td><StatusBadge map={ENROL_STATUS} value={r.display_status} /></Td>
        <Td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Bar pct={Number(r.progress_pct)} width={70} /><span style={{ fontSize: F.tiny, ...numeric }}>{Math.round(Number(r.progress_pct))}%</span></div></Td>
        <Td align="right">{r.score_pct != null ? `${Number(r.score_pct)}%` : '-'}</Td>
        <Td style={{ whiteSpace: 'nowrap' }}>{day(r.due_at)}</Td>
        {canAct && (
          <Td style={{ whiteSpace: 'nowrap' }}>
            <div style={row(4)}>
              {acts.map(a => <Button key={a} size="sm" variant={a === 'cancel' || a === 'waive' ? 'ghost' : 'secondary'} onClick={() => onPanel(panel === a ? null : a)}>{LABEL[a]}</Button>)}
              {open && r.employee_id && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemind}>Remind</Button>}
            </div>
          </Td>
        )}
      </Tr>
      {panel && (
        <tr><td colSpan={canAct ? 7 : 6} style={{ padding: S.md, background: C.sunken, borderBottom: `1px solid ${C.line}` }}>
          <ActionForm key={panel} act={panel} r={r} busy={busy} onSubmit={onSubmit} onClose={() => onPanel(null)} />
        </td></tr>
      )}
    </>
  )
}

export default function EnrolmentsView({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [course, setCourse] = useState('')
  const [page, setPage] = useState(0)
  const [panel, setPanel] = useState<{ id: string; act: Act } | null>(null)
  const a = useAction()

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(0) }, 300); return () => clearTimeout(t) }, [q])

  const courses = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/courses')), [ctx.company])
  const list = useLoad<any>(() => {
    const p = new URLSearchParams({ page: String(page) })
    if (search) p.set('q', search)
    if (status) p.set('status', status)
    if (course) p.set('course', course)
    return lmsApi(withCompany(ctx, `/api/lms/admin/reports?${p}`))
  }, [ctx.company, page, search, status, course])

  const act = async (id: string, body: any, ok: string) => {
    const r = await a.run(() => lmsApi(`/api/lms/admin/enrollments/${id}`, body), ok)
    if (r) { setPanel(null); list.reload() }
  }
  const rows: any[] = list.data?.rows || []
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      <ActionNotes a={a} />
      <div style={{ ...row(), marginBottom: S.md }}>
        <SearchBox value={q} onChange={setQ} placeholder="Name, employee code or course" />
        <Select aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(0) }} style={{ width: 170 }}>
          <option value="">All open and finished</option>
          {Object.entries(ENROL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select aria-label="Course" value={course} onChange={e => { setCourse(e.target.value); setPage(0) }} style={{ width: 240 }}>
          <option value="">All courses</option>
          {(courses.data?.courses || []).map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
        {list.data && <Hint style={{ marginLeft: 'auto' }}>{plural(list.data.total, 'enrolment')}</Hint>}
      </div>
      {list.loading && !list.data ? <SkeletonRows /> : rows.length ? (
        <TableWrap minWidth={1040} stagger={false}>
          <thead><tr><Th>Person</Th><Th>Course</Th><Th>Status</Th><Th>Progress</Th><Th align="right">Score</Th><Th>Due</Th>{ctx.caps.assign && <Th>Actions</Th>}</tr></thead>
          <tbody>
            {rows.map(r => (
              <EnrolmentRow key={r.enrollment_id} r={r} canAct={ctx.caps.assign} busy={a.busy} panel={panel && panel.id === r.enrollment_id ? panel.act : null}
                onPanel={x => { a.clear(); setPanel(x ? { id: r.enrollment_id, act: x } : null) }}
                onRemind={() => act(r.enrollment_id, { action: 'remind' }, `Reminder sent to ${r.full_name}.`)}
                onSubmit={body => act(r.enrollment_id, body, 'Done.')} />
            ))}
          </tbody>
        </TableWrap>
      ) : <Empty icon={<IconLearning size={22} />} title="Nobody matches" hint="Nobody is enrolled yet, or the filters leave nothing." />}
      {list.data && <Pager page={list.data.page} size={list.data.size} total={list.data.total} shown={rows.length} onPage={setPage} />}
    </>
  )
}
