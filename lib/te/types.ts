// lib/te/types.ts — the shapes that travel between the database, the rules engine,
// the API routes and the browser for Travel & Expense v2.
//
// WHERE THESE COME FROM
//   Every read in this module is one SQL function that returns JSON
//   (supabase/migrations/148_te_functions_read.sql). The field names below are
//   the keys of those jsonb_build_object(...) calls, checked against real output
//   of the service layer on a seeded database. They are the rules engine's own
//   short names (emp, cat, pay, …) because the same JSON is loaded straight into
//   the engine: nothing in between renames a field.
//
// This file is types only. It is imported with `import type` by server code,
// by the engine's .d.ts files and by the browser client, so it must never
// import anything that runs.
//
// NUMBERS  A Postgres numeric inside JSON arrives as a number. A numeric
// COLUMN of a view (v_te_claim_summary.claimed_total, the bank file's amount)
// also arrives as a number through PostgREST, but as a string through
// node-postgres. Only the tests use node-postgres; the types here describe what
// the app sees.

export type Uuid = string
/** A calendar date, 'YYYY-MM-DD'. */
export type IsoDate = string
/** A timestamp with zone, ISO 8601. */
export type IsoTime = string

// ── small vocabularies ──────────────────────────────────────────────────────
export type TripScope = 'local' | 'domestic' | 'international'
export type TripPattern = 'oneway' | 'round' | 'multi'
export type TripOrigin = 'PRE_APPROVED' | 'POST_FACTO'
/** What te_trips.status stores. */
export type TripStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'SENT_BACK' | 'APPROVED' | 'CLAIMED' | 'CLOSED' | 'CANCELLED' | 'REJECTED'
/** What the employee sees: the stored status, or one worked out from the legs and today's date. */
export type TripDisplayStatus = TripStatus | 'EXPIRED' | 'ONGOING' | 'COMPLETED' | 'MISSED'
export type LegStatus = 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'SUBMITTED' | 'SKIPPED' | 'CANCELLED'
export type LegKind = 'main' | 'return' | 'first' | 'last' | 'extra' | string
export type GpsMode = 'track' | 'checkin'
export type ExpenseStatus = 'UNCLAIMED' | 'IN_CLAIM' | 'APPROVED' | 'PAID' | 'REJECTED_FINAL' | 'REJECTED_REFILE' | 'EXPIRED' | 'DISCARDED' | string
export type ClaimStatus = 'IN_APPROVAL' | 'IN_VERIFICATION' | 'ON_HOLD' | 'SENT_BACK' | 'VERIFIED' | 'SETTLED' | 'REJECTED' | 'CANCELLED' | string
export type ClaimStage = 'manager' | 'finance'
export type RiskBand = 'Low' | 'Medium' | 'High'
export type FlagAction = 'block' | 'warn' | 'justify' | 'cap' | 'reroute' | 'report' | 'sample'
export type Severity = '' | 'low' | 'medium' | 'high'
export type StepStatus = 'pending' | 'approved' | 'rejected' | 'sent_back' | 'skipped' | string
export type PayoutRoute = 'PAYROLL' | 'OFF_CYCLE'

// ── people ──────────────────────────────────────────────────────────────────
/** One employee as the engine reads a person (te_emp_json). */
export interface TeEmployee {
  id: Uuid
  code: string
  name: string
  grade: string
  dept: string
  title: string
  /** The city of the employee's office. */
  base: string
  rm: Uuid | null
  rm2: Uuid | null
  hod: Uuid | null
  md: Uuid | null
  /** Masked: 'XXXXXX4821', or '' when no account is on file. */
  acct: string
  ifsc: string
  active: boolean
}

// ── places and vehicles ─────────────────────────────────────────────────────
export interface TePlace {
  id: Uuid
  /** 'saved' for a company place; 'gps' | 'address' | 'hub' for the others. */
  src: string
  /** te_place_types.code */
  pt: string | null
  /** Short name shown in lists. */
  s: string
  name: string
  addr: string
  city: string | null
  pin: string
  country: string
  lat: number
  lng: number
  /** IATA or station code for a hub. */
  code: string | null
  /** null = a company place everyone can pick. */
  owner: Uuid | null
}

/** A place as te_trip_detail returns it, keyed by id. */
export interface TePlaceBrief { s: string; name: string; addr: string; city: string | null; country: string; pt: string | null; lat: number; lng: number }

