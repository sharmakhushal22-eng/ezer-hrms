// components/onboarding/ActivationWizard.tsx
// EZER HRMS — 5-step HR Activation wizard (replaces the simple "Generate Employee Code" modal).
// Inline styles only. All sub-components defined OUTSIDE the parent (stable references → no focus loss).
'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  loadActivationData, saveActivation, markApproval,
  computePayrollChecks, checkDuplicates, computeGates, allGatesPass,
  type ActivationCandidate, type EmpLite, type ShiftLite, type DeptLite, type Gate, type PayrollChecks,
} from '@/lib/onboarding/activation'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── EZER palette ───────────────────────────────────────────────────
const T = {
  overlay:  { position:'fixed' as const, inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'flex-start' as const, justifyContent:'center' as const, zIndex:1000, padding:16, overflowY:'auto' as const },
  card:     { background:TK.surface, borderRadius:14, width:'100%', maxWidth:720, boxShadow:'0 20px 60px rgba(0,0,0,.2)', margin:'24px 0', display:'flex' as const, flexDirection:'column' as const },
  header:   { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 22px', borderBottom:'1px solid rgba(124,58,237,0.12)' },
  hTitle:   { fontSize:15, fontWeight:600, color:TK.ink },
  closeBtn: { border:'none', background:'none', cursor:'pointer', fontSize:22, color:TK.muted, lineHeight:1 },
  body:     { padding:'18px 22px' },
  footer:   { display:'flex', gap:10, padding:'14px 22px', borderTop:'1px solid rgba(124,58,237,0.12)', alignItems:'center' },
  label:    { fontSize:11, fontWeight:600, color:TK.violetDeep, textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 },
  input:    { width:'100%', padding:'9px 11px', background:TK.sunken, border:'1px solid #DDD6FE', borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  g2:       { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  field:    { marginBottom:10 },
  chip:     { display:'inline-flex', flexDirection:'column' as const, padding:'7px 11px', background:TK.canvas, borderRadius:8, minWidth:0 },
  chipK:    { fontSize:9, fontWeight:600, color:TK.violetDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' },
  chipV:    { fontSize:12, color:TK.ink, fontWeight:500, marginTop:2 },
  sectionH: { fontSize:12, fontWeight:600, color:TK.violet, textTransform:'uppercase' as const, letterSpacing:'.05em', margin:'4px 0 10px' },
  btn:      { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' },
  btnPri:   { padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:TK.violet, color:'#fff' },
  btnOut:   { padding:'9px 16px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.violetDeep },
  card2:    { background:TK.surface, border:'1px solid rgba(124,58,237,0.12)', borderRadius:10, padding:'14px 16px', boxShadow:'0 1px 4px rgba(124,58,237,0.06)' },
}
const PURPLE = TK.violet, GREEN = TK.positive, RED = TK.critical, AMBER = TK.warning, MUTED = TK.muted
const STEP_NAMES = ['Org & Role', 'CTC & Payroll', 'IT + Admin', 'Approvals', 'Generate']

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const fmtDT = (s?: string | null) => s ? new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : ''
const addMonths = (dateStr: string, months: number): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  d.setMonth(d.getMonth() + (months || 0))
  return d.toISOString().slice(0, 10)
}

// ── Generic small components (outside parent) ──────────────────────
function Stepper({ step }: { step: number }) {
  return (
    <div style={{ display:'flex', gap:6, marginBottom:18, flexWrap:'wrap' }}>
      {STEP_NAMES.map((name, i) => {
        const n = i + 1, active = n === step, done = n < step
        return (
          <div key={n} style={{ display:'flex', alignItems:'center', gap:6, flex:1, minWidth:0 }}>
            <span style={{
              width:22, height:22, borderRadius:99, flexShrink:0,
              display:'inline-flex', alignItems:'center', justifyContent:'center',
              fontSize:11, fontWeight:700,
              background: active ? PURPLE : done ? TK.violetTint : '#F3F4F6',
              color: active ? '#fff' : done ? PURPLE : MUTED,
            }}>{n}</span>
            <span style={{ fontSize:11, fontWeight: active ? 700 : 500, color: active ? TK.ink : MUTED, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</span>
          </div>
        )
      })}
    </div>
  )
}

function Chip({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div style={{ ...T.chip, background: danger ? TK.criticalTint : TK.canvas }}>
      <span style={{ ...T.chipK, color: danger ? RED : TK.violetDeep }}>{k}</span>
      <span style={{ ...T.chipV, color: danger ? RED : TK.ink }}>{v}</span>
    </div>
  )
}

function CheckRow({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  const color = optional && !ok ? MUTED : ok ? GREEN : RED
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', opacity: optional && !ok ? 0.65 : 1 }}>
      <span style={{ color, fontWeight:700, width:14 }}>{ok ? '' : ''}</span>
      <span style={{ fontSize:12.5, color:TK.ink }}>{label}{optional ? ' (optional)' : ''}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={T.field}>
      <label style={T.label}>{label}</label>
      {children}
    </div>
  )
}

function EmpSelect({ label, value, onChange, employees, required }: { label: string; value: string; onChange: (v: string) => void; employees: EmpLite[]; required?: boolean }) {
  return (
    <Field label={label + (required ? ' *' : '')}>
      <select value={value || ''} onChange={e => onChange(e.target.value)} style={T.input}>
        <option value="">Select…</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}{e.emp_code ? ` (${e.emp_code})` : ''}</option>)}
      </select>
    </Field>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'6px 0' }}>
      <span onClick={() => onChange(!checked)} style={{
        width:36, height:20, borderRadius:99, padding:2, flexShrink:0, transition:'background .15s',
        background: checked ? GREEN : '#D1D5DB', display:'inline-flex', alignItems:'center',
      }}>
        <span style={{ width:16, height:16, borderRadius:99, background:'#fff', transform: checked ? 'translateX(16px)' : 'translateX(0)', transition:'transform .15s' }} />
      </span>
      <span style={{ fontSize:12.5, color:TK.ink }}>{label}</span>
    </label>
  )
}

// ── Steps ──────────────────────────────────────────────────────────
function Step1Org({ cand, form, setF, employees, shifts, departments }: any) {
  const deptMissing = !form?.department_id
  return (
    <div>
      <div style={T.sectionH}>Organisation & Role</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14 }}>
        <Chip k="Company" v={cand?.company_id ? '✓ set' : '—'} />
        <Chip k="Branch" v={cand?.location_id ? '✓ set' : '—'} />
        <Chip k="Designation" v={cand?.designation || '—'} />
        <Chip k="DOJ" v={cand?.date_of_joining || '—'} />
        <Chip k="Employment" v={cand?.employment_type || '—'} />
      </div>

      <div style={T.g2}>
        <Field label="Department *">
          <select value={form.department_id || ''} onChange={e => setF('department_id', e.target.value)} style={{ ...T.input, ...(deptMissing ? { borderColor: RED } : {}) }}>
            <option value="">Select department…</option>
            {(departments || []).map((d: DeptLite) => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
          </select>
        </Field>
        <Field label="Grade"><input value={form.grade || ''} onChange={e => setF('grade', e.target.value)} style={T.input} placeholder="e.g. M3" /></Field>
        <EmpSelect label="L1 Manager" required value={form.l1_manager_id} onChange={v => setF('l1_manager_id', v)} employees={employees} />
        <EmpSelect label="L2 Manager" value={form.l2_manager_id} onChange={v => setF('l2_manager_id', v)} employees={employees} />
        <EmpSelect label="HOD" value={form.hod_id} onChange={v => setF('hod_id', v)} employees={employees} />
        <EmpSelect label="HR SPOC" value={form.hr_spoc_id} onChange={v => setF('hr_spoc_id', v)} employees={employees} />
        <Field label="Cost Centre"><input value={form.cost_centre || ''} onChange={e => setF('cost_centre', e.target.value)} style={T.input} placeholder="e.g. CC-TECH-001" /></Field>
        <Field label="Team Name"><input value={form.team_name || ''} onChange={e => setF('team_name', e.target.value)} style={T.input} placeholder="e.g. Platform" /></Field>
        <Field label="Shift">
          <select value={form.shift_id || ''} onChange={e => setF('shift_id', e.target.value)} style={T.input}>
            <option value="">Select…</option>
            {shifts.map((s: ShiftLite) => <option key={s.id} value={s.id}>{s.shift_code} ({s.in_time || '—'}–{s.out_time || '—'})</option>)}
          </select>
        </Field>
        <Field label="Induction Date *"><input type="date" value={form.induction_date || ''} onChange={e => setF('induction_date', e.target.value)} style={T.input} /></Field>
        <Field label="Probation (months)"><input type="number" value={form.probation_months ?? 6} onChange={e => setF('probation_months', Number(e.target.value))} style={T.input} /></Field>
        <Field label="Work Location Type">
          <select value={form.work_location_type || 'Office'} onChange={e => setF('work_location_type', e.target.value)} style={T.input}>
            <option>Office</option><option>WFH</option><option>Hybrid</option>
          </select>
        </Field>
      </div>
      <div style={{ marginTop:6, fontSize:12, color:MUTED }}>
        Confirmation date: <b style={{ color:TK.ink }}>{form.confirmation_date || '—'}</b> (DOJ + {form.probation_months ?? 6} months)
      </div>
    </div>
  )
}

function Step2Payroll({ form, setF, checks, dups }: any) {
  const bankVerified = !!(form?.form_data?.step_7?.penny_drop_verified || form?.form_data?.step_7?.bank_account)
  const AiRow = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
      <span style={{ color: ok ? GREEN : RED, fontWeight:700, width:14 }}>{ok ? '' : ''}</span>
      <span style={{ fontSize:12.5, color:TK.ink }}>{children}</span>
    </div>
  )
  return (
    <div>
      <div style={T.sectionH}>CTC & Payroll</div>
      <div style={T.g2}>
        <Field label="Annual CTC (₹)"><input type="number" value={form.annual_ctc ?? ''} onChange={e => setF('annual_ctc', Number(e.target.value))} style={T.input} /></Field>
        <Field label="Basic %"><input type="number" value={form.basic_pct ?? 50} onChange={e => setF('basic_pct', Number(e.target.value))} style={T.input} /></Field>
      </div>

      <div style={{ ...T.card2, background:TK.canvas, marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:PURPLE, marginBottom:6 }}>AI compliance checks</div>
        <AiRow ok={checks.basicOk}>Basic ≥ 50% of gross (Basic = {inr(checks.basicMonthly)}/mo, {checks.basicPct}%)</AiRow>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
          <span style={{ width:14 }} />
          <span style={{ fontSize:12.5, color:TK.ink }}>ESIC applicable: <b style={{ color: checks.esicApplicable ? GREEN : MUTED }}>{checks.esicApplicable ? 'Yes' : 'No'}</b> (monthly gross {inr(checks.monthlyGross)}, threshold ₹21,000)</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
          <span style={{ width:14 }} />
          <span style={{ fontSize:12.5, color:TK.ink }}>EPF wage: <b>{inr(checks.epfWage)}</b>{checks.epfCapped ? <span style={{ color:AMBER }}> (capped at ₹15,000)</span> : null}</span>
        </div>
      </div>

      {(dups.pan || dups.mobile || dups.aadhaar) && (
        <div style={{ background:TK.criticalTint, border:'1px solid #FECACA', borderRadius:8, padding:'10px 12px', marginBottom:14 }}>
          {dups.pan && <div style={{ color:RED, fontSize:12 }}>PAN already used by {dups.pan}</div>}
          {dups.mobile && <div style={{ color:RED, fontSize:12 }}>Mobile already used by {dups.mobile}</div>}
          {dups.aadhaar && <div style={{ color:RED, fontSize:12 }}>Aadhaar already used by {dups.aadhaar}</div>}
        </div>
      )}

      <div style={T.g2}>
        <Field label="TDS Regime">
          <select value={form.tds_regime || 'NEW'} onChange={e => setF('tds_regime', e.target.value)} style={T.input}>
            <option value="OLD">Old</option><option value="NEW">New</option>
          </select>
        </Field>
        <Field label="PF Wage Type">
          <select value={form.pf_wage_type || 'BASIC_DA'} onChange={e => setF('pf_wage_type', e.target.value)} style={T.input}>
            <option value="BASIC_DA">BASIC_DA</option><option value="GROSS_HRA">GROSS_HRA</option>
          </select>
        </Field>
        <Field label="PT State"><input value={form.pt_state || ''} onChange={e => setF('pt_state', e.target.value)} style={T.input} placeholder="e.g. Karnataka" /></Field>
        <div style={T.field}>
          <label style={T.label}>Statutory toggles</label>
          <Toggle label="PF applicable" checked={form.pf_applicable !== false} onChange={v => setF('pf_applicable', v)} />
          <Toggle label="LWF applicable" checked={!!form.lwf_applicable} onChange={v => setF('lwf_applicable', v)} />
        </div>
      </div>

      <div style={{ marginTop:6, fontSize:12.5, display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ color: bankVerified ? GREEN : RED, fontWeight:700 }}>{bankVerified ? '' : ''}</span>
        <span>Bank account {bankVerified ? 'verified' : 'NOT verified'}</span>
      </div>
    </div>
  )
}

function Step3ItAdmin({ form, setF }: any) {
  return (
    <div>
      <div style={T.sectionH}>IT & Admin checklists</div>
      <div style={T.g2}>
        <div style={T.card2}>
          <div style={{ fontSize:13, fontWeight:600, color:TK.ink, marginBottom:8 }}>IT</div>
          <Field label="Official Email"><input value={form.it_email || ''} onChange={e => setF('it_email', e.target.value)} style={T.input} placeholder="name@company.com" /></Field>
          <Toggle label="Email created" checked={!!form.it_email_created} onChange={v => setF('it_email_created', v)} />
          <Toggle label="Laptop issued" checked={!!form.it_laptop_issued} onChange={v => setF('it_laptop_issued', v)} />
          {form.it_laptop_issued && <Field label="Laptop Tag"><input value={form.it_laptop_tag || ''} onChange={e => setF('it_laptop_tag', e.target.value)} style={T.input} placeholder="e.g. LAP-2031" /></Field>}
          <Toggle label="System access done" checked={!!form.it_access_done} onChange={v => setF('it_access_done', v)} />
        </div>
        <div style={T.card2}>
          <div style={{ fontSize:13, fontWeight:600, color:TK.ink, marginBottom:8 }}>Admin</div>
          <Toggle label="ID card issued" checked={!!form.admin_id_card} onChange={v => setF('admin_id_card', v)} />
          <Field label="Access Card Number"><input value={form.admin_access_card || ''} onChange={e => setF('admin_access_card', e.target.value)} style={T.input} placeholder="e.g. AC-1029" /></Field>
          <Field label="Seating"><input value={form.admin_seating || ''} onChange={e => setF('admin_seating', e.target.value)} style={T.input} placeholder="e.g. F2-B3-S12" /></Field>
        </div>
      </div>
    </div>
  )
}

function Step4Approvals({ cand, onMark, onSendEmails, emailMsg, sending }: any) {
  const rows: { role: 'l1' | 'payroll' | 'it' | 'admin'; label: string; at: string | null; optional?: boolean }[] = [
    { role:'l1', label:'L1 / Reporting Manager', at: cand?.l1_approved_at },
    { role:'payroll', label:'Payroll', at: cand?.payroll_approved_at },
    { role:'it', label:'IT', at: cand?.it_approved_at, optional:true },
    { role:'admin', label:'Admin', at: cand?.admin_approved_at, optional:true },
  ]
  return (
    <div>
      <div style={T.sectionH}>Approvals</div>
      {rows.map(r => (
        <div key={r.role} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', border:'1px solid rgba(124,58,237,0.12)', borderRadius:8, marginBottom:8 }}>
          <span style={{ fontSize:13, color:TK.ink, fontWeight:500 }}>{r.label}{r.optional ? ' (optional)' : ''}</span>
          <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
            {r.at
              ? <span style={{ fontSize:10, padding:'3px 9px', borderRadius:99, background:TK.positiveTint, color:GREEN, fontWeight:600 }}>Approved {fmtDT(r.at)}</span>
              : <span style={{ fontSize:10, padding:'3px 9px', borderRadius:99, background:TK.warningTint, color:AMBER, fontWeight:600 }}>Pending</span>}
            {!r.at && <button onClick={() => onMark(r.role)} style={{ ...T.btnOut, padding:'5px 11px', fontSize:11 }}>Mark approved</button>}
          </span>
        </div>
      ))}
      <button onClick={onSendEmails} disabled={sending} style={{ ...T.btnPri, marginTop:6, opacity: sending ? 0.6 : 1 }}>
        {sending ? 'Sending…' : 'Send approval emails (L1 + Payroll)'}
      </button>
      {emailMsg && <div style={{ fontSize:12, color:MUTED, marginTop:8 }}>{emailMsg}</div>}
      <div style={{ fontSize:11.5, color:MUTED, marginTop:8, lineHeight:1.6 }}>
        Emails are informational. HR records the actual approval using the toggle above.
      </div>
    </div>
  )
}

function Step5Generate({ gates, genCode, setGenCode, codeType, codeLoading, candidate }: any) {
  const pass = allGatesPass(gates)
  return (
    <div>
      <div style={T.sectionH}>Hard-gate checklist</div>
      <div style={{ ...T.card2, marginBottom:14 }}>
        {gates.map((g: Gate) => <CheckRow key={g.key} ok={g.ok} label={g.label} optional={g.optional} />)}
      </div>

      <div style={{ marginBottom:14 }}>
        <label style={T.label}>Employee Code *</label>
        <input value={codeLoading ? '' : genCode} disabled={codeLoading} onChange={e => setGenCode(e.target.value.toUpperCase())} placeholder={codeLoading ? 'Auto-suggesting…' : 'e.g. SSMINT0001'}
          style={{ width:'100%', padding:'10px 12px', background: codeLoading ? TK.sunken : TK.sunken, border:`1.5px solid ${PURPLE}`, borderRadius:8, fontSize:15, color:TK.ink, outline:'none', fontFamily:'inherit', letterSpacing:1, fontWeight:500, boxSizing:'border-box', opacity: codeLoading ? 0.6 : 1 }} />
        {!codeLoading && genCode && (
          <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, fontSize:10, color:MUTED }}>
            <span>Auto-suggested · override if needed</span>
            <span style={{ marginLeft:'auto', padding:'1px 8px', borderRadius:99, background:TK.violetTint, color:TK.violetDeep, fontSize:10, fontWeight:600 }}>{codeType || candidate?.employment_type || 'Employee'}</span>
          </div>
        )}
        <div style={{ fontSize:10, color:MUTED, marginTop:4 }}>Format: [Company][Type][4 digits] · e.g. SSMINT0001 · unique &amp; never reused</div>
      </div>

      {!pass && <div style={{ background:TK.criticalTint, border:'1px solid #FECACA', borderRadius:8, padding:'9px 12px', fontSize:12, color:RED }}>Complete all required gates above to enable code generation.</div>}
    </div>
  )
}

