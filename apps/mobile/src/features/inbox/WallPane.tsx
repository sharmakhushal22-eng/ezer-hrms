// src/features/inbox/WallPane.tsx — Inbox → Wall of Fame.
//
// components/wall/WallInbox.tsx (data) + components/ess/inbox/WallInboxView.tsx
// (render). Only things a colleague actually said: notes, comments and replies
// about your recognition. Approvals never appear here.
//
// Calls (spec 08 §2, §6.4.12), all through POST /api/ess/wall:
//   get_inbox_counts {}                          → the Wall tab badge (total_unread)
//   get_wall_inbox { p_filter, p_limit: 30 }      → the cards (filtered on the server)
//   mark_inbox_read { p_ids: [id] }               → "Mark read"
//   thank_for_appreciation { p_message }          → "Thank back" (no p_body, as on the web)
// Loaded when the tab is first opened and when the stream chip changes. No polling.
import * as React from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { api, ApiError } from '@/core/api'
import { queryClient } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import { STREAM_OF, headlineFor, countsReconcile, type Counts, type WallEvent } from '@web/wall/inbox'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { initials, relTime, type WallItemVM, type WallStream } from './model'
import { alpha, gold, ON_GOLD, GChat, GHeart, GReply, GStar, WALL_AVATAR } from './glyphs'
import { AbsentBlock, EmptyBlock, FilterChip } from './parts'

// ── lib/wall/rpc.ts, for the phone: same { data, error } contract ───────────
export interface WallResult<T = unknown> { data: T | null; error: { message: string; status?: number; installed?: boolean; code?: string } | null }
export async function wallRpc<T = unknown>(action: string, args: Record<string, unknown>, employeeId: string): Promise<WallResult<T>> {
  try {
    const payload = await api<{ data?: T }>('/api/ess/wall', { method: 'POST', body: { action, ...args, employee_id: employeeId } })
    return { data: (payload?.data ?? null) as T | null, error: null }
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) {
      const b = e.body && typeof e.body === 'object' ? e.body : null
      return { data: null, error: { message: b?.error ?? `The request failed (${e.status}).`, status: e.status, installed: b?.installed } }
    }
    return { data: null, error: { message: 'Could not reach the server.' } }
  }
}

const missing = (e: WallResult['error']) =>
  e?.installed === false || e?.code === 'PGRST205' || /PGRST205|does not exist|could not find/i.test(String(e?.message ?? ''))

interface InboxRow {
  id: string; event_type: string; is_read: boolean; created_at: string | null
  actor_name: string | null; actor_designation: string | null; preview: string | null; body: string | null
  category_label: string | null; category_glyph: string | null
  recognition_id: string | null; comment_id: string | null; message_id: string | null; can_thank: boolean | null
}
interface WallData { ready: boolean; err: string | null; counts: Counts; rows: InboxRow[] }

const wallKey = (stream: WallStream, emp: string) => ['inbox', 'wall', stream, emp] as const

async function loadWall(stream: WallStream, emp: string): Promise<WallData> {
  const c = await wallRpc<Counts>('get_inbox_counts', {}, emp)
  if (c.error) return { ready: false, err: missing(c.error) ? null : c.error.message, counts: {}, rows: [] }
  const r = await wallRpc<InboxRow[]>('get_wall_inbox', { p_filter: stream, p_limit: 30 }, emp)
  // As on the web: a failed list call keeps whatever rows were showing.
  const prev = queryClient.getQueryData<WallData>(wallKey(stream, emp))?.rows ?? []
  return { ready: true, err: null, counts: (c.data ?? {}) as Counts, rows: r.error ? prev : ((r.data ?? []) as InboxRow[]) }
}

function toItem(r: InboxRow): WallItemVM {
  const ev = r.event_type as WallEvent
  const who = r.actor_name ?? 'A colleague'
  return {
    id: r.id,
    type: STREAM_OF[ev] ?? 'appreciation',
    actorName: who,
    actorDesignation: r.actor_designation ?? '',
    headline: headlineFor(ev, who),
    badge: r.category_label ? `${r.category_glyph ? `${r.category_glyph} ` : ''}${r.category_label}` : undefined,
    text: r.body ?? r.preview ?? '',
    sentAt: r.created_at ?? '',
    unread: !r.is_read,
    canThankBack: !!r.can_thank,
    thankId: r.message_id ?? r.id,
  }
}

const CHIPS: { k: WallStream; label: string }[] = [
  { k: 'all', label: 'All' }, { k: 'appreciation', label: 'Appreciation' }, { k: 'comments', label: 'Comments' }, { k: 'replies', label: 'Replies' },
]
const CATEGORY = { appreciation: 'Appreciation', comments: 'Comment', replies: 'Reply' } as const

