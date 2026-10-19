// Types for te-service.js, written by hand.
//
// te-service.js is plain CommonJS JavaScript on purpose: the same file runs in
// the engine tests (db = node-postgres) and in the Next.js routes (db = Supabase
// service client). This file gives the TypeScript routes real types for it.
// When a function in te-service.js changes, change its line here.
//
// Result shapes were taken from the SQL functions' return statements
// (146, 147, 148) and checked against real output on a seeded database.
import type {
  Uuid, IsoTime, Snapshot, TeQueueRow, TeTripDetail, TeClaimDetail, PlaceInput, VehicleInput, RcRecord, RcChecked,
  TripDraft, TripPreview, TripStatus, TripDisplayStatus, GpsFix, GpsPing, StopInput, LegReportInput, ExtraLegInput,
  LegPreview, TeLegStats, TeFlag, ExpenseInput, ExpensePreview, ClaimInput, ClaimPreview, ClaimStatus, ClaimStage,
  RiskBand, DecideInput, PayoutRoute, TeConfig, TeWorkflowLevel, TeChainRow, TeStep,
  TeDashboard, TeDraft, TeDraftInput,
} from '../types'

/** What te-service needs to reach the database: one call, named arguments in,
 *  the function's result out. A refusal is thrown as an Error carrying
 *  `.hint` (the TE_ code), `.code` ('P0001') and `.details`. */
export interface TeDb {
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>
}

export interface RouteResult { km: number; minutes?: number | null; polyline?: string | null; provider?: string }
export interface GeocodeResult { lat: number; lng: number; approx?: boolean }
export interface ReverseGeocodeResult { name?: string; address?: string; city?: string; pin?: string; country?: string }
export interface AddressQuery { line: string; area: string; city: string; state?: string; pin: string; country: string }
/** A place as the engine holds it; what `routes` is called with. */
export interface EnginePlace { id: Uuid; lat: number; lng: number; name?: string; s?: string; city?: string | null }

export interface TeCtx {
  db: TeDb
  /** The employee who is acting. From the signed token, never from the request body. */
  actor: Uuid
  /** The server clock in milliseconds. Left out = Date.now(). */
  now?: () => number
  /** Road distance between two places. Left out = the engine uses its own estimate. */
  routes?: (from: EnginePlace, to: EnginePlace) => Promise<RouteResult | null>
  /** The registration certificate for a normalised number ('HR26DK4821'). null = not found. */
  rc?: (regNo: string) => Promise<RcRecord | null>
  geocode?: (address: AddressQuery) => Promise<GeocodeResult | null>
  reverseGeocode?: (lat: number, lng: number) => Promise<ReverseGeocodeResult | null>
}

/** A refusal raised by the service layer before the database is asked.
 *  status is 403 for TE_FORBIDDEN, else 409. extra carries { field } and/or { flags } / { issues }. */
export class TeError extends Error {
  name: 'TeError'
  code: string
  status: 403 | 409
  extra: { field?: string; flags?: TeFlag[]; issues?: { block: boolean; t: string; k?: string }[] } | null
  constructor(message: string, code?: string, extra?: Record<string, unknown>)
}

// ── reading ─────────────────────────────────────────────────────────────────
export function me(ctx: TeCtx): Promise<Snapshot>
export function queue(ctx: TeCtx): Promise<TeQueueRow[]>
export function tripDetail(ctx: TeCtx, tripId: Uuid, admin?: boolean): Promise<TeTripDetail>
export function claimDetail(ctx: TeCtx, claimId: Uuid, admin?: boolean): Promise<TeClaimDetail>

// ── places and vehicles ─────────────────────────────────────────────────────
export function placeAdd(ctx: TeCtx, input: PlaceInput): Promise<{ place_id: Uuid; matched?: true }>
export type VehicleLookup =
  | { off: true; reg: string }
  | { notFound: true; reg: string }
  | { reg: string; rc: RcChecked; type: string; typeName: string; ownerMasked: string; match: 'match' | 'partial' | 'no'; valid: { rc: boolean; ins: boolean; puc: boolean } }
