// Reading this device's position once, and always coming back.
//
// The case that matters is the one a browser actually did on 20 October 2026
// with permission already granted: getCurrentPosition called NEITHER callback
// and never honoured its own `timeout`. On screen that was "Add and start now"
// stuck on "Starting…" with no way forward but Cancel, and the same unguarded
// call in TeLegLive would have hung "End the journey" — worse, because a
// journey that cannot be ended cannot be claimed.
//
// So the first test here is the hang. The others are the ordinary paths, which
// are easy and were never the problem.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DENIED, FAILED, NO_DEVICE, oneShotFix, PERMISSION_DENIED, SLOW, type GeoLike } from '../geo.ts'

/** A fake clock, so a 15-second wait is instant and deterministic. */
function fakeClock() {
  const due: { fn: () => void; at: number; id: number }[] = []
  let now = 0, next = 1
  return {
    setTimer: (fn: () => void, ms: number) => { const id = next++; due.push({ fn, at: now + ms, id }); return id },
    clearTimer: (t: unknown) => { const i = due.findIndex(d => d.id === t); if (i >= 0) due.splice(i, 1) },
    /** Run everything scheduled within `ms`. */
    advance(ms: number) {
      now += ms
      for (const d of [...due].sort((a, b) => a.at - b.at)) {
        if (d.at <= now) { this.clearTimer(d.id); d.fn() }
      }
    },
  }
}

const silent: GeoLike = { getCurrentPosition() { /* the bug: answers nothing, ever */ } }
const answers = (lat: number, lng: number, accuracy?: number): GeoLike => ({
  getCurrentPosition(ok) { ok({ coords: { latitude: lat, longitude: lng, ...(accuracy === undefined ? {} : { accuracy }) } }) },
})
const refuses = (code?: number): GeoLike => ({
  getCurrentPosition(_ok, fail) { fail({ code, message: 'nope' }) },
})

// ── the hang ────────────────────────────────────────────────────────────────

test('a geolocation that answers nothing is given up on, not waited on for ever', async () => {
  const clock = fakeClock()
  const p = oneShotFix(silent, { waitMs: 15000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  // Nothing has happened yet: the promise must still be pending, not resolved
  // with some invented position.
  let done = false
  void p.then(() => { done = true }, () => { done = true })
  await Promise.resolve()
  assert.equal(done, false, 'it does not settle before its own clock says so')

  clock.advance(15000)
  await assert.rejects(p, (e: Error) => e.message === SLOW)
})

test('the message points at the permission prompt, which is where people miss it', async () => {
  // The prompt opens in the address bar, not in the page. Somebody staring at
  // a spinner inside the page needs telling where to look.
  const clock = fakeClock()
  const p = oneShotFix(silent, { waitMs: 1000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  clock.advance(1000)
  await assert.rejects(p, (e: Error) => /address bar/.test(e.message))
})

// ── the ordinary paths ──────────────────────────────────────────────────────

test('a position comes back as a fix', async () => {
  const clock = fakeClock()
  const fix = await oneShotFix(answers(28.4956, 77.0891, 9), { setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  assert.deepEqual(fix, { lat: 28.4956, lng: 77.0891, accuracy_m: 9 })
})

test('a device that reports no accuracy still gives a usable fix', async () => {
  // Omitted rather than sent as 0: zero metres would read as a perfect fix.
  const clock = fakeClock()
  const fix = await oneShotFix(answers(28.4956, 77.0891), { setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  assert.deepEqual(fix, { lat: 28.4956, lng: 77.0891 })
  assert.equal('accuracy_m' in fix, false)
})

test('a refusal says which refusal it was', async () => {
  const clock = fakeClock()
  await assert.rejects(
    oneShotFix(refuses(PERMISSION_DENIED), { setTimer: clock.setTimer, clearTimer: clock.clearTimer }),
    (e: Error) => e.message === DENIED,
  )
  await assert.rejects(
    oneShotFix(refuses(2), { setTimer: clock.setTimer, clearTimer: clock.clearTimer }),
    (e: Error) => e.message === FAILED,
  )
})

test('no geolocation at all is refused immediately', async () => {
  await assert.rejects(oneShotFix(null), (e: Error) => e.message === NO_DEVICE)
  await assert.rejects(oneShotFix(undefined), (e: Error) => e.message === NO_DEVICE)
})

// ── settled exactly once ────────────────────────────────────────────────────

test('a late answer after our clock gave up changes nothing', async () => {
  // Both clocks can fire. A promise that settles twice hides which answer was
  // actually used, and would resolve a journey's start fix AFTER the screen has
  // already told the traveller it failed.
  let late: ((p: { coords: { latitude: number; longitude: number } }) => void) | null = null
  const slow: GeoLike = { getCurrentPosition(ok) { late = ok } }
  const clock = fakeClock()
  const p = oneShotFix(slow, { waitMs: 500, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  clock.advance(500)
  await assert.rejects(p, (e: Error) => e.message === SLOW)
  // The browser finally answers. Nothing may happen.
  assert.doesNotThrow(() => late?.({ coords: { latitude: 1, longitude: 2 } }))
})

test('our clock is cancelled once a real answer arrives', async () => {
  const clock = fakeClock()
  const fix = await oneShotFix(answers(1, 2), { waitMs: 500, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  assert.equal(fix.lat, 1)
  // If the timer were still pending this would reject an already-settled
  // promise; it must be a no-op.
  assert.doesNotThrow(() => clock.advance(10000))
})

test("the browser's own timeout is asked for, but shorter than ours", async () => {
  // Where it does work, its error arrives first and carries the better reason.
  let asked: { timeout?: number } | undefined
  const spy: GeoLike = { getCurrentPosition(ok, _f, opts) { asked = opts; ok({ coords: { latitude: 1, longitude: 2 } }) } }
  const clock = fakeClock()
  await oneShotFix(spy, { waitMs: 15000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  assert.ok(asked && typeof asked.timeout === 'number' && asked.timeout < 15000, `asked for ${asked?.timeout}`)
})
