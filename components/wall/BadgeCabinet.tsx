'use client'
// components/wall/BadgeCabinet.tsx — the employee's own badges.
//
// v8: extracted from WallOfFame.tsx and laid out as a shelf — an even grid
// that reflows to the rail's width. The Badge props are mapped exactly as in
// v7: tier, shape, glyph, label, earned-month sub-line, ×N count, locked when
// never earned, progress ring from progress_pct.

import Badge, { type BadgeTier, type BadgeShape } from '@/components/wall/Badge'
import { C, F, W } from '@/lib/ui'
import { Empty, RAD } from '@/components/wall/ui'

export interface MyBadge {
  badge_code: string
  label: string
  glyph: string | null
  tier: string | null
  shape: string | null
  earned_count: number | null
  progress_pct: number | null
  earned_at: string | null
}

export default function BadgeCabinet({ badges, size = 118 }: { badges: MyBadge[]; size?: number }) {
  if (!badges.length) {
    return (
      <Empty icon="medal" title="Your cabinet is empty" compact>
        Badges arrive from awards, company values and service milestones — the last of those
        on their own, from your joining date.
      </Empty>
    )
  }
  const earned = badges.filter(b => b.earned_at).length
  return (
    <div>
      <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 10 }}>
        <strong style={{ color: C.ink, fontWeight: W.bold }}>{earned}</strong> earned
        {badges.length > earned ? `, ${badges.length - earned} in progress` : ''}
      </div>
      <div style={{
        display: 'grid', gap: 10, justifyItems: 'center',
        gridTemplateColumns: `repeat(auto-fill, minmax(${size + 16}px, 1fr))`,
        padding: 12, borderRadius: RAD.tile, background: C.sunken,
        border: `1px solid ${C.line}`,
      }}>
        {badges.map(b => (
          // showLabel lets Badge draw its own caption — a second caption
          // underneath would print every label twice.
          <Badge
            key={b.badge_code}
            size={size}
            tier={(b.tier as BadgeTier) ?? 'blue'}
            shape={(b.shape as BadgeShape) ?? 'shield'}
            glyph={b.glyph ?? '★'}
            label={b.label}
            sub={b.earned_at
              ? new Date(b.earned_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
              : undefined}
            count={b.earned_count ?? 1}
            locked={!b.earned_at}
            progress={b.progress_pct ?? 0}
            showLabel
            interactive
          />
        ))}
      </div>
    </div>
  )
}
