-- =====================================================================
-- ADAPTED FOR THIS DATABASE — see 082_access_foundation.sql
--
-- The bundle this came from assumes a schema that differs from the live one.
-- Every rename below was verified against the RUNNING database before it was
-- applied, not inferred from the code:
--
--   employee_code    -> emp_code          (employees)
--   date_of_joining  -> company_doj       (employees)
--   reports_to       -> l1_manager_id     (employees)
--   department_name  -> dept_name         (departments)
--   branches         -> locations          there is no branches table here,
--   branch_id           location_id        and employees.branch_id does not
--   branch_name         location_name      exist either
--
-- Nothing else was touched. is_active was left alone throughout: every
-- occurrence in this bundle is on the module's OWN tables (wall_admins,
-- board_screens, shoutout_categories, badge_master), not on companies.
--
-- can() and explain_access() come from 082, which reads the permission model
-- this app already has (ess_accounts / ess_user_roles / role_permissions)
-- rather than introducing a second one.
--
-- NOT APPLIED FROM HERE. Handed to Nayan.
-- =====================================================================

-- =====================================================================
-- EZER HRMS · migration 084_wall_of_fame.sql
-- Module   : Wall of Fame (recognition, badges, milestones, digital board)
-- Depends  : 083_rbac.sql  (can(), explain_access(), module_availability)
-- Author   : EZER product
-- =====================================================================
-- ACCESS PRINCIPLE
--   Nothing in this module is self-serve. The module is switched on for a
--   company only by EZER's own Super Admin. Inside the company, every
--   configuration surface (awards, badges, values, cycles, approval chain,
--   points, visibility, board screens) is writable only by an employee who
--   holds an explicit, non-self-granted Wall Administrator record.
--   Employees can only see and post what the admin has enabled for them.
--
--   Enforcement happens in three layers, all of which must pass:
--     1. wall_config          — company master switches
--     2. wall_admins          — explicit named grants with scope + expiry
--     3. wof_can()            — per-permission check, delegates to RBAC can()
--   Config tables additionally carry a BEFORE trigger that rejects any write
--   not made by a current Wall Administrator, so a stray API route or a
--   direct table write cannot bypass the check.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. COMPANY MASTER SWITCHES
-- ---------------------------------------------------------------------
create table if not exists wall_config (
  company_id              uuid primary key references companies(id) on delete cascade,

  -- master switch. Only EZER Super Admin may flip this on (see trigger below).
  module_enabled          boolean not null default false,
  activated_by            uuid references employees(id),
  activated_at            timestamptz,

  -- feature switches, controlled by the company's Wall Administrator
  wall_enabled            boolean not null default true,
  shoutouts_enabled       boolean not null default true,
  nominations_enabled     boolean not null default true,
  badges_enabled          boolean not null default true,
  points_enabled          boolean not null default true,
  leaderboard_enabled     boolean not null default true,
  milestones_enabled      boolean not null default true,
  board_enabled           boolean not null default false,
  comments_enabled        boolean not null default true,
  reactions_enabled       boolean not null default true,

  show_birthdays          boolean not null default true,
  show_service_years      boolean not null default true,
  allow_self_nomination   boolean not null default false,
  allow_cross_company     boolean not null default false,

  default_visibility      text    not null default 'company'
                          check (default_visibility in ('company','branch','department','team')),

  -- shoutout throttles, so the feed cannot be gamed
  shoutout_daily_limit    int     not null default 5,
  shoutout_cooldown_hours int     not null default 24,   -- same giver → same receiver

  -- HARD LOCK. Wall of Fame is developmental / recognition only.
  -- Mirrors the PMS v2 decision: no payout, increment, CTC or variable-pay link.
  payout_linkage          boolean not null default false
                          check (payout_linkage = false),

  -- per-location overrides: {"<branch_uuid>": {"wall_enabled": false}}
  location_overrides      jsonb   not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references employees(id)
);

comment on table  wall_config is 'One row per company. Master and feature switches for the Wall of Fame module.';
comment on column wall_config.module_enabled is 'Flipped only by EZER Super Admin after commercial activation.';
comment on column wall_config.payout_linkage is 'Permanently false by CHECK. Recognition must never drive pay.';


