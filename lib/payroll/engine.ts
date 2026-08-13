// lib/payroll/engine.ts — Payroll calculation engine.
//
// Reads the MONTH MASTER (payroll_employee_snapshot) — nothing else. That is the whole
// point of freezing a month: April's payroll must be computed from April's frozen figures,
// even if the employee's CTC was revised in May. Reading salary_structures live would make
// the freeze meaningless, and a recalculation months later would silently produce a
// different answer than the payslip that was already issued.
//
// Everything the month needs is already in that one row:
//   • pay        — basic / hra / conveyance / special_allowance / statutory_bonus (frozen)
//   • attendance — paid_days out of total_days (HR-supplied, DOJ/DOL aware)
//   • statutory  — pf / esic / pt / lwf flags, limits and states (frozen)
//   • flexi      — special_allowance_gross vs special_allowance = the declared flexi pot
// plus manual_voucher_entries for this run (bonus, incentive, Loan EMI, adjustments)
// and tds_declarations for the FY (monthly TDS).
//
// payroll_runs uses month (1=Apr..12=Mar) + fy (e.g. '2026-27').
import { supabase } from '@/lib/supabase'
import { loadApprovedFlexiClaims } from '@/lib/payroll/flexi-payroll-sync'

const num = (v: any): number => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const round = (n: number) => Math.round(n)

// fy '2026-27' + month(1=Apr) → real calendar {year, month(1-12)}.
function calendarOf(fy: string, month: number): { year: number; cmonth: number; days: number } {
  const startYear = Number(String(fy).split('-')[0]) || new Date().getFullYear()
  const cmonth = month <= 9 ? month + 3 : month - 9   // 1(Apr)→4 … 10(Jan)→1
  const year = month <= 9 ? startYear : startYear + 1
  const days = new Date(year, cmonth, 0).getDate()
  return { year, cmonth, days }
}

// Professional Tax used to live here as a five-state table with
// `PT[state] || PT.Haryana` as the fallback — so an employee in any state the table had
// never heard of was silently charged Haryana's ₹200. Haryana itself was wrong: it levies
// no PT at all. Every rate now lives in pt_config and is resolved by sync_month_pt() into
// pt_amount, which this file reads. See lib/pt/actions.ts and the PT Slabs screen.

// One Month Master row, as the engine reads it.
interface MonthRow {
  employee_id: string; employee_code: string
  basic_monthly: any; hra_monthly: any; conveyance: any
  special_allowance: any; special_allowance_gross: any; statutory_bonus: any
  epf_wage: any; pt_monthly: any; lwf_monthly: any
  pf_applicable: any; esic_applicable: any; pt_applicable: any; lwf_applicable: any
  esic_wage_limit: any; professional_tax_state: any
  esic_employee: any; esic_employer: any
  pt_amount: any; pt_rate_found: any
  lwf_employee: any; lwf_rate_found: any
  voluntary_pf_applicable: any; vpf_percent: any
  days_in_month: any; total_days: any; paid_days: any
  attendance_uploaded_at: any; arrear_days: any; ot_hours: any
}

// Voucher money for one employee this month, split the way payroll needs it.
interface VoucherSplit { additions: number; loan: number; otherDeductions: number; heads: Record<string, number> }

export interface PayrollLine { run_id: string; employee_id: string; [k: string]: any }

