use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

interface Employee {
  id: string; emp_code: string; common_code: string; emp_type: string; payment_basis: string
  employee_name: string; gender: string; date_of_birth: string; blood_group: string; marital_status: string
  status: string; collar_type: string; employee_function: string; employee_category: string
  designation: string; grade: string; group_doj: string; company_doj: string; confirmation_status: string
  mobile: string; personal_email: string; office_email: string; pan_number: string; aadhaar_last4: string
  uan_number: string; pf_applicable: boolean; esic_applicable: boolean; pt_applicable: boolean
  bank_name: string; account_number: string; ifsc_code: string
  l1_manager: string; l2_manager: string; hr_manager: string
  notice_period: number; dor: string | null; dol: string | null; blacklisted: boolean; rehire_eligible: boolean
  naps_reg_no: string | null; contract_end_date: string | null
  company_id: string; location_id: string; department_id: string
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
  L2:{bg:'#EDE9FE',color:'#7C3AED'},L1:{bg:'#DDD6FE',color:'#6D28D9'},
  M3:{bg:'#DBEAFE',color:'#1D4ED8'},M2:{bg:'#E0F2FE',color:'#0369A1'},
  M1:{bg:'#CCFBF1',color:'#0D9488'},E3:{bg:'#DCFCE7',color:'#16A34A'},
  E2:{bg:'#ECFCCB',color:'#65A30D'},E1:{bg:'#FEF3C7',color:'#D97706'},
  W2:{bg:'#FEE2E2',color:'#DC2626'},W1:{bg:'#FFE4E6',color:'#BE123C'},
}
const TYPE_COLORS: Record<string,{bg:string;color:string}> = {
  Employee:{bg:'#EDE9FE',color:'#7C3AED'},Intern:{bg:'#DBEAFE',color:'#1D4ED8'},
  NAPS:{bg:'#DCFCE7',color:'#16A34A'},NATS:{bg:'#FEF3C7',color:'#D97706'},
  Consultant:{bg:'#FEE2E2',color:'#DC2626'},Contract:{bg:'#F1F5F9',color:'#374151'},
}
const STATUS_COLORS: Record<string,{bg:string;color:string}> = {
  Active:{bg:'#DCFCE7',color:'#16A34A'},Resigned:{bg:'#FEE2E2',color:'#DC2626'},
  Terminated:{bg:'#FEE2E2',color:'#991B1B'},Absconding:{bg:'#FEF3C7',color:'#D97706'},
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
  const [stats, setStats] = useState({total:0,active:0,resigned:0,employee:0,intern:0,naps:0,nats:0,consultant:0,contract:0})
  const PER_PAGE = 20

  const fetchStats = async () => {
    const {data} = await supabase.from('employees').select('status, emp_type')
    if (!data) return
    setStats({
      total:data.length, active:data.filter(e=>e.status==='Active').length,
      resigned:data.filter(e=>e.status==='Resigned').length,
      employee:data.filter(e=>e.emp_type==='Employee').length,
      intern:data.filter(e=>e.emp_type==='Intern').length,
      naps:data.filter(e=>e.emp_type==='NAPS').length,
      nats:data.filter(e=>e.emp_type==='NATS').length,
      consultant:data.filter(e=>e.emp_type==='Consultant').length,
      contract:data.filter(e=>e.emp_type==='Contract').length,
    })
  }

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
      let q = supabase.from('employees').select(`
        id,emp_code,common_code,emp_type,payment_basis,employee_name,gender,date_of_birth,
        blood_group,marital_status,status,collar_type,employee_function,employee_category,
        designation,grade,group_doj,company_doj,confirmation_status,mobile,personal_email,
        office_email,pan_number,aadhaar_last4,uan_number,pf_applicable,esic_applicable,
        pt_applicable,bank_name,account_number,ifsc_code,l1_manager,l2_manager,hr_manager,
        notice_period,dor,dol,blacklisted,rehire_eligible,naps_reg_no,contract_end_date,
        company_id,location_id,department_id,
        companies(company_name,company_code),locations(location_name,city),departments(dept_name)
      `,{count:'exact'}).order('emp_code')

      if (filterCompany)  q = q.eq('company_id', filterCompany)
      if (filterLocation) q = q.eq('location_id', filterLocation)
      if (filterDept)     q = q.eq('department_id', filterDept)
      if (filterType)     q = q.eq('emp_type', filterType)
      if (filterStatus)   q = q.eq('status', filterStatus)
      if (filterGrade)    q = q.eq('grade', filterGrade)
      if (search.trim())  q = q.or(`employee_name.ilike.%${search}%,emp_code.ilike.%${search}%,common_code.ilike.%${search}%,designation.ilike.%${search}%,mobile.ilike.%${search}%`)

      const from = (page-1)*PER_PAGE
      q = q.range(from, from+PER_PAGE-1)
      const {data,error:err,count} = await q
      if (err) throw err
      setEmployees((data as any[])||[]); setTotal(count||0)
    } catch(e:any) { setError(e.message||'Load failed') }
    finally { setLoading(false) }
  }, [search,filterCompany,filterLocation,filterDept,filterType,filterStatus,filterGrade,page])

  useEffect(()=>{fetchMeta();fetchStats()},[])
  useEffect(()=>{setPage(1)},[search,filterCompany,filterLocation,filterDept,filterType,filterStatus,filterGrade])
  useEffect(()=>{fetchEmployees()},[fetchEmployees])

  const filteredLocs  = filterCompany ? locations.filter(l=>l.company_id===filterCompany) : locations
  const filteredDepts = filterCompany ? departments.filter(d=>d.company_id===filterCompany) : departments
  const totalPages    = Math.ceil(total/PER_PAGE)
  const initials      = (name:string) => name?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'NA'
  const openProfile   = (emp:Employee) => { setSelected(emp); setProfileTab('personal'); setShowDrawer(true) }

  return (
    <div style={C.page}>
      <div style={C.topbar}>
        <div style={{fontSize:'12px',color:'#64748B'}}>
          Sharma Group &nbsp;›&nbsp; <span style={{color:'#7C3AED',fontWeight:500}}>Employee Master</span>
          <span style={{marginLeft:'8px',padding:'2px 8px',background:'#EDE9FE',color:'#7C3AED',borderRadius:'10px',fontSize:'11px'}}>{stats.total} Total</span>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button style={C.secBtn}>📥 Export Excel</button>
          <button style={C.priBtn}>+ Add Employee</button>
        </div>
      </div>

      <div style={C.body}>
        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'8px',marginBottom:'14px'}}>
          {[
            {label:'Total',value:stats.total,color:'#1E1B4B',onClick:()=>{setFType('');setFStatus('')}},
            {label:'Active',value:stats.active,color:'#16A34A',onClick:()=>{setFType('');setFStatus('Active')}},
            {label:'Resigned',value:stats.resigned,color:'#DC2626',onClick:()=>{setFType('');setFStatus('Resigned')}},
            {label:'Employee',value:stats.employee,color:'#7C3AED',onClick:()=>setFType('Employee')},
            {label:'Intern',value:stats.intern,color:'#1D4ED8',onClick:()=>setFType('Intern')},
            {label:'NAPS',value:stats.naps,color:'#0D9488',onClick:()=>setFType('NAPS')},
            {label:'Consultant',value:stats.consultant,color:'#D97706',onClick:()=>setFType('Consultant')},
            {label:'Contract',value:stats.contract,color:'#374151',onClick:()=>setFType('Contract')},
          ].map(s=>(
            <div key={s.label} onClick={s.onClick} style={{background:'#fff',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px 8px',textAlign:'center',cursor:'pointer',borderTop:`3px solid ${s.color}`}}>
              <div style={{fontSize:'20px',fontWeight:700,color:s.color}}>{loading?'—':s.value}</div>
              <div style={{fontSize:'10px',color:'#64748B',marginTop:'2px'}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{...C.card,display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap' as const,padding:'12px 14px'}}>
          <input style={{...C.inp,flex:1,minWidth:'200px'}} placeholder="🔍  Name, Code, Designation, Mobile..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select style={C.sel} value={filterCompany} onChange={e=>{setFCo(e.target.value);setFLoc('');setFDept('')}}>
            <option value="">All Companies</option>
            {companies.map(c=><option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
          </select>
          <select style={C.sel} value={filterLocation} onChange={e=>setFLoc(e.target.value)} disabled={!filterCompany}>
            <option value="">All Locations</option>
            {filteredLocs.map(l=><option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
          <select style={C.sel} value={filterDept} onChange={e=>setFDept(e.target.value)} disabled={!filterCompany}>
            <option value="">All Depts</option>
            {filteredDepts.map(d=><option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
          <select style={C.sel} value={filterType} onChange={e=>setFType(e.target.value)}>
            <option value="">All Types</option>
            {['Employee','Intern','NAPS','NATS','Consultant','Contract'].map(t=><option key={t}>{t}</option>)}
          </select>
          <select style={C.sel} value={filterStatus} onChange={e=>setFStatus(e.target.value)}>
            <option value="">All Status</option>
            {['Active','Resigned','Terminated','Absconding'].map(s=><option key={s}>{s}</option>)}
          </select>
          <select style={C.sel} value={filterGrade} onChange={e=>setFGrade(e.target.value)}>
            <option value="">All Grades</option>
            {['L2','L1','M3','M2','M1','E3','E2','E1','W2','W1'].map(g=><option key={g}>{g}</option>)}
          </select>
          {(search||filterCompany||filterLocation||filterDept||filterType||filterStatus||filterGrade)&&(
            <button style={C.secBtn} onClick={()=>{setSearch('');setFCo('');setFLoc('');setFDept('');setFType('');setFStatus('Active');setFGrade('')}}>✕ Clear</button>
          )}
        </div>

        {error && <div style={{padding:'10px 14px',background:'#FEE2E2',borderRadius:'8px',fontSize:'12px',color:'#DC2626',marginBottom:'12px'}}>⚠️ {error}</div>}

        {/* Table */}
        <div style={{background:'#fff',borderRadius:'10px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderBottom:'1px solid #F1F5F9'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'#0F172A'}}>
              {loading?'Loading...':`${total} employees found`}
              {filterStatus&&<span style={{marginLeft:'8px',fontSize:'11px',color:'#64748B'}}>· {filterStatus}</span>}
            </div>
            <div style={{fontSize:'11px',color:'#94A3B8'}}>Page {page} of {totalPages||1}</div>
          </div>

          {loading ? (
            <div style={{padding:'40px',textAlign:'center',color:'#94A3B8'}}>⏳ Loading employees...</div>
          ) : employees.length===0 ? (
            <div style={{padding:'40px',textAlign:'center',color:'#94A3B8'}}>
              <div style={{fontSize:'28px',marginBottom:'8px'}}>👥</div>
              <div>Koi employee nahi mila — filters change karo</div>
            </div>
          ) : (
            <div style={{overflowX:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                <thead>
                  <tr style={{background:'#1E1B4B'}}>
                    {['Emp Code','Name','Type','Designation','Department','Location / Co.','Grade','Status','DOJ','Mobile','Action'].map(h=>(
                      <th key={h} style={{padding:'10px 12px',color:'#fff',fontWeight:600,textAlign:'left' as const,fontSize:'11px',whiteSpace:'nowrap' as const}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp,i)=>{
                    const gc=GRADE_COLORS[emp.grade]||{bg:'#F1F5F9',color:'#374151'}
                    const tc=TYPE_COLORS[emp.emp_type]||{bg:'#F1F5F9',color:'#374151'}
                    const sc=STATUS_COLORS[emp.status]||{bg:'#F1F5F9',color:'#374151'}
                    return (
                      <tr key={emp.id} style={{background:i%2===0?'#F8FAFC':'#fff',borderBottom:'1px solid #E2E8F0',cursor:'pointer'}} onClick={()=>openProfile(emp)}>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{fontWeight:600,color:'#7C3AED',fontSize:'12px'}}>{emp.emp_code}</div>
                          <div style={{fontSize:'10px',color:'#94A3B8'}}>{emp.common_code}</div>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <div style={{width:'30px',height:'30px',borderRadius:'50%',background:emp.gender==='Female'?'#FCE7F3':'#EDE9FE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:700,color:emp.gender==='Female'?'#BE185D':'#7C3AED',flexShrink:0}}>
                              {initials(emp.employee_name)}
                            </div>
                            <div>
                              <div style={{fontWeight:500,color:'#0F172A'}}>{emp.employee_name}</div>
                              <div style={{fontSize:'10px',color:'#94A3B8'}}>{emp.gender} · {emp.blood_group||'—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px'}}><span style={{padding:'2px 7px',borderRadius:'5px',fontSize:'10px',fontWeight:500,...tc}}>{emp.emp_type}</span></td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{fontWeight:500}}>{emp.designation}</div>
                          <div style={{fontSize:'10px',color:'#94A3B8'}}>{emp.collar_type==='BC'?'🔵 Blue Collar':'⚪ White Collar'}</div>
                        </td>
                        <td style={{padding:'10px 12px',color:'#374151'}}>{(emp as any).departments?.dept_name||'—'}</td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{fontSize:'12px',color:'#374151'}}>{(emp as any).locations?.location_name||'—'}</div>
                          <div style={{fontSize:'10px',color:'#94A3B8'}}>{(emp as any).companies?.company_code||'—'}</div>
                        </td>
                        <td style={{padding:'10px 12px'}}><span style={{padding:'2px 7px',borderRadius:'5px',fontSize:'11px',fontWeight:600,...gc}}>{emp.grade}</span></td>
                        <td style={{padding:'10px 12px'}}>
                          <span style={{padding:'2px 8px',borderRadius:'5px',fontSize:'10px',fontWeight:500,...sc}}>{emp.status}</span>
                          {emp.status==='Resigned'&&emp.dol&&<div style={{fontSize:'9px',color:'#DC2626',marginTop:'2px'}}>DOL: {emp.dol}</div>}
                        </td>
                        <td style={{padding:'10px 12px',fontSize:'11px',color:'#64748B'}}>
                          <div>{emp.company_doj||'—'}</div>
                          {emp.group_doj!==emp.company_doj&&<div style={{fontSize:'9px',color:'#94A3B8'}}>Grp: {emp.group_doj}</div>}
                        </td>
                        <td style={{padding:'10px 12px',fontSize:'11px',color:'#374151'}}>{emp.mobile||'—'}</td>
                        <td style={{padding:'10px 12px'}} onClick={e=>e.stopPropagation()}>
                          <div style={{display:'flex',gap:'4px'}}>
                            <button onClick={()=>openProfile(emp)} style={{padding:'4px 8px',background:'#EDE9FE',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#7C3AED'}}>View</button>
                            <button style={{padding:'4px 8px',background:'#F1F5F9',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#374151'}}>Edit</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages>1&&(
            <div style={{display:'flex',justifyContent:'center',gap:'6px',padding:'12px',borderTop:'1px solid #F1F5F9'}}>
              <button style={{...C.secBtn,padding:'6px 12px',opacity:page===1?0.4:1}} onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>← Prev</button>
              {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                const p=page<=4?i+1:page-3+i
                if(p<1||p>totalPages) return null
                return <button key={p} onClick={()=>setPage(p)} style={{width:'32px',height:'32px',border:'1.5px solid',borderRadius:'6px',cursor:'pointer',fontSize:'12px',fontWeight:p===page?600:400,background:p===page?'#7C3AED':'#fff',color:p===page?'#fff':'#374151',borderColor:p===page?'#7C3AED':'#E2E8F0'}}>{p}</button>
              })}
              <button style={{...C.secBtn,padding:'6px 12px',opacity:page===totalPages?0.4:1}} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next →</button>
            </div>
          )}
        </div>
      </div>

      {/* Profile Drawer */}
      {showDrawer&&selected&&(
        <div style={{position:'fixed' as const,inset:0,background:'rgba(0,0,0,0.35)',zIndex:200}} onClick={()=>setShowDrawer(false)}>
          <div style={{position:'absolute' as const,right:0,top:0,bottom:0,width:'480px',background:'#fff',display:'flex',flexDirection:'column' as const,boxShadow:'-4px 0 24px rgba(0,0,0,0.12)'}} onClick={e=>e.stopPropagation()}>
            <div style={{background:'#1E1B4B',padding:'16px 20px',display:'flex',gap:'12px',alignItems:'center'}}>
              <div style={{width:'48px',height:'48px',borderRadius:'50%',background:selected.gender==='Female'?'#FCE7F3':'#EDE9FE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',fontWeight:700,color:selected.gender==='Female'?'#BE185D':'#7C3AED',flexShrink:0}}>
                {initials(selected.employee_name)}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:'15px',fontWeight:600,color:'#fff'}}>{selected.employee_name}</div>
                <div style={{fontSize:'11px',color:'rgba(255,255,255,0.6)',marginTop:'2px'}}>{selected.emp_code} · {selected.designation}</div>
                <div style={{display:'flex',gap:'6px',marginTop:'6px'}}>
                  <span style={{padding:'1px 7px',borderRadius:'5px',fontSize:'10px',...(TYPE_COLORS[selected.emp_type]||{bg:'#F1F5F9',color:'#374151'})}}>{selected.emp_type}</span>
                  <span style={{padding:'1px 7px',borderRadius:'5px',fontSize:'10px',...(STATUS_COLORS[selected.status]||{bg:'#F1F5F9',color:'#374151'})}}>{selected.status}</span>
                  <span style={{padding:'1px 7px',borderRadius:'5px',fontSize:'10px',...(GRADE_COLORS[selected.grade]||{bg:'#F1F5F9',color:'#374151'})}}>{selected.grade}</span>
                </div>
              </div>
              <button onClick={()=>setShowDrawer(false)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.6)',fontSize:'20px',cursor:'pointer',lineHeight:1}}>✕</button>
            </div>

            <div style={{display:'flex',borderBottom:'1px solid #E2E8F0',background:'#F8FAFC'}}>
              {[{id:'personal',label:'👤 Personal'},{id:'employment',label:'💼 Employment'},{id:'statutory',label:'🏛️ Statutory'},{id:'bank',label:'🏦 Bank'}].map(t=>(
                <button key={t.id} onClick={()=>setProfileTab(t.id)} style={{flex:1,padding:'10px 4px',border:'none',background:'transparent',cursor:'pointer',fontSize:'11px',fontWeight:profileTab===t.id?600:400,color:profileTab===t.id?'#7C3AED':'#64748B',borderBottom:profileTab===t.id?'2.5px solid #7C3AED':'2.5px solid transparent'}}>{t.label}</button>
              ))}
            </div>

            <div style={{flex:1,overflowY:'auto' as const,padding:'16px 20px'}}>
              {profileTab==='personal'&&(
                <div>
                  {[
                    {label:'Full Name',value:selected.employee_name},
                    {label:'Common Code',value:selected.common_code},
                    {label:'Gender',value:selected.gender},
                    {label:'Date of Birth',value:selected.date_of_birth},
                    {label:'Blood Group',value:selected.blood_group||'—'},
                    {label:'Marital Status',value:selected.marital_status||'—'},
                    {label:'Mobile',value:selected.mobile},
                    {label:'Personal Email',value:selected.personal_email||'—'},
                    {label:'Office Email',value:selected.office_email||'—'},
                    {label:'Aadhaar Last 4',value:selected.aadhaar_last4?`XXXX XXXX ${selected.aadhaar_last4}`:'—'},
                    {label:'PAN',value:selected.pan_number||'—'},
                  ].map((f,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #F1F5F9',fontSize:'12px'}}>
                      <span style={{color:'#64748B',flexShrink:0,width:'130px'}}>{f.label}</span>
                      <span style={{fontWeight:500,color:'#0F172A',textAlign:'right' as const}}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {profileTab==='employment'&&(
                <div>
                  {[
                    {label:'Emp Type',value:selected.emp_type},
                    {label:'Payment Basis',value:selected.payment_basis},
                    {label:'Department',value:(selected as any).departments?.dept_name||'—'},
                    {label:'Designation',value:selected.designation},
                    {label:'Grade',value:selected.grade},
                    {label:'Collar',value:selected.collar_type==='BC'?'Blue Collar':'White Collar'},
                    {label:'Function',value:selected.employee_function||'—'},
                    {label:'Company',value:(selected as any).companies?.company_name||'—'},
                    {label:'Location',value:(selected as any).locations?.location_name||'—'},
                    {label:'Group DOJ',value:selected.group_doj||'—'},
                    {label:'Company DOJ',value:selected.company_doj||'—'},
                    {label:'Confirmation',value:selected.confirmation_status||'—'},
                    {label:'Notice Period',value:selected.notice_period?`${selected.notice_period} days`:'—'},
                    {label:'L1 Manager',value:selected.l1_manager||'—'},
                    {label:'L2 Manager',value:selected.l2_manager||'—'},
                    {label:'HR Manager',value:selected.hr_manager||'—'},
                    ...(selected.status==='Resigned'?[{label:'Date of Resign',value:selected.dor||'—'},{label:'Last Working Day',value:selected.dol||'—'}]:[]),
                    {label:'Rehire Eligible',value:selected.rehire_eligible?'✅ Yes':'❌ No'},
                    {label:'Blacklisted',value:selected.blacklisted?'🚫 Yes':'No'},
                  ].map((f,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #F1F5F9',fontSize:'12px'}}>
                      <span style={{color:'#64748B',flexShrink:0,width:'140px'}}>{f.label}</span>
                      <span style={{fontWeight:500,color:'#0F172A',textAlign:'right' as const}}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {profileTab==='statutory'&&(
                <div>
                  <div style={{display:'flex',gap:'8px',marginBottom:'14px'}}>
                    {[{label:'PF',value:selected.pf_applicable},{label:'ESIC',value:selected.esic_applicable},{label:'PT',value:selected.pt_applicable}].map(s=>(
                      <div key={s.label} style={{flex:1,padding:'10px',borderRadius:'8px',background:s.value?'#F0FDF4':'#F8FAFC',border:`1px solid ${s.value?'#BBF7D0':'#E2E8F0'}`,textAlign:'center' as const}}>
                        <div style={{fontSize:'12px',fontWeight:600,color:'#374151'}}>{s.label}</div>
                        <div style={{fontSize:'11px',color:s.value?'#16A34A':'#94A3B8',marginTop:'4px'}}>{s.value?'✅ Applicable':'❌ N/A'}</div>
                      </div>
                    ))}
                  </div>
                  {[{label:'UAN Number',value:selected.uan_number||'—'},{label:'PAN Number',value:selected.pan_number||'—'}].map((f,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #F1F5F9',fontSize:'12px'}}>
                      <span style={{color:'#64748B'}}>{f.label}</span>
                      <span style={{fontWeight:500,color:'#0F172A'}}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {profileTab==='bank'&&(
                <div>
                  <div style={{background:'#F0FDF4',border:'1px solid #BBF7D0',borderRadius:'10px',padding:'14px'}}>
                    <div style={{fontSize:'13px',fontWeight:600,color:'#15803D',marginBottom:'10px'}}>🏦 Salary Account</div>
                    {[
                      {label:'Bank Name',value:selected.bank_name||'—'},
                      {label:'Account No.',value:selected.account_number?`XXXX XXXX ${selected.account_number.slice(-4)}`:'—'},
                      {label:'IFSC Code',value:selected.ifsc_code||'—'},
                    ].map((f,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #DCFCE7',fontSize:'12px'}}>
                        <span style={{color:'#64748B'}}>{f.label}</span>
                        <span style={{fontWeight:500,color:'#0F172A'}}>{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{padding:'12px 20px',borderTop:'1px solid #E2E8F0',display:'flex',gap:'8px'}}>
              <button style={{...C.priBtn,flex:1}}>✏️ Edit Profile</button>
              <button style={C.secBtn}>📄 Documents</button>
              <button style={C.secBtn}>💰 Salary</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}