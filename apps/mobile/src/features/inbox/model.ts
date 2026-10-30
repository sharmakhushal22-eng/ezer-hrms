// src/features/inbox/model.ts — the inbox's view models and its pure logic.
//
// COPIED, NOT IMPORTED. The website keeps these in components/ess/inbox/
// (types.ts, adapter.ts, selectors.ts, time.ts), which the @web alias does not
// reach (it maps lib/ only). They are pure, so they are copied here verbatim in
// behaviour; each block names its source file. lib/inbox/streams.ts IS under lib
// and pure, so it is imported directly.
import { STREAM, STREAMS, type StreamCode } from '@web/inbox/streams'

// ── components/ess/inbox/types.ts ────────────────────────────────────────────
export type FolderCode =
  | 'DIRECT' | 'HR' | 'PAYROLL' | 'FINANCE' | 'TIME' | 'PERFORMANCE'
  | 'RECRUITMENT' | 'EXIT' | 'IT' | 'FUNZONE'
export type ConversationKind = 'DIRECT' | 'DESK' | 'SYSTEM'

export interface FolderVM {
  code: FolderCode | 'ALL'
  label: string
  hint: string
  inkLight: string
  inkDark: string
  unread: number
}

export interface ConversationVM {
  id: string
  folder: FolderCode
  kind: ConversationKind
  title: string
  subtitle?: string
  preview: string
  unread: number
  updatedAt: string
  starred: boolean
  muted: boolean
  closed: boolean
  staffed: boolean
}

export interface MessageVM {
  id: string
  mine: boolean
  authorName?: string
  body: string
  sentAt: string
  deleted: boolean
  /** UI-only: optimistic send state */
  pending?: boolean
}

export interface NoteVM {
  id: string
  title: string
  body: string
  sentAt: string
  cta?: { label: string; href: string }
  done: boolean
}

export interface DirectoryPersonVM { id: string; name: string; code: string; designation: string }
export interface DirectoryDeskVM { code: FolderCode; name: string; hint: string; unstaffed: boolean }
export interface DirectoryVM { people: DirectoryPersonVM[]; desks: DirectoryDeskVM[]; matchedSelf: boolean }

export type ListFilter = 'all' | 'unread' | 'starred'
export type WallStream = 'all' | 'appreciation' | 'comments' | 'replies'

export interface WallItemVM {
  id: string
  type: Exclude<WallStream, 'all'>
  actorName: string
  actorDesignation: string
  headline: string
  badge?: string
  text: string
  sentAt: string
  unread: boolean
  thanked?: boolean
  canThankBack: boolean
  thankId: string
}

export interface BroadcastVM {
  id: string
  title: string
  body: string
  publisher: string
  publishedAt: string
  pinned: boolean
  unread: boolean
  priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT'
  priorityLabel?: string
  canRespond: boolean
  cannotRespondBecause?: string
}

// ── components/ess/inbox/adapter.ts ──────────────────────────────────────────
type Raw = Record<string, unknown>

function streamByCode(code: string) {
  return STREAM.get(code as StreamCode) ?? STREAM.get('HR')!
}
const str = (r: Raw, k: string, d = ''): string => (r[k] == null ? d : String(r[k]))
const num = (r: Raw, k: string, d = 0): number => (typeof r[k] === 'number' ? (r[k] as number) : Number(r[k] ?? d) || d)
const bool = (r: Raw, k: string): boolean => r[k] === true || r[k] === 'true' || r[k] === 1

export function toFolders(serverFolders: unknown): FolderVM[] {
  const unread = new Map<string, number>()
  for (const f of (Array.isArray(serverFolders) ? serverFolders : []) as Raw[]) unread.set(str(f, 'code'), num(f, 'unread'))
  return STREAMS.map(s => ({
    code: s.code as FolderCode, label: s.label, hint: s.hint,
    inkLight: s.ink.l, inkDark: s.ink.d, unread: unread.get(s.code) ?? 0,
  }))
}

