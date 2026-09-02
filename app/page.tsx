'use client'
import { useState, useEffect } from 'react'
import { Logo, LogoStyles } from '@/lib/ui/Logo'
import { ThemeToggle, getThemeChoice } from '@/lib/ui/ThemeToggle'
import { supabase } from '@/lib/supabase'

// ── Why this page carries its own palette ───────────────────────────────────
// The left panel is a deep gradient in EVERY theme, so its text can never come
// from the shared tokens: those resolve for the current theme, and on a
// permanently dark ground half of them are invisible. The previous version did
// exactly that — the tagline was TK.inkSoft (a dark grey meant for light
// surfaces) and the feature copy was TK.lineStrong (#D1D5DB, a BORDER colour
// used as body text). Measured, that tagline was 1.38:1. That is the whole
// reason the panel looked faded.
//
// So: explicit inks for the panel, tokens only where the surface follows the
// theme. Every value below is measured against the ground it sits on, and the
// gradient's LIGHT end (#1D4ED8) is the worst case, not the dark end.
const PANEL = {
  head:   '#FFFFFF',   // 6.70:1 on #1D4ED8
  body:   '#C7D6F0',   // 4.57:1
  faint:  '#CBD9F0',   // 4.70:1 — #93A9D0 was tried first and measured 2.82:1
  accent: '#7DD3FC',   // 4.02:1, used only for icons and large glyphs
  rule:   'rgba(125,211,252,.35)',
}

