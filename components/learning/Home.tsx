'use client'
// components/learning/Home.tsx — the first screen of EZER Learn: a welcome that says what needs
// doing, the course to pick up where you left off, and shelves of courses worth opening next.
//
// Everything here comes from two reads the app already holds: the learner's dashboard (what is
// assigned, in progress, due) and the catalogue (what they may take). Shelves with nothing in
// them are left out rather than shown empty.
import { useMemo, type ReactNode } from 'react'
import { IconCheck } from '@/lib/ui'
import { linkProps, navigate, to } from './app/router'
import type { Catalog } from './Catalogue'
import { CourseCard, LearnCard, isNew, type CatCourse } from './CourseCard'
import { CourseArt, DueTag, EmptyState, IconStar, Oops, Ring, Skel, dueWords, durationWords, firstName, hueOf, plural, shortDay, type Dashboard, type LearnItem } from './shared'
import { GArrowRight, GClock, GCompass, GFlame, GLayers, GPlay, GSparkle, GTrophy, GUsers } from './glyphs'
import { keys, paths, prefetch } from './app/cache'
import { Aurora } from './motion/Aurora'
import { Carousel } from './motion/Carousel'
import { CountUp } from './motion/CountUp'
import { Scroller } from './motion/Scroller'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** A shelf that scrolls sideways, with arrows on a desktop and a swipe on a phone. */
function Rail({ title, sub, more, children, n }: { title: string; sub?: string; more?: { label: string; href: string }; children: ReactNode; n: number }) {
  return (
    <section>
      <div className="lx-sec-head">
        <div><h2 className="lx-sec-title">{title}</h2>{sub && <div className="lx-sec-sub">{sub}</div>}</div>
        {more && <a className="lx-sec-link" {...linkProps(more.href)}>{more.label} <GArrowRight size={14} /></a>}
      </div>
      <Scroller className="lx-rail" n={n} progress>{children}</Scroller>
    </section>
  )
}

/** One slide of the spotlight: the course's picture full-bleed, its pitch over the dark side. */
function Billboard({ c, why, category }: { c: CatCourse; why: string; category?: string }) {
  const going = c.mine && ['IN_PROGRESS', 'NOT_STARTED', 'FAILED'].includes(c.mine.status)
  return (
    <article className="lx-bb">
      <div className="lx-bb-art lx-kb"><CourseArt src={c.thumbnail} id={c.id} title={c.title} word={false} /></div>
      <div className="lx-bb-shade" />
      <Aurora specks={6} />
      <div className="lx-bb-body">
        <span className="lx-bb-kick lx-car-rise">
          <span className="lx-tag lx-tag--gold"><GSparkle size={12} /> {why}</span>
          {category && <span className="lx-tag lx-tag--glass">{category}</span>}
          {c.is_compliance && <span className="lx-tag lx-tag--glass">Compliance</span>}
        </span>
        <h3 className="lx-clamp2 lx-car-rise">{c.title}</h3>
        {c.summary && <p className="lx-clamp2 lx-car-rise-2">{c.summary}</p>}
        <div className="lx-cc-meta lx-num lx-car-rise-2">
          {c.rating != null && <span className="lx-rating"><IconStar size={13} filled />{c.rating.toFixed(1)}</span>}
          {!!c.est_minutes && <span><GClock size={13} />{durationWords(c.est_minutes)}</span>}
          {!!c.lesson_count && <span><GLayers size={13} />{plural(c.lesson_count, 'lesson')}</span>}
          {!!c.learners && <span><GUsers size={13} />{plural(c.learners, 'learner')}</span>}
        </div>
        <div className="lx-bb-ctas lx-car-rise-2">
          {going && c.mine
            ? <a className="lx-btn lx-btn--white" {...linkProps(to.play(c.mine.id))}><GPlay size={15} /> {c.mine.status === 'IN_PROGRESS' ? 'Resume' : 'Start'}</a>
            : <a className="lx-btn lx-btn--white" {...linkProps(to.course(c.id))} onPointerEnter={() => prefetch(keys.course(c.id), paths.course(c.id))}>View the course <GArrowRight size={15} /></a>}
          {going && <a className="lx-btn lx-btn--light" {...linkProps(to.course(c.id))}>About this course</a>}
        </div>
      </div>
    </article>
  )
}

