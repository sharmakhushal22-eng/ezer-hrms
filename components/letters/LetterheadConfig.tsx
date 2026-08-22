// ================================================================
// EZER HRMS — Letterhead & Signatory Configuration
// Path: components/letters/LetterheadConfig.tsx (rendered in the HR Letters section)
//
// Group ──< Company ──< Branch. Letterhead (PDF) and Authorised
// Signatory can each be set at ANY of the three levels — a branch
// that has its own overrides its company, which overrides the group.
// The two artifacts are independent: a branch can inherit its
// letterhead from the company while having its own signatory.
//
// Depends on:
//   lib/letterhead/types.ts, resolve.ts, pagesize.ts
//   migration 051_letterhead_hierarchy.sql
// ================================================================
'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getHierarchyTree, getResolvedLetterheadForBranch, getResolvedSignatoryForBranch,
  getLetterheadAtScope, getSignatoryAtScope, getSignedUrlForPath,
  saveLetterheadAtScope, saveSignatoryAtScope, removeLetterheadAtScope, removeSignatoryAtScope,
} from '@/lib/letterhead/resolve'
import { readPdfInfo, describePageSize, ptToMm } from '@/lib/letterhead/pagesize'
import {
  ACCEPTED_LETTERHEAD_MIME, MAX_LETTERHEAD_BYTES, ACCEPTED_SIGNATURE_MIME, MAX_SIGNATURE_BYTES,
} from '@/lib/letterhead/types'
import type {
  ScopeType, GroupNode, ScopeSelection, LetterheadFileRow, SignatoryRow,
  ResolvedLetterhead, ResolvedSignatory,
} from '@/lib/letterhead/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: '#BBF7D0',
  amber: TK.warning, amberBg: TK.warningTint, amberBd: '#FDE68A',
  red: TK.critical, redBg: TK.criticalTint, redBd: '#FCA5A5',
  purpleBg: TK.brandTint, gray: TK.sunken,
}

// Supabase Storage keys only allow a restricted ASCII set — strip anything else
// (em dashes, spaces, parentheses, non-ASCII) so uploads never get "Invalid key".
const safeName = (name: string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'file'
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Sub-components — kept OUTSIDE the main component (prevents
//    remount/focus-loss on every parent re-render) ─────────────────

function ScopeBadge({ scopeType }: { scopeType: ScopeType }) {
  const map: Record<ScopeType, [string, string, string]> = {
    GROUP: [C.purpleBg, C.purpleD, '🏛️'], COMPANY: [TK.positiveTint, C.green, '🏢'], BRANCH: [C.amberBg, C.amber, '📍'],
  }
  const [bg, fg, ic] = map[scopeType]
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, padding: '3px 9px', borderRadius: 999, background: bg, color: fg, fontWeight: 700, letterSpacing: '.05em' }}><span style={{ fontSize: 9 }}>{ic}</span>{scopeType}</span>
}

// Header used by both cards — an icon tile + title, optional scope badge on the right.
function CardHead({ icon, title, tint, badge }: { icon: string; title: string; tint: string; badge?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: C.navy }}>{title}</div>
      {badge}
    </div>
  )
}

