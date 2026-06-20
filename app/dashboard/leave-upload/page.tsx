'use client'
// app/dashboard/leave-upload/page.tsx — Leave Configuration workspace
// Tabs: Leave Types (catalog CRUD — "leave types are data") · Branch Quota
// (per company/branch, resolved) · Bulk Upload (Excel balances + quota).
// Schema: migration 030. Inline styles only. Sub-components OUTSIDE parent.
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadLeaveTypes, upsertLeaveType, setLeaveTypeActive, deleteLeaveType,
  loadCompanies, loadBranches, resolveQuota, upsertPolicy,
  type LeaveType, type OrgLite, type ResolvedQuota, type AppMode, type EligibleFrom, type Gender, type ApprovalBy,
} from '@/lib/supabase-leave-config'
import {
  downloadBalanceTemplate, uploadBalances, downloadQuotaTemplate, uploadQuota, type UploadResult,
} from '@/lib/supabase-leave-upload'

const T = {
  page:  { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:  { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'16px 18px', marginBottom:14, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  lbl:   { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10 } as React.CSSProperties,
  input: { width:'100%', padding:'8px 10px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:   { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff', whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:   { padding:'8px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9', whiteSpace:'nowrap' as const } as React.CSSProperties,
  danger:{ padding:'5px 10px', borderRadius:7, border:'1px solid #FCA5A5', cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#DC2626' } as React.CSSProperties,
  tab:   (on: boolean) => ({ padding:'9px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background: on ? '#7C3AED' : '#fff', color: on ? '#fff' : '#6D28D9', boxShadow: on ? 'none' : '0 1px 3px rgba(124,58,237,0.08)' }) as React.CSSProperties,
  check: { display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer', padding:'4px 0' } as React.CSSProperties,
}
const MODE_LABEL: Record<AppMode, string> = { EMPLOYEE:'Employee applies', HR_MARK:'HR marks', EARN_AVAIL:'Earn & avail' }
const SRC_COLOR: Record<string, [string, string]> = { branch:['#EDE9FE','#6D28D9'], company:['#DBEAFE','#1E40AF'], catalog:['#F3F4F6','#6B7280'] }

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?'#059669':'#DC2626', color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'✓':'✗'} {msg}</div>
}
function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color, whiteSpace:'nowrap' }}>{text}</span>
}
function Flags({ t }: { t: LeaveType }) {
  const f: { k: string; on: boolean; bg: string; c: string }[] = [
    { k:'PAID', on:t.is_paid, bg:'#ECFDF5', c:'#059669' },
    { k:'UNPAID', on:!t.is_paid, bg:'#FEF2F2', c:'#DC2626' },
    { k:'HALF-DAY', on:t.allow_half_day, bg:'#F5F3FF', c:'#6D28D9' },
    { k:'LAPSES', on:t.laps, bg:'#FFFBEB', c:'#92400E' },
    { k:'ENCASH', on:t.is_encashable, bg:'#ECFEFF', c:'#0891B2' },
    { k:'NO-BAL OK', on:t.allow_without_balance, bg:'#FEF3C7', c:'#92400E' },
    { k:'AUTO-ABSENT', on:t.auto_mark_absent, bg:'#FEF2F2', c:'#B91C1C' },
    { k:'CF∞', on:t.carry_forward_unlimited, bg:'#EDE9FE', c:'#6D28D9' },
  ]
  return <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{f.filter(x => x.on).map(x => <Pill key={x.k} text={x.k} bg={x.bg} color={x.c} />)}</div>
}

// ══ Leave Type form modal — every behaviour flag editable ═══════════
const BLANK: Partial<LeaveType> = {
  name:'', short_name:'', application_mode:'EMPLOYEE', eligible_from:'DOJ', min_tenure_days:0,
  probation_eligible:false, probation_limit:null, laps:false, encashment_after:null, max_times_in_tenure:null,
  allow_without_balance:false, auto_mark_absent:false, deduct_salary:false, gender:'ANY', approval_by:'HR_MANAGER',
  carry_forward_unlimited:false, is_system:false, annual_quota:0, carry_forward_max:0, is_paid:true,
  is_encashable:false, allow_half_day:true, accrual:'YEARLY', doc_required_after:null, color:'#7C3AED', sort_order:0,
}
function LeaveTypeModal({ row, onClose, onSave }: { row: LeaveType | null; onClose: () => void; onSave: (r: Partial<LeaveType>) => Promise<void> }) {
  const [f, setF] = useState<Partial<LeaveType>>(row || BLANK)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof LeaveType, v: any) => setF(p => ({ ...p, [k]: v }))
  const numN = (v: string) => v.trim() === '' ? null : Number(v)
  const ready = (f.name || '').trim() && (f.short_name || '').trim()
  const Chk = ({ k, label }: { k: keyof LeaveType; label: string }) => (
    <label style={T.check}><input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} /> {label}</label>
  )
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...T.card, maxWidth:640, width:'100%', marginBottom:0, maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:600, marginBottom:14 }}>{row ? `Edit ${row.short_name}` : 'New leave type'}</div>

        <div style={T.sec}>Identity</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 0.8fr 0.8fr', gap:10, marginBottom:14 }}>
          <div><label style={T.lbl}>Name</label><input style={T.input} value={f.name || ''} onChange={e => set('name', e.target.value)} placeholder="Earned Leave" /></div>
          <div><label style={T.lbl}>Code</label><input style={T.input} value={f.short_name || ''} onChange={e => set('short_name', e.target.value.toUpperCase())} placeholder="EL" /></div>
          <div><label style={T.lbl}>Color</label><input type="color" style={{ ...T.input, padding:2, height:36 }} value={f.color || '#7C3AED'} onChange={e => set('color', e.target.value)} /></div>
          <div><label style={T.lbl}>Sort</label><input type="number" style={T.input} value={f.sort_order ?? 0} onChange={e => set('sort_order', Number(e.target.value))} /></div>
        </div>

        <div style={T.sec}>Behaviour</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:8 }}>
          <div><label style={T.lbl}>Application mode</label><select style={T.input} value={f.application_mode} onChange={e => set('application_mode', e.target.value as AppMode)}><option value="EMPLOYEE">Employee applies</option><option value="HR_MARK">HR marks</option><option value="EARN_AVAIL">Earn & avail</option></select></div>
          <div><label style={T.lbl}>Eligible from</label><select style={T.input} value={f.eligible_from} onChange={e => set('eligible_from', e.target.value as EligibleFrom)}><option value="DOJ">From DOJ</option><option value="ON_DOJ">On DOJ</option><option value="AFTER_DAYS">After N days</option><option value="AFTER_PROBATION">After probation</option></select></div>
          <div><label style={T.lbl}>Min tenure (days)</label><input type="number" style={T.input} value={f.min_tenure_days ?? 0} onChange={e => set('min_tenure_days', Number(e.target.value))} /></div>
          <div><label style={T.lbl}>Gender</label><select style={T.input} value={f.gender} onChange={e => set('gender', e.target.value as Gender)}><option value="ANY">Any</option><option value="M">Male only</option><option value="F">Female only</option></select></div>
          <div><label style={T.lbl}>Approval by</label><select style={T.input} value={f.approval_by} onChange={e => set('approval_by', e.target.value as ApprovalBy)}><option value="L1">L1 Manager</option><option value="HR_MANAGER">HR Manager</option><option value="ASSIGNED">Assigned approver</option></select></div>
          <div><label style={T.lbl}>Max times in tenure</label><input type="number" style={T.input} value={f.max_times_in_tenure ?? ''} placeholder="∞" onChange={e => set('max_times_in_tenure', numN(e.target.value))} /></div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px 20px', marginBottom:14 }}>
          <Chk k="is_paid" label="Paid leave" />
          <Chk k="deduct_salary" label="Deduct salary" />
          <Chk k="allow_half_day" label="Allow half-day" />
          <Chk k="allow_without_balance" label="Apply without balance" />
          <Chk k="auto_mark_absent" label="Auto-mark absent (attendance)" />
          <Chk k="probation_eligible" label="Eligible during probation" />
        </div>

        <div style={T.sec}>Quota · carry-forward · encashment</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:8 }}>
          <div><label style={T.lbl}>Default annual quota</label><input type="number" style={T.input} value={f.annual_quota ?? 0} onChange={e => set('annual_quota', Number(e.target.value))} /></div>
          <div><label style={T.lbl}>Carry-forward max</label><input type="number" style={T.input} value={f.carry_forward_max ?? 0} onChange={e => set('carry_forward_max', Number(e.target.value))} /></div>
          <div><label style={T.lbl}>Encash after (balance)</label><input type="number" style={T.input} value={f.encashment_after ?? ''} placeholder="—" onChange={e => set('encashment_after', numN(e.target.value))} /></div>
          <div><label style={T.lbl}>Accrual</label><select style={T.input} value={f.accrual} onChange={e => set('accrual', e.target.value)}><option value="YEARLY">Yearly</option><option value="MONTHLY">Monthly</option><option value="NONE">None</option></select></div>
          <div><label style={T.lbl}>Doc required after (days)</label><input type="number" style={T.input} value={f.doc_required_after ?? ''} placeholder="—" onChange={e => set('doc_required_after', numN(e.target.value))} /></div>
          <div><label style={T.lbl}>Probation limit</label><input type="number" style={T.input} value={f.probation_limit ?? ''} placeholder="—" onChange={e => set('probation_limit', numN(e.target.value))} /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px 20px', marginBottom:16 }}>
          <Chk k="laps" label="Lapses at year-end" />
          <Chk k="is_encashable" label="Encashable" />
          <Chk k="carry_forward_unlimited" label="Unlimited carry-forward" />
          <Chk k="is_system" label="System type (protected)" />
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={T.out} onClick={onClose}>Cancel</button>
          <button disabled={!ready || busy} style={{ ...T.pri, opacity: ready ? 1 : 0.5 }} onClick={async () => { setBusy(true); await onSave(f); setBusy(false) }}>{busy ? '…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ══ TAB 1 · Leave Types catalog ════════════════════════════════════
function LeaveTypesTab({ types, onEdit, onAdd, onToggle, onDelete }: {
  types: LeaveType[]; onEdit: (t: LeaveType) => void; onAdd: () => void
  onToggle: (t: LeaveType) => void; onDelete: (t: LeaveType) => void
}) {
  return (
    <>
      <div style={{ display:'flex', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:12, color:'#6B7280' }}>Leave types are <b>data</b> — naya type add karo, ek row insert hoti hai, koi code change nahi.</div>
        <button style={{ ...T.pri, marginLeft:'auto' }} onClick={onAdd}>+ Add leave type</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))', gap:12 }}>
        {types.map(t => (
          <div key={t.id} style={{ ...T.card, marginBottom:0, opacity: t.is_active ? 1 : 0.55, borderLeft:`4px solid ${t.color}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontSize:15, fontWeight:700 }}>{t.short_name}</span>
              <span style={{ fontSize:13, color:'#374151' }}>{t.name}</span>
              {t.is_system && <Pill text="SYSTEM" bg="#F3F4F6" color="#6B7280" />}
              {!t.is_active && <Pill text="INACTIVE" bg="#FEF2F2" color="#DC2626" />}
            </div>
            <div style={{ fontSize:11, color:'#6B7280', marginBottom:8 }}>
              {MODE_LABEL[t.application_mode]} · {t.gender === 'ANY' ? 'all genders' : t.gender === 'F' ? 'female' : 'male'} · approve: {t.approval_by}
              {t.max_times_in_tenure ? ` · max ${t.max_times_in_tenure}×/tenure` : ''}
            </div>
            <div style={{ marginBottom:10 }}><Flags t={t} /></div>
            <div style={{ display:'flex', gap:6 }}>
              <button style={T.out} onClick={() => onEdit(t)}>Edit</button>
              <button style={T.out} onClick={() => onToggle(t)}>{t.is_active ? 'Deactivate' : 'Activate'}</button>
              {!t.is_system && <button style={{ ...T.danger, marginLeft:'auto' }} onClick={() => onDelete(t)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ══ TAB 2 · Branch Quota ═══════════════════════════════════════════
function QuotaRow({ row, onSave }: { row: ResolvedQuota; onSave: (leave_type_id: string, v: { annual_quota: number; max_carry_forward: number; laps: boolean; is_encashable: boolean; accrual: string }) => Promise<void> }) {
  const [q, setQ] = useState(String(row.annual_quota))
  const [cf, setCf] = useState(String(row.max_carry_forward))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setQ(String(row.annual_quota)); setCf(String(row.max_carry_forward)) }, [row.annual_quota, row.max_carry_forward])
  const [bg, c] = SRC_COLOR[row.source] || SRC_COLOR.catalog
  return (
    <tr style={{ borderBottom:'1px solid #F3F0FF' }}>
      <td style={{ padding:'8px 9px', fontWeight:600, whiteSpace:'nowrap' }}>{row.short_name} <span style={{ fontWeight:400, color:'#9CA3AF', fontSize:11 }}>{row.name}</span></td>
      <td style={{ padding:'8px 9px' }}><input type="number" style={{ ...T.input, width:80 }} value={q} onChange={e => setQ(e.target.value)} /></td>
      <td style={{ padding:'8px 9px' }}><input type="number" style={{ ...T.input, width:80 }} value={cf} onChange={e => setCf(e.target.value)} /></td>
      <td style={{ padding:'8px 9px' }}><Pill text={row.source} bg={bg} color={c} /></td>
      <td style={{ padding:'8px 9px' }}>
        <button disabled={busy} style={T.out} onClick={async () => { setBusy(true); await onSave(row.leave_type_id, { annual_quota: Number(q) || 0, max_carry_forward: Number(cf) || 0, laps: false, is_encashable: false, accrual: 'YEARLY' }); setBusy(false) }}>{busy ? '…' : 'Save'}</button>
      </td>
    </tr>
  )
}
function BranchQuotaTab({ companies, branches, rows, company, branch, fy, onCompany, onBranch, onFy, onSave }: {
  companies: OrgLite[]; branches: OrgLite[]; rows: ResolvedQuota[]
  company: string; branch: string; fy: string
  onCompany: (v: string) => void; onBranch: (v: string) => void; onFy: (v: string) => void
  onSave: (leave_type_id: string, v: any) => Promise<void>
}) {
  const coBranches = branches.filter(b => b.company_id === company)
  return (
    <>
      <div style={T.card}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr', gap:12 }}>
          <div><label style={T.lbl}>Company</label><select style={T.input} value={company} onChange={e => onCompany(e.target.value)}><option value="">— Select company —</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label style={T.lbl}>Branch</label><select style={T.input} value={branch} onChange={e => onBranch(e.target.value)} disabled={!company}><option value="">Company default (all branches)</option>{coBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label style={T.lbl}>FY</label><input style={T.input} value={fy} onChange={e => onFy(e.target.value)} placeholder="2026-27" /></div>
        </div>
        <div style={{ fontSize:11, color:'#9CA3AF', marginTop:8 }}>Branch-specific quota company default ko override karti hai. <b>source</b> column batata hai value kahan se aa rahi — branch / company / catalog. Save karne par is exact scope ke liye policy row banti/update hoti hai.</div>
      </div>

      {!company ? <div style={{ ...T.card, textAlign:'center', color:'#9CA3AF', padding:30 }}>Company chuno quota dekhne ke liye.</div> : (
        <div style={{ ...T.card, overflowX:'auto', padding:0 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'#FAFAF8' }}>
              {['Leave type', 'Annual quota', 'Carry-fwd max', 'Source', ''].map(h => <th key={h} style={{ padding:'9px', textAlign:'left', fontSize:10, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', borderBottom:'1px solid #EDE9FE' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'#9CA3AF' }}>Koi leave type active nahi.</td></tr>}
              {rows.map(r => <QuotaRow key={r.leave_type_id} row={r} onSave={onSave} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ══ TAB 3 · Bulk Upload ════════════════════════════════════════════
function UploaderCard({ icon, title, desc, columns, onTemplate, onUpload }: {
  icon: string; title: string; desc: string; columns: string[]
  onTemplate: () => Promise<void>; onUpload: (f: File) => Promise<UploadResult>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [tplBusy, setTplBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null); const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  async function run() {
    if (!file) return
    setBusy(true); setResult(null); setErr('')
    try { setResult(await onUpload(file)) } catch (e: any) { setErr(e?.message || 'Upload failed — check the file format.') }
    setBusy(false)
  }
  return (
    <div style={T.card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}><span style={{ fontSize:20 }}>{icon}</span><div style={{ fontSize:15, fontWeight:600 }}>{title}</div></div>
      <div style={{ fontSize:12.5, color:'#6B7280', marginBottom:12 }}>{desc}</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>{columns.map(c => <span key={c} style={{ fontSize:11, padding:'2px 8px', borderRadius:6, background:'#F5F3FF', color:'#7C3AED', border:'1px solid rgba(124,58,237,0.12)', whiteSpace:'nowrap' }}>{c}</span>)}</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
        <button style={T.out} disabled={tplBusy} onClick={async () => { setTplBusy(true); try { await onTemplate() } catch {} setTplBusy(false) }}>⬇ {tplBusy ? 'Preparing…' : 'Download template'}</button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setErr('') }} />
        <button style={T.out} onClick={() => inputRef.current?.click()}>📄 {file ? file.name : 'Choose Excel file'}</button>
        <button style={{ ...T.pri, opacity: file && !busy ? 1 : 0.5 }} disabled={!file || busy} onClick={run}>{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
      {err && <div style={{ marginTop:12, fontSize:12, color:'#B91C1C', background:'#FEF2F2', padding:'8px 12px', borderRadius:7 }}>{err}</div>}
      {result && (
        <div style={{ marginTop:14, borderTop:'1px solid rgba(124,58,237,0.12)', paddingTop:12 }}>
          <div style={{ display:'flex', gap:16, fontSize:13, marginBottom: result.errors.length ? 10 : 0 }}>
            <span style={{ color:'#059669', fontWeight:600 }}>✓ {result.inserted} added</span>
            {result.updated > 0 && <span style={{ color:'#7C3AED', fontWeight:600 }}>↻ {result.updated} updated</span>}
            {result.skipped > 0 && <span style={{ color:'#6B7280' }}>{result.skipped} blank skipped</span>}
            {result.errors.length > 0 && <span style={{ color:'#B45309', fontWeight:600 }}>⚠ {result.errors.length} errors</span>}
          </div>
          {result.errors.length > 0
            ? <div style={{ maxHeight:160, overflowY:'auto', background:'#FFFBEB', borderRadius:7, padding:'8px 12px' }}>{result.errors.map((e, i) => <div key={i} style={{ fontSize:12, color:'#92400E', padding:'2px 0' }}>{e.row > 0 ? `Row ${e.row}: ` : ''}{e.msg}</div>)}</div>
            : <div style={{ fontSize:12, color:'#059669' }}>All rows imported. 🎉</div>}
        </div>
      )}
    </div>
  )
}
function UploadTab() {
  return (
    <>
      <UploaderCard icon="🏢" title="Branch-wise quota (all leave types)"
        desc="Per company + branch, har leave type ki annual quota. Branch Code = ALL → company default. Ek branch ek hi quota me (DB guard)."
        columns={['Company Code', 'Branch Code (ALL = default)', 'Leave Type Code', 'Annual Quota', 'Max Carry Forward', 'Laps (Y/N)', 'Encashable (Y/N)', 'Accrual', 'FY']}
        onTemplate={downloadQuotaTemplate} onUpload={uploadQuota} />
      <UploaderCard icon="📊" title="Employee leave balance"
        desc="Har employee ka opening / accrued / used / encashed balance, per leave type. Mid-year migration ya correction ke liye."
        columns={['Employee Code', 'Leave Type Code', 'Year', 'Opening', 'Accrued', 'Used', 'Encashed']}
        onTemplate={downloadBalanceTemplate} onUpload={uploadBalances} />
      <div style={{ fontSize:12, color:'#6B7280' }}>💡 Template ke andar "Leave Types", "Companies", "Branches" reference sheets hote hain — valid codes wahan se copy karo.</div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function LeaveConfigPage() {
  const [tab, setTab] = useState<'types' | 'quota' | 'upload'>('types')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const [types, setTypes] = useState<LeaveType[]>([])
  const [companies, setCompanies] = useState<OrgLite[]>([])
  const [branches, setBranches] = useState<OrgLite[]>([])
  const [editing, setEditing] = useState<LeaveType | null | 'new'>(null)
  // quota tab
  const [qCompany, setQCompany] = useState('')
  const [qBranch, setQBranch] = useState('')
  const [qFy, setQFy] = useState('2026-27')
  const [qRows, setQRows] = useState<ResolvedQuota[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [t, c, b] = await Promise.all([loadLeaveTypes(), loadCompanies(), loadBranches()])
      setTypes(t); setCompanies(c); setBranches(b)
    } catch (e: any) { notify('Load failed: ' + (e?.message || 'check migration 030'), 'error') }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  const loadQuota = useCallback(async (company: string, branch: string, fy: string) => {
    if (!company) { setQRows([]); return }
    try { setQRows(await resolveQuota(company, branch || null, fy)) }
    catch (e: any) { notify('Quota load failed: ' + (e?.message || ''), 'error') }
  }, [])
  useEffect(() => { loadQuota(qCompany, qBranch, qFy) }, [qCompany, qBranch, qFy, loadQuota])

  async function saveType(r: Partial<LeaveType>) {
    const { error } = await upsertLeaveType(r) as any
    if (error) { notify('Save failed: ' + error.message, 'error'); return }
    notify(`${r.short_name} saved.`); setEditing(null); reload()
  }
  async function toggleType(t: LeaveType) {
    const { error } = await setLeaveTypeActive(t.id, !t.is_active)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${t.short_name} ${t.is_active ? 'deactivated' : 'activated'}.`); reload()
  }
  async function delType(t: LeaveType) {
    if (t.is_system) { notify('System type protected — deactivate instead.', 'error'); return }
    if (!confirm(`Delete ${t.short_name}? Iski saari policy/balance bhi delete ho jayengi.`)) return
    const { error } = await deleteLeaveType(t.id)
    if (error) { notify('Delete failed: ' + error.message, 'error'); return }
    notify('Deleted.'); reload()
  }
  async function saveQuota(leave_type_id: string, v: any) {
    const { error } = await upsertPolicy({ leave_type_id, company_id: qCompany, branch_id: qBranch || null, fy: qFy, ...v }) as any
    if (error) { notify('Save failed: ' + error.message, 'error'); return }
    notify('Quota saved.'); loadQuota(qCompany, qBranch, qFy)
  }

  const tabs: [typeof tab, string][] = [['types', '🗂 Leave Types'], ['quota', '🏢 Branch Quota'], ['upload', '📤 Bulk Upload']]

  return (
    <div style={{ ...T.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1180, margin:'0 auto' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Leave Configuration</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:14 }}>Config-driven leave: catalog (types + behaviour flags) · per company/branch quota · bulk upload. Adding a leave type is a data change, not a deploy.</div>

        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          {tabs.map(([k, l]) => <button key={k} style={T.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {loading ? <div style={{ ...T.card, textAlign:'center', color:'#7C3AED', padding:40 }}>Loading…</div> : (
          <>
            {tab === 'types' && <LeaveTypesTab types={types} onEdit={setEditing} onAdd={() => setEditing('new')} onToggle={toggleType} onDelete={delType} />}
            {tab === 'quota' && <BranchQuotaTab companies={companies} branches={branches} rows={qRows} company={qCompany} branch={qBranch} fy={qFy} onCompany={v => { setQCompany(v); setQBranch('') }} onBranch={setQBranch} onFy={setQFy} onSave={saveQuota} />}
            {tab === 'upload' && <UploadTab />}
          </>
        )}
      </div>
      {editing && <LeaveTypeModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={saveType} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
