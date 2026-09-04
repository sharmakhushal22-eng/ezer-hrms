// lib/profile/model.ts — which fields exist, where they live, and who may
// change them.
//
// Ported from EZER-ESS-Profile-360.html's model(), with one rule applied
// throughout: A FIELD IS ONLY LISTED IF THE VIEW ACTUALLY HAS THE COLUMN.
//
// The design file names about seventy columns. v_employee_profile_360 has 89,
// and they are not the same set. Drawing a field with no source behind it is a
// promise the screen cannot keep — the reader sees a labelled row, assumes the
// value is simply blank for them, and waits for something that will never
// arrive. So the following are in the design and deliberately NOT here:
//
//   band                    no column; grade carries the whole thing
//   bgv_status              onboarding.*, not in this view
//   shift, holiday calendar shifts.* / holiday_calendars.*, not joined
//   aadhaar (full)          only aadhar_last4 exists, which is the point
//   bank account (full)     only bank_last4 exists, same reasoning
//   tax regime              tax_declarations.*
//   form 11, form 2         onboarding.* / nominations — the nominations list
//                           renders as a card instead, from real rows
//   gratuity                derived, not stored
//   net pay, flexi,         payroll_employee_snapshot.* / flexi_* / derived —
//   last increment, YTD tax the Payroll section of ESS owns these
//
// When one of those columns arrives, add the entry here and it appears.
//
// STATES come straight from the design and are not cosmetic — they decide
// which control the field gets, and the route enforces them again server-side.

import type { FieldGroup, TabId } from './types'

/** The tab strip, in order. */
export const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'personal',  label: 'Personal' },
  { id: 'job',       label: 'Employment' },
  { id: 'statutory', label: 'Statutory' },
  { id: 'payroll',   label: 'Payroll' },
  { id: 'time',      label: 'Time & Leave' },
  { id: 'growth',    label: 'Growth' },
  { id: 'records',   label: 'Records' },
]

/** Tabs whose content is field groups. The rest are card blocks built from the
 *  payload's related lists, and are rendered by the component instead. */
export const FIELD_TABS: TabId[] = ['personal', 'job', 'statutory', 'payroll']

