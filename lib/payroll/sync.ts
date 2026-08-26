// lib/payroll/sync.ts — Month Master category-wise sync (migration sql96).
//
// Why this exists, in HR's words: Month Create freezes whatever HRMS held that day.
// Between Month Create and Salary Final, HRMS keeps moving — a new joiner, a CTC
// revision, a bank change. None of that should walk into the frozen month on its own.
// Sync is the gate, and it is per-category so HR can let the bank change in without
// disturbing salary or flexi.
//
// Each category maps to its own Postgres function that writes ONLY its own columns.
// Attendance, OT and arrear belong to no category and are never written by any of them.
import { supabase } from '@/lib/supabase'

// 'global' = FY-level data that is deliberately NOT frozen into a month. Investment
// declaration and its proofs drive every month's TDS at once, so a per-month copy would
// mean twelve stale copies. They are shown here for completeness, not as sync buttons.
export type SyncStatusKey = 'ready' | 'planned' | 'global'

export interface SyncCategory {
  key: string
  label: string
  icon: string
  note: string
  status: SyncStatusKey
  rpc?: string                 // the per-category Postgres function
  /** which counter on payroll_sync_status this category's badge reads */
  countKey?: 'eligible' | 'with_statutory' | 'with_bank' | 'with_salary' | 'with_flexi' | 'with_reject' | 'with_loan' | 'with_decl' | 'with_earnings'
  /** snapshot columns this category owns — the Excel export for the category */
  columns?: string[]
}