function Hero({ dash, lead, cat }: { dash: Dashboard; lead: LearnItem | null; cat: Catalog | null }) {
  const n = dash.counts || { assigned: 0, mandatory: 0, overdue: 0, in_progress: 0, completed: 0 }
  const name = firstName(dash.name)
  const line = n.overdue ? `${plural(n.overdue, 'course')} past ${n.overdue === 1 ? 'its' : 'their'} due date. Let’s get ${n.overdue === 1 ? 'it' : 'them'} done today.`
    : n.assigned ? `You have ${plural(n.assigned, 'course')} to finish${n.mandatory ? `, ${n.mandatory} of them mandatory` : ''}. A few minutes today keeps you on track.`
    : n.completed ? 'You are all caught up. Pick something new to learn whenever you like.'
    : 'Your learning starts here. Explore courses picked for your role and team.'
  const pct = Math.round(Number(lead?.progress_pct) || 0)
  return (
    <section className="lx-hero lx-in">
      <Aurora />
      <div className="lx-hero-grid">
        <div style={{ minWidth: 0 }}>
          <span className="lx-hero-kicker"><GSparkle size={14} /> EZER Learn</span>
          <h1>{greeting()}{name ? <>, <em>{name}</em></> : ''}.</h1>
          <p className="lx-hero-line">{line}</p>
          <div className="lx-hero-ctas">
            {lead
              ? <a className="lx-btn lx-btn--white lx-btn--lg" {...linkProps(to.play(lead.id))}><GPlay size={16} /> {lead.status === 'IN_PROGRESS' ? 'Resume learning' : 'Start learning'}</a>
              : <a className="lx-btn lx-btn--white lx-btn--lg" {...linkProps(to.catalog())}><GCompass size={17} /> Explore courses</a>}
            {lead && <a className="lx-btn lx-btn--light lx-btn--lg" {...linkProps(to.catalog())}>Explore courses</a>}
            {!lead && n.completed > 0 && <a className="lx-btn lx-btn--light lx-btn--lg" {...linkProps(to.achievements())}><GTrophy size={16} /> My achievements</a>}
          </div>
          <div className="lx-hero-stats lx-num">
            <div className="lx-hero-stat"><b><CountUp value={n.assigned} /></b><span>to finish</span></div>
            <div className="lx-hero-stat"><b><CountUp value={n.in_progress} /></b><span>in progress</span></div>
            <div className="lx-hero-stat" data-hot={n.overdue ? '1' : '0'}><b><CountUp value={n.overdue} /></b><span>overdue</span></div>
            <div className="lx-hero-stat"><b><CountUp value={n.completed} /></b><span>completed</span></div>
            {cat && <div className="lx-hero-stat"><b><CountUp value={cat.courses.length} /></b><span>in the catalogue</span></div>}
          </div>
        </div>
        {lead && (
          <a className="lx-hero-card" {...linkProps(to.play(lead.id))} aria-label={`${lead.status === 'IN_PROGRESS' ? 'Resume' : 'Start'} ${lead.course?.title || 'course'}`}>
            <CourseArt src={lead.course?.thumbnail} id={lead.course_id} title={lead.course?.title} />
            <span className="lx-hero-card-play" aria-hidden><GPlay size={22} /></span>
            <span style={{ display: 'grid', gap: 10, padding: '14px 4px 2px' }}>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="lx-tag lx-tag--glass">{lead.status === 'IN_PROGRESS' ? 'Continue where you left off' : lead.mandatory ? 'Mandatory' : 'Up next'}</span>
                <DueTag dueAt={lead.due_at} overdue={lead.overdue} status={lead.status} />
              </span>
              <span style={{ fontSize: 18, fontWeight: 750, lineHeight: 1.25 }} className="lx-clamp2">{lead.course?.title || 'Course'}</span>
              <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
                <span className="lx-bar"><i style={{ width: `${pct}%` }} /></span>
                <span className="lx-num" style={{ fontSize: 12.5, fontWeight: 700 }}>{pct}%</span>
              </span>
            </span>
          </a>
        )}
      </div>
    </section>
  )
}

