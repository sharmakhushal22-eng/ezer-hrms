// lib/te/leg-tracking.ts — holding on to GPS fixes until the server has them.
//
// This is the part of the module where data actually gets lost. A leg is
// recorded on a phone, moving, often with no signal: in a lift, a tunnel, a
// basement car park, or simply out of coverage. Every fix the browser hands us
// has to survive until the server acknowledges it, and no fix may be sent
// twice — the distance is money.
//
// SO THE QUEUE IS THE SOURCE OF TRUTH, NOT THE REQUEST. A fix goes into
// localStorage the moment it arrives, keyed by the leg. Sending is a separate
// act that removes what the server confirmed. A tab closed mid-journey, a
// crash, a dead battery: the fixes already written are still there when the
// leg is opened again, and the server accepts a late batch until the report is
// saved.
//
// WHAT THIS FILE DOES NOT DO: decide the distance. The server recomputes it
// from what it stored, and `legEnd` returns the numbers that count. The running
// total here is for the person watching the screen, so it is called an estimate
// wherever it is shown.
import type { GpsPing } from './types.ts'

/** The company's GPS rules (cfg.track), read not invented. */
export interface TrackRules {
  /** How often to send what has been collected. Seeded at 30. */
  pingSec?: number
  /** A fix less accurate than this many metres is not worth keeping. Seeded at 50. */
  minAccuracy?: number
  /** Above this speed the server calls it a jump. Only used to warn. */
  maxSpeed?: number
  [k: string]: unknown
}

/** Send at least this often even if few points have arrived, so a slow walk
 *  still reaches the server. 20 points is the handover's other trigger. */
export const MAX_BUFFER = 20

export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * Is this fix worth keeping?
 *
 * A browser will happily report a position it inferred from wifi with a 2 km
 * error. Storing those makes a journey look like it teleported, which the
 * server then flags as a jump and a person has to explain. Dropping them is
 * not hiding anything: an inaccurate fix carries no information.
 */
export function acceptFix(fix: { accuracy_m?: number | null }, rules: TrackRules): boolean {
  const limit = num(rules.minAccuracy, 50)
  const acc = fix.accuracy_m
  // No accuracy reported at all: keep it. Some devices omit it, and throwing
  // away everything from such a device would record nothing.
  if (acc == null) return true
  return acc <= limit
}

/** Time to send what we are holding? */
export function shouldFlush(bufferSize: number, lastSentMs: number, nowMs: number, rules: TrackRules): boolean {
  if (bufferSize === 0) return false
  if (bufferSize >= MAX_BUFFER) return true
  return nowMs - lastSentMs >= num(rules.pingSec, 30) * 1000
}

// ── the queue that survives a closed tab ────────────────────────────────────

export const queueKey = (legId: string) => `te.leg.${legId}.pings`

/** Anything resembling localStorage. Passed in so this stays testable and so a
 *  browser that refuses storage (private mode) can be handled by the caller. */
export interface PingStore {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export function readQueue(legId: string, store: PingStore | null): GpsPing[] {
  if (!store) return []
  try {
    const raw = store.getItem(queueKey(legId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as GpsPing[]).filter(isPing) : []
  } catch {
    // Corrupt or unreadable: an empty trail is recoverable, a thrown error
    // halfway up a recording screen is not.
    return []
  }
}

export function writeQueue(legId: string, pings: GpsPing[], store: PingStore | null): void {
  if (!store) return
  try {
    if (pings.length) store.setItem(queueKey(legId), JSON.stringify(pings))
    else store.removeItem(queueKey(legId))
  } catch {
    // Out of quota, or storage blocked. The in-memory buffer still holds the
    // fixes for this session; nothing else can be done here.
  }
}

function isPing(p: unknown): p is GpsPing {
  const x = p as GpsPing
  return !!x && typeof x.lat === 'number' && typeof x.lng === 'number' && typeof x.recorded_at === 'string'
}

/**
 * Add fixes to what is already queued, without duplicating any.
 *
 * Two fixes with the same instant are the same fix — a reconnect that replays,
 * or two code paths both storing one. The server stores each ping once, so
 * sending a duplicate is harmless there, but a growing queue of repeats is not.
 */
export function mergePings(existing: GpsPing[], incoming: GpsPing[]): GpsPing[] {
  const seen = new Set(existing.map(p => p.recorded_at))
  const added = incoming.filter(p => !seen.has(p.recorded_at) && seen.add(p.recorded_at))
  return [...existing, ...added].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
}

/** What is left after the server confirmed a batch. Matched by instant, not by
 *  position: standing still produces many fixes at the same place. */
export function withoutSent(queue: GpsPing[], sent: GpsPing[]): GpsPing[] {
  const gone = new Set(sent.map(p => p.recorded_at))
  return queue.filter(p => !gone.has(p.recorded_at))
}

// ── the running total on screen ─────────────────────────────────────────────

const EARTH_KM = 6371

/** Straight-line distance between two fixes. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * The distance so far, for the person watching the screen.
 *
 * NOT the distance that gets paid. The server recomputes from what it stored,
 * drops fixes it does not trust and handles gaps; this is the sum of the
 * straight lines between the fixes this device happens to be holding. Shown as
 * an estimate, never as the answer.
 */
export function trailKm(points: { lat: number; lng: number }[]): number {
  let km = 0
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i])
  return Math.round(km * 10) / 10
}

/** A browser Position turned into what the API takes. */
export function toPing(pos: { coords: { latitude: number; longitude: number; accuracy?: number; speed?: number | null }; timestamp: number }): GpsPing {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy,
    // The browser reports speed in metres per second, and only sometimes.
    speed_kmh: typeof pos.coords.speed === 'number' && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 3.6) : undefined,
    recorded_at: new Date(pos.timestamp).toISOString(),
  }
}

/**
 * How long the trail has been silent, in minutes.
 *
 * A phone browser stops reading location when the screen locks or another app
 * comes forward — not less often, it stops. So a silence usually means the
 * phone went in a pocket, and the screen says so rather than letting the person
 * find out when the server flags a gap they cannot explain.
 */
export function silentMinutes(lastFixAt: string | null, nowMs: number): number {
  if (!lastFixAt) return 0
  const t = Date.parse(lastFixAt)
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60000)) : 0
}

/** Is the silence long enough that the server will treat it as a gap? */
export function isGap(lastFixAt: string | null, nowMs: number, rules: TrackRules & { gapMin?: number }): boolean {
  return silentMinutes(lastFixAt, nowMs) >= num(rules.gapMin, 5)
}
