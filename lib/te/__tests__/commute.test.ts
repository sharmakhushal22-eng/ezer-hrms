import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chainCount, commuteChain, commuteGap, hubForCity, hubKind, NO_XFER, sameHub, xferLabel, xferModes,
} from '../commute.ts'
import type { TeMode } from '../types.ts'

const mode = (id: string, scopes: string[], on = true): TeMode =>
  ({ id, name: id, icon: '', basis: 'km', scopes, on, stops: true } as unknown as TeMode)

const MODES: TeMode[] = [
  mode('own', ['local', 'domestic']),
  mode('cab', ['local', 'domestic', 'international']),
  mode('auto', ['local', 'domestic']),
  mode('public', ['local', 'domestic', 'international']),
  mode('rental', ['domestic', 'international']),       // not offered locally
  mode('train', ['local', 'domestic', 'international']), // a hub mode AND local-capable
  mode('flight', ['domestic', 'international']),
  mode('bus', ['domestic', 'international']),
  mode('off', ['local'], false),                        // switched off
]

// ── which journeys have transfers ───────────────────────────────────────────

test('a flight leaves from an airport and a train from a station', () => {
  assert.equal(hubKind('flight', 'domestic'), 'airport')
  assert.equal(hubKind('train', 'domestic'), 'station')
  assert.equal(hubKind('flight', 'international'), 'airport')
})

test('a door-to-door mode has no hub, so it is never asked about one', () => {
  for (const m of ['cab', 'own', 'auto', 'public', 'rental']) {
    assert.equal(hubKind(m, 'domestic'), null, m)
  }
})

test('a local trip has no hubs at all', () => {
  // One city. A flight is not offered on a local trip, and a station transfer
  // inside one city is just a journey.
  assert.equal(hubKind('flight', 'local'), null)
  assert.equal(hubKind('train', 'local'), null)
})

// ── what a transfer may travel by ───────────────────────────────────────────

test('a transfer is local travel, so it offers the locally allowed modes', () => {
  const ids = xferModes(MODES).map(m => m.id)
  assert.deepEqual(ids, ['own', 'cab', 'auto', 'public'])
})

test('you cannot fly to the airport, whatever the config says', () => {
  // train is switched on for local in this fixture, and it is still excluded:
  // the one thing worse than a missing option is an absurd one.
  const ids = xferModes(MODES).map(m => m.id)
  assert.ok(!ids.includes('flight'))
  assert.ok(!ids.includes('train'))
})

test('a switched-off mode is not offered', () => {
  assert.ok(!xferModes(MODES).map(m => m.id).includes('off'))
})

// ── the chain, which is the whole point ─────────────────────────────────────

test('Delhi to Mumbai by flight is three journeys, not one', () => {
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic',
    from: 'home', to: 'hotel', hubA: 'del', hubB: 'bom', first: 'cab', last: 'cab',
  })
  assert.deepEqual(chain.map(s => [s.kind, s.from, s.to, s.mode]), [
    ['first', 'home', 'del', 'cab'],
    ['main', 'del', 'bom', 'flight'],
    ['last', 'bom', 'hotel', 'cab'],
  ])
  assert.equal(chainCount(chain), 3)
})

test('each end can travel differently — metro out, company cab back', () => {
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic',
    from: 'home', to: 'hotel', hubA: 'del', hubB: 'bom', first: 'public', last: 'company',
  })
  assert.equal(chain[0].mode, 'public')
  assert.equal(chain[2].mode, 'company')
})

test('a door-to-door journey is one step from where you are to where you go', () => {
  const chain = commuteChain({ mode: 'cab', scope: 'domestic', from: 'home', to: 'client' })
  assert.deepEqual(chain, [{ kind: 'main', mode: 'cab', from: 'home', to: 'client', skipped: false }])
})

test('no transfer is drawn when the journey already starts at the airport', () => {
  // Somebody whose trip starts at the airport is already there. buildLegs
  // skips it with `ha !== a.place`; so does this.
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic', from: 'del', to: 'hotel', hubA: 'del', hubB: 'bom',
  })
  assert.deepEqual(chain.map(s => s.kind), ['main', 'last'])
  assert.equal(chain[0].from, 'del')
})

test('no transfer is drawn when the journey ends at the airport', () => {
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic', from: 'home', to: 'bom', hubA: 'del', hubB: 'bom',
  })
  assert.deepEqual(chain.map(s => s.kind), ['first', 'main'])
  assert.equal(chain[1].to, 'bom')
})

test('a transfer set to none is in the chain but travelled by nobody', () => {
  // A colleague dropped them. The step is still shown — they need to see that
  // it is deliberately empty — and it does not count toward the estimate.
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic',
    from: 'home', to: 'hotel', hubA: 'del', hubB: 'bom', first: NO_XFER, last: 'cab',
  })
  assert.equal(chain[0].skipped, true)
  assert.equal(chain[2].skipped, false)
  assert.equal(chainCount(chain), 2)
})

