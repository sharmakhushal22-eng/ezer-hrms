'use client'
// components/employees/HRActionPanel.tsx — HR Action Panel tabs for the employee drawer.
// Tabs: Onboarding Info (read-only) · HR Actions (PIP/Sabbatical/Resignation/Abscond +
// approvals) · History. Slate palette to match employees/page.tsx. Sub-components OUTSIDE.
import { useState, useEffect, useCallback } from 'react'
import * as HR from '@/lib/employees/hr-actions'
import { supabase } from '@/lib/supabase'

const money = (n?: number | null) => (n == null) ? '—' : '₹' + Number(n).toLocaleString('en-IN')

const C = {
  card:  { background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #E2E8F0', marginBottom:10 } as React.CSSProperties,
  label: { fontSize:10, fontWeight:600, color:'#64748B', textTransform:'uppercase' as const, letterSpacing:'.04em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 10px', background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:7, color:'#0F172A', fontSize:12.5, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  pri:   { padding:'8px 14px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' } as React.CSSProperties,
  out:   { padding:'7px 12px', borderRadius:7, border:'1px solid #E2E8F0', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#475569' } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:'#374151', marginBottom:8, display:'flex', alignItems:'center', gap:6 } as React.CSSProperties,
  g2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
}
const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const addDays = (iso: string, n: number) => { if (!iso) return ''; const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) }
const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10) }

