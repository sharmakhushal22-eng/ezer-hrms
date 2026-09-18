'use client'
// components/wall/Spotlight.tsx — the winner, the podium, and the people who left.
//
// v8 REDESIGN. The Spotlight is now the page's opening moment: a framed
// portrait card with the award above the name and the citation set large.
// The leaderboard opens with a 2·1·3 podium built as ONE PLINTH — the steps
// butt against each other, the seam between them is a line rather than a gap,
// one ground strip runs under all of them, and each person stands in contact
// with their own block. Then every remaining row carries its count as a bar
// relative to #1, so the gap reads at a glance. The hall of legends is a
// compact roll.
//
// THE PODIUM IS ADAPTIVE. Three names build a three-step plinth, two build a
// two-step one. A step is never drawn empty: the shape follows the number of
// people standing on it, so a young board looks deliberate rather than broken.
// One name is not a podium at all — it stays a row.
//
// GOLD APPEARS IN EXACTLY THREE PLACES IN THIS MODULE, and two of them are
// here: the Spotlight winner's frame, and the #1 row on the podium. The third
// is the award ribbon on the digital board. Nowhere else. Ranks 2 and 3 are
// not gold, and their bars are brand blue.
//
// GOLD IS THEME-AWARE. The palette is CSS custom properties declared for all
// three theme states, and every piece of text on a gold surface takes its
// colour from --g-text so ground and ink move together.
//
// THE HALL OF LEGENDS KEEPS PEOPLE WHO HAVE LEFT. The Spotlight does not.
//
// Props and exported types are unchanged from v7.

import { useEffect, useState } from 'react'
import { C, F, W, S } from '@/lib/ui'
import { Avatar, Empty, Icon, RAD, shortDate } from '@/components/wall/ui'

const GOLD_CSS = `
  .wof-gold{
    --g-wash: #FEF3C7;
    --g-ink:  #B45309;
    --g-text: #3A2A08;
    --g-edge: #F5C86B;
    --g-soft: #6B4E12;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-ez-theme="light"]) .wof-gold{
      --g-wash: #3A2A08;
      --g-ink:  #FCD34D;
      --g-text: #FDF3D6;
      --g-edge: #7A5A18;
      --g-soft: #E4CE96;
    }
  }
  :root[data-ez-theme="dark"] .wof-gold{
    --g-wash: #3A2A08;
    --g-ink:  #FCD34D;
    --g-text: #FDF3D6;
    --g-edge: #7A5A18;
    --g-soft: #E4CE96;
  }
`
const GOLD = {
  ink: 'var(--g-ink)', wash: 'var(--g-wash)', edge: 'var(--g-edge)',
  text: 'var(--g-text)', soft: 'var(--g-soft)',
}

export interface Winner {
  id: string
  name: string
  designation?: string | null
  awardName?: string | null
  cycleLabel?: string | null
  message?: string | null
  publishedAt?: string | null
  hasLeft?: boolean
}

export interface LeaderRow {
  employeeId: string
  name: string
  designation?: string | null
  recognitionCount: number
  points?: number | null
}

// ── module scope ─────────────────────────────────────────────────────────

function useCalm(): boolean {
  const [calm, setCalm] = useState(true)
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setCalm(q.matches)
    on(); q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return calm
}

