// lib/ui/icons.tsx — the EZER icon set.
//
// Replaces the emoji that stood in for icons in the sidebar. Emoji render
// differently on every OS, carry colour we cannot control, sit on a different
// optical baseline to text, and read as unfinished.
//
// Every icon here shares the same construction so they look like one family:
//   * 20x20 viewBox, drawn on a 1px grid
//   * stroke, never fill, at 1.6 — heavier looks clumsy at 16px, lighter fades
//   * round caps and joins
//   * currentColor, so an icon inherits the colour of whatever it sits in
//
// Size defaults to 18, which is the optical match for 13.5px body text.

import * as React from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  title?: string;
}

/** Shared frame. Every icon below is just a path set handed to this. */
function Svg({
  // Even default. At the quarter-step zoom factors an even size stays whole
  // (16 -> 20 at 1.25, 24 at 1.5), so the 1.6px stroke lands on the grid
  // rather than between two pixels.
  size = 16, color = 'currentColor', strokeWidth = 1.6, style, title, children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

// --- navigation ------------------------------------------------------------

export const IconHome = (p: IconProps) => (
  <Svg {...p}><path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1Z" /></Svg>
);
export const IconRecruitment = (p: IconProps) => (
  <Svg {...p}><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><path d="M10 1v2M10 17v2M1 10h2M17 10h2" /></Svg>
);
export const IconOnboarding = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="6.5" r="3" /><path d="M2.5 17c0-3 2.5-5 5.5-5 1.1 0 2.1.3 3 .8" /><path d="M14.5 12.5v5M12 15h5" /></Svg>
);
export const IconEmployees = (p: IconProps) => (
  <Svg {...p}><circle cx="7.5" cy="6.5" r="2.8" /><path d="M2 16.5c0-2.9 2.5-4.8 5.5-4.8s5.5 1.9 5.5 4.8" /><path d="M13.5 4.2a2.8 2.8 0 0 1 0 5.3M14.8 11.9c1.9.5 3.2 2 3.2 4.1" /></Svg>
);
export const IconUpload = (p: IconProps) => (
  <Svg {...p}><path d="M10 13V3.5M6.5 7 10 3.5 13.5 7" /><path d="M3 13v2.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V13" /></Svg>
);
export const IconTransfer = (p: IconProps) => (
  <Svg {...p}><path d="M3 7h11.5M11.5 3.5 15 7l-3.5 3.5" /><path d="M17 13H5.5M8.5 9.5 5 13l3.5 3.5" /></Svg>
);
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4.5" width="14" height="12.5" rx="1.8" /><path d="M3 8.5h14M7 2.5v3M13 2.5v3" /></Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="10" cy="10" r="7.2" /><path d="M10 5.8V10l2.8 1.8" /></Svg>
);
export const IconLeave = (p: IconProps) => (
  <Svg {...p}><circle cx="10" cy="10" r="3.2" /><path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.4 4.4l1.3 1.3M14.3 14.3l1.3 1.3M15.6 4.4l-1.3 1.3M5.7 14.3l-1.3 1.3" /></Svg>
);
export const IconPayroll = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="5" width="16" height="10" rx="1.8" /><circle cx="10" cy="10" r="2.4" /><path d="M5 8v4M15 8v4" /></Svg>
);
export const IconFinance = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 8 10 3.5 17.5 8" /><path d="M4.5 8v6.5M8.2 8v6.5M11.8 8v6.5M15.5 8v6.5" /><path d="M2.5 17h15" /></Svg>
);
export const IconCard = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="4.5" width="16" height="11" rx="1.8" /><path d="M2 8.5h16M5 12.5h3" /></Svg>
);
export const IconTravel = (p: IconProps) => (
  <Svg {...p}><path d="M17.4 2.6 2.6 8.9l6.2 2.3 2.3 6.2Z" /><path d="M17.4 2.6 8.8 11.2" /></Svg>
);
export const IconLoans = (p: IconProps) => (
  <Svg {...p}><circle cx="10" cy="10" r="7.2" /><path d="M7.6 6.4h4.8M7.6 8.8h4.8" /><path d="M11.4 6.4c0 2.1-1.3 2.9-3 2.9l3.4 4.3" /></Svg>
);
export const IconCompliance = (p: IconProps) => (
  <Svg {...p}><path d="M10 3v14M5 5.5h10" /><path d="M5 5.5 2.8 11h4.4ZM15 5.5 12.8 11h4.4Z" /><path d="M7 17h6" /></Svg>
);
export const IconLetters = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 2.8h7.2L15.5 6.6v10.6H4.5Z" /><path d="M11.5 2.8v4h4M7 10.5h6M7 13.5h4" /></Svg>
);
export const IconMobile = (p: IconProps) => (
  <Svg {...p}><rect x="5.5" y="2.5" width="9" height="15" rx="2" /><path d="M8.8 15.2h2.4" /></Svg>
);
export const IconAdmin = (p: IconProps) => (
  <Svg {...p}><path d="M12.6 3.4a4 4 0 0 0-5.1 5.1l-4.6 4.6a1.4 1.4 0 0 0 0 2l1.5 1.5a1.4 1.4 0 0 0 2 0l4.6-4.6a4 4 0 0 0 5.1-5.1l-2.4 2.4-2.2-.4-.4-2.2Z" /></Svg>
);
export const IconPolicies = (p: IconProps) => (
  <Svg {...p}><path d="M5 3h9a1.5 1.5 0 0 1 1.5 1.5V17H6.5A1.5 1.5 0 0 1 5 15.5Z" /><path d="M5 3a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 1 5 14" /><path d="M8 7h5M8 10h5" /></Svg>
);
export const IconSliders = (p: IconProps) => (
  <Svg {...p}><path d="M3 6h5M12 6h5M3 14h9M16 14h1" /><circle cx="10" cy="6" r="2" /><circle cx="14" cy="14" r="2" /></Svg>
);
export const IconBuilding = (p: IconProps) => (
  <Svg {...p}><path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h6A1.5 1.5 0 0 1 13 4.5V17" /><path d="M13 8.5h2.5A1.5 1.5 0 0 1 17 10v7" /><path d="M2.5 17h15M6.8 6.5h3.4M6.8 9.5h3.4M6.8 12.5h3.4" /></Svg>
);
// A target with an arrow in it — PMS is goals set, then hit. Drawn on the same
// 20x20 grid as the rest: rings at r=7 and r=3, arrow entering from the
// top-right so it does not collide with either ring at 16px.
export const IconPerformance = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="11" r="7" /><circle cx="9" cy="11" r="3" />
    <path d="M9 11l7-7M13 4h3v3" />
  </Svg>
);

