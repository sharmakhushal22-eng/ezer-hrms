-- 148_te_functions_read.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  5 of 6: READ MODELS FOR THE APP
-- SAFE TO RUN TWICE. Run AFTER 147.
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
-- The rules engine (engine/te-engine.js) checks a plan, prices a drive and
-- raises the flags. It reads ONE JSON document, the same shape the prototype
-- keeps in memory. te_snapshot() builds that document from the tables, so:
--
--     API route                         this file            146 / 147
--     ---------                         ---------            ---------
--     snap = te_snapshot(employee)  ->  one JSON
--     engine.load(snap)
--     result = engine.assess(...)                       ->   te_claim_submit(result)
--
-- The route never maps a table row to an engine object by hand, and the engine
-- never knows a table name. One RPC in, one RPC out.
--
-- FUNCTIONS
--   te_emp_json          one employee, as the engine reads a person
--   te_ezer_context      approved leave, office punches and holidays, read from
--                        the EZER Leave, Attendance and Holiday modules
--   te_trip_json / te_leg_json / te_expense_json / te_claim_json
--   te_snapshot          everything the engine needs for ONE employee
--   te_route_put / te_route_km    the road-distance cache
--   te_queue             what is waiting for one approver or Finance person
--   te_can_view          who may open a trip or a claim
--   te_trip_detail / te_claim_detail   one screen, one call
--   te_health            is this company ready? (Admin > Setup check)
--
-- ID NOTE  The engine was written with ids like 'SRS0512' and 'off'. Here every
-- id is a uuid. The engine does not care: an id is only ever compared with
-- another id. The human numbers travel beside them as "no" / "code".
-- ============================================================================


-- ============================================================================
-- SECTION 1 — PEOPLE AND EZER CONTEXT
-- ============================================================================

create or replace function te_emp_json(p_employee_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
           'id', e.id, 'code', e.emp_code, 'name', e.full_name,
           'grade', coalesce(btrim(e.grade), ''),
           'dept', coalesce(d.dept_name, ''), 'title', coalesce(e.designation, ''),
           'base', coalesce(l.city, ''),
           'rm', o.l1, 'rm2', o.l2, 'hod', o.hod, 'md', o.md,
           'acct', case when coalesce(e.bank_account_last4, '') <> '' then 'XXXXXX' || e.bank_account_last4 else '' end,
           'ifsc', coalesce(e.ifsc_code, ''),
           'active', te_is_employee_active(e.id))
    from employees e
    left join departments d on d.id = e.department_id
    left join locations l on l.id = e.location_id
    cross join lateral te_org_chain(e.id) o
   where e.id = p_employee_id;
$$;

-- CROSS-CHECKS WITH THE REST OF EZER (checks C1, C2, C4).
--   leave     full days of APPROVED leave            leave_applications   (migration 030)
--   punch     the first OFFICE punch of a day        attendance_punches   (migration 036)
--             an office punch = inside the branch geofence, or from a device
--   holidays  published, not optional, for the       holiday_entries + holiday_applicability
--             employee's company and branch          + holiday_calendar   (migration 026)
-- Each block is skipped when its table is not on the database, so the module
-- still works where one of those modules is not installed.
create or replace function te_ezer_context(p_employee_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable as $$
declare
  v_company uuid;
  v_branch  uuid;
  v_leave   jsonb := '[]'::jsonb;
  v_punch   jsonb := '{}'::jsonb;
  v_hol     jsonb := '{}'::jsonb;
begin
  select e.company_id, e.location_id into v_company, v_branch from employees e where e.id = p_employee_id;

  if to_regclass('public.leave_applications') is not null then
    select coalesce(jsonb_agg(distinct to_char(g.d, 'YYYY-MM-DD')), '[]'::jsonb) into v_leave
      from leave_applications a
     cross join lateral generate_series(greatest(a.from_date, p_from)::timestamp, least(a.to_date, p_to)::timestamp, interval '1 day') g(d)
     where a.employee_id = p_employee_id and a.status = 'APPROVED'
       and a.from_date <= p_to and a.to_date >= p_from
       and not coalesce(a.half_day, false);
  end if;

  if to_regclass('public.attendance_punches') is not null then
    select coalesce(jsonb_object_agg(x.d, x.label), '{}'::jsonb) into v_punch
      from (select to_char(p.punch_date, 'YYYY-MM-DD') as d,
                   coalesce((select l.location_name from locations l where l.id = (array_agg(p.branch_id order by p.punch_time))[1]), 'the office')
                     || ', ' || to_char(min(p.punch_time) at time zone 'Asia/Kolkata', 'HH24:MI') as label
              from attendance_punches p
             where p.employee_id = p_employee_id and p.punch_date between p_from and p_to
               and (p.geofence_status = 'INSIDE' or coalesce(p.source, '') <> 'ESS_APP')
             group by p.punch_date) x;
  end if;

  if to_regclass('public.holiday_entries') is not null and to_regclass('public.holiday_applicability') is not null then
    select coalesce(jsonb_object_agg(x.d, x.name), '{}'::jsonb) into v_hol
      from (select to_char(h.holiday_date, 'YYYY-MM-DD') as d, min(h.description) as name
              from holiday_entries h
              join holiday_calendar c on c.id = h.calendar_id and c.status = 'PUBLISHED'
              join holiday_applicability a on a.holiday_id = h.id and a.company_id = v_company
                                          and (a.branch_id is null or a.branch_id = v_branch)
             where h.holiday_date between p_from and p_to and not coalesce(h.is_optional, false)
             group by h.holiday_date) x;
  end if;

  return jsonb_build_object('leave', v_leave, 'punch', v_punch, 'holidays', v_hol);
end;
$$;


-- ============================================================================
-- SECTION 2 — ONE RECORD AS THE ENGINE READS IT
-- ============================================================================

-- the steps of one trip or claim: [{"role","who","team","level","stage","status","by","at","comment"}]
create or replace function te_steps_json(p_entity_type text, p_entity_id uuid, p_stage text default null)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'n', s.step_no, 'role', s.role_label, 'who', coalesce(s.approver_id::text, ''),
           'whoName', case when s.team_code is not null then 'Finance team' else te_emp_name(s.approver_id) end,
           'team', coalesce(s.team_code, ''), 'level', s.level_id, 'stage', s.stage, 'status', s.status,
           'by', s.acted_by, 'byName', case when s.acted_by is not null then te_emp_name(s.acted_by) end,
           'at', s.acted_at, 'comment', coalesce(s.comment, ''), 'due', s.due_at) order by s.step_no), '[]'::jsonb)
    from te_approval_steps s
   where s.entity_type = p_entity_type and s.entity_id = p_entity_id and (p_stage is null or s.stage = p_stage);
