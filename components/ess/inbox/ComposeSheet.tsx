'use client';
import { useEffect, useRef, useState } from 'react';
import { Ic } from './icons';
import { initials } from './time';
import type { DirectoryVM, FolderVM } from './types';
import { inkStyle } from './ui';

interface Props {
  open: boolean;
  /** Carried over from the list search, so the term is not retyped. */
  initialQuery?: string;
  folders: Record<string, FolderVM>;
  onClose: () => void;
  /** Queries /api/ess/inbox/directory?q= — the endpoint applies inbox_can_message, so everything listed is sendable. */
  fetchDirectory: (q: string) => Promise<DirectoryVM>;
  onPickPerson: (id: string) => void;
  onPickDesk: (code: FolderVM['code']) => void;
}

/**
 * Rule 5: the picker only offers people the policy will accept — because the
 * directory endpoint asks inbox_can_message(from, to), the same authority the
 * send path uses. This sheet never filters or adds to what the server returns.
 */
/** aria-activedescendant needs a real element id for the option it names. */
const optId = (key: string) => `compose-opt-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

export function ComposeSheet({ open, initialQuery = '', folders, onClose, fetchDirectory, onPickPerson, onPickDesk }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<DirectoryVM | null>(null);
  const [sel, setSel] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The query effect must not re-run just because the caller re-rendered.
  // Keyed on the function identity it would fire on every parent render, and
  // a caller passing an inline arrow would spin forever.
  const fetchRef = useRef(fetchDirectory);
  fetchRef.current = fetchDirectory;

  // open/close the native dialog (entry/exit animated in CSS via @starting-style)
  useEffect(() => {
    const d = dlg.current; if (!d) return;
    if (open && !d.open) {
      d.showModal(); setQ(initialQuery); setSel(-1); setFailed(null);
      window.setTimeout(() => { input.current?.focus(); input.current?.select(); }, 80);
    }
    if (!open && d.open) d.close();
  }, [open, initialQuery]);

  // Debounced directory query as you type.
  //
  // The catch is the point. Without it a rejected request left `dir` at null
  // forever, and every branch in the body is guarded on `dir` — so a failing
  // endpoint rendered an empty sheet that looked exactly like "nobody matched".
  // A search that cannot say it failed is a search that looks broken.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      fetchRef.current(q)
        .then(r => { if (alive) { setDir(r); setSel(-1); setFailed(null); } })
        .catch((e: Error) => { if (alive) { setDir(null); setFailed(e.message || 'The directory did not load.'); } })
        .finally(() => { if (alive) setBusy(false); });
    }, q ? 180 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, open]);

  /**
   * The directory endpoint filters PEOPLE by the query but returns every active
   * desk regardless — so without this, searching a colleague's code left all
   * five departments on screen and just dropped the People section. Nothing said
   * "no match", so a search that found nobody looked exactly like a broken one.
   *
   * Filtering here rather than asking the server for it: the response already
   * contains every desk, so this is a presentation decision, not a new request.
   */
  const needle = q.trim().toLowerCase();
  const desks = (dir?.desks ?? []).filter(d =>
    !needle || `${d.name} ${d.hint} ${d.code}`.toLowerCase().includes(needle));
  const people = dir?.people ?? [];

  const options: Array<{ key: string; run: () => void }> = [
    ...desks.map(d => ({ key: `d:${d.code}`, run: () => onPickDesk(d.code) })),
    ...people.map(p => ({ key: `p:${p.id}`, run: () => onPickPerson(p.id) })),
  ];
  const unstaffed = desks.filter(d => d.unstaffed);

  function onKey(e: React.KeyboardEvent) {
    if (!options.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(s => e.key === 'ArrowDown' ? Math.min(s + 1, options.length - 1) : Math.max(s - 1, 0));
    }
    if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); options[sel].run(); }
  }

  return (
    <dialog className="sheet" ref={dlg} aria-labelledby="compose-title"
      onClose={onClose} onClick={e => { if (e.target === dlg.current) onClose(); }}>
      <div className="sh">
        <h3 id="compose-title">New message</h3>
        <button className="x" type="button" aria-label="Close" onClick={onClose}>{Ic.close()}</button>
      </div>
      <label className="search">
        {Ic.search()}
        <span className="sr">Search a colleague</span>
        <input ref={input} type="search" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          role="combobox" aria-expanded={options.length > 0} aria-controls="compose-options"
          aria-activedescendant={sel >= 0 && options[sel] ? optId(options[sel].key) : undefined}
          placeholder="Search a colleague by name or code…" />
      </label>
      <div className="body" id="compose-options" role="listbox" aria-label="Colleagues and desks">
        {desks.length > 0 && (
          <div role="group" aria-labelledby="compose-desks">
            <h4 id="compose-desks">Departments</h4>
            {desks.map((d, i) => {
              const f = folders[d.code];
              return (
                <button key={d.code} id={optId(`d:${d.code}`)} className="opt ib-h" type="button"
                  role="option" aria-selected={sel === i} tabIndex={-1}
                  style={f ? inkStyle(f) : undefined} onClick={() => onPickDesk(d.code)}>
                  <span className="dot" />
                  <span><b>{d.name}</b><small>{d.hint}</small></span>
                  {Ic.chevron({ className: 'i go' })}
                </button>
              );
            })}
          </div>
        )}
        {unstaffed.length > 0 && (
          <div className="warn">
            <b>{unstaffed.map(d => d.name).join(', ')}</b> has nobody assigned yet, so a message may sit unanswered.
            HR can assign people in Admin Setup → Inbox.
          </div>
        )}
        {people.length > 0 && (
          <div role="group" aria-labelledby="compose-people">
            <h4 id="compose-people">People</h4>
            {people.map((p, i) => {
              const idx = desks.length + i;
              const f = folders['DIRECT'];
              return (
                <button key={p.id} id={optId(`p:${p.id}`)} className="opt ib-h" type="button"
                  role="option" aria-selected={sel === idx} tabIndex={-1}
                  style={f ? inkStyle(f) : undefined} onClick={() => onPickPerson(p.id)}>
                  <span className="av">{initials(p.name)}</span>
                  <span><b>{p.name}</b><small>{p.code} · {p.designation}</small></span>
                  {Ic.chevron({ className: 'i go' })}
                </button>
              );
            })}
          </div>
        )}
        {dir && !busy && !failed && desks.length === 0 && people.length === 0 && (
          <div className="empty">
            <h4>{dir.matchedSelf ? 'That is you' : 'No one found'}</h4>
            <p>
              {dir.matchedSelf
                ? <>“{q.trim()}” matches your own record, and you cannot message yourself. Search for a colleague instead.</>
                : q.trim()
                  ? <>Nothing matches “{q.trim()}”. Try a name, an employee code, or a desk.</>
                  : 'Try a name, employee code or a desk.'}
              {!dir.matchedSelf && ' Only colleagues your reach policy allows are listed.'}
            </p>
          </div>
        )}
        {failed && !busy && (
          <div className="empty">
            <h4>Could not load the directory</h4>
            <p>{failed} Check your connection and try again — nothing has been sent.</p>
          </div>
        )}
        {!dir && busy && <div className="booting"><span className="ring" />Loading the directory…</div>}
      </div>
      <div className="foot">Only colleagues and desks your company’s reach policy allows are listed — nothing here will be refused on send.</div>
    </dialog>
  );
}
