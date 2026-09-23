'use client';
import { uploadAuthHeaders } from '@/lib/auth-headers';
import { coverScale, cropDest, workScale } from '@/lib/profile/crop-math';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Crops to a real square JPEG on the client, then posts it.
 *
 *  FIT, NOT NATURAL SIZE. This used to scale the image by `zoom / 100` of its
 *  NATURAL size with no fit step, so a 4000px phone photo opened showing a
 *  147-pixel sliver of itself inside the 184px stage — and the slider stopped
 *  at 100%, so you could not zoom out to find your own face. The crop looked
 *  wrong, the export was soft (a ~147px region blown up to 512), and dragging
 *  a 5000px bitmap is what made it judder. Zoom is now a multiplier on a cover
 *  fit: 100% means "fills the frame". See lib/profile/crop-math.ts.
 *
 *  ZOOM (the other kind). UiScale sets CSS `zoom` on <html> (1.25 at 1440px),
 *  and getBoundingClientRect() reports ZOOMED pixels while CSS lengths, the
 *  element's transform and BOX below are all unzoomed. Mixing the two put
 *  `cx - BOX / 2` at 23 instead of 0 and threw the saved crop about 64px off
 *  inside the image — you dragged a face into the circle and got its ear.
 *  Pointer deltas have the same problem from the other end: clientX is zoomed,
 *  so a drag moved the picture 1.25x further than the cursor.
 *
 *  Everything below therefore works in CSS pixels, converting at the two
 *  boundaries where zoomed values enter: the stage rect and the pointer. */
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
 *  misses exactly the cases that need this most.
 *
 *  Layout: [4 bytes box size][ftyp][4-byte major brand]. The brands below are
 *  the still-image ones; mif1/msf1 are the generic HEIF containers Apple also
 *  emits. */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif'])

async function isHeif(f: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await f.slice(0, 12).arrayBuffer())
    if (head.length < 12) return false
    const tag = String.fromCharCode(...head.subarray(4, 8))
    if (tag !== 'ftyp') return false
    return BRANDS.has(String.fromCharCode(...head.subarray(8, 12)).toLowerCase())
  } catch { return false }
}

/** Decode HEIC in the browser, with libheif compiled to WebAssembly.
 *
 *  THE SERVER CANNOT DO THIS, which is worth writing down because it looks
 *  like it should. sharp is installed and sharp reads the HEIC container
 *  happily — metadata() answers "heif 600x400" and looks like success. It is
 *  not a decode. Ask it for pixels and libvips says:
 *
 *      heif: Error while loading plugin: Support for this compression format
 *      has not been built in
 *
 *  HEIC pixels are H.265, and the decoder for it is patent-encumbered, so no
 *  stock libvips build ships one. Neither does any browser except Safari.
 *  That leaves a WASM decoder, which is what this is.
 *
 *  IMPORTED DYNAMICALLY, AND ONLY HERE. The bundle is 1.35 MB. Loading it up
 *  front would charge every person who opens their profile for a format most
 *  of them will never upload; inside this branch, only somebody who actually
 *  picked a HEIC pays, once, while a progress bar is already running. */
async function decodeHeic(f: File): Promise<Blob> {
  const heic2any = (await import('heic2any')).default
  // A HEIC can legally hold a burst or a Live Photo, i.e. several images.
  // The first is the one the phone shows as the picture.
  const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(out) ? out[0] : out
}

/** An object URL, not a data URL.
 *
 *  readAsDataURL base64-encodes the whole file into a JavaScript string — a
 *  33% blow-up held in memory on top of the file and the decoded bitmap. For
 *  a JPEG nobody notices; for a PNG, which is lossless and routinely tens of
 *  megabytes, it is the difference between working and not. An object URL is
 *  a pointer to the blob the browser already has. */
const blobUrl = (b: Blob): string => URL.createObjectURL(b)

/** Resolves with the decoded element, or null. The caller wants the element
 *  and not just a yes/no, because the working copy is drawn from it. */
const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise(resolve => {
    const probe = new Image()
    probe.onload = () => resolve(probe.naturalWidth && probe.naturalHeight ? probe : null)
    probe.onerror = () => resolve(null)
    probe.src = url
  })

/** BYTES. Was 8 MB, which quietly made PNG a second-class format: PNG is
 *  lossless, so a plain screenshot clears 8 MB without being a large picture
 *  in any sense that matters, and the person got "compress it and try again"
 *  for a perfectly ordinary file. Nothing downstream cares — the crop leaves
 *  here as a square JPEG of about 120 KB whatever arrives. */
const MAX_BYTES = 40 * 1024 * 1024

/** PIXELS, which is the limit that actually protects anything. Bytes say
 *  nothing about decode cost: a 2 MB PNG can be 100 megapixels and ask for
 *  400 MB of bitmap. 60 MP passes any phone or camera made. */
const MAX_PIXELS = 60_000_000

/** Exported square. 512 was thin for the ID card, which draws the photo far
 *  larger than the 74px avatar does; 768 costs about 120 KB at q0.92 and
 *  stays well inside the route's 2 MB ceiling. */
const OUT = 768

