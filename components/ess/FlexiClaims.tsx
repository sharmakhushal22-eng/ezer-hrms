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
import { C as TK } from '@/lib/ui'

const V = {
  navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const uid = () => Math.random().toString(36).slice(2, 9)

// One bill being drafted in the uploader. `code` picks the flexi component (bill type).
interface Frame { id: string; code: string; amount: string; billNo: string; billDate: string; vendor: string; files: File[] }
const blankFrame = (code = ''): Frame => ({ id: uid(), code, amount: '', billNo: '', billDate: '', vendor: '', files: [] })

// A single submitted claim (for the History drawer).
interface HistItem { id: string; component_code: string; claim_amount: number; bill_date: string | null; bill_no: string | null; agency_name: string | null; vendor_desc: string | null; remark: string | null; status: string; rejection_reason: string | null; submitted_at: string }

const HIST_STATUS: Record<string, [string, string]> = {
  PENDING: [V.amberBg, V.amber], APPROVED: [V.greenBg, V.green], REJECTED: [V.redBg, V.red], PAYROLL_PROCESSED: [V.purpleBg, V.purpleDark],
}
function HistoryDrawer({ label, items, onClose }: { label: string; items: HistItem[]; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(30,27,75,0.3)' }} />
      <div style={{ width: 380, maxWidth: '92vw', background: V.card, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflowY: 'auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: V.navy }}>{label} — Claim history</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: V.muted }}>×</button>
        </div>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: V.muted, fontSize: 13 }}>No claims submitted yet</div>
        ) : items.map(cl => {
          const [bg, fg] = HIST_STATUS[cl.status] || [TK.brandTint, V.purpleDark]
          return (
            <div key={cl.id} style={{ background: V.card, border: `1px solid ${V.border}`, borderLeft: `3px solid ${fg}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{inr(cl.claim_amount)}</div>
                <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: bg, color: fg, fontWeight: 600 }}>{cl.status.replace(/_/g, ' ')}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, fontSize: 11, color: V.muted }}>
                {cl.bill_date && <span>📅 {new Date(cl.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                {cl.bill_no && <span>🧾 {cl.bill_no}</span>}
                {(cl.agency_name || cl.vendor_desc) && <span>🏪 {cl.agency_name || cl.vendor_desc}</span>}
              </div>
              {cl.remark && <div style={{ fontSize: 11, color: V.muted, marginTop: 4, fontStyle: 'italic' }}>&ldquo;{cl.remark}&rdquo;</div>}
              {cl.status === 'REJECTED' && cl.rejection_reason && (
                <div style={{ marginTop: 6, padding: '5px 8px', background: V.redBg, borderRadius: 7, fontSize: 11, color: V.red }}>⚠ {cl.rejection_reason}</div>
              )}
              <div style={{ fontSize: 10, color: TK.faint, marginTop: 5 }}>Submitted {new Date(cl.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
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
    <div style={{ position: 'relative', width: 64, height: 64, borderRadius: 10, overflow: 'hidden', border: `1px solid ${V.border}`, background: TK.sunken, flexShrink: 0 }}
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
        style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
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
  const inp: React.CSSProperties = {
    padding: '9px 11px', border: `1px solid ${V.border}`, borderRadius: 9, fontSize: 13,
    background: TK.sunken, color: V.navy, outline: 'none', fontFamily: font, boxSizing: 'border-box', width: '100%',
  }
  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: V.muted, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }
  return (
    <div style={{ border: `1px solid ${V.border}`, borderRadius: 14, padding: 16, background: V.card, position: 'relative', boxShadow: '0 1px 3px rgba(30,27,75,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: V.purpleBg, color: V.purpleDark, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{index + 1}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: V.navy }}>Bill {index + 1}</span>
        {frame.code && remaining >= 0 && <span style={{ marginLeft: 'auto', fontSize: 10, color: V.muted }}>Remaining limit <b style={{ color: V.navy }}>{inr(remaining)}</b></span>}
        {canRemove && (
          <button onClick={onRemove} title="Remove this bill"
            style={{ marginLeft: frame.code ? 8 : 'auto', width: 24, height: 24, borderRadius: 7, border: `1px solid ${V.border}`, background: TK.surface, color: V.red, fontSize: 15, lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}>×</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={lbl}>Bill type</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={frame.code} onChange={e => onChange({ code: e.target.value })}>
            <option value="">Select a bill type…</option>
            {options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Amount (₹)</label>
          <input type="number" min={0} placeholder="0" style={{ ...inp, borderColor: over ? V.red : V.border }} value={frame.amount} onChange={e => onChange({ amount: e.target.value })} />
        </div>
      </div>
      {over && <div style={{ fontSize: 10.5, color: V.red, marginTop: -4, marginBottom: 8 }}>⚠ Exceeds the remaining limit ({inr(remaining)})</div>}

      {/* Upload area — multiple files or photos */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)) }}
        style={{
          border: `1.5px dashed ${frame.files.length ? V.purple : V.border}`, borderRadius: 12,
          padding: frame.files.length ? '12px' : '20px 12px', cursor: 'pointer',
          background: frame.files.length ? V.purpleBg : TK.sunken, transition: 'all .15s',
        }}>
        {frame.files.length === 0 ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: V.purpleDark }}>Upload bills — tap to choose photos or files</div>
            <div style={{ fontSize: 10.5, color: V.muted, marginTop: 2 }}>Multiple allowed · JPG PNG PDF WORD EXCEL ZIP</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onClick={e => e.stopPropagation()}>
              {frame.files.map((f, i) => <FileThumb key={i} file={f} onRemove={() => onRemoveFile(i)} />)}
              <div style={{ width: 64, height: 64, borderRadius: 10, border: `1.5px dashed ${V.purple}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.purple, fontSize: 22, cursor: 'pointer', flexShrink: 0 }}
                onClick={() => fileRef.current?.click()} title="Add more files">+</div>
            </div>
            <div style={{ fontSize: 10.5, color: V.purpleDark, marginTop: 8, fontWeight: 600 }}>{frame.files.length} file{frame.files.length > 1 ? 's' : ''} attached</div>
          </div>
        )}
        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = '' }} />
      </div>

      {/* Optional details — kept light so the frame stays about "type + files" */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 8, marginTop: 10 }}>
        <div><label style={lbl}>Bill no. <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label><input type="text" placeholder="INV-2026-001" style={{ ...inp, fontSize: 12, padding: '7px 9px' }} value={frame.billNo} onChange={e => onChange({ billNo: e.target.value })} /></div>
        <div><label style={lbl}>Bill date</label><input type="date" max={new Date().toISOString().slice(0, 10)} style={{ ...inp, fontSize: 12, padding: '7px 9px' }} value={frame.billDate} onChange={e => onChange({ billDate: e.target.value })} /></div>
        <div><label style={lbl}>Vendor</label><input type="text" placeholder="HPCL, Airtel…" style={{ ...inp, fontSize: 12, padding: '7px 9px' }} value={frame.vendor} onChange={e => onChange({ vendor: e.target.value })} /></div>
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

  const card: React.CSSProperties = { background: V.card, border: `1px solid ${V.border}`, borderRadius: 14, padding: 16, marginBottom: 12 }
  const totals = limits.reduce((a, l) => ({ limit: a.limit + l.annual_limit, approved: a.approved + l.approved, pending: a.pending + l.pending, balance: a.balance + (l.annual_limit - l.approved) }), { limit: 0, approved: 0, pending: 0, balance: 0 })
  const activeCount = frames.filter(f => f.code && f.amount && f.files.length).length

  if (status === 'loading') return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading flexi claims…</div>
  if (status === 'nopolicy') return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Flexi Reimbursement</div>
      <div style={{ fontSize: 13, color: V.muted }}>No claimable flexi components are configured for your company &amp; salary band yet. Once HR sets up the flexi policy slabs, your entitlements &amp; bill submission will appear here.</div>
    </div>
  )

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: V.navy, marginBottom: 2 }}>Flexi Reimbursement</div>
      <div style={{ fontSize: 12, color: V.muted, marginBottom: 12 }}>Submit monthly bills for your declared flexi components · {regime === 'old' ? 'Old' : 'New'} regime{slabLabel ? ` · Slab ${slabLabel}` : ''}</div>

      {/* Window banner */}
      {win ? (
        <div style={{ background: isOpen ? V.greenBg : V.redBg, border: `1px solid ${isOpen ? '#BBF7D0' : '#FCA5A5'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{isOpen ? '🟢' : '🔴'}</span>
          <div style={{ flex: 1, fontSize: 12, color: isOpen ? '#065F46' : '#991B1B' }}>
            {isOpen ? <>Window open · submit bills by <b>{new Date(win.closes_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b> · {Math.max(0, Math.ceil((new Date(win.closes_at).getTime() - Date.now()) / 86400000))} days left</> : 'Window closed · bills cannot be submitted right now'}
          </div>
        </div>
      ) : <div style={{ background: V.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: V.amber }}>No submission window is open for this month yet. Contact HR / Payroll.</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[['Annual limit', inr(totals.limit), V.purple], ['Approved', inr(totals.approved), V.green], ['Pending', inr(totals.pending), V.amber], ['Balance', inr(totals.balance), V.navy]].map(([l, v, c]) => (
          <div key={l} style={{ background: TK.sunken, borderRadius: 10, padding: 10, textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700, color: c as string }}>{v}</div><div style={{ fontSize: 10, color: V.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div></div>
        ))}
      </div>

      {/* ── Bill uploader ─────────────────────────────────────────────── */}
      {isOpen && billTypeOptions.length > 0 && (
        <div style={{ borderRadius: 16, marginBottom: 16, overflow: 'hidden', border: `1px solid ${V.border}`, boxShadow: '0 2px 10px rgba(124,58,237,0.08)' }}>
          <div style={{ background: `linear-gradient(120deg, ${V.purple}, ${V.purpleDark})`, padding: '14px 18px', color: TK.onAccent }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Upload your bills</div>
            <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 1 }}>Pick a bill type, enter the amount, attach photos or files. Add as many bills as you like.</div>
          </div>
          <div style={{ padding: 16, background: TK.canvas, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            <button onClick={addFrame}
              style={{ border: `1.5px dashed ${V.purple}`, borderRadius: 12, padding: '12px', background: V.purpleBg, color: V.purpleDark, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ fontSize: 17 }}>＋</span> Add another bill
            </button>

            {/* Submit all */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid ${V.border}`, paddingTop: 12 }}>
              <div style={{ flex: 1, fontSize: 11.5, color: V.muted }}>
                {activeCount > 0 ? <><b style={{ color: V.navy }}>{activeCount}</b> bill{activeCount > 1 ? 's' : ''} ready to submit</> : 'Fill a bill type, amount and file to submit'}
              </div>
              <button disabled={submitting || activeCount === 0} onClick={submitAll}
                style={{ padding: '11px 22px', borderRadius: 11, border: 'none', fontSize: 13, fontWeight: 700, fontFamily: font,
                  background: submitting || activeCount === 0 ? TK.brandTint : V.purple, color: TK.onAccent,
                  cursor: submitting || activeCount === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: submitting || activeCount === 0 ? 'none' : '0 3px 10px rgba(124,58,237,0.3)' }}>
                {submitting ? 'Submitting…' : `Submit ${activeCount || ''} bill${activeCount === 1 ? '' : 's'}`.replace('  ', ' ')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Your entitlements (limits + history) ──────────────────────── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: V.muted, textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 0 8px' }}>Your entitlements</div>
      {limits.map(lim => {
        const noInv = NO_INVOICE.includes(lim.code)
        const remaining = lim.annual_limit - lim.approved - lim.pending
        const usedPct = lim.annual_limit > 0 ? Math.min(100, Math.round((lim.approved / lim.annual_limit) * 100)) : 0
        const exhausted = remaining <= 0
        return (
          <div key={lim.code} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{lim.name}</span>
              {lim.overridden && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: V.purpleBg, color: V.purpleDark, fontWeight: 600 }}>Custom limit</span>}
              {noInv && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: V.greenBg, color: V.green, fontWeight: 600 }}>No invoice needed</span>}
              {exhausted && !noInv && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: V.redBg, color: V.red, fontWeight: 600 }}>Limit exhausted</span>}
              {(() => { const cnt = claimHist.filter(c => c.component_code === lim.code).length; return (
                <button onClick={() => setHistComp(lim.code)} style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 11px', borderRadius: 7, border: `1px solid ${V.border}`, background: TK.surface, color: V.purpleDark, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>History{cnt ? ` (${cnt})` : ''}</button>
              ) })()}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 8 }}>
              {[['Annual limit', inr(lim.annual_limit), V.purple], ['Approved', inr(lim.approved), V.green], ['Pending', inr(lim.pending), V.amber]].map(([l, v, c]) => (
                <div key={l} style={{ background: TK.sunken, borderRadius: 7, padding: 8, textAlign: 'center' }}><div style={{ fontSize: 10, color: V.muted, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{v}</div></div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: V.muted, marginBottom: 3 }}><span>Approved: {usedPct}%</span><span>Remaining: {inr(remaining)}</span></div>
            <div style={{ height: 5, background: V.border, borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${usedPct}%`, background: usedPct >= 100 ? V.red : usedPct >= 80 ? V.amber : V.purple, borderRadius: 3, transition: 'width .3s' }} /></div>
            {lim.rejected > 0 && <div style={{ fontSize: 10, color: V.amber, marginTop: 4 }}>⚠ {inr(lim.rejected)} rejected (not deducted from limit)</div>}

            {noInv && <div style={{ marginTop: 10, fontSize: 11, color: V.muted, background: TK.sunken, borderRadius: 7, padding: '8px 10px' }}>Auto-claimed monthly — no bill submission required. Payroll processes this automatically.</div>}

            {exhausted && !noInv && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', background: V.amberBg, border: `1px solid #FDE68A`, borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ fontSize: 12, color: V.amber, flex: 1 }}>Annual limit reached. You can request an increase from Payroll.</span>
                <button onClick={() => setReqComp(lim.code)} style={{ padding: '5px 12px', background: V.amber, color: TK.onAccent, border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11 }}>Request increase</button>
              </div>
            )}
            {!exhausted && !noInv && (
              <button onClick={() => setReqComp(lim.code)} style={{ marginTop: 10, padding: '6px 12px', background: TK.surface, color: V.navy, border: `1px solid ${V.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontFamily: font }}>Request limit increase</button>
            )}
          </div>
        )
      })}

      {reqComp && (
        <div style={{ background: V.amberBg, border: `1px solid #FDE68A`, borderRadius: 14, padding: 16, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: V.amber, marginBottom: 10 }}>Request limit increase — {limits.find(l => l.code === reqComp)?.name || reqComp}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Requested annual limit (₹)</label><input type="number" style={{ padding: '7px 8px', border: `1px solid #FDE68A`, borderRadius: 7, fontSize: 12, width: '100%', boxSizing: 'border-box', background: TK.surface }} value={reqAmt} onChange={e => setReqAmt(e.target.value)} /></div>
            <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Reason (mandatory)</label><input type="text" placeholder="Official travel increased…" style={{ padding: '7px 8px', border: `1px solid #FDE68A`, borderRadius: 7, fontSize: 12, width: '100%', boxSizing: 'border-box', background: TK.surface }} value={reqReason} onChange={e => setReqReason(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}><button onClick={sendLimitRequest} style={{ padding: '7px 14px', background: V.amber, color: TK.onAccent, border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Send request</button><button onClick={() => setReqComp(null)} style={{ padding: '7px 12px', background: TK.surface, color: V.navy, border: `1px solid ${V.border}`, borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>Cancel</button></div>
        </div>
      )}

      {histComp && <HistoryDrawer label={limits.find(l => l.code === histComp)?.name || histComp} items={claimHist.filter(c => c.component_code === histComp)} onClose={() => setHistComp(null)} />}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: V.navy, color: TK.onAccent, padding: '11px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>{toast}</div>}
    </div>
  )
}
