// components/ess/social/icons.tsx — inline SVG for the Social section.
//
// Same construction as components/ess/today/icons.tsx, which is the convention
// for a folder-local set: 24x24, stroke 2, round caps and joins, currentColor.
// (lib/ui/icons.tsx is a different family — 20x20 at stroke 1.6 — and mixing
// the two in one screen is visible as soon as they sit side by side.)
//
// Filled glyphs override fill and drop the stroke, as Star and Flame do there.
import type { SVGProps } from 'react';

const P = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p,
});

/** Birthdays. A cake with one candle — not a number, so no age is implied. */
export const Cake = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M3 21h18M4 21v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5" />
    <path d="M4 17.5c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2" />
    <path d="M12 14V9" /><path d="M12 6.5c0-1 1.2-1.6 1.2-2.8A1.2 1.2 0 0 0 12 2.5a1.2 1.2 0 0 0-1.2 1.2c0 1.2 1.2 1.8 1.2 2.8Z" />
  </svg>
);

/** Work anniversaries. A medal ribbon — service, not celebration. */
export const Medal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <circle cx="12" cy="14.5" r="5.5" /><path d="M12 12.4l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z" />
    <path d="M8.5 9.2 6 2.5h12l-2.5 6.7" />
  </svg>
);

/** New joiners. An open door with someone stepping through. */
export const Door = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8" />
    <path d="M14 3v18M10.5 12h.01" /><path d="M17 8l4 4-4 4M21 12h-7" />
  </svg>
);

/** The Wall of Fame sub-tab. A trophy. */
export const Trophy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 5.5H4.5A2.5 2.5 0 0 0 7 10M17 5.5h2.5A2.5 2.5 0 0 1 17 10" />
    <path d="M12 14v3M9 20h6M10 17h4" />
  </svg>
);

/** Comment. A speech bubble. */
export const Bubble = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" /></svg>
);

/** Add a reaction. A face with a plus. */
export const AddReaction = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M20.9 13a9 9 0 1 1-8.2-9.9" /><path d="M9 10h.01M15 10h.01" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 6.3.7" /><path d="M18 2.5v5M15.5 5h5" />
  </svg>
);

/** Send a wish. A paper plane, matching IconTravel's geometry at 24. */
export const Send = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}><path d="M21 3 2.5 10.2l7.6 2.7 2.7 7.6Z" /><path d="M21 3 10.1 12.9" /></svg>
);

/** A GIF tile in the picker. */
export const Gif = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M10 10.2a2.2 2.2 0 1 0 0 3.6h.6V12M13.5 10v4M16.2 14v-4h3.1M16.2 12.2h2.4" />
  </svg>
);

/** Removed by the authorities. A shield with a slash, never a person. */
export const ShieldOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m4 4 16 16" />
  </svg>
);

/** Welcome / congratulate. A raised hand waving. */
export const Wave = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P(p)}>
    <path d="M11 11V4.6a1.6 1.6 0 1 1 3.2 0V11" /><path d="M14.2 10.4V6.2a1.6 1.6 0 1 1 3.2 0V13" />
    <path d="M7.8 12.6V8.4a1.6 1.6 0 1 1 3.2 0V11" />
    <path d="M7.8 11.2a1.6 1.6 0 1 0-3.2 0v3.6a7 7 0 0 0 7 7h1.2a6.6 6.6 0 0 0 6.6-6.6V13" />
  </svg>
);