$$;

create or replace function te_trip_json(t te_trips)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'no', t.trip_no, 'emp', t.employee_id, 'co', to_jsonb(te_trip_co(t.id)),
    'status', t.status, 'display', te_trip_status(t.id), 'origin', t.origin,
    'name', t.name, 'scope', t.scope, 'pattern', t.pattern, 'purpose', t.purpose, 'project', coalesce(t.project, ''),
    'points', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'place', p.place_id, 'pt', coalesce(p.place_type, ''), 'what', coalesce(p.what, ''),
                 'arrive', coalesce(p.arrive_on::text, ''), 'leave', coalesce(p.leave_on::text, ''),
                 'ret', case when p.is_return then true end)) order by p.seq), '[]'::jsonb)
                 from te_trip_points p where p.trip_id = t.id),
    'segs', (select coalesce(jsonb_agg(jsonb_build_object(
                 'mode', s.mode, 'bookedBy', s.booked_by, 'vehicleId', s.vehicle_id,
                 'xfer', jsonb_strip_nulls(jsonb_build_object('first', s.first_mile_mode, 'last', s.last_mile_mode,
                                                              'hubA', s.hub_from_place_id, 'hubB', s.hub_to_place_id))) order by s.seq), '[]'::jsonb)
               from te_trip_segments s where s.trip_id = t.id),
    'pax', t.pax,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', q.emp_code_entered, 'name', q.name_entered,
                                                            'emp', q.employee_id, 'found', q.found_in_ezer) order by q.seq), '[]'::jsonb)
                 from te_trip_people q where q.trip_id = t.id),
    'start', t.start_date, 'end', t.end_date,
    'from', coalesce(t.from_label, ''), 'to', coalesce(t.to_label, ''),
    'fromPlace', (select p.place_id from te_trip_points p where p.trip_id = t.id and p.seq = 0),
    'type', case when t.scope = 'international' then 'international' else 'domestic' end,
    'country', coalesce(t.country, ''),
    'estimate', t.estimate, 'estimateTotal', t.estimate_total, 'selfEstimate', t.self_estimate, 'plannedKm', t.planned_km,
    'stayBy', t.stay_by, 'advance', t.advance_requested,
    'pfReason', coalesce(t.post_facto_reason, ''), 'pfNote', coalesce(t.post_facto_note, ''),
    'legIds', (select coalesce(jsonb_agg(l.id order by l.leg_no), '[]'::jsonb) from te_legs l where l.trip_id = t.id),
    'chain', te_steps_json('trip', t.id), 'why', to_jsonb(t.chain_notes),
    'createdAt', t.created_at, 'approvedAt', t.approved_at);
$$;

-- p_track = true adds the GPS trail. It is only needed while a leg is being
-- ended; after that the engine reads the stored "stats".
create or replace function te_leg_json(l te_legs, p_track boolean default false)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', l.id, 'emp', l.employee_id, 'tripId', l.trip_id, 'n', l.leg_no, 'seg', l.segment_seq, 'kind', l.kind,
    'from', l.from_place_id, 'to', l.to_place_id, 'date', l.leg_date, 'purpose', coalesce(l.purpose, ''),
    'why', (select t.name from te_trips t where t.id = l.trip_id),
    'mode', l.mode, 'vehicleId', l.vehicle_id, 'bookedBy', l.booked_by, 'gps', l.gps_mode, 'plannedKm', l.planned_km,
    'status', l.status, 'startedAt', l.started_at, 'endedAt', l.ended_at, 'filedAt', l.filed_at,
    'manual', l.is_manual, 'noGps', coalesce(l.no_gps_reason, ''), 'skipReason', coalesce(l.skip_reason, ''),
    'addedWhy', coalesce(l.added_reason, ''), 'expenseId', l.expense_id,
    'stats', l.stats, 'gpsKm', l.gps_km, 'routeKm', l.route_km, 'payKm', l.payable_km,
    'track', case when p_track then
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'lat', g.lat, 'lng', g.lng,
                         't', greatest(0, round(extract(epoch from (g.recorded_at - l.started_at))))::int,
                         'sp', coalesce(g.speed_kmh, 0), 'acc', coalesce(g.accuracy_m, 0),
                         'fake', coalesce(g.is_mock, false)) order by g.recorded_at, g.seq), '[]'::jsonb)
                  from te_leg_pings g where g.leg_id = l.id)
             else '[]'::jsonb end,
    'shown', 0,
    'stops', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'n', s.seq,
                -- the trail point the stop was made at
                'i', greatest(0, (select count(*) from te_leg_pings g where g.leg_id = l.id and g.recorded_at <= s.started_at) - 1),
                't', greatest(0, round(extract(epoch from (s.started_at - l.started_at))))::int,
                'lat', s.lat, 'lng', s.lng, 'acc', coalesce(s.accuracy_m, 0),
                'name', coalesce(s.place_name, 'a point on the way'), 'addr', coalesce(s.address, ''),
                'reason', s.reason_code, 'biz', s.is_business, 'note', coalesce(s.note, ''),
                'dwell', s.minutes, 'at', s.started_at) order by s.seq), '[]'::jsonb)
                from te_leg_stops s where s.leg_id = l.id),
    'checkin', jsonb_strip_nulls(jsonb_build_object(
       'start', case when l.started_at is not null then jsonb_build_object('at', l.started_at, 'lat', l.start_lat, 'lng', l.start_lng,
                     'acc', l.start_accuracy_m, 'addr', coalesce(l.start_address, ''), 'off', l.start_off_m) end,
       'end',   case when l.end_lat is not null then jsonb_build_object('at', l.ended_at, 'lat', l.end_lat, 'lng', l.end_lng,
                     'acc', l.end_accuracy_m, 'addr', coalesce(l.end_address, ''), 'off', l.end_off_m) end)),
    'history', '[]'::jsonb);