// ── Parent ─────────────────────────────────────────────────────────
export default function ActivationWizard({ candidate, genCode, setGenCode, codeType, codeLoading, saving, onGenerate, onClose }: {
  candidate: any
  genCode: string; setGenCode: (v: string) => void
  codeType: string; codeLoading: boolean; saving: boolean
  onGenerate: () => void; onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [cand, setCand] = useState<ActivationCandidate | null>(null)
  const [employees, setEmployees] = useState<EmpLite[]>([])
  const [shifts, setShifts] = useState<ShiftLite[]>([])
  const [departments, setDepartments] = useState<DeptLite[]>([])
  const [form, setForm] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dups, setDups] = useState<{ pan: string | null; mobile: string | null; aadhaar: string | null }>({ pan:null, mobile:null, aadhaar:null })
  const [emailMsg, setEmailMsg] = useState('')
  const [sending, setSending] = useState(false)

  const setF = useCallback((key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value })), [])

  // Load + initialise editable form
  useEffect(() => {
    let active = true
    setLoading(true)
    loadActivationData(candidate.id).then(({ cand: c, employees: emps, shifts: sh, departments: dpt }) => {
      if (!active) return
      setCand(c); setEmployees(emps); setShifts(sh); setDepartments(dpt)
      setForm({
        ...(c || {}),
        probation_months: c?.probation_months ?? 6,
        basic_pct: c?.basic_pct ?? 50,
        annual_ctc: c?.annual_ctc ?? c?.offered_ctc ?? 0,
        tds_regime: c?.tds_regime ?? 'NEW',
        pf_wage_type: c?.pf_wage_type ?? 'BASIC_DA',
        pf_applicable: c?.pf_applicable ?? true,
        work_location_type: c?.work_location_type ?? 'Office',
      })
      setLoading(false)
    })
    return () => { active = false }
  }, [candidate.id])

  // Keep confirmation date in sync with DOJ + probation
  useEffect(() => {
    const doj = cand?.date_of_joining
    if (!doj) return
    const conf = addMonths(doj, form.probation_months ?? 6)
    if (conf && conf !== form.confirmation_date) setF('confirmation_date', conf)
  }, [cand?.date_of_joining, form.probation_months]) // eslint-disable-line react-hooks/exhaustive-deps

  // Run duplicate checks once cand is loaded / when entering step 2
  useEffect(() => {
    if (!cand || step !== 2) return
    const s7 = cand.form_data?.step_7 || {}
    const pan = s7.pan_number || null
    const aadhaar = (s7.aadhaar || '').toString().slice(-4) || null
    const mobile = cand.form_data?.step_4?.mobile || (cand as any).mobile || null
    checkDuplicates(pan, mobile, aadhaar).then(setDups)
  }, [cand, step])

  const checks: PayrollChecks = computePayrollChecks(form.annual_ctc || 0, form.basic_pct || 50)
  const gates: Gate[] = computeGates({ ...(cand || {}), ...form } as ActivationCandidate, checks)

  const persist = useCallback(async () => {
    setBusy(true)
    const { error } = await saveActivation(candidate.id, form)
    setBusy(false)
    return !error
  }, [candidate.id, form])

  const reloadCand = useCallback(async () => {
    const { cand: c } = await loadActivationData(candidate.id)
    if (c) setCand(c)
  }, [candidate.id])

  const next = async () => {
    if (step <= 3) await persist()
    if (step === 3) await persist() // before approvals step
    setStep(s => Math.min(5, s + 1))
  }
  const back = () => setStep(s => Math.max(1, s - 1))

  const markRole = async (role: 'l1' | 'payroll' | 'it' | 'admin') => {
    setBusy(true)
    await markApproval(candidate.id, role, 'HR')
    await reloadCand()
    setBusy(false)
  }

  const sendEmails = async () => {
    setSending(true); setEmailMsg('')
    try {
      const res = await fetch('/api/onboarding/activation-approval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_id: candidate.id, roles: ['l1', 'payroll'] }),
      })
      const data = await res.json()
      if (data.ok) setEmailMsg(`✓ Sent: ${(data.sent || []).join(', ') || 'none'}`)
      else setEmailMsg(`Skipped: ${data.reason || 'unknown reason'}`)
    } catch (e: any) {
      setEmailMsg('Failed to send: ' + (e?.message || 'error'))
    }
    setSending(false)
  }

  return (
    <div style={T.overlay} onClick={onClose}>
      <div style={T.card} onClick={e => e.stopPropagation()}>
        <div style={T.header}>
          <div style={T.hTitle}>HR Activation — {candidate.full_name}</div>
          <button onClick={onClose} style={T.closeBtn}>×</button>
        </div>

        <div style={T.body}>
          <Stepper step={step} />
          {loading
            ? <div style={{ padding:'40px 0', textAlign:'center', color:MUTED, fontSize:13 }}>Loading activation data…</div>
            : <>
                {step === 1 && <Step1Org cand={cand} form={form} setF={setF} employees={employees} shifts={shifts} departments={departments} />}
                {step === 2 && <Step2Payroll form={{ ...form, form_data: cand?.form_data }} setF={setF} checks={checks} dups={dups} />}
                {step === 3 && <Step3ItAdmin form={form} setF={setF} />}
                {step === 4 && <Step4Approvals cand={cand} onMark={markRole} onSendEmails={sendEmails} emailMsg={emailMsg} sending={sending} />}
                {step === 5 && <Step5Generate gates={gates} genCode={genCode} setGenCode={setGenCode} codeType={codeType} codeLoading={codeLoading} candidate={candidate} />}
              </>}
        </div>

        <div style={T.footer}>
          {step > 1 && <button onClick={back} style={T.btnOut} disabled={busy}>Back</button>}
          <span style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
            {step <= 3 && <button onClick={persist} style={T.btnOut} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
            {step < 5 && <button onClick={next} style={T.btnPri} disabled={busy || loading}>Next →</button>}
            {step === 5 && (
              <button onClick={onGenerate} disabled={!allGatesPass(gates) || !genCode.trim() || saving}
                style={{ ...T.btn, background: (allGatesPass(gates) && genCode.trim() && !saving) ? GREEN : TK.faint, color:'#fff', cursor: (allGatesPass(gates) && genCode.trim() && !saving) ? 'pointer' : 'not-allowed' }}>
                {saving ? 'Generating…' : `⚡ Generate ${genCode || 'code'} & unlock ESS`}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
