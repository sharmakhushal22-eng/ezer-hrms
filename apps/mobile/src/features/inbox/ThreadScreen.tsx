// src/features/inbox/ThreadScreen.tsx — one conversation, on its own screen.
//
// components/ess/inbox/ThreadPane.tsx + Composer.tsx, as the website draws them
// at ≤760 px (a full-screen layer with a Back button). Opening it is reading it:
// GET /messages sets last_read_at and, for a SYSTEM thread, marks the matching
// bell notifications read — so the bell's queries are invalidated afterwards.
// Polled every 20 s while open (thread and list), like the website.
//
// Route params: id (conversation), u (its unread count when it was opened —
// where the red "New" divider goes; the GET zeroes it on the server).
import * as React from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { STREAM, type StreamCode } from '@web/inbox/streams'
import { openLink, openWebsite } from '@/core/links'
import { invalidate } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, FONT, R, S, SERIF } from '@/ui/theme'
import { Button, Txt, webNoOutline } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import { openThread, sendMessage, useInboxList, useThread, type ThreadData } from './data'
import {
  dayLabel, exactTime, newDividerIndex, relTime, toFolders, withinGroupWindow,
  type ConversationVM, type FolderCode, type FolderVM, type MessageVM, type NoteVM,
} from './model'
import { alpha, FolderGlyph, GBack, GCheck, GDown, GSend, inkOf, MINE_GRAD, MINE_INK } from './glyphs'
import { ConvAvatar, KindChip } from './parts'
import { ComposeSheet } from './ComposeSheet'

/** A thread the list has not caught up with yet (just started): enough to draw the header. */
function fallbackConv(id: string, t: ThreadData | undefined): ConversationVM | null {
  const r = t?.conversation
  if (!r) return null
  const kind = t!.kind
  const code = String(kind === 'SYSTEM' ? r.stream_code : kind === 'DIRECT' ? 'DIRECT' : 'HR')
  const folder = (STREAM.get(code as StreamCode) ?? STREAM.get('HR')!).code as FolderCode
  return {
    id, folder, kind, title: String(r.subject || 'Conversation'), preview: '', unread: 0,
    updatedAt: String(r.last_message_at || new Date(0).toISOString()), starred: false, muted: false, closed: !!r.is_closed, staffed: false,
  }
}

function DayPill({ label }: { label: string }) {
  const { C } = useTheme()
  return (
    <View style={{ alignSelf: 'center', marginTop: 8, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: C.sunken }}>
      <Txt size={11} w={600} tone="faint">{label}</Txt>
    </View>
  )
}

function NewLine({ onLayout }: { onLayout: (e: LayoutChangeEvent) => void }) {
  const { C } = useTheme()
  const line = { flex: 1, height: 1, backgroundColor: alpha(C.critical, 0.45) }
  return (
    <View onLayout={onLayout} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }}>
      <View style={line} /><Txt size={11} w={600} tone="critical">New</Txt><View style={line} />
    </View>
  )
}

function Bubble({ m, cont, tail }: { m: MessageVM; cont: boolean; tail: boolean }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const side = m.mine ? 'flex-end' : 'flex-start'
  if (m.deleted) {
    return (
      <View style={{ alignSelf: side, alignItems: side, maxWidth: '78%' }}>
        <View style={{ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16, backgroundColor: C.sunken, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong }}>
          <Txt size={13.5} tone="faint" style={{ fontStyle: 'italic' }}>Message deleted</Txt>
        </View>
        <Txt size={10.5} tone="faint" style={{ marginTop: 4, marginHorizontal: 6 }}>{relTime(m.sentAt)}</Txt>
      </View>
    )
  }
  const radius = {
    borderRadius: 16,
    ...(m.mine ? { borderBottomRightRadius: 5, borderTopRightRadius: cont ? 6 : 16 } : { borderBottomLeftRadius: 5, borderTopLeftRadius: cont ? 6 : 16 }),
  }
  const body = <Txt size={13.5} color={m.mine ? MINE_INK : C.ink} selectable>{m.body}</Txt>
  return (
    <View style={{ alignSelf: side, alignItems: side, maxWidth: '78%', marginTop: cont ? -2 : 0 }}>
      {/* The website's bubble tooltip is the exact time; a long press shows it here. */}
      <Pressable onLongPress={() => notify(exactTime(m.sentAt), 'info')} accessibilityHint={exactTime(m.sentAt)}>
        {m.mine
          ? <LinearGradient colors={MINE_GRAD} style={{ paddingVertical: 9, paddingHorizontal: 13, ...radius }}>{body}</LinearGradient>
          : <View style={{ paddingVertical: 9, paddingHorizontal: 13, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, ...radius }}>{body}</View>}
      </Pressable>
      {tail && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginHorizontal: 6, flexWrap: 'wrap', justifyContent: side }}>
          {!!m.authorName && !m.mine && <Txt size={10.5} tone="faint">{m.authorName} ·</Txt>}
          <Txt size={10.5} tone="faint">{relTime(m.sentAt)}</Txt>
          {m.mine && (m.pending
            ? <Txt size={10.5} tone="faint">· sending…</Txt>
            : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Txt size={10.5} tone="positive">·</Txt><GCheck size={11} color={C.positive} /><Txt size={10.5} tone="positive">sent</Txt></View>)}
        </View>
      )}
    </View>
  )
}

