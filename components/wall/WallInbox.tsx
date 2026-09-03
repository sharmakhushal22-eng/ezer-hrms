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
import { supabase } from '@/lib/supabase'
import {
  STREAMS, STREAM_OF, headlineFor, glyphFor, countFor, countsReconcile,
  type Stream, type WallEvent, type Counts,
} from '@/lib/wall/inbox'
import { C, F, W, S, R } from '@/lib/ui'

const MISSING = 'PGRST205'
const missing = (e: unknown) =>
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

function Tab({ s, on, n, onPick }: {
  s: (typeof STREAMS)[number]; on: boolean; n: number; onPick: () => void
}) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on} title={s.blurb}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
               fontFamily: 'inherit', padding: '7px 13px', borderRadius: R.sm,
               fontSize: F.small, fontWeight: on ? W.bold : W.semi,
               border: `1px solid ${on ? C.brand : C.line}`,
               background: on ? C.brand : C.surface,
               color: on ? '#FFFFFF' : C.inkSoft }}>
      {s.label}
      {n > 0 && (
        <span style={{ fontSize: F.micro, fontWeight: W.bold, padding: '1px 7px', borderRadius: 999,
                       background: on ? 'rgba(255,255,255,.24)' : C.brandTint,
                       color: on ? '#FFFFFF' : C.brand }}>{n}</span>
      )}
    </button>
  )
}

function Row({ r, onThank, onOpen }: {
  r: InboxRow; onThank: (id: string) => void; onOpen: (r: InboxRow) => void
}) {
  const ev = r.event_type as WallEvent
  const who = r.actor_name ?? 'A colleague'
  const when = r.created_at
    ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : ''
  return (
    <article onClick={() => onOpen(r)}
      style={{ display: 'flex', gap: S.md, padding: `${S.md}px`, cursor: 'pointer',
               borderRadius: R.sm, background: r.is_read ? C.surface : C.brandTint,
               border: `1px solid ${r.is_read ? C.line : C.brandEdge}` }}>
      <span aria-hidden style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                                 display: 'grid', placeItems: 'center', fontSize: 14,
                                 background: C.surface, border: `1px solid ${C.line}` }}>
        {glyphFor(ev)}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
            {headlineFor(ev, who)}
          </span>
          {when && <span style={{ fontSize: F.micro, color: C.faint }}>{when}</span>}
          {!r.is_read && (
            // Unread said in a word as well as a colour, so it survives a
            // reader who cannot distinguish the tint.
            <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brand }}>new</span>
          )}
        </div>
        {r.actor_designation && (
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 1 }}>{r.actor_designation}</div>
        )}
        {r.category_label && (
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>
            {r.category_glyph ? `${r.category_glyph} ` : ''}{r.category_label}
          </div>
        )}
        {(r.body || r.preview) && (
          // Quoted, so it reads as their words rather than the system's.
          <blockquote style={{ margin: '7px 0 0', paddingLeft: S.sm,
                               borderLeft: `2px solid ${C.line}`, fontSize: F.small,
                               color: C.inkSoft, lineHeight: 1.6 }}>
            {r.body || r.preview}
          </blockquote>
        )}
        {r.can_thank && (
          <button type="button"
            onClick={e => { e.stopPropagation(); onThank(r.message_id ?? r.id) }}
            style={{ marginTop: 9, fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.bold,
                     padding: '6px 13px', borderRadius: R.sm, cursor: 'pointer',
                     border: `1px solid ${C.brand}`, background: C.surface, color: C.brand }}>
            Say thank you
          </button>
        )}
      </div>
    </article>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>{children}</div>
}

// ── the inbox ────────────────────────────────────────────────────────────

export default function WallInbox({ onUnread }: { onUnread?: (n: number) => void }) {
  const [stream, setStream] = useState<Stream>('all')
  const [rows, setRows] = useState<InboxRow[]>([])
  const [counts, setCounts] = useState<Counts>({})
  const [ready, setReady] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const c = await supabase.rpc('get_inbox_counts')
    if (c.error) {
      if (missing(c.error)) { setReady(false); return }
      setErr(c.error.message); setReady(false); return
    }
    setReady(true)
    const got = (c.data ?? {}) as Counts
    setCounts(got)
    // Reported to the host SEPARATELY. Never added to the approvals count.
    onUnread?.(got.total_unread ?? 0)

    const r = await supabase.rpc('get_wall_inbox', { p_filter: stream, p_limit: 30 })
    if (!r.error) setRows((r.data ?? []) as unknown as InboxRow[])
  }, [stream, onUnread])

  useEffect(() => { load() }, [load])

  async function open(r: InboxRow) {
    if (r.is_read) return
    setRows(cur => cur.map(x => x.id === r.id ? { ...x, is_read: true } : x))
    const res = await supabase.rpc('mark_inbox_read', { p_ids: [r.id] })
    if (res.error) load(); else load()
  }

  async function thank(messageId: string) {
    const r = await supabase.rpc('thank_for_appreciation', { p_message: messageId })
    if (r.error) { setErr(r.error.message); return }
    load()
  }

  if (ready === null) return <Note>Loading…</Note>

  if (ready === false) {
    return (
      <Note>
        {err ?? 'The Wall of Fame is not switched on for this company yet. Once it is, notes, '
              + 'comments and replies from colleagues will appear here — separately from your approvals.'}
      </Note>
    )
  }

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STREAMS.map(s => (
          <Tab key={s.k} s={s} on={stream === s.k} n={countFor(s.k, counts)}
               onPick={() => setStream(s.k)} />
        ))}
      </div>
      <div style={{ fontSize: F.micro, color: C.faint }}>
        {STREAMS.find(s => s.k === stream)?.blurb}
      </div>

      {/* A badge nobody can clear by opening anything is worse than a wrong
          number — it is a number with no explanation. Say so. */}
      {!countsReconcile(counts) && (
        <div style={{ fontSize: F.micro, color: C.warning, fontWeight: W.semi }}>
          The unread totals do not add up. Some events are not in any stream — worth telling HR.
        </div>
      )}

      {rows.length === 0 ? (
        <Note>
          Nothing here. This is only what colleagues have said to you — approvals stay in their
          own queue.
        </Note>
      ) : (
        <div style={{ display: 'grid', gap: S.sm }}>
          {rows.map(r => <Row key={r.id} r={r} onThank={thank} onOpen={open} />)}
        </div>
      )}

      {err && (
        <div role="alert" style={{ fontSize: F.micro, color: C.critical, fontWeight: W.semi }}>{err}</div>
      )}
    </div>
  )
}