/** What the registration certificate says, in the engine's words. See lib/te/providers/rc.ts. */
export interface RcRecord {
  maker: string
  model: string
  /** Vehicle class as printed on the RC, e.g. 'Motor Car (LMV)' or 'Motor Cycle/Scooter (2WN)'. */
  cls: string
  /** 'Hatchback' | 'Sedan' | 'SUV' | 'MUV' | 'Scooter' | 'Motorcycle' */
  body: string
  /** 'Petrol' | 'Diesel' | 'CNG' | 'Electric' */
  fuel: string
  owner: string
  regd: IsoDate
  rcValid: IsoDate
  insValid: IsoDate
  /** '' for an electric vehicle. */
  pucValid: IsoDate | ''
}
/** The RC after the engine added what it worked out. */
export interface RcChecked extends RcRecord {
  no: string
  src: string
  checked: IsoDate
  /** te_vehicle_types.code the RC maps to. */
  type: string
  match: 'match' | 'partial' | 'no'
}
export interface TeVehicle {
  id: Uuid
  emp: Uuid
  type: string
  declared: string
  reg: string
  rc: RcChecked | null
  whose: 'self' | 'family' | 'other' | string
  photo: boolean
  verified: boolean
  /** 'rc' when Vahan confirmed it, 'hr' when a person did, '' when not verified. */
  vby: string
  added: IsoDate
}

// ── approval steps ──────────────────────────────────────────────────────────
export interface TeStep {
  id: Uuid
  n: number
  role: string
  /** Approver's employee id, or '' for a team step. */
  who: string
  whoName: string | null
  /** 'finance' for a Finance-team step, else ''. */
  team: string
  level: Uuid | null
  stage: ClaimStage
  status: StepStatus
  by: Uuid | null
  byName: string | null
  at: IsoTime | null
  comment: string
  due: IsoTime | null
}
/** One level of te_resolve_chain, as the preview calls return it. */
export interface TeChainPreview { role: string; who: Uuid | null; team: string | null; stage: ClaimStage; note: string | null; name: string }
/** One row of te_resolve_chain itself. */
export interface TeChainRow { step_no: number; stage: ClaimStage; level_id: Uuid | null; role_label: string; approver_id: Uuid | null; team_code: string | null; note: string | null }

// ── trips and legs ──────────────────────────────────────────────────────────
export interface TeTripPoint {
  place: Uuid; pt: string; what: string
  arrive: IsoDate | ''; leave: IsoDate | ''
  /** 'HH:MM' or '' for not recorded, which is not midnight. Migration 165. */
  leaveAt?: string; arriveAt?: string
  ret?: true
  /** A place passed through rather than the place you are going to. Lets a
   *  stop sit on either leg; see DraftPoint.stop. Migration 170. */
  stop?: true
}
export interface TeTripSegment {
  mode: string; bookedBy: string; vehicleId: Uuid | null
  xfer: { first?: string; last?: string; hubA?: Uuid; hubB?: Uuid }
  /** What the traveller asked the Travel Desk for: the time of day they want
   *  to leave, a link to the flight or train they found, and anything neither
   *  can say. All optional. Migration 171. */
  prefTime?: string; prefUrl?: string; prefNote?: string
}
export interface TeTripPerson { id: string; name: string; emp?: Uuid | null; found?: boolean }
/** One hotel the employee would accept. Stored whole on the trip; the link is
 *  rendered as a link out and never fetched. */
export interface TeStayOption { name: string; location: string; url: string; price?: number }
/** What the Travel Desk decided about those hotels. 'NONE' means nobody has
 *  looked yet, which is what the desk's own work list is built from. */
/** GET /api/te/admin/reports/approvers — F2 and F3, which are reports about
 *  approvers rather than flags on claims. `on` reflects the switch in Admin →
 *  Checks: a switched-off check still returns its rows, because the report is
 *  how somebody decides whether to switch it on. */
export interface TeFastApprover {
  who: Uuid; name: string
  /** Flagged claims this person decided in the window. */
  flagged: number
  /** How many of those were decided inside the threshold. */
  fast: number
  fastestSecs: number
  medianSecs: number
}
export interface TeApproverPair {
  who: Uuid; name: string
  employee: Uuid; employeeName: string
  /** This pairing's flagged claims, and that employee's total in the window. */
  pairs: number; theirTotal: number
  pct: number
}
export interface TeApproverWatch {
  from: IsoDate
  to: IsoDate
  f2: { on: boolean; seconds: number; minClaims: number; rows: TeFastApprover[] }
  f3: { on: boolean; pct: number; minClaims: number; rows: TeApproverPair[] }
}

