'use client'
import { useState, useMemo, useEffect } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'
import { linkStatementRows, type StmtRow } from '@/lib/recruitment/ctc-statement'

function fmt(n: number) { return Math.round(n).toLocaleString('en-IN') }
const pad2 = (n: number) => String(n).padStart(2, '0')

// ── TAX ENGINE ──────────────────────────────────────────────────
function calcTax(taxableIncome: number, regime: 'old' | 'new'): number {
  let tax = 0
  if (regime === 'new') {
    const slabs: [number, number][] = [[400000,0],[400000,0.05],[400000,0.10],[400000,0.15],[400000,0.20],[400000,0.25],[Infinity,0.30]]
    let rem = Math.max(0, taxableIncome)
    for (const [band, rate] of slabs) { const c = Math.min(rem, band); tax += c * rate; rem -= c; if (rem <= 0) break }
    if (taxableIncome <= 1200000) tax = Math.max(0, tax - Math.min(tax, 60000))
    if (taxableIncome > 1200000 && taxableIncome <= 1300000) tax = Math.min(tax, taxableIncome - 1200000)
  } else {
    let rem = Math.max(0, taxableIncome - 250000)
    const slabs: [number, number][] = [[250000,0.05],[500000,0.20],[Infinity,0.30]]
    for (const [band, rate] of slabs) { const c = Math.min(rem, band); tax += c * rate; rem -= c; if (rem <= 0) break }
    if (taxableIncome <= 500000) tax = Math.max(0, tax - 12500)
  }
  return Math.round(tax * 1.04) // 4% cess
}

// ── FLEXI DATA (from EZER Flexi Policy FY 2026-27) ──────────────
const FLEXI_COMPONENTS = [
  { code: 'PDA',     label: 'PDA (Professional Development)', regime: ['old'], perquisite: 0, taxable_without_bill: 3000 },
  { code: 'TELWIFI', label: 'Tel / WiFi', regime: ['old','new'], perquisite: 0, taxable_without_bill: 3000 },
  { code: 'DEVICE',  label: 'Device Leasing', regime: ['old','new'], perquisite: 0, taxable_without_bill: 0, note: 'EMI deducted from salary' },
  { code: 'LTA',     label: 'LTA (Leave Travel Allowance)', regime: ['old'], perquisite: 0, taxable_without_bill: 0, note: 'Annual, with EL + travel bills' },
  { code: 'CAR',     label: 'Car Lease', regime: ['old','new'], perquisite: 10000, paired: 'DRIVER', note: 'Always paired with Driver' },
  { code: 'DRIVER',  label: 'Driver Allowance', regime: ['old','new'], perquisite: 0, paired: 'CAR', note: 'Always paired with Car Lease' },
  { code: 'FUEL',    label: 'Fuel', regime: ['old','new'], perquisite: 0, taxable_without_bill: 3000 },
  { code: 'MEAL',    label: 'Meal Coupon', regime: ['old','new'], perquisite: 0, taxable_without_bill: 0, note: 'Via Zaggle card, fully exempt' },
  { code: 'ATTIRE',  label: 'Corporate Attire', regime: ['old'], perquisite: 0, taxable_without_bill: 3000 },
  { code: 'CHILD',   label: "Children's Education", regime: ['old'], perquisite: 0, taxable_without_bill: 0, note: 'Annual, FY end only' },
  { code: 'HOSTEL',  label: 'Hostel Allowance', regime: ['old'], perquisite: 0, taxable_without_bill: 0, note: 'Annual, FY end only' },
]

const LIMITS_OLD: Record<string, number[]> = {
  PDA:    [0,18000,24000,30000,36000,48000,54000,60000,60000],
  TELWIFI:[0,0,0,18000,18000,18000,18000,18000,18000],
  DEVICE: [0,0,50000,50000,90000,130000,150000,200000,200000],
  LTA:    [0,0,0,0,-1,-1,-1,-1,-1], // -1 = 8.33% of basic
  CAR:    [0,0,0,0,216000,300000,360000,420000,600000],
  DRIVER: [0,0,0,0,144000,192000,240000,240000,240000],
  FUEL:   [0,60000,96000,144000,144000,160000,192000,240000,300000],
  MEAL:   [0,55000,55000,55000,80000,96000,96000,96000,96000],
  ATTIRE: [0,40000,48000,60000,60000,78000,96000,96000,96000],
  CHILD:  [0,36000,36000,36000,36000,36000,36000,36000,36000],
  HOSTEL: [0,84000,84000,84000,84000,84000,84000,84000,84000],
}
const LIMITS_NEW: Record<string, number[]> = {
  TELWIFI:[0,0,0,18000,18000,18000,18000,18000,18000],
  DEVICE: [0,0,50000,50000,90000,130000,150000,200000,200000],
  CAR:    [0,0,0,0,216000,300000,360000,360000,360000],
  DRIVER: [0,0,0,0,144000,192000,240000,240000,240000],
  FUEL:   [0,0,96000,144000,144000,160000,192000,192000,192000],
  MEAL:   [0,0,55000,55000,80000,96000,96000,96000,96000],
}

const CTC_SLABS = [0,500000,800000,1200000,1800000,2500000,3000000,4000000,5000000,Infinity]
const SLAB_NAMES = ['—','≤5L','5–8L','8–12L','12–18L','18–25L','25–30L','30–40L','40–50L','50L+']

function getSlab(ctc: number): number {
  for (let i = CTC_SLABS.length - 2; i >= 0; i--) if (ctc >= CTC_SLABS[i]) return i
  return 0
}

type Meta = { company_name?: string; branch?: string; department?: string; designation?: string }
type Gate = { candidateName: string; companyName: string; maskedEmail: string | null; isStipend: boolean }
const ACCESS_HEADER = 'x-salary-access'
const accessKey = (token: string) => `salary-access:${token}`

// ── ENTRY: OTP login first, then the offer ─────────────────────────
// The server page passes only the token and what the login card shows. The offer itself is
// fetched from /api/salary-view/data once the candidate has verified the OTP sent to their
// registered email. The access token is kept in sessionStorage so a refresh doesn't re-ask.
export default function SalaryViewClient({ token, gate }: { token: string; gate: Gate }) {
  const [access, setAccess] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ data: any; meta: Meta } | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [checked, setChecked] = useState(false)

  useEffect(() => { try { const a = sessionStorage.getItem(accessKey(token)); if (a) setAccess(a) } catch { /* ignore */ } setChecked(true) }, [token])
  useEffect(() => {
    if (!access) return
    let alive = true
    fetch(`/api/salary-view/data?token=${encodeURIComponent(token)}`, { headers: { [ACCESS_HEADER]: access }, cache: 'no-store' })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!alive) return; if (!r.ok) { try { sessionStorage.removeItem(accessKey(token)) } catch {} setAccess(null); setLoadErr(r.status === 401 ? '' : (j.error || 'Could not load your offer')); return } setLoaded({ data: j.data, meta: j.meta }) })
      .catch(() => { if (alive) setLoadErr('Could not load your offer — please try again') })
    return () => { alive = false }
  }, [access, token])

  if (!checked) return <div style={{ minHeight:'100vh', background:TK.canvas }} />
  if (!access) return <OtpGate token={token} gate={gate} error={loadErr} onVerified={a => { try { sessionStorage.setItem(accessKey(token), a) } catch {} setLoadErr(''); setAccess(a) }} />
  if (!loaded) return (
    <div style={{ minHeight:'100vh', background:TK.canvas, display:'grid', placeItems:'center', fontFamily:'"DM Sans","Segoe UI",sans-serif', color:TK.faint, fontSize:13 }}>{loadErr || 'Opening your offer…'}</div>
  )
  return <SalaryViewBody data={loaded.data} meta={loaded.meta} token={token} access={access} />
}

