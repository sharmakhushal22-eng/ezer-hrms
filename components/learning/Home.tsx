'use client'
// components/learning/Home.tsx — the first screen of EZER Learn: a welcome that says what needs
// doing, the course to pick up where you left off, the next deadlines, and rows of courses that
// glide along on their own, one card at a time, like a streaming service's shelves.
//
// Everything here comes from two reads the app already holds: the learner's dashboard (what is
// assigned, in progress, due) and the catalogue (what they may take). Rows with nothing in them
// are left out rather than shown empty.
import { useMemo, type ReactNode } from 'react'
import { IconCheck } from '@/lib/ui'
import { linkProps, navigate, to } from './app/router'
import type { Catalog } from './Catalogue'
import { CourseCard, LearnCard, isNew } from './CourseCard'
import { CourseArt, DueTag, EmptyState, Oops, Ring, Skel, dueWords, durationWords, firstName, hueOf, plural, shortDay, LEVEL, type Dashboard, type LearnItem } from './shared'
import { GArrowRight, GBook, GCheckCircle, GClock, GCompass, GFlame, GLayers, GPlay, GTrophy } from './glyphs'
import { keys, paths, prefetch } from './app/cache'
import { CountUp } from './motion/CountUp'
import { Scroller } from './motion/Scroller'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** A row of courses that scrolls sideways: arrows on a desktop, a swipe on a phone, and, given
 *  `auto`, a slow glide of its own. */
function Rail({ title, sub, more, children, n, auto }: { title: string; sub?: string; more?: { label: string; href: string }; children: ReactNode; n: number; auto?: number }) {
  return (
    <section className="lx-row">
      <div className="lx-sec-head">
        <div><h2 className="lx-sec-title">{title}</h2>{sub && <div className="lx-sec-sub">{sub}</div>}</div>
        {more && <a className="lx-sec-link" {...linkProps(more.href)}>{more.label} <GArrowRight size={14} /></a>}
      </div>
      <Scroller className="lx-rail" n={n} progress auto={auto} label={title}>{children}</Scroller>
    </section>
  )
}

/** The greeting, one sentence on where things stand, and the counts as tiles that open the list
 *  they count. */
