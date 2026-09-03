'use client';

/**
 * EZER · Wall of Fame · Badge
 * -------------------------------------------------------------------------
 * One component renders every badge in the module: the cabinet, a leaderboard
 * row, the spotlight strip, a hall-of-legends card corner, the digital board,
 * and the certificate PDF. It scales from the `size` prop alone.
 *
 * There are no image assets. Everything is generated SVG, so it stays sharp at
 * any size, themes automatically, and a company can add a badge from the admin
 * console without anyone shipping a file.
 *
 * Design language — three separate pieces of information, none decorative:
 *   shape  → what kind of badge   (shield / hex / medal / ring)
 *   metal  → how many times earned (blue → bronze → silver → gold → platinum)
 *   glyph  → the work itself       (from badge_master.glyph)
 *
 * Conventions followed here, per CLAUDE.md:
 *   - inline styles only, no Tailwind classes
 *   - sub-components declared at module scope, never inside the parent
 *   - no browser storage
 */

import React, { useId, useRef, useState, useCallback } from 'react';

/* ---------------------------------------------------------------- types */

export type BadgeTier = 'blue' | 'bronze' | 'silver' | 'gold' | 'platinum';
export type BadgeShape = 'shield' | 'hex' | 'medal' | 'ring';

export interface BadgeProps {
  /** shield = formal award · hex = company value · medal = quarterly title · ring = long service */
  shape?: BadgeShape;
  /** metal, driven by employee_badges.tier */
  tier?: BadgeTier;
  /** emoji or single character from badge_master.glyph. Ignored for `ring`. */
  glyph?: string;
  /** ring badges show the year count in the centre instead of a glyph */
  years?: number;
  /** badge_master.label — rendered under the crest when `showLabel` is true */
  label?: string;
  /** small line under the label, e.g. "Nov 2026 · latest" */
  sub?: string;
  /** employee_badges.earned_count. The ×N chip appears only from 2 upward. */
  count?: number;
  /** progress_pct < 100 renders the greyscale locked state with a progress ring */
  locked?: boolean;
  /** 0–100, drives the ring fill on a locked badge */
  progress?: number;
  /** width in px. Height is 1.1×. Default 118. */
  size?: number;
  showLabel?: boolean;
  /** 3D tilt follows the pointer. Disabled under prefers-reduced-motion and below 60px. */
  interactive?: boolean;
  onClick?: () => void;
}

/* --------------------------------------------------------------- tokens */

interface Metal {
  a: string;   // highlight
  b: string;   // body
  c: string;   // shadow
  rim: string; // rim stroke
  label: string;
}

export const BADGE_TIERS: Record<BadgeTier, Metal> = {
  blue:     { a: '#DBEAFE', b: '#3B82F6', c: '#1D4ED8', rim: '#93C5FD', label: 'Blue' },
  bronze:   { a: '#F6D5B3', b: '#C97B3C', c: '#7C4318', rim: '#E0A472', label: 'Bronze' },
  silver:   { a: '#F7FAFD', b: '#A9B6C6', c: '#5F6E80', rim: '#D5DEE8', label: 'Silver' },
  gold:     { a: '#FDEBB0', b: '#EFB02A', c: '#9A5E06', rim: '#F8D77A', label: 'Gold' },
  platinum: { a: '#F0F8FF', b: '#9BC0E6', c: '#3F6B94', rim: '#CBE1F5', label: 'Platinum' },
};

const SHAPE_PATH: Record<BadgeShape, string> = {
  shield: 'M60 8 L104 27 V72 C104 99 84 117 60 125 C36 117 16 99 16 72 V27 Z',
  hex:    'M60 7 L104 32 V82 L60 107 L16 82 V32 Z',
  medal:  'M60 12 a48 48 0 1 1 -0.1 0 Z',
  ring:   'M60 10 a50 50 0 1 1 -0.1 0 Z',
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  return reduced;
}

/* -------------------------------------------------- module-scope pieces */

function PlatinumRays({ colour }: { colour: string }) {
  return (
    <g style={{ transformOrigin: '60px 66px', animation: 'ezBadgeRays 22s linear infinite' }}>
      {Array.from({ length: 16 }, (_, i) => (
        <rect
          key={i}
          x={59}
          y={-6}
          width={2.4}
          height={16}
          rx={1.2}
          fill={colour}
          opacity={i % 2 ? 0.35 : 0.7}
          transform={`rotate(${i * 22.5} 60 66)`}
        />
      ))}
    </g>
  );
}