// Build one payroll_lines row from the employee's frozen Month Master row.
// Returns a string instead of a line when the employee cannot be paid yet — the caller
// reports it rather than quietly writing a zero payslip.
function calcLineFromMonth(
  runId: string, row: MonthRow, v: VoucherSplit,
  tdsMonthly: number, flexiReimb: number, npsMonthly: number,
): PayrollLine | string {
  const code = row.employee_code || row.employee_id

  // No attendance = no payroll. Paying a full month would be a guess, and paying zero
  // would be worse, so the employee is reported and skipped.
  if (row.attendance_uploaded_at == null && row.paid_days == null) return `${code}: attendance not uploaded`
  if (row.paid_days == null) return `${code}: paid days not set`

  // The denominator is days_in_month, NOT the employee's on-roll days. Those differ only
  // for a mid-month joiner or leaver, and that is exactly the case that matters: someone
  // who joined on the 16th has total_days 15 and paid_days 15, so dividing by total_days
  // would hand them a full month's salary for half a month on roll.
  const totalDays = num(row.days_in_month) || num(row.total_days)
  if (totalDays <= 0) return `${code}: month has no days on record — re-sync Employee info`

  // Paid days stay raw in the database for audit — the confirmed formula can go negative
  // when an employee has absences and no leave — but pay is never negative, and nobody is
  // paid for more days than the month has.
  const paidDays = Math.min(Math.max(0, num(row.paid_days)), totalDays)
  const ratio = paidDays / totalDays

  const basic = round(num(row.basic_monthly) * ratio)
  const hra = round(num(row.hra_monthly) * ratio)
  const conveyance = round(num(row.conveyance) * ratio)
  const special = round(num(row.special_allowance) * ratio)
  const statBonus = round(num(row.statutory_bonus) * ratio)

  // Declared flexi = gross Special Allowance minus the netted one. Whatever is not
  // reimbursed against bills is paid back as taxable pay, so take-home is unchanged
  // whether or not the employee submitted bills.
  const flexiDeclared = Math.max(0, num(row.special_allowance_gross) - num(row.special_allowance))
  const flexiPot = round(flexiDeclared * ratio)
  const flexi = num(flexiReimb)
  const flexiUnclaimed = Math.max(0, flexiPot - flexi)

  const gross = basic + hra + conveyance + special + statBonus + flexiUnclaimed + v.additions

  // Statutory flags and limits come from the frozen row, so a flag flipped in HRMS next
  // month cannot change a payslip that was already issued.
  const pfOn = row.pf_applicable !== false
  const esicOn = row.esic_applicable === true
  const ptOn = row.pt_applicable !== false
  const lwfOn = row.lwf_applicable === true

  const epfWage = Math.min(basic, num(row.epf_wage) || 15000)
  const dedEPF = pfOn ? round(epfWage * 0.12) : 0
  const erPF = pfOn ? round(epfWage * 0.12) : 0
  const gratuity = pfOn ? round(basic * 0.0481) : 0

  // ESIC comes from the Month Master, computed by sync_month_esic against esic_config.
  // It used to be recomputed here with hardcoded 0.75/3.25, ordinary rounding, the
  // ceiling tested against earned gross, and no contribution-period rule — four ways to
  // disagree with the figure on the ESIC challan for the same employee in the same month.
  // The fallback below only covers a month synced before that migration existed.
  const esicLimit = num(row.esic_wage_limit) || 21000
  const esicSynced = row.esic_employee != null || row.esic_employer != null
  const dedESIC = esicSynced ? num(row.esic_employee)
    : (esicOn && gross <= esicLimit ? Math.ceil(gross * 0.0075) : 0)
  const erESIC = esicSynced ? num(row.esic_employer)
    : (esicOn && gross <= esicLimit ? Math.ceil(gross * 0.0325) : 0)

  // PT is a fixed monthly slab amount — never pro-rated.
  // pt_amount comes from pt_config via sync_month_pt. NULL means the employee's state is
  // not configured — nothing is deducted and the row says so, rather than guessing a
  // figure. pt_monthly is the pre-sql108 frozen value, kept only as a fallback for months
  // synced before that migration.
  const dedPT = !ptOn ? 0
    : row.pt_amount != null ? num(row.pt_amount)
      : (row.pt_rate_found === false ? 0 : num(row.pt_monthly))
  // lwf_employee comes from lwf_config via sync_month_lwf, read off the employee's
  // lwf_state. The old fallback of a flat ₹25 was wrong in almost every case: most states
  // deduct only in June and December, several only in December, and the amounts range
  // from ₹0.75 in Delhi to ₹50 in Kerala.
  const dedLWF = !lwfOn ? 0
    : row.lwf_employee != null ? num(row.lwf_employee)
      : (row.lwf_rate_found === false ? 0 : num(row.lwf_monthly))
  const dedVPF = row.voluntary_pf_applicable === true ? round(epfWage * (num(row.vpf_percent) / 100)) : 0

  const dedNPS = num(npsMonthly)
  const dedLoan = v.loan
  const dedTDS = num(tdsMonthly)

  const totalDed = dedEPF + dedVPF + dedESIC + dedPT + dedLWF + dedTDS + dedNPS + dedLoan + v.otherDeductions
  // Approved flexi reimbursement is paid on top of gross, tax-exempt within the declared limit.
  const grossWithFlexi = gross + flexi
  const netPay = grossWithFlexi - totalDed

  return {
    run_id: runId, employee_id: row.employee_id,
    basic, hra, conveyance, special_allow: special, statutory_bonus: statBonus,
    other_earnings: flexiUnclaimed + v.additions,
    gross_earning: grossWithFlexi, flexi_reimbursement: flexi,
    ded_epf: dedEPF, ded_vpf: dedVPF, ded_esic: dedESIC, ded_pt: dedPT, ded_lwf: dedLWF,
    ded_tds: dedTDS, ded_nps: dedNPS, ded_loan_emi: dedLoan,
    total_deductions: totalDed, net_pay: netPay,
    employer_pf: erPF, employer_esic: erESIC, gratuity,
    // payroll_lines has no column for the attendance basis, so it is kept in the JSON —
    // without it nobody can explain months later why a payslip was 20/30 of a salary.
    earnings_json: {
      paid_days: paidDays, total_days: totalDays, ratio: Number(ratio.toFixed(4)),
      raw_paid_days: num(row.paid_days), arrear_days: num(row.arrear_days), ot_hours: num(row.ot_hours),
      basic, hra, conveyance, special_allowance: special, statutory_bonus: statBonus,
      flexi_unclaimed_taxable: flexiUnclaimed, flexi_reimbursement: flexi,
      voucher_additions: v.additions, voucher_heads: v.heads,
    },
    deductions_json: {
      epf: dedEPF, vpf: dedVPF, esic: dedESIC, pt: dedPT, lwf: dedLWF,
      tds: dedTDS, nps: dedNPS, loan_emi: dedLoan, voucher_deductions: v.otherDeductions,
    },
  }
}

