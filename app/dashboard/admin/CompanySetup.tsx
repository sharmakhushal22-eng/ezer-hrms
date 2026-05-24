'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { ALL_STATES, PT_STATES, getDistricts } from '../../../lib/states-districts'

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

// ── Styles ─────────────────────────────────────────────────
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

const sel = (err?: boolean): React.CSSProperties => ({
  ...inp(err), appearance: 'auto' as any
})

const uploadBox: React.CSSProperties = {
  border: '2px dashed #E2E8F0', borderRadius: '8px', padding: '10px',
  textAlign: 'center', cursor: 'pointer', color: '#94A3B8', fontSize: '11px'
}

export default function AdminSetup() {
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

  // Group
  const [groupName, setGroupName] = useState('')

  // Company Basic
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

  // Locations
  const [locations, setLocations] = useState<Location[]>([
    { id: uid(), name: '', type: 'Head Office', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }
  ])

  // Tax
  const [gstList, setGstList] = useState<GSTReg[]>([{ id: uid(), number: '', state: '', certificate: '' }])

  // Labour
  const [epfList, setEpfList] = useState<EPFReg[]>([{ id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])
  const [esicList, setEsicList] = useState<ESICReg[]>([{ id: uid(), code: '', type: 'main', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])
  const [ptList, setPtList] = useState<PTReg[]>([{ id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])
  const [lwf, setLwf] = useState(false)
  const [lwfStates, setLwfStates] = useState<string[]>([])

  // Bank
  const [opBank, setOpBank] = useState<BankAccount>({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
  const [salBank, setSalBank] = useState<BankAccount>({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
  const [sameBank, setSameBank] = useState(false)

  // License
  const [license, setLicense] = useState<LicensePlan>({ plan: 'Growth', maxEmployees: '200', maxLocations: '20', validFrom: '', validTill: '', annualCost: '', billingCycle: 'Annual' })

  const namedLocs = locations.filter(l => l.name)

  // ── Validation ─────────────────────────────────────────
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
    else {
      setDone(true)
    }
  }

  // ── Location helpers ─────────────────────────────────────
  const updateLoc = (i: number, f: keyof Location, v: string) => {
    setLocations(p => p.map((l, idx) => idx === i ? { ...l, [f]: v, ...(f === 'state' ? { district: '' } : {}) } : l))
  }

  // ── EPF helpers ──────────────────────────────────────────
  const toggleEpfLoc = (i: number, locName: string) => {
    setEpfList(p => p.map((e, idx) => idx === i ? {
      ...e, locations: e.locations.includes(locName) ? e.locations.filter(l => l !== locName) : [...e.locations, locName]
    } : e))
  }

  // ── ESIC helpers ─────────────────────────────────────────
  const updateEsic = (i: number, f: keyof ESICReg, v: string) => {
    setEsicList(p => p.map((e, idx) => idx === i ? {
      ...e, [f]: v,
      ...(f === 'state' ? { district: '', locations: [] } : {}),
      ...(f === 'district' ? { locations: locations.filter(l => l.state === esicList[i].state && l.district === v).map(l => l.name) } : {})
    } : e))
  }

  // ── PT helpers ───────────────────────────────────────────
  const updatePT = (i: number, f: keyof PTReg, v: string) => {
    setPtList(p => p.map((pt, idx) => idx === i ? {
      ...pt, [f]: v,
      ...(f === 'state' ? { district: '', coveredLocations: [] } : {}),
      ...(f === 'district' ? { coveredLocations: locations.filter(l => l.state === ptList[i].state && l.district === v).map(l => l.name) } : {})
    } : pt))
  }

  // ── Google Maps ──────────────────────────────────────────
  const initMap = useCallback(async (locIndex: number) => {
    if (!mapRef.current) return
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!key) return

    // Load Google Maps
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

      // Search box
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
    if (mapModal !== null) {
      setTimeout(() => initMap(mapModal.locIndex), 100)
    }
  }, [mapModal, initMap])

  // ── Excel Template ───────────────────────────────────────
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
      ['ESIC-SUB','41000009876543210','Haryana','Panipat','Panipat Factory','NH-1 Industrial Area Panipat'],
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
      ['6. EPF Scope: "All Locations" OR specific names comma separated'],
      ['7. Save as .xlsx before uploading'],
    ]), 'Instructions')
    XLSX.writeFile(wb, 'Ezer_Company_Setup_Template.xlsx')
  }

  // ── Excel Upload ─────────────────────────────────────────
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

  // ── Done screen ──────────────────────────────────────────
  if (done) return (
    <div style={{ ...C.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: '48px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: '480px', width: '100%', margin: '20px' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>Setup Complete!</h2>
        <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '4px' }}>{groupName} → {companyName}</p>
        <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>Auto Code: GRP-001-COM-00{companyCount}</p>
        <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '24px' }}>{locations.length} location(s) | {license.plan} Plan | Valid till {license.validTill || 'Not set'}</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button style={C.priBtn} onClick={() => {
            setCompanyCount(c => c + 1)
            setCompanyName(''); setEmployerName(''); setCompanyType(''); setIndustry('')
            setPan(''); setTan(''); setCin(''); setDoi('')
            setLocations([{ id: uid(), name: '', type: 'Head Office', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }])
            setGstList([{ id: uid(), number: '', state: '', certificate: '' }])
            setEpfList([{ id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])
            setEsicList([{ id: uid(), code: '', type: 'main', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])
            setPtList([{ id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])
            setOpBank({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
            setSalBank({ bankName: '', accountNumber: '', ifsc: '', accountType: 'Current', cheque: '' })
            setSameBank(false)
            setLicense({ plan: 'Growth', maxEmployees: '200', maxLocations: '20', validFrom: '', validTill: '', annualCost: '', billingCycle: 'Annual' })
            setStep(1)
            setDone(false)
          }}>+ Add Another Company</button>
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

      {/* Upload Preview */}
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
        {/* Progress */}
        <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STEPS.map((st, i) => {
              const done2 = i < step, active = i === step
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', cursor: done2 ? 'pointer' : 'default' }} onClick={() => done2 && setStep(i)}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', background: done2 ? '#7C3AED' : active ? '#EDE9FE' : '#F1F5F9', border: active ? '2px solid #7C3AED' : 'none', color: done2 ? '#fff' : '#374151' }}>
                      {done2 ? '✓' : st.icon}
                    </div>
                    <span style={{ fontSize: '9px', color: active ? '#7C3AED' : done2 ? '#7C3AED' : '#94A3B8', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{st.label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div style={{ flex: 1, height: '2px', background: done2 ? '#7C3AED' : '#E2E8F0', margin: '0 4px', marginBottom: '14px' }} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── STEP 0: GROUP ── */}
        {step === 0 && (
          <div style={C.card}>
            <div style={C.secTitle}>🏛️ Group Setup</div>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#1D4ED8' }}>
              💡 Single company? Set Group Name = Company Name. You can consolidate multiple companies under one group anytime later.
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
              <label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📁 Click to upload (PNG, JPG — max 2MB)</div></label>
            </div>
          </div>
        )}

        {/* ── STEP 1: COMPANY ── */}
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

            {/* Letterhead */}
            <div style={{ marginTop: '16px', borderTop: '1px solid #F1F5F9', paddingTop: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px' }}>Letterhead Setup</div>
              <div style={C.g2}>
                <div>
                  <label style={C.lbl}>Header — Upload Image</label>
                  <label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload Header Image (Logo + Company Name)</div></label>
                  <label style={{ ...C.lbl, marginTop: '8px' }}>Or Header Text</label>
                  <textarea style={{ ...inp(), height: '60px', resize: 'none' as any }} value={headerText} onChange={e => setHeaderText(e.target.value)} placeholder="Company Name&#10;Address | Phone | Email" />
                </div>
                <div>
                  <label style={C.lbl}>Footer — Upload Image</label>
                  <label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload Footer Image</div></label>
                  <label style={{ ...C.lbl, marginTop: '8px' }}>Or Footer Text</label>
                  <textarea style={{ ...inp(), height: '60px', resize: 'none' as any }} value={footerText} onChange={e => setFooterText(e.target.value)} placeholder="CIN: XXXXX | PAN: XXXXX | www.company.com&#10;This is a computer generated document" />
                </div>
              </div>
              {/* Preview */}
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
              <label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload PDF</div></label>
            </div>
          </div>
        )}

        {/* ── STEP 2: LOCATIONS ── */}
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
              ✦ State + District is used to auto-link PT, ESIC & Shops Act registrations. Google Maps pin captures geo-coordinates for attendance geo-fencing.
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
                    <label style={C.lbl}>PIN Code<span style={C.req}>*</span></label>
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
                      📍 {loc.lat ? `Pinned ✓` : 'Open Google Maps'}
                    </button>
                  </div>
                  <div>
                    <label style={C.lbl}>Registration Certificate</label>
                    <div style={{ ...uploadBox, padding: '9px' }}>📄 Upload</div>
                  </div>
                </div>
                {loc.lat && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#16A34A', background: '#DCFCE7', padding: '5px 10px', borderRadius: '5px' }}>
                    ✓ Geo-tagged: {loc.lat}, {loc.lng}
                  </div>
                )}
                {loc.state && loc.district && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#1D4ED8', background: '#EFF6FF', padding: '5px 10px', borderRadius: '5px' }}>
                    ✦ {loc.state} › {loc.district} — PT & ESIC will auto-link here
                  </div>
                )}
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setLocations(p => [...p, { id: uid(), name: '', type: 'Branch', address: '', state: '', district: '', pincode: '', lat: '', lng: '', licenseNumber: '', certificate: '' }])}>
              ＋ Add Location / Branch
            </button>
          </div>
        )}

        {/* ── STEP 3: TAX ── */}
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
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>GST Certificate</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setGstList(p => [...p, { id: uid(), number: '', state: '', certificate: '' }])}>＋ Add GST</button>
          </div>
        )}

        {/* ── STEP 4: LABOUR LAW ── */}
        {step === 4 && (
          <div style={C.card}>
            <div style={C.secTitle}>⚖️ Labour Law Registrations</div>

            {/* EPF */}
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
                          {loc.name} <span style={{ fontSize: '9px', color: '#94A3B8' }}>({loc.type})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '8px' }}>
                  <label style={C.lbl}>Department Address for Filing</label>
                  <input style={inp()} value={epf.deptAddress} onChange={e => setEpfList(p => p.map((x, idx) => idx === i ? { ...x, deptAddress: e.target.value } : x))} placeholder="Address used in EPF returns and challans" />
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>EPF Certificate</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setEpfList(p => [...p, { id: uid(), code: '', scope: 'all', locations: [], deptAddress: '', certificate: '' }])}>＋ Add EPF Code</button>

            {/* ESIC */}
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
                {esic.locations.length > 0 && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#16A34A', background: '#DCFCE7', padding: '5px 10px', borderRadius: '5px' }}>
                    ✓ Auto-linked: {esic.locations.join(', ')}
                  </div>
                )}
                {/* Manual location override */}
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
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>ESIC Certificate</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setEsicList(p => [...p, { id: uid(), code: '', type: 'sub', state: '', district: '', locations: [], deptAddress: '', certificate: '' }])}>＋ Add ESIC Code</button>

            {/* PT */}
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
                    {pt.coveredLocations.length ? `✓ Auto-covers: ${pt.coveredLocations.join(', ')}` : `⚠️ No locations in ${pt.district}, ${pt.state} — add locations in Step 2 first`}
                  </div>
                )}
                <div style={{ marginTop: '8px' }}>
                  <label style={C.lbl}>Department Address for Filing</label>
                  <input style={inp()} value={pt.deptAddress} onChange={e => setPtList(p => p.map((x, idx) => idx === i ? { ...x, deptAddress: e.target.value } : x))} placeholder="Address used in PT returns and challans" />
                </div>
                <div style={{ marginTop: '8px' }}><label style={C.lbl}>PT Certificate</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📄 Upload</div></label></div>
              </div>
            ))}
            <button style={C.addBtn} onClick={() => setPtList(p => [...p, { id: uid(), regNumber: '', state: '', district: '', coveredLocations: [], deptAddress: '', certificate: '' }])}>＋ Add PT Registration</button>

            {/* LWF */}
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

        {/* ── STEP 5: BANK ── */}
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
              <div style={{ marginTop: '10px' }}><label style={C.lbl}>Cancelled Cheque</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📷 Upload</div></label></div>
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
                  <div><label style={C.lbl}>Account Number</label><input style={inp()} value={salBank.account} onChange={e => setSalBank({ ...salBank, accountNumber: e.target.value })} placeholder="9876543210987654" /></div>
                  <div><label style={C.lbl}>IFSC Code</label><input style={inp()} value={salBank.ifsc} onChange={e => setSalBank({ ...salBank, ifsc: e.target.value.toUpperCase() })} placeholder="ICIC0001234" maxLength={11} /></div>
                </div>
                <div style={{ marginTop: '10px' }}><label style={C.lbl}>Cancelled Cheque</label><label style={{cursor:'pointer'}}><input type="file" accept=".pdf,.jpg,.png,.jpeg" style={{display:'none'}} onChange={e => console.log(e.target.files?.[0]?.name)} /><div style={uploadBox}>📷 Upload</div></label></div>
              </div>
            ) : (
              <div style={{ background: '#DCFCE7', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#16A34A' }}>
                ✓ Salary will be disbursed from the Operating Account
              </div>
            )}
          </div>
        )}

        {/* ── STEP 6: LICENSE ── */}
        {step === 6 && (
          <div style={C.card}>
            <div style={C.secTitle}>📋 License & Billing Plan</div>
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#92400E' }}>
              ⚠️ Set this as per client agreement. Employee & location limits will be enforced. If limit is exceeded, system will alert and block further additions.
            </div>

            {/* Plan selector */}
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
              <div>
                <label style={C.lbl}>Max Employees<span style={C.req}>*</span></label>
                <input style={inp()} value={license.maxEmployees} onChange={e => setLicense(prev => ({ ...prev, maxEmployees: e.target.value }))} placeholder="e.g. 200" />
              </div>
              <div>
                <label style={C.lbl}>Max Locations<span style={C.req}>*</span></label>
                <input style={inp()} value={license.maxLocations} onChange={e => setLicense(prev => ({ ...prev, maxLocations: e.target.value }))} placeholder="e.g. 20" />
              </div>
              <div>
                <label style={C.lbl}>License Valid From<span style={C.req}>*</span></label>
                <input style={inp()} type="date" value={license.validFrom} onChange={e => setLicense(prev => ({ ...prev, validFrom: e.target.value }))} />
              </div>
              <div>
                <label style={C.lbl}>License Valid Till<span style={C.req}>*</span></label>
                <input style={inp()} type="date" value={license.validTill} onChange={e => setLicense(prev => ({ ...prev, validTill: e.target.value }))} />
              </div>
              <div>
                <label style={C.lbl}>Annual Cost (₹)<span style={C.req}>*</span></label>
                <input style={inp()} value={license.annualCost} onChange={e => setLicense(prev => ({ ...prev, annualCost: e.target.value }))} placeholder="e.g. 60000" />
              </div>
              <div>
                <label style={C.lbl}>Billing Cycle</label>
                <select style={sel()} value={license.billingCycle} onChange={e => setLicense(prev => ({ ...prev, billingCycle: e.target.value }))}>
                  <option>Monthly</option>
                  <option>Quarterly</option>
                  <option>Annual</option>
                </select>
              </div>
            </div>

            {license.validFrom && license.validTill && license.annualCost && (
              <div style={{ marginTop: '14px', background: '#DCFCE7', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', color: '#16A34A' }}>
                ✓ Summary: {license.plan} Plan | {license.maxEmployees} employees | {license.maxLocations} locations | ₹{Number(license.annualCost).toLocaleString('en-IN')}/year | Valid: {license.validFrom} to {license.validTill}
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