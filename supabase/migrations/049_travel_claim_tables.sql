-- ============================================================================
-- EZER HRMS — TRAVEL CLAIM MODULE  ·  1 of 3: TABLES ONLY
-- Migration 049
-- ----------------------------------------------------------------------------
-- DELIBERATELY TABLES AND INDEXES ONLY. No functions, no seed data, no
-- preflight guards, no verification queries.
--
-- The SQL editor runs a script as ONE transaction, so a single failure rolls
-- back everything — including tables created earlier in the same file. A
-- previous single-file version of this module produced exactly that: "0 tables
-- created", no obvious reason. Splitting it means the chunk that fails is the
-- actual bug.
--
-- Run in order:  049 (tables) -> 050 (functions, views, RLS) -> 051 (seed)
-- Verify after each with the query at the end of 051. Do not trust the absence
-- of an error message.
--
-- Nothing here touches an existing table or an existing row. Every object is
-- new and prefixed travel_.
--
-- ASSUMPTIONS (verified against the live database on 18 Aug 2026, 397
-- employees / 3 companies):
--   companies(id)               uuid pk
--   employees(id)               uuid pk
--   employees.date_of_leaving   date, nullable   -- read by 050's DOL guard
--   employees.hr_head_id        uuid, 397/397 populated  -- HR approval routing
--   employees.l1_manager_id     uuid, 0/397 populated    -- see note below
--   gen_random_uuid()           available
--
-- APPROVAL CHAIN: employee -> [RM] -> HR Head -> Finance.
-- The RM stage is off by default (travel_policies.rm_stage_enabled = false)
-- because l1_manager_id is unpopulated; routing through it would park claims on
-- nobody. Live chain is HR Head -> Finance. Set the column true once L1
-- managers are mapped — no code change needed.
-- ============================================================================

-- ============================================================================
-- SECTION 1 — MASTERS
-- ============================================================================

create table if not exists travel_expense_types (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  type_code           text not null,
  type_name           text not null,
  calc_method         text not null default 'ACTUAL'
                        check (calc_method in ('PER_KM','ACTUAL','ZERO')),
  bill_threshold      numeric(10,2) not null default 0,
  allowed_local       boolean not null default true,
  allowed_outstation  boolean not null default true,
  pools_by_headcount  boolean not null default false,
  capture_gst         boolean not null default false,
  requires_vehicle    boolean not null default false,
  -- Bill-less mode: the amount comes from the recorded GPS trail, not a typed
  -- figure. There is no receipt to check a typed number against.
  requires_gps        boolean not null default false,
  -- False where no receipt exists to attach: own vehicle, cash auto, tips.
  bill_required       boolean not null default true,
  -- Grouping for the ESS picker: CONVEYANCE | OUTSTATION | STAY | ALLOWANCE |
  -- COMMUNICATION | DOCUMENTATION | CLIENT | OTHER
  category            text,
  gl_code             text,
  icon                text,
  sort_order          int not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (company_id, type_code)
);

create table if not exists travel_city_class (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  city_name    text not null,
  state        text,
  city_class   text not null check (city_class in ('METRO','TIER2','OTHER')),
  is_active    boolean not null default true,
  unique (company_id, city_name)
);

create table if not exists travel_policies (
  id                            uuid primary key default gen_random_uuid(),
  company_id                    uuid not null references companies(id) on delete cascade,
  policy_name                   text not null,
  effective_from                date not null,
  effective_to                  date,

  -- bill age
  bill_max_age_days             int not null default 90,
  bill_warn_age_days            int not null default 75,
  draft_reminder_days           int not null default 60,

  -- distance
  distance_mode                 text not null default 'MAPS_POINT'
                                  check (distance_mode in ('GPS_TRACKED','MAPS_POINT','MANUAL')),
  distance_variance_tolerance   numeric(5,2) not null default 15.00,

  -- caps / thresholds
  toll_daily_cap                numeric(10,2) not null default 1500,
  local_food_enabled            boolean not null default false,
  trip_advance_enabled          boolean not null default false,

  -- group travel
  group_limit_method            text not null default 'SUM_OF_INDIVIDUAL'
                                  check (group_limit_method in ('SUM_OF_INDIVIDUAL','HIGHEST_GRADE_X_HEADCOUNT')),
  group_max_multiplier          numeric(4,2) not null default 3.0,
  max_travellers_per_trip       int not null default 10,
  max_guests_per_trip           int not null default 5,
  guest_travel_enabled          boolean not null default false,
  guest_per_head_limit          numeric(12,2) not null default 1000,
  guest_requires_hod_approval   boolean not null default true,
  cotraveller_approval_mode     text not null default 'LEADER_RM_WITH_NOTIFY'
                                  check (cotraveller_approval_mode in ('LEADER_RM','ALL_RM','LEADER_RM_WITH_NOTIFY')),
  cost_allocation_mode          text not null default 'PAYER_DEPARTMENT'
                                  check (cost_allocation_mode in ('PAYER_DEPARTMENT','SPLIT_BY_TRAVELLER')),

  -- exit handling
  post_exit_grace_days          int not null default 0,   -- 0 = hard block on DOL

  -- workflow
  rm_stage_enabled              boolean not null default false,
  rm_sla_days                   int not null default 3,
  hr_sla_days                   int not null default 3,
  finance_sla_days              int not null default 3,
  attendance_crosscheck         boolean not null default true,
  commute_check_enabled         boolean not null default true,

  is_active                     boolean not null default true,
  created_at                    timestamptz not null default now()
);

