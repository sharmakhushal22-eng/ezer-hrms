'use client';
// components/ess/today/AnalogPunchWatch.tsx — the hero's dial.
//
// It replaces the progress ring that used to sit here. The difference is what
// the ring MEANS: the old one showed how far through the shift the wall clock
// was, which is the same for everybody and tells you nothing about your day.
// This one is a day gauge:
//
//   · a faint SHIFT WINDOW band shows where the day is meant to sit
//   · the WORKED arc is stroked on the same ring, so target and actual compare
//     directly without reading two numbers
//   · anything past the shift's length continues as a separate overtime arc
//   · each punch plants a marker on the ring with the time in a capsule
//
// ELAPSED TIME DRIVES THE ARCS, not wall position. On a 12-hour face one minute
// is half a degree, so a 13-hour day draws as a sweep that is clipped at 359°
// instead of wrapping back over its own start and reading as a short day.
//
// NO COLOUR IS WRITTEN HERE. Every fill and stroke is a --pz-* custom property
// from punch-hero.css, which has light and dark values. A hex in this file
// would freeze the watch face to one theme, and lib/ui/__tests__ fails the
// build for exactly that — correctly, since this component is half gradients.
//
// ONE rAF LOOP writes the hands, the digital readout and the live arcs straight
// to refs. No React state, so no re-render per frame and none per second; it
// re-renders only when the punch times change.
import { memo, useEffect, useMemo, useRef } from 'react';
import { DEG_PER_MINUTE, degFromDate, degFromMinutes, hhmmToMinutes, outChipRadius, shiftLengthMs } from '@/lib/today/punch';

export type AnalogPunchWatchProps = {
  inAt: Date | null;
  outAt: Date | null;
  /** 'HH:MM' */
  shiftStart?: string;
  shiftEnd?: string;
  hourFormat?: 12 | 24;
  size?: number;
  tzLabel?: string;
};

const CX = 120;
const CY = 120;
const RING = 103;

const pt = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
};

/** An arc between two angles. Never allowed to close on itself: a 360° sweep
 *  draws as nothing at all, so a full day would vanish at the moment it
 *  completed. Clipped at 359° instead. */
function arcD(a1: number, a2: number, r: number) {
  let sweep = (a2 - a1 + 360) % 360;
  if (sweep < 0.5) return '';
  if (sweep > 359) sweep = 359;
  const p1 = pt(a1, r);
  const p2 = pt((a1 + sweep) % 360, r);
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}
const pad = (n: number) => String(n).padStart(2, '0');

/** A punch on the ring: a node, a thin stem, and a capsule with the time. */
function PunchMarker({ at, kind, chipR, hourFormat }: { at: Date; kind: 'IN' | 'OUT'; chipR: number; hourFormat: 12 | 24 }) {
  const deg = degFromDate(at);
  const colour = kind === 'IN' ? 'var(--pz-in)' : 'var(--pz-out)';
  const node = pt(deg, RING);
  const stem = pt(deg, 89);
  const chip = pt(deg, chipR);
  const hh = hourFormat === 12 ? at.getHours() % 12 || 12 : at.getHours();

  return (
    <g className="pz-flag">
      <circle cx={node.x} cy={node.y} r={4.2} fill="var(--pz-marker-halo)" />
      <circle cx={node.x} cy={node.y} r={2.8} fill={colour} />
      <line x1={node.x} y1={node.y} x2={stem.x} y2={stem.y} stroke={colour} strokeWidth={1.2} strokeLinecap="round" opacity={0.8} />
      <g transform={`translate(${chip.x.toFixed(2)},${chip.y.toFixed(2)})`}>
        <rect x={-16.5} y={-7.5} width={33} height={15} rx={7.5} fill={colour} />
        <rect x={-16.5} y={-7.5} width={33} height={15} rx={7.5} fill="none" stroke="var(--pz-chip-edge)" />
        <text x={0} y={3.5} textAnchor="middle" fontSize={8} fontWeight={800} fill="var(--pz-chip-ink)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {`${pad(hh)}:${pad(at.getMinutes())}`}
        </text>
      </g>
    </g>
  );
}

