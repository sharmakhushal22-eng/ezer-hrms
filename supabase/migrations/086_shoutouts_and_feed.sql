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
-- EZER HRMS · migration 086_shoutouts_and_feed.sql
-- Adds: shoutout categories, peer-to-peer recognition, company feed
-- Depends: 084_wall_of_fame.sql, 085_wall_of_fame_seed.sql
-- =====================================================================
-- WHY THIS EXISTS
--   084 modelled a shoutout as "message + company value". In practice
--   people recognise each other for a much wider range of things —
--   performance, a save on a customer call, someone covering a shift,
--   a safety catch, or simply a thank you. Forcing all of that through
--   six company values makes the composer feel like a compliance form
--   and kills volume.
--
--   So a shoutout now carries TWO tags:
--     category  — what kind of thing happened   (required)
--     value     — which company value it shows  (optional)
--
--   Categories are company-configurable and admin-controlled, exactly
--   like awards and badges. Everything else about the access model from
--   084 is unchanged: wof_can() still gates every call.
--
--   If 084 has not been deployed yet, this file can be folded into it.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. SHOUTOUT CATEGORIES
-- ---------------------------------------------------------------------
create table if not exists shoutout_categories (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null,
  label         text not null,
  helper_text   text,                       -- shown under the chip in the composer
  glyph         text not null default '👏',
  colour_token  text not null default 'blue'
                check (colour_token in ('blue','green','cyan','violet','rose','gold','slate')),
  points        int  not null default 10 check (points between 0 and 100),
  requires_value boolean not null default false,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references employees(id),
  unique (company_id, code)
);

comment on table shoutout_categories is
  'What a peer shoutout is for. Company-configurable; only a Wall Administrator can edit.';

-- same admin write guard and audit trail as every other config table
drop trigger if exists trg_guard_shoutout_cat on shoutout_categories;
create trigger trg_guard_shoutout_cat before insert or update or delete on shoutout_categories
  for each row execute function enforce_wall_admin('wof.configure');

drop trigger if exists trg_audit_shoutout_cat on shoutout_categories;
create trigger trg_audit_shoutout_cat after insert or update or delete on shoutout_categories
  for each row execute function wall_audit();

alter table shoutout_categories enable row level security;
drop policy if exists shoutout_categories_all on shoutout_categories;
create policy shoutout_categories_all on shoutout_categories
  for all to anon, authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
-- 2. RECOGNITION GETS A CATEGORY
-- ---------------------------------------------------------------------
alter table recognitions
  add column if not exists category_id uuid references shoutout_categories(id),
  add column if not exists thanked_back boolean not null default false,
  add column if not exists edited_at timestamptz;

create index if not exists recognitions_category on recognitions (company_id, category_id, published_at desc);

alter table wall_config
  add column if not exists require_category    boolean not null default true,
  add column if not exists require_value       boolean not null default false,
  add column if not exists allow_group_shoutout boolean not null default true,
  add column if not exists max_receivers        int not null default 10 check (max_receivers between 1 and 25),
  add column if not exists feed_default_scope   text not null default 'company'
      check (feed_default_scope in ('company','branch','department','team')),
  add column if not exists min_message_length   int not null default 15 check (min_message_length between 0 and 200);

comment on column wall_config.require_value is
  'Off by default. A company that runs a values programme can switch it on and every shoutout must then carry a value.';


-- ---------------------------------------------------------------------
-- 3. SEED THE DEFAULT CATEGORIES
-- ---------------------------------------------------------------------
create or replace function seed_shoutout_categories(p_company uuid)
returns int
language plpgsql
as $$
declare v_n int := 0;
begin
  perform set_config('app.service_context', 'true', true);

  insert into shoutout_categories
    (company_id, code, label, helper_text, glyph, colour_token, points, sort_order)
  values
    (p_company,'performance','Performance',
     'Hit a number, cleared a backlog, delivered ahead of plan.','📈','blue',15,1),

    (p_company,'helping_hand','Helping hand',
     'Covered a shift, unblocked someone, stayed back to help.','🤝','green',10,2),

    (p_company,'above_beyond','Above and beyond',
     'Went past what the job asked for.','🚀','violet',15,3),

    (p_company,'customer_save','Customer save',
     'Turned an unhappy customer around.','🛟','cyan',15,4),

    (p_company,'safety_catch','Safety catch',
     'Spotted a hazard or stopped an unsafe job.','🦺','rose',20,5),

    (p_company,'learning','Learning and sharing',
     'Taught someone, wrote it down, ran a session.','📚','gold',10,6),

    (p_company,'team_spirit','Team spirit',
     'Made the team better to work in.','🎈','slate',10,7),

    (p_company,'thank_you','Just a thank you',
     'No big reason needed.','🙏','slate',5,8)
  on conflict (company_id, code) do nothing;

  get diagnostics v_n = row_count;
  perform set_config('app.service_context', 'false', true);
  return v_n;
