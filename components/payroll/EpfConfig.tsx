'use client'
// components/payroll/EpfConfig.tsx — Payroll → Configuration → EPF.
// EPF reference (contribution split, EPS cap, EDLI/Admin charges, reduced rate) from
// epf_config (migrations sql76 + sql77) + a live contribution calculator (domestic +
// International Worker) and an EDLI/Admin charges estimate. calculate_epf_contribution /
// calculate_epf_charges are pure (no writes), so calling them here is safe. Inline in config.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentEpfConfig, calculateEpfContribution, calculateEpfCharges } from '@/lib/epf/actions'
import type { EpfConfig as EpfCfg, EpfCalculationResult, EpfChargesResult } from '@/lib/epf/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: '#BBF7D0', amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint, gray: TK.sunken,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: TK.sunken, color: C.navy, width: '100%' }
const lbl: React.CSSProperties = { fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }

function InfoTile({ icon, label, value, hint, accent }: { icon: string; label: string; value: string; hint?: string; accent?: string }) {
  const a = accent || C.purpleD
  return (
    <div style={{ background: '#fff', borderRadius: 11, padding: '12px 13px', border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(124,58,237,0.05)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: a }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.navy, lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  )
}
function GroupCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>{children}</div>
    </div>
  )
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        padding: '6px 12px', borderRadius: 99, fontFamily: font,
        border: `1.5px solid ${checked ? C.purple : C.border}`,
        background: checked ? C.purpleBg : '#fff', color: checked ? C.purpleD : C.muted,
        transition: 'all .12s',
      }}>
      <span style={{ fontSize: 11 }}>{checked ? '' : '＋'}</span>{label}
    </button>
  )
}

// Segmented bar visualising the employer's total split into EPS (pension) + EPF-proper.
function SplitBar({ eps, epf }: { eps: number; epf: number }) {
  const total = eps + epf || 1
  const epsPct = Math.round((eps / total) * 100)
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', height: 22, borderRadius: 7, overflow: 'hidden', border: `1px solid ${C.greenBd}` }}>
        <div style={{ width: `${epsPct}%`, background: 'linear-gradient(90deg,#0891B2,#0EA5B7)', minWidth: eps > 0 ? 2 : 0 }} title={`EPS ₹${eps}`} />
        <div style={{ flex: 1, background: 'linear-gradient(90deg,#7C3AED,#5B21B6)' }} title={`EPF ₹${epf}`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, fontWeight: 700, color: C.muted, marginTop: 4 }}>
        <span style={{ color: '#0891B2' }}>EPS (pension) {epsPct}%</span>
        <span style={{ color: C.purpleD }}>EPF-proper {100 - epsPct}% ■</span>
      </div>
    </div>
  )
}

