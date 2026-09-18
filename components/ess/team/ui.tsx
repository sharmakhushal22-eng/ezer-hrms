// components/ess/team/ui.tsx — the small pieces the Team line is drawn from.
//
// These live outside the component body on purpose. In the old MyTeam, CardRow
// and Section were declared INSIDE the render function, so React saw a brand
// new component type on every render and remounted the whole subtree rather
// than updating it. Moving them out is the fix, and it is why they are here.

import { LINE_ICON } from './icons'

export const initials = (name: string | null | undefined) =>
  (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

/** A hue per person, stable across sessions and devices — nothing is fetched
 *  and nothing is stored, so the same name is the same colour everywhere.
 *  team.css turns it into a readable disc in both themes via --ez-avatar-sat
 *  and --ez-avatar-light, which already flip with the theme. */
export const hueOf = (name: string | null | undefined) => {
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export const Avatar = ({ name }: { name: string | null }) => (
  <span className="tm-av" aria-hidden="true" style={{ ['--tm-h' as string]: hueOf(name) }}>
    {initials(name)}
  </span>
)

/** One person on the line — a manager above, or a report branching below. */
export const LineNode = ({ name, sub, rank }: { name: string | null; sub: string | null; rank?: string }) => (
  <div className="tl-node">
    <Avatar name={name} />
    <span className="tm-txt">
      <span className="tm-nameline">
        {/* title, so a name the ellipsis truncates can still be read on hover */}
        <span className="tm-name" title={name || undefined}>{name || '—'}</span>
        {rank && <span className="tm-rank">{rank}</span>}
      </span>
      <span className="tm-sub" style={{ display: 'block' }}>{sub || '—'}</span>
    </span>
  </div>
)

/** Three skeleton rows, replacing the old literal word "Loading…". */
export const LineSkeleton = () => (
  <div className="tm-skel" aria-hidden="true">
    {[0, 1, 2, 3].map(i => (
      <div className="tm-skelrow" key={i}>
        <span className="tm-sk tm-sk--av" />
        <span style={{ flex: 1 }}>
          <span className="tm-sk tm-sk--a" style={{ display: 'block' }} />
          <span className="tm-sk tm-sk--b" style={{ display: 'block' }} />
        </span>
      </div>
    ))}
  </div>
)

export const YouDot = () => <span className="tl-youdot" aria-hidden="true">{LINE_ICON.self}</span>
