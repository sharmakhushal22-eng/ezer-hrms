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
// At full strength the overlay is rgb(255, 190, 92), so the blue channel of
// everything on screen is emitted at 92/255 — a measured 64% reduction — while
// red is untouched. Fewer blue photons actually leave the screen from this
// app's area, which for a full-screen HR tool is most of what a user looks at.
//
// WHY MULTIPLY RATHER THAN A TRANSLUCENT OVERLAY
//
// A plain semi-opaque amber sheet washes the page toward amber, lifting blacks
// and crushing contrast. Multiply scales both the text and its background by
// the same factor, so contrast RATIOS are largely preserved. Measured at full
// strength: primary text 11.44:1, muted text 6.25:1 — both still clear of the
// 4.5:1 the rest of the product is held to. That headroom is why the slider is
// allowed to run all the way to a 64% cut without gating the top end.
//
// It also deliberately does NOT use a CSS filter on the root. That would
// promote the whole document to its own compositor layer, which softens text
// and breaks fixed positioning — the exact problem the page-transition work
// had to solve.

import * as React from 'react';
import { C, F, W, R, E, M, numeric } from './tokens';

const KEY = 'ezer_eye_comfort';

/**
 * Strength is a continuous 0–100, so the slider is smooth rather than stepped.
 *
 * Red is pinned at 255 at every strength — the point is to remove blue, not to
 * dim the screen. Green falls a quarter as far as blue, which is what makes the
 * result read as warm daylight rather than sepia.
 */
const GREEN_DROP = 65;
const BLUE_DROP = 163;

export function eyeChannels(pct: number) {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return { g: Math.round(255 - GREEN_DROP * t), b: Math.round(255 - BLUE_DROP * t) };
}

/** How much blue the current strength actually removes, for the readout. */
export function blueCut(pct: number) {
  return Math.round((1 - eyeChannels(pct).b / 255) * 100);
}

/**
 * Applies the saved strength before React hydrates.
 *
 * Someone who turned this on because bright screens hurt should not be shown an
 * unfiltered white page for 300ms on every load.
 *
 * The `v <= 5` branch migrates the earlier five-notch scale, where the stored
 * value was a level rather than a percentage. Without it, someone who had saved
 * "level 5" would silently come back to 5% — all but off.
 */
export const eyeComfortBootScript = `
(function(){try{
  var v = parseInt(localStorage.getItem('${KEY}') || '0', 10);
  if (!(v > 0)) return;
  if (v <= 5) v = [0, 14, 25, 38, 52, 66][v];
  var t = Math.min(100, v) / 100, s = document.documentElement.style;
  s.setProperty('--ez-eye-g', String(Math.round(255 - ${GREEN_DROP} * t)));
  s.setProperty('--ez-eye-b', String(Math.round(255 - ${BLUE_DROP} * t)));
  s.setProperty('--ez-eye-on', '1');
}catch(e){}})();`;

export function getEyeStrength(): number {
  if (typeof window === 'undefined') return 0;
  let v = parseInt(localStorage.getItem(KEY) || '0', 10);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v <= 5) v = [0, 14, 25, 38, 52, 66][v];   // same migration as the boot script
  return Math.min(100, v);
}

export function setEyeStrength(pct: number) {
  const s = document.documentElement.style;
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  if (v <= 0) {
    s.setProperty('--ez-eye-on', '0');
    localStorage.setItem(KEY, '0');
    return;
  }
  const { g, b } = eyeChannels(v);
  s.setProperty('--ez-eye-g', String(g));
  s.setProperty('--ez-eye-b', String(b));
  s.setProperty('--ez-eye-on', '1');
  localStorage.setItem(KEY, String(v));
}

/**
 * The filter layer and the styles the control needs. Mounted once, near the
 * root.
 *
 * The overlay colour is driven by CSS variables rather than by a class per
 * level, which is what lets the slider be continuous — dragging updates two
 * numbers and the compositor does the rest.
 *
 * Only `opacity` is transitioned, deliberately. Fading in on toggle reads as
 * intentional; transitioning `background-color` too would make the colour lag
 * behind the thumb during a drag, which feels broken.
 */