create table if not exists travel_entitlements (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references travel_policies(id) on delete cascade,
  grade          text not null,                 -- E1..M2 | NON_GRADED | DEFAULT
  city_class     text check (city_class in ('METRO','TIER2','OTHER')),  -- null = all
  type_code      text not null,
  limit_basis    text not null default 'PER_DAY'
                   check (limit_basis in ('PER_DAY','PER_TRIP','PER_CLAIM','PER_MONTH','PER_NIGHT','NONE')),
  limit_value    numeric(12,2),
  enforcement    text not null default 'WARN'
                   check (enforcement in ('BLOCK','WARN','AUTO_TRIM')),
  unique (policy_id, grade, city_class, type_code)
);

-- A rate row is one of two shapes:
--   type_code set, vehicle null  -> mode rate    (AUTO_CASH = 17/km)
--   type_code null, vehicle set  -> vehicle rate (CAR/PETROL/LTE_1600 = 12/km)
-- Rates are versioned by effective_from and never edited in place, so a claim
-- already paid keeps the rate it was paid at.
create table if not exists travel_mileage_rates (
  id              uuid primary key default gen_random_uuid(),
  policy_id       uuid not null references travel_policies(id) on delete cascade,
  type_code       text,
  vehicle_type    text check (vehicle_type in ('CAR','TWO_WHEELER')),
  fuel_type       text check (fuel_type in ('PETROL','DIESEL','CNG','ELECTRIC')),
  cc_band         text not null default 'NA' check (cc_band in ('LTE_1600','GT_1600','NA')),
  rate_per_km     numeric(8,2) not null,
  effective_from  date not null,
  rate_label      text,
  notes           text,
  -- the HR Head who set it
  set_by          uuid references employees(id),
  set_at          timestamptz not null default now(),
  constraint travel_rate_shape check (
    (type_code is not null and vehicle_type is null)
    or
    (type_code is null and vehicle_type is not null)
  )
);

-- "one rate per mode per date". A plain unique constraint cannot express this:
-- the vehicle columns are null on mode rates and NULLs are distinct in a unique
-- constraint, so NULL is folded to a sentinel here.
create unique index if not exists idx_travel_rate_unique
  on travel_mileage_rates (
    policy_id,
    coalesce(type_code, '~'),
    coalesce(vehicle_type, '~'),
    coalesce(fuel_type, '~'),
    cc_band,
    effective_from
  );

