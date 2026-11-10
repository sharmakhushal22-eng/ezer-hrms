// components/learning/game/icons.tsx — the badge and streak icons. Same construction as
// ../glyphs.tsx (a 20 by 20 box, 1.6 stroke, round ends, currentColor), kept here so the points
// feature stays in one folder.
import type { ReactNode } from 'react'

function G({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {children}
    </svg>
  )
}

const PATHS: Record<string, ReactNode> = {
  flame: <path d="M10 17.5c3 0 5.2-2.1 5.2-5 0-3.6-3.2-5.3-3.9-9-1.8 1.4-2.6 3.3-2.6 5.2-1-.6-1.6-1.7-1.8-2.8C5.3 7.6 4.8 9.5 4.8 12.5c0 2.9 2.2 5 5.2 5Z" />,
  step: <><path d="M6.5 13.5c-1.6 0-2.5-1.3-2.5-3.2 0-2.3 1.2-4.8 2.8-4.8 1.3 0 1.9 1.6 1.7 3.5-.2 2.4-.4 4.5-2 4.5Z" /><path d="M13.5 17c-1.6 0-2-1.8-1.8-3.6.2-2.2.9-4.4 2.5-4.4 1.4 0 2 1.7 1.8 3.5-.2 2.3-.9 4.5-2.5 4.5Z" /></>,
  cap: <><path d="m10 4 8 3.8-8 3.8-8-3.8L10 4Z" /><path d="M5.5 9.6v3.6c1.4 1.3 2.9 1.9 4.5 1.9s3.1-.6 4.5-1.9V9.6M18 7.8v4.4" /></>,
  five: <><circle cx="10" cy="10" r="7" /><text x="10" y="13.4" fontSize="9" fontWeight="800" textAnchor="middle" fill="currentColor" stroke="none">5</text></>,
  ten: <><circle cx="10" cy="10" r="7" /><text x="10" y="13" fontSize="7.6" fontWeight="800" textAnchor="middle" fill="currentColor" stroke="none">10</text></>,
  crown: <><path d="m3 7 3.5 3L10 4.5 13.5 10 17 7l-1.5 8h-11L3 7Z" /><path d="M4.5 17.5h11" /></>,
  target: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="4" /><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" /></>,
  bolt: <path d="M11 2.5 4.5 11.2h5L8.8 17.5l6.7-8.7h-5L11 2.5Z" />,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4.3l2.8 1.7" /></>,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.8v1.6M10 15.6v1.6M17.2 10h-1.6M4.4 10H2.8M15.1 4.9 14 6M6 14l-1.1 1.1M15.1 15.1 14 14M6 6 4.9 4.9" /></>,
  moon: <path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4Z" />,
  live: <><circle cx="10" cy="10" r="2" /><path d="M6.4 6.4a5 5 0 0 0 0 7.2M13.6 6.4a5 5 0 0 1 0 7.2M4 4a8.5 8.5 0 0 0 0 12M16 4a8.5 8.5 0 0 1 0 12" /></>,
  path: <><path d="m10 2.8 7.2 3.7L10 10.2 2.8 6.5 10 2.8Z" /><path d="m2.8 10 7.2 3.7 7.2-3.7M2.8 13.5l7.2 3.7 7.2-3.7" /></>,
  compass: <><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4 4-1.6Z" /></>,
  star: <path d="m10 3 2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6L10 3Z" />,
  trophy: <><path d="M6.5 3.5h7v4.2a3.5 3.5 0 0 1-7 0V3.5Z" /><path d="M6.5 5H4a2.4 2.4 0 0 0 2.6 3M13.5 5H16a2.4 2.4 0 0 1-2.6 3M10 11.2V14M7 16.5h6M8 14h4v2.5H8z" /></>,
  check: <path d="m5 10.5 3.2 3.2L15 6.8" />,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1.8" /><path d="M7 9V6.8a3 3 0 0 1 6 0V9" /></>,
}

/** A badge or streak icon by name; unknown names get the trophy. */
export function GameIcon({ name, size }: { name: string; size?: number }) {
  return <G size={size}>{PATHS[name] || PATHS.trophy}</G>
}
