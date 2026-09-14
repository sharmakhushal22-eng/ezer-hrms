/**
 * EZER design tokens — the blue app system.
 * Single source for both the CSS variable file and inline styles in TSX.
 */
export const T = {
  brand: '#2563EB',
  brandDeep: '#1D4ED8',
  brandLift: '#3B82F6',
  brandAir: '#60A5FA',
  tint: '#EFF6FF',
  soft: '#DBEAFE',
  deepInk: '#1E3A8A',

  canvas: '#F2F5F9',
  surface: '#FFFFFF',
  surface2: '#F8FAFC',

  ink: '#0F172A',
  ink2: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',

  line: '#E5E9EF',
  lineSoft: '#F0F3F7',

  ok: '#059669',
  okT: '#ECFDF5',
  warn: '#D97706',
  warnT: '#FFFBEB',
  lock: '#64748B',
  lockT: '#F1F5F9',
  evt: '#7C3AED',
  evtT: '#F5F3FF',
  bad: '#DC2626',
  badT: '#FEF2F2',

  r1: '10px', r2: '14px', r3: '18px', r4: '24px', r5: '30px',
  s1: '0 1px 2px rgba(15,23,42,.05)',
  s2: '0 2px 6px rgba(15,23,42,.06),0 8px 20px -12px rgba(15,23,42,.14)',
  s3: '0 24px 60px -22px rgba(15,23,42,.3),0 8px 20px -10px rgba(15,23,42,.09)',
  sb: '0 14px 32px -12px rgba(37,99,235,.5)',
  ease: 'cubic-bezier(.22,.61,.36,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
} as const;

export const EDIT_STATE_COLOR: Record<string, { bg: string; fg: string }> = {
  direct:  { bg: T.okT,   fg: T.ok },
  request: { bg: T.warnT, fg: T.warn },
  locked:  { bg: T.lockT, fg: T.lock },
  event:   { bg: T.evtT,  fg: T.evt },
};
