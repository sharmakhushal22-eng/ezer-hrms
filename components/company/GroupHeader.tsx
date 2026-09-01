'use client';
// components/company/GroupHeader.tsx — the Group row that sits above its companies.
//
// This exists as one component because it was written twice: once in
// app/dashboard/company-profile and once in components/payroll/CompanyProfileView,
// which Payroll → Configuration → Group & Company renders. Redesigning the first
// left the second untouched and looking exactly as before, which is how the
// duplication announced itself. One component, both call sites.
//
// ── WHY IT IS THE LARGEST THING ON THE PAGE ─────────────────────────────────
// Every company on this screen sits under the group, so the group is the root
// of the hierarchy — but it was rendering SMALLER than its own children. Its
// name was 16px against a company card's 15px name on a 40px monogram, and it
// carried a 42px tile and no elevation, so it read as a sibling of the cards
// beneath it rather than their parent.
//
// It is now unmistakably the parent: 28px name, 58px monogram, a group-wide
// headcount the company cards cannot show, and a shadow deep enough that the
// cards read as sitting under it.

import * as React from 'react';
import { C as TK } from '@/lib/ui';
import type { GroupTree } from '@/lib/supabase-company-profile';

export function GroupHeader({ g, card, headcount, canEdit, onEdit }: {
  g: GroupTree;
  card?: React.CSSProperties;
  /** Total people across every company in the group. The group's own number —
   *  no company card can show it, which is part of why the row earns its size. */
  headcount?: number;
  /** Whether the SERVER says this person may edit. Passed in rather than
   *  decided here: this component also renders inside Payroll, and a component
   *  that resolves its own permissions would resolve them twice, differently. */
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const branches = g.companies.reduce((s, c) => s + (c.branches?.length || 0), 0);
  const regs     = g.companies.reduce((s, c) => s + (c.registrations?.length || 0), 0);
  const atRisk   = g.companies.filter(c => c.account_status && c.account_status !== 'ACTIVE');

  const metrics: [number | string, string][] = [
    [g.companies.length, 'Companies'],
    [branches, 'Branches'],
    [regs, 'Registrations'],
  ];
  if (headcount != null) metrics.unshift([headcount, 'People']);

  return (
    // Stays dark: a dark parent over white children is what makes the
    // Group → Company hierarchy readable at a glance.
    //
    // The gradient runs at 104deg — along the block's long axis — from
    // --ez-dark through --ez-dark-mid to --ez-dark-accent. The end stop stays
    // where it is: lifting it further would push the small labels under AA, so
    // depth comes from the glow washes and the grid below rather than from a
    // lighter gradient. Everything on it was measured against the LIGHT end,
    // which is the worst case: name 10.71:1, eyebrow 6.22:1, meta 7.21:1.
    <div style={{
      ...card,
      border: 'none',
      borderRadius: 18,
      padding: '24px 26px',
      color: TK.onDark,
      background: `linear-gradient(104deg, ${TK.dark} 0%, ${TK.darkMid} 52%, ${TK.darkAccent} 100%)`,
      // Deep enough that the company cards read as resting underneath it. Their
      // own shadow is 8px/24px; this is 18px/44px, so the two do not compete.
      boxShadow: '0 2px 4px rgba(8,12,22,.28), 0 18px 44px -12px rgba(8,12,22,.55)',
      position: 'relative',
      overflow: 'hidden',
      marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
    }}>
      {/* Depth without lifting the gradient: a cool wash top-right, a warmer
          one bottom-left, and a masked hairline grid. All three sit behind the
          content and cost nothing in contrast. */}
      <div aria-hidden style={{
        position: 'absolute', top: -120, right: -90, width: 320, height: 320, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(125,211,252,.20), transparent 68%)', pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -140, left: 120, width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(37,99,235,.26), transparent 70%)', pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', inset: 0, opacity: .5, pointerEvents: 'none',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)',
        backgroundSize: '38px 38px',
        maskImage: 'radial-gradient(circle at 22% 40%, #000, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(circle at 22% 40%, #000, transparent 78%)',
      }} />

      {/* Monogram. 58px against a company card's 40px — the size difference is
          the hierarchy, stated before anything is read. */}
      <div style={{
        width: 58, height: 58, borderRadius: 18, flexShrink: 0, position: 'relative',
        background: 'linear-gradient(150deg, rgba(255,255,255,.20), rgba(255,255,255,.07))',
        border: '1px solid rgba(255,255,255,.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 800, letterSpacing: '.02em',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.28), 0 6px 18px -4px rgba(0,0,0,.45)',
      }}>
        {(g.group_code || g.group_name || '?').slice(0, 3).toUpperCase()}
      </div>

      <div style={{ minWidth: 0, flex: 1, position: 'relative' }}>
        {/* GROUP, said out loud. The row never named what it was — you had to
            infer it from position, which only works if you already know. */}
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase',
          color: 'rgba(125,211,252,.95)', marginBottom: 3,
        }}>Group</div>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.08 }}>
          {g.group_name}
        </div>
        {/* onDarkMuted, not brand. The payroll copy used TK.brand here, which is
            #2563EB in light mode — a light-mode blue on an always-dark ground,
            measuring 3.43:1. The onDark family does not flip with the theme,
            which is what a permanently dark surface needs. */}
        <div style={{ fontSize: 12, color: TK.onDarkMuted, marginTop: 5, display: 'flex',
                      alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '.03em' }}>{g.group_code}</span>
          <span aria-hidden style={{ opacity: .45 }}>·</span>
          <span>{g.country}</span>
          {atRisk.length > 0 && (
            <>
              <span aria-hidden style={{ opacity: .45 }}>·</span>
              {/* account_status already existed in the data; finding a company in
                  GRACE or SUSPENDED meant opening each company card in turn. The
                  group is the first thing on the page, so it is where this belongs. */}
              <span title={atRisk.map(c => c.company_name + ': ' + c.account_status).join(' · ')}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: 'rgba(248,113,113,.18)', border: '1px solid rgba(248,113,113,.4)',
                  color: '#FCA5A5', whiteSpace: 'nowrap',
                }}>
                {atRisk.length} need{atRisk.length === 1 ? 's' : ''} billing attention
              </span>
            </>
          )}
        </div>
      </div>

      {/* Edit. Rendered only when the server said yes — and the route checks
          again on every write, because this button is in the browser and can
          be skipped. */}
      {canEdit && onEdit && (
        <button onClick={onEdit} title="Edit group details, branding, and add a company"
          style={{
            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 15px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700, color: TK.onDark,
            background: 'rgba(255,255,255,.12)',
            border: '1px solid rgba(255,255,255,.26)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18)',
          }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor"
               strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.4 1.9a1.3 1.3 0 0 1 1.9 1.9L4.6 10.5l-2.5.6.6-2.5 6.7-6.7Z" />
          </svg>
          Edit group
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10,
                    marginLeft: canEdit ? 0 : 'auto',
                    position: 'relative', flexWrap: 'wrap' }}>
        {metrics.map(([n, label]) => (
          <div key={label} style={{
            minWidth: 84, padding: '10px 14px', borderRadius: 12, textAlign: 'right',
            background: 'rgba(255,255,255,.07)',
            border: '1px solid rgba(255,255,255,.13)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10)',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.05,
                          fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{n}</div>
            {/* Not onDarkFaint (.58): the tile's own rgba(255,255,255,.07)
                lightens the ground under it, and at the gradient's light end
                that dropped a 10px label to 4.12:1. .70 measures 5.24:1 there
                and 6.9:1 at the dark end. */}
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
              textTransform: 'uppercase', color: 'rgba(249,250,251,.70)', marginTop: 4,
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