function Messages({ messages, newFrom, onNewLine }: { messages: MessageVM[]; newFrom: number; onNewLine: (y: number) => void }) {
  const days = messages.map(m => dayLabel(m.sentAt))
  return (
    <>
      {messages.map((m, i) => {
        const day = days[i]
        const newDay = i === 0 || day !== days[i - 1]
        const prev = messages[i - 1], next = messages[i + 1]
        const cont = !newDay && !!prev && !prev.deleted && prev.mine === m.mine && withinGroupWindow(prev.sentAt, m.sentAt)
        const tail = !next || next.deleted || next.mine !== m.mine || !withinGroupWindow(next.sentAt, m.sentAt) || dayLabel(next.sentAt) !== day
        return (
          <React.Fragment key={m.id}>
            {newDay && <DayPill label={day} />}
            {newFrom >= 0 && i === newFrom && <NewLine onLayout={e => onNewLine(e.nativeEvent.layout.y)} />}
            <Bubble m={m} cont={cont} tail={tail} />
          </React.Fragment>
        )
      })}
    </>
  )
}

function Notes({ notes, folder, ink }: { notes: NoteVM[]; folder: FolderVM['code']; ink: string }) {
  const open = (href: string) => { if (!openLink(href) && href.startsWith('/')) void openWebsite(href) }
  const days = notes.map(n => dayLabel(n.sentAt))
  return (
    <>
      {notes.map((n, i) => {
        const day = days[i]; const newDay = i === 0 || day !== days[i - 1]
        return (
          <React.Fragment key={n.id}>
            {newDay && <DayPill label={day} />}
            <View style={{ flexDirection: 'row', gap: 12, padding: 14, paddingHorizontal: 16, borderRadius: R.lg, borderWidth: 1, borderColor: alpha(ink, 0.28), backgroundColor: alpha(ink, 0.05) }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(ink, 0.16) }}>
                <FolderGlyph code={folder} size={17} color={ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={13.5} w={700} style={{ marginBottom: 3 }}>{n.title}</Txt>
                {!!n.body && <Txt size={F.small} tone="soft">{n.body}</Txt>}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  {n.cta && <Button title={n.cta.label} size="sm" onPress={() => open(n.cta!.href)} />}
                  <Txt size={11} tone="faint">{relTime(n.sentAt)}</Txt>
                </View>
              </View>
            </View>
          </React.Fragment>
        )
      })}
    </>
  )
}

/** Composer.tsx. A Send button instead of Enter; return inserts a newline. */
function Composer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const { C } = useTheme()
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [ok, setOk] = React.useState(false)
  const canSend = !busy && text.trim().length > 0
  async function submit() {
    if (!canSend) return
    setBusy(true)
    try {
      await onSend(text.trim())
      setText('')
      setOk(true); setTimeout(() => setOk(false), 900)
    } catch { /* toasted by the screen; the text stays */ } finally { setBusy(false) }
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 6, paddingLeft: 12, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.sunken }}>
      <TextInput value={text} onChangeText={setText} multiline placeholder="Write a reply…" placeholderTextColor={C.faint} accessibilityLabel="Write a reply"
        style={[{ flex: 1, maxHeight: 160, minHeight: 36, fontFamily: FONT[400], fontSize: 13.5, color: C.ink, paddingTop: 8, paddingBottom: 8, textAlignVertical: 'top' }, webNoOutline]} />
      <Pressable onPress={() => void submit()} disabled={!canSend && !ok} accessibilityRole="button" accessibilityLabel="Send"
        style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', opacity: canSend || ok ? 1 : 0.45 }}>
        {ok
          ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.positive }}><GCheck size={18} color={C.onAccent} strokeWidth={2.2} /></View>
          : <LinearGradient colors={[C.gradFrom, C.gradTo]} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {busy ? <ActivityIndicator size="small" color={C.onAccent} /> : <GSend size={17} color={C.onAccent} />}
            </LinearGradient>}
      </Pressable>
    </View>
  )
}

