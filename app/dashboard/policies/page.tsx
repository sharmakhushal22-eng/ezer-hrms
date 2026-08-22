'use client'
// app/dashboard/policies/page.tsx — Company Policies config (admin)
// Per-company configurable policies that drive the onboarding Phase-9 ACK step.
// Add/edit (version auto-bumps), reorder, activate/deactivate, soft-delete. Schema: migration 033.
import { useState, useEffect, useCallback } from 'react'
import {
  loadCompaniesLite, loadPolicies, savePolicy, togglePolicy, softDeletePolicy,
  type CompanyPolicy, type CompanyLite,
} from '@/lib/supabase-policies'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  page:  { background:TK.canvas, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:  { background:TK.surface, borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:12, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  lbl:   { fontSize:11, fontWeight:600, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 } as React.CSSProperties,
  input: { width:'100%', padding:'8px 10px', background:TK.sunken, border:'1px solid #DDD6FE', borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:   { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:'#fff', whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:   { padding:'7px 12px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.brandDeep, whiteSpace:'nowrap' as const } as React.CSSProperties,
  danger:{ padding:'6px 11px', borderRadius:7, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.critical } as React.CSSProperties,
}
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'':''} {msg}</div>
}

const BLANK = (order: number) => ({ id:'', policy_code:'', policy_title:'', policy_body:'', is_mandatory:true, sort_order:order })
function PolicyModal({ row, company_id, nextOrder, onClose, onSave }: {
  row: CompanyPolicy | null; company_id: string; nextOrder: number
  onClose: () => void; onSave: (i: any) => Promise<void>
}) {
  const [f, setF] = useState<any>(row ? { id:row.id, policy_code:row.policy_code, policy_title:row.policy_title, policy_body:row.policy_body, is_mandatory:row.is_mandatory, sort_order:row.sort_order } : BLANK(nextOrder))
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  const ready = f.policy_code.trim() && f.policy_title.trim()
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...C.card, maxWidth:620, width:'100%', marginBottom:0, maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:600, marginBottom:12 }}>{row ? `Edit ${row.policy_code}` : 'Add policy'}{row && <span style={{ fontSize:11, color:TK.faint, fontWeight:400 }}> · v{row.version} (edit auto-bumps version)</span>}</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 0.7fr', gap:10, marginBottom:10 }}>
          <div><label style={C.lbl}>Code</label><input style={C.input} value={f.policy_code} onChange={e => set('policy_code', e.target.value.toUpperCase())} placeholder="HR-POL-005" /></div>
          <div><label style={C.lbl}>Title</label><input style={C.input} value={f.policy_title} onChange={e => set('policy_title', e.target.value)} placeholder="Confidentiality / NDA" /></div>
          <div><label style={C.lbl}>Sort</label><input type="number" style={C.input} value={f.sort_order} onChange={e => set('sort_order', Number(e.target.value))} /></div>
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer', marginBottom:10 }}>
          <input type="checkbox" checked={f.is_mandatory} onChange={e => set('is_mandatory', e.target.checked)} /> Mandatory (candidate must acknowledge to proceed)
        </label>
        <label style={C.lbl}>Policy text (markdown supported)</label>
        <textarea style={{ ...C.input, minHeight:200, resize:'vertical', fontFamily:'inherit' }} value={f.policy_body} onChange={e => set('policy_body', e.target.value)} placeholder="1. PURPOSE&#10;…paste the full policy text…" />
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
          <button style={C.out} onClick={onClose}>Cancel</button>
          <button disabled={!ready || busy} style={{ ...C.pri, opacity: ready ? 1 : 0.5 }} onClick={async () => { setBusy(true); await onSave({ ...f, company_id }); setBusy(false) }}>{busy ? '…' : 'Save policy'}</button>
        </div>
      </div>
    </div>
  )
}

