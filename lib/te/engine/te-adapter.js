/* eslint-disable */
// @ts-nocheck
/* =============================================================================
 * EZER Travel & Expense — adapter between the rules engine and the database.
 *
 * PURE FUNCTIONS. No database, no network, no clock.
 *
 *   in   a snapshot (the JSON te_snapshot() returns) and what the user typed
 *   out  what the engine decided, and the JSON payload the matching SQL
 *        function takes (te_trip_save, te_leg_end, te_leg_file,
 *        te_expense_save, te_claim_submit, te_claim_respond, te_vehicle_add)
 *
 * te-service.js calls these between two RPCs. They are separate so they can be
 * tested without a database (engine/tests/adapter.test.js).
 *
 * FIELD NAMES  What the browser sends uses the engine's own names (the same
 * ones the prototype's forms use): a trip draft has points/segs/people, an
 * expense line has cat/date/bill/claimed. The payloads use the column names of
 * the te_ tables. This file is the only place the two vocabularies meet.
 * ========================================================================== */
'use strict';
const { createEngine, ENGINE_VERSION } = require('./te-engine.js');

const r1 = n => Math.round(n * 10) / 10;
const num = v => (v === '' || v == null || isNaN(+v) ? 0 : +v);
const orNull = v => (v === '' || v === undefined ? null : v);

/* A fresh engine holding this snapshot. The engine changes the objects it is
 * given (assess() re-prices own-vehicle lines in place), so it gets a copy. */
function open(snapshot, opts) {
  const EZ = createEngine();
  EZ.load(JSON.parse(JSON.stringify(snapshot)));
  if (opts && opts.routesOnly) EZ.S.routesOnly = true;
  return EZ;
}

/* ---------------------------------------------------------------- files ---- */
/* An uploaded bill as the API stored it:
 *   { kind, storage_path, file_name, mime_type, file_size, sha256, phash,
 *     ocr: { amount, date, gstin, bill_no, text }, metadata: { software, producer } }
 * The engine reads one file per line (the first). */
function fileToEngine(f) {
  if (!f) return null;
  const o = { name: f.file_name || f.name || 'bill', sha: f.sha256 || f.sha || '', path: f.storage_path || f.path || '' };
  if (f.phash) o.phash = f.phash;
  if (f.ocr && f.ocr.amount != null && f.ocr.amount !== '') o.ocrAmount = +f.ocr.amount;
  if (f.ocr && f.ocr.text) o.text = f.ocr.text;
  if (f.metadata && f.metadata.software) o.editedWith = f.metadata.software;
  if (f.metadata && f.metadata.producer) o.producer = f.metadata.producer;
  return o;
}
function filesToDb(files) {
  return (files || []).map(f => ({
    kind: f.kind || 'BILL', storage_path: f.storage_path || f.path, file_name: f.file_name || f.name || null,
    mime_type: f.mime_type || null, file_size: f.file_size || null, sha256: f.sha256 || f.sha || null, phash: f.phash || null,
    ocr: f.ocr || null, metadata: f.metadata || null
  }));
}

/* ---------------------------------------------------------------- trips ---- */
/* draft (what the planner sends):
 *   { id?, name, scope: local|domestic|international, pattern: oneway|round|multi,
 *     origin: PRE_APPROVED|POST_FACTO, purpose, project,
 *     points: [{ place, pt, what, leave, ret }],          place = te_places id
 *     segs:   [{ mode, bookedBy, vehicleId, xfer: { first, last, hubA, hubB } }],
 *     pax, people: [{ id: <employee code>, name }],
 *     stayBy: self|desk, advance, pfReason, pfNote, answer }
 * Returns the checked plan and the te_trip_save payload. Nothing is saved here. */