/** GET /api/te/admin/desks — the desk configuration screen, in one read.
 *  Rows are the raw database shape on purpose: this screen edits the table,
 *  and renaming the columns on the way in and out would be two mappings to
 *  keep in step with a migration. */
export interface TeDeskPerson {
  id: Uuid; emp_code: string; full_name: string
  grade: string | null; department_id: Uuid | null; location_id: Uuid | null
  company_id?: Uuid
}
export interface TeFinanceDeskRow {
  id: Uuid; company_id: Uuid; location_id: Uuid | null; employee_id: Uuid
  role: string; can_approve: boolean; can_disburse: boolean
  approval_limit: number | null; is_group_scope: boolean; is_active: boolean
}
export interface TeTravelDeskRow {
  id: Uuid; company_id: Uuid; location_id: Uuid | null; employee_id: Uuid
  role: string; can_book: boolean; is_group_scope: boolean; is_active: boolean
}
export interface TeDesksPayload {
  company_id: Uuid
  company: { id: Uuid; company_code: string; company_name: string; group_id: Uuid | null } | null
  group_companies: Uuid[]
  locations: { id: Uuid; location_name: string; location_type: string | null; city: string | null; status: string | null }[]
  departments: { id: Uuid; dept_name: string }[]
  finance: TeFinanceDeskRow[]
  travel: TeTravelDeskRow[]
  /** true until migration 161 is applied; the Travel half is then unavailable. */
  travel_table_missing: boolean
  people: TeDeskPerson[]
  pool: TeDeskPerson[]
}

/** GET /api/te/dashboard — the Reports and Dashboard tab, in one read. */
export interface TeDashboardRow {
  kind: 'trip' | 'claim'
  id: Uuid
  status: string
  role: string
  stage: string
  actedAt: IsoTime | null
  comment: string
  who: string
  whoId: Uuid
  no: string
  what: string
  /** Destination label. '' when the trip never had one. */
  where: string
  amount: number
}
export interface TeDashboardMineTrip {
  id: Uuid; no: string; name: string; scope: TripScope
  status: TripStatus; display: TripDisplayStatus
  start: IsoDate | null; end: IsoDate | null; to: string; estimate: number
  /** Who it is sitting with right now, or null when nobody. */
  withWhom: string | null
}
export interface TeDashboardMineClaim {
  id: Uuid; no: string; status: ClaimStatus; stage: ClaimStage
  claimed: number; approved: number | null; net: number | null
  submitted: IsoTime | null; withWhom: string | null
}
/** A team member's request, as a manager sees it: what was asked and how far
 *  it got, never what they were finally paid. */
export interface TeTeamTrip extends Omit<TeDashboardMineTrip, 'name'> { name: string; who: string; whoId: Uuid }
export interface TeTeamClaim {
  id: Uuid; no: string; who: string; whoId: Uuid
  status: ClaimStatus; stage: ClaimStage
  claimed: number; approved: number | null
  submitted: IsoTime | null; withWhom: string | null
}
export interface TeDashboard {
  from: IsoDate
  to: IsoDate
  me: Uuid
  mine: { trips: TeDashboardMineTrip[]; claims: TeDashboardMineClaim[] }
  score: { cameToMe: number; approved: number; rejected: number; sentBack: number; waiting: number }
  acted: TeDashboardRow[]
  team: { people: number; trips: TeTeamTrip[]; claims: TeTeamClaim[] }
}
export interface TeStayDecision {
  status: 'NONE' | 'CHOSEN' | 'REJECTED'
  /** Index into stayOptions, for CHOSEN. Null otherwise. */
  chosen: number | null
  /** The hotel picked, as text at the time it was picked — the index alone
   *  would go stale if the employee reordered the options afterwards. */
  name: string
  remark: string
  by: Uuid | null
  byName: string | null
  at: IsoTime | null
}
export interface TeEstimate { travel: number; desk: number; hotel: number; meals: number; conv: number }