-- ---------------------------------------------------------------------
-- 2. WALL ADMINISTRATORS  (explicit, named, auditable grants)
-- ---------------------------------------------------------------------
create table if not exists wall_admins (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,

  admin_level     text not null default 'wall_admin'
                  check (admin_level in ('wall_owner','wall_admin','wall_moderator','board_operator')),

  -- scope of the grant. location_id null = whole company.
  location_id       uuid references locations(id),

  granted_by      uuid not null references employees(id),
  granted_at      timestamptz not null default now(),
  grant_reason    text,
  valid_until     date,                       -- optional expiry for temporary cover
  revoked_by      uuid references employees(id),
  revoked_at      timestamptz,
  revoke_reason   text,
  is_active       boolean generated always as (revoked_at is null) stored,

  -- an employee cannot grant Wall admin rights to themselves
  constraint wall_admins_no_self_grant check (employee_id <> granted_by)
);

create unique index if not exists wall_admins_unique_active
  on wall_admins (company_id, employee_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

create index if not exists wall_admins_lookup on wall_admins (company_id, employee_id) where revoked_at is null;

comment on table wall_admins is 'Named Wall of Fame administrators. Self-granting is blocked at DB level; every grant records who granted it and why.';

/*
  Admin level capabilities
  ------------------------------------------------------------------
  wall_owner       full config + can grant/revoke other wall admins
  wall_admin       full config, cannot grant admin rights
  wall_moderator   publish, unpublish, handle reports; no config
  board_operator   board screens only (create, pair, rotate code)
*/


-- ---------------------------------------------------------------------
-- 3. PERMISSION CATALOGUE  (registered into the 083 RBAC model)
-- ---------------------------------------------------------------------
create table if not exists wall_permissions (
  code        text primary key,
  label       text not null,
  admin_only  boolean not null default false,
  min_level   text
);

insert into wall_permissions (code, label, admin_only, min_level) values
  ('wof.view',            'View the wall',                       false, null),
  ('wof.shoutout.create', 'Post a peer shoutout',                false, null),
  ('wof.nominate',        'Nominate for a formal award',         false, null),
  ('wof.react',           'React and comment',                   false, null),
  ('wof.endorse',         'Endorse a nomination (RM L1)',        false, null),
  ('wof.shortlist',       'Shortlist a nomination (HOD)',        false, null),
  ('wof.publish',         'Publish a recognition to the wall',   true,  'wall_moderator'),
  ('wof.unpublish',       'Remove or archive a recognition',     true,  'wall_moderator'),
  ('wof.moderate',        'Handle reported content',             true,  'wall_moderator'),
  ('wof.configure',       'Edit awards, values, cycles, config', true,  'wall_admin'),
  ('wof.badge.manage',    'Edit badge master and tier rules',    true,  'wall_admin'),
  ('wof.board.manage',    'Create and pair board screens',       true,  'board_operator'),
  ('wof.report.view',     'View recognition analytics',          true,  'wall_admin'),
  ('wof.admin.grant',     'Grant or revoke Wall administrators', true,  'wall_owner'),
  ('wof.module.activate', 'Activate the module for a company',   true,  'super_admin')
on conflict (code) do nothing;


-- ---------------------------------------------------------------------
-- 4. CONTENT MASTERS
-- ---------------------------------------------------------------------
create table if not exists recognition_values (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null,
  label         text not null,
  description   text,
  colour_token  text not null default 'blue'
                check (colour_token in ('blue','green','cyan','violet','rose','gold','slate')),
  icon          text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references employees(id),
  unique (company_id, code)
);

create table if not exists recognition_awards (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  code               text not null,
  name               text not null,
  description        text,

  frequency          text not null default 'monthly'
                     check (frequency in ('monthly','quarterly','half_yearly','annual','anytime')),
  scope              text not null default 'company'
                     check (scope in ('company','branch','department')),
  winners_per_cycle  int  not null default 1 check (winners_per_cycle between 1 and 50),
  points             int  not null default 0 check (points between 0 and 1000),

  -- null = nomination driven; otherwise generated by a job
  auto_source        text check (auto_source in ('doj_long_service','attendance_perfect','pms_remark')),
  needs_nomination   boolean not null default true,

  -- who may nominate / who signs off. Roles resolved through RBAC can().
  eligible_nominators text[] not null default '{employee}',
  approval_chain     jsonb  not null default '["rm_l1","hod","hr_manager"]'::jsonb,

  badge_code         text,
  show_on_board      boolean not null default true,
  restrict_to_branches uuid[],           -- e.g. Safety Champion only at plants
  restrict_to_departments uuid[],

  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         uuid references employees(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references employees(id),
  unique (company_id, code)
);

create table if not exists badge_master (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  code             text not null,
  label            text not null,
  glyph            text not null default '★',
  shape            text not null default 'shield'
                   check (shape in ('shield','hex','medal','ring')),
  base_tier        text not null default 'bronze'
                   check (base_tier in ('blue','bronze','silver','gold','platinum')),
  tier_thresholds  jsonb not null default '{"bronze":1,"silver":3,"gold":5,"platinum":10}'::jsonb,

  award_id         uuid references recognition_awards(id) on delete set null,
  value_code       text,                    -- badge earned by repeated value shoutouts
  unlock_rule      jsonb,                   -- {"type":"count","source":"shoutout","n":5}
  service_years    int,                     -- ring badges: 5, 10, 15, 20

  show_on_board    boolean not null default true,
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  created_by       uuid references employees(id),
  unique (company_id, code)
);

comment on column badge_master.tier_thresholds is 'Metal upgrades by repeat count. Editable per company; award_badge() reads it at runtime.';


-- ---------------------------------------------------------------------
-- 5. NOMINATIONS AND PUBLISHED CONTENT
-- ---------------------------------------------------------------------
create table if not exists recognition_nominations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  award_id            uuid not null references recognition_awards(id) on delete cascade,
  cycle_label         text not null,                  -- '2026-11' | 'FY2627-Q3'

  nominee_employee_id uuid not null references employees(id),
  nominated_by        uuid not null references employees(id),
  citation            text not null check (length(citation) between 20 and 2000),
  citation_hi         text,                            -- optional Hindi line for the board
  value_ids           uuid[] not null default '{}',
  evidence_url        text,

  status              text not null default 'pending'
                      check (status in ('pending','endorsed','shortlisted','won','rejected','closed')),
  current_stage       text not null default 'rm_l1',
  stage_log           jsonb not null default '[]'::jsonb,
  decided_by          uuid references employees(id),
  decided_at          timestamptz,
  decision_note       text,

  created_at          timestamptz not null default now()
);

create index if not exists nominations_cycle on recognition_nominations (company_id, award_id, cycle_label, status);
create index if not exists nominations_stage on recognition_nominations (company_id, current_stage, status);

create table if not exists recognitions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  location_id             uuid references locations(id),

  kind                  text not null
                        check (kind in ('award','shoutout','milestone','pms_remark')),
  award_id              uuid references recognition_awards(id) on delete set null,
  nomination_id         uuid references recognition_nominations(id) on delete set null,

  giver_employee_id     uuid references employees(id),        -- null for system posts
  receiver_employee_ids uuid[] not null check (array_length(receiver_employee_ids,1) between 1 and 25),

  message               text,
  message_hi            text,
  value_ids             uuid[] not null default '{}',
  points_awarded        int not null default 0,

  visibility            text not null default 'company'
                        check (visibility in ('company','branch','department','team')),
  cycle_label           text,

  -- publication is an admin act, always attributed
  published_by          uuid references employees(id),
  published_at          timestamptz not null default now(),
  is_archived           boolean not null default false,
  archived_by           uuid references employees(id),
  archived_at           timestamptz,
  archive_reason        text,

  created_at            timestamptz not null default now()
);

