// ============================================================================
// EZER HRMS — Travel Claim Module · Calculation Engine
// lib/travel/calc.ts
//
// Pure functions. No database calls, no side effects — so this file is unit
// testable and can run on both server and client (the ESS page uses it to
// show the fare live before it ever hits the API).
//
// Three responsibilities:
//   1. computeFare()      — distance x rate, or actual amount
//   2. poolLimit()        — group travel entitlement pooling
//   3. checkLimit()       — enforcement (BLOCK / WARN / AUTO_TRIM) + flags
// ============================================================================

import type {
  CityClass,
  Consumer,
  Entitlement,
  ExpenseType,
  FareResult,
  Flag,
  GroupLimitMethod,
  LimitCheckResult,
  MileageRate,
  PoolResult,
  TravelPolicy,
  DistanceSource,
} from './types';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ============================================================================
// 1. FARE
// ============================================================================

export interface FareInput {
  type: ExpenseType;
  policy: TravelPolicy;

  // distance based
  distance_gps?: number | null;
  /** road distance after snapping the trail to roads via Google */
  distance_snapped?: number | null;
  distance_maps?: number | null;
  distance_claimed?: number | null;
  rate_per_km?: number | null;
  is_round_trip?: boolean;

  // actual based
  amount_entered?: number | null;

  // add-ons (own vehicle only)
  toll_amount?: number | null;
  parking_amount?: number | null;

  // context
  has_verified_vehicle?: boolean;
  variance_reason?: string | null;
}

export function resolveDistance(input: FareInput): {
  distance: number | null;
  source: DistanceSource | null;
  variance_pct: number | null;
} {
  const { distance_gps, distance_snapped, distance_maps, distance_claimed, policy } = input;

  // ---- GPS-priced modes ---------------------------------------------------
  // Own car, cash auto and the rest leave no bill behind, so there is nothing
  // to check a typed figure against. For these the recording IS the amount:
  // snapped-to-road when Google gave us one, otherwise the measured trail.
  // What the employee typed is ignored rather than merely flagged — accepting
  // it would make the GPS requirement decorative.
  if (input.type.requires_gps) {
    const measured = distance_snapped ?? distance_gps ?? null;
    if (measured == null) {
      return { distance: null, source: null, variance_pct: null };
    }
    // The gap between the employee's own estimate and the recording is still
    // reported, so an approver can see it — it just does not change the pay.
    const variance =
      distance_claimed != null && measured > 0
        ? round2(((distance_claimed - measured) / measured) * 100)
        : null;
    return {
      distance: round2(measured * (input.is_round_trip ? 2 : 1)),
      source: distance_snapped != null ? 'GPS_SNAPPED' : 'GPS_TRACKED',
      variance_pct: variance,
    };
  }

  // preferred source per policy, with a fallback chain
  let source: DistanceSource | null = null;
  let base: number | null = null;

  if (policy.distance_mode === 'GPS_TRACKED' && distance_gps != null) {
    source = 'GPS_TRACKED';
    base = distance_gps;
  } else if (distance_maps != null) {
    source = 'MAPS_POINT';
    base = distance_maps;
  } else if (distance_claimed != null) {
    source = 'MANUAL';
    base = distance_claimed;
  }

  // the employee's claimed figure wins for payment, but variance is measured
  // against the system figure
  const claimed = distance_claimed ?? base;
  if (claimed == null) return { distance: null, source: null, variance_pct: null };

  const reference = distance_gps ?? distance_maps ?? null;
  let variance_pct: number | null = null;
  if (reference != null && reference > 0) {
    variance_pct = round2(((claimed - reference) / reference) * 100);
  }

  const multiplier = input.is_round_trip ? 2 : 1;
  return {
    distance: round2(claimed * multiplier),
    source: distance_claimed != null && reference == null ? 'MANUAL' : source,
    variance_pct,
  };
}