create table if not exists travel_employee_vehicles (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  vehicle_type     text not null check (vehicle_type in ('CAR','TWO_WHEELER')),
  fuel_type        text not null check (fuel_type in ('PETROL','DIESEL','CNG','ELECTRIC')),
  cubic_capacity   int,
  registration_no  text,
  rc_document_url  text,
  is_verified      boolean not null default false,
  verified_by      uuid references employees(id),
  verified_at      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists idx_travel_vehicles_emp
  on travel_employee_vehicles (employee_id) where is_active;

-- ============================================================================
-- SECTION 2 — PERIOD OPEN / CLOSE
-- One row per company per expense month. Controls whether expenses dated in
-- that month can be entered, edited or submitted. Nothing in this module
-- writes a claim without passing travel_is_period_open().
-- ============================================================================

create table if not exists travel_periods (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  period_month      date not null,               -- always the 1st: 2026-08-01
  period_label      text not null,               -- 'Aug 2026'

  status            text not null default 'OPEN'
                      check (status in ('OPEN','CLOSED','LOCKED')),
  -- OPEN   : employees can add / edit / submit expenses dated in this month
  -- CLOSED : read-only. no new entry, no edit, no submit. reopenable by admin
  -- LOCKED : paid out through payroll. permanent. NOT reopenable

  -- optional submission window inside the period (null = whole month usable)
  submit_open_from  date,
  submit_open_till  date,

  auto_close_on     date,                        -- nightly job closes on this date
  closed_by         uuid references employees(id),
  closed_at         timestamptz,
  reopened_by       uuid references employees(id),
  reopened_at       timestamptz,
  reopen_reason     text,
  locked_by         uuid references employees(id),
  locked_at         timestamptz,
  payroll_run_id    uuid,

  remarks           text,
  created_by        uuid references employees(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, period_month)
);

create index if not exists idx_travel_periods_lookup
  on travel_periods (company_id, period_month, status);

-- every open/close/reopen/lock action is written here, permanently
create table if not exists travel_period_audit (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references travel_periods(id) on delete cascade,
  company_id    uuid not null,
  action        text not null check (action in ('CREATED','OPENED','CLOSED','REOPENED','LOCKED','WINDOW_CHANGED')),
  from_status   text,
  to_status     text,
  reason        text,
  actioned_by   uuid references employees(id),
  actioned_at   timestamptz not null default now(),
  meta          jsonb
);

-- ============================================================================
-- SECTION 3 — TRIPS
-- ============================================================================

create table if not exists travel_trips (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  trip_no            text not null unique,
  employee_id        uuid not null references employees(id),   -- group leader
  trip_type          text not null default 'OUTSTATION'
                       check (trip_type in ('LOCAL','OUTSTATION')),
  purpose            text not null,
  client_name        text,
  from_city          text,
  to_city            text,
  to_city_class      text check (to_city_class in ('METRO','TIER2','OTHER')),
  from_date          date not null,
  to_date            date not null,
  travel_mode        text check (travel_mode in ('FLIGHT','TRAIN','BUS','OWN_VEHICLE','CAB')),
  hotel_required     boolean not null default false,
  estimated_cost     numeric(12,2),

  is_group_trip      boolean not null default false,
  traveller_count    int not null default 1,
  guest_count        int not null default 0,

  advance_requested  numeric(12,2) not null default 0,
  advance_approved   numeric(12,2) not null default 0,
  advance_paid_at    timestamptz,

  status             text not null default 'DRAFT'
                       check (status in ('DRAFT','PENDING_RM','APPROVED','ACTIVE','CLOSED','SETTLED','REJECTED','CANCELLED')),
  approved_by        uuid references employees(id),
  approved_at        timestamptz,
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (to_date >= from_date)
);

create index if not exists idx_travel_trips_emp on travel_trips (employee_id, status);
create index if not exists idx_travel_trips_dates on travel_trips (company_id, from_date, to_date);

create table if not exists travel_trip_travellers (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references travel_trips(id) on delete cascade,
  traveller_type        text not null check (traveller_type in ('LEADER','INTERNAL','GUEST')),
  employee_id           uuid references employees(id),
  guest_name            text,
  guest_company         text,
  guest_designation     text,

  -- frozen at trip creation so a mid-trip promotion or rate-card change
  -- cannot silently rewrite an already-computed pooled limit
  grade_snapshot        text,
  entitlement_snapshot  jsonb,

  status                text not null default 'CONFIRMED'
                          check (status in ('CONFIRMED','DROPPED','ADDED_LATE')),
  joined_date           date,
  left_date             date,
  rm_notified_at        timestamptz,
  rm_approved_at        timestamptz,
  added_by              uuid references employees(id),
  created_at            timestamptz not null default now(),
  check (
    (traveller_type = 'GUEST'  and guest_name  is not null) or
    (traveller_type <> 'GUEST' and employee_id is not null)
  )
);

create unique index if not exists idx_travel_traveller_unique
  on travel_trip_travellers (trip_id, employee_id) where employee_id is not null;
create index if not exists idx_travel_traveller_emp
  on travel_trip_travellers (employee_id, trip_id);

-- flights / trains / hotels booked BY THE OFFICE.
-- these are trip costs, never part of the employee's net_payable.
create table if not exists travel_trip_bookings (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references travel_trips(id) on delete cascade,
  booking_type    text not null check (booking_type in ('FLIGHT','TRAIN','BUS','HOTEL','CAB')),
  for_employee_id uuid references employees(id),
  vendor          text,
  booking_ref     text,
  travel_date     date,
  amount          numeric(12,2),
  occupancy       int,
  invoice_url     text,
  supplier_gstin  text,
  invoice_no      text,
  booked_by       uuid references employees(id),
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- SECTION 4 — TRAVEL LOGS (Start / End engine)
-- A log exists the moment the employee taps End Travel, days before any claim.
-- claim_id stays null until submission.
-- ============================================================================

create table if not exists travel_logs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  trip_id           uuid references travel_trips(id),   -- null = standalone local
  claim_id          uuid,                               -- FK added after claims table

  log_date          date not null,
  purpose           text not null,
  client_name       text,
  type_code         text not null,
  vehicle_id        uuid references travel_employee_vehicles(id),

  started_at        timestamptz,
  ended_at          timestamptz,
  from_address      text,
  from_lat          numeric(10,7),
  from_lng          numeric(10,7),
  to_address        text,
  to_lat            numeric(10,7),
  to_lng            numeric(10,7),
  city              text,
  city_class        text check (city_class in ('METRO','TIER2','OTHER')),
  is_round_trip     boolean not null default false,

  -- store all three, always. finance's whole job on a mileage line is the delta.
  distance_gps      numeric(8,2),
  distance_maps     numeric(8,2),
  distance_claimed  numeric(8,2),
  distance_snapped  numeric(8,2),
  distance_source   text check (distance_source in ('GPS_TRACKED','GPS_SNAPPED','MAPS_POINT','MANUAL')),
  variance_pct      numeric(6,2),
  variance_reason   text,

  rate_applied      numeric(8,2),
  computed_fare     numeric(12,2) not null default 0,
  amount_entered    numeric(12,2) not null default 0,
  toll_amount       numeric(12,2) not null default 0,
  parking_amount    numeric(12,2) not null default 0,
  total_amount      numeric(12,2) not null default 0,

  is_shared         boolean not null default false,
  passenger_count   int not null default 0,

  -- Recorded location trail: [{lat,lng,t,acc}]. Kept so a disputed distance can
  -- be re-derived instead of argued about.
  gps_track         jsonb,
  gps_point_count   int,
  gps_accuracy_m    numeric(8,2),
  gps_duration_min  int,
  gps_started_at    timestamptz,
  gps_ended_at      timestamptz,

  status            text not null default 'LOGGED'
                      check (status in ('LOGGED','CLAIMED','CANCELLED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_travel_logs_gps
  on travel_logs (employee_id, log_date) where gps_track is not null;

create index if not exists idx_travel_logs_emp_date
  on travel_logs (employee_id, log_date);
create index if not exists idx_travel_logs_unclaimed
  on travel_logs (employee_id, status) where claim_id is null;
create index if not exists idx_travel_logs_trip on travel_logs (trip_id);

create table if not exists travel_log_stops (
  id             uuid primary key default gen_random_uuid(),
  travel_log_id  uuid not null references travel_logs(id) on delete cascade,
  seq            int not null,
  address        text,
  lat            numeric(10,7),
  lng            numeric(10,7),
  arrived_at     timestamptz,
  unique (travel_log_id, seq)
);

-- ============================================================================
-- SECTION 5 — CLAIMS
-- ============================================================================

create table if not exists travel_claims (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  claim_no            text not null unique,
  employee_id         uuid not null references employees(id),
  claim_type          text not null default 'MONTHLY_LOCAL'
                        check (claim_type in ('MONTHLY_LOCAL','TRIP_SETTLEMENT')),
  trip_id             uuid references travel_trips(id),
  period_id           uuid references travel_periods(id),
  period_from         date,
  period_to           date,

  total_claimed       numeric(12,2) not null default 0,
  total_approved      numeric(12,2) not null default 0,
  advance_adjusted    numeric(12,2) not null default 0,
  net_payable         numeric(12,2) not null default 0,
  recovery_amount     numeric(12,2) not null default 0,
  flag_count          int not null default 0,

  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','SUBMITTED','PENDING_RM','PENDING_HR',
                                          'PENDING_FINANCE','APPROVED','SENT_BACK',
                                          'REJECTED','PAID')),
  submitted_at        timestamptz,
  rm_actioned_at      timestamptz,
  hr_actioned_at      timestamptz,
  finance_actioned_at timestamptz,
  paid_at             timestamptz,
  payroll_run_id      uuid,

  -- retained across SENT_BACK so a finance query does not restart the 90-day clock
  first_submitted_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_travel_claims_emp on travel_claims (employee_id, status);
create index if not exists idx_travel_claims_period on travel_claims (period_id);

alter table travel_logs
  drop constraint if exists travel_logs_claim_id_fkey;
alter table travel_logs
  add constraint travel_logs_claim_id_fkey
  foreign key (claim_id) references travel_claims(id) on delete set null;

create table if not exists travel_claim_lines (
  id                  uuid primary key default gen_random_uuid(),
  claim_id            uuid not null references travel_claims(id) on delete cascade,
  travel_log_id       uuid references travel_logs(id),
  type_code           text not null,
  expense_date        date not null,
  city                text,
  city_class          text check (city_class in ('METRO','TIER2','OTHER')),
  description         text,

  paid_by             uuid references employees(id),
  is_shared           boolean not null default false,
  consumer_count      int not null default 1,
  occupancy           int,

  amount_claimed      numeric(12,2) not null,
  entitlement_limit   numeric(12,2),
  pooled_limit        numeric(12,2),
  pooling_method      text,
  amount_approved     numeric(12,2),
  amount_unclaimable  numeric(12,2) not null default 0,

  -- finance-filled, only where travel_expense_types.capture_gst = true
  supplier_gstin      text,
  invoice_no          text,
  invoice_date        date,
  taxable_value       numeric(12,2),
  cgst                numeric(12,2),
  sgst                numeric(12,2),
  igst                numeric(12,2),
  place_of_supply     text,

  cost_centre         text,
  project_code        text,
  line_status         text not null default 'PENDING'
                        check (line_status in ('PENDING','APPROVED','PARTIAL','REJECTED')),
  finance_remarks     text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_travel_lines_claim on travel_claim_lines (claim_id);
create index if not exists idx_travel_lines_date on travel_claim_lines (expense_date, type_code);

-- the share ledger. one row per consumer of a shared expense.
-- this is what makes pooled limits work AND what blocks double claims.
create table if not exists travel_claim_line_shares (
  id                      uuid primary key default gen_random_uuid(),
  claim_line_id           uuid references travel_claim_lines(id) on delete cascade,
  travel_log_id           uuid references travel_logs(id) on delete cascade,
  trip_id                 uuid references travel_trips(id),
  traveller_id            uuid references travel_trip_travellers(id),
  employee_id             uuid references employees(id),   -- null for external guest
  guest_name              text,
  expense_date            date not null,
  type_code               text not null,
  is_payer                boolean not null default false,
  entitlement_contributed numeric(12,2) not null default 0,
  amount_allocated        numeric(12,2) not null default 0,
  created_at              timestamptz not null default now()
);

-- the index the daily-limit check rides on
create index if not exists idx_travel_shares_lookup
  on travel_claim_line_shares (employee_id, expense_date, type_code);
create index if not exists idx_travel_shares_line
  on travel_claim_line_shares (claim_line_id);

create table if not exists travel_attachments (
  id               uuid primary key default gen_random_uuid(),
  claim_line_id    uuid references travel_claim_lines(id) on delete cascade,
  travel_log_id    uuid references travel_logs(id) on delete cascade,
  attachment_type  text not null default 'BILL'
                     check (attachment_type in ('BILL','TOLL_SLIP','FASTAG_STATEMENT','BOOKING','OTHER')),
  file_url         text not null,
  file_hash        text,
  file_name        text,
  mime_type        text,
  file_size        int,
  uploaded_by      uuid references employees(id),
  uploaded_at      timestamptz not null default now()
);

create index if not exists idx_travel_attach_hash on travel_attachments (file_hash);

create table if not exists travel_flags (
  id              uuid primary key default gen_random_uuid(),
  claim_line_id   uuid references travel_claim_lines(id) on delete cascade,
  travel_log_id   uuid references travel_logs(id) on delete cascade,
  flag_type       text not null,
  severity        text not null check (severity in ('WARN','BLOCK')),
  policy_value    numeric(12,2),
  actual_value    numeric(12,2),
  message         text,
  employee_reason text,
  approver_remarks text,
  resolved_by     uuid references employees(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists travel_approvals (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid references travel_claims(id) on delete cascade,
  trip_id         uuid references travel_trips(id) on delete cascade,
  stage           text not null check (stage in ('TRIP_RM','CLAIM_RM','CLAIM_HR',
                                                 'CLAIM_FINANCE','COTRAVELLER_RM')),
  approver_id     uuid references employees(id),
  delegated_from  uuid references employees(id),
  action          text check (action in ('APPROVED','REJECTED','SENT_BACK','PARTIAL','NOTIFIED')),
  remarks         text,
  sla_due_at      timestamptz,
  is_sla_breached boolean not null default false,
  actioned_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_travel_approvals_pending
  on travel_approvals (approver_id, stage) where actioned_at is null;

