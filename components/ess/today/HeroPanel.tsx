'use client';
// components/ess/today/HeroPanel.tsx — the day panel: clock, greeting, one-line brief,
// shift/week/holiday meta, search pill, time & date format picker, theme switch.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtDate, fmtHHMM, greeting, two } from '@/lib/today/format';
import { Auto, Clock, Moon, Search, Sun } from './icons';
import { useNow } from './hooks';

type Props = { data: TodayPayload; prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; children: ReactNode; onSearch?: () => void };

export default function HeroPanel({ data, prefs, onPrefs, children, onSearch }: Props) {
  const now = useNow(15000);
  const h = now.getHours(), t = h + now.getMinutes() / 60;
  const tone = h >= 17 || h < 6 ? 'evening' : h >= 12 ? 'afternoon' : '';
  // sun/moon rides the arc in the top band: 6:00 left end → 20:00 right end
  const p = Math.min(1, Math.max(0, (t - 6) / 14)), a = Math.PI * (1 - p);
  const orb = { left: `${67 + Math.cos(a) * 33}%`, top: `${30 - Math.sin(a) * 18}%` };

  const e = data.employee, leaveDays = data.leave?.total ?? 0, pend = data.pending.length;
  const nextBday = data.celebrations.find(c => c.kind === 'birthday');
  const weekH = Math.floor(data.week_hours), weekM = Math.round((data.week_hours - weekH) * 60);

  return (
    <section className={`hero reveal ${tone}`} style={{ ['--i' as string]: 0 }} aria-label="Today">
      <div className="hero-bg"><div className="grain" /><div className="sky"><div className="arc" /><div className="orb" style={orb} /></div></div>

      <div>
        <div className="hero-top">
          <div className="clock">
            <b>
              {prefs.time_format === '24' ? <>{two(h)}<i>:</i>{two(now.getMinutes())}</>
                : <>{h % 12 || 12}<i>:</i>{two(now.getMinutes())}<span style={{ fontSize: 14, fontWeight: 600, marginLeft: 5 }}>{h >= 12 ? 'PM' : 'AM'}</span></>}
            </b>
            <span>{fmtDate(now, prefs.date_format)}</span>
          </div>
          <div className="hero-tools">
            <button className="pillbtn cmd" title="Search anything" onClick={onSearch}><Search /> Search <kbd>⌘K</kbd></button>
            <FormatPicker prefs={prefs} onPrefs={onPrefs} now={now} />
            <ThemeButton prefs={prefs} onPrefs={onPrefs} />
          </div>
        </div>

        <div className="greet">
          <div className="av">{e.initials}<span className={'on' + (data.today?.punch_in && !data.today.punch_out ? ' live' : '')} /></div>
          <div>
            <h1 className="serif">{greeting(h)}, <span className="name">{e.first_name}</span></h1>
            <div className="sub">
              {e.designation && <span>{e.designation}</span>}
              <span className="chip">{e.code}</span>
              {e.location && <span className="chip">{e.location}</span>}
            </div>
          </div>
        </div>

        <p className="brief serif">
          {pend > 0 ? <>You have <em>{pend} {pend === 1 ? 'thing' : 'things'}</em> waiting on you</> : <>Nothing is waiting on you</>}
          {nextBday && <>, {nextBday.name.split(' ')[0]}'s birthday is coming up</>}
          , and <em>{leaveDays} days</em> of leave in the bank.
          {data.team.total > 0 && <> {data.team.in} of your team {data.team.in === 1 ? 'is' : 'are'} in office today.</>}
        </p>

        <div className="hero-meta">
          <div>Shift<b>{fmtHHMM(data.shift.start, prefs.time_format)} – {fmtHHMM(data.shift.end, prefs.time_format)}</b></div>
          <div>This week<b>{weekH}h {two(weekM)}m logged</b></div>
          {data.next_holiday && <div>Next holiday<b>{data.next_holiday.name}, {new Date(data.next_holiday.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b></div>}
        </div>
      </div>

      {children /* <PunchDial/> */}
    </section>
  );
}

/* ── time & date format picker (popover) ─────────────────────────────────── */
function FormatPicker({ prefs, onPrefs, now }: { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; now: Date }) {
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
      <div className={'pop' + (open ? ' open' : '')} id="fmtPop" role="dialog" aria-label="Time and date format">
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
function ThemeButton({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void }) {
  const order: Prefs['theme'][] = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(prefs.theme) + 1) % 3];
  const Icon = prefs.theme === 'dark' ? Moon : prefs.theme === 'light' ? Sun : Auto;
  return (
    <button className="pillbtn" title={`Theme: ${prefs.theme}`} onClick={() => onPrefs({ theme: next })}>
      <Icon /> <span>{prefs.theme[0].toUpperCase() + prefs.theme.slice(1)}</span>
    </button>
  );
}