// The four Ready categories are the ones with a live source table AND columns frozen
// into payroll_employee_snapshot. Flexi qualifies on both counts — flexi_tds_forms
// feeds flexi_car…flexi_total today — so it is a real category, not a planned one.
export const SYNC_CATEGORIES: SyncCategory[] = [
  {
    key: 'employee', label: 'Employee info', icon: '👤', status: 'ready',
    note: 'Department, designation, DOJ/DOL, cost centre and address. Statutory sits in its own category below.',
    rpc: 'sync_month_employee_info', countKey: 'eligible',
    columns: [
      'employee_code', 'full_name', 'father_name', 'mother_name',
      'employment_type', 'employment_status', 'designation', 'grade',
      'department', 'sub_department', 'cost_centre', 'location',
      'group_doj', 'company_doj', 'date_of_joining', 'date_of_leaving',
      'office_email', 'personal_email',
      'location_state', 'location_district', 'location_city', 'location_pin_code',
      'actual_posted_state', 'actual_posted_district', 'self_declared_state',
      'res_state', 'res_city', 'perm_state', 'perm_city',
      'period_month', 'days_in_month', 'total_days', 'synced_at',
    ],
  },
  {
    key: 'statutory', label: 'Statutory', icon: '⚖️', status: 'ready',
    note: 'PAN, UAN, ESIC and PF account numbers, plus the PF · ESIC · PT · LWF flags and limits. Its own category because a flag changes the payout, a designation does not.',
    rpc: 'sync_month_statutory', countKey: 'with_statutory',
    columns: [
      'employee_code', 'full_name',
      'pan_number', 'uan_number', 'previous_uan', 'esic_number', 'pf_account_number',
      'pf_applicable', 'pf_gross_limit', 'pf_wage_type', 'pf_existing_member', 'pf_scheme_certificate',
      'epf_method', 'epf_wage_limit', 'epf_exemption_reason', 'voluntary_pf_applicable', 'vpf_percent',
      'epf_pension_applicable', 'pension_applicable', 'pension_number', 'eps_monthly',
      'esic_applicable', 'esic_wage_limit', 'esi_dispensary_name',
      'pt_applicable', 'professional_tax_state', 'lwf_applicable', 'lwf_state',
      'wage_category', 'gratuity_eligible',
      'international_employee', 'certificate_of_coverage',
    ],
  },
  {
    key: 'bank', label: 'Bank', icon: '🏦', status: 'ready',
    note: 'Bank name, account number, IFSC and account type. A new joiner arriving through any category comes in with their full row; removals happen only in Employee info.',
    rpc: 'sync_month_bank', countKey: 'with_bank',
    columns: ['employee_code', 'full_name', 'bank_name', 'bank_account_number', 'bank_account_last4', 'ifsc_code', 'account_type'],
  },
  {
    key: 'salary', label: 'Salary', icon: '💰', status: 'ready',
    note: 'CTC, basic, HRA, conveyance, special allowance, gross, employer & employee PF/ESIC — from CTC Master and Salary Structures.',
    rpc: 'sync_month_salary', countKey: 'with_salary',
    columns: [
      'employee_code', 'full_name', 'annual_ctc', 'total_ctc', 'variable_annual',
      'basic_monthly', 'hra_monthly', 'conveyance', 'special_allowance', 'special_allowance_gross',
      'statutory_bonus', 'gross_monthly', 'epf_wage',
      'employer_pf', 'employer_esic', 'gratuity_monthly',
      'employee_pf', 'employee_esic', 'pt_monthly', 'lwf_monthly', 'net_take_home',
    ],
  },
  {
    key: 'flexi', label: 'Flexi (allowances)', icon: '🎛️', status: 'ready',
    note: 'Car lease, driver, fuel, telephone, meal, LTA and the rest — from the employee’s flexi declaration for this financial year.',
    rpc: 'sync_month_flexi', countKey: 'with_flexi',
    columns: [
      'employee_code', 'full_name', 'flexi_regime', 'flexi_car', 'flexi_driver', 'flexi_fuel',
      'flexi_tel', 'flexi_meal', 'flexi_device', 'flexi_attire', 'flexi_pda', 'flexi_lta',
      'flexi_chedu', 'flexi_hostel', 'flexi_total',
    ],
  },
  {
    // The only category whose source is the month itself. Everything above pulls from
    // HRMS; this one multiplies what those already froze — structure × paid_days — and
    // adds whatever the Bulk Uploader posted. So it runs LAST, and running it again
    // after an attendance correction is the normal way to refresh the month's numbers.
    key: 'earnings', label: 'Earned salary', icon: '🧮', status: 'ready',
    note: 'Earned amount for the month = frozen structure × paid days, plus Incentive / Variable / Bonus / Buyout and the Parking · Insurance · Canteen deductions from the Bulk Uploader. Employees whose attendance has not arrived keep a blank earned amount — not zero, or somebody would process salary on it.',
    rpc: 'sync_month_earnings', countKey: 'with_earnings',
    columns: [
      'employee_code', 'full_name', 'payday', 'paid_days', 'total_days',
      'earn_basic_monthly', 'earn_hra_monthly', 'earn_conveyance',
      'earn_special_allowance', 'earn_statutory_bonus',
      'earn_flexi_car', 'earn_flexi_driver', 'earn_flexi_fuel', 'earn_flexi_tel',
      'earn_flexi_meal', 'earn_flexi_device', 'earn_flexi_attire', 'earn_flexi_pda',
      'earn_flexi_lta', 'earn_flexi_chedu', 'earn_flexi_hostel', 'earn_gross_monthly',
      'pay_incentive', 'pay_variable', 'pay_bonus', 'pay_buyout',
      'employee_pf', 'employee_esic', 'pt_monthly', 'lwf_monthly',
      'ded_parking', 'ded_insurance', 'ded_canteen',
      'total_deduction', 'net_pay',
    ],
  },
  {
    // Runs after Earned salary and reads its output, so it is second-last in the
    // chain: EPF wages are Earn_Gross − Earn_HRA, which do not exist until the
    // earned columns have been written.
    key: 'epf', label: 'EPF · EPS · EDLI · Admin', icon: '🏛️', status: 'ready',
    note: 'Code of Wages 50% basic floor, then EPF wages (Earn Gross − Earn HRA), the ceiling from each employee’s own pf_gross_limit, EPS capped at ₹1,250, EDLI at ₹75, and admin charges with the establishment’s ₹500 minimum. Every rate comes from epf_config and wage_rules_config — nothing is hardcoded.',
    rpc: 'sync_month_epf', countKey: 'with_earnings',
    columns: [
      'employee_code', 'full_name', 'paid_days', 'days_in_month',
      'annual_ctc', 'ctc_monthly', 'basic_monthly', 'basic_50_floor',
      'basic_for_wages', 'earn_basic_for_wages', 'basic_50_applied',
      'earn_gross_monthly', 'earn_hra_monthly',
      'pf_applicable', 'pf_gross_limit', 'epf_capped',
      'epf_wages_actual', 'epf_wage_base',
      'epf_employee', 'epf_employer_total', 'epf_employer_diff',
      'eps_wages', 'eps_contribution',
      'edli_wages', 'edli_contribution',
      'admin_wages', 'admin_charges', 'admin_charges_payable',
    ],
  },
  {
    // Reads the earned columns like EPF does, so it runs in the same pass, after them.
    key: 'esic', label: 'ESIC', icon: '🩺', status: 'ready',
    note: 'Employee 0.75% and employer 3.25%, rounded up to the next rupee as ESIC requires. ESIC Wages = MAX(earned basic, 50% of earned gross) is always shown; whether the ₹21,000 ceiling is tested on that or on plain gross is set by esic_config.esic_threshold_basis — on this data the two differ by 135 employees, so the row records which basis judged it. The ceiling is tested on the full-month rate rather than the month’s earnings, so leave cannot push somebody in and out; and once covered at any point in a contribution period (Apr–Sep, Oct–Mar) an employee stays covered for the rest of it.',
    rpc: 'sync_month_esic', countKey: 'with_earnings',
    columns: [
      'employee_code', 'full_name', 'paid_days',
      'esic_applicable', 'esic_number', 'gross_monthly', 'esic_wage_limit',
      'basic_monthly', 'earn_basic_monthly', 'earn_gross_monthly',
      'esic_wages_cw', 'esic_threshold_wage', 'esic_basis',
      'esic_covered', 'esic_cover_reason',
      'esic_wages', 'esic_daily_wage', 'esic_employee_exempt',
      'esic_employee', 'esic_employer', 'esic_total',
    ],
  },
  {
    key: 'pt', label: 'Professional Tax', icon: '⚖️', status: 'ready',
    note: 'Each employee’s PT from pt_config — their state, that month’s column, their gross. A month column per month because PT is not flat across the year: Maharashtra charges ₹300 in February, Tamil Nadu bills twice a year and nothing in the other ten months. PT is a fixed monthly amount, so leave never reduces it. States that levy no PT at all carry an explicit ₹0 row, which is why pt_rate_found matters — a zero and an unconfigured state are different answers.',
    rpc: 'sync_month_pt', countKey: 'eligible',
    columns: [
      'employee_code', 'full_name', 'pt_applicable', 'professional_tax_state',
      'pt_state', 'pt_gross', 'pt_slab', 'pt_rate_found', 'pt_amount', 'pt_reason',
    ],
  },
  {
    key: 'lwf', label: 'Labour Welfare Fund', icon: '🏛️', status: 'ready',
    note: 'Each employee’s LWF from lwf_config — read off their lwf_state, NOT their PT state: the two differ for 300 of 302 employees here. Most states deduct only in June and December, some only in December, so a ₹0 in April is normal rather than missing. Where the state allows it, someone who left mid-period is exempt. LWF is a flat monthly amount — gross and paid days never affect it.',
    rpc: 'sync_month_lwf', countKey: 'eligible',
    columns: [
      'employee_code', 'full_name', 'lwf_applicable', 'lwf_state', 'lwf_state_used',
      'date_of_leaving', 'lwf_month_applicable', 'lwf_exit_exempt', 'lwf_rate_found',
      'lwf_employee', 'lwf_employer', 'lwf_reason',
    ],
  },
  {
    // Employer NPS is a percentage of EARNED basic, not structured basic, so it has to
    // wait for the earnings pass. It sat in the database unwired since sql124 — the
    // function existed, nothing called it, and every month's employer_nps stayed blank.
    key: 'nps', label: 'Employer NPS', icon: '🏛️', status: 'ready',
    note: 'Only for employees whose NPS status is enrolled. Employer contribution = Earned Basic × 10% under the old regime, × 14% under the new one — the rate follows the regime, so an employee who switches regimes changes rate from that month. Anyone not enrolled keeps a blank, not a zero, so that "no NPS" and "NPS of nil" stay distinguishable on the sheet.',
    rpc: 'sync_month_nps', countKey: 'with_earnings',
    columns: [
      'employee_code', 'full_name', 'nps_opted', 'nps_regime_used', 'nps_percent',
      'earn_basic_monthly', 'employer_nps', 'nps_reason',
    ],
  },
  {
    // Runs last of all: arrear is the difference between what a back month actually paid
    // and what the revised structure says it should have, so every other figure for those
    // months has to be settled first.
    key: 'arrear', label: 'Appraisal arrear', icon: '📈', status: 'ready',
    note: 'Where an appraisal is effective in a back month but pays out in this one, the difference for each already-paid month is worked out head by head and lands in the arrear columns. The pay-out month itself is excluded — it gets the new rate through regular salary, so counting it again would pay it twice. Each back month is differenced against what that month actually froze, not against an assumed structure, and pro-rated on that month’s own paid days.',
    rpc: 'sync_month_arrear', countKey: 'eligible',
    columns: [
      'employee_code', 'full_name', 'arrear_appraisal_effective_date', 'arrear_months',
      'basic_monthly', 'hra_monthly', 'special_allowance',
      'arrear_basic', 'arrear_hra', 'arrear_special_allowance',
      'arrear_epf_wage', 'arrear_employee_pf', 'arrear_employer_pf',
      'arrear_total', 'net_pay', 'final_net_pay',
    ],
  },
  {
    key: 'flexi_reimb', label: 'Flexi reimbursement', icon: '🧾', status: 'ready',
    note: 'Rejected bills only. A rejected claim loses its exemption and becomes taxable — that rejected amount is what comes into payroll, against the month the claim was FOR, not the month it was reviewed in.',
    rpc: 'sync_month_flexi_reimb', countKey: 'with_reject',
    columns: ['employee_code', 'full_name'],
  },
  {
    key: 'loan', label: 'Loan', icon: '💳', status: 'ready',
    note: 'This month’s EMI for every active loan, into the “Loan EMI” deduction head. The outstanding balance drops by the EMI and the loan closes itself at zero. An EMI can never be taken twice for the same month.',
    rpc: 'sync_month_loan', countKey: 'with_loan',
    columns: ['employee_code', 'full_name'],
  },
  {
    key: 'inv_decl', label: 'Investment declaration', icon: '📄', status: 'ready',
    // The declaration itself stays FY-global. What this sync does is apply its ONE
    // month-level consequence: the regime the employee chose lands in this month's
    // snapshot. That column used to come from employees.tds_regime via Statutory,
    // which meant a fresh declaration never reached payroll.
    note: 'Applies each employee’s chosen tax regime to this month. The declaration itself stays financial-year data — one declaration drives every month’s TDS, so it is never copied twelve times.',
    rpc: 'sync_month_investment_decl', countKey: 'with_decl',
    columns: ['employee_code', 'full_name', 'tds_regime'],
  },
  {
    key: 'inv_proof', label: 'Investment proofs', icon: '✅', status: 'ready',
    note: 'Opens and refreshes the proof window for everyone who declared. Anyone who has resigned gets their deadline moved to their Date of Leaving — that is the part that changes month to month. Declared but unproven stops being exempt.',
    rpc: 'sync_month_investment_proof', countKey: 'with_decl',
    columns: ['employee_code', 'full_name'],
  },
  {
    // Last of all: the monthly figure depends on everything above it having already
    // settled — this FY's arrear (now taxed as actual income), professional tax for the
    // year, and which regime the investment declaration put the employee on. sql125/126
    // built this to replace tds_declarations.monthly_tds, a single number typed once by
    // the flexi calculator and then frozen for the whole year regardless of an appraisal,
    // unpaid leave, a resignation or an incentive. Every step of the calculation is its
    // own column here, on purpose — see the Payroll Run sheet's TDS block.
    key: 'tds', label: 'TDS', icon: '🧾', status: 'ready',
    note: 'Monthly TDS recomputed from this month’s own numbers — actual income so far this FY, this month, and projected to March (or the date of leaving), less HRA / LTA / professional tax / Chapter VI-A and whatever has already been deducted this FY, divided by the months left. Incentive, variable, bonus and buyout are never projected and instead drive Additional TDS — their tax is taken in full this month, not spread.',
    rpc: 'sync_month_tds', countKey: 'eligible',
    columns: [
      'employee_code', 'full_name',
      'tds_regime_used', 'tds_age_category', 'tds_actual_ytd', 'tds_current_gross', 'tds_arrear', 'tds_projected',
      'tds_perquisites', 'tds_employer_contrib_excess', 'tds_house_property', 'tds_other_income',
      'tds_prev_employer_income', 'tds_prev_employer_tds', 'tds_annual_gross',
      'tds_hra_exempt', 'tds_lta_exempt', 'tds_pt_deduction', 'tds_std_deduction', 'tds_chapter_via',
      'tds_taxable_income', 'tds_slab_tax', 'tds_rebate_87a', 'tds_marginal_relief_87a',
      'tds_surcharge', 'tds_marginal_relief_surcharge', 'tds_cess',
      'tds_annual_liability', 'tds_paid_ytd', 'tds_months_remaining',
      'tds_monthly', 'tds_additional', 'tds_reason',
    ],
  },
]

