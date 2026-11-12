// components/learning/showcase/icons.tsx — the few icons the hover card and billboard need that
// glyphs.tsx does not have. Same construction: a 20 by 20 box, 1.6 stroke, currentColor.
import type { ReactNode } from 'react'

function G({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  )
}

export const SPlus = ({ size }: { size?: number }) => <G size={size}><path d="M10 4.5v11M4.5 10h11" /></G>
export const SCheck = ({ size }: { size?: number }) => <G size={size}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></G>
export const SDown = ({ size }: { size?: number }) => <G size={size}><path d="m5 8 5 5 5-5" /></G>
export const SInfo = ({ size }: { size?: number }) => <G size={size}><circle cx="10" cy="10" r="7" /><path d="M10 9.2v4.6M10 6.4v.1" /></G>
/** Previews switched off: a play mark crossed through. */
export const SNoAuto = ({ size }: { size?: number }) => <G size={size}><path d="M7 5.5v9l7-4.5-7-4.5Z" /><path d="m3.5 3.5 13 13" /></G>