$$;

create or replace function te_expense_json(x te_expenses)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', x.id, 'no', x.expense_no, 'emp', x.employee_id, 'tripId', x.trip_id, 'legId', x.leg_id,
    -- a line that is the report of a leg carries journeyId; a ticket the Travel Desk booked does not
    'journeyId', case when x.paid_by = 'self' then x.leg_id end,
    'cat', x.category_code, 'date', x.expense_date, 'checkIn', x.check_in, 'checkOut', x.check_out,
    'merchant', coalesce(x.merchant, ''), 'gstin', coalesce(x.merchant_gstin, ''), 'billNo', coalesce(x.bill_no, ''),
    'pnr', case when x.category_code in ('air','train','bus') then coalesce(x.reference, '') else '' end,
    'ref', case when x.category_code in ('air','train','bus') then '' else coalesce(x.reference, '') end,
    'cls', coalesce(x.travel_class, ''),
    'bill', x.bill_amount, 'claimed', x.claimed_amount, 'eligible', x.eligible_amount, 'approved', x.approved_amount,
    'pay', x.paid_by, 'payMode', coalesce(x.payment_mode, ''), 'desc', coalesce(x.description, ''),
    'reason', coalesce(x.employee_reason, ''), 'wantException', x.wants_exception, 'dreason', coalesce(x.decision_reason, ''),
    'vehicleId', x.vehicle_id, 'from', x.from_place_id, 'to', x.to_place_id,
    'payKm', x.payable_km, 'rate', x.rate_applied, 'km', nullif(x.details->>'km', '')::numeric,
    'client', coalesce(x.client_name, ''), 'attendees', x.attendees,
    'shared', coalesce((x.details->>'shared')::boolean, false),
    'curr', case when x.currency <> 'INR' then x.currency else '' end, 'fxAmt', coalesce(x.fx_amount, 0), 'fxRate', coalesce(x.fx_rate, 0),
    -- a line the Travel Desk booked is its own proof: the booking stands in for the bill
    'file', coalesce((select jsonb_strip_nulls(jsonb_build_object(
                      'id', f.id, 'name', coalesce(f.file_name, 'bill'), 'path', f.storage_path, 'kind', f.kind,
                      'sha', f.sha256, 'phash', f.phash,
                      'ocrAmount', nullif(f.ocr->>'amount', '')::numeric, 'text', f.ocr->>'text',
                      'editedWith', f.metadata->>'software', 'producer', f.metadata->>'producer'))
               from te_expense_files f where f.expense_id = x.id order by f.uploaded_at, f.id limit 1),
             (select jsonb_build_object('name', b.booking_no || '-ticket', 'sha', 'bk-' || b.id::text, 'path', coalesce(b.ticket_url, ''), 'booking', true)
                from te_bookings b where b.id = x.booking_id)),
    'files', (select count(*) from te_expense_files f where f.expense_id = x.id),
    'status', x.status, 'claimId', x.claim_id,
    'claimNo', (select c.claim_no from te_claims c where c.id = x.claim_id),
    'fix', x.needs_fix, 'lstatus', x.line_decision, 'details', x.details);
$$;

-- p_owner_view = true: the claimant is reading. A flag whose evidence names a
-- colleague shows the wording written for the claimant instead.
drop function if exists te_claim_json(te_claims);
create or replace function te_claim_json(c te_claims, p_owner_view boolean default false)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'no', c.claim_no, 'emp', c.employee_id, 'tripId', c.trip_id, 'type', c.claim_type, 'seq', c.claim_seq,
    'period', (select to_char(p.period_month, 'YYYY-MM') from travel_periods p where p.id = c.period_id),
    'late', c.is_late, 'note', coalesce(c.note, ''),
    'lines', (select coalesce(jsonb_agg(x.id order by x.expense_date, x.expense_no), '[]'::jsonb) from te_expenses x where x.claim_id = c.id),
    'claimed', c.claimed_total, 'eligible', c.eligible_total, 'approved', c.approved_total,
    'advanceAdjusted', c.advance_adjusted, 'net', c.net_amount,
    'flags', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', f.id, 'status', f.status, 'lineId', f.expense_id, 'code', f.check_code, 'title', f.title,
                'evidence', coalesce(case when p_owner_view then f.evidence_employee end, f.evidence, ''),
                'action', f.action, 'sev', nullif(f.severity, ''),
                'block', f.is_blocking, 'needsReason', f.needs_reason, 'claimLevel', f.expense_id is null,
                'note', coalesce(f.resolve_reason, '')) order by f.created_at, f.id), '[]'::jsonb)
                from te_flags f where f.claim_id = c.id and f.is_current),
    'score', c.risk_score, 'band', c.risk_band, 'exception', c.is_exception, 'postFacto', c.is_post_facto,
    'stage', c.stage, 'status', c.status, 'fixAll', c.fix_all, 'sentFrom', c.sent_back_from,
    'rejectedFrom', c.rejected_from, 'rejectReason', coalesce(c.reject_reason, ''),
    'autoVerified', c.auto_verified, 'sampled', c.sampled,
    'chain', te_steps_json('claim', c.id, 'manager'), 'fin', te_steps_json('claim', c.id, 'finance'),
    'why', to_jsonb(c.chain_notes), 'submittedAt', c.submitted_at, 'verifiedAt', c.verified_at,
    'settledAt', c.settled_at, 'paidRef', coalesce(c.paid_ref, ''));
$$;


-- ============================================================================
-- SECTION 3 — THE ROAD-DISTANCE CACHE
-- ============================================================================

-- Store what the map provider returned for a pair of places.
create or replace function te_route_put(p_from uuid, p_to uuid, p_km numeric, p_minutes int default null,
                                        p_polyline text default null, p_provider text default 'google')
returns void language plpgsql as $$
declare
  v_company uuid;
begin
  select company_id into v_company from te_places where id = p_from;
  if v_company is null or not exists (select 1 from te_places where id = p_to and company_id = v_company) then
    perform te_fail('TE_PLACE', 'Both places must belong to the same company.');
  end if;
  insert into te_routes (company_id, from_place_id, to_place_id, km, minutes, polyline, provider)
  values (v_company, p_from, p_to, round(p_km, 1), p_minutes, p_polyline, coalesce(p_provider, 'google'))
  on conflict (from_place_id, to_place_id) do update
     set km = excluded.km, minutes = excluded.minutes, polyline = excluded.polyline,
         provider = excluded.provider, fetched_at = now();
