'use client'
// components/employees/HRActionPanel.tsx — HR Action Panel tabs for the employee drawer.
// Tabs: Onboarding Info (read-only) · HR Actions (PIP/Sabbatical/Exit/Abscond +
// approvals) · History. Slate palette to match employees/page.tsx. Sub-components OUTSIDE.
import { useState, useEffect, useCallback } from 'react'
import * as HR from '@/lib/employees/hr-actions'
import HrExitSection from './HrExitSection'
import { supabase } from '@/lib/supabase'
import { authHeaders } from '@/lib/auth-headers'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, S, R, E, Z, tone, numeric, eyebrow, inputStyle, Badge, type Tone } from '@/lib/ui'

const money = (n?: number | null) => (n == null) ? '-' : '₹' + Number(n).toLocaleString('en-IN')

// Same skins as the record sections in EmployeeProfileView: a card per group, a plain
// heading, labels above controls, 36px controls, and the system's button shapes.
const btnBase: React.CSSProperties = {
  height: 36, padding: '0 14px', borderRadius: R.md, cursor: 'pointer', fontSize: F.small,
  fontWeight: W.semi, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
}
const C = {
  card:  { background:TK.surface, borderRadius:R.lg, padding:`${S.lg}px ${S.lg + 2}px`, border:`1px solid ${TK.line}`, boxShadow:E.flat, marginBottom:S.md, minWidth:0 } as React.CSSProperties,
  label: { fontSize:F.tiny, fontWeight:W.medium, color:TK.muted, display:'block', marginBottom:5 } as React.CSSProperties,
  input: { ...inputStyle(), height:36, fontSize:F.small } as React.CSSProperties,
  pri:   { ...btnBase, background:`linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`, color:TK.onAccent, border:`1px solid ${TK.brandDeep}`, boxShadow:E.brand } as React.CSSProperties,
  danger:{ ...btnBase, background:TK.critical, color:TK.onAccent, border:`1px solid ${TK.critical}` } as React.CSSProperties,
  out:   { ...btnBase, height:32, padding:'0 12px', fontSize:F.tiny, background:TK.surface, color:TK.ink, border:`1px solid ${TK.lineStrong}`, boxShadow:E.flat } as React.CSSProperties,
  sec:   { fontSize:F.body, fontWeight:W.semi, color:TK.ink, marginBottom:S.md, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' } as React.CSSProperties,
  g2:    { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap:`${S.md}px ${S.lg}px` } as React.CSSProperties,
}
/** A secondary button tinted to the outcome it records — Passed, Approve, Reject. */
const outTone = (t: Tone): React.CSSProperties => ({ ...C.out, color: tone(t).fg, borderColor: tone(t).edge })
const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '-'
const addDays = (iso: string, n: number) => { if (!iso) return ''; const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) }
const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10) }

