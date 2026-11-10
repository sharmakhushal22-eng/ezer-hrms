// components/learning/room/icons.tsx — the few icons only the webinar room needs. Same
// construction as ../glyphs.tsx: a 20 by 20 box, 1.6 stroke, round ends, currentColor.
import type { ReactNode } from 'react'

type P = { size?: number }

function G({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  )
}

export const RSend = ({ size }: P) => <G size={size}><path d="M3.2 10 16.8 3.5l-3.7 13-3.4-5.3L3.2 10Z" /><path d="m9.7 11.2 7.1-7.7" /></G>
export const RUp = ({ size }: P) => <G size={size}><path d="m5 11.5 5-5.5 5 5.5" /></G>
export const RPin = ({ size }: P) => <G size={size}><path d="M7.5 3h5l-.8 4.2 2.8 2.8v1.5h-9V10l2.8-2.8L7.5 3Z" /><path d="M10 11.5V17" /></G>
export const RHide = ({ size }: P) => <G size={size}><path d="M3 10s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5Z" /><path d="M3.5 3.5l13 13" /></G>
export const RChat = ({ size }: P) => <G size={size}><path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" /></G>
export const RAsk = ({ size }: P) => <G size={size}><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5" /><path d="M10 14.2v.1" /></G>
export const RPoll = ({ size }: P) => <G size={size}><path d="M4 16.5V10M8.7 16.5V4M13.3 16.5V8M17 16.5H3" /></G>
export const RCheck = ({ size }: P) => <G size={size}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></G>
export const RStop = ({ size }: P) => <G size={size}><rect x="5" y="5" width="10" height="10" rx="2" /></G>