export function EyeComfortLayer() {
  return (
    <style>{`
      .ez-eye-layer{
        position:fixed; inset:0; z-index:2147483000;
        pointer-events:none;
        mix-blend-mode:multiply;
        background-color:rgb(255, var(--ez-eye-g, 255), var(--ez-eye-b, 255));
        opacity:var(--ez-eye-on, 0);
      }
      /* Both selectors exist to out-specify theme.css, which eases
         background-color on  :root[data-ez-theme] *  so a theme switch reads as
         one movement. That sweep is right for the app and wrong for this layer:
         it makes the overlay colour lag the slider thumb by 220ms, so a drag
         feels like dragging through treacle. Only opacity should ease here, and
         only so the on/off switch is not a hard cut. Measured: with the sweep
         applied, sampling at 90ms after a change read t=0.09 when the slider
         said 0.01 — the colour was still in flight. */
      :root .ez-eye-layer,
      :root[data-ez-theme] .ez-eye-layer{
        transition:opacity .28s ease;
      }
      @media print{ .ez-eye-layer{display:none} }

      /* The slider. A native range input, restyled — it gets smooth dragging,
         keyboard arrows and touch for free, none of which a div reimplements
         well. The track carries the actual warmth ramp, so the control shows
         what it does. */
      .ez-eye-range{
        -webkit-appearance:none; appearance:none;
        width:100%; height:18px; margin:0; display:block;
        background:transparent; cursor:pointer;
      }
      .ez-eye-range::-webkit-slider-runnable-track{
        height:6px; border-radius:99px;
        background:linear-gradient(90deg,#FFFFFF,#FFE9C6 45%,#FFBE5C);
        border:1px solid rgba(0,0,0,.10);
      }
      .ez-eye-range::-moz-range-track{
        height:6px; border-radius:99px;
        background:linear-gradient(90deg,#FFFFFF,#FFE9C6 45%,#FFBE5C);
        border:1px solid rgba(0,0,0,.10);
      }
      .ez-eye-range::-webkit-slider-thumb{
        -webkit-appearance:none; appearance:none;
        width:16px; height:16px; margin-top:-6px; border-radius:99px;
        background:#fff; border:2px solid #C2751B;
        box-shadow:0 1px 4px rgba(0,0,0,.28);
        transition:transform .12s ease, box-shadow .12s ease;
      }
      .ez-eye-range::-moz-range-thumb{
        width:16px; height:16px; border-radius:99px;
        background:#fff; border:2px solid #C2751B;
        box-shadow:0 1px 4px rgba(0,0,0,.28);
        transition:transform .12s ease, box-shadow .12s ease;
      }
      .ez-eye-range:active::-webkit-slider-thumb{transform:scale(1.18)}
      .ez-eye-range:active::-moz-range-thumb{transform:scale(1.18)}
      .ez-eye-range:focus-visible{outline:none}
      .ez-eye-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgba(194,117,27,.38)}
      .ez-eye-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 3px rgba(194,117,27,.38)}

      /* Ends at transform:none so the panel's text is not left rasterised on
         its own compositor layer — the sharpness rule the rest of the motion
         work follows. */
      @keyframes ezEyePop{
        from{opacity:0; transform:translateY(8px) scale(.96)}
        to  {opacity:1; transform:none}
      }
      .ez-eye-panel{animation:ezEyePop .22s cubic-bezier(.22,1,.36,1) both; transform-origin:100% 100%}

      /* The auto-close countdown, shown as a depleting hairline along the foot
         of the panel. A panel that vanishes with no warning reads as a glitch;
         this makes the dismissal something the user can see coming, and gives
         them the cue that touching it will stop the clock. It is a 2px
         decorative bar with no text in it, so promoting it to its own
         compositor layer costs nothing. */
      @keyframes ezEyeCountdown{ from{transform:scaleX(1)} to{transform:scaleX(0)} }
      .ez-eye-countdown{
        position:absolute; left:0; right:0; bottom:0; height:2px;
        border-bottom-left-radius:99px; border-bottom-right-radius:99px;
        transform-origin:0 50%;
        animation:ezEyeCountdown var(--ez-eye-hold, 1s) linear forwards;
      }
      @media (prefers-reduced-motion: reduce){
        .ez-eye-layer{transition:none}
        .ez-eye-panel{animation:none}
        /* No depleting bar without motion, but the panel still closes on time —
           a static full-width rule would claim time is not passing. */
        .ez-eye-countdown{animation:none; opacity:.3}
      }

    `}</style>
  );
}

export function EyeComfortOverlay() {
  return <div className="ez-eye-layer" aria-hidden />;
}

