// lib/te/client.ts — the browser's way into /api/te. One typed function per route.
//
// USE (in a 'use client' component)
//     import { te, TeApiError } from '@/lib/te/client'
//     try { const snap = await te.me() } catch (e) { if (e instanceof TeApiError) show(e.message) }
//
// WHO IS CALLING  Every request carries the Authorization header from
// lib/auth-headers.ts: the ESS session token when the person is signed into the
// portal, else the dashboard (Supabase) session. That helper also refreshes an
// expired token instead of sending it. No employee id is ever sent: the server
// reads it from the token.
//
// ERRORS  A refusal is thrown as TeApiError with
//     message  the sentence to show the user, as written by the rules
//     code     TE_TRIP, TE_CLAIM, TE_FORBIDDEN, TE_NOT_WAITING, … (docs: app-code/API.md)
//     status   409 the rules said no · 403 not allowed · 401 sign in · 400 bad request · 5xx our side
//     field    the form field to mark, when the refusal is about one
//     flags    the flags that block (expense, leg report, claim)
//     issues   every problem of a trip plan
import { authHeaders, uploadAuthHeaders } from '@/lib/auth-headers'
import type {
  Uuid, Snapshot, TeQueueRow, TeTripDetail, TeClaimDetail, PlaceInput, VehicleInput, TripDraft, TripPreview, TripIssue,
  TripStatus, TripDisplayStatus, GpsFix, GpsPing, StopInput, LegReportInput, ExtraLegInput, LegPreview, TeLegStats, TeFlag,
  ExpenseInput, ExpensePreview, ClaimInput, ClaimPreview, ClaimStatus, ClaimStage, RiskBand, DecideInput, PayoutRoute,
  TeConfig, TeMasters, TeWorkflowLevel, TeChainRow, TeHealthRow, TeUploadedFile, RcChecked,
} from './types'

export class TeApiError extends Error {
  code: string | null
  status: number
  field: string | null
  flags: TeFlag[]
  issues: TripIssue[]
  constructor(status: number, body: { error?: string; code?: string | null; field?: string; flags?: TeFlag[]; issues?: TripIssue[] } | null) {
    super(body?.error || (status === 401 ? 'Sign in to continue.' : `The request failed (HTTP ${status}).`))
    this.name = 'TeApiError'
    this.status = status
    this.code = body?.code ?? null
    this.field = body?.field ?? null
    this.flags = body?.flags ?? []
    this.issues = body?.issues ?? []
  }
  /** true = the rules refused it; show the message next to what the user was doing. */
  get refused(): boolean { return this.status === 409 || this.status === 403 }
}

