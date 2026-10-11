'use client'
// components/te/plan/TePinMap.tsx — put a pin where the address actually is.
// Screen 14.
//
// WHY THIS EXISTS. With no geocoding provider configured (lib/te/providers/
// geocode.ts says so in its header), a typed address arrives at the server with
// no position at all. The claim's distance is measured to this point, so an
// address with no pin — or a pin in the wrong part of the city — is a money
// error. Dropping it by hand is not a nicety here; it is the only mechanism.
//
// The arithmetic is lib/te/trip-map.ts and is tested, including the property
// everything rests on: tapping where the pin is drawn gives back that pin.
import { useRef } from 'react'
import { nudgePin, pinToPixel, pixelToPin, zoomPin, type PinView } from '@/lib/te/trip-map'
import TeIcon from '../TeIcon'

const W = 640
const H = 220

export default function TePinMap({ pin, view, onPin, onView }: {
  pin: { lat: number; lng: number } | null
  view: PinView
  onPin: (p: { lat: number; lng: number }) => void
  onView: (v: PinView) => void
}) {
  const ref = useRef<SVGSVGElement | null>(null)
  const at = pin ? pinToPixel(pin, view, W, H) : null

  /** A tap anywhere on the panel moves the pin there. */
  function tap(e: React.MouseEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    // The panel is drawn at a fixed viewBox and scaled by CSS, so the click has
    // to be converted back into viewBox units before it means anything.
    const x = ((e.clientX - box.left) / box.width) * W
    const y = ((e.clientY - box.top) / box.height) * H
    onPin(pixelToPin(x, y, view, W, H))
  }

  // A grid that is honest about having no map behind it: squares of a known
  // size, so the person can judge distance even with no streets to go by.
  const step = W / 8
  let grid = ''
  for (let x = step; x < W; x += step) grid += `M${x} 0V${H}`
  for (let y = step; y < H; y += step) grid += `M0 ${y}H${W}`

  return (
    <div>
      <div className="pinmap" title="Tap to move the pin">
        <svg ref={ref} className="jmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Place the pin on the map" onClick={tap}>
          <rect width={W} height={H} fill="var(--ez-sunken)" />
          <path d={grid} stroke="var(--ez-line)" strokeWidth="1" fill="none" opacity=".6" />
          {at ? (
            <>
              <circle cx={at.x} cy={at.y} r="16" fill="var(--ez-brand)" opacity=".18" />
              <circle cx={at.x} cy={at.y} r="7" fill="var(--ez-brand)" stroke="var(--ez-surface)" strokeWidth="2.5" />
            </>
          ) : (
            <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--ez-muted)" fontSize="13">Tap where the place is</text>
          )}
          <path d={`M16 ${H - 16}h${W / 8}`} stroke="var(--ez-ink-soft)" strokeWidth="2" />
          <text x={16 + W / 8 + 6} y={H - 12} fill="var(--ez-ink-soft)" fontSize="11">{Math.round((view.span / 8) * 10) / 10} km</text>
        </svg>
      </div>

      <div className="row sp small">
        <span className="muted grow">Tap the map or use the arrows to move the pin.</span>
        <span className="row tight">
          <span className="nudge" role="group" aria-label="Move the pin">
            {(['n', 'w', 's', 'e'] as const).map(d => (
              <button
                key={d}
                type="button"
                className="btn sm"
                disabled={!pin}
                aria-label={{ n: 'Move north', s: 'Move south', e: 'Move east', w: 'Move west' }[d]}
                onClick={() => pin && onPin(nudgePin(pin, d, view))}
              >
                {{ n: '↑', w: '←', s: '↓', e: '→' }[d]}
              </button>
            ))}
          </span>
          <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => onView(zoomPin(view, 'in'))}><TeIcon name="plus" size="sm" /></button>
          <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => onView(zoomPin(view, 'out'))}><TeIcon name="minus" size="sm" /></button>
        </span>
      </div>

      {pin ? (
        <div className="flag ok">
          <TeIcon name="check" />
          <div className="tx">
            <b>Pin at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</b>
            <p>The route and the distance are measured to this point.</p>
          </div>
        </div>
      ) : (
        <div className="flag warn">
          <TeIcon name="alert" />
          <div className="tx">
            <b>This address has no position yet</b>
            <p>Tap the exact spot on the map. Without it the distance to this place cannot be measured.</p>
          </div>
        </div>
      )}
    </div>
  )
}
