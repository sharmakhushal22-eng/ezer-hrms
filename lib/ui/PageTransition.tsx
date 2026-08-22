'use client';
// lib/ui/PageTransition.tsx — movement between sections, and while one loads.
//
// TEXT SHARPNESS IS THE CONSTRAINT HERE
//
// Any transform puts an element on its own compositor layer, and while it is
// there the browser rasterises text at the layer's scale rather than the
// screen's. Get it wrong and every heading on the page goes soft for the
// duration — worse, it can STAY soft if a transform is left applied at rest.
//
// Three rules keep it crisp, and all three are load-bearing:
//
//   1. the animation ends at `transform: none` — not translateZ(0), not
//      scale(1). Any residual transform keeps the layer alive and the text
//      resampled.
//   2. nothing scales. A scaled glyph is a resampled glyph; translation on
//      whole pixels is not.
//   3. will-change is set only for the duration and dropped on completion,
//      because a permanent will-change is a permanent layer.

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { C, M } from './tokens';

/**
 * Wraps page content and replays a short entrance whenever the route changes.
 *
 * The perspective sits on the wrapper and the movement on the child, so the
 * page tilts as one object rather than each card tilting independently — which
 * would read as noise rather than a transition.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settled, setSettled] = React.useState(false);

  // Drop will-change once the entrance is over. Leaving it on pins the layer
  // and the text stays resampled for as long as the page is open.
  React.useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 380);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div style={{ perspective: settled ? undefined : 1200, perspectiveOrigin: '50% 0%' }}>
      <div
        key={pathname}
        // The class comes OFF once the entrance finishes. Leaving it on keeps
        // animation-fill-mode:both applying the final keyframe and, more to
        // the point, keeps backface-visibility:hidden — either is enough to
        // hold the element on its own compositor layer, where text is
        // rasterised at the layer's scale and reads soft. Removing the class
        // is what actually returns the page to normal text rendering.
        className={settled ? undefined : 'ez-page-enter'}
        style={settled ? undefined : { willChange: 'transform, opacity' }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A thin bar across the top of the viewport during navigation.
 *
 * It exists because a route can take a moment to resolve, and in that gap the
 * old page is still on screen with no sign anything is happening. The bar
 * creeps toward 90% and only completes when the new route actually arrives —
 * so it never claims to be finished before it is.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [pct, setPct] = React.useState(0);
  const [on, setOn] = React.useState(false);
  const first = React.useRef(true);

  React.useEffect(() => {
    if (first.current) { first.current = false; return; }  // no bar on first paint
    setOn(true); setPct(8);
    // Ease toward 90 and wait. Reaching 100 before the page is ready would be
    // a lie, and users notice that faster than they notice a slow page.
    const creep = setInterval(() => setPct(p => (p < 90 ? p + (90 - p) * 0.18 : p)), 120);
    const done = setTimeout(() => {
      clearInterval(creep); setPct(100);
      setTimeout(() => { setOn(false); setPct(0); }, 260);
    }, 340);
    return () => { clearInterval(creep); clearTimeout(done); };
  }, [pathname]);

  if (!on) return null;
  return (
    <div aria-hidden style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 9999,
      pointerEvents: 'none',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: `linear-gradient(90deg, ${C.brand}, ${C.brandDeep})`,
        boxShadow: `0 0 8px ${C.brand}`,
        transition: `width ${pct === 100 ? '.18s' : '.32s'} ease-out, opacity .2s ease`,
        opacity: pct === 100 ? 0 : 1,
      }} />
    </div>
  );
}

/**
 * The skeleton shown while a section is still resolving.
 *
 * Shaped like the page it replaces — a heading, a row of tiles, a table — so
 * the layout does not jump when the real content lands. A centred spinner
 * would be less work and would tell the user nothing about what is coming.
 */
export function PageSkeleton() {
  const bar = (w: string | number, h = 12, mt = 0): React.CSSProperties => ({
    width: w, height: h, marginTop: mt, borderRadius: 6,
    background: `linear-gradient(90deg, ${C.sunken} 25%, ${C.brandTint} 50%, ${C.sunken} 75%)`,
    backgroundSize: '200% 100%', animation: 'ezShimmer 1.2s infinite',
  });
  return (
    <div className="ez-fade" style={{ padding: '24px 24px 48px', maxWidth: 1440, margin: '0 auto' }}>
      <div style={bar(220, 24)} />
      <div style={bar(320, 12, 10)} />
      <div style={{
        display: 'grid', gap: 12, marginTop: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, background: C.surface,
          }}>
            <div style={bar('60%', 9)} />
            <div style={bar('45%', 26, 12)} />
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 24, border: `1px solid ${C.line}`, borderRadius: 14,
        background: C.surface, overflow: 'hidden',
      }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
            borderBottom: i < 5 ? `1px solid ${C.line}` : 'none',
          }}>
            <div style={bar(30, 30)} />
            <div style={bar(`${28 + ((i * 11) % 26)}%`)} />
            <div style={{ ...bar(74), marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
