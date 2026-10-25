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
// WHICH ONE IS LIVE IS THE SERVER'S ANSWER, NOT THIS COMPONENT'S MEMORY. The dial used to
// copy data.today into its own state once, on mount. Anything that brought it back with
// stale data — a cached /api/ess/today, the UTC "today" in the RPC — offered Punch In again
// after a punch. It now reads data.today (owned by Today, refreshed whenever the tab comes
// back into view) and the server refuses a second IN outright; a refusal hands back the
// real state, which replaces the stale one.
import { useEffect, useRef, useState } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtClock, two } from '@/lib/today/format';
import { Flame } from './icons';
import { useMounted, useNow, useReducedMotion } from './hooks';

const R = 101, C = 112;
type Props = {
  data: TodayPayload; prefs: Prefs;
  onToast: (m: string) => void;
  onPunched: (kind: 'in' | 'out', at: Date) => void;
  /** The server's punch state after any punch attempt — success or refusal. */
  onState: (state: PunchStateLite) => void;
  /** Full-viewport confetti canvas, owned by Today so it sits OUTSIDE the
   *  container-query wrapper — a fixed element inside that wrapper anchors to
   *  the wrapper rather than to the screen. */
  confettiRef: React.RefObject<HTMLCanvasElement | null>;
};
/** The subset of lib/attendance/punch.ts PunchState this screen uses. */
export interface PunchStateLite { open: boolean; first_in: string | null; last_in: string | null; last_out: string | null }

export default function PunchDial({ data, prefs, onToast, onPunched, onState, confettiRef }: Props) {
  const reduce = useReducedMotion();
  const mounted = useMounted(350);
  const now = useNow(15000);
  // Derived from data.today every render. `open` is authoritative when present; an
  // older payload without it falls back to "an IN and no OUT".
  const t0 = data.today;
  const isOpen = t0?.open ?? !!(t0?.punch_in && !t0?.punch_out);
  const inAt = isOpen && t0?.punch_in ? new Date(t0.punch_in) : null;
  const outAt = !isOpen && t0?.punch_out ? new Date(t0.punch_out) : null;
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);

  const inBtn = useRef<HTMLButtonElement>(null);

  // shift progress ring
  const [sh, sm] = data.shift.start.split(':').map(Number), [eh, em] = data.shift.end.split(':').map(Number);
  const start = sh + sm / 60, end = eh + em / 60, t = now.getHours() + now.getMinutes() / 60;
  const p = mounted ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 0;
  const ang = p * Math.PI * 2;

  // running timer while punched in
  const inMs = inAt ? inAt.getTime() : null;
  useEffect(() => {
    if (inMs == null) return;
    const tick = () => setElapsed(Date.now() - inMs);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [inMs]);

  async function punch(kind: 'in' | 'out') {
    if (busy) return;
    // Belt and braces — the buttons are disabled in these states already.
    if (kind === 'in' && inAt) { onToast('You are already punched in'); return; }
    if (kind === 'out' && !inAt) { onToast('Punch in first'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/ess/punch', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ kind }), cache: 'no-store' });
      const j = await res.json();
      // A refusal (already in / nothing to close) carries the real state: adopt it,
      // so the right button is live without a reload.
      if (j.state) onState(j.state as PunchStateLite);
      if (!res.ok) throw new Error(j.error || 'Punch failed');
      const at = new Date(j.at);
      if (kind === 'in') { setPulseKey(k => k + 1); confetti(); onToast(`Punched in at ${fmtClock(at, prefs.time_format)}`); }
      else { const ms = at.getTime() - inAt!.getTime(); onToast(`Punched out · ${Math.floor(ms / 3.6e6)}h ${two(Math.floor(ms / 6e4) % 60)}m logged`); }
      onPunched(kind, at);
    } catch (err) { onToast((err as Error).message); } finally { setBusy(false); }
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
          {/* The ring's two stops follow the hero's theme (today.css --ring-a/--ring-b):
              white→sky on the dark navy hero, blue→sky on the light one, where a white
              ring would vanish. */}
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--ring-a)' }} /><stop offset="1" style={{ stopColor: 'var(--ring-b)' }} /></linearGradient></defs>
          <circle className="track" cx={C} cy={C} r={R} />
          <circle className="prog" pathLength={1} cx={C} cy={C} r={R} style={{ strokeDashoffset: 1 - p }} />
          <g>{ticks}</g>
          <circle className="cap" r={6} cx={C + Math.cos(ang) * R} cy={C + Math.sin(ang) * R} />
        </svg>
        <div className="halo" />
        {pulseKey > 0 && <div key={pulseKey} className="pulse go" />}
        {/* The face of the dial: the day's state, never a button. */}
        <div className={'face' + (inAt ? ' in' : outAt ? ' done' : '')} aria-live="polite">
          {inAt ? <>
            <span className="eyebrow"><i className="dot" />Working</span>
            <span className="timer">{two(h)}:{two(m)}:{two(s)}</span>
            <small>since {fmtClock(inAt, prefs.time_format)}</small>
          </> : outAt ? <>
            <span className="eyebrow">Day done</span>
            <span className="timer">{data.today?.punch_in ? (() => { const ms = outAt.getTime() - new Date(data.today.punch_in).getTime(); return `${Math.floor(ms / 3.6e6)}h ${two(Math.floor(ms / 6e4) % 60)}m`; })() : '-'}</span>
            <small>out at {fmtClock(outAt, prefs.time_format)}</small>
          </> : <>
            <span className="eyebrow">Not punched in</span>
            <span className="big">{fmtClock(now, prefs.time_format)}</span>
            <small>shift {data.shift.start}–{data.shift.end}</small>
          </>}
        </div>
      </div>
      {/* Two actions, each its own button. Only the one that applies is live. */}
      <div className="punchbar" role="group" aria-label="Punch">
        <button ref={inBtn} type="button" className="pbtn in" onClick={() => punch('in')} disabled={busy || !!inAt}
          title={inAt ? `Already punched in at ${fmtClock(inAt, prefs.time_format)}` : outAt ? 'Punch in again' : 'Start your day'}>
          <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></svg></span>
          <span className="lbl"><b>Punch in</b><small>{inAt ? `in since ${fmtClock(inAt, prefs.time_format)}` : outAt ? 'start again' : 'start your day'}</small></span>
        </button>
        <button type="button" className="pbtn out" onClick={() => punch('out')} disabled={busy || !inAt}
          title={inAt ? 'End your day' : 'Punch in first'}>
          <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 17l5-5-5-5" /><path d="M19 12H7" /><path d="M3 3v18" /></svg></span>
          <span className="lbl"><b>Punch out</b><small>{inAt ? 'end your day' : outAt ? `out at ${fmtClock(outAt, prefs.time_format)}` : 'punch in first'}</small></span>
        </button>
      </div>
      <div className="shift">
        {inAt ? <>Punched in at <b>{fmtClock(inAt, prefs.time_format)}</b>{data.employee.location && <> · {data.employee.location}</>}</>
          : outAt ? <>Punched out at <b>{fmtClock(outAt, prefs.time_format)}</b></>
          : 'Not punched in yet'}
      </div>
      {data.streak > 0 && <div className="streak"><span className="fl"><Flame width={16} height={16} /></span>{data.streak}-day on-time streak</div>}
    </div>
  );
}