function planTrip(EZ, empId, draft) {
  const S = EZ.S, me = EZ.emp(empId);
  const existing = draft.id ? EZ.trip(draft.id) : null;
  const d = {};
  ['name', 'scope', 'pattern', 'origin', 'purpose', 'project', 'points', 'segs', 'people', 'pax', 'stayBy', 'stayWanted', 'foodWanted', 'stayOptions', 'advance', 'pfReason', 'pfNote'].forEach(k => { if (draft[k] !== undefined) d[k] = draft[k]; });
  const base = existing
    ? Object.assign({}, existing, d, { id: existing.id, emp: existing.emp, origin: existing.origin, status: existing.status })
    : Object.assign({ id: '__draft__', emp: empId, co: [], status: 'DRAFT', stayBy: 'self', advance: 0, origin: 'PRE_APPROVED', project: '', people: [] }, d, { emp: empId });
  base.points = (base.points || []).map(p => Object.assign({ pt: '', what: '', leave: '', arrive: '' }, p));
  base.segs = (base.segs || []).map(s => Object.assign({ bookedBy: '', vehicleId: null }, s, { xfer: Object.assign({}, s.xfer || {}) }));
  /* The stored name comes from EZER when the code is known and nothing was
     typed: te_trip_people keeps what the traveller entered, and "" would make
     every screen that reads it render a blank where a colleague should be. */
  base.people = (base.people || []).map(p => {
    const id = String(p.id || '').trim().toUpperCase();
    const typed = String(p.name || '').trim();
    const known = id && (S.codes || {})[id] ? EZ.emp((S.codes || {})[id]) : null;
    return { id, name: typed || (known ? known.name : '') };
  });
  /* people who are employees cannot approve this trip or its claim */
  base.co = base.people.map(p => (S.codes || {})[p.id]).filter(id => id && id !== empId);
  base.advance = num(base.advance);

  const t = EZ.derive(base);
  t.estimate = EZ.estimateFor(empId, t);
  const issues = EZ.tripIssues(t);
  /* the engine compares a typed code with the engine id; here the id is a uuid */
  if (me && me.code && t.people.some(p => p.id === String(me.code).toUpperCase())) issues.unshift({ block: true, t: 'You are already counted. Remove ' + me.code + ' from the list.', k: 'pax' });

  const legs = EZ.buildLegs(t);
  const plannedKm = r1(legs.reduce((a, l) => a + (l.mode === 'flight' ? 0 : l.km), 0));
  const modeOf = EZ.modeOf;
  const payload = {
    trip_id: existing ? existing.id : null, employee_id: empId,
    name: (t.name || '').trim(), scope: t.scope, pattern: t.pattern, origin: t.origin, purpose: t.purpose, project: t.project || '',
    pax: +t.pax || 1, stay_by: t.stayBy || 'self', advance: num(t.advance),
    /* null, not false, when the planner never asked: te_trips keeps the three apart. */
    stay_wanted: t.stayWanted == null ? null : !!t.stayWanted,
    food_wanted: t.foodWanted == null ? null : !!t.foodWanted,
    stay_options: Array.isArray(t.stayOptions) ? t.stayOptions : [],
    post_facto_reason: t.pfReason || '', post_facto_note: t.pfNote || '', answer: draft.answer || '',
    start_date: t.start || null, end_date: t.end || null, from_label: t.from || '', to_label: t.to || '', country: t.country || '',
    estimate: t.estimate, estimate_total: EZ.estimateTotal(t), self_estimate: EZ.selfEstimate(t), planned_km: plannedKm,
    points: t.points.map(p => ({ place_id: p.place, place_type: p.pt || '', what: p.what || '', arrive_on: orNull(p.arrive), leave_on: orNull(p.leave), leave_at: orNull(p.leaveAt), arrive_at: orNull(p.arriveAt), is_return: !!p.ret, is_stop: !!p.stop, pref_note: orNull(p.prefNote), pref_url: orNull(p.prefUrl) })),
    segments: t.segs.map(s => {
      const md = modeOf(s.mode), x = s.xfer || {};
      return { mode: s.mode, booked_by: md && md.basis === 'ticket' ? (s.bookedBy || 'desk') : 'self', vehicle_id: s.mode === 'own' ? orNull(s.vehicleId) : null,
        first_mile_mode: orNull(x.first), last_mile_mode: orNull(x.last), hub_from_place_id: orNull(x.hubA), hub_to_place_id: orNull(x.hubB),
        /* what the traveller asked the desk for; null where they said nothing */
        pref_time: orNull(s.prefTime), pref_url: orNull(s.prefUrl), pref_note: orNull(s.prefNote) };
    }),
    people: t.people.map(p => ({ emp_code: p.id, name: p.name })),
    legs: legs.map(l => ({ leg_no: l.n, segment_seq: l.seg, kind: l.kind, from_place_id: l.from, to_place_id: l.to, leg_date: l.date,
      mode: l.mode, vehicle_id: orNull(l.vehicleId), booked_by: l.bookedBy, gps_mode: l.gps, planned_km: l.km }))
  };
  return {
    trip: t, legs, issues, blocked: issues.filter(i => i.block), warnings: issues.filter(i => !i.block).map(i => i.t),
    estimate: t.estimate, estimateTotal: payload.estimate_total, selfEstimate: payload.self_estimate,
    advanceCap: t.scope === 'local' ? 0 : EZ.advanceCap(t), plannedKm,
    needsApproval: !(t.origin === 'POST_FACTO' || (t.scope === 'local' && plannedKm <= S.cfg.track.preApproveKm)),
    payload
  };
}

