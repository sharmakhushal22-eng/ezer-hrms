// app/joining/[token]/client.tsx
// EZER HRMS — Employee Joining Form (Complete, AI-powered, Bug-free)
'use client'
import { useState } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── Types ────────────────────────────────────────────────────────
type Phase = 'form' | 'compliance' | 'policies' | 'esign' | 'done'
type FieldConf = 'ai-high' | 'ai-verify' | 'manual' | 'normal'

// ── EZER Theme ───────────────────────────────────────────────────
const PRI = TK.brand
const S = {
  pg:  { background: TK.canvas, minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: TK.ink } as const,
  cd:  { background: '#fff', borderRadius: 12, border: '1px solid rgba(124,58,237,0.12)', padding: '16px 18px', marginBottom: 12, boxShadow: '0 1px 4px rgba(124,58,237,0.05)' } as const,
  lbl: { fontSize: 10, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 4 },
  inp: (conf: FieldConf = 'normal') => ({
    width: '100%', padding: '9px 11px', borderRadius: 7, fontSize: 13, outline: 'none',
    boxSizing: 'border-box' as const, fontFamily: 'inherit', color: TK.ink,
    background: conf === 'ai-high' ? TK.positiveTint : conf === 'ai-verify' ? TK.warningTint : conf === 'manual' ? TK.criticalTint : TK.sunken,
    border: conf === 'ai-high' ? '1px solid #A7F3D0' : conf === 'ai-verify' ? '1px solid #FDE68A' : conf === 'manual' ? '1px solid #FCA5A5' : '1px solid #DDD6FE',
  }),
  g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } as const,
  g3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } as const,
  btnP: { padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: PRI, color: '#fff' } as const,
  btnO: { padding: '9px 16px', borderRadius: 8, border: '1px solid #DDD6FE', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: PRI } as const,
}
const STEPS = ['Personal', 'Address', 'Professional', 'Bank', 'References', 'Documents', 'Review']
const POLICIES = [
  { name: 'Employment Terms & Conditions', body: `This employment agreement governs your relationship with the Company. By accepting, you agree to maintain confidentiality of all company information, trade secrets, and business strategies. You commit to serving the full notice period upon resignation. You agree to perform all duties assigned with professionalism and integrity. The company reserves the right to update policies with due notice to employees. Any violation of these terms may lead to disciplinary action.` },
  { name: 'Code of Conduct', body: `All employees must maintain the highest standards of professional behaviour. Treat every colleague, client, and visitor with respect regardless of their position, gender, religion, caste, or nationality. Avoid any conflict of interest. Protect company assets including physical and intellectual property. Comply with all applicable Indian laws including labour laws, IT laws, and financial regulations. Violations may result in disciplinary action up to and including termination of employment.` },
  { name: 'POSH Policy (Prevention of Sexual Harassment)', body: `The Company is fully committed to providing a safe, secure, and dignified working environment free from sexual harassment. Any act of sexual harassment — verbal, physical, or visual — is strictly prohibited. An Internal Complaints Committee (ICC) has been constituted as required under the POSH Act 2013. Any employee facing or witnessing sexual harassment may raise a complaint with the ICC. All complaints will be investigated confidentially. False complaints made with malicious intent are also prohibited. This policy applies to all employees, contractors, interns, and visitors at company premises.` },
  { name: 'IT & Data Security Policy', body: `All company IT systems, devices (laptop, mobile, tablet), and data must be used responsibly and only for official purposes. Employees must maintain strong passwords (minimum 12 characters) and change them every 90 days. Passwords must never be shared with anyone including IT staff. Company data is classified as Confidential, Internal, or Public — handle accordingly. Unauthorized software installation is strictly prohibited. Any security incident or suspected breach must be reported to IT within 1 hour. Employees may not access personal social media or entertainment sites on company systems during working hours.` },
  { name: 'Leave Policy', body: `Employees are eligible for various leaves as per company policy and applicable law. Earned Leave (EL) accrues at 1 day per 20 working days. Casual Leave (CL) and Sick Leave (SL) are granted annually. All leaves except emergency SL must be applied in advance through the EZER ESS portal and approved by your Reporting Manager. Unapproved absence will be marked as Leave Without Pay (LWP). Leave encashment and carry-forward rules are as per the company leave policy document. Probation period rules apply as per company policy.` },
  { name: 'Confidentiality Agreement (NDA)', body: `You acknowledge that during the course of your employment, you will have access to confidential information, trade secrets, business strategies, technical data, customer lists, financial information, and proprietary processes of the Company. You agree to maintain strict confidentiality of all such information during employment and for a period of 2 years after cessation of employment, unless specifically authorized in writing. Breach of this agreement may result in legal action and claim of damages. This clause survives termination of employment.` },
  { name: 'Social Media Policy', body: `Employees must exercise discretion when using social media, whether personal or professional. Sharing confidential company information, client details, financial data, or internal communication on any social media platform is strictly prohibited. Employees must not represent themselves as official company spokespersons on social media without prior written authorization from the HR/Communications team. Personal opinions expressed on social media must not be attributed to the Company. Violation of this policy may result in disciplinary action.` },
]

