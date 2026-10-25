// src/features/social/SocialScreen.tsx — Social (components/ess/social/Social.tsx).
//
// Four sub-tabs: Wall of Fame, Birthdays, Work anniversaries, New joiners. The
// counts are never summed. Scope is the caller's GROUP, which is why every
// person carries a company chip. Live mode only (the web's mock preview is a
// design harness).
//
// Data: GET /api/ess/social?employee_id=<me>. Writes go to POST /api/ess/social
// (react, react_comment, comment, wish), optimistic with roll-back and the
// "That did not save" notice, as on the web. After a comment or wish the whole
// payload reloads.
import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { invalidate, queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import {
  Cake, CoChip, Door, Medal, Send, ShieldOff, SocAvatar, SocCard, SocEmpty, Trophy, Wave, RemovedBlock, toggle, useKind, when,
  type SocialKind, type SocialPayload, type SocialPost, type SocialTab,
} from './shared'
import { PostCard } from './PostCard'
import { WishSheet } from './WishSheet'
import { WallOfFame } from './wall/WallOfFame'

const TABS: { k: SocialTab; label: string; kind: SocialKind }[] = [
  { k: 'wall', label: 'Wall of Fame', kind: 'shoutout' },
  { k: 'birthdays', label: 'Birthdays', kind: 'birthday' },
  { k: 'anniversaries', label: 'Work anniversaries', kind: 'anniversary' },
  { k: 'joiners', label: 'New joiners', kind: 'joiner' },
]
const TAB_ICON: Record<SocialTab, typeof Cake> = { wall: Trophy, birthdays: Cake, anniversaries: Medal, joiners: Door }

class Pending extends Error {}

async function loadSocial(employeeId: string): Promise<SocialPayload> {
  try {
    const j = await api<SocialPayload & { installed?: boolean }>('/api/ess/social', { employeeId })
    if (j?.installed === false) throw new Pending('pending')
    return j
  } catch (e) {
    if (e instanceof ApiError && (e.status === 503 || e.body?.installed === false)) throw new Pending('pending')
    if (e instanceof ApiError) throw new Error(e.body?.error || 'Could not load Social')
    throw e
  }
}

type Say = (p: SocialPost, message: string, mediaRef: string | null, isWish: boolean) => void
interface Handlers { me: SocialPayload['me']; react: (p: SocialPost, emoji: string) => void; reactComment: (p: SocialPost, commentId: string, emoji: string) => void; say: Say }

// ── module-level pieces ──────────────────────────────────────────────────

function DoneChip() {
  const { C } = useTheme()
  return (
    <View accessibilityState={{ disabled: true }} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center', backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
      <Txt size={F.tiny} w={600} tone="muted">Sent</Txt>
    </View>
  )
}

function ActionButton({ post, onOpen }: { post: SocialPost; onOpen: () => void }) {
  const { C } = useTheme()
  const k = useKind(post.kind)
  const label = { birthday: 'Wish', anniversary: 'Greet', joiner: 'Welcome', shoutout: 'Say something' }[post.kind]
  if (post.acted) return <DoneChip />
  return (
    <Pressable onPress={onOpen} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 8, backgroundColor: k.ink, opacity: pressed ? 0.85 : 1 })}>
      {post.kind === 'joiner' ? <Wave size={15} color={C.onAccent} /> : <Send size={15} color={C.onAccent} />}
      <Txt size={F.tiny} w={600} color={C.onAccent}>{label}</Txt>
    </Pressable>
  )
}

function PostBlock({ post, h }: { post: SocialPost; h: Handlers }) {
  const [composing, setComposing] = React.useState(false)
  return (
    <View>
      <PostCard post={post} me={h.me}
        onReact={e => h.react(post, e)} onComment={b => h.say(post, b, null, false)} onReactComment={(id, e) => h.reactComment(post, id, e)}
        action={post.removed ? undefined : <ActionButton post={post} onOpen={() => setComposing(true)} />} />
      {composing && (
        <WishSheet kind={post.kind} name={post.subject.name} onCancel={() => setComposing(false)}
          onSend={(message, media) => { setComposing(false); h.say(post, message, media?.ref ?? null, true) }} />
      )}
    </View>
  )
}

