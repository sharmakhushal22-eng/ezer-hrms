/**
 * View-model types and DISPLAY-ONLY helpers for the redesigned Negotiation
 * stage.
 *
 * There is no salary arithmetic in this file and there must never be any.
 * Every figure the views draw is produced by `computeCtc()` in
 * `lib/recruitment/ctc-model.ts` (and by the budget rule in `NegotiationTab`)
 * and handed in already computed. The only things done to a number here are:
 *
 *   - formatting it for the screen (`formatInr`, the same rule as the app's
 *     `inr()`: Math.round, then en-IN grouping), and
 *   - turning amounts into the SIZE of a ring segment or the position on a
 *     track (`sharePct`, `rangePct`).
 *
 * Neither result is ever fed back into a calculation, stored, or sent.
 */

export type NegSubTab = 'checks' | 'ctc'

/** Form values stay in whatever shape `NegotiationTab` holds them today. */
export type FieldValue = string | number

export interface Option {
  value: string
  label: string
}

/** `EXPIRED` is derived by the container (status ACTIVE, expires_at passed). */
export type DocLinkState = 'NONE' | 'ACTIVE' | 'SUBMITTED' | 'EXPIRED'

export type CandidateResponse = 'ACCEPTED' | 'REJECTED' | null

export interface NegCandidateVM {
  id: string
  name: string
  position: string
  mrfNumber: string
  companyName: string
  email: string | null
  /** From `docStatusMap[id]`, plus the derived expiry. */
  linkState: DocLinkState
  /** Whole hours left on an ACTIVE link, as the container already computes. */
  hoursLeft: number | null
  /** From `respMap[id]`. */
  response: CandidateResponse
  /** `c.offer_revised` */
  revised: boolean
  /** `c.blacklisted` */
  blacklisted: boolean
}

export interface NegFilter {
  key: string
  label: string
  value: string
  options: Option[]
}

/** The same keys `form` has in `NegotiationTab`. */
export interface NegForm {
  ctc: FieldValue
  varAmt: FieldValue
  joining_bonus: FieldValue
  joining_bonus_freq: string
  retention_bonus: FieldValue
  retention_bonus_freq: string
  esop: FieldValue
  esop_plan: string
  terms: string
  state: string
  category: string
  gratuity: boolean
  bonusPct: FieldValue
  bonusMode: string
}

export type NegFormKey = keyof NegForm

/** One row of `addItems[]`. */
export interface AddItem {
  amount: FieldValue
  freq: string
  remark: string
}

export type AddItemKey = keyof AddItem

export type MinWageSource = 'master' | 'default' | 'fallback'

export interface MinWageInfo {
  /** The floor `resolveMinWage()` returned, per month. */
  amount: number
  source: MinWageSource
}

export interface MinWageRow {
  id: string
  state: string
  zone: string
  category: string
  basic: number | null
  vda: number | null
  total: number | null
  effectiveFrom: string
  reference: string
}

/* ------------------------------------------------------------------ */
/* The statement. Rows arrive already computed.                        */
/* ------------------------------------------------------------------ */

export interface StatementRow {
  label: string
  monthly: number | null
  annual: number | null
  /** Small text under the label, for example the LWF cycle or "on Basic". */
  note?: string | undefined
}

export type SectionTone = 'earn' | 'deduct' | 'net' | 'employer' | 'ctc'

export interface StatementSection {
  key: string
  title: string
  tone: SectionTone
  rows: StatementRow[]
  /** The section's closing line, for example "Gross salary". */
  total?: StatementRow | undefined
}

export type PartTone = 'net' | 'deduct' | 'employer'

export interface CompositionPart {
  key: string
  label: string
  amount: number
  tone: PartTone
}

/** What `computeCtc()` returns when the CTC is below the statutory floor. */
export interface BreakdownFailure {
  minReqFixedAnn: number
  fixedAnnual: number
  basic: number
}

export interface BreakdownVM {
  /** Set when `computeCtc()` returned `ok: false`. Nothing else is drawn. */
  failure: BreakdownFailure | null
  inHandMonthly: number
  grossMonthly: number
  totalDedMonthly: number
  ctcAnnual: number
  sections: StatementSection[]
  /** `basicRule` from the model: which side of the MAX() won. */
  basicRule: '50pct' | 'minwage'
  /** `esicNearCeiling` from the model. */
  esicNearCeiling: boolean
  /** Optional. Leave out and the bar is not drawn. */
  composition?: CompositionPart[] | undefined
}

