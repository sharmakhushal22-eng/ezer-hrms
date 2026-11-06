// src/ui/theme.ts — the EZER design tokens for the Android app.
//
// THE SOURCE OF TRUTH IS THE WEBSITE. Every value below is copied from
// lib/ui/theme.css (the --ez-* custom properties, light and dark blocks) and
// components/ess/portal.css (the --ess-* overrides the employee portal paints
// on top: its canvas, rail, chip and gradient). The names match the web's `C`
// object in lib/ui/tokens.ts, so a screen ported from the website reads the
// same: `C.surface`, `C.brand`, `C.warningTint`…
//
// React Native has no CSS variables, so instead of `var(--ez-ink)` each token
// resolves to a literal for the active scheme, and useTheme() hands a screen
// the palette for light or dark. Changing a value here changes it across the
// app — never hardcode a hex in a screen.

export interface Palette {
  ink: string; inkSoft: string; muted: string; faint: string
  brand: string; brandDeep: string; brandTint: string; brandEdge: string
  onAccent: string; onAccentSoft: string
  surface: string; canvas: string; sunken: string
  line: string; lineStrong: string
  positive: string; positiveTint: string; positiveEdge: string
  warning: string; warningTint: string; warningEdge: string
  critical: string; criticalTint: string; criticalEdge: string
  info: string; infoTint: string; infoEdge: string
  // The ESS shell (portal.css)
  railBg: string; railInk: string; railEdge: string
  essInk: string; essInk2: string; essInk3: string
  chip: string; chipInk: string; hair: string
  /** The one gradient the portal uses: #3B82F6 → brand (portal.css --ess-grad). */
  gradFrom: string; gradTo: string
  /** Header band (theme.css --ez-head-*). */
  headFrom: string; headTo: string; headEdge: string
  /** Deliberately inverted surfaces. */
  dark: string; darkMid: string; darkAccent: string; onDark: string; onDarkMuted: string
  /** Shadow colour for elevation (RN draws the blur itself). */
  shadow: string
  /** Logo wordmark ink (lib/ui/Logo.tsx --ez-logo-word*). */
  logoWord: string; logoWordSoft: string; logoGlow: string
  scrim: string
}

export const light: Palette = {
  ink: '#111827', inkSoft: '#374151', muted: '#4B5563', faint: '#626D80',
  brand: '#2563EB', brandDeep: '#1D4ED8', brandTint: '#EFF6FF', brandEdge: '#BFDBFE',
  onAccent: '#FFFFFF', onAccentSoft: 'rgba(255,255,255,0.95)',
  surface: '#FFFFFF', canvas: '#F6F8FB', sunken: '#F3F4F6',
  line: '#E5E7EB', lineStrong: '#D1D5DB',
  positive: '#047857', positiveTint: '#ECFDF5', positiveEdge: '#A9DCC7',
  warning: '#B45309', warningTint: '#FFFBEB', warningEdge: '#E8CB94',
  critical: '#C0201F', criticalTint: '#FEF2F2', criticalEdge: '#EFB4B7',
  info: '#0369A1', infoTint: '#F0F9FF', infoEdge: '#AFCBF6',
  railBg: '#EBF0F7', railInk: '#1F2A44', railEdge: '#DCE3EE',
  essInk: '#0F172A', essInk2: '#334155', essInk3: '#64748B',
  chip: 'rgba(37,99,235,0.09)', chipInk: '#1D4ED8', hair: 'rgba(15,23,42,0.07)',
  gradFrom: '#3B82F6', gradTo: '#2563EB',
  headFrom: '#E4EDFA', headTo: '#CFDEF3', headEdge: '#B4CCEB',
  dark: '#111827', darkMid: '#16264A', darkAccent: '#1F3A6B', onDark: '#F9FAFB', onDarkMuted: 'rgba(249,250,251,0.78)',
  shadow: '#1E3A8A',
  logoWord: '#0B1F3A', logoWordSoft: '#33507A', logoGlow: 'rgba(37,99,235,0.28)',
  scrim: 'rgba(15,23,42,0.45)',
}