export function computeFare(input: FareInput): FareResult {
  const flags: Flag[] = [];
  const toll = Number(input.toll_amount ?? 0);
  const parking = Number(input.parking_amount ?? 0);

  // ---- ZERO (company cab) -------------------------------------------------
  if (input.type.calc_method === 'ZERO') {
    return {
      computed_fare: 0,
      rate_applied: null,
      distance_used: null,
      distance_source: null,
      variance_pct: null,
      toll_amount: 0,
      parking_amount: 0,
      total_amount: 0,
      flags,
    };
  }

  // ---- ACTUAL (cab, auto, food, hotel, misc) ------------------------------
  if (input.type.calc_method === 'ACTUAL') {
    const amt = Number(input.amount_entered ?? 0);
    return {
      computed_fare: round2(amt),
      rate_applied: null,
      distance_used: null,
      distance_source: null,
      variance_pct: null,
      toll_amount: round2(toll),
      parking_amount: round2(parking),
      total_amount: round2(amt + toll + parking),
      flags,
    };
  }

  // ---- PER_KM (own car / own bike) ---------------------------------------
  if (input.type.requires_vehicle && !input.has_verified_vehicle) {
    flags.push({
      flag_type: 'NO_VEHICLE_ON_FILE',
      severity: 'BLOCK',
      message:
        'No verified vehicle on your profile for this type. Add your vehicle and get it verified by HR before claiming per-kilometre.',
    });
  }

  const { distance, source, variance_pct } = resolveDistance(input);
  const rate = Number(input.rate_per_km ?? 0);

  // A GPS-priced mode with no rate configured would silently pay zero. Say so
  // instead — this is the HR Head's rate card being incomplete, not the
  // employee's mistake.
  if (input.type.requires_gps && !rate) {
    flags.push({
      flag_type: 'NO_RATE_CONFIGURED',
      severity: 'BLOCK',
      message: `No rate per kilometre has been set for ${input.type.type_name}. Ask HR to set it on the travel rate card.`,
    });
  }

  if (distance == null) {
    flags.push({
      flag_type: input.type.requires_gps ? 'GPS_REQUIRED' : 'MANUAL_DISTANCE',
      severity: 'BLOCK',
      message: input.type.requires_gps
        ? `${input.type.type_name} has no bill to verify, so the journey must be recorded. Use Start travel and End travel — a typed distance is not accepted for this mode.`
        : 'Distance could not be determined. Enter the from and to locations.',
    });
    return {
      computed_fare: 0,
      rate_applied: rate || null,
      distance_used: null,
      distance_source: null,
      variance_pct: null,
      toll_amount: round2(toll),
      parking_amount: round2(parking),
      total_amount: round2(toll + parking),
      flags,
    };
  }

  if (source === 'MANUAL') {
    flags.push({
      flag_type: 'MANUAL_DISTANCE',
      severity: 'WARN',
      message: 'Distance was entered manually. Your manager will see this.',
    });
  }

  if (
    variance_pct != null &&
    variance_pct > Number(input.policy.distance_variance_tolerance)
  ) {
    flags.push({
      flag_type: 'DISTANCE_VARIANCE',
      severity: 'WARN',
      policy_value: Number(input.policy.distance_variance_tolerance),
      actual_value: variance_pct,
      message: `You have claimed ${variance_pct}% more than the mapped route. Add a reason (traffic diversion, one-way, road closure).`,
    });
  }

  if (toll > Number(input.policy.toll_daily_cap)) {
    flags.push({
      flag_type: 'OVER_LIMIT',
      severity: 'WARN',
      policy_value: Number(input.policy.toll_daily_cap),
      actual_value: toll,
      message: `Toll exceeds the daily cap of ₹${input.policy.toll_daily_cap}.`,
    });
  }

  const fare = round2(distance * rate);

  return {
    computed_fare: fare,
    rate_applied: rate,
    distance_used: distance,
    distance_source: source,
    variance_pct,
    toll_amount: round2(toll),
    parking_amount: round2(parking),
    total_amount: round2(fare + toll + parking),
    flags,
  };
}

// ---------------------------------------------------------------------------
// Rate lookup
// ---------------------------------------------------------------------------
/**
 * The rate for a travel mode on a date, as set by the HR Head.
 *
 * Mirrors travel_rate_for() in migration 051. A mode rate (AUTO_CASH) beats a
 * vehicle rate, and within either the newest effective_from on or before the
 * expense date wins — which is what keeps an already-paid claim on the rate it
 * was paid at when HR later revises the card.
 */
export function findModeRate(
  rates: MileageRate[],
  typeCode: string,
  onDate: string
): MileageRate | null {
  return (
    rates
      .filter((r) => r.type_code === typeCode && r.effective_from <= onDate)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null
  );
}

export function findMileageRate(
  rates: MileageRate[],
  vehicleType: 'CAR' | 'TWO_WHEELER',
  fuelType: 'PETROL' | 'DIESEL' | 'CNG' | 'ELECTRIC',
  cubicCapacity: number | null,
  onDate: string
): MileageRate | null {
  const ccBand: 'LTE_1600' | 'GT_1600' | 'NA' =
    fuelType === 'ELECTRIC' || vehicleType === 'TWO_WHEELER'
      ? 'NA'
      : (cubicCapacity ?? 0) > 1600
      ? 'GT_1600'
      : 'LTE_1600';

  const eligible = rates
    .filter(
      (r) =>
        // type_code null keeps mode rates out of the vehicle lookup
        r.type_code == null &&
        r.vehicle_type === vehicleType &&
        r.fuel_type === fuelType &&
        r.cc_band === ccBand &&
        r.effective_from <= onDate
    )
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));

  return eligible[0] ?? null;
}

