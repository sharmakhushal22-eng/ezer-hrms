'use client'
// app/dashboard/statutory-leave/page.tsx — Statutory Leave Reference (admin, C palette)
// State-wise EL/CL/SL minimums (S&E Acts + Factories Act). Reference/advisory only —
// admin maintains & verifies like PT/LWF. FY-versioned. Excel import/export. Schema: migration 029.
// Sub-components OUTSIDE parent. Inline styles only.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  loadStatutory, loadFYs, upsertStatutory, deleteStatutory, copyToFy,
  type StatutoryLeave, type ActType,
} from '@/lib/supabase-statutory-leave'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  page:  { background:'#F0F4F8', minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
  card:  { background:TK.surface, borderRadius:10, border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:10 } as React.CSSProperties,
  lbl:   { fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.04em', display:'block', marginBottom:3 } as React.CSSProperties,
  input: { padding:'7px 9px', background:TK.sunken, border:'1px solid #CBD5E1', borderRadius:8, color:TK.ink, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' as const, width:'100%' } as React.CSSProperties,
  pri:   { padding:'8px 15px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.violet, color:'#fff', whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:   { padding:'7px 12px', borderRadius:8, border:'1px solid #CBD5E1', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.inkSoft, whiteSpace:'nowrap' as const } as React.CSSProperties,
  danger:{ padding:'5px 10px', borderRadius:8, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.critical } as React.CSSProperties,
  sec:   { fontSize:11, fontWeight:600, color:TK.inkSoft, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:8 } as React.CSSProperties,
}
const numShow = (v: number | null) => v === null || v === undefined ? '—' : String(v)
const fmtDate = (s?: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : null

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'':''} {msg}</div>
}
function ActBadge({ a }: { a: ActType }) {
  const [bg, c, l] = a === 'FACTORY' ? [TK.warningTint, TK.warning, 'Factories Act'] : ['#E0E7FF', '#3730A3', 'Shops & Estab']
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color:c }}>{l}</span>
}

