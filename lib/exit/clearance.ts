// lib/exit/clearance.ts — pure. The five department clearance forms (Exit Module spec v2 §8):
// IT, Admin, Finance, HR and HOD / Manager. Each item has its status options and an optional
// remark / amount; a department signs off CLEARED, CLEARED WITH DUES (an amount that becomes an
// F&F deduction) or NOT CLEARED. F&F cannot start until all five are cleared (§8.1).

export type Dept = 'IT' | 'ADMIN' | 'FINANCE' | 'HR' | 'HOD'
export const DEPTS: Dept[] = ['IT', 'ADMIN', 'FINANCE', 'HR', 'HOD']

export interface ClearanceItemDef {
  key: string; label: string
  options: string[]
  /** The remark the form asks for beside it (asset tag, card no…). */
  remark?: string
  /** An amount box: a recovery (dues) or, for Finance, a figure pulled from a module. */
  amount?: boolean
  /** Filled from the system, still editable (Finance: loans / advances; HR: gratuity…). */
  auto?: string
}
export interface DeptDef { dept: Dept; label: string; formId: string; roles: string[]; items: ClearanceItemDef[]; signoff: string[] }

const R = (o: string) => o.split(' / ')
export const CLEARANCE_FORMS: Record<Dept, DeptDef> = {
  IT: {
    dept: 'IT', label: 'IT Department', formId: 'CLR-IT', roles: ['IT'],
    signoff: ['CLEARED', 'CLEARED_WITH_DUES', 'NOT_CLEARED'],
    items: [
      { key: 'laptop', label: 'Laptop / Desktop returned', options: R('Returned / Not Applicable / Pending / Damaged'), remark: 'Asset tag, condition', amount: true },
      { key: 'charger', label: 'Charger / Power Adapter returned', options: R('Returned / Not Applicable / Pending / Lost'), amount: true },
      { key: 'peripherals', label: 'Mouse / Keyboard / Headset returned', options: R('Returned / Not Applicable / Pending'), remark: 'Itemwise list' },
      { key: 'monitor', label: 'Monitor (external) returned', options: R('Returned / Not Applicable / Pending'), remark: 'Asset tag' },
      { key: 'mobile', label: 'Company mobile phone returned', options: R('Returned / Not Applicable / Pending'), remark: 'IMEI' },
      { key: 'sim', label: 'SIM card returned', options: R('Returned / Not Applicable / Pending'), remark: 'SIM no.' },
      { key: 'email', label: 'Email ID deactivation scheduled', options: R('Scheduled (LWD+1) / Done'), remark: 'Email, forwarding set to' },
      { key: 'access', label: 'All system / tool access revoked', options: R('Done / Pending'), remark: 'Tools: HRMS, CRM, Jira, Slack…' },
      { key: 'vpn', label: 'VPN / Remote access disabled', options: R('Done / Not Applicable') },
      { key: 'licenses', label: 'Software licenses reclaimed', options: R('Done / Not Applicable'), remark: 'Licenses' },
      { key: 'backup', label: 'Data backup completed', options: R('Done / Not Applicable'), remark: 'Backup location' },
      { key: 'wipe', label: 'Personal data wiped from company device', options: R('Done / Not Applicable'), remark: 'Wipe confirmed by' },
      { key: 'code', label: 'Source code / IP access revoked', options: R('Done / Not Applicable'), remark: 'Repos' },
    ],
  },
  ADMIN: {
    dept: 'ADMIN', label: 'Admin Department', formId: 'CLR-ADMIN', roles: ['ADMIN_COMPANY', 'ADMIN_SUPER'],
    signoff: ['CLEARED', 'CLEARED_WITH_DUES', 'NOT_CLEARED'],
    items: [
      { key: 'id_card', label: 'Employee ID Card returned', options: R('Returned / Lost (₹500 recovery)'), remark: 'Card no.', amount: true },
      { key: 'access_card', label: 'Access card / building badge returned', options: R('Returned / Not Applicable / Lost'), remark: 'Card no.', amount: true },
      { key: 'parking', label: 'Vehicle parking pass returned', options: R('Returned / Not Applicable'), remark: 'Pass no.' },
      { key: 'keys', label: 'Office keys returned', options: R('Returned / Not Applicable / Lost'), remark: 'Key set', amount: true },
      { key: 'locker', label: 'Locker cleared', options: R('Cleared / Not Applicable'), remark: 'Locker no.' },
      { key: 'cards', label: 'Business cards returned (unused)', options: R('Returned / Not Applicable'), remark: 'Qty' },
      { key: 'uniform', label: 'Company uniform returned (if applicable)', options: R('Returned / Not Applicable'), remark: 'Sets' },
      { key: 'vehicle', label: 'Company vehicle returned (if applicable)', options: R('Returned / Not Applicable'), remark: 'Vehicle no., condition', amount: true },
      { key: 'library', label: 'Library books / materials returned', options: R('Returned / Not Applicable'), remark: 'Items' },
      { key: 'desk', label: 'Workstation / desk cleared', options: ['Done'], remark: 'Verified by' },
    ],
  },
  FINANCE: {
    dept: 'FINANCE', label: 'Finance Department', formId: 'CLR-FIN', roles: ['FINANCE_EXECUTIVE', 'PAYROLL', 'PAYROLL_ADMIN', 'CFO'],
    signoff: ['CLEARED', 'CLEARED_WITH_DUES'],
    items: [
      { key: 'advance', label: 'Pending salary advance', options: R('Recover / Nil'), amount: true, auto: 'advance', remark: 'Advance date' },
      { key: 'loan', label: 'Pending loan (principal + interest)', options: R('Recover / Nil'), amount: true, auto: 'loan', remark: 'Loan type, outstanding' },
      { key: 'cc_dues', label: 'Company credit card dues', options: R('Recover / Nil'), amount: true, remark: 'Card last 4' },
      { key: 'cc_surrender', label: 'Company credit card surrendered', options: R('Yes / No / Not Applicable'), remark: 'Card destroyed' },
      { key: 'expenses', label: 'Pending expense report settlement', options: R('Pay employee / Nil'), amount: true, auto: 'expenses', remark: 'Claims count' },
      { key: 'travel_adv', label: 'Travel advance pending', options: R('Recover / Nil'), amount: true, auto: 'travel_advance', remark: 'Trip' },
      { key: 'imprest', label: 'Imprest / petty cash balance', options: R('Recover / Nil'), amount: true, remark: 'Last settlement' },
      { key: 'bond', label: 'Training bond recovery', options: R('Recover / Nil'), amount: true, remark: 'Bond end date, months remaining' },
      { key: 'relocation', label: 'Relocation reimbursement clawback', options: R('Recover / Nil'), amount: true, remark: 'If within clawback period' },
      { key: 'other', label: 'Any other financial dues', options: R('Recover / Nil'), amount: true, remark: 'Description' },
    ],
  },
  HR: {
    dept: 'HR', label: 'HR Department', formId: 'CLR-HR', roles: ['HR_MANAGER', 'HR_HEAD', 'HR_EXECUTIVE', 'BRANCH_HR'],
    signoff: ['CLEARED', 'CLEARED_WITH_CONDITIONS'],
    items: [
      { key: 'originals', label: 'Original documents returned', options: R('Returned / Not Submitted / Not Applicable'), remark: 'Degree, marksheets…' },
      { key: 'exit_interview', label: 'Exit interview completed', options: R('Completed / Pending / Not Required'), remark: 'Interview date' },
      { key: 'nda', label: 'NDA signed / acknowledged', options: R('Signed / Already on file / Not Applicable'), remark: 'NDA date, validity' },
      { key: 'non_compete', label: 'Non-compete acknowledgement', options: R('Signed / Not Applicable'), remark: 'Period' },
      { key: 'confidentiality', label: 'Confidentiality agreement signed', options: R('Signed / Already on file') },
      { key: 'investments', label: 'Investment declaration & proofs', options: R('Complete / Incomplete / Not Submitted'), auto: 'investments', remark: 'Missing proofs' },
      { key: 'gratuity', label: 'Gratuity eligibility verified', options: R('Eligible (≥4yr+240d) / Not Eligible'), auto: 'gratuity', remark: 'Service years' },
      { key: 'reimbursements', label: 'Pending reimbursements status', options: R('All Settled / Pending / Lapsed'), auto: 'reimbursements', remark: 'Pending count' },
      { key: 'flexi', label: 'Pending flexi claims status', options: R('All Settled / Pending / Lapsed'), auto: 'flexi', remark: 'Pending components' },
      { key: 'personal_email', label: 'Employee personal email verified', options: R('Verified / Not Available'), auto: 'personal_email', remark: 'Email' },
      { key: 'bank', label: 'F&F bank details confirmed', options: R('Confirmed / Needs Update'), auto: 'bank', remark: 'Bank, A/C last 4' },
      { key: 'rehire', label: 'Blacklist / Rehire flag set', options: R('Green / Blocked / Review'), auto: 'rehire', remark: 'Reason' },
    ],
  },
  HOD: {
    dept: 'HOD', label: 'HOD / Manager', formId: 'CLR-MGR', roles: [],   // the employee's own L1 manager / HOD
    signoff: ['CLEARED', 'CLEARED_WITH_REMARKS'],
    items: [
      { key: 'kt', label: 'Knowledge Transfer (KT) completed', options: R('Completed (100%) / Partial / Not Started'), remark: 'KT %, document link' },
      { key: 'tasks', label: 'All pending tasks handed over', options: R('Done / Partial / Not Done'), remark: 'Handed over to' },
      { key: 'clients', label: 'Client communication / handover done', options: R('Done / Not Applicable'), remark: 'Clients' },
      { key: 'docs', label: 'Project documentation updated', options: R('Done / Partial / Not Applicable'), remark: 'Projects' },
      { key: 'transition', label: 'Team transition plan confirmed', options: R('Done / Not Required'), remark: 'Replacement' },
      { key: 'deliverables', label: 'No pending deliverables', options: R('Confirmed / Pending items exist'), remark: 'Items' },
      { key: 'drive', label: 'Shared drive / files access handed over', options: R('Done / Not Applicable') },
      { key: 'stakeholders', label: 'Ongoing commitments communicated to stakeholders', options: R('Done / Not Applicable'), remark: 'Stakeholders' },
      { key: 'ownership', label: 'Tools / accounts ownership transferred', options: R('Done / Not Applicable'), remark: 'Accounts' },
      { key: 'code_review', label: 'Code review / PR completion', options: R('Done / Not Applicable'), remark: 'Open PRs' },
    ],
  },
}

