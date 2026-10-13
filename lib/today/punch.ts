// lib/today/punch.ts — the punch session, as arithmetic.
//
// THREE OF THESE ARE IN USE TODAY: punchState and dayFromToday (the hero's
// avatar dot, and reading the payload), and streakText (the chip under the
// dial). The rest — the dial geometry, the grading, the capsule collision —
// belongs to the analog punch watch, which was built and then reverted because
// the design was not liked.
//
// It is kept rather than deleted on purpose. It is pure, it is covered by 42
// tests, and the collision rule in particular took three attempts to get right
// (the package's fired when the punches were furthest apart; a radial fix then
// landed on the digital readout). Deleting it would mean deriving all of that
// again if the watch ever comes back. Unused exports in a library module cost
// nothing at runtime — the bundler drops them.
//
// Everything here is pure: the state machine, the shift geometry the dial draws
// with, and the grading that turns two timestamps into "12m late" or "+1h OT".
// No fetch, no React, no imports — so it is unit-tested, and so the panel that
// renders it has no rules of its own.
//
// WHY THE FETCH IS NOT HERE. The punch request needs `authHeaders()` from
// @/lib/auth-headers, and the test runner (node --experimental-strip-types)
// does not resolve the `@/` alias. A module the tests cannot load is a module
// whose rules are not pinned down, so the one network call stays in the
// component and this file stays arithmetic.
//
// THE SESSION MODEL. A work day holds one session:
//     IDLE --[in]--> IN (running) --[out]--> DONE (closed)
// Punching out stamps the out time on the open session. Only one of the two
// buttons is ever live, so the wrong order cannot be reached from the UI — and
// ess_punch() enforces the same thing in SQL for the mobile and biometric paths.

export type PunchKind = 'IN' | 'OUT'

/** Today's two timestamps. null means "not recorded yet". */
export interface PunchDay {
  inAt: string | null
  outAt: string | null
}

export type PunchState = 'IDLE' | 'IN' | 'DONE'

export function punchState(day: PunchDay | null | undefined): PunchState {
  if (!day?.inAt) return 'IDLE'
  return day.outAt ? 'DONE' : 'IN'
}

/** The single rule: punching out is only reachable from an open session. */
export function canPunch(kind: PunchKind, day: PunchDay | null | undefined): boolean {
  const st = punchState(day)
  return kind === 'IN' ? st === 'IDLE' : st === 'IN'
}

/** A timestamp that may be missing or unparseable. Returns null for both,
 *  because a dial drawn from NaN is worse than a dial drawn from nothing. */
export function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** HH:MM:SS of an elapsed span. Clamped at zero: a negative duration means the
 *  clocks disagree, and counting backwards on screen helps nobody. */
