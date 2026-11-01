'use client'
// components/learning/MyLearning.tsx — the learner's home, for employees and candidates alike.
//
// The dashboard route answers in overlapping lists (an overdue mandatory course in progress
// is in three of them). A course shows as a card once, in the most pressing section it
// belongs to. Upcoming deadlines is a dated list, so it may repeat a title on purpose.
import { useState } from 'react'
import { C, F, W, S, R, E, Badge, Button, Card, numeric, IconCheck, IconClock } from '@/lib/ui'
import { CourseTile, DueBadge, ProgressBar, SectionHead, STATUS, dayWords, durationWords, dueWords, firstName, plural, shortDay, type Dashboard, type LearnItem, type LearnPath } from './shared'

function ActionWord(i: LearnItem, readOnly?: boolean) {
  if (readOnly) return 'View'
  if (i.status === 'IN_PROGRESS') return 'Resume'
  if (i.status === 'FAILED') return 'Open'
  return 'Start'
}

function CourseRow({ item, onOpen, primary, readOnly }: { item: LearnItem; onOpen: (id: string) => void; primary?: boolean; readOnly?: boolean }) {
  const pct = Number(item.progress_pct) || 0
  const c = item.course
  const mins = durationWords(c?.est_minutes)
  return (
    <div className="ezl-row ezl-hover" onClick={() => onOpen(item.id)}
      style={{ background: C.surface, border: `1px solid ${item.overdue ? C.criticalEdge : C.line}`, borderRadius: R.lg, padding: S.md, boxShadow: E.flat, cursor: 'pointer' }}>
      <CourseTile src={c?.thumbnail} />
      <div style={{ minWidth: 0, display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: W.semi, color: C.ink, fontSize: F.body, lineHeight: 1.3 }}>{c?.title || 'Course'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {item.mandatory && <Badge t="brand" size="sm">Mandatory</Badge>}
          {c?.is_compliance && <Badge t="info" size="sm">Compliance</Badge>}
          {item.status === 'FAILED' && <Badge t="critical" size="sm">{STATUS.FAILED.label}</Badge>}
          <DueBadge dueAt={item.due_at} overdue={item.overdue} />
          {mins && <span style={{ fontSize: F.tiny, color: C.muted }}>{mins}</span>}
        </div>
        {pct > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: S.sm, alignItems: 'center' }}>
            <ProgressBar pct={pct} label={`${c?.title || 'Course'} progress`} />
            <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{Math.round(pct)}%</span>
          </div>
        )}
      </div>
      <div className="ezl-row-action" onClick={e => e.stopPropagation()}>
        <Button variant={primary ? 'primary' : 'secondary'} onClick={() => onOpen(item.id)}>{ActionWord(item, readOnly)}</Button>
      </div>
    </div>
  )
}

function CourseList({ title, items, onOpen, t, hint, order, primary, readOnly }: { title: string; items: LearnItem[]; onOpen: (id: string) => void; t?: 'critical'; hint?: string; order: number; primary?: boolean; readOnly?: boolean }) {
  if (!items.length) return null
  return (
    <section style={{ order }}>
      <SectionHead title={title} count={items.length} t={t} hint={hint} />
      <div style={{ display: 'grid', gap: S.sm }}>
        {items.map(i => <CourseRow key={i.id} item={i} onOpen={onOpen} primary={primary} readOnly={readOnly} />)}
      </div>
    </section>
  )
}

function Upcoming({ items, onOpen, order }: { items: LearnItem[]; onOpen: (id: string) => void; order: number }) {
  if (!items.length) return null
  return (
    <section style={{ order }}>
      <SectionHead title="Upcoming deadlines" />
      <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
        {items.map((i, n) => {
          const d = dueWords(i.due_at)
          return (
            <div key={i.id} style={{ borderTop: n ? `1px solid ${C.line}` : 0 }}>
              <button onClick={() => onOpen(i.id)} className="ezl-navrow"
                style={{ width: '100%', display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', gap: S.md, alignItems: 'center', padding: `${S.sm + 2}px ${S.md}px`, background: 'transparent', border: 0, textAlign: 'left', fontFamily: 'inherit', color: C.ink }}>
                <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft, ...numeric }}>{shortDay(i.due_at)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: F.small, fontWeight: W.medium, lineHeight: 1.3 }}>{i.course?.title || 'Course'}</span>
                  <span style={{ display: 'block', fontSize: F.tiny, color: d?.t === 'warning' ? C.warning : C.muted, marginTop: 1 }}>{d?.text}</span>
                </span>
              </button>
            </div>
          )
        })}
      </Card>
    </section>
  )
}

