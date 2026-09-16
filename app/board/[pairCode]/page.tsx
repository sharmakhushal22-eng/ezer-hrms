'use client'
// app/board/[pairCode]/page.tsx — the digital board.
//
// v8 REDESIGN. Built for four metres: a split stage with the honoree's name
// and citation on the left and the badge on a lit plinth on the right, slide
// position shown as dots, a slim progress bar, and a "recognised" ticker.
// Portrait screens stack the stage vertically.
//
// UNCHANGED:
//   - get_board_payload(p_pair_code) is the only query; it never selects
//     salary, rating or contact columns, and excludes leavers
//   - refetch every 5 minutes; rotation = max(6, rotate_seconds)
//   - always dark, regardless of app theme
//   - the "not paired" and "nothing yet" states
//   - the stylesheet that hides the app dock, blocks scrolling and pins
//     zoom to 1 renders on EVERY branch
//
// GOLD on this screen is the award ribbon and nothing else. (v7 also drew
// the timer bar in gold; v8 moves that to white so the ribbon is the only
// gold thing on the television.)

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

// The board's own palette — seen from across a corridor, never themed.
const B = {
  ground: '#060F1F', ground2: '#0B1B3F', card: '#0E1C33',
  ink: '#FFFFFF', inkSoft: 'rgba(255,255,255,.82)', inkFaint: 'rgba(255,255,255,.52)',
  line: 'rgba(255,255,255,.12)', brand: '#3B82F6',
  gold: '#F5C86B', goldInk: '#3A2A08',
}

const FONT = '"DM Sans","Segoe UI",system-ui,sans-serif'

