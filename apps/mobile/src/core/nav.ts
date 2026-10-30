// src/core/nav.ts — the app's navigation, as data.
//
// MIRRORS THE WEBSITE'S SIDEBAR: components/ess/EmployeePortal.tsx → SECTIONS,
// NAV_GROUPS and MOBILE_PRIMARY. Same section keys, same labels, same order, same
// groups. The website already decided what a phone shows in its thumb bar (Home,
// Payroll, Attendance, Leave) and puts everything else under "More"; the app does
// the same.
//
// Who sees what is NOT decided here. /api/ess/menu answers it (Company and
// Reports only for a login it says can open them) and every route re-checks on
// the server, exactly as on the website. See useMenu() and visibleSections().
//
// ADDING A WEBSITE MODULE TO THE APP: add its section/item here with the same
// key the website uses, add a route file under src/app/, and build the screen in
// src/features/<module>/. docs/mobile-app-architecture.md § "Adding a module".
import type { IconProps } from '@/ui/icons'
import {
  IconAward, IconBuilding, IconCalendar, IconEmployees, IconGame, IconHeart, IconHome, IconLeave,
  IconLetters, IconMail, IconOrgChart, IconPayroll, IconPerformance, IconReceipt, IconReports, IconUser,
} from '@/ui/icons'
import type { ComponentType } from 'react'

export type Ready = 'ready' | 'partial' | 'soon'
export interface NavItem {
  k: string
  label: string
  /** App route for this item. */
  route: string
  /** Website: `needs` marks a placeholder that is not built yet (renders <Placeholder/>). */
  needs?: string
  phase?: number
  /** One-line hint under the label (website: HrisShell TABS[].hint). */
  hint?: string
}
export interface Feature { icon: string; name: string; note: string }
export interface NavSection {
  k: string; label: string; short: string; desc: string; status: Ready
  items: NavItem[]
  features?: Feature[]
}

export const SECTIONS: NavSection[] = [
  { k: 'home', label: 'Home', short: 'Home', status: 'ready', desc: 'The landing dashboard: everything at a glance',
    items: [{ k: 'home', label: 'Home', route: '/' }] },

  { k: 'profile', label: 'Profile', short: 'Profile', status: 'ready', desc: 'Your personal details, documents and letters',
    items: [
      { k: 'profile', label: 'My Details', route: '/profile' },
      { k: 'documents', label: 'Letter Requests', route: '/profile/letter-requests' },
      { k: 'letters', label: 'My Letters', route: '/profile/letters' },
      // EZER Sign (73a2e17): components/esign/MyDocumentsToSign on the website.
      { k: 'to-sign', label: 'Documents to sign', route: '/esign' },
    ] },

  { k: 'team', label: 'Team', short: 'Team', status: 'ready', desc: 'Your manager, your peers and the people who report to you',
    items: [{ k: 'team', label: 'Team', route: '/team' }] },

  { k: 'orgchart', label: 'Org Chart', short: 'Org', status: 'ready', desc: 'See how the whole company fits together',
    items: [{ k: 'orgchart', label: 'Org Chart', route: '/orgchart' }] },

  { k: 'payroll', label: 'Payroll', short: 'Payroll', status: 'partial', desc: 'Salary, benefits, tax declarations and claims',
    items: [
      { k: 'payslip', label: 'Salary Slip', route: '/payroll/payslip', phase: 3, needs: 'Payslip generation' },
      { k: 'flexi', label: 'Flexi Benefits', route: '/payroll/flexi' },
      { k: 'proofs', label: 'Investment Proofs', route: '/payroll/proofs' },
      { k: 'flexiclaims', label: 'Flexi Claims', route: '/payroll/flexiclaims' },
      { k: 'vpf', label: 'Voluntary PF', route: '/payroll/vpf' },
      { k: 'nps', label: 'Corporate NPS', route: '/payroll/nps' },
      { k: 'loans', label: 'Loans', route: '/payroll/loans' },
      { k: 'claims', label: 'Travel Claims', route: '/payroll/claims' },
      { k: 'statutory', label: 'Statutory', route: '/payroll/statutory', phase: 3, needs: 'Payroll' },
    ] },

  { k: 'attendance', label: 'Attendance', short: 'Attend', status: 'ready', desc: 'Your punches, working hours and monthly calendar',
    items: [{ k: 'attendance', label: 'Attendance', route: '/attendance' }] },

  { k: 'leave', label: 'Leave', short: 'Leave', status: 'ready', desc: 'Apply for leave, track your requests and plan around holidays',
    items: [{ k: 'leave', label: 'Leave', route: '/leave' }] },

  { k: 'inbox', label: 'Inbox', short: 'Inbox', status: 'ready', desc: 'Messages from colleagues and teams, and every notification in full',
    items: [{ k: 'inbox', label: 'Inbox', route: '/inbox' }] },

  { k: 'expenses', label: 'Travel & Expenses', short: 'T&E', status: 'ready', desc: 'Trips, legs, bills and claims: travel from planning to payout',
    items: [{ k: 'expenses', label: 'Travel & Expenses', route: '/expenses' }] },

  { k: 'hris', label: 'HR Services', short: 'HR', status: 'partial', desc: 'Directory, requests, approvals and the exit process',
    items: [
      { k: 'directory', label: 'Team Directory', route: '/hris/directory', hint: 'Find a colleague' },
      { k: 'requests', label: 'Raise a Request', route: '/hris/requests', hint: 'Ask HR for help' },
      { k: 'approvals', label: 'Tasks & Approvals', route: '/hris/approvals', hint: 'What is waiting on you' },
      { k: 'exit', label: 'Exit Process', route: '/hris/exit', hint: 'Resign or track it' },
    ] },

  { k: 'company', label: 'Company', short: 'Company', status: 'ready', desc: 'Headcount, attrition and tax-regime trends across the company',
    items: [{ k: 'company', label: 'Company', route: '/company' }] },

  { k: 'reports', label: 'Reports', short: 'Reports', status: 'ready', desc: 'Attrition, regime comparison, declaration status, TDS register, span of control',
    items: [{ k: 'reports', label: 'Reports', route: '/reports' }] },

  { k: 'performance', label: 'Performance', short: 'PMS', status: 'ready', desc: 'Your goals (KRAs) and the reviews you owe',
    items: [{ k: 'performance', label: 'Performance', route: '/performance' }] },

  { k: 'social', label: 'Social', short: 'Social', status: 'ready', desc: 'Birthdays, work anniversaries, new joiners and the Wall of Fame',
    items: [{ k: 'social', label: 'Social', route: '/social' }] },

  { k: 'rnr', label: 'RNR', short: 'RNR', status: 'soon', desc: 'Reward and recognise great work with points you can redeem',
    items: [{ k: 'rnr', label: 'RNR', route: '/rnr' }],
    features: [
      { icon: 'social', name: 'Nominate', note: 'Pick a category, write why' },
      { icon: 'hris', name: 'Approval', note: 'Manager / HR reviews' },
      { icon: 'rnr', name: 'Points', note: 'Credited on approval' },
      { icon: 'payroll', name: 'Redeem', note: 'Vouchers, leave, merch' },
      { icon: 'performance', name: 'Leaderboard', note: 'Top recognized employees' },
    ] },

  { k: 'funzone', label: 'Fun Zone', short: 'Fun', status: 'ready', desc: 'Take a break: play a quick game with your team',
    items: [{ k: 'funzone', label: 'Fun Zone', route: '/funzone' }] },
]