// ── OTP LOGIN CARD ─────────────────────────────────────────────────
function OtpGate({ token, gate, error, onVerified }: { token: string; gate: Gate; error?: string; onVerified: (access: string) => void }) {
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error || '')
  const [info, setInfo] = useState('')
  const [sentTo, setSentTo] = useState(gate.maskedEmail || '')
  const [debugOtp, setDebugOtp] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => { if (cooldown <= 0) return; const id = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(id) }, [cooldown])

  async function post(body: any) {
    const r = await fetch('/api/salary-view/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Something went wrong')
    return j
  }
  async function sendOtp() {
    setBusy(true); setErr(''); setInfo('')
    try {
      const j = await post({ action: 'request' })
      setSentTo(j.sentTo || sentTo); setDebugOtp(j.debugOtp || null); setStep('otp'); setOtp(''); setCooldown(30)
      setInfo(j.sent ? `We emailed a 6-digit code to ${j.sentTo}. It is valid for ${j.ttlMin || 10} minutes.` : `Email could not be sent right now${j.debugOtp ? ' (test mode)' : ' — please try again in a minute'}.`)
    } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }
  async function verify() {
    if (!/^\d{6}$/.test(otp)) { setErr('Enter the 6-digit code from your email.'); return }
    setBusy(true); setErr('')
    try { const j = await post({ action: 'verify', otp }); onVerified(j.access) }
    catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  const font = '"DM Sans","Segoe UI",sans-serif'
  const inp: React.CSSProperties = { width:'100%', padding:'11px 12px', border:`1px solid ${TK.brandEdge}`, borderRadius:8, fontSize:15, fontFamily:font, color:TK.ink, background:TK.surface, outline:'none', boxSizing:'border-box' }
  const btn = (bg: string, dis?: boolean): React.CSSProperties => ({ width:'100%', padding:'11px 14px', borderRadius:8, border:'none', background:bg, color:TK.onAccent, fontSize:14, fontWeight:600, fontFamily:font, cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? .6 : 1 })
  return (
    <div style={{ minHeight:'100vh', background:TK.canvas, display:'flex', alignItems:'center', justifyContent:'center', padding:16, fontFamily:font, color:TK.ink }}>
      <div style={{ width:'min(420px, 100%)', background:TK.surface, borderRadius:16, border:`1px solid ${TK.brandEdge}`, boxShadow:'0 12px 40px rgba(124,58,237,0.10)', padding:'24px 22px' }}>
        <div style={{ fontSize:11, color:TK.brandDeep, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em' }}>{gate.companyName || 'Your offer'}</div>
        <div style={{ fontSize:20, fontWeight:700, marginTop:4 }}>{gate.isStipend ? 'Your stipend offer' : 'Your salary offer'}{gate.candidateName ? ` — ${gate.candidateName.split(' ')[0]}` : ''}</div>
        <div style={{ fontSize:12.5, color:TK.inkSoft, marginTop:6, lineHeight:1.55 }}>To keep your offer private, please verify it is you. We will send a one-time code to your registered email.</div>

        {!gate.maskedEmail ? (
          <div style={{ marginTop:18, padding:'12px 14px', borderRadius:10, background:TK.criticalTint, color:TK.critical, fontSize:12.5, lineHeight:1.5 }}>No email is registered for this offer. Please contact your recruiter so they can update your details and resend the link.</div>
        ) : step === 'email' ? (
          <>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:TK.brandDeep, textTransform:'uppercase', letterSpacing:'.06em', marginTop:18, marginBottom:5 }}>Registered email</label>
            <input value={gate.maskedEmail} readOnly style={{ ...inp, background:TK.sunken, color:TK.inkSoft, letterSpacing:.5 }} />
            <div style={{ fontSize:11, color:TK.faint, marginTop:5 }}>This is the email your recruiter has on record. Not yours? Contact your recruiter.</div>
            {err && <div style={{ marginTop:12, padding:'9px 12px', borderRadius:8, background:TK.criticalTint, color:TK.critical, fontSize:12.5, fontWeight:600 }}>{err}</div>}
            <button onClick={sendOtp} disabled={busy} style={{ ...btn(TK.brand, busy), marginTop:16 }}>{busy ? 'Sending…' : 'Send OTP'}</button>
          </>
        ) : (
          <>
            <div style={{ marginTop:16, padding:'10px 12px', borderRadius:8, background:TK.brandTint, color:TK.brandDeep, fontSize:12.5, lineHeight:1.5 }}>{info}</div>
            {debugOtp && <div style={{ marginTop:8, fontSize:11, color:TK.warning }}>Test mode code: <b>{debugOtp}</b></div>}
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:TK.brandDeep, textTransform:'uppercase', letterSpacing:'.06em', marginTop:14, marginBottom:5 }}>Enter the 6-digit code</label>
            <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter') verify() }}
              inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" autoFocus
              style={{ ...inp, fontSize:24, fontWeight:700, letterSpacing:10, textAlign:'center' }} />
            {err && <div style={{ marginTop:12, padding:'9px 12px', borderRadius:8, background:TK.criticalTint, color:TK.critical, fontSize:12.5, fontWeight:600 }}>{err}</div>}
            <button onClick={verify} disabled={busy || otp.length !== 6} style={{ ...btn(TK.positive, busy || otp.length !== 6), marginTop:14 }}>{busy ? 'Verifying…' : 'Verify & open offer'}</button>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12, fontSize:12 }}>
              <button onClick={() => { setStep('email'); setErr('') }} style={{ background:'none', border:'none', color:TK.inkSoft, cursor:'pointer', fontFamily:font, fontSize:12, padding:0 }}>← Back</button>
              <button onClick={sendOtp} disabled={busy || cooldown > 0} style={{ background:'none', border:'none', color: cooldown > 0 ? TK.faint : TK.brandDeep, cursor: cooldown > 0 ? 'default' : 'pointer', fontFamily:font, fontSize:12, fontWeight:600, padding:0 }}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</button>
            </div>
          </>
        )}
        <div style={{ fontSize:10.5, color:TK.faint, marginTop:18, lineHeight:1.5, borderTop:`1px solid ${TK.brandEdge}`, paddingTop:10 }}>Sent to {sentTo || 'your registered email'}. The code expires in 10 minutes and works once.</div>
      </div>
    </div>
  )
}

