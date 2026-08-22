'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import HRActionPanel from '@/components/employees/HRActionPanel'
import { buildEmpCode, TYPE_SUFFIX } from '@/lib/employee-code'
import BulkUploadModal from '@/components/employees/BulkUploadModal'
import * as XLSX from 'xlsx'
// This page keeps its own local Badge / Field / Section, so the system's
// equivalents are aliased where the names would clash.
import {
  Page as UIPage, PageHeader, Button, Person, Th, Td, Tr, Empty, SkeletonRows,
  Badge as Chip, inputStyle, tone,
  C, F, W, S, R, E, M, numeric, eyebrow,
  IconPlus, IconUpload, IconDownload, IconSearch, IconClose, IconEmployees,
} from '@/lib/ui'

// ─── Types ────────────────────────────────────────────────────
interface Employee {
  id: string; emp_code: string; common_code: string
  employment_type: string; full_name: string; first_name: string; last_name: string
  gender: string; date_of_birth: string; blood_group: string; marital_status: string
  employment_status: string; collar_type: string; employee_function: string
  employee_category: string; designation: string; grade: string
  group_doj: string; company_doj: string; confirmation_status: string
  mobile: string; personal_email: string; office_email: string
  pan_number: string; aadhar_last4: string; uan_number: string
  pf_applicable: boolean; esic_applicable: boolean; pt_applicable: boolean; lwf_applicable: boolean
  bank_name: string; bank_account_last4: string; ifsc_code: string; account_type: string
  l1_manager_id: string | null; l2_manager_id: string | null; hr_manager_id: string | null
  notice_period_days: number; date_of_resignation: string | null; last_working_date: string | null
  intern_pay: number | null; consultant_pay: number | null; contract_pay: number | null
  blacklisted: boolean; rehire_eligible: boolean; company_id: string; location_id: string; department_id: string
  companies?: { company_name: string; company_code: string }
  locations?: { location_name: string; city: string }
  departments?: { dept_name: string }
}

// ─── Palette ──────────────────────────────────────────────────
// Bound to the design system rather than restated. Every style helper below
// reads from here, so the whole page follows lib/ui/tokens.ts.
const P = {
  navy:C.ink, purple:C.brand, purpleDark:C.brandDeep,
  purpleBg:C.brandTint, purpleLight:C.sunken,
  border:C.line, card:C.surface, page:C.canvas,
  text:C.ink, muted:C.muted, green:C.positive, greenBg:tone('positive').bg,
  red:C.critical, redBg:tone('critical').bg, amber:C.warning, amberBg:tone('warning').bg,
}

/**
 * Grade is an ordered scale — L1 is not "a different kind of thing" from M3,
 * it is further along. The old map gave each grade an unrelated hue, which
 * made a ranked axis look categorical. These are one violet ramp, dark at the
 * senior end, so a column of them reads as a gradient rather than confetti.
 */
// Grade is an ordered scale, so the colour deepens with seniority rather than
// each grade taking an unrelated hue. Held in theme variables as bg/fg PAIRS
// so both halves flip together and stay readable in dark — the previous
// hardcoded violet ramp measured 2.19:1 on dark, which is invisible.
const g = (n: number) => ({ bg: `var(--ez-grade-${n}-bg)`, color: `var(--ez-grade-${n}-fg)` })
const GRADE_COLORS: Record<string,{bg:string;color:string}> = {
  L1: g(1), L2: g(1),
  M1: g(2), M2: g(3), M3: g(3),
  E1: g(4), E2: g(5), E3: g(5),
  W1: g(6), W2: g(6),
}
// Employment type IS categorical, so these stay distinct — but drawn from the
// token palette so they belong to the same world as everything else.
const TYPE_COLORS: Record<string,{bg:string;color:string}> = {
  Employee:{bg:C.brandTint,color:C.brandDeep},
  Intern:{bg:C.infoTint,color:C.info},
  NAPS:{bg:C.positiveTint,color:C.positive},
  NATS:{bg:C.warningTint,color:C.warning},
  Consultant:{bg:C.criticalTint,color:C.critical},
  Contract:{bg:C.sunken,color:C.muted},
}
const STATUS_COLORS: Record<string,{bg:string;color:string}> = {
  Active:{bg:C.positiveTint,color:C.positive},
  Resigned:{bg:C.criticalTint,color:C.critical},
  Terminated:{bg:C.criticalTint,color: C.critical},
  Absconding:{bg:C.warningTint,color:C.warning},
}

// ─── Inline style helpers ─────────────────────────────────────
const s = {
  page:   { display:'flex' as const, flexDirection:'column' as const, minHeight:'100vh', background:P.page, fontFamily:F.family, fontSize:F.body },
  topbar: { background:P.card, padding:'11px 20px', borderBottom:`1px solid ${P.border}`, display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const, position:'sticky' as const, top:0, zIndex:40 },
  body:   { flex:1, padding:`${S.lg}px ${S.xl}px ${S.huge}px` },
  card:   { background:P.card, borderRadius:R.lg, border:`1px solid ${P.border}`, marginBottom:S.md, boxShadow:E.raised } as React.CSSProperties,
  inp:    { ...inputStyle(), height:34, fontSize:F.small },
  sel:    { ...inputStyle(), height:34, fontSize:F.small, cursor:'pointer' } as React.CSSProperties,
  priBtn: { padding:'0 14px', height:34, background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:C.onAccent, border:`1px solid ${C.brandDeep}`, borderRadius:R.md, fontSize:F.small, fontWeight:W.semi, cursor:'pointer', display:'inline-flex' as const, alignItems:'center' as const, gap:6, boxShadow:E.brand, fontFamily:'inherit' },
  secBtn: { padding:'0 13px', height:34, background:P.card, color:P.text, border:`1px solid ${C.lineStrong}`, borderRadius:R.md, fontSize:F.small, fontWeight:W.medium, cursor:'pointer', display:'inline-flex' as const, alignItems:'center' as const, gap:6, boxShadow:E.flat, fontFamily:'inherit' },
  saveBtn:{ padding:'0 14px', height:34, background:C.positive, color:C.onAccent, border:'none', borderRadius:R.md, fontSize:F.small, fontWeight:W.semi, cursor:'pointer', display:'inline-flex' as const, alignItems:'center' as const, gap:6, fontFamily:'inherit' },
}

const initials = (n: string) => n?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'NA'
const fmt = (v: any) => !v || v === '' ? '—' : String(v)
const fmtDate = (v: string) => { if(!v) return '—'; const d = new Date(v); return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}).replace(/ /g,' ') }

// ─── Add Employee modal (defined OUTSIDE parent — no focus-loss) ─────
const EMP_TYPES = ['Employee', 'Intern', 'NAPS', 'NATS', 'Consultant', 'Contract']

