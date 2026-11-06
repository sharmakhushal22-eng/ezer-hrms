'use client'
// components/learning/Team.tsx — a manager's view of their reports' learning. The reach is
// decided on the server from the reporting line; this screen only draws what comes back.
import { useEffect, useMemo, useState } from 'react'
import { C, F, W, S, R, Badge, Button, Card, Field, Input, Person, Select, numeric, IconCheck, IconChevronDown, IconPlus, type Tone } from '@/lib/ui'
import { lmsApi } from '@/lib/lms/client'
import { DueBadge, ProgressBar, SectionHead, STATUS, errorWords, plural } from './shared'

interface Row { enrollment_id: string; employee_id: string; full_name: string; course_title: string; status: string; display_status?: string; mandatory: boolean; due_at: string | null; progress_pct: number; completed_at: string | null; score_pct: number | null }
interface PersonRow { id: string; emp_code: string; full_name: string; designation: string | null; assigned: number; completed: number; in_progress: number; overdue: number; failed: number }
export interface TeamData { is_manager: boolean; can_assign: boolean; people: PersonRow[]; rows: Row[]; requests: Row[] }

function Metric({ value, label, t }: { value: number; label: string; t?: Tone }) {
  const hot = t && value > 0
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: W.semi, fontSize: F.body, color: hot ? (t === 'critical' ? C.critical : C.warning) : C.ink, ...numeric }}>{value}</div>
      <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.2 }}>{label}</div>
    </div>
  )
}

