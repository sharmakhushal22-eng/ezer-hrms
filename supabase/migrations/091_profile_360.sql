-- =====================================================================
-- 091_profile_360.sql — ESS Profile 360
--
-- ADAPTED FOR THIS DATABASE from EZER-Profile360.zip, which ships this as
-- migration 085. It is 091 here because 085 and 086 are already taken by the
-- Wall of Fame, and it was written against a different schema. Every change
-- is recorded in docs/PROFILE360-ADAPTATION.md with the evidence; the short
-- version:
--
--   RENAMED (14)  employee_code -> emp_code · date_of_joining -> company_doj
--                 status -> employment_status · reports_to_l1/l2 ->
--                 l1_manager_id/l2_manager_id · official_email -> office_email
--                 alt_mobile -> alternate_mobile · pan -> pan_number
--                 uan -> uan_number · ifsc -> ifsc_code
--                 esic_ip_number -> esic_number · bank_last4 ->
--                 bank_account_last4 · present/permanent_address ->
--                 res_address1 / perm_address1 · departments.name ->
--                 dept_name · companies.name -> company_name ·
--                 locations.name/code -> location_name/location_code
--
--   DROPPED       shifts and branches do not exist here. The shift field is
--                 removed rather than faked, and branch_code comes from
--                 locations.location_code.
--
--   REPLACED      employee_roles does not exist. Role resolution reads
--                 ess_user_roles + ess_roles, which is where roles live here.
--                 Left as-is the RPC would have been CREATEd cleanly and then
--                 failed at the first call.
--
--   NOT ADDED     employees.md_id. The MD is already companies.md_employee_id,
--                 which the PMS chain resolution uses. A per-employee copy
--                 would be a second source of truth for one fact.
--
--                 employees.auth_user_id. This app resolves the viewer through
--                 essRoute(), not a Supabase auth mapping — see §5 of the
--                 adaptation note.
--
-- SAFE TO RUN TWICE. Every statement is IF NOT EXISTS / OR REPLACE.
-- =====================================================================


-- ─── enums ───────────────────────────────────────────────────────────
do $$ begin create type profile_edit_state as enum ('direct','request','locked','event');
exception when duplicate_object then null; end $$;

