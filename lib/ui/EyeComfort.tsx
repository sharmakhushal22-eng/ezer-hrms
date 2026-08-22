'use client';
// lib/ui/EyeComfort.tsx — blue-light reduction for the app's own pixels.
//
// WHAT THIS ACTUALLY DOES, AND WHAT IT CANNOT
//
// A web page cannot reduce the blue light a monitor emits. Only the operating
// system or the display can do that — Night Shift, Windows Night Light, f.lux —
// because they change what the panel outputs. Anything a page does is confined
// to its own pixels.
//
// Within that limit this is real, not a decorative tint. A fixed layer sits
// over the app in `mix-blend-mode: multiply`, so every pixel underneath is
// multiplied by an amber colour: result = base x overlay / 255, per channel.
// With an overlay of rgb(255, 209, 148) the blue channel of everything on
// screen is emitted at 148/255 — a measured 42% reduction — while red is
// untouched. Fewer blue photons actually leave the screen from this app's
// area, which for a full-screen HR tool is most of what the user is looking at.
//
// WHY MULTIPLY RATHER THAN A TRANSLUCENT OVERLAY
//
// A plain semi-opaque amber sheet washes the page toward amber, lifting blacks
// and crushing contrast. Multiply scales both the text and its background by
// the same factor, so contrast RATIOS are largely preserved. Measured at the
// strongest level: primary text 13.05:1, muted text 6.65:1, brand 5.65:1 —
// all still clear of the 4.5:1 the rest of the product is held to.
//
// It also deliberately does NOT use a CSS filter on the root. That would
// promote the whole document to its own compositor layer, which softens text
// and breaks fixed positioning — the exact problem the page-transition work
// had to solve.

import * as React from 'react';
import { C, F, W, R, M } from './tokens';

const KEY = 'ezer_eye_comfort';   // stored as "0".."5"; 0 is off
export const EYE_LEVELS = 5;

/**
 * Overlay colour per level. Red is held at 255 throughout — the point is to
 * remove blue, not to dim the screen. Green comes down more gently than blue
 * so the result reads as warm daylight rather than sepia.
 */
const OVERLAY: Record<number, string> = {
  1: 'rgb(255, 247, 232)',   //  9% blue cut
  2: 'rgb(255, 240, 214)',   // 16%
  3: 'rgb(255, 231, 194)',   // 24%
  4: 'rgb(255, 221, 172)',   // 33%
  5: 'rgb(255, 209, 148)',   // 42%
};
const BLUE_CUT: Record<number, number> = { 1: 9, 2: 16, 3: 24, 4: 33, 5: 42 };

/**
 * Applies the saved level before React hydrates.
 *
 * Someone who turned this on because bright screens hurt should not be shown
 * an unfiltered white page for 300ms on every load.
 */
export const eyeComfortBootScript = `
(function(){try{
  var v = parseInt(localStorage.getItem('${KEY}') || '0', 10);
  if (v > 0) document.documentElement.setAttribute('data-ez-eye', String(v));
}catch(e){}})();`;

export function getEyeLevel(): number {
  if (typeof window === 'undefined') return 0;
  const v = parseInt(localStorage.getItem(KEY) || '0', 10);
  return Number.isFinite(v) && v >= 0 && v <= EYE_LEVELS ? v : 0;
}

export function setEyeLevel(v: number) {
  const root = document.documentElement;
  if (v <= 0) { root.removeAttribute('data-ez-eye'); localStorage.setItem(KEY, '0'); }
  else { root.setAttribute('data-ez-eye', String(v)); localStorage.setItem(KEY, String(v)); }
}

/**
 * The filter layer itself. Mounted once, near the root.
 *
 * pointer-events:none is what keeps it a filter rather than a modal — every
 * click passes straight through to the app underneath.
 */