export interface TeTrip {
  id: Uuid
  no: string
  emp: Uuid
  /** Co-travellers who are employees. None of them may approve this trip. */
  co: Uuid[]
  status: TripStatus
  display: TripDisplayStatus
  origin: TripOrigin
  name: string
  scope: TripScope
  pattern: TripPattern
  purpose: string
  project: string
  points: TeTripPoint[]
  segs: TeTripSegment[]
  pax: number
  people: TeTripPerson[]
  start: IsoDate | null
  end: IsoDate | null
  from: string
  to: string
  fromPlace: Uuid | null
  type: 'domestic' | 'international'
  country: string
  estimate: TeEstimate
  estimateTotal: number
  selfEstimate: number
  plannedKm: number
  stayBy: 'self' | 'desk'
  /** Did the employee ask for a stay when planning, and for food. null on a
   *  trip planned before the planner asked, which is not the same as a no. */
  stayWanted: boolean | null
  foodWanted: boolean | null
  /** The hotels they said they would accept, in the order they named them. */
  stayOptions: TeStayOption[]
  /** The desk's answer to those hotels. */
  stay: TeStayDecision
  advance: number
  pfReason: string
  pfNote: string
  legIds: Uuid[]
  chain: TeStep[]
  why: string[]
  createdAt: IsoTime
  approvedAt: IsoTime | null
}

/** The engine's numbers for a recorded leg (jStats). Kept as the engine wrote them. */
export interface TeLegStats {
  n: number
  gpsKm: number
  jumpKm: number
  gapKm: number
  gaps: number
  jumps: number
  gapMaxMin: number
  maxSp: number
  dur: number
  startOff: number
  endOff: number
  stopMin: number
  stops: number
  moving: number
  payBase: number
  avg: number
  pings: number
}
export interface TeLegStop { id: Uuid; n: number; i: number; t: number; lat: number; lng: number; acc: number; name: string; addr: string; reason: string; biz: boolean; note: string; dwell: number | null; at: IsoTime }
export interface TeFixPoint { at: IsoTime; lat: number; lng: number; acc: number | null; addr: string; off: number | null }
export interface TeTrackPoint { lat: number; lng: number; t: number; sp: number; acc: number; fake?: boolean }

/** A leg of a trip. The engine calls it a journey. */
export interface TeLeg {
  id: Uuid
  emp: Uuid
  tripId: Uuid
  n: number
  seg: number | null
  kind: LegKind
  from: Uuid
  to: Uuid
  date: IsoDate
  purpose: string
  /** The trip's name. */
  why: string
  mode: string
  vehicleId: Uuid | null
  bookedBy: string
  gps: GpsMode
  plannedKm: number
  status: LegStatus
  startedAt: IsoTime | null
  endedAt: IsoTime | null
  filedAt: IsoTime | null
  manual: boolean
  noGps: string
  skipReason: string
  addedWhy: string
  expenseId: Uuid | null
  stats: TeLegStats | null
  gpsKm: number | null
  routeKm: number | null
  payKm: number | null
  /** Filled only while the leg is running, or when asked for (opts.leg_id). */
  track: TeTrackPoint[]
  shown: number
  stops: TeLegStop[]
  checkin: { start?: TeFixPoint; end?: TeFixPoint }
  history: TeTimelineEntry[]
}

// ── expenses, flags, claims ─────────────────────────────────────────────────
/** The first file of a line as the engine reads it. */
export interface TeLineFile { id?: Uuid; name: string; path: string; kind?: string; sha?: string; phash?: string; ocrAmount?: number; text?: string; editedWith?: string; producer?: string; booking?: true }

export interface TeExpense {
  id: Uuid
  no: string
  emp: Uuid
  tripId: Uuid | null
  legId: Uuid | null
  journeyId: Uuid | null
  /** te_categories.code */
  cat: string
  date: IsoDate
  checkIn: IsoDate | null
  checkOut: IsoDate | null
  merchant: string
  gstin: string
  billNo: string
  pnr: string
  ref: string
  cls: string
  bill: number
  claimed: number
  eligible: number | null
  approved: number | null
  /** 'self' = the employee paid; 'company' = booked and paid by the Travel Desk. */
  pay: 'self' | 'company'
  payMode: string
  desc: string
  reason: string
  wantException: boolean
  /** The approver's reason for a reduction or rejection. */
  dreason: string
  vehicleId: Uuid | null
  from: Uuid | null
  to: Uuid | null
  payKm: number | null
  rate: number | null
  km: number | null
  client: string
  attendees: number | null
  shared: boolean
  curr: string
  fxAmt: number
  fxRate: number
  file: TeLineFile | null
  files: number
  status: ExpenseStatus
  claimId: Uuid | null
  claimNo: string | null
  /** The approver asked for this line to be corrected. */
  fix: boolean
  lstatus: string | null
  details: Record<string, unknown>
  /** true on a colleague's line that is in the snapshot only for the duplicate checks. */
  other?: true
}

