-- =====================================================================
-- 101_seed_profile_field_config.sql
-- Without this, no employee can request a single profile change
--
-- FOR: Nayan Ahuja. Seed data. No schema change.
--
-- WHAT IS WRONG
--
-- 091 CREATES profile_field_config and never puts a row in it. There is no
-- INSERT into that table anywhere in the migration.
--
-- raise_profile_change_request() opens with:
--
--     select * into cfg from profile_field_config
--      where field_key = p_field_key and (company_id = comp or company_id is null)
--     if not found then
--       raise exception 'Field % is not configured, so there is nothing to route';
--
-- So every change request an employee raises fails, for every field. The
-- whole "Request an update" half of the Profile module is inert until this
-- table has rows. The vendor's integration guide mentions the table under
-- "adding a field later" and never says it starts empty.
--
-- WHAT THIS SEEDS
--
-- The nine fields the Profile UI can raise a request against, and only those.
-- Seeding fields the screen cannot reach would be config that nothing reads.
--
-- company_id is NULL on every row, which is deliberate. The lookup is
--
--     where field_key = ... and (company_id = comp or company_id is null)
--     order by company_id nulls last limit 1
--
-- so a NULL row is the fallback for every company, and a company that later
-- needs different routing gets its own row which wins over this one. One
-- default now, per-company overrides later, no migration needed for either.
--
-- ROUTING. Bank details go to payroll, everything else to HR. That matches
-- the fallback already written into the function
--
--     case when p_field_key like 'bank%' or p_field_key = 'ifsc'
--          then 'payroll' else 'hr' end
--
-- but it is set explicitly here so the routing is visible in the data rather
-- than buried in a CASE, and so changing it is an UPDATE rather than a
-- migration.
--
-- source_column is the BARE column name. 091's own comment explains why: the
-- module stored 'employees.full_name' and then did format('select %I', ...),
-- which quotes the whole string as one identifier and finds no such column.
-- Every value below is a real column on employees — checked, not assumed, and
-- three of them are NOT what the field is called: 091 renamed fourteen columns
-- on the way in, so the field_key the app sends and the column the old-value
-- lookup must read are different strings:
--
--     present_address    -> res_address1     (the view concatenates two lines;
--     permanent_address  -> perm_address1     the old value shows the first)
--     ifsc               -> ifsc_code
--
-- Getting these wrong does not fail loudly. raise_profile_change_request
-- catches undefined_column and sets old_val to null, so the request would be
-- filed with no "from" value and nobody would notice until an approver asked
-- what it used to say.
--
-- SAFE TO RUN TWICE: unique (company_id, field_key), and the insert is
-- ON CONFLICT DO NOTHING, so re-running changes nothing and never
-- overwrites a routing decision made afterwards.
-- =====================================================================

insert into profile_field_config
  (company_id, tab_key, group_label, field_key, label,
   source_column, edit_state, min_role, is_masked, is_mono, is_wide, hint, route_to, sort_order)
values
  -- ── Personal ──────────────────────────────────────────────────────
  (null, 'personal', 'Identity', 'marital_status', 'Marital status',
   'marital_status', 'event', 'self', false, false, false,
   'Opens family, nominee and insurance steps', 'hr', 10),

  (null, 'personal', 'Background', 'spouse_name', 'Spouse name',
   'spouse_name', 'request', 'self', false, false, false,
   null, 'hr', 20),

  (null, 'personal', 'Background', 'is_disabled', 'Differently abled',
   'is_disabled', 'request', 'self', false, false, false,
   'Drives Section 80U relief', 'hr', 30),

  (null, 'personal', 'Address and emergency', 'present_address', 'Present address',
   'res_address1', 'request', 'self', false, false, true,
   'Changes PT state and HRA exemption', 'hr', 40),

  (null, 'personal', 'Address and emergency', 'permanent_address', 'Permanent address',
   'perm_address1', 'request', 'self', false, false, true,
   null, 'hr', 50),

  -- ── Statutory ─────────────────────────────────────────────────────
  (null, 'statutory', 'Other identity documents', 'passport_no', 'Passport',
   'passport_no', 'request', 'hr', true, true, false,
   null, 'hr', 60),

  -- ── Payroll. These reach payroll, not HR. ────────────────────────
  (null, 'payroll', 'Salary account', 'bank_name', 'Bank name',
   'bank_name', 'request', 'self', false, false, false,
   null, 'payroll', 70),

  (null, 'payroll', 'Salary account', 'ifsc', 'IFSC',
   'ifsc_code', 'request', 'self', false, true, false,
   null, 'payroll', 80),

  (null, 'payroll', 'Salary account', 'bank_holder_name', 'Account holder',
   'bank_holder_name', 'request', 'hr', false, false, false,
   'Must match the name on the bank record', 'payroll', 90)

on conflict (company_id, field_key) do nothing;

-- Read it back. Expect nine rows, six routed to hr and three to payroll.
select field_key, label, edit_state, route_to, source_column
  from profile_field_config
 where company_id is null
 order by sort_order;
