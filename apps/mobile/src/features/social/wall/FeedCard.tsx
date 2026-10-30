// src/features/social/wall/FeedCard.tsx — one feed row, read-only
// (components/wall/FeedCard.tsx). No reactions, no comments, no menu: the
// website's feed has none (CommentThread is not mounted there).
//
// WEB BUG FIXED (display only): the web reads `row.receiver_names`, a column
// v_company_feed does not have — it returns `receivers` (jsonb of {id, name…}).
// So every web card reads "… recognised a colleague" and never draws the
// receiver stack. Here the names come from `receiver_names` if present, else
// `receivers[].name`. No rule changes; the card simply names who was thanked.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Avatar, AvatarStack, Icon, Pill, RAD, shortDate } from './ui'

export interface FeedRow {
  id: string; kind: string | null; message: string | null; published_at: string | null
  category_label: string | null; category_glyph: string | null; award_name: string | null; badge_code: string | null
  giver_id: string | null; giver_name: string | null; giver_designation: string | null
  receiver_names?: string[] | null
  receivers?: { id?: string; name?: string | null }[] | null
  visibility: string | null
}

export const isAward = (r: FeedRow) => r.kind === 'award' || Boolean(r.award_name)

export function receiverNames(row: FeedRow): string[] {
  if (row.receiver_names?.length) return row.receiver_names
  return (Array.isArray(row.receivers) ? row.receivers : []).map(r => r?.name).filter((n): n is string => !!n)
}

export function FeedCard({ row }: { row: FeedRow }) {
  const { C } = useTheme()
  const names = receiverNames(row)
  const giver = row.giver_name ?? 'Someone'
  const when = shortDate(row.published_at)
  const vis = row.visibility?.toLowerCase() ?? null
  const award = isAward(row)
  return (
    <View style={{ borderWidth: 1, borderColor: award ? C.brandEdge : C.line, borderRadius: RAD.tile, backgroundColor: C.surface, overflow: 'hidden' }}>
      {award && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 16, backgroundColor: C.brandTint, borderBottomWidth: 1, borderBottomColor: C.brandEdge }}>
          <Icon name="trophy" size={14} stroke={2} color={C.brand} />
          <Txt size={F.micro} w={700} tone="brand" numberOfLines={1} style={{ flex: 1 }}>{row.award_name ?? 'Award'}</Txt>
        </View>
      )}
      <View style={{ padding: 12, flexDirection: 'row', gap: 12 }}>
        <Avatar name={giver} size={42} />
        <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.small} style={{ lineHeight: 19 }}>
                <Txt size={F.small} w={700}>{giver}</Txt>
                <Txt size={F.small} tone="muted"> recognised </Txt>
                <Txt size={F.small} w={700}>{names.length ? names.join(', ') : 'a colleague'}</Txt>
              </Txt>
              {!!row.giver_designation && <Txt size={F.micro} tone="muted" style={{ marginTop: 1 }}>{row.giver_designation}</Txt>}
            </View>
            {!!when && <Txt size={F.micro} tone="faint" style={{ paddingTop: 2 }}>{when}</Txt>}
          </View>
          {(!!row.category_label || names.length > 1) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {!!row.category_label && <Pill>{row.category_glyph ? `${row.category_glyph} ` : ''}{row.category_label}</Pill>}
              {names.length > 1 && <AvatarStack names={names} size={22} />}
            </View>
          )}
          {!!row.message && (
            <View style={{ borderLeftWidth: 3, borderLeftColor: C.brandEdge, paddingLeft: 12 }}>
              <Txt size={F.small} tone="soft" style={{ lineHeight: 22 }} selectable>{row.message}</Txt>
            </View>
          )}
          {!!vis && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={vis === 'company' ? 'globe' : 'users'} size={13} color={C.faint} />
              <Txt size={F.micro} tone="faint">Visible to {vis}</Txt>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
