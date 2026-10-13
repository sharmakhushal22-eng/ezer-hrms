'use client';
import { authHeaders } from '@/lib/auth-headers';
// components/ess/today/PunchDial.tsx — the hero element: shift-progress ring with the day's
// status in its face, and two separate actions under it — PUNCH IN and PUNCH OUT (each →
// POST /api/ess/punch → ess_punch()) — running timer, on-time streak, confetti.
//
// Two buttons, not one toggle: a toggle makes the second tap of a nervous thumb a punch-out
// three seconds after the punch-in. Each action is its own button and only the one that
// applies is live; the other is dimmed with a line saying why.
//
// The day itself is the three-state session in lib/today/punch.ts:
//     IDLE --[in]--> IN (running) --[out]--> DONE (closed)
// DONE is inert — BOTH buttons rest. A second punch-in after a punch-out would open a
// second session for the same day, which is what "Punch in again" used to invite.
//
// The dial moves on the click, not on the server's answer: the new state is painted at
// once and reconciled afterwards (the stamp shown ends up being the server's time), and
// a failure rolls it back. Waiting for the round trip with the buttons greyed out looked
// like a dead control on a slow network, and people pressed again.
import { useEffect, useRef, useState } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtClock, two } from '@/lib/today/format';
import { canPunch, dayFromToday, punchState, streakText, toDate, type PunchKind } from '@/lib/today/punch';
import { Flame } from './icons';
import { useMounted, useNow, useReducedMotion } from './hooks';

