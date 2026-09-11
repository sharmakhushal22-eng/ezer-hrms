// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/gps-distance/route.ts
//
//   POST { points: [{lat,lng,t,acc}], type_code?, employee_id?, log_date? }
//     -> { distance_km, snapped_km, source, rate_per_km, amount, concerns[] }
//
// Measures a recorded journey and prices it. Two things matter here:
//
//   1. THE SERVER RE-MEASURES. The browser shows a live distance while driving,
//      but the figure that decides payment is computed here from the submitted
//      trail. A tampered client number never reaches the claim.
//
//   2. SNAPPING IS AN UPGRADE, NOT A DEPENDENCY. With GOOGLE_MAPS_API_KEY set,
//      the trail is snapped to actual roads, which corrects the under-read you
//      get from measuring straight lines between GPS fixes. Without the key the
//      raw trail measurement is used and the response says so. The feature
//      works either way — it does not sit broken waiting for a key.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { resolveActor } from '@/lib/travel/actor';
import { errorResponse } from '@/lib/travel/errors';
import { serviceClient, getEmployeeContext, getActivePolicy, todayISO } from '@/lib/travel/access';
import { measureTrail, assessTrail, compactTrail, haversineM, isValidPoint } from '@/lib/travel/gps';
import type { GpsPoint } from '@/lib/travel/gps';
import { findModeRate, findMileageRate } from '@/lib/travel/calc';
import type { MileageRate } from '@/lib/travel/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Google's Roads API takes at most 100 points per request.
const SNAP_BATCH = 100;

/**
 * Snap a trail to roads and measure the result.
 *
 * Batches overlap by one point so the distance across a batch boundary is not
 * lost. Returns null on any failure — a Maps outage must degrade to the raw
 * measurement, never fail the employee's claim.
 */
async function snapToRoads(points: GpsPoint[], key: string): Promise<number | null> {
  try {
    type LatLng = { latitude: number; longitude: number };
    let totalM = 0;
    let carry: LatLng | null = null;

    for (let i = 0; i < points.length; i += SNAP_BATCH - 1) {
      const batch = points.slice(i, i + SNAP_BATCH);
      if (batch.length < 2) break;

      const path = batch.map((p) => `${p.lat},${p.lng}`).join('|');
      const url =
        `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}` +
        `&interpolate=true&key=${key}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;

      const data = await res.json();
      const snapped: LatLng[] =
        (data?.snappedPoints ?? []).map((s: any) => s.location).filter(Boolean);
      if (snapped.length < 2) return null;

      let prev: LatLng | null = carry;
      for (const pt of snapped) {
        if (prev) {
          totalM += haversineM(prev.latitude, prev.longitude, pt.latitude, pt.longitude);
        }
        prev = pt;
      }
      carry = prev;
    }

    return totalM > 0 ? Math.round((totalM / 1000) * 100) / 100 : null;
  } catch {
    // Timeout, quota, network — all mean "no snap available".
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      points = [],
      type_code = null,
      employee_id: bodyEmployeeId = null,
      log_date = todayISO(),
      vehicle_id = null,
    } = body ?? {};

    if (!Array.isArray(points) || points.length === 0) {
      return NextResponse.json(
        { error: 'A recorded location trail is required.', code: 'GPS_NO_TRAIL' },
        { status: 400 }
      );
    }

    const clean = compactTrail(points.filter(isValidPoint) as GpsPoint[]);
    const trail = measureTrail(clean);
    const concerns = assessTrail(trail, points);

    // ---- snap to roads, if we can ------------------------------------------
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const snapped = key && clean.length >= 2 ? await snapToRoads(clean, key) : null;

    // Snapping should tighten the figure, not invent kilometres. If it comes
    // back wildly larger than the raw trail, something is wrong with the match
    // and the raw measurement is safer.
    const snappedUsable =
      snapped != null && trail.distance_km > 0 && snapped <= trail.distance_km * 1.6;

    const distanceKm = snappedUsable ? snapped! : trail.distance_km;
    const source = snappedUsable ? 'GPS_SNAPPED' : 'GPS_TRACKED';

    if (key && snapped == null) {
      concerns.push({
        code: 'SNAP_UNAVAILABLE',
        severity: 'WARN',
        message: 'Road snapping was unavailable, so the straight-line trail distance was used.',
      });
    }

    // ---- price it -----------------------------------------------------------
    let ratePerKm: number | null = null;
    let rateLabel: string | null = null;
    let mapsConfigured = !!key;

    // Pricing a route reads the caller's own entitlements, so it needs the same proof
    // as filing the log it feeds. Without a session there is nobody to price for.
    const gpsActor = await resolveActor(req, bodyEmployeeId, { selfOnly: true });
    if (!gpsActor.ok) return gpsActor.response;
    const employee_id = gpsActor.employeeId;

    if (type_code && employee_id) {
      const sb = serviceClient();
      const emp = await getEmployeeContext(sb, employee_id);
      const policy = emp ? await getActivePolicy(sb, emp.company_id) : null;

      if (policy) {
        const { data: rateRows } = await sb
          .from('travel_mileage_rates').select('*').eq('policy_id', policy.id);
        const rates = (rateRows ?? []) as MileageRate[];

        // Mode rate first — that is the one the HR Head sets per travel mode.
        const modeRate = findModeRate(rates, type_code, log_date);
        if (modeRate) {
          ratePerKm = Number(modeRate.rate_per_km);
          rateLabel = modeRate.rate_label ?? type_code;
        } else if (vehicle_id) {
          // Own-vehicle types fall back to the vehicle rate card.
          const { data: v } = await sb
            .from('travel_employee_vehicles').select('*').eq('id', vehicle_id).maybeSingle();
          if (v) {
            const vr = findMileageRate(
              rates, v.vehicle_type, v.fuel_type, v.cubic_capacity, log_date
            );
            if (vr) {
              ratePerKm = Number(vr.rate_per_km);
              rateLabel = `${v.vehicle_type} · ${v.fuel_type}`;
            }
          }
        }
      }

      if (ratePerKm == null) {
        concerns.push({
          code: 'NO_RATE_CONFIGURED',
          severity: 'BLOCK',
          message: 'No rate per kilometre is set for this mode. Ask HR to set it on the travel rate card.',
        });
      }
    }

    const amount = ratePerKm != null ? Math.round(distanceKm * ratePerKm * 100) / 100 : null;

    return NextResponse.json({
      distance_km: distanceKm,
      raw_trail_km: trail.distance_km,
      snapped_km: snappedUsable ? snapped : null,
      source,
      maps_configured: mapsConfigured,
      rate_per_km: ratePerKm,
      rate_label: rateLabel,
      amount,
      trail: {
        used_points: trail.used_points,
        dropped_accuracy: trail.dropped_accuracy,
        dropped_drift: trail.dropped_drift,
        dropped_jump: trail.dropped_jump,
        mean_accuracy_m: trail.mean_accuracy_m,
        duration_min: trail.duration_min,
        avg_speed_kmph: trail.avg_speed_kmph,
      },
      concerns,
      // Stored on the log so a disputed distance can be re-derived later.
      compacted_track: clean,
    });
  } catch (e) {
    return errorResponse(e, 'Could not measure the journey',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}
