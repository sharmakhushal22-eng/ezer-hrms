'use client'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

function fmt(n: number) { return Math.round(n).toLocaleString('en-IN') }

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

// ── MAIN COMPONENT ────────────────────────────────────────────────
export default function SalaryViewClient({ data }: { data: any }) {
  const [response, setResponse] = useState<string>(data.candidate_response || '')
  const [responding, setResponding] = useState(false)
  async function respond(r: 'ACCEPTED' | 'REJECTED') {
    let note = ''
    if (r === 'REJECTED') { const n = window.prompt('Optionally, let us know why you are declining:'); if (n === null) return; note = n }
    else if (!window.confirm('Confirm you accept this offer?')) return
    setResponding(true)
    const { error } = await supabase.from('ctc_negotiations')
      .update({ candidate_response: r, response_at: new Date().toISOString(), response_note: note || null })
      .eq('link_token', data.link_token)
    setResponding(false)
    if (error) { alert('Sorry, we could not record your response: ' + error.message); return }
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
  const basic = Math.round(data.basic_monthly || calc.basic || 0)
  const hra = Math.round(data.hra_monthly || calc.hra || 0)
  const grossMonthly = Math.round(calc.gross || 0)
  const epfEmp = Math.round(data.epf_monthly || calc.epfEmp || 0)
  const esicEmp = Math.round(calc.esicEmp || 0)
  const ptMonthly = Math.round(calc.ptMonthly || 0)
  const inHand = Math.round(data.net_monthly || calc.inHand || 0)
  const otherAllow = Math.round(calc.otherAllow || 0)
  const statBonus = Math.round(calc.statBonus || 0)
  const totalDed = epfEmp + esicEmp + ptMonthly
  const ctcAnnual = Math.round(data.offered_ctc || 0)
  const varAnnual = Math.round(calc.variableAnnual || 0)
  const fixedAnnual = ctcAnnual - varAnnual
  const grossAnnual = grossMonthly * 12
  const joiningBonus = data.joining_bonus || 0
  const retentionBonus = data.retention_bonus || 0
  const esopValue = data.esop_value || 0
  const slab = getSlab(ctcAnnual)
  const ltaAmt = Math.round(basic * 12 * 0.0833)

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

  function toggleFBP(code: string, paired?: string) {
    const next = new Set(selectedFBP)
    if (next.has(code)) {
      next.delete(code)
      if (paired) next.delete(paired) // Car+Driver always together
    } else {
      next.add(code)
      if (paired) next.add(paired)
    }
    setSelectedFBP(next)
  }

  const S = {
    page: { background:TK.canvas, minHeight:'100vh', fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
    card: { background:TK.surface, borderRadius:10, border:'1px solid rgba(37,99,235,0.12)', overflow:'hidden', marginBottom:14 } as React.CSSProperties,
    label: { fontSize:10, fontWeight:600 as const, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em' } as React.CSSProperties,
    inp: { padding:'7px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius:6, color:TK.ink, fontSize:12, outline:'none', background:TK.sunken, width:'100%', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
    sec: (margin?: string) => ({ fontSize:10, fontWeight:600 as const, color:TK.brand, textTransform:'uppercase' as const, letterSpacing:'.06em', margin:margin||'12px 0 8px', display:'flex', alignItems:'center', gap:8 }) as React.CSSProperties,
  }

  const Row = ({ l, v, red, bold, green }: { l: string; v: string; red?: boolean; bold?: boolean; green?: boolean }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 16px', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13 }}>
      <span style={{ color: red ? TK.critical : TK.inkSoft }}>{l}</span>
      <span style={{ fontWeight: bold ? 600 : 500, color: red ? TK.critical : green ? TK.positive : TK.ink }}>{v}</span>
    </div>
  )

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, padding:'18px 20px', color:TK.onAccent }}>
        <div style={{ maxWidth:680, margin:'0 auto' }}>
          <div style={{ fontSize:11, color:TK.onAccentDim, marginBottom:3 }}>{data.company_name || 'EZER HRMS'}</div>
          <div style={{ fontSize:20, fontWeight:600 }}>Your Salary Structure</div>
          {data.candidate_name && <div style={{ fontSize:13, color:TK.onAccentSoft, marginTop:3 }}>Dear {data.candidate_name}</div>}
          {data.position_title && <div style={{ fontSize:12, color:TK.onAccentDim, marginTop:1 }}>{data.position_title}</div>}
        </div>
      </div>

      <div style={{ maxWidth:680, margin:'0 auto', padding:'16px' }}>

        {/* In-Hand Highlight */}
        <div style={{ background:TK.surface, borderRadius:12, border: `2px solid ${TK.brandEdge}`, padding:'18px 20px', marginBottom:14, textAlign:'center' as const }}>
          <div style={{ fontSize:11, color:TK.faint, textTransform:'uppercase' as const, letterSpacing:'.08em', marginBottom:3 }}>Estimated Monthly In-Hand</div>
          <div style={{ fontSize:38, fontWeight:700, color:TK.positive, letterSpacing:-1 }}>₹{fmt(inHand)}</div>
          <div style={{ fontSize:11, color:TK.faint, marginTop:3 }}>Annual: ₹{fmt(inHand*12)} &nbsp;|&nbsp; Excl. TDS</div>
          {data.hike_pct && (
            <div style={{ background:TK.positiveTint, borderRadius:99, padding:'4px 14px', display:'inline-block', marginTop:8, border: `1px solid ${TK.positiveTint}` }}>
              <span style={{ fontSize:13, fontWeight:600, color:TK.positive }}>Hike: {Number(data.hike_pct).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Salary Breakdown — ANNUAL */}
        <div style={{ ...S.card }}>
          <div style={{ background:TK.brand, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>Salary Breakdown</span>
            <span style={{ fontSize:10, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:99 }}>Annual (₹)</span>
          </div>
          <Row l="Basic" v={`₹${fmt(basic*12)}`} />
          <Row l="HRA" v={`₹${fmt(hra*12)}`} />
          <Row l="Allowances / Flexi Pool" v={`₹${fmt(otherAllow*12)}`} />
          {statBonus > 0 && <Row l="Statutory Bonus" v={`₹${fmt(statBonus*12)}`} />}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px', background:TK.brandTint, borderBottom: `1px solid ${TK.brandEdge}`, fontSize:14, fontWeight:600, color:TK.brandDeep }}>
            <span>Gross (Annual)</span><span>₹{fmt(grossAnnual)}</span>
          </div>
          {epfEmp > 0 && <Row l="(−) EPF Employee" v={`₹${fmt(epfEmp*12)}`} red />}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 16px', background: TK.criticalTint, borderBottom: `1px solid ${TK.brandEdge}`, fontSize:12 }}>
            <div>
              <span style={{ color: esicEmp > 0 ? TK.critical : TK.faint }}>(−) ESIC Employee</span>
              <div style={{ fontSize:10, color:TK.faint, marginTop:1 }}>
                {esicEmp > 0
                  ? `Gross/mo ₹${fmt(grossMonthly)} ≤ ₹21,000 → 0.75% = ₹${fmt(esicEmp)}/mo`
                  : `Gross/mo ₹${fmt(grossMonthly)} > ₹21,000 → Not applicable`}
              </div>
            </div>
            <span style={{ fontWeight:500, color: esicEmp > 0 ? TK.critical : TK.positive }}>
              {esicEmp > 0 ? `₹${fmt(esicEmp*12)}` : 'Nil'}
            </span>
          </div>
          {ptMonthly > 0 && <Row l="(−) Professional Tax" v={`₹${fmt(ptMonthly*12)}`} red />}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 16px', background: TK.criticalTint, borderBottom: `1px solid ${TK.brandEdge}`, fontSize:12, fontWeight:500, color: TK.critical }}>
            <span>Total Deductions</span><span>₹{fmt(totalDed*12)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 16px', background:TK.positiveTint, fontSize:15, fontWeight:700, color: TK.positive }}>
            <span>In Hand (Annual)</span><span>₹{fmt(inHand*12)}</span>
          </div>
        </div>

        {/* CTC Summary */}
        <div style={S.card}>
          <div style={{ background:TK.brandDeep, padding:'9px 16px', color:TK.onAccent, fontSize:12, fontWeight:500 }}>CTC Summary — Annual</div>
          <Row l="Fixed Component" v={`₹${fmt(fixedAnnual)}`} />
          <Row l="Variable Component" v={`₹${fmt(varAnnual)}`} />
          <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 16px', fontSize:14, fontWeight:700, color:TK.brandDeep }}>
            <span>Total CTC</span><span>₹{fmt(ctcAnnual)}</span>
          </div>
        </div>

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
        <div style={{ background:TK.surface, borderRadius:10, border: `1.5px solid ${TK.brandEdge}`, overflow:'hidden', marginBottom:14 }}>
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
                    style={{ padding:12, border:regime===r?'none':'1px solid #DDD6FE', borderRadius:8, cursor:'pointer', fontFamily:'inherit', background:regime===r?TK.brand:TK.sunken, color:regime===r?TK.surface:TK.muted, fontWeight:regime===r?600:400 }}>
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
              <div style={{ background:TK.brandTint, borderRadius:8, padding:'8px 12px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12 }}>
                <span style={{ color:TK.brandDeep }}>Slab {slab} — {SLAB_NAMES[slab]} &nbsp;|&nbsp; {regime === 'old' ? 'Old' : 'New'} Regime</span>
                <span style={{ fontWeight:600, color:TK.brandDeep }}>Pool: ₹{fmt(availableFBP.filter(c => !c.paired || c.code < c.paired).reduce((s,c) => s + c.limit, 0))}/yr</span>
              </div>

              {availableFBP.map(c => {
                const isSelected = selectedFBP.has(c.code)
                const isLinked = c.paired && (selectedFBP.has(c.paired) || selectedFBP.has(c.code))
                return (
                  <div key={c.code} onClick={() => toggleFBP(c.code, c.paired)}
                    style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', borderRadius:8, marginBottom:6, cursor:'pointer', background:isSelected?TK.brandTint:TK.sunken, border:isSelected?'1.5px solid #2563EB':'1px solid #E5E7EB', transition:'all .15s' }}>
                    <div style={{ width:18, height:18, borderRadius:4, border:isSelected?'none':'2px solid #DDD6FE', background:isSelected?TK.brand: TK.surface, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
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
                <div style={{ background:TK.positiveTint, border: `1px solid ${TK.positiveTint}`, borderRadius:8, padding:'10px 14px', marginTop:4, marginBottom:16 }}>
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
                <div style={{ background:TK.brandTint, borderRadius:8, padding:'12px', border: `1.5px solid ${TK.brandEdge}` }}>
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
                  <div style={{ background:TK.sunken, borderRadius:8, padding:'12px', border: `1px solid ${TK.brandEdge}` }}>
                    <div style={{ fontSize:11, fontWeight:500, color:TK.faint, marginBottom:6 }}>Old Regime (comparison)</div>
                    <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>With 80C/80D etc.</div>
                    <div style={{ fontSize:14, color:TK.inkSoft }}>₹{fmt(calcTax(Math.max(0,grossAnnual-50000-150000-25000-epfEmp*12),'old'))}/yr</div>
                    <div style={{ fontSize:11, color:TK.faint, marginTop:4 }}>Switch to Old regime to configure</div>
                  </div>
                ) : (
                  <div style={{ background:TK.sunken, borderRadius:8, padding:'12px', border: `1px solid ${TK.brandEdge}` }}>
                    <div style={{ fontSize:11, fontWeight:500, color:TK.faint, marginBottom:6 }}>New Regime (comparison)</div>
                    <div style={{ fontSize:10, color:TK.faint, marginBottom:2 }}>Default | No deductions</div>
                    <div style={{ fontSize:14, color:TK.inkSoft }}>₹{fmt(calcTax(Math.max(0,grossAnnual-75000),'new'))}/yr</div>
                    <div style={{ fontSize:11, color:TK.faint, marginTop:4 }}>Switch to New regime to configure</div>
                  </div>
                )}
              </div>

              {selectedFBP.size > 0 && tdsCalc.fbpSaving > 0 && (
                <div style={{ background:TK.positiveTint, border: `1px solid ${TK.positiveTint}`, borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13, fontWeight:500, color:TK.positive }}>
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

        {/* Disclaimer */}
        <div style={{ background:TK.warningTint, border: `1px solid ${TK.warningTint}`, borderRadius:8, padding:'11px 15px', marginBottom:14, fontSize:12, color:TK.warning, lineHeight:1.6, borderLeft: `3px solid ${TK.warningTint}`, borderRadius:'0 8px 8px 0' as any }}>
          <strong>Disclaimer:</strong> Indicative calculation only. Actual in-hand depends on IT declaration, applicable TDS, company policy, and FBP bill submission. Please review your formal offer letter for confirmed figures.
        </div>

        {/* Accept / Reject the offer */}
        {response ? (
          <div style={{ background: response==='ACCEPTED'?TK.positiveTint:TK.criticalTint, border:`1px solid ${response==='ACCEPTED'?'#A7F3D0':'#FCA5A5'}`, borderRadius:10, padding:'18px 20px', marginBottom:16, textAlign:'center' as const }}>
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
            <div style={{ fontSize:14, fontWeight:600, color:TK.brandDeep, marginBottom:12 }}>Would you like to accept this offer?</div>
            <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' as const }}>
              <button onClick={()=>respond('ACCEPTED')} disabled={responding}
                style={{ padding:'11px 32px', borderRadius:9, border:'none', cursor:responding?'not-allowed':'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit', background:TK.positive, color:TK.onAccent, opacity:responding?.6:1 }}>Accept Offer
              </button>
            </div>
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
