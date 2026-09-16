'use client';
/**
 * MessagesInbox — the "Messages" group. Replaces the render layer of
 * components/ess/Inbox.tsx. Data comes from useInboxData (same endpoints,
 * same polling); everything below is view state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatchUp } from './CatchUp';
import { ComposeSheet } from './ComposeSheet';
import { ConversationList } from './ConversationList';
import { flags } from './flags';
import { FolderRail } from './FolderRail';
import { selectConversations } from './selectors';
import { ThreadPane, type ConversationAction } from './ThreadPane';
import type { ConversationVM, FolderVM, ListFilter } from './types';
import { useInboxData } from './useInboxData';
import { useIsMobile, useToast } from './ui';
import { deleteMessage, markAllRead, patchConversation } from '@/lib/inbox/actions';

interface Props {
  employeeId: string;
  firstName: string;                    // catch-up greeting — EmployeePortal has emp.first_name (with full_name as the fallback)
  onUnread: (n: number) => void;        // Messages count only → the portal bell
  onPolled?: (at: number) => void;      // for the "Updated Xs ago" indicator in the shell
  onStatus?: (s: 'loading' | 'ready' | 'absent' | 'error', reason?: string) => void;
}

export function MessagesInbox({ employeeId, firstName, onUnread, onPolled, onStatus }: Props) {
  const data = useInboxData(employeeId);
  const toast = useToast();
  const mobile = useIsMobile();

  const [folder, setFolder] = useState<FolderVM['code']>('ALL');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');
  const [railMin, setRailMin] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeQuery, setComposeQuery] = useState('');
  const [local, setLocal] = useState<Record<string, Partial<ConversationVM>>>({});   // optimistic flag overrides
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { onUnread(data.state.unread); }, [data.state.unread, onUnread]);
  // Opening a SYSTEM thread clears its notifications on the bell too, and the
  // messages endpoint returns the new total. Forward it so the bell does not
  // wait up to 20 s for the next list poll — same as Inbox.tsx today.
  // `data` is a fresh object on every render, so depending on it here would
  // re-run this on every render. The registration function is stable.
  useEffect(() => { data.onUnreadFromThread(onUnread); }, [data.onUnreadFromThread, onUnread]);
  useEffect(() => { onPolled?.(data.lastPolled); }, [data.lastPolled, onPolled]);
  useEffect(() => { onStatus?.(data.state.status, data.state.reason); }, [data.state.status, data.state.reason, onStatus]);

  const folders = useMemo(() => Object.fromEntries(data.state.folders.map(f => [f.code, f])) as Record<string, FolderVM>, [data.state.folders]);

  const conversations = useMemo(
    () => data.state.conversations.map(c => (local[c.id] ? { ...c, ...local[c.id] } : c)),
    [data.state.conversations, local],
  );

  const visible = useMemo(
    () => selectConversations(conversations, { folder, filter, query }),
    [conversations, folder, filter, query],
  );

  const openConv = data.thread ? conversations.find(c => c.id === data.thread?.id) ?? null : null;

  /* --------------------------------------------------------------- open */
  const open = useCallback((id: string) => { void data.open(id); }, [data]);
  const back = useCallback(() => data.close(), [data]);

  /* ------------------------------------------------------------ actions */
  async function act(id: string, a: ConversationAction) {
    if (!flags.conversationActions) return;
    const c = conversations.find(x => x.id === id); if (!c) return;
    const patch: Partial<ConversationVM> =
      a === 'star' ? { starred: !c.starred } :
      a === 'mute' ? { muted: !c.muted } :
      a === 'close' ? { closed: !c.closed } : { unread: Math.max(1, c.unread) };
    setLocal(l => ({ ...l, [id]: { ...(l[id] ?? {}), ...patch } }));
    if (a === 'unread') data.close();
    try {
      await patchConversation(employeeId, id, a === 'unread' ? { mark_unread: true } : patch);
      await data.reload();
      setLocal(l => { const { [id]: _drop, ...rest } = l; return rest; });
      toast.show(a === 'star' ? (c.starred ? 'Removed star' : 'Starred')
        : a === 'mute' ? (c.muted ? 'Unmuted' : 'Muted — no badge for this conversation')
        : a === 'close' ? (c.closed ? 'Reopened' : 'Conversation closed') : 'Marked unread');
    } catch (e) {
      setLocal(l => { const { [id]: _drop, ...rest } = l; return rest; });
      toast.show((e as Error).message || 'Could not update the conversation');
    }
  }

  function quick(id: string, a: 'star' | 'read' | 'mute') {
    if (a === 'read') { const c = conversations.find(x => x.id === id); if (c?.unread) open(id); else void act(id, 'unread'); return; }
    void act(id, a);
  }

  async function onSend(body: string, _files: File[]) {
    if (!openConv) return;
    try { await data.send(openConv.id, body); }
    catch (e) { toast.show((e as Error).message || 'Message not sent'); throw e; }
  }

  async function onDelete(messageId: string) {
    if (!openConv || !flags.deleteOwnMessage) return;
    try { await deleteMessage(employeeId, messageId); await data.reload(); toast.show('Message deleted'); }
    catch (e) { toast.show((e as Error).message || 'Could not delete'); }
    if (data.thread) void data.open(data.thread.id);
  }

  async function onMarkAll() {
    if (!flags.markAllRead) return;
    const ids = visible.filter(c => c.unread > 0).map(c => c.id);
    if (!ids.length) return;
    try { await markAllRead(employeeId, ids); await data.reload(); toast.show(`${ids.length} conversation${ids.length > 1 ? 's' : ''} marked read`); }
    catch (e) { toast.show((e as Error).message || 'Could not mark read'); }
  }

  /* ------------------------------------------------------------ compose */
  async function pickPerson(personId: string) {
    setComposeOpen(false);
    try { const id = await data.start({ person: personId }); if (id) open(id); }
    catch (e) { toast.show((e as Error).message || 'Could not start the conversation'); }
  }
  async function pickDesk(code: FolderVM['code']) {
    setComposeOpen(false);
    const existing = conversations.find(c => c.kind === 'DESK' && c.folder === code);
    if (existing) { open(existing.id); return; }
    // POST { action:'desk', desk_code } — not `to`, which is the reach-checked
    // person path and would refuse a desk code.
    try { const id = await data.start({ desk: code }); if (id) open(id); }
    catch (e) { toast.show((e as Error).message || 'Could not reach the desk'); }
  }
  function writeToDesk(code: FolderVM['code']) {
    const existing = conversations.find(c => c.kind === 'DESK' && c.folder === code);
    if (existing) open(existing.id); else { setComposeQuery(''); setComposeOpen(true); }
  }

  /* ----------------------------------------------------------- keyboard */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (composeOpen) return;
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape') { if (typing) { (document.activeElement as HTMLElement).blur(); return; } if (data.thread) back(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c') { e.preventDefault(); setComposeQuery(''); setComposeOpen(true); }
      if (e.key === 's' && openConv) void act(openConv.id, 'star');
      if (e.key === 'u' && openConv) void act(openConv.id, 'unread');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!visible.length) return; e.preventDefault();
        let i = visible.findIndex(c => c.id === openConv?.id);
        i = e.key === 'ArrowDown' ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0);
        open(visible[i].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeOpen, openConv?.id, visible, data.thread]);

  /* ------------------------------------------------------------- render */
  const listStatus = data.state.status === 'loading' ? 'loading' : 'ready';

  return (
    <div className="ib-messages" data-pane={data.thread ? 'thread' : 'list'} data-rail={railMin ? 'min' : ''}>
      <div className="panes">
        <FolderRail
          folders={data.state.folders} totalUnread={data.state.unread} active={folder} collapsed={railMin}
          onPick={setFolder} onCompose={() => { setComposeQuery(''); setComposeOpen(true); }} onToggleCollapse={() => setRailMin(v => !v)}
        />
        <ConversationList
          title={folder === 'ALL' ? 'All' : folders[folder]?.label ?? 'All'}
          conversations={visible} folders={folders} openId={data.thread?.id ?? null}
          filter={filter} query={query} status={listStatus} searchInputRef={searchRef}
          onFilter={setFilter} onQuery={setQuery} onOpen={open}
          onMarkAllRead={onMarkAll} onQuick={quick}
          onSearchDirectory={q => { setComposeQuery(q); setComposeOpen(true); }}
        />
        {openConv && folders[openConv.folder] ? (
          <ThreadPane
            conversation={openConv} folder={folders[openConv.folder]}
            messages={data.thread?.messages ?? []} notes={data.thread?.notes ?? []}
            unreadAtOpen={data.thread?.unreadAtOpen ?? 0}
            loading={!data.thread || !data.thread.loaded}
            autoFocus={!mobile}
            onBack={back} onSend={onSend} onAction={a => void act(openConv.id, a)}
            onDeleteMessage={onDelete} onWriteToDesk={writeToDesk}
          />
        ) : (
          <CatchUp firstName={firstName} conversations={conversations} folders={folders} onOpen={open} onCompose={() => { setComposeQuery(''); setComposeOpen(true); }} />
        )}
      </div>

      <ComposeSheet
        open={composeOpen} initialQuery={composeQuery} folders={folders} onClose={() => setComposeOpen(false)}
        fetchDirectory={data.directory} onPickPerson={pickPerson} onPickDesk={pickDesk}
      />
    </div>
  );
}
