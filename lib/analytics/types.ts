// lib/analytics/types.ts — what the analytics APIs return, shared by server and screens.
//
// Every figure that can be missing is `number | null`, and null means "we could not
// measure it" — never zero. A zero attrition rate and an unmeasured one look the same
// on a tile and mean opposite things.

import type { Bucket } from './metrics.ts'

export type Severity = 'critical' | 'warning' | 'info' | 'positive'
export type Area = 'workforce' | 'attrition' | 'attendance' | 'leave' | 'performance' | 'learning' | 'hiring' | 'cost'

/** A finding written in words. Rules produce these from computed figures; nothing here is
 *  generated text, so every number in a sentence is one the screen also shows. */
export interface Insight {
  id: string
  severity: Severity
  area: Area
  title: string
  detail: string
}

export type Fmt = 'count' | 'pct' | 'money' | 'days' | 'hours' | 'clock' | 'score' | 'ratio'

export interface Kpi {
  key: string
  label: string
  value: number | null
  fmt: Fmt
  /** The same figure for the previous period, for the delta. */
  prev?: number | null
  /** Which direction is good — decides whether a rise reads green or red. */
  good?: 'up' | 'down' | 'neutral'
  /** One line under the value: the denominator, or what the figure covers. */
  sub?: string
  /** The definition, for the tooltip. */
  def?: string
  /** Up to twelve trailing points for a sparkline. */
  spark?: (number | null)[]
}

export interface Change {
  key: string
  label: string
  now: number | null
  before: number | null
  fmt: Fmt
  good: 'up' | 'down' | 'neutral'
}

export interface PersonRef {
  id: string
  code: string | null
  name: string
  designation: string | null
  department: string | null
}

export interface RiskSignal { code: string; label: string; detail: string; weight: number }
export interface RiskRow extends PersonRef { level: 'high' | 'medium'; score: number; signals: RiskSignal[] }

export interface Option { id: string; label: string; company_id?: string | null }

export interface OrgScope {
  company: string | null
  companyLabel: string
  department: string | null
  location: string | null
  type: string | null
  period: { key: string; label: string; from: string; to: string; months: string[] }
  previous: { from: string; to: string }
  /** The trailing twelve months every trend chart is drawn over. */
  trend: string[]
  today: string
}

export interface FlowPoint { month: string; opening: number; joiners: number; exits: number; closing: number; attrition: number | null }

