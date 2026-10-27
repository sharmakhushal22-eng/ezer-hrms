'use client'
// components/payroll/PayHeadCatalog.tsx — Pay Head reference catalog.
// Grouped standard pay heads (Earnings / Employee Deductions / Employer Contributions /
// Flexi), non-standard employment types, and statutory business rules.
// Source: EZER-PayHead-Section-Reference.md.
import { useState } from 'react'
import SubSectionDropdown from '@/components/payroll/SubSectionDropdown'
import { C, F, W, S, numeric, IconFinance, IconReceipt, IconBuilding, IconSliders, IconEmployees, IconPolicies } from '@/lib/ui'
import { SectionCard, StatusPill, CountChip, DataTable, dt, IconInfo, type KitTone } from '@/components/payroll/kit'

type Row = { label: string; type: string; rule: string; trigger?: string; tone?: 'earn' | 'ded' | 'employer' | 'net' | 'total' }

const EARNINGS: Row[] = [
  { label: 'Basic salary', type: 'Fixed earning', rule: '50% of fixed CTC ÷ 12', trigger: 'Code on Wages 2019', tone: 'earn' },
  { label: 'HRA', type: 'Fixed earning', rule: '50% of Basic (monthly)', trigger: 'Partly exempt (rent)', tone: 'earn' },
  { label: 'Conveyance allowance', type: 'Fixed earning', rule: '₹1,600 / month', trigger: 'Statutory limit', tone: 'earn' },
  { label: 'Medical allowance', type: 'Fixed earning', rule: 'Config-driven (optional)', tone: 'earn' },
  { label: 'Special allowance', type: 'Balancing', rule: 'CTC − all other components', trigger: 'Auto-calculated', tone: 'earn' },
  { label: 'Statutory bonus', type: 'Fixed earning', rule: '8.33% of min(Basic, ₹21,000)', trigger: 'Bonus Act 1965', tone: 'earn' },
  { label: 'Variable pay', type: 'Variable', rule: '% of CTC, grade-wise', trigger: 'PMS / config', tone: 'earn' },
  { label: 'Flexi reimbursement', type: 'Reimbursement', rule: 'Approved flexi claims this month', trigger: 'From flexi_claims', tone: 'earn' },
  { label: 'Gross earnings', type: 'Computed total', rule: 'SUM of all earning components', tone: 'total' },
]
const EE_DED: Row[] = [
  { label: 'Employee PF (EPF)', type: 'Statutory', rule: '12% of EPF wages (ceiling ₹15,000)', trigger: 'if PF applicable', tone: 'ded' },
  { label: 'Employee ESIC', type: 'Statutory', rule: '0.75% of gross', trigger: 'if gross ≤ ₹21,000/mo', tone: 'ded' },
  { label: 'Professional Tax (PT)', type: 'Statutory', rule: 'State slab: Haryana ₹200/mo', trigger: 'if PT applicable', tone: 'ded' },
  { label: 'Labour Welfare Fund (LWF)', type: 'Statutory', rule: 'State-wise: Haryana ₹25 (Jun & Dec)', trigger: 'if LWF applicable', tone: 'ded' },
  { label: 'TDS (monthly)', type: 'Statutory', rule: 'Old/New regime: projected annual ÷ 12', trigger: 'TDS engine', tone: 'ded' },
  { label: 'VPF (Voluntary PF)', type: 'Voluntary', rule: 'Employee-opted % of EPF wage', trigger: 'if opted (else hidden)', tone: 'ded' },
  { label: 'NPS deduction', type: 'Voluntary', rule: '10% of Basic (employee)', trigger: 'if enrolled (else hidden)', tone: 'ded' },
  { label: 'Loan EMI', type: 'Recovery', rule: 'Per loan schedule', trigger: 'if active loan (else hidden)', tone: 'ded' },
  { label: 'Total deductions', type: 'Computed total', rule: 'SUM of all deductions', tone: 'total' },
  { label: 'Net take-home', type: 'Computed', rule: 'Gross − total deductions', trigger: 'Credited to bank', tone: 'net' },
]
const EMPLOYER: Row[] = [
  { label: 'Employer PF', type: 'Employer', rule: '12% of EPF wages', trigger: 'Matched with employee PF', tone: 'employer' },
  { label: 'Employer ESIC', type: 'Employer', rule: '3.25% of gross', trigger: 'if gross ≤ ₹21,000', tone: 'employer' },
  { label: 'Gratuity provision', type: 'Accrual', rule: '4.81% of Basic', trigger: 'Accrual, not paid monthly', tone: 'employer' },
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
  { type: 'Intern / NAPS / NATS', icon: '', heads: [['Stipend', 'Monthly fixed, no PF / ESIC / PT'], ['TDS on stipend', '@10% Sec 194J if annual > ₹2.5L']] },
  { type: 'Consultant', icon: '', heads: [['Professional fees', 'Monthly fixed'], ['GST', "18%, consultant's liability"], ['TDS', '@10% Sec 194J']] },
  { type: 'Contract worker', icon: '', heads: [['Wages', 'Monthly'], ['Employee PF', '12%, mandatory'], ['Employer PF', '12%, mandatory'], ['ESIC', 'If gross ≤ ₹21,000']] },
]
const RULES: string[] = [
  'Basic ≥ 50% of fixed CTC (Code on Wages 2019). System warns if Basic < 50%.',
  'EPF ceiling = ₹15,000 (default). If epf_wage_limit = 0, use actual basic (uncapped).',
  'ESIC auto-check: applies if gross ≤ ₹21,000; stops from the month gross crosses ₹21,000.',
  'Flexi balance = Annual limit − SUM(approved claims only). Rejected claims never reduce the limit.',
  'Rejected flexi is flagged separately and is never deducted from the employee limit.',
  'Statutory bonus: 8.33% capped at ₹21,000 basis per Bonus Act 1965.',
  'LWF: deducted only in June & December (bi-annual) in Haryana.',
  'TDS: monthly estimate on projected annual income; trued-up in March.',
]