/** At module scope so EVERY branch renders it. */
function BoardStyles() {
  return (
    <style>{`
        ${BADGE_KEYFRAMES}
        /* The app's floating dock renders from the ROOT layout; on a corridor
           television it is noise nobody can use. */
        .ez-zoom, .ez-eyedock { display: none !important }
        body > div:has(> .ez-zoom) { display: none !important }
        /* A board never scrolls. */
        html, body { overflow: hidden; margin: 0; background: ${B.ground} }
        /* THE BOARD MUST NOT INHERIT SOMEBODY'S INTERFACE ZOOM. A stylesheet
           !important outranks UiScale's inline style. */
        html { zoom: 1 !important }

        .wofb-stage { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
                      align-items: center; gap: 5vw; width: 100%; }
        @media (orientation: portrait) {
          .wofb-stage { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 4vh }
          .wofb-stage .wofb-copy { order: 2; justify-items: center }
          .wofb-stage .wofb-plinth { order: 1 }
        }

        @keyframes wofbIn   { from { opacity:0; transform: translateY(24px) } to { opacity:1; transform:none } }
        @keyframes wofbRise { from { opacity:0; transform: scale(.86) } to { opacity:1; transform:none } }
        @keyframes wofbBob  { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-12px) } }
        @keyframes wofbGlow { 0%,100%{ opacity:.55 } 50%{ opacity:.85 } }
        @keyframes wofbMarq { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes wofbLive { 0%,100%{ opacity:1 } 50%{ opacity:.35 } }
        .wofb-in   { animation: wofbIn .7s cubic-bezier(.22,.72,.28,1) both }
        .wofb-in2  { animation: wofbIn .7s .12s cubic-bezier(.22,.72,.28,1) both }
        .wofb-in3  { animation: wofbIn .7s .24s cubic-bezier(.22,.72,.28,1) both }
        .wofb-rise { animation: wofbRise .8s .1s cubic-bezier(.22,.72,.28,1) both }
        .wofb-bob  { animation: wofbBob 5s ease-in-out infinite }
        .wofb-glow { animation: wofbGlow 5s ease-in-out infinite }
        .wofb-tick { animation: wofbMarq 32s linear infinite }
        .wofb-live { animation: wofbLive 2s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce){
          .wofb-in, .wofb-in2, .wofb-in3, .wofb-rise, .wofb-bob, .wofb-glow, .wofb-tick, .wofb-live { animation: none }
        }
    `}</style>
  )
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

function Ticker({ names }: { names: string[] }) {
  if (!names.length) return null
  const run = [...names, ...names]          // doubled so the loop has no seam
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, borderTop: `1px solid ${B.line}`,
                  paddingTop: 16 }}>
      <span style={{ flexShrink: 0, fontSize: 17, fontWeight: 700, color: B.inkFaint,
                     letterSpacing: '.04em' }}>Recognised</span>
      {/* minWidth 0: without it the max-content marquee widens the whole frame */}
      <div style={{ overflow: 'hidden', flex: 1, minWidth: 0,
                    maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
                    WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)' }}>
        <div className="wofb-tick" style={{ display: 'flex', gap: 40, whiteSpace: 'nowrap', width: 'max-content' }}>
          {run.map((n, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12,
                                   fontSize: 21, color: B.inkSoft }}>
              <span aria-hidden style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid',
                                         placeItems: 'center', background: B.card, color: B.ink,
                                         fontSize: 13, fontWeight: 800, border: `1px solid ${B.line}` }}>
                {initials(n)}
              </span>
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stage({ s }: { s: Slide }) {
  const meta = [s.designation, s.dept_name, s.location_name].filter(Boolean)
  return (
    <div className="wofb-stage">
      <div className="wofb-copy" style={{ display: 'grid', gap: 28, justifyItems: 'start', minWidth: 0 }}>
        {s.award && (
          // The ribbon — the board's one use of gold.
          <div className="wofb-in" style={{ display: 'inline-flex', alignItems: 'center', gap: 14,
                        background: B.gold, color: B.goldInk, borderRadius: 999,
                        padding: '12px 30px 12px 16px', fontSize: 24, fontWeight: 800,
                        letterSpacing: '.02em', boxShadow: '0 10px 40px rgba(245,200,107,.25)' }}>
            <span aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', display: 'grid',
                                       placeItems: 'center', background: B.goldInk, color: B.gold,
                                       fontSize: 18 }}>★</span>
            {s.award}{s.cycle_label ? ` · ${s.cycle_label}` : ''}
          </div>
        )}

        <div className="wofb-in2" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'clamp(56px, 6.4vw, 104px)', fontWeight: 800, color: B.ink,
                        lineHeight: .98, letterSpacing: '-.035em', overflowWrap: 'anywhere' }}>
            {s.full_name}
          </div>
          {meta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
              {meta.map(m => (
                <span key={m} style={{ fontSize: 22, color: B.inkSoft, padding: '6px 16px',
                                       borderRadius: 999, background: 'rgba(255,255,255,.06)',
                                       border: `1px solid ${B.line}` }}>{m}</span>
              ))}
            </div>
          )}
        </div>

        {s.citation && (
          <p className="wofb-in3" style={{ maxWidth: '34ch', margin: 0, fontSize: 'clamp(24px, 2.2vw, 34px)',
                      lineHeight: 1.45, color: B.inkSoft, paddingLeft: 24,
                      borderLeft: `4px solid ${B.brand}` }}>
            {s.citation}
          </p>
        )}
      </div>

      <div className="wofb-plinth wofb-rise" style={{ position: 'relative', display: 'grid', placeItems: 'center',
                                                      minHeight: 360 }}>
        <div className="wofb-glow" aria-hidden style={{
          position: 'absolute', width: 'min(34vw, 460px)', aspectRatio: '1', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,.45) 0%, rgba(59,130,246,.12) 45%, transparent 70%)',
        }} />
        <div aria-hidden style={{
          position: 'absolute', width: 'min(26vw, 340px)', aspectRatio: '1', borderRadius: '50%',
          border: `1px solid ${B.line}`,
        }} />
        <div className="wofb-bob" style={{ position: 'relative' }}>
          <Badge size={200} tier={(s.badge_tier as BadgeTier) ?? 'gold'} shape="medal"
                 glyph="★" count={s.badge_count ?? 1} showLabel={false} interactive={false} />
        </div>
      </div>
    </div>
  )
}

