-- 144_te_tables.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  1 of 6: TABLES AND INDEXES ONLY
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- WHAT THIS IS
--
-- The schema for the redesigned Travel & Expense module (spec v6.7): one named
-- Trip for local, domestic and international travel, split into Legs that are
-- GPS-tracked or checked in, Stops on the way, every expense of the trip in
-- one Claim, an approval chain the admin builds, Finance levels, advances and
-- payouts.
--
-- RUN ORDER      144 (tables) -> 145 (core functions, views, RLS)
--                -> 146 (trips, legs, expenses) -> 147 (claims, money)
--                -> 148 (read models for the app) -> 149 (seed).
--                150 is optional (copy v1 travel_ data across).
--                151 is optional (seed a new company automatically, tighter RLS).
--                Verify with database/tests/verify.sql.
--
-- WHY NEW te_ TABLES AND NOT ALTERs ON travel_*
--
-- Migration 049 created 19 travel_ tables for v1. v2 changes the shape of
-- almost every one of them: a trip now has points, segments and legs; a claim
-- status is no longer PENDING_RM / PENDING_HR / PENDING_FINANCE because the
-- chain is no longer fixed; an expense line exists before any claim does.
-- Altering v1 in place would leave two status vocabularies on the same rows
-- and break the v1 screens while v2 is being built. So v2 gets its own te_
-- tables, v1 keeps working untouched until cut-over, and 150 copies v1 rows
-- across for anyone who needs the history.
--
-- WHAT IS REUSED FROM v1 (not duplicated here)
--   travel_periods, travel_period_audit   expense-month OPEN / CLOSED / LOCKED
--   travel_is_employee_active()           the date-of-leaving guard
--   finance_team, finance_work_items      who is Finance, and the Finance queue
--   employee_relationships, departments.hod_employee_id, companies.md_employee_id
--   ess_role_delegations                  approver delegation
--   ess_notifications                     Inbox / bell
--
-- NOTHING HERE TOUCHES AN EXISTING TABLE OR ROW. Every object is new and
-- prefixed te_.
--
-- ASSUMPTIONS (same as 049, re-checked against the repo on 9 Oct 2026)
--   companies(id) uuid pk · employees(id) uuid pk · gen_random_uuid() exists
--   travel_periods(id) exists (migration 049 has been run)
--
-- CONVENTIONS
--   · money is numeric(14,2) in rupees unless a currency column says otherwise
--   · every status is text + CHECK, never a Postgres enum (enums cannot be
--     edited inside the single transaction the SQL editor runs)
--   · human numbers (trip_no, claim_no …) are unique PER COMPANY, fixing the
--     v1 collision where the first claim of a second company reused a number
-- ============================================================================


-- ============================================================================
-- SECTION 1 — SETTINGS (one row per company)
-- ============================================================================