function Welcome({ dash, cat }: { dash: Dashboard; cat: Catalog | null }) {
  const n = dash.counts || { assigned: 0, mandatory: 0, overdue: 0, in_progress: 0, completed: 0 }
  const name = firstName(dash.name)
  const line = n.overdue ? `${plural(n.overdue, 'course')} past ${n.overdue === 1 ? 'its' : 'their'} due date. Let’s get ${n.overdue === 1 ? 'it' : 'them'} done today.`
    : n.assigned ? `You have ${plural(n.assigned, 'course')} to finish${n.mandatory ? `, ${n.mandatory} of them mandatory` : ''}. A few minutes today keeps you on track.`
    : n.completed ? 'You are all caught up. Pick something new to learn whenever you like.'
    : 'Your learning starts here. Explore courses picked for your role and team.'
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })
  const tiles = [
    { k: 'todo', v: n.assigned, label: 'To finish', href: to.my('todo'), icon: <GBook size={17} /> },
    { k: 'going', v: n.in_progress, label: 'In progress', href: to.my('going'), icon: <GPlay size={15} /> },
    { k: 'late', v: n.overdue, label: 'Overdue', href: to.my('todo'), icon: <GClock size={17} />, hot: n.overdue > 0 },
    { k: 'done', v: n.completed, label: 'Completed', href: to.my('done'), icon: <GCheckCircle size={17} /> },
    ...(cat ? [{ k: 'cat', v: cat.courses.length, label: 'In the catalogue', href: to.catalog(), icon: <GCompass size={17} /> }] : []),
  ]
  return (
    <section className="lx-welcome lx-in" aria-label="Welcome">
      <div className="lx-welcome-head">
        <div style={{ minWidth: 0 }}>
          <div className="lx-eyebrow">{today}</div>
          <h1 className="lx-welcome-h">{greeting()}{name ? <>, <em>{name}</em></> : ''}</h1>
          <p className="lx-welcome-line">{line}</p>
        </div>
        <div className="lx-welcome-ctas">
          <a className="lx-btn" {...linkProps(to.catalog())}><GCompass size={16} /> Explore courses</a>
          {n.completed > 0 && <a className="lx-btn" {...linkProps(to.achievements())}><GTrophy size={16} /> Achievements</a>}
        </div>
      </div>
      <div className="lx-stats lx-num">
        {tiles.map(t => (
          <a key={t.k} className="lx-stat" data-hot={t.hot ? '1' : '0'} {...linkProps(t.href)}>
            <i aria-hidden>{t.icon}</i>
            <b><CountUp value={t.v} /></b>
            <span>{t.label}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** The one course to open next, large: overdue first, then what is under way, then mandatory. */
function Resume({ lead }: { lead: LearnItem }) {
  const c = lead.course
  const pct = Math.round(Number(lead.progress_pct) || 0)
  const verb = lead.status === 'IN_PROGRESS' ? 'Resume' : lead.status === 'FAILED' ? 'Try again' : 'Start'
  const warm = () => prefetch(keys.view(lead.id), paths.view(lead.id))
  return (
    <article className="lx-resume lx-in" data-late={lead.overdue ? '1' : '0'}>
      <a className="lx-resume-art" {...linkProps(to.play(lead.id))} onPointerEnter={warm} aria-label={`${verb} ${c?.title || 'course'}`}>
        <CourseArt src={c?.thumbnail} id={lead.course_id} title={c?.title} />
        <span className="lx-resume-play" aria-hidden><GPlay size={20} /></span>
      </a>
      <div className="lx-resume-body">
        <div className="lx-eyebrow">{lead.overdue ? 'Overdue: finish this first' : lead.status === 'IN_PROGRESS' ? 'Continue where you left off' : lead.mandatory ? 'Mandatory: up next' : 'Up next'}</div>
        <h2 className="lx-resume-title lx-clamp2">{c?.title || 'Course'}</h2>
        {c?.summary && <p className="lx-resume-sum lx-clamp2">{c.summary}</p>}
        <div className="lx-cc-meta lx-num">
          <DueTag dueAt={lead.due_at} overdue={lead.overdue} status={lead.status} />
          {lead.mandatory && <span className="lx-tag lx-tag--brand">Mandatory</span>}
          {!!c?.est_minutes && <span><GClock size={13} />{durationWords(c.est_minutes)}</span>}
          {c?.difficulty && <span>{LEVEL[c.difficulty]}</span>}
        </div>
        <div className="lx-resume-prog">
          <span className="lx-bar"><i style={{ width: `${pct}%` }} /></span>
          <span className="lx-num">{pct}% complete</span>
        </div>
        <div className="lx-resume-ctas">
          <a className="lx-btn lx-btn--primary" {...linkProps(to.play(lead.id))} onPointerEnter={warm}><GPlay size={14} /> {verb}</a>
          <a className="lx-btn" {...linkProps(to.course(lead.course_id))}>Course details</a>
        </div>
      </div>
    </article>
  )
}

/** Where the resume card goes when nothing is assigned. */
function Discover() {
  return (
    <article className="lx-resume lx-resume--empty lx-in">
      <div className="lx-resume-body">
        <div className="lx-eyebrow">Nothing assigned right now</div>
        <h2 className="lx-resume-title">Find your next course</h2>
        <p className="lx-resume-sum">Browse the catalogue by subject, or start with what colleagues in your team are taking.</p>
        <div className="lx-resume-ctas"><a className="lx-btn lx-btn--primary" {...linkProps(to.catalog())}><GCompass size={15} /> Explore courses</a></div>
      </div>
    </article>
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

// Each row glides at its own pace, so rows on screen together never move in step.
const PACE = [5200, 6100, 5600, 6600, 5900, 6300, 5400, 6800]

export default function Home({ dash, dashErr, cat, onRetry }: { dash: Dashboard | null; dashErr: string; cat: Catalog | null; onRetry: () => void }) {
  const shelves = useMemo(() => {
    const courses = cat?.courses || []
    const catName = new Map((cat?.categories || []).map(c => [c.id, c.name]))
    const notMine = (c: (typeof courses)[number]) => !c.mine
    return {
      catName,
      recommended: (cat?.recommended || []).slice(0, 12),
      featured: courses.filter(c => c.is_featured).slice(0, 12),
      fresh: [...courses].filter(c => c.published_at).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 12),
      popular: [...courses].filter(c => (c.learners || 0) > 0 || c.rating != null).sort((a, b) => (b.learners || 0) - (a.learners || 0) || (b.rating || 0) - (a.rating || 0)).slice(0, 12),
      quick: courses.filter(c => notMine(c) && c.est_minutes != null && c.est_minutes <= 15).slice(0, 12),
      categories: (cat?.categories || []).map(x => ({ ...x, n: courses.filter(c => c.category_id === x.id).length })).filter(x => x.n > 0),
    }
  }, [cat])

  if (!dash) {
    if (dashErr) return <Oops message={dashErr} onRetry={onRetry} />
    return (
      <div className="lx-stack">
        <div style={{ display: 'grid', gap: 14 }}><Skel h={18} w={180} /><Skel h={40} w={420} /><div className="lx-stats">{[0, 1, 2, 3, 4].map(i => <Skel key={i} h={92} r={14} />)}</div></div>
        <div className="lx-home-top"><Skel h={250} r={16} /><Skel h={250} r={16} /></div>
        <div style={{ display: 'grid', gap: 16 }}><Skel h={26} w={240} /><div className="lx-grid">{[0, 1, 2, 3].map(i => <Skel key={i} h={280} r={16} />)}</div></div>
      </div>
    )
  }

  // A course shows once, in the most pressing row it belongs to.
  const seen = new Set<string>()
  const once = (list: LearnItem[] = []) => list.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true })
  const overdue = once(dash.overdue), resume = once(dash.continue), mandatory = once(dash.mandatory), optional = once(dash.optional)
  const lead = overdue[0] || resume[0] || mandatory[0] || optional[0] || null
  const deadlines = [...(dash.overdue || []), ...(dash.upcoming || [])].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)
  const todo = [...overdue, ...mandatory]
  const nothingAtAll = !seen.size && !(dash.completed || []).length && !(cat?.courses || []).length
  let pace = 0
  const next = () => PACE[pace++ % PACE.length]
  const name = (id?: string | null) => shelves.catName.get(id || '')

  return (
    <div className="lx-stack">
      <Welcome dash={dash} cat={cat} />

      {nothingAtAll ? (
        <EmptyState title="Your learning will show up here" icon={<GCompass size={34} />}>Anything HR assigns to you appears on this page, and the catalogue fills up as courses are published.</EmptyState>
      ) : (
        <>
          <div className="lx-home-top" data-side={deadlines.length ? '1' : '0'}>
            {lead ? <Resume lead={lead} /> : <Discover />}
            {deadlines.length > 0 && <Deadlines items={deadlines} />}
          </div>

          {todo.length > 0 && (
            <Rail title={overdue.length ? 'Needs your attention' : 'Mandatory training'} sub={overdue.length ? 'Overdue and mandatory courses, most urgent first' : 'Required for your role. Finish these before their due dates.'} more={{ label: 'See all', href: to.my('todo') }} n={todo.length} auto={next()}>
              {todo.map(i => <LearnCard key={i.id} item={i} />)}
            </Rail>
          )}
          {resume.length > 0 && (
            <Rail title="Continue learning" sub="Pick up right where you left off" more={{ label: 'My learning', href: to.my() }} n={resume.length} auto={next()}>
              {resume.map(i => <LearnCard key={i.id} item={i} />)}
            </Rail>
          )}
          {optional.length > 0 && (
            <Rail title="Assigned to you" sub="Optional courses HR or your manager suggested" n={optional.length} auto={next()}>
              {optional.map(i => <LearnCard key={i.id} item={i} />)}
            </Rail>
          )}
          {shelves.recommended.length > 0 && (
            <Rail title="Recommended for you" sub="Picked by HR, popular in your department, or close to what you finished" more={{ label: 'Explore', href: to.catalog() }} n={shelves.recommended.length} auto={next()}>
              {shelves.recommended.map(c => <CourseCard key={c.id} c={c} category={name(c.category_id)} />)}
            </Rail>
          )}
          {shelves.featured.length > 0 && (
            <Rail title="Featured by HR" sub="Courses your company wants everyone to see" n={shelves.featured.length} auto={next()}>
              {shelves.featured.map(c => <CourseCard key={c.id} c={c} category={name(c.category_id)} />)}
            </Rail>
          )}
          {shelves.categories.length > 0 && (
            <section className="lx-row">
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
          {shelves.fresh.length > 0 && (
            <Rail title="Recently added" sub={shelves.fresh.some(isNew) ? 'Fresh in the catalogue this month' : 'The latest courses in the catalogue'} more={{ label: 'Newest first', href: to.catalog() }} n={shelves.fresh.length} auto={next()}>
              {shelves.fresh.map(c => <CourseCard key={c.id} c={c} category={name(c.category_id)} />)}
            </Rail>
          )}
          {shelves.popular.length > 0 && (
            <Rail title="Popular with colleagues" sub="What people across the company are taking" n={shelves.popular.length} auto={next()}>
              {shelves.popular.map(c => <CourseCard key={c.id} c={c} category={name(c.category_id)} />)}
            </Rail>
          )}
          {shelves.quick.length > 0 && (
            <Rail title="Learn something in 15 minutes" sub="Short courses for a coffee break" n={shelves.quick.length} auto={next()}>
              {shelves.quick.map(c => <CourseCard key={c.id} c={c} category={name(c.category_id)} />)}
            </Rail>
          )}

          <section className="lx-row" aria-label="At a glance">
            <div className="lx-sec-head"><div><h2 className="lx-sec-title">At a glance</h2><div className="lx-sec-sub">Paths, milestones and what you finished lately</div></div></div>
            <div className="lx-glance">
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
            </div>
          </section>
        </>
      )}
    </div>
  )
}
