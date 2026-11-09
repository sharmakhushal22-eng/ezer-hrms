// lib/payroll/statutory-report.ts — Payroll → Statutory & Tax: the employee-wise register of
// every component a statutory deduction touches, one per sub-tab (PF / EPF + VPF, ESIC,
// Professional Tax, LWF, TDS). NPS has its own report (components/payroll/NpsReport).
//
// Every column is a payroll_employee_snapshot column — the month as frozen and calculated by
// Run Payroll — so the register shows exactly what payroll used: the settings the employee
// carried that month, the earnings that make up the statutory wage, the wage itself, the
// contributions, what the CTC structure planned, and any arrear on top.
//
// Pure, no imports: the report component and the tests share it.

export type ColKind = 'text' | 'inr' | 'num' | 'pct' | 'yn' | 'date'
export interface StatCol { key: string; label: string; kind: ColKind; derive?: (r: Record<string, any>) => any }
export interface StatGroup { title: string; cols: StatCol[] }
export interface StatReport {
  key: string
  title: string
  subtitle: string
  /** Snapshot column that says whether the statutory applies to the employee. */
  applicable: (r: Record<string, any>) => boolean
  applicableLabel: string
  /** Columns summed into the stat strip. */
  totals: { key: string; label: string }[]
  groups: StatGroup[]
  notes: string[]
}

const c = (key: string, label: string, kind: ColKind = 'inr', derive?: StatCol['derive']): StatCol => ({ key, label, kind, derive })
const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0)
const yes = (v: any) => v === true || /^(y|yes|true|1)$/i.test(String(v ?? '').trim())

/** The employee columns every register starts with. */
export const IDENTITY: StatCol[] = [
  c('employee_code', 'Emp Code', 'text'), c('full_name', 'Employee Name', 'text'),
  c('department', 'Department', 'text'), c('location', 'Location', 'text'),
  c('date_of_joining', 'DOJ', 'date'), c('date_of_leaving', 'DOL', 'date'),
]

/** The earned heads that add up to the month's gross — what ESIC and PT are worked on. */
const EARNINGS: StatGroup = {
  title: 'Earnings in the wage',
  cols: [
    c('paid_days', 'Paid Days', 'num'), c('days_in_month', 'Days in Month', 'num'),
    c('earn_basic_monthly', 'Earned Basic'), c('earn_hra_monthly', 'Earned HRA'), c('earn_conveyance', 'Earned Conveyance'),
    c('earn_special_allowance', 'Earned Special Allow.'), c('earn_statutory_bonus', 'Earned Stat. Bonus'),
    c('pay_incentive', 'Incentive'), c('pay_variable', 'Variable'), c('pay_bonus', 'Bonus'),
    c('earn_gross_monthly', 'Earned Gross'),
  ],
}

