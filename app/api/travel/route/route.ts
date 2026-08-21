// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/route/route.ts
//
//   GET  ?log_id=...                    the stored route for one journey
//   POST { points: [{lat,lng,t,acc}] }  measure an unsaved recording
//
// Returns the route an employee actually drove, and what the same journey
// should have taken, so an approver can see both.
//
// ----------------------------------------------------------------------------
// WHY TWO ROUTES, AND WHICH ALGORITHM
// ----------------------------------------------------------------------------
// A raw GPS trail is not a route. Points land in the wrong lane, drift while
// stationary, and jump between cell towers. Drawing them raw produces a line
// that wanders off the road, and measuring them raw under-reads, because
// straight lines between fixes cut every corner.
//
//   ACTUAL ROUTE — map matching.
//   The trail is matched to the road network with Google's Roads API
//   (snapToRoads, interpolate=true). That is a Hidden Markov Model matcher of
//   the Newson & Krumm kind: each GPS fix is an observation, each nearby road
//   segment a hidden state, and the most probable path is chosen over the whole
//   sequence rather than snapping each point to its nearest road in isolation.
//   Per-point snapping is what puts a route on the wrong side of a dual
//   carriageway; sequence matching does not, because a physically impossible
//   jump between segments is heavily penalised.
//
//   OPTIMAL ROUTE — shortest-path routing.
//   The Directions API returns the route a driver should have taken between the
//   same endpoints. Google runs a contraction-hierarchy style search over the
//   road graph, which is what makes continent-scale shortest paths answerable
//   in milliseconds where a plain Dijkstra would not be.
//
// The gap between the two is the number that matters to Finance. A 40 km claim
// on an 11 km journey is visible immediately; neither figure alone shows it.
//
// Both are upgrades, not dependencies. With no GOOGLE_MAPS_API_KEY the measured
// trail is still returned and the response says which parts are unavailable —
// the claim is never blocked because a maps quota ran out.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/travel/access';
import { resolveActor } from '@/lib/travel/actor';
import { measureTrail, assessTrail, haversineM, isValidPoint } from '@/lib/travel/gps';
import type { GpsPoint } from '@/lib/travel/gps';
import { decodePolyline, encodePolyline, simplify } from '@/lib/travel/polyline';
import type { LatLng } from '@/lib/travel/polyline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SNAP_BATCH = 100;      // Roads API hard limit per request
const round2 = (n: number) => Math.round(n * 100) / 100;

function pathLengthKm(points: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    m += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return round2(m / 1000);
}

