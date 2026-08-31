'use client';
// lib/ui/Logo.tsx — the EZER mark, drawn rather than photographed.
//
// ── WHY THIS IS SVG AND NOT THE PNG ─────────────────────────────────────────
// The supplied artwork bakes its glow into the pixels and paints the wordmark
// in #022557 — near-black. That measures 1.11:1 on the dark rail: invisible.
// Recolouring a raster to fix it only produced a muddy version of the same
// problem, because the glow is part of the image and cannot be re-lit.
//
// Drawn as vector, every colour is a token, so the mark is legible in all
// three theme states instead of one. It also scales without softening, weighs
// ~4KB instead of 300KB across two files, and can move.
//
// ── DEPTH ───────────────────────────────────────────────────────────────────
// The 3D is lighting, not bevel filters: a single light source at the top-left
// gives the disc a specular highlight and a terminator, the ring casts an inner
// shadow, and the E sits on a soft contact shadow. Filters would blur at small
// sizes and cost a raster pass on every repaint.
//
// ── MOTION ──────────────────────────────────────────────────────────────────
// The ring orbits, slowly. That is one idea, not five: the mark reads as an
// orbit, so the orbit is what moves. A sheen crosses the wordmark once on
// mount and on hover. Everything stops under prefers-reduced-motion.

import * as React from 'react';

let uid = 0;

/** Injected once per page. Keyframes and the theme-dependent ink. */
export function LogoStyles() {
  return (
    <style>{`
      /* The wordmark is the only part that must invert. The emblem's blues
         carry on both grounds, which is why the ring and disc never change. */
      :root { --ez-logo-word: #0B1F3A; --ez-logo-word-soft: #33507A; --ez-logo-glow: rgba(37,99,235,.28); }
      @media (prefers-color-scheme: dark) {
        :root:not([data-ez-theme="light"]) {
          --ez-logo-word: #EEF4FF; --ez-logo-word-soft: #9FB6D8; --ez-logo-glow: rgba(96,165,250,.42);
        }
      }
      :root[data-ez-theme="dark"] {
        --ez-logo-word: #EEF4FF; --ez-logo-word-soft: #9FB6D8; --ez-logo-glow: rgba(96,165,250,.42);
      }
      :root[data-ez-theme="light"] {
        --ez-logo-word: #0B1F3A; --ez-logo-word-soft: #33507A; --ez-logo-glow: rgba(37,99,235,.28);
      }
      /* On a permanently dark surface the theme is irrelevant — force it. */
      .ez-logo--ondark { --ez-logo-word: #FFFFFF; --ez-logo-word-soft: #B9CCEA; --ez-logo-glow: rgba(125,211,252,.5); }

      @keyframes ez-logo-orbit { to { transform: rotate(360deg); } }
      @keyframes ez-logo-rise  { from { opacity:0; transform: translateY(4px) scale(.92); } to { opacity:1; transform:none; } }
      @keyframes ez-logo-sheen { from { transform: translateX(-120%); } to { transform: translateX(220%); } }

      .ez-logo { display:inline-flex; align-items:center; gap:.55em; line-height:0; }
      .ez-logo__ring { transform-origin: 64px 64px; animation: ez-logo-orbit 18s linear infinite; }
      .ez-logo__person { animation: ez-logo-rise .5s cubic-bezier(.2,.8,.2,1) both; }
      .ez-logo__glow { transition: opacity .35s ease; opacity:.85; }
      .ez-logo:hover .ez-logo__glow { opacity:1; }
      .ez-logo__emblem { transition: transform .35s cubic-bezier(.2,.8,.2,1); }
      .ez-logo:hover .ez-logo__emblem { transform: translateY(-1px) scale(1.03); }

      .ez-logo__word { position:relative; overflow:hidden; }
      .ez-logo__sheen {
        position:absolute; inset:0; pointer-events:none;
        background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.55) 50%, transparent 65%);
        animation: ez-logo-sheen 1.5s ease-out .35s 1 both;
      }
      .ez-logo:hover .ez-logo__sheen { animation: ez-logo-sheen 1.1s ease-out 1; }

      @media (prefers-reduced-motion: reduce) {
        .ez-logo__ring, .ez-logo__person, .ez-logo__sheen { animation: none !important; }
        .ez-logo__emblem { transition: none; }
        .ez-logo__sheen { display:none; }
      }
    `}</style>
  );
}