export default function CompanyPoliciesPage() {
  const [companies, setCompanies] = useState<CompanyLite[]>([])
  const [companyId, setCompanyId] = useState('')
  const [policies, setPolicies] = useState<CompanyPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CompanyPolicy | null | 'new'>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  useEffect(() => {
    loadCompaniesLite().then(cs => { setCompanies(cs); if (cs.length) setCompanyId(cs[0].id); setLoading(false) })
      .catch(e => { notify('Load failed: ' + (e?.message || ''), 'error'); setLoading(false) })
  }, [])

  const reload = useCallback(async (id: string) => {
    if (!id) { setPolicies([]); return }
    try { setPolicies(await loadPolicies(id)) } catch (e: any) { notify('Load failed: ' + (e?.message || 'check migration 033'), 'error') }
  }, [])
  useEffect(() => { reload(companyId) }, [companyId, reload])

  async function doSave(i: any) {
    const { error } = await savePolicy(i) as any
    if (error) { notify('Save failed: ' + error.message, 'error'); return }
    notify('Policy saved.'); setEditing(null); reload(companyId)
  }
  async function doToggle(p: CompanyPolicy) {
    const { error } = await togglePolicy(p.id, !p.is_active)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${p.policy_code} ${p.is_active ? 'deactivated' : 'activated'}.`); reload(companyId)
  }
  async function doDelete(p: CompanyPolicy) {
    if (!confirm(`Remove ${p.policy_code}? (soft delete — record kept for compliance, hidden from new onboarding)`)) return
    const { error } = await softDeletePolicy(p.id)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify('Policy removed.'); reload(companyId)
  }
  const nextOrder = policies.reduce((m, p) => Math.max(m, p.sort_order), 0) + 1

  return (
    <div style={{ ...C.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Company Policies</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Per-company policies that appear in the onboarding magic-link Phase 9 (acknowledgement). Add / edit / reorder — changes apply to new onboarding sessions instantly; already-acked candidates keep their original version.</div>

        <div style={{ ...C.card, display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div><label style={C.lbl}>Company</label>
            <select style={{ ...C.input, minWidth:280 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              <option value="">— Select company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button style={{ ...C.pri, marginLeft:'auto' }} disabled={!companyId} onClick={() => setEditing('new')}>+ Add policy</button>
        </div>

        {loading ? <div style={{ ...C.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading…</div> : !companyId ? null : (
          <div style={{ ...C.card, overflowX:'auto', padding:0 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr style={{ background:TK.sunken }}>
                {['#', 'Code', 'Title', 'Mandatory', 'Status', 'Actions'].map(h => <th key={h} style={{ padding:'9px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', letterSpacing:'.04em', borderBottom:'1px solid #EDE9FE' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {policies.length === 0 && <tr><td colSpan={6} style={{ padding:24, textAlign:'center', color:TK.faint }}>No policies. Has migration 033 been run? Or use + Add policy.</td></tr>}
                {policies.map(p => (
                  <tr key={p.id} style={{ borderBottom:'1px solid #F3F0FF', opacity: p.is_active ? 1 : 0.5 }}>
                    <td style={{ padding:'9px 10px', color:TK.faint }}>{p.sort_order}</td>
                    <td style={{ padding:'9px 10px', fontWeight:600, whiteSpace:'nowrap' }}>{p.policy_code} <span style={{ fontSize:10, color:TK.faint, fontWeight:400 }}>v{p.version}</span></td>
                    <td style={{ padding:'9px 10px' }}>{p.policy_title}</td>
                    <td style={{ padding:'9px 10px' }}>{p.is_mandatory ? <span style={{ fontSize:10, fontWeight:700, color:TK.brand }}>MANDATORY</span> : <span style={{ fontSize:10, color:TK.faint }}>optional</span>}</td>
                    <td style={{ padding:'9px 10px' }}>{p.is_active ? <span style={{ fontSize:10, fontWeight:600, color:TK.positive }}>ON</span> : <span style={{ fontSize:10, color:TK.faint }}>OFF</span>}</td>
                    <td style={{ padding:'9px 10px', whiteSpace:'nowrap' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button style={C.out} onClick={() => setEditing(p)}>Edit</button>
                        <button style={C.out} onClick={() => doToggle(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</button>
                        <button style={C.danger} onClick={() => doDelete(p)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PolicyModal row={editing === 'new' ? null : editing} company_id={companyId} nextOrder={nextOrder} onClose={() => setEditing(null)} onSave={doSave} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