export interface RunResult { processed: number; skipped: number; errors: string[]; totalGross: number; totalNet: number }

// Every Month Master column the engine reads. Listed explicitly so a column that
// disappears from the snapshot fails loudly here instead of silently becoming zero pay.
const MONTH_COLS = [
  'employee_id', 'employee_code',
  'basic_monthly', 'hra_monthly', 'conveyance', 'special_allowance', 'special_allowance_gross',
  'statutory_bonus', 'epf_wage', 'pt_monthly', 'lwf_monthly',
  'pf_applicable', 'esic_applicable', 'pt_applicable', 'lwf_applicable',
  'esic_wage_limit', 'professional_tax_state', 'voluntary_pf_applicable', 'vpf_percent',
  'esic_employee', 'esic_employer', 'pt_amount', 'pt_rate_found',
  'lwf_employee', 'lwf_rate_found',
  'days_in_month', 'total_days', 'paid_days', 'attendance_uploaded_at', 'arrear_days', 'ot_hours',
].join(', ')

// Manual vouchers for the run, split per employee. Loan EMI is separated out because
// payroll_lines has its own column for it; everything else lands in additions or
// other-deductions. The Loan sync writes its EMI through this same table, so a loan
// deduction and a hand-entered one behave identically.
async function loadVouchers(runId: string): Promise<Map<string, VoucherSplit>> {
  const out = new Map<string, VoucherSplit>()
  const { data } = await supabase.from('manual_voucher_entries')
    .select('employee_id, head_name, head_type, amount').eq('run_id', runId)
  ;(data || []).forEach((e: any) => {
    const v = out.get(e.employee_id) || { additions: 0, loan: 0, otherDeductions: 0, heads: {} }
    const amt = num(e.amount)
    const isDeduction = String(e.head_type || '').toLowerCase().startsWith('d')
    if (!isDeduction) v.additions += amt
    else if (/loan|advance/i.test(String(e.head_name || ''))) v.loan += amt
    else v.otherDeductions += amt
    v.heads[e.head_name] = (v.heads[e.head_name] || 0) + amt
    out.set(e.employee_id, v)
  })
  return out
}

