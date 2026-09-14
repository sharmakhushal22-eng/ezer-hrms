'use client'
/**
 * useInboxData — the data layer of the Messages group.
 *
 * It reproduces what components/ess/Inbox.tsx does today, call for call, so the
 * redesign is a render-layer swap and nothing changes on the wire:
 *
 *   GET  /api/ess/inbox?employee_id=          -> { installed, folders, conversations, unread, desks, policy }
 *   GET  /api/ess/inbox/messages?id=&employee_id=  -> { installed, conversation, as_agent, messages, unread }
 *   POST /api/ess/inbox/messages              -> send  { id, body, employee_id }
 *   GET  /api/ess/inbox/directory?q=&employee_id=  -> { people, desks, unstaffed_desks }
 *   POST /api/ess/inbox                       -> { action:'start', to:[id] } | { action:'desk', desk_code }
 *
 * Three things reconciled against the real code rather than assumed:
 *
 *  1. authHeaders() is ASYNC. It checks the ESS session AND the Supabase one,
 *     and refreshes an expiring token rather than sending it. Calling it
 *     without await sends `[object Promise]` as the header and every request
 *     comes back 401 from somebody who is, in fact, signed in.
 *  2. "Not switched on yet" arrives as `installed: false` + `reason` in a 200
 *     body — the API turns PGRST205 / 42703 into that on the server. The
 *     browser never sees a Postgres code, because it never reads the tables.
 *  3. Opening a thread marks it read server-side (GET /messages updates
 *     last_read_at and clears the matching bell notifications), so the list is
 *     reloaded afterwards to keep the counts true. Same as today.
 *
 * Polled, not pushed: every 20 s, list plus the open thread. No realtime.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { toConversation, toDirectory, toFolders, toMessage, toNote } from './adapter'
import type {
  ConversationVM, DirectoryVM, InboxState, MessageVM, NoteVM,
} from './types'

const POLL_MS = 20_000

type Json = Record<string, unknown>

export interface ThreadData {
  id: string
  messages: MessageVM[]   // DIRECT / DESK
  notes: NoteVM[]         // SYSTEM
  unreadAtOpen: number    // where the red "New" divider goes
}

/** What POST /api/ess/inbox needs to open a conversation, by kind of target. */
type StartTarget = { person: string } | { desk: string }

