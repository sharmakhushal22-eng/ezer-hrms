'use client';
import { uploadAuthHeaders } from '@/lib/auth-headers';

import { useCallback, useRef, useState } from 'react';

/** Crops to a real 512×512 JPEG on the client, then posts it.
 *
 *  ZOOM. UiScale sets CSS `zoom` on <html> (1.25 at 1440px), and
 *  getBoundingClientRect() reports ZOOMED pixels while CSS lengths, the
 *  element's transform and BOX below are all unzoomed. Mixing the two put
 *  `cx - BOX / 2` at 23 instead of 0 and, multiplied by k = 512 / 184, threw
 *  the saved crop about 64px off inside a 512px image — you dragged a face
 *  into the circle and got its ear. Pointer deltas have the same problem from
 *  the other end: clientX is zoomed, so a drag moved the picture 1.25x further
 *  than the cursor.
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

const toDataUrl = (b: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the converted image.'))
    r.readAsDataURL(b)
  })

/** Resolves when the browser has actually decoded the data URL. */
const decodable = (data: string): Promise<boolean> =>
  new Promise(resolve => {
    const probe = new Image()
    probe.onload = () => resolve(!!probe.naturalWidth && !!probe.naturalHeight)
    probe.onerror = () => resolve(false)
    probe.src = data
  })

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
  // Only true once the bytes have actually decoded — see load().
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const BOX = 184;

  const load = useCallback((f?: File | null) => {
    if (!f) return;
    if (f.size > 8e6) return setErr('Image is over 8 MB. Compress it and try again.');
    setErr(null); setReady(false); setSrc(null);

    void (async () => {
      try {
        const heif = await isHeif(f);
        // The type check allows through anything the BYTES say is a still
        // image, because iOS often reports no type at all for a HEIC.
        if (!heif && !f.type.startsWith('image/')) {
          setErr('That file is not an image. Use JPG or PNG.'); return;
        }

        setBusy(heif ? 10 : 0);

        // Try the browser first, even for HEIC — Safari decodes it natively,
        // and a local decode beats a round trip.
        let data = await toDataUrl(f);
        if (!(await decodable(data))) {
          if (!heif) { setErr(UNREADABLE); setBusy(0); return; }
          // Chrome, Firefox, Edge: no HEIC decoder. Decode it here instead.
          setBusy(35);
          data = await toDataUrl(await decodeHeic(f));
          if (!(await decodable(data))) { setErr(UNREADABLE); setBusy(0); return; }
        }

        setSrc(data); setPos({ x: 0, y: 0 }); setZoom(125); setReady(true); setBusy(0);
      } catch (e: unknown) {
        setBusy(0);
        setErr(e instanceof Error ? e.message : UNREADABLE);
      }
    })();
  }, []);

  const crop = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const el = img.current, st = stage.current;
      if (!el || !st) return reject(new Error('no image'));
      // Belt and braces: load() should have caught this, but a canvas throw
      // here is unreadable and this is one line.
      if (!el.complete || !el.naturalWidth) return reject(new Error(UNREADABLE));
      const S = 512, sc = zoom / 100, k = S / BOX;
      // Back to CSS pixels, so this agrees with BOX and with the transform.
      const z = docZoom();
      const r = st.getBoundingClientRect();
      const cx = r.width / z / 2, cy = r.height / z / 2;
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
              const z = docZoom();
              drag.current = { x: e.clientX / z - pos.x, y: e.clientY / z - pos.y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              if (!drag.current) return;
              const z = docZoom();
              setPos({ x: e.clientX / z - drag.current.x, y: e.clientY / z - drag.current.y });
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
                  onError={() => { setSrc(null); setReady(false); setErr(UNREADABLE); }}
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
          <button className="ez-btn ez-pri" onClick={save} disabled={busy > 0 || !src || !ready}>
            {busy > 0 ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
