// ============================================================
// EZER HRMS — Reports Module
// Path: app/dashboard/reports/page.tsx
// 16 employee / salary / leave / statutory / tax reports.
// Data is pulled live from Supabase and filtered client-side.
// RBAC: masked Aadhaar / bank shown to everyone; full numbers are
//       stored encrypted and are NOT rendered here.
// ============================================================
'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

// ─── EZER Palette ────────────────────────────────────────────
const C = {
  bg: '#F5F3FF',
  navy: '#1E1B4B',
  purple: '#7C3AED',
  purpleDark: '#3C3489',
  purpleBg: '#EEEDFE',
  card: '#FFFFFF',
  border: '#E9E7F5',
  muted: '#6B6B7B',
  green: '#059669',
  greenBg: '#ECFDF5',
  amber: '#D97706',
  amberBg: '#FFFBEB',
  red: '#DC2626',
};

// ─── Types ────────────────────────────────────────────────────
interface ReportColumn {
  key: string;
  label: string;
  format?: 'date' | 'currency' | 'masked_aadhaar' | 'masked_bank' | 'badge' | 'boolean';
}
interface FilterConfig {
  key: string;
  label: string;
  type: 'select' | 'date_range' | 'text' | 'multiselect';
  options?: string[];
  // field on the flattened row this filter matches (defaults to key)
  field?: string;
}
interface ReportConfig {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  columns: ReportColumn[];
  filters: FilterConfig[];
  // secondary table joined per-employee (one output row per secondary record)
  join?: 'ctc_master' | 'vpf_declarations' | 'nps_declarations' | 'flexi_declarations' | 'tds_declarations' | 'leave_balances';
  // pre-filter the base employee set
  scope?: 'active' | 'exited' | 'confirmation_due' | 'all';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Report Definitions ──────────────────────────────────────
const REPORTS: ReportConfig[] = [
  // 1. EMPLOYEE MASTER
  {
    id: 'emp_master',
    label: 'Employee Master',
    description: 'Complete employee profile — identity, employment, contact, statutory details',
    icon: '👤',
    category: 'Employee',
    scope: 'all',
    filters: [
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
      { key: 'location', label: 'Location / Branch', type: 'select', field: 'location_name' },
      { key: 'employment_type', label: 'Employment Type', type: 'select', options: ['Employee','Intern','Contract','Consultant','NAPS','NATS'] },
      { key: 'employment_status', label: 'Status', type: 'select', options: ['Active','Resigned','Terminated','Absconded'] },
      { key: 'grade', label: 'Grade', type: 'select' },
      { key: 'doj_range', label: 'Date of Joining Range', type: 'date_range', field: 'company_doj' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'salutation', label: 'Salutation' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'date_of_birth', label: 'Date of Birth', format: 'date' },
      { key: 'gender', label: 'Gender', format: 'badge' },
      { key: 'father_name', label: "Father's Name" },
      { key: 'mother_name', label: "Mother's Name" },
      { key: 'spouse_name', label: 'Spouse Name' },
      { key: 'marital_status', label: 'Marital Status', format: 'badge' },
      { key: 'blood_group', label: 'Blood Group', format: 'badge' },
      { key: 'nationality', label: 'Nationality' },
      { key: 'religion', label: 'Religion' },
      { key: 'birth_place', label: 'Birth Place' },
      { key: 'employment_type', label: 'Employment Type', format: 'badge' },
      { key: 'employment_status', label: 'Status', format: 'badge' },
      { key: 'designation', label: 'Designation' },
      { key: 'grade', label: 'Grade' },
      { key: 'band', label: 'Band' },
      { key: 'department_name', label: 'Department' },
      { key: 'location_name', label: 'Location' },
      { key: 'company_name', label: 'Company' },
      { key: 'group_doj', label: 'Group DOJ', format: 'date' },
      { key: 'company_doj', label: 'Company DOJ', format: 'date' },
      { key: 'confirmation_status', label: 'Confirmation Status', format: 'badge' },
      { key: 'confirmation_date', label: 'Confirmation Date', format: 'date' },
      { key: 'l1_manager_name', label: 'L1 Manager' },
      { key: 'hr_manager_name', label: 'HR Manager' },
      { key: 'notice_period_days', label: 'Notice Period (Days)' },
      { key: 'collar_type', label: 'Collar Type', format: 'badge' },
      { key: 'work_location_type', label: 'Work Mode', format: 'badge' },
      { key: 'cost_centre', label: 'Cost Centre' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'personal_email', label: 'Personal Email' },
      { key: 'office_email', label: 'Office Email' },
      { key: 'emergency_name', label: 'Emergency Contact' },
      { key: 'emergency_relation', label: 'Emergency Relation' },
      { key: 'emergency_mobile', label: 'Emergency Mobile' },
      { key: 'res_address1', label: 'Residential Address' },
      { key: 'res_city', label: 'Res City' },
      { key: 'res_state', label: 'Res State' },
      { key: 'res_pin', label: 'Res PIN' },
      { key: 'perm_address1', label: 'Permanent Address' },
      { key: 'perm_city', label: 'Perm City' },
      { key: 'perm_state', label: 'Perm State' },
      { key: 'perm_pin', label: 'Perm PIN' },
      { key: 'pan_number', label: 'PAN Number' },
      { key: 'aadhar_last4', label: 'Aadhaar (Masked)', format: 'masked_aadhaar' },
      { key: 'uan_number', label: 'UAN Number' },
      { key: 'pf_account_number', label: 'PF Account' },
      { key: 'esic_number', label: 'ESIC IP Number' },
      { key: 'bank_name', label: 'Bank Name' },
      { key: 'bank_account_last4', label: 'Account (Masked)', format: 'masked_bank' },
      { key: 'ifsc_code', label: 'IFSC Code' },
      { key: 'account_type', label: 'Account Type' },
      { key: 'pf_applicable', label: 'PF Applicable', format: 'boolean' },
      { key: 'epf_method', label: 'EPF Method' },
      { key: 'epf_wage_limit', label: 'EPF Wage Limit', format: 'currency' },
      { key: 'esic_applicable', label: 'ESIC Applicable', format: 'boolean' },
      { key: 'pt_applicable', label: 'PT Applicable', format: 'boolean' },
      { key: 'professional_tax_state', label: 'PT State' },
      { key: 'lwf_applicable', label: 'LWF Applicable', format: 'boolean' },
      { key: 'lwf_state', label: 'LWF State' },
      { key: 'gratuity_eligible', label: 'Gratuity Eligible', format: 'boolean' },
      { key: 'tds_regime', label: 'TDS Regime', format: 'badge' },
    ],
  },

  // 2. CTC REPORT
  {
    id: 'ctc_report',
    label: 'CTC Report',
    description: 'Annual CTC breakup — fixed, variable, basic, HRA, EPF wage limit per employee',
    icon: '💰',
    category: 'Salary',
    join: 'ctc_master',
    scope: 'all',
    filters: [
      { key: 'fy', label: 'Financial Year', type: 'select', options: ['2026-27','2025-26','2024-25'] },
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
      { key: 'grade', label: 'Grade', type: 'select' },
      { key: 'employment_type', label: 'Employment Type', type: 'select', options: ['Employee','Intern','Contract'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'grade', label: 'Grade' },
      { key: 'company_name', label: 'Company' },
      { key: 'fy', label: 'FY' },
      { key: 'annual_ctc', label: 'Annual CTC', format: 'currency' },
      { key: 'annual_variable', label: 'Annual Variable', format: 'currency' },
      { key: 'basic_annual', label: 'Annual Basic', format: 'currency' },
      { key: 'hra_annual', label: 'Annual HRA', format: 'currency' },
      { key: 'epf_wage_limit', label: 'EPF Wage Limit', format: 'currency' },
      { key: 'effective_from', label: 'W.E.F Date', format: 'date' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
  },

  // 3. BANK DETAILS REPORT
  {
    id: 'bank_report',
    label: 'Bank Details Report',
    description: 'Employee bank account details (masked) — for salary disbursement & NEFT file',
    icon: '🏦',
    category: 'Employee',
    scope: 'all',
    filters: [
      { key: 'employment_status', label: 'Status', type: 'select', options: ['Active','Resigned'] },
      { key: 'bank_name', label: 'Bank Name', type: 'select' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'company_name', label: 'Company' },
      { key: 'bank_name', label: 'Bank Name' },
      { key: 'account_type', label: 'Account Type' },
      { key: 'bank_account_last4', label: 'Account (Masked)', format: 'masked_bank' },
      { key: 'ifsc_code', label: 'IFSC Code' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'employment_status', label: 'Status', format: 'badge' },
    ],
  },

  // 4. BRANCH WISE EMPLOYEE REPORT
  {
    id: 'branch_wise',
    label: 'Branch / Location-wise Employee',
    description: 'Headcount and employee list by branch, location, or state',
    icon: '🏢',
    category: 'Employee',
    scope: 'all',
    filters: [
      { key: 'state', label: 'State', type: 'select', field: 'res_state' },
      { key: 'location', label: 'Branch / Location', type: 'select', field: 'location_name' },
      { key: 'employment_type', label: 'Employment Type', type: 'select', options: ['Employee','Intern','Contract','Consultant'] },
      { key: 'employment_status', label: 'Status', type: 'select', options: ['Active','Resigned'] },
    ],
    columns: [
      { key: 'location_name', label: 'Branch / Location' },
      { key: 'res_state', label: 'State' },
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'employment_type', label: 'Employment Type', format: 'badge' },
      { key: 'employment_status', label: 'Status', format: 'badge' },
      { key: 'group_doj', label: 'Group DOJ', format: 'date' },
      { key: 'company_doj', label: 'Company DOJ', format: 'date' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'l1_manager_name', label: 'Reporting Manager' },
    ],
  },

  // 5. BLOOD GROUP REPORT
  {
    id: 'blood_group',
    label: 'Blood Group Report',
    description: 'Employee list with blood group — useful for emergency & medical records',
    icon: '🩸',
    category: 'Employee',
    scope: 'active',
    filters: [
      { key: 'blood_group', label: 'Blood Group', type: 'select', options: ['A+','A-','B+','B-','O+','O-','AB+','AB-'] },
      { key: 'location', label: 'Branch / Location', type: 'select', field: 'location_name' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'blood_group', label: 'Blood Group', format: 'badge' },
      { key: 'gender', label: 'Gender', format: 'badge' },
      { key: 'date_of_birth', label: 'Date of Birth', format: 'date' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'emergency_name', label: 'Emergency Contact' },
      { key: 'emergency_mobile', label: 'Emergency Mobile' },
      { key: 'location_name', label: 'Branch' },
      { key: 'department_name', label: 'Department' },
    ],
  },

  // 6. GENDER REPORT
  {
    id: 'gender_report',
    label: 'Gender Diversity Report',
    description: 'Employee count and list by gender — for diversity metrics & compliance',
    icon: '🧑‍🤝‍🧑',
    category: 'Employee',
    scope: 'all',
    filters: [
      { key: 'gender', label: 'Gender', type: 'select', options: ['Male','Female','Other'] },
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
      { key: 'employment_status', label: 'Status', type: 'select', options: ['Active','Resigned','Terminated'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'gender', label: 'Gender', format: 'badge' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'grade', label: 'Grade' },
      { key: 'company_doj', label: 'Date of Joining', format: 'date' },
      { key: 'employment_type', label: 'Type', format: 'badge' },
      { key: 'location_name', label: 'Branch' },
    ],
  },

  // 7. LEAVE REPORT
  {
    id: 'leave_report',
    label: 'Leave Report',
    description: 'Leave balance, accrued, used & closing per employee — all leave types',
    icon: '🌴',
    category: 'Leave',
    join: 'leave_balances',
    scope: 'all',
    filters: [
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'department_name', label: 'Department' },
      { key: 'leave_type', label: 'Leave Type' },
      { key: 'opening_balance', label: 'Opening' },
      { key: 'accrued', label: 'Accrued' },
      { key: 'used', label: 'Used' },
      { key: 'encashed', label: 'Encashed' },
      { key: 'closing_balance', label: 'Closing' },
    ],
  },

  // 8. FLEXI DECLARATION REPORT
  {
    id: 'flexi_report',
    label: 'Flexi Declaration Report',
    description: 'Employee-wise flexi (FBP) component declarations — old & new regime amounts',
    icon: '💼',
    category: 'Salary',
    join: 'flexi_declarations',
    scope: 'all',
    filters: [
      { key: 'fy', label: 'Financial Year', type: 'select', options: ['2026-27','2025-26'] },
      { key: 'status', label: 'Declaration Status', type: 'select', options: ['SUBMITTED','DRAFT'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'tds_regime', label: 'Regime', format: 'badge' },
      { key: 'fy', label: 'FY' },
      { key: 'component_code', label: 'Component', format: 'badge' },
      { key: 'old_regime_amt', label: 'Old Regime (₹)', format: 'currency' },
      { key: 'new_regime_amt', label: 'New Regime (₹)', format: 'currency' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'submitted_at', label: 'Submitted On', format: 'date' },
    ],
  },

  // 9. INVESTMENT DECLARATION REPORT
  {
    id: 'investment_report',
    label: 'Investment Declaration Report',
    description: 'Employee 80C, 80D, HRA, NPS declarations — for TDS computation',
    icon: '📋',
    category: 'Tax',
    join: 'tds_declarations',
    scope: 'all',
    filters: [
      { key: 'fy', label: 'Financial Year', type: 'select', options: ['2026-27','2025-26'] },
      { key: 'regime', label: 'Regime', type: 'select', options: ['OLD','NEW'] },
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'tds_regime', label: 'Chosen Regime', format: 'badge' },
      { key: 'sec_80c', label: '80C Amount', format: 'currency' },
      { key: 'sec_80d', label: '80D Amount', format: 'currency' },
      { key: 'sec_80e', label: '80E (Edu Loan)', format: 'currency' },
      { key: 'sec_24b', label: '24(b) Home Loan', format: 'currency' },
      { key: 'hra_claimed', label: 'HRA Claimed', format: 'currency' },
      { key: 'lta_claimed', label: 'LTA Claimed', format: 'currency' },
      { key: 'nps_80ccd1b', label: 'NPS 80CCD(1B)', format: 'currency' },
      { key: 'employer_nps_80ccd2', label: 'Employer NPS 80CCD(2)', format: 'currency' },
      { key: 'total_declared', label: 'Total Declared', format: 'currency' },
      { key: 'annual_tax_old', label: 'Tax (Old)', format: 'currency' },
      { key: 'annual_tax_new', label: 'Tax (New)', format: 'currency' },
      { key: 'monthly_tds', label: 'Monthly TDS', format: 'currency' },
      { key: 'declaration_status', label: 'Status', format: 'badge' },
    ],
  },

  // 10. STATUTORY DETAILS REPORT
  {
    id: 'statutory_report',
    label: 'Statutory Details Report',
    description: 'PF, ESIC, PT, LWF applicability and IDs per employee',
    icon: '⚖️',
    category: 'Statutory',
    scope: 'all',
    filters: [
      { key: 'location', label: 'Branch', type: 'select', field: 'location_name' },
      { key: 'pf_applicable', label: 'PF Applicable', type: 'select', options: ['Yes','No'] },
      { key: 'esic_applicable', label: 'ESIC Applicable', type: 'select', options: ['Yes','No'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'company_doj', label: 'DOJ', format: 'date' },
      { key: 'pf_applicable', label: 'PF Applicable', format: 'boolean' },
      { key: 'uan_number', label: 'UAN' },
      { key: 'pf_account_number', label: 'PF Account' },
      { key: 'epf_method', label: 'EPF Method', format: 'badge' },
      { key: 'epf_wage_limit', label: 'EPF Wage Limit', format: 'currency' },
      { key: 'esic_applicable', label: 'ESIC Applicable', format: 'boolean' },
      { key: 'esic_number', label: 'ESIC IP No' },
      { key: 'pt_applicable', label: 'PT Applicable', format: 'boolean' },
      { key: 'professional_tax_state', label: 'PT State' },
      { key: 'lwf_applicable', label: 'LWF Applicable', format: 'boolean' },
      { key: 'lwf_state', label: 'LWF State' },
      { key: 'gratuity_eligible', label: 'Gratuity Eligible', format: 'boolean' },
    ],
  },

  // 11. BIRTHDAY / ANNIVERSARY REPORT
  {
    id: 'birthday_report',
    label: 'Birthday & Anniversary Report',
    description: 'Employee birthdays and work anniversaries by month',
    icon: '🎂',
    category: 'Employee',
    scope: 'active',
    filters: [
      { key: 'birth_month', label: 'Birthday Month', type: 'select', options: MONTHS },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'date_of_birth', label: 'Date of Birth', format: 'date' },
      { key: 'group_doj', label: 'Work Anniversary Date', format: 'date' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'location_name', label: 'Branch' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'office_email', label: 'Office Email' },
    ],
  },

  // 12. CONFIRMATION DUE REPORT
  {
    id: 'confirmation_due',
    label: 'Confirmation Due Report',
    description: 'Active employees not yet confirmed — probation review pending',
    icon: '✅',
    category: 'Employee',
    scope: 'confirmation_due',
    filters: [
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'company_doj', label: 'Date of Joining', format: 'date' },
      { key: 'confirmation_status', label: 'Status', format: 'badge' },
      { key: 'confirmation_date', label: 'Confirmation Date', format: 'date' },
      { key: 'l1_manager_name', label: 'Reporting Manager' },
      { key: 'hr_manager_name', label: 'HR Manager' },
    ],
  },

  // 13. ATTRITION REPORT
  {
    id: 'attrition_report',
    label: 'Attrition / Exit Report',
    description: 'Resigned, terminated, or absconded employees with exit details',
    icon: '🚪',
    category: 'Employee',
    scope: 'exited',
    filters: [
      { key: 'exit_date_range', label: 'Exit Date Range', type: 'date_range', field: 'last_working_date' },
      { key: 'leaving_reason', label: 'Exit Reason', type: 'select' },
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'company_doj', label: 'Date of Joining', format: 'date' },
      { key: 'last_working_date', label: 'Last Working Date', format: 'date' },
      { key: 'relieving_date', label: 'Relieving Date', format: 'date' },
      { key: 'leaving_reason', label: 'Exit Reason', format: 'badge' },
      { key: 'date_of_resignation', label: 'Resignation Date', format: 'date' },
      { key: 'notice_period_days', label: 'Notice Period (Days)' },
      { key: 'tenure_months', label: 'Tenure (Months)' },
      { key: 'l1_manager_name', label: 'Reporting Manager' },
    ],
  },

  // 14. NEW JOINERS REPORT
  {
    id: 'new_joiners',
    label: 'New Joiners Report',
    description: 'Employees who joined in the selected date range',
    icon: '🆕',
    category: 'Employee',
    scope: 'all',
    filters: [
      { key: 'doj_range', label: 'Date of Joining Range', type: 'date_range', field: 'company_doj' },
      { key: 'department', label: 'Department', type: 'select', field: 'department_name' },
      { key: 'employment_type', label: 'Employment Type', type: 'select', options: ['Employee','Intern','Contract','Consultant'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'designation', label: 'Designation' },
      { key: 'department_name', label: 'Department' },
      { key: 'company_name', label: 'Company' },
      { key: 'location_name', label: 'Branch' },
      { key: 'employment_type', label: 'Employment Type', format: 'badge' },
      { key: 'company_doj', label: 'Date of Joining', format: 'date' },
      { key: 'confirmation_status', label: 'Probation / Confirmed', format: 'badge' },
      { key: 'l1_manager_name', label: 'Reporting Manager' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'office_email', label: 'Office Email' },
    ],
  },

  // 15. VPF REPORT
  {
    id: 'vpf_report',
    label: 'VPF Declaration Report',
    description: 'Employees who have opted for Voluntary Provident Fund',
    icon: '📦',
    category: 'Statutory',
    join: 'vpf_declarations',
    scope: 'all',
    filters: [
      { key: 'fy', label: 'Financial Year', type: 'select', options: ['2026-27','2025-26'] },
      { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE','STOPPED'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'uan_number', label: 'UAN' },
      { key: 'fy', label: 'FY' },
      { key: 'vpf_percent', label: 'VPF %' },
      { key: 'epf_wage_base', label: 'EPF Wage Base', format: 'currency' },
      { key: 'monthly_vpf_amount', label: 'Monthly VPF (₹)', format: 'currency' },
      { key: 'annual_vpf_amount', label: 'Annual VPF (₹)', format: 'currency' },
      { key: 'effective_from_month', label: 'Effective From' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'acknowledged', label: 'Acknowledged', format: 'boolean' },
    ],
  },

  // 16. NPS REPORT
  {
    id: 'nps_report',
    label: 'NPS Enrolment Report',
    description: 'Employees enrolled in corporate NPS — PRAN, regime, monthly contribution',
    icon: '🏛️',
    category: 'Statutory',
    join: 'nps_declarations',
    scope: 'all',
    filters: [
      { key: 'fy', label: 'Financial Year', type: 'select', options: ['2026-27','2025-26'] },
      { key: 'status', label: 'Status', type: 'select', options: ['ACTIVE','PENDING_PRAN','STOPPED'] },
    ],
    columns: [
      { key: 'emp_code', label: 'Emp Code' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'fy', label: 'FY' },
      { key: 'pran_number', label: 'PRAN Number' },
      { key: 'tax_regime', label: 'Tax Regime', format: 'badge' },
      { key: 'contribution_percent', label: 'Contribution %' },
      { key: 'monthly_nps_amount', label: 'Monthly NPS (₹)', format: 'currency' },
      { key: 'effective_date', label: 'Effective Date', format: 'date' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'acknowledged', label: 'Acknowledged', format: 'boolean' },
    ],
  },
];

const CATEGORIES = ['All', 'Employee', 'Salary', 'Leave', 'Tax', 'Statutory'];

// ─── Helper: format cell ──────────────────────────────────────
function formatCell(value: any, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'date': {
      const d = new Date(value);
      return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    case 'currency': return '₹' + Number(value).toLocaleString('en-IN');
    case 'boolean': return value ? 'Yes' : 'No';
    case 'masked_aadhaar': return `XXXX-XXXX-${String(value).slice(-4)}`;
    case 'masked_bank': return `XXXXXX${String(value).slice(-4)}`;
    default: return String(value);
  }
}

// ─── Badge Component ──────────────────────────────────────────
function Badge({ value }: { value: string }) {
  const colorMap: Record<string, [string, string]> = {
    Active: ['#ECFDF5', '#059669'], Resigned: ['#FEF2F2', '#DC2626'],
    Terminated: ['#FEF2F2', '#DC2626'], Absconded: ['#FEF2F2', '#DC2626'],
    ACTIVE: ['#ECFDF5', '#059669'], STOPPED: ['#FEF2F2', '#DC2626'],
    SUBMITTED: ['#ECFDF5', '#059669'], DRAFT: ['#FFFBEB', '#D97706'],
    APPROVED: ['#ECFDF5', '#059669'], LOCKED: ['#EEF2FF', '#4F46E5'],
    OLD: ['#EEF2FF', '#4F46E5'], NEW: ['#F0FDF4', '#15803D'],
    Employee: ['#EEEDFE', '#3C3489'], Intern: ['#FFF7ED', '#C2410C'],
    Contract: ['#F0F9FF', '#0369A1'], Consultant: ['#FDF4FF', '#9333EA'],
    Male: ['#EFF6FF', '#1D4ED8'], Female: ['#FDF2F8', '#C026D3'],
    Confirmed: ['#ECFDF5', '#059669'], Probation: ['#FFFBEB', '#D97706'],
    PENDING_PRAN: ['#FFFBEB', '#D97706'],
  };
  const [bg, color] = colorMap[value] || ['#F1F5F9', '#475569'];
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: bg, color, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {value}
    </span>
  );
}

// ─── Data layer helpers ───────────────────────────────────────
function monthsBetween(from: string, to: string | null): number | null {
  if (!from) return null;
  const a = new Date(from); const b = to ? new Date(to) : new Date();
  if (isNaN(a.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

function flattenEmp(e: any, nameById: Record<string, string>) {
  const exitDate = e.last_working_date || e.relieving_date || null;
  return {
    ...e,
    department_name: e.departments?.dept_name ?? null,
    location_name: e.locations?.location_name ?? null,
    company_name: e.companies?.company_name ?? null,
    res_state: e.res_state ?? e.locations?.state ?? null,
    l1_manager_name: e.l1_manager_id ? (nameById[e.l1_manager_id] || null) : (e.reporting_manager || null),
    hr_manager_name: e.hr_manager_id ? (nameById[e.hr_manager_id] || null) : null,
    tenure_months: monthsBetween(e.company_doj || e.group_doj, exitDate),
  };
}

// Emp fields carried into join-report rows (secondary record overlays these).
function empSubset(e: any) {
  return {
    employee_id: e.id, emp_code: e.emp_code, full_name: e.full_name,
    designation: e.designation, grade: e.grade, department_name: e.department_name,
    company_name: e.company_name, tds_regime: e.tds_regime, uan_number: e.uan_number,
  };
}

// Load & flatten all employees for a company (or all companies when companyId empty).
async function loadEmployees(companyId: string) {
  let q = supabase.from('employees')
    .select('*, departments(dept_name), locations!location_id(location_name, state), companies(company_name)')
    .order('emp_code');
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q.limit(5000);
  const emps = data || [];
  const nameById: Record<string, string> = {};
  emps.forEach((e: any) => { nameById[e.id] = e.full_name; });
  return emps.map((e: any) => flattenEmp(e, nameById));
}

// Fetch the raw (unfiltered except company/scope) row set for a report.
async function fetchReportRows(report: ReportConfig, companyId: string): Promise<any[]> {
  let emps = await loadEmployees(companyId);

  if (report.scope === 'active') {
    emps = emps.filter((e: any) => e.employment_status === 'Active');
  } else if (report.scope === 'exited') {
    emps = emps.filter((e: any) => ['Resigned', 'Terminated', 'Absconded'].includes(e.employment_status));
  } else if (report.scope === 'confirmation_due') {
    emps = emps.filter((e: any) => e.employment_status === 'Active' && e.confirmation_status !== 'Confirmed');
  }

  if (!report.join) return emps;

  // Join reports — one output row per secondary record.
  const empById: Record<string, any> = {};
  emps.forEach((e: any) => { empById[e.id] = e; });
  const ids = emps.map((e: any) => e.id);
  if (!ids.length) return [];

  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data } = await supabase.from(report.join).select('*').in('employee_id', chunk);
    (data || []).forEach((rec: any) => rows.push(rec));
  }

  if (report.id === 'ctc_report') {
    // Latest CTC per employee → one row per employee.
    const latest: Record<string, any> = {};
    rows.forEach(r => {
      const cur = latest[r.employee_id];
      if (!cur || String(r.effective_from || '') > String(cur.effective_from || '')) latest[r.employee_id] = r;
    });
    return emps.map((e: any) => ({ ...empSubset(e), ...(latest[e.id] || {}) }));
  }

  // vpf / nps / flexi / tds / leave — one row per secondary record.
  return rows.map(rec => {
    const e = empById[rec.employee_id];
    return { ...(e ? empSubset(e) : {}), ...rec };
  });
}

// ─── Filter application (client-side, instant) ────────────────
function distinctOptions(rows: any[], field: string): string[] {
  const set = new Set<string>();
  rows.forEach(r => { const v = r[field]; if (v !== null && v !== undefined && v !== '') set.add(String(v)); });
  return Array.from(set).sort();
}

function applyFilters(rows: any[], report: ReportConfig, filters: Record<string, any>): any[] {
  return rows.filter(r => {
    for (const f of report.filters) {
      const field = f.field || f.key;
      if (f.type === 'date_range') {
        const from = filters[`${f.key}_from`];
        const to = filters[`${f.key}_to`];
        const v = r[field];
        if (from && (!v || String(v).slice(0, 10) < from)) return false;
        if (to && (!v || String(v).slice(0, 10) > to)) return false;
        continue;
      }
      const val = filters[f.key];
      if (!val || val === 'All' || val === '') continue;

      if (f.key === 'birth_month') {
        const dob = r.date_of_birth;
        if (!dob) return false;
        const m = new Date(dob).getMonth();
        if (isNaN(m) || MONTHS[m] !== val) return false;
        continue;
      }
      if (f.key === 'pf_applicable' || f.key === 'esic_applicable') {
        const truthy = !!r[f.key];
        if ((val === 'Yes') !== truthy) return false;
        continue;
      }
      if (f.key === 'regime') {
        const rg = String(r.regime || r.tds_regime || '').toUpperCase();
        if (rg !== String(val).toUpperCase()) return false;
        continue;
      }
      if (String(r[field] ?? '') !== String(val)) return false;
    }
    return true;
  });
}

// ─── Main Page ────────────────────────────────────────────────
export default function ReportsPage() {
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');

  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [activeReport, setActiveReport] = useState<ReportConfig | null>(null);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => setCompanies(data || []));
  }, []);