function UploadZone({ label, sub, onPick, accept }: { label: string; sub: string; onPick: (f: File) => void; accept: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [hover, setHover] = useState(false)
  return (
    <div onClick={() => ref.current?.click()}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ border: `1.5px dashed ${hover ? C.purple : TK.brandEdge}`, borderRadius: 10, padding: '14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: hover ? TK.canvas : TK.sunken, transition: 'all .15s' }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: hover ? C.purple : C.purpleBg, color: hover ? '#fff' : C.purpleD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, transition: 'all .15s' }}>⬆</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, color: C.navy, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{sub}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 11px', flexShrink: 0 }}>Browse</span>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.[0]) onPick(e.target.files[0]) }} />
    </div>
  )
}

function LetterheadCard({
  scope, existing, onSaved,
}: {
  scope: ScopeSelection; existing: LetterheadFileRow | null; onSaved: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [detected, setDetected] = useState<{ label: string; widthMm: number; heightMm: number; pageCount: number } | null>(null)
  const [marginTop, setMarginTop] = useState(existing?.content_top_mm ?? 40)
  const [marginBottom, setMarginBottom] = useState(existing?.content_bottom_mm ?? 30)
  const [marginLeft, setMarginLeft] = useState(existing?.content_left_mm ?? 20)
  const [marginRight, setMarginRight] = useState(existing?.content_right_mm ?? 20)
  const [scalePct, setScalePct] = useState(existing?.scale_percent ?? 100)
  const [existingUrl, setExistingUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)   // blob URL for the preview modal
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    setMarginTop(existing?.content_top_mm ?? 40)
    setMarginBottom(existing?.content_bottom_mm ?? 30)
    setMarginLeft(existing?.content_left_mm ?? 20)
    setMarginRight(existing?.content_right_mm ?? 20)
    setScalePct(existing?.scale_percent ?? 100)
    setFile(null); setDetected(null); setErr(''); setPreviewUrl(null)
    if (existing?.file_url) getSignedUrlForPath('letterhead-files', existing.file_url).then(setExistingUrl)
    else setExistingUrl(null)
  }, [existing])

  const previewRef = useRef<HTMLDivElement>(null)

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setFile(null); setDetected(null); setErr('')
  }

  // Drag a safe-area edge with the mouse — the corresponding margin (mm) updates live.
  function beginDrag(edge: 'top' | 'bottom' | 'left' | 'right') {
    return (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation()
      const el = previewRef.current
      if (!el || !detected) return
      const W = detected.widthMm, H = detected.heightMm, MIN = 5   // keep ≥5mm content zone
      const startTop = marginTop, startBottom = marginBottom, startLeft = marginLeft, startRight = marginRight
      const move = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const px = (ev.clientX - r.left) / r.width
        const py = (ev.clientY - r.top) / r.height
        if (edge === 'top') setMarginTop(Math.round(clampN(py * H, 0, H - startBottom - MIN)))
        else if (edge === 'bottom') setMarginBottom(Math.round(clampN((1 - py) * H, 0, H - startTop - MIN)))
        else if (edge === 'left') setMarginLeft(Math.round(clampN(px * W, 0, W - startRight - MIN)))
        else if (edge === 'right') setMarginRight(Math.round(clampN((1 - px) * W, 0, W - startLeft - MIN)))
      }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  async function pickFile(f: File) {
    setErr('')
    if (!ACCEPTED_LETTERHEAD_MIME.includes(f.type as any)) { setErr('Only PDF files are accepted for a letterhead.'); return }
    if (f.size > MAX_LETTERHEAD_BYTES) { setErr('File too large — max 5MB.'); return }
    let info
    try { info = await readPdfInfo(f) }
    catch { setErr('Could not read this PDF — it may be corrupted.'); return }
    // A letterhead must be a single-page template — reject multi-page PDFs.
    if (info.pageCount > 1) {
      setErr(`This PDF has ${info.pageCount} pages. A letterhead must be a single-page PDF — please upload a 1-page file.`)
      return
    }
    setFile(f)
    setDetected({ label: describePageSize(info.size), widthMm: ptToMm(info.size.widthPt), heightMm: ptToMm(info.size.heightPt), pageCount: info.pageCount })
    setPreviewUrl(URL.createObjectURL(f))   // opens the preview modal
  }

  async function handleSave() {
    if (!file || !detected) return
    setSaving(true)
    const path = `${scope.scope_type}/${scope.scope_key}/${Date.now()}_${safeName(file.name)}`
    const { error: upErr } = await supabase.storage.from('letterhead-files').upload(path, file, { upsert: false })
    if (upErr) { setErr('Upload failed: ' + upErr.message); setSaving(false); return }

    const scopeIdField = scope.scope_type === 'GROUP' ? 'group_id' : scope.scope_type === 'COMPANY' ? 'company_id' : 'location_id'
    const { error } = await saveLetterheadAtScope({
      scope_type: scope.scope_type, scope_key: scope.scope_key,
      [scopeIdField]: scope.scope_key,
      file_url: path, file_name: file.name, file_size_bytes: file.size,
      page_count: detected.pageCount, page_width_mm: detected.widthMm, page_height_mm: detected.heightMm,
      content_top_mm: marginTop, content_bottom_mm: marginBottom,
      content_left_mm: marginLeft, content_right_mm: marginRight,
      scale_percent: scalePct,
    } as any)
    setSaving(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    closePreview()
    onSaved()
  }

  async function handleRemove() {
    await removeLetterheadAtScope(scope.scope_type, scope.scope_key)
    onSaved()
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 14, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' }}>
      <CardHead icon="📄" title="Letterhead (PDF)" tint={C.purpleBg} badge={<span style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, fontWeight: 700, letterSpacing: '.04em', background: existing ? C.greenBg : TK.sunken, color: existing ? C.green : C.muted }}>{existing ? '✓ SET' : 'NOT SET'}</span>} />

      {existing && !file && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, background: 'linear-gradient(90deg,#F5F3FF,#FAFAF8)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <span style={{ fontSize: 22 }}>📄</span>
          <div style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{existing.file_name}</div>
            <div style={{ color: C.muted, fontSize: 10.5, marginTop: 1 }}>
              {existing.page_width_mm}×{existing.page_height_mm}mm · margins T{existing.content_top_mm} B{existing.content_bottom_mm} L{existing.content_left_mm} R{existing.content_right_mm}mm · scale {existing.scale_percent}%
            </div>
          </div>
          {existingUrl && <a href={existingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.purpleD, textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>View ↗</a>}
          <button onClick={handleRemove} style={{ padding: '5px 11px', fontSize: 11, borderRadius: 7, border: `1px solid ${C.redBd}`, background: '#fff', color: C.red, cursor: 'pointer', fontWeight: 600 }}>Remove</button>
        </div>
      )}

      <UploadZone label={existing ? 'Replace letterhead PDF' : 'Upload letterhead PDF'} sub="Max 5MB, PDF only" onPick={pickFile} accept="application/pdf" />
      {err && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{err}</div>}

      {/* ── Preview modal — shown after a valid single-page PDF is picked ── */}
      {file && detected && previewUrl && (
        <div onClick={closePreview} style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(30,27,75,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 26px 70px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>📄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 10.5, color: C.green }}>✓ {detected.label} · single page</div>
              </div>
              <button onClick={closePreview} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: C.muted }}>×</button>
            </div>
            {/* Scrollable body */}
            <div style={{ padding: 16, overflowY: 'auto' }}>
              {/* Draggable live preview — drag the purple edges to set the content area */}
              {(() => {
                const tP = Math.max(0, (marginTop / detected.heightMm) * 100)
                const bP = Math.max(0, (marginBottom / detected.heightMm) * 100)
                const lP = Math.max(0, (marginLeft / detected.widthMm) * 100)
                const rP = Math.max(0, (marginRight / detected.widthMm) * 100)
                const grip = { background: TK.brand, borderRadius: 3, boxShadow: '0 0 0 2px #fff' }
                return (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div ref={previewRef} style={{ position: 'relative', width: '100%', maxWidth: 350, aspectRatio: `${detected.widthMm} / ${detected.heightMm}`, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 3px 14px rgba(30,27,75,0.12)', touchAction: 'none', userSelect: 'none' }}>
                      <iframe title="Letterhead preview" src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none', transform: `scale(${(scalePct || 100) / 100})`, transformOrigin: 'center center' }} />
                      {/* Safe content box (visual only) */}
                      <div style={{ position: 'absolute', pointerEvents: 'none', top: `${tP}%`, bottom: `${bP}%`, left: `${lP}%`, right: `${rP}%`, border: '1.5px dashed #7C3AED', background: 'rgba(124,58,237,0.06)', borderRadius: 3 }}>
                        <span style={{ position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)', fontSize: 7.5, fontWeight: 700, letterSpacing: '.04em', color: TK.brand, background: 'rgba(255,255,255,0.85)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>SAFE CONTENT AREA</span>
                      </div>
                      {/* Drag handles on each edge */}
                      <div onPointerDown={beginDrag('top')} title="Drag to set top margin" style={{ position: 'absolute', top: `${tP}%`, left: `${lP}%`, right: `${rP}%`, height: 16, transform: 'translateY(-50%)', cursor: 'ns-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ ...grip, height: 4, width: '46%', maxWidth: 54 }} /></div>
                      <div onPointerDown={beginDrag('bottom')} title="Drag to set bottom margin" style={{ position: 'absolute', bottom: `${bP}%`, left: `${lP}%`, right: `${rP}%`, height: 16, transform: 'translateY(50%)', cursor: 'ns-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ ...grip, height: 4, width: '46%', maxWidth: 54 }} /></div>
                      <div onPointerDown={beginDrag('left')} title="Drag to set left margin" style={{ position: 'absolute', left: `${lP}%`, top: `${tP}%`, bottom: `${bP}%`, width: 16, transform: 'translateX(-50%)', cursor: 'ew-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ ...grip, width: 4, height: '40%', maxHeight: 54 }} /></div>
                      <div onPointerDown={beginDrag('right')} title="Drag to set right margin" style={{ position: 'absolute', right: `${rP}%`, top: `${tP}%`, bottom: `${bP}%`, width: 16, transform: 'translateX(50%)', cursor: 'ew-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ ...grip, width: 4, height: '40%', maxHeight: 54 }} /></div>
                    </div>
                  </div>
                )
              })()}
              <div style={{ fontSize: 10.5, color: C.purpleD, textAlign: 'center', margin: '9px 0 2px', fontWeight: 600 }}>↔ Drag the purple edges to set where letter text can go</div>
              {/* Live readouts */}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', margin: '8px 0 4px' }}>
                {[['Top', marginTop], ['Bottom', marginBottom], ['Left', marginLeft], ['Right', marginRight]].map(([lbl, v]: any) => (
                  <span key={lbl} style={{ fontSize: 10.5, background: C.purpleBg, color: C.purpleD, borderRadius: 7, padding: '4px 9px', fontWeight: 600 }}>{lbl} {v}mm</span>
                ))}
              </div>
              {/* Scale slider */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, whiteSpace: 'nowrap' }}>Scale</span>
                <input type="range" min={50} max={150} value={scalePct} onChange={e => setScalePct(Number(e.target.value))} style={{ flex: 1, accentColor: C.purple }} />
                <span style={{ fontSize: 11.5, color: C.navy, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{scalePct}%</span>
              </div>
              {err && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>⚠ {err}</div>}
            </div>
            {/* Footer */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
              <button onClick={closePreview} style={{ padding: '9px 16px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 4px 12px rgba(124,58,237,0.28)' }}>
                {saving ? 'Uploading…' : '⬆ Upload letterhead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SignatoryCard({
  scope, existing, onSaved,
}: {
  scope: ScopeSelection; existing: SignatoryRow | null; onSaved: () => void
}) {
  const [name, setName] = useState(existing?.signatory_name ?? '')
  const [designation, setDesignation] = useState(existing?.signatory_designation ?? '')
  const [existingPreview, setExistingPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Upload → crop → place flow
  const [step, setStep] = useState<'idle' | 'crop' | 'place'>('idle')
  const [rawUrl, setRawUrl] = useState<string | null>(null)
  const [imgNat, setImgNat] = useState<{ w: number; h: number } | null>(null)
  const [cropBox, setCropBox] = useState({ x: 8, y: 12, w: 84, h: 76 })
  const cropRef = useRef<HTMLDivElement>(null)
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null)
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null)
  const [lhBg, setLhBg] = useState<{ url: string | null; wMm: number; hMm: number }>({ url: null, wMm: 210, hMm: 297 })
  const [place, setPlace] = useState({ xPct: 58, yPct: 74, wPct: 28 })
  const placeRef = useRef<HTMLDivElement>(null)

  const scopeIdField = scope.scope_type === 'GROUP' ? 'group_id' : scope.scope_type === 'COMPANY' ? 'company_id' : 'location_id'

  function resetFlow() {
    if (rawUrl) URL.revokeObjectURL(rawUrl)
    if (croppedUrl) URL.revokeObjectURL(croppedUrl)
    setStep('idle'); setRawUrl(null); setImgNat(null); setCroppedUrl(null); setCroppedBlob(null); setErr('')
  }

  useEffect(() => {
    setName(existing?.signatory_name ?? '')
    setDesignation(existing?.signatory_designation ?? '')
    setStep('idle'); setRawUrl(null); setImgNat(null); setCroppedUrl(null); setCroppedBlob(null); setErr('')
    if (existing?.signature_url) getSignedUrlForPath('letterhead-signatures', existing.signature_url).then(setExistingPreview)
    else setExistingPreview(null)
  }, [existing])

  function pickFile(f: File) {
    setErr('')
    if (!ACCEPTED_SIGNATURE_MIME.includes(f.type as any)) { setErr('Only PNG or JPG accepted.'); return }
    if (f.size > MAX_SIGNATURE_BYTES) { setErr('File too large — max 2MB.'); return }
    const url = URL.createObjectURL(f)
    const im = new Image()
    im.onload = () => { setImgNat({ w: im.naturalWidth, h: im.naturalHeight }); setRawUrl(url); setCropBox({ x: 8, y: 12, w: 84, h: 76 }); setStep('crop') }
    im.onerror = () => setErr('Could not read this image.')
    im.src = url
  }

  // Crop box — drag to move, drag the corner handle to resize (percentages of the image).
  function cropDrag(mode: 'move' | 'resize') {
    return (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation()
      const el = cropRef.current; if (!el) return
      const r0 = el.getBoundingClientRect(); const start = { ...cropBox }; const sx = e.clientX, sy = e.clientY
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / r0.width * 100, dy = (ev.clientY - sy) / r0.height * 100
        if (mode === 'move') setCropBox({ ...start, x: clampN(start.x + dx, 0, 100 - start.w), y: clampN(start.y + dy, 0, 100 - start.h) })
        else setCropBox({ ...start, w: clampN(start.w + dx, 8, 100 - start.x), h: clampN(start.h + dy, 8, 100 - start.y) })
      }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    }
  }

  async function doCrop() {
    if (!rawUrl || !imgNat) return
    const img = new Image()
    try { await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error()); img.src = rawUrl }) }
    catch { setErr('Crop failed — could not load image.'); return }
    const sx = cropBox.x / 100 * imgNat.w, sy = cropBox.y / 100 * imgNat.h
    const sw = cropBox.w / 100 * imgNat.w, sh = cropBox.h / 100 * imgNat.h
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sw)); canvas.height = Math.max(1, Math.round(sh))
    const ctx = canvas.getContext('2d'); if (!ctx) { setErr('Crop failed.'); return }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/png'))
    if (!blob) { setErr('Crop failed.'); return }
    if (croppedUrl) URL.revokeObjectURL(croppedUrl)
    setCroppedBlob(blob); setCroppedUrl(URL.createObjectURL(blob))
    await loadLhBg()
    setPlace({ xPct: 58, yPct: 74, wPct: 28 })
    setErr(''); setStep('place')
  }

  async function loadLhBg() {
    try {
      if (scope.scope_type === 'BRANCH') {
        const r = await getResolvedLetterheadForBranch(scope.scope_key)
        if (r?.letterhead_configured && r.file_url) { setLhBg({ url: r.file_url, wMm: r.page_width_mm || 210, hMm: r.page_height_mm || 297 }); return }
      } else {
        const lh = await getLetterheadAtScope(scope.scope_type, scope.scope_key)
        if (lh?.file_url) { const u = await getSignedUrlForPath('letterhead-files', lh.file_url); setLhBg({ url: u, wMm: lh.page_width_mm || 210, hMm: lh.page_height_mm || 297 }); return }
      }
    } catch { /* fall through to blank */ }
    setLhBg({ url: null, wMm: 210, hMm: 297 })
  }

  // Drag the signature over the letterhead — sets its top-left position (% of page).
  function startPlaceDrag(e: React.PointerEvent) {
    e.preventDefault()
    const cont = placeRef.current; if (!cont) return
    const r = cont.getBoundingClientRect()
    const imgRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offX = e.clientX - imgRect.left, offY = e.clientY - imgRect.top
    const move = (ev: PointerEvent) => {
      const nx = (ev.clientX - offX - r.left) / r.width * 100, ny = (ev.clientY - offY - r.top) / r.height * 100
      setPlace(p => ({ ...p, xPct: clampN(nx, 0, 100 - p.wPct), yPct: clampN(ny, 0, 95) }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  async function handleUpload() {
    if (!croppedBlob) return
    if (!name.trim() || !designation.trim()) { setErr('Enter signatory name and designation.'); return }
    setSaving(true); setErr('')
    const path = `${scope.scope_type}/${scope.scope_key}/${Date.now()}_signature.png`
    const { error: upErr } = await supabase.storage.from('letterhead-signatures').upload(path, croppedBlob, { upsert: false, contentType: 'image/png' })
    if (upErr) { setErr('Upload failed: ' + upErr.message); setSaving(false); return }
    const { error } = await saveSignatoryAtScope({
      scope_type: scope.scope_type, scope_key: scope.scope_key, [scopeIdField]: scope.scope_key,
      signatory_name: name.trim(), signatory_designation: designation.trim(),
      signature_url: path, signature_mime_type: 'image/png',
      sig_x_pct: Math.round(place.xPct * 100) / 100, sig_y_pct: Math.round(place.yPct * 100) / 100, sig_width_pct: Math.round(place.wPct * 100) / 100,
    } as any)
    setSaving(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    resetFlow(); onSaved()
  }

  async function handleSaveDetails() {
    if (!existing) return
    if (!name.trim() || !designation.trim()) { setErr('Enter signatory name and designation.'); return }
    setSaving(true); setErr('')
    const { error } = await saveSignatoryAtScope({
      scope_type: scope.scope_type, scope_key: scope.scope_key, [scopeIdField]: scope.scope_key,
      signatory_name: name.trim(), signatory_designation: designation.trim(),
      signature_url: existing.signature_url, signature_mime_type: existing.signature_mime_type,
      sig_x_pct: existing.sig_x_pct, sig_y_pct: existing.sig_y_pct, sig_width_pct: existing.sig_width_pct,
    } as any)
    setSaving(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    onSaved()
  }

  async function handleRemove() {
    await removeSignatoryAtScope(scope.scope_type, scope.scope_key)
    onSaved()
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(30,27,75,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
  const modalCard: React.CSSProperties = { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 26px 70px rgba(0,0,0,0.35)', overflow: 'hidden' }
  const uploadBtn: React.CSSProperties = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.28)' }
  const cancelBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 4px rgba(124,58,237,0.06)' }}>
      <CardHead icon="✍️" title="Authorised signatory" tint={C.greenBg} badge={<span style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, fontWeight: 700, letterSpacing: '.04em', background: existing ? C.greenBg : TK.sunken, color: existing ? C.green : C.muted }}>{existing ? '✓ SET' : 'NOT SET'}</span>} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <input placeholder="Signatory name" value={name} onChange={e => setName(e.target.value)}
          style={{ padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', background: TK.sunken, outline: 'none' }} />
        <input placeholder="Designation" value={designation} onChange={e => setDesignation(e.target.value)}
          style={{ padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', background: TK.sunken, outline: 'none' }} />
      </div>

      <UploadZone label={existingPreview ? 'Replace signature image' : 'Upload signature image'} sub="PNG or JPG, max 2MB — then crop & place it" onPick={pickFile} accept="image/png,image/jpeg" />
      {existingPreview && (
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={existingPreview} alt="Signature preview" style={{ height: 40, objectFit: 'contain' }} />
          <span style={{ fontSize: 10, color: C.muted }}>current signature{existing?.sig_x_pct != null ? ' · placed' : ''}</span>
        </div>
      )}
      {err && step === 'idle' && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{err}</div>}

      {(existing) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleSaveDetails} disabled={saving} style={{ ...uploadBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : '💾 Save name/designation'}</button>
          <button onClick={handleRemove} style={{ padding: '9px 15px', borderRadius: 9, border: `1px solid ${C.redBd}`, background: '#fff', color: C.red, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>
        </div>
      )}

      {/* ── Step 1: Crop modal ── */}
      {step === 'crop' && rawUrl && imgNat && (
        <div style={overlay} onClick={resetFlow}>
          <div style={modalCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: C.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>✂️</div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.navy }}>Step 1 — Crop the signature</div>
              <button onClick={resetFlow} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.muted }}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div ref={cropRef} style={{ position: 'relative', width: '100%', maxWidth: 420, aspectRatio: `${imgNat.w} / ${imgNat.h}`, background: TK.sunken, borderRadius: 8, overflow: 'hidden', touchAction: 'none', userSelect: 'none', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={rawUrl} alt="signature" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }} />
                  <div onPointerDown={cropDrag('move')} style={{ position: 'absolute', left: `${cropBox.x}%`, top: `${cropBox.y}%`, width: `${cropBox.w}%`, height: `${cropBox.h}%`, border: '2px solid #7C3AED', boxShadow: '0 0 0 9999px rgba(30,27,75,0.4)', cursor: 'move', touchAction: 'none' }}>
                    <div onPointerDown={cropDrag('resize')} style={{ position: 'absolute', right: -8, bottom: -8, width: 16, height: 16, background: TK.brand, border: '2px solid #fff', borderRadius: 4, cursor: 'nwse-resize', touchAction: 'none' }} />
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, textAlign: 'center', marginTop: 9 }}>Drag inside the box to move · drag the corner to resize. Crop tight around the signature.</div>
              {err && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>⚠ {err}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
              <button onClick={resetFlow} style={cancelBtn}>Cancel</button>
              <button onClick={doCrop} style={uploadBtn}>Place →</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Place modal ── */}
      {step === 'place' && croppedUrl && (
        <div style={overlay} onClick={resetFlow}>
          <div style={modalCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: C.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📍</div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.navy }}>Step 2 — Place on the letterhead</div>
              <button onClick={resetFlow} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.muted }}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <input placeholder="Signatory name" value={name} onChange={e => setName(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #DDD6FE', borderRadius: 8, fontSize: 12, boxSizing: 'border-box', background: TK.sunken, outline: 'none' }} />
                <input placeholder="Designation" value={designation} onChange={e => setDesignation(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #DDD6FE', borderRadius: 8, fontSize: 12, boxSizing: 'border-box', background: TK.sunken, outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div ref={placeRef} style={{ position: 'relative', width: '100%', maxWidth: 320, aspectRatio: `${lhBg.wMm} / ${lhBg.hMm}`, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 3px 14px rgba(30,27,75,0.12)', touchAction: 'none', userSelect: 'none' }}>
                  {lhBg.url
                    ? <iframe title="letterhead" src={`${lhBg.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} />
                    : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: C.muted, textAlign: 'center', padding: 12 }}>No letterhead set at this level — position is relative to an A4 page.</div>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={croppedUrl} alt="signature" draggable={false} onPointerDown={startPlaceDrag}
                    style={{ position: 'absolute', left: `${place.xPct}%`, top: `${place.yPct}%`, width: `${place.wPct}%`, cursor: 'grab', outline: '1.5px dashed #7C3AED', outlineOffset: 1, touchAction: 'none' }} />
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: C.purpleD, textAlign: 'center', margin: '9px 0 2px', fontWeight: 600 }}>✋ Drag the signature to position it on the page</div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, whiteSpace: 'nowrap' }}>Size</span>
                <input type="range" min={8} max={55} value={place.wPct} onChange={e => setPlace(p => ({ ...p, wPct: clampN(Number(e.target.value), 8, 100 - p.xPct) }))} style={{ flex: 1, accentColor: C.purple }} />
                <span style={{ fontSize: 11.5, color: C.navy, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{Math.round(place.wPct)}%</span>
              </div>
              {err && <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>⚠ {err}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => { setErr(''); setStep('crop') }} style={cancelBtn}>← Back to crop</button>
              <button onClick={handleUpload} disabled={saving} style={{ ...uploadBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Uploading…' : '⬆ Upload signature'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResolvedPreview({ letterhead, signatory }: { letterhead: ResolvedLetterhead | null; signatory: ResolvedSignatory | null }) {
  return (
    <div style={{ background: 'linear-gradient(135deg,#EEEDFE,#F5F3FF)', border: `1px solid #C4B5FD`, borderRadius: 14, padding: '16px 18px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 15 }}>✨</span>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em' }}>Effective for this branch — what letters actually use</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Letterhead</div>
          {letterhead?.letterhead_configured ? (
            <div style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: C.navy }}>{letterhead.file_name}</span>
              <div style={{ marginTop: 3 }}><ScopeBadge scopeType={letterhead.letterhead_resolved_from!} /> <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>
                {letterhead.letterhead_resolved_from === 'BRANCH' ? 'set on this branch' : `inherited from ${letterhead.letterhead_resolved_from?.toLowerCase()}`}
              </span></div>
            </div>
          ) : <div style={{ fontSize: 11, color: C.red }}>⚠ Not configured at any level</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Signatory</div>
          {signatory?.signatory_configured ? (
            <div style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: C.navy }}>{signatory.signatory_name}</span>
              <span style={{ color: C.muted }}> · {signatory.signatory_designation}</span>
              <div style={{ marginTop: 3 }}><ScopeBadge scopeType={signatory.signatory_resolved_from!} /> <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>
                {signatory.signatory_resolved_from === 'BRANCH' ? 'set on this branch' : `inherited from ${signatory.signatory_resolved_from?.toLowerCase()}`}
              </span></div>
            </div>
          ) : <div style={{ fontSize: 11, color: C.red }}>⚠ Not configured at any level</div>}
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────
const selStyle: React.CSSProperties = { padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: '"DM Sans","Segoe UI",sans-serif', minWidth: 220, boxSizing: 'border-box' }
const selLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }

export default function LetterheadConfig() {
  const [tree, setTree] = useState<GroupNode[]>([])
  const [groupId, setGroupId] = useState('')
  const [companyId, setCompanyId] = useState('')   // '' = whole group
  const [branchId, setBranchId] = useState('')     // '' = company level (all branches)
  const [existingLetterhead, setExistingLetterhead] = useState<LetterheadFileRow | null>(null)
  const [existingSignatory, setExistingSignatory] = useState<SignatoryRow | null>(null)
  const [resolvedLH, setResolvedLH] = useState<ResolvedLetterhead | null>(null)
  const [resolvedSig, setResolvedSig] = useState<ResolvedSignatory | null>(null)
  const [configuredKeys, setConfiguredKeys] = useState<{ lh: Set<string>; sig: Set<string> }>({ lh: new Set(), sig: new Set() })
  const [loading, setLoading] = useState(true)

  const loadTree = useCallback(async () => {
    setLoading(true)
    const t = await getHierarchyTree()
    setTree(t)
    if (t.length && !groupId) setGroupId(t[0].id)
    // Which scope_keys have their OWN config (drives the "configured" dots on each dropdown option).
    const { data: lhRows } = await supabase.from('letterhead_files').select('scope_key').eq('is_active', true)
    const { data: sigRows } = await supabase.from('letterhead_signatories').select('scope_key').eq('is_active', true)
    setConfiguredKeys({
      lh: new Set((lhRows ?? []).map((r: any) => r.scope_key)),
      sig: new Set((sigRows ?? []).map((r: any) => r.scope_key)),
    })
    setLoading(false)
  }, [groupId])

  useEffect(() => { loadTree() }, [loadTree])

  // Resolve the current selection from the three dropdowns (deepest chosen level wins).
  const group = tree.find(g => g.id === groupId) || tree[0] || null
  const companies = group?.companies || []
  const company = companies.find(c => c.id === companyId) || null
  const branches = company?.branches || []
  const branch = branches.find(b => b.id === branchId) || null

  const selection: ScopeSelection | null =
    branch ? { scope_type: 'BRANCH', scope_key: branch.id, display_name: branch.location_name }
      : company ? { scope_type: 'COMPANY', scope_key: company.id, display_name: company.company_name }
        : group ? { scope_type: 'GROUP', scope_key: group.id, display_name: group.group_name }
          : null
  const selKey = selection ? `${selection.scope_type}:${selection.scope_key}` : ''

  const loadSelection = useCallback(async (sel: ScopeSelection) => {
    const [lh, sig] = await Promise.all([
      getLetterheadAtScope(sel.scope_type, sel.scope_key),
      getSignatoryAtScope(sel.scope_type, sel.scope_key),
    ])
    setExistingLetterhead(lh)
    setExistingSignatory(sig)
    if (sel.scope_type === 'BRANCH') {
      const [rlh, rsig] = await Promise.all([
        getResolvedLetterheadForBranch(sel.scope_key),
        getResolvedSignatoryForBranch(sel.scope_key),
      ])
      setResolvedLH(rlh); setResolvedSig(rsig)
    } else {
      setResolvedLH(null); setResolvedSig(null)
    }
  }, [])

  useEffect(() => { if (selection) loadSelection(selection) }, [selKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    loadTree()
    if (selection) loadSelection(selection)
  }

  const dot = (id: string) => configuredKeys.lh.has(id) || configuredKeys.sig.has(id) ? ' ●' : ''

  // Breadcrumb crumbs for the current path (Group › Company › Branch).
  const crumbs = [
    group ? { label: group.group_name, on: selection?.scope_type === 'GROUP' } : null,
    company ? { label: company.company_name, on: selection?.scope_type === 'COMPANY' } : null,
    branch ? { label: branch.location_name, on: selection?.scope_type === 'BRANCH' } : null,
  ].filter(Boolean) as { label: string; on: boolean }[]

  return (
    <div style={{ padding: '18px 24px 28px', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 }}>
      {loading ? <div style={{ color: C.muted, fontSize: 12, padding: 20 }}>Loading…</div> : (
        <>
          {/* ── Company / Branch pickers ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 16, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🎯</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Choose where to configure</div>
              {/* Breadcrumb */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {crumbs.map((cr, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {i > 0 && <span style={{ color: '#C4B5FD', fontSize: 11 }}>›</span>}
                    <span style={{ fontSize: 10.5, fontWeight: cr.on ? 700 : 500, color: cr.on ? C.purpleD : C.muted, background: cr.on ? C.purpleBg : 'transparent', padding: cr.on ? '2px 8px' : '2px 0', borderRadius: 99 }}>{cr.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {tree.length > 1 && (
                <div>
                  <label style={selLabel}>🏛️ Group</label>
                  <select style={selStyle} value={group?.id || ''} onChange={e => { setGroupId(e.target.value); setCompanyId(''); setBranchId('') }}>
                    {tree.map(g => <option key={g.id} value={g.id}>{g.group_name}{dot(g.id)}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={selLabel}>🏢 Company</label>
                <select style={selStyle} value={companyId} onChange={e => { setCompanyId(e.target.value); setBranchId('') }}>
                  <option value="">🏛️ Whole group{group ? ` (${group.group_name})` : ''}{dot(group?.id || '')}</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}{dot(c.id)}</option>)}
                </select>
              </div>
              {company && (
                <div>
                  <label style={selLabel}>📍 Branch</label>
                  <select style={selStyle} value={branchId} onChange={e => setBranchId(e.target.value)}>
                    <option value="">🏢 Company level (all branches){dot(company.id)}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.location_name}{dot(b.id)}</option>)}
                    {branches.length === 0 && <option disabled>No branches for this company</option>}
                  </select>
                </div>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: C.purple }}>●</span> = already configured · a branch inherits Branch → Company → Group.
            </div>
          </div>

          {/* ── Configure panel for the selected scope ── */}
          {selection && (
            <div style={{ maxWidth: 660 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>{selection.display_name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Configuring at this level</div>
                </div>
                <span style={{ marginLeft: 'auto' }}><ScopeBadge scopeType={selection.scope_type} /></span>
              </div>

              <LetterheadCard scope={selection} existing={existingLetterhead} onSaved={refresh} />
              <div style={{ marginBottom: 14 }}>
                <SignatoryCard scope={selection} existing={existingSignatory} onSaved={refresh} />
              </div>

              {selection.scope_type === 'BRANCH' && (
                <ResolvedPreview letterhead={resolvedLH} signatory={resolvedSig} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