function toneColor(t?: Row['tone']): { bg?: string; color: string } {
  if (t === 'total') return { bg: C.sunken, color: C.brandDeep }
  if (t === 'net') return { bg: C.positiveTint, color: C.positive }
  return { bg: undefined, color: C.ink }
}
const TYPE_TONE: Record<string, KitTone> = {
  'Fixed earning': 'positive', 'Balancing': 'warning', 'Variable': 'warning',
  'Reimbursement': 'brand', 'Statutory': 'critical', 'Voluntary': 'info',
  'Recovery': 'critical', 'Employer': 'brand', 'Accrual': 'info',
  'Computed total': 'neutral', 'Computed': 'neutral',
}
function TypeBadge({ t }: { t: string }) {
  return <StatusPill t={TYPE_TONE[t] || 'neutral'} size="sm">{t}</StatusPill>
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <DataTable minWidth={640}>
      <thead><tr>
        {['Pay Head', 'Type', 'Calculation / Rule', 'Trigger'].map(h => <th key={h} style={dt.th}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map(r => { const tc = toneColor(r.tone); const strong = r.tone === 'total' || r.tone === 'net'; return (
          <tr key={r.label} className={strong ? undefined : dt.rowClass} style={{ background: tc.bg }}>
            <td style={{ ...dt.td, fontWeight: strong ? W.bold : W.semi, color: tc.color, whiteSpace: 'nowrap' }}>{r.label}</td>
            <td style={dt.td}><TypeBadge t={r.type} /></td>
            <td style={{ ...dt.td, color: strong ? C.ink : C.inkSoft, ...numeric }}>{r.rule}</td>
            <td style={{ ...dt.td, color: C.muted, fontSize: F.tiny }}>{r.trigger || '-'}</td>
          </tr>
        )})}
      </tbody>
    </DataTable>
  )
}

function GroupCard({ title, icon, subtitle, count, children, iconTone }: { title: string; icon: React.ReactNode; subtitle: string; count?: number; children: React.ReactNode; iconTone?: KitTone }) {
  return (
    <SectionCard flush title={title} icon={icon} iconTone={iconTone} hint={subtitle}
      actions={count != null ? <CountChip>{count} heads</CountChip> : undefined}>
      {children}
    </SectionCard>
  )
}

