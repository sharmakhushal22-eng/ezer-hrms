/* eslint-disable */
// @ts-nocheck
/* =============================================================================
 * EZER Travel & Expense — the service layer.  One function per user action.
 *
 * Every API route is three lines: find out who is calling, call one function
 * here, return what it returns. Each function follows the same pattern:
 *
 *     1  snapshot  = RPC te_snapshot(employee)          (148)
 *     2  the rules engine checks and computes            (te-engine.js, te-adapter.js)
 *     3  one action RPC stores the result                (146, 147)
 *
 * Actions the engine has nothing to add to (approve, pay, lock a month) are a
 * single RPC and are here only so the routes have one place to call.
 *
 * ctx = {
 *   db:    { rpc(name, args) -> Promise<data> }   throws { message, hint } on a refusal
 *   actor: '<employee uuid>'                       from the signed token, never from the body
 *   now:   () => milliseconds                      optional, the server clock
 *   routes(from, to) -> { km, minutes, polyline, provider }      optional: map directions
 *   rc(regNo)        -> { maker, model, cls, body, fuel, owner, regd, rcValid, insValid, pucValid } | null   optional: Vahan
 *   geocode(address) -> { lat, lng, approx } | null               optional
 *   reverseGeocode(lat, lng) -> { name, address, city, pin, country } | null   optional
 * }
 *
 * The same file runs in the Next.js routes (db = Supabase service client) and
 * in the tests (db = node-postgres). See app-code/lib/te/server.ts and
 * engine/tests/support/db.js.
 * ========================================================================== */
'use strict';
const A = require('./te-adapter.js');

class TeError extends Error {
  constructor(message, code, extra) { super(message); this.name = 'TeError'; this.code = code || 'TE_INVALID'; this.status = code === 'TE_FORBIDDEN' ? 403 : 409; this.extra = extra || null; }
}
const stop = (message, code, extra) => { throw new TeError(message, code, extra); };
const now = ctx => (ctx.now ? ctx.now() : Date.now());
const snap = (ctx, opts, who) => ctx.db.rpc('te_snapshot', { p_employee_id: who || ctx.actor, p_opts: opts || {} });
const uniq = a => Array.from(new Set(a.filter(Boolean)));
/* What goes back to the CLAIMANT: where a flag names a colleague, the wording written for the claimant replaces the evidence. */
const own = f => (f && f.evEmp ? Object.assign({}, f, { evidence: f.evEmp }) : f);
const ownFlags = v => { if (!v) return v; ['flags', 'blockers', 'needs'].forEach(k => { if (Array.isArray(v[k])) v[k] = v[k].map(own); }); if (Array.isArray(v.lines)) v.lines = v.lines.map(l => (Array.isArray(l.flags) ? Object.assign({}, l, { flags: l.flags.map(own) }) : l)); return v; };

/* ask the map provider for the road distances the engine could not find, store them */
async function fillRoutes(ctx, EZ) {
  const miss = (EZ.S.routeMiss || []), seen = {}; let n = 0;
  for (const [f, t] of miss) {
    const k = [f, t].sort().join('|'); if (seen[k]) continue; seen[k] = 1;
    const r = await ctx.routes(EZ.place(f), EZ.place(t));
    if (r && r.km >= 0) { await ctx.db.rpc('te_route_put', { p_from: f, p_to: t, p_km: r.km, p_minutes: r.minutes == null ? null : Math.round(r.minutes), p_polyline: r.polyline || null, p_provider: r.provider || 'google' }); n++; }
  }
  return n;
}
/* load a snapshot into an engine; run fn; if road distances were missing and a
 * map provider is configured, fetch them and run again with the real ones */
async function withEngine(ctx, opts, fn) {
  let s = await snap(ctx, opts), EZ = A.open(s, { routesOnly: !!ctx.routes }), out = fn(EZ, s);
  if (ctx.routes && EZ.S.routeMiss && EZ.S.routeMiss.length && await fillRoutes(ctx, EZ)) {
    s = await snap(ctx, opts); EZ = A.open(s, { routesOnly: true }); out = fn(EZ, s);
  }
  return { EZ, snapshot: s, out };
}

