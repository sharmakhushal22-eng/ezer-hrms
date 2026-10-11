'use client'
// components/te/trip/TeTrips.tsx — every trip, grouped by what it needs from
// you. Screens 50 and 51.
//
// The order is not chronological on purpose: a trip you are on today and a
// trip you are back from both need something now, while one approved for next
// month needs nothing. lib/te/trips-list.ts decides the grouping and is tested.
import { useState } from 'react'
import type { Snapshot, TeTrip, TripScope, Uuid } from '@/lib/te/types'
import { groupTrips, myTrips, scopeCounts, tripChip, tripMoney } from '@/lib/te/trips-list'
import { plural, rs } from '@/lib/te/format'
import { routeText, tripDates } from '@/lib/te/entry-flow'
import TeIcon from '../TeIcon'

const SCOPE_WORD: Record<TripScope, string> = { local: 'Local', domestic: 'Domestic', international: 'International' }
const PATTERN_WORD: Record<string, string> = { oneway: 'One way', round: 'Round trip', multi: 'Multi-city' }
const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}

export default function TeTrips({ snap, onOpen, onNew }: {
  snap: Snapshot
  onOpen: (tripId: Uuid) => void
  onNew: (scope: TripScope) => void
}) {
  const [scope, setScope] = useState<TripScope | null>(null)
  const placeName = (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? ''
  const all = myTrips(snap.trips, snap.me, null)
  const shown = myTrips(snap.trips, snap.me, scope)
  const counts = scopeCounts(all)
  const groups = groupTrips(shown, snap.today)

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Trips</h1>
          <p>Every trip, local or abroad, holds its route, its legs with GPS and stops, and every bill you spent on it.</p>
        </div>
      </div>

      <div className="kinds compact" role="list">
        {(['local', 'domestic', 'international'] as const).map(k => (
          <button key={k} type="button" role="listitem" className={`kind k-${k}`} onClick={() => onNew(k)}>
            <span className="ki"><TeIcon name={k} size="lg" /></span>
            <span className="kt"><b>{SCOPE_WORD[k]} trip</b></span>
            <span className="kf"><span className="kg">New</span><TeIcon name="go" size="sm" /></span>
          </button>
        ))}
      </div>

      <div className="seg scopes" role="group" aria-label="Show trips">
        <button type="button" aria-pressed={scope === null} onClick={() => setScope(null)}>All <span className="muted">{counts.all}</span></button>
        {(['local', 'domestic', 'international'] as const).map(k => (
          <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}>
            {SCOPE_WORD[k]} <span className="muted">{counts[k]}</span>
          </button>
        ))}
      </div>

      {groups.length ? groups.map(g => (
        <div key={g.id} className="card pad0">
          <div className="day"><span>{g.title}</span><span>{g.trips.length}</span></div>
          {g.trips.map(t => (
            <TripRow key={t.id} trip={t} snap={snap} placeName={placeName} onOpen={onOpen} />
          ))}
        </div>
      )) : (
        <div className="card">
          <div className="empty">
            <b>{scope ? `No ${SCOPE_WORD[scope].toLowerCase()} trip yet` : 'No trips yet'}</b>
            Plan one above, and its legs, stops and bills all live inside it.
          </div>
        </div>
      )}
    </div>
  )
}

/** One trip in the list. Outside the parent, or it remounts on every filter change. */
function TripRow({ trip, snap, placeName, onOpen }: {
  trip: TeTrip
  snap: Snapshot
  placeName: (id: string) => string
  onOpen: (id: Uuid) => void
}) {
  const legs = snap.journeys.filter(j => j.tripId === trip.id)
  const chip = tripChip(trip)
  const money = tripMoney(trip, snap.claims, snap.expenses)
  // The rides to and from an airport are legs of the trip but not how you
  // travelled on it, so they are left out of the summary chips.
  const modes = [...new Set(legs.filter(l => l.kind !== 'first' && l.kind !== 'last').map(l => l.mode))]
  const km = Math.round(legs.filter(l => l.mode !== 'flight').reduce((a, l) => a + (l.plannedKm || 0), 0) * 10) / 10

  return (
    <div className="li click" role="button" tabIndex={0}
      onClick={() => onOpen(trip.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(trip.id) } }}
    >
      <span className={`ico sc-${trip.scope}`}><TeIcon name={trip.scope} /></span>
      <div className="grow">
        <div className="b">{trip.name || trip.to}</div>
        <div className="small muted">{routeText(trip, placeName)}</div>
        <div className="small muted">
          {tripDates(trip)} · {plural(legs.length, 'leg')}{km ? ` · ${km} km by road` : ''}
        </div>
        <div className="row tight">
          <span className={`chip plain sc sc-${trip.scope}`}><TeIcon name={trip.scope} size="sm" />{SCOPE_WORD[trip.scope]}</span>
          <span className="chip plain">{PATTERN_WORD[trip.pattern] ?? trip.pattern}</span>
          {trip.pax > 1 ? <span className="chip plain"><TeIcon name="people" size="sm" />{trip.pax} people</span> : null}
          {modes.map(m => (
            <span key={m} className="chip plain">
              <TeIcon name={MODE_ICON[m] ?? 'route'} size="sm" />{snap.cfg.modes.find(x => x.id === m)?.name ?? m}
            </span>
          ))}
          {trip.origin === 'POST_FACTO' ? <span className="chip plain t-warn">Recorded after travel</span> : null}
        </div>
      </div>
      <div className="amt">
        <b>{rs(money.value)}</b> <span className="small muted">{money.label}</span>
        <div><span className={`chip ${chip.tone}`}>{chip.label}</span></div>
      </div>
    </div>
  )
}