/** A flag as the engine raises it (previews, refusals). */
export interface TeFlag {
  lineId: Uuid | '__draft__' | null
  code: string
  title: string
  evidence: string
  evEmp?: string
  action: FlagAction | string
  sev: Severity | null
  block: boolean
  needsReason: boolean
  limitTxt?: string
  over?: number
  match?: unknown
}
/** A flag stored on a claim (te_flags). */
export interface TeClaimFlag {
  id: Uuid
  status: 'open' | 'dismissed' | 'confirmed' | string
  lineId: Uuid | null
  code: string
  title: string
  evidence: string
  action: string
  sev: Severity | null
  block: boolean
  needsReason: boolean
  claimLevel: boolean
  note: string
}

export interface TeClaim {
  id: Uuid
  no: string
  emp: Uuid
  tripId: Uuid | null
  type: 'TRIP' | 'GENERAL' | string
  seq: number
  /** 'YYYY-MM' */
  period: string | null
  late: boolean
  note: string
  lines: Uuid[]
  claimed: number
  eligible: number
  approved: number
  advanceAdjusted: number
  net: number | null
  flags: TeClaimFlag[]
  score: number
  band: RiskBand
  exception: boolean
  postFacto: boolean
  stage: ClaimStage
  status: ClaimStatus
  fixAll: boolean
  sentFrom: string | null
  rejectedFrom: string | null
  rejectReason: string
  autoVerified: boolean
  sampled: boolean
  chain: TeStep[]
  fin: TeStep[]
  why: string[]
  submittedAt: IsoTime | null
  verifiedAt: IsoTime | null
  settledAt: IsoTime | null
  paidRef: string
}

export interface TeAdvance { id: Uuid; no: string; tripId: Uuid; emp: Uuid; requested: number; approved: number | null; outstanding: number; status: string; display: string; due: IsoDate | null; paidOn: IsoDate | null; ref: string }
/** A ticket or a stay on a trip.
 *
 *  `status` is 'REQUESTED' | 'BOOKED' | 'CANCELLED'. REQUESTED is the employee
 *  asking the Travel Desk to book something they found; nothing has been
 *  bought, so it has no `pnr` and carries no expense on the trip.
 *
 *  `ticket` is the booking page either way — an e-ticket once the desk books,
 *  the platform link (MakeMyTrip or another) on a request. It is an EXTERNAL
 *  URL on a request, not a path in the private bucket: open it, do not sign it.
 *
 *  `tripId`/`tripNo` come from the snapshot's copy and are absent on the one
 *  the trip detail returns, which already knows its own trip. */
export interface TeBooking {
  id: Uuid; no: string; tripId?: Uuid; tripNo?: string
  legId: Uuid | null; pointIdx: number | null; kind: string
  vendor: string; pnr: string | null; amount: number
  paidBy?: string; status: string; at: IsoTime; ticket?: string | null
  requestedAt?: IsoTime | null
  /** What the employee typed about a stay they want booked. */
  details?: { address?: string; room?: string; platform?: string; check_in?: string; check_out?: string; note?: string }
}
export interface TePeriod { m: string; status: 'OPEN' | 'CLOSED' | 'LOCKED' | string; label: string }
export interface TeTimelineEntry { at: IsoTime; who: Uuid | null; name: string | null; role: string | null; action: string; text: string; internal: boolean }
export interface TeMessage { who: Uuid | null; name: string | null; text: string; at: IsoTime }

// ── configuration ───────────────────────────────────────────────────────────
export interface TeWorkflowCondition { t: 'amount' | 'scope' | 'postFacto' | 'exception' | 'risk'; v?: number | string }
/** One level as the workflow builder reads and saves it. */
export interface TeWorkflowLevel {
  id?: Uuid
  kind: 'approve' | 'finance'
  label: string
  /** rm = reporting manager, rm2 = their manager, hod = head of department, person = `person`, finance = the Finance team. */
  who: 'rm' | 'rm2' | 'hod' | 'person' | 'finance'
  person: Uuid | ''
  when: TeWorkflowCondition[]
}
export interface TeCategory { id: string; name: string; icon: string | null; needsTrip: boolean; proof: 'always' | 'above' | 'none'; group: string | null; on: boolean }
export interface TeMode { id: string; name: string; icon?: string; basis: 'km' | 'bill' | 'nobill' | 'ticket' | 'none'; scopes: TripScope[]; gps: GpsMode; stops: boolean; ceil: number; minFare?: number; estKm?: number; estMin?: number; cat?: string; on: boolean }
export interface TeVehicleType { id: string; name: string; eg: string | null; method: 'fixed' | 'fuel'; rate: number; fuel: string | null; kmpl: number | null; wear: number; on: boolean }
export interface TeCheck { c: string; layer: string; t: string; a: FlagAction; s: Severity; on: boolean; live: boolean }
export interface TeTierLimits { hotel: number; meals: number; conv: number }