/* ------------------------------------------------------------- reading ---- */
/* Everything the employee's own screens show. The UI renders from this. */
const me = ctx => snap(ctx, {});
const queue = ctx => ctx.db.rpc('te_queue', { p_actor: ctx.actor });
const tripDetail = (ctx, tripId, admin) => ctx.db.rpc('te_trip_detail', { p_trip_id: tripId, p_actor: ctx.actor, p_admin: !!admin });
const claimDetail = (ctx, claimId, admin) => ctx.db.rpc('te_claim_detail', { p_claim_id: claimId, p_actor: ctx.actor, p_admin: !!admin });

/* --------------------------------------------------------------- places ---- */
/* input = { src: 'gps' | 'address' | 'search', pt, label, line, area, city, state (2-digit code), pin, country, lat, lng, acc } */
async function placeAdd(ctx, input) {
  input = input || {};
  const s = await snap(ctx, {}), EZ = A.open(s);
  let lat = +input.lat, lng = +input.lng;
  const src = input.src === 'gps' ? 'gps' : 'address', abroad = !!input.country && input.country !== 'India';
  let p;
  if (src === 'gps') {
    if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) stop('This place has no position on the map.', 'TE_PLACE');
    const near = EZ.myPlaces(ctx.actor).map(k => [k, EZ.hav(k, { lat, lng })]).sort((a, b) => a[1] - b[1])[0];
    if (near && near[1] <= 0.15) return { place_id: near[0].id, matched: true };
    const g = (ctx.reverseGeocode && await ctx.reverseGeocode(lat, lng)) || {};
    const co = lat.toFixed(5) + ', ' + lng.toFixed(5);
    p = { short_name: input.label || g.name || 'GPS point', name: input.label || g.name || 'GPS point', address: (g.address || 'Pinned by GPS') + ' (' + co + ')',
      city: g.city || input.city || '', pin_code: g.pin || '', country: g.country || 'India', gps_accuracy_m: Math.round(+input.acc || 0) };
  } else {
    const line = (input.line || '').trim(), area = (input.area || '').trim(), city = (input.city || '').trim(), pin = (input.pin || '').trim();
    if (!line) stop('Enter the building and street.', 'TE_PLACE', { field: 'line' });
    if (!city) stop('Enter the city.', 'TE_PLACE', { field: 'city' });
    if (input.src !== 'search') {
      if (!area) stop('Enter the area or locality.', 'TE_PLACE', { field: 'area' });
      if (!abroad) { const pi = EZ.pinIssue(pin, input.state); if (pi) stop(pi, 'TE_PLACE', { field: 'pin' }); }
    }
    if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) {
      const g = ctx.geocode && await ctx.geocode({ line, area, city, state: input.state, pin, country: input.country || 'India' });
      if (!g) stop('This address could not be found on the map. Check it, or drop a pin.', 'TE_PLACE');
      lat = +g.lat; lng = +g.lng;
    }
    const label = (input.label || '').trim() || area || line, st = EZ.STATES[input.state] || '';
    p = { short_name: label.length > 26 ? label.slice(0, 25) + '…' : label, name: label,
      address: abroad ? [line, area, city, pin, input.country].filter(Boolean).join(', ') : [line, area, city, st, pin].filter(Boolean).join(', ').replace(/, (\d{6})$/, ' $1'),
      city, state: abroad ? '' : st, pin_code: pin, country: abroad ? input.country : 'India' };
  }
  return ctx.db.rpc('te_place_save', { p: Object.assign(p, { employee_id: ctx.actor, source: src, place_type: input.pt || 'other', lat, lng }), p_actor: ctx.actor });
}

/* ------------------------------------------------------------- vehicles ---- */
async function vehicleLookup(ctx, reg) {
  const s = await snap(ctx, {}), EZ = A.open(s);
  if (!EZ.rcFmtOk(reg)) stop('Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA.', 'TE_VEHICLE', { field: 'reg' });
  const rc = s.cfg.vehx.rcCheck && ctx.rc ? await ctx.rc(EZ.rcNorm(reg)) : null;
  const v = A.vehicleFromRc(EZ, ctx.actor, reg, rc);
  if (v.error) stop(v.error, 'TE_VEHICLE');
  return v;                                  /* the owner's name is masked unless it is the employee's own */
}
/* input = { reg, type, whose: self|family|other, rc_file_url }.  The RC is looked up again here: what
 * the browser saw is never trusted. */
