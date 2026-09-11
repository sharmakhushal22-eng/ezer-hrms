'use client'
// components/wall/Spotlight.tsx — the winner, the podium, and the people who left.
//
// Three surfaces that share one rule, so they share one file.
//
// GOLD APPEARS IN EXACTLY THREE PLACES IN THIS MODULE, and two of them are
// here: the Spotlight winner's frame, and the #1 card on the podium. The
// third is the award ribbon on the digital board. Nowhere else — not on a
// section header, not on a button, not on anything a person can click.
// That restraint is the whole reason gold reads as WON rather than as
// decoration, and it is checked by scripts/smoke-wall.py rather than left to
// good intentions.
//
// Sub-components at module scope. See the note in ShoutoutComposer.
//
// THE HALL OF LEGENDS KEEPS PEOPLE WHO HAVE LEFT.
// That is deliberate and it is the one place in the module where a leaver
// still appears. They vanish from the feed and from the board the day they
// go, because those are about now — but a thing somebody won is still a thing
// they won, and deleting it rewrites history to tidy a table.

import { useEffect, useState } from 'react'
import { C, F, W, S, R } from '@/lib/ui'

// GOLD IS THEME-AWARE, AND HARDCODING IT WAS A REAL BUG.
//
// The first version pinned three light hexes here. In dark mode the app's own
// ink token resolves LIGHT, so a near-white name landed on pale gold and
// measured 1.01:1 — invisible. wall-theme.ts already carried fgDark and
// bgDark and I had ignored them.
//
// So the palette lives in CSS custom properties, declared for all THREE
// theme states: the bare :root (light), the unstamped default under
// prefers-color-scheme, and the explicit data-ez-theme stamp. A rule written
// only one way leaves the other state wrong, which is exactly what happened.
//
// Every piece of text on a gold surface also takes its colour from --g-text
// rather than from the app's ink token, so the pair can never drift apart
// again: the ground and the ink move together or not at all.
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

function Initials({ name, size = 44 }: { name: string; size?: number }) {
  const letters = name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', background: C.brandTint, color: C.brand,
      fontSize: size * 0.36, fontWeight: W.bold, letterSpacing: '.02em',
    }}>{letters}</span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>{children}</div>
}