// ---------------------------------------------------------------------------
// Map-match the trail to roads. Batches overlap by one point so the distance
// across a batch boundary is not lost.
// ---------------------------------------------------------------------------
async function mapMatch(points: LatLng[], key: string): Promise<LatLng[] | null> {
  try {
    const matched: LatLng[] = [];

    for (let i = 0; i < points.length; i += SNAP_BATCH - 1) {
      const batch = points.slice(i, i + SNAP_BATCH);
      if (batch.length < 2) break;

      const path = batch.map((p) => `${p.lat},${p.lng}`).join('|');
      const res = await fetch(
        `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}` +
          `&interpolate=true&key=${key}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;

      const data = await res.json();
      const pts: LatLng[] = (data?.snappedPoints ?? [])
        .map((s: any) => s?.location)
        .filter(Boolean)
        .map((l: any) => ({ lat: l.latitude, lng: l.longitude }));

      if (!pts.length) return null;
      // Drop the first point of every batch after the first — it repeats the
      // last point of the previous batch.
      matched.push(...(i === 0 ? pts : pts.slice(1)));
    }

    return matched.length >= 2 ? matched : null;
  } catch {
    return null; // timeout, quota, network — degrade, never fail the claim
  }
}

// ---------------------------------------------------------------------------
// What the journey should have been, between the same two endpoints.
// ---------------------------------------------------------------------------
async function optimalRoute(
  from: LatLng,
  to: LatLng,
  key: string,
): Promise<{ km: number; path: LatLng[]; duration_min: number | null } | null> {
  try {
    const res = await fetch(
      'https://maps.googleapis.com/maps/api/directions/json' +
        `?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}` +
        `&mode=driving&alternatives=false&key=${key}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;

    const data = await res.json();
    const leg = data?.routes?.[0]?.legs?.[0];
    const encoded = data?.routes?.[0]?.overview_polyline?.points;
    if (!leg || !encoded) return null;

    return {
      km: round2((leg.distance?.value ?? 0) / 1000),
      duration_min: leg.duration?.value ? Math.round(leg.duration.value / 60) : null,
      path: decodePolyline(encoded),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
async function buildRoute(rawPoints: unknown[]) {
  const clean = (rawPoints ?? []).filter(isValidPoint) as GpsPoint[];
  if (clean.length < 2) {
    return {
      ok: false as const,
      error: 'A recorded trail needs at least two usable location points.',
      code: 'GPS_NO_TRAIL',
    };
  }

  const trail = measureTrail(clean);
  const concerns = assessTrail(trail, rawPoints);
  const key = process.env.GOOGLE_MAPS_API_KEY;

  const asLatLng: LatLng[] = clean.map((p) => ({ lat: p.lat, lng: p.lng }));

  // ---- actual route, matched to roads -------------------------------------
  const matched = key ? await mapMatch(asLatLng, key) : null;
  const matchedKm = matched ? pathLengthKm(matched) : null;

  // Map matching should tighten the figure, not invent kilometres. A match that
  // comes back far longer than the raw trail is a bad match, not a long drive.
  const matchUsable = matchedKm != null && trail.distance_km > 0
    && matchedKm <= trail.distance_km * 1.6;

  const actualKm = matchUsable ? matchedKm! : trail.distance_km;
  const actualPath = simplify(matchUsable ? matched! : asLatLng);

  if (key && !matched) {
    concerns.push({
      code: 'SNAP_UNAVAILABLE',
      severity: 'WARN',
      message: 'Road matching was unavailable, so the straight-line trail distance was used.',
    });
  }

  // ---- what it should have been -------------------------------------------
  const optimal = key
    ? await optimalRoute(asLatLng[0], asLatLng[asLatLng.length - 1], key)
    : null;

  // Positive means the employee travelled further than the suggested route.
  // Detours are legitimate — traffic, one-ways, a second client — so this is
  // reported for a human to weigh, never auto-rejected.
  const excessKm = optimal ? round2(actualKm - optimal.km) : null;
  const excessPct =
    optimal && optimal.km > 0 ? round2(((actualKm - optimal.km) / optimal.km) * 100) : null;

  if (excessPct != null && excessPct > 40) {
    concerns.push({
      code: 'DISTANCE_VARIANCE',
      severity: 'WARN',
      message:
        `The recorded route is ${excessPct}% longer than the direct route ` +
        `(${actualKm} km against ${optimal!.km} km). Ask for the reason if it is not obvious.`,
    });
  }

  return {
    ok: true as const,
    actual: {
      distance_km: actualKm,
      source: matchUsable ? 'GPS_SNAPPED' : 'GPS_TRACKED',
      polyline: encodePolyline(actualPath),
      points: actualPath,
    },
    optimal: optimal
      ? {
          distance_km: optimal.km,
          duration_min: optimal.duration_min,
          polyline: encodePolyline(simplify(optimal.path)),
          points: simplify(optimal.path),
        }
      : null,
    comparison: { excess_km: excessKm, excess_pct: excessPct },
    raw_trail_km: trail.distance_km,
    trail: {
      recorded_points: clean.length,
      used_points: trail.used_points,
      dropped_accuracy: trail.dropped_accuracy,
      dropped_drift: trail.dropped_drift,
      dropped_jump: trail.dropped_jump,
      mean_accuracy_m: trail.mean_accuracy_m,
      duration_min: trail.duration_min,
      avg_speed_kmph: trail.avg_speed_kmph,
    },
    maps_configured: !!key,
    concerns,
  };
}

// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // Only ever an employee measuring their own recording. Gated even though
    // the body carries no employee_id: without this the endpoint is a free
    // Roads/Directions proxy for anyone who finds the URL, on our quota.
    const actor = await resolveActor(req, null, { selfOnly: true });
    if (!actor.ok) return actor.response;

    const { points = [] } = (await req.json()) ?? {};
    const result = await buildRoute(points);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not build the route' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — the route for a journey already logged. This is what an approver
// opens: the trail was stored at submission precisely so a disputed distance
// can be re-derived rather than argued over.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const logId = req.nextUrl.searchParams.get('log_id');
    if (!logId) {
      return NextResponse.json({ error: 'log_id is required' }, { status: 400 });
    }

    // Establish there is a caller before touching the database. Without this
    // the lookup happens first, and a stranger can tell a non-existent journey
    // (404) from one they are not allowed to see (403) — which turns this into
    // a probe for valid log ids. Both ESS and dashboard callers send a bearer
    // token, so its absence is enough to refuse here; the real check is below,
    // once the log's owner is known.
    if (!req.headers.get('authorization')) {
      return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
    }

    const sb = serviceClient();
    const { data: log, error } = await sb
      .from('travel_logs')
      // One string, not concatenated — a split literal defeats supabase-js's
      // column-list type inference and every field below becomes an error.
      .select('id, employee_id, purpose, log_date, type_code, city, gps_track, distance_claimed, distance_gps, distance_snapped, distance_source, rate_applied, total_amount')
      .eq('id', logId)
      .maybeSingle();

    if (error) throw error;
    if (!log) return NextResponse.json({ error: 'Journey not found' }, { status: 404 });

    // A recorded trail is a map of somebody's movements — where they were and
    // when. An employee may only open their own; a dashboard user may open any,
    // which is how HR and Finance review a claim.
    const actor = await resolveActor(req, log.employee_id);
    if (!actor.ok) return actor.response;
    if (!actor.onBehalf && actor.employeeId !== log.employee_id) {
      return NextResponse.json(
        { error: 'You can only view your own recorded journeys.' },
        { status: 403 },
      );
    }

    const track = Array.isArray(log.gps_track) ? log.gps_track : [];
    if (!track.length) {
      return NextResponse.json(
        {
          error: 'This expense has no recorded trail — it was not a GPS-priced journey.',
          code: 'NO_TRAIL',
          log,
        },
        { status: 404 },
      );
    }

    const result = await buildRoute(track);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }

    return NextResponse.json({
      ...result,
      log: {
        id: log.id,
        purpose: log.purpose,
        log_date: log.log_date,
        type_code: log.type_code,
        city: log.city,
        // What was actually paid, so the map can be compared against the money.
        distance_paid: log.distance_claimed,
        distance_source: log.distance_source,
        rate_applied: log.rate_applied,
        total_amount: log.total_amount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load the route' },
      { status: 500 },
    );
  }
}
