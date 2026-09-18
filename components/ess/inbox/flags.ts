/**
 * Feature flags for the parts of the redesign that need backend work the
 * current API does not have. Everything ships OFF; the UI hides the control
 * (never shows a button that will fail). Flip each on only after its
 * endpoint exists — see docs/DATA-FLOW.md §3.
 *
 * NEXT_PUBLIC_* so they are readable in the client bundle.
 */
export const flags = {
  /** Star · Mute · Close/Reopen · Mark unread — needs PATCH /api/ess/inbox/conversation */
  conversationActions: process.env.NEXT_PUBLIC_INBOX_ACTIONS === '1',
  /** Delete own message → tombstone — needs DELETE /api/ess/inbox/messages?id= */
  deleteOwnMessage: process.env.NEXT_PUBLIC_INBOX_DELETE === '1',
  /** Paperclip + drag-drop + attachment cards — needs an upload route and a storage bucket */
  attachments: process.env.NEXT_PUBLIC_INBOX_ATTACHMENTS === '1',
  /** "Mark all read" for the visible list — needs POST /api/ess/inbox { action:'read_all', ids } */
  markAllRead: process.env.NEXT_PUBLIC_INBOX_READ_ALL === '1',
  /** Search inside message bodies (not just titles) — needs GET /api/ess/inbox/search?q= */
  messageSearch: process.env.NEXT_PUBLIC_INBOX_SEARCH === '1',
};