export const SIGNOFF_LABEL: Record<string, string> = {
  CLEARED: 'Cleared', CLEARED_WITH_DUES: 'Cleared with dues', NOT_CLEARED: 'Not cleared',
  CLEARED_WITH_CONDITIONS: 'Cleared with conditions', CLEARED_WITH_REMARKS: 'Cleared with remarks', PENDING: 'Pending',
}
/** Statuses that count as cleared for the F&F gate. */
export const isCleared = (s: string | null | undefined) => !!s && s.startsWith('CLEARED')

export interface ItemValue { status?: string | null; remark?: string | null; amount?: number | null }
export interface ClearanceSubmit { items: Record<string, ItemValue>; signoff: string; remarks?: string | null; payable?: number | null; extra?: Record<string, unknown> }

/** Items whose status still says something is outstanding. */
const OUTSTANDING = /^(Pending|Not Done|Not Started|Partial|Damaged|Lost|Pending items exist|Incomplete|Not Submitted|Needs Update|No)\b/

/** Recovery from the employee on this form: every item amount, except Finance's "Pay employee". */
export function recoveryOf(dept: Dept, items: Record<string, ItemValue>): number {
  const def = CLEARANCE_FORMS[dept]
  return Math.round(def.items.reduce((t, it) => {
    const v = items[it.key]; const a = Number(v?.amount) || 0
    if (!it.amount || a <= 0) return t
    if (dept === 'FINANCE' && it.key === 'expenses') return t
    return t + a
  }, 0))
}
/** Payable to the employee on this form (Finance: pending expense reimbursements). */
export function payableOf(dept: Dept, items: Record<string, ItemValue>): number {
  return dept === 'FINANCE' ? Math.max(0, Math.round(Number(items.expenses?.amount) || 0)) : 0
}

