'use client'
// components/te/plan/TeMapLinks.tsx — open this route in a real map.
//
// The panel above these buttons is a schematic. It draws the route to scale
// and it is useful for seeing the shape of a trip, but it is not a map: there
// are no roads on it, no traffic and no "where am I now". A real one needs a
// Google Maps key, which this deployment does not have.
//
// These need no key. They hand the route to the map application the person
// already has, which is the better answer anyway once somebody is standing
// outside a station with a bag: their own app has their location, their
// traffic and their offline tiles.
//
// BOTH ARE OFFERED RATHER THAN A SETTING. Which map someone wants depends on
// the phone in their hand, not on a preference they set once in a web form,
// and the two buttons cost less room than the row of settings it would take to
// choose between them.
//
// WHAT APPLE CANNOT DO IS SAID OUT LOUD. Apple's URL scheme has no waypoints,
// so a trip with stops in the middle opens as start → destination only. The
// note under the buttons says so whenever that is true. Quietly handing
// somebody a shorter route than the one they planned would be worse than not
// offering the button.
import { mapLinksNote, routeLinks, type MapPoint } from '@/lib/te/map-links'
import type { TripScope } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TeMapLinks({ points, scope, label }: {
  /** The trip's points in order. Unplaced ones are ignored. */
  points: (MapPoint | null | undefined)[]
  scope?: TripScope
  /** What to call the thing being opened, for the screen reader. */
  label?: string
}) {
  const { google, apple, stops, appleShort } = routeLinks(points, scope)
  // Nothing on this trip has coordinates yet. Two dead buttons would be worse
  // than none: the planner fills them in as places are chosen.
  if (!google && !apple) return null

  const note = mapLinksNote(stops, appleShort)
  const what = label || 'this trip'

  return (
    <div className="maplinks">
      <div className="row tight">
        {google ? (
          <a className="btn sm" href={google} target="_blank" rel="noopener noreferrer"
            aria-label={`Open ${what} in Google Maps`}>
            <TeIcon name="pin" size="sm" />Open in Google Maps
          </a>
        ) : null}
        {apple ? (
          <a className="btn sm" href={apple} target="_blank" rel="noopener noreferrer"
            aria-label={`Open ${what} in Apple Maps`}>
            <TeIcon name="compass" size="sm" />Open in Apple Maps
          </a>
        ) : null}
      </div>
      {note ? <small className="muted">{note}</small> : null}
    </div>
  )
}
