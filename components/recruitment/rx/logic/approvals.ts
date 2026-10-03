/**
 * Pure helpers and view-model types for the "MRF & Offer Approvals" console
 * (tab key `hrhead`). No React, no Supabase, no fetch: everything here is a
 * function of its arguments, so it is safe to unit test and safe to import
 * from either the dashboard or the ESS mount.
 *
 * Nothing in this file writes anything. The hand-off rule is still enforced
 * where it always was (the API guard and the two direct writes).
 */

export type ApprovalSection = 'mrf' | 'offer' | 'rehire'

export type ChainStepStatus = 'PENDING' | 'WAITING' | 'APPROVED' | 'REJECTED' | 'REVISION'

/** Same shape `/api/recruitment/offer-approval` GET returns per company. */
export interface PersonOption {
  id: string
  name: string
  code: string
}

export interface ChainStepVM {
  order: number
  role: string
  status: ChainStepStatus
  approverId: string | null
  approverName: string
  actedAt: string | null
}

export interface MrfApprovalVM {
  id: string
  mrfNumber: string
  designation: string
  companyId: string
  companyCode: string
  companyName: string
  department: string
  location: string
  mrfType: string
  urgency: string
  raiserName: string
  raiserCode: string
  openings: number
  grade: string
  budgetMin: number | null
  budgetMax: number | null
  experience: string
  employmentType: string
  workMode: string
  skills: string[]
  chain: ChainStepVM[]
  /** When it reached this approver. Drives the "Waiting 2 days" label. */
  waitingSince: string | null
}

export interface OfferApprovalVM {
  id: string
  candidateName: string
  designation: string
  companyId: string
  companyCode: string
  companyName: string
  mrfNumber: string
  recruiterName: string
  offeredCtc: number | null
  offeredFixed: number | null
  offeredVariable: number | null
  offeredVariablePct: number | null
  monthlyGross: number | null
  monthlyInhand: number | null
  hikePct: number | null
  budgetMin: number | null
  budgetMax: number | null
  proposedDoj: string | null
  daysToJoin: number | null
  noticePeriodDays: number | null
  noticeBuyout: boolean | null
  documentsCount: number | null
  bgvStatus: string | null
  prevCompanyName: string | null
  prevTotalCtc: number | null
  prevFixedCtc: number | null
  waitingSince: string | null
}

export interface PackDoc {
  key: string
  label: string
  note: string
}

/** The three PDFs the HR Head mail already attaches. */
export const DEFAULT_PACK: PackDoc[] = [
  { key: 'mrf', label: 'MRF', note: 'PDF' },
  { key: 'interview', label: 'Interview summary', note: 'PDF' },
  { key: 'ctc', label: 'CTC acknowledgement', note: 'PDF, password protected' },
]

const DASH = '\u2014'

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function formatInr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return `\u20B9${Math.round(n).toLocaleString('en-IN')}`
}