async function vehicleAdd(ctx, input) {
  const v = await vehicleLookup(ctx, input.reg);
  return ctx.db.rpc('te_vehicle_add', { p: { employee_id: ctx.actor, type_code: input.type || '', reg_no: input.reg, ownership: input.whose || '', rc_file_url: input.rc_file_url || '', rc: v.rc || null }, p_actor: ctx.actor });
}
const vehicleVerify = (ctx, vehicleId, typeCode) => ctx.db.rpc('te_vehicle_verify', { p_vehicle_id: vehicleId, p_actor: ctx.actor, p_type_code: typeCode || null });

/* ---------------------------------------------------------------- trips ---- */
const draftOpts = d => ({ codes: uniq((d.people || []).map(p => String(p.id || '').trim().toUpperCase())),
  places: uniq((d.points || []).map(p => p.place).concat(...(d.segs || []).map(s => [(s.xfer || {}).hubA, (s.xfer || {}).hubB]))) });

/* Check a plan as it is being filled in: problems, legs, estimate, advance cap, who will approve. Saves nothing. */
async function tripPreview(ctx, draft) {
  const { EZ, snapshot, out: plan } = await withEngine(ctx, draftOpts(draft), EZ => A.planTrip(EZ, ctx.actor, draft));
  let chain = [];
  if (plan.needsApproval && plan.trip.scope) {
    chain = await ctx.db.rpc('te_resolve_chain', { p_company_id: snapshot.company, p_employee_id: ctx.actor, p_workflow: 'trip',
      p_ctx: { total: plan.estimateTotal, scope: plan.trip.scope }, p_co: plan.trip.co || [], p_levels: null }) || [];
  }
  const P = id => { const p = EZ.place(id); return p ? { id: p.id, s: p.s, city: p.city } : null; };
  /* WHO THE CO-TRAVELLER CODES TURNED OUT TO BE. draftOpts already asked the
     snapshot to resolve exactly these codes, so the work is done; it was just
     never sent back. The browser's own snapshot carries an empty codes map
     (GET /api/te/me asks for none), so without this the planner told everyone
     "Not found in EZER" about colleagues who were found perfectly well, on
     every trip. The LINK was never broken — co is resolved here and at save,
     so C8 and "a co-traveller cannot approve" always worked — only the
     sentence under the field was wrong. */
  const people = (plan.trip.people || []).map(q => {
    const id = (EZ.S.codes || {})[String(q.id || '').trim().toUpperCase()];
    const e = id && EZ.emp(id);
    return { code: q.id, id: id || null, name: e ? e.name : '', grade: e ? e.grade : '' };
  });
  return { issues: plan.issues, blocked: plan.blocked.length > 0, warnings: plan.warnings, people,
    start: plan.trip.start, end: plan.trip.end, from: plan.trip.from, to: plan.trip.to,
    legs: plan.legs.map(l => Object.assign({}, l, { fromPlace: P(l.from), toPlace: P(l.to), estimate: EZ.legEst(l, plan.trip.scope) })),
    estimate: plan.estimate, estimateTotal: plan.estimateTotal, selfEstimate: plan.selfEstimate, advanceCap: plan.advanceCap, plannedKm: plan.plannedKm,
    needsApproval: plan.needsApproval, chain: chain.map(c => ({ role: c.role_label, who: c.approver_id, team: c.team_code, stage: c.stage, note: c.note, name: c.team_code ? 'Finance team' : ((EZ.emp(c.approver_id) || {}).name || '') })),
    entitlements: plan.trip.to ? EZ.entitlements(ctx.actor, plan.trip.to) : null };
}
/* Plan a trip, record a past one, or edit one (draft.id). */
async function tripSave(ctx, draft) {
  const { out: plan } = await withEngine(ctx, draftOpts(draft), EZ => A.planTrip(EZ, ctx.actor, draft));
  if (plan.blocked.length) stop(plan.blocked[0].t, 'TE_TRIP', { field: plan.blocked[0].k || '', issues: plan.issues });
  const r = await ctx.db.rpc('te_trip_save', { p: plan.payload, p_actor: ctx.actor });
  return Object.assign({ warnings: plan.warnings }, r);
}
const tripDecide = (ctx, tripId, action, comment) => ctx.db.rpc('te_trip_decide', { p_trip_id: tripId, p_actor: ctx.actor, p_action: action, p_comment: comment || null });
const tripAnswer = (ctx, tripId, text) => ctx.db.rpc('te_trip_answer', { p_trip_id: tripId, p_actor: ctx.actor, p_text: text });
const tripCancel = (ctx, tripId, admin) => ctx.db.rpc('te_trip_cancel', { p_trip_id: tripId, p_actor: ctx.actor, p_admin: !!admin });
const tripRecordMissed = (ctx, tripId, reason, note) => ctx.db.rpc('te_trip_record_missed', { p_trip_id: tripId, p_actor: ctx.actor, p_reason: reason, p_note: note || null });
/* the Travel Desk: input = { trip_id, leg_id | point_seq, vendor, reference, amount, ticket_url } */
const bookingRecord = (ctx, input) => ctx.db.rpc('te_booking_record', { p: input, p_actor: ctx.actor });
/* The employee asks the desk to book a stay they have found. Not the same call
   as bookingRecord: that one records something already bought and paid for and
   writes a company-paid expense line. A request buys nothing, so it writes no
   expense — see 153_te_booking_request.sql. The SQL checks the trip is the
   caller's own; there is no role to hold. */