/* A leg nobody planned, added during the trip. d = { from, to, mode, vehicleId, why } */
function planExtraLeg(EZ, tripId, d) {
  const t = EZ.trip(tripId); d = d || {};
  if (!t) return { error: 'Trip not found.' };
  const md = EZ.modeOf(d.mode);
  if (!d.from || !d.to || !EZ.place(d.from) || !EZ.place(d.to)) return { error: 'Choose where the journey starts and ends.' };
  if (d.from === d.to) return { error: 'Start and end are the same place.' };
  if (!md || !md.on || !md.scopes.includes(t.scope)) return { error: 'Choose a way of travel allowed on this trip.' };
  if (d.mode === 'own' && !d.vehicleId) return { error: 'Choose your vehicle.' };
  const T = EZ.S.cfg.track;
  if (t.scope === 'local' && EZ.mapKm(t.fromPlace, d.to) > T.localMaxKm) return { error: 'That is beyond the local travel range of ' + T.localMaxKm + ' km.' };
  /* the planned leg that follows will start where this one ends */
  const ls = EZ.legsOf(t), cur = ls.filter(k => k.status !== 'PLANNED').pop(), at = cur ? cur.n + 1 : 1;
  const nx = ls.find(k => k.n === at && k.status === 'PLANNED');
  const p = { from_place_id: d.from, to_place_id: d.to, mode: d.mode, vehicle_id: d.mode === 'own' ? d.vehicleId : null, why: d.why || '',
    gps_mode: EZ.legGps(t.scope, d.mode, d.from, d.to), planned_km: EZ.legKm(d.from, d.to, d.mode) };
  if (nx && nx.from !== d.to && nx.to !== d.to) { p.next_planned_km = EZ.legKm(d.to, nx.to, nx.mode); p.next_gps_mode = EZ.legGps(t.scope, nx.mode, d.to, nx.to); }
  return { payload: p };
}

/* ----------------------------------------------------------------- legs ---- */
/* The numbers of a leg that is ending now. The snapshot must hold the trail of
 * this leg (te_snapshot with opts.leg_id). fix = the phone's GPS fix at the
 * end: { lat, lng, accuracy_m, recorded_at }. nowMs = the server's clock. */
