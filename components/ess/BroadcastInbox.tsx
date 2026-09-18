'use client'
// components/ess/BroadcastInbox.tsx — the channel, wired to the database.
//
// Reads ess_announcements where is_broadcast, plus this employee's read
// marks. Writes a private response and nothing else — there is no public
// reply path to write to.
//
// 088 has not been applied yet, so every read here can legitimately come back
// PGRST205. That is a state to render rather than an error to swallow.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// The render layer is BroadcastView (components/ess/inbox). Everything below
// — the direct read, the read marks, the private response — is unchanged:
// this file was re-skinned, not rewritten.
import { BroadcastView } from '@/components/ess/inbox/BroadcastView'
import type { BroadcastVM } from '@/components/ess/inbox/types'
import {
  ordered, unreadCount, canRespond, PRIORITY_LABEL,
  type Broadcast, type Priority,
} from '@/lib/broadcast/channel'

const MISSING_TABLE = 'PGRST205'
const MISSING_COLUMN = '42703'

export default function BroadcastInbox({ employeeId, onUnread }: {
  employeeId: string
  onUnread?: (n: number) => void
}) {
  const [items, setItems] = useState<Broadcast[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const a = await supabase.from('ess_announcements')
      .select('id,title,body,priority,published_by,published_at,is_pinned,is_active,is_broadcast,source_department_id')
      .eq('is_broadcast', true).eq('is_active', true)
      .order('published_at', { ascending: false }).limit(100)

    if (a.error) {
      const code = (a.error as { code?: string }).code
      // Either the table is absent or 088's columns are. Both mean the same
      // thing to the reader: the channel is not switched on yet.
      setReady(!(code === MISSING_TABLE || code === MISSING_COLUMN))
      setLoading(false); return
    }
    setReady(true)

    const rows = (a.data ?? []) as Record<string, unknown>[]
    const byId = new Map<string, string>()
    const publisherIds = [...new Set(rows.map(r => String(r.published_by ?? '')).filter(Boolean))]
    if (publisherIds.length) {
      const e = await supabase.from('employees').select('id,full_name').in('id', publisherIds)
      for (const r of (e.data ?? []) as { id: string; full_name: string }[]) {
        byId.set(r.id, r.full_name)
      }
    }

    setItems(rows.map(r => ({
      id: String(r.id), title: String(r.title ?? ''), body: String(r.body ?? ''),
      priority: (String(r.priority ?? 'NORMAL')) as Priority,
      publishedBy: String(r.published_by ?? ''),
      publisherName: byId.get(String(r.published_by ?? '')) ?? null,
      sourceDepartment: null,
      publishedAt: String(r.published_at ?? ''),
      isPinned: !!r.is_pinned, isActive: r.is_active !== false,
    })))

    const marks = await supabase.from('ess_broadcast_reads')
      .select('announcement_id').eq('employee_id', employeeId)
    if (!marks.error) {
      setReadIds(new Set((marks.data ?? []).map(m => String(m.announcement_id))))
    }
    setLoading(false)
  }, [employeeId])

  useEffect(() => { load() }, [load])
  useEffect(() => { onUnread?.(unreadCount(items, readIds)) }, [items, readIds, onUnread])

  const markRead = async (id: string) => {
    if (readIds.has(id)) return
    setReadIds(prev => new Set(prev).add(id))       // optimistic; a read mark is cheap
    await supabase.from('ess_broadcast_reads')
      .upsert({ announcement_id: id, employee_id: employeeId },
              { onConflict: 'announcement_id,employee_id' })
  }

  const respond = async (id: string, body: string) => {
    setBusy(id); setNote(null)
    // recipient_id and company_id are set by the trigger, not sent from here:
    // a client that could choose the recipient could route somebody's private
    // note to the wrong person.
    const { error } = await supabase.from('ess_broadcast_responses')
      .insert({ announcement_id: id, author_id: employeeId, body })
    setBusy(null)
    setNote(error ? `That did not send — ${error.message}` : 'Sent. Only they can see it.')
  }

  return (
    <BroadcastView
      status={loading ? 'loading' : ready === false ? 'absent' : 'ready'}
      reason="088_broadcast_channel.sql"
      items={ordered(items).map(b => toVM(b, employeeId, readIds))}
      onRead={markRead}
      onReplyPrivately={respond}
      busyId={busy}
      notice={note ?? undefined}
    />
  )
}

/**
 * One notice, in the shape the view renders. canRespond() is asked here rather
 * than in the view, because it is the rule — a withdrawn notice and one you
 * published yourself are both "no", and each says why.
 */
function toVM(b: Broadcast, employeeId: string, readIds: Set<string>): BroadcastVM {
  const verdict = canRespond(employeeId, b)
  return {
    id: b.id,
    title: b.title,
    body: b.body,
    publisher: b.publisherName ?? 'Your company',
    publishedAt: b.publishedAt,
    pinned: b.isPinned,
    unread: !readIds.has(b.id),
    priority: b.priority,
    priorityLabel: PRIORITY_LABEL[b.priority],
    canRespond: verdict.allowed,
    cannotRespondBecause: verdict.allowed ? undefined : verdict.because,
  }
}


