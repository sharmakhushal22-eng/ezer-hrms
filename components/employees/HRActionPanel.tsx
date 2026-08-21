'use client'
// components/employees/HRActionPanel.tsx — HR Action Panel tabs for the employee drawer.
// Tabs: Onboarding Info (read-only) · HR Actions (PIP/Sabbatical/Resignation/Abscond +
// approvals) · History. Slate palette to match employees/page.tsx. Sub-components OUTSIDE.
import { useState, useEffect, useCallback } from 'react'
import * as HR from '@/lib/employees/hr-actions'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const money = (n?: number | null) => (n == null) ? '—' : '₹' + Number(n).toLocaleString('en-IN')

const C = {
  card:  { background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #E2E8F0', marginBottom:10 } as React.CSSProperties,
  label: { fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.04em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 10px', background:TK.sunken, border:'1px solid #E2E8F0', borderRadius:7, color:TK.ink, fontSize:12.5, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  pri:   { padding:'8px 14px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.violet, color:'#fff' } as React.CSSProperties,
  out:   { padding:'7px 12px', borderRadius:7, border:'1px solid #E2E8F0', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.inkSoft } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:TK.inkSoft, marginBottom:8, display:'flex', alignItems:'center', gap:6 } as React.CSSProperties,
  g2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
}
const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const addDays = (iso: string, n: number) => { if (!iso) return ''; const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) }
const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10) }

