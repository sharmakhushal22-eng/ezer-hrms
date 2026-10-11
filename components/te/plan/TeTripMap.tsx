'use client'
// components/te/plan/TeTripMap.tsx — the trip drawn as a schematic.
//
// All the arithmetic is lib/te/trip-map.ts, which is tested; this file only
// turns the result into SVG. The shapes, widths, dash patterns and colours are
// the prototype's tripMap (ui-04-trips.js), kept as they were.
//
// Every colour is a token in an SVG attribute, not a hex literal, so the panel
// follows the theme the way the rest of the module does.
import { tripMapGeometry, type MapLeg, type MapPlace } from '@/lib/te/trip-map'

export default function TeTripMap({ legs, points, places, height, label }: {
  legs: MapLeg[]
  /** The trip's points in order; these get the lettered pins. */
  points: string[]
  places: Map<string, MapPlace>
  height?: number
  label?: string
}) {
  const g = tripMapGeometry({ legs, points, places, height })
  // No place has a location yet — an empty grey panel would say nothing.
  if (!g) return null

  return (
    <svg className="jmap" viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={label || 'Map of the trip'}>
      <rect width={g.width} height={g.height} fill="var(--ez-sunken)" />
      <path d={g.grid} stroke="var(--ez-line)" strokeWidth="1" fill="none" opacity=".6" />
      {/* A planned road leg is dotted: it is an intention, not a recorded track. */}
      {g.plan ? <path d={g.plan} stroke="var(--ez-brand)" strokeOpacity=".4" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 9" fill="none" /> : null}
      {g.flights ? <path d={g.flights} stroke="var(--ez-ink-soft)" strokeOpacity=".75" strokeWidth="2" strokeDasharray="7 6" fill="none" /> : null}

      {g.marks.map(m => (
        <g key={m.letter}>
          {/* Where the trip begins is green; everywhere else is ink. */}
          <circle cx={m.x} cy={m.y} r="10" fill={m.letter === 'A' ? 'var(--ez-positive)' : 'var(--ez-ink)'} stroke="var(--ez-surface)" strokeWidth="2.5" />
          <text x={m.x} y={m.y + 4} textAnchor="middle" fill="var(--ez-surface)" fontSize="11" fontWeight="700">{m.letter}</text>
          {/* paint-order puts the halo behind the glyphs, so a name stays
              readable where it crosses a route line. */}
          {m.label ? (
            <text x={m.labelX} y={m.y + 4} textAnchor={m.labelAnchor} fill="var(--ez-ink-soft)" stroke="var(--ez-sunken)" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="700">{m.label}</text>
          ) : null}
        </g>
      ))}

      <path d={`M16 ${g.height - 16}h${g.scale.px}`} stroke="var(--ez-ink-soft)" strokeWidth="2" />
      <text x={16 + g.scale.px + 6} y={g.height - 12} fill="var(--ez-ink-soft)" fontSize="11">{g.scale.km} km</text>
    </svg>
  )
}
