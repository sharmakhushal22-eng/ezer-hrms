'use client'
// components/learning/Catalogue.tsx — what this person may take, and a page for each course.
// Filtering is on the client: the route already returned only what they are allowed to see.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { C, F, W, S, R, E, Badge, Button, Card, Input, Select, Skeleton, numeric, IconCheck, IconLock, IconSearch } from '@/lib/ui'
import { lmsApi } from '@/lib/lms/client'
import { CalmMessage, CourseTile, IconBack, IconStar, KIND_WORD, KindIcon, LEVEL, Problem, SectionHead, STATUS, Stars, dayWords, durationWords, errorWords, plural, type LearnPath } from './shared'

interface Mine { id: string; status: string; progress_pct?: number; completed_at?: string | null; expires_at?: string | null }
interface CatCourse {
  id: string; title: string; summary: string | null; category_id: string | null; difficulty: string | null; est_minutes: number | null
  tags: string[] | null; skills: string[] | null; enrolment_mode: string; is_compliance: boolean; is_featured: boolean
  thumbnail: string | null; rating: number | null; ratings: number; mine: Mine | null
}
interface CatPath {
  id: string; title: string; summary: string | null; order_mode: string; enrolment_mode: string
  courses?: { id: string; title: string; is_required: boolean }[]
}
interface Cat { courses: CatCourse[]; categories: { id: string; name: string }[]; recommended?: CatCourse[]; paths: CatPath[] }
interface OutlineLesson { id: string; title: string; kind: string; est_minutes: number | null; has_quiz: boolean }
interface OutlineModule { id: string; title: string; lessons: OutlineLesson[] }
interface Info {
  course: { id: string; title: string; summary: string | null; description: string | null; difficulty: string | null; est_minutes: number | null; language: string | null; skills: string[] | null; enrolment_mode: string; is_compliance: boolean; validity_months: number | null; certificate_enabled: boolean; thumbnail: string | null }
  outline: OutlineModule[]; prerequisites: { id: string; title: string }[]; reviews: { rating: number; comment: string | null; created_at: string }[]; mine: Mine | null
}

const DURATIONS: Record<string, { label: string; test: (m: number) => boolean }> = {
  short: { label: 'Up to 15 min', test: m => m <= 15 },
  medium: { label: '15 to 60 min', test: m => m > 15 && m <= 60 },
  long: { label: 'Over an hour', test: m => m > 60 },
}

function CourseCard({ c, onInfo }: { c: CatCourse; onInfo: (id: string) => void }) {
  const st = c.mine ? STATUS[c.mine.status] : null
  const mins = durationWords(c.est_minutes)
  return (
    <div role="button" tabIndex={0} className="ezl-hover" onClick={() => onInfo(c.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInfo(c.id) } }}
      style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <CourseTile src={c.thumbnail} ratio="16 / 6" radius={0} size={24} />
      <div style={{ padding: S.md, display: 'grid', gap: 6, flex: 1, alignContent: 'start' }}>
        <div style={{ fontWeight: W.semi, fontSize: F.body, lineHeight: 1.3 }}>{c.title}</div>
        {c.summary && <div className="ezl-clamp2" style={{ fontSize: F.small, color: C.muted, lineHeight: 1.45 }}>{c.summary}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: F.tiny, color: C.muted, alignItems: 'center', marginTop: 2, ...numeric }}>
          {c.rating != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: C.inkSoft }}><span style={{ color: C.warning }}><IconStar size={13} filled /></span>{c.rating.toFixed(1)}</span>}
          {mins && <span>{mins}</span>}
          {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
        </div>
        {(c.is_compliance || st) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {c.is_compliance && <Badge t="info" size="sm">Compliance</Badge>}
            {st && <Badge t={st.t} size="sm">{st.label}</Badge>}
          </div>
        )}
      </div>
    </div>
  )
}