function UpcomingRow({ post, onSay }: { post: SocialPost; onSay: Say }) {
  const { C } = useTheme()
  const [composing, setComposing] = React.useState(false)
  const d = new Date((post.on ?? '') + 'T00:00:00')
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, alignItems: 'center' }}>
          <Txt size={17} w={700}>{d.getDate()}</Txt>
          <Txt size={11} tone="muted">{d.toLocaleDateString('en-IN', { month: 'short' })}</Txt>
        </View>
        <SocAvatar person={post.subject} mark={post.kind} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={13.5} w={600}>{post.subject.name}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
            <Txt size={12} tone="muted">{post.kind === 'anniversary' ? `${post.years} year${post.years === 1 ? '' : 's'} ${when(post.on ?? '')}` : `Birthday ${when(post.on ?? '')}`}</Txt>
            {!!post.subject.company && <CoChip name={post.subject.company} />}
          </View>
        </View>
        {post.acted ? <DoneChip /> : (
          <Pressable onPress={() => setComposing(c => !c)} accessibilityRole="button" accessibilityState={{ expanded: composing }}
            style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: C.lineStrong, backgroundColor: pressed ? C.sunken : C.surface })}>
            <Txt size={F.tiny} w={600} tone="soft">{post.kind === 'anniversary' ? 'Greet' : 'Wish'}</Txt>
          </Pressable>
        )}
      </View>
      {composing && (
        <WishSheet kind={post.kind} name={post.subject.name} onCancel={() => setComposing(false)}
          onSend={(message, media) => { setComposing(false); onSay(post, message, media?.ref ?? null, true) }} />
      )}
    </View>
  )
}

function Chips({ items, kinded }: { items: string[]; kinded?: boolean }) {
  const { C } = useTheme()
  const k = useKind('joiner')
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map(x => (
        <View key={x} style={{ height: 25, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center', backgroundColor: kinded ? k.tint : C.sunken, borderWidth: 1, borderColor: kinded ? k.ink2 : C.line }}>
          <Txt size={11.5} w={600} color={kinded ? k.ink : C.inkSoft}>{x}</Txt>
        </View>
      ))}
    </View>
  )
}

function Joiner({ p, h }: { p: SocialPost; h: Handlers }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <PostBlock post={p} h={h} />
      <View style={{ paddingLeft: 55, marginTop: 9, gap: 9 }}>
        {p.intro ? (
          <>
            <Txt size={13.5} tone="soft" style={{ lineHeight: 22 }}>{p.intro}</Txt>
            {!!p.hobbies?.length && <View><Txt size={11} w={700} tone="muted" upper style={{ marginBottom: 5 }}>Outside work</Txt><Chips items={p.hobbies} /></View>}
            {!!p.skills?.length && <View><Txt size={11} w={700} tone="muted" upper style={{ marginBottom: 5 }}>Brings with them</Txt><Chips items={p.skills} kinded /></View>}
          </>
        ) : (
          <SocEmpty title="No introduction yet" hint={`${p.subject.name.split(' ')[0]} has not written one. It is theirs to write, not HR's. Welcome them anyway.`} />
        )}
      </View>
    </View>
  )
}

function Sep({ children }: { children: React.ReactNode[] }) {
  const { C } = useTheme()
  return <>{children.map((c, i) => <View key={i} style={i ? { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line } : undefined}>{c}</View>)}</>
}

function TabRow({ tab, counts, onPick }: { tab: SocialTab; counts: Record<SocialTab, number>; onPick: (t: SocialTab) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Social sections" contentContainerStyle={{ gap: 8, paddingVertical: 2 }} style={{ flexGrow: 0, marginBottom: 14 }}>
      {TABS.map(t => <TabPill key={t.k} t={t} on={tab === t.k} count={counts[t.k]} onPress={() => onPick(t.k)} />)}
    </ScrollView>
  )
}
function TabPill({ t, on, count, onPress }: { t: (typeof TABS)[number]; on: boolean; count: number; onPress: () => void }) {
  const { C } = useTheme()
  const k = useKind(t.kind)
  const I = TAB_ICON[t.k]
  const fg = on ? C.onAccent : C.inkSoft
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, paddingLeft: 6, paddingRight: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? k.ink : C.line, backgroundColor: on ? k.ink : C.surface }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.22)' : k.tint }}><I size={15} color={on ? C.onAccent : k.ink} /></View>
      <Txt size={13} w={600} color={fg}>{t.label}</Txt>
      <View style={{ minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: 10, justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.24)' : C.sunken }}>
        <Txt size={11} w={700} center color={on ? C.onAccent : C.muted}>{count}</Txt>
      </View>
    </Pressable>
  )
}

function Notices({ list }: { list: SocialPayload['notices'] }) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState<string | null>(null)
  return (
    <View style={{ gap: 8, marginBottom: 14 }}>
      {list.map(n => (
        <View key={n.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, overflow: 'hidden' }}>
          <Pressable onPress={() => setOpen(o => (o === n.id ? null : n.id))} accessibilityRole="button" accessibilityState={{ expanded: open === n.id }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, minHeight: 44 }}>
            <ShieldOff size={16} color={C.critical} />
            <Txt size={F.small} w={600}>A post of yours was removed</Txt>
            <Txt size={F.tiny} tone="muted" numberOfLines={1} style={{ flex: 1 }}>{n.excerpt}</Txt>
          </Pressable>
          {open === n.id && <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}><RemovedBlock remark={n.removed.remark} mine /></View>}
        </View>
      ))}
    </View>
  )
}