export interface BudgetLine {
  tone: 'ok' | 'bad'
  text: string
}

export interface BudgetInfo {
  /** Already annualised by the existing `annualise()` rule. 0 when unset. */
  min: number
  max: number
}

/* ------------------------------------------------------------------ */
/* The Create Link drawer                                              */
/* ------------------------------------------------------------------ */

export type DocDrawerMode = 'main' | 'send' | 'status'

export interface DocLinkVM {
  state: Exclude<DocLinkState, 'NONE'>
  hoursLeft: number | null
  expiresAtLabel: string
  submittedAtLabel: string
  /** Optional: `sent_at` and `opened_at`, formatted. Shown on the link timeline. */
  sentAtLabel?: string | undefined
  openedAtLabel?: string | undefined
  /** `document_collection_links.candidate_email` — what the OTP checks. */
  sentTo: string
  cc: string[]
  docCount: number
}

export interface CcPerson {
  id: string
  name: string
  code: string
  email: string
}

export interface UploadedDocVM {
  id: string
  label: string
  fileName: string
  sizeLabel: string
  mandatory: boolean
  uploadedAtLabel: string
}

/* ------------------------------------------------------------------ */
/* Option lists, exactly as the current screen offers them             */
/* ------------------------------------------------------------------ */

const asOptions = (labels: readonly string[]): Option[] => labels.map((l) => ({ value: l, label: l }))

export const JOINING_FREQS: Option[] = asOptions(['With Salary', 'After 3 Months', 'After 6 Months', 'As per Policy'])
export const RETENTION_FREQS: Option[] = asOptions(['After 3 Months', 'After 6 Months', 'After 1 Year', 'As per Policy'])
export const ADDITIONAL_FREQS: Option[] = asOptions(['One-time', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly'])

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

const DASH = '\u2014'

/** Same rule as the app's `inr()`. Display only. */
export function formatInr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return `\u20B9${Math.round(n).toLocaleString('en-IN')}`
}

/** 650000 -> "₹6.5 L". Display only, for chips and axis labels. */
export function formatLakh(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  const lakh = (n / 100000).toFixed(2).replace(/\.?0+$/, '')
  return `\u20B9${lakh} L`
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

/** True when a field holds an amount above zero. Used only to enable a select. */
export function hasAmount(v: FieldValue): boolean {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0
}

/** Width of one bar segment, 0..100. Presentation only. */
export function sharePct(amount: number, total: number): number {
  if (!(total > 0) || !(amount > 0)) return 0
  return Math.min(100, (amount / total) * 100)
}

/** Position of a value on a min..max track, clamped to 0..100. Presentation only. */
export function rangePct(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

export type Lane = 'send' | 'waiting' | 'review'

/** Which column of the Checks board a candidate sits in. From the link state only. */
export function laneOf(state: DocLinkState): Lane {
  if (state === 'SUBMITTED') return 'review'
  if (state === 'ACTIVE') return 'waiting'
  return 'send'
}

export function linkStateLabel(state: DocLinkState, hoursLeft: number | null): string {
  if (state === 'SUBMITTED') return 'Documents received'
  if (state === 'ACTIVE') return hoursLeft === null ? 'Link sent' : `Link sent \u00B7 ${hoursLeft}h left`
  if (state === 'EXPIRED') return 'Link expired'
  return 'No link yet'
}

/** The next thing to do for a candidate, in two or three words. */
export function nextStepLabel(state: DocLinkState, subTab: NegSubTab): string {
  if (subTab === 'ctc') return 'Open calculator'
  if (state === 'SUBMITTED') return 'Review documents'
  if (state === 'ACTIVE') return 'View status'
  if (state === 'EXPIRED') return 'Resend link'
  return 'Create link'
}

export const MIN_WAGE_SOURCE_LABEL: Record<MinWageSource, string> = {
  master: 'HR master',
  default: 'default table',
  fallback: 'fallback',
}
