// ============================================================================
// EZER HRMS — Travel Claim Module · Shared Types
// lib/travel/types.ts
// ============================================================================

export type CityClass = 'METRO' | 'TIER2' | 'OTHER';
export type CalcMethod = 'PER_KM' | 'ACTUAL' | 'ZERO';
// How a distance was arrived at. GPS_SNAPPED is a recorded trail put through
// Google's roads API; GPS_TRACKED is the same trail measured as-is.
export type DistanceSource = 'GPS_TRACKED' | 'GPS_SNAPPED' | 'MAPS_POINT' | 'MANUAL';

// What the policy asks for, which is narrower — you cannot configure a company
// to prefer "snapped", that is decided per journey by whether Google answered.
export type DistanceMode = 'GPS_TRACKED' | 'MAPS_POINT' | 'MANUAL';
export type Enforcement = 'BLOCK' | 'WARN' | 'AUTO_TRIM';
export type LimitBasis =
  | 'PER_DAY' | 'PER_TRIP' | 'PER_CLAIM' | 'PER_MONTH' | 'PER_NIGHT' | 'NONE';

export type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED';

export type TripStatus =
  | 'DRAFT' | 'PENDING_RM' | 'APPROVED' | 'ACTIVE'
  | 'CLOSED' | 'SETTLED' | 'REJECTED' | 'CANCELLED';

// PENDING_HR is this repo's addition — the chain is RM -> HR Head -> Finance,
// with the RM leg switchable via travel_policies.rm_stage_enabled.
export type ClaimStatus =
  | 'DRAFT' | 'SUBMITTED' | 'PENDING_RM' | 'PENDING_HR' | 'PENDING_FINANCE'
  | 'APPROVED' | 'SENT_BACK' | 'REJECTED' | 'PAID';

export type ApprovalStage =
  | 'TRIP_RM' | 'CLAIM_RM' | 'CLAIM_HR' | 'CLAIM_FINANCE' | 'COTRAVELLER_RM';

export type TravellerType = 'LEADER' | 'INTERNAL' | 'GUEST';

export type GroupLimitMethod = 'SUM_OF_INDIVIDUAL' | 'HIGHEST_GRADE_X_HEADCOUNT';

// ---------------------------------------------------------------------------
// Access guard result — returned by every write endpoint before it does anything
// ---------------------------------------------------------------------------
export type GuardCode =
  | 'OK'
  | 'EMPLOYEE_EXITED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'PERIOD_NOT_OPENED'
  | 'PERIOD_CLOSED'
  | 'PERIOD_LOCKED'
  | 'BILL_TOO_OLD'
  | 'FUTURE_DATED'
  | 'BEFORE_JOINING';

