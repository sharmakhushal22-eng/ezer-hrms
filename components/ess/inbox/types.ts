/**
 * View models for the redesigned Inbox.
 *
 * These are what the presentational components render. They are deliberately
 * NOT the server's row shapes — `adapter.ts` maps `/api/ess/inbox` responses
 * into these, so the UI never depends on a column name. If the server shape
 * changes, only the adapter changes.
 */

export type FolderCode =
  | 'DIRECT' | 'HR' | 'PAYROLL' | 'FINANCE' | 'TIME' | 'PERFORMANCE'
  | 'RECRUITMENT' | 'EXIT' | 'IT' | 'FUNZONE';

export type ConversationKind = 'DIRECT' | 'DESK' | 'SYSTEM';

/** One folder in the rail. Colours are the measured pair from lib/inbox/streams.ts. */
export interface FolderVM {
  code: FolderCode | 'ALL';
  label: string;
  hint: string;
  inkLight: string;   // e.g. '#1F5BC1'
  inkDark: string;    // e.g. '#588BE4'
  unread: number;
}

export interface ConversationVM {
  id: string;
  folder: FolderCode;
  kind: ConversationKind;
  title: string;          // person, desk, or department
  subtitle?: string;      // 'SRS0088 · HR Business Partner' / 'Answered by the payroll team'
  preview: string;        // last message, one line
  unread: number;
  updatedAt: string;      // ISO
  starred: boolean;
  muted: boolean;
  closed: boolean;
  staffed: boolean;       // viewer is an agent on this desk → "You staff this"
}

export interface AttachmentVM {
  name: string;
  size?: string;
  url?: string;
}

export interface MessageVM {
  id: string;
  mine: boolean;
  authorName?: string;    // shown on desk threads where several agents answer
  body: string;
  sentAt: string;         // ISO
  deleted: boolean;       // tombstone → "Message deleted"
  attachment?: AttachmentVM;
  /** UI-only: optimistic send state */
  pending?: boolean;
}

/** A SYSTEM stream item — a notification with an action, not a chat bubble. */
export interface NoteVM {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  cta?: { label: string; href: string };
  done: boolean;
}

export interface DirectoryPersonVM {
  id: string;
  name: string;
  code: string;
  designation: string;
}

export interface DirectoryDeskVM {
  code: FolderCode;
  name: string;
  hint: string;
  unstaffed: boolean;
}

export interface DirectoryVM {
  people: DirectoryPersonVM[];
  desks: DirectoryDeskVM[];
  /** The query matched the viewer themselves, who is never in their own directory. */
  matchedSelf: boolean;
}

export type InboxStatus = 'loading' | 'ready' | 'absent' | 'error';

export interface InboxState {
  status: InboxStatus;
  reason?: string;              // for 'absent' / 'error'
  folders: FolderVM[];          // without ALL — the rail computes ALL
  conversations: ConversationVM[];
  unread: number;               // Messages group total (the only number reported to the bell)
}

export type ListFilter = 'all' | 'unread' | 'starred';

/**
 * Wall of Fame stream item (presentational only — WallInbox keeps its own data).
 * The stream names are lib/wall/inbox.ts's, not new ones: the list is filtered
 * server-side by that vocabulary, and a second spelling here would be a bug
 * waiting for somebody to filter twice.
 */
export type WallStream = 'all' | 'appreciation' | 'comments' | 'replies';

export interface WallItemVM {
  id: string;
  type: Exclude<WallStream, 'all'>;
  actorName: string;
  actorDesignation: string;
  /** What happened, in the second person — from headlineFor(). */
  headline: string;
  badge?: string;               // the category label, e.g. 'Team Player'
  text: string;                 // their words
  sentAt: string;
  unread: boolean;
  thanked?: boolean;
  canThankBack: boolean;
  /** Whichever id the thank-back RPC wants for this row. */
  thankId: string;
}

export interface BroadcastVM {
  id: string;
  title: string;
  body: string;
  publisher: string;
  publishedAt: string;
  pinned: boolean;
  unread: boolean;
  /** URGENT / IMPORTANT ride on the card; NORMAL says nothing, as today. */
  priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  priorityLabel?: string;
  /** canRespond() decides this — a withdrawn notice and your own are both no. */
  canRespond: boolean;
  cannotRespondBecause?: string;
}