/** Why this sign-off cannot be saved (empty = it can). */
export function clearanceProblems(dept: Dept, x: ClearanceSubmit): string[] {
  const def = CLEARANCE_FORMS[dept]
  const out: string[] = []
  const missing = def.items.filter(it => !x.items?.[it.key]?.status)
  if (missing.length) out.push(`Set a status for every item (${missing.length} left: ${missing.slice(0, 3).map(m => m.label).join(', ')}${missing.length > 3 ? '…' : ''}).`)
  for (const it of def.items) {
    const v = x.items?.[it.key]
    if (v?.status && !it.options.includes(v.status)) out.push(`"${v.status}" is not an option for ${it.label}.`)
    if (v?.amount != null && (Number.isNaN(Number(v.amount)) || Number(v.amount) < 0)) out.push(`The amount for ${it.label} must be zero or more.`)
  }
  if (!def.signoff.includes(x.signoff)) out.push('Pick the clearance status.')
  const dues = recoveryOf(dept, x.items || {})
  if (x.signoff === 'CLEARED' && dues > 0) out.push(`There are dues of ₹${dues.toLocaleString('en-IN')}: sign off as "Cleared with dues".`)
  if (x.signoff === 'CLEARED_WITH_DUES' && dues <= 0) out.push('"Cleared with dues" needs a recovery amount on at least one item.')
  if (x.signoff === 'CLEARED' && def.items.some(it => OUTSTANDING.test(String(x.items?.[it.key]?.status || '')) && !(it.amount && Number(x.items?.[it.key]?.amount) > 0)))
    out.push('Some items are still outstanding. Mark them done, record dues, or sign off as not cleared / with conditions.')
  if (['CLEARED_WITH_CONDITIONS', 'CLEARED_WITH_REMARKS', 'NOT_CLEARED'].includes(x.signoff) && !String(x.remarks || '').trim()) out.push('Write the conditions / remarks for this sign-off.')
  return out
}

/** Escalation for a department that has not cleared (§8.3): 5 business days → HR Manager, 7 → HR Head. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`), b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`)
  let n = 0
  for (const d = new Date(a); d < b; d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++ }
  return n
}
export function clearanceEscalation(startedIso: string, todayIso: string): 'NONE' | 'HR_MANAGER' | 'HR_HEAD' {
  const n = businessDaysBetween(startedIso, todayIso)
  return n >= 7 ? 'HR_HEAD' : n >= 5 ? 'HR_MANAGER' : 'NONE'
}