/** The website's NAV_GROUPS — the rail's grouping, reused for the More screen. */
export const NAV_GROUPS: { label: string | null; keys: string[] }[] = [
  { label: null, keys: ['home', 'inbox'] },
  { label: 'Time & pay', keys: ['attendance', 'leave', 'payroll', 'expenses'] },
  { label: 'You & your team', keys: ['profile', 'team', 'orgchart', 'performance'] },
  { label: 'Workplace', keys: ['hris', 'company', 'reports'] },
  { label: 'Community', keys: ['social', 'rnr', 'funzone'] },
]

/** The website's MOBILE_PRIMARY — the four an employee opens daily get the thumb bar. */
export const MOBILE_PRIMARY = ['home', 'payroll', 'attendance', 'leave'] as const

/** Section key → icon, as the website's ESS_ICON. */
export const SECTION_ICON: Record<string, ComponentType<IconProps>> = {
  home: IconHome, profile: IconUser, team: IconEmployees, payroll: IconPayroll, inbox: IconMail,
  attendance: IconCalendar, leave: IconLeave, hris: IconLetters, performance: IconPerformance,
  orgchart: IconOrgChart, company: IconBuilding, reports: IconReports, social: IconHeart,
  rnr: IconAward, funzone: IconGame, expenses: IconReceipt,
}

export interface MenuFlags { can: { company: boolean; reports: boolean; approvals: boolean }; is_rm: boolean; is_hod: boolean }

/** The website's filter: Company / Reports only when /api/ess/menu says so. */
export function visibleSections(menu: MenuFlags | null | undefined): NavSection[] {
  return SECTIONS.filter(s => s.k === 'company' ? !!menu?.can.company : s.k === 'reports' ? !!menu?.can.reports : true)
}

/** The website's groupSections(). */
export function groupSections(list: NavSection[]) {
  const placed = new Set(NAV_GROUPS.flatMap(g => g.keys))
  const groups = NAV_GROUPS.map(g => ({ label: g.label, items: g.keys.map(k => list.find(s => s.k === k)).filter((s): s is NavSection => !!s) }))
  const rest = list.filter(s => !placed.has(s.k))
  if (rest.length) groups[groups.length - 1].items.push(...rest)
  return groups.filter(g => g.items.length > 0)
}

export const sectionOf = (k: string) => SECTIONS.find(s => s.k === k)
