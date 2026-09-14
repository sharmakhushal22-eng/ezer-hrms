'use client';
/**
 * InboxShell — replaces components/ess/InboxTabs.tsx.
 *
 * Three groups, each with its own unread badge. The counts are NEVER summed
 * and only the Messages count is reported up to the portal bell (rule 1).
 * All three stay mounted; switching toggles `hidden`, it does not unmount, so
 * a half-written reply survives a tab switch (rule 2).
 *
 * Usage from the portal is unchanged:
 *   case 'inbox': return <InboxShell employeeId={emp.id} firstName={emp.first_name} onUnread={setUnread} />
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './inbox.css';
import { Ic } from './icons';
import { MessagesInbox } from './MessagesInbox';
import { ToastHost, useInboxOffset, useTick } from './ui';
// Both are default exports and both keep their own data code: WallInbox its
// wall RPCs, BroadcastInbox its direct Supabase read and its PGRST205 / 42703
// handling. Only their render layer was re-skinned.
import WallInbox from '@/components/wall/WallInbox';
import BroadcastInbox from '@/components/ess/BroadcastInbox';

type Group = 'messages' | 'wall' | 'broadcast';
type Status = { s: 'loading' | 'ready' | 'absent' | 'error'; reason?: string };

const GROUPS: Array<{ id: Group; label: string; blurb: string; icon: () => React.ReactNode }> = [
  { id: 'messages', label: 'Messages', blurb: 'Conversations with colleagues and desks', icon: () => Ic.chat() },
  { id: 'wall', label: 'Wall of Fame', blurb: 'Notes, comments and replies about your recognition', icon: () => Ic.star() },
  { id: 'broadcast', label: 'Broadcasts', blurb: 'Company-wide notices. Read only — nobody replies in public', icon: () => Ic.megaphone() },
];

interface Props {
  employeeId: string;
  firstName: string;
  onUnread: (n: number) => void;
}

export function InboxShell({ employeeId, firstName, onUnread }: Props) {
  const [group, setGroup] = useState<Group>('messages');
  const [counts, setCounts] = useState<Record<Group, number>>({ messages: 0, wall: 0, broadcast: 0 });
  const [polledAt, setPolledAt] = useState<number>(Date.now());
  const [ago, setAgo] = useState('just now');
  const [status, setStatus] = useState<Status>({ s: 'loading' });
  const rootRef = useRef<HTMLElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  const onMessagesUnread = useCallback((n: number) => { setCounts(c => ({ ...c, messages: n })); onUnread(n); }, [onUnread]);
  const onWallUnread = useCallback((n: number) => setCounts(c => ({ ...c, wall: n })), []);
  const onBroadcastUnread = useCallback((n: number) => setCounts(c => ({ ...c, broadcast: n })), []);

  /**
   * Written as a named useCallback, not an inline arrow in the JSX, and it
   * returns the previous object when nothing changed.
   *
   * Both halves are load-bearing. MessagesInbox reports the status from an
   * effect keyed on this function, so an inline arrow — a new identity every
   * render — re-runs that effect on every render; and `{ s, reason }` is a new
   * object every time, so React never bails out of the re-render it causes.
   * Together that is an infinite loop: render → effect → setState → render.
   */
  const onMessagesStatus = useCallback((s: Status['s'], reason?: string) => {
    setStatus(prev => (prev.s === s && prev.reason === reason ? prev : { s, reason }));
  }, []);

  useInboxOffset(rootRef);

  // sliding pill under the active tab
  useLayoutEffect(() => {
    const seg = segRef.current, pill = pillRef.current; if (!seg || !pill) return;
    const move = () => {
      const on = seg.querySelector<HTMLElement>('[aria-selected="true"]'); if (!on) return;
      pill.style.width = `${on.offsetWidth}px`; pill.style.transform = `translateX(${on.offsetLeft}px)`;
    };
    move();
    const ro = new ResizeObserver(move); ro.observe(seg);
    if (document.fonts?.ready) void document.fonts.ready.then(move);
    return () => ro.disconnect();
  }, [group]);

  // "Updated Xs ago" — the screen is polled every 20 s, and says so quietly
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.round((Date.now() - polledAt) / 1000);
      setAgo(s < 15 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`);
    }, 5000);
    setAgo('just now');
    return () => clearInterval(t);
  }, [polledAt]);

  return (
    <ToastHost>
      <main className="ib" ref={rootRef}>
        <header className="groups">
          <div className="seg" role="tablist" aria-label="Inbox groups" ref={segRef}>
            <span className="pill" aria-hidden="true" ref={pillRef} />
            {GROUPS.map(g => <GroupTab key={g.id} g={g} active={group === g.id} count={counts[g.id]} onPick={() => setGroup(g.id)} />)}
          </div>
          <div className="blurb" aria-live="polite"><span key={group}>{GROUPS.find(g => g.id === group)?.blurb}</span></div>
          <div className="live" title="Polled every 20 seconds"><i /><span>Updated {ago}</span></div>
        </header>

        {status.s === 'absent' && group === 'messages' ? (
          <Absent reason={status.reason} />
        ) : status.s === 'error' && group === 'messages' ? (
          <ErrorState reason={status.reason} />
        ) : null}

        {/* All three stay mounted. `hidden` only. */}
        <section className="group" role="tabpanel" hidden={group !== 'messages' || status.s === 'absent' || status.s === 'error'}>
          <MessagesInbox employeeId={employeeId} firstName={firstName} onUnread={onMessagesUnread} onPolled={setPolledAt} onStatus={onMessagesStatus} />
        </section>
        <section className="group" role="tabpanel" hidden={group !== 'wall'}>
          <div className="wall">
            {/* Its own count, reported separately. Never added to the others. */}
            <WallInbox employeeId={employeeId} onUnread={onWallUnread} />
          </div>
        </section>
        <section className="group" role="tabpanel" hidden={group !== 'broadcast'}>
          <div className="bc">
            {/* Its own count, reported separately. Never added to the others. */}
            <BroadcastInbox employeeId={employeeId} onUnread={onBroadcastUnread} />
          </div>
        </section>
      </main>
    </ToastHost>
  );
}

function GroupTab({ g, active, count, onPick }: { g: typeof GROUPS[number]; active: boolean; count: number; onPick: () => void }) {
  const tick = useTick(count);
  return (
    <button role="tab" type="button" aria-selected={active} onClick={onPick}>
      {g.icon()}{g.label}<span className={`cnt ${tick}`}>{count > 0 ? count : ''}</span>
    </button>
  );
}

function Absent({ reason }: { reason?: string }) {
  return (
    <div className="group"><div className="bc"><div className="pane">
      <div className="absent">
        <div className="glyph">{Ic.megaphoneOff()}</div>
        <h3>Not switched on yet</h3>
        <p>{reason || 'The inbox tables are not in the database yet.'} Your notifications still reach you on the bell in the meantime.</p>
      </div>
    </div></div></div>
  );
}

function ErrorState({ reason }: { reason?: string }) {
  return (
    <div className="group"><div className="bc"><div className="pane">
      <div className="absent">
        <div className="glyph">{Ic.bellOff()}</div>
        <h3>Could not open your inbox</h3>
        <p>{reason ?? 'The server did not respond.'} It will retry on the next poll.</p>
      </div>
    </div></div></div>
  );
}
