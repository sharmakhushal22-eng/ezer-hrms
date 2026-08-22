'use client'
// app/dashboard/flexi-claims/page.tsx — Flexi Claims admin console.
// Three tabs: Approvals (review/bulk approve bills) · Window (open/close cycle) ·
// Limits (per-employee overrides + employee limit-increase requests).
// Real company / department / location data from the DB.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { COMP_NAMES, NO_INVOICE } from '@/lib/flexi/claims'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, redBg: TK.criticalTint,
  amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const FY = '2026-27'
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const COMP_ORDER = ['PDA', 'TEL', 'DEVICE', 'LTA', 'CAR', 'DRIVER', 'FUEL', 'MEAL', 'ATTIRE', 'CHEDU', 'HOSTEL']

const S = {
  page: { background: C.bg, minHeight: '100vh', padding: 24, color: C.navy, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 } as React.CSSProperties,
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 4px rgba(37,99,235,0.06)' } as React.CSSProperties,
  inp: { padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: TK.sunken, color: C.navy, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  label: { fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.04em', display: 'block', marginBottom: 3 },
  pri: { padding: '8px 16px', background: C.purple, color: TK.onAccent, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' } as React.CSSProperties,
  sec: { padding: '7px 12px', background: TK.surface, color: C.navy, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' } as React.CSSProperties,
  green: { padding: '7px 12px', background: C.green, color: TK.onAccent, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' } as React.CSSProperties,
}

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3200); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: C.navy, color: TK.onAccent, borderRadius: 10, padding: '11px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>{msg}</div>
}
function StatBox({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return <div style={{ ...S.card, marginBottom: 0, padding: 14, textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div></div>
}
function AiBadge({ flag }: { flag: string }) {
  const m: Record<string, [string, string, string]> = { clear: [C.greenBg, C.green, 'Clear'], flag: [C.amberBg, C.amber, 'Check'], mismatch: [C.redBg, C.red, 'Mismatch'] }
  const [bg, col, t] = m[flag] || m.clear
  return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: bg, color: col, fontWeight: 600 }}>{t}</span>
}
function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = { PENDING: [C.amberBg, C.amber], APPROVED: [C.greenBg, C.green], REJECTED: [C.redBg, C.red], PAYROLL_PROCESSED: [C.purpleBg, C.purpleDark] }
  const [bg, col] = m[status] || [TK.sunken, TK.muted]
  return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: bg, color: col, fontWeight: 600 }}>{status.replace(/_/g, ' ')}</span>
}

async function post(body: any) {
  const r = await fetch('/api/flexi/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

// ─────────────────────────────────────────────────────────────
// APPROVALS TAB
// ─────────────────────────────────────────────────────────────
function ApprovalsTab({ companyId, notify }: { companyId: string; notify: (m: string) => void }) {
  const [claims, setClaims] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejectIds, setRejectIds] = useState<string[]>([])
  const [rejectReason, setRejectReason] = useState('')
  // Partial rejection — only meaningful for one claim at a time.
  const [partialAmt, setPartialAmt] = useState('')
  const [viewFiles, setViewFiles] = useState<any | null>(null)
  const [fDept, setFDept] = useState(''); const [fLoc, setFLoc] = useState(''); const [fComp, setFComp] = useState('')
  const [fStatus, setFStatus] = useState('PENDING'); const [fAi, setFAi] = useState(''); const [fSearch, setFSearch] = useState('')
  const [fMonth, setFMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)

  const load = useCallback(async () => {
    if (!companyId) { setClaims([]); setLoading(false); return }
    setLoading(true)
    const [y, m] = fMonth.split('-')
    const res = await fetch(`/api/flexi/claims?company_id=${companyId}&month=${Number(m)}&year=${y}`).then(r => r.json())
    setClaims(res.claims || []); setLoading(false); setSelected(new Set())
  }, [companyId, fMonth])
  useEffect(() => { load() }, [load])

  const depts = useMemo(() => Array.from(new Map(claims.filter(c => c.employees?.departments?.dept_name).map(c => [c.employees.department_id, c.employees.departments.dept_name])).entries()), [claims])
  const locs = useMemo(() => Array.from(new Map(claims.filter(c => c.employees?.locations?.location_name).map(c => [c.employees.location_id, c.employees.locations.location_name])).entries()), [claims])

  const filtered = useMemo(() => claims.filter(c => {
    if (fStatus && c.status !== fStatus) return false
    if (fComp && c.component_code !== fComp) return false
    if (fAi && c.ai_flag !== fAi) return false
    if (fDept && c.employees?.department_id !== fDept) return false
    if (fLoc && c.employees?.location_id !== fLoc) return false
    if (fSearch) { const q = fSearch.toLowerCase(); return (c.employees?.emp_code || '').toLowerCase().includes(q) || (c.employees?.full_name || '').toLowerCase().includes(q) }
    return true
  }), [claims, fStatus, fComp, fAi, fDept, fLoc, fSearch])

  const pending = filtered.filter(c => c.status === 'PENDING')
  const pendingSel = pending.filter(c => selected.has(c.id))

  const toggle = (id: string, isPending: boolean) => { if (!isPending) return; setSelected(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  const toggleAll = () => setSelected(pendingSel.length === pending.length ? new Set() : new Set(pending.map(c => c.id)))

  async function approve(ids: string[]) {
    if (!ids.length) return
    const r = await post({ action: 'APPROVE', ids, approved_by: 'Payroll Manager' })
    if (r.error) return notify('⚠ ' + r.error)
    notify(`✓ ${ids.length} claim(s) approved`); load()
  }
  async function confirmReject() {
    if (!rejectReason.trim()) return notify('Rejection reason is mandatory')
    const r = await post({ action: 'REJECT', ids: rejectIds, rejection_reason: rejectReason, approved_by: 'Payroll Manager',
      ...(rejectIds.length === 1 && partialAmt !== '' ? { approved_amount: Number(partialAmt) } : {}) })
    if (r.error) return notify('⚠ ' + r.error)
    notify(`✓ ${rejectIds.length} claim(s) rejected`); setRejectIds([]); setRejectReason(''); setPartialAmt(''); load()
  }
  async function openBills(c: any) {
    const files = c.flexi_claim_files || []
    const withUrls = await Promise.all(files.map(async (f: any) => {
      const { data } = await supabase.storage.from('flexi-bills').createSignedUrl(f.file_url, 300)
      return { ...f, signed: data?.signedUrl }
    }))
    setViewFiles({ claim: c, files: withUrls })
  }
  function exportCsv() {
    const rows = filtered.map(c => [c.employees?.emp_code, c.employees?.full_name, c.component_code, c.claim_amount, c.employees?.departments?.dept_name || '', c.employees?.locations?.location_name || '', c.status, c.ai_flag, (c.bill_date || ''), (c.bill_no || ''), (c.agency_name || c.vendor_desc || ''), (c.approved_by || '')])
    const head = ['Emp Code', 'Name', 'Component', 'Amount', 'Department', 'Location', 'Status', 'AI Flag', 'Bill Date', 'Bill No', 'Agency / Vendor', 'Approved By']
    const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `flexi_claims_${fMonth}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const approvedAmt = claims.filter(c => c.status === 'APPROVED' || c.status === 'PAYROLL_PROCESSED').reduce((s, c) => s + Number(c.claim_amount), 0)
  const cell: React.CSSProperties = { padding: '9px 10px', fontSize: 12 }
  const cols = '34px 1.4fr 90px 90px 1fr 1fr 74px 66px 120px'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
        <StatBox label="Pending" value={claims.filter(c => c.status === 'PENDING').length} color={C.amber} />
        <StatBox label="Approved" value={claims.filter(c => c.status === 'APPROVED').length} color={C.green} />
        <StatBox label="Rejected" value={claims.filter(c => c.status === 'REJECTED').length} color={C.red} />
        <StatBox label="Approved amount" value={inr(approvedAmt)} color={C.purple} />
      </div>

      {/* Filters */}
      <div style={S.card}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Filters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
          <div><label style={S.label}>Department</label><select style={S.inp} value={fDept} onChange={e => setFDept(e.target.value)}><option value="">All</option>{depts.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}</select></div>
          <div><label style={S.label}>Location</label><select style={S.inp} value={fLoc} onChange={e => setFLoc(e.target.value)}><option value="">All</option>{locs.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}</select></div>
          <div><label style={S.label}>Component</label><select style={S.inp} value={fComp} onChange={e => setFComp(e.target.value)}><option value="">All</option>{COMP_ORDER.map(c => <option key={c} value={c}>{COMP_NAMES[c]}</option>)}</select></div>
          <div><label style={S.label}>Status</label><select style={S.inp} value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'PAYROLL_PROCESSED'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
          <div><label style={S.label}>AI flag</label><select style={S.inp} value={fAi} onChange={e => setFAi(e.target.value)}><option value="">All</option><option value="clear">Clear</option><option value="flag">Flagged</option><option value="mismatch">Mismatch</option></select></div>
          <div><label style={S.label}>Period</label><input type="month" style={S.inp} value={fMonth} onChange={e => setFMonth(e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={S.label}>Search</label><input style={S.inp} placeholder="Employee code or name…" value={fSearch} onChange={e => setFSearch(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={S.sec} onClick={() => { setFDept(''); setFLoc(''); setFComp(''); setFStatus('PENDING'); setFAi(''); setFSearch('') }}>Clear all</button>
          <span style={{ fontSize: 11, color: C.muted }}>{filtered.length} of {claims.length} shown</span>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{ background: C.purpleBg, border: `1px solid #C4B5FD`, borderRadius: 10, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ color: C.purpleDark, fontWeight: 600, fontSize: 12 }}>{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <button style={S.green} onClick={() => approve(Array.from(selected))}>Approve selected ({selected.size})</button>
          <button style={{ ...S.sec, color: C.red, borderColor: TK.criticalTint }} onClick={() => { setRejectIds(Array.from(selected)); setRejectReason('') }}>Reject selected</button>
          <button style={S.sec} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Table */}
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, background: C.bg, borderBottom: `1px solid ${C.border}`, alignItems: 'center' }}>
          <div style={{ padding: '9px 10px' }}><input type="checkbox" checked={pending.length > 0 && pendingSel.length === pending.length} onChange={toggleAll} style={{ accentColor: C.purple }} /></div>
          {['Employee', 'Component', 'Amount', 'Department', 'Location', 'Bills', 'AI', 'Action'].map(h => <div key={h} style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</div>)}
        </div>
        {loading && <div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Loading…</div>}
        {!loading && !filtered.length && <div style={{ padding: 32, textAlign: 'center', color: C.muted }}>No claims match the filters.</div>}
        {!loading && filtered.map(c => {
          const isPending = c.status === 'PENDING', isSel = selected.has(c.id)
          const billN = (c.flexi_claim_files || []).filter((f: any) => f.file_type === 'BILL').length
          const supN = (c.flexi_claim_files || []).filter((f: any) => f.file_type === 'SUPPORTING').length
          return (
            <div key={c.id} onClick={() => toggle(c.id, isPending)} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: `1px solid ${C.border}`, alignItems: 'center', background: isSel ? C.purpleBg : c.status === 'APPROVED' ? '#F6FEF9' : c.status === 'REJECTED' ? '#FEF6F6' : '#fff', cursor: isPending ? 'pointer' : 'default' }}>
              <div style={{ padding: '9px 10px' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={isSel} disabled={!isPending} onChange={() => toggle(c.id, isPending)} style={{ accentColor: C.purple, opacity: isPending ? 1 : .4 }} /></div>
              <div style={cell}><div style={{ fontWeight: 600 }}>{c.employees?.full_name || '—'}</div><div style={{ fontSize: 10, color: C.muted }}>{c.employees?.emp_code}</div></div>
              <div style={cell}><span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: C.purpleBg, color: C.purpleDark, fontWeight: 600 }}>{c.component_code}</span></div>
              <div style={{ ...cell, fontWeight: 600 }}>{inr(c.claim_amount)}</div>
              <div style={{ ...cell, color: C.muted }}>{c.employees?.departments?.dept_name || '—'}</div>
              <div style={{ ...cell, color: C.muted }}>{c.employees?.locations?.location_name || '—'}</div>
              <div style={cell}>{billN > 0 && <span style={{ fontSize: 10, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 5, marginRight: 3 }}>B:{billN}</span>}{supN > 0 && <span style={{ fontSize: 10, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 5 }}>S:{supN}</span>}{!billN && !supN && <span style={{ color: C.muted }}>—</span>}</div>
              <div style={cell}><AiBadge flag={c.ai_flag} /></div>
              <div style={{ ...cell, display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                {isPending ? <>
                  <button title="Approve" onClick={() => approve([c.id])} style={{ padding: '3px 8px', fontSize: 11, background: C.greenBg, color: C.green, border: `1px solid #BBF7D0`, borderRadius: 6, cursor: 'pointer' }}></button>
                  <button title="Reject" onClick={() => { setRejectIds([c.id]); setRejectReason('') }} style={{ padding: '3px 8px', fontSize: 11, background: C.redBg, color: C.red, border: `1px solid #FCA5A5`, borderRadius: 6, cursor: 'pointer' }}></button>
                  <button onClick={() => openBills(c)} style={{ padding: '3px 8px', fontSize: 10, background: TK.surface, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer' }}>Bills</button>
                </> : <StatusBadge status={c.status} />}
              </div>
            </div>
          )
        })}
        <div style={{ padding: '9px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bg }}>
          <span style={{ fontSize: 11, color: C.muted }}>{filtered.length} claims · Clear: {filtered.filter(c => c.ai_flag === 'clear').length} · Flagged: {filtered.filter(c => c.ai_flag === 'flag').length}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {selected.size === 0 && pending.filter(c => c.ai_flag === 'clear').length > 0 && <button style={S.green} onClick={() => approve(pending.filter(c => c.ai_flag === 'clear').map(c => c.id))}>Bulk approve AI-clear ({pending.filter(c => c.ai_flag === 'clear').length})</button>}
            <button style={S.sec} onClick={exportCsv}>⬇ Export CSV</button>
          </div>
        </div>
      </div>

      {/* Reject panel */}
      {rejectIds.length > 0 && (
        <div style={{ ...S.card, border: `1px solid #FCA5A5` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.red, marginBottom: 6 }}>Reject {rejectIds.length} claim(s)</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>The reason is shown to the employee. Rejected amounts do NOT reduce their limit — and they become <b>taxable income</b> once Payroll syncs Flexi reimbursement.</div>
          <input style={{ ...S.inp, marginBottom: 8 }} placeholder="Rejection reason (mandatory)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          {rejectIds.length === 1 && (() => {
            const c = claims.find(x => x.id === rejectIds[0])
            const claimed = Number(c?.claim_amount) || 0
            const ok = partialAmt === '' ? 0 : Math.max(0, Math.min(Number(partialAmt) || 0, claimed))
            return (
              <div style={{ background: C.amberBg, border: `1px solid #FDE68A`, borderRadius: 8, padding: '9px 11px', marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.amber, marginBottom: 5 }}>Partial rejection (optional)</div>
                <div style={{ fontSize: 11, color: C.amber, marginBottom: 6 }}>
                  The bill is for {inr(claimed)}. If only part of it is valid, enter that amount here — the rest becomes taxable. Leave it blank and the whole {inr(claimed)} is taxable.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ ...S.inp, width: 150 }} placeholder={`Valid amount (max ${claimed})`} inputMode="numeric"
                    value={partialAmt} onChange={e => setPartialAmt(e.target.value.replace(/[^0-9]/g, ''))} />
                  <span style={{ fontSize: 11.5, color: C.amber }}>
                    → taxable <b>{inr(claimed - ok)}</b>{ok >= claimed && claimed > 0 ? ' — fully valid, this will be approved' : ''}
                  </span>
                </div>
              </div>
            )
          })()}
          <div style={{ display: 'flex', gap: 8 }}><button style={{ ...S.pri, background: C.red }} onClick={confirmReject}>Confirm rejection</button><button style={S.sec} onClick={() => { setRejectIds([]); setPartialAmt('') }}>Cancel</button></div>
        </div>
      )}

      {/* Bill viewer */}
      {viewFiles && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setViewFiles(null)}>
          <div style={{ background: TK.surface, borderRadius: 12, padding: 20, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Bills — {viewFiles.claim.employees?.full_name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{viewFiles.claim.component_code} · {inr(viewFiles.claim.claim_amount)}{viewFiles.claim.bill_no ? ` · 🧾 ${viewFiles.claim.bill_no}` : ''}{(viewFiles.claim.agency_name || viewFiles.claim.vendor_desc) ? ` · 🏪 ${viewFiles.claim.agency_name || viewFiles.claim.vendor_desc}` : ''}</div>
            {viewFiles.files.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>No files uploaded for this claim.</div>}
            {viewFiles.files.map((f: any) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.purple }}>{f.file_type === 'BILL' ? '' : ''}</span>
                <span style={{ flex: 1, fontSize: 12 }}>{f.file_name}</span>
                {f.signed ? <a href={f.signed} target="_blank" rel="noreferrer" style={{ ...S.sec, textDecoration: 'none', padding: '4px 10px' }}>Open</a> : <span style={{ fontSize: 11, color: C.muted }}>unavailable</span>}
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 10 }}><button style={S.sec} onClick={() => setViewFiles(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

// Calendar day-range picker for the current month — pick opening day, then closing day.
function MonthCalendar({ openDay, closeDay, onChange }: { openDay: number; closeDay: number; onChange: (o: number, c: number) => void }) {
  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()   // 0 = Sun
  const [anchor, setAnchor] = useState<number | null>(null)
  const pick = (d: number) => {
    if (anchor === null) { setAnchor(d); onChange(d, d) }
    else { onChange(Math.min(anchor, d), Math.max(anchor, d)); setAnchor(null) }
  }
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {WD.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.muted, padding: '2px 0' }}>{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const edge = d === openDay || d === closeDay
          const inRange = d > openDay && d < closeDay
          const label = d === openDay ? 'Opens' : d === closeDay ? 'Closes' : ''
          return (
            <button key={i} onClick={() => pick(d)} title={label ? `${label} on day ${d}` : `Day ${d}`}
              style={{
                aspectRatio: '1', border: `1px solid ${edge ? C.purple : inRange ? TK.brandEdge : C.border}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: edge ? 700 : 500, padding: 0, position: 'relative',
                background: edge ? C.purple : inRange ? C.purpleBg: TK.surface, color: edge ? TK.surface : inRange ? C.purpleDark : C.navy,
              }}>
              {d}
              {label && <span style={{ position: 'absolute', bottom: 1, left: 0, right: 0, fontSize: 7, fontWeight: 700, letterSpacing: '.02em' }}>{label.toUpperCase()}</span>}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
        <span><b style={{ color: C.purple }}>Opens</b> Day {openDay}</span>
        <span><b style={{ color: C.purple }}>Closes</b> Day {closeDay}</span>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Click the opening day, then the closing day.</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// WINDOW TAB
// ─────────────────────────────────────────────────────────────
function WindowTab({ companyId, notify }: { companyId: string; notify: (m: string) => void }) {
  const NOW = new Date()
  const [win, setWin] = useState<any>(null)
  const [openDay, setOpenDay] = useState(1)
  const [closeDay, setCloseDay] = useState(20)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('flexi_windows').select('*').eq('company_id', companyId).eq('year', NOW.getFullYear()).eq('month', NOW.getMonth() + 1).maybeSingle()
    if (data) { setWin(data); setOpenDay(data.open_day); setCloseDay(data.close_day) } else setWin(null)
  }, [companyId])
  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    if (win) {
      await supabase.from('flexi_windows').update({ open_day: openDay, close_day: closeDay }).eq('id', win.id)
    } else {
      const opens = new Date(NOW.getFullYear(), NOW.getMonth(), openDay)
      const closes = new Date(NOW.getFullYear(), NOW.getMonth(), closeDay, 23, 59, 59)
      await supabase.from('flexi_windows').insert({ company_id: companyId, fy: FY, month: NOW.getMonth() + 1, year: NOW.getFullYear(), open_day: openDay, close_day: closeDay, status: 'OPEN', opens_at: opens.toISOString(), closes_at: closes.toISOString() })
    }
    setSaving(false); notify('Window config saved'); load()
  }
  async function toggle() {
    if (!win) return
    const open = win.status === 'OPEN'
    await post({ action: 'TOGGLE_WINDOW', window_id: win.id, new_status: open ? 'MANUAL_CLOSED' : 'OPEN' })
    notify(open ? 'Window closed' : 'Window re-opened'); load()
  }
  const isOpen = win?.status === 'OPEN'
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.border}` }

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={S.card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Submission window — {NOW.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
        <div style={row}><span style={{ flex: 1, color: C.muted }}>Current status</span>{win ? <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 99, background: isOpen ? C.greenBg : C.redBg, color: isOpen ? C.green : C.red, fontWeight: 600 }}>{isOpen ? 'Open' : 'Closed'}</span> : <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 99, background: C.amberBg, color: C.amber, fontWeight: 600 }}>Not created</span>}</div>
        <div style={row}><span style={{ flex: 1, color: C.muted }}>Window period</span><span>Day {openDay} → Day {closeDay} each month</span></div>
        <div style={{ margin: '12px 0' }}>
          <label style={{ ...S.label, marginBottom: 8 }}>Select window on the calendar — {NOW.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</label>
          <MonthCalendar openDay={openDay} closeDay={closeDay} onChange={(o, c) => { setOpenDay(o); setCloseDay(c) }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.pri} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save config'}</button>
          {win && <button style={{ ...S.sec, color: isOpen ? C.red : C.green, borderColor: isOpen ? TK.criticalTint : TK.positiveTint }} onClick={toggle}>{isOpen ? 'Close window now' : 'Re-open window'}</button>}
        </div>
        {win && <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>Active window: {new Date(win.opens_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(win.closes_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
        <div style={{ marginTop: 12, background: C.purpleBg, borderRadius: 8, padding: '9px 12px', fontSize: 11, color: C.purpleDark }}>Employees can submit bills only while the window is <b>Open</b>. {NO_INVOICE.join(' & ')} are auto-claimed (no bill needed) and auto-approved.</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// LIMITS TAB (overrides + requests)
// ─────────────────────────────────────────────────────────────
function LimitsTab({ companyId, notify }: { companyId: string; notify: (m: string) => void }) {
  const [empCode, setEmpCode] = useState('')
  const [emp, setEmp] = useState<any>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [requests, setRequests] = useState<any[]>([])

  const loadReqs = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('flexi_limit_requests').select('*, employees(emp_code, full_name)').eq('company_id', companyId).eq('status', 'PENDING').order('created_at', { ascending: false })
    setRequests(data || [])
  }, [companyId])
  useEffect(() => { loadReqs() }, [loadReqs])

  async function loadEmp() {
    if (!empCode.trim()) return
    const { data } = await supabase.from('employees').select('id, emp_code, full_name, company_id').eq('emp_code', empCode.trim().toUpperCase()).maybeSingle()
    if (!data) { notify('Employee not found'); setEmp(null); return }
    setEmp(data)
    const { data: ovr } = await supabase.from('flexi_limit_overrides').select('component_code, override_limit').eq('employee_id', data.id).eq('fy', FY).eq('is_active', true)
    const map: Record<string, string> = {}
    ;(ovr || []).forEach((o: any) => { map[o.component_code] = String(o.override_limit) })
    setOverrides(map)
  }
  async function saveOverrides() {
    if (!emp) return
    if (!reason.trim()) return notify('Override reason is mandatory')
    const filled = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v))
    if (!Object.keys(filled).length) return notify('Enter at least one override amount')
    setSaving(true)
    const r = await post({ action: 'OVERRIDE_LIMIT', employee_id: emp.id, company_id: emp.company_id, fy: FY, overrides: filled, reason })
    setSaving(false)
    if (r.error) return notify('⚠ ' + r.error)
    notify(`✓ ${r.count} limit(s) updated for ${emp.full_name}`)
  }
  async function handleReq(id: string, approve: boolean) {
    let note: string | undefined
    if (!approve) { note = window.prompt('Rejection reason:') || undefined; if (!note) return }
    const r = await post({ action: 'APPROVE_LIMIT_REQUEST', request_id: id, ...(approve ? {} : { reject_note: note }) })
    if (r.error) return notify('⚠ ' + r.error)
    notify(approve ? 'Request approved — limit raised' : 'Request rejected'); loadReqs()
  }

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Employee limit override · FY {FY}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={{ ...S.inp, flex: 1 }} placeholder="Employee code (e.g. SRS9002)" value={empCode} onChange={e => setEmpCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadEmp()} />
          <button style={S.pri} onClick={loadEmp}>Load</button>
        </div>
        {emp && <>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{emp.full_name} · {emp.emp_code}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {COMP_ORDER.map(code => (
              <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12 }}>{COMP_NAMES[code]}</span>
                <input type="number" min={0} step={1000} placeholder="slab default" style={{ ...S.inp, width: 130, borderColor: overrides[code] ? C.purple : C.border }} value={overrides[code] || ''} onChange={e => setOverrides(p => ({ ...p, [code]: e.target.value }))} />
              </div>
            ))}
          </div>
          <input style={{ ...S.inp, marginBottom: 8 }} placeholder="Override reason (mandatory — saved in audit)" value={reason} onChange={e => setReason(e.target.value)} />
          <button style={S.pri} disabled={saving} onClick={saveOverrides}>{saving ? 'Saving…' : 'Save overrides'}</button>
        </>}
      </div>

      <div style={S.card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Pending limit-increase requests ({requests.length})</div>
        {!requests.length && <div style={{ fontSize: 12, color: C.muted }}>No pending requests.</div>}
        {requests.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, background: TK.brandTint }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{r.employees?.full_name} <span style={{ color: C.muted, fontWeight: 400 }}>({r.employees?.emp_code})</span></div>
              <div style={{ fontSize: 11, color: C.muted }}>{COMP_NAMES[r.component_code] || r.component_code}: {inr(r.current_limit)} → <b style={{ color: C.purple }}>{inr(r.requested_limit)}</b></div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontStyle: 'italic' }}>“{r.reason}”</div>
            </div>
            <button style={{ ...S.green, padding: '5px 10px' }} onClick={() => handleReq(r.id, true)}>Approve</button>
            <button style={{ ...S.sec, color: C.red, borderColor: TK.criticalTint, padding: '5px 10px' }} onClick={() => handleReq(r.id, false)}>Reject</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────
export default function FlexiClaimsAdmin() {
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([])
  const [companyId, setCompanyId] = useState('')
  const [tab, setTab] = useState<'approvals' | 'window' | 'limits'>('approvals')
  const [toast, setToast] = useState('')
  const notify = (m: string) => setToast(m)

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => { setCompanies(data || []); if (data?.length) setCompanyId(data[0].id) })
  }, [])

  const TABS: [typeof tab, string][] = [['approvals', 'Approvals'], ['window', 'Window'], ['limits', 'Limits & Requests']]

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Flexi Claims</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Review reimbursement bills, manage the submission window &amp; employee limits</div>
        </div>
        <div>
          <label style={S.label}>Company</label>
          <select style={{ ...S.inp, minWidth: 220 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
            {companies.length === 0 && <option value="">No companies</option>}
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${tab === id ? C.purple : C.border}`, background: tab === id ? C.purple: TK.surface, color: tab === id ? TK.surface : C.navy, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
        ))}
      </div>

      {!companyId ? <div style={S.card}><div style={{ color: C.muted }}>Select a company.</div></div> : (
        tab === 'approvals' ? <ApprovalsTab companyId={companyId} notify={notify} />
          : tab === 'window' ? <WindowTab companyId={companyId} notify={notify} />
            : <LimitsTab companyId={companyId} notify={notify} />
      )}

      {toast && <Toast msg={toast} onClose={() => setToast('')} />}
    </div>
  )
}