function legEndStats(EZ, legId, fix, nowMs) {
  const j = EZ.journey(legId);
  if (!j) return { error: 'Journey not found.' };
  if (!['ACTIVE', 'PAUSED'].includes(j.status)) return { error: 'This journey is not running.' };
  const t0 = j.startedAt ? Date.parse(j.startedAt) : nowMs;
  const at = fix && fix.recorded_at ? Date.parse(fix.recorded_at) : nowMs;
  const end = { lat: +fix.lat, lng: +fix.lng, t: Math.max(0, Math.round((at - t0) / 1000)), sp: 0, acc: num(fix.accuracy_m) };
  const cs = (j.checkin || {}).start, first = (j.track || [])[0] || (cs ? { lat: +cs.lat, lng: +cs.lng, t: 0, sp: 0, acc: num(cs.acc) } : end);
  j.track = j.gps === 'checkin' ? [first, end] : (j.track && j.track.length ? j.track : [first]).concat([end]);
  j.shown = j.track.length;
  /* a stop still open ends with the leg */
  (j.stops || []).forEach(s => { if (s.dwell == null) s.dwell = Math.max(1, Math.round((end.t - (s.t || 0)) / 60)); });
  const st = EZ.jStats(j), via = EZ.viaKm(j);
  st.pings = st.n;                                   /* the real number of fixes, not the prototype's estimate */
  return {
    stats: st,
    payload: { gps_km: st.gpsKm, route_km: via, gps_points: st.n, gps_gap_max_sec: Math.round((st.gapMaxMin || 0) * 60),
      gps_max_speed_kmh: Math.round((st.maxSp || 0) * 10) / 10, moving_minutes: Math.round((st.moving || 0) / 60), stats: st }
  };
}

/* The leg report: what the employee paid for the leg.
 * d = { fare, merchant, ref, cls, payMode, reason, curr, fxAmt, fxRate, files: [uploaded bill] }
 * Returns { none: true } when there is nothing to claim (company vehicle, or a
 * ticket the Travel Desk booked), else the preview and the te_leg_file payload. */
function legReport(EZ, legId, d) {
  const j = EZ.journey(legId); d = d || {};
  if (!j) return { error: 'Journey not found.' };
  const md = EZ.modeOf(j.mode);
  if (md.basis === 'none' || (md.basis === 'ticket' && j.bookedBy === 'desk' && !!EZ.legBooking(j))) return { none: true, stats: EZ.jStats(j), payload: null };
  const files = d.files || [];
  const x = EZ.legLine(j, { fare: d.fare, merchant: d.merchant, ref: d.ref, cls: d.cls, payMode: d.payMode, reason: d.reason, curr: d.curr, fxAmt: d.fxAmt, fxRate: d.fxRate });
  x.file = files.length ? fileToEngine(files[0]) : null;
  if (d.gstin) x.gstin = String(d.gstin).toUpperCase().trim();
  if (d.billNo) x.billNo = d.billNo;
  const p = EZ.previewExpense(x);
  if (x.cat === 'mileage' && p.mileage) { x.bill = p.mileage.full; x.claimed = p.mileage.full; x.payKm = p.mileage.payKm; x.rate = p.mileage.rate; }
  return {
    line: x, stats: EZ.jStats(j), flags: p.flags, eligible: p.eligible, claimed: num(x.claimed), mileage: p.mileage ? mileageView(p.mileage) : null,
    blocked: !!p.block, needsReason: p.flags.some(f => f.needsReason),
    payload: expensePayload(x, files)
  };
}
const mileageView = m => ({ rate: m.rate, km: m.km, payKm: m.payKm, full: m.full, amount: m.amount, mapKm: m.mapKm, viaKm: m.viaKm, allowed: m.allowed, manual: !!m.manual,
  vehicle: m.veh ? { id: m.veh.id, reg: m.veh.reg, type: m.veh.type } : null });

/* ------------------------------------------------------------- expenses ---- */
const LINE_FIELDS = ['tripId', 'cat', 'date', 'checkIn', 'checkOut', 'merchant', 'gstin', 'billNo', 'pnr', 'ref', 'cls', 'bill', 'claimed', 'payMode', 'desc', 'reason', 'wantException',
  'vehicleId', 'from', 'to', 'km', 'client', 'attendees', 'shared', 'curr', 'fxAmt', 'fxRate'];