/** te_config(company): everything the rules engine reads as S.cfg. Settings an admin adds
 *  later land in te_settings.extra and appear here as extra keys, hence the index signature. */
export interface TeConfig {
  billAgeDays: number
  claimDeadlineDays: number
  noticeDays: number
  receiptAbove: number
  noBillPerDay: number
  advanceMaxPct: number
  graceDays: number
  mileageTol: number
  estimateTol: number
  postFacto: 'allowed' | 'limited' | 'blocked'
  postFactoPerQuarter: number
  autoApprove: boolean
  fastTrack: number
  samplePct: number
  reminderDays: number
  escalateDays: number
  fallback: Uuid | null
  intlAir: number
  domAir: number
  clientPerHead: number
  miscPerClaim: number
  commPerClaim: number
  defaultGrade: string
  version: number
  /** Trip and GPS rules (te_settings.gps_rules). */
  track: Record<string, number | boolean | string>
  /** Vehicle rules: rcCheck, ownership, insurance (te_settings.vehicle_rules). */
  vehx: Record<string, number | boolean | string>
  fuelPrice: Record<string, number>
  basis: Record<string, string>
  breach: Record<string, string>
  weights: Record<string, number>
  bands: Record<string, number>
  zoneA: string[]
  flows: { claim: { levels: TeWorkflowLevel[] }; trip: { levels: TeWorkflowLevel[] } }
  teams: { finance: Uuid[] }
  grades: string[]
  airClass: Record<string, string>
  trainClass: Record<string, string>
  /** grade → tier (metro | tier1 | rest | intlA | intlB) → limits */
  limits: Record<string, Record<string, TeTierLimits>>
  vehicles: TeVehicleType[]
  modes: TeMode[]
  ptypes: { id: string; name: string; on: boolean }[]
  stopReasons: { id: string; name: string; biz: boolean; dwell: number | null; on: boolean }[]
  checks: TeCheck[]
  cats: TeCategory[]
  [extra: string]: unknown
}

/** te_masters(company, employee) */
export interface TeMasters {
  /** city → [tier, 2-digit state code] */
  cities: Record<string, [string, string]>
  regions: Record<string, string[]>
  /** area → { air?: place id, rail?: place id } */
  hubs: Record<string, { air?: Uuid; rail?: Uuid }>
  places: TePlace[]
}

// ── the snapshot ────────────────────────────────────────────────────────────
/** te_snapshot(employee): everything the employee's own screens show, and everything the
 *  rules engine needs for that employee. GET /api/te/me returns this. */
export interface Snapshot {
  today: IsoDate
  me: Uuid
  company: Uuid
  cfg: TeConfig
  masters: TeMasters
  /** The people the engine may name: me, my managers, the Finance team, co-travellers. */
  emp: Record<Uuid, TeEmployee>
  /** EMP CODE → employee id, for co-travellers typed by code. */
  codes: Record<string, Uuid>
  leave: Record<Uuid, unknown>
  punch: Record<Uuid, unknown>
  holidays: unknown
  /** '<from place id>|<to place id>' → road km */
  routes: Record<string, number>
  vehicles: TeVehicle[]
  trips: TeTrip[]
  journeys: TeLeg[]
  /** My lines, plus colleagues' lines that could be duplicates (those carry other: true). */
  expenses: TeExpense[]
  claims: TeClaim[]
  advances: TeAdvance[]
  bookings: TeBooking[]
  periods: TePeriod[]
  batches: unknown[]
  settlements: unknown[]
  audit: unknown[]
}

