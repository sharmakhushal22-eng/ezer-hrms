/* lib/te/engine/polyline.js — the recorded route, small enough to keep forever.
 *
 * WHY ENCODE AT ALL. te_leg_pings holds the raw trail, and te_daily() deletes it
 * after gps_rules.retentionDays (180). The route itself has to outlive that: a
 * claim queried eighteen months later is exactly when somebody wants to see
 * where the cab actually went. So the shape is folded down into one text column
 * (te_legs.route_polyline) at the moment the journey ends, and the pings can go.
 *
 * The format is Google's encoded polyline, because that is what every map
 * library on earth already reads, including the Maps JS API's own
 * geometry.encoding.decodePath. Roughly eight times smaller than the same
 * points as JSON: a forty-minute cab ride at a fix every few seconds is about
 * 300 points, which lands near 2 KB.
 *
 * EVERY RECORDED POINT GOES IN, including the ones the engine refuses to pay
 * for. A segment it called an impossible jump is precisely what a desk needs to
 * look at, and a route quietly cleaned of its own anomalies would be evidence of
 * nothing. jStats decides what is payable; this decides nothing at all.
 *
 * Plain .js with a .d.ts beside it, matching te-engine and te-adapter, so the
 * server that writes the polyline and the browser that draws it share one
 * implementation rather than two that drift.
 */

/* One signed value, as the format wants it: shifted left, inverted if negative,
   then five bits at a time with 0x20 marking "more to come" and 63 added to
   land in printable ASCII. */
function encodeValue(v) {
  let s = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (s >= 0x20) {
    out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
    s >>= 5;
  }
  return out + String.fromCharCode(s + 63);
}

/**
 * Points -> encoded polyline. Each point is { lat, lng }; anything without two
 * finite numbers is dropped rather than encoded as zero, because 0,0 is a real
 * place in the Gulf of Guinea and a route that visits it is a lie.
 */
function encodePolyline(points) {
  let lat = 0, lng = 0, out = '';
  for (const p of points || []) {
    const a = Number(p && p.lat), b = Number(p && p.lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    /* Five decimal places is the format's precision: about a metre, which is
       finer than consumer GPS manages anyway. */
    const la = Math.round(a * 1e5), ln = Math.round(b * 1e5);
    out += encodeValue(la - lat) + encodeValue(ln - lng);
    lat = la; lng = ln;
  }
  return out;
}

/**
 * Encoded polyline -> points. The inverse of the above; round-tripped in the
 * tests rather than trusted.
 *
 * Returns [] for anything it cannot read. A corrupt or truncated string must
 * not throw: it would take down a screen whose job is to draw a map beside
 * several other facts that are all still true.
 */
function decodePolyline(s) {
  const out = [];
  if (typeof s !== 'string' || !s) return out;
  let i = 0, lat = 0, lng = 0;
  const one = () => {
    let shift = 0, result = 0, b = 0;
    do {
      if (i >= s.length) return null;
      b = s.charCodeAt(i++) - 63;
      if (b < 0) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (i < s.length) {
    const dlat = one(); if (dlat === null) break;
    const dlng = one(); if (dlng === null) break;
    lat += dlat; lng += dlng;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** The corners of a route, for fitting a map to it. null when there is nothing
 *  to fit, which the caller must handle rather than centring on 0,0. */
function boundsOf(points) {
  const ps = (points || []).filter(p => Number.isFinite(Number(p && p.lat)) && Number.isFinite(Number(p && p.lng)));
  if (!ps.length) return null;
  let n = -Infinity, s = Infinity, e = -Infinity, w = Infinity;
  for (const p of ps) {
    const a = Number(p.lat), b = Number(p.lng);
    if (a > n) n = a; if (a < s) s = a;
    if (b > e) e = b; if (b < w) w = b;
  }
  return { north: n, south: s, east: e, west: w };
}

module.exports = { encodePolyline, decodePolyline, boundsOf };