export function vehicleLookup(ctx: TeCtx, reg: string): Promise<VehicleLookup>
export function vehicleAdd(ctx: TeCtx, input: VehicleInput): Promise<{ vehicle_id: Uuid; vehicle_type_code: string; is_verified: boolean }>
export function vehicleVerify(ctx: TeCtx, vehicleId: Uuid, typeCode?: string | null): Promise<{ vehicle_id: Uuid; vehicle_type_code: string }>

// ── trips ───────────────────────────────────────────────────────────────────
export function tripPreview(ctx: TeCtx, draft: TripDraft): Promise<TripPreview>
export function tripSave(ctx: TeCtx, draft: TripDraft): Promise<{ trip_id: Uuid; trip_no: string; status: TripStatus; warnings: string[]; steps?: number }>
export function tripDecide(ctx: TeCtx, tripId: Uuid, action: 'approve' | 'sendback' | 'reject', comment?: string | null): Promise<{ trip_id: Uuid; status: TripStatus }>
export function tripAnswer(ctx: TeCtx, tripId: Uuid, text: string): Promise<{ trip_id: Uuid; status: TripStatus }>
export function tripCancel(ctx: TeCtx, tripId: Uuid, admin?: boolean): Promise<{ trip_id: Uuid; status: 'CANCELLED'; deleted: boolean }>
export function tripRecordMissed(ctx: TeCtx, tripId: Uuid, reason: string, note?: string | null): Promise<{ trip_id: Uuid; status: TripDisplayStatus }>
export interface BookingInput { trip_id: Uuid; leg_id?: Uuid; point_seq?: number; vendor: string; reference: string; amount: number; ticket_url?: string }
export function bookingRecord(ctx: TeCtx, input: BookingInput): Promise<{ booking_id: Uuid; booking_no: string; expense_id: Uuid }>
/** What the employee found and is asking the desk to book. No `reference`: a
 *  request has no PNR yet, which is why 153 made that column nullable. */
export interface StayRequestInput {
  trip_id: Uuid
  point_seq?: number
  leg_id?: Uuid
  vendor: string
  amount: number
  ticket_url?: string
  details: { address?: string; room?: string; platform?: string; check_in?: string; check_out?: string; note?: string }
}
/** Asks the Travel Desk for a stay. Writes no expense — nothing is bought yet. */
export function bookingRequest(ctx: TeCtx, input: StayRequestInput): Promise<{ booking_id: Uuid; booking_no: string; status: 'REQUESTED' }>
export function stayDecide(ctx: TeCtx, input: { trip_id: Uuid; action: 'choose' | 'reject'; choice?: number; remark?: string }): Promise<{ trip_id: Uuid; status: 'CHOSEN' | 'REJECTED'; chosen: number | null; name: string }>
export function dashboard(ctx: TeCtx, from: string | null, to: string | null): Promise<TeDashboard>
export function bookingCancel(ctx: TeCtx, bookingId: Uuid, reason: string): Promise<{ booking_id: Uuid; status: 'CANCELLED' }>

// ── legs ────────────────────────────────────────────────────────────────────
export function legStart(ctx: TeCtx, legId: Uuid, fix: GpsFix): Promise<{ leg_id: Uuid; status: 'ACTIVE'; start_off_m: number | null }>
export function legPings(ctx: TeCtx, legId: Uuid, pings: GpsPing[]): Promise<{ leg_id: Uuid; stored: number; total: number }>
export function legStop(ctx: TeCtx, legId: Uuid, stopAt: StopInput): Promise<{ leg_id: Uuid; stop_id: Uuid; seq: number; status: 'PAUSED' }>
export function legContinue(ctx: TeCtx, legId: Uuid, minutes?: number | null, at?: IsoTime | null): Promise<{ leg_id: Uuid; stop_id: Uuid; minutes: number; status: 'ACTIVE' }>
export function legEnd(ctx: TeCtx, legId: Uuid, fix: GpsFix): Promise<{ leg_id: Uuid; status: 'ENDED'; gps_km: number; end_off_m: number | null; stats: TeLegStats }>
export function legPreview(ctx: TeCtx, legId: Uuid, d: LegReportInput): Promise<LegPreview>
export function legFile(ctx: TeCtx, legId: Uuid, d: LegReportInput): Promise<{ leg_id: Uuid; status: 'SUBMITTED'; expense_id: Uuid | null; trip_status: TripDisplayStatus; eligible: number; flags: TeFlag[] }>
export function legSkip(ctx: TeCtx, legId: Uuid, reason: string): Promise<{ leg_id: Uuid; status: 'SKIPPED'; trip_status: TripDisplayStatus }>
export function legNoGps(ctx: TeCtx, legId: Uuid, reason: string, note?: string | null): Promise<{ leg_id: Uuid; status: 'ENDED' }>
export function legAdd(ctx: TeCtx, tripId: Uuid, d: ExtraLegInput): Promise<{ leg_id: Uuid; leg_no: number }>

