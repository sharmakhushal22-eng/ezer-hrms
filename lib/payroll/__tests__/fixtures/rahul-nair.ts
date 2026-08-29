// The verified reference case — Rahul Nair, SRS0512, October 2026, Old Regime.
// Every figure below is taken from Reference-Payslip-RahulNair-Oct2026.pdf and
// 03-PAYSLIP-Format-Spec.md, expressed as the rows the API route would have fetched.
// The engine's stored tds_* figures are typed in as the engine would have stored
// them: the assembler must READ them, so the test proves it reads them correctly.
import type { AssembleInput } from '../../payslip.ts'

export const RAHUL_NAIR: AssembleInput = {
  run: { fy: '2026-27', month: 7, period_label: 'October 2026' },
  company: {
    company_name: 'SRS Retail Solutions Pvt Ltd',
    reg_office: 'Plot No. 42, Sector 95A, Udyog Vihar, Gurugram, Haryana - 122015',
    cin: 'U74999HR2019PTC098234', short_name: 'SRS',
  },
  snapshot: {
    employee_code: 'SRS0512', full_name: 'Rahul Nair', department: 'Technology', sub_department: 'Frontend Platform',
    designation: 'Distinguished Engineer - UI', date_of_birth: '1991-11-18', company_doj: '2019-03-12', group_doj: '2019-03-12',
    date_of_leaving: null, location: 'Gurugram Corp Office', location_city: 'GURUGRAM', location_state: 'Haryana',
    ifsc_code: 'HDFC0001234', bank_account_number: '50100234567821', pan_number: 'AAXPN1234K',
    pf_account_number: 'HR/GGN/0089123/000/0000512', pf_applicable: true, uan_number: '100761822910',
    esic_number: null, esic_applicable: false,
    paid_days: 31, absent_days: 0, arrear_days: 0, days_in_month: 31,
    basic_monthly: 100000, hra_monthly: 50000, special_allowance: 45000, conveyance: 0, statutory_bonus: 0,
    earn_basic_monthly: 100000, earn_hra_monthly: 50000, earn_special_allowance: 45000, earn_conveyance: 0, earn_statutory_bonus: 0,
    flexi_fuel: 3000, flexi_driver: 3000, flexi_attire: 1500, flexi_meal: 2200, flexi_tel: 1000, flexi_lta: 4167,
    earn_flexi_fuel: 3000, earn_flexi_driver: 3000, earn_flexi_attire: 1500, earn_flexi_meal: 2200, earn_flexi_tel: 1000, earn_flexi_lta: 4167,
    pay_incentive: 0, pay_variable: 0, pay_bonus: 0, pay_buyout: 0,
    ded_parking: 1500, ded_insurance: 0, ded_canteen: 0,
    tds_regime_used: 'OLD', tds_monthly: 30171, tds_additional: 0, tds_months_remaining: 6,
    tds_annual_liability: 362045, tds_paid_ytd: 181020, tds_prev_employer_tds: 0, tds_prev_employer_income: 0,
    tds_std_deduction: 50000, tds_pt_deduction: 0, tds_chapter_via: 96600, tds_other_income: 0, tds_perquisites: 0, tds_house_property: 0,
    tds_taxable_income: 1785400, tds_slab_tax: 348120, tds_rebate_87a: 0, tds_surcharge: 0, tds_cess: 13925,
    tds_hra_metro: true, tds_hra_rent_annual: 600000, tds_hra_leg_actual: 600000, tds_hra_leg_pct_basic: 600000,
    tds_hra_leg_rent_less_10: 480000, tds_hra_exempt: 480000,
    tds_worksheet: {
      gross: 2518404, exempt: 586404, taxable: 1932000,
      rows: [
        { head: 'basic', label: 'BASIC', gross: 1200000, exempt: 0, taxable: 1200000 },
        { head: 'hra', label: 'HRA', gross: 600000, exempt: 480000, taxable: 120000 },
        { head: 'special_allowance', label: 'Spl. Allowance', gross: 540000, exempt: 0, taxable: 540000 },
        { head: 'FUEL', label: 'Car Fuel (Flexi)', gross: 36000, exempt: 0, taxable: 36000 },
        { head: 'DRIVER', label: 'Driver (Flexi)', gross: 36000, exempt: 0, taxable: 36000 },
        { head: 'ATTIRE', label: 'Corp Attire (Flexi)', gross: 18000, exempt: 18000, taxable: 0 },
        { head: 'MEAL', label: 'Meal Card (Flexi)', gross: 26400, exempt: 26400, taxable: 0 },
        { head: 'TEL', label: 'Telephone (Flexi)', gross: 12000, exempt: 12000, taxable: 0 },
        { head: 'LTA', label: 'LTA (Flexi)', gross: 50004, exempt: 50004, taxable: 0 },
      ],
    },
  },
  line: {
    gross_earning: 209867, flexi_reimbursement: 0,
    ded_epf: 1800, ded_vpf: 0, ded_esic: 0, ded_pt: 0, ded_lwf: 35, ded_nps: 0, ded_loan_emi: 0,
    ded_tds: 30171, ded_additional_tax: 0,
    total_deductions: 33506, net_pay: 176361,
    deductions_json: { voucher_deductions: 1500 },
  },
  declaration: { regime: 'OLD', sec_80c: 71600, sec_80d: 25000, monthly_rent: 50000, is_metro: true, lta_claimed: 50004 },
  declarationLines: [
    { section_code: '80C_EPF', declared_amount: 21600 },
    { section_code: '80C_LIC', declared_amount: 50000 },
  ],
  vouchers: [{ head_name: 'Parking Ded', head_type: 'Deduction', amount: 1500 }],
  priorMonths: [1, 2, 3, 4, 5, 6].map(month => ({ month, tds_monthly: 30170, tds_additional: 0 })),
}
