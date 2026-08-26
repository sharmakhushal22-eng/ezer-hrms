'use client'
// app/dashboard/transfer/page.tsx — Bulk (Type-1) location-movement transfer page.
// Admin "C" palette. All sub-components defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback } from 'react'
import * as HR from '@/lib/employees/hr-actions'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  page:  { background: TK.sunken, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px', padding:'24px 20px' } as React.CSSProperties,
  wrap:  { maxWidth:1100, margin:'0 auto' } as React.CSSProperties,
  card:  { background:TK.surface, borderRadius:10, border: `1px solid ${TK.line}`, padding:'16px 18px', marginBottom:14 } as React.CSSProperties,
  label: { fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.04em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 10px', background:TK.sunken, border: `1px solid ${TK.line}`, borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  pri:   { padding:'9px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:TK.onAccent } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:TK.ink, marginBottom:10, display:'flex', alignItems:'center', gap:6 } as React.CSSProperties,
  g2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } as React.CSSProperties,
  muted: { color:TK.muted } as React.CSSProperties,
}
const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10) }

// ── Filter bar ──────────────────────────────────────────────────────
function FilterBar({ companies, branches, company, setCompany, branch, setBranch, codes, setCodes }: {
  companies: any[]; branches: any[]; company: string; setCompany: (v: string) => void;
  branch: string; setBranch: (v: string) => void; codes: string; setCodes: (v: string) => void
}) {
  const compBranches = branches.filter(b => b.company_id === company)
  return (
    <div style={{ ...C.card, position:'sticky', top:0, zIndex:30, boxShadow:'var(--ez-shadow-flat)' }}>
      <div style={C.sec}>Filter Employees</div>
      <div style={{ ...C.g2, marginBottom:10 }}>
        <div><label style={C.label}>Company</label>
          <select style={C.input} value={company} onChange={e => { setCompany(e.target.value); setBranch('') }}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select></div>
        <div><label style={C.label}>Branch</label>
          <select style={C.input} value={branch} onChange={e => setBranch(e.target.value)} disabled={!company}>
            <option value="">All branches</option>
            {compBranches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.state ? ` · ${b.state}` : ''}</option>)}
          </select></div>
      </div>
      <label style={C.label}>Paste Employee Codes (comma-separated, overrides filters)</label>
      <textarea style={{ ...C.input, minHeight:52, resize:'vertical' }} value={codes} onChange={e => setCodes(e.target.value)} placeholder="SSM0042, SSM0043" />
    </div>
  )
}

