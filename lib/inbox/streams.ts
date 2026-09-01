// lib/inbox/streams.ts — which department owns a notification.
//
// The inbox has to answer "who is this from?" for things that were never
// addressed by a person. A leave approval comes from HR, a payslip from
// Payroll, a claim rejection from Finance — the employee already thinks in
// those terms, and a single undifferentiated list is what the brief asked us
// not to build.
//
// The mapping is by CODE PREFIX rather than by an entry per notification,
// because the catalogue grows: every new LEAVE_* code should land in the leave
// stream on the day it is added, not the day somebody remembers to list it
// here. Anything unmatched falls to HR, which is the right default — HR owns
// the things nobody else does.

export type StreamCode =
  | 'DIRECT' | 'HR' | 'PAYROLL' | 'FINANCE' | 'TIME'
  | 'PERFORMANCE' | 'RECRUITMENT' | 'EXIT' | 'IT'

export interface StreamDef {
  code: StreamCode
  label: string
  /** One line under the folder name, so a new joiner knows what lands here. */
  hint: string
  /** Light / dark ink. Both measured against the ESS surface: every value
   *  clears 5:1 in its own theme, and the closest pair is dE 20 apart, so
   *  nine folders in a column stay tellable apart. */
  ink: { l: string; d: string }
}

export const STREAMS: StreamDef[] = [
  { code: 'DIRECT',      label: 'Direct messages', hint: 'People writing to you',
    ink: { l: '#1F5BC1', d: '#588BE4' } },
  { code: 'HR',          label: 'HR',              hint: 'Policy, records, letters',
    ink: { l: '#6C2FB1', d: '#A576DB' } },
  { code: 'PAYROLL',     label: 'Payroll',         hint: 'Salary, payslips, tax, declarations',
    ink: { l: '#1D7C4D', d: '#51D694' } },
  { code: 'FINANCE',     label: 'Finance',         hint: 'Claims, advances, reimbursements',
    ink: { l: '#187991', d: '#47C2E1' } },
  { code: 'TIME',        label: 'Leave & Attendance', hint: 'Requests, approvals, regularisation',
    ink: { l: '#2373A9', d: '#4DA2DB' } },
  { code: 'PERFORMANCE', label: 'Performance',     hint: 'KRAs, reviews, ratings',
    ink: { l: '#AF3181', d: '#D364AA' } },
  { code: 'RECRUITMENT', label: 'Recruitment',     hint: 'Requisitions, candidates, offers',
    ink: { l: '#A75C1B', d: '#E18F47' } },
  { code: 'EXIT',        label: 'Exit',            hint: 'Resignation, clearance, full & final',
    ink: { l: '#B1402F', d: '#D46E5E' } },
  { code: 'IT',          label: 'IT & Access',     hint: 'Accounts, roles, the portal itself',
    ink: { l: '#497A29', d: '#89C95E' } },
]

export const STREAM = new Map(STREAMS.map(s => [s.code, s]))
export const streamInk = (c: string) => (STREAM.get(c as StreamCode) ?? STREAM.get('HR')!).ink
export const streamLabel = (c: string) => (STREAM.get(c as StreamCode) ?? STREAM.get('HR')!).label

/**
 * Longest prefix wins, so PROOF_* can sit in Payroll while
 * PROOF_DEADLINE_* could later be pulled out without disturbing it.
 * Ordered longest-first at module load rather than at every call.
 */
const RULES: [string, StreamCode][] = [
  ['LEAVE',        'TIME'],
  ['ATTENDANCE',   'TIME'],
  ['REGULARIS',    'TIME'],
  ['HOLIDAY',      'TIME'],
  ['SHIFT',        'TIME'],

  ['PAYSLIP',      'PAYROLL'],
  ['SALARY',       'PAYROLL'],
  ['PAYROLL',      'PAYROLL'],
  ['TDS',          'PAYROLL'],
  ['DECLARATION',  'PAYROLL'],
  ['PROOF',        'PAYROLL'],
  ['FLEXI',        'PAYROLL'],
  ['VPF',          'PAYROLL'],
  ['NPS',          'PAYROLL'],
  ['REGIME',       'PAYROLL'],

  ['TRAVEL',       'FINANCE'],
  ['CLAIM',        'FINANCE'],
  ['REIMB',        'FINANCE'],
  ['ADVANCE',      'FINANCE'],
  ['LOAN',         'FINANCE'],
  ['INVOICE',      'FINANCE'],

  ['PMS',          'PERFORMANCE'],
  ['KRA',          'PERFORMANCE'],
  ['APPRAISAL',    'PERFORMANCE'],
  ['REVIEW',       'PERFORMANCE'],
  ['RATING',       'PERFORMANCE'],
  ['GOAL',         'PERFORMANCE'],

  ['MRF',          'RECRUITMENT'],
  ['CANDIDATE',    'RECRUITMENT'],
  ['OFFER',        'RECRUITMENT'],
  ['INTERVIEW',    'RECRUITMENT'],
  ['ONBOARD',      'RECRUITMENT'],
  ['MAGIC_LINK',   'RECRUITMENT'],

  ['RESIGNATION',  'EXIT'],
  ['EXIT',         'EXIT'],
  ['FNF',          'EXIT'],
  ['CLEARANCE',    'EXIT'],
  ['NOTICE_PERIOD','EXIT'],

  ['ROLE',         'IT'],
  ['ESS',          'IT'],
  ['ACCESS',       'IT'],
  ['PASSWORD',     'IT'],
  ['LOGIN',        'IT'],
].sort((a, b) => b[0].length - a[0].length) as [string, StreamCode][]

/** Which folder a notification code belongs in. */
export function streamFor(code: string | null | undefined): StreamCode {
  if (!code) return 'HR'
  const c = code.toUpperCase()
  for (const [prefix, stream] of RULES) if (c.startsWith(prefix)) return stream
  // Celebrations are people-news, and HR is where people-news belongs. Called
  // out rather than left to the fallback so it is clearly a decision.
  if (c === 'BIRTHDAY' || c === 'ANNIVERSARY' || c.startsWith('KUDOS')) return 'HR'
  return 'HR'
}