export const dark: Palette = {
  ink: '#F3F4F6', inkSoft: '#D1D5DB', muted: '#9CA3AF', faint: '#828C9B',
  brand: '#60A5FA', brandDeep: '#93C5FD', brandTint: '#172033', brandEdge: '#24344F',
  onAccent: '#0D1117', onAccentSoft: 'rgba(13,17,23,0.92)',
  surface: '#171B21', canvas: '#0D1117', sunken: '#14181E',
  line: '#262C35', lineStrong: '#39414D',
  positive: '#34D399', positiveTint: '#10241D', positiveEdge: '#1E4A3C',
  warning: '#FBBF24', warningTint: '#251C0D', warningEdge: '#4A3A18',
  critical: '#F87171', criticalTint: '#2A1414', criticalEdge: '#542626',
  info: '#7DD3FC', infoTint: '#10222B', infoEdge: '#1D4257',
  railBg: '#181E2C', railInk: '#CBD5E1', railEdge: 'rgba(255,255,255,0.06)',
  essInk: '#F1F5F9', essInk2: '#CBD5E1', essInk3: '#94A3B8',
  chip: 'rgba(96,165,250,0.14)', chipInk: '#93C5FD', hair: 'rgba(255,255,255,0.07)',
  gradFrom: '#3B82F6', gradTo: '#2563EB',
  headFrom: '#1E2E4E', headTo: '#141D31', headEdge: '#2C4370',
  dark: '#0B0E12', darkMid: '#131F3A', darkAccent: '#1B3157', onDark: '#F9FAFB', onDarkMuted: 'rgba(249,250,251,0.78)',
  shadow: '#000000',
  logoWord: '#EEF4FF', logoWordSoft: '#9FB6D8', logoGlow: 'rgba(96,165,250,0.42)',
  scrim: 'rgba(0,0,0,0.6)',
}

/** Type scale — lib/ui/tokens.ts F. */
export const F = { micro: 11, tiny: 12, small: 13, body: 14, lead: 15, title: 18, page: 22, display: 28 } as const
/** Weights — lib/ui/tokens.ts W. */
export const W = { regular: 400, medium: 500, semi: 600, bold: 700, heavy: 800 } as const
/** Space — lib/ui/tokens.ts S (4px base). */
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const
/** Radius — lib/ui/tokens.ts R. ESS cards use 18 (portal.css .ess-card). */
export const R = { sm: 7, md: 10, lg: 14, card: 18, xl: 20, pill: 999 } as const

/** DM Sans, one family per weight — Android cannot synthesise weights for a custom font. */
export const FONT: Record<number, string> = {
  400: 'DMSans_400Regular', 500: 'DMSans_500Medium', 600: 'DMSans_600SemiBold',
  700: 'DMSans_700Bold', 800: 'DMSans_800ExtraBold',
}
/** Fraunces — the serif the website's Today tab uses for its greeting. */
export const SERIF = 'Fraunces_600SemiBold'

export type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'critical' | 'info'

/** lib/ui/tokens.ts tone(): semantic colour as a set, so a status never half-matches. */
export function toneOf(C: Palette, t: Tone): { fg: string; bg: string; edge: string } {
  switch (t) {
    case 'brand': return { fg: C.brandDeep, bg: C.brandTint, edge: C.brandEdge }
    case 'positive': return { fg: C.positive, bg: C.positiveTint, edge: C.positiveEdge }
    case 'warning': return { fg: C.warning, bg: C.warningTint, edge: C.warningEdge }
    case 'critical': return { fg: C.critical, bg: C.criticalTint, edge: C.criticalEdge }
    case 'info': return { fg: C.info, bg: C.infoTint, edge: C.infoEdge }
    default: return { fg: C.muted, bg: C.sunken, edge: C.line }
  }
}

/** Card elevation — portal.css --ess-shadow, as React Native shadow props. */
export function elevation(C: Palette, level: 1 | 2 | 3 = 1) {
  return {
    shadowColor: C.shadow,
    shadowOpacity: level === 1 ? 0.08 : level === 2 ? 0.14 : 0.22,
    shadowRadius: level === 1 ? 10 : level === 2 ? 16 : 24,
    shadowOffset: { width: 0, height: level === 1 ? 4 : 8 },
    elevation: level === 1 ? 2 : level === 2 ? 5 : 10,
  }
}