function Row({ k, v }: { k: string; v: any }) {
  const empty = v == null || v === '' || v === '-'
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:S.md, padding:'8px 0', borderBottom:`1px solid ${TK.line}`, fontSize:F.small }}>
      <span style={{ color:TK.muted }}>{k}</span>
      <span style={{ fontWeight: empty ? W.regular : W.semi, color: empty ? TK.faint : TK.ink, textAlign:'right', overflowWrap:'anywhere', ...numeric }}>{empty ? '-' : v}</span>
    </div>
  )
}
/** A state line. `t` picks the tone; the words always say the state too. */
function Banner({ t, children }: { t: Tone; children: React.ReactNode }) {
  const k = tone(t)
  return <div style={{ background:k.bg, border:`1px solid ${k.edge}`, borderLeft:`3px solid ${k.fg}`, borderRadius:R.md, padding:`${S.md - 2}px ${S.md}px`, marginBottom:S.md, fontSize:F.small, color:TK.ink, lineHeight:1.5 }}>{children}</div>
}
/** One quiet line inside a card, for "nothing here". */
function Quiet({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:F.small, color:TK.faint }}>{children}</div>
}
/** A whole tab with nothing in it. */
function EmptyCard({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ ...C.card, textAlign:'center', padding:`${S.xxl}px ${S.xl}px` }}>
      <div style={{ fontSize:F.lead, fontWeight:W.semi, color:TK.ink }}>{title}</div>
      {hint && <div style={{ fontSize:F.small, color:TK.muted, marginTop:4, lineHeight:1.55 }}>{hint}</div>}
    </div>
  )
}
/** "AADHAAR_FRONT" -> "Aadhaar front". The code is a storage key, not a label. */
const DOC_WORDS: Record<string, string> = { PAN: 'PAN', UAN: 'UAN', ID: 'ID', EXP: 'Experience', AADHAAR: 'Aadhaar' }
const docLabel = (code?: string | null) => {
  const parts = String(code || '').split(/[_\s]+/).filter(Boolean)
  if (!parts.length) return 'Document'
  return parts.map((p, i) => DOC_WORDS[p.toUpperCase()] ?? (i ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join(' ')
}
/** Document verification state. */
function DocBadge({ d }: { d: { hr_verified?: boolean | null; ai_status?: string | null } }) {
  return d.hr_verified ? <Badge t="positive">HR verified</Badge>
    : d.ai_status === 'VERIFIED' ? <Badge t="brand">AI verified</Badge>
    // "Failed" alone reads as if the upload failed; it is the automatic check.
    : d.ai_status === 'FAILED' ? <Badge t="warning">AI check failed</Badge>
    : <Badge t="warning">{d.ai_status ? String(d.ai_status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : 'Uploaded'}</Badge>
}

// ── Onboarding Info tab ─────────────────────────────────────────────
function OnboardingTab({ onb }: { onb: HR.OnboardingInfo | null }) {
  if (!onb) return <EmptyCard title="No onboarding record" hint="This employee was added directly or migrated, so there is no onboarding submission to show." />
  const f = onb.form_data || {}
  const p = f.step_3 || {}, ct = f.step_4 || {}, st = f.step_7 || {}, ins = st.insurance || {}, esic = st.esic_details || {}
  const perm = [ct.perm_line1, ct.perm_city, ct.perm_state, ct.perm_pin].filter(Boolean).join(', ')
  return (
    <div>
      <div style={C.card}>
        <div style={C.sec}>Onboarding summary</div>
        <Row k="Employee Code" v={onb.employee_code} /><Row k="Onboarding Status" v={onb.status} />
        <Row k="ESIC Applicable" v={onb.esic_applicable ? 'Yes' : 'No'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Personal (from onboarding)</div>
        <Row k="Full Name" v={p.full_name} /><Row k="Date of Birth" v={p.dob ? fmt(p.dob) : '-'} />
        <Row k="Gender" v={p.gender} /><Row k="Father's Name" v={p.father_name || p.fatherSpouseName} />
        <Row k="Mother's Name" v={p.mother_name} /><Row k="Blood Group" v={p.blood_group} /><Row k="Marital Status" v={p.marital_status} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Contact and address</div>
        <Row k="Mobile" v={ct.mobile} /><Row k="Personal Email" v={ct.personal_email} /><Row k="Permanent Address" v={perm || '-'} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>KYC and bank</div>
        <Row k="PAN" v={st.pan_number} /><Row k="Bank" v={st.bank_name} />
        <Row k="Account" v={st.bank_account ? `XXXX${String(st.bank_account).slice(-4)}` : '-'} /><Row k="IFSC" v={st.bank_ifsc} />
      </div>
      <div style={C.card}>
        <div style={C.sec}>Documents <Badge t="neutral" size="sm">{onb.documents.length}</Badge></div>
        {onb.documents.length === 0 && <Quiet>No documents uploaded.</Quiet>}
        {onb.documents.map((d, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:S.md, padding:'8px 0', borderTop: i ? `1px solid ${TK.line}` : 'none', fontSize:F.small }}>
            <span style={{ minWidth:0, overflowWrap:'anywhere' }}><span style={{ fontWeight:W.semi, color:TK.ink }}>{d.doc_code}</span> <span style={{ color:TK.muted }}>{d.file_name ? `· ${d.file_name}` : ''}</span></span>
            <DocBadge d={d} />
          </div>
        ))}
      </div>
      <div style={C.card}>
        <div style={C.sec}>Statutory forms</div>
        {onb.statutory_forms.length === 0 ? <Quiet>None submitted.</Quiet>
          : <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>{onb.statutory_forms.map((s, i) => <Badge key={i} t="brand">{s.form_type}</Badge>)}</div>}
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
      <div style={{ ...C.g2, marginBottom:S.md }}>
        <div><label style={C.label}>Start date</label><input type="date" style={C.input} value={start} onChange={e => setStart(e.target.value)} /></div>
        <div><label style={C.label}>Review date</label><input type="date" style={C.input} value={review} onChange={e => setReview(e.target.value)} /></div>
      </div>
      <label style={C.label}>Reason</label><input style={{ ...C.input, marginBottom:S.md }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is PIP being started?" />
      <label style={C.label}>Goals</label><textarea style={{ ...C.input, height:'auto', minHeight:72, padding:'8px 12px', lineHeight:1.5, marginBottom:S.md, resize:'vertical' }} value={goals} onChange={e => setGoals(e.target.value)} placeholder="Improvement goals & metrics" />
      <button style={C.pri} onClick={() => { if (!start) return; onSave({ start_date: start, review_date: review || undefined, reason, goals }) }}>Start PIP</button>
    </div>
  )
}
function SabbaticalForm({ onSave }: { onSave: (p: any) => void }) {
  const [from, setFrom] = useState(todayISO()); const [to, setTo] = useState(''); const [reason, setReason] = useState('Personal')
  return (
    <div style={C.card}>
      <div style={C.sec}>Mark sabbatical / long leave</div>
      <div style={{ ...C.g2, marginBottom:S.md }}>
        <div><label style={C.label}>From</label><input type="date" style={C.input} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label style={C.label}>Expected return</label><input type="date" style={C.input} value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      <label style={C.label}>Reason</label>
      <select style={{ ...C.input, marginBottom:S.md }} value={reason} onChange={e => setReason(e.target.value)}>{['Medical','Education','Personal','Maternity'].map(r => <option key={r}>{r}</option>)}</select>
      <button style={C.pri} onClick={() => { if (!from) return; onSave({ from_date: from, to_date: to || undefined, reason }) }}>Mark sabbatical</button>
    </div>
  )
}
function AbscondForm({ onSave }: { onSave: (d: string) => void }) {
  const [from, setFrom] = useState(todayISO())
  return (
    <div style={C.card}>
      <div style={C.sec}>Mark abscond</div>
      <label style={C.label}>Abscond from</label><input type="date" style={{ ...C.input, marginBottom:S.sm, maxWidth:220 }} value={from} onChange={e => setFrom(e.target.value)} />
      <div style={{ fontSize:F.tiny, color:TK.muted, marginBottom:S.md }}>Attendance will be marked as Abscond from this date until the employee returns.</div>
      <button style={C.danger} onClick={() => { if (!from) return; onSave(from) }}>Mark abscond</button>
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
    return `Effective mid-month; statutory stays ${fromBranch?.state || tb?.state || '-'} this month.`
  })()

  const lastDay = transferDate ? addDays(transferDate, -1) : ''

  const pill = (active: boolean): React.CSSProperties => ({
    height: 32, padding: '0 14px', borderRadius: R.pill, border: `1px solid ${active ? TK.brandEdge : TK.line}`,
    background: active ? TK.brandTint : TK.surface, color: active ? TK.brandDeep : TK.muted,
    fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div style={C.card}>
      <div style={C.sec}>Transfer employee</div>
      <div style={{ display: 'flex', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
        <button style={pill(mode === 'INTRA')} onClick={() => setMode('INTRA')}>Location (same company)</button>
        <button style={pill(mode === 'INTER')} onClick={() => setMode('INTER')}>Inter-company</button>
      </div>

      {mode === 'INTRA' ? (
        <div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>To branch</label>
              <select style={C.input} value={toBranch} onChange={e => setToBranch(e.target.value)}>
                <option value="">Select branch</option>
                {compBranches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.state ? ` · ${b.state}` : ''}</option>)}
              </select></div>
            <div><label style={C.label}>Effective date</label><input type="date" style={C.input} value={effDate} onChange={e => setEffDate(e.target.value)} /></div>
          </div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>New reporting manager</label>
              <select style={C.input} value={mgr} onChange={e => setMgr(e.target.value)}>
                <option value="">unchanged</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.emp_code ? ` (${m.emp_code})` : ''}</option>)}
              </select></div>
            <div><label style={C.label}>New designation</label><input style={C.input} value={desig} onChange={e => setDesig(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>New department</label>
              <select style={C.input} value={dept} onChange={e => setDept(e.target.value)}>
                <option value="">unchanged</option>
                {compDepts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select></div>
            <div><label style={C.label}>New cost centre</label><input style={C.input} value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>Shift</label>
              <select style={C.input} value={shift} onChange={e => setShift(e.target.value)}>
                <option value="">unchanged</option>
                {compShifts.map(s => <option key={s.id} value={s.id}>{s.shift_code}</option>)}
              </select></div>
            <div><label style={C.label}>Benefit</label>
              <select style={C.input} value={benefit} onChange={e => setBenefit(e.target.value as any)}>
                <option value="NONE">None</option><option value="RELOCATION">Relocation</option><option value="ONE_TIME_BONUS">One-time bonus</option>
              </select></div>
          </div>
          {benefit !== 'NONE' && <div style={{ marginBottom:S.md }}><label style={C.label}>Benefit amount</label><input type="number" style={{ ...C.input, maxWidth: 220 }} value={benefitAmt} onChange={e => setBenefitAmt(e.target.value)} /></div>}
          {midWarn && <Banner t="warning">{midWarn}</Banner>}
          <button style={C.pri} disabled={!toBranch || !effDate} onClick={() => {
            if (!toBranch || !effDate) return
            onIntra({
              to_branch_id: toBranch, effective_date: effDate,
              new_reporting_manager_id: mgr || undefined, new_designation: desig || undefined,
              new_department_id: dept || undefined, new_cost_centre: cc || undefined,
              new_shift_id: shift || undefined, benefit_type: benefit,
              benefit_amount: benefitAmt ? Number(benefitAmt) : undefined,
            })
          }}>Initiate location transfer</button>
        </div>
      ) : (
        <div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>To company</label>
              <select style={C.input} value={toCompany} onChange={e => { setToCompany(e.target.value); setIBranch(''); setIDept('') }}>
                <option value="">Select company</option>
                {otherCompanies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select></div>
            <div><label style={C.label}>To branch</label>
              <select style={C.input} value={iBranch} onChange={e => setIBranch(e.target.value)}>
                <option value="">Select branch</option>
                {interBranches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.state ? ` · ${b.state}` : ''}</option>)}
              </select></div>
          </div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>To department</label>
              <select style={C.input} value={iDept} onChange={e => setIDept(e.target.value)}>
                <option value="">optional</option>
                {interDepts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}
              </select></div>
            <div><label style={C.label}>New designation</label><input style={C.input} value={iDesig} onChange={e => setIDesig(e.target.value)} placeholder="optional" /></div>
          </div>
          <div style={{ ...C.g2, marginBottom:S.md }}>
            <div><label style={C.label}>Transfer date</label><input type="date" style={C.input} value={transferDate} onChange={e => setTransferDate(e.target.value)} /></div>
            <div><label style={C.label}>Last working day (old company)</label><input style={{ ...C.input, background: TK.sunken }} value={lastDay ? fmt(lastDay) : '-'} readOnly /></div>
          </div>
          <div style={{ marginBottom:S.md }}><label style={C.label}>Benefit mode</label>
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
          }}>Initiate inter-company transfer</button>
        </div>
      )}
    </div>
  )
}