export interface SyncStatus {
  in_month: number
  eligible: number
  new_joiners: number
  leavers: number
  with_statutory: number
  with_bank: number
  with_salary: number
  with_flexi: number
  with_reject: number
  with_loan: number
  with_decl: number
  /** attendance has arrived = the earned amount can be worked out */
  with_earnings: number
  /** LOCKED / DISBURSED — the database refuses every sync until a formal reopen */
  is_locked: boolean
}
const ZERO: SyncStatus = { in_month: 0, eligible: 0, new_joiners: 0, leavers: 0, with_statutory: 0, with_bank: 0, with_salary: 0, with_flexi: 0, with_reject: 0, with_loan: 0, with_decl: 0, with_earnings: 0, is_locked: false }

// Migration not applied yet → PostgREST can't resolve the function at all. The screen
// says so plainly instead of rendering counters that would silently be zero.
//
// Only a genuinely absent FUNCTION counts. This used to also match `does not exist`,
// which Postgres says for a bad column or table reference *inside* a function that is
// present — so a broken function reported itself as a missing migration, and the screen
// told HR to run sql96 when sql96 was already applied. Anything that is not a missing
// function now surfaces with the database's own words instead of a guess.
const FN_MISSING = /could not find the function|schema cache/i

// ── Filter ────────────────────────────────────────────────────────────────
// HR rarely wants to sync the whole month. The company / location / emp code / name
// filters collapse into a list of emp codes here, and that same list goes to every RPC
// — p_codes is the one clean mechanism on the server (sql98).
// `null` means "no filter" = the whole month, exactly as before.
export interface SyncEmployee { code: string; name: string; location: string; company: string }

