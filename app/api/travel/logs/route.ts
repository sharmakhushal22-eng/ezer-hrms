// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/logs/route.ts
//
// The Start Travel / End Travel engine.
//
//   GET    ?employee_id=...&from=...&to=...   my logs for a period
//   POST   { ...leg }                          create a log, fare computed here
//   DELETE ?id=...&employee_id=...             remove an unclaimed log
//
// Every write goes through requireWriteAccess() first, which enforces:
//   · employee is not past their date of leaving
//   · the expense month is OPEN (not CLOSED, not LOCKED)
//   · the bill is within 90 days
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  serviceClient,
  requireWriteAccess,
  requireReadAccess,
  guardResponse,
} from '@/lib/travel/access';
import {
  computeFare,
  findMileageRate,
  findModeRate,
  findEntitlement,
  checkLimit,
  isDuplicateLeg,
  poolLimit,
} from '@/lib/travel/calc';
import {
  measureTrail,
  assessTrail,
  compactTrail,
  isValidPoint,
} from '@/lib/travel/gps';
import type { GpsPoint } from '@/lib/travel/gps';
import type { Consumer, ExpenseType, Flag, MileageRate } from '@/lib/travel/types';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET — my travel logs
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const sb = serviceClient();
    const p = req.nextUrl.searchParams;
    const employeeId = p.get('employee_id');
    if (!employeeId) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }

    // exited employees see nothing — not even their own history
    const access = await requireReadAccess(sb, employeeId);
    if (!access.ok) return guardResponse(access.guard);

    const from = p.get('from') ?? new Date().toISOString().slice(0, 8) + '01';
    const to = p.get('to') ?? new Date().toISOString().slice(0, 10);

    const { data, error } = await sb
      .from('travel_logs')
      .select('*, travel_trips(trip_no, purpose, to_city)')
      .eq('employee_id', employeeId)
      .gte('log_date', from)
      .lte('log_date', to)
      .neq('status', 'CANCELLED')
      .order('log_date', { ascending: false });

    if (error) throw error;

    const logs = data ?? [];
    const unclaimed = logs.filter((l) => !l.claim_id);

    return NextResponse.json({
      logs,
      summary: {
        count: logs.length,
        unclaimed_count: unclaimed.length,
        unclaimed_amount: unclaimed.reduce((s, l) => s + Number(l.total_amount ?? 0), 0),
        total_amount: logs.reduce((s, l) => s + Number(l.total_amount ?? 0), 0),
        total_distance: logs.reduce((s, l) => s + Number(l.distance_claimed ?? 0), 0),
      },
      employee: {
        id: access.employee?.id,
        name: access.employee?.full_name,
        grade: access.employee?.grade,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load logs' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a travel log
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const sb = serviceClient();
    const body = await req.json();

    const {
      employee_id,
      trip_id = null,
      log_date,
      purpose,
      client_name = null,
      type_code,
      vehicle_id = null,
      started_at = null,
      ended_at = null,
      from_address = null,
      from_lat = null,
      from_lng = null,
      to_address = null,
      to_lat = null,
      to_lng = null,
      city = null,
      is_round_trip = false,
      distance_gps = null,
      distance_maps = null,
      distance_claimed = null,
      variance_reason = null,
      amount_entered = 0,
      toll_amount = 0,
      parking_amount = 0,
      shared_with = [] as string[], // employee ids of co-travellers who consumed this
      // recorded journey — see app/api/travel/gps-distance/route.ts
      gps_track = null,
      gps_started_at = null,
      gps_ended_at = null,
    } = body ?? {};

    if (!employee_id || !log_date || !type_code || !purpose) {
      return NextResponse.json(
        { error: 'employee_id, log_date, type_code and purpose are required' },
        { status: 400 }
      );
    }

    // ---- GUARDS: DOL + period open + 90-day bill age --------------------
    const access = await requireWriteAccess(sb, employee_id, log_date);
    if (!access.ok) return guardResponse(access.guard);

    const emp = access.employee!;
    const policy = access.policy!;

    // ---- config ----------------------------------------------------------
    const { data: typeRow } = await sb
      .from('travel_expense_types')
      .select('*')
      .eq('company_id', emp.company_id)
      .eq('type_code', type_code)
      .eq('is_active', true)
      .maybeSingle();

    if (!typeRow) {
      return NextResponse.json(
        { error: `Expense type ${type_code} is not configured for your company.` },
        { status: 400 }
      );
    }
    const type = typeRow as ExpenseType;

    if (!trip_id && !type.allowed_local) {
      return NextResponse.json(
        { error: `${type.type_name} can only be claimed against an outstation trip.` },
        { status: 400 }
      );
    }

    // ---- city class ------------------------------------------------------
    let cityClass: 'METRO' | 'TIER2' | 'OTHER' | null = null;
    if (city) {
      const { data: cityRow } = await sb
        .from('travel_city_class')
        .select('city_class')
        .eq('company_id', emp.company_id)
        .ilike('city_name', city)
        .maybeSingle();
      cityClass = (cityRow?.city_class as typeof cityClass) ?? 'OTHER';
    }

    // ---- recorded journey --------------------------------------------------
    // The trail is re-measured here rather than trusting the browser's live
    // figure — that number is for the employee to watch while driving, not for
    // deciding what the company pays.
    let trailKm: number | null = null;
    let snappedKm: number | null = null;
    let trailMeta: ReturnType<typeof measureTrail> | null = null;
    const trailConcerns: Flag[] = [];
    let cleanTrack: GpsPoint[] = [];

    if (Array.isArray(gps_track) && gps_track.length > 0) {
      cleanTrack = compactTrail(gps_track.filter(isValidPoint) as GpsPoint[]);
      trailMeta = measureTrail(cleanTrack);
      trailKm = trailMeta.distance_km;
      snappedKm = Number(body?.distance_snapped ?? 0) || null;
      // Snapping must tighten the figure, not invent kilometres.
      if (snappedKm != null && trailKm > 0 && snappedKm > trailKm * 1.6) snappedKm = null;

      for (const c of assessTrail(trailMeta, gps_track)) {
        trailConcerns.push({
          flag_type: c.code,
          severity: c.severity,
          message: c.message,
        });
      }
    }

    // A bill-less mode with no recording cannot be priced at all.
    if (type.requires_gps && trailKm == null) {
      return NextResponse.json(
        {
          error:
            `${type.type_name} has no bill to verify against, so the journey must be recorded. ` +
            'Use Start travel and End travel — a typed distance is not accepted for this mode.',
          code: 'GPS_REQUIRED',
        },
        { status: 400 }
      );
    }

    // ---- vehicle + rate --------------------------------------------------
    let ratePerKm: number | null = null;
    let hasVerifiedVehicle = false;

    if (type.calc_method === 'PER_KM') {
      const { data: allRates } = await sb
        .from('travel_mileage_rates').select('*').eq('policy_id', policy.id);

      // The HR Head's per-mode rate wins. Only own-vehicle types, which have no
      // mode rate, fall through to the vehicle rate card below.
      const modeRate = findModeRate((allRates ?? []) as MileageRate[], type_code, log_date);
      if (modeRate) ratePerKm = Number(modeRate.rate_per_km);

      const { data: vehicles } = await sb
        .from('travel_employee_vehicles')
        .select('*')
        .eq('employee_id', employee_id)
        .eq('is_active', true);

      const wanted = type.type_code === 'OWN_BIKE' ? 'TWO_WHEELER' : 'CAR';
      const vehicle =
        (vehicle_id
          ? (vehicles ?? []).find((v) => v.id === vehicle_id)
          : (vehicles ?? []).find((v) => v.vehicle_type === wanted && v.is_verified)) ?? null;

      hasVerifiedVehicle = !!vehicle?.is_verified;

      // Only consult the vehicle card when no mode rate covered this type —
      // otherwise a stale vehicle rate would overwrite the HR Head's setting.
      if (vehicle && ratePerKm == null) {
        const rate = findMileageRate(
          (allRates ?? []) as MileageRate[],
          vehicle.vehicle_type,
          vehicle.fuel_type,
          vehicle.cubic_capacity,
          log_date
        );
        ratePerKm = rate?.rate_per_km ?? null;
      }
    }

    // ---- fare ------------------------------------------------------------
    const fare = computeFare({
      type,
      policy,
      // The re-measured trail beats anything the client sent as distance_gps.
      distance_gps: trailKm ?? distance_gps,
      distance_snapped: snappedKm,
      distance_maps,
      distance_claimed,
      rate_per_km: ratePerKm,
      is_round_trip,
      amount_entered,
      toll_amount,
      parking_amount,
      has_verified_vehicle: hasVerifiedVehicle,
      variance_reason,
    });

    const flags: Flag[] = [...fare.flags, ...trailConcerns];

    // ---- DUPLICATE LEG: four people, one car -----------------------------
    if (trip_id && type.calc_method === 'PER_KM') {
      const { data: siblingLogs } = await sb
        .from('travel_logs')
        .select('id, employee_id, log_date, from_address, to_address, started_at, ended_at')
        .eq('trip_id', trip_id)
        .eq('log_date', log_date)
        .neq('employee_id', employee_id)
        .neq('status', 'CANCELLED');

      const clash = (siblingLogs ?? []).find((s) =>
        isDuplicateLeg(
          { employee_id, log_date, from_address, to_address, started_at, ended_at },
          s as never
        )
      );

      if (clash) {
        flags.push({
          flag_type: 'DUPLICATE_LEG',
          severity: 'BLOCK',
          message:
            'Another traveller on this trip has already logged this same journey. Only the vehicle owner can claim a per-kilometre leg — you are a passenger for this one.',
        });
      }
    }

    // ---- SHARED DUPLICATE: has this date/category already been consumed? --
    const { data: consumedRows } = await sb
      .from('travel_claim_line_shares')
      .select('amount_allocated, is_payer')
      .eq('employee_id', employee_id)
      .eq('expense_date', log_date)
      .eq('type_code', type_code);

    const alreadyConsumed = (consumedRows ?? []).reduce(
      (s, r) => s + Number(r.amount_allocated ?? 0),
      0
    );

    if (alreadyConsumed > 0 && (consumedRows ?? []).some((r) => !r.is_payer)) {
      flags.push({
        flag_type: 'SHARED_DUPLICATE',
        severity: 'WARN',
        actual_value: alreadyConsumed,
        message: `A co-traveller has already claimed ${type.type_name} for ${log_date} and included you. Your remaining limit for this date is reduced accordingly.`,
      });
    }

    // ---- entitlement + pooling ------------------------------------------
    const { data: entitlements } = await sb
      .from('travel_entitlements')
      .select('*')
      .eq('policy_id', policy.id);

    const ent = findEntitlement(entitlements ?? [], emp.grade, cityClass, type_code);

    let pooled = null;
    if (Array.isArray(shared_with) && shared_with.length > 0 && trip_id) {
      const { data: travellers } = await sb
        .from('travel_trip_travellers')
        .select('*')
        .eq('trip_id', trip_id)
        .eq('status', 'CONFIRMED');

      const consumers: Consumer[] = [
        {
          employee_id,
          grade: emp.grade ?? 'NON_GRADED',
          entitlement: Number(ent?.limit_value ?? 0),
        },
      ];

      for (const id of shared_with) {
        const t = (travellers ?? []).find((x) => x.employee_id === id);
        if (!t) {
          flags.push({
            flag_type: 'TRAVELLER_NOT_ON_TRIP',
            severity: 'BLOCK',
            message: 'You have shared this expense with someone who is not on this trip.',
          });
          continue;
        }
        const snap = (t.entitlement_snapshot ?? {}) as Record<string, number>;
        consumers.push({
          employee_id: id,
          grade: t.grade_snapshot ?? 'NON_GRADED',
          entitlement: Number(snap[type_code] ?? ent?.limit_value ?? 0),
        });
      }

      pooled = poolLimit(
        type,
        consumers,
        policy.group_limit_method,
        Number(policy.group_max_multiplier)
      );
    }

    const limit = checkLimit({
      amount: fare.total_amount,
      entitlement: ent,
      pooled,
      alreadyConsumed,
      typeName: type.type_name,
    });
    flags.push(...limit.flags);

    // ---- bill required? --------------------------------------------------
    if (type.bill_threshold > 0 && fare.total_amount > type.bill_threshold) {
      flags.push({
        flag_type: 'MISSING_BILL',
        severity: 'WARN',
        policy_value: type.bill_threshold,
        actual_value: fare.total_amount,
        message: `A bill is required for ${type.type_name} above ₹${type.bill_threshold}. Attach it before submitting.`,
      });
    }

    // ---- hard stops ------------------------------------------------------
    const blockers = flags.filter((f) => f.severity === 'BLOCK');
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: blockers[0].message, code: blockers[0].flag_type, flags },
        { status: 409 }
      );
    }

    // ---- write -----------------------------------------------------------
    const { data: log, error } = await sb
      .from('travel_logs')
      .insert({
        company_id: emp.company_id,
        employee_id,
        trip_id,
        log_date,
        purpose,
        client_name,
        type_code,
        vehicle_id,
        started_at,
        ended_at,
        from_address,
        from_lat,
        from_lng,
        to_address,
        to_lat,
        to_lng,
        city,
        city_class: cityClass,
        is_round_trip,
        distance_gps: trailKm ?? distance_gps,
        distance_snapped: snappedKm,
        distance_maps,
        distance_claimed: fare.distance_used,
        distance_source: fare.distance_source,
        // Kept so a disputed distance can be re-derived rather than argued over.
        gps_track: cleanTrack.length ? cleanTrack : null,
        gps_point_count: trailMeta?.used_points ?? null,
        gps_accuracy_m: trailMeta?.mean_accuracy_m ?? null,
        gps_duration_min: trailMeta?.duration_min ?? null,
        gps_started_at,
        gps_ended_at,
        variance_pct: fare.variance_pct,
        variance_reason,
        rate_applied: fare.rate_applied,
        computed_fare: fare.computed_fare,
        amount_entered: Number(amount_entered ?? 0),
        toll_amount: fare.toll_amount,
        parking_amount: fare.parking_amount,
        total_amount: fare.total_amount,
        is_shared: Array.isArray(shared_with) && shared_with.length > 0,
        passenger_count: Array.isArray(shared_with) ? shared_with.length : 0,
        status: 'LOGGED',
      })
      .select()
      .single();

    if (error) throw error;

    // ---- share ledger ----------------------------------------------------
    if (pooled && Array.isArray(shared_with) && shared_with.length > 0) {
      const perHead = fare.total_amount / (shared_with.length + 1);
      const rows = [
        {
          travel_log_id: log.id,
          trip_id,
          employee_id,
          expense_date: log_date,
          type_code,
          is_payer: true,
          entitlement_contributed: Number(ent?.limit_value ?? 0),
          amount_allocated: perHead,
        },
        ...shared_with.map((id: string) => {
          const c = pooled!.per_consumer.find((x) => x.employee_id === id);
          return {
            travel_log_id: log.id,
            trip_id,
            employee_id: id,
            expense_date: log_date,
            type_code,
            is_payer: false,
            entitlement_contributed: c?.contributed ?? 0,
            amount_allocated: perHead,
          };
        }),
      ];
      await sb.from('travel_claim_line_shares').insert(rows);
    }

    return NextResponse.json({
      log,
      fare,
      limit,
      pooled,
      flags,
      message:
        flags.length > 0
          ? 'Travel logged with notes for your manager.'
          : 'Travel logged.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save travel log' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove an unclaimed log
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const sb = serviceClient();
    const id = req.nextUrl.searchParams.get('id');
    const employeeId = req.nextUrl.searchParams.get('employee_id');

    if (!id || !employeeId) {
      return NextResponse.json({ error: 'id and employee_id are required' }, { status: 400 });
    }

    const { data: log } = await sb
      .from('travel_logs')
      .select('id, employee_id, claim_id, log_date')
      .eq('id', id)
      .maybeSingle();

    if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 });
    if (log.employee_id !== employeeId) {
      return NextResponse.json({ error: 'Not your travel log' }, { status: 403 });
    }
    if (log.claim_id) {
      return NextResponse.json(
        { error: 'This log is already part of a submitted claim and cannot be deleted.' },
        { status: 409 }
      );
    }

    const access = await requireWriteAccess(sb, employeeId, log.log_date);
    if (!access.ok) return guardResponse(access.guard);

    await sb.from('travel_claim_line_shares').delete().eq('travel_log_id', id);
    await sb.from('travel_logs').update({ status: 'CANCELLED' }).eq('id', id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete log' },
      { status: 500 }
    );
  }
}
