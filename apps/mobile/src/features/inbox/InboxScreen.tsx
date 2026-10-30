// src/features/inbox/InboxScreen.tsx — the Inbox: Messages · Wall of Fame · Broadcasts.
//
// components/ess/inbox/InboxShell.tsx. Three groups, each with its OWN unread
// badge; the counts are never summed. Messages is mounted at once; Wall and
// Broadcasts mount on first visit and then stay mounted (hidden, not
// unmounted), so a half-typed private reply survives a tab switch — and, as on
// the website, their badges read 0 until their tab has been opened once.
//
// The bell (features/shell/notifications.tsx) keeps its website rule:
// notifications + inbox messages. Only the Messages count feeds it; the list
// poll here hands it the fresh number (data.ts). The website's quirk of the
// bell showing ONLY the inbox number while the Inbox is open is not copied —
// the bell is not on this screen.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { queryClient } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { listKey, useInboxList } from './data'
import { GBellOff, GChat, GMegaphone, GMegaphoneOff, GStar } from './glyphs'
import { AbsentBlock } from './parts'
import { MessagesLoading, MessagesPane } from './MessagesPane'
import { WallPane } from './WallPane'
import { BroadcastPane } from './BroadcastPane'

type Group = 'messages' | 'wall' | 'broadcast'
const GROUPS: { id: Group; label: string; blurb: string; Icon: typeof GChat }[] = [
  { id: 'messages', label: 'Messages', blurb: 'Conversations with colleagues and desks', Icon: GChat },
  { id: 'wall', label: 'Wall of Fame', blurb: 'Notes, comments and replies about your recognition', Icon: GStar },
  { id: 'broadcast', label: 'Broadcasts', blurb: 'Company-wide notices. Read only. Nobody replies in public', Icon: GMegaphone },
]

function GroupTab({ g, active, count, onPick }: { g: typeof GROUPS[number]; active: boolean; count: number; onPick: () => void }) {
  const { C } = useTheme()
  const ink = active ? C.chipInk : C.essInk3
  return (
    <Pressable onPress={onPick} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`${g.label}${count ? `, ${count} unread` : ''}`}
      style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6, borderRadius: 10,
        backgroundColor: active ? C.surface : 'transparent', borderBottomWidth: active ? 2.5 : 0, borderBottomColor: C.brand }}>
      <g.Icon size={14} color={ink} />
      <Txt size={12.5} w={600} color={ink} numberOfLines={1} style={{ flexShrink: 1 }}>{g.label}</Txt>
      {count > 0 && (
        <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? C.brand : C.sunken }}>
          <Txt size={10.5} w={700} color={active ? C.onAccent : C.inkSoft}>{count}</Txt>
        </View>
      )}
    </Pressable>
  )
}

export default function InboxScreen() {
  const emp = useEmployeeId()
  const { C } = useTheme()
  const list = useInboxList()
  const [group, setGroup] = React.useState<Group>('messages')
  const [visited, setVisited] = React.useState<Record<Group, boolean>>({ messages: true, wall: false, broadcast: false })
  const [counts, setCounts] = React.useState({ wall: 0, broadcast: 0 })
  const pick = (g: Group) => { setGroup(g); setVisited(v => (v[g] ? v : { ...v, [g]: true })) }
  const onWall = React.useCallback((n: number) => setCounts(c => (c.wall === n ? c : { ...c, wall: n })), [])
  const onBroadcast = React.useCallback((n: number) => setCounts(c => (c.broadcast === n ? c : { ...c, broadcast: n })), [])

  const refresh = () => queryClient.refetchQueries({
    queryKey: group === 'messages' ? listKey(emp) : group === 'wall' ? ['inbox', 'wall'] : ['inbox', 'broadcast'],
    type: 'active',
  })

  const d = list.data
  const messagesCount = d?.status === 'ready' ? d.unread : 0
  const blurb = GROUPS.find(g => g.id === group)?.blurb

  const sub = (
    <View style={{ paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.sm, backgroundColor: C.canvas }}>
      <View accessibilityRole="tablist" accessibilityLabel="Inbox groups"
        style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 13, backgroundColor: C.chip, borderWidth: 1, borderColor: C.brandEdge }}>
        {GROUPS.map(g => (
          <GroupTab key={g.id} g={g} active={group === g.id} onPick={() => pick(g.id)}
            count={g.id === 'messages' ? messagesCount : g.id === 'wall' ? counts.wall : counts.broadcast} />
        ))}
      </View>
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 6 }}>{blurb}</Txt>
    </View>
  )

  let messages: React.ReactNode
  if (!d) {
    messages = list.error
      ? <AbsentBlock glyph={<GBellOff size={28} color={C.warning} />} title="Could not open your inbox">{`${(list.error as Error).message || 'Could not open the inbox.'} It will retry on the next poll.`}</AbsentBlock>
      : <MessagesLoading />
  } else if (d.status === 'absent') {
    messages = (
      <AbsentBlock glyph={<GMegaphoneOff size={28} color={C.warning} />} title="Not switched on yet">
        {`${d.reason || 'The inbox tables are not in the database yet.'} Your notifications still reach you on the bell in the meantime.`}
      </AbsentBlock>
    )
  } else {
    messages = <MessagesPane list={d} />
  }

  return (
    <Screen title="Inbox" subtitle="Messages from colleagues and teams, and every notification in full" sub={sub} onRefresh={refresh}>
      <View style={{ display: group === 'messages' ? 'flex' : 'none' }}>{messages}</View>
      {visited.wall && <View style={{ display: group === 'wall' ? 'flex' : 'none' }}><WallPane onUnread={onWall} /></View>}
      {visited.broadcast && <View style={{ display: group === 'broadcast' ? 'flex' : 'none' }}><BroadcastPane onUnread={onBroadcast} /></View>}
      <View style={{ height: R.sm }} />
    </Screen>
  )
}
