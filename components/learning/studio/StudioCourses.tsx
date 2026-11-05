'use client'
// components/learning/studio/StudioCourses.tsx — every course as a board of covers, or as the
// table the Courses tab always had, and starting a new one.
//
// The table keeps every column the old tab showed (company, category, status, versions,
// enrolled, completed, overdue, updated); the board shows the same facts on a card.
import { useEffect, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Badge, C, IconPlus, IconSearch, TableWrap, Td, Th, Tr, W, numeric } from '@/lib/ui'
import { COURSE_STATUS, LoadError, StatusBadge, companyName, day, row, useAction, useLoad, withCompany, type Ctx } from '../admin/shared'
import { CourseArt, LEVEL, Skel, durationWords, plural } from '../shared'
import { GBook, GClock, GThumbs, GLayers } from '../glyphs'
import { GList } from './icons'

const STATUS_TAG: Record<string, string> = { DRAFT: '', PUBLISHED: 'lx-tag--positive', ARCHIVED: 'lx-tag--warning' }
const SORTS: Record<string, { label: string; by: (a: any, b: any) => number }> = {
  updated: { label: 'Recently updated', by: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) },
  title: { label: 'Title A to Z', by: (a, b) => String(a.title).localeCompare(String(b.title)) },
  enrolled: { label: 'Most enrolled', by: (a, b) => b.enrolled - a.enrolled },
  overdue: { label: 'Most overdue', by: (a, b) => b.overdue - a.overdue },
}

function Versions({ c }: { c: any }) {
  return (
    <span style={row(4)}>
      {c.live && <Badge t="positive" size="sm">live v{c.live.version_no}</Badge>}
      {c.draft && <Badge t={c.draft.status === 'IN_REVIEW' ? 'warning' : 'neutral'} size="sm">{c.draft.status === 'IN_REVIEW' ? 'in review' : 'draft'} v{c.draft.version_no}</Badge>}
    </span>
  )
}