const bookingRequest = (ctx, input) => ctx.db.rpc('te_booking_request', { p: input, p_actor: ctx.actor });
/* the Reports and Dashboard tab: mine, scorecard, what I acted on, my team */
const dashboard = (ctx, from, to) => ctx.db.rpc('te_dashboard', { p_actor: ctx.actor, p_from: from, p_to: to });
/* the desk picks one of the hotels the employee suggested, or turns them all down with a reason */
const stayDecide = (ctx, input) => ctx.db.rpc('te_stay_decide', { p: input, p_actor: ctx.actor });
const bookingCancel = (ctx, bookingId, reason) => ctx.db.rpc('te_booking_cancel', { p_booking_id: bookingId, p_actor: ctx.actor, p_reason: reason });
/* Records that the traveller was sent their ticket. Called AFTER the provider
   has accepted the message, so the row says what happened and not what was
   attempted. Holds the last send, not a count: sending again is normal. */
const bookingEmailed = (ctx, bookingId, to) => ctx.db.rpc('te_booking_emailed', { p_booking_id: bookingId, p_actor: ctx.actor, p_to: to });

/* ----------------------------------------------------------------- legs ---- */
/* fix = { lat, lng, accuracy_m, address, recorded_at, is_mock, device } from the phone */
const legStart = (ctx, legId, fix) => ctx.db.rpc('te_leg_start', { p_leg_id: legId, p_actor: ctx.actor, p_fix: fix || {} });
const legPings = (ctx, legId, pings) => ctx.db.rpc('te_leg_pings_add', { p_leg_id: legId, p_actor: ctx.actor, p_pings: pings || [] });
const legStop = (ctx, legId, stopAt) => ctx.db.rpc('te_leg_stop_add', { p_leg_id: legId, p_actor: ctx.actor, p_stop: stopAt || {} });
const legContinue = (ctx, legId, minutes, at) => ctx.db.rpc('te_leg_stop_end', { p_leg_id: legId, p_actor: ctx.actor, p_minutes: minutes == null ? null : minutes, p_at: at || null });
/* End a leg: the engine works out distance, gaps and jumps from the stored trail; SQL stores them. */
async function legEnd(ctx, legId, fix) {
  if (!fix || fix.lat == null || fix.lng == null) stop('Your location is needed to end the journey.', 'TE_GPS');
  const s = await snap(ctx, { leg_id: legId }), EZ = A.open(s, { routesOnly: !!ctx.routes });
  const r = A.legEndStats(EZ, legId, fix, now(ctx));
  if (r.error) stop(r.error, 'TE_LEG');
  const out = await ctx.db.rpc('te_leg_end', { p_leg_id: legId, p_actor: ctx.actor, p_fix: fix, p_stats: r.payload });
  return Object.assign({ stats: r.stats }, out);
}
/* The leg report as it is typed: flags, eligible amount, the mileage working. Saves nothing. */
async function legPreview(ctx, legId, d) {
  const { out } = await withEngine(ctx, {}, EZ => A.legReport(EZ, legId, d));
  if (out.error) stop(out.error, 'TE_LEG');
  const { payload, line, ...view } = out; return ownFlags(view);
}
async function legFile(ctx, legId, d) {
  const { out } = await withEngine(ctx, {}, EZ => A.legReport(EZ, legId, d));
  if (out.error) stop(out.error, 'TE_LEG');
  if (!out.none) {
    if (out.blocked) stop('Fix the blocked items first.', 'TE_LEG', { flags: (out.flags || []).map(own) });
    if (out.needsReason) stop('Add a reason where one is asked.', 'TE_LEG', { flags: (out.flags || []).map(own) });
  }
  const r = await ctx.db.rpc('te_leg_file', { p_leg_id: legId, p_actor: ctx.actor, p_expense: out.payload });
  return Object.assign({ eligible: out.eligible || 0, flags: (out.flags || []).map(own) }, r);
}
const legSkip = (ctx, legId, reason) => ctx.db.rpc('te_leg_skip', { p_leg_id: legId, p_actor: ctx.actor, p_reason: reason });
const legNoGps = (ctx, legId, reason, note) => ctx.db.rpc('te_leg_no_gps', { p_leg_id: legId, p_actor: ctx.actor, p_reason: reason, p_note: note || null });
/* d = { from, to, mode, vehicleId, why } */
async function legAdd(ctx, tripId, d) {
  const { out } = await withEngine(ctx, { places: [d && d.from, d && d.to] }, EZ => A.planExtraLeg(EZ, tripId, d));
  if (out.error) stop(out.error, 'TE_LEG');
  return ctx.db.rpc('te_leg_add', { p_trip_id: tripId, p_actor: ctx.actor, p_leg: out.payload });
}

