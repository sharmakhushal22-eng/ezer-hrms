// lib/te/geo.ts — read this device's position once, and always come back.
//
// WHY THIS EXISTS. navigator.geolocation.getCurrentPosition can call neither
// callback and never honour its own `timeout`. TePlacePicker found it first and
// wrote the reason down: the option's clock does not run while the browser's
// permission prompt is on screen, and that prompt opens in the address bar
// rather than in the page, so somebody who never notices it gets no success
// callback, no error callback, and no timeout.
//
// It is worse than that. Reproduced in a browser on 20 October 2026 with the
// permission already GRANTED: `getCurrentPosition({ enableHighAccuracy: true,
// timeout: 20000 })` sat for 25 seconds and called nothing. A machine with no
// location provider that can satisfy high accuracy simply never answers. So the
// prompt is not the only way in — the option's timeout cannot be relied on at
// all.
//
// What that looked like on screen: "Add and start now" stuck on "Starting…"
// with both buttons disabled and no way forward but Cancel. TeLegLive had the
// same unguarded call, where it would have hung "End the journey" instead —
// considerably worse, because a journey that cannot be ended cannot be claimed.
//
// SO THE CLOCK IS OURS. One timer, one settle-once guard, one promise that
// always resolves or rejects. Injectable so the behaviour can be tested without
// a browser: the three failures that matter — hangs, refuses, succeeds — are
// each a few lines of fake.

/** The slice of the Geolocation API this needs. */
export interface GeoLike {
  getCurrentPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
    fail: (e: { code?: number; message?: string }) => void,
    opts?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void
}

export interface Fix { lat: number; lng: number; accuracy_m?: number }

/** PERMISSION_DENIED is 1 in the spec. Named so the message can be the one a
 *  person can act on — "switch it back on" rather than "it failed". */
export const PERMISSION_DENIED = 1

export const NO_DEVICE = 'This device cannot read its location.'
export const DENIED = 'Location is switched off for this site. Turn it on and try again.'
export const SLOW = 'Still waiting for your location. Your browser may be asking permission — look for the prompt near the address bar.'
export const FAILED = 'Could not read your location. Check that location is on, then try again.'

/**
 * One position, or a refusal — never silence.
 *
 * `waitMs` is OUR timeout and the only one that can be trusted; the option
 * passed to the browser is left in as a best effort and deliberately shorter,
 * so that when it does work we hear about it first.
 */
export function oneShotFix(geo: GeoLike | null | undefined, o: {
  waitMs?: number
  highAccuracy?: boolean
  /** Swappable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
} = {}): Promise<Fix> {
  const waitMs = o.waitMs ?? 15000
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>))

  return new Promise<Fix>((resolve, reject) => {
    if (!geo) { reject(new Error(NO_DEVICE)); return }

    // SETTLED ONCE. Both the browser and our own clock can fire, and a promise
    // that resolves twice hides which answer was used.
    let settled = false
    const timer = setTimer(() => {
      if (settled) return
      settled = true
      reject(new Error(SLOW))
    }, waitMs)
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimer(timer)
      fn()
    }

    geo.getCurrentPosition(
      p => settle(() => resolve({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        ...(typeof p.coords.accuracy === 'number' ? { accuracy_m: p.coords.accuracy } : {}),
      })),
      e => settle(() => reject(new Error(e?.code === PERMISSION_DENIED ? DENIED : FAILED))),
      // Shorter than ours on purpose: where the browser's own clock does work,
      // its error arrives first and carries the better reason.
      { enableHighAccuracy: o.highAccuracy !== false, timeout: Math.max(1000, waitMs - 3000), maximumAge: 0 },
    )
  })
}

/** The browser's geolocation, or null where there is none (SSR, an old
 *  device). Kept here so no caller has to remember to check. */
export const deviceGeo = (): GeoLike | null =>
  (typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null)
