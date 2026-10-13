// lib/te/__tests__/leg-tracking.test.ts — not losing a GPS trail.
//
// A leg is recorded on a moving phone with intermittent signal. The failures
// that matter are silent: a fix dropped in a tunnel, a batch sent twice, a
// queue that survives a closed tab but comes back unreadable. Each of those
// has a test, because none of them would be noticed by looking at the screen.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  acceptFix, haversineKm, isGap, mergePings, queueKey, readQueue, shouldFlush,
  silentMinutes, toPing, trailKm, withoutSent, writeQueue, MAX_BUFFER,
  type PingStore,
} from '../leg-tracking.ts'
import type { GpsPing } from '../types.ts'

const RULES = { pingSec: 30, minAccuracy: 50, gapMin: 5 }

const ping = (at: string, over: Partial<GpsPing> = {}): GpsPing =>
  ({ lat: 28.45, lng: 77.02, accuracy_m: 10, recorded_at: at, ...over })

/** A localStorage that works, and one that refuses — private mode does this. */
function memStore(): PingStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: k => { data.delete(k) },
  }
}
const hostileStore: PingStore = {
  getItem() { throw new Error('storage disabled') },
  setItem() { throw new Error('storage disabled') },
  removeItem() { throw new Error('storage disabled') },
}

describe('which fixes are worth keeping', () => {
  it('keeps an accurate fix', () => {
    assert.equal(acceptFix({ accuracy_m: 8 }, RULES), true)
    assert.equal(acceptFix({ accuracy_m: 50 }, RULES), true)
  })

  it('drops a fix the browser guessed from wifi', () => {
    // A 2 km error makes the journey look like it teleported, which the server
    // then flags as a jump and somebody has to explain.
    assert.equal(acceptFix({ accuracy_m: 2000 }, RULES), false)
    assert.equal(acceptFix({ accuracy_m: 51 }, RULES), false)
  })

  it('keeps a fix from a device that reports no accuracy at all', () => {
    // Throwing these away would record nothing on such a device.
    assert.equal(acceptFix({}, RULES), true)
    assert.equal(acceptFix({ accuracy_m: null }, RULES), true)
  })

  it('follows the company limit rather than one of its own', () => {
    assert.equal(acceptFix({ accuracy_m: 120 }, { minAccuracy: 200 }), true)
    assert.equal(acceptFix({ accuracy_m: 120 }, { minAccuracy: 100 }), false)
  })
})

describe('when to send', () => {
  it('sends nothing when there is nothing', () => {
    assert.equal(shouldFlush(0, 0, 999_999, RULES), false)
  })

  it('sends once the interval has passed', () => {
    assert.equal(shouldFlush(3, 0, 29_000, RULES), false)
    assert.equal(shouldFlush(3, 0, 30_000, RULES), true)
  })

  it('sends early when the buffer fills, however recent the last send', () => {
    // Driving produces points fast; waiting the full interval would risk a
    // large batch and a large loss.
    assert.equal(shouldFlush(MAX_BUFFER, 0, 1_000, RULES), true)
  })

  it('uses the company interval', () => {
    assert.equal(shouldFlush(1, 0, 10_000, { pingSec: 5 }), true)
    assert.equal(shouldFlush(1, 0, 10_000, { pingSec: 60 }), false)
  })
})

describe('the queue that survives a closed tab', () => {
  it('keys the queue by the leg, so two legs cannot mix', () => {
    assert.notEqual(queueKey('leg-a'), queueKey('leg-b'))
  })

  it('writes and reads back what it was given', () => {
    const store = memStore()
    const pings = [ping('2026-11-16T09:00:00.000Z'), ping('2026-11-16T09:00:30.000Z')]
    writeQueue('leg-1', pings, store)
    assert.deepEqual(readQueue('leg-1', store), pings)
  })

  it('clears the key entirely when the queue empties', () => {
    const store = memStore()
    writeQueue('leg-1', [ping('2026-11-16T09:00:00.000Z')], store)
    writeQueue('leg-1', [], store)
    assert.equal(store.data.has(queueKey('leg-1')), false, 'an empty array should not linger in storage')
  })

  it('returns nothing rather than throwing when storage is unreadable', () => {
    // Private mode, or a browser with site data blocked. An empty trail is
    // recoverable; an exception halfway up a recording screen is not.
    assert.deepEqual(readQueue('leg-1', hostileStore), [])
    assert.doesNotThrow(() => writeQueue('leg-1', [ping('2026-11-16T09:00:00.000Z')], hostileStore))
  })

  it('survives corrupt contents', () => {
    const store = memStore()
    store.setItem(queueKey('leg-1'), 'not json at all')
    assert.deepEqual(readQueue('leg-1', store), [])
    store.setItem(queueKey('leg-1'), '{"not":"an array"}')
    assert.deepEqual(readQueue('leg-1', store), [])
  })

  it('throws away entries that are not fixes', () => {
    const store = memStore()
    store.setItem(queueKey('leg-1'), JSON.stringify([ping('2026-11-16T09:00:00.000Z'), { lat: 'x' }, null]))
    assert.equal(readQueue('leg-1', store).length, 1)
  })

  it('does nothing at all when there is no storage', () => {
    assert.deepEqual(readQueue('leg-1', null), [])
    assert.doesNotThrow(() => writeQueue('leg-1', [ping('2026-11-16T09:00:00.000Z')], null))
  })
})