// ── the two desks' review of a journey (180) ────────────────────────────────
/** A desk agrees the journey happened as recorded. `desk` is which desk is
 *  speaking; the caller must be a member of it, which SQL checks. */
export function legConfirm(ctx: TeCtx, legId: Uuid, desk: 'travel' | 'finance'):
  Promise<{ leg_id: Uuid; desk: string; policy: string }>
/** A desk asks the traveller for something. Holds the trip's claim until
 *  answered; the reason is required. */
export function legSendBack(ctx: TeCtx, legId: Uuid, desk: 'travel' | 'finance', reason: string):
  Promise<{ leg_id: Uuid; desk: string }>
/** The traveller answers. Lifts the hold; does not restore the confirmation. */
export function legAnswer(ctx: TeCtx, legId: Uuid, text: string): Promise<{ leg_id: Uuid }>

// ── expenses ────────────────────────────────────────────────────────────────
export function expensePreview(ctx: TeCtx, input: ExpenseInput): Promise<ExpensePreview>
export function expenseSave(ctx: TeCtx, input: ExpenseInput): Promise<{ expense_id: Uuid; expense_no: string; status: string; eligible: number; flags: TeFlag[] }>
export function expenseDiscard(ctx: TeCtx, expenseId: Uuid): Promise<{ expense_id: Uuid; status: 'DISCARDED' }>

// ── drafts ──────────────────────────────────────────────────────────────────
// Unfinished work, stored verbatim and private to the person who wrote it.
// These take no employee id: te_draft_* filter on the actor.
export function bookingEmailed(ctx: TeCtx, bookingId: Uuid, to: string): Promise<{ booking_id: Uuid; emailed_to: string }>
export function draftSave(ctx: TeCtx, input: TeDraftInput): Promise<{ draft_id: Uuid; updated_at: string }>
export function draftList(ctx: TeCtx, kind?: TeDraft['kind'] | null): Promise<TeDraft[]>
export function draftDelete(ctx: TeCtx, draftId: Uuid): Promise<{ deleted: boolean }>
/** Discard several of the actor's own drafts in one statement. `deleted` is how
 *  many actually went, which can be fewer than `asked` when one had already
 *  gone or was never theirs. */
export function draftDeleteMany(ctx: TeCtx, ids: Uuid[]): Promise<{ deleted: number; asked: number }>

// ── claims ──────────────────────────────────────────────────────────────────
export interface ClaimResult { claim_id: Uuid; status: ClaimStatus; stage: ClaimStage; net_amount?: number | null; advance_adjusted?: number }
export function claimPreview(ctx: TeCtx, input?: ClaimInput): Promise<ClaimPreview>
export function claimSubmit(ctx: TeCtx, input: ClaimInput): Promise<{ claim_id: Uuid; claim_no: string; status: ClaimStatus; stage: ClaimStage; risk_band: RiskBand; chain_notes: string[] }>
export function claimRespond(ctx: TeCtx, claimId: Uuid, text: string): Promise<ClaimResult>
export function claimRecall(ctx: TeCtx, claimId: Uuid): Promise<{ claim_id: Uuid; status: 'CANCELLED' }>
export function claimDecide(ctx: TeCtx, claimId: Uuid, action: 'approve' | 'sendback' | 'reject', o?: DecideInput): Promise<ClaimResult>
export function claimFinance(ctx: TeCtx, claimId: Uuid, action: 'verify' | 'hold' | 'sendback' | 'reject', o?: DecideInput): Promise<ClaimResult>
export function flagResolve(ctx: TeCtx, flagId: Uuid, status: 'dismissed' | 'confirmed', note: string): Promise<{ flag_id: Uuid; status: string; risk_score?: number; risk_band?: RiskBand }>
export function claimReopen(ctx: TeCtx, claimId: Uuid, reason: string): Promise<{ claim_id: Uuid; status: ClaimStatus }>

