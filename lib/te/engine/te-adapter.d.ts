// Types for te-adapter.js, written by hand. The adapter is pure: a snapshot and
// what the user typed go in; what the engine decided and the JSON payload of the
// matching SQL function come out. The routes never call it directly (te-service
// does); these types exist for tests and for anyone reading the code.
import type {
  Uuid, Snapshot, TripDraft, TripIssue, PlannedLeg, TeTrip, TeEstimate, GpsFix, TeLegStats, LegReportInput,
  ExtraLegInput, ExpenseInput, TeFlag, MileageView, TeUploadedFile, TeLineFile, RcRecord, RcChecked, RiskBand,
} from '../types'
import type { Engine } from './te-engine.js'

export const ENGINE_VERSION: string

/** A fresh engine holding a copy of this snapshot. routesOnly = never fall back to the
 *  engine's own distance estimate; record the missing pairs in EZ.S.routeMiss instead. */
export function open(snapshot: Snapshot, opts?: { routesOnly?: boolean }): Engine

/** A file row as te_expense_files stores it. */
export interface DbFile { kind: string; storage_path: string; file_name: string | null; mime_type: string | null; file_size: number | null; sha256: string | null; phash: string | null; ocr: TeUploadedFile['ocr']; metadata: TeUploadedFile['metadata'] }
export function fileToEngine(f: Partial<TeUploadedFile> | null | undefined): TeLineFile | null
export function filesToDb(files: Partial<TeUploadedFile>[] | null | undefined): DbFile[]

/** The JSON te_trip_save takes (146). */
export interface TripPayload {
  trip_id: Uuid | null
  employee_id: Uuid
  name: string
  scope: string
  pattern: string
  origin: string
  purpose: string
  project: string
  pax: number
  stay_by: string
  advance: number
  post_facto_reason: string
  post_facto_note: string
  answer: string
  start_date: string | null
  end_date: string | null
  from_label: string
  to_label: string
  country: string
  estimate: TeEstimate
  estimate_total: number
  self_estimate: number
  planned_km: number
  points: { place_id: Uuid; place_type: string; what: string; arrive_on: string | null; leave_on: string | null; is_return: boolean }[]
  segments: { mode: string; booked_by: string; vehicle_id: Uuid | null; first_mile_mode: string | null; last_mile_mode: string | null; hub_from_place_id: Uuid | null; hub_to_place_id: Uuid | null }[]
  people: { emp_code: string; name: string }[]
  legs: { leg_no: number; segment_seq: number; kind: string; from_place_id: Uuid; to_place_id: Uuid; leg_date: string; mode: string; vehicle_id: Uuid | null; booked_by: string; gps_mode: string; planned_km: number }[]
}
export interface TripPlan {
  trip: TeTrip & { co: Uuid[] }
  legs: PlannedLeg[]
  issues: TripIssue[]
  blocked: TripIssue[]
  warnings: string[]
  estimate: TeEstimate
  estimateTotal: number
  selfEstimate: number
  advanceCap: number
  plannedKm: number
  needsApproval: boolean
  payload: TripPayload
}
export function planTrip(EZ: Engine, empId: Uuid, draft: TripDraft): TripPlan
export function planExtraLeg(EZ: Engine, tripId: Uuid, d: ExtraLegInput): { error: string } | { payload: Record<string, unknown> }

export interface LegEndPayload {
  gps_km: number; route_km: number; gps_points: number; gps_gap_max_sec: number
  gps_max_speed_kmh: number; moving_minutes: number; stats: TeLegStats
  /** The trail as an encoded polyline, for te_legs.route_polyline. This is the
   *  only record of the route that outlives the nightly purge of te_leg_pings,
   *  so a journey that ends without it can never be drawn again. */
  route_polyline: string
}
export function legEndStats(EZ: Engine, legId: Uuid, fix: GpsFix, nowMs: number): { error: string } | { stats: TeLegStats; payload: LegEndPayload }

/** The JSON te_expense_save / te_leg_file take (146). */
export interface ExpensePayload {
  expense_id: Uuid | null
  employee_id: Uuid
  trip_id: Uuid | null
  category_code: string
  expense_date: string
  check_in: string | null
  check_out: string | null
  merchant: string
  merchant_gstin: string
  bill_no: string
  reference: string
  travel_class: string
  bill_amount: number
  claimed_amount: number
  currency: string
  fx_amount: number | null
  fx_rate: number | null
  payment_mode: string
  description: string
  employee_reason: string
  wants_exception: boolean
  vehicle_id: Uuid | null
  from_place_id: Uuid | null
  to_place_id: Uuid | null
  payable_km: number | null
  rate_applied: number | null
  client_name: string
  attendees: number | null
  details: Record<string, unknown>
  files?: DbFile[]
}
/** An expense line as the engine reads it. */
export type EngineLine = Record<string, unknown> & { id: Uuid | null; emp: Uuid; cat: string; bill: number; claimed: number }
export interface PreparedLine { line: EngineLine; flags: TeFlag[]; eligible: number; claimed: number; mileage: MileageView | null; blocked: boolean; needsReason: boolean; payload: ExpensePayload }
export function legReport(EZ: Engine, legId: Uuid, d: LegReportInput): { error: string } | { none: true; stats: TeLegStats | null; payload: null } | (PreparedLine & { stats: TeLegStats | null })
export function lineFromInput(EZ: Engine, empId: Uuid, input: ExpenseInput): EngineLine
export function expensePayload(x: EngineLine, files?: Partial<TeUploadedFile>[] | null): ExpensePayload
export function prepareExpense(EZ: Engine, empId: Uuid, input: ExpenseInput): PreparedLine

/** The "assessment" te_claim_submit and te_claim_respond take (147). */
export interface AssessmentPayload { eligible: number; score: number; band: RiskBand; exception: boolean; rows: { id: Uuid; eligible: number; claimed?: number; pay_km?: number; rate?: number }[]; flags: TeFlag[] }
export interface ClaimAssessment {
  claimed: number
  eligible: number
  companyPaid: number
  outstanding: number
  net: number
  score: number
  band: RiskBand
  exception: boolean
  lines: { id: Uuid; claimed: number; eligible: number; flags: TeFlag[] }[]
  flags: TeFlag[]
  blockers: TeFlag[]
  needs: TeFlag[]
  stop: string[]
  payload: AssessmentPayload
}
export function assessClaim(EZ: Engine, empId: Uuid, tripId: Uuid | null, lineIds: Uuid[], note?: string): { error: string } | ClaimAssessment

export type VehicleFromRc =
  | { error: string }
  | { off: true; reg: string }
  | { notFound: true; reg: string }
  | { reg: string; rc: RcChecked; type: string; typeName: string; ownerMasked: string; match: 'match' | 'partial' | 'no'; valid: { rc: boolean; ins: boolean; puc: boolean } }
export function vehicleFromRc(EZ: Engine, empId: Uuid, reg: string, rc: RcRecord | null): VehicleFromRc
