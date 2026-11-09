'use client'
// components/learning/LearningHub.tsx — EZER Learn inside ESS, at /ess/learning.
//
// The hub owns where the person is (tab, open course, course page) and keeps it in the query
// string with pushState, so Back and refresh work. The portal rewrites the path but carries
// the query through untouched (parseEssPath). When viewing someone else's portal the address
// belongs to the portal's overlay, so the position stays in state and the URL is left alone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { C, F, S, R, Skeleton } from '@/lib/ui'
import { LmsApiError, lmsApi, setViewing } from '@/lib/lms/client'
import { atEss, pushUrl } from '@/lib/ess/routes'
import { CalmMessage, LearnStyles, Problem, errorWords, type Dashboard } from './shared'
import MyLearning from './MyLearning'
import Catalogue from './Catalogue'
import CoursePage from './CoursePage'
import Achievements from './Achievements'
import Team, { type TeamData } from './Team'
import Player from './Player'

type Tab = 'learning' | 'catalogue' | 'achievements' | 'team'
interface Loc { tab: Tab; course: string | null; info: string | null }

const TAB_KEYS: Tab[] = ['learning', 'catalogue', 'achievements', 'team']

function readLoc(sync: boolean): Loc {
  if (!sync) return { tab: 'learning', course: null, info: null }
  const q = new URLSearchParams(window.location.search)
  const t = q.get('tab') as Tab
  return { tab: TAB_KEYS.includes(t) ? t : 'learning', course: q.get('course'), info: q.get('info') }
}

function hrefOf(l: Loc) {
  const q = new URLSearchParams()
  if (l.course) q.set('course', l.course)
  else {
    if (l.tab !== 'learning') q.set('tab', l.tab)
    if (l.info) q.set('info', l.info)
  }
  const s = q.toString()
  return `${window.location.pathname}${s ? `?${s}` : ''}`
}

/** The gate in front of the whole module: an unset-up or switched-off company is not an error. */
function Unavailable({ kind }: { kind: 'setup' | 'off' }) {
  return kind === 'setup'
    ? <CalmMessage title="Learning is being set up">Your company has not finished setting this up yet. Courses will appear here once it has.</CalmMessage>
    : <CalmMessage title="Learning is not switched on">Your company has not turned on learning yet. If you think it should be on, ask HR.</CalmMessage>
}

