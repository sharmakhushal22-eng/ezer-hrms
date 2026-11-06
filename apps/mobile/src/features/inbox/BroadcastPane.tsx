// src/features/inbox/BroadcastPane.tsx — Inbox → Broadcasts.
//
// components/ess/BroadcastInbox.tsx (data) + components/ess/inbox/BroadcastView.tsx
// (render). A company-wide, read-only channel: no public replies; a private
// response reaches only the publisher.
//
// DIRECT SUPABASE, VERBATIM FROM THE WEBSITE (spec 08 §3.1). Note for review:
// query 1 has NO company_id filter, so every company's broadcasts are visible to
// every employee — that is what the website does today and it is reproduced
// as-is for parity, not fixed here. recipient_id / company_id on a response are
// set by the trg_broadcast_response_recipient trigger, never by the client.
// Loaded when the tab is first opened; no polling.
import * as React from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'
import { useEmployeeId } from '@/core/session'
import { ordered, unreadCount, canRespond, PRIORITY_LABEL, type Broadcast, type Priority } from '@web/broadcast/channel'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, Txt, webNoOutline } from '@/ui/primitives'
import { relTime, type BroadcastVM } from './model'
import { alpha, GLock, GMegaphoneOff, MINE_GRAD } from './glyphs'
import { AbsentBlock, EmptyBlock } from './parts'

const MISSING_TABLE = 'PGRST205'
const MISSING_COLUMN = '42703'

interface BroadcastData { ready: boolean; items: Broadcast[]; readIds: string[] }

async function loadBroadcasts(employeeId: string): Promise<BroadcastData> {
  const a = await supabase.from('ess_announcements')
    .select('id,title,body,priority,published_by,published_at,is_pinned,is_active,is_broadcast,source_department_id')
    .eq('is_broadcast', true).eq('is_active', true)
    .order('published_at', { ascending: false }).limit(100)
  if (a.error) {
    const code = (a.error as { code?: string }).code
    // Absent table/column → "Not switched on yet". Any other error is treated as
    // ready with no notices — the website's behaviour, kept.
    return { ready: !(code === MISSING_TABLE || code === MISSING_COLUMN), items: [], readIds: [] }
  }
  const rows = (a.data ?? []) as Record<string, unknown>[]
  const byId = new Map<string, string>()
  const publisherIds = [...new Set(rows.map(r => String(r.published_by ?? '')).filter(Boolean))]
  if (publisherIds.length) {
    const e = await supabase.from('employees').select('id,full_name').in('id', publisherIds)
    for (const r of (e.data ?? []) as { id: string; full_name: string }[]) byId.set(r.id, r.full_name)
  }
  const items: Broadcast[] = rows.map(r => ({
    id: String(r.id), title: String(r.title ?? ''), body: String(r.body ?? ''),
    priority: String(r.priority ?? 'NORMAL') as Priority,
    publishedBy: String(r.published_by ?? ''),
    publisherName: byId.get(String(r.published_by ?? '')) ?? null,
    sourceDepartment: null,
    publishedAt: String(r.published_at ?? ''),
    isPinned: !!r.is_pinned, isActive: r.is_active !== false,
  }))
  const marks = await supabase.from('ess_broadcast_reads').select('announcement_id').eq('employee_id', employeeId)
  return { ready: true, items, readIds: marks.error ? [] : (marks.data ?? []).map(m => String(m.announcement_id)) }
}

function toVM(b: Broadcast, employeeId: string, readIds: Set<string>): BroadcastVM {
  const verdict = canRespond(employeeId, b)
  return {
    id: b.id, title: b.title, body: b.body,
    publisher: b.publisherName ?? 'Your company',
    publishedAt: b.publishedAt, pinned: b.isPinned, unread: !readIds.has(b.id),
    priority: b.priority, priorityLabel: PRIORITY_LABEL[b.priority],
    canRespond: verdict.allowed, cannotRespondBecause: verdict.allowed ? undefined : verdict.because,
  }
}

function Dot() { return <Txt size={11.5} tone="faint">·</Txt> }