/** The winner. The only card in the module that gets a gold frame. */
function WinnerCard({ w, calm }: { w: Winner; calm: boolean }) {
  const when = shortDate(w.publishedAt)
  return (
    <div className="wof-spot wof-gold" style={{
      position: 'relative', overflow: 'hidden',
      border: `2px solid ${GOLD.edge}`, borderRadius: 20, padding: S.lg,
      background: `linear-gradient(165deg, ${GOLD.wash} 0%, ${GOLD.wash} 38%, ${C.surface} 100%)`,
      animation: calm ? undefined : 'wofSpotIn .6s cubic-bezier(.22,.72,.28,1) both',
      height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: S.md,
    }}>
      {/* laurel watermark, drawn in the gold edge colour */}
      <svg aria-hidden="true" viewBox="0 0 120 120" width={170} height={170}
        style={{ position: 'absolute', right: -34, top: -30, opacity: .35, color: GOLD.edge }}>
        <g fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
          <path d="M60 104C30 96 16 70 20 36" />
          <path d="M60 104C90 96 104 70 100 36" />
          {[0, 1, 2, 3, 4].map(i => (
            <g key={i}>
              <ellipse cx={24 + i * 3} cy={44 + i * 12} rx={9} ry={4.5}
                transform={`rotate(${-50 + i * 8} ${24 + i * 3} ${44 + i * 12})`} />
              <ellipse cx={96 - i * 3} cy={44 + i * 12} rx={9} ry={4.5}
                transform={`rotate(${50 - i * 8} ${96 - i * 3} ${44 + i * 12})`} />
            </g>
          ))}
        </g>
      </svg>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px',
                       borderRadius: 999, background: GOLD.ink, color: GOLD.wash,
                       fontSize: F.micro, fontWeight: W.bold }}>
          <Icon name="trophy" size={13} stroke={2} />
          {w.awardName ?? 'Award'}
        </span>
        {w.cycleLabel && <span style={{ fontSize: F.micro, fontWeight: W.semi, color: GOLD.soft }}>{w.cycleLabel}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, position: 'relative' }}>
        <span style={{ padding: 3, borderRadius: '50%', background: GOLD.edge, flexShrink: 0 }}>
          <Avatar name={w.name} size={64} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: W.bold, color: GOLD.text, lineHeight: 1.12,
                        letterSpacing: '-.02em', overflowWrap: 'anywhere' }}>
            {w.name}
          </div>
          {w.designation && (
            <div style={{ fontSize: F.small, color: GOLD.soft, marginTop: 4 }}>{w.designation}</div>
          )}
        </div>
      </div>

      {w.message && (
        <blockquote style={{ margin: 0, position: 'relative', fontSize: F.body, color: GOLD.text,
                             lineHeight: 1.65, paddingLeft: 16, borderLeft: `3px solid ${GOLD.edge}` }}>
          {w.message}
        </blockquote>
      )}

      {when && (
        <div style={{ marginTop: 'auto', fontSize: F.micro, color: GOLD.soft, position: 'relative' }}>
          Announced {when}
        </div>
      )}
    </div>
  )
}

