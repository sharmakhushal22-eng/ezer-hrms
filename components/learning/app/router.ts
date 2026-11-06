'use client'
// components/learning/app/router.ts — where someone is inside EZER Learn.
//
// The whole product is one Next page (app/learning/[[...path]]), so moving between its
// screens never waits on the server. Each screen still has a real address, written with
// history.pushState, so Back, refresh and a pasted link all land where they should. Next
// keeps its own router in step with pushState (see the "single page applications" guide).
import { useCallback, useEffect, useState } from 'react'
import { viewTransition } from '../motion/transition'

export const BASE = '/learning'

export type RouteName = 'home' | 'catalog' | 'course' | 'play' | 'my' | 'live' | 'achievements' | 'team' | 'studio'

export interface LearnRoute {
  name: RouteName
  /** course id for 'course', enrolment id for 'play' */
  id: string | null
  /** studio section: 'courses', 'assignments' … */
  section: string | null
  /** studio item: a course id under 'courses' */
  item: string | null
  query: URLSearchParams
}

const NAMES: RouteName[] = ['home', 'catalog', 'course', 'play', 'my', 'live', 'achievements', 'team', 'studio']

export function parseRoute(pathname: string, search: string): LearnRoute {
  const parts = pathname.replace(/^\/learning\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const head = (parts[0] || 'home') as RouteName
  const name: RouteName = NAMES.includes(head) ? head : 'home'
  const query = new URLSearchParams(search)
  if (name === 'studio') return { name, id: null, section: parts[1] || null, item: parts[2] || null, query }
  return { name, id: parts[1] || null, section: null, item: null, query }
}

/** Addresses, so no screen spells one out by hand. */
export const to = {
  home: () => BASE,
  catalog: (q?: Record<string, string>) => `${BASE}/catalog${q && Object.keys(q).length ? `?${new URLSearchParams(q)}` : ''}`,
  course: (id: string) => `${BASE}/course/${encodeURIComponent(id)}`,
  play: (enrollmentId: string, lessonId?: string) => `${BASE}/play/${encodeURIComponent(enrollmentId)}${lessonId ? `?lesson=${encodeURIComponent(lessonId)}` : ''}`,
  my: (tab?: string) => `${BASE}/my${tab ? `?tab=${tab}` : ''}`,
  /** Live sessions; with an id, that webinar (its recording, or its details) */
  live: (id?: string) => `${BASE}/live${id ? `/${encodeURIComponent(id)}` : ''}`,
  achievements: () => `${BASE}/achievements`,
  team: () => `${BASE}/team`,
  studio: (section?: string, item?: string) => `${BASE}/studio${section ? `/${section}` : ''}${item ? `/${encodeURIComponent(item)}` : ''}`,
}

const EVENT = 'ezl:navigate'

/** Move to another screen. `replace` for a hop nobody asked for (a redirect, a fixed-up URL). */
export function navigate(href: string, opts?: { replace?: boolean; keepScroll?: boolean }) {
  if (typeof window === 'undefined') return
  const now = window.location.pathname + window.location.search
  if (href === now) { window.dispatchEvent(new Event(EVENT)); return }
  const go = () => {
    if (opts?.replace) window.history.replaceState(null, '', href)
    else window.history.pushState(null, '', href)
    window.dispatchEvent(new Event(EVENT))
    if (!opts?.keepScroll) window.scrollTo({ top: 0 })
  }
  // A move to another screen glides (motion/transition.ts). A quiet fix-up of the address, such
  // as the catalogue writing the search into ?q= on every keystroke, does not.
  if (opts?.replace) go()
  else viewTransition(go)
}

export function useLearnRoute(): LearnRoute {
  const [route, setRoute] = useState<LearnRoute>(() =>
    typeof window === 'undefined' ? parseRoute(BASE, '') : parseRoute(window.location.pathname, window.location.search))
  const sync = useCallback(() => setRoute(parseRoute(window.location.pathname, window.location.search)), [])
  useEffect(() => {
    window.addEventListener('popstate', sync)
    window.addEventListener(EVENT, sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(EVENT, sync) }
  }, [sync])
  return route
}

/** For an <a href> that should behave like an in-app link: a plain click stays in the app,
 *  while a middle or modified click still opens a new tab as the person expects. */
export function linkProps(href: string, after?: () => void) {
  return {
    href,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      navigate(href)
      after?.()
    },
  }
}
