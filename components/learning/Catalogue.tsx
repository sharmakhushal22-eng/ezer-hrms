'use client'
// components/learning/Catalogue.tsx — Explore: every course this person may take, a spotlight,
// categories, search, filters and sorting, and the learning paths that bundle courses together.
// Filtering is on the client: the route already returned only what they are allowed to see.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconSearch } from '@/lib/ui'
import { lmsApi } from '@/lib/lms/client'
import { navigate, to } from './app/router'
import { CourseCard, isNew, type CatCourse } from './CourseCard'
import { CourseArt, EmptyState, IconStar, KIND_WORD, LEVEL, Oops, Skel, durationWords, errorWords, hueOf, plural, type LearnPath } from './shared'
import { GArrowRight, GClock, GCompass, GLayers, GSort, GSparkle, GUsers } from './glyphs'
import { Carousel } from './motion/Carousel'
import { CountUp } from './motion/CountUp'
import { Scroller } from './motion/Scroller'
import { viewTransition } from './motion/transition'
import { Clip } from './showcase/Clip'
import { isSaved, useHover, usePreviewPrefs } from './showcase/preview'

export type { CatCourse }
export interface CatPath {
  id: string; title: string; summary: string | null; order_mode: string; enrolment_mode: string
  mine?: { path_id: string; status: string; progress_pct: number } | null
  courses?: { id: string; title: string; is_required: boolean }[]
}
export interface Catalog { courses: CatCourse[]; categories: { id: string; name: string }[]; recommended?: CatCourse[]; paths: CatPath[]
  /** Course ids, most started in the last 30 days first (lib/lms/showcase-core.ts). */
  top?: string[] }

const DURATIONS: Record<string, { label: string; test: (m: number) => boolean }> = {
  short: { label: 'Under 15 min', test: m => m <= 15 },
  medium: { label: '15 to 60 min', test: m => m > 15 && m <= 60 },
  long: { label: 'Over an hour', test: m => m > 60 },
}
const SORTS: Record<string, { label: string; fn: (a: CatCourse, b: CatCourse) => number }> = {
  best: { label: 'Best match', fn: (a, b) => (b.recommended_score || 0) - (a.recommended_score || 0) || Number(b.is_featured) - Number(a.is_featured) || (b.learners || 0) - (a.learners || 0) },
  new: { label: 'Newest', fn: (a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) },
  popular: { label: 'Most taken', fn: (a, b) => (b.learners || 0) - (a.learners || 0) },
  rating: { label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) || b.ratings - a.ratings },
  short: { label: 'Shortest first', fn: (a, b) => (a.est_minutes || 9999) - (b.est_minutes || 9999) },
  az: { label: 'A to Z', fn: (a, b) => a.title.localeCompare(b.title) },
}
const STATUS_FILTER: Record<string, { label: string; test: (c: CatCourse) => boolean }> = {
  open: { label: 'Not started yet', test: c => !c.mine },
  going: { label: 'In progress', test: c => !!c.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED'].includes(c.mine.status) },
  done: { label: 'Completed', test: c => c.mine?.status === 'COMPLETED' },
}

function PathCard({ p, mine, readOnly, onEnrolled }: { p: CatPath; mine?: LearnPath; readOnly?: boolean; onEnrolled: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const enrol = async () => {
    setBusy(true); setErr('')
    try { await lmsApi('/api/lms/me/enrol', { path_id: p.id }); onEnrolled() }
    catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  const pct = Math.round(Number(mine?.progress_pct) || 0)
  return (
    <div className="lx-panel lx-in" style={{ display: 'grid', alignContent: 'start' }}>
      <div className="lx-art" data-gen="1" data-h={hueOf(p.id)} style={{ height: 96 }}>
        <div className="lx-art-glyph"><span><GLayers size={22} /></span><div className="lx-art-word">Learning path</div></div>
      </div>
      <div style={{ padding: '16px 18px', display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 750, fontSize: 16 }}>{p.title}</div>
        {p.summary && <div className="lx-clamp2" style={{ fontSize: 13.5, color: 'var(--ez-muted)', lineHeight: 1.5 }}>{p.summary}</div>}
        {!!p.courses?.length && (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {p.courses.map((c, i) => (
              <li key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: 'var(--ez-ink-soft)' }}>
                <span className="lx-num" style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 750, background: 'var(--ez-sunken)', border: '1px solid var(--ez-line)', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>{c.title}{!c.is_required && <span style={{ color: 'var(--ez-muted)' }}> · optional</span>}</span>
              </li>
            ))}
          </ol>
        )}
        <div style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>{p.order_mode === 'SEQUENTIAL' ? 'Courses open one after another' : 'Take the courses in any order'}</div>
        {mine ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="lx-bar" data-done={mine.status === 'COMPLETED' ? '1' : '0'}><i style={{ width: `${mine.status === 'COMPLETED' ? 100 : pct}%` }} /></div>
            <span style={{ fontSize: 12.5, fontWeight: 650, color: mine.status === 'COMPLETED' ? 'var(--ez-positive)' : 'var(--ez-brand)' }}>{mine.status === 'COMPLETED' ? 'Completed' : `Enrolled · ${pct}% done`}</span>
          </div>
        ) : p.enrolment_mode === 'SELF'
          ? <button className="lx-btn lx-btn--primary" disabled={busy || readOnly} onClick={enrol}>{busy ? 'Enrolling…' : 'Enrol in this path'}</button>
          : <span style={{ fontSize: 13, color: 'var(--ez-muted)' }}>HR assigns this path</span>}
        {err && <div role="alert" style={{ fontSize: 13, color: 'var(--ez-critical)' }}>{err}</div>}
      </div>
    </div>
  )
}

