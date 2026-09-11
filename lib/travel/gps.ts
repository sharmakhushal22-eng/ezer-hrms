// ============================================================================
// EZER HRMS — Travel Claim Module · GPS trail measurement
// lib/travel/gps.ts
//
// Bill-less travel is paid on distance, so this file decides what an employee
// is owed. It is deliberately pure and shared by both sides: the browser runs
// it live during a journey, and the server re-runs it on the submitted trail
// rather than trusting the figure the browser sent.
//
// A raw location trail is noisy. Phones report points with wildly varying
// accuracy, and a stationary phone still drifts, which would otherwise bill
// the company for kilometres nobody travelled. Three filters handle it:
//
//   1. Drop points whose reported accuracy is worse than ACCURACY_LIMIT_M.
//   2. Ignore a step shorter than MIN_STEP_M — that is drift, not travel.
//   3. Ignore a step implying a speed above MAX_SPEED_KMPH — that is a GPS
//      jump between cell towers, not a car.
//
// What survives is summed with the haversine formula. That is straight-line
// distance between consecutive points, so it slightly under-reads a real road
// route — which is the right direction to err when the company is paying.
// Snapping to actual roads needs Google and happens server-side; see
// app/api/travel/gps-distance/route.ts.
// ============================================================================

export interface GpsPoint {
  lat: number;
  lng: number;
  /** epoch milliseconds */
  t: number;
  /** reported accuracy radius in metres */
  acc?: number | null;
}

export interface TrailResult {
  /** kilometres, two decimal places */
  distance_km: number;
  /** points that survived filtering */
  used_points: number;
  /** points thrown away, and why */
  dropped_accuracy: number;
  dropped_drift: number;
  dropped_jump: number;
  /** metres — mean accuracy of the points actually used */
  mean_accuracy_m: number | null;
  duration_min: number;
  /** average speed over the journey, a sanity signal for approvers */
  avg_speed_kmph: number | null;
}

// A point reported as worse than 100 m is not good enough to bill from.
export const ACCURACY_LIMIT_M = 100;
// Under 15 m between fixes is stationary drift.
export const MIN_STEP_M = 15;
// Nothing on Indian roads sustains 150 km/h between two fixes.
export const MAX_SPEED_KMPH = 150;