create table if not exists te_settings (
  company_id                uuid primary key references companies(id) on delete cascade,

  -- bills and claims
  bill_age_days             int  not null default 90  check (bill_age_days between 1 and 730),
  claim_deadline_days       int  not null default 15  check (claim_deadline_days between 1 and 365),
  notice_days               int  not null default 3   check (notice_days >= 0),
  receipt_above             numeric(14,2) not null default 200  check (receipt_above >= 0),
  no_bill_per_day           numeric(14,2) not null default 300  check (no_bill_per_day >= 0),
  client_per_head           numeric(14,2) not null default 1500 check (client_per_head >= 0),
  misc_per_claim            numeric(14,2) not null default 1000 check (misc_per_claim >= 0),
  comm_per_claim            numeric(14,2) not null default 1500 check (comm_per_claim >= 0),

  -- advances
  advance_max_pct           int  not null default 80 check (advance_max_pct between 0 and 100),
  grace_days                int  not null default 7  check (grace_days >= 0),

  -- tolerances
  mileage_tolerance_pct     numeric(5,2) not null default 10 check (mileage_tolerance_pct between 0 and 100),
  estimate_tolerance_pct    numeric(5,2) not null default 10 check (estimate_tolerance_pct between 0 and 100),

  -- claims without prior trip approval
  post_facto                text not null default 'limited' check (post_facto in ('allowed','limited','blocked')),
  post_facto_per_quarter    int  not null default 2 check (post_facto_per_quarter >= 0),

  -- finance desk
  fast_track_amount         numeric(14,2) not null default 5000 check (fast_track_amount >= 0),
  sample_pct                numeric(5,2)  not null default 10   check (sample_pct between 0 and 100),

  -- approvals
  fallback_approver_id      uuid references employees(id) on delete set null,
  reminder_days             int  not null default 2 check (reminder_days >= 0),
  escalate_days             int  not null default 5 check (escalate_days >= 0),
  auto_approve_on_timeout   boolean not null default false,

  -- estimates used when a plan has a flight and no fare yet
  dom_air_estimate          numeric(14,2) not null default 6000,
  intl_air_estimate         numeric(14,2) not null default 65000,

  -- a grade that has no row in te_grade_limits is treated as this one
  default_grade             text not null default 'DEFAULT',

  -- Groups of settings the admin edits as one card. Stored as JSON in the same
  -- shape the rules engine reads, so a new switch is a seed change and not a
  -- migration. Keys are documented in docs/06-DATABASE.md.
  gps_rules                 jsonb not null default '{}'::jsonb,   -- Trip and GPS rules
  vehicle_rules             jsonb not null default '{}'::jsonb,   -- RC check, ownership, insurance
  fuel_prices               jsonb not null default '{}'::jsonb,   -- petrol, diesel, cng, ev
  limit_basis               jsonb not null default '{}'::jsonb,   -- strict or pooled, per limit
  breach_actions            jsonb not null default '{}'::jsonb,   -- cap, justify or block, per limit
  risk_weights              jsonb not null default '{}'::jsonb,   -- low, medium, high
  risk_bands                jsonb not null default '{}'::jsonb,   -- medium from, high from
  zone_a_countries          text[] not null default '{}',         -- international zone A; the rest is zone B
  extra                     jsonb not null default '{}'::jsonb,

  -- bumped on every change; copied onto a trip when it is approved
  version                   int  not null default 1,
  updated_by                uuid references employees(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);


-- ============================================================================
-- SECTION 2 — MASTERS (per company; every row can be switched off, none is
-- deleted, so an old claim still resolves its codes)
-- ============================================================================

create table if not exists te_categories (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null,
  name          text not null,
  icon          text,
  grp           text,                                  -- Travel | Stay | Food | Local travel | Other
  needs_trip    boolean not null default false,
  proof         text not null default 'above' check (proof in ('always','above','none')),
  gl_code       text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  updated_by    uuid references employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists te_modes (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  code                  text not null,                 -- own, company, cab, auto, public, rental, train, bus, flight
  name                  text not null,
  icon                  text,
  -- how the leg is paid: km = per-km rate, bill = on a bill, nobill = fare
  -- without a bill, ticket = on the ticket, none = logged only
  basis                 text not null check (basis in ('km','bill','nobill','ticket','none')),
  scope_local           boolean not null default true,
  scope_domestic        boolean not null default true,
  scope_international   boolean not null default false,
  gps                   text not null default 'track' check (gps in ('track','checkin')),
  stops_allowed         boolean not null default true,
  fare_ceiling_per_km   numeric(10,2) not null default 0,   -- 0 = no ceiling
  min_fare              numeric(10,2),
  est_per_km            numeric(10,2),                 -- used only for the estimate
  est_min               numeric(10,2),
  category_code         text,                          -- the expense category a leg of this mode files under
  sort_order            int not null default 0,
  is_active             boolean not null default true,
  updated_by            uuid references employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, code),
  -- a flight is never a local trip; this is a rule of the product, not a setting
  constraint te_modes_flight_never_local check (not (code = 'flight' and scope_local)),
  -- nothing is tracked in the air
  constraint te_modes_flight_checkin check (code <> 'flight' or gps = 'checkin')
);

create table if not exists te_vehicle_types (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null,                         -- bike, hatch, sedan, suv, ev
  name          text not null,
  example       text,
  method        text not null default 'fixed' check (method in ('fixed','fuel')),
  rate_per_km   numeric(8,2) not null check (rate_per_km >= 0),   -- used when method = fixed
  fuel          text check (fuel in ('petrol','diesel','cng','ev')),
  km_per_unit   numeric(8,2),                          -- km per litre, kg or kWh; used when method = fuel
  wear_per_km   numeric(8,2) not null default 0,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  updated_by    uuid references employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);

-- Every rate change is kept. A paid claim keeps the rate it was paid at
-- because the rate is also copied onto the expense line (te_expenses.rate_applied).
create table if not exists te_vehicle_rate_history (
  id               uuid primary key default gen_random_uuid(),
  vehicle_type_id  uuid not null references te_vehicle_types(id) on delete cascade,
  company_id       uuid not null,
  method           text not null,
  rate_per_km      numeric(8,2) not null,
  km_per_unit      numeric(8,2),
  wear_per_km      numeric(8,2),
  effective_from   timestamptz not null default now(),
  set_by           uuid references employees(id) on delete set null
);
create index if not exists idx_te_rate_hist on te_vehicle_rate_history (vehicle_type_id, effective_from desc);

create table if not exists te_place_types (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,                           -- corp, branch, factory, warehouse, client …
  name        text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  updated_by  uuid references employees(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists te_stop_reasons (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  code             text not null,                      -- meet, pick, goods, fuel, meal, toll, rest, vehicle, other
  name             text not null,
  -- a business stop extends the route that is paid; a personal stop does not
  is_business      boolean not null default false,
  typical_minutes  int,
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  updated_by       uuid references employees(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, code)
);

-- Limits by grade and by the tier of the city the employee is in that day.
create table if not exists te_grade_policies (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  grade        text not null,                          -- employees.grade, or DEFAULT
  air_class    text not null default 'Economy' check (air_class in ('Economy','Premium Economy','Business')),
  train_class  text not null default '3A',
  sort_order   int not null default 0,
  updated_by   uuid references employees(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, grade)
);

create table if not exists te_grade_limits (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  grade                text not null,
  tier                 text not null check (tier in ('metro','tier1','rest','intlA','intlB')),
  hotel_per_night      numeric(14,2) not null check (hotel_per_night >= 0),
  meals_per_day        numeric(14,2) not null check (meals_per_day >= 0),
  conveyance_per_day   numeric(14,2) not null check (conveyance_per_day >= 0),
  updated_by           uuid references employees(id) on delete set null,
  updated_at           timestamptz not null default now(),
  unique (company_id, grade, tier)
);

create table if not exists te_city_tiers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  city         text not null,
  state_code   text,                                   -- 2-digit GST state code, '06' = Haryana
  tier         text not null check (tier in ('metro','tier1','rest')),
  -- cities that share one airport and one main station carry the same region
  hub_region   text,
  is_active    boolean not null default true,
  unique (company_id, city)
);

-- The 55 validation checks. One row per check per company; the admin can turn
-- a check off or change what it does. is_live = false means the product does
-- not evaluate it yet (it needs an integration), so it is shown but greyed.
create table if not exists te_checks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,                           -- A1 … G13
  layer       text not null check (layer in ('A','B','C','D','E','F','G')),
  title       text not null,
  action      text not null check (action in ('block','warn','justify','cap','reroute','report','sample')),
  severity    text not null default '' check (severity in ('','low','medium','high')),
  is_enabled  boolean not null default true,
  is_live     boolean not null default true,
  params      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  updated_by  uuid references employees(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);


-- ============================================================================
-- SECTION 3 — PLACES AND HUBS
-- A place is a start, end or stop: a company site, a client, an airport, or an
-- address the employee typed or pinned by GPS.
-- ============================================================================

create table if not exists te_places (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  -- null = a company place every employee can pick; set = one employee's own
  owner_employee_id  uuid references employees(id) on delete cascade,
  source             text not null default 'company' check (source in ('company','saved','gps','address','hub')),
  place_type         text,                             -- te_place_types.code
  short_name         text not null,
  name               text,
  address            text not null,
  city               text,
  state              text,
  pin_code           text,
  country            text not null default 'India',
  lat                numeric(10,7) not null check (lat between -90 and 90),
  lng                numeric(10,7) not null check (lng between -180 and 180),
  gps_accuracy_m     numeric(8,2),                     -- when the place was pinned by GPS
  code               text,                             -- IATA or station code for a hub
  is_active          boolean not null default true,
  created_by         uuid references employees(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- an address in India carries a 6-digit PIN; abroad the postal code is optional
  constraint te_places_pin check (country <> 'India' or pin_code is null or pin_code ~ '^[1-9][0-9]{5}$')
);
create index if not exists idx_te_places_company on te_places (company_id) where owner_employee_id is null and is_active;
create index if not exists idx_te_places_owner   on te_places (owner_employee_id) where is_active;

-- Which airport and which station serve a city or a region. A flight or train
-- between two cities is split into "ride to the hub", "the flight", "ride from
-- the hub" using this table.
create table if not exists te_hubs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  area        text not null,                           -- a city, or a te_city_tiers.hub_region such as NCR
  kind        text not null check (kind in ('air','rail')),
  place_id    uuid not null references te_places(id) on delete cascade,
  unique (company_id, area, kind)
);


-- The road distance between two places, as the map provider gave it. Asked
-- once, kept: the same pair is priced the same way every time, and a claim
-- can be re-checked later without a new map call.
create table if not exists te_routes (
  company_id     uuid not null references companies(id) on delete cascade,
  from_place_id  uuid not null references te_places(id) on delete cascade,
  to_place_id    uuid not null references te_places(id) on delete cascade,
  km             numeric(10,1) not null check (km >= 0),
  minutes        int,
  polyline       text,                                 -- encoded route line, for the map
  provider       text not null default 'google',
  fetched_at     timestamptz not null default now(),
  primary key (from_place_id, to_place_id)
);


-- ============================================================================
-- SECTION 4 — APPROVAL WORKFLOW (the chain the admin builds)
-- Two workflows per company: 'claim' and 'trip'. A workflow is an ordered list
-- of levels. A claim workflow ends with one or more finance levels.
-- ============================================================================

create table if not exists te_workflows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null check (code in ('claim','trip')),
  version     int  not null default 1,
  updated_by  uuid references employees(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists te_workflow_levels (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid not null references te_workflows(id) on delete cascade,
  seq            int  not null,
  kind           text not null check (kind in ('approve','finance')),
  label          text not null,
  -- rm = reporting manager L1, rm2 = the manager's manager (L2), hod = head of
  -- department, person = person_id, finance_team = anyone in finance_team
  approver_type  text not null check (approver_type in ('rm','rm2','hod','person','finance_team')),
  person_id      uuid references employees(id) on delete set null,
  -- [] = always. Otherwise the level applies when ANY condition is true:
  -- {"t":"amount","v":30000} {"t":"scope","v":"international"} {"t":"postFacto"}
  -- {"t":"exception"} {"t":"risk"}
  conditions     jsonb not null default '[]'::jsonb,
  unique (workflow_id, seq),
  constraint te_level_person check (approver_type <> 'person' or person_id is not null),
  constraint te_level_kind_who check (
    (kind = 'finance' and approver_type in ('finance_team','person')) or
    (kind = 'approve' and approver_type in ('rm','rm2','hod','person'))
  )
);


-- ============================================================================
-- SECTION 5 — VEHICLES (any vehicle the employee drives, checked against its RC)
-- ============================================================================

create table if not exists te_employee_vehicles (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  reg_no              text not null,                   -- as shown: HR26 DK 4821
  reg_no_norm         text not null,                   -- upper case, letters and digits only: HR26DK4821
  vehicle_type_code   text not null,                   -- the type that is PAID (from the RC when there is one)
  declared_type_code  text,                            -- what the employee said it was
  ownership           text not null default 'self' check (ownership in ('self','family','other')),
  rc_source           text check (rc_source in ('vahan','photo')),
  rc                  jsonb,                           -- maker, model, class, body, fuel, owner, registered on
  rc_owner_name       text,
  rc_owner_match      text check (rc_owner_match in ('match','partial','no')),
  rc_valid_to         date,
  insurance_valid_to  date,
  puc_valid_to        date,
  rc_checked_at       timestamptz,
  rc_file_url         text,                            -- the RC photo when Vahan has no record
  is_verified         boolean not null default false,
  verified_via        text check (verified_via in ('rc','hr')),
  verified_by         uuid references employees(id) on delete set null,
  verified_at         timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- one live record per vehicle number in a company: a second employee cannot add it
create unique index if not exists uq_te_vehicle_reg on te_employee_vehicles (company_id, reg_no_norm) where is_active;
create index if not exists idx_te_vehicle_emp on te_employee_vehicles (employee_id) where is_active;


-- ============================================================================
-- SECTION 6 — TRIPS
-- ============================================================================

create table if not exists te_trips (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  trip_no            text not null,                    -- TRP-2026-0089
  employee_id        uuid not null references employees(id),
  name               text not null,
  scope              text not null check (scope in ('local','domestic','international')),
  pattern            text not null check (pattern in ('oneway','round','multi')),
  -- PRE_APPROVED = planned before travel; POST_FACTO = "I already travelled"
  origin             text not null default 'PRE_APPROVED' check (origin in ('PRE_APPROVED','POST_FACTO')),
  purpose            text not null,
  project            text,
  pax                int  not null default 1 check (pax between 1 and 50),
  stay_by            text not null default 'self' check (stay_by in ('self','desk')),
  start_date         date not null,
  end_date           date not null,
  from_label         text,
  to_label           text,
  country            text,
  -- {"travel":…,"desk":…,"hotel":…,"meals":…,"conv":…}
  estimate           jsonb not null default '{}'::jsonb,
  estimate_total     numeric(14,2) not null default 0,
  self_estimate      numeric(14,2) not null default 0,   -- the part the employee pays; sets the advance cap
  planned_km         numeric(10,1) not null default 0,   -- road km of every leg, flights left out
  advance_requested  numeric(14,2) not null default 0,
  post_facto_reason  text,
  post_facto_note    text,
  -- Stored statuses. ONGOING, COMPLETED, MISSED and EXPIRED are worked out
  -- from the legs and the dates by te_trip_status(); see 145.
  status             text not null default 'DRAFT'
                       check (status in ('DRAFT','PENDING_APPROVAL','SENT_BACK','APPROVED',
                                         'CLAIMED','CLOSED','CANCELLED','REJECTED')),
  -- why extra levels were added to the chain, in words, for the employee
  chain_notes        text[] not null default '{}',
  workflow_version   int,
  -- the settings and limits in force when the trip was approved
  policy_snapshot    jsonb,
  policy_version     int,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, trip_no),
  check (end_date >= start_date)
);
create index if not exists idx_te_trips_emp   on te_trips (employee_id, status);
create index if not exists idx_te_trips_dates on te_trips (company_id, start_date, end_date);

-- The places of a trip in order: start, any number of stops and destinations,
-- and the way back when it is a round trip.
create table if not exists te_trip_points (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references te_trips(id) on delete cascade,
  seq         int  not null,                           -- 0 = start
  place_id    uuid not null references te_places(id),
  place_type  text,
  what        text,                                    -- what the employee will do there
  arrive_on   date,
  leave_on    date,
  is_return   boolean not null default false,
  unique (trip_id, seq)
);

-- How the employee travels between point seq and point seq + 1.
create table if not exists te_trip_segments (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references te_trips(id) on delete cascade,
  seq                int  not null,
  mode               text not null,                    -- te_modes.code
  booked_by          text not null default 'self' check (booked_by in ('self','desk')),
  vehicle_id         uuid references te_employee_vehicles(id),
  first_mile_mode    text,                             -- ride to the airport or station
  last_mile_mode     text,                             -- ride from it
  hub_from_place_id  uuid references te_places(id),    -- picked by the employee where no hub is set up
  hub_to_place_id    uuid references te_places(id),
  unique (trip_id, seq)
);

-- Who travels together. The employee who raised the trip is not listed here;
-- pax on the trip counts them.
create table if not exists te_trip_people (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references te_trips(id) on delete cascade,
  seq              int  not null,
  employee_id      uuid references employees(id),      -- set when the code was found in EZER
  emp_code_entered text not null,
  name_entered     text not null,
  found_in_ezer    boolean not null default false,
  unique (trip_id, seq)
);
create unique index if not exists uq_te_trip_people_emp on te_trip_people (trip_id, employee_id) where employee_id is not null;
create index if not exists idx_te_trip_people_emp on te_trip_people (employee_id);


-- ============================================================================
-- SECTION 7 — LEGS, GPS AND STOPS
-- A leg is one ride, flight or train inside a trip. It is tracked, checked and
-- paid on its own.
-- ============================================================================

create table if not exists te_legs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  trip_id           uuid not null references te_trips(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  leg_no            int  not null,
  segment_seq       int,                               -- null for a leg added during the trip
  -- first = ride to the hub, main = the segment itself, last = ride from the hub,
  -- return = the way back, extra = added during the trip
  kind              text not null default 'main' check (kind in ('first','main','last','return','extra')),
  from_place_id     uuid not null references te_places(id),
  to_place_id       uuid not null references te_places(id),
  leg_date          date not null,
  purpose           text,
  mode              text not null,
  vehicle_id        uuid references te_employee_vehicles(id),
  booked_by         text not null default 'self' check (booked_by in ('self','desk')),
  gps_mode          text not null default 'track' check (gps_mode in ('track','checkin')),
  planned_km        numeric(10,1) not null default 0,
  status            text not null default 'PLANNED'
                      check (status in ('PLANNED','ACTIVE','PAUSED','ENDED','SUBMITTED','SKIPPED','CANCELLED')),

  -- start and end fixes
  started_at        timestamptz,
  start_lat         numeric(10,7),
  start_lng         numeric(10,7),
  start_accuracy_m  numeric(8,2),
  start_address     text,
  start_off_m       int,                               -- metres from the planned start point
  ended_at          timestamptz,
  end_lat           numeric(10,7),
  end_lng           numeric(10,7),
  end_accuracy_m    numeric(8,2),
  end_address       text,
  end_off_m         int,

  -- what the trail adds up to (filled when the leg ends)
  gps_km            numeric(10,2),                     -- distance along the recorded points
  route_km          numeric(10,2),                     -- shortest map route through the business stops
  payable_km        numeric(10,2),                     -- after tolerance and the daily cap
  gps_points        int,
  gps_gap_max_sec   int,
  gps_max_speed_kmh numeric(8,2),
  moving_minutes    int,
  route_polyline    text,                              -- encoded, kept after the raw pings are purged
  -- everything the rules engine worked out from the trail (jStats), kept so a
  -- claim can be re-checked after the raw pings are purged
  stats             jsonb,
  device            jsonb,                             -- platform, app version, mock-location flag

  -- a leg without a GPS record
  is_manual         boolean not null default false,
  no_gps_reason     text,
  skip_reason       text,
  added_reason      text,                              -- why an extra leg was added

  filed_at          timestamptz,
  expense_id        uuid,                              -- FK added after te_expenses
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (trip_id, leg_no) deferrable initially immediate
);
create index if not exists idx_te_legs_expense on te_legs (expense_id) where expense_id is not null;
create index if not exists idx_te_legs_emp_date on te_legs (employee_id, leg_date);
-- ONE LEG RUNS AT A TIME per employee. The database refuses a second one.
create unique index if not exists uq_te_leg_running on te_legs (employee_id) where status in ('ACTIVE','PAUSED');

-- The raw GPS trail. One row per fix. Purged after gps_rules.retentionDays by
-- te_daily(); the summary columns and the polyline on te_legs stay.
create table if not exists te_leg_pings (
  leg_id       uuid not null references te_legs(id) on delete cascade,
  seq          int  not null,
  recorded_at  timestamptz not null,
  lat          numeric(10,7) not null,
  lng          numeric(10,7) not null,
  accuracy_m   numeric(8,2),
  speed_kmh    numeric(8,2),
  is_mock      boolean,
  primary key (leg_id, seq)
);

create table if not exists te_leg_stops (
  id           uuid primary key default gen_random_uuid(),
  leg_id       uuid not null references te_legs(id) on delete cascade,
  seq          int  not null,
  reason_code  text not null,                          -- te_stop_reasons.code
  is_business  boolean not null default false,         -- copied from the reason when the stop is made
  note         text,
  lat          numeric(10,7) not null,
  lng          numeric(10,7) not null,
  accuracy_m   numeric(8,2),
  place_name   text,
  address      text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  minutes      int,
  unique (leg_id, seq)
);

-- Tickets and stays booked by the Travel Desk. Company-paid; never part of
-- what the employee is reimbursed.
create table if not exists te_bookings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  booking_no  text not null,                           -- BKG-0136
  trip_id     uuid not null references te_trips(id) on delete cascade,
  leg_id      uuid references te_legs(id) on delete set null,
  point_seq   int,                                     -- the stay at this point of the trip
  kind        text not null check (kind in ('travel','hotel')),
  vendor      text not null,
  reference   text not null,                           -- PNR or booking reference
  amount      numeric(14,2) not null check (amount > 0),
  paid_by     text not null default 'company' check (paid_by in ('company','self')),
  status      text not null default 'BOOKED' check (status in ('REQUESTED','BOOKED','CANCELLED')),
  ticket_url  text,
  booked_by   uuid references employees(id) on delete set null,
  booked_at   timestamptz not null default now(),
  unique (company_id, booking_no)
);
create index if not exists idx_te_bookings_trip on te_bookings (trip_id);


-- ============================================================================
-- SECTION 8 — EXPENSES AND CLAIMS
-- ============================================================================

create table if not exists te_claims (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  claim_no           text not null,                    -- CLM-2026-000404
  employee_id        uuid not null references employees(id),
  trip_id            uuid references te_trips(id),
  claim_type         text not null check (claim_type in ('TRIP','GENERAL')),
  claim_seq          int  not null default 0,          -- 0 = main, 1+ = supplementary
  period_id          uuid references travel_periods(id),
  is_late            boolean not null default false,   -- filed into a later period because its own was closed
  note               text,

  claimed_total      numeric(14,2) not null default 0,
  eligible_total     numeric(14,2) not null default 0,
  approved_total     numeric(14,2) not null default 0,
  advance_adjusted   numeric(14,2) not null default 0,
  net_amount         numeric(14,2),                    -- approved minus the advance outstanding; null until verified

  risk_score         int  not null default 0,
  risk_band          text not null default 'Low' check (risk_band in ('Low','Medium','High')),
  is_exception       boolean not null default false,
  is_post_facto      boolean not null default false,
  auto_verified      boolean not null default false,
  sampled            boolean not null default false,
  declaration_at     timestamptz,

  stage              text not null default 'manager' check (stage in ('manager','finance')),
  status             text not null default 'IN_APPROVAL'
                       check (status in ('DRAFT','IN_APPROVAL','SENT_BACK','IN_VERIFICATION','ON_HOLD',
                                         'VERIFIED','IN_PAYOUT','PAID','SETTLED','REJECTED','CANCELLED')),
  sent_back_from     text,                             -- the status to return to after the employee answers
  fix_all            boolean not null default false,
  rejected_from      text,
  reject_reason      text,
  chain_notes        text[] not null default '{}',
  workflow_version   int,

  submitted_at       timestamptz,
  first_submitted_at timestamptz,
  verified_at        timestamptz,
  paid_ref           text,
  settled_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, claim_no)
);
create index if not exists idx_te_claims_emp    on te_claims (employee_id, status);
create index if not exists idx_te_claims_status on te_claims (company_id, status);
create index if not exists idx_te_claims_period on te_claims (period_id);
-- one live claim of each sequence per traveller per trip
create unique index if not exists uq_te_claim_trip_seq
  on te_claims (trip_id, employee_id, claim_seq)
  where trip_id is not null and status not in ('CANCELLED','REJECTED');

create table if not exists te_expenses (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  expense_no        text not null,                     -- EXP-2024
  employee_id       uuid not null references employees(id),
  trip_id           uuid references te_trips(id),
  leg_id            uuid references te_legs(id) on delete set null,
  claim_id          uuid references te_claims(id) on delete set null,
  booking_id        uuid references te_bookings(id) on delete set null,
  category_code     text not null,                     -- te_categories.code
  expense_date      date not null,
  check_in          date,
  check_out         date,

  merchant          text,
  merchant_gstin    text,
  bill_no           text,
  reference         text,                              -- PNR, cab trip ID, FASTag ID
  travel_class      text,
  bill_amount       numeric(14,2) not null default 0,  -- in rupees
  claimed_amount    numeric(14,2) not null default 0,
  eligible_amount   numeric(14,2),                     -- after policy caps; set at submit
  approved_amount   numeric(14,2),
  -- a bill abroad: what was on the bill, and the rate used
  currency          text not null default 'INR',
  fx_amount         numeric(14,2),
  fx_rate           numeric(14,6),

  paid_by           text not null default 'self' check (paid_by in ('self','company')),
  payment_mode      text,
  description       text,
  employee_reason   text,                              -- the employee's justification when a check asks for one
  wants_exception   boolean not null default false,
  decision_reason   text,                              -- why an approver reduced or rejected the line
  needs_fix         boolean not null default false,    -- marked by the approver who sent the claim back
  -- what an approver decided on this line while the claim is still moving;
  -- it becomes the line's status when Finance finishes the claim
  line_decision     text check (line_decision in ('PARTLY_APPROVED','REJECTED_FINAL','REJECTED_REFILE')),

  -- own vehicle
  vehicle_id        uuid references te_employee_vehicles(id),
  from_place_id     uuid references te_places(id),
  to_place_id       uuid references te_places(id),
  payable_km        numeric(10,2),
  rate_applied      numeric(8,2),

  client_name       text,
  attendees         int,
  details           jsonb not null default '{}'::jsonb,
  period_id         uuid references travel_periods(id),

  status            text not null default 'UNCLAIMED'
                      check (status in ('UNCLAIMED','IN_CLAIM','CLARIFICATION','APPROVED','PARTLY_APPROVED',
                                        'REJECTED_FINAL','REJECTED_REFILE','PAID','EXPIRED','DISCARDED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, expense_no),
  -- an approver can reduce an amount and can never raise it above what was claimed
  constraint te_exp_approved_le_claimed check (approved_amount is null or approved_amount <= claimed_amount),
  -- nobody is paid more than the bill
  constraint te_exp_claimed_le_bill check (paid_by = 'company' or bill_amount = 0 or claimed_amount <= bill_amount),
  constraint te_exp_amounts_positive check (bill_amount >= 0 and claimed_amount >= 0)
);
create index if not exists idx_te_exp_emp       on te_expenses (employee_id, status);
create index if not exists idx_te_exp_trip      on te_expenses (trip_id);
create index if not exists idx_te_exp_claim     on te_expenses (claim_id);
create index if not exists idx_te_exp_leg       on te_expenses (leg_id) where leg_id is not null;
create index if not exists idx_te_exp_booking   on te_expenses (booking_id) where booking_id is not null;
create index if not exists idx_te_exp_date_cat  on te_expenses (company_id, expense_date, category_code);
create index if not exists idx_te_exp_ref       on te_expenses (company_id, reference) where reference is not null and reference <> '';

-- CHECK B3 IN THE DATABASE. The same supplier (GSTIN) cannot be paid twice for
-- the same invoice number in one financial year (April to March). Lines that
-- were returned to the employee or thrown away are left out, so a corrected
-- re-file is possible. Bills with no GSTIN are matched by name in the engine.
create unique index if not exists uq_te_exp_invoice
  on te_expenses (
    company_id,
    upper(merchant_gstin),
    upper(regexp_replace(bill_no, '[^A-Za-z0-9]', '', 'g')),
    (extract(year from (expense_date - interval '3 months'))::int)
  )
  where paid_by = 'self'
    and coalesce(merchant_gstin, '') <> '' and coalesce(bill_no, '') <> ''
    and status not in ('REJECTED_REFILE','EXPIRED','DISCARDED');

alter table te_legs drop constraint if exists te_legs_expense_fk;
alter table te_legs add  constraint te_legs_expense_fk foreign key (expense_id) references te_expenses(id) on delete set null;

create table if not exists te_expense_files (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references te_expenses(id) on delete cascade,
  company_id    uuid not null,
  kind          text not null default 'BILL' check (kind in ('BILL','TICKET','TOLL_SLIP','FASTAG_STATEMENT','OTHER')),
  storage_path  text not null,
  file_name     text,
  mime_type     text,
  file_size     int,
  sha256        text,                                  -- check B1: the same file uploaded twice
  phash         text,                                  -- check B2: a near-identical image
  ocr           jsonb,                                 -- what the scanner read: amount, date, GSTIN, bill no
  metadata      jsonb,                                 -- check E1/E2: software, producer
  uploaded_by   uuid references employees(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_te_files_exp on te_expense_files (expense_id);
create index if not exists idx_te_files_sha on te_expense_files (company_id, sha256) where sha256 is not null;

-- The result of every check that fired on a claim.
create table if not exists te_flags (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references te_claims(id) on delete cascade,
  expense_id      uuid references te_expenses(id) on delete cascade,
  check_code      text not null,                       -- A1 … G13, or POL for a policy cap
  title           text not null,
  evidence        text,                                -- what Finance and the approvers read
  -- what the claimant reads instead, when the evidence names a colleague
  -- ("this bill has already been claimed by someone else")
  evidence_employee text,
  action          text,
  severity        text not null default '' check (severity in ('','low','medium','high')),
  is_blocking     boolean not null default false,
  needs_reason    boolean not null default false,
  status          text not null default 'open' check (status in ('open','dismissed','confirmed')),
  resolved_by     uuid references employees(id) on delete set null,
  resolve_reason  text,
  resolved_at     timestamptz,
  -- a re-check after a send-back writes a new round and closes the old one
  round           int not null default 1,
  is_current      boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_te_flags_claim on te_flags (claim_id) where is_current;
create index if not exists idx_te_flags_code  on te_flags (check_code);


-- ============================================================================
-- SECTION 9 — APPROVALS
-- The chain of one trip or one claim, frozen when it is submitted. Changing the
-- workflow later does not change a chain that is already running.
-- ============================================================================

create table if not exists te_approval_steps (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  entity_type     text not null check (entity_type in ('trip','claim')),
  entity_id       uuid not null,
  step_no         int  not null,
  stage           text not null check (stage in ('manager','finance')),
  level_id        uuid,                                -- te_workflow_levels.id at the time (not an FK: levels are replaced on save)
  role_label      text not null,
  approver_id     uuid references employees(id),       -- the named person; null for a team step
  team_code       text check (team_code in ('finance')),
  status          text not null default 'pending' check (status in ('pending','approved','auto','rejected','sent_back','cancelled')),
  acted_by        uuid references employees(id),
  delegated_from  uuid references employees(id),
  comment         text,
  due_at          timestamptz,
  acted_at        timestamptz,
  created_at      timestamptz not null default now(),
  unique (entity_type, entity_id, step_no),
  constraint te_step_who check (approver_id is not null or team_code is not null)
);
create index if not exists idx_te_steps_pending_person on te_approval_steps (approver_id) where status = 'pending';

-- Every line an approver reduced, rejected or raised back to the claimed amount.
create table if not exists te_line_decisions (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references te_claims(id) on delete cascade,
  expense_id     uuid not null references te_expenses(id) on delete cascade,
  step_id        uuid references te_approval_steps(id) on delete set null,
  decided_by     uuid references employees(id),
  decision       text not null check (decision in ('reduce','reject_final','reject_refile','accept_above_cap')),
  amount_before  numeric(14,2),
  amount_after   numeric(14,2),
  reason         text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_te_line_dec_claim on te_line_decisions (claim_id);

-- Questions and answers between the approver and the employee.
create table if not exists te_messages (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('trip','claim')),
  entity_id    uuid not null,
  author_id    uuid references employees(id),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_te_messages_entity on te_messages (entity_type, entity_id, created_at);


-- ============================================================================
-- SECTION 10 — MONEY
-- ============================================================================

create table if not exists te_advances (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  advance_no          text not null,                   -- ADV-0031
  trip_id             uuid not null references te_trips(id),
  employee_id         uuid not null references employees(id),
  requested_amount    numeric(14,2) not null check (requested_amount > 0),
  approved_amount     numeric(14,2) not null default 0,
  outstanding_amount  numeric(14,2) not null default 0 check (outstanding_amount >= 0),
  due_date            date,
  paid_on             date,
  payment_ref         text,
  source_advance_id   uuid references te_advances(id),   -- a carried-forward advance points at the one it came from
  status              text not null default 'REQUESTED'
                        check (status in ('REQUESTED','APPROVED','PAID','PART_SETTLED','RECOVERY_DUE','SETTLED','REJECTED','CANCELLED')),
  actioned_by         uuid references employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, advance_no)
);
create index if not exists idx_te_adv_emp on te_advances (employee_id, status);
-- one live advance per trip
create unique index if not exists uq_te_adv_trip on te_advances (trip_id) where status not in ('REJECTED','CANCELLED');

-- Every reduction of what an employee still holds from an advance.
create table if not exists te_settlements (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  advance_id         uuid not null references te_advances(id) on delete cascade,
  claim_id           uuid references te_claims(id) on delete set null,
  amount             numeric(14,2) not null check (amount >= 0),
  kind               text not null check (kind in ('net_off','refund','payroll_recovery','carry_forward')),
  target_advance_id  uuid references te_advances(id),
  reference          text,
  created_by         uuid references employees(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_te_settle_adv on te_settlements (advance_id);

-- A correction after a claim is paid. The paid claim itself is never edited.
create table if not exists te_adjustments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  claim_id     uuid references te_claims(id) on delete set null,
  employee_id  uuid not null references employees(id),
  direction    text not null check (direction in ('recover','pay')),
  amount       numeric(14,2) not null check (amount > 0),
  reason       text not null,
  status       text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  reference    text,
  created_by   uuid references employees(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists te_payout_batches (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  batch_no      text not null,                         -- PAY-0016
  route         text not null check (route in ('PAYROLL','OFF_CYCLE')),
  payout_date   date not null default current_date,
  total_amount  numeric(14,2) not null default 0,
  status        text not null default 'DRAFT' check (status in ('DRAFT','FILE_GENERATED','PAID','CANCELLED')),
  bank_ref      text,
  payroll_run_id uuid,
  created_by    uuid references employees(id) on delete set null,
  paid_by       uuid references employees(id) on delete set null,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (company_id, batch_no)
);

create table if not exists te_payout_items (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references te_payout_batches(id) on delete cascade,
  claim_id        uuid not null references te_claims(id),
  employee_id     uuid not null references employees(id),
  amount          numeric(14,2) not null check (amount > 0),
  status          text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED')),
  bank_ref        text,
  failure_reason  text,
  unique (batch_id, claim_id)
);
create index if not exists idx_te_payout_items_claim on te_payout_items (claim_id);


-- ============================================================================
-- SECTION 11 — NUMBERS AND THE AUDIT LOG
-- ============================================================================

-- One counter per company per kind per year. te_next_no() locks the row, so
-- two people submitting at the same moment cannot get the same number (the v1
-- generators used max()+1 with no lock).
create table if not exists te_sequences (
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('trip','claim','advance','expense','booking','batch')),
  year        int  not null default 0,                 -- 0 for kinds that do not restart each year
  last_no     bigint not null default 0,
  primary key (company_id, kind, year)
);

-- Append-only. Every create, submit, approve, reduce, reject, pay and config
-- change is one row. The timeline of a trip or a claim is this table filtered
-- by entity. 145 adds the trigger that refuses UPDATE and DELETE.
create table if not exists te_audit_log (
  id           bigint generated always as identity primary key,
  company_id   uuid not null,
  entity_type  text not null,                          -- trip, leg, expense, claim, advance, batch, period, vehicle, settings, workflow, team
  entity_id    uuid,
  entity_ref   text,                                   -- the human number, so the log reads without a join
  action       text not null,                          -- a short code: SUBMITTED, APPROVED, LINE_REDUCED …
  actor_id     uuid,                                   -- null = the system
  actor_role   text,
  summary      text not null,                          -- one sentence, shown in the timeline
  -- false = shown to Finance and admins only (a flag under investigation)
  employee_visible boolean not null default true,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);
create index if not exists idx_te_audit_entity  on te_audit_log (entity_type, entity_id, at desc);
create index if not exists idx_te_audit_company on te_audit_log (company_id, at desc);

notify pgrst, 'reload schema';