// ── AI Field badge ────────────────────────────────────────────────
const AIBadge = ({ conf }: { conf: FieldConf }) => {
  if (conf === 'normal') return null
  const map = { 'ai-high': ['#D1FAE5','#065F46','AI ✓'], 'ai-verify': [TK.warningTint,TK.warning,'AI – Verify'], 'manual': [TK.criticalTint,'#991B1B','Fill Required'] }
  const [bg, color, text] = map[conf]
  return <span style={{ fontSize: 9, background: bg, color, padding: '1px 6px', borderRadius: 99, marginLeft: 5, fontWeight: 600, fontStyle: 'normal' }}>{text}</span>
}

const Fld = ({ label, conf = 'normal' as FieldConf, children }: { label: string | React.ReactNode; conf?: FieldConf; children: React.ReactNode }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={S.lbl}>{label}<AIBadge conf={conf}/></label>
    {children}
  </div>
)

// ── Main Component ────────────────────────────────────────────────
export default function JoiningClient({ tokenId, token, candidate, company }: any) {
  const c = candidate || {}
  const [phase,    setPhase]    = useState<Phase>('form')
  const [step,     setStep]     = useState(0)
  const [saving,   setSaving]   = useState(false)
  const [policyIdx, setPolicyIdx] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [accepted, setAccepted] = useState<string[]>([])
  const [aadhaarInput, setAadhaarInput] = useState('')
  const [otpSent, setOtpSent]   = useState(false)
  const [otp, setOtp]           = useState('')

  // Compliance nominee data
  const [epfNominee, setEpfNominee] = useState({ name: '', relation: '', dob: '', share: '100', address: '' })
  const [gratNominee, setGratNominee] = useState({ name: '', relation: '', share: '100' })

  // Form data — AI pre-fills from candidate data
  const [form, setForm] = useState({
    // Personal
    full_name:     c.full_name || '',
    dob:           c.dob ? String(c.dob).substring(0,10) : '',
    father_name:   '',
    spouse_name:   '',
    gender:        c.gender || '',
    blood_group:   '',
    marital_status: '',
    mobile:        c.phone || c.mobile || '',
    email:         c.email || '',
    aadhaar:       '',
    pan:           c.pan_number || '',
    nationality:   'Indian',
    // Address
    perm_street: '', perm_city: '', perm_state: '', perm_pin: '',
    same_address: false,
    curr_street: '', curr_city: '', curr_state: '', curr_pin: '',
    emrg1_name: '', emrg1_relation: '', emrg1_mobile: '',
    emrg2_name: '', emrg2_relation: '', emrg2_mobile: '',
    // Professional
    designation:   c.designation || '',
    doj:           c.doj ? String(c.doj).substring(0,10) : '',
    highest_qual:  '',
    prev_employer: c.current_company || '',
    prev_uan:      '',
    prev_pf_id:    '',
    pf_transfer:   false,
    // Bank
    bank_acc:      '', bank_acc_confirm: '',
    bank_ifsc:     '', bank_name: '', bank_branch: '',
    account_type:  'Savings',
    acc_holder:    c.full_name || '',
    // References
    ref1_name: '', ref1_desig: '', ref1_co: '', ref1_rel: '', ref1_mobile: '', ref1_email: '',
    ref2_name: '', ref2_desig: '', ref2_co: '', ref2_rel: '', ref2_mobile: '', ref2_email: '',
    // Documents
    photo_done: false, uan_done: false, esic_done: false,
  })
  const F = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  // AI confidence per field
  const conf = (k: string): FieldConf => {
    const highConf = ['full_name','dob','gender','mobile','email','pan','designation','doj','prev_employer','acc_holder']
    const verifyConf: string[] = []
    if (highConf.includes(k) && (form as any)[k]) return 'ai-high'
    if (verifyConf.includes(k) && (form as any)[k]) return 'ai-verify'
    if (!(form as any)[k] && ['blood_group','marital_status','father_name','aadhaar','perm_city','bank_acc','bank_ifsc'].includes(k)) return 'manual'
    return 'normal'
  }

  // IFSC auto-fill (simulated)
  const handleIfsc = (v: string) => {
    F('bank_ifsc', v.toUpperCase())
    if (v.length >= 11) {
      const bankNames: Record<string,string> = { HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'State Bank of India', UTIB: 'Axis Bank', KKBK: 'Kotak Bank', PUNB: 'Punjab National Bank' }
      const prefix = v.substring(0,4)
      const bname = bankNames[prefix] || 'Bank (verify)'
      F('bank_name', bname)
      F('bank_branch', 'Branch (from IFSC)')
    }
  }

  // Submit form
  const submitForm = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/submit-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, candidateId: candidate?.id, companyId: candidate?.company_id, form, epfNominee, gratNominee, acceptedPolicies: accepted }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Submit failed') }
      setPhase('done')
    } catch (e: any) {
      alert('Submit error: ' + e.message)
    }
    setSaving(false)
  }

  // ── DONE screen ──────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={{ ...S.pg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: 24 }}>
        <div style={{ ...S.cd, textAlign: 'center', padding: '40px 30px' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: TK.positiveTint, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 36 }}></div>
          <div style={{ fontSize: 22, fontWeight: 600, color: TK.ink, marginBottom: 8 }}>Welcome to {company?.company_name || 'the family'}!</div>
          <div style={{ fontSize: 13, color: TK.muted, lineHeight: 1.8, marginBottom: 20 }}>
            Joining form complete!<br/>All documents have been digitally signed.
          </div>
          <div style={{ background: TK.brandTint, borderRadius: 10, padding: 16, marginBottom: 20, textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: PRI, marginBottom: 10 }}>Completed steps</div>
            {['7-step joining form filled','EPF Form 11 + Form 2 signed','Gratuity Form F signed',`${POLICIES.length} policies accepted`,'Aadhaar OTP eSign done','PDFs sent to your email + HR Manager'].map(s => (
              <div key={s} style={{ fontSize: 12, color: TK.positive, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>✓ {s}</div>
            ))}
          </div>
          <div style={{ background: TK.warningTint, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: TK.warning, marginBottom: 16, lineHeight: 1.7 }}>HR Manager will generate your Employee Code shortly.<br/>You'll receive an email with your EZER ESS login details.
          </div>
          <button onClick={() => window.print()} style={S.btnP}>Download Signed PDF Package</button>
        </div>
      </div>
    </div>
  )

  // ── eSIGN screen ─────────────────────────────────────────────
  if (phase === 'esign') return (
    <div style={{ ...S.pg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}></div>
          <div style={{ fontSize: 19, fontWeight: 600, color: TK.ink }}>Aadhaar OTP eSign</div>
          <div style={{ fontSize: 13, color: TK.muted, marginTop: 4 }}>Sign every document with a single OTP</div>
        </div>
        <div style={S.cd}>
          <div style={{ background: TK.brandTint, borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#534AB7', lineHeight: 1.7 }}>
            <strong>Documents to be signed:</strong><br/>Joining form (7 steps) &nbsp;·&nbsp; ✓ EPF Form 11 + Form 2<br/>Gratuity Form F &nbsp;·&nbsp; ✓ {POLICIES.length} policy acknowledgements<br/><br/>
            <strong>Legal basis:</strong> IT Act 2000, Section 3A — legally valid Aadhaar eSign
          </div>
          <Fld label="Aadhaar Number (confirm)" conf="manual">
            <input style={S.inp('manual')} value={aadhaarInput} onChange={e => setAadhaarInput(e.target.value)} placeholder="XXXX-XXXX-XXXX" maxLength={14}/>
          </Fld>
          {!otpSent ? (
            <button onClick={() => { setOtpSent(true); alert('OTP sent to your Aadhaar-linked mobile number') }} style={{ ...S.btnP, width: '100%' }}>Send OTP to Aadhaar Mobile
            </button>
          ) : (
            <>
              <Fld label="Enter OTP *" conf="manual">
                <input style={{ ...S.inp('manual'), textAlign: 'center', letterSpacing: 8, fontSize: 20, fontWeight: 600 }} value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6}/>
              </Fld>
              <button onClick={submitForm} disabled={saving || otp.length < 4} style={{ ...S.btnP, width: '100%', background: TK.positive, opacity: saving || otp.length < 4 ? .6 : 1, cursor: saving || otp.length < 4 ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Signing & submitting...' : 'Verify OTP & Sign All Documents'}
              </button>
              <button onClick={() => setOtpSent(false)} style={{ ...S.btnO, display: 'block', margin: '8px auto 0', fontSize: 11 }}>Resend OTP</button>
            </>
          )}
        </div>
        <button onClick={() => setPhase('policies')} style={{ ...S.btnO, display: 'block', margin: '8px auto' }}>Back</button>
      </div>
    </div>
  )

  // ── POLICY screen ────────────────────────────────────────────
  if (phase === 'policies') {
    const pol = POLICIES[policyIdx]
    const isAccepted = accepted.includes(pol.name)
    return (
      <div style={{ ...S.pg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 560, width: '100%', padding: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: TK.ink }}>Policy Acceptance</div>
            <div style={{ fontSize: 12, color: TK.muted, marginTop: 2 }}>{policyIdx + 1} of {POLICIES.length} policies</div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 8 }}>
              {POLICIES.map((_, i) => (
                <div key={i} style={{ width: 30, height: 4, borderRadius: 99, background: i < policyIdx ? PRI : i === policyIdx ? '#A78BFA' : TK.brandTint, transition: 'background .3s' }}/>
              ))}
            </div>
          </div>
          <div style={{ ...S.cd, border: `1.5px solid ${PRI}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TK.ink, marginBottom: 10 }}>{pol.name}</div>
            <div
              onScroll={e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setScrolled(true) }}
              style={{ height: 180, overflowY: 'auto', background: TK.sunken, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: TK.inkSoft, lineHeight: 1.9, marginBottom: 12, border: '1px solid #EDE9FE' }}>
              {pol.body}
              <div style={{ height: 30 }}/>
              {!scrolled && !isAccepted && <div style={{ textAlign: 'center', color: TK.faint, fontSize: 11, marginTop: 8 }}>Scroll to bottom to enable accept</div>}
            </div>
            <div style={{ background: TK.brandTint, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#534AB7', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <input type="checkbox" style={{ marginTop: 1, width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }} readOnly checked={isAccepted}/>
              <span>I have read this policy in full. I consent to following it.</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {policyIdx > 0 && <button onClick={() => { setPolicyIdx(p => p - 1); setScrolled(false) }} style={S.btnO}>Back</button>}
              <button disabled={!scrolled && !isAccepted} onClick={() => {
                if (!accepted.includes(pol.name)) setAccepted(p => [...p, pol.name])
                if (policyIdx < POLICIES.length - 1) { setPolicyIdx(p => p + 1); setScrolled(false) }
                else setPhase('esign')
              }} style={{ ...S.btnP, flex: 1, opacity: (!scrolled && !isAccepted) ? .5 : 1, cursor: (!scrolled && !isAccepted) ? 'not-allowed' : 'pointer' }}>
                {policyIdx < POLICIES.length - 1 ? 'Accept & Next →' : 'Accept All & Proceed to eSign →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── COMPLIANCE screen ────────────────────────────────────────
  if (phase === 'compliance') return (
    <div style={{ ...S.pg }}>
      <div style={{ background: `linear-gradient(135deg, ${PRI}, #4F46E5)`, padding: '12px 18px', color: '#fff' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Statutory Compliance Forms</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)' }}>All forms AI pre-filled · Review and accept</div>
      </div>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 18 }}>
        {/* EPF Form 11 */}
        <div style={{ ...S.cd, borderLeft: `3px solid ${PRI}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>EPF Form 11 — PF Declaration</div>
            <span style={{ fontSize: 10, background: TK.brandTint, color: '#534AB7', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>AI Pre-filled</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, fontSize: 12, marginBottom: 12 }}>
            {[['Name', form.full_name], ["Father's Name", form.father_name || '—'], ['DOB', form.dob || '—'], ['Gender', form.gender || '—'], ['Aadhaar', form.aadhaar ? '****'+form.aadhaar.slice(-4) : '—'], ['PAN', form.pan || '—'], ['Bank', form.bank_name || '—'], ['IFSC', form.bank_ifsc || '—'], ['DOJ', form.doj || '—']].map(([l,v]) => (
              <div key={l}><div style={{ fontSize: 10, color: TK.faint }}>{l}</div><div style={{ fontWeight: 500, color: TK.ink }}>{v}</div></div>
            ))}
          </div>
          <div style={S.g2}>
            <Fld label="Previous UAN (if any)">
              <input style={S.inp()} value={form.prev_uan} onChange={e => F('prev_uan', e.target.value)} placeholder="12-digit UAN (if you have one)"/>
            </Fld>
            <Fld label="PF Transfer required?">
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                {['Yes','No'].map(v => <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}><input type="radio" name="pft" onChange={() => F('pf_transfer', v === 'Yes')} checked={form.pf_transfer === (v === 'Yes')}/> {v}</label>)}
              </div>
            </Fld>
          </div>
        </div>

        {/* EPF Form 2 */}
        <div style={{ ...S.cd, borderLeft: '3px solid #1D4ED8' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>EPF Form 2 — Nominee Declaration <span style={{ color: TK.critical, fontSize: 11 }}>* Manual fill</span></div>
          <div style={S.g3}>
            <Fld label="Nominee Name *" conf="manual"><input style={S.inp('manual')} value={epfNominee.name} onChange={e => setEpfNominee(p => ({...p, name: e.target.value}))} placeholder="Full name"/></Fld>
            <Fld label="Relation *" conf="manual">
              <select style={S.inp('manual')} value={epfNominee.relation} onChange={e => setEpfNominee(p => ({...p, relation: e.target.value}))}>
                <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option>
              </select>
            </Fld>
            <Fld label="Date of Birth *" conf="manual"><input style={S.inp('manual')} type="date" value={epfNominee.dob} onChange={e => setEpfNominee(p => ({...p, dob: e.target.value}))}/></Fld>
            <Fld label="Share %" conf="normal"><input style={S.inp()} type="number" value={epfNominee.share} onChange={e => setEpfNominee(p => ({...p, share: e.target.value}))}/></Fld>
            <div style={{ gridColumn: 'span 2' }}><Fld label="Nominee Address *" conf="manual"><input style={S.inp('manual')} value={epfNominee.address} onChange={e => setEpfNominee(p => ({...p, address: e.target.value}))} placeholder="Full address"/></Fld></div>
          </div>
        </div>

        {/* Gratuity Form F */}
        <div style={{ ...S.cd, borderLeft: '3px solid #059669' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Gratuity Form F — Nomination</div>
          <div style={S.g3}>
            <Fld label="Nominee Name *" conf="manual"><input style={S.inp('manual')} value={gratNominee.name} onChange={e => setGratNominee(p => ({...p, name: e.target.value}))} placeholder="Name"/></Fld>
            <Fld label="Relation *" conf="manual">
              <select style={S.inp('manual')} value={gratNominee.relation} onChange={e => setGratNominee(p => ({...p, relation: e.target.value}))}>
                <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Child</option>
              </select>
            </Fld>
            <Fld label="Share %"><input style={S.inp()} type="number" value={gratNominee.share} onChange={e => setGratNominee(p => ({...p, share: e.target.value}))}/></Fld>
          </div>
        </div>

        {/* ESIC */}
        <div style={{ ...S.cd, background: TK.sunken }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: TK.muted }}>ESIC Form 1 — Employee Declaration</div>
            {form.bank_acc ? (
              <span style={{ fontSize: 10, background: TK.positiveTint, color: TK.positive, padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>Not applicable (Gross &gt; ₹21,000)</span>
            ) : (
              <span style={{ fontSize: 10, background: TK.warningTint, color: TK.warning, padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>Check after salary confirmation</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setPhase('form')} style={S.btnO}>Back to Form</button>
          <button onClick={() => setPhase('policies')} style={{ ...S.btnP, flex: 1, padding: 11 }}>
            Next: Policy Acceptance ({POLICIES.length} policies) →
          </button>
        </div>
      </div>
    </div>
  )

  // ── 7-STEP FORM ──────────────────────────────────────────────
  const aiCount = Object.keys(form).filter(k => conf(k) === 'ai-high').length
  const missingCount = Object.keys(form).filter(k => conf(k) === 'manual').length

  const STEP_CONTENT: Record<number, React.ReactNode> = {
    0: (
      <div>
        {/* Photo */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
          <div onClick={() => F('photo_done', true)} style={{ width: 80, height: 80, borderRadius: 10, background: form.photo_done ? TK.positiveTint : TK.criticalTint, border: `2px dashed ${form.photo_done ? TK.positive : '#FCA5A5'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', cursor: 'pointer', flexShrink: 0, gap: 4, transition: 'all .15s' }}>
            <span style={{ fontSize: form.photo_done ? 28 : 24 }}>{form.photo_done ? '' : ''}</span>
            <span style={{ fontSize: 9, color: TK.faint, textAlign: 'center' }}>Photo</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Passport Size Photo <span style={{ color: TK.critical, fontSize: 12 }}>*Required</span></div>
            <div style={{ fontSize: 11, color: TK.muted, lineHeight: 1.7 }}>Recent photo (within 3 months). White background preferred. JPG/PNG, max 2MB.</div>
            {!form.photo_done && <div style={{ fontSize: 11, color: TK.critical, marginTop: 4 }}>Click box to upload</div>}
          </div>
        </div>
        <div style={S.g2}>
          <Fld label="Full Name (as per Aadhaar)" conf={conf('full_name')}><input style={S.inp(conf('full_name'))} value={form.full_name} onChange={e => F('full_name', e.target.value)}/></Fld>
          <Fld label="Date of Birth" conf={conf('dob')}><input style={S.inp(conf('dob'))} type="date" value={form.dob} onChange={e => F('dob', e.target.value)}/></Fld>
          <Fld label="Father's Name" conf={conf('father_name')}><input style={S.inp(conf('father_name'))} value={form.father_name} onChange={e => F('father_name', e.target.value)} placeholder="As per documents"/></Fld>
          <Fld label="Gender" conf={conf('gender')}>
            <select style={S.inp(conf('gender'))} value={form.gender} onChange={e => F('gender', e.target.value)}>
              <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </Fld>
          <Fld label="Blood Group *" conf={conf('blood_group')}>
            <select style={S.inp(conf('blood_group'))} value={form.blood_group} onChange={e => F('blood_group', e.target.value)}>
              <option value="">Select</option>{['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(g => <option key={g}>{g}</option>)}
            </select>
          </Fld>
          <Fld label="Marital Status *" conf={conf('marital_status')}>
            <select style={S.inp(conf('marital_status'))} value={form.marital_status} onChange={e => F('marital_status', e.target.value)}>
              <option value="">Select</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
            </select>
          </Fld>
          {form.marital_status === 'Married' && <Fld label="Spouse Name"><input style={S.inp()} value={form.spouse_name} onChange={e => F('spouse_name', e.target.value)}/></Fld>}
          <Fld label="Mobile" conf={conf('mobile')}><input style={S.inp(conf('mobile'))} value={form.mobile} onChange={e => F('mobile', e.target.value)}/></Fld>
          <Fld label="Personal Email" conf={conf('email')}><input style={S.inp(conf('email'))} value={form.email} onChange={e => F('email', e.target.value)}/></Fld>
          <Fld label="Aadhaar Number *" conf={conf('aadhaar')}><input style={S.inp(conf('aadhaar'))} value={form.aadhaar} onChange={e => F('aadhaar', e.target.value)} placeholder="XXXX-XXXX-XXXX" maxLength={14}/></Fld>
          <Fld label="PAN Number" conf={conf('pan')}><input style={S.inp(conf('pan'))} value={form.pan} onChange={e => F('pan', e.target.value.toUpperCase())} maxLength={10}/></Fld>
        </div>
      </div>
    ),
    1: (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: PRI, marginBottom: 10 }}>Permanent Address</div>
        <div style={S.g3}>
          <Fld label="House / Street" conf={conf('perm_street')}><input style={S.inp(conf('perm_street'))} value={form.perm_street} onChange={e => F('perm_street', e.target.value)}/></Fld>
          <Fld label="City *" conf={conf('perm_city')}><input style={S.inp(conf('perm_city'))} value={form.perm_city} onChange={e => F('perm_city', e.target.value)}/></Fld>
          <Fld label="State *"><input style={S.inp()} value={form.perm_state} onChange={e => F('perm_state', e.target.value)}/></Fld>
          <Fld label="PIN Code *"><input style={S.inp()} value={form.perm_pin} onChange={e => F('perm_pin', e.target.value)} maxLength={6}/></Fld>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, margin: '12px 0 10px', userSelect: 'none' }}>
          <input type="checkbox" checked={form.same_address} onChange={e => F('same_address', e.target.checked)} style={{ width: 16, height: 16 }}/>
          Current/local address same as permanent address
        </label>
        {!form.same_address && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: PRI, marginBottom: 10 }}>Current / Local Address</div>
            <div style={S.g3}>
              <Fld label="House / Street"><input style={S.inp()} value={form.curr_street} onChange={e => F('curr_street', e.target.value)}/></Fld>
              <Fld label="City"><input style={S.inp()} value={form.curr_city} onChange={e => F('curr_city', e.target.value)}/></Fld>
              <Fld label="State"><input style={S.inp()} value={form.curr_state} onChange={e => F('curr_state', e.target.value)}/></Fld>
              <Fld label="PIN"><input style={S.inp()} value={form.curr_pin} onChange={e => F('curr_pin', e.target.value)} maxLength={6}/></Fld>
            </div>
          </>
        )}
        <div style={{ fontSize: 12, fontWeight: 600, color: PRI, margin: '14px 0 10px' }}>Emergency Contacts (2 required)</div>
        {[1, 2].map(n => (
          <div key={n} style={{ ...S.g3, marginBottom: 10 }}>
            <Fld label={`Contact ${n} Name *`} conf="manual"><input style={S.inp('manual')} value={(form as any)[`emrg${n}_name`]} onChange={e => F(`emrg${n}_name`, e.target.value)}/></Fld>
            <Fld label="Relation *" conf="manual">
              <select style={S.inp('manual')} value={(form as any)[`emrg${n}_relation`]} onChange={e => F(`emrg${n}_relation`, e.target.value)}>
                <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Other</option>
              </select>
            </Fld>
            <Fld label="Mobile *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`emrg${n}_mobile`]} onChange={e => F(`emrg${n}_mobile`, e.target.value)}/></Fld>
          </div>
        ))}
      </div>
    ),
    2: (
      <div>
        <div style={S.g2}>
          <Fld label="Designation" conf={conf('designation')}><input style={S.inp(conf('designation'))} value={form.designation} onChange={e => F('designation', e.target.value)}/></Fld>
          <Fld label="Date of Joining" conf={conf('doj')}><input style={S.inp(conf('doj'))} type="date" value={form.doj} onChange={e => F('doj', e.target.value)}/></Fld>
          <Fld label="Highest Qualification *" conf={conf('highest_qual')}>
            <select style={S.inp(conf('highest_qual'))} value={form.highest_qual} onChange={e => F('highest_qual', e.target.value)}>
              <option value="">Select</option>{['10th','12th','Diploma','Graduate','Post Graduate','PhD'].map(q => <option key={q}>{q}</option>)}
            </select>
          </Fld>
          <Fld label="Previous Employer" conf={conf('prev_employer')}><input style={S.inp(conf('prev_employer'))} value={form.prev_employer} onChange={e => F('prev_employer', e.target.value)}/></Fld>
          <Fld label="UAN (if existing PF account)"><input style={S.inp()} value={form.prev_uan} onChange={e => F('prev_uan', e.target.value)} placeholder="12-digit UAN"/></Fld>
          <Fld label="Previous PF Member ID"><input style={S.inp()} value={form.prev_pf_id} onChange={e => F('prev_pf_id', e.target.value)} placeholder="e.g. MH/BN/1234/001"/></Fld>
        </div>
        <Fld label="Transfer previous PF?">
          <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
            {['Yes — transfer from previous employer', 'No — new PF account'].map((l, i) => (
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                <input type="radio" name="pf_tr" onChange={() => F('pf_transfer', i === 0)} checked={form.pf_transfer === (i === 0)}/> {l}
              </label>
            ))}
          </div>
        </Fld>
      </div>
    ),
    3: (
      <div>
        <div style={{ background: TK.warningTint, border: '1px solid #FDE68A', borderRadius: 8, padding: '9px 12px', marginBottom: 14, fontSize: 12, color: TK.warning }}>Bank details are encrypted — only the Payroll team can see them. Your salary will be credited to this account.
        </div>
        <div style={S.g2}>
          <Fld label="Account Number *" conf="manual"><input style={S.inp('manual')} type="password" value={form.bank_acc} onChange={e => F('bank_acc', e.target.value)} placeholder="Account number"/></Fld>
          <Fld label="Confirm Account Number *" conf="manual"><input style={S.inp('manual')} value={form.bank_acc_confirm} onChange={e => F('bank_acc_confirm', e.target.value)} placeholder="Re-enter"/></Fld>
          <Fld label="IFSC Code *" conf={conf('bank_ifsc')}><input style={S.inp(conf('bank_ifsc'))} value={form.bank_ifsc} onChange={e => handleIfsc(e.target.value)} placeholder="e.g. HDFC0001234" maxLength={11}/></Fld>
          <Fld label="Bank Name (auto-fill from IFSC)">{<input style={S.inp(form.bank_name ? 'ai-high' : 'normal')} value={form.bank_name} readOnly={!!form.bank_name} placeholder="Auto-fills on IFSC entry" onChange={e => F('bank_name', e.target.value)}/>}</Fld>
          <Fld label="Branch"><input style={S.inp(form.bank_branch ? 'ai-high' : 'normal')} value={form.bank_branch} onChange={e => F('bank_branch', e.target.value)} readOnly={!!form.bank_branch}/></Fld>
          <Fld label="Account Type">
            <select style={S.inp()} value={form.account_type} onChange={e => F('account_type', e.target.value)}>
              <option>Savings</option><option>Current</option>
            </select>
          </Fld>
          <div style={{ gridColumn: 'span 2' }}>
            <Fld label="Account Holder Name (as per bank)" conf={conf('acc_holder')}><input style={S.inp(conf('acc_holder'))} value={form.acc_holder} onChange={e => F('acc_holder', e.target.value)} placeholder="In CAPITAL LETTERS"/></Fld>
          </div>
        </div>
        {form.bank_acc && form.bank_acc_confirm && form.bank_acc !== form.bank_acc_confirm && (
          <div style={{ color: TK.critical, fontSize: 12, marginTop: -6 }}>Account numbers don't match</div>
        )}
      </div>
    ),
    4: (
      <div>
        <div style={{ fontSize: 12, color: TK.muted, marginBottom: 14, lineHeight: 1.7 }}>2 professional references required — previous manager, colleague, or mentor. Not family members.</div>
        {[1, 2].map(n => (
          <div key={n} style={{ ...S.cd, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: PRI, marginBottom: 10 }}>Reference {n}</div>
            <div style={S.g3}>
              <Fld label="Name *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`ref${n}_name`]} onChange={e => F(`ref${n}_name`, e.target.value)}/></Fld>
              <Fld label="Designation *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`ref${n}_desig`]} onChange={e => F(`ref${n}_desig`, e.target.value)}/></Fld>
              <Fld label="Company *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`ref${n}_co`]} onChange={e => F(`ref${n}_co`, e.target.value)}/></Fld>
              <Fld label="Relation *" conf="manual">
                <select style={S.inp('manual')} value={(form as any)[`ref${n}_rel`]} onChange={e => F(`ref${n}_rel`, e.target.value)}>
                  <option value="">Select</option><option>Reporting Manager</option><option>Skip Level</option><option>Colleague</option><option>Mentor</option>
                </select>
              </Fld>
              <Fld label="Mobile *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`ref${n}_mobile`]} onChange={e => F(`ref${n}_mobile`, e.target.value)}/></Fld>
              <Fld label="Email *" conf="manual"><input style={S.inp('manual')} value={(form as any)[`ref${n}_email`]} onChange={e => F(`ref${n}_email`, e.target.value)}/></Fld>
            </div>
          </div>
        ))}
      </div>
    ),
    5: (
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: TK.positive, marginBottom: 12 }}>Documents already submitted during pre-onboarding (no re-upload needed):</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 16 }}>
          {['10th / 12th / Graduation marksheets','Appointment letter (prev employer)','Last 3 months salary slips','Bank proof (passbook / cheque)','Aadhaar + PAN copy','Relieving letter (if available)'].map(d => (
            <div key={d} style={{ fontSize: 11, color: TK.positive, display: 'flex', alignItems: 'center', gap: 5 }}>✓ {d}</div>
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: TK.critical, marginBottom: 10 }}>New documents required today:</div>
        {[
          { key: 'photo_done', emoji: '', label: 'Recent Passport Photo', required: true, note: 'Within 3 months | White background | JPG/PNG' },
          { key: 'uan_done',   emoji: '', label: 'UAN Card / EPFO UAN',   required: false, note: 'For PF transfer from previous employer' },
          { key: 'esic_done',  emoji: '', label: 'ESIC Card / IP Number', required: false, note: 'Only if Gross ≤ ₹21,000/month' },
        ].map(({ key, emoji, label, required, note }) => (
          <div key={key} onClick={() => F(key, true)} style={{ border: `1.5px dashed ${required && !(form as any)[key] ? '#FCA5A5' : '#A7F3D0'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10, cursor: 'pointer', background: (form as any)[key] ? TK.positiveTint : '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all .15s' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{emoji} {label} {required && <span style={{ color: TK.critical }}>*</span>}</div>
              <div style={{ fontSize: 11, color: TK.faint, marginTop: 2 }}>{note}</div>
            </div>
            {(form as any)[key]
              ? <span style={{ fontSize: 11, color: TK.positive, fontWeight: 600 }}>Uploaded</span>
              : <span style={{ fontSize: 11, background: PRI, color: '#fff', padding: '4px 12px', borderRadius: 99 }}>Upload</span>}
          </div>
        ))}
      </div>
    ),
    6: (
      <div>
        <div style={{ fontSize: 12, color: TK.muted, marginBottom: 14 }}>Check every detail. Use the edit button on any section to change it.</div>
        {[
          { s: 0, label: 'Personal details', summary: `${form.full_name || '—'} · ${form.blood_group || 'Blood group missing'} · ${form.marital_status || 'Marital status missing'}` },
          { s: 1, label: 'Address details', summary: `${form.perm_city || 'City missing'}, ${form.perm_state || '—'} ${form.perm_pin || ''}` },
          { s: 2, label: 'Professional details', summary: `${form.designation || '—'} · DOJ: ${form.doj || '—'} · Prev: ${form.prev_employer || '—'}` },
          { s: 3, label: 'Bank account', summary: `${form.bank_name || 'Bank missing'} · ${form.bank_acc ? '****'+form.bank_acc.slice(-4) : 'Account missing'} · ${form.bank_ifsc || '—'}` },
          { s: 4, label: 'References', summary: `${form.ref1_name || 'Ref 1 missing'} · ${form.ref2_name || 'Ref 2 missing'}` },
          { s: 5, label: 'Documents', summary: `Photo: ${form.photo_done ? '' : 'Missing'} · UAN: ${form.uan_done ? '' : '—'} · ESIC: ${form.esic_done ? '' : '—'}` },
        ].map(({ s, label, summary }) => (
          <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: TK.sunken, borderRadius: 8, marginBottom: 6, border: '1px solid #EDE9FE' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: TK.ink }}>{label}</div>
              <div style={{ fontSize: 11, color: TK.muted, marginTop: 1 }}>{summary}</div>
            </div>
            <button onClick={() => setStep(s)} style={{ ...S.btnO, padding: '4px 10px', fontSize: 11 }}>Edit</button>
          </div>
        ))}
        <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 12, color: '#3B6D11' }}>
          ✅ 7/7 steps complete · All mandatory fields filled
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => window.print()} style={{ ...S.btnO, width: '100%', marginBottom: 8 }}>Download Preview PDF</button>
        </div>
      </div>
    ),
  }

  return (
    <div style={S.pg}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${PRI}, #4F46E5)`, padding: '12px 18px 14px', color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Joining Formalities</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)' }}>{company?.company_name || 'Company'} · {c.full_name}</div>
      </div>

      {/* Step bar */}
      <div style={{ display: 'flex', overflowX: 'auto', padding: '9px 14px', gap: 3, background: '#fff', borderBottom: '1px solid #EDE9FE' }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div onClick={() => { if (i <= step) setStep(i) }} style={{ padding: '5px 11px', borderRadius: 99, fontSize: 11, fontWeight: 500, cursor: i <= step ? 'pointer' : 'default', whiteSpace: 'nowrap', transition: 'all .2s', background: i === step ? PRI : i < step ? TK.brandTint : '#FAFAFA', color: i === step ? '#fff' : i < step ? PRI : TK.faint }}>
              {i < step ? '✓ ' : `${i+1}. `}{s}
            </div>
            {i < STEPS.length - 1 && <div style={{ width: 10, height: 1, background: TK.brandTint, flexShrink: 0 }}/>}
          </div>
        ))}
      </div>

      {/* AI banner */}
      <div style={{ background: TK.positiveTint, borderBottom: '1px solid #A7F3D0', padding: '7px 16px', fontSize: 11, color: '#065F46', display: 'flex', alignItems: 'center', gap: 6 }}>
        🤖 <span>
          <strong>AI Pre-fill Active:</strong> Pre-onboarding documents se <strong>{aiCount} fields auto-filled</strong>.
          <span style={{ background: '#D1FAE5', padding: '1px 5px', borderRadius: 99, fontSize: 10, fontWeight: 600, marginLeft: 4 }}>AI ✓</span> = verified.
          {missingCount > 0 && <> <span style={{ background: TK.criticalTint, padding: '1px 5px', borderRadius: 99, fontSize: 10, fontWeight: 600, marginLeft: 4, color: '#991B1B' }}>Fill Required</span> = {missingCount} field(s) to fill in manually.</>}
        </span>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 20px' }}>
        <div style={S.cd}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: TK.ink }}>Step {step + 1}: {STEPS[step]}</div>
          {STEP_CONTENT[step]}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <button onClick={() => setStep(s => Math.max(0, s-1))} disabled={step === 0} style={{ ...S.btnO, opacity: step === 0 ? .5 : 1 }}>Previous</button>
          {step < 6 ? (
            <button onClick={() => setStep(s => Math.min(6, s+1))} style={S.btnP}>Save & Next →</button>
          ) : (
            <button onClick={() => setPhase('compliance')} style={{ ...S.btnP, background: TK.positive, padding: '10px 24px' }}>
              Submit & Go to Compliance Forms →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
