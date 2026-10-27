'use client'
// components/ess/FlexiClaims.tsx — ESS employee flexi reimbursement (bill submission).
// Entitlements derived from the company's flexi policy slab for the employee's band
// (lib/flexi/claims). Bills are submitted through a multi-frame uploader: each frame is
// one bill — pick its type, enter the amount, attach the files (photos or documents) —
// and "+ Add another bill" appends a fresh frame, so a month's bills go in together.
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { loadEntitlements, loadWindow, ComponentLimit, NO_INVOICE, ACCEPTED_TYPES, FY } from '@/lib/flexi/claims'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, E, R } from '@/lib/ui'
import PayStyles from '@/components/ess/payroll/PayStyles'

const V = {
  navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const uid = () => Math.random().toString(36).slice(2, 9)

// One bill being drafted in the uploader. `code` picks the flexi component (bill type).
interface Frame { id: string; code: string; amount: string; billNo: string; billDate: string; vendor: string; files: File[] }
const blankFrame = (code = ''): Frame => ({ id: uid(), code, amount: '', billNo: '', billDate: '', vendor: '', files: [] })

// A single submitted claim (for the History drawer).
interface HistItem { id: string; component_code: string; claim_amount: number; bill_date: string | null; bill_no: string | null; agency_name: string | null; vendor_desc: string | null; remark: string | null; status: string; rejection_reason: string | null; submitted_at: string }

// Status → chip tone (PayStyles .ezp-chip) and the edge colour of the history card.
const HIST_STATUS: Record<string, [string, string]> = {
  PENDING: ['is-warn', V.amber], APPROVED: ['is-ok', V.green], REJECTED: ['is-bad', V.red], PAYROLL_PROCESSED: ['is-brand', V.purpleDark],
}
function HistoryDrawer({ label, items, onClose }: { label: string; items: HistItem[]; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: `color-mix(in srgb, ${TK.ink} 30%, transparent)` }} />
      <div style={{ width: 380, maxWidth: '92vw', background: TK.canvas, borderLeft: `1px solid ${TK.lineStrong}`, boxShadow: E.overlay, overflowY: 'auto', padding: '20px 16px' }}>
        <div className="ezp-head" style={{ marginBottom: 14 }}>
          <h3>{label}: Claim history</h3>
          <button className="ezp-ghost" onClick={onClose} style={{ marginLeft: 'auto', width: 32, padding: 0, fontSize: 18 }}>×</button>
        </div>
        {items.length === 0 ? (
          <div className="ezp-empty">No claims submitted yet</div>
        ) : items.map(cl => {
          const [cls, fg] = HIST_STATUS[cl.status] || ['is-brand', V.purpleDark]
          return (
            <div key={cl.id} className="ezp-panel" style={{ borderLeft: `3px solid ${fg}`, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div className="ezp-num" style={{ fontSize: 15, fontWeight: 700 }}>{inr(cl.claim_amount)}</div>
                <span className={`ezp-chip ${cls}`}>{cl.status.replace(/_/g, ' ')}</span>
              </div>
              <div className="ezp-muted" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, fontSize: 11.5 }}>
                {cl.bill_date && <span>📅 {new Date(cl.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                {cl.bill_no && <span>🧾 {cl.bill_no}</span>}
                {(cl.agency_name || cl.vendor_desc) && <span>🏪 {cl.agency_name || cl.vendor_desc}</span>}
              </div>
              {cl.remark && <div className="ezp-muted" style={{ fontSize: 11.5, marginTop: 4, fontStyle: 'italic' }}>&ldquo;{cl.remark}&rdquo;</div>}
              {cl.status === 'REJECTED' && cl.rejection_reason && (
                <div className="ezp-note is-bad" style={{ margin: '8px 0 0', padding: '7px 10px', fontSize: 11.5 }}>⚠ {cl.rejection_reason}</div>
              )}
              <div style={{ fontSize: 10.5, color: TK.faint, marginTop: 6 }}>Submitted {new Date(cl.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A file thumbnail: a real image preview for photos, a coloured extension tile for docs.
const EXT_COL: Record<string, string> = { PDF: V.red, JPG: V.amber, JPEG: V.amber, PNG: V.green, ZIP: V.purple, DOC: TK.info, DOCX: TK.info, XLS: V.green, XLSX: V.green }
function FileThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const u = URL.createObjectURL(file); setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const ext = file.name.split('.').pop()?.toUpperCase() || '?'
  return (
    <div style={{ position: 'relative', width: 64, height: 64, borderRadius: R.md, overflow: 'hidden', border: `1px solid ${TK.lineStrong}`, background: TK.surface, flexShrink: 0 }}
      title={file.name}>
      {url ? (
        <img src={url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: EXT_COL[ext] || V.muted }}>{ext}</span>
          <span style={{ fontSize: 7.5, color: V.muted, padding: '0 4px', textAlign: 'center', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
        </div>
      )}
      <button onClick={onRemove} title="Remove"
        style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: `color-mix(in srgb, ${TK.ink} 72%, transparent)`, color: TK.surface, fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
    </div>
  )
}

// One bill frame in the uploader. Defined OUTSIDE the parent so typing in a field
// does not remount the frame and steal focus.
function BillFrame({ frame, index, options, remaining, canRemove, onChange, onFiles, onRemoveFile, onRemove }: {
  frame: Frame
  index: number
  options: { code: string; name: string; remaining: number }[]
  remaining: number
  canRemove: boolean
  onChange: (patch: Partial<Frame>) => void
  onFiles: (f: File[]) => void
  onRemoveFile: (i: number) => void
  onRemove: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const over = frame.amount !== '' && remaining >= 0 && Number(frame.amount) > remaining
  return (
    <div style={{ border: `1px solid ${TK.line}`, borderRadius: R.lg, padding: 14, background: TK.sunken, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: V.purpleBg, border: `1px solid ${TK.brandEdge}`, color: V.purpleDark, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{index + 1}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: V.navy }}>Bill {index + 1}</span>
        {frame.code && remaining >= 0 && <span className="ezp-muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>Remaining limit <b className="ezp-num" style={{ color: V.navy }}>{inr(remaining)}</b></span>}
        {canRemove && (
          <button className="ezp-ghost is-danger" onClick={onRemove} title="Remove this bill"
            style={{ marginLeft: frame.code ? 8 : 'auto', width: 28, height: 28, padding: 0, fontSize: 15, flexShrink: 0 }}>×</button>
        )}
      </div>

      <div className="ezp-grid2" style={{ marginBottom: 10 }}>
        <div>
          <label className="ezp-label">Bill type</label>
          <select className="ezp-input" style={{ cursor: 'pointer' }} value={frame.code} onChange={e => onChange({ code: e.target.value })}>
            <option value="">Select a bill type…</option>
            {options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="ezp-label">Amount (₹)</label>
          <input className="ezp-input ezp-num" type="number" min={0} placeholder="0" style={over ? { borderColor: V.red } : undefined} value={frame.amount} onChange={e => onChange({ amount: e.target.value })} />
        </div>
      </div>
      {over && <div className="ezp-bad" style={{ fontSize: 11.5, marginTop: -4, marginBottom: 8 }}>⚠ Exceeds the remaining limit ({inr(remaining)})</div>}

      {/* Upload area — multiple files or photos */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)) }}
        style={{
          border: `1.5px dashed ${frame.files.length ? TK.brandEdge : TK.lineStrong}`, borderRadius: R.md,
          padding: frame.files.length ? '12px' : '20px 12px', cursor: 'pointer',
          background: frame.files.length ? V.purpleBg : TK.surface, transition: 'all .15s',
        }}>
        {frame.files.length === 0 ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: V.purpleDark }}>Upload bills: tap to choose photos or files</div>
            <div className="ezp-muted" style={{ fontSize: 11, marginTop: 2 }}>Multiple allowed · JPG PNG PDF WORD EXCEL ZIP</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onClick={e => e.stopPropagation()}>
              {frame.files.map((f, i) => <FileThumb key={i} file={f} onRemove={() => onRemoveFile(i)} />)}
              <div style={{ width: 64, height: 64, borderRadius: R.md, border: `1.5px dashed ${TK.brandEdge}`, background: TK.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.purple, fontSize: 22, cursor: 'pointer', flexShrink: 0 }}
                onClick={() => fileRef.current?.click()} title="Add more files">+</div>
            </div>
            <div style={{ fontSize: 11, color: V.purpleDark, marginTop: 8, fontWeight: 600 }}>{frame.files.length} file{frame.files.length > 1 ? 's' : ''} attached</div>
          </div>
        )}
        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = '' }} />
      </div>

      {/* Optional details — kept light so the frame stays about "type + files" */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginTop: 12 }}>
        <div><label className="ezp-label">Bill no. <span style={{ fontWeight: 400, color: TK.muted }}>(optional)</span></label><input className="ezp-input" type="text" placeholder="INV-2026-001" value={frame.billNo} onChange={e => onChange({ billNo: e.target.value })} /></div>
        <div><label className="ezp-label">Bill date</label><input className="ezp-input" type="date" max={new Date().toISOString().slice(0, 10)} value={frame.billDate} onChange={e => onChange({ billDate: e.target.value })} /></div>
        <div><label className="ezp-label">Vendor</label><input className="ezp-input" type="text" placeholder="HPCL, Airtel…" value={frame.vendor} onChange={e => onChange({ vendor: e.target.value })} /></div>
      </div>
    </div>
  )
}

export default function FlexiClaims({ employeeId }: { employeeId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'nopolicy'>('loading')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [regime, setRegime] = useState<'old' | 'new'>('old')
  const [slabLabel, setSlabLabel] = useState<string | null>(null)
  const [limits, setLimits] = useState<ComponentLimit[]>([])
  const [win, setWin] = useState<any>(null)
  const [frames, setFrames] = useState<Frame[]>([blankFrame()])
  const [submitting, setSubmitting] = useState(false)
  const [reqComp, setReqComp] = useState<string | null>(null)
  const [reqAmt, setReqAmt] = useState(''); const [reqReason, setReqReason] = useState('')
  const [toast, setToast] = useState('')
  const [claimHist, setClaimHist] = useState<HistItem[]>([])
  const [histComp, setHistComp] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  const load = useCallback(async () => {
    setStatus('loading')
    const ent = await loadEntitlements(employeeId)
    setCompanyId(ent.companyId); setRegime(ent.regime); setSlabLabel(ent.slabLabel); setLimits(ent.limits)
    if (ent.companyId) {
      const now = new Date()
      setWin(await loadWindow(ent.companyId, now.getFullYear(), now.getMonth() + 1))
    }
    // Employee's own submitted claims — powers the per-component History drawer.
    fetch(`/api/flexi/claims?employee_id=${employeeId}`).then(r => r.json()).then(r => setClaimHist(r.claims || [])).catch(() => setClaimHist([]))
    setStatus(ent.limits.length ? 'ready' : 'nopolicy')
  }, [employeeId])
  useEffect(() => { load() }, [load])

  const remainingOf = (code: string) => {
    const l = limits.find(x => x.code === code)
    return l ? l.annual_limit - l.approved - l.pending : -1
  }
  // The bill types the uploader offers: everything that needs a bill and still has room.
  const billTypeOptions = limits
    .filter(l => !NO_INVOICE.includes(l.code) && (l.annual_limit - l.approved - l.pending) > 0)
    .map(l => ({ code: l.code, name: l.name, remaining: l.annual_limit - l.approved - l.pending }))

  const setFrame = (id: string, patch: Partial<Frame>) => setFrames(p => p.map(f => f.id === id ? { ...f, ...patch } : f))
  const addFrameFiles = (id: string, files: File[]) => setFrames(p => p.map(f => f.id === id ? { ...f, files: [...f.files, ...files] } : f))
  const removeFrameFile = (id: string, i: number) => setFrames(p => p.map(f => f.id === id ? { ...f, files: f.files.filter((_, j) => j !== i) } : f))
  const addFrame = () => setFrames(p => [...p, blankFrame()])
  const removeFrame = (id: string) => setFrames(p => p.length > 1 ? p.filter(f => f.id !== id) : p)

  const isOpen = win?.status === 'OPEN'

  async function submitAll() {
    if (!isOpen) return showToast('Submission window is closed')
    // Validate every frame the employee actually started.
    const active = frames.filter(f => f.code || f.amount || f.files.length)
    if (!active.length) return showToast('Add at least one bill')
    for (const f of active) {
      if (!f.code) return showToast(`Bill ${frames.indexOf(f) + 1}: choose a bill type`)
      if (!f.amount || Number(f.amount) <= 0) return showToast(`Bill ${frames.indexOf(f) + 1}: enter an amount`)
      const rem = remainingOf(f.code)
      if (rem >= 0 && Number(f.amount) > rem) return showToast(`Bill ${frames.indexOf(f) + 1}: amount exceeds the remaining limit (${inr(rem)})`)
      if (f.files.length === 0) return showToast(`Bill ${frames.indexOf(f) + 1}: attach at least one file`)
    }

    setSubmitting(true)
    let ok = 0
    const fails: string[] = []
    for (const f of active) {
      const res = await fetch('/api/flexi/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'SUBMIT', window_id: win.id, employee_id: employeeId, company_id: companyId,
        component_code: f.code, claim_amount: Number(f.amount), bill_date: f.billDate || null,
        bill_no: f.billNo || null, agency_name: f.vendor || null, vendor_desc: f.vendor || null,
      }) }).then(r => r.json()).catch(e => ({ error: e.message }))
      if (res.error || !res.claim_id) { fails.push(`${f.code}: ${res.error || 'failed'}`); continue }
      for (const file of f.files) {
        const path = `flexi-claims/${employeeId}/${res.claim_id}/${Date.now()}_${file.name}`
        const { data: up } = await supabase.storage.from('flexi-bills').upload(path, file)
        if (up) await supabase.from('flexi_claim_files').insert({ claim_id: res.claim_id, employee_id: employeeId, file_type: 'BILL', file_name: file.name, file_url: path, file_size: file.size, mime_type: file.type })
      }
      ok++
    }
    setSubmitting(false)
    setFrames([blankFrame()])
    load()
    if (fails.length) showToast(`${ok} submitted · ${fails.length} failed (${fails[0]})`)
    else showToast(`${ok} bill${ok > 1 ? 's' : ''} submitted · pending HR approval`)
  }

  async function sendLimitRequest() {
    if (!reqComp || !reqAmt || !reqReason.trim()) return showToast('All fields are required')
    const lim = limits.find(l => l.code === reqComp)
    const res = await fetch('/api/flexi/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REQUEST_LIMIT', employee_id: employeeId, company_id: companyId, fy: FY, component_code: reqComp, current_limit: lim?.annual_limit || 0, requested_limit: Number(reqAmt), reason: reqReason }) }).then(r => r.json())
    if (res.error) return showToast('⚠ ' + res.error)
    setReqComp(null); setReqAmt(''); setReqReason(''); showToast('Limit-increase request sent to Payroll')
  }

  const totals = limits.reduce((a, l) => ({ limit: a.limit + l.annual_limit, approved: a.approved + l.approved, pending: a.pending + l.pending, balance: a.balance + (l.annual_limit - l.approved) }), { limit: 0, approved: 0, pending: 0, balance: 0 })
  const activeCount = frames.filter(f => f.code && f.amount && f.files.length).length

  if (status === 'loading') return <div className="ezp ezp-muted" style={{ padding: 20 }}>Loading flexi claims…</div>
  if (status === 'nopolicy') return (
    <div className="ezp">
      <PayStyles />
      <div className="ezp-panel">
        <div className="ezp-head"><h3>Flexi Reimbursement</h3></div>
        <div className="ezp-empty">No claimable flexi components are configured for your company &amp; salary band yet. Once HR sets up the flexi policy slabs, your entitlements &amp; bill submission will appear here.</div>
      </div>
    </div>
  )

  return (
    <div className="ezp">
      <PayStyles />
      <div className="ezp-title">
        <div>
          <h2>Flexi Reimbursement</h2>
          <p>Submit monthly bills for your declared flexi components · {regime === 'old' ? 'Old' : 'New'} regime{slabLabel ? ` · Slab ${slabLabel}` : ''}</p>
        </div>
      </div>

      {/* Window banner */}
      {win ? (
        <div className={`ezp-note ${isOpen ? 'is-ok' : 'is-bad'}`}>
          {isOpen ? <>Window open · submit bills by <b>{new Date(win.closes_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b> · {Math.max(0, Math.ceil((new Date(win.closes_at).getTime() - Date.now()) / 86400000))} days left</> : 'Window closed · bills cannot be submitted right now'}
        </div>
      ) : <div className="ezp-note is-warn">No submission window is open for this month yet. Contact HR / Payroll.</div>}

      {/* Summary */}
      <section className="ezp-hero">
        <p className="ezp-hero-label">Annual limit</p>
        <p className="ezp-hero-num"><b>{inr(totals.limit)}</b></p>
        <div className="ezp-tiles">
          <div className="ezp-tile"><div className="ezp-tile-name">Approved</div><div className="ezp-tile-num ezp-ok">{inr(totals.approved)}</div></div>
          <div className="ezp-tile"><div className="ezp-tile-name">Pending</div><div className="ezp-tile-num ezp-warn">{inr(totals.pending)}</div></div>
          <div className="ezp-tile"><div className="ezp-tile-name">Balance</div><div className="ezp-tile-num">{inr(totals.balance)}</div></div>
        </div>
      </section>

      {/* ── Bill uploader ─────────────────────────────────────────────── */}
      {isOpen && billTypeOptions.length > 0 && (
        <div className="ezp-panel">
          <div className="ezp-head"><h3>Upload your bills</h3></div>
          <p className="ezp-sub">Pick a bill type, enter the amount, attach photos or files. Add as many bills as you like.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {frames.map((f, i) => (
              <BillFrame
                key={f.id}
                frame={f}
                index={i}
                options={billTypeOptions}
                remaining={f.code ? remainingOf(f.code) : -1}
                canRemove={frames.length > 1}
                onChange={patch => setFrame(f.id, patch)}
                onFiles={files => addFrameFiles(f.id, files)}
                onRemoveFile={idx => removeFrameFile(f.id, idx)}
                onRemove={() => removeFrame(f.id)}
              />
            ))}

            {/* Add another frame */}
            <button className="ezp-ghost" onClick={addFrame}
              style={{ height: 42, width: '100%', borderStyle: 'dashed', borderColor: TK.brandEdge, background: V.purpleBg, color: V.purpleDark, fontSize: 13 }}>
              <span style={{ fontSize: 16 }}>＋</span> Add another bill
            </button>

            {/* Submit all */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid ${TK.line}`, paddingTop: 12, flexWrap: 'wrap' }}>
              <div className="ezp-muted" style={{ flex: 1, fontSize: 12 }}>
                {activeCount > 0 ? <><b style={{ color: V.navy }}>{activeCount}</b> bill{activeCount > 1 ? 's' : ''} ready to submit</> : 'Fill a bill type, amount and file to submit'}
              </div>
              <button className="ezp-btn" disabled={submitting || activeCount === 0} onClick={submitAll}>
                {submitting ? 'Submitting…' : `Submit ${activeCount || ''} bill${activeCount === 1 ? '' : 's'}`.replace('  ', ' ')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Your entitlements (limits + history) ──────────────────────── */}
      <div className="ezp-head" style={{ margin: '4px 0 10px' }}><h3>Your entitlements</h3></div>
      {limits.map(lim => {
        const noInv = NO_INVOICE.includes(lim.code)
        const remaining = lim.annual_limit - lim.approved - lim.pending
        const usedPct = lim.annual_limit > 0 ? Math.min(100, Math.round((lim.approved / lim.annual_limit) * 100)) : 0
        const exhausted = remaining <= 0
        return (
          <div key={lim.code} className="ezp-panel">
            <div className="ezp-head">
              <h3>{lim.name}</h3>
              {lim.overridden && <span className="ezp-chip is-brand">Custom limit</span>}
              {noInv && <span className="ezp-chip is-ok">No invoice needed</span>}
              {exhausted && !noInv && <span className="ezp-chip is-bad">Limit exhausted</span>}
              {(() => { const cnt = claimHist.filter(c => c.component_code === lim.code).length; return (
                <button className="ezp-ghost" onClick={() => setHistComp(lim.code)} style={{ marginLeft: 'auto' }}>History{cnt ? ` (${cnt})` : ''}</button>
              ) })()}
            </div>
            <div className="ezp-stats" style={{ marginBottom: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div className="ezp-stat"><div className="ezp-stat-name">Annual limit</div><div className="ezp-stat-num is-brand">{inr(lim.annual_limit)}</div></div>
              <div className="ezp-stat"><div className="ezp-stat-name">Approved</div><div className="ezp-stat-num is-ok">{inr(lim.approved)}</div></div>
              <div className="ezp-stat"><div className="ezp-stat-name">Pending</div><div className="ezp-stat-num is-warn">{inr(lim.pending)}</div></div>
            </div>
            <div className="ezp-meter"><i className={usedPct >= 100 ? 'is-bad' : usedPct >= 80 ? 'is-warn' : ''} style={{ width: `${usedPct}%` }} /></div>
            <div className="ezp-meter-cap"><span>Approved: {usedPct}%</span><span>Remaining: {inr(remaining)}</span></div>
            {lim.rejected > 0 && <div className="ezp-warn" style={{ fontSize: 11.5, marginTop: 6 }}>⚠ {inr(lim.rejected)} rejected (not deducted from limit)</div>}

            {noInv && <div className="ezp-note" style={{ margin: '12px 0 0' }}>Auto-claimed monthly. No bill submission required. Payroll processes this automatically.</div>}

            {exhausted && !noInv && (
              <div className="ezp-note is-warn" style={{ margin: '12px 0 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 200 }}>Annual limit reached. You can request an increase from Payroll.</span>
                <button className="ezp-ghost" onClick={() => setReqComp(lim.code)}>Request increase</button>
              </div>
            )}
            {!exhausted && !noInv && (
              <button className="ezp-ghost" onClick={() => setReqComp(lim.code)} style={{ marginTop: 12 }}>Request limit increase</button>
            )}
          </div>
        )
      })}

      {reqComp && (
        <div className="ezp-panel" style={{ borderColor: TK.warningEdge }}>
          <div className="ezp-head"><h3>Request limit increase: {limits.find(l => l.code === reqComp)?.name || reqComp}</h3></div>
          <div className="ezp-grid2" style={{ marginBottom: 12 }}>
            <div><label className="ezp-label">Requested annual limit (₹)</label><input className="ezp-input ezp-num" type="number" value={reqAmt} onChange={e => setReqAmt(e.target.value)} /></div>
            <div><label className="ezp-label">Reason (mandatory)</label><input className="ezp-input" type="text" placeholder="Official travel increased…" value={reqReason} onChange={e => setReqReason(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="ezp-btn" onClick={sendLimitRequest}>Send request</button><button className="ezp-ghost" onClick={() => setReqComp(null)} style={{ height: 38 }}>Cancel</button></div>
        </div>
      )}

      {histComp && <HistoryDrawer label={limits.find(l => l.code === histComp)?.name || histComp} items={claimHist.filter(c => c.component_code === histComp)} onClose={() => setHistComp(null)} />}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: V.navy, color: TK.onAccent, padding: '11px 18px', borderRadius: R.md, fontSize: 13, fontWeight: 600, boxShadow: E.floating }}>{toast}</div>}
    </div>
  )
}