function WallCard({ w, onThank, onRead }: { w: WallItemVM; onThank: () => void; onRead: () => void }) {
  const { C, isDark } = useTheme()
  const g = gold(isDark)
  const cat = w.type === 'appreciation' ? { bg: alpha(g, 0.15), fg: g, Icon: GStar }
    : w.type === 'comments' ? { bg: C.infoTint, fg: C.info, Icon: GChat }
    : { bg: C.positiveTint, fg: C.positive, Icon: GReply }
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 14, paddingHorizontal: 16, borderRadius: R.lg, borderWidth: 1,
      borderColor: w.unread ? alpha(g, 0.45) : C.line, backgroundColor: w.unread ? alpha(g, 0.05) : C.surface }}>
      {w.unread && <View style={{ position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: g }} />}
      <LinearGradient colors={[WALL_AVATAR.from, WALL_AVATAR.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: g }}>
        <Txt size={F.small} w={700} color={WALL_AVATAR.ink}>{initials(w.actorName)}</Txt>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, paddingRight: w.unread ? 16 : 0 }}>
          <Txt size={F.small + 0.5} w={700}>{w.actorName}</Txt>
          {!!w.actorDesignation && <Txt size={11.5} tone="faint">{w.actorDesignation}</Txt>}
          <Txt size={11} tone="faint" style={{ marginLeft: 'auto' }}>{relTime(w.sentAt)}</Txt>
        </View>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: cat.bg }}>
          <cat.Icon size={12} color={cat.fg} />
          <Txt size={11} w={700} color={cat.fg}>{w.badge ?? CATEGORY[w.type]}</Txt>
        </View>
        <Txt size={F.small} w={600} style={{ marginTop: 8 }}>{w.headline}</Txt>
        {!!w.text && (w.type === 'appreciation'
          ? <Txt size={15} color={C.ink} style={{ marginTop: 6, fontFamily: SERIF, fontStyle: 'italic' }}>“{w.text}”</Txt>
          : <Txt size={13.5} tone="soft" style={{ marginTop: 6 }}>{w.text}</Txt>)}
        {(w.canThankBack || w.unread) && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {w.canThankBack && (
              <Pressable onPress={onThank} disabled={w.thanked} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: R.pill, borderWidth: 1,
                  borderColor: w.thanked ? 'transparent' : alpha(g, 0.4), backgroundColor: w.thanked ? g : pressed ? alpha(g, 0.1) : 'transparent' })}>
                <GHeart size={14} color={w.thanked ? ON_GOLD : g} />
                <Txt size={F.tiny} w={700} color={w.thanked ? ON_GOLD : g}>{w.thanked ? 'Thanked' : 'Thank back'}</Txt>
              </Pressable>
            )}
            {w.unread && <FilterChip label="Mark read" on={false} onPress={onRead} />}
          </View>
        )}
      </View>
    </View>
  )
}

export function WallPane({ onUnread }: { onUnread: (n: number) => void }) {
  const emp = useEmployeeId()
  const { C } = useTheme()
  const [stream, setStream] = React.useState<WallStream>('all')
  const [err, setErr] = React.useState<string | null>(null)
  const key = wallKey(stream, emp)
  const q = useQuery({ queryKey: key, queryFn: () => loadWall(stream, emp), enabled: !!emp, placeholderData: keepPreviousData })
  const d = q.data

  React.useEffect(() => { if (d?.ready) onUnread(d.counts.total_unread ?? 0) }, [d, onUnread])

  const markRead = async (id: string) => {
    const row = d?.rows.find(r => r.id === id)
    if (!row || row.is_read) return
    queryClient.setQueryData<WallData>(key, x => x && ({ ...x, rows: x.rows.map(r => (r.id === id ? { ...r, is_read: true } : r)) }))
    await wallRpc('mark_inbox_read', { p_ids: [id] }, emp)
    void q.refetch()
  }
  const thank = async (messageId: string) => {
    const r = await wallRpc('thank_for_appreciation', { p_message: messageId }, emp)
    if (r.error) { setErr(r.error.message); return }
    void q.refetch()
  }

  if (!d) {
    return (
      <View style={{ padding: S.xxl, alignItems: 'center', gap: S.md }}>
        <ActivityIndicator color={C.brand} />
        <Txt size={F.small} tone="muted">Opening the wall…</Txt>
      </View>
    )
  }
  if (!d.ready) {
    return (
      <AbsentBlock glyph={<Txt size={26} color={C.warning}>★</Txt>} title="Not switched on yet">
        {d.err ?? 'The Wall of Fame is not switched on for this company yet. Once it is, notes, comments and replies from colleagues will appear here, separately from your approvals.'}
      </AbsentBlock>
    )
  }
  const items = d.rows.map(toItem)
  return (
    <View>
      <Txt size={F.title} w={700}>Wall of Fame</Txt>
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>Approvals and nominations stay in your approvals queue. Only appreciation lives here.</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.md }}>
        {CHIPS.map(c => <FilterChip key={c.k} label={c.label} on={stream === c.k} onPress={() => setStream(c.k)} />)}
      </View>
      {!countsReconcile(d.counts) && (
        <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
          <Txt size={F.tiny} tone="soft">The unread totals do not add up. Some events are not in any stream. Worth telling HR.</Txt>
        </View>
      )}
      {!!err && (
        <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge }}>
          <Txt size={F.tiny} tone="critical">{err}</Txt>
        </View>
      )}
      <View style={{ gap: 10, marginTop: S.md }}>
        {items.length === 0
          ? <EmptyBlock title="Nothing here yet" text="This is only what colleagues have said to you. Approvals stay in their own queue." />
          : items.map(w => <WallCard key={w.id} w={w} onThank={() => void thank(w.thankId)} onRead={() => void markRead(w.id)} />)}
      </View>
    </View>
  )
}