// ============================================================================
// 2. GROUP POOLING
// ============================================================================

/**
 * Pooling follows the CONSUMERS, not the payer.
 *
 * If an E2 paid for a lunch that an M1 also ate, the pooled limit still
 * includes the M1's entitlement. This is the single most important rule in
 * the group-travel design — get it backwards and the limits are wrong for
 * every mixed-grade trip.
 */
export function poolLimit(
  type: ExpenseType,
  consumers: Consumer[],
  method: GroupLimitMethod,
  maxMultiplier: number
): PoolResult {
  const active = consumers.filter((c) => c.entitlement != null);
  const count = Math.max(active.length, 1);

  const label = (c: Consumer) =>
    `${c.grade === 'GUEST' ? 'Guest' : c.grade} ₹${Number(
      c.entitlement
    ).toLocaleString('en-IN')}`;

  // Not everything scales with headcount. One cab carries four people at one
  // fare; one car covers one distance. Driven by config, never hardcoded.
  if (!type.pools_by_headcount) {
    const single = active.length > 0 ? Math.max(...active.map((c) => c.entitlement)) : 0;
    return {
      pooled_limit: round2(single),
      pooling_method: 'NO_POOLING',
      consumer_count: count,
      per_consumer: active.map((c) => ({
        employee_id: c.employee_id,
        guest_name: c.guest_name ?? null,
        contributed: 0,
      })),
      breakdown_label: `${type.type_name} is charged per vehicle, not per person — limit stays ₹${single.toLocaleString(
        'en-IN'
      )}`,
    };
  }

  if (method === 'HIGHEST_GRADE_X_HEADCOUNT') {
    const highest = active.length > 0 ? Math.max(...active.map((c) => c.entitlement)) : 0;
    const uncapped = highest * count;
    const capped = Math.min(uncapped, highest * maxMultiplier);
    return {
      pooled_limit: round2(capped),
      pooling_method: method,
      consumer_count: count,
      per_consumer: active.map((c) => ({
        employee_id: c.employee_id,
        guest_name: c.guest_name ?? null,
        contributed: round2(capped / count),
      })),
      breakdown_label:
        uncapped > capped
          ? `₹${highest.toLocaleString('en-IN')} × ${count} capped at ${maxMultiplier}× = ₹${capped.toLocaleString('en-IN')}`
          : `₹${highest.toLocaleString('en-IN')} × ${count} = ₹${uncapped.toLocaleString('en-IN')}`,
    };
  }

  // SUM_OF_INDIVIDUAL (default) — exactly what the company would have paid
  // had they travelled separately. Ungameable: adding a junior adds a
  // junior's limit, not a senior's.
  const total = active.reduce((s, c) => s + Number(c.entitlement), 0);
  return {
    pooled_limit: round2(total),
    pooling_method: 'SUM_OF_INDIVIDUAL',
    consumer_count: count,
    per_consumer: active.map((c) => ({
      employee_id: c.employee_id,
      guest_name: c.guest_name ?? null,
      contributed: round2(c.entitlement),
    })),
    breakdown_label: active.map(label).join(' + '),
  };
}

// ============================================================================
// 3. LIMIT CHECK
// ============================================================================

export function findEntitlement(
  entitlements: Entitlement[],
  grade: string | null,
  cityClass: CityClass | null,
  typeCode: string
): Entitlement | null {
  const g = grade && grade.trim() ? grade.trim() : 'NON_GRADED';

  const tryFind = (gr: string, cc: CityClass | null) =>
    entitlements.find(
      (e) => e.type_code === typeCode && e.grade === gr && e.city_class === cc
    ) ?? null;

  return (
    tryFind(g, cityClass) ??
    tryFind(g, null) ??
    tryFind('DEFAULT', cityClass) ??
    tryFind('DEFAULT', null) ??
    null
  );
}

export interface LimitCheckInput {
  amount: number;
  entitlement: Entitlement | null;
  pooled?: PoolResult | null;
  /** Already consumed by this employee for the same date + type, including
   *  shares of expenses somebody else paid for. This is what blocks the
   *  group double-claim. */
  alreadyConsumed?: number;
  typeName: string;
}

