'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Composer } from './Composer';
import { flags } from './flags';
import { FolderGlyph, Ic } from './icons';
import { newDividerIndex } from './selectors';
import { dayLabel, exactTime, initials, relTime, withinGroupWindow } from './time';
import type { ConversationVM, FolderVM, MessageVM, NoteVM } from './types';
import { inkStyle } from './ui';

export type ConversationAction = 'star' | 'mute' | 'close' | 'unread';

interface Props {
  conversation: ConversationVM;
  folder: FolderVM;
  messages: MessageVM[];
  notes: NoteVM[];
  unreadAtOpen: number;        // where the "New" divider goes
  loading: boolean;
  autoFocus: boolean;
  onBack: () => void;
  onSend: (body: string, files: File[]) => Promise<void>;
  onAction?: (a: ConversationAction) => void;
  onDeleteMessage?: (messageId: string) => void;
  onNoteDone?: (noteId: string) => void;
  onWriteToDesk?: (folder: FolderVM['code']) => void;
}

export function ThreadPane(p: Props) {
  const { conversation: c, folder } = p;
  const feed = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<'off' | 'on' | 'new'>('off');
  const prevCount = useRef(0);
  const prevId = useRef<string | null>(null);

  const kindLabel = c.kind === 'DIRECT' ? 'Direct message' : c.kind === 'DESK' ? 'Department desk' : 'Updates — notifications with an action';
  const items = c.kind === 'SYSTEM' ? p.notes : p.messages;
  const newFrom = c.kind === 'SYSTEM' ? -1 : newDividerIndex(p.messages.length, p.unreadAtOpen);

  // Pin to the bottom on open and on own sends; on a polled-in reply while
  // scrolled up, show the "New message" pill instead of yanking the feed.
  useLayoutEffect(() => {
    const el = feed.current; if (!el) return;
    const openedNow = prevId.current !== c.id;
    prevId.current = c.id;
    if (openedNow) {
      const nl = el.querySelector<HTMLElement>('.newline');
      el.scrollTop = nl ? Math.max(0, nl.offsetTop - 60) : el.scrollHeight;
      prevCount.current = items.length;
      return;
    }
    if (items.length > prevCount.current) {
      const last = items[items.length - 1];
      const mine = 'mine' in last && last.mine;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (mine || near) el.scrollTop = el.scrollHeight; else setJump('new');
    }
    prevCount.current = items.length;
  }, [c.id, items]);

  useEffect(() => { setJump('off'); }, [c.id]);

  function onScroll() {
    const el = feed.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setJump(j => (near ? 'off' : j === 'new' ? 'new' : 'on'));
  }

  const composerOff: React.ReactNode | undefined =
    c.kind === 'SYSTEM' ? (
      <>This is a one-way stream — act on the update above. Questions?{' '}
        <button type="button" onClick={() => p.onWriteToDesk?.(c.folder)}>Write to a desk</button></>
    ) : c.closed ? (
      <><b>Closed.</b> Nobody can reply until it is reopened.
        {flags.conversationActions && p.onAction && <button type="button" onClick={() => p.onAction?.('close')}>Reopen</button>}</>
    ) : undefined;

  return (
    <section className="pane thread" aria-live="polite">
      <div className="head ib-h" style={inkStyle(folder)}>
        <button className="back" type="button" aria-label="Back to list" onClick={p.onBack}>{Ic.back()}</button>
        <span className={`av${c.kind === 'DIRECT' ? '' : ' desk'}`}>
          {c.kind === 'DIRECT' ? initials(c.title) : c.kind === 'DESK' ? Ic.desk() : <FolderGlyph code={c.folder} />}
        </span>
        <div className="who">
          <h2>{c.title}</h2>
          <div className="sub">
            <span className="kind">{folder.label}</span>
            <span>{kindLabel}</span>
            {c.muted && <span className="st muted">Muted</span>}
            {c.closed && <span className="st closed">Closed</span>}
          </div>
        </div>
        {flags.conversationActions && p.onAction && (
          <div className="actions">
            <ActionButton cls="ab star" pressed={c.starred} tip={c.starred ? 'Unstar' : 'Star'} onClick={() => p.onAction?.('star')}>{Ic.star()}</ActionButton>
            <ActionButton cls="ab" pressed={c.muted} tip={c.muted ? 'Unmute' : 'Mute'} onClick={() => p.onAction?.('mute')}>{c.muted ? Ic.bellOff() : Ic.bell()}</ActionButton>
            <ActionButton cls="ab hide-m" tip="Mark unread" onClick={() => p.onAction?.('unread')}>{Ic.mail()}</ActionButton>
            {c.kind !== 'SYSTEM' && (
              <ActionButton cls="ab" pressed={c.closed} tip={c.closed ? 'Reopen' : 'Close'} onClick={() => p.onAction?.('close')}>{Ic.lock()}</ActionButton>
            )}
          </div>
        )}
      </div>

      <div className="feed enter" ref={feed} onScroll={onScroll} key={c.id}>
        {p.loading && items.length === 0 && (
          <div className="booting"><span className="ring" />Opening the conversation…</div>
        )}
        {c.kind === 'SYSTEM'
          ? <Notes notes={p.notes} folder={folder} onDone={p.onNoteDone} />
          : <Messages messages={p.messages} newFrom={newFrom} onDelete={flags.deleteOwnMessage ? p.onDeleteMessage : undefined} />}
      </div>

      <button className={`jump${jump !== 'off' ? ' on' : ''}${jump === 'new' ? ' new' : ''}`} type="button"
        onClick={() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }); setJump('off'); }}>
        {Ic.down()}<span>{jump === 'new' ? 'New message' : 'Latest'}</span>
      </button>

      <Composer conversationId={c.id} disabledReason={composerOff} autoFocus={p.autoFocus} onSend={p.onSend} />
    </section>
  );
}