function Deadlines({ items }: { items: LearnItem[] }) {
  if (!items.length) return null
  return (
    <section className="lx-panel">
      <div className="lx-panel-head"><div className="lx-panel-title">Upcoming deadlines</div><a className="lx-sec-link" {...linkProps(to.my('todo'))}>All</a></div>
      {items.slice(0, 5).map(i => {
        const d = dueWords(i.due_at)
        const day = i.due_at ? new Date(i.due_at) : null
        return (
          <button key={i.id} className="lx-dl" data-t={i.overdue ? 'critical' : d?.t} onClick={() => navigate(to.play(i.id))}>
            <span className="lx-dl-date">
              <b>{day ? day.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'}</b>
              <span>{day ? day.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Asia/Kolkata' }) : ''}</span>
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="lx-clamp1" style={{ display: 'block', fontSize: 13.5, fontWeight: 650 }}>{i.course?.title || 'Course'}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: i.overdue ? 'var(--ez-critical)' : d?.t === 'warning' ? 'var(--ez-warning)' : 'var(--ez-muted)', marginTop: 2 }}>{d?.text}{i.mandatory ? ' · mandatory' : ''}</span>
            </span>
          </button>
        )
      })}
    </section>
  )
}

function Milestones({ dash }: { dash: Dashboard }) {
  const n = dash.counts || { assigned: 0, mandatory: 0, overdue: 0, in_progress: 0, completed: 0 }
  const paths = (dash.paths || []).filter(p => p.status === 'COMPLETED').length
  // Earned from the learner's own record; nothing here is awarded by hand.
  const list = [
    { k: 'first', label: 'First course', on: n.completed >= 1, mark: '1' },
    { k: 'five', label: 'Five courses', on: n.completed >= 5, mark: '5' },
    { k: 'ten', label: 'Ten courses', on: n.completed >= 10, mark: '10' },
    { k: 'path', label: 'Path finished', on: paths > 0, mark: <GLayers size={20} /> },
    { k: 'ontime', label: 'Nothing overdue', on: n.overdue === 0 && n.completed > 0, mark: <IconCheck size={20} /> },
    { k: 'three', label: 'Three courses', on: n.completed >= 3, mark: <GFlame size={20} /> },
  ]
  return (
    <section className="lx-panel">
      <div className="lx-panel-head"><div className="lx-panel-title">Milestones</div><a className="lx-sec-link" {...linkProps(to.achievements())}>Achievements</a></div>
      <div className="lx-badges">
        {list.map(m => <div key={m.k} className="lx-medal" data-off={m.on ? '0' : '1'} title={m.on ? 'Earned' : 'Not earned yet'}><span>{m.mark}</span>{m.label}</div>)}
      </div>
    </section>
  )
}