end;
$$;

-- The stored road distance for a pair, either way round. Null = not asked yet.
create or replace function te_route_km(p_from uuid, p_to uuid)
returns numeric language sql stable as $$
  select r.km from te_routes r
   where (r.from_place_id = p_from and r.to_place_id = p_to) or (r.from_place_id = p_to and r.to_place_id = p_from)
   order by (r.from_place_id = p_from) desc limit 1;
$$;


-- ============================================================================
-- SECTION 4 — THE SNAPSHOT
-- ============================================================================

-- Everything the rules engine needs to work for ONE employee.
--
-- p_opts (all optional)
--   "days"    how far back to read. Default 400: a bill can be 90 days old, a
--             quarter of post-facto trips is counted, and a year of hotel
--             stays is checked for overlap.
--   "leg_id"  add the GPS trail of this leg (needed only to end it)
--   "codes"   employee codes typed in a form ("who travels with you"), so the
--             engine can say whether each one exists in EZER
--   "places"  place ids used in a draft, so their road distances are included
--   "probe"   draft lines that are not saved yet, so the duplicate checks can
--             look for them in OTHER employees' claims:
--             [{"sha","phash","bill_no","reference","date","bill"}]
--
-- WHAT IS IN IT
--   the employee's own trips, legs, expense lines, claims, advances, vehicles
--   and places · the company's settings and masters · the people the engine
--   may name (managers, co-travellers, Finance) · leave, punches and holidays
--   · the few lines of OTHER employees that could be duplicates of this
--   employee's lines, and nothing else of theirs.
create or replace function te_snapshot(p_employee_id uuid, p_opts jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable as $$
declare
  o         jsonb := coalesce(p_opts, '{}'::jsonb);
  v_company uuid;
  v_today   date;
  v_since   date;
  v_leg     uuid := nullif(o->>'leg_id', '')::uuid;
  v_trip_ids uuid[];
  v_trips   jsonb; v_legs jsonb; v_exp jsonb; v_other jsonb; v_claims jsonb;
  v_emp_ids uuid[]; v_emp jsonb; v_codes jsonb;
  v_place_ids uuid[];
  v_routes  jsonb;
  v_ctx     jsonb;
  v_cfg     jsonb;
  v_chain   record;
begin
  select e.company_id into v_company from employees e where e.id = p_employee_id;
  if not found then
    perform te_fail('TE_FORBIDDEN', 'Employee not found.');
  end if;
  v_today := te_today(v_company);
  v_since := v_today - coalesce(nullif(o->>'days', '')::int, 400);
  v_cfg   := te_config(v_company);

  -- ---- trips and legs ---------------------------------------------------------
  select coalesce(array_agg(t.id), '{}') into v_trip_ids
    from te_trips t
   where t.employee_id = p_employee_id
     and (t.end_date >= v_since or t.status in ('DRAFT','PENDING_APPROVAL','SENT_BACK','APPROVED','CLAIMED'));

  select coalesce(jsonb_agg(te_trip_json(t) order by t.created_at desc), '[]'::jsonb) into v_trips
    from te_trips t where t.id = any (v_trip_ids);
  select coalesce(jsonb_agg(te_leg_json(l, l.id = v_leg or (l.status in ('ACTIVE','PAUSED'))) order by l.trip_id, l.leg_no), '[]'::jsonb) into v_legs
    from te_legs l where l.trip_id = any (v_trip_ids);

  -- ---- the employee's own lines and claims --------------------------------------
  select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb) into v_exp
    from te_expenses x
   where x.employee_id = p_employee_id
     and (x.expense_date >= v_since or x.status in ('UNCLAIMED','IN_CLAIM') or x.trip_id = any (v_trip_ids));

  select coalesce(jsonb_agg(te_claim_json(c, true) order by c.created_at desc), '[]'::jsonb) into v_claims
    from te_claims c
   where c.employee_id = p_employee_id
     and (c.created_at >= v_since or c.status not in ('SETTLED','REJECTED','CANCELLED'));

  -- ---- lines of OTHER employees that could be duplicates (checks B1, B2, B3, B5, B6) ----
  with mine as (
    select f.sha256 as sha, f.phash,
           upper(regexp_replace(coalesce(x.bill_no, ''), '[^A-Za-z0-9]', '', 'g')) as bill_no,
           coalesce(x.reference, '') as reference, x.expense_date as d, x.bill_amount as bill
      from te_expenses x
      left join te_expense_files f on f.expense_id = x.id
      left join te_claims c on c.id = x.claim_id
     where x.employee_id = p_employee_id and (x.status = 'UNCLAIMED' or (x.status = 'IN_CLAIM' and c.status = 'SENT_BACK'))
    union all
    select nullif(p->>'sha', ''), nullif(p->>'phash', ''),
           upper(regexp_replace(coalesce(p->>'bill_no', ''), '[^A-Za-z0-9]', '', 'g')),
           upper(coalesce(p->>'reference', '')), nullif(p->>'date', '')::date, nullif(p->>'bill', '')::numeric
      from jsonb_array_elements(case when jsonb_typeof(o->'probe') = 'array' then o->'probe' else '[]'::jsonb end) p
  ),
  hit as (
    select distinct x.id
      from te_expenses x
      left join te_expense_files f on f.expense_id = x.id
      join mine m on (m.sha is not null and f.sha256 = m.sha)
                  or (m.phash is not null and f.phash = m.phash)
                  or (m.bill_no <> '' and upper(regexp_replace(coalesce(x.bill_no, ''), '[^A-Za-z0-9]', '', 'g')) = m.bill_no)
                  or (m.reference <> '' and x.reference = m.reference)
                  or (m.d is not null and m.bill > 0 and x.expense_date = m.d and x.bill_amount = m.bill)
     where x.company_id = v_company and x.employee_id <> p_employee_id
       and x.status not in ('REJECTED_REFILE','EXPIRED','DISCARDED')
     limit 200
  )
  -- Of a colleague's line the engine gets only what the duplicate checks
  -- compare: never the description, the route, the vehicle or the details.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'no', x.expense_no, 'emp', x.employee_id, 'other', true,
           'cat', x.category_code, 'date', x.expense_date, 'merchant', coalesce(x.merchant, ''),
           'gstin', coalesce(x.merchant_gstin, ''), 'billNo', coalesce(x.bill_no, ''),
           'pnr', case when x.category_code in ('air','train','bus') then coalesce(x.reference, '') else '' end,
           'ref', case when x.category_code in ('air','train','bus') then '' else coalesce(x.reference, '') end,
           'bill', x.bill_amount, 'claimed', x.claimed_amount, 'pay', x.paid_by, 'status', x.status,
           'claimId', x.claim_id, 'claimNo', (select c.claim_no from te_claims c where c.id = x.claim_id),
           'file', (select jsonb_strip_nulls(jsonb_build_object('sha', f.sha256, 'phash', f.phash))
                      from te_expense_files f where f.expense_id = x.id order by f.uploaded_at, f.id limit 1))), '[]'::jsonb) into v_other
    from te_expenses x join hit on hit.id = x.id;

  -- ---- people the engine may name ---------------------------------------------------
  select * into v_chain from te_org_chain(p_employee_id);
  select coalesce(jsonb_object_agg(upper(e.emp_code), e.id), '{}'::jsonb) into v_codes
    from employees e
   where e.company_id = v_company
     and upper(e.emp_code) in (
           select upper(q.emp_code_entered) from te_trip_people q where q.trip_id = any (v_trip_ids)
           union
           select upper(c) from jsonb_array_elements_text(case when jsonb_typeof(o->'codes') = 'array' then o->'codes' else '[]'::jsonb end) c);

  select array_agg(distinct i) into v_emp_ids from (
    select p_employee_id as i
    union select v_chain.l1 union select v_chain.l2 union select v_chain.hod union select v_chain.md
    union select (select l1 from te_org_chain(v_chain.l1))
    union select unnest(te_finance_members(v_company))
    union select (v_cfg->>'fallback')::uuid
    union select q.employee_id from te_trip_people q where q.trip_id = any (v_trip_ids)
    union select (e.value)::uuid from jsonb_each_text(v_codes) e
    union select (x->>'emp')::uuid from jsonb_array_elements(v_other) x
    union select s.approver_id from te_approval_steps s
           where (s.entity_type = 'trip' and s.entity_id = any (v_trip_ids))
              or (s.entity_type = 'claim' and s.entity_id in (select c.id from te_claims c where c.employee_id = p_employee_id))
    union select nullif(l->>'person', '')::uuid
            from jsonb_array_elements(v_cfg->'flows'->'claim'->'levels' || (v_cfg->'flows'->'trip'->'levels')) l
  ) z where i is not null;
  select coalesce(jsonb_object_agg(i::text, te_emp_json(i)), '{}'::jsonb) into v_emp from unnest(v_emp_ids) i;

  -- ---- road distances for the places in play ----------------------------------------
  select array_agg(distinct i) into v_place_ids from (
    select p.place_id as i from te_trip_points p where p.trip_id = any (v_trip_ids)
    union select l.from_place_id from te_legs l where l.trip_id = any (v_trip_ids)
    union select l.to_place_id from te_legs l where l.trip_id = any (v_trip_ids)
    union select x.from_place_id from te_expenses x where x.employee_id = p_employee_id and x.status in ('UNCLAIMED','IN_CLAIM')
    union select x.to_place_id from te_expenses x where x.employee_id = p_employee_id and x.status in ('UNCLAIMED','IN_CLAIM')
    union select c::uuid from jsonb_array_elements_text(case when jsonb_typeof(o->'places') = 'array' then o->'places' else '[]'::jsonb end) c
  ) z where i is not null;
  select coalesce(jsonb_object_agg(r.from_place_id::text || '|' || r.to_place_id::text, r.km), '{}'::jsonb) into v_routes
    from te_routes r
   where r.from_place_id = any (v_place_ids) and r.to_place_id = any (v_place_ids);

  v_ctx := te_ezer_context(p_employee_id, v_since, v_today + 400);

  return jsonb_build_object(
    'today', v_today, 'me', p_employee_id, 'company', v_company,
    'cfg', v_cfg, 'masters', te_masters(v_company, p_employee_id),
    'emp', v_emp, 'codes', v_codes,
    'leave', jsonb_build_object(p_employee_id::text, v_ctx->'leave'),
    'punch', jsonb_build_object(p_employee_id::text, v_ctx->'punch'),
    'holidays', v_ctx->'holidays',
    'routes', v_routes,
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', v.id, 'emp', v.employee_id, 'type', v.vehicle_type_code, 'declared', coalesce(v.declared_type_code, ''),
                    'reg', v.reg_no, 'rc', v.rc, 'whose', v.ownership, 'photo', v.rc_file_url is not null,
                    'verified', v.is_verified, 'vby', coalesce(v.verified_via, ''), 'added', v.created_at::date) order by v.created_at), '[]'::jsonb)
                   from te_employee_vehicles v where v.employee_id = p_employee_id and v.is_active),
    'trips', v_trips, 'journeys', v_legs,
    'expenses', v_exp || v_other, 'claims', v_claims,
    'advances', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'no', a.advance_no, 'tripId', a.trip_id, 'emp', a.employee_id, 'requested', a.requested_amount,
                    'approved', a.approved_amount, 'outstanding', a.outstanding_amount, 'status', a.status,
                    'display', te_advance_status(a.id), 'due', a.due_date, 'paidOn', a.paid_on, 'ref', coalesce(a.payment_ref, '')) order by a.created_at desc), '[]'::jsonb)
                   from te_advances a where a.employee_id = p_employee_id),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', b.id, 'no', b.booking_no, 'tripId', b.trip_id,
                    'tripNo', (select t.trip_no from te_trips t where t.id = b.trip_id),
                    'legId', b.leg_id, 'pointIdx', b.point_seq, 'kind', b.kind,
                    'vendor', b.vendor, 'pnr', b.reference, 'amount', b.amount, 'paidBy', b.paid_by, 'status', b.status,
                    'at', b.booked_at) order by b.booked_at desc), '[]'::jsonb)
                   -- every company-paid booking of the company whose reference one of my lines could repeat (check B7)
                   from te_bookings b
                  where b.trip_id = any (v_trip_ids)
                     or (b.company_id = v_company and b.reference in (
                           select x.reference from te_expenses x where x.employee_id = p_employee_id and x.reference is not null
                           union select upper(p->>'reference') from jsonb_array_elements(case when jsonb_typeof(o->'probe') = 'array' then o->'probe' else '[]'::jsonb end) p))),
    'periods', (select coalesce(jsonb_agg(jsonb_build_object('m', to_char(p.period_month, 'YYYY-MM'), 'status', p.status, 'label', p.period_label)
                                          order by p.period_month), '[]'::jsonb)
                  from travel_periods p where p.company_id = v_company and p.period_month >= (v_since - 62)),
    'batches', '[]'::jsonb, 'settlements', '[]'::jsonb, 'audit', '[]'::jsonb
  );
