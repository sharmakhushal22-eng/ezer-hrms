-- ============================================================================
-- EZER HRMS — TRAVEL CLAIM MODULE  ·  3 of 3: SEED DATA
-- Migration 051
-- ----------------------------------------------------------------------------
-- Run AFTER 049 and 050. This is the only one of the three that writes rows,
-- and the only one that reads an existing table (it loops over companies).
--
-- Per company: one policy, 35 expense types, entitlements by grade and city
-- class, the mileage rate card, 25 cities, and three open expense months.
--
-- Safe to re-run: a company that already has an active policy is skipped
-- entirely, so nothing is duplicated and an edited policy is never overwritten.
--
-- ----------------------------------------------------------------------------
-- GRADES — 90 of 397 employees have none, and that is handled
-- ----------------------------------------------------------------------------
-- Live spread:  E1 125 · (blank) 90 · M1 67 · M2 57 · E3 29 · E2 29
--
-- A blank grade does not error and does not return zero. findEntitlement() in
-- lib/travel/calc.ts maps blank to NON_GRADED, then falls back:
--     NON_GRADED+city -> NON_GRADED+null -> DEFAULT+city -> DEFAULT+null
-- The NON_GRADED and DEFAULT rows below are what those 90 people get — the
-- lowest band, but a working one. Nothing is blocked.
--
-- Worth knowing, because it is the opposite of what you might assume: if no row
-- matches at all, checkLimit() returns limit null and pays the FULL amount
-- rather than blocking. A missing entitlement row means UNCAPPED, not zero.
-- The outstation types (FLIGHT, TRAIN, BUS, OUTSTATION_TAXI, VISA, TRAVEL_INS,
-- FOREX_MARKUP) deliberately have no cap — a flight costs what it costs — but
-- that is a decision, and now a visible one.
--
-- ----------------------------------------------------------------------------
-- AMOUNTS — mileage is agreed, meal and hotel scales are not
-- ----------------------------------------------------------------------------
-- Mileage, market rate for metro India, confirmed with the client:
--   own car   ₹12.00/km ≤1600cc · ₹14.00 >1600cc · ₹9.50 CNG · ₹7.00 electric
--   own bike  ₹4.50/km petrol · ₹3.00 electric
--   cash cab  ₹22.00/km · cash auto ₹17.00 · e-rickshaw ₹10.00
--   bike taxi ₹8.00/km · shared auto ₹5.00 · local train/metro ₹3.00
--
-- Food and hotel scales are indicative and need Finance to confirm them.
--
-- All of it is editable from the Rate card screen. A change there inserts a new
-- version with a later effective_from rather than overwriting, so a settled
-- claim keeps the rate it was actually paid at.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART A — policy, the eleven core expense types, vehicle rates, entitlements,
--          city master, and three open expense months
-- ----------------------------------------------------------------------------

do $$
declare
  c        record;
  v_policy uuid;