function Row({ k, v }: { k: string; v: any }) {
  return <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}><span style={{ color:'#64748B' }}>{k}</span><span style={{ fontWeight:600, color:'#0F172A', textAlign:'right' }}>{v ?? '—'}</span></div>
}
function Banner({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return <div style={{ background:bg, border:`1px solid ${color}33`, borderLeft:`3px solid ${color}`, borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:12.5, color:'#0F172A' }}>{children}</div>
}

// ── Onboarding Info tab ─────────────────────────────────────────────
function OnboardingTab({ onb }: { onb: HR.OnboardingInfo | null }) {
  if (!onb) return <div style={{ ...C.card, color:'#94A3B8', textAlign:'center', padding:28 }}>Onboarding data not available for this employee (legacy/manual entry).</div>
  const f = onb.form_data || {}
  const p = f.step_3 || {}, ct = f.step_4 || {}, st = f.step_7 || {}, ins = st.insurance || {}, esic = st.esic_details || {}
  const perm = [ct.perm_line1, ct.perm_city, ct.perm_state, ct.perm_pin].filter(Boolean).join(', ')
  return (
    <div>
      <div style={C.card}>
        <div style={C.sec}>📋 Onboarding Summary</div>
        <Row k="Employee Code" v={onb.employee_code} /><Row k="Onboarding Status" v={onb.status} />
        <Row k="ESIC Applicable" v={onb.esic_applicable ? 'Yes' : 'No'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>👤 Personal (from onboarding)</div>
        <Row k="Full Name" v={p.full_name} /><Row k="Date of Birth" v={p.dob ? fmt(p.dob) : '—'} />
        <Row k="Gender" v={p.gender} /><Row k="Father's Name" v={p.father_name || p.fatherSpouseName} />
        <Row k="Mother's Name" v={p.mother_name} /><Row k="Blood Group" v={p.blood_group} /><Row k="Marital Status" v={p.marital_status} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>📞 Contact & Address</div>
        <Row k="Mobile" v={ct.mobile} /><Row k="Personal Email" v={ct.personal_email} /><Row k="Permanent Address" v={perm || '—'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>🪪 KYC & Bank</div>
        <Row k="PAN" v={st.pan_number} /><Row k="Bank" v={st.bank_name} />
        <Row k="Account" v={st.bank_account ? `XXXX${String(st.bank_account).slice(-4)}` : '—'} /><Row k="IFSC" v={st.bank_ifsc} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>📎 Documents ({onb.documents.length})</div>
        {onb.documents.length === 0 && <div style={{ fontSize:12, color:'#94A3B8' }}>No documents uploaded.</div>}
        {onb.documents.map((d, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
            <span>{d.doc_code} <span style={{ color:'#94A3B8' }}>{d.file_name ? `· ${d.file_name}` : ''}</span></span>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: d.hr_verified ? '#DCFCE7' : d.ai_status==='VERIFIED' ? '#EDE9FE' : '#FEF3C7', color: d.hr_verified ? '#16A34A' : d.ai_status==='VERIFIED' ? '#7C3AED' : '#B45309' }}>
              {d.hr_verified ? '✓ HR Verified' : d.ai_status==='VERIFIED' ? 'AI ✓' : (d.ai_status || 'Uploaded')}
            </span>
          </div>
        ))}
      </div>
      <div style={C.card}>
        <div style={C.sec}>🏛️ Statutory Forms</div>
        {onb.statutory_forms.length === 0 ? <div style={{ fontSize:12, color:'#94A3B8' }}>None submitted.</div>
          : <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>{onb.statutory_forms.map((s, i) => <span key={i} style={{ fontSize:10, padding:'3px 9px', borderRadius:99, background:'#EDE9FE', color:'#6D28D9', fontWeight:600 }}>{s.form_type}</span>)}</div>}
      </div>
      {(ins.father_name || ins.spouse_name || esic.prev_ip) && (
        <div style={C.card}>
          <div style={C.sec}>🏥 Insurance / ESIC family</div>
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
      <div style={C.sec}>📉 Mark PIP (Performance Improvement Plan)</div>
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
      <div style={C.sec}>🌴 Mark Sabbatical / Long Leave</div>
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
      <div style={C.sec}>🚪 Initiate Resignation</div>
      <div style={{ ...C.g2, marginBottom:8 }}>
        <div><label style={C.label}>Date of Resignation</label><input type="date" style={C.input} value={dor} onChange={e => setDor(e.target.value)} /></div>
        <div><label style={C.label}>Notice Period (policy)</label><input style={{ ...C.input, background:'#F1F5F9' }} value={`${noticeDays || 0} days`} readOnly /></div>
        <div><label style={C.label}>LWD as per policy</label><input type="date" style={C.input} value={policyLwd} onChange={e => setPolicyLwd(e.target.value)} /></div>
        <div><label style={C.label}>LWD confirmed by employee</label><input type="date" style={C.input} value={empLwd} onChange={e => setEmpLwd(e.target.value)} /></div>
      </div>
      {empLwd && (shortfall > 0
        ? <Banner color="#DC2626" bg="#FEF2F2"><b>⚠ Notice shortfall = {shortfall} day(s).</b> A recovery mail will be sent to Payroll.</Banner>
        : <Banner color="#16A34A" bg="#DCFCE7">✓ Full notice served — no recovery needed.</Banner>)}
      <button style={C.pri} onClick={() => { if (!dor || !empLwd) return; onSave({ date_of_resignation: dor, notice_period_days: noticeDays || 0, lwd_as_per_policy: policyLwd, lwd_confirmed_by_emp: empLwd }) }}>Initiate Resignation</button>
    </div>
  )
}
function AbscondForm({ onSave }: { onSave: (d: string) => void }) {
  const [from, setFrom] = useState(todayISO())
  return (
    <div style={C.card}>
      <div style={C.sec}>🚷 Mark Abscond</div>
      <label style={C.label}>Abscond from</label><input type="date" style={{ ...C.input, marginBottom:8, maxWidth:220 }} value={from} onChange={e => setFrom(e.target.value)} />
      <div style={{ fontSize:11, color:'#94A3B8', marginBottom:8 }}>Attendance will be marked as Abscond from this date until the employee returns.</div>
      <button style={{ ...C.pri, background:'#DC2626' }} onClick={() => { if (!from) return; onSave(from) }}>Mark Abscond</button>
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
  if (!onb || onb.documents.length === 0) return <div style={{ ...C.card, color:'#94A3B8', textAlign:'center', padding:28 }}>No documents submitted by this employee.</div>
  return (
    <div style={C.card}>
      <div style={C.sec}>📎 Documents Submitted ({onb.documents.length})</div>
      {onb.documents.map((d, i) => (
        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:600 }}>{d.doc_code}</div>
            <div style={{ fontSize:10, color:'#94A3B8' }}>{d.file_name || '—'}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, fontWeight:600, background: d.hr_verified ? '#DCFCE7' : d.ai_status==='VERIFIED' ? '#EDE9FE' : '#FEF3C7', color: d.hr_verified ? '#16A34A' : d.ai_status==='VERIFIED' ? '#7C3AED' : '#B45309' }}>
              {d.hr_verified ? '✓ HR Verified' : d.ai_status==='VERIFIED' ? 'AI ✓' : (d.ai_status || 'Uploaded')}
            </span>
            {d.storage_path && <button style={C.out} onClick={() => download(d.storage_path)}>Download</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Salary tab (CTC structure) ─────────────────────────────────────
function SalaryView({ salary }: { salary: HR.SalaryStructure | null }) {
  if (!salary) return <div style={{ ...C.card, color:'#94A3B8', textAlign:'center', padding:28 }}>No salary structure on file. It is set during the recruitment CTC offer / onboarding.</div>
  const c = salary.calc || {}
  const line = (k: string, m?: number | null, ann?: number | null) => (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
      <span style={{ color:'#64748B' }}>{k}</span>
      <span style={{ fontWeight:600 }}>{money(m)}{ann != null ? ` · ${money(ann)}/yr` : ''}</span>
    </div>
  )
  return (
    <div>
      <div style={C.card}>
        <div style={C.sec}>💰 CTC Summary</div>
        <Row k="Annual CTC" v={money(salary.offered_ctc)} />
        <Row k="Variable %" v={salary.variable_pct != null ? `${salary.variable_pct}%` : '—'} />
        <Row k="Monthly In-hand (est.)" v={money(salary.net_monthly ?? c.inHand)} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>🧾 Monthly Structure</div>
        {line('Basic', salary.basic_monthly ?? c.basic)}
        {line('HRA', salary.hra_monthly ?? c.hra)}
        {c.statBonus != null && line('Statutory Bonus', c.statBonus)}
        {c.otherAllow != null && line('Other Allowance', c.otherAllow)}
        {c.gross != null && line('Gross', c.gross)}
      </div>
      {(c.epfEmployee != null || salary.epf_monthly != null) && (
        <div style={C.card}>
          <div style={C.sec}>➖ Deductions (monthly)</div>
          {line('EPF (employee)', salary.epf_monthly ?? c.epfEmployee)}
          {c.esicEmployee != null && line('ESIC (employee)', c.esicEmployee)}
          {c.ptMonthly != null && line('Professional Tax', c.ptMonthly)}
          {c.lwfMonthly != null && line('LWF', c.lwfMonthly)}
          {c.totalDed != null && line('Total Deductions', c.totalDed)}
        </div>
      )}
      <div style={{ fontSize:10, color:'#94A3B8', padding:'0 4px' }}>Indicative structure from the recruitment CTC offer. Final payroll figures may vary with IT declaration and policy.</div>
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
  }, [employee?.id])
  useEffect(() => { reload() }, [reload])

  const run = async (fn: () => Promise<HR.By extends never ? never : any>, okMsg: string) => {
    const res: any = await fn()
    if (res?.error) { notify('Failed: ' + (res.error.message || 'error'), 'error'); return }
    notify(okMsg); await reload(); onRefresh?.()
  }

  if (activeTab === 'onboarding') return (<div style={{ position:'relative' }}><OnboardingTab onb={onb} />{toast && <Toast t={toast} />}</div>)
  if (activeTab === 'documents') return <DocumentsView onb={onb} />
  if (activeTab === 'salary') return <SalaryView salary={salary} />

  if (activeTab === 'history') {
    const icon = (a: string) => a.startsWith('PIP') ? '📉' : a.startsWith('SAB') ? '🌴' : a.startsWith('RESIG') ? '🚪' : a.startsWith('ABSCOND') ? '🚷' : a.includes('APPROVE') ? '✅' : a.includes('REJECT') ? '❌' : '📌'
    return (
      <div style={{ position:'relative' }}>
        <div style={C.card}>
          <div style={C.sec}>🔎 Active Status</div>
          {!states.pip && !states.sabbatical && !states.abscond && !states.resignation && <div style={{ fontSize:12, color:'#94A3B8' }}>No active PIP / sabbatical / abscond / resignation.</div>}
          {states.pip && <Banner color="#D97706" bg="#FEF3C7">📉 PIP active since {fmt(states.pip.start_date)} (review {fmt(states.pip.review_date)})</Banner>}
          {states.sabbatical && <Banner color="#3B82F6" bg="#EFF6FF">🌴 Sabbatical {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}</Banner>}
          {states.abscond && <Banner color="#DC2626" bg="#FEF2F2">🚷 Absconding since {fmt(states.abscond.abscond_from)}</Banner>}
          {states.resignation && <Banner color="#7C3AED" bg="#EDE9FE">🚪 Resignation {states.resignation.status} · LWD {fmt(states.resignation.lwd_confirmed_by_emp)}</Banner>}
        </div>
        <div style={C.card}>
          <div style={C.sec}>📜 Action History</div>
          {history.length === 0 && <div style={{ fontSize:12, color:'#94A3B8' }}>No actions yet.</div>}
          {history.map(a => (
            <div key={a.id} style={{ display:'flex', gap:8, padding:'7px 0', borderBottom:'1px solid #F1F5F9', alignItems:'flex-start' }}>
              <span style={{ fontSize:14 }}>{icon(a.action_type)}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:'#374151' }}>{a.action_type.replace(/_/g,' ')}</div>
                <div style={{ fontSize:10, color:'#94A3B8' }}>{a.performed_by_name || 'HR'} · {new Date(a.created_at).toLocaleString('en-IN')}</div>
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
      {states.pip && <Banner color="#D97706" bg="#FEF3C7">📉 <b>PIP active</b> since {fmt(states.pip.start_date)}.
        <div style={{ marginTop:6, display:'flex', gap:6 }}>
          <button style={{ ...C.out, borderColor:'#A7F3D0', color:'#16A34A' }} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'PASSED', by), 'PIP closed — Passed')}>Mark Passed</button>
          <button style={{ ...C.out, borderColor:'#FCA5A5', color:'#DC2626' }} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'FAILED', by), 'PIP closed — Failed')}>Mark Failed</button>
        </div></Banner>}
      {states.sabbatical && <Banner color="#3B82F6" bg="#EFF6FF">🌴 <b>On Sabbatical</b> {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}.
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.markSabbaticalReturned(states.sabbatical.id, employee.id, todayISO(), by), 'Marked returned')}>Mark Returned (today)</button></div></Banner>}
      {states.abscond && <Banner color="#DC2626" bg="#FEF2F2">🚷 <b>Absconding</b> since {fmt(states.abscond.abscond_from)}.
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.closeAbscond(states.abscond.id, employee.id, todayISO(), by), 'Abscond closed — returned')}>Close (returned today)</button></div></Banner>}
      {states.resignation && <Banner color="#7C3AED" bg="#EDE9FE">🚪 <b>Resignation {states.resignation.status}</b> · LWD {fmt(states.resignation.lwd_confirmed_by_emp)} · shortfall {states.resignation.notice_shortfall_days}d
        <div style={{ marginTop:6 }}><button style={C.out} onClick={() => run(() => HR.withdrawResignation(states.resignation.id, employee.id, by), 'Resignation withdrawn')}>Withdraw</button></div></Banner>}

      {/* Approval requests */}
      {requests.length > 0 && (
        <div style={C.card}>
          <div style={C.sec}>📥 Pending Approval Requests ({requests.filter(r => r.status==='PENDING').length})</div>
          {requests.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F1F5F9', fontSize:12 }}>
              <div><div style={{ fontWeight:600 }}>{r.request_type}</div><div style={{ fontSize:10, color:'#94A3B8' }}>{JSON.stringify(r.request_data).slice(0,50)} · {r.status}</div></div>
              {r.status === 'PENDING' && <div style={{ display:'flex', gap:6 }}>
                <button style={{ ...C.out, borderColor:'#A7F3D0', color:'#16A34A' }} onClick={() => run(() => HR.approveRequest(r.id, employee.id, by), 'Approved')}>Approve</button>
                <button style={{ ...C.out, borderColor:'#FCA5A5', color:'#DC2626' }} onClick={() => { const n = window.prompt('Rejection reason') || ''; run(() => HR.rejectRequest(r.id, employee.id, n, by), 'Rejected') }}>Reject</button>
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

      {toast && <Toast t={toast} />}
    </div>
  )
}

function Toast({ t }: { t: { msg: string; type: 'success'|'error' } }) {
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:99999, background: t.type==='success'?'#059669':'#DC2626', color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{t.type==='success'?'✓':'✗'} {t.msg}</div>
}