// ── Documents tab (all docs submitted by the employee) ─────────────
/** Letters issued to the employee (generated_letters: People → Letters, the Letter of Appointment,
 *  HR Letters templates), on the Documents tab of the record — People → Employees → employee and
 *  the employee's own ESS profile. HR sees every letter, the ones kept out of ESS marked; the
 *  employee only the ones released to ESS (app/api/letters/employee decides). */
function IssuedLetters({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<{ id: string; name: string; doc_id: string | null; date: string; in_ess: boolean; sent_to: string | null; by: string | null }[] | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/letters/employee?employee_id=${encodeURIComponent(employeeId)}`, { headers: await authHeaders(), cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (alive) setRows(r.ok ? (j.letters || []) : [])
      } catch { if (alive) setRows([]) }
    })()
    return () => { alive = false }
  }, [employeeId])
  async function open(id: string) {
    setBusy(id)
    // Opened first, so the browser does not treat it as a popup once the signed link arrives.
    const w = window.open('', '_blank')
    try {
      const r = await fetch(`/api/letters/employee?employee_id=${encodeURIComponent(employeeId)}&file=${encodeURIComponent(id)}`, { headers: await authHeaders(), cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || 'Could not open the letter.')
      if (w) w.location.href = j.url; else window.open(j.url, '_blank')
    } catch (e: any) { w?.close(); alert(e.message) }
    setBusy('')
  }
  if (!rows || rows.length === 0) return null
  return (
    <div style={C.card}>
      <div style={C.sec}>Letters issued <Badge t="neutral" size="sm">{rows.length}</Badge></div>
      {rows.map((l, i) => (
        <div key={l.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:S.md, flexWrap:'wrap', padding:'10px 0', borderTop: i ? `1px solid ${TK.line}` : 'none', fontSize:F.small }}>
          <div style={{ minWidth:0, flex:'1 1 220px' }}>
            <div style={{ fontWeight:W.semi, color:TK.ink, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>{l.name}{!l.in_ess && <Badge t="warning" size="sm">Not in ESS</Badge>}</div>
            <div style={{ fontSize:F.tiny, color:TK.muted, overflowWrap:'anywhere' }}>{[l.doc_id, `Issued ${fmt(l.date)}`, l.sent_to ? `mailed to ${l.sent_to}` : null, l.by ? `by ${l.by}` : null].filter(Boolean).join(' · ')}</div>
          </div>
          <button style={C.out} disabled={busy === l.id} onClick={() => open(l.id)}>{busy === l.id ? 'Opening…' : 'Download'}</button>
        </div>
      ))}
    </div>
  )
}

function DocumentsView({ onb, employeeId }: { onb: HR.OnboardingInfo | null; employeeId: string }) {
  async function download(path: string | null) {
    if (!path) return
    const { data } = await supabase.storage.from('onboarding-docs').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else alert('Could not open the file.')
  }
  if (!onb || onb.documents.length === 0) return (
    <div>
      <IssuedLetters employeeId={employeeId} />
      <EmptyCard title="No documents yet" hint="Nothing has been submitted by this employee." />
    </div>
  )
  return (
    <div>
    <IssuedLetters employeeId={employeeId} />
    <div style={C.card}>
      <div style={C.sec}>Documents submitted <Badge t="neutral" size="sm">{onb.documents.length}</Badge></div>
      {onb.documents.map((d, i) => (
        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:S.md, flexWrap:'wrap', padding:'10px 0', borderTop: i ? `1px solid ${TK.line}` : 'none', fontSize:F.small }}>
          <div style={{ minWidth:0, flex:'1 1 200px' }}>
            <div style={{ fontWeight:W.semi, color:TK.ink }}>{docLabel(d.doc_code)}</div>
            <div style={{ fontSize:F.tiny, color:TK.muted, overflowWrap:'anywhere' }}>{d.file_name || 'No file name'}</div>
          </div>
          <div style={{ display:'flex', gap:S.sm, alignItems:'center', flexShrink:0 }}>
            <DocBadge d={d} />
            {d.storage_path && <button style={C.out} onClick={() => download(d.storage_path)}>Download</button>}
          </div>
        </div>
      ))}
    </div>
    </div>
  )
}

// ── Salary tab (CTC structure) ─────────────────────────────────────
// Salary-slip layout: identity + Monthly | Annual breakup (earnings → gross →
// employer cost → deductions → net → CTC summary).
function BreakupRow({ label, monthly, annual, kind }: { label: string; monthly: number; annual?: number; kind?: 'sub' | 'total' | 'net' | 'plain' }) {
  const bold = kind === 'sub' || kind === 'total' || kind === 'net'
  const bg = kind === 'total' ? TK.canvas : kind === 'sub' ? TK.brandTint : kind === 'net' ? TK.positiveTint : 'transparent'
  const color = kind === 'total' ? TK.brand : kind === 'net' ? TK.positive : TK.ink
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:S.sm, padding:'8px 14px', background:bg, borderBottom: `1px solid ${TK.line}`, fontSize:F.small }}>
      <span style={{ color: bold ? color : TK.inkSoft, fontWeight: bold ? W.bold : W.regular }}>{label}</span>
      <span style={{ textAlign:'right', fontWeight: bold ? W.bold : W.medium, color: bold ? color : TK.ink, ...numeric }}>{money(monthly)}</span>
      <span style={{ textAlign:'right', fontWeight: bold ? W.bold : W.medium, color: bold ? color : TK.muted, ...numeric }}>{annual != null ? money(annual) : '-'}</span>
    </div>
  )
}

function BreakupHead({ title }: { title: string }) {
  return (
    <div style={{ ...eyebrow, display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:S.sm, padding:'9px 14px', background:TK.sunken, borderBottom:`1px solid ${TK.line}` }}>
      <span>{title}</span><span style={{ textAlign:'right' }}>Monthly</span><span style={{ textAlign:'right' }}>Annual</span>
    </div>
  )
}
function Footnote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:F.tiny, color:TK.muted, padding:'0 2px', lineHeight:1.5 }}>{children}</div>
}

function SalaryView({ salary, employee }: { salary: HR.SalaryStructure | null; employee?: any }) {
  const d = salary?.detail
  if (!d) {
    if (!salary) return <EmptyCard title="No salary structure on file" hint="It is set from the recruitment CTC offer, or during onboarding." />
    // Legacy/onboarding path without a full breakup — keep the simple summary.
    return (
      <div>
        <div style={C.card}>
          <div style={C.sec}>CTC summary</div>
          <Row k="Annual CTC" v={money(salary.offered_ctc)} />
          <Row k="Variable %" v={salary.variable_pct != null ? `${salary.variable_pct}%` : '-'} />
          <Row k="Monthly In-hand (est.)" v={money(salary.net_monthly)} />
          {salary.basic_monthly != null && <Row k="Basic (monthly)" v={money(salary.basic_monthly)} />}
          {salary.hra_monthly != null && <Row k="HRA (monthly)" v={money(salary.hra_monthly)} />}
        </div>
        <Footnote>Indicative structure from the recruitment CTC offer.</Footnote>
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
          <BreakupHead title={isConsultant ? 'Consultant pay' : 'Stipend'} />
          {rows.map(([l, m, a]) => <BreakupRow key={l} label={l} monthly={m} annual={a} kind={l.startsWith('Stipend') ? 'sub' : 'plain'} />)}
          {/* TDS yes/no */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
            <span style={{ fontSize: F.small, color: TK.inkSoft }}>TDS applicable</span>
            <Badge t={d.tds ? 'warning' : 'positive'}>{d.tds ? 'Yes' : 'No'}{isConsultant && d.tds ? ' · 194J' : ''}</Badge>
          </div>
        </div>
        <Footnote>
          {isConsultant ? 'Consultant professional fee. GST @18% and TDS u/s 194J apply where registered.' : 'Training stipend. No statutory deductions.'}
        </Footnote>
      </div>
    )
  }

  return (
    <div>
      {/* CTC summary strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap:S.md, marginBottom:S.md }}>
        {[
          { l: 'Annual CTC', v: money(d.totalCtc || d.annualCtc), c: TK.ink },
          { l: 'Net take-home / month', v: money(d.net), c: TK.positive },
          { l: 'Fixed / month', v: money(d.fixedMonthly), c: TK.ink },
        ].map(x => (
          <div key={x.l} style={{ background:TK.surface, border: `1px solid ${TK.line}`, borderRadius:R.lg, boxShadow:E.flat, padding:`${S.md}px ${S.lg}px` }}>
            <div style={{ ...eyebrow, marginBottom:6 }}>{x.l}</div>
            <div style={{ fontSize:F.title, fontWeight:W.bold, color:x.c, letterSpacing:'-.01em', ...numeric }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ ...C.card, padding:0, overflow:'hidden' }}>
        <BreakupHead title={`Salary structure${d.payType && d.payType !== 'Regular' ? ` · ${d.payType}` : ''}`} />

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
          <div style={{ ...eyebrow, padding:'7px 14px', background:TK.sunken, borderBottom:`1px solid ${TK.line}` }}>Deductions</div>
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
      <Footnote>FY 2026-27 salary structure. Monthly figures are pro-rated on actual paid days during payroll processing.</Footnote>
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
  if (activeTab === 'documents') return <DocumentsView onb={onb} employeeId={employee.id} />
  if (activeTab === 'salary') return <SalaryView salary={salary} employee={employee} />

  if (activeTab === 'history') {
    // The kind of action decides the dot's tone; the words carry the meaning.
    const toneOf = (a: string): Tone => a.includes('REJECT') || a.startsWith('ABSCOND') ? 'critical'
      : a.includes('APPROVE') ? 'positive' : a.startsWith('PIP') || a.startsWith('RESIG') ? 'warning'
      : a.startsWith('SAB') || a.startsWith('TRANSFER') ? 'info' : 'neutral'
    return (
      <div style={{ position:'relative' }}>
        <div style={C.card}>
          <div style={C.sec}>Active status</div>
          {!states.pip && !states.sabbatical && !states.abscond && !states.resignation && <Quiet>No active PIP, sabbatical, abscond or resignation.</Quiet>}
          {states.pip && <Banner t="warning">PIP active since {fmt(states.pip.start_date)} (review {fmt(states.pip.review_date)})</Banner>}
          {states.sabbatical && <Banner t="info">Sabbatical {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}</Banner>}
          {states.abscond && <Banner t="critical">Absconding since {fmt(states.abscond.abscond_from)}</Banner>}
          {states.resignation && <Banner t="brand">Resignation {states.resignation.status} · LWD {fmt(states.resignation.lwd_confirmed_by_emp)}</Banner>}
        </div>
        <div style={C.card}>
          <div style={C.sec}>Action history</div>
          {history.length === 0 && <Quiet>No actions yet.</Quiet>}
          {history.map((a, i) => (
            <div key={a.id} style={{ display:'flex', gap:S.md, padding:'9px 0', borderTop: i ? `1px solid ${TK.line}` : 'none', alignItems:'flex-start' }}>
              <span aria-hidden style={{ width:8, height:8, borderRadius:'50%', background:tone(toneOf(a.action_type)).fg, marginTop:6, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:F.small, fontWeight:W.medium, color:TK.ink, textTransform:'capitalize' }}>{a.action_type.replace(/_/g,' ').toLowerCase()}</div>
                <div style={{ fontSize:F.tiny, color:TK.muted, ...numeric }}>{a.performed_by_name || 'HR'} · {new Date(a.created_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
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
      {states.pip && <Banner t="warning"><b>PIP active</b> since {fmt(states.pip.start_date)}.
        <div style={{ marginTop:S.sm, display:'flex', gap:6, flexWrap:'wrap' }}>
          <button style={outTone('positive')} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'PASSED', by), 'PIP closed: Passed')}>Mark passed</button>
          <button style={outTone('critical')} onClick={() => run(() => HR.closePIP(states.pip.id, employee.id, 'FAILED', by), 'PIP closed: Failed')}>Mark failed</button>
        </div></Banner>}
      {states.sabbatical && <Banner t="info"><b>On sabbatical</b> {fmt(states.sabbatical.from_date)} → {fmt(states.sabbatical.to_date)}.
        <div style={{ marginTop:S.sm }}><button style={C.out} onClick={() => run(() => HR.markSabbaticalReturned(states.sabbatical.id, employee.id, todayISO(), by), 'Marked returned')}>Mark returned (today)</button></div></Banner>}
      {states.abscond && <Banner t="critical"><b>Absconding</b> since {fmt(states.abscond.abscond_from)}.
        <div style={{ marginTop:S.sm }}><button style={C.out} onClick={() => run(() => HR.closeAbscond(states.abscond.id, employee.id, todayISO(), by), 'Abscond closed: returned')}>Close (returned today)</button></div></Banner>}
      {states.resignation && <Banner t="brand"><b>Resignation {states.resignation.status}</b> · LWD {fmt(states.resignation.lwd_confirmed_by_emp)} · shortfall {states.resignation.notice_shortfall_days}d
        <div style={{ marginTop:S.sm }}><button style={C.out} onClick={() => run(() => HR.withdrawResignation(states.resignation.id, employee.id, by), 'Resignation withdrawn')}>Withdraw</button></div></Banner>}

      {/* Approval requests */}
      {requests.length > 0 && (
        <div style={C.card}>
          <div style={C.sec}>Pending approval requests <Badge t="warning" size="sm">{requests.filter(r => r.status==='PENDING').length}</Badge></div>
          {requests.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:S.md, flexWrap:'wrap', padding:'9px 0', borderTop: `1px solid ${TK.line}`, fontSize:F.small }}>
              <div style={{ minWidth:0, flex:'1 1 220px' }}>
                <div style={{ fontWeight:W.semi, color:TK.ink }}>{r.request_type}</div>
                <div style={{ fontSize:F.tiny, color:TK.muted, overflowWrap:'anywhere' }}>{summarise(r.request_data)} · {r.status}</div>
              </div>
              {r.status === 'PENDING' && <div style={{ display:'flex', gap:6 }}>
                <button style={outTone('positive')} onClick={() => run(() => HR.approveRequest(r.id, employee.id, by), 'Approved')}>Approve</button>
                <button style={outTone('critical')} onClick={() => { const n = window.prompt('Rejection reason') || ''; run(() => HR.rejectRequest(r.id, employee.id, n, by), 'Rejected') }}>Reject</button>
              </div>}
            </div>
          ))}
        </div>
      )}

      {/* Action forms (hidden if a conflicting active state exists) */}
      {!states.pip && <PIPForm onSave={(p) => run(() => HR.markPIP(employee.id, p, by), 'PIP started')} />}
      {!states.sabbatical && <SabbaticalForm onSave={(p) => run(() => HR.markSabbatical(employee.id, p, by), 'Sabbatical marked')} />}
      {/* Exit (took the place of "Initiate resignation"): reason, approval flow, cancel / reset. */}
      <HrExitSection employeeId={employee.id} onChanged={() => { reload(); onRefresh?.() }} />
      {!states.abscond && <AbscondForm onSave={(d) => run(() => HR.markAbscond(employee.id, d, by), 'Marked abscond')} />}
      {!states.resignation && !states.abscond && <TransferForm employee={employee} companies={companies} branches={branches} managers={managers} shifts={shifts} departments={departments}
        onIntra={(p) => run(() => HR.initiateLocationTransfer({ ...p, employee_ids: [employee.id] }, by), 'Location transfer initiated')}
        onInter={(p) => run(async () => { const r: any = await HR.initiateInterCompanyTransfer({ ...p, employee_id: employee.id }, by); if (r?.ok) notify(`Transfer initiated · onboarding pre-filled · last day ${r.last_day}`, 'success'); return r }, 'Company transfer initiated')} />}

      {toast && <Toast t={toast} />}
    </div>
  )
}

function Toast({ t }: { t: { msg: string; type: 'success'|'error' } }) {
  return <div role="status" style={{ position:'fixed', bottom:24, right:24, zIndex:Z.toast, background: t.type==='success'?TK.positive:TK.critical, color:TK.onAccent, borderRadius:R.md, padding:'12px 18px', fontSize:F.small, fontWeight:W.medium, boxShadow:E.overlay, maxWidth:'min(420px, calc(100vw - 48px))' }}>{t.msg}</div>
}

/** A request's payload as "key: value" pairs, not raw JSON. */
function summarise(data: any): string {
  if (!data || typeof data !== 'object') return String(data ?? '-')
  const parts = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  const out = parts.join(' · ')
  return out.length > 120 ? out.slice(0, 117) + '…' : (out || '-')
}