begin
for c in select id from companies loop

  -- Already seeded for this company — leave its (possibly edited) policy alone.
  if exists (select 1 from travel_policies where company_id = c.id and is_active) then
    continue;
  end if;

  -- ==========================================================================
  -- EXPENSE TYPES
  -- pools_by_headcount is the group-travel switch. Note what does NOT pool:
  -- one cab carries four people at one fare; one car covers one distance.
  -- ==========================================================================
  insert into travel_expense_types
    (company_id, type_code, type_name, calc_method, bill_threshold,
     allowed_local, allowed_outstation, pools_by_headcount, capture_gst,
     requires_vehicle, gl_code, icon, sort_order)
  values
    (c.id,'OWN_CAR',         'Own Car',           'PER_KM', 0,    true,  true,  false, false, true,  'CONV-001','car',     10),
    (c.id,'OWN_BIKE',        'Own Bike',          'PER_KM', 0,    true,  true,  false, false, true,  'CONV-002','bike',    20),
    (c.id,'CAB',             'Cab / Taxi',        'ACTUAL', 300,  true,  true,  false, true,  false, 'CONV-003','cab',     30),
    (c.id,'AUTO',            'Auto Rickshaw',     'ACTUAL', 300,  true,  true,  false, false, false, 'CONV-004','auto',    40),
    (c.id,'PUBLIC_TRANSPORT','Metro / Bus',       'ACTUAL', 0,    true,  true,  true,  false, false, 'CONV-005','metro',   50),
    (c.id,'COMPANY_CAB',     'Company Cab',       'ZERO',   0,    true,  true,  false, false, false, 'CONV-006','cab',     60),
    (c.id,'TOLL',            'Toll',              'ACTUAL', 0,    true,  true,  false, false, true,  'CONV-007','toll',    70),
    (c.id,'PARKING',         'Parking',           'ACTUAL', 200,  true,  true,  false, false, true,  'CONV-008','parking', 80),
    (c.id,'FOOD',            'Food & Meals',      'ACTUAL', 300,  false, true,  true,  false, false, 'TRVL-001','food',    90),
    (c.id,'HOTEL',           'Hotel',             'ACTUAL', 0,    false, true,  false, true,  false, 'TRVL-002','hotel',  100),
    (c.id,'MISC',            'Miscellaneous',     'ACTUAL', 500,  true,  true,  true,  false, false, 'TRVL-003','misc',   110)
  on conflict (company_id, type_code) do nothing;

  -- ==========================================================================
  -- DEFAULT POLICY
  -- ==========================================================================
  insert into travel_policies
    (company_id, policy_name, effective_from,
     bill_max_age_days, bill_warn_age_days, draft_reminder_days,
     distance_mode, distance_variance_tolerance,
     toll_daily_cap, local_food_enabled, trip_advance_enabled,
     group_limit_method, group_max_multiplier, max_travellers_per_trip,
     max_guests_per_trip, guest_travel_enabled, guest_per_head_limit,
     guest_requires_hod_approval, cotraveller_approval_mode, cost_allocation_mode,
     post_exit_grace_days,
     rm_stage_enabled, rm_sla_days, hr_sla_days, finance_sla_days,
     attendance_crosscheck, commute_check_enabled)
  values
    (c.id, 'Default Travel Policy', date_trunc('year', current_date)::date,
     90, 75, 60,
     'MAPS_POINT', 15.00,
     1500, false, false,
     'SUM_OF_INDIVIDUAL', 3.0, 10,
     5, false, 1000,
     true, 'LEADER_RM_WITH_NOTIFY', 'PAYER_DEPARTMENT',
     0,                      -- hard block on DOL, per requirement
     -- RM stage OFF: employees.l1_manager_id is not populated yet, so routing
     -- through it would park claims on nobody. Live chain is HR Head -> Finance.
     -- Flip this to true once L1 managers are mapped.
     false, 3, 3, 3,
     true, true)
  returning id into v_policy;

  -- ==========================================================================
  -- MILEAGE RATES — own vehicle, market rate for metro India
  -- Revise from the Rate card screen; a change there adds a new version rather
  -- than overwriting these, so settled claims keep the rate they were paid at.
  -- ==========================================================================
  insert into travel_mileage_rates
    (policy_id, vehicle_type, fuel_type, cc_band, rate_per_km, effective_from)
  values
    (v_policy,'CAR','PETROL','LTE_1600', 12.00, date_trunc('year', current_date)::date),
    (v_policy,'CAR','DIESEL','LTE_1600', 12.00, date_trunc('year', current_date)::date),
    -- CNG runs cheaper per km than petrol; held at the same ratio as before.
    (v_policy,'CAR','CNG',   'LTE_1600',  9.50, date_trunc('year', current_date)::date),
    (v_policy,'CAR','PETROL','GT_1600',  14.00, date_trunc('year', current_date)::date),
    (v_policy,'CAR','DIESEL','GT_1600',  14.00, date_trunc('year', current_date)::date),
    (v_policy,'CAR','ELECTRIC','NA',      7.00, date_trunc('year', current_date)::date),
    (v_policy,'TWO_WHEELER','PETROL','NA', 4.50, date_trunc('year', current_date)::date),
    (v_policy,'TWO_WHEELER','ELECTRIC','NA', 3.00, date_trunc('year', current_date)::date)
  on conflict do nothing;

  -- ==========================================================================
  -- ENTITLEMENTS — grade x city class x type
  -- ==========================================================================

  -- FOOD, per day
  insert into travel_entitlements (policy_id, grade, city_class, type_code, limit_basis, limit_value, enforcement) values
    (v_policy,'M2','METRO','FOOD','PER_DAY',1500,'AUTO_TRIM'),
    (v_policy,'M2','TIER2','FOOD','PER_DAY',1200,'AUTO_TRIM'),
    (v_policy,'M2','OTHER','FOOD','PER_DAY',1000,'AUTO_TRIM'),
    (v_policy,'M1','METRO','FOOD','PER_DAY',1200,'AUTO_TRIM'),
    (v_policy,'M1','TIER2','FOOD','PER_DAY',1000,'AUTO_TRIM'),
    (v_policy,'M1','OTHER','FOOD','PER_DAY', 800,'AUTO_TRIM'),
    (v_policy,'E3','METRO','FOOD','PER_DAY', 900,'AUTO_TRIM'),
    (v_policy,'E3','TIER2','FOOD','PER_DAY', 750,'AUTO_TRIM'),
    (v_policy,'E3','OTHER','FOOD','PER_DAY', 600,'AUTO_TRIM'),
    (v_policy,'E2','METRO','FOOD','PER_DAY', 700,'AUTO_TRIM'),
    (v_policy,'E2','TIER2','FOOD','PER_DAY', 600,'AUTO_TRIM'),
    (v_policy,'E2','OTHER','FOOD','PER_DAY', 500,'AUTO_TRIM'),
    (v_policy,'E1','METRO','FOOD','PER_DAY', 700,'AUTO_TRIM'),
    (v_policy,'E1','TIER2','FOOD','PER_DAY', 600,'AUTO_TRIM'),
    (v_policy,'E1','OTHER','FOOD','PER_DAY', 500,'AUTO_TRIM'),
    (v_policy,'NON_GRADED','METRO','FOOD','PER_DAY',600,'AUTO_TRIM'),
    (v_policy,'NON_GRADED','TIER2','FOOD','PER_DAY',500,'AUTO_TRIM'),
    (v_policy,'NON_GRADED','OTHER','FOOD','PER_DAY',400,'AUTO_TRIM'),
    (v_policy,'DEFAULT',null,'FOOD','PER_DAY',500,'AUTO_TRIM')
  on conflict do nothing;

  -- HOTEL, per night
  insert into travel_entitlements (policy_id, grade, city_class, type_code, limit_basis, limit_value, enforcement) values
    (v_policy,'M2','METRO','HOTEL','PER_NIGHT',8000,'WARN'),
    (v_policy,'M2','TIER2','HOTEL','PER_NIGHT',6000,'WARN'),
    (v_policy,'M2','OTHER','HOTEL','PER_NIGHT',4500,'WARN'),
    (v_policy,'M1','METRO','HOTEL','PER_NIGHT',6000,'WARN'),
    (v_policy,'M1','TIER2','HOTEL','PER_NIGHT',4500,'WARN'),
    (v_policy,'M1','OTHER','HOTEL','PER_NIGHT',3500,'WARN'),
    (v_policy,'E3','METRO','HOTEL','PER_NIGHT',4500,'WARN'),
    (v_policy,'E3','TIER2','HOTEL','PER_NIGHT',3500,'WARN'),
    (v_policy,'E3','OTHER','HOTEL','PER_NIGHT',2500,'WARN'),
    (v_policy,'E2','METRO','HOTEL','PER_NIGHT',3500,'WARN'),
    (v_policy,'E2','TIER2','HOTEL','PER_NIGHT',2500,'WARN'),
    (v_policy,'E2','OTHER','HOTEL','PER_NIGHT',2000,'WARN'),
    (v_policy,'E1','METRO','HOTEL','PER_NIGHT',3500,'WARN'),
    (v_policy,'E1','TIER2','HOTEL','PER_NIGHT',2500,'WARN'),
    (v_policy,'E1','OTHER','HOTEL','PER_NIGHT',2000,'WARN'),
    (v_policy,'NON_GRADED',null,'HOTEL','PER_NIGHT',2500,'WARN'),
    (v_policy,'DEFAULT',null,'HOTEL','PER_NIGHT',2500,'WARN')
  on conflict do nothing;

  -- CAB / AUTO, per day. NOTE: does not pool by headcount.
  insert into travel_entitlements (policy_id, grade, city_class, type_code, limit_basis, limit_value, enforcement) values
    (v_policy,'M2',null,'CAB','PER_DAY',800,'WARN'),
    (v_policy,'M1',null,'CAB','PER_DAY',800,'WARN'),
    (v_policy,'E3',null,'CAB','PER_DAY',600,'WARN'),
    (v_policy,'E2',null,'CAB','PER_DAY',500,'WARN'),
    (v_policy,'E1',null,'CAB','PER_DAY',500,'WARN'),
    (v_policy,'NON_GRADED',null,'CAB','PER_DAY',500,'WARN'),
    (v_policy,'DEFAULT',null,'CAB','PER_DAY',500,'WARN'),
    (v_policy,'DEFAULT',null,'AUTO','PER_DAY',400,'WARN'),
    (v_policy,'DEFAULT',null,'PUBLIC_TRANSPORT','PER_DAY',300,'WARN'),
    (v_policy,'DEFAULT',null,'TOLL','PER_DAY',1500,'WARN'),
    (v_policy,'DEFAULT',null,'PARKING','PER_DAY',300,'WARN'),
    (v_policy,'DEFAULT',null,'MISC','PER_CLAIM',2000,'WARN'),
    (v_policy,'DEFAULT',null,'OWN_CAR','PER_MONTH',20000,'WARN'),
    (v_policy,'DEFAULT',null,'OWN_BIKE','PER_MONTH',8000,'WARN')
  on conflict do nothing;

  -- ==========================================================================
  -- CITY MASTER
  -- ==========================================================================
  insert into travel_city_class (company_id, city_name, state, city_class) values
    (c.id,'Mumbai','Maharashtra','METRO'),
    (c.id,'Delhi','Delhi','METRO'),
    (c.id,'New Delhi','Delhi','METRO'),
    (c.id,'Gurugram','Haryana','METRO'),
    (c.id,'Noida','Uttar Pradesh','METRO'),
    (c.id,'Faridabad','Haryana','METRO'),
    (c.id,'Ghaziabad','Uttar Pradesh','METRO'),
    (c.id,'Bengaluru','Karnataka','METRO'),
    (c.id,'Chennai','Tamil Nadu','METRO'),
    (c.id,'Kolkata','West Bengal','METRO'),
    (c.id,'Hyderabad','Telangana','METRO'),
    (c.id,'Pune','Maharashtra','METRO'),
    (c.id,'Ahmedabad','Gujarat','TIER2'),
    (c.id,'Jaipur','Rajasthan','TIER2'),
    (c.id,'Lucknow','Uttar Pradesh','TIER2'),
    (c.id,'Chandigarh','Chandigarh','TIER2'),
    (c.id,'Indore','Madhya Pradesh','TIER2'),
    (c.id,'Kochi','Kerala','TIER2'),
    (c.id,'Coimbatore','Tamil Nadu','TIER2'),
    (c.id,'Nagpur','Maharashtra','TIER2'),
    (c.id,'Surat','Gujarat','TIER2'),
    (c.id,'Bhubaneswar','Odisha','TIER2'),
    (c.id,'Visakhapatnam','Andhra Pradesh','TIER2'),
    (c.id,'Panipat','Haryana','OTHER'),
    (c.id,'Ludhiana','Punjab','OTHER')
  on conflict (company_id, city_name) do nothing;

  -- ==========================================================================
  -- PERIODS — open the current month and the two before it
  -- ==========================================================================
  perform travel_ensure_period(c.id, (date_trunc('month', current_date) - interval '2 months')::date);
  perform travel_ensure_period(c.id, (date_trunc('month', current_date) - interval '1 month')::date);
  perform travel_ensure_period(c.id,  date_trunc('month', current_date)::date);

