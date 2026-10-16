-- 150_te_backfill_from_v1.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  OPTIONAL: COPY v1 TRAVEL HISTORY INTO v2
-- SAFE TO RUN TWICE. OPTIONAL. Run AFTER 149.
-- ----------------------------------------------------------------------------
-- WHAT THIS IS
--
-- The old travel-claims module (v1, migrations 049-054) keeps its data in the
-- travel_ tables. The redesigned module (v2, 144-149) keeps its data in the
-- te_ tables. This file gives you one function that copies FINISHED v1 trips
-- and claims into v2, so the history is there on the day you switch over.
--
-- RUNNING THIS FILE COPIES NOTHING. It only creates:
--   te_v1_map                which v1 row became which v2 row
--   te_backfill_from_v1()    the copy, with a preview mode
--   five small te__v1_ helpers that the copy uses
--
-- HOW TO USE IT
--   1  preview (writes nothing)    select te_backfill_from_v1(null, true);
--   2  read the report. Finish in v1 what it lists, and preview again.
--   3  copy                        select te_backfill_from_v1(null, false);
--   One company only:              select te_backfill_from_v1('<company id>', true);
--
--   The first argument is a company id, or null for every company. The second
--   is the preview switch. It defaults to TRUE, so a call with no arguments is
--   always a preview. Both calls return the same report as JSON.
--
-- RUN ORDER      144 -> 145 -> 146 -> 147 -> 148 -> 149 -> this file.
--
-- WHAT IS COPIED (the full table is in docs/parts/v1-to-v2-mapping.md)
--   travel_trips            -> te_trips            only CLOSED, SETTLED, REJECTED, CANCELLED
--   travel_trip_travellers  -> te_trip_people      colleagues who are employees
--   travel_claims           -> te_claims           only PAID and REJECTED
--   travel_claim_lines      -> te_expenses         the journey (travel_logs) is kept in "details"
--   travel_attachments      -> te_expense_files    the path is copied; the file is not moved
--   travel_approvals        -> te_approval_steps   only steps somebody acted on
--   a trip advance that v1 shows fully netted off  -> te_advances + te_settlements
--   the dates v1 recorded   -> te_audit_log        every summary starts with "[from v1]"
--
-- WHAT IS NEVER COPIED
--   · Anything still moving in v1: a claim waiting for a manager or Finance, a
--     claim approved but not yet paid, an open trip, a journey not yet claimed.
--     Finish it in v1, run this again, and it is copied then.
--   · v1 masters: expense types, rates, limits, policies, vehicles. v2 has its
--     own, seeded by 149. Where a v1 rate or limit differs from v2, the report
--     lists it under "review". Nothing in v2 is changed.
--   · Itineraries. v1 holds two city names per trip and no map points, so no
--     te_places, te_trip_points, te_trip_segments or te_legs are made up.
--
-- RULES IT KEEPS
--   · v1 is read only. No travel_ row is updated or deleted, ever.
--     (One case adds rows to a v1 table: a company that was never set up for v2
--     is seeded first with te_seed_company(), and that function opens this
--     month and next month in travel_periods when they are missing.)
--   · A row is copied once. te_v1_map remembers it; a second run skips it.
--   · A claim is copied whole or not at all. If one line would break a v2 rule
--     (approved more than claimed, the same invoice twice, totals that do not
--     add up), the whole claim stays in v1 and is named in the report.
--   · Nothing is guessed. Where v2 needs a value that v1 does not have, the
--     choice is fixed and is printed under "assumptions" in the report.
--
-- THIS FUNCTION IS FOR THE SQL EDITOR OR A SERVER SCRIPT. The last section
-- takes the right to run it away from the anon and authenticated roles.
--
-- COLUMNS OF v1 TABLES THIS FILE READS (checked against 049-054, 9 Oct 2026)
--   Whole rows of travel_trips, travel_trip_travellers, travel_claims,
--   travel_claim_lines, travel_logs, travel_log_stops, travel_attachments,
--   travel_approvals, travel_flags, travel_claim_line_shares; and for the
--   review list only: travel_policies, travel_entitlements, travel_mileage_rates,
--   travel_employee_vehicles, travel_trip_bookings, travel_expense_types.
--   plpgsql bodies are NOT checked when created. database/tests/150_backfill_test.sql
--   runs this function end to end on sample v1 data, so a wrong name shows up there.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — WHICH v1 ROW BECAME WHICH v2 ROW
-- One row per v2 row the copy creates. v1_table is the v1 table the data came
-- from. Three v2 rows have no v1 table of their own, because v1 keeps that
-- fact as columns on another row; they are named after the column:
--   'travel_trips.advance'               -> te_advances        (v1_id = the trip)
--   'travel_claims.advance_adjusted'     -> te_settlements     (v1_id = the claim)
--   'travel_claim_lines.finance_remarks' -> te_line_decisions  (v1_id = the line)
-- The undo in docs/parts/v1-to-v2-mapping.md deletes by this table.
-- ============================================================================

create table if not exists te_v1_map (
  v1_table   text not null,
  v1_id      uuid not null,
  te_table   text not null,
  te_id      uuid not null,
  copied_at  timestamptz not null default now(),
  primary key (v1_table, v1_id)
);
create index if not exists idx_te_v1_map_te on te_v1_map (te_table, te_id);

comment on table te_v1_map is
  'Written only by te_backfill_from_v1(). Which v1 travel_ row became which v2 te_ row. '
  'A row here means "already copied": the copy never copies it again.';

-- Row level security is ON and there is deliberately NO policy: the browser
-- keys (anon, authenticated) cannot read or write this table. The SQL editor
-- and the service-role key are not subject to RLS. (145 gives every te_ table
-- an allow-all policy to match the EZER pattern; this table is bookkeeping for
-- a one-time copy and no screen reads it.)
alter table te_v1_map enable row level security;


-- ============================================================================
-- SECTION 2 — HELPERS
-- ============================================================================

-- Add 1 (or p_by) to a counter inside a JSON object. te__v1_bump(x, '{a,b}') is x.a.b += 1.
create or replace function te__v1_bump(p_counts jsonb, p_path text[], p_by int default 1)
returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(p_counts, '{}'::jsonb), p_path,
                   to_jsonb(coalesce((coalesce(p_counts, '{}'::jsonb) #>> p_path)::int, 0) + p_by), true);
$$;

-- One entry in the list of skipped records. The list stops at 50; the counts do not.
create or replace function te__v1_skip_row(p_list jsonb, p_table text, p_id uuid, p_no text, p_company_id uuid,
                                           p_reason text, p_detail text)
returns jsonb language sql immutable as $$
  select case when jsonb_array_length(p_list) >= 50 then p_list
              else p_list || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                     'v1_table', p_table, 'v1_id', p_id, 'v1_no', p_no, 'company_id', p_company_id,
                     'reason', p_reason, 'detail', p_detail))) end;
$$;

-- The v2 expense category a v1 expense type files under.
--   Twenty-three of the 35 v1 types (051) have a v2 category that means the same thing.
--   The other twelve have no v2 category. They file under 'misc', which is v2's
--   category for exactly that, and the report counts them under review.filed_under_misc.
--   A code that is not one of the 35 (a company added its own) also files under 'misc'.
--   The v1 code is never lost: the whole v1 line is kept in te_expenses.details.
create or replace function te__v1_category(p_type_code text)
returns text language sql immutable as $$
  select case upper(coalesce(p_type_code, ''))
    -- own vehicle, paid per km
    when 'OWN_CAR'          then 'mileage'
    when 'OWN_BIKE'         then 'mileage'
    -- a ride on a bill
    when 'CAB'              then 'cab'
    when 'OUTSTATION_TAXI'  then 'cab'
    -- a ride without a bill (v2 files an auto or a city bus under 'local' too: te_modes.category_code)
    when 'AUTO'             then 'local'
    when 'PUBLIC_TRANSPORT' then 'local'
    when 'AUTO_CASH'        then 'local'
    when 'CAB_CASH'         then 'local'
    when 'SHARED_AUTO'      then 'local'
    when 'E_RICKSHAW'       then 'local'
    when 'BIKE_TAXI'        then 'local'
    when 'LOCAL_TRAIN'      then 'local'
    when 'TOLL'             then 'toll'
    when 'PARKING'          then 'toll'
    when 'FLIGHT'           then 'air'
    when 'TRAIN'            then 'train'
    when 'BUS'              then 'bus'
    when 'HOTEL'            then 'hotel'
    when 'FOOD'             then 'meals'
    when 'CLIENT_MEAL'      then 'client'
    when 'MOBILE'           then 'comm'
    when 'INTERNET'         then 'comm'
    when 'COURIER'          then 'comm'
    -- MISC, and the twelve with no v2 category: COMPANY_CAB, FUEL, DRIVER_ALLOW,
    -- DAILY_ALLOW, INCIDENTAL, LAUNDRY, PORTERAGE, VISA, TRAVEL_INS,
    -- FOREX_MARKUP, BUSINESS_GIFT, and any code a company added
    else 'misc'
  end;
$$;

-- The number a copied trip or claim gets in v2.
--   The v1 number is kept when it is free in that company.
--   It is NOT free when the same text is already there, and also when a v2
--   number of the same year has the same serial: v1 wrote TRP-2026-00007 and v2
--   writes TRP-2026-0007, which are different texts for what a person reads as
--   the same number. Then the copy is stored as V1-<v1 number>, and the report
--   lists it under "renumbered". Every form tried ends with the v1 number, so a
--   copied number still ends in its serial (147 reads the serial of a claim
--   number for the audit sample).
create or replace function te__v1_free_no(p_kind text, p_company_id uuid, p_v1_no text, p_v1_id uuid)
returns text language plpgsql as $$
declare
  v_try  text;
  v_hit  boolean;
  m      text[];
