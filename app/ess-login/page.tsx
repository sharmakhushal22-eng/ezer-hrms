'use client'
// app/ess-login/page.tsx — Employee Self-Service login (email → password / set-password).
import { useState } from 'react'

type Step = 'email' | 'login' | 'setpw'

export default function ESSLoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const finish = (data: { employee_id: string; name: string }) => {
    localStorage.setItem(
      'ezer_ess_session',
      JSON.stringify({ employee_id: data.employee_id, name: data.name, email: email.trim().toLowerCase() })
    )
    window.location.href = '/ess-portal'
  }

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const em = email.trim().toLowerCase()
    if (!em) { setError('Please enter your email.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }),
      })
      const data = await r.json()
      if (!data.found) { setError('No employee found with this email. Contact HR.'); return }
      setName(data.name || '')
      setEmployeeId(data.employee_id)
      setStep(data.has_password ? 'login' : 'setpw')
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!password) { setError('Please enter your password.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Login failed.'); return }
      finish(data)
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const onSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/ess-auth/set-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Could not set password.'); return }
      finish(data)
    } catch { setError('Something went wrong. Try again.') } finally { setLoading(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 13px', background: '#FAFAF8', border: '1px solid #DDD6FE',
    borderRadius: 7, color: '#1E1B4B', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#6D28D9', textTransform: 'uppercase', letterSpacing: '.06em',
    display: 'block', marginBottom: 6,
  }
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '12px', borderRadius: 7, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
    fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: loading ? '#A78BFA' : '#7C3AED', color: '#fff',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F5F3FF', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: '#1E1B4B', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: '#FFFFFF', borderRadius: 10,
        border: '1px solid rgba(124,58,237,0.12)', boxShadow: '0 1px 4px rgba(124,58,237,0.06)', padding: '32px 28px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect width="44" height="44" rx="10" fill="#7C3AED" />
              <rect x="11" y="10" width="5" height="24" rx="1.5" fill="white" />
              <rect x="11" y="10" width="19" height="6" rx="1.5" fill="white" />
              <rect x="11" y="19" width="14" height="5" rx="1.5" fill="white" />
              <rect x="11" y="28" width="19" height="6" rx="1.5" fill="white" />
              <polygon points="32,5 38,12 26,12" fill="#C4B5FD" />
              <rect x="29.5" y="12" width="5" height="6" rx="1" fill="#C4B5FD" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: '#1E1B4B' }}>Employee Self-Service Login</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            {step === 'email' && 'Sign in with your work or personal email'}
            {step === 'login' && (name ? `Welcome back, ${name}` : 'Enter your password')}
            {step === 'setpw' && (name ? `Hi ${name}, set your password` : 'Set your password')}
          </p>
        </div>

        {step === 'email' && (
          <form onSubmit={onContinue}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                style={inputStyle} autoFocus
                onFocus={(e) => (e.target.style.borderColor = '#7C3AED')}
                onBlur={(e) => (e.target.style.borderColor = '#DDD6FE')} />
            </div>
            {error && <ErrorBox msg={error} />}
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Checking…' : 'Continue →'}</button>
          </form>
        )}

        {step === 'login' && (
          <form onSubmit={onLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                style={inputStyle} autoFocus
                onFocus={(e) => (e.target.style.borderColor = '#7C3AED')}
                onBlur={(e) => (e.target.style.borderColor = '#DDD6FE')} />
            </div>
            {error && <ErrorBox msg={error} />}
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Signing in…' : 'Log in →'}</button>
            <BackLink onClick={() => { setStep('email'); setError(''); setPassword('') }} />
          </form>
        )}

        {step === 'setpw' && (
          <form onSubmit={onSetPassword}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 14px', background: '#F5F3FF', padding: '9px 11px', borderRadius: 7 }}>
              First time here — create a password (at least 6 characters) for your ESS account.
            </p>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                style={inputStyle} autoFocus
                onFocus={(e) => (e.target.style.borderColor = '#7C3AED')}
                onBlur={(e) => (e.target.style.borderColor = '#DDD6FE')} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Confirm Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = '#7C3AED')}
                onBlur={(e) => (e.target.style.borderColor = '#DDD6FE')} />
            </div>
            {error && <ErrorBox msg={error} />}
            <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Saving…' : 'Set password & continue →'}</button>
            <BackLink onClick={() => { setStep('email'); setError(''); setPassword(''); setConfirm('') }} />
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 22, borderTop: '1px solid rgba(124,58,237,0.12)', paddingTop: 16 }}>
          <a href="/" style={{ fontSize: 12, color: '#7C3AED', textDecoration: 'none', fontWeight: 500 }}>
            ← Admin login
          </a>
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '9px 12px',
      fontSize: 13, color: '#DC2626', marginBottom: 14,
    }}>⚠️ {msg}</div>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <button type="button" onClick={onClick} style={{
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6B7280',
        fontFamily: 'inherit', textDecoration: 'underline',
      }}>Use a different email</button>
    </div>
  )
}