// ── money ───────────────────────────────────────────────────────────────────
export function advanceAct(ctx: TeCtx, advanceId: Uuid, action: 'pay' | 'reject' | 'refund' | 'payroll' | 'carry', o?: { amount?: number; ref?: string }): Promise<{ advance_id: Uuid; status: string; outstanding_amount: number; carried_to: Uuid | null }>
export function payoutCreate(ctx: TeCtx, companyId: Uuid, route: PayoutRoute, claimIds?: Uuid[] | null): Promise<{ batch_id: Uuid; batch_no: string; total_amount: number; items: number }>
/** One row of the bank file. account_number is the full number: only a Finance route may return it. */
export interface PayoutFileRow { beneficiary_name: string; emp_code: string; account_number: string | null; ifsc: string | null; amount: number | string; narration: string }
export function payoutFile(ctx: TeCtx, batchId: Uuid): Promise<PayoutFileRow[]>
export function payoutPaid(ctx: TeCtx, batchId: Uuid, ref: string): Promise<{ batch_id: Uuid; status: 'PAID' }>
export function payoutItemFailed(ctx: TeCtx, itemId: Uuid, reason: string): Promise<{ item_id: Uuid; claim_id: Uuid; status: 'VERIFIED' }>
export function payoutCancel(ctx: TeCtx, batchId: Uuid, reason: string): Promise<{ batch_id: Uuid; status: 'CANCELLED'; claims_returned: number }>
export function adjustmentAdd(ctx: TeCtx, claimId: Uuid, direction: 'recover' | 'pay', amount: number, reason: string): Promise<{ adjustment_id: Uuid; status: 'OPEN' }>
export function adjustmentClose(ctx: TeCtx, adjustmentId: Uuid, action: 'done' | 'cancel', reference?: string | null): Promise<{ adjustment_id: Uuid; status: 'DONE' | 'CANCELLED' }>
/** month = any date in the month, 'YYYY-MM-DD'. */
export function periodAct(ctx: TeCtx, companyId: Uuid, month: string, action: 'close' | 'reopen' | 'roll' | 'lock', reason?: string | null): Promise<{ period_id: Uuid; status: string; rolled: number }>

// ── admin ───────────────────────────────────────────────────────────────────
export function config(ctx: TeCtx, companyId: Uuid): Promise<TeConfig>
export function workflowSave(ctx: TeCtx, companyId: Uuid, workflow: 'claim' | 'trip', levels: TeWorkflowLevel[]): Promise<{ ok: true; version: number; levels: TeWorkflowLevel[] }>
export function workflowReset(ctx: TeCtx, companyId: Uuid, workflow: 'claim' | 'trip'): Promise<{ ok: true; version: number; levels: TeWorkflowLevel[] }>
export interface WorkflowSample { employee_id: Uuid; total?: number; scope?: string | null; postFacto?: boolean; exception?: boolean; band?: RiskBand; co?: Uuid[] }
export function workflowPreview(ctx: TeCtx, companyId: Uuid, workflow: 'claim' | 'trip', levels: TeWorkflowLevel[] | null, sample: WorkflowSample): Promise<TeChainRow[]>
export interface DailyReminder { step_id: Uuid; entity_type: 'claim' | 'trip'; entity_id: Uuid; ref_no: string; approver_id: Uuid | null; team_code: string | null; days_waiting: number; escalate: boolean }
export function daily(ctx: Pick<TeCtx, 'db'> & { actor?: Uuid | null }, companyId?: Uuid | null): Promise<{ expired_lines: number; advances_overdue: number; pings_purged: number; reminders: DailyReminder[] }>

export type { TeStep }