export interface GuardResult {
  allowed: boolean;
  code: GuardCode;
  message: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface TravelPolicy {
  id: string;
  company_id: string;
  policy_name: string;
  effective_from: string;
  effective_to: string | null;

  bill_max_age_days: number;
  bill_warn_age_days: number;
  draft_reminder_days: number;

  distance_mode: DistanceMode;
  distance_variance_tolerance: number;

  toll_daily_cap: number;
  local_food_enabled: boolean;
  trip_advance_enabled: boolean;

  group_limit_method: GroupLimitMethod;
  group_max_multiplier: number;
  max_travellers_per_trip: number;
  max_guests_per_trip: number;
  guest_travel_enabled: boolean;
  guest_per_head_limit: number;
  guest_requires_hod_approval: boolean;
  cotraveller_approval_mode: 'LEADER_RM' | 'ALL_RM' | 'LEADER_RM_WITH_NOTIFY';
  cost_allocation_mode: 'PAYER_DEPARTMENT' | 'SPLIT_BY_TRAVELLER';

  post_exit_grace_days: number;

  /** Reporting Manager reviews first. Needs employees.l1_manager_id populated. */
  rm_stage_enabled: boolean;
  /** HR Head reviews before Finance, for every employee. */
  hr_stage_enabled: boolean;
  /**
   * HR Head reviews only employees who have no l1_manager_id — a safety net
   * rather than a stage. Ignored unless rm_stage_enabled. Added by 054, so it
   * is optional: a policy row read before that migration will not carry it.
   */
  hr_fallback_only?: boolean;
  rm_sla_days: number;
  hr_sla_days: number;
  finance_sla_days: number;
  attendance_crosscheck: boolean;
  commute_check_enabled: boolean;
}

export interface ExpenseType {
  id: string;
  company_id: string;
  type_code: string;
  type_name: string;
  calc_method: CalcMethod;
  bill_threshold: number;
  allowed_local: boolean;
  allowed_outstation: boolean;
  pools_by_headcount: boolean;
  capture_gst: boolean;
  requires_vehicle: boolean;
  /** Bill-less mode — the amount comes from the recorded trail, not a typed figure. */
  requires_gps: boolean;
  /** False where no receipt exists to attach: own vehicle, cash auto, tips. */
  bill_required: boolean;
  category: ExpenseCategory | null;
  gl_code: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export type ExpenseCategory =
  | 'CONVEYANCE' | 'OUTSTATION' | 'STAY' | 'ALLOWANCE'
  | 'COMMUNICATION' | 'DOCUMENTATION' | 'CLIENT' | 'OTHER';

export interface Entitlement {
  id: string;
  policy_id: string;
  grade: string;
  city_class: CityClass | null;
  type_code: string;
  limit_basis: LimitBasis;
  limit_value: number | null;
  enforcement: Enforcement;
}

/**
 * A rate row is one of two shapes, enforced by a check constraint:
 *   type_code set, vehicle_type null  -> mode rate    (AUTO_CASH = ₹12/km)
 *   type_code null, vehicle_type set  -> vehicle rate (CAR/PETROL = ₹10/km)
 * Rates are versioned by effective_from and never edited in place, so a claim
 * already paid keeps the rate it was paid at.
 */
export interface MileageRate {
  id: string;
  policy_id: string;
  type_code: string | null;
  vehicle_type: 'CAR' | 'TWO_WHEELER' | null;
  fuel_type: 'PETROL' | 'DIESEL' | 'CNG' | 'ELECTRIC' | null;
  cc_band: 'LTE_1600' | 'GT_1600' | 'NA' | null;
  rate_per_km: number;
  effective_from: string;
  rate_label: string | null;
  notes: string | null;
  /** The HR Head who set it. */
  set_by: string | null;
  set_at: string | null;
}

export interface EmployeeVehicle {
  id: string;
  employee_id: string;
  vehicle_type: 'CAR' | 'TWO_WHEELER';
  fuel_type: 'PETROL' | 'DIESEL' | 'CNG' | 'ELECTRIC';
  cubic_capacity: number | null;
  registration_no: string | null;
  is_verified: boolean;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
export interface TravelPeriod {
  id: string;
  company_id: string;
  period_month: string;        // YYYY-MM-01
  period_label: string;        // 'Aug 2026'
  status: PeriodStatus;
  submit_open_from: string | null;
  submit_open_till: string | null;
  auto_close_on: string | null;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  locked_at: string | null;
  payroll_run_id: string | null;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// Trips & travellers
// ---------------------------------------------------------------------------
export interface TripTraveller {
  id: string;
  trip_id: string;
  traveller_type: TravellerType;
  employee_id: string | null;
  guest_name: string | null;
  guest_company: string | null;
  guest_designation: string | null;
  grade_snapshot: string | null;
  entitlement_snapshot: Record<string, number> | null;
  status: 'CONFIRMED' | 'DROPPED' | 'ADDED_LATE';
  joined_date: string | null;
  left_date: string | null;
}

export interface Trip {
  id: string;
  company_id: string;
  trip_no: string;
  employee_id: string;
  trip_type: 'LOCAL' | 'OUTSTATION';
  purpose: string;
  client_name: string | null;
  from_city: string | null;
  to_city: string | null;
  to_city_class: CityClass | null;
  from_date: string;
  to_date: string;
  travel_mode: string | null;
  hotel_required: boolean;
  estimated_cost: number | null;
  is_group_trip: boolean;
  traveller_count: number;
  guest_count: number;
  advance_requested: number;
  advance_approved: number;
  status: TripStatus;
  travellers?: TripTraveller[];
}

// ---------------------------------------------------------------------------
// Travel logs
// ---------------------------------------------------------------------------
export interface TravelLog {
  id: string;
  company_id: string;
  employee_id: string;
  trip_id: string | null;
  claim_id: string | null;
  log_date: string;
  purpose: string;
  client_name: string | null;
  type_code: string;
  vehicle_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  from_address: string | null;
  to_address: string | null;
  city: string | null;
  city_class: CityClass | null;
  is_round_trip: boolean;
  distance_gps: number | null;
  distance_maps: number | null;
  distance_claimed: number | null;
  distance_source: DistanceSource | null;
  variance_pct: number | null;
  variance_reason: string | null;
  rate_applied: number | null;
  computed_fare: number;
  amount_entered: number;
  toll_amount: number;
  parking_amount: number;
  total_amount: number;
  is_shared: boolean;
  passenger_count: number;
  status: 'LOGGED' | 'CLAIMED' | 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------
export type FlagType =
  | 'LATE_BILL'
  | 'BILL_AGE_WARNING'
  | 'DISTANCE_VARIANCE'
  | 'MANUAL_DISTANCE'
  | 'DUPLICATE'
  | 'DUPLICATE_LEG'
  | 'SHARED_DUPLICATE'
  | 'OVER_LIMIT'
  | 'GROUP_LIMIT_EXCEEDED'
  | 'ABSENT_DAY'
  | 'COMMUTE'
  | 'NO_VEHICLE_ON_FILE'
  | 'TRAVELLER_NOT_ON_TRIP'
  | 'TRAVELLER_ABSENT'
  | 'GUEST_NO_DETAILS'
  | 'SOLE_PAYER_CONCENTRATION'
  | 'MISSING_BILL'
  // GPS-priced travel — see lib/travel/gps.ts
  | 'GPS_REQUIRED'
  | 'GPS_NO_TRAIL'
  | 'GPS_ZERO_DISTANCE'
  | 'GPS_SPARSE_TRAIL'
  | 'GPS_LOW_ACCURACY'
  | 'GPS_JUMPS'
  | 'GPS_WALKING_PACE'
  | 'GPS_MOSTLY_DISCARDED'
  | 'SNAP_UNAVAILABLE'
  | 'NO_RATE_CONFIGURED';

export interface Flag {
  flag_type: FlagType;
  severity: 'WARN' | 'BLOCK';
  policy_value?: number | null;
  actual_value?: number | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Calculation results
// ---------------------------------------------------------------------------
export interface FareResult {
  computed_fare: number;
  rate_applied: number | null;
  distance_used: number | null;
  distance_source: DistanceSource | null;
  variance_pct: number | null;
  toll_amount: number;
  parking_amount: number;
  total_amount: number;
  flags: Flag[];
}

export interface Consumer {
  employee_id: string | null;
  guest_name?: string | null;
  grade: string;                 // 'GUEST' for external
  entitlement: number;           // this person's own limit for the category
}

export interface PoolResult {
  pooled_limit: number;
  pooling_method: GroupLimitMethod | 'NO_POOLING';
  consumer_count: number;
  per_consumer: Array<{ employee_id: string | null; guest_name?: string | null; contributed: number }>;
  breakdown_label: string;       // 'M1 ₹1,000 + E2 ₹600 + Guest ₹1,000'
}

export interface LimitCheckResult {
  limit: number | null;
  claimed: number;
  payable: number;
  unclaimable: number;
  enforcement: Enforcement;
  flags: Flag[];
}