do $$ begin create type profile_request_status as enum
  ('pending_l1','pending_hr','pending_payroll','approved','rejected','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type doc_status as enum
  ('pending','uploaded','verified','rejected','expired','superseded');
exception when duplicate_object then null; end $$;

do $$ begin create type asset_status as enum
  ('issued','in_use','return_due','returned','lost','damaged');
exception when duplicate_object then null; end $$;


-- ─── columns the page reads that this schema does not have ───────────
-- The module's own migration adds 14 of these. The rest are the ones it
-- assumed already existed and which genuinely do not — see §4 of the
-- adaptation note. `employees` here already has 217 columns, so each was
-- checked for an existing equivalent before being added.

alter table employees add column if not exists display_name           text;
alter table employees add column if not exists photo_path             text;
alter table employees add column if not exists photo_updated_at       timestamptz;
alter table employees add column if not exists place_of_birth         text;
alter table employees add column if not exists domicile_state         text;
alter table employees add column if not exists languages              text;
alter table employees add column if not exists workstation            text;
alter table employees add column if not exists business_unit          text;
alter table employees add column if not exists job_level              text;
alter table employees add column if not exists dotted_line_manager_id uuid references employees(id);
alter table employees add column if not exists whatsapp_optin         boolean default true;
alter table employees add column if not exists emergency_contact_1    text;
alter table employees add column if not exists emergency_contact_2    text;
alter table employees add column if not exists voter_id               text;
alter table employees add column if not exists eps_status             text;
alter table employees add column if not exists esic_dispensary        text;
alter table employees add column if not exists vpf_amount             numeric(12,2) default 0;
alter table employees add column if not exists profile_completeness   int default 0;

-- Assumed by the module, absent here under any name.
alter table employees add column if not exists attendance_mode        text;
alter table employees add column if not exists bank_holder_name       text;
alter table employees add column if not exists driving_licence        text;
alter table employees add column if not exists extension              text;
alter table employees add column if not exists is_disabled            boolean default false;
alter table employees add column if not exists passport_no            text;
alter table employees add column if not exists payment_mode           text;
alter table employees add column if not exists pf_number              text;
alter table employees add column if not exists probation_months       int;
alter table employees add column if not exists pt_state               text;
alter table employees add column if not exists weekly_off             text;

create index if not exists idx_employees_company_status
  on employees (company_id, employment_status);


-- ─── 1. field config ─────────────────────────────────────────────────
-- Drives approval routing and what an admin sees. lib/profile/fields.ts is
-- the copy that renders; §9 of the integration guide is right that the two
-- have to move together.
create table if not exists profile_field_config (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies(id) on delete cascade,
  tab_key        text not null,
  group_label    text not null,
  field_key      text not null,
  label          text not null,
  -- The BARE column name, not table-qualified. The module stored
  -- 'employees.full_name' here and then did format('select %I', …), which
  -- quotes the whole string as one identifier — "employees.full_name" — and
  -- finds no such column. See raise_profile_change_request() below.
  source_column  text not null,
  edit_state     profile_edit_state not null default 'locked',
  min_role       text not null default 'self',
  is_masked      boolean not null default false,
  is_mono        boolean not null default false,
  is_wide        boolean not null default false,
  hint           text,
  route_to       text,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz default now(),
  unique (company_id, field_key)
);
create index if not exists idx_pfc_company_tab
  on profile_field_config (company_id, tab_key, sort_order);


-- ─── 2. change requests ──────────────────────────────────────────────
create table if not exists profile_change_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  field_key       text not null,
  field_label     text not null,
  old_value       text,
  new_value       text not null,
  reason          text,
  route_to        text not null default 'hr',
  status          profile_request_status not null default 'pending_l1',
  requested_by    uuid references employees(id),
  approved_by     uuid references employees(id),
  approved_at     timestamptz,
  rejected_by     uuid references employees(id),
  rejected_at     timestamptz,
  remarks         text,
  applied_at      timestamptz,
  attachment_path text,
  created_at      timestamptz default now()
);
create index if not exists idx_pcr_emp    on profile_change_requests (employee_id, created_at desc);
create index if not exists idx_pcr_status on profile_change_requests (company_id, status);


-- ─── 3. documents ────────────────────────────────────────────────────
create table if not exists employee_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  doc_type      text not null,
  doc_name      text not null,
  file_path     text,
  file_size_kb  int,
  mime_type     text,
  status        doc_status not null default 'pending',
  is_mandatory  boolean default false,
  expiry_date   date,
  version       int default 1,
  superseded_by uuid references employee_documents(id),
  uploaded_by   uuid references employees(id),
  uploaded_at   timestamptz,
  verified_by   uuid references employees(id),
  verified_at   timestamptz,
  remarks       text,
  created_at    timestamptz default now()
);

-- ─── RECONCILE: this table ALREADY EXISTS with a narrower shape ──────────
-- `create table if not exists` skips it silently, so every later statement
-- that names a new column would fail with 42703 and abort the migration.
-- Verified against the live database on 4 Sep. Every column is added
-- NULLABLE: `not null` cannot be added to a populated table, and
-- employee_education already holds 8 rows.

alter table employee_documents
  add column if not exists company_id    uuid references companies(id) on delete cascade,
  add column if not exists file_path     text,
  add column if not exists file_size_kb  int,
  add column if not exists mime_type     text,
  add column if not exists status        doc_status default 'pending',
  add column if not exists is_mandatory  boolean default false,
  add column if not exists expiry_date   date,
  add column if not exists version       int default 1,
  add column if not exists superseded_by uuid references employee_documents(id),
  add column if not exists created_at    timestamptz default now();