/** Rank 1 gets gold. Ranks 2 and 3 do not, and that is the point. */
function PodiumRow({ row, rank, top, calm }: { row: LeaderRow; rank: number; top: number; calm: boolean }) {
  const first = rank === 1
  const pct = top > 0 ? Math.max(6, Math.round((row.recognitionCount / top) * 100)) : 0
  return (
    <li className={`wof-gold${first && !calm ? ' wof-first' : ''}`} style={{
      listStyle: 'none', display: 'grid', gridTemplateColumns: '24px 34px minmax(0,1fr) auto',
      alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: RAD.tile,
      border: `1px solid ${first ? GOLD.edge : 'transparent'}`,
      background: first ? GOLD.wash : 'transparent',
    }}>
      <span style={{ fontSize: F.small, fontWeight: W.bold, textAlign: 'center',
                     color: first ? GOLD.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </span>
      <Avatar name={row.name} size={34} />
      <div style={{ minWidth: 0 }}>
        {/* On a gold row the ink comes from the gold palette; on a plain row
            from the app's. Mixing them is what produced 1.01:1 in dark mode. */}
        <div style={{ fontSize: F.small, fontWeight: W.bold, color: first ? GOLD.text : C.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
        {row.designation && (
          <div style={{ fontSize: F.micro, color: first ? GOLD.soft : C.muted,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.designation}</div>
        )}
        <div aria-hidden="true" style={{ height: 4, borderRadius: 4, marginTop: 6,
                                         background: first ? GOLD.edge : C.sunken, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4,
                        background: first ? GOLD.ink : C.brand, opacity: first ? 1 : .7 }} />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: F.lead, fontWeight: W.bold, lineHeight: 1,
                      color: first ? GOLD.text : C.ink, fontVariantNumeric: 'tabular-nums' }}>
          {row.recognitionCount}
        </div>
        <div style={{ fontSize: 11, color: first ? GOLD.soft : C.muted, marginTop: 3 }}>
          {row.recognitionCount === 1 ? 'recognition' : 'recognitions'}
        </div>
      </div>
    </li>
  )
}

/** The top three as ONE PLINTH: 2 · 1 · 3, steps butted together on a shared
 *  base, each person standing on their own block. Only the #1 step is gold.
 *
 *  The earlier version drew three detached tiles with a gap between them and
 *  the avatars floating clear above — three cards of unequal height, which is
 *  not what a podium looks like. A podium is one object: the blocks touch, the
 *  seam between them is a line and not a void, the ground runs unbroken
 *  underneath, and the people are in contact with the surface they won.
 *
 *  THE SHAPE ADAPTS TO THE NUMBER OF PEOPLE. Three names give three steps,
 *  two give two. Nothing is drawn for a seat nobody occupies, so the plinth
 *  narrows instead of leaving a gap where bronze would have been.
 */
function Podium({ rows, calm }: { rows: LeaderRow[]; calm: boolean }) {
  // Seats run left to right. Silver stands left of gold, bronze right of it —
  // the arrangement every televised podium uses. With two people it is silver
  // and gold alone, and the bronze step is not drawn at all.
  const seats = (rows.length >= 3 ? [1, 0, 2] : [1, 0]).filter(i => rows[i])
  const HEIGHT = [112, 88, 72]                       // indexed by rank − 1
  const hs = seats.map(i => HEIGHT[i])
  // A top corner is rounded only where it is exposed. Where a taller
  // neighbour abuts it, it stays square so the two blocks read as one solid.
  const corner = (i: number, side: number) => {
    const j = i + side
    return j < 0 || j >= hs.length || hs[j] < hs[i] ? 10 : 0
  }
  // A podium is about as wide as the people standing on it. Stretched across
  // the whole column each step came out 287px wide with a 42px avatar marooned
  // in the middle of it, which reads as a banner rather than an object.
  // Fixed-width steps, centred; the ground strip inherits this width.
  return (
    <div style={{ marginBottom: S.sm, marginLeft: 'auto', marginRight: 'auto',
                  width: 'fit-content', maxWidth: '100%' }}>
      <div role="list" aria-label="Top three" style={{
        display: 'grid', gridTemplateColumns: `repeat(${seats.length}, minmax(0,116px))`,
        alignItems: 'end', gap: 0,
      }}>
        {seats.map((idx, i) => {
          const r = rows[idx]
          const rank = idx + 1
          const first = rank === 1
          const h = hs[i]
          const line = first ? GOLD.edge : C.line
          return (
            <div key={r.employeeId} role="listitem"
              className={calm ? undefined : 'wof-rise'}
              title={[r.name, r.designation].filter(Boolean).join(' · ')}
              aria-label={`${rank}. ${r.name}, ${r.recognitionCount} ${r.recognitionCount === 1 ? 'recognition' : 'recognitions'}`}
              style={{ display: 'grid', justifyItems: 'center', minWidth: 0,
                       animationDelay: `${i * 90}ms` }}>

              {/* The person, in contact with the block rather than hovering over it. */}
              <span style={{ position: 'relative', display: 'grid', justifyItems: 'center' }}>
                <Avatar name={r.name} size={first ? 54 : 42} ring={first ? GOLD.edge : C.surface} />
                {first && (
                  <span className="wof-gold" style={{ position: 'absolute', top: -9, left: '50%',
                                                      transform: 'translateX(-50%)', color: GOLD.ink,
                                                      fontSize: 19, lineHeight: 1 }}>♛</span>
                )}
                {/* the contact shadow is the whole reason they read as standing */}
                <span aria-hidden="true" style={{ width: first ? 34 : 26, height: 4, marginTop: -3,
                                                  borderRadius: '50%', background: 'rgba(0,0,0,.18)',
                                                  filter: 'blur(2px)' }} />
              </span>

              {/* The block. No bottom border — the shared ground closes it. */}
              <div className={`wof-gold${first && !calm ? ' wof-first' : ''}`} style={{
                width: '100%', height: h, boxSizing: 'border-box', position: 'relative',
                borderRadius: `${corner(i, -1)}px ${corner(i, 1)}px 0 0`,
                // Silver and bronze sit within about three points of luminance
                // of the card they stand on, so without a face they read as
                // holes rather than blocks.
                //
                // The shading is a black overlay, NOT a mix towards C.line.
                // C.line is lighter than C.sunken on dark and darker than it on
                // light, so any fixed mix between the two darkens the face in
                // one theme and lightens it in the other — measured at 23.6 →
                // 35.5 luminance on dark, i.e. a face lit from underneath.
                // Black at a low alpha darkens downward in both themes.
                background: first ? GOLD.wash
                  : `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.16) 100%), ${C.sunken}`,
                borderTop: `1px solid ${line}`,
                borderLeft: `1px solid ${i === 0 ? line : C.line}`,
                borderRight: i === seats.length - 1 ? `1px solid ${line}` : 'none',
                display: 'grid', gridTemplateRows: 'auto auto 1fr', justifyItems: 'center',
                padding: '8px 6px 0', overflow: 'hidden',
              }}>
                {/* the lit top surface of the step */}
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0,
                                                  height: 4, background: line, opacity: .85 }} />
                <div style={{ fontSize: F.micro, fontWeight: W.bold, lineHeight: 1.2, maxWidth: '100%',
                              color: first ? GOLD.text : C.ink, textAlign: 'center',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name.split(/\s+/)[0]}
                </div>
                <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums',
                              color: first ? GOLD.soft : C.muted }}>
                  {r.recognitionCount}
                </div>
                {/* the rank, cut into the face of the step rather than printed on it */}
                <span aria-hidden="true" style={{
                  alignSelf: 'end', marginBottom: -3, fontSize: first ? 34 : 26,
                  fontWeight: W.bold, lineHeight: 1, letterSpacing: '-.02em',
                  fontVariantNumeric: 'tabular-nums',
                  color: first ? GOLD.ink : C.muted, opacity: first ? .9 : .5,
                  textShadow: '0 -1px 0 rgba(0,0,0,.22), 0 1px 0 rgba(255,255,255,.32)',
                }}>{rank}</span>
              </div>
            </div>
          )
        })}
      </div>
      {/* One ground line under every step. This is what makes it a plinth
          and not three tiles standing near each other. */}
      <div aria-hidden="true" style={{ height: 8, borderRadius: '0 0 8px 8px',
                                       background: C.line,
                                       boxShadow: '0 2px 5px rgba(0,0,0,.10)' }} />
    </div>
  )
}

