'use client'
// components/te/desk/TeDeskByTrip.tsx — the desk's work, one card per trip.
//
// WHAT IT IS FOR. The six rooms are worklists: every hotel to choose, every
// ticket to buy, every journey to agree, each flat across every trip. That is
// right for working a queue and wrong for the question a desk is asked twenty
// times a day — "where are we on TRP-2026-0004?" — which meant opening three
// rooms and reading past everybody else's trips in each one.
//
// So this is the same rows grouped by trip id. It takes nothing away: the rooms
// are still there, and this is the first tab rather than a replacement.
//
// IT MAPS THE WORK; IT DOES NOT DUPLICATE IT. Each line says what is
// outstanding and takes you to the room that does it. Rebuilding the booking
// form, the hotel picker and the journey review here would be a second copy of
// three screens that already exist — and a second place for them to drift.
//
// THE TRIP NUMBER OPENS THE TRIP, because the desk's own work is not the whole
// story: the full record has every bill, the stay, the advance and what the
// trip has cost. The desk screen stays about the desk's job and hides nothing.
import type { DeskBooked, DeskJourney, DeskStay, DeskToBook, DeskWatch } from '@/lib/te/client'
import { deskBuckets, type WorkKind } from '@/lib/te/desk-buckets'
import { plural } from '@/lib/te/format'
import TeIcon from '../TeIcon'

/** The icon each kind of work wears, matching the room tabs. */
const ICON: Record<WorkKind, string> = {
  stays: 'home', book: 'plane', booked: 'check', journeys: 'route', watch: 'people',
}

export default function TeDeskByTrip({ stays, toBook, booked, journeys, watch, onGoRoom, onOpenTrip }: {
  stays: DeskStay[]
  toBook: DeskToBook[]
  booked: DeskBooked[]
  journeys: DeskJourney[]
  watch: DeskWatch[]
  /** Take the desk to the room that does this work. */
  onGoRoom: (room: WorkKind) => void
  /** Open the whole trip: every bill, the stay, the advance, the total. */
  onOpenTrip?: (tripId: string) => void
}) {
  const buckets = deskBuckets({ stays, toBook, booked, journeys, watch })
  const needing = buckets.filter(b => b.todo > 0).length

  if (!buckets.length) {
    return (
      <div className="card">
        <div className="ch"><h3>By trip</h3></div>
        <p className="small muted">
          Nothing is with the desk. Hotels to choose, tickets to book and journeys to agree appear here under the trip
          they belong to, as they arrive.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="card pad0">
        <div className="day">
          <span>By trip</span>
          <span>{needing ? `${needing} of ${buckets.length} need you` : `${plural(buckets.length, 'trip')}`}</span>
        </div>
      </div>

      {buckets.map(b => (
        <div key={b.tripId} className={`card tripbucket${b.todo ? ' needs' : ''}`}>
          <div className="ch">
            <div>
              {/* The number is the trip's identity and the way into the whole
                  record — the same thing it is everywhere else in the module. */}
              {onOpenTrip ? (
                <button
                  type="button"
                  className="tripno"
                  onClick={() => onOpenTrip(b.tripId)}
                  title={`Open ${b.tripNo} — every bill, the stay, the advance and what it has cost`}
                >
                  {b.tripNo}
                </button>
              ) : <span className="mono">{b.tripNo}</span>}
              <div className="b">{b.tripName || 'A trip'}</div>
              <div className="small muted">
                {b.who || 'A traveller'}{b.empCode ? <> · <span className="mono">{b.empCode}</span></> : null}
              </div>
            </div>
            {b.todo
              ? <span className="chip t-warn">{b.todo} to do</span>
              : <span className="chip plain t-pos">Nothing waiting</span>}
          </div>

          {b.lines.map(l => (
            <button
              key={l.kind}
              type="button"
              className="li click"
              onClick={() => onGoRoom(l.kind)}
              title={`Open ${l.label}`}
            >
              <span className="ico"><TeIcon name={ICON[l.kind]} size="sm" /></span>
              <span className="grow">
                <span className="b">
                  {l.label}
                  {/* Work and record read differently: a count that needs
                      somebody is not the same fact as a count that is done. */}
                  {l.todo ? <span className="chip t-warn">{l.n}</span> : <span className="chip plain">{l.n}</span>}
                </span>
                <span className="small muted">{l.detail}</span>
              </span>
              <TeIcon name="go" size="sm" />
            </button>
          ))}
        </div>
      ))}
    </>
  )
}
