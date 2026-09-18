'use client'
/**
 * WallInboxView — the render layer for the Wall of Fame group.
 *
 * components/wall/WallInbox.tsx keeps ALL of its data logic: the wall RPCs,
 * the counts, the read marks, the thank-back. It maps its rows to WallItemVM[]
 * and hands them here.
 *
 * The streams are controlled from there rather than owned here, because the
 * list is filtered server-side (`get_wall_inbox` takes p_filter) — a second,
 * client-side filter over an already-filtered list would quietly hide rows.
 *
 * This view never merges workflow: nomination endorsements and publish
 * approvals stay in the approvals queue. That is the whole point of the group.
 */
import { Ic } from './icons'
import { initials, relTime } from './time'
import type { WallItemVM, WallStream } from './types'

interface Props {
  items: WallItemVM[]
  stream: WallStream
  onStream: (s: WallStream) => void
  loading?: boolean
  /** A count that cannot be accounted for is worth saying out loud, not hiding. */
  notice?: string
  error?: string
  onThankBack?: (item: WallItemVM) => Promise<void> | void
  onMarkRead?: (item: WallItemVM) => Promise<void> | void
}

const CHIPS: { k: WallStream; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'appreciation', label: 'Appreciation' },
  { k: 'comments', label: 'Comments' },
  { k: 'replies', label: 'Replies' },
]

const CATEGORY = { appreciation: 'Appreciation', comments: 'Comment', replies: 'Reply' } as const

export function WallInboxView({
  items, stream, onStream, loading, notice, error, onThankBack, onMarkRead,
}: Props) {
  return (
    <div className="pane">
      <div className="top">
        <h2>Wall of Fame</h2>
        <span className="why">Approvals and nominations stay in your approvals queue — only appreciation lives here.</span>
        <div className="chips" role="group" aria-label="Wall streams">
          {CHIPS.map(c => (
            <button key={c.k} className="chip" type="button" aria-pressed={stream === c.k} onClick={() => onStream(c.k)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <div className="wnotice" role="status">{notice}</div>}
      {error && <div className="wnotice bad" role="alert">{error}</div>}

      <div className="cards">
        {loading && <div className="booting"><span className="ring" />Opening the wall…</div>}
        {!loading && items.length === 0 && (
          <div className="empty">
            <h4>Nothing here yet</h4>
            <p>This is only what colleagues have said to you — approvals stay in their own queue.</p>
          </div>
        )}
        {!loading && items.map((w, i) => (
          <article key={w.id} className={`wcard${w.unread ? ' unread' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
            <span className="pav">{initials(w.actorName)}</span>
            <div>
              <div className="who">
                <b>{w.actorName}</b>
                {w.actorDesignation && <small>{w.actorDesignation}</small>}
                <time dateTime={w.sentAt}>{relTime(w.sentAt)}</time>
              </div>
              <span className={`cat ${w.type === 'appreciation' ? 'badge' : w.type === 'comments' ? 'comment' : 'reply'}`}>
                {w.type === 'appreciation' ? Ic.star() : w.type === 'comments' ? Ic.chat() : Ic.reply()}
                {w.badge ?? CATEGORY[w.type]}
              </span>
              {/* The headline is the system's sentence; the text is theirs.
                  Appreciation is quoted so it reads as a person speaking. */}
              <p className="head">{w.headline}</p>
              {w.text && <p className="txt">{w.type === 'appreciation' ? <q>{w.text}</q> : w.text}</p>}
              <div className="foot">
                {w.canThankBack && (
                  <button className={`thank${w.thanked ? ' done' : ''}`} type="button"
                    disabled={w.thanked} onClick={() => void onThankBack?.(w)}>
                    {Ic.heart()}{w.thanked ? 'Thanked' : 'Thank back'}
                    <span className="burst"><i /><i /><i /><i /><i /><i /></span>
                  </button>
                )}
                {w.unread && onMarkRead && (
                  <button className="chip" type="button" onClick={() => void onMarkRead(w)}>Mark read</button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