type Query = Record<string, string | number | boolean | null | undefined>
const qs = (q?: Query): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, query?: Query): Promise<T> {
  const res = await fetch(`/api/te/${path}${qs(query)}`, {
    method,
    cache: 'no-store',
    headers: await authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new TeApiError(res.status, data)
  return data as T
}
const get = <T>(path: string, query?: Query) => call<T>('GET', path, undefined, query)
const post = <T>(path: string, body: unknown = {}, query?: Query) => call<T>('POST', path, body, query)

// ── result shapes that are not domain types ─────────────────────────────────
export interface Page<T> { rows: T[]; total: number; limit: number; offset: number; company_id: Uuid }
export interface PageQuery extends Query { limit?: number; offset?: number; company_id?: string }
export type VehicleLookup =
  | { off: true; reg: string }
  | { notFound: true; reg: string }
  | { reg: string; rc: RcChecked; type: string; typeName: string; ownerMasked: string; match: 'match' | 'partial' | 'no'; valid: { rc: boolean; ins: boolean; puc: boolean } }
export interface ClaimResult { claim_id: Uuid; status: ClaimStatus; stage: ClaimStage; net_amount?: number | null; advance_adjusted?: number }
export interface BookingInput { trip_id: Uuid; leg_id?: Uuid; point_seq?: number; vendor: string; reference: string; amount: number; ticket_url?: string }
export interface WorkflowSample { employee_id: Uuid; total?: number; scope?: string | null; postFacto?: boolean; exception?: boolean; band?: RiskBand; co?: Uuid[] }
export interface ClaimSummaryRow {
  id: Uuid; company_id: Uuid; claim_no: string; claim_type: string; claim_seq: number; status: ClaimStatus; stage: ClaimStage
  employee_id: Uuid; emp_code: string; employee_name: string; grade: string | null; department: string | null
  trip_id: Uuid | null; trip_no: string | null; trip_name: string | null; scope: string | null
  period_label: string | null; period_month: string | null; is_late: boolean
  claimed_total: number; eligible_total: number; approved_total: number; advance_adjusted: number; net_amount: number | null
  risk_score: number; risk_band: RiskBand; is_exception: boolean; is_post_facto: boolean; auto_verified: boolean; sampled: boolean
  line_count: number; open_flags: number; waiting_role: string | null; waiting_person: Uuid | null; waiting_team: string | null
  submitted_at: string | null; verified_at: string | null; settled_at: string | null; paid_ref: string | null
}
export interface PayoutBatch {
  id: Uuid; company_id: Uuid; batch_no: string; route: PayoutRoute; payout_date: string; total_amount: number
  status: 'DRAFT' | 'FILE_GENERATED' | 'PAID' | 'CANCELLED'; bank_ref: string | null; paid_at: string | null; created_at: string
  items: {
    id: Uuid; claim_id: Uuid; employee_id: Uuid; amount: number
    status: 'PENDING' | 'PAID' | 'FAILED'; bank_ref: string | null; failure_reason: string | null
    /** Joined so one failed transfer can be identified by name, not by uuid.
     *  Null only if the row it points at has gone. */
    employees: { emp_code: string; full_name: string } | null
    te_claims: { claim_no: string } | null
  }[]
}
export interface AuditRow { id: number; entity_type: string; entity_id: Uuid | null; entity_ref: string | null; action: string; actor_id: Uuid | null; actor_role: string | null; summary: string; employee_visible: boolean; at: string; before?: unknown; after?: unknown }
/** A correction raised against a claim that was already paid (te_adjustments).
 *  `emp_code`/`full_name` are joined on by the route; the employee is NOT
 *  embedded, because te_adjustments references employees twice. */
export interface AdjustmentRow {
  id: Uuid; company_id: Uuid; claim_id: Uuid | null; employee_id: Uuid
  emp_code: string | null; full_name: string | null
  direction: 'recover' | 'pay' | string; amount: number; reason: string
  status: 'OPEN' | 'DONE' | 'CANCELLED' | string; reference: string | null
  created_by: Uuid | null; created_at: string
  te_claims: { claim_no: string; status: string } | null
}
export interface FlagReportRow {
  id: Uuid; check_code: string; title: string; evidence: string | null; severity: string
  is_blocking: boolean; status: string; resolve_reason: string | null; raised_at: string
  claim_no: string; claim_status: string; emp_code: string; employee_name: string
}
export interface AdminTripRow {
  id: Uuid; trip_no: string; name: string; display_status: string; status: string
  emp_code: string; employee_name: string; employee_id: Uuid; scope: string; pattern: string; origin: string
  start_date: string | null; end_date: string | null; leg_count: number; open_leg_count: number
  planned_km: number | null; estimate_total: number | null; advance_outstanding: number | null
  purpose: string | null; project: string | null; created_at: string
}
export interface FinanceSummary { inApproval: number; inVerification: number; onHold: number; payable: number; advancesToPay: number; advancesOut: number; openBatches: number }
export interface DeskToBook { company_id: Uuid; trip_id: Uuid; trip_no: string; trip_name: string; employee_id: Uuid; emp_code: string | null; full_name: string | null; kind: 'leg' | 'hotel'; leg_id: Uuid | null; point_seq: number | null; on_date: string | null; mode: string | null; from_name: string | null; to_name: string | null }
export interface DeskVehicle { id: Uuid; employee_id: Uuid; emp_code: string | null; full_name: string | null; reg_no: string; vehicle_type_code: string; declared_type_code: string | null; ownership: string; rc_file_url: string | null; created_at: string }
/** A booking the desk has already recorded. Live ones only — the one thing
 *  left to do with it is cancel it when the trip changes under it. */
export interface DeskBooked {
  id: Uuid; booking_no: string; trip_id: Uuid; trip_no: string; trip_name: string
  employee_id: Uuid; emp_code: string | null; full_name: string | null
  leg_id: Uuid | null; point_seq: number | null; kind: 'travel' | 'hotel' | string
  vendor: string; reference: string; amount: number; paid_by: string; status: string; booked_at: string
}

export const te = {
  // ── the employee ──────────────────────────────────────────────────────────
  /** Everything my own screens show. Render from this; call it again after every change. */
  me: () => get<Snapshot>('me'),
  placeAdd: (input: PlaceInput) => post<{ place_id: Uuid; matched?: true }>('places', input),
  vehicleLookup: (reg: string) => get<VehicleLookup>('vehicles/lookup', { reg }),
  vehicleAdd: (input: VehicleInput) => post<{ vehicle_id: Uuid; vehicle_type_code: string; is_verified: boolean }>('vehicles', input),

  tripPreview: (draft: TripDraft) => post<TripPreview>('trips/preview', draft),
  tripSave: (draft: TripDraft) => post<{ trip_id: Uuid; trip_no: string; status: TripStatus; warnings: string[] }>('trips', draft),
  trip: (id: Uuid) => get<TeTripDetail>(`trips/${id}`),
  tripAnswer: (id: Uuid, text: string) => post<{ trip_id: Uuid; status: TripStatus }>(`trips/${id}/action`, { action: 'answer', text }),
  tripCancel: (id: Uuid) => post<{ trip_id: Uuid; status: 'CANCELLED'; deleted: boolean }>(`trips/${id}/action`, { action: 'cancel' }),
  tripRecordMissed: (id: Uuid, reason: string, note?: string) => post<{ trip_id: Uuid; status: TripDisplayStatus }>(`trips/${id}/action`, { action: 'record-missed', reason, note }),
  legAdd: (tripId: Uuid, leg: ExtraLegInput) => post<{ leg_id: Uuid; leg_no: number }>(`trips/${tripId}/legs`, leg),

  legStart: (id: Uuid, fix: GpsFix) => post<{ leg_id: Uuid; status: 'ACTIVE'; start_off_m: number | null }>(`legs/${id}/action`, { action: 'start', fix }),
  legPings: (id: Uuid, pings: GpsPing[]) => post<{ leg_id: Uuid; stored: number; total: number }>(`legs/${id}/action`, { action: 'pings', pings }),
  legStop: (id: Uuid, stop: StopInput) => post<{ leg_id: Uuid; stop_id: Uuid; seq: number; status: 'PAUSED' }>(`legs/${id}/action`, { action: 'stop', stop }),
  legContinue: (id: Uuid, minutes?: number, at?: string) => post<{ leg_id: Uuid; stop_id: Uuid; minutes: number; status: 'ACTIVE' }>(`legs/${id}/action`, { action: 'continue', minutes, at }),
  legEnd: (id: Uuid, fix: GpsFix) => post<{ leg_id: Uuid; status: 'ENDED'; gps_km: number; end_off_m: number | null; stats: TeLegStats }>(`legs/${id}/action`, { action: 'end', fix }),
  legPreview: (id: Uuid, report: LegReportInput) => post<LegPreview>(`legs/${id}/action`, { action: 'preview', report }),
  legFile: (id: Uuid, report: LegReportInput) => post<{ leg_id: Uuid; status: 'SUBMITTED'; expense_id: Uuid | null; trip_status: TripDisplayStatus; eligible: number; flags: TeFlag[] }>(`legs/${id}/action`, { action: 'file', report }),
  legSkip: (id: Uuid, reason: string) => post<{ leg_id: Uuid; status: 'SKIPPED'; trip_status: TripDisplayStatus }>(`legs/${id}/action`, { action: 'skip', reason }),
  legNoGps: (id: Uuid, reason: string, note?: string) => post<{ leg_id: Uuid; status: 'ENDED' }>(`legs/${id}/action`, { action: 'no-gps', reason, note }),

  expensePreview: (input: ExpenseInput) => post<ExpensePreview>('expenses/preview', input),
  expenseSave: (input: ExpenseInput) => post<{ expense_id: Uuid; expense_no: string; status: string; eligible: number; flags: TeFlag[] }>('expenses', input),
  expenseDiscard: (id: Uuid) => call<{ expense_id: Uuid; status: 'DISCARDED' }>('DELETE', `expenses/${id}`),

  /** Store a bill or an RC photo. Send the returned file back, unchanged, in `files: [file]`. */
  async upload(file: File, kind: 'BILL' | 'TICKET' | 'TOLL_SLIP' | 'FASTAG_STATEMENT' | 'OTHER' | 'RC' = 'BILL'): Promise<TeUploadedFile> {
    const fd = new FormData()
    fd.set('file', file)
    fd.set('kind', kind)
    // No Content-Type here: the browser must write the multipart boundary itself.
    const res = await fetch('/api/te/upload', { method: 'POST', cache: 'no-store', headers: await uploadAuthHeaders(), body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new TeApiError(res.status, data)
    return (data as { file: TeUploadedFile }).file
  },
  /** A one-hour link to open a stored file. claimId is needed for a file that is not your own. */
  fileUrl: (path: string, claimId?: Uuid) => get<{ url: string; expires_in: number }>('upload', { path, claim_id: claimId }),

  claimPreview: (input: ClaimInput = {}) => post<ClaimPreview>('claims/preview', input),
  claimSubmit: (input: ClaimInput) => post<{ claim_id: Uuid; claim_no: string; status: ClaimStatus; stage: ClaimStage; risk_band: RiskBand; chain_notes: string[] }>('claims', input),
  claim: (id: Uuid) => get<TeClaimDetail>(`claims/${id}`),
  claimRespond: (id: Uuid, text: string) => post<ClaimResult>(`claims/${id}/action`, { action: 'respond', text }),
  claimRecall: (id: Uuid) => post<{ claim_id: Uuid; status: 'CANCELLED' }>(`claims/${id}/action`, { action: 'recall' }),

  // ── approvers and Finance (the server decides whether this person may act) ──
  queue: () => get<{ queue: TeQueueRow[] }>('queue').then(r => r.queue),
  tripDecide: (id: Uuid, action: 'approve' | 'sendback' | 'reject', comment?: string) => post<{ trip_id: Uuid; status: TripStatus }>(`trips/${id}/decide`, { action, comment }),
  /** approval levels: approve | sendback | reject · finance levels: verify | hold | sendback | reject */
  claimDecide: (id: Uuid, action: 'approve' | 'verify' | 'hold' | 'sendback' | 'reject', o: DecideInput & { stage?: ClaimStage } = {}) => post<ClaimResult>(`claims/${id}/decide`, { action, ...o }),
  flagResolve: (id: Uuid, status: 'dismissed' | 'confirmed', note: string) => post<{ flag_id: Uuid; status: string; risk_band?: RiskBand }>(`flags/${id}`, { status, note }),
  claimReopen: (id: Uuid, reason: string) => post<{ claim_id: Uuid; status: ClaimStatus }>(`claims/${id}/reopen`, { reason }),

  // ── the Finance desk (dashboard Finance permission) ─────────────────────────
  finance: {
    summary: (q?: { company_id?: string }) => get<{ summary: FinanceSummary; company_id: Uuid }>('finance/overview', { view: 'summary', ...q }),
    claims: (q?: PageQuery & { status?: string; stage?: string; employee_id?: string; period?: string; from?: string; to?: string; q?: string }) => get<Page<ClaimSummaryRow>>('finance/overview', { view: 'claims', ...q }),
    payable: (q?: PageQuery) => get<Page<{ claim_id: Uuid; claim_no: string; employee_id: Uuid; emp_code: string; employee_name: string; net_amount: number; verified_at: string; bank_account_last4: string | null; ifsc_code: string | null }>>('finance/overview', { view: 'payable', ...q }),
    advances: (q?: PageQuery & { status?: string }) => get<Page<Record<string, unknown>>>('finance/overview', { view: 'advances', ...q }),
    adjustments: (q?: PageQuery & { status?: string }) => get<Page<AdjustmentRow>>('finance/overview', { view: 'adjustments', ...q }),
    periods: (q?: PageQuery) => get<Page<{ id: Uuid; period_month: string; period_label: string; status: string; closed_at: string | null; locked_at: string | null }>>('finance/overview', { view: 'periods', ...q }),
    advanceAct: (id: Uuid, action: 'pay' | 'reject' | 'refund' | 'payroll' | 'carry', o: { amount?: number; ref?: string } = {}) => post<{ advance_id: Uuid; status: string; outstanding_amount: number; carried_to: Uuid | null }>(`advances/${id}`, { action, ...o }),
    payouts: (q?: PageQuery & { status?: string }) => get<Page<PayoutBatch>>('payouts', q),
    payoutCreate: (route: PayoutRoute, claimIds?: Uuid[]) => post<{ batch_id: Uuid; batch_no: string; total_amount: number; items: number }>('payouts', { route, claim_ids: claimIds }),
    /** The bank file as CSV text. It carries full account numbers: save it, do not show it. */
    async payoutFile(batchId: Uuid): Promise<Blob> {
      const res = await fetch(`/api/te/payouts/${batchId}`, { method: 'POST', cache: 'no-store', headers: await authHeaders(), body: JSON.stringify({ action: 'file' }) })
      if (!res.ok) throw new TeApiError(res.status, await res.json().catch(() => null))
      return res.blob()
    },
    payoutPaid: (batchId: Uuid, ref: string) => post<{ batch_id: Uuid; status: 'PAID' }>(`payouts/${batchId}`, { action: 'paid', ref }),
    payoutCancel: (batchId: Uuid, reason: string) => post<{ batch_id: Uuid; status: 'CANCELLED'; claims_returned: number }>(`payouts/${batchId}`, { action: 'cancel', reason }),
    payoutItemFailed: (batchId: Uuid, itemId: Uuid, reason: string) => post<{ item_id: Uuid; claim_id: Uuid; status: 'VERIFIED' }>(`payouts/${batchId}`, { action: 'item-failed', item_id: itemId, reason }),
    adjustmentAdd: (claimId: Uuid, direction: 'recover' | 'pay', amount: number, reason: string) => post<{ adjustment_id: Uuid; status: 'OPEN' }>('adjustments', { claim_id: claimId, direction, amount, reason }),
    adjustmentClose: (id: Uuid, action: 'done' | 'cancel', reference?: string) => post<{ adjustment_id: Uuid; status: 'DONE' | 'CANCELLED' }>(`adjustments/${id}`, { action, reference }),
    /** month = 'YYYY-MM' */
    periodAct: (month: string, action: 'close' | 'reopen' | 'roll' | 'lock', reason?: string) => post<{ period_id: Uuid; status: string; rolled: number }>('periods', { month, action, reason }),
  },

  // ── the Travel Desk (dashboard Travel Claims permission, edit) ─────────────
  desk: {
    list: (q?: { company_id?: string }) => get<{ company_id: Uuid; to_book: DeskToBook[]; booked: DeskBooked[]; vehicles: DeskVehicle[] }>('desk', q),
    bookingRecord: (input: BookingInput) => post<{ booking_id: Uuid; booking_no: string; expense_id: Uuid }>('bookings', input),
    bookingCancel: (id: Uuid, reason: string) => post<{ booking_id: Uuid; status: 'CANCELLED' }>(`bookings/${id}/cancel`, { reason }),
    vehicleVerify: (id: Uuid, typeCode?: string) => post<{ vehicle_id: Uuid; vehicle_type_code: string }>(`vehicles/${id}/verify`, { type_code: typeCode }),
  },

  // ── admin (dashboard Travel Claims permission, full) ───────────────────────
  admin: {
    config: (q?: { company_id?: string }) => get<{ company_id: Uuid; config: TeConfig; masters: TeMasters; settings: Record<string, unknown> | null }>('admin/config', q),
    settingsSave: (patch: Record<string, unknown>) => call<{ company_id: Uuid; settings: Record<string, unknown>; config: TeConfig }>('PATCH', 'admin/settings', patch),
    mastersSave: (table: string, rows: Record<string, unknown>[]) => call<{ table: string; updated: number; inserted: number; rows: Record<string, unknown>[] }>('PUT', `admin/masters/${table}`, { rows }),
    workflow: (code: 'claim' | 'trip') => get<{ workflow: string; levels: TeWorkflowLevel[]; fallback: Uuid | null; finance_team: Uuid[] }>(`admin/workflow/${code}`),
    workflowSave: (code: 'claim' | 'trip', levels: TeWorkflowLevel[]) => call<{ ok: true; version: number; levels: TeWorkflowLevel[] }>('PUT', `admin/workflow/${code}`, { levels }),
    workflowPreview: (code: 'claim' | 'trip', sample: WorkflowSample, levels?: TeWorkflowLevel[]) => post<{ workflow: string; chain: TeChainRow[] }>(`admin/workflow/${code}/preview`, { levels, sample }),
    workflowReset: (code: 'claim' | 'trip') => post<{ ok: true; version: number; levels: TeWorkflowLevel[] }>(`admin/workflow/${code}/reset`),
    health: (q?: { company_id?: string }) => get<{ company_id: Uuid; status: 'ok' | 'warn' | 'fail'; health: TeHealthRow[] }>('admin/health', q),
    audit: (q?: PageQuery & { entity_type?: string; entity_id?: string; action?: string; actor_id?: string; from?: string; to?: string; detail?: 1 }) => get<Page<AuditRow>>('admin/audit', q),
    claimsReport: (q?: PageQuery & { status?: string; period?: string; employee_id?: string; from?: string; to?: string }) => get<Page<ClaimSummaryRow>>('admin/reports/claims', q),
    /** Every flag raised across claims. Says which checks earn their keep. */
    flagsReport: (q?: PageQuery & { check_code?: string; status?: string; blocking?: '0' | '1'; from?: string; to?: string }) => get<Page<FlagReportRow>>('admin/reports/flags', q),
    /** Every trip in the company, for the GPS log. The per-leg detail is te.trip(id). */
    trips: (q?: PageQuery & { employee_id?: string; scope?: string; status?: string; from?: string; to?: string }) => get<Page<AdminTripRow>>('admin/trips', q),
    /** A report as a file. The same filters, plus format=csv. */
    reportCsv: async (report: 'claims' | 'flags' | 'trips', q: Record<string, string> = {}): Promise<Blob> => {
      const path = report === 'trips' ? 'admin/trips' : `admin/reports/${report}`
      const url = new URL(`/api/te/${path}`, window.location.origin)
      for (const [k, v] of Object.entries({ ...q, format: 'csv' })) if (v) url.searchParams.set(k, v)
      const res = await fetch(url, { cache: 'no-store', headers: await authHeaders() })
      if (!res.ok) throw new TeApiError(res.status, await res.json().catch(() => null))
      return res.blob()
    },
  },
}