// Calculate a run → populate payroll_lines + update run totals.
//
// `codes` scopes the run to specific employees. HR needs this constantly: one joiner
// arrived late, one salary was corrected after the run — recalculating all 300 to fix
// one is slow and, worse, silently rewrites 299 payslips that nobody asked to change.
// null = the whole month, which is what a normal run does.
export async function processPayrollRun(runId: string, codes: string[] | null = null): Promise<RunResult> {
  const empty: RunResult = { processed: 0, skipped: 0, errors: [], totalGross: 0, totalNet: 0 }
  const { data: run } = await supabase.from('payroll_runs').select('id, company_id, fy, month').eq('id', runId).single()
  if (!run) return { ...empty, errors: ['Run not found'] }

  // The Month Master IS the input. Paginated because PostgREST caps a response at 1000.
  const all: MonthRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('payroll_employee_snapshot')
      .select(MONTH_COLS).eq('run_id', runId).order('employee_code').range(from, from + 999)
    if (error) return { ...empty, errors: ['Month Master read failed: ' + error.message] }
    const batch = (data || []) as any as MonthRow[]
    all.push(...batch)
    if (batch.length < 1000) break
  }
  if (!all.length) return { ...empty, errors: ['This month has no Month Master rows — run Data Sync → Employee info first.'] }

  // Filtered in memory rather than through .in() — a few hundred rows cost nothing to
  // fetch, and a several-hundred-code list would push the request URL past its limit.
  const wanted = codes ? new Set(codes) : null
  const rows = wanted ? all.filter(r => wanted.has(String(r.employee_code))) : all
  if (!rows.length) return { ...empty, errors: ['None of the selected employees are in this month.'] }

  const cal = calendarOf(run.fy, run.month)
  const empIds = rows.map(r => r.employee_id)

  // Monthly TDS from the FY declaration — Investment Declaration is FY-global by design,
  // so it is read live rather than frozen into the month.
  const tdsMap: Record<string, number> = {}
  try {
    const { data: tds } = await supabase.from('tds_declarations').select('employee_id, monthly_tds').in('employee_id', empIds).eq('fy', run.fy)
    ;(tds || []).forEach((t: any) => { tdsMap[t.employee_id] = num(t.monthly_tds) })
  } catch { /* tds optional */ }

  const npsMap: Record<string, number> = {}
  try {
    const { data: nps } = await supabase.from('nps_declarations').select('employee_id, monthly_nps_amount').in('employee_id', empIds).eq('status', 'ACTIVE')
    ;(nps || []).forEach((n: any) => { npsMap[n.employee_id] = num(n.monthly_nps_amount) })
  } catch { /* nps optional */ }

  // Approved flexi claims for this run's calendar month → reimbursement per employee.
  let flexiMap = new Map<string, { total_flexi_reimbursement: number }>()
  try { flexiMap = await loadApprovedFlexiClaims(run.company_id, cal.year, cal.cmonth) } catch { /* flexi optional */ }

  const vouchers = await loadVouchers(runId)
  const noVoucher: VoucherSplit = { additions: 0, loan: 0, otherDeductions: 0, heads: {} }

  let processed = 0, skipped = 0
  const errors: string[] = []
  const lines: PayrollLine[] = []
  for (const row of rows) {
    try {
      const flexi = flexiMap.get(row.employee_id)?.total_flexi_reimbursement || 0
      const line = calcLineFromMonth(runId, row, vouchers.get(row.employee_id) || noVoucher,
        tdsMap[row.employee_id] || 0, flexi, npsMap[row.employee_id] || 0)
      if (typeof line === 'string') { skipped++; errors.push(line); continue }
      lines.push(line)
    } catch (e: any) { skipped++; errors.push(`${row.employee_code}: ${e?.message || 'calc error'}`) }
  }

  // Written in batches rather than one round-trip per employee — 300 sequential upserts
  // was the slowest part of a run by a wide margin.
  for (let i = 0; i < lines.length; i += 100) {
    const { error } = await supabase.from('payroll_lines').upsert(lines.slice(i, i + 100), { onConflict: 'run_id,employee_id' })
    if (error) { errors.push('Write failed: ' + error.message); break }
    processed += Math.min(100, lines.length - i)
  }

  const { data: written } = await supabase.from('payroll_lines').select('gross_earning, net_pay').eq('run_id', runId)
  const totalGross = (written || []).reduce((s: number, l: any) => s + num(l.gross_earning), 0)
  const totalNet = (written || []).reduce((s: number, l: any) => s + num(l.net_pay), 0)
  await supabase.from('payroll_runs').update({ total_gross: totalGross, total_net: totalNet, updated_at: new Date().toISOString() }).eq('id', runId)

  return { processed, skipped, errors, totalGross, totalNet }
}

