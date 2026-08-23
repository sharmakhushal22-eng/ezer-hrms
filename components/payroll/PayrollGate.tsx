'use client'
// components/payroll/PayrollGate.tsx — payroll asks who you are, again.
//
// Signing in gets you into the dashboard. It should not, on its own, get you into the one
// screen that carries 398 people's salaries — an unattended laptop with a live session is
// the ordinary way that leaks. So this stands in front of the payroll module and asks for
// the password a second time.
//
// It knows who you are already, so it says so and asks only for the password. Making
// somebody re-type an employee code they have just used to sign in is friction that buys
// nothing; the field is there, filled in, because people expect to see it.
import { useState, useEffect, useRef } from 'react'
import { useGrant, authToken } from '@/lib/rms-client'
import { UNLOCK_STORAGE_KEY } from '@/lib/payroll-unlock'

const FONT = '"DM Sans","Segoe UI",sans-serif'

interface Stored { token: string; expiresAt: number }

function readUnlock(): Stored | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(UNLOCK_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Stored
    // sessionStorage, not localStorage, on purpose: closing the tab should re-lock.
    return v?.token && v.expiresAt > Date.now() ? v : null
  } catch { return null }
}

// ── Sub-components outside the parent, or the password field re-mounts on every
//    keystroke and loses focus after one character. ──