export interface OrgAnalytics {
  generatedAt: string
  scope: OrgScope
  filters: { companies: Option[]; departments: Option[]; locations: Option[]; types: string[]; canPickGroup: boolean; groupLabel?: string }
  access: {
    cost: boolean
    people: boolean
    /** The tabs this reader may open (lib/analytics/access.ts). Absent = all. */
    tabs?: string[]
    /** Whether the PDF / Excel downloads are offered. Absent = yes. */
    export?: boolean
    /** How they got in: a reporting role, an analytics grant, or Super Admin. */
    via?: 'super' | 'role' | 'grant'
    /** The grant's data limit in words ("Pune · Sales"), when there is one. */
    limitLabel?: string
    /** Last day a grant applies. */
    until?: string | null
    /** May hand out analytics access (Manage access). */
    manage?: boolean
    /** The reader's name, for the PDF's byline. */
    viewer?: string | null
  }
  pulse: {
    kpis: Kpi[]
    insights: Insight[]
    changes: Change[]
    flow: FlowPoint[]
  }
  workforce: {
    headcount: number
    byCompany: Bucket[]
    byDepartment: Bucket[]
    byLocation: Bucket[]
    byType: Bucket[]
    byGrade: Bucket[]
    gender: Bucket[]
    genderByDepartment: { key: string; label: string; male: number; female: number; other: number }[]
    age: Bucket[]
    tenure: Bucket[]
    avgTenure: number | null
    span: { managers: number; avgSpan: number | null; medianSpan: number | null; narrow: number; wide: number; distribution: Bucket[] }
    probation: { onProbation: number; dueSoonCount: number; overdueCount: number; dueSoon: PersonRef[]; overdue: PersonRef[] }
    noManager: number
  }
  attrition: {
    flow: FlowPoint[]
    exits: number
    avgHeadcount: number
    rate: number | null
    annualised: number | null
    prevAnnualised: number | null
    voluntary: number
    involuntary: number
    unclassified: number
    regretted: number
    early90: { cohort: number; left: number; rate: number | null }
    early180: { cohort: number; left: number; rate: number | null }
    reasons: { key: string; label: string; category: string; value: number }[]
    categories: Bucket[]
    byDepartment: { key: string; label: string; exits: number; headcount: number; rate: number | null }[]
    tenureAtExit: Bucket[]
    pipelineCount: number
    pipeline: (PersonRef & { stage: string; lwd: string | null; regrettable: boolean | null })[]
    recentExits: (PersonRef & { lwd: string; reason: string | null; tenureYears: number | null; kind: string })[]
    risk: RiskRow[]
  }
  attendance: {
    window: { from: string; to: string; capped: boolean }
    coverage: { tracked: number; headcount: number }
    summary: {
      tracked: number; days: number; punchedIn: number; late: number
      onTimeRate: number | null; lateRate: number | null; missPunch: number; missPunchRate: number | null
      halfDays: number; avgHours: number | null; medianIn: number | null; overtimeHours: number
    }
    prevOnTime: number | null
    monthly: { month: string; onTimeRate: number | null; late: number; punchedIn: number; avgHours: number | null }[]
    weekday: { key: string; label: string; days: number; late: number; rate: number | null }[]
    /** Rows: department; columns: weekday — late-mark rate in each cell. */
    heat: { rows: { key: string; label: string; cells: (number | null)[]; days: number[] }[]; cols: string[] }
    byDepartment: { key: string; label: string; tracked: number; onTimeRate: number | null; avgHours: number | null; missPunch: number }[]
    lateList: (PersonRef & { late: number; days: number })[]
    regularisation: { total: number; approved: number; rejected: number; pending: number; approvalRate: number | null }
  }
  leave: {
    days: number
    perHead: number | null
    byType: { key: string; label: string; days: number; spells: number }[]
    monthly: { month: string; planned: number; unplanned: number }[]
    unplannedShare: number | null
    bridge: { spells: number; bridging: number; share: number | null }
    weekdayStarts: Bucket[]
    pending: { count: number; olderThan3: number; oldestDays: number | null }
    bradford: (PersonRef & { spells: number; days: number; score: number })[]
    noLeave90: { count: number; of: number; people: (PersonRef & { balance: number | null })[] }
    balances: { key: string; label: string; available: number; perHead: number | null }[]
  }
  performance: {
    cycles: { code: string; name: string; status: string; start: string | null; end: string | null; enrolled: number }[]
    cycle: string | null
    enrolled: number
    stages: { key: string; label: string; value: number }[]
    completion: number | null
    rated: number
    distribution: { key: string; label: string; value: number; share: number | null; reference: number }[]
    topShare: number | null
    avgGap: number | null
    byDepartment: { key: string; label: string; rated: number; avg: number | null; dist: number[] }[]
    managerSkew: (PersonRef & { rated: number; avg: number; diff: number })[]
    pip: { active: number; requested: number }
    recognitions: number
    trainingAsks: Bucket[]
  }
  learning: {
    enrolments: number
    completed: number
    inProgress: number
    notStarted: number
    overdue: number
    completion: number | null
    mandatoryCompletion: number | null
    avgScore: number | null
    byDepartment: { key: string; label: string; enrolments: number; completion: number | null; overdue: number }[]
  }
  hiring: {
    openMrfs: number
    openPositions: number
    mrfAge: Bucket[]
    oldestMrfs: { id: string; number: string | null; title: string; days: number; openings: number; department: string | null }[]
    funnel: { key: string; label: string; value: number; conversion: number | null }[]
    candidates: number
    rejected: number
    sources: { key: string; label: string; candidates: number; offers: number; rate: number | null }[]
    offers: { made: number; accepted: number; backout: number; declined: number; acceptance: number | null }
    timeToOffer: number | null
    joiningSoon: { name: string; designation: string | null; doj: string; department: string | null }[]
    monthlyApplicants: { month: string; value: number }[]
  }
  cost: null | {
    runs: { month: string; gross: number; net: number; cost: number; employees: number; status: string }[]
    latest: null | {
      month: string
      status: string
      employees: number
      gross: number
      net: number
      employerStatutory: number
      costToCompany: number
      perHead: number | null
      earnings: Bucket[]
      employer: Bucket[]
      deductions: Bucket[]
      byDepartment: { key: string; label: string; gross: number; employees: number }[]
    }
    ctc: {
      employees: number
      total: number
      median: number | null
      byGrade: { key: string; label: string; n: number; median: number | null }[]
      byDepartment: { key: string; label: string; n: number; total: number; median: number | null }[]
      /** Median female CTC ÷ median male CTC, per grade, where both sides have 5+ people. */
      genderRatio: { key: string; label: string; female: number; male: number; ratio: number | null }[]
    }
  }
}

