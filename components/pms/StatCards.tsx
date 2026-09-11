'use client'
// components/pms/StatCards.tsx — the numbers, with enough context to mean something.
//
// A big number on its own is decoration. Each card here carries four things:
// the label, the value, a plain-language line saying what the value MEANS,
// and — where there is one — a bar showing how far along it is. "6" tells you
// nothing; "6 KRAs · needs 4 to 10 · adds to 100%" tells you that you are
// finished.
//
// MOTION
// The value counts up on first paint and the bar fills behind it. It is a
// short, once-only movement that draws the eye to the number that changed,
// not an ambient animation. Anyone who has asked their system for less motion
// gets the final value immediately — the count is decoration, the number is
// the content, and the content never depends on an animation completing.

import { useEffect, useRef, useState } from 'react'
import { C, F, W, S, R } from '@/lib/ui'

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'brand'

export interface Stat {
  label: string
  /** Numbers count up; strings appear as they are. */
  value: number | string
  /** Printed straight after the value, small: "of 100%", "KRAs". */
  unit?: string
  /** The sentence that makes the number mean something. */
  meaning?: string
  /** 0–1. Draws a fill bar under the value. */
  fill?: number
  tone?: Tone
}

const TONES: Record<Tone, { ink: string; bar: string; wash: string; edge: string }> = {
  neutral: { ink: C.ink,      bar: C.muted,    wash: C.surface, edge: C.line },
  brand:   { ink: C.brand,    bar: C.brand,    wash: C.brandTint, edge: C.brandEdge },
  good:    { ink: C.positive, bar: C.positive, wash: C.positiveTint, edge: `${C.positive}33` },
  warn:    { ink: C.warning,  bar: C.warning,  wash: C.warningTint, edge: `${C.warning}44` },
  bad:     { ink: C.critical, bar: C.critical, wash: C.criticalTint, edge: `${C.critical}44` },
}

/** True when the reader has asked their system for less movement. Read once
 *  and then watched, because people change it mid-session. */
function useCalm(): boolean {
  const [calm, setCalm] = useState(true)   // assume calm until proven otherwise
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setCalm(q.matches)
    on(); q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return calm
}

/** Counts to `to` once. Returns `to` immediately when motion is unwanted, so
 *  the number is never withheld waiting for an animation. */
function useCountUp(to: number, calm: boolean): number {
  const [n, setN] = useState(calm ? to : 0)
  const raf = useRef(0)
  useEffect(() => {
    if (calm) { setN(to); return }
    const started = performance.now()
    const ms = 620
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms)
      // ease-out cubic: fast first, settles gently on the real value
      setN(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [to, calm])
  return n
}

function Card({ s, i, calm }: { s: Stat; i: number; calm: boolean }) {
  const t = TONES[s.tone ?? 'neutral']
  const isNum = typeof s.value === 'number'
  const shown = useCountUp(isNum ? (s.value as number) : 0, calm)

  return (
    <div
      className="pms-stat"
      style={{
        background: t.wash, border: `1px solid ${t.edge}`, borderRadius: R.sm,
        padding: `${S.md}px ${S.md}px ${S.md}px`,
        // Staggered entrance: the row assembles left to right rather than
        // appearing all at once, which reads as one motion instead of five.
        animationDelay: calm ? undefined : `${i * 55}ms`,
      }}
    >
      <div style={{
        fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.11em',
        textTransform: 'uppercase', color: C.muted, marginBottom: 6,
      }}>{s.label}</div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
        <span style={{
          // 26px is the size of a NUMBER. A long phrase set at it stops being
          // a value and becomes a headline, shouting down the numbers beside
          // it — so text scales with its own length instead.
          fontSize: isNum ? 26 : String(s.value).length > 14 ? 16
                          : String(s.value).length > 8 ? 19 : 23,
          fontWeight: W.bold, color: t.ink, lineHeight: 1.15,
          letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums',
        }}>
          {isNum ? shown : s.value}
        </span>
        {s.unit && <span style={{ fontSize: F.small, fontWeight: W.semi, color: C.muted }}>{s.unit}</span>}
      </div>

      {s.fill !== undefined && (
        <div style={{
          height: 5, borderRadius: 3, background: C.sunken, marginTop: 9, overflow: 'hidden',
        }}>
          <div className="pms-fill" style={{
            height: '100%', borderRadius: 3, background: t.bar,
            width: `${Math.max(0, Math.min(1, s.fill)) * 100}%`,
            transformOrigin: 'left center',
            animationDelay: calm ? undefined : `${140 + i * 55}ms`,
          }} />
        </div>
      )}

      {s.meaning && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 8, lineHeight: 1.45 }}>
          {s.meaning}
        </div>
      )}
    </div>
  )
}

export default function StatCards({ stats }: { stats: Stat[] }) {
  const calm = useCalm()
  if (!stats.length) return null
  return (
    <div className="pms-stats" data-calm={calm ? '1' : '0'}>
      {stats.map((s, i) => <Card key={s.label} s={s} i={i} calm={calm} />)}

      <style>{`
        .pms-stats{
          display:grid; gap:${S.sm}px;
          grid-template-columns: repeat(auto-fit, minmax(178px, 1fr));
        }
        /* The lift is a real one: the card rises and its shadow grows with
           it, which is what a raised thing does. A shadow that appears
           without movement reads as a glow. */
        .pms-stat{
          position:relative;
          transition: transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease;
          box-shadow: 0 1px 2px rgba(16,36,100,.06);
          will-change: transform;
        }
        .pms-stat:hover{
          transform: translateY(-3px);
          box-shadow: 0 10px 24px -10px rgba(16,36,100,.30), 0 2px 6px rgba(16,36,100,.10);
        }
        .pms-stats[data-calm="0"] .pms-stat{
          animation: pmsRise .42s cubic-bezier(.2,.8,.2,1) both;
        }
        .pms-stats[data-calm="0"] .pms-fill{
          animation: pmsFill .55s cubic-bezier(.2,.8,.2,1) both;
        }
        @keyframes pmsRise{
          from{ opacity:0; transform: translateY(9px) }
          to  { opacity:1; transform: translateY(0) }
        }
        @keyframes pmsFill{
          from{ transform: scaleX(0) }
          to  { transform: scaleX(1) }
        }
        /* Belt and braces: the hook already returns the final value, and the
           media query stops the entrance even if a browser ignores the hook. */
        @media (prefers-reduced-motion: reduce){
          .pms-stat, .pms-fill{ animation:none !important; transition:none }
          .pms-stat:hover{ transform:none }
        }
      `}</style>
    </div>
  )
}