export function toConversation(r: Raw): ConversationVM {
  const stream = streamByCode(str(r, 'stream'))
  const kind = str(r, 'kind', 'DIRECT').toUpperCase() as ConversationKind
  const members = (r.members as Raw[] | undefined) ?? []
  return {
    id: str(r, 'id'),
    folder: stream.code as FolderCode,
    kind,
    title: str(r, 'title'),
    subtitle: subtitleFor(kind, members[0], str(r, 'subject')),
    preview: str(r, 'preview'),
    unread: num(r, 'unread'),
    updatedAt: str(r, 'last_message_at') || new Date(0).toISOString(),
    starred: bool(r, 'starred'),
    muted: bool(r, 'muted'),
    closed: bool(r, 'is_closed'),
    staffed: bool(r, 'as_agent'),
  }
}

function subtitleFor(kind: ConversationKind, first: Raw | undefined, subject: string): string | undefined {
  if (kind === 'DIRECT' && first) return [str(first, 'code'), str(first, 'designation')].filter(Boolean).join(' · ') || undefined
  return subject || undefined
}

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
function authorOf(sender: Raw): string | undefined {
  const name = str(sender, 'name')
  const by = str(sender, 'by')
  if (sender.desk === true && name && by) return `${name} · ${by}`
  return name || undefined
}

export function toNote(r: Raw): NoteVM {
  const body = str(r, 'body')
  const href = str(r, 'link')
  return {
    id: str(r, 'id'),
    title: firstLine(body) || 'Update',
    body: restLines(body),
    sentAt: str(r, 'created_at') || new Date().toISOString(),
    cta: href ? { label: 'Open', href } : undefined,
    done: false,
  }
}

export function toDirectory(json: Raw): DirectoryVM {
  const noneStaffed = json.unstaffed_desks === true
  const people = ((json.people as Raw[]) ?? []).map(p => ({
    id: str(p, 'id'), name: str(p, 'name'), code: str(p, 'code'), designation: str(p, 'designation'),
  }))
  const desks = ((json.desks as Raw[]) ?? []).map(d => {
    const code = str(d, 'desk_code')
    const stream = streamByCode(code)
    return {
      code: (code || stream.code) as FolderCode,
      name: str(d, 'label') || `${stream.label} desk`,
      hint: str(d, 'description') || stream.hint,
      unstaffed: noneStaffed || d.staffed === false,
    }
  })
  return { people, desks, matchedSelf: json.matched_self === true }
}

function firstLine(s: string): string { return (s.split('\n')[0] ?? '').trim() }
function restLines(s: string): string { return s.split('\n').slice(1).join('\n').trim() }

// ── components/ess/inbox/selectors.ts ────────────────────────────────────────
export interface ListQuery { folder: FolderVM['code']; filter: ListFilter; query: string }

export function selectConversations(all: ConversationVM[], q: ListQuery): ConversationVM[] {
  const needle = q.query.trim().toLowerCase()
  return all
    .filter(c => q.folder === 'ALL' || c.folder === q.folder)
    .filter(c => q.filter === 'all' || (q.filter === 'unread' && c.unread > 0) || (q.filter === 'starred' && c.starred))
    .filter(c => !needle || matches(c, needle))
    .sort(byNewestFirst)
}
export function matches(c: ConversationVM, needle: string): boolean {
  return c.title.toLowerCase().includes(needle) || c.preview.toLowerCase().includes(needle) || (c.subtitle?.toLowerCase().includes(needle) ?? false)
}
export const byNewestFirst = (a: ConversationVM, b: ConversationVM) => b.updatedAt.localeCompare(a.updatedAt)

export function catchUpBuckets(all: ConversationVM[]) {
  const todo = all.filter(c => c.kind === 'SYSTEM' && c.unread > 0).sort(byNewestFirst)
  const unread = all.filter(c => c.kind !== 'SYSTEM' && c.unread > 0).sort(byNewestFirst)
  return { todo, unread }
}
export function newDividerIndex(messageCount: number, unreadAtOpen: number): number {
  if (unreadAtOpen <= 0 || unreadAtOpen > messageCount) return -1
  return messageCount - unreadAtOpen
}

// ── components/ess/inbox/time.ts ─────────────────────────────────────────────
export function relTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 2) return 'now'
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h`
  if (isYesterday(t, now)) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
export function dayLabel(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (sameDay(t, now)) return 'Today'
  if (isYesterday(t, now)) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'long' })
}
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function withinGroupWindow(aIso: string, bIso: string): boolean {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) <= 5 * 60000
}
function sameDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}
function isYesterday(t: number, now: number): boolean {
  const y = new Date(now); y.setDate(y.getDate() - 1)
  return sameDay(t, y.getTime())
}
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
