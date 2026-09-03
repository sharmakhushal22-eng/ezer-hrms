// lib/wall/inbox.ts — the Wall of Fame inbox streams.
//
// THREE STREAMS, AND NEVER AN APPROVAL.
//
// wall_inbox_events has a CHECK listing seven event types and none of them is
// an approval. Nomination endorsements and publish approvals are workflow and
// route to the existing approvals queue exactly as leave and offers do.
//
// Badge unlocks, service milestones and reaction counts do not appear either.
// They belong on the wall and in the notification channels. This inbox is
// limited to things a colleague actually said.
//
// The reason is the whole design: workflow noise is what kills a recognition
// inbox. The moment a pending approval sits beside a thank-you note, people
// triage the tab instead of reading it, and the appreciation goes unread.
//
// COUNTS ARE NEVER SUMMED WITH THE APPROVALS COUNT.
// A pending leave request and a colleague's thank-you are not the same kind
// of unread. One number for both trains people to ignore it.

export type WallEvent =
  | 'appreciation' | 'recognised' | 'thanked_back' | 'share_request'
  | 'commented' | 'mentioned' | 'replied'

export type Stream = 'all' | 'appreciation' | 'comments' | 'replies'

/** Which stream an event belongs to. Mirrors get_inbox_counts() exactly — if
 *  these two disagree, a badge shows a number the list cannot account for. */
export const STREAM_OF: Record<WallEvent, Exclude<Stream, 'all'>> = {
  appreciation: 'appreciation',
  recognised: 'appreciation',
  thanked_back: 'appreciation',
  share_request: 'appreciation',
  commented: 'comments',
  mentioned: 'comments',
  replied: 'replies',
}

export const STREAMS: { k: Stream; label: string; blurb: string }[] = [
  { k: 'all',          label: 'Everything',   blurb: 'Every note, comment and reply' },
  { k: 'appreciation', label: 'Appreciation', blurb: 'Notes sent to you, and thank-yous back' },
  { k: 'comments',     label: 'Comments',     blurb: 'Comments and mentions on your recognition' },
  { k: 'replies',      label: 'Replies',      blurb: 'Replies to comments you wrote' },
]

/** What each event says, in the second person. The headline is the whole
 *  point of an inbox row — a reader should not have to open it to know
 *  whether it matters. */
export function headlineFor(e: WallEvent, actor: string): string {
  switch (e) {
    case 'appreciation':  return `${actor} sent you a note`
    case 'recognised':    return `${actor} recognised you`
    case 'thanked_back':  return `${actor} said thank you`
    case 'share_request': return `${actor} asked to share their note on the feed`
    case 'commented':     return `${actor} commented on your recognition`
    case 'mentioned':     return `${actor} mentioned you`
    case 'replied':       return `${actor} replied to your comment`
    default:              return `${actor} did something`
  }
}

/** The glyph beside a row. Never colour alone — the headline always says it
 *  in words too. */
export function glyphFor(e: WallEvent): string {
  switch (e) {
    case 'appreciation':  return '✉'
    case 'recognised':    return '★'
    case 'thanked_back':  return '↩'
    case 'share_request': return '⇧'
    case 'commented':     return '💬'
    case 'mentioned':     return '@'
    case 'replied':       return '↳'
    default:              return '•'
  }
}

export interface Counts {
  total_unread?: number
  appreciation?: number
  comments?: number
  replies?: number
}

/** The number on a stream's tab. `all` shows the total; the rest their own. */
export function countFor(stream: Stream, c: Counts): number {
  if (stream === 'all') return c.total_unread ?? 0
  return c[stream] ?? 0
}

/**
 * Does the per-stream arithmetic add up?
 *
 * If the three streams do not sum to the total, an event type exists that no
 * stream claims — which shows as a badge the reader can never clear by
 * opening anything. Reported rather than hidden.
 */
export function countsReconcile(c: Counts): boolean {
  const parts = (c.appreciation ?? 0) + (c.comments ?? 0) + (c.replies ?? 0)
  return parts === (c.total_unread ?? 0)
}