end loop;
end $$;

-- ----------------------------------------------------------------------------
-- PART B — the 24 further expense types, their GPS flags, the per-mode cash
--          rate card, and the entitlements that go with them
--
-- Runs as its own block so a failure here does not roll back Part A. It looks
-- up the policy Part A created and skips any company that has none.
-- ----------------------------------------------------------------------------

do $$
declare
  c        record;
  v_policy uuid;
  v_from   date := date_trunc('year', current_date)::date;
begin
for c in select id from companies loop

  select id into v_policy
    from travel_policies
   where company_id = c.id and is_active
   order by effective_from desc
   limit 1;

  if v_policy is null then
    continue;   -- 050 has not been run for this company
  end if;

  -- ---- classify the eleven types 050 already created ---------------------
  update travel_expense_types set category = 'CONVEYANCE'
   where company_id = c.id and category is null
     and type_code in ('OWN_CAR','OWN_BIKE','CAB','AUTO','PUBLIC_TRANSPORT',
                       'COMPANY_CAB','TOLL','PARKING');
  update travel_expense_types set category = 'STAY'
   where company_id = c.id and category is null and type_code = 'HOTEL';
  update travel_expense_types set category = 'ALLOWANCE'
   where company_id = c.id and category is null and type_code = 'FOOD';
  update travel_expense_types set category = 'OTHER'
   where company_id = c.id and category is null;

  -- Own vehicle leaves no bill and is priced from the trail.
  update travel_expense_types
     set requires_gps = true, bill_required = false
   where company_id = c.id and type_code in ('OWN_CAR','OWN_BIKE');

  -- ---- new types ---------------------------------------------------------
  insert into travel_expense_types
    (company_id, type_code, type_name, calc_method, bill_threshold,
     allowed_local, allowed_outstation, pools_by_headcount, capture_gst,
     requires_vehicle, requires_gps, bill_required, category, gl_code, icon, sort_order)
  values
    -- bill-less conveyance, priced from GPS ---------------------------------
    -- pools_by_headcount stays false: one auto carries three people at one fare.
    (c.id,'AUTO_CASH',      'Auto (cash, no bill)',    'PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-010','auto',   41),
    (c.id,'CAB_CASH',       'Cab (cash, no bill)',     'PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-011','cab',    31),
    (c.id,'SHARED_AUTO',    'Shared auto / tempo',     'PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-012','auto',   42),
    (c.id,'E_RICKSHAW',     'E-rickshaw',              'PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-013','auto',   43),
    (c.id,'BIKE_TAXI',      'Bike taxi (cash)',        'PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-014','bike',   44),
    (c.id,'LOCAL_TRAIN',    'Local train / metro cash','PER_KM',0,true, true, false,false,false,true, false,'CONVEYANCE','CONV-015','metro',  51),

    -- outstation travel, always billed -------------------------------------
    (c.id,'FLIGHT',         'Flight',                  'ACTUAL',0,false,true, false,true, false,false,true, 'OUTSTATION','TRVL-010','flight',120),
    (c.id,'TRAIN',          'Train',                   'ACTUAL',0,false,true, false,true, false,false,true, 'OUTSTATION','TRVL-011','train', 130),
    (c.id,'BUS',            'Bus',                     'ACTUAL',0,false,true, false,true, false,false,true, 'OUTSTATION','TRVL-012','bus',   140),
    (c.id,'OUTSTATION_TAXI','Outstation taxi',         'ACTUAL',0,false,true, false,true, false,false,true, 'OUTSTATION','TRVL-013','cab',   150),
    (c.id,'FUEL',           'Fuel (with bill)',        'ACTUAL',0,true, true, false,true, true, false,true, 'CONVEYANCE','CONV-016','fuel',  45),
    (c.id,'DRIVER_ALLOW',   'Driver allowance',        'ACTUAL',0,true, true, false,false,true, false,false,'CONVEYANCE','CONV-017','driver',46),

    -- allowances ------------------------------------------------------------
    (c.id,'DAILY_ALLOW',    'Daily allowance',         'ACTUAL',0,false,true, false,false,false,false,false,'ALLOWANCE','TRVL-020','wallet',160),
    (c.id,'INCIDENTAL',     'Incidentals',             'ACTUAL',0,false,true, true, false,false,false,false,'ALLOWANCE','TRVL-021','misc',  170),
    (c.id,'LAUNDRY',        'Laundry',                 'ACTUAL',0,false,true, false,false,false,false,true, 'ALLOWANCE','TRVL-022','laundry',180),
    (c.id,'PORTERAGE',      'Porterage / coolie',      'ACTUAL',0,false,true, false,false,false,false,false,'ALLOWANCE','TRVL-023','bag',   190),

    -- communication ---------------------------------------------------------
    (c.id,'MOBILE',         'Mobile / calls',          'ACTUAL',0,true, true, false,true, false,false,true, 'COMMUNICATION','COMM-001','phone',200),
    (c.id,'INTERNET',       'Internet / data',         'ACTUAL',0,true, true, false,true, false,false,true, 'COMMUNICATION','COMM-002','wifi', 210),

    -- travel documents ------------------------------------------------------
    (c.id,'VISA',           'Visa fee',                'ACTUAL',0,false,true, false,false,false,false,true, 'DOCUMENTATION','TRVL-030','doc',  220),
    (c.id,'TRAVEL_INS',     'Travel insurance',        'ACTUAL',0,false,true, false,true, false,false,true, 'DOCUMENTATION','TRVL-031','shield',230),
    (c.id,'FOREX_MARKUP',   'Forex / card markup',     'ACTUAL',0,false,true, false,false,false,false,true, 'DOCUMENTATION','TRVL-032','forex',240),

    -- client facing ---------------------------------------------------------
    (c.id,'CLIENT_MEAL',    'Client entertainment',    'ACTUAL',0,true, true, true, true, false,false,true, 'CLIENT','CLNT-001','food',  250),
    (c.id,'BUSINESS_GIFT',  'Business gift',           'ACTUAL',0,true, true, false,true, false,false,true, 'CLIENT','CLNT-002','gift',  260),
    (c.id,'COURIER',        'Courier / postage',       'ACTUAL',0,true, true, false,true, false,false,true, 'OTHER','OTHR-001','parcel',270)
  on conflict (company_id, type_code) do nothing;

  -- ---- default per-mode rates -------------------------------------------
  -- Market rate for metro India, set to track real street fares so an employee
  -- paying cash is not left out of pocket. The HR Head revises these from the
  -- Rate card screen; a new row with a later effective_from supersedes them.
  insert into travel_mileage_rates
    (policy_id, type_code, vehicle_type, fuel_type, cc_band,
     rate_per_km, effective_from, rate_label, notes)
  values
    (v_policy,'AUTO_CASH',   null,null,'NA', 17.00, v_from,'Auto (cash)',        'Market rate, metro India'),
    (v_policy,'CAB_CASH',    null,null,'NA', 22.00, v_from,'Cab (cash)',         'Market rate, metro India'),
    (v_policy,'SHARED_AUTO', null,null,'NA',  5.00, v_from,'Shared auto',        'Market rate, metro India'),
    (v_policy,'E_RICKSHAW',  null,null,'NA', 10.00, v_from,'E-rickshaw',         'Market rate, metro India'),
    (v_policy,'BIKE_TAXI',   null,null,'NA',  8.00, v_from,'Bike taxi',          'Market rate, metro India'),
    (v_policy,'LOCAL_TRAIN', null,null,'NA',  3.00, v_from,'Local train / metro','Market rate, metro India')
  on conflict do nothing;

  -- ---- entitlements for the new types -----------------------------------
  insert into travel_entitlements (policy_id, grade, city_class, type_code, limit_basis, limit_value, enforcement) values
    -- Cash cab and auto are capped monthly rather than daily: a single client
    -- day can legitimately run long, but a runaway month should surface.
    -- NOTE: travel_entitlements is keyed per type, so these are two separate
    -- ₹8,000 ceilings, not one shared ₹8,000 across both.
    (v_policy,'DEFAULT',null,'AUTO_CASH',      'PER_MONTH',8000,'WARN'),
    (v_policy,'DEFAULT',null,'CAB_CASH',       'PER_MONTH',8000,'WARN'),
    (v_policy,'DEFAULT',null,'SHARED_AUTO',    'PER_DAY',   200,'WARN'),
    (v_policy,'DEFAULT',null,'E_RICKSHAW',     'PER_DAY',   200,'WARN'),
    (v_policy,'DEFAULT',null,'BIKE_TAXI',      'PER_DAY',   300,'WARN'),
    (v_policy,'DEFAULT',null,'LOCAL_TRAIN',    'PER_DAY',   300,'WARN'),
    (v_policy,'DEFAULT',null,'DAILY_ALLOW',    'PER_DAY',   800,'AUTO_TRIM'),
    (v_policy,'DEFAULT',null,'INCIDENTAL',     'PER_DAY',   300,'WARN'),
    (v_policy,'DEFAULT',null,'LAUNDRY',        'PER_DAY',   400,'WARN'),
    (v_policy,'DEFAULT',null,'PORTERAGE',      'PER_DAY',   200,'WARN'),
    (v_policy,'DEFAULT',null,'MOBILE',         'PER_MONTH',1000,'WARN'),
    (v_policy,'DEFAULT',null,'INTERNET',       'PER_MONTH',1000,'WARN'),
    (v_policy,'DEFAULT',null,'CLIENT_MEAL',    'PER_CLAIM',5000,'WARN'),
    (v_policy,'DEFAULT',null,'BUSINESS_GIFT',  'PER_CLAIM',2500,'WARN'),
    (v_policy,'DEFAULT',null,'COURIER',        'PER_CLAIM',1000,'WARN'),
    (v_policy,'DEFAULT',null,'DRIVER_ALLOW',   'PER_DAY',   600,'WARN'),
    (v_policy,'DEFAULT',null,'FUEL',           'PER_MONTH',8000,'WARN')
  on conflict do nothing;

