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
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', marginBottom: 14 } as React.CSSProperties,
  h: { fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 3 } as React.CSSProperties,
  sub: { fontSize: 12, color: C.muted, lineHeight: 1.5 } as React.CSSProperties,
  lbl: { fontSize: 12, color: C.navy, display: 'block', marginBottom: 5 } as React.CSSProperties,
  inp: { width: '100%', padding: '9px 11px', background: C.soft, border: `1px solid #DDD6FE`, borderRadius: 7, color: C.navy, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  row: { display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.border}` } as React.CSSProperties,
  btnP: { padding: '11px 24px', borderRadius: 10, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
  btnO: { padding: '11px 20px', borderRadius: 10, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
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

// One house-property row — its own component so typing in one property's
// fields never re-mounts the others.
function HousePropertyRow({ row, onChange, onSave, onDelete, busy }: {
  row: any; onChange: (patch: any) => void; onSave: () => void; onDelete?: () => void; busy: boolean
}) {
  const isLetOut = row.occupancy_type === 'LET_OUT' || row.occupancy_type === 'DEEMED_LET_OUT'
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: '12px 14px', marginTop: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
        <div>
          <label style={S.lbl}>Occupancy</label>
          <select style={S.inp} value={row.occupancy_type || 'SELF'} onChange={e => onChange({ occupancy_type: e.target.value })}>
            <option value="SELF">Self-occupied</option>
            <option value="LET_OUT">Let out</option>
            <option value="DEEMED_LET_OUT">Deemed let out</option>
          </select>
        </div>
        <div>
          <label style={S.lbl}>Address</label>
          <input style={S.inp} value={row.address || ''} onChange={e => onChange({ address: e.target.value })} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isLetOut ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 8 }}>
        {isLetOut && (
          <div>
            <label style={S.lbl}>Annual rent received</label>
            <input style={S.inp} inputMode="numeric" value={row.annual_rent_received || ''}
              onChange={e => onChange({ annual_rent_received: e.target.value.replace(/[^0-9]/g, '') })} />
          </div>
        )}
        <div>
          <label style={S.lbl}>Interest on loan (annual)</label>
          <input style={S.inp} inputMode="numeric" value={row.interest_on_loan || ''}
            onChange={e => onChange({ interest_on_loan: e.target.value.replace(/[^0-9]/g, '') })} />
        </div>
      </div>
      {isLetOut && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div>
            <label style={S.lbl}>Municipal taxes paid</label>
            <input style={S.inp} inputMode="numeric" value={row.municipal_taxes_paid || ''}
              onChange={e => onChange({ municipal_taxes_paid: e.target.value.replace(/[^0-9]/g, '') })} />
          </div>
          <div>
            <label style={S.lbl}>Pre-construction interest (this year's 1/5th)</label>
            <input style={S.inp} inputMode="numeric" value={row.pre_construction_interest || ''}
              onChange={e => onChange({ pre_construction_interest: e.target.value.replace(/[^0-9]/g, '') })} />
          </div>
        </div>
      )}
      {num(row.interest_on_loan) > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div>
            <label style={S.lbl}>Lender name</label>
            <input style={S.inp} value={row.lender_name || ''} onChange={e => onChange({ lender_name: e.target.value })} />
          </div>
          <div>
            <label style={S.lbl}>Lender PAN <span style={{ color: C.red }}>*</span></label>
            <input style={S.inp} value={row.lender_pan || ''} maxLength={10}
              onChange={e => onChange({ lender_pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onSave} disabled={busy} style={{ ...S.btnP, padding: '7px 16px', fontSize: 12, opacity: busy ? 0.6 : 1 }}>Save</button>
        {onDelete && <button onClick={onDelete} disabled={busy} style={{ ...S.btnO, padding: '7px 16px', fontSize: 12, color: C.red, opacity: busy ? 0.6 : 1 }}>Remove</button>}
      </div>
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
  const [rent, setRent] = useState('')
  const [pan, setPan] = useState('')
  const [pf, setPf] = useState(0)               // auto from the salary structure
  const [savedRegime, setSavedRegime] = useState<string | null>(null)
  const [switches, setSwitches] = useState(0)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  // §8.3 — 80D is two separate limits (self and parents), not one. sec_80d (the
  // old flat field) stays the fallback for a declaration that never touches
  // these; once any of these is used, they take over.
  const [d80dSelf, setD80dSelf] = useState('')
  const [d80dParents, setD80dParents] = useState('')
  const [d80dParentsSenior, setD80dParentsSenior] = useState(false)
  const [d80dPreventive, setD80dPreventive] = useState('')
  // §3, §8.5, §8.1 — collected but not shown before now: the engine already read
  // sec_80e and sec_24b, nothing ever let the employee type into them.
  const [d80e, setD80e] = useState('')
  const [d80eYear, setD80eYear] = useState('')   // first repayment year — the 8-year window
  const [d24b, setD24b] = useState('')            // superseded the moment a House Property row exists
  // §8.5 — the rest of Chapter VI-A.
  const [d80dd, setD80dd] = useState(''); const [d80ddSevere, setD80ddSevere] = useState(false)
  const [d80ddb, setD80ddb] = useState('')
  const [d80eeb, setD80eeb] = useState('')
  const [d80g, setD80g] = useState('')
  const [d80u, setD80u] = useState(''); const [d80uSevere, setD80uSevere] = useState(false)
  // §7 — income from other sources. 80TTA/80TTB is worked out from the savings
  // figure automatically (senior → 80TTB, everyone else → 80TTA) — no separate
  // toggle to get wrong.
  const [incSavings, setIncSavings] = useState('')
  const [incFd, setIncFd] = useState('')
  const [incDividend, setIncDividend] = useState('')
  const [incOther, setIncOther] = useState('')

  // §6 — house property. Kept as its own small table, not folded into the
  // declaration row: a person can have more than one property.
  const [hp, setHp] = useState<any[]>([])
  const [hpBusy, setHpBusy] = useState(false)
  // §15.2 / Form 12B — only relevant to a mid-year joiner, so it starts blank
  // and stays blank for everyone else.
  const [prevIncome, setPrevIncome] = useState('')
  const [prevTds, setPrevTds] = useState('')
  const [prevPf, setPrevPf] = useState('')
  const [prevPt, setPrevPt] = useState('')

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
        setRent(num(d.monthly_rent) ? String(num(d.monthly_rent)) : '')
        setPan(d.landlord_pan || '')
        setSwitches(num(d.regime_switches)); setLockedAt(d.regime_locked_at || null)
        setStatus(d.declaration_status || '')

        const s = (v: any) => (num(v) ? String(num(v)) : '')
        setD80dSelf(s(d.sec_80d_self)); setD80dParents(s(d.sec_80d_parents))
        setD80dParentsSenior(!!d.sec_80d_parents_senior); setD80dPreventive(s(d.sec_80d_preventive))
        // A declaration saved before granular 80D existed only has the flat total —
        // show it as "self" so it is not silently lost.
        if (!num(d.sec_80d_self) && !num(d.sec_80d_parents) && num(d.sec_80d)) setD80dSelf(s(d.sec_80d))
        setD80e(s(d.sec_80e)); setD80eYear(d.sec_80e_first_repayment_year ? String(d.sec_80e_first_repayment_year) : '')
        setD24b(s(d.sec_24b))
        setD80dd(s(d.sec_80dd)); setD80ddSevere(!!d.sec_80dd_severe)
        setD80ddb(s(d.sec_80ddb)); setD80eeb(s(d.sec_80eeb)); setD80g(s(d.sec_80g))
        setD80u(s(d.sec_80u)); setD80uSevere(!!d.sec_80u_severe)
        setIncSavings(s(d.income_interest_savings)); setIncFd(s(d.income_interest_fd))
        setIncDividend(s(d.income_dividend)); setIncOther(s(d.income_other))
      }

      const { data: hpRows } = await supabase.from('tds_house_property')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).order('created_at')
      setHp(hpRows || [])

      const { data: prev } = await supabase.from('tds_previous_employer')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
      if (prev) {
        setPrevIncome(num(prev.taxable_income) ? String(num(prev.taxable_income)) : '')
        setPrevTds(num(prev.tds_deducted) ? String(num(prev.tds_deducted)) : '')
        setPrevPf(num(prev.pf_deducted) ? String(num(prev.pf_deducted)) : '')
        setPrevPt(num(prev.professional_tax) ? String(num(prev.professional_tax)) : '')
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
  const d80dTotal = num(d80dSelf) + Math.min(num(d80dParents) + num(d80dPreventive), 999999999)
  const totalDeclared = regime === 'NEW' ? 0
    : total80c + d80dTotal + num(d80e) + num(d24b) + num(d80dd) + num(d80ddb) + num(d80eeb) + num(d80g) + num(d80u)

  async function save(submit: boolean) {
    setErr(''); setMsg('')
    if (regimeBlocked) { setErr('Regime ab nahi badal sakta — ek baar badla ja chuka hai ya January nikal gayi.'); return }
    if (regime === 'OLD' && panMissing) { setErr('Landlord PAN zaroori hai — saal ka rent ₹1,00,000 se zyada hai.'); return }
    setBusy(true)
    const isNew = regime === 'NEW'
    const { error } = await supabase.rpc('save_investment_declaration', {
      p_employee_id: employeeId, p_fy: FY, p_regime: regime,
      // New regime declares nothing — send explicit zeros/nulls so a switch to NEW
      // clears the old figures rather than leaving them behind (NULL would keep
      // them, by design).
      p_sec_80c: isNew ? 0 : pf + typed80c,
      p_sec_80d: isNew ? 0 : num(d80dSelf),   // legacy flat fallback — granular below is what the engine actually prefers
      p_monthly_rent: isNew ? 0 : num(rent),
      p_landlord_pan: isNew ? null : (pan.trim() || null),
      p_hra_claimed: isNew ? 0 : annualRent,
      p_submit: submit,
      p_sec_80e: isNew ? 0 : num(d80e), p_sec_24b: isNew ? 0 : num(d24b),
      p_sec_80d_self: isNew ? 0 : num(d80dSelf), p_sec_80d_parents: isNew ? 0 : num(d80dParents),
      p_sec_80d_parents_senior: isNew ? false : d80dParentsSenior, p_sec_80d_preventive: isNew ? 0 : num(d80dPreventive),
      p_sec_80dd: isNew ? 0 : num(d80dd), p_sec_80dd_severe: isNew ? false : d80ddSevere,
      p_sec_80ddb: isNew ? 0 : num(d80ddb), p_sec_80eeb: isNew ? 0 : num(d80eeb), p_sec_80g: isNew ? 0 : num(d80g),
      p_sec_80u: isNew ? 0 : num(d80u), p_sec_80u_severe: isNew ? false : d80uSevere,
      p_sec_80e_first_repayment_year: isNew ? null : (Number(d80eYear) || null),
      p_income_interest_savings: num(incSavings), p_income_interest_fd: num(incFd),
      p_income_dividend: num(incDividend), p_income_other: num(incOther),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(submit ? 'Declaration submit ho gayi. Har month ka TDS ab isi se banega.' : 'Draft save ho gaya.')
    load()
  }

  async function saveHouseProperty(row: any) {
    setHpBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_house_property', {
      p_id: row.id || null, p_employee_id: employeeId, p_fy: FY,
      p_occupancy_type: row.occupancy_type, p_address: row.address || null,
      p_annual_rent_received: num(row.annual_rent_received), p_municipal_taxes_paid: num(row.municipal_taxes_paid),
      p_interest_on_loan: num(row.interest_on_loan), p_pre_construction_interest: num(row.pre_construction_interest),
      p_lender_name: row.lender_name || null, p_lender_pan: row.lender_pan || null,
      p_lender_address: row.lender_address || null, p_co_owner_share_pct: row.co_owner_share_pct ? num(row.co_owner_share_pct) : null,
    })
    setHpBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('Property save ho gayi.')
    load()
  }
  async function deleteHouseProperty(id: string) {
    setHpBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_house_property', { p_id: id, p_employee_id: employeeId, p_delete: true })
    setHpBusy(false)
    if (error) { setErr(error.message); return }
    load()
  }
  async function savePreviousEmployer() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_previous_employer', {
      p_employee_id: employeeId, p_fy: FY,
      p_taxable_income: num(prevIncome), p_tds_deducted: num(prevTds),
      p_pf_deducted: num(prevPf), p_professional_tax: num(prevPt),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('Previous employer details save ho gaye.')
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
          <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 10, padding: '9px 12px', marginTop: 10 }}>
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
            <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 10, padding: '9px 12px', marginTop: 10 }}>
              80C ki legal limit {inr(CAP_80C)} hai — {inr(pf + typed80c)} likhne se exemption nahi badhegi. {inr(CAP_80C)} hi count hoga.
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>
            Section 80D (health insurance) <span style={{ color: C.muted, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>— self and parents are separate limits</span>
          </div>
          <AmountRow label="Self + spouse + children" hint="Cap ₹25,000 · ₹50,000 if you are 60+" value={d80dSelf} onChange={setD80dSelf} />
          <AmountRow label="Parents' premium" hint="Cap ₹25,000 · ₹50,000 if a parent is 60+" value={d80dParents} onChange={setD80dParents} />
          <div style={{ ...S.row, gridTemplateColumns: '1fr 200px' }}>
            <div style={{ fontSize: 12.5, color: C.navy }}>Parent(s) 60 or above?</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'end', fontSize: 12, color: C.muted }}>
              <input type="checkbox" checked={d80dParentsSenior} onChange={e => setD80dParentsSenior(e.target.checked)} /> Yes
            </label>
          </div>
          <AmountRow label="Preventive health check-up" hint="Within the limits above, cap ₹5,000" value={d80dPreventive} onChange={setD80dPreventive} />

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>Section 80E &amp; 24(b) — loan interest</div>
          <AmountRow label="Education loan interest (80E)" hint="No cap — but only for 8 years from first repayment" value={d80e} onChange={setD80e} />
          {num(d80e) > 0 && (
            <AmountRow label="First repayment year" hint="e.g. 2024 — the 8-year window is counted from here" value={d80eYear} onChange={setD80eYear} />
          )}
          <AmountRow label="Home loan interest (24(b))" hint={hp.length ? 'Ignored — a House Property entry below is used instead' : 'Cap ₹2,00,000 — self-occupied only'} value={d24b} onChange={setD24b} readOnly={hp.length > 0} />

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>The rest of Chapter VI-A</div>
          <AmountRow label="80DD — disabled dependant" hint="₹75,000 · ₹1,25,000 if severe" value={d80dd} onChange={setD80dd} />
          <div style={{ ...S.row, gridTemplateColumns: '1fr 200px' }}>
            <div style={{ fontSize: 12.5, color: C.navy }}>Severe disability (80DD)?</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'end', fontSize: 12, color: C.muted }}>
              <input type="checkbox" checked={d80ddSevere} onChange={e => setD80ddSevere(e.target.checked)} /> Yes
            </label>
          </div>
          <AmountRow label="80DDB — specified disease treatment" hint="₹40,000 · ₹1,00,000 if you are 60+" value={d80ddb} onChange={setD80ddb} />
          <AmountRow label="80EEB — electric vehicle loan interest" hint="Cap ₹1,50,000" value={d80eeb} onChange={setD80eeb} />
          <AmountRow label="80G — donations" hint="Only counted if HR has enabled donations in payroll" value={d80g} onChange={setD80g} />
          <AmountRow label="80U — your own disability" hint="₹75,000 · ₹1,25,000 if severe" value={d80u} onChange={setD80u} />
          <div style={{ ...S.row, gridTemplateColumns: '1fr 200px' }}>
            <div style={{ fontSize: 12.5, color: C.navy }}>Severe disability (80U)?</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'end', fontSize: 12, color: C.muted }}>
              <input type="checkbox" checked={d80uSevere} onChange={e => setD80uSevere(e.target.checked)} /> Yes
            </label>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 18, marginBottom: 2 }}>
            Income from other sources <span style={{ color: C.muted, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>(annual)</span>
          </div>
          <AmountRow label="Savings account interest" hint="80TTA/80TTB exemption is worked out from this automatically" value={incSavings} onChange={setIncSavings} />
          <AmountRow label="Fixed deposit interest" value={incFd} onChange={setIncFd} />
          <AmountRow label="Dividend" value={incDividend} onChange={setIncDividend} />
          <AmountRow label="Any other income" value={incOther} onChange={setIncOther} />

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
            <div style={{ fontSize: 13, fontWeight: 700 }}>Total declared — Chapter VI-A</div>
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

      {/* ── House property — regime-independent: a net gain is taxable either way,
          only the loss side differs (§6.5) ── */}
      <div style={S.card}>
        <div style={S.h}>House property</div>
        <div style={S.sub}>Ek se zyada property ho sakti hai. Self-occupied ka interest ₹2,00,000 tak, let-out ka poora interest allowed hai.</div>
        {hp.map((row, i) => (
          <HousePropertyRow key={row.id || i} row={row}
            onChange={patch => setHp(list => list.map((x, ix) => ix === i ? { ...x, ...patch } : x))}
            onSave={() => saveHouseProperty(hp[i])}
            onDelete={row.id ? () => deleteHouseProperty(row.id) : undefined}
            busy={hpBusy} />
        ))}
        <button onClick={() => setHp(list => [...list, { occupancy_type: 'SELF' }])} style={{ ...S.btnO, marginTop: hp.length ? 10 : 4 }}>+ Add property</button>
      </div>

      {/* ── Previous employer — Form 12B, mid-year joiners only ── */}
      <div style={S.card}>
        <div style={S.h}>Previous employer this financial year</div>
        <div style={S.sub}>Sirf tab bharein agar aap FY {FY} ke beech mein join hue hain aur pehle kahin aur kaam kar rahe the.</div>
        <AmountRow label="Taxable income there" value={prevIncome} onChange={setPrevIncome} />
        <AmountRow label="TDS already deducted" value={prevTds} onChange={setPrevTds} />
        <AmountRow label="PF deducted" hint="Record only — transfers via your own PF account" value={prevPf} onChange={setPrevPf} />
        <AmountRow label="Professional tax paid" hint="Record only" value={prevPt} onChange={setPrevPt} />
        <button onClick={savePreviousEmployer} disabled={busy} style={{ ...S.btnO, marginTop: 10, opacity: busy ? 0.6 : 1 }}>Save previous employer details</button>
      </div>

      <div style={{ fontSize: 12, color: C.muted, background: TK.sunken, borderRadius: 10, padding: '11px 13px', marginBottom: 14, lineHeight: 1.6 }}>Proof submission saal ke aakhir mein khulti hai — ya <b>turant, agar aap resign karte hain</b>, taaki aapke last working day se pehle verify ho sake. Jo declare kiya par prove nahi kiya, woh exempt nahi rahega.
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${TK.positiveTint}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>{err}</div>}

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