function Dots({ n, i }: { n: number; i: number }) {
  if (n < 2) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {Array.from({ length: Math.min(n, 12) }, (_, k) => (
        <span key={k} style={{ height: 8, borderRadius: 8, transition: 'width .4s',
                               width: k === i % 12 ? 28 : 8,
                               background: k === i % 12 ? B.ink : 'rgba(255,255,255,.25)' }} />
      ))}
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

  // A television is never reloaded by hand, so it refetches itself.
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
    height: '100vh', width: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto',
    gridTemplateColumns: 'minmax(0, 1fr)',
    background: `radial-gradient(120% 90% at 85% 40%, ${B.ground2} 0%, ${B.ground} 62%)`,
    color: B.ink, fontFamily: FONT, padding: '4vh 4.5vw', boxSizing: 'border-box', overflow: 'hidden',
  }

  if (!data || data.error || !slides.length) {
    const title = !data ? 'Connecting…' : data.error ? 'This screen is not paired' : 'Nothing to show yet'
    const text = !data ? null : data.error
      ? 'Ask your HR team to check the pair code and that the board is switched on.'
      : 'Awards appear here as soon as they are published.'
    return (
      <div style={{ ...frame, placeItems: 'center', gridTemplateRows: '1fr' }}>
        <BoardStyles />
        <div style={{ textAlign: 'center', maxWidth: '34ch', display: 'grid', gap: 18, justifyItems: 'center' }}>
          <div className={!data ? 'wofb-live' : undefined} aria-hidden style={{
            width: 96, height: 96, borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: B.card, border: `1px solid ${B.line}`, fontSize: 42, color: B.inkSoft }}>
            {!data ? '◌' : data.error ? '⌁' : '★'}
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.02em' }}>{title}</div>
          {text && <div style={{ fontSize: 24, color: B.inkSoft, lineHeight: 1.5 }}>{text}</div>}
          {data?.screen?.name && <div style={{ fontSize: 18, color: B.inkFaint }}>{data.screen.name}</div>}
        </div>
      </div>
    )
  }

  const s = slides[i % slides.length]

  return (
    <div style={frame}>
      <BoardStyles />

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span aria-hidden style={{ width: 46, height: 46, borderRadius: 13, display: 'grid',
                                     placeItems: 'center', background: B.brand, fontSize: 22 }}>★</span>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.1 }}>
              {data.company?.name ?? 'Wall of Fame'}
            </div>
            <div style={{ fontSize: 16, color: B.inkFaint, marginTop: 2 }}>Wall of Fame</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <Dots n={slides.length} i={i} />
          <div style={{ fontSize: 18, color: B.inkFaint, textAlign: 'right', lineHeight: 1.35 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="wofb-live" aria-hidden style={{ width: 9, height: 9, borderRadius: '50%',
                                                              background: '#34D399' }} />
              {data.screen?.name}
            </div>
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>{i + 1} of {slides.length}</div>
          </div>
        </div>
      </header>

      <main style={{ display: 'grid', alignItems: 'center', padding: '3vh 0', minHeight: 0, minWidth: 0,
                     gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div key={s.id}><Stage s={s} /></div>
      </main>

      <footer style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 }}>
        {/* The timer bar. Somebody watching should know a slide is about to change. */}
        <div style={{ height: 4, borderRadius: 4, background: B.line, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${elapsed * 100}%`, background: B.ink, opacity: .85 }} />
        </div>
        {slides.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -6, fontSize: 17,
                        color: B.inkFaint }}>
            Up next&nbsp;<span style={{ color: B.inkSoft, fontWeight: 700 }}>
              {slides[(i + 1) % slides.length].full_name}
            </span>
          </div>
        )}
        <Ticker names={slides.map(x => x.full_name)} />
      </footer>
    </div>
  )
}
