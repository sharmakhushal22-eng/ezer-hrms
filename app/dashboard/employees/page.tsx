'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import HRActionPanel from '@/components/employees/HRActionPanel'
import { buildEmpCode, TYPE_SUFFIX } from '@/lib/employee-code'
import BulkUploadModal from '@/components/employees/BulkUploadModal'
import * as XLSX from 'xlsx'

// ── Add Employee modal (defined OUTSIDE parent — no focus-loss) ─────
const EMP_TYPES = ['Employee', 'Intern', 'NAPS', 'NATS', 'Consultant', 'Contract']
const mc = {
  inp:   { width:'100%', padding:'8px 10px', background:'#F8FAFC', border:'1px solid #CBD5E1', borderRadius:'7px', fontSize:'13px', color:'#0F172A', outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  lbl:   { fontSize:'10px', fontWeight:600 as const, color:'#64748B', textTransform:'uppercase' as const, letterSpacing:'.04em', display:'block', marginBottom:'3px' },
  pri:   { padding:'9px 16px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:600 as const, cursor:'pointer', fontFamily:'inherit' },
  out:   { padding:'9px 14px', background:'#fff', color:'#475569', border:'1px solid #CBD5E1', borderRadius:'8px', fontSize:'13px', cursor:'pointer', fontFamily:'inherit' },
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
      // uniqueness
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
      <div style={{ background:'#fff', borderRadius:'12px', padding:'20px', maxWidth:'620px', width:'100%', maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:'16px', fontWeight:600, marginBottom:'14px', color:'#0F172A' }}>Add Employee</div>
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
        {err && <div style={{ background:'#FEF2F2', color:'#B91C1C', fontSize:'12px', padding:'8px 12px', borderRadius:'7px', marginBottom:'12px' }}>{err}</div>}
        <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
          <button style={mc.out} onClick={onClose}>Cancel</button>
          <button style={{ ...mc.pri, opacity: ready && !busy ? 1 : 0.5 }} disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Add employee'}</button>
        </div>
      </div>
    </div>
  )
}

interface Employee {
  id: string
  emp_code: string
  common_code: string
  employment_type: string
  full_name: string
  first_name: string
  last_name: string
  gender: string
  date_of_birth: string
  blood_group: string
  marital_status: string
  employment_status: string
  collar_type: string
  employee_function: string
  employee_category: string
  designation: string
  grade: string
  group_doj: string
  company_doj: string
  confirmation_status: string
  mobile: string
  personal_email: string
  office_email: string
  pan_number: string
  aadhar_last4: string
  uan_number: string
  pf_applicable: boolean
  esic_applicable: boolean
  pt_applicable: boolean
  lwf_applicable: boolean
  bank_name: string
  bank_account_last4: string
  ifsc_code: string
  account_type: string
  l1_manager_id: string | null
  l2_manager_id: string | null
  hr_manager_id: string | null
  notice_period_days: number
  date_of_resignation: string | null
  last_working_date: string | null
  blacklisted: boolean
  rehire_eligible: boolean
  company_id: string
  location_id: string
  department_id: string
  companies?: { company_name: string; company_code: string }
  locations?: { location_name: string; city: string }
  departments?: { dept_name: string }
}

const C = {
  page:   { display:'flex' as const, flexDirection:'column' as const, minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  topbar: { background:'#fff', padding:'11px 20px', borderBottom:'1px solid #E2E8F0', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const, position:'sticky' as const, top:0, zIndex:40 },
  body:   { flex:1, padding:'16px 20px' },
  card:   { background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:'12px' },
  inp:    { padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', color:'#0F172A' } as React.CSSProperties,
  sel:    { padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', outline:'none', background:'#F8FAFC', color:'#0F172A', cursor:'pointer' } as React.CSSProperties,
  priBtn: { padding:'9px 18px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'8px 14px', background:'#fff', color:'#374151', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' },
}

const GRADE_COLORS: Record<string,{bg:string;color:string}> = {
  L2:{bg:'#EDE9FE',color:'#7C3AED'}, L1:{bg:'#DDD6FE',color:'#6D28D9'},
  M3:{bg:'#DBEAFE',color:'#1D4ED8'}, M2:{bg:'#E0F2FE',color:'#0369A1'},
  M1:{bg:'#CCFBF1',color:'#0D9488'}, E3:{bg:'#DCFCE7',color:'#16A34A'},
  E2:{bg:'#ECFCCB',color:'#65A30D'}, E1:{bg:'#FEF3C7',color:'#D97706'},
  W2:{bg:'#FEE2E2',color:'#DC2626'}, W1:{bg:'#FFE4E6',color:'#BE123C'},
}
const TYPE_COLORS: Record<string,{bg:string;color:string}> = {
  Employee:{bg:'#EDE9FE',color:'#7C3AED'}, Intern:{bg:'#DBEAFE',color:'#1D4ED8'},
  NAPS:{bg:'#DCFCE7',color:'#16A34A'},     NATS:{bg:'#FEF3C7',color:'#D97706'},
  Consultant:{bg:'#FEE2E2',color:'#DC2626'}, Contract:{bg:'#F1F5F9',color:'#374151'},
}
const STATUS_COLORS: Record<string,{bg:string;color:string}> = {
  Active:{bg:'#DCFCE7',color:'#16A34A'},   Resigned:{bg:'#FEE2E2',color:'#DC2626'},
  Terminated:{bg:'#FEE2E2',color:'#991B1B'}, Absconding:{bg:'#FEF3C7',color:'#D97706'},
}

export default function EmployeeMaster() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [departments, setDepts]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [showAdd, setShowAdd]     = useState(false)
  const [showBulk, setShowBulk]   = useState(false)
  const [addMsg, setAddMsg]       = useState('')
  const [error, setError]         = useState('')
  const [total, setTotal]         = useState(0)
  const [search, setSearch]       = useState('')
  const [filterCompany, setFCo]   = useState('')
  const [filterLocation, setFLoc] = useState('')
  const [filterDept, setFDept]    = useState('')
  const [filterType, setFType]    = useState('')
  const [filterStatus, setFStatus]= useState('Active')
  const [filterGrade, setFGrade]  = useState('')
  const [exporting, setExporting] = useState(false)
  const [page, setPage]           = useState(1)
  const [selected, setSelected]   = useState<Employee|null>(null)
  const [profileTab, setProfileTab] = useState('personal')
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [stats, setStats] = useState({
    total:0, active:0, resigned:0,
    employee:0, intern:0, naps:0, nats:0, consultant:0, contract:0
  })
  const PER_PAGE = 20

  const fetchStats = useCallback(async () => {
    let q = supabase.from('employees').select('employment_status, employment_type').neq('is_test', true)
    if (filterCompany)  q = q.eq('company_id', filterCompany)
    if (filterLocation) q = q.eq('location_id', filterLocation)
    if (filterDept)     q = q.eq('department_id', filterDept)
    const { data } = await q
    if (!data) return
    setStats({
      total:      data.length,
      active:     data.filter(e => e.employment_status === 'Active').length,
      resigned:   data.filter(e => e.employment_status === 'Resigned').length,
      employee:   data.filter(e => e.employment_type === 'Employee').length,
      intern:     data.filter(e => e.employment_type === 'Intern').length,
      naps:       data.filter(e => e.employment_type === 'NAPS').length,
      nats:       data.filter(e => e.employment_type === 'NATS').length,
      consultant: data.filter(e => e.employment_type === 'Consultant').length,
      contract:   data.filter(e => e.employment_type === 'Contract').length,
    })
  }, [filterCompany, filterLocation, filterDept])

  const fetchMeta = async () => {
    const [co, lo, de] = await Promise.all([
      supabase.from('companies').select('id,company_name,company_code').eq('status','Active'),
      supabase.from('locations').select('id,location_name,city,company_id').eq('status','Active'),
      supabase.from('departments').select('id,dept_name,company_id').eq('status','Active'),
    ])
    setCompanies(co.data || [])
    setLocations(lo.data || [])
    setDepts(de.data || [])
  }

  const fetchEmployees = useCallback(async () => {
    setLoading(true); setError('')
    try {
      let q = supabase.from('employees').select(`
        id, emp_code, common_code, employment_type, full_name, first_name, last_name,
        gender, date_of_birth, blood_group, marital_status, employment_status,
        collar_type, employee_function, employee_category, designation, grade,
        group_doj, company_doj, confirmation_status, notice_period_days,
        mobile, personal_email, office_email,
        pan_number, aadhar_last4, uan_number,
        pf_applicable, esic_applicable, pt_applicable, lwf_applicable,
        bank_name, bank_account_last4, ifsc_code, account_type,
        l1_manager_id, l2_manager_id, hr_manager_id,
        date_of_resignation, last_working_date,
        blacklisted, rehire_eligible,
        company_id, location_id, department_id,
        companies(company_name, company_code),
        locations!location_id(location_name, city),
        departments(dept_name)
      `, { count: 'exact' }).neq('is_test', true).order('emp_code')

      if (filterCompany)  q = q.eq('company_id', filterCompany)
      if (filterLocation) q = q.eq('location_id', filterLocation)
      if (filterDept)     q = q.eq('department_id', filterDept)
      if (filterType)     q = q.eq('employment_type', filterType)
      if (filterStatus)   q = q.eq('employment_status', filterStatus)
      if (filterGrade)    q = q.eq('grade', filterGrade)
      if (search.trim())  q = q.or(`full_name.ilike.%${search}%,emp_code.ilike.%${search}%,common_code.ilike.%${search}%,designation.ilike.%${search}%,mobile.ilike.%${search}%`)

      const from = (page - 1) * PER_PAGE
      q = q.range(from, from + PER_PAGE - 1)

      const { data, error: err, count } = await q
      if (err) throw err
      setEmployees((data as any[]) || [])
      setTotal(count || 0)
    } catch (e: any) {
      setError(e.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [search, filterCompany, filterLocation, filterDept, filterType, filterStatus, filterGrade, page])

  // Export ALL employees matching the current filters (no pagination) to Excel.
  const exportExcel = async () => {
    setExporting(true)
    try {
      let q = supabase.from('employees').select(`
        emp_code, common_code, full_name, first_name, last_name, gender, date_of_birth, blood_group, marital_status,
        employment_type, employment_status, designation, grade, confirmation_status, collar_type, employee_function, employee_category,
        company_doj, group_doj, notice_period_days, mobile, personal_email, office_email,
        pan_number, aadhar_last4, uan_number, pf_applicable, esic_applicable, pt_applicable, lwf_applicable,
        bank_name, bank_account_last4, ifsc_code, account_type,
        date_of_resignation, last_working_date, blacklisted, rehire_eligible,
        companies(company_name), departments(dept_name), locations!location_id(location_name, city)
      `).neq('is_test', true).order('emp_code')
      if (filterCompany)  q = q.eq('company_id', filterCompany)
      if (filterLocation) q = q.eq('location_id', filterLocation)
      if (filterDept)     q = q.eq('department_id', filterDept)
      if (filterType)     q = q.eq('employment_type', filterType)
      if (filterStatus)   q = q.eq('employment_status', filterStatus)
      if (filterGrade)    q = q.eq('grade', filterGrade)
      if (search.trim())  q = q.or(`full_name.ilike.%${search}%,emp_code.ilike.%${search}%,common_code.ilike.%${search}%,designation.ilike.%${search}%,mobile.ilike.%${search}%`)
      const { data, error: err } = await q
      if (err) throw err
      const rows = (data as any[] || []).map(e => ({
        'Employee Code': e.emp_code, 'Full Name': e.full_name, 'First Name': e.first_name, 'Last Name': e.last_name,
        'Company': e.companies?.company_name || '', 'Department': e.departments?.dept_name || '',
        'Location': e.locations?.location_name || '', 'City': e.locations?.city || '',
        'Designation': e.designation || '', 'Grade': e.grade || '', 'Employment Type': e.employment_type || '',
        'Status': e.employment_status || '', 'Confirmation': e.confirmation_status || '',
        'Collar Type': e.collar_type || '', 'Function': e.employee_function || '', 'Category': e.employee_category || '',
        'Date of Joining': e.company_doj || '', 'Group DOJ': e.group_doj || '', 'Notice Period (days)': e.notice_period_days ?? '',
        'Gender': e.gender || '', 'Date of Birth': e.date_of_birth || '', 'Blood Group': e.blood_group || '', 'Marital Status': e.marital_status || '',
        'Mobile': e.mobile || '', 'Personal Email': e.personal_email || '', 'Office Email': e.office_email || '',
        'PAN': e.pan_number || '', 'Aadhaar (last4)': e.aadhar_last4 || '', 'UAN': e.uan_number || '',
        'PF': e.pf_applicable ? 'Yes' : 'No', 'ESIC': e.esic_applicable ? 'Yes' : 'No', 'PT': e.pt_applicable ? 'Yes' : 'No', 'LWF': e.lwf_applicable ? 'Yes' : 'No',
        'Bank': e.bank_name || '', 'Account (last4)': e.bank_account_last4 || '', 'IFSC': e.ifsc_code || '', 'Account Type': e.account_type || '',
        'Resignation Date': e.date_of_resignation || '', 'Last Working Day': e.last_working_date || '',
        'Blacklisted': e.blacklisted ? 'Yes' : 'No', 'Rehire Eligible': e.rehire_eligible === false ? 'No' : 'Yes',
      }))
      if (!rows.length) { alert('No employees to export for the current filters.'); setExporting(false); return }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Employees')
      XLSX.writeFile(wb, `EZER_Employees_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e: any) {
      alert('Export failed: ' + (e?.message || 'unknown error'))
    }
    setExporting(false)
  }

  useEffect(() => { fetchMeta() }, [])
  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { setPage(1) }, [search, filterCompany, filterLocation, filterDept, filterType, filterStatus, filterGrade])
  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  const filteredLocs  = filterCompany ? locations.filter(l => l.company_id === filterCompany) : locations
  const filteredDepts = filterCompany ? departments.filter(d => d.company_id === filterCompany) : departments
  const totalPages    = Math.ceil(total / PER_PAGE)
  const initials      = (name: string) => name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'NA'
  const openProfile   = (emp: Employee) => { setSelected(emp); setProfileTab('personal'); setEditing(false); setShowDrawer(true) }

  const EDIT_FIELDS = ['full_name','first_name','last_name','gender','date_of_birth','blood_group','marital_status','designation','grade','employment_type','employment_status','mobile','personal_email','office_email','notice_period_days']
  const openEdit = () => { if (!selected) return; const f: any = {}; for (const k of EDIT_FIELDS) f[k] = (selected as any)[k] ?? ''; setEditForm(f); setEditing(true) }
  const editDirty = () => selected ? EDIT_FIELDS.some(k => String(editForm[k] ?? '') !== String((selected as any)[k] ?? '')) : false
  const cancelEdit = () => { if (editDirty() && !window.confirm('You are exiting without saving. Discard changes?')) return; setEditing(false) }
  const saveEdit = async () => {
    if (!selected) return
    setSavingEdit(true)
    const patch: any = { ...editForm }
    if (patch.notice_period_days !== '' && patch.notice_period_days != null) patch.notice_period_days = Number(patch.notice_period_days) || 0
    const { error } = await supabase.from('employees').update(patch).eq('id', selected.id)
    setSavingEdit(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setSelected({ ...(selected as any), ...patch }); setEditing(false); fetchEmployees()
  }
  const handleBack = () => { if (editing) { cancelEdit(); return } setShowDrawer(false) }

  return (
    <div style={C.page}>
      {/* Topbar */}
      <div style={C.topbar}>
        <div style={{ fontSize:'12px', color:'#64748B' }}>
          Sharma Group &nbsp;›&nbsp;
          <span style={{ color:'#7C3AED', fontWeight:500 }}>Employee Master</span>
          <span style={{ marginLeft:'8px', padding:'2px 8px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'10px', fontSize:'11px' }}>
            {stats.total} Total
          </span>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button style={{ ...C.secBtn, opacity: exporting ? 0.6 : 1 }} disabled={exporting} onClick={exportExcel}>📥 {exporting ? 'Exporting…' : 'Export Excel'}</button>
          <button style={C.secBtn} onClick={() => setShowBulk(true)}>⬆ Bulk Upload</button>
          <button style={C.priBtn} onClick={() => setShowAdd(true)}>+ Add Employee</button>
        </div>
      </div>

      <div style={C.body}>
        {/* Stats Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:'8px', marginBottom:'14px' }}>
          {[
            { label:'Total',      value:stats.total,      color:'#1E1B4B', onClick:()=>{ setFType(''); setFStatus('') } },
            { label:'Active',     value:stats.active,     color:'#16A34A', onClick:()=>{ setFType(''); setFStatus('Active') } },
            { label:'Resigned',   value:stats.resigned,   color:'#DC2626', onClick:()=>{ setFType(''); setFStatus('Resigned') } },
            { label:'Employee',   value:stats.employee,   color:'#7C3AED', onClick:()=>setFType('Employee') },
            { label:'Intern',     value:stats.intern,     color:'#1D4ED8', onClick:()=>setFType('Intern') },
            { label:'NAPS',       value:stats.naps,       color:'#0D9488', onClick:()=>setFType('NAPS') },
            { label:'Consultant', value:stats.consultant, color:'#D97706', onClick:()=>setFType('Consultant') },
            { label:'Contract',   value:stats.contract,   color:'#374151', onClick:()=>setFType('Contract') },
          ].map(s => (
            <div key={s.label} onClick={s.onClick} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:'8px', padding:'10px 8px', textAlign:'center' as const, cursor:'pointer', borderTop:`3px solid ${s.color}` }}>
              <div style={{ fontSize:'20px', fontWeight:700, color:s.color }}>{loading ? '—' : s.value}</div>
              <div style={{ fontSize:'10px', color:'#64748B', marginTop:'2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ ...C.card, display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' as const, padding:'12px 14px' }}>
          <input
            style={{ ...C.inp, flex:1, minWidth:'200px' }}
            placeholder="🔍  Name, Code, Designation, Mobile..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={C.sel} value={filterCompany} onChange={e => { setFCo(e.target.value); setFLoc(''); setFDept('') }}>
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
          </select>
          <select style={C.sel} value={filterLocation} onChange={e => setFLoc(e.target.value)} disabled={!filterCompany}>
            <option value="">All Locations</option>
            {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select style={C.sel} value={filterDept} onChange={e => setFDept(e.target.value)} disabled={!filterCompany}>
            <option value="">All Depts</option>
            {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select style={C.sel} value={filterType} onChange={e => setFType(e.target.value)}>
            <option value="">All Types</option>
            {['Employee','Intern','NAPS','NATS','Consultant','Contract'].map(t => <option key={t}>{t}</option>)}
          </select>
          <select style={C.sel} value={filterStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">All Status</option>
            {['Active','Resigned','Terminated','Absconding'].map(s => <option key={s}>{s}</option>)}
          </select>
          <select style={C.sel} value={filterGrade} onChange={e => setFGrade(e.target.value)}>
            <option value="">All Grades</option>
            {['L2','L1','M3','M2','M1','E3','E2','E1','W2','W1'].map(g => <option key={g}>{g}</option>)}
          </select>
          {(search || filterCompany || filterLocation || filterDept || filterType || filterStatus || filterGrade) && (
            <button style={C.secBtn} onClick={() => { setSearch(''); setFCo(''); setFLoc(''); setFDept(''); setFType(''); setFStatus('Active'); setFGrade('') }}>✕ Clear</button>
          )}
        </div>

        {error && (
          <div style={{ padding:'10px 14px', background:'#FEE2E2', borderRadius:'8px', fontSize:'12px', color:'#DC2626', marginBottom:'12px' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Table */}
        <div style={{ background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid #F1F5F9' }}>
            <div style={{ fontSize:'13px', fontWeight:600, color:'#0F172A' }}>
              {loading ? 'Loading...' : `${total} employees found`}
              {filterStatus && <span style={{ marginLeft:'8px', fontSize:'11px', color:'#64748B' }}>· {filterStatus}</span>}
            </div>
            <div style={{ fontSize:'11px', color:'#94A3B8' }}>Page {page} of {totalPages || 1}</div>
          </div>

          {loading ? (
            <div style={{ padding:'40px', textAlign:'center' as const, color:'#94A3B8' }}>⏳ Loading employees...</div>
          ) : employees.length === 0 ? (
            <div style={{ padding:'40px', textAlign:'center' as const, color:'#94A3B8' }}>
              <div style={{ fontSize:'28px', marginBottom:'8px' }}>👥</div>
              <div>No employees found — try changing the filters</div>
            </div>
          ) : (
            <div style={{ overflowX:'auto' as const }}>
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#1E1B4B' }}>
                    {['Emp Code','Name','Type','Designation','Department','Location / Co.','Grade','Status','DOJ','Mobile','Action'].map(h => (
                      <th key={h} style={{ padding:'10px 12px', color:'#fff', fontWeight:600, textAlign:'left' as const, fontSize:'11px', whiteSpace:'nowrap' as const }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, i) => {
                    const gc = GRADE_COLORS[emp.grade] || { bg:'#F1F5F9', color:'#374151' }
                    const tc = TYPE_COLORS[emp.employment_type] || { bg:'#F1F5F9', color:'#374151' }
                    const sc = STATUS_COLORS[emp.employment_status] || { bg:'#F1F5F9', color:'#374151' }
                    return (
                      <tr key={emp.id} style={{ background:i%2===0?'#F8FAFC':'#fff', borderBottom:'1px solid #E2E8F0', cursor:'pointer' }} onClick={() => openProfile(emp)}>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ fontWeight:600, color:'#7C3AED', fontSize:'12px' }}>{emp.emp_code}</div>
                          <div style={{ fontSize:'10px', color:'#94A3B8' }}>{emp.common_code}</div>
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:emp.gender==='Female'?'#FCE7F3':'#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:700, color:emp.gender==='Female'?'#BE185D':'#7C3AED', flexShrink:0 }}>
                              {initials(emp.full_name)}
                            </div>
                            <div>
                              <div style={{ fontWeight:500, color:'#0F172A' }}>{emp.full_name}</div>
                              <div style={{ fontSize:'10px', color:'#94A3B8' }}>{emp.gender} · {emp.blood_group || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ padding:'2px 7px', borderRadius:'5px', fontSize:'10px', fontWeight:500, ...tc }}>{emp.employment_type}</span>
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ fontWeight:500 }}>{emp.designation}</div>
                          <div style={{ fontSize:'10px', color:'#94A3B8' }}>{emp.collar_type === 'BC' ? '🔵 Blue Collar' : '⚪ White Collar'}</div>
                        </td>
                        <td style={{ padding:'10px 12px', color:'#374151' }}>
                          {(emp as any).departments?.dept_name || '—'}
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ fontSize:'12px', color:'#374151' }}>{(emp as any).locations?.location_name || '—'}</div>
                          <div style={{ fontSize:'10px', color:'#94A3B8' }}>{(emp as any).companies?.company_code || '—'}</div>
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ padding:'2px 7px', borderRadius:'5px', fontSize:'11px', fontWeight:600, ...gc }}>{emp.grade}</span>
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:'5px', fontSize:'10px', fontWeight:500, ...sc }}>{emp.employment_status}</span>
                          {emp.employment_status === 'Resigned' && emp.last_working_date && (
                            <div style={{ fontSize:'9px', color:'#DC2626', marginTop:'2px' }}>LWD: {emp.last_working_date}</div>
                          )}
                        </td>
                        <td style={{ padding:'10px 12px', fontSize:'11px', color:'#64748B' }}>
                          <div>{emp.company_doj || '—'}</div>
                          {emp.group_doj !== emp.company_doj && (
                            <div style={{ fontSize:'9px', color:'#94A3B8' }}>Grp: {emp.group_doj}</div>
                          )}
                        </td>
                        <td style={{ padding:'10px 12px', fontSize:'11px', color:'#374151' }}>{emp.mobile || '—'}</td>
                        <td style={{ padding:'10px 12px' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display:'flex', gap:'4px' }}>
                            <button onClick={() => openProfile(emp)} style={{ padding:'4px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View</button>
                            <button style={{ padding:'4px 8px', background:'#F1F5F9', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#374151' }}>Edit</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display:'flex', justifyContent:'center', gap:'6px', padding:'12px', borderTop:'1px solid #F1F5F9' }}>
              <button style={{ ...C.secBtn, padding:'6px 12px', opacity:page===1?0.4:1 }} onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}>← Prev</button>
              {Array.from({ length:Math.min(totalPages, 7) }, (_, i) => {
                const p = page <= 4 ? i + 1 : page - 3 + i
                if (p < 1 || p > totalPages) return null
                return (
                  <button key={p} onClick={() => setPage(p)} style={{ width:'32px', height:'32px', border:'1.5px solid', borderRadius:'6px', cursor:'pointer', fontSize:'12px', fontWeight:p===page?600:400, background:p===page?'#7C3AED':'#fff', color:p===page?'#fff':'#374151', borderColor:p===page?'#7C3AED':'#E2E8F0' }}>{p}</button>
                )
              })}
              <button style={{ ...C.secBtn, padding:'6px 12px', opacity:page===totalPages?0.4:1 }} onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}>Next →</button>
            </div>
          )}
        </div>
      </div>

      {/* Profile Drawer */}
      {showDrawer && selected && (
        <div style={{ position:'fixed' as const, inset:0, background:'#F0F4F8', zIndex:200, display:'flex', flexDirection:'column' as const, overflowY:'auto' as const, fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column' as const, width:'100%', maxWidth:'1000px', margin:'0 auto' }}>

            {/* Header */}
            <div style={{ background:'#1E1B4B', padding:'16px 20px', display:'flex', gap:'12px', alignItems:'center', position:'sticky' as const, top:0, zIndex:10 }}>
              <button onClick={handleBack} style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)', color:'#fff', borderRadius:'7px', padding:'7px 12px', cursor:'pointer', fontSize:'12px', fontWeight:600, fontFamily:'inherit', flexShrink:0 }}>← Back to list</button>
              <div style={{ width:'48px', height:'48px', borderRadius:'50%', background:selected.gender==='Female'?'#FCE7F3':'#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', fontWeight:700, color:selected.gender==='Female'?'#BE185D':'#7C3AED', flexShrink:0 }}>
                {initials(selected.full_name)}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:'15px', fontWeight:600, color:'#fff' }}>{selected.full_name}</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.6)', marginTop:'2px' }}>{selected.emp_code} · {selected.designation}</div>
                <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                  <span style={{ padding:'1px 7px', borderRadius:'5px', fontSize:'10px', ...(TYPE_COLORS[selected.employment_type]||{bg:'#F1F5F9',color:'#374151'}) }}>{selected.employment_type}</span>
                  <span style={{ padding:'1px 7px', borderRadius:'5px', fontSize:'10px', ...(STATUS_COLORS[selected.employment_status]||{bg:'#F1F5F9',color:'#374151'}) }}>{selected.employment_status}</span>
                  <span style={{ padding:'1px 7px', borderRadius:'5px', fontSize:'10px', ...(GRADE_COLORS[selected.grade]||{bg:'#F1F5F9',color:'#374151'}) }}>{selected.grade}</span>
                </div>
              </div>
              <button onClick={handleBack} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:'20px', cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid #E2E8F0', background:'#F8FAFC' }}>
              {[
                { id:'personal',   label:'👤 Personal' },
                { id:'employment', label:'💼 Employment' },
                { id:'statutory',  label:'🏛️ Statutory' },
                { id:'bank',       label:'🏦 Bank' },
                { id:'documents',  label:'📄 Documents' },
                { id:'salary',     label:'💰 Salary' },
                { id:'onboarding', label:'📋 Onboarding' },
                { id:'actions',    label:'⚡ HR Actions' },
                { id:'history',    label:'📜 History' },
              ].map(t => (
                <button key={t.id} onClick={() => setProfileTab(t.id)} style={{ flex:1, padding:'10px 4px', border:'none', background:'transparent', cursor:'pointer', fontSize:'11px', fontWeight:profileTab===t.id?600:400, color:profileTab===t.id?'#7C3AED':'#64748B', borderBottom:profileTab===t.id?'2.5px solid #7C3AED':'2.5px solid transparent' }}>
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto' as const, padding:'16px 20px' }}>

              {profileTab === 'personal' && (
                <div>
                  {[
                    { label:'Full Name',      value:selected.full_name },
                    { label:'Common Code',    value:selected.common_code },
                    { label:'Gender',         value:selected.gender },
                    { label:'Date of Birth',  value:selected.date_of_birth || '—' },
                    { label:'Blood Group',    value:selected.blood_group || '—' },
                    { label:'Marital Status', value:selected.marital_status || '—' },
                    { label:'Mobile',         value:selected.mobile },
                    { label:'Personal Email', value:selected.personal_email || '—' },
                    { label:'Office Email',   value:selected.office_email || '—' },
                    { label:'Aadhaar Last 4', value:selected.aadhar_last4 ? `XXXX XXXX ${selected.aadhar_last4}` : '—' },
                    { label:'PAN',            value:selected.pan_number || '—' },
                  ].map((f, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F1F5F9', fontSize:'12px' }}>
                      <span style={{ color:'#64748B', flexShrink:0, width:'130px' }}>{f.label}</span>
                      <span style={{ fontWeight:500, color:'#0F172A', textAlign:'right' as const }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {profileTab === 'employment' && (
                <div>
                  {[
                    { label:'Emp Type',       value:selected.employment_type },
                    { label:'Department',     value:(selected as any).departments?.dept_name || '—' },
                    { label:'Designation',    value:selected.designation },
                    { label:'Grade',          value:selected.grade },
                    { label:'Collar',         value:selected.collar_type === 'BC' ? 'Blue Collar' : 'White Collar' },
                    { label:'Function',       value:selected.employee_function || '—' },
                    { label:'Category',       value:selected.employee_category || '—' },
                    { label:'Company',        value:(selected as any).companies?.company_name || '—' },
                    { label:'Location',       value:(selected as any).locations?.location_name || '—' },
                    { label:'Group DOJ',      value:selected.group_doj || '—' },
                    { label:'Company DOJ',    value:selected.company_doj || '—' },
                    { label:'Confirmation',   value:selected.confirmation_status || '—' },
                    { label:'Notice Period',  value:selected.notice_period_days ? `${selected.notice_period_days} days` : '—' },
                    ...(selected.employment_status === 'Resigned' ? [
                      { label:'Date of Resign',   value:selected.date_of_resignation || '—' },
                      { label:'Last Working Day', value:selected.last_working_date || '—' },
                    ] : []),
                    { label:'Rehire Eligible', value:selected.rehire_eligible ? '✅ Yes' : '❌ No' },
                    { label:'Blacklisted',     value:selected.blacklisted ? '🚫 Yes' : 'No' },
                  ].map((f, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F1F5F9', fontSize:'12px' }}>
                      <span style={{ color:'#64748B', flexShrink:0, width:'140px' }}>{f.label}</span>
                      <span style={{ fontWeight:500, color:'#0F172A', textAlign:'right' as const }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {profileTab === 'statutory' && (
                <div>
                  <div style={{ display:'flex', gap:'8px', marginBottom:'14px' }}>
                    {[
                      { label:'PF',   value:selected.pf_applicable },
                      { label:'ESIC', value:selected.esic_applicable },
                      { label:'PT',   value:selected.pt_applicable },
                      { label:'LWF',  value:selected.lwf_applicable },
                    ].map(s => (
                      <div key={s.label} style={{ flex:1, padding:'10px 6px', borderRadius:'8px', background:s.value?'#F0FDF4':'#F8FAFC', border:`1px solid ${s.value?'#BBF7D0':'#E2E8F0'}`, textAlign:'center' as const }}>
                        <div style={{ fontSize:'12px', fontWeight:600, color:'#374151' }}>{s.label}</div>
                        <div style={{ fontSize:'10px', color:s.value?'#16A34A':'#94A3B8', marginTop:'4px' }}>{s.value ? '✅ Yes' : '❌ No'}</div>
                      </div>
                    ))}
                  </div>
                  {[
                    { label:'UAN Number', value:selected.uan_number || '—' },
                    { label:'PAN Number', value:selected.pan_number || '—' },
                  ].map((f, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F1F5F9', fontSize:'12px' }}>
                      <span style={{ color:'#64748B' }}>{f.label}</span>
                      <span style={{ fontWeight:500, color:'#0F172A' }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {profileTab === 'bank' && (
                <div>
                  <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'10px', padding:'14px' }}>
                    <div style={{ fontSize:'13px', fontWeight:600, color:'#15803D', marginBottom:'10px' }}>🏦 Salary Account</div>
                    {[
                      { label:'Bank Name',    value:selected.bank_name || '—' },
                      { label:'Account No.',  value:selected.bank_account_last4 ? `XXXX XXXX ${selected.bank_account_last4}` : '—' },
                      { label:'IFSC Code',    value:selected.ifsc_code || '—' },
                      { label:'Account Type', value:selected.account_type || '—' },
                    ].map((f, i) => (
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #DCFCE7', fontSize:'12px' }}>
                        <span style={{ color:'#64748B' }}>{f.label}</span>
                        <span style={{ fontWeight:500, color:'#0F172A' }}>{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(profileTab === 'documents' || profileTab === 'salary' || profileTab === 'onboarding' || profileTab === 'actions' || profileTab === 'history') && (
                <HRActionPanel employee={selected} activeTab={profileTab} onRefresh={fetchEmployees} />
              )}
            </div>

            <div style={{ padding:'12px 20px', borderTop:'1px solid #E2E8F0', display:'flex', gap:'8px' }}>
              <button onClick={openEdit} style={{ ...C.priBtn, flex:1 }}>✏️ Edit Profile</button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen Edit Profile */}
      {editing && selected && (
        <div style={{ position:'fixed' as const, inset:0, background:'#F0F4F8', zIndex:210, display:'flex', flexDirection:'column' as const, overflowY:'auto' as const, fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ flex:1, width:'100%', maxWidth:'1000px', margin:'0 auto', display:'flex', flexDirection:'column' as const }}>
            <div style={{ background:'#1E1B4B', padding:'14px 20px', display:'flex', alignItems:'center', gap:'12px', position:'sticky' as const, top:0, zIndex:10 }}>
              <button onClick={cancelEdit} style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)', color:'#fff', borderRadius:'7px', padding:'7px 12px', cursor:'pointer', fontSize:'12px', fontWeight:600, fontFamily:'inherit' }}>← Cancel</button>
              <div style={{ fontSize:'15px', fontWeight:600, color:'#fff' }}>Edit Profile — {selected.full_name}</div>
              <button onClick={saveEdit} disabled={savingEdit} style={{ marginLeft:'auto', ...C.priBtn, opacity: savingEdit ? .6 : 1 }}>{savingEdit ? 'Saving…' : '💾 Save'}</button>
            </div>
            <div style={{ padding:'16px 20px' }}>
              <div style={C.card}>
                <div style={{ fontSize:'13px', fontWeight:600, color:'#374151', marginBottom:'12px' }}>✏️ Editable Fields</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                  {([
                    { k:'full_name',         label:'Full Name' },
                    { k:'first_name',        label:'First Name' },
                    { k:'last_name',         label:'Last Name' },
                    { k:'gender',            label:'Gender', opts:['Male','Female','Other'] },
                    { k:'date_of_birth',     label:'Date of Birth', type:'date' },
                    { k:'blood_group',       label:'Blood Group', opts:['A+','A-','B+','B-','O+','O-','AB+','AB-'] },
                    { k:'marital_status',    label:'Marital Status', opts:['Single','Married','Divorced','Widowed'] },
                    { k:'designation',       label:'Designation' },
                    { k:'grade',             label:'Grade' },
                    { k:'employment_type',   label:'Employment Type', opts:['Employee','Intern','NAPS','NATS','Consultant','Contract'] },
                    { k:'employment_status', label:'Employment Status', opts:['Active','Resigned','Sabbatical','Abscond','Inactive'] },
                    { k:'mobile',            label:'Mobile' },
                    { k:'personal_email',    label:'Personal Email' },
                    { k:'office_email',      label:'Office Email' },
                    { k:'notice_period_days',label:'Notice Period (days)', type:'number' },
                  ] as { k:string; label:string; type?:string; opts?:string[] }[]).map(f => (
                    <div key={f.k}>
                      <label style={{ fontSize:'10px', fontWeight:600, color:'#64748B', textTransform:'uppercase', letterSpacing:'.04em', display:'block', marginBottom:'4px' }}>{f.label}</label>
                      {f.opts ? (
                        <select style={{ ...C.sel, width:'100%' }} value={editForm[f.k] ?? ''} onChange={e => setEditForm((p:any) => ({ ...p, [f.k]: e.target.value }))}>
                          <option value="">—</option>
                          {f.opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={f.type || 'text'} style={{ ...C.inp, width:'100%' }} value={editForm[f.k] ?? ''} onChange={e => setEditForm((p:any) => ({ ...p, [f.k]: e.target.value }))} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdd && <AddEmployeeModal companies={companies} locations={locations} departments={departments} onClose={() => setShowAdd(false)} onSaved={(msg) => { setShowAdd(false); setAddMsg(msg); fetchEmployees(); setTimeout(() => setAddMsg(''), 3500) }} />}
      {showBulk && <BulkUploadModal companies={companies} departments={departments} locations={locations} onClose={() => setShowBulk(false)} onDone={(r) => { setAddMsg(`Bulk: ${r.added} added, ${r.skipped} skipped, ${r.errors} errors`); fetchEmployees(); fetchStats(); setTimeout(() => setAddMsg(''), 4000) }} />}
      {addMsg && <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:'#059669', color:'#fff', borderRadius:'10px', padding:'12px 18px', fontSize:'13px', fontWeight:600, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>✓ {addMsg}</div>}
    </div>
  )
}