const R_EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Great-circle distance between two coordinates, in metres. */
export function haversineM(
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Is this a usable coordinate? Guards against nulls and (0,0) fixes. */
export function isValidPoint(p: unknown): p is GpsPoint {
  const q = p as GpsPoint;
  return (
    !!q &&
    Number.isFinite(q.lat) && Number.isFinite(q.lng) &&
    Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180 &&
    // (0,0) is in the Atlantic; a device reporting it has no fix.
    !(q.lat === 0 && q.lng === 0)
  );
}

/**
 * Measure a recorded trail.
 *
 * Steps are measured between consecutive *accepted* points, so a rejected
 * point does not break the chain — the next good point is measured against
 * the last good one, and a genuine journey through a patch of bad reception
 * still bills correctly.
 */
export function measureTrail(raw: unknown[]): TrailResult {
  const points = (raw ?? []).filter(isValidPoint).sort((a, b) => a.t - b.t);

  let distanceM = 0;
  let droppedAccuracy = 0;
  let droppedDrift = 0;
  let droppedJump = 0;
  let accSum = 0;
  let accCount = 0;

  let last: GpsPoint | null = null;

  for (const p of points) {
    if (p.acc != null && p.acc > ACCURACY_LIMIT_M) { droppedAccuracy++; continue; }

    if (p.acc != null) { accSum += p.acc; accCount++; }

    if (!last) { last = p; continue; }

    const stepM = haversineM(last.lat, last.lng, p.lat, p.lng);
    const dtHours = Math.max(p.t - last.t, 1) / 3_600_000;
    const speed = stepM / 1000 / dtHours;

    if (stepM < MIN_STEP_M) { droppedDrift++; continue; }
    // Keep `last` where it is on a jump, so the trail re-joins at the next
    // believable fix instead of anchoring to the bad one.
    if (speed > MAX_SPEED_KMPH) { droppedJump++; continue; }

    distanceM += stepM;
    last = p;
  }

  const first = points[0];
  const final = points[points.length - 1];
  const durationMin = first && final ? Math.max(0, Math.round((final.t - first.t) / 60_000)) : 0;
  const km = round2(distanceM / 1000);

  return {
    distance_km: km,
    used_points: points.length - droppedAccuracy,
    dropped_accuracy: droppedAccuracy,
    dropped_drift: droppedDrift,
    dropped_jump: droppedJump,
    mean_accuracy_m: accCount ? round2(accSum / accCount) : null,
    duration_min: durationMin,
    avg_speed_kmph: durationMin > 0 ? round2(km / (durationMin / 60)) : null,
  };
}

/**
 * Reasons an approver should look twice at a GPS-priced journey.
 * Returned as plain findings; the caller decides what becomes a flag.
 */
export interface TrailConcern {
  /** Narrowed to FlagType so these drop straight into the claim's flag list. */
  code: import('./types').FlagType;
  severity: 'WARN' | 'BLOCK';
  message: string;
}

export function assessTrail(t: TrailResult, points: unknown[]): TrailConcern[] {
  const out: TrailConcern[] = [];

  if (t.used_points < 2) {
    out.push({
      code: 'GPS_NO_TRAIL',
      severity: 'BLOCK',
      message:
        'No usable location trail was recorded, so this journey cannot be priced. ' +
        'Check that location permission is granted and record the journey again.',
    });
    return out;
  }

  if (t.distance_km <= 0) {
    out.push({
      code: 'GPS_ZERO_DISTANCE',
      severity: 'BLOCK',
      message: 'The recorded trail shows no movement.',
    });
    return out;
  }

  // A journey recorded from a handful of points across a long distance was
  // probably backgrounded — the true route is unknown between fixes.
  const pointsPerKm = t.used_points / t.distance_km;
  if (t.distance_km > 5 && pointsPerKm < 2) {
    out.push({
      code: 'GPS_SPARSE_TRAIL',
      severity: 'WARN',
      message:
        `Only ${t.used_points} location points were recorded over ${t.distance_km} km. ` +
        'The app may have been in the background, so the distance is approximate.',
    });
  }

  if (t.mean_accuracy_m != null && t.mean_accuracy_m > 50) {
    out.push({
      code: 'GPS_LOW_ACCURACY',
      severity: 'WARN',
      message: `Average location accuracy was ${Math.round(t.mean_accuracy_m)} m, which is poor.`,
    });
  }

  if (t.dropped_jump > 0) {
    out.push({
      code: 'GPS_JUMPS',
      severity: 'WARN',
      message: `${t.dropped_jump} implausible location jump${t.dropped_jump === 1 ? '' : 's'} were excluded from the distance.`,
    });
  }

  if (t.avg_speed_kmph != null && t.avg_speed_kmph > 0 && t.avg_speed_kmph < 4) {
    out.push({
      code: 'GPS_WALKING_PACE',
      severity: 'WARN',
      message:
        `Average speed was ${t.avg_speed_kmph} km/h, which is walking pace rather than a vehicle.`,
    });
  }

  const raw = (points ?? []).length;
  if (raw > 0 && t.used_points / raw < 0.5) {
    out.push({
      code: 'GPS_MOSTLY_DISCARDED',
      severity: 'WARN',
      message: 'More than half the recorded points were too inaccurate to use.',
    });
  }

  return out;
}

/** Trim a trail before storing it — a long drive can record thousands of points. */
export function compactTrail(points: GpsPoint[], max = 500): GpsPoint[] {
  if (points.length <= max) return points;
  // Keep the ends exactly; sample evenly in between so the shape survives.
  const step = (points.length - 1) / (max - 1);
  const out: GpsPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