function LegendRow({ w }: { w: Winner }) {
  return (
    <li className="wof-row" style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10,
                                     padding: '8px 6px', borderRadius: RAD.control }}>
      <span style={{ opacity: w.hasLeft ? .6 : 1 }}><Avatar name={w.name} size={32} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, display: 'flex',
                      alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {w.name}
          {w.hasLeft && (
            // Said plainly rather than hidden.
            <span style={{ fontSize: 11, fontWeight: W.semi, padding: '1px 7px', borderRadius: 999,
                           background: C.sunken, color: C.muted }}>no longer here</span>
          )}
        </div>
        <div style={{ fontSize: F.micro, color: C.muted }}>
          {[w.awardName, w.cycleLabel].filter(Boolean).join(' · ')}
        </div>
      </div>
      {w.publishedAt && (
        <span style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap' }}>
          {new Date(w.publishedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        </span>
      )}
    </li>
  )
}

// ── exported surfaces ────────────────────────────────────────────────────

export function Spotlight({ winner }: { winner: Winner | null }) {
  const calm = useCalm()
  if (!winner) {
    return (
      <div style={{ height: '100%', minHeight: 220, borderRadius: 20, border: `1.5px dashed ${C.line}`,
                    display: 'grid', placeItems: 'center', padding: S.lg, boxSizing: 'border-box',
                    background: C.surface }}>
        <Empty icon="trophy" title="The spotlight is waiting" bare>
          No award has been published yet. The first one will appear here.
        </Empty>
      </div>
    )
  }
  return (
    <>
      <WinnerCard w={winner} calm={calm} />
      <style>{`
        ${GOLD_CSS}
        @keyframes wofSpotIn { from { opacity:0; transform: translateY(10px) scale(.99) } to { opacity:1; transform:none } }
        @media (prefers-reduced-motion: reduce){ .wof-spot{ animation:none !important } }
      `}</style>
    </>
  )
}