end loop;
end $$;

-- ============================================================================
-- VERIFICATION — run this after 049, 050 and 051.
-- "Success" with no error is not proof. Every row below should read PASS.
-- ============================================================================

with checks as (
  select 'tables'    as object, count(*)::text as actual, '19' as expected
    from information_schema.tables
   where table_schema='public' and table_name like 'travel\_%'
  union all
  select 'functions', count(*)::text, '11'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'travel\_%'
  union all
  select 'views', count(*)::text, '3'
    from information_schema.views
   where table_schema='public' and table_name like 'v\_travel\_%'
  union all
  select 'triggers', count(*)::text, '5'
    from information_schema.triggers
   where trigger_schema='public' and trigger_name like 'trg\_travel\_%'
  union all
  select 'policies (1 per company)',
         (select count(*)::text from travel_policies),
         (select count(*)::text from companies)
  union all
  select 'expense types (35 per company)',
         (select count(*)::text from travel_expense_types),
         (select (count(*)*35)::text from companies)
  union all
  select 'GPS-priced modes (8 per company)',
         (select count(*)::text from travel_expense_types where requires_gps),
         (select (count(*)*8)::text from companies)
  union all
  select 'mode rates (6 per company)',
         (select count(*)::text from travel_mileage_rates where type_code is not null),
         (select (count(*)*6)::text from companies)
  union all
  select 'expense months OPEN (3 per company)',
         (select count(*)::text from travel_periods where status='OPEN'),
         (select (count(*)*3)::text from companies)
  union all
  select 'RM stage off (routes HR -> Finance)',
         (select count(*)::text from travel_policies where rm_stage_enabled = false),
         (select count(*)::text from travel_policies)
)
select object, expected, actual,
       case when actual = expected then 'PASS' else 'CHECK' end as result
  from checks;

-- plpgsql bodies are not checked when created. To confirm the routing function
-- really references the columns it should, read it back:
--   select pg_get_functiondef('travel_claim_approver(uuid,text)'::regprocedure);
--
-- And confirm routing resolves for a real employee:
--   select e.emp_code, travel_first_claim_stage(e.id) as goes_to
--     from employees e limit 5;
-- Expect PENDING_HR for everyone while l1_manager_id is unpopulated.
