'use client'
// components/te/leg/TeLiveBar.tsx — a leg is running while you are elsewhere.
// Screen e3.
//
// WHY IT EXISTS. The recorder only collects fixes while its screen is open, so
// wandering off to My claims mid-journey quietly stops the recording. The bar
// is the reminder: it sits on every other screen of the module while a leg is
// ACTIVE or PAUSED, and the fastest way back is one tap.
//
// It is a pointer, not a second recorder. It starts no watcher and sends
// nothing — two components collecting the same fixes would double the queue.
import type { TeLeg } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TeLiveBar({ leg, tripName, placeName, onOpen }: {
  leg: TeLeg
  tripName: string
  placeName: (id: string) => string
  onOpen: (leg: TeLeg) => void
}) {
  const state = leg.status === 'PAUSED' ? 'At a stop'
    : leg.gps === 'checkin' ? (leg.mode === 'flight' ? 'In flight' : 'On the way')
      : 'Travelling now'

  return (
    <div
      className="livebar"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(leg)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(leg) } }}
    >
      <span className="dotlive" aria-hidden />
      <div className="grow">
        <b>{state}</b>
        <span className="small"> {tripName} · journey {leg.n}: {placeName(leg.from)} → {placeName(leg.to)}</span>
      </div>
      {/* Said plainly: this bar is a pointer, and nothing is being collected
          while the recorder's own screen is closed. */}
      <span className="small">{leg.gps === 'checkin' ? 'Open' : 'Not recording here'}<TeIcon name="go" size="sm" /></span>
    </div>
  )
}
