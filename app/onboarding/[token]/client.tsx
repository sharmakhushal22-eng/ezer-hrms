// app/onboarding/[token]/client.tsx
// 8-step employee onboarding wizard with AI doc verification
'use client'
import { useState, useCallback, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
interface DocStatus { doc_code: string; ai_status: string; ai_extracted_data: any; ai_confidence: number; ai_flags: string[]; file_name: string }

// ── EZER Theme ───────────────────────────────────────────────────
const P = '#7C3AED'
const S = {
  page: { background: '#F5F3FF', minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: '#1E1B4B' } as const,
  card: { background: '#fff', borderRadius: 12, border: '1px solid rgba(124,58,237,0.12)', padding: '18px 20px', marginBottom: 12, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as const,
  lbl: { fontSize: 10, fontWeight: 600, color: '#6D28D9', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 4 },
  inp: (err = false) => ({ width: '100%', padding: '9px 12px', background: err ? '#FEF2F2' : '#FAFAF8', border: `1px solid ${err ? '#FCA5A5' : '#DDD6FE'}`, borderRadius: 8, color: '#1E1B4B', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }),
  sel: { width: '100%', padding: '9px 12px', background: '#FAFAF8', border: '1px solid #DDD6FE', borderRadius: 8, color: '#1E1B4B', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  btnP: { padding: '11px 24px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: P, color: '#fff', transition: 'opacity .2s' } as const,
  btnO: { padding: '10px 18px', borderRadius: 9, border: `1px solid ${P}`, cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: P } as const,
  g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as const,
  g3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } as const,
}

const STEPS = ['Welcome', 'OTP Verify', 'Personal', 'Contact & Address', 'Emergency & Employment', 'Documents', 'Statutory & Bank', 'Declaration']
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']

// ── Field helpers ─────────────────────────────────────────────────
const Fld = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={S.lbl}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{hint}</div>}
  </div>
)

// ── API helper ────────────────────────────────────────────────────
async function api(path: string, body: any, method = 'POST') {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

// ── Toast ─────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'ok' | 'err' }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, borderRadius: 10, padding: '12px 20px', fontSize: 13, fontWeight: 500, background: type === 'ok' ? '#059669' : '#DC2626', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: 320 }}>
      {type === 'ok' ? '✓' : '⚠'} {msg}
    </div>
  )
}