update employee_documents d set company_id = e.company_id from employees e
 where e.id = d.employee_id and d.company_id is null;

create index if not exists idx_docs_emp on employee_documents (employee_id, status);


-- ─── 4. assets and application access ────────────────────────────────
create table if not exists employee_assets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  asset_code   text not null,
  category     text not null,
  asset_name   text not null,
  icon         text default '📦',
  serial_no    text,
  issued_on    date,
  return_due   date,
  returned_on  date,
  status       asset_status not null default 'in_use',
  remarks      text,
  created_at   timestamptz default now()
);
create index if not exists idx_assets_emp on employee_assets (employee_id, status);

create table if not exists employee_app_access (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  app_name    text not null,
  access_role text,
  granted_on  date,
  revoked_on  date,
  created_at  timestamptz default now()
);


-- ─── 5. family, nominations, insurance ───────────────────────────────
create table if not exists employee_family_members (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  member_name   text not null,
  relation      text not null,
  date_of_birth date,
  gender        text,
  aadhar_last4  text,
  is_dependent  boolean default false,
  is_verified   boolean default false,
  proof_doc_id  uuid references employee_documents(id),
  verified_by   uuid references employees(id),
  verified_at   timestamptz,
  is_insured    boolean default false,
  eligible_80d  boolean default false,
  created_at    timestamptz default now()
);
create index if not exists idx_family_emp on employee_family_members (employee_id);

create table if not exists employee_nominations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  scheme        text not null,
  member_id     uuid references employee_family_members(id) on delete cascade,
  nominee_name  text not null,
  relation      text,
  share_percent numeric(5,2) not null check (share_percent > 0 and share_percent <= 100),
  is_filed      boolean default false,
  filed_ref     text,
  created_at    timestamptz default now()
);
create index if not exists idx_nom_emp on employee_nominations (employee_id, scheme);

-- A scheme's shares may never exceed 100. Enforced per scheme, not per
-- employee: somebody can nominate different people for PF and for gratuity.
create or replace function check_nomination_share() returns trigger
language plpgsql as $$
declare total numeric;
begin
  select coalesce(sum(share_percent), 0) into total
    from employee_nominations
   where employee_id = new.employee_id and scheme = new.scheme
     and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if total + new.share_percent > 100 then
    raise exception 'Nominee share for % would exceed 100%% (currently %)', new.scheme, total;
  end if;
  return new;
end $$;
drop trigger if exists trg_nomination_share on employee_nominations;
create trigger trg_nomination_share before insert or update on employee_nominations
  for each row execute function check_nomination_share();

create table if not exists employee_insurance (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  policy_type     text not null,
  policy_name     text not null,
  sum_insured     numeric(14,2),
  covered_members text,
  policy_no       text,
  valid_from      date,
  valid_to        date,
  is_active       boolean default true,
  created_at      timestamptz default now()
);


-- ─── 6. education, experience, certifications, trainings ─────────────
create table if not exists employee_education (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  qualification text not null, institute text, specialisation text,
  from_year int, to_year int, score text, is_verified boolean default false,
  created_at timestamptz default now()
);
create table if not exists employee_experience (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  company text, designation text, from_date date, to_date date,
  is_current boolean default false, location text, is_verified boolean default false,
  created_at timestamptz default now()
);

-- ─── RECONCILE: this table ALREADY EXISTS with a narrower shape ──────────
-- `create table if not exists` skips it silently, so every later statement
-- that names a new column would fail with 42703 and abort the migration.
-- Verified against the live database on 4 Sep. Every column is added
-- NULLABLE: `not null` cannot be added to a populated table, and
-- employee_education already holds 8 rows.

-- NAMING: this migration first said `institution` and `organisation`. The live
-- tables say `institute` and `company`, and lib/onboarding/to-employee.ts
-- WRITES those names on every new hire. Renaming breaks onboarding silently;
-- adding synonyms splits one person's history across two columns. The existing
-- names win, and the genuinely new fields are added alongside them.

