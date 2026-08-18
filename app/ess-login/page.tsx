'use client'
// app/ess-login/page.tsx — Employee Self-Service login.
// Identifier = email OR employee code. Steps: identifier → login / set-password,
// plus a forced change-password step when HR issued a temp password (= emp_code).
import { useState } from 'react'

type Step = 'email' | 'login' | 'setpw' | 'changepw'

// ── EZER palette ──
const P = { purple: '#7C3AED', purpleDark: '#5B21B6', purpleDeep: '#3C1E7A', navy: '#1E1B4B', muted: '#6B7280', border: '#EDE9FE', bg: '#F5F3FF' }

// ── Reusable field components (OUTSIDE parent — no focus-loss) ──
function TextField({ label, value, onChange, placeholder, icon, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; icon: React.ReactNode; autoFocus?: boolean }) {
  const [focus, setFocus] = useState(false)
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: focus ? P.purple : '#A78BFA', fontSize: 15, lineHeight: 1 }}>{icon}</span>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoCapitalize="characters"
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ ...fieldStyle, paddingLeft: 38, borderColor: focus ? P.purple : P.border, boxShadow: focus ? '0 0 0 4px rgba(124,58,237,0.10)' : 'none' }} />
      </div>
    </div>
  )
}
function PasswordField({ label, value, onChange, placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [focus, setFocus] = useState(false)
  const [show, setShow] = useState(false)
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: focus ? P.purple : '#A78BFA', fontSize: 15, lineHeight: 1 }}>🔒</span>
        <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ ...fieldStyle, paddingLeft: 38, paddingRight: 44, borderColor: focus ? P.purple : P.border, boxShadow: focus ? '0 0 0 4px rgba(124,58,237,0.10)' : 'none' }} />
        <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: P.muted, fontSize: 15, padding: 6, lineHeight: 1 }}>{show ? '🙈' : '👁️'}</button>
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', background: '#FAFAFE', border: `1.5px solid ${P.border}`, borderRadius: 10, color: P.navy, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s' }
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6D28D9', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 7 }

