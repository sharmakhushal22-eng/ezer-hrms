'use client'
// components/learning/admin/CoursesTab.tsx — every course, and starting a new one.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import {
  Badge, Button, C, Empty, F, Field, IconLearning, IconPlus, R, S, Select, SkeletonRows, TableWrap, Td, Th, Tr, W, numeric,
} from '@/lib/ui'
import {
  ActionNotes, COURSE_STATUS, Hint, LoadError, NeedCompany, Panel, SearchBox, StatusBadge, TextInput,
  companyName, day, row, useAction, useLoad, withCompany, type Ctx,
} from './shared'

function Thumb({ src }: { src: string | null }) {
  const box = { width: 56, height: 36, borderRadius: R.sm, flexShrink: 0, border: `1px solid ${C.line}` } as const
  if (src) return <img src={src} alt="" style={{ ...box, objectFit: 'cover', display: 'block' }} />
  return <div style={{ ...box, background: C.sunken, color: C.faint, display: 'grid', placeItems: 'center' }}><IconLearning size={16} /></div>
}

function Versions({ c }: { c: any }) {
  return (
    <span style={row(4)}>
      {c.live && <Badge t="positive" size="sm">live v{c.live.version_no}</Badge>}
      {c.draft && <Badge t={c.draft.status === 'IN_REVIEW' ? 'warning' : 'neutral'} size="sm">{c.draft.status === 'IN_REVIEW' ? 'in review' : 'draft'} v{c.draft.version_no}</Badge>}
    </span>
  )
}

function NewCourse({ ctx, onCreated, onClose }: { ctx: Ctx; onCreated: (id: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const a = useAction()
  const create = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/courses', { company_id: ctx.company, title }))
    if (r) onCreated(r.course.id)
  }
  return (
    <Panel title="New course" hint="Give it a working title. You can change it later, and nothing reaches anyone until it is published and assigned.">
      <ActionNotes a={a} />
      <div style={{ ...row(), alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 320px' }}>
          <Field label="Course title" required>
            <TextInput autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && title.trim()) create() }} />
          </Field>
        </div>
        <Button variant="primary" disabled={a.busy || !title.trim()} onClick={create}>Create and open</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Panel>
  )
}

export default function CoursesTab({ ctx, onOpen }: { ctx: Ctx; onOpen: (id: string) => void }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/courses')), [ctx.company])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState('')
  const [adding, setAdding] = useState(false)

  const rows: any[] = useMemo(() => list.data?.courses || [], [list.data])
  const categories = useMemo(() => [...new Set(rows.map(r => r.category).filter(Boolean))].sort() as string[], [rows])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r =>
      (!status || (status === 'IN_REVIEW' ? r.draft?.status === 'IN_REVIEW' : r.status === status))
      && (!category || r.category === category)
      && (!kind || (kind === 'COMPLIANCE' ? r.is_compliance : !r.is_compliance))
      && (!t || `${r.title} ${r.code} ${(r.tags || []).join(' ')}`.toLowerCase().includes(t)))
  }, [rows, q, status, category, kind])

  const needCompany = ctx.caps.editContent && !ctx.company
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {adding && ctx.company && <NewCourse ctx={ctx} onCreated={onOpen} onClose={() => setAdding(false)} />}
      {needCompany && adding && <NeedCompany doing="start a new course" />}

      <div style={{ ...row(), marginBottom: S.md }}>
        <SearchBox value={q} onChange={setQ} placeholder="Title, code or tag" />
        <Select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 150 }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option><option value="IN_REVIEW">In review</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
        </Select>
        <Select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} style={{ width: 170 }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </Select>
        <Select aria-label="Compliance" value={kind} onChange={e => setKind(e.target.value)} style={{ width: 170 }}>
          <option value="">All course types</option>
          <option value="COMPLIANCE">Compliance only</option><option value="OTHER">Not compliance</option>
        </Select>
        <span style={{ marginLeft: 'auto' }}>
          {ctx.caps.editContent && <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setAdding(v => !v)}>New course</Button>}
        </span>
      </div>

      {list.loading && !list.data ? <SkeletonRows /> : shown.length ? (
        <TableWrap minWidth={980}>
          <thead>
            <tr>
              <Th>Course</Th>{ctx.companies.length > 1 && !ctx.company && <Th>Company</Th>}<Th>Category</Th><Th>Status</Th><Th>Versions</Th>
              <Th align="right">Enrolled</Th><Th align="right">Completed</Th><Th align="right">Overdue</Th><Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <Tr key={c.id} onClick={() => onOpen(c.id)}>
                <Td>
                  <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', minWidth: 0 }}>
                    <Thumb src={c.thumbnail} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{c.title}</div>
                      <div style={{ ...row(6), fontSize: F.tiny, color: C.muted, ...numeric }}>
                        {c.code}
                        {c.is_compliance && <Badge t="info" size="sm">Compliance</Badge>}
                        {c.is_featured && <Badge t="brand" size="sm">Featured</Badge>}
                      </div>
                    </div>
                  </div>
                </Td>
                {ctx.companies.length > 1 && !ctx.company && <Td>{companyName(ctx, c.company_id)}</Td>}
                <Td>{c.category || '-'}</Td>
                <Td><StatusBadge map={COURSE_STATUS} value={c.status} /></Td>
                <Td><Versions c={c} /></Td>
                <Td align="right">{c.enrolled}</Td><Td align="right">{c.completed}</Td>
                <Td align="right" style={c.overdue ? { color: C.critical, fontWeight: W.semi } : undefined}>{c.overdue}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{day(c.updated_at)}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <Empty
          icon={<IconLearning size={22} />}
          title={rows.length ? 'No course matches these filters' : 'No courses yet'}
          hint={rows.length ? 'Clear a filter or try another search.' : ctx.caps.editContent ? 'Start a course, add its lessons and quizzes, and publish it when it is ready.' : 'Courses appear here once someone has created them.'}
          action={!rows.length && ctx.caps.editContent ? <Button variant="primary" onClick={() => setAdding(true)}>New course</Button> : undefined}
        />
      )}
      {shown.length > 0 && <Hint style={{ marginTop: S.sm }}>{shown.length === rows.length ? `${rows.length} courses` : `${shown.length} of ${rows.length} courses`}. Select one to open it.</Hint>}
    </>
  )
}
