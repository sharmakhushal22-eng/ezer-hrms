'use client'
// components/learning/MyLearning.tsx — everything the learner is taking, sorted into what to do,
// what is under way, what is finished, what waits for approval, and their learning paths.
// Also the candidate's home on their /learn link, where it is the whole page.
//
// The dashboard route answers in overlapping lists (an overdue mandatory course in progress
// is in three of them). Each course shows once per tab.
import { useState } from 'react'
import { linkProps, navigate, to } from './app/router'
import { LearnCard } from './CourseCard'
import { EmptyState, Oops, Ring, Skel, dueWords, firstName, plural, type Dashboard, type LearnItem } from './shared'
import { GBook, GCompass, GLayers } from './glyphs'
import { Aurora } from './motion/Aurora'
import { CountUp } from './motion/CountUp'

type Tab = 'todo' | 'going' | 'done' | 'requests' | 'paths'

const uniq = (list: LearnItem[]) => list.filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)

function Grid({ items, onOpen, readOnly }: { items: LearnItem[]; onOpen?: (id: string) => void; readOnly?: boolean }) {
  return <div className="lx-grid">{items.map(i => <LearnCard key={i.id} item={i} readOnly={readOnly} onOpen={onOpen ? () => onOpen(i.id) : undefined} />)}</div>
}

