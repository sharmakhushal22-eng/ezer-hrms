'use client'
// components/learning/app/LearnApp.tsx — EZER Learn as a product of its own, at /learning.
//
// Like Travel & Expenses (app/ess/travel), Learning opens full screen with its own navigation
// rather than as a tab inside another portal. Nothing about signing in changes: the person
// arrives with the session they already have, and every call carries it (lib/auth-headers.ts).
//
//   ESS session      an employee. They learn, and if their roles grant any Learning module
//                    they also see the Studio, which is the HR and L&D workspace.
//   Dashboard login  an admin. They see the Studio only, since they are not an employee.
//
// What a person may do is still decided by the API on every call. The navigation only offers
// what those calls would accept.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lmsApi, LmsApiError } from '@/lib/lms/client'
import { essToken } from '@/lib/ess-session-client'
import { supabase } from '@/lib/supabase'
import { applyTheme } from '@/lib/ui/ThemeToggle'
import type { LmsCaps } from '@/lib/lms/caps'
import { IconSearch } from '@/lib/ui'
import { Skel, errorWords, type Dashboard } from '../shared'
import { GArrowLeft, GBook, GCompass, GExit, GHome, GLive, GMenu, GMoon, GStudio, GSun, GTrophy, GUsers } from '../glyphs'
import { linkProps, navigate, to, useLearnRoute, type LearnRoute } from './router'
import { cached, remember } from './cache'
import type { Catalog } from '../Catalogue'
import Home from '../Home'
import Catalogue from '../Catalogue'
import CoursePage from '../CoursePage'
import MyLearning from '../MyLearning'
import Achievements from '../Achievements'
import Live from '../Live'
import Team, { type TeamData } from '../Team'
import Player from '../Player'
import Studio, { type StudioBoot } from '../studio/Studio'
import { LMS_SITE } from '@/lib/lms/site'
import { adoptHandoff, hrmsBackHref, signOutOfLms } from '@/lib/lms/sso-client'
import SiteSignIn from './SiteSignIn'

type Who = 'checking' | 'employee' | 'admin' | 'none'

function whoIsHere(): Promise<Who> {
  if (essToken()) return Promise.resolve('employee')
  return supabase.auth.getSession().then(({ data }) => (data?.session ? 'admin' : 'none')).catch(() => 'none' as const)
}

function SignIn() {
  return (
    <div className="ezl"><div className="lx-gate">
      <div className="lx-gate-box lx-in">
        <div className="lx-brand-mark" style={{ width: 56, height: 56, borderRadius: 18 }}><span style={{ width: 46, height: 46, borderRadius: 14 }}><GBook size={24} /></span></div>
        <h1 className="lx-display" style={{ fontSize: 28 }}>EZER Learn</h1>
        <p style={{ color: 'var(--ez-muted)', lineHeight: 1.6, fontSize: 14.5 }}>Sign in to EZER HRMS first. Learning opens with the same sign-in, so you will come straight back here.</p>
        <div style={{ display: 'grid', gap: 10, width: '100%' }}>
          <a className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" href="/ess-login">Employee sign-in</a>
          <a className="lx-btn lx-btn--lg lx-btn--full" href="/">Admin sign-in</a>
        </div>
      </div>
    </div></div>
  )
}

function Booting() {
  return (
    <div className="ezl"><div className="lx-app">
      <aside className="lx-side" aria-hidden><div style={{ display: 'grid', gap: 10, padding: 8 }}><Skel h={38} r={12} style={{ opacity: .15 }} /><Skel h={30} style={{ opacity: .1 }} /><Skel h={30} style={{ opacity: .1 }} /><Skel h={30} style={{ opacity: .1 }} /></div></aside>
      <main className="lx-main"><div className="lx-content" style={{ display: 'grid', gap: 24 }}>
        <Skel h={290} r={24} />
        <div className="lx-grid">{[0, 1, 2].map(i => <Skel key={i} h={260} r={16} />)}</div>
      </div></main>
    </div></div>
  )
}

interface NavItem { key: string; label: string; href: string; icon: React.ReactNode; count?: number; hot?: boolean; match: (r: LearnRoute) => boolean }

function ThemeButton() {
  const [dark, setDark] = useState(false)
  useEffect(() => { setDark(document.documentElement.getAttribute('data-ez-theme') === 'dark') }, [])
  const flip = () => {
    const next = dark ? 'light' : 'dark'
    applyTheme(next, { animate: true })
    setDark(!dark)
  }
  return (
    <button className="lx-btn lx-btn--ghost lx-btn--icon lx-hide-sm" onClick={flip} aria-label={dark ? 'Use the light theme' : 'Use the dark theme'} title={dark ? 'Light theme' : 'Dark theme'}>
      {dark ? <GSun size={18} /> : <GMoon size={18} />}
    </button>
  )
}