end $$;


-- ---------------------------------------------------------------------
-- 4. CREATE SHOUTOUT — replaces the 084 version
-- ---------------------------------------------------------------------
drop function if exists create_shoutout(uuid[], text, uuid[], text);

create or replace function create_shoutout(
  p_receivers   uuid[],
  p_category    text,                       -- shoutout_categories.code
  p_message     text,
  p_value_ids   uuid[] default '{}',
  p_visibility  text default null
) returns jsonb
language plpgsql
as $$
declare
  v_actor    uuid := wof_current_employee();
  v_company  uuid;
  v_branch   uuid;
  v_cfg      wall_config%rowtype;
  v_cat      shoutout_categories%rowtype;
  v_id       uuid;
  v_today    int;
  v_bad      int;
begin
  if v_actor is null then
    raise exception 'No acting employee in session.' using errcode = '42501';
  end if;

  select company_id, location_id into v_company, v_branch from employees where id = v_actor;

  ---------------------------------------------------------------- gate
  if not wof_can(v_actor, 'wof.shoutout.create', v_company, v_branch) then
    raise exception 'Shoutouts are not available to you. %',
      wof_explain_access(v_actor, 'wof.shoutout.create', v_company)
      using errcode = '42501';
  end if;

  select * into v_cfg from wall_config where company_id = v_company;

  ------------------------------------------------------------ category
  select * into v_cat from shoutout_categories
   where company_id = v_company and code = p_category and is_active;

  if v_cfg.require_category and v_cat.id is null then
    raise exception 'Pick what the shoutout is for.' using errcode = '22023';
  end if;

  if coalesce(v_cat.requires_value, false) or v_cfg.require_value then
    if array_length(p_value_ids, 1) is null then
      raise exception 'This shoutout needs a company value attached.' using errcode = '22023';
    end if;
  end if;

  ------------------------------------------------------------ receivers
  if array_length(p_receivers, 1) is null then
    raise exception 'Pick at least one person.' using errcode = '22023';
  end if;

  if v_actor = any(p_receivers) then
    raise exception 'You cannot recognise yourself.' using errcode = '22023';
  end if;

  if array_length(p_receivers, 1) > 1 and not v_cfg.allow_group_shoutout then
    raise exception 'Group shoutouts are switched off for this company.' using errcode = '22023';
  end if;

  if array_length(p_receivers, 1) > v_cfg.max_receivers then
    raise exception 'You can recognise up to % people at once.', v_cfg.max_receivers
      using errcode = '22023';
  end if;

  -- everyone named must be an active employee of the same company
  select count(*) into v_bad
    from unnest(p_receivers) r(id)
    left join employees e
      on e.id = r.id
     and e.company_id = v_company
     and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
   where e.id is null;

  if v_bad > 0 then
    raise exception 'One or more people named are not active employees of this company.'
      using errcode = '22023';
  end if;

  -------------------------------------------------------------- message
  if length(trim(coalesce(p_message, ''))) < v_cfg.min_message_length then
    raise exception 'Say a little more — at least % characters.', v_cfg.min_message_length
      using errcode = '22023';
  end if;

  ------------------------------------------------------------- throttles
  select count(*) into v_today
    from recognitions
   where giver_employee_id = v_actor
     and kind = 'shoutout'
     and published_at::date = current_date;

  if v_today >= v_cfg.shoutout_daily_limit then
    raise exception 'You have used all % shoutouts for today. They reset at midnight.',
      v_cfg.shoutout_daily_limit using errcode = '22023';
  end if;

  if exists (
    select 1 from recognitions
     where giver_employee_id = v_actor
       and kind = 'shoutout'
       and receiver_employee_ids && p_receivers
       and published_at > now() - make_interval(hours => v_cfg.shoutout_cooldown_hours)
  ) then
    raise exception 'You already recognised one of these people in the last % hours.',
      v_cfg.shoutout_cooldown_hours using errcode = '22023';
  end if;

  ---------------------------------------------------------------- insert
  insert into recognitions
    (company_id, location_id, kind, category_id, giver_employee_id, receiver_employee_ids,
     message, value_ids, visibility, points_awarded, published_by)
  values
    (v_company, v_branch, 'shoutout', v_cat.id, v_actor, p_receivers,
     trim(p_message), coalesce(p_value_ids, '{}'),
     coalesce(p_visibility, v_cfg.feed_default_scope),
     coalesce(v_cat.points, 10), v_actor)
  returning id into v_id;

  ------------------------------------------------- value badge accrual
  -- repeated shoutouts on the same value grow that person's value badge
  if array_length(p_value_ids, 1) is not null then
    perform award_badge(r.id, bm.code)
      from unnest(p_receivers) r(id)
      join badge_master bm
        on bm.company_id = v_company
       and bm.is_active
       and bm.value_code in (
             select code from recognition_values where id = any(p_value_ids)
           );
  end if;

  return jsonb_build_object(
    'id', v_id,
    'category', v_cat.code,
    'points', coalesce(v_cat.points, 10),
    'receivers', array_length(p_receivers, 1),
    'shoutouts_left_today', greatest(v_cfg.shoutout_daily_limit - v_today - 1, 0)
  );
