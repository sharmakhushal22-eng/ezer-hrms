'use client'
// components/payroll/PayHeadCatalog.tsx — Pay Head reference catalog.
// Grouped standard pay heads (Earnings / Employee Deductions / Employer Contributions /
// Flexi), non-standard employment types, and statutory business rules.
// Source: EZER-PayHead-Section-Reference.md.
import { useState } from 'react'

const C = {
  bg: '#F5F3FF', navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#3C3489', border: '#E9E7F5', muted: '#6B7280',
  card: '#FFFFFF', green: '#059669', greenBg: '#ECFDF5', red: '#DC2626', redBg: '#FEF2F2', amber: '#B45309', amberBg: '#FFFBEB', purpleBg: '#EEEDFE',
}
const font = '"DM Sans","Segoe UI",sans-serif'

type Row = { label: string; type: string; rule: string; trigger?: string; tone?: 'earn' | 'ded' | 'employer' | 'net' | 'total' }

const EARNINGS: Row[] = [
  { label: 'Basic salary', type: 'Fixed earning', rule: '50% of fixed CTC ÷ 12', trigger: 'Code on Wages 2019', tone: 'earn' },
  { label: 'HRA', type: 'Fixed earning', rule: '50% of Basic (monthly)', trigger: 'Partly exempt (rent)', tone: 'earn' },
  { label: 'Conveyance allowance', type: 'Fixed earning', rule: '₹1,600 / month', trigger: 'Statutory limit', tone: 'earn' },
  { label: 'Medical allowance', type: 'Fixed earning', rule: 'Config-driven (optional)', tone: 'earn' },
  { label: 'Special allowance', type: 'Balancing', rule: 'CTC − all other components', trigger: 'Auto-calculated', tone: 'earn' },
  { label: 'Statutory bonus', type: 'Fixed earning', rule: '8.33% of min(Basic, ₹21,000)', trigger: 'Bonus Act 1965', tone: 'earn' },
  { label: 'Variable pay', type: 'Variable', rule: '% of CTC — grade-wise', trigger: 'PMS / config', tone: 'earn' },
  { label: 'Flexi reimbursement', type: 'Reimbursement', rule: 'Approved flexi claims this month', trigger: 'From flexi_claims', tone: 'earn' },
  { label: 'Gross earnings', type: 'Computed total', rule: 'SUM of all earning components', tone: 'total' },
]
const EE_DED: Row[] = [
  { label: 'Employee PF (EPF)', type: 'Statutory', rule: '12% of EPF wages (ceiling ₹15,000)', trigger: 'if PF applicable', tone: 'ded' },
  { label: 'Employee ESIC', type: 'Statutory', rule: '0.75% of gross', trigger: 'if gross ≤ ₹21,000/mo', tone: 'ded' },
  { label: 'Professional Tax (PT)', type: 'Statutory', rule: 'State slab — Haryana ₹200/mo', trigger: 'if PT applicable', tone: 'ded' },
  { label: 'Labour Welfare Fund (LWF)', type: 'Statutory', rule: 'State-wise — Haryana ₹25 (Jun & Dec)', trigger: 'if LWF applicable', tone: 'ded' },
  { label: 'TDS (monthly)', type: 'Statutory', rule: 'Old/New regime — projected annual ÷ 12', trigger: 'TDS engine', tone: 'ded' },
  { label: 'VPF (Voluntary PF)', type: 'Voluntary', rule: 'Employee-opted % of EPF wage', trigger: 'if opted (else hidden)', tone: 'ded' },
  { label: 'NPS deduction', type: 'Voluntary', rule: '10% of Basic (employee)', trigger: 'if enrolled (else hidden)', tone: 'ded' },
  { label: 'Loan EMI', type: 'Recovery', rule: 'Per loan schedule', trigger: 'if active loan (else hidden)', tone: 'ded' },
  { label: 'Total deductions', type: 'Computed total', rule: 'SUM of all deductions', tone: 'total' },
  { label: 'Net take-home', type: 'Computed', rule: 'Gross − total deductions', trigger: 'Credited to bank', tone: 'net' },
]
const EMPLOYER: Row[] = [
  { label: 'Employer PF', type: 'Employer', rule: '12% of EPF wages', trigger: 'Matched with employee PF', tone: 'employer' },
  { label: 'Employer ESIC', type: 'Employer', rule: '3.25% of gross', trigger: 'if gross ≤ ₹21,000', tone: 'employer' },
  { label: 'Gratuity provision', type: 'Accrual', rule: '4.81% of Basic', trigger: 'Accrual — not paid monthly', tone: 'employer' },
  { label: 'Total CTC (monthly)', type: 'Computed total', rule: 'Gross + employer contributions', trigger: 'Informational', tone: 'total' },
]
const FLEXI: { code: string; name: string; bill: string; regime: string; source: string }[] = [
  { code: 'PDA', name: 'Professional Dev. Allowance', bill: 'Yes', regime: 'Old only', source: 'Slab config' },
  { code: 'TEL', name: 'Telephone / WiFi', bill: 'Yes', regime: 'Both', source: 'Slab config' },
  { code: 'DEVICE', name: 'Device Leasing', bill: 'No (auto)', regime: 'Both', source: 'Slab config' },
  { code: 'LTA', name: 'Leave Travel Allowance', bill: 'Yes (travel)', regime: 'Both', source: '8.33% Basic × 2 / block' },
  { code: 'CAR', name: 'Car Lease', bill: 'No (perquisite)', regime: 'Both', source: 'Perq ₹10,000/mo taxable' },
  { code: 'DRIVER', name: 'Driver Allowance', bill: 'Yes', regime: 'Old only', source: 'Slab config' },
  { code: 'FUEL', name: 'Fuel Reimbursement', bill: 'Yes', regime: 'Old only', source: 'Slab config' },
  { code: 'MEAL', name: 'Meal Coupon (Zaggle)', bill: 'No (auto)', regime: 'Both', source: '₹2,200 / month' },
  { code: 'ATTIRE', name: 'Corporate Attire', bill: 'Yes', regime: 'Old only', source: 'Slab config' },
  { code: 'CHEDU', name: "Children's Education", bill: 'Yes (fee)', regime: 'Old only', source: '₹300 / child / mo' },
  { code: 'HOSTEL', name: 'Hostel Allowance', bill: 'Yes', regime: 'Old only', source: '₹300 / child / mo' },
]
const NONSTD: { type: string; icon: string; heads: [string, string][] }[] = [
  { type: 'Intern / NAPS / NATS', icon: '🎓', heads: [['Stipend', 'Monthly fixed — no PF / ESIC / PT'], ['TDS on stipend', '@10% Sec 194J if annual > ₹2.5L']] },
  { type: 'Consultant', icon: '💼', heads: [['Professional fees', 'Monthly fixed'], ['GST', "18% — consultant's liability"], ['TDS', '@10% Sec 194J']] },
  { type: 'Contract worker', icon: '🛠️', heads: [['Wages', 'Monthly'], ['Employee PF', '12% — mandatory'], ['Employer PF', '12% — mandatory'], ['ESIC', 'If gross ≤ ₹21,000']] },
]
const RULES: string[] = [
  'Basic ≥ 50% of fixed CTC — Code on Wages 2019. System warns if Basic < 50%.',
  'EPF ceiling = ₹15,000 (default). If epf_wage_limit = 0, use actual basic (uncapped).',
  'ESIC auto-check — applies if gross ≤ ₹21,000; stops from the month gross crosses ₹21,000.',
  'Flexi balance = Annual limit − SUM(approved claims only). Rejected claims never reduce the limit.',
  'Rejected flexi is flagged separately and is never deducted from the employee limit.',
  'Statutory bonus — 8.33% capped at ₹21,000 basis per Bonus Act 1965.',
  'LWF — deducted only in June & December (bi-annual) in Haryana.',
  'TDS — monthly estimate on projected annual income; trued-up in March.',
]