export const IconReports = (p: IconProps) => (
  <Svg {...p}><path d="M3 3v14h14" /><path d="M6.5 13.5V10M10 13.5V6.5M13.5 13.5v-5" /></Svg>
);
export const IconDatabase = (p: IconProps) => (
  <Svg {...p}><ellipse cx="10" cy="5" rx="6.5" ry="2.5" /><path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5" /><path d="M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" /></Svg>
);
export const IconAi = (p: IconProps) => (
  <Svg {...p}><path d="M10 2.5 11.5 7l4.5 1.5L11.5 10 10 14.5 8.5 10 4 8.5 8.5 7Z" /><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" /></Svg>
);
export const IconSupport = (p: IconProps) => (
  <Svg {...p}><path d="M4 12v-2a6 6 0 0 1 12 0v2" /><rect x="2.5" y="11" width="3.5" height="5" rx="1.4" /><rect x="14" y="11" width="3.5" height="5" rx="1.4" /><path d="M16 16v.5a2 2 0 0 1-2 2h-2.5" /></Svg>
);

// --- interface -------------------------------------------------------------

export const IconChevron = (p: IconProps) => (
  <Svg {...p}><path d="M7.5 4.5 13 10l-5.5 5.5" /></Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 7.5 10 13l5.5-5.5" /></Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="8.8" cy="8.8" r="5.5" /><path d="M12.8 12.8 17 17" /></Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M5 5l10 10M15 5 5 15" /></Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="M4 10.5 8 14.5l8-9" /></Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M10 4v12M4 10h12" /></Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><circle cx="10" cy="10" r="7.2" /><path d="M10 6v4.5M10 13.6v.1" /></Svg>
);
export const IconBell = (p: IconProps) => (
  <Svg {...p}><path d="M5.5 8a4.5 4.5 0 0 1 9 0c0 3.2.9 4.6 1.5 5.3H4c.6-.7 1.5-2.1 1.5-5.3Z" /><path d="M8.2 16a1.9 1.9 0 0 0 3.6 0" /></Svg>
);
export const IconLogout = (p: IconProps) => (
  <Svg {...p}><path d="M7.5 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h2.5" /><path d="M12 6.5 15.5 10 12 13.5M15.5 10h-8" /></Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}><path d="M10 3v9.5M6.5 9 10 12.5 13.5 9" /><path d="M3 14v1.5A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5V14" /></Svg>
);