test('the same airport at both ends is not a journey', () => {
  // Almost always the wrong city was picked. buildLegs drops both hubs; this
  // draws one plain step rather than an arrow from a place to itself.
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic', from: 'home', to: 'office', hubA: 'del', hubB: 'del',
  })
  assert.deepEqual(chain.map(s => s.kind), ['main'])
  assert.equal(chain[0].from, 'home')
  assert.equal(chain[0].to, 'office')
  assert.ok(sameHub('del', 'del'))
  assert.ok(!sameHub('del', 'bom'))
})

test('a cab is assumed only until somebody says otherwise', () => {
  // The default has to stay a cab — it is what most people do and the estimate
  // needs something — but it is the screen's job to show it, which is what the
  // chain is for.
  const chain = commuteChain({
    mode: 'flight', scope: 'domestic', from: 'home', to: 'hotel', hubA: 'del', hubB: 'bom',
  })
  assert.equal(chain[0].mode, 'cab')
  assert.equal(chain[2].mode, 'cab')
})

// ── what is still missing ───────────────────────────────────────────────────

test('the gap names the next thing to answer, in filling order', () => {
  const base = { mode: 'flight', scope: 'domestic' as const, from: 'home', to: 'hotel' }
  assert.match(commuteGap({ ...base, mode: '' }), /how you travel/)
  assert.match(commuteGap(base), /airport you leave from/)
  assert.match(commuteGap({ ...base, hubA: 'del' }), /airport you arrive at/)
  assert.equal(commuteGap({ ...base, hubA: 'del', hubB: 'bom' }), '')
})

test('the gap says station for a train, not airport', () => {
  assert.match(commuteGap({ mode: 'train', scope: 'domestic', from: 'a', to: 'b' }), /station/)
})

test('a vehicle is asked for before the hubs, because it is the mode itself', () => {
  assert.match(
    commuteGap({ mode: 'own', scope: 'domestic', from: 'a', to: 'b', needsVehicle: true }),
    /which vehicle/,
  )
  assert.equal(
    commuteGap({ mode: 'own', scope: 'domestic', from: 'a', to: 'b', needsVehicle: true, vehicleId: 'V1' }),
    '',
  )
})

test('a door-to-door journey is never short of a hub', () => {
  assert.equal(commuteGap({ mode: 'cab', scope: 'domestic', from: 'a', to: 'b' }), '')
})

test('the label says plainly when nothing is claimed', () => {
  assert.equal(xferLabel(NO_XFER, MODES), 'No journey to claim')
  assert.equal(xferLabel(undefined, MODES), 'No journey to claim')
  assert.equal(xferLabel('cab', MODES), 'cab')
})

// ── which hub a journey leaves from ─────────────────────────────────────────
// Mirrors hubFor in the engine. The screen needs it because it was saying
// "No airport is set up for Mumbai" on a company that had one.

const MASTERS = {
  hubs: {
    NCR: { air: 'del', rail: 'ndls' },
    Mumbai: { air: 'bom', rail: 'csmt' },
    Jaipur: { air: 'jai', rail: 'jp' },
  },
  regions: { NCR: ['Delhi', 'Gurugram', 'Noida', 'Faridabad'] },
}

test('a city with its own hub uses it', () => {
  assert.equal(hubForCity({ city: 'Mumbai', pt: 'corp' }, 'air', MASTERS), 'bom')
  assert.equal(hubForCity({ city: 'Mumbai', pt: 'corp' }, 'rail', MASTERS), 'csmt')
})

test('a city in a region uses the region’s hub', () => {
  // Every NCR city flies from Delhi; none of them has an airport of its own.
  assert.equal(hubForCity({ city: 'Gurugram', pt: 'corp' }, 'air', MASTERS), 'del')
  assert.equal(hubForCity({ city: 'Noida', pt: 'corp' }, 'rail', MASTERS), 'ndls')
})

test('a place that is already the hub is its own answer', () => {
  // Somebody whose trip starts at the airport needs no ride to one.
  assert.equal(hubForCity({ id: 'bom', city: 'Mumbai', pt: 'airport' }, 'air', MASTERS), 'bom')
  assert.equal(hubForCity({ id: 'jp', city: 'Jaipur', pt: 'station' }, 'rail', MASTERS), 'jp')
})

test('a hub of the wrong kind does not answer for the other', () => {
  // An airport is not a station. This is the case that was mislabelled:
  // Jaipur had a station and no airport, and the screen blamed the city.
  const onlyRail = { hubs: { Jaipur: { rail: 'jp' } }, regions: {} }
  assert.equal(hubForCity({ city: 'Jaipur', pt: 'corp' }, 'rail', onlyRail), 'jp')
  assert.equal(hubForCity({ city: 'Jaipur', pt: 'corp' }, 'air', onlyRail), null)
})

test('a city with nothing set up says so, and does not invent one', () => {
  assert.equal(hubForCity({ city: 'Shimla', pt: 'corp' }, 'air', MASTERS), null)
  assert.equal(hubForCity(null, 'air', MASTERS), null)
  assert.equal(hubForCity({ city: '', pt: 'corp' }, 'air', MASTERS), null)
  assert.equal(hubForCity({ city: 'Mumbai', pt: 'corp' }, 'air', {}), null)
})