function Spotlight({ c, category, onOpen, active = true }: { c: CatCourse; category?: string; onOpen: () => void; active?: boolean }) {
  // The showing slide plays its clip muted, unless previews are off or a hover card is playing one.
  const { blocked } = usePreviewPrefs()
  const hovering = !!useHover()
  return (
    <button className="lx-feature lx-in" onClick={onOpen}>
      <CourseArt src={c.thumbnail} id={c.id} title={c.title} kind={(c.kinds || [])[0]}>
        {c.preview && active && !blocked && <Clip p={c.preview} play={!hovering} owned progress={false} />}
      </CourseArt>
      <div className="lx-feature-body">
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="lx-tag lx-tag--gold"><GSparkle size={12} /> Spotlight</span>
          {category && <span className="lx-tag">{category}</span>}
          {c.is_compliance && <span className="lx-tag lx-tag--info">Compliance</span>}
        </span>
        <h3>{c.title}</h3>
        {c.summary && <p className="lx-clamp3" style={{ color: 'var(--ez-muted)', fontSize: 15, lineHeight: 1.6 }}>{c.summary}</p>}
        <div className="lx-cc-meta lx-num" style={{ fontSize: 13.5 }}>
          {c.rating != null && <span className="lx-rating"><IconStar size={14} filled />{c.rating.toFixed(1)}</span>}
          {!!c.est_minutes && <span><GClock size={14} />{durationWords(c.est_minutes)}</span>}
          {!!c.lesson_count && <span><GLayers size={14} />{plural(c.lesson_count, 'lesson')}</span>}
          {!!c.learners && <span><GUsers size={14} />{plural(c.learners, 'learner')}</span>}
          {c.difficulty && <span>{LEVEL[c.difficulty]}</span>}
        </div>
        <span className="lx-btn lx-btn--primary" style={{ justifySelf: 'start' }}>{c.mine ? 'Go to the course' : 'View the course'} <GArrowRight size={16} /></span>
      </div>
    </button>
  )
}

