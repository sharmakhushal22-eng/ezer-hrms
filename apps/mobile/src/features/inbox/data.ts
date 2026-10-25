// src/features/inbox/data.ts — the Messages group's data layer.
//
// The phone's components/ess/inbox/useInboxData.ts, call for call:
//   GET  /api/ess/inbox?employee_id=                    the list (polled every 20 s)
//   GET  /api/ess/inbox/messages?id=&employee_id=       open a thread (marks it read; polled every 20 s while open)
//   POST /api/ess/inbox/messages   { id, body, employee_id }            send
//   GET  /api/ess/inbox/directory?q=&employee_id=       the compose picker
//   POST /api/ess/inbox            { action:'start', to:[id] } | { action:'desk', desk_code }
// No Supabase here: the inbox tables are read only through the API (lib/inbox/server.ts).
//
// Polling: the website polls with setInterval while the Inbox is mounted. Here
// it is TanStack's refetchInterval, switched on only while the screen that
// reads the query is focused; core/query.ts pauses it while the app is in the
// background and refetches on return.
import { router, useIsFocused } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { queryClient } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import {
  toConversation, toDirectory, toFolders, toMessage, toNote,
  type ConversationKind, type ConversationVM, type DirectoryVM, type FolderVM, type MessageVM, type NoteVM,
} from './model'

export const POLL_MS = 20_000
type Json = Record<string, any>

export interface InboxList {
  status: 'ready' | 'absent'
  reason?: string
  folders: FolderVM[]
  conversations: ConversationVM[]
  /** inbox_unread_count — the Messages badge, the All row, and the bell's inbox half. */
  unread: number
}

export const listKey = (emp: string) => ['inbox', 'list', emp] as const
export const threadKey = (id: string, emp: string) => ['inbox', 'thread', id, emp] as const

async function loadList(emp: string): Promise<InboxList> {
  const json = await api<Json>('/api/ess/inbox', { employeeId: emp })
  // The bell (features/shell/notifications.tsx) reads the same endpoint under
  // 'inbox-unread'. Hand it this answer so it does not wait for its own fetch.
  queryClient.setQueryData(['inbox-unread', emp], { installed: json.installed !== false, unread: Number(json.unread) || 0 })
  if (json.installed === false) return { status: 'absent', reason: String(json.reason ?? ''), folders: [], conversations: [], unread: 0 }
  return {
    status: 'ready',
    folders: toFolders(json.folders),
    conversations: ((json.conversations as Json[]) ?? []).map(toConversation),
    unread: Number(json.unread) || 0,
  }
}

/** The list. Polled every 20 s while the calling screen is focused. A failed
 *  poll keeps the last good list (TanStack keeps `data` on a refetch error). */
export function useInboxList() {
  const emp = useEmployeeId()
  const focused = useIsFocused()
  return useQuery({
    queryKey: listKey(emp),
    queryFn: () => loadList(emp),
    enabled: !!emp,
    refetchInterval: focused ? POLL_MS : false,
    staleTime: 10_000,
  })
}

export interface ThreadData {
  kind: ConversationKind
  messages: MessageVM[]
  notes: NoteVM[]
  /** The raw inbox_conversations row, used only when the list has not caught up with a just-started thread. */
  conversation: Json | null
  unread: number | null
  count: number
}

async function loadThread(id: string, emp: string): Promise<ThreadData> {
  const json = await api<Json>('/api/ess/inbox/messages', { query: { id }, employeeId: emp })
  const raw = (json.messages as Json[]) ?? []
  const fromList = queryClient.getQueryData<InboxList>(listKey(emp))?.conversations.find(c => c.id === id)?.kind
  const kind = (fromList ?? (String(json.conversation?.kind || 'DIRECT').toUpperCase() as ConversationKind))
  const unread = typeof json.unread === 'number' ? json.unread : null
  // Reading cleared the row server-side. Mirror it in the list now (the
  // website zeroes the row locally and forwards the server's new total).
  queryClient.setQueryData<InboxList>(listKey(emp), l => l && ({
    ...l,
    unread: unread ?? l.unread,
    conversations: l.conversations.map(c => (c.id === id ? { ...c, unread: 0 } : c)),
  }))
  return {
    kind,
    messages: kind === 'SYSTEM' ? [] : raw.map(toMessage),
    notes: kind === 'SYSTEM' ? raw.map(toNote) : [],
    conversation: (json.conversation as Json) ?? null,
    unread,
    count: raw.length,
  }
}

export function useThread(id: string) {
  const emp = useEmployeeId()
  const focused = useIsFocused()
  return useQuery({
    queryKey: threadKey(id, emp),
    queryFn: () => loadThread(id, emp),
    enabled: !!emp && !!id,
    refetchInterval: focused ? POLL_MS : false,
    staleTime: 0,
    gcTime: 60_000,
  })
}

export function sendMessage(emp: string, id: string, body: string) {
  return api<{ id: string; created_at: string }>('/api/ess/inbox/messages', { method: 'POST', body: { id, body, employee_id: emp } })
}

export async function fetchDirectory(emp: string, q: string): Promise<DirectoryVM> {
  // q is always sent, even empty, as the website does (`?q=`).
  const json = await api<Json>(`/api/ess/inbox/directory?q=${encodeURIComponent(q)}`, { employeeId: emp })
  return toDirectory(json)
}

export async function startConversation(emp: string, target: { person: string } | { desk: string }): Promise<string> {
  const payload = 'person' in target ? { action: 'start', to: [target.person] } : { action: 'desk', desk_code: target.desk }
  const json = await api<Json>('/api/ess/inbox', { method: 'POST', body: { ...payload, employee_id: emp } })
  // Not awaited, as on the website: the new thread opens at once and the list catches up.
  void queryClient.refetchQueries({ queryKey: listKey(emp) })
  return String(json.id ?? '')
}

/**
 * Open a thread: remember its unread count (the red "New" divider goes there),
 * zero the row locally, and push the thread screen. The GET it makes marks the
 * thread read on the server.
 */
export function openThread(emp: string, id: string, how: 'push' | 'replace' = 'push') {
  const row = queryClient.getQueryData<InboxList>(listKey(emp))?.conversations.find(c => c.id === id)
  const unreadAtOpen = row?.unread ?? 0
  queryClient.setQueryData<InboxList>(listKey(emp), l => l && ({ ...l, conversations: l.conversations.map(c => (c.id === id ? { ...c, unread: 0 } : c)) }))
  const target = { pathname: '/inbox/[id]' as const, params: { id, u: String(unreadAtOpen) } }
  if (how === 'replace') router.replace(target)
  else router.push(target)
}
