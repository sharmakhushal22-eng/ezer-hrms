'use client';
import { uploadAuthHeaders } from '@/lib/auth-headers';
import {
  rotatedCover, clampPan, anchoredPan, exportTransform, workScale, rad as toRad,
  type Pt,
} from '@/lib/profile/crop-math';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Crops to a real square JPEG on the client, then posts it.
 *
 *  PAN, PINCH, WHEEL, ROTATE, STRAIGHTEN, FLIP. The frame stays square
 *  because the output feeds a square avatar and the ID card's photo box —
 *  an aspect preset would produce an image neither can use — but everything
 *  inside the square is yours to move.
 *
 *  FIT, NOT NATURAL SIZE. This used to scale the image by `zoom / 100` of its
 *  NATURAL size with no fit step, so a 4000px phone photo opened showing a
 *  147-pixel sliver of itself inside the stage — and the slider stopped at
 *  100%, so you could not zoom out to find your own face. Zoom is now a
 *  multiplier on a cover fit: 100% means "fills the frame", at any rotation.
 *
 *  ZOOM (the browser kind). UiScale sets CSS `zoom` on <html> (1.25 at
 *  1440px), and getBoundingClientRect() reports ZOOMED pixels while CSS
 *  lengths and the element's transform do not. Mixing the two threw the saved
 *  crop about 64px off — you dragged a face into the circle and got its ear.
 *  Every zoomed value is divided by docZoom() at the boundary it enters:
 *  the stage rect and the pointer. */
const docZoom = () =>
  parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1

/** Said when the bytes are not an image anything here can draw — after the
 *  server has had its turn too, so this now means genuinely broken. */
const UNREADABLE =
  'That image could not be opened. Try a JPG or PNG.'

/** Is this an ISO-BMFF still image — HEIC, HEIF, or their AVIF cousin?
 *
 *  Sniffed from the BYTES, never from file.type. iOS reports HEIC
 *  inconsistently: sometimes image/heic, sometimes an empty string when the
 *  file came through a share sheet or a sync folder, and a type-based test
 *  misses exactly the cases that need this most. */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif'])

async function isHeif(f: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await f.slice(0, 12).arrayBuffer())
    if (head.length < 12) return false
    if (String.fromCharCode(...head.subarray(4, 8)) !== 'ftyp') return false
    return BRANDS.has(String.fromCharCode(...head.subarray(8, 12)).toLowerCase())
  } catch { return false }
}

/** Decode HEIC in the browser, with libheif compiled to WebAssembly.
 *
 *  THE SERVER CANNOT DO THIS, which is worth writing down because it looks
 *  like it should. sharp is installed and reads the HEIC container happily —
 *  metadata() answers "heif 600x400" and looks like success. It is not a
 *  decode. Ask it for pixels and libvips says the compression format was not
 *  built in: HEIC pixels are H.265, the decoder is patent-encumbered, and no
 *  stock libvips ships one. Neither does any browser except Safari.
 *
 *  IMPORTED DYNAMICALLY, AND ONLY HERE. The bundle is 1.35 MB. Loading it up
 *  front would charge every person who opens their profile for a format most
 *  will never upload; inside this branch only somebody who actually picked a
 *  HEIC pays, once, while a progress bar is already running. */
async function decodeHeic(f: File): Promise<Blob> {
  const heic2any = (await import('heic2any')).default
  // A HEIC can legally hold a burst or a Live Photo, i.e. several images.
  // The first is the one the phone shows as the picture.
  const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(out) ? out[0] : out
}

/** An object URL, not a data URL. readAsDataURL base64-encodes the whole file
 *  into a JavaScript string — a 33% blow-up held in memory on top of the file
 *  and the decoded bitmap. An object URL is a pointer to the blob the browser
 *  already has. */
const blobUrl = (b: Blob): string => URL.createObjectURL(b)

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise(resolve => {
    const probe = new Image()
    probe.onload = () => resolve(probe.naturalWidth && probe.naturalHeight ? probe : null)
    probe.onerror = () => resolve(null)
    probe.src = url
  })

/** BYTES. Was 8 MB, which quietly made PNG a second-class format: PNG is
 *  lossless, so a plain screenshot clears 8 MB without being a large picture
 *  in any sense that matters. Nothing downstream cares — the crop leaves here
 *  as a square JPEG of about 120 KB whatever arrives. */
