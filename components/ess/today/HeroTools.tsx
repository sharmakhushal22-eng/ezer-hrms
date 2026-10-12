'use client';
// components/ess/today/HeroTools.tsx — the hero's top-right cluster.
//
// The on-time streak, the time/date format picker and the theme switch. All
// three are things you set or glance at rather than act on, so they sit above
// everything in the top-right corner instead of competing with the clock on
// one line and the punch buttons on the other.
//
// The streak used to live under the punch dial, where it was the third thing
// stacked beneath the control you came to press.
import { useEffect, useRef, useState } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtDate } from '@/lib/today/format';
import { Auto, Clock, Flame, Moon, Search, Sun } from './icons';

type ToolProps = { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void };

export default function HeroTools({ data, prefs, onPrefs, now, onSearch }: ToolProps & {
  data: TodayPayload; now: Date; onSearch?: () => void;
}) {
  return (
    <div className="hero-tools">
      {data.streak > 0 && (
        <div className="streak" title={`${data.streak} days in a row on time`}>
          <span className="fl"><Flame width={16} height={16} /></span>{data.streak}-day on-time streak
        </div>
      )}
      {/* Only when there is something to open. The drop rendered this
          unconditionally, so with no command palette in this portal it sat in
          the hero doing nothing and advertising a shortcut that was not bound.
          Pass onSearch to bring it back. */}
      {onSearch && <button className="pillbtn cmd" title="Search anything" onClick={onSearch}><Search /> Search <kbd>⌘K</kbd></button>}
      <FormatPicker prefs={prefs} onPrefs={onPrefs} now={now} />
      <ThemeButton prefs={prefs} onPrefs={onPrefs} />
    </div>
  );
}

/* ── time & date format (popover) ────────────────────────────────────────── */
function FormatPicker({ prefs, onPrefs, now }: ToolProps & { now: Date }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const dates: Array<[Prefs['date_format'], string, string]> = [
    ['long', 'Long', now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })],
    ['short', 'Short', fmtDate(now, 'short')],
    ['dmy', 'DD/MM/YYYY', fmtDate(now, 'dmy')],
    ['mdy', 'MM/DD/YYYY', fmtDate(now, 'mdy')],
    ['iso', 'YYYY-MM-DD', fmtDate(now, 'iso')],
  ];

  return (
    <div className="fmtwrap" ref={ref}>
      <button className="pillbtn" title="Time & date format" aria-expanded={open} aria-controls="fmtPop" onClick={() => setOpen(o => !o)}>
        <Clock /> <span>{prefs.time_format}h</span>
      </button>
      <div className={open ? 'pop open' : 'pop'} id="fmtPop" role="dialog" aria-label="Time and date format">
        <h3>Time</h3>
        <div className="seg two">
          <button className={prefs.time_format === '24' ? 'on' : ''} onClick={() => onPrefs({ time_format: '24' })}>24-hour <small>18:30</small></button>
          <button className={prefs.time_format === '12' ? 'on' : ''} onClick={() => onPrefs({ time_format: '12' })}>12-hour <small>6:30 PM</small></button>
        </div>
        <h3>Date</h3>
        <div className="seg">
          {dates.map(([k, label, ex]) => (
            <button key={k} className={prefs.date_format === k ? 'on' : ''} onClick={() => onPrefs({ date_format: k })}>{label} <small>{ex}</small></button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── theme switch: auto → light → dark ───────────────────────────────────── */
function ThemeButton({ prefs, onPrefs }: ToolProps) {
  const order: Prefs['theme'][] = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(prefs.theme) + 1) % 3];
  const Icon = prefs.theme === 'dark' ? Moon : prefs.theme === 'light' ? Sun : Auto;
  return (
    <button className="pillbtn" title={`Theme: ${prefs.theme} — tap for ${next}`} onClick={() => onPrefs({ theme: next })}>
      <Icon /> <span>{prefs.theme[0].toUpperCase() + prefs.theme.slice(1)}</span>
    </button>
  );
}