/* ------------------------------------------------------------- expenses ---- */
const probeOf = i => [{ sha: (i.files && i.files[0] && (i.files[0].sha256 || i.files[0].sha)) || '', phash: (i.files && i.files[0] && i.files[0].phash) || '',
  bill_no: i.billNo || '', reference: i.pnr || i.ref || '', date: /^\d{4}-\d{2}-\d{2}$/.test(i.date || '') ? i.date : '', bill: isFinite(+i.bill) && +i.bill > 0 ? +i.bill : '' }];
/* Check a line as it is typed. Saves nothing. */
async function expensePreview(ctx, input) {
  const { out } = await withEngine(ctx, { probe: probeOf(input), places: [input.from, input.to] }, EZ => A.prepareExpense(EZ, ctx.actor, input));
  const { payload, line, ...view } = out; return ownFlags(view);
}
async function expenseSave(ctx, input) {
  const { out } = await withEngine(ctx, { probe: probeOf(input), places: [input.from, input.to] }, EZ => A.prepareExpense(EZ, ctx.actor, input));
  if (out.blocked) stop('Fix the blocked items first.', 'TE_EXPENSE', { flags: out.flags.map(own) });
  const r = await ctx.db.rpc('te_expense_save', { p: out.payload, p_actor: ctx.actor });
  return Object.assign({ eligible: out.eligible, flags: out.flags.map(own) }, r);
}
const expenseDiscard = (ctx, expenseId) => ctx.db.rpc('te_expense_discard', { p_expense_id: expenseId, p_actor: ctx.actor });

/* --------------------------------------------------------------- drafts ---- */
/* Unfinished work: a trip plan or an expense form the person has not finished.
   NO ENGINE AND NO VALIDATION, deliberately — the whole value of a draft is
   that it may be as incomplete as they left it, and prepareExpense/planTrip
   exist precisely to refuse incomplete things. The body is the client's own
   form object and nothing on this side reads inside it. Ownership is enforced
   in SQL, so these take no employee id from the caller.
   input = { id?, kind: 'trip'|'expense'|'claim', title?, scope?, step?, body, trip_id?, claim_id? } */
const draftSave = (ctx, input) => ctx.db.rpc('te_draft_save', { p: input, p_actor: ctx.actor });
const draftList = (ctx, kind) => ctx.db.rpc('te_draft_list', { p_actor: ctx.actor, p_kind: kind || null });
const draftDelete = (ctx, draftId) => ctx.db.rpc('te_draft_delete', { p_draft_id: draftId, p_actor: ctx.actor });

/* --------------------------------------------------------------- claims ---- */
/* which lines go into a claim when the caller does not list them: every saved
 * line of the trip (the company-paid ones travel with it), or every saved
 * line that belongs to no trip */
