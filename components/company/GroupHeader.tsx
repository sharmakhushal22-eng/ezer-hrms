'use client';
// components/company/GroupHeader.tsx — the Group row that sits above its companies.
//
// This exists as one component because it was written twice: once in
// app/dashboard/company-profile and once in components/payroll/CompanyProfileView,
// which Payroll → Configuration → Group & Company renders. Redesigning the first
// left the second untouched and looking exactly as before, which is how the
// duplication announced itself. One component, both call sites.

import * as React from 'react';
import { C as TK } from '@/lib/ui';
import type { GroupTree } from '@/lib/supabase-company-profile';

export function GroupHeader({ g, card }: { g: GroupTree; card?: React.CSSProperties }) {
  const branches = g.companies.reduce((s, c) => s + (c.branches?.length || 0), 0);
  const regs     = g.companies.reduce((s, c) => s + (c.registrations?.length || 0), 0);
  const atRisk   = g.companies.filter(c => c.account_status && c.account_status !== 'ACTIVE');

  return (
    // Stays dark: a dark parent over white children is what makes the
    // Group → Company hierarchy readable at a glance.
    //
    // The gradient it had was invisible. Measured between its two stops,
    // #111827 -> #1E2E4E is a luminance ratio of 1.31, and spread across a
    // block 1148px wide and 73px tall at 135deg — an angle that wants a tall
    // box — it simply read as flat black. Now three stops at 104deg, which
    // sweeps along the block's actual long axis, ending on --ez-dark-accent
    // at a ratio of 1.67. That is a gradient you can see.
    //
    // The end stop is as light as it can go: the 10px uppercase metric labels
    // sit on it at rgba(249,250,251,.58), which measures 4.74:1 there. Any
    // lighter and they fall under AA.
    <div style={{
      ...card, border: 'none', padding: '15px 18px', color: TK.onDark,
      background: `linear-gradient(104deg, ${TK.dark} 0%, ${TK.darkMid} 52%, ${TK.darkAccent} 100%)`,
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 14, flexShrink: 0,
        background: `color-mix(in srgb, ${TK.onDark} 14%, transparent)`,
        border: `1px solid ${TK.onDarkLine}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, letterSpacing: '.02em',
      }}>
        {(g.group_code || g.group_name || '?').slice(0, 3).toUpperCase()}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>{g.group_name}</div>
        {/* onDarkMuted, not brand. The payroll copy used TK.brand here, which is
            #2563EB in light mode — a light-mode blue on an always-dark ground,
            measuring 3.43:1. The onDark family does not flip with the theme,
            which is what a permanently dark surface needs. */}
        <div style={{ fontSize: 11, color: TK.onDarkMuted, marginTop: 2 }}>
          {g.group_code} · {g.country}
        </div>
      </div>

      {/* account_status already existed in the data; finding a company in GRACE
          or SUSPENDED meant opening each company card in turn. The group is the
          first thing on the page, so it is where this belongs. */}
      {atRisk.length > 0 && (
        <span title={atRisk.map(c => c.company_name + ': ' + c.account_status).join(' · ')}
          style={{
            fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 999,
            background: TK.criticalTint, color: TK.critical, whiteSpace: 'nowrap',
          }}>
          {atRisk.length} need{atRisk.length === 1 ? 's' : ''} billing attention
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginLeft: 'auto' }}>
        {([[g.companies.length, 'Companies'], [branches, 'Branches'], [regs, 'Registrations']] as [number, string][])
          .map(([n, label]) => (
            <div key={label} style={{ textAlign: 'right', minWidth: 64 }}>
              <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '.06em',
                textTransform: 'uppercase', color: TK.onDarkFaint, marginTop: 3,
              }}>{label}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
