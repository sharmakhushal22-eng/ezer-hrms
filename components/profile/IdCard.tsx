'use client';
import { authHeaders } from '@/lib/auth-headers';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { T } from '@/lib/profile/theme';

/**
 * Digital ID card with a live rotating QR.
 *
 * The code on screen is valid for 30 seconds and for exactly one scan.
 * We fetch a new one every 15 seconds so there is always overlap and the
 * guard never sees a dead code. Refresh pauses when the tab is hidden and
 * fires immediately when it comes back, so a phone in a pocket does not
 * burn through the rate limit.
 */

const REFRESH_MS = 15_000;

interface Props {
  name: string;
  code: string;
  designation: string;
  company: string;
  photoUrl?: string | null;
  initials: string;
  bloodGroup?: string | null;
  doj?: string | null;
  emergency?: string | null;
}

interface TokenState {
  token: string;
  url: string;
  expiresAt: number;
  ttl: number;
  cardNo: string;
  validTill: string | null;
  accessZones: string[];
}

export default function IdCard(p: Props) {
  const [flipped, setFlipped] = useState(false);
  const [tok, setTok] = useState<TokenState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchToken = useCallback(async () => {
    try {
      const r = await fetch('/api/ess/id-card/token', { cache: 'no-store', headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) { setErr(j.message ?? 'Could not generate a code.'); setTok(null); return; }
      setErr(null);
      setTok(j as TokenState);
    } catch {
      setErr('You are offline. The code needs a connection to stay valid.');
    }
  }, []);

  // rotation loop, paused while the tab is hidden
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') await fetchToken();
      timer.current = setTimeout(tick, REFRESH_MS);
    };
    tick();
    const onVis = () => { if (document.visibilityState === 'visible') fetchToken(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchToken]);

  // paint the QR whenever the token changes
  useEffect(() => {
    if (!tok || !canvas.current) return;
    QRCode.toCanvas(canvas.current, tok.url, {
      width: 168,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#0F172A', light: '#FFFFFF' },
    }).catch(() => setErr('Could not draw the code.'));
  }, [tok]);

  // countdown
  useEffect(() => {
    if (!tok) return;
    const id = setInterval(() => {
      setLeft(Math.max(0, Math.round((tok.expiresAt - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [tok]);

  const pct = tok ? Math.max(0, Math.min(1, left / tok.ttl)) : 0;
  const C = 2 * Math.PI * 15;

  return (
    <div className="ez-card" style={{ perspective: 1200 }}>
      <div style={{ padding: 13 }}>
        <div
          style={{
            position: 'relative', height: 232, transformStyle: 'preserve-3d',
            transition: `transform .8s ${T.ease}`,
            transform: flipped ? 'rotateY(180deg)' : 'none',
          }}
        >
          {/* ─── front ─── */}
          <div className="ez-idface">
            <div className="ez-idwm">EZER</div>
            <div className="ez-idtop">
              <span className="ez-idlogo">EZ</span>
              {p.company.toUpperCase()}
            </div>

            <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginTop: 13 }}>
              <div className="ez-idph">
                {p.photoUrl
                  ? <img src={p.photoUrl} alt="" />
                  : <span>{p.initials}</span>}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 11, opacity: .85 }}>{p.designation}</div>
              </div>
            </div>

            <div className="ez-idgrid">
              <div><span>Employee code</span><b>{p.code}</b></div>
              <div><span>Card no</span><b>{tok?.cardNo ?? '—'}</b></div>
              <div><span>Blood group</span><b>{p.bloodGroup ?? '—'}</b></div>
              <div><span>Valid till</span><b>{tok?.validTill ?? '—'}</b></div>
            </div>

            <button className="ez-idflip" onClick={() => setFlipped(true)}>
              Show scan code
            </button>
          </div>

          {/* ─── back: the live QR ─── */}
          <div className="ez-idface ez-idback">
            <div className="ez-idtop" style={{ justifyContent: 'space-between' }}>
              <span>SHOW THIS AT THE GATE</span>
              <span style={{ opacity: .7 }}>{p.code}</span>
            </div>

            <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginTop: 12 }}>
              <div className="ez-qrbox">
                {tok
                  ? <canvas ref={canvas} width={168} height={168} />
                  : <div className="ez-qrskel" />}
                {/* countdown ring sits on the corner of the code */}
                {tok && (
                  <svg className="ez-qrring" width="34" height="34" viewBox="0 0 34 34">
                    <circle cx="17" cy="17" r="15" fill="#fff" stroke="#E5E9EF" strokeWidth="3" />
                    <circle
                      cx="17" cy="17" r="15" fill="none"
                      stroke={left <= 8 ? T.warn : T.brand} strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
                      transform="rotate(-90 17 17)"
                      style={{ transition: 'stroke-dashoffset .25s linear' }}
                    />
                    <text x="17" y="21" textAnchor="middle" fontSize="11" fontWeight="700" fill={T.ink}>
                      {left}
                    </text>
                  </svg>
                )}
              </div>

              <div style={{ fontSize: 11, lineHeight: 1.6, opacity: .9 }}>
                {err
                  ? <span style={{ color: '#FCA5A5' }}>{err}</span>
                  : <>
                      This code changes every {REFRESH_MS / 1000} seconds and works
                      for <b>one scan only</b>.
                      <br /><br />
                      A screenshot or a forwarded photo of this code will not open the gate.
                      Every attempt is logged against your name.
                    </>}
              </div>
            </div>

            <div className="ez-idzones">
              {(tok?.accessZones ?? []).map(z => <span key={z}>{z}</span>)}
            </div>

            <button className="ez-idflip" onClick={() => setFlipped(false)}>
              Back to card
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
