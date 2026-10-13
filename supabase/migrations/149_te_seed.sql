-- 149_te_seed.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  6 of 6: SEED
-- SAFE TO RUN TWICE. Run AFTER 148.
-- ----------------------------------------------------------------------------
-- GENERATED from the rules engine's default configuration (engine/te-engine.js) by
-- engine/tools/gen-seed.js. Do not edit the value lists by hand: change
-- the engine default and generate again, so the two never drift apart.
-- database/tests/parity proves te_config() of a freshly seeded company equals
-- the engine default, key for key.
--
-- WHAT IT DOES
--   te_seed_company(company)  gives ONE company its settings and masters:
--     settings, 12 categories, 9 transport modes, 5 vehicle types, 15 place
--     types, 9 stop reasons, 55 checks, limits for 4 grades plus DEFAULT,
--     24 city tiers, the company's own offices (from locations), 7 airports
--     and stations with the hub map, the two default approval workflows, and
--     this month and next month as open expense periods.
--   Every insert is "on conflict do nothing": running it again never
--   overwrites what an admin has changed since.
--
--   The last statement runs it for every company that exists today. A company
--   created later needs one call (the API does this lazily, see
--   app-code/lib/te/server.ts), or apply 151 to seed new companies by trigger.
--
-- THE FALLBACK APPROVER (who gets a level nobody fills) is chosen as: the most
-- senior active member of finance_team (CFO, then CONTROLLER, then MANAGER),
-- else the company's MD. Change it in Admin > Approval workflow.
-- ============================================================================

create or replace function te_seed_company(p_company_id uuid, p_actor uuid default null)
returns jsonb language plpgsql as $$
declare
  v_fallback uuid;
  v_today    date := te_today(p_company_id);