const EyeIcon = ({ on, size = 17 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z" />
    <circle cx="10" cy="10" r="2.4" />
    {!on && <path d="M3.5 3.5 16.5 16.5" />}
  </svg>
);

/**
 * How long the panel waits before dismissing itself, if left alone.
 *
 * The clock only runs once the pointer has left the control, and by then the
 * user is finished with it — so this is a grace period, not a reading window,
 * and it wants to be short enough that moving away simply closes it.
 */
const HOLD_MS = 1000;

/**
 * The same grace period on a device that cannot hover.
 *
 * With a mouse, resting the pointer on the control holds the panel open
 * indefinitely, so a one-second clock is safe: it only ever runs when the user
 * has already moved away. Touch has no such hold — the clock starts the moment
 * the panel opens — so one second there would snatch the panel away about a
 * second after a tap, before a drag could even begin. Four seconds gives a
 * thumb time to arrive, and dragging restarts it from there.
 */
const HOLD_TOUCH_MS = 4000;

/** Where the slider lands the first time someone switches the filter on. */
/** Eye comfort's own accent. Deliberately not C.warning: that is amber, and
 *  the theme toggle's light mode is now amber too. Two warm controls in the
 *  same chrome need different warms. White on this is 5.18:1. */
const EYE_ON = '#C2410C';

const DEFAULT_STRENGTH = 30;

const TickIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.6 6.3 12 13 4.6" />
  </svg>
);

/**
 * The floating control: an on/off button seated beside the zoom pill, with the
 * intensity panel appearing above it only while the filter is on.
 *
 * THE PANEL DISMISSES ITSELF, AND WHY IT DOES NOT ALSO RESET
 *
 * Setting intensity is a moment's work; the panel has no reason to sit over the
 * page afterwards. So it closes on Done, and closes on its own
 * shortly after if Done is never pressed.
 *
 * What it does NOT do is snap the strength back to the default when the timer
 * runs out. Dragging the slider is a deliberate act, and discarding it because
 * the user did not also press a button would throw away the thing they just
 * did. The default applies where a default belongs — the first time the filter
 * is switched on, at 30% — and after that whatever they set is what they get,
 * confirmed or not. Done is a way to dismiss the panel early, not a commit
 * step, and nothing is lost by ignoring it.
 *
 * The clock only runs when the control is unattended: pointer over it or
 * keyboard focus inside it stops the countdown, and moving away restarts it.
 * Closing under an active pointer would be the panel getting out of the way at
 * exactly the moment it was being used.
 */
