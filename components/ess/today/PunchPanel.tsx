'use client';
// components/ess/today/PunchPanel.tsx — the hero's right side.
//
// Replaces PunchDial, which was one round button that toggled: it read "Punch
// in", became a running timer, and you tapped the same place to punch out. Two
// problems with that. The verb was invisible until you read the small print
// under it, and the dial showed how far through the shift the WALL CLOCK was,
// which is identical for everybody and says nothing about your own day.
//
// Now: a watch that gauges the day (see AnalogPunchWatch), and two separate
// buttons. Only one is ever live — Punch Out is locked until a session is
// open — so the wrong order cannot be clicked. The same rule is in canPunch(),
// in the handler, and in ess_punch() for the mobile and biometric paths.
//
// DELIBERATELY NOT HERE: the greeting, the date, the shift label and the
// location. HeroPanel's left column already shows all four, and the drop this
// design came from rendered its own copies — mounting it whole would have put
// "Good morning, Kiran" on the screen twice.
//
// PROPS ARE PunchDial'S, UNCHANGED, so Today.tsx keeps its own state in sync
// through the same onPunched callback.
import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '@/lib/auth-headers';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtClock } from '@/lib/today/format';
import {
  canPunch, dayFromToday, formatDuration, gradeIn, gradeOut, gradeWorked,
  punchState, shiftLengthMs, shiftProgress, toDate, type PunchKind,
} from '@/lib/today/punch';
import AnalogPunchWatch from './AnalogPunchWatch';
import { useReducedMotion } from './hooks';
import './punch-hero.css';

type Props = {
  data: TodayPayload;
  prefs: Prefs;
  onToast: (m: string) => void;
  onPunched: (kind: 'in' | 'out', at: Date) => void;
  /** Full-viewport confetti canvas, owned by Today so it sits OUTSIDE the
   *  container-query wrapper — a fixed element inside that wrapper anchors to
   *  the wrapper rather than to the screen. */
  confettiRef: React.RefObject<HTMLCanvasElement | null>;
};

