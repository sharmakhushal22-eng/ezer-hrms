'use client'
// components/esign/SignaturePad.tsx — capture a signature three ways, the way Leegality,
// DocuSign and Adobe Sign all offer it: Draw, Type (choose a script style) or Upload.
//
// Whatever the method, the result is the same thing: a transparent PNG, trimmed to the ink
// and padded a little, handed to `onChange(dataUrl, kind)` (null while empty). Uploads get
// their paper background knocked out so a photo of a signature on white sits cleanly on the
// document instead of as a grey rectangle.
//
// Drawing uses pointer events (mouse, pen, finger alike) with quadratic smoothing and a
// width that thins as the stroke speeds up, which is what makes a drawn signature look
// written rather than plotted.
import { useEffect, useRef, useState } from 'react'
import { Great_Vibes, Dancing_Script, Caveat, Sacramento } from 'next/font/google'
import { C, R, F, W, E } from '@/lib/ui'

const greatVibes = Great_Vibes({ subsets: ['latin'], weight: '400', display: 'swap' })
const dancing = Dancing_Script({ subsets: ['latin'], display: 'swap' })
const caveat = Caveat({ subsets: ['latin'], display: 'swap' })
const sacramento = Sacramento({ subsets: ['latin'], weight: '400', display: 'swap' })
const STYLES = [
  { id: 'vibes', label: 'Classic', family: greatVibes.style.fontFamily, size: 64 },
  { id: 'dancing', label: 'Flowing', family: dancing.style.fontFamily, size: 56 },
  { id: 'sacramento', label: 'Elegant', family: sacramento.style.fontFamily, size: 68 },
  { id: 'caveat', label: 'Handwritten', family: caveat.style.fontFamily, size: 58 },
]
// Ink colours a signature is normally made in. These are deliberately fixed (not theme
// tokens): the ink goes INTO the PDF, which is paper, whatever theme the screen is in.
const INKS = [{ id: 'blue', label: 'Blue ink', v: '#1e3a8a' }, { id: 'black', label: 'Black ink', v: '#111827' }]

export type SignatureKind = 'DRAWN' | 'TYPED' | 'UPLOADED'

/** Crop a canvas to its non-transparent pixels, with padding; returns a PNG data URL or null. */
function trimmed(src: HTMLCanvasElement, pad = 12): string | null {
  const ctx = src.getContext('2d')!
  const { width: w, height: h } = src
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return null
  const cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2
  const out = document.createElement('canvas')
  out.width = cw; out.height = ch
  out.getContext('2d')!.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1)
  return out.toDataURL('image/png')
}