function MedalRibbons({ metal }: { metal: Metal }) {
  return (
    <>
      <path d="M40 96 L28 130 L46 122 L58 130 L52 96 Z" fill={metal.c} opacity={0.9} />
      <path d="M80 96 L92 130 L74 122 L62 130 L68 96 Z" fill={metal.b} opacity={0.9} />
    </>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <>
      <circle cx={60} cy={64} r={54} fill="none" stroke="#CBD5E1" strokeWidth={4} opacity={0.45} />
      <circle
        cx={60}
        cy={64}
        r={54}
        fill="none"
        stroke="#2563EB"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${((RING_CIRCUMFERENCE * pct) / 100).toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
        transform="rotate(-90 60 64)"
      />
    </>
  );
}

/* ------------------------------------------------------------- component */

export default function Badge({
  shape = 'shield',
  tier = 'bronze',
  glyph = '★',
  years,
  label,
  sub,
  count = 1,
  locked = false,
  progress = 0,
  size = 118,
  showLabel = true,
  interactive = true,
  onClick,
}: BadgeProps) {
  const uid = useId().replace(/:/g, '');
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState('');

  const metal = BADGE_TIERS[tier];
  const path = SHAPE_PATH[shape];
  const isPlatinum = tier === 'platinum' && !locked;
  const artHeight = Math.round(size * 1.1);
  const canTilt = interactive && !reduced && size >= 60;

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canTilt || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      setTilt(
        `perspective(600px) rotateY(${(px * 16).toFixed(1)}deg) rotateX(${(-py * 16).toFixed(1)}deg) translateY(-4px)`
      );
    },
    [canTilt]
  );

  const onLeave = useCallback(() => setTilt(''), []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        position: 'relative',
        width: size,
        flex: 'none',
        textAlign: 'center',
        transformStyle: 'preserve-3d',
        transform: tilt,
        transition: 'transform .28s cubic-bezier(.22,.72,.28,1)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: size,
          height: artHeight,
          margin: '0 auto',
          filter: locked ? 'grayscale(1) brightness(.94)' : undefined,
          opacity: locked ? 0.5 : 1,
        }}
      >
        <svg
          viewBox="-6 -6 132 144"
          role="img"
          aria-label={label ?? 'Badge'}
          style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={`mg${uid}`} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor={metal.a} />
              <stop offset="42%" stopColor={metal.b} />
              <stop offset="72%" stopColor={metal.c} />
              <stop offset="100%" stopColor={metal.b} />
            </linearGradient>
            <linearGradient id={`pl${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metal.c} />
              <stop offset="100%" stopColor={metal.b} />
            </linearGradient>
            <radialGradient id={`hl${uid}`} cx="34%" cy="24%" r="62%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </radialGradient>
            <filter id={`ds${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor={metal.c} floodOpacity={0.38} />
            </filter>
          </defs>

          {isPlatinum && <PlatinumRays colour={metal.rim} />}
          {locked && <ProgressRing progress={progress} />}
          {shape === 'medal' && <MedalRibbons metal={metal} />}

          <g filter={`url(#ds${uid})`}>
            <path d={path} fill={`url(#mg${uid})`} stroke={metal.rim} strokeWidth={1.5} />
            <path d={path} fill={`url(#hl${uid})`} />
            <path
              d={path}
              fill="none"
              stroke="#fff"
              strokeOpacity={0.38}
              strokeWidth={1}
              transform="translate(60 62) scale(.86) translate(-60 -62)"
            />
            {shape === 'ring' && (
              <circle cx={60} cy={60} r={38} fill="none" stroke={`url(#pl${uid})`} strokeWidth={9} opacity={0.55} />
            )}
            <circle cx={60} cy={55} r={27} fill={`url(#pl${uid})`} opacity={0.42} />
          </g>
        </svg>

        {/* glyph sits in HTML, not SVG <text>, so emoji render consistently */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: Math.round(size * 0.22),
            height: Math.round(size * 0.48),
            display: 'grid',
            placeItems: 'center',
            fontSize: shape === 'ring' ? Math.round(size * 0.23) : Math.round(size * 0.26),
            fontWeight: shape === 'ring' ? 800 : 400,
            letterSpacing: shape === 'ring' ? '-.03em' : undefined,
            color: shape === 'ring' ? '#fff' : undefined,
            lineHeight: 1,
            pointerEvents: 'none',
            opacity: locked ? 0.7 : 1,
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.28))',
          }}
        >
          {shape === 'ring' ? years ?? '' : glyph}
        </div>

        {!locked && count > 1 && (
          <div
            style={{
              position: 'absolute',
              right: 2,
              top: 6,
              minWidth: 26,
              height: 26,
              padding: '0 6px',
              borderRadius: 999,
              background: 'var(--ez-ink, #0F172A)',
              color: 'var(--ez-surface, #fff)',
              fontSize: 12,
              fontWeight: 800,
              display: 'grid',
              placeItems: 'center',
              border: '2px solid var(--ez-surface, #fff)',
              boxShadow: '0 1px 2px rgba(15,23,42,.06)',
            }}
          >
            ×{count}
          </div>
        )}

        {locked && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 34,
              transform: 'translateX(-50%)',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--ez-ink-3, #64748B)',
              background: 'var(--ez-surface, #fff)',
              border: '1px solid var(--ez-line, #E3E8EF)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {progress}%
          </div>
        )}
      </div>

      {showLabel && label && (
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            marginTop: 6,
            lineHeight: 1.3,
            color: locked ? 'var(--ez-ink-4, #94A3B8)' : undefined,
          }}
        >
          {label}
        </div>
      )}
      {showLabel && sub && (
        <div style={{ fontSize: 11, color: 'var(--ez-ink-4, #94A3B8)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

/**
 * Keyframes for the platinum rays. Mount once, near the app root, or paste into
 * the module's global stylesheet. Kept out of the component so it is not
 * injected once per badge.
 *
 *   @keyframes ezBadgeRays { to { transform: rotate(360deg); } }
 */
export const BADGE_KEYFRAMES = `@keyframes ezBadgeRays { to { transform: rotate(360deg); } }`;

/* ------------------------------------------------------------ helpers */

/** Map an employee_badges row straight onto BadgeProps. */
export function badgeFromRow(row: {
  shape?: string;
  tier?: string;
  glyph?: string;
  label?: string;
  service_years?: number | null;
  earned_count?: number;
  progress_pct?: number;
}): BadgeProps {
  const progress = row.progress_pct ?? 100;
  return {
    shape: (row.shape as BadgeShape) ?? 'shield',
    tier: (row.tier as BadgeTier) ?? 'bronze',
    glyph: row.glyph ?? '★',
    years: row.service_years ?? undefined,
    label: row.label,
    count: row.earned_count ?? 1,
    locked: progress < 100,
    progress,
  };
}
