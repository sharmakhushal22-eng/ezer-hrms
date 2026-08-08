// lib/payroll/readiness.ts — the pre-flight check that stands between a payroll month
// and the Run Payroll button.
//
// Every check here answers one question: if HR presses Run right now, who gets hurt?
// That is why each row carries an *impact* sentence rather than a rule name — "Missing
// IFSC" tells nobody anything, "payment will fail, this employee will not be paid this
// cycle" tells them whether it can wait until tomorrow.
//
// Blocking vs non-blocking is the whole point of the screen. A missing bank account
// stops money from moving, so it blocks. A missing PAN is a filing problem in three
// months, so it warns and gets out of the way. Blocking a payroll for a PAN would teach
// HR to ignore the screen entirely, which is worse than not having it.
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
  /** true = Run Payroll stays disabled while this has rows */
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
  /** checks that are blocking AND non-empty */
  blockers: ReadinessCheck[]
  totalEmployees: number
  /** employees with nothing wrong at all */
  cleanEmployees: number
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
    key: 'bank', label: 'Missing Bank', icon: '🏦', blocking: true, available: true,
    desc: 'Blocks the run — payment cannot be initiated without a valid account.',
    test: r => {
      const noAcct = blank(r.bank_account_number)
      const noIfsc = blank(r.ifsc_code)
      if (!noAcct && !noIfsc) return null
      const what = noAcct && noIfsc ? 'no account number and no IFSC' : noAcct ? 'no account number' : 'no IFSC'
      return `Payment will fail — ${what} to credit. Employee will not be paid this cycle.`
    },
  },
  {
    key: 'days', label: 'Zero Paid Days', icon: '📆', blocking: true, available: true,
    desc: 'Blocks the run — attendance is uploaded but says this employee earned no days.',
    // Only counts employees whose attendance HAS arrived and reads zero. A null paid_days
    // is a different problem with a different fix, and it has its own check below.
    test: r => (!blank(r.paid_days) && Number(r.paid_days) <= 0
      ? 'Salary will calculate as ₹0 — every earning component prorates to zero.'
      : null),
  },
  {
    key: 'attendance', label: 'Attendance Not Processed', icon: '🕐', blocking: true, available: true,
    desc: 'Blocks the run — no attendance has been uploaded for these employees yet.',
    // The engine skips these rows entirely rather than guessing a full month, so they
    // silently disappear from the register. Silent is exactly what this screen exists to stop.
    test: r => (blank(r.paid_days) && blank(r.attendance_uploaded_at)
      ? 'No payslip at all — the engine skips this employee, so they drop out of the register unnoticed.'
      : null),
  },
  {
    key: 'ctc', label: 'CTC Not Synced', icon: '🔄', blocking: true, available: true,
    desc: 'Blocks the run — no salary structure was frozen into this month for these employees.',
    test: r => (numOr(r.gross_monthly, 0) <= 0 && numOr(r.basic_monthly, 0) <= 0
      ? 'Payslip of ₹0 — nothing to prorate. Run Data Sync → Salary before paying.'
      : null),
  },
  {
    key: 'hold', label: 'On Hold', icon: '⏸️', blocking: false, available: true,
    desc: 'Does not block the run — informational, but worth reviewing before you proceed.',
    test: r => (r.payment_hold === true
      ? 'Included in this run despite the hold flag — confirm this is intended before approving.'
      : null),
  },
  {
    key: 'pan', label: 'Missing PAN', icon: '🪪', blocking: false, available: true,
    desc: 'Does not block the run — a statutory filing concern, not a payment blocker.',
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
  'employee_code', 'full_name',
  'bank_account_number', 'ifsc_code',
  'paid_days', 'attendance_uploaded_at',
  'gross_monthly', 'basic_monthly',
  'payment_hold', 'pan_number',
].join(', ')

/** Run every check against a month. In group mode a month spans several runs. */
export async function loadReadiness(
  runs: { id: string; company_name?: string | null }[],
): Promise<Readiness> {
  const rows: Record<string, any>[] = []
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

  return {
    checks,
    blockers: checks.filter(c => c.blocking && c.rows.length > 0),
    totalEmployees: rows.length,
    cleanEmployees: rows.length - failed.size,
  }
}

/** One-line summary for the banner: "1 employee missing bank details · 1 has zero paid days". */
export function blockerSummary(blockers: ReadinessCheck[]): string {
  const phrase: Record<string, (n: number) => string> = {
    bank: n => `${n} employee${n === 1 ? '' : 's'} missing bank details`,
    days: n => `${n} employee${n === 1 ? ' has' : 's have'} zero paid days`,
    attendance: n => `${n} employee${n === 1 ? '' : 's'} without attendance`,
    ctc: n => `${n} employee${n === 1 ? '' : 's'} without a salary structure`,
  }
  return blockers
    .map(b => (phrase[b.key] || ((n: number) => `${n} × ${b.label}`))(b.rows.length))
    .join(' · ')
}
