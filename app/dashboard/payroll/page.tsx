'use client'
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  loadCompanies, loadPayHeads, savePayHead, deletePayHead,
  loadRuns, createRun, advanceRun, cancelRun, loadAudit, loadRunRegister,
  loadRunSummary, buildNeftRows,
  loadPayrollEmployees, syncRunEmployees,
  MONTHS, RUN_FLOW, nextStatus,
  type PayHead, type PayrollRun, type PayrollEmployee, type RunSummary,
} from '@/lib/payroll/core'
import { calculateRun } from '@/lib/payroll/engine'
import PayHeadCatalog from '@/components/payroll/PayHeadCatalog'
import CompanyProfileView from '@/components/payroll/CompanyProfileView'

// ── Palette (guide-mandated) ──────────────────────────────────────
const C = {
  bg: '#F5F3FF', navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#3C3489',
  card: '#FFFFFF', border: '#E9E7F5', muted: '#6B6B7B',
  success: '#059669', amber: '#B45309', red: '#DC2626',
  font: '"DM Sans","Segoe UI",sans-serif',
}
const S = {
  page: { background: C.bg, minHeight: '100vh', padding: 20, color: C.navy, fontFamily: C.font, fontSize: 13 } as React.CSSProperties,
  content: { maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  card: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: '16px 18px', marginBottom: 14, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  label: { fontSize: 11, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 } as React.CSSProperties,
  input: { width: '100%', padding: '8px 11px', background: '#FAFAF8', border: `1px solid ${C.border}`, borderRadius: 8, color: C.navy, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: C.purple, color: '#fff', whiteSpace: 'nowrap' } as React.CSSProperties,
  btnOutline: { padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: C.purple, whiteSpace: 'nowrap' } as React.CSSProperties,
  btnDanger: { padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.red}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', background: '#fff', color: C.red } as React.CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, color: C.navy, margin: 0 } as React.CSSProperties,
  sub: { fontSize: 12, color: C.muted, marginTop: 2 } as React.CSSProperties,
  cardTitle: { fontSize: 14, fontWeight: 600, color: C.navy, marginBottom: 12 } as React.CSSProperties,
  note: { background: 'rgba(124,58,237,0.05)', border: `1px dashed ${C.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: C.muted } as React.CSSProperties,
}

const TABS: { id: string; label: string }[] = [
  { id: 'config', label: '🔧 Configuration' },
  { id: 'employees', label: '👥 Employees & CTC' },
  { id: 'run', label: '▶️ Payroll Run' },
  { id: 'statutory', label: '⚖️ Statutory & Tax' },
  { id: 'benefits', label: '🎁 Benefits & Loans' },
  { id: 'offcycle', label: '🔁 Off-cycle · Bonus · FNF' },
  { id: 'reports', label: '📊 Outputs & Reports' },
  { id: 'admin', label: '🛡️ Admin & Controls' },
]

// ── Small shared bits ─────────────────────────────────────────────
function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: bg, color, letterSpacing: '.03em' }}>{text}</span>
}

const HEAD_COLORS: Record<string, { bg: string; color: string }> = {
  EARNING: { bg: 'rgba(5,150,105,0.12)', color: C.success },
  DEDUCTION: { bg: 'rgba(220,38,38,0.12)', color: C.red },
  EMPLOYER: { bg: 'rgba(124,58,237,0.12)', color: C.purple },
  NON_SALARY: { bg: 'rgba(180,83,9,0.12)', color: C.amber },
}

function PlannedBadge() {
  return <Badge text="Planned" bg="rgba(107,107,123,0.14)" color={C.muted} />
}

// ══ Sub-tab framework (architecture per ezer_payroll_full_architecture_tabs) ══
interface SubTab {
  id: string; label: string; icon: string
  built?: boolean                 // green dot = shipped
  href?: string                   // built module that lives on another screen
  desc?: string                   // shown in built/planned panel
  points?: string[]               // feature bullets/chips
  render?: () => React.ReactNode   // inline functional module
  groupGlobal?: boolean            // true = not company-specific; hide the Group-mode company switcher
}

// Group-mode context passed down so company-specific sub-tabs can show a company switcher.
interface GroupScope { mode: boolean; companies: { id: string; company_name: string; group_name?: string | null }[]; active: string; onChange: (id: string) => void }

function SubTabHead({ title, subtitle, built, total }: { title: string; subtitle: string; built: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: C.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: C.success }} />{built} built</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: '#C9C7D6' }} />{total - built} planned</span>
      </div>
    </div>
  )
}

function SubTabBar({ subs, active, onChange }: { subs: SubTab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {subs.map(s => {
        const on = s.id === active
        return (
          <button key={s.id} onClick={() => onChange(s.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 99,
            border: `1px solid ${on ? C.purple : C.border}`, background: on ? C.purple : '#fff',
            color: on ? '#fff' : C.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: s.built ? (on ? '#fff' : C.success) : (on ? 'rgba(255,255,255,.55)' : '#C9C7D6') }} />
            <span>{s.icon}</span>{s.label}
          </button>
        )
      })}
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, justifyContent: 'center' }}>
      {items.map(p => (
        <span key={p} style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 99, background: 'rgba(124,58,237,0.06)', border: `1px solid ${C.border}`, color: C.purpleDark }}>{p}</span>
      ))}
    </div>
  )
}

function PlannedPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, textAlign: 'center', padding: '38px 24px' }}>
      <div style={{ width: 58, height: 58, borderRadius: 16, background: 'rgba(124,58,237,0.07)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px' }}>{s.icon}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>{s.label}</span>
        <PlannedBadge />
      </div>
      {s.desc && <div style={{ fontSize: 13, color: C.muted, maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>{s.desc}</div>}
      {s.points && <Chips items={s.points} />}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 16, opacity: 0.8 }}>On the payroll roadmap — structure ready, wiring next.</div>
    </div>
  )
}

function BuiltPanel({ s }: { s: SubTab }) {
  return (
    <div style={{ ...S.card, padding: '26px 24px' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(5,150,105,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{s.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>{s.label}</span>
            <Badge text="Built" bg="rgba(5,150,105,0.12)" color={C.success} />
          </div>
          {s.desc && <div style={{ fontSize: 13, color: C.muted, margin: '7px 0 0', lineHeight: 1.6 }}>{s.desc}</div>}
          {s.points && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>{s.points.map(p => <span key={p} style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 99, background: 'rgba(5,150,105,0.08)', color: C.success }}>{p}</span>)}</div>}
          {s.href && <div style={{ marginTop: 14 }}><a href={s.href} style={{ ...S.btnPrimary, display: 'inline-block', textDecoration: 'none' }}>Open →</a></div>}
        </div>
      </div>
    </div>
  )
}

function SubTabbed({ title, subtitle, subs, group }: { title: string; subtitle: string; subs: SubTab[]; group?: GroupScope }) {
  const [active, setActive] = useState(subs[0].id)
  const cur = subs.find(s => s.id === active) || subs[0]
  const built = subs.filter(s => s.built).length
  // Show the company switcher only in Group mode and only on company-specific sub-tabs.
  const showScope = group?.mode && !cur.groupGlobal && group.companies.length > 1
  return (
    <div>
      <SubTabHead title={title} subtitle={subtitle} built={built} total={subs.length} />
      <SubTabBar subs={subs} active={active} onChange={setActive} />
      {showScope && group && <GroupScopeBar companies={group.companies} active={group.active} onChange={group.onChange} />}
      {cur.render ? cur.render() : cur.built ? <BuiltPanel s={cur} /> : <PlannedPanel s={cur} />}
    </div>
  )
}

// ── Tab views: each main tab, split into architecture sub-modules ──
function ConfigView({ companyId, group }: { companyId: string; group?: GroupScope }) {
  return <SubTabbed group={group} title="Configuration" subtitle="Group setup, pay heads, statutory slabs & tax rules" subs={[
    { id: 'payheads', label: 'Pay Heads', icon: '🧾', built: true, render: () => (
      <div>
        <PayHeadCatalog />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', letterSpacing: '.04em', margin: '18px 0 10px' }}>Company custom pay heads</div>
        <ConfigTab companyId={companyId} />
      </div>
    ) },
    { id: 'group', label: 'Group & Company', icon: '🏢', built: true, groupGlobal: true, render: () => <CompanyProfileView /> },
    { id: 'fymonth', label: 'FY & Payroll Month', icon: '🗓️', desc: 'Define the financial year and open/close payroll months per company.' },
    { id: 'categories', label: 'Categories · Dept · Location', icon: '🗂️', built: true, href: '/dashboard/admin', desc: 'Departments, locations and employee categories are configured in Admin Setup.' },
    { id: 'perquisite', label: 'Perquisite', icon: '🚗', desc: 'Create taxable perquisites — car lease, ESOP, accommodation — with valuation rules.' },
    { id: 'bonus', label: 'Bonus Config', icon: '🎯', desc: 'Statutory & performance bonus rules, eligibility windows and payout schedule.' },
    { id: 'tax', label: 'Tax Config', icon: '🧮', desc: 'Old / new regime slabs, surcharge, cess and standard-deduction settings.' },
    { id: 'slabs', label: 'PT · LWF Slabs', icon: '⚖️', built: true, desc: 'State-wise Professional Tax and LWF slabs. The PT slab logic already powers the payroll engine; a slab editor UI is next.' },
    { id: 'minwages', label: 'Minimum Wages', icon: '📊', desc: 'State + skill-category minimum-wage master used for compliance checks during the payroll run.' },
  ]} />
}

function EmployeesView({ companyId, group }: { companyId: string; group?: GroupScope }) {
  return <SubTabbed group={group} title="Employees & CTC" subtitle="Payroll view of the workforce, CTC master and bank details" subs={[
    { id: 'master', label: 'Employee & CTC Master', icon: '👥', built: true, render: () => <EmployeesTab companyId={companyId} /> },
    { id: 'bank', label: 'Bank Details', icon: '🏦', built: true, href: '/dashboard/employees', desc: 'Salary account, IFSC and masked account number are maintained in the Employee Master.' },
    { id: 'revision', label: 'Salary Revision & Arrears', icon: '📈', desc: 'Versioned CTC with effective dates, increment letters and automatic arrear computation.' },
  ]} />
}

function RunView({ companyId, fy }: { companyId: string; fy: string }) {
  return <SubTabbed title="Payroll Run" subtitle="The heart — month create → sync → calculate → approve → disburse → lock" subs={[
    { id: 'cycle', label: 'Run Cycle', icon: '▶️', built: true, render: () => <RunTab companyId={companyId} headerFy={fy} /> },
    { id: 'uploaders', label: 'Bulk Uploaders', icon: '📤', desc: 'Seven XLSX uploaders feed the run before processing. Saved to payroll_run_inputs and picked up by the engine.', points: ['Additional payment', 'Deduction', 'Manual arrear', 'Statutory adjustment', 'Tax exemption', 'Perquisite tax', 'Other-than-month payment'] },
    { id: 'minwage', label: 'Minimum Wages Check', icon: '🛡️', desc: 'Flags employees whose gross falls below the applicable state minimum wage before payroll is processed.' },
    { id: 'lock', label: 'Lock / Unlock', icon: '🔒', built: true, desc: 'Single & bulk lock/unlock is part of the run status flow — DISBURSED → LOCKED freezes the snapshot and makes past payroll immutable.' },
  ]} />
}

function StatutoryView() {
  return <SubTabbed title="Statutory & Tax" subtitle="Compliance-by-design — PF, ESIC, PT, LWF, NPS and TDS" subs={[
    { id: 'pf', label: 'PF / EPF + VPF', icon: '🏦', built: true, href: '/dashboard/ess', desc: 'EPF @12% of capped wage is computed in the engine; VPF opt-in is available in the employee ESS portal.' },
    { id: 'esic', label: 'ESIC', icon: '🩺', built: true, desc: '0.75% employee / 3.25% employer, auto-applied for gross ≤ ₹21,000 during Calculate. Challan export is planned.' },
    { id: 'ptlwf', label: 'PT · LWF', icon: '⚖️', built: true, desc: 'State-wise Professional Tax slabs and Labour Welfare Fund are applied by the payroll engine.' },
    { id: 'nps', label: 'NPS', icon: '🏛️', built: true, href: '/dashboard/ess', desc: 'Corporate NPS enrolment via ESS; 80CCD(2) contribution is deducted in the engine.' },
    { id: 'tds', label: 'TDS Calculation', icon: '🧮', built: true, desc: 'Monthly TDS from each employee’s investment declaration feeds directly into the payroll run.' },
    { id: 'form16', label: 'Form 16 / 24Q', icon: '📄', desc: 'Quarterly 24Q returns and annual Form 16 generation for employees.' },
    { id: 'perq', label: 'Perquisite Tax', icon: '🚗', desc: 'Perquisite valuation and tax add-back to taxable income.' },
  ]} />
}

function BenefitsView() {
  return <SubTabbed title="Benefits & Loans" subtitle="Flexi benefits, NPS, insurance and the full loan lifecycle" subs={[
    { id: 'flexi', label: 'Flexi Benefit Plan', icon: '🎛️', built: true, href: '/dashboard/flexi-policy', desc: 'FBP components, slabs and employee declarations (old vs new regime).' },
    { id: 'flexiclaims', label: 'Flexi Claims', icon: '💳', built: true, href: '/dashboard/flexi-claims', desc: 'Review reimbursement bills, manage the monthly submission window and per-employee limits. Approved claims flow into payroll.' },
    { id: 'flexiinvoices', label: 'Flexi Invoices & Vouchers', icon: '🧾', built: true, href: '/dashboard/flexi-invoices', desc: 'Generate reimbursement vouchers (PDF) for approved flexi claims — one per employee per month, with invoice number EZER-FLX-…' },
    { id: 'nps', label: 'Corporate NPS', icon: '🏛️', built: true, href: '/dashboard/ess', desc: 'Employer NPS enrolment and monthly contribution.' },
    { id: 'insurance', label: 'Insurance / Meal Cards', icon: '🍱', desc: 'GMC / GPA insurance, meal & fuel cards and other benefit heads.' },
    { id: 'loan', label: 'Loan Disbursal & Schedule', icon: '💸', built: true, href: '/dashboard/loans', desc: 'Loan requests, approval workflow, disbursal and the EMI amortisation schedule.' },
    { id: 'emi', label: 'EMI Auto-Deduct', icon: '🔁', built: true, desc: 'Pending EMIs for the month are pulled into the payroll run automatically during Calculate.' },
    { id: 'foreclose', label: 'Part-payment / Foreclosure', icon: '✅', built: true, href: '/dashboard/loans', desc: 'Part-prepayment and foreclosure recalculate the outstanding schedule.' },
  ]} />
}

function OffcycleView() {
  return <SubTabbed title="Off-cycle · Bonus · FNF" subtitle="Ad-hoc payments, bonus registers and full & final settlement" subs={[
    { id: 'offcycle', label: 'Off-cycle Payments', icon: '💵', desc: 'Ad-hoc payments outside the monthly cycle — incentives, reimbursements, one-time payouts.' },
    { id: 'bonuscalc', label: 'Bonus Calculation', icon: '🎯', desc: 'Statutory (8.33–20%) and performance bonus computation with eligibility rules.' },
    { id: 'bonusreg', label: 'Bonus Register', icon: '📖', desc: 'Form C bonus register for statutory compliance.' },
    { id: 'fnfcreate', label: 'FNF Creation', icon: '📝', desc: 'Initiate full & final settlement for exited / resigned employees.' },
    { id: 'fnfprocess', label: 'FNF Process', icon: '📤', desc: 'Leave encashment, gratuity, notice recovery and the final settlement statement.' },
  ]} />
}

function ReportsView() {
  return <SubTabbed title="Outputs & Reports" subtitle="Payslips, registers, bank files, challans and dashboards" subs={[
    { id: 'register', label: 'Payroll Register', icon: '📊', built: true, desc: 'The full computed register for a run — export from Payroll Run → 📥 Register (one row per employee with every earning & deduction).' },
    { id: 'payslip', label: 'Salary Slip Generator', icon: '🧾', desc: 'Branded PDF payslips per employee on the Sharma Group letterhead, pushed to the ESS portal.' },
    { id: 'annual', label: 'Annual Salary', icon: '📅', desc: 'Year-to-date earnings & deductions statement per employee.' },
    { id: 'neft', label: 'Bank Transfer File (NEFT)', icon: '🏦', desc: 'Bank-ready NEFT / RTGS salary file with UTF-8 BOM (IFSC, account, amount, narration).' },
    { id: 'challans', label: 'PF ECR · ESIC · PT Challans', icon: '📑', desc: 'Statutory challan and PF ECR text files for upload to government portals.' },
    { id: 'dashboards', label: 'Month-end Dashboards', icon: '📈', desc: 'Headcount, pay summary, location-wise cost and month-on-month variance.' },
    { id: 'mis', label: 'MIS / Variance', icon: '🔍', desc: 'Custom MIS and variance reports across runs.' },
  ]} />
}

function AdminView({ companyId, group }: { companyId: string; group?: GroupScope }) {
  return <SubTabbed group={group} title="Admin & Controls" subtitle="Access control, approvals and the full audit trail" subs={[
    { id: 'audit', label: 'Audit Trail', icon: '📜', built: true, render: () => <AuditCard companyId={companyId} refreshKey={0} /> },
    { id: 'rbac', label: 'Role-based Access', icon: '🔑', built: true, href: '/dashboard/roles', desc: 'Payroll roles and permissions are managed in ESS & Role Management.' },
    { id: 'approval', label: 'Approval Workflows', icon: '✅', desc: 'Maker-checker approval chains for payroll sign-off before disbursement.' },
    { id: 'approvalmail', label: 'Approval Mail + Reports', icon: '✉️', desc: 'Automated approval emails with the run summary attached.' },
  ]} />
}

// ── ConfigTab ─────────────────────────────────────────────────────
function ConfigTab({ companyId }: { companyId: string }) {
  const [heads, setHeads] = useState<PayHead[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [headType, setHeadType] = useState('EARNING')
  const [calcType, setCalcType] = useState('FIXED')
  const [value, setValue] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function reload() {
    setLoading(true)
    setHeads(await loadPayHeads(companyId))
    setLoading(false)
  }
  useEffect(() => { reload() }, [companyId])

  async function add() {
    if (!code.trim() || !name.trim()) { setErr('Code and Name are required.'); return }
    setErr(''); setSaving(true)
    const { error } = await savePayHead(companyId, {
      code: code.trim().toUpperCase(), name: name.trim(), head_type: headType,
      calc_type: calcType, calc_value: value === '' ? null : Number(value), taxable,
    })
    setSaving(false)
    if (error) { setErr(error); return }
    setCode(''); setName(''); setValue(''); setHeadType('EARNING'); setCalcType('FIXED'); setTaxable(true)
    reload()
  }

  async function remove(id: string) {
    await deletePayHead(id)
    reload()
  }

  function calcLabel(h: PayHead) {
    if (h.calc_type === 'FIXED') return `FIXED ₹${h.calc_value ?? 0}`
    if (h.calc_type === 'PCT_BASIC') return `PCT_BASIC ${h.calc_value ?? 0}%`
    if (h.calc_type === 'PCT_CTC') return `PCT_CTC ${h.calc_value ?? 0}%`
    return 'FORMULA'
  }

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Pay Heads</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr 0.8fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={S.label}>Code</label>
            <input style={S.input} value={code} onChange={e => setCode(e.target.value)} placeholder="BASIC" />
          </div>
          <div>
            <label style={S.label}>Name</label>
            <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Basic Salary" />
          </div>
          <div>
            <label style={S.label}>Type</label>
            <select style={S.input} value={headType} onChange={e => setHeadType(e.target.value)}>
              <option value="EARNING">EARNING</option>
              <option value="DEDUCTION">DEDUCTION</option>
              <option value="EMPLOYER">EMPLOYER</option>
              <option value="NON_SALARY">NON_SALARY</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Calc type</label>
            <select style={S.input} value={calcType} onChange={e => setCalcType(e.target.value)}>
              <option value="FIXED">FIXED</option>
              <option value="PCT_BASIC">PCT_BASIC</option>
              <option value="PCT_CTC">PCT_CTC</option>
              <option value="FORMULA">FORMULA</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Value</label>
            <input style={S.input} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.navy, cursor: 'pointer' }}>
            <input type="checkbox" checked={taxable} onChange={e => setTaxable(e.target.checked)} /> Taxable
          </label>
          <button style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={add}>Add</button>
          {err && <span style={{ color: C.red, fontSize: 12 }}>{err}</span>}
        </div>
      </div>

      <div style={S.card}>
        {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : heads.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12 }}>No pay heads yet. Add one above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ padding: '6px 8px' }}>Code</th>
                  <th style={{ padding: '6px 8px' }}>Name</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Calc</th>
                  <th style={{ padding: '6px 8px' }}>Taxable</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {heads.map(h => {
                  const hc = HEAD_COLORS[h.head_type] || HEAD_COLORS.EARNING
                  return (
                    <tr key={h.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: C.purpleDark }}>{h.code}</td>
                      <td style={{ padding: '8px', color: C.navy }}>{h.name}</td>
                      <td style={{ padding: '8px' }}><Badge text={h.head_type} bg={hc.bg} color={hc.color} /></td>
                      <td style={{ padding: '8px', color: C.navy }}>{calcLabel(h)}</td>
                      <td style={{ padding: '8px', color: C.muted }}>{h.taxable ? 'Y' : 'N'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}><button style={S.btnDanger} onClick={() => remove(h.id)}>Delete</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={S.note}>Other config (FY/month, PT/LWF/min-wages slabs, tax config, perquisite, bonus) — planned.</div>
    </div>
  )
}

// ── Run tab helpers ───────────────────────────────────────────────
function statusPill(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    OPEN: { bg: 'rgba(107,107,123,0.14)', color: C.muted },
    SYNCED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    ATTENDANCE_LOCKED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    CALCULATED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    AI_CHECKED: { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' },
    APPROVED: { bg: 'rgba(5,150,105,0.12)', color: C.success },
    DISBURSED: { bg: 'rgba(5,150,105,0.12)', color: C.success },
    LOCKED: { bg: 'rgba(30,27,75,0.12)', color: C.navy },
    CANCELLED: { bg: 'rgba(220,38,38,0.12)', color: C.red },
  }
  return map[status] || map.OPEN
}

function Stepper({ status }: { status: string }) {
  const curIdx = RUN_FLOW.indexOf(status)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      {RUN_FLOW.map((s, i) => {
        const active = i === curIdx
        const done = curIdx >= 0 && i < curIdx
        return (
          <span key={s} style={{
            fontSize: 9.5, fontWeight: 600, padding: '3px 8px', borderRadius: 99,
            background: active ? C.purple : done ? 'rgba(124,58,237,0.10)' : 'rgba(107,107,123,0.08)',
            color: active ? '#fff' : done ? C.purple : C.muted,
            border: `1px solid ${active ? C.purple : C.border}`,
          }}>{s}</span>
        )
      })}
    </div>
  )
}

// ── AuditCard ─────────────────────────────────────────────────────
function AuditCard({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { loadAudit(companyId).then(setRows) }, [companyId, refreshKey])
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>Recent activity</div>
      {rows.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No activity yet.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.slice(0, 12).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'center', borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, paddingTop: i === 0 ? 0 : 6 }}>
              <span style={{ fontWeight: 600, color: C.purpleDark, minWidth: 150 }}>{r.action}</span>
              <span style={{ color: C.muted }}>{r.performed_by || '—'}</span>
              <span style={{ color: C.muted, marginLeft: 'auto' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Run summary stats bar (statutory totals + variance vs last month) ──
const inrShort = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
function RunSummaryCard({ run, refreshKey }: { run: PayrollRun; refreshKey: number }) {
  const [sum, setSum] = useState<RunSummary | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { let live = true; setLoading(true); loadRunSummary(run).then(x => { if (live) { setSum(x); setLoading(false) } }); return () => { live = false } }, [run.id, run.status, refreshKey])
  if (loading) return <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>Loading summary…</div>
  if (!sum || sum.employees === 0) return null
  const tiles: { l: string; v: string; c?: string }[] = [
    { l: 'Employees', v: String(sum.employees) },
    { l: 'Gross', v: inrShort(sum.gross) },
    { l: 'Net Pay', v: inrShort(sum.net), c: C.success },
    { l: 'EPF (ee)', v: inrShort(sum.epf) },
    { l: 'ESIC (ee)', v: inrShort(sum.esic) },
    { l: 'PT', v: inrShort(sum.pt) },
    { l: 'LWF', v: inrShort(sum.lwf) },
    { l: 'TDS', v: inrShort(sum.tds) },
    { l: 'VPF', v: inrShort(sum.vpf) },
    { l: 'NPS', v: inrShort(sum.nps) },
    { l: 'Loan EMI', v: inrShort(sum.loanEmi) },
    { l: 'Flexi reimb.', v: inrShort(sum.flexi) },
    { l: 'Employer PF', v: inrShort(sum.employerPf) },
    { l: 'Employer ESIC', v: inrShort(sum.employerEsic) },
    { l: 'Gratuity', v: inrShort(sum.gratuity) },
  ]
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', letterSpacing: '.04em' }}>Run Summary</div>
        {sum.variancePct != null && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: sum.variancePct > 0 ? 'rgba(220,38,38,0.10)' : 'rgba(5,150,105,0.10)', color: sum.variancePct > 0 ? C.red : C.success }}>
            {sum.variancePct > 0 ? '▲' : '▼'} {Math.abs(sum.variancePct)}% net vs last month
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {tiles.map(t => (
          <div key={t.l} style={{ background: '#FAFAF8', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em' }}>{t.l}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.c || C.navy, marginTop: 2 }}>{t.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RunTab ────────────────────────────────────────────────────────
function RunTab({ companyId, headerFy }: { companyId: string; headerFy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const fy = headerFy                                    // FY comes from the page header now
  const [month, setMonth] = useState(1)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const allCompanies = !companyId

  async function reload() {
    setLoading(true)
    setRuns(await loadRuns(companyId, fy))               // '' companyId = all companies · scoped to selected FY
    setLoading(false)
    setRefreshKey(k => k + 1)
  }
  useEffect(() => { reload() }, [companyId, fy])

  async function create() {
    if (!companyId) { setErr('Pick a specific company above to create a payroll month.'); return }
    setErr(''); setBusy(true)
    const { error } = await createRun(companyId, fy.trim(), month)
    setBusy(false)
    if (error) { setErr(error); return }
    reload()
  }

  async function advance(run: PayrollRun) {
    setBusy(true)
    const { error } = await advanceRun(run)
    setBusy(false)
    if (error) { setErr(error); return }
    reload()
  }

  async function cancel(run: PayrollRun) {
    setBusy(true)
    await cancelRun(run)
    setBusy(false)
    reload()
  }

  async function sync(run: PayrollRun) {
    setErr(''); setBusy(true)
    const { error, count } = await syncRunEmployees(run)
    setBusy(false)
    if (error) { setErr(error); return }
    setErr(''); alert(`Synced ${count} employees from HRMS into ${run.period_label}.`)
    reload()
  }

  async function calculate(run: PayrollRun) {
    setErr(''); setBusy(true)
    const { error, result } = await calculateRun(run)
    setBusy(false)
    if (error) { setErr(error); return }
    const r = result!
    alert(`Payroll calculated for ${run.period_label}.\n\nProcessed: ${r.processed} employees${r.skipped ? ` · Skipped: ${r.skipped}` : ''}\nGross: ₹${Math.round(r.totalGross).toLocaleString('en-IN')}\nNet payable: ₹${Math.round(r.totalNet).toLocaleString('en-IN')}${r.errors.length ? `\n\n${r.errors.length} warning(s) — first: ${r.errors[0]}` : ''}`)
    reload()
  }

  async function exportRegister(run: PayrollRun) {
    setBusy(true)
    try {
      const rows = await loadRunRegister(run.id)
      if (!rows.length) { alert('No payroll lines for this run yet — sync + process first.'); setBusy(false); return }
      const allKeys = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s }, new Set<string>()))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: allKeys }), 'Register')
      XLSX.writeFile(wb, `EZER_Payroll_Register_${(run.period_label || run.fy).replace(/\s+/g, '_')}.xlsx`)
    } catch (e: any) { alert('Export failed: ' + (e?.message || 'unknown error')) }
    setBusy(false)
  }

  async function exportNeft(run: PayrollRun) {
    setBusy(true)
    try {
      const rows = await buildNeftRows(run.id)
      if (!rows.length) { alert('No payable lines for this run yet — calculate payroll first.'); setBusy(false); return }
      const head = ['Beneficiary Name', 'Emp Code', 'Account (last4)', 'IFSC', 'Amount', 'Narration']
      const body = rows.map(r => [r.beneficiary_name, r.emp_code, r.account_last4, r.ifsc_code, r.amount, `${r.narration}-${(run.period_label || run.fy).replace(/\s+/g, '')}`])
      const csv = '﻿' + [head, ...body].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      const a = document.createElement('a'); a.href = url; a.download = `EZER_NEFT_${(run.period_label || run.fy).replace(/\s+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(url)
      const total = rows.reduce((t, r) => t + Number(r.amount), 0)
      alert(`NEFT file generated · ${rows.length} beneficiaries · Total ₹${Math.round(total).toLocaleString('en-IN')}.\n\nNote: full account numbers are encrypted — the file carries the masked last-4 + IFSC. Merge with the beneficiary master before bank upload.`)
    } catch (e: any) { alert('NEFT export failed: ' + (e?.message || 'unknown error')) }
    setBusy(false)
  }

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Create payroll month · FY {fy}</div>
        {allCompanies ? (
          <div style={{ fontSize: 12.5, color: C.muted }}>You&apos;re viewing <b>Group Companies</b> (FY {fy}). Pick a specific company in the header to create a new payroll month.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={S.label}>Month</label>
              <select style={S.input} value={month} onChange={e => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={create}>Create payroll month</button>
          </div>
        )}
        {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>

      {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : runs.length === 0 ? (
        <div style={S.card}><div style={{ color: C.muted, fontSize: 12 }}>No payroll months for FY {fy}{allCompanies ? ' across any company' : ''} yet.{!allCompanies ? ' Create one above.' : ''}</div></div>
      ) : runs.map(run => {
        const pill = statusPill(run.status)
        const ns = nextStatus(run.status)
        const isLocked = run.status === 'LOCKED'
        const isCancelled = run.status === 'CANCELLED'
        return (
          <div key={run.id} style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{run.period_label || `${run.fy} · M${run.month}`}</div>
              {allCompanies && run.company_name && <Badge text={run.company_name} bg="rgba(30,27,75,0.08)" color={C.navy} />}
              <Badge text={run.run_type} bg="rgba(124,58,237,0.10)" color={C.purple} />
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.color }}>{run.status}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{run.emp_count || 0} employees</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {!isCancelled && (
                  <button style={{ ...S.btnOutline, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => exportRegister(run)}>📥 Register</button>
                )}
                {!isCancelled && ['CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'].includes(run.status) && (
                  <button style={{ ...S.btnOutline, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => exportNeft(run)}>🏦 NEFT File</button>
                )}
                {!isLocked && !isCancelled && (
                  <button style={{ ...S.btnOutline, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => sync(run)}>⟳ Sync employees</button>
                )}
                {!isLocked && !isCancelled && ['SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED'].includes(run.status) && (
                  <button style={{ ...S.btnOutline, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => calculate(run)}>⚙️ {run.status === 'CALCULATED' ? 'Re-calculate' : 'Calculate'}</button>
                )}
                {!isLocked && !isCancelled && ns && (
                  <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => advance(run)}>Advance → {ns}</button>
                )}
                {!isLocked && !isCancelled && (
                  <button style={S.btnDanger} disabled={busy} onClick={() => cancel(run)}>Cancel</button>
                )}
              </div>
            </div>
            {!isCancelled && <Stepper status={run.status} />}
            {['CALCULATED', 'AI_CHECKED', 'APPROVED', 'DISBURSED', 'LOCKED'].includes(run.status) && <RunSummaryCard run={run} refreshKey={refreshKey} />}
          </div>
        )
      })}

      <div style={S.note}><b>⟳ Sync employees</b> freezes the HRMS employee master + attendance into this month's snapshot (OPEN → SYNCED). <b>⚙️ Calculate</b> runs the payroll engine — pro-rata earnings, EPF/ESIC/PT/LWF, and VPF/NPS/loan/TDS deductions — and writes each employee's payroll line (→ CALCULATED). A live <b>Run Summary</b> (statutory totals + variance vs last month) appears once calculated. Export the computed lines via <b>📥 Register</b> and the salary bank file via <b>🏦 NEFT File</b>.</div>

      <div style={{ marginTop: 14 }}>
        <AuditCard companyId={companyId} refreshKey={refreshKey} />
      </div>
    </div>
  )
}

// ── BenefitsTab ───────────────────────────────────────────────────
function BenefitsTab() {
  const items = [
    { title: 'Flexi Policy Config', href: '/dashboard/flexi-policy', note: 'Configure flexi benefit plan components', built: true },
    { title: 'Voluntary PF (VPF)', href: null, note: 'ESS → Voluntary PF', built: true },
    { title: 'Corporate NPS', href: null, note: 'ESS → Corporate NPS', built: true },
  ]
  return (
    <div>
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardTitle}>Benefits &amp; Loans</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
          {items.map(it => (
            <div key={it.title} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: '#FAFAF8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {it.href ? (
                  <a href={it.href} style={{ fontSize: 13, fontWeight: 700, color: C.purple, textDecoration: 'none' }}>{it.title} →</a>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{it.title}</span>
                )}
                {it.built && <Badge text="Built (employee ESS)" bg="rgba(5,150,105,0.12)" color={C.success} />}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{it.note}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={S.note}>Loans, salary advance &amp; recovery schedules — planned.</div>
    </div>
  )
}

// ── EmployeesTab — payroll view of active employees + CTC + export ──
function EmployeesTab({ companyId }: { companyId: string }) {
  const [emps, setEmps] = useState<PayrollEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
  useEffect(() => { setLoading(true); loadPayrollEmployees(companyId).then(d => { setEmps(d); setLoading(false) }) }, [companyId])

  const depts = Array.from(new Set(emps.map(e => e.department).filter(Boolean))) as string[]
  const filtered = emps.filter(e => {
    if (dept && e.department !== dept) return false
    if (q.trim()) { const s = q.toLowerCase(); return (e.emp_code || '').toLowerCase().includes(s) || (e.full_name || '').toLowerCase().includes(s) }
    return true
  })
  const missingCtc = emps.filter(e => !e.annual_ctc).length

  function exportExcel() {
    const rows = filtered.map(e => ({
      'Employee Code': e.emp_code, 'Name': e.full_name, 'Designation': e.designation || '', 'Department': e.department || '', 'Location': e.location || '',
      'Annual CTC': e.annual_ctc, 'Basic (monthly)': e.basic_monthly, 'HRA (monthly)': e.hra_monthly,
      'Tax Regime': e.tds_regime || '', 'PF': e.pf_applicable ? 'Yes' : 'No', 'ESIC': e.esic_applicable ? 'Yes' : 'No', 'PT': e.pt_applicable ? 'Yes' : 'No', 'LWF': e.lwf_applicable ? 'Yes' : 'No',
      'Bank': e.bank_name || '', 'IFSC': e.ifsc_code || '', 'Account (last4)': e.bank_account_last4 || '',
    }))
    if (!rows.length) { alert('No employees to export.'); return }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Payroll Employees')
    XLSX.writeFile(wb, `EZER_Payroll_Employees_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div>
      <div style={{ ...S.card, position: 'sticky', top: 46, zIndex: 29, boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={S.cardTitle}>Employees &amp; CTC ({filtered.length})</div>
          <input style={{ ...S.input, width: 200 }} placeholder="Search code / name…" value={q} onChange={e => setQ(e.target.value)} />
          <select style={{ ...S.input, width: 180 }} value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button style={{ ...S.btnPrimary, marginLeft: 'auto' }} onClick={exportExcel}>📥 Export Excel</button>
        </div>
        {missingCtc > 0 && <div style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>⚠ {missingCtc} employee(s) have no CTC in ctc_master — CTC/Basic show ₹0. Seed ctc_master to populate.</div>}
      </div>
      {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>
              {['Code', 'Name', 'Dept', 'Annual CTC', 'Basic/mo', 'HRA/mo', 'Regime', 'PF/ESIC/PT/LWF', 'Bank'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{e.emp_code}</td>
                  <td style={{ padding: '6px 8px' }}>{e.full_name}<div style={{ fontSize: 10, color: C.muted }}>{e.designation || '—'}</div></td>
                  <td style={{ padding: '6px 8px' }}>{e.department || '—'}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{inr(e.annual_ctc)}</td>
                  <td style={{ padding: '6px 8px' }}>{inr(e.basic_monthly)}</td>
                  <td style={{ padding: '6px 8px' }}>{inr(e.hra_monthly)}</td>
                  <td style={{ padding: '6px 8px' }}>{e.tds_regime || '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 10 }}>{[e.pf_applicable && 'PF', e.esic_applicable && 'ESIC', e.pt_applicable && 'PT', e.lwf_applicable && 'LWF'].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11 }}>{e.bank_name || '—'}{e.bank_account_last4 ? ` ••${e.bank_account_last4}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={S.note}>Source of truth is HRMS (employees + ctc_master). Versioned CTC (from_date/active_month), salary revision &amp; arrears — planned.</div>
    </div>
  )
}

// ── PlannedTab (generic) ──────────────────────────────────────────
function PlannedTab({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={S.cardTitle}>{title}</div>
        <PlannedBadge />
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => <li key={i} style={{ fontSize: 13, color: C.navy }}>{it}</li>)}
      </ul>
    </div>
  )
}

// ── Parent ────────────────────────────────────────────────────────
const FY_OPTIONS = ['2026-27', '2025-26', '2024-25']
interface CompanyOpt { id: string; company_name: string; group_id?: string | null; group_name?: string | null }

// Company switcher shown in Group Companies mode — pick which company you're editing.
function GroupScopeBar({ companies, active, onChange }: { companies: GroupScope['companies']; active: string; onChange: (id: string) => void }) {
  const groups = Array.from(new Set(companies.map(c => c.group_name || 'Companies')))
  return (
    <div style={{ ...S.card, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.purpleDark, textTransform: 'uppercase', letterSpacing: '.05em' }}>🏛️ Editing company</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {groups.map(g => companies.filter(c => (c.group_name || 'Companies') === g).map(c => {
          const on = c.id === active
          return (
            <button key={c.id} onClick={() => onChange(c.id)} style={{
              padding: '6px 13px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${on ? C.purple : C.border}`, background: on ? C.purple : '#fff', color: on ? '#fff' : C.navy,
            }}>{c.company_name}</button>
          )
        }))}
      </div>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{companies.length} companies · changes save to the selected company</span>
    </div>
  )
}
export default function PayrollPage() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([])
  const [companyId, setCompanyId] = useState('')   // '' = Group Companies
  const [groupCo, setGroupCo] = useState('')       // company being edited while in Group mode
  const [fy, setFy] = useState('2026-27')
  const [tab, setTab] = useState('config')

  useEffect(() => {
    loadCompanies().then(list => {
      setCompanies(list as any)
      // Default the header to "Group Companies" ('' ); the switcher targets the first company.
      if (list.length) setGroupCo(list[0].id)
    })
  }, [])

  function renderTab() {
    const groupMode = !companyId                                   // "Group Companies" selected
    // In Group mode the scoped tabs edit whichever company the switcher points at.
    const effCompanyId = companyId || groupCo || companies[0]?.id || ''
    const group: GroupScope = { mode: groupMode, companies, active: effCompanyId, onChange: setGroupCo }
    switch (tab) {
      case 'config': return <ConfigView companyId={effCompanyId} group={group} />
      case 'employees': return <EmployeesView companyId={effCompanyId} group={group} />
      case 'run': return <RunView companyId={companyId} fy={fy} />
      case 'statutory': return <StatutoryView />
      case 'benefits': return <BenefitsView />
      case 'offcycle': return <OffcycleView />
      case 'reports': return <ReportsView />
      case 'admin': return <AdminView companyId={effCompanyId} group={group} />
      default: return null
    }
  }

  return (
    <div style={S.page}>
      <div style={S.content}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={S.h1}>Payroll</h1>
            <div style={S.sub}>Punch-to-payroll · benchmarked vs PeopleStrong</div>
          </div>
          <div>
            <label style={S.label}>Financial Year</label>
            <select style={{ ...S.input, minWidth: 130 }} value={fy} onChange={e => setFy(e.target.value)}>
              {FY_OPTIONS.map(y => <option key={y} value={y}>FY {y}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Company</label>
            <select style={{ ...S.input, minWidth: 240 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              {(() => {
                // Group the companies under their group name (e.g. "Sharma Group").
                const groups = Array.from(new Set(companies.map(c => c.group_name || 'Companies')))
                return <>
                  <option value="">Group Companies{groups.length === 1 && groups[0] !== 'Companies' ? ` (${groups[0]})` : ''}</option>
                  {groups.map(g => (
                    <optgroup key={g} label={g}>
                      {companies.filter(c => (c.group_name || 'Companies') === g).map(c => (
                        <option key={c.id} value={c.id}>{c.company_name}</option>
                      ))}
                    </optgroup>
                  ))}
                </>
              })()}
            </select>
          </div>
        </div>

        {/* Tab bar — frozen (sticky) so it stays visible while content scrolls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4, position: 'sticky', top: 0, zIndex: 30, background: C.bg, paddingTop: 8, boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '9px 14px', borderRadius: 8, border: `1px solid ${active ? C.purple : C.border}`,
                background: active ? C.purple : '#fff', color: active ? '#fff' : C.navy,
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>{t.label}</button>
            )
          })}
        </div>

        {/* Active panel */}
        {renderTab()}
      </div>
    </div>
  )
}