export function EyeComfortLayer() {
  return (
    <style>{`
      .ez-eye-layer{
        position:fixed; inset:0; z-index:2147483000;
        pointer-events:none;
        mix-blend-mode:multiply;
        opacity:0;
        transition:background-color .3s ease, opacity .3s ease;
      }
      ${Object.entries(OVERLAY).map(([lvl, col]) => `
      :root[data-ez-eye="${lvl}"] .ez-eye-layer{background-color:${col};opacity:1}`).join('')}
      @media print{ .ez-eye-layer{display:none} }
      @media (prefers-reduced-motion: reduce){
        .ez-eye-layer{transition:none}
      }
    `}</style>
  );
}

export function EyeComfortOverlay() {
  return <div className="ez-eye-layer" aria-hidden />;
}

// Declared at module level, never inside the control: a component defined
// inside another is a new type on every render and remounts.
function Notch({ level, current, onPick }: {
  level: number; current: number; onPick: (n: number) => void;
}) {
  const on = current >= level;
  return (
    <button
      onClick={() => onPick(level)}
      title={`Level ${level} — cuts about ${BLUE_CUT[level]}% of blue light`}
      aria-label={`Eye comfort level ${level}`}
      style={{
        width: 12, height: 20, padding: 0, border: 'none', cursor: 'pointer',
        background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <span style={{
        display: 'block', width: 4, height: on ? 16 : 8, borderRadius: 99,
        background: on ? C.warning : C.lineStrong,
        transition: `height ${M.quick}, background ${M.quick}`,
      }} />
    </button>
  );
}

const EyeIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z" />
    <circle cx="10" cy="10" r="2.4" />
    {!on && <path d="M3.5 3.5 16.5 16.5" />}
  </svg>
);

/**
 * On/off plus five intensity notches.
 *
 * The toggle remembers the last level used, so turning it back on returns to
 * the strength that suited rather than resetting to the weakest.
 */
export function EyeComfort({ compact }: { compact?: boolean }) {
  const [level, setLevel] = React.useState(0);
  const [last, setLast] = React.useState(3);

  // Read after mount; reading during render would disagree with the server
  // output and hydrate mismatched.
  React.useEffect(() => {
    const v = getEyeLevel();
    setLevel(v);
    if (v > 0) setLast(v);
  }, []);

  const pick = (v: number) => { setEyeLevel(v); setLevel(v); if (v > 0) setLast(v); };
  const toggle = () => pick(level > 0 ? 0 : last);

  if (compact) {
    return (
      <button onClick={toggle} className="ez-press"
        title={level > 0
          ? `Eye comfort on — about ${BLUE_CUT[level]}% less blue light. Click to turn off.`
          : 'Eye comfort — reduce blue light'}
        aria-label="Eye comfort" aria-pressed={level > 0}
        style={{
          width: 34, height: 34, borderRadius: R.md, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${level > 0 ? C.warning : C.railLine}`,
          background: level > 0 ? C.warningTint : 'transparent',
          color: level > 0 ? C.warning : C.railMuted,
        }}>
        <EyeIcon on={level > 0} />
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button onClick={toggle} className="ez-press"
        title={level > 0
          ? `Eye comfort on — about ${BLUE_CUT[level]}% less blue light from this app. Click to turn off.`
          : 'Eye comfort — warms the screen to cut blue light'}
        aria-label="Eye comfort" aria-pressed={level > 0}
        style={{
          height: 26, padding: '0 8px', borderRadius: R.sm, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
          border: `1px solid ${level > 0 ? C.warning : C.railLine}`,
          background: level > 0 ? C.warningTint : 'transparent',
          color: level > 0 ? C.warning : C.railMuted,
          fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi,
        }}>
        <EyeIcon on={level > 0} />
      </button>

      <div role="group" aria-label="Eye comfort intensity"
        style={{
          display: 'inline-flex', alignItems: 'center', padding: '0 3px',
          borderRadius: R.sm, background: C.railHover,
          opacity: level > 0 ? 1 : .45,
          transition: `opacity ${M.quick}`,
        }}>
        {[1, 2, 3, 4, 5].map(n => (
          <Notch key={n} level={n} current={level} onPick={pick} />
        ))}
      </div>
    </div>
  );
}
