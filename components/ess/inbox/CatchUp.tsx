'use client';
import { useEffect, useState } from 'react';
import { FolderGlyph, Ic } from './icons';
import { initials } from './time';
import { catchUpBuckets } from './selectors';
import type { ConversationVM, FolderVM } from './types';
import { inkStyle } from './ui';
import type { CSSProperties } from 'react';

interface Props {
  firstName: string;
  conversations: ConversationVM[];
  folders: Record<string, FolderVM>;
  onOpen: (id: string) => void;
  onCompose: () => void;
}

/**
 * The empty thread pane is not wasted: it greets, counts what is waiting
 * (updates that need an action, unread conversations) and opens them in one
 * tap. Counts here are within the Messages group only — never across groups.
 */
export function CatchUp({ firstName, conversations, folders, onOpen, onCompose }: Props) {
  // A conversation can name a folder the rail has not received yet (the very
  // first poll). No ink is better than a crash.
  const ink = (code: ConversationVM['folder']): CSSProperties | undefined =>
    folders[code] ? inkStyle(folders[code]) : undefined;
  const { todo, unread } = catchUpBuckets(conversations);
  // The greeting is the READER's hour. Computed during render it would be the
  // server's — UTC on the host, IST in the browser — and "Good evening" would
  // hydrate over "Good morning" on every load after 18:30 IST. So the first
  // paint says the neutral thing and the real greeting arrives on mount.
  const [greet, setGreet] = useState('Hello');
  useEffect(() => {
    const h = new Date().getHours();
    setGreet(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  return (
    <section className="pane thread">
      <div className="catch">
        <h4>{greet}, {firstName}.</h4>
        <p className="lead">
          {todo.length || unread.length ? (
            <>
              {todo.length > 0 && <><b>{todo.length}</b> update{todo.length > 1 ? 's' : ''} need{todo.length > 1 ? '' : 's'} an action</>}
              {todo.length > 0 && unread.length > 0 && ' and '}
              {unread.length > 0 && <><b>{unread.length}</b> conversation{unread.length > 1 ? 's are' : ' is'} waiting</>}.
            </>
          ) : 'Nothing is waiting on you. Pick a conversation on the left, or start one.'}
        </p>

        {todo.length > 0 && (
          <>
            <h5>Needs your action</h5>
            <div className="cl">
              {todo.map(c => (
                <button key={c.id} className="ci ib-h" type="button" style={ink(c.folder)} onClick={() => onOpen(c.id)}>
                  <span className="ic"><FolderGlyph code={c.folder} /></span>
                  <span className="tx"><b>{c.title}</b><small>{c.preview}</small></span>
                  <span className="go">Open</span>
                </button>
              ))}
            </div>
          </>
        )}

        {unread.length > 0 && (
          <>
            <h5>Unread</h5>
            <div className="cl">
              {unread.map(c => (
                <button key={c.id} className="ci ib-h" type="button" style={ink(c.folder)} onClick={() => onOpen(c.id)}>
                  <span className={`av${c.kind === 'DIRECT' ? '' : ' desk'}`}>{c.kind === 'DIRECT' ? initials(c.title) : Ic.desk()}</span>
                  <span className="tx"><b>{c.title}</b><small>{c.preview}</small></span>
                  <span className="un">{c.unread}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="cfoot">
          <button className="btn ghost" type="button" onClick={onCompose}>{Ic.plus()}New message</button>
          <span>Updates from HR, Payroll and Leave arrive here as actions, not chats.</span>
        </div>
      </div>
    </section>
  );
}
