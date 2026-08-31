'use client'
import { useState, useEffect } from 'react'
import { Logo, LogoStyles } from '@/lib/ui/Logo'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

type Theme = 'light' | 'dark' | 'auto'

export default function LoginPage() {
  const [theme, setTheme] = useState<Theme>('auto')
  const [isDark, setIsDark] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = (localStorage.getItem('ezer-theme') as Theme) || 'auto'
    setTheme(saved)
  }, [])

  useEffect(() => {
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      setIsDark(mq.matches)
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else { setIsDark(theme === 'dark') }
    localStorage.setItem('ezer-theme', theme)
  }, [theme])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    window.location.href = '/dashboard'
  }

  const d = isDark
  const ezerItems = [
    { letter: 'E', title: 'Empower Employees', desc: 'Self-service · ESS · Anytime anywhere' },
  { letter: 'Z', title: 'Zero Compliance Risk', desc: 'EPF · ESIC · PT · Factory Act · All Indian HR Law Complied' },
  { letter: 'E', title: 'Efficient Payroll', desc: 'AI-powered · Zero errors · Auto salary processing' },
  { letter: 'R', title: 'Retain Top Talent', desc: 'Hire to retire · Engage · Recognize' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: d ? '#0F1117' : TK.sunken, fontFamily: '"DM Sans","Segoe UI",sans-serif', transition: 'background 0.3s' }}>
      <LogoStyles />
      <div style={{ width: '46%', background: `linear-gradient(145deg,${TK.ink},${TK.brand})`, display: 'flex', flexDirection: 'column', padding: '44px 48px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-100px', right: '-80px', width: '320px', height: '320px', borderRadius: '50%', background: 'rgba(37,99,235,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '48px', zIndex: 1, position: 'relative' }}>
          {/* This panel is a dark gradient in every theme, so the light-ink
              variant is forced rather than left to the theme. The wordmark is
              in the artwork now — repeating "ezer hrms" beside it would say the
              same thing twice. */}
          <Logo height={40} onDark tagline />
          <div style={{ fontSize: '10px', color: TK.inkSoft, textTransform: 'uppercase', letterSpacing: '0.08em' }}>India&apos;s Intelligent HR Platform</div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ height: '1px', background: 'linear-gradient(90deg,rgba(245,184,0,0.6),transparent)', marginBottom: '28px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '28px' }}>
            {ezerItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: TK.warning, lineHeight: 1, width: '32px', flexShrink: 0 }}>{item.letter}</div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: TK.warning, marginBottom: '2px' }}>{item.title}</div>
                  <div style={{ fontSize: '11px', color: TK.lineStrong }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: '1px', background: 'linear-gradient(90deg,rgba(245,184,0,0.6),transparent)', marginBottom: '24px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[{icon:'',text:'SOC 2 Type 2 Compliant'},{icon:'',text:'Data stored in India — Mumbai Server'},{icon:'',text:'DPDPA 2023 Compliant'}].map((b,i)=>(
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: TK.inkSoft }}>
                <span>{b.icon}</span><span>{b.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '32px', position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: TK.positive }} />
          <span style={{ fontSize: '11px', color: TK.inkSoft }}>ezerhrms.com · All systems operational</span>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px', background: d ? '#0F1117' : '#fff', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', gap: '3px', background: d ? '#1E2030' : TK.sunken, borderRadius: '10px', padding: '4px', border: `1px solid ${d?'#2D3748':TK.line}` }}>
          {([{v:'light' as Theme,icon:''},{v:'dark' as Theme,icon:''},{v:'auto' as Theme,icon:''}]).map(t=>(
            <button key={t.v} onClick={()=>setTheme(t.v)} style={{ padding:'5px 10px',borderRadius:'7px',border:'none',cursor:'pointer',fontSize:'13px',background:theme===t.v?TK.brand:'transparent',color:theme===t.v?TK.surface:(d?TK.muted:TK.faint) }}>{t.icon}</button>
          ))}
        </div>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ marginBottom: '32px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              {/* The card follows the theme, so this picks its own variant. */}
              <Logo height={40} />
            </div>
            <h2 style={{ fontSize: '26px', fontWeight: '700', color: d?TK.sunken:TK.ink, marginBottom: '6px' }}>Welcome back</h2>
            <p style={{ fontSize: '13px', color: d?TK.muted:TK.muted }}>Sign in to your Ezer account</p>
          </div>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: d?TK.line:TK.inkSoft, marginBottom: '6px' }}>Work Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="khushal@ezerhrms.com" style={{ width:'100%',padding:'11px 14px',border:`2px solid ${d?TK.inkSoft:TK.line}`,borderRadius:'10px',fontSize:'14px',outline:'none',background:d?TK.ink:TK.sunken,color:d?TK.sunken:TK.ink,boxSizing:'border-box' }} onFocus={e=>e.target.style.borderColor=TK.brand} onBlur={e=>e.target.style.borderColor=d?TK.inkSoft:TK.line}/>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: d?TK.line:TK.inkSoft, marginBottom: '6px' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPass?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={{ width:'100%',padding:'11px 44px 11px 14px',border:`2px solid ${d?TK.inkSoft:TK.line}`,borderRadius:'10px',fontSize:'14px',outline:'none',background:d?TK.ink:TK.sunken,color:d?TK.sunken:TK.ink,boxSizing:'border-box' }} onFocus={e=>e.target.style.borderColor=TK.brand} onBlur={e=>e.target.style.borderColor=d?TK.inkSoft:TK.line}/>
                <button type="button" onClick={()=>setShowPass(!showPass)} style={{ position:'absolute',right:'12px',top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:'16px' }}>{showPass?'':''}</button>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginBottom: '20px' }}><a href="#" style={{ fontSize:'13px',color:TK.brand,textDecoration:'none',fontWeight:'500' }}>Forgot password?</a></div>
            {error && <div style={{ background:d?'#2D1515':TK.criticalTint,border:`1px solid ${d?'#7F1D1D':'#FECACA'}`,borderRadius:'10px',padding:'10px 14px',fontSize:'13px',color:d?'#FCA5A5':TK.critical,marginBottom:'16px' }}>⚠️ {error}</div>}
            <button type="submit" disabled={loading} style={{ width:'100%',padding:'13px',background:loading?TK.brandTint:TK.brand,color:TK.onAccent,border:'none',borderRadius:'10px',fontSize:'15px',fontWeight:'600',cursor:loading?'not-allowed':'pointer' }}>{loading?'Signing in...':'Sign In →'}</button>
          </form>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0' }}>
            <div style={{ flex: 1, height: '1px', background: d?'#1F2937':TK.line }} />
            <span style={{ fontSize: '12px', color: d?'#4B5563':TK.faint }}>or</span>
            <div style={{ flex: 1, height: '1px', background: d?'#1F2937':TK.line }} />
          </div>
          <button style={{ width:'100%',padding:'12px',background:'transparent',border:`2px solid ${d?TK.inkSoft:TK.line}`,borderRadius:'10px',fontSize:'14px',fontWeight:'500',color:d?TK.line:TK.inkSoft,cursor:'pointer' }}>Contact your admin</button>
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <a href="/ess-login" style={{ fontSize:'13px',color:TK.brand,textDecoration:'none',fontWeight:'500' }}>Employee? Log in to ESS →</a>
          </div>
          <div style={{ textAlign: 'center', marginTop: '28px' }}>
            <div style={{ fontSize: '12px', color: d?'#4B5563':TK.faint, marginBottom: '4px' }}>Powered by <span style={{ color:TK.brand,fontWeight:'600' }}>ezerhrms.com</span></div>
            <div style={{ fontSize: '11px', color: d?TK.inkSoft:TK.lineStrong }}>SOC 2 · 🇮🇳 Data in India · ✦ DPDPA 2023</div>
          </div>
        </div>
      </div>
    </div>
  )
}