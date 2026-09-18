'use client'
/**
 * BroadcastView — the render layer for the Broadcasts group.
 *
 * components/ess/BroadcastInbox.tsx keeps its direct Supabase read, its read
 * marks and its PGRST205 / 42703 handling. It passes `status` + `items` here.
 *
 * Rule 8: absent ≠ broken. A missing table renders "Not switched on yet" with
 * the reason, never an error toast.
 *
 * Rule 6: read-only in public. There is no public reply path in this file. The
 * private response is the one write, and it opens inline under the card it
 * answers — the design's "Reply privately" button needs somewhere to type, and
 * a button that only says it would reply is worse than no button.
 */
import { useState } from 'react'
import { Ic } from './icons'
import { relTime } from './time'
import type { BroadcastVM, InboxStatus } from './types'

interface Props {
  status: InboxStatus
  reason?: string
  items: BroadcastVM[]
  /** Set per card: some notices cannot be answered (withdrawn, or your own). */
  onReplyPrivately?: (id: string, body: string) => Promise<void> | void
  onRead?: (id: string) => void
  /** Id currently in flight, so its button can say so. */
  busyId?: string | null
  notice?: string
}

export function BroadcastView({ status, reason, items, onReplyPrivately, onRead, busyId, notice }: Props) {
  if (status === 'loading') {
    return <div className="pane"><div className="booting"><span className="ring" />Opening broadcasts…</div></div>
  }

  if (status === 'absent') {
    return (
      <div className="pane">
        <div className="absent">
          <div className="glyph">{Ic.megaphoneOff()}</div>
          <h3>Not switched on yet</h3>
          <p>
            The broadcast channel is waiting on{' '}
            <code>{reason || '088_broadcast_channel.sql'}</code>, which adds the channel to the
            announcements table. It is handed to Nayan rather than run from here — this project
            does not apply schema changes itself.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="pane">
        <div className="absent">
          <div className="glyph">{Ic.bellOff()}</div>
          <h3>Could not load broadcasts</h3>
          <p>{reason ?? 'The server did not respond.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pane">
      <div className="top">
        <h2>Broadcasts</h2>
        <span className="why">Company-wide notices. Read only — nobody replies in public.</span>
      </div>
      {notice && <div className="wnotice" role="status">{notice}</div>}
      <div className="bclist">
        {items.length === 0 && (
          <div className="empty"><h4>No notices yet</h4><p>Company-wide announcements will appear here.</p></div>
        )}
        {items.map((b, i) => (
          <Card key={b.id} b={b} index={i} busy={busyId === b.id} onRead={onRead} onReply={onReplyPrivately} />
        ))}
      </div>
    </div>
  )
}

function Card({ b, index, busy, onRead, onReply }: {
  b: BroadcastVM; index: number; busy: boolean
  onRead?: (id: string) => void
  onReply?: (id: string, body: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState<string | null>(null)

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    await onReply?.(b.id, body)
    setText(''); setOpen(false); setSent('Sent. Only they can see it.')
  }

  return (
    <article
      className={`bcard${b.pinned ? ' pin' : ''}${b.unread ? ' unread' : ''}`}
      style={{ animationDelay: `${index * 40}ms` }}
      // Reading a notice is opening it, as it is today.
      onMouseEnter={() => b.unread && onRead?.(b.id)}
      onFocus={() => b.unread && onRead?.(b.id)}
    >
      <div className="meta">
        {b.pinned && <><span className="pinlbl">Pinned</span>·</>}
        {b.priority && b.priority !== 'NORMAL' && <><span className={`pri ${b.priority.toLowerCase()}`}>{b.priorityLabel}</span>·</>}
        <span>{b.publisher}</span>·<span>{relTime(b.publishedAt)}</span>
      </div>
      <h4>{b.title}</h4>
      <p>{b.body}</p>

      <div className="foot">
        <span className="ro">{Ic.lock({ style: { width: 12, height: 12 } })}No public replies</span>
        {b.canRespond
          ? <button type="button" onClick={() => setOpen(v => !v)}>{open ? 'Cancel' : 'Reply privately'}</button>
          : b.cannotRespondBecause
            ? <span className="ro why">{b.cannotRespondBecause}</span>
            : null}
      </div>

      {open && (
        <div className="bcreply">
          <textarea
            rows={3} autoFocus value={text} placeholder="Only the publisher will see this…"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          />
          <div className="hint">
            <span><kbd>Enter</kbd> to send · goes to {b.publisher} alone</span>
            <button className="send" type="button" disabled={!text.trim() || busy} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {sent && <div className="bcsent" role="status">{sent}</div>}
    </article>
  )
}