function Emblem({ size, id }: { size: number; id: string }) {
  return (
    <svg className="ez-logo__emblem" width={size} height={size} viewBox="0 0 128 128"
         fill="none" aria-hidden focusable="false" style={{ overflow: 'visible', flexShrink: 0 }}>
      <defs>
        {/* Light from the top-left: bright cyan shoulder, deep blue terminator. */}
        <linearGradient id={`${id}-disc`} x1="26" y1="18" x2="104" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7DD3FC" />
          <stop offset=".38" stopColor="#38BDF8" />
          <stop offset=".72" stopColor="#2563EB" />
          <stop offset="1" stopColor="#1E3A8A" />
        </linearGradient>
        {/* The specular cap — a second, tighter light on the same axis. */}
        <radialGradient id={`${id}-spec`} cx="42" cy="34" r="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".72" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="8" y1="40" x2="120" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#BAE6FD" stopOpacity=".15" />
          <stop offset=".28" stopColor="#7DD3FC" stopOpacity=".95" />
          <stop offset=".62" stopColor="#38BDF8" stopOpacity=".85" />
          <stop offset="1" stopColor="#2563EB" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id={`${id}-people`} x1="40" y1="6" x2="88" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E0F2FE" />
          <stop offset="1" stopColor="#7DD3FC" />
        </linearGradient>
        <linearGradient id={`${id}-bar`} x1="44" y1="48" x2="92" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DBEAFE" />
        </linearGradient>
      </defs>

      {/* Ambient glow. Sits behind everything and lifts the mark off any ground —
          this is what makes it read on a white rail as well as a dark one. */}
      <circle className="ez-logo__glow" cx="64" cy="66" r="46" fill="var(--ez-logo-glow)" />

      {/* Contact shadow, so the disc sits ON the surface rather than floating. */}
      <ellipse cx="64" cy="108" rx="30" ry="5.5" fill="#1E3A8A" opacity=".16" />

      {/* The disc. The outer rim is not decoration: the lit shoulder of the
          sphere is #7DD3FC, only 2.14:1 against a white rail, so without a
          defining edge the top-left of the mark dissolves into the surface in
          light mode. The rim guarantees the silhouette on any ground. */}
      <circle cx="64" cy="66" r="35.2" fill="none" stroke="#1D4ED8" strokeOpacity=".55" strokeWidth="2.2" />
      <circle cx="64" cy="66" r="34" fill={`url(#${id}-disc)`} />
      <circle cx="64" cy="66" r="34" fill={`url(#${id}-spec)`} />
      {/* Rim light along the shadowed edge — the trick that stops a flat circle
          reading as a sticker. */}
      <circle cx="64" cy="66" r="33" fill="none" stroke="#BAE6FD" strokeOpacity=".45" strokeWidth="1.4"
              strokeDasharray="60 150" strokeDashoffset="-96" strokeLinecap="round" />

      {/* The E: three bars and a spine, with a soft drop so they sit above the disc. */}
      <g transform="translate(0,1)" opacity=".22">
        <rect x="49" y="50" width="9" height="34" rx="4.5" fill="#0C2A6B" />
        <rect x="49" y="50" width="32" height="9" rx="4.5" fill="#0C2A6B" />
        <rect x="49" y="61.5" width="24" height="8" rx="4" fill="#0C2A6B" />
        <rect x="49" y="75" width="32" height="9" rx="4.5" fill="#0C2A6B" />
      </g>
      <g fill={`url(#${id}-bar)`}>
        <rect x="49" y="49" width="9" height="34" rx="4.5" />
        <rect x="49" y="49" width="32" height="9" rx="4.5" />
        <rect x="49" y="60.5" width="24" height="8" rx="4" />
        <rect x="49" y="74" width="32" height="9" rx="4.5" />
      </g>

      {/* Three figures — the "people" of people · process · performance. */}
      <g fill={`url(#${id}-people)`}>
        <g className="ez-logo__person" style={{ animationDelay: '.05s', transformOrigin: '44px 26px' }}>
          <circle cx="44" cy="24" r="6" />
          <path d="M34 39c0-5.5 4.5-9 10-9s10 3.5 10 9z" />
        </g>
        <g className="ez-logo__person" style={{ animationDelay: '.15s', transformOrigin: '64px 20px' }}>
          <circle cx="64" cy="17" r="7.5" />
          <path d="M52 34c0-6.6 5.4-11 12-11s12 4.4 12 11z" />
        </g>
        <g className="ez-logo__person" style={{ animationDelay: '.25s', transformOrigin: '84px 26px' }}>
          <circle cx="84" cy="24" r="6" />
          <path d="M74 39c0-5.5 4.5-9 10-9s10 3.5 10 9z" />
        </g>
      </g>

      {/* The orbit. Drawn last so it crosses in front of the disc, and rotated
          about the disc's centre so the motion reads as orbit, not wobble. */}
      <g className="ez-logo__ring">
        <ellipse cx="64" cy="66" rx="58" ry="23" transform="rotate(-24 64 66)"
                 fill="none" stroke={`url(#${id}-ring)`} strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/**
 * `height` is the type size of the wordmark; the emblem is scaled from it, so
 * one number keeps the lockup in proportion.
 *
 * `variant="mark"` is the emblem alone, for a collapsed rail or a favicon.
 * `onDark` forces light ink for surfaces that stay dark in every theme.
 */
export function Logo({
  height = 40,
  variant = 'full',
  onDark = false,
  title = 'EZER HRMS',
  tagline = false,
}: {
  height?: number;
  variant?: 'full' | 'mark';
  onDark?: boolean;
  title?: string;
  tagline?: boolean;
}) {
  const id = React.useMemo(() => `ezl${++uid}`, []);
  const cls = `ez-logo${onDark ? ' ez-logo--ondark' : ''}`;

  if (variant === 'mark') {
    return (
      <span className={cls} title={title} role="img" aria-label={title}>
        <Emblem size={height} id={id} />
      </span>
    );
  }

  return (
    <span className={cls} title={title} role="img" aria-label={title}>
      <Emblem size={height * 1.28} id={id} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span className="ez-logo__word" style={{
          fontSize: height * 0.86, fontWeight: 800, letterSpacing: '-.03em',
          color: 'var(--ez-logo-word)', whiteSpace: 'nowrap',
        }}>
          EZER
          <span className="ez-logo__sheen" />
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: height * 0.13,
          marginTop: height * 0.1,
        }}>
          <span aria-hidden style={{
            height: 1, width: height * 0.28,
            background: 'linear-gradient(90deg, transparent, var(--ez-logo-word-soft))',
          }} />
          <span style={{
            fontSize: height * 0.34, fontWeight: 700, letterSpacing: '.34em',
            color: 'var(--ez-logo-word-soft)', whiteSpace: 'nowrap',
          }}>HRMS</span>
          <span aria-hidden style={{
            height: 1, flex: 1, minWidth: height * 0.28,
            background: 'linear-gradient(90deg, var(--ez-logo-word-soft), transparent)',
          }} />
        </span>
        {tagline && (
          <span style={{
            fontSize: height * 0.22, fontWeight: 600, letterSpacing: '.2em',
            color: 'var(--ez-logo-word-soft)', opacity: .85, marginTop: height * 0.14,
            whiteSpace: 'nowrap',
          }}>PEOPLE · PROCESS · PERFORMANCE</span>
        )}
      </span>
    </span>
  );
}