export default function LoginPage() {
  const [isDark, setIsDark] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Mirrors the APP's theme, not a private one ────────────────────────────
  // This page kept its own choice under 'ezer-theme' while the rest of the
  // product uses 'ezer_theme'. Picking dark here therefore did nothing to the
  // dashboard you landed in a second later. It now reads the real key, and the
  // control is the same component the app uses, so the choice survives sign-in.
  useEffect(() => {
    const resolve = () => {
      const c = getThemeChoice()
      setIsDark(c === 'dark' || (c === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
    }
    resolve()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', resolve)
    // The toggle writes the attribute on <html>; watching it keeps this page's
    // inline colours in step without the two of them sharing state.
    const obs = new MutationObserver(resolve)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ez-theme'] })
    return () => { mq.removeEventListener('change', resolve); obs.disconnect() }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }

    // Everyone lands in ESS, not the admin dashboard — including HR and payroll, who
    // now see the modules they hold inside their own portal. The dashboard is still
    // there behind the Admin button in the ESS sidebar.
    //
    // The one exception is a legacy dashboard login with no employee record behind it:
    // ESS needs an employee_id to render anything, so that account still goes to
    // /dashboard rather than to a portal that cannot load.
    const addr = email.trim().toLowerCase()
    const { data: emp } = await supabase
      .from('employees')
      .select('id, full_name, office_email, personal_email')
      .or(`office_email.ilike.${addr},personal_email.ilike.${addr}`)
      .limit(1)
      .maybeSingle()

    if (emp?.id) {
      // No token: EmployeePortal falls back to the Supabase session for API calls
      // (see essAuthHeaders / authToken), which this login has just established.
      try {
        localStorage.setItem('ezer_ess_session', JSON.stringify({
          employee_id: emp.id, name: emp.full_name, email: addr, token: null,
        }))
      } catch { /* private mode — the portal will ask them to sign in again */ }
      window.location.href = '/ess-portal'
      return
    }
    window.location.href = '/dashboard'
  }

  const d = isDark
  // The sign-in side follows the theme. Explicit rather than tokenised because
  // every pair here has been checked against its own ground.
  const S = {
    page:      d ? '#0B0E14' : '#EEF2F8',
    card:      d ? '#141922' : '#FFFFFF',
    edge:      d ? '#242C39' : '#DFE6F0',
    ink:       d ? '#F2F6FC' : '#0F1B2E',   // 16.25 / 17.26
    muted:     d ? '#9FB0C9' : '#5A6B85',   //  7.99 /  5.42
    faint:     d ? '#8FA0B8' : '#616F84',   //  6.62 /  5.10 — both below AA before
    field:     d ? '#0E131B' : '#F7F9FC',
    fieldEdge: d ? '#2B3543' : '#D5DEEA',
    brand:     '#2563EB',
    brandLift: d ? '#3B82F6' : '#1D4ED8',   //  4.79 /  6.70
  }

  const ezerItems = [
    { letter: 'E', title: 'Empower Employees',    desc: 'Self-service · ESS · Anytime, anywhere' },
    { letter: 'Z', title: 'Zero Compliance Risk', desc: 'EPF · ESIC · PT · Factory Act · Indian HR law' },
    { letter: 'E', title: 'Efficient Payroll',    desc: 'AI-assisted · Zero errors · Auto salary processing' },
    { letter: 'R', title: 'Retain Top Talent',    desc: 'Hire to retire · Engage · Recognise' },
  ]

  // These were empty strings — the icons rendered as nothing at all, which is
  // why the block read as floating text with a gap in front of it.
  const TRUST = [
    { text: 'SOC 2 Type 2 Compliant', icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 1.5 13.5 4v4c0 3.2-2.3 5.7-5.5 6.5C4.8 13.7 2.5 11.2 2.5 8V4L8 1.5Z"
              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="m5.8 8 1.6 1.6L10.4 6.6" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>) },
    { text: 'Data stored in India — Mumbai region', icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <ellipse cx="8" cy="4" rx="5.5" ry="2.3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 4v8c0 1.3 2.5 2.3 5.5 2.3s5.5-1 5.5-2.3V4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 8c0 1.3 2.5 2.3 5.5 2.3s5.5-1 5.5-2.3" stroke="currentColor" strokeWidth="1.5" />
      </svg>) },
    { text: 'DPDPA 2023 Compliant', icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>) },
  ]

  const field: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 11, fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    background: S.field, color: S.ink,
    border: `1.5px solid ${S.fieldEdge}`,
    transition: 'border-color .15s ease, box-shadow .15s ease',
  }
  const focusOn = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = S.brand
    e.target.style.boxShadow = `0 0 0 3px ${d ? 'rgba(37,99,235,.30)' : 'rgba(37,99,235,.16)'}`
  }
  const focusOff = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = S.fieldEdge
    e.target.style.boxShadow = 'none'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: S.page,
                  fontFamily: '"DM Sans","Segoe UI",sans-serif', transition: 'background .3s' }}>
      <LogoStyles />
      <style>{`
        @keyframes ez-in { from { opacity:0; transform: translateY(10px);} to { opacity:1; transform:none; } }
        .ez-in { animation: ez-in .5s cubic-bezier(.2,.8,.2,1) both; }
        .ez-cta { transition: transform .16s cubic-bezier(.2,.8,.2,1), filter .16s ease; }
        .ez-cta:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.07); }
        .ez-cta:active:not(:disabled) { transform: translateY(0) scale(.99); }
        .ez-ghost { transition: border-color .15s ease; }
        @media (prefers-reduced-motion: reduce) { .ez-in, .ez-cta, .ez-ghost { animation:none; transition:none; } }
        @media (max-width: 900px) { .ez-panel { display:none !important; } }
      `}</style>

      {/* ── Left: the brand panel. Dark in every theme, hence PANEL's own inks. */}
      <div className="ez-panel" style={{
        width: '46%', display: 'flex', flexDirection: 'column', padding: '44px 48px',
        position: 'relative', overflow: 'hidden',
        // Three stops rather than two. A flat two-stop navy is what made this
        // read as a dull block; the mid indigo gives the gradient somewhere to go.
        background: 'linear-gradient(150deg, #0A1633 0%, #14275C 45%, #1D4ED8 100%)',
      }}>
        {/* Depth: two radial washes and a masked hairline grid. Cheap to paint,
            and it stops the panel reading as one flat fill. */}
        <div aria-hidden style={{ position:'absolute', top:-160, right:-140, width:460, height:460,
          borderRadius:'50%', background:'radial-gradient(circle, rgba(125,211,252,.26), transparent 68%)' }} />
        <div aria-hidden style={{ position:'absolute', bottom:-180, left:-120, width:420, height:420,
          borderRadius:'50%', background:'radial-gradient(circle, rgba(37,99,235,.34), transparent 70%)' }} />
        <div aria-hidden style={{ position:'absolute', inset:0, opacity:.32,
          backgroundImage:'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)',
          backgroundSize:'46px 46px',
          maskImage:'radial-gradient(circle at 28% 30%, #000, transparent 76%)',
          WebkitMaskImage:'radial-gradient(circle at 28% 30%, #000, transparent 76%)' }} />

        <div className="ez-in" style={{ position:'relative', zIndex:1, marginBottom:44 }}>
          <Logo height={40} onDark tagline />
        </div>

        <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center',
                      position:'relative', zIndex:1 }}>
          <div style={{ height:1, background:`linear-gradient(90deg, ${PANEL.rule}, transparent)`, marginBottom:26 }} />

          <div style={{ display:'flex', flexDirection:'column', gap:18, marginBottom:26 }}>
            {ezerItems.map((item, i) => (
              <div key={i} className="ez-in" style={{ display:'flex', alignItems:'center', gap:16,
                                                      animationDelay:`${.06 * i + .1}s` }}>
                {/* The acrostic letter was solid amber, which fought the blue and
                    now also collides with the eye-comfort control. A tinted
                    plate with a cyan letter belongs to this panel instead. */}
                <div style={{ width:38, height:38, borderRadius:11, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background:'rgba(125,211,252,.14)', border:'1px solid rgba(125,211,252,.30)',
                  color:PANEL.accent, fontSize:19, fontWeight:800, lineHeight:1 }}>{item.letter}</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:PANEL.head, marginBottom:2 }}>{item.title}</div>
                  <div style={{ fontSize:12, color:PANEL.body, lineHeight:1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ height:1, background:`linear-gradient(90deg, ${PANEL.rule}, transparent)`, marginBottom:22 }} />

          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {TRUST.map((b, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:9, fontSize:12, color:PANEL.body }}>
                <span style={{ color:PANEL.accent, display:'flex', flexShrink:0 }}>{b.icon}</span>
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop:30, position:'relative', zIndex:1, display:'flex', alignItems:'center', gap:9 }}>
          <span aria-hidden style={{ width:8, height:8, borderRadius:'50%', background:'#34D399',
            boxShadow:'0 0 0 4px rgba(52,211,153,.22)' }} />
          <span style={{ fontSize:12, color:PANEL.faint }}>ezerhrms.com · All systems operational</span>
        </div>
      </div>

      {/* ── Right: the sign-in side. Follows the theme. */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', padding:48, background:S.page, position:'relative' }}>
        {/* The old control here was three buttons whose icon strings were all
            empty — literally nothing to see. This is the app's real toggle, so
            it is visible and colour-coded, and the choice now carries into the
            dashboard instead of going to a key nothing else reads. */}
        <div style={{ position:'absolute', top:24, right:24, zIndex:2 }}>
          <ThemeToggle />
        </div>

        <div className="ez-in" style={{ width:'100%', maxWidth:412 }}>
          <div style={{
            background:S.card, border:`1px solid ${S.edge}`, borderRadius:20, padding:'36px 34px',
            // A real card. In light mode the page sits on #EEF2F8 so the card has
            // something to lift off — it was white on white before.
            boxShadow: d ? '0 24px 60px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.40)'
                         : '0 20px 48px rgba(15,27,46,.10), 0 2px 6px rgba(15,27,46,.06)',
          }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:16 }}>
              <Logo height={34} />
            </div>
            <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.02em',
                         color:S.ink, margin:'0 0 5px', textAlign:'center' }}>Welcome back</h2>
            <p style={{ fontSize:13.5, color:S.muted, margin:'0 0 26px', textAlign:'center' }}>
              Sign in to your EZER account
            </p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom:15 }}>
                <label htmlFor="ez-email" style={{ display:'block', fontSize:12.5, fontWeight:600,
                  color:S.muted, marginBottom:6 }}>Work Email</label>
                <input id="ez-email" type="email" value={email} onChange={e=>setEmail(e.target.value)}
                  placeholder="you@ezerhrms.com" autoComplete="username"
                  style={field} onFocus={focusOn} onBlur={focusOff} />
              </div>

              <div style={{ marginBottom:9 }}>
                <label htmlFor="ez-pass" style={{ display:'block', fontSize:12.5, fontWeight:600,
                  color:S.muted, marginBottom:6 }}>Password</label>
                <div style={{ position:'relative' }}>
                  <input id="ez-pass" type={showPass?'text':'password'} value={password}
                    onChange={e=>setPassword(e.target.value)} placeholder="••••••••"
                    autoComplete="current-password"
                    style={{ ...field, padding:'12px 46px 12px 14px' }}
                    onFocus={focusOn} onBlur={focusOff} />
                  {/* Was an empty string in BOTH branches — an invisible button
                      that still swallowed the click. */}
                  <button type="button" onClick={()=>setShowPass(!showPass)}
                    title={showPass ? 'Hide password' : 'Show password'}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                      width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center',
                      background:'none', border:'none', cursor:'pointer', color:S.faint, padding:0 }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M1.7 10S4.6 4.8 10 4.8 18.3 10 18.3 10 15.4 15.2 10 15.2 1.7 10 1.7 10Z" />
                      <circle cx="10" cy="10" r="2.5" />
                      {!showPass && <path d="M3.5 16.5 16.5 3.5" />}
                    </svg>
                  </button>
                </div>
              </div>

              <div style={{ textAlign:'right', marginBottom:18 }}>
                <a href="#" style={{ fontSize:12.5, color:S.brandLift, textDecoration:'none', fontWeight:600 }}>
                  Forgot password?
                </a>
              </div>

              {error && (
                <div role="alert" style={{ background:d?'#2A1416':'#FEF2F2',
                  border:`1px solid ${d?'#7F1D1D':'#FECACA'}`, borderRadius:11, padding:'10px 13px',
                  fontSize:12.5, color:d?'#FCA5A5':'#B91C1C', marginBottom:15 }}>{error}</div>
              )}

              <button type="submit" disabled={loading} className="ez-cta" style={{
                width:'100%', padding:'13px', border:'none', borderRadius:11,
                fontSize:15, fontWeight:700, fontFamily:'inherit',
                cursor:loading?'not-allowed':'pointer', opacity:loading?.7:1,
                color:'#FFFFFF',
                background:'linear-gradient(135deg, #2563EB 0%, #1D4ED8 55%, #1E40AF 100%)',
                boxShadow:'0 8px 20px rgba(37,99,235,.34)',
              }}>{loading ? 'Signing in…' : 'Sign In  →'}</button>
            </form>

            <div style={{ display:'flex', alignItems:'center', gap:12, margin:'22px 0' }}>
              <div style={{ flex:1, height:1, background:S.edge }} />
              <span style={{ fontSize:11.5, color:S.faint }}>or</span>
              <div style={{ flex:1, height:1, background:S.edge }} />
            </div>

            <button className="ez-ghost" style={{ width:'100%', padding:'12px', background:'transparent',
              border:`1.5px solid ${S.fieldEdge}`, borderRadius:11, fontSize:14, fontWeight:600,
              color:S.ink, cursor:'pointer', fontFamily:'inherit' }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor = S.brand }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor = S.fieldEdge }}>
              Contact your admin
            </button>

            <div style={{ textAlign:'center', marginTop:15 }}>
              <a href="/ess-login" style={{ fontSize:13, color:S.brandLift, textDecoration:'none', fontWeight:600 }}>
                Employee? Log in to ESS →
              </a>
            </div>
          </div>

          <div style={{ textAlign:'center', marginTop:22 }}>
            <div style={{ fontSize:11.5, color:S.faint }}>
              Powered by <span style={{ color:S.brandLift, fontWeight:700 }}>ezerhrms.com</span>
              <span style={{ margin:'0 7px', opacity:.5 }}>·</span>SOC 2
              <span style={{ margin:'0 7px', opacity:.5 }}>·</span>Data in India
              <span style={{ margin:'0 7px', opacity:.5 }}>·</span>DPDPA 2023
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
