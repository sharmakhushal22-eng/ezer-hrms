'use client'
// components/te/trip/TePickTrip.tsx — screen 07, "Start an approved trip: choose
// the trip". Step 3 of the entry flow when the way chosen was "approved".
//
// Markup is the prototype's dlgFlow(kind, 'approved') (ui-09). Everything shown
// is read from the snapshot already in TeHome; this screen makes no call of its
// own, and decides nothing: whether a trip may be started is `trip.display`,
// which the server computed.
import { approvedTrips, currentLeg, legsOf, routeText, tripDates, KIND_NAME } from '@/lib/te/entry-flow'
import { day, plural } from '@/lib/te/format'
import type { TeLeg, TeTrip, TripScope, Uuid } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TePickTrip({ scope, me, trips, journeys, today, placeName, onStartLeg, onOpenTrip }: {
  scope: TripScope
  me: Uuid
  trips: TeTrip[]
  journeys: TeLeg[]
  today: string
  placeName: (id: Uuid) => string
  onStartLeg: (legId: Uuid, leg: TeLeg) => void
  onOpenTrip: (tripId: Uuid) => void
}) {
  const list = approvedTrips(scope, { me, trips })

  return (
    <div className="sec">
      <h4>Approved {KIND_NAME[scope].toLowerCase()}s</h4>
      <div className="stack sm">
        <div className="card pad0">
          {list.length ? list.map(t => {
            const legs = legsOf(t, journeys)
            const next = currentLeg(legs)
            // A leg can start on its date, not before. The date is the trip's plan;
            // the server refuses an early start either way.
            const canStart = !!next && next.status === 'PLANNED' && next.date <= today
            return (
              <div key={t.id} className="li">
                <span className={`ico k-${scope}`}><TeIcon name={scope} /></span>
                <div className="grow">
                  <div className="b">{t.name}</div>
                  <div className="small muted">{routeText(t, placeName)}</div>
                  <div className="small muted">
                    {tripDates(t)} · {plural(legs.length, 'leg')}
                    {next ? ` · next: leg ${next.n}, ${day(next.date)}` : ''}
                  </div>
                </div>
                <div className="row tight">
                  {canStart && next ? (
                    <button type="button" className="btn pri sm" onClick={() => onStartLeg(next.id, next)}>
                      <TeIcon name="play" size="sm" />
                      {next.gps === 'checkin' ? 'Check in' : `Start leg ${next.n}`}
                    </button>
                  ) : null}
                  <button type="button" className="btn sm" onClick={() => onOpenTrip(t.id)}>Open</button>
                </div>
              </div>
            )
          }) : (
            <div className="li"><span className="muted small">No approved {KIND_NAME[scope].toLowerCase()} right now.</span></div>
          )}
        </div>
        <p className="small muted">A leg can start on its date. Before that, open the trip to see its legs and bookings.</p>
      </div>
    </div>
  )
}