alter table employee_education
  add column if not exists company_id     uuid references companies(id) on delete cascade,
  add column if not exists institute      text,
  add column if not exists specialisation text,
  add column if not exists from_year      int,
  add column if not exists to_year        int,
  add column if not exists score          text,
  add column if not exists is_verified    boolean default false;

alter table employee_experience
  add column if not exists company_id  uuid references companies(id) on delete cascade,
  add column if not exists company     text,
  add column if not exists is_current  boolean default false,
  add column if not exists location    text,
  add column if not exists is_verified boolean default false;

update employee_education  d set company_id = e.company_id from employees e
 where e.id = d.employee_id and d.company_id is null;
update employee_experience d set company_id = e.company_id from employees e
 where e.id = d.employee_id and d.company_id is null;

-- The old rows record a single `year_of_passing` as TEXT. Carry it into
-- to_year only where it is a plain four-digit year; anything else is left null
-- for the employee to correct, rather than guessed at. The regex is tested
-- BEFORE the cast, so a stray value cannot abort the migration.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'employee_education' and column_name = 'year_of_passing') then
    update employee_education
       set to_year = year_of_passing::int
     where to_year is null and year_of_passing ~ '^[0-9]{4}$';
  end if;
end $$;

create table if not exists employee_certifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  cert_name text not null, issuer text, issued_on date, expires_on date,
  credential_id text, doc_id uuid references employee_documents(id),
  created_at timestamptz default now()
);
create table if not exists employee_trainings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  training_name text not null, category text, status text default 'assigned',
  due_date date, completed_on date, score text,
  created_at timestamptz default now()
);


-- ─── 7. profile completeness ─────────────────────────────────────────
-- Twelve checks, each worth one point, and each producing a sentence the
-- employee can act on rather than a bare percentage.
create or replace function profile_completeness(p_employee_id uuid)
returns table (score int, pending text[])
language plpgsql stable as $$
declare e record; miss text[] := '{}'; total int := 12; got int := 0;
begin
  select * into e from employees where id = p_employee_id;
  if not found then return; end if;

  if e.photo_path is not null then got := got + 1;
    else miss := miss || 'Upload a passport size photo'; end if;
  if e.pan_number is not null then got := got + 1;
    else miss := miss || 'Add your PAN'; end if;
  if coalesce(e.aadhar_last4, '') <> '' then got := got + 1;
    else miss := miss || 'Add your Aadhaar'; end if;
  if e.uan_number is not null then got := got + 1;
    else miss := miss || 'Add your UAN'; end if;
  if e.bank_account_last4 is not null then got := got + 1;
    else miss := miss || 'Add your salary account'; end if;
  if e.res_address1 is not null then got := got + 1;
    else miss := miss || 'Add your present address'; end if;
  if e.perm_address1 is not null then got := got + 1;
    else miss := miss || 'Add your permanent address'; end if;
  if e.emergency_contact_1 is not null then got := got + 1;
    else miss := miss || 'Add an emergency contact'; end if;
  if e.blood_group is not null then got := got + 1;
    else miss := miss || 'Add your blood group'; end if;

  if exists (select 1 from employee_nominations
              where employee_id = p_employee_id and scheme = 'pf')
    then got := got + 1; else miss := miss || 'Add a provident fund nominee'; end if;
  if exists (select 1 from employee_nominations
              where employee_id = p_employee_id and scheme = 'gratuity')
    then got := got + 1;
    else miss := miss || 'Add a gratuity nominee — the shares must total 100%'; end if;
  if exists (select 1 from employee_documents
              where employee_id = p_employee_id and status = 'verified')
    then got := got + 1; else miss := miss || 'Upload your onboarding documents'; end if;

  score := floor(got::numeric / total * 100);
  pending := miss;
  return next;
end $$;


