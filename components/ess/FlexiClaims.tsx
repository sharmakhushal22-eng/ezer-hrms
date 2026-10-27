'use client'
// components/ess/FlexiClaims.tsx — ESS employee flexi reimbursement (bill submission).
// Entitlements derived from the company's flexi policy slab for the employee's band
// (lib/flexi/claims). Bills are submitted through a multi-frame uploader: each frame is
// one bill — pick its type, enter the amount, attach the files (photos or documents) —
// and "+ Add another bill" appends a fresh frame, so a month's bills go in together.
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { loadEntitlements, loadWindow, ComponentLimit, NO_INVOICE, ACCEPTED_TYPES, FY } from '@/lib/flexi/claims'
import {
  C as TK, F, W, S, R, E, Z, tone, eyebrow, numeric, inputStyle, type Tone,
  IconUpload, IconPlus, IconClose, IconCalendar, IconReceipt, IconBuilding, IconAlert, IconLock, IconCard,
} from '@/lib/ui'
import {
  SectionCard, KpiGrid, KpiTile, StatusPill, InfoCallout, PButton, IconTile, IconInfo, IconCheckCircle, IconTimer, IconXCircle, IconFile,
} from '@/components/ess/payroll/kit'
import { SplitMeter, LegendDot, Figure, fieldLabel, Toast, scrim } from '@/components/ess/payroll/claimsKit'