export default function MyLearning({ data, err, tab: asked, onReload, onOpen, onBrowse, readOnly }: {
  data: Dashboard | null
  err?: string
  /** ?tab= on the address. */
  tab?: string | null
  onReload?: () => void
  /** Open a course; by default the app's own player address. The candidate page takes over. */
  onOpen?: (enrollmentId: string) => void
  /** Absent for candidates in their own page: they have no catalogue. */
  onBrowse?: () => void
  readOnly?: boolean
}) {
  const [own, setOwn] = useState<Tab | null>(null)
  if (!data) {
    if (err) return <Oops message={err} onRetry={onReload} />
    return <div style={{ display: 'grid', gap: 24 }}><Skel h={150} r={22} /><Skel h={44} w={420} /><div className="lx-grid">{[0, 1, 2].map(i => <Skel key={i} h={300} r={16} />)}</div></div>
  }
  const candidate = data.kind === 'CANDIDATE'
  const embedded = !!onOpen
  const n = data.counts || { assigned: 0, mandatory: 0, overdue: 0, in_progress: 0, completed: 0 }
  const todo = uniq([...(data.overdue || []), ...(data.mandatory || []), ...(data.optional || [])]).filter(i => i.status !== 'IN_PROGRESS')
  const going = uniq([...(data.overdue || []), ...(data.continue || []), ...(data.mandatory || []), ...(data.optional || [])]).filter(i => i.status === 'IN_PROGRESS')
  const done = data.completed || []
  const requests = data.pending || []
  const paths = data.paths || []

  const tabs: { k: Tab; label: string; n: number }[] = [
    { k: 'todo', label: 'To do', n: todo.length },
    { k: 'going', label: 'In progress', n: going.length },
    { k: 'done', label: 'Completed', n: done.length },
    ...(requests.length ? [{ k: 'requests' as const, label: 'Requests', n: requests.length }] : []),
    ...(paths.length ? [{ k: 'paths' as const, label: 'Learning paths', n: paths.length }] : []),
  ]
  const fallback: Tab = going.length ? 'going' : todo.length ? 'todo' : done.length ? 'done' : 'todo'
  const wanted = (own || asked) as Tab | null
  const tab: Tab = wanted && tabs.some(t => t.k === wanted) ? wanted : fallback
  const pick = (k: Tab) => { setOwn(k); if (!embedded) navigate(to.my(k), { replace: true, keepScroll: true }) }
  const total = n.assigned + n.completed
  const pct = total ? Math.round((n.completed / total) * 100) : 0
  const browse = onBrowse || (!candidate && !embedded ? () => navigate(to.catalog()) : undefined)

  let body: React.ReactNode
  if (tab === 'paths') {
    body = (
      <div className="lx-grid">
        {paths.map(p => {
          const v = Math.round(Number(p.progress_pct) || 0)
          return (
            <div key={p.id} className="lx-panel lx-in" style={{ padding: 20, display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <Ring pct={p.status === 'COMPLETED' ? 100 : v} size={60} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 750, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ez-brand)', display: 'flex', gap: 6, alignItems: 'center' }}><GLayers size={13} /> Learning path</div>
                  <div style={{ fontWeight: 750, fontSize: 16, marginTop: 2 }}>{p.title}</div>
                </div>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ez-muted)' }}>{p.status === 'COMPLETED' ? 'Completed' : p.order_mode === 'SEQUENTIAL' ? 'Courses open one after another' : 'Take the courses in any order'}{p.status !== 'COMPLETED' && p.due_at ? ` · ${dueWords(p.due_at)?.text}` : ''}</div>
              <div style={{ fontSize: 13, color: 'var(--ez-muted)' }}>Its courses are listed under To do and In progress.</div>
            </div>
          )
        })}
      </div>
    )
  } else if (tab === 'requests') {
    body = (
      <div className="lx-panel">
        {requests.map((i, k) => (
          <div key={i.id} className="lx-path" style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: k ? undefined : 0 }}>
            <span className="lx-tag lx-tag--warning">Waiting</span>
            <span style={{ fontWeight: 650, flex: 1, minWidth: 0 }}>{i.course?.title || 'Course'}</span>
            <span style={{ fontSize: 13, color: 'var(--ez-muted)' }}>Your manager decides</span>
          </div>
        ))}
      </div>
    )
  } else {
    const list = tab === 'todo' ? todo : tab === 'going' ? going : done
    body = list.length
      ? <Grid items={list} onOpen={onOpen} readOnly={readOnly} />
      : (
        <EmptyState title={tab === 'done' ? 'Nothing completed yet' : tab === 'going' ? 'Nothing under way' : candidate ? 'Nothing here just yet' : 'You are all caught up'} icon={<GBook size={34} />}
          action={browse && tab !== 'done' ? <button className="lx-btn lx-btn--primary" onClick={browse}><GCompass size={16} /> Explore courses</button> : undefined}>
          {tab === 'done' ? 'Courses you finish are kept here, with their scores and certificates.'
            : candidate ? 'HR will add your lessons soon. We will let you know.'
            : 'Anything HR or your manager assigns appears here. You can also pick a course yourself.'}
        </EmptyState>
      )
  }

  return (
    <div>
      <header className="lx-ph lx-in">
        <Aurora specks={8} />
        <div className="lx-ph-row">
          <div>
            <h1>{candidate ? `Welcome${firstName(data.name) ? `, ${firstName(data.name)}` : ''}` : 'My learning'}</h1>
            <p>{n.assigned ? `${plural(n.assigned, 'course')} to finish${n.overdue ? `, ${n.overdue} overdue` : ''}. Everything you have been given and everything you chose, in one place.` : 'Everything you have been given and everything you chose, in one place.'}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Ring pct={pct} size={78} stroke={7} track="rgba(255,255,255,.18)" color="var(--lx-hero-c)" text={<span style={{ color: 'var(--ez-on-dark)', fontSize: 19 }}>{pct}%</span>} label={`${pct}% of your assigned learning complete`} />
            <div className="lx-hero-stat lx-num"><b><CountUp value={n.completed} /><span style={{ display: 'inline', fontSize: 16, opacity: .7, margin: 0 }}> / {total}</span></b><span>courses completed</span></div>
          </div>
        </div>
      </header>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div className="lx-tabs" role="tablist" aria-label="My learning">
          {tabs.map(t => <button key={t.k} role="tab" aria-selected={t.k === tab} onClick={() => pick(t.k)}>{t.label}{t.n > 0 && <span className="lx-nav-count lx-num">{t.n}</span>}</button>)}
        </div>
        {browse && !embedded && <a className="lx-sec-link" {...linkProps(to.catalog())}><GCompass size={15} /> Find something new</a>}
      </div>
      <div key={tab} className="lx-in">{body}</div>
    </div>
  )
}