/* An expense line as the engine reads it, from what the form sent.
 * input = { id?, tripId, cat, date, merchant, gstin, billNo, pnr | ref, cls, bill, claimed, payMode, desc,
 *           reason, wantException, checkIn, checkOut, client, attendees, shared,
 *           vehicleId, from, to, km,            (own vehicle without a leg)
 *           curr, fxAmt, fxRate,                (a bill abroad)
 *           files: [uploaded bill] } */
function lineFromInput(EZ, empId, input) {
  const old = input.id ? EZ.exp(input.id) : null;
  const x = old ? Object.assign({}, old) : { id: null, emp: empId, tripId: null, cat: '', date: '', merchant: '', billNo: '', gstin: '', bill: 0, claimed: 0, pay: 'self', payMode: 'UPI', desc: '', status: 'UNCLAIMED', file: null, reason: '', wantException: false };
  LINE_FIELDS.forEach(k => { if (input[k] !== undefined) x[k] = input[k]; });
  if (old) x.tripId = old.tripId;                    /* a line does not move to another trip */
  x.emp = old ? old.emp : empId;
  x.gstin = String(x.gstin || '').toUpperCase().trim();
  x.pnr = String(x.pnr || '').toUpperCase().trim(); x.ref = String(x.ref || '').trim();
  x.bill = num(x.bill);
  x.claimed = input.claimed === '' || input.claimed == null ? (old && input.bill === undefined ? num(old.claimed) : x.bill) : num(input.claimed);
  if (input.files !== undefined) x.file = input.files && input.files.length ? fileToEngine(input.files[0]) : null;
  if (x.cat !== 'mileage') { x.vehicleId = null; x.from = null; x.to = null; x.km = null; }
  return x;
}

/* the te_expense_save / te_leg_file payload for an engine line */
function expensePayload(x, files) {
  const p = {
    expense_id: x.id || null, employee_id: x.emp, trip_id: x.tripId || null, category_code: x.cat, expense_date: x.date,
    check_in: orNull(x.checkIn) || null, check_out: orNull(x.checkOut) || null,
    merchant: x.merchant || '', merchant_gstin: x.gstin || '', bill_no: x.billNo || '', reference: x.pnr || x.ref || '', travel_class: x.cls || '',
    bill_amount: num(x.bill), claimed_amount: num(x.claimed),
    currency: x.curr || 'INR', fx_amount: x.fxAmt ? num(x.fxAmt) : null, fx_rate: x.fxRate ? num(x.fxRate) : null,
    payment_mode: x.payMode || '', description: x.desc || '', employee_reason: x.reason || '', wants_exception: !!x.wantException,
    vehicle_id: x.cat === 'mileage' ? orNull(x.vehicleId) : null, from_place_id: orNull(x.from) || null, to_place_id: orNull(x.to) || null,
    payable_km: x.payKm != null ? x.payKm : null, rate_applied: x.rate != null ? x.rate : null,
    client_name: x.client || '', attendees: x.attendees ? +x.attendees : null,
    details: Object.assign({}, x.details || {}, x.km != null && x.km !== '' ? { km: num(x.km) } : {}, x.shared ? { shared: true } : {})
  };
  if (files !== undefined && files !== null) p.files = filesToDb(files);
  return p;
}

/* Check a line as it is typed, and build what te_expense_save takes. */
function prepareExpense(EZ, empId, input) {
  const x = lineFromInput(EZ, empId, input);
  const p = EZ.previewExpense(x);
  if (x.cat === 'mileage' && p.mileage) {
    x.bill = p.mileage.full; x.claimed = p.mileage.full; x.payKm = p.mileage.payKm; x.rate = p.mileage.rate;
    if (!x.journeyId && EZ.place(x.from) && EZ.place(x.to)) { x.merchant = EZ.place(x.from).name + ' → ' + EZ.place(x.to).name; x.payMode = 'Own vehicle'; }
  }
  return { line: x, flags: p.flags, eligible: p.eligible, claimed: num(x.claimed), mileage: p.mileage ? mileageView(p.mileage) : null,
    blocked: !!p.block, needsReason: p.flags.some(f => f.needsReason), payload: expensePayload(x, input.files) };
}

