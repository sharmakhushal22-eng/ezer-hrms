// src/features/home/glyphs.tsx — the Today tab's own icons, path for path from
// components/ess/today/icons.tsx (24x24 grid, 2px stroke). They differ from the
// app's 20x20 set in @/ui/icons, and the Home cards use these on the website.
import * as React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

export interface GlyphProps { size?: number; color: string; strokeWidth?: number }

function G({ size = 18, color, strokeWidth = 2, children, fill }: GlyphProps & { children: React.ReactNode; fill?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : 'none'} stroke={fill ? 'none' : color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  )
}

export const GClock = (p: GlyphProps) => <G {...p}><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></G>
export const GFlame = (p: GlyphProps) => <G {...p} fill><Path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1-3s0 3 2 3c1 0 1-2 0-5 2 1 2-1 2-5z" /></G>
export const GDoc = (p: GlyphProps) => <G {...p}><Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><Path d="M14 3v6h6M9 13h6M9 17h6" /></G>
export const GShield = (p: GlyphProps) => <G {...p}><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><Path d="m9 12 2 2 4-4" /></G>
export const GInbox = (p: GlyphProps) => <G {...p}><Path d="M22 12h-6l-2 3h-4l-2-3H2" /><Path d="M5.5 5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-7A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1z" /></G>
export const GCalendar = (p: GlyphProps) => <G {...p}><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></G>
export const GDownload = (p: GlyphProps) => <G {...p}><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></G>
export const GMenu = (p: GlyphProps) => <G {...p}><Path d="M3 6h18M3 12h18M3 18h12" /></G>
export const GUsers = (p: GlyphProps) => <G {...p}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></G>
export const GLayers = (p: GlyphProps) => <G {...p}><Path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></G>
export const GStar = (p: GlyphProps) => <G {...p} fill><Path d="M12 2l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17l-6.1 3.5 1.5-6.8L2.2 9l6.9-.7z" /></G>
export const GCheck = (p: GlyphProps) => <G {...p} strokeWidth={3}><Path d="m5 12 5 5L20 7" /></G>
/** PunchDial's inline "punch in" arrow (into the bar). */
export const GPunchIn = (p: GlyphProps) => <G {...p} strokeWidth={2.2}><Path d="M10 17l5-5-5-5" /><Path d="M15 12H3" /><Path d="M21 3v18" /></G>
/** PunchDial's inline "punch out" arrow (away from the bar). */
export const GPunchOut = (p: GlyphProps) => <G {...p} strokeWidth={2.2}><Path d="M14 17l5-5-5-5" /><Path d="M19 12H7" /><Path d="M3 3v18" /></G>
