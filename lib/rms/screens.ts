// lib/rms/screens.ts — the sub-module (screen) registry, and the one place that names
// every internal tab a role's visibility can be set on.
//
// A "module" is a top-level sidebar entry (Recruitment, Payroll, …) already gated by
// role_permissions. A "screen" is one tab INSIDE a module (Recruitment → MRF, Pipeline,
// …). This file is the canonical list of those tabs, so the admin matrix, the grant
// resolver and every page that filters its tabs answer from the same source and cannot
// drift. Pure — no React, no Supabase.
//
// screen_key format: `${moduleKey}.${tabKey}` where tabKey is EXACTLY the key the page's
// own tab array uses, so a page can gate a tab with canSeeScreen(grant, `${moduleKey}.${t.k}`).

export interface ScreenDef { key: string; label: string }
export interface ScreenModule {
  /** stable lowercase key, also the screen_key prefix */
  moduleKey: string
  /** the top-level module label (matches lib/rms/modules MODULES), for grouping/labels */
  module: string
  /** what HR sees as the section heading in the matrix */
  label: string
  screens: ScreenDef[]
}

export const SCREEN_MODULES: ScreenModule[] = [
  {
    moduleKey: 'recruitment', module: 'Recruitment', label: 'Recruitment (ATS)',
    screens: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'mrf', label: 'MRF' },
      { key: 'screening', label: 'AI Screening' },
      { key: 'pipeline', label: 'Pipeline' },
      { key: 'negotiation', label: 'Negotiation' },
      { key: 'offerapproval', label: 'Offer Approval' },
      { key: 'hrhead', label: 'HR Head' },
      { key: 'sendoffer', label: 'Send Offers' },
      { key: 'offers', label: 'Offers' },
      { key: 'preonboarding', label: 'Pre-onboarding' },
      { key: 'jobstatus', label: 'Job Status' },
    ],
  },
  {
    moduleKey: 'onboarding', module: 'Onboarding', label: 'Onboarding',
    screens: [
      { key: 'overview', label: 'Overview' },
      { key: 'candidates', label: 'All candidates' },
      { key: 'pending', label: 'Pending actions' },
      { key: 'insights', label: 'AI insights' },
      { key: 'compliance', label: 'Compliance' },
    ],
  },
  {
    moduleKey: 'payroll', module: 'Payroll', label: 'Payroll',
    screens: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'config', label: 'Configuration' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'employees', label: 'Employees & CTC' },
      { key: 'run', label: 'Payroll Run' },
      { key: 'statutory', label: 'Statutory & Tax' },
      { key: 'benefits', label: 'Benefits & Loans' },
      { key: 'offcycle', label: 'Off-cycle · Bonus · FNF' },
      { key: 'reports', label: 'Outputs & Reports' },
      { key: 'admin', label: 'Admin & Controls' },
    ],
  },
  {
    moduleKey: 'pms', module: 'Performance', label: 'Performance (PMS)',
    screens: [
      { key: 'overview', label: 'This cycle' },
      { key: 'config', label: 'PMS Configuration' },
      { key: 'setup', label: 'Setup & Controls' },
      { key: 'policies', label: 'Policy Builder' },
      { key: 'fill', label: 'Fill Status Tracker' },
      { key: 'upload', label: 'Final Rating Upload' },
      { key: 'pip', label: 'PIP Management' },
      { key: 'reports', label: 'Reports & Export' },
      { key: 'chain', label: 'Flow & Hierarchy' },
    ],
  },
  {
    moduleKey: 'attendance', module: 'Attendance', label: 'Attendance',
    screens: [
      { key: 'shifts', label: 'Shifts' },
      { key: 'assign', label: 'Assign' },
      { key: 'records', label: 'Attendance Records' },
    ],
  },
  {
    moduleKey: 'travel', module: 'Travel Claims', label: 'Travel Claims',
    screens: [
      { key: 'RM', label: 'Manager' },
      { key: 'HR', label: 'HR Head' },
      { key: 'FINANCE', label: 'Finance' },
      { key: 'RATES', label: 'Rate card' },
      { key: 'PERIODS', label: 'Expense months' },
    ],
  },
  {
    moduleKey: 'flexi', module: 'Flexi Claims', label: 'Flexi Claims',
    screens: [
      { key: 'approvals', label: 'Approvals' },
      { key: 'submit', label: 'Submit Bill' },
      { key: 'window', label: 'Window' },
      { key: 'limits', label: 'Limits & Requests' },
    ],
  },
  {
    moduleKey: 'holidays', module: 'Holidays', label: 'Holidays',
    screens: [
      { key: 'cal', label: 'Calendars' },
      { key: 'hol', label: 'Holidays' },
      { key: 'week', label: 'Weekly Off' },
      { key: 'prev', label: 'Employee Preview' },
    ],
  },
  {
    moduleKey: 'letters', module: 'HR Letters', label: 'HR Letters',
    screens: [
      { key: 'letterhead', label: 'Letterhead & Signatory' },
      { key: 'letters', label: 'Design & Generate Letters' },
    ],
  },
  {
    moduleKey: 'leave', module: 'Leave Config', label: 'Leave Config',
    screens: [
      { key: 'types', label: 'Leave Types' },
      { key: 'quota', label: 'Branch Quota' },
      { key: 'upload', label: 'Bulk Upload' },
    ],
  },
]

/** Every screen_key that exists, for validation. */
export const ALL_SCREEN_KEYS: string[] = SCREEN_MODULES.flatMap(m => m.screens.map(s => `${m.moduleKey}.${s.key}`))

/** The module key a screen_key belongs to ("recruitment.mrf" → "recruitment"). */
export function moduleKeyOf(screenKey: string): string {
  return screenKey.split('.')[0]
}

export function screenModule(moduleKey: string): ScreenModule | undefined {
  return SCREEN_MODULES.find(m => m.moduleKey === moduleKey)
}
