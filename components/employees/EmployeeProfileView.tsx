'use client'
// components/employees/EmployeeProfileView.tsx — one employee's record: Personal,
// Employment, Statutory, Bank.
//
// This used to live inside app/dashboard/employees/page.tsx as a closure over that
// screen's edit state, so only HR could ever see it. An employee looking at their own
// profile in ESS got a different, thinner screen — different fields, different order,
// different answers to the same question. There is one record; there should be one way
// of reading it.
//
// So the four sections moved here, verbatim, and both screens render this:
//   · Employee Master  passes editMode/editForm/setEditForm and gets the editable form
//   · ESS Profile      passes nothing and gets the same layout, read-only
//
// Everything past Bank — Documents, Salary, Onboarding, HR Actions, History — stays in
// the master screen. Those are HR's tools for working ON somebody, not a view of them.
import type React from 'react'
import EmployeeOrgFlow from '@/components/rms/EmployeeOrgFlow'
import { C, tone } from '@/lib/ui'

export const P = {
  navy: C.ink, purple: C.brand, purpleDark: C.brandDeep,
  purpleBg: C.brandTint, purpleLight: C.sunken,
  border: C.line, card: C.surface, page: C.canvas,
  text: C.ink, muted: C.muted, green: C.positive, greenBg: tone('positive').bg,
  red: C.critical, redBg: tone('critical').bg, amber: C.warning, amberBg: tone('warning').bg,
}

export const fmt = (v: any) => (!v || v === '' ? '—' : String(v))
export const fmtDate = (v: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, ' ')
}

const inp: React.CSSProperties = { width: '100%', padding: '7px 9px', border: `1px solid ${P.border}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: P.card, color: P.text, outline: 'none', boxSizing: 'border-box' }
const sel: React.CSSProperties = { ...inp }

export function Field({ label, value, editMode, fieldKey, editForm, setEditForm, type, opts }: any) {
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${P.border}` }}>
      <div style={{ fontSize: '10px', color: P.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px', fontWeight: 500 }}>{label}</div>
      {editMode ? (
        opts ? (
          <select style={sel} value={editForm?.[fieldKey] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))}>
            <option value="">— Select —</option>
            {opts.map((o: string) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type || 'text'} style={inp} value={editForm?.[fieldKey] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))} />
        )
      ) : (
        <div style={{ fontSize: '13px', color: value && value !== '—' ? P.text : P.muted }}>{value || '—'}</div>
      )}
    </div>
  )
}

export function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0', padding: '16px 20px', borderBottom: `1px solid ${P.border}` }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: P.purple, textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{icon}</span>{title}
      </div>
      {children}
    </div>
  )
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>{children}</div>
}

export function StatChip({ label, value }: { label: string; value: boolean }) {
  return (
    <div style={{ flex: 1, padding: '10px 8px', borderRadius: '10px', background: value ? P.greenBg : P.page, border: `1px solid ${value ? '#BBF7D0' : P.border}`, textAlign: 'center' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: P.text }}>{label}</div>
      <div style={{ fontSize: '10px', color: value ? P.green : P.muted, marginTop: '4px', fontWeight: 500 }}>{value ? 'Yes' : 'No'}</div>
    </div>
  )
}

export const PROFILE_TABS = [
  { id: 'personal',   label: 'Personal',   icon: '' },
  { id: 'employment', label: 'Employment', icon: '' },
  { id: 'statutory',  label: 'Statutory',  icon: '' },
  { id: 'bank',       label: 'Bank',       icon: '' },
]

export interface ProfileSectionProps {
  emp: any
  /** 'personal' | 'employment' | 'statutory' | 'bank' */
  profileTab: string
  /** Omit for the read-only view — that is what ESS renders. */
  editMode?: boolean
  editForm?: Record<string, any>
  setEditForm?: (fn: any) => void
  /** ESS has no org-chart component to hand; the master screen does. */
  showManagerChain?: boolean
}

export default function EmployeeProfileSections({
  emp, profileTab, editMode = false, editForm, setEditForm, showManagerChain = true,
}: ProfileSectionProps) {
  const ef = editForm || {}
  const F = (label: string, key: string, type?: string, opts?: string[]) => (
    <Field key={key} label={label}
      value={key === 'date_of_birth' || key.includes('doj') ? fmtDate((emp as any)[key]) : fmt((emp as any)[key])}
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
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Aadhaar</div>
            <div style={{ fontSize:'13px', color:P.text }}>XXXX-XXXX-{emp.aadhar_last4 || '—'}</div>
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
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Company</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).companies?.company_name || (emp as any).company_name || '—'}</div>
          </div>
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Location / Branch</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).locations?.location_name || (emp as any).location_name || '—'}</div>
          </div>
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Department</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).departments?.dept_name || (emp as any).dept_name || '—'}</div>
          </div>
        </Grid2>
      </Section>
      {showManagerChain && (
        <Section title="Manager Information" icon="🧭">
          <EmployeeOrgFlow employeeId={emp.id} companyId={emp.company_id} employeeName={emp.full_name} />
        </Section>
      )}
      {emp.employment_status === 'Resigned' && (
        <Section title="Exit Details" icon="🚪">
          <Grid2>
            {F('Date of Resignation','date_of_resignation','date')}
            {F('Last Working Date','last_working_date','date')}
          </Grid2>
          <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
            <div style={{ padding:'6px 12px', borderRadius:'10px', background: emp.rehire_eligible ? P.greenBg : P.page, border:`1px solid ${emp.rehire_eligible ? '#BBF7D0' : P.border}`, fontSize:'11px', color: emp.rehire_eligible ? P.green : P.muted }}>{emp.rehire_eligible ? 'Rehire Eligible' : 'Not Rehire Eligible'}</div>
            {emp.blacklisted && <div style={{ padding:'6px 12px', borderRadius:'10px', background:P.redBg, border:`1px solid #FCA5A5`, fontSize:'11px', color:P.red }}>Blacklisted</div>}
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
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Aadhaar</div>
            <div style={{ fontSize:'13px', fontFamily:'monospace', color:P.text }}>XXXX-XXXX-{emp.aadhar_last4 || '—'}</div>
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
          ].map(([l, v]) => (
            <div key={l as string} style={{ padding:'6px 0', borderBottom:`1px solid #DCFCE7` }}>
              <div style={{ fontSize:'10px', color:C.positive, marginBottom:'3px', fontWeight:500, textTransform:'uppercase', letterSpacing:'.4px' }}>{l}</div>
              <div style={{ fontSize:'13px', color:P.text, fontFamily: l === 'Account No.' || l === 'IFSC Code' ? 'monospace' : 'inherit' }}>{v || '—'}</div>
            </div>
          ))}
        </Grid2>
      </div>
    </Section>
  )

  return null
}
