'use client'
// components/wall/WallInbox.tsx — the Wall of Fame streams in the Inbox.
//
// A SECOND LIST BESIDE THE APPROVALS QUEUE, NEVER MERGED WITH IT.
//
// Three streams: appreciation, comments, replies. No approvals — nomination
// endorsements and publish approvals are workflow and route to the existing
// queue exactly as leave and offers do. No system chatter either: badge
// unlocks, milestones and reaction counts belong on the wall, not here.
//
// This inbox is limited to things a colleague actually said, because workflow
// noise is what kills a recognition inbox. The moment a pending approval sits
// beside a thank-you note, people triage the tab instead of reading it and
// the appreciation goes unread.
//
// The unread counts are shown SEPARATELY and never summed with the approvals
// count. A pending leave request and a colleague's thank-you are not the same
// kind of unread, and one number for both teaches people to ignore it.
//
// Sub-components at module scope. See the note in ShoutoutComposer.

import { useCallback, useEffect, useState } from 'react'
import { wallRpc } from '@/lib/wall/rpc'
import {
  STREAM_OF, headlineFor, countsReconcile,
  type Stream, type WallEvent, type Counts,
} from '@/lib/wall/inbox'
// The render layer is WallInboxView (components/ess/inbox). Everything below
// — the RPCs, the counts, the read marks, the thank-back — is unchanged: this
// file was re-skinned, not rewritten.
import { WallInboxView } from '@/components/ess/inbox/WallInboxView'
import type { WallItemVM } from '@/components/ess/inbox/types'

const MISSING = 'PGRST205'
const missing = (e: unknown) =>
  // The wall route reports a missing migration explicitly. Checked first
  // because its message is written for a person and matches no error code.
  (e as { installed?: boolean } | null)?.installed === false ||
  (e as { code?: string } | null)?.code === MISSING ||
  /PGRST205|does not exist|could not find/i.test(String((e as { message?: string } | null)?.message ?? ''))

export interface InboxRow {
  id: string
  event_type: string
  is_read: boolean
  created_at: string | null
  actor_name: string | null
  actor_designation: string | null
  preview: string | null
  body: string | null
  category_label: string | null
  category_glyph: string | null
  recognition_id: string | null
  comment_id: string | null
  message_id: string | null
  can_thank: boolean | null
}

// ── module scope ─────────────────────────────────────────────────────────




// ── the inbox ────────────────────────────────────────────────────────────

export default function WallInbox({ employeeId, onUnread }: {
  employeeId: string
  onUnread?: (n: number) => void
}) {
  const [stream, setStream] = useState<Stream>('all')
  const [rows, setRows] = useState<InboxRow[]>([])
  const [counts, setCounts] = useState<Counts>({})
  const [ready, setReady] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const c = await wallRpc('get_inbox_counts', {}, employeeId)
    if (c.error) {
      if (missing(c.error)) { setReady(false); return }
      setErr(c.error.message); setReady(false); return
    }
    setReady(true)
    const got = (c.data ?? {}) as Counts
    setCounts(got)
    // Reported to the host SEPARATELY. Never added to the approvals count.
    onUnread?.(got.total_unread ?? 0)

    const r = await wallRpc('get_wall_inbox', { p_filter: stream, p_limit: 30 }, employeeId)
    if (!r.error) setRows((r.data ?? []) as unknown as InboxRow[])
  }, [stream, onUnread, employeeId])

  useEffect(() => { load() }, [load])

  async function open(r: InboxRow) {
    if (r.is_read) return
    setRows(cur => cur.map(x => x.id === r.id ? { ...x, is_read: true } : x))
    const res = await wallRpc('mark_inbox_read', { p_ids: [r.id] }, employeeId)
    if (res.error) load(); else load()
  }

  async function thank(messageId: string) {
    const r = await wallRpc('thank_for_appreciation', { p_message: messageId }, employeeId)
    if (r.error) { setErr(r.error.message); return }
    load()
  }

  // The wall not being switched on is a state to render, not an error to
  // swallow — the same rule the rest of the inbox follows.
  if (ready === false) {
    return (
      <div className="absent">
        <div className="glyph" aria-hidden>★</div>
        <h3>Not switched on yet</h3>
        <p>
          {err ?? 'The Wall of Fame is not switched on for this company yet. Once it is, notes, '
                + 'comments and replies from colleagues will appear here — separately from your approvals.'}
        </p>
      </div>
    )
  }

  return (
    <WallInboxView
      items={rows.map(toItem)}
      stream={stream}
      onStream={setStream}
      loading={ready === null}
      // A badge nobody can clear by opening anything is worse than a wrong
      // number — it is a number with no explanation. Say so.
      notice={countsReconcile(counts) ? undefined
        : 'The unread totals do not add up. Some events are not in any stream — worth telling HR.'}
      error={err ?? undefined}
      onThankBack={w => thank(w.thankId)}
      onMarkRead={w => { const r = rows.find(x => x.id === w.id); if (r) open(r) }}
    />
  )
}

/**
 * One row, in the shape the view renders. Every value here already existed on
 * InboxRow or comes from lib/wall/inbox.ts — nothing is fetched for the redesign
 * and nothing is dropped: the headline, the designation, the category label and
 * the quoted text are all still on screen, in the card instead of the list row.
 */
function toItem(r: InboxRow): WallItemVM {
  const ev = r.event_type as WallEvent
  const who = r.actor_name ?? 'A colleague'
  return {
    id: r.id,
    type: STREAM_OF[ev] ?? 'appreciation',
    actorName: who,
    actorDesignation: r.actor_designation ?? '',
    headline: headlineFor(ev, who),
    // The glyph rides with the label, as it does today.
    badge: r.category_label
      ? `${r.category_glyph ? `${r.category_glyph} ` : ''}${r.category_label}`
      : undefined,
    text: r.body ?? r.preview ?? '',
    sentAt: r.created_at ?? '',
    unread: !r.is_read,
    canThankBack: !!r.can_thank,
    // thank_for_appreciation takes the message; the row id is the fallback the
    // old button already used.
    thankId: r.message_id ?? r.id,
  }
}