-- ─── 8. the 360 view ─────────────────────────────────────────────────
-- One row per employee with everything joined. This is where most of the
-- renaming lives; see the header.
create or replace view v_employee_profile_360 as
select
  e.id, e.company_id,
  e.emp_code            as employee_code,
  e.full_name, e.display_name, e.photo_path,
  e.designation, e.sub_department, e.grade, e.job_level, e.employment_type,
  e.employee_category, e.cost_centre, e.business_unit, e.workstation,
  e.employment_status   as status,
  e.company_doj         as date_of_joining,
  e.confirmation_date, e.probation_months, e.notice_period_days,
  e.date_of_leaving, e.weekly_off, e.attendance_mode,
  e.date_of_birth, e.gender, e.blood_group, e.marital_status, e.marriage_date,
  e.nationality, e.place_of_birth, e.domicile_state, e.father_name, e.mother_name,
  e.spouse_name, e.languages, e.is_disabled, e.is_international_worker,
  e.office_email        as official_email,
  e.personal_email, e.mobile,
  e.alternate_mobile    as alt_mobile,
  e.extension, e.whatsapp_optin,
  -- Two address lines each, joined here so the page has one field to render.
  nullif(concat_ws(', ', e.res_address1,  e.res_address2),  '') as present_address,
  nullif(concat_ws(', ', e.perm_address1, e.perm_address2), '') as permanent_address,
  e.emergency_contact_1, e.emergency_contact_2,

  -- Statutory. Full values leave the database ONLY through
  -- get_employee_profile(), which strips them for anyone but HR.
  e.pan_number          as pan,
  e.aadhar_last4,
  e.uan_number          as uan,
  e.pf_number, e.pf_applicable, e.vpf_amount, e.eps_status,
  e.esic_number         as esic_ip_number,
  e.esic_dispensary, e.pt_state, e.lwf_state,
  e.passport_no, e.driving_licence, e.voter_id,

  e.bank_name,
  e.bank_account_last4  as bank_last4,
  e.ifsc_code           as ifsc,
  e.bank_holder_name, e.payment_mode,

  e.l1_manager_id       as reports_to_l1,
  e.l2_manager_id       as reports_to_l2,
  e.hod_id, e.dotted_line_manager_id,
  -- The MD is a company-level fact here, not a column on the employee.
  c.md_employee_id      as md_id,

  c.company_name,
  d.dept_name           as department_name,
  l.location_name,
  l.location_code       as branch_code,

  m1.full_name as rm_l1_name, m1.emp_code as rm_l1_code,
  m2.full_name as rm_l2_name, m2.emp_code as rm_l2_code,
  hd.full_name as hod_name,   hd.emp_code as hod_code,
  md.full_name as md_name,    md.emp_code as md_code,

  ctc.annual_ctc,
  ss.gross_monthly,

  (select count(*) from employees r
    where r.l1_manager_id = e.id and r.date_of_leaving is null) as reportee_count,
  extract(year  from age(current_date, e.company_doj))::int  as tenure_years,
  extract(month from age(current_date, e.company_doj))::int  as tenure_months,
  extract(year  from age(current_date, e.date_of_birth))::int as age_years
from employees e
left join companies   c  on c.id  = e.company_id
left join departments d  on d.id  = e.department_id
left join locations   l  on l.id  = e.location_id
left join employees   m1 on m1.id = e.l1_manager_id
left join employees   m2 on m2.id = e.l2_manager_id
left join employees   hd on hd.id = e.hod_id
left join employees   md on md.id = c.md_employee_id
left join lateral (select annual_ctc from ctc_master x
                    where x.employee_id = e.id
                    order by effective_from desc limit 1) ctc on true
left join lateral (select gross_monthly from salary_structures y
                    where y.employee_id = e.id
                    order by effective_from desc limit 1) ss on true;