end $$;

comment on function create_shoutout is
  'Peer-to-peer recognition. Validates gate, category, receivers, message and throttles, then accrues value badges.';


-- ---------------------------------------------------------------------
-- 5. THANK BACK — the receiver acknowledges publicly
-- ---------------------------------------------------------------------
create or replace function thank_back(p_recognition uuid)
returns void language plpgsql as $$
declare v_actor uuid := wof_current_employee(); r recognitions%rowtype;
begin
  select * into r from recognitions where id = p_recognition;
  if r.id is null then raise exception 'Not found.'; end if;
  if not (v_actor = any(r.receiver_employee_ids)) then
    raise exception 'Only the person recognised can thank back.' using errcode = '42501';
  end if;
  update recognitions set thanked_back = true where id = p_recognition;
end $$;


-- ---------------------------------------------------------------------
-- 6. COMPANY FEED
-- ---------------------------------------------------------------------
-- One row per recognition (not per receiver), with receivers rolled up,
-- so the feed does not duplicate a group shoutout across its members.
create or replace view v_company_feed as
select
  r.id,
  r.company_id,
  r.location_id,
  r.kind,
  r.visibility,
  r.message,
  r.message_hi,
  r.points_awarded,
  r.thanked_back,
  r.published_at,
  r.cycle_label,

  c.code                as category_code,
  c.label               as category_label,
  c.glyph               as category_glyph,
  c.colour_token        as category_colour,

  a.name                as award_name,
  a.badge_code,

  g.id                  as giver_id,
  g.full_name           as giver_name,
  g.emp_code       as giver_code,
  g.designation         as giver_designation,
  gb.location_name        as giver_branch,

  (select jsonb_agg(jsonb_build_object(
            'id', e.id, 'name', e.full_name, 'code', e.emp_code,
            'designation', e.designation,
            'department', d.dept_name, 'branch', b.location_name,
            'photo_url', e.photo_url))
     from employees e
     left join departments d on d.id = e.department_id
     left join locations   b on b.id = e.location_id
    where e.id = any(r.receiver_employee_ids)
      and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
  ) as receivers,

  (select coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label,
                                                'colour', v.colour_token)), '[]'::jsonb)
     from recognition_values v where v.id = any(r.value_ids)) as values,

  (select count(*) from recognition_reactions x where x.recognition_id = r.id) as reaction_count,
  (select count(*) from recognition_comments  x where x.recognition_id = r.id
     and x.is_hidden = false) as comment_count

from recognitions r
left join shoutout_categories c on c.id = r.category_id
left join recognition_awards  a on a.id = r.award_id
left join employees g on g.id = r.giver_employee_id
left join locations gb on gb.id = g.location_id
where r.is_archived = false;

comment on view v_company_feed is
  'The Company Feed. One row per recognition with receivers rolled up. Visibility is applied by get_company_feed().';