const Tick = () => (
  <svg className="pz-tick" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const InIcon = () => (
  <svg className="pz-main" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
  </svg>
);
const OutIcon = () => (
  <svg className="pz-main" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default function PunchPanel({ data, prefs, onToast, onPunched, confettiRef }: Props) {
  const reduce = useReducedMotion();
  const hourFormat: 12 | 24 = prefs.time_format === '24' ? 24 : 12;

  // Seeded from the payload, then owned here so a punch paints immediately.
  // Both timestamps are kept: the old dial dropped inAt once you punched out,
  // which is fine for a toggle and useless for a dial that plots both.
  const [day, setDay] = useState(() => dayFromToday(data.today));
  const [busy, setBusy] = useState<PunchKind | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const inBtn = useRef<HTMLButtonElement>(null);

  // The payload is refetched by Today after other actions; follow it, unless a
  // punch of ours is in flight and would be overwritten by a stale read.
  const serverDay = `${data.today?.punch_in ?? ''}|${data.today?.punch_out ?? ''}`;
  useEffect(() => {
    if (lock.current) return;
    setDay(dayFromToday(data.today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDay]);

  const inAt = toDate(day.inAt);
  const outAt = toDate(day.outAt);
  const state = punchState(day);
  const targetMs = shiftLengthMs(data.shift.start, data.shift.end);
  const tagIn = gradeIn(inAt, data.shift.start);
  const tagOut = gradeOut(outAt, data.shift.end);

  // The live numbers are written to refs on a 1s interval rather than held in
  // state: this sits in the hero of the busiest page in the portal, and a
  // re-render a second would repaint every sibling card with it.
  const workedRef = useRef<HTMLElement | null>(null);
  const runRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const barWrapRef = useRef<HTMLDivElement | null>(null);
  const barTxRef = useRef<HTMLSpanElement | null>(null);
  const tagWorkRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const paint = () => {
      if (!inAt) {
        if (workedRef.current) workedRef.current.textContent = '00:00:00';
        if (runRef.current) runRef.current.textContent = '00:00:00';
        if (barRef.current) barRef.current.style.width = '0%';
        if (barTxRef.current) barTxRef.current.textContent = 'Shift progress 0%';
        if (tagWorkRef.current) { tagWorkRef.current.textContent = ''; tagWorkRef.current.removeAttribute('data-t'); }
        barWrapRef.current?.classList.remove('is-ot');
        return;
      }
      const ms = (outAt ?? new Date()).getTime() - inAt.getTime();
      const text = formatDuration(ms);
      if (workedRef.current) workedRef.current.textContent = text;
      if (runRef.current) runRef.current.textContent = text;

      const pc = shiftProgress(ms, targetMs);
      if (barRef.current) barRef.current.style.width = `${pc}%`;
      if (barTxRef.current) barTxRef.current.textContent = `Shift progress ${pc}%`;

      const tag = gradeWorked(ms, targetMs, !!outAt);
      barWrapRef.current?.classList.toggle('is-ot', tag?.tone === 'ot');
      if (tagWorkRef.current) {
        tagWorkRef.current.textContent = tag?.text ?? '';
        if (tag) tagWorkRef.current.setAttribute('data-t', tag.tone);
        else tagWorkRef.current.removeAttribute('data-t');
      }
    };
    paint();
    if (!inAt || outAt) return;      // frozen once the session closes
    const id = window.setInterval(paint, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inAt?.getTime(), outAt?.getTime(), targetMs]);

  const ripple = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (reduce) return;
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    const span = document.createElement('span');
    const d = Math.max(r.width, r.height) * 2.2;
    span.className = 'pz-rip';
    span.style.width = span.style.height = `${d}px`;
    span.style.left = `${e.clientX - r.left}px`;
    span.style.top = `${e.clientY - r.top}px`;
    btn.appendChild(span);
    window.setTimeout(() => span.remove(), 620);
  };

  function confetti() {
    const cv = confettiRef.current;
    if (!cv || reduce || !inBtn.current) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    const r = inBtn.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // Read from the stylesheet so the burst follows the theme like everything
    // else; the old dial had six hex literals inline for this.
    const css = getComputedStyle(cv.ownerDocument.documentElement);
    const cols = ['--pz-in', '--pz-arc-2', '--pz-arc-3', '--pz-out', '--ez-brand', '--pz-marker-halo']
      .map(v => css.getPropertyValue(v).trim())
      .filter(Boolean);
    if (!cols.length) return;
    const ps = Array.from({ length: 90 }, () => {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, s: 4 + Math.random() * 5, c: cols[Math.random() * cols.length | 0], rot: Math.random() * 6, vr: (Math.random() - .5) * .3 };
    });
    const t0 = performance.now();
    const frame = (nowT: number) => {
      const k = (nowT - t0) / 1300;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const q of ps) {
        q.x += q.vx; q.y += q.vy; q.vy += .22; q.vx *= .985; q.rot += q.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = q.c; ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * .6); ctx.restore();
      }
      if (k < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    requestAnimationFrame(frame);
  }

  const punch = useCallback(async (kind: PunchKind, e: React.MouseEvent<HTMLButtonElement>) => {
    if (lock.current || !canPunch(kind, day)) return;
    lock.current = true;
    setBusy(kind);
    setError('');
    ripple(e);

    const previous = day;
    // Painted before the round trip, and rolled back if it fails. The stamped
    // time comes from the server's reply, not from this clock.
    const optimistic = kind === 'IN'
      ? { inAt: new Date().toISOString(), outAt: null }
      : { ...day, outAt: new Date().toISOString() };
    setDay(optimistic);

    try {
      // The live route: lowercase kind, lat/lng, and an auth header. Geofence
      // and miss-punch rules live inside ess_punch(); its message is the toast.
      const res = await fetch('/api/ess/punch', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ kind: kind === 'IN' ? 'in' : 'out' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Punch could not be saved');

      const at = new Date(j.at);
      const saved = kind === 'IN'
        ? { inAt: at.toISOString(), outAt: null }
        : { ...previous, outAt: at.toISOString() };
      setDay(saved);

      if (kind === 'IN') {
        confetti();
        onToast(`Punched in at ${fmtClock(at, prefs.time_format)}`);
      } else {
        const ms = at.getTime() - (toDate(previous.inAt)?.getTime() ?? at.getTime());
        onToast(`Punched out · ${formatDuration(ms).slice(0, 5).replace(':', 'h ')}m logged`);
      }
      onPunched(kind === 'IN' ? 'in' : 'out', at);
    } catch (err) {
      setDay(previous);
      const message = err instanceof Error ? err.message : 'Punch could not be saved';
      setError(message);
      onToast(message);
    } finally {
      lock.current = false;
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, prefs.time_format, onPunched, onToast, reduce]);

  const statusText = state === 'IN' ? 'Session open — clock running'
    : state === 'DONE' ? 'Session closed · day complete'
    : 'Not punched in yet';

  const hint = error ? error
    : state === 'IDLE' ? 'Punch out unlocks once you punch in.'
    : state === 'IN' ? 'Punch out will close this session.'
    : 'Need a correction? Attendance → Regularise.';

  const targetLabel = `${Math.floor(targetMs / 3_600_000)}h ${String(Math.floor((targetMs % 3_600_000) / 60_000)).padStart(2, '0')}m target`;

  return (
    <div className="pz">
      {/* The controls sit to the LEFT of the watch: the thing you act on is
          reached before the thing you read. Source order puts them first too,
          so a keyboard and a screen reader meet the buttons before the dial. */}
      <div className="pz-controls">
      <div className="pz-status" data-s={state} role="status" aria-live="polite">
        <span className="pz-ring" /><span>{statusText}</span>
      </div>

      <div className="pz-actions">
        <div className={`pz-key${state === 'IDLE' ? ' is-ready' : ''}`}>
          <button ref={inBtn} type="button"
            className={`pz-btn pz-btn--in${inAt ? ' is-done' : ''}${state !== 'IDLE' ? ' is-locked' : ''}`}
            onClick={e => punch('IN', e)}
            disabled={state !== 'IDLE' || busy !== null}
            aria-label="Punch in and open today's session">
            <span className="pz-ic" aria-hidden="true"><InIcon /><Tick /></span>
            <span className="pz-lbl">
              <b>Punch In</b>
              <small>{inAt ? <><span className="pz-stamp">{fmtClock(inAt, prefs.time_format)}</span> · recorded</> : busy === 'IN' ? 'Saving…' : 'Start your day'}</small>
            </span>
          </button>
        </div>

        <div className={`pz-key${state === 'IN' ? ' is-ready' : ''}`}>
          <button type="button"
            className={`pz-btn pz-btn--out${outAt ? ' is-done' : ''}${state === 'DONE' ? ' is-locked' : ''}`}
            onClick={e => punch('OUT', e)}
            disabled={state !== 'IN' || busy !== null}
            aria-label={state === 'IN' ? 'Punch out and close the open session' : 'Punch out — unlocks after you punch in'}>
            <span className="pz-ic" aria-hidden="true"><OutIcon /><Tick /></span>
            <span className="pz-lbl">
              <b>Punch Out</b>
              <small>
                {outAt ? <><span className="pz-stamp">{fmtClock(outAt, prefs.time_format)}</span> · closed</>
                  : busy === 'OUT' ? 'Saving…' : state === 'IN' ? 'Ends this session' : 'Unlocks after punch in'}
              </small>
            </span>
            <span className="pz-run"><i /><span ref={runRef}>00:00:00</span></span>
          </button>
        </div>
      </div>

      <div className={`pz-hint${error ? ' pz-err' : ''}`}>{hint}</div>
      </div>

      <div className="pz-watchwrap">
        <AnalogPunchWatch
          inAt={inAt} outAt={outAt}
          shiftStart={data.shift.start} shiftEnd={data.shift.end}
          hourFormat={hourFormat}
        />
        <div className="pz-legend">
          <span><i className="pz-sin" />In</span>
          <span><i className="pz-sout" />Out</span>
          <span><i className="pz-sw" />Shift window</span>
        </div>
      </div>

      <div className="pz-foot">
      <div className="pz-ledger">
        <div className="pz-cell">
          <span>In time</span>
          <b>{inAt ? fmtClock(inAt, prefs.time_format) : '—'}</b>
          {tagIn ? <em className="pz-tag" data-t={tagIn.tone}>{tagIn.text}</em> : null}
        </div>
        <div className="pz-cell">
          <span>Out time</span>
          <b>{outAt ? fmtClock(outAt, prefs.time_format) : '—'}</b>
          {tagOut ? <em className="pz-tag" data-t={tagOut.tone}>{tagOut.text}</em> : null}
        </div>
        <div className="pz-cell">
          <span>Worked</span>
          <b ref={workedRef as React.RefObject<HTMLElement>}>00:00:00</b>
          <em className="pz-tag" ref={tagWorkRef as React.RefObject<HTMLElement>} />
        </div>
      </div>

      <div className="pz-bar" ref={barWrapRef}><i ref={barRef as React.RefObject<HTMLElement>} /></div>
      <div className="pz-barlbl">
        <span ref={barTxRef}>Shift progress 0%</span>
        <span>{targetLabel}</span>
      </div>

      </div>
    </div>
  );
}
