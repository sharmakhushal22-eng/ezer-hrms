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
import { API_URL } from './config'

const VIEW_ROUTE: Record<string, string> = Object.fromEntries(SECTIONS.flatMap(s => s.items.map(i => [i.k, i.route])))
// The Investment Declaration screen is reachable by key on the website, not from the nav.
VIEW_ROUTE.declaration = '/payroll/declaration'
const KEYS = { views: new Set(Object.keys(VIEW_ROUTE)), modules: new Set<string>() }

/** The app route for a website view key, or null. */
export const routeForView = (k: string | null | undefined) => (k && VIEW_ROUTE[k.toLowerCase()]) || null

/** Where a website-style link points in the app, or null when it has no app screen. */
export function resolveLink(r: string | null | undefined): { route: string; query?: string } | { external: string } | null {
  if (!r) return null
  if (/^https?:\/\//i.test(r)) return { external: r }
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

/** Open a website-style link. Returns false when there is nowhere to go. */
export function openLink(r: string | null | undefined): boolean {
  const t = resolveLink(r)
  if (!t) return false
  if ('external' in t) { void WebBrowser.openBrowserAsync(t.external); return true }
  router.push((t.query ? `${t.route}?${t.query}` : t.route) as any)
  return true
}

/** Open a page of the website itself (e.g. a document the server renders). */
export const openWebsite = (path: string) => WebBrowser.openBrowserAsync(`${API_URL}${path}`)
