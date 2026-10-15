// lib/ess/routes.ts — client-safe.
//
// THE ESS ADDRESS BAR. The portal is one React tree (components/ess/EmployeePortal.tsx)
// whose "where am I" used to live only in state — so a refresh landed on Home and Back
// left the app. Now the path under /ess IS that state:
//
//   /ess                          Home
//   /ess/<view>                   an employee screen: /ess/leave, /ess/attendance, /ess/approvals
//   /ess/<module>                 an admin module the person holds: /ess/onboarding, /ess/pms
//   /ess/<module>/<tab>           a tab inside a module: /ess/recruitment/mrf, /ess/recruitment/sendoffer
//
// Five admin modules share a key with an employee screen (payroll, attendance, letters,
// reports, loans); their module form carries an "-admin" suffix: /ess/payroll-admin.
//
// The portal pushes a history entry on every move (so Back returns to the previous
// screen, including a module's tab) and reads the path on load and on popstate. A
// module's own deep-link params (?offer=…, ?mrf=…) ride along as the query string.
//
// Legacy links still work: /ess?tab=approvals and /ess-portal?module=recruitment&tab=mrf
// are read by parseEssPath and rewritten to the canonical path on arrival.

export const ESS_BASE = '/ess'

/** Admin module keys that collide with an employee screen key. */
const COLLIDING_MODULES = new Set(['payroll', 'attendance', 'letters', 'reports', 'loans'])
const ADMIN_SUFFIX = '-admin'

export type EssLocation =
  | { kind: 'view'; view: string; query: string }
  | { kind: 'module'; module: string; tab: string | null; query: string }

export type EssKeys = { views: Set<string>; modules: Set<string> }

export const moduleSlug = (key: string) => COLLIDING_MODULES.has(key) ? `${key}${ADMIN_SUFFIX}` : key

const seg = (s: string) => decodeURIComponent(s).trim().toLowerCase()

/** The canonical path for a location. Home is /ess itself. */
export function essPath(loc: EssLocation): string {
  if (loc.kind === 'view') return loc.view === 'home' ? ESS_BASE : `${ESS_BASE}/${encodeURIComponent(loc.view)}`
  return `${ESS_BASE}/${encodeURIComponent(moduleSlug(loc.module))}${loc.tab ? `/${encodeURIComponent(loc.tab)}` : ''}`
}

/** Path + the query the location carries (a module's deep-link params). */
export const essHref = (loc: EssLocation) => essPath(loc) + (loc.query ? `?${loc.query}` : '')

/**
 * Where a URL points. Reads the path first; a legacy query form (?tab=, ?module=&tab=)
 * when the path says nothing. Anything unknown is Home. The query returned is what is
 * left once the routing params are taken out — the module's own params.
 */
export function parseEssPath(pathname: string, search: string, keys: EssKeys): EssLocation {
  const parts = pathname.split('/').filter(Boolean).map(seg)
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const rest = (drop: string[]) => { const c = new URLSearchParams(q); drop.forEach(k => c.delete(k)); return c.toString() }
  const body = parts[0] === 'ess' || parts[0] === 'ess-portal' ? parts.slice(1) : parts

  if (body.length) {
    const [a, b] = body
    const mod = a.endsWith(ADMIN_SUFFIX) && keys.modules.has(a.slice(0, -ADMIN_SUFFIX.length)) ? a.slice(0, -ADMIN_SUFFIX.length) : null
    if (mod) return { kind: 'module', module: mod, tab: b || null, query: rest([]) }
    if (keys.views.has(a) && !b) return { kind: 'view', view: a, query: rest([]) }
    if (keys.modules.has(a) && !COLLIDING_MODULES.has(a)) return { kind: 'module', module: a, tab: b || null, query: rest([]) }
    if (keys.views.has(a)) return { kind: 'view', view: a, query: rest([]) }
    return { kind: 'view', view: 'home', query: '' }
  }

  // Legacy: /ess?tab=<view>  ·  /ess-portal?module=<module>&tab=<tab>&…
  const legacyModule = seg(q.get('module') || '')
  if (legacyModule && keys.modules.has(legacyModule)) {
    const t = seg(q.get('tab') || '')
    return { kind: 'module', module: legacyModule, tab: t || null, query: rest(['module', 'tab']) }
  }
  const legacyTab = seg(q.get('tab') || '')
  if (legacyTab && keys.views.has(legacyTab)) return { kind: 'view', view: legacyTab, query: rest(['tab']) }
  return { kind: 'view', view: 'home', query: '' }
}

/** Same location? (used to skip a history entry that would change nothing) */
export const sameLocation = (a: EssLocation, b: EssLocation) =>
  a.kind === b.kind && (a.kind === 'view' ? a.view === (b as any).view : a.module === (b as any).module && a.tab === (b as any).tab)

/** Push a history entry for `url` unless the address bar already shows it. */
export function pushUrl(url: string, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return
  const cur = window.location.pathname + window.location.search
  if (cur === url) return
  // Next.js patches pushState/replaceState and keeps its router in step (usePathname etc.)
  // without a navigation, so the portal tree stays mounted — that is the whole point.
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

/** True when this page is the ESS portal at its canonical address (where URL sync applies). */
export const atEss = () => typeof window !== 'undefined' && (window.location.pathname === ESS_BASE || window.location.pathname.startsWith(`${ESS_BASE}/`))

/** The tab a module path carries: /ess/recruitment/mrf → 'mrf' (null when absent / not that module). */
export function moduleTabFromPath(pathname: string, module: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map(seg)
  if (parts[0] !== 'ess') return null
  const want = moduleSlug(module)
  return parts[1] === want ? (parts[2] || null) : null
}
