// src/features/expenses/nav.ts — TeHome's view / sheet state, as routes.
//
// On the website TeHome keeps `view` (the page) and `sheet` (a drawer over it)
// in React state and has no router. Here every view is a stack screen and every
// sheet is a modal screen in the /expenses stack (src/app/expenses/_layout.tsx),
// so Android back works everywhere: it closes a sheet, then walks back through
// the views the person opened.
//
//   website                               app route
//   view home                             /expenses                       (?tab=claims&ref=<id> deep link)
//   view trips                            /expenses/trips
//   view trip{id}                         /expenses/trip/<id>
//   view leg{tripId, leg}                 /expenses/leg/<legId>?trip=<tripId>
//   view tripClaim{trip}                  /expenses/trip-claim/<tripId>
//   view expenses (Other expenses)        /expenses/other
//   view claims                           /expenses/claims
//   view claim{id}                        /expenses/claim/<id>
//   view advances                         /expenses/advances
//   view limits                           /expenses/limits
//   view approvals                        /expenses/approvals
//   sheet new           (step 1)          /expenses/new                   modal
//   sheet kind{kind,way}(step 2 / 3)      /expenses/kind?kind=&way=       modal
//   sheet plan{kind,past,editing}         /expenses/plan?kind=&past=1&edit=<tripId>   modal
//   sheet startNow                        /expenses/start                 modal
//   sheet addLeg{detail}                  /expenses/add-leg?trip=<tripId> modal
//   sheet expense{line?, tripId?}         /expenses/expense?line=&trip=&claim=        modal
//
// TeHome's callback contracts (spec Part 0.3) map onto three moves:
//   open(href)  push a view or a sheet over the current screen
//   swap(href)  replace the current screen: a sheet that leads to another sheet
//               (new → kind → plan), or a sheet that ends on a view
//               (planner saved → the trip; "done(message); setView(...)")
//   close()     a sheet's onClose / a view's Back
import { router } from 'expo-router'
import type { TripScope, Uuid } from '@web/te/types'
import type { WayId } from '@web/te/entry-flow'

const q = (o: Record<string, string | number | boolean | null | undefined>) => {
  const s = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(v === true ? '1' : String(v))}`)
    .join('&')
  return s ? `?${s}` : ''
}

export const teHref = {
  home: '/expenses',
  trips: '/expenses/trips',
  other: '/expenses/other',
  claims: '/expenses/claims',
  advances: '/expenses/advances',
  limits: '/expenses/limits',
  approvals: '/expenses/approvals',
  trip: (id: Uuid) => `/expenses/trip/${id}`,
  tripClaim: (tripId: Uuid) => `/expenses/trip-claim/${tripId}`,
  claim: (id: Uuid) => `/expenses/claim/${id}`,
  leg: (legId: Uuid, tripId?: Uuid | null) => `/expenses/leg/${legId}${q({ trip: tripId })}`,
  // sheets
  newClaim: '/expenses/new',
  kind: (kind: TripScope, way?: WayId | null) => `/expenses/kind${q({ kind, way })}`,
  plan: (o: { kind: TripScope; past?: boolean; edit?: Uuid | null }) => `/expenses/plan${q({ kind: o.kind, past: !!o.past, edit: o.edit })}`,
  start: '/expenses/start',
  addLeg: (tripId: Uuid) => `/expenses/add-leg${q({ trip: tripId })}`,
  expense: (o: { line?: Uuid | null; trip?: Uuid | null; claim?: Uuid | null } = {}) => `/expenses/expense${q(o)}`,
}

/** Push a view or a sheet. */
export function open(href: string) { router.push(href as never) }
/** Replace the current screen (sheet → sheet, or sheet → the view it lands on). */
export function swap(href: string) { router.replace(href as never) }
/** Close a sheet / go back one view; from the first screen, Home of the module. */
export function close() {
  if (router.canGoBack()) router.back()
  else router.replace(teHref.home as never)
}
/** Back to the module's Home, dropping everything opened on top of it. */
export function toHome() {
  try { router.dismissTo(teHref.home as never) } catch { router.replace(teHref.home as never) }
}

/** The web's backToTrip(): back to that trip's screen — popping to it when it is
 *  already under this one in the stack, otherwise replacing this screen with it. */
export function toTrip(tripId: Uuid) {
  try { router.dismissTo(teHref.trip(tripId) as never) } catch { router.replace(teHref.trip(tripId) as never) }
}

/** The website's onExit: "Back to ESS" goes to the ESS Payroll section (app/ess/travel/page.tsx). */
export function exitModule() {
  try { router.dismissTo('/payroll' as never) } catch { router.replace('/payroll' as never) }
}

/** Route params arrive as string | string[]; take the first. */
export const param = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')

const UUID = /^[0-9a-f-]{36}$/i
/** TeHome.claimFromLink(): ?tab=claims&ref=<uuid> opens that claim. */
export function claimFromLink(tab: string, ref: string): string | null {
  return tab === 'claims' && UUID.test(ref) ? ref : null
}