export function useInboxData(employeeId: string) {
  const [state, setState] = useState<InboxState>({
    status: 'loading', folders: [], conversations: [], unread: 0,
  })
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [lastPolled, setLastPolled] = useState<number>(Date.now())
  const openIdRef = useRef<string | null>(null)
  const kindRef = useRef<Record<string, ConversationVM['kind']>>({})
  const unreadRef = useRef<(n: number) => void>(() => {})

  const call = useCallback(async (url: string, init?: RequestInit): Promise<Json> => {
    const res = await fetch(url, { ...init, headers: await authHeaders(), cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as Json
    if (!res.ok) throw new Error(String(json.error ?? json.message ?? `HTTP ${res.status}`))
    return json
  }, [])

  /* ---------------------------------------------------------------- list */

  const loadList = useCallback(async () => {
    try {
      const json = await call(`/api/ess/inbox?employee_id=${encodeURIComponent(employeeId)}`)

      // Absent is a state to render, not an error to swallow (rule 8). The bell
      // keeps working off ess_notifications while the tables are missing.
      if (json.installed === false) {
        setState(s => ({ ...s, status: 'absent', reason: String(json.reason ?? '') }))
        return
      }

      const conversations = ((json.conversations as Json[]) ?? []).map(toConversation)
      kindRef.current = Object.fromEntries(conversations.map(c => [c.id, c.kind]))

      setState({
        status: 'ready',
        folders: toFolders(json.folders),
        conversations,
        // The server's total is authoritative; it is the one number that
        // reaches the portal bell, and it is never added to Wall or Broadcast.
        unread: Number(json.unread) || 0,
      })
      setLastPolled(Date.now())
    } catch (e) {
      const msg = (e as Error).message || 'Could not open the inbox.'
      // A poll that fails after the screen is up must not blank it. Keep the
      // last good list; the next poll recovers.
      setState(s => (s.status === 'ready' ? s : { ...s, status: 'error', reason: msg }))
    }
  }, [call, employeeId])

  /* -------------------------------------------------------------- thread */

  const loadThread = useCallback(async (id: string) => {
    const json = await call(
      `/api/ess/inbox/messages?id=${encodeURIComponent(id)}&employee_id=${encodeURIComponent(employeeId)}`,
    )
    const raw = (json.messages as Json[]) ?? []
    const kind = kindRef.current[id] ?? 'DIRECT'

    // Reading the thread cleared the bell for those notifications server-side.
    // Report the server's new total up, exactly as Inbox.tsx does on open.
    if (typeof json.unread === 'number') unreadRef.current(json.unread)

    setThread(prev => ({
      id,
      messages: kind === 'SYSTEM' ? [] : raw.map(toMessage),
      notes: kind === 'SYSTEM' ? raw.map(toNote) : [],
      unreadAtOpen: prev?.id === id ? prev.unreadAtOpen : 0,
    }))
  }, [call, employeeId])

  const open = useCallback(async (id: string) => {
    openIdRef.current = id
    // Remembered BEFORE the fetch: the GET marks it read, so afterwards the
    // count is zero and the "New" divider would have nowhere to sit.
    const unreadAtOpen = state.conversations.find(c => c.id === id)?.unread ?? 0
    setThread({ id, messages: [], notes: [], unreadAtOpen })

    // The row stops looking unread the moment it is opened, as it does today.
    setState(s => ({ ...s, conversations: s.conversations.map(c => (c.id === id ? { ...c, unread: 0 } : c)) }))

    await loadThread(id)
    setThread(t => (t && t.id === id ? { ...t, unreadAtOpen } : t))
    void loadList()
  }, [loadThread, loadList, state.conversations])

  const close = useCallback(() => { openIdRef.current = null; setThread(null) }, [])

  /* ---------------------------------------------------------------- send */

  const send = useCallback(async (id: string, body: string) => {
    // Optimistic bubble; the reload after the POST replaces it with the
    // server's row, so nothing here has to guess an id or a timestamp.
    const tempId = `tmp-${Date.now()}`
    setThread(t => (t && t.id === id ? {
      ...t,
      messages: [...t.messages, {
        id: tempId, mine: true, body, sentAt: new Date().toISOString(), deleted: false, pending: true,
      }],
    } : t))
    try {
      await call('/api/ess/inbox/messages', {
        method: 'POST',
        body: JSON.stringify({ id, body, employee_id: employeeId }),
      })
      await loadThread(id)   // re-open the thread …
      await loadList()       // … and reload the list, so previews and counts stay true
    } catch (e) {
      setThread(t => (t && t.id === id ? { ...t, messages: t.messages.filter(m => m.id !== tempId) } : t))
      throw e
    }
  }, [call, employeeId, loadThread, loadList])

  /* ----------------------------------------------------------- directory */

  const directory = useCallback(async (q: string): Promise<DirectoryVM> => {
    const json = await call(
      `/api/ess/inbox/directory?q=${encodeURIComponent(q)}&employee_id=${encodeURIComponent(employeeId)}`,
    )
    return toDirectory(json)
  }, [call, employeeId])

  /**
   * Start a conversation. A person and a desk are two different actions on the
   * server — `start` inserts a DIRECT thread with participants, `desk` inserts
   * a DESK thread that follows whoever staffs the desk rather than whoever
   * staffed it. Sending a desk code as `to` would be refused by the reach check.
   */
  const start = useCallback(async (target: StartTarget): Promise<string> => {
    const payload = 'person' in target
      ? { action: 'start', to: [target.person] }
      : { action: 'desk', desk_code: target.desk }
    const json = await call('/api/ess/inbox', {
      method: 'POST',
      body: JSON.stringify({ ...payload, employee_id: employeeId }),
    })
    await loadList()
    return String(json.id ?? '')
  }, [call, employeeId, loadList])

  /* ------------------------------------------------------------- polling */

  useEffect(() => {
    void loadList()
    const t = setInterval(() => {
      void loadList()
      if (openIdRef.current) void loadThread(openIdRef.current).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(t)
  }, [loadList, loadThread])

  /** Lets the caller receive the count the thread endpoint reports on open. */
  const onUnreadFromThread = useCallback((fn: (n: number) => void) => { unreadRef.current = fn }, [])

  return { state, thread, lastPolled, open, close, send, directory, start, reload: loadList, onUnreadFromThread }
}
