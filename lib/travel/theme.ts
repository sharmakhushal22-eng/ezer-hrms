// ============================================================================
// EZER HRMS — Travel Claim Module · Theme
// lib/travel/theme.ts
// Inline styles only. No Tailwind in JSX, per EZER convention.
// ============================================================================

import type { CSSProperties } from 'react';

export const C = {
  bg: '#F5F3FF',
  navy: '#1E1B4B',
  purple: '#7C3AED',
  purpleDark: '#3C3489',
  card: '#FFFFFF',
  border: '#E9E7F5',
  borderSoft: 'rgba(124,58,237,0.12)',
  text: '#1E1B4B',
  textMuted: '#6B6890',
  textFaint: '#9C99B8',
  success: '#059669',
  successBg: '#ECFDF5',
  warn: '#D97706',
  warnBg: '#FFFBEB',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  info: '#2563EB',
  infoBg: '#EFF6FF',
} as const;

export const F = {
  stack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

export const S: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    fontFamily: F.stack,
    color: C.text,
    padding: '20px',
  },
  shell: { maxWidth: 1180, margin: '0 auto' },
  shellNarrow: { maxWidth: 640, margin: '0 auto' },

  h1: { fontSize: 24, fontWeight: 700, color: C.navy, margin: '0 0 4px' },
  h2: { fontSize: 17, fontWeight: 600, color: C.navy, margin: '0 0 12px' },
  sub: { fontSize: 13, color: C.textMuted, margin: '0 0 20px' },

  card: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
  },
  cardTight: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },

  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: C.textMuted,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: F.stack,
    color: C.text,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: F.stack,
    color: C.text,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    outline: 'none',
    boxSizing: 'border-box',
  },

  btn: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: F.stack,
    color: '#FFFFFF',
    background: C.purple,
    border: 'none',
    borderRadius: 9,
    cursor: 'pointer',
  },
  btnGhost: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: F.stack,
    color: C.purple,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: F.stack,
    color: C.danger,
    background: C.dangerBg,
    border: `1px solid ${C.danger}33`,
    borderRadius: 8,
    cursor: 'pointer',
  },
  btnDisabled: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: F.stack,
    color: C.textFaint,
    background: C.border,
    border: 'none',
    borderRadius: 9,
    cursor: 'not-allowed',
  },
  btnBig: {
    width: '100%',
    padding: '18px',
    fontSize: 17,
    fontWeight: 700,
    fontFamily: F.stack,
    color: '#FFFFFF',
    background: C.purple,
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
  },

  row: { display: 'flex', gap: 12, alignItems: 'center' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 700,
    color: '#FFFFFF',
    background: C.navy,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${C.border}`,
    color: C.text,
    verticalAlign: 'middle',
  },

  fareBox: {
    background: C.purple,
    color: '#FFFFFF',
    borderRadius: 14,
    padding: '22px 20px',
    textAlign: 'center',
    marginBottom: 16,
  },
  fareAmount: { fontSize: 40, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 },
  fareCaption: { fontSize: 12, opacity: 0.85, marginTop: 6 },
};

export function pill(kind: 'ok' | 'warn' | 'danger' | 'info' | 'muted'): CSSProperties {
  const map = {
    ok: { color: C.success, bg: C.successBg, br: `${C.success}33` },
    warn: { color: C.warn, bg: C.warnBg, br: `${C.warn}33` },
    danger: { color: C.danger, bg: C.dangerBg, br: `${C.danger}33` },
    info: { color: C.info, bg: C.infoBg, br: `${C.info}33` },
    muted: { color: C.textMuted, bg: C.bg, br: C.border },
  }[kind];
  return {
    display: 'inline-block',
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 20,
    color: map.color,
    background: map.bg,
    border: `1px solid ${map.br}`,
    letterSpacing: 0.3,
  };
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
