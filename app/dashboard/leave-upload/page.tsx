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
  downloadBalanceTemplate, parseBalanceFile, commitBalances,
  downloadQuotaTemplate, parseQuotaFile, commitQuota,
  type ParseResult, type CommitResult, type ParsedRow,
} from '@/lib/supabase-leave-upload'
import * as XLSX from 'xlsx'
import { HolidaysSection } from '@/app/dashboard/holidays/page'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const T = {
  page:  { background:TK.canvas, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:  { background:TK.surface, borderRadius:10, border:'1px solid rgba(37,99,235,0.12)', padding:'16px 18px', marginBottom:14, boxShadow:'0 1px 4px rgba(37,99,235,0.06)' } as React.CSSProperties,
  lbl:   { fontSize:11, fontWeight:600, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:TK.brand, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10 } as React.CSSProperties,
  input: { width:'100%', padding:'8px 10px', background:TK.sunken, border: `1px solid ${TK.brandEdge}`, borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:   { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:TK.onAccent, whiteSpace:'nowrap' as const } as React.CSSProperties,
  out:   { padding:'8px 13px', borderRadius:7, border: `1px solid ${TK.brandEdge}`, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:TK.surface, color:TK.brandDeep, whiteSpace:'nowrap' as const } as React.CSSProperties,
  danger:{ padding:'5px 10px', borderRadius:7, border: `1px solid ${TK.criticalTint}`, cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', background:TK.surface, color:TK.critical } as React.CSSProperties,
  tab:   (on: boolean) => ({ padding:'9px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background: on ? TK.brand: TK.surface, color: on ? TK.surface : TK.brandDeep, boxShadow: on ? 'none' : '0 1px 3px rgba(37,99,235,0.08)' }) as React.CSSProperties,
  check: { display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer', padding:'4px 0' } as React.CSSProperties,
}
const MODE_LABEL: Record<AppMode, string> = { EMPLOYEE:'Employee applies', HR_MARK:'HR marks', EARN_AVAIL:'Earn & avail' }
const SRC_COLOR: Record<string, [string, string]> = { branch:[TK.brandTint,TK.brandDeep], company:[TK.infoTint,TK.brand], catalog:[TK.sunken,TK.muted] }

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:TK.onAccent, borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'':''} {msg}</div>
}
function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color, whiteSpace:'nowrap' }}>{text}</span>
}
function Flags({ t }: { t: LeaveType }) {
  const f: { k: string; on: boolean; bg: string; c: string }[] = [
    { k:'PAID', on:t.is_paid, bg:TK.positiveTint, c:TK.positive },
    { k:'UNPAID', on:!t.is_paid, bg:TK.criticalTint, c:TK.critical },
    { k:'HALF-DAY', on:t.allow_half_day, bg:TK.canvas, c:TK.brandDeep },
    { k:'LAPSES', on:t.laps, bg:TK.warningTint, c:TK.warning },
    { k:'ENCASH', on:t.is_encashable, bg: TK.infoTint, c: TK.info },
    { k:'NO-BAL OK', on:t.allow_without_balance, bg:TK.warningTint, c:TK.warning },
    { k:'AUTO-ABSENT', on:t.auto_mark_absent, bg:TK.criticalTint, c:TK.critical },
    { k:'CF∞', on:t.carry_forward_unlimited, bg:TK.brandTint, c:TK.brandDeep },
  ]
  return <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{f.filter(x => x.on).map(x => <Pill key={x.k} text={x.k} bg={x.bg} color={x.c} />)}</div>
}

// ══ Leave Type form modal — every behaviour flag editable ═══════════
const BLANK: Partial<LeaveType> = {
  name:'', short_name:'', application_mode:'EMPLOYEE', eligible_from:'DOJ', min_tenure_days:0,
  probation_eligible:false, probation_limit:null, laps:false, encashment_after:null, max_times_in_tenure:null,
  allow_without_balance:false, auto_mark_absent:false, deduct_salary:false, gender:'ANY', approval_by:'HR_MANAGER',
  carry_forward_unlimited:false, is_system:false, annual_quota:0, carry_forward_max:0, is_paid:true,
  is_encashable:false, allow_half_day:true, accrual:'YEARLY', doc_required_after:null, color:TK.brand, sort_order:0,
}
function LeaveTypeModal({ row, companies, branches, onClose, onSave }: { row: LeaveType | null; companies: any[]; branches: any[]; onClose: () => void; onSave: (r: Partial<LeaveType>) => Promise<void> }) {
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
          <div><label style={T.lbl}>Color</label><input type="color" style={{ ...T.input, padding:2, height:36 }} value={f.color || TK.brand} onChange={e => set('color', e.target.value)} /></div>
          <div><label style={T.lbl}>Sort</label><input type="number" style={T.input} value={f.sort_order ?? 0} onChange={e => set('sort_order', Number(e.target.value))} /></div>
        </div>

        <div style={T.sec}>Behaviour</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:8 }}>
          <div><label style={T.lbl}>Application mode</label><select style={T.input} value={f.application_mode} onChange={e => set('application_mode', e.target.value as AppMode)}><option value="EMPLOYEE">Employee applies</option><option value="HR_MARK">HR marks</option><option value="EARN_AVAIL">Earn & avail</option></select></div>
          <div><label style={T.lbl}>Eligible from</label><select style={T.input} value={f.eligible_from} onChange={e => set('eligible_from', e.target.value as EligibleFrom)}><option value="DOJ">From DOJ</option><option value="ON_DOJ">On DOJ</option><option value="AFTER_DAYS">After N days</option><option value="AFTER_PROBATION">After probation</option></select></div>
          <div><label style={T.lbl}>Min tenure (days)</label><input type="number" style={T.input} value={f.min_tenure_days ?? 0} onChange={e => set('min_tenure_days', Number(e.target.value))} /></div>
          <div><label style={T.lbl}>Gender</label><select style={T.input} value={f.gender} onChange={e => set('gender', e.target.value as Gender)}><option value="ANY">Any</option><option value="M">Male only</option><option value="F">Female only</option></select></div>
          <div><label style={T.lbl}>Approval by</label><select style={T.input} value={f.approval_by} onChange={e => set('approval_by', e.target.value as ApprovalBy)}><option value="L1">L1 Manager</option><option value="HR_MANAGER">HR Manager</option><option value="ASSIGNED">Assigned approver</option><option value="BOTH">Both (L1 + HR Manager)</option></select></div>
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

        <div style={T.sec}>Applies to (scope — blank = all)</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div><label style={T.lbl}>Company</label><select style={T.input} value={f.company_id || ''} onChange={e => { set('company_id', e.target.value || null); set('branch_id', null) }}><option value="">All companies</option>{companies.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label style={T.lbl}>Branch / Location</label><select style={T.input} value={f.branch_id || ''} onChange={e => set('branch_id', e.target.value || null)} disabled={!f.company_id}><option value="">All branches</option>{branches.filter((b:any) => b.company_id === f.company_id).map((b:any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
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
        <div style={{ fontSize:12, color:TK.muted }}>Leave types are <b>data</b> — add a new type and a row is inserted; no code changes.</div>
        <button style={{ ...T.pri, marginLeft:'auto' }} onClick={onAdd}>+ Add leave type</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))', gap:12 }}>
        {types.map(t => (
          <div key={t.id} style={{ ...T.card, marginBottom:0, opacity: t.is_active ? 1 : 0.55, borderLeft:`4px solid ${t.color}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontSize:15, fontWeight:700 }}>{t.short_name}</span>
              <span style={{ fontSize:13, color:TK.inkSoft }}>{t.name}</span>
              {t.is_system && <Pill text="SYSTEM" bg={TK.sunken} color={TK.muted} />}
              {!t.is_active && <Pill text="INACTIVE" bg={TK.criticalTint} color={TK.critical} />}
            </div>
            <div style={{ fontSize:11, color:TK.muted, marginBottom:8 }}>
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
    <tr style={{ borderBottom: `1px solid ${TK.brandEdge}` }}>
      <td style={{ padding:'8px 9px', fontWeight:600, whiteSpace:'nowrap' }}>{row.short_name} <span style={{ fontWeight:400, color:TK.faint, fontSize:11 }}>{row.name}</span></td>
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
      <div style={{ ...T.card, position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr', gap:12 }}>
          <div><label style={T.lbl}>Company</label><select style={T.input} value={company} onChange={e => { const v = e.target.value; onCompany(v); if (v === 'ALL') onBranch('') }}><option value="">— Select company —</option><option value="ALL">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label style={T.lbl}>Branch</label><select style={T.input} value={branch} onChange={e => onBranch(e.target.value)} disabled={!company || company === 'ALL'}><option value="">Company default (all branches)</option>{coBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label style={T.lbl}>FY</label><input style={T.input} value={fy} onChange={e => onFy(e.target.value)} placeholder="2026-27" /></div>
        </div>
        <div style={{ fontSize:11, color:TK.faint, marginTop:8 }}>A branch-specific quota overrides the company default. The <b>source</b> column shows where a value comes from — branch / company / catalog. Saving creates or updates the policy row for this exact scope.</div>
      </div>

      {company === 'ALL' && <div style={{ ...T.card, fontSize:12, color: TK.brand, background:TK.infoTint, border: `1px solid ${TK.brandEdge}` }}>🌐 <b>All companies</b> — quotas below are shown from a template; clicking <b>Save</b> on a row applies that quota to <b>every</b> company (company-default scope).</div>}
      {!company ? <div style={{ ...T.card, textAlign:'center', color:TK.faint, padding:30 }}>Pick a company to see its quota.</div> : (
        <div style={{ ...T.card, overflowX:'auto', padding:0 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:TK.sunken }}>
              {['Leave type', 'Annual quota', 'Carry-fwd max', 'Source', ''].map(h => <th key={h} style={{ padding:'9px', textAlign:'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', letterSpacing:'.04em', borderBottom: `1px solid ${TK.brandEdge}` }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:TK.faint }}>No leave type is active.</td></tr>}
              {rows.map(r => <QuotaRow key={r.leave_type_id} row={r} onSave={onSave} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ══ TAB 3 · Bulk Upload (parse → preview → validate → commit) ══════
function downloadErrors(rows: ParsedRow[], name: string) {
  const errs = rows.filter(r => r.status === 'error').map(r => ({ Row: r.rowNo, ...r.cells, Error: r.msg }))
  if (!errs.length) return
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(errs), 'Errors')
  XLSX.writeFile(wb, name)
}
function StatChip({ icon, label, value, color, bg }: { icon: string; label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: bg, borderRadius: 9, padding: '8px 14px' }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div><div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 10, color: TK.muted, marginTop: 2 }}>{label}</div></div>
    </div>
  )
}
function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: TK.muted, padding: 20, textAlign: 'center' }}>No rows parsed.</div>
  const cols = Object.keys(rows[0].cells)
  return (
    <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid rgba(37,99,235,0.12)', borderRadius: 9 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ position: 'sticky', top: 0, background: TK.canvas, zIndex: 1 }}>
          <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, color: TK.muted, textTransform: 'uppercase', width: 36 }}>#</th>
          {cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, color: TK.muted, textTransform: 'uppercase' }}>{c}</th>)}
          <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10, color: TK.muted, textTransform: 'uppercase' }}>Status</th>
        </tr></thead>
        <tbody>{rows.map(r => { const ok = r.status === 'ok'; return (
          <tr key={r.rowNo} style={{ borderTop: `1px solid ${TK.brandEdge}`, background: ok ? '#fff' : TK.criticalTint }}>
            <td style={{ padding: '7px 10px', color: TK.muted, borderLeft: `3px solid ${ok ? '#10B981' : TK.critical}` }}>{r.rowNo}</td>
            {cols.map(c => <td key={c} style={{ padding: '7px 10px' }}>{String(r.cells[c] ?? '')}</td>)}
            <td style={{ padding: '7px 10px' }}>{ok ? <span style={{ fontSize: 11, color: TK.positive, fontWeight: 600 }}>✓ ok</span> : <span style={{ fontSize: 11, color: TK.critical }}>✗ {r.msg}</span>}</td>
          </tr>
        )})}</tbody>
      </table>
    </div>
  )
}
function UploadFlow({ title, desc, columns, errorFile, onTemplate, onParse, onCommit }: {
  title: string; desc: string; columns: string[]; errorFile: string
  onTemplate: () => Promise<void>; onParse: (f: File) => Promise<ParseResult>; onCommit: (rows: ParsedRow[]) => Promise<CommitResult>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<CommitResult | null>(null)
  const [drag, setDrag] = useState(false)
  const [tplBusy, setTplBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const handleFile = useCallback(async (f: File) => {
    setFile(f); setParsed(null); setResult(null); setParsing(true)
    try { setParsed(await onParse(f)) } catch (e: any) { alert('Parse failed: ' + (e?.message || 'check the file')) }
    setParsing(false)
  }, [onParse])
  async function commit() { if (!parsed) return; setCommitting(true); try { setResult(await onCommit(parsed.rows)) } catch (e: any) { alert('Upload failed: ' + (e?.message || '')) } setCommitting(false) }
  function reset() { setFile(null); setParsed(null); setResult(null) }
  return (
    <div style={T.card}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: TK.muted, marginBottom: 16 }}>{desc}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>{columns.map(c => <span key={c} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: TK.canvas, color: TK.brand, border: '1px solid rgba(37,99,235,0.12)' }}>{c}</span>)}</div>
      {!result && (<>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <button style={T.out} disabled={tplBusy} onClick={async () => { setTplBusy(true); try { await onTemplate() } catch {} setTplBusy(false) }}>⬇ {tplBusy ? 'Preparing…' : 'Download template'}</button>
        </div>
        <div onClick={() => inputRef.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
          style={{ border: `2px dashed ${drag ? TK.brand : 'rgba(37,99,235,0.3)'}`, borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: drag ? TK.canvas: TK.brandTint }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>{file ? '' : ''}</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{file ? file.name : 'Drag & drop Excel here, or click to browse'}</div>
          <div style={{ fontSize: 11, color: TK.muted, marginTop: 4 }}>{parsing ? 'Reading…' : '.xlsx / .xls'}</div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
        {parsed && (<div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <StatChip icon="✓" label="valid rows" value={parsed.valid} color={TK.positive} bg={TK.positiveTint} />
            <StatChip icon="⚠" label="errors" value={parsed.errors} color={TK.warning} bg={TK.warningTint} />
            <StatChip icon="–" label="blank skipped" value={parsed.skipped} color={TK.muted} bg={TK.sunken} />
          </div>
          <PreviewTable rows={parsed.rows} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...T.pri, opacity: parsed.valid && !committing ? 1 : 0.5 }} disabled={!parsed.valid || committing} onClick={commit}>{committing ? 'Uploading…' : `Confirm & upload ${parsed.valid} row${parsed.valid === 1 ? '' : 's'}`}</button>
            {parsed.errors > 0 && <button style={T.out} onClick={() => downloadErrors(parsed.rows, errorFile)}>⬇ Download {parsed.errors} errors</button>}
            <button style={{ ...T.out, border: 'none', color: TK.muted }} onClick={reset}>Start over</button>
          </div>
        </div>)}
      </>)}
      {result && (<div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}><span style={{ fontSize: 28 }}>{result.failed ? '' : ''}</span><div style={{ fontSize: 15, fontWeight: 600 }}>{result.failed ? 'Uploaded with some failures' : 'Upload complete'}</div></div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatChip icon="＋" label="inserted" value={result.inserted} color={TK.positive} bg={TK.positiveTint} />
          <StatChip icon="↻" label="updated" value={result.updated} color={TK.brand} bg={TK.canvas} />
          {result.failed > 0 && <StatChip icon="✗" label="failed" value={result.failed} color={TK.critical} bg={TK.criticalTint} />}
        </div>
        {result.errors.length > 0 && <div style={{ maxHeight: 140, overflowY: 'auto', background: TK.warningTint, borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>{result.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: TK.warning, padding: '2px 0' }}>{e.rowNo > 0 ? `Row ${e.rowNo}: ` : ''}{e.msg}</div>)}</div>}
        <button style={T.pri} onClick={reset}>Upload another file</button>
      </div>)}
    </div>
  )
}
function UploadTab() {
  return (
    <>
      <UploadFlow title="Branch-wise quota (all leave types)"
        desc="Per company + branch, each leave type's annual quota. Branch Code = ALL → company default."
        columns={['Company Code', 'Branch Code (ALL=default)', 'Leave Type Code', 'Annual Quota', 'Max Carry Forward', 'Laps (Y/N)', 'Encashable (Y/N)', 'Accrual', 'FY']}
        errorFile="quota_errors.xlsx" onTemplate={downloadQuotaTemplate} onParse={parseQuotaFile} onCommit={commitQuota} />
      <UploadFlow title="Employee leave balance"
        desc="Each employee's opening / accrued / used / encashed per leave type. For mid-year migration or correction."
        columns={['Employee Code', 'Leave Type Code', 'Year', 'Opening', 'Accrued', 'Used', 'Encashed']}
        errorFile="balance_errors.xlsx" onTemplate={downloadBalanceTemplate} onParse={parseBalanceFile} onCommit={commitBalances} />
      <div style={{ fontSize: 12, color: TK.muted }}>Templates include "Leave Types / Companies / Branches" reference sheets — copy valid codes from there.</div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function LeaveConfigPage() {
  const [section, setSection] = useState<'leave' | 'holidays'>('leave')
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
    try {
      // "All companies": list leave types using the first company as a template — saving applies to every company.
      const resolveCo = company === 'ALL' ? (companies[0]?.id || '') : company
      if (!resolveCo) { setQRows([]); return }
      setQRows(await resolveQuota(resolveCo, company === 'ALL' ? null : (branch || null), fy))
    }
    catch (e: any) { notify('Quota load failed: ' + (e?.message || ''), 'error') }
  }, [companies])
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
    if (!confirm(`Delete ${t.short_name}? All of its policies and balances will be deleted too.`)) return
    const { error } = await deleteLeaveType(t.id)
    if (error) { notify('Delete failed: ' + error.message, 'error'); return }
    notify('Deleted.'); reload()
  }
  async function saveQuota(leave_type_id: string, v: any) {
    if (qCompany === 'ALL') {
      // Apply this quota to every company (company-default scope, all branches).
      const results = await Promise.all(companies.map(c => upsertPolicy({ leave_type_id, company_id: c.id, branch_id: null, fy: qFy, ...v }) as any))
      const failed = results.find((r: any) => r?.error)
      if (failed) { notify('Save failed: ' + (failed as any).error.message, 'error'); return }
      notify(`Quota saved for all ${companies.length} companies.`); loadQuota(qCompany, qBranch, qFy)
      return
    }
    const { error } = await upsertPolicy({ leave_type_id, company_id: qCompany, branch_id: qBranch || null, fy: qFy, ...v }) as any
    if (error) { notify('Save failed: ' + error.message, 'error'); return }
    notify('Quota saved.'); loadQuota(qCompany, qBranch, qFy)
  }

  const tabs: [typeof tab, string][] = [['types', 'Leave Types'], ['quota', 'Branch Quota'], ['upload', 'Bulk Upload']]

  return (
    <div style={{ ...T.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1180, margin:'0 auto' }}>
        {/* Top-level section switch — Leave Config + Holiday/Weekly-off in one place */}
        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <button onClick={() => setSection('leave')} style={T.tab(section === 'leave')}>Leave Config</button>
          <button onClick={() => setSection('holidays')} style={T.tab(section === 'holidays')}>Holidays &amp; Week-off</button>
        </div>

        {section === 'holidays' ? <HolidaysSection /> : (<>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Leave Configuration</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Config-driven leave: catalog (types + behaviour flags) · per company/branch quota · bulk upload. Adding a leave type is a data change, not a deploy.</div>

        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          {tabs.map(([k, l]) => <button key={k} style={T.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {loading ? <div style={{ ...T.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading…</div> : (
          <>
            {tab === 'types' && <LeaveTypesTab types={types} onEdit={setEditing} onAdd={() => setEditing('new')} onToggle={toggleType} onDelete={delType} />}
            {tab === 'quota' && <BranchQuotaTab companies={companies} branches={branches} rows={qRows} company={qCompany} branch={qBranch} fy={qFy} onCompany={v => { setQCompany(v); setQBranch('') }} onBranch={setQBranch} onFy={setQFy} onSave={saveQuota} />}
            {tab === 'upload' && <UploadTab />}
          </>
        )}
        </>)}
      </div>
      {editing && <LeaveTypeModal row={editing === 'new' ? null : editing} companies={companies} branches={branches} onClose={() => setEditing(null)} onSave={saveType} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