function BroadcastCard({ b, busy, onRead, onReply }: {
  b: BroadcastVM; busy: boolean; onRead: (id: string) => void; onReply: (id: string, body: string) => Promise<boolean>
}) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [sent, setSent] = React.useState<string | null>(null)
  const read = () => { if (b.unread) onRead(b.id) }

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    const ok = await onReply(b.id, body)
    // Fixed on purpose: the website's card says "Sent" even when the insert
    // failed. Here the text and the box stay put on a failure; the top notice
    // carries the error either way.
    if (!ok) return
    setText(''); setOpen(false); setSent('Sent. Only they can see it.')
  }

  return (
    <Pressable onPress={read} accessibilityRole="button" accessibilityLabel={`${b.title}${b.unread ? ', unread' : ''}`}
      style={{ borderRadius: R.lg, borderWidth: 1, borderColor: b.unread ? C.brandEdge : C.line, backgroundColor: b.unread ? alpha(C.brand, 0.04) : C.surface, overflow: 'hidden' }}>
      {b.pinned && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: MINE_GRAD[0] }} />}
      <View style={{ paddingVertical: 16, paddingHorizontal: 18, backgroundColor: b.unread ? undefined : C.surface }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {b.pinned && <><Txt size={11.5} w={700} tone="brand">Pinned</Txt><Dot /></>}
          {b.priority && b.priority !== 'NORMAL' && <><Txt size={11.5} w={700} tone={b.priority === 'URGENT' ? 'critical' : 'warning'}>{b.priorityLabel}</Txt><Dot /></>}
          <Txt size={11.5} tone="faint">{b.publisher}</Txt><Dot />
          <Txt size={11.5} tone="faint">{relTime(b.publishedAt)}</Txt>
        </View>
        <Txt size={15} w={700} style={{ marginTop: 6, marginBottom: 4 }}>{b.title}</Txt>
        <Txt size={F.small} tone="soft">{b.body}</Txt>

        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: C.sunken }}>
            <GLock size={12} color={C.faint} />
            <Txt size={F.tiny} w={600} tone="faint">No public replies</Txt>
          </View>
          <View style={{ flex: 1 }} />
          {b.canRespond
            ? <Button title={open ? 'Cancel' : 'Reply privately'} variant="outline" size="sm" onPress={() => { read(); setOpen(v => !v) }} />
            : b.cannotRespondBecause ? <Txt size={F.tiny} w={500} tone="faint" style={{ textAlign: 'right' }}>{b.cannotRespondBecause}</Txt> : null}
        </View>

        {open && (
          <View style={{ marginTop: 12 }}>
            <TextInput value={text} onChangeText={setText} autoFocus multiline numberOfLines={3} placeholder="Only the publisher will see this…" placeholderTextColor={C.faint}
              style={[{ minHeight: 76, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.md, padding: S.md, fontFamily: FONT[400], fontSize: F.small + 0.5, color: C.ink, backgroundColor: C.surface, textAlignVertical: 'top' }, webNoOutline]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm }}>
              <Txt size={11} tone="faint" style={{ flex: 1 }}>Goes to {b.publisher} alone</Txt>
              <Button title={busy ? 'Sending…' : 'Send'} size="sm" disabled={!text.trim() || busy} onPress={() => void send()} />
            </View>
          </View>
        )}
        {!!sent && <Txt size={F.tiny} w={600} tone="positive" style={{ marginTop: 10 }}>{sent}</Txt>}
      </View>
    </Pressable>
  )
}

export function BroadcastPane({ onUnread }: { onUnread: (n: number) => void }) {
  const emp = useEmployeeId()
  const { C } = useTheme()
  const q = useQuery({ queryKey: ['inbox', 'broadcast', emp], queryFn: () => loadBroadcasts(emp), enabled: !!emp })
  const [localRead, setLocalRead] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const d = q.data
  const readIds = React.useMemo(() => new Set([...(d?.readIds ?? []), ...localRead]), [d?.readIds, localRead])
  React.useEffect(() => { if (d) onUnread(unreadCount(d.items, readIds)) }, [d, readIds, onUnread])

  const markRead = (id: string) => {
    if (readIds.has(id)) return
    setLocalRead(l => [...l, id]) // optimistic; the result is not checked, as on the web
    void supabase.from('ess_broadcast_reads').upsert({ announcement_id: id, employee_id: emp }, { onConflict: 'announcement_id,employee_id' }).then(() => {})
  }
  const respond = async (id: string, body: string) => {
    setBusy(id); setNote(null)
    const { error } = await supabase.from('ess_broadcast_responses').insert({ announcement_id: id, author_id: emp, body })
    setBusy(null)
    setNote(error ? `That did not send: ${error.message}` : 'Sent. Only they can see it.')
    return !error
  }

  if (q.isLoading || !d) {
    if (q.error) return <AbsentBlock glyph={<GMegaphoneOff size={28} color={C.warning} />} title="Could not load broadcasts">{(q.error as Error).message || 'The server did not respond.'}</AbsentBlock>
    return (
      <View style={{ padding: S.xxl, alignItems: 'center', gap: S.md }}>
        <ActivityIndicator color={C.brand} />
        <Txt size={F.small} tone="muted">Opening broadcasts…</Txt>
      </View>
    )
  }
  if (!d.ready) {
    return (
      <AbsentBlock glyph={<GMegaphoneOff size={28} color={C.warning} />} title="Not switched on yet">
        <Txt size={13.5} tone="muted" center>
          The broadcast channel is waiting on{' '}
          <Txt size={F.tiny} style={{ backgroundColor: C.sunken }}>088_broadcast_channel.sql</Txt>, which adds the channel to the announcements table. It is handed to Nayan rather than run from here. This project does not apply schema changes itself.
        </Txt>
      </AbsentBlock>
    )
  }
  const items = ordered(d.items).map(b => toVM(b, emp, readIds))
  return (
    <View>
      <Txt size={F.title} w={700}>Broadcasts</Txt>
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>Company-wide notices. Read only. Nobody replies in public.</Txt>
      {!!note && (
        <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
          <Txt size={F.tiny} tone="soft">{note}</Txt>
        </View>
      )}
      <View style={{ gap: 10, marginTop: S.md }}>
        {items.length === 0
          ? <EmptyBlock title="No notices yet" text="Company-wide announcements will appear here." />
          : items.map(b => <BroadcastCard key={b.id} b={b} busy={busy === b.id} onRead={markRead} onReply={respond} />)}
      </View>
    </View>
  )
}