function Paths({ dash }: { dash: Dashboard }) {
  const paths = dash.paths || []
  if (!paths.length) return null
  return (
    <section className="lx-panel">
      <div className="lx-panel-head"><div className="lx-panel-title">Your learning paths</div></div>
      {paths.map(p => {
        const pct = Math.round(Number(p.progress_pct) || 0)
        return (
          <div key={p.id} className="lx-path">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Ring pct={p.status === 'COMPLETED' ? 100 : pct} size={42} stroke={4} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>{p.status === 'COMPLETED' ? 'Completed' : p.order_mode === 'SEQUENTIAL' ? 'Courses open one by one' : 'Any order'}{p.status !== 'COMPLETED' && p.due_at ? ` · ${dueWords(p.due_at)?.text}` : ''}</div>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function Pending({ items }: { items: LearnItem[] }) {
  if (!items.length) return null
  return (
    <section className="lx-panel">
      <div className="lx-panel-head"><div className="lx-panel-title">Waiting for approval</div></div>
      {items.map(i => (
        <div key={i.id} className="lx-path" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', display: 'grid', alignItems: 'center' }}>
          <span className="lx-tag lx-tag--warning">Pending</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{i.course?.title || 'Course'}<span style={{ display: 'block', fontSize: 12, color: 'var(--ez-muted)', fontWeight: 500 }}>Asked {shortDay((i as any).enrolled_at)} · your manager decides</span></span>
        </div>
      ))}
    </section>
  )
}

/** The spotlight: what HR featured, then what is recommended, then what is new, six at most,
 *  each course once, and none the person has already finished. */
function spotlightOf(courses: CatCourse[], recommended: CatCourse[]) {
  const out: { c: CatCourse; why: string }[] = []
  const add = (list: CatCourse[], why: string) => {
    for (const c of list) {
      if (out.length >= 6) return
      if (c.mine?.status === 'COMPLETED' || out.some(o => o.c.id === c.id)) continue
      out.push({ c, why })
    }
  }
  add(courses.filter(c => c.is_featured), 'Featured by HR')
  add(recommended, 'Recommended for you')
  add(courses.filter(isNew), 'New this month')
  return out
}

export default function Home({ dash, dashErr, cat, onRetry }: { dash: Dashboard | null; dashErr: string; cat: Catalog | null; onRetry: () => void }) {
  const shelves = useMemo(() => {
    const courses = cat?.courses || []
    const catName = new Map((cat?.categories || []).map(c => [c.id, c.name]))
    const notMine = (c: CatCourse) => !c.mine
    return {
      catName,
      recommended: (cat?.recommended || []).slice(0, 10),
      featured: courses.filter(c => c.is_featured).slice(0, 10),
      fresh: [...courses].filter(c => c.published_at).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 10),
      popular: [...courses].filter(c => (c.learners || 0) > 0 || c.rating != null).sort((a, b) => (b.learners || 0) - (a.learners || 0) || (b.rating || 0) - (a.rating || 0)).slice(0, 10),
      quick: courses.filter(c => notMine(c) && c.est_minutes != null && c.est_minutes <= 15).slice(0, 10),
      categories: (cat?.categories || []).map(x => ({ ...x, n: courses.filter(c => c.category_id === x.id).length })).filter(x => x.n > 0),
      spotlight: spotlightOf(courses, cat?.recommended || []),
    }
  }, [cat])

  if (!dash) {
    if (dashErr) return <Oops message={dashErr} onRetry={onRetry} />
    return (
      <div style={{ display: 'grid', gap: 32 }}>
        <Skel h={300} r={24} />
        <div className="lx-home-grid"><div style={{ display: 'grid', gap: 20 }}><Skel h={26} w={240} /><div className="lx-grid">{[0, 1, 2].map(i => <Skel key={i} h={280} r={16} />)}</div></div><Skel h={320} r={16} /></div>
      </div>
    )
  }

  // A course shows once, in the most pressing shelf it belongs to.
  const seen = new Set<string>()
  const once = (list: LearnItem[] = []) => list.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true })
  const overdue = once(dash.overdue), resume = once(dash.continue), mandatory = once(dash.mandatory), optional = once(dash.optional)
  const lead = overdue[0] || resume[0] || mandatory[0] || optional[0] || null
  const deadlines = [...(dash.overdue || []), ...(dash.upcoming || [])].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)
  const todo = [...overdue, ...mandatory]
  const nothingAtAll = !seen.size && !(dash.completed || []).length && !(cat?.courses || []).length

  return (
    <div className="lx-stack">
      <Hero dash={dash} lead={lead} cat={cat} />

      {shelves.spotlight.length > 1 && (
        <Carousel items={shelves.spotlight} label="Spotlight courses" slideLabel={s => s.c.title}
          render={s => <Billboard c={s.c} why={s.why} category={shelves.catName.get(s.c.category_id || '')} />} />
      )}

      {nothingAtAll ? (
        <EmptyState title="Your learning will show up here" icon={<GCompass size={34} />}>Anything HR assigns to you appears on this page, and the catalogue fills up as courses are published.</EmptyState>
      ) : (
        <div className="lx-home-grid">
          <div className="lx-stack" style={{ minWidth: 0 }}>
            {todo.length > 0 && (
              <Rail title={overdue.length ? 'Needs your attention' : 'Mandatory training'} sub={overdue.length ? 'Overdue and mandatory courses, most urgent first' : 'Required for your role. Finish these before their due dates.'} more={{ label: 'See all', href: to.my('todo') }} n={todo.length}>
                {todo.map(i => <LearnCard key={i.id} item={i} />)}
              </Rail>
            )}
            {resume.length > 0 && (
              <Rail title="Continue learning" sub="Pick up right where you left off" more={{ label: 'My learning', href: to.my() }} n={resume.length}>
                {resume.map(i => <LearnCard key={i.id} item={i} />)}
              </Rail>
            )}
            {optional.length > 0 && (
              <Rail title="Assigned to you" sub="Optional courses HR or your manager suggested" n={optional.length}>
                {optional.map(i => <LearnCard key={i.id} item={i} />)}
              </Rail>
            )}
            {shelves.recommended.length > 0 && (
              <Rail title="Recommended for you" sub="Picked by HR, popular in your department, or close to what you finished" more={{ label: 'Explore', href: to.catalog() }} n={shelves.recommended.length}>
                {shelves.recommended.map(c => <CourseCard key={c.id} c={c} category={shelves.catName.get(c.category_id || '')} />)}
              </Rail>
            )}
            {shelves.categories.length > 0 && (
              <section>
                <div className="lx-sec-head"><div><h2 className="lx-sec-title">Browse by category</h2><div className="lx-sec-sub">Find courses by subject</div></div></div>
                <div className="lx-cats">
                  {shelves.categories.map(x => (
                    <a key={x.id} className="lx-cat" data-h={hueOf(x.id)} {...linkProps(to.catalog({ cat: x.id }))}>
                      <b>{x.name}</b><span className="lx-num">{plural(x.n, 'course')}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
            {shelves.featured.length > 0 && (
              <Rail title="Featured by HR" sub="Courses your company wants everyone to see" n={shelves.featured.length}>
                {shelves.featured.map(c => <CourseCard key={c.id} c={c} category={shelves.catName.get(c.category_id || '')} />)}
              </Rail>
            )}
            {shelves.fresh.length > 0 && (
              <Rail title="Recently added" sub={shelves.fresh.some(isNew) ? 'Fresh in the catalogue this month' : 'The latest courses in the catalogue'} more={{ label: 'Newest first', href: to.catalog() }} n={shelves.fresh.length}>
                {shelves.fresh.map(c => <CourseCard key={c.id} c={c} category={shelves.catName.get(c.category_id || '')} />)}
              </Rail>
            )}
            {shelves.popular.length > 0 && (
              <Rail title="Popular with colleagues" sub="What people across the company are taking" n={shelves.popular.length}>
                {shelves.popular.map(c => <CourseCard key={c.id} c={c} category={shelves.catName.get(c.category_id || '')} />)}
              </Rail>
            )}
            {shelves.quick.length > 0 && (
              <Rail title="Learn something in 15 minutes" sub="Short courses for a coffee break" n={shelves.quick.length}>
                {shelves.quick.map(c => <CourseCard key={c.id} c={c} category={shelves.catName.get(c.category_id || '')} />)}
              </Rail>
            )}
          </div>
          <aside className="lx-home-side" aria-label="At a glance">
            <Deadlines items={deadlines} />
            <Paths dash={dash} />
            <Pending items={dash.pending || []} />
            <Milestones dash={dash} />
            {(dash.completed || []).length > 0 && (
              <section className="lx-panel">
                <div className="lx-panel-head"><div className="lx-panel-title">Recently completed</div><a className="lx-sec-link" {...linkProps(to.my('done'))}>All</a></div>
                {(dash.completed || []).slice(0, 3).map(i => (
                  <button key={i.id} className="lx-dl" onClick={() => navigate(to.play(i.id))} disabled={i.status !== 'COMPLETED'}>
                    <CourseArt src={i.course?.thumbnail} id={i.course_id} title={i.course?.title} word={false} style={{ width: 52, height: 40, borderRadius: 9 }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="lx-clamp1" style={{ display: 'block', fontSize: 13.5, fontWeight: 650 }}>{i.course?.title || 'Course'}</span>
                      <span className="lx-num" style={{ display: 'block', fontSize: 12.5, color: 'var(--ez-muted)' }}>{i.status === 'COMPLETED' ? `Finished ${shortDay(i.completed_at)}` : i.status.toLowerCase()}{i.score_pct != null ? ` · ${Number(i.score_pct)}%` : ''}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