const defaultLines = (EZ, who, tripId) => EZ.unclaimed(who, tripId || null).filter(x => !x.other).map(x => x.id);
/* The review screen before submit: totals, flags, what is capped, net against the advance, who approves. */
async function claimPreview(ctx, input) {
  input = input || {};
  const { EZ, snapshot, out: a } = await withEngine(ctx, {}, EZ => A.assessClaim(EZ, ctx.actor, input.tripId || null, input.lineIds || defaultLines(EZ, ctx.actor, input.tripId), input.note));
  if (a.error) stop(a.error, 'TE_CLAIM');
  const t = input.tripId ? EZ.trip(input.tripId) : null;
  const chain = await ctx.db.rpc('te_resolve_chain', { p_company_id: snapshot.company, p_employee_id: ctx.actor, p_workflow: 'claim',
    p_ctx: { total: a.claimed, scope: t ? t.scope : null, postFacto: !!(t && t.origin === 'POST_FACTO'), exception: a.exception, band: a.band },
    p_co: t ? (t.co || []) : [], p_levels: null }) || [];
  const { payload, ...view } = a;
  return Object.assign(ownFlags(view), { chain: chain.map(c => ({ role: c.role_label, who: c.approver_id, team: c.team_code, stage: c.stage, note: c.note, name: c.team_code ? 'Finance team' : ((EZ.emp(c.approver_id) || {}).name || '') })) });
}
/* input = { tripId, lineIds, note, declared } */
async function claimSubmit(ctx, input) {
  input = input || {};
  const { out: a, EZ } = await withEngine(ctx, {}, EZ => { const ids = input.lineIds || defaultLines(EZ, ctx.actor, input.tripId); const r = A.assessClaim(EZ, ctx.actor, input.tripId || null, ids, input.note); r.ids = ids; return r; });
  if (a.error) stop(a.error, 'TE_CLAIM');
  if (!a.ids.length) stop('Add at least one expense line.', 'TE_CLAIM');
  if (a.blockers.length) stop('Fix the blocked lines first.', 'TE_CLAIM', { flags: a.blockers.map(own) });
  if (a.needs.length) stop('Add a reason where one is asked.', 'TE_CLAIM', { flags: a.needs.map(own) });
  if (!input.declared) stop('Accept the declaration to submit.', 'TE_CLAIM');
  if (a.stop.length) stop(a.stop[0], 'TE_CLAIM');
  return ctx.db.rpc('te_claim_submit', { p: { employee_id: ctx.actor, trip_id: input.tripId || null, line_ids: a.ids, note: input.note || '', declared: true, assessment: a.payload }, p_actor: ctx.actor });
}
/* The employee answers a send-back. The lines were edited through expenseSave; every check runs again here. */
async function claimRespond(ctx, claimId, text) {
  const { out: a } = await withEngine(ctx, {}, EZ => { const c = EZ.claim(claimId); return c ? A.assessClaim(EZ, ctx.actor, c.tripId || null, c.lines, c.note) : { error: 'Claim not found.' }; });
  if (a.error) stop(a.error, 'TE_CLAIM');
  if (a.blockers.length) stop('Fix the blocked lines first.', 'TE_CLAIM', { flags: a.blockers.map(own) });
  if (a.needs.length) stop('Add a reason where one is asked.', 'TE_CLAIM', { flags: a.needs.map(own) });
  return ctx.db.rpc('te_claim_respond', { p_claim_id: claimId, p_actor: ctx.actor, p_text: text, p_assessment: a.payload });
}
const claimRecall = (ctx, claimId) => ctx.db.rpc('te_claim_recall', { p_claim_id: claimId, p_actor: ctx.actor });
/* o = { comment, decisions: { <line id>: { amount, reject: 'final'|'refile', reason } }, fix: [line ids] } */
const claimDecide = (ctx, claimId, action, o) => ctx.db.rpc('te_claim_decide', { p_claim_id: claimId, p_actor: ctx.actor, p_action: action, p_comment: (o && o.comment) || null, p_decisions: (o && o.decisions) || null, p_fix: (o && o.fix) || null });
const claimFinance = (ctx, claimId, action, o) => ctx.db.rpc('te_claim_finance', { p_claim_id: claimId, p_actor: ctx.actor, p_action: action, p_comment: (o && o.comment) || null, p_decisions: (o && o.decisions) || null, p_fix: (o && o.fix) || null });
const flagResolve = (ctx, flagId, status, note) => ctx.db.rpc('te_flag_resolve', { p_flag_id: flagId, p_actor: ctx.actor, p_status: status, p_note: note });
const claimReopen = (ctx, claimId, reason) => ctx.db.rpc('te_claim_reopen', { p_claim_id: claimId, p_actor: ctx.actor, p_reason: reason });

