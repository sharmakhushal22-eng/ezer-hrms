// lib/payroll/readiness.ts — the pre-flight check that stands between a payroll month
// and the Run Payroll button.
//
// Every check here answers one question: if HR presses Run right now, who gets hurt?
// That is why each row carries an *impact* sentence rather than a rule name — "Missing
// IFSC" tells nobody anything, "payment will fail, this employee will not be paid this
// cycle" tells them whether it can wait until tomorrow.
//
// Blocking vs non-blocking decides who gets PAID, not whether the month runs. A missing
// bank account stops money from moving for that one person, so they are left out of the
// run and everyone else is paid on time — holding 301 salaries because one account
// number is blank is not a safety feature, it is an outage. A missing PAN is a filing
// problem three months away, so it warns and gets out of the way; blocking a payslip
// over it would teach HR to ignore this screen entirely.
//
// Every excluded employee stays exactly as they were — no line written, nothing zeroed.
// Fix the detail, filter to them, run again.
//
// Reads the Month Master (payroll_employee_snapshot) — the same frozen row the engine
// computes from. Checking live HRMS instead would pass a month that then pays wrong.
import { supabase } from '@/lib/supabase'

export interface ReadinessEmployee {
  code: string
  name: string
  company: string
  initials: string
  impact: string
}

export interface ReadinessCheck {
  key: string
  label: string
  icon: string
  /** true = these employees are left out of the run; the rest are still paid */
  blocking: boolean
  /** the line under the card title */
  desc: string
  /** false = no defined source yet; the tab renders greyed out with a dash */
  available: boolean
  /** why it is unavailable, shown on hover */
  unavailableNote?: string
  rows: ReadinessEmployee[]
}

export interface Readiness {
  checks: ReadinessCheck[]
  /** checks that are blocking AND non-empty — i.e. that cost somebody their payslip */
  blockers: ReadinessCheck[]
  totalEmployees: number
  /** employees with nothing wrong at all */
  cleanEmployees: number
  /** left out of the run — at least one blocking check failed */
  excludedCodes: string[]
  /** the employees the run will actually calculate */
  runnableCodes: string[]
}

const initialsOf = (name: string) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase() || '—'

const blank = (v: any) => v === null || v === undefined || String(v).trim() === ''
const numOr = (v: any, fallback: number) => (blank(v) ? fallback : Number(v) || 0)

// One check definition. `test` returns the impact sentence when the employee fails it,
// and null when they pass — so the wording lives next to the rule it belongs to and the
// two can never drift apart.
interface CheckDef {
  key: string
  label: string
  icon: string
  blocking: boolean
  desc: string
  available: boolean
  unavailableNote?: string
  test?: (r: Record<string, any>) => string | null
}