/** The winner. The only card in the module that gets a gold frame. */
function WinnerCard({ w, calm }: { w: Winner; calm: boolean }) {
  return (
    <div className="wof-spot wof-gold" style={{
      border: `2px solid ${GOLD.edge}`, borderRadius: R.sm, padding: `${S.lg}px`,
      background: `linear-gradient(180deg, ${GOLD.wash} 0%, ${C.surface} 68%)`,
      animation: calm ? undefined : 'wofSpotIn .52s cubic-bezier(.2,.8,.2,1) both',
    }}>
      {w.awardName && (
        <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.12em',
                      textTransform: 'uppercase', color: GOLD.ink, marginBottom: 9 }}>
          {w.awardName}{w.cycleLabel ? ` · ${w.cycleLabel}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
        <Initials name={w.name} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: GOLD.text, lineHeight: 1.2 }}>
            {w.name}
          </div>
          {w.designation && (
            <div style={{ fontSize: F.small, color: GOLD.soft, marginTop: 2 }}>{w.designation}</div>
          )}
        </div>
      </div>
      {w.message && (
        <p style={{ margin: `${S.md}px 0 0`, fontSize: F.small, color: GOLD.text, lineHeight: 1.65 }}>
          {w.message}
        </p>
      )}
    </div>
  )
}

/** Rank 1 gets gold. Ranks 2 and 3 do not, and that is the point. */
function PodiumRow({ row, rank, calm }: { row: LeaderRow; rank: number; calm: boolean }) {
  const first = rank === 1
  return (
    <div className={`wof-gold${first && !calm ? ' wof-first' : ''}`} style={{
      display: 'flex', alignItems: 'center', gap: S.md, padding: `${S.sm}px ${S.md}px`,
      borderRadius: R.sm,
      border: `1px solid ${first ? GOLD.edge : C.line}`,
      background: first ? GOLD.wash : C.surface,
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
        flexShrink: 0, fontSize: F.micro, fontWeight: W.bold,
        background: first ? GOLD.ink : C.sunken, color: first ? GOLD.wash : C.inkSoft,
      }}>{rank}</span>
      <Initials name={row.name} size={34} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* On a gold row the ink comes from the gold palette; on a plain row
            from the app's. Mixing them is what produced 1.01:1 in dark mode. */}
        <div style={{ fontSize: F.small, fontWeight: W.bold,
                      color: first ? GOLD.text : C.ink }}>{row.name}</div>
        {row.designation && (
          <div style={{ fontSize: F.micro, color: first ? GOLD.soft : C.muted }}>{row.designation}</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: F.body, fontWeight: W.bold, color: first ? GOLD.text : C.ink,
                      fontVariantNumeric: 'tabular-nums' }}>{row.recognitionCount}</div>
        <div style={{ fontSize: F.micro, color: first ? GOLD.soft : C.muted }}>
          {row.recognitionCount === 1 ? 'recognition' : 'recognitions'}
        </div>
      </div>
    </div>
  )
}

function LegendRow({ w }: { w: Winner }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm,
                  padding: `${S.sm}px 0`, borderTop: `1px solid ${C.line}` }}>
      <Initials name={w.name} size={34} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>
          {w.name}
          {w.hasLeft && (
            // Said plainly rather than hidden. Somebody scanning the list
            // deserves to know why a name they cannot find in the directory
            // is here.
            <span style={{ marginLeft: 7, fontSize: F.micro, fontWeight: W.semi,
                           padding: '1px 7px', borderRadius: 999,
                           background: C.sunken, color: C.muted }}>no longer here</span>
          )}
        </div>
        <div style={{ fontSize: F.micro, color: C.muted }}>
          {[w.awardName, w.cycleLabel].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  )
}

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

// ── exported surfaces ────────────────────────────────────────────────────

export function Spotlight({ winner }: { winner: Winner | null }) {
  const calm = useCalm()
  if (!winner) {
    return <Empty>No award has been published yet. The first one will appear here.</Empty>
  }
  return (
    <>
      <WinnerCard w={winner} calm={calm} />
      <style>{`
        ${GOLD_CSS}
        @keyframes wofSpotIn { from { opacity:0; transform: translateY(10px) } to { opacity:1; transform:none } }
        @media (prefers-reduced-motion: reduce){ .wof-spot{ animation:none !important } }
      `}</style>
    </>
  )
}

export function Leaderboard({ rows, enabled }: { rows: LeaderRow[]; enabled: boolean }) {
  const calm = useCalm()
  if (!enabled) {
    return <Empty>Your company has the leaderboard switched off.</Empty>
  }
  if (!rows.length) {
    return <Empty>Nobody is on the board yet. It fills as recognitions are published.</Empty>
  }
  return (
    <>
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map((r, i) => <PodiumRow key={r.employeeId} row={r} rank={i + 1} calm={calm} />)}
      </div>
      {/* Counting recognitions, never money. wall_config.payout_linkage is
          pinned false and nothing here converts a count into anything. */}
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.sm }}>
        Counts recognitions received. It affects nothing else.
      </div>
      <style>{`
        ${GOLD_CSS}
        .wof-first{ animation: wofShimmer 4.5s ease-in-out infinite }
        @keyframes wofShimmer{ 0%,100%{ filter:none } 50%{ filter:brightness(1.045) } }
        @media (prefers-reduced-motion: reduce){ .wof-first{ animation:none } }
      `}</style>
    </>
  )
}

export function HallOfLegends({ winners }: { winners: Winner[] }) {
  if (!winners.length) {
    return <Empty>Past award winners will be listed here once the first cycle closes.</Empty>
  }
  return (
    <div>
      {winners.map(w => <LegendRow key={w.id} w={w} />)}
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.sm, lineHeight: 1.5 }}>
        People who have left the company stay here. What somebody won is still
        theirs.
      </div>
    </div>
  )
}