function PathsCard({ paths, order }: { paths: LearnPath[]; order: number }) {
  if (!paths.length) return null
  return (
    <section style={{ order }}>
      <SectionHead title="Learning paths" />
      <div style={{ display: 'grid', gap: S.sm }}>
        {paths.map(p => (
          <Card key={p.id} pad={S.md} elevation="flat">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.sm }}>
              <div style={{ fontWeight: W.semi, fontSize: F.small, minWidth: 0 }}>{p.title}</div>
              <span style={{ fontSize: F.tiny, color: C.muted, flexShrink: 0, ...numeric }}>{Math.round(Number(p.progress_pct) || 0)}%</span>
            </div>
            <div style={{ margin: '8px 0 6px' }}><ProgressBar pct={p.progress_pct} label={`${p.title} progress`} /></div>
            <div style={{ fontSize: F.tiny, color: C.muted }}>
              {p.status === 'COMPLETED' ? 'Completed' : p.order_mode === 'SEQUENTIAL' ? 'Courses open one after another' : 'Take the courses in any order'}
              {p.status !== 'COMPLETED' && p.due_at ? ` · ${dueWords(p.due_at)?.text}` : ''}
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function PendingCard({ items, order }: { items: LearnItem[]; order: number }) {
  if (!items.length) return null
  return (
    <section style={{ order }}>
      <SectionHead title="Pending requests" count={items.length} />
      <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
        {items.map((i, n) => (
          <div key={i.id} style={{ display: 'flex', gap: S.sm, alignItems: 'center', padding: `${S.sm + 2}px ${S.md}px`, borderTop: n ? `1px solid ${C.line}` : 0 }}>
            <span style={{ color: C.warning }}><IconClock size={16} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: F.small, fontWeight: W.medium }}>{i.course?.title || 'Course'}</span>
              <span style={{ display: 'block', fontSize: F.tiny, color: C.muted }}>Waiting for your manager</span>
            </span>
          </div>
        ))}
      </Card>
    </section>
  )
}

function CompletedList({ items, onOpen, order }: { items: LearnItem[]; onOpen: (id: string) => void; order: number }) {
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 4)
  return (
    <section style={{ order }}>
      <SectionHead title="Completed" count={items.length} />
      <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
        {shown.map((i, n) => {
          const st = STATUS[i.status] || STATUS.COMPLETED
          const opens = i.status === 'COMPLETED'
          return (
            <div key={i.id} style={{ borderTop: n ? `1px solid ${C.line}` : 0 }}>
            <button disabled={!opens} onClick={() => onOpen(i.id)} className="ezl-navrow"
              style={{ width: '100%', display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: S.sm, alignItems: 'center', padding: `${S.sm + 2}px ${S.md}px`, background: 'transparent', border: 0, textAlign: 'left', fontFamily: 'inherit', color: C.ink, opacity: 1 }}>
              <span style={{ width: 24, height: 24, borderRadius: R.pill, display: 'grid', placeItems: 'center', background: i.status === 'COMPLETED' ? C.positiveTint : C.sunken, color: i.status === 'COMPLETED' ? C.positive : C.muted }}><IconCheck size={13} /></span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: F.small, fontWeight: W.medium, lineHeight: 1.3 }}>{i.course?.title || 'Course'}</span>
                <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 1, ...numeric }}>
                  {i.status === 'COMPLETED' ? `Finished ${dayWords(i.completed_at)}` : st.label}{i.score_pct != null ? ` · ${Number(i.score_pct)}%` : ''}
                </span>
              </span>
              {i.status === 'EXPIRED' && <Badge t="warning" size="sm">Expired</Badge>}
            </button>
            </div>
          )
        })}
        {items.length > 4 && (
          <div style={{ padding: `${S.sm}px ${S.md}px`, borderTop: `1px solid ${C.line}` }}>
            <button className="ezl-linkbtn" style={{ fontSize: F.small }} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>
          </div>
        )}
      </Card>
    </section>
  )
}