function PathCard({ p, mine, readOnly, onEnrolled }: { p: CatPath; mine?: LearnPath; readOnly?: boolean; onEnrolled: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const enrol = async () => {
    setBusy(true); setErr('')
    try { await lmsApi('/api/lms/me/enrol', { path_id: p.id }); onEnrolled() }
    catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <Card pad={S.md} elevation="flat" style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
      <div style={{ fontWeight: W.semi, fontSize: F.body }}>{p.title}</div>
      {p.summary && <div className="ezl-clamp2" style={{ fontSize: F.small, color: C.muted, lineHeight: 1.45 }}>{p.summary}</div>}
      <div style={{ fontSize: F.tiny, color: C.muted }}>{p.order_mode === 'SEQUENTIAL' ? 'Courses open one after another' : 'Take the courses in any order'}</div>
      {!!p.courses?.length && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: F.tiny, color: C.inkSoft, lineHeight: 1.6 }}>
          {p.courses.map(c => <li key={c.id}>{c.title}</li>)}
        </ol>
      )}
      <div style={{ marginTop: 4 }}>
        {mine ? <Badge t={mine.status === 'COMPLETED' ? 'positive' : 'brand'} size="sm">{mine.status === 'COMPLETED' ? 'Completed' : `Enrolled · ${Math.round(Number(mine.progress_pct) || 0)}%`}</Badge>
          : p.enrolment_mode === 'SELF' ? <Button size="sm" disabled={busy || readOnly} onClick={enrol}>{busy ? 'Enrolling' : 'Enrol in this path'}</Button>
          : <span style={{ fontSize: F.tiny, color: C.muted }}>HR assigns this path</span>}
      </div>
      {err && <div role="alert" style={{ fontSize: F.tiny, color: C.critical }}>{err}</div>}
    </Card>
  )
}

function CourseAction({ info, readOnly, busy, onEnrol, onOpen }: { info: Info; readOnly?: boolean; busy: boolean; onEnrol: () => void; onOpen: (id: string) => void }) {
  const mode = info.course.enrolment_mode
  const mine = info.mine
  const can = mode !== 'ASSIGN_ONLY'
  const big = { size: 'lg' as const, full: true }
  if (mine?.status === 'PENDING_APPROVAL') return <Hint icon={<IconCheck size={15} />}>Request sent. Your manager will decide, and you will hear back in your notifications.</Hint>
  if (mine?.status === 'NOT_STARTED') return <Button variant="primary" {...big} onClick={() => onOpen(mine.id)}>{readOnly ? 'View course' : 'Start course'}</Button>
  if (mine && ['IN_PROGRESS', 'FAILED'].includes(mine.status)) return <Button variant="primary" {...big} onClick={() => onOpen(mine.id)}>{readOnly ? 'View course' : 'Continue'}</Button>
  if (mine?.status === 'COMPLETED') return (
    <div style={{ display: 'grid', gap: S.sm }}>
      <Button variant="primary" {...big} onClick={() => onOpen(mine.id)}>View course</Button>
      {can && <Button full disabled={busy || readOnly} onClick={onEnrol}>{busy ? 'Starting again' : 'Retake'}</Button>}
    </div>
  )
  if (!can) return <Hint icon={<IconLock size={15} />}>HR assigns this course. Ask them if you need it.</Hint>
  const asks = mode === 'APPROVAL'
  const word = mine ? (asks ? 'Ask to retake' : 'Retake') : asks ? 'Request access' : 'Enrol'
  return (
    <div style={{ display: 'grid', gap: S.sm }}>
      <Button variant="primary" {...big} disabled={busy || readOnly} onClick={onEnrol}>{busy ? 'One moment' : word}</Button>
      {asks && <div style={{ fontSize: F.tiny, color: C.muted, textAlign: 'center' }}>Your manager approves this first.</div>}
    </div>
  )
}

function Hint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: S.sm, fontSize: F.small, color: C.inkSoft, lineHeight: 1.5 }}><span style={{ color: C.muted, marginTop: 2 }}>{icon}</span><span>{children}</span></div>
}