  const filteredReports = REPORTS.filter(r =>
    (category === 'All' || r.category === category) &&
    (search === '' || r.label.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase()))
  );

  const visibleColumns = activeReport ? activeReport.columns : [];
  const data = useMemo(
    () => (activeReport ? applyFilters(rawRows, activeReport, filters) : []),
    [rawRows, activeReport, filters]
  );

  async function openReport(report: ReportConfig) {
    setActiveReport(report);
    setFilters({});
    setRawRows([]);
    setError(null);
    setLoading(true);
    try {
      const rows = await fetchReportRows(report, companyId);
      setRawRows(rows);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load report data.');
    }
    setLoading(false);
  }

  // Reload when the company changes while a report is open.
  useEffect(() => {
    if (!activeReport) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const rows = await fetchReportRows(activeReport, companyId);
        if (!cancelled) setRawRows(rows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load report data.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function dynamicOptions(f: FilterConfig): string[] {
    if (f.options && f.options.length) return f.options;
    return distinctOptions(rawRows, f.field || f.key);
  }

  function exportCSV() {
    if (!data.length || !activeReport) return;
    const headers = visibleColumns.map(c => c.label).join(',');
    const body = data.map(row =>
      visibleColumns.map(c => {
        const v = row[c.key];
        // Empty values export as a truly blank cell (no em-dash placeholder).
        const cell = (v === null || v === undefined || v === '') ? '' : formatCell(v, c.format);
        return `"${String(cell).replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');
    // Prepend UTF-8 BOM so Excel decodes em-dash / ₹ correctly (else shows "â€”").
    const blob = new Blob(['﻿' + headers + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${activeReport.id}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const s = {
    page: { padding: 24, background: C.bg, minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif' } as const,
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 12 } as const,
    btn: (active: boolean) => ({
      padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
      background: active ? C.purple : 'transparent', color: active ? '#fff' : C.muted, transition: 'all .15s',
    } as const),
    inp: { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, outline: 'none', background: '#fff', color: C.navy } as const,
    priBtn: { padding: '8px 16px', borderRadius: 8, background: C.purple, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 } as const,
    secBtn: { padding: '8px 14px', borderRadius: 8, background: '#fff', color: C.purpleDark, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 } as const,
  };

  // ─── Report Detail View ──────────────────────────────────────
  if (activeReport) {
    return (
      <div style={s.page}>
        {/* Header — sticky */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'sticky', top: 0, zIndex: 30, background: C.bg, paddingTop: 4, paddingBottom: 8 }}>
          <button onClick={() => { setActiveReport(null); setRawRows([]); setFilters({}); }} style={{ ...s.secBtn, padding: '6px 12px' }}>← Back</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: C.navy }}>{activeReport.icon} {activeReport.label}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{activeReport.description}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Company</label>
            <select style={{ ...s.inp, minWidth: 200 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              <option value=''>All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
        </div>

        {/* Filters */}
        <div style={s.card}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, letterSpacing: 0.5 }}>FILTERS</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {activeReport.filters.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'select' || f.type === 'multiselect' ? (
                  <select style={{ ...s.inp, minWidth: 150 }} value={filters[f.key] ?? ''}
                    onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))}>
                    <option value=''>All</option>
                    {dynamicOptions(f).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : f.type === 'date_range' ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type='date' style={{ ...s.inp, width: 140 }} value={filters[`${f.key}_from`] ?? ''}
                      onChange={e => setFilters(p => ({ ...p, [`${f.key}_from`]: e.target.value }))} />
                    <input type='date' style={{ ...s.inp, width: 140 }} value={filters[`${f.key}_to`] ?? ''}
                      onChange={e => setFilters(p => ({ ...p, [`${f.key}_to`]: e.target.value }))} />
                  </div>
                ) : (
                  <input type='text' style={{ ...s.inp, minWidth: 150 }} value={filters[f.key] ?? ''}
                    onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))} />
                )}
              </div>
            ))}
            {Object.keys(filters).length > 0 && (
              <button onClick={() => setFilters({})} style={s.secBtn}>Clear</button>
            )}
            {data.length > 0 && <button onClick={exportCSV} style={s.priBtn}>⬇ Export CSV</button>}
          </div>
        </div>

        {/* Results */}
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.navy }}>{loading ? 'Loading…' : `${data.length} records`}</span>
            <span style={{ fontSize: 11, color: C.muted }}>· {visibleColumns.length} columns</span>
            {error && <span style={{ fontSize: 11, color: C.red, marginLeft: 4 }}>⚠ {error}</span>}
          </div>
          {!loading && data.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: '65vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {visibleColumns.map(c => (
                      <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', background: C.bg, color: C.purpleDark, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, letterSpacing: 0.3, position: 'sticky', top: 0 }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 500).map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      {visibleColumns.map(c => (
                        <td key={c.key} style={{ padding: '8px 12px', color: C.navy, whiteSpace: 'nowrap' }}>
                          {c.format === 'badge' && row[c.key] ? (
                            <Badge value={String(row[c.key])} />
                          ) : c.format === 'boolean' ? (
                            <span style={{ color: row[c.key] ? C.green : C.muted }}>{row[c.key] ? 'Yes' : 'No'}</span>
                          ) : (
                            formatCell(row[c.key], c.format)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > 500 && (
                <div style={{ padding: '8px 16px', fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}` }}>
                  Showing first 500 rows in the table · Export CSV includes all {data.length} records.
                </div>
              )}
            </div>
          )}
          {!loading && data.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
              {rawRows.length === 0 ? 'No data available for this report yet.' : 'No records match the selected filters.'}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Report Listing ──────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={{ fontSize: 22, fontWeight: 600, color: C.navy, marginBottom: 4 }}>Reports</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
        Employee, salary, leave, statutory &amp; tax reports · pulled live from your HRMS data
      </div>

      {/* Search + Category + Company */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder='🔍 Search reports…' style={{ ...s.inp, minWidth: 240 }} value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ display: 'flex', gap: 4 }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={s.btn(category === c)}>{c}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <select style={{ ...s.inp, minWidth: 200 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value=''>All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
      </div>

      {/* Report Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filteredReports.map(r => (
          <div key={r.id} onClick={() => openReport(r)}
            style={{ ...s.card, cursor: 'pointer', transition: 'box-shadow .15s', marginBottom: 0 }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 16px rgba(124,58,237,0.12)`)}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 28 }}>{r.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.navy, marginBottom: 4 }}>{r.label}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{r.description}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: C.purpleBg, color: C.purpleDark, fontWeight: 500 }}>{r.category}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: C.bg, color: C.muted }}>{r.columns.length} columns</span>
                </div>
              </div>
              <span style={{ fontSize: 18, color: C.border }}>›</span>
            </div>
          </div>
        ))}
      </div>

      {filteredReports.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>No reports found for &quot;{search}&quot;</div>
      )}
    </div>
  );
}