function greeting(name: string, candidate: boolean) {
  if (candidate) return name ? `Welcome, ${name}` : 'Welcome'
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}` : part
}

function Count({ label, value, t }: { label: string; value: number; t?: 'critical' }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: W.bold, lineHeight: 1.1, color: t && value ? C.critical : C.ink, ...numeric }}>{value}</div>
      <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function MyLearning({ data, onOpen, onBrowse, readOnly }: {
  data: Dashboard
  onOpen: (enrollmentId: string) => void
  /** Absent for candidates: they have no catalogue. */
  onBrowse?: () => void
  readOnly?: boolean
}) {
  const candidate = data.kind === 'CANDIDATE'
  const counts = data.counts || { assigned: 0, mandatory: 0, overdue: 0, in_progress: 0, completed: 0 }

  const seen = new Set<string>()
  const once = (list: LearnItem[] = []) => list.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true })
  const overdue = once(data.overdue), resume = once(data.continue), mandatory = once(data.mandatory), optional = once(data.optional)
  const upcoming = data.upcoming || [], paths = data.paths || [], pending = data.pending || [], completed = data.completed || []
  const hasSide = upcoming.length + paths.length + pending.length > 0
  const nothing = !seen.size && !completed.length && !pending.length && !paths.length

  const line = counts.assigned
    ? `${plural(counts.assigned, 'course')} to finish${counts.overdue ? `, ${counts.overdue} overdue` : ''}.`
    : completed.length ? 'You are all caught up.' : candidate ? 'Your lessons will appear here.' : 'Nothing assigned to you right now.'

  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.xl }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.lg, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: W.bold, letterSpacing: '-.015em', color: C.ink }}>{greeting(firstName(data.name), candidate)}</div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 2 }}>{line}</div>
        </div>
        {!nothing && (
          <div className="ezl-counts">
            <Count label="To finish" value={counts.assigned} />
            <Count label="In progress" value={counts.in_progress} />
            <Count label="Overdue" value={counts.overdue} t="critical" />
            <Count label="Completed" value={counts.completed} />
          </div>
        )}
      </header>

      {nothing ? (
        <Card style={{ textAlign: 'center', padding: `${S.huge}px ${S.xl}px` }}>
          <div style={{ fontSize: F.lead, fontWeight: W.semi }}>{candidate ? 'Nothing here just yet' : 'Your learning will show up here'}</div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 6 }}>
            {candidate ? 'HR will add your lessons soon. We will let you know.' : 'Anything HR assigns appears on this page. You can also pick a course yourself.'}
          </div>
          {onBrowse && <div style={{ marginTop: S.lg }}><Button variant="primary" onClick={onBrowse}>Browse the catalogue</Button></div>}
        </Card>
      ) : (
        <div className="ezl-dash" data-side={hasSide ? '1' : '0'}>
          <div className="ezl-col">
            <CourseList title="Overdue" items={overdue} onOpen={onOpen} t="critical" order={1} primary readOnly={readOnly} />
            <CourseList title="Continue learning" items={resume} onOpen={onOpen} order={2} primary={!overdue.length} readOnly={readOnly} />
            <CourseList title="Mandatory training" items={mandatory} onOpen={onOpen} order={3} readOnly={readOnly} />
            <CourseList title="Optional learning" items={optional} onOpen={onOpen} order={5} readOnly={readOnly} />
            {!seen.size && onBrowse && (
              <div style={{ order: 5 }}>
                <Card elevation="flat" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: F.small, color: C.inkSoft }}>Nothing left to do. Want to learn something new?</span>
                  <Button onClick={onBrowse}>Browse the catalogue</Button>
                </Card>
              </div>
            )}
            <CompletedList items={completed} onOpen={onOpen} order={8} />
          </div>
          {hasSide && (
            <div className="ezl-col">
              <Upcoming items={upcoming} onOpen={onOpen} order={4} />
              <PathsCard paths={paths} order={6} />
              <PendingCard items={pending} order={7} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
