/**
 * adapter.ts — maps the server's rows into view models.
 *
 * This is the ONLY file that knows a server column name. Everything below was
 * reconciled against the live routes, not guessed:
 *
 *   app/api/ess/inbox/route.ts            GET  -> { installed, folders, conversations, unread, desks, policy }
 *   app/api/ess/inbox/messages/route.ts   GET  -> { installed, conversation, as_agent, messages, unread }
 *   app/api/ess/inbox/directory/route.ts  GET  -> { installed, reach_mode, people, desks, unstaffed_desks }
 *
 * The shapes are exactly what components/ess/Inbox.tsx reads today, so the
 * redesign renders the same data from the same bytes on the wire.
 */

import { STREAM, STREAMS, type StreamCode } from '@/lib/inbox/streams'
import type {
  ConversationVM, DirectoryVM, FolderCode, FolderVM, MessageVM, NoteVM,
} from './types'

type Raw = Record<string, unknown>

/**
 * streams.ts exports STREAM (a Map) and streamFor (prefix routing for
 * notification codes). It has no "look up a stream by folder code", and it does
 * not need one here: the server has already done the prefix routing, so the
 * `stream` on a conversation row IS a folder code. Resolution keeps the same
 * fallback the rest of the file uses — unmatched goes to HR, because HR owns
 * the things nobody else does.
 */
function streamByCode(code: string) {
  return STREAM.get(code as StreamCode) ?? STREAM.get('HR')!
}

const str = (r: Raw, k: string, d = ''): string => (r[k] == null ? d : String(r[k]))
const num = (r: Raw, k: string, d = 0): number => (typeof r[k] === 'number' ? (r[k] as number) : Number(r[k] ?? d) || d)
const bool = (r: Raw, k: string): boolean => r[k] === true || r[k] === 'true' || r[k] === 1

/* ------------------------------------------------------------------ folders */

/**
 * Folders come from streams.ts, not from the server — the order, the labels,
 * the hints and above all the measured ink pairs are defined there once
 * (rule 4: never re-pick a folder colour by eye).
 *
 * The server's `folders` is an ARRAY of { code, label, hint?, total, unread },
 * and it carries three pseudo-folders the rail does not draw: ALL, UNREAD and
 * STARRED. Only the unread numbers are taken from it.
 */
export function toFolders(serverFolders: unknown): FolderVM[] {
  const unread = new Map<string, number>()
  for (const f of (Array.isArray(serverFolders) ? serverFolders : []) as Raw[]) {
    unread.set(str(f, 'code'), num(f, 'unread'))
  }
  return STREAMS.map(s => ({
    code: s.code as FolderCode,
    label: s.label,
    hint: s.hint,
    // StreamDef.ink is { l, d } — the light/dark pair, each measured against
    // its own theme's surface. Both halves must reach the element wearing .ib-h.
    inkLight: s.ink.l,
    inkDark: s.ink.d,
    unread: unread.get(s.code) ?? 0,
  }))
}

/* ------------------------------------------------------------ conversations */

/**
 * A conversation row from GET /api/ess/inbox. `members` is the other people in
 * the thread (the route strips the viewer out), which is where a DIRECT row's
 * "code · designation" subtitle comes from — there is no `subtitle` column.
 */
export function toConversation(r: Raw): ConversationVM {
  const stream = streamByCode(str(r, 'stream'))
  const kind = str(r, 'kind', 'DIRECT').toUpperCase() as ConversationVM['kind']
  const members = (r.members as Raw[] | undefined) ?? []

  return {
    id: str(r, 'id'),
    folder: stream.code as FolderCode,
    kind,
    title: str(r, 'title'),
    subtitle: subtitleFor(kind, members[0], str(r, 'subject')),
    // `preview` is last_message_preview — already a single line.
    preview: str(r, 'preview'),
    unread: num(r, 'unread'),
    // last_message_at is null on a thread nobody has written in yet. The epoch
    // keeps it sorting last instead of throwing the comparator.
    updatedAt: str(r, 'last_message_at') || new Date(0).toISOString(),
    starred: bool(r, 'starred'),
    muted: bool(r, 'muted'),
    closed: bool(r, 'is_closed'),
    // `as_agent` is true when the viewer sees this desk thread because they
    // staff the desk, not because somebody added them → "You staff this".
    staffed: bool(r, 'as_agent'),
  }
}