// ── one-screen reads ────────────────────────────────────────────────────────
export interface TeTripDetail {
  trip: TeTrip
  employee: TeEmployee
  places: Record<Uuid, TePlaceBrief>
  legs: TeLeg[]
  expenses: TeExpense[]
  claims: TeClaim[]
  advance: { id: Uuid; no: string; requested: number; approved: number | null; outstanding: number; status: string; display: string; due: IsoDate | null; ref: string } | null
  bookings: TeBooking[]
  messages: TeMessage[]
  timeline: TeTimelineEntry[]
  /** The settings as they were when the trip was approved. */
  policy: Record<string, unknown> | null
  can: { act: boolean; why: string; own: boolean }
}
export interface TeLineDecision { line: Uuid; by: Uuid | null; name: string | null; decision: string; before: number | null; after: number | null; reason: string | null; at: IsoTime }
export interface TeClaimDetail {
  claim: TeClaim
  employee: TeEmployee
  trip: TeTrip | null
  lines: TeExpense[]
  /** The stays and tickets of the claim's trip. Added by migration 153:
   *  te_claim_detail carried the trip, the lines and the legs but never the
   *  bookings, so a requested stay and its link were invisible to the person
   *  approving the money. Empty on a claim with no trip. */
  bookings: TeBooking[]
  legs: TeLeg[]
  decisions: TeLineDecision[]
  advance: { id: Uuid; no: string; approved: number | null; outstanding: number; status: string; due: IsoDate | null } | null
  messages: TeMessage[]
  timeline: TeTimelineEntry[]
  can: { act: boolean; why: string; stage: ClaimStage | null; role: string | null; own: boolean; staff: boolean }
}
/** One row of te_queue / v_te_pending_approvals. */
export interface TeQueueRow {
  step_id: Uuid
  company_id: Uuid
  entity_type: 'claim' | 'trip'
  entity_id: Uuid
  step_no: number
  stage: ClaimStage
  role_label: string
  approver_id: Uuid | null
  effective_approver_id: Uuid | null
  team_code: string | null
  due_at: IsoTime | null
  waiting_since: IsoTime
  ref_no: string
  employee_id: Uuid
  emp_code: string
  employee_name: string
  amount: number
  entity_status: string
  risk_band: RiskBand | null
  flag_count: number
  trip_name: string | null
  scope: TripScope | null
}
/** One row of te_health. */
export interface TeHealthRow { company: string; area: string; item: string; status: 'ok' | 'warn' | 'fail'; detail: string }

// ── what the browser sends ──────────────────────────────────────────────────
/** A bill or RC photo after POST /api/te/upload. Pass it back unchanged in `files: [...]`
 *  of an expense or a leg report. This is the shape te-adapter's filesToDb() takes. */
export interface TeUploadedFile {
  /** te_expense_files.kind. An RC photo is stored as OTHER; its storage_path goes into VehicleInput.rc_file_url. */
  kind: 'BILL' | 'TICKET' | 'TOLL_SLIP' | 'FASTAG_STATEMENT' | 'OTHER'
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size: number
  sha256: string
  /** Perceptual hash, when an OCR provider supplies one. */
  phash: string | null
  ocr: { amount?: number | null; date?: string | null; gstin?: string | null; bill_no?: string | null; text?: string | null } | null
  metadata: { software?: string | null; producer?: string | null } | null
}

/** POST /api/te/places */
export interface PlaceInput {
  src: 'gps' | 'address' | 'search'
  pt?: string
  label?: string
  line?: string
  area?: string
  city?: string
  /** 2-digit GST state code, '06' = Haryana. */
  state?: string
  pin?: string
  country?: string
  lat?: number
  lng?: number
  acc?: number
}
/** POST /api/te/vehicles */
export interface VehicleInput { reg: string; type?: string; whose?: 'self' | 'family' | 'other'; rc_file_url?: string }

/** POST /api/te/trips and /api/te/trips/preview: the planner's draft, in the engine's names. */
export interface TripDraft {
  /** Set to edit an existing trip. */
  id?: Uuid
  name?: string
  scope: TripScope
  pattern?: TripPattern
  origin?: TripOrigin
  purpose?: string
  project?: string
  points: { place: Uuid; pt?: string; what?: string; leave?: IsoDate | ''; arrive?: IsoDate | ''; leaveAt?: string; arriveAt?: string; ret?: boolean; stop?: boolean }[]
  segs: { mode: string; bookedBy?: string; vehicleId?: Uuid | null; xfer?: { first?: string; last?: string; hubA?: Uuid; hubB?: Uuid }; prefTime?: string; prefUrl?: string; prefNote?: string }[]
  pax?: number
  /** Co-travellers by employee code. */
  people?: { id: string; name?: string }[]
  stayBy?: 'self' | 'desk'
  stayWanted?: boolean | null
  foodWanted?: boolean | null
  stayOptions?: TeStayOption[]
  advance?: number
  pfReason?: string
  pfNote?: string
  /** "What I changed", needed when the plan was sent back. */
  answer?: string
}
export interface TripIssue { block: boolean; t: string; k?: string }
export interface PlannedLeg { seg: number; from: Uuid; to: Uuid; date: IsoDate; mode: string; kind: LegKind; bookedBy: string; vehicleId: Uuid | null; km: number; gps: GpsMode; n: number }
export interface TripPreview {
  issues: TripIssue[]
  blocked: boolean
  warnings: string[]
  start: IsoDate | null
  end: IsoDate | null
  from: string
  to: string
  legs: (PlannedLeg & { fromPlace: { id: Uuid; s: string; city: string | null } | null; toPlace: { id: Uuid; s: string; city: string | null } | null; estimate: number })[]
  estimate: TeEstimate
  estimateTotal: number
  selfEstimate: number
  advanceCap: number
  plannedKm: number
  needsApproval: boolean
  chain: TeChainPreview[]
  entitlements: { tier: string; grade: string; hotel: number; meals: number; conv: number; air: string; train: string } | null
}