export default function PayHeadCatalog({ view: viewProp }: { view?: string } = {}) {
  const [viewState, setViewState] = useState<'catalog' | 'flexi' | 'nonstd' | 'rules'>('catalog')
  // Controlled when a `view` prop is passed (selection handled by the Configuration dropdown);
  // uncontrolled fallback keeps its own dropdown.
  const view = (viewProp as 'catalog' | 'flexi' | 'nonstd' | 'rules') || viewState
  const TABS: [typeof view, string][] = [['catalog', 'Standard Pay Heads'], ['flexi', 'Flexi / FBP'], ['nonstd', 'Non-standard Types'], ['rules', 'Business Rules']]

  return (
    <div style={{ fontFamily: F.family, color: C.ink, minWidth: 0 }}>
      {!viewProp && <SubSectionDropdown items={TABS.map(([id, label]) => ({ id, label }))} active={view} onChange={id => setViewState(id as typeof view)} kicker="Pay Heads view" />}

      {view === 'catalog' && <>
        <GroupCard title="Earnings" icon={<IconFinance size={16} />} iconTone="positive" subtitle="salary_structures: fixed & computed earnings" count={EARNINGS.length}><Table rows={EARNINGS} /></GroupCard>
        <GroupCard title="Employee Deductions" icon={<IconReceipt size={16} />} iconTone="critical" subtitle="payroll_lines: statutory & voluntary" count={EE_DED.length}><Table rows={EE_DED} /></GroupCard>
        <GroupCard title="Employer Contributions" icon={<IconBuilding size={16} />} subtitle="employer cost, not on payslip by default" count={EMPLOYER.length}><Table rows={EMPLOYER} /></GroupCard>
      </>}

      {view === 'flexi' && (
        <GroupCard title="Flexi / FBP Components" icon={<IconSliders size={16} />} subtitle="declared at FY start, claimed monthly via bills (11 components)">
          <DataTable minWidth={640}>
            <thead><tr>{['Code', 'Component', 'Bill required?', 'Regime', 'Annual limit source'].map(h => <th key={h} style={dt.th}>{h}</th>)}</tr></thead>
            <tbody>
              {FLEXI.map(f => (
                <tr key={f.code} className={dt.rowClass}>
                  <td style={dt.td}><StatusPill t="brand" size="sm">{f.code}</StatusPill></td>
                  <td style={dt.tdStrong}>{f.name}</td>
                  <td style={dt.td}><StatusPill t={f.bill.startsWith('No') ? 'positive' : 'warning'} size="sm" dot>{f.bill}</StatusPill></td>
                  <td style={dt.td}>{f.regime}</td>
                  <td style={{ ...dt.td, color: C.muted, fontSize: F.tiny, ...numeric }}>{f.source}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: `${S.md}px ${S.lg}px`, fontSize: F.tiny, color: C.inkSoft, background: C.sunken, lineHeight: 1.55 }}>
            <span style={{ display: 'inline-flex', color: C.muted, marginTop: 2 }}><IconInfo size={13} /></span>
            <span>Balance = annual limit − SUM(approved claims). Rejected claims never reduce the limit. Configure slabs in <b>Flexi Policy</b>; approve bills in <b>Flexi Claims</b>.</span>
          </div>
        </GroupCard>
      )}

      {view === 'nonstd' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: S.lg }}>
          {NONSTD.map(g => (
            <SectionCard key={g.type} title={<>{g.icon}{g.type}</>} icon={<IconEmployees size={16} />} style={{ marginBottom: 0 }}
              actions={<CountChip>{g.heads.length}</CountChip>} bodyStyle={{ padding: `4px ${S.lg}px ${S.sm}px` }}>
              {g.heads.map(([h, rule], i) => (
                <div key={h} style={{ padding: '10px 0', borderBottom: i < g.heads.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                  <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{h}</div>
                  <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, ...numeric }}>{rule}</div>
                </div>
              ))}
            </SectionCard>
          ))}
        </div>
      )}

      {view === 'rules' && (
        <GroupCard title="Statutory Business Rules" icon={<IconPolicies size={16} />} subtitle="applied by the payroll engine">
          <ol style={{ listStyle: 'none', margin: 0, padding: `${S.xs}px ${S.lg}px ${S.md}px` }}>
            {RULES.map((r, i) => (
              <li key={i} style={{ display: 'flex', gap: S.md, alignItems: 'flex-start', padding: '11px 0', borderBottom: i < RULES.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                <span style={{ width: 24, height: 24, borderRadius: 99, background: C.brandTint, color: C.brandDeep, border: `1px solid ${C.brandEdge}`, fontSize: F.micro, fontWeight: W.bold, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...numeric }}>{i + 1}</span>
                <span style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.6, paddingTop: 2, ...numeric }}>{r}</span>
              </li>
            ))}
          </ol>
        </GroupCard>
      )}
    </div>
  )
}