end;
$$;


-- ============================================================================
-- SECTION 5 — QUEUES AND ACCESS
-- ============================================================================

-- What is waiting for this person right now: trips and claims whose current
-- step is theirs (or their delegator's), and Finance team steps when they are
-- in the team. The four-eyes rules are applied, so a row in this list is a row
-- the person can act on.
create or replace function te_queue(p_actor uuid)
returns setof v_te_pending_approvals language sql stable as $$
  select q.*
    from v_te_pending_approvals q
   where q.employee_id <> p_actor
     and (q.approver_id = p_actor or q.effective_approver_id = p_actor
          or (q.team_code is not null and p_actor = any (te_finance_members(q.company_id))))
     and te_step_block_reason((select s from te_approval_steps s where s.id = q.step_id), p_actor) = ''
   order by q.waiting_since;
$$;

-- May this person open this trip or claim?
--   the employee it belongs to · anyone on its approval chain (or their live
--   delegate) · a member of the company's Finance team.
-- An admin or HR user is let in by the API through the role permission, not here.
create or replace function te_can_view(p_entity_type text, p_entity_id uuid, p_actor uuid)
returns boolean language plpgsql stable as $$
declare
  v_owner   uuid;
  v_company uuid;
begin
  if p_entity_type = 'trip' then
    select t.employee_id, t.company_id into v_owner, v_company from te_trips t where t.id = p_entity_id;
  elsif p_entity_type = 'claim' then
    select c.employee_id, c.company_id into v_owner, v_company from te_claims c where c.id = p_entity_id;
  end if;
  if v_owner is null then
    return false;
  end if;
  if v_owner = p_actor or p_actor = any (te_finance_members(v_company)) then
    return true;
  end if;
  if exists (select 1 from te_approval_steps s
              where s.entity_type = p_entity_type and s.entity_id = p_entity_id
                and (s.approver_id = p_actor or s.acted_by = p_actor or te_effective_approver(s.approver_id) = p_actor)) then
    return true;
  end if;
  -- the approver of a trip may open the claims of that trip, and the other way round
  if p_entity_type = 'claim' then
    return exists (select 1 from te_claims c join te_approval_steps s on s.entity_type = 'trip' and s.entity_id = c.trip_id
                    where c.id = p_entity_id and (s.approver_id = p_actor or s.acted_by = p_actor));
  end if;
  return exists (select 1 from te_claims c join te_approval_steps s on s.entity_type = 'claim' and s.entity_id = c.id
                  where c.trip_id = p_entity_id and (s.approver_id = p_actor or s.acted_by = p_actor));
end;
$$;

-- the timeline of one record, newest first
create or replace function te_timeline(p_entity_type text, p_entity_id uuid, p_staff boolean default false)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', a.at, 'who', a.actor_id, 'name', te_emp_name(a.actor_id), 'role', a.actor_role,
           'action', a.action, 'text', a.summary, 'internal', not a.employee_visible) order by a.at desc, a.id desc), '[]'::jsonb)
    from te_audit_log a
   where a.entity_type = p_entity_type and a.entity_id = p_entity_id and (a.employee_visible or p_staff);