-- ─── 9. the read path ────────────────────────────────────────────────
-- The ONLY way profile data leaves the database. Everything the page shows
-- comes through here, so the masking below is the real gate — the client's
-- `restricted` flag only decides how a hidden field looks.
create or replace function get_employee_profile(p_employee_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record; viewer record; role text := 'peer'; j jsonb; comp record;
begin
  select * into v from v_employee_profile_360 where id = p_employee_id;
  if not found then return jsonb_build_object('error', 'employee_not_found'); end if;

  select * into viewer from employees where id = p_viewer_id;
  if not found then return jsonb_build_object('error', 'viewer_not_found'); end if;

  -- Somebody who has left cannot read profiles, including their own.
  if viewer.date_of_leaving is not null and viewer.date_of_leaving < current_date then
    return jsonb_build_object('error', 'viewer_inactive');
  end if;

  -- Role is POSITIONAL, not assigned: who you are to THIS employee.
  --
  -- The module read employee_roles, which does not exist here. Roles live in
  -- ess_user_roles joined to ess_roles, so the same question is asked of the
  -- table that can answer it.
  if exists (
    select 1 from ess_user_roles ur
    join ess_roles r on r.id = ur.role_id
    where ur.employee_id = p_viewer_id
      and r.role_code in ('HR_MANAGER','HR_HEAD','CHRO','PAYROLL','PAYROLL_ADMIN',
                          'ADMIN_COMPANY','ADMIN_SUPER','SUPER_ADMIN')
  ) then role := 'hr';
  elsif p_viewer_id = v.reports_to_l1 or p_viewer_id = v.reports_to_l2
     or p_viewer_id = v.hod_id or p_viewer_id = v.md_id
  then role := 'manager';
  elsif p_viewer_id = p_employee_id
  then role := 'self';
  end if;

  j := to_jsonb(v);

  -- Strip what this viewer may not read. Removed from the payload entirely
  -- rather than blanked, so nothing sensitive travels and is merely hidden.
  if role <> 'hr' then
    j := j - 'pan' - 'passport_no' - 'bank_holder_name';
  end if;
  if role not in ('hr','self') then
    j := j - 'aadhar_last4' - 'bank_last4' - 'ifsc' - 'bank_name'
           - 'personal_email' - 'mobile' - 'alt_mobile'
           - 'present_address' - 'permanent_address'
           - 'emergency_contact_1' - 'emergency_contact_2'
           - 'date_of_birth' - 'father_name' - 'mother_name' - 'spouse_name'
           - 'uan' - 'pf_number' - 'esic_ip_number' - 'driving_licence' - 'voter_id';
  end if;
  -- Pay is manager-and-above, and never a peer's business.
  if role not in ('hr','manager','self') then
    j := j - 'annual_ctc' - 'gross_monthly';
  end if;
  if role = 'peer' then
    j := j - 'annual_ctc' - 'gross_monthly';
  end if;

  select * into comp from profile_completeness(p_employee_id);

  return jsonb_build_object(
    'employee',    j,
    'viewer_role', role,
    'completeness', jsonb_build_object(
      'score',   coalesce(comp.score, 0),
      'pending', coalesce(to_jsonb(comp.pending), '[]'::jsonb)),
    'family',      coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at)
                             from employee_family_members f
                             where f.employee_id = p_employee_id), '[]'::jsonb),
    'nominations', coalesce((select jsonb_agg(to_jsonb(n) order by n.scheme)
                             from employee_nominations n
                             where n.employee_id = p_employee_id), '[]'::jsonb),
    'insurance',   coalesce((select jsonb_agg(to_jsonb(i))
                             from employee_insurance i
                             where i.employee_id = p_employee_id and i.is_active), '[]'::jsonb),
    'documents',   coalesce((select jsonb_agg(to_jsonb(dd) order by dd.created_at desc)
                             from employee_documents dd
                             where dd.employee_id = p_employee_id), '[]'::jsonb),
    'assets',      coalesce((select jsonb_agg(to_jsonb(a) order by a.issued_on desc)
                             from employee_assets a
                             where a.employee_id = p_employee_id), '[]'::jsonb),
    'education',   coalesce((select jsonb_agg(to_jsonb(ed) order by ed.to_year desc)
                             from employee_education ed
                             where ed.employee_id = p_employee_id), '[]'::jsonb),
    'experience',  coalesce((select jsonb_agg(to_jsonb(ex) order by ex.from_date desc)
                             from employee_experience ex
                             where ex.employee_id = p_employee_id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(to_jsonb(ce) order by ce.issued_on desc)
                             from employee_certifications ce
                             where ce.employee_id = p_employee_id), '[]'::jsonb),
    'trainings',   coalesce((select jsonb_agg(to_jsonb(tr) order by tr.due_date)
                             from employee_trainings tr
                             where tr.employee_id = p_employee_id), '[]'::jsonb),
    'app_access',  coalesce((select jsonb_agg(to_jsonb(aa))
                             from employee_app_access aa
                             where aa.employee_id = p_employee_id
                               and aa.revoked_on is null), '[]'::jsonb)
  );