// ── Manager view ────────────────────────────────────────────────────────────

export type DayKind = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'MISS_IN' | 'MISS_OUT' | 'IN_PROGRESS' | 'ABSENT'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING' | 'NOT_JOINED'

export interface TeamMember extends PersonRef {
  doj: string | null
  today: DayKind
  todayIn: string | null
  month: { present: number; late: number; absent: number; leave: number; miss: number; workdays: number; avgIn: number | null; avgHours: number | null }
  days: DayKind[]
  leave90: number
  lastLeave: string | null
  balance: number | null
  rating: string | null
  pmsStage: string | null
  onNotice: boolean
  anniversary: string | null
  birthday: string | null
}

export interface TeamAnalytics {
  generatedAt: string
  scope: 'TEAM' | 'DEPT'
  manager: { id: string; name: string }
  month: string
  dates: string[]
  members: TeamMember[]
  today: { present: number; late: number; onLeave: number; notIn: number; off: boolean }
  outThisWeek: { name: string; type: string; from: string; to: string; days: number }[]
  health: { score: number | null; parts: { key: string; label: string; value: number | null; note: string }[] }
  approvals: { leave: number; regularisation: number; oldestDays: number | null }
  performance: { cycle: string | null; distribution: { key: string; label: string; value: number }[]; awaitingYou: number; companyTopShare: number | null; teamTopShare: number | null }
  signals: RiskRow[]
  upcoming: { kind: 'birthday' | 'anniversary' | 'probation'; name: string; date: string; note: string }[]
  insights: Insight[]
}

// ── Employee view ───────────────────────────────────────────────────────────

export interface MyAnalytics {
  generatedAt: string
  me: { id: string; name: string; doj: string | null; tenureYears: number | null; designation: string | null; department: string | null }
  attendance: {
    from: string
    to: string
    days: { date: string; kind: DayKind; in: string | null; late: number; hours: number | null }[]
    monthly: { month: string; present: number; late: number; absent: number; leave: number; workdays: number; avgIn: number | null; avgHours: number | null; onTimeRate: number | null }[]
    thisMonth: { present: number; late: number; absent: number; leave: number; workdays: number; onTimeRate: number | null; avgIn: number | null; avgHours: number | null }
    streak: number
    team: { onTimeRate: number | null; avgIn: number | null; avgHours: number | null; size: number } | null
  }
  leave: {
    balances: { key: string; label: string; available: number; used: number; accrued: number; lapse: number | null }[]
    taken: { month: string; days: number }[]
    takenThisFy: number
    lastLeave: string | null
    upcoming: { type: string; from: string; to: string; days: number; status: string }[]
  }
  pay: {
    ctc: number | null
    ctcFy: string | null
    months: { month: string; gross: number; net: number; deductions: number }[]
    split: { key: string; label: string; value: number }[]
  }
  performance: {
    history: { cycle: string; name: string; rating: string | null; score: number | null; status: string }[]
    current: null | { cycle: string; name: string; stage: string; goals: number; weightage: number | null }
  }
  learning: { enrolled: number; completed: number; inProgress: number; overdue: number; recent: { title: string; status: string; progress: number | null }[] }
  recognition: { kudos: number; awards: number }
  milestones: { label: string; date: string; note: string }[]
  nudges: Insight[]
}