/** A GPS fix from the phone. */
export interface GpsFix { lat: number; lng: number; accuracy_m?: number; address?: string; recorded_at?: IsoTime; is_mock?: boolean; device?: Record<string, unknown> }
export interface GpsPing { lat: number; lng: number; accuracy_m?: number; speed_kmh?: number; recorded_at: IsoTime; is_mock?: boolean }
export interface StopInput { reason_code: string; note?: string; lat: number; lng: number; accuracy_m?: number; address?: string; place_name?: string; recorded_at?: IsoTime }
/** The leg report: what the employee paid for the leg. */
export interface LegReportInput { fare?: number; merchant?: string; ref?: string; cls?: string; payMode?: string; reason?: string; curr?: string; fxAmt?: number; fxRate?: number; gstin?: string; billNo?: string; files?: TeUploadedFile[] }
export interface ExtraLegInput { from: Uuid; to: Uuid; mode: string; vehicleId?: Uuid | null; why?: string }

/** POST /api/te/expenses and /api/te/expenses/preview */
export interface ExpenseInput {
  /** Set to edit a saved line. */
  id?: Uuid
  tripId?: Uuid | null
  cat: string
  date: IsoDate
  checkIn?: IsoDate
  checkOut?: IsoDate
  merchant?: string
  gstin?: string
  billNo?: string
  pnr?: string
  ref?: string
  cls?: string
  bill?: number | string
  /** Left out or '' = the bill amount. */
  claimed?: number | string
  payMode?: string
  desc?: string
  reason?: string
  wantException?: boolean
  /** Own vehicle without a recorded leg. */
  vehicleId?: Uuid | null
  from?: Uuid | null
  to?: Uuid | null
  km?: number | string
  client?: string
  attendees?: number | string
  shared?: boolean
  /** A bill abroad. */
  curr?: string
  fxAmt?: number
  fxRate?: number
  files?: TeUploadedFile[]
}
export interface MileageView { rate: number; km: number; payKm: number; full: number; amount: number; mapKm: number; viaKm: number; allowed: number; manual: boolean; vehicle: { id: Uuid; reg: string; type: string } | null }
/** What a line would be worth and what is wrong with it. Nothing is saved. */
export interface ExpensePreview { flags: TeFlag[]; eligible: number; claimed: number; mileage: MileageView | null; blocked: boolean; needsReason: boolean }
export type LegPreview = (ExpensePreview & { stats: TeLegStats | null }) | { none: true; stats: TeLegStats | null }

export interface ClaimInput { tripId?: Uuid | null; lineIds?: Uuid[]; note?: string; declared?: boolean }
export interface ClaimPreview {
  claimed: number
  eligible: number
  companyPaid: number
  /** Advance still with the employee. */
  outstanding: number
  net: number
  score: number
  band: RiskBand
  exception: boolean
  lines: { id: Uuid; claimed: number; eligible: number; flags: TeFlag[] }[]
  flags: TeFlag[]
  blockers: TeFlag[]
  needs: TeFlag[]
  /** Sentences that stop the claim outright (a trip recorded after travel that no longer passes). */
  stop: string[]
  chain: TeChainPreview[]
}
/** An approver's decision on single lines. */
export interface DecideInput {
  comment?: string
  /** line id → what to do with it */
  decisions?: Record<Uuid, { amount?: number; reject?: 'final' | 'refile'; reason?: string }>
  /** Lines the employee must correct (send-back). */
  fix?: Uuid[]
}