export function EyeComfortDock() {
  const [pct, setPct] = React.useState(0);
  const [last, setLast] = React.useState(DEFAULT_STRENGTH);
  const [ready, setReady] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [held, setHeld] = React.useState(false);   // pointer over, or focus inside
  const [run, setRun] = React.useState(0);         // bump to restart the countdown
  const [hold, setHold] = React.useState(HOLD_MS);

  // Read after mount. Reading during render would disagree with the server
  // output and hydrate mismatched; the control simply appears once hydrated.
  // A device with no hover cannot hold the panel open, so it gets the longer
  // grace. Read after mount: matchMedia does not exist on the server.
  React.useEffect(() => {
    if (window.matchMedia('(hover: none)').matches) setHold(HOLD_TOUCH_MS);
  }, []);

  React.useEffect(() => {
    const v = getEyeStrength();
    setPct(v);
    if (v > 0) { setLast(v); setEyeStrength(v); }  // rewrites a migrated level as a percentage
    setReady(true);
  }, []);

  // The clock is derived state rather than something started and stopped by
  // hand: it runs exactly when the panel is open and unattended, and React's
  // cleanup cancels it on every change. Held as a ref instead, `held` would not
  // re-render, and the countdown bar would go on animating after the pointer
  // arrived — showing time running out while it was in fact stopped.
  React.useEffect(() => {
    if (!open || held) return;
    const t = setTimeout(() => setOpen(false), hold);
    return () => clearTimeout(t);
  }, [open, held, run, hold]);

  const apply = (v: number) => {
    setEyeStrength(v); setPct(v);
    if (v > 0) setLast(v);
  };

  const on = pct > 0;

  const toggle = () => {
    if (on) { apply(0); setOpen(false); }
    else { apply(last); setOpen(true); setRun(n => n + 1); }
  };

  const enter = () => { setHeld(true); if (on) setOpen(true); };
  const leave = () => setHeld(false);

  if (!ready) return null;

  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        fontFamily: '"DM Sans","Segoe UI",sans-serif',
      }}
      // pointerType is checked because touch has no hover: a tap fires
      // pointerenter and often never fires pointerleave, which would hold the
      // panel open forever on a phone. On touch the clock simply runs, and
      // dragging the slider restarts it.
      onPointerEnter={e => { if (e.pointerType !== 'touch') enter(); }}
      onPointerLeave={e => { if (e.pointerType !== 'touch') leave(); }}
      // Keyboard users get the same hold as pointer users. Without this the
      // panel would close while someone was arrowing the slider.
      onFocusCapture={enter}
      onBlurCapture={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave();
      }}
    >
      {on && open && (
        <div className="ez-eye-panel" role="group" aria-label="Eye comfort intensity"
          style={{
            // Absolute rather than a flex sibling, so opening the panel cannot
            // shove the button sideways and move the thing just clicked.
            position: 'absolute', bottom: 'calc(100% + 10px)', right: 0,
            width: 196, padding: '11px 13px 13px', borderRadius: R.lg,
            background: C.surface, border: `1px solid ${C.line}`, boxShadow: E.floating,
            overflow: 'hidden',   // keeps the countdown inside the rounded corners
          }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
            <span style={{ fontSize: F.micro, fontWeight: W.semi, color: C.muted, letterSpacing: .3 }}>
              INTENSITY
            </span>
            <span style={{ ...numeric, fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
              {pct}%
            </span>
          </div>

          <input
            type="range" min={1} max={100} step={1} value={pct}
            onChange={e => { apply(Number(e.target.value)); setRun(n => n + 1); }}
            className="ez-eye-range"
            aria-label="Eye comfort intensity"
            aria-valuetext={`${pct} percent, cuts about ${blueCut(pct)} percent of blue light`}
          />

          {/* Two elements rather than one wrapping sentence: left to wrap, the
              last word orphans onto its own line at this width. The break is
              part of the copy, so it is set here rather than left to chance. */}
          <div style={{ marginTop: 7, fontSize: F.micro, color: C.faint, lineHeight: 1.45 }}>
            <div>Cuts <strong style={{ color: C.warning, fontWeight: W.semi }}>~{blueCut(pct)}%</strong> of blue light</div>
            <div>from this app</div>
          </div>

          <button
            onClick={() => setOpen(false)}
            className="ez-press"
            title="Done — close this panel"
            style={{
              marginTop: 10, width: '100%', height: 28, borderRadius: R.sm,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              // Tinted green rather than a solid fill: --ez-positive inverts
              // between themes (#047857 light, #34D399 dark), so white-on-green
              // would drop below AA in dark. The tint pairing holds in both.
              background: C.positiveTint, color: C.positive,
              border: `1px solid ${C.positive}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: F.micro, fontWeight: W.semi,
            }}>
            <TickIcon /> Done
          </button>

          {/* Absent while the control is held, which is itself the signal that
              the countdown has stopped. */}
          {!held && (
            <div key={run} className="ez-eye-countdown"
              style={{ background: C.warning, ['--ez-eye-hold' as string]: `${hold}ms` }}
              aria-hidden />
          )}
        </div>
      )}

      <button onClick={toggle} className="ez-press"
        title={on
          ? `Eye comfort on — about ${blueCut(pct)}% less blue light from this app. Hover to adjust, click to turn off.`
          : 'Eye comfort — warm the screen to cut blue light'}
        aria-label="Eye comfort" aria-pressed={on}
        style={{
          // 36 is the zoom pill's exact height — 26px buttons, 4px padding
          // either side, 1px border. Matching it means the two controls share
          // a baseline as well as a centre line, which is what makes them read
          // as one row rather than two things that happen to be adjacent.
          width: 36, height: 36, borderRadius: 999, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // ON is a solid burnt orange rather than a pale tint. The control
          // warms the screen, so the colour says what it does — and #C2410C is
          // far enough from the theme toggle's #F59E0B that the two warm
          // controls are not mistaken for each other. White on it is 5.18:1;
          // orange-600 was tried first and failed at 3.56:1.
          border: `1px solid ${on ? EYE_ON : C.lineStrong}`,
          background: on ? EYE_ON : C.surface,
          // OFF was C.muted — 7.56:1. C.inkSoft is 10.31:1 light and 11.73:1
          // dark, which matters for a control floating over arbitrary content.
          color: on ? '#FFFFFF' : C.inkSoft,
          boxShadow: on ? `0 2px 10px ${EYE_ON}59, ${E.floating}` : E.floating,
          transition: `background ${M.quick}, color ${M.quick}, border-color ${M.quick}, transform ${M.quick}`,
        }}>
        <EyeIcon on={on} />
      </button>
    </div>
  );
}
