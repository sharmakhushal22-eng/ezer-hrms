'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { ALL_STATES, PT_STATES, getDistricts } from '../../../lib/states-districts'
import { supabase } from '../../../lib/supabase'

// ═══════════════════════════════════════════════
//  COMPANY SETUP — Types, Constants, Styles
// ═══════════════════════════════════════════════
// ── Types ─────────────────────────────────────────────────
interface Location {
  id: string; name: string; type: string; address: string
  state: string; district: string; pincode: string; lat: string; lng: string
  licenseNumber: string; certificate: string
}
interface EPFReg { id: string; code: string; scope: 'all' | 'specific'; locations: string[]; deptAddress: string; certificate: string }
interface ESICReg { id: string; code: string; type: 'main' | 'sub'; state: string; district: string; locations: string[]; deptAddress: string; certificate: string }
interface PTReg { id: string; regNumber: string; state: string; district: string; coveredLocations: string[]; deptAddress: string; certificate: string }
interface GSTReg { id: string; number: string; state: string; certificate: string }
interface BankAccount { bankName: string; accountNumber: string; ifsc: string; accountType: string; cheque: string }
interface LicensePlan { plan: string; maxEmployees: string; maxLocations: string; validFrom: string; validTill: string; annualCost: string; billingCycle: string }
const uid = () => Math.random().toString(36).slice(2, 9)
const LOC_TYPES = ['Head Office','Registered Office','Corporate Office','Branch','Factory','Warehouse','Shop','Refinery','Depot','Construction Site','Other']
const CO_TYPES = ['Private Limited (Pvt Ltd)','Public Limited (Ltd)','LLP','Partnership Firm','Sole Proprietorship','OPC (One Person Company)','Section 8 / NGO']
const INDUSTRIES = ['Manufacturing','Trading','IT / Software','ITES / BPO','Retail','Hospitality','Healthcare','Construction','Transport & Logistics','Education','Finance / Banking','Petroleum / Energy','Agriculture','Other']
const PLANS = ['Starter','Growth','Enterprise']
const STEPS = [
  { label: 'Group', icon: '🏛️' },
  { label: 'Company', icon: '🏢' },
  { label: 'Locations', icon: '📍' },
  { label: 'Tax', icon: '🧾' },
  { label: 'Labour Law', icon: '⚖️' },
  { label: 'Bank', icon: '🏦' },
  { label: 'License', icon: '📋' },
]
const C = {
  wrap: { minHeight: '100vh', background: '#F0F4F8', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: '13px' } as React.CSSProperties,
  top: { background: '#fff', padding: '11px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 } as React.CSSProperties,
  body: { maxWidth: '900px', margin: '0 auto', padding: '20px 16px' } as React.CSSProperties,
  card: { background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '18px', marginBottom: '12px' } as React.CSSProperties,
  sub: { background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '12px 14px', marginBottom: '8px' } as React.CSSProperties,
  lbl: { display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '5px' } as React.CSSProperties,
  req: { color: '#DC2626', marginLeft: '2px' } as React.CSSProperties,
  g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } as React.CSSProperties,
  g3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' } as React.CSSProperties,
  secTitle: { fontSize: '13px', fontWeight: 600, color: '#0F172A', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '8px' } as React.CSSProperties,
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', background: '#F1F5F9', border: '1px dashed #CBD5E1', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#7C3AED', fontWeight: 500, width: 'fit-content', marginTop: '6px' } as React.CSSProperties,
  rmBtn: { padding: '3px 8px', background: '#FEE2E2', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#DC2626', fontWeight: 500 } as React.CSSProperties,
  priBtn: { padding: '10px 24px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  secBtn: { padding: '10px 20px', background: '#fff', color: '#374151', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  xlsBtn: { padding: '7px 14px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  upBtn: { padding: '7px 14px', background: '#0EA5E9', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
}
const inp = (err?: boolean): React.CSSProperties => ({
  width: '100%', padding: '9px 11px', border: `1.5px solid ${err ? '#DC2626' : '#E2E8F0'}`,
  borderRadius: '8px', fontSize: '13px', outline: 'none', background: err ? '#FFF5F5' : '#F8FAFC',
  boxSizing: 'border-box', color: '#0F172A'
})
const sel = (err?: boolean): React.CSSProperties => ({ ...inp(err), appearance: 'auto' as any })
const uploadBox: React.CSSProperties = {
  border: '2px dashed #E2E8F0', borderRadius: '8px', padding: '10px',
  textAlign: 'center', cursor: 'pointer', color: '#94A3B8', fontSize: '11px'
}


// ═══════════════════════════════════════════════
//  MASTER SETUP — Types, Constants, Styles
// ═══════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────────
interface Category { id: string; code: string; name: string; icon: string; sort_order: number }
interface MasterType { id: string; category_id: string; code: string; name: string; description: string; has_color: boolean; has_code: boolean; has_parent: boolean; has_extra_data: boolean; extra_schema: any; is_system: boolean }
interface MasterValue { id: string; type_id: string; code: string; label: string; description: string; color: string; parent_id: string; extra_data: any; sort_order: number; is_system: boolean; is_active: boolean }

// ── Styles ─────────────────────────────────────────────────────────
const MC = {
  page: { display:'flex' as const, minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  sidebar: { width:'260px', background:'#fff', borderRight:'1px solid #E2E8F0', display:'flex' as const, flexDirection:'column' as const, flexShrink:0 },
  main: { flex:1, display:'flex' as const, flexDirection:'column' as const, overflow:'hidden' as const },
  topbar: { background:'#fff', padding:'11px 20px', borderBottom:'1px solid #E2E8F0', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const },
  body: { flex:1, padding:'16px 20px', overflowY:'auto' as const },
  card: { background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:'10px' },
  priBtn: { padding:'8px 16px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'8px 12px', background:'#fff', color:'#374151', border:'1px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' },
  dangerBtn: { padding:'6px 12px', background:'#FEE2E2', color:'#DC2626', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer' },
  inp: { width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
  lbl: { fontSize:'11px', fontWeight:500 as const, color:'#374151', display:'block' as const, marginBottom:'4px' },
}

// ── Supabase helpers ───────────────────────────────────────────────
async function getCategories(): Promise<Category[]> {
  const { data } = await supabase.from('master_categories').select('*').eq('is_active', true).order('sort_order')
  return data || []
}
async function getTypes(category_id: string): Promise<MasterType[]> {
  const { data } = await supabase.from('master_types').select('*').eq('category_id', category_id).eq('is_active', true).order('sort_order')
  return data || []
}
async function getValues(type_id: string): Promise<MasterValue[]> {
  const { data } = await supabase.from('master_values').select('*').eq('type_id', type_id).order('sort_order').order('label')
  return data || []
}
async function saveValue(payload: any) {
  if (payload.id) {
    const { id, type_id, is_system, created_at, ...rest } = payload
    return supabase.from('master_values').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
  }
  return supabase.from('master_values').insert(payload)
}
async function toggleActive(id: string, val: boolean) {
  return supabase.from('master_values').update({ is_active: val, updated_at: new Date().toISOString() }).eq('id', id)
}
async function saveType(payload: any) {
  if (payload.id) {
    const { id, ...rest } = payload
    return supabase.from('master_types').update(rest).eq('id', id)
  }
  return supabase.from('master_types').insert(payload)
}

// ── Color Picker ───────────────────────────────────────────────────
const COLORS = ['#7C3AED','#1D4ED8','#16A34A','#D97706','#DC2626','#0D9488','#9333EA','#BE185D','#0369A1','#374151','#059669','#CA8A04']


// ═══════════════════════════════════════════════
//  COMPANY SETUP COMPONENT
// ═══════════════════════════════════════════════
function CompanySetupTab() {
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploadPreview, setUploadPreview] = useState<any[] | null>(null)
  const [mapModal, setMapModal] = useState<{ locIndex: number } | null>(null)
  const [savedGroup, setSavedGroup] = useState('')
  const [companyCount, setCompanyCount] = useState(1)
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const markerRef = useRef<any>(null)

  const [groupName, setGroupName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [employerName, setEmployerName] = useState('')
  const [companyType, setCompanyType] = useState('')
  const [industry, setIndustry] = useState('')
  const [pan, setPan] = useState('')
  const [tan, setTan] = useState('')
  const [cin, setCin] = useState('')
  const [doi, setDoi] = useState('')
  const [headerText, setHeaderText] = useState('')
  const [footerText, setFooterText] = useState('')

  const [locations, setLocations] = useState<Location[]>([
    { id: uid(), name: '', type: 'Head Office', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }
  ])
  const [gstList, setGstList] = useState<GSTReg[]>([{ id: uid(), number: '', state: '', certificate: '' }])
  const [epfList, setEpfList] = useState<EPFReg[]>([{ id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])
  const [esicList, setEsicList] = useState<ESICReg[]>([{ id: uid(), code: '', type: 'main', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])
  const [ptList, setPtList] = useState<PTReg[]>([{ id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])
  const [lwf, setLwf] = useState(false)
  const [lwfStates, setLwfStates] = useState<string[]>([])

  // ✅ FIX: accountNumber correctly used in both bank objects
  const [opBank, setOpBank] = useState<BankAccount>({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
  const [salBank, setSalBank] = useState<BankAccount>({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
  const [sameBank, setSameBank] = useState(false)

  const [license, setLicense] = useState<LicensePlan>({ plan: 'Growth', maxEmployees: '200', maxLocations: '20', validFrom: '', validTill: '', annualCost: '', billingCycle: 'Annual' })

  const namedLocs = locations.filter(l => l.name)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (step === 0 && !groupName.trim()) errs.groupName = 'Group name is required'
    if (step === 1) {
      if (!companyName.trim()) errs.companyName = 'Company name is required'
      if (!employerName.trim()) errs.employerName = 'Employer name is required'
      if (!companyType) errs.companyType = 'Company type is required'
      if (!industry) errs.industry = 'Industry is required'
      if (!pan.trim()) errs.pan = 'PAN is required'
      if (!tan.trim()) errs.tan = 'TAN is required'
    }
    if (step === 2) {
      locations.forEach((l, i) => {
        if (!l.name.trim()) errs[`loc_name_${i}`] = 'Location name required'
        if (!l.state) errs[`loc_state_${i}`] = 'State required'
        if (!l.district) errs[`loc_district_${i}`] = 'District required'
        if (!l.address.trim()) errs[`loc_address_${i}`] = 'Address required'
      })
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const goNext = () => {
    if (!validate()) return
    if (step === 0) setSavedGroup(groupName)
    if (step < STEPS.length - 1) setStep(s => s + 1)
    else setDone(true)
  }

  const updateLoc = (i: number, f: keyof Location, v: string) => {
    setLocations(p => p.map((l, idx) => idx === i ? { ...l, [f]: v, ...(f === 'state' ? { district: '' } : {}) } : l))
  }

  const toggleEpfLoc = (i: number, locName: string) => {
    setEpfList(p => p.map((e, idx) => idx === i ? {
      ...e, locations: e.locations.includes(locName) ? e.locations.filter(l => l !== locName) : [...e.locations, locName]
    } : e))
  }

  const updateEsic = (i: number, f: keyof ESICReg, v: string) => {
    setEsicList(p => p.map((e, idx) => idx === i ? {
      ...e, [f]: v,
      ...(f === 'state' ? { district: '', locations: [] } : {}),
      ...(f === 'district' ? { locations: locations.filter(l => l.state === esicList[i].state && l.district === v).map(l => l.name) } : {})
    } : e))
  }

  const updatePT = (i: number, f: keyof PTReg, v: string) => {
    setPtList(p => p.map((pt, idx) => idx === i ? {
      ...pt, [f]: v,
      ...(f === 'state' ? { district: '', coveredLocations: [] } : {}),
      ...(f === 'district' ? { coveredLocations: locations.filter(l => l.state === ptList[i].state && l.district === v).map(l => l.name) } : {})
    } : pt))
  }

  const initMap = useCallback(async (locIndex: number) => {
    if (!mapRef.current) return
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!key) return
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    script.async = true
    script.onload = () => {
      const G = (window as any).google
      const defaultLat = locations[locIndex].lat ? parseFloat(locations[locIndex].lat) : 20.5937
      const defaultLng = locations[locIndex].lng ? parseFloat(locations[locIndex].lng) : 78.9629
      const map = new G.maps.Map(mapRef.current!, {
        center: { lat: defaultLat, lng: defaultLng },
        zoom: locations[locIndex].lat ? 15 : 5,
        mapTypeControl: false, streetViewControl: false,
      })
      mapInstance.current = map
      if (locations[locIndex].lat) {
        markerRef.current = new G.maps.Marker({ position: { lat: defaultLat, lng: defaultLng }, map })
      }
      const input = document.getElementById('map-search') as HTMLInputElement
      const searchBox = new G.maps.places.SearchBox(input)
      map.addListener('bounds_changed', () => searchBox.setBounds(map.getBounds()!))
      searchBox.addListener('places_changed', () => {
        const places = searchBox.getPlaces()
        if (!places?.length) return
        const place = places[0]
        if (!place.geometry?.location) return
        map.setCenter(place.geometry.location)
        map.setZoom(15)
        if (markerRef.current) markerRef.current.setMap(null)
        markerRef.current = new G.maps.Marker({ position: place.geometry.location, map })
        updateLoc(locIndex, 'lat', place.geometry.location.lat().toFixed(6))
        updateLoc(locIndex, 'lng', place.geometry.location.lng().toFixed(6))
        if (place.formatted_address && !locations[locIndex].address) {
          updateLoc(locIndex, 'address', place.formatted_address)
        }
      })
      map.addListener('click', (e: any) => {
        const lat = e.latLng.lat().toFixed(6)
        const lng = e.latLng.lng().toFixed(6)
        if (markerRef.current) markerRef.current.setMap(null)
        markerRef.current = new G.maps.Marker({ position: e.latLng, map })
        updateLoc(locIndex, 'lat', lat)
        updateLoc(locIndex, 'lng', lng)
      })
    }
    if (!document.querySelector(`script[src*="maps.googleapis.com"]`)) {
      document.head.appendChild(script)
    } else {
      script.onload?.(new Event('load'))
    }
  }, [locations])

  useEffect(() => {
    if (mapModal !== null) setTimeout(() => initMap(mapModal.locIndex), 100)
  }, [mapModal, initMap])

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['EZER HRMS — Company Setup Template v1.0'],[''],
      ['Company Name *','Employer Name *','Company Type *','Industry *','PAN *','TAN *','CIN','Date of Incorporation (DD/MM/YYYY)'],
      ['Sharma Sons Private Limited','Ramesh Kumar Sharma','Private Limited (Pvt Ltd)','Manufacturing','AAAPL1234C','DELA12345B','U12345MH2020PTC123456','01/04/2010'],
    ]), 'Company')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['LOCATIONS — One row per location'],[''],
      ['Location Name *','Type *','Address *','State *','District *','PIN *','License/Reg No.'],
      ['Delhi Head Office','Head Office','Plot 12 Sector 5 Dwarka','Delhi','South West Delhi','110075',''],
      ['Panipat Factory','Factory','NH-1 Industrial Area Sector 29','Haryana','Panipat','132103','FAC/HR/2020/001'],
      ['Mumbai Office','Branch','Nariman Point Floor 12','Maharashtra','Mumbai City','400021',''],
    ]), 'Locations')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['LABOUR LAW REGISTRATIONS'],[''],
      ['Type *','Reg Number *','State *','District','Scope/Locations','Dept Address for Filing'],
      ['EPF','MHBAN1234567000','Maharashtra','','All Locations','Nariman Point Floor 12 Mumbai'],
      ['ESIC','41000001234567890','Maharashtra','Mumbai City','Mumbai Office','Nariman Point Floor 12 Mumbai'],
      ['PT','MH/PT/MUM/001','Maharashtra','Mumbai City','Mumbai Office','Nariman Point Mumbai'],
      ['GST','27AAAPL1234C1Z5','Maharashtra','','All MH Locations',''],
    ]), 'Labour Law')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['BANK ACCOUNTS'],[''],
      ['Account Type *','Bank Name *','Account Number *','IFSC *','Account Category'],
      ['Operating','HDFC Bank','1234567890123456','HDFC0001234','Current'],
      ['Salary','ICICI Bank','9876543210987654','ICIC0001234','Current'],
    ]), 'Bank')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['INSTRUCTIONS'],[''],
      ['1. Do NOT change column headers'],
      ['2. Delete example rows before uploading'],
      ['3. Location Types: Head Office, Registered Office, Corporate Office, Branch, Factory, Warehouse, Shop, Refinery, Depot, Construction Site, Other'],
      ['4. Labour Law Types: EPF, ESIC, ESIC-SUB, PT, GST, LWF'],
      ['5. PT is STATE + DISTRICT level — one PT covers all locations in same district'],
      ['6. EPF Scope: All Locations OR specific names comma separated'],
      ['7. Save as .xlsx before uploading'],
    ]), 'Instructions')
    XLSX.writeFile(wb, 'Ezer_Company_Setup_Template.xlsx')
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' })
      const locSheet = wb.Sheets['Locations']
      if (locSheet) {
        const rows: any[] = XLSX.utils.sheet_to_json(locSheet, { header: 1, defval: '' })
        const parsed = rows.slice(3).filter((r: any[]) => r[0]).map((r: any[]) => ({
          id: uid(), name: r[0] || '', type: r[1] || 'Branch', address: r[2] || '',
          state: r[3] || '', district: r[4] || '', pincode: String(r[5] || ''),
          lat: '', lng: '', licenseNumber: r[6] || '', certificate: ''
        }))
        setUploadPreview(parsed)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmUpload = () => {
    if (uploadPreview) setLocations(uploadPreview)
    setUploadPreview(null)
  }

  const resetCompany = () => {
    setCompanyName(''); setEmployerName(''); setCompanyType(''); setIndustry('')
    setPan(''); setTan(''); setCin(''); setDoi(''); setHeaderText(''); setFooterText('')
    setLocations([{ id: uid(), name: '', type: 'Head Office', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }])
    setGstList([{ id: uid(), number: '', state: '', certificate: '' }])
    setEpfList([{ id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])
    setEsicList([{ id: uid(), code: '', type: 'main', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])
    setPtList([{ id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])
    setOpBank({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
    setSalBank({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
    setSameBank(false)
    setLicense({ plan: 'Growth', maxEmployees: '200', maxLocations: '20', validFrom: '', validTill: '', annualCost: '', billingCycle: 'Annual' })
    setStep(1); setDone(false)
  }

  if (done) return (
    <div style={{ ...C.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: '48px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: '480px', width: '100%', margin: '20px' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>Setup Complete!</h2>
        <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '4px' }}>{savedGroup} → {companyName}</p>
        <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>Auto Code: GRP-001-COM-00{companyCount}</p>
        <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '24px' }}>
          {locations.length} location(s) | {license.plan} Plan | {license.maxEmployees} employees | Valid till {license.validTill || 'Not set'}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button style={C.priBtn} onClick={() => { setCompanyCount(c => c + 1); resetCompany() }}>+ Add Another Company</button>
          <button style={C.secBtn}>👥 Setup Employees</button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={C.wrap}>
      {/* Topbar */}
      <div style={C.top}>
        <div style={{ fontSize: '12px', color: '#64748B' }}>
          {savedGroup || 'Admin Setup'} &nbsp;›&nbsp;
          <span style={{ color: '#7C3AED', fontWeight: 500 }}>
            {companyCount > 1 ? `Company ${companyCount}` : 'Company Setup Wizard'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button style={C.xlsBtn} onClick={downloadTemplate}>📥 Template</button>
          <button style={C.upBtn} onClick={() => fileRef.current?.click()}>📤 Upload Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleUpload} />
          <div style={{ width: '30px', height: '30px', background: '#7C3AED', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 600 }}>KS</div>
        </div>
      </div>

      {/* Upload Preview Modal */}
      {uploadPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', maxWidth: '820px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>📋 Excel Upload Preview</div>
            <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '14px' }}>{uploadPreview.length} locations found — review and confirm</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead><tr style={{ background: '#7C3AED', color: '#fff' }}>
                {['Name','Type','State','District','PIN'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left' }}>{h}</th>)}
              </tr></thead>
              <tbody>{uploadPreview.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', background: i % 2 ? '#F8FAFC' : '#fff' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 500 }}>{r.name}</td>
                  <td style={{ padding: '7px 10px' }}><span style={{ padding: '2px 6px', background: '#EDE9FE', color: '#7C3AED', borderRadius: '6px', fontSize: '10px' }}>{r.type}</span></td>
                  <td style={{ padding: '7px 10px' }}>{r.state}</td>
                  <td style={{ padding: '7px 10px' }}>{r.district}</td>
                  <td style={{ padding: '7px 10px' }}>{r.pincode}</td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button style={C.secBtn} onClick={() => setUploadPreview(null)}>Cancel</button>
              <button style={C.priBtn} onClick={confirmUpload}>✓ Confirm & Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Map Modal */}
      {mapModal !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', maxWidth: '700px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>📍 Pin Location on Map</div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748B' }} onClick={() => setMapModal(null)}>✕</button>
            </div>
            <input id="map-search" placeholder="Search address..." style={{ ...inp(), marginBottom: '10px', width: '100%', boxSizing: 'border-box' }} />
            <div ref={mapRef} style={{ height: '380px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '12px' }}>
              Loading map...
            </div>
            {locations[mapModal.locIndex]?.lat && (
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#16A34A', background: '#DCFCE7', padding: '6px 10px', borderRadius: '6px' }}>
                ✓ Pinned at {locations[mapModal.locIndex].lat}, {locations[mapModal.locIndex].lng}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '8px' }}>
              <button style={C.secBtn} onClick={() => setMapModal(null)}>Cancel</button>
              <button style={C.priBtn} onClick={() => setMapModal(null)}>✓ Confirm Location</button>
            </div>
          </div>
        </div>
      )}

      <div style={C.body}>
        {/* Progress Bar */}
        <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STEPS.map((st, i) => {
              const isDone = i < step, isActive = i === step
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', cursor: isDone ? 'pointer' : 'default' }} onClick={() => isDone && setStep(i)}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', background: isDone ? '#7C3AED' : isActive ? '#EDE9FE' : '#F1F5F9', border: isActive ? '2px solid #7C3AED' : 'none', color: isDone ? '#fff' : '#374151' }}>
                      {isDone ? '✓' : st.icon}
                    </div>
                    <span style={{ fontSize: '9px', color: isActive ? '#7C3AED' : isDone ? '#7C3AED' : '#94A3B8', fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap' }}>{st.label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div style={{ flex: 1, height: '2px', background: isDone ? '#7C3AED' : '#E2E8F0', margin: '0 4px', marginBottom: '14px' }} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* STEP 0: GROUP */}
        {step === 0 && (
          <div style={C.card}>
            <div style={C.secTitle}>🏛️ Group Setup</div>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#1D4ED8' }}>
              💡 Single company? Set Group Name = Company Name. Multiple companies can be consolidated under one group anytime.
            </div>
            <div style={C.g2}>
              <div>
                <label style={C.lbl}>Group Name<span style={C.req}>*</span></label>
                <input style={inp(!!errors.groupName)} value={groupName} onChange={e => { setGroupName(e.target.value); setErrors(p => ({ ...p, groupName: '' })) }} placeholder="e.g. Sharma Group" />
                {errors.groupName && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.groupName}</div>}
              </div>
              <div>
                <label style={C.lbl}>Country</label>
                <input style={{ ...inp(), background: '#F1F5F9', color: '#94A3B8' }} value="India" readOnly />
              </div>
            </div>
            <div style={{ marginTop: '14px' }}>
              <label style={C.lbl}>Group Logo (optional)</label>
              <label style={{ cursor: 'pointer' }}>
                <input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} />
                <div style={uploadBox}>📁 Click to upload (PNG, JPG — max 2MB)</div>
              </label>
            </div>
          </div>
        )}

        {/* STEP 1: COMPANY */}
        {step === 1 && (
          <div style={C.card}>
            <div style={C.secTitle}>🏢 Company Details — <span style={{ color: '#7C3AED', fontSize: '12px' }}>{savedGroup}</span></div>
            <div style={C.g2}>
              <div>
                <label style={C.lbl}>Name of Establishment<span style={C.req}>*</span></label>
                <input style={inp(!!errors.companyName)} value={companyName} onChange={e => { setCompanyName(e.target.value); setErrors(p => ({ ...p, companyName: '' })) }} placeholder="Sharma Sons Private Limited" />
                {errors.companyName && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.companyName}</div>}
              </div>
              <div>
                <label style={C.lbl}>Employer / Director Name<span style={C.req}>*</span></label>
                <input style={inp(!!errors.employerName)} value={employerName} onChange={e => { setEmployerName(e.target.value); setErrors(p => ({ ...p, employerName: '' })) }} placeholder="Ramesh Kumar Sharma" />
                {errors.employerName && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.employerName}</div>}
              </div>
              <div>
                <label style={C.lbl}>Company Type<span style={C.req}>*</span></label>
                <select style={sel(!!errors.companyType)} value={companyType} onChange={e => { setCompanyType(e.target.value); setErrors(p => ({ ...p, companyType: '' })) }}>
                  <option value="">-- Select --</option>
                  {CO_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {errors.companyType && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.companyType}</div>}
              </div>
              <div>
                <label style={C.lbl}>Industry<span style={C.req}>*</span></label>
                <select style={sel(!!errors.industry)} value={industry} onChange={e => { setIndustry(e.target.value); setErrors(p => ({ ...p, industry: '' })) }}>
                  <option value="">-- Select --</option>
                  {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                </select>
                {errors.industry && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.industry}</div>}
              </div>
              <div>
                <label style={C.lbl}>PAN Number<span style={C.req}>*</span></label>
                <input style={inp(!!errors.pan)} value={pan} onChange={e => { setPan(e.target.value.toUpperCase()); setErrors(p => ({ ...p, pan: '' })) }} placeholder="AAAPL1234C" maxLength={10} />
                {errors.pan && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.pan}</div>}
              </div>
              <div>
                <label style={C.lbl}>TAN Number<span style={C.req}>*</span></label>
                <input style={inp(!!errors.tan)} value={tan} onChange={e => { setTan(e.target.value.toUpperCase()); setErrors(p => ({ ...p, tan: '' })) }} placeholder="DELA12345B" maxLength={10} />
                {errors.tan && <div style={{ fontSize: '11px', color: '#DC2626', marginTop: '3px' }}>⚠ {errors.tan}</div>}
              </div>
              <div>
                <label style={C.lbl}>CIN <span style={{ color: '#94A3B8', fontWeight: 400 }}>(Pvt Ltd / Public)</span></label>
                <input style={inp()} value={cin} onChange={e => setCin(e.target.value)} placeholder="U12345MH2020PTC123456" />
              </div>
              <div>
                <label style={C.lbl}>Date of Incorporation</label>
                <input style={inp()} type="date" value={doi} onChange={e => setDoi(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: '16px', borderTop: '1px solid #F1F5F9', paddingTop: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px' }}>Letterhead Setup</div>
              <div style={C.g2}>
                <div>
                  <label style={C.lbl}>Header — Upload Image</label>
                  <label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload Header Image</div></label>
                  <label style={{ ...C.lbl, marginTop: '8px' }}>Or Header Text</label>
                  <textarea style={{ ...inp(), height: '60px', resize: 'none' as any }} value={headerText} onChange={e => setHeaderText(e.target.value)} placeholder="Company Name&#10;Address | Phone | Email" />
                </div>
                <div>
                  <label style={C.lbl}>Footer — Upload Image</label>
                  <label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload Footer Image</div></label>
                  <label style={{ ...C.lbl, marginTop: '8px' }}>Or Footer Text</label>
                  <textarea style={{ ...inp(), height: '60px', resize: 'none' as any }} value={footerText} onChange={e => setFooterText(e.target.value)} placeholder="CIN: XXXXX | PAN: XXXXX | www.company.com" />
                </div>
              </div>
              {(headerText || footerText) && (
                <div style={{ marginTop: '12px', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
                  {headerText && <div style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', padding: '8px 14px', fontSize: '11px', color: '#374151', whiteSpace: 'pre-line' }}>{headerText}</div>}
                  <div style={{ padding: '12px 14px', fontSize: '11px', color: '#94A3B8', textAlign: 'center' }}>[ Letter content will appear here ]</div>
                  {footerText && <div style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0', padding: '8px 14px', fontSize: '10px', color: '#64748B', whiteSpace: 'pre-line', textAlign: 'center' }}>{footerText}</div>}
                </div>
              )}
            </div>
            <div style={{ marginTop: '12px' }}>
              <label style={C.lbl}>Certificate of Incorporation</label>
              <label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload PDF</div></label>
            </div>
          </div>
        )}

        {/* STEP 2: LOCATIONS */}
        {step === 2 && (
          <div style={C.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>📍 Locations / Branches</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={C.xlsBtn} onClick={downloadTemplate}>📥 Template</button>
                <button style={C.upBtn} onClick={() => fileRef.current?.click()}>📤 Upload Excel</button>
              </div>
            </div>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '9px 12px', marginBottom: '14px', fontSize: '11px', color: '#1D4ED8' }}>
              ✦ State + District auto-links PT, ESIC & Shops Act. Google Maps pin captures geo-coordinates for attendance geo-fencing.
            </div>
            {locations.map((loc, i) => (
              <div key={loc.id} style={C.sub}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Location {i + 1}{loc.name ? ` — ${loc.name}` : ''}</span>
                  {i > 0 && <button style={C.rmBtn} onClick={() => setLocations(p => p.filter((_, idx) => idx !== i))}>✕ Remove</button>}
                </div>
                <div style={{ ...C.g3, marginBottom: '10px' }}>
                  <div>
                    <label style={C.lbl}>Location Name<span style={C.req}>*</span></label>
                    <input style={inp(!!errors[`loc_name_${i}`])} value={loc.name} onChange={e => { updateLoc(i, 'name', e.target.value); setErrors(p => ({ ...p, [`loc_name_${i}`]: '' })) }} placeholder="Delhi Head Office" />
                    {errors[`loc_name_${i}`] && <div style={{ fontSize: '10px', color: '#DC2626', marginTop: '2px' }}>⚠ Required</div>}
                  </div>
                  <div>
                    <label style={C.lbl}>Location Type<span style={C.req}>*</span></label>
                    <select style={sel()} value={loc.type} onChange={e => updateLoc(i, 'type', e.target.value)}>
                      {LOC_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={C.lbl}>PIN Code</label>
                    <input style={inp()} value={loc.pincode} onChange={e => updateLoc(i, 'pincode', e.target.value)} placeholder="110001" maxLength={6} />
                  </div>
                </div>
                <div style={{ ...C.g2, marginBottom: '10px' }}>
                  <div>
                    <label style={C.lbl}>State<span style={C.req}>*</span></label>
                    <select style={sel(!!errors[`loc_state_${i}`])} value={loc.state} onChange={e => { updateLoc(i, 'state', e.target.value); setErrors(p => ({ ...p, [`loc_state_${i}`]: '' })) }}>
                      <option value="">-- Select State --</option>
                      {ALL_STATES.map(st => <option key={st}>{st}</option>)}
                    </select>
                    {errors[`loc_state_${i}`] && <div style={{ fontSize: '10px', color: '#DC2626', marginTop: '2px' }}>⚠ Required</div>}
                  </div>
                  <div>
                    <label style={C.lbl}>District<span style={C.req}>*</span></label>
                    <select style={sel(!!errors[`loc_district_${i}`])} value={loc.district} onChange={e => { updateLoc(i, 'district', e.target.value); setErrors(p => ({ ...p, [`loc_district_${i}`]: '' })) }} disabled={!loc.state}>
                      <option value="">-- Select District --</option>
                      {getDistricts(loc.state).map(d => <option key={d}>{d}</option>)}
                    </select>
                    {errors[`loc_district_${i}`] && <div style={{ fontSize: '10px', color: '#DC2626', marginTop: '2px' }}>⚠ Required</div>}
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={C.lbl}>Full Address<span style={C.req}>*</span></label>
                  <input style={inp(!!errors[`loc_address_${i}`])} value={loc.address} onChange={e => { updateLoc(i, 'address', e.target.value); setErrors(p => ({ ...p, [`loc_address_${i}`]: '' })) }} placeholder="Building No., Street, Area, City" />
                  {errors[`loc_address_${i}`] && <div style={{ fontSize: '10px', color: '#DC2626', marginTop: '2px' }}>⚠ Required</div>}
                </div>
                <div style={C.g3}>
                  <div>
                    <label style={C.lbl}>License / Reg. Number</label>
                    <input style={inp()} value={loc.licenseNumber} onChange={e => updateLoc(i, 'licenseNumber', e.target.value)} placeholder="Factory Lic. / S&E No." />
                  </div>
                  <div>
                    <label style={C.lbl}>Pin on Map</label>
                    <button onClick={() => setMapModal({ locIndex: i })} style={{ ...inp(), background: '#EDE9FE', color: '#7C3AED', cursor: 'pointer', border: '1.5px solid #C4B5FD', textAlign: 'center' as any, fontWeight: 500 }}>
                      📍 {loc.lat ? 'Pinned ✓' : 'Open Google Maps'}
                    </button>
                  </div>
                  <div>
                    <label style={C.lbl}>Registration Certificate</label>
                    <label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={{ ...uploadBox, padding: '9px' }}>📄 Upload</div></label>
                  </div>
                </div>
                {loc.lat && <div style={{ marginTop: '6px', fontSize: '11px', color: '#16A34A', background: '#DCFCE7', padding: '5px 10px', borderRadius: '5px' }}>✓ Geo-tagged: {loc.lat}, {loc.lng}</div>}
                {loc.state && loc.district && <div style={{ marginTop: '6px', fontSize: '11px', color: '#1D4ED8', background: '#EFF6FF', padding: '5px 10px', borderRadius: '5px' }}>✦ {loc.state} › {loc.district} — PT & ESIC will auto-link here</div>}
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setLocations(p => [...p, { id: uid(), name: '', type: 'Branch', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }])}>＋ Add Location / Branch</button>
          </div>
        )}

        {/* STEP 3: TAX */}
        {step === 3 && (
          <div style={C.card}>
            <div style={C.secTitle}>🧾 Tax Registrations</div>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>GST Registrations</div>
            {gstList.map((g, i) => (
              <div key={g.id} style={C.sub}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>GST {i + 1}</span>
                  {i > 0 && <button style={C.rmBtn} onClick={() => setGstList(p => p.filter((_, idx) => idx !== i))}>✕</button>}
                </div>
                <div style={C.g2}>
                  <div><label style={C.lbl}>GSTIN</label><input style={inp()} value={g.number} onChange={e => setGstList(p => p.map((x, idx) => idx === i ? { ...x, number: e.target.value.toUpperCase() } : x))} placeholder="27AAAPL1234C1Z5" maxLength={15} /></div>
                  <div>
                    <label style={C.lbl}>State</label>
                    <select style={sel()} value={g.state} onChange={e => setGstList(p => p.map((x, idx) => idx === i ? { ...x, state: e.target.value } : x))}>
                      <option value="">-- Select --</option>
                      {ALL_STATES.map(st => <option key={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>GST Certificate</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setGstList(p => [...p, { id: uid(), number: '', state: '', certificate: '' }])}>＋ Add GST</button>
          </div>
        )}

        {/* STEP 4: LABOUR LAW */}
        {step === 4 && (
          <div style={C.card}>
            <div style={C.secTitle}>⚖️ Labour Law Registrations</div>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>EPF — Employee Provident Fund</div>
            {epfList.map((epf, i) => (
              <div key={epf.id} style={C.sub}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>{i === 0 ? 'Primary EPF Code' : `EPF Code ${i + 1}`}</span>
                  {i > 0 && <button style={C.rmBtn} onClick={() => setEpfList(p => p.filter((_, idx) => idx !== i))}>✕</button>}
                </div>
                <div style={C.g2}>
                  <div><label style={C.lbl}>EPF Registration Number</label><input style={inp()} value={epf.code} onChange={e => setEpfList(p => p.map((x, idx) => idx === i ? { ...x, code: e.target.value } : x))} placeholder="MHBAN1234567000" /></div>
                  <div>
                    <label style={C.lbl}>Coverage</label>
                    <select style={sel()} value={epf.scope} onChange={e => setEpfList(p => p.map((x, idx) => idx === i ? { ...x, scope: e.target.value as any, locations: [] } : x))}>
                      <option value="all">All Locations</option>
                      <option value="specific">Specific Locations</option>
                    </select>
                  </div>
                </div>
                {epf.scope === 'specific' && namedLocs.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <label style={C.lbl}>Select Locations</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                      {namedLocs.map(loc => (
                        <label key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', cursor: 'pointer', padding: '5px 9px', borderRadius: '6px', background: epf.locations.includes(loc.name) ? '#EDE9FE' : '#F1F5F9', border: `1px solid ${epf.locations.includes(loc.name) ? '#C4B5FD' : '#E2E8F0'}` }}>
                          <input type="checkbox" checked={epf.locations.includes(loc.name)} onChange={() => toggleEpfLoc(i, loc.name)} style={{ width: '13px', height: '13px' }} />
                          {loc.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '8px' }}>
                  <label style={C.lbl}>Department Address for Filing</label>
                  <input style={inp()} value={epf.deptAddress} onChange={e => setEpfList(p => p.map((x, idx) => idx === i ? { ...x, deptAddress: e.target.value } : x))} placeholder="Address used in EPF returns and challans" />
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>EPF Certificate</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setEpfList(p => [...p, { id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])}>＋ Add EPF Code</button>

            <div style={{ fontSize: '12px', fontWeight: 600, margin: '16px 0 6px', color: '#374151' }}>ESIC — Employee State Insurance</div>
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '7px', padding: '8px 11px', marginBottom: '10px', fontSize: '11px', color: '#92400E' }}>
              ⚠️ ESIC is State + District specific. Select district — locations auto-link. Add main code first, then sub-codes.
            </div>
            {esicList.map((esic, i) => (
              <div key={esic.id} style={C.sub}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>{esic.type === 'main' ? '🔑 Main ESIC Code' : `📍 Sub Code ${i}`}</span>
                  {i > 0 && <button style={C.rmBtn} onClick={() => setEsicList(p => p.filter((_, idx) => idx !== i))}>✕</button>}
                </div>
                <div style={C.g3}>
                  <div><label style={C.lbl}>ESIC Code</label><input style={inp()} value={esic.code} onChange={e => updateEsic(i, 'code', e.target.value)} placeholder="41000000000000000" /></div>
                  <div>
                    <label style={C.lbl}>State</label>
                    <select style={sel()} value={esic.state} onChange={e => updateEsic(i, 'state', e.target.value)}>
                      <option value="">-- Select --</option>
                      {ALL_STATES.map(st => <option key={st}>{st}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={C.lbl}>District</label>
                    <select style={sel()} value={esic.district} onChange={e => updateEsic(i, 'district', e.target.value)} disabled={!esic.state}>
                      <option value="">-- Select --</option>
                      {getDistricts(esic.state).map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                {esic.locations.length > 0 && <div style={{ marginTop: '6px', fontSize: '11px', color: '#16A34A', background: '#DCFCE7', padding: '5px 10px', borderRadius: '5px' }}>✓ Auto-linked: {esic.locations.join(', ')}</div>}
                {namedLocs.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <label style={C.lbl}>Override — Select Specific Locations</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {namedLocs.map(loc => (
                        <label key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', background: esic.locations.includes(loc.name) ? '#EDE9FE' : '#F1F5F9', border: `1px solid ${esic.locations.includes(loc.name) ? '#C4B5FD' : '#E2E8F0'}` }}>
                          <input type="checkbox" checked={esic.locations.includes(loc.name)} onChange={e => setEsicList(p => p.map((x, idx) => idx === i ? { ...x, locations: e.target.checked ? [...x.locations.filter(l => l !== loc.name), loc.name] : x.locations.filter(l => l !== loc.name) } : x))} style={{ width: '12px', height: '12px' }} />
                          {loc.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '8px' }}>
                  <label style={C.lbl}>Department Address for Filing</label>
                  <input style={inp()} value={esic.deptAddress} onChange={e => setEsicList(p => p.map((x, idx) => idx === i ? { ...x, deptAddress: e.target.value } : x))} placeholder="Address used in ESIC returns" />
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>ESIC Certificate</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setEsicList(p => [...p, { id: uid(), code: '', type: 'sub', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])}>＋ Add ESIC Code</button>

            <div style={{ fontSize: '12px', fontWeight: 600, margin: '16px 0 6px', color: '#374151' }}>Professional Tax (PT)</div>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '7px', padding: '8px 11px', marginBottom: '10px', fontSize: '11px', color: '#1D4ED8' }}>
              ℹ️ PT is State + District level. One registration covers ALL locations in the same district. Applicable in 22 states only.
            </div>
            {ptList.map((pt, i) => (
              <div key={pt.id} style={C.sub}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>PT Registration {i + 1}</span>
                  {i > 0 && <button style={C.rmBtn} onClick={() => setPtList(p => p.filter((_, idx) => idx !== i))}>✕</button>}
                </div>
                <div style={C.g3}>
                  <div><label style={C.lbl}>PT Reg. Number</label><input style={inp()} value={pt.regNumber} onChange={e => setPtList(p => p.map((x, idx) => idx === i ? { ...x, regNumber: e.target.value } : x))} placeholder="MH/PT/MUM/2020/001" /></div>
                  <div>
                    <label style={C.lbl}>State <span style={{ fontSize: '9px', color: '#94A3B8' }}>(22 applicable)</span></label>
                    <select style={sel()} value={pt.state} onChange={e => updatePT(i, 'state', e.target.value)}>
                      <option value="">-- Select --</option>
                      {PT_STATES.map(st => <option key={st}>{st}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={C.lbl}>District</label>
                    <select style={sel()} value={pt.district} onChange={e => updatePT(i, 'district', e.target.value)} disabled={!pt.state}>
                      <option value="">-- Select --</option>
                      {getDistricts(pt.state).map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                {pt.state && pt.district && (
                  <div style={{ marginTop: '6px', fontSize: '11px', padding: '5px 10px', borderRadius: '5px', background: pt.coveredLocations.length ? '#DCFCE7' : '#FEF3C7', color: pt.coveredLocations.length ? '#16A34A' : '#92400E' }}>
                    {pt.coveredLocations.length ? `✓ Auto-covers: ${pt.coveredLocations.join(', ')}` : `⚠️ No locations in ${pt.district}, ${pt.state}`}
                  </div>
                )}
                <div style={{ marginTop: '8px' }}>
                  <label style={C.lbl}>Department Address for Filing</label>
                  <input style={inp()} value={pt.deptAddress} onChange={e => setPtList(p => p.map((x, idx) => idx === i ? { ...x, deptAddress: e.target.value } : x))} placeholder="Address used in PT returns and challans" />
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>PT Certificate</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setPtList(p => [...p, { id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])}>＋ Add PT Registration</button>

            <div style={{ marginTop: '16px', borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                <input type="checkbox" checked={lwf} onChange={e => setLwf(e.target.checked)} style={{ width: '14px', height: '14px' }} />
                Labour Welfare Fund (LWF) Applicable
              </label>
              {lwf && (
                <div style={{ ...C.sub, marginTop: '10px' }}>
                  <label style={C.lbl}>LWF Applicable States</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {ALL_STATES.map(st => (
                      <label key={st} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', background: lwfStates.includes(st) ? '#EDE9FE' : '#F1F5F9', border: `1px solid ${lwfStates.includes(st) ? '#C4B5FD' : '#E2E8F0'}` }}>
                        <input type="checkbox" checked={lwfStates.includes(st)} onChange={e => setLwfStates(p => e.target.checked ? [...p, st] : p.filter(s => s !== st))} style={{ width: '12px', height: '12px' }} />
                        {st}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: BANK */}
        {step === 5 && (
          <div style={C.card}>
            <div style={C.secTitle}>🏦 Bank Accounts</div>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#374151' }}>Operating / General Account</div>
            <div style={C.sub}>
              <div style={C.g2}>
                <div><label style={C.lbl}>Bank Name</label><input style={inp()} value={opBank.bankName} onChange={e => setOpBank({ ...opBank, bankName: e.target.value })} placeholder="HDFC Bank" /></div>
                <div><label style={C.lbl}>Account Type</label><select style={sel()} value={opBank.accountType} onChange={e => setOpBank({ ...opBank, accountType: e.target.value })}><option>Current</option><option>Savings</option><option>Cash Credit</option></select></div>
                <div><label style={C.lbl}>Account Number</label><input style={inp()} value={opBank.accountNumber} onChange={e => setOpBank({ ...opBank, accountNumber: e.target.value })} placeholder="1234567890123456" /></div>
                <div><label style={C.lbl}>IFSC Code</label><input style={inp()} value={opBank.ifsc} onChange={e => setOpBank({ ...opBank, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" maxLength={11} /></div>
              </div>
              <div style={{ marginTop: '10px' }}><label style={C.lbl}>Cancelled Cheque</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📷 Upload</div></label></div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Salary Disbursement Account</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#64748B', cursor: 'pointer' }}>
                <input type="checkbox" checked={sameBank} onChange={e => setSameBank(e.target.checked)} />
                Same as Operating Account
              </label>
            </div>

            {!sameBank ? (
              <div style={C.sub}>
                <div style={{ background: '#EDE9FE', borderRadius: '6px', padding: '7px 10px', marginBottom: '10px', fontSize: '11px', color: '#7C3AED' }}>
                  ✦ Monthly salary NEFT/RTGS payments will be processed from this account
                </div>
                <div style={C.g2}>
                  <div><label style={C.lbl}>Bank Name</label><input style={inp()} value={salBank.bankName} onChange={e => setSalBank({ ...salBank, bankName: e.target.value })} placeholder="ICICI Bank" /></div>
                  <div><label style={C.lbl}>Account Type</label><select style={sel()} value={salBank.accountType} onChange={e => setSalBank({ ...salBank, accountType: e.target.value })}><option>Current</option><option>Savings</option></select></div>
                  {/* ✅ BUG FIXED: accountNumber (not account) */}
                  <div><label style={C.lbl}>Account Number</label><input style={inp()} value={salBank.accountNumber} onChange={e => setSalBank({ ...salBank, accountNumber: e.target.value })} placeholder="9876543210987654" /></div>
                  <div><label style={C.lbl}>IFSC Code</label><input style={inp()} value={salBank.ifsc} onChange={e => setSalBank({ ...salBank, ifsc: e.target.value.toUpperCase() })} placeholder="ICIC0001234" maxLength={11} /></div>
                </div>
                <div style={{ marginTop: '10px' }}><label style={C.lbl}>Cancelled Cheque</label><label style={{ cursor: 'pointer' }}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{ display: 'none' }} /><div style={uploadBox}>📷 Upload</div></label></div>
              </div>
            ) : (
              <div style={{ background: '#DCFCE7', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#16A34A' }}>
                ✓ Salary will be disbursed from the Operating Account
              </div>
            )}
          </div>
        )}

        {/* STEP 6: LICENSE */}
        {step === 6 && (
          <div style={C.card}>
            <div style={C.secTitle}>📋 License & Billing Plan</div>
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#92400E' }}>
              ⚠️ Set this as per client agreement. Employee & location limits will be enforced. If limit is exceeded, system will alert and block further additions.
            </div>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              {PLANS.map(p => (
                <div key={p} onClick={() => setLicense(prev => ({
                  ...prev, plan: p,
                  maxEmployees: p === 'Starter' ? '50' : p === 'Growth' ? '200' : 'Unlimited',
                  maxLocations: p === 'Starter' ? '5' : p === 'Growth' ? '20' : 'Unlimited'
                }))} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: `2px solid ${license.plan === p ? '#7C3AED' : '#E2E8F0'}`, background: license.plan === p ? '#EDE9FE' : '#fff', cursor: 'pointer', textAlign: 'center' as any }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: license.plan === p ? '#7C3AED' : '#374151' }}>{p}</div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                    {p === 'Starter' ? 'Up to 50 employees' : p === 'Growth' ? 'Up to 200 employees' : 'Unlimited employees'}
                  </div>
                </div>
              ))}
            </div>
            <div style={C.g2}>
              <div><label style={C.lbl}>Max Employees<span style={C.req}>*</span></label><input style={inp()} value={license.maxEmployees} onChange={e => setLicense(prev => ({ ...prev, maxEmployees: e.target.value }))} placeholder="e.g. 200" /></div>
              <div><label style={C.lbl}>Max Locations<span style={C.req}>*</span></label><input style={inp()} value={license.maxLocations} onChange={e => setLicense(prev => ({ ...prev, maxLocations: e.target.value }))} placeholder="e.g. 20" /></div>
              <div><label style={C.lbl}>License Valid From<span style={C.req}>*</span></label><input style={inp()} type="date" value={license.validFrom} onChange={e => setLicense(prev => ({ ...prev, validFrom: e.target.value }))} /></div>
              <div><label style={C.lbl}>License Valid Till<span style={C.req}>*</span></label><input style={inp()} type="date" value={license.validTill} onChange={e => setLicense(prev => ({ ...prev, validTill: e.target.value }))} /></div>
              <div><label style={C.lbl}>Annual Cost (₹)<span style={C.req}>*</span></label><input style={inp()} value={license.annualCost} onChange={e => setLicense(prev => ({ ...prev, annualCost: e.target.value }))} placeholder="e.g. 155988" /></div>
              <div><label style={C.lbl}>Billing Cycle</label><select style={sel()} value={license.billingCycle} onChange={e => setLicense(prev => ({ ...prev, billingCycle: e.target.value }))}><option>Monthly</option><option>Quarterly</option><option>Annual</option></select></div>
            </div>
            {license.validFrom && license.validTill && license.annualCost && (
              <div style={{ marginTop: '14px', background: '#DCFCE7', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', color: '#16A34A' }}>
                ✓ {license.plan} Plan | {license.maxEmployees} employees | {license.maxLocations} locations | ₹{Number(license.annualCost).toLocaleString('en-IN')}/year | Valid: {license.validFrom} to {license.validTill}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
          <button style={{ ...C.secBtn, opacity: step === 0 ? 0.4 : 1 }} onClick={() => step > 0 && setStep(s => s - 1)} disabled={step === 0}>← Back</button>
          <span style={{ fontSize: '11px', color: '#94A3B8' }}>Step {step + 1} of {STEPS.length} {Object.keys(errors).length > 0 ? '— ⚠️ Fix errors above' : ''}</span>
          <button style={C.priBtn} onClick={goNext}>{step === STEPS.length - 1 ? '✓ Complete Setup' : 'Next →'}</button>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════
//  MASTER SETUP COMPONENT
// ═══════════════════════════════════════════════
function MasterSetupTab() {
  const [categories, setCategories] = useState<Category[]>([])
  const [types, setTypes] = useState<MasterType[]>([])
  const [values, setValues] = useState<MasterValue[]>([])
  const [selCat, setSelCat] = useState<Category | null>(null)
  const [selType, setSelType] = useState<MasterType | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // Forms
  const [showValueForm, setShowValueForm] = useState(false)
  const [showTypeForm, setShowTypeForm] = useState(false)
  const [editValue, setEditValue] = useState<MasterValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Value form state
  const [vf, setVf] = useState({ code:'', label:'', description:'', color:'#7C3AED', sort_order:0, extra_data:'{}' })

  // Type form state
  const [tf, setTf] = useState({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false, is_system:false })

  // Load categories on mount
  useEffect(() => { getCategories().then(setCategories) }, [])

  // Load types when category changes
  useEffect(() => {
    if (!selCat) return
    setSelType(null); setValues([])
    getTypes(selCat.id).then(setTypes)
  }, [selCat])

  // Load values when type changes
  useEffect(() => {
    if (!selType) return
    setLoading(true)
    getValues(selType.id).then(v => { setValues(v); setLoading(false) })
  }, [selType])

  const openAddValue = () => {
    setEditValue(null)
    setVf({ code:'', label:'', description:'', color:'#7C3AED', sort_order: values.length + 1, extra_data:'{}' })
    setError(''); setShowValueForm(true)
  }

  const openEditValue = (v: MasterValue) => {
    setEditValue(v)
    setVf({ code: v.code, label: v.label, description: v.description||'', color: v.color||'#7C3AED', sort_order: v.sort_order, extra_data: v.extra_data ? JSON.stringify(v.extra_data, null, 2) : '{}' })
    setError(''); setShowValueForm(true)
  }

  const handleSaveValue = async () => {
    if (!vf.code.trim() || !vf.label.trim()) { setError('Code aur Label required hain'); return }
    setSaving(true); setError('')
    try {
      let extra = null
      if (selType?.has_extra_data && vf.extra_data) {
        try { extra = JSON.parse(vf.extra_data) } catch { setError('Extra Data valid JSON nahi hai'); setSaving(false); return }
      }
      const payload: any = {
        ...(editValue ? { id: editValue.id } : {}),
        type_id: selType!.id,
        code: vf.code.toUpperCase().trim(),
        label: vf.label.trim(),
        description: vf.description.trim() || null,
        color: selType?.has_color ? vf.color : null,
        sort_order: vf.sort_order,
        extra_data: extra,
        is_active: true,
        is_system: false,
      }
      const { error: err } = await saveValue(payload)
      if (err) throw err
      const fresh = await getValues(selType!.id)
      setValues(fresh); setShowValueForm(false)
    } catch (e: any) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleToggle = async (v: MasterValue) => {
    if (v.is_system && v.is_active) { setError('System values disable nahi ho sakte'); return }
    await toggleActive(v.id, !v.is_active)
    const fresh = await getValues(selType!.id)
    setValues(fresh)
  }

  const handleSaveType = async () => {
    if (!tf.code.trim() || !tf.name.trim()) { setError('Code aur Name required'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await saveType({ ...tf, code: tf.code.toLowerCase().trim(), category_id: selCat!.id, sort_order: types.length + 1, is_active: true })
      if (err) throw err
      const fresh = await getTypes(selCat!.id)
      setTypes(fresh); setShowTypeForm(false)
      setTf({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false, is_system:false })
    } catch (e: any) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const filteredValues = values.filter(v => {
    const match = !search || v.label.toLowerCase().includes(search.toLowerCase()) || v.code.toLowerCase().includes(search.toLowerCase())
    const active = showInactive ? true : v.is_active
    return match && active
  })

  // Modal wrapper
  const Modal = ({ title, onClose, children, onSave, saveLabel='Save' }: any) => (
    <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'#fff', borderRadius:'14px', padding:'24px', width:'520px', maxHeight:'85vh', overflowY:'auto' as const, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
          <div style={{ fontSize:'15px', fontWeight:600 }}>{title}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:'20px', cursor:'pointer', color:'#94A3B8' }}>✕</button>
        </div>
        {error && <div style={{ padding:'8px 12px', background:'#FEE2E2', borderRadius:'8px', fontSize:'12px', color:'#DC2626', marginBottom:'12px' }}>⚠️ {error}</div>}
        {children}
        <div style={{ display:'flex', gap:'8px', marginTop:'16px' }}>
          <button style={{ ...C.priBtn, flex:1, opacity: saving ? 0.7:1 }} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : saveLabel}</button>
          <button style={MC.secBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )

  const Fld = ({ label, req, children }: any) => (
    <div style={{ marginBottom:'12px' }}>
      <label style={MC.lbl}>{label}{req && <span style={{ color:'#DC2626' }}> *</span>}</label>
      {children}
    </div>
  )

  return (
    <div style={MC.page}>

      {/* Left Sidebar */}
      <div style={MC.sidebar}>
        <div style={{ padding:'14px 16px', borderBottom:'1px solid #E2E8F0', background:'#1E1B4B' }}>
          <div style={{ fontSize:'13px', fontWeight:600, color:'#fff' }}>⚙️ Master Setup</div>
          <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.5)', marginTop:'2px' }}>Select category → type → manage values</div>
        </div>

        <div style={{ flex:1, overflowY:'auto' as const, padding:'8px 0' }}>
          {categories.map(cat => (
            <div key={cat.id}>
              <button
                onClick={() => { setSelCat(cat); setSearch('') }}
                style={{
                  width:'100%', padding:'10px 14px', border:'none', background: selCat?.id===cat.id ? '#EDE9FE' : 'transparent',
                  cursor:'pointer', textAlign:'left' as const, display:'flex', alignItems:'center', gap:'8px',
                  borderLeft: selCat?.id===cat.id ? '3px solid #7C3AED' : '3px solid transparent',
                }}
              >
                <span style={{ fontSize:'16px' }}>{cat.icon}</span>
                <span style={{ fontSize:'12px', fontWeight: selCat?.id===cat.id ? 600 : 400, color: selCat?.id===cat.id ? '#7C3AED' : '#374151' }}>{cat.name}</span>
              </button>

              {/* Sub types under selected category */}
              {selCat?.id===cat.id && types.map(tp => (
                <button
                  key={tp.id}
                  onClick={() => { setSelType(tp); setSearch('') }}
                  style={{
                    width:'100%', padding:'7px 14px 7px 36px', border:'none',
                    background: selType?.id===tp.id ? '#F5F3FF' : 'transparent',
                    cursor:'pointer', textAlign:'left' as const,
                    fontSize:'11px', color: selType?.id===tp.id ? '#7C3AED' : '#64748B',
                    fontWeight: selType?.id===tp.id ? 500 : 400,
                    borderLeft: selType?.id===tp.id ? '3px solid #A78BFA' : '3px solid transparent',
                  }}
                >
                  {tp.name}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Add new master type button */}
        {selCat && (
          <div style={{ padding:'12px', borderTop:'1px solid #E2E8F0' }}>
            <button style={{ ...C.priBtn, width:'100%', fontSize:'11px' }} onClick={() => { setError(''); setShowTypeForm(true) }}>
              + Add New Master Type
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={MC.main}>
        <div style={MC.topbar}>
          <div>
            <div style={{ fontSize:'14px', fontWeight:600 }}>
              {selType ? selType.name : selCat ? selCat.name : 'Master Setup'}
            </div>
            <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>
              {selType ? `${filteredValues.length} values · ${selType.description || ''}` : selCat ? 'Left mein master type select karo' : 'Left mein category select karo'}
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            {selType && (
              <>
                <input
                  style={{ ...C.inp, width:'200px' }}
                  placeholder="Search values..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <label style={{ fontSize:'11px', color:'#64748B', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show Disabled
                </label>
                <button style={MC.priBtn} onClick={openAddValue}>+ Add Value</button>
              </>
            )}
          </div>
        </div>

        <div style={MC.body}>

          {/* No selection state */}
          {!selCat && (
            <div style={{ textAlign:'center' as const, padding:'60px 20px', color:'#94A3B8' }}>
              <div style={{ fontSize:'40px', marginBottom:'12px' }}>⚙️</div>
              <div style={{ fontSize:'16px', fontWeight:500, marginBottom:'6px', color:'#374151' }}>Master Setup</div>
              <div style={{ fontSize:'13px' }}>Left mein category select karo — phir master type choose karo</div>
            </div>
          )}

          {/* Category selected but no type */}
          {selCat && !selType && types.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'10px' }}>
              {types.map(tp => (
                <div
                  key={tp.id}
                  onClick={() => setSelType(tp)}
                  style={{ ...C.card, cursor:'pointer', borderLeft:'3px solid #7C3AED', ':hover':{ background:'#F5F3FF' } } as any}
                >
                  <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'4px' }}>{tp.name}</div>
                  <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'8px' }}>{tp.description || ''}</div>
                  <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' as const }}>
                    {tp.has_color && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'4px' }}>Color</span>}
                    {tp.has_code && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#DBEAFE', color:'#1D4ED8', borderRadius:'4px' }}>Code</span>}
                    {tp.has_parent && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#DCFCE7', color:'#16A34A', borderRadius:'4px' }}>Hierarchy</span>}
                    {tp.has_extra_data && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#FEF3C7', color:'#D97706', borderRadius:'4px' }}>Extra Fields</span>}
                    {tp.is_system && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#F1F5F9', color:'#374151', borderRadius:'4px' }}>System</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Values list */}
          {selType && (
            <div style={MC.card}>
              {/* Stats bar */}
              <div style={{ display:'flex', gap:'16px', marginBottom:'14px', padding:'10px 14px', background:'#F8FAFC', borderRadius:'8px' }}>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Total: <strong style={{ color:'#374151' }}>{values.length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Active: <strong style={{ color:'#16A34A' }}>{values.filter(v=>v.is_active).length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Disabled: <strong style={{ color:'#DC2626' }}>{values.filter(v=>!v.is_active).length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>System: <strong style={{ color:'#7C3AED' }}>{values.filter(v=>v.is_system).length}</strong></span>
              </div>

              {loading ? (
                <div style={{ padding:'40px', textAlign:'center' as const, color:'#94A3B8' }}>⏳ Loading...</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                  <thead>
                    <tr style={{ background:'#1E1B4B' }}>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'40px' }}>Order</th>
                      {selType.has_color && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'60px' }}>Color</th>}
                      {selType.has_code && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'120px' }}>Code</th>}
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px' }}>Label</th>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px' }}>Description</th>
                      {selType.has_extra_data && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'80px' }}>Extra Data</th>}
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'80px' }}>Status</th>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'120px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredValues.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding:'30px', textAlign:'center' as const, color:'#94A3B8' }}>
                        {search ? 'No values match search' : 'No values yet · Click + Add Value'}
                      </td></tr>
                    ) : filteredValues.map((v, i) => (
                      <tr key={v.id} style={{ background: !v.is_active ? '#FEF2F2' : i%2===0 ? '#F8FAFC' : '#fff', borderBottom:'1px solid #E2E8F0', opacity: v.is_active ? 1 : 0.6 }}>
                        <td style={{ padding:'8px 10px', color:'#94A3B8', textAlign:'center' as const }}>{v.sort_order}</td>
                        {selType.has_color && (
                          <td style={{ padding:'8px 10px' }}>
                            {v.color && <div style={{ width:'22px', height:'22px', borderRadius:'50%', background:v.color, display:'inline-block', border:'2px solid rgba(0,0,0,0.1)' }}/>}
                          </td>
                        )}
                        {selType.has_code && (
                          <td style={{ padding:'8px 10px' }}>
                            <span style={{ padding:'2px 7px', background: v.color||'#EDE9FE', color:'#fff', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{v.code}</span>
                          </td>
                        )}
                        <td style={{ padding:'8px 10px', fontWeight:500 }}>{v.label}</td>
                        <td style={{ padding:'8px 10px', color:'#64748B', fontSize:'11px' }}>{v.description||'—'}</td>
                        {selType.has_extra_data && (
                          <td style={{ padding:'8px 10px' }}>
                            {v.extra_data && <button onClick={() => alert(JSON.stringify(v.extra_data, null, 2))} style={{ padding:'2px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View</button>}
                          </td>
                        )}
                        <td style={{ padding:'8px 10px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:500, background: v.is_active ? '#DCFCE7':'#FEE2E2', color: v.is_active ? '#16A34A':'#DC2626' }}>
                            {v.is_active ? 'Active' : 'Disabled'}
                          </span>
                          {v.is_system && <span style={{ marginLeft:'4px', padding:'1px 5px', background:'#F1F5F9', color:'#64748B', borderRadius:'4px', fontSize:'9px' }}>System</span>}
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <div style={{ display:'flex', gap:'4px' }}>
                            <button onClick={() => openEditValue(v)} style={{ padding:'4px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>✏️ Edit</button>
                            <button onClick={() => handleToggle(v)} disabled={v.is_system && v.is_active} style={{ padding:'4px 8px', border:'none', borderRadius:'5px', cursor: v.is_system && v.is_active ? 'not-allowed':'pointer', fontSize:'10px', background: v.is_active ? '#FEE2E2':'#DCFCE7', color: v.is_active ? '#DC2626':'#16A34A', opacity: v.is_system && v.is_active ? 0.4:1 }}>
                              {v.is_active ? '🔴 Disable' : '🟢 Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ADD/EDIT VALUE MODAL ─────────────────────────────────────── */}
      {showValueForm && selType && (
        <Modal title={editValue ? `✏️ Edit — ${editValue.label}` : `+ Add New Value — ${selType.name}`} onClose={() => setShowValueForm(false)} onSave={handleSaveValue} saveLabel={editValue ? 'Update Value' : 'Add Value'}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            {selType.has_code && (
              <Fld label="Code" req>
                <input style={{ ...C.inp, fontFamily:'monospace', textTransform:'uppercase' as const }} placeholder="e.g. NAUKRI" value={vf.code} onChange={e => setVf(v => ({ ...v, code: e.target.value.toUpperCase() }))} disabled={!!editValue?.is_system} />
              </Fld>
            )}
            <Fld label="Label" req>
              <input style={MC.inp} placeholder="Display name" value={vf.label} onChange={e => setVf(v => ({ ...v, label: e.target.value }))} />
            </Fld>
          </div>
          <Fld label="Description">
            <input style={MC.inp} placeholder="Optional description" value={vf.description} onChange={e => setVf(v => ({ ...v, description: e.target.value }))} />
          </Fld>
          {selType.has_color && (
            <Fld label="Color">
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' as const, marginTop:'4px' }}>
                {COLORS.map(col => (
                  <div key={col} onClick={() => setVf(v => ({ ...v, color: col }))}
                    style={{ width:'28px', height:'28px', borderRadius:'50%', background:col, cursor:'pointer', border: vf.color===col ? '3px solid #0F172A' : '2px solid transparent', boxShadow: vf.color===col ? '0 0 0 2px #fff inset' : 'none' }} />
                ))}
                <input type="color" value={vf.color} onChange={e => setVf(v => ({ ...v, color: e.target.value }))} style={{ width:'28px', height:'28px', border:'none', cursor:'pointer', borderRadius:'50%', padding:0 }} title="Custom color" />
              </div>
            </Fld>
          )}
          <Fld label="Sort Order">
            <input type="number" style={MC.inp} value={vf.sort_order} onChange={e => setVf(v => ({ ...v, sort_order: parseInt(e.target.value)||0 }))} />
          </Fld>
          {selType.has_extra_data && selType.extra_schema && (
            <div style={{ marginBottom:'12px' }}>
              <label style={MC.lbl}>Extra Fields (as per schema)</label>
              <div style={{ padding:'8px 12px', background:'#EDE9FE', borderRadius:'8px', fontSize:'11px', color:'#7C3AED', marginBottom:'8px' }}>
                Fields: {Object.keys(selType.extra_schema).map((k: string) => `${k} (${selType.extra_schema[k]?.label})`).join(' · ')}
              </div>
              <textarea style={{ ...C.inp, height:'100px', resize:'vertical' as const, fontFamily:'monospace', fontSize:'11px' }}
                value={vf.extra_data} onChange={e => setVf(v => ({ ...v, extra_data: e.target.value }))}
                placeholder='{"key": "value"}'
              />
            </div>
          )}
          {editValue?.is_system && (
            <div style={{ padding:'8px 12px', background:'#FEF3C7', borderRadius:'8px', fontSize:'11px', color:'#D97706' }}>
              ⚠️ System value — sirf Label aur Description edit ho sakti hai
            </div>
          )}
        </Modal>
      )}

      {/* ── ADD NEW MASTER TYPE MODAL ────────────────────────────────── */}
      {showTypeForm && selCat && (
        <Modal title={`+ New Master Type — ${selCat.name}`} onClose={() => setShowTypeForm(false)} onSave={handleSaveType} saveLabel="Create Master Type">
          <div style={{ padding:'8px 12px', background:'#DBEAFE', borderRadius:'8px', fontSize:'11px', color:'#1D4ED8', marginBottom:'12px' }}>
            💡 New master type create hone ke baad usme values add kar sakte ho. Ye master type phir sab forms mein available hoga.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <Fld label="Code (unique)" req>
              <input style={{ ...C.inp, fontFamily:'monospace' }} placeholder="e.g. my_master" value={tf.code} onChange={e => setTf(t => ({ ...t, code: e.target.value.toLowerCase().replace(/\s/g,'_') }))} />
            </Fld>
            <Fld label="Name" req>
              <input style={MC.inp} placeholder="e.g. My Master Name" value={tf.name} onChange={e => setTf(t => ({ ...t, name: e.target.value }))} />
            </Fld>
          </div>
          <Fld label="Description">
            <input style={MC.inp} placeholder="What is this master used for?" value={tf.description} onChange={e => setTf(t => ({ ...t, description: e.target.value }))} />
          </Fld>
          <div style={{ marginBottom:'12px' }}>
            <label style={MC.lbl}>Features</label>
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' as const }}>
              {[
                { key:'has_code', label:'Has Code (short identifier)' },
                { key:'has_color', label:'Has Color (for visual tags)' },
                { key:'has_parent', label:'Has Parent (hierarchy)' },
                { key:'has_extra_data', label:'Has Extra Fields (JSONB)' },
              ].map(f => (
                <label key={f.key} style={{ display:'flex', gap:'6px', alignItems:'center', fontSize:'12px', cursor:'pointer' }}>
                  <input type="checkbox" checked={(tf as any)[f.key]} onChange={e => setTf(t => ({ ...t, [f.key]: e.target.checked }))} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════
//  ADMIN PAGE — Main Export (Tabs)
// ═══════════════════════════════════════════════
export default function AdminPage() {
  const [tab, setTab] = useState<'company' | 'master'>('company')
  return (
    <div style={{ minHeight: '100vh', background: '#F0F4F8', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1E1B4B', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>Admin Setup</div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>Company Configuration · Master Data · ezerhrms.com</div>
        </div>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Sharma Group</div>
      </div>
      {/* Tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E2E8F0', padding: '0 24px', display: 'flex' }}>
        {[
          { id: 'company', label: '🔧 Company Setup', desc: 'New company onboard karo — 7 step wizard' },
          { id: 'master',  label: '⚙️ Master Setup',  desc: 'Dropdowns manage karo — Add/Edit/Disable' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ padding: '13px 20px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
              borderBottom: tab === t.id ? '2.5px solid #7C3AED' : '2.5px solid transparent' }}>
            <div style={{ fontSize: '13px', fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#7C3AED' : '#64748B' }}>{t.label}</div>
            <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '1px' }}>{t.desc}</div>
          </button>
        ))}
      </div>
      {/* Content */}
      <div>
        {tab === 'company' && <CompanySetupTab />}
        {tab === 'master'  && <MasterSetupTab />}
      </div>
    </div>
  )
}