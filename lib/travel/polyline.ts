// ============================================================================
// EZER HRMS — Travel Claim Module · Polyline encoding and simplification
// lib/travel/polyline.ts
//
// Pure functions, no API key and no network. Two jobs:
//
//   1. ENCODED POLYLINE — Google returns routes as an encoded string rather
//      than a coordinate array. Both the Roads API and the Directions API use
//      it, so decoding it here means the rest of the app only ever handles
//      plain {lat,lng} points.
//
//   2. SIMPLIFICATION — a recorded drive can hold hundreds of points, most of
//      which sit on a straight line and add nothing to the drawn shape.
//      Douglas-Peucker removes those while keeping every corner, which is what
//      makes a long trail render as a clean path instead of a fuzzy smear.
//      It is shape-preserving, so the route still looks like the road taken.
//
// Simplification is for DRAWING ONLY. Distance is always measured on the full
// trail in gps.ts — dropping points to draw a tidy line must never quietly
// change what the company pays.
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// Google's encoded polyline algorithm format.
// Values are stored as differences from the previous point, shifted left one
// bit (sign in the low bit), then chunked into 5-bit groups offset by 63.
// ---------------------------------------------------------------------------
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    // latitude delta
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // longitude delta
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export function encodePolyline(points: LatLng[]): string {
  const encodeValue = (v: number): string => {
    let value = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    out += String.fromCharCode(value + 63);
    return out;
  };

  let lastLat = 0;
  let lastLng = 0;
  let encoded = '';

  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    encoded += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return encoded;
}

// ---------------------------------------------------------------------------
// Douglas-Peucker.
//
// Keeps the two endpoints, finds the point furthest from the line between
// them, and recurses on both halves if that distance exceeds the tolerance.
// Points closer than the tolerance to the line are dropped, because they say
// nothing about the shape of the route.
//
// Perpendicular distance is computed in a locally-flat projection: longitude
// is scaled by cos(latitude) so a degree east covers the same ground as a
// degree north. Over a single journey the error from ignoring curvature is far
// below the tolerance, and it avoids a trigonometric call per comparison.
// ---------------------------------------------------------------------------
const DEG_M = 111_320; // metres per degree of latitude

function perpendicularDistanceM(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) * DEG_M;
  const ky = DEG_M;

  const px = p.lng * kx, py = p.lat * ky;
  const ax = a.lng * kx, ay = a.lat * ky;
  const bx = b.lng * kx, by = b.lat * ky;

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  // Degenerate segment — a and b are the same point.
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  // Projection parameter, clamped so the distance is to the segment rather
  // than to the infinite line it lies on.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Simplify a path, keeping its shape.
 *
 * @param toleranceM points within this many metres of the line between their
 *   neighbours are dropped. 12 m is a sensible default: below typical GPS
 *   accuracy, so it removes noise without rounding off real corners.
 */
export function simplify(points: LatLng[], toleranceM = 12): LatLng[] {
  if (points.length <= 2) return points.slice();

  // Iterative rather than recursive: a long motorway trail can nest deeply
  // enough to overflow the stack in a browser.
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;

    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistanceM(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------
// Bounding box, for fitting a map to a route or laying out the SVG fallback.
// ---------------------------------------------------------------------------
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null;
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Project points into an SVG viewport.
 *
 * Longitude is scaled by cos(latitude) so the drawn route keeps its real
 * proportions — without it, an east-west journey in India renders about 6%
 * too wide and the shape stops matching the road.
 */
export function projectToViewBox(
  points: LatLng[],
  width: number,
  height: number,
  padding = 8,
): { x: number; y: number }[] {
  const b = boundsOf(points);
  if (!b) return [];

  const midLat = (b.minLat + b.maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);

  const spanX = Math.max((b.maxLng - b.minLng) * lngScale, 1e-9);
  const spanY = Math.max(b.maxLat - b.minLat, 1e-9);

  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  // One scale for both axes, so the route is never stretched.
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const offsetX = padding + (usableW - spanX * scale) / 2;
  const offsetY = padding + (usableH - spanY * scale) / 2;

  return points.map((p) => ({
    x: offsetX + (p.lng - b.minLng) * lngScale * scale,
    // SVG y grows downward; latitude grows north, so it is flipped.
    y: offsetY + (b.maxLat - p.lat) * scale,
  }));
}