function StateCard({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ marginTop: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
        <Txt size={17} w={600} style={{ flex: 1 }}>{title}</Txt>
      </View>
      {!!hint && <Txt size={12.5} tone="muted" style={{ lineHeight: 19 }}>{hint}</Txt>}
    </View>
  )
}

// ── the screen ───────────────────────────────────────────────────────────

export default function SocialScreen() {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const key = React.useMemo(() => ['social', employeeId] as const, [employeeId])
  const q = useQuery({ queryKey: key, queryFn: () => loadSocial(employeeId), enabled: !!employeeId, retry: (n, e) => !(e instanceof Pending) && n < 2 })
  const [tab, setTab] = React.useState<SocialTab>('wall')
  const [errState, setErrState] = React.useState<{ msg: string; at: number } | null>(null)
  const setErr = React.useCallback((msg: string) => setErrState({ msg, at: Date.now() }), [])
  const [refreshing, setRefreshing] = React.useState(false)
  const scroll = React.useRef<ScrollView>(null)
  const wallTop = React.useRef(0)

  // A later successful load clears the write error, as on the web.
  const err = errState && errState.at > q.dataUpdatedAt ? errState.msg : null

  const update = React.useCallback((next: SocialPost) => queryClient.setQueryData<SocialPayload>(key, d => {
    if (!d) return d
    const swap = (list: SocialPost[]) => list.map(p => (p.id === next.id ? next : p))
    return { ...d, today: swap(d.today), upcoming_birthdays: swap(d.upcoming_birthdays), week_anniversaries: swap(d.week_anniversaries), joiners: swap(d.joiners), wall: swap(d.wall) }
  }), [key])

  const send = React.useCallback(async (payload: Record<string, unknown>) => {
    try { return await api('/api/ess/social', { method: 'POST', body: payload, employeeId }) }
    catch (e) { throw new Error(e instanceof ApiError ? (e.body?.error || 'That did not save') : (e as Error).message) }
  }, [employeeId])

  const h: Handlers | null = q.data ? {
    me: q.data.me,
    react: async (post, emoji) => {
      const before = post
      update({ ...post, reactions: toggle(post.reactions, emoji) })
      try {
        await send(post.source === 'wall' ? { action: 'react', post_id: post.id, emoji, source: 'wall' } : { action: 'react', post_id: post.id, emoji })
      } catch (e) { update(before); setErr((e as Error).message) }
    },
    reactComment: async (post, commentId, emoji) => {
      const before = post
      update({ ...post, comments: post.comments.map(c => (c.id === commentId ? { ...c, reactions: toggle(c.reactions, emoji) } : c)) })
      // A comment that is still local has no server id yet: keep the toggle local.
      if (commentId.startsWith('local-')) return
      try { await send({ action: 'react_comment', comment_id: commentId, emoji }) }
      catch (e) { update(before); setErr((e as Error).message) }
    },
    say: async (post, message, mediaRef, isWish) => {
      const d = q.data!
      const before = post
      update({
        ...post, acted: isWish ? true : post.acted,
        comments: [...post.comments, { id: `local-${Date.now()}`, author: d.me, body: message, at: new Date().toISOString(), reactions: [], mine: true, media: mediaRef ? { kind: 'gif', ref: mediaRef, label: mediaRef } : null }],
      })
      try {
        await send({ action: isWish ? 'wish' : 'comment', post_id: post.id, body: message, media_ref: mediaRef })
        void invalidate('social', 'notifications', 'today')
      } catch (e) { update(before); setErr((e as Error).message) }
    },
  } : null

  const refresh = async () => {
    setRefreshing(true)
    try { await Promise.all([q.refetch(), invalidate('wall')]) } finally { setRefreshing(false) }
  }

  let body: React.ReactNode
  if (q.error instanceof Pending) {
    body = <StateCard icon={<Trophy size={17} color={C.brand} />} title="Social is not switched on yet"
      hint="The screens are built and waiting. The tables they read come from migration 118, which is written and handed over but not applied to this database yet. Nothing here is broken." />
  } else if (!q.data) {
    body = q.error
      ? <StateCard icon={<ShieldOff size={17} color={C.brand} />} title="Could not load Social" hint={(q.error as Error).message || 'Could not load Social'} />
      : <View style={{ marginTop: 18, height: 220, opacity: 0.5, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }} />
  } else {
    const data = q.data
    const todayBirthdays = data.today.filter(p => p.kind === 'birthday')
    const todayAnnivs = data.today.filter(p => p.kind === 'anniversary')
    const counts: Record<SocialTab, number> = {
      wall: data.wall.length,
      birthdays: todayBirthdays.length + data.upcoming_birthdays.length,
      anniversaries: todayAnnivs.length + data.week_anniversaries.length,
      joiners: data.joiners.length,
    }
    const active = TABS.find(t => t.k === tab)!
    const ink = (kind: SocialKind) => <KindInk kind={kind} />
    body = (
      <>
        <View style={{ flexDirection: 'row', marginTop: 2, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 28, paddingHorizontal: 11, borderRadius: 999, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.positive }} />
            <Txt size={12} w={600} tone="soft">{data.group.name} · {data.group.companies} {data.group.companies === 1 ? 'company' : 'companies'}</Txt>
          </View>
        </View>
        <TabRow tab={tab} counts={counts} onPick={setTab} />
        {data.notices.length > 0 && <Notices list={data.notices} />}
        {!!err && (
          <View style={{ marginBottom: 14, flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge }}>
            <ShieldOff size={18} color={C.critical} />
            <View style={{ flex: 1 }}>
              <Txt size={F.small} w={700} tone="critical">That did not save</Txt>
              <Txt size={F.tiny} tone="soft" style={{ marginTop: 2 }}>{err}</Txt>
            </View>
          </View>
        )}

        {tab === 'wall' && (
          <View onLayout={e => { wallTop.current = e.nativeEvent.layout.y }}>
            <WallOfFame employeeId={employeeId} onJump={y => scroll.current?.scrollTo({ y: wallTop.current + y - 8, animated: true })} />
          </View>
        )}

        {tab === 'birthdays' && h && (
          <>
            <SocCard kind="birthday" icon={ink('birthday')} title="Today" today={todayBirthdays.length > 0} hint="Say something. It takes ten seconds and it is remembered.">
              {todayBirthdays.length ? <Sep>{todayBirthdays.map(p => <PostBlock key={p.id} post={p} h={h} />)}</Sep>
                : <SocEmpty title="No birthdays today" hint="The next ones are listed below." />}
            </SocCard>
            <SocCard kind="birthday" icon={ink('birthday')} title="Coming up" hint="The next few, so nobody is a surprise.">
              {data.upcoming_birthdays.length ? <View>{data.upcoming_birthdays.map(p => <UpcomingRow key={p.id} post={p} onSay={h.say} />)}</View>
                : <SocEmpty title="None coming up" hint="They will appear here as they come round." />}
            </SocCard>
          </>
        )}

        {tab === 'anniversaries' && h && (
          <>
            <SocCard kind="anniversary" icon={ink('anniversary')} title="Today" today={todayAnnivs.length > 0} hint="A year of work is worth a sentence from someone who saw it.">
              {todayAnnivs.length ? <Sep>{todayAnnivs.map(p => <PostBlock key={p.id} post={p} h={h} />)}</Sep>
                : <SocEmpty title="No anniversaries today" hint="This week’s are listed below." />}
            </SocCard>
            <SocCard kind="anniversary" icon={ink('anniversary')} title="This week" hint="Anniversaries falling in the next seven days.">
              {data.week_anniversaries.length ? <View>{data.week_anniversaries.map(p => <UpcomingRow key={p.id} post={p} onSay={h.say} />)}</View>
                : <SocEmpty title="None this week" hint="They will appear here as they come round." />}
            </SocCard>
          </>
        )}

        {tab === 'joiners' && h && (
          <SocCard kind="joiner" icon={ink('joiner')} title="New joiners" hint={`Everyone who joined recently, across ${data.group.name}. Say hello.`}>
            {data.joiners.length ? data.joiners.map(p => <Joiner key={p.id} p={p} h={h} />)
              : <SocEmpty title="Nobody new right now" hint="New joiners appear here for their first few weeks." />}
          </SocCard>
        )}

        <Txt size={11.5} tone="faint" center style={{ marginTop: 18, marginBottom: 24 }}>
          Showing {active.label.toLowerCase()} for {data.group.name}. Birthdays show the day and month only, never the year.
        </Txt>
      </>
    )
  }

  return (
    <Screen title="Social" subtitle="Birthdays, work anniversaries, new joiners and the Wall of Fame" scroll={false} padded={false}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} />}>
        {body}
      </ScrollView>
    </Screen>
  )
}

function KindInk({ kind }: { kind: SocialKind }) {
  const k = useKind(kind)
  const I = kind === 'birthday' ? Cake : kind === 'anniversary' ? Medal : kind === 'joiner' ? Door : Trophy
  return <I size={17} color={k.ink} />
}