function Row({ k, v }: { k: string; v: any }) {
  return <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}><span style={{ color:TK.muted }}>{k}</span><span style={{ fontWeight:600, color:TK.ink, textAlign:'right' }}>{v ?? '—'}</span></div>
}
function Banner({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return <div style={{ background:bg, border:`1px solid ${color}33`, borderLeft:`3px solid ${color}`, borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:12.5, color:TK.ink }}>{children}</div>
}

// ── Onboarding Info tab ─────────────────────────────────────────────
function OnboardingTab({ onb }: { onb: HR.OnboardingInfo | null }) {
  if (!onb) return <div style={{ ...C.card, color:TK.faint, textAlign:'center', padding:28 }}>Onboarding data not available for this employee (legacy/manual entry).</div>
  const f = onb.form_data || {}
  const p = f.step_3 || {}, ct = f.step_4 || {}, st = f.step_7 || {}, ins = st.insurance || {}, esic = st.esic_details || {}
  const perm = [ct.perm_line1, ct.perm_city, ct.perm_state, ct.perm_pin].filter(Boolean).join(', ')
  return (
    <div>
      <div style={C.card}>
        <div style={C.sec}>Onboarding Summary</div>
        <Row k="Employee Code" v={onb.employee_code} /><Row k="Onboarding Status" v={onb.status} />
        <Row k="ESIC Applicable" v={onb.esic_applicable ? 'Yes' : 'No'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Personal (from onboarding)</div>
        <Row k="Full Name" v={p.full_name} /><Row k="Date of Birth" v={p.dob ? fmt(p.dob) : '—'} />
        <Row k="Gender" v={p.gender} /><Row k="Father's Name" v={p.father_name || p.fatherSpouseName} />
        <Row k="Mother's Name" v={p.mother_name} /><Row k="Blood Group" v={p.blood_group} /><Row k="Marital Status" v={p.marital_status} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Contact & Address</div>
        <Row k="Mobile" v={ct.mobile} /><Row k="Personal Email" v={ct.personal_email} /><Row k="Permanent Address" v={perm || '—'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>KYC & Bank</div>
        <Row k="PAN" v={st.pan_number} /><Row k="Bank" v={st.bank_name} />
        <Row k="Account" v={st.bank_account ? `XXXX${String(st.bank_account).slice(-4)}` : '—'} /><Row k="IFSC" v={st.bank_ifsc} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Documents ({onb.documents.length})</div>
        {onb.documents.length === 0 && <div style={{ fontSize:12, color:TK.faint }}>No documents uploaded.</div>}
        {onb.documents.map((d, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
            <span>{d.doc_code} <span style={{ color:TK.faint }}>{d.file_name ? `· ${d.file_name}` : ''}</span></span>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: d.hr_verified ? TK.positiveTint : d.ai_status==='VERIFIED' ? TK.violetTint : TK.warningTint, color: d.hr_verified ? TK.positive : d.ai_status==='VERIFIED' ? TK.violet : TK.warning }}>
              {d.hr_verified ? 'HR Verified' : d.ai_status==='VERIFIED' ? 'AI ✓' : (d.ai_status || 'Uploaded')}
            </span>
          </div>
        ))}
      </div>
      <div style={C.card}>
        <div style={C.sec}>Statutory Forms</div>
        {onb.statutory_forms.length === 0 ? <div style={{ fontSize:12, color:TK.faint }}>None submitted.</div>
          : <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>{onb.statutory_forms.map((s, i) => <span key={i} style={{ fontSize:10, padding:'3px 9px', borderRadius:99, background:TK.violetTint, color:TK.violetDeep, fontWeight:600 }}>{s.form_type}</span>)}</div>}
      </div>
      {(ins.father_name || ins.spouse_name || esic.prev_ip) && (
        <div style={C.card}>
          <div style={C.sec}>Insurance / ESIC family</div>
          {ins.spouse_name && <Row k="Spouse" v={ins.spouse_name} />}
          {ins.father_name && <Row k="Father" v={ins.father_name} />}
          {ins.mother_name && <Row k="Mother" v={ins.mother_name} />}
          {esic.dispensary && <Row k="ESIC Dispensary" v={esic.dispensary} />}
        </div>
      )}
    </div>
  )
}

// ── Action forms ────────────────────────────────────────────────────
function PIPForm({ onSave }: { onSave: (p: any) => void }) {
  const [start, setStart] = useState(todayISO()); const [review, setReview] = useState(''); const [reason, setReason] = useState(''); const [goals, setGoals] = useState('')
  return (
    <div style={C.card}>
      <div style={C.sec}>Mark PIP (Performance Improvement Plan)</div>
      <div style={{ ...C.g2, marginBottom:8 }}>
        <div><label style={C.label}>Start Date</label><input type="date" style={C.input} value={start} onChange={e => setStart(e.target.value)} /></div>
        <div><label style={C.label}>Review Date</label><input type="date" style={C.input} value={review} onChange={e => setReview(e.target.value)} /></div>
      </div>
      <label style={C.label}>Reason</label><input style={{ ...C.input, marginBottom:8 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is PIP being started?" />
      <label style={C.label}>Goals</label><textarea style={{ ...C.input, minHeight:60, marginBottom:8, resize:'vertical' }} value={goals} onChange={e => setGoals(e.target.value)} placeholder="Improvement goals & metrics" />
      <button style={C.pri} onClick={() => { if (!start) return; onSave({ start_date: start, review_date: review || undefined, reason, goals }) }}>Start PIP</button>
    </div>
  )
}
function SabbaticalForm({ onSave }: { onSave: (p: any) => void }) {
  const [from, setFrom] = useState(todayISO()); const [to, setTo] = useState(''); const [reason, setReason] = useState('Personal')
  return (
    <div style={C.card}>
      <div style={C.sec}>Mark Sabbatical / Long Leave</div>
      <div style={{ ...C.g2, marginBottom:8 }}>
        <div><label style={C.label}>From</label><input type="date" style={C.input} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label style={C.label}>Expected Return</label><input type="date" style={C.input} value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      <label style={C.label}>Reason</label>
      <select style={{ ...C.input, marginBottom:8 }} value={reason} onChange={e => setReason(e.target.value)}>{['Medical','Education','Personal','Maternity'].map(r => <option key={r}>{r}</option>)}</select>
      <button style={C.pri} onClick={() => { if (!from) return; onSave({ from_date: from, to_date: to || undefined, reason }) }}>Mark Sabbatical</button>
    </div>
  )
}
function ResignationForm({ noticeDays, onSave }: { noticeDays: number; onSave: (p: any) => void }) {
  const [dor, setDor] = useState(todayISO())
  const [policyLwd, setPolicyLwd] = useState(addDays(todayISO(), noticeDays || 0))
  const [empLwd, setEmpLwd] = useState('')
  useEffect(() => { setPolicyLwd(addDays(dor, noticeDays || 0)) }, [dor, noticeDays])
  const shortfall = (policyLwd && empLwd) ? Math.max(0, Math.round((new Date(policyLwd).getTime() - new Date(empLwd).getTime())/86400000)) : 0
  return (
    <div style={C.card}>
      <div style={C.sec}>Initiate Resignation</div>
      <div style={{ ...C.g2, marginBottom:8 }}>
        <div><label style={C.label}>Date of Resignation</label><input type="date" style={C.input} value={dor} onChange={e => setDor(e.target.value)} /></div>
        <div><label style={C.label}>Notice Period (policy)</label><input style={{ ...C.input, background:TK.sunken }} value={`${noticeDays || 0} days`} readOnly /></div>
        <div><label style={C.label}>LWD as per policy</label><input type="date" style={C.input} value={policyLwd} onChange={e => setPolicyLwd(e.target.value)} /></div>
        <div><label style={C.label}>LWD confirmed by employee</label><input type="date" style={C.input} value={empLwd} onChange={e => setEmpLwd(e.target.value)} /></div>
      </div>
      {empLwd && (shortfall > 0
        ? <Banner color={TK.critical} bg={TK.criticalTint}><b>Notice shortfall = {shortfall} day(s).</b> A recovery mail will be sent to Payroll.</Banner>
        : <Banner color={TK.positive} bg={TK.positiveTint}>Full notice served — no recovery needed.</Banner>)}
      <button style={C.pri} onClick={() => { if (!dor || !empLwd) return; onSave({ date_of_resignation: dor, notice_period_days: noticeDays || 0, lwd_as_per_policy: policyLwd, lwd_confirmed_by_emp: empLwd }) }}>Initiate Resignation</button>
    </div>
  )
}
function AbscondForm({ onSave }: { onSave: (d: string) => void }) {
  const [from, setFrom] = useState(todayISO())
  return (
    <div style={C.card}>
      <div style={C.sec}>Mark Abscond</div>
      <label style={C.label}>Abscond from</label><input type="date" style={{ ...C.input, marginBottom:8, maxWidth:220 }} value={from} onChange={e => setFrom(e.target.value)} />
      <div style={{ fontSize:11, color:TK.faint, marginBottom:8 }}>Attendance will be marked as Abscond from this date until the employee returns.</div>
      <button style={{ ...C.pri, background:TK.critical }} onClick={() => { if (!from) return; onSave(from) }}>Mark Abscond</button>
    </div>
  )
}

function TransferForm({ employee, companies, branches, managers, shifts, departments, onIntra, onInter }: {
  employee: any; companies: any[]; branches: any[]; managers: any[]; shifts: any[]; departments: any[];
  onIntra: (p: any) => void; onInter: (p: any) => void
}) {
  const [mode, setMode] = useState<'INTRA' | 'INTER'>('INTRA')
  // INTRA state
  const [toBranch, setToBranch] = useState('')
  const [effDate, setEffDate] = useState(todayISO())
  const [mgr, setMgr] = useState('')
  const [desig, setDesig] = useState('')
  const [dept, setDept] = useState('')
  const [cc, setCc] = useState('')
  const [shift, setShift] = useState('')
  const [benefit, setBenefit] = useState<'NONE' | 'RELOCATION' | 'ONE_TIME_BONUS'>('NONE')
  const [benefitAmt, setBenefitAmt] = useState('')
  // INTER state
  const [toCompany, setToCompany] = useState('')
  const [iBranch, setIBranch] = useState('')
  const [iDept, setIDept] = useState('')
  const [iDesig, setIDesig] = useState('')
  const [transferDate, setTransferDate] = useState(todayISO())
  const [benefitMode, setBenefitMode] = useState<'REMAIN_SAME' | 'AS_PER_NEW_POLICY'>('REMAIN_SAME')

  const compBranches = branches.filter(b => b.company_id === employee?.company_id)
  const compShifts = shifts.filter(s => s.company_id === employee?.company_id)
  const compDepts = departments.filter(d => d.company_id === employee?.company_id)
  const otherCompanies = companies.filter(c => c.id !== employee?.company_id)
  const interBranches = branches.filter(b => b.company_id === toCompany)
  const interDepts = departments.filter(d => d.company_id === toCompany)

  // Mid-month warning (INTRA)
  const isMid = effDate ? new Date(effDate).getDate() !== 1 : false
  const fromBranch = branches.find(b => b.id === employee?.location_id)
  const tb = branches.find(b => b.id === toBranch)
  const midWarn = (() => {
    if (!isMid || !toBranch) return null
    if (tb && fromBranch && tb.state !== fromBranch.state)
      return `Effective date is mid-month. For this month, statutory (PT/LWF/PF) will be per the PREVIOUS state (${fromBranch.state}). New state (${tb.state}) applies next month.`
    return `Effective mid-month; statutory stays ${fromBranch?.state || tb?.state || '—'} this month.`
  })()

  const lastDay = transferDate ? addDays(transferDate, -1) : ''

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', borderRadius: 99, border: `1px solid ${active ? TK.violet : TK.line}`,
    background: active ? TK.violet : '#fff', color: active ? '#fff' : TK.muted,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div style={C.card}>
      <div style={C.sec}>Transfer Employee</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button style={pill(mode === 'INTRA')} onClick={() => setMode('INTRA')}>Location (same company)</button>
        <button style={pill(mode === 'INTER')} onClick={() => setMode('INTER')}>Inter-company</button>
      </div>

      {mode === 'INTRA' ? (
        <div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>To Branch</label>
              <select style={C.input} value={toBranch} onChange={e => setToBranch(e.target.value)}>
                <option value="">Select branch</option>
                {compBranches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.state ? ` · ${b.state}` : ''}</option>)}
              </select></div>
            <div><label style={C.label}>Effective Date</label><input type="date" style={C.input} value={effDate} onChange={e => setEffDate(e.target.value)} /></div>
          </div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>New Reporting Manager</label>
              <select style={C.input} value={mgr} onChange={e => setMgr(e.target.value)}>
                <option value="">— unchanged —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.emp_code ? ` (${m.emp_code})` : ''}</option>)}
              </select></div>
            <div><label style={C.label}>New Designation</label><input style={C.input} value={desig} onChange={e => setDesig(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>New Department</label>
              <select style={C.input} value={dept} onChange={e => setDept(e.target.value)}>
                <option value="">— unchanged —</option>
                {compDepts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select></div>
            <div><label style={C.label}>New Cost Centre</label><input style={C.input} value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>Shift</label>
              <select style={C.input} value={shift} onChange={e => setShift(e.target.value)}>
                <option value="">— unchanged —</option>
                {compShifts.map(s => <option key={s.id} value={s.id}>{s.shift_code}</option>)}
              </select></div>
            <div><label style={C.label}>Benefit</label>
              <select style={C.input} value={benefit} onChange={e => setBenefit(e.target.value as any)}>
                <option value="NONE">None</option><option value="RELOCATION">Relocation</option><option value="ONE_TIME_BONUS">One-time bonus</option>
              </select></div>
          </div>
          {benefit !== 'NONE' && <div style={{ marginBottom: 8 }}><label style={C.label}>Benefit Amount</label><input type="number" style={{ ...C.input, maxWidth: 220 }} value={benefitAmt} onChange={e => setBenefitAmt(e.target.value)} /></div>}
          {midWarn && <Banner color={TK.warning} bg={TK.warningTint}>⚠ {midWarn}</Banner>}
          <button style={C.pri} disabled={!toBranch || !effDate} onClick={() => {
            if (!toBranch || !effDate) return
            onIntra({
              to_branch_id: toBranch, effective_date: effDate,
              new_reporting_manager_id: mgr || undefined, new_designation: desig || undefined,
              new_department_id: dept || undefined, new_cost_centre: cc || undefined,
              new_shift_id: shift || undefined, benefit_type: benefit,
              benefit_amount: benefitAmt ? Number(benefitAmt) : undefined,
            })
          }}>Initiate Location Transfer</button>
        </div>
      ) : (
        <div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>To Company</label>
              <select style={C.input} value={toCompany} onChange={e => { setToCompany(e.target.value); setIBranch(''); setIDept('') }}>
                <option value="">Select company</option>
                {otherCompanies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select></div>
            <div><label style={C.label}>To Branch</label>
              <select style={C.input} value={iBranch} onChange={e => setIBranch(e.target.value)}>
                <option value="">Select branch</option>
                {interBranches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.state ? ` · ${b.state}` : ''}</option>)}
              </select></div>
          </div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>To Department</label>
              <select style={C.input} value={iDept} onChange={e => setIDept(e.target.value)}>
                <option value="">— optional —</option>
                {interDepts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select></div>
            <div><label style={C.label}>New Designation</label><input style={C.input} value={iDesig} onChange={e => setIDesig(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom: 8 }}>
            <div><label style={C.label}>Transfer Date</label><input type="date" style={C.input} value={transferDate} onChange={e => setTransferDate(e.target.value)} /></div>
            <div><label style={C.label}>Last Working Day (old company)</label><input style={{ ...C.input, background: TK.sunken }} value={lastDay ? fmt(lastDay) : '—'} readOnly /></div>
          </div>
          <div style={{ marginBottom: 8 }}><label style={C.label}>Benefit Mode</label>
            <select style={{ ...C.input, maxWidth: 260 }} value={benefitMode} onChange={e => setBenefitMode(e.target.value as any)}>
              <option value="REMAIN_SAME">Remain same</option><option value="AS_PER_NEW_POLICY">As per new policy</option>
            </select></div>
          <button style={C.pri} disabled={!toCompany || !iBranch || !transferDate} onClick={() => {
            if (!toCompany || !iBranch || !transferDate) return
            onInter({
              to_company_id: toCompany, to_branch_id: iBranch,
              to_department_id: iDept || undefined, new_designation: iDesig || undefined,
              transfer_date: transferDate, benefit_mode: benefitMode,
            })
          }}>Initiate Inter-company Transfer</button>
        </div>
      )}
    </div>
  )
}