// ── Add / Edit modal ─────────────────────────────────────────────────
const BLANK = (fy: string): Partial<StatutoryLeave> => ({
  state:'', act_type:'SE', fy, el_days:null, cl_days:null, sl_days:null,
  el_accrual_basis:'', el_carry_forward_max:null, cl_sl_lapse:true, notes:'', is_active:true,
})
function EditModal({ row, fy, onClose, onSave }: { row: StatutoryLeave | null; fy: string; onClose: () => void; onSave: (r: any) => Promise<void> }) {
  const [f, setF] = useState<Partial<StatutoryLeave>>(row || BLANK(fy))
  const [busy, setBusy] = useState(false)
  const num = (v: string) => v.trim() === '' ? null : Number(v)
  const set = (k: keyof StatutoryLeave, v: any) => setF(p => ({ ...p, [k]: v }))
  const ready = (f.state || '').trim() && (f.fy || '').trim()
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...C.card, maxWidth:560, width:'100%', marginBottom:0, maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:12 }}>{row ? 'Edit' : 'Add'} statutory row</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={C.lbl}>State (or ALL)</label><input style={C.input} value={f.state || ''} onChange={e => set('state', e.target.value)} placeholder="Maharashtra" /></div>
          <div><label style={C.lbl}>Act type</label><select style={C.input} value={f.act_type} onChange={e => set('act_type', e.target.value as ActType)}><option value="SE">Shops & Estab</option><option value="FACTORY">Factories Act</option></select></div>
          <div><label style={C.lbl}>FY</label><input style={C.input} value={f.fy || ''} onChange={e => set('fy', e.target.value)} placeholder="2026-27" /></div>
          <div><label style={C.lbl}>EL days</label><input type="number" style={C.input} value={f.el_days ?? ''} onChange={e => set('el_days', num(e.target.value))} /></div>
          <div><label style={C.lbl}>CL days</label><input type="number" style={C.input} value={f.cl_days ?? ''} onChange={e => set('cl_days', num(e.target.value))} /></div>
          <div><label style={C.lbl}>SL days</label><input type="number" style={C.input} value={f.sl_days ?? ''} onChange={e => set('sl_days', num(e.target.value))} /></div>
          <div style={{ gridColumn:'1 / 3' }}><label style={C.lbl}>EL accrual basis</label><input style={C.input} value={f.el_accrual_basis || ''} onChange={e => set('el_accrual_basis', e.target.value)} placeholder="1 per 20 days worked" /></div>
          <div><label style={C.lbl}>EL carry-fwd cap</label><input type="number" style={C.input} value={f.el_carry_forward_max ?? ''} onChange={e => set('el_carry_forward_max', num(e.target.value))} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={C.lbl}>Notes</label><input style={C.input} value={f.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="State Act ref — VERIFY" /></div>
        </div>
        <div style={{ display:'flex', gap:16, marginBottom:14 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={!!f.cl_sl_lapse} onChange={e => set('cl_sl_lapse', e.target.checked)} /> CL/SL lapse year-end</label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}><input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} /> Active</label>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={C.out} onClick={onClose}>Cancel</button>
          <button disabled={!ready || busy} style={{ ...C.pri, opacity: ready ? 1 : 0.5 }} onClick={async () => { setBusy(true); await onSave(f); setBusy(false) }}>{busy ? '…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Copy-to-FY modal ─────────────────────────────────────────────────
function CopyModal({ fys, onClose, onCopy }: { fys: string[]; onClose: () => void; onCopy: (from: string, to: string) => Promise<void> }) {
  const [from, setFrom] = useState(fys[0] || '2026-27')
  const [to, setTo] = useState('2027-28')
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...C.card, maxWidth:420, width:'100%', marginBottom:0 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>Copy to new FY</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Every row is copied into the new FY (re-verification required). Existing rows are skipped.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          <div><label style={C.lbl}>From FY</label><select style={C.input} value={from} onChange={e => setFrom(e.target.value)}>{fys.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <div><label style={C.lbl}>To FY</label><input style={C.input} value={to} onChange={e => setTo(e.target.value)} placeholder="2027-28" /></div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={C.out} onClick={onClose}>Cancel</button>
          <button disabled={busy || !to.trim() || from === to} style={{ ...C.pri, opacity: (to.trim() && from !== to) ? 1 : 0.5 }} onClick={async () => { setBusy(true); await onCopy(from, to); setBusy(false) }}>{busy ? '…' : 'Copy'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function StatutoryLeavePage() {
  const [rows, setRows] = useState<StatutoryLeave[]>([])
  const [fys, setFys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [fFy, setFFy] = useState('')
  const [fAct, setFAct] = useState<'' | ActType>('')
  const [fState, setFState] = useState('')
  const [editing, setEditing] = useState<StatutoryLeave | null | 'new'>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [r, y] = await Promise.all([loadStatutory(), loadFYs()])
      setRows(r); setFys(y.length ? y : ['2026-27'])
    } catch (e: any) { notify('Load failed: ' + (e?.message || 'check migration 029'), 'error') }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  const filtered = rows.filter(r =>
    (!fFy || r.fy === fFy) && (!fAct || r.act_type === fAct) &&
    (!fState || r.state.toLowerCase().includes(fState.toLowerCase())))

  async function save(f: any) {
    const { error } = await upsertStatutory(f)
    if (error) { notify('Save failed: ' + error.message, 'error'); return }
    notify('Saved.'); setEditing(null); reload()
  }
  async function del(r: StatutoryLeave) {
    if (!confirm(`Delete ${r.state} (${r.act_type}, ${r.fy})?`)) return
    const { error } = await deleteStatutory(r.id)
    if (error) { notify('Delete failed: ' + error.message, 'error'); return }
    notify('Deleted.'); reload()
  }
  async function markVerified(r: StatutoryLeave) {
    const { error } = await upsertStatutory({ ...r, verified_by: 'Admin', verified_on: new Date().toISOString().slice(0, 10) })
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${r.state} marked verified.`); reload()
  }
  async function doCopy(from: string, to: string) {
    const { inserted, error } = await copyToFy(from, to)
    if (error) { notify('Copy failed: ' + error.message, 'error'); return }
    notify(`${inserted} row(s) copied to ${to}.`); setCopyOpen(false); reload()
  }

  function exportXlsx() {
    const aoa = [
      ['state', 'act_type', 'fy', 'el_days', 'cl_days', 'sl_days', 'el_accrual_basis', 'el_carry_forward_max', 'cl_sl_lapse', 'notes', 'is_active'],
      ...filtered.map(r => [r.state, r.act_type, r.fy, r.el_days, r.cl_days, r.sl_days, r.el_accrual_basis, r.el_carry_forward_max, r.cl_sl_lapse, r.notes, r.is_active]),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'StatutoryLeave')
    XLSX.writeFile(wb, 'EZER_Statutory_Leave.xlsx')
  }
  function importXlsx(file: File) {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const recs: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        const num = (v: any) => v === '' || v === null || v === undefined ? null : Number(v)
        const bool = (v: any) => String(v).toLowerCase() === 'true' || v === true || v === 1 || v === '1'
        let ok = 0
        for (const x of recs) {
          if (!x.state || !x.fy) continue
          const { error } = await upsertStatutory({
            state: String(x.state).trim(), act_type: (String(x.act_type).toUpperCase() === 'FACTORY' ? 'FACTORY' : 'SE') as ActType,
            fy: String(x.fy).trim(), el_days: num(x.el_days), cl_days: num(x.cl_days), sl_days: num(x.sl_days),
            el_accrual_basis: x.el_accrual_basis || null, el_carry_forward_max: num(x.el_carry_forward_max),
            cl_sl_lapse: x.cl_sl_lapse === '' ? true : bool(x.cl_sl_lapse), notes: x.notes || null,
            is_active: x.is_active === '' ? true : bool(x.is_active), verified_by: null, verified_on: null,
          })
          if (!error) ok++
        }
        notify(`Imported ${ok}/${recs.length} row(s).`); reload()
      } catch (e: any) { notify('Import failed: ' + (e?.message || 'bad file'), 'error') }
    }
    reader.readAsArrayBuffer(file)
  }

  const Th = ({ children, n }: { children: React.ReactNode; n?: boolean }) => (
    <th style={{ padding:'8px 9px', textAlign: n ? 'center' : 'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', letterSpacing:'.04em', borderBottom:'1px solid #E2E8F0', whiteSpace:'nowrap' }}>{children}</th>
  )

  return (
    <div style={{ ...C.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1280, margin:'0 auto' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Statutory Leave Reference</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:12 }}>State-wise minimum EL/CL/SL (Shops &amp; Establishments + Factories Act 1948). Reference for setting Leave Policy quotas at or above the statutory floor.</div>

        {/* Legal disclaimer (mandatory per spec §7) */}
        <div style={{ background:TK.warningTint, border:'1px solid #FDE68A', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:12, color:TK.warning, lineHeight:1.5 }}>
          ⚠️ <b>Reference values — verify against the current state Act.</b> EZER is not a legal authority; Acts get amended. Confirm each row before relying on it (mark it verified once checked).
        </div>

        {/* Toolbar */}
        <div style={{ ...C.card, display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
          <div><label style={C.lbl}>FY</label><select style={{ ...C.input, width:120 }} value={fFy} onChange={e => setFFy(e.target.value)}><option value="">All</option>{fys.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <div><label style={C.lbl}>Act</label><select style={{ ...C.input, width:140 }} value={fAct} onChange={e => setFAct(e.target.value as any)}><option value="">All</option><option value="SE">Shops & Estab</option><option value="FACTORY">Factories Act</option></select></div>
          <div><label style={C.lbl}>State</label><input style={{ ...C.input, width:160 }} placeholder="filter…" value={fState} onChange={e => setFState(e.target.value)} /></div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
            <button style={C.out} onClick={() => setCopyOpen(true)}>Copy to FY</button>
            <button style={C.out} onClick={exportXlsx}>⬇ Export</button>
            <label style={{ ...C.out, display:'inline-flex', alignItems:'center' }}>⬆ Import<input type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = '' }} /></label>
            <button style={C.pri} onClick={() => setEditing('new')}>+ Add row</button>
          </div>
        </div>

        {loading ? <div style={{ ...C.card, textAlign:'center', color:TK.violet, padding:40 }}>Loading…</div> : (
          <div style={{ ...C.card, overflowX:'auto', padding:0 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr style={{ background:TK.sunken }}>
                <Th>State</Th><Th>Act</Th><Th>FY</Th><Th n>EL</Th><Th n>CL</Th><Th n>SL</Th><Th>EL accrual</Th><Th n>CF cap</Th><Th>Notes</Th><Th>Status</Th><Th>Actions</Th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={11} style={{ padding:24, textAlign:'center', color:TK.faint }}>No rows. {rows.length === 0 ? 'Has migration 029 been run? Or use + Add row.' : 'Clear the filter.'}</td></tr>}
                {filtered.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom:'1px solid #F1F5F9', background:i%2?TK.sunken:'#fff', opacity: r.is_active ? 1 : 0.55 }}>
                    <td style={{ padding:'8px 9px', fontWeight:600, whiteSpace:'nowrap' }}>{r.state}</td>
                    <td style={{ padding:'8px 9px' }}><ActBadge a={r.act_type} /></td>
                    <td style={{ padding:'8px 9px', color:TK.muted }}>{r.fy}</td>
                    <td style={{ padding:'8px 9px', textAlign:'center', fontWeight:600 }}>{numShow(r.el_days)}</td>
                    <td style={{ padding:'8px 9px', textAlign:'center' }}>{numShow(r.cl_days)}</td>
                    <td style={{ padding:'8px 9px', textAlign:'center' }}>{numShow(r.sl_days)}</td>
                    <td style={{ padding:'8px 9px', color:TK.muted, maxWidth:160 }}>{r.el_accrual_basis || '—'}</td>
                    <td style={{ padding:'8px 9px', textAlign:'center', color:TK.muted }}>{numShow(r.el_carry_forward_max)}</td>
                    <td style={{ padding:'8px 9px', color:TK.faint, maxWidth:180, fontSize:11 }}>{r.notes || '—'}</td>
                    <td style={{ padding:'8px 9px', whiteSpace:'nowrap' }}>
                      {r.verified_on
                        ? <span style={{ fontSize:10, fontWeight:600, color:TK.positive }} title={`by ${r.verified_by} on ${fmtDate(r.verified_on)}`}>✓ verified</span>
                        : <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:TK.warningTint, color:TK.warning }}>VERIFY</span>}
                    </td>
                    <td style={{ padding:'8px 9px', whiteSpace:'nowrap' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        {!r.verified_on && <button style={C.out} onClick={() => markVerified(r)}>Verify</button>}
                        <button style={C.out} onClick={() => setEditing(r)}>Edit</button>
                        <button style={C.danger} onClick={() => del(r)}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <EditModal row={editing === 'new' ? null : editing} fy={fFy || fys[0] || '2026-27'} onClose={() => setEditing(null)} onSave={save} />}
      {copyOpen && <CopyModal fys={fys} onClose={() => setCopyOpen(false)} onCopy={doCopy} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
