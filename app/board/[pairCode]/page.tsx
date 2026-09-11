'use client'
// app/board/[pairCode]/page.tsx — the digital board.
//
// THE DIFFERENTIATOR, AND THE REASON IT IS A PUBLIC ROUTE.
//
// Darwinbox, Keka and Vantage Circle are laptop-first. Half the people in a
// plant, a warehouse or a branch have no laptop, and for them the wall exists
// only if it is on a screen. So this runs on a television in a corridor: no
// login, no keyboard, a pair code in the URL and nothing else.
//
// WHAT IT MAY NEVER SHOW
//
// get_board_payload() is the only query, and its SELECT list has no salary,
// no rating, no contact column in it at all — not filtered out afterwards,
// never selected. A screen in a public corridor is the last place to trust a
// client-side filter, so the restriction lives in the database and this file
// simply cannot render what it is never sent.
//
// The payload also excludes anyone past their leaving date. Someone who has
// gone stays in the hall of legends but comes off the board, because the
// board is about now.
//
// This page is deliberately outside /dashboard: that layout carries the auth
// gate, and a board behind a login is a blank television.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Badge, { BADGE_KEYFRAMES, type BadgeTier } from '@/components/wall/Badge'

interface Slide {
  id: string
  citation: string | null
  award: string | null
  badge_code: string | null
  badge_tier: string | null
  badge_count: number | null
  cycle_label: string | null
  full_name: string
  emp_code: string | null
  designation: string | null
  dept_name: string | null
  location_name: string | null
  photo_url: string | null
}

interface Payload {
  error?: string
  screen?: { name: string; rotate_seconds: number; language: string }
  company?: { name: string }
  slides?: Slide[]
}

// Its own palette. The board is seen from four metres away in a corridor
// with its own lighting, so it does not inherit the app's screen tokens.
const B = {
  ground: '#0B1B3F', groundTo: '#071230',
  ink: '#FFFFFF', inkSoft: 'rgba(255,255,255,.80)', inkFaint: 'rgba(255,255,255,.55)',
  line: 'rgba(255,255,255,.14)',
  gold: '#F5C86B', goldInk: '#3A2A08',
}

/** The board's stylesheet, at module scope so EVERY branch renders it.
 *  It lived inside the main return, and the "not paired" and "nothing yet"
 *  branches return before that point — so on exactly the two states a
 *  freshly-installed screen actually shows, none of this applied and the
 *  app's zoom pill sat in the corner of the television. */
function BoardStyles() {
  return (
    <style>{`

        ${BADGE_KEYFRAMES}
        /* The app's floating dock — zoom and eye-comfort — renders from the
           ROOT layout, so it lands on this route too. On a corridor
           television that is noise nobody can use: there is no pointer, and
           a "160%" pill in the corner is the only thing on the wall that
           does not belong to the company. Hidden here rather than in the
           root layout, so no other page's behaviour changes. */
        .ez-zoom, .ez-eyedock { display: none !important }
        body > div:has(> .ez-zoom) { display: none !important }
        /* A board never scrolls — there is no pointer in a corridor. body
           also needs its margin cleared: 8px of it pushed a 100vh frame six
           pixels past the fold, which clips the bottom of the timer bar on a
           real television. */
        html, body { overflow: hidden; margin: 0 }

        /* THE BOARD MUST NOT INHERIT SOMEBODY'S INTERFACE ZOOM.
           UiScale writes document.documentElement.style.zoom from a value it
           remembers in localStorage, so any browser that has ever opened the
           app carries that zoom here. At 160% a 100vh frame resolved to
           1728px and the bottom third of the board — timer bar and ticker —
           fell off a television nobody can scroll.

           Declared here rather than reset in an effect: UiScale's own effect
           runs after this component's and simply put its value back, which
           is a race I lost twice. A stylesheet !important outranks an inline
           style, so this cannot be overwritten by whatever mounts later. */
        html { zoom: 1 !important }
        @keyframes wofSlideIn { from { opacity:0; transform: translateX(46px) } to { opacity:1; transform:none } }
        @keyframes wofBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-10px) } }
        @keyframes wofMarquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .wof-slide  { animation: wofSlideIn .6s cubic-bezier(.2,.8,.2,1) both }
        .wof-bob    { animation: wofBob 4.5s ease-in-out infinite }
        .wof-ticker { animation: wofMarquee 26s linear infinite }
        @media (prefers-reduced-motion: reduce){
          .wof-slide, .wof-bob, .wof-ticker { animation: none }
        }
    `}</style>
  )
}