function CourseRows({ rows }: { rows: Row[] }) {
  if (!rows.length) return <div style={{ padding: S.md, fontSize: F.small, color: C.muted }}>No courses assigned yet.</div>
  return (
    <div>
      {rows.map(r => {
        const st = STATUS[r.status] || { label: r.status, t: 'neutral' as Tone }
        return (
          <div key={r.enrollment_id} style={{ display: 'grid', gap: 6, padding: `${S.sm + 2}px ${S.md}px`, borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: F.small, fontWeight: W.medium, marginRight: 4 }}>{r.course_title}</span>
              <Badge t={st.t} size="sm">{st.label}</Badge>
              {r.mandatory && <Badge t="brand" size="sm">Mandatory</Badge>}
              <DueBadge dueAt={r.due_at} status={r.status} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,180px) auto', gap: S.sm, alignItems: 'center', justifyContent: 'start' }}>
              <ProgressBar pct={r.progress_pct} height={5} label={`${r.course_title} progress`} />
              <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{Math.round(Number(r.progress_pct) || 0)}%{r.score_pct != null ? ` · Score ${Number(r.score_pct)}%` : ''}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PersonCard({ p, rows }: { p: PersonRow; rows: Row[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
      <div role="button" tabIndex={0} aria-expanded={open} className="ezl-team-row" onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
        style={{ padding: S.md, cursor: 'pointer' }}>
        <Person name={p.full_name} meta={p.designation} size={32} />
        <div className="ezl-metrics">
          <Metric value={p.assigned} label="Assigned" />
          <Metric value={p.completed} label="Completed" />
          <Metric value={p.in_progress} label="In progress" />
          <Metric value={p.overdue} label="Overdue" t="critical" />
          <Metric value={p.failed} label="Failed" t="warning" />
        </div>
        <span style={{ color: C.muted, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .14s ease', justifySelf: 'end' }}><IconChevronDown size={16} /></span>
      </div>
      {open && <CourseRows rows={rows} />}
    </Card>
  )
}

function RequestRow({ r, first, readOnly, onDone }: { r: Row; first: boolean; readOnly?: boolean; onDone: (message: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const decide = async (approve: boolean) => {
    setBusy(true); setErr('')
    try {
      await lmsApi('/api/lms/team', { action: 'decide', enrollment_id: r.enrollment_id, approve, note: note.trim() || null })
      onDone(approve ? `${r.full_name} can start ${r.course_title}.` : `Request from ${r.full_name} declined.`)
    } catch (e) { setErr(errorWords(e)); setBusy(false) }
  }
  return (
    <div style={{ display: 'grid', gap: S.sm, padding: S.md, borderTop: first ? 0 : `1px solid ${C.line}` }}>
      <div style={{ fontSize: F.small }}><span style={{ fontWeight: W.semi }}>{r.full_name}</span> <span style={{ color: C.muted }}>asked to take</span> <span style={{ fontWeight: W.semi }}>{r.course_title}</span></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.sm }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}><Input data-no-titlecase="" aria-label="Note to the employee" placeholder="Add a note (optional)" value={note} disabled={readOnly} onChange={e => setNote(e.target.value)} /></div>
        <Button variant="primary" disabled={busy || readOnly} onClick={() => decide(true)}>Approve</Button>
        <Button disabled={busy || readOnly} onClick={() => decide(false)}>Decline</Button>
      </div>
      {err && <div role="alert" style={{ fontSize: F.tiny, color: C.critical }}>{err}</div>}
    </div>
  )
}

function AssignForm({ people, onDone, readOnly }: { people: PersonRow[]; onDone: (message: string) => void; readOnly?: boolean }) {
  const [courses, setCourses] = useState<{ id: string; title: string }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [course, setCourse] = useState('')
  const [due, setDue] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    lmsApi<{ courses: { id: string; title: string }[] }>('/api/lms/me/catalog').then(c => setCourses(c.courses || [])).catch(e => { setErr(errorWords(e)); setCourses([]) })
  }, [])
  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), [])
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const allOn = picked.length === people.length
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await lmsApi<{ enrolled: number }>('/api/lms/team', {
        action: 'assign', employee_ids: picked, items: [{ course_id: course }], mandatory,
        due_mode: due ? 'FIXED' : 'NONE', ...(due ? { due_date: due } : {}),
      })
      const skipped = picked.length - r.enrolled
      onDone(r.enrolled ? `Assigned to ${plural(r.enrolled, 'person', 'people')}.${skipped > 0 ? ` ${skipped} already had it.` : ''}` : 'Everyone you picked already has this course.')
      setPicked([]); setCourse(''); setDue(''); setMandatory(false)
    } catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <Card pad={S.md} elevation="flat" style={{ display: 'grid', gap: S.md }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.sm, marginBottom: 6 }}>
          <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>Who is it for?</span>
          <button className="ezl-linkbtn" style={{ fontSize: F.tiny }} onClick={() => setPicked(allOn ? [] : people.map(p => p.id))}>{allOn ? 'Clear' : 'Select everyone'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>
          {people.map(p => (
            <label key={p.id} className="ezl-opt" style={{ display: 'flex', alignItems: 'center', gap: S.sm, padding: `${S.sm}px 10px`, minHeight: 42, border: `1px solid ${C.line}`, borderRadius: R.md, fontSize: F.small, cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} style={{ width: 16, height: 16, flexShrink: 0, accentColor: C.brand }} />
              <span style={{ minWidth: 0 }}>{p.full_name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="ezl-two">
        <Field label="Course"><Select value={course} onChange={e => setCourse(e.target.value)}>
          <option value="">{courses ? 'Choose a course' : 'Loading courses'}</option>
          {(courses || []).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select></Field>
        <Field label="Due date" hint="Leave empty for no due date"><Input type="date" min={today} value={due} onChange={e => setDue(e.target.value)} /></Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: S.sm, fontSize: F.small, minHeight: 42, cursor: 'pointer' }}>
        <input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.brand }} />
        This is mandatory
      </label>
      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
      <div><Button variant="primary" disabled={busy || readOnly || !picked.length || !course} onClick={submit}>{busy ? 'Assigning' : `Assign${picked.length ? ` to ${plural(picked.length, 'person', 'people')}` : ''}`}</Button></div>
    </Card>
  )
}

export default function Team({ data, readOnly, onChanged }: { data: TeamData; readOnly?: boolean; onChanged: () => void }) {
  const [note, setNote] = useState('')
  const [assigning, setAssigning] = useState(false)
  const done = (m: string) => { setNote(m); onChanged() }
  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.xl }}>
      {note && (
        <div role="status" style={{ display: 'flex', gap: S.sm, alignItems: 'center', fontSize: F.small, color: C.inkSoft, background: C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius: R.md, padding: `${S.sm + 2}px ${S.md}px` }}>
          <span style={{ color: C.positive }}><IconCheck size={15} /></span>{note}
        </div>
      )}

      {data.requests.length > 0 && (
        <section>
          <SectionHead title="Course requests" count={data.requests.length} hint="Waiting for your decision" />
          <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
            {data.requests.map((r, i) => <RequestRow key={r.enrollment_id} r={r} first={!i} readOnly={readOnly} onDone={done} />)}
          </Card>
        </section>
      )}

      <section>
        <SectionHead title="Your team" count={data.people.length} action={data.can_assign ? <Button size="sm" icon={assigning ? undefined : <IconPlus size={14} />} disabled={readOnly} onClick={() => setAssigning(a => !a)}>{assigning ? 'Close' : 'Assign a course'}</Button> : undefined} />
        {assigning && <div style={{ marginBottom: S.md }}><AssignForm people={data.people} readOnly={readOnly} onDone={done} /></div>}
        <div style={{ display: 'grid', gap: S.sm }}>
          {data.people.map(p => <PersonCard key={p.id} p={p} rows={data.rows.filter(r => r.employee_id === p.id)} />)}
        </div>
      </section>
    </div>
  )
}