function Seg({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: R.md, background: C.sunken, border: `1px solid ${C.line}` }}>
      {options.map(o => (
        <button key={o.id} role="tab" aria-selected={value === o.id} type="button" onClick={() => onChange(o.id)} className="ez-press"
          style={{ padding: '7px 14px', borderRadius: R.sm, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: F.small, fontWeight: value === o.id ? W.bold : W.medium, background: value === o.id ? C.surface : 'transparent', color: value === o.id ? C.ink : C.muted, boxShadow: value === o.id ? E.flat : 'none' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function DrawPad({ ink, onInk }: { ink: string; onInk: (c: HTMLCanvasElement | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number; t: number; w: number } | null>(null)
  const mid = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = ref.current!
    const fit = () => {
      const r = c.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1)
      const keep = empty ? null : c.toDataURL()
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr)
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      if (keep) { const im = new Image(); im.onload = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(im, 0, 0, c.width, c.height); ctx.restore() }; im.src = keep }
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(c)
    return () => ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() } }
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); ref.current!.setPointerCapture(e.pointerId)
    const p = pos(e); last.current = { ...p, w: 2.6 }; mid.current = { x: p.x, y: p.y }
    const ctx = ref.current!.getContext('2d')!
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2); ctx.fill()
  }
  const move = (e: React.PointerEvent) => {
    if (!last.current) return
    const p = pos(e), l = last.current
    const dist = Math.hypot(p.x - l.x, p.y - l.y)
    if (dist < 0.8) return
    const v = dist / Math.max(1, p.t - l.t)                       // px per ms
    const pressure = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5
    const target = Math.max(1.1, Math.min(3.6, (3.4 - v * 1.6) * (0.6 + pressure * 0.8)))
    const w = l.w * 0.6 + target * 0.4
    const m = { x: (l.x + p.x) / 2, y: (l.y + p.y) / 2 }
    const ctx = ref.current!.getContext('2d')!
    ctx.strokeStyle = ink; ctx.lineWidth = w
    ctx.beginPath(); ctx.moveTo(mid.current!.x, mid.current!.y); ctx.quadraticCurveTo(l.x, l.y, m.x, m.y); ctx.stroke()
    mid.current = m; last.current = { ...p, w }
    if (empty) setEmpty(false)
  }
  const up = () => { if (!last.current) return; last.current = null; onInk(ref.current) }
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); onInk(null) }

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: R.lg, border: `1.5px dashed ${C.lineStrong}`, background: C.surface, overflow: 'hidden' }}>
        <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          style={{ display: 'block', width: '100%', height: 190, touchAction: 'none', cursor: 'crosshair', background: 'transparent' }} aria-label="Draw your signature" />
        <div style={{ position: 'absolute', left: 22, right: 22, bottom: 44, borderBottom: `1px solid ${C.line}`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 22, bottom: 22, fontSize: F.tiny, color: C.faint, pointerEvents: 'none', letterSpacing: '.04em' }}>✕ Sign above the line</div>
        {empty && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', color: C.faint, fontSize: F.body }}>Draw with your mouse, finger or stylus</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={clear} disabled={empty} className="ez-press" style={{ border: 'none', background: 'transparent', color: empty ? C.faint : C.brand, fontWeight: W.semi, fontSize: F.small, cursor: empty ? 'default' : 'pointer', fontFamily: 'inherit' }}>Clear</button>
      </div>
    </div>
  )
}

