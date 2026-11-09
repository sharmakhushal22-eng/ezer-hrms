// src/features/inbox/glyphs.tsx — the inbox's own icons and colour helpers.
//
// Icons: components/ess/inbox/icons.tsx (Ic + FolderGlyph), same 24×24 paths,
// redrawn with react-native-svg. Colours: the literals the inbox stylesheet
// (components/ess/inbox/inbox.css) hardcodes on purpose — gold, the own-bubble
// gradient, the dark-mode text on a folder pill — and the measured folder inks
// from lib/inbox/streams.ts. None of these are re-picked by eye.
import * as React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import type { FolderCode, FolderVM } from './model'

/** inbox.css --ez-gold (light / dark). Stars, "You staff this", Wall of Fame unread. */
export const GOLD = { l: '#C2751B', d: '#E0A24A' } as const
/** inbox.css `.msg.me .bub` — linear-gradient(180deg,#2563EB,#1D4ED8), white text, in both themes. */
export const MINE_GRAD = ['#2563EB', '#1D4ED8'] as const
export const MINE_INK = '#FFFFFF'
/** inbox.css `.row .un` etc. — text on a folder-ink pill: white in light, #0D1117 in dark. */
export const onInk = (isDark: boolean) => (isDark ? '#0D1117' : '#FFFFFF')
/** inbox.css `.wcard .pav` — the Wall of Fame avatar (gold wash, brown initials). */
export const WALL_AVATAR = { from: '#FFE9C6', to: '#FFBE5C', ink: '#7A4A0E' } as const

/** inbox.css `.thank.done` — white on the gold fill. */
export const ON_GOLD = '#FFFFFF'
export const gold = (isDark: boolean) => (isDark ? GOLD.d : GOLD.l)
export const inkOf = (f: Pick<FolderVM, 'inkLight' | 'inkDark'> | undefined, isDark: boolean, fallback: string) =>
  f ? (isDark ? f.inkDark : f.inkLight) : fallback

/** `color-mix(in srgb, <hex> N%, transparent)` → rgba. */
export function alpha(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

interface P { size?: number; color: string; fill?: string; strokeWidth?: number }
function I({ size = 16, color, fill = 'none', strokeWidth = 1.8, children }: P & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  )
}

export const GChat = (p: P) => <I {...p}><Path d="M4 5h16v11H8l-4 4z" /></I>
export const GStar = (p: P) => <I {...p}><Path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z" /></I>
export const GMegaphone = (p: P) => <I {...p}><Path d="M4 10v4h3l6 4V6l-6 4z" /><Path d="M16 9a4 4 0 010 6" /><Path d="M18.5 6.5a8 8 0 010 11" /></I>
export const GMegaphoneOff = (p: P) => <I {...p}><Path d="M4 10v4h3l6 4V6l-6 4z" /><Path d="M16 9a4 4 0 010 6" /><Path d="M3 3l18 18" /></I>
export const GPlus = (p: P) => <I {...p}><Path d="M12 5v14M5 12h14" /></I>
export const GSearch = (p: P) => <I {...p}><Circle cx="11" cy="11" r="7" /><Path d="M20 20l-3.5-3.5" /></I>
export const GBack = (p: P) => <I {...p}><Path d="M15 5l-7 7 7 7" /></I>
export const GChevron = (p: P) => <I {...p}><Path d="M9 5l7 7-7 7" /></I>
export const GCheck = (p: P) => <I {...p}><Path d="M5 12l4 4L19 6" /></I>
export const GBell = (p: P) => <I {...p}><Path d="M6 8a6 6 0 0112 0v5l2 3H4l2-3z" /><Path d="M10 19a2 2 0 004 0" /></I>
export const GBellOff = (p: P) => <I {...p}><Path d="M6 8a6 6 0 0112 0v5l2 3H4l2-3z" /><Path d="M4 4l16 16" /></I>
export const GLock = (p: P) => <I {...p}><Rect x="4" y="10" width="16" height="10" rx="2" /><Path d="M8 10V7a4 4 0 018 0v3" /></I>
export const GSend = (p: P) => <I {...p}><Path d="M4 12L20 4l-4 16-4-7z" /></I>
export const GDown = (p: P) => <I {...p}><Path d="M12 5v14M5 12l7 7 7-7" /></I>
export const GHeart = (p: P) => <I {...p}><Path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /></I>
export const GReply = (p: P) => <I {...p}><Path d="M9 14l-5-5 5-5" /><Path d="M4 9h10a6 6 0 016 6v4" /></I>
export const GDesk = (p: P) => <I {...p}><Path d="M3 9l9-6 9 6v11H3z" /><Path d="M9 20v-6h6v6" /></I>

/** icons.tsx FolderGlyph — a SYSTEM stream's glyph, keyed by folder. Falls back to the bell. */
export function FolderGlyph({ code, ...p }: P & { code: FolderCode | 'ALL' }) {
  switch (code) {
    case 'TIME': return <I {...p}><Rect x="3" y="5" width="18" height="16" rx="2" /><Path d="M3 10h18M8 3v4M16 3v4" /><Path d="M9 15l2 2 4-4" /></I>
    case 'HR': return <I {...p}><Path d="M6 3h9l5 5v13H6z" /><Path d="M14 3v6h6M9 13h6M9 17h6" /></I>
    case 'PAYROLL': return <I {...p}><Rect x="3" y="6" width="18" height="12" rx="2" /><Circle cx="12" cy="12" r="2.5" /><Path d="M7 12h.01M17 12h.01" /></I>
    case 'FUNZONE': return <I {...p}><Path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" /><Path d="M7 7h10a4 4 0 014 4v2a4 4 0 01-4 4H7a4 4 0 01-4-4v-2a4 4 0 014-4z" /></I>
    case 'PERFORMANCE': return <I {...p}><Path d="M4 19V5M4 19h16" /><Path d="M8 15l3-4 3 2 4-6" /></I>
    default: return <GBell {...p} />
  }
}