function toneColor(t?: Row['tone']) {
  if (t === 'total') return { bg: '#F5F3FF', color: C.purple }
  if (t === 'net') return { bg: C.greenBg, color: C.green }
  return { bg: 'transparent', color: C.navy }
}
function TypeBadge({ t }: { t: string }) {
  const map: Record<string, [string, string]> = {
    'Fixed earning': [C.greenBg, C.green], 'Balancing': ['#FEF9C3', '#854D0E'], 'Variable': ['#FFF7ED', '#C2410C'],
    'Reimbursement': [C.purpleBg, C.purpleDark], 'Statutory': [C.redBg, C.red], 'Voluntary': ['#EFF6FF', '#1D4ED8'],
    'Recovery': ['#FEF2F2', '#B91C1C'], 'Employer': [C.purpleBg, C.purpleDark], 'Accrual': ['#F0FDFA', '#0F766E'],
    'Computed total': ['#F1F5F9', '#475569'], 'Computed': ['#F1F5F9', '#475569'],
  }
  const [bg, color] = map[t] || ['#F1F5F9', '#475569']
  return <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr style={{ background: C.bg }}>
          {['Pay Head', 'Type', 'Calculation / Rule', 'Trigger'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(r => { const tc = toneColor(r.tone); return (
            <tr key={r.label} style={{ borderTop: `1px solid ${C.border}`, background: tc.bg }}>
              <td style={{ padding: '9px 12px', fontWeight: r.tone === 'total' || r.tone === 'net' ? 700 : 600, color: tc.color }}>{r.label}</td>
              <td style={{ padding: '9px 12px' }}><TypeBadge t={r.type} /></td>
              <td style={{ padding: '9px 12px', color: '#475569' }}>{r.rule}</td>
              <td style={{ padding: '9px 12px', color: C.muted, fontSize: 11.5 }}>{r.trigger || '—'}</td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  )
}

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(124,58,237,0.06)' }
function GroupCard({ title, icon, subtitle, children }: { title: string; icon: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{title}</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>· {subtitle}</span>
      </div>
      {children}
    </div>
  )
}

export default function PayHeadCatalog() {
  const [view, setView] = useState<'catalog' | 'flexi' | 'nonstd' | 'rules'>('catalog')
  const TABS: [typeof view, string][] = [['catalog', '📋 Standard Pay Heads'], ['flexi', '🎛️ Flexi / FBP'], ['nonstd', '👥 Non-standard Types'], ['rules', '⚖️ Business Rules']]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: '7px 13px', borderRadius: 99, border: `1px solid ${view === id ? C.purple : C.border}`, background: view === id ? C.purple : '#fff', color: view === id ? '#fff' : C.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font }}>{label}</button>
        ))}
      </div>

      {view === 'catalog' && <>
        <GroupCard title="Earnings" icon="💰" subtitle="salary_structures — fixed & computed earnings"><Table rows={EARNINGS} /></GroupCard>
        <GroupCard title="Employee Deductions" icon="➖" subtitle="payroll_lines — statutory & voluntary"><Table rows={EE_DED} /></GroupCard>
        <GroupCard title="Employer Contributions" icon="🏢" subtitle="employer cost — not on payslip by default"><Table rows={EMPLOYER} /></GroupCard>
      </>}

      {view === 'flexi' && (
        <GroupCard title="Flexi / FBP Components" icon="🎛️" subtitle="declared at FY start, claimed monthly via bills — 11 components">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: C.bg }}>{['Code', 'Component', 'Bill required?', 'Regime', 'Annual limit source'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {FLEXI.map(f => (
                  <tr key={f.code} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: C.purpleBg, color: C.purpleDark }}>{f.code}</span></td>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: C.navy }}>{f.name}</td>
                    <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 11, color: f.bill.startsWith('No') ? C.green : C.amber }}>{f.bill}</span></td>
                    <td style={{ padding: '9px 12px', color: '#475569' }}>{f.regime}</td>
                    <td style={{ padding: '9px 12px', color: C.muted, fontSize: 11.5 }}>{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', fontSize: 11.5, color: C.muted, borderTop: `1px solid ${C.border}` }}>Balance = annual limit − SUM(approved claims). Rejected claims never reduce the limit. Configure slabs in <b>Flexi Policy</b>; approve bills in <b>Flexi Claims</b>.</div>
        </GroupCard>
      )}

      {view === 'nonstd' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {NONSTD.map(g => (
            <div key={g.type} style={card}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontWeight: 700, color: C.navy }}>{g.icon} {g.type}</div>
              <div style={{ padding: '6px 16px 14px' }}>
                {g.heads.map(([h, rule]) => (
                  <div key={h} style={{ padding: '9px 0', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>{h}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{rule}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'rules' && (
        <GroupCard title="Statutory Business Rules" icon="⚖️" subtitle="applied by the payroll engine">
          <div style={{ padding: '8px 16px 14px' }}>
            {RULES.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: i < RULES.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ width: 22, height: 22, borderRadius: 99, background: C.purpleBg, color: C.purpleDark, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.55 }}>{r}</span>
              </div>
            ))}
          </div>
        </GroupCard>
      )}
    </div>
  )
}