function Ticker({ names }: { names: string[] }) {
  if (!names.length) return null
  const run = [...names, ...names]          // doubled so the loop has no seam
  return (
    <div style={{ overflow: 'hidden', borderTop: `1px solid ${B.line}`, padding: '14px 0' }}>
      <div className="wof-ticker" style={{ display: 'flex', gap: 44, whiteSpace: 'nowrap' }}>
        {run.map((n, i) => (
          <span key={i} style={{ fontSize: 20, color: B.inkFaint, letterSpacing: '.02em' }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

function Hero({ s }: { s: Slide }) {
  return (
    <div style={{ display: 'grid', gap: 26, justifyItems: 'center', textAlign: 'center' }}>
      {s.award && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12,
                      background: B.gold, color: B.goldInk, borderRadius: 999,
                      padding: '10px 26px', fontSize: 22, fontWeight: 800,
                      letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {s.award}{s.cycle_label ? ` · ${s.cycle_label}` : ''}
        </div>
      )}

      <div className="wof-bob">
        <Badge size={132} tier={(s.badge_tier as BadgeTier) ?? 'gold'} shape="medal"
               glyph="★" count={s.badge_count ?? 1} />
      </div>

      <div>
        <div style={{ fontSize: 68, fontWeight: 800, color: B.ink, lineHeight: 1.05,
                      letterSpacing: '-.02em' }}>{s.full_name}</div>
        <div style={{ fontSize: 26, color: B.inkSoft, marginTop: 10 }}>
          {[s.designation, s.dept_name, s.location_name].filter(Boolean).join(' · ')}
        </div>
      </div>

      {s.citation && (
        <p style={{ maxWidth: '38ch', margin: 0, fontSize: 28, lineHeight: 1.5,
                    color: B.inkSoft }}>
          {s.citation}
        </p>
      )}
    </div>
  )
}

export default function Board({ params }: { params: Promise<{ pairCode: string }> }) {
  const { pairCode } = use(params)
  const [data, setData] = useState<Payload | null>(null)
  const [i, setI] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const tick = useRef<number>(0)

  const load = useCallback(async () => {
    const r = await supabase.rpc('get_board_payload', { p_pair_code: pairCode })
    if (r.error) { setData({ error: 'Could not reach the board service.' }); return }
    setData((r.data ?? {}) as Payload)
  }, [pairCode])

  useEffect(() => { load() }, [load])

  // A television is never reloaded by hand, so it refetches itself. Five
  // minutes is often enough to pick up a new award and rare enough that a
  // corridor screen is not hammering the database all day.
  useEffect(() => {
    const t = setInterval(load, 5 * 60_000)
    return () => clearInterval(t)
  }, [load])

  const slides = data?.slides ?? []
  const rotate = Math.max(6, data?.screen?.rotate_seconds ?? 12)

  useEffect(() => {
    if (slides.length < 2) return
    setElapsed(0)
    const started = performance.now()
    const step = () => {
      const p = Math.min(1, (performance.now() - started) / (rotate * 1000))
      setElapsed(p)
      if (p >= 1) setI(x => (x + 1) % slides.length)
      else tick.current = requestAnimationFrame(step)
    }
    tick.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(tick.current)
  }, [i, slides.length, rotate])

  const frame: React.CSSProperties = {
    // Exactly the viewport, not at least it. A board has one screen.
    height: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr auto',
    background: `linear-gradient(160deg, ${B.ground} 0%, ${B.groundTo} 100%)`,
    color: B.ink, fontFamily: '"DM Sans","Segoe UI",sans-serif',
    padding: '38px 54px', boxSizing: 'border-box',
  }

  if (!data) {
    return (
      <div style={{ ...frame, placeItems: 'center', gridTemplateRows: '1fr' }}>
        <BoardStyles />
        <div style={{ fontSize: 26, color: B.inkFaint }}>Connecting…</div>
      </div>
    )
  }

  if (data.error || !slides.length) {
    return (
      <div style={{ ...frame, placeItems: 'center', gridTemplateRows: '1fr' }}>
        <BoardStyles />
        <div style={{ textAlign: 'center', maxWidth: '32ch' }}>
          <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 14 }}>
            {data.error ? 'This screen is not paired' : 'Nothing to show yet'}
          </div>
          <div style={{ fontSize: 24, color: B.inkSoft, lineHeight: 1.5 }}>
            {data.error
              ? 'Ask your HR team to check the pair code and that the board is switched on.'
              : 'Awards appear here as soon as they are published.'}
          </div>
        </div>
      </div>
    )
  }

  const s = slides[i % slides.length]

  return (
    <div style={frame}>
      <BoardStyles />

      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'baseline', gap: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.04em' }}>
          {data.company?.name ?? 'Wall of Fame'}
        </div>
        <div style={{ fontSize: 20, color: B.inkFaint }}>
          {data.screen?.name} · {i + 1} of {slides.length}
        </div>
      </header>

      <main style={{ display: 'grid', placeItems: 'center', padding: '30px 0' }}>
        <div key={s.id} className="wof-slide"><Hero s={s} /></div>
      </main>

      <footer style={{ display: 'grid', gap: 4 }}>
        {/* The timer bar. Somebody watching should know a slide is about to
            change rather than being surprised by it. */}
        <div style={{ height: 5, borderRadius: 3, background: B.line, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${elapsed * 100}%`, background: B.gold }} />
        </div>
        <Ticker names={slides.map(x => x.full_name)} />
      </footer>
    </div>
  )
}