export default function EpfConfig() {
  const [cfg, setCfg] = useState<EpfCfg | null>(null)
  const [error, setError] = useState('')

  const [gross, setGross] = useState('30000')
  const [hra, setHra] = useState('0')
  const [limit, setLimit] = useState('999999999')
  const [reduced, setReduced] = useState(false)
  const [isIw, setIsIw] = useState(false)
  const [hasCoc, setHasCoc] = useState(false)
  const [result, setResult] = useState<EpfCalculationResult | null>(null)

  const [paidDays, setPaidDays] = useState('30')
  const [daysInMonth, setDaysInMonth] = useState('30')
  const [hasMembers, setHasMembers] = useState(true)
  const [charges, setCharges] = useState<EpfChargesResult | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const c = await getCurrentEpfConfig()
      if (!c) setError('No EPF config found — run sql76 + sql77 first.')
      setCfg(c)
    } catch (e: any) { setError(e.message || 'Could not load — run sql76 + sql77 first.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function runCalc() {
    try {
      setResult(await calculateEpfContribution({
        grossWage: Number(gross), hra: Number(hra), pfGrossLimit: Number(limit),
        useReducedRate: reduced, isInternationalWorker: isIw, hasCertificateOfCoverage: isIw && hasCoc,
      }))
    } catch (e: any) { setError(e.message) }
  }
  async function runCharges() {
    try {
      setCharges(await calculateEpfCharges({ paidDays: Number(paidDays), daysInMonth: Number(daysInMonth), hasContributingMembers: hasMembers }))
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>EPF</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Provident Fund — EPF Wages = Gross − HRA, capped at each employee&apos;s PF limit</div>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      {cfg && (
        <>
          <GroupCard title="Contribution split">
            <InfoTile icon="🧑‍💼" label="Employee" value={`${cfg.employee_contribution_percent}%`} accent={TK.brand} />
            <InfoTile icon="🏢" label="Employer" value={`${cfg.employer_contribution_percent}%`} accent={TK.brand} />
            <InfoTile icon="👵" label="EPS (pension)" value={`${cfg.eps_percent}%`} hint={`capped at ${inr(cfg.eps_max_amount)}`} accent="#0891B2" />
            <InfoTile icon="📉" label="Reduced rate" value={`${cfg.reduced_rate_percent}%`} hint={`under ${cfg.reduced_rate_headcount_threshold} employees`} accent={TK.warning} />
          </GroupCard>

          <GroupCard title="Employer charges (on ₹15,000 base, pro-rated)">
            <InfoTile icon="🛡️" label="EDLI" value={`${cfg.edli_percent}%`} hint={`max ${inr(cfg.edli_max_amount)}/mo`} accent={TK.positive} />
            <InfoTile icon="🧾" label="Admin charges" value={`${cfg.admin_charges_percent}%`} hint={`min ${inr(cfg.admin_charges_minimum)} (${inr(cfg.admin_charges_minimum_no_members)} if nil)`} accent={TK.positive} />
            <InfoTile icon="🌏" label="IW-1 return" value={`${cfg.iw_return_due_days} days`} hint="after month-end" accent="#0891B2" />
          </GroupCard>

          {/* Contribution calculator */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Contribution calculator</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div><label style={lbl}>Gross (₹/mo)</label><input type="number" value={gross} onChange={e => setGross(e.target.value)} style={inputStyle} /></div>
              <div><label style={lbl}>HRA (₹/mo)</label><input type="number" value={hra} onChange={e => setHra(e.target.value)} style={inputStyle} /></div>
              <div><label style={lbl}>PF limit</label>
                <select value={limit} onChange={e => setLimit(e.target.value)} style={inputStyle}>
                  <option value="15000">₹15,000 (capped)</option>
                  <option value="999999999">Actual (uncapped)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
              <Toggle checked={reduced} onChange={setReduced} label="Reduced 10% rate" />
              <Toggle checked={isIw} onChange={v => { setIsIw(v); if (!v) setHasCoc(false) }} label="International Worker" />
              {isIw && <Toggle checked={hasCoc} onChange={setHasCoc} label="Has Certificate of Coverage (excluded)" />}
            </div>
            <button onClick={runCalc}
              style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 3px 10px rgba(124,58,237,0.22)', marginBottom: result ? 12 : 0 }}>
              Calculate
            </button>

            {result && (result.is_excluded_employee ? (
              <div style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 11, padding: '13px 15px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: TK.faint, borderRadius: 99, padding: '3px 11px', textTransform: 'uppercase' }}>Excluded employee</span>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>COC-holding International Worker — zero EPF applies in India.</div>
              </div>
            ) : (
              <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>EPF wages: <strong style={{ color: C.navy, fontSize: 13 }}>{inr(result.epf_wages)}</strong>{isIw && <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '2px 8px' }}>IW · full gross, no cap</span>}</div>
                <div style={{ display: 'flex', gap: 0, background: '#fff', borderRadius: 9, border: `1px solid ${C.greenBd}`, overflow: 'hidden', flexWrap: 'wrap' }}>
                  {[
                    ['Employee', result.employee_contribution, C.navy],
                    ['Employer EPS', result.employer_eps_contribution, '#0891B2'],
                    ['Employer EPF', result.employer_epf_contribution, C.purpleD],
                    ['Employer total', result.employer_total_contribution, C.navy],
                  ].map(([l, v, col], i) => (
                    <div key={l as string} style={{ flex: 1, minWidth: 120, padding: '10px 13px', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none', background: i === 3 ? C.purpleBg : '#fff' }}>
                      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, marginBottom: 3 }}>{l as string}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: col as string }}>{inr(v as number)}</div>
                    </div>
                  ))}
                </div>
                <SplitBar eps={result.employer_eps_contribution} epf={result.employer_epf_contribution} />
              </div>
            ))}
          </div>

          {/* EDLI + Admin charges (establishment) */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>EDLI + Admin charges</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 12 }}>Establishment-level (employer only) — on ₹15,000 base, pro-rated by paid days.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <div style={{ width: 110 }}><label style={lbl}>Paid days</label><input type="number" value={paidDays} onChange={e => setPaidDays(e.target.value)} style={inputStyle} /></div>
              <div style={{ width: 120 }}><label style={lbl}>Days in month</label><input type="number" value={daysInMonth} onChange={e => setDaysInMonth(e.target.value)} style={inputStyle} /></div>
              <div style={{ marginBottom: 9 }}><Toggle checked={hasMembers} onChange={setHasMembers} label="Has contributing members" /></div>
              <button onClick={runCharges} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.purple}`, background: '#fff', color: C.purpleD, fontWeight: 700, fontSize: 12, cursor: 'pointer', marginBottom: 2 }}>Estimate</button>
            </div>
            {charges && (
              <div style={{ display: 'flex', gap: 0, background: C.gray, borderRadius: 9, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                {[['Pro-rated base', charges.prorated_base], ['EDLI', charges.edli_charge], ['Admin', charges.admin_charge]].map(([l, v], i) => (
                  <div key={l as string} style={{ flex: 1, padding: '10px 14px', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                    <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, marginBottom: 3 }}>{l as string}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{inr(v as number)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