// Export allowlist — only the columns marked "Keep in Report = Y" in the EZER column
// reference sheet. Encrypted PII (aadhar_encrypted / bank_account_encrypted) is Y in the
// sheet but its note says "NEVER in report", so it is deliberately excluded here.
const EXPORT_EMP_COLS = [
  // identity
  'emp_code','full_name','first_name','last_name','salutation','date_of_birth','gender','father_name','mother_name','spouse_name','marital_status','blood_group','nationality','religion','birth_place',
  // employment
  'employment_type','employment_status','designation','grade','band','group_doj','company_doj','confirmation_status','confirmation_date','l1_manager_id','hr_manager_id','notice_period_days','retirement_date','collar_type','management_level','work_location_type','cost_centre','induction_date','probation_months',
  // contact
  'mobile','alternate_mobile','personal_email','office_email','office_phone','emergency_name','emergency_relation','emergency_mobile','res_address1','res_city','res_state','res_pin','perm_address1','perm_city','perm_state','perm_pin',
  // statutory IDs
  'pan_number','aadhar_last4','uan_number','pf_account_number','esic_number',
  // bank
  'bank_name','bank_account_last4','ifsc_code','account_type',
  // statutory config
  'pf_applicable','epf_method','epf_wage_limit','pf_wage_type','esic_applicable','pt_applicable','professional_tax_state','lwf_applicable','lwf_state','gratuity_eligible','tds_regime','vpf_percent','nps_account',
  // exit
  'date_of_resignation','last_working_date','relieving_date','leaving_reason',
]
const EXPORT_NAME_COLS = ['company_name','company_code','department_name','location_name','location_city']
const mc = {
  inp:   { ...inputStyle() },
  lbl:   { ...eyebrow, display:'block', marginBottom:4 } as React.CSSProperties,
  pri:   { padding:'0 16px', height:36, background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:C.onAccent, border:`1px solid ${C.brandDeep}`, borderRadius:R.md, fontSize:F.small, fontWeight:W.semi, cursor:'pointer', fontFamily:'inherit', boxShadow:E.brand },
  out:   { padding:'0 14px', height:36, background:C.surface, color:C.ink, border:`1px solid ${C.lineStrong}`, borderRadius:R.md, fontSize:F.small, fontWeight:W.medium, cursor:'pointer', fontFamily:'inherit' },
}

