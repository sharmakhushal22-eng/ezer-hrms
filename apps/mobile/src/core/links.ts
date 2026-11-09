// src/core/links.ts — turns the website's in-app links into app screens.
//
// Home cards, approvals and notifications carry routes written for the website:
// 'tab:leave', '/ess?tab=approvals', '/ess/attendance', '/dashboard/ess?tab=approvals'.
// The website resolves them with tabTarget() (lib/today/schema.ts) and
// parseEssPath() (lib/ess/routes.ts); the app imports those same functions and
// maps the resulting view key to a screen through SECTIONS, so a new website
// view becomes linkable as soon as nav.ts lists it.
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { tabTarget } from '@web/today/schema'
import { parseEssPath } from '@web/ess/routes'
import { SECTIONS } from './nav'
import { API_URL, LMS_URL } from './config'
import { api } from './api'

const VIEW_ROUTE: Record<string, string> = Object.fromEntries(SECTIONS.flatMap(s => s.items.map(i => [i.k, i.route])))
// The Investment Declaration screen is reachable by key on the website, not from the nav.
VIEW_ROUTE.declaration = '/payroll?sub=declaration'
const KEYS = { views: new Set(Object.keys(VIEW_ROUTE)), modules: new Set<string>() }

/** The app route for a website view key, or null. */
export const routeForView = (k: string | null | undefined) => (k && VIEW_ROUTE[k.toLowerCase()]) || null

/** A link into EZER Learn: '/learning', '/learning/catalog', '/ess/learning'. */
const LMS_LINK = /^\/(?:ess\/)?learning(?=\/|\?|$)/

/** Open EZER Learn at `path` (an LMS screen: '/', '/catalog', '/live/<id>'), signed in.
 *
 *  Learning lives on its own domain, so the app's session cannot simply be carried there: the
 *  app asks HRMS for a one-minute hand-off code (/api/lms/sso, lib/lms/sso.ts) and opens the
 *  LMS with it in the address fragment, where the LMS trades it for a session of its own. If
 *  the code cannot be had (offline, an older server) the LMS still opens and asks the person
 *  to sign in. The in-app browser keeps that session for next time, like the website does. */
export async function openLms(path = '/'): Promise<void> {
  const at = path.startsWith('/') ? path : `/${path}`
  let code = ''
  try {
    const r = await api<{ code?: string }>('/api/lms/sso', { method: 'POST' })
    code = r?.code || ''
  } catch { /* go anyway: the LMS asks them to sign in */ }
  // from=app: the LMS then hides its "Back to EZER HRMS" link (a website), since closing this
  // browser is how the person returns to the app (lib/lms/sso-client.ts).
  await WebBrowser.openBrowserAsync(`${LMS_URL}${at}#${code ? `sso=${encodeURIComponent(code)}&` : ''}from=app`)
}

/** Go to an app route, or out to EZER Learn for a '/learning…' one. Every place that opens a
 *  route from the nav (More, search, links) comes through here. */
export function navigateTo(route: string) {
  if (LMS_LINK.test(route)) { void openLms(route.replace(LMS_LINK, '') || '/'); return }
  router.navigate(route as never)
}

/** Where a website-style link points in the app, or null when it has no app screen. */
export function resolveLink(r: string | null | undefined): { route: string; query?: string } | { external: string } | null {
  if (!r) return null
  if (/^https?:\/\//i.test(r)) return { external: r }
  // EZER Learn is its own website: notifications point at '/learning/…' (lib/lms/notify.ts).
  if (LMS_LINK.test(r)) return { route: r }
  if (r === 'tab:learning') return { route: '/learning' }
  const tab = tabTarget(r)
  if (tab && routeForView(tab)) {
    const q = r.includes('?') ? r.slice(r.indexOf('?') + 1) : ''
    return { route: routeForView(tab)!, query: q }
  }
  if (r.startsWith('/ess/travel')) return { route: '/expenses', query: r.split('?')[1] || '' }
  if (r.startsWith('/ess')) {
    const [path, search = ''] = r.split('?')
    const loc = parseEssPath(path, search, KEYS)
    if (loc.kind === 'view') return { route: routeForView(loc.view) || '/', query: loc.query }
  }
  // Bare view keys ('claims', 'approvals') — the web drops these on Home; the app opens them.
  if (routeForView(r)) return { route: routeForView(r)! }
  return null
}

// '/ess?notifications=1' — an interview invite's link — opens the bell on the website
// (EmployeePortal.tsx). The shell registers how to open it (features/shell/notifications.tsx).
let bellOpener: (() => void) | null = null
export function setBellOpener(fn: (() => void) | null) { bellOpener = fn }
/** Whether a website link asks for the notification panel. */
export const isBellLink = (r: string | null | undefined) => !!r && /^\/(dashboard\/)?ess\b[^?]*\?(.*&)?notifications=1(&|$)/.test(r)

/** Open a website-style link. Returns false when there is nowhere to go. */
export function openLink(r: string | null | undefined): boolean {
  if (isBellLink(r) && bellOpener) { bellOpener(); return true }
  const t = resolveLink(r)
  if (!t) return false
  if ('external' in t) { void WebBrowser.openBrowserAsync(t.external); return true }
  // navigate, not push: a section is a place in the shell, not another page on top.
  navigateTo(t.query ? `${t.route}${t.route.includes('?') ? '&' : '?'}${t.query}` : t.route)
  return true
}

/** Open a page of the website itself (e.g. a document the server renders). */
export const openWebsite = (path: string) => WebBrowser.openBrowserAsync(`${API_URL}${path}`)
