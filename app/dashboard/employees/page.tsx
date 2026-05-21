'use client'
import { useState, useMemo, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types (same as before) ─────────────────────────────────────
type CollarType  = 'WC' | 'BC'
type EmpFunction = 'Sales Function' | 'Back Office'
type EmpStatus   = 'Active' | 'Resigned' | 'Terminated' | 'Absconding'
type Grade       = 'L2'|'L1'|'M3'|'M2'|'M1'|'E3'|'E2'|'E1'|'W2'|'W1'|'Intern'|'NAPS'|'NATS'|'Consultant'
type ViewTab     = 'list' | 'profile' | 'add'
type ProfileTab  = 'personal' | 'employment' | 'statutory' | 'bank' | 'documents'

interface Employee {
  id:              string
  emp_code:        string
  common_code:     string
  full_name:       string
  gender:          string
  dob:             string
  designation:     string
  department:      string
  grade:           Grade
  collar_type:     CollarType
  emp_function:    EmpFunction
  company:         string
  location:        string
  status:          EmpStatus
  mobile:          string
  personal_email:  string
  office_email:    string
  doj:             string
  group_doj:       string
  l1_manager:      string
  l2_manager:      string
  hr_manager:      string
  pan:             string
  aadhar_last4:    string
  uan:             string
  pf_applicable:   boolean
  esic_applicable: boolean
  bank_name:       string
  account_last4:   string
  ifsc:            string
  photo:           string
  employment_type: string
  blood_group:     string
  marital:         string
  dor?:            string
  dol?:            string
  notice_period:   number
  state:           string
  city:            string
}

// ── Supabase → UI mapper ───────────────────────────────────────
function mapEmployee(row: any): Employee {
  return {
    id:              row.id,
    emp_code:        row.emp_code,
    common_code:     row.common_code,
    full_name:       row.full_name,
    gender:          row.gender ?? '',
    dob:             row.date_of_birth
                       ? new Date(row.date_of_birth).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
                       : '',
    designation:     row.designation ?? '',
    department:      row.departments?.dept_name ?? '',
    grade:           (row.grade ?? 'E1') as Grade,
    collar_type:     (row.collar_type ?? 'WC') as CollarType,
    emp_function:    (row.employee_function ?? 'Back Office') as EmpFunction,
    company:         row.companies?.company_name ?? '',
    location:        row.locations?.location_name ?? '',
    status:          (row.employment_status ?? 'Active') as EmpStatus,
    mobile:          row.mobile ?? '',
    personal_email:  row.personal_email ?? '',
    office_email:    row.office_email ?? '',
    doj:             row.company_doj
                       ? new Date(row.company_doj).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
                       : '',
    group_doj:       row.group_doj
                       ? new Date(row.group_doj).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
                       : '',
    l1_manager:      row.l1?.full_name ?? '',
    l2_manager:      row.l2?.full_name ?? '',
    hr_manager:      row.hr?.full_name ?? '',
    pan:             row.pan_number ?? '',
    aadhar_last4:    row.aadhar_last4 ?? '',
    uan:             row.uan_number ?? '',
    pf_applicable:   row.pf_applicable ?? false,
    esic_applicable: row.esic_applicable ?? false,
    bank_name:       row.bank_name ?? '',
    account_last4:   row.bank_account_last4 ?? '',
    ifsc:            row.ifsc_code ?? '',
    photo:           row.photo_url ?? '',
    employment_type: row.employment_type ?? '',
    blood_group:     row.blood_group ?? '',
    marital:         row.marital_status ?? '',
    dor:             row.date_of_resignation
                       ? new Date(row.date_of_resignation).toLocaleDateString('en-IN')
                       : undefined,
    dol:             row.last_working_date
                       ? new Date(row.last_working_date).toLocaleDateString('en-IN')
                       : undefined,
    notice_period:   row.notice_period_days ?? 30,
    state:           row.res_state ?? '',
    city:            row.res_city ?? '',
  }
}

// ── Supabase fetch function ────────────────────────────────────
async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      companies   ( company_name, company_code ),
      locations   ( location_name, location_code ),
      departments ( dept_name, dept_code ),
      l1:employees!l1_manager_id ( full_name ),
      l2:employees!l2_manager_id ( full_name ),
      hr:employees!hr_manager_id ( full_name )
    `)
    .order('emp_code', { ascending: true })

  if (error) {
    console.error('Supabase fetch error:', error.message)
    return []
  }
  return (data ?? []).map(mapEmployee)
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const [view,        setView]        = useState<ViewTab>('list')
  const [selected,    setSelected]    = useState<Employee | null>(null)
  const [profileTab,  setProfileTab]  = useState<ProfileTab>('personal')
  const [search,      setSearch]      = useState('')
  const [filterCo,    setFilterCo]    = useState('All')
  const [filterGrade, setFilterGrade] = useState('All')
  const [filterType,  setFilterType]  = useState('All')
  const [filterStatus,setFilterStatus]= useState('All')

  // ── Fetch on mount ─────────────────────────────────────────
  useEffect(() => {
    fetchEmployees()
      .then(data => { setEmployees(data); setLoading(false) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }, [])

  // ── Refresh after add ──────────────────────────────────────
  const refreshEmployees = async () => {
    setLoading(true)
    const data = await fetchEmployees()
    setEmployees(data)
    setLoading(false)
  }

  // ── Filter logic ───────────────────────────────────────────
  const companies     = useMemo(() => ['All', ...new Set(employees.map(e => e.company))], [employees])
  const grades        = ['All','L2','L1','M3','M2','M1','E3','E2','E1','W2','W1','Intern','NAPS','NATS','Consultant']
  const empTypes      = ['All','Employee','Intern','NAPS','NATS','Contract','Consultant']
  const statuses      = ['All','Active','Resigned','Terminated','Absconding']

  const filtered = useMemo(() => employees.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !q || [e.full_name, e.emp_code, e.designation, e.department, e.mobile]
      .some(v => v.toLowerCase().includes(q))
    return matchSearch
      && (filterCo     === 'All' || e.company        === filterCo)
      && (filterGrade  === 'All' || e.grade          === filterGrade)
      && (filterType   === 'All' || e.employment_type=== filterType)
      && (filterStatus === 'All' || e.status         === filterStatus)
  }), [employees, search, filterCo, filterGrade, filterType, filterStatus])

  // ── Grade badge color ──────────────────────────────────────
  const gradeColor = (g: string) => {
    if (['L2','L1'].includes(g))         return { bg:'#1e3a5f', color:'#fff' }
    if (['M3','M2','M1'].includes(g))    return { bg:'#1d4ed8', color:'#fff' }
    if (['E3','E2','E1'].includes(g))    return { bg:'#0891b2', color:'#fff' }
    if (['W2','W1'].includes(g))         return { bg:'#7c3aed', color:'#fff' }
    if (['Intern','NAPS','NATS'].includes(g)) return { bg:'#059669', color:'#fff' }
    return { bg:'#6b7280', color:'#fff' }
  }

  const statusColor = (s: string) => ({
    Active:      '#16a34a', Resigned: '#dc2626',
    Terminated:  '#9f1239', Absconding:'#d97706'
  }[s] || '#6b7280')

  // ── Common styles ──────────────────────────────────────────
  const card    = { background:'#fff', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,.08)', padding:'20px' }
  const inp     = { width:'100%', padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', outline:'none' }
  const sel     = { ...inp, background:'#fff', cursor:'pointer' }
  const priBtn  = { background:'#1d4ed8', color:'#fff', border:'none', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', fontWeight:600, cursor:'pointer' }
  const secBtn  = { background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', cursor:'pointer' }

  // ── Loading / Error states ─────────────────────────────────
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:'12px' }}>
      <div style={{ width:'40px', height:'40px', border:'3px solid #e5e7eb', borderTopColor:'#1d4ed8', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <p style={{ color:'#6b7280', fontSize:'14px' }}>Loading employees from Supabase...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:'8px' }}>
      <p style={{ color:'#dc2626', fontSize:'16px', fontWeight:600 }}>⚠️ Supabase Connection Error</p>
      <p style={{ color:'#6b7280', fontSize:'13px' }}>{error}</p>
      <p style={{ color:'#9ca3af', fontSize:'12px' }}>Check .env.local → NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
      <button style={priBtn} onClick={refreshEmployees}>Retry</button>
    </div>
  )

  // ── LIST VIEW ──────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ padding:'24px', background:'#f8fafc', minHeight:'100vh' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
        <div>
          <h1 style={{ fontSize:'22px', fontWeight:700, color:'#111827', margin:0 }}>Employee Master</h1>
          <p style={{ fontSize:'13px', color:'#6b7280', margin:'2px 0 0' }}>
            {filtered.length} of {employees.length} employees · Live from Supabase
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button style={secBtn} onClick={refreshEmployees}>↻ Refresh</button>
          <button style={priBtn} onClick={() => setView('add')}>+ Add Employee</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding:'16px', marginBottom:'16px', display:'flex', gap:'12px', flexWrap:'wrap', alignItems:'center' }}>
        <input
          style={{ ...inp, width:'240px' }}
          placeholder="🔍  Search name, code, designation..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={{ ...sel, width:'180px' }} value={filterCo} onChange={e => setFilterCo(e.target.value)}>
          {companies.map(c => <option key={c}>{c}</option>)}
        </select>
        <select style={{ ...sel, width:'120px' }} value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
          {grades.map(g => <option key={g}>{g}</option>)}
        </select>
        <select style={{ ...sel, width:'140px' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          {empTypes.map(t => <option key={t}>{t}</option>)}
        </select>
        <select style={{ ...sel, width:'120px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
        {(search || filterCo !== 'All' || filterGrade !== 'All' || filterType !== 'All' || filterStatus !== 'All') && (
          <button style={secBtn} onClick={() => { setSearch(''); setFilterCo('All'); setFilterGrade('All'); setFilterType('All'); setFilterStatus('All') }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Stats Bar */}
      <div style={{ display:'flex', gap:'12px', marginBottom:'16px', flexWrap:'wrap' }}>
        {[
          { label:'Total',      value: employees.length,                                  color:'#1d4ed8' },
          { label:'Active',     value: employees.filter(e=>e.status==='Active').length,   color:'#16a34a' },
          { label:'Resigned',   value: employees.filter(e=>e.status==='Resigned').length, color:'#dc2626' },
          { label:'Contract',   value: employees.filter(e=>e.employment_type==='Contract').length, color:'#7c3aed' },
          { label:'Intern/Trainee', value: employees.filter(e=>['Intern','NAPS','NATS'].includes(e.employment_type)).length, color:'#059669' },
          { label:'Consultant', value: employees.filter(e=>e.employment_type==='Consultant').length, color:'#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background:'#fff', borderRadius:'10px', padding:'12px 18px', boxShadow:'0 1px 3px rgba(0,0,0,.07)', borderLeft:`3px solid ${s.color}` }}>
            <div style={{ fontSize:'20px', fontWeight:700, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:'11px', color:'#6b7280' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ ...card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
          <thead>
            <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>
              {['Emp Code','Name','Designation','Department','Grade','Type','Company','Status','Action']
                .map(h => <th key={h} style={{ padding:'12px 14px', textAlign:'left', fontWeight:600, color:'#374151', fontSize:'11px', textTransform:'uppercase', letterSpacing:'.05em', whiteSpace:'nowrap' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign:'center', padding:'40px', color:'#9ca3af' }}>No employees found</td></tr>
            ) : filtered.map((e, i) => (
              <tr key={e.id} style={{ borderBottom:'1px solid #f3f4f6', background: i%2===0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding:'11px 14px', fontWeight:600, color:'#1d4ed8', fontFamily:'monospace', fontSize:'12px' }}>{e.emp_code}</td>
                <td style={{ padding:'11px 14px' }}>
                  <div style={{ fontWeight:600, color:'#111827' }}>{e.full_name}</div>
                  <div style={{ fontSize:'11px', color:'#6b7280' }}>{e.mobile}</div>
                </td>
                <td style={{ padding:'11px 14px', color:'#374151' }}>{e.designation}</td>
                <td style={{ padding:'11px 14px', color:'#6b7280', fontSize:'12px' }}>{e.department}</td>
                <td style={{ padding:'11px 14px' }}>
                  <span style={{ ...gradeColor(e.grade), padding:'2px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700 }}>{e.grade}</span>
                </td>
                <td style={{ padding:'11px 14px' }}>
                  <span style={{ background:'#f3f4f6', color:'#374151', padding:'2px 8px', borderRadius:'4px', fontSize:'11px' }}>{e.employment_type}</span>
                </td>
                <td style={{ padding:'11px 14px', color:'#6b7280', fontSize:'12px', maxWidth:'140px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.company}</td>
                <td style={{ padding:'11px 14px' }}>
                  <span style={{ color: statusColor(e.status), fontWeight:600, fontSize:'12px' }}>● {e.status}</span>
                </td>
                <td style={{ padding:'11px 14px' }}>
                  <button
                    style={{ background:'#eff6ff', color:'#1d4ed8', border:'1px solid #dbeafe', borderRadius:'6px', padding:'4px 10px', fontSize:'12px', cursor:'pointer' }}
                    onClick={() => { setSelected(e); setProfileTab('personal'); setView('profile') }}
                  >View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── PROFILE VIEW ───────────────────────────────────────────
  if (view === 'profile' && selected) {
    const tabs: { key: ProfileTab; label: string }[] = [
      { key:'personal',   label:'👤 Personal'   },
      { key:'employment', label:'💼 Employment'  },
      { key:'statutory',  label:'📋 Statutory'   },
      { key:'bank',       label:'🏦 Bank'        },
      { key:'documents',  label:'📁 Documents'   },
    ]
    const Field = ({ label, value }: { label: string; value?: string | boolean }) => (
      <div>
        <div style={{ fontSize:'11px', color:'#9ca3af', marginBottom:'3px', textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</div>
        <div style={{ fontSize:'13px', color:'#111827', fontWeight:500 }}>
          {value === true ? '✅ Yes' : value === false ? '❌ No' : (value || '—')}
        </div>
      </div>
    )

    return (
      <div style={{ padding:'24px', background:'#f8fafc', minHeight:'100vh' }}>
        <button style={{ ...secBtn, marginBottom:'16px' }} onClick={() => setView('list')}>← Back to List</button>

        {/* Profile Header */}
        <div style={{ ...card, marginBottom:'16px', display:'flex', gap:'20px', alignItems:'center' }}>
          <div style={{ width:'64px', height:'64px', borderRadius:'50%', background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:'22px', fontWeight:700, flexShrink:0 }}>
            {selected.full_name.split(' ').map(n=>n[0]).join('').slice(0,2)}
          </div>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontSize:'18px', fontWeight:700, color:'#111827' }}>{selected.full_name}</h2>
            <p style={{ margin:'3px 0 0', color:'#6b7280', fontSize:'13px' }}>{selected.designation} · {selected.department}</p>
            <div style={{ display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap' }}>
              <span style={{ fontFamily:'monospace', fontSize:'12px', background:'#eff6ff', color:'#1d4ed8', padding:'2px 8px', borderRadius:'4px', fontWeight:600 }}>{selected.emp_code}</span>
              <span style={{ ...gradeColor(selected.grade), padding:'2px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700 }}>{selected.grade}</span>
              <span style={{ color: statusColor(selected.status), fontWeight:600, fontSize:'12px' }}>● {selected.status}</span>
              <span style={{ background:'#f3f4f6', color:'#6b7280', padding:'2px 8px', borderRadius:'4px', fontSize:'11px' }}>{selected.employment_type}</span>
            </div>
          </div>
        </div>

        {/* Profile Tabs */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'16px', background:'#fff', padding:'4px', borderRadius:'10px', boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          {tabs.map(t => (
            <button key={t.key}
              onClick={() => setProfileTab(t.key)}
              style={{ flex:1, padding:'8px', border:'none', borderRadius:'7px', cursor:'pointer', fontSize:'13px', fontWeight: profileTab===t.key ? 600 : 400, background: profileTab===t.key ? '#1d4ed8' : 'transparent', color: profileTab===t.key ? '#fff' : '#6b7280' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={card}>
          {profileTab === 'personal' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'20px' }}>
              <Field label="Full Name"       value={selected.full_name} />
              <Field label="Gender"          value={selected.gender} />
              <Field label="Date of Birth"   value={selected.dob} />
              <Field label="Blood Group"     value={selected.blood_group} />
              <Field label="Marital Status"  value={selected.marital} />
              <Field label="Personal Email"  value={selected.personal_email} />
              <Field label="Mobile"          value={selected.mobile} />
              <Field label="City"            value={selected.city} />
              <Field label="State"           value={selected.state} />
            </div>
          )}
          {profileTab === 'employment' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'20px' }}>
              <Field label="Emp Code"        value={selected.emp_code} />
              <Field label="Common Code"     value={selected.common_code} />
              <Field label="Company"         value={selected.company} />
              <Field label="Location"        value={selected.location} />
              <Field label="Department"      value={selected.department} />
              <Field label="Designation"     value={selected.designation} />
              <Field label="Grade"           value={selected.grade} />
              <Field label="Employment Type" value={selected.employment_type} />
              <Field label="Company DOJ"     value={selected.doj} />
              <Field label="Group DOJ"       value={selected.group_doj} />
              <Field label="Notice Period"   value={`${selected.notice_period} days`} />
              <Field label="Office Email"    value={selected.office_email} />
              <Field label="L1 Manager"      value={selected.l1_manager} />
              <Field label="HR Manager"      value={selected.hr_manager} />
              {selected.dor && <Field label="Date of Resignation" value={selected.dor} />}
              {selected.dol && <Field label="Last Working Day"    value={selected.dol} />}
            </div>
          )}
          {profileTab === 'statutory' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'20px' }}>
              <Field label="PAN Number"      value={selected.pan} />
              <Field label="Aadhaar (Last 4)" value={selected.aadhar_last4 ? `XXXX XXXX ${selected.aadhar_last4}` : ''} />
              <Field label="UAN Number"      value={selected.uan} />
              <Field label="PF Applicable"   value={selected.pf_applicable} />
              <Field label="ESIC Applicable" value={selected.esic_applicable} />
            </div>
          )}
          {profileTab === 'bank' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'20px' }}>
              <Field label="Bank Name"       value={selected.bank_name} />
              <Field label="Account No"      value={selected.account_last4 ? `XXXX XXXX ${selected.account_last4}` : ''} />
              <Field label="IFSC Code"       value={selected.ifsc} />
            </div>
          )}
          {profileTab === 'documents' && (
            <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af' }}>
              📁 Document upload coming soon
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── ADD EMPLOYEE VIEW (same as before — saves to Supabase) ──
  if (view === 'add') return (
    <div style={{ padding:'24px', background:'#f8fafc', minHeight:'100vh' }}>
      <button style={{ ...secBtn, marginBottom:'16px' }} onClick={() => setView('list')}>← Back</button>
      <div style={{ ...card, maxWidth:'900px' }}>
        <h2 style={{ margin:'0 0 20px', fontSize:'18px', fontWeight:700, color:'#111827' }}>Add New Employee</h2>
        {/* Personal */}
        <div style={{ marginBottom:'16px' }}>
          <div style={{ fontSize:'12px', fontWeight:600, color:'#1D4ED8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:'10px', paddingBottom:'6px', borderBottom:'2px solid #DBEAFE' }}>👤 Personal Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>
            {[
              { l:'First Name *',  p:'Ramesh'  },
              { l:'Middle Name',   p:'Kumar'   },
              { l:'Last Name *',   p:'Sharma'  },
              { l:'Date of Birth *', p:'', t:'date' },
              { l:'Gender *',      s:['Male','Female','Other'] },
              { l:'Blood Group',   s:['A+','A-','B+','B-','O+','O-','AB+','AB-'] },
              { l:'Marital Status',s:['Single','Married','Divorced','Widowed'] },
              { l:'Category',      s:['General','OBC','SC','ST'] },
              { l:'Personal Mobile *', p:'9876543210' },
              { l:'Personal Email', p:'name@gmail.com' },
              { l:'Father Name',   p:'Shyam Lal Sharma' },
            ].map((f,i)=>(
              <div key={i}>
                <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.l}</label>
                {f.s ? <select style={sel}><option value="">Select...</option>{f.s.map(o=><option key={o}>{o}</option>)}</select>
                : <input style={inp} type={f.t||'text'} placeholder={f.p}/>}
              </div>
            ))}
          </div>
        </div>
        {/* Employment */}
        <div style={{ marginBottom:'16px' }}>
          <div style={{ fontSize:'12px', fontWeight:600, color:'#1D4ED8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:'10px', paddingBottom:'6px', borderBottom:'2px solid #DBEAFE' }}>💼 Employment Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>
            {[
              { l:'Company *',         s:['GRP-001-COM-001','GRP-001-COM-002','GRP-001-COM-003'] },
              { l:'Department *',      s:['Finance & Accounts','HR & Admin','IT','Sales & Marketing','Production','Quality Control','Maintenance','Logistics','Procurement'] },
              { l:'Designation *',     p:'Manager' },
              { l:'Grade *',           s:['L2','L1','M3','M2','M1','E3','E2','E1','W2','W1'] },
              { l:'Employment Type *', s:['Employee','Intern','NAPS','NATS','Contract','Consultant'] },
              { l:'Collar Type *',     s:['WC - White Collar','BC - Blue Collar'] },
              { l:'Company DOJ *',     p:'', t:'date' },
              { l:'Group DOJ *',       p:'', t:'date' },
            ].map((f,i)=>(
              <div key={i}>
                <label style={{ fontSize:'11px', fontWeight:500, color:'#374151', display:'block', marginBottom:'4px' }}>{f.l}</label>
                {f.s ? <select style={sel}><option value="">Select...</option>{f.s.map(o=><option key={o}>{o}</option>)}</select>
                : <input style={inp} type={f.t||'text'} placeholder={f.p}/>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:'#EDE9FE', borderRadius:'8px', padding:'10px 12px', marginBottom:'14px', fontSize:'11px', color:'#7C3AED' }}>
          🤖 Employee code and Common Code (EZR••••••••) will be auto-generated on save
        </div>
        <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
          <button style={secBtn} onClick={() => setView('list')}>Cancel</button>
          <button style={secBtn}>Save as Draft</button>
          <button style={priBtn}>Save & Create Employee</button>
        </div>
      </div>
    </div>
  )

  return null
}