// src/features/inbox/MessagesPane.tsx — the "Messages" group on a phone.
//
// The website's ≤760 px layout (components/ess/inbox/MessagesInbox.tsx,
// FolderRail.tsx, ConversationList.tsx, CatchUp.tsx): the folder rail becomes a
// horizontal strip — a round compose button plus folder chips — the list runs
// full width, the thread opens on its own screen, and the catch-up panel sits
// under the list. Not shipped (feature-flagged off on the website, with no
// backend): star / mute / close / mark-unread, mark all read, message search,
// attachments, delete. The keyboard shortcuts are web-only.
import * as React from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useEmployee } from '@/core/employee'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, FONT, R, S, SERIF } from '@/ui/theme'
import { Button, Txt, webNoOutline } from '@/ui/primitives'
import { openThread, type InboxList } from './data'
import { catchUpBuckets, selectConversations, type ConversationVM, type FolderVM, type ListFilter } from './model'
import { alpha, FolderGlyph, GChat, GPlus, GSearch, inkOf, onInk } from './glyphs'
import { ConvAvatar, ConversationRow, EmptyBlock, FilterChip, InkPill } from './parts'
import { ComposeSheet } from './ComposeSheet'

function FolderChip({ label, unread, ink, dot, on, onPress }: { label: string; unread: number; ink: string; dot?: [string, string]; on: boolean; onPress: () => void }) {
  const { C, isDark } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: 12, borderRadius: R.pill, borderWidth: 1,
        borderColor: on ? alpha(ink, 0.4) : C.line, backgroundColor: on ? alpha(ink, 0.14) : C.surface }}>
      {dot
        ? <LinearGradient colors={dot} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 8, height: 8, borderRadius: 3 }} />
        : <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: ink }} />}
      <Txt size={F.tiny + 0.5} w={600} color={on ? C.ink : C.inkSoft} numberOfLines={1}>{label}</Txt>
      {unread > 0 && (
        <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={11} w={700} color={onInk(isDark)}>{unread}</Txt>
        </View>
      )}
    </Pressable>
  )
}

function Skeleton() {
  const { C } = useTheme()
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 11, padding: 12, alignItems: 'center' }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.sunken }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 11, width: '55%', borderRadius: 6, backgroundColor: C.sunken }} />
            <View style={{ height: 9, width: '80%', borderRadius: 6, backgroundColor: C.sunken }} />
          </View>
        </View>
      ))}
    </>
  )
}

function CatchUpRow({ c, ink, onOpen, system }: { c: ConversationVM; ink: string; onOpen: (id: string) => void; system: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={() => onOpen(c.id)} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1,
        borderColor: pressed ? alpha(ink, 0.4) : C.line, backgroundColor: pressed ? alpha(ink, 0.05) : C.surface })}>
      {system
        ? <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(ink, 0.14) }}><FolderGlyph code={c.folder} size={17} color={ink} /></View>
        : <ConvAvatar c={c} ink={ink} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={13.5} w={600} numberOfLines={1}>{c.title}</Txt>
        <Txt size={F.tiny} tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>{c.preview}</Txt>
      </View>
      {system
        ? <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, backgroundColor: alpha(ink, 0.12) }}><Txt size={F.tiny} w={700} color={ink}>Open</Txt></View>
        : <InkPill n={c.unread} ink={ink} size={20} />}
    </Pressable>
  )
}

/** CatchUp.tsx — greeting by the reader's local hour, then what is waiting. */
function CatchUp({ firstName, conversations, folders, onOpen, onCompose }: {
  firstName: string; conversations: ConversationVM[]; folders: Record<string, FolderVM>; onOpen: (id: string) => void; onCompose: () => void
}) {
  const { C, isDark } = useTheme()
  const { todo, unread } = catchUpBuckets(conversations)
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const ink = (c: ConversationVM) => inkOf(folders[c.folder], isDark, C.brand)
  return (
    <View style={{ paddingVertical: 22, paddingHorizontal: 6 }}>
      <Txt size={24} w={600} style={{ fontFamily: SERIF, marginBottom: 6 }}>{greet}, {firstName}.</Txt>
      <Txt size={F.body} tone="muted" style={{ marginBottom: S.lg }}>
        {todo.length || unread.length ? (
          <>
            {todo.length > 0 && <><Txt size={F.body} w={700}>{todo.length}</Txt> update{todo.length > 1 ? 's' : ''} need{todo.length > 1 ? '' : 's'} an action</>}
            {todo.length > 0 && unread.length > 0 && ' and '}
            {unread.length > 0 && <><Txt size={F.body} w={700}>{unread.length}</Txt> conversation{unread.length > 1 ? 's are' : ' is'} waiting</>}.
          </>
        ) : 'Nothing is waiting on you. Pick a conversation on the left, or start one.'}
      </Txt>
      {todo.length > 0 && (
        <>
          <Txt size={F.tiny} w={700} tone="faint" style={{ marginTop: 4, marginBottom: 8 }}>Needs your action</Txt>
          <View style={{ gap: 6 }}>{todo.map(c => <CatchUpRow key={c.id} c={c} ink={ink(c)} onOpen={onOpen} system />)}</View>
        </>
      )}
      {unread.length > 0 && (
        <>
          <Txt size={F.tiny} w={700} tone="faint" style={{ marginTop: 18, marginBottom: 8 }}>Unread</Txt>
          <View style={{ gap: 6 }}>{unread.map(c => <CatchUpRow key={c.id} c={c} ink={ink(c)} onOpen={onOpen} system={false} />)}</View>
        </>
      )}
      <View style={{ marginTop: 22, gap: S.sm, alignItems: 'flex-start' }}>
        <Button title="New message" variant="ghost" size="sm" icon={<GPlus size={15} color={C.brand} />} onPress={onCompose} />
        <Txt size={12.5} tone="faint">Updates from HR, Payroll and Leave arrive here as actions, not chats.</Txt>
      </View>
    </View>
  )
}