export const STATUTORY_REPORTS: Record<string, StatReport> = {
  pf: {
    key: 'pf', title: 'PF / EPF + VPF Register',
    subtitle: 'Every component EPF, EPS, EDLI, admin charges and VPF are worked out from, employee by employee.',
    applicable: r => yes(r.pf_applicable), applicableLabel: 'PF',
    totals: [
      { key: 'epf_employee', label: 'Employee EPF' }, { key: 'epf_employer_total', label: 'Employer EPF' },
      { key: 'eps_contribution', label: 'EPS' }, { key: 'edli_contribution', label: 'EDLI' }, { key: 'admin_charges', label: 'Admin' },
    ],
    groups: [
      { title: 'PF account', cols: [
        c('uan_number', 'UAN', 'text'), c('previous_uan', 'Previous UAN', 'text'), c('pf_account_number', 'PF A/c No.', 'text'),
        c('pf_existing_member', 'Existing Member', 'yn'), c('pf_scheme_certificate', 'Scheme Certificate', 'text'),
        c('international_employee', 'International Worker', 'yn'), c('certificate_of_coverage', 'Cert. of Coverage', 'text'),
      ] },
      { title: 'PF settings', cols: [
        c('pf_applicable', 'PF Applicable', 'yn'), c('pf_wage_type', 'PF Wage Type', 'text'), c('epf_method', 'EPF Method', 'text'),
        c('pf_gross_limit', 'PF Gross Limit', 'text'), c('epf_wage_limit', 'EPF Wage Ceiling'), c('epf_capped', 'Capped at Ceiling', 'yn'),
        c('epf_exemption_reason', 'Exemption Reason', 'text'),
        c('voluntary_pf_applicable', 'VPF Opted', 'yn'), c('vpf_percent', 'VPF %', 'pct'),
        c('epf_pension_applicable', 'EPS Applicable', 'yn'), c('pension_applicable', 'Pension Applicable', 'yn'), c('pension_number', 'Pension No.', 'text'),
      ] },
      { title: 'Wages for PF', cols: [
        c('paid_days', 'Paid Days', 'num'), c('days_in_month', 'Days in Month', 'num'),
        c('basic_monthly', 'Basic (structure)'), c('basic_50_floor', '50% Wage Floor'), c('basic_50_applied', '50% Floor Applied', 'yn'),
        c('basic_for_wages', 'Basic for Wages'), c('earn_basic_for_wages', 'Earned Basic for Wages'),
        c('earn_gross_monthly', 'Earned Gross'), c('earn_hra_monthly', 'Earned HRA'),
        c('epf_wages_actual', 'EPF Wages (actual)'), c('epf_wage_base', 'EPF Wages (used)'),
      ] },
      { title: 'Contributions', cols: [
        c('epf_employee', 'Employee EPF 12%'),
        c('vpf_amount', 'VPF Amount', 'inr', r => (yes(r.voluntary_pf_applicable) && num(r.vpf_percent) ? Math.round(num(r.epf_wage_base) * num(r.vpf_percent) / 100) : 0)),
        c('epf_employer_total', 'Employer EPF Total'), c('epf_employer_diff', 'Employer EPF (A/c 1)'),
        c('eps_wages', 'EPS Wages'), c('eps_contribution', 'EPS (A/c 10)'),
        c('edli_wages', 'EDLI Wages'), c('edli_contribution', 'EDLI (A/c 21)'),
        c('admin_wages', 'Admin Wages'), c('admin_charges', 'Admin Charges'), c('admin_charges_payable', 'Admin Payable'),
      ] },
      { title: 'CTC structure', cols: [
        c('epf_wage', 'EPF Wage (structure)'), c('employee_pf', 'Employee PF (structure)'), c('employer_pf', 'Employer PF (structure)'), c('eps_monthly', 'EPS (structure)'),
      ] },
      { title: 'Arrear', cols: [c('arrear_epf_wage', 'Arrear EPF Wage'), c('arrear_employee_pf', 'Arrear Employee PF'), c('arrear_employer_pf', 'Arrear Employer PF')] },
    ],
    notes: [
      'EPF wages = Earned Gross − Earned HRA, never below 50% of the wage (Code on Wages), capped at the ceiling for employees whose PF is on the capped wage.',
      'Employee 12% of EPF wages; employer 12% split into EPS 8.33% (capped at ₹1,250) and the EPF difference; EDLI and admin charges on the EDLI / admin wage.',
      'VPF is the employee’s voluntary contribution over the 12%, on the same EPF wage.',
    ],
  },

  esic: {
    key: 'esic', title: 'ESIC Register',
    subtitle: 'Coverage, the ESIC wage and every earning that makes it up, and the employee and employer contributions.',
    applicable: r => yes(r.esic_covered) || num(r.esic_employee) + num(r.esic_employer) > 0, applicableLabel: 'ESIC covered',
    totals: [{ key: 'esic_employee', label: 'Employee 0.75%' }, { key: 'esic_employer', label: 'Employer 3.25%' }, { key: 'esic_total', label: 'Total ESIC' }],
    groups: [
      { title: 'ESIC account', cols: [c('esic_number', 'ESIC IP No.', 'text'), c('esi_dispensary_name', 'Dispensary', 'text'), c('location_state', 'Work State', 'text')] },
      { title: 'Coverage', cols: [
        c('esic_applicable', 'ESIC Applicable', 'yn'), c('esic_wage_limit', 'Wage Ceiling'), c('esic_basis', 'Ceiling Tested On', 'text'),
        c('esic_threshold_wage', 'Wage Tested'), c('esic_covered', 'Covered', 'yn'), c('esic_cover_reason', 'Coverage Reason', 'text'),
        c('esic_employee_exempt', 'Employee Share Exempt', 'yn'),
      ] },
      { title: 'Structure wage', cols: [c('basic_monthly', 'Basic (structure)'), c('gross_monthly', 'Gross (structure)')] },
      EARNINGS,
      { title: 'ESIC wage', cols: [c('esic_wages_cw', 'ESIC Wage (Code on Wages)'), c('esic_wages', 'ESIC Wages'), c('esic_daily_wage', 'Daily Wage')] },
      { title: 'Contributions', cols: [c('esic_employee', 'Employee 0.75%'), c('esic_employer', 'Employer 3.25%'), c('esic_total', 'Total ESIC')] },
      { title: 'CTC structure', cols: [c('employee_esic', 'Employee ESIC (structure)'), c('employer_esic', 'Employer ESIC (structure)')] },
      { title: 'Arrear', cols: [c('arrear_employee_esic', 'Arrear Employee ESIC'), c('arrear_employer_esic', 'Arrear Employer ESIC')] },
    ],
    notes: [
      'ESIC wages = MAX(earned basic, 50% of earned gross); the ₹21,000 ceiling is tested on the full-month rate (esic_config decides on which wage), so leave never moves someone in or out.',
      'Once covered in a contribution period (Apr–Sep, Oct–Mar) an employee stays covered for the rest of it.',
      'Employee 0.75% and employer 3.25%, rounded up to the next rupee.',
    ],
  },

  pt: {
    key: 'pt', title: 'Professional Tax Register',
    subtitle: 'The state, the gross the slab is read on, the slab and the PT deducted, with every earning in that gross.',
    applicable: r => yes(r.pt_applicable), applicableLabel: 'PT',
    totals: [{ key: 'pt_amount', label: 'PT this month' }],
    groups: [
      { title: 'PT settings', cols: [
        c('pt_applicable', 'PT Applicable', 'yn'), c('professional_tax_state', 'PT State (master)', 'text'),
        c('pt_state', 'PT State (used)', 'text'), c('location_state', 'Work State', 'text'),
      ] },
      EARNINGS,
      { title: 'PT computation', cols: [
        c('gross_monthly', 'Gross (structure)'), c('pt_gross', 'Gross for PT'), c('pt_slab', 'Slab', 'text'),
        c('pt_rate_found', 'Rate Configured', 'yn'), c('pt_amount', 'PT Deducted'), c('pt_reason', 'Reason', 'text'),
      ] },
      { title: 'CTC structure', cols: [c('pt_monthly', 'PT (structure)')] },
      { title: 'Arrear', cols: [c('arrear_pt', 'Arrear PT')] },
    ],
    notes: [
      'PT is read off pt_config for the employee’s PT state, that month’s column and their gross; it is a fixed monthly amount, so leave never reduces it.',
      'A state with no PT carries an explicit ₹0 rate; “Rate Configured = N” means the state has no rate set up, which is a different answer.',
    ],
  },

  lwf: {
    key: 'lwf', title: 'Labour Welfare Fund Register',
    subtitle: 'The LWF state, whether this month is an LWF month there, and the employee and employer share.',
    applicable: r => yes(r.lwf_applicable), applicableLabel: 'LWF',
    totals: [{ key: 'lwf_employee', label: 'Employee LWF' }, { key: 'lwf_employer', label: 'Employer LWF' }],
    groups: [
      { title: 'LWF settings', cols: [
        c('lwf_applicable', 'LWF Applicable', 'yn'), c('lwf_state', 'LWF State (master)', 'text'),
        c('lwf_state_used', 'LWF State (used)', 'text'), c('location_state', 'Work State', 'text'), c('pt_state', 'PT State', 'text'),
      ] },
      { title: 'Wage', cols: [c('gross_monthly', 'Gross (structure)'), c('earn_gross_monthly', 'Earned Gross'), c('paid_days', 'Paid Days', 'num')] },
      { title: 'LWF computation', cols: [
        c('lwf_month_applicable', 'LWF Month', 'yn'), c('lwf_exit_exempt', 'Exit Exempt', 'yn'), c('lwf_rate_found', 'Rate Configured', 'yn'),
        c('lwf_employee', 'Employee LWF'), c('lwf_employer', 'Employer LWF'),
        c('lwf_total', 'Total LWF', 'inr', r => num(r.lwf_employee) + num(r.lwf_employer)), c('lwf_reason', 'Reason', 'text'),
      ] },
      { title: 'CTC structure', cols: [c('lwf_monthly', 'LWF (structure)')] },
      { title: 'Arrear', cols: [c('arrear_lwf', 'Arrear LWF')] },
    ],
    notes: [
      'LWF is read off lwf_config by the employee’s LWF state, not their PT state.',
      'Most states deduct only in June and December, some only in December, so ₹0 in other months is normal. Someone who left mid-period is exempt where the state allows it.',
    ],
  },

  tds: {
    key: 'tds', title: 'TDS Computation Register',
    subtitle: 'Income so far and projected, every exemption and deduction, the tax on it and the TDS this month.',
    applicable: r => num(r.tds_monthly) + num(r.tds_additional) > 0, applicableLabel: 'TDS deducted',
    totals: [{ key: 'tds_monthly', label: 'Monthly TDS' }, { key: 'tds_additional', label: 'Additional TDS' }, { key: 'tds_annual_liability', label: 'Annual liability' }],
    groups: [
      { title: 'Tax profile', cols: [
        c('pan_number', 'PAN', 'text'), c('tds_age_category', 'Age Category', 'text'),
        c('tds_regime', 'Regime (declared)', 'text'), c('tds_regime_used', 'Regime (used)', 'text'),
      ] },
      { title: 'Income', cols: [
        c('tds_actual_ytd', 'Actual YTD'), c('tds_current_gross', 'This Month'), c('tds_arrear', 'Arrear'), c('tds_projected', 'Projected to March'),
        c('tds_perquisites', 'Perquisites'), c('tds_employer_contrib_excess', 'Employer PF/NPS Excess'),
        c('tds_house_property', 'House Property'), c('tds_other_income', 'Other Income'),
        c('tds_prev_employer_income', 'Prev. Employer Income'), c('tds_annual_gross', 'Annual Gross'),
      ] },
      { title: 'Exemptions & deductions', cols: [
        c('tds_hra_rent_annual', 'Rent Paid (annual)'), c('tds_hra_metro', 'Metro', 'yn'), c('tds_hra_exempt', 'HRA Exempt'),
        c('tds_lta_exempt', 'LTA Exempt'), c('tds_flexi_exempt', 'Flexi Exempt'), c('tds_pt_deduction', 'PT'),
        c('tds_std_deduction', 'Standard Deduction'), c('tds_chapter_via', 'Chapter VI-A'), c('employer_nps', 'Employer NPS (80CCD2)'),
      ] },
      { title: 'Tax', cols: [
        c('tds_taxable_income', 'Taxable Income'), c('tds_slab_tax', 'Slab Tax'), c('tds_rebate_87a', 'Rebate 87A'),
        c('tds_marginal_relief_87a', 'Marginal Relief 87A'), c('tds_surcharge_rate', 'Surcharge %', 'pct'), c('tds_surcharge', 'Surcharge'),
        c('tds_marginal_relief_surcharge', 'Marginal Relief (Surcharge)'), c('tds_cess', 'Cess 4%'), c('tds_annual_liability', 'Annual Liability'),
      ] },
      { title: 'TDS', cols: [
        c('tds_prev_employer_tds', 'Prev. Employer TDS'), c('tds_paid_ytd', 'Paid YTD'), c('tds_months_remaining', 'Months Left', 'num'),
        c('tds_monthly', 'Monthly TDS'), c('tds_additional', 'Additional TDS'), c('tds_amount', 'TDS This Month'), c('tds_reason', 'Reason', 'text'),
      ] },
    ],
    notes: [
      'Annual income = actual so far this FY + this month + projected to March (or the date of leaving); incentive, variable, bonus and buyout are never projected and are taxed in full in the month paid (Additional TDS).',
      'Monthly TDS = (annual liability − TDS already deducted this FY) ÷ months left.',
    ],
  },
}

/** Every snapshot column a register reads (derived columns are worked out, not selected). */
export function snapshotColumns(rep: StatReport): string[] {
  const keys = new Set<string>(['employee_code', 'full_name', 'company_id', 'department', 'location', 'date_of_joining', 'date_of_leaving'])
  // The applicability tests and the derived columns only read columns a group already shows.
  for (const g of rep.groups) for (const col of g.cols) if (!col.derive) keys.add(col.key)
  return Array.from(keys)
}

/** A cell's value: the snapshot column, or the derived figure. */
export const cellValue = (col: StatCol, r: Record<string, any>) => (col.derive ? col.derive(r) : r[col.key])
export { yes as isYes }