// Next type-wise code from existing employees (no migration dependency, atomic-ish).
async function nextEmpCode(companyCode: string, companyId: string, employmentType: string): Promise<string> {
  const suffix = TYPE_SUFFIX[employmentType] ?? ''
  const prefix = `${(companyCode || 'EZ').toUpperCase()}${suffix}`
  const { data } = await supabase.from('employees').select('emp_code').eq('company_id', companyId).eq('employment_type', employmentType)
  let max = 0
  const re = new RegExp(`^${prefix}(\\d{4})$`)
  for (const r of (data || []) as any[]) { const m = String(r.emp_code || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  return buildEmpCode(companyCode || 'EZ', employmentType, max + 1)
}

function AddEmployeeModal({ companies, locations, departments, onClose, onSaved }: {
  companies: any[]; locations: any[]; departments: any[]
  onClose: () => void; onSaved: (msg: string) => void
}) {
  const [f, setF] = useState<any>({ full_name:'', company_id:'', location_id:'', department_id:'', employment_type:'Employee', designation:'', mobile:'', personal_email:'', company_doj:'', emp_code:'' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  const locs = locations.filter(l => l.company_id === f.company_id)
  const depts = departments.filter(d => d.company_id === f.company_id)
  const company = companies.find(c => c.id === f.company_id)

  // auto-fill the code when company + type are chosen (HR can still override)
  useEffect(() => {
    let live = true
    if (f.company_id && f.employment_type) {
      nextEmpCode(company?.company_code || 'EZ', f.company_id, f.employment_type).then(c => { if (live) setF((p: any) => ({ ...p, emp_code: c })) })
    }
    return () => { live = false }
  }, [f.company_id, f.employment_type]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = f.full_name.trim() && f.company_id && f.emp_code.trim()

  async function save() {
    setErr(''); setBusy(true)
    try {
      const code = f.emp_code.trim().toUpperCase()
      const { data: dup } = await supabase.from('employees').select('id').eq('emp_code', code).maybeSingle()
      if (dup) { setErr(`Code ${code} already exists.`); setBusy(false); return }
      const parts = f.full_name.trim().split(/\s+/)
      const row = {
        emp_code: code, common_code: code,
        company_id: f.company_id, location_id: f.location_id || null, department_id: f.department_id || null,
        full_name: f.full_name.trim(), first_name: parts[0], last_name: parts.slice(1).join(' ') || null,
        designation: f.designation || null, employment_type: f.employment_type,
        employment_status: 'Active', confirmation_status: 'Probation',
        company_doj: f.company_doj || null, group_doj: f.company_doj || null,
        mobile: f.mobile || null, personal_email: f.personal_email || null, is_test: false,
      }
      const { error } = await supabase.from('employees').insert(row)
      if (error) { setErr(error.message); setBusy(false); return }
      onSaved(`${f.full_name.trim()} added (${code}).`)
    } catch (e: any) { setErr(e?.message || 'Failed'); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }} onClick={onClose}>
      <div style={{ background:C.surface, borderRadius:'12px', padding:'20px', maxWidth:'620px', width:'100%', maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:'16px', fontWeight:600, marginBottom:'14px', color:C.ink }}>Add Employee</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'12px' }}>
          <div style={{ gridColumn:'1 / 3' }}><label style={mc.lbl}>Full name *</label><input style={mc.inp} value={f.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Rahul Sharma" /></div>
          <div><label style={mc.lbl}>Employment type</label><select style={mc.inp} value={f.employment_type} onChange={e => set('employment_type', e.target.value)}>{EMP_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label style={mc.lbl}>Company *</label><select style={mc.inp} value={f.company_id} onChange={e => { set('company_id', e.target.value); set('location_id',''); set('department_id','') }}><option value="">— Select —</option>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name || c.company_code}</option>)}</select></div>
          <div><label style={mc.lbl}>Location / Branch</label><select style={mc.inp} value={f.location_id} onChange={e => set('location_id', e.target.value)} disabled={!f.company_id}><option value="">— Select —</option>{locs.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}</select></div>
          <div><label style={mc.lbl}>Department</label><select style={mc.inp} value={f.department_id} onChange={e => set('department_id', e.target.value)} disabled={!f.company_id}><option value="">— Select —</option>{depts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</select></div>
          <div><label style={mc.lbl}>Designation</label><input style={mc.inp} value={f.designation} onChange={e => set('designation', e.target.value)} /></div>
          <div><label style={mc.lbl}>Mobile</label><input style={mc.inp} value={f.mobile} onChange={e => set('mobile', e.target.value)} /></div>
          <div><label style={mc.lbl}>Personal email</label><input style={mc.inp} value={f.personal_email} onChange={e => set('personal_email', e.target.value)} /></div>
          <div><label style={mc.lbl}>Date of joining</label><input type="date" style={mc.inp} value={f.company_doj} onChange={e => set('company_doj', e.target.value)} /></div>
          <div style={{ gridColumn:'1 / 3' }}><label style={mc.lbl}>Employee code (auto)</label><input style={mc.inp} value={f.emp_code} onChange={e => set('emp_code', e.target.value.toUpperCase())} placeholder="auto" /></div>
        </div>
        {err && <div style={{ background:C.criticalTint, color:C.critical, fontSize:'12px', padding:'8px 12px', borderRadius:'7px', marginBottom:'12px' }}>{err}</div>}
        <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
          <button style={mc.out} onClick={onClose}>Cancel</button>
          <button style={{ ...mc.pri, opacity: ready && !busy ? 1 : 0.5 }} disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Add employee'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components — defined OUTSIDE parent to prevent re-mount ──

function StatCard({ label, value, color, onClick, active }: any) {
  return (
    <div onClick={onClick} style={{ background: active ? P.purple : P.card, border:`1px solid ${active ? P.purple : P.border}`, borderRadius:'10px', padding:'10px 8px', textAlign:'center', cursor:'pointer', borderTop:`3px solid ${color}`, transition:'all .15s' }}>
      <div style={{ fontSize:'20px', fontWeight:700, color: active ? '#fff' : color }}>{value}</div>
      <div style={{ fontSize:'10px', color: active ? 'rgba(255,255,255,.7)' : P.muted, marginTop:'2px' }}>{label}</div>
    </div>
  )
}

function Badge({ val, map }: { val: string; map: Record<string,{bg:string;color:string}> }) {
  const c = map[val] || {bg:C.sunken,color:C.inkSoft}
  return <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:500, background:c.bg, color:c.color, whiteSpace:'nowrap' }}>{val || '—'}</span>
}

// Profile header strip
function ProfileHeader({ emp, editMode, saving, onEdit, onSave, onCancel }: any) {
  const gc = GRADE_COLORS[emp.grade] || {bg:C.sunken,color:C.inkSoft}
  return (
    <div style={{ background:P.navy, padding:'18px 24px 0', borderRadius:'14px 14px 0 0' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:'16px', paddingBottom:'14px' }}>
        {/* Avatar */}
        <div style={{ width:'64px', height:'64px', borderRadius:'50%', background:emp.gender==='Female'?'#FCE7F3':P.purpleBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', fontWeight:700, color:emp.gender==='Female'?'#BE185D':P.purple, flexShrink:0, border:'3px solid rgba(255,255,255,.15)' }}>
          {initials(emp.full_name)}
        </div>
        {/* Info */}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'17px', fontWeight:600, color:C.onAccent, marginBottom:'3px' }}>{emp.full_name}</div>
          <div style={{ fontSize:'12px', color:C.onAccentDim, marginBottom:'8px' }}>{emp.emp_code} · {fmt(emp.designation)} · {(emp as any).companies?.company_name || '—'}</div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:500, ...TYPE_COLORS[emp.employment_type] }}>{emp.employment_type}</span>
            <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:500, ...STATUS_COLORS[emp.employment_status] }}>{emp.employment_status}</span>
            <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:500, ...gc }}>{emp.grade}</span>
          </div>
        </div>
        {/* Actions */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          {editMode ? (
            <>
              <button onClick={onCancel} style={{ padding:'7px 14px', background:'rgba(255,255,255,.1)', color:C.onAccent, border:'1px solid rgba(255,255,255,.25)', borderRadius:'8px', cursor:'pointer', fontSize:'12px' }}>Cancel</button>
              <button onClick={onSave} disabled={saving} style={{ ...s.saveBtn, opacity: saving ? .7 : 1 }}>
                <span>{saving ? '' : ''}</span>{saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ) : (
            <button onClick={onEdit} style={{ ...s.priBtn }}>
              <span></span> Edit profile
            </button>
          )}
        </div>
      </div>
      {/* Quick stat strip */}
      <div style={{ background:'rgba(255,255,255,.06)', margin:'0 -24px', padding:'8px 24px', display:'flex', gap:'20px', flexWrap:'wrap', borderTop:'1px solid rgba(255,255,255,.08)' }}>
        {[
          { l:'Group DOJ', v: fmtDate(emp.group_doj) },
          { l:'Company DOJ', v: fmtDate(emp.company_doj) },
          { l:'Confirmation', v: fmt(emp.confirmation_status) },
          { l:'Department', v: (emp as any).departments?.dept_name || '—' },
          { l:'Location', v: (emp as any).locations?.location_name || '—' },
          { l:'Notice Period', v: emp.notice_period_days ? `${emp.notice_period_days} days` : '—' },
        ].map(x => (
          <div key={x.l} style={{ fontSize:'11px', color:C.onAccentDim }}>
            {x.l}: <span style={{ color:C.onAccent, fontWeight:500 }}>{x.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Single info row — view or edit
function Field({ label, value, editMode, fieldKey, editForm, setEditForm, type, opts }: any) {
  return (
    <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
      <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>{label}</div>
      {editMode ? (
        opts ? (
          <select style={s.sel} value={editForm[fieldKey] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))}>
            <option value="">— Select —</option>
            {opts.map((o: string) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type || 'text'} style={s.inp} value={editForm[fieldKey] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))} />
        )
      ) : (
        <div style={{ fontSize:'13px', color: value && value !== '—' ? P.text : P.muted }}>{value || '—'}</div>
      )}
    </div>
  )
}

// Section wrapper
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom:'0', padding:'16px 20px', borderBottom:`1px solid ${P.border}` }}>
      <div style={{ fontSize:'11px', fontWeight:600, color:P.purple, textTransform:'uppercase', letterSpacing:'.7px', marginBottom:'12px', display:'flex', alignItems:'center', gap:'6px' }}>
        <span>{icon}</span>{title}
      </div>
      {children}
    </div>
  )
}

// Two-column grid
function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px' }}>{children}</div>
}

// Tab bar
function TabBar({ tabs, active, onChange }: any) {
  return (
    <div style={{ display:'flex', background:C.sunken, borderBottom:`1px solid ${P.border}`, overflowX:'auto' }}>
      {tabs.map((t: any) => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding:'11px 16px', border:'none', background:'transparent', cursor:'pointer',
          fontSize:'12px', fontWeight: active===t.id ? 600 : 400,
          color: active===t.id ? P.purple : P.muted, whiteSpace:'nowrap',
          borderBottom: active===t.id ? `2.5px solid ${P.purple}` : '2.5px solid transparent',
          transition:'all .12s'
        }}>
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  )
}

