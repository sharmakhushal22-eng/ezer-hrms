'use client'
// components/ess/InvestmentDeclaration.tsx — ESS → Investment Declaration.
//
// Financial-year data, NOT a payroll-month thing. One declaration per employee per FY
// drives every month's TDS, so it is never copied into a month snapshot — the only
// month-level consequence is the chosen regime, which Payroll's "Investment declaration"
// sync applies (sql101).
//
// Every rule that costs money is enforced in the database too (sql99/sql100):
//   • 80C capped at ₹1,50,000
//   • landlord PAN mandatory once annual rent crosses ₹1,00,000
//   • regime may be switched once more, before January
// The UI mirrors them so the employee finds out before pressing Submit, not after.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: 'rgba(37,99,235,0.12)', muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint, red: TK.critical, redBg: TK.criticalTint,
  purpleBg: TK.brandTint, soft: TK.sunken,
}
const FY = '2026-27'
const CAP_80C = 150000
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 } as React.CSSProperties,
  h: { fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 3 } as React.CSSProperties,
  sub: { fontSize: 12, color: C.muted, lineHeight: 1.5 } as React.CSSProperties,
  lbl: { fontSize: 12, color: C.navy, display: 'block', marginBottom: 5 } as React.CSSProperties,
  inp: { width: '100%', padding: '9px 11px', background: C.soft, border: `1px solid #DDD6FE`, borderRadius: 7, color: C.navy, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  row: { display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.border}` } as React.CSSProperties,
  btnP: { padding: '11px 24px', borderRadius: 8, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
  btnO: { padding: '11px 20px', borderRadius: 8, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
}

// Regime cards, defined outside the component so typing never remounts them.
function RegimeCard({ code, title, blurb, active, disabled, onPick }: {
  code: string; title: string; blurb: string; active: boolean; disabled: boolean; onPick: (c: string) => void
}) {
  return (
    <button onClick={() => !disabled && onPick(code)} disabled={disabled}
      style={{
        flex: 1, minWidth: 240, textAlign: 'left', padding: '14px 16px', borderRadius: 10,
        border: `2px solid ${active ? C.purple : C.border}`,
        background: active ? C.purpleBg: TK.surface,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled && !active ? 0.55 : 1,
        fontFamily: 'inherit',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 15, height: 15, borderRadius: '50%', border: `2px solid ${active ? C.purple: TK.brandTint}`,
          background: active ? C.purple: TK.surface, boxShadow: active ? 'inset 0 0 0 3px #fff' : 'none', flexShrink: 0,
        }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{blurb}</div>
    </button>
  )
}

function AmountRow({ label, hint, value, onChange, readOnly }: {
  label: string; hint?: string; value: any; onChange?: (v: string) => void; readOnly?: boolean
}) {
  return (
    <div style={S.row}>
      <div>
        <div style={{ fontSize: 13, color: C.navy }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{hint}</div>}
      </div>
      <input
        style={{ ...S.inp, textAlign: 'right', background: readOnly ? TK.sunken : C.soft, color: readOnly ? C.muted : C.navy }}
        value={value} readOnly={readOnly} inputMode="numeric"
        onChange={e => onChange && onChange(e.target.value.replace(/[^0-9]/g, ''))} />
    </div>
  )
}

export default function InvestmentDeclaration({ employeeId, empName, empCode }: {
  employeeId: string; empName?: string; empCode?: string
}) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  const [regime, setRegime] = useState('OLD')
  const [lic, setLic] = useState('')            // 80C the employee types
  const [ppf, setPpf] = useState('')
  const [d80d, setD80d] = useState('')
  const [rent, setRent] = useState('')
  const [pan, setPan] = useState('')
  const [pf, setPf] = useState(0)               // auto from the salary structure
  const [savedRegime, setSavedRegime] = useState<string | null>(null)
  const [switches, setSwitches] = useState(0)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Employee PF is not typed by the employee — it comes from the salary structure.
      const { data: ss } = await supabase.from('salary_structures')
        .select('employee_pf').eq('employee_id', employeeId).eq('fy', FY)
        .order('effective_date', { ascending: false }).limit(1)
      setPf(num(ss?.[0]?.employee_pf) * 12)

      const { data: d } = await supabase.from('tds_declarations')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
      if (d) {
        setRegime(d.regime || 'OLD'); setSavedRegime(d.regime || null)
        // sec_80c is stored as the capped total; the PF part is not the employee's to edit,
        // so what they typed is whatever sits above it.
        const typed = Math.max(0, num(d.sec_80c) - num(ss?.[0]?.employee_pf) * 12)
        setLic(typed ? String(typed) : '')
        setD80d(num(d.sec_80d) ? String(num(d.sec_80d)) : '')
        setRent(num(d.monthly_rent) ? String(num(d.monthly_rent)) : '')
        setPan(d.landlord_pan || '')
        setSwitches(num(d.regime_switches)); setLockedAt(d.regime_locked_at || null)
        setStatus(d.declaration_status || '')
      }
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [employeeId])
  useEffect(() => { load() }, [load])

  // Same three rules the database enforces — shown before Submit, not after.
  const jan1 = new Date(Number(FY.split('-')[0]) + 1, 0, 1)
  const canSwitch = !lockedAt && switches < 1 && new Date() < jan1
  const regimeChanged = savedRegime !== null && savedRegime !== regime
  const regimeBlocked = regimeChanged && !canSwitch

  const typed80c = num(lic) + num(ppf)
  const total80c = Math.min(pf + typed80c, CAP_80C)
  const over80c = pf + typed80c > CAP_80C
  const annualRent = num(rent) * 12
  const panNeeded = annualRent > 100000
  const panMissing = panNeeded && !pan.trim()
  const totalDeclared = regime === 'NEW' ? 0 : total80c + num(d80d)

  async function save(submit: boolean) {
    setErr(''); setMsg('')
    if (regimeBlocked) { setErr('Regime ab nahi badal sakta — ek baar badla ja chuka hai ya January nikal gayi.'); return }
    if (regime === 'OLD' && panMissing) { setErr('Landlord PAN zaroori hai — saal ka rent ₹1,00,000 se zyada hai.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('save_investment_declaration', {
      p_employee_id: employeeId, p_fy: FY, p_regime: regime,
      // New regime declares nothing — send explicit zeros so a switch to NEW clears the
      // old figures rather than leaving them behind (NULL would keep them, by design).
      p_sec_80c: regime === 'NEW' ? 0 : pf + typed80c,
      p_sec_80d: regime === 'NEW' ? 0 : num(d80d),
      p_monthly_rent: regime === 'NEW' ? 0 : num(rent),
      p_landlord_pan: regime === 'NEW' ? null : (pan.trim() || null),
      p_hra_claimed: regime === 'NEW' ? 0 : annualRent,
      p_submit: submit,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(submit ? 'Declaration submit ho gayi. Har month ka TDS ab isi se banega.' : 'Draft save ho gaya.')
    load()
  }

  if (loading) return <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Loading…</div>

  return (
    <div style={{ fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13, color: C.navy, maxWidth: 780 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Investment Declaration</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
          FY {FY} · {empName || '—'}{empCode ? ` · ${empCode}` : ''}
          {status && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: status === 'SUBMITTED' ? C.green : C.amber, background: status === 'SUBMITTED' ? C.greenBg : C.amberBg, borderRadius: 99, padding: '2px 9px' }}>{status}</span>}
        </div>
      </div>

      <div style={{ ...S.card, background: C.purpleBg, border: `1px solid #DDD6FE` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.purpleD }}>Applies for the whole financial year.</div>
        <div style={{ ...S.sub, color: C.purpleD, marginTop: 3 }}>
          Ye kisi ek payroll month se juda nahi hai — har month ka TDS seedha isi se calculate hota hai.
        </div>
      </div>

      {/* ── Regime ── */}
      <div style={S.card}>
        <div style={S.h}>Choose your tax regime</div>
        <div style={S.sub}>
          {canSwitch
            ? <>January se pehle aap <b>ek baar aur</b> regime badal sakte hain. Uske baad poore FY {FY} ke liye yahi regime rahega.</>
            : <b style={{ color: C.amber }}>Regime ab lock hai — {switches >= 1 ? 'ek baar badla ja chuka hai' : 'January nikal gayi'}. Poore FY {FY} ke liye {savedRegime || regime} hi rahega.</b>}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <RegimeCard code="NEW" title="New Regime" active={regime === 'NEW'} disabled={!canSwitch && savedRegime !== null && savedRegime !== 'NEW'} onPick={setRegime}
            blurb="Kam slab rates. Na HRA exemption, na 80C/80D. Simple — neeche kuch declare nahi karna." />
          <RegimeCard code="OLD" title="Old Regime" active={regime === 'OLD'} disabled={!canSwitch && savedRegime !== null && savedRegime !== 'OLD'} onPick={setRegime}
            blurb="HRA exemption aur Chapter VI-A deductions milti hain. Neeche apna planned investment declare karein." />
        </div>
        {regimeBlocked && (
          <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 8, padding: '9px 12px', marginTop: 10 }}>
            Ye badlaav save nahi hoga — regime ka ek switch pehle hi use ho chuka hai.
          </div>
        )}
      </div>

      {/* ── Declared investments (Old regime only) ── */}
      {regime === 'OLD' && (
        <div style={S.card}>
          <div style={S.h}>Declared investments — Old Regime</div>
          <div style={S.sub}>Saal bhar mein jo invest karne ka plan hai woh likhein. Inke proof saal ke aakhir mein dene honge — ya usse pehle, agar aap resign karte hain.</div>

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 16, marginBottom: 2 }}>
            Section 80C <span style={{ color: C.muted, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>(cap {inr(CAP_80C)})</span>
          </div>
          <AmountRow label="Provident Fund (auto)" hint="Aapke salary structure se — yahan edit nahi hota" value={pf ? String(pf) : '0'} readOnly />
          <AmountRow label="LIC / Insurance premium" value={lic} onChange={setLic} />
          <AmountRow label="PPF / ELSS / other 80C" value={ppf} onChange={setPpf} />
          {over80c && (
            <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 8, padding: '9px 12px', marginTop: 10 }}>
              80C ki legal limit {inr(CAP_80C)} hai — {inr(pf + typed80c)} likhne se exemption nahi badhegi. {inr(CAP_80C)} hi count hoga.
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>Section 80D (health insurance)</div>
          <AmountRow label="Premium paid (self + family)" value={d80d} onChange={setD80d} />

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>HRA exemption</div>
          <AmountRow label="Monthly rent paid" hint={annualRent > 0 ? `Saal ka ${inr(annualRent)}` : undefined} value={rent} onChange={setRent} />
          {panNeeded && (
            <div style={{ ...S.row, gridTemplateColumns: '1fr 200px' }}>
              <div>
                <div style={{ fontSize: 13, color: C.navy }}>Landlord PAN</div>
                <div style={{ fontSize: 11, color: panMissing ? C.red : C.muted, marginTop: 2 }}>
                  Zaroori hai — saal ka rent {inr(100000)} se zyada hai
                </div>
              </div>
              <input style={{ ...S.inp, textTransform: 'uppercase', border: `1px solid ${panMissing ? C.red : TK.brandEdge}` }}
                value={pan} maxLength={10} placeholder="ABCDE1234F"
                onChange={e => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Total declared (80C + 80D)</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.purple }}>{inr(totalDeclared)}</div>
          </div>
        </div>
      )}

      {regime === 'NEW' && (
        <div style={{ ...S.card, background: C.greenBg, border: `1px solid ${TK.positiveTint}` }}>
          <div style={{ fontSize: 13, color: C.green, lineHeight: 1.6 }}>
            <b>New regime mein kuch declare nahi karna.</b> Slab rates kam hain, par HRA exemption aur 80C/80D deductions nahi milti. Submit karte hi aapke purane declare kiye hue amounts hata diye jaayenge.
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: C.muted, background: TK.sunken, borderRadius: 9, padding: '11px 13px', marginBottom: 14, lineHeight: 1.6 }}>Proof submission saal ke aakhir mein khulti hai — ya <b>turant, agar aap resign karte hain</b>, taaki aapke last working day se pehle verify ho sake. Jo declare kiya par prove nahi kiya, woh exempt nahi rahega.
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${TK.positiveTint}`, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => save(false)} disabled={busy} style={{ ...S.btnO, opacity: busy ? 0.6 : 1 }}>Save as draft</button>
        <button onClick={() => save(true)} disabled={busy || regimeBlocked || (regime === 'OLD' && panMissing)}
          style={{ ...S.btnP, opacity: busy || regimeBlocked || (regime === 'OLD' && panMissing) ? 0.5 : 1, cursor: busy || regimeBlocked || (regime === 'OLD' && panMissing) ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving…' : 'Submit declaration'}
        </button>
      </div>
    </div>
  )
}
