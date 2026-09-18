'use client';
import { useMemo, useRef } from 'react';
import { flags } from './flags';
import { FolderGlyph, Ic } from './icons';
import { initials, relTime } from './time';
import type { ConversationVM, FolderVM, ListFilter } from './types';
import { inkStyle, useFlip } from './ui';

interface Props {
  title: string;                     // 'All' or the folder label
  conversations: ConversationVM[];   // already filtered + sorted by the parent
  folders: Record<string, FolderVM>;
  openId: string | null;
  filter: ListFilter;
  query: string;
  status: 'loading' | 'ready';
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onFilter: (f: ListFilter) => void;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onMarkAllRead?: () => void;
  onQuick?: (id: string, action: 'star' | 'read' | 'mute') => void;
  /** The list only holds conversations you already have — this reaches the rest. */
  onSearchDirectory?: (q: string) => void;
}

export function ConversationList(p: Props) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const orderKey = useMemo(() => p.conversations.map(c => c.id).join(','), [p.conversations]);
  useFlip(rowsRef, orderKey);
  const anyUnread = p.conversations.some(c => c.unread > 0);

  return (
    <section className="pane list">
      <div className="head">
        <div className="row1">
          <h2>{p.title}</h2>
          <span className="sum">
            {p.conversations.length ? `${p.conversations.length} conversation${p.conversations.length > 1 ? 's' : ''}` : ''}
          </span>
          {flags.markAllRead && p.onMarkAllRead && (
            <button className="mark" type="button" disabled={!anyUnread} onClick={p.onMarkAllRead}>Mark all read</button>
          )}
        </div>
        <label className="search">
          {Ic.search()}
          <span className="sr">Search conversations{flags.messageSearch ? ' and messages' : ''}</span>
          <input ref={p.searchInputRef} type="search" autoComplete="off" value={p.query}
            placeholder={flags.messageSearch ? 'Search people, desks or messages…' : 'Search people or desks…'}
            onChange={e => p.onQuery(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <div className="chips" role="group" aria-label="Filter">
          {(['all', 'unread', 'starred'] as ListFilter[]).map(f => (
            <button key={f} className="chip" type="button" aria-pressed={p.filter === f} onClick={() => p.onFilter(f)}>
              {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Starred'}
            </button>
          ))}
        </div>
      </div>

      <div className="rows" id="rows" role="listbox" aria-label="Conversations" ref={rowsRef}>
        {p.status === 'loading' && <Skeleton />}
        {p.status === 'ready' && p.conversations.length === 0 && (
          <Empty filter={p.filter} query={p.query} title={p.title} onSearchDirectory={p.onSearchDirectory} />
        )}
        {/* Even with matches, the person you want may have no thread yet. */}
        {p.status === 'ready' && p.query.trim() && p.conversations.length > 0 && p.onSearchDirectory && (
          <button className="dirhint" type="button" onClick={() => p.onSearchDirectory?.(p.query.trim())}>
            {Ic.search({ className: 'i' })}<span>Not here? Search all colleagues for “{p.query.trim()}”</span>
          </button>
        )}
        {p.status === 'ready' && p.conversations.map((c, i) => (
          <Row key={c.id} c={c} folder={p.folders[c.folder]} index={i} open={p.openId === c.id}
            onOpen={p.onOpen} onQuick={p.onQuick} />
        ))}
      </div>
    </section>
  );
}

function Row({ c, folder, index, open, onOpen, onQuick }: {
  c: ConversationVM; folder?: FolderVM; index: number; open: boolean;
  onOpen: (id: string) => void; onQuick?: Props['onQuick'];
}) {
  const kind = c.kind === 'SYSTEM' ? 'Updates' : c.kind === 'DESK' ? 'Desk' : 'Direct';
  const quick = flags.conversationActions && onQuick;
  return (
    <button
      className={`row ib-h${c.unread ? ' unread' : ''}`}
      role="option" aria-selected={open} aria-current={open ? 'true' : 'false'}
      data-flip={c.id} type="button"
      style={{ ...(folder ? inkStyle(folder) : {}), animationDelay: `${index * 28}ms` }}
      onClick={e => {
        const qa = (e.target as HTMLElement).closest<HTMLElement>('[data-qa]');
        if (qa && quick) { e.stopPropagation(); onQuick(c.id, qa.dataset.qa as 'star' | 'read' | 'mute'); return; }
        onOpen(c.id);
      }}
    >
      <span className={`av${c.kind === 'DIRECT' ? '' : ' desk'}`}>
        {c.kind === 'DIRECT' ? initials(c.title) : c.kind === 'DESK' ? Ic.desk() : <FolderGlyph code={c.folder} />}
      </span>
      <span className="t"><b>{c.title}</b><time dateTime={c.updatedAt}>{relTime(c.updatedAt)}</time></span>
      <span className="m">
        <span className="kind">{kind}</span>
        {c.staffed && <span className="kind staff">You staff this</span>}
        <p>{c.preview}</p>
        <span className="flags">
          {c.starred && Ic.star({ className: 'i star' })}
          {c.muted && Ic.bellOff()}
        </span>
        {c.unread > 0 && <span className="un">{c.unread}</span>}
      </span>
      {quick && (
        <span className="qa" aria-hidden="true">
          <span data-qa="star" title={c.starred ? 'Unstar' : 'Star'}>
            {Ic.star({ style: c.starred ? { fill: 'var(--ez-gold)', color: 'var(--ez-gold)' } : undefined })}
          </span>
          <span data-qa="read" title={c.unread ? 'Mark read' : 'Mark unread'}>{c.unread ? Ic.check() : Ic.mail()}</span>
          <span data-qa="mute" title={c.muted ? 'Unmute' : 'Mute'}>{c.muted ? Ic.bellOff() : Ic.bell()}</span>
        </span>
      )}
    </button>
  );
}

function Empty({ filter, query, title, onSearchDirectory }: {
  filter: ListFilter; query: string; title: string; onSearchDirectory?: (q: string) => void;
}) {
  const q = query.trim();
  // This box filters the conversations you already have. Somebody searching a
  // colleague's name is usually looking for the person, not the thread — and
  // before this, an unanswered "no matches" was all they got.
  const msg = q ? `No conversation with “${q}” yet.`
    : filter === 'unread' ? 'You are all caught up here.'
    : filter === 'starred' ? 'Star a conversation to keep it within reach.'
    : title === 'All' ? 'Start a conversation, or write to a desk.'
    : 'Nothing here yet.';
  return (
    <div className="empty">
      <div className="glyph">{Ic.chat()}</div>
      <h4>{q ? 'No matches' : 'Nothing here yet'}</h4>
      <p>{msg}</p>
      {q && onSearchDirectory && (
        <button className="btn ghost" type="button" onClick={() => onSearchDirectory(q)}>
          {Ic.search({ className: 'i' })}Search all colleagues for “{q}”
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skrow" key={i}>
          <div className="skel a" />
          <div><div className="skel l1" /><div className="skel l2" /></div>
        </div>
      ))}
    </>
  );
}