export default function SignaturePad({ name, onChange, initials = false }: {
  name: string; onChange: (png: string | null, kind: SignatureKind) => void; initials?: boolean
}) {
  const [mode, setMode] = useState<'draw' | 'type' | 'upload'>('draw')
  const [ink, setInk] = useState(INKS[0].v)
  const [typed, setTyped] = useState(initials ? name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase() : name)
  const [style, setStyle] = useState(STYLES[0].id)
  const [upload, setUpload] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState('')
  const drawn = useRef<HTMLCanvasElement | null>(null)

  // Recompute the output whenever the inputs that shape it change.
  useEffect(() => {
    let live = true
    ;(async () => {
      if (mode === 'draw') { onChange(drawn.current ? trimmed(drawn.current) : null, 'DRAWN'); return }
      if (mode === 'upload') { onChange(upload, 'UPLOADED'); return }
      const s = STYLES.find(x => x.id === style)!
      const txt = typed.trim()
      if (!txt) { onChange(null, 'TYPED'); return }
      try { await document.fonts.load(`${s.size}px ${s.family}`) } catch { /* fall back to whatever is loaded */ }
      if (!live) return
      const c = document.createElement('canvas'); c.width = 1400; c.height = 260
      const ctx = c.getContext('2d')!
      ctx.font = `${s.size * 2}px ${s.family}`; ctx.fillStyle = ink; ctx.textBaseline = 'middle'
      ctx.fillText(txt, 20, 140, 1360)
      onChange(trimmed(c, 16), 'TYPED')
    })()
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typed, style, ink, upload])

  const onFile = (f: File | undefined) => {
    setUploadErr('')
    if (!f) return
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setUploadErr('Use a PNG or JPG image of your signature.'); return }
    if (f.size > 5 * 1024 * 1024) { setUploadErr('That image is over 5 MB.'); return }
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width)
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      // Knock out the paper: anything close to the brightest tone becomes transparent.
      const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data
      let bright = 0
      for (let i = 0; i < d.length; i += 16) bright = Math.max(bright, (d[i] + d[i + 1] + d[i + 2]) / 3)
      const cut = Math.max(150, bright - 45)
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3
        if (d[i + 3] === 0) continue
        if (l >= cut) d[i + 3] = 0
        else if (l > cut - 40) d[i + 3] = Math.round(d[i + 3] * (cut - l) / 40)
      }
      ctx.putImageData(id, 0, 0)
      const out = trimmed(c, 10)
      if (!out) setUploadErr('No signature found in that image. Use a clear photo on plain paper.')
      setUpload(out)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => setUploadErr('That image could not be opened.')
    img.src = URL.createObjectURL(f)
  }

  const what = initials ? 'initials' : 'signature'
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <Seg value={mode} onChange={v => setMode(v as typeof mode)} options={[{ id: 'draw', label: 'Draw' }, { id: 'type', label: 'Type' }, { id: 'upload', label: 'Upload' }]} />
        {mode !== 'upload' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Ink colour">
            {INKS.map(k => (
              <button key={k.id} type="button" title={k.label} aria-label={k.label} aria-pressed={ink === k.v} onClick={() => setInk(k.v)}
                style={{ width: 22, height: 22, borderRadius: 99, background: k.v, cursor: 'pointer', border: `2px solid ${C.surface}`, boxShadow: ink === k.v ? `0 0 0 2px ${C.brand}` : `0 0 0 1px ${C.line}` }} />
            ))}
          </div>
        )}
      </div>

      {mode === 'draw' && <DrawPad key={ink} ink={ink} onInk={c => { drawn.current = c; onChange(c ? trimmed(c) : null, 'DRAWN') }} />}

      {mode === 'type' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <input value={typed} onChange={e => setTyped(e.target.value.slice(0, 60))} placeholder={`Type your ${initials ? 'initials' : 'full name'}`} data-no-titlecase
            style={{ padding: '11px 13px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: F.body, fontFamily: 'inherit', outline: 'none' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {STYLES.map(s => (
              <button key={s.id} type="button" onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className="ez-lift"
                style={{ textAlign: 'left', padding: '10px 14px 8px', borderRadius: R.md, cursor: 'pointer', background: C.surface, border: `1.5px solid ${style === s.id ? C.brand : C.line}`, boxShadow: style === s.id ? `0 0 0 3px ${C.brandTint}` : 'none', fontFamily: 'inherit' }}>
                <div style={{ fontFamily: s.family, fontSize: s.size * 0.52, color: ink, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{typed.trim() || name || 'Your name'}</div>
                <div style={{ fontSize: F.micro, color: C.muted, fontWeight: W.semi, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{s.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', placeItems: 'center', minHeight: 170, borderRadius: R.lg, border: `1.5px dashed ${C.lineStrong}`, background: C.sunken, cursor: 'pointer', padding: 16, textAlign: 'center' }}>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => onFile(e.target.files?.[0])} style={{ display: 'none' }} />
            {upload
              ? <img src={upload} alt="Your uploaded signature" style={{ maxHeight: 120, maxWidth: '100%' }} />
              : <div><div style={{ fontWeight: W.semi, color: C.ink, fontSize: F.body }}>Choose an image of your {what}</div><div style={{ color: C.muted, fontSize: F.small, marginTop: 4 }}>PNG or JPG · sign on plain white paper · the background is removed for you</div></div>}
          </label>
          {upload && <button type="button" onClick={() => setUpload(null)} style={{ justifySelf: 'end', border: 'none', background: 'transparent', color: C.brand, fontWeight: W.semi, fontSize: F.small, cursor: 'pointer', fontFamily: 'inherit' }}>Choose another</button>}
          {uploadErr && <div style={{ color: C.critical, fontSize: F.small }}>{uploadErr}</div>}
        </div>
      )}
    </div>
  )
}