end $$;


-- ─── 10. raising a change request ────────────────────────────────────
create or replace function raise_profile_change_request(
  p_employee_id uuid, p_requested_by uuid, p_field_key text,
  p_field_label text, p_new_value text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg record; rid uuid; route text; old_val text; comp uuid; col text;
begin
  select company_id into comp from employees where id = p_employee_id;

  select * into cfg from profile_field_config
   where field_key = p_field_key and (company_id = comp or company_id is null)
   order by company_id nulls last limit 1;

  if not found then
    raise exception 'Field % is not configured, so there is nothing to route', p_field_key;
  end if;
  if cfg.edit_state = 'locked' then
    raise exception 'Field % is maintained by HR and cannot be requested', p_field_key;
  end if;

  route := coalesce(cfg.route_to,
           case when p_field_key like 'bank%' or p_field_key = 'ifsc'
                then 'payroll' else 'hr' end);

  -- The column name only. The module stored 'employees.full_name' here and
  -- then did format('select %I …'), which quotes the whole string as ONE
  -- identifier — "employees.full_name" — and finds no such column, so every
  -- request failed while looking correct. Split defensively in case an older
  -- row still holds the qualified form.
  col := split_part(cfg.source_column, '.', greatest(1,
           array_length(string_to_array(cfg.source_column, '.'), 1)));

  begin
    execute format('select %I::text from employees where id = $1', col)
      into old_val using p_employee_id;
  exception when undefined_column then
    old_val := null;   -- a config row pointing at a column that is not there
  end;                 -- must not stop somebody raising the request

  insert into profile_change_requests
    (company_id, employee_id, field_key, field_label, old_value, new_value,
     reason, route_to, status, requested_by)
  values (comp, p_employee_id, p_field_key, p_field_label, old_val, p_new_value,
          p_reason, route,
          case when route = 'payroll' then 'pending_payroll' else 'pending_l1' end,
          p_requested_by)
  returning id into rid;
  return rid;
end $$;


-- ─── 11. RLS — NAYAN
--
-- Not written, and this one matters more than the others I have handed over.
-- These tables hold Aadhaar last four, bank details, family members, salary
-- and documents. The house default USING (true) would make every employee's
-- record readable by every other employee, which is the opposite of what
-- get_employee_profile() spends its whole body preventing.
--
-- The good news is that the read path is already narrow: everything the page
-- shows comes through that one SECURITY DEFINER function, which resolves the
-- viewer's role and strips what they may not see. The tables themselves are
-- never read directly by the app.
--
-- So the safe posture is: NO direct grants at all, exactly as the ESS inbox
-- has, and let the RPC be the only door. Tell me if you would rather have
-- explicit policies and I will write them.
-- ─────────────────────────────────────────────────────────────────────

comment on view v_employee_profile_360 is
  'One row per employee, everything joined. Read through '
  'get_employee_profile() only — the view itself does no masking.';
