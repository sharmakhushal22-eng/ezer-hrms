/**
 * EZER · Wall of Fame · design tokens
 * -------------------------------------------------------------------------
 * These are the app's existing blue token values, not new ones. The violet
 * marketing palette was retired in August 2026 — blue is the theme everywhere.
 *
 * Import this and use inline styles. Do not use Tailwind classes in JSX.
 *
 *   import { T } from '@/lib/wall/theme';
 *   <div style={{ background: T.surface, border: `1px solid ${T.line}` }} />
 */

export const LIGHT = {
  brand: '#2563EB',
  brandDeep: '#1D4ED8',
  brandDark: '#16305C',
  brandTint: '#EFF6FF',
  brandTint2: '#DBEAFE',

  canvas: '#F2F5F9',
  surface: '#FFFFFF',
  surface2: '#F8FAFC',

  ink: '#0F172A',
  ink2: '#334155',
  ink3: '#64748B',
  ink4: '#94A3B8',

  line: '#E3E8EF',
  lineSoft: '#F1F4F8',
} as const;

export const DARK = {
  brand: '#3B82F6',
  brandDeep: '#60A5FA',
  brandDark: '#0E1E3A',
  brandTint: '#0F1E38',
  brandTint2: '#152A4A',

  canvas: '#080D18',
  surface: '#0F1626',
  surface2: '#0C1320',

  ink: '#F1F5F9',
  ink2: '#CBD5E1',
  ink3: '#94A3B8',
  ink4: '#64748B',

  line: '#1C2740',
  lineSoft: '#141D30',
} as const;

/** Six grade colours, reused from the app's data ramp. */
export const GRADE = {
  gold:   { fg: '#B45309', bg: '#FEF3C7', fgDark: '#FCD34D', bgDark: '#3A2A08' },
  green:  { fg: '#047857', bg: '#D1FAE5', fgDark: '#6EE7B7', bgDark: '#06301F' },
  cyan:   { fg: '#0E7490', bg: '#CFFAFE', fgDark: '#67E8F9', bgDark: '#062B33' },
  violet: { fg: '#6D28D9', bg: '#EDE9FE', fgDark: '#C4B5FD', bgDark: '#241A4A' },
  rose:   { fg: '#BE123C', bg: '#FFE4E6', fgDark: '#FDA4AF', bgDark: '#3A0D1A' },
  slate:  { fg: '#334155', bg: '#E2E8F0', fgDark: '#CBD5E1', bgDark: '#1E293B' },
  blue:   { fg: '#1D4ED8', bg: '#DBEAFE', fgDark: '#60A5FA', bgDark: '#152A4A' },
} as const;

export type ColourToken = keyof typeof GRADE;

export const SHADOW = {
  s1: '0 1px 2px rgba(15,23,42,.06)',
  s2: '0 6px 18px rgba(15,23,42,.07)',
  s3: '0 20px 48px rgba(15,23,42,.14)',
  s1Dark: '0 1px 2px rgba(0,0,0,.45)',
  s2Dark: '0 6px 18px rgba(0,0,0,.5)',
  s3Dark: '0 20px 48px rgba(0,0,0,.62)',
} as const;

export const RADIUS = { md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** Standard easing used across the module. Do not substitute another curve. */
export const EASE = 'cubic-bezier(.22,.72,.28,1)';

export const TYPE = {
  family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  body: 14,
  small: 12.5,
  tiny: 11.5,
  h2: 22,
  h3: 17,
  h4: 14,
} as const;

/** Board palette. The digital board is always dark, regardless of app theme. */
export const BOARD = {
  bg: '#060F1F',
  card: '#0E1C33',
  line: '#1A2E4F',
  dim: '#8FB0DC',
  gold: '#FCD34D',
} as const;

/** Default export for the light theme, which is what most screens use. */
export const T = LIGHT;

export function tokens(theme: 'light' | 'dark' = 'light') {
  return theme === 'dark' ? DARK : LIGHT;
}

export function gradeStyle(token: ColourToken, theme: 'light' | 'dark' = 'light') {
  const g = GRADE[token];
  return theme === 'dark'
    ? { color: g.fgDark, background: g.bgDark }
    : { color: g.fg, background: g.bg };
}