// ── SALARY STATEMENT CARD — the same rows the recruiter sees, monthly + annual ──
function StatementCard({ rows, hikePct }: { rows: StmtRow[]; hikePct?: number | null }) {
  const money = (n?: number | null) => n == null ? '' : `₹${fmt(n)}`
  const tone: Record<string, { bg?: string; color?: string; weight?: number; labelColor?: string }> = {
    row:   {},
    sum:   { bg: TK.brandTint, color: TK.brandDeep, weight: 700 },
    emp:   { color: TK.brandDeep },
    grat:  { color: TK.positive },
    bonus: { color: TK.info },
    muted: { color: TK.faint, labelColor: TK.faint },
    total: { bg: TK.brand, color: TK.onAccent, weight: 700, labelColor: TK.onAccent },
    ded:   { color: TK.critical, labelColor: TK.critical },
    net:   { bg: TK.positive, color: TK.onAccent, weight: 700, labelColor: TK.onAccent },
  }
  const grid: React.CSSProperties = { display:'grid', gridTemplateColumns:'minmax(0,1fr) 92px 104px', gap:6, alignItems:'center' }
  return (
    <div style={{ background:TK.surface, borderRadius:14, border:`1px solid ${TK.brandEdge}`, overflow:'hidden', marginBottom:14, boxShadow:'0 6px 22px rgba(30,27,75,0.06)' }}>
      <div style={{ background:TK.brand, padding:'12px 16px', color:TK.onAccent, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' as const }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700 }}>Salary Breakdown Statement</div>
          <div style={{ fontSize:10.5, opacity:.8, marginTop:1 }}>Every component, monthly and annual</div>
        </div>
        {hikePct ? <span style={{ fontSize:11, fontWeight:700, background:'rgba(255,255,255,0.2)', padding:'4px 11px', borderRadius:99 }}>Hike {Number(hikePct).toFixed(1)}%</span> : null}
      </div>
      <div style={{ ...grid, padding:'7px 16px', background:TK.sunken, borderBottom:`1px solid ${TK.brandEdge}`, fontSize:9.5, fontWeight:700, color:TK.faint, textTransform:'uppercase' as const, letterSpacing:'.07em' }}>
        <span>Component</span><span style={{ textAlign:'right' as const }}>Monthly (₹)</span><span style={{ textAlign:'right' as const }}>Annual (₹)</span>
      </div>
      {rows.map((r, i) => {
        if (r.kind === 'head') return <div key={i} style={{ padding:'14px 16px 5px', fontSize:10.5, fontWeight:700, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' }}>{r.label}</div>
        if (r.kind === 'note') return <div key={i} style={{ padding:'8px 16px', fontSize:10.5, color:TK.faint, lineHeight:1.5, background:TK.sunken }}>{r.label}</div>
        const t = tone[r.kind] || {}
        const big = r.kind === 'total' || r.kind === 'net'
        const nil = (r.monthly || 0) === 0 && (r.kind === 'emp' || r.kind === 'ded')
        return (
          <div key={i} style={{ ...grid, padding: big ? '11px 16px' : '8px 16px', background: t.bg || 'transparent', borderBottom: t.bg ? 'none' : `1px solid ${TK.brandEdge}`, fontSize: big ? 14 : 12.5, opacity: nil ? .7 : 1 }}>
            <span style={{ minWidth:0, color: t.labelColor || (t.weight ? (t.color || TK.ink) : TK.ink), fontWeight: t.weight || 500 }}>
              {r.label}
              {r.basis && <div style={{ fontSize:10, fontWeight:400, color: t.bg ? 'inherit' : TK.faint, opacity: t.bg ? .8 : 1, marginTop:1, lineHeight:1.35 }}>{r.basis}</div>}
            </span>
            <span style={{ textAlign:'right' as const, whiteSpace:'nowrap' as const, color: t.color || TK.ink, fontWeight: t.weight || 500, fontVariantNumeric:'tabular-nums' as const }}>{nil ? 'Nil' : money(r.monthly)}</span>
            <span style={{ textAlign:'right' as const, whiteSpace:'nowrap' as const, color: t.color || TK.ink, fontWeight: t.weight ? 800 : 600, fontVariantNumeric:'tabular-nums' as const }}>{nil ? 'Nil' : money(r.annual)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── THE OFFER (after login) ────────────────────────────────────────
function SalaryViewBody({ data, meta, token, access }: { data: any; meta?: Meta; token: string; access: string }) {
  const [response, setResponse] = useState<string>(data.candidate_response || '')
  const [responding, setResponding] = useState(false)
  // ── 7-day validity — the offer link expires 7 days after it was (re)sent ──
  // Clock starts at link_sent_at (stamped on every save, so a revised offer restarts it),
  // falling back to created_at for older rows. Countdown renders only after mount so the
  // server-rendered text never disagrees with the client's clock.
  const OFFER_VALID_DAYS = 7
  const linkStartMs = new Date(data.link_sent_at || data.created_at || Date.now()).getTime()
  const expiresAtMs = linkStartMs + OFFER_VALID_DAYS * 86400000
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => { setNowMs(Date.now()); const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id) }, [])
  const mounted = nowMs !== null
  const remainingMs = mounted ? Math.max(0, expiresAtMs - (nowMs as number)) : OFFER_VALID_DAYS * 86400000
  const offerExpired = mounted && expiresAtMs - (nowMs as number) <= 0
  const remDays = Math.floor(remainingMs / 86400000), remHrs = Math.floor((remainingMs % 86400000) / 3600000), remMins = Math.floor((remainingMs % 3600000) / 60000), remSecs = Math.floor((remainingMs % 60000) / 1000)
  const validityPct = Math.max(0, Math.min(100, (remainingMs / (OFFER_VALID_DAYS * 86400000)) * 100))
  const validityUrgent = mounted && !offerExpired && remainingMs < 86400000
  const expiresAtLabel = new Date(expiresAtMs).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  async function respond(r: 'ACCEPTED' | 'REJECTED') {
    if (r === 'ACCEPTED' && offerExpired) return   // window closed — the button is hidden, this is the backstop
    let note = ''
    if (r === 'REJECTED') { const n = window.prompt('Optionally, let us know why you are declining:'); if (n === null) return; note = n }
    else if (!window.confirm('Confirm you accept this offer?')) return
    setResponding(true)
    let err = ''
    try {
      const res = await fetch('/api/salary-view/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', [ACCESS_HEADER]: access }, body: JSON.stringify({ token, response: r, note: note || null }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) err = j.error || 'request failed'
    } catch { err = 'network error' }
    setResponding(false)
    if (err) { alert('Sorry, we could not record your response: ' + err); return }
    setResponse(r)
  }
  const [showCalc, setShowCalc] = useState(false)
  const [regime, setRegime] = useState<'old'|'new'>('new')
  const [dec80C, setDec80C] = useState(150000)
  const [dec80D, setDec80D] = useState(25000)
  const [decHomeLoan, setDecHomeLoan] = useState(0)
  const [decNPS, setDecNPS] = useState(0)
  const [selectedFBP, setSelectedFBP] = useState<Set<string>>(new Set())

  // Base salary values from DB
  const calc = data.calculation_data || {}
  // The candidate's statement: EPF / ESIC on Basic, no PT / LWF / gratuity / bonus lines.
  const link = linkStatementRows(calc, data.offered_ctc)
  const stmtRows: StmtRow[] | null = link ? link.rows : null
  const basic = Math.round(calc.basic ?? data.basic_monthly ?? 0)
  const hra = Math.round(calc.hra ?? data.hra_monthly ?? 0)
  const grossMonthly = Math.round(link ? link.gross : (calc.gross || 0))
  const epfEmp = Math.round(link ? link.epfEmployee : (calc.epfEmployee ?? calc.epfEmp ?? data.epf_monthly ?? 0))
  const esicEmp = Math.round(link ? link.esicEmployee : (calc.esicEmployee ?? calc.esicEmp ?? 0))
  // Hike is shown only when it is believable; a −100% from a corrupt current CTC is hidden.
  const hikeRaw = data.hike_pct == null ? null : Number(data.hike_pct)
  const hikeShown = hikeRaw != null && isFinite(hikeRaw) && hikeRaw > -90 && hikeRaw < 1000 ? hikeRaw : null
  const ptMonthly = Math.round(calc.ptMonthly || 0)
  const inHand = Math.round(link ? link.inHand : (calc.inHand ?? data.net_monthly ?? 0))
  const otherAllow = Math.round(calc.otherAllow || 0)
  // Conveyance + Special Allowance are the salary slip's own heads; fall back to
  // splitting the old flat "otherAllow" for negotiations saved before this existed.
  const conveyance = Math.round(calc.conveyance != null ? calc.conveyance : Math.min(otherAllow, 1600))
  const specialAllow = Math.round(link ? link.special : (calc.specialAllow != null ? calc.specialAllow : Math.max(0, otherAllow - conveyance)))
  // FBP can only be carved out of the Special Allowance — that balance (annual) caps what can be opted.
  const fbpBalance = specialAllow * 12
  const lwfMonthly = Math.round(calc.lwfMonthly || 0)
  const statBonus = Math.round(calc.statBonus || 0)
  const totalDed = epfEmp + esicEmp + ptMonthly + lwfMonthly
  const ctcAnnual = Math.round(data.offered_ctc || 0)
  const varAnnual = Math.round(calc.variableAnnual ?? calc.variable ?? 0)
  const fixedAnnual = ctcAnnual - varAnnual
  const grossAnnual = grossMonthly * 12
  const joiningBonus = data.joining_bonus || 0
  const retentionBonus = data.retention_bonus || 0
  const esopValue = data.esop_value || 0
  // Employer-side components that sit INSIDE the CTC (Automated CTC model)
  const epfEmployer = Math.round(calc.epfEmployer || 0)
  const esicEmployer = Math.round(calc.esicEmployer || 0)
  const gratuityMonthly = Math.round(calc.gratuityMonthly || 0)
  const bonusOverheadMonthly = Math.round(calc.bonusOverheadMonthly || 0)
  const gratuityIncluded = calc.gratuity === 'yes'
  const gratuityExcluded = calc.gratuity === 'no'
  const minWage = Math.round(calc.minWage || 0)
  // Basis shown to the candidate (only for offers saved with the Automated CTC model)
  const hasAutoModel = calc.epfEmployer != null && calc.minWage != null
  const bonusPctVal = Number(calc.bonusPct ?? 0)
  const bonusModeVal: string = calc.bonusMode || ''
  const bonusLabel = bonusPctVal > 0 ? `${bonusPctVal}% · ${bonusModeVal === 'ctc' ? 'Only in CTC (statutory overhead)' : 'With Salary (paid in gross)'}` : 'Not applicable'
  const fixedCtcMonthly = Math.round((calc.fixedAnnual ?? fixedAnnual) / 12)
  const chipStyle: React.CSSProperties = { fontSize:10.5, fontWeight:700, padding:'3px 9px', borderRadius:99, background:'rgba(255,255,255,0.18)', color:TK.onAccent }
  const slab = getSlab(ctcAnnual)
  const ltaAmt = Math.round(basic * 12 * 0.0833)

  // ── Stipend (intern / NATS / NAPS) — the link shows ONLY what was entered ──
  const isStipend = !!(calc.is_stipend || data.is_stipend)
  const stipendMonthly = Math.round(calc.stipend_monthly || data.stipend_monthly || 0)
  const tdsApplicable = !!(calc.tds_applicable ?? data.tds_applicable)
  const tdsPct = Number(calc.tds_pct ?? data.tds_pct ?? 0)
  const stipendTdsAmt = Math.round(calc.tds_amount || (stipendMonthly * tdsPct / 100) || 0)
  const stipendNet = Math.round(data.net_monthly || calc.net_monthly || (stipendMonthly - stipendTdsAmt))
  const addAmount = Math.round(calc.additional_amount || 0)
  const addFreq = calc.additional_freq || 'One-time'
  const remarkText = calc.remark || ''
  // 'Stipend' for interns/NATS/NAPS, 'Fees' for consultants/contractors.
  const payLabel = calc.pay_label || 'Stipend'
  const designation = meta?.designation || data.position_title || ''
  const termsText: string = calc.terms_conditions || ''
  const additionalItems: { amount:number; freq:string; remark?:string }[] = Array.isArray(calc.additional_items) ? calc.additional_items.filter((r:any)=>Number(r.amount)>0) : []

  // Available FBP components for current slab+regime
  const availableFBP = useMemo(() => {
    const limMap = regime === 'old' ? LIMITS_OLD : LIMITS_NEW
    return FLEXI_COMPONENTS
      .filter(c => c.regime.includes(regime))
      .map(c => {
        const limits = limMap[c.code]
        const limit = limits ? (limits[slab] === -1 ? ltaAmt : limits[slab]) : 0
        return { ...c, limit }
      })
      .filter(c => c.limit > 0)
  }, [regime, slab, ltaAmt])

  // Selected FBP total + perquisite
  const fbpSummary = useMemo(() => {
    let totalNonTaxable = 0, perquisiteAnnual = 0
    let hasCarDriver = selectedFBP.has('CAR') || selectedFBP.has('DRIVER')
    availableFBP.forEach(c => {
      if (selectedFBP.has(c.code)) {
        totalNonTaxable += c.limit
        if (c.code === 'CAR') perquisiteAnnual = 120000 // ₹10K/mo car+driver combined
      }
    })
    // Net non-taxable = FBP selected - perquisite added back
    const netNonTaxable = totalNonTaxable - perquisiteAnnual
    return { totalNonTaxable, perquisiteAnnual, netNonTaxable, hasCarDriver }
  }, [selectedFBP, availableFBP])

  // TDS with and without FBP
  const tdsCalc = useMemo(() => {
    const stdDed = regime === 'new' ? 75000 : 50000
    const epfAnnual = epfEmp * 12
    const oldDec = regime === 'old' ? Math.min(dec80C,150000) + Math.min(dec80D,100000) + Math.min(decHomeLoan,200000) + Math.min(decNPS,50000) + epfAnnual : 0
    // Without FBP
    const taxableNoFBP = Math.max(0, grossAnnual - stdDed - oldDec)
    const taxNoFBP = calcTax(taxableNoFBP, regime)
    // With FBP (reduce taxable income by net non-taxable FBP)
    const taxableWithFBP = Math.max(0, grossAnnual - stdDed - oldDec - fbpSummary.netNonTaxable)
    const taxWithFBP = calcTax(taxableWithFBP, regime)
    const fbpSaving = taxNoFBP - taxWithFBP
    return { taxableNoFBP, taxNoFBP, taxableWithFBP, taxWithFBP, fbpSaving }
  }, [regime, dec80C, dec80D, decHomeLoan, decNPS, grossAnnual, epfEmp, fbpSummary])

  const fbpRemaining = Math.max(0, fbpBalance - fbpSummary.totalNonTaxable)
  const fbpCostOf = (code: string, paired?: string) => {
    const own = availableFBP.find(c => c.code === code)?.limit || 0
    const pair = paired ? (availableFBP.find(c => c.code === paired)?.limit || 0) : 0
    return own + pair
  }
  const [fbpMsg, setFbpMsg] = useState('')
  function toggleFBP(code: string, paired?: string) {
    const next = new Set(selectedFBP)
    if (next.has(code)) {
      next.delete(code)
      if (paired) next.delete(paired) // Car+Driver always together
      setFbpMsg('')
    } else {
      const cost = fbpCostOf(code, paired)
      if (cost > fbpRemaining) { setFbpMsg(`Not enough Special Allowance left: this needs ₹${fmt(cost)}/yr, only ₹${fmt(fbpRemaining)}/yr remains.`); return }
      next.add(code)
      if (paired) next.add(paired)
      setFbpMsg('')
    }
    setSelectedFBP(next)
  }

  const S = {
    page: { background:TK.canvas, minHeight:'100vh', fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
    card: { background:TK.surface, borderRadius:10, border:'1px solid var(--ez-line)', overflow:'hidden', marginBottom:14 } as React.CSSProperties,
    label: { fontSize:10, fontWeight:600 as const, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' } as React.CSSProperties,
    inp: { padding:'7px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius:7, color:TK.ink, fontSize:12, outline:'none', background:TK.sunken, width:'100%', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
    sec: (margin?: string) => ({ fontSize:10, fontWeight:600 as const, color:TK.brand, textTransform:'uppercase' as const, letterSpacing:'.06em', margin:margin||'12px 0 8px', display:'flex', alignItems:'center', gap:8 }) as React.CSSProperties,
  }

  const Basis = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
    <div style={{ background:TK.sunken, borderRadius:8, padding:'8px 11px', minWidth:0 }}>
      <div style={{ fontSize:9.5, fontWeight:700, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' }}>{k}</div>
      <div style={{ fontSize:12.5, fontWeight:600, color:TK.ink, marginTop:2, lineHeight:1.35 }}>{v}</div>
      {sub && <div style={{ fontSize:10, color:TK.faint, marginTop:1 }}>{sub}</div>}
    </div>
  )
  const Row = ({ l, v, red, bold, green }: { l: string; v: string; red?: boolean; bold?: boolean; green?: boolean }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 16px', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13 }}>
      <span style={{ color: red ? TK.critical : TK.inkSoft }}>{l}</span>
      <span style={{ fontWeight: bold ? 600 : 500, color: red ? TK.critical : green ? TK.positive : TK.ink }}>{v}</span>
    </div>
  )

  // Three-column row for the breakdown table: label · monthly · annual.
  const R2 = ({ l, m, a, red, green, bold, big, bg, sub }: { l: string; m: string; a: string; red?: boolean; green?: boolean; bold?: boolean; big?: boolean; bg?: string; sub?: string }) => (
    <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 96px 110px', gap:6, alignItems:'center', padding: big ? '10px 16px' : '7px 16px', borderBottom:`1px solid ${TK.brandEdge}`, fontSize: big ? 14 : 12.5, background: bg || 'transparent' }}>
      <span style={{ color: red ? TK.critical : green ? TK.positive : (bold || big) ? TK.brandDeep : TK.inkSoft, fontWeight: (bold || big) ? 600 : 400, minWidth:0 }}>
        {l}{sub && <div style={{ fontSize:10, fontWeight:400, color:TK.faint, marginTop:1 }}>{sub}</div>}
      </span>
      <span style={{ textAlign:'right' as const, color: red ? TK.critical : green ? TK.positive : TK.ink, fontWeight:500, whiteSpace:'nowrap' as const }}>{m}</span>
      <span style={{ textAlign:'right' as const, color: red ? TK.critical : green ? TK.positive : TK.ink, fontWeight: (bold || big) ? 700 : 500, whiteSpace:'nowrap' as const }}>{a}</span>
    </div>
  )
  const rsm = (monthly: number) => `₹${fmt(monthly)}`
  const rsa = (monthly: number) => `₹${fmt(monthly*12)}`

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, padding:'20px 20px 18px', color:TK.onAccent }}>
        <div style={{ maxWidth:680, margin:'0 auto' }}>
          <div style={{ fontSize:19, fontWeight:800, color:TK.onAccent, letterSpacing:'.02em', lineHeight:1.15 }}>{meta?.company_name || data.company_name || 'EZER HRMS'}</div>
          {(meta?.branch || meta?.department) && (
            <div style={{ fontSize:11.5, color:TK.onAccentDim, marginTop:3 }}>{[meta?.branch, meta?.department].filter(Boolean).join(' · ')}</div>
          )}
          <div style={{ height:1, background:'rgba(255,255,255,0.22)', margin:'12px 0 10px' }} />
          <div style={{ fontSize:22, fontWeight:700, letterSpacing:-.2 }}>{isStipend ? `Your ${payLabel} Details` : 'Your Salary Structure'}</div>
          {data.candidate_name && <div style={{ fontSize:13.5, color:TK.onAccentSoft, marginTop:4 }}>Dear {data.candidate_name}, here is the complete break-up of your offer.</div>}
          {(designation || meta?.branch || meta?.department) && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const, marginTop:10 }}>
              {designation && <span style={{ ...chipStyle, background:'rgba(255,255,255,0.92)', color:TK.brandDeep }}>{designation}</span>}
              {meta?.department && <span style={chipStyle}>{meta.department}</span>}
              {meta?.branch && <span style={chipStyle}>{meta.branch}</span>}
            </div>
          )}
          {!isStipend && hasAutoModel && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const, marginTop:10 }}>
              <span style={chipStyle}>✓ Statutory Minimum Wage</span>
              <span style={chipStyle}>✓ EPFO Compliant</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth:680, margin:'0 auto', padding:'16px' }}>

        {/* Offer validity — 7 days from when the link was sent; Accept disappears after */}
        <div style={{ background: offerExpired ? TK.criticalTint : validityUrgent ? TK.warningTint : TK.surface, border: `1px solid ${offerExpired ? TK.criticalEdge : validityUrgent ? TK.warningEdge : TK.brandEdge}`, borderRadius:14, padding:'12px 16px', marginBottom:14, boxShadow:'0 4px 14px rgba(30,27,75,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' as const }}>
            <div style={{ fontSize:22 }}>{offerExpired ? '⌛' : validityUrgent ? '⏰' : '🗓️'}</div>
            <div style={{ flex:1, minWidth:180 }}>
              <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' as const, color: offerExpired ? TK.critical : validityUrgent ? TK.warning : TK.muted }}>
                {offerExpired ? 'Offer link expired' : `Offer valid for ${OFFER_VALID_DAYS} days`}
              </div>
              <div style={{ fontSize:18, fontWeight:800, fontVariantNumeric:'tabular-nums' as const, color: offerExpired ? TK.critical : validityUrgent ? TK.warning : TK.ink, marginTop:2 }}>
                {!mounted ? '—' : offerExpired ? `Expired on ${expiresAtLabel}` : `${remDays}d ${pad2(remHrs)}h ${pad2(remMins)}m ${pad2(remSecs)}s left`}
              </div>
            </div>
            <div style={{ fontSize:11, color:TK.faint, textAlign:'right' as const }}>
              {offerExpired ? 'Please contact your recruiter' : <>Valid till<br /><b style={{ color:TK.inkSoft }}>{expiresAtLabel}</b></>}
            </div>
          </div>
          <div style={{ height:6, background:TK.line, borderRadius:99, overflow:'hidden', marginTop:10 }}>
            <div style={{ width:`${mounted ? validityPct : 100}%`, height:'100%', background: offerExpired ? TK.critical : validityUrgent ? TK.warning : TK.brand, borderRadius:99, transition:'width .5s' }} />
          </div>
        </div>

        {/* Salary Breakdown — the first thing the candidate sees. Built from the SAME statement
            rows as the recruiter's Salary Breakdown Statement (lib/recruitment/ctc-statement),
            so every figure here matches the calculator to the rupee. */}
        {!isStipend && stmtRows && (
          <StatementCard rows={stmtRows} hikePct={hikeShown} />
        )}
        {!isStipend && !stmtRows && (
          <div style={{ ...S.card, border:`2px solid ${TK.brandEdge}` }}>
            <div style={{ background:TK.brand, padding:'10px 16px', color:TK.onAccent, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' as const }}>
              <span style={{ fontSize:13, fontWeight:600 }}>Salary Breakdown</span>
              {hikeShown != null ? <span style={{ fontSize:11, fontWeight:600, background:'rgba(255,255,255,0.2)', padding:'3px 10px', borderRadius:99 }}>Hike: {hikeShown.toFixed(1)}%</span> : null}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 96px 110px', gap:6, padding:'7px 16px', background:TK.brandTint, borderBottom:`1px solid ${TK.brandEdge}`, fontSize:10, fontWeight:700, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' }}>
              <span>Component</span><span style={{ textAlign:'right' as const }}>Monthly (₹)</span><span style={{ textAlign:'right' as const }}>Annual (₹)</span>
            </div>
            <R2 l="Basic" m={rsm(basic)} a={rsa(basic)} />
            <R2 l="HRA" m={rsm(hra)} a={rsa(hra)} />
            {conveyance > 0 && <R2 l="Conveyance" m={rsm(conveyance)} a={rsa(conveyance)} />}
            {specialAllow > 0 && <R2 l="Special Allowance" m={rsm(specialAllow)} a={rsa(specialAllow)} />}
            {statBonus > 0 && <R2 l={`Statutory Bonus${bonusPctVal > 0 ? ` (${bonusPctVal}% · with salary)` : ''}`} m={rsm(statBonus)} a={rsa(statBonus)} />}
            <R2 l="Gross Earnings" m={rsm(grossMonthly)} a={rsa(grossMonthly)} bold bg={TK.brandTint} />
            {epfEmp > 0 && <R2 l="(−) EPF Employee" m={rsm(epfEmp)} a={rsa(epfEmp)} red />}
            {esicEmp > 0 && <R2 l="(−) ESIC Employee" m={rsm(esicEmp)} a={rsa(esicEmp)} red bg={TK.criticalTint} sub={`Gross/mo ₹${fmt(grossMonthly)} ≤ ₹21,000 → 0.75%`} />}
            {ptMonthly > 0 && <R2 l="(−) Professional Tax" m={rsm(ptMonthly)} a={rsa(ptMonthly)} red />}
            {lwfMonthly > 0 && <R2 l="(−) LWF" m={rsm(lwfMonthly)} a={rsa(lwfMonthly)} red />}
            <R2 l="Total Deductions" m={rsm(totalDed)} a={rsa(totalDed)} red bold bg={TK.criticalTint} />
            <R2 l="In Hand" m={rsm(inHand)} a={rsa(inHand)} green big bg={TK.positiveTint} sub="Estimated · excl. TDS" />
          </div>
        )}

        {/* Stipend (intern / NATS / NAPS) — only the entered figures, nothing else */}
        {isStipend && (
          <>
            <div style={S.card}>
              <div style={{ background:TK.brand, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>{payLabel} Details</div>
              <Row l={`Monthly ${payLabel}`} v={`₹${fmt(stipendMonthly)}`} />
              {tdsApplicable && stipendTdsAmt > 0 && <Row l={`(−) TDS (${tdsPct}%)`} v={`₹${fmt(stipendTdsAmt)}`} red />}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 16px', background:TK.positiveTint, fontSize:15, fontWeight:700, color:TK.positive }}>
                <span>Net Monthly In-Hand</span><span>₹{fmt(stipendNet)}</span>
              </div>
              <Row l={`Annual ${payLabel}`} v={`₹${fmt(stipendMonthly*12)}`} />
              {addAmount > 0 && <Row l={`Additional Amount (${addFreq})`} v={`₹${fmt(addAmount)}`} green />}
            </div>
            {remarkText && (
              <div style={S.card}>
                <div style={{ background:TK.brandDeep, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>Remark</div>
                <div style={{ padding:'12px 16px', fontSize:13, color:TK.ink, lineHeight:1.6, whiteSpace:'pre-wrap' as const }}>{remarkText}</div>
              </div>
            )}
          </>
        )}

        {!isStipend && (<>
        {/* Statutory basis — the rules this structure was built on (Automated CTC model) */}
        {hasAutoModel && (
          <div style={{ ...S.card, padding:'12px 14px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8 }}>
            <Basis k="State / UT" v={calc.state || '—'} />
            <Basis k="Designation" v={designation || '—'} />
            <Basis k="Minimum Wage" v={`₹${fmt(minWage)}/month`} sub={calc.minWageSource === 'master' ? 'As per HR master' : calc.minWageSource === 'default' ? 'Pan-India default table' : undefined} />
            <Basis k="Basic Salary Rule" v="Higher of 50% of fixed CTC and the minimum wage" />
          </div>
        )}

        {/* Employer contributions — part of the CTC package (legacy links only; the statement already lists them) */}
        {!stmtRows && (epfEmployer > 0 || gratuityMonthly > 0 || bonusOverheadMonthly > 0) && (
          <div style={S.card}>
            <div style={{ background:TK.brandDeep, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>Employer Contributions — included in CTC (Annual)</div>
            {epfEmployer > 0 && <Row l={calc.epfWageBase != null ? `Employer EPF (13% on PF wages ₹${fmt(calc.epfWageBase)}, ceiling ₹${fmt(calc.epfCeiling || 25000)})` : `Employer EPF (13%, capped at ₹${fmt(calc.epfCeiling || 15000)} Basic)`} v={`₹${fmt(epfEmployer*12)}`} />}
            {esicEmployer > 0 && <Row l="Employer ESIC (3.25%)" v={`₹${fmt(esicEmployer*12)}`} />}
            {gratuityIncluded && gratuityMonthly > 0 && <Row l="Gratuity (4.81% of Basic)" v={`₹${fmt(gratuityMonthly*12)}`} green />}
            {bonusOverheadMonthly > 0 && <Row l="Statutory Bonus (Employer Overhead)" v={`₹${fmt(bonusOverheadMonthly*12)}`} />}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', background:TK.brandTint, fontSize:14, fontWeight:700, color:TK.brandDeep }}>
              <div>Fixed CTC Package<div style={{ fontSize:10, fontWeight:500, color:TK.faint, marginTop:1 }}>Gross earnings + employer contributions</div></div>
              <div style={{ textAlign:'right' as const }}>₹{fmt(fixedAnnual)}<div style={{ fontSize:10.5, fontWeight:500, color:TK.faint }}>≈ ₹{fmt(fixedCtcMonthly)}/mo</div></div>
            </div>
          </div>
        )}
        {false && gratuityExcluded && (
          <div style={{ background:TK.infoTint, border: `1px solid ${TK.brandEdge}`, borderRadius:10, padding:'10px 14px', marginBottom:14, fontSize:12, color:TK.info, lineHeight:1.6 }}>
            <strong>Note:</strong> Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.
          </div>
        )}
        {minWage > 0 && (
          <div style={{ fontSize:11, color:TK.faint, margin:'-6px 2px 14px' }}>Basic salary meets the statutory minimum wage for {calc.state}: ₹{fmt(minWage)}/month.</div>
        )}

        {/* CTC Summary (legacy links only; the statement carries the totals) */}
        {!stmtRows && <div style={S.card}>
          <div style={{ background:TK.brandDeep, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>CTC Summary — Annual</div>
          <Row l="Fixed Component" v={`₹${fmt(fixedAnnual)}`} />
          <Row l="Variable Component" v={`₹${fmt(varAnnual)}`} />
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', fontSize:14, fontWeight:700, color:TK.brandDeep }}>
            <span>Total CTC</span>
            <span style={{ textAlign:'right' as const }}>₹{fmt(ctcAnnual)}<div style={{ fontSize:10.5, fontWeight:500, color:TK.faint }}>≈ ₹{fmt(Math.round(ctcAnnual/12))}/mo</div></span>
          </div>
        </div>}

        {/* One-time payments */}
        {(joiningBonus > 0 || retentionBonus > 0 || esopValue > 0) && (
          <div style={S.card}>
            <div style={{ background:TK.positive, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>One-time Payments</div>
            {joiningBonus > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13 }}>
                <div><span style={{ color:TK.inkSoft }}>Joining Bonus</span>{data.joining_bonus_freq && <span style={{ fontSize:11, color:TK.faint, marginLeft:8 }}>({data.joining_bonus_freq})</span>}</div>
                <span style={{ fontWeight:600, color:TK.positive }}>₹{fmt(joiningBonus)}</span>
              </div>
            )}
            {retentionBonus > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13 }}>
                <div><span style={{ color:TK.inkSoft }}>Retention Bonus</span>{data.retention_bonus_freq && <span style={{ fontSize:11, color:TK.faint, marginLeft:8 }}>({data.retention_bonus_freq})</span>}</div>
                <span style={{ fontWeight:600, color:TK.positive }}>₹{fmt(retentionBonus)}</span>
              </div>
            )}
            {esopValue > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px', fontSize:13 }}>
                <div><span style={{ color:TK.inkSoft }}>ESOP Grant Value</span>{data.esop_remark && <span style={{ fontSize:11, color:TK.faint, marginLeft:8 }}>({data.esop_remark})</span>}</div>
                <span style={{ fontWeight:600, color:TK.brand }}>₹{fmt(esopValue)}</span>
              </div>
            )}
          </div>
        )}

        {/* TDS + FBP CALCULATOR */}
        <div style={{ background:TK.surface, borderRadius:10, border: `2px solid ${TK.brandEdge}`, overflow:'hidden', marginBottom:14 }}>
          <button onClick={() => setShowCalc(!showCalc)}
            style={{ width:'100%', padding:'13px 18px', background:showCalc?TK.brandTint:TK.brand, color:showCalc?TK.brandDeep: TK.surface, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', display:'flex', justifyContent:'space-between', alignItems:'center', textAlign:'left' as const }}>
            <span>Calculate TDS & Select Flexi Benefit Plan</span>
            <span style={{ fontSize:18 }}>{showCalc ? '' : ''}</span>
          </button>

          {showCalc && (
            <div style={{ padding:'16px 18px' }}>

              {/* REGIME */}
              <div style={S.sec()}>Tax Regime</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
                {(['new','old'] as const).map(r => (
                  <button key={r} onClick={() => { setRegime(r); setSelectedFBP(new Set()) }}
                    style={{ padding:12, border:regime===r?'none':`1px solid ${TK.brandEdge}`, borderRadius:10, cursor:'pointer', fontFamily:'inherit', background:regime===r?TK.brand:TK.sunken, color:regime===r?TK.surface:TK.muted, fontWeight:regime===r?600:400 }}>
                    <div style={{ fontSize:13 }}>{r==='new'?'New Regime':'Old Regime'}</div>
                    <div style={{ fontSize:10, marginTop:2, opacity:.8 }}>{r==='new'?'Default | 6 FBP components':'All 11 FBP components'}</div>
                  </button>
                ))}
              </div>

              {/* OLD REGIME DECLARATIONS */}
              {regime === 'old' && (
                <div style={{ marginBottom:16 }}>
                  <div style={S.sec()}>Investment Declarations (Old Regime)</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    {[
                      ['80C — PPF/ELSS/LIC', dec80C, setDec80C, 150000],
                      ['80D — Health Insurance', dec80D, setDec80D, 100000],
                      ['24(b) — Home Loan Interest', decHomeLoan, setDecHomeLoan, 200000],
                      ['80CCD(1B) — NPS Extra', decNPS, setDecNPS, 50000],
                    ].map(([label, val, setter, max]) => (
                      <div key={label as string}>
                        <label style={{ ...S.label, display:'block', marginBottom:3, fontSize:10 }}>{label as string} (max ₹{fmt(max as number)})</label>
                        <input style={S.inp} type="number" value={val as number}
                          onChange={e => (setter as Function)(Math.min(Number(e.target.value), max as number))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FBP SELECTION */}
              <div style={S.sec()}>Select Flexi Benefit Plan (FBP)</div>
              <div style={{ background:TK.brandTint, borderRadius:10, padding:'8px 12px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12 }}>
                <span style={{ color:TK.brandDeep }}>Slab {slab} — {SLAB_NAMES[slab]} &nbsp;|&nbsp; {regime === 'old' ? 'Old' : 'New'} Regime</span>
                <span style={{ fontWeight:600, color:TK.brandDeep }}>Pool: ₹{fmt(Math.min(fbpBalance, availableFBP.filter(c => !c.paired || c.code < c.paired).reduce((s,c) => s + c.limit, 0)))}/yr</span>
              </div>
              {/* FBP is carved out of the Special Allowance — you can opt only as much as that balance. */}
              <div style={{ display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap' as const, fontSize:12, marginBottom:10, padding:'8px 12px', borderRadius:10, background: fbpRemaining > 0 ? TK.sunken : TK.warningTint, border:`1px solid ${TK.brandEdge}` }}>
                <span style={{ color:TK.inkSoft }}>Special Allowance balance: <b style={{ color:TK.ink }}>₹{fmt(fbpBalance)}/yr</b> (₹{fmt(specialAllow)}/mo)</span>
                <span style={{ color: fbpRemaining > 0 ? TK.positive : TK.warning, fontWeight:600 }}>Used ₹{fmt(fbpSummary.totalNonTaxable)} · Remaining ₹{fmt(fbpRemaining)}/yr</span>
              </div>
              {fbpMsg && <div style={{ fontSize:12, color:TK.warning, background:TK.warningTint, borderRadius:8, padding:'8px 12px', marginBottom:10, fontWeight:600 }}>{fbpMsg}</div>}

              {availableFBP.map(c => {
                const isSelected = selectedFBP.has(c.code)
                const isLinked = c.paired && (selectedFBP.has(c.paired) || selectedFBP.has(c.code))
                const unaffordable = !isSelected && fbpCostOf(c.code, c.paired) > fbpRemaining
                return (
                  <div key={c.code} onClick={() => toggleFBP(c.code, c.paired)} title={unaffordable ? 'Exceeds the Special Allowance balance' : undefined}
                    style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', borderRadius:10, marginBottom:6, cursor: unaffordable ? 'not-allowed' : 'pointer', opacity: unaffordable ? .45 : 1, background:isSelected?TK.brandTint:TK.sunken, border:isSelected?`2px solid ${TK.brand}`:`1px solid ${TK.line}`, transition:'all .15s' }}>
                    <div style={{ width:18, height:18, borderRadius:7, border:isSelected?'none':`2px solid ${TK.brandEdge}`, background:isSelected?TK.brand: TK.surface, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
                      {isSelected && <span style={{ color:TK.onAccent, fontSize:12, fontWeight:700 }}></span>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:13, fontWeight:isSelected?600:400, color:isSelected?TK.brandDeep:TK.ink }}>{c.label}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:isSelected?TK.brand:TK.inkSoft }}>₹{fmt(c.limit)}/yr</span>
                      </div>
                      {c.note && <div style={{ fontSize:10, color:TK.faint, marginTop:2 }}>{c.note}</div>}
                      {c.perquisite > 0 && <div style={{ fontSize:10, color:TK.warning, marginTop:2 }}>Perquisite: ₹{fmt(c.perquisite)}/mo added to taxable income</div>}
                    </div>
                  </div>
                )
              })}

              {selectedFBP.size > 0 && (
                <div style={{ background:TK.positiveTint, border: `1px solid ${TK.positiveTint}`, borderRadius:10, padding:'10px 14px', marginTop:4, marginBottom:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:600, color: TK.positive, marginBottom:6 }}>
                    <span>Selected FBP Total</span>
                    <span>₹{fmt(fbpSummary.totalNonTaxable)}/yr</span>
                  </div>
                  {fbpSummary.perquisiteAnnual > 0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:TK.warning, marginBottom:4 }}>
                      <span>Car+Driver perquisite (taxable)</span>
                      <span>+₹{fmt(fbpSummary.perquisiteAnnual)}/yr</span>
                    </div>
                  )}
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:TK.positive, fontWeight:500 }}>
                    <span>Net non-taxable FBP</span>
                    <span>₹{fmt(fbpSummary.netNonTaxable)}/yr</span>
                  </div>
                </div>
              )}

              {/* TDS RESULT */}
              <div style={S.sec()}>TDS Calculation</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                <div style={{ background:TK.brandTint, borderRadius:10, padding:'12px', border: `2px solid ${TK.brandEdge}` }}>
                  <div style={{ fontSize:11, fontWeight:600, color: TK.muted, marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    {regime === 'new' ? 'New Regime' : 'Old Regime'}
                    <span style={{ background:TK.brand, color:TK.onAccent, padding:'1px 6px', borderRadius:99, fontSize:9 }}>Selected</span>
                  </div>
                  <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>Without FBP</div>
                  <div style={{ fontSize:14, color:TK.brandDeep }}>₹{fmt(tdsCalc.taxNoFBP)}/yr</div>
                  {selectedFBP.size > 0 && (
                    <>
                      <div style={{ height:1, background:TK.brandEdge, margin:'8px 0' }} />
                      <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>With FBP Selected</div>
                      <div style={{ fontSize:16, fontWeight:700, color:TK.brandDeep }}>₹{fmt(tdsCalc.taxWithFBP)}/yr</div>
                      <div style={{ fontSize:11, color:TK.positive, marginTop:3 }}>
                        ₹{fmt(Math.round(tdsCalc.taxWithFBP/12))}/mo TDS
                      </div>
                    </>
                  )}
                  {selectedFBP.size === 0 && (
                    <div style={{ fontSize:11, color:TK.brandDeep, marginTop:4 }}>₹{fmt(Math.round(tdsCalc.taxNoFBP/12))}/mo TDS</div>
                  )}
                </div>
                {regime === 'new' ? (
                  <div style={{ background:TK.sunken, borderRadius:10, padding:'12px', border: `1px solid ${TK.brandEdge}` }}>
                    <div style={{ fontSize:11, fontWeight:500, color:TK.faint, marginBottom:6 }}>Old Regime (comparison)</div>
                    <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>With 80C/80D etc.</div>
                    <div style={{ fontSize:14, color:TK.inkSoft }}>₹{fmt(calcTax(Math.max(0,grossAnnual-50000-150000-25000-epfEmp*12),'old'))}/yr</div>
                    <div style={{ fontSize:11, color:TK.faint, marginTop:4 }}>Switch to Old regime to configure</div>
                  </div>
                ) : (
                  <div style={{ background:TK.sunken, borderRadius:10, padding:'12px', border: `1px solid ${TK.brandEdge}` }}>
                    <div style={{ fontSize:11, fontWeight:500, color:TK.faint, marginBottom:6 }}>New Regime (comparison)</div>
                    <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>Default | No deductions</div>
                    <div style={{ fontSize:14, color:TK.inkSoft }}>₹{fmt(calcTax(Math.max(0,grossAnnual-75000),'new'))}/yr</div>
                    <div style={{ fontSize:11, color:TK.faint, marginTop:4 }}>Switch to New regime to configure</div>
                  </div>
                )}
              </div>

              {selectedFBP.size > 0 && tdsCalc.fbpSaving > 0 && (
                <div style={{ background:TK.positiveTint, border: `1px solid ${TK.positiveTint}`, borderRadius:10, padding:'10px 14px', marginBottom:14, fontSize:13, fontWeight:500, color:TK.positive }}>
                  <i></i> FBP selection saves you <strong>₹{fmt(tdsCalc.fbpSaving)}/yr</strong> in tax (₹{fmt(Math.round(tdsCalc.fbpSaving/12))}/mo less TDS)
                </div>
              )}

              <div style={{ background:TK.warningTint, borderRadius:7, padding:'9px 13px', fontSize:11, color:TK.warning, lineHeight:1.6, marginBottom:8 }}>
                Submit invoices on time to claim FBP benefits — Quarterly: Jul/Oct/Jan/Mar &nbsp;|&nbsp; Annual: March. Unclaimed balance becomes taxable.
              </div>

              <div style={{ background:TK.brandTint, borderRadius:7, padding:'8px 13px', fontSize:11, color:TK.brandDeep, textAlign:'center' as const }}>
                This is indicative. Final TDS and FBP allocation confirmed after IT Declaration in EZER ESS portal post joining.
              </div>
            </div>
          )}
        </div>
        </>)}

        {/* Terms & Conditions for the one-time payments (Employee offers) */}
        {!isStipend && termsText && (
          <div style={S.card}>
            <div style={{ background:TK.brandDeep, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>Terms &amp; Conditions</div>
            <div style={{ padding:'12px 16px', fontSize:13, color:TK.ink, lineHeight:1.65, whiteSpace:'pre-wrap' as const }}>{termsText}</div>
          </div>
        )}

        {/* Additional Amounts — applies to every offer type */}
        {additionalItems.length > 0 && (
          <div style={S.card}>
            <div style={{ background:TK.positive, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>Additional Amounts</div>
            {additionalItems.map((r, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13 }}>
                <div><span style={{ color:TK.inkSoft }}>Additional</span><span style={{ fontSize:11, color:TK.faint, marginLeft:8 }}>({r.freq}{r.remark ? ` · ${r.remark}` : ''})</span></div>
                <span style={{ fontWeight:600, color:TK.positive }}>₹{fmt(Math.round(r.amount))}</span>
              </div>
            ))}
          </div>
        )}

        {/* Statutory-change note — applies to every offer */}
        <div style={{ background:TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius:10, padding:'11px 15px', marginBottom:14, fontSize:12, color:TK.brandDeep, lineHeight:1.6 }}>
          <strong>Please note:</strong> If any salary-related law or statutory regulation changes in the future, your salary will be calculated and paid in accordance with the applicable law in force at that time.
        </div>

        {/* Disclaimer */}
        {!isStipend && (
          <div style={{ background:TK.warningTint, border: `1px solid ${TK.warningTint}`, padding:'11px 15px', marginBottom:14, fontSize:12, color:TK.warning, lineHeight:1.6, borderLeft: `3px solid ${TK.warningTint}`, borderRadius:'0 8px 8px 0' as any }}>
            <strong>Disclaimer:</strong> Indicative calculation only. Actual in-hand depends on IT declaration, applicable TDS, company policy, and FBP bill submission. Please review your formal offer letter for confirmed figures.
          </div>
        )}

        {/* Accept / Reject the offer */}
        {response ? (
          <div style={{ background: response==='ACCEPTED'?TK.positiveTint:TK.criticalTint, border:`1px solid ${response==='ACCEPTED'?TK.positiveEdge:TK.criticalEdge}`, borderRadius:10, padding:'18px 20px', marginBottom:16, textAlign:'center' as const }}>
            <div style={{ fontSize:26, marginBottom:8 }}>{response==='ACCEPTED'?'':''}</div>
            <div style={{ fontSize:15, fontWeight:600, color: response==='ACCEPTED'?TK.positive:TK.critical, marginBottom:4 }}>
              {response==='ACCEPTED' ? 'You have accepted this offer' : 'You have declined this offer'}
            </div>
            <div style={{ fontSize:13, color:TK.muted, lineHeight:1.6 }}>
              {response==='ACCEPTED'
                ? 'Thank you! Our HR team will reach out with the next steps shortly.'
                : 'Thank you for letting us know. Our recruiter may connect with you.'}
            </div>
          </div>
        ) : (
          <div style={{ background:TK.canvas, border: `1px solid ${TK.brandEdge}`, borderRadius:10, padding:'18px 20px', marginBottom:16, textAlign:'center' as const }}>
            <div style={{ fontSize:14, fontWeight:600, color: offerExpired ? TK.critical : TK.brandDeep, marginBottom:12 }}>{offerExpired ? 'Acceptance window closed' : 'Would you like to accept this offer?'}</div>
            {offerExpired ? (
              <div style={{ background:TK.criticalTint, border:`1px solid ${TK.criticalEdge}`, borderRadius:10, padding:'10px 14px', fontSize:13, color:TK.critical, fontWeight:600, lineHeight:1.55 }}>
                This offer link expired on {expiresAtLabel}. The acceptance window has closed — please contact your recruiter for a fresh offer.
              </div>
            ) : mounted && (
              <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' as const }}>
                <button onClick={()=>respond('ACCEPTED')} disabled={responding}
                  style={{ padding:'11px 32px', borderRadius:10, border:'none', cursor:responding?'not-allowed':'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit', background:TK.positive, color:TK.onAccent, opacity:responding?.6:1 }}>Accept Offer
                </button>
              </div>
            )}
            <div style={{ fontSize:12, color:TK.muted, lineHeight:1.6, marginTop:12 }}>
              Any questions about your salary structure? Please connect with your recruiter directly.
            </div>
          </div>
        )}

        <div style={{ textAlign:'center' as const, color:TK.faint, fontSize:11, paddingBottom:24 }}>
          Powered by <strong>EZER HRMS</strong> · {data.company_name || ''} · Confidential
        </div>
      </div>
    </div>
  )
}