// Statutory chip
function StatChip({ label, value }: { label: string; value: boolean }) {
  return (
    <div style={{ flex:1, padding:'10px 8px', borderRadius:'10px', background:value?P.greenBg:P.page, border:`1px solid ${value?'#BBF7D0':P.border}`, textAlign:'center' }}>
      <div style={{ fontSize:'11px', fontWeight:600, color:P.text }}>{label}</div>
      <div style={{ fontSize:'10px', color:value?P.green:P.muted, marginTop:'4px', fontWeight:500 }}>{value ? 'Yes' : 'No'}</div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────
export default function EmployeeMaster() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [departments, setDepts]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [total, setTotal]         = useState(0)
  const [search, setSearch]       = useState('')
  const [filterCompany, setFCo]   = useState('')
  const [filterLocation, setFLoc] = useState('')
  const [filterDept, setFDept]    = useState('')
  const [filterType, setFType]    = useState('')
  const [filterStatus, setFStatus]= useState('Active')
  const [filterGrade, setFGrade]  = useState('')
  const [page, setPage]           = useState(1)
  const [selected, setSelected]   = useState<Employee|null>(null)
  const [profileTab, setProfileTab] = useState('personal')
  const [showDrawer, setShowDrawer] = useState(false)
  const [editMode, setEditMode]   = useState(false)
  const [editForm, setEditForm]   = useState<any>({})
  const [saving, setSaving]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [showBulk, setShowBulk]   = useState(false)
  const [addMsg, setAddMsg]       = useState('')
  const [exporting, setExporting] = useState(false)
  const [stats, setStats] = useState({ total:0,active:0,resigned:0,employee:0,intern:0,naps:0,nats:0,consultant:0,contract:0 })
  const PER_PAGE = 20

  const fetchStats = useCallback(async () => {
    let q = supabase.from('employees').select('employment_status,employment_type').neq('is_test', true)
    if (filterCompany)  q = q.eq('company_id', filterCompany)
    if (filterLocation) q = q.eq('location_id', filterLocation)
    if (filterDept)     q = q.eq('department_id', filterDept)
    const { data } = await q
    if (!data) return
    setStats({
      total:data.length, active:data.filter(e=>e.employment_status==='Active').length,
      resigned:data.filter(e=>e.employment_status==='Resigned').length,
      employee:data.filter(e=>e.employment_type==='Employee').length,
      intern:data.filter(e=>e.employment_type==='Intern').length,
      naps:data.filter(e=>e.employment_type==='NAPS').length,
      nats:data.filter(e=>e.employment_type==='NATS').length,
      consultant:data.filter(e=>e.employment_type==='Consultant').length,
      contract:data.filter(e=>e.employment_type==='Contract').length,
    })
  }, [filterCompany, filterLocation, filterDept])

  const fetchMeta = async () => {
    const [co,lo,de] = await Promise.all([
      supabase.from('companies').select('id,company_name,company_code').eq('status','Active'),
      supabase.from('locations').select('id,location_name,city,company_id').eq('status','Active'),
      supabase.from('departments').select('id,dept_name,company_id').eq('status','Active'),
    ])
    setCompanies(co.data||[]); setLocations(lo.data||[]); setDepts(de.data||[])
  }

  const fetchEmployees = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // select('*') keeps the list resilient to schema additions (intern_pay,
      // consultant_pay, any future column) — it returns only columns that exist,
      // so it never 400s on a column that hasn't been migrated yet.
      // locations!location_id — employees has two FKs to locations (location_id +
      // actual_posted_location_id); disambiguate or the embed 400s.
      let q = supabase.from('employees').select(
        `*, companies(company_name,company_code), locations!location_id(location_name,city), departments(dept_name)`,
        { count: 'exact' }
      ).neq('is_test', true).order('emp_code')

      if (filterCompany)  q = q.eq('company_id', filterCompany)
      if (filterLocation) q = q.eq('location_id', filterLocation)
      if (filterDept)     q = q.eq('department_id', filterDept)
      if (filterType)     q = q.eq('employment_type', filterType)
      if (filterStatus)   q = q.eq('employment_status', filterStatus)
      if (filterGrade)    q = q.eq('grade', filterGrade)
      if (search.trim())  q = q.or(`full_name.ilike.%${search}%,emp_code.ilike.%${search}%,common_code.ilike.%${search}%,designation.ilike.%${search}%,mobile.ilike.%${search}%`)

      const from = (page-1)*PER_PAGE
      q = q.range(from, from+PER_PAGE-1)
      const { data, error:err, count } = await q
      if (err) throw err
      setEmployees((data as any[])||[]); setTotal(count||0)
    } catch(e:any) { setError(e.message||'Load failed') }
    finally { setLoading(false) }
  }, [search,filterCompany,filterLocation,filterDept,filterType,filterStatus,filterGrade,page])

  // Export ALL employees matching the current filters (no pagination) to Excel —
  // every employees column plus CTC master and current Salary Structure.
  const exportExcel = async () => {
    setExporting(true)
    try {
      let q = supabase.from('employees')
        .select('*, companies(company_name, company_code), departments(dept_name), locations!location_id(location_name, city)')
        .neq('is_test', true).order('emp_code')
      if (filterCompany)  q = q.eq('company_id', filterCompany)
      if (filterLocation) q = q.eq('location_id', filterLocation)
      if (filterDept)     q = q.eq('department_id', filterDept)
      if (filterType)     q = q.eq('employment_type', filterType)
      if (filterStatus)   q = q.eq('employment_status', filterStatus)
      if (filterGrade)    q = q.eq('grade', filterGrade)
      if (search.trim())  q = q.or(`full_name.ilike.%${search}%,emp_code.ilike.%${search}%,common_code.ilike.%${search}%,designation.ilike.%${search}%,mobile.ilike.%${search}%`)
      const { data, error: err } = await q
      if (err) throw err
      const list = (data as any[] || [])
      if (!list.length) { alert('No employees to export for the current filters.'); setExporting(false); return }

      const ids = list.map(e => e.id)
      const ctcMap = new Map<string, any>()
      const salMap = new Map<string, any>()
      try {
        const { data: ctc } = await supabase.from('ctc_master').select('*').in('employee_id', ids).order('created_at', { ascending: false })
        for (const c of (ctc || []) as any[]) if (!ctcMap.has(c.employee_id)) ctcMap.set(c.employee_id, c)
      } catch { /* ctc_master optional */ }
      try {
        const { data: sal } = await supabase.from('salary_structures').select('*').in('employee_id', ids).order('effective_date', { ascending: false })
        for (const sr of (sal || []) as any[]) if (!salMap.has(sr.employee_id)) salMap.set(sr.employee_id, sr)
      } catch { /* salary_structures optional */ }
      const addPrefixed = (flat: Record<string, any>, obj: any, prefix: string, skip: string[]) => {
        if (!obj) return
        for (const [k, v] of Object.entries(obj)) {
          if (skip.includes(k)) continue
          flat[prefix + k] = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)
        }
      }

      const rows = list.map(e => {
        const { companies, departments, locations, ...scalar } = e
        const flat: Record<string, any> = {}
        for (const [k, v] of Object.entries(scalar)) {
          flat[k] = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)
        }
        flat['company_name'] = companies?.company_name || ''
        flat['company_code'] = companies?.company_code || ''
        flat['department_name'] = departments?.dept_name || ''
        flat['location_name'] = locations?.location_name || ''
        flat['location_city'] = locations?.city || ''
        addPrefixed(flat, ctcMap.get(e.id), 'CTC_', ['id', 'employee_id', 'company_id', 'created_at', 'updated_at'])
        addPrefixed(flat, salMap.get(e.id), 'SAL_', ['id', 'employee_id', 'created_at', 'created_by'])
        return flat
      })
      // Column reference sheet — keep only "Y" employee columns + name/code joins + the
      // CTC / Salary breakup (all Y). Everything else (backend/*_id/unlisted columns) is dropped.
      const allRaw = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set }, new Set<string>()))
      const empPresent = EXPORT_EMP_COLS.filter(k => allRaw.includes(k))
      const nameCols = EXPORT_NAME_COLS.filter(k => allRaw.includes(k))
      const ctcKeys = allRaw.filter(k => k.startsWith('CTC_')).sort()
      const salKeys = allRaw.filter(k => k.startsWith('SAL_')).sort()
      // Order: emp_code, full_name, then company/dept/location names, remaining employee cols, CTC, Salary.
      const lead = ['emp_code', 'full_name']
      const header = [
        ...lead.filter(k => empPresent.includes(k)),
        ...nameCols,
        ...empPresent.filter(k => !lead.includes(k)),
        ...ctcKeys, ...salKeys,
      ]
      const trimmed = rows.map(r => { const o: Record<string, any> = {}; for (const k of header) o[k] = (k in r) ? r[k] : ''; return o })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trimmed, { header }), 'Employees')
      XLSX.writeFile(wb, `EZER_Employees_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e: any) {
      alert('Export failed: ' + (e?.message || 'unknown error'))
    }
    setExporting(false)
  }

  useEffect(() => { fetchMeta() }, [])
  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { setPage(1) }, [search,filterCompany,filterLocation,filterDept,filterType,filterStatus,filterGrade])
  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  const filteredLocs  = filterCompany ? locations.filter(l=>l.company_id===filterCompany) : locations
  const filteredDepts = filterCompany ? departments.filter(d=>d.company_id===filterCompany) : departments
  const totalPages    = Math.ceil(total/PER_PAGE)

  const openProfile = (emp: Employee) => {
    setSelected(emp)
    setProfileTab('personal')
    setEditMode(false)
    setEditForm({})
    setShowDrawer(true)
  }

  // openEdit — populate the form and switch to edit mode. Optional `emp` lets the
  // row-level Edit button open the drawer straight into edit mode.
  const EDIT_FIELDS = ['full_name','first_name','last_name','gender','date_of_birth','blood_group','marital_status','designation','grade','employment_type','employment_status','collar_type','employee_function','employee_category','mobile','personal_email','office_email','notice_period_days','intern_pay','consultant_pay','contract_pay',
    'father_name','mother_name','spouse_name','nationality','religion','birth_place','pan_number','uan_number','alternate_mobile',
    'res_address1','res_city','res_state','res_pin','perm_address1','perm_city','perm_state','perm_pin',
    'emergency_name','emergency_relation','emergency_mobile','emergency2_name','emergency2_relation','emergency2_mobile']
  const openEdit = (emp?: Employee) => {
    const src = emp ?? selected
    if (!src) return
    const f: any = {}
    for (const k of EDIT_FIELDS) f[k] = (src as any)[k] ?? ''
    if (emp) { setSelected(emp); setProfileTab('personal'); setShowDrawer(true) }
    setEditForm(f)
    setEditMode(true)
  }

  const cancelEdit = () => {
    if (Object.keys(editForm).some(k => String(editForm[k]??'') !== String((selected as any)?.[k]??'')) ) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    setEditMode(false); setEditForm({})
  }

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    const patch: any = { ...editForm }
    if (patch.notice_period_days !== '') patch.notice_period_days = Number(patch.notice_period_days)||0
    // Pay columns are numeric — blank → null, otherwise coerce to a number.
    for (const k of ['intern_pay','consultant_pay','contract_pay']) patch[k] = (patch[k] === '' || patch[k] == null) ? null : (Number(patch[k]) || 0)
    const { error } = await supabase.from('employees').update(patch).eq('id', selected.id)
    setSaving(false)
    if (error) { alert('Save failed: '+error.message); return }
    const updated = { ...selected, ...patch }
    setSelected(updated as Employee)
    setEditMode(false); setEditForm({})
    fetchEmployees()
  }

  const closeDrawer = () => {
    if (editMode && !window.confirm('Discard unsaved changes?')) return
    setShowDrawer(false); setEditMode(false); setEditForm({}); setSelected(null)
  }

  const TABS = [
    { id:'personal',   label:'Personal',   icon:'' },
    { id:'employment', label:'Employment',  icon:'' },
    { id:'statutory',  label:'Statutory',   icon:'' },
    { id:'bank',       label:'Bank',        icon:'' },
    { id:'documents',  label:'Documents',   icon:'' },
    { id:'salary',     label:'Salary',      icon:'' },
    { id:'onboarding', label:'Onboarding',  icon:'' },
    { id:'actions',    label:'HR Actions',  icon:'' },
    { id:'history',    label:'History',     icon:'' },
  ]

  // ─── Render profile tab content ───────────────────────────────
  const renderTab = (emp: Employee) => {
    const ef = editForm
    const F = (label: string, key: string, type?: string, opts?: string[]) => (
      <Field key={key} label={label} value={key === 'date_of_birth' || key.includes('doj') ? fmtDate((emp as any)[key]) : fmt((emp as any)[key])}
        editMode={editMode} fieldKey={key} editForm={ef} setEditForm={setEditForm} type={type} opts={opts} />
    )

    if (profileTab === 'personal') return (
      <div>
        <Section title="Identity" icon="🪪">
          <Grid2>
            {F('Full Name','full_name')} {F('Common Code','common_code')}
            {F('First Name','first_name')} {F('Last Name','last_name')}
            {F('Gender','gender','text',['Male','Female','Other'])}
            {F('Date of Birth','date_of_birth','date')}
            {F('Blood Group','blood_group','text',['A+','A-','B+','B-','O+','O-','AB+','AB-'])}
            {F('Marital Status','marital_status','text',['Single','Married','Divorced','Widowed'])}
            {F('Nationality','nationality')} {F('Religion','religion')}
            {F('Birth Place','birth_place')}
          </Grid2>
        </Section>
        <Section title="Family" icon="👪">
          <Grid2>
            {F("Father's Name",'father_name')} {F("Mother's Name",'mother_name')}
            {F('Spouse Name','spouse_name')}
          </Grid2>
        </Section>
        <Section title="Contact" icon="📞">
          <Grid2>
            {F('Mobile','mobile')} {F('Alternate Mobile','alternate_mobile')}
            {F('Personal Email','personal_email')} {F('Office Email','office_email')}
            <div style={{padding:'8px 0',borderBottom:`1px solid ${P.border}`}}>
              <div style={{fontSize:'10px',color:P.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px',fontWeight:500}}>Aadhaar</div>
              <div style={{fontSize:'13px',color:P.text}}>XXXX-XXXX-{emp.aadhar_last4 || '—'}</div>
            </div>
            {F('PAN Number','pan_number')} {F('UAN Number','uan_number')}
          </Grid2>
        </Section>
        <Section title="Residential Address" icon="🏠">
          <Grid2>
            {F('Address','res_address1')} {F('City','res_city')}
            {F('State','res_state')} {F('PIN','res_pin')}
          </Grid2>
        </Section>
        <Section title="Permanent Address" icon="📍">
          <Grid2>
            {F('Address','perm_address1')} {F('City','perm_city')}
            {F('State','perm_state')} {F('PIN','perm_pin')}
          </Grid2>
        </Section>
        <Section title="Emergency Contact" icon="🚨">
          <Grid2>
            {F('Name','emergency_name')} {F('Relation','emergency_relation')}
            {F('Mobile','emergency_mobile')}
          </Grid2>
          <Grid2>
            {F('Alt. Name','emergency2_name')} {F('Alt. Relation','emergency2_relation')}
            {F('Alt. Mobile','emergency2_mobile')}
          </Grid2>
        </Section>
      </div>
    )

    if (profileTab === 'employment') return (
      <div>
        <Section title="Employment Details" icon="💼">
          <Grid2>
            {F('Designation','designation')}
            {F('Grade','grade')}
            {F('Employment Type','employment_type','text',['Employee','Intern','NAPS','NATS','Consultant','Contract'])}
            {F('Employment Status','employment_status','text',['Active','Resigned','Sabbatical','Abscond','Inactive'])}
            {F('Collar Type','collar_type','text',['White Collar','Blue Collar'])}
            {F('Function','employee_function')}
            {F('Category','employee_category')}
            {F('Notice Period (Days)','notice_period_days','number')}
            {emp.employment_type === 'Intern' && F('Intern Pay (₹)','intern_pay','number')}
            {emp.employment_type === 'Consultant' && F('Consultant Pay (₹)','consultant_pay','number')}
            {emp.employment_type === 'Contract' && F('Contract Pay (₹)','contract_pay','number')}
          </Grid2>
        </Section>
        <Section title="Joining & Confirmation" icon="📅">
          <Grid2>
            {F('Group DOJ','group_doj','date')}
            {F('Company DOJ','company_doj','date')}
            {F('Confirmation Status','confirmation_status','text',['Probation','Confirmed'])}
            <div style={{padding:'8px 0',borderBottom:`1px solid ${P.border}`}}>
              <div style={{fontSize:'10px',color:P.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px',fontWeight:500}}>Company</div>
              <div style={{fontSize:'13px',color:P.text}}>{(emp as any).companies?.company_name || '—'}</div>
            </div>
            <div style={{padding:'8px 0',borderBottom:`1px solid ${P.border}`}}>
              <div style={{fontSize:'10px',color:P.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px',fontWeight:500}}>Location / Branch</div>
              <div style={{fontSize:'13px',color:P.text}}>{(emp as any).locations?.location_name || '—'}</div>
            </div>
            <div style={{padding:'8px 0',borderBottom:`1px solid ${P.border}`}}>
              <div style={{fontSize:'10px',color:P.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px',fontWeight:500}}>Department</div>
              <div style={{fontSize:'13px',color:P.text}}>{(emp as any).departments?.dept_name || '—'}</div>
            </div>
          </Grid2>
        </Section>
        {emp.employment_status === 'Resigned' && (
          <Section title="Exit Details" icon="🚪">
            <Grid2>
              {F('Date of Resignation','date_of_resignation','date')}
              {F('Last Working Date','last_working_date','date')}
            </Grid2>
            <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
              <div style={{ padding:'6px 12px', borderRadius:'8px', background:emp.rehire_eligible?P.greenBg:P.page, border:`1px solid ${emp.rehire_eligible?'#BBF7D0':P.border}`, fontSize:'11px', color:emp.rehire_eligible?P.green:P.muted }}>{emp.rehire_eligible?'Rehire Eligible':'Not Rehire Eligible'}</div>
              {emp.blacklisted && <div style={{ padding:'6px 12px', borderRadius:'8px', background:P.redBg, border:`1px solid #FCA5A5`, fontSize:'11px', color:P.red }}>Blacklisted</div>}
            </div>
          </Section>
        )}
      </div>
    )

    if (profileTab === 'statutory') return (
      <div>
        <Section title="Statutory Applicability" icon="⚖️">
          <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
            <StatChip label="PF / EPF" value={emp.pf_applicable} />
            <StatChip label="ESIC" value={emp.esic_applicable} />
            <StatChip label="Prof. Tax" value={emp.pt_applicable} />
            <StatChip label="LWF" value={emp.lwf_applicable} />
          </div>
          <Grid2>
            {F('UAN Number','uan_number')}
            {F('PAN Number','pan_number')}
            <div style={{padding:'8px 0',borderBottom:`1px solid ${P.border}`}}>
              <div style={{fontSize:'10px',color:P.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'4px',fontWeight:500}}>Aadhaar</div>
              <div style={{fontSize:'13px',fontFamily:'monospace',color:P.text}}>XXXX-XXXX-{emp.aadhar_last4||'—'}</div>
            </div>
          </Grid2>
        </Section>
      </div>
    )

    if (profileTab === 'bank') return (
      <Section title="Salary Account" icon="🏦">
        <div style={{ background:P.greenBg, border:`1px solid #BBF7D0`, borderRadius:'10px', padding:'16px', marginBottom:'12px' }}>
          <div style={{ fontSize:'12px', fontWeight:600, color:C.positive, marginBottom:'12px' }}>Primary Account</div>
          <Grid2>
            {[
              ['Bank Name', emp.bank_name],
              ['Account Type', emp.account_type],
              ['Account No.', emp.bank_account_last4 ? `XXXX XXXX XXXX ${emp.bank_account_last4}` : '—'],
              ['IFSC Code', emp.ifsc_code],
            ].map(([l,v]) => (
              <div key={l} style={{padding:'6px 0',borderBottom:`1px solid #DCFCE7`}}>
                <div style={{fontSize:'10px',color:C.positive,marginBottom:'3px',fontWeight:500,textTransform:'uppercase',letterSpacing:'.4px'}}>{l}</div>
                <div style={{fontSize:'13px',color:P.text,fontFamily:l==='Account No.'||l==='IFSC Code'?'monospace':'inherit'}}>{v||'—'}</div>
              </div>
            ))}
          </Grid2>
        </div>
      </Section>
    )

    // These tabs delegate to HRActionPanel (existing logic preserved)
    if (['documents','salary','onboarding','actions','history'].includes(profileTab)) {
      return <HRActionPanel employee={emp} activeTab={profileTab} onRefresh={fetchEmployees} />
    }

    return null
  }

  // ─── JSX ──────────────────────────────────────────────────────
  return (
    <div style={s.page}>

      <div style={s.body}>
        <PageHeader
          title="Employee Master"
          context={loading
            ? 'Loading…'
            : `${stats.total.toLocaleString('en-IN')} on record · ${stats.active.toLocaleString('en-IN')} active · showing ${employees.length.toLocaleString('en-IN')}`}
          actions={<>
            <Button icon={<IconDownload size={15} />} disabled={exporting} onClick={exportExcel}>
              {exporting ? 'Exporting…' : 'Export Excel'}
            </Button>
            <Button icon={<IconUpload size={15} />} onClick={() => setShowBulk(true)}>Bulk Upload</Button>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setShowAdd(true)}>Add Employee</Button>
          </>}
        />

        {/* These were eight equal stat cards. They are not statistics — they
            are filters, and exactly one is active at a time. A segmented bar
            says that; eight identical cards did not. */}
        <div className="ez-scroll" style={{
          display:'flex', gap:6, marginBottom:S.lg, overflowX:'auto', paddingBottom:2,
        }}>
          {[
            { label:'Total',      n:stats.total,      on:!filterStatus && !filterType,               go:()=>{setFType('');setFStatus('')} },
            { label:'Active',     n:stats.active,     on:filterStatus==='Active' && !filterType,     go:()=>{setFType('');setFStatus('Active')} },
            { label:'Resigned',   n:stats.resigned,   on:filterStatus==='Resigned' && !filterType,   go:()=>{setFType('');setFStatus('Resigned')} },
            { label:'Employee',   n:stats.employee,   on:filterType==='Employee',   go:()=>setFType('Employee') },
            { label:'Intern',     n:stats.intern,     on:filterType==='Intern',     go:()=>setFType('Intern') },
            { label:'NAPS',       n:stats.naps,       on:filterType==='NAPS',       go:()=>setFType('NAPS') },
            { label:'Consultant', n:stats.consultant, on:filterType==='Consultant', go:()=>setFType('Consultant') },
            { label:'Contract',   n:stats.contract,   on:filterType==='Contract',   go:()=>setFType('Contract') },
          ].map(f => (
            <button key={f.label} onClick={f.go} className="ez-press" style={{
              display:'inline-flex', alignItems:'center', gap:7, flexShrink:0,
              height:34, padding:'0 13px', borderRadius:R.pill, cursor:'pointer',
              fontFamily:'inherit', fontSize:F.small, fontWeight:f.on ? W.semi : W.medium,
              background: f.on ? C.brand : C.surface,
              color: f.on ? C.surface : C.muted,
              border:`1px solid ${f.on ? C.brandDeep : C.line}`,
              boxShadow: f.on ? E.brand : E.flat,
            }}>
              {f.label}
              <span style={{
                fontSize:F.micro, fontWeight:W.bold, padding:'1px 6px', borderRadius:R.pill,
                // A 22% white wash left the digits at 3.49:1 on the active
                // pill. A solid deeper fill of the brand carries them.
                background: f.on ? C.brandDeep : C.sunken,
                color: f.on ? C.surface : C.faint, ...numeric,
              }}>{loading ? '—' : f.n}</span>
            </button>
          ))}
        </div>

        {/* Filters — sticky so they stay visible while the list scrolls */}
        {/* Sticky to the top of the viewport now — the old offset was clearing
            a topbar that the page header replaced. */}
        <div style={{ ...s.card, display:'flex', gap:S.sm, alignItems:'center', flexWrap:'wrap',
                      padding:`${S.md}px ${S.lg}px`, position:'sticky', top:0, zIndex:30,
                      boxShadow:E.raised }}>
          <div style={{ position:'relative', flex:1, minWidth:220 }}>
            <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:C.faint, display:'flex', pointerEvents:'none' }}>
              <IconSearch size={14} />
            </span>
            <input style={{ ...s.inp, paddingLeft:30 }} placeholder="Name, code, designation, mobile…"
                   value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <select style={{ ...s.sel, width:'auto', minWidth:'140px' }} value={filterCompany} onChange={e=>{setFCo(e.target.value);setFLoc('');setFDept('')}}>
            <option value="">All Companies</option>
            {companies.map(c=><option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
          </select>
          <select style={{ ...s.sel, width:'auto', minWidth:'130px' }} value={filterLocation} onChange={e=>setFLoc(e.target.value)}>
            <option value="">All Locations</option>
            {filteredLocs.map(l=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select style={{ ...s.sel, width:'auto', minWidth:'130px' }} value={filterDept} onChange={e=>setFDept(e.target.value)}>
            <option value="">All Depts</option>
            {filteredDepts.map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select style={{ ...s.sel, width:'auto' }} value={filterType} onChange={e=>setFType(e.target.value)}>
            <option value="">All Types</option>
            {['Employee','Intern','NAPS','NATS','Consultant','Contract'].map(t=><option key={t}>{t}</option>)}
          </select>
          <select style={{ ...s.sel, width:'auto' }} value={filterStatus} onChange={e=>setFStatus(e.target.value)}>
            <option value="">All Status</option>
            {['Active','Resigned','Terminated','Absconding'].map(t=><option key={t}>{t}</option>)}
          </select>
          <select style={{ ...s.sel, width:'auto' }} value={filterGrade} onChange={e=>setFGrade(e.target.value)}>
            <option value="">All Grades</option>
            {['L1','L2','M1','M2','M3','E1','E2','E3','W1','W2'].map(g=><option key={g}>{g}</option>)}
          </select>
          <button style={s.secBtn} onClick={()=>{ setSearch(''); setFCo(''); setFLoc(''); setFDept(''); setFType(''); setFStatus('Active'); setFGrade('') }}>
            <IconClose size={13} /> Clear
          </button>
        </div>

        {error && (
          <div style={{
            background:tone('critical').bg, border:`1px solid ${tone('critical').edge}`,
            borderRadius:R.md, padding:`${S.md}px ${S.lg}px`, color:C.inkSoft,
            fontSize:F.small, marginBottom:S.md,
          }}>
            <strong style={{ color:C.critical }}>Could not load employees. </strong>{error}
          </div>
        )}

        {/* Table */}
        <div style={s.card}>
          <div className="ez-scroll" style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:F.small }}>
              <thead>
                <tr>
                  {/* Widths are sized for the app's 130% auto-zoom, which is
                      what the layout actually gets — at that zoom the content
                      column is ~900px, not the ~1200 the viewport suggests. */}
                  <Th width={78}>Emp Code</Th>
                  <Th>Employee</Th>
                  <Th width={70}>Type</Th>
                  <Th width={108}>Location</Th>
                  <Th width={50}>Grade</Th>
                  <Th width={74}>Status</Th>
                  <Th width={68}>Joined</Th>
                  <Th width={84}>Mobile</Th>
                  {/* Pinned. Nine columns at the app's 130% zoom will not fit
                      a laptop, so the table scrolls — but the one action on a
                      row must not be the thing that scrolls out of reach. */}
                  <Th width={54} align="right" style={{
                    position:'sticky', right:0, zIndex:2, background:C.sunken,
                    boxShadow:`inset 1px 0 0 ${C.line}`,
                  }} />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} style={{ padding:0 }}><SkeletonRows rows={8} /></td></tr>
                )}
                {!loading && employees.length === 0 && (
                  <tr><td colSpan={9}>
                    <Empty
                      icon={<IconEmployees size={20} />}
                      title="No employees match these filters"
                      hint="Try clearing the search or widening the company, location and status filters."
                      action={<Button size="sm" onClick={()=>{ setSearch(''); setFCo(''); setFLoc(''); setFDept(''); setFType(''); setFStatus(''); setFGrade('') }}>Clear all filters</Button>}
                    />
                  </td></tr>
                )}
                {employees.map(emp => {
                  const gc = GRADE_COLORS[emp.grade] || { bg:C.sunken, color:C.muted }
                  const sc = STATUS_COLORS[emp.employment_status] || { bg:C.sunken, color:C.muted }
                  return (
                    <Tr key={emp.id} onClick={()=>openProfile(emp)}>
                      <Td mono strong style={{ color:C.brandDeep, fontSize:F.tiny, letterSpacing:'.02em' }}>
                        {emp.emp_code}
                      </Td>
                      <Td>
                        {/* Avatar + name + designation. The face makes a long
                            list scannable in a way a column of text does not. */}
                        <Person name={emp.full_name} meta={emp.designation || '—'} />
                      </Td>
                      <Td><Badge val={emp.employment_type} map={TYPE_COLORS} /></Td>
                      <Td style={{ maxWidth:108 }}>
                        <div title={(emp as any).locations?.location_name || ''} style={{
                          color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        }}>{(emp as any).locations?.location_name || '—'}</div>
                        <div style={{ fontSize:F.micro, color:C.faint }}>{(emp as any).companies?.company_code || '—'}</div>
                      </Td>
                      <Td>
                        <span style={{
                          padding:'2px 9px', borderRadius:R.pill, fontSize:F.tiny,
                          fontWeight:W.semi, whiteSpace:'nowrap', ...gc,
                        }}>{emp.grade || '—'}</span>
                      </Td>
                      <Td>
                        <span style={{
                          padding:'2px 9px', borderRadius:R.pill, fontSize:F.tiny,
                          fontWeight:W.semi, whiteSpace:'nowrap', ...sc,
                        }}>{emp.employment_status}</span>
                        {emp.employment_status==='Resigned' && emp.last_working_date && (
                          <div style={{ fontSize:F.micro, color:C.critical, marginTop:3, ...numeric }}>
                            LWD {fmtDate(emp.last_working_date)}
                          </div>
                        )}
                      </Td>
                      <Td mono style={{ color:C.muted, fontSize:F.tiny, whiteSpace:'nowrap' }}>{fmtDate(emp.company_doj)}</Td>
                      <Td mono style={{ fontSize:F.tiny, whiteSpace:'nowrap' }}>{emp.mobile||'—'}</Td>
                      <Td align="right" style={{
                        whiteSpace:'nowrap', position:'sticky', right:0,
                        background:C.surface, boxShadow:`inset 1px 0 0 ${C.line}`,
                      }}>
                        <span onClick={e=>e.stopPropagation()}>
                          <Button size="sm" onClick={()=>openEdit(emp)}>Edit</Button>
                        </span>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'6px', padding:'12px', borderTop:`1px solid ${P.border}` }}>
              <button style={{ ...s.secBtn, padding:'6px 12px', opacity:page===1?.4:1 }} onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>Prev</button>
              {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                const p = page<=4 ? i+1 : page-3+i
                if(p<1||p>totalPages) return null
                return <button key={p} onClick={()=>setPage(p)} style={{ width:'32px',height:'32px',border:`1.5px solid ${p===page?P.purple:P.border}`,borderRadius:'6px',cursor:'pointer',fontSize:'12px',fontWeight:p===page?600:400,background:p===page?P.purple: C.surface,color:p===page?C.surface:P.text }}>{p}</button>
              })}
              <button style={{ ...s.secBtn, padding:'6px 12px', opacity:page===totalPages?.4:1 }} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next →</button>
            </div>
          )}
        </div>
      </div>

      {/* ── PROFILE DRAWER — full screen, same page ── */}
      {showDrawer && selected && (
        <div style={{ position:'fixed', inset:0, background:P.page, zIndex:200, display:'flex', flexDirection:'column', overflowY:'auto', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ flex:1, width:'100%', maxWidth:'1060px', margin:'0 auto', display:'flex', flexDirection:'column' }}>

            {/* Nav breadcrumb */}
            <div style={{ padding:'10px 20px', display:'flex', alignItems:'center', gap:'8px', fontSize:'12px', color:P.muted }}>
              <button onClick={closeDrawer} style={{ ...s.secBtn, padding:'5px 10px', fontSize:'11px' }}>Employee list</button>
              <span>›</span>
              <span style={{ color:P.text, fontWeight:500 }}>{selected.full_name}</span>
              {editMode && <span style={{ padding:'2px 8px', background:P.amberBg, color:P.amber, borderRadius:'6px', fontSize:'10px', fontWeight:500 }}>Editing</span>}
            </div>

            {/* Profile header (with edit/save/cancel) */}
            <div style={{ margin:'0 20px', borderRadius:'14px', overflow:'hidden', border:`1px solid ${P.border}`, marginBottom:'14px' }}>
              <ProfileHeader emp={selected} editMode={editMode} saving={saving} onEdit={() => openEdit()} onSave={saveEdit} onCancel={cancelEdit} />

              {/* Tab bar */}
              <TabBar tabs={TABS} active={profileTab} onChange={setProfileTab} />

              {/* Tab content */}
              <div style={{ background:P.card, minHeight:'320px' }}>
                {renderTab(selected)}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Modals + toast ── */}
      {showAdd && <AddEmployeeModal companies={companies} locations={locations} departments={departments} onClose={() => setShowAdd(false)} onSaved={(msg) => { setShowAdd(false); setAddMsg(msg); fetchEmployees(); fetchStats(); setTimeout(() => setAddMsg(''), 3500) }} />}
      {showBulk && <BulkUploadModal companies={companies} departments={departments} locations={locations} onClose={() => setShowBulk(false)} onDone={(r) => { setAddMsg(`Bulk: ${r.added} added, ${r.skipped} skipped, ${r.errors} errors`); fetchEmployees(); fetchStats(); setTimeout(() => setAddMsg(''), 4000) }} />}
      {addMsg && <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:C.positive, color:C.onAccent, borderRadius:'10px', padding:'12px 18px', fontSize:'13px', fontWeight:600, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>✓ {addMsg}</div>}
    </div>
  )
}
