/**
 * lib/inbox/actions.ts — client for the ADDITIVE endpoints the redesign
 * introduces. None of these exist today. The UI only shows the controls
 * when the matching flag in components/ess/inbox/flags.ts is on.
 *
 * All calls go through the API (never Supabase from the browser — rule 11)
 * and carry the Authorization header + employee_id like every other inbox call.
 */
// authHeaders() is async in this repo: it checks the ESS session and the
// Supabase one, and refreshes a token that is about to expire rather than
// sending it. Calling it without await sends a Promise as the header value.
import { authHeaders } from '@/lib/auth-headers';

async function req(url: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method, headers: await authHeaders(), body: JSON.stringify(body), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json;
}

export interface ConversationPatch {
  starred?: boolean;
  muted?: boolean;
  closed?: boolean;
  mark_unread?: boolean;
}

/** PATCH /api/ess/inbox/conversation — per-participant flags. */
export function patchConversation(employeeId: string, id: string, patch: ConversationPatch) {
  return req('/api/ess/inbox/conversation', 'PATCH', { employee_id: employeeId, id, ...patch });
}

/** DELETE /api/ess/inbox/messages — own message only; the server tombstones, never hard-deletes. */
export function deleteMessage(employeeId: string, messageId: string) {
  return req(`/api/ess/inbox/messages?id=${encodeURIComponent(messageId)}`, 'DELETE', { employee_id: employeeId });
}

/** POST /api/ess/inbox { action:'read_all', ids } — marks the given conversations read for the caller. */
export function markAllRead(employeeId: string, ids: string[]) {
  return req('/api/ess/inbox', 'POST', { employee_id: employeeId, action: 'read_all', ids });
}
