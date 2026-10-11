// lib/te/trip-map.ts — where to draw a trip's places and legs on a flat panel.
//
// Ported from the prototype's tripMap (design/prototype/source/ui-04-trips.js).
// Pure geometry: latitudes and longitudes in, pixel paths out. The component
// (components/te/plan/TeTripMap.tsx) only turns the result into SVG elements, so
// everything worth checking is checked here rather than by eye.
//
// THIS IS NOT A MAP SERVICE. There is no tile, no road and no geocoding: it is a
// schematic of where the places sit relative to each other, which is all the plan
// screen claims to show. The prototype draws recorded GPS on the same panel; that
// belongs to leg recording (build step 6) and is deliberately not here yet.
//
// The projection is equirectangular with the longitude axis squeezed by
// cos(latitude) at the middle of the trip. Over one trip's span that is accurate
// enough to be honest and keeps the arithmetic inspectable.
import type { TripScope } from './types.ts'

export interface MapPlace { id: string; s: string; lat: number; lng: number }
export interface MapLeg { from: string; to: string; mode: string }

export interface MapMark {
  x: number
  y: number
  letter: string
  /** '' when a nearer pin already carries this one's name. */
  label: string
  /** Where the label starts, and which side of the pin it runs to. */
  labelX: number
  labelAnchor: 'start' | 'end'
}
export interface TripMapGeometry {
  width: number
  height: number
  /** SVG path data for the faint background grid. */
  grid: string
  /** Legs travelled on the ground, drawn as a dotted line. */
  plan: string
  /** Flights, drawn as a bowed dashed arc so they read as not-a-road. */
  flights: string
  marks: MapMark[]
  /** The scale bar: a rule `px` long means `km` on the ground. */
  scale: { px: number; km: number }
}

/** Kilometres per degree of latitude. Longitude shrinks by cos(lat). */
const KM_PER_DEG = 111
const GRID_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]
/** Pins closer together than this share one label. */
const LABEL_MERGE_PX = 18
/** A pin within this of the right edge hangs its label to the left instead. */
const LABEL_FLIP_PX = 150

/** A flight bows away from the straight line, the way a route map draws one.
 *  A quadratic Bézier whose control point is pushed off the midpoint. */
export function arcPoints(a: { lat: number; lng: number }, b: { lat: number; lng: number }, steps = 28): { lat: number; lng: number }[] {
  const dLa = b.lat - a.lat
  const dLn = b.lng - a.lng
  const c = { lat: (a.lat + b.lat) / 2 - dLn * 0.18, lng: (a.lng + b.lng) / 2 + dLa * 0.18 }
  const out: { lat: number; lng: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const v = 1 - u
    out.push({
      lat: v * v * a.lat + 2 * v * u * c.lat + u * u * b.lat,
      lng: v * v * a.lng + 2 * v * u * c.lng + u * u * b.lng,
    })
  }
  return out
}

/** Null when there is nothing to draw: no place has a location yet. */
export function tripMapGeometry(o: {
  legs: MapLeg[]
  /** The trip's points, in order. These get the lettered pins. */
  points: string[]
  places: Map<string, MapPlace>
  width?: number
  height?: number
}): TripMapGeometry | null {
  const W = o.width ?? 640
  const H = o.height ?? 220
  const at = (id: string) => {
    const p = o.places.get(id)
    // A place with no location cannot be placed. 0,0 is the Atlantic, not a default.
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat !== 0 || p.lng !== 0) ? p : null
  }

  const drawn = o.legs
    .map(l => {
      const a = at(l.from)
      const b = at(l.to)
      if (!a || !b || l.from === l.to) return null
      const flight = l.mode === 'flight'
      // No road geometry exists when a trip is still a plan — the server returns
      // the distance, not a shape — so a ground leg is the straight line.
      return { flight, route: flight ? arcPoints(a, b) : [a, b] }
    })
    .filter((x): x is { flight: boolean; route: { lat: number; lng: number }[] } => x !== null)

  const pins = o.points.map(at).filter((p): p is MapPlace => p !== null)
  const all = [...drawn.flatMap(g => g.route), ...pins]
  if (!all.length) return null

  const la0 = Math.min(...all.map(p => p.lat))
  const la1 = Math.max(...all.map(p => p.lat))
  const ln0 = Math.min(...all.map(p => p.lng))
  const ln1 = Math.max(...all.map(p => p.lng))
  const mid = (la0 + la1) / 2
  const cx = (ln0 + ln1) / 2
  const kx = KM_PER_DEG * Math.cos((mid * Math.PI) / 180)
  // A floor of 3 km stops a single place, or two in the same compound, from
  // being magnified until the grid is meaningless.
  const wk = Math.max(3, (ln1 - ln0) * kx)
  const hk = Math.max(3, (la1 - la0) * KM_PER_DEG)
  const sc = Math.min(W / (wk * 1.3), H / (hk * 1.45))

  const X = (p: { lng: number }) => W / 2 + (p.lng - cx) * kx * sc
  const Y = (p: { lat: number }) => H / 2 - (p.lat - mid) * KM_PER_DEG * sc
  const r1 = (n: number) => Math.round(n * 10) / 10
  const path = (ps: { lat: number; lng: number }[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${r1(X(p))} ${r1(Y(p))}`).join('')

  // A grid square is a round number of kilometres, chosen so about six fit across.
  const span = W / sc
  const km = GRID_STEPS.find(v => v * 6 > span) ?? 1000
  const step = km * sc
  let grid = ''
  for (let x = (W / 2) % step; x < W; x += step) grid += `M${r1(x)} 0V${H}`
  for (let y = (H / 2) % step; y < H; y += step) grid += `M0 ${r1(y)}H${W}`

  // One pin per distinct place, lettered in the order the trip reaches them, so
  // a return to where you started reuses its own letter rather than adding one.
  const uniq = pins.filter((p, i) => pins.findIndex(q => q.id === p.id) === i)
  const apart = (a: MapPlace, b: MapPlace) => Math.hypot(X(a) - X(b), Y(a) - Y(b))
  const marks: MapMark[] = uniq.map((p, i) => {
    const x = X(p)
    // Two places in the same compound overlap on the panel. The first of them
    // carries both names; the ones behind it carry none, rather than printing
    // two labels on top of each other.
    const hidden = uniq.slice(0, i).some(q => apart(p, q) < LABEL_MERGE_PX)
    const label = hidden ? '' : [p.s, ...uniq.slice(i + 1).filter(q => apart(p, q) < LABEL_MERGE_PX).map(q => q.s)].join(' · ')
    // Near the right edge the label would run off, so it hangs to the left.
    const toEnd = x > W - LABEL_FLIP_PX
    return {
      x: r1(x),
      y: r1(Y(p)),
      letter: String.fromCharCode(65 + i),
      label,
      labelX: r1(x + (toEnd ? -15 : 15)),
      labelAnchor: toEnd ? 'end' : 'start',
    }
  })

  return {
    width: W,
    height: H,
    grid,
    plan: drawn.filter(g => !g.flight).map(g => path(g.route)).join(''),
    flights: drawn.filter(g => g.flight).map(g => path(g.route)).join(''),
    marks,
    scale: { px: r1(step), km },
  }
}

/** The panel is shorter on a phone, and a local trip needs less of it. */
export function mapHeight(scope: TripScope, narrow: boolean): number {
  if (narrow) return 150
  return scope === 'local' ? 180 : 220
}