function Card({ c, ctx, onOpen }: { c: any; ctx: Ctx; onOpen: (id: string) => void }) {
  const status = c.draft?.status === 'IN_REVIEW' ? 'In review' : COURSE_STATUS[c.status]?.label || c.status
  return (
    <button className="lx-cc lx-st-cc" onClick={() => onOpen(c.id)} aria-label={`Open ${c.title}`}>
      <CourseArt src={c.thumbnail} id={c.id} title={c.title}>
        <div className="lx-cc-badges">
          <span className={`lx-tag ${c.draft?.status === 'IN_REVIEW' ? 'lx-tag--warning' : STATUS_TAG[c.status] || ''}`}>{status}</span>
          {c.is_compliance && <span className="lx-tag lx-tag--info">Compliance</span>}
          {c.is_featured && <span className="lx-tag lx-tag--gold">Featured</span>}
          {c.publish_at && c.status !== 'PUBLISHED' && <span className="lx-tag lx-tag--glass">Scheduled</span>}
        </div>
      </CourseArt>
      <div className="lx-cc-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span className="lx-st-cc-code">{c.code}{ctx.companies.length > 1 && !ctx.company ? ` · ${companyName(ctx, c.company_id)}` : ''}</span>
          <Versions c={c} />
        </div>
        <div className="lx-cc-title lx-clamp2">{c.title}</div>
        {c.summary && <div className="lx-cc-sum lx-clamp2">{c.summary}</div>}
        <div className="lx-cc-meta">
          {c.category && <span><GLayers size={14} />{c.category}</span>}
          <span><GBook size={14} />{plural(c.lessons || 0, 'lesson')}</span>
          {c.est_minutes ? <span><GClock size={14} />{durationWords(c.est_minutes)}</span> : null}
          {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
        </div>
      </div>
      <div className="lx-st-cc-stats">
        <div><b>{c.enrolled}</b><span>Enrolled</span></div>
        <div><b>{c.completed}</b><span>Completed</span></div>
        <div data-hot={c.overdue ? '1' : '0'}><b>{c.overdue}</b><span>Overdue</span></div>
      </div>
      <div className="lx-cc-foot"><span>Updated {day(c.updated_at)}</span>{c.created_by_name && <span>· by {c.created_by_name}</span>}</div>
    </button>
  )
}

function Table({ rows, ctx, onOpen }: { rows: any[]; ctx: Ctx; onOpen: (id: string) => void }) {
  const multi = ctx.companies.length > 1 && !ctx.company
  return (
    <TableWrap minWidth={1040}>
      <thead>
        <tr>
          <Th>Course</Th>{multi && <Th>Company</Th>}<Th>Category</Th><Th>Status</Th><Th>Versions</Th><Th align="right">Lessons</Th>
          <Th align="right">Enrolled</Th><Th align="right">Completed</Th><Th align="right">Overdue</Th><Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(c => (
          <Tr key={c.id} onClick={() => onOpen(c.id)}>
            <Td>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                <CourseArt src={c.thumbnail} id={c.id} title={c.title} word={false} style={{ width: 64, aspectRatio: '16 / 10', borderRadius: 8, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: W.semi, color: C.ink }}>{c.title}</div>
                  <div style={{ ...row(6), fontSize: 12, color: C.muted, ...numeric }}>
                    {c.code}
                    {c.is_compliance && <Badge t="info" size="sm">Compliance</Badge>}
                    {c.is_featured && <Badge t="brand" size="sm">Featured</Badge>}
                  </div>
                </div>
              </div>
            </Td>
            {multi && <Td>{companyName(ctx, c.company_id)}</Td>}
            <Td>{c.category || '-'}</Td>
            <Td><StatusBadge map={COURSE_STATUS} value={c.status} /></Td>
            <Td><Versions c={c} /></Td>
            <Td align="right">{c.lessons || 0}</Td>
            <Td align="right">{c.enrolled}</Td><Td align="right">{c.completed}</Td>
            <Td align="right" style={c.overdue ? { color: C.critical, fontWeight: W.semi } : undefined}>{c.overdue}</Td>
            <Td style={{ whiteSpace: 'nowrap' }}>{day(c.updated_at)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

function NewCourse({ ctx, onCreated, onClose }: { ctx: Ctx; onCreated: (id: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState(ctx.company || '')
  const a = useAction()
  const create = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/courses', { company_id: company, title: title.trim() }))
    if (r) onCreated(r.course.id)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const ready = !!title.trim() && !!company && !a.busy
  return (
    <div className="lx-st-sheet" role="dialog" aria-modal="true" aria-labelledby="lx-st-new-title" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lx-st-sheet-box">
        <div className="lx-st-sheet-head">
          <h2 id="lx-st-new-title">Start a new course</h2>
          <p>Give it a working title. You add modules, videos, slides and quizzes next, and nothing reaches anyone until it is published and assigned.</p>
        </div>
        <div className="lx-st-sheet-body">
          {!ctx.company && (
            <label>
              <span className="lx-st-label">Company</span>
              <select className="lx-select" style={{ width: '100%' }} value={company} onChange={e => setCompany(e.target.value)}>
                <option value="">Choose the company it belongs to</option>
                {ctx.companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span className="lx-st-label">Course title</span>
            <input className="lx-input" data-no-titlecase="" autoFocus value={title} placeholder="Workplace security essentials" onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && ready) void create() }} />
          </label>
          <div className="lx-st-hint">You can change the title, add a cover image and write the description on the next screen.</div>
          {a.error && <div className="lx-problem" role="alert">{a.error}</div>}
        </div>
        <div className="lx-st-sheet-foot">
          <button className="lx-btn lx-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="lx-btn lx-btn--primary" disabled={!ready} onClick={() => void create()}>{a.busy ? 'Creating…' : 'Create and open'}</button>
        </div>
      </div>
    </div>
  )
}

export default function StudioCourses({ ctx, newTick, onOpen }: { ctx: Ctx; newTick: number; onOpen: (id: string) => void }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/courses')), [ctx.company])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState('updated')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [adding, setAdding] = useState(false)
  // The header's "New course" bumps newTick. A tick from before this list mounted (say, before
  // the builder was opened) is not a request to open the form again.
  const [seenTick, setSeenTick] = useState(newTick)
  const open = adding || newTick !== seenTick
  const close = () => { setAdding(false); setSeenTick(newTick) }

  const rows: any[] = useMemo(() => list.data?.courses || [], [list.data])
  const categories = useMemo(() => [...new Set(rows.map(r => r.category).filter(Boolean))].sort() as string[], [rows])
  const counts = useMemo(() => ({
    all: rows.length, DRAFT: rows.filter(r => r.status === 'DRAFT').length, IN_REVIEW: rows.filter(r => r.draft?.status === 'IN_REVIEW').length,
    PUBLISHED: rows.filter(r => r.status === 'PUBLISHED').length, ARCHIVED: rows.filter(r => r.status === 'ARCHIVED').length,
  }), [rows])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r =>
      (!status || (status === 'IN_REVIEW' ? r.draft?.status === 'IN_REVIEW' : r.status === status))
      && (!category || r.category === category)
      && (!kind || (kind === 'COMPLIANCE' ? r.is_compliance : !r.is_compliance))
      && (!t || `${r.title} ${r.code} ${(r.tags || []).join(' ')}`.toLowerCase().includes(t)))
      .sort(SORTS[sort].by)
  }, [rows, q, status, category, kind, sort])

  const chips: [string, string, number][] = [['', 'All', counts.all], ['PUBLISHED', 'Published', counts.PUBLISHED], ['DRAFT', 'Drafts', counts.DRAFT], ['IN_REVIEW', 'In review', counts.IN_REVIEW], ['ARCHIVED', 'Archived', counts.ARCHIVED]]
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {open && <NewCourse ctx={ctx} onCreated={onOpen} onClose={close} />}

      <div className="lx-chips" role="group" aria-label="Status">
        {chips.map(([k, label, n]) => (
          <button key={k || 'all'} className="lx-chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{label}<span className="lx-chip-n lx-num">{n}</span></button>
        ))}
      </div>
      <div className="lx-st-bar">
        <label className="lx-search">
          <IconSearch size={17} />
          <input type="search" data-no-titlecase="" aria-label="Search courses" placeholder="Title, code or tag" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select className="lx-select" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <select className="lx-select" aria-label="Course type" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">All course types</option><option value="COMPLIANCE">Compliance only</option><option value="OTHER">Not compliance</option>
        </select>
        <select className="lx-select" aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}>
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <div className="lx-st-seg" role="group" aria-label="View" style={{ marginLeft: 'auto' }}>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')} title="Cards"><GThumbs size={16} /> Cards</button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')} title="Table"><GList size={16} /> Table</button>
        </div>
      </div>

      {list.loading && !list.data ? (
        <div className="lx-grid">{[0, 1, 2, 3].map(i => <Skel key={i} h={330} r={16} />)}</div>
      ) : !shown.length ? (
        rows.length
          ? <div className="lx-empty"><h3>No course matches these filters</h3><p>Clear a filter or try another search.</p><button className="lx-btn" onClick={() => { setQ(''); setStatus(''); setCategory(''); setKind('') }}>Clear filters</button></div>
          : <div className="lx-empty"><div className="lx-empty-art"><GBook size={34} /></div><h3>No courses yet</h3>
              <p>{ctx.caps.editContent ? 'Start a course, add its videos, slides and quizzes, and publish it when it is ready.' : 'Courses appear here once someone has created them.'}</p>
              {ctx.caps.editContent && <button className="lx-btn lx-btn--primary" onClick={() => setAdding(true)}><IconPlus size={15} /> New course</button>}</div>
      ) : view === 'grid' ? (
        <div className="lx-grid">
          {ctx.caps.editContent && !q && !status && (
            <button className="lx-st-new" onClick={() => setAdding(true)}><span><IconPlus size={24} /></span>Start a new course<small className="lx-st-hint">Videos, slides, documents and quizzes</small></button>
          )}
          {shown.map(c => <Card key={c.id} c={c} ctx={ctx} onOpen={onOpen} />)}
        </div>
      ) : <Table rows={shown} ctx={ctx} onOpen={onOpen} />}
      {shown.length > 0 && <div className="lx-st-hint">{shown.length === rows.length ? plural(rows.length, 'course') : `${shown.length} of ${rows.length} courses`}. Select one to open it.</div>}
    </>
  )
}
