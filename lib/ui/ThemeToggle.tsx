'use client';
// lib/ui/ThemeToggle.tsx — light / dark / follow-the-system.
//
// The choice is written to `data-ez-theme` on <html>, which is what
// lib/ui/theme.css keys off. Three states rather than two, because "follow the
// OS" is a real preference and a two-way switch silently overrides it.

import * as React from 'react';
import { C, F, W, R, M } from './tokens';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'ezer_theme';

/**
 * Runs before React hydrates, from a <script> in the document head.
 *
 * Without this the page paints with the default theme and then corrects
 * itself once JS runs — a white flash on every load for anyone using dark.
 * It is inlined as a string precisely so it can run that early.
 */
export const themeBootScript = `
(function(){try{
  var c = localStorage.getItem('${KEY}');
  if (c === 'light' || c === 'dark') document.documentElement.setAttribute('data-ez-theme', c);
}catch(e){}})();`;

/** Read the stored choice. 'system' when nothing has been chosen. */
export function getThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** How long the fallback keeps its transition class on. Matches the CSS. */
const SWITCH_MS = 300;

/**
 * Applies the choice, cross-fading the whole page as it goes.
 *
 * The swap itself is one attribute on <html> — every colour in the product is
 * a variable keyed off it. What matters is how that instant change is
 * presented.
 *
 * A view transition is the right tool because the cost does not scale with the
 * page: the browser snapshots before and after and dissolves two bitmaps on
 * the compositor. The alternative, transitioning colour on every element, was
 * animating 772 nodes at once and dropping frames, and still could not carry
 * gradients, SVG fills or shadows because those either do not interpolate or
 * were not listed.
 *
 * The fallback path exists for browsers without it. Its class goes on for the
 * length of the switch and comes straight off, so it never becomes the
 * permanent tax on hover states that the old rule was.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;

  const swap = () => {
    if (choice === 'system') {
      root.removeAttribute('data-ez-theme');
      localStorage.removeItem(KEY);
    } else {
      root.setAttribute('data-ez-theme', choice);
      localStorage.setItem(KEY, choice);
    }
  };

  // Someone who has asked for less motion is asking not to be cross-faded
  // either; the swap still happens, just immediately.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { swap(); return; }

  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === 'function') { doc.startViewTransition(swap); return; }

  root.classList.add('ez-theming');
  swap();
  window.setTimeout(() => root.classList.remove('ez-theming'), SWITCH_MS + 20);
}

// Declared at module level: a component defined inside another is a new type
// on every render, which remounts it and drops focus.
function Seg({ label, title, on, onClick, children }: {
  label: string; title: string; on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={on}
      style={{
        width: 28, height: 26, borderRadius: R.sm, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? C.surface : 'transparent',
        color: on ? C.brandDeep : C.faint,
        boxShadow: on ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
        transition: `background ${M.quick}, color ${M.quick}, box-shadow ${M.quick}`,
        fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi,
      }}>
      {children}
      <span style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0,0,0,0)' }}>{label}</span>
    </button>
  );
}

const Sun = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.2v1.6M10 16.2v1.6M2.2 10h1.6M16.2 10h1.6M4.5 4.5l1.1 1.1M14.4 14.4l1.1 1.1M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1" />
  </svg>
);
const Moon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16.5 11.8A6.8 6.8 0 0 1 8.2 3.5a6.8 6.8 0 1 0 8.3 8.3Z" />
  </svg>
);
const Auto = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2.5" y="4" width="15" height="10" rx="1.6" />
    <path d="M7 17h6" />
  </svg>
);

/**
 * The control itself. `onDark` styles it for the navigation rail, where the
 * track needs to read against a dark ground rather than a card.
 */
export function ThemeToggle({ onDark, compact }: { onDark?: boolean; compact?: boolean }) {
  const [choice, setChoice] = React.useState<ThemeChoice>('system');

  // Read after mount. Reading during render would disagree with the server
  // output and hydrate mismatched.
  React.useEffect(() => { setChoice(getThemeChoice()); }, []);

  const pick = (c: ThemeChoice) => { applyTheme(c); setChoice(c); };

  if (compact) {
    // One button that cycles, for a collapsed rail with no room for three.
    const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';
    const label = choice === 'light' ? 'Light' : choice === 'dark' ? 'Dark' : 'System';
    return (
      <button onClick={() => pick(next)} title={`Theme: ${label} — switch to ${next}`}
        aria-label={`Theme: ${label}`}
        style={{
          width: 34, height: 34, borderRadius: R.md, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${onDark ? C.onDarkLine : C.line}`,
          background: 'transparent', color: onDark ? C.onDarkMuted : C.muted,
          transition: `color ${M.quick}, background ${M.quick}`,
        }}>
        {choice === 'dark' ? <Moon /> : choice === 'light' ? <Sun /> : <Auto />}
      </button>
    );
  }

  return (
    <div role="group" aria-label="Colour theme" style={{
      display: 'inline-flex', gap: 2, padding: 2, borderRadius: R.md,
      background: onDark ? 'rgba(0,0,0,.22)' : C.sunken,
      border: `1px solid ${onDark ? C.onDarkLine : C.line}`,
    }}>
      <Seg label="Light"  title="Light theme"      on={choice === 'light'}  onClick={() => pick('light')}><Sun /></Seg>
      <Seg label="Dark"   title="Dark theme"       on={choice === 'dark'}   onClick={() => pick('dark')}><Moon /></Seg>
      <Seg label="System" title="Follow my system" on={choice === 'system'} onClick={() => pick('system')}><Auto /></Seg>
    </div>
  );
}
