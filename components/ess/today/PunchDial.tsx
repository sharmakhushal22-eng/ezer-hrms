'use client';
import { authHeaders } from '@/lib/auth-headers';
// components/ess/today/PunchDial.tsx — the hero element: shift-progress ring, punch in/out
// button (→ POST /api/ess/punch → ess_punch()), running timer, on-time streak, confetti.
//
// This is the hero's original right side, restored: the analog punch watch and
// the separate Punch In / Punch Out buttons that replaced it were not liked.
// The one thing kept from that work is the streak chip stating a zero streak
// instead of vanishing — see streakText.
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
  // ONE object, not two independent dates. The old pair nulled inAt on punch
  // out, so `kind` recomputed as 'in' and the dial offered "Punch in again" on
  // a day that was already closed — a second session for the same day. Keeping
  // both timestamps means the state machine can tell IDLE from DONE.
  const [day, setDay] = useState(() => dayFromToday(data.today));
  const [elapsed, setElapsed] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  // A ref, not state: a disabled-looking button is the lag people feel. This
  // stops a double submit without changing anything on screen.
  const lock = useRef(false);

  const btn = useRef<HTMLButtonElement>(null);

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
    // Painted through a local function, as this file always did: a bare
    // setState in an effect body is a react-hooks error, and Date.now() in
    // render is an impure call, so the value has to be pushed from here.
    const paint = () => {
      if (!inMs) { setElapsed(0); return; }
      setElapsed(outMs ? outMs - inMs : Date.now() - inMs);
    };
    paint();
    if (!inMs || outMs) return;        // nothing left to count
    const id = setInterval(paint, 1000);
    return () => clearInterval(id);
  }, [inMs, outMs]);

  /**
   * One click, and the dial changes on that click.
   *
   * It used to await the round trip before anything moved, with the button
   * disabled meanwhile — so a slow network looked like a dead control and
   * people pressed again. Now the new state is painted immediately and the
   * request is reconciled afterwards: the stamp shown ends up being the
   * server's time, not this clock's, and a failure rolls the dial back.
   *
   * The toast still waits for the answer. Announcing "Punched in at 2:20 PM"
   * and then taking it back would be worse than a moment's silence.
   */
  async function punch() {
    const kind: PunchKind = state === 'IDLE' ? 'IN' : 'OUT';
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
    const cv = confettiRef.current; if (!cv || reduce || !btn.current) return;
    const ctx = cv.getContext('2d')!; cv.width = innerWidth; cv.height = innerHeight;
    const r = btn.current.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
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
        {/* Three states, not two. DONE is inert: the day is closed and a
            second punch-in would open a second session for it. It used to say
            "Punch in again" here, which invited exactly that.

            Nothing is disabled while a request is in flight — the dial has
            already moved, and greying it out is the lag people complain of.
            The guard is a ref inside punch(). */}
        <button
          ref={btn}
          className={'punch' + (state === 'IN' ? ' in' : '') + (state === 'DONE' ? ' done' : '')}
          onClick={punch}
          disabled={state === 'DONE'}
          aria-live="polite"
          aria-label={state === 'IDLE' ? 'Punch in and start your day'
            : state === 'IN' ? 'Punch out and close your day'
            : 'Your day is complete'}
        >
          {state === 'IDLE' ? <span>Punch in</span>
            : <span className="timer">{two(h)}:{two(m)}:{two(s)}</span>}
          <small>
            {state === 'IDLE' ? 'Tap to start your day'
              : state === 'IN' ? 'Tap to punch out'
              : 'Day complete'}
          </small>
        </button>
      </div>
      <div className="shift">
        {state === 'IN' ? <>Punched in at <b>{fmtClock(inAt!, prefs.time_format)}</b>{data.employee.location && <> · {data.employee.location}</>}</>
          : state === 'DONE' ? <><b>{fmtClock(inAt!, prefs.time_format)}</b> to <b>{fmtClock(outAt!, prefs.time_format)}</b></>
          : 'Not punched in yet'}
      </div>
      {/* Always rendered, including at 0. One late day zeroes the whole run
          (ess_attendance_streak), so 0 is ordinary rather than an edge case,
          and a chip that disappears on it reads as a broken panel. The wording
          points at today while today can still be earned. */}
      <div className={data.streak > 0 ? 'streak' : 'streak is-none'}>
        <span className="fl"><Flame width={16} height={16} /></span>
        {streakText(data.streak, !!data.today?.punch_in)}
      </div>
    </div>
  );
}