/** Everyone HRMS could sync for this month — the pool the filter chooses from. */
export async function loadFilterCandidates(runs: { id: string; company_id?: string; company_name?: string | null }[]): Promise<SyncEmployee[]> {
  const ids = Array.from(new Set(runs.map(r => r.company_id).filter(Boolean))) as string[]
  if (!ids.length) return []
  const byCompany = new Map(runs.map(r => [r.company_id, r.company_name || '']))
  const out: SyncEmployee[] = []
  // locations!location_id — the branch table is `locations`, and the join is named
  // explicitly because employees reaches it through more than one key.
  const { data, error } = await supabase.from('employees')
    .select('emp_code, full_name, company_id, locations!location_id(location_name)')
    .in('company_id', ids).eq('employment_type', 'Employee').order('emp_code')
  if (error) throw new Error(error.message)
  ;(data || []).forEach((e: any) => out.push({
    code: e.emp_code || '', name: e.full_name || '',
    location: e.locations?.location_name || '', company: byCompany.get(e.company_id) || '',
  }))
  return out
}

/** Summed across every run of the month — in Group mode one month spans several. */
export async function loadSyncStatus(runIds: string[], codes: string[] | null = null): Promise<{ status: SyncStatus; missing: boolean; detail: string | null }> {
  if (!runIds.length) return { status: { ...ZERO }, missing: false, detail: null }
  const total: SyncStatus = { ...ZERO }
  for (const id of runIds) {
    const { data, error } = await supabase.rpc('payroll_sync_status', codes ? { p_run_id: id, p_codes: codes } : { p_run_id: id })
    if (error) {
      if (FN_MISSING.test(error.message)) return { status: { ...ZERO }, missing: true, detail: error.message }
      throw new Error(error.message)
    }
    const row = ((data as any[]) || [])[0] || {}
    // In Group mode a month spans companies: counts add up, but ONE locked company
    // locks the whole month — a partial sync across a group is worse than none.
    total.is_locked = total.is_locked || !!row.is_locked
    ;(Object.keys(total) as (keyof SyncStatus)[]).forEach(k => {
      if (k !== 'is_locked') (total as any)[k] += Number(row[k]) || 0
    })
  }
  return { status: total, missing: false, detail: null }
}

