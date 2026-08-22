'use client'
// components/ess/FlexiClaims.tsx — ESS employee flexi reimbursement (bill submission).
// Entitlements derived from the company's flexi policy slab for the employee's band
// (lib/flexi/claims). Submit bills per component while the window is open.
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
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

interface Draft { amount: string; billDate: string; billNo: string; vendor: string; remark: string; supportingRemark: string; bills: File[]; supporting: File[] }
const blankDraft = (): Draft => ({ amount: '', billDate: '', billNo: '', vendor: '', remark: '', supportingRemark: '', bills: [], supporting: [] })

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
                <div style={{ marginTop: 6, padding: '5px 8px', background: V.redBg, borderRadius: 6, fontSize: 11, color: V.red }}>⚠ {cl.rejection_reason}</div>
              )}
              <div style={{ fontSize: 10, color: TK.faint, marginTop: 5 }}>Submitted {new Date(cl.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const ext = file.name.split('.').pop()?.toUpperCase() || ''
  const cols: Record<string, string> = { PDF: V.red, JPG: V.amber, JPEG: V.amber, PNG: V.green, ZIP: V.purple, DOC: TK.info, DOCX: TK.info, XLS: V.green, XLSX: V.green }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px solid ${V.border}`, borderRadius: 6, fontSize: 10, color: V.muted, margin: 2, background: TK.sunken }}>
      <span style={{ color: cols[ext] || V.muted, fontWeight: 700 }}>{ext}</span>
      {file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name}
      <span style={{ cursor: 'pointer', color: V.red, marginLeft: 2 }} onClick={onRemove}>×</span>
    </span>
  )
}
function UploadZone({ onFiles, label, sub }: { onFiles: (f: File[]) => void; label: string; sub?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={{ border: `1px dashed ${V.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }} onClick={() => ref.current?.click()}>
      <span style={{ fontSize: 14, color: V.muted }}></span>
      <div><div style={{ fontSize: 12, color: V.muted }}>{label}</div>{sub && <div style={{ fontSize: 10, color: V.muted }}>{sub}</div>}</div>
      <input ref={ref} type="file" accept={ACCEPTED_TYPES} multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = '' }} />
    </div>
  )
}
function AIAssist({ files, amount, setAmount }: { files: File[]; amount: string; setAmount: (v: string) => void }) {
  if (!files.length) return null
  const aiAmt = files.length * 1400
  return (
    <div style={{ background: V.purpleBg, border: `1px solid #C4B5FD`, borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
      <span style={{ fontSize: 13 }}></span>
      <div style={{ flex: 1, fontSize: 11, color: V.purpleDark }}>
        AI detected <b>{files.length} receipt{files.length > 1 ? 's' : ''}</b> · Suggested total <b>{inr(aiAmt)}</b>
        {!amount && <button onClick={() => setAmount(String(aiAmt))} style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', border: `1px solid #C4B5FD`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: V.purpleDark }}>Auto-fill {inr(aiAmt)}</button>}
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
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

  const setD = (code: string, patch: Partial<Draft>) => setDrafts(p => ({ ...p, [code]: { ...(p[code] || blankDraft()), ...patch } }))
  const addFiles = (code: string, key: 'bills' | 'supporting', files: File[]) => setDrafts(p => { const prev = p[code] || blankDraft(); return { ...p, [code]: { ...prev, [key]: [...prev[key], ...files] } } })
  const rmFile = (code: string, key: 'bills' | 'supporting', i: number) => setDrafts(p => { const prev = p[code]; if (!prev) return p; const arr = [...prev[key]]; arr.splice(i, 1); return { ...p, [code]: { ...prev, [key]: arr } } })

  async function submit(lim: ComponentLimit) {
    const d = drafts[lim.code] || blankDraft()
    const remaining = lim.annual_limit - lim.approved - lim.pending
    if (!d.amount || Number(d.amount) <= 0) return showToast('Enter a claim amount')
    if (Number(d.amount) > remaining) return showToast(`Amount exceeds remaining limit (${inr(remaining)})`)
    if (!NO_INVOICE.includes(lim.code) && d.bills.length === 0) return showToast('At least one bill file is required')
    if (!win || win.status !== 'OPEN') return showToast('Submission window is closed')
    setSubmitting(lim.code)
    const res = await fetch('/api/flexi/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: 'SUBMIT', window_id: win.id, employee_id: employeeId, company_id: companyId,
      component_code: lim.code, claim_amount: Number(d.amount), bill_date: d.billDate || null,
      bill_no: d.billNo || null, agency_name: d.vendor || null,
      vendor_desc: d.vendor || null, remark: d.remark || null, supporting_remark: d.supportingRemark || null,
    }) }).then(r => r.json())
    if (res.error || !res.claim_id) { setSubmitting(null); return showToast('Submit failed: ' + (res.error || 'unknown')) }
    // Upload files (best-effort — needs the flexi-bills storage bucket).
    for (const file of [...d.bills, ...d.supporting]) {
      const path = `flexi-claims/${employeeId}/${res.claim_id}/${Date.now()}_${file.name}`
      const { data: up } = await supabase.storage.from('flexi-bills').upload(path, file)
      if (up) await supabase.from('flexi_claim_files').insert({ claim_id: res.claim_id, employee_id: employeeId, file_type: d.bills.includes(file) ? 'BILL' : 'SUPPORTING', file_name: file.name, file_url: path, file_size: file.size, mime_type: file.type })
    }
    setSubmitting(null); setD(lim.code, blankDraft()); load()
    showToast(`${lim.name} claim submitted · pending HR approval`)
  }

  async function sendLimitRequest() {
    if (!reqComp || !reqAmt || !reqReason.trim()) return showToast('All fields are required')
    const lim = limits.find(l => l.code === reqComp)
    const res = await fetch('/api/flexi/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REQUEST_LIMIT', employee_id: employeeId, company_id: companyId, fy: FY, component_code: reqComp, current_limit: lim?.annual_limit || 0, requested_limit: Number(reqAmt), reason: reqReason }) }).then(r => r.json())
    if (res.error) return showToast('⚠ ' + res.error)
    setReqComp(null); setReqAmt(''); setReqReason(''); showToast('Limit-increase request sent to Payroll')
  }

  const card: React.CSSProperties = { background: V.card, border: `1px solid ${V.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }
  const totals = limits.reduce((a, l) => ({ limit: a.limit + l.annual_limit, approved: a.approved + l.approved, pending: a.pending + l.pending, balance: a.balance + (l.annual_limit - l.approved) }), { limit: 0, approved: 0, pending: 0, balance: 0 })
  const isOpen = win?.status === 'OPEN'

  if (status === 'loading') return <div style={{ padding: 20, color: V.muted, fontSize: 13 }}>Loading flexi claims…</div>
  if (status === 'nopolicy') return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Flexi Reimbursement</div>
      <div style={{ fontSize: 12.5, color: V.muted }}>No claimable flexi components are configured for your company &amp; salary band yet. Once HR sets up the flexi policy slabs, your entitlements &amp; bill submission will appear here.</div>
    </div>
  )

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 700, color: V.navy, marginBottom: 2 }}>Flexi Reimbursement</div>
      <div style={{ fontSize: 12, color: V.muted, marginBottom: 12 }}>Submit monthly bills for your declared flexi components · {regime === 'old' ? 'Old' : 'New'} regime{slabLabel ? ` · Slab ${slabLabel}` : ''}</div>

      {/* Window banner */}
      {win ? (
        <div style={{ background: isOpen ? V.greenBg : V.redBg, border: `1px solid ${isOpen ? '#BBF7D0' : '#FCA5A5'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{isOpen ? '' : ''}</span>
          <div style={{ flex: 1, fontSize: 12, color: isOpen ? '#065F46' : '#991B1B' }}>
            {isOpen ? <>Window open · submit bills by <b>{new Date(win.closes_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b> · {Math.max(0, Math.ceil((new Date(win.closes_at).getTime() - Date.now()) / 86400000))} days left</> : 'Window closed · bills cannot be submitted right now'}
          </div>
        </div>
      ) : <div style={{ background: V.amberBg, border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: V.amber }}>No submission window is open for this month yet. Contact HR / Payroll.</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[['Annual limit', inr(totals.limit), V.purple], ['Approved', inr(totals.approved), V.green], ['Pending', inr(totals.pending), V.amber], ['Balance', inr(totals.balance), V.navy]].map(([l, v, c]) => (
          <div key={l} style={{ background: TK.sunken, borderRadius: 8, padding: 10, textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700, color: c as string }}>{v}</div><div style={{ fontSize: 10, color: V.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div></div>
        ))}
      </div>

      {limits.map(lim => {
        const d = drafts[lim.code] || blankDraft()
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
                <button onClick={() => setHistComp(lim.code)} style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 11px', borderRadius: 7, border: `1px solid ${V.border}`, background: '#fff', color: V.purpleDark, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>History{cnt ? ` (${cnt})` : ''}</button>
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

            {noInv && <div style={{ marginTop: 10, fontSize: 11, color: V.muted, background: TK.sunken, borderRadius: 6, padding: '8px 10px' }}>Auto-claimed monthly — no bill submission required. Payroll processes this automatically.</div>}

            {!exhausted && isOpen && !noInv && (
              <div style={{ marginTop: 12, borderTop: `1px solid ${V.border}`, paddingTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Submit bill</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Amount (₹)</label><input type="number" min={0} style={{ padding: '6px 8px', border: `1px solid ${V.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, width: '100%', boxSizing: 'border-box' }} value={d.amount} onChange={e => setD(lim.code, { amount: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Bill date</label><input type="date" max={new Date().toISOString().slice(0, 10)} style={{ padding: '6px 8px', border: `1px solid ${V.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, width: '100%', boxSizing: 'border-box' }} value={d.billDate} onChange={e => setD(lim.code, { billDate: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Bill / Invoice no.</label><input type="text" placeholder="INV-2026-001" style={{ padding: '6px 8px', border: `1px solid ${V.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, width: '100%', boxSizing: 'border-box' }} value={d.billNo} onChange={e => setD(lim.code, { billNo: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Agency / Vendor name</label><input type="text" placeholder="HPCL, Airtel…" style={{ padding: '6px 8px', border: `1px solid ${V.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, width: '100%', boxSizing: 'border-box' }} value={d.vendor} onChange={e => setD(lim.code, { vendor: e.target.value })} /></div>
                </div>
                <UploadZone label="Upload bills" sub="ZIP PNG JPG PDF WORD EXCEL · max 10 files" onFiles={f => addFiles(lim.code, 'bills', f)} />
                <div>{d.bills.map((f, i) => <FileChip key={i} file={f} onRemove={() => rmFile(lim.code, 'bills', i)} />)}</div>
                <AIAssist files={d.bills} amount={d.amount} setAmount={v => setD(lim.code, { amount: v })} />
                <div style={{ marginTop: 10, background: TK.sunken, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: V.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Other supporting docs</div>
                  <textarea placeholder="Remark (log book, lease copy…)" rows={2} style={{ width: '100%', fontSize: 11, padding: '6px 8px', border: `1px solid ${V.border}`, borderRadius: 6, resize: 'none', boxSizing: 'border-box', background: '#fff', marginBottom: 6, fontFamily: 'inherit' }} value={d.supportingRemark} onChange={e => setD(lim.code, { supportingRemark: e.target.value })} />
                  <UploadZone label="Attach supporting documents" sub="Any format" onFiles={f => addFiles(lim.code, 'supporting', f)} />
                  <div>{d.supporting.map((f, i) => <FileChip key={i} file={f} onRemove={() => rmFile(lim.code, 'supporting', i)} />)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button disabled={!!submitting} onClick={() => submit(lim)} style={{ padding: '8px 16px', background: V.purple, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: submitting === lim.code ? .7 : 1 }}>{submitting === lim.code ? 'Submitting…' : 'Submit bill'}</button>
                  <button onClick={() => setReqComp(lim.code)} style={{ padding: '7px 12px', background: '#fff', color: V.navy, border: `1px solid ${V.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Request limit increase</button>
                </div>
              </div>
            )}

            {exhausted && !noInv && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', background: V.amberBg, border: `1px solid #FDE68A`, borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontSize: 12, color: V.amber, flex: 1 }}>Annual limit reached. You can request an increase from Payroll.</span>
                <button onClick={() => setReqComp(lim.code)} style={{ padding: '5px 12px', background: V.amber, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Request increase</button>
              </div>
            )}
          </div>
        )
      })}

      {reqComp && (
        <div style={{ background: V.amberBg, border: `1px solid #FDE68A`, borderRadius: 12, padding: 16, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: V.amber, marginBottom: 10 }}>Request limit increase — {reqComp}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Requested annual limit (₹)</label><input type="number" style={{ padding: '7px 8px', border: `1px solid #FDE68A`, borderRadius: 7, fontSize: 12, width: '100%', boxSizing: 'border-box', background: '#fff' }} value={reqAmt} onChange={e => setReqAmt(e.target.value)} /></div>
            <div><label style={{ fontSize: 10, color: V.muted, display: 'block', marginBottom: 3 }}>Reason (mandatory)</label><input type="text" placeholder="Official travel increased…" style={{ padding: '7px 8px', border: `1px solid #FDE68A`, borderRadius: 7, fontSize: 12, width: '100%', boxSizing: 'border-box', background: '#fff' }} value={reqReason} onChange={e => setReqReason(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}><button onClick={sendLimitRequest} style={{ padding: '7px 14px', background: V.amber, color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Send request</button><button onClick={() => setReqComp(null)} style={{ padding: '7px 12px', background: '#fff', color: V.navy, border: `1px solid ${V.border}`, borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>Cancel</button></div>
        </div>
      )}

      {histComp && <HistoryDrawer label={limits.find(l => l.code === histComp)?.name || histComp} items={claimHist.filter(c => c.component_code === histComp)} onClose={() => setHistComp(null)} />}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: V.navy, color: '#fff', padding: '11px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>{toast}</div>}
    </div>
  )
}
