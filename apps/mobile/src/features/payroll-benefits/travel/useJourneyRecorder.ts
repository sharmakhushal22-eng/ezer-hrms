// The website's useJourneyRecorder (components/ess/TravelClaims.tsx) on expo-location.
//
// Same states (IDLE → TRACKING → RECORDED), same point shape {lat,lng,t,acc},
// same filtering (isValidPoint from lib/travel/gps.ts), and the same rule that
// the screen stays open while travelling: the watch runs only while this screen
// is mounted, exactly like the browser's watchPosition. A finished journey is
// kept (AsyncStorage instead of sessionStorage) so an app restart does not lose
// a drive the employee has not saved yet.
import * as React from 'react'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { isValidPoint, type GpsPoint } from '@web/travel/gps'

export type TrackState = 'IDLE' | 'TRACKING' | 'RECORDED'
export interface Journey {
  state: TrackState
  points: GpsPoint[]
  startedAt: string | null
  endedAt: string | null
  error: string | null
  accuracy: number | null
}

const TRACK_KEY = 'ezer.travel.journey'
const EMPTY: Journey = { state: 'IDLE', points: [], startedAt: null, endedAt: null, error: null, accuracy: null }
const NO_DEVICE = 'This device cannot report its location, so a journey cannot be recorded here.'
// The website says "for this site"; on the phone the permission belongs to the app.
const DENIED = 'Location permission is blocked. Allow location for this app, then start the journey again.'
const SERVICES_OFF = 'Location is switched off on this phone. Turn it on, then start the journey again.'
const WAITING = 'Waiting for a location fix. Move somewhere with a clearer view of the sky.'
/** The browser watch's `timeout: 20_000` — no fix for this long surfaces WAITING. */
const FIX_TIMEOUT_MS = 20_000

export function useJourneyRecorder() {
  const [journey, setJourney] = React.useState<Journey>(EMPTY)
  const pointsRef = React.useRef<GpsPoint[]>([])
  const subRef = React.useRef<Location.LocationSubscription | null>(null)
  const runRef = React.useRef(0)
  const lastFixRef = React.useRef(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Recover a finished-but-unsaved journey.
  React.useEffect(() => {
    let live = true
    AsyncStorage.getItem(TRACK_KEY).then(raw => {
      if (!live || !raw) return
      try {
        const saved = JSON.parse(raw) as Journey
        if (saved?.state === 'RECORDED' && saved.points?.length) {
          pointsRef.current = saved.points
          setJourney(saved)
        }
      } catch { /* corrupt entry — start clean */ }
    }).catch(() => {})
    return () => { live = false }
  }, [])

  const stopWatch = React.useCallback(() => {
    runRef.current++
    subRef.current?.remove()
    subRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const start = React.useCallback(async () => {
    stopWatch()
    const run = runRef.current
    let perm: Location.LocationPermissionResponse
    try { perm = await Location.requestForegroundPermissionsAsync() } catch {
      setJourney(j => ({ ...j, error: NO_DEVICE })); return
    }
    if (run !== runRef.current) return
    if (perm.status !== 'granted') { setJourney(j => ({ ...j, state: 'IDLE', error: DENIED })); return }
    const on = await Location.hasServicesEnabledAsync().catch(() => true)
    if (run !== runRef.current) return
    if (!on) { setJourney(j => ({ ...j, state: 'IDLE', error: SERVICES_OFF })); return }

    pointsRef.current = []
    lastFixRef.current = Date.now()
    setJourney({ state: 'TRACKING', points: [], startedAt: new Date().toISOString(), endedAt: null, error: null, accuracy: null })
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
        pos => {
          const p: GpsPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: pos.timestamp, acc: pos.coords.accuracy ?? null }
          if (!isValidPoint(p)) return
          lastFixRef.current = Date.now()
          pointsRef.current = [...pointsRef.current, p]
          setJourney(j => ({ ...j, points: pointsRef.current, accuracy: p.acc ?? null, error: null }))
        },
        // Not terminal — the watch keeps running, only the message is surfaced.
        () => setJourney(j => ({ ...j, error: WAITING })),
      )
      if (run !== runRef.current) { sub.remove(); return }
      subRef.current = sub
      timerRef.current = setInterval(() => {
        if (Date.now() - lastFixRef.current > FIX_TIMEOUT_MS) setJourney(j => (j.state === 'TRACKING' && !j.error ? { ...j, error: WAITING } : j))
      }, 5000)
    } catch {
      setJourney(j => ({ ...j, state: 'IDLE', error: NO_DEVICE }))
    }
  }, [stopWatch])

  const end = React.useCallback(() => {
    stopWatch()
    setJourney(j => {
      const next: Journey = { ...j, state: 'RECORDED', points: pointsRef.current, endedAt: new Date().toISOString() }
      AsyncStorage.setItem(TRACK_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [stopWatch])

  const reset = React.useCallback(() => {
    stopWatch()
    pointsRef.current = []
    AsyncStorage.removeItem(TRACK_KEY).catch(() => {})
    setJourney(EMPTY)
  }, [stopWatch])

  // Never leave a watch running after the screen goes away.
  React.useEffect(() => stopWatch, [stopWatch])

  return { journey, start, end, reset }
}
