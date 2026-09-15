// components/ess/team/icons.tsx — the Team section's inline icons.
//
// Inline SVG rather than the emoji the old screen used (🧭 👥 🤝). Two reasons,
// both learned the hard way in the Inbox and HRIS redesigns:
//
//   1. `stroke="currentColor"` means an icon takes the colour of its state, so
//      an empty panel's muted tile and a lead panel's brand tile need no second
//      asset. Emoji cannot do that — they carry their own colour.
//
//   2. EVERY ICON CARRIES AN EXPLICIT width AND height. An <svg> with only a
//      viewBox has no intrinsic size and falls back to 300x150 the moment no
//      CSS rule matches it — which is exactly what produced the giant distorted
//      pin in HRIS. The attributes make the element correct on its own.
//
// Tailwind's preflight also sets `svg { display: block }` globally; team.css
// puts these inside a flex tile, so that rule cannot stack an icon above its
// label the way it did to the HRIS tag pills.

export const LINE_ICON = {
  /** The "where you sit" spine — a filled node with the line running through it. */
  line: (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.6v14.8" />
      <circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none" />
      <path d="M6.6 6 10 2.6 13.4 6M6.6 14 10 17.4 13.4 14" />
    </svg>
  ),
  /** The YOU node. */
  self: (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="6.8" r="2.7" />
      <path d="M4.6 16.4c0-2.9 2.4-4.6 5.4-4.6s5.4 1.7 5.4 4.6" />
    </svg>
  ),
}

/** The roster panel and its empty state. */
export const ROSTER_ICON = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
    <path d="M2.5 8h15M7.5 8v8.5" />
  </svg>
)