/** Run one category's sync across the month's runs. Returns rows touched. */
export async function runCategorySync(cat: SyncCategory, runIds: string[], codes: string[] | null = null): Promise<{ error: string | null; count: number }> {
  if (!cat.rpc) return { error: `${cat.label} has no sync yet.`, count: 0 }
  let count = 0
  for (const id of runIds) {
    const { data, error } = await supabase.rpc(cat.rpc, codes ? { p_run_id: id, p_codes: codes } : { p_run_id: id })
    if (error) {
      return {
        // Name the function the database could not find, rather than guessing a migration
        // number — the guess was wrong often enough to send HR after the wrong file.
        error: FN_MISSING.test(error.message)
          ? `${cat.rpc}() does not exist in this database — the migration that creates it has not been applied. (${error.message})`
          : error.message,
        count,
      }
    }
    count += Number(data) || 0
  }
  return { error: null, count }
}

/** Everything at once — what Month Create runs. Kept for the pre-sql96 fallback. */
export async function runFullSync(runIds: string[]): Promise<{ error: string | null; count: number }> {
  let count = 0
  for (const id of runIds) {
    const { data, error } = await supabase.rpc('sync_payroll_month', { p_run_id: id })
    if (error) return { error: error.message, count }
    count += Number(data) || 0
  }
  return { error: null, count }
}

/** One category's frozen columns, for its Excel export. */
export async function loadCategoryRows(cat: SyncCategory, runs: { id: string; company_name?: string | null }[], codes: string[] | null = null): Promise<Record<string, any>[]> {
  if (!cat.columns) return []
  const cols = Array.from(new Set(['employee_code', 'full_name', ...cat.columns]))
  const out: Record<string, any>[] = []
  for (const r of runs) {
    // Paginated: PostgREST caps a response at 1000 rows.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('payroll_employee_snapshot')
        .select(cols.join(',')).eq('run_id', r.id).order('employee_code').range(from, from + 999)
      if (error) throw new Error(error.message)
      const batch = (data || []) as any[]
      batch.forEach(row => out.push({ Company: r.company_name || '', ...row }))
      if (batch.length < 1000) break
    }
  }
  if (!codes) return out
  const want = new Set(codes)
  return out.filter(r => want.has(String(r.employee_code)))
}