// ── Documents tab (all docs submitted by the employee) ─────────────
function DocumentsView({ onb }: { onb: HR.OnboardingInfo | null }) {
  async function download(path: string | null) {
    if (!path) return
    const { data } = await supabase.storage.from('onboarding-docs').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else alert('Could not open the file.')
  }
  if (!onb || onb.documents.length === 0) return <div style={{ ...C.card, color:TK.faint, textAlign:'center', padding:28 }}>No documents submitted by this employee.</div>
  return (
    <div style={C.card}>
      <div style={C.sec}>Documents Submitted ({onb.documents.length})</div>
      {onb.documents.map((d, i) => (
        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:600 }}>{d.doc_code}</div>
            <div style={{ fontSize:10, color:TK.faint }}>{d.file_name || '—'}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: d.hr_verified ? TK.positiveTint : d.ai_status==='VERIFIED' ? TK.violetTint : TK.warningTint, color: d.hr_verified ? TK.positive : d.ai_status==='VERIFIED' ? TK.violet : TK.warning }}>
              {d.hr_verified ? 'HR Verified' : d.ai_status==='VERIFIED' ? 'AI ✓' : (d.ai_status || 'Uploaded')}
            </span>
            {d.storage_path && <button style={C.out} onClick={() => download(d.storage_path)}>Download</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Salary tab (CTC structure) ─────────────────────────────────────
// Salary-slip layout: identity + Monthly | Annual breakup (earnings → gross →
// employer cost → deductions → net → CTC summary).
function BreakupRow({ label, monthly, annual, kind }: { label: string; monthly: number; annual?: number; kind?: 'sub' | 'total' | 'net' | 'plain' }) {
  const bold = kind === 'sub' || kind === 'total' || kind === 'net'
  const bg = kind === 'total' ? TK.canvas : kind === 'sub' ? '#FAFAFE' : kind === 'net' ? TK.positiveTint : 'transparent'
  const color = kind === 'total' ? TK.violet : kind === 'net' ? TK.positive : TK.ink
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', padding:'7px 12px', background:bg, borderBottom:'1px solid #F1F5F9', fontSize:12.5 }}>
      <span style={{ color: bold ? color : TK.inkSoft, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ textAlign:'right', fontWeight: bold ? 700 : 500, color: bold ? color : TK.ink, fontVariantNumeric:'tabular-nums' }}>{money(monthly)}</span>
      <span style={{ textAlign:'right', fontWeight: bold ? 700 : 500, color: bold ? color : TK.muted, fontVariantNumeric:'tabular-nums' }}>{annual != null ? money(annual) : '—'}</span>
    </div>
  )
}

function SalaryView({ salary, employee }: { salary: HR.SalaryStructure | null; employee?: any }) {
  const d = salary?.detail
  if (!d) {
    if (!salary) return <div style={{ ...C.card, color:TK.faint, textAlign:'center', padding:28 }}>No salary structure on file. It is set during the recruitment CTC offer / onboarding.</div>
    // Legacy/onboarding path without a full breakup — keep the simple summary.
    return (
      <div>
        <div style={C.card}>
          <div style={C.sec}>CTC Summary</div>
          <Row k="Annual CTC" v={money(salary.offered_ctc)} />
          <Row k="Variable %" v={salary.variable_pct != null ? `${salary.variable_pct}%` : '—'} />
          <Row k="Monthly In-hand (est.)" v={money(salary.net_monthly)} />
          {salary.basic_monthly != null && <Row k="Basic (monthly)" v={money(salary.basic_monthly)} />}
          {salary.hra_monthly != null && <Row k="HRA (monthly)" v={money(salary.hra_monthly)} />}
        </div>
        <div style={{ fontSize:10, color:TK.faint, padding:'0 4px' }}>Indicative structure from the recruitment CTC offer.</div>
      </div>
    )
  }
  const M = (v: number) => v * 12

  // Simplified view for non-regular staff.
  // Intern / NAPS / NATS → Stipend + TDS (yes/no).  Consultant → Stipend + GST + TDS (yes/no).
  if (d.simpleKind) {
    const isConsultant = d.simpleKind === 'CONSULTANT'
    const stipend = d.stipend ?? d.net
    const rows: [string, number, number][] = [[isConsultant ? 'Stipend / Fee' : 'Stipend', stipend, M(stipend)]]
    if (isConsultant) rows.push(['GST (18%)', d.gst ?? 0, M(d.gst ?? 0)])
    return (
      <div>
        <div style={{ ...C.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '9px 12px', background: TK.ink, fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.03em' }}>
            <span>{isConsultant ? 'CONSULTANT PAY' : 'STIPEND'}</span>
            <span style={{ textAlign: 'right' }}>MONTHLY</span>
            <span style={{ textAlign: 'right' }}>ANNUAL</span>
          </div>
          {rows.map(([l, m, a]) => <BreakupRow key={l} label={l} monthly={m} annual={a} kind={l.startsWith('Stipend') ? 'sub' : 'plain'} />)}
          {/* TDS yes/no */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid #F1F5F9' }}>
            <span style={{ fontSize: 12.5, color: TK.inkSoft }}>TDS applicable</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 99, background: d.tds ? TK.criticalTint : TK.positiveTint, color: d.tds ? TK.critical : TK.positive }}>
              {d.tds ? 'Yes' : 'No'}{isConsultant && d.tds ? ' · 194J' : ''}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: TK.faint, padding: '0 4px' }}>
          {isConsultant ? 'Consultant professional fee. GST @18% and TDS u/s 194J apply where registered.' : 'Training stipend — no statutory deductions.'}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* CTC summary strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:10 }}>
        {[
          { l: 'Annual CTC', v: money(d.totalCtc || d.annualCtc), c: TK.violet, bg: TK.canvas },
          { l: 'Net Take-home / mo', v: money(d.net), c: TK.positive, bg: TK.positiveTint },
          { l: 'Fixed / mo', v: money(d.fixedMonthly), c: TK.ink, bg: TK.sunken },
        ].map(x => (
          <div key={x.l} style={{ background:x.bg, border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:TK.muted, textTransform:'uppercase', letterSpacing:'.04em', marginBottom:4 }}>{x.l}</div>
            <div style={{ fontSize:17, fontWeight:700, color:x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ ...C.card, padding:0, overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', padding:'9px 12px', background:TK.ink, fontSize:11, fontWeight:700, color:'#fff', letterSpacing:'.03em' }}>
          <span>SALARY STRUCTURE{d.payType && d.payType !== 'Regular' ? ` · ${d.payType}` : ''}</span>
          <span style={{ textAlign:'right' }}>MONTHLY</span>
          <span style={{ textAlign:'right' }}>ANNUAL</span>
        </div>

        {/* Earnings */}
        <BreakupRow label="Basic" monthly={d.basic} annual={M(d.basic)} />
        <BreakupRow label="HRA" monthly={d.hra} annual={M(d.hra)} />
        {d.statBonus > 0 && <BreakupRow label="Statutory Bonus" monthly={d.statBonus} annual={M(d.statBonus)} />}
        {d.conveyance > 0 && <BreakupRow label="Conveyance" monthly={d.conveyance} annual={M(d.conveyance)} />}
        {d.special > 0 && <BreakupRow label="Special Allowance" monthly={d.special} annual={M(d.special)} />}
        {d.flexiMonthly > 0 && <BreakupRow label="Flexi (declared)" monthly={d.flexiMonthly} annual={M(d.flexiMonthly)} />}
        <BreakupRow label="Gross" monthly={d.gross} annual={M(d.gross)} kind="sub" />

        {/* Employer cost */}
        {(d.erPf > 0 || d.erEsic > 0 || d.gratuity > 0) && <>
          {d.erPf > 0 && <BreakupRow label="Employer PF" monthly={d.erPf} annual={M(d.erPf)} />}
          {d.erEsic > 0 && <BreakupRow label="Employer ESIC" monthly={d.erEsic} annual={M(d.erEsic)} />}
          {d.gratuity > 0 && <BreakupRow label="Gratuity" monthly={d.gratuity} annual={M(d.gratuity)} />}
        </>}

        {/* Deductions */}
        {(d.eePf > 0 || d.eeEsic > 0 || d.pt > 0 || d.lwf > 0) && <>
          <div style={{ padding:'6px 12px', background:TK.criticalTint, fontSize:10, fontWeight:700, color:TK.critical, letterSpacing:'.04em' }}>DEDUCTIONS</div>
          {d.eePf > 0 && <BreakupRow label="Employee PF" monthly={d.eePf} annual={M(d.eePf)} />}
          {d.eeEsic > 0 && <BreakupRow label="Employee ESIC" monthly={d.eeEsic} annual={M(d.eeEsic)} />}
          {d.pt > 0 && <BreakupRow label="Professional Tax" monthly={d.pt} annual={M(d.pt)} />}
          {d.lwf > 0 && <BreakupRow label="LWF" monthly={d.lwf} annual={M(d.lwf)} />}
        </>}
        <BreakupRow label="Net Take-home" monthly={d.net} annual={M(d.net)} kind="net" />

        {/* CTC summary */}
        <BreakupRow label="Fixed" monthly={d.fixedMonthly} annual={M(d.fixedMonthly)} kind="sub" />
        {d.variableAnnual > 0 && <BreakupRow label="Variable" monthly={Math.round(d.variableAnnual / 12)} annual={d.variableAnnual} />}
        <BreakupRow label="Total CTC" monthly={Math.round(d.totalCtc / 12)} annual={d.totalCtc} kind="total" />
      </div>
      <div style={{ fontSize:10, color:TK.faint, padding:'0 4px' }}>FY 2026-27 salary structure. Monthly figures are pro-rated on actual paid days during payroll processing.</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MAIN PANEL
// ════════════════════════════════════════════════════════════════
export default function HRActionPanel({ employee, activeTab, onRefresh }: { employee: any; activeTab: string; onRefresh?: () => void }) {
  const [onb, setOnb] = useState<HR.OnboardingInfo | null>(null)
  const [salary, setSalary] = useState<HR.SalaryStructure | null>(null)
  const [states, setStates] = useState<HR.ActiveStates>({ pip: null, sabbatical: null, abscond: null, resignation: null })
  const [history, setHistory] = useState<HR.HRAction[]>([])
  const [requests, setRequests] = useState<HR.UpdateRequest[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [managers, setManagers] = useState<any[]>([])
  const [shifts, setShifts] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [toast, setToast] = useState<{ msg: string; type: 'success'|'error' } | null>(null)
  const by: HR.By = { name: 'HR' }
  const notify = (msg: string, type: 'success'|'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500) }

  const reload = useCallback(async () => {
    if (!employee?.id) return
    const [o, s, h, r, sal] = await Promise.all([
      HR.getOnboardingInfo(employee.id), HR.getActiveStates(employee.id),
      HR.getActionHistory(employee.id), HR.getPendingRequests(employee.id),
      HR.loadSalary(employee.id),
    ])
    setOnb(o); setStates(s); setHistory(h); setRequests(r); setSalary(sal)
    const [comp, br, mgr, sh, dep] = await Promise.all([
      supabase.from('companies').select('id, company_name, status').eq('status', 'Active'),
      supabase.from('locations').select('id, location_name, state, company_id, status').eq('status', 'Active'),
      supabase.from('employees').select('id, full_name, emp_code').eq('employment_status', 'Active'),
      supabase.from('shift_master').select('id, shift_code, company_id, is_active').eq('is_active', true),
      supabase.from('departments').select('id, dept_name, company_id, status').eq('status', 'Active'),
    ])
    setCompanies(comp.data || []); setBranches(br.data || []); setManagers(mgr.data || [])
    setShifts(sh.data || []); setDepartments(dep.data || [])
  }, [employee?.id])
  useEffect(() => { reload() }, [reload])

  const run = async (fn: () => Promise<HR.By extends never ? never : any>, okMsg: string) => {
    const res: any = await fn()
    if (res?.error) { notify('Failed: ' + (res.error.message || 'error'), 'error'); return }
    notify(okMsg); await reload(); onRefresh?.()
  }

  if (activeTab === 'onboarding') return (<div style={{ position:'relative' }}><OnboardingTab onb={onb} />{toast && <Toast t={toast} />}</div>)
  if (activeTab === 'documents') return <DocumentsView onb={onb} />
  if (activeTab === 'salary') return <SalaryView salary={salary} employee={employee} />

  if (activeTab === 'history') {
    const icon = (a: string) => a.startsWith('PIP') ? '' : a.startsWith('SAB') ? '' : a.startsWith('RESIG') ? '' : a.startsWith('ABSCOND') ? '' : a.startsWith('TRANSFER') ? '' : a.includes('APPROVE') ? '' : a.includes('REJECT') ? '' : ''
    return (
      <div style={{ position:'relative' }}>
        <div style={C.card}>
          <div style={C.sec}>Active Status</div>
          {!states.pip && !states.sabbatical && !states.abscond && !states.resignation && <div style={{ fontSize:12, color:TK.faint }}>No active PIP / sabbatical / abscond / resignation.</div>}
          {states.pip && <Banner color={TK.warning} bg={TK.warningTint}>PIP active since {fmt(states.pip.start_date)} (review {fmt(states.pip.review_date)})</Banner>}
          {states.sabbatical && <Banner color={TK.info} bg={TK.infoTint}>Sabbatical {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}</Banner>}
          {states.abscond && <Banner color={TK.critical} bg={TK.criticalTint}>Absconding since {fmt(states.abscond.abscond_from)}</Banner>}
          {states.resignation && <Banner color={TK.violet} bg={TK.violetTint}>Resignation {states.resignation.status} · LWD {fmt(states.resignation.lwd_confirmed_by_emp)}</Banner>}
        </div>
        <div style={C.card}>
          <div style={C.sec}>Action History</div>
          {history.length === 0 && <div style={{ fontSize:12, color:TK.faint }}>No actions yet.</div>}
          {history.map(a => (
            <div key={a.id} style={{ display:'flex', gap:8, padding:'7px 0', borderBottom:'1px solid #F1F5F9', alignItems:'flex-start' }}>
              <span style={{ fontSize:14 }}>{icon(a.action_type)}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:TK.inkSoft }}>{a.action_type.replace(/_/g,' ')}</div>
                <div style={{ fontSize:10, color:TK.faint }}>{a.performed_by_name || 'HR'} · {new Date(a.created_at).toLocaleString('en-IN')}</div>
              </div>
            </div>
          ))}
        </div>
        {toast && <Toast t={toast} />}
      </div>
    )
  }

  // activeTab === 'actions'
  return (
    <div style={{ position:'relative' }}>
      {/* Active banners + close actions */}
      {states.pip && <Banner color={TK.warning} bg={TK.warningTint}>📉 <b>PIP active</b> since {fmt(states.pip.start_date)}.
        <div style={{ marginTop:6, display:'flex', gap:6 }}>
          <button style={{ ...C.out, borderColor:'#A7F3D0', color:TK.positive }} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'PASSED', by), 'PIP closed — Passed')}>Mark Passed</button>
          <button style={{ ...C.out, borderColor:'#FCA5A5', color:TK.critical }} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'FAILED', by), 'PIP closed — Failed')}>Mark Failed</button>
        </div></Banner>}
      {states.sabbatical && <Banner color={TK.info} bg={TK.infoTint}>🌴 <b>On Sabbatical</b> {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}.
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.markSabbaticalReturned(states.sabbatical.id, employee.id, todayISO(), by), 'Marked returned')}>Mark Returned (today)</button></div></Banner>}
      {states.abscond && <Banner color={TK.critical} bg={TK.criticalTint}>🚷 <b>Absconding</b> since {fmt(states.abscond.abscond_from)}.
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.closeAbscond(states.abscond.id, employee.id, todayISO(), by), 'Abscond closed — returned')}>Close (returned today)</button></div></Banner>}
      {states.resignation && <Banner color={TK.violet} bg={TK.violetTint}>🚪 <b>Resignation {states.resignation.status}</b> · LWD {fmt(states.resignation.lwd_confirmed_by_emp)} · shortfall {states.resignation.notice_shortfall_days}d
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.withdrawResignation(states.resignation.id, employee.id, by), 'Resignation withdrawn')}>Withdraw</button></div></Banner>}

      {/* Approval requests */}
      {requests.length > 0 && (
        <div style={C.card}>
          <div style={C.sec}>Pending Approval Requests ({requests.filter(r => r.status==='PENDING').length})</div>
          {requests.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
              <div><div style={{ fontWeight:600 }}>{r.request_type}</div><div style={{ fontSize:10, color:TK.faint }}>{JSON.stringify(r.request_data).slice(0,50)} · {r.status}</div></div>
              {r.status === 'PENDING' && <div style={{ display:'flex', gap:6 }}>
                <button style={{ ...C.out, borderColor:'#A7F3D0', color:TK.positive }} onClick={() => run(() => HR.approveRequest(r.id, employee.id, by), 'Approved')}>Approve</button>
                <button style={{ ...C.out, borderColor:'#FCA5A5', color:TK.critical }} onClick={() => { const n = window.prompt('Rejection reason') || ''; run(() => HR.rejectRequest(r.id, employee.id, n, by), 'Rejected') }}>Reject</button>
              </div>}
            </div>
          ))}
        </div>
      )}

      {/* Action forms (hidden if a conflicting active state exists) */}
      {!states.pip && <PIPForm onSave={(p) => run(() => HR.markPIP(employee.id, p, by), 'PIP started')} />}
      {!states.sabbatical && <SabbaticalForm onSave={(p) => run(() => HR.markSabbatical(employee.id, p, by), 'Sabbatical marked')} />}
      {!states.resignation && <ResignationForm noticeDays={employee?.notice_period_days || 0} onSave={(p) => run(async () => {
        const res: any = await HR.initiateResignation(employee.id, p, by)
        if (res?.ok && res.recovery) notify(res.mailed ? `Resignation saved · recovery mail sent to payroll (${res.shortfall}d)` : `Resignation saved · recovery mail NOT sent (${res.mailError || 'check config'})`, res.mailed ? 'success' : 'error')
        return res
      }, 'Resignation initiated')} />}
      {!states.abscond && <AbscondForm onSave={(d) => run(() => HR.markAbscond(employee.id, d, by), 'Marked abscond')} />}
      {!states.resignation && !states.abscond && <TransferForm employee={employee} companies={companies} branches={branches} managers={managers} shifts={shifts} departments={departments}
        onIntra={(p) => run(() => HR.initiateLocationTransfer({ ...p, employee_ids: [employee.id] }, by), 'Location transfer initiated')}
        onInter={(p) => run(async () => { const r: any = await HR.initiateInterCompanyTransfer({ ...p, employee_id: employee.id }, by); if (r?.ok) notify(`Transfer initiated · onboarding pre-filled · last day ${r.last_day}`, 'success'); return r }, 'Company transfer initiated')} />}

      {toast && <Toast t={toast} />}
    </div>
  )
}

function Toast({ t }: { t: { msg: string; type: 'success'|'error' } }) {
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:99999, background: t.type==='success'?TK.positive:TK.critical, color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{t.type==='success'?'':''} {t.msg}</div>
}
