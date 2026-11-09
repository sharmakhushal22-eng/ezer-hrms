// src/features/expenses/tones.ts — te.css's colour classes, as palette lookups.
//
// te.css (components/te/te.css) paints with the repo's --ez-* tokens; the app's
// palette (@/ui/theme) has the same names, so each class maps to a pair of
// palette keys and dark mode follows for free. The only literals are the
// module's own --te-hero-* gradient, which te.css declares itself (light and
// dark blocks), copied below with that source.
import type { Palette } from '@/ui/theme'
import type { Tone as WebTone } from '@web/te/format'

export type TeTone = WebTone | '' | (string & {}) | null | undefined

/** .t-pos / .t-warn / .t-crit / .t-info / .t-brand / plain → fill, text, edge. */
export function toneColors(C: Palette, tone: TeTone): { bg: string; fg: string; edge: string } {
  switch (tone) {
    case 't-pos': return { bg: C.positiveTint, fg: C.positive, edge: C.positiveEdge }
    case 't-warn': return { bg: C.warningTint, fg: C.warning, edge: C.warningEdge }
    case 't-crit': return { bg: C.criticalTint, fg: C.critical, edge: C.criticalEdge }
    case 't-info': return { bg: C.infoTint, fg: C.info, edge: C.infoEdge }
    case 't-brand': return { bg: C.brandTint, fg: C.brand, edge: C.brandEdge }
    default: return { bg: C.sunken, fg: C.inkSoft, edge: C.line }
  }
}

export type KindId = 'local' | 'domestic' | 'international' | 'other'
/** .k-<kind>: --te-k (the colour) and --te-kt (its tint). */
export function kindColors(C: Palette, kind: KindId | string): { k: string; kt: string } {
  switch (kind) {
    case 'local': return { k: C.positive, kt: C.positiveTint }
    case 'domestic': return { k: C.brand, kt: C.brandTint }
    case 'international': return { k: C.info, kt: C.infoTint }
    default: return { k: C.warning, kt: C.warningTint }
  }
}

/** .flag.crit / .warn / .info / .ok — fill and icon colour. */
export type FlagTone = 'crit' | 'warn' | 'info' | 'ok'
export function flagColors(C: Palette, t: FlagTone): { bg: string; fg: string } {
  switch (t) {
    case 'crit': return { bg: C.criticalTint, fg: C.critical }
    case 'warn': return { bg: C.warningTint, fg: C.warning }
    case 'ok': return { bg: C.positiveTint, fg: C.positive }
    default: return { bg: C.brandTint, fg: C.brand }
  }
}

/** te.css --te-hero-a / -b / -c (light block, then the dark block). */
export const HERO = {
  light: ['#1E3A8A', '#2563EB', '#38BDF8'] as const,
  dark: ['#0B1B45', '#1D4ED8', '#0EA5E9'] as const,
  /** --te-hero-glass */
  glass: 'rgba(255,255,255,0.14)',
  glassEdge: 'rgba(255,255,255,0.2)',
}

/** MODE_ICON (TePlanRoute / TeTrips): which TeIcon a travel mode gets. */
export function modeIcon(mode: string | null | undefined): string {
  switch (mode) {
    case 'own': case 'company': case 'cab': case 'auto': case 'rental': return 'car'
    case 'public': case 'bus': return 'bus'
    case 'train': return 'train'
    case 'flight': return 'plane'
    default: return 'route'
  }
}

/** te.css --te-f-mono, for claim / trip / registration numbers. */
export const MONO = 'monospace'