describe('merging and acknowledging', () => {
  it('never queues the same instant twice', () => {
    // A reconnect that replays, or two code paths both storing one fix.
    const a = [ping('2026-11-16T09:00:00.000Z')]
    const b = [ping('2026-11-16T09:00:00.000Z'), ping('2026-11-16T09:00:30.000Z')]
    assert.deepEqual(mergePings(a, b).map(p => p.recorded_at), ['2026-11-16T09:00:00.000Z', '2026-11-16T09:00:30.000Z'])
  })

  it('keeps the trail in time order however it arrives', () => {
    const merged = mergePings([ping('2026-11-16T09:01:00.000Z')], [ping('2026-11-16T09:00:00.000Z')])
    assert.deepEqual(merged.map(p => p.recorded_at), ['2026-11-16T09:00:00.000Z', '2026-11-16T09:01:00.000Z'])
  })

  it('does not duplicate within one incoming batch either', () => {
    const dupes = [ping('2026-11-16T09:00:00.000Z'), ping('2026-11-16T09:00:00.000Z')]
    assert.equal(mergePings([], dupes).length, 1)
  })

  it('removes only what the server confirmed', () => {
    const queue = [ping('2026-11-16T09:00:00.000Z'), ping('2026-11-16T09:00:30.000Z'), ping('2026-11-16T09:01:00.000Z')]
    const left = withoutSent(queue, [queue[0], queue[1]])
    assert.deepEqual(left.map(p => p.recorded_at), ['2026-11-16T09:01:00.000Z'])
  })

  it('matches by instant, not by position', () => {
    // Standing at a traffic light produces many fixes in the same place; only
    // the ones actually sent may be dropped.
    const samePlace = [ping('2026-11-16T09:00:00.000Z'), ping('2026-11-16T09:00:30.000Z')]
    assert.equal(withoutSent(samePlace, [samePlace[0]]).length, 1)
  })

  it('leaves the queue alone when nothing was sent', () => {
    const queue = [ping('2026-11-16T09:00:00.000Z')]
    assert.deepEqual(withoutSent(queue, []), queue)
  })
})

describe('the running total on screen', () => {
  it('measures a known distance about right', () => {
    // Gurugram to Connaught Place is roughly 28 km in a straight line.
    const km = haversineKm({ lat: 28.4595, lng: 77.0266 }, { lat: 28.6315, lng: 77.2167 })
    assert.ok(km > 24 && km < 32, `expected about 28 km, got ${km}`)
  })

  it('is zero for a point against itself', () => {
    assert.equal(haversineKm({ lat: 28.45, lng: 77.02 }, { lat: 28.45, lng: 77.02 }), 0)
  })

  it('adds the straight lines between fixes', () => {
    const pts = [{ lat: 28.4595, lng: 77.0266 }, { lat: 28.5, lng: 77.1 }, { lat: 28.6315, lng: 77.2167 }]
    const total = trailKm(pts)
    assert.ok(total >= haversineKm(pts[0], pts[2]), 'a path through a middle point is never shorter than the straight line')
  })

  it('is zero for nothing, and for a single fix', () => {
    assert.equal(trailKm([]), 0)
    assert.equal(trailKm([{ lat: 28.45, lng: 77.02 }]), 0)
  })
})

describe('turning a browser position into a ping', () => {
  it('takes what the API wants and converts the speed', () => {
    const p = toPing({ coords: { latitude: 28.45, longitude: 77.02, accuracy: 12, speed: 10 }, timestamp: Date.parse('2026-11-16T09:00:00.000Z') })
    assert.equal(p.lat, 28.45)
    assert.equal(p.accuracy_m, 12)
    assert.equal(p.speed_kmh, 36, 'the browser reports metres per second')
    assert.equal(p.recorded_at, '2026-11-16T09:00:00.000Z')
  })

  it('leaves the speed out when the device does not report one', () => {
    assert.equal(toPing({ coords: { latitude: 1, longitude: 2, speed: null }, timestamp: 0 }).speed_kmh, undefined)
    assert.equal(toPing({ coords: { latitude: 1, longitude: 2, speed: -1 }, timestamp: 0 }).speed_kmh, undefined)
  })
})

describe('noticing that the phone went quiet', () => {
  const now = Date.parse('2026-11-16T09:10:00.000Z')

  it('counts the minutes since the last fix', () => {
    assert.equal(silentMinutes('2026-11-16T09:04:00.000Z', now), 6)
    assert.equal(silentMinutes('2026-11-16T09:10:00.000Z', now), 0)
  })

  it('counts nothing before the first fix', () => {
    assert.equal(silentMinutes(null, now), 0)
    assert.equal(silentMinutes('not a date', now), 0)
  })

  it('calls it a gap at the company threshold, so the person is told before the server flags it', () => {
    assert.equal(isGap('2026-11-16T09:06:00.000Z', now, RULES), false, '4 minutes is not yet a gap')
    assert.equal(isGap('2026-11-16T09:05:00.000Z', now, RULES), true, '5 minutes is')
  })
})
