'use client';
import { authHeaders } from '@/lib/auth-headers';

import { useCallback, useRef, useState } from 'react';

/** Crops to a real 512×512 JPEG on the client, then posts it. */
export default function PhotoUploader({
  open, onClose, onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(125);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const BOX = 184;

  const load = useCallback((f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErr('That file is not an image. Use JPG or PNG.');
    if (f.size > 8e6) return setErr('Image is over 8 MB. Compress it and try again.');
    setErr(null);
    const r = new FileReader();
    r.onload = () => { setSrc(String(r.result)); setPos({ x: 0, y: 0 }); setZoom(125); };
    r.readAsDataURL(f);
  }, []);

  const crop = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const el = img.current, st = stage.current;
      if (!el || !st) return reject(new Error('no image'));
      const S = 512, sc = zoom / 100, k = S / BOX;
      const r = st.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      const w = el.naturalWidth * sc, h = el.naturalHeight * sc;
      const left = cx + pos.x - w / 2, top = cy + pos.y - h / 2;

      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      g.drawImage(el, (left - (cx - BOX / 2)) * k, (top - (cy - BOX / 2)) * k, w * k, h * k);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('crop failed'))), 'image/jpeg', 0.9);
    });

  const save = async () => {
    if (!src) return setErr('Choose an image first.');
    try {
      setBusy(15);
      const blob = await crop();
      setBusy(45);
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/ess/profile/photo', { method: 'POST', body: fd, headers: await authHeaders() });
      const j = await res.json();
      setBusy(100);
      if (!res.ok) throw new Error(j.message ?? 'Upload failed.');
      onDone(j.url ?? URL.createObjectURL(blob));
      setTimeout(() => { setBusy(0); onClose(); }, 250);
    } catch (e: any) {
      setBusy(0); setErr(e.message ?? 'Upload failed.');
    }
  };

  if (!open) return null;

  return (
    <div className="ez-scrim ez-on" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ez-modal" style={{ maxWidth: 560 }}>
        <div className="ez-mh">
          <h3>Profile photo</h3>
          <p>Drop an image, drag to position, zoom to fit. Saved as a 512 by 512 square.</p>
        </div>
        <div className="ez-mb">
          <div
            ref={stage}
            className="ez-stage"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); load(e.dataTransfer.files?.[0]); }}
            onPointerDown={e => {
              if (!src) return;
              drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              if (!drag.current) return;
              setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
            }}
            onPointerUp={() => { drag.current = null; }}
          >
            {!src && (
              <span className="ez-subtle" style={{ textAlign: 'center', padding: '0 26px' }}>
                Drop an image here or{' '}
                <label className="ez-btn ez-sm" style={{ marginLeft: 4, display: 'inline-flex' }}>
                  choose a file
                  <input type="file" accept="image/*" hidden
                         onChange={e => load(e.target.files?.[0])} />
                </label>
              </span>
            )}
            {src && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={img} src={src} alt=""
                  style={{
                    position: 'absolute', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
                    transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom / 100})`,
                  }}
                />
                <div className="ez-cring" />
              </>
            )}
          </div>

          <input
            className="ez-slider" type="range" min={100} max={320} value={zoom}
            onChange={e => setZoom(+e.target.value)} aria-label="Zoom"
          />
          {busy > 0 && (
            <div className="ez-prog"><i style={{ width: `${busy}%` }} /></div>
          )}
          {err && <div className="ez-note ez-bad" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="ez-mf">
          <button className="ez-btn" onClick={onClose}>Cancel</button>
          <button className="ez-btn ez-pri" onClick={save} disabled={busy > 0}>
            {busy > 0 ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