/** 650000 -> "₹6.5 L". Used for budget ranges and queue rows. */
export function formatLakh(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  const lakh = (n / 100000).toFixed(2).replace(/\.?0+$/, '')
  return `\u20B9${lakh} L`
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return `${Number(n.toFixed(1))}%`
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  const base: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const opts: Intl.DateTimeFormatOptions = withTime ? { ...base, hour: 'numeric', minute: '2-digit' } : base
  return d.toLocaleString('en-IN', opts)
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

/** Whole days since `sinceIso`. `null` when the date is missing or invalid. */
export function waitingDays(sinceIso: string | null | undefined, now: number = Date.now()): number | null {
  if (!sinceIso) return null
  const t = new Date(sinceIso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function waitingLabel(days: number | null): string {
  if (days === null) return 'Waiting on you'
  if (days === 0) return 'Came in today'
  return `Waiting ${plural(days, 'day', 'days')}`
}

export type BudgetState = 'inside' | 'below' | 'above' | 'unknown'

/** Where `value` sits between `min` and `max`, clamped to 0..100 for the bar. */
export function budgetPosition(
  value: number | null,
  min: number | null,
  max: number | null,
): { pct: number; state: BudgetState } {
  if (value === null || min === null || max === null || max <= min) return { pct: 0, state: 'unknown' }
  const raw = ((value - min) / (max - min)) * 100
  const state: BudgetState = raw < 0 ? 'below' : raw > 100 ? 'above' : 'inside'
  return { pct: Math.min(100, Math.max(0, Math.round(raw))), state }
}

/** Stable 0..tones-1 index from a string, so a company or person keeps its tint. */
export function toneOf(key: string, tones = 4): number {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % tones
}

/** UI-only mirror of the hand-off rule. The writes still enforce it themselves. */
export function canApproveMrf(assigneeIds: readonly string[]): boolean {
  return assigneeIds.length > 0
}

export function canApproveOffer(hrManagerId: string | null | undefined): boolean {
  return typeof hrManagerId === 'string' && hrManagerId.length > 0
}

/**
 * The HR Manager shown as selected for an offer.
 * An explicit choice (including an explicit "none") always wins. With no choice
 * yet, a company that has exactly one HR Manager gets that person pre-selected.
 */
export function effectiveManager(
  explicit: string | null | undefined,
  managers: readonly PersonOption[],
): string | null {
  if (explicit !== undefined) return explicit
  return managers.length === 1 ? (managers[0]?.id ?? null) : null
}

/* ------------------------------------------------------------------ */
/* Row -> view model. Column names are the documented live columns.    */
/* ------------------------------------------------------------------ */

export interface MrfRow {
  id: string
  mrf_number?: string | null
  designation?: string | null
  job_title?: string | null
  position?: string | null
  company_id?: string | null
  department_id?: string | null
  location_id?: string | null
  mrf_type?: string | null
  urgency?: string | null
  requested_by?: string | null
  no_of_openings?: number | null
  openings?: number | null
  grade?: string | null
  budget_min?: number | null
  budget_max?: number | null
  experience_min?: number | null
  experience_max?: number | null
  employment_type?: string | null
  work_mode?: string | null
  skills_required?: string[] | string | null
  approval_chain?: unknown
}

export interface OfferRow {
  id: string
  candidate_id?: string | null
  company_id?: string | null
  mrf_id?: string | null
  offered_ctc?: number | null
  offered_fixed?: number | null
  offered_variable?: number | null
  offered_variable_pct?: number | null
  monthly_gross?: number | null
  monthly_inhand?: number | null
  hike_pct?: number | null
  proposed_doj?: string | null
  days_to_join?: number | null
  notice_period_days?: number | null
  notice_buyout?: boolean | null
  documents_count?: number | null
  bgv_status?: string | null
  prev_company_name?: string | null
  prev_total_ctc?: number | null
  prev_fixed_ctc?: number | null
}

/** Names the row only carries as ids. Pass what the screen already has loaded. */
export interface MrfLookups {
  company?: { code: string; name: string } | null | undefined
  department?: string | null | undefined
  location?: string | null | undefined
  raiser?: { name: string; code: string } | null | undefined
}

export interface OfferLookups {
  company?: { code: string; name: string } | null | undefined
  candidateName?: string | null | undefined
  designation?: string | null | undefined
  mrfNumber?: string | null | undefined
  recruiterName?: string | null | undefined
  budgetMin?: number | null | undefined
  budgetMax?: number | null | undefined
  waitingSince?: string | null | undefined
}

const STEP_STATUSES: readonly ChainStepStatus[] = ['PENDING', 'WAITING', 'APPROVED', 'REJECTED', 'REVISION']

function str(v: unknown, fallback = DASH): string {
  return typeof v === 'string' && v.trim().length > 0 ? v : fallback
}

export function parseChain(raw: unknown): ChainStepVM[] {
  if (!Array.isArray(raw)) return []
  const steps: ChainStepVM[] = []
  raw.forEach((item, i) => {
    if (item === null || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const status = STEP_STATUSES.find((s) => s === o.status) ?? 'WAITING'
    steps.push({
      order: typeof o.order === 'number' ? o.order : i + 1,
      role: str(o.role, 'Approver'),
      status,
      approverId: typeof o.approver_id === 'string' ? o.approver_id : null,
      approverName: str(o.approver_name),
      actedAt: typeof o.acted_at === 'string' ? o.acted_at : null,
    })
  })
  return steps.sort((a, b) => a.order - b.order)
}

function skillsOf(raw: MrfRow['skills_required']): string[] {
  if (Array.isArray(raw)) return raw.filter((s) => typeof s === 'string' && s.trim().length > 0)
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function experienceOf(min: number | null | undefined, max: number | null | undefined): string {
  if (typeof min === 'number' && typeof max === 'number') return `${min} to ${max} years`
  if (typeof min === 'number') return `${min}+ years`
  if (typeof max === 'number') return `Up to ${max} years`
  return DASH
}

export function toMrfApprovalVM(row: MrfRow, look: MrfLookups = {}): MrfApprovalVM {
  const chain = parseChain(row.approval_chain)
  const acted = chain
    .filter((s) => s.status === 'APPROVED' && s.actedAt !== null)
    .map((s) => s.actedAt as string)
    .sort()
  return {
    id: row.id,
    mrfNumber: str(row.mrf_number),
    designation: str(row.designation ?? row.job_title ?? row.position),
    companyId: row.company_id ?? '',
    companyCode: look.company?.code ?? DASH,
    companyName: look.company?.name ?? DASH,
    department: look.department ?? DASH,
    location: look.location ?? DASH,
    mrfType: str(row.mrf_type),
    urgency: str(row.urgency, 'Normal'),
    raiserName: look.raiser?.name ?? DASH,
    raiserCode: look.raiser?.code ?? '',
    openings: row.no_of_openings ?? row.openings ?? 1,
    grade: str(row.grade),
    budgetMin: row.budget_min ?? null,
    budgetMax: row.budget_max ?? null,
    experience: experienceOf(row.experience_min, row.experience_max),
    employmentType: str(row.employment_type),
    workMode: str(row.work_mode),
    skills: skillsOf(row.skills_required),
    chain,
    waitingSince: acted[acted.length - 1] ?? null,
  }
}

export function toOfferApprovalVM(row: OfferRow, look: OfferLookups = {}): OfferApprovalVM {
  return {
    id: row.id,
    candidateName: look.candidateName ?? DASH,
    designation: look.designation ?? DASH,
    companyId: row.company_id ?? '',
    companyCode: look.company?.code ?? DASH,
    companyName: look.company?.name ?? DASH,
    mrfNumber: look.mrfNumber ?? DASH,
    recruiterName: look.recruiterName ?? DASH,
    offeredCtc: row.offered_ctc ?? null,
    offeredFixed: row.offered_fixed ?? null,
    offeredVariable: row.offered_variable ?? null,
    offeredVariablePct: row.offered_variable_pct ?? null,
    monthlyGross: row.monthly_gross ?? null,
    monthlyInhand: row.monthly_inhand ?? null,
    hikePct: row.hike_pct ?? null,
    budgetMin: look.budgetMin ?? null,
    budgetMax: look.budgetMax ?? null,
    proposedDoj: row.proposed_doj ?? null,
    daysToJoin: row.days_to_join ?? null,
    noticePeriodDays: row.notice_period_days ?? null,
    noticeBuyout: row.notice_buyout ?? null,
    documentsCount: row.documents_count ?? null,
    bgvStatus: row.bgv_status ?? null,
    prevCompanyName: row.prev_company_name ?? null,
    prevTotalCtc: row.prev_total_ctc ?? null,
    prevFixedCtc: row.prev_fixed_ctc ?? null,
    waitingSince: look.waitingSince ?? null,
  }
}