begin
  foreach v_try in array array[p_v1_no, 'V1-' || p_v1_no, 'V1-' || left(p_v1_id::text, 8) || '-' || p_v1_no] loop
    if p_kind = 'trip' then
      v_hit := exists (select 1 from te_trips t where t.company_id = p_company_id and t.trip_no = v_try);
      m := regexp_match(v_try, '^TRP-(\d{4})-(\d{1,15})$');
      if not v_hit and m is not null then
        v_hit := exists (select 1 from te_trips t where t.company_id = p_company_id
                          and t.trip_no ~ ('^TRP-' || m[1] || '-0*' || (m[2]::bigint)::text || '$'));
      end if;
    else
      v_hit := exists (select 1 from te_claims c where c.company_id = p_company_id and c.claim_no = v_try);
      m := regexp_match(v_try, '^CLM-(\d{4})-(\d{1,15})$');
      if not v_hit and m is not null then
        v_hit := exists (select 1 from te_claims c where c.company_id = p_company_id
                          and c.claim_no ~ ('^CLM-' || m[1] || '-0*' || (m[2]::bigint)::text || '$'));
      end if;
    end if;
    if not v_hit then
      return v_try;
    end if;
  end loop;
  return 'V1-' || p_v1_id::text || '-' || p_v1_no;   -- always free: the v1 id is unique
end;
$$;

-- One audit row with the time the thing happened in v1.
--   WHY NOT te_log(): te_log() (145) has no argument for the time; it always
--   writes "now". History copied from v1 must carry the v1 time, so this
--   helper inserts into te_audit_log directly. That is allowed: the guard on
--   te_audit_log refuses UPDATE and DELETE, not INSERT.
--   The summary always starts with "[from v1]", so the origin is visible in
--   every timeline.
create or replace function te__v1_log(
  p_company_id uuid, p_entity_type text, p_entity_id uuid, p_entity_ref text, p_action text,
  p_actor_id uuid, p_actor_role text, p_summary text, p_at timestamptz,
  p_visible boolean default true, p_before jsonb default null
)
returns void language sql as $$
  insert into te_audit_log (company_id, entity_type, entity_id, entity_ref, action, actor_id, actor_role,
                            summary, employee_visible, before, after, at)
  values (p_company_id, p_entity_type, p_entity_id, p_entity_ref, p_action, p_actor_id, p_actor_role,
          '[from v1] ' || p_summary, coalesce(p_visible, true), p_before, null, coalesce(p_at, now()));
$$;


-- ============================================================================
-- SECTION 3 — THE COPY
-- ============================================================================
--
-- STATUS MAPPING (v1 -> v2)
--
--   travel_trips.status          te_trips.status
--   CLOSED, SETTLED              CLOSED
--   REJECTED                     REJECTED
--   CANCELLED                    CANCELLED
--   DRAFT, PENDING_RM,           not copied: "in_flight"
--   APPROVED, ACTIVE
--
--   travel_claims.status         te_claims.status      te_expenses.status of its lines
--   PAID                         SETTLED               PAID, or REJECTED_FINAL for a line Finance approved at zero
--   REJECTED                     REJECTED              REJECTED_FINAL
--   SENT_BACK                    not copied: "sent_back"
--   DRAFT, SUBMITTED,            not copied: "in_flight"
--   PENDING_RM, PENDING_HR,
--   PENDING_FINANCE, APPROVED
--
--   Why PAID becomes SETTLED and not PAID: in v2 PAID lasts an instant.
--   te_payout_paid() sets it and settles the claim in the same call. A month
--   cannot be LOCKED while it holds a claim that is not SETTLED, REJECTED or
--   CANCELLED (145, te_guard_period_lock), so a copied claim left at PAID would
--   block month-end for ever.
--
-- HOW A PREVIEW WRITES NOTHING
--   All the work happens inside one inner block. A preview does the same work
--   as a real run and then leaves that block through an exception, which makes
--   Postgres roll back every row the block wrote. The report is kept, because
--   plpgsql variables are not rolled back. So the preview report is not an
--   estimate: it is what the real run would have done at that moment.
--   (te_audit_log.id is an identity column. A preview uses up some of its
--   numbers, as any rolled-back insert does. No row is left behind.)

create or replace function te_backfill_from_v1(p_company_id uuid default null, p_dry_run boolean default true)
returns jsonb
language plpgsql
as $$
declare
  v_dry        boolean := coalesce(p_dry_run, true);
  v_report     jsonb;

  -- what the report is built from
  v_copied     jsonb := jsonb_build_object('te_trips', 0, 'te_trip_people', 0, 'te_claims', 0, 'te_expenses', 0,
                                           'te_expense_files', 0, 'te_approval_steps', 0, 'te_line_decisions', 0,
                                           'te_advances', 0, 'te_settlements', 0, 'te_audit_log', 0);
  v_already    jsonb := jsonb_build_object('travel_trips', 0, 'travel_claims', 0);
  v_skipped    jsonb := jsonb_build_object('travel_trips', '{}'::jsonb, 'travel_claims', '{}'::jsonb,
                                           'travel_trips.advance', '{}'::jsonb);
  v_list       jsonb := '[]'::jsonb;
  v_skip_n     int   := 0;
  v_renum      jsonb := '[]'::jsonb;
  v_seqs       jsonb := '[]'::jsonb;
  v_companies  jsonb := '[]'::jsonb;
  v_review     jsonb := '[]'::jsonb;
  v_recon      jsonb := '[]'::jsonb;

  -- rows being read
  co           record;
  r_trip       travel_trips%rowtype;
  r_claim      travel_claims%rowtype;
  r_line       travel_claim_lines%rowtype;
  r_log        travel_logs%rowtype;
  r_app        travel_approvals%rowtype;
  r_att        travel_attachments%rowtype;
  r_rej        record;
  r_x          record;

  -- one company
  v_seeded     boolean;
  v_tz         text;
  v_today      date;
  v_pol        jsonb;
  v_policy_id  uuid;
  v_no_person  int;
  v_files_n    int;

  -- one trip or one claim
  v_reason     text;
  v_detail     text;
  v_no         text;
  v_adv_no     text;
  v_te_trip    uuid;
  v_te_claim   uuid;
  v_te_exp     uuid;
  v_te_adv     uuid;
  v_te_id      uuid;
  v_n          int;
  v_seq        int;
  v_lines      int;
  v_sum_claimed  numeric;
  v_sum_approved numeric;
  v_null_approved int;
  v_negative   int;
  v_bad_line   uuid;
  v_infer      boolean;
  v_paid       boolean;
  v_stage      text;
  v_sstage     text;
  v_role       text;
  v_refiled    text;
  v_appr       numeric;
  v_lstatus    text;
  v_fin_step   uuid;
  v_fin_by     uuid;
  v_who        uuid;
  v_fin_at     timestamptz;
  v_type_name  text;
  v_before     bigint;
  v_open       int;
  v_unmapped   int;
  v_netted     numeric;

  -- counters of the row being copied; added to the report only when it is done
  c_people int; c_steps int; c_exp int; c_files int; c_dec int; c_sett int; c_audit int;
