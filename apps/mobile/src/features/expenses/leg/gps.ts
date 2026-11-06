// src/features/expenses/leg/gps.ts — the phone's location, the way TeLegLive reads it
// on the website (navigator.geolocation), with expo-location.
//
//   here()        getCurrentPosition({ enableHighAccuracy, timeout: 20000, maximumAge: 0 })
//                 → the fix sent with start / stop / end. Same error sentences.
//   watchFixes()  watchPosition while the recorder screen is open and the journey
//                 is running. FOREGROUND ONLY, as on the website: no TaskManager,
//                 no background updates.
//   pingStore     the website's localStorage queue `te.leg.<legId>.pings`, as a
//                 synchronous in-memory cache written through to AsyncStorage, so
//                 the pure queue helpers of lib/te/leg-tracking.ts work unchanged.
//                 hydrateQueue(legId) loads what a previous session left behind.
//
// is_mock: Android reports `mocked` on every location; it is sent on the start /
// stop-less fixes and on every ping when the platform reports it (spec 8.2,
// known defect 6). The web never sent it; the column exists.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import type { GpsFix, GpsPing } from '@web/te/types'
import { mergePings, queueKey, readQueue, toPing, type PingStore } from '@web/te/leg-tracking'

// ── the queue ────────────────────────────────────────────────────────────────
const cache = new Map<string, string>()

export const pingStore: PingStore = {
  getItem: k => cache.get(k) ?? null,
  setItem: (k, v) => { cache.set(k, v); void AsyncStorage.setItem(k, v).catch(() => {}) },
  removeItem: k => { cache.delete(k); void AsyncStorage.removeItem(k).catch(() => {}) },
}

/** Load the stored queue for a journey into the cache, merged with anything
 *  already held in memory (never loses a fix taken while it loaded). */
export async function hydrateQueue(legId: string): Promise<void> {
  const k = queueKey(legId)
  let stored: string | null = null
  try { stored = await AsyncStorage.getItem(k) } catch { return }
  if (!stored) return
  const held = readQueue(legId, pingStore)
  const fromDisk = readQueue(legId, { getItem: () => stored, setItem: () => {}, removeItem: () => {} })
  const merged = mergePings(fromDisk, held)
  if (merged.length) pingStore.setItem(k, JSON.stringify(merged))
}

// ── one fix ──────────────────────────────────────────────────────────────────
const NO_DEVICE = 'This device cannot read its location.'
const NO_FIX = 'Could not read your location. Check that location is on, then try again.'

export class GpsError extends Error {
  denied: boolean
  constructor(message: string, denied = false) { super(message); this.name = 'GpsError'; this.denied = denied }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Ask for foreground location (the system dialog the first time). true = allowed. */
export async function askLocation(): Promise<boolean> {
  try {
    const p = await Location.requestForegroundPermissionsAsync()
    return p.granted
  } catch {
    return false
  }
}

/** Already refused, without asking again (for the "switched off" flag on open). */
export async function locationRefused(): Promise<boolean> {
  try {
    const p = await Location.getForegroundPermissionsAsync()
    return p.status === 'denied'
  } catch {
    return false
  }
}

const mockOf = (l: Location.LocationObject) => (typeof l.mocked === 'boolean' ? { is_mock: l.mocked } : {})

/** A fresh, accurate position — TeLegLive here(). Throws GpsError with the web's sentence. */
export async function here(): Promise<GpsFix> {
  let allowed: boolean
  try {
    allowed = (await Location.requestForegroundPermissionsAsync()).granted
  } catch {
    throw new GpsError(NO_DEVICE)
  }
  if (!allowed) throw new GpsError(NO_FIX, true)
  try {
    const p = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 20000)
    return {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      ...(p.coords.accuracy != null ? { accuracy_m: p.coords.accuracy } : {}),
      ...mockOf(p),
    }
  } catch {
    throw new GpsError(NO_FIX)
  }
}

/** A delivered location as the API's GpsPing (lib/te/leg-tracking toPing, plus is_mock). */
export function pingOf(l: Location.LocationObject): GpsPing {
  const p = toPing({
    coords: { latitude: l.coords.latitude, longitude: l.coords.longitude, accuracy: l.coords.accuracy ?? undefined, speed: l.coords.speed },
    timestamp: l.timestamp,
  })
  if (p.accuracy_m == null) delete p.accuracy_m
  if (p.speed_kmh == null) delete p.speed_kmh
  return { ...p, ...mockOf(l) }
}

/**
 * Follow the position while the screen is open. The website processes every
 * fix the browser delivers (no interval of its own); here a fix is asked for
 * every ~5 s with no distance threshold, so a vehicle standing in traffic
 * still produces fixes and the server does not read the wait as a GPS gap.
 * Resolves to a stop function, or null when location is refused.
 */
export async function watchFixes(onFix: (l: Location.LocationObject) => void): Promise<(() => void) | null> {
  if (!(await askLocation())) return null
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 0 },
    onFix,
    () => { /* timeouts and "unavailable" are ignored, as on the website */ },
  )
  return () => sub.remove()
}
