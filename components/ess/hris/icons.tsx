// Glyphs for the HRIS redesign. One 20×20 grid, stroked in currentColor, so a
// glyph takes the colour of whatever state it sits in. Ported from the handover
// package's ICON map.
import type { CSSProperties } from 'react'

const PATHS: Record<string, React.ReactNode> = {
  user: <><circle cx="10" cy="6.5" r="3.2" /><path d="M4 16c0-3.3 2.7-5 6-5s6 1.7 6 5" /></>,
  users: <><circle cx="7.5" cy="7" r="2.6" /><path d="M2.5 15.5c0-2.6 2.2-4 5-4s5 1.4 5 4" /><path d="M13 5.2a2.5 2.5 0 0 1 0 4.9M14 12c1.9.3 3.5 1.5 3.5 3.5" /></>,
  mail: <><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="m3 5.5 7 5 7-5" /></>,
  phone: <path d="M4 3.5h3l1.5 4-2 1.3a10 10 0 0 0 4.7 4.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A14 14 0 0 1 2.5 5.1 1.5 1.5 0 0 1 4 3.5Z" />,
  chat: <path d="M3 4.5h14v9H8l-3.5 3v-3H3Z" />,
  check: <path d="m4 10 4 4 8-9" />,
  x: <path d="m5 5 10 10M15 5 5 15" />,
  clock: <><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.3l3 1.7" /></>,
  doc: <><path d="M5.5 2.8h6L15 6.4v10.8H5.5Z" /><path d="M11 2.8v4h4" /></>,
  cash: <><rect x="2.5" y="5" width="15" height="10" rx="2" /><circle cx="10" cy="10" r="2.2" /></>,
  door: <><path d="M11 3H5v14h6M11 3l4 1v12l-4 1M11 3v15" /><circle cx="9.3" cy="10" r=".6" fill="currentColor" stroke="none" /></>,
  shield: <path d="M10 2.5 4 4.6v4.2c0 3.7 2.5 6.6 6 8.2 3.5-1.6 6-4.5 6-8.2V4.6Z" />,
  heart: <path d="M10 16S3.5 12 3.5 7.6A3.1 3.1 0 0 1 10 6a3.1 3.1 0 0 1 6.5 1.6C16.5 12 10 16 10 16Z" />,
  ring: <><circle cx="10" cy="12" r="4.2" /><path d="m7.8 8 1.2-3h2l1.2 3" /></>,
  sos: <><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.5M10 13.4h.01" /></>,
  plane: <path d="M10 2.5c.7 0 1 1 1 2.4v2.7l5 3v1.6l-5-1.4v3l1.6 1.2v1.2L10 15.8l-2.6.6v-1.2L9 14v-3l-5 1.4V10.6l5-3V4.9c0-1.4.3-2.4 1-2.4Z" />,
  info: <><circle cx="10" cy="10" r="7.5" /><path d="M10 9v4.5M10 6.5h.01" /></>,
  search: <><circle cx="9" cy="9" r="6" /><path d="m14 14 3.5 3.5" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  pin: <><path d="M10 17.5s5-4.6 5-8.2a5 5 0 0 0-10 0c0 3.6 5 8.2 5 8.2Z" /><circle cx="10" cy="9" r="1.8" /></>,
}

export type IconKey = keyof typeof PATHS

/**
 * `width`/`height` are set on the element on purpose.
 *
 * An <svg> carrying only a viewBox has no intrinsic size, so the moment no CSS
 * rule matches it the browser falls back to the replaced-element default of
 * 300x150 — which is how a location pin ended up the size of the card it was
 * labelling. They are presentation attributes, the weakest thing in the
 * cascade, so every `.hx-* svg { width: … }` rule still wins; they only decide
 * what happens when nothing else does.
 */
export function Ic({ k, sw = 1.7, style, className }: {
  k: IconKey; sw?: number; style?: CSSProperties; className?: string
}) {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      {PATHS[k]}
    </svg>
  )
}
