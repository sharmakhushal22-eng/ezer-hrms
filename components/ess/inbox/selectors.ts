/**
 * selectors.ts — the pure list logic, extracted from MessagesInbox so it can
 * be tested without React. No fetching, no state, no DOM.
 */
import type { ConversationVM, FolderVM, ListFilter } from './types';

export interface ListQuery {
  folder: FolderVM['code'];
  filter: ListFilter;
  query: string;
}

/** Folder → filter → search → newest first. Same order the old screen used. */
export function selectConversations(all: ConversationVM[], q: ListQuery): ConversationVM[] {
  const needle = q.query.trim().toLowerCase();
  return all
    .filter(c => q.folder === 'ALL' || c.folder === q.folder)
    .filter(c => q.filter === 'all'
      || (q.filter === 'unread' && c.unread > 0)
      || (q.filter === 'starred' && c.starred))
    .filter(c => !needle || matches(c, needle))
    .sort(byNewestFirst);
}

export function matches(c: ConversationVM, needle: string): boolean {
  return c.title.toLowerCase().includes(needle)
    || c.preview.toLowerCase().includes(needle)
    || (c.subtitle?.toLowerCase().includes(needle) ?? false);
}

export const byNewestFirst = (a: ConversationVM, b: ConversationVM) => b.updatedAt.localeCompare(a.updatedAt);

/**
 * Unread for the Messages group only. Muted conversations still arrive and
 * still list — they just do not raise a badge (see DATA-FLOW §3).
 * NOTE: this is the client-side mirror; the server's `unread` is authoritative
 * when it is present. Never add this to the Wall or Broadcast counts.
 */
export function messagesUnread(all: ConversationVM[]): number {
  return all.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
}

/** Per-folder badge counts, keyed by folder code. */
export function unreadByFolder(all: ConversationVM[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of all) {
    if (c.muted) continue;
    out[c.folder] = (out[c.folder] ?? 0) + c.unread;
  }
  return out;
}

/** Catch-up panel buckets: updates that need an action, then unread conversations. */
export function catchUpBuckets(all: ConversationVM[]) {
  const todo = all.filter(c => c.kind === 'SYSTEM' && c.unread > 0).sort(byNewestFirst);
  const unread = all.filter(c => c.kind !== 'SYSTEM' && c.unread > 0).sort(byNewestFirst);
  return { todo, unread };
}

/** Where the red "New" divider goes, or -1 when there is nothing unread. */
export function newDividerIndex(messageCount: number, unreadAtOpen: number): number {
  if (unreadAtOpen <= 0 || unreadAtOpen > messageCount) return -1;
  return messageCount - unreadAtOpen;
}