const MAX_BYTES = 40 * 1024 * 1024

/** PIXELS, which is the limit that actually protects anything. Bytes say
 *  nothing about decode cost: a 2 MB PNG can be 100 megapixels and ask for
 *  400 MB of bitmap. 60 MP passes any phone or camera made. */
const MAX_PIXELS = 60_000_000

/** Exported square. 512 was thin for the ID card, which draws the photo far
 *  larger than the 74px avatar does; 768 costs about 120 KB at q0.92 and
 *  stays well inside the route's 2 MB ceiling. */
const OUT = 768

const MAX_ZOOM = 500          // per cent of the fit
const MAX_STRAIGHT = 45       // degrees either way, as on a phone

export default function PhotoUploader({
  open, onClose, onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);          // per cent of the fit
  const [quarter, setQuarter] = useState(0);      // 90-degree steps
  const [straight, setStraight] = useState(0);    // fine angle, degrees
  const [flip, setFlip] = useState(false);
  const [live, setLive] = useState(false);        // an interaction is in flight
  const [busy, setBusy] = useState(0);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const img = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  /** Interaction state lives in refs, not React state.
   *
   *  setPos used to run on every pointermove, re-rendering the whole modal per
   *  event while the browser composited a multi-megapixel image. That is the
   *  lag. The transform is now written straight to the node inside a rAF: one
   *  style write per frame, and React does no work at all during a drag. */
  const pan = useRef<Pt>({ x: 0, y: 0 });
  const eff = useRef(1);
  const fit = useRef(1);
  const ang = useRef(0);                          // total degrees
  const nat = useRef({ w: 0, h: 0 });
  const box = useRef(260);                        // measured; CSS owns it
  const frame = useRef<number | null>(null);

  /** Live pointers, by id. Two of them is a pinch. */
  const pts = useRef(new Map<number, Pt>());
  const dragFrom = useRef<Pt | null>(null);
  const pinch = useRef<{ dist: number; eff: number; pan: Pt } | null>(null);

  const paint = useCallback(() => {
    frame.current = null;
    const el = img.current;
    if (!el) return;
    const sx = eff.current * (flip ? -1 : 1);
    el.style.transform =
      `translate(${pan.current.x}px, ${pan.current.y}px) rotate(${ang.current}deg) scale(${sx}, ${eff.current})`;
  }, [flip]);

  const schedule = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  /** Recompute the derived geometry whenever anything React knows changes.
   *
   *  LAYOUT effect, not a plain one: a plain effect runs AFTER the browser has
   *  painted, so a freshly mounted image would show for one frame at its
   *  natural size — several thousand pixels bursting out of the stage. This
   *  lands the transform before that paint.
   *
   *  `fit` is a ref rather than state deliberately: it is derived from the
   *  image, the angle and the measured stage, so making it state would mean
   *  calling setState from inside this effect and cascading a second render
   *  on every drag-adjacent change. */
  useLayoutEffect(() => {
    const st = stage.current;
    // clientWidth, NOT getBoundingClientRect(). The stage carries a 1px dashed
    // border and is not border-box, so the rect measures 262 where the crop
    // area — and the ring's 130px mask radius — are 260. Measuring the rect
    // made the export cover 262 stage pixels of picture while the ring
    // promised 260: a 0.8% lie, the same species as the 39% one this ring used
    // to tell, and caught by rendering it rather than by reading it.
    // clientWidth is a CSS length, so it is also already unzoomed.
    if (st && st.clientWidth) box.current = st.clientWidth;
    ang.current = quarter * 90 + straight;
    fit.current = rotatedCover(nat.current.w, nat.current.h, box.current, toRad(ang.current));
    eff.current = fit.current * zoom / 100;
    pan.current = clampPan(pan.current, nat.current.w, nat.current.h, eff.current, toRad(ang.current), box.current);
    paint();
  }, [zoom, quarter, straight, flip, src, paint]);

  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  /** The object URL currently on screen, so it can be revoked when replaced.
   *  Without this every re-pick leaks the previous blob for the tab's life. */
  const objUrl = useRef<string | null>(null);
  const show = useCallback((url: string) => {
    if (objUrl.current && objUrl.current !== url) URL.revokeObjectURL(objUrl.current);
    objUrl.current = url;
    setSrc(url);
  }, []);
  useEffect(() => () => { if (objUrl.current) URL.revokeObjectURL(objUrl.current); }, []);

  /* STARTING CLEAN IS THE CALLER'S JOB, and that is deliberate.
   *
   * Profile360 used to render this component permanently and only toggle
   * `open`, so nothing here ever unmounted and the state survived being
   * closed. After one upload the modal reopened still holding the previous
   * picture — and since the file input only existed while there was no image,
   * there was then no way to choose a different one. That is the "cannot
   * upload a new picture" report: not a failed upload, a cropper you could not
   * get a second photo into.
   *
   * It is now mounted only while open, so every open is a fresh component.
   * Resetting by hand in an effect would work too, but it means remembering to
   * clear each new piece of state forever. Unmounting cannot be forgotten. */

  /** Stage-centre coordinates, in CSS pixels, from a client point. */
  const local = useCallback((cx: number, cy: number): Pt => {
    const st = stage.current;
    if (!st) return { x: 0, y: 0 };
    const z = docZoom();
    const r = st.getBoundingClientRect();
    return { x: (cx - r.left) / z - box.current / 2, y: (cy - r.top) / z - box.current / 2 };
  }, []);

  /** Apply a new scale about an anchor, clamped, and repaint. Shared by the
   *  wheel, the pinch and the double-click, so all three feel identical. */
  const zoomTo = useCallback((next: number, anchor: Pt) => {
    const lo = fit.current, hi = fit.current * MAX_ZOOM / 100;
    const to = Math.min(hi, Math.max(lo, next));
    pan.current = clampPan(
      anchoredPan(pan.current, anchor, eff.current, to),
      nat.current.w, nat.current.h, to, toRad(ang.current), box.current,
    );
    eff.current = to;
    setZoom(to / fit.current * 100);
    schedule();
  }, [schedule]);

  /** Wheel and trackpad pinch.
   *
   *  Bound by hand rather than with onWheel because React's wheel listener is
   *  passive, and a passive listener may not preventDefault — so the page
   *  would scroll behind the modal while you tried to zoom. */
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const onWheel = (e: WheelEvent) => {
      if (!nat.current.w) return;
      e.preventDefault();
      // ctrlKey is how a trackpad pinch arrives; it deserves a firmer ratio.
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomTo(eff.current * k, local(e.clientX, e.clientY));
    };
    st.addEventListener('wheel', onWheel, { passive: false });
    return () => st.removeEventListener('wheel', onWheel);
  }, [src, zoomTo, local]);

  const onDown = (e: React.PointerEvent) => {
    if (!src) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setLive(true);
    if (pts.current.size === 1) {
      const p = local(e.clientX, e.clientY);
      dragFrom.current = { x: p.x - pan.current.x, y: p.y - pan.current.y };
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        eff: eff.current,
        pan: { ...pan.current },
      };
      dragFrom.current = null;
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.current.size >= 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      // Anchored on the midpoint from the pinch's OWN starting scale and pan,
      // so the gesture stays reversible: pinch out and back in and the picture
      // returns to where it was, instead of drifting a little each frame.
      const to = Math.min(fit.current * MAX_ZOOM / 100,
        Math.max(fit.current, pinch.current.eff * (dist / pinch.current.dist)));
      pan.current = clampPan(
        anchoredPan(pinch.current.pan, mid, pinch.current.eff, to),
        nat.current.w, nat.current.h, to, toRad(ang.current), box.current,
      );
      eff.current = to;
      setZoom(to / fit.current * 100);
      schedule();
      return;
    }

    if (!dragFrom.current) return;
    const p = local(e.clientX, e.clientY);
    pan.current = clampPan(
      { x: p.x - dragFrom.current.x, y: p.y - dragFrom.current.y },
      nat.current.w, nat.current.h, eff.current, toRad(ang.current), box.current,
    );
    schedule();
  };

  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (pts.current.size === 1) {
      // A finger lifted mid-pinch: re-anchor the drag to the one still down,
      // or the picture jumps by the difference on the next move.
      const [only] = [...pts.current.values()];
      const p = local(only.x, only.y);
      dragFrom.current = { x: p.x - pan.current.x, y: p.y - pan.current.y };
    }
    if (pts.current.size === 0) { dragFrom.current = null; setLive(false); }
  };

  const reset = () => {
    pan.current = { x: 0, y: 0 };
    setQuarter(0); setStraight(0); setFlip(false); setZoom(100);
  };

  const load = useCallback((f?: File | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      return setErr(`That image is ${(f.size / 1048576).toFixed(0)} MB, over the ${MAX_BYTES / 1048576} MB limit.`);
    }
    setErr(null); setReady(false); setSrc(null);

    void (async () => {
      try {
        const heif = await isHeif(f);
        // The type check allows through anything the BYTES say is a still
        // image, because iOS often reports no type at all for a HEIC.
        if (!heif && !f.type.startsWith('image/')) {
          setErr('That file is not an image. Use JPG or PNG.'); return;
        }

        setBusy(heif ? 10 : 8);

        // Try the browser first, even for HEIC — Safari decodes it natively,
        // and a local decode beats loading a megabyte of WebAssembly.
        let url = blobUrl(f);
        let el = await loadImage(url);

        if (!el) {
          URL.revokeObjectURL(url);
          if (!heif) { setErr(UNREADABLE); setBusy(0); return; }
          setBusy(35);
          url = blobUrl(await decodeHeic(f));
          el = await loadImage(url);
          if (!el) { URL.revokeObjectURL(url); setErr(UNREADABLE); setBusy(0); return; }
        }

        let w = el.naturalWidth, h = el.naturalHeight;
        if (w * h > MAX_PIXELS) {
          URL.revokeObjectURL(url);
          setErr(`That image is ${w}x${h}, too large to crop in the browser. Scale it down and try again.`);
          setBusy(0); return;
        }

        // Downscale once, up front. Nothing needs a 48-megapixel bitmap live
        // in the DOM to pick a square out of it, and this is most of the
        // reason the drag used to judder.
        const s = workScale(w, h);
        if (s < 1) {
          setBusy(60);
          const cw = Math.round(w * s), ch = Math.round(h * s);
          const c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          const g = c.getContext('2d')!;
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
          g.drawImage(el, 0, 0, cw, ch);
          const small = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.95));
          if (small) {
            URL.revokeObjectURL(url);
            url = blobUrl(small);
            const re = await loadImage(url);
            if (re) { w = re.naturalWidth; h = re.naturalHeight; }
          }
        }

        nat.current = { w, h };
        pan.current = { x: 0, y: 0 };
        setQuarter(0); setStraight(0); setFlip(false); setZoom(100);
        show(url); setReady(true); setBusy(0);
      } catch (e: unknown) {
        setBusy(0);
        setErr(e instanceof Error ? e.message : UNREADABLE);
      }
    })();
  }, [show]);

  /** Re-picking the SAME file must work. A file input fires no change event
   *  when you choose the path it already holds, so the value is cleared after
   *  every pick — otherwise "choose the photo, cancel, choose it again" is a
   *  dead button. */
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    load(f);
  };

  const crop = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const el = img.current;
      if (!el) return reject(new Error('no image'));
      if (!el.complete || !el.naturalWidth) return reject(new Error(UNREADABLE));

      const x = exportTransform(pan.current, eff.current, box.current, OUT);
      const c = document.createElement('canvas');
      c.width = c.height = OUT;
      const g = c.getContext('2d')!;
      // Default smoothing quality is 'low', a box filter — it is why a
      // downscaled photo came out mushy even when the geometry was right.
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.fillStyle = '#fff'; g.fillRect(0, 0, OUT, OUT);
      // The same order the CSS transform uses: translate, rotate, scale.
      g.translate(x.tx, x.ty);
      g.rotate(toRad(ang.current));
      g.scale(x.scale * (flip ? -1 : 1), x.scale);
      g.drawImage(el, -el.naturalWidth / 2, -el.naturalHeight / 2, el.naturalWidth, el.naturalHeight);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('crop failed'))), 'image/jpeg', 0.92);
    });

  const save = async () => {
    if (!src) return setErr('Choose an image first.');
    try {
      setBusy(15);
      const blob = await crop();
      setBusy(45);
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      // uploadAuthHeaders, not authHeaders: the latter sets
      // Content-Type: application/json, which on a FormData body suppresses
      // the multipart boundary. The route's req.formData() then cannot parse,
      // Next returns an empty 500, and res.json() failed with "Unexpected end
      // of JSON input" — so the upload never once worked from this screen,
      // while the same POST by curl did.
      const res = await fetch('/api/ess/profile/photo', { method: 'POST', body: fd, headers: await uploadAuthHeaders() });
      const j = await res.json().catch(() => ({} as Record<string, string>));
      setBusy(100);
      if (!res.ok) throw new Error(j.message ?? j.error ?? `Upload failed (${res.status}).`);
      onDone(j.url ?? URL.createObjectURL(blob));
      setTimeout(() => { setBusy(0); onClose(); }, 250);
    } catch (e: unknown) {
      setBusy(0); setErr(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  if (!open) return null;

  const turn = (d: number) => { setQuarter(q => (q + d + 4) % 4); };

  return (
    <div className="ez-scrim ez-on" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ez-modal" style={{ maxWidth: 560 }}>
        <div className="ez-mh">
          <h3>Profile photo</h3>
          <p>Drag to move, pinch or scroll to zoom, double-click to fill. Saved as a {OUT} by {OUT} square.</p>
        </div>
        <div className="ez-mb">
          <div
            ref={stage}
            className={'ez-stage' + (live ? ' ez-live' : '')}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); load(e.dataTransfer.files?.[0]); }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={e => {
              if (!src) return;
              const anchor = local(e.clientX, e.clientY);
              const filled = eff.current > fit.current * 1.6;
              zoomTo(filled ? fit.current : fit.current * 2.2, anchor);
            }}
          >
            {!src && (
              <span className="ez-subtle" style={{ textAlign: 'center', padding: '0 26px' }}>
                Drop an image here or{' '}
                <label className="ez-btn ez-sm" style={{ marginLeft: 4, display: 'inline-flex' }}>
                  choose a file
                  <input type="file" accept="image/*,.heic,.heif" hidden onChange={pick} />
                </label>
              </span>
            )}
            {src && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={img}
                  src={src} alt=""
                  onError={() => { setSrc(null); setReady(false); setErr(UNREADABLE); }}
                  style={{
                    position: 'absolute', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
                    willChange: 'transform',
                  }}
                />
                <div className="ez-cring" />
                <div className="ez-grid" />
              </>
            )}
          </div>

          {src && (
            <>
              <div className="ez-tools">
                <button className="ez-btn ez-sm" onClick={() => turn(-1)} title="Rotate left" aria-label="Rotate left">⟲</button>
                <button className="ez-btn ez-sm" onClick={() => turn(1)} title="Rotate right" aria-label="Rotate right">⟳</button>
                <button className={'ez-btn ez-sm' + (flip ? ' ez-pri' : '')} onClick={() => setFlip(f => !f)}
                        title="Flip horizontally" aria-label="Flip horizontally">⇋</button>
                <span className="ez-grow" />
                <button className="ez-btn ez-sm" onClick={reset} title="Reset all adjustments">Reset</button>
              </div>

              <label className="ez-row">
                <span>Zoom</span>
                <input className="ez-slider" type="range" min={100} max={MAX_ZOOM} step={1}
                       value={Math.round(zoom)}
                       onChange={e => zoomTo(fit.current * +e.target.value / 100, { x: 0, y: 0 })}
                       aria-label="Zoom" />
                <b>{Math.round(zoom)}%</b>
              </label>

              <label className="ez-row">
                <span>Straighten</span>
                <input className="ez-slider" type="range" min={-MAX_STRAIGHT} max={MAX_STRAIGHT} step={0.5}
                       value={straight} onChange={e => setStraight(+e.target.value)}
                       aria-label="Straighten" />
                <b>{straight > 0 ? `+${straight}` : straight}°</b>
              </label>
            </>
          )}

          {busy > 0 && (
            <div className="ez-prog"><i style={{ width: `${busy}%` }} /></div>
          )}
          {err && <div className="ez-note ez-bad" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="ez-mf">
          {/* Always reachable, even once an image is loaded. Its absence in
              that state is what made a second upload impossible. */}
          <label className="ez-btn" style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center' }}>
            {src ? 'Choose a different photo' : 'Choose a file'}
            <input type="file" accept="image/*,.heic,.heif" hidden onChange={pick} />
          </label>
          <button className="ez-btn" onClick={onClose}>Cancel</button>
          <button className="ez-btn ez-pri" onClick={save} disabled={busy > 0 || !src || !ready}>
            {busy > 0 ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
