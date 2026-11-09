'use client'
// components/learning/motion/Aurora.tsx — the slow light behind EZER Learn's dark banners: three
// soft glows that drift, and a few specks that rise through them. Pure decoration, hidden from
// screen readers, drawn behind the banner's content.
//
// The glows are radial gradients moved with transform, never blurred, so the browser moves them
// without repainting. Everything stops while the banner is off screen, and nothing drifts for
// anyone who has asked for less motion (motion.css).
import { useRef, type CSSProperties } from 'react'
import { useInView } from './useInView'

// Fixed positions rather than random ones, so the server and the browser draw the same thing.
const SPECKS = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  dur: 13 + ((i * 7) % 11),
  delay: -((i * 5.3) % 19),
  size: 0.6 + ((i * 13) % 9) / 10,
  shape: i % 3,
}))

export function Aurora({ specks = 12 }: { specks?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  return (
    <div ref={ref} className="lx-aurora" data-run={on ? '1' : '0'} aria-hidden>
      <i className="lx-au-1" /><i className="lx-au-2" /><i className="lx-au-3" />
      {SPECKS.slice(0, specks).map((s, i) => (
        <b key={i} data-k={s.shape} style={{ '--x': `${s.x}%`, '--d': `${s.dur}s`, '--dl': `${s.delay}s`, '--s': s.size } as CSSProperties} />
      ))}
    </div>
  )
}