export function MessagesPane({ list }: { list: InboxList }) {
  const emp = useEmployeeId()
  const { emp: me } = useEmployee()
  const { C, isDark } = useTheme()
  const [folder, setFolder] = React.useState<FolderVM['code']>('ALL')
  const [filter, setFilter] = React.useState<ListFilter>('all')
  const [query, setQuery] = React.useState('')
  const [compose, setCompose] = React.useState<{ open: boolean; q: string }>({ open: false, q: '' })

  const folders = React.useMemo(() => Object.fromEntries(list.folders.map(f => [f.code, f])) as Record<string, FolderVM>, [list.folders])
  const visible = React.useMemo(() => selectConversations(list.conversations, { folder, filter, query }), [list.conversations, folder, filter, query])
  const firstName = me?.first_name || (me?.full_name || '').split(' ')[0] || ''
  const open = React.useCallback((id: string) => openThread(emp, id), [emp])
  const openCompose = (q = '') => setCompose({ open: true, q })

  const direct = folders.DIRECT
  const perf = folders.PERFORMANCE
  const title = folder === 'ALL' ? 'All' : folders[folder]?.label ?? 'All'
  const q = query.trim()
  const emptyMsg = q ? `No conversation with “${q}” yet.`
    : filter === 'unread' ? 'You are all caught up here.'
    : filter === 'starred' ? 'Star a conversation to keep it within reach.'
    : title === 'All' ? 'Start a conversation, or write to a desk.'
    : 'Nothing here yet.'

  return (
    <View>
      {/* Folder strip: compose + "Who is this from?" folders */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 2, paddingHorizontal: S.lg }} style={{ marginHorizontal: -S.lg }}>
        <Pressable onPress={() => openCompose('')} accessibilityRole="button" accessibilityLabel="New message"
          style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', opacity: pressed ? 0.85 : 1, ...elevation(C, 1) })}>
          <LinearGradient colors={[C.gradFrom, C.gradTo]} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <GPlus size={18} color={C.onAccent} strokeWidth={2.2} />
          </LinearGradient>
        </Pressable>
        <FolderChip label="All" unread={list.unread} on={folder === 'ALL'} onPress={() => setFolder('ALL')}
          ink={inkOf(direct, isDark, C.brand)} dot={direct && perf ? [direct.inkLight, perf.inkLight] : undefined} />
        {list.folders.map(f => (
          <FolderChip key={f.code} label={f.label} unread={f.unread} ink={inkOf(f, isDark, C.brand)} on={folder === f.code} onPress={() => setFolder(f.code)} />
        ))}
      </ScrollView>

      {/* List head */}
      <View style={{ marginTop: S.lg, flexDirection: 'row', alignItems: 'baseline', gap: S.sm }}>
        <Txt size={F.title} w={700}>{title}</Txt>
        <Txt size={F.tiny} tone="faint">{visible.length ? `${visible.length} conversation${visible.length > 1 ? 's' : ''}` : ''}</Txt>
      </View>
      <View style={{ marginTop: S.sm, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, backgroundColor: C.surface, minHeight: 44 }}>
        <GSearch size={16} color={C.faint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search people or desks…" placeholderTextColor={C.faint}
          accessibilityLabel="Search conversations" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
          style={[{ flex: 1, fontFamily: FONT[400], fontSize: F.small + 0.5, color: C.ink, paddingVertical: 9 }, webNoOutline]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: S.sm }}>
        {(['all', 'unread', 'starred'] as ListFilter[]).map(f => (
          <FilterChip key={f} label={f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Starred'} on={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      {/* Rows */}
      <View style={{ marginTop: S.sm, marginHorizontal: -6 }}>
        {visible.length === 0 ? (
          <EmptyBlock glyph={<GChat size={26} color={C.brand} />} title={q ? 'No matches' : 'Nothing here yet'} text={emptyMsg}
            action={q ? <Button title={`Search all colleagues for “${q}”`} variant="ghost" size="sm" icon={<GSearch size={14} color={C.brand} />} onPress={() => openCompose(q)} /> : undefined} />
        ) : (
          <>
            {!!q && (
              <Pressable onPress={() => openCompose(q)} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, borderRadius: 10, backgroundColor: pressed ? C.brandTint : C.sunken, marginBottom: 4 })}>
                <GSearch size={14} color={C.brand} />
                <Txt size={F.tiny} w={600} tone="brand" numberOfLines={1} style={{ flex: 1 }}>Not here? Search all colleagues for “{q}”</Txt>
              </Pressable>
            )}
            {visible.map(c => <ConversationRow key={c.id} c={c} folder={folders[c.folder]} onOpen={open} />)}
          </>
        )}
      </View>

      <View style={{ height: 1, backgroundColor: C.line, marginTop: S.lg }} />
      <CatchUp firstName={firstName} conversations={list.conversations} folders={folders} onOpen={open} onCompose={() => openCompose('')} />

      <ComposeSheet visible={compose.open} initialQuery={compose.q} folders={folders} conversations={list.conversations}
        onClose={() => setCompose(s => ({ ...s, open: false }))} />
    </View>
  )
}

/** The list's first load: six skeleton rows (ConversationList.tsx Skeleton). */
export function MessagesLoading() {
  return (
    <View>
      <Skeleton />
    </View>
  )
}