export default function LearnApp() {
  const route = useLearnRoute()
  const [who, setWho] = useState<Who>('checking')
  // Drawn from what this tab saw last, then replaced by the fresh answer (./cache.ts).
  const [dash, setDash] = useState<Dashboard | null>(() => (typeof window === 'undefined' ? null : cached<Dashboard>('dash')))
  const [dashErr, setDashErr] = useState('')
  const [gate, setGate] = useState<'setup' | 'off' | null>(null)
  const [cat, setCat] = useState<Catalog | null>(() => (typeof window === 'undefined' ? null : cached<Catalog>('cat')))
  const [catErr, setCatErr] = useState('')
  const [team, setTeam] = useState<TeamData | null>(null)
  const [studio, setStudio] = useState<StudioBoot | null>(null)
  const [studioChecked, setStudioChecked] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const learner = who === 'employee'
  const caps: LmsCaps | null = studio?.caps || null

  const loadDash = useCallback(() => lmsApi<Dashboard>('/api/lms/me/dashboard').then(d => {
    setDashErr('')
    if (!d.enabled) setGate('off'); else { setGate(null); setDash(remember('dash', d)) }
  }).catch(e => {
    if (e instanceof LmsApiError && e.setup) setGate('setup')
    else setDashErr(errorWords(e))
  }), [])
  const loadCat = useCallback(() => lmsApi<Catalog>('/api/lms/me/catalog').then(c => { setCat(remember('cat', c)); setCatErr('') }).catch(e => setCatErr(errorWords(e))), [])
  const loadTeam = useCallback(() => lmsApi<TeamData>('/api/lms/team').then(setTeam).catch(() => setTeam(null)), [])
  const loadStudio = useCallback(() => lmsApi<StudioBoot>('/api/lms/admin/overview?lite=1')
    .then(setStudio).catch(() => setStudio(null)).finally(() => setStudioChecked(true)), [])

  // On ezerlms.com someone arriving from HRMS carries a hand-off code; it becomes a session here
  // before anyone asks who this is (lib/lms/sso-client.ts).
  useEffect(() => { (LMS_SITE ? adoptHandoff() : Promise.resolve()).then(whoIsHere).then(setWho) }, [])
  useEffect(() => {
    if (who === 'employee') { void loadDash(); void loadCat(); void loadTeam(); void loadStudio() }
    if (who === 'admin') void loadStudio()
  }, [who, loadDash, loadCat, loadTeam, loadStudio])

  // An admin without an employee record has nothing to learn here: their home is the Studio.
  useEffect(() => {
    if (who === 'admin' && route.name !== 'studio') navigate(to.studio(), { replace: true })
  }, [who, route.name])

  // "/" jumps to search, as on most learning sites.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { setDrawer(false) }, [route.name, route.id, route.section])
  useEffect(() => { if (route.name === 'catalog') setQ(route.query.get('q') || '') }, [route])

  const refreshLearner = useCallback(() => { void loadDash(); void loadCat() }, [loadDash, loadCat])

  const nav = useMemo(() => {
    const learn: NavItem[] = learner ? [
      { key: 'home', label: 'Home', href: to.home(), icon: <GHome size={19} />, match: r => r.name === 'home' },
      { key: 'catalog', label: 'Explore courses', href: to.catalog(), icon: <GCompass size={19} />, match: r => r.name === 'catalog' || r.name === 'course' },
      { key: 'my', label: 'My learning', href: to.my(), icon: <GBook size={19} />, count: dash?.counts?.assigned || undefined, hot: !!dash?.counts?.overdue, match: r => r.name === 'my' || r.name === 'play' },
      { key: 'achievements', label: 'Achievements', href: to.achievements(), icon: <GTrophy size={19} />, match: r => r.name === 'achievements' },
      { key: 'live', label: 'Live sessions', href: to.live(), icon: <GLive size={19} />, match: r => r.name === 'live' },
      ...(team?.is_manager ? [{ key: 'team', label: 'My team', href: to.team(), icon: <GUsers size={19} />, count: team.requests?.length || undefined, hot: !!team.requests?.length, match: (r: LearnRoute) => r.name === 'team' }] : []),
    ] : []
    return { learn }
  }, [learner, dash, team])

  if (who === 'checking') return <Booting />
  if (who === 'none') return LMS_SITE ? <SiteSignIn onSignedIn={() => { setWho('checking'); void whoIsHere().then(setWho) }} /> : <SignIn />
  if (who === 'admin' && !studioChecked) return <Booting />

  // On its own domain the way back to HRMS is offered only to someone who came from there; a
  // company with the LMS alone has no HRMS. Sign out is always there, since this domain keeps a
  // session of its own.
  const backHref = LMS_SITE ? hrmsBackHref(who === 'employee') : who === 'employee' ? '/ess' : '/dashboard'
  const focus = route.name === 'play'
  // The overview's `me` is an id, not a name, so only the learner record names someone.
  const name = dash?.name || ''
  const initials = (name || (learner ? 'You' : 'Admin')).split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()
  const doSearch = (e: React.FormEvent) => { e.preventDefault(); navigate(to.catalog(q.trim() ? { q: q.trim() } : undefined)) }

  let body: React.ReactNode
  if (route.name === 'studio') {
    body = caps
      ? <Studio boot={studio!} section={route.section} item={route.item} onBootChange={setStudio} />
      : studioChecked
        ? <div className="lx-empty"><h3>The Studio is for HR and L&amp;D</h3><p>Your access does not include managing courses. Everything you can learn is under Explore courses.</p><a className="lx-btn lx-btn--primary" {...linkProps(to.home())}>Go to Home</a></div>
        : <Skel h={300} r={20} />
  } else if (!learner) {
    body = <Skel h={300} r={20} />
  } else if (gate) {
    body = (
      <div className="lx-empty">
        <h3>{gate === 'setup' ? 'Learning is being set up' : 'Learning is not switched on'}</h3>
        <p>{gate === 'setup' ? 'Your company has not finished setting this up yet. Courses will appear here once it has.' : 'Your company has not turned on learning yet. If you think it should be on, ask HR.'}</p>
      </div>
    )
  } else if (route.name === 'play' && route.id) {
    body = <Player key={route.id} enrollmentId={route.id} initialLesson={route.query.get('lesson')} backLabel="Back"
      onClose={() => { refreshLearner(); if (window.history.length > 1) window.history.back(); else navigate(to.my()) }}
      onOpenCourse={id => navigate(to.play(id), { replace: true })}
      onLesson={lessonId => window.history.replaceState(null, '', to.play(route.id!, lessonId))} />
  } else if (route.name === 'course' && route.id) {
    body = <CoursePage key={route.id} id={route.id} card={cat?.courses.find(c => c.id === route.id)} categories={cat?.categories || []} onChanged={refreshLearner} />
  } else if (route.name === 'catalog') {
    body = <Catalogue cat={cat} err={catErr} myPaths={dash?.paths || []} query={route.query} onReload={loadCat} onChanged={refreshLearner} />
  } else if (route.name === 'my') {
    body = <MyLearning data={dash} err={dashErr} tab={route.query.get('tab')} onReload={loadDash} />
  } else if (route.name === 'achievements') {
    body = <Achievements />
  } else if (route.name === 'live') {
    body = <Live focusId={route.id} />
  } else if (route.name === 'team') {
    body = (
      <div>
        <header className="lx-ph lx-in"><h1>My team</h1><p>What your reports are learning, what is overdue, and requests waiting for your decision.{team?.can_assign ? ' You can also assign a course to anyone in your team.' : ''}</p></header>
        {team ? <Team data={team} onChanged={() => void loadTeam()} /> : <Skel h={300} r={20} />}
      </div>
    )
  } else {
    body = <Home dash={dash} dashErr={dashErr} cat={cat} onRetry={refreshLearner} />
  }

  const studioOn = !!caps
  return (
    <div className="ezl">
      <div className="lx-app" data-focus={focus ? '1' : '0'} data-drawer={drawer ? '1' : '0'}>
        <aside className="lx-side" aria-label="EZER Learn">
          <a className="lx-brand" {...linkProps(learner ? to.home() : to.studio())}>
            <div className="lx-brand-mark"><span><GBook size={18} /></span></div>
            <div>
              <div className="lx-brand-name">EZER<b>Learn</b></div>
              <div className="lx-brand-sub">Learning for your whole company</div>
            </div>
          </a>
          {nav.learn.length > 0 && (
            <nav className="lx-nav-group" aria-label="Learn">
              <div className="lx-nav-label">Learn</div>
              {nav.learn.map(n => (
                <a key={n.key} className="lx-nav-item" aria-current={n.match(route) ? 'page' : undefined} title={n.label} {...linkProps(n.href)}>
                  <span className="lx-nav-ic">{n.icon}</span><span>{n.label}</span>
                  {!!n.count && <span className="lx-nav-count" data-hot={n.hot ? '1' : '0'}>{n.count}</span>}
                </a>
              ))}
            </nav>
          )}
          {studioOn && (
            <nav className="lx-nav-group" aria-label="Studio">
              <div className="lx-nav-label">Manage</div>
              <a className="lx-nav-item" aria-current={route.name === 'studio' ? 'page' : undefined} title="Learning Studio" {...linkProps(to.studio())}>
                <span className="lx-nav-ic"><GStudio size={19} /></span><span>Learning Studio</span>
              </a>
            </nav>
          )}
          <div className="lx-side-foot">
            {learner && !!dash?.counts && (
              <div className="lx-side-card">
                <div style={{ fontSize: 12, color: 'var(--ez-on-dark-faint)', fontWeight: 600 }}>Your progress</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <b style={{ fontSize: 22, letterSpacing: '-.02em' }} className="lx-num">{dash.counts.completed}</b>
                  <span style={{ fontSize: 12, color: 'var(--ez-on-dark-muted)' }}>completed · {dash.counts.in_progress} in progress</span>
                </div>
              </div>
            )}
            {backHref && (
              <a className="lx-nav-item" href={backHref} title="Back to EZER HRMS">
                <span className="lx-nav-ic"><GExit size={19} /></span><span>Back to EZER HRMS</span>
              </a>
            )}
            {LMS_SITE && (
              <button type="button" className="lx-nav-item" onClick={() => void signOutOfLms()} title="Sign out of EZER Learn"
                style={{ fontFamily: 'inherit' }}>
                <span className="lx-nav-ic"><GExit size={19} /></span><span>Sign out</span>
              </button>
            )}
            <div className="lx-me">
              <div className="lx-me-av" aria-hidden>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || (learner ? 'Signed in' : 'Admin')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ez-on-dark-faint)' }}>{learner ? (studioOn ? 'Learner · Studio access' : 'Learner') : 'Studio'}</div>
              </div>
            </div>
          </div>
        </aside>
        {drawer && <div className="lx-scrim" onClick={() => setDrawer(false)} />}

        <main className="lx-main">
          {!focus && (
            <header className="lx-top">
              <button className="lx-btn lx-btn--ghost lx-btn--icon lx-top-menu" aria-label="Open the menu" onClick={() => setDrawer(true)}><GMenu size={20} /></button>
              {learner && route.name !== 'studio' ? (
                <form className="lx-search" role="search" onSubmit={doSearch}>
                  <IconSearch size={17} />
                  <input ref={searchRef} type="search" data-no-titlecase="" aria-label="Search courses" placeholder="Search courses, skills and topics" value={q} onChange={e => setQ(e.target.value)} />
                  <kbd>/</kbd>
                </form>
              ) : (
                <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <GStudio size={18} /> Learning Studio
                </div>
              )}
              <div className="lx-top-actions">
                {route.name === 'studio' && learner && <a className="lx-btn lx-btn--sm lx-hide-sm" {...linkProps(to.home())}><GArrowLeft size={15} /> My learning</a>}
                {route.name !== 'studio' && studioOn && <a className="lx-btn lx-btn--sm lx-hide-sm" {...linkProps(to.studio())}><GStudio size={15} /> Studio</a>}
                <ThemeButton />
                {backHref && <a className="lx-btn lx-btn--sm" href={backHref} title="Back to EZER HRMS"><GExit size={15} /> <span className="lx-hide-sm">EZER HRMS</span></a>}
                {LMS_SITE && <button type="button" className="lx-btn lx-btn--sm" onClick={() => void signOutOfLms()} title="Sign out of EZER Learn"><GExit size={15} /> <span className="lx-hide-sm">Sign out</span></button>}
              </div>
            </header>
          )}
          <div className={focus ? '' : 'lx-content'} key={focus ? 'focus' : route.name === 'studio' ? 'studio' : 'learn'}>
            {who === 'employee' && dashErr && !dash && route.name !== 'studio' && !focus && (
              <div className="lx-problem" role="alert" style={{ marginBottom: 20 }}><span style={{ flex: 1 }}>{dashErr}</span><button className="lx-btn lx-btn--sm" onClick={refreshLearner}>Try again</button></div>
            )}
            {body}
          </div>
        </main>

        {learner && !focus && (
          <nav className="lx-tabbar" aria-label="EZER Learn">
            {[...nav.learn.slice(0, 4), ...(studioOn ? [{ key: 'studio', label: 'Studio', href: to.studio(), icon: <GStudio size={20} />, match: (r: LearnRoute) => r.name === 'studio' }] : [])].map(n => (
              <a key={n.key} aria-current={n.match(route) ? 'page' : undefined} {...linkProps(n.href)}>{n.icon}<span>{n.label === 'Explore courses' ? 'Explore' : n.label === 'My learning' ? 'Learning' : n.label}</span></a>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}