/* ---------------------------------------------------------------- money ---- */
const advanceAct = (ctx, advanceId, action, o) => ctx.db.rpc('te_advance_act', { p_advance_id: advanceId, p_actor: ctx.actor, p_action: action, p: o || {} });
const payoutCreate = (ctx, companyId, route, claimIds) => ctx.db.rpc('te_payout_create', { p_company_id: companyId, p_actor: ctx.actor, p_route: route, p_claim_ids: claimIds || null });
const payoutFile = (ctx, batchId) => ctx.db.rpc('te_payout_file', { p_batch_id: batchId, p_actor: ctx.actor });
const payoutPaid = (ctx, batchId, ref) => ctx.db.rpc('te_payout_paid', { p_batch_id: batchId, p_actor: ctx.actor, p_ref: ref });
const payoutItemFailed = (ctx, itemId, reason) => ctx.db.rpc('te_payout_item_failed', { p_item_id: itemId, p_actor: ctx.actor, p_reason: reason });
const payoutCancel = (ctx, batchId, reason) => ctx.db.rpc('te_payout_cancel', { p_batch_id: batchId, p_actor: ctx.actor, p_reason: reason });
const adjustmentAdd = (ctx, claimId, direction, amount, reason) => ctx.db.rpc('te_adjustment_add', { p_claim_id: claimId, p_actor: ctx.actor, p_direction: direction, p_amount: amount, p_reason: reason });
const adjustmentClose = (ctx, adjustmentId, action, reference) => ctx.db.rpc('te_adjustment_close', { p_adjustment_id: adjustmentId, p_actor: ctx.actor, p_action: action, p_reference: reference || null });
const periodAct = (ctx, companyId, month, action, reason) => ctx.db.rpc('te_period_act', { p_company_id: companyId, p_month: month, p_actor: ctx.actor, p_action: action, p_reason: reason || null });

/* ---------------------------------------------------------------- admin ---- */
const config = (ctx, companyId) => ctx.db.rpc('te_config', { p_company_id: companyId });
const workflowSave = (ctx, companyId, workflow, levels) => ctx.db.rpc('te_workflow_save', { p_company_id: companyId, p_workflow: workflow, p_levels: levels, p_actor: ctx.actor });
const workflowReset = (ctx, companyId, workflow) => ctx.db.rpc('te_workflow_reset', { p_company_id: companyId, p_workflow: workflow, p_actor: ctx.actor });
/* "who would approve this?" for the builder: levels = the unsaved levels, sample = { employee_id, total, scope, postFacto, exception, band } */
const workflowPreview = (ctx, companyId, workflow, levels, sample) => ctx.db.rpc('te_resolve_chain', { p_company_id: companyId, p_employee_id: sample.employee_id, p_workflow: workflow,
  p_ctx: { total: sample.total || 0, scope: sample.scope || null, postFacto: !!sample.postFacto, exception: !!sample.exception, band: sample.band || 'Low' }, p_co: sample.co || [], p_levels: levels || null });
const daily = (ctx, companyId) => ctx.db.rpc('te_daily', { p_company_id: companyId || null });

module.exports = { TeError, me, queue, tripDetail, claimDetail, placeAdd, vehicleLookup, vehicleAdd, vehicleVerify,
  tripPreview, tripSave, tripDecide, tripAnswer, tripCancel, tripRecordMissed, bookingRecord, bookingRequest, bookingCancel, bookingEmailed, stayDecide, dashboard,
  legStart, legPings, legStop, legContinue, legEnd, legPreview, legFile, legSkip, legNoGps, legAdd,
  expensePreview, expenseSave, expenseDiscard, draftSave, draftList, draftDelete,
  claimPreview, claimSubmit, claimRespond, claimRecall, claimDecide, claimFinance, flagResolve, claimReopen,
  advanceAct, payoutCreate, payoutFile, payoutPaid, payoutItemFailed, payoutCancel, adjustmentAdd, adjustmentClose, periodAct,
  config, workflowSave, workflowReset, workflowPreview, daily };