function Outline({ modules }: { modules: OutlineModule[] }) {
  return (
    <div style={{ display: 'grid', gap: S.md }}>
      {modules.map((m, i) => (
        <div key={m.id}>
          <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, marginBottom: 4 }}>{m.title || `Module ${i + 1}`}</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden' }}>
            {(m.lessons || []).map((l, n) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: S.sm, padding: `${S.sm}px ${S.md}px`, borderTop: n ? `1px solid ${C.line}` : 0, fontSize: F.small, color: C.inkSoft }}>
                <span style={{ color: C.muted }}><KindIcon kind={l.kind} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>{l.title}</span>
                <span style={{ fontSize: F.tiny, color: C.muted, flexShrink: 0, ...numeric }}>{[l.has_quiz && l.kind !== 'ASSESSMENT' ? 'Quiz' : KIND_WORD[l.kind], durationWords(l.est_minutes)].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CourseInfo({ id, card, readOnly, onBack, onOpen, onInfo, onChanged }: { id: string; card?: CatCourse; readOnly?: boolean; onBack: () => void; onOpen: (id: string) => void; onInfo: (id: string) => void; onChanged: () => void }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setErr('')
    return lmsApi<Info>(`/api/lms/me/catalog/${id}`).then(setInfo).catch(e => setErr(errorWords(e)))
  }, [id])
  useEffect(() => { setInfo(null); load() }, [load])

  const enrol = async () => {
    setBusy(true); setErr('')
    try {
      const r = await lmsApi<{ id: string; status: string }>('/api/lms/me/enrol', { course_id: id })
      onChanged()
      if (r.status === 'PENDING_APPROVAL') await load()
      else onOpen(r.id)
    } catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }

  const back = <button className="ezl-linkbtn" style={{ fontSize: F.small }} onClick={onBack}><IconBack size={15} /> Catalogue</button>
  if (err && !info) return <div style={{ display: 'grid', gap: S.md }}>{back}<Problem message={err} onRetry={load} /></div>
  if (!info) return <div style={{ display: 'grid', gap: S.md }}>{back}<Skeleton h={180} r={R.lg} /><Skeleton w="60%" /><Skeleton w="80%" /></div>

  const c = info.course
  const facts = [durationWords(c.est_minutes), c.difficulty && LEVEL[c.difficulty], c.language, c.validity_months ? `Renews every ${plural(c.validity_months, 'month')}` : null, c.certificate_enabled ? 'Certificate on completion' : null].filter(Boolean) as string[]
  const lessons = (info.outline || []).reduce((n, m) => n + (m.lessons?.length || 0), 0)
  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.lg }}>
      {back}
      <div className="ezl-info">
        <div style={{ display: 'grid', gap: S.lg, minWidth: 0 }}>
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {c.is_compliance && <Badge t="info" size="sm">Compliance</Badge>}
              {info.mine && STATUS[info.mine.status] && <Badge t={STATUS[info.mine.status].t} size="sm">{STATUS[info.mine.status].label}</Badge>}
            </div>
            <h2 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, letterSpacing: '-.02em', lineHeight: 1.2 }}>{c.title}</h2>
            {c.summary && <p style={{ margin: '6px 0 0', fontSize: F.body, color: C.inkSoft, lineHeight: 1.55 }}>{c.summary}</p>}
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: F.small, color: C.muted, alignItems: 'center', ...numeric }}>
              {card?.rating != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Stars value={card.rating} />{card.rating.toFixed(1)} ({card.ratings})</span>}
              {facts.map(f => <span key={f}>{f}</span>)}
            </div>
          </div>
          {c.description && <section><SectionHead title="About this course" /><div style={{ fontSize: F.body, color: C.inkSoft, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{c.description}</div></section>}
          {!!c.skills?.length && (
            <section>
              <SectionHead title="Skills you will gain" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{c.skills.map(s => <Badge key={s}>{s}</Badge>)}</div>
            </section>
          )}
          <section>
            <SectionHead title="What is inside" hint={plural(lessons, 'lesson')} />
            <Outline modules={info.outline || []} />
          </section>
          {info.prerequisites.length > 0 && (
            <section>
              <SectionHead title="Finish these first" />
              <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                {info.prerequisites.map(p => <button key={p.id} className="ezl-linkbtn" style={{ fontSize: F.small }} onClick={() => onInfo(p.id)}>{p.title}</button>)}
              </div>
            </section>
          )}
          {info.reviews.length > 0 && (
            <section>
              <SectionHead title="What others said" />
              <div style={{ display: 'grid', gap: S.sm }}>
                {info.reviews.map((r, i) => (
                  <Card key={i} pad={S.md} elevation="flat">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.sm, alignItems: 'center' }}><Stars value={r.rating} /><span style={{ fontSize: F.tiny, color: C.muted }}>{dayWords(r.created_at)}</span></div>
                    <div style={{ marginTop: 6, fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{r.comment}</div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="ezl-info-side">
          <Card pad={S.md} style={{ display: 'grid', gap: S.md }}>
            {c.thumbnail && <div style={{ borderRadius: R.md, overflow: 'hidden' }}><CourseTile src={c.thumbnail} ratio="16 / 9" /></div>}
            <CourseAction info={info} readOnly={readOnly} busy={busy} onEnrol={enrol} onOpen={onOpen} />
            {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function Catalogue({ infoId, myPaths, readOnly, onInfo, onOpen, onChanged }: {
  infoId: string | null
  myPaths: LearnPath[]
  readOnly?: boolean
  onInfo: (courseId: string | null) => void
  onOpen: (enrollmentId: string) => void
  onChanged: () => void
}) {
  const [cat, setCat] = useState<Cat | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [length, setLength] = useState('')
  const [tag, setTag] = useState('')

  const load = useCallback(() => {
    setErr('')
    lmsApi<Cat>('/api/lms/me/catalog').then(setCat).catch(e => setErr(errorWords(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const tags = useMemo(() => [...new Set((cat?.courses || []).flatMap(c => c.tags || []))].sort((a, b) => a.localeCompare(b)), [cat])
  const levels = useMemo(() => Object.keys(LEVEL).filter(l => (cat?.courses || []).some(c => c.difficulty === l)), [cat])
  const filtering = !!(q.trim() || category || level || length || tag)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (cat?.courses || []).filter(c => {
      if (category && c.category_id !== category) return false
      if (level && c.difficulty !== level) return false
      if (tag && !(c.tags || []).includes(tag)) return false
      if (length && !(c.est_minutes != null && DURATIONS[length].test(c.est_minutes))) return false
      if (!needle) return true
      return [c.title, c.summary, ...(c.tags || []), ...(c.skills || [])].some(s => String(s || '').toLowerCase().includes(needle))
    })
  }, [cat, q, category, level, length, tag])

  if (infoId) return <CourseInfo key={infoId} id={infoId} card={cat?.courses.find(c => c.id === infoId)} readOnly={readOnly} onBack={() => onInfo(null)} onOpen={onOpen} onInfo={onInfo} onChanged={() => { onChanged(); load() }} />
  if (err) return <Problem message={err} onRetry={load} />
  if (!cat) return <div className="ezl-grid">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={210} r={R.lg} />)}</div>
  if (!cat.courses.length && !cat.paths.length) return <CalmMessage title="The catalogue is empty for now">When HR publishes courses you can take, they will appear here.</CalmMessage>

  const reco = (cat.recommended || []).slice(0, 3)
  const clear = () => { setQ(''); setCategory(''); setLevel(''); setLength(''); setTag('') }
  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.xl }}>
      <div className="ezl-filters">
        <div style={{ position: 'relative', minWidth: 0 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }}><IconSearch size={15} /></span>
          <Input type="search" aria-label="Search courses" placeholder="Search courses" value={q} onChange={e => setQ(e.target.value)} style={{ paddingLeft: 33 }} />
        </div>
        <Select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {cat.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Level" value={level} onChange={e => setLevel(e.target.value)}>
          <option value="">All levels</option>
          {levels.map(l => <option key={l} value={l}>{LEVEL[l]}</option>)}
        </Select>
        <Select aria-label="Duration" value={length} onChange={e => setLength(e.target.value)}>
          <option value="">Any length</option>
          {Object.entries(DURATIONS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
        </Select>
        <Select aria-label="Topic" value={tag} onChange={e => setTag(e.target.value)}>
          <option value="">All topics</option>
          {tags.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      {!filtering && reco.length > 0 && (
        <section>
          <SectionHead title="Recommended for you" hint="Picked by HR, or popular in your team" />
          <div className="ezl-grid">{reco.map(c => <CourseCard key={c.id} c={c} onInfo={onInfo} />)}</div>
        </section>
      )}

      <section>
        <SectionHead title={filtering ? 'Results' : 'All courses'} count={shown.length} action={filtering ? <button className="ezl-linkbtn" style={{ fontSize: F.small }} onClick={clear}>Clear filters</button> : undefined} />
        {shown.length
          ? <div className="ezl-grid">{shown.map(c => <CourseCard key={c.id} c={c} onInfo={onInfo} />)}</div>
          : <Card elevation="flat" style={{ textAlign: 'center', color: C.muted, fontSize: F.small, padding: S.xl }}>No course matches that. Try fewer filters.</Card>}
      </section>

      {!filtering && cat.paths.length > 0 && (
        <section>
          <SectionHead title="Learning paths" hint="A few courses that belong together" />
          <div className="ezl-grid">{cat.paths.map(p => <PathCard key={p.id} p={p} readOnly={readOnly} mine={myPaths.find(m => m.path_id === p.id)} onEnrolled={onChanged} />)}</div>
        </section>
      )}
    </div>
  )
}