const CHECKS: CheckDef[] = [
  {
    // Not a fault — a finished job. It sits with the blocking checks because the effect
    // is the same: the run leaves these employees alone. Payroll has already been paid
    // for them, and pressing Run again must not quietly rewrite a payslip that is out.
    key: 'locked', label: 'Already Run', icon: '🔒', blocking: true, available: true,
    desc: 'Left out of the run — payroll has already run for these employees and their month is locked.',
    test: r => (r.is_locked === true
      ? 'Already paid this month. To run again, unlock them in Lock / Unlock with a reason.'
      : null),
  },
  {
    key: 'bank', label: 'Missing Bank', icon: '🏦', blocking: true, available: true,
    desc: 'Left out of the run — payment cannot be initiated without a valid account. Everyone else is still paid.',
    test: r => {
      const noAcct = blank(r.bank_account_number)
      const noIfsc = blank(r.ifsc_code)
      if (!noAcct && !noIfsc) return null
      const what = noAcct && noIfsc ? 'no account number and no IFSC' : noAcct ? 'no account number' : 'no IFSC'
      return `Left out — ${what} to credit. Fix the account, then run again for just this employee.`
    },
  },
  {
    key: 'days', label: 'Zero Paid Days', icon: '📆', blocking: true, available: true,
    desc: 'Left out of the run — attendance is uploaded but says this employee earned no days.',
    // Only counts employees whose attendance HAS arrived and reads zero. A null paid_days
    // is a different problem with a different fix, and it has its own check below.
    test: r => (!blank(r.paid_days) && Number(r.paid_days) <= 0
      ? 'Left out — salary would calculate as ₹0, every earning component prorates to zero.'
      : null),
  },
  {
    key: 'attendance', label: 'Attendance Not Processed', icon: '🕐', blocking: true, available: true,
    desc: 'Left out of the run — no attendance has been uploaded for these employees yet.',
    // The engine skips these rows entirely rather than guessing a full month, so they
    // silently disappear from the register. Silent is exactly what this screen exists to stop.
    test: r => (blank(r.paid_days) && blank(r.attendance_uploaded_at)
      ? 'Left out — nothing to prorate. Upload attendance, then run again for just this employee.'
      : null),
  },
  {
    key: 'ctc', label: 'CTC Not Synced', icon: '🔄', blocking: true, available: true,
    desc: 'Left out of the run — no salary structure was frozen into this month for these employees.',
    test: r => (numOr(r.gross_monthly, 0) <= 0 && numOr(r.basic_monthly, 0) <= 0
      ? 'Left out — payslip would be ₹0. Run Data Sync → Salary, then run again for this employee.'
      : null),
  },
  {
    key: 'hold', label: 'On Hold', icon: '⏸️', blocking: false, available: true,
    desc: 'Still paid — informational, but worth reviewing before you approve the run.',
    test: r => (r.payment_hold === true
      ? 'Included in this run despite the hold flag — confirm this is intended before approving.'
      : null),
  },
  {
    key: 'pan', label: 'Missing PAN', icon: '🪪', blocking: false, available: true,
    desc: 'Still paid — a statutory filing concern, not a payment blocker.',
    test: r => (blank(r.pan_number)
      ? "TDS return (Form 24Q) will reject this employee's row at filing time — fix before quarter-end."
      : null),
  },
  {
    key: 'arrear', label: 'Arrear Not Processed', icon: '📋', blocking: false, available: false,
    desc: 'Arrear days are recorded, but there is no rule yet for what "processed" means.',
    unavailableNote: 'Arrear days are captured in the Month Master, but nothing yet decides when an arrear counts as settled — so this check would either pass everyone or fail everyone.',
  },
]

// Every column any check reads. Listed explicitly so a column that disappears from the
// snapshot fails loudly here rather than quietly marking the whole month clean.
const COLS = [
  // run_id so a filtered run can be pointed at the right company's run in group mode
  'run_id', 'employee_code', 'full_name',
  'department', 'location', 'employment_status',
  'bank_account_number', 'ifsc_code',
  'paid_days', 'attendance_uploaded_at',
  'gross_monthly', 'basic_monthly',
  'payment_hold', 'pan_number', 'is_locked',
].join(', ')

export type SnapshotRow = Record<string, any>

/**
 * Every employee frozen into a month. In group mode a month spans several runs.
 * Loaded once and filtered in memory afterwards: 302 rows is nothing to hold, and a
 * round-trip on every dropdown change would make the filters feel broken.
 */
export async function loadSnapshotRows(
  runs: { id: string; company_name?: string | null }[],
): Promise<SnapshotRow[]> {
  const rows: SnapshotRow[] = []
  for (const run of runs) {
    // Paginated — PostgREST caps a response at 1000 rows and a group month can exceed it.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('payroll_employee_snapshot')
        .select(COLS).eq('run_id', run.id).order('employee_code').range(from, from + 999)
      if (error) throw new Error(error.message)
      const batch = (data || []) as any[]
      batch.forEach(r => rows.push({ ...r, __company: run.company_name || '' }))
      if (batch.length < 1000) break
    }
  }
  return rows
}

/** Status filter sentinel: everyone whose employment_status is not Active. Kept as a
 *  choice of its own because "who is still on the rolls" is the question HR actually
 *  asks — a leaver's exact status word (Resigned / Left / Terminated) varies by record
 *  and picking them one at a time would miss whichever spelling nobody thought of. */