export const MODEL: Partial<Record<TabId, FieldGroup[]>> = {

  personal: [
    { title: 'Identity', fields: [
      { label: 'Full name',       key: 'full_name',      state: 'locked',  source: 'employees.full_name' },
      { label: 'Preferred name',  key: 'display_name',   state: 'direct',  source: 'employees.display_name' },
      { label: 'Employee code',   key: 'employee_code',  state: 'locked',  source: 'employees.emp_code', mono: true },
      { label: 'Date of birth',   key: 'date_of_birth',  state: 'locked',  source: 'employees.date_of_birth', min: 'self' },
      { label: 'Gender',          key: 'gender',         state: 'locked',  source: 'employees.gender' },
      { label: 'Blood group',     key: 'blood_group',    state: 'direct',  source: 'employees.blood_group' },
      { label: 'Marital status',  key: 'marital_status', state: 'event',   source: 'employees.marital_status',
        hint: 'Opens family, nominee and insurance steps' },
      { label: 'Anniversary',     key: 'marriage_date',  state: 'direct',  source: 'employees.marriage_date' },
    ]},
    { title: 'Background', fields: [
      { label: "Father's name",   key: 'father_name',  state: 'locked',  source: 'employees.father_name', min: 'self' },
      { label: "Mother's name",   key: 'mother_name',  state: 'locked',  source: 'employees.mother_name', min: 'self' },
      { label: 'Spouse name',     key: 'spouse_name',  state: 'request', source: 'employees.spouse_name', min: 'self' },
      { label: 'Nationality',     key: 'nationality',  state: 'locked',  source: 'employees.nationality' },
      { label: 'Place of birth',  key: 'place_of_birth', state: 'locked', source: 'employees.place_of_birth' },
      { label: 'Domicile state',  key: 'domicile_state', state: 'locked', source: 'employees.domicile_state' },
      { label: 'Languages',       key: 'languages',    state: 'direct',  source: 'employees.languages' },
      { label: 'Differently abled', key: 'is_disabled', state: 'request', source: 'employees.is_disabled',
        hint: 'Drives Section 80U relief' },
      { label: 'International worker', key: 'is_international_worker', state: 'locked',
        source: 'employees.is_international_worker', hint: 'Drives PF Form 11 treatment' },
    ]},
    { title: 'Contact', fields: [
      { label: 'Official email',  key: 'official_email',  state: 'locked', source: 'employees.official_email' },
      { label: 'Personal email',  key: 'personal_email',  state: 'direct', source: 'employees.personal_email', min: 'self' },
      { label: 'Mobile',          key: 'mobile',          state: 'direct', source: 'employees.mobile', min: 'self' },
      { label: 'Alternate number', key: 'alt_mobile',     state: 'direct', source: 'employees.alt_mobile', min: 'self' },
      { label: 'Extension',       key: 'extension',       state: 'locked', source: 'employees.extension', mono: true },
      { label: 'WhatsApp alerts', key: 'whatsapp_optin',  state: 'direct', source: 'employees.whatsapp_optin' },
    ]},
    { title: 'Address and emergency', fields: [
      { label: 'Present address',   key: 'present_address',   state: 'request', source: 'employees.present_address',
        wide: true, min: 'self', hint: 'Changes PT state and HRA exemption' },
      { label: 'Permanent address', key: 'permanent_address', state: 'request', source: 'employees.permanent_address',
        wide: true, min: 'self' },
      { label: 'Emergency contact 1', key: 'emergency_contact_1', state: 'direct',
        source: 'employees.emergency_contact_1', wide: true, min: 'self' },
      { label: 'Emergency contact 2', key: 'emergency_contact_2', state: 'direct',
        source: 'employees.emergency_contact_2', wide: true, min: 'self' },
    ]},
  ],

  job: [
    { title: 'Position', fields: [
      { label: 'Designation',      key: 'designation',       state: 'locked', source: 'employees.designation' },
      { label: 'Department',       key: 'department_name',   state: 'locked', source: 'departments.name' },
      { label: 'Sub department',   key: 'sub_department',    state: 'locked', source: 'employees.sub_department' },
      { label: 'Grade',            key: 'grade',             state: 'locked', source: 'employees.grade' },
      { label: 'Job level',        key: 'job_level',         state: 'locked', source: 'employees.job_level' },
      { label: 'Employment type',  key: 'employment_type',   state: 'locked', source: 'employees.employment_type' },
      { label: 'Employee category', key: 'employee_category', state: 'locked', source: 'employees.employee_category' },
      { label: 'Cost centre',      key: 'cost_centre',       state: 'locked', source: 'employees.cost_centre', mono: true },
      { label: 'Company',          key: 'company_name',      state: 'locked', source: 'companies.company_name' },
      { label: 'Business unit',    key: 'business_unit',     state: 'locked', source: 'employees.business_unit' },
      { label: 'Work location',    key: 'location_name',     state: 'request', source: 'locations.name',
        hint: 'Goes through the Transfer module' },
      { label: 'Branch code',      key: 'branch_code',       state: 'locked', source: 'branches.code', mono: true },
      { label: 'Seat',             key: 'workstation',       state: 'direct', source: 'employees.workstation' },
    ]},
    { title: 'Dates and terms', fields: [
      { label: 'Date of joining',   key: 'date_of_joining',    state: 'locked', source: 'employees.date_of_joining' },
      { label: 'Confirmation date', key: 'confirmation_date',  state: 'locked', source: 'employees.confirmation_date' },
      { label: 'Probation',         key: 'probation_months',   state: 'locked', source: 'employees.probation_months' },
      { label: 'Notice period',     key: 'notice_period_days', state: 'locked', source: 'employees.notice_period_days' },
      { label: 'Employment status', key: 'status',             state: 'locked', source: 'employees.employment_status' },
    ]},
    { title: 'Working pattern', fields: [
      { label: 'Weekly off',      key: 'weekly_off',      state: 'locked', source: 'employees.weekly_off' },
      { label: 'Attendance mode', key: 'attendance_mode', state: 'locked', source: 'employees.attendance_mode' },
    ]},
  ],

  statutory: [
    { title: 'Tax identity', fields: [
      // The full Aadhaar is deliberately absent — the view carries only the
      // last four, which is all any screen has ever needed.
      { label: 'PAN',            key: 'pan',           state: 'locked', source: 'employees.pan',
        mono: true, mask: true, min: 'hr' },
      { label: 'Aadhaar last 4', key: 'aadhar_last4',  state: 'locked', source: 'employees.aadhar_last4',
        mono: true, min: 'self' },
    ]},
    { title: 'Provident fund', fields: [
      { label: 'UAN',             key: 'uan',            state: 'locked', source: 'employees.uan', mono: true, min: 'self' },
      { label: 'PF number',       key: 'pf_number',      state: 'locked', source: 'employees.pf_number', mono: true, min: 'self' },
      { label: 'PF applicability', key: 'pf_applicable', state: 'locked', source: 'employees.pf_applicable' },
      { label: 'Voluntary PF',    key: 'vpf_amount',     state: 'direct', source: 'employees.vpf_amount' },
      { label: 'Pension (EPS)',   key: 'eps_status',     state: 'locked', source: 'employees.eps_status' },
    ]},
    { title: 'Other statutory', fields: [
      { label: 'ESIC',            key: 'esic_ip_number', state: 'locked', source: 'employees.esic_ip_number', min: 'self' },
      { label: 'ESIC dispensary', key: 'esic_dispensary', state: 'locked', source: 'employees.esic_dispensary' },
      { label: 'Professional tax', key: 'pt_state',      state: 'locked', source: 'employees.pt_state' },
      { label: 'Labour welfare fund', key: 'lwf_state',  state: 'locked', source: 'employees.lwf_state' },
    ]},
    { title: 'Other identity documents', fields: [
      { label: 'Passport',        key: 'passport_no',    state: 'request', source: 'employees.passport_no',
        mono: true, mask: true, min: 'hr' },
      { label: 'Driving licence', key: 'driving_licence', state: 'direct', source: 'employees.driving_licence',
        mono: true, min: 'self' },
      { label: 'Voter ID',        key: 'voter_id',       state: 'direct', source: 'employees.voter_id',
        mono: true, min: 'self' },
    ]},
  ],

  payroll: [
    { title: 'Salary account', fields: [
      { label: 'Bank name',       key: 'bank_name',         state: 'request', source: 'employees.bank_name', min: 'self' },
      { label: 'Account last 4',  key: 'bank_last4',        state: 'locked',  source: 'employees.bank_last4',
        mono: true, min: 'self' },
      { label: 'IFSC',            key: 'ifsc',              state: 'request', source: 'employees.ifsc', mono: true, min: 'self' },
      { label: 'Account holder',  key: 'bank_holder_name',  state: 'request', source: 'employees.bank_holder_name', min: 'hr' },
      { label: 'Payment mode',    key: 'payment_mode',      state: 'locked',  source: 'employees.payment_mode' },
    ]},
    { title: 'Compensation', fields: [
      { label: 'Annual CTC',      key: 'annual_ctc',    state: 'locked', source: 'ctc_master.annual_ctc', min: 'manager' },
      { label: 'Monthly gross',   key: 'gross_monthly', state: 'locked', source: 'salary_structures.gross_monthly', min: 'manager' },
    ]},
  ],
}