export function Leaderboard({ rows, enabled }: { rows: LeaderRow[]; enabled: boolean }) {
  const calm = useCalm()
  if (!enabled) {
    return <Empty icon="list" compact>Your company has the leaderboard switched off.</Empty>
  }
  if (!rows.length) {
    return <Empty icon="list" compact>Nobody is on the board yet. It fills as recognitions are published.</Empty>
  }
  const top = rows[0]?.recognitionCount ?? 0
  // The podium takes as many as it has, up to three, and the list carries the
  // rest numbered from wherever it stopped. One name is not a podium — a lone
  // gold block is a pedestal, not a ranking — so a single row stays a row.
  const onPodium = rows.length >= 2 ? Math.min(rows.length, 3) : 0
  const rest = rows.slice(onPodium)
  return (
    <>
      {/* The podium carries the top two or three; the list carries the rest,
          numbered from wherever the podium stopped so no rank is skipped. */}
      {onPodium > 0 && <Podium rows={rows} calm={calm} />}
      {rest.length > 0 && (
        <ol start={onPodium + 1} style={{ margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {rest.map((r, i) => (
            <PodiumRow key={r.employeeId} row={r} rank={i + onPodium + 1} top={top} calm={calm} />
          ))}
        </ol>
      )}
      {/* Counting recognitions, never money. */}
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.sm, paddingLeft: 12 }}>
        Counts recognitions received. It affects nothing else.
      </div>
      <style>{`
        ${GOLD_CSS}
        .wof-first{ animation: wofShimmer 4.5s ease-in-out infinite }
        @keyframes wofShimmer{ 0%,100%{ filter:none } 50%{ filter:brightness(1.045) } }
        /* The steps rise into place, silver then gold then bronze, so the
           podium lands rather than simply being there. */
        .wof-rise{ animation: wofRise .5s cubic-bezier(.2,.8,.2,1) both }
        @keyframes wofRise{ from{ transform: translateY(12px); opacity:0 } to{ transform:none; opacity:1 } }
        @media (prefers-reduced-motion: reduce){
          .wof-first{ animation:none }
          .wof-rise{ animation:none }
        }
      `}</style>
    </>
  )
}

export function HallOfLegends({ winners }: { winners: Winner[] }) {
  if (!winners.length) {
    return <Empty icon="trophy" compact>Past award winners will be listed here once the first cycle closes.</Empty>
  }
  return (
    <div>
      <ul style={{ margin: 0, padding: 0, display: 'grid', gap: 2 }}>
        {winners.map(w => <LegendRow key={w.id} w={w} />)}
      </ul>
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.sm, lineHeight: 1.5 }}>
        People who have left the company stay here. What somebody won is still theirs.
      </div>
    </div>
  )
}
