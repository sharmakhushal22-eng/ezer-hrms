'use client'
import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────
interface GroupData {
  group_name: string; group_code: string; pan: string; registered_address: string;
  city: string; state: string; pincode: string; gstin: string;
}
interface CompanyData {
  company_name: string; company_code: string; legal_name: string; cin: string;
  gstin: string; pan: string; tan: string; company_type: string; industry: string;
  date_of_inc: string; reg_office: string; corp_office: string;
}
interface LocationData {
  name: string; code: string; address: string; city: string;
  state: string; pincode: string; is_head_office: boolean;
}
interface TaxData {
  pan: string; tan: string; gstin: string; gst_registration_date: string;
  gst_state: string; tds_circle: string; income_tax_ward: string;
}
interface LabourData {
  pf_number: string; pf_applicable: boolean; pf_ceiling: number;
  esic_number: string; esic_applicable: boolean;
  pt_applicable: boolean; pt_state: string;
  lwf_applicable: boolean; lwf_state: string;
  factory_act: boolean; factory_license: string;
}
interface BankData {
  bank_name: string; account_number: string; ifsc: string;
  account_type: string; branch: string; purpose: string;
}

// ── Constants ──────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Group', icon: '🏢', desc: 'Group Setup' },
  { id: 2, label: 'Company', icon: '🏭', desc: 'Company Details' },
  { id: 3, label: 'Locations', icon: '📍', desc: 'Office Locations' },
  { id: 4, label: 'Tax', icon: '🧾', desc: 'Tax Registration' },
  { id: 5, label: 'Labour Law', icon: '⚖️', desc: 'PF/ESIC/PT/LWF' },
  { id: 6, label: 'Bank', icon: '🏦', desc: 'Bank Accounts' },
  { id: 7, label: 'License', icon: '✅', desc: 'License & Billing' },
]

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi','Jammu & Kashmir','Ladakh','Chandigarh','Puducherry',
  'Andaman & Nicobar','Dadra & Nagar Haveli','Daman & Diu','Lakshadweep'
]

const PT_STATES = [
  'Andhra Pradesh','Assam','Bihar','Gujarat','Karnataka','Kerala',
  'Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu',
  'Telangana','Tripura','West Bengal','Jharkhand','Andaman & Nicobar'
]

const INDUSTRIES = [
  'Manufacturing','Trading','Retail','IT/Technology','Healthcare','Education',
  'Construction','Logistics','Finance','Hospitality','Automotive','Textile',
  'Chemical','Pharmaceutical','FMCG','Media','Real Estate','Agriculture','Others'
]

const COMPANY_TYPES = [
  'Private Limited','Public Limited','LLP','Partnership','Proprietorship',
  'Section 8 Company','OPC','Trust','Society'
]

const BANKS = [
  'State Bank of India','HDFC Bank','ICICI Bank','Axis Bank','Kotak Bank',
  'Punjab National Bank','Bank of Baroda','Canara Bank','Union Bank',
  'IndusInd Bank','Yes Bank','Federal Bank','IDFC First Bank'
]