function AnalogPunchWatchBase({
  inAt, outAt, shiftStart = '09:30', shiftEnd = '18:30',
  hourFormat = 12, size = 260, tzLabel = 'IST',
}: AnalogPunchWatchProps) {
  const hourRef = useRef<SVGPathElement>(null);
  const minRef = useRef<SVGPathElement>(null);
  const secRef = useRef<SVGGElement>(null);
  const timeRef = useRef<SVGTextElement>(null);
  const meriRef = useRef<SVGTextElement>(null);
  const workArcRef = useRef<SVGPathElement>(null);
  const otArcRef = useRef<SVGPathElement>(null);

  const targetMin = shiftLengthMs(shiftStart, shiftEnd) / 60000;
  // The rAF loop reads the latest values from a ref rather than closing over
  // them, so it is started once and never torn down on a punch. The ref is
  // filled in an effect, not during render — writing a ref while rendering is
  // a react-hooks error, and this effect is declared first so the loop's
  // effect and the repaint below both see the new values.
  const live = useRef({ inAt, outAt, hourFormat, targetMin });
  useEffect(() => {
    live.current = { inAt, outAt, hourFormat, targetMin };
  }, [inAt, outAt, hourFormat, targetMin]);

  /** Split the elapsed span into the normal arc and the overtime arc. */
  const paintArcs = (now: Date) => {
    const { inAt: i, outAt: o, targetMin: t } = live.current;
    const w = workArcRef.current;
    const ot = otArcRef.current;
    if (!w || !ot) return;
    if (!i) { w.setAttribute('d', ''); ot.setAttribute('d', ''); return; }

    const a1 = degFromDate(i);
    const workedMin = ((o ?? now).getTime() - i.getTime()) / 60000;
    const normal = Math.min(workedMin, t);
    const over = Math.max(0, workedMin - t);
    const aNormal = (a1 + normal * DEG_PER_MINUTE) % 360;

    w.setAttribute('d', normal > 1 ? arcD(a1, aNormal, RING) : '');
    ot.setAttribute('d', over > 1 ? arcD(aNormal, (aNormal + over * DEG_PER_MINUTE) % 360, RING) : '');
  };

  useEffect(() => {
    let raf = 0;
    let lastSec = -1;
    const frame = () => {
      const now = new Date();
      const s = now.getSeconds() + now.getMilliseconds() / 1000;
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;

      if (hourRef.current) hourRef.current.style.transform = `rotate(${h * 30}deg)`;
      if (minRef.current) minRef.current.style.transform = `rotate(${m * 6}deg)`;
      if (secRef.current) secRef.current.style.transform = `rotate(${s * 6}deg)`;

      // The readout and the arcs only change once a second; the hands move
      // every frame. Doing all of it per frame would be wasted work.
      if (now.getSeconds() !== lastSec) {
        lastSec = now.getSeconds();
        const f = live.current.hourFormat;
        const hh = f === 12 ? now.getHours() % 12 || 12 : now.getHours();
        if (timeRef.current) timeRef.current.textContent = `${pad(hh)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        if (meriRef.current) meriRef.current.textContent = (f === 12 ? (now.getHours() < 12 ? 'AM · ' : 'PM · ') : '') + tzLabel;
        paintArcs(now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tzLabel]);

  // Repaint the instant a punch lands rather than waiting for the next second.
  const inMs = inAt?.getTime() ?? 0;
  const outMs = outAt?.getTime() ?? 0;
  useEffect(() => { paintArcs(new Date()); }, [inMs, outMs, targetMin]);

  const dots = useMemo(
    () => Array.from({ length: 60 }, (_, i) => i).filter(i => i % 5 !== 0).map(i => {
      const p = pt(i * 6, 93);
      return <circle key={i} cx={p.x} cy={p.y} r={0.85} fill="var(--pz-dot)" />;
    }), []);

  const indices = useMemo(
    () => Array.from({ length: 12 }, (_, h) => {
      const a = h * 30;
      const p1 = pt(a, 95);
      const p2 = pt(a, h === 0 ? 81 : 86);
      return (
        <line key={h} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          stroke={h === 0 ? 'var(--ez-brand)' : 'var(--pz-index)'}
          strokeWidth={h === 0 ? 3 : 1.9} strokeLinecap="round" opacity={h === 0 ? 1 : 0.72} />
      );
    }), []);

  /** The target window, and a tick at each of its two boundaries. */
  const { bandD, shiftTicks } = useMemo(() => {
    const a1 = degFromMinutes(hhmmToMinutes(shiftStart));
    const a2 = degFromMinutes(hhmmToMinutes(shiftEnd));
    const ticks = [a1, a2].map((a, i) => {
      const q = pt(a, 97.5);
      const w = pt(a, 108.5);
      return <line key={i} x1={q.x} y1={q.y} x2={w.x} y2={w.y} stroke="var(--ez-brand)" strokeOpacity={0.45} strokeWidth={1.2} strokeLinecap="round" />;
    });
    return { bandD: arcD(a1, a2, RING), shiftTicks: ticks };
  }, [shiftStart, shiftEnd]);

  // Where the OUT capsule sits, so the two never overlap. The rule is tested
  // geometry in lib/today/punch.ts — the version here was inverted, moving the
  // capsule when the punches were furthest apart and leaving it when they
  // coincided, which is the case that actually collides.
  const outChipR = outChipRadius(inAt, outAt);

  return (
    <svg className="pz-dial" viewBox="0 0 240 240" style={{ width: size, height: size }}
      role="img" aria-label="Clock face showing the shift window and today's punches">
      <defs>
        <linearGradient id="pzBez" x1=".12" y1="0" x2=".88" y2="1">
          <stop offset="0%" stopColor="var(--pz-bez-1)" />
          <stop offset="28%" stopColor="var(--pz-bez-2)" />
          <stop offset="52%" stopColor="var(--pz-bez-3)" />
          <stop offset="76%" stopColor="var(--pz-bez-4)" />
          <stop offset="100%" stopColor="var(--pz-bez-5)" />
        </linearGradient>
        <radialGradient id="pzFace" cx="33%" cy="22%">
          <stop offset="0%" stopColor="var(--pz-face-1)" />
          <stop offset="58%" stopColor="var(--pz-face-2)" />
          <stop offset="100%" stopColor="var(--pz-face-3)" />
        </radialGradient>
        <linearGradient id="pzArc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--pz-arc-1)" />
          <stop offset="60%" stopColor="var(--pz-arc-2)" />
          <stop offset="100%" stopColor="var(--pz-arc-3)" />
        </linearGradient>
        <filter id="pzHandShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="1.8" floodColor="var(--pz-hand-shadow)" floodOpacity=".28" />
        </filter>
        <filter id="pzGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* bezel, face, inner lip */}
      <circle cx={CX} cy={CY} r={119} fill="url(#pzBez)" opacity="var(--pz-bezel-opacity,1)" />
      <circle cx={CX} cy={CY} r={110.5} fill="url(#pzFace)" />
      <circle cx={CX} cy={CY} r={110.5} fill="none" stroke="var(--pz-lip-dark)" strokeWidth={1.6} />
      <circle cx={CX} cy={CY} r={108} fill="none" stroke="var(--pz-lip-light)" strokeWidth={1} />

      {/* target window, day track, actual, overtime */}
      <path d={bandD} fill="none" stroke="var(--pz-band)" strokeWidth={11} />
      <circle cx={CX} cy={CY} r={RING} fill="none" stroke="var(--pz-track)" strokeWidth={3.4} />
      <path ref={workArcRef} d="" fill="none" stroke="url(#pzArc)" strokeWidth={4.6} strokeLinecap="round" filter="url(#pzGlow)" />
      <path ref={otArcRef} d="" fill="none" stroke="var(--pz-ot)" strokeWidth={4.6} strokeLinecap="round" filter="url(#pzGlow)" />
      <g>{shiftTicks}</g>

      <g>{dots}</g>
      <g>{indices}</g>

      {inAt ? <PunchMarker at={inAt} kind="IN" chipR={77} hourFormat={hourFormat} /> : null}
      {outAt ? <PunchMarker at={outAt} kind="OUT" chipR={outChipR} hourFormat={hourFormat} /> : null}

      {/* The digital readout sits low, not centred: the second hand would sweep
          across text in the middle of the face once a minute. */}
      <rect x={80} y={146} width={80} height={24} rx={12} fill="var(--ez-brand)" opacity={0.07} />
      <rect x={80} y={146} width={80} height={24} rx={12} fill="none" stroke="var(--ez-brand)" strokeOpacity={0.18} />
      <text ref={timeRef} x={CX} y={163} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--pz-digital)" style={{ fontVariantNumeric: 'tabular-nums' }}>
        00:00:00
      </text>
      <text ref={meriRef} x={CX} y={185} textAnchor="middle" fontSize={7.8} fontWeight={800} letterSpacing="1.9" fill="var(--pz-faint2)">{tzLabel}</text>

      {/* tapered hands */}
      <g filter="url(#pzHandShadow)">
        <path ref={hourRef} className="pz-hand" d="M117.5 124 L118.5 69 Q120 64.4 121.5 69 L122.5 124 Z" fill="var(--pz-hand-h)" />
        <path ref={minRef} className="pz-hand" d="M118.6 124 L119.15 45 Q120 41.2 120.85 45 L121.4 124 Z" fill="var(--pz-hand-m)" />
        <g ref={secRef} className="pz-hand">
          <line x1={120} y1={135} x2={120} y2={33} stroke="var(--ez-brand)" strokeWidth={1.1} strokeLinecap="round" />
          <circle cx={120} cy={139} r={2.9} fill="var(--ez-brand)" />
        </g>
      </g>
      <circle cx={CX} cy={CY} r={5} fill="var(--pz-hand-h)" />
      <circle cx={CX} cy={CY} r={1.9} fill="var(--pz-marker-halo)" opacity={0.9} />
    </svg>
  );
}

export const AnalogPunchWatch = memo(AnalogPunchWatchBase, (a, b) =>
  a.inAt?.getTime() === b.inAt?.getTime() &&
  a.outAt?.getTime() === b.outAt?.getTime() &&
  a.shiftStart === b.shiftStart &&
  a.shiftEnd === b.shiftEnd &&
  a.hourFormat === b.hourFormat &&
  a.size === b.size
);

export default AnalogPunchWatch;