// Orchestrator: run the engine then move status OPEN/SYNCED/ATTENDANCE_LOCKED → CALCULATED + audit.
// `codes` runs payroll for only those employees; everyone else's existing line is left
// exactly as it was.
export async function calculateRun(
  run: { id: string; company_id: string; status: string },
  codes: string[] | null = null,
  // A run that covers everyone who COULD be paid is a full run, even though a few
  // employees were left out for missing details — those have no payslip to compute yet.
  // Only HR narrowing the scope by hand makes it partial. The two differ in whether the
  // month may call itself CALCULATED.
  opts: { partial?: boolean; excluded?: string[] } = {},
): Promise<{ error: string | null; result?: RunResult }> {
  // OPEN is allowed because Month Create already builds the Month Master — a month with
  // rows in it IS synced, whatever the status column says. The genuinely-empty case is
  // caught below by processPayrollRun with a message that says what to do about it.
  // Everything from AI_CHECKED onward is refused: a payslip that has been approved or
  // paid out must not silently change underneath the employee who received it.
  if (!['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED'].includes(run.status)) {
    return { error: `This month is ${run.status} — reopen it from Lock / Unlock before recalculating.` }
  }
  const result = await processPayrollRun(run.id, codes)
  if (!result.processed && result.errors.length) return { error: result.errors[0], result }

  // A hand-narrowed run does NOT mark the month CALCULATED — the employees outside the
  // scope still have no payslip, and a status that says otherwise is how an unpaid month
  // gets approved.
  if (!opts.partial) {
    await supabase.from('payroll_runs').update({ status: 'CALCULATED', updated_at: new Date().toISOString() }).eq('id', run.id)
  }
  await supabase.from('payroll_audit_log').insert({
    run_id: run.id, company_id: run.company_id,
    action: opts.partial ? 'PAYROLL_CALCULATED_PARTIAL' : 'PAYROLL_CALCULATED',
    detail: {
      processed: result.processed, skipped: result.skipped, total_net: result.totalNet,
      ...(opts.partial && codes ? { for_employees: codes } : {}),
      // Who did NOT get paid and therefore has to be chased — the single most useful
      // thing to be able to look up a week later.
      ...(opts.excluded?.length ? { left_out: opts.excluded } : {}),
    },
    performed_by: 'HR',
  })
  return { error: null, result }
}