function subtitleFor(kind: ConversationVM['kind'], first: Raw | undefined, subject: string): string | undefined {
  if (kind === 'DIRECT' && first) {
    return [str(first, 'code'), str(first, 'designation')].filter(Boolean).join(' · ') || undefined
  }
  return subject || undefined
}

/* ----------------------------------------------------------------- messages */

/**
 * A message row from GET /messages. The server decides `mine` — it resolves the
 * caller from the session — so nothing here compares employee ids. A deleted
 * row arrives as `body: null` with `deleted: true`, which is the tombstone
 * (rule 10): it renders as "Message deleted" rather than vanishing.
 *
 * `sender` is one of two shapes the route builds deliberately:
 *   a person → { name, code, designation, photo }
 *   a desk   → { name, desk: true, by, accent }
 */
export function toMessage(r: Raw): MessageVM {
  const sender = (r.sender as Raw | null) ?? null
  return {
    id: str(r, 'id'),
    mine: bool(r, 'mine'),
    authorName: sender ? authorOf(sender) : undefined,
    body: str(r, 'body'),
    sentAt: str(r, 'created_at') || new Date().toISOString(),
    deleted: bool(r, 'deleted'),
  }
}

/** A desk answer names the desk AND the person who wrote it, when both exist. */
function authorOf(sender: Raw): string | undefined {
  const name = str(sender, 'name')
  const by = str(sender, 'by')
  if (sender.desk === true && name && by) return `${name} · ${by}`
  return name || undefined
}

/**
 * SYSTEM conversations render their rows as notes with an action rather than
 * chat bubbles — the one shape change the current-design doc §13 asked for.
 *
 * There are no title / cta_label / cta_href / done columns: a notification
 * carries `body` and an optional `link`. So the first line of the body is the
 * title, the rest is the body, and the link becomes the action.
 */
export function toNote(r: Raw): NoteVM {
  const body = str(r, 'body')
  const href = str(r, 'link')
  return {
    id: str(r, 'id'),
    title: firstLine(body) || 'Update',
    body: restLines(body),
    sentAt: str(r, 'created_at') || new Date().toISOString(),
    cta: href ? { label: 'Open', href } : undefined,
    // Per-notification "done" is not in the model, and inventing it in the
    // client would show a state the server cannot confirm.
    done: false,
  }
}

/* ---------------------------------------------------------------- directory */

/**
 * GET /directory returns desks as { desk_code, label, description, accent,
 * staffed } and — this is the one a guess would have got wrong — an
 * `unstaffed_desks` BOOLEAN, not a list of codes. It is true when no desk has
 * anybody on it at all, which is what the warning box in the sheet reports.
 */
export function toDirectory(json: Raw): DirectoryVM {
  const noneStaffed = json.unstaffed_desks === true

  const people = ((json.people as Raw[]) ?? []).map(p => ({
    id: str(p, 'id'),
    name: str(p, 'name'),
    code: str(p, 'code'),
    designation: str(p, 'designation'),
  }))

  const desks = ((json.desks as Raw[]) ?? []).map(d => {
    const code = str(d, 'desk_code')
    const stream = streamByCode(code)
    return {
      // The desk's own code is what POST { action:'desk' } wants back, and it
      // is also the folder the thread will appear in.
      code: (code || stream.code) as FolderCode,
      name: str(d, 'label') || `${stream.label} desk`,
      hint: str(d, 'description') || stream.hint,
      // `staffed` is per-row on the wire, but the route sets every row from one
      // global check, so it says the same thing as the boolean above.
      unstaffed: noneStaffed || d.staffed === false,
    }
  })

  return { people, desks, matchedSelf: json.matched_self === true }
}

/* ------------------------------------------------------------------ helpers */

function firstLine(s: string): string { return (s.split('\n')[0] ?? '').trim() }
function restLines(s: string): string { return s.split('\n').slice(1).join('\n').trim() }