begin
  -- ---- is everything this needs on the database? --------------------------------
  if to_regclass('public.travel_claims') is null or to_regclass('public.travel_trips') is null then
    perform te_fail('TE_NOT_SET_UP', 'The v1 travel tables (migration 049) are not on this database. There is nothing to copy.');
  end if;
  if to_regclass('public.te_claims') is null or to_regprocedure('te_seed_company(uuid, uuid)') is null then
    perform te_fail('TE_NOT_SET_UP', 'Run migrations 144 to 149 first.');
  end if;
  if p_company_id is not null and not exists (select 1 from companies c where c.id = p_company_id) then
    perform te_fail('TE_NOT_SET_UP', 'Company not found.');
  end if;

  -- one copy at a time; a second caller waits here until the first has finished
  perform pg_advisory_xact_lock(hashtext('te_backfill_from_v1'));

  begin   -- THE INNER BLOCK: a preview rolls back everything written from here on

    for co in
      select c.id, c.company_name
        from companies c
       where (p_company_id is null or c.id = p_company_id)
         and (exists (select 1 from travel_trips t where t.company_id = c.id)
           or exists (select 1 from travel_claims k where k.company_id = c.id))
       order by c.company_name, c.id
    loop
      -- ---- the company is set up for v2 first ---------------------------------------
      v_seeded := false;
      if not exists (select 1 from te_settings s where s.company_id = co.id) then
        perform te_seed_company(co.id);
        v_seeded := true;
      end if;
      v_companies := v_companies || jsonb_build_array(jsonb_build_object(
                       'company_id', co.id, 'company', co.company_name, 'seeded_for_v2_now', v_seeded));
      v_today := te_today(co.id);
      select coalesce(nullif(c.timezone, ''), 'Asia/Kolkata') into v_tz from companies c where c.id = co.id;
      v_no_person := 0;
      v_files_n   := 0;

      -- ==========================================================================
      -- TRIPS
      -- ==========================================================================
      for r_trip in
        select t.* from travel_trips t where t.company_id = co.id order by t.created_at, t.trip_no, t.id
      loop
        if exists (select 1 from te_v1_map m where m.v1_table = 'travel_trips' and m.v1_id = r_trip.id) then
          v_already := te__v1_bump(v_already, array['travel_trips']);
          continue;
        end if;
        if r_trip.status not in ('CLOSED', 'SETTLED', 'REJECTED', 'CANCELLED') then
          v_skipped := te__v1_bump(v_skipped, array['travel_trips', 'in_flight']);
          v_list := te__v1_skip_row(v_list, 'travel_trips', r_trip.id, r_trip.trip_no, co.id, 'in_flight',
                      'v1 status ' || r_trip.status || ': close or cancel the trip in v1, then run again');
          v_skip_n := v_skip_n + 1;
          continue;
        end if;

        begin
          c_people := 0; c_steps := 0; c_audit := 0;
          v_no := te__v1_free_no('trip', co.id, r_trip.trip_no, r_trip.id);

          -- colleagues on the trip who are employees (the one who raised it is not listed in v2)
          select count(*) into v_n
            from travel_trip_travellers tt join employees e on e.id = tt.employee_id
           where tt.trip_id = r_trip.id and tt.traveller_type = 'INTERNAL' and tt.status <> 'DROPPED'
             and tt.employee_id <> r_trip.employee_id
             and coalesce(btrim(e.emp_code), '') <> '' and coalesce(btrim(e.full_name), '') <> '';

          insert into te_trips (company_id, trip_no, employee_id, name, scope, pattern, origin, purpose, project, pax,
                                stay_by, start_date, end_date, from_label, to_label, country, estimate, estimate_total,
                                self_estimate, planned_km, advance_requested, status, chain_notes, approved_at,
                                created_at, updated_at)
          values (co.id, v_no, r_trip.employee_id,
                  -- v1 has no trip name; its purpose is the only description, so it serves as both
                  coalesce(nullif(left(btrim(r_trip.purpose), 80), ''), r_trip.trip_no),
                  case r_trip.trip_type when 'LOCAL' then 'local' else 'domestic' end,   -- see "assumptions"
                  'oneway',                                                               -- see "assumptions"
                  'PRE_APPROVED', r_trip.purpose, null, 1 + v_n, 'self',
                  r_trip.from_date, r_trip.to_date, r_trip.from_city, r_trip.to_city, null,
                  '{}'::jsonb, coalesce(r_trip.estimated_cost, 0), 0, 0, coalesce(r_trip.advance_requested, 0),
                  case r_trip.status when 'REJECTED' then 'REJECTED' when 'CANCELLED' then 'CANCELLED' else 'CLOSED' end,
                  '{}', r_trip.approved_at, r_trip.created_at, r_trip.updated_at)
          returning id into v_te_trip;
          insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_trips', r_trip.id, 'te_trips', v_te_trip);

          for r_x in
            select tt.id, tt.employee_id, e.emp_code, e.full_name
              from travel_trip_travellers tt join employees e on e.id = tt.employee_id
             where tt.trip_id = r_trip.id and tt.traveller_type = 'INTERNAL' and tt.status <> 'DROPPED'
               and tt.employee_id <> r_trip.employee_id
               and coalesce(btrim(e.emp_code), '') <> '' and coalesce(btrim(e.full_name), '') <> ''
             order by tt.created_at, tt.id
          loop
            insert into te_trip_people (trip_id, seq, employee_id, emp_code_entered, name_entered, found_in_ezer)
            values (v_te_trip, c_people, r_x.employee_id, upper(btrim(r_x.emp_code)), btrim(r_x.full_name), true)
            returning id into v_te_id;
            insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_trip_travellers', r_x.id, 'te_trip_people', v_te_id);
            c_people := c_people + 1;
          end loop;

          perform te__v1_log(co.id, 'trip', v_te_trip, v_no, 'TRIP_PLANNED', r_trip.employee_id, null,
                    'Trip planned: ' || coalesce(nullif(btrim(r_trip.from_city), '') || ' to ', '')
                      || coalesce(nullif(btrim(r_trip.to_city), ''), lower(r_trip.trip_type) || ' travel')
                      || ', ' || to_char(r_trip.from_date, 'DD Mon YYYY')
                      || case when r_trip.to_date <> r_trip.from_date then ' to ' || to_char(r_trip.to_date, 'DD Mon YYYY') else '' end || '.',
                    r_trip.created_at);
          c_audit := c_audit + 1;

          -- the manager's decision on the plan, where v1 recorded who and when
          v_n := 0;
          for r_app in
            select a.* from travel_approvals a
             where a.trip_id = r_trip.id and a.stage = 'TRIP_RM' and a.actioned_at is not null
               and a.action in ('APPROVED', 'REJECTED')
             order by a.created_at, a.actioned_at, a.id
          loop
            -- v1 fills approver_id with whoever acted; an older row may have it only on the trip
            v_who := coalesce(r_app.approver_id, case when r_app.action = 'APPROVED' then r_trip.approved_by end);
            perform te__v1_log(co.id, 'trip', v_te_trip, v_no,
                      case r_app.action when 'APPROVED' then 'TRIP_STEP_APPROVED' else 'TRIP_REJECTED' end,
                      v_who, 'Reporting manager',
                      case r_app.action when 'APPROVED' then 'Approved as Reporting manager' || coalesce(': ' || nullif(btrim(r_app.remarks), ''), '.')
                           else 'Rejected: ' || coalesce(nullif(btrim(r_app.remarks), ''), nullif(btrim(r_trip.rejection_reason), ''), 'no reason recorded in v1') end,
                      r_app.actioned_at);
            c_audit := c_audit + 1;
            if v_who is null then
              v_no_person := v_no_person + 1;          -- a v2 step needs a person; v1 did not record one
            else
              v_n := v_n + 1;
              insert into te_approval_steps (company_id, entity_type, entity_id, step_no, stage, role_label, approver_id,
                                             status, acted_by, delegated_from, comment, due_at, acted_at, created_at)
              values (co.id, 'trip', v_te_trip, v_n, 'manager', 'Reporting manager', v_who,
                      case r_app.action when 'APPROVED' then 'approved' else 'rejected' end,
                      v_who, r_app.delegated_from, nullif(btrim(r_app.remarks), ''), r_app.sla_due_at, r_app.actioned_at, r_app.created_at)
              returning id into v_te_id;
              insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_approvals', r_app.id, 'te_approval_steps', v_te_id);
              c_steps := c_steps + 1;
            end if;
          end loop;
          -- approved on the trip row, with no approval task behind it
          if v_n = 0 and r_trip.approved_at is not null
             and not exists (select 1 from travel_approvals a where a.trip_id = r_trip.id and a.stage = 'TRIP_RM'
                                and a.action = 'APPROVED' and a.actioned_at is not null) then
            perform te__v1_log(co.id, 'trip', v_te_trip, v_no, 'TRIP_STEP_APPROVED', r_trip.approved_by, 'Reporting manager',
                      'Approved as Reporting manager.', r_trip.approved_at);
            c_audit := c_audit + 1;
          end if;

          -- the whole v1 row, kept word for word for whoever needs it later
          perform te__v1_log(co.id, 'trip', v_te_trip, v_no, 'V1_IMPORTED', null, null,
                    'Copied from the old travel module. v1 trip ' || r_trip.trip_no || ', status ' || r_trip.status || '.',
                    now(), false,
                    jsonb_build_object(
                      'v1_trip', to_jsonb(r_trip),
                      'v1_travellers', (select coalesce(jsonb_agg(to_jsonb(tt) order by tt.created_at, tt.id), '[]'::jsonb)
                                          from travel_trip_travellers tt where tt.trip_id = r_trip.id),
                      'v1_bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]'::jsonb)
                                        from travel_trip_bookings b where b.trip_id = r_trip.id)));
          c_audit := c_audit + 1;

          -- done: count it
          v_copied := te__v1_bump(v_copied, array['te_trips']);
          v_copied := te__v1_bump(v_copied, array['te_trip_people'], c_people);
          v_copied := te__v1_bump(v_copied, array['te_approval_steps'], c_steps);
          v_copied := te__v1_bump(v_copied, array['te_audit_log'], c_audit);
          if v_no <> r_trip.trip_no then
            v_renum := v_renum || jsonb_build_array(jsonb_build_object(
                         'v1_table', 'travel_trips', 'v1_id', r_trip.id, 'company_id', co.id, 'v1_no', r_trip.trip_no, 'te_no', v_no));
          end if;
        exception when others then
          -- one bad row never stops the run: what this block wrote is rolled back and the row is reported
          v_skipped := te__v1_bump(v_skipped, array['travel_trips', 'error']);
          v_list := te__v1_skip_row(v_list, 'travel_trips', r_trip.id, r_trip.trip_no, co.id, 'error', sqlerrm);
          v_skip_n := v_skip_n + 1;
        end;
      end loop;

      -- ==========================================================================
      -- CLAIMS, WITH THEIR LINES, FILES AND APPROVAL STEPS
      -- Paid claims first, then rejected ones: if a paid and a rejected claim
      -- carry the same invoice, the paid one is the one that gets copied.
      -- ==========================================================================
      for r_claim in
        select k.* from travel_claims k
         where k.company_id = co.id
         order by (k.status = 'PAID') desc, coalesce(k.first_submitted_at, k.submitted_at, k.created_at), k.claim_no, k.id
      loop
        if exists (select 1 from te_v1_map m where m.v1_table = 'travel_claims' and m.v1_id = r_claim.id) then
          v_already := te__v1_bump(v_already, array['travel_claims']);
          continue;
        end if;

        v_reason := null; v_detail := null; v_te_trip := null; v_infer := false;
        v_paid := r_claim.status = 'PAID';

        -- ---- 1. only finished claims --------------------------------------------------
        if r_claim.status = 'SENT_BACK' then
          v_reason := 'sent_back';
          v_detail := 'v1 status SENT_BACK: v1 gave the journeys back to the employee and never reopens the same claim number';
        elsif r_claim.status not in ('PAID', 'REJECTED') then
          v_reason := 'in_flight';
          v_detail := 'v1 status ' || r_claim.status || ': finish it in v1, then run again';
        end if;

        -- ---- 2. its trip must have been copied ----------------------------------------
        if v_reason is null and r_claim.trip_id is not null then
          select m.te_id into v_te_trip from te_v1_map m where m.v1_table = 'travel_trips' and m.v1_id = r_claim.trip_id;
          if v_te_trip is null then
            v_reason := 'trip_not_copied';
            v_detail := 'its trip ' || coalesce((select t.trip_no || ' (v1 status ' || t.status || ')' from travel_trips t where t.id = r_claim.trip_id), 'is missing')
                        || ' was not copied';
          end if;
        end if;

        -- ---- 3. the lines must add up to the header, and fit the v2 rules --------------
        if v_reason is null then
          select count(*), coalesce(sum(l.amount_claimed), 0), coalesce(sum(coalesce(l.amount_approved, 0)), 0),
                 count(*) filter (where l.amount_approved is null),
                 count(*) filter (where l.amount_claimed < 0 or l.amount_approved < 0),
                 (array_agg(l.id order by l.created_at, l.id) filter (where l.amount_approved > l.amount_claimed))[1]
            into v_lines, v_sum_claimed, v_sum_approved, v_null_approved, v_negative, v_bad_line
            from travel_claim_lines l where l.claim_id = r_claim.id;

          -- An older v1 build approved a claim in full on the header and left every
          -- line's amount_approved empty. When ALL lines are empty and the header
          -- says the full claimed amount was approved, each line was approved in
          -- full: no other split adds up, because a line is never approved above
          -- what it claimed. That is the one case where a line amount is filled in.
          v_infer := v_paid and v_lines > 0 and v_null_approved = v_lines and r_claim.total_approved = v_sum_claimed;

          if v_lines = 0 then
            v_reason := 'no_lines';
            v_detail := 'the claim has no lines in v1';
          elsif v_negative > 0 then
            v_reason := 'negative_amount';
            v_detail := 'a line has a negative amount; v2 does not store one (te_exp_amounts_positive)';
          elsif v_sum_claimed <> r_claim.total_claimed then
            v_reason := 'totals_mismatch';
            v_detail := 'header says ' || r_claim.total_claimed || ' claimed, the lines add up to ' || v_sum_claimed;
          elsif v_paid and not v_infer and v_bad_line is not null then
            v_reason := 'approved_above_claimed';
            v_detail := 'line ' || v_bad_line || ' was approved for more than it claimed; v2 never allows that (te_exp_approved_le_claimed)';
          elsif v_paid and not v_infer and v_sum_approved <> r_claim.total_approved then
            v_reason := 'totals_mismatch';
            v_detail := 'header says ' || r_claim.total_approved || ' approved, the lines add up to ' || v_sum_approved;
          elsif v_paid and (r_claim.total_approved - r_claim.advance_adjusted) <> (r_claim.net_payable - r_claim.recovery_amount) then
            v_reason := 'net_mismatch';
            v_detail := 'approved ' || r_claim.total_approved || ' less advance ' || r_claim.advance_adjusted
                        || ' is not net payable ' || r_claim.net_payable || ' less recovery ' || r_claim.recovery_amount;
          end if;
        end if;

        -- ---- 4. the same supplier invoice is never in v2 twice (check B3, uq_te_exp_invoice) ----
        if v_reason is null then
          select l.id, 'line ' || l.id || ': invoice ' || btrim(l.invoice_no) || ' of GSTIN ' || upper(btrim(l.supplier_gstin))
                 || coalesce(' is already in v2 on ' || (
                      select coalesce('claim ' || c.claim_no, 'line ' || x.expense_no)
                        from te_expenses x left join te_claims c on c.id = x.claim_id
                       where x.company_id = co.id and x.paid_by = 'self'
                         and coalesce(x.merchant_gstin, '') <> '' and coalesce(x.bill_no, '') <> ''
                         and x.status not in ('REJECTED_REFILE', 'EXPIRED', 'DISCARDED')
                         and upper(x.merchant_gstin) = upper(btrim(l.supplier_gstin))
                         and upper(regexp_replace(x.bill_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(btrim(l.invoice_no), '[^A-Za-z0-9]', '', 'g'))
                         and extract(year from (x.expense_date - interval '3 months'))::int = extract(year from (l.expense_date - interval '3 months'))::int
                       limit 1), ' is on two lines of this claim')
            into v_bad_line, v_detail
            from travel_claim_lines l
           where l.claim_id = r_claim.id
             and coalesce(btrim(l.supplier_gstin), '') <> '' and coalesce(btrim(l.invoice_no), '') <> ''
             and (exists (select 1 from te_expenses x
                           where x.company_id = co.id and x.paid_by = 'self'
                             and coalesce(x.merchant_gstin, '') <> '' and coalesce(x.bill_no, '') <> ''
                             and x.status not in ('REJECTED_REFILE', 'EXPIRED', 'DISCARDED')
                             and upper(x.merchant_gstin) = upper(btrim(l.supplier_gstin))
                             and upper(regexp_replace(x.bill_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(btrim(l.invoice_no), '[^A-Za-z0-9]', '', 'g'))
                             and extract(year from (x.expense_date - interval '3 months'))::int = extract(year from (l.expense_date - interval '3 months'))::int)
               or exists (select 1 from travel_claim_lines o
                           where o.claim_id = l.claim_id and o.id <> l.id
                             and upper(btrim(o.supplier_gstin)) = upper(btrim(l.supplier_gstin))
                             and upper(regexp_replace(btrim(o.invoice_no), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(btrim(l.invoice_no), '[^A-Za-z0-9]', '', 'g'))
                             and extract(year from (o.expense_date - interval '3 months'))::int = extract(year from (l.expense_date - interval '3 months'))::int))
           order by l.created_at, l.id
           limit 1;
          if found then
            v_reason := 'duplicate_invoice';
          else
            v_detail := null;
          end if;
        end if;

        if v_reason is not null then
          v_skipped := te__v1_bump(v_skipped, array['travel_claims', v_reason]);
          v_list := te__v1_skip_row(v_list, 'travel_claims', r_claim.id, r_claim.claim_no, co.id, v_reason, v_detail);
          v_skip_n := v_skip_n + 1;
          continue;
        end if;

        -- ---- 5. copy it -----------------------------------------------------------------
        begin
          c_steps := 0; c_exp := 0; c_files := 0; c_dec := 0; c_audit := 0;
          v_fin_step := null; v_fin_by := null; v_fin_at := null;
          v_no := te__v1_free_no('claim', co.id, r_claim.claim_no, r_claim.id);

          -- 0 = the first claim of this employee on this trip, 1+ = a later one (as te_claim_submit counts)
          select coalesce(max(k.claim_seq) + 1, 0) into v_seq
            from te_claims k where v_te_trip is not null and k.trip_id = v_te_trip and k.employee_id = r_claim.employee_id;

          -- where a rejected claim was rejected, and why
          select a.stage, a.remarks into r_rej
            from travel_approvals a
           where a.claim_id = r_claim.id and a.action = 'REJECTED' and a.actioned_at is not null
           order by a.actioned_at desc, a.created_at desc limit 1;
          v_stage := case when v_paid then 'finance'
                          when r_rej.stage = 'CLAIM_FINANCE' then 'finance'
                          when r_rej.stage is not null then 'manager'
                          when exists (select 1 from travel_approvals a where a.claim_id = r_claim.id and a.stage = 'CLAIM_FINANCE') then 'finance'
                          else 'manager' end;

          -- v1 hands the journeys of a rejected claim back to the employee, who may file them again
          select string_agg(distinct k.claim_no, ', ' order by k.claim_no) into v_refiled
            from travel_claim_lines l
            join travel_logs g on g.id = l.travel_log_id
            join travel_claims k on k.id = g.claim_id
           where l.claim_id = r_claim.id and g.claim_id <> r_claim.id;

          insert into te_claims (company_id, claim_no, employee_id, trip_id, claim_type, claim_seq, period_id, is_late, note,
                                 claimed_total, eligible_total, approved_total, advance_adjusted, net_amount,
                                 stage, status, rejected_from, reject_reason, chain_notes,
                                 submitted_at, first_submitted_at, verified_at, paid_ref, settled_at, created_at, updated_at)
          values (co.id, v_no, r_claim.employee_id, v_te_trip,
                  case when v_te_trip is null then 'GENERAL' else 'TRIP' end,       -- the v2 rule: a claim with a trip is a TRIP claim
                  coalesce(v_seq, 0), r_claim.period_id, false,
                  '[from v1] ' || case r_claim.claim_type when 'TRIP_SETTLEMENT' then 'Trip settlement claim' else 'Monthly local claim' end
                    || coalesce(', ' || to_char(r_claim.period_from, 'DD Mon YYYY') || ' to ' || to_char(r_claim.period_to, 'DD Mon YYYY'), '') || '.'
                    || coalesce(' Its journeys were filed again in v1 as ' || v_refiled || '.', ''),
                  r_claim.total_claimed,
                  r_claim.total_claimed,        -- v1 applied its limits when a journey was logged: what reached the claim was eligible
                  case when v_paid then r_claim.total_approved else 0 end,
                  case when v_paid then least(r_claim.advance_adjusted, r_claim.total_approved) else 0 end,
                  case when v_paid then r_claim.total_approved - r_claim.advance_adjusted else 0 end,
                  v_stage,
                  case when v_paid then 'SETTLED' else 'REJECTED' end,
                  case when v_paid then null else v_stage end,
                  case when v_paid then null else nullif(btrim(r_rej.remarks), '') end,
                  '{}',
                  r_claim.submitted_at, r_claim.first_submitted_at,
                  case when v_paid then r_claim.finance_actioned_at end,
                  case when v_paid and r_claim.payroll_run_id is not null then 'v1 payroll run ' || r_claim.payroll_run_id end,
                  case when v_paid then r_claim.paid_at end,
                  r_claim.created_at, r_claim.updated_at)
          returning id into v_te_claim;
          insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_claims', r_claim.id, 'te_claims', v_te_claim);

          perform te__v1_log(co.id, 'claim', v_te_claim, v_no, 'CLAIM_SUBMITTED', r_claim.employee_id, null,
                    'Submitted. ' || v_lines || case when v_lines = 1 then ' line, ' else ' lines, ' end || te_rs(r_claim.total_claimed) || ' claimed.',
                    coalesce(r_claim.first_submitted_at, r_claim.submitted_at, r_claim.created_at));
          c_audit := c_audit + 1;

          -- ---- the approval steps somebody acted on, in the order v1 opened them -------------
          v_n := 0;
          for r_app in
            select a.* from travel_approvals a
             where a.claim_id = r_claim.id and a.stage in ('CLAIM_RM', 'CLAIM_HR', 'CLAIM_FINANCE')
               and a.actioned_at is not null and a.action in ('APPROVED', 'PARTIAL', 'REJECTED', 'SENT_BACK')
             order by a.created_at, a.actioned_at, a.id
          loop
            v_role   := case r_app.stage when 'CLAIM_RM' then 'Reporting manager' when 'CLAIM_HR' then 'HR Head' else 'Finance' end;
            v_sstage := case when r_app.stage = 'CLAIM_FINANCE' then 'finance' else 'manager' end;
            perform te__v1_log(co.id, 'claim', v_te_claim, v_no,
                      case when r_app.action = 'REJECTED' then 'CLAIM_REJECTED'
                           when r_app.action = 'SENT_BACK' then 'CLAIM_SENT_BACK'
                           when v_sstage = 'finance' then 'CLAIM_STEP_VERIFIED' else 'CLAIM_STEP_APPROVED' end,
                      r_app.approver_id, v_role,
                      case when r_app.action = 'REJECTED' then 'Rejected as ' || v_role
                           when r_app.action = 'SENT_BACK' then 'Sent back as ' || v_role
                           when v_sstage = 'finance' then 'Verified as ' || v_role else 'Approved as ' || v_role end
                        || coalesce(': ' || nullif(btrim(r_app.remarks), ''), '.'),
                      r_app.actioned_at);
            c_audit := c_audit + 1;

            if r_app.approver_id is null and v_sstage = 'manager' then
              v_no_person := v_no_person + 1;          -- a v2 manager step needs a person; v1 did not record one
            else
              v_n := v_n + 1;
              insert into te_approval_steps (company_id, entity_type, entity_id, step_no, stage, role_label, approver_id, team_code,
                                             status, acted_by, delegated_from, comment, due_at, acted_at, created_at)
              values (co.id, 'claim', v_te_claim, v_n, v_sstage, v_role, r_app.approver_id,
                      case when r_app.approver_id is null then 'finance' end,       -- Finance acted and v1 did not say who
                      case r_app.action when 'REJECTED' then 'rejected' when 'SENT_BACK' then 'sent_back' else 'approved' end,
                      r_app.approver_id, r_app.delegated_from, nullif(btrim(r_app.remarks), ''), r_app.sla_due_at, r_app.actioned_at, r_app.created_at)
              returning id into v_te_id;
              insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_approvals', r_app.id, 'te_approval_steps', v_te_id);
              c_steps := c_steps + 1;
              if v_sstage = 'finance' and r_app.action in ('APPROVED', 'PARTIAL') then
                v_fin_step := v_te_id; v_fin_by := r_app.approver_id; v_fin_at := r_app.actioned_at;
              end if;
            end if;
          end loop;

          -- ---- the lines -------------------------------------------------------------------
          for r_line in
            select l.* from travel_claim_lines l where l.claim_id = r_claim.id order by l.expense_date, l.created_at, l.id
          loop
            select g.* into r_log from travel_logs g where g.id = r_line.travel_log_id;
            select t.type_name into v_type_name from travel_expense_types t where t.company_id = co.id and t.type_code = r_line.type_code;

            v_appr := case when not v_paid then 0
                           when v_infer then r_line.amount_claimed
                           else coalesce(r_line.amount_approved, 0) end;
            v_lstatus := case when not v_paid then 'REJECTED_FINAL'
                              when r_line.line_status = 'REJECTED' or (v_appr = 0 and r_line.amount_claimed > 0) then 'REJECTED_FINAL'
                              else 'PAID' end;

            insert into te_expenses (company_id, expense_no, employee_id, trip_id, claim_id, category_code, expense_date,
                                     merchant_gstin, bill_no, bill_amount, claimed_amount, eligible_amount, approved_amount,
                                     currency, paid_by, description, decision_reason, payable_km, rate_applied, client_name,
                                     details, period_id, status, created_at, updated_at)
            values (co.id, te_next_no(co.id, 'expense'), r_claim.employee_id, v_te_trip, v_te_claim,
                    te__v1_category(r_line.type_code), r_line.expense_date,
                    nullif(upper(btrim(r_line.supplier_gstin)), ''), nullif(btrim(r_line.invoice_no), ''),
                    0,                              -- v1 has no column for the amount on the bill; 0 is v2's "not recorded"
                    r_line.amount_claimed,
                    r_line.amount_claimed,          -- see eligible_total above
                    v_appr,
                    'INR', 'self', nullif(btrim(r_line.description), ''), nullif(btrim(r_line.finance_remarks), ''),
                    r_log.distance_claimed, r_log.rate_applied, nullif(btrim(r_log.client_name), ''),
                    -- everything v1 knew about this line, word for word, except the raw GPS trail (it stays in travel_logs.gps_track)
                    jsonb_strip_nulls(jsonb_build_object('v1', jsonb_build_object(
                      'claim_no', r_claim.claim_no,
                      'type_name', v_type_name,
                      'approved_amount_inferred', case when v_infer then true end,
                      'line', to_jsonb(r_line),
                      'log', case when r_log.id is not null
                                  then (to_jsonb(r_log) - 'gps_track') || jsonb_build_object('gps_track_is_in_v1', r_log.gps_track is not null) end,
                      'log_stops', (select jsonb_agg(to_jsonb(s) order by s.seq) from travel_log_stops s where s.travel_log_id = r_line.travel_log_id),
                      'vehicle', (select to_jsonb(v) from travel_employee_vehicles v where v.id = r_log.vehicle_id),
                      'flags', (select jsonb_agg(to_jsonb(f) order by f.created_at, f.id) from travel_flags f where f.claim_line_id = r_line.id),
                      'shares', (select jsonb_agg(to_jsonb(s) order by s.created_at, s.id) from travel_claim_line_shares s where s.claim_line_id = r_line.id)))),
                    r_claim.period_id, v_lstatus, r_line.created_at, r_line.created_at)
            returning id into v_te_exp;
            insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_claim_lines', r_line.id, 'te_expenses', v_te_exp);
            c_exp := c_exp + 1;

            -- the bills. v1 hangs a bill on the journey; it belongs to this line while the journey belongs to this claim
            for r_att in
              select a.* from travel_attachments a
               where (a.claim_line_id = r_line.id
                      or (a.claim_line_id is null and a.travel_log_id = r_line.travel_log_id and r_log.claim_id = r_claim.id))
                 and not exists (select 1 from te_v1_map m where m.v1_table = 'travel_attachments' and m.v1_id = a.id)
               order by a.uploaded_at, a.id
            loop
              insert into te_expense_files (expense_id, company_id, kind, storage_path, file_name, mime_type, file_size, sha256,
                                            metadata, uploaded_by, uploaded_at)
              values (v_te_exp, co.id,
                      case r_att.attachment_type when 'BILL' then 'BILL' when 'TOLL_SLIP' then 'TOLL_SLIP'
                                                 when 'FASTAG_STATEMENT' then 'FASTAG_STATEMENT' else 'OTHER' end,
                      r_att.file_url, r_att.file_name, r_att.mime_type, r_att.file_size, nullif(btrim(r_att.file_hash), ''),
                      -- the file itself is still where v1 put it: the private bucket of app/api/travel/upload-bill
                      jsonb_build_object('v1', jsonb_build_object('attachment_id', r_att.id, 'attachment_type', r_att.attachment_type,
                                                                  'bucket', 'onboarding-docs')),
                      r_att.uploaded_by, r_att.uploaded_at)
              returning id into v_te_id;
              insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_attachments', r_att.id, 'te_expense_files', v_te_id);
              c_files := c_files + 1;
            end loop;

            -- a line Finance cut, where v1 kept the reason
            if v_paid and not v_infer and v_appr < r_line.amount_claimed and nullif(btrim(r_line.finance_remarks), '') is not null then
              insert into te_line_decisions (claim_id, expense_id, step_id, decided_by, decision, amount_before, amount_after, reason, created_at)
              values (v_te_claim, v_te_exp, v_fin_step, v_fin_by,
                      case when v_appr = 0 then 'reject_final' else 'reduce' end,
                      r_line.amount_claimed, v_appr, btrim(r_line.finance_remarks),
                      coalesce(v_fin_at, r_claim.finance_actioned_at, r_claim.updated_at))
              returning id into v_te_id;
              insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_claim_lines.finance_remarks', r_line.id, 'te_line_decisions', v_te_id);
              c_dec := c_dec + 1;
              perform te__v1_log(co.id, 'claim', v_te_claim, v_no,
                        case when v_appr = 0 then 'LINE_REJECTED' else 'LINE_REDUCED' end, v_fin_by, 'Finance',
                        case when v_appr = 0 then 'Rejected line ' || coalesce(v_type_name, r_line.type_code)
                             else 'Reduced ' || coalesce(v_type_name, r_line.type_code) || ' from ' || te_rs(r_line.amount_claimed) || ' to ' || te_rs(v_appr) end
                          || ': ' || btrim(r_line.finance_remarks),
                        coalesce(v_fin_at, r_claim.finance_actioned_at, r_claim.updated_at));
              c_audit := c_audit + 1;
            end if;
          end loop;

          if v_paid and r_claim.paid_at is not null then
            perform te__v1_log(co.id, 'claim', v_te_claim, v_no, 'CLAIM_PAID', null, null,
                      'Marked paid. Approved ' || te_rs(r_claim.total_approved)
                        || case when r_claim.advance_adjusted > 0 then ', advance adjusted ' || te_rs(least(r_claim.advance_adjusted, r_claim.total_approved)) else '' end
                        || ', net ' || te_rs(r_claim.total_approved - r_claim.advance_adjusted) || '.'
                        || coalesce(' Payroll run ' || r_claim.payroll_run_id || '.', ''),
                      r_claim.paid_at);
            c_audit := c_audit + 1;
          end if;

          perform te__v1_log(co.id, 'claim', v_te_claim, v_no, 'V1_IMPORTED', null, null,
                    'Copied from the old travel module. v1 claim ' || r_claim.claim_no || ', status ' || r_claim.status || '.',
                    now(), false,
                    jsonb_build_object('v1_claim', to_jsonb(r_claim),
                                       'v1_approvals', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
                                                          from travel_approvals a where a.claim_id = r_claim.id)));
          c_audit := c_audit + 1;

          -- done: count it
          v_copied := te__v1_bump(v_copied, array['te_claims']);
          v_copied := te__v1_bump(v_copied, array['te_expenses'], c_exp);
          v_copied := te__v1_bump(v_copied, array['te_expense_files'], c_files);
          v_copied := te__v1_bump(v_copied, array['te_approval_steps'], c_steps);
          v_copied := te__v1_bump(v_copied, array['te_line_decisions'], c_dec);
          v_copied := te__v1_bump(v_copied, array['te_audit_log'], c_audit);
          v_files_n := v_files_n + c_files;
          if v_no <> r_claim.claim_no then
            v_renum := v_renum || jsonb_build_array(jsonb_build_object(
                         'v1_table', 'travel_claims', 'v1_id', r_claim.id, 'company_id', co.id, 'v1_no', r_claim.claim_no, 'te_no', v_no));
          end if;
        exception when others then
          v_skipped := te__v1_bump(v_skipped, array['travel_claims', 'error']);
          v_list := te__v1_skip_row(v_list, 'travel_claims', r_claim.id, r_claim.claim_no, co.id, 'error', sqlerrm);
          v_skip_n := v_skip_n + 1;
        end;
      end loop;

      -- ==========================================================================
      -- TRIP ADVANCES
      -- v1 keeps an advance as three columns on the trip and nets it off on the
      -- claim (advance_adjusted). It has no record of a refund or a payroll
      -- recovery. So an advance is copied only when v1 itself shows it finished:
      -- every claim of the trip is PAID or REJECTED, and what the paid claims
      -- netted off adds up to exactly what was given. It is then SETTLED with
      -- nothing outstanding. Any other advance is left out and listed, with its
      -- amounts, for Finance to decide.
      -- ==========================================================================
      for r_trip in
        select t.* from travel_trips t
         where t.company_id = co.id
           and (coalesce(t.advance_approved, 0) > 0 or t.advance_paid_at is not null)
           and exists (select 1 from te_v1_map m where m.v1_table = 'travel_trips' and m.v1_id = t.id)
           and not exists (select 1 from te_v1_map m where m.v1_table = 'travel_trips.advance' and m.v1_id = t.id)
         order by t.created_at, t.trip_no, t.id
      loop
        select m.te_id into v_te_trip from te_v1_map m where m.v1_table = 'travel_trips' and m.v1_id = r_trip.id;
        select count(*) filter (where k.status not in ('PAID', 'REJECTED')),
               count(*) filter (where k.status = 'PAID' and k.advance_adjusted > 0
                                  and not exists (select 1 from te_v1_map m where m.v1_table = 'travel_claims' and m.v1_id = k.id)),
               coalesce(sum(least(k.advance_adjusted, k.total_approved)) filter (where k.status = 'PAID'), 0)
          into v_open, v_unmapped, v_netted
          from travel_claims k where k.trip_id = r_trip.id;

        v_reason := case
          when coalesce(r_trip.advance_approved, 0) <= 0 then 'advance_without_amount'
          when coalesce(r_trip.advance_requested, 0) <= 0 then 'advance_without_request'
          when v_open > 0 then 'advance_claims_open'
          when v_unmapped > 0 then 'advance_claim_not_copied'
          when v_netted <> r_trip.advance_approved then 'advance_not_settled'
        end;
        if v_reason is not null then
          v_skipped := te__v1_bump(v_skipped, array['travel_trips.advance', v_reason]);
          v_list := te__v1_skip_row(v_list, 'travel_trips.advance', r_trip.id, r_trip.trip_no, co.id, v_reason,
                      'advance given ' || coalesce(r_trip.advance_approved, 0) || ' (asked ' || coalesce(r_trip.advance_requested, 0)
                        || '), netted off on paid claims ' || v_netted || ', not accounted for in v1 '
                        || (coalesce(r_trip.advance_approved, 0) - v_netted) || '. Record it in v2 by hand if it is still owed.');
          v_skip_n := v_skip_n + 1;
          continue;
        end if;

        begin
          c_sett := 0; c_audit := 0;
          select t.trip_no into v_no from te_trips t where t.id = v_te_trip;
          insert into te_advances (company_id, advance_no, trip_id, employee_id, requested_amount, approved_amount,
                                   outstanding_amount, paid_on, status, created_at, updated_at)
          values (co.id, te_next_no(co.id, 'advance'), v_te_trip, r_trip.employee_id, r_trip.advance_requested,
                  r_trip.advance_approved, 0, (r_trip.advance_paid_at at time zone v_tz)::date, 'SETTLED',
                  r_trip.created_at,
                  coalesce((select max(coalesce(k.finance_actioned_at, k.paid_at)) from travel_claims k
                             where k.trip_id = r_trip.id and k.status = 'PAID' and k.advance_adjusted > 0), r_trip.updated_at))
          returning id, advance_no into v_te_adv, v_adv_no;
          insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_trips.advance', r_trip.id, 'te_advances', v_te_adv);

          if r_trip.advance_paid_at is not null then
            perform te__v1_log(co.id, 'advance', v_te_adv, v_adv_no, 'ADVANCE_PAID', null, null,
                      'Advance ' || te_rs(r_trip.advance_approved) || ' paid for trip ' || v_no || '.', r_trip.advance_paid_at);
            c_audit := c_audit + 1;
          end if;

          for r_x in
            select k.id, k.claim_no, least(k.advance_adjusted, k.total_approved) as amount,
                   coalesce(k.finance_actioned_at, k.paid_at, k.updated_at) as at, m.te_id
              from travel_claims k
              join te_v1_map m on m.v1_table = 'travel_claims' and m.v1_id = k.id
             where k.trip_id = r_trip.id and k.status = 'PAID' and least(k.advance_adjusted, k.total_approved) > 0
             order by coalesce(k.finance_actioned_at, k.paid_at, k.updated_at), k.claim_no
          loop
            insert into te_settlements (company_id, advance_id, claim_id, amount, kind, created_at)
            values (co.id, v_te_adv, r_x.te_id, r_x.amount, 'net_off', r_x.at)
            returning id into v_te_id;
            insert into te_v1_map (v1_table, v1_id, te_table, te_id) values ('travel_claims.advance_adjusted', r_x.id, 'te_settlements', v_te_id);
            c_sett := c_sett + 1;
            perform te__v1_log(co.id, 'advance', v_te_adv, v_adv_no, 'ADVANCE_ADJUSTED', null, null,
                      te_rs(r_x.amount) || ' adjusted against claim ' || (select c.claim_no from te_claims c where c.id = r_x.te_id) || '.', r_x.at);
            c_audit := c_audit + 1;
          end loop;

          perform te__v1_log(co.id, 'advance', v_te_adv, v_adv_no, 'V1_IMPORTED', null, null,
                    'Copied from the old travel module. Advance of v1 trip ' || r_trip.trip_no || ': given '
                      || te_rs(r_trip.advance_approved) || ', fully netted off against its claims.',
                    now(), false,
                    jsonb_build_object('advance_requested', r_trip.advance_requested, 'advance_approved', r_trip.advance_approved,
                                       'advance_paid_at', r_trip.advance_paid_at));
          c_audit := c_audit + 1;

          v_copied := te__v1_bump(v_copied, array['te_advances']);
          v_copied := te__v1_bump(v_copied, array['te_settlements'], c_sett);
          v_copied := te__v1_bump(v_copied, array['te_audit_log'], c_audit);
        exception when others then
          v_skipped := te__v1_bump(v_skipped, array['travel_trips.advance', 'error']);
          v_list := te__v1_skip_row(v_list, 'travel_trips.advance', r_trip.id, r_trip.trip_no, co.id, 'error', sqlerrm);
          v_skip_n := v_skip_n + 1;
        end;
      end loop;

      -- ==========================================================================
      -- NUMBERS: te_next_no() must never hand out a number that now exists
      -- The rule: for every trip or claim number of this company that is written
      -- the v2 way (TRP-<year>-<serial> or CLM-<year>-<serial>), the counter of
      -- that kind and year is raised to at least that serial. v1 trip numbers
      -- are written TRP-<year>-<serial> too, so v2 carries on after the highest
      -- v1 trip number of the year. v1 claim numbers start with EXP- and can
      -- never equal a v2 claim number (CLM-), so the claim counter does not move
      -- for them. Lines and advances get new v2 numbers from te_next_no() as
      -- they are copied, so those counters are already right.
      -- ==========================================================================
      for r_x in
        select q.kind, q.yr, max(q.n) as n
          from (select 'trip'::text as kind,
                       (regexp_match(t.trip_no, '^TRP-(\d{4})-(\d{1,15})$'))[1]::int as yr,
                       (regexp_match(t.trip_no, '^TRP-(\d{4})-(\d{1,15})$'))[2]::bigint as n
                  from te_trips t where t.company_id = co.id and t.trip_no ~ '^TRP-\d{4}-\d{1,15}$'
                union all
                select 'claim',
                       (regexp_match(c.claim_no, '^CLM-(\d{4})-(\d{1,15})$'))[1]::int,
                       (regexp_match(c.claim_no, '^CLM-(\d{4})-(\d{1,15})$'))[2]::bigint
                  from te_claims c where c.company_id = co.id and c.claim_no ~ '^CLM-\d{4}-\d{1,15}$') q
         group by q.kind, q.yr
         order by q.kind, q.yr
      loop
        select s.last_no into v_before from te_sequences s where s.company_id = co.id and s.kind = r_x.kind and s.year = r_x.yr;
        if coalesce(v_before, 0) < r_x.n then
          insert into te_sequences (company_id, kind, year, last_no) values (co.id, r_x.kind, r_x.yr, r_x.n)
          on conflict (company_id, kind, year) do update set last_no = excluded.last_no;
          v_seqs := v_seqs || jsonb_build_array(jsonb_build_object(
                      'company_id', co.id, 'kind', r_x.kind, 'year', r_x.yr,
                      'last_no_before', coalesce(v_before, 0), 'last_no_after', r_x.n));
        end if;
      end loop;

      -- ==========================================================================
      -- DO THE COPIED CLAIMS ADD UP TO v1?  (all runs so far, not only this one)
      -- ==========================================================================
      select v_recon || jsonb_build_array(jsonb_build_object(
               'company_id', co.id, 'company', co.company_name,
               'claims', count(*),
               'v1_claimed', coalesce(sum(k.total_claimed), 0),
               'v2_claimed', coalesce(sum(c.claimed_total), 0),
               'v1_approved_on_paid_claims', coalesce(sum(k.total_approved) filter (where k.status = 'PAID'), 0),
               'v2_approved', coalesce(sum(c.approved_total), 0),
               'v2_approved_on_lines', coalesce(sum((select sum(x.approved_amount) from te_expenses x where x.claim_id = c.id)), 0),
               'v1_net_on_paid_claims', coalesce(sum(k.net_payable - k.recovery_amount) filter (where k.status = 'PAID'), 0),
               'v2_net', coalesce(sum(c.net_amount), 0),
               'ok', coalesce(sum(k.total_claimed), 0) = coalesce(sum(c.claimed_total), 0)
                 and coalesce(sum(k.total_approved) filter (where k.status = 'PAID'), 0) = coalesce(sum(c.approved_total), 0)
                 and coalesce(sum(c.approved_total), 0) = coalesce(sum((select sum(x.approved_amount) from te_expenses x where x.claim_id = c.id)), 0)
                 and coalesce(sum(k.net_payable - k.recovery_amount) filter (where k.status = 'PAID'), 0) = coalesce(sum(c.net_amount), 0)))
        into v_recon
        from te_v1_map m
        join travel_claims k on k.id = m.v1_id
        join te_claims c on c.id = m.te_id
       where m.v1_table = 'travel_claims' and k.company_id = co.id;

      -- ==========================================================================
      -- FOR A PERSON TO REVIEW. Nothing below is applied to v2.
      -- ==========================================================================
      select to_jsonb(p) into v_pol
        from travel_policies p where p.company_id = co.id and p.is_active order by p.effective_from desc limit 1;
      v_policy_id := (v_pol->>'id')::uuid;

      v_review := v_review || jsonb_build_array(jsonb_build_object(
        'company_id', co.id, 'company', co.company_name,

        -- still moving in v1: the to-do list before cut-over
        'still_in_v1', jsonb_build_object(
          'claims', (select coalesce(jsonb_object_agg(q.status, jsonb_build_object('count', q.n, 'claimed', q.amt)), '{}'::jsonb)
                       from (select k.status, count(*) as n, sum(k.total_claimed) as amt
                               from travel_claims k
                              where k.company_id = co.id and k.status not in ('PAID', 'REJECTED')
                              group by k.status) q),
          'trips', (select coalesce(jsonb_object_agg(q.status, q.n), '{}'::jsonb)
                      from (select t.status, count(*) as n
                              from travel_trips t
                             where t.company_id = co.id and t.status not in ('CLOSED', 'SETTLED', 'REJECTED', 'CANCELLED')
                             group by t.status) q)),

        -- left in v1, by design
        'not_copied', jsonb_build_object(
          'journeys_not_yet_claimed', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(g.total_amount), 0))
                                         from travel_logs g where g.company_id = co.id and g.claim_id is null and g.status = 'LOGGED'),
          'vehicles', (select count(*) from travel_employee_vehicles v where v.company_id = co.id and v.is_active),
          'office_bookings', (select count(*) from travel_trip_bookings b join travel_trips t on t.id = b.trip_id where t.company_id = co.id),
          'guest_or_dropped_travellers_on_copied_trips',
                      (select count(*) from travel_trip_travellers tt
                        where tt.traveller_type <> 'LEADER'
                          and exists (select 1 from te_v1_map m where m.v1_table = 'travel_trips' and m.v1_id = tt.trip_id)
                          and not exists (select 1 from te_v1_map m where m.v1_table = 'travel_trip_travellers' and m.v1_id = tt.id)
                          and exists (select 1 from travel_trips t where t.id = tt.trip_id and t.company_id = co.id)),
          'approvals_without_a_person_this_run', v_no_person),

        -- v1 mileage rates beside the v2 vehicle types. They are not the same list:
        -- v1 pays a car by fuel and engine size, v2 by body type. Only two rows pair up.
        'rates', jsonb_build_object(
          'v1', (select coalesce(jsonb_agg(jsonb_build_object(
                          'what', coalesce(r.type_code, r.vehicle_type || '/' || r.fuel_type || case when r.cc_band <> 'NA' then '/' || r.cc_band else '' end),
                          'rate_per_km', r.rate_per_km, 'effective_from', r.effective_from)
                          order by r.type_code nulls first, r.vehicle_type, r.fuel_type, r.cc_band), '[]'::jsonb)
                   from (select distinct on (coalesce(x.type_code, '~'), coalesce(x.vehicle_type, '~'), coalesce(x.fuel_type, '~'), x.cc_band) x.*
                           from travel_mileage_rates x
                          where x.policy_id = v_policy_id and x.effective_from <= v_today
                          order by coalesce(x.type_code, '~'), coalesce(x.vehicle_type, '~'), coalesce(x.fuel_type, '~'), x.cc_band, x.effective_from desc) r),
          'v2', (select coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'name', v.name, 'method', v.method,
                                                               'rate_per_km', v.rate_per_km, 'is_active', v.is_active) order by v.sort_order, v.code), '[]'::jsonb)
                   from te_vehicle_types v where v.company_id = co.id),
          'pairs', (select coalesce(jsonb_agg(jsonb_build_object('v1', q.v1, 'v1_rate', q.v1_rate, 'v2', q.v2, 'v2_rate', q.v2_rate,
                                                                  'differs', q.v1_rate is distinct from q.v2_rate) order by q.v1), '[]'::jsonb)
                      from (select w.v1, w.v2,
                                   (select x.rate_per_km from travel_mileage_rates x
                                     where x.policy_id = v_policy_id and x.type_code is null and x.vehicle_type = w.vt and x.fuel_type = w.ft
                                       and x.effective_from <= v_today
                                     order by x.effective_from desc limit 1) as v1_rate,
                                   -- what v2 pays per km today: the fixed rate, or fuel price / km per unit + wear
                                   (select case when v.method = 'fixed' then v.rate_per_km
                                                else round(((select (s.fuel_prices->>v.fuel)::numeric from te_settings s where s.company_id = co.id)
                                                            / nullif(v.km_per_unit, 0)) + v.wear_per_km, 2) end
                                      from te_vehicle_types v where v.company_id = co.id and v.code = w.v2) as v2_rate
                              from (values ('TWO_WHEELER/PETROL', 'TWO_WHEELER', 'PETROL', 'bike'),
                                           ('CAR/ELECTRIC', 'CAR', 'ELECTRIC', 'ev')) as w(v1, vt, ft, v2)) q
                     where q.v1_rate is not null)),

        -- meal and hotel limits by grade and city class, only where the two differ.
        -- v1 METRO / TIER2 / OTHER are read as v2 metro / tier1 / rest.
        'limits', (select jsonb_build_object(
                            'differences', coalesce(jsonb_agg(jsonb_build_object('grade', q.grade, 'tier', q.tier, 'limit', q.item, 'v1', q.v1, 'v2', q.v2)
                                                              order by q.grade, q.tier, q.item) filter (where q.v2 is not null and q.v2 <> q.v1), '[]'::jsonb),
                            'v1_grades_with_no_v2_limits', coalesce(jsonb_agg(distinct q.grade) filter (where q.v2 is null), '[]'::jsonb))
                     from (select distinct on (e.grade, cc.tier, e.type_code)
                                  e.grade, cc.tier,
                                  case e.type_code when 'FOOD' then 'meals_per_day' else 'hotel_per_night' end as item,
                                  e.limit_value as v1,
                                  case e.type_code when 'FOOD' then g.meals_per_day else g.hotel_per_night end as v2
                             from travel_entitlements e
                            cross join lateral unnest(case e.city_class when 'METRO' then array['metro'] when 'TIER2' then array['tier1']
                                                                        when 'OTHER' then array['rest'] else array['metro', 'tier1', 'rest'] end) as cc(tier)
                             left join te_grade_limits g on g.company_id = co.id and g.grade = e.grade and g.tier = cc.tier
                            where e.policy_id = v_policy_id and e.limit_value is not null
                              and ((e.type_code = 'FOOD' and e.limit_basis = 'PER_DAY') or (e.type_code = 'HOTEL' and e.limit_basis = 'PER_NIGHT'))
                            order by e.grade, cc.tier, e.type_code, (e.city_class is null)) q),

        'settings', (select coalesce(jsonb_agg(jsonb_build_object('setting', q.what, 'v1', q.v1, 'v2', q.v2)), '[]'::jsonb)
                       from (select 'bill age, days'::text as what, (v_pol->>'bill_max_age_days')::numeric as v1,
                                    (select s.bill_age_days::numeric from te_settings s where s.company_id = co.id) as v2
                             union all
                             select 'distance tolerance, %', (v_pol->>'distance_variance_tolerance')::numeric,
                                    (select s.mileage_tolerance_pct from te_settings s where s.company_id = co.id)) q
                      where q.v1 is not null and q.v1 is distinct from q.v2),

        -- the chain is built by the admin in v2; this only says what v1 was doing
        'approval_chain', jsonb_build_object(
          'v1', case when v_pol is null then 'no active v1 policy'
                     when coalesce((v_pol->>'rm_stage_enabled')::boolean, false) and coalesce((v_pol->>'hr_stage_enabled')::boolean, true) then 'Reporting manager, then HR Head, then Finance'
                     when coalesce((v_pol->>'rm_stage_enabled')::boolean, false) and coalesce((v_pol->>'hr_fallback_only')::boolean, false) then 'Reporting manager, then Finance. HR Head only when no manager is mapped'
                     when coalesce((v_pol->>'rm_stage_enabled')::boolean, false) then 'Reporting manager, then Finance'
                     when coalesce((v_pol->>'hr_stage_enabled')::boolean, true) then 'HR Head, then Finance'
                     else 'Finance only' end,
          'v2', (select coalesce(jsonb_agg(l.label order by l.seq), '[]'::jsonb)
                   from te_workflows w join te_workflow_levels l on l.workflow_id = w.id
                  where w.company_id = co.id and w.code = 'claim')),

        -- copied lines whose v1 type has no v2 category
        'filed_under_misc', (select coalesce(jsonb_object_agg(q.type_code, q.n), '{}'::jsonb)
                               from (select l.type_code, count(*) as n
                                       from te_v1_map m
                                       join travel_claim_lines l on l.id = m.v1_id
                                       join travel_claims k on k.id = l.claim_id
                                      where m.v1_table = 'travel_claim_lines' and k.company_id = co.id
                                        and upper(l.type_code) <> 'MISC' and te__v1_category(l.type_code) = 'misc'
                                      group by l.type_code) q),

        'approved_amounts_filled_from_header', (select coalesce(jsonb_agg(distinct c.claim_no), '[]'::jsonb)
                                                  from te_expenses x join te_claims c on c.id = x.claim_id
                                                 where x.company_id = co.id and (x.details->'v1'->>'approved_amount_inferred') = 'true'),

        -- copied as domestic; v1 cannot say whether the trip left India
        'trips_that_may_have_been_international',
                    (select coalesce(jsonb_agg(distinct t.trip_no), '[]'::jsonb)
                       from te_expenses x join te_trips t on t.id = x.trip_id
                      where x.company_id = co.id and x.details->'v1'->'line'->>'type_code' in ('VISA', 'FOREX_MARKUP', 'TRAVEL_INS')
                        and exists (select 1 from te_v1_map m where m.te_table = 'te_trips' and m.te_id = t.id)),

        -- do NOT reopen these in v2 without checking: v1 let the employee file the same journeys again
        'rejected_claims_filed_again_in_v1',
                    (select coalesce(jsonb_agg(jsonb_build_object('v2_claim', q.claim_no, 'filed_again_as', q.again) order by q.claim_no), '[]'::jsonb)
                       from (select c.claim_no, string_agg(distinct k2.claim_no, ', ' order by k2.claim_no) as again
                               from te_v1_map m
                               join travel_claims k on k.id = m.v1_id and k.company_id = co.id and k.status = 'REJECTED'
                               join te_claims c on c.id = m.te_id
                               join travel_claim_lines l on l.claim_id = k.id
                               join travel_logs g on g.id = l.travel_log_id and g.claim_id <> k.id
                               join travel_claims k2 on k2.id = g.claim_id
                              where m.v1_table = 'travel_claims'
                              group by c.claim_no) q),

        'files', jsonb_build_object(
          'copied_this_run', v_files_n,
          'where_the_files_are', 'storage bucket onboarding-docs, at the path in te_expense_files.storage_path. Nothing was moved.')
      ));
    end loop;   -- companies

    v_report := jsonb_build_object(
      'dry_run', v_dry,
      'what_happened', case when v_dry then 'PREVIEW. Nothing was written. This is what a real run would do now.'
                            else 'COPIED. Rows listed under "copied" are now in the te_ tables.' end,
      'company_filter', p_company_id,
      'ran_at', now(),
      'companies', v_companies,
      'copied', v_copied,
      'already_copied_before', v_already,
      'skipped', v_skipped,
      'skipped_total', v_skip_n,
      'skipped_list', v_list,
      'skipped_list_is_complete', v_skip_n <= 50,
      'renumbered', v_renum,
      'sequences_raised', v_seqs,
      'reconciliation', v_recon,
      'review', v_review,
      'assumptions', jsonb_build_array(
        'te_trips.pattern is ''oneway'' for every copied trip. v1 records one from-city and one to-city and nothing about the way back.',
        'te_trips.scope is ''local'' for a v1 LOCAL trip and ''domestic'' for a v1 OUTSTATION trip. v1 has no country and no currency; see review.trips_that_may_have_been_international.',
        'te_trips.name is the first 80 characters of the v1 purpose. v1 trips have no name.',
        'te_expenses.bill_amount is 0 on every copied line. v1 has no column for the amount on the bill.',
        'te_expenses.eligible_amount equals the claimed amount. v1 applied its limits when the journey was logged, before the claim.',
        'A v1 PAID claim is SETTLED in v2 and its settled_at is the v1 paid_at. A v1 REJECTED claim has approved 0 and net 0 in v2, whatever v1 had approved before it was rejected.',
        'te_claims.net_amount is v1 net_payable minus v1 recovery_amount, so it is negative when the advance was larger than what was approved.',
        'Toll and parking that v1 added to a journey stay inside that line. The split is in te_expenses.details.',
        'te_claims.risk_band is ''Low'' and risk_score is 0 on every copied claim: v1 did not score risk. The v1 flags are kept on each line in te_expenses.details.'));

    if v_dry then
      -- leave the inner block the hard way: everything it wrote is rolled back
      raise exception 'te_backfill_from_v1 preview: rolling back' using errcode = 'TE150';
    end if;
  exception when sqlstate 'TE150' then
    null;   -- the preview. v_report was filled in before the rollback and is still here.
  end;

  return v_report;
end;
$$;

comment on function te_backfill_from_v1(uuid, boolean) is
  'Copies FINISHED v1 travel history (travel_ tables) into v2 (te_ tables). '
  'te_backfill_from_v1(null, true) previews and writes nothing; (null, false) copies. '
  'Safe to call again: te_v1_map remembers what was copied. v1 rows are never changed. '
  'See docs/parts/v1-to-v2-mapping.md.';


-- ============================================================================
-- SECTION 4 — WHO MAY RUN IT
-- A function in the public schema can be called through the API by anyone
-- holding the anon key, which the browser has. This one moves money history,
-- so only the SQL editor and the service-role key keep the right to run it.
-- ============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'te_backfill_from_v1(uuid, boolean)',
    'te__v1_log(uuid, text, uuid, text, text, uuid, text, text, timestamptz, boolean, jsonb)',
    'te__v1_free_no(text, uuid, text, uuid)',
    'te__v1_category(text)',
    'te__v1_skip_row(jsonb, text, uuid, text, uuid, text, text)',
    'te__v1_bump(jsonb, text[], int)']
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