$$;

-- ONE TRIP, EVERYTHING ON IT.  p_admin = the API already checked a role permission.
create or replace function te_trip_detail(p_trip_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql stable as $$
declare
  t       te_trips;
  v_staff boolean;
begin
  select * into t from te_trips where id = p_trip_id;
  if not found or not (coalesce(p_admin, false) or te_can_view('trip', p_trip_id, p_actor)) then
    perform te_fail('TE_FORBIDDEN', 'You cannot open this trip.');
  end if;
  v_staff := coalesce(p_admin, false) or p_actor = any (te_finance_members(t.company_id));
  return jsonb_build_object(
    'trip', te_trip_json(t),
    'employee', te_emp_json(t.employee_id),
    'places', (select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
                 's', p.short_name, 'name', coalesce(p.name, p.short_name), 'addr', p.address, 'city', p.city,
                 'country', p.country, 'pt', p.place_type, 'lat', p.lat, 'lng', p.lng)), '{}'::jsonb)
                 from te_places p
                where p.id in (select place_id from te_trip_points where trip_id = t.id
                               union select from_place_id from te_legs where trip_id = t.id
                               union select to_place_id from te_legs where trip_id = t.id)),
    'legs', (select coalesce(jsonb_agg(te_leg_json(l, false) || jsonb_build_object('history', te_timeline('leg', l.id, v_staff)) order by l.leg_no), '[]'::jsonb)
               from te_legs l where l.trip_id = t.id),
    'expenses', (select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb)
                   from te_expenses x where x.trip_id = t.id and x.status <> 'DISCARDED'),
    'claims', (select coalesce(jsonb_agg(te_claim_json(c, not v_staff and p_actor = c.employee_id) order by c.claim_seq), '[]'::jsonb) from te_claims c where c.trip_id = t.id),
    'advance', (select jsonb_build_object('id', a.id, 'no', a.advance_no, 'requested', a.requested_amount, 'approved', a.approved_amount,
                                          'outstanding', a.outstanding_amount, 'status', a.status, 'display', te_advance_status(a.id),
                                          'due', a.due_date, 'ref', coalesce(a.payment_ref, ''))
                  from te_advances a where a.trip_id = t.id and a.status not in ('REJECTED','CANCELLED') limit 1),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'no', b.booking_no, 'legId', b.leg_id, 'pointIdx', b.point_seq,
                                 'kind', b.kind, 'vendor', b.vendor, 'pnr', b.reference, 'amount', b.amount, 'status', b.status,
                                 'ticket', b.ticket_url, 'at', b.booked_at) order by b.booked_at), '[]'::jsonb)
                   from te_bookings b where b.trip_id = t.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('who', m.author_id, 'name', te_emp_name(m.author_id), 'text', m.body, 'at', m.created_at)
                                           order by m.created_at), '[]'::jsonb)
                   from te_messages m where m.entity_type = 'trip' and m.entity_id = t.id),
    'timeline', te_timeline('trip', t.id, v_staff),
    'policy', t.policy_snapshot,
    'can', jsonb_build_object(
       'act', te_step_block_reason(te_current_step('trip', t.id), p_actor) = '' and t.status = 'PENDING_APPROVAL' and p_actor <> t.employee_id,
       'why', case when t.status = 'PENDING_APPROVAL' then te_step_block_reason(te_current_step('trip', t.id), p_actor) else '' end,
       'own', p_actor = t.employee_id)
  );
