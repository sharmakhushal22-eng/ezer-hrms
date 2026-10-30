// src/features/shell/notifications.tsx — the bell: its count and its panel.
//
// Same sources as the website's NotificationBell (EmployeePortal.tsx):
//   badge = /api/ess/notifications .unread + /api/ess/inbox .unread (when installed)
//   panel = "For you to action" (role) then "About you" (personal)
//   tap an unread row → { action: 'read', id }; "Mark all read" → { action: 'read_all' }
// One addition on the phone: a row with a `link` also opens the screen it names.
// The website ignores the link; on a phone a notification you cannot follow is a
// dead end, and the link is the website's own (resolved by core/links.ts).
//
// Interviews to conduct (179bb35): the website's panel opens with InterviewInvites
// — acknowledge / give feedback right here — and an invite's link
// ('/ess?notifications=1') opens the bell. The app has ONE sheet (BellHost, mounted
// by the root layout) driven by openBell(), so a link from anywhere can open it.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { isBellLink, openLink, setBellOpener } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Eyebrow, Loading, Txt, ErrorState } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { InterviewInvites } from './InterviewInvites'

// ── The one bell sheet, opened from any top bar or link ─────────────────────
let bellOpen = false
const listeners = new Set<() => void>()
const setBell = (v: boolean) => { if (bellOpen !== v) { bellOpen = v; listeners.forEach(l => l()) } }
export const openBell = () => setBell(true)
export const closeBell = () => setBell(false)
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useBellOpen = () => React.useSyncExternalStore(subscribe, () => bellOpen, () => bellOpen)

/** Mounted once, under the signed-in tree (src/app/_layout.tsx). */
export function BellHost() {
  const open = useBellOpen()
  React.useEffect(() => { setBellOpener(openBell); return () => { setBellOpener(null); closeBell() } }, [])
  return <NotificationsSheet visible={open} onClose={closeBell} />
}

export interface NotificationRow {
  id: string; category: string; title: string; body: string | null; link: string | null
  is_read: boolean; created_at: string; label: string; high: boolean; role_scoped: boolean
}
interface NotificationsResp { personal: NotificationRow[]; role: NotificationRow[]; unread: number; synced: number }

export function useNotifications(enabled = true) {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['notifications', employeeId],
    queryFn: () => api<NotificationsResp>('/api/ess/notifications', { employeeId }),
    enabled: !!employeeId && enabled,
  })
}

/** The bell's number: notifications + inbox messages, as the website adds them. */
export function useUnreadCount() {
  const employeeId = useEmployeeId()
  const n = useNotifications()
  const inbox = useQuery({
    queryKey: ['inbox-unread', employeeId],
    queryFn: () => api<{ installed?: boolean; unread?: number }>('/api/ess/inbox', { employeeId }).catch(() => ({ installed: false, unread: 0 })),
    enabled: !!employeeId,
  })
  return (n.data?.unread || 0) + (inbox.data?.installed ? inbox.data.unread || 0 : 0)
}

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
}

function Row({ n, onPress }: { n: NotificationRow; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      paddingVertical: S.md, paddingLeft: n.high ? S.md : 4, borderLeftWidth: n.high ? 3 : 0, borderLeftColor: C.critical,
      borderBottomWidth: 1, borderBottomColor: C.line, opacity: n.is_read ? 0.6 : 1, backgroundColor: pressed ? C.brandTint : 'transparent',
    })}>
      <Txt size={F.small} w={600}>{!n.is_read && <Txt size={F.small} w={600} tone="brand">● </Txt>}{n.title}</Txt>
      {!!n.body && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{n.body}</Txt>}
      <Txt size={10} tone="faint" style={{ marginTop: 4 }}>{n.label} · {when(n.created_at)}</Txt>
    </Pressable>
  )
}

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const employeeId = useEmployeeId()
  const q = useNotifications(visible)
  const act = useMutation({
    mutationFn: (body: { action: 'read' | 'read_all'; id?: string }) => api('/api/ess/notifications', { method: 'POST', body, employeeId }),
    onSuccess: () => invalidate('notifications'),
  })
  const open = (n: NotificationRow) => {
    if (!n.is_read) act.mutate({ action: 'read', id: n.id })
    // An interview invite's link names this panel: its card is already at the top.
    if (isBellLink(n.link)) return
    if (n.link && openLink(n.link)) onClose()
  }
  const d = q.data
  return (
    <Sheet visible={visible} onClose={onClose} title="Notifications">
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: S.sm }}>
        <Button title="Mark all read" variant="outline" size="sm" onPress={() => act.mutate({ action: 'read_all' })} disabled={!d?.unread} />
      </View>
      {/* Interviews this person is on: acknowledged, and the main interviewer's
          feedback given, right here (nothing when there is none). */}
      {visible && !!employeeId && <InterviewInvites employeeId={employeeId} />}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d || (!d.role.length && !d.personal.length) ? (
        <Txt size={F.tiny} tone="faint" center style={{ padding: S.xl }}>You&apos;re all caught up. 🎉</Txt>
      ) : (
        <>
          {!!d.role.length && <><Eyebrow style={{ marginTop: S.sm }}>For you to action</Eyebrow>{d.role.map(n => <Row key={n.id} n={n} onPress={() => open(n)} />)}</>}
          {!!d.personal.length && <><Eyebrow style={{ marginTop: S.lg }}>About you</Eyebrow>{d.personal.map(n => <Row key={n.id} n={n} onPress={() => open(n)} />)}</>}
        </>
      )}
    </Sheet>
  )
}