// ── Main Component ─────────────────────────────────────────────────
export default function AdminSetupPage() {
  const [step, setStep] = useState(1)
  const [saved, setSaved] = useState<number[]>([])
  const [group, setGroup] = useState<GroupData>({
    group_name:'', group_code:'', pan:'', registered_address:'',
    city:'', state:'', pincode:'', gstin:'',
  })
  const [company, setCompany] = useState<CompanyData>({
    company_name:'', company_code:'', legal_name:'', cin:'', gstin:'', pan:'', tan:'',
    company_type:'', industry:'', date_of_inc:'', reg_office:'', corp_office:'',
  })
  const [locations, setLocations] = useState<LocationData[]>([
    { name:'', code:'', address:'', city:'', state:'', pincode:'', is_head_office:true }
  ])
  const [tax, setTax] = useState<TaxData>({
    pan:'', tan:'', gstin:'', gst_registration_date:'', gst_state:'', tds_circle:'', income_tax_ward:''
  })
  const [labour, setLabour] = useState<LabourData>({
    pf_number:'', pf_applicable:true, pf_ceiling:15000,
    esic_number:'', esic_applicable:true,
    pt_applicable:false, pt_state:'',
    lwf_applicable:false, lwf_state:'',
    factory_act:false, factory_license:'',
  })
  const [banks, setBanks] = useState<BankData[]>([
    { bank_name:'', account_number:'', ifsc:'', account_type:'Current', branch:'', purpose:'Operating' }
  ])

  // ── Styles ─────────────────────────────────────────────────────
  const card = { background:'#fff', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,.08)', padding:'24px' }
  const inp = { width:'100%', padding:'9px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as const }
  const sel = { ...inp, background:'#fff', cursor:'pointer' }
  const label = { fontSize:'11px', fontWeight:600 as const, color:'#374151', display:'block' as const, marginBottom:'4px', textTransform:'uppercase' as const, letterSpacing:'.04em' }
  const priBtn = { background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', padding:'10px 24px', fontSize:'13px', fontWeight:600 as const, cursor:'pointer' }
  const secBtn = { background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'10px 20px', fontSize:'13px', cursor:'pointer' }
  const toggleOn = { background:'#7C3AED', color:'#fff', border:'none', borderRadius:'6px', padding:'6px 14px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' }
  const toggleOff = { background:'#f3f4f6', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'6px', padding:'6px 14px', fontSize:'12px', cursor:'pointer' }

  const Field = ({ label: l, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label style={label}>{l}</label>
      {children}
    </div>
  )

  const Grid = ({ children, cols=3 }: { children: React.ReactNode; cols?: number }) => (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${cols}, 1fr)`, gap:'14px' }}>
      {children}
    </div>
  )

  const SectionTitle = ({ icon, title }: { icon: string; title: string }) => (
    <div style={{ fontSize:'12px', fontWeight:700, color:'#7C3AED', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'14px', paddingBottom:'8px', borderBottom:'2px solid #EDE9FE', display:'flex', alignItems:'center', gap:'6px' }}>
      {icon} {title}
    </div>
  )

  const handleSave = () => {
    setSaved(prev => prev.includes(step) ? prev : [...prev, step])
    if (step < 7) setStep(step + 1)
  }

  // ── STEP 1: Group ───────────────────────────────────────────────
  const Step1 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <SectionTitle icon="🏢" title="Group / Holding Company Details" />
      <Grid>
        <Field label="Group Name *">
          <input style={inp} placeholder="Sharma Group" value={group.group_name}
            onChange={e => setGroup({...group, group_name:e.target.value})} />
        </Field>
        <Field label="Group Code *">
          <input style={inp} placeholder="SHG" value={group.group_code}
            onChange={e => setGroup({...group, group_code:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="PAN *">
          <input style={inp} placeholder="AABCS1234D" value={group.pan}
            onChange={e => setGroup({...group, pan:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="GSTIN">
          <input style={inp} placeholder="06AABCS1234D1Z5" value={group.gstin}
            onChange={e => setGroup({...group, gstin:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="City">
          <input style={inp} placeholder="New Delhi" value={group.city}
            onChange={e => setGroup({...group, city:e.target.value})} />
        </Field>
        <Field label="State">
          <select style={sel} value={group.state} onChange={e => setGroup({...group, state:e.target.value})}>
            <option value="">Select State</option>
            {STATES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Pincode">
          <input style={inp} placeholder="110001" value={group.pincode}
            onChange={e => setGroup({...group, pincode:e.target.value})} />
        </Field>
      </Grid>
      <Field label="Registered Address *">
        <textarea style={{...inp, height:'80px', resize:'vertical'}} placeholder="Plot No. 12, Sector 18..."
          value={group.registered_address}
          onChange={e => setGroup({...group, registered_address:e.target.value})} />
      </Field>
    </div>
  )

  // ── STEP 2: Company ─────────────────────────────────────────────
  const Step2 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>
      <SectionTitle icon="🏭" title="Company Details" />
      <Grid>
        <Field label="Company Name *">
          <input style={inp} placeholder="SSM Manufacturing Pvt Ltd" value={company.company_name}
            onChange={e => setCompany({...company, company_name:e.target.value})} />
        </Field>
        <Field label="Company Code *">
          <input style={inp} placeholder="SSM" value={company.company_code}
            onChange={e => setCompany({...company, company_code:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="Legal Name">
          <input style={inp} placeholder="SSM Manufacturing Private Limited" value={company.legal_name}
            onChange={e => setCompany({...company, legal_name:e.target.value})} />
        </Field>
        <Field label="Company Type *">
          <select style={sel} value={company.company_type} onChange={e => setCompany({...company, company_type:e.target.value})}>
            <option value="">Select Type</option>
            {COMPANY_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Industry *">
          <select style={sel} value={company.industry} onChange={e => setCompany({...company, industry:e.target.value})}>
            <option value="">Select Industry</option>
            {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Date of Incorporation">
          <input style={inp} type="date" value={company.date_of_inc}
            onChange={e => setCompany({...company, date_of_inc:e.target.value})} />
        </Field>
        <Field label="CIN">
          <input style={inp} placeholder="U74999HR2015PTC055412" value={company.cin}
            onChange={e => setCompany({...company, cin:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="PAN *">
          <input style={inp} placeholder="AABCS1429B" value={company.pan}
            onChange={e => setCompany({...company, pan:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="TAN">
          <input style={inp} placeholder="DELS12345B" value={company.tan}
            onChange={e => setCompany({...company, tan:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="GSTIN">
          <input style={inp} placeholder="06AABCS1429B1ZB" value={company.gstin}
            onChange={e => setCompany({...company, gstin:e.target.value.toUpperCase()})} />
        </Field>
      </Grid>
      <Field label="Registered Office Address *">
        <textarea style={{...inp, height:'70px', resize:'vertical'}} value={company.reg_office}
          placeholder="Plot No. 12, Sector 18, IMT Manesar, Gurugram - 122050"
          onChange={e => setCompany({...company, reg_office:e.target.value})} />
      </Field>
      <Field label="Corporate Office Address">
        <textarea style={{...inp, height:'70px', resize:'vertical'}} value={company.corp_office}
          placeholder="Same as registered or different..."
          onChange={e => setCompany({...company, corp_office:e.target.value})} />
      </Field>
    </div>
  )

  // ── STEP 3: Locations ───────────────────────────────────────────
  const Step3 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <SectionTitle icon="📍" title="Office Locations / Plants" />
        <button style={priBtn} onClick={() => setLocations([...locations, { name:'', code:'', address:'', city:'', state:'', pincode:'', is_head_office:false }])}>
          + Add Location
        </button>
      </div>
      {locations.map((loc, idx) => (
        <div key={idx} style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px', background:loc.is_head_office ? '#F5F3FF' : '#fff' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
            <span style={{ fontSize:'13px', fontWeight:700, color:'#7C3AED' }}>
              {loc.is_head_office ? '🏢 Head Office' : `📍 Location ${idx + 1}`}
            </span>
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <label style={{ fontSize:'12px', color:'#6b7280', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px' }}>
                <input type="checkbox" checked={loc.is_head_office}
                  onChange={e => {
                    const updated = locations.map((l, i) => ({...l, is_head_office: i === idx ? e.target.checked : false}))
                    setLocations(updated)
                  }} />
                Head Office
              </label>
              {locations.length > 1 && (
                <button style={{...secBtn, padding:'4px 10px', fontSize:'12px', color:'#dc2626'}}
                  onClick={() => setLocations(locations.filter((_, i) => i !== idx))}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <Grid>
            <Field label="Location Name *">
              <input style={inp} placeholder="Manesar Plant" value={loc.name}
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], name:e.target.value}; setLocations(u) }} />
            </Field>
            <Field label="Location Code *">
              <input style={inp} placeholder="SSM-MNS" value={loc.code}
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], code:e.target.value.toUpperCase()}; setLocations(u) }} />
            </Field>
            <Field label="City *">
              <input style={inp} placeholder="Gurugram" value={loc.city}
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], city:e.target.value}; setLocations(u) }} />
            </Field>
            <Field label="State *">
              <select style={sel} value={loc.state}
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], state:e.target.value}; setLocations(u) }}>
                <option value="">Select State</option>
                {STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Pincode">
              <input style={inp} placeholder="122050" value={loc.pincode}
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], pincode:e.target.value}; setLocations(u) }} />
            </Field>
          </Grid>
          <div style={{ marginTop:'10px' }}>
            <Field label="Full Address">
              <textarea style={{...inp, height:'60px', resize:'vertical'}} value={loc.address}
                placeholder="Plot No. 12, Sector 18, IMT Manesar..."
                onChange={e => { const u=[...locations]; u[idx]={...u[idx], address:e.target.value}; setLocations(u) }} />
            </Field>
          </div>
        </div>
      ))}
    </div>
  )

  // ── STEP 4: Tax ─────────────────────────────────────────────────
  const Step4 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <SectionTitle icon="🧾" title="Tax Registration Details" />
      <Grid>
        <Field label="PAN *">
          <input style={inp} placeholder="AABCS1429B" value={tax.pan}
            onChange={e => setTax({...tax, pan:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="TAN *">
          <input style={inp} placeholder="DELS12345B" value={tax.tan}
            onChange={e => setTax({...tax, tan:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="GSTIN *">
          <input style={inp} placeholder="06AABCS1429B1ZB" value={tax.gstin}
            onChange={e => setTax({...tax, gstin:e.target.value.toUpperCase()})} />
        </Field>
        <Field label="GST Registration Date">
          <input style={inp} type="date" value={tax.gst_registration_date}
            onChange={e => setTax({...tax, gst_registration_date:e.target.value})} />
        </Field>
        <Field label="GST State">
          <select style={sel} value={tax.gst_state} onChange={e => setTax({...tax, gst_state:e.target.value})}>
            <option value="">Select State</option>
            {STATES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="TDS Circle/Ward">
          <input style={inp} placeholder="Delhi/TDS Circle 123" value={tax.tds_circle}
            onChange={e => setTax({...tax, tds_circle:e.target.value})} />
        </Field>
        <Field label="Income Tax Ward/Circle">
          <input style={inp} placeholder="Ward 4(2)" value={tax.income_tax_ward}
            onChange={e => setTax({...tax, income_tax_ward:e.target.value})} />
        </Field>
      </Grid>
      <div style={{ background:'#FFF7ED', borderRadius:'8px', padding:'12px', fontSize:'12px', color:'#92400E' }}>
        💡 <strong>Note:</strong> PAN is mandatory. TAN is required for TDS deductions. GSTIN required if annual turnover {'>'} ₹20 Lakhs.
      </div>
    </div>
  )

  // ── STEP 5: Labour Law ──────────────────────────────────────────
  const Step5 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>
      <SectionTitle icon="⚖️" title="Labour Law Compliances" />

      {/* PF */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#1d4ed8' }}>🔵 Provident Fund (EPF)</span>
          <div style={{ display:'flex', gap:'6px' }}>
            <button style={labour.pf_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, pf_applicable:true})}>Applicable</button>
            <button style={!labour.pf_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, pf_applicable:false})}>Not Applicable</button>
          </div>
        </div>
        {labour.pf_applicable && (
          <Grid cols={2}>
            <Field label="EPF Registration Number *">
              <input style={inp} placeholder="HR/GGN/12345" value={labour.pf_number}
                onChange={e => setLabour({...labour, pf_number:e.target.value})} />
            </Field>
            <Field label="PF Wage Ceiling">
              <select style={sel} value={labour.pf_ceiling} onChange={e => setLabour({...labour, pf_ceiling:Number(e.target.value)})}>
                <option value={15000}>₹15,000 (Statutory)</option>
                <option value={0}>No Ceiling (Full Basic)</option>
              </select>
            </Field>
          </Grid>
        )}
        <div style={{ marginTop:'8px', fontSize:'11px', color:'#6b7280' }}>
          Mandatory for companies with 20+ employees. Employer: 12% | Employee: 12% of Basic (capped ₹15,000)
        </div>
      </div>

      {/* ESIC */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#059669' }}>🟢 ESIC</span>
          <div style={{ display:'flex', gap:'6px' }}>
            <button style={labour.esic_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, esic_applicable:true})}>Applicable</button>
            <button style={!labour.esic_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, esic_applicable:false})}>Not Applicable</button>
          </div>
        </div>
        {labour.esic_applicable && (
          <Field label="ESIC Registration Number *">
            <input style={{...inp, width:'50%'}} placeholder="41000011234567890" value={labour.esic_number}
              onChange={e => setLabour({...labour, esic_number:e.target.value})} />
          </Field>
        )}
        <div style={{ marginTop:'8px', fontSize:'11px', color:'#6b7280' }}>
          Applicable if Gross ≤ ₹21,000. Employer: 3.25% | Employee: 0.75%
        </div>
      </div>

      {/* PT */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#d97706' }}>🟡 Professional Tax (PT)</span>
          <div style={{ display:'flex', gap:'6px' }}>
            <button style={labour.pt_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, pt_applicable:true})}>Applicable</button>
            <button style={!labour.pt_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, pt_applicable:false})}>Not Applicable</button>
          </div>
        </div>
        {labour.pt_applicable && (
          <Field label="PT State (22 states only) *">
            <select style={{...sel, width:'50%'}} value={labour.pt_state} onChange={e => setLabour({...labour, pt_state:e.target.value})}>
              <option value="">Select PT State</option>
              {PT_STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
        <div style={{ marginTop:'8px', fontSize:'11px', color:'#6b7280' }}>
          Applicable in 22 states only. Max ₹2,500/year. Slab varies by state.
        </div>
      </div>

      {/* LWF */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#7C3AED' }}>🟣 Labour Welfare Fund (LWF)</span>
          <div style={{ display:'flex', gap:'6px' }}>
            <button style={labour.lwf_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, lwf_applicable:true})}>Applicable</button>
            <button style={!labour.lwf_applicable ? toggleOn : toggleOff} onClick={() => setLabour({...labour, lwf_applicable:false})}>Not Applicable</button>
          </div>
        </div>
        {labour.lwf_applicable && (
          <Field label="LWF State *">
            <select style={{...sel, width:'50%'}} value={labour.lwf_state} onChange={e => setLabour({...labour, lwf_state:e.target.value})}>
              <option value="">Select State</option>
              {STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
      </div>

      {/* Factory Act */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#dc2626' }}>🔴 Factory Act License</span>
          <div style={{ display:'flex', gap:'6px' }}>
            <button style={labour.factory_act ? toggleOn : toggleOff} onClick={() => setLabour({...labour, factory_act:true})}>Applicable</button>
            <button style={!labour.factory_act ? toggleOn : toggleOff} onClick={() => setLabour({...labour, factory_act:false})}>Not Applicable</button>
          </div>
        </div>
        {labour.factory_act && (
          <Field label="Factory License Number">
            <input style={{...inp, width:'50%'}} placeholder="HR/FAC/12345/2024" value={labour.factory_license}
              onChange={e => setLabour({...labour, factory_license:e.target.value})} />
          </Field>
        )}
        <div style={{ marginTop:'8px', fontSize:'11px', color:'#6b7280' }}>
          Required for manufacturing units with 10+ workers (with power) or 20+ workers (without power)
        </div>
      </div>
    </div>
  )

  // ── STEP 6: Bank ────────────────────────────────────────────────
  const Step6 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <SectionTitle icon="🏦" title="Bank Accounts" />
        <button style={priBtn} onClick={() => setBanks([...banks, { bank_name:'', account_number:'', ifsc:'', account_type:'Current', branch:'', purpose:'Salary' }])}>
          + Add Bank Account
        </button>
      </div>
      {banks.map((bank, idx) => (
        <div key={idx} style={{ border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'12px' }}>
            <span style={{ fontSize:'13px', fontWeight:700, color:'#1d4ed8' }}>
              🏦 Bank Account {idx + 1} — {bank.purpose || 'Account'}
            </span>
            {banks.length > 1 && (
              <button style={{...secBtn, padding:'4px 10px', fontSize:'12px', color:'#dc2626'}}
                onClick={() => setBanks(banks.filter((_, i) => i !== idx))}>Remove</button>
            )}
          </div>
          <Grid>
            <Field label="Bank Name *">
              <select style={sel} value={bank.bank_name}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], bank_name:e.target.value}; setBanks(u) }}>
                <option value="">Select Bank</option>
                {BANKS.map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Account Number *">
              <input style={inp} placeholder="12345678901234" value={bank.account_number}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], account_number:e.target.value}; setBanks(u) }} />
            </Field>
            <Field label="IFSC Code *">
              <input style={inp} placeholder="HDFC0001234" value={bank.ifsc}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], ifsc:e.target.value.toUpperCase()}; setBanks(u) }} />
            </Field>
            <Field label="Account Type">
              <select style={sel} value={bank.account_type}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], account_type:e.target.value}; setBanks(u) }}>
                <option>Current</option>
                <option>Savings</option>
                <option>Cash Credit</option>
              </select>
            </Field>
            <Field label="Branch">
              <input style={inp} placeholder="Gurugram Main Branch" value={bank.branch}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], branch:e.target.value}; setBanks(u) }} />
            </Field>
            <Field label="Purpose">
              <select style={sel} value={bank.purpose}
                onChange={e => { const u=[...banks]; u[idx]={...u[idx], purpose:e.target.value}; setBanks(u) }}>
                <option>Operating</option>
                <option>Salary</option>
                <option>Tax Payment</option>
                <option>PF/ESIC</option>
                <option>Escrow</option>
              </select>
            </Field>
          </Grid>
        </div>
      ))}
    </div>
  )

  // ── STEP 7: License ─────────────────────────────────────────────
  const Step7 = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>
      <SectionTitle icon="✅" title="Setup Complete!" />
      <div style={{ background:'linear-gradient(135deg,#7C3AED,#1E1B4B)', borderRadius:'16px', padding:'32px', color:'#fff', textAlign:'center' }}>
        <div style={{ fontSize:'48px', marginBottom:'12px' }}>🎉</div>
        <h2 style={{ fontSize:'22px', fontWeight:700, margin:'0 0 8px' }}>Company Setup Complete!</h2>
        <p style={{ fontSize:'14px', opacity:.8, margin:0 }}>Your HRMS is ready. You can now add employees, process payroll, and manage compliance.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
        {[
          { icon:'👥', title:'Employee Master', desc:'Add employees with all details', color:'#1d4ed8', link:'/dashboard/employees' },
          { icon:'💰', title:'CTC Master', desc:'Configure salary structures', color:'#7C3AED', link:'/dashboard/payroll' },
          { icon:'🚀', title:'Recruitment', desc:'Post jobs, track candidates', color:'#059669', link:'/dashboard/recruitment' },
          { icon:'📋', title:'Onboarding', desc:'Digital joining process', color:'#d97706', link:'/dashboard/onboarding' },
        ].map(item => (
          <a key={item.title} href={item.link} style={{ display:'block', border:'2px solid #e5e7eb', borderRadius:'10px', padding:'16px', textDecoration:'none', color:'inherit', cursor:'pointer' }}>
            <div style={{ fontSize:'24px', marginBottom:'6px' }}>{item.icon}</div>
            <div style={{ fontSize:'14px', fontWeight:700, color:item.color }}>{item.title}</div>
            <div style={{ fontSize:'12px', color:'#6b7280', marginTop:'2px' }}>{item.desc}</div>
          </a>
        ))}
      </div>
      <div style={{ background:'#F0FDF4', borderRadius:'8px', padding:'14px', fontSize:'12px', color:'#166534' }}>
        ✅ <strong>Setup Summary:</strong> Group configured → Company added → {locations.length} location(s) → Tax details saved → Compliances configured → {banks.length} bank account(s)
      </div>
    </div>
  )

  const steps: { [key: number]: React.ReactNode } = { 1:<Step1/>, 2:<Step2/>, 3:<Step3/>, 4:<Step4/>, 5:<Step5/>, 6:<Step6/>, 7:<Step7/> }

  return (
    <div style={{ padding:'24px', background:'#f8fafc', minHeight:'100vh' }}>
      {/* Header */}
      <div style={{ marginBottom:'24px' }}>
        <h1 style={{ fontSize:'22px', fontWeight:700, color:'#111827', margin:0 }}>⚙️ Company Setup Wizard</h1>
        <p style={{ fontSize:'13px', color:'#6b7280', margin:'4px 0 0' }}>Configure your company once — your entire HRMS runs on this foundation</p>
      </div>

      {/* Step Indicator */}
      <div style={{ display:'flex', alignItems:'center', marginBottom:'24px', gap:'0', overflowX:'auto' }}>
        {STEPS.map((s, idx) => (
          <div key={s.id} style={{ display:'flex', alignItems:'center' }}>
            <div
              onClick={() => saved.includes(s.id) || s.id <= step ? setStep(s.id) : null}
              style={{
                display:'flex', flexDirection:'column', alignItems:'center', cursor: saved.includes(s.id) || s.id <= step ? 'pointer' : 'default',
                padding:'8px 12px', borderRadius:'10px',
                background: step === s.id ? '#7C3AED' : saved.includes(s.id) ? '#EDE9FE' : '#fff',
                border: step === s.id ? 'none' : '1px solid #e5e7eb',
                minWidth:'80px',
              }}>
              <span style={{ fontSize:'18px' }}>{saved.includes(s.id) && step !== s.id ? '✅' : s.icon}</span>
              <span style={{ fontSize:'10px', fontWeight:700, color: step === s.id ? '#fff' : saved.includes(s.id) ? '#7C3AED' : '#9ca3af', marginTop:'2px' }}>{s.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div style={{ width:'20px', height:'2px', background: saved.includes(s.id) ? '#7C3AED' : '#e5e7eb' }} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div style={{ ...card, marginBottom:'16px' }}>
        <div style={{ marginBottom:'20px', paddingBottom:'14px', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'20px' }}>{STEPS[step-1].icon}</span>
          <div>
            <div style={{ fontSize:'15px', fontWeight:700, color:'#111827' }}>Step {step}: {STEPS[step-1].desc}</div>
            <div style={{ fontSize:'12px', color:'#9ca3af' }}>Step {step} of {STEPS.length}</div>
          </div>
        </div>
        {steps[step]}
      </div>

      {/* Navigation */}
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <button style={secBtn} onClick={() => setStep(Math.max(1, step-1))} disabled={step === 1}>
          ← Previous
        </button>
        <div style={{ display:'flex', gap:'8px' }}>
          <button style={secBtn}>Save Draft</button>
          <button style={priBtn} onClick={handleSave}>
            {step === 7 ? '🎉 Complete Setup' : 'Save & Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}