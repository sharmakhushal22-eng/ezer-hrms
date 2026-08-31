// lib/ui/Logo.tsx — the EZER mark, in whichever variant the theme needs.
//
// ── WHY THERE ARE TWO FILES ─────────────────────────────────────────────────
// The supplied artwork is drawn for a dark ground, but its "ZER" wordmark is
// #022557 — near-black. Measured against the two rails:
//
//     on the light rail  #FFFFFF   14.91:1   fine
//     on the dark rail   #171B21    1.11:1   invisible
//
// It reads on the original because of the glow behind it, not because the
// letters are light. Dropped straight into the app, half the wordmark would
// disappear in dark mode. So ezer-logo-dark.png lifts only the near-black ink
// toward white and leaves the blue emblem and glow alone — the mark keeps its
// identity rather than becoming a white silhouette. That variant measures
// 12.42:1 on the dark rail.
//
// ── WHY CSS AND NOT JAVASCRIPT ──────────────────────────────────────────────
// The theme has THREE states, not two: data-ez-theme="light", "dark", and — the
// default — no attribute at all, where only prefers-color-scheme decides. A JS
// swap would also flash the wrong variant before hydration. Both images are
// rendered and the cascade picks one, so it is correct on first paint in every
// state.

import * as React from 'react';

/** Injected once. Mirrors the token rules in theme.css: bare :root is light,
 *  the media query is guarded so an explicit light choice beats a dark OS, and
 *  the [data-ez-theme] rules win in both directions. */
export function LogoStyles() {
  return (
    <style>{`
      .ez-logo-dark { display: none; }
      .ez-logo-light { display: block; }
      @media (prefers-color-scheme: dark) {
        :root:not([data-ez-theme="light"]) .ez-logo-light { display: none; }
        :root:not([data-ez-theme="light"]) .ez-logo-dark  { display: block; }
      }
      :root[data-ez-theme="dark"] .ez-logo-light { display: none; }
      :root[data-ez-theme="dark"] .ez-logo-dark  { display: block; }
      :root[data-ez-theme="light"] .ez-logo-light { display: block; }
      :root[data-ez-theme="light"] .ez-logo-dark  { display: none; }
    `}</style>
  );
}

/**
 * `height` drives the size; width follows the artwork's own ratio, so the mark
 * is never stretched by a caller guessing at both.
 *
 * `variant="mark"` is the emblem alone, for a collapsed rail or anywhere the
 * full wordmark would be illegibly small. The emblem is bright blue in both
 * themes and needs no second file.
 *
 * `onDark` forces the light-ink variant regardless of theme — for the few
 * surfaces that stay dark in every theme, like the admin "viewing as" banner.
 */
export function Logo({
  height = 34,
  variant = 'full',
  onDark = false,
  title = 'EZER HRMS',
}: {
  height?: number;
  variant?: 'full' | 'mark';
  onDark?: boolean;
  title?: string;
}) {
  if (variant === 'mark') {
    // 180 × 350 artwork.
    return (
      <img src="/brand/ezer-mark.png" alt={title} title={title}
           style={{ height, width: 'auto', display: 'block', flexShrink: 0 }} />
    );
  }

  // 840 × 537 artwork.
  if (onDark) {
    return (
      <img src="/brand/ezer-logo-dark.png" alt={title} title={title}
           style={{ height, width: 'auto', display: 'block', flexShrink: 0 }} />
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexShrink: 0, lineHeight: 0 }}>
      <img className="ez-logo-light" src="/brand/ezer-logo.png" alt={title} title={title}
           style={{ height, width: 'auto', flexShrink: 0 }} />
      <img className="ez-logo-dark" src="/brand/ezer-logo-dark.png" alt="" aria-hidden
           style={{ height, width: 'auto', flexShrink: 0 }} />
    </span>
  );
}