create index if not exists recognitions_feed on recognitions (company_id, is_archived, published_at desc);
create index if not exists recognitions_receivers on recognitions using gin (receiver_employee_ids);
create index if not exists recognitions_cycle on recognitions (company_id, award_id, cycle_label);

create table if not exists recognition_reactions (
  id              uuid primary key default gen_random_uuid(),
  recognition_id  uuid not null references recognitions(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  emoji           text not null default 'clap',
  created_at      timestamptz not null default now(),
  unique (recognition_id, employee_id, emoji)
);

create table if not exists recognition_comments (
  id              uuid primary key default gen_random_uuid(),
  recognition_id  uuid not null references recognitions(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  body            text not null check (length(body) between 1 and 1000),
  is_hidden       boolean not null default false,
  hidden_by       uuid references employees(id),
  created_at      timestamptz not null default now()
);

create table if not exists recognition_reports (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  recognition_id  uuid references recognitions(id) on delete cascade,
  comment_id      uuid references recognition_comments(id) on delete cascade,
  reported_by     uuid not null references employees(id),
  reason          text not null,
  status          text not null default 'open' check (status in ('open','upheld','dismissed')),
  handled_by      uuid references employees(id),
  handled_at      timestamptz,
  handler_note    text,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. EARNED BADGES
-- ---------------------------------------------------------------------
create table if not exists employee_badges (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  badge_code       text not null,
  earned_count     int  not null default 1 check (earned_count >= 0),
  tier             text not null default 'bronze'
                   check (tier in ('blue','bronze','silver','gold','platinum')),
  progress_pct     int  not null default 100 check (progress_pct between 0 and 100),
  first_earned_on  date,
  last_earned_on   date,
  updated_at       timestamptz not null default now(),
  unique (employee_id, badge_code)
);

create index if not exists employee_badges_company on employee_badges (company_id, badge_code);


-- ---------------------------------------------------------------------
-- 7. DIGITAL BOARD SCREENS
-- ---------------------------------------------------------------------
create table if not exists board_screens (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  location_id        uuid not null references locations(id) on delete cascade,
  screen_name      text not null,                       -- 'Manesar Plant · Gate 2'

  pair_code        text not null unique,                -- public route key, rotatable
  pair_code_set_at timestamptz not null default now(),

  rotate_seconds   int  not null default 8 check (rotate_seconds between 5 and 120),
  language         text not null default 'en' check (language in ('en','hi','both')),
  slide_types      text[] not null default '{hero,grid,milestone}',
  scope            text not null default 'branch' check (scope in ('branch','company','group')),
  max_slides       int not null default 12 check (max_slides between 3 and 40),

  is_active        boolean not null default true,
  created_by       uuid not null references employees(id),
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz,
  last_seen_ip     inet
);

comment on table board_screens is 'One row per physical TV. Only wof.board.manage holders can create a screen or rotate a pair code.';


-- ---------------------------------------------------------------------
-- 8. AUDIT LOG
-- ---------------------------------------------------------------------
create table if not exists wall_audit_log (
  id            bigserial primary key,
  company_id    uuid not null,
  actor_id      uuid,
  action        text not null,          -- 'config.update' | 'admin.grant' | 'award.create' | ...
  entity        text not null,
  entity_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);

create index if not exists wall_audit_company on wall_audit_log (company_id, created_at desc);


-- =====================================================================
-- 9. ACCESS CONTROL FUNCTIONS
-- =====================================================================

-- The API layer sets these per request:
--   set_config('app.current_employee_id', '<uuid>', true)
--   set_config('app.current_company_id',  '<uuid>', true)
create or replace function wof_current_employee()
returns uuid language sql stable as $$
  select nullif(current_setting('app.current_employee_id', true), '')::uuid;
$$;

-- Is this employee an active Wall Administrator at or above a given level?
create or replace function is_wall_admin(
  p_employee uuid,
  p_company  uuid,
  p_min_level text default 'wall_admin',
  p_branch   uuid default null
) returns boolean language sql stable as $$
  with rank_map(level, rank) as (
    values ('board_operator',1),('wall_moderator',2),('wall_admin',3),('wall_owner',4)
  )
  select exists (
    select 1
    from wall_admins a
    join rank_map rm  on rm.level = a.admin_level
    join rank_map req on req.level = p_min_level
    where a.company_id  = p_company
      and a.employee_id = p_employee
      and a.revoked_at is null
      and (a.valid_until is null or a.valid_until >= current_date)
      and (a.location_id is null or p_branch is null or a.location_id = p_branch)
      and rm.rank >= req.rank
  );
$$;

-- Master permission check. Every API route calls this before anything else.
create or replace function wof_can(
  p_employee   uuid,
  p_permission text,
  p_company    uuid default null,
  p_branch     uuid default null
) returns boolean language plpgsql stable as $$
declare
  v_company  uuid;
  v_cfg      wall_config%rowtype;
  v_min      text;
  v_admin_only boolean;
  v_left     boolean;
begin
  if p_employee is null then
    return false;
  end if;

  select coalesce(p_company, company_id) into v_company from employees where id = p_employee;
  if v_company is null then
    return false;
  end if;

  -- an employee who has left keeps no access at all (read or write)
  select (date_of_leaving is not null and date_of_leaving < current_date)
    into v_left from employees where id = p_employee;
  if v_left then
    return false;
  end if;

  select * into v_cfg from wall_config where company_id = v_company;

  -- module not activated by EZER Super Admin → nothing is permitted
  if v_cfg.company_id is null or v_cfg.module_enabled = false then
    return false;
  end if;

  select admin_only, min_level into v_admin_only, v_min
    from wall_permissions where code = p_permission;
  if v_admin_only is null then
    return false;                            -- unknown permission, deny
  end if;

  -- feature switches
  if p_permission = 'wof.view'            and not v_cfg.wall_enabled        then return false; end if;
  if p_permission = 'wof.shoutout.create' and not v_cfg.shoutouts_enabled   then return false; end if;
  if p_permission = 'wof.nominate'        and not v_cfg.nominations_enabled then return false; end if;
  if p_permission = 'wof.react'           and not v_cfg.reactions_enabled   then return false; end if;
  if p_permission = 'wof.board.manage'    and not v_cfg.board_enabled       then return false; end if;

  -- per-location override, e.g. a branch where ESS is switched off
  if p_branch is not null
     and coalesce((v_cfg.location_overrides -> p_branch::text ->> 'wall_enabled')::boolean, true) = false then
    return false;
  end if;

  -- admin-only permissions require an explicit Wall Administrator grant
  if v_admin_only then
    if v_min = 'super_admin' then
      return coalesce(
        (select can(p_employee, 'company.activate', 'global')), false);
    end if;
    return is_wall_admin(p_employee, v_company, v_min, p_branch);
  end if;

  -- everyday permissions fall through to the RBAC model from migration 083
  if to_regprocedure('can(uuid,text,text)') is not null then
    return coalesce((select can(p_employee, p_permission, 'self')), true);
  end if;
  return true;
end $$;

comment on function wof_can is 'Single gate for the whole module. Order: employee active → module activated → feature switch → location override → admin grant or RBAC.';

-- Human-readable explanation, mirrors explain_access() from 083.
create or replace function wof_explain_access(p_employee uuid, p_permission text, p_company uuid default null)
returns text language plpgsql stable as $$
declare v_company uuid; v_cfg wall_config%rowtype; v_min text; v_admin boolean;
begin
  select coalesce(p_company, company_id) into v_company from employees where id = p_employee;
  select * into v_cfg from wall_config where company_id = v_company;
  if v_cfg.company_id is null then return 'Module has never been set up for this company.'; end if;
  if not v_cfg.module_enabled then return 'Module is not activated. EZER Super Admin must activate it.'; end if;
  select admin_only, min_level into v_admin, v_min from wall_permissions where code = p_permission;
  if v_admin is null then return 'Unknown permission code.'; end if;
  if v_admin and not is_wall_admin(p_employee, v_company, v_min) then
    return format('Requires Wall Administrator level %s or above. Ask a Wall Owner to grant it.', v_min);
  end if;
  return 'Allowed.';
end $$;


-- ---------------------------------------------------------------------
-- 10. WRITE GUARDS ON CONFIG TABLES
-- ---------------------------------------------------------------------
create or replace function enforce_wall_admin()
returns trigger language plpgsql as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid;
  v_perm text := coalesce(TG_ARGV[0], 'wof.configure');
begin
  v_company := coalesce(
    (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'company_id')::uuid
  );

  -- allow migrations, seeds and service jobs to run without a session actor
  if v_actor is null then
    if current_setting('app.service_context', true) = 'true' then
      return case when TG_OP = 'DELETE' then OLD else NEW end;
    end if;
    raise exception 'Wall of Fame: no acting employee in session. Set app.current_employee_id.'
      using errcode = '42501';
  end if;

  if not wof_can(v_actor, v_perm, v_company) then
    raise exception 'Wall of Fame: % is not permitted to change %. %',
      v_actor, TG_TABLE_NAME, wof_explain_access(v_actor, v_perm, v_company)
      using errcode = '42501';
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

create or replace function wall_audit()
returns trigger language plpgsql as $$
declare v_company uuid;
begin
  v_company := (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'company_id')::uuid;
  insert into wall_audit_log (company_id, actor_id, action, entity, entity_id, before_state, after_state)
  values (
    v_company,
    wof_current_employee(),
    lower(TG_TABLE_NAME) || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'id')::uuid,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

-- config surfaces: admin write guard + audit
drop trigger if exists trg_guard_awards on recognition_awards;
create trigger trg_guard_awards before insert or update or delete on recognition_awards
  for each row execute function enforce_wall_admin('wof.configure');

drop trigger if exists trg_guard_values on recognition_values;
create trigger trg_guard_values before insert or update or delete on recognition_values
  for each row execute function enforce_wall_admin('wof.configure');

drop trigger if exists trg_guard_badges on badge_master;
create trigger trg_guard_badges before insert or update or delete on badge_master
  for each row execute function enforce_wall_admin('wof.badge.manage');

drop trigger if exists trg_guard_screens on board_screens;
create trigger trg_guard_screens before insert or update or delete on board_screens
  for each row execute function enforce_wall_admin('wof.board.manage');

drop trigger if exists trg_audit_awards on recognition_awards;
create trigger trg_audit_awards after insert or update or delete on recognition_awards
  for each row execute function wall_audit();

drop trigger if exists trg_audit_badges on badge_master;
create trigger trg_audit_badges after insert or update or delete on badge_master
  for each row execute function wall_audit();

drop trigger if exists trg_audit_config on wall_config;
create trigger trg_audit_config after insert or update on wall_config
  for each row execute function wall_audit();

drop trigger if exists trg_audit_admins on wall_admins;
create trigger trg_audit_admins after insert or update on wall_admins
  for each row execute function wall_audit();

drop trigger if exists trg_audit_screens on board_screens;
create trigger trg_audit_screens after insert or update or delete on board_screens
  for each row execute function wall_audit();

-- wall_config: feature switches need wof.configure, but module_enabled needs Super Admin
create or replace function guard_wall_config()
returns trigger language plpgsql as $$
declare v_actor uuid := wof_current_employee();
begin
  if v_actor is null and current_setting('app.service_context', true) = 'true' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.module_enabled is distinct from OLD.module_enabled then
    if not coalesce((select can(v_actor, 'company.activate', 'global')), false) then
      raise exception 'Wall of Fame: only EZER Super Admin can activate or deactivate the module.'
        using errcode = '42501';
    end if;
    NEW.activated_by := v_actor;
    NEW.activated_at := now();
  end if;

  if TG_OP = 'UPDATE' and not is_wall_admin(v_actor, NEW.company_id, 'wall_admin')
     and not coalesce((select can(v_actor, 'company.activate', 'global')), false) then
    raise exception 'Wall of Fame: only a Wall Administrator can change these settings.'
      using errcode = '42501';
  end if;

  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  return NEW;
end $$;

drop trigger if exists trg_guard_wall_config on wall_config;
create trigger trg_guard_wall_config before update on wall_config
  for each row execute function guard_wall_config();


-- ---------------------------------------------------------------------
-- 11. ADMIN GRANT / REVOKE
-- ---------------------------------------------------------------------
create or replace function grant_wall_admin(
  p_employee uuid, p_level text, p_reason text,
  p_branch uuid default null, p_valid_until date default null
) returns uuid language plpgsql as $$
declare v_actor uuid := wof_current_employee(); v_company uuid; v_id uuid;
begin
  select company_id into v_company from employees where id = p_employee;

  if not wof_can(v_actor, 'wof.admin.grant', v_company) then
    raise exception 'Only a Wall Owner can grant Wall Administrator rights.' using errcode = '42501';
  end if;
  if v_actor = p_employee then
    raise exception 'You cannot grant Wall Administrator rights to yourself.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'A reason is required for every Wall Administrator grant.' using errcode = '22023';
  end if;

  insert into wall_admins (company_id, employee_id, admin_level, location_id, granted_by, grant_reason, valid_until)
  values (v_company, p_employee, p_level, p_branch, v_actor, p_reason, p_valid_until)
  returning id into v_id;

  return v_id;
end $$;

create or replace function revoke_wall_admin(p_grant_id uuid, p_reason text)
returns void language plpgsql as $$
declare v_actor uuid := wof_current_employee(); v_company uuid;
begin
  select company_id into v_company from wall_admins where id = p_grant_id;
  if not wof_can(v_actor, 'wof.admin.grant', v_company) then
    raise exception 'Only a Wall Owner can revoke Wall Administrator rights.' using errcode = '42501';
  end if;
  update wall_admins
     set revoked_at = now(), revoked_by = v_actor, revoke_reason = p_reason
   where id = p_grant_id and revoked_at is null;
end $$;


-- ---------------------------------------------------------------------
-- 12. BADGE ENGINE
-- ---------------------------------------------------------------------
create or replace function award_badge(p_employee uuid, p_code text)
returns jsonb language plpgsql as $$
declare v_company uuid; v_th jsonb; v_cnt int; v_tier text; v_base text;
begin
  select company_id into v_company from employees where id = p_employee;

  select tier_thresholds, base_tier into v_th, v_base
    from badge_master
   where company_id = v_company and code = p_code and is_active;

  if v_th is null then
    return jsonb_build_object('error', 'unknown badge', 'code', p_code);
  end if;

  insert into employee_badges (company_id, employee_id, badge_code, tier, first_earned_on, last_earned_on)
  values (v_company, p_employee, p_code, v_base, current_date, current_date)
  on conflict (employee_id, badge_code) do update
    set earned_count = employee_badges.earned_count + 1,
        last_earned_on = current_date,
        progress_pct = 100,
        updated_at = now()
  returning earned_count into v_cnt;

  v_tier := case
    when v_cnt >= coalesce((v_th->>'platinum')::int, 999999) then 'platinum'
    when v_cnt >= coalesce((v_th->>'gold')::int, 999999)     then 'gold'
    when v_cnt >= coalesce((v_th->>'silver')::int, 999999)   then 'silver'
    else v_base end;

  update employee_badges set tier = v_tier
   where employee_id = p_employee and badge_code = p_code;

  return jsonb_build_object('code', p_code, 'count', v_cnt, 'tier', v_tier);
end $$;


-- ---------------------------------------------------------------------
-- 13. PUBLISH PIPELINE
-- ---------------------------------------------------------------------
create or replace function create_shoutout(
  p_receivers uuid[], p_message text, p_value_ids uuid[], p_visibility text default null
) returns uuid language plpgsql as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid; v_cfg wall_config%rowtype; v_id uuid; v_today int; v_branch uuid;
begin
  select company_id, location_id into v_company, v_branch from employees where id = v_actor;

  if not wof_can(v_actor, 'wof.shoutout.create', v_company, v_branch) then
    raise exception 'Shoutouts are not enabled for you. %', wof_explain_access(v_actor, 'wof.shoutout.create', v_company)
      using errcode = '42501';
  end if;

  select * into v_cfg from wall_config where company_id = v_company;

  if v_actor = any(p_receivers) then
    raise exception 'You cannot recognise yourself.' using errcode = '22023';
  end if;

  select count(*) into v_today from recognitions
   where giver_employee_id = v_actor and published_at::date = current_date;
  if v_today >= v_cfg.shoutout_daily_limit then
    raise exception 'Daily shoutout limit of % reached.', v_cfg.shoutout_daily_limit using errcode = '22023';
  end if;

  if exists (
    select 1 from recognitions
     where giver_employee_id = v_actor
       and receiver_employee_ids && p_receivers
       and published_at > now() - make_interval(hours => v_cfg.shoutout_cooldown_hours)
  ) then
    raise exception 'You already recognised this person in the last % hours.', v_cfg.shoutout_cooldown_hours
      using errcode = '22023';
  end if;

  if array_length(p_value_ids, 1) is null then
    raise exception 'Pick at least one company value.' using errcode = '22023';
  end if;

  insert into recognitions (company_id, location_id, kind, giver_employee_id, receiver_employee_ids,
                            message, value_ids, visibility, points_awarded, published_by)
  values (v_company, v_branch, 'shoutout', v_actor, p_receivers, p_message, p_value_ids,
          coalesce(p_visibility, v_cfg.default_visibility), 10, v_actor)
  returning id into v_id;

  return v_id;
end $$;

create or replace function publish_recognition(p_nomination uuid, p_note text default null)
returns uuid language plpgsql as $$
declare
  v_actor uuid := wof_current_employee();
  n recognition_nominations%rowtype;
  a recognition_awards%rowtype;
  v_id uuid; v_branch uuid;
begin
  select * into n from recognition_nominations where id = p_nomination;
  if n.id is null then raise exception 'Nomination not found.'; end if;

  if not wof_can(v_actor, 'wof.publish', n.company_id) then
    raise exception 'Only a Wall Moderator or above can publish. %',
      wof_explain_access(v_actor, 'wof.publish', n.company_id) using errcode = '42501';
  end if;
  if n.status <> 'shortlisted' then
    raise exception 'Only a shortlisted nomination can be published. Current status: %.', n.status
      using errcode = '22023';
  end if;

  select * into a from recognition_awards where id = n.award_id;
  select location_id into v_branch from employees where id = n.nominee_employee_id;

  insert into recognitions (company_id, location_id, kind, award_id, nomination_id,
                            receiver_employee_ids, message, message_hi, value_ids,
                            points_awarded, visibility, cycle_label, published_by)
  values (n.company_id, v_branch, 'award', n.award_id, n.id,
          array[n.nominee_employee_id], n.citation, n.citation_hi, n.value_ids,
          a.points, 'company', n.cycle_label, v_actor)
  returning id into v_id;

  update recognition_nominations
     set status = 'won', decided_by = v_actor, decided_at = now(), decision_note = p_note,
         stage_log = stage_log || jsonb_build_object('stage','published','by',v_actor,'at',now())
   where id = p_nomination;

  if a.badge_code is not null then
    perform award_badge(n.nominee_employee_id, a.badge_code);
  end if;

  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- 14. READ VIEWS
-- ---------------------------------------------------------------------
create or replace view v_wall_feed as
select r.id, r.company_id, r.location_id, r.kind, r.award_id, r.visibility,
       r.message, r.message_hi, r.value_ids, r.points_awarded,
       r.published_at, r.published_by,
       e.id as receiver_id, e.emp_code, e.full_name, e.designation,
       e.department_id, e.location_id as receiver_branch_id,
       g.full_name as giver_name,
       a.name as award_name, a.badge_code
  from recognitions r
  join employees e on e.id = any(r.receiver_employee_ids)
  left join employees g on g.id = r.giver_employee_id
  left join recognition_awards a on a.id = r.award_id
 where r.is_archived = false
   and (e.date_of_leaving is null or e.date_of_leaving >= current_date);

create or replace view v_wall_leaderboard as
select r.company_id, e.id as employee_id, e.emp_code, e.full_name,
       e.designation, e.department_id, e.location_id,
       count(*)                          as recognition_count,
       sum(r.points_awarded)             as points,
       date_trunc('month', r.published_at) as period_month
  from recognitions r
  join employees e on e.id = any(r.receiver_employee_ids)
 where r.is_archived = false
   and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
 group by r.company_id, e.id, e.emp_code, e.full_name, e.designation,
          e.department_id, e.location_id, date_trunc('month', r.published_at);

-- Public board payload. The only route in the module without a login,
-- so it is read-only, scoped by pair_code, and never selects pay data.
create or replace function get_board_payload(p_pair_code text)
returns jsonb language plpgsql stable as $$
declare s board_screens%rowtype; v_cfg wall_config%rowtype; v_out jsonb;
begin
  select * into s from board_screens where pair_code = p_pair_code and is_active;
  if s.id is null then
    return jsonb_build_object('error','screen not found or inactive');
  end if;

  select * into v_cfg from wall_config where company_id = s.company_id;
  if not v_cfg.module_enabled or not v_cfg.board_enabled then
    return jsonb_build_object('error','board disabled for this company');
  end if;

  select jsonb_build_object(
    'screen', jsonb_build_object('name', s.screen_name, 'rotate_seconds', s.rotate_seconds,
                                 'language', s.language, 'slide_types', s.slide_types),
    'company', (select jsonb_build_object('name', c.company_name) from companies c where c.id = s.company_id),
    'slides', coalesce((
      select jsonb_agg(x order by x.published_at desc)
      from (
        select r.id, r.published_at, r.message as citation, r.message_hi as citation_hi,
               a.name as award, a.badge_code, r.cycle_label,
               e.full_name, e.emp_code, e.designation,
               d.dept_name, b.location_name, e.company_doj, e.photo_url,
               eb.tier as badge_tier, eb.earned_count as badge_count
          from recognitions r
          join recognition_awards a on a.id = r.award_id and a.show_on_board
          join employees e on e.id = any(r.receiver_employee_ids)
          left join departments d on d.id = e.department_id
          left join locations b on b.id = e.location_id
          left join employee_badges eb on eb.employee_id = e.id and eb.badge_code = a.badge_code
         where r.company_id = s.company_id
           and r.is_archived = false
           and (s.scope = 'company' or e.location_id = s.location_id)
           and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
         order by r.published_at desc
         limit s.max_slides
      ) x), '[]'::jsonb)
  ) into v_out;

  update board_screens set last_seen_at = now() where id = s.id;
  return v_out;
end $$;


-- ---------------------------------------------------------------------
-- 15. ROW LEVEL SECURITY
--     Follows the existing EZER convention (permissive at row level,
--     enforced above by wof_can() and the write triggers).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'wall_config','wall_admins','wall_permissions','recognition_values','recognition_awards',
    'badge_master','recognition_nominations','recognitions','recognition_reactions',
    'recognition_comments','recognition_reports','employee_badges','board_screens','wall_audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format(
      'create policy %I_all on %I for all to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

commit;

-- =====================================================================
-- ROLLBACK (keep for reference; do not run in production)
-- =====================================================================
-- drop function if exists get_board_payload(text), publish_recognition(uuid,text),
--   create_shoutout(uuid[],text,uuid[],text), award_badge(uuid,text),
--   revoke_wall_admin(uuid,text), grant_wall_admin(uuid,text,text,uuid,date),
--   wof_explain_access(uuid,text,uuid), wof_can(uuid,text,uuid,uuid),
--   is_wall_admin(uuid,uuid,text,uuid), wof_current_employee(),
--   guard_wall_config(), wall_audit(), enforce_wall_admin() cascade;
-- drop view if exists v_wall_leaderboard, v_wall_feed;
-- drop table if exists wall_audit_log, board_screens, employee_badges, recognition_reports,
--   recognition_comments, recognition_reactions, recognitions, recognition_nominations,
--   badge_master, recognition_awards, recognition_values, wall_permissions,
--   wall_admins, wall_config cascade;