/* --------------------------------------------------------------- claims ---- */
const flagOut = f => ({ lineId: f.lineId || null, code: f.code, title: f.title, evidence: f.evidence || '', evEmp: f.evEmp || '', action: f.action || '',
  sev: f.sev || '', block: !!f.block, needsReason: !!f.needsReason, limitTxt: f.limitTxt || '', over: f.over || 0, match: f.match || null });

/* Run every check on the lines of a claim. The result goes to te_claim_submit
 * (first time) or te_claim_respond (after a send-back) as "assessment". */
function assessClaim(EZ, empId, tripId, lineIds, note) {
  const t = tripId ? EZ.trip(tripId) : null;
  const missing = (lineIds || []).filter(id => !EZ.exp(id));
  if (missing.length) return { error: 'One of these lines is not yours, or no longer exists. Refresh and try again.' };
  const a = EZ.assess(lineIds, empId, tripId || null, note || '');
  const stop = [];
  /* a trip recorded after travel is checked again when its claim is sent */
  if (t && t.origin === 'POST_FACTO') EZ.tripIssues(t).filter(i => i.block).forEach(i => stop.push(i.t));
  const rows = a.rows.map(r => {
    const o = { id: r.x.id, eligible: r.eligible };
    if (r.x.cat === 'mileage' && r.x.pay === 'self') { o.claimed = num(r.x.claimed); o.pay_km = r.x.payKm; o.rate = EZ.mileage(r.x).rate; }
    return o;
  });
  return {
    claimed: a.claimed, eligible: a.eligible, companyPaid: a.companyPaid, outstanding: a.outstanding, net: a.net,
    score: a.score, band: a.band, exception: !!a.exception,
    lines: a.rows.map(r => ({ id: r.x.id, claimed: r.x.pay === 'self' ? num(r.x.claimed) : 0, eligible: r.eligible, flags: r.flags.map(flagOut) })),
    flags: a.flags.map(flagOut),
    blockers: a.blockers.map(flagOut), needs: a.needs.map(flagOut), stop,
    payload: { eligible: a.eligible, score: a.score, band: a.band, exception: !!a.exception, rows, flags: a.flags.map(flagOut) }
  };
}

/* ------------------------------------------------------------- vehicles ---- */
/* What the RC says, in the engine's words. rc = what the Vahan provider
 * returned, already put into these fields by lib/te/providers:
 *   { maker, model, cls, body, fuel, owner, regd, rcValid, insValid, pucValid }
 * null = the number was not found (the employee attaches a photo instead). */
function vehicleFromRc(EZ, empId, reg, rc) {
  if (!EZ.rcFmtOk(reg)) return { error: 'Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA.' };
  if (!EZ.S.cfg.vehx.rcCheck) return { off: true, reg: EZ.rcShow(reg) };
  if (!rc) return { notFound: true, reg: EZ.rcShow(reg) };
  const me = EZ.emp(empId) || {};
  const o = Object.assign({ no: EZ.rcShow(reg), src: 'vahan', checked: EZ.S.today }, rc);
  o.type = EZ.rcType(o); o.match = EZ.nameMatch(o.owner, me.name);
  return { reg: EZ.rcShow(reg), rc: o, type: o.type, typeName: (EZ.vtype(o.type) || {}).name || o.type,
    ownerMasked: o.match === 'match' ? o.owner : EZ.maskName(o.owner), match: o.match, valid: EZ.vehValid({ rc: o }, EZ.S.today) };
}

module.exports = { ENGINE_VERSION, open, fileToEngine, filesToDb, planTrip, planExtraLeg, legEndStats, legReport, lineFromInput, expensePayload, prepareExpense, assessClaim, vehicleFromRc };