export default function Catalogue({ cat: given, err: givenErr, myPaths, query, readOnly, onReload, onChanged, onOpenCourse }: {
  /** Loaded by the app shell. Absent: this screen loads it itself (the embedded portal). */
  cat?: Catalog | null
  err?: string
  myPaths: LearnPath[]
  query?: URLSearchParams
  readOnly?: boolean
  onReload?: () => void
  onChanged: () => void
  /** Open a course page; by default the app's own address. */
  onOpenCourse?: (courseId: string) => void
}) {
  const [own, setOwn] = useState<Catalog | null>(null)
  const [ownErr, setOwnErr] = useState('')
  const selfLoad = given === undefined
  const loadOwn = useCallback(() => { setOwnErr(''); lmsApi<Catalog>('/api/lms/me/catalog').then(setOwn).catch(e => setOwnErr(errorWords(e))) }, [])
  useEffect(() => { if (selfLoad) loadOwn() }, [selfLoad, loadOwn])
  const cat = selfLoad ? own : given
  const err = selfLoad ? ownErr : givenErr || ''
  const reload = selfLoad ? loadOwn : onReload

  const [q, setQ] = useState(query?.get('q') || '')
  const [category, setCategory] = useState(query?.get('cat') || '')
  const [level, setLevel] = useState('')
  const [length, setLength] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [onlyMust, setOnlyMust] = useState(false)
  const [onlySaved, setOnlySaved] = useState(false)
  usePreviewPrefs()   // My list changes show at once
  const [sort, setSort] = useState('best')
  // The search box in the top bar lands here with ?q=.
  const qs = query?.toString() || ''
  useEffect(() => { const p = new URLSearchParams(qs); setQ(p.get('q') || ''); if (p.get('cat')) setCategory(p.get('cat') || '') }, [qs])

  const open = (id: string) => (onOpenCourse ? onOpenCourse(id) : navigate(to.course(id)))
  const catName = useMemo(() => new Map((cat?.categories || []).map(c => [c.id, c.name])), [cat])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cat?.courses || []) if (c.category_id) m.set(c.category_id, (m.get(c.category_id) || 0) + 1)
    return m
  }, [cat])
  const kinds = useMemo(() => [...new Set((cat?.courses || []).flatMap(c => c.kinds || []))].filter(k => k !== 'ASSESSMENT'), [cat])
  const levels = useMemo(() => Object.keys(LEVEL).filter(l => (cat?.courses || []).some(c => c.difficulty === l)), [cat])
  const filtering = !!(q.trim() || category || level || length || kind || status || onlyMust || onlySaved)

  // My list as changed in this tab (usePreviewPrefs above re-renders on a change), so the filter follows it.
  const savedKey = (cat?.courses || []).filter(c => isSaved(c)).map(c => c.id).join()
  const savedIds = useMemo(() => new Set(savedKey.split(',')), [savedKey])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (cat?.courses || []).filter(c => {
      if (category && c.category_id !== category) return false
      if (level && c.difficulty !== level) return false
      if (kind && !(c.kinds || []).includes(kind)) return false
      if (status && !STATUS_FILTER[status].test(c)) return false
      if (onlyMust && !c.is_compliance) return false
      if (onlySaved && !savedIds.has(c.id)) return false
      if (length && !(c.est_minutes != null && DURATIONS[length].test(c.est_minutes))) return false
      if (!needle) return true
      return [c.title, c.summary, c.code, catName.get(c.category_id || ''), ...(c.tags || []), ...(c.skills || [])].some(s => String(s || '').toLowerCase().includes(needle))
    }).sort(SORTS[sort].fn)
  }, [cat, q, category, level, length, kind, status, onlyMust, onlySaved, savedIds, sort, catName])

  const setSearch = (v: string) => {
    setQ(v)
    if (!onOpenCourse) navigate(to.catalog(v.trim() ? { q: v.trim(), ...(category ? { cat: category } : {}) } : category ? { cat: category } : undefined), { replace: true, keepScroll: true })
  }
  const pickCat = (id: string) => {
    setCategory(id)
    if (!onOpenCourse) navigate(to.catalog({ ...(q.trim() ? { q: q.trim() } : {}), ...(id ? { cat: id } : {}) }), { replace: true, keepScroll: true })
  }
  const clear = () => { setQ(''); setLevel(''); setLength(''); setKind(''); setStatus(''); setOnlyMust(false); setOnlySaved(false); pickCat('') }
  // A filter, sort or category change glides: the cards that stay move to their new places, the
  // rest fade (motion/transition.ts; each card in the grid carries its own transition name).
  // Typing in the search box does not, it would restart on every key.
  const glide = (change: () => void) => viewTransition(change, 'filter')

  if (err && !cat) return <Oops message={err} onRetry={reload} />
  if (!cat) {
    return (
      <div style={{ display: 'grid', gap: 24 }}>
        <Skel h={150} r={22} />
        <Skel h={44} />
        <div className="lx-grid">{[0, 1, 2, 3, 4, 5].map(i => <Skel key={i} h={300} r={16} />)}</div>
      </div>
    )
  }
  if (!cat.courses.length && !cat.paths.length) {
    return <EmptyState title="The catalogue is empty for now" icon={<GCompass size={34} />}>When HR publishes courses you can take, they will appear here.</EmptyState>
  }

  const spotlight = !filtering ? [...cat.courses].filter(c => c.is_featured).sort(SORTS.best.fn).slice(0, 5) : []
  const newCount = cat.courses.filter(isNew).length
  return (
    <div>
      <header className="lx-ph lx-in">
        <div className="lx-ph-row">
          <div>
            <h1>Explore courses</h1>
            <p>Build the skills your role needs. Search, browse by category, or pick up something new your colleagues are taking.</p>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }} className="lx-num">
            <div className="lx-hero-stat"><b><CountUp value={cat.courses.length} /></b><span>courses</span></div>
            <div className="lx-hero-stat"><b><CountUp value={cat.categories.length} /></b><span>categories</span></div>
            {cat.paths.length > 0 && <div className="lx-hero-stat"><b><CountUp value={cat.paths.length} /></b><span>learning paths</span></div>}
            {newCount > 0 && <div className="lx-hero-stat"><b><CountUp value={newCount} /></b><span>new this month</span></div>}
          </div>
        </div>
      </header>

      <div className="lx-toolbar">
        <div className="lx-search">
          <IconSearch size={17} />
          <input type="search" data-no-titlecase="" aria-label="Search courses" placeholder="Search by title, skill or topic" value={q} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="lx-filter-row">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ez-muted)' }}>
            <GSort size={16} /><span className="lx-sr">Sort by</span>
            <select className="lx-select" aria-label="Sort by" value={sort} onChange={e => { const v = e.target.value; glide(() => setSort(v)) }}>
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          {levels.length > 0 && (
            <select className="lx-select" aria-label="Level" value={level} onChange={e => { const v = e.target.value; glide(() => setLevel(v)) }}>
              <option value="">Any level</option>
              {levels.map(l => <option key={l} value={l}>{LEVEL[l]}</option>)}
            </select>
          )}
          <select className="lx-select" aria-label="Length" value={length} onChange={e => { const v = e.target.value; glide(() => setLength(v)) }}>
            <option value="">Any length</option>
            {Object.entries(DURATIONS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
          {kinds.length > 1 && (
            <select className="lx-select" aria-label="Content type" value={kind} onChange={e => { const v = e.target.value; glide(() => setKind(v)) }}>
              <option value="">Any content</option>
              {kinds.map(k => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
            </select>
          )}
          <select className="lx-select" aria-label="Your progress" value={status} onChange={e => { const v = e.target.value; glide(() => setStatus(v)) }}>
            <option value="">Any progress</option>
            {Object.entries(STATUS_FILTER).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <button className="lx-toggle" aria-pressed={onlyMust} onClick={() => glide(() => setOnlyMust(v => !v))}>Compliance only</button>
          {!readOnly && <button className="lx-toggle" aria-pressed={onlySaved} onClick={() => glide(() => setOnlySaved(v => !v))}>My list</button>}
        </div>
      </div>

      {cat.categories.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <Scroller className="lx-chips" n={cat.categories.length} variant="chips" role="group" label="Categories">
            <button className="lx-chip" aria-pressed={!category} onClick={() => glide(() => pickCat(''))}>All <span className="lx-chip-n">{cat.courses.length}</span></button>
            {cat.categories.filter(c => counts.get(c.id)).map(c => (
              <button key={c.id} className="lx-chip" aria-pressed={category === c.id} onClick={() => glide(() => pickCat(category === c.id ? '' : c.id))}>
                <span className="lx-chip-dot lx-art" data-gen="1" data-h={hueOf(c.id)} style={{ background: 'linear-gradient(135deg,var(--a1),var(--a2))' }} />{c.name} <span className="lx-chip-n">{counts.get(c.id)}</span>
              </button>
            ))}
          </Scroller>
        </div>
      )}

      <div className="lx-stack">
        {spotlight.length === 1 && <Spotlight c={spotlight[0]} category={catName.get(spotlight[0].category_id || '')} onOpen={() => open(spotlight[0].id)} />}
        {spotlight.length > 1 && (
          <Carousel items={spotlight} label="Featured courses" slideLabel={c => c.title} variant="below" interval={8000}
            render={(c, active) => <Spotlight c={c} active={active} category={catName.get(c.category_id || '')} onOpen={() => open(c.id)} />} />
        )}

        <section>
          <div className="lx-sec-head">
            <div>
              <h2 className="lx-sec-title">{filtering ? 'Results' : 'All courses'}</h2>
              <div className="lx-sec-sub lx-num">{plural(shown.length, 'course')}{category ? ` in ${catName.get(category)}` : ''}{q.trim() ? ` matching “${q.trim()}”` : ''}</div>
            </div>
            {filtering && <button className="lx-sec-link" onClick={() => glide(clear)}>Clear all filters</button>}
          </div>
          {shown.length
            ? <div className="lx-grid">{shown.map((c, i) => <CourseCard key={c.id} c={c} category={catName.get(c.category_id || '')} delay={i % 5} vt={`lxc-${c.id}`} onOpen={onOpenCourse ? () => open(c.id) : undefined} />)}</div>
            : <EmptyState title="Nothing matches that" icon={<IconSearch size={32} />} action={<button className="lx-btn" onClick={() => glide(clear)}>Clear the filters</button>}>Try a shorter search, or fewer filters.</EmptyState>}
        </section>

        {!filtering && cat.paths.length > 0 && (
          <section>
            <div className="lx-sec-head"><div><h2 className="lx-sec-title">Learning paths</h2><div className="lx-sec-sub">A few courses that belong together, taken as one journey</div></div></div>
            <div className="lx-grid">{cat.paths.map(p => <PathCard key={p.id} p={p} readOnly={readOnly} mine={myPaths.find(m => m.path_id === p.id)} onEnrolled={onChanged} />)}</div>
          </section>
        )}
      </div>
    </div>
  )
}
