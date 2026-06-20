'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import HRActionPanel from '@/components/employees/HRActionPanel'

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
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [stats, setStats] = useState({
    total:0, active:0, resigned:0,
    employee:0, intern:0, naps:0, nats:0, consultant:0, contract:0
  })
  const PER_PAGE = 20

  const fetchStats = async () => {
    const { data } = await supabase.from('employees').select('employment_status, employment_type').neq('is_test', true)
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
  }

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
        locations(location_name, city),
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

  useEffect(() => { fetchMeta(); fetchStats() }, [])
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
          <button style={C.secBtn}>📥 Export Excel</button>
          <button style={C.priBtn}>+ Add Employee</button>
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
    </div>
  )
}

