'use client'
// components/wall/FeedCard.tsx — one recognition on the feed.
//
// v8: extracted from WallOfFame.tsx so the feed, the composer preview and any
// future surface render the same anatomy. It renders exactly the fields the
// v7 card rendered from v_company_feed (the award name now sits in a
// header strip rather than a line under the message) — giver, designation, receivers,
// category, message, award name, visibility, date — and nothing more.
// reaction_count and comment_count are still not shown, as in v7.
//
// Visibility is stated on every card. Somebody reading a note deserves to
// know how far it travelled.

import { C, F, W, S } from '@/lib/ui'
import { Avatar, AvatarStack, Icon, Pill, RAD, shortDate } from '@/components/wall/ui'

export interface FeedRow {
  id: string
  kind: string | null
  message: string | null
  published_at: string | null
  category_label: string | null
  category_glyph: string | null
  award_name: string | null
  badge_code: string | null
  giver_id: string | null
  giver_name: string | null
  giver_designation: string | null
  receiver_names: string[] | null
  visibility: string | null
}

export default function FeedCard({ row }: { row: FeedRow }) {
  const names = row.receiver_names ?? []
  const giver = row.giver_name ?? 'Someone'
  const when = shortDate(row.published_at)
  const vis = row.visibility?.toLowerCase() ?? null

  // An award reads differently from a thank-you: it is marked at the top in
  // brand blue. Not gold — gold is reserved for the Spotlight, #1 and the board.
  const isAward = row.kind === 'award' || Boolean(row.award_name)

  return (
    <article style={{
      border: `1px solid ${isAward ? C.brandEdge : C.line}`, borderRadius: RAD.tile,
      background: C.surface, overflow: 'hidden',
    }}>
      {isAward && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px',
                      background: C.brandTint, borderBottom: `1px solid ${C.brandEdge}`,
                      fontSize: F.micro, fontWeight: W.bold, color: C.brand }}>
          <Icon name="trophy" size={14} stroke={2} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.award_name ?? 'Award'}
          </span>
        </div>
      )}
    <div style={{
      padding: S.md, display: 'grid',
      gridTemplateColumns: '42px minmax(0,1fr)', columnGap: 12, rowGap: 10,
    }}>
      <Avatar name={giver} size={42} />

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1, fontSize: F.small, lineHeight: 1.45, color: C.ink }}>
            <strong style={{ fontWeight: W.bold }}>{giver}</strong>
            <span style={{ color: C.muted }}> recognised </span>
            <strong style={{ fontWeight: W.bold }}>{names.length ? names.join(', ') : 'a colleague'}</strong>
            {row.giver_designation && (
              <div style={{ fontSize: F.micro, color: C.muted, marginTop: 1 }}>{row.giver_designation}</div>
            )}
          </div>
          {when && (
            <time dateTime={row.published_at ?? undefined}
              style={{ fontSize: F.micro, color: C.faint, whiteSpace: 'nowrap', paddingTop: 2 }}>
              {when}
            </time>
          )}
        </div>
      </div>

      <div style={{ gridColumn: '2', minWidth: 0, display: 'grid', gap: 10 }}>
        {(row.category_label || names.length > 1) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {row.category_label && (
              <Pill>{row.category_glyph ? `${row.category_glyph} ` : ''}{row.category_label}</Pill>
            )}
            {names.length > 1 && <AvatarStack names={names} size={22} />}
          </div>
        )}

        {row.message && (
          <p style={{ margin: 0, fontSize: F.small, color: C.inkSoft, lineHeight: 1.7,
                      borderLeft: `3px solid ${C.brandEdge}`, paddingLeft: 12,
                      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {row.message}
          </p>
        )}


        {vis && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.micro,
                        color: C.faint }}>
            <Icon name={vis === 'company' ? 'globe' : 'users'} size={13} />
            Visible to {vis}
          </div>
        )}
      </div>
    </div>
    </article>
  )
}