/** The related lists, and what each card is called. Driven off the payload
 *  rather than hard-coded in the component, so a list that comes back empty
 *  still gets a card saying so — an absent card reads as a missing feature. */
export const RECORD_CARDS: { key: keyof RecordKeys; title: string; tab: TabId; empty: string }[] = [
  { key: 'family',         title: 'Family',                    tab: 'records', empty: 'No family members recorded.' },
  { key: 'nominations',    title: 'Nominations',               tab: 'records', empty: 'No nominee recorded. PF and gratuity both need one.' },
  { key: 'insurance',      title: 'Insurance',                 tab: 'records', empty: 'No active policy recorded.' },
  { key: 'documents',      title: 'Documents',                 tab: 'records', empty: 'Nothing uploaded yet.' },
  { key: 'assets',         title: 'Assets issued',             tab: 'records', empty: 'No company assets issued.' },
  { key: 'app_access',     title: 'Application access',        tab: 'records', empty: 'No application access recorded.' },
  { key: 'education',      title: 'Education',                 tab: 'growth',  empty: 'No qualifications recorded.' },
  { key: 'experience',     title: 'Previous experience',       tab: 'growth',  empty: 'No previous employment recorded.' },
  { key: 'certifications', title: 'Skills and certifications', tab: 'growth',  empty: 'No certifications recorded.' },
  { key: 'trainings',      title: 'Training',                  tab: 'growth',  empty: 'No training assigned.' },
]

export type RecordKeys = {
  family: unknown; nominations: unknown; insurance: unknown; documents: unknown
  assets: unknown; app_access: unknown; education: unknown; experience: unknown
  certifications: unknown; trainings: unknown
}

/** Columns worth showing per card, in order. Anything else in the row is
 *  hidden rather than dumped — these tables carry ids, audit stamps and
 *  company_id that mean nothing to the person reading. */
// Checked against 091's CREATE TABLE statements, not guessed. Four of these
// were wrong on the first pass — member_name not name, policy_no not
// policy_number, category not asset_type, access_role not access_level — and
// a wrong column name here would render an empty column rather than fail
// loudly, which is the worst way for it to be wrong.
export const CARD_COLUMNS: Record<string, string[]> = {
  family:         ['relation', 'member_name', 'date_of_birth', 'is_dependent', 'is_insured'],
  nominations:    ['scheme', 'nominee_name', 'relation', 'share_percent'],
  insurance:      ['policy_type', 'policy_name', 'policy_no', 'sum_insured', 'valid_to'],
  documents:      ['doc_type', 'doc_name', 'status', 'expiry_date'],
  assets:         ['category', 'asset_name', 'asset_code', 'issued_on', 'returned_on'],
  app_access:     ['app_name', 'access_role', 'granted_on'],
  education:      ['qualification', 'institute', 'specialisation', 'to_year', 'score'],
  experience:     ['company', 'designation', 'from_date', 'to_date', 'location'],
  certifications: ['cert_name', 'issuer', 'issued_on', 'expires_on'],
  trainings:      ['training_name', 'status', 'due_date', 'completed_on'],
}