const V = {
  navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const font = F.family
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const uid = () => Math.random().toString(36).slice(2, 9)

// One bill being drafted in the uploader. `code` picks the flexi component (bill type).
interface Frame { id: string; code: string; amount: string; billNo: string; billDate: string; vendor: string; files: File[] }
const blankFrame = (code = ''): Frame => ({ id: uid(), code, amount: '', billNo: '', billDate: '', vendor: '', files: [] })

// A single submitted claim (for the History drawer).
interface HistItem { id: string; component_code: string; claim_amount: number; bill_date: string | null; bill_no: string | null; agency_name: string | null; vendor_desc: string | null; remark: string | null; status: string; rejection_reason: string | null; submitted_at: string }

const HIST_STATUS: Record<string, { t: Tone; icon: React.ReactNode }> = {
  PENDING: { t: 'warning', icon: <IconTimer size={12} /> },
  APPROVED: { t: 'positive', icon: <IconCheckCircle size={12} /> },
  REJECTED: { t: 'critical', icon: <IconXCircle size={12} /> },
  PAYROLL_PROCESSED: { t: 'brand', icon: <IconCheckCircle size={12} /> },
}
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

function HistoryDrawer({ label, items, onClose }: { label: string; items: HistItem[]; onClose: () => void }) {
  const total = items.reduce((a, c) => a + (Number(c.claim_amount) || 0), 0)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: Z.modal, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: scrim }} />
      <div className="ez-slide-l" style={{ width: 400, maxWidth: '92vw', background: TK.canvas, boxShadow: E.overlay, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: Z.raised, background: TK.surface, borderBottom: `1px solid ${TK.line}`, padding: `${S.lg}px ${S.lg}px ${S.md}px`, display: 'flex', alignItems: 'center', gap: S.md }}>
          <IconTile icon={<IconReceipt size={16} />} t="brand" size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink }}>{label}: Claim history</div>
            <div style={{ fontSize: F.micro, color: TK.muted, marginTop: 2, ...numeric }}>{items.length} claim{items.length === 1 ? '' : 's'} · {inr(total)} submitted</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ez-press"
            style={{ width: 32, height: 32, borderRadius: R.md, border: `1px solid ${TK.line}`, background: TK.surface, cursor: 'pointer', color: TK.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconClose size={16} />
          </button>
        </div>
        <div style={{ padding: S.lg }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: TK.muted, fontSize: F.small }}>
              <div style={{ display: 'inline-flex', marginBottom: S.sm }}><IconTile icon={<IconReceipt size={18} />} t="neutral" size={40} /></div>
              <div>No claims submitted yet</div>
            </div>
          ) : items.map(cl => {
            const st = HIST_STATUS[cl.status] || { t: 'brand' as Tone, icon: null }
            return (
              <div key={cl.id} className="ez-rise" style={{ background: TK.surface, border: `1px solid ${TK.line}`, borderLeft: `3px solid ${tone(st.t).fg}`, borderRadius: R.lg, padding: `${S.md}px ${S.md + 2}px`, marginBottom: S.sm + 2, boxShadow: E.flat }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, marginBottom: S.sm }}>
                  <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink, ...numeric }}>{inr(cl.claim_amount)}</div>
                  <StatusPill size="sm" t={st.t} icon={st.icon}>{cl.status.replace(/_/g, ' ')}</StatusPill>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: F.tiny, color: TK.muted }}>
                  {cl.bill_date && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconCalendar size={13} /> {fmtD(cl.bill_date)}</span>}
                  {cl.bill_no && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconReceipt size={13} /> {cl.bill_no}</span>}
                  {(cl.agency_name || cl.vendor_desc) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconBuilding size={13} /> {cl.agency_name || cl.vendor_desc}</span>}
                </div>
                {cl.remark && <div style={{ fontSize: F.tiny, color: TK.inkSoft, marginTop: 6, fontStyle: 'italic' }}>&ldquo;{cl.remark}&rdquo;</div>}
                {cl.status === 'REJECTED' && cl.rejection_reason && (
                  <InfoCallout compact t="critical" style={{ marginTop: S.sm, marginBottom: 0 }}>{cl.rejection_reason}</InfoCallout>
                )}
                <div style={{ fontSize: F.micro, color: TK.faint, marginTop: S.sm }}>Submitted {fmtD(cl.submitted_at)}</div>
              </div>
            )
          })}
        </div>
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
    <div style={{ position: 'relative', width: 72, height: 72, borderRadius: R.md, overflow: 'hidden', border: `1px solid ${TK.lineStrong}`, background: TK.surface, flexShrink: 0, boxShadow: E.flat }}
      title={file.name}>
      {url ? (
        <img src={url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <span style={{ display: 'inline-flex', color: EXT_COL[ext] || V.muted }}><IconFile size={18} /></span>
          <span style={{ fontSize: 10, fontWeight: W.bold, color: EXT_COL[ext] || V.muted }}>{ext}</span>
          <span style={{ fontSize: 8, color: V.muted, padding: '0 4px', textAlign: 'center', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
        </div>
      )}
      <button onClick={onRemove} title="Remove" aria-label={`Remove ${file.name}`}
        style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%', border: 'none', background: TK.dark, color: TK.onDark, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><IconClose size={11} strokeWidth={2.4} /></button>
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
  const inp: React.CSSProperties = { ...inputStyle(), fontFamily: font }
  const lbl = fieldLabel
  const ready = !!(frame.code && frame.amount && frame.files.length)
  return (
    <div className="ez-rise" style={{ border: `1px solid ${ready ? TK.brandEdge : V.border}`, borderRadius: R.lg, padding: S.lg, background: V.card, position: 'relative', boxShadow: E.flat }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: ready ? TK.brand : V.purpleBg, color: ready ? TK.onAccent : V.purpleDark, border: `1px solid ${TK.brandEdge}`, fontSize: F.micro, fontWeight: W.bold, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...numeric }}>{index + 1}</span>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: V.navy }}>Bill {index + 1}</span>
        {ready && <StatusPill size="sm" t="positive" icon={<IconCheckCircle size={11} />}>Ready</StatusPill>}
        {frame.code && remaining >= 0 && <span style={{ marginLeft: 'auto', fontSize: F.micro, color: V.muted, ...numeric }}>Remaining limit <b style={{ color: V.navy }}>{inr(remaining)}</b></span>}
        {canRemove && (
          <button onClick={onRemove} title="Remove this bill" aria-label="Remove this bill" className="ez-press"
            style={{ marginLeft: frame.code ? 8 : 'auto', width: 28, height: 28, borderRadius: R.sm, border: `1px solid ${TK.criticalEdge}`, background: TK.surface, color: V.red, cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><IconClose size={14} /></button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(170px,100%),1fr))', gap: S.sm + 2, marginBottom: S.sm + 2 }}>
        <div style={{ gridColumn: 'span 1' }}>
          <label style={lbl}>Bill type</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={frame.code} onChange={e => onChange({ code: e.target.value })}>
            <option value="">Select a bill type…</option>
            {options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Amount (₹)</label>
          <input type="number" min={0} placeholder="0" style={{ ...inp, ...numeric, borderColor: over ? V.red : TK.lineStrong }} value={frame.amount} onChange={e => onChange({ amount: e.target.value })} />
        </div>
      </div>
      {over && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: F.micro, color: V.red, marginTop: -2, marginBottom: S.sm }}><IconAlert size={13} /> Exceeds the remaining limit ({inr(remaining)})</div>}

      {/* Upload area — multiple files or photos */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)) }}
        style={{
          border: `1.5px dashed ${frame.files.length ? TK.brandEdge : TK.lineStrong}`, borderRadius: R.md,
          padding: frame.files.length ? '12px' : '20px 12px', cursor: 'pointer',
          background: frame.files.length ? V.purpleBg : TK.sunken, transition: 'all .15s',
        }}>
        {frame.files.length === 0 ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <IconTile icon={<IconUpload size={17} />} t="brand" size={36} />
            <div style={{ fontSize: F.small, fontWeight: W.semi, color: V.purpleDark, marginTop: 2 }}>Upload bills: tap to choose photos or files</div>
            <div style={{ fontSize: F.micro, color: V.muted }}>Multiple allowed · JPG PNG PDF WORD EXCEL ZIP</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onClick={e => e.stopPropagation()}>
              {frame.files.map((f, i) => <FileThumb key={i} file={f} onRemove={() => onRemoveFile(i)} />)}
              <div className="ez-press" style={{ width: 72, height: 72, borderRadius: R.md, border: `1.5px dashed ${V.purple}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V.purple, cursor: 'pointer', flexShrink: 0, background: TK.surface }}
                onClick={() => fileRef.current?.click()} title="Add more files"><IconPlus size={20} /></div>
            </div>
            <div style={{ fontSize: F.micro, color: V.purpleDark, marginTop: 8, fontWeight: W.semi }}>{frame.files.length} file{frame.files.length > 1 ? 's' : ''} attached</div>
          </div>
        )}
        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = '' }} />
      </div>

      {/* Optional details — kept light so the frame stays about "type + files" */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: S.sm, marginTop: S.md }}>
        <div><label style={lbl}>Bill no. <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>(optional)</span></label><input type="text" placeholder="INV-2026-001" style={{ ...inp, fontSize: F.tiny, height: 34 }} value={frame.billNo} onChange={e => onChange({ billNo: e.target.value })} /></div>
        <div><label style={lbl}>Bill date</label><input type="date" max={new Date().toISOString().slice(0, 10)} style={{ ...inp, fontSize: F.tiny, height: 34 }} value={frame.billDate} onChange={e => onChange({ billDate: e.target.value })} /></div>
        <div><label style={lbl}>Vendor</label><input type="text" placeholder="HPCL, Airtel…" style={{ ...inp, fontSize: F.tiny, height: 34 }} value={frame.vendor} onChange={e => onChange({ vendor: e.target.value })} /></div>
      </div>
    </div>
  )
}

/** One entitlement (Fuel, Hostel …): figures, approved+pending meter, actions. */
function EntitlementCard({ lim, histCount, onHistory, onRequest }: {
  lim: ComponentLimit; histCount: number; onHistory: () => void; onRequest: () => void
}) {
  const noInv = NO_INVOICE.includes(lim.code)
  const remaining = lim.annual_limit - lim.approved - lim.pending
  const usedPct = lim.annual_limit > 0 ? Math.min(100, Math.round((lim.approved / lim.annual_limit) * 100)) : 0
  const exhausted = remaining <= 0
  return (
    <div className="ez-lift" style={{ background: V.card, border: `1px solid ${V.border}`, borderRadius: R.lg, boxShadow: E.raised, padding: S.lg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.sm + 2, marginBottom: S.md }}>
        <IconTile icon={noInv ? <IconCard size={16} /> : <IconReceipt size={16} />} t={exhausted && !noInv ? 'warning' : 'brand'} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink, lineHeight: 1.3 }}>{lim.name}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
            {lim.overridden && <StatusPill size="sm" t="brand">Custom limit</StatusPill>}
            {noInv && <StatusPill size="sm" t="positive">No invoice needed</StatusPill>}
            {exhausted && !noInv && <StatusPill size="sm" t="critical">Limit exhausted</StatusPill>}
          </div>
        </div>
        <PButton size="sm" variant="secondary" onClick={onHistory}>History{histCount ? ` (${histCount})` : ''}</PButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.display - 4, fontWeight: W.bold, color: exhausted ? TK.muted : TK.ink, letterSpacing: '-.02em', ...numeric }}>{inr(remaining)}</span>
        <span style={{ fontSize: F.tiny, color: TK.muted }}>left of {inr(lim.annual_limit)}</span>
      </div>

      <div style={{ margin: `${S.sm}px 0 6px` }}>
        <SplitMeter total={lim.annual_limit} label={`${lim.name} usage`} parts={[
          { value: lim.approved, t: usedPct >= 100 ? 'critical' : 'positive', label: `Approved ${inr(lim.approved)}` },
          { value: lim.pending, t: 'warning', label: `Pending ${inr(lim.pending)}` },
        ]} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.micro, color: V.muted, marginBottom: S.md, ...numeric }}><span>Approved: {usedPct}%</span><span>Remaining: {inr(remaining)}</span></div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: S.sm }}>
        <Figure label="Annual limit" value={inr(lim.annual_limit)} t="brand" />
        <Figure label="Approved" value={inr(lim.approved)} t="positive" />
        <Figure label="Pending" value={inr(lim.pending)} t="warning" />
      </div>
      {lim.rejected > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: F.micro, color: V.amber, marginTop: S.sm }}><IconAlert size={13} /> {inr(lim.rejected)} rejected (not deducted from limit)</div>}

      {noInv && <InfoCallout compact t="neutral" style={{ marginTop: S.md, marginBottom: 0 }}>Auto-claimed monthly. No bill submission required. Payroll processes this automatically.</InfoCallout>}

      <div style={{ marginTop: 'auto' }}>
        {exhausted && !noInv && (
          <InfoCallout compact t="warning" style={{ marginTop: S.md, marginBottom: 0 }}
            action={<PButton size="sm" variant="primary" onClick={onRequest}>Request increase</PButton>}>
            Annual limit reached. You can request an increase from Payroll.
          </InfoCallout>
        )}
        {!exhausted && !noInv && (
          <div style={{ marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${TK.line}` }}>
            <PButton size="sm" variant="ghost" icon={<IconPlus size={14} />} onClick={onRequest} style={{ paddingLeft: 4 }}>Request limit increase</PButton>
          </div>
        )}
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
  // Display-only: the running total of the bills drafted in the uploader.
  const draftTotal = frames.reduce((a, f) => a + (Number(f.amount) || 0), 0)
  const usedShare = totals.limit > 0 ? (totals.approved + totals.pending) / totals.limit : 0

  if (status === 'loading') return <div style={{ padding: 20, color: V.muted, fontSize: F.small }}>Loading flexi claims…</div>
  if (status === 'nopolicy') return (
    <SectionCard title="Flexi Reimbursement" icon={<IconReceipt size={16} />}>
      <div style={{ fontSize: F.small, color: V.muted, lineHeight: 1.6 }}>No claimable flexi components are configured for your company &amp; salary band yet. Once HR sets up the flexi policy slabs, your entitlements &amp; bill submission will appear here.</div>
    </SectionCard>
  )

  const closesAt = win?.closes_at ? new Date(win.closes_at) : null
  const daysLeft = closesAt ? Math.max(0, Math.ceil((closesAt.getTime() - Date.now()) / 86400000)) : 0

  return (
    <div style={{ fontFamily: font, color: TK.ink }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, marginBottom: S.lg, flexWrap: 'wrap' }}>
        <IconTile icon={<IconReceipt size={18} />} t="brand" size={40} />
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: F.title, fontWeight: W.bold, color: V.navy, letterSpacing: '-.01em' }}>Flexi Reimbursement</div>
          <div style={{ fontSize: F.tiny, color: V.muted, marginTop: 2 }}>Submit monthly bills for your declared flexi components</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill t="brand" dot>{regime === 'old' ? 'Old' : 'New'} regime</StatusPill>
          {slabLabel && <StatusPill t="neutral">Slab {slabLabel}</StatusPill>}
        </div>
      </div>

      {/* Window banner */}
      {win ? (
        isOpen ? (
          <InfoCallout t="positive" title="Window open" icon={<IconCalendar size={17} />}
            action={<StatusPill t="positive" solid>{daysLeft} days left</StatusPill>}>
            Submit bills by <b>{new Date(win.closes_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b>. Each bill needs a type, an amount and at least one photo or file.
          </InfoCallout>
        ) : (
          <InfoCallout t="warning" title="Window closed" icon={<IconLock size={17} />}>
            Window closed · bills cannot be submitted right now. Your entitlements and history below stay available.
          </InfoCallout>
        )
      ) : (
        <InfoCallout t="info" title="No submission window is open for this month yet" icon={<IconCalendar size={17} />}>
          Contact HR / Payroll. Keep your bills safe in the meantime: the uploader appears here as soon as the window opens, and your limits below stay as they are.
        </InfoCallout>
      )}

      {/* Summary */}
      <KpiGrid min={150}>
        <KpiTile label="Annual limit" value={inr(totals.limit)} emphasis icon={<IconCard size={15} />}
          progress={usedShare} progressTone={usedShare >= 1 ? 'critical' : 'brand'}
          sub={`${Math.min(100, Math.round(usedShare * 100))}% used or pending`} />
        <KpiTile label="Approved" value={inr(totals.approved)} t="positive" icon={<IconCheckCircle size={15} />} sub="Paid with salary" />
        <KpiTile label="Pending" value={inr(totals.pending)} t="warning" icon={<IconTimer size={15} />} sub="Waiting for HR approval" />
        <KpiTile label="Balance" value={inr(totals.balance)} sub="Limit minus approved" />
      </KpiGrid>

      {/* Used vs limit, across every entitlement. */}
      {totals.limit > 0 && (
        <div style={{ background: V.card, border: `1px solid ${V.border}`, borderRadius: R.lg, boxShadow: E.flat, padding: `${S.md}px ${S.lg}px`, marginBottom: S.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', marginBottom: S.sm }}>
            <span style={{ ...eyebrow }}>Used vs limit · FY {FY}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: S.md, flexWrap: 'wrap' }}>
              <LegendDot t="positive" label="Approved" value={inr(totals.approved)} />
              <LegendDot t="warning" label="Pending" value={inr(totals.pending)} />
              <LegendDot t="neutral" label="Unused" value={inr(Math.max(0, totals.limit - totals.approved - totals.pending))} />
            </span>
          </div>
          <SplitMeter total={totals.limit} height={10} label="Flexi limit used" parts={[
            { value: totals.approved, t: 'positive', label: `Approved ${inr(totals.approved)}` },
            { value: totals.pending, t: 'warning', label: `Pending ${inr(totals.pending)}` },
          ]} />
        </div>
      )}

      {/* ── Bill uploader ─────────────────────────────────────────────── */}
      {isOpen && billTypeOptions.length > 0 && (
        <SectionCard title="Upload your bills" icon={<IconUpload size={16} />}
          hint="Pick a bill type, enter the amount, attach photos or files. Add as many bills as you like."
          bodyStyle={{ background: TK.canvas, display: 'flex', flexDirection: 'column', gap: S.md }}>
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
          <button onClick={addFrame} className="ez-press"
            style={{ border: `1.5px dashed ${TK.brandEdge}`, borderRadius: R.lg, padding: '12px', background: V.purpleBg, color: V.purpleDark, fontSize: F.small, fontWeight: W.bold, cursor: 'pointer', fontFamily: font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <IconPlus size={16} /> Add another bill
          </button>

          {/* Submit all */}
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', background: V.card, border: `1px solid ${V.border}`, borderRadius: R.lg, padding: `${S.md}px ${S.lg}px`, boxShadow: E.flat }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontSize: F.tiny, color: V.muted }}>
                {activeCount > 0 ? <><b style={{ color: V.navy }}>{activeCount}</b> bill{activeCount > 1 ? 's' : ''} ready to submit</> : 'Fill a bill type, amount and file to submit'}
              </div>
              {draftTotal > 0 && <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink, marginTop: 2, ...numeric }}>{inr(draftTotal)} <span style={{ fontSize: F.micro, fontWeight: W.medium, color: TK.muted }}>total entered</span></div>}
            </div>
            <PButton variant="primary" size="lg" disabled={submitting || activeCount === 0} onClick={submitAll}>
              {submitting ? 'Submitting…' : `Submit ${activeCount || ''} bill${activeCount === 1 ? '' : 's'}`.replace('  ', ' ')}
            </PButton>
          </div>
        </SectionCard>
      )}

      {/* ── Your entitlements (limits + history) ──────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, margin: `${S.xs}px 0 ${S.md}px` }}>
        <span style={{ ...eyebrow }}>Your entitlements</span>
        <span style={{ fontSize: F.micro, color: TK.faint }}>· {limits.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(340px,100%),1fr))', gap: S.md, marginBottom: S.lg }}>
        {limits.map(lim => (
          <EntitlementCard key={lim.code} lim={lim}
            histCount={claimHist.filter(c => c.component_code === lim.code).length}
            onHistory={() => setHistComp(lim.code)}
            onRequest={() => setReqComp(lim.code)} />
        ))}
      </div>

      {reqComp && (
        <SectionCard title={`Request limit increase: ${limits.find(l => l.code === reqComp)?.name || reqComp}`} icon={<IconInfo size={16} />} iconTone="warning"
          hint="Payroll reviews the request. Your current limit stays in force until it is approved."
          style={{ borderColor: TK.warningEdge }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: S.md, marginBottom: S.md }}>
            <div><label style={fieldLabel}>Requested annual limit (₹)</label><input type="number" style={{ ...inputStyle(), ...numeric }} value={reqAmt} onChange={e => setReqAmt(e.target.value)} /></div>
            <div><label style={fieldLabel}>Reason (mandatory)</label><input type="text" placeholder="Official travel increased…" style={inputStyle()} value={reqReason} onChange={e => setReqReason(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
            <PButton variant="primary" onClick={sendLimitRequest}>Send request</PButton>
            <PButton variant="secondary" onClick={() => setReqComp(null)}>Cancel</PButton>
          </div>
        </SectionCard>
      )}

      {histComp && <HistoryDrawer label={limits.find(l => l.code === histComp)?.name || histComp} items={claimHist.filter(c => c.component_code === histComp)} onClose={() => setHistComp(null)} />}

      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
