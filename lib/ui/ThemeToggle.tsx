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

/**
 * Each mode gets its own hue, and that is the whole point of this control's
 * design. Before, it was a 34px square with a 1px C.line border and a C.muted
 * glyph — byte-for-byte the same shell as the notification bell sitting next to
 * it, so it read as "another grey icon" rather than as a mode selector.
 *
 * Luminance cannot do the discriminating here: a grey icon button is already
 * 7.56:1 on white, so making this darker or lighter only makes it a different
 * grey. HUE does it. Amber for day, indigo for night, teal for follow-the-
 * system — three colours that appear nowhere else in the chrome.
 *
 * Fills and inks are AA on each other, measured:
 *     amber  #1F2937 on #F59E0B   6.83:1
 *     indigo #FFFFFF on #4F46E5   6.29:1
 *     teal   #FFFFFF on #0F766E   5.47:1
 */
const MODE: Record<ThemeChoice, { fill: string; ink: string; label: string }> = {
  light:  { fill: '#F59E0B', ink: '#1F2937', label: 'Light' },
  dark:   { fill: '#4F46E5', ink: '#FFFFFF', label: 'Dark' },
  system: { fill: '#0F766E', ink: '#FFFFFF', label: 'System' },
};

/** Injected once. The ring has to invert: a dark outline is invisible on a
 *  dark track and a light one disappears on a light track, so it is a token
 *  rather than a constant. */
export function ThemeToggleStyles() {
  return (
    <style>{`
      :root { --ez-seg-ring: rgba(15,23,42,.30); --ez-seg-shadow: rgba(15,23,42,.22); }
      @media (prefers-color-scheme: dark) {
        :root:not([data-ez-theme="light"]) { --ez-seg-ring: rgba(255,255,255,.42); --ez-seg-shadow: rgba(0,0,0,.55); }
      }
      :root[data-ez-theme="dark"]  { --ez-seg-ring: rgba(255,255,255,.42); --ez-seg-shadow: rgba(0,0,0,.55); }
      :root[data-ez-theme="light"] { --ez-seg-ring: rgba(15,23,42,.30);  --ez-seg-shadow: rgba(15,23,42,.22); }

      .ez-seg { transition: background .18s ease, color .18s ease, transform .18s cubic-bezier(.2,.8,.2,1); }
      .ez-seg:hover { transform: translateY(-1px); }
      .ez-seg:active { transform: translateY(0) scale(.94); }
      .ez-seg-on { box-shadow: 0 0 0 1.5px var(--ez-seg-ring), 0 2px 6px var(--ez-seg-shadow); }
      @media (prefers-reduced-motion: reduce) {
        .ez-seg, .ez-seg:hover, .ez-seg:active { transition: none; transform: none; }
      }
    `}</style>
  );
}

function Seg({ mode, title, on, onClick, children }: {
  mode: ThemeChoice; title: string; on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const m = MODE[mode];
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={on}
      className={`ez-seg${on ? ' ez-seg-on' : ''}`}
      style={{
        width: 30, height: 28, borderRadius: R.md, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? m.fill : 'transparent',
        color: on ? m.ink : C.muted,
        fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi,
        position: 'relative',
      }}>
      {children}
    </button>
  );
}

// Filled rather than hairline. At 16px a 1.7px stroke is four grey pixels and
// reads as texture; a solid shape reads as a symbol.
const Sun = () => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="10" cy="10" r="4" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 1.4v2.1M10 16.5v2.1M1.4 10h2.1M16.5 10h2.1M3.9 3.9l1.5 1.5M14.6 14.6l1.5 1.5M16.1 3.9l-1.5 1.5M5.4 14.6l-1.5 1.5" />
    </g>
  </svg>
);
const Moon = () => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M16.8 12.2A7.2 7.2 0 0 1 7.8 3.2a7.2 7.2 0 1 0 9 9Z" fill="currentColor" />
  </svg>
);
// Half-lit disc: the one glyph that says "whichever the system is" without
// needing a label. A monitor outline said "display", which is a different idea.
const Auto = () => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M10 3a7 7 0 0 1 0 14Z" fill="currentColor" />
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
    // One button that cycles, for a collapsed rail or a phone header.
    //
    // This is the variant that was indistinguishable: 34x34, R.md, a 1px
    // C.line border and a C.muted glyph — identical to the notification bell
    // beside it. It is now filled with the CURRENT mode's colour, so it is the
    // one control in the bar that carries a hue, and the hue also tells you
    // which mode you are in without opening anything.
    const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';
    const m = MODE[choice];
    return (
      <>
      <ThemeToggleStyles />
      <button onClick={() => pick(next)}
        title={`Theme: ${m.label} — switch to ${MODE[next].label}`}
        aria-label={`Theme: ${m.label}. Switch to ${MODE[next].label}.`}
        className="ez-seg ez-seg-on"
        style={{
          width: 34, height: 34, borderRadius: R.md, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: m.fill, color: m.ink,
        }}>
        {choice === 'dark' ? <Moon /> : choice === 'light' ? <Sun /> : <Auto />}
      </button>
      </>
    );
  }

  return (
    <>
      <ThemeToggleStyles />
      <div role="group" aria-label="Colour theme" style={{
        display: 'inline-flex', gap: 3, padding: 3, borderRadius: R.lg,
        background: onDark ? 'rgba(0,0,0,.28)' : C.sunken,
        // A stronger edge than the old 1px C.line (1.24:1 on white — chrome
        // nobody can see). This reads as a container, which is what tells you
        // the three glyphs are one control rather than three buttons.
        border: `1px solid ${onDark ? C.onDarkLine : C.lineStrong}`,
      }}>
        <Seg mode="light"  title="Light theme"      on={choice === 'light'}  onClick={() => pick('light')}><Sun /></Seg>
        <Seg mode="dark"   title="Dark theme"       on={choice === 'dark'}   onClick={() => pick('dark')}><Moon /></Seg>
        <Seg mode="system" title="Follow my system" on={choice === 'system'} onClick={() => pick('system')}><Auto /></Seg>
      </div>
    </>
  );
}