end;
$$;

-- ONE CLAIM, EVERYTHING ON IT.
create or replace function te_claim_detail(p_claim_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql stable as $$
declare
  c       te_claims;
  t       te_trips;
  st      te_approval_steps;
  v_staff boolean;
  v_why   text := '';
begin
  select * into c from te_claims where id = p_claim_id;
  if not found or not (coalesce(p_admin, false) or te_can_view('claim', p_claim_id, p_actor)) then
    perform te_fail('TE_FORBIDDEN', 'You cannot open this claim.');
  end if;
  v_staff := coalesce(p_admin, false) or p_actor = any (te_finance_members(c.company_id));
  select * into t from te_trips where id = c.trip_id;
  if c.status in ('IN_APPROVAL','IN_VERIFICATION','ON_HOLD') then
    st := te_current_step('claim', c.id, case when c.status = 'IN_APPROVAL' then 'manager' else 'finance' end);
    v_why := case when p_actor = c.employee_id then 'Nobody acts on their own claim.' else te_step_block_reason(st, p_actor) end;
  end if;
  return jsonb_build_object(
    'claim', te_claim_json(c, p_actor = c.employee_id and not coalesce(p_admin, false)),
    'employee', te_emp_json(c.employee_id),
    'trip', case when t.id is not null then te_trip_json(t) end,
    'lines', (select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb)
                from te_expenses x where x.claim_id = c.id or (c.trip_id is not null and x.trip_id = c.trip_id and x.paid_by = 'company')),
    'legs', case when t.id is not null then
              (select coalesce(jsonb_agg(te_leg_json(l, false) order by l.leg_no), '[]'::jsonb) from te_legs l where l.trip_id = t.id)
            else '[]'::jsonb end,
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('line', d.expense_id, 'by', d.decided_by, 'name', te_emp_name(d.decided_by),
                                  'decision', d.decision, 'before', d.amount_before, 'after', d.amount_after, 'reason', d.reason, 'at', d.created_at)
                                  order by d.created_at), '[]'::jsonb)
                    from te_line_decisions d where d.claim_id = c.id),
    'advance', (select jsonb_build_object('id', a.id, 'no', a.advance_no, 'approved', a.approved_amount, 'outstanding', a.outstanding_amount,
                                          'status', a.status, 'due', a.due_date)
                  from te_advances a where a.trip_id = c.trip_id and a.status not in ('REJECTED','CANCELLED') limit 1),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('who', m.author_id, 'name', te_emp_name(m.author_id), 'text', m.body, 'at', m.created_at)
                                           order by m.created_at), '[]'::jsonb)
                   from te_messages m where m.entity_type = 'claim' and m.entity_id = c.id),
    'timeline', te_timeline('claim', c.id, v_staff),
    'can', jsonb_build_object(
       'act', st.id is not null and v_why = '', 'why', v_why, 'stage', st.stage, 'role', st.role_label,
       'own', p_actor = c.employee_id, 'staff', v_staff)
  );
end;
$$;


-- ============================================================================
-- SECTION 6 — SETUP CHECK
-- ============================================================================

-- IS THIS COMPANY READY TO USE TRAVEL AND EXPENSES?  Read-only. One row per
-- check: ok / warn / fail and what to do. Run it after the migrations
-- (database/tests/verify.sql does), and show it on Admin > Setup check.
--   select * from te_health();                    -- every company
--   select * from te_health('<company uuid>');
create or replace function te_health(p_company_id uuid default null)
returns table (company text, area text, item text, status text, detail text)
language plpgsql stable as $$
declare
  c record;
  n int; m int;
  v_txt text;