const R = 101, C = 112;
type Props = {
  data: TodayPayload; prefs: Prefs;
  onToast: (m: string) => void;
  onPunched: (kind: 'in' | 'out', at: Date) => void;
  /** Full-viewport confetti canvas, owned by Today so it sits OUTSIDE the
   *  container-query wrapper — a fixed element inside that wrapper anchors to
   *  the wrapper rather than to the screen. */
  confettiRef: React.RefObject<HTMLCanvasElement | null>;
};
export default function PunchDial({ data, prefs, onToast, onPunched, confettiRef }: Props) {
  const reduce = useReducedMotion();
  const mounted = useMounted(350);
  const now = useNow(15000);
  // ONE object, not two independent dates: keeping both timestamps is what lets the
  // state machine tell IDLE from DONE.
  const [day, setDay] = useState(() => dayFromToday(data.today));
  const [elapsed, setElapsed] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  // A ref, not state: it stops a double submit without changing anything on screen.
  const lock = useRef(false);

  const inBtn = useRef<HTMLButtonElement>(null);

  const inAt = toDate(day.inAt);
  const outAt = toDate(day.outAt);
  const state = punchState(day);

  // Follow the server's answer when the parent refetches, unless a punch of
  // ours is in flight and would be overwritten by a stale read.
  const fromServer = `${data.today?.punch_in ?? ''}|${data.today?.punch_out ?? ''}`;
  useEffect(() => {
    if (lock.current) return;
    setDay(dayFromToday(data.today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromServer]);

  // shift progress ring
  const [sh, sm] = data.shift.start.split(':').map(Number), [eh, em] = data.shift.end.split(':').map(Number);
  const start = sh + sm / 60, end = eh + em / 60, t = now.getHours() + now.getMinutes() / 60;
  const p = mounted ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 0;
  const ang = p * Math.PI * 2;

  // The timer runs only while the session is open. Once it closes it freezes
  // on the total rather than carrying on counting the evening.
  const inMs = inAt?.getTime() ?? 0;
  const outMs = outAt?.getTime() ?? 0;
  useEffect(() => {
    const paint = () => {
      if (!inMs) { setElapsed(0); return; }
      setElapsed(Math.max(0, outMs ? outMs - inMs : Date.now() - inMs));
    };
    paint();
    if (!inMs || outMs) return;        // nothing left to count
    const id = setInterval(paint, 1000);
    return () => clearInterval(id);
  }, [inMs, outMs]);

  async function punch(kind: PunchKind) {
    // Belt and braces — the buttons are disabled in these states already.
    if (lock.current || !canPunch(kind, day)) return;
    lock.current = true;

    const previous = day;
    const guess = new Date();
    setDay(kind === 'IN'
      ? { inAt: guess.toISOString(), outAt: null }
      : { ...previous, outAt: guess.toISOString() });
    if (kind === 'IN') { setPulseKey(k => k + 1); confetti(); }

    try {
      const res = await fetch('/api/ess/punch', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ kind: kind === 'IN' ? 'in' : 'out' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Punch failed');
      const at = new Date(j.at);
      setDay(kind === 'IN'
        ? { inAt: at.toISOString(), outAt: null }
        : { ...previous, outAt: at.toISOString() });
      if (kind === 'IN') onToast(`Punched in at ${fmtClock(at, prefs.time_format)}`);
      else {
        const ms = at.getTime() - (toDate(previous.inAt)?.getTime() ?? at.getTime());
        onToast(`Punched out · ${Math.floor(ms / 3.6e6)}h ${two(Math.floor(ms / 6e4) % 60)}m logged`);
      }
      onPunched(kind === 'IN' ? 'in' : 'out', at);
    } catch (err) {
      setDay(previous);
      onToast((err as Error).message);
    } finally {
      lock.current = false;
    }
  }

  function confetti() {
    const cv = confettiRef.current; if (!cv || reduce || !inBtn.current) return;
    const ctx = cv.getContext('2d')!; cv.width = innerWidth; cv.height = innerHeight;
    const r = inBtn.current.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = ['#2563EB', '#60A5FA', '#7DD3FC', '#34D399', '#FCD34D', '#FFFFFF'];
    const ps = Array.from({ length: 90 }, () => { const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, s: 4 + Math.random() * 5, c: cols[Math.random() * cols.length | 0], rot: Math.random() * 6, vr: (Math.random() - .5) * .3 }; });
    const t0 = performance.now();
    const frame = (nowT: number) => {
      const k = (nowT - t0) / 1300; ctx.clearRect(0, 0, cv.width, cv.height);
      for (const q of ps) { q.x += q.vx; q.y += q.vy; q.vy += .22; q.vx *= .985; q.rot += q.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillStyle = q.c; ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * .6); ctx.restore(); }
      if (k < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    requestAnimationFrame(frame);
  }

  const h = Math.floor(elapsed / 3.6e6), m = Math.floor(elapsed / 6e4) % 60, s = Math.floor(elapsed / 1e3) % 60;
  const ticks = Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * Math.PI * 2; return <line key={i} className="tick" x1={C + Math.cos(a) * (R - 12)} y1={C + Math.sin(a) * (R - 12)} x2={C + Math.cos(a) * (R - 16)} y2={C + Math.sin(a) * (R - 16)} />; });

  return (
    <div className="dialwrap">
      <div className="dial">
        <svg viewBox="0 0 224 224" aria-hidden="true">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#7DD3FC" /></linearGradient></defs>
          <circle className="track" cx={C} cy={C} r={R} />
          <circle className="prog" pathLength={1} cx={C} cy={C} r={R} style={{ strokeDashoffset: 1 - p }} />
          <g>{ticks}</g>
          <circle className="cap" r={6} cx={C + Math.cos(ang) * R} cy={C + Math.sin(ang) * R} />
        </svg>
        <div className="halo" />
        {pulseKey > 0 && <div key={pulseKey} className="pulse go" />}
        {/* The face of the dial: the day's state, never a button. */}
        <div className={'face' + (state === 'IN' ? ' in' : state === 'DONE' ? ' done' : '')} aria-live="polite">
          {state === 'IN' ? <>
            <span className="eyebrow"><i className="dot" />Working</span>
            <span className="timer">{two(h)}:{two(m)}:{two(s)}</span>
            <small>since {fmtClock(inAt!, prefs.time_format)}</small>
          </> : state === 'DONE' ? <>
            <span className="eyebrow">Day done</span>
            <span className="timer">{h}h {two(m)}m</span>
            <small>out at {fmtClock(outAt!, prefs.time_format)}</small>
          </> : <>
            <span className="eyebrow">Not punched in</span>
            <span className="big">{fmtClock(now, prefs.time_format)}</span>
            <small>shift {data.shift.start}–{data.shift.end}</small>
          </>}
        </div>
      </div>
      {/* Two actions, each its own button. Only the one that applies is live; on a closed
          day neither is. Nothing is disabled merely because a request is in flight — the
          dial has already moved, and the guard is the ref inside punch(). */}
      <div className="punchbar" role="group" aria-label="Punch">
        <button ref={inBtn} type="button" className="pbtn in" onClick={() => punch('IN')} disabled={state !== 'IDLE'}
          title={state === 'IN' ? `Already punched in at ${fmtClock(inAt!, prefs.time_format)}` : state === 'DONE' ? 'Your day is complete' : 'Start your day'}>
          <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></svg></span>
          <span className="lbl"><b>Punch in</b><small>{state === 'IN' ? `in since ${fmtClock(inAt!, prefs.time_format)}` : state === 'DONE' ? 'day complete' : 'start your day'}</small></span>
        </button>
        <button type="button" className="pbtn out" onClick={() => punch('OUT')} disabled={state !== 'IN'}
          title={state === 'IN' ? 'End your day' : state === 'DONE' ? `Punched out at ${fmtClock(outAt!, prefs.time_format)}` : 'Punch in first'}>
          <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 17l5-5-5-5" /><path d="M19 12H7" /><path d="M3 3v18" /></svg></span>
          <span className="lbl"><b>Punch out</b><small>{state === 'IN' ? 'end your day' : state === 'DONE' ? `out at ${fmtClock(outAt!, prefs.time_format)}` : 'punch in first'}</small></span>
        </button>
      </div>
      <div className="shift">
        {state === 'IN' ? <>Punched in at <b>{fmtClock(inAt!, prefs.time_format)}</b>{data.employee.location && <> · {data.employee.location}</>}</>
          : state === 'DONE' ? <><b>{fmtClock(inAt!, prefs.time_format)}</b> to <b>{fmtClock(outAt!, prefs.time_format)}</b></>
          : 'Not punched in yet'}
      </div>
      {/* Always rendered, including at 0: one late day zeroes the whole run, so 0 is
          ordinary, and a chip that disappears on it reads as a broken panel. */}
      <div className={data.streak > 0 ? 'streak' : 'streak is-none'}>
        <span className="fl"><Flame width={16} height={16} /></span>
        {streakText(data.streak, !!data.today?.punch_in)}
      </div>
    </div>
  );
}