-- Feed reader. Applies the visibility rule relative to the viewer.
create or replace function get_company_feed(
  p_scope     text default 'company',      -- company | branch | department | circle | mine
  p_category  text default null,
  p_kind      text default null,
  p_limit     int  default 20,
  p_before    timestamptz default null
) returns setof v_company_feed
language plpgsql stable
as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid; v_branch uuid; v_dept uuid; v_mgr uuid;
begin
  select company_id, location_id, department_id, l1_manager_id
    into v_company, v_branch, v_dept, v_mgr
    from employees where id = v_actor;

  if not wof_can(v_actor, 'wof.view', v_company, v_branch) then
    return;                                        -- empty set, never an error page
  end if;

  return query
  select f.* from v_company_feed f
  where f.company_id = v_company
    and (p_category is null or f.category_code = p_category)
    and (p_kind     is null or f.kind = p_kind)
    and (p_before   is null or f.published_at < p_before)

    -- the post's own visibility setting
    and (
      f.visibility = 'company'
      or (f.visibility = 'branch'     and f.location_id = v_branch)
      or (f.visibility = 'department' and exists (
            select 1 from jsonb_array_elements(f.receivers) x
             where (x->>'id')::uuid in (select id from employees where department_id = v_dept)))
      or (f.visibility = 'team'       and (f.giver_id = v_mgr or f.giver_id = v_actor))
      or  f.giver_id = v_actor
    )

    -- the scope the viewer asked for
    and (
      p_scope = 'company'
      or (p_scope = 'branch'     and f.location_id = v_branch)
      or (p_scope = 'department' and exists (
            select 1 from jsonb_array_elements(f.receivers) x
             where (x->>'id')::uuid in (select id from employees where department_id = v_dept)))
      or (p_scope = 'circle'     and (
            f.giver_id in (select id from employees where l1_manager_id = v_mgr or id = v_mgr)
            or exists (select 1 from jsonb_array_elements(f.receivers) x
                        where (x->>'id')::uuid in
                              (select id from employees where l1_manager_id = v_mgr or id = v_mgr))))
      or (p_scope = 'mine'       and (
            f.giver_id = v_actor
            or exists (select 1 from jsonb_array_elements(f.receivers) x
                        where (x->>'id')::uuid = v_actor)))
    )
  order by f.published_at desc
  limit least(p_limit, 50);
end $$;


-- ---------------------------------------------------------------------
-- 7. FEED SIDEBAR COUNTERS
-- ---------------------------------------------------------------------
create or replace function get_feed_stats(p_company uuid default null)
returns jsonb language plpgsql stable as $$
declare v_actor uuid := wof_current_employee(); v_company uuid; v_cfg wall_config%rowtype; v_used int;
begin
  select coalesce(p_company, company_id) into v_company from employees where id = v_actor;
  select * into v_cfg from wall_config where company_id = v_company;

  select count(*) into v_used from recognitions
   where giver_employee_id = v_actor and kind = 'shoutout' and published_at::date = current_date;

  return jsonb_build_object(
    'shoutouts_this_month', (
      select count(*) from recognitions
       where company_id = v_company and kind = 'shoutout'
         and published_at >= date_trunc('month', current_date) and is_archived = false),
    'people_recognised_this_month', (
      select count(distinct x) from recognitions r, unnest(r.receiver_employee_ids) x
       where r.company_id = v_company and r.published_at >= date_trunc('month', current_date)
         and r.is_archived = false),
    'top_categories', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.label, c.glyph, count(*) as n
          from recognitions r join shoutout_categories c on c.id = r.category_id
         where r.company_id = v_company and r.published_at >= date_trunc('month', current_date)
           and r.is_archived = false
         group by c.label, c.glyph order by count(*) desc limit 5) t),
    'my_shoutouts_left_today', greatest(coalesce(v_cfg.shoutout_daily_limit, 5) - v_used, 0),
    'never_recognised_90d', (
      select count(*) from employees e
       where e.company_id = v_company
         and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
         and not exists (
           select 1 from recognitions r
            where r.company_id = v_company
              and e.id = any(r.receiver_employee_ids)
              and r.published_at > now() - interval '90 days'))
  );
end $$;

commit;

-- =====================================================================
-- USAGE
-- =====================================================================
-- At activation, after seed_wall_defaults():
--   select seed_shoutout_categories('<company_uuid>');
--
-- Giving a shoutout from the API:
--   select create_shoutout(
--     array['<employee_uuid>']::uuid[],   -- one or many
--     'performance',
--     'Cleared the whole September backlog two days early.',
--     array['<value_uuid>']::uuid[],      -- optional
--     'company'
--   );
--
-- Reading the Company Feed:
--   select * from get_company_feed('company', null, null, 20, null);
--   select * from get_company_feed('circle',  'performance', 'shoutout', 20, null);
--
-- Sidebar counters:
--   select get_feed_stats();