begin
  for c in select k.id, coalesce(k.company_name, k.id::text) as name from companies k
            where p_company_id is null or k.id = p_company_id order by 2 loop
    company := c.name;

    area := 'Setup'; item := 'Settings and masters';
    if not exists (select 1 from te_settings s where s.company_id = c.id) then
      status := 'fail'; detail := 'Not seeded. Run: select te_seed_company(''' || c.id || ''');'; return next; continue;
    end if;
    select count(*) into n from te_checks k where k.company_id = c.id;
    select count(*) into m from te_modes k where k.company_id = c.id;
    status := case when n = 55 and m >= 1 then 'ok' else 'fail' end;
    detail := n || ' checks, ' || m || ' transport modes, '
              || (select count(*) from te_categories k where k.company_id = c.id) || ' categories, '
              || (select count(*) from te_vehicle_types k where k.company_id = c.id) || ' vehicle types';
    return next;

    item := 'Places';
    select count(*) filter (where p.source = 'company'), count(*) filter (where p.source = 'hub') into n, m
      from te_places p where p.company_id = c.id and p.owner_employee_id is null and p.is_active;
    status := case when n > 0 then 'ok' else 'warn' end;
    detail := n || ' company sites, ' || m || ' airports and stations.'
              || case when n = 0 then ' No office has coordinates in the locations master: add latitude and longitude, then run te_seed_company again.' else '' end;
    return next;
    if to_regclass('public.locations') is not null then
      select count(*) into n from locations l where l.company_id = c.id and (l.latitude is null or l.longitude is null) and coalesce(l.status, 'Active') = 'Active';
      if n > 0 then
        item := 'Locations without coordinates'; status := 'warn';
        detail := n || ' active locations have no latitude and longitude, so they are not offered as a start or end point.'; return next;
      end if;
    end if;

    area := 'Approvals'; item := 'Claim workflow';
    select count(*), count(*) filter (where l.kind = 'finance') into n, m
      from te_workflows w join te_workflow_levels l on l.workflow_id = w.id where w.company_id = c.id and w.code = 'claim';
    status := case when m >= 1 then 'ok' else 'fail' end;
    detail := n || ' levels, ' || m || ' of them Finance.' || case when m = 0 then ' A claim workflow needs a Finance level.' else '' end;
    return next;
    item := 'Trip workflow';
    select count(*) into n from te_workflows w join te_workflow_levels l on l.workflow_id = w.id where w.company_id = c.id and w.code = 'trip';
    status := case when n >= 1 then 'ok' else 'fail' end; detail := n || ' levels.'; return next;

    item := 'Finance team';
    n := cardinality(te_finance_members(c.id));
    select count(*) into m from finance_team f where f.company_id = c.id and f.is_active and f.can_disburse;
    status := case when n = 0 then 'fail' when n = 1 or m = 0 then 'warn' else 'ok' end;
    detail := n || case when n = 1 then ' person' else ' people' end || ' can verify, ' || m || ' can release payments.'
              || case when n = 0 then ' Nobody can verify a claim: add people on the Finance team screen.'
                      when n = 1 then ' With one person, that person''s own claims go to the fallback approver.'
                      when m = 0 then ' Nobody is marked as able to pay, so every member who can verify may also pay.' else '' end;
    return next;

    item := 'Fallback approver';
    select te_emp_name(s.fallback_approver_id) into v_txt from te_settings s where s.company_id = c.id and s.fallback_approver_id is not null;
    status := case when v_txt is null then 'fail' when not te_is_employee_active((select s.fallback_approver_id from te_settings s where s.company_id = c.id)) then 'fail' else 'ok' end;
    detail := coalesce(v_txt, 'Not set. A level nobody fills has nowhere to go: set it on Admin > Approval workflow.'); return next;

    item := 'Finance deadlock';
    v_txt := te_finance_deadlock(c.id);
    status := case when v_txt is null then 'ok' else 'fail' end; detail := coalesce(v_txt, 'None.'); return next;

    area := 'People'; item := 'Employees without a reporting manager';
    select count(*) into n from employees e
     where e.company_id = c.id and coalesce(e.employment_status, 'Active') = 'Active' and te_is_employee_active(e.id)
       and (select o.l1 from te_org_chain(e.id) o) is null
       and e.id is distinct from (select k.md_employee_id from companies k where k.id = c.id);
    status := case when n = 0 then 'ok' else 'warn' end;
    detail := case when n = 0 then 'Every active employee has one.'
                   else n || ' active employees have no R1. Their trips and claims go to the fallback approver.' end; return next;

    item := 'Employees without a head of department';
    select count(*) into n from employees e
     where e.company_id = c.id and coalesce(e.employment_status, 'Active') = 'Active' and te_is_employee_active(e.id)
       and (select o.hod from te_org_chain(e.id) o) is null
       and e.id is distinct from (select k.md_employee_id from companies k where k.id = c.id);
    status := case when n = 0 then 'ok' else 'warn' end;
    detail := case when n = 0 then 'Every active employee has one.'
                   else n || ' active employees have no HOD (set departments.hod_employee_id). An HOD level for them goes to the fallback approver.' end; return next;

    item := 'Grades without limits';
    select count(*), string_agg(distinct coalesce(nullif(btrim(e.grade), ''), '(blank)'), ', ') into n, v_txt
      from employees e
     where e.company_id = c.id and coalesce(e.employment_status, 'Active') = 'Active'
       and not exists (select 1 from te_grade_limits g where g.company_id = c.id and g.grade = btrim(coalesce(e.grade, '')));
    status := case when n = 0 then 'ok' else 'warn' end;
    detail := case when n = 0 then 'Every grade in use has its own limits.'
                   else n || ' employees use the DEFAULT limits because their grade has none: ' || v_txt || '. Add those grades on Admin > Limits.' end;
    return next;

    area := 'Money'; item := 'Expense months';
    select count(*) into n from travel_periods p where p.company_id = c.id and p.status = 'OPEN';
    status := case when n >= 1 then 'ok' else 'fail' end;
    detail := n || ' open.' || case when n = 0 then ' No month is open, so no claim can be filed. The nightly job opens this month and the next.' else '' end; return next;

    item := 'Employees without bank details';
    select count(*) into n from employees e
     where e.company_id = c.id and coalesce(e.employment_status, 'Active') = 'Active'
       and (coalesce(e.bank_account_number, '') = '' or coalesce(e.ifsc_code, '') = '');
    status := case when n = 0 then 'ok' else 'warn' end;
    detail := case when n = 0 then 'Every active employee has an account number and an IFSC.'
                   else n || ' active employees have no account number or IFSC. Their row in the bank file will be incomplete.' end; return next;
  end loop;

  company := '(database)'; area := 'Access';
  item := 'Tables open to the browser key';
  select count(*) into n from pg_policies p where p.schemaname = 'public' and p.tablename like 'te\_%' and p.policyname like 'allow\_all\_%';
  status := case when n = 0 then 'ok' else 'warn' end;
  detail := case when n = 0 then 'None. Only the server key reaches the te_ tables.'
                 else n || ' te_ tables allow the anon key. Run 151_te_lockdown.sql before real data goes in.' end;
  return next;
  item := 'Functions open to the browser key';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'te\_%' and exists (select 1 from pg_roles r where r.rolname = 'anon')
     and has_function_privilege('anon', p.oid, 'execute');
  status := case when n = 0 then 'ok' else 'warn' end;
  detail := case when n = 0 then 'None.' else n || ' te_ functions can be called with the anon key. Run 151_te_lockdown.sql.' end;
  return next;
end;
$$;

notify pgrst, 'reload schema';
