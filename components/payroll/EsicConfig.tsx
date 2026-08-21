'use client'
// components/payroll/EsicConfig.tsx — Payroll → Configuration → ESIC.
// Employees' State Insurance reference (wage ceilings, contribution rates, low-wage
// exemption, registration/deposit deadlines) from esic_config (migration sql75) + a
// side-effect-free contribution estimator. The stateful coverage-continuity check
// (checkEsicApplicability) writes esic_coverage_tracking and is called from the payroll
// run, not this config screen. Inline in the config dropdown.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentEsicConfig } from '@/lib/esic/actions'
import type { EsicConfig as EsicCfg } from '@/lib/esic/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.violet, purpleD: TK.violetDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: '#BBF7D0', amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.violetTint, gray: TK.sunken,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

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

export default function EsicConfig() {
  const [cfg, setCfg] = useState<EsicCfg | null>(null)
  const [error, setError] = useState('')

  const [wage, setWage] = useState('18000')
  const [isPwd, setIsPwd] = useState(false)
  const [dailyAvg, setDailyAvg] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const c = await getCurrentEsicConfig()
      if (!c) setError('No ESIC config found — run sql75 first.')
      setCfg(c)
    } catch (e: any) { setError(e.message || 'Could not load — run sql75 first.') }
  }, [])
  useEffect(() => { load() }, [load])

  // Pure, side-effect-free single-month estimate (mirrors the RPC's rate logic;
  // the mid-period continuity rule is applied during the actual payroll run).
  const est = (() => {
    if (!cfg) return null
    const w = Number(wage) || 0
    const ceiling = isPwd ? Number(cfg.wage_ceiling_pwd) : Number(cfg.wage_ceiling)
    const covered = w > 0 && w <= ceiling
    const erPct = isPwd ? Number(cfg.employer_contribution_percent_pwd) : Number(cfg.employer_contribution_percent)
    let eePct = Number(cfg.employee_contribution_percent)
    const lowWaged = dailyAvg !== '' && Number(dailyAvg) <= Number(cfg.daily_wage_exemption_threshold)
    if (lowWaged) eePct = 0
    return {
      ceiling, covered, lowWaged,
      employee: covered ? Math.round(w * eePct / 100 * 100) / 100 : 0,
      employer: covered ? Math.round(w * erPct / 100 * 100) / 100 : 0,
    }
  })()

  const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: TK.sunken, color: C.navy }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 680 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>ESIC</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Employees&apos; State Insurance — wage ceiling, contributions &amp; mid-period coverage continuity</div>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      {cfg && (
        <>
          <GroupCard title="Contribution rates">
            <InfoTile icon="🧑‍💼" label="Employee share" value={`${cfg.employee_contribution_percent}%`} accent={TK.violet} />
            <InfoTile icon="🏢" label="Employer share" value={`${cfg.employer_contribution_percent}%`} accent={TK.violet} />
            <InfoTile icon="♿" label="Employer (PWD)" value={`${cfg.employer_contribution_percent_pwd}%`} hint="reduced rate" accent={TK.positive} />
            <InfoTile icon="🪙" label="Low-wage exemption" value={`≤ ₹${cfg.daily_wage_exemption_threshold}/day`} hint="employee share waived" accent={TK.warning} />
          </GroupCard>

          <GroupCard title="Coverage & deadlines">
            <InfoTile icon="📊" label="Wage ceiling" value={inr(cfg.wage_ceiling)} hint="standard" accent={TK.violet} />
            <InfoTile icon="♿" label="PWD ceiling" value={inr(cfg.wage_ceiling_pwd)} hint="persons with disability" accent={TK.positive} />
            <InfoTile icon="📝" label="New-employee registration" value={`${cfg.new_employee_registration_days} days`} hint="from joining" accent="#0891B2" />
            <InfoTile icon="🗓️" label="Monthly deposit due" value={`${cfg.monthly_deposit_due_day}th`} hint="of next month" accent="#0891B2" />
          </GroupCard>

          {/* Coverage-continuity note */}
          <div style={{ fontSize: 11, color: C.purpleD, background: C.purpleBg, borderRadius: 9, padding: '9px 12px', marginBottom: 16, lineHeight: 1.5 }}>
            <b>Coverage continuity:</b> once an employee is within the ceiling in any month of a 6-month contribution period (Apr–Sep / Oct–Mar), they stay covered for the rest of that period even if a raise pushes them above ₹{Number(cfg.wage_ceiling).toLocaleString('en-IN')}. This is applied automatically during the payroll run.
          </div>

          {/* Estimator */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Contribution estimate (single month)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Gross wage (₹/mo)</label>
                <input type="number" value={wage} onChange={e => setWage(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div style={{ minWidth: 150 }}>
                <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Avg daily wage (optional)</label>
                <input type="number" value={dailyAvg} onChange={e => setDailyAvg(e.target.value)} placeholder="for low-wage check" style={{ ...inputStyle, width: '100%' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.navy, cursor: 'pointer', marginTop: 16 }}>
                <input type="checkbox" checked={isPwd} onChange={e => setIsPwd(e.target.checked)} style={{ accentColor: C.purple }} />
                PWD
              </label>
            </div>

            {est && (
              <div style={{ background: est.covered ? C.greenBg : C.gray, border: `1px solid ${est.covered ? C.greenBd : C.border}`, borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: est.covered ? 12 : 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: est.covered ? C.green : TK.faint, borderRadius: 99, padding: '3px 11px', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                    {est.covered ? 'Covered' : 'Not covered'}
                  </span>
                  {!est.covered && <span style={{ fontSize: 11.5, color: C.muted }}>wage above {inr(est.ceiling)} ceiling</span>}
                  {est.lowWaged && est.covered && <span style={{ fontSize: 9.5, fontWeight: 700, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 99, padding: '2px 8px' }}>low-wage: employee share waived</span>}
                </div>
                {est.covered && (
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, background: '#fff', borderRadius: 9, border: `1px solid ${C.greenBd}`, overflow: 'hidden' }}>
                    {[
                      ['Employee', est.employee, C.navy],
                      ['Employer', est.employer, C.navy],
                      ['Total / month', est.employee + est.employer, C.purpleD],
                    ].map(([lbl, val, col], i) => (
                      <div key={lbl as string} style={{ flex: 1, padding: '10px 14px', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none', background: i === 2 ? C.purpleBg : '#fff' }}>
                        <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, marginBottom: 3 }}>{lbl as string}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: col as string }}>{inr(val as number)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>Estimate only — a first-month, no-history view. The payroll run uses the stateful check that also applies mid-period continuity.</div>
          </div>
        </>
      )}
    </div>
  )
}