// ── Step Progress bar ─────────────────────────────────────────────
function StepBar({ current }: { current: Step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', background: '#fff', borderBottom: '1px solid #EDE9FE', overflowX: 'auto', gap: 0 }}>
      {STEPS.map((s, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: done ? P : active ? P : '#EDE9FE', color: done || active ? '#fff' : '#9CA3AF', transition: 'all .3s' }}>
                {done ? '✓' : n}
              </div>
              <div style={{ fontSize: 9, color: active ? P : done ? '#059669' : '#9CA3AF', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{s}</div>
            </div>
            {i < STEPS.length - 1 && <div style={{ width: 24, height: 2, background: done ? P : '#EDE9FE', margin: '0 2px', marginBottom: 16, transition: 'background .3s' }} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Document upload box ───────────────────────────────────────────
function DocUpload({
  docCode, docName, required, token,
  status, onSuccess,
}: {
  docCode: string; docName: string; required: boolean; token: string
  status: DocStatus | null
  onSuccess: (code: string, data: any) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate
    const maxMB = 5
    if (file.size > maxMB * 1024 * 1024) { alert(`File too large. Max ${maxMB}MB.`); return }
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    if (!allowed.includes(file.type)) { alert('Only JPG, PNG, PDF allowed.'); return }

    setUploading(true)
    setProgress('Uploading...')

    const fd = new FormData()
    fd.append('token', token)
    fd.append('doc_code', docCode)
    fd.append('file', file)

    try {
      setProgress('Verifying with AI...')
      const res = await fetch('/api/onboarding/verify-document', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setProgress('')
      onSuccess(docCode, data)
    } catch (err: any) {
      alert('Upload failed: ' + err.message)
      setProgress('')
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const aiStatus = status?.ai_status
  const isOk = aiStatus === 'VERIFIED'
  const isFailed = aiStatus === 'FAILED' || aiStatus === 'MISMATCH'
  const isPending = !status

  const borderColor = isOk ? '#A7F3D0' : isFailed ? '#FCA5A5' : '#DDD6FE'
  const bgColor = isOk ? '#F0FDF4' : isFailed ? '#FEF2F2' : '#FAFAF8'
  const icon = isOk ? '✅' : isFailed ? '⚠️' : isPending ? '📤' : '⏳'

  return (
    <div style={{ border: `2px dashed ${borderColor}`, borderRadius: 10, padding: '14px 16px', background: bgColor, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon} {docName} {required && <span style={{ color: '#DC2626', fontSize: 11 }}>*Required</span>}
          </div>
          {status && (
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4, lineHeight: 1.6 }}>
              {status.file_name}
              {aiStatus === 'VERIFIED' && (
                <span style={{ color: '#059669', marginLeft: 8 }}>
                  AI verified ({Math.round((status.ai_confidence || 0) * 100)}% confidence)
                </span>
              )}
              {aiStatus === 'MISMATCH' && (
                <span style={{ color: '#D97706', marginLeft: 8 }}>⚠ AI flagged — HR will review</span>
              )}
              {aiStatus === 'FAILED' && (
                <span style={{ color: '#DC2626', marginLeft: 8 }}>AI unavailable — HR will verify manually</span>
              )}
            </div>
          )}
          {/* Show extracted data */}
          {status?.ai_extracted_data && Object.keys(status.ai_extracted_data).length > 0 && (
            <div style={{ marginTop: 8, background: '#F3F0FF', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#534AB7' }}>
              🤖 Extracted: {Object.entries(status.ai_extracted_data).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </div>
          )}
          {uploading && <div style={{ fontSize: 11, color: P, marginTop: 4 }}>⏳ {progress}</div>}
        </div>
        <div style={{ marginLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${P}`, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 12, background: status ? '#EDE9FE' : P, color: status ? P : '#fff', fontFamily: 'inherit', opacity: uploading ? .6 : 1 }}>
            {status ? 'Re-upload' : 'Upload'}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function OnboardingClient({ token, candidate, company, uploadedDocs }: {
  token: string
  candidate: any
  company: any
  uploadedDocs: Record<string, DocStatus>
}) {
  const [step, setStep] = useState<Step>((candidate.current_step || 1) as Step)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [docs, setDocs] = useState<Record<string, DocStatus>>(uploadedDocs)
  const [submitted, setSubmitted] = useState(false)
  const [employeeCode, setEmployeeCode] = useState<string | null>(null)

  const c = candidate
  const co = company

  // Restore saved form data
  const saved = c.form_data || {}

  // Personal step state
  const [personal, setPersonal] = useState({
    full_name: (saved.step_3?.full_name) || c.full_name || '',
    dob: (saved.step_3?.dob) || '',
    gender: (saved.step_3?.gender) || '',
    father_name: (saved.step_3?.father_name) || '',
    mother_name: (saved.step_3?.mother_name) || '',
    blood_group: (saved.step_3?.blood_group) || '',
    marital_status: (saved.step_3?.marital_status) || '',
    nationality: (saved.step_3?.nationality) || 'Indian',
  })

  // Contact step
  const [contact, setContact] = useState({
    mobile: (saved.step_4?.mobile) || c.mobile || '',
    alt_mobile: (saved.step_4?.alt_mobile) || '',
    personal_email: (saved.step_4?.personal_email) || c.email || '',
    perm_line1: (saved.step_4?.perm_line1) || '',
    perm_city: (saved.step_4?.perm_city) || '',
    perm_district: (saved.step_4?.perm_district) || '',
    perm_state: (saved.step_4?.perm_state) || '',
    perm_pin: (saved.step_4?.perm_pin) || '',
    same_address: (saved.step_4?.same_address) !== undefined ? saved.step_4.same_address : false,
    curr_line1: (saved.step_4?.curr_line1) || '',
    curr_city: (saved.step_4?.curr_city) || '',
    curr_state: (saved.step_4?.curr_state) || '',
    curr_pin: (saved.step_4?.curr_pin) || '',
  })

  // Emergency + prev employment
  const [emergency, setEmergency] = useState({
    emrg1_name: (saved.step_5?.emrg1_name) || '',
    emrg1_relation: (saved.step_5?.emrg1_relation) || '',
    emrg1_mobile: (saved.step_5?.emrg1_mobile) || '',
    emrg2_name: (saved.step_5?.emrg2_name) || '',
    emrg2_relation: (saved.step_5?.emrg2_relation) || '',
    emrg2_mobile: (saved.step_5?.emrg2_mobile) || '',
    is_fresher: (saved.step_5?.is_fresher) !== undefined ? saved.step_5.is_fresher : false,
    prev_company: (saved.step_5?.prev_company) || c.current_company || '',
    prev_designation: (saved.step_5?.prev_designation) || '',
    prev_from: (saved.step_5?.prev_from) || '',
    prev_to: (saved.step_5?.prev_to) || '',
    prev_ctc: (saved.step_5?.prev_ctc) || '',
    reason_leaving: (saved.step_5?.reason_leaving) || '',
  })

  // Statutory & bank step
  const [statutory, setStatutory] = useState({
    pan_number: (saved.step_7?.pan_number) || '',
    has_uan: (saved.step_7?.has_uan) !== undefined ? saved.step_7.has_uan : false,
    uan_number: (saved.step_7?.uan_number) || '',
    prev_pf_id: (saved.step_7?.prev_pf_id) || '',
    pf_transfer: (saved.step_7?.pf_transfer) !== undefined ? saved.step_7.pf_transfer : false,
    // PF Nominee
    nominee_name: (saved.step_7?.nominee_name) || '',
    nominee_relation: (saved.step_7?.nominee_relation) || '',
    nominee_dob: (saved.step_7?.nominee_dob) || '',
    nominee_share: (saved.step_7?.nominee_share) || '100',
    nominee_address: (saved.step_7?.nominee_address) || '',
    // Gratuity nominee
    grat_nominee_name: (saved.step_7?.grat_nominee_name) || '',
    grat_nominee_relation: (saved.step_7?.grat_nominee_relation) || '',
    // Bank
    bank_account: (saved.step_7?.bank_account) || '',
    bank_confirm: '',
    bank_ifsc: (saved.step_7?.bank_ifsc) || '',
    bank_name: (saved.step_7?.bank_name) || '',
    bank_branch: (saved.step_7?.bank_branch) || '',
    account_type: (saved.step_7?.account_type) || 'Savings',
    acc_holder: (saved.step_7?.acc_holder) || c.full_name || '',
  })

  const [declaration, setDeclaration] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ── Save progress ───────────────────────────────────────────────
  const saveStep = async (stepNum: Step, data: any) => {
    setSaving(true)
    await api('/api/onboarding/save-progress', { token, step: stepNum, data })
    setSaving(false)
  }

  // ── OTP send ────────────────────────────────────────────────────
  const sendOtp = async () => {
    if (c.otp_verified) { nextStep(); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token })
    setOtpLoading(false)
    if (res.success) { setOtpSent(true); showToast('OTP sent to your mobile number') }
    else showToast(res.error || 'Failed to send OTP', 'err')
  }

  const verifyOtp = async () => {
    if (!otp.trim()) { showToast('Please enter OTP', 'err'); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token, otp }, 'PUT')
    setOtpLoading(false)
    if (res.success) { showToast('Mobile verified!'); nextStep() }
    else showToast(res.error || 'Incorrect OTP', 'err')
  }

  // ── IFSC lookup ─────────────────────────────────────────────────
  const lookupIfsc = async (ifsc: string) => {
    if (ifsc.length < 11) return
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`)
      if (r.ok) {
        const d = await r.json()
        setStatutory(s => ({ ...s, bank_name: d.BANK || '', bank_branch: d.BRANCH || '' }))
      }
    } catch { /* silently fail */ }
  }

  // ── PAN auto-fill from AI-extracted Aadhaar ────────────────────
  const panDoc = docs['PAN']
  const aadhaarDoc = docs['AADHAAR_FRONT']
  const aiPan = panDoc?.ai_extracted_data?.pan_number || ''
  const aiName = aadhaarDoc?.ai_extracted_data?.name || panDoc?.ai_extracted_data?.name || ''

  // ── Navigate steps ───────────────────────────────────────────────
  const nextStep = () => setStep(s => Math.min(8, s + 1) as Step)
  const prevStep = () => setStep(s => Math.max(1, s - 1) as Step)

  // ── Final Submit ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!declaration) { showToast('Please accept the declaration', 'err'); return }
    setSubmitting(true)

    const final = {
      step_3: personal,
      step_4: contact,
      step_5: emergency,
      step_7: statutory,
    }

    const res = await api('/api/onboarding/submit', { token, final_form_data: final })
    setSubmitting(false)

    if (res.success) setSubmitted(true)
    else showToast(res.error || 'Submit failed', 'err')
  }

  // ── SUBMITTED screen ─────────────────────────────────────────────
  if (submitted) return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ ...S.card, padding: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#1E1B4B', marginBottom: 8 }}>Welcome to {co?.company_name || 'the team'}!</div>
          <div style={{ fontSize: 13, color: '#000000ff', lineHeight: 1.8, marginBottom: 20 }}>
            Your joining form has been submitted successfully!<br />
            HR will review it and generate your Employee ID.<br />
            You'll receive an email with your ESS login details.
          </div>
          <div style={{ background: '#F3F0FF', borderRadius: 10, padding: 16, marginBottom: 16, textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>✅ Steps completed</div>
            {['Personal details filled', 'Documents uploaded & AI verified', 'Statutory forms submitted', 'PF/Bank details captured', 'Declaration accepted'].map(s => (
              <div key={s} style={{ fontSize: 12, color: '#059669', marginBottom: 5 }}>✓ {s}</div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.7 }}>
            Questions? Contact HR at {co?.hr_email || 'hr@company.com'}
          </div>
        </div>
      </div>
    </div>
  )

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${P}, #4F46E5)`, padding: '14px 20px', color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{co?.company_name || 'EZER HRMS'} — Joining Formalities</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 1 }}>{c.full_name} · {c.designation}</div>
      </div>

      {/* Step progress */}
      <StepBar current={step} />

      {/* Save indicator */}
      {saving && <div style={{ background: '#EEEDFE', textAlign: 'center', padding: '4px 0', fontSize: 11, color: P }}>💾 Auto-saving...</div>}

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px 20px' }}>

        {/* ═══ STEP 1: WELCOME ═══════════════════════════════════════ */}
        {step === 1 && (
          <div>
            <div style={{ ...S.card, background: `linear-gradient(135deg, ${P}, #4F46E5)`, color: '#fff' }}>
              <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Welcome, {c.full_name}! 👋</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', lineHeight: 1.8 }}>
                We're excited to have you join {co?.company_name}. Let's complete your joining formalities.
              </div>
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: P }}>Your joining details (pre-filled by HR)</div>
              <div style={S.g2}>
                {[['Name', c.full_name], ['Designation', c.designation || '—'], ['Department', c.department || '—'], ['Date of Joining', c.date_of_joining ? new Date(c.date_of_joining).toLocaleDateString('en-IN') : '—'], ['Employment Type', c.employment_type || 'Employee'], ['Offered CTC', c.offered_ctc ? `₹${Number(c.offered_ctc).toLocaleString('en-IN')}` : '—']].map(([l, v]) => (
                  <div key={l} style={{ background: '#F9F8FF', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginTop: 14, fontSize: 12, color: '#92400E', lineHeight: 1.7 }}>
                ⏱️ Estimated time: 10-15 minutes &nbsp;|&nbsp; 8 steps &nbsp;|&nbsp; Auto-saves at each step
              </div>
              <button onClick={nextStep} style={{ ...S.btnP, width: '100%', padding: 12, marginTop: 14, fontSize: 15 }}>
                Let's Start 🚀
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: OTP ══════════════════════════════════════════ */}
        {step === 2 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Verify Your Mobile Number</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 1.7 }}>
              We'll send a 6-digit OTP to your registered mobile: <strong>{c.mobile?.replace(/\d(?=\d{4})/g, '*')}</strong>
            </div>
            {c.otp_verified ? (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#059669' }}>
                ✅ Mobile already verified!
              </div>
            ) : (
              <>
                {!otpSent ? (
                  <button onClick={sendOtp} disabled={otpLoading} style={{ ...S.btnP, width: '100%', padding: 12, opacity: otpLoading ? .6 : 1 }}>
                    {otpLoading ? 'Sending...' : '📱 Send OTP'}
                  </button>
                ) : (
                  <>
                    <Fld label="Enter 6-digit OTP">
                      <input style={{ ...S.inp(), textAlign: 'center', letterSpacing: 8, fontSize: 22, fontWeight: 600 }} value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6} />
                    </Fld>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      <button onClick={verifyOtp} disabled={otpLoading || otp.length < 6} style={{ ...S.btnP, flex: 1, opacity: otpLoading || otp.length < 6 ? .6 : 1, cursor: otp.length < 6 ? 'not-allowed' : 'pointer' }}>
                        {otpLoading ? 'Verifying...' : '✓ Verify OTP'}
                      </button>
                      <button onClick={() => { setOtpSent(false); setOtp('') }} style={S.btnO}>Resend</button>
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>OTP valid for 10 minutes</div>
                  </>
                )}
              </>
            )}
            {c.otp_verified && (
              <button onClick={nextStep} style={{ ...S.btnP, width: '100%', padding: 12 }}>Continue →</button>
            )}
            <button onClick={prevStep} style={{ ...S.btnO, width: '100%', marginTop: 10 }}>← Back</button>
          </div>
        )}

        {/* ═══ STEP 3: PERSONAL DETAILS ════════════════════════════ */}
        {step === 3 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Personal Details</div>

            {/* AI pre-fill notice */}
            {aiName && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#065F46' }}>
                🤖 AI extracted name from documents: <strong>{aiName}</strong>. Please verify below.
              </div>
            )}

            <div style={S.g2}>
              <Fld label="Full Name (as per Aadhaar) *">
                <input style={S.inp(!personal.full_name)} value={personal.full_name} onChange={e => setPersonal(p => ({ ...p, full_name: e.target.value }))} />
              </Fld>
              <Fld label="Date of Birth *">
                <input type="date" style={S.inp(!personal.dob)} value={personal.dob} onChange={e => setPersonal(p => ({ ...p, dob: e.target.value }))} />
              </Fld>
              <Fld label="Gender *">
                <select style={S.sel} value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}>
                  <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Blood Group *">
                <select style={S.sel} value={personal.blood_group} onChange={e => setPersonal(p => ({ ...p, blood_group: e.target.value }))}>
                  <option value="">Select</option>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(g => <option key={g}>{g}</option>)}
                </select>
              </Fld>
              <Fld label="Father's Name *">
                <input style={S.inp(!personal.father_name)} value={personal.father_name} onChange={e => setPersonal(p => ({ ...p, father_name: e.target.value }))} placeholder="As per documents" />
              </Fld>
              <Fld label="Mother's Name">
                <input style={S.inp()} value={personal.mother_name} onChange={e => setPersonal(p => ({ ...p, mother_name: e.target.value }))} />
              </Fld>
              <Fld label="Marital Status *">
                <select style={S.sel} value={personal.marital_status} onChange={e => setPersonal(p => ({ ...p, marital_status: e.target.value }))}>
                  <option value="">Select</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
                </select>
              </Fld>
              <Fld label="Nationality">
                <input style={S.inp()} value={personal.nationality} onChange={e => setPersonal(p => ({ ...p, nationality: e.target.value }))} />
              </Fld>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={async () => {
                if (!personal.full_name || !personal.dob || !personal.gender || !personal.father_name || !personal.blood_group) {
                  showToast('Please fill all required fields', 'err'); return
                }
                await saveStep(3, personal)
                nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: CONTACT & ADDRESS ═══════════════════════════ */}
        {step === 4 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Contact & Address</div>

            <div style={S.g2}>
              <Fld label="Mobile Number *"><input style={S.inp(!contact.mobile)} value={contact.mobile} onChange={e => setContact(c => ({ ...c, mobile: e.target.value }))} /></Fld>
              <Fld label="Alternate Mobile"><input style={S.inp()} value={contact.alt_mobile} onChange={e => setContact(c => ({ ...c, alt_mobile: e.target.value }))} /></Fld>
              <div style={{ gridColumn: 'span 2' }}><Fld label="Personal Email *"><input type="email" style={S.inp(!contact.personal_email)} value={contact.personal_email} onChange={e => setContact(c => ({ ...c, personal_email: e.target.value }))} /></Fld></div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '12px 0 10px' }}>Permanent Address</div>
            <div style={S.g3}>
              <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1 *"><input style={S.inp(!contact.perm_line1)} value={contact.perm_line1} onChange={e => setContact(c => ({ ...c, perm_line1: e.target.value }))} /></Fld></div>
              <Fld label="City *"><input style={S.inp(!contact.perm_city)} value={contact.perm_city} onChange={e => setContact(c => ({ ...c, perm_city: e.target.value }))} /></Fld>
              <Fld label="State *">
                <select style={S.sel} value={contact.perm_state} onChange={e => setContact(c => ({ ...c, perm_state: e.target.value }))}>
                  <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Fld>
              <Fld label="PIN Code *"><input style={S.inp(!contact.perm_pin)} value={contact.perm_pin} onChange={e => setContact(c => ({ ...c, perm_pin: e.target.value }))} maxLength={6} /></Fld>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, margin: '12px 0 10px', userSelect: 'none' }}>
              <input type="checkbox" checked={contact.same_address} onChange={e => setContact(c => ({ ...c, same_address: e.target.checked }))} style={{ width: 16, height: 16 }} />
              Current address same as permanent address
            </label>

            {!contact.same_address && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>Current / Local Address</div>
                <div style={S.g3}>
                  <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1"><input style={S.inp()} value={contact.curr_line1} onChange={e => setContact(c => ({ ...c, curr_line1: e.target.value }))} /></Fld></div>
                  <Fld label="City"><input style={S.inp()} value={contact.curr_city} onChange={e => setContact(c => ({ ...c, curr_city: e.target.value }))} /></Fld>
                  <Fld label="State">
                    <select style={S.sel} value={contact.curr_state} onChange={e => setContact(c => ({ ...c, curr_state: e.target.value }))}>
                      <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Fld>
                  <Fld label="PIN Code"><input style={S.inp()} value={contact.curr_pin} onChange={e => setContact(c => ({ ...c, curr_pin: e.target.value }))} maxLength={6} /></Fld>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={async () => {
                if (!contact.mobile || !contact.personal_email || !contact.perm_line1 || !contact.perm_city || !contact.perm_state || !contact.perm_pin) {
                  showToast('Please fill all required fields', 'err'); return
                }
                await saveStep(4, contact); nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 5: EMERGENCY + EMPLOYMENT ════════════════════════ */}
        {step === 5 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Emergency Contacts & Previous Employment</div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>Emergency Contact 1 *</div>
            <div style={S.g3}>
              <Fld label="Name *"><input style={S.inp(!emergency.emrg1_name)} value={emergency.emrg1_name} onChange={e => setEmergency(p => ({ ...p, emrg1_name: e.target.value }))} /></Fld>
              <Fld label="Relation *">
                <select style={S.sel} value={emergency.emrg1_relation} onChange={e => setEmergency(p => ({ ...p, emrg1_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile *"><input style={S.inp(!emergency.emrg1_mobile)} value={emergency.emrg1_mobile} onChange={e => setEmergency(p => ({ ...p, emrg1_mobile: e.target.value }))} /></Fld>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '10px 0 10px' }}>Emergency Contact 2 (Optional)</div>
            <div style={S.g3}>
              <Fld label="Name"><input style={S.inp()} value={emergency.emrg2_name} onChange={e => setEmergency(p => ({ ...p, emrg2_name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={emergency.emrg2_relation} onChange={e => setEmergency(p => ({ ...p, emrg2_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile"><input style={S.inp()} value={emergency.emrg2_mobile} onChange={e => setEmergency(p => ({ ...p, emrg2_mobile: e.target.value }))} /></Fld>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Previous Employment</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 12, userSelect: 'none' }}>
              <input type="checkbox" checked={emergency.is_fresher} onChange={e => setEmergency(p => ({ ...p, is_fresher: e.target.checked }))} style={{ width: 16, height: 16 }} />
              I am a fresher (no previous work experience)
            </label>

            {!emergency.is_fresher && (
              <div style={S.g2}>
                <Fld label="Previous Company"><input style={S.inp()} value={emergency.prev_company} onChange={e => setEmergency(p => ({ ...p, prev_company: e.target.value }))} /></Fld>
                <Fld label="Designation"><input style={S.inp()} value={emergency.prev_designation} onChange={e => setEmergency(p => ({ ...p, prev_designation: e.target.value }))} /></Fld>
                <Fld label="From"><input type="date" style={S.inp()} value={emergency.prev_from} onChange={e => setEmergency(p => ({ ...p, prev_from: e.target.value }))} /></Fld>
                <Fld label="To"><input type="date" style={S.inp()} value={emergency.prev_to} onChange={e => setEmergency(p => ({ ...p, prev_to: e.target.value }))} /></Fld>
                <Fld label="Last CTC (Annual ₹)"><input type="number" style={S.inp()} value={emergency.prev_ctc} onChange={e => setEmergency(p => ({ ...p, prev_ctc: e.target.value }))} /></Fld>
                <Fld label="Reason for Leaving"><input style={S.inp()} value={emergency.reason_leaving} onChange={e => setEmergency(p => ({ ...p, reason_leaving: e.target.value }))} /></Fld>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={async () => {
                if (!emergency.emrg1_name || !emergency.emrg1_relation || !emergency.emrg1_mobile) {
                  showToast('Please fill Emergency Contact 1 details', 'err'); return
                }
                await saveStep(5, emergency); nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 6: DOCUMENT UPLOAD ════════════════════════════ */}
        {step === 6 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Document Upload & AI Verification</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              Documents are automatically verified using AI (Gemini 2.5 Flash). Accepted: JPG, PNG, PDF. Max 5MB each.
            </div>

            {[
              { code: 'AADHAAR_FRONT', name: 'Aadhaar Card (Front)', required: true },
              { code: 'AADHAAR_BACK', name: 'Aadhaar Card (Back)', required: true },
              { code: 'PAN', name: 'PAN Card', required: true },
              { code: 'PHOTO', name: 'Passport Size Photo', required: true },
              { code: 'DEGREE', name: 'Highest Degree Certificate', required: true },
              { code: 'EXP_LETTER', name: 'Experience/Relieving Letter', required: !emergency.is_fresher },
              { code: 'BANK_PROOF', name: 'Cancelled Cheque / Bank Passbook', required: true },
              { code: 'UAN_CARD', name: 'UAN Card (if existing PF)', required: false },
            ].map(doc => (
              <DocUpload
                key={doc.code}
                docCode={doc.code}
                docName={doc.name}
                required={doc.required}
                token={token}
                status={docs[doc.code] || null}
                onSuccess={(code, data) => {
                  setDocs(d => ({
                    ...d,
                    [code]: {
                      doc_code: code,
                      ai_status: data.ai_status,
                      ai_extracted_data: data.ai_extracted,
                      ai_confidence: data.ai_confidence,
                      ai_flags: data.ai_flags,
                      file_name: 'uploaded',
                    },
                  }))
                  // Auto-fill PAN from extracted data
                  if (code === 'PAN' && data.ai_extracted?.pan_number) {
                    setStatutory(s => ({ ...s, pan_number: data.ai_extracted.pan_number, acc_holder: data.ai_extracted.name || s.acc_holder }))
                  }
                  showToast(`${code} uploaded & AI verified ✓`)
                }}
              />
            ))}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={async () => {
                const requiredDocs = ['AADHAAR_FRONT', 'PAN', 'PHOTO', 'DEGREE', 'BANK_PROOF']
                const notUploaded = requiredDocs.filter(d => !docs[d])
                if (notUploaded.length > 0) {
                  showToast(`Please upload: ${notUploaded.join(', ')}`, 'err'); return
                }
                await saveStep(6, { docs_uploaded: Object.keys(docs) }); nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 7: STATUTORY & BANK ═══════════════════════════ */}
        {step === 7 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Statutory Details & Bank Account</div>

            {/* PAN — auto-filled from AI */}
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#065F46' }}>
              🤖 PAN auto-filled from document AI. Please verify.
            </div>
            <div style={S.g2}>
              <Fld label="PAN Number *" hint="Auto-extracted from PAN card">
                <input style={{ ...S.inp(!statutory.pan_number), background: '#F0FDF4', borderColor: '#A7F3D0' }} value={statutory.pan_number || aiPan} onChange={e => setStatutory(s => ({ ...s, pan_number: e.target.value.toUpperCase() }))} maxLength={10} />
              </Fld>
            </div>

            {/* PF Section */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Provident Fund (PF)</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 12, userSelect: 'none' }}>
              <input type="checkbox" checked={statutory.has_uan} onChange={e => setStatutory(s => ({ ...s, has_uan: e.target.checked }))} style={{ width: 16, height: 16 }} />
              I have an existing UAN (from previous employer)
            </label>
            {statutory.has_uan && (
              <div style={S.g2}>
                <Fld label="UAN Number" hint="12-digit Universal Account Number">
                  <input style={S.inp()} value={statutory.uan_number} onChange={e => setStatutory(s => ({ ...s, uan_number: e.target.value }))} maxLength={12} />
                </Fld>
                <Fld label="Previous PF Member ID">
                  <input style={S.inp()} value={statutory.prev_pf_id} onChange={e => setStatutory(s => ({ ...s, prev_pf_id: e.target.value }))} placeholder="e.g. MH/BN/12345" />
                </Fld>
              </div>
            )}

            {/* PF Nominee (Form 11/Form 2) */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>PF Nominee (EPF Form 2)</div>
            <div style={S.g3}>
              <Fld label="Nominee Name *"><input style={S.inp(!statutory.nominee_name)} value={statutory.nominee_name} onChange={e => setStatutory(s => ({ ...s, nominee_name: e.target.value }))} /></Fld>
              <Fld label="Relation *">
                <select style={S.sel} value={statutory.nominee_relation} onChange={e => setStatutory(s => ({ ...s, nominee_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Date of Birth *"><input type="date" style={S.inp(!statutory.nominee_dob)} value={statutory.nominee_dob} onChange={e => setStatutory(s => ({ ...s, nominee_dob: e.target.value }))} /></Fld>
              <Fld label="Share %"><input type="number" style={S.inp()} value={statutory.nominee_share} onChange={e => setStatutory(s => ({ ...s, nominee_share: e.target.value }))} /></Fld>
              <div style={{ gridColumn: 'span 2' }}><Fld label="Nominee Address *"><input style={S.inp(!statutory.nominee_address)} value={statutory.nominee_address} onChange={e => setStatutory(s => ({ ...s, nominee_address: e.target.value }))} /></Fld></div>
            </div>

            {/* Gratuity nominee */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Gratuity Nominee (Form F)</div>
            <div style={S.g2}>
              <Fld label="Nominee Name"><input style={S.inp()} value={statutory.grat_nominee_name} onChange={e => setStatutory(s => ({ ...s, grat_nominee_name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={statutory.grat_nominee_relation} onChange={e => setStatutory(s => ({ ...s, grat_nominee_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option><option>Other</option>
                </select>
              </Fld>
            </div>

            {/* Bank Details */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Bank Account (for Salary)</div>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400E' }}>
              🔒 Bank details are encrypted. Only Payroll team has access.
            </div>
            <div style={S.g2}>
              <Fld label="Account Number *"><input type="password" style={S.inp(!statutory.bank_account)} value={statutory.bank_account} onChange={e => setStatutory(s => ({ ...s, bank_account: e.target.value }))} /></Fld>
              <Fld label="Confirm Account Number *"><input style={S.inp(statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account)} value={statutory.bank_confirm} onChange={e => setStatutory(s => ({ ...s, bank_confirm: e.target.value }))} /></Fld>
              <Fld label="IFSC Code *" hint="Auto-fills bank name on entry">
                <input style={S.inp(!statutory.bank_ifsc)} value={statutory.bank_ifsc} onChange={e => { const v = e.target.value.toUpperCase(); setStatutory(s => ({ ...s, bank_ifsc: v })); lookupIfsc(v) }} maxLength={11} />
              </Fld>
              <Fld label="Bank Name (auto-fill)">
                <input style={{ ...S.inp(), background: '#F0FDF4', borderColor: '#A7F3D0' }} value={statutory.bank_name} readOnly placeholder="Auto-fills from IFSC" />
              </Fld>
              <Fld label="Branch"><input style={{ ...S.inp(), background: '#F0FDF4', borderColor: '#A7F3D0' }} value={statutory.bank_branch} readOnly placeholder="Auto-fills from IFSC" /></Fld>
              <Fld label="Account Type">
                <select style={S.sel} value={statutory.account_type} onChange={e => setStatutory(s => ({ ...s, account_type: e.target.value }))}>
                  <option>Savings</option><option>Current</option>
                </select>
              </Fld>
              <div style={{ gridColumn: 'span 2' }}>
                <Fld label="Account Holder Name (as per bank)">
                  <input style={{ ...S.inp(), background: '#F0FDF4', borderColor: '#A7F3D0' }} value={statutory.acc_holder} onChange={e => setStatutory(s => ({ ...s, acc_holder: e.target.value }))} placeholder="In CAPITAL LETTERS" />
                </Fld>
              </div>
            </div>
            {statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account && (
              <div style={{ color: '#DC2626', fontSize: 12, marginTop: -8, marginBottom: 8 }}>⚠️ Account numbers don't match</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={async () => {
                if (!statutory.pan_number || !statutory.nominee_name || !statutory.nominee_dob || !statutory.nominee_address || !statutory.bank_account || !statutory.bank_ifsc) {
                  showToast('Please fill all required fields', 'err'); return
                }
                if (statutory.bank_account !== statutory.bank_confirm) { showToast('Account numbers do not match', 'err'); return }
                await saveStep(7, statutory); nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 8: DECLARATION ════════════════════════════════ */}
        {step === 8 && (
          <div>
            {/* Summary */}
            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Review & Declaration</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {[
                  { l: 'Name', v: personal.full_name || c.full_name },
                  { l: 'DOB', v: personal.dob || '—' },
                  { l: 'Mobile', v: contact.mobile || c.mobile },
                  { l: 'Email', v: contact.personal_email || c.email },
                  { l: 'PAN', v: statutory.pan_number || '—' },
                  { l: 'Bank', v: statutory.bank_name ? `${statutory.bank_name} ...${statutory.bank_account?.slice(-4) || ''}` : '—' },
                  { l: 'PF Nominee', v: statutory.nominee_name || '—' },
                  { l: 'Documents', v: `${Object.keys(docs).length} uploaded` },
                ].map(({ l, v }) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#FAFAF8', borderRadius: 7, border: '1px solid #EDE9FE' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#6B7280' }}>{l}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#1E1B4B' }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Declaration */}
              <div style={{ background: '#EEEDFE', borderRadius: 10, padding: '14px 16px', marginBottom: 14, fontSize: 12, color: '#3C3489', lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Declaration</div>
                I hereby declare that all information provided by me in this form is true, correct, and complete to the best of my knowledge and belief. I understand that any false or misleading information may lead to withdrawal of the offer or termination of employment. I agree to abide by all company policies and rules. I consent to background verification of my credentials.
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, lineHeight: 1.6, userSelect: 'none' }}>
                <input type="checkbox" checked={declaration} onChange={e => setDeclaration(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: 'pointer' }} />
                <span>I have read and accept the above declaration. I confirm all details are accurate and I agree to the company's terms and conditions.</span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={prevStep} style={S.btnO}>← Back</button>
              <button onClick={handleSubmit} disabled={!declaration || submitting}
                style={{ ...S.btnP, flex: 1, padding: 12, fontSize: 15, background: declaration ? '#059669' : '#9CA3AF', cursor: !declaration || submitting ? 'not-allowed' : 'pointer', opacity: submitting ? .7 : 1 }}>
                {submitting ? '⏳ Submitting...' : '✅ Submit Joining Form'}
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
