'use client'
// components/learning/app/SiteSignIn.tsx — signing in on EZER Learn's own domain.
//
// On the HRMS site, Learning sends people to the HRMS sign-in. On ezerlms.com there is no HRMS
// to send them to, so the same two sign-ins are offered here, through the same APIs, and the
// person stays on this domain throughout:
//
//   Employee   email or employee code, then password, with first-time and temporary-password
//              steps exactly as app/ess-login.
//   Admin      the dashboard email login, as app/page.tsx.
//
// Someone who came from HRMS never sees this: they arrive signed in (lib/lms/sso-client.ts).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ESS_KEY, LOGIN_AT_KEY } from '@/lib/session-policy'
import { GBook } from '../glyphs'

type Step = 'id' | 'login' | 'setpw' | 'changepw' | 'admin'

const post = async (path: string, body: object) => {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

function Field({ label, type = 'text', value, onChange, autoFocus, autoComplete }: { label: string; type?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete?: string }) {
  return (
    <label style={{ display: 'grid', gap: 6, textAlign: 'left', width: '100%' }}>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--ez-ink-soft)' }}>{label}</span>
      <input className="lx-input" type={type} value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus} autoComplete={autoComplete} data-no-titlecase="" />
    </label>
  )
}

export default function SiteSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>('id')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const go = (s: Step) => { setStep(s); setError(''); setPassword(''); setNewPw(''); setConfirm('') }

  const finish = (d: { employee_id: string; name?: string; token?: string | null }) => {
    try {
      localStorage.setItem(ESS_KEY, JSON.stringify({ employee_id: d.employee_id, name: d.name || name, email: id.trim().toLowerCase(), token: d.token || null }))
      localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
    } catch { setError('This browser is blocking storage, so you cannot stay signed in. Turn off private mode and try again.'); return }
    onSignedIn()
  }

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true)
    try { await fn() } catch { setError('Something went wrong. Try again.') } finally { setBusy(false) }
  }

  const onContinue = run(async () => {
    if (!id.trim()) { setError('Enter your email or employee code.'); return }
    const { data } = await post('/api/ess-auth/status', { identifier: id.trim() })
    if (!data.found) { setError('No employee found. Check your email or code, or contact HR.'); return }
    setName(data.name || '')
    go(data.has_password ? 'login' : 'setpw')
  })

  const onLogin = run(async () => {
    if (!password) { setError('Enter your password.'); return }
    const { ok, data } = await post('/api/ess-auth/login', { identifier: id.trim(), password })
    if (!ok) { setError(data.error || 'Sign-in failed.'); return }
    if (data.must_change_password) { setName(data.name || name); setStep('changepw'); return }
    finish(data)
  })

  const onSetPassword = run(async () => {
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    const { ok, data } = await post('/api/ess-auth/set-password', { identifier: id.trim(), password })
    if (!ok) { setError(data.error || 'Could not set the password.'); return }
    finish(data)
  })

  const onChangePassword = run(async () => {
    if (newPw.length < 6) { setError('New password must be at least 6 characters.'); return }
    if (newPw !== confirm) { setError('Passwords do not match.'); return }
    const { ok, data } = await post('/api/ess-auth/change-password', { identifier: id.trim(), current_password: password, new_password: newPw })
    if (!ok) { setError(data.error || 'Could not change the password.'); return }
    finish(data)
  })

  const onAdmin = run(async () => {
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (err) { setError(err.message); return }
    // As app/page.tsx: an admin who is also an employee learns as that employee too.
    const addr = email.trim().toLowerCase()
    const { data: emp } = await supabase.from('employees').select('id, full_name')
      .or(`office_email.ilike.${addr},personal_email.ilike.${addr}`).limit(1).maybeSingle()
    try {
      if (emp?.id) localStorage.setItem(ESS_KEY, JSON.stringify({ employee_id: emp.id, name: emp.full_name, email: addr, token: null }))
      localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
    } catch { /* private mode: the Supabase session alone still opens the Studio */ }
    onSignedIn()
  })

  const first = name.split(' ')[0]
  const title = step === 'admin' ? 'Admin sign-in'
    : step === 'login' ? (first ? `Welcome back, ${first}` : 'Enter your password')
    : step === 'setpw' ? (first ? `Hi ${first}, create your password` : 'Create your password')
    : step === 'changepw' ? 'Set a new password'
    : 'Sign in to EZER Learn'
  const sub = step === 'admin' ? 'For HR and L&D teams who manage courses.'
    : step === 'setpw' ? 'This is your first sign-in. Choose a password of at least 6 characters.'
    : step === 'changepw' ? 'HR gave you a temporary password. Choose your own to continue.'
    : step === 'login' ? id.trim()
    : 'Use your work email or employee code.'

  return (
    <div className="ezl"><div className="lx-gate">
      <div className="lx-gate-box lx-in">
        <div className="lx-brand-mark" style={{ width: 56, height: 56, borderRadius: 18 }}><span style={{ width: 46, height: 46, borderRadius: 14 }}><GBook size={24} /></span></div>
        <div style={{ display: 'grid', gap: 6 }}>
          <h1 className="lx-display" style={{ fontSize: 26 }}>{title}</h1>
          <p style={{ color: 'var(--ez-muted)', lineHeight: 1.6, fontSize: 14.5 }}>{sub}</p>
        </div>
        <form style={{ display: 'grid', gap: 14, width: '100%' }} noValidate
          onSubmit={step === 'id' ? onContinue : step === 'login' ? onLogin : step === 'setpw' ? onSetPassword : step === 'changepw' ? onChangePassword : onAdmin}>
          {step === 'id' && <Field label="Email or employee code" value={id} onChange={setId} autoFocus autoComplete="username" />}
          {step === 'login' && <Field label="Password" type="password" value={password} onChange={setPassword} autoFocus autoComplete="current-password" />}
          {step === 'setpw' && <>
            <Field label="New password" type="password" value={password} onChange={setPassword} autoFocus autoComplete="new-password" />
            <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </>}
          {step === 'changepw' && <>
            <Field label="New password" type="password" value={newPw} onChange={setNewPw} autoFocus autoComplete="new-password" />
            <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </>}
          {step === 'admin' && <>
            <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus autoComplete="username" />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </>}
          {error && <div className="lx-problem" role="alert" style={{ textAlign: 'left' }}>{error}</div>}
          <button className="lx-btn lx-btn--primary lx-btn--lg lx-btn--full" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : step === 'id' ? 'Continue' : step === 'setpw' || step === 'changepw' ? 'Save and sign in' : 'Sign in'}
          </button>
        </form>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
          {step !== 'id' && <button className="lx-btn lx-btn--ghost lx-btn--sm" type="button" onClick={() => go('id')}>{step === 'admin' ? 'Employee sign-in' : 'Use a different account'}</button>}
          {step === 'id' && <button className="lx-btn lx-btn--ghost lx-btn--sm" type="button" onClick={() => go('admin')}>HR or admin? Sign in with email</button>}
        </div>
      </div>
    </div></div>
  )
}