// ── Employee select table ───────────────────────────────────────────
function EmployeeSelectTable({ employees, branches, selected, setSelected }: {
  employees: any[]; branches: any[]; selected: Set<string>; setSelected: (s: Set<string>) => void
}) {
  const branchName = (id: string) => branches.find(b => b.id === id)?.location_name || '—'
  const allSelected = employees.length > 0 && employees.every(e => selected.has(e.id))
  const toggle = (id: string) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s) }
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()) }
    else { setSelected(new Set(employees.map(e => e.id))) }
  }
  return (
    <div style={C.card}>
      <div style={C.sec}>Employees ({employees.length}) · {selected.size} selected</div>
      {employees.length === 0 ? <div style={{ fontSize:12, ...C.muted }}>No employees match the current filter.</div> : (
        <div style={{ border: `1px solid ${TK.line}`, borderRadius:10, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:TK.sunken, borderBottom: `1px solid ${TK.line}`, fontSize:11, fontWeight:600, color:TK.muted }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span style={{ flex:'0 0 120px' }}>CODE</span>
            <span style={{ flex:1 }}>NAME</span>
            <span style={{ flex:'0 0 180px' }}>CURRENT BRANCH</span>
          </div>
          <div style={{ maxHeight:320, overflowY:'auto' }}>
            {employees.map(e => (
              <label key={e.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom: `1px solid ${TK.line}`, fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                <span style={{ flex:'0 0 120px', fontWeight:600 }}>{e.emp_code}</span>
                <span style={{ flex:1 }}>{e.full_name}</span>
                <span style={{ flex:'0 0 180px', ...C.muted }}>{branchName(e.location_id)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mid-month warning ───────────────────────────────────────────────
function MidMonthWarning({ effectiveDate, toBranch, fromBranch }: { effectiveDate: string; toBranch: any; fromBranch: any }) {
  if (!effectiveDate || !toBranch) return null
  const isMid = new Date(effectiveDate).getDate() !== 1
  if (!isMid) return null
  const msg = (fromBranch && toBranch.state !== fromBranch.state)
    ? `Effective date is mid-month. For this month, statutory (PT/LWF/PF) will be per the PREVIOUS state (${fromBranch.state}). New state (${toBranch.state}) applies next month.`
    : `Effective mid-month; statutory stays ${fromBranch?.state || toBranch.state || '—'} this month.`
  return (
    <div style={{ background:TK.warningTint, border: `1px solid ${TK.warningTint}`, borderLeft: `3px solid ${TK.warningTint}`, borderRadius:10, padding:'10px 12px', marginBottom:12, fontSize:13, color: TK.warning }}>
      ⚠ {msg}
    </div>
  )
}

// ── Transfer details form ───────────────────────────────────────────
// Searchable dropdown (combobox) — filter as you type. allowCustom = the typed text becomes the value.
function SearchSelect({ value, onChange, options, placeholder, allowCustom }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; allowCustom?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find(o => o.value === value)?.label || (allowCustom ? (value || '') : '')
  useEffect(() => { setQ(selectedLabel) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = (open ? q : '').toLowerCase()
  const filtered = options.filter(o => o.label.toLowerCase().includes(needle)).slice(0, 60)
  return (
    <div style={{ position: 'relative' }}>
      <input style={C.input} placeholder={placeholder}
        value={open ? q : selectedLabel}
        onChange={e => { setQ(e.target.value); setOpen(true); if (allowCustom) onChange(e.target.value) }}
        onFocus={() => { setOpen(true); setQ(allowCustom ? (value || '') : '') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: 10, marginTop: 2, maxHeight: 220, overflowY: 'auto', zIndex: 30, boxShadow: '0 6px 18px rgba(0,0,0,0.10)' }}>
          {filtered.map(o => (
            <div key={o.value} onMouseDown={() => { onChange(o.value); setQ(o.label); setOpen(false) }}
              style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', color: TK.ink, background: o.value === value ? TK.canvas: TK.surface }}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function TransferDetailsForm({ branches, managers, departments, designations, form, setForm }: {
  branches: any[]; managers: any[]; departments: any[]; designations: string[]; form: any; setForm: (f: any) => void
}) {
  const set = (k: string, v: any) => setForm({ ...form, [k]: v })
  const branchOpts = branches.map(b => ({ value: b.id, label: `${b.location_name}${b.state ? ' · ' + b.state : ''}` }))
  const mgrOpts = managers.map(m => ({ value: m.id, label: `${m.full_name}${m.emp_code ? ' (' + m.emp_code + ')' : ''}` }))
  const deptOpts = departments.map(d => ({ value: d.id, label: d.dept_name }))
  const desigOpts = designations.map(s => ({ value: s, label: s }))
  return (
    <div style={C.card}>
      <div style={C.sec}>Transfer Details</div>
      <div style={{ ...C.g2, marginBottom:10 }}>
        <div><label style={C.label}>To Branch *</label>
          <SearchSelect value={form.to_branch_id} onChange={v => set('to_branch_id', v)} options={branchOpts} placeholder="Search branch…" /></div>
        <div><label style={C.label}>Effective Date *</label><input type="date" style={C.input} value={form.effective_date} onChange={e => set('effective_date', e.target.value)} /></div>
      </div>
      <div style={{ ...C.g2, marginBottom:10 }}>
        <div><label style={C.label}>New Reporting Manager</label>
          <SearchSelect value={form.new_reporting_manager_id} onChange={v => set('new_reporting_manager_id', v)} options={mgrOpts} placeholder="Search manager…" /></div>
        <div><label style={C.label}>New Designation</label>
          <SearchSelect value={form.new_designation} onChange={v => set('new_designation', v)} options={desigOpts} placeholder="Search or type designation…" allowCustom /></div>
      </div>
      <div style={{ ...C.g2, marginBottom:10 }}>
        <div><label style={C.label}>New Department</label>
          <SearchSelect value={form.new_department_id} onChange={v => set('new_department_id', v)} options={deptOpts} placeholder="Search department…" /></div>
        <div><label style={C.label}>New Cost Centre</label><input style={C.input} value={form.new_cost_centre} onChange={e => set('new_cost_centre', e.target.value)} placeholder="optional" /></div>
      </div>
      <div style={{ ...C.g2 }}>
        <div><label style={C.label}>Benefit Type</label>
          <select style={C.input} value={form.benefit_type} onChange={e => set('benefit_type', e.target.value)}>
            <option value="NONE">None</option><option value="RELOCATION">Relocation</option><option value="ONE_TIME_BONUS">One-time bonus</option>
          </select></div>
        {form.benefit_type !== 'NONE' && <div><label style={C.label}>Benefit Amount</label><input type="number" style={C.input} value={form.benefit_amount} onChange={e => set('benefit_amount', e.target.value)} /></div>}
      </div>
    </div>
  )
}

function Toast({ t }: { t: { msg: string; type: 'success'|'error' } }) {
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:99999, background: t.type==='success'?TK.positive:TK.critical, color:TK.onAccent, borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{t.type==='success'?'':''} {t.msg}</div>
}

// ════════════════════════════════════════════════════════════════
export default function TransferPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [managers, setManagers] = useState<any[]>([])

  const [company, setCompany] = useState('')
  const [branch, setBranch] = useState('')
  const [codes, setCodes] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<any>({
    to_branch_id:'', effective_date: todayISO(), new_reporting_manager_id:'',
    new_designation:'', new_department_id:'', new_cost_centre:'', benefit_type:'NONE', benefit_amount:'',
  })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success'|'error' } | null>(null)
  const notify = (msg: string, type: 'success'|'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500) }

  const load = useCallback(async () => {
    const [comp, loc, emp, dep, mgr] = await Promise.all([
      supabase.from('companies').select('id, company_name, status').eq('status', 'Active'),
      supabase.from('locations').select('id, location_name, state, company_id, status').eq('status', 'Active'),
      supabase.from('employees').select('id, full_name, emp_code, company_id, location_id, designation').eq('employment_status', 'Active'),
      supabase.from('departments').select('id, dept_name, company_id, status').eq('status', 'Active'),
      supabase.from('employees').select('id, full_name, emp_code').eq('employment_status', 'Active'),
    ])
    setCompanies(comp.data || []); setBranches(loc.data || []); setEmployees(emp.data || [])
    setDepartments(dep.data || []); setManagers(mgr.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  // Filtered employee list
  const codeList = codes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
  const filtered = employees.filter(e => {
    if (codeList.length) return codeList.includes((e.emp_code || '').toUpperCase())
    if (branch) return e.location_id === branch
    if (company) return e.company_id === company
    return true
  })

  const toBranch = branches.find(b => b.id === form.to_branch_id)
  const firstSelected = employees.find(e => selected.has(e.id))
  const fromBranch = firstSelected ? branches.find(b => b.id === firstSelected.location_id) : null

  const canSubmit = !!form.to_branch_id && !!form.effective_date && selected.size > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const res: any = await HR.initiateLocationTransfer({
        employee_ids: [...selected], to_branch_id: form.to_branch_id, effective_date: form.effective_date,
        new_reporting_manager_id: form.new_reporting_manager_id || undefined,
        new_designation: form.new_designation || undefined,
        new_department_id: form.new_department_id || undefined,
        new_cost_centre: form.new_cost_centre || undefined,
        benefit_type: form.benefit_type,
        benefit_amount: form.benefit_amount ? Number(form.benefit_amount) : undefined,
      }, { name: 'HR' })
      if (res?.ok) {
        notify(`Transfer initiated for ${selected.size} employees — letters sent`, 'success')
        setSelected(new Set())
        await load()
      } else {
        notify('Failed to initiate transfer', 'error')
      }
    } catch {
      notify('Failed to initiate transfer', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div style={C.page}>
      <div style={C.wrap}>
        <div className="ez-page-head">
          <div style={{ fontSize:22, fontWeight:700, color:TK.ink }}>Employee Transfer</div>
          <div style={{ fontSize:13, ...C.muted, marginTop:2 }}>Bulk move employees between branches within the same company. Transfer letters are generated and sent for acknowledgement.</div>
        </div>

        <FilterBar companies={companies} branches={branches} company={company} setCompany={setCompany} branch={branch} setBranch={setBranch} codes={codes} setCodes={setCodes} />
        <EmployeeSelectTable employees={filtered} branches={branches} selected={selected} setSelected={setSelected} />
        <TransferDetailsForm branches={branches} managers={managers} departments={departments} designations={Array.from(new Set(employees.map((e: any) => e.designation).filter(Boolean))).sort() as string[]} form={form} setForm={setForm} />
        <MidMonthWarning effectiveDate={form.effective_date} toBranch={toBranch} fromBranch={fromBranch} />

        <button style={{ ...C.pri, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }} disabled={!canSubmit} onClick={submit}>
          {busy ? 'Initiating…' : `Initiate Transfer (${selected.size})`}
        </button>
      </div>
      {toast && <Toast t={toast} />}
    </div>
  )
}
