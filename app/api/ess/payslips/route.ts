// app/api/ess/payslips/route.ts — the ESS payslip list.
//
// WHY THIS ROUTE EXISTS
//
// `payslips` had no ESS endpoint, so the Android app read the table directly
// with the anon key and added the lines up itself. Under the house RLS policy
// that key can read every employee's payslip, which makes the client-side
// `employee_id` filter a courtesy rather than a control — on the one table
// where that matters most.
//
// The existing /api/payroll/payslips is admin-shaped (it answers "show me the
// run"), not employee-shaped ("show me mine").
//
// Identity comes from the session, so a payslip cannot be asked for by id
// alone: every query is scoped to the caller before it reaches the database.
//
// The route also does the arithmetic. Gross, total deductions and net are one
// subtraction that both clients were doing separately, and a payslip whose
// figures disagree between two screens is the kind of bug nobody reports and
// everybody remembers.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** The columns a payslip is made of, and the words the employee reads. */
const EARNINGS: [string, string][] = [
  ['Basic', 'basic'],
  ['House rent allowance', 'hra'],
  ['Other allowances', 'other_allowance'],
  ['Statutory bonus', 'statutory_bonus'],
]
const DEDUCTIONS: [string, string][] = [
  ['Provident fund', 'employee_pf'],
  ['ESIC', 'employee_esic'],
  ['Professional tax', 'professional_tax'],
  ['Labour welfare fund', 'lwf'],
  ['Income tax', 'tds_monthly'],
  ['Loan recovery', 'loan_deduction'],
  ['Advance recovery', 'advance_deduction'],
]

const COLUMNS = 'id, payroll_month, payroll_year, net_pay, '
  + [...EARNINGS, ...DEDUCTIONS].map(([, col]) => col).join(', ')

type Row = Record<string, unknown>

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** A line is only shown when it carries money — an empty row is noise. */
const linesOf = (row: Row, spec: [string, string][]) =>
  spec.map(([label, col]) => ({ label, amount: num(row[col]) })).filter(l => l.amount !== 0)

function shape(row: Row) {
  const earnings = linesOf(row, EARNINGS)
  const deductions = linesOf(row, DEDUCTIONS)
  const gross = earnings.reduce((s, l) => s + l.amount, 0)
  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0)
  const month = Number(row.payroll_month)
  return {
    id: row.id,
    payroll_month: month,
    payroll_year: Number(row.payroll_year),
    label: `${MONTHS[month - 1] ?? ''} ${row.payroll_year}`.trim(),
    earnings,
    deductions,
    gross,
    total_deductions: totalDeductions,
    // net_pay as payroll computed it, with the subtraction alongside so a
    // client never has to choose between them. They should agree; when they do
    // not, payroll's figure is the one that was paid.
    net: num(row.net_pay),
    net_computed: gross - totalDeductions,
  }
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId

  const asked = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 36) : 12
  const month = req.nextUrl.searchParams.get('month') || ''

  let q = sb.from('payslips').select(COLUMNS).eq('employee_id', me)
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number)
    q = q.eq('payroll_year', y).eq('payroll_month', m)
  }

  const { data, error } = await q
    .order('payroll_year', { ascending: false })
    .order('payroll_month', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The column list is built at runtime, so the query builder cannot infer a
  // row type from it — the cast goes through unknown deliberately.
  const rows = (Array.isArray(data) ? data : []) as unknown as Row[]
  return NextResponse.json({
    payslips: rows.map(shape),
    // Payroll has published nothing at all yet — for anybody. Said plainly so
    // the screen can distinguish that from "your payslip is not out yet".
    diagnostics: { noPayslips: !rows.length },
  })
}