export default function ESSLoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')            // identifier (email or emp_code)
  const [password, setPassword] = useState('')      // current password (temp or real)
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [, setEmployeeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const idValue = () => email.trim()

  const finish = (data: { employee_id: string; name: string; token?: string | null }) => {
    localStorage.setItem('ezer_ess_session', JSON.stringify({ employee_id: data.employee_id, name: data.name, email: idValue().toLowerCase(), token: data.token || null }))
    window.location.href = '/ess-portal'
  }

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    const id = idValue()
    if (!id) { setError('Please enter your email or employee code.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id }) })
      const data = await r.json()
      if (!data.found) { setError('No employee found. Check your email / code or contact HR.'); return }
      setName(data.name || ''); setEmployeeId(data.employee_id)
      setStep(data.has_password ? 'login' : 'setpw')
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    if (!password) { setError('Please enter your password.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: idValue(), password }) })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Login failed.'); return }
      if (data.must_change_password) { setName(data.name || name); setStep('changepw'); return }
      finish(data)
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const onSetPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: idValue(), password }) })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Could not set password.'); return }
      finish(data)
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    if (newPw.length < 6) { setError('New password must be at least 6 characters.'); return }
    if (newPw !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: idValue(), current_password: password, new_password: newPw }) })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Could not change password.'); return }
      finish(data)
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const subtitle = step === 'email' ? 'Sign in with your email or employee code'
    : step === 'login' ? (name ? `Welcome back, ${name.split(' ')[0]} 👋` : 'Enter your password')
    : step === 'setpw' ? (name ? `Hi ${name.split(' ')[0]}, create your password` : 'Create your password')
    : (name ? `Hi ${name.split(' ')[0]}, set a new password` : 'Set a new password')

  const stepIndex = step === 'email' ? 0 : 1

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: P.bg, fontFamily: '"DM Sans","Segoe UI",sans-serif', color: P.navy }}>

      {/* ── Left brand panel (desktop) ── */}
      <div className="ezer-brand" style={{
        flex: '1 1 46%', maxWidth: 560, position: 'relative', overflow: 'hidden', color: '#fff',
        background: `linear-gradient(155deg, ${P.purple} 0%, ${P.purpleDark} 55%, ${P.purpleDeep} 100%)`,
        padding: '48px 52px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        {/* decorative blobs */}
        <div style={{ position: 'absolute', top: -90, right: -70, width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: -120, left: -80, width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle, rgba(196,181,253,0.22), transparent 65%)' }} />

        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 44 44" fill="none">
                <rect x="10" y="9" width="6" height="26" rx="2" fill="white" />
                <rect x="10" y="9" width="20" height="6" rx="2" fill="white" />
                <rect x="10" y="19" width="15" height="5" rx="2" fill="white" />
                <rect x="10" y="29" width="20" height="6" rx="2" fill="white" />
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '.02em' }}>EZER HRMS</div>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginBottom: 14 }}>Your workday,<br />in one place.</div>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.82)', lineHeight: 1.6, maxWidth: 380, marginBottom: 28 }}>
            Payslips, leave, attendance, flexi benefits &amp; more — all self-service, secure, and always with you.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[['📄', 'Payslips & tax', 'Download anytime'], ['🌴', 'Leave & attendance', 'Apply and track'], ['💳', 'Flexi & reimbursements', 'Submit bills in a tap']].map(([ic, t, s]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>{ic}</div>
                <div><div style={{ fontSize: 14, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)' }}>{s}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>🔒 Bank-grade security · Your data stays private</div>
      </div>

      {/* ── Right form panel ── */}
      <div style={{ flex: '1 1 54%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 404 }}>
          {/* Mobile brand header */}
          <div className="ezer-mobile-brand" style={{ display: 'none', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 22 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: P.purple, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 44 44" fill="none"><rect x="10" y="9" width="6" height="26" rx="2" fill="white" /><rect x="10" y="9" width="20" height="6" rx="2" fill="white" /><rect x="10" y="19" width="15" height="5" rx="2" fill="white" /><rect x="10" y="29" width="20" height="6" rx="2" fill="white" /></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: P.navy }}>EZER HRMS</div>
          </div>

          <div style={{ background: '#fff', borderRadius: 18, border: '1px solid rgba(124,58,237,0.10)', boxShadow: '0 12px 40px rgba(124,58,237,0.12)', padding: '34px 32px' }}>
            {/* Step dots */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {[0, 1].map(i => <div key={i} style={{ height: 4, flex: 1, borderRadius: 99, background: i <= stepIndex ? P.purple : '#EDE9FE', transition: 'background .2s' }} />)}
            </div>

            <div style={{ marginBottom: 22 }}>
              <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 5px', color: P.navy }}>
                {step === 'email' ? 'Employee Sign In' : step === 'setpw' ? 'Create Password' : step === 'changepw' ? 'New Password' : 'Enter Password'}
              </h1>
              <p style={{ fontSize: 13.5, color: P.muted, margin: 0 }}>{subtitle}</p>
            </div>

            {step === 'email' && (
              <form onSubmit={onContinue}>
                <TextField label="Email or Employee Code" value={email} onChange={setEmail} placeholder="you@company.com  ·  SRS0001" icon="👤" autoFocus />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn loading={loading} label="Continue →" loadingLabel="Checking…" />
              </form>
            )}

            {step === 'login' && (
              <form onSubmit={onLogin}>
                <PasswordField label="Password" value={password} onChange={setPassword} placeholder="Enter your password" autoFocus />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn loading={loading} label="Log in →" loadingLabel="Signing in…" />
                <BackLink onClick={() => { setStep('email'); setError(''); setPassword('') }} />
              </form>
            )}

            {step === 'setpw' && (
              <form onSubmit={onSetPassword}>
                <div style={infoBox}>✨ First time here — create a password (min 6 characters) for your ESS account.</div>
                <PasswordField label="New Password" value={password} onChange={setPassword} placeholder="At least 6 characters" autoFocus />
                <PasswordField label="Confirm Password" value={confirm} onChange={setConfirm} placeholder="Re-enter password" />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn loading={loading} label="Set password & continue →" loadingLabel="Saving…" />
                <BackLink onClick={() => { setStep('email'); setError(''); setPassword(''); setConfirm('') }} />
              </form>
            )}

            {step === 'changepw' && (
              <form onSubmit={onChangePassword}>
                <div style={{ ...infoBox, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>🔒 You logged in with a temporary password. Set your own password to continue.</div>
                <PasswordField label="New Password" value={newPw} onChange={setNewPw} placeholder="At least 6 characters" autoFocus />
                <PasswordField label="Confirm New Password" value={confirm} onChange={setConfirm} placeholder="Re-enter password" />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn loading={loading} label="Set new password & continue →" loadingLabel="Saving…" />
              </form>
            )}

            <div style={{ textAlign: 'center', marginTop: 24, borderTop: '1px solid rgba(124,58,237,0.10)', paddingTop: 18 }}>
              <a href="/" style={{ fontSize: 12.5, color: P.purple, textDecoration: 'none', fontWeight: 600 }}>← Admin login</a>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11.5, color: '#9CA3AF' }}>Need help? Contact your HR team.</div>
        </div>
      </div>

      {/* Responsive: hide brand panel on small screens, show mobile header */}
      <style>{`
        @media (max-width: 880px) {
          .ezer-brand { display: none !important; }
          .ezer-mobile-brand { display: flex !important; }
        }
      `}</style>
    </div>
  )
}

const infoBox: React.CSSProperties = { fontSize: 12.5, color: '#4C1D95', background: '#F5F3FF', border: '1px solid #EDE9FE', padding: '10px 12px', borderRadius: 9, marginBottom: 16, lineHeight: 1.5 }

function PrimaryBtn({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button type="submit" disabled={loading} style={{
      width: '100%', padding: '13px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
      fontSize: 14.5, fontWeight: 700, fontFamily: 'inherit', color: '#fff',
      background: loading ? '#A78BFA' : 'linear-gradient(180deg,#8B5CF6,#7C3AED)', boxShadow: loading ? 'none' : '0 6px 18px rgba(124,58,237,0.32)',
      transition: 'transform .1s, box-shadow .15s',
    }}
      onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(124,58,237,0.4)' } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = loading ? 'none' : '0 6px 18px rgba(124,58,237,0.32)' }}>
      {loading ? loadingLabel : label}
    </button>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, padding: '10px 12px', fontSize: 13, color: '#DC2626', marginBottom: 14, display: 'flex', gap: 7, alignItems: 'flex-start' }}><span>⚠️</span><span>{msg}</span></div>
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: '#6B7280', fontFamily: 'inherit' }}>← Use a different email / code</button></div>
}