/** Drawn rather than an emoji, so the shackle can lift when the lock opens. */
function Padlock({ open }: { open: boolean }) {
  return (
    <svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true">
      <path
        d={open ? 'M8 14V9a7 7 0 0 1 13.5-2.5' : 'M8 14V9a7 7 0 0 1 14 0v5'}
        stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none"
        style={{ transition: 'd .35s ease' }}
      />
      <rect x="3" y="14" width="24" height="17" rx="4" fill="#fff" />
      <circle cx="15" cy="21" r="2.6" fill="#6D28D9" />
      <rect x="14" y="22" width="2" height="4.5" rx="1" fill="#6D28D9" />
    </svg>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6D28D9', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 12px', background: '#FAFAF8',
  border: '1px solid #DDD6FE', borderRadius: 7, color: '#1E1B4B',
  fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

function LockScreen({ name, empCode, identifier, onIdentifier, onUnlock }: {
  name: string | null
  empCode: string | null
  identifier: string
  onIdentifier: (v: string) => void
  onUnlock: (password: string) => Promise<string | null>
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [opened, setOpened] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)

  useEffect(() => { pwRef.current?.focus() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true); setError('')
    const err = await onUnlock(password)
    if (err) { setError(err); setBusy(false); setPassword(''); pwRef.current?.focus(); return }
    // Let the padlock open before the screen goes. Small, and it makes the moment read
    // as "it worked" rather than as a page flicker.
    setOpened(true)
  }

  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

  return (
    <div style={{
      minHeight: '100vh', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, background: '#1E1B4B',
      backgroundImage: 'radial-gradient(900px 460px at 50% -8%, rgba(124,58,237,0.45), transparent 62%), radial-gradient(620px 380px at 100% 105%, rgba(109,40,217,0.28), transparent 60%)',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* The lock itself, above the card, so it reads as guarding the thing below it */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -26, position: 'relative', zIndex: 2 }}>
          <div style={{
            width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: opened ? '#059669' : '#7C3AED',
            boxShadow: opened ? '0 8px 26px rgba(5,150,105,0.45)' : '0 8px 26px rgba(124,58,237,0.5)',
            transition: 'background .3s ease, box-shadow .3s ease',
          }}>
            <Padlock open={opened} />
          </div>
        </div>

        <div style={{
          background: '#FFFFFF', borderRadius: 14, padding: '38px 28px 26px',
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.55)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#1E1B4B', letterSpacing: '-.01em' }}>
              {opened ? 'Unlocked' : 'Payroll is locked'}
            </div>
            <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 6, lineHeight: 1.55 }}>
              {opened
                ? 'Opening payroll…'
                : 'This screen carries every employee’s salary. Confirm your password to open it.'}
            </div>
          </div>

          {!opened && (
            <>
              {/* Who we already know you are. Nobody should have to guess which account
                  they are about to confirm. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: '#F5F3FF', border: '1px solid #EDE9FE', borderRadius: 9, marginBottom: 18 }}>
                <div style={{ width: 32, height: 32, borderRadius: 99, background: '#7C3AED', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Signed in'}</div>
                  <div style={{ fontSize: 11, color: '#6D28D9', fontFamily: 'monospace' }}>{empCode || 'dashboard account'}</div>
                </div>
              </div>

              <form onSubmit={submit}>
                <Field label="Employee code or email">
                  <input
                    style={inputStyle}
                    value={identifier}
                    onChange={e => onIdentifier(e.target.value)}
                    autoComplete="username"
                    placeholder="Your employee code"
                  />
                </Field>

                <Field label="Password">
                  <div style={{ position: 'relative' }}>
                    <input
                      ref={pwRef}
                      style={{ ...inputStyle, paddingRight: 62, borderColor: error ? '#FCA5A5' : '#DDD6FE' }}
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyUp={e => setCaps((e as any).getModifierState?.('CapsLock') ?? false)}
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                    <button type="button" onClick={() => setShow(s => !s)}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: '#6D28D9', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 6px' }}>
                      {show ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </Field>

                {caps && !error && (
                  <div style={{ fontSize: 11.5, color: '#B45309', marginTop: -6, marginBottom: 12 }}>Caps Lock is on.</div>
                )}
                {error && (
                  <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '8px 10px', marginTop: -4, marginBottom: 12, lineHeight: 1.5 }}>{error}</div>
                )}

                <button type="submit" disabled={!password || busy}
                  style={{
                    width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none',
                    background: '#7C3AED', color: '#fff', fontSize: 13.5, fontWeight: 600,
                    fontFamily: 'inherit', cursor: (!password || busy) ? 'not-allowed' : 'pointer',
                    opacity: (!password || busy) ? 0.5 : 1, transition: 'opacity .15s',
                  }}>
                  {busy ? 'Checking…' : 'Unlock payroll'}
                </button>
              </form>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #F3F0FF', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5, flex: 1 }}>
                  Stays unlocked for 30 minutes, on this tab only.
                </span>
                <a href="/dashboard" style={{ fontSize: 11.5, color: '#6D28D9', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>← Dashboard</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Splash({ text }: { text: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#7C3AED', fontSize: 13 }}>{text}</div>
  )
}

export default function PayrollGate({ children }: { children: React.ReactNode }) {
  const { grant, loading } = useGrant()
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [identifier, setIdentifier] = useState('')

  useEffect(() => {
    const v = readUnlock()
    setUnlocked(!!v)
    if (!v) return
    // Re-lock the moment it expires rather than waiting for the next navigation, so a
    // screen left open does not stay open.
    const ms = v.expiresAt - Date.now()
    const t = setTimeout(() => {
      try { window.sessionStorage.removeItem(UNLOCK_STORAGE_KEY) } catch {}
      setUnlocked(false)
    }, Math.max(ms, 0))
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!identifier && grant.empCode) setIdentifier(grant.empCode)
  }, [grant.empCode, identifier])

  async function unlock(password: string): Promise<string | null> {
    const token = await authToken()
    if (!token) return 'Your session has expired — sign in again.'
    try {
      const res = await fetch('/api/payroll/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ identifier, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return json?.error || 'Could not unlock payroll.'
      try {
        window.sessionStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify({ token: json.token, expiresAt: json.expiresAt }))
      } catch {}
      setTimeout(() => setUnlocked(true), 420)   // let the padlock finish opening
      return null
    } catch {
      return 'Could not reach the server. Try again.'
    }
  }

  if (loading || unlocked === null) return <Splash text="Checking access…" />
  if (unlocked) return <>{children}</>

  return (
    <LockScreen
      name={grant.name}
      empCode={grant.empCode}
      identifier={identifier}
      onIdentifier={setIdentifier}
      onUnlock={unlock}
    />
  )
}