export default function PhotoUploader({
  open, onClose, onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(1);
  const [busy, setBusy] = useState(0);
  // Only true once the bytes have actually decoded — see load().
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const BOX = 184;

  /** Position lives in a ref, not state.
   *
   *  It used to call setPos on every pointermove, re-rendering the whole modal
   *  for each event while the browser composited a multi-megapixel image. That
   *  is the lag. The transform is now written straight to the node inside a
   *  rAF, so a drag costs one style write per frame and no React work at all. */
  const pos = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  /** Mirrors `fit * zoom / 100` for the pointer handlers, which must not go
   *  through React on every move. Written in the layout effect below, never
   *  during render: a ref mutated while rendering tears under concurrent
   *  rendering, and React's own lint says so. */
  const eff = useRef(1);
  const nat = useRef({ w: 0, h: 0 });

  /** Keep the picture over the hole. Dragging used to be free to pull the
   *  image off the stage, and the export then drew the canvas's white fill as
   *  a hard wedge down one side of somebody's avatar. */
  const clamp = useCallback((p: { x: number; y: number }) => {
    const mx = Math.max(0, (nat.current.w * eff.current - BOX) / 2);
    const my = Math.max(0, (nat.current.h * eff.current - BOX) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }, []);

  const paint = useCallback(() => {
    frame.current = null;
    const el = img.current;
    if (el) el.style.transform =
      `translate(${pos.current.x}px, ${pos.current.y}px) scale(${eff.current})`;
  }, []);

  const schedule = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Zoom changes come through React, so re-clamp and repaint when it settles.
  //
  // LAYOUT effect, not a plain one: a plain effect runs AFTER the browser has
  // painted, so a freshly mounted image would show for one frame at its
  // natural size — which for a phone photo is several thousand pixels wide
  // bursting out of a 184px box. This lands the transform before that paint.
  useLayoutEffect(() => {
    eff.current = fit * zoom / 100;
    pos.current = clamp(pos.current);
    paint();
  }, [zoom, fit, src, clamp, paint]);
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
   * It is now mounted only while open, so every open is a fresh component with
   * fresh state. Resetting by hand in an effect would work too, but it means
   * remembering to clear each new piece of state forever, and it cascades a
   * second render every time the modal opens. Unmounting cannot be forgotten. */

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
          // Chrome, Firefox, Edge: no HEIC decoder. Decode it here instead.
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

        // Downscale once, up front. Nothing needs a 48-megapixel bitmap live in
        // the DOM to pick a square out of it, and this is most of the reason
        // the drag used to judder.
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
        setFit(coverScale(w, h, BOX));
        pos.current = { x: 0, y: 0 };
        show(url); setZoom(100); setReady(true); setBusy(0);
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
      const el = img.current, st = stage.current;
      if (!el || !st) return reject(new Error('no image'));
      // Belt and braces: load() should have caught this, but a canvas throw
      // here is unreadable and this is one line.
      if (!el.complete || !el.naturalWidth) return reject(new Error(UNREADABLE));

      // Back to CSS pixels, so this agrees with BOX and with the transform.
      const z = docZoom();
      const r = st.getBoundingClientRect();
      const cx = r.width / z / 2, cy = r.height / z / 2;
      const d = cropDest(el.naturalWidth, el.naturalHeight, eff.current, pos.current, cx, cy, BOX, OUT);

      const c = document.createElement('canvas');
      c.width = c.height = OUT;
      const g = c.getContext('2d')!;
      // Default smoothing quality is 'low', which is a box filter — it is why
      // a downscaled photo came out mushy even when the geometry was right.
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.fillStyle = '#fff'; g.fillRect(0, 0, OUT, OUT);
      g.drawImage(el, d.dx, d.dy, d.dw, d.dh);
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
      // Next returns an empty 500, and res.json() below failed with
      // "Unexpected end of JSON input" — so the upload never once worked from
      // this screen, while the same POST by curl did.
      const res = await fetch('/api/ess/profile/photo', { method: 'POST', body: fd, headers: await uploadAuthHeaders() });
      // Tolerate a body that is not JSON, so a transport failure reports its
      // status instead of a parser error.
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

  return (
    <div className="ez-scrim ez-on" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ez-modal" style={{ maxWidth: 560 }}>
        <div className="ez-mh">
          <h3>Profile photo</h3>
          <p>Drop an image, drag to position, zoom to fit. Saved as a {OUT} by {OUT} square.</p>
        </div>
        <div className="ez-mb">
          <div
            ref={stage}
            className="ez-stage"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); load(e.dataTransfer.files?.[0]); }}
            onPointerDown={e => {
              if (!src) return;
              const z = docZoom();
              drag.current = { x: e.clientX / z - pos.current.x, y: e.clientY / z - pos.current.y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              if (!drag.current) return;
              const z = docZoom();
              pos.current = clamp({ x: e.clientX / z - drag.current.x, y: e.clientY / z - drag.current.y });
              schedule();
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
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
              </>
            )}
          </div>

          <input
            className="ez-slider" type="range" min={100} max={400} value={zoom}
            onChange={e => setZoom(+e.target.value)} aria-label="Zoom"
            disabled={!src}
          />
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