function ActionButton({ cls, pressed, tip, onClick, children }: {
  cls: string; pressed?: boolean; tip: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button className={cls} type="button" aria-pressed={pressed} onClick={onClick}>
      {children}<span className="tip">{tip}</span>
    </button>
  );
}

/* ------------------------------------------------------------- messages */

function Messages({ messages, newFrom, onDelete }: {
  messages: MessageVM[]; newFrom: number; onDelete?: (id: string) => void;
}) {
  let lastDay = '';
  return (
    <>
      {messages.map((m, i) => {
        const day = dayLabel(m.sentAt);
        const newDay = day !== lastDay; lastDay = day;
        const prev = messages[i - 1], next = messages[i + 1];
        const cont = !newDay && !!prev && !prev.deleted && prev.mine === m.mine && withinGroupWindow(prev.sentAt, m.sentAt);
        const tail = !next || next.deleted || next.mine !== m.mine || !withinGroupWindow(next.sentAt, m.sentAt) || dayLabel(next.sentAt) !== day;
        return (
          <Fragment key={m.id}>
            {newDay && <div className="day">{day}</div>}
            {newFrom >= 0 && i === newFrom && <div className="day newline"><span>New</span></div>}
            {m.deleted ? (
              <div className={`msg ${m.mine ? 'me' : 'them'} tomb`}>
                <div className="bub">Message deleted</div>
                <div className="meta"><time dateTime={m.sentAt}>{relTime(m.sentAt)}</time></div>
              </div>
            ) : (
              <div className={`msg ${m.mine ? 'me' : 'them'}${cont ? ' cont' : ''}`} data-m={m.id}>
                {m.mine && onDelete && !m.pending && (
                  <button className="del" type="button" aria-label="Delete message" onClick={() => onDelete(m.id)}>
                    {Ic.trash()}<span className="tip">Delete</span>
                  </button>
                )}
                <div className="bub" title={exactTime(m.sentAt)}>
                  {m.body}
                  {m.attachment && (
                    <a className="att" href={m.attachment.url ?? '#'} target={m.attachment.url ? '_blank' : undefined} rel="noreferrer">
                      <span className="ic">{ext(m.attachment.name)}</span>
                      <span>{m.attachment.name}<small>{m.attachment.size ?? ''}{m.attachment.size ? ' · ' : ''}tap to download</small></span>
                    </a>
                  )}
                </div>
                {tail && (
                  <div className="meta">
                    {m.authorName && !m.mine && <><span>{m.authorName}</span>·</>}
                    <time dateTime={m.sentAt}>{relTime(m.sentAt)}</time>
                    {m.mine && (m.pending
                      ? <span className="sending">· sending…</span>
                      : <span className="sent">· {Ic.check()}sent</span>)}
                  </div>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------- notes */

function Notes({ notes, folder, onDone }: { notes: NoteVM[]; folder: FolderVM; onDone?: (id: string) => void }) {
  let lastDay = '';
  return (
    <>
      {notes.map(n => {
        const day = dayLabel(n.sentAt); const newDay = day !== lastDay; lastDay = day;
        return (
          <Fragment key={n.id}>
            {newDay && <div className="day">{day}</div>}
            <div className="note ib-h" style={inkStyle(folder)}>
              <span className="ic"><FolderGlyph code={folder.code as Exclude<FolderVM['code'], 'ALL'>} /></span>
              <div>
                <h5>{n.title}</h5>
                <p>{n.body}</p>
                <div className="cta">
                  {n.done ? (
                    <span className="btn done">{Ic.check()}Done</span>
                  ) : n.cta ? (
                    <a className="btn" href={n.cta.href} onClick={() => onDone?.(n.id)}>{n.cta.label}</a>
                  ) : null}
                  <time dateTime={n.sentAt}>{relTime(n.sentAt)}</time>
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

function ext(name: string): string {
  const e = name.split('.').pop()?.toUpperCase() ?? 'FILE';
  return e.length > 4 ? 'FILE' : e;
}
