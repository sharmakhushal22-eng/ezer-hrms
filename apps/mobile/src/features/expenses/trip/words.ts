// src/features/expenses/trip/words.ts — the fixed words the trip and journey
// screens share. Copied from components/te/trip/TeTrips.tsx, TeTripDetail.tsx
// and TeStayRequest.tsx (the website keeps each table at the top of its file).
import type { TripScope } from '@web/te/types'

export const SCOPE_WORD: Record<TripScope, string> = { local: 'Local', domestic: 'Domestic', international: 'International' }
export const PATTERN_WORD: Record<string, string> = { oneway: 'One way', round: 'Round trip', multi: 'Multi-city' }

/** TeTripDetail LEG_KIND. */
export const LEG_KIND: Record<string, string> = {
  first: 'to the airport or station',
  last: 'from the airport or station',
  extra: 'added during the trip',
}

/** TeTripDetail / TeLegMissed NO_GPS: why the phone did not record it. */
export const NO_GPS = ['Forgot to start the travel', 'Phone battery was low', 'No network or GPS signal', 'The app did not work', 'Other']

/** TeLegMissed SKIP: why the journey did not happen. */
export const SKIP = ['The meeting was cancelled', 'Someone else went instead', 'Travelled a different way', 'The plan changed', 'Other']

/** TeTripDetail LEG_STATE: what a journey is doing, in the employee's words. */
export const LEG_STATE: Record<string, string> = {
  PLANNED: 'Not started', ACTIVE: 'On the road', PAUSED: 'Stopped',
  ENDED: 'Ended, report to save', SUBMITTED: 'Done', SKIPPED: 'Skipped', CANCELLED: 'Cancelled',
}

/** The site a link points at (TeStayRequest platformOf: `new URL(v).hostname`
 *  without a leading www.). Written without the URL global, which React Native
 *  implements only partly; the result is the same host for every http(s) link
 *  and null for anything a URL parser would refuse. */
export function platformOf(url: string): string | null {
  const v = url.trim()
  if (!v) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#\s]+)(?::\d*)?(?:[/?#]|$)/i.exec(v)
  if (!m) return null
  const host = m[1].toLowerCase().replace(/^www\./, '')
  return host || null
}

/** TeTripDetail STEP_WORD / STEP_TONE: an approval step's status. 'auto' = passed by the workflow itself. */
export const STEP_WORD: Record<string, string> = {
  approved: 'Approved', auto: 'Approved automatically', pending: 'Pending',
  rejected: 'Rejected', sent_back: 'Sent back', cancelled: 'Cancelled',
}
export const STEP_TONE: Record<string, 't-brand' | 't-warn' | 't-crit' | 'plain'> = {
  approved: 't-brand', auto: 't-brand', pending: 't-warn',
  rejected: 't-crit', sent_back: 't-warn', cancelled: 'plain',
}