export default function LearningHub({ employeeId, viewAs }: { employeeId: string; viewAs?: boolean }) {
  const [sync] = useState(() => !viewAs && atEss())
  const [ready, setReady] = useState(false)
  const [loc, setLoc] = useState<Loc>(() => readLoc(!viewAs && atEss()))
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [gate, setGate] = useState<'setup' | 'off' | null>(null)
  const [err, setErr] = useState('')
  const [team, setTeam] = useState<TeamData | null>(null)
  const pushed = useRef(0)
  const tabStrip = useRef<HTMLDivElement | null>(null)

  // Parents' effects run after their children's, so nothing below mounts until the reads are
  // carrying employee_id.
  useEffect(() => {
    setViewing(viewAs ? employeeId : null)
    setReady(true)
    return () => setViewing(null)
  }, [employeeId, viewAs])

  const loadDash = useCallback(() => {
    return lmsApi<Dashboard>('/api/lms/me/dashboard').then(d => {
      setErr('')
      if (!d.enabled) setGate('off'); else { setGate(null); setDash(d) }
    }).catch(e => {
      if (e instanceof LmsApiError && e.setup) setGate('setup')
      else setErr(errorWords(e))
    })
  }, [])

  const loadTeam = useCallback(() => {
    // lib/lms/client.ts adds employee_id to /api/lms/me reads only. This one is a read too.
    const url = viewAs ? `/api/lms/team?employee_id=${encodeURIComponent(employeeId)}` : '/api/lms/team'
    return lmsApi<TeamData>(url).then(setTeam).catch(() => setTeam(null))
  }, [employeeId, viewAs])

  useEffect(() => {
    if (!ready) return
    void loadDash()
    void loadTeam()
  }, [ready, loadDash, loadTeam])

  useEffect(() => {
    if (!sync) return
    const onPop = () => { pushed.current = Math.max(0, pushed.current - 1); void loadDash() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sync, loadDash])

  // The address can change without this component doing it: Back and Forward, or the portal's
  // own "Learning" link while a course is open. Next keeps this in step with pushState.
  const params = useSearchParams()
  useEffect(() => { if (sync) setLoc(readLoc(true)) }, [sync, params])

  const go = useCallback((next: Loc, replace = false) => {
    setLoc(next)
    if (sync) { pushUrl(hrefOf(next), replace ? 'replace' : 'push'); if (!replace) pushed.current++ }
    window.scrollTo({ top: 0 })
  }, [sync])

  // "Next up" replaces the course just finished, so going back does not walk through it again.
  const openCourse = useCallback((id: string) => go({ tab: loc.tab, course: id, info: null }, !!loc.course), [go, loc.tab, loc.course])
  const closeCourse = useCallback(() => {
    // Back to wherever they came from, without leaving a trail of entries to walk through.
    if (sync && pushed.current > 0) { window.history.back(); return }
    go({ tab: loc.tab === 'team' ? 'learning' : loc.tab, course: null, info: null })
    void loadDash()
  }, [sync, go, loc.tab, loadDash])

  const isManager = !!team?.is_manager
  const tab: Tab = loc.tab === 'team' && team && !isManager ? 'learning' : loc.tab

  // On a phone the strip scrolls sideways: keep the open tab on screen, without moving the page.
  useEffect(() => {
    const strip = tabStrip.current
    const on = strip?.querySelector<HTMLElement>('[data-on="1"]')
    if (strip && on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2
  }, [tab, isManager, loc.course, dash])
  const tabs: { k: Tab; label: string }[] = [
    { k: 'learning', label: 'My Learning' }, { k: 'catalogue', label: 'Catalogue' }, { k: 'achievements', label: 'My Achievements' },
    ...(isManager ? [{ k: 'team' as const, label: 'Team' }] : []),
  ]

  let body: React.ReactNode
  if (gate) body = <Unavailable kind={gate} />
  else if (err && !dash) body = <Problem message={err} onRetry={() => void loadDash()} />
  else if (!dash) body = (
    <div style={{ display: 'grid', gap: S.md }}>
      <Skeleton w={220} h={22} /><Skeleton w={160} />
      <Skeleton h={92} r={R.lg} /><Skeleton h={92} r={R.lg} />
    </div>
  )
  else if (loc.course) body = <Player key={loc.course} enrollmentId={loc.course} onClose={closeCourse} onOpenCourse={openCourse} />
  else if (loc.info) body = (
    <CoursePage key={loc.info} id={loc.info} readOnly={viewAs} onChanged={() => void loadDash()}
      onBack={() => go({ tab: 'catalogue', course: null, info: null })} onPlay={openCourse} />
  )
  else body = (
    <>
      <div className="ess-seg" role="tablist" aria-label="Learning" ref={tabStrip} style={{ position: 'relative', marginBottom: 18 }}>
        {tabs.map(t => (
          <button key={t.k} role="tab" aria-selected={t.k === tab} data-on={t.k === tab ? '1' : '0'} onClick={() => go({ tab: t.k, course: null, info: null })}>{t.label}</button>
        ))}
      </div>
      {viewAs && (
        <div className="lx-note" data-t="warning" style={{ marginBottom: 18 }}>
          This is someone else&apos;s portal. You can look around, but only they can enrol, learn or submit.
        </div>
      )}
      {tab === 'learning' && <MyLearning data={dash} readOnly={viewAs} onOpen={openCourse} onBrowse={() => go({ tab: 'catalogue', course: null, info: null })} />}
      {tab === 'catalogue' && (
        <Catalogue myPaths={dash.paths || []} readOnly={viewAs} onChanged={() => void loadDash()}
          onOpenCourse={id => go({ tab: 'catalogue', course: null, info: id })} />
      )}
      {tab === 'achievements' && <Achievements />}
      {tab === 'team' && team && <Team data={team} readOnly={viewAs} onChanged={() => void loadTeam()} />}
    </>
  )

  return (
    <div className="ezl" style={{ ['--ezl-top' as string]: '77px' }}>
      <LearnStyles />
      {body}
    </div>
  )
}