export const NOT_ACTIVE = '__not_active'
const isActive = (r: SnapshotRow) => String(r.employment_status ?? '').trim().toLowerCase() === 'active'

export interface ReadinessFilter {
  company: string
  location: string
  department: string
  /** '' = all · 'Active' · NOT_ACTIVE · or an exact employment_status value */
  status: string
  /** emp code or name — a pasted list of codes works too */
  employee: string
}
export const EMPTY_FILTER: ReadinessFilter = { company: '', location: '', department: '', status: '', employee: '' }
export const isFiltered = (f: ReadinessFilter) =>
  !!(f.company || f.location || f.department || f.status || f.employee.trim())

/** Dropdown choices, taken from the month itself rather than from a master list —
 *  offering a department that nobody in this month belongs to only wastes a click. */
export function filterOptions(rows: SnapshotRow[]) {
  const uniq = (k: string) => Array.from(new Set(rows.map(r => String(r[k] ?? '').trim()).filter(Boolean))).sort()
  return {
    companies: uniq('__company'), locations: uniq('location'), departments: uniq('department'),
    // The exact words present, minus Active — it already has its own entry above them.
    statuses: uniq('employment_status').filter(s => s.toLowerCase() !== 'active'),
  }
}

export function applyFilter(rows: SnapshotRow[], f: ReadinessFilter): SnapshotRow[] {
  // Codes are usually pasted from a sheet, so anything that is not a word character
  // separates them. A single word with no separators falls through to a name search.
  const terms = f.employee.split(/[\s,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
  return rows.filter(r => {
    if (f.company && String(r.__company || '') !== f.company) return false
    if (f.location && String(r.location || '') !== f.location) return false
    if (f.department && String(r.department || '') !== f.department) return false
    if (f.status === 'Active' && !isActive(r)) return false
    if (f.status === NOT_ACTIVE && isActive(r)) return false
    if (f.status && f.status !== 'Active' && f.status !== NOT_ACTIVE
      && String(r.employment_status || '') !== f.status) return false
    if (!terms.length) return true
    const code = String(r.employee_code || '').toLowerCase()
    const name = String(r.full_name || '').toLowerCase()
    return terms.some(t => code === t || code.includes(t) || name.includes(t))
  })
}

/** Run every check against a set of employees. Pure — no database. */
export function computeReadiness(rows: SnapshotRow[]): Readiness {
  const failed = new Set<string>()
  const checks: ReadinessCheck[] = CHECKS.map(def => {
    const out: ReadinessEmployee[] = []
    if (def.available && def.test) {
      for (const r of rows) {
        const impact = def.test(r)
        if (!impact) continue
        if (def.blocking) failed.add(String(r.employee_code))
        out.push({
          code: String(r.employee_code || ''),
          name: String(r.full_name || ''),
          company: String(r.__company || ''),
          initials: initialsOf(String(r.full_name || '')),
          impact,
        })
      }
    }
    return {
      key: def.key, label: def.label, icon: def.icon, blocking: def.blocking,
      desc: def.desc, available: def.available, unavailableNote: def.unavailableNote,
      rows: out,
    }
  })

  const runnableCodes = rows
    .map(r => String(r.employee_code || ''))
    .filter(code => code && !failed.has(code))

  return {
    checks,
    blockers: checks.filter(c => c.blocking && c.rows.length > 0),
    totalEmployees: rows.length,
    cleanEmployees: rows.length - failed.size,
    excludedCodes: Array.from(failed),
    runnableCodes,
  }
}

/** Why people are being left out: "1 missing bank details · 2 without attendance". */
export function blockerSummary(blockers: ReadinessCheck[]): string {
  const phrase: Record<string, (n: number) => string> = {
    locked: n => `${n} already run`,
    bank: n => `${n} missing bank details`,
    days: n => `${n} with zero paid days`,
    attendance: n => `${n} without attendance`,
    ctc: n => `${n} without a salary structure`,
  }
  return blockers
    .map(b => (phrase[b.key] || ((n: number) => `${n} × ${b.label}`))(b.rows.length))
    .join(' · ')
}