export function checkLimit(input: LimitCheckInput): LimitCheckResult {
  const flags: Flag[] = [];
  const { amount, entitlement, pooled, typeName } = input;
  const consumed = Number(input.alreadyConsumed ?? 0);

  if (!entitlement || entitlement.limit_value == null || entitlement.limit_basis === 'NONE') {
    return {
      limit: null,
      claimed: round2(amount),
      payable: round2(amount),
      unclaimable: 0,
      enforcement: 'WARN',
      flags,
    };
  }

  const baseLimit =
    pooled && pooled.pooling_method !== 'NO_POOLING'
      ? pooled.pooled_limit
      : Number(entitlement.limit_value);

  const effectiveLimit = round2(Math.max(baseLimit - consumed, 0));
  const over = round2(amount - effectiveLimit);

  if (over <= 0) {
    return {
      limit: round2(effectiveLimit),
      claimed: round2(amount),
      payable: round2(amount),
      unclaimable: 0,
      enforcement: entitlement.enforcement,
      flags,
    };
  }

  // over the limit
  const isGroup = pooled && pooled.pooling_method !== 'NO_POOLING' && pooled.consumer_count > 1;
  const flagType = isGroup ? 'GROUP_LIMIT_EXCEEDED' : 'OVER_LIMIT';

  const consumedNote =
    consumed > 0
      ? ` (₹${consumed.toLocaleString('en-IN')} of your limit for this date is already used, including bills someone else paid that included you)`
      : '';

  if (entitlement.enforcement === 'BLOCK') {
    flags.push({
      flag_type: flagType,
      severity: 'BLOCK',
      policy_value: effectiveLimit,
      actual_value: amount,
      message: `${typeName} limit is ₹${effectiveLimit.toLocaleString('en-IN')}${consumedNote}. You cannot claim more than this.`,
    });
    return {
      limit: effectiveLimit,
      claimed: round2(amount),
      payable: 0,
      unclaimable: round2(amount),
      enforcement: 'BLOCK',
      flags,
    };
  }

  if (entitlement.enforcement === 'AUTO_TRIM') {
    flags.push({
      flag_type: flagType,
      severity: 'WARN',
      policy_value: effectiveLimit,
      actual_value: amount,
      message: `${typeName} limit is ₹${effectiveLimit.toLocaleString('en-IN')}${consumedNote}. ₹${over.toLocaleString('en-IN')} will not be reimbursed.`,
    });
    return {
      limit: effectiveLimit,
      claimed: round2(amount),
      payable: effectiveLimit,
      unclaimable: over,
      enforcement: 'AUTO_TRIM',
      flags,
    };
  }

  // WARN — full amount goes forward, flagged for the approver
  flags.push({
    flag_type: flagType,
    severity: 'WARN',
    policy_value: effectiveLimit,
    actual_value: amount,
    message: `₹${over.toLocaleString('en-IN')} over the ${typeName} limit of ₹${effectiveLimit.toLocaleString('en-IN')}${consumedNote}. Your manager will see this.`,
  });

  return {
    limit: effectiveLimit,
    claimed: round2(amount),
    payable: round2(amount),
    unclaimable: 0,
    enforcement: 'WARN',
    flags,
  };
}

// ============================================================================
// 4. BILL AGE (client-side mirror of the server guard, for live UI feedback)
// ============================================================================

export function billAgeFlag(
  expenseDate: string,
  policy: TravelPolicy,
  today = new Date().toISOString().slice(0, 10)
): Flag | null {
  const age = Math.round(
    (new Date(today + 'T00:00:00').getTime() -
      new Date(expenseDate + 'T00:00:00').getTime()) /
      86_400_000
  );

  if (age > policy.bill_max_age_days) {
    return {
      flag_type: 'LATE_BILL',
      severity: 'BLOCK',
      policy_value: policy.bill_max_age_days,
      actual_value: age,
      message: `This bill is ${age} days old. Bills older than ${policy.bill_max_age_days} days are not accepted.`,
    };
  }

  if (age > policy.bill_warn_age_days) {
    return {
      flag_type: 'BILL_AGE_WARNING',
      severity: 'WARN',
      policy_value: policy.bill_max_age_days,
      actual_value: age,
      message: `This bill is ${age} days old. Claims over ${policy.bill_max_age_days} days are not accepted — submit soon.`,
    };
  }

  return null;
}

// ============================================================================
// 5. DUPLICATE LEG (group travel — four people, one car)
// ============================================================================

export interface LegSignature {
  employee_id: string;
  log_date: string;
  from_address: string | null;
  to_address: string | null;
  started_at: string | null;
  ended_at: string | null;
}

const norm = (s: string | null) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isDuplicateLeg(a: LegSignature, b: LegSignature): boolean {
  if (a.log_date !== b.log_date) return false;
  if (norm(a.from_address) !== norm(b.from_address)) return false;
  if (norm(a.to_address) !== norm(b.to_address)) return false;

  // if either has no timing, same date + same route is enough
  if (!a.started_at || !b.started_at) return true;

  const aS = new Date(a.started_at).getTime();
  const aE = a.ended_at ? new Date(a.ended_at).getTime() : aS + 3_600_000;
  const bS = new Date(b.started_at).getTime();
  const bE = b.ended_at ? new Date(b.ended_at).getTime() : bS + 3_600_000;

  return aS < bE && bS < aE; // overlapping windows
}