export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`
}

/** "09:30" → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** The shift's length in ms. A shift that ends before it starts crosses
 *  midnight, so it wraps rather than going negative — a night shift must not
 *  produce a negative target that makes every minute worked look like overtime. */
export function shiftLengthMs(start: string, end: string): number {
  const s = hhmmToMinutes(start)
  const e = hhmmToMinutes(end)
  return ((e > s ? e - s : 24 * 60 - s + e)) * 60_000
}

// ── dial geometry ───────────────────────────────────────────────────────────
//
// The dial is a 12-hour analog face, so one hour is 30° and one minute of
// ELAPSED time is half a degree. Elapsed time drives the worked arc, not wall
// position: a 13-hour day then draws as a 390° sweep that is clipped, instead
// of wrapping back over its own start and reading as a short day.

/** Degrees for a minutes-since-midnight value. */
export const degFromMinutes = (min: number): number => ((min / 60) % 12) * 30

/** Degrees for a wall-clock time. */
export const degFromDate = (d: Date): number =>
  ((d.getHours() % 12) + d.getMinutes() / 60 + d.getSeconds() / 3600) * 30

export const DEG_PER_MINUTE = 0.5

// ── grading ─────────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'ot'
export type Tag = { text: string; tone: Tone } | null

/** Minutes rendered as "1h 05m" / "45m" — used by every grade below so they
 *  cannot disagree about how to say the same thing. */
function spanText(min: number): string {
  const h = Math.floor(min / 60)
  return h ? `${h}h ${String(min % 60).padStart(2, '0')}m` : `${min % 60}m`
}

/** Against the shift start, with a grace window. Arriving early is reported as
 *  early rather than praised as on time, because the two are different facts. */
export function gradeIn(inAt: Date | null, shiftStart: string, graceMin = 10): Tag {
  if (!inAt) return null
  const diff = inAt.getHours() * 60 + inAt.getMinutes() - hhmmToMinutes(shiftStart)
  if (diff <= graceMin) return { text: diff < -5 ? `${spanText(-diff)} early` : 'On time', tone: 'ok' }
  return { text: `${spanText(diff)} late`, tone: 'warn' }
}

/** Against the shift end. Leaving after it is not an achievement and not a
 *  problem, so it is 'ok' and merely stated. */
export function gradeOut(outAt: Date | null, shiftEnd: string): Tag {
  if (!outAt) return null
  const diff = outAt.getHours() * 60 + outAt.getMinutes() - hhmmToMinutes(shiftEnd)
  if (diff < 0) return { text: `${spanText(-diff)} early`, tone: 'warn' }
  return diff <= 5 ? { text: 'On schedule', tone: 'ok' } : { text: `${spanText(diff)} after`, tone: 'ok' }
}

/**
 * Against the shift's length.
 *
 * Overtime is reported the moment it happens, while the session is still open —
 * that is the number somebody staying late wants to see. "Short" is only
 * reported once the day is CLOSED: a running session is always short of a full
 * day, and saying so at 10am would be true and useless.
 */
export function gradeWorked(workedMs: number, targetMs: number, closed: boolean): Tag {
  const over = Math.round((workedMs - targetMs) / 60_000)
  if (over > 0) return { text: `+${spanText(over)} OT`, tone: 'ot' }
  if (!closed) return null
  return over < 0 ? { text: `${spanText(-over)} short`, tone: 'warn' } : { text: 'Full day', tone: 'ok' }
}

/** How far through the shift's length this session is, 0–100. */
export function shiftProgress(workedMs: number, targetMs: number): number {
  if (!(targetMs > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((workedMs / targetMs) * 100)))
}

/** The ESS Today payload keeps today's punches under different names. One place
 *  to translate, so the panel never reads snake_case and the arithmetic above
 *  never learns the payload's shape. */
export function dayFromToday(
  today: { punch_in: string | null; punch_out: string | null } | null | undefined,
): PunchDay {
  return { inAt: today?.punch_in ?? null, outAt: today?.punch_out ?? null }
}

// ── keeping the two punch capsules apart ────────────────────────────────────
//
// Each punch plants a capsule carrying its time. Both sit on the same ring, so
// two punches at a similar DIAL POSITION put the capsules on top of each other
// — and on a 12-hour face that happens two ways: a short session (in and out
// minutes apart) and a session exactly twelve hours long, which lands back on
// the same spot. The fix is to drop the OUT capsule to an inner radius, where
// the radial gap keeps it clear.
//
// The rule this replaces was inverted. It read
//     |((degOut - degIn + 540) % 360) - 180| > 160
// which is true when the two are about SIX hours apart — the furthest apart
// they can be on a 12-hour dial, the one case needing no help — and false when
// they coincide, which is the case that overlaps. Its own comment said it moved
// the capsule when the punches were "close together", so the code and the
// comment disagreed and the comment was right.

/** How far apart two dial angles are, 0–180°, the short way round. */
export function dialSeparation(degA: number, degB: number): number {
  const d = (((degB - degA) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

/** Both capsules ride this radius. */
export const CHIP_R = 77
/** A capsule is 33 units wide at that radius, which subtends about 25°.
 *  Below ~30° of separation two of them touch. */
export const CHIP_CLEAR_DEG = 30

/**
 * How far to slide the OUT capsule ALONG the ring to clear the IN one.
 *
 * Sliding, not pulling inward. The first fix moved it to an inner radius,
 * which cleared the other capsule and then landed on the digital readout in
 * the middle of the face — one collision traded for another. The label is
 * free to sit beside its node because the stem is drawn from the node to the
 * label, so the true time is still marked where it belongs.
 *
 * The offset is signed AWAY from the IN capsule, so the two always open out
 * rather than one being pushed through the other.
 */
export function outChipOffsetDeg(inAt: Date | null, outAt: Date | null): number {
  if (!inAt || !outAt) return 0
  const a = degFromDate(inAt)
  const b = degFromDate(outAt)
  if (dialSeparation(a, b) >= CHIP_CLEAR_DEG) return 0
  // Which side of the IN capsule the OUT one already leans towards.
  const signed = (((b - a + 540) % 360) - 180)
  return signed >= 0 ? CHIP_CLEAR_DEG : -CHIP_CLEAR_DEG
}

// ── the on-time streak ──────────────────────────────────────────────────────
//
// ess_attendance_streak() counts back from today over days that were punched
// and not late, and it ZEROES on the newest late day rather than decrementing:
// one late morning takes a 20-day run to nothing. So 0 is a common, ordinary
// value, not an edge case — which is why the chip states it instead of
// disappearing and making the hero look like it lost an element.

/** What the streak chip reads. `punchedToday` decides whether a fresh run can
 *  still start today: being told to "start one tomorrow" at nine in the
 *  morning, with the day not yet punched, is both wrong and discouraging. */
export function streakText(streak: number, punchedToday: boolean): string {
  if (streak > 0) return `${streak}-day on-time streak`
  return punchedToday ? 'No streak — start one tomorrow' : 'No streak — start one today'
}