begin
  if not exists (select 1 from companies where id = p_company_id) then
    perform te_fail('TE_NOT_SET_UP', 'Company not found.');
  end if;

  -- ---- settings ---------------------------------------------------------------
  if to_regclass('public.finance_team') is not null then
    select f.employee_id into v_fallback from finance_team f
     where f.company_id = p_company_id and f.is_active and f.can_approve and te_is_employee_active(f.employee_id)
       and f.role in ('CFO','CONTROLLER','MANAGER')
     order by case f.role when 'CFO' then 1 when 'CONTROLLER' then 2 else 3 end, f.created_at limit 1;
  end if;
  if v_fallback is null then
    select c.md_employee_id into v_fallback from companies c where c.id = p_company_id;
  end if;

  insert into te_settings (company_id, bill_age_days, claim_deadline_days, notice_days, receipt_above, no_bill_per_day,
      client_per_head, misc_per_claim, comm_per_claim, advance_max_pct, grace_days, mileage_tolerance_pct,
      estimate_tolerance_pct, post_facto, post_facto_per_quarter, fast_track_amount, sample_pct, fallback_approver_id,
      reminder_days, escalate_days, auto_approve_on_timeout, dom_air_estimate, intl_air_estimate, default_grade,
      gps_rules, vehicle_rules, fuel_prices, limit_basis, breach_actions, risk_weights, risk_bands, zone_a_countries, extra, updated_by)
  values (p_company_id, 90, 15, 3, 200, 300, 1500, 1000, 1500, 80, 7, 10, 10,
      'limited', 2, 5000, 10, v_fallback, 2, 5, false, 6000, 65000, 'DEFAULT',
      '{"gpsRequired":true,"manualAllowed":true,"intlTrack":false,"pingSec":30,"minAccuracy":50,"startRadius":300,"endRadius":300,"hubRadius":2000,"routeTol":15,"gapMin":5,"trainGapMin":30,"maxSpeed":130,"stopMaxMin":90,"preApproveKm":75,"maxKmDay":150,"localMaxKm":120,"localMealCap":300,"abroadFactor":6,"maxKmDayOut":500,"provider":"Google Maps","retentionDays":180,"journeyClaim":"instant","pastDays":7,"pastPerMonth":5,"typedAddress":true}'::jsonb,
      '{"rcCheck":true,"owner":"any","insurance":"flag"}'::jsonb,
      '{"petrol":95,"diesel":88,"cng":76,"ev":9}'::jsonb,
      '{"meals":"strict","conv":"strict"}'::jsonb,
      '{"hotel":"cap","meals":"cap","conv":"cap","client":"justify","misc":"cap","comm":"cap","cls":"justify","nobill":"cap"}'::jsonb,
      '{"low":1,"medium":3,"high":8}'::jsonb,
      '{"medium":3,"high":8}'::jsonb,
      array['Australia', 'Austria', 'Belgium', 'Canada', 'Denmark', 'Finland', 'France', 'Germany', 'Hong Kong SAR', 'Ireland', 'Israel', 'Italy', 'Japan', 'Luxembourg', 'Netherlands', 'New Zealand', 'Norway', 'Qatar', 'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'United Arab Emirates', 'United Kingdom', 'United States'],
      '{"hodAbove":30000}'::jsonb, p_actor)
  on conflict (company_id) do nothing;

  -- ---- expense categories -----------------------------------------------------
  insert into te_categories (company_id, code, name, icon, needs_trip, proof, grp, sort_order)
  select p_company_id, v.* from (values
    ('air', 'Air travel', 'plane', true, 'always', 'Travel', 10),
    ('train', 'Train', 'train', true, 'always', 'Travel', 20),
    ('bus', 'Bus ticket', 'bus', true, 'always', 'Travel', 30),
    ('hotel', 'Hotel stay', 'bed', true, 'always', 'Stay', 40),
    ('meals', 'Meals', 'food', true, 'above', 'Food', 50),
    ('cab', 'Cab or taxi', 'car', false, 'above', 'Local travel', 60),
    ('local', 'Local conveyance, no bill', 'pin', false, 'none', 'Local travel', 70),
    ('mileage', 'Own vehicle', 'car', false, 'none', 'Local travel', 80),
    ('toll', 'Toll and parking', 'ticket', false, 'above', 'Local travel', 90),
    ('client', 'Client entertainment', 'users', false, 'always', 'Other', 100),
    ('comm', 'Courier and communication', 'file', false, 'above', 'Other', 110),
    ('misc', 'Miscellaneous', 'receipt', false, 'above', 'Other', 120)
  ) as v(code, name, icon, needs_trip, proof, grp, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- transport modes --------------------------------------------------------
  -- basis: km = per-km rate · bill = on a bill · nobill = fare, no bill · ticket = on the ticket · none = logged only
  insert into te_modes (company_id, code, name, icon, basis, scope_local, scope_domestic, scope_international, gps,
                        stops_allowed, fare_ceiling_per_km, min_fare, est_per_km, est_min, category_code, sort_order)
  select p_company_id, v.* from (values
    ('own', 'Own vehicle', 'car', 'km', true, true, false, 'track', true, 0, null, null, null, 'mileage', 10),
    ('company', 'Company vehicle', 'car', 'none', true, true, false, 'track', true, 0, null, null, null, null, 20),
    ('cab', 'Cab or taxi', 'taxi', 'bill', true, true, true, 'track', true, 25, 200, 16, 150, 'cab', 30),
    ('auto', 'Auto-rickshaw', 'auto', 'nobill', true, true, false, 'track', true, 15, 60, 12, 50, 'local', 40),
    ('public', 'City bus or metro', 'bus', 'nobill', true, true, true, 'track', false, 5, 40, 3, 30, 'local', 50),
    ('rental', 'Rental car', 'car', 'bill', false, true, true, 'track', true, 30, 1500, 14, 1500, 'cab', 60),
    ('train', 'Train', 'train', 'ticket', true, true, true, 'track', false, 0, null, 2, 300, 'train', 70),
    ('bus', 'Intercity bus', 'bus', 'ticket', false, true, true, 'track', false, 0, null, 1.6, 300, 'bus', 80),
    ('flight', 'Flight', 'plane', 'ticket', false, true, true, 'checkin', false, 0, null, null, null, 'air', 90)
  ) as v(code, name, icon, basis, scope_local, scope_domestic, scope_international, gps, stops_allowed,
         fare_ceiling_per_km, min_fare, est_per_km, est_min, category_code, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- vehicle types and per-km rates ------------------------------------------
  -- method fixed = rate_per_km · method fuel = fuel price / km_per_unit + wear_per_km
  insert into te_vehicle_types (company_id, code, name, example, method, rate_per_km, fuel, km_per_unit, wear_per_km, sort_order, updated_by)
  select p_company_id, v.*, p_actor from (values
    ('bike', 'Two-wheeler', 'Scooter or motorcycle', 'fixed', 4, 'petrol', 45, 1.5, 10),
    ('hatch', 'Hatchback', 'Small car', 'fixed', 9, 'petrol', 18, 3.5, 20),
    ('sedan', 'Sedan', 'Mid-size car', 'fixed', 11, 'petrol', 15, 4.5, 30),
    ('suv', 'SUV', 'SUV or MUV', 'fixed', 13, 'diesel', 13, 5.5, 40),
    ('ev', 'Electric car', 'Battery car, km per kWh', 'fuel', 7, 'ev', 7, 3, 50)
  ) as v(code, name, example, method, rate_per_km, fuel, km_per_unit, wear_per_km, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- place types ------------------------------------------------------------
  insert into te_place_types (company_id, code, name, sort_order)
  select p_company_id, v.* from (values
    ('corp', 'Corporate office', 10),
    ('branch', 'Branch or regional office', 20),
    ('factory', 'Factory or plant', 30),
    ('warehouse', 'Warehouse or depot', 40),
    ('client', 'Client site', 50),
    ('dealer', 'Dealer or distributor', 60),
    ('vendor', 'Vendor or supplier', 70),
    ('site', 'Project site', 80),
    ('event', 'Event, expo or training venue', 90),
    ('govt', 'Bank or government office', 100),
    ('airport', 'Airport', 110),
    ('station', 'Railway or bus station', 120),
    ('hotel', 'Hotel or stay', 130),
    ('home', 'Home', 140),
    ('other', 'Other', 150)
  ) as v(code, name, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- stop reasons (a business stop extends the route that is paid) -----------
  insert into te_stop_reasons (company_id, code, name, is_business, typical_minutes, sort_order)
  select p_company_id, v.* from (values
    ('meet', 'Meeting on the way', true, 40, 10),
    ('pick', 'Pick up or drop a colleague', true, 8, 20),
    ('goods', 'Collect or deliver material', true, 20, 30),
    ('fuel', 'Fuel or charging', false, 10, 40),
    ('meal', 'Meal or tea break', false, 25, 50),
    ('toll', 'Toll or parking', false, 3, 60),
    ('rest', 'Rest break', false, 15, 70),
    ('vehicle', 'Vehicle problem', false, 35, 80),
    ('other', 'Other', false, 12, 90)
  ) as v(code, name, is_business, typical_minutes, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- the 55 checks. is_live = false: shown to the admin, not evaluated yet -------
  insert into te_checks (company_id, code, layer, title, action, severity, is_enabled, is_live, sort_order)
  select p_company_id, v.* from (values
    ('A1', 'A', 'Mandatory fields and proofs are present', 'block', '', true, true, 10),
    ('A2', 'A', 'Bill date is not in the future and is inside the bill-age limit', 'block', '', true, true, 20),
    ('A3', 'A', 'PNR or ticket reference has the right format', 'warn', 'low', true, true, 30),
    ('A4', 'A', 'GSTIN has valid format and checksum', 'warn', 'low', true, true, 40),
    ('A5', 'A', 'Typed amount differs from the amount read from the bill', 'justify', 'medium', true, true, 50),
    ('A6', 'A', 'Claimed amount is more than the bill amount', 'block', '', true, true, 60),
    ('B1', 'B', 'Same file fingerprint as an earlier upload', 'block', '', true, true, 70),
    ('B2', 'B', 'Near-identical bill image', 'warn', 'high', true, true, 80),
    ('B3', 'B', 'Same merchant and invoice number', 'block', '', true, true, 90),
    ('B4', 'B', 'Same employee, date, amount and category', 'warn', 'low', true, true, 100),
    ('B5', 'B', 'Different employees, same merchant, date and amount', 'warn', 'medium', true, true, 110),
    ('B6', 'B', 'Same PNR, cab trip ID or FASTag ID claimed twice', 'block', '', true, true, 120),
    ('B7', 'B', 'Self-paid line matches a company-paid booking', 'block', '', true, true, 130),
    ('C1', 'C', 'Expense date is an approved leave day', 'justify', 'medium', true, true, 140),
    ('C2', 'C', 'Office punch on a day claimed as outstation', 'warn', 'high', true, true, 150),
    ('C3', 'C', 'Expense date is outside the trip dates', 'warn', 'low', true, true, 160),
    ('C4', 'C', 'Local travel or other expense on a weekly off or holiday', 'warn', 'low', true, true, 170),
    ('C5', 'C', 'Merchant state is not a trip city', 'warn', 'medium', true, true, 180),
    ('C6', 'C', 'Hotel nights exceed trip nights, or stays overlap', 'block', '', true, true, 190),
    ('C7', 'C', 'Timeline conflict between travel and spend', 'warn', 'medium', true, false, 200),
    ('C8', 'C', 'Employee already tagged as co-traveller on the bill', 'block', '', true, false, 210),
    ('C9', 'C', 'Employee is past date of leaving', 'block', '', true, false, 220),
    ('C10', 'C', 'Trip overlaps another trip of the same employee', 'block', '', true, true, 230),
    ('C11', 'C', 'Hotel or flight on a local trip', 'block', '', true, true, 240),
    ('D1', 'D', 'Claimed distance exceeds map distance beyond tolerance', 'cap', 'medium', true, true, 250),
    ('D2', 'D', 'Two or more bills from one merchant on one day', 'warn', 'medium', true, true, 260),
    ('D3', 'D', 'Amounts repeatedly just under a limit', 'warn', 'medium', true, false, 270),
    ('D4', 'D', 'Repeated round amounts on no-bill lines', 'warn', 'low', true, true, 280),
    ('D5', 'D', 'Amount far above peers', 'warn', 'medium', true, false, 290),
    ('D6', 'D', 'Consecutive bill numbers from one merchant', 'warn', 'high', true, false, 300),
    ('D7', 'D', 'High share of no-bill lines', 'warn', 'medium', true, false, 310),
    ('D8', 'D', 'Cash to one merchant in a day above ₹10,000', 'warn', 'medium', true, true, 320),
    ('D9', 'D', 'Restricted words on the bill', 'warn', 'medium', true, true, 330),
    ('D10', 'D', 'Claim exceeds the approved trip estimate', 'justify', 'medium', true, true, 340),
    ('E1', 'E', 'Image metadata shows editing software', 'warn', 'medium', true, true, 350),
    ('E2', 'E', 'PDF produced by a bill-generator tool', 'warn', 'high', true, true, 360),
    ('E3', 'E', 'E-invoice QR code does not match typed values', 'warn', 'high', true, false, 370),
    ('E4', 'E', 'GSTIN live status lookup', 'warn', 'medium', true, false, 380),
    ('F1', 'F', 'Approver is the claimant or a co-traveller', 'reroute', '', true, true, 390),
    ('F2', 'F', 'Approver clears flagged claims within seconds', 'report', '', true, false, 400),
    ('F3', 'F', 'One approver always approves one employee’s flags', 'report', '', true, false, 410),
    ('F4', 'F', 'Random sample of clean claims', 'sample', '', true, true, 420),
    ('G1', 'G', 'Leg started or checked in away from the planned start point', 'warn', 'medium', true, true, 430),
    ('G2', 'G', 'Leg ended or checked in away from the planned destination', 'justify', 'medium', true, true, 440),
    ('G3', 'G', 'GPS distance exceeds the shortest map route beyond tolerance', 'cap', 'medium', true, true, 450),
    ('G4', 'G', 'Tracking gap: no location for several minutes', 'warn', 'medium', true, true, 460),
    ('G5', 'G', 'Impossible speed or location jump (possible mock location)', 'warn', 'high', true, true, 470),
    ('G6', 'G', 'Mock-location app or developer mode found on the device', 'block', '', true, false, 480),
    ('G7', 'G', 'Travel leg without a GPS record or check-ins', 'justify', 'medium', true, true, 490),
    ('G8', 'G', 'Fare per km is above the ceiling for the mode', 'warn', 'medium', true, true, 500),
    ('G9', 'G', 'Vehicle is not verified in the employee’s profile', 'warn', 'low', true, true, 510),
    ('G10', 'G', 'Daily distance cap exceeded', 'cap', 'medium', true, true, 520),
    ('G11', 'G', 'Long stop on the way for a personal reason', 'warn', 'low', true, true, 530),
    ('G12', 'G', 'Own vehicle is registered in another person’s name', 'warn', 'low', true, true, 540),
    ('G13', 'G', 'Vehicle insurance or RC was not valid on the day of the drive', 'warn', 'medium', true, true, 550)
  ) as v(code, layer, title, action, severity, is_enabled, is_live, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- limits by grade and city tier (illustrative: replace with the company's policy) ----
  insert into te_grade_policies (company_id, grade, air_class, train_class, sort_order)
  select p_company_id, v.* from (values
    ('E1', 'Economy', '3A', 10),
    ('M1', 'Economy', '3A', 20),
    ('M2', 'Economy', '2A', 30),
    ('L1', 'Premium Economy', '1A', 40),
    ('DEFAULT', 'Economy', '3A', 990)
  ) as v(grade, air_class, train_class, sort_order)
  on conflict (company_id, grade) do nothing;

  insert into te_grade_limits (company_id, grade, tier, hotel_per_night, meals_per_day, conveyance_per_day)
  select p_company_id, v.* from (values
    ('E1', 'metro', 3500, 900, 600),
    ('E1', 'tier1', 2800, 750, 500),
    ('E1', 'rest', 2200, 600, 400),
    ('E1', 'intlA', 14000, 5000, 3000),
    ('E1', 'intlB', 9000, 3500, 2000),
    ('M1', 'metro', 4200, 1000, 700),
    ('M1', 'tier1', 3400, 850, 550),
    ('M1', 'rest', 2600, 700, 450),
    ('M1', 'intlA', 16000, 5500, 3500),
    ('M1', 'intlB', 10000, 4000, 2500),
    ('M2', 'metro', 5000, 1200, 800),
    ('M2', 'tier1', 4000, 1000, 600),
    ('M2', 'rest', 3000, 800, 500),
    ('M2', 'intlA', 18000, 6000, 4000),
    ('M2', 'intlB', 12000, 4500, 3000),
    ('L1', 'metro', 7500, 1800, 1200),
    ('L1', 'tier1', 6000, 1500, 1000),
    ('L1', 'rest', 4500, 1200, 800),
    ('L1', 'intlA', 25000, 8000, 5000),
    ('L1', 'intlB', 16000, 6000, 4000),
    ('DEFAULT', 'metro', 3500, 900, 600),
    ('DEFAULT', 'tier1', 2800, 750, 500),
    ('DEFAULT', 'rest', 2200, 600, 400),
    ('DEFAULT', 'intlA', 14000, 5000, 3000),
    ('DEFAULT', 'intlB', 9000, 3500, 2000)
  ) as v(grade, tier, hotel_per_night, meals_per_day, conveyance_per_day)
  on conflict (company_id, grade, tier) do nothing;

  -- ---- city tiers. hub_region groups cities that share an airport and a station ----
  insert into te_city_tiers (company_id, city, state_code, tier, hub_region)
  select p_company_id, v.* from (values
    ('Gurugram', '06', 'metro', 'NCR'),
    ('Delhi', '07', 'metro', 'NCR'),
    ('Bengaluru', '29', 'metro', null),
    ('Mumbai', '27', 'metro', null),
    ('Chennai', '33', 'metro', null),
    ('Hyderabad', '36', 'metro', null),
    ('Kolkata', '19', 'metro', null),
    ('Pune', '27', 'tier1', null),
    ('Ahmedabad', '24', 'tier1', null),
    ('Jaipur', '08', 'tier1', null),
    ('Lucknow', '09', 'tier1', null),
    ('Kochi', '32', 'tier1', null),
    ('Chandigarh', '04', 'tier1', null),
    ('Indore', '23', 'tier1', null),
    ('Nagpur', '27', 'rest', null),
    ('Dehradun', '05', 'rest', null),
    ('Raipur', '22', 'rest', null),
    ('Guwahati', '18', 'rest', null),
    ('New Delhi', '07', 'metro', 'NCR'),
    ('Noida', '09', 'metro', 'NCR'),
    ('Greater Noida', '09', 'metro', 'NCR'),
    ('Ghaziabad', '09', 'metro', 'NCR'),
    ('Faridabad', '06', 'metro', 'NCR'),
    ('Manesar', '06', 'metro', 'NCR')
  ) as v(city, state_code, tier, hub_region)
  on conflict (company_id, city) do nothing;

  -- ---- places: the company's own offices, from the locations master ------------
  if to_regclass('public.locations') is not null then
    insert into te_places (company_id, source, place_type, short_name, name, address, city, state, pin_code, country, lat, lng, created_by)
    select l.company_id, 'company',
           case when l.location_type ilike '%plant%' or l.location_type ilike '%factory%' then 'factory'
                when l.location_type ilike '%warehouse%' or l.location_type ilike '%depot%' then 'warehouse'
                when l.location_type ilike '%branch%' or l.location_type ilike '%regional%' then 'branch'
                else 'corp' end,
           left(l.location_name, 40), l.location_name,
           concat_ws(', ', nullif(l.address_line1, ''), nullif(l.city, ''), nullif(l.state, ''), nullif(l.pin_code, '')),
           l.city, l.state, case when l.pin_code ~ '^[1-9][0-9]{5}$' then l.pin_code end, 'India',
           l.latitude, l.longitude, p_actor
      from locations l
     where l.company_id = p_company_id and l.latitude is not null and l.longitude is not null
       and l.latitude between -90 and 90 and l.longitude between -180 and 180
       and coalesce(l.status, 'Active') = 'Active'
       and not exists (select 1 from te_places p where p.company_id = l.company_id and p.owner_employee_id is null
                          and p.source = 'company' and p.name = l.location_name);
  end if;

  -- ---- places: airports and stations --------------------------------------------
  insert into te_places (company_id, source, place_type, short_name, name, address, city, state, pin_code, country, lat, lng, code, created_by)
  select p_company_id, 'hub', v.place_type, v.short_name, v.name, v.address, v.city, v.state, v.pin_code, v.country, v.lat, v.lng, v.code, p_actor
    from (values
    ('airport', 'Delhi airport T3', 'IGI Airport T3', 'Terminal 3, Indira Gandhi International Airport, New Delhi, Delhi 110037', 'Delhi', 'Delhi', '110037', 'India', 28.5562, 77.1, 'DEL'),
    ('station', 'New Delhi station', 'New Delhi Railway Station', 'New Delhi Railway Station, Ajmeri Gate side, New Delhi, Delhi 110002', 'Delhi', 'Delhi', '110002', 'India', 28.643, 77.2194, 'NDLS'),
    ('airport', 'Bengaluru airport', 'Kempegowda International Airport T1', 'Terminal 1, Kempegowda International Airport, Devanahalli, Bengaluru, Karnataka 560300', 'Bengaluru', 'Karnataka', '560300', 'India', 13.1986, 77.7066, 'BLR'),
    ('airport', 'Mumbai airport T2', 'Chhatrapati Shivaji Maharaj International Airport T2', 'Terminal 2, Chhatrapati Shivaji Maharaj International Airport, Andheri East, Mumbai, Maharashtra 400099', 'Mumbai', 'Maharashtra', '400099', 'India', 19.0896, 72.8656, 'BOM'),
    ('airport', 'Pune airport', 'Pune International Airport', 'Pune International Airport, Lohegaon, Pune, Maharashtra 411032', 'Pune', 'Maharashtra', '411032', 'India', 18.5821, 73.9197, 'PNQ'),
    ('station', 'Jaipur Junction', 'Jaipur Junction railway station', 'Jaipur Junction, Station Road, Jaipur, Rajasthan 302006', 'Jaipur', 'Rajasthan', '302006', 'India', 26.9196, 75.7878, 'JP'),
    ('airport', 'Dubai airport T3', 'Dubai International Airport T3', 'Terminal 3, Dubai International Airport, Al Garhoud, Dubai, United Arab Emirates', 'Dubai', null, null, 'United Arab Emirates', 25.2532, 55.3657, 'DXB')
    ) as v(place_type, short_name, name, address, city, state, pin_code, country, lat, lng, code)
   where not exists (select 1 from te_places p where p.company_id = p_company_id and p.source = 'hub' and p.code = v.code);

  insert into te_hubs (company_id, area, kind, place_id)
  select p_company_id, v.area, v.kind, p.id
    from (values
    ('NCR', 'air', 'DEL'),
    ('NCR', 'rail', 'NDLS'),
    ('Bengaluru', 'air', 'BLR'),
    ('Mumbai', 'air', 'BOM'),
    ('Pune', 'air', 'PNQ'),
    ('Jaipur', 'rail', 'JP'),
    ('Dubai', 'air', 'DXB')
    ) as v(area, kind, code)
    join te_places p on p.company_id = p_company_id and p.source = 'hub' and p.code = v.code
  on conflict (company_id, area, kind) do nothing;

  -- ---- the two default workflows ------------------------------------------------
  if not exists (select 1 from te_workflows w where w.company_id = p_company_id and w.code = 'claim') then
    perform te_workflow_save(p_company_id, 'claim', te_default_levels('claim'), p_actor);
  end if;
  if not exists (select 1 from te_workflows w where w.company_id = p_company_id and w.code = 'trip') then
    perform te_workflow_save(p_company_id, 'trip', te_default_levels('trip'), p_actor);
  end if;

  -- ---- expense months: this one and the next --------------------------------------
  perform travel_ensure_period(p_company_id, v_today);
  perform travel_ensure_period(p_company_id, (date_trunc('month', v_today) + interval '1 month')::date);

  return jsonb_build_object('company_id', p_company_id, 'fallback_approver_id', v_fallback, 'seeded', true);
end;
$$;

-- The Finance queue (migration 053) learns about v2 claims. Off = nothing is queued.
do $$
begin
  if to_regclass('public.finance_modules') is not null then
    insert into finance_modules (module_code, module_name, description, icon, detail_route, is_enabled, sort_order)
    values ('EXPENSE', 'Travel & Expense', 'Trip and expense claims (v2). Finance verifies, then pays.', 'receipt', '/dashboard/expenses', true, 15)
    on conflict (module_code) do nothing;
  end if;
end $$;

-- Every company that exists today.
do $$
declare
  r record;
  n int := 0;
begin
  for r in select id from companies loop
    perform te_seed_company(r.id);
    n := n + 1;
  end loop;
  raise notice 'Travel and Expense v2 seeded for % companies', n;
end $$;

notify pgrst, 'reload schema';