function Header({ c, folder, ink }: { c: ConversationVM | null; folder?: FolderVM; ink: string }) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const kindLabel = !c ? '' : c.kind === 'DIRECT' ? 'Direct message' : c.kind === 'DESK' ? 'Department desk' : 'Updates: notifications with an action'
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, paddingLeft: 4, paddingRight: S.lg, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: alpha(ink, 0.06), borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))} accessibilityLabel="Back to list" hitSlop={8}
        style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
        <GBack size={20} color={C.ink} strokeWidth={2} />
      </Pressable>
      {c && <ConvAvatar c={c} ink={ink} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={19} w={600} numberOfLines={1} style={{ fontFamily: SERIF }}>{c?.title || ''}</Txt>
        {c && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2, flexWrap: 'wrap' }}>
            {folder && <KindChip label={folder.label} color={ink} />}
            <Txt size={F.tiny} tone="muted" numberOfLines={1}>{kindLabel}</Txt>
            {c.muted && <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: C.sunken }}><Txt size={11} w={600} tone="muted">Muted</Txt></View>}
            {c.closed && <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: C.warningTint }}><Txt size={11} w={600} tone="warning">Closed</Txt></View>}
          </View>
        )}
      </View>
    </View>
  )
}

export default function ThreadScreen() {
  const { id: rawId, u } = useLocalSearchParams<{ id: string; u?: string }>()
  const id = String(rawId || '')
  const emp = useEmployeeId()
  const { C, isDark } = useTheme()
  const { notify } = useOverlay()
  const list = useInboxList()
  const t = useThread(id)
  const [pending, setPending] = React.useState<MessageVM[]>([])
  const [compose, setCompose] = React.useState(false)
  const [jump, setJump] = React.useState<'off' | 'on' | 'new'>('off')
  const unreadAtOpen = Number(u) || 0

  const listFolders = list.data?.folders
  const folders = React.useMemo(() => {
    const fs = listFolders?.length ? listFolders : toFolders([])
    return Object.fromEntries(fs.map(f => [f.code, f])) as Record<string, FolderVM>
  }, [listFolders])
  const conv = list.data?.conversations.find(c => c.id === id) ?? fallbackConv(id, t.data)
  const folder = conv ? folders[conv.folder] : undefined
  const ink = inkOf(folder, isDark, C.brand)
  const system = (conv?.kind ?? t.data?.kind) === 'SYSTEM'
  const messages = React.useMemo(() => [...(t.data?.messages ?? []), ...pending], [t.data?.messages, pending])
  const notes = t.data?.notes ?? []
  const count = system ? notes.length : messages.length
  const newFrom = system ? -1 : newDividerIndex(t.data?.messages.length ?? 0, unreadAtOpen)

  // Reading changed the bell: refresh its two sources when the thread first
  // loads and whenever new messages were read by a poll.
  const readCount = t.data?.count
  React.useEffect(() => { if (readCount !== undefined) void invalidate('notifications', 'inbox-unread') }, [readCount])

  // ── scrolling: open at the "New" divider (60 px above) or the bottom; follow
  // own sends and polls while near the bottom; otherwise offer the pill.
  const scroll = React.useRef<ScrollView>(null)
  const geo = React.useRef({ y: 0, h: 0, content: 0, newLine: -1, placed: false, count: 0 })
  const nearBottom = () => geo.current.content - geo.current.y - geo.current.h < 120
  const onContent = (_w: number, h: number) => {
    const g = geo.current
    g.content = h
    if (!t.data) return
    if (!g.placed) {
      g.placed = true; g.count = count
      setTimeout(() => {
        if (newFrom >= 0 && g.newLine >= 0) scroll.current?.scrollTo({ y: Math.max(0, g.newLine - 60), animated: false })
        else scroll.current?.scrollToEnd({ animated: false })
      }, 0)
      return
    }
    if (count > g.count) {
      const last = messages[messages.length - 1]
      const mine = !system && !!last?.mine
      if (mine || nearBottom()) scroll.current?.scrollToEnd({ animated: true })
      else setJump('new')
    }
    g.count = count
  }
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const ne = e.nativeEvent
    geo.current.y = ne.contentOffset.y; geo.current.h = ne.layoutMeasurement.height; geo.current.content = ne.contentSize.height
    const near = nearBottom()
    setJump(j => (near ? 'off' : j === 'new' ? 'new' : 'on'))
  }

  async function onSend(body: string) {
    const tmp: MessageVM = { id: `tmp-${Date.now()}`, mine: true, body, sentAt: new Date().toISOString(), deleted: false, pending: true }
    setPending(p => [...p, tmp])
    try {
      await sendMessage(emp, id, body)
      await Promise.all([t.refetch(), list.refetch()])
    } catch (e) {
      notify((e as Error).message || 'Message not sent', 'error')
      throw e
    } finally {
      setPending(p => p.filter(m => m.id !== tmp.id))
    }
  }

  function writeToDesk() {
    const existing = conv && list.data?.conversations.find(c => c.kind === 'DESK' && c.folder === conv.folder)
    if (existing) openThread(emp, existing.id, 'replace')
    else setCompose(true)
  }

  const footer = !conv ? null : system ? (
    <View style={{ paddingVertical: 6 }}>
      <Txt size={12.5} tone="muted" center>
        This is a one-way stream. Act on the update above. Questions?{' '}
        <Txt size={12.5} w={700} tone="brand" onPress={writeToDesk}>Write to a desk</Txt>
      </Txt>
    </View>
  ) : conv.closed ? (
    <View style={{ paddingVertical: 6 }}>
      <Txt size={12.5} tone="muted" center><Txt size={12.5} w={700}>Closed.</Txt> Nobody can reply until it is reopened.</Txt>
    </View>
  ) : <Composer key={id} onSend={onSend} />

  const loading = !t.data && !t.error
  return (
    <Screen top={<Header c={conv} folder={folder} ink={ink} />} scroll={false} padded={false} footer={footer ?? undefined}>
      <ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={64} onContentSizeChange={onContent}
        onLayout={e => { geo.current.h = e.nativeEvent.layout.height }}
        contentContainerStyle={{ padding: 18, paddingBottom: 12, gap: 6, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {loading && (
          <View style={{ padding: S.xxl, alignItems: 'center', gap: S.md }}>
            <ActivityIndicator color={C.brand} />
            <Txt size={F.small} tone="muted">Opening the conversation…</Txt>
          </View>
        )}
        {!t.data && !!t.error && (
          <View style={{ padding: S.xl, alignItems: 'center', gap: S.md }}>
            <Txt size={F.small} tone="critical" center>{(t.error as Error).message}</Txt>
            <Button title="Try again" variant="outline" size="sm" onPress={() => void t.refetch()} />
          </View>
        )}
        {!!t.data && count === 0 && !system && <Txt size={F.small} tone="muted" center style={{ padding: S.xl }}>No messages yet. Say hello.</Txt>}
        {!!t.data && (system
          ? <Notes notes={notes} folder={conv?.folder ?? 'HR'} ink={ink} />
          : <Messages messages={messages} newFrom={newFrom} onNewLine={y => { geo.current.newLine = y }} />)}
      </ScrollView>
      {jump !== 'off' && (
        <Pressable onPress={() => { scroll.current?.scrollToEnd({ animated: true }); setJump('off') }} accessibilityRole="button"
          style={{ position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18,
            backgroundColor: jump === 'new' ? C.brand : C.surface, borderWidth: 1, borderColor: jump === 'new' ? C.brand : C.line, ...elevation(C, 2) }}>
          <GDown size={14} color={jump === 'new' ? C.onAccent : C.ink} />
          <Txt size={F.tiny} w={700} color={jump === 'new' ? C.onAccent : C.ink}>{jump === 'new' ? 'New message' : 'Latest'}</Txt>
        </Pressable>
      )}
      <ComposeSheet visible={compose} folders={folders} conversations={list.data?.conversations ?? []} onClose={() => setCompose(false)} replace />
    </Screen>
  )
}
